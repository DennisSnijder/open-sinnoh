import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetRef, AssetSource } from '@opensinnoh/contracts';

/** Splits `<pack>:<path>`. */
export function splitRef(ref: AssetRef): { pack: string; path: string } {
  const i = ref.indexOf(':');
  return { pack: ref.slice(0, i), path: ref.slice(i + 1) };
}

/** Resolves a relative URI against a pack path's directory (`models/a.gltf` + `../t.png` → `t.png`). */
export function resolvePackPath(base: string, uri: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const seg of uri.split('/')) {
    if (seg === '..') {
      if (parts.length === 0) throw new Error(`asset path ${uri} escapes its pack (from ${base})`);
      parts.pop();
    } else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Pixel-art texture setup: nearest filtering, no mipmaps, glTF UV convention (no flip), and no colour
 * space: the renderer works on display values like the DS (no sRGB decode or encode).
 */
export function pixelTexture(t: THREE.Texture): THREE.Texture {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Frees the GPU side of everything under `root`: geometries, materials and the textures they use. For a Field
 * that is going away (a remount keeps the canvas's WebGLRenderer, so nothing else frees them); shared objects
 * disposed twice are harmless.
 */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (!mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) if ((u.value as THREE.Texture | null)?.isTexture) (u.value as THREE.Texture).dispose();
      m.dispose();
    }
  });
}

/** A parsed glTF: its scene and animation clips. */
export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/**
 * Models whose geometry is copied out at each use (land chunks) stay parsed for this many of the latest: a map visited
 * again (out of a house, back into the town) builds without reading them from storage again, which took 60–400 ms each.
 */
const KEPT_COPIED_MODELS = 32;

/** Loads PNGs and glTF models from an AssetSource, caching by ref. */
export class AssetCache {
  private textures = new Map<AssetRef, Promise<THREE.Texture>>();
  private models = new Map<AssetRef, Promise<LoadedModel>>();
  /** The copied models (`copied`), least recently used first. */
  private copiedModels: AssetRef[] = [];
  private sets = new Map<AssetRef, Promise<ReadonlySet<string>>>();

  constructor(private readonly source: AssetSource) {}

  texture(ref: AssetRef): Promise<THREE.Texture> {
    let p = this.textures.get(ref);
    if (!p) {
      p = this.source
        .get(ref)
        .then((blob) => createImageBitmap(blob, { premultiplyAlpha: 'none' }))
        .then((bmp) => {
          const t = pixelTexture(new THREE.Texture(bmp));
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
          t.name = ref;
          return t;
        });
      this.textures.set(ref, p);
    }
    return p;
  }

  /** glTF scene and clips; external buffers and images are read through the AssetSource as blob URLs. */
  model(ref: AssetRef): Promise<LoadedModel> {
    let p = this.models.get(ref);
    if (!p) {
      p = this.loadGltf(ref);
      this.models.set(ref, p);
    }
    return p;
  }

  /** The `<texture>__<palette>` names a texture set lists (`<set dir>/index.json`). */
  textureSet(set: AssetRef): Promise<ReadonlySet<string>> {
    let p = this.sets.get(set);
    if (!p) {
      p = this.source
        .get(`${set}/index.json`)
        .then((b) => b.text())
        .then((text) => {
          const list = JSON.parse(text) as unknown;
          if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) throw new Error(`texture set ${set}: index.json is not a list of names`);
          return new Set(list as string[]);
        });
      this.sets.set(set, p);
    }
    return p;
  }

  /** Frees every cached texture and model on the GPU (the Field that owns the cache is going away). */
  dispose(): void {
    for (const p of this.textures.values()) void p.then((t) => t.dispose(), () => {});
    for (const p of this.models.values()) void p.then((m) => disposeTree(m.scene), () => {});
  }

  /**
   * A model whose geometry was copied (land chunks: copied into the chunk) is kept only among the latest
   * KEPT_COPIED_MODELS; the oldest is dropped.
   */
  copied(ref: AssetRef): void {
    this.copiedModels = [...this.copiedModels.filter((r) => r !== ref), ref];
    if (this.copiedModels.length > KEPT_COPIED_MODELS) this.models.delete(this.copiedModels.shift()!);
  }

  /** Cached parsed models and textures (for memory reports). */
  sizes(): { models: number; textures: number } {
    return { models: this.models.size, textures: this.textures.size };
  }

  private async loadGltf(ref: AssetRef): Promise<LoadedModel> {
    const { pack, path } = splitRef(ref);
    const json = JSON.parse(await (await this.source.get(ref)).text()) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    const urls: string[] = [];
    const rewrite = async (item: { uri?: string }) => {
      if (!item.uri || item.uri.startsWith('data:')) return;
      const blob = await this.source.get(`${pack}:${resolvePackPath(path, decodeURIComponent(item.uri))}`);
      item.uri = URL.createObjectURL(blob);
      urls.push(item.uri);
    };
    await Promise.all([...(json.buffers ?? []), ...(json.images ?? [])].map(rewrite));
    try {
      const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
      return { scene: gltf.scene, animations: gltf.animations };
    } finally {
      for (const u of urls) URL.revokeObjectURL(u);
    }
  }
}
