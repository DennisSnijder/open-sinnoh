/**
 * SPA particle files (Nitro SPL, `" APS"`): enough to take an emitter's settings and its texture. Layout
 * (decomp lib/spl spl_resource.h / spl_texture.h, SPLManager_LoadResources): a 32-byte header (magic,
 * version, u16 emitter count, u16 texture count, …, u32 texture offset at 0x18); the emitters back to back,
 * each an 88-byte header followed by the optional blocks its flags name; then the textures, each a 32-byte
 * header (u32 param: format, log2 width − 3, log2 height − 3, colour 0 transparent; texel size, palette
 * offset and size, the whole resource size) with its texels and palette.
 * The full particle system (behaviours, curves, children) is not read here.
 */
import { decodeTexture, TEXEL_FORMATS, type Tex0, type TextureInfo } from '@opensinnoh/g3d';
import { Reader } from '@opensinnoh/nds';
import type { Image } from './compose.ts';

const HEADER = 32;
const EMITTER_HEADER = 88;
/** Optional emitter blocks by flag bit: scale, colour, alpha, texture animations, child, then the six behaviours. */
const BLOCKS: [bit: number, size: number][] = [[8, 12], [9, 12], [10, 8], [11, 12], [16, 20], [24, 8], [25, 8], [26, 16], [27, 4], [28, 8], [29, 16]];

export interface SpaEmitter {
  /** Absolute offset of the emitter's 88-byte header (SPLResourceHeader). */
  offset: number;
  flags: number;
  /** SPLEmissionType. */
  emission: number;
  /** fx32 values as numbers. */
  count: number;
  radius: number;
  velPos: number;
  velAxis: number;
  scale: number;
  /** BGR555. */
  color: number;
  particleLife: number;
  texture: number;
  /** Air resistance, of 128. */
  air: number;
  /** The emitter's optional blocks by flag bit (absolute offsets). */
  blocks: Map<number, number>;
}

export interface Spa {
  reader: Reader;
  emitters: SpaEmitter[];
  /** Absolute offsets of the texture headers. */
  textures: number[];
}

export function readSpa(bytes: Uint8Array): Spa {
  const r = new Reader(bytes);
  if (r.ascii(0, 4) !== ' APS') throw new Error(`SPA: bad magic "${r.ascii(0, 4)}"`);
  const fx = (o: number) => r.i32(o) / 4096;
  const emitters: SpaEmitter[] = [];
  let o = HEADER;
  for (let i = 0; i < r.u16(8); i++) {
    const flags = r.u32(o);
    const misc = r.u32(o + 68);
    const e: SpaEmitter = {
      offset: o,
      flags,
      emission: flags & 15,
      count: fx(o + 16),
      radius: fx(o + 20),
      velPos: fx(o + 36),
      velAxis: fx(o + 40),
      scale: fx(o + 44),
      color: r.u16(o + 34),
      particleLife: r.u16(o + 62),
      texture: misc >>> 24,
      air: (misc >>> 16) & 255,
      blocks: new Map(),
    };
    o += EMITTER_HEADER;
    for (const [bit, size] of BLOCKS)
      if ((flags >>> bit) & 1) {
        e.blocks.set(bit, o);
        o += size;
      }
    emitters.push(e);
  }
  if (o !== r.u32(0x18)) throw new Error(`SPA: emitters end at 0x${o.toString(16)}, textures start at 0x${r.u32(0x18).toString(16)}`);
  const textures: number[] = [];
  for (let i = 0; i < r.u16(10); i++) {
    if (r.ascii(o, 4) !== ' TPS') throw new Error(`SPA: texture ${i} has magic "${r.ascii(o, 4)}"`);
    textures.push(o);
    o += r.u32(o + 28);
  }
  if (o !== bytes.length) throw new Error(`SPA: textures end at 0x${o.toString(16)} of 0x${bytes.length.toString(16)}`);
  return { reader: r, emitters, textures };
}

/** One SPA texture as RGBA (palette colour 0 transparent when its param says so). */
export function spaTexture(spa: Spa, index: number): Image {
  const o = spa.textures[index];
  if (o === undefined) throw new Error(`SPA: no texture ${index}`);
  const r = spa.reader;
  const param = r.u32(o + 4);
  const format = TEXEL_FORMATS[param & 15];
  if (!format || format === 'none' || format === '4x4') throw new Error(`SPA: texture ${index} has format ${param & 15}`);
  const width = 8 << ((param >>> 4) & 15);
  const height = 8 << ((param >>> 8) & 15);
  const palette = { name: 'spa', data: o + r.u32(o + 12) };
  const info: TextureInfo = { name: `spa${index}`, param, format, width, height, color0Transparent: ((param >>> 16) & 1) === 1, repeatS: false, repeatT: false, flipS: false, flipT: false, data: o + HEADER };
  const tex0: Tex0 = { reader: r, textures: [info], palettes: [palette], paletteEnd: palette.data + r.u32(o + 16) };
  return { width, height, rgba: decodeTexture(tex0, info, format === 'direct' ? null : palette) };
}
