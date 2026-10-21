import * as THREE from 'three';
import type { AssetSource, NewGame, Registries } from '@opensinnoh/contracts';
import { AssetCache, disposeTree, pixelTexture } from './assets.ts';
import { dsVertexLight, type LightTemplate, type Vec3 } from './lighting.ts';

export type Ride = 'morning' | 'day' | 'night';
type Data = NonNullable<NewGame['creditsRide']>;
type Row = Data['rows'][number][number];
const PERIODS: Ride[] = ['morning', 'day', 'night'];
const rgb = (r: number, g = r, b = r): [number, number, number] => [r / 31, g / 31, b / 31];

/** Integer FX32 movement, including independent per-axis truncation and wrap at the front plane. */
export function creditsPlacement(row: Row, index: number, frame: number): { position: [number, number, number]; wraps: number } {
  const step = row.spacing.map(s => Math.trunc(s * row.count / row.speed));
  const wraps = frame === 0 ? 0 : Math.max(0, Math.floor((frame * step[0]! - index * row.spacing[0]) / (row.spacing[0] * row.count)) + 1);
  return {
    position: row.start.map((start, axis) => (start - index * row.spacing[axis]! + frame * step[axis]! - wraps * row.count * row.spacing[axis]!) / 4096) as [number, number, number],
    wraps,
  };
}

/** The night sequence advances on a wrap in either row (simultaneous wraps count once). */
export function creditsTreeOrdinal(rows: Row[], index: number, wraps: number): number {
  if (!wraps) return index;
  const near = rows[0]!;
  const step = Math.trunc(near.spacing[0] * near.count / near.speed);
  const last = Math.floor((index + (wraps - 1) * near.count) * near.spacing[0] / step) + 1;
  const events = new Set<number>();
  for (const row of rows) {
    if (!row.count) continue;
    const dx = Math.trunc(row.spacing[0] * row.count / row.speed);
    for (let j = 0; ; j++) {
      const at = Math.floor(j * row.spacing[0] / dx) + 1;
      if (at >= last) break;
      events.add(at);
    }
  }
  return 16 + events.size;
}

/** Fixed view-space lights from EndCredits_Draw3DModels; the night lamp retains its material colours. */
function lighting(ride: Ride): LightTemplate {
  const night = ride === 'night';
  const day = ride === 'day';
  return {
    lights: [
      { direction: (day ? [-2043, -3548, 110] : [1897, -3600, -466]).map(v => v / 4096) as [number, number, number], color: day ? rgb(22, 22, 20) : night ? rgb(11, 11, 16) : rgb(28, 12, 6) },
      null, { direction: [0, 0, 1], color: [0, 0, 0] }, { direction: [0, -1, 0], color: rgb(28) },
    ],
    diffuse: night ? rgb(14, 14, 16) : rgb(15),
    ambient: day ? rgb(9, 11, 11) : night ? rgb(10) : rgb(11, 12, 12),
    specular: day ? rgb(16) : night ? rgb(14, 14, 16) : rgb(17),
    emission: day ? rgb(14) : night ? rgb(8, 8, 11) : rgb(8, 8, 7),
  };
}

/** A 256×192 transparent pass, copied into the credits' single canvas before its OBJ sprites/text. */
export class CreditsScenery {
  readonly canvas = document.createElement('canvas');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly assets: AssetCache;
  private readonly camera = new THREE.PerspectiveCamera(2 * Math.trunc(22 * 65535 / 360) * 360 / 65536, 4 / 3, 1, 900);
  private readonly scene = new THREE.Scene();
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly objects = new Map<string, THREE.Object3D>();
  private disposed = false;
  ready = false;

  constructor(private readonly data: Data, reg: Registries, source: AssetSource, redraw: () => void) {
    this.assets = new AssetCache(source);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false });
    this.renderer.setSize(256, 192, false);
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera.position.set(-31712 / 4096, -142304 / 4096, 496744 / 4096);
    this.camera.lookAt(-31712 / 4096, -67780 / 4096, -5704 / 4096);
    this.camera.updateMatrixWorld();
    void Promise.all(data.models.map(async (id, i) => {
      const model = reg.models.get(id);
      if (!model) throw new Error(`credits: missing model ${id}`);
      const loaded = await this.assets.model(model.gltf);
      for (const period of PERIODS) {
        const root = loaded.scene.clone(true);
        root.updateMatrixWorld(true);
        root.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const src = mesh.material as THREE.MeshStandardMaterial;
          if (src.map) pixelTexture(src.map);
          const ex = src.userData.lantern as { lit: boolean; lights: number; alpha: number; cull: 'back' | 'front' | 'none'; diffuse: Vec3; ambient: Vec3; specular: Vec3; emission: Vec3 };
          mesh.geometry = mesh.geometry.clone();
          if (ex.lit) {
            const light = lighting(period);
            if (i === 1) for (const k of ['diffuse', 'ambient', 'specular', 'emission'] as const) light[k] = ex[k];
            const normal = mesh.geometry.getAttribute('normal');
            const matrix = new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.matrixWorldInverse, mesh.matrixWorld));
            const vector = new THREE.Vector3();
            const colors = new Float32Array(normal.count * 3);
            for (let n = 0; n < normal.count; n++) {
              vector.fromBufferAttribute(normal, n).applyMatrix3(matrix).normalize();
              colors.set(dsVertexLight([vector.x, vector.y, vector.z], ex.lights, light), n * 3);
            }
            mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          }
          mesh.material = new THREE.MeshBasicMaterial({ map: src.map, vertexColors: !!mesh.geometry.getAttribute('color'), color: src.color, opacity: ex.alpha / 31, transparent: src.transparent || ex.alpha < 31, alphaTest: src.alphaTest, side: { back: THREE.FrontSide, front: THREE.BackSide, none: THREE.DoubleSide }[ex.cull] });
        });
        this.templates.set(`${period}:${i}`, root);
      }
    })).then(() => {
      if (this.disposed) { this.dispose(); return; }
      this.ready = true;
      redraw();
    });
  }

  draw(ride: Ride, frame: number): void {
    if (!this.ready) return;
    this.scene.clear();
    const rows = this.data.rows[PERIODS.indexOf(ride)]!;
    rows.forEach((row, r) => {
      for (let i = 0; i < row.count; i++) {
        const p = creditsPlacement(row, i, frame);
        let model = ride === 'morning' ? 2 + r : ride === 'day' ? 0 : 6;
        if (ride === 'night' && r === 0) {
          const ordinal = creditsTreeOrdinal(rows, i, p.wraps);
          model = ordinal % 8 === 0 ? 1 : (this.data.nightTrees[ordinal] ?? 1) === 1 ? 5 : 4;
        }
        const key = `${ride}:${r}:${i}:${model}`;
        let object = this.objects.get(key);
        if (!object) { object = this.templates.get(`${ride}:${model}`)!.clone(true); this.objects.set(key, object); }
        object.position.set(...p.position);
        this.scene.add(object);
      }
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    for (const t of this.templates.values()) disposeTree(t);
    this.templates.clear();
    this.objects.clear();
    this.scene.clear();
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
