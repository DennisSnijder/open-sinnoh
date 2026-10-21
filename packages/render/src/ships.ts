import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Registries, ShipScene, ShipSceneView } from '@opensinnoh/contracts';
import { AssetCache, pixelTexture } from './assets.ts';
import { fieldOutputs } from './composite.ts';
import type { LightTemplate } from './lighting.ts';

const VERTEX = `
#include <common>
#include <skinning_pars_vertex>
uniform vec3 lightDir[4], lightColor[4];
uniform vec4 lightMask;
uniform vec3 diffuse, ambient, specular, emission;
uniform float lit, projectionMap;
uniform mat3 uvMatrix;
varying vec3 shade;
varying vec2 texcoord;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec3 n = normalize(transformedNormal);
  vec3 c = emission;
  for (int i = 0; i < 4; i++) {
    vec3 l = lightDir[i];
    float h = max(0.0, -dot((l + vec3(0.0,0.0,-1.0)) / 2.0, n));
    c += lightMask[i] * lightColor[i] * (diffuse * max(0.0, -dot(l,n)) + ambient + specular*h*h);
  }
  shade = lit > 0.5 ? min(c, vec3(1.0)) : vec3(1.0);
  vec2 coord = projectionMap > 0.5 ? gl_Position.xy / gl_Position.w * 0.5 + 0.5 : uv;
  texcoord = (uvMatrix * vec3(coord, 1.0)).xy;
}`;
const FRAGMENT = `
uniform sampler2D map;
uniform float hasMap, opacity, actorAlpha;
varying vec3 shade;
varying vec2 texcoord;
void main() {
  vec4 texel = hasMap > 0.5 ? texture2D(map, texcoord) : vec4(1.0);
  if (texel.a < 0.01 || opacity == 0.0) discard;
  gl_FragColor = vec4(texel.rgb * shade, texel.a * opacity * actorAlpha);
}`;

const at = (track: number | number[], tick: number) => typeof track === 'number' ? track : track[Math.min(tick, track.length - 1)]!;
const rgb = (v: number) => new THREE.Vector3((v & 31) / 31, ((v >> 5) & 31) / 31, ((v >> 10) & 31) / 31);

export interface ScenePass {
  root: THREE.Object3D;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  record: ShipScene;
  materials: THREE.ShaderMaterial[];
  textures: Map<string, THREE.Texture>;
}

/** Own scene/camera; the field scene never leaks into the cinematic. Clocked only by BoatTrip.view(). */
export class Ships {
  private passes: ScenePass[] = [];
  private disposed = false;
  private loaded = false;
  private start: (() => void) | null = null;

  /** Loads on the first `ready()` or `pose()`, not at mount: a mount-time burst of asset reads delays saves. */
  constructor(reg: Registries, assets: AssetCache, failed: (e: unknown) => void, records?: ShipScene[]) {
    const scenes = records ?? [...reg.newGame.values()][0]?.boat?.scenes;
    if (!scenes) return;
    this.start = () => {
      void Promise.all(scenes.map(s => this.load(s, reg, assets))).then(passes => {
        this.passes = passes;
        this.loaded = true;
        if (this.disposed) this.dispose();
      }, failed);
    };
  }

  /** Starts the load on first use; true once the scenes can be posed. */
  ready(): boolean {
    if (this.start) {
      const start = this.start;
      this.start = null;
      start();
    }
    return this.loaded;
  }

  private async load(record: ShipScene, reg: Registries, assets: AssetCache): Promise<ScenePass> {
    const model = reg.models.get(record.model);
    if (!model) throw new Error(`ship: missing model ${record.model}`);
    const loaded = await assets.model(model.gltf);
    const root = clone(loaded.scene);
    const scene = new THREE.Scene();
    scene.name = `ship:${record.model}`;
    scene.add(root);
    const cam = record.camera;
    const camera = new THREE.PerspectiveCamera(cam.fovY, 4 / 3, cam.near, cam.far);
    camera.position.set(...cam.position);
    camera.lookAt(...cam.target);
    const materials: THREE.ShaderMaterial[] = [];
    const textures = new Map<string, THREE.Texture>();
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      if (src.map) textures.set(`base:${src.name}`, src.map);
      const ex = src.userData.lantern as { alpha: number; lights: number; lit: boolean; polygonId: number; cull: 'back' | 'front' | 'none'; projectionMap?: boolean };
      const animatedAlpha = record.colors.some(a => a.materials.some(m => m.material === src.name));
      const transparent = src.transparent || ex.alpha < 31 || animatedAlpha;
      const material = fieldOutputs(new THREE.ShaderMaterial({
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
        uniforms: {
          map: { value: src.map ? pixelTexture(src.map) : null }, hasMap: { value: src.map ? 1 : 0 },
          opacity: { value: ex.alpha / 31 }, actorAlpha: { value: 1 }, projectionMap: { value: ex.projectionMap ? 1 : 0 }, uvMatrix: { value: new THREE.Matrix3() },
          lightDir: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
          lightColor: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
          lightMask: { value: new THREE.Vector4(...[0, 1, 2, 3].map(i => (ex.lights >> i) & 1)) },
          lit: { value: ex.lit ? 1 : 0 },
          diffuse: { value: new THREE.Vector3() }, ambient: { value: new THREE.Vector3() },
          specular: { value: new THREE.Vector3() }, emission: { value: new THREE.Vector3() },
        },
        side: { back: THREE.FrontSide, front: THREE.BackSide, none: THREE.DoubleSide }[ex.cull],
        transparent, depthWrite: !transparent,
      }), { polygonId: ex.polygonId, fog: false });
      material.name = src.name;
      mesh.material = material;
      // Authored joints move beyond the rest-pose bounds.
      mesh.frustumCulled = false;
      materials.push(material);
    });
    await Promise.all(record.patterns.flatMap(a => a.materials.flatMap(m => m.keys.map(async k => textures.set(k.image, await assets.texture(k.image))))));
    const clip = record.clip === '' ? new THREE.AnimationClip('static', 0, []) : loaded.animations.find(a => a.name === record.clip);
    if (!clip) throw new Error(`ship: missing clip ${record.clip}`);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    return { root, scene, camera, mixer, action, record, materials, textures };
  }

  pose(view: ShipSceneView, aspect: number, light: LightTemplate): ScenePass | null {
    if (!this.ready()) return null;
    const p = this.passes[view.direction];
    if (!p) throw new Error(`ship: no scene for direction ${view.direction}`);
    const frame = (frames: number) => p.record.loop ? Math.floor(view.tick) % frames : Math.min(Math.floor(view.tick), frames - 1);
    const tick = p.record.loop ? view.tick % p.record.frames : Math.min(view.tick, p.record.frames - 1);
    // LoopOnce pauses at the endpoint. Re-enable before seeking (also on a repeated trip).
    p.action.paused = false;
    p.action.enabled = true;
    p.mixer.setTime(tick / 30);
    const visibility = p.record.visibility?.[Math.floor(tick)];
    if (visibility) p.root.traverse(o => {
      const index = (o.userData.lantern as { visibilityNode?: number } | undefined)?.visibilityNode;
      if (index !== undefined) {
        // A hidden joint's own mesh is hidden; child joint transforms still evaluate independently.
        if ((o as THREE.Mesh).isMesh) o.visible = visibility[index]!;
      }
    });
    p.camera.aspect = aspect;
    // Preserve the complete DS frame on phones and wide screens, independent of field zoom.
    p.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.record.camera.fovY / 2)) * Math.max(1, (4 / 3) / aspect)));
    p.camera.updateProjectionMatrix();
    for (const material of p.materials) {
      const u = material.uniforms;
      for (const key of ['diffuse', 'ambient', 'specular', 'emission'] as const) (u[key]!.value as THREE.Vector3).set(...light[key]);
      for (let i = 0; i < 4; i++) {
        (u.lightDir!.value as THREE.Vector3[])[i]!.set(...(light.lights[i]?.direction ?? [0, 0, 0]));
        (u.lightColor!.value as THREE.Vector3[])[i]!.set(...(light.lights[i]?.color ?? [0, 0, 0]));
      }
      for (const a of p.record.colors) {
        const m = a.materials.find(m => m.material === material.name);
        if (!m) continue;
        const t = frame(a.frames);
        for (const key of ['diffuse', 'ambient', 'specular', 'emission'] as const) u[key]!.value = rgb(at(m[key], t));
        u.opacity!.value = at(m.alpha, t) / 31;
      }
      for (const a of p.record.srt) {
        const m = a.materials.find(m => m.material === material.name);
        if (!m) continue;
        const t = frame(a.frames);
        const rotation = m.rotationFrames?.[t] ?? m.rotation;
        (u.uvMatrix!.value as THREE.Matrix3).setUvTransform(at(m.translateS, t), at(m.translateT, t), at(m.scaleS, t), at(m.scaleT, t), Math.atan2(rotation[0], rotation[1]), 0, 0);
      }
      for (const a of p.record.patterns) {
        const m = a.materials.find(m => m.material === material.name);
        if (!m) continue;
        const t = frame(a.frames);
        const key = m.keys.filter(k => k.frame <= t).at(-1)!;
        u.map!.value = p.textures.get(key.image)!;
        u.hasMap!.value = 1;
      }
    }
    return p;
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.passes) {
      p.mixer.stopAllAction();
      for (const m of p.materials) m.dispose();
      p.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      for (const texture of new Set(p.textures.values())) texture.dispose();
      p.scene.clear();
    }
    this.passes = [];
  }
}

/** The child application fades in while animating, then holds its final frame during fade-out. */
export function shipFade(tick: number, frames: number): number {
  return Math.max(0, 1 - tick / 6, Math.min(1, (tick - frames) / 6));
}
