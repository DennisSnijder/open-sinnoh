import type { Reader } from '@opensinnoh/nds';
import { block, readDict, readNitroFile } from './nitro.ts';
import { pivotRotation } from './mdl0.ts';

export type Vec3 = [number, number, number];

/** One node's transform per frame. `'rest'` = the model's own value for that component (BASE flag). */
export interface JointTrack {
  node: number;
  translation: Vec3[] | 'rest';
  /** Column-major 3×3 rotation per frame. */
  rotation: number[][] | 'rest';
  scale: Vec3[] | 'rest';
}

export interface JointAnimation {
  name: string;
  frames: number;
  tracks: JointTrack[];
}

/** JNT0 tag flags (per node). Names follow the NNS bit meanings: identity / use the model's value / constant. */
const F = {
  IDENTITY: 0x1,
  T_IDENTITY: 0x2,
  T_BASE: 0x4,
  T_CONST: [0x8, 0x10, 0x20],
  R_IDENTITY: 0x40,
  R_BASE: 0x80,
  R_CONST: 0x100,
  S_IDENTITY: 0x200,
  S_BASE: 0x400,
  S_CONST: [0x800, 0x1000, 0x2000],
} as const;
/** Track info word: bits 16–28 last frame with data, bit 29 fx16 samples (translation/scale), bits 30–31 sample step. */
const INFO_FX16 = 0x20000000;
const INFO_STEP = 0xc0000000;
/** Rotation index: bit 15 = pivot-compressed table (rot3), else the basis table (rot5). */
const ROT_PIVOT = 0x8000;

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * BCA0 / JNT0 (joint animation). Per animation (`J\0AC`): `u16 frames, u16 nodes, u32 flags,
 * u32 ofsRot3, u32 ofsRot5, u16 ofsTag[nodes]` (offsets from the animation header). Each tag is
 * `u16 flag, u8, u8` then, unless identity/base, the translation axes (const: fx32; else info + offset),
 * rotation (const: u32 index; else info + offset of u16 indices) and scale axes (const: fx32 scale +
 * fx32 inverse; else info + offset of (scale, inverse) pairs). Rotation indices with bit 15 point into
 * the pivot table (rot3: u16 select, fx16 a, fx16 b, as MDL0 pivot rotations); others into the basis
 * table (rot5: 5 × u16, two packed rows; the third is their cross product).
 * Only unstepped tracks occur in Platinum's prop animations; stepped tracks throw.
 */
export function readJointAnimations(bytes: Uint8Array): JointAnimation[] {
  const f = readNitroFile(bytes, 'BCA0');
  const r = f.reader;
  const jnt = block(f, 'JNT0');
  return readDict(r, jnt + 8).map(({ name, data }) => {
    const a = jnt + r.u32(data);
    if (r.ascii(a, 4) !== 'J\0AC') throw new Error(`JNT0 ${name}: bad animation magic`);
    const frames = r.u16(a + 4);
    const nodes = r.u16(a + 6);
    const rot3 = a + r.u32(a + 12);
    const rot5 = a + r.u32(a + 16);
    const where = (node: number) => `JNT0 ${name} node ${node}`;
    const samples = (node: number, info: number, at: number, read: (base: number, i: number) => number): number[] => {
      if (info & INFO_STEP) throw new Error(`${where(node)}: stepped track (info 0x${(info >>> 0).toString(16)}) is not supported`);
      const last = (info >> 16) & 0x1fff;
      if (last !== frames) throw new Error(`${where(node)}: track holds ${last} frames, animation ${frames}`);
      return Array.from({ length: frames }, (_, i) => read(at, i));
    };
    const tracks: JointTrack[] = [];
    for (let node = 0; node < nodes; node++) {
      const tag = a + r.u16(a + 20 + node * 2);
      const flag = r.u16(tag);
      let p = tag + 4;
      if (flag & F.IDENTITY) {
        tracks.push({ node, translation: fill(frames, [0, 0, 0]), rotation: fill(frames, IDENTITY3), scale: fill(frames, [1, 1, 1]) });
        continue;
      }
      const axes = (identity: number, base: number, consts: readonly number[], idValue: number, pair: boolean): Vec3[] | 'rest' => {
        if (flag & identity) return fill(frames, [idValue, idValue, idValue]);
        if (flag & base) return 'rest';
        const perAxis = consts.map((c) => {
          if (flag & c) {
            const v = r.i32(p) / 4096;
            p += pair ? 8 : 4;
            return fill(frames, v);
          }
          const info = r.u32(p);
          const at = a + r.u32(p + 4);
          p += 8;
          const fx16 = (info & INFO_FX16) !== 0;
          const stride = (fx16 ? 2 : 4) * (pair ? 2 : 1);
          return samples(node, info, at, (base, i) => (fx16 ? r.i16(base + i * stride) : r.i32(base + i * stride)) / 4096);
        });
        return Array.from({ length: frames }, (_, i): Vec3 => [perAxis[0]![i]!, perAxis[1]![i]!, perAxis[2]![i]!]);
      };
      const translation = axes(F.T_IDENTITY, F.T_BASE, F.T_CONST, 0, false);
      let rotation: number[][] | 'rest';
      if (flag & F.R_IDENTITY) rotation = fill(frames, IDENTITY3);
      else if (flag & F.R_BASE) rotation = 'rest';
      else if (flag & F.R_CONST) {
        rotation = fill(frames, rotationAt(r, r.u16(p), rot3, rot5, where(node)));
        p += 4;
      } else {
        const info = r.u32(p);
        const at = a + r.u32(p + 4);
        p += 8;
        rotation = samples(node, info, at, (base, i) => r.u16(base + i * 2)).map((idx) => rotationAt(r, idx, rot3, rot5, where(node)));
      }
      const scale = axes(F.S_IDENTITY, F.S_BASE, F.S_CONST, 1, true);
      tracks.push({ node, translation, rotation, scale });
    }
    return { name, frames, tracks };
  });
}

function rotationAt(r: Reader, index: number, rot3: number, rot5: number, where: string): number[] {
  if (index & ROT_PIVOT) {
    const o = rot3 + (index & 0x7fff) * 6;
    const sel = r.u16(o);
    return pivotRotation(sel & 15, (sel >> 4) & 15, r.i16(o + 2) / 4096, r.i16(o + 4) / 4096);
  }
  return basisRotation([0, 1, 2, 3, 4].map((i) => r.u16(rot5 + index * 10 + i * 2)), where);
}

/**
 * Basis-table rotation (rot5): five u16. Their top 13 bits (signed fx 1.12) are the first five entries
 * of the DS matrix's first two rows; the sixth is a signed 13-bit fx 1.12 whose sign is bit 0 of u16 4
 * and whose low 12 bits are the low 3 bits of u16 0–3, most significant first (measured on the title
 * Giratina: every row comes out unit length and orthogonal). The third row is the cross product of the
 * first two. Same array convention as `pivotRotation`.
 */
export function basisRotation(data: number[], where = 'rot5'): number[] {
  const v = data.map((d) => ((d << 16) >> 19) / 4096);
  const low = [0, 1, 2, 3].reduce((acc, i) => (acc << 3) | ((data[i] as number) & 7), (data[4] as number) & 1);
  v.push(((low << 19) >> 19) / 4096);
  const [a0, a1, a2, b0, b1, b2] = v as [number, number, number, number, number, number];
  const len = (x: number, y: number, z: number) => Math.hypot(x, y, z);
  if (Math.abs(len(a0, a1, a2) - 1) > 0.01 || Math.abs(len(b0, b1, b2) - 1) > 0.01) throw new Error(`${where}: basis rotation rows are not unit length`);
  return [a0, a1, a2, b0, b1, b2, a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0];
}

function fill<T>(n: number, v: T): T[] {
  return Array.from({ length: n }, () => (Array.isArray(v) ? ([...v] as T) : v));
}
