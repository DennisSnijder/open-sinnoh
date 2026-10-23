import * as THREE from 'three';

/** Full-screen passes of the enhanced post chain (ShaderPass shaders: `tDiffuse` is the chain's input). */

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Linear view depth from the field's depth buffer (perspective or orthographic). */
const LINEAR = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform bool uPersp;
float linearDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  return uPersp ? uNear * uFar / (uFar - d * (uFar - uNear)) : uNear + d * (uFar - uNear);
}`;

const depthUniforms = () => ({ tDepth: { value: null as THREE.Texture | null }, uNear: { value: 1 }, uFar: { value: 1000 }, uPersp: { value: true } });

/**
 * Ambient occlusion by unsharp-masking the depth (Luft et al. 2006): a pixel whose neighbours lie on average nearer
 * the camera is in a crease (a wall's foot, under eaves, between props) and darkens. Pairs of opposite taps cancel
 * on a flat slope, so open ground stays clear. 8 pairs within ~12 world units.
 */
export const AO_SHADER = {
  name: 'EnhancedAO',
  uniforms: { tDiffuse: { value: null }, ...depthUniforms(), uTexel: { value: new THREE.Vector2() }, uProjScale: { value: 1 }, uStrength: { value: 0.5 } },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uProjScale;
uniform float uStrength;
varying vec2 vUv;
${LINEAR}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  if (texture2D(tDepth, vUv).r >= 1.0) { gl_FragColor = c; return; }
  float z = linearDepth(vUv);
  float r = clamp(12.0 * uProjScale / (uPersp ? z : 1.0), 2.0, 48.0);
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 2.39996;
    float s = sqrt((float(i) + 0.5) / 8.0);
    vec2 o = vec2(cos(a), sin(a)) * r * s * uTexel;
    float za = linearDepth(vUv + o);
    float zb = linearDepth(vUv - o);
    float dz = z - 0.5 * (za + zb);
    occ += clamp(dz / 6.0, 0.0, 1.0) * (1.0 - smoothstep(6.0, 16.0, abs(z - min(za, zb))));
  }
  gl_FragColor = vec4(c.rgb * (1.0 - uStrength * occ / 8.0), c.a);
}`,
};

/**
 * Golden-hour light: shafts from the sun's side (a radial scatter of the frame's bright pixels toward the sun, the
 * GPU Gems 3 volumetric light scattering), a glare on that side and lens flare ghosts along the axis through the
 * frame's middle. The sun is kept at the frame's edge (pipeline.ts).
 */
export const SUN_SHADER = {
  name: 'EnhancedSun',
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 1.2) }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.8, 0.5) }, uAspect: { value: 1 }, uFlare: { value: 0 } },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uIntensity;
uniform vec3 uColor;
uniform float uAspect;
uniform float uFlare;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  vec2 delta = (vUv - uSun) * (0.6 / 24.0);
  vec2 uv = vUv;
  float decay = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    uv -= delta;
    vec2 cuv = clamp(uv, 0.001, 0.999);
    vec3 s = texture2D(tDiffuse, cuv).rgb;
    float l = max(dot(s, vec3(0.299, 0.587, 0.114)) - 0.68, 0.0);
    acc += s * l * decay;
    decay *= 0.92;
  }
  vec3 rays = acc * uIntensity * uColor * 0.5;
  float dist = length((vUv - uSun) * vec2(uAspect, 1.0));
  vec3 glare = uColor * uIntensity * 0.28 * exp(-dist * 1.8);
  vec2 axis = vec2(0.5) - uSun;
  vec3 flare = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float k = i == 0 ? 0.55 : i == 1 ? 0.9 : i == 2 ? 1.3 : 1.65;
    float r = i == 0 ? 0.03 : i == 1 ? 0.06 : i == 2 ? 0.02 : 0.09;
    float gd = length((vUv - (uSun + axis * k)) * vec2(uAspect, 1.0));
    flare += mix(uColor, vec3(0.55, 0.8, 1.0), float(i) / 3.0) * smoothstep(r, r * 0.5, gd) * 0.06;
  }
  gl_FragColor = vec4(base.rgb + rays + glare + flare * uFlare, base.a);
}`,
};

/**
 * Tilt-shift depth of field, one direction per pass (two passes: horizontal, vertical). The circle of confusion is
 * the larger of the screen distance from the focus band (the player's row) and the depth distance from the player,
 * so the far top and near bottom of the frame blur like a photographed miniature. 13 taps, weighted against
 * pulling sharp pixels into blurred ones.
 */
export const DOF_SHADER = {
  name: 'EnhancedDof',
  uniforms: { tDiffuse: { value: null }, ...depthUniforms(), uDir: { value: new THREE.Vector2() }, uFocusY: { value: 0.5 }, uFocusZ: { value: 500 }, uBand: { value: 0.12 }, uMaxR: { value: 6 } },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
uniform float uFocusY;
uniform float uFocusZ;
uniform float uBand;
uniform float uMaxR;
varying vec2 vUv;
${LINEAR}
float coc(vec2 uv) {
  float dz = abs(linearDepth(uv) - uFocusZ) / uFocusZ;
  float depth = smoothstep(0.08, 0.6, dz);
  float tilt = smoothstep(uBand, uBand + 0.32, abs(uv.y - uFocusY));
  return max(depth * 0.8, tilt);
}
void main() {
  float c = coc(vUv);
  vec4 base = texture2D(tDiffuse, vUv);
  if (c < 0.02) { gl_FragColor = base; return; }
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float t = float(i) / 6.0;
    vec2 uv = vUv + uDir * t * c * uMaxR;
    float w = exp(-t * t * 2.0) * mix(0.15, 1.0, smoothstep(0.0, c, coc(uv)));
    acc += texture2D(tDiffuse, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, base.a);
}`,
};

/** Colour grading, the sunset tint (stronger toward the frame's top, the far side) and a vignette; the chain's last pass. */
export const GRADE_SHADER = {
  name: 'EnhancedGrade',
  uniforms: {
    tDiffuse: { value: null },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3() },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uExposure: { value: 1 },
    uVignette: { value: 0 },
    uSunset: { value: new THREE.Vector3(1, 1, 1) },
    uSunsetAmt: { value: 0 },
  },
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uGain;
uniform vec3 uLift;
uniform float uSat;
uniform float uContrast;
uniform float uExposure;
uniform float uVignette;
uniform vec3 uSunset;
uniform float uSunsetAmt;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  vec3 c = base.rgb * uExposure * uGain;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c += uLift * (1.0 - c);
  c = mix(c, c * uSunset, uSunsetAmt * (0.45 + 0.55 * vUv.y));
  float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.0, 0.85)) * 1.15);
  c *= mix(1.0, v, uVignette);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), base.a);
}`,
};
