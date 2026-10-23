import * as THREE from 'three';
import type { LampPoint } from './lamp-points.ts';

/**
 * Night glows on lamps and lit windows (lamp-points.ts): one additive point each, a halo and a hot core, fading in
 * with the night. The vertex shader looks up the field's depth at the glow's centre and hides a glow the map
 * covers (a few units of slack: the centre sits inside the lamp's own model). The bloom pass then spreads them.
 */

const VERTEX = /* glsl */ `
attribute float kind;
uniform sampler2D tDepth;
uniform float uProjScale;
uniform bool uPersp;
uniform float uNear;
uniform float uFar;
uniform float uTime;
varying float vKind;
varying float vFlicker;
float linear(float d) { return uPersp ? uNear * uFar / (uFar - d * (uFar - uNear)) : uNear + d * (uFar - uNear); }
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_Position = clip;
  vec3 ndc = clip.xyz / clip.w;
  float scene = texture2D(tDepth, ndc.xy * 0.5 + 0.5).r;
  float hidden = linear(scene) < linear(ndc.z * 0.5 + 0.5) - 10.0 ? 1.0 : 0.0;
  float size = kind > 0.5 ? 12.0 : 24.0;
  gl_PointSize = hidden > 0.5 ? 0.0 : size * uProjScale / (uPersp ? -mv.z : 1.0);
  vKind = kind;
  vFlicker = 0.92 + 0.08 * sin(uTime * 7.0 + position.x * 0.37 + position.z * 0.11);
}`;

const FRAGMENT = /* glsl */ `
uniform float uNight;
varying float vKind;
varying float vFlicker;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  vec3 warm = vKind > 0.5 ? vec3(1.0, 0.8, 0.5) : vec3(1.0, 0.86, 0.6);
  float halo = exp(-r2 * 5.0) * (vKind > 0.5 ? 0.1 : 0.3);
  float core = exp(-r2 * 40.0) * (vKind > 0.5 ? 0.15 : 0.6);
  gl_FragColor = vec4(warm * (halo + core) * uNight * vFlicker, 1.0);
}`;

export class LampGlows {
  private readonly scene = new THREE.Scene();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { tDepth: { value: null }, uProjScale: { value: 1 }, uPersp: { value: true }, uNear: { value: 1 }, uFar: { value: 1000 }, uNight: { value: 0 }, uTime: { value: 0 } },
  });
  private points: THREE.Points | null = null;
  private source: readonly LampPoint[] = [];
  private readonly start = performance.now();

  draw(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, lamps: readonly LampPoint[], depth: THREE.Texture, _width: number, _height: number, projScale: number, persp: boolean, night: number): void {
    if (lamps !== this.source) {
      this.source = lamps;
      if (this.points) {
        this.scene.remove(this.points);
        this.points.geometry.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lamps.flatMap((l) => [l.at.x, l.at.y, l.at.z])), 3));
      geometry.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(lamps.map((l) => (l.kind === 'window' ? 1 : 0))), 1));
      this.points = new THREE.Points(geometry, this.material);
      this.points.frustumCulled = false;
      this.scene.add(this.points);
    }
    if (!lamps.length) return;
    const u = this.material.uniforms;
    u.tDepth!.value = depth;
    u.uProjScale!.value = projScale;
    u.uPersp!.value = persp;
    u.uNear!.value = camera.near;
    u.uFar!.value = camera.far;
    u.uNight!.value = night;
    u.uTime!.value = (performance.now() - this.start) / 1000;
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.points?.geometry.dispose();
    this.material.dispose();
  }
}
