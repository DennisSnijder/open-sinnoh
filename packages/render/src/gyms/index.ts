import * as THREE from 'three';
import type { Id } from '@opensinnoh/core';
import type { FeatureModelView, FeaturesView } from '@opensinnoh/contracts';
import { fieldOutputs, fogClearing, type FieldOutput } from '../composite.ts';

const DEG = Math.PI / 180;

/**
 * The models a map feature places itself (`FieldView.features.models`; the Eterna Gym clock hands): one
 * object per key and map load, loaded by the renderer's own prop or model path, posed from the view every
 * frame (position interpolated from `prev`, the DS rotation about x, then y, then z, scale). Their animated
 * pieces are ordinary field effects. A light (Hearthome Gym's beams) blends its texels' alpha and clears the
 * fog under it (composite `fogClearing`).
 */
export class FeatureModels {
  private readonly live = new Map<string, { key: string; root: THREE.Object3D | null; mixer?: THREE.AnimationMixer }>();
  private loads = -1;

  constructor(
    private readonly scene: THREE.Scene,
    /** A prop's model with the area's prop textures, lit (the platform lift's path). */
    private readonly loadProp: (prop: Id) => Promise<THREE.Object3D>,
    /** A model with its own textures (the model-object path). */
    private readonly loadModel: (model: Id) => Promise<THREE.Object3D>,
    private readonly failed: (what: string) => (e: unknown) => never,
  ) {}

  update(features: FeaturesView | undefined, loads: number, alpha: number): void {
    if (loads !== this.loads) this.clear(loads);
    const want = new Map((features?.models ?? []).map((m) => [m.key, m]));
    for (const [key, entry] of this.live) {
      if (want.has(key)) continue;
      if (entry.root) this.scene.remove(entry.root);
      this.live.delete(key);
    }
    for (const m of want.values()) {
      let entry = this.live.get(m.key);
      if (!entry) {
        const e: { key: string; root: THREE.Object3D | null } = { key: m.key, root: null };
        entry = e;
        this.live.set(m.key, e);
        const load = m.prop ? this.loadProp(m.prop) : m.model ? this.loadModel(m.model) : Promise.reject(new Error(`feature model ${m.key} names neither a prop nor a model`));
        void load
          .then((root) => {
            if (this.live.get(m.key) !== e) return;
            if (m.light) light(root);
            e.root = root;
            this.scene.add(root);
          })
          .catch(this.failed(`feature model ${m.key}`));
      }
      if (entry.root) {
        place(entry.root, m, alpha);
        if (m.clip) pose(entry, m.clip);
      }
    }
  }

  loading(): boolean {
    for (const e of this.live.values()) if (!e.root) return true;
    return false;
  }

  private clear(loads: number): void {
    for (const e of this.live.values()) if (e.root) this.scene.remove(e.root);
    this.live.clear();
    this.loads = loads;
  }
}

/** A joint clip of the model at a tick (30 Hz; the prop's glTF animation by name). */
function pose(entry: { root: THREE.Object3D | null; mixer?: THREE.AnimationMixer }, clip: { name: string; tick: number }): void {
  const root = entry.root!;
  const animations = (root.userData.animations ?? []) as THREE.AnimationClip[];
  const c = animations.find((a) => a.name === clip.name);
  if (!c) throw new Error(`render: model has no clip ${clip.name}`);
  entry.mixer ??= new THREE.AnimationMixer(root);
  const action = entry.mixer.clipAction(c);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  action.time = clip.tick / 30;
  entry.mixer.update(0);
}

function place(root: THREE.Object3D, m: FeatureModelView, alpha: number): void {
  const prev = m.prev ?? m.position;
  root.position.set(...([0, 1, 2].map((k) => prev[k]! + (m.position[k]! - prev[k]!) * alpha) as [number, number, number]));
  // MTX_Rot33Angles: x first, then y, then z (three's ZYX order).
  root.rotation.set(m.rotation[0] * DEG, m.rotation[1] * DEG, m.rotation[2] * DEG, 'ZYX');
  root.scale.set(...(m.scale ?? [1, 1, 1]));
}

/** A light's own materials: they clear the fog flag where they draw (the beam's a5i3 texels blend as on every map material). */
function light(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshBasicMaterial;
    mesh.material = fogClearing(fieldOutputs(source.clone(), source.userData.fieldOutput as FieldOutput));
  });
}
