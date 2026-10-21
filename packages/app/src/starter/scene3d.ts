/**
 * The starter scene's 3D (decomp choose_starter_app.c Make3DGraphics, SetupCamera, StartCameraMovement):
 * the grass floor, the briefcase (its opening clip, then the open model) and the three balls, lit by one
 * white light pointing into the screen. The DS's 256×192 view maps onto a rect of the page (`ds`); the
 * canvas covers the whole scene, so the floor runs on past the DS frame (full bleed). Drawn at DS-pixel
 * size and upscaled crisply.
 */
import * as THREE from 'three';
import type { AssetSource, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { AssetCache } from '@opensinnoh/render';
import { dsMaterials } from '../title/model3d.ts';
import type { Rect } from './layout.ts';

/** Ball positions on the open briefcase (MakeSelectionMatrices). */
export const BALL_POSITIONS: readonly [number, number, number][] = [
  [-44, -4, 32],
  [0, -4, 62],
  [38, -4, 26],
];
/** SetupCamera / StartCameraMovement: pitch (deg), distance and target z, before and after the 6-frame move. */
const CAMERA = { from: { pitch: -30, distance: 300, z: 0 }, to: { pitch: -50, distance: 200, z: 36 } };
/** The FOV index (22°) is the half angle, as for the title camera. */
const FOV_Y = 44;
const FLOOR = { position: [0, -28, 40] as const, scale: [3.5, 1, 3.5] as const, rotationY: Math.PI };
/** Clips are sampled at the DS frame rate. */
const FPS = 30;

export const modelId = (ns: string, name: string): Id => `${ns}:MODEL_CHOOSE_STARTER_${name}` as Id;

interface Part {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  /** Clip length in frames; 0 without a clip. */
  frames: number;
}

/** Camera position for a progress `t` (0..1) of the move, with the DS's integer steps. */
export function cameraPose(t: number): { position: [number, number, number]; target: [number, number, number] } {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const pitch = THREE.MathUtils.degToRad(lerp(CAMERA.from.pitch, CAMERA.to.pitch));
  const d = lerp(CAMERA.from.distance, CAMERA.to.distance);
  const z = lerp(CAMERA.from.z, CAMERA.to.z);
  // Camera_SetAngleAroundTarget: the camera sits at target + (0, sin(−pitch)·d, cos(pitch)·d).
  return { position: [0, Math.sin(-pitch) * d, z + Math.cos(pitch) * d], target: [0, 0, z] };
}

/** The top-left texel of the first textured material (the floor's outer grass). */
function cornerColour(root: THREE.Object3D): string {
  let image: CanvasImageSource | null = null;
  root.traverse((o) => {
    const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map;
    if (!image && map?.image) image = map.image as CanvasImageSource;
  });
  if (!image) throw new Error('starter scene: the floor has no texture');
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r} ${g} ${b})`;
}

export class StarterScene3d {
  readonly canvas: HTMLCanvasElement;
  readonly bagFrames: number;
  /** CSS colour of the floor texture's corner: the backdrop around the floor, so it runs on without a seam. */
  floorEdge = '';
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV_Y, 4 / 3, 10, 2000);
  private size = { width: 1, height: 1, k: 1, ds: { x: 0, y: 0, width: 256, height: 192 } as Rect };

  private constructor(
    private readonly bag: Part,
    private readonly bagOpen: Part,
    private readonly balls: Part[],
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'starter-3d';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.bagFrames = bag.frames;
  }

  static async load(assets: AssetSource, registries: Registries, ns: string): Promise<StarterScene3d> {
    const cache = new AssetCache(assets);
    // DrawScene: one global light pointing into the screen, white.
    const lights = { dir: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, -1)), color: [0, 1, 2, 3].map((i) => new THREE.Vector3(i === 0 ? 1 : 0, i === 0 ? 1 : 0, i === 0 ? 1 : 0)) };
    let floorEdge = '';
    const part = async (name: string): Promise<Part> => {
      const record = registries.models.get(modelId(ns, name));
      if (!record) throw new Error(`starter scene: no model ${modelId(ns, name)}`);
      const loaded = await cache.model(record.gltf);
      if (name === 'FLOOR') floorEdge = cornerColour(loaded.scene);
      dsMaterials(loaded.scene, lights, 1);
      const root = new THREE.Group();
      root.add(loaded.scene);
      const mixer = new THREE.AnimationMixer(loaded.scene);
      const clip = loaded.animations[0];
      if (clip) mixer.clipAction(clip).play();
      return { root, mixer, frames: clip ? Math.round(clip.duration * FPS) : 0 };
    };
    const [floor, bag, bagOpen, ...balls] = await Promise.all(['FLOOR', 'BRIEFCASE', 'BRIEFCASE_OPEN', 'BALL_0', 'BALL_1', 'BALL_2'].map(part));
    const s = new StarterScene3d(bag!, bagOpen!, balls);
    s.floorEdge = floorEdge;
    floor!.root.position.set(...FLOOR.position);
    floor!.root.scale.set(...FLOOR.scale);
    floor!.root.rotation.y = FLOOR.rotationY;
    balls.forEach((b, i) => b.root.position.set(...BALL_POSITIONS[i]!));
    for (const p of [floor!, bag!, bagOpen!, ...balls]) s.scene.add(p.root);
    return s;
  }

  /** Canvas of `width`×`height` CSS px at `k` CSS px per 3D pixel; the DS view maps onto `ds` (CSS px, scene-relative). */
  resize(width: number, height: number, k: number, ds: Rect): void {
    this.size = { width, height, k, ds };
    const w = Math.max(1, Math.round(width / k));
    const h = Math.max(1, Math.round(height / k));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${(w * k)}px`;
    this.canvas.style.height = `${(h * k)}px`;
    // The DS frustum (4:3) is the "full" view; the canvas is a window onto it that may reach past it.
    this.camera.aspect = 4 / 3;
    this.camera.setViewOffset(ds.width / k, ds.height / k, -ds.x / k, -ds.y / k, w, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * `bagFrame`: the opening clip's frame, or null once open (open model and balls shown); `camera`: the
   * move's progress (0..1); `selected`: the ball that wobbles (its clip at `ballFrame`), others at rest.
   */
  render(s: { bagFrame: number | null; camera: number; selected: number | null; ballFrame: number }): void {
    const open = s.bagFrame === null;
    this.bag.root.visible = !open;
    if (!open) this.bag.mixer.setTime(Math.min(s.bagFrame!, this.bag.frames) / FPS);
    this.bagOpen.root.visible = open;
    this.balls.forEach((b, i) => {
      b.root.visible = open;
      b.mixer.setTime(i === s.selected && b.frames ? (s.ballFrame % b.frames) / FPS : 0);
    });
    const pose = cameraPose(s.camera);
    this.camera.position.set(...pose.position);
    this.camera.lookAt(...pose.target);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a world point lands in DS pixels of the 256×192 view, at the final camera. */
  static toDs(point: readonly [number, number, number]): { x: number; y: number } {
    const cam = new THREE.PerspectiveCamera(FOV_Y, 4 / 3, 10, 2000);
    const pose = cameraPose(1);
    cam.position.set(...pose.position);
    cam.lookAt(...pose.target);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3(...point).project(cam);
    return { x: ((v.x + 1) / 2) * 256, y: ((1 - v.y) / 2) * 192 };
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
