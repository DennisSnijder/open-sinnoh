import * as THREE from 'three';
import type { Zone } from '@opensinnoh/contracts';
import { goldenAt, nightAt } from './time.ts';

/**
 * Ambient particles: points in a box that follows the camera target and wraps (an endless field), animated wholly
 * in the vertex shader. Drawn over the composited frame with the field's depth as a manual depth test, so the map
 * hides them, and never over the rear plane (the void around an indoor map).
 */

export interface ParticleKind {
  name: 'pollen' | 'leaves' | 'fireflies' | 'dust' | 'sparkle';
  count: number;
  color: [number, number, number];
  /** A second colour mixed in by the particle's seed (leaves). */
  color2?: [number, number, number];
  /** World units. */
  size: number;
  alpha: number;
  /** World units per second. */
  drift: [number, number, number];
  /** Amplitude of the wandering (world units). */
  wander: number;
  additive: boolean;
  /** 0 soft dot, 1 leaf (a turning ellipse), 2 pulsing glow, 3 twinkle. */
  shape: number;
}

const KINDS: Record<ParticleKind['name'], ParticleKind> = {
  pollen: { name: 'pollen', count: 150, color: [1, 0.96, 0.78], size: 1.4, alpha: 0.6, drift: [5, 1.5, -2], wander: 7, additive: false, shape: 0 },
  leaves: { name: 'leaves', count: 34, color: [0.5, 0.74, 0.26], color2: [0.93, 0.62, 0.22], size: 4.2, alpha: 0.95, drift: [11, -8, 5], wander: 9, additive: false, shape: 1 },
  fireflies: { name: 'fireflies', count: 70, color: [0.82, 1, 0.38], size: 4.2, alpha: 1, drift: [0, 0, 0], wander: 16, additive: true, shape: 2 },
  dust: { name: 'dust', count: 220, color: [1, 0.95, 0.86], size: 0.9, alpha: 0.4, drift: [1.5, 0.6, 0.8], wander: 4, additive: false, shape: 0 },
  sparkle: { name: 'sparkle', count: 36, color: [0.7, 0.85, 1], size: 1.8, alpha: 1, drift: [0, 0.3, 0], wander: 2, additive: true, shape: 3 },
};

/** The particles for a zone at an hour: leaves and pollen on routes and in towns by day, fireflies at night, dust indoors, dust and sparkles in caves. */
export function particleKinds(zone: Zone, hour: number): ParticleKind[] {
  const night = nightAt(hour);
  const forest = /FOREST/.test(zone.id);
  if (zone.mapType === 'indoors' || zone.mapType === 'other') return [KINDS.dust];
  if (zone.mapType === 'cave') return [KINDS.dust, KINDS.sparkle];
  const out: ParticleKind[] = [];
  if (night > 0.5) out.push({ ...KINDS.fireflies, count: forest ? 110 : 70 });
  else {
    const golden = goldenAt(hour);
    out.push({ ...KINDS.pollen, color: golden > 0.3 ? [1, 0.82, 0.5] : KINDS.pollen.color }, { ...KINDS.leaves, count: forest ? 70 : zone.mapType === 'route' ? 34 : 18 });
    if (forest) out.push({ ...KINDS.fireflies, count: 40 });
  }
  return out;
}

const VERTEX = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uDrift;
uniform float uWander;
uniform float uSize;
uniform float uProjScale;
uniform bool uPersp;
uniform sampler2D tDepth;
uniform vec2 uViewport;
varying float vSeed;
varying float vAngle;
varying float vFade;
void main() {
  vec3 s = seed.xyz;
  float t = uTime;
  vec3 p = s * uBox + uDrift * t;
  p += uWander * vec3(sin(t * (0.3 + s.y * 0.5) + seed.w * 31.0), 0.5 * sin(t * (0.4 + s.z * 0.4) + seed.w * 17.0), cos(t * (0.35 + s.x * 0.45) + seed.w * 23.0));
  p = mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox + uCenter;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + 0.8 * seed.w) * uProjScale / (uPersp ? -mv.z : 1.0);
  vSeed = seed.w;
  vAngle = t * (1.0 + 2.0 * s.x) + seed.w * 6.28;
  // Fade at the box's walls, so the wrap is never seen.
  vec3 e = abs(p - uCenter) / (0.5 * uBox);
  vFade = 1.0 - smoothstep(0.75, 1.0, max(e.x, e.z));
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uViewport;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uShape;
uniform float uTime;
uniform bool uAdditive;
varying float vSeed;
varying float vAngle;
varying float vFade;
void main() {
  float scene = texture2D(tDepth, gl_FragCoord.xy / uViewport).r;
  if (scene >= 1.0 || gl_FragCoord.z > scene) discard;
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a;
  vec3 color = uColor;
  if (uShape < 0.5) {
    a = 1.0 - smoothstep(0.2, 1.0, length(q));
  } else if (uShape < 1.5) {
    float c = cos(vAngle), s = sin(vAngle);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    a = 1.0 - smoothstep(0.75, 1.0, length(r * vec2(1.0, 2.4)));
    color = mix(uColor, uColor2, step(0.55, vSeed)) * (0.8 + 0.4 * abs(sin(vAngle)));
  } else if (uShape < 2.5) {
    float pulse = smoothstep(0.2, 1.0, sin(uTime * (1.2 + vSeed) + vSeed * 40.0) * 0.5 + 0.5);
    a = exp(-dot(q, q) * 4.0) * pulse;
  } else {
    float tw = pow(max(0.0, sin(uTime * (2.0 + 3.0 * vSeed) + vSeed * 60.0)), 8.0);
    a = (exp(-dot(q, q) * 8.0) + max(0.0, 1.0 - abs(q.x) * 6.0) * max(0.0, 1.0 - abs(q.y)) * 0.5 + max(0.0, 1.0 - abs(q.y) * 6.0) * max(0.0, 1.0 - abs(q.x)) * 0.5) * tw;
  }
  a *= uAlpha * vFade;
  if (a < 0.01) discard;
  gl_FragColor = uAdditive ? vec4(color * a, 1.0) : vec4(color, a);
}`;

interface Layer {
  kind: ParticleKind;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

export class Particles {
  private readonly scene = new THREE.Scene();
  private readonly layers = new Map<string, Layer>();
  private readonly start = performance.now();

  draw(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.Vector3, kinds: readonly ParticleKind[], depth: THREE.Texture, width: number, height: number, projScale: number, persp: boolean): void {
    const wanted = new Set(kinds.map((k) => `${k.name}:${k.count}`));
    for (const [key, layer] of this.layers)
      if (!wanted.has(key)) {
        this.scene.remove(layer.points);
        layer.points.geometry.dispose();
        layer.material.dispose();
        this.layers.delete(key);
      }
    if (!kinds.length) return;
    const time = (performance.now() - this.start) / 1000;
    for (const kind of kinds) {
      const key = `${kind.name}:${kind.count}`;
      let layer = this.layers.get(key);
      if (!layer) {
        layer = this.layer(kind);
        this.layers.set(key, layer);
        this.scene.add(layer.points);
      }
      const u = layer.material.uniforms;
      u.uTime!.value = time;
      (u.uCenter!.value as THREE.Vector3).set(target.x, target.y + (kind.name === 'dust' || kind.name === 'sparkle' ? 30 : 60), target.z);
      u.tDepth!.value = depth;
      (u.uViewport!.value as THREE.Vector2).set(width, height);
      u.uProjScale!.value = projScale;
      u.uPersp!.value = persp;
      (u.uColor!.value as THREE.Vector3).set(...kind.color);
    }
    renderer.render(this.scene, camera);
  }

  private layer(kind: ParticleKind): Layer {
    const seeds = new Float32Array(kind.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(kind.count * 3), 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    const indoorBox = kind.name === 'dust' || kind.name === 'sparkle';
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: kind.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: indoorBox ? new THREE.Vector3(360, 80, 300) : new THREE.Vector3(520, 140, 460) },
        uDrift: { value: new THREE.Vector3(...kind.drift) },
        uWander: { value: kind.wander },
        uSize: { value: kind.size },
        uProjScale: { value: 1 },
        uPersp: { value: true },
        tDepth: { value: null },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Vector3(...kind.color) },
        uColor2: { value: new THREE.Vector3(...(kind.color2 ?? kind.color)) },
        uAlpha: { value: kind.alpha },
        uShape: { value: kind.shape },
        uAdditive: { value: kind.additive },
      },
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { kind, points, material };
  }

  dispose(): void {
    for (const layer of this.layers.values()) {
      layer.points.geometry.dispose();
      layer.material.dispose();
    }
    this.layers.clear();
  }
}
