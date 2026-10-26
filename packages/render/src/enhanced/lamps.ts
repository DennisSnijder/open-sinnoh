import * as THREE from 'three';
import type { GlowKind } from './light-sources.ts';

/**
 * Night glows on the map's light sources (light-sources.ts): each light-source mesh is drawn again, additively, with
 * only its bright texels (lamp glass, a lit sign, a beacon, a window pane), so a glow has the shape and colour the DS
 * texture gives it; the bloom pass then spreads it into a soft halo. Lamps keep their texel colour (a red beacon glows
 * red and blinks with its texture animation); windows glow warm by their texels' brightness. A texel the field covers
 * (its depth nearer than the glow's) stays dark. Fades in with the night.
 */

const VERTEX = /* glsl */ `
uniform mat3 uUvTransform;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = (uUvTransform * vec3(uv, 1.0)).xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tMap;
uniform sampler2D tDepth;
uniform vec2 uSize;
uniform bool uPersp;
uniform float uNear;
uniform float uFar;
uniform float uNight;
uniform bool uWindow;
varying vec2 vUv;
varying float vDepth;
float linear(float d) { return uPersp ? uNear * uFar / (uFar - d * (uFar - uNear)) : uNear + d * (uFar - uNear); }
void main() {
  float scene = linear(texture2D(tDepth, gl_FragCoord.xy / uSize).r);
  float own = uPersp ? vDepth : linear(gl_FragCoord.z);
  if (scene < own - 1.0) discard;
  vec4 t = texture2D(tMap, vUv);
  if (t.a < 0.5) discard;
  float bright = max(t.r, max(t.g, t.b));
  float lit = smoothstep(0.6, 0.95, bright);
  vec3 warm = vec3(1.0, 0.78, 0.48);
  vec3 c = uWindow ? warm * lit * 0.55 : mix(t.rgb, t.rgb * warm, 0.35) * lit * 0.9;
  gl_FragColor = vec4(c * uNight, 1.0);
}`;

export class LampGlows {
  private readonly scene = new THREE.Scene();
  private readonly base = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      tMap: { value: null },
      tDepth: { value: null },
      uUvTransform: { value: new THREE.Matrix3() },
      uSize: { value: new THREE.Vector2(1, 1) },
      uPersp: { value: true },
      uNear: { value: 1 },
      uFar: { value: 1000 },
      uNight: { value: 0 },
      uWindow: { value: false },
    },
  });
  /** One stand-in per light-source mesh (its geometry, its place), by the source mesh. */
  private proxies = new Map<THREE.Mesh, THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>();
  private source: readonly THREE.Mesh[] = [];

  draw(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, glows: readonly THREE.Mesh[], depth: THREE.Texture, width: number, height: number, persp: boolean, night: number): void {
    if (glows !== this.source) this.rebuild(glows);
    if (!this.proxies.size) return;
    for (const [mesh, proxy] of this.proxies) {
      const map = (mesh.material as THREE.MeshBasicMaterial).map;
      proxy.visible = !!map && mesh.visible && !!mesh.parent?.visible;
      if (!map) continue;
      map.updateMatrix();
      proxy.matrixWorld.copy(mesh.matrixWorld);
      const u = proxy.material.uniforms;
      u.tMap!.value = map;
      (u.uUvTransform!.value as THREE.Matrix3).copy(map.matrix);
      u.tDepth!.value = depth;
      (u.uSize!.value as THREE.Vector2).set(width, height);
      u.uPersp!.value = persp;
      u.uNear!.value = camera.near;
      u.uFar!.value = camera.far;
      u.uNight!.value = night;
    }
    renderer.render(this.scene, camera);
  }

  private rebuild(glows: readonly THREE.Mesh[]): void {
    this.source = glows;
    const keep = new Set(glows);
    for (const [mesh, proxy] of this.proxies) {
      if (keep.has(mesh)) continue;
      this.scene.remove(proxy);
      proxy.material.dispose();
      this.proxies.delete(mesh);
    }
    for (const mesh of glows) {
      if (this.proxies.has(mesh)) continue;
      const material = this.base.clone();
      material.uniforms.uWindow!.value = (mesh.userData.glow as GlowKind) === 'window';
      const proxy = new THREE.Mesh(mesh.geometry, material);
      proxy.matrixAutoUpdate = false;
      proxy.matrixWorldAutoUpdate = false;
      proxy.frustumCulled = false;
      this.scene.add(proxy);
      this.proxies.set(mesh, proxy);
    }
  }

  dispose(): void {
    for (const proxy of this.proxies.values()) proxy.material.dispose();
    this.proxies.clear();
    this.base.dispose();
  }
}
