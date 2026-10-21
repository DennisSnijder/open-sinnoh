/**
 * The title screen's 3D: the model (Giratina on the ROM) and, behind it with its own camera, the
 * background scene (the intro's portal). Each is a glTF with its loop clip and texture scrolls, lit per
 * vertex with the DS formula (emission + Σ light × (diffuse · max(0, −L·N) + ambient), clamped) from
 * its record's lights. One full-frame canvas, drawn at DS-pixel size and upscaled crisply.
 */
import * as THREE from 'three';
import type { AssetSource, TitleModel } from '@opensinnoh/contracts';
import { AssetCache } from '@opensinnoh/render';

interface OpenSinnohExtras {
  alpha?: number;
  cull?: 'back' | 'front' | 'none';
  lit?: boolean;
  lights?: number;
  diffuse?: [number, number, number];
  ambient?: [number, number, number];
  emission?: [number, number, number];
}

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform vec3 lightDir[4];
uniform vec3 lightColor[4];
uniform float lightMask[4];
uniform vec3 diffuse;
uniform vec3 ambient;
uniform vec3 emission;
uniform float lit;
uniform vec2 uvOffset;
varying vec3 vColor;
varying vec2 vUv;
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
    vec3 l = normalize((viewMatrix * vec4(lightDir[i], 0.0)).xyz);
    c += lightMask[i] * lightColor[i] * (diffuse * max(0.0, -dot(l, n)) + ambient);
  }
  vColor = lit > 0.5 ? min(c, vec3(1.0)) : vec3(1.0);
  vUv = uv + uvOffset;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float hasMap;
uniform vec3 color;
uniform float opacity;
uniform float alphaTest;
uniform float shade;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vec4 t = hasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
  if (t.a < alphaTest) discard;
  gl_FragColor = vec4(t.rgb * color * vColor * shade, t.a * opacity);
}`;

const SIDES = { back: THREE.FrontSide, front: THREE.BackSide, none: THREE.DoubleSide } as const;

type Scroll = NonNullable<TitleModel['scroll']>[number];

/**
 * Replaces every mesh material of a converted DS model (or a flat-coloured fixture model) with the DS
 * vertex-lighting shader: texture × base colour × (emission + Σ light × (diffuse · max(0, −L·N) + ambient)),
 * from the material's `extras.lantern`. `lights` are shared vectors.
 */
export function dsMaterials(
  root: THREE.Object3D,
  lights: { dir: THREE.Vector3[]; color: THREE.Vector3[] },
  shade: number,
  onMaterial: (material: THREE.ShaderMaterial, src: THREE.MeshStandardMaterial) => void = () => {},
): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const ex = (src.userData.lantern ?? {}) as OpenSinnohExtras;
    const map = src.map;
    if (map) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.generateMipmaps = false;
      map.colorSpace = THREE.NoColorSpace;
      map.needsUpdate = true;
    }
    const mask = ex.lights ?? 0;
    const alpha = (ex.alpha ?? 31) / 31;
    const blended = src.transparent || alpha < 1;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        map: { value: map },
        hasMap: { value: map ? 1 : 0 },
        // glTF base colour (the fixture's flat-coloured model; white on converted DS models).
        color: { value: src.color ? new THREE.Vector3(src.color.r, src.color.g, src.color.b) : new THREE.Vector3(1, 1, 1) },
        opacity: { value: alpha },
        shade: { value: shade },
        alphaTest: { value: src.alphaTest || (blended ? 0.01 : map ? 0.5 : 0) },
        lightDir: { value: lights.dir },
        lightColor: { value: lights.color },
        lightMask: { value: [0, 1, 2, 3].map((i) => (mask >> i) & 1) },
        diffuse: { value: new THREE.Vector3(...(ex.diffuse ?? [1, 1, 1])) },
        ambient: { value: new THREE.Vector3(...(ex.ambient ?? [0, 0, 0])) },
        emission: { value: new THREE.Vector3(...(ex.emission ?? [0, 0, 0])) },
        lit: { value: ex.lit ? 1 : 0 },
        uvOffset: { value: new THREE.Vector2() },
      },
      side: ex.cull ? SIDES[ex.cull] : src.side,
      transparent: blended,
      depthWrite: !blended,
    });
    material.name = src.name;
    onMaterial(material, src);
    mesh.material = material;
    mesh.frustumCulled = false;
  });
}

/** One model with its camera, clip, scrolls and lights. */
class Pass {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly materials: { material: THREE.ShaderMaterial; scroll?: Scroll }[] = [];
  private readonly duration: number;
  private readonly hfov4x3: number;

  /** `shade` darkens the whole pass (the background sits back behind the model). */
  constructor(
    private readonly record: TitleModel,
    loaded: { scene: THREE.Group; animations: THREE.AnimationClip[] },
    shade: number,
  ) {
    const cam = record.camera;
    this.camera = new THREE.PerspectiveCamera(cam.fovY, 4 / 3, cam.near, cam.far);
    this.camera.position.set(...cam.position);
    this.camera.lookAt(...cam.target);
    this.hfov4x3 = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fovY / 2)) * (4 / 3));
    const lights = record.lights.slice(0, 4);
    const lightColor = [0, 1, 2, 3].map((i) => new THREE.Vector3(...(lights[i]?.color ?? [0, 0, 0])));
    const lightDir = [0, 1, 2, 3].map((i) => new THREE.Vector3(...(lights[i]?.direction ?? [0, 0, -1])));
    this.root.add(loaded.scene);
    this.scene.add(this.root);
    dsMaterials(loaded.scene, { dir: lightDir, color: lightColor }, shade, (material, src) => {
      const scroll = record.scroll?.find((sc) => sc.material === src.name);
      this.materials.push(scroll ? { material, scroll } : { material });
    });
    this.mixer = new THREE.AnimationMixer(loaded.scene);
    const clip = record.clip ? loaded.animations.find((a) => a.name === record.clip) : undefined;
    if (record.clip && !clip) throw new Error(`title model: no clip ${record.clip}`);
    this.duration = clip?.duration ?? 0;
    if (clip) this.mixer.clipAction(clip).play();
  }

  /** The frame's size (DS px), how far to raise the picture (share of the height) and how far to pull back (FOV factor). */
  frame(width: number, height: number, lift: number, zoom: number): void {
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Keep at least the DS's 4:3 horizontal view on narrow screens (the wings stay in frame).
    const vfovForH = 2 * Math.atan(Math.tan(this.hfov4x3 / 2) / aspect);
    this.camera.fov = Math.max(this.record.camera.fovY, THREE.MathUtils.radToDeg(vfovForH)) * zoom;
    if (lift) this.camera.setViewOffset(width, height, 0, Math.round(lift * height), width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Clip and scrolls at DS frame `frame`, hover `y`. */
  pose(frame: number, y: number): void {
    if (this.duration) this.mixer.setTime((frame / 30) % this.duration);
    for (const { material, scroll } of this.materials) {
      if (!scroll) continue;
      const i = frame % scroll.frames;
      const at = (v: number[] | number) => (typeof v === 'number' ? v : v[i]!);
      (material.uniforms.uvOffset!.value as THREE.Vector2).set(at(scroll.translateS), at(scroll.translateT));
    }
    this.root.position.y = y;
  }
}

export interface TitleScene3dParts {
  model?: { record: TitleModel; gltf: string };
  background?: { record: TitleModel; gltf: string };
}

export class TitleScene3d {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;

  private constructor(
    private readonly model: Pass | null,
    private readonly background: Pass | null,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'title-3d';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
  }

  static async load(parts: TitleScene3dParts, assets: AssetSource): Promise<TitleScene3d> {
    const cache = new AssetCache(assets);
    const load = async (p: TitleScene3dParts['model'], shade: number) => (p ? new Pass(p.record, await cache.model(p.gltf as never), shade) : null);
    const [model, background] = await Promise.all([load(parts.model, 1), load(parts.background, 0.45)]);
    return new TitleScene3d(model, background);
  }

  /** CSS size and DS-pixel scale (drawn at width/scale × height/scale); `lift` raises and `zoom` pulls back the model's picture. */
  resize(width: number, height: number, scale: number, lift: number, zoom: number): void {
    const w = Math.max(1, Math.round(width / scale));
    const h = Math.max(1, Math.round(height / scale));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.model?.frame(w, h, lift, zoom);
    this.background?.frame(w, h, 0, 1);
  }

  /** Both passes at DS frame `frame`, the model hovering at `y`. */
  render(frame: number, y: number): void {
    this.renderer.clear();
    if (this.background) {
      this.background.pose(frame, 0);
      this.renderer.render(this.background.scene, this.background.camera);
      this.renderer.clearDepth();
    }
    if (this.model) {
      this.model.pose(frame, y);
      this.renderer.render(this.model.scene, this.model.camera);
    }
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
