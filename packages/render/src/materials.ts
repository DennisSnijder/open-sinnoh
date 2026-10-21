import * as THREE from 'three';
import type { AssetRef, StubLog, TextureAnimation } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { pixelTexture, splitRef, type AssetCache } from './assets.ts';
import { fieldOutputs, translucentId } from './composite.ts';

/**
 * DS material state carried in glTF `materials[].extras.lantern` (contracts records.ts, Model). Every field
 * is optional, so a glTF from Blender without extras renders as a plain model: alpha 31 (opaque), cull from
 * the glTF material side (doubleSided → none, else back), lit false (no DS vertex lighting, colours as
 * exported), the texture from the glTF image, fog false, polygon ID 0 (read by the composite pass:
 * DS fog and edge marking).
 */
interface OpenSinnohExtras {
  alpha?: number;
  cull?: 'back' | 'front' | 'none';
  fog?: boolean;
  lit?: boolean;
  polygonId?: number;
  depthUpdate?: boolean;
  texture?: string;
  palette?: string;
}

const SIDES = { back: THREE.FrontSide, front: THREE.BackSide, none: THREE.DoubleSide } as const;

/**
 * Depth state of a translucent polygon: ties with a coplanar opaque polygon go to the translucent one.
 * Platinum puts translucent overlays in the plane of opaque surfaces: baked prop/object shadows
 * (`h_kage`, 1 unit up) over the white ground patches (`s_snow`, 1 unit up), and the GTS floor
 * shadows (`kage`, alpha 6) in the floor's own plane, which only make sense drawn. No field material
 * sets depth-equal or decal mode. With three.js's less-or-equal test, float rounding made such pairs
 * fight pixel by pixel (the Verity Lakefront sign shadow over the patches). A constant pull forward of
 * 256 depth steps settles it (measured under SwiftShader: 4 and 32 still fought at some sizes, 64 was
 * clean); that is about 0.04 world units at the route camera, under a tenth of the smallest real gap
 * between a translucent and an opaque surface (0.5 units).
 */
export const TRANSLUCENT_DEPTH = (translucent: boolean) => (translucent ? { polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -256 } : {});

/** Which texel alphas a texture holds: 31 (opaque) and 1..30 (translucent), as 8-bit 255 and 1..254. */
interface TexelAlphas {
  opaque: boolean;
  partial: boolean;
}

const scanned = new WeakMap<object, TexelAlphas>();

function texelAlphas(texture: THREE.Texture): TexelAlphas {
  const known = scanned.get(texture.image as object);
  if (known) return known;
  const image = texture.image as ImageBitmap | { data: ArrayLike<number>; width: number; height: number };
  let data: ArrayLike<number>;
  if ('data' in image) data = image.data;
  else {
    // A canvas in memory, not on the GPU: a GPU one read each texture back, 780 ms of a first visit at 4x CPU throttling.
    const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    data = ctx.getImageData(0, 0, image.width, image.height).data;
  }
  const out = { opaque: false, partial: false };
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i]!;
    if (a === 255) out.opaque = true;
    else if (a > 0) out.partial = true;
  }
  scanned.set(image, out);
  return out;
}

/**
 * Translucent parts: the companion of a material whose texture has both opaque and translucent texels
 * (`Materials.convert`), which draws the translucent texels while the material draws the opaque ones. Kept out of
 * userData, which clones copy through JSON.
 */
const parts = new WeakMap<THREE.Material, THREE.Material>();

/**
 * Adds, under each mesh whose material has a translucent part, a mesh drawing that part with the same geometry (as
 * a child, so it moves and hides with the mesh; `userData.translucentPart` marks it). Meshes that have one already
 * are skipped.
 */
export function withTranslucentParts(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !parts.has(mesh.material)) return;
    if (!mesh.children.some((c) => c.userData.translucentPart)) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const part = new THREE.Mesh(mesh.geometry, parts.get(mesh.material as THREE.Material)!);
    part.name = `${mesh.name}:translucent`;
    part.userData.translucentPart = true;
    mesh.add(part);
  }
}

interface Animated {
  material: THREE.MeshBasicMaterial;
  anim: TextureAnimation;
  /** Pattern frames: what each draws (its texture, or the blend of `patternBlend`) and for how long. */
  frames?: { shown: THREE.Texture | null; ticks: number }[];
}

/** Index of the pattern frame shown at a tick (frames loop). */
export function patternAt(frames: readonly { ticks: number }[], tick: number): number {
  const total = frames.reduce((n, f) => n + f.ticks, 0);
  let t = tick % total;
  return frames.findIndex((f) => (t -= f.ticks) < 0);
}

/**
 * The frame a pattern frame is blended with, half and half, or null. A frame shown for a single
 * 30 Hz tick is blended with the frame before it: the DS LCD does not resolve one-frame alternations
 * (the bedroom TV's screen swaps two shades every frame, BTP0 `tv01`), and drawn sharp on a fast
 * display they read as a hard flicker. Longer frames draw as they are.
 */
export function patternBlend(frames: readonly { ticks: number }[], frame: number): number | null {
  return frames.length > 1 && frames[frame]!.ticks === 1 ? (frame + frames.length - 1) % frames.length : null;
}

/** Half-and-half mix of two same-size pattern frames (a texel opaque in only one of them keeps that one). */
function blendTextures(a: THREE.Texture, b: THREE.Texture): THREE.Texture {
  const ia = a.image as ImageBitmap;
  const ib = b.image as ImageBitmap;
  if (ia.width !== ib.width || ia.height !== ib.height) throw new Error(`pattern frames ${a.name} and ${b.name} differ in size`);
  const pixels = (img: ImageBitmap) => {
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const pa = pixels(ia);
  const pb = pixels(ib);
  const out = new Uint8Array(pa.length);
  for (let i = 0; i < pa.length; i += 4) {
    const oa = pa[i + 3]! >= 128;
    const ob = pb[i + 3]! >= 128;
    for (let c = 0; c < 4; c++) out[i + c] = oa && ob ? Math.round((pa[i + c]! + pb[i + c]!) / 2) : oa ? pa[i + c]! : pb[i + c]!;
  }
  const t = pixelTexture(new THREE.DataTexture(out, ia.width, ia.height));
  t.wrapS = a.wrapS;
  t.wrapT = a.wrapT;
  t.name = `${a.name}+${b.name}`;
  return t;
}

/**
 * Converts glTF materials to plain three.js materials with the DS state (alpha, cull, vertex colours) and binds textures by name from an area texture set. Materials are shared by key.
 */
export class Materials {
  private cache = new Map<string, Promise<THREE.Material>>();
  private animated: Animated[] = [];

  /**
   * `textureAnimations`: those that apply to every model by texture name (Platinum map frame swaps).
   * A model's own animations (`Model.animations`) are passed to `convert` and apply only to it.
   */
  constructor(
    private readonly assets: AssetCache,
    private readonly textureAnimations: readonly TextureAnimation[],
    private readonly log: StubLog,
  ) {}

  /**
   * A texture bound by name from a set, or null when the set does not list it (`index.json`): the DS
   * binds the names its texture set holds and leaves the others unbound, so those polygons draw
   * untextured (logged once). A listed texture that fails to load is an error.
   *
   * `own`: the set of the area of the chunk's own zone, for a chunk of another area than the loaded one
   * (the matrix cell's zone). A name the loaded set does not list binds from it: the DS binds the loaded
   * area's set to every chunk, but shows only the chunks next to the player; a wider view also shows
   * chunks of the neighbouring area that the DS only ever draws from that area (Cycling Road's deck
   * seen from Eterna City). Names the loaded set lists keep its texture, as on the DS.
   */
  private async setTexture(set: AssetRef | undefined, texture: string, palette: string | undefined, material: string, own?: AssetRef): Promise<THREE.Texture | null> {
    if (!palette) throw new Error(`material ${material} binds texture "${texture}" by name without a palette`);
    if (!set) {
      this.log.stub('render:unbound-texture', `${texture}/${palette}: the area has no texture set (drawn untextured)`);
      return null;
    }
    const name = `${texture}__${palette}`;
    const from = (await this.assets.textureSet(set)).has(name) ? set : own && (await this.assets.textureSet(own)).has(name) ? own : null;
    if (!from) {
      this.log.stub('render:unbound-texture', `${set} does not list ${name} (drawn untextured)`);
      return null;
    }
    const { pack, path } = splitRef(from);
    return this.assets.texture(`${pack}:${path}/${name}.png`);
  }

  /** The textures of a pattern's frames for a material binding them by name (null = unbound in the set). */
  patternTextures(src: THREE.Material, set: AssetRef | undefined, anim: Extract<TextureAnimation, { kind: 'frames' }>): Promise<(THREE.Texture | null)[]> {
    const ex = (src.userData.lantern ?? {}) as OpenSinnohExtras;
    return Promise.all(anim.frames.map((f) => this.setTexture(set, f.texture, ex.palette, src.name)));
  }

  /** The texture name a glTF material binds (extras `texture`, else its image's name). */
  static textureName(src: THREE.Material): string {
    return ((src.userData.lantern ?? {}) as OpenSinnohExtras).texture ?? (src as THREE.MeshStandardMaterial).map?.name ?? '';
  }

  convert(src: THREE.Material, set: AssetRef | undefined, vertexColors: boolean, modelAnimations: readonly TextureAnimation[] = [], own?: AssetRef): Promise<THREE.Material> {
    if (own === set) own = undefined;
    const ex = (src.userData.lantern ?? {}) as OpenSinnohExtras;
    const glMap = (src as THREE.MeshStandardMaterial).map;
    const textureName = Materials.textureName(src);
    const matches = (a: TextureAnimation) => (a.kind === 'scroll' ? a.material === src.name : a.texture === textureName);
    const anim = modelAnimations.find(matches) ?? this.textureAnimations.find(matches);
    const color = (src as THREE.MeshStandardMaterial).color?.getHexString() ?? 'ffffff';
    const key = [glMap?.uuid ?? `${set}/${own ?? ''}/${ex.texture}__${ex.palette}`, color, ex.alpha ?? 31, ex.cull ?? 'back', ex.lit ?? false, vertexColors, ex.fog ?? false, ex.polygonId ?? 0, anim?.id ?? ''].join('|');
    let p = this.cache.get(key);
    if (!p) {
      p = this.build(src, ex, glMap, set, vertexColors, anim, own);
      this.cache.set(key, p);
    }
    return p;
  }

  private async build(
    src: THREE.Material,
    ex: OpenSinnohExtras,
    glMap: THREE.Texture | null,
    set: AssetRef | undefined,
    vertexColors: boolean,
    anim: TextureAnimation | undefined,
    own: AssetRef | undefined,
  ): Promise<THREE.Material> {
    let map = glMap ? pixelTexture(glMap) : ex.texture ? await this.setTexture(set, ex.texture, ex.palette, src.name, own) : null;
    if (map && anim) map = map.clone();
    const alpha = ex.alpha ?? 31;
    const opacity = alpha === 0 ? 1 : alpha / 31; // DS alpha 0 = wireframe; drawn opaque for now
    // A frame the set lacks is unbound like the base texture: that frame draws untextured.
    const frameTextures = anim?.kind === 'frames' && map ? await Promise.all(anim.frames.map((f) => this.setTexture(set, f.texture, ex.palette, src.name, own))) : [];
    // Per-texel alpha (glTF BLEND at polygon alpha 31: a3i5/a5i3): the DS sorts the polygon as translucent, but draws
    // its alpha-31 pixels as opaque ones (depth, polygon ID and fog flag), its alpha-0 pixels not at all.
    let texels: TexelAlphas | null = null;
    if (src.transparent && alpha === 31 && map) {
      texels = { opaque: false, partial: false };
      for (const t of [map, ...frameTextures]) {
        if (!t) continue;
        const k = texelAlphas(t);
        texels.opaque ||= k.opaque;
        texels.partial ||= k.partial;
      }
    }
    const base = {
      map,
      color: (src as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(1, 1, 1),
      vertexColors,
      side: ex.cull ? SIDES[ex.cull] : src.side,
      opacity,
    };
    const polygonId = ex.polygonId ?? 0;
    const fog = ex.fog ?? false;
    // Lit materials are lit per vertex when the chunk is built (lighting.ts), so every material is unlit here.
    const opaque = (texelsOnly: boolean) =>
      fieldOutputs(new THREE.MeshBasicMaterial({ ...base, transparent: false, depthWrite: true, alphaTest: 0.5 }), { polygonId, fog, ...(texelsOnly ? { texels: 'opaque' as const } : {}) });
    // Translucent pixels keep the depth under them unless the material sets depth update.
    const translucent = () =>
      translucentId(
        fieldOutputs(new THREE.MeshBasicMaterial({ ...base, transparent: true, depthWrite: ex.depthUpdate ?? false, ...TRANSLUCENT_DEPTH(true) }), { polygonId, fog, texels: 'blend' }),
        polygonId,
      );
    let material: THREE.MeshBasicMaterial;
    let part: THREE.MeshBasicMaterial | null = null;
    if (opacity < 1 || (texels?.partial && !texels.opaque)) material = translucent();
    else if (texels?.partial) {
      material = opaque(true);
      part = translucent();
      parts.set(material, part);
    } else material = opaque(false);
    material.name = src.name;
    if (part) part.name = `${src.name}:translucent`;
    if (anim && map) {
      const frames =
        anim.kind === 'frames'
          ? anim.frames.map((f, k) => {
              const texture = frameTextures[k]!;
              const blend = patternBlend(anim.frames, k);
              const before = blend === null ? null : frameTextures[blend]!;
              return { shown: texture && before ? blendTextures(before, texture) : texture, ticks: f.ticks };
            })
          : undefined;
      for (const m of part ? [material, part] : [material]) this.animated.push(frames ? { material: m, anim, frames } : { material: m, anim });
    }
    return material;
  }

  /**
   * Applies texture animations for a simulation tick; `held` ones (a test switch) stay at tick 0, `posed` ones
   * (a map feature's: `FeaturesView.propPoses`) show the frame at their own tick.
   */
  animate(simTick: number, held: readonly string[] = [], posed: ReadonlyMap<Id, number> = new Map()): void {
    for (const { material, anim, frames } of this.animated) {
      const tick = posed.get(anim.id) ?? (held.includes(anim.id) ? 0 : simTick);
      if (anim.kind === 'scroll') {
        const i = tick % anim.frames;
        const at = (v: number[] | number) => (typeof v === 'number' ? v : v[i]!);
        material.map?.offset.set(at(anim.translateS), at(anim.translateT));
      } else if (frames) {
        const { shown } = frames[patternAt(frames, tick)]!;
        if (material.map !== shown) {
          material.map = shown;
          material.needsUpdate = true;
        }
      }
    }
  }
}
