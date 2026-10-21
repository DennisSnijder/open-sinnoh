import type { Reader } from '@opensinnoh/nds';
import { block, readDict, readNitroFile } from './nitro.ts';
import { decodeDisplayList, type Primitive } from './gx.ts';

const fx = (v: number) => v / 4096;

export interface Node {
  name: string;
  /** Column-major 4×4 local transform (glTF order). */
  matrix: number[];
  identity: boolean;
  parent: number | null;
  billboard: 'none' | 'full' | 'y';
}

export interface Material {
  projectionMap?: boolean;
  textureTransform?: { scaleS: number; scaleT: number; sin: number; cos: number; translateS: number; translateT: number };
  name: string;
  diffAmb: number;
  specEmi: number;
  polyAttr: number;
  /** Repeat/flip/texgen bits of TEXIMAGE_PARAM (bits 16–19, 30–31). */
  texParam: number;
  flag: number;
  origWidth: number;
  origHeight: number;
  texture: string | null;
  palette: string | null;
}

export interface Shape {
  name: string;
  flag: number;
  dlStart: number;
  dlEnd: number;
}

/** One draw from the SBC: material + shape under a node. */
export interface Draw {
  node: number;
  material: number;
  shape: number;
  /** Matrix stack slot → node at the time of the draw (what a display list's MTX_RESTORE loads). */
  stack?: (number | null)[];
}

export interface Model {
  name: string;
  /** 0 = standard, 1 = Maya segment scale compensation (converters accept it only with unit scales). */
  scalingRule: 0 | 1;
  posScale: number;
  numVertex: number;
  numPolygon: number;
  numTriangle: number;
  numQuad: number;
  nodes: Node[];
  materials: Material[];
  shapes: Shape[];
  draws: Draw[];
  reader: Reader;
}

/** Reads all models of a BMD0 (field files hold exactly one). */
export function readModels(bytes: Uint8Array): Model[] {
  const f = readNitroFile(bytes, 'BMD0');
  const r = f.reader;
  const mdl0 = block(f, 'MDL0');
  return readDict(r, mdl0 + 8).map(({ name, data }) => parseModel(r, mdl0 + r.u32(data), name));
}

function parseModel(r: Reader, m: number, name: string): Model {
  const sbc = m + r.u32(m + 4);
  const mat = m + r.u32(m + 8);
  const shp = m + r.u32(m + 0x0c);
  const scalingRule = r.u8(m + 0x15);
  const texMtxMode = r.u8(m + 0x16);
  if (scalingRule !== 0 && scalingRule !== 1) throw new Error(`MDL0 ${name}: scaling rule ${scalingRule} is not supported`);
  if (texMtxMode !== 0) throw new Error(`MDL0 ${name}: texture matrix mode ${texMtxMode} is not supported`);
  const nodeInfo = m + 0x40;
  const nodes = readDict(r, nodeInfo).map(({ name, data }) => parseNode(r, nodeInfo + r.u32(data), name));
  const materials = parseMaterials(r, mat);
  const shapes = readDict(r, shp).map(({ name, data }): Shape => {
    const s = shp + r.u32(data);
    const dl = s + r.u32(s + 8);
    return { name, flag: r.u32(s + 4), dlStart: dl, dlEnd: dl + r.u32(s + 0x0c) };
  });
  const model: Model = {
    name,
    scalingRule: scalingRule as 0 | 1,
    posScale: fx(r.i32(m + 0x1c)),
    numVertex: r.u16(m + 0x24),
    numPolygon: r.u16(m + 0x26),
    numTriangle: r.u16(m + 0x28),
    numQuad: r.u16(m + 0x2a),
    nodes,
    materials,
    shapes,
    draws: [],
    reader: r,
  };
  runSbc(r, sbc, model);
  return model;
}

function parseNode(r: Reader, o: number, name: string): Node {
  const flag = r.u16(o);
  let p = o + 4;
  let t = [0, 0, 0];
  let rot = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // column-major 3×3 for column vectors
  let s = [1, 1, 1];
  if (!(flag & 1)) {
    t = [fx(r.i32(p)), fx(r.i32(p + 4)), fx(r.i32(p + 8))];
    p += 12;
  }
  if (!(flag & 2)) {
    if (flag & 8) {
      rot = pivotRotation((flag >> 4) & 15, (flag >> 8) & 15, fx(r.i16(p)), fx(r.i16(p + 2)));
      p += 4;
    } else {
      rot = [fx(r.i16(o + 2))];
      for (let i = 0; i < 8; i++) rot.push(fx(r.i16(p + i * 2)));
      p += 16;
    }
  }
  if (!(flag & 4)) s = [fx(r.i32(p)), fx(r.i32(p + 4)), fx(r.i32(p + 8))];
  const matrix: number[] = [];
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) matrix.push((rot[c * 3 + row] as number) * (s[c] as number));
  matrix.splice(3, 0, 0);
  matrix.splice(7, 0, 0);
  matrix.push(0, ...t, 1);
  return { name, matrix, identity: (flag & 7) === 7, parent: null, billboard: 'none' };
}

/**
 * Pivot-compressed rotation (layout as apicula reads it): in the DS matrix (row-major, row vectors) the
 * entry at index `pivot` is ±1, its row and column are 0, and the remaining 2×2 holds a, b, ±b, ±a in
 * row-major order. That array is also the column-major matrix for column vectors (the transpose), as
 * for full rotations. (Before 2026-10-14 the 2×2 was filled transposed and the pivot mirrored; this
 * only mattered for asymmetric pivots, e.g. door frames with pivot 2.)
 */
export function pivotRotation(pivot: number, neg: number, a: number, b: number): number[] {
  if (pivot > 8) throw new Error(`MDL0: pivot index ${pivot}`);
  const one = neg & 1 ? -1 : 1;
  const c = neg & 2 ? -b : b;
  const d = neg & 4 ? -a : a;
  const pr = Math.floor(pivot / 3);
  const pc = pivot % 3;
  const m = Array(9).fill(0) as number[];
  m[pivot] = one;
  const vals = [a, b, c, d];
  let k = 0;
  for (const row of [0, 1, 2]) if (row !== pr) for (const col of [0, 1, 2]) if (col !== pc) m[row * 3 + col] = vals[k++] as number;
  return m;
}

function parseMaterials(r: Reader, o: number): Material[] {
  const texToMat = o + r.u16(o);
  const plttToMat = o + r.u16(o + 2);
  const materials = readDict(r, o + 4).map(({ name, data }): Material => {
    const d = o + r.u32(data);
    const flag = r.u16(d + 0x1e);
    let p = d + 0x2c;
    const transform = { scaleS: 1, scaleT: 1, sin: 0, cos: 1, translateS: 0, translateT: 0 };
    if (flag & 1) {
      if (!(flag & 2)) { transform.scaleS = fx(r.i32(p)); transform.scaleT = fx(r.i32(p + 4)); p += 8; }
      if (!(flag & 4)) { transform.sin = fx(r.i16(p)); transform.cos = fx(r.i16(p + 2)); p += 4; }
      if (!(flag & 8)) { transform.translateS = fx(r.i32(p)); transform.translateT = fx(r.i32(p + 4)); }
    }
    return {
      name,
      ...(flag & 1 ? { textureTransform: transform } : {}),
      diffAmb: r.u32(d + 4),
      specEmi: r.u32(d + 8),
      polyAttr: r.u32(d + 0x0c),
      texParam: r.u32(d + 0x14),
      flag: r.u16(d + 0x1e),
      origWidth: r.u16(d + 0x20),
      origHeight: r.u16(d + 0x22),
      texture: null,
      palette: null,
    };
  });
  const bind = (dict: number, key: 'texture' | 'palette') => {
    for (const { name, data } of readDict(r, dict)) {
      const list = o + r.u16(data);
      for (let i = 0; i < r.u8(data + 2); i++) {
        const m = materials[r.u8(list + i)];
        if (!m) throw new Error(`MDL0: ${key} ${name} binds missing material ${r.u8(list + i)}`);
        if (m[key] !== null) throw new Error(`MDL0: material ${m.name} has two ${key}s`);
        m[key] = name;
      }
    }
  };
  bind(texToMat, 'texture');
  bind(plttToMat, 'palette');
  return materials;
}

function runSbc(r: Reader, o: number, model: Model): void {
  let node = 0;
  let material = -1;
  const stack = new Map<number, number>();
  for (let p = o; ; ) {
    const cmd = r.u8(p);
    const op = cmd & 31;
    const opt = cmd >> 5;
    switch (op) {
      case 0x00:
        p += 1;
        break;
      case 0x01:
        return;
      case 0x02:
        p += 3;
        break;
      case 0x03: {
        const n = stack.get(r.u8(p + 1));
        if (n === undefined) throw new Error(`SBC ${model.name}: MTX restores empty slot ${r.u8(p + 1)}`);
        node = n;
        p += 2;
        break;
      }
      case 0x04:
        material = r.u8(p + 1);
        p += 2;
        break;
      case 0x05:
        if (material < 0) throw new Error(`SBC ${model.name}: SHP before MAT`);
        model.draws.push({ node, material, shape: r.u8(p + 1), stack: Array.from({ length: 32 }, (_, i) => stack.get(i) ?? null) });
        p += 2;
        break;
      case 0x06: {
        node = r.u8(p + 1);
        const parent = r.u8(p + 2);
        const n = model.nodes[node];
        if (!n) throw new Error(`SBC ${model.name}: node ${node} out of range`);
        if (parent !== node) n.parent = parent;
        if (opt === 1 || opt === 3) stack.set(r.u8(p + 4), node);
        p += 4 + (opt === 1 || opt === 2 ? 1 : opt === 3 ? 2 : 0);
        break;
      }
      case 0x07:
      case 0x08: {
        const n = model.nodes[r.u8(p + 1)];
        if (!n) throw new Error(`SBC ${model.name}: billboard node out of range`);
        n.billboard = op === 0x07 ? 'full' : 'y';
        if (opt === 1 || opt === 3) stack.set(r.u8(p + 2), r.u8(p + 1));
        p += 2 + (opt === 1 || opt === 2 ? 1 : opt === 3 ? 2 : 0);
        break;
      }
      case 0x0b:
        p += 1;
        break;
      case 0x0d: {
        const mat = model.materials[r.u8(p + 1)];
        if (!mat) throw new Error(`SBC ${model.name}: projection material out of range`);
        mat.projectionMap = true;
        p += 3;
        break;
      }
      case 0x09:
      case 0x0a:
      case 0x0c:
        throw new Error(`SBC ${model.name}: command 0x${op.toString(16)} (skinning/CALLDL/env/proj map) is not supported`);
      default:
        throw new Error(`SBC ${model.name}: unknown command 0x${cmd.toString(16)} at 0x${p.toString(16)}`);
    }
  }
}

/** Decodes a shape's display list into primitives (positions already multiplied by posScale). */
export function decodeShape(model: Model, shape: Shape, initialColor: [number, number, number]): Primitive[] {
  return decodeDisplayList(model.reader, shape.dlStart, shape.dlEnd, model.posScale, initialColor);
}
