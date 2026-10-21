/**
 * SPA particle files (Nitro SPL, magic `" APS"`; decomp lib/spl spl_resource.h, spl_texture.h,
 * SPLManager_LoadResources). Layout:
 * - a 32-byte header: magic, version, u16 emitter count (8), u16 texture count (10), the texture block's
 *   offset (0x18);
 * - the emitters back to back: an 88-byte SPLResourceHeader, then the blocks its flags name, in this order:
 *   scale animation (bit 8, 12 bytes), colour animation (9, 12), alpha animation (10, 8), texture animation
 *   (11, 12), child resource (16, 20), and the behaviours gravity (24, 8), random (25, 8), magnet (26, 16),
 *   spin (27, 4), collision plane (28, 8), convergence (29, 16);
 * - the textures: a 32-byte SPLTextureResource header (u32 param: format, log2 width − 3, log2 height − 3,
 *   repeat, flip, colour 0 transparent, shared texture and its index; texel size; palette offset and size
 *   from the header; the whole resource size) with its texels and palette.
 * Values stay raw (fx32/fx16 ×4096) in the `ParticleEmitter` record; the battle VM simulates them.
 */
import type { ParticleEmitter } from '@opensinnoh/contracts';
import { decodeTexture, TEXEL_FORMATS, type Tex0, type TextureInfo } from '@opensinnoh/g3d';
import { Reader } from '@opensinnoh/nds';
import type { Image } from '../ui2d/compose.ts';

export const SPA_HEADER = 32;
export const SPA_EMITTER_HEADER = 88;
export const SPA_TEXTURE_HEADER = 32;
/** Optional emitter blocks: flag bit and size, in file order. */
export const SPA_BLOCKS = {
  scaleAnim: [8, 12],
  colorAnim: [9, 12],
  alphaAnim: [10, 8],
  texAnim: [11, 12],
  child: [16, 20],
  gravity: [24, 8],
  random: [25, 8],
  magnet: [26, 16],
  spin: [27, 4],
  collision: [28, 8],
  convergence: [29, 16],
} as const;

export interface Spa {
  reader: Reader;
  emitters: ParticleEmitter[];
  /** Absolute offsets of the emitters' optional blocks, by name (tests and the ball-star check). */
  blocks: Partial<Record<keyof typeof SPA_BLOCKS, number>>[];
  /** Absolute offsets of the texture headers. */
  textures: number[];
}

export function readSpa(bytes: Uint8Array): Spa {
  const r = new Reader(bytes);
  if (r.ascii(0, 4) !== ' APS') throw new Error(`SPA: bad magic "${r.ascii(0, 4)}"`);
  const vec32 = (o: number): [number, number, number] => [r.i32(o), r.i32(o + 4), r.i32(o + 8)];
  const vec16 = (o: number): [number, number, number] => [r.i16(o), r.i16(o + 2), r.i16(o + 4)];
  const emitters: ParticleEmitter[] = [];
  const blocks: Spa['blocks'] = [];
  let o = SPA_HEADER;
  for (let i = 0; i < r.u16(8); i++) {
    const flags = r.u32(o);
    const att = r.u32(o + 0x40);
    const misc = r.u32(o + 0x44);
    const misc2 = r.u32(o + 0x48);
    const misc3 = r.u32(o + 0x4c);
    const e: ParticleEmitter = {
      flags,
      basePos: vec32(o + 4),
      count: r.i32(o + 0x10),
      radius: r.i32(o + 0x14),
      length: r.i32(o + 0x18),
      axis: vec16(o + 0x1c),
      color: r.u16(o + 0x22),
      velPos: r.i32(o + 0x24),
      velAxis: r.i32(o + 0x28),
      scale: r.i32(o + 0x2c),
      aspect: r.i16(o + 0x30),
      startDelay: r.u16(o + 0x32),
      minRotation: r.i16(o + 0x34),
      maxRotation: r.i16(o + 0x36),
      initAngle: r.u16(o + 0x38),
      emitterLife: r.u16(o + 0x3c),
      particleLife: r.u16(o + 0x3e),
      attenuation: [att & 255, (att >>> 8) & 255, (att >>> 16) & 255],
      interval: misc & 255,
      alpha: (misc >>> 8) & 255,
      air: (misc >>> 16) & 255,
      texture: misc >>> 24,
      loopFrames: misc2 & 255,
      dbbScale: (misc2 >>> 8) & 0xffff,
      tileS: (misc2 >>> 24) & 3,
      tileT: (misc2 >>> 26) & 3,
      scaleDir: (misc2 >>> 28) & 7,
      faceEmitter: misc2 >>> 31 === 1,
      flipS: (misc3 & 1) === 1,
      flipT: ((misc3 >>> 1) & 1) === 1,
      polygonX: r.i16(o + 0x50),
      polygonY: r.i16(o + 0x52),
    };
    const at: Spa['blocks'][number] = {};
    o += SPA_EMITTER_HEADER;
    for (const [name, [bit, size]] of Object.entries(SPA_BLOCKS) as [keyof typeof SPA_BLOCKS, readonly [number, number]][]) {
      if (!((flags >>> bit) & 1)) continue;
      at[name] = o;
      readBlock(r, e, name, o);
      o += size;
    }
    emitters.push(e);
    blocks.push(at);
  }
  if (o !== r.u32(0x18)) throw new Error(`SPA: emitters end at 0x${o.toString(16)}, textures start at 0x${r.u32(0x18).toString(16)}`);
  const textures: number[] = [];
  for (let i = 0; i < r.u16(10); i++) {
    textures.push(o);
    o += r.u32(o + 28);
  }
  if (o !== bytes.length) throw new Error(`SPA: textures end at 0x${o.toString(16)} of 0x${bytes.length.toString(16)}`);
  for (const e of emitters) {
    const bad = [e.texture, ...(e.texAnim?.textures ?? []), ...(e.child ? [e.child.texture] : [])].find((t) => t >= textures.length);
    if (bad !== undefined) throw new Error(`SPA: an emitter names texture ${bad} of ${textures.length}`);
  }
  return { reader: r, emitters, blocks, textures };
}

function readBlock(r: Reader, e: ParticleEmitter, name: keyof typeof SPA_BLOCKS, o: number): void {
  switch (name) {
    case 'scaleAnim': {
      const curve = r.u16(o + 6);
      e.scaleAnim = {
        start: r.i16(o),
        mid: r.i16(o + 2),
        end: r.i16(o + 4),
        in: curve & 255,
        out: curve >>> 8,
        loop: (r.u16(o + 8) & 1) === 1,
      };
      return;
    }
    case 'colorAnim': {
      const curve = r.u32(o + 4);
      const f = r.u16(o + 8);
      e.colorAnim = {
        start: r.u16(o),
        end: r.u16(o + 2),
        in: curve & 255,
        peak: (curve >>> 8) & 255,
        out: (curve >>> 16) & 255,
        randomStart: (f & 1) === 1,
        loop: ((f >>> 1) & 1) === 1,
        interpolate: ((f >>> 2) & 1) === 1,
      };
      return;
    }
    case 'alphaAnim': {
      const a = r.u16(o);
      const f = r.u16(o + 2);
      const curve = r.u16(o + 4);
      e.alphaAnim = {
        start: a & 31,
        mid: (a >>> 5) & 31,
        end: (a >>> 10) & 31,
        in: curve & 255,
        out: curve >>> 8,
        random: f & 255,
        loop: ((f >>> 8) & 1) === 1,
      };
      return;
    }
    case 'texAnim': {
      const p = r.u32(o + 8);
      const frames = p & 255;
      if (frames < 1 || frames > 8) throw new Error(`SPA: a texture animation with ${frames} frames`);
      e.texAnim = {
        textures: Array.from({ length: frames }, (_, i) => r.u8(o + i)),
        step: (p >>> 8) & 255,
        randomStart: ((p >>> 16) & 1) === 1,
        loop: ((p >>> 17) & 1) === 1,
      };
      return;
    }
    case 'child': {
      const misc = r.u32(o + 12);
      const misc2 = r.u32(o + 16);
      e.child = {
        flags: r.u16(o),
        randomVel: r.i16(o + 2),
        endScale: r.i16(o + 4),
        life: r.u16(o + 6),
        velRatio: r.u8(o + 8),
        scaleRatio: r.u8(o + 9),
        color: r.u16(o + 10),
        count: misc & 255,
        delay: (misc >>> 8) & 255,
        interval: (misc >>> 16) & 255,
        texture: misc >>> 24,
        tileS: misc2 & 3,
        tileT: (misc2 >>> 2) & 3,
        flipS: ((misc2 >>> 4) & 1) === 1,
        flipT: ((misc2 >>> 5) & 1) === 1,
        faceEmitter: ((misc2 >>> 6) & 1) === 1,
      };
      return;
    }
    case 'gravity':
      e.gravity = [r.i16(o), r.i16(o + 2), r.i16(o + 4)];
      return;
    case 'random':
      e.random = {
        magnitude: [r.i16(o), r.i16(o + 2), r.i16(o + 4)],
        interval: r.u16(o + 6),
      };
      return;
    case 'magnet':
      e.magnet = {
        target: [r.i32(o), r.i32(o + 4), r.i32(o + 8)],
        force: r.i16(o + 12),
      };
      return;
    case 'spin':
      e.spin = { angle: r.u16(o), axis: r.u16(o + 2) };
      return;
    case 'collision':
      e.collision = {
        y: r.i32(o),
        elasticity: r.i16(o + 4),
        type: r.u16(o + 6) & 3,
      };
      return;
    case 'convergence':
      e.convergence = {
        target: [r.i32(o), r.i32(o + 4), r.i32(o + 8)],
        force: r.i16(o + 12),
      };
      return;
  }
}

/** The texture's SPLTextureParam (format, size, repeat, flip, colour 0, shared texture). */
export function spaTextureParam(spa: Spa, index: number): number {
  const o = spa.textures[index];
  if (o === undefined) throw new Error(`SPA: no texture ${index}`);
  return spa.reader.u32(o + 4);
}

/**
 * One texture as RGBA (palette colour 0 transparent when its param says so). A shared texture (param bit 17)
 * takes its texels from texture `sharedTexID` (bits 18–25) and keeps its own palette.
 */
export function spaTexture(spa: Spa, index: number): Image {
  const o = spa.textures[index]!;
  const r = spa.reader;
  const param = spaTextureParam(spa, index);
  const shared = (param >>> 17) & 1 ? spa.textures[(param >>> 18) & 255] : o;
  if (shared === undefined) throw new Error(`SPA: texture ${index} shares texture ${(param >>> 18) & 255}, which is missing`);
  const format = TEXEL_FORMATS[param & 15];
  if (!format || format === 'none' || format === '4x4') throw new Error(`SPA: texture ${index} has format ${param & 15}`);
  const width = 8 << ((param >>> 4) & 15);
  const height = 8 << ((param >>> 8) & 15);
  const palette = { name: 'spa', data: o + r.u32(o + 12) };
  const info: TextureInfo = {
    name: `spa${index}`,
    param,
    format,
    width,
    height,
    color0Transparent: ((param >>> 16) & 1) === 1,
    repeatS: false,
    repeatT: false,
    flipS: false,
    flipT: false,
    data: shared + SPA_TEXTURE_HEADER,
  };
  const tex0: Tex0 = {
    reader: r,
    textures: [info],
    palettes: [palette],
    paletteEnd: palette.data + r.u32(o + 16),
  };
  return {
    width,
    height,
    rgba: decodeTexture(tex0, info, format === 'direct' ? null : palette),
  };
}
