import { Reader } from '@opensinnoh/nds';
import { block, readDict, readNitroFile } from './nitro.ts';

/** One material's texture SRT tracks. Values are in texture units (1.0 = one texture width/height). */
export interface SrtMaterial {
  material: string;
  scaleS: number[] | number;
  scaleT: number[] | number;
  /** Rotation as [sin, cos] when constant; animated rotation is rejected. */
  rotation: [number, number];
  rotationFrames?: [number, number][];
  translateS: number[] | number;
  translateT: number[] | number;
}

export interface SrtAnimation {
  name: string;
  frames: number;
  materials: SrtMaterial[];
}

const CONST = 0x20000000;
const FX16 = 0x10000000;
const STEP = 0xc0000000;

/**
 * BTA0 / SRT0 (texture SRT animation). Per material: 5 tracks (scaleS, scaleT, rotation, transS,
 * transT), each `u32 info, u32 value`. info: bits 0–15 frame count, bit 28 fx16 samples (else fx32),
 * bit 29 constant (value inline), bits 30–31 sample step (2/4; not supported, none in Platinum fields).
 * Sample offsets are relative to the animation header. Measured on the ROM (bm_anime).
 */
export function readSrtAnimations(bytes: Uint8Array): SrtAnimation[] {
  const f = readNitroFile(bytes, 'BTA0');
  const r = f.reader;
  const srt = block(f, 'SRT0');
  return readDict(r, srt + 8).map(({ name, data }) => {
    const a = srt + r.u32(data);
    if (r.ascii(a, 4) !== 'M\0AT') throw new Error(`SRT0 ${name}: bad animation magic`);
    const frames = r.u16(a + 4);
    const materials = readDict(r, a + 8).map(({ name: material, data: d }): SrtMaterial => {
      const track = (t: number, rotation = false): number[] | number => {
        const info = r.u32(d + t * 8);
        const v = d + t * 8 + 4;
        if (info & STEP) throw new Error(`SRT0 ${name}/${material}: stepped track (info 0x${info.toString(16)}) is not supported`);
        if (info & CONST) return rotation ? r.u32(v) : r.i32(v) / 4096;
        const base = a + r.u32(v);
        const n = info & 0xffff;
        if (n !== frames) throw new Error(`SRT0 ${name}/${material}: track has ${n} frames, animation ${frames}`);
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(rotation ? r.u32(base + i * 4) : (info & FX16 ? r.i16(base + i * 2) : r.i32(base + i * 4)) / 4096);
        return out;
      };
      const rot = track(2, true);
      const pair = (v: number): [number, number] => [((v << 16) >> 16) / 4096, (v >> 16) / 4096];
      return {
        material,
        scaleS: track(0),
        scaleT: track(1),
        rotation: pair(typeof rot === 'number' ? rot : rot[0]!),
        ...(Array.isArray(rot) ? { rotationFrames: rot.map(pair) } : {}),
        translateS: track(3),
        translateT: track(4),
      };
    });
    return { name, frames, materials };
  });
}

/** fldtanime member 0: `u32 count`, then count × { char name[16]; {u8 textureIndex, u8 duration}[18] } (0xFF ends). */
export interface FrameSwap {
  /** Map texture whose texels are swapped. */
  texture: string;
  /** Texture dict index in the frame BTX0 (member index + 1) and its duration in 30 Hz ticks. */
  frames: { textureIndex: number; ticks: number }[];
}

export function readFrameSwapTable(bytes: Uint8Array): FrameSwap[] {
  const r = new Reader(bytes);
  const n = r.u32(0);
  if (bytes.length !== 4 + n * 52) throw new Error(`fldtanime table: ${n} entries in ${bytes.length} bytes`);
  const out: FrameSwap[] = [];
  for (let i = 0; i < n; i++) {
    const o = 4 + i * 52;
    const frames: FrameSwap['frames'] = [];
    for (let k = 0; k < 18; k++) {
      const t = r.u8(o + 16 + k * 2);
      if (t === 0xff) break;
      // The game holds a frame while its counter climbs from 0 to `duration`: duration + 1 ticks.
      frames.push({ textureIndex: t, ticks: r.u8(o + 17 + k * 2) + 1 });
    }
    if (!frames.length) throw new Error(`fldtanime entry ${i} has no frames`);
    out.push({ texture: r.ascii(o, 16).replace(/\0.*$/s, ''), frames });
  }
  return out;
}

/** One material's texture pattern: from each key frame on, the material draws `texture` with `palette`. */
export interface PatternMaterial {
  material: string;
  keys: { frame: number; texture: string; palette: string }[];
}

export interface PatternAnimation {
  name: string;
  frames: number;
  materials: PatternMaterial[];
}

/**
 * BTP0 / PAT0 (texture pattern animation). Per animation (`M\0PT`): `u16 frames, u8 textureCount,
 * u8 paletteCount, u16 textureNames, u16 paletteNames` (offsets from the animation header to 16-byte
 * names), then a dict of materials whose data is `u16 keyCount, u16 flags, u16 ratio, u16 keys`; each
 * key is `u16 frame, u8 texture, u8 palette`. Measured on the ROM (bm_anime).
 */
export function readPatternAnimations(bytes: Uint8Array): PatternAnimation[] {
  const f = readNitroFile(bytes, 'BTP0');
  const r = f.reader;
  const pat = block(f, 'PAT0');
  return readDict(r, pat + 8).map(({ name, data }) => {
    const a = pat + r.u32(data);
    if (r.ascii(a, 4) !== 'M\0PT') throw new Error(`PAT0 ${name}: bad animation magic`);
    const frames = r.u16(a + 4);
    const nameAt = (base: number, i: number) => r.ascii(a + base + i * 16, 16).replace(/\0.*$/s, '');
    const texCount = r.u8(a + 6);
    const palCount = r.u8(a + 7);
    const textures = Array.from({ length: texCount }, (_, i) => nameAt(r.u16(a + 8), i));
    const palettes = Array.from({ length: palCount }, (_, i) => nameAt(r.u16(a + 10), i));
    const materials = readDict(r, a + 12).map(({ name: material, data: d }): PatternMaterial => {
      const count = r.u16(d);
      const keysAt = a + r.u16(d + 6);
      const keys = Array.from({ length: count }, (_, k) => {
        const o = keysAt + k * 4;
        const texture = textures[r.u8(o + 2)];
        const palette = palettes[r.u8(o + 3)];
        if (texture === undefined || palette === undefined) throw new Error(`PAT0 ${name}/${material}: key ${k} names texture ${r.u8(o + 2)}/palette ${r.u8(o + 3)} out of range`);
        return { frame: r.u16(o), texture, palette };
      });
      if (!keys.length || keys[0]!.frame !== 0 || keys.some((k, i) => i > 0 && k.frame <= keys[i - 1]!.frame) || keys[keys.length - 1]!.frame >= frames) throw new Error(`PAT0 ${name}/${material}: key frames ${keys.map((k) => k.frame).join(',')} do not start at 0 and rise within ${frames}`);
      return { material, keys };
    });
    return { name, frames, materials };
  });
}
