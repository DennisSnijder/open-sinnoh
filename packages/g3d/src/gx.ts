import type { Reader } from '@opensinnoh/nds';

export const PRIMITIVE_TYPES = ['triangles', 'quads', 'triangle-strip', 'quad-strip'] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

export interface Vertex {
  position: [number, number, number];
  normal: [number, number, number] | null;
  color: [number, number, number];
  /** Texture coordinates in texels (DS 1.11.4 → float), t pointing down. */
  texcoord: [number, number] | null;
  /** Matrix stack slot restored (MTX_RESTORE) before this vertex; absent when the list restores none. */
  matrix?: number;
}

/** One BEGIN_VTXS..END_VTXS run (or until the next BEGIN). */
export interface Primitive {
  type: PrimitiveType;
  vertices: Vertex[];
}

/** Parameter words per GX command (GBATEK "DS 3D Geometry Commands"); absent = invalid. */
const PARAMS: Record<number, number> = {
  0x00: 0, 0x10: 1, 0x11: 0, 0x12: 1, 0x13: 1, 0x14: 1, 0x15: 0, 0x16: 16, 0x17: 12, 0x18: 16, 0x19: 12, 0x1a: 9, 0x1b: 3, 0x1c: 3,
  0x20: 1, 0x21: 1, 0x22: 1, 0x23: 2, 0x24: 1, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x29: 1, 0x2a: 1, 0x2b: 1,
  0x30: 1, 0x31: 1, 0x32: 1, 0x33: 1, 0x34: 32, 0x40: 1, 0x41: 0, 0x50: 1, 0x60: 1, 0x70: 3, 0x71: 2, 0x72: 1,
};

const s10 = (v: number) => ((v & 0x3ff) << 22) >> 22;

/**
 * Decodes a packed GX display list. Positions are multiplied by `posScale`. MTX_RESTORE tags the
 * following vertices with the stack slot (rigidly skinned models, e.g. the title Giratina) and drops
 * the position scale (the restored matrix lacks it); MTX_SCALE then scales the following positions
 * (such lists re-apply posScale this way). Other matrix commands are rejected. The current colour starts at `initialColor` (the material's
 * diffuse when DIF_AMB bit 15 is set).
 */
export function decodeDisplayList(r: Reader, start: number, end: number, posScale: number, initialColor: [number, number, number]): Primitive[] {
  const out: Primitive[] = [];
  let prim: Primitive | null = null;
  let pos: [number, number, number] = [0, 0, 0];
  let normal: [number, number, number] | null = null;
  let color = initialColor;
  let texcoord: [number, number] | null = null;
  let matrix: number | undefined;
  let scale: [number, number, number] = [posScale, posScale, posScale];
  const emit = () => {
    if (!prim) throw new Error(`GX: vertex outside BEGIN_VTXS at 0x${p.toString(16)}`);
    const v: Vertex = { position: [pos[0] * scale[0], pos[1] * scale[1], pos[2] * scale[2]], normal, color, texcoord };
    if (matrix !== undefined) v.matrix = matrix;
    prim.vertices.push(v);
  };
  let p = start;
  while (p < end) {
    const packed = r.u32(p);
    p += 4;
    for (let k = 0; k < 4; k++) {
      const cmd = (packed >>> (k * 8)) & 0xff;
      const n = PARAMS[cmd];
      if (n === undefined) throw new Error(`GX: unknown command 0x${cmd.toString(16)} at 0x${(p - 4).toString(16)}`);
      const w = (i: number) => r.u32(p + i * 4);
      switch (cmd) {
        case 0x00:
          break;
        case 0x14:
          matrix = w(0) & 31;
          scale = [1, 1, 1];
          break;
        case 0x1b:
          scale = [(scale[0] * r.i32(p)) / 4096, (scale[1] * r.i32(p + 4)) / 4096, (scale[2] * r.i32(p + 8)) / 4096];
          break;
        case 0x20: {
          const c = w(0);
          color = [(c & 31) / 31, ((c >> 5) & 31) / 31, ((c >> 10) & 31) / 31];
          break;
        }
        case 0x21: {
          const v = w(0);
          normal = [s10(v) / 512, s10(v >> 10) / 512, s10(v >> 20) / 512];
          break;
        }
        case 0x22: {
          const v = w(0);
          texcoord = [((v << 16) >> 16) / 16, (v >> 16) / 16];
          break;
        }
        case 0x23: {
          const a = w(0);
          pos = [((a << 16) >> 16) / 4096, (a >> 16) / 4096, ((w(1) << 16) >> 16) / 4096];
          emit();
          break;
        }
        case 0x24: {
          const v = w(0);
          pos = [s10(v) / 64, s10(v >> 10) / 64, s10(v >> 20) / 64];
          emit();
          break;
        }
        case 0x25:
        case 0x26:
        case 0x27: {
          const v = w(0);
          const a = ((v << 16) >> 16) / 4096;
          const b = (v >> 16) / 4096;
          pos = cmd === 0x25 ? [a, b, pos[2]] : cmd === 0x26 ? [a, pos[1], b] : [pos[0], a, b];
          emit();
          break;
        }
        case 0x28: {
          const v = w(0);
          pos = [pos[0] + s10(v) / 4096, pos[1] + s10(v >> 10) / 4096, pos[2] + s10(v >> 20) / 4096];
          emit();
          break;
        }
        case 0x40: {
          const t = w(0) & 3;
          prim = { type: PRIMITIVE_TYPES[t] as PrimitiveType, vertices: [] };
          out.push(prim);
          break;
        }
        case 0x41:
          prim = null;
          break;
        default:
          throw new Error(`GX: command 0x${cmd.toString(16)} is not supported in model display lists`);
      }
      p += n * 4;
    }
  }
  if (p !== end) throw new Error(`GX: display list overran its size (${p - end} bytes)`);
  return out;
}

/** Expands a primitive into triangles (vertex index triples), counter-clockwise front faces as glTF expects. */
export function triangulate(prim: Primitive): number[] {
  const n = prim.vertices.length;
  const out: number[] = [];
  switch (prim.type) {
    case 'triangles':
      if (n % 3) throw new Error(`GX: triangle list with ${n} vertices`);
      for (let i = 0; i < n; i += 3) out.push(i, i + 1, i + 2);
      break;
    case 'quads':
      if (n % 4) throw new Error(`GX: quad list with ${n} vertices`);
      for (let i = 0; i < n; i += 4) out.push(i, i + 1, i + 2, i, i + 2, i + 3);
      break;
    case 'triangle-strip':
      if (n < 3) throw new Error(`GX: triangle strip with ${n} vertices`);
      for (let i = 0; i + 2 < n; i++) out.push(...(i & 1 ? [i + 1, i, i + 2] : [i, i + 1, i + 2]));
      break;
    case 'quad-strip':
      if (n < 4 || n % 2) throw new Error(`GX: quad strip with ${n} vertices`);
      for (let i = 0; i + 3 < n; i += 2) out.push(i, i + 1, i + 3, i, i + 3, i + 2);
      break;
  }
  return out;
}
