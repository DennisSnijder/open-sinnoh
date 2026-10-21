import * as THREE from 'three';
import type { Registries, SpearPillarAssets, StorySceneView } from '@opensinnoh/contracts';
import { Ships } from './ships.ts';
import type { AssetCache } from './assets.ts';
import type { LightTemplate } from './lighting.ts';

/** Shares the ROM-model/material posing path with ships; the authoritative scene view owns the clock. */
export class StoryScenes {
  private readonly models: Ships;
  private readonly data: SpearPillarAssets | undefined;
  private readonly keys: string[];
  private readonly indices = new Map<string, number>();
  private readonly backgrounds = new Map<string, THREE.Texture>();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private pendingBackgrounds = false;
  private startBackgrounds: (() => void) | null = null;
  private readonly backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 v; void main(){v=uv;gl_Position=vec4(position.xy,0.9999,1.0);}',
      fragmentShader:
        'uniform sampler2D map; uniform float tick, amplitude; varying vec2 v; void main(){vec2 uv=v;uv.y += sin(v.y*192.0/8.0+tick*.1)*amplitude/192.0;gl_FragColor=texture2D(map,uv);}',
      uniforms: { map: { value: null }, tick: { value: 0 }, amplitude: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    }),
  );
  private previous: THREE.FramebufferTexture | null = null;
  private captureTick = -1;
  private readonly feedbackScene = new THREE.Scene();
  private readonly feedbackCamera = new THREE.Camera();
  private readonly feedbackMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.75,
    depthTest: false,
    depthWrite: false,
  });
  constructor(reg: Registries, assets: AssetCache, failed: (e: unknown) => void) {
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -10000;
    this.feedbackScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.feedbackMaterial));
    this.data = [...reg.newGame.values()][0]?.spearPillar;
    this.keys = Object.keys(this.data?.models ?? {});
    // Two placements of the summoning and replacement models are alive together.
    const records = this.keys.flatMap((k) => {
      this.indices.set(
        k,
        [...this.indices.keys()].reduce((n, key) => n + (key === '65' ? 4 : 2), 0),
      );
      return Array.from({ length: k === '65' ? 4 : 2 }, () => this.data!.models[k]!);
    });
    this.models = new Ships(reg, assets, failed, records);
    const data = this.data;
    if (data) {
      this.startBackgrounds = () => {
        this.pendingBackgrounds = true;
        void Promise.all(
          Object.entries(data.backgrounds).map(async ([k, id]) => this.backgrounds.set(k, await assets.texture(id))),
        ).then(() => {
          this.pendingBackgrounds = false;
        }, failed);
      };
    }
  }
  /** Starts the load on first use (as Ships); true once the scenes can be posed. */
  ready(): boolean {
    if (this.startBackgrounds) {
      const start = this.startBackgrounds;
      this.startBackgrounds = null;
      start();
    }
    return this.models.ready() && !this.pendingBackgrounds;
  }
  pose(view: StorySceneView, aspect: number, light: LightTemplate): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null {
    if (!this.ready()) return null;
    this.scene.clear();
    this.scene.background = null;
    if (view.background) {
      const u = this.backdrop.material.uniforms;
      u.map!.value = this.backgrounds.get(view.background)!;
      u.tick!.value = view.tick;
      u.amplitude!.value = view.scanline ?? 0;
      this.scene.add(this.backdrop);
    }
    const instances = new Map<string, number>();
    for (const a of view.actors) {
      const n = instances.get(a.asset) ?? 0;
      instances.set(a.asset, n + 1);
      if (n >= (a.asset === '65' ? 4 : 2)) throw new Error(`story: too many instances of ${a.asset}`);
      const key = this.indices.get(a.asset);
      if (key === undefined) throw new Error(`story: missing asset ${a.asset}`);
      const p = this.models.pose({ direction: key + n, tick: a.tick, frames: this.data!.models[a.asset]!.frames }, aspect, light);
      if (!p) return null;
      p.root.position.set(...a.position);
      p.root.scale.set(...(a.scale ?? [1, 1, 1]));
      const r = a.rotation ?? [0, 0, 0];
      p.root.rotation.set(...(r.map((v) => (v * Math.PI) / 180) as [number, number, number]));
      for (const m of p.materials) m.uniforms.actorAlpha!.value = a.alpha ?? 1;
      this.scene.add(p.root);
    }
    if (view.camera) {
      const c = view.camera;
      this.camera.position.set(...c.position);
      this.camera.lookAt(...c.target);
      this.camera.near = c.near;
      this.camera.far = c.far;
      this.camera.aspect = aspect;
      this.camera.fov = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(c.fovY / 2)) * Math.max(1, 4 / 3 / aspect)),
      );
      this.camera.updateProjectionMatrix();
    }
    return { scene: this.scene, camera: this.camera };
  }
  feedback(renderer: THREE.WebGLRenderer, view: StorySceneView): void {
    if (!view.feedback) {
      this.captureTick = -1;
      return;
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.previous || this.previous.image.width !== size.x || this.previous.image.height !== size.y) {
      this.previous?.dispose();
      this.previous = new THREE.FramebufferTexture(size.x, size.y);
      this.captureTick = -1;
    }
    if (this.captureTick >= 0 && view.tick >= this.captureTick) {
      this.feedbackMaterial.map = this.previous;
      renderer.render(this.feedbackScene, this.feedbackCamera);
    }
    if (this.captureTick !== view.tick) {
      renderer.copyFramebufferToTexture(this.previous);
      this.captureTick = view.tick;
    }
  }
  dispose(): void {
    this.models.dispose();
    this.scene.clear();
    this.previous?.dispose();
    this.feedbackMaterial.dispose();
    this.backdrop.material.dispose();
    this.backdrop.geometry.dispose();
  }
}
