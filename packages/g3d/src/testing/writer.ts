/**
 * Original fixture writer for Nitro G3D files (BTX0, BMD0, BTA0) and the Platinum side tables
 * (billboard frame sequences, fldtanime). Test-only: it is also the executable spec of the layouts
 * our readers expect. Dict Patricia trees are written as zeros (our reader walks entries linearly).
 */

/** Growable little-endian byte buffer with patchable offsets. */
export class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private reserve(n: number): number {
    const at = this.length;
    if (at + n > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, at + n));
      next.set(this.buf);
      this.buf = next;
      this.view = new DataView(next.buffer);
    }
    this.length += n;
    return at;
  }
  u8(v: number): number {
    const at = this.reserve(1);
    this.view.setUint8(at, v);
    return at;
  }
  u16(v: number): number {
    const at = this.reserve(2);
    this.view.setUint16(at, v & 0xffff, true);
    return at;
  }
  u32(v: number): number {
    const at = this.reserve(4);
    this.view.setUint32(at, v >>> 0, true);
    return at;
  }
  ascii(s: string, n = s.length): number {
    const at = this.reserve(n);
    for (let i = 0; i < Math.min(n, s.length); i++) this.buf[at + i] = s.charCodeAt(i);
    return at;
  }
  bytes(b: ArrayLike<number>): number {
    const at = this.reserve(b.length);
    this.buf.set(b, at);
    return at;
  }
  align(n: number): void {
    while (this.length % n) this.u8(0);
  }
  setU16(at: number, v: number): void {
    this.view.setUint16(at, v & 0xffff, true);
  }
  setU32(at: number, v: number): void {
    this.view.setUint32(at, v >>> 0, true);
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

const fx32 = (v: number) => Math.round(v * 4096);

/**
 * ResDict: header, zeroed tree, entry units, names. `unit` writes exactly `unitSize` bytes and gets
 * the absolute position of the unit (for patching offsets relative to other bases).
 */
export function writeDict(w: Writer, names: string[], unitSize: number, unit: (i: number, at: number) => void): void {
  const n = names.length;
  const start = w.length;
  const ofsEntry = 8 + (n + 1) * 4;
  w.u8(0);
  w.u8(n);
  const size = w.u16(0);
  w.u16(0);
  w.u16(ofsEntry);
  for (let i = 0; i <= n; i++) w.u32(0);
  w.u16(unitSize);
  w.u16(4 + n * unitSize);
  for (let i = 0; i < n; i++) {
    const at = w.length;
    unit(i, at);
    if (w.length !== at + unitSize) throw new Error(`dict unit ${i} wrote ${w.length - at} bytes, expected ${unitSize}`);
  }
  for (const name of names) {
    if (name.length > 16) throw new Error(`dict name too long: ${name}`);
    w.ascii(name, 16);
  }
  w.setU16(size, w.length - start);
}

/** Nitro file: header, block offsets, blocks (each already starting with its magic + size). */
export function writeNitroFile(magic: string, blocks: Uint8Array[]): Uint8Array {
  const w = new Writer();
  w.ascii(magic, 4);
  w.u16(0xfeff);
  w.u16(2);
  const size = w.u32(0);
  w.u16(16);
  w.u16(blocks.length);
  const offs = blocks.map(() => w.u32(0));
  blocks.forEach((b, i) => {
    w.align(4);
    w.setU32(offs[i] as number, w.length);
    w.bytes(b);
  });
  w.setU32(size, w.length);
  return w.done();
}

/** Starts a block: returns the writer and a function that patches the size and returns the bytes. */
function blockWriter(magic: string): [Writer, () => Uint8Array] {
  const w = new Writer();
  w.ascii(magic, 4);
  const size = w.u32(0);
  return [
    w,
    () => {
      w.align(4);
      w.setU32(size, w.length);
      return w.done();
    },
  ];
}

// ---------------------------------------------------------------- TEX0

export const FORMAT_CODES = { a3i5: 1, '4c': 2, '16c': 3, '256c': 4, '4x4': 5, a5i3: 6, direct: 7 } as const;

export interface TextureSpec {
  name: string;
  format: keyof typeof FORMAT_CODES;
  width: number;
  height: number;
  /** Raw texel bytes in DS layout. */
  texels: ArrayLike<number>;
  color0Transparent?: boolean;
  repeatS?: boolean;
  repeatT?: boolean;
  flipS?: boolean;
  flipT?: boolean;
}

export interface PaletteSpec {
  name: string;
  /** rgb555 colours. */
  colors: number[];
}

export function texParam(t: Omit<TextureSpec, 'name' | 'texels'>, offset8 = 0): number {
  const log = (v: number) => Math.log2(v / 8);
  return (
    (offset8 & 0xffff) |
    (Number(!!t.repeatS) << 16) |
    (Number(!!t.repeatT) << 17) |
    (Number(!!t.flipS) << 18) |
    (Number(!!t.flipT) << 19) |
    (log(t.width) << 20) |
    (log(t.height) << 23) |
    (FORMAT_CODES[t.format] << 26) |
    (Number(!!t.color0Transparent) << 29)
  ) >>> 0;
}

export function writeTex0(textures: TextureSpec[], palettes: PaletteSpec[]): Uint8Array {
  if (textures.some((t) => t.format === '4x4')) throw new Error('fixture writer: 4x4 textures are not supported');
  const [w, finish] = blockWriter('TEX0');
  const texInfo = w.length;
  w.u32(0);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u32(0);
  for (let i = 0; i < 5; i++) w.u32(0); // tex4x4Info (unused)
  const plttInfo = w.length;
  w.u32(0);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u16(0);
  w.u32(0);
  // texel data offsets (relative to texture data start, 8-byte aligned)
  const texOffsets: number[] = [];
  let texSize = 0;
  for (const t of textures) {
    texOffsets.push(texSize);
    texSize += Math.ceil(t.texels.length / 8) * 8;
  }
  const palOffsets: number[] = [];
  let palSize = 0;
  for (const p of palettes) {
    palOffsets.push(palSize);
    palSize += Math.ceil((p.colors.length * 2) / 8) * 8;
  }
  w.setU16(texInfo + 0x06, w.length);
  writeDict(w, textures.map((t) => t.name), 8, (i) => {
    const t = textures[i] as TextureSpec;
    w.u32(texParam(t, (texOffsets[i] as number) >> 3));
    w.u32((t.width | (t.height << 11) | 0x80000000) >>> 0);
  });
  w.setU16(plttInfo + 0x08, w.length);
  writeDict(w, palettes.map((p) => p.name), 4, (i) => {
    w.u16((palOffsets[i] as number) >> 3);
    w.u16(Number((palettes[i] as PaletteSpec).colors.length <= 4));
  });
  w.align(8);
  w.setU32(texInfo + 0x0c, w.length);
  w.setU16(texInfo + 0x04, texSize >> 3);
  textures.forEach((t) => {
    w.bytes(t.texels);
    w.align(8);
  });
  w.setU32(plttInfo + 0x0c, w.length);
  w.setU16(plttInfo + 0x04, palSize >> 3);
  palettes.forEach((p) => {
    p.colors.forEach((c) => w.u16(c));
    w.align(8);
  });
  return finish();
}

export function writeBtx0(textures: TextureSpec[], palettes: PaletteSpec[]): Uint8Array {
  return writeNitroFile('BTX0', [writeTex0(textures, palettes)]);
}

// ---------------------------------------------------------------- display lists

export const GX = {
  NOP: 0x00, COLOR: 0x20, NORMAL: 0x21, TEXCOORD: 0x22, VTX_16: 0x23, VTX_10: 0x24, VTX_XY: 0x25, VTX_XZ: 0x26, VTX_YZ: 0x27,
  VTX_DIFF: 0x28, BEGIN: 0x40, END: 0x41,
} as const;

const s16 = (v: number) => Math.round(v * 4096) & 0xffff;
const s10 = (v: number, scale: number) => Math.round(v * scale) & 0x3ff;

/** Parameter words for the vertex commands, from float inputs. */
export const gx = {
  color: (r: number, g: number, b: number): [number, number] => [GX.COLOR, r | (g << 5) | (b << 10)],
  normal: (x: number, y: number, z: number): [number, number] => [GX.NORMAL, s10(x, 512) | (s10(y, 512) << 10) | (s10(z, 512) << 20)],
  texcoord: (s: number, t: number): [number, number] => [GX.TEXCOORD, (Math.round(s * 16) & 0xffff) | ((Math.round(t * 16) & 0xffff) << 16)],
  vtx16: (x: number, y: number, z: number): [number, number, number] => [GX.VTX_16, s16(x) | (s16(y) << 16), s16(z)],
  vtx10: (x: number, y: number, z: number): [number, number] => [GX.VTX_10, s10(x, 64) | (s10(y, 64) << 10) | (s10(z, 64) << 20)],
  xy: (a: number, b: number): [number, number] => [GX.VTX_XY, s16(a) | (s16(b) << 16)],
  xz: (a: number, b: number): [number, number] => [GX.VTX_XZ, s16(a) | (s16(b) << 16)],
  yz: (a: number, b: number): [number, number] => [GX.VTX_YZ, s16(a) | (s16(b) << 16)],
  diff: (x: number, y: number, z: number): [number, number] => [GX.VTX_DIFF, s10(x, 4096) | (s10(y, 4096) << 10) | (s10(z, 4096) << 20)],
  begin: (type: 0 | 1 | 2 | 3): [number, number] => [GX.BEGIN, type],
  end: (): [number] => [GX.END],
  nop: (): [number] => [GX.NOP],
};

/** Packs commands (`[cmd, ...paramWords]`) 4 per packet, padding the last packet with NOPs. */
export function packDisplayList(cmds: number[][]): Uint8Array {
  const w = new Writer();
  for (let i = 0; i < cmds.length; i += 4) {
    const group = cmds.slice(i, i + 4);
    w.u32(group.reduce((acc, c, k) => acc | ((c[0] as number) << (k * 8)), 0));
    for (const c of group) for (const p of c.slice(1)) w.u32(p);
  }
  return w.done();
}

// ---------------------------------------------------------------- MDL0

export interface NodeSpec {
  name: string;
  /** Raw NodeData bytes after the flag word (see mdl0.ts), or identity. */
  flag?: number;
  m00?: number;
  /** Words written after flag+m00 (translation fx32, rotation fx16, scale fx32 …), as raw u16/u32 entries. */
  data?: { u16?: number; u32?: number }[];
}

export interface MaterialSpec {
  name: string;
  texture?: string;
  palette?: string;
  /** POLYGON_ATTR. Default: light0, front faces, opaque. */
  polyAttr?: number;
  diffAmb?: number;
  specEmi?: number;
  texParam?: number;
  flag?: number;
  width?: number;
  height?: number;
}

export interface ShapeSpec {
  name: string;
  flag?: number;
  dl: Uint8Array;
}

export interface ModelSpec {
  name: string;
  posScale?: number;
  numVertex: number;
  nodes?: NodeSpec[];
  materials: MaterialSpec[];
  shapes: ShapeSpec[];
  /** Raw SBC; default draws (MAT i, SHP i) under node 0 with POSSCALE. */
  sbc?: number[];
}

export const SBC = { NOP: 0, RET: 1, NODE: 2, MTX: 3, MAT: 4, SHP: 5, NODEDESC: 6, BB: 7, BBY: 8, POSSCALE: 0x0b } as const;

function defaultSbc(spec: ModelSpec): number[] {
  const out: number[] = [SBC.NODEDESC, 0, 0, 0, SBC.NODE, 0, 1, SBC.POSSCALE];
  spec.shapes.forEach((_, i) => out.push(SBC.MAT, Math.min(i, spec.materials.length - 1), SBC.SHP, i));
  out.push(SBC.POSSCALE | 0x20, SBC.RET);
  return out;
}

export function writeMdl0(models: ModelSpec[]): Uint8Array {
  const [w, finish] = blockWriter('MDL0');
  const block = 0;
  const modelOfs: number[] = [];
  writeDict(w, models.map((m) => m.name), 4, (_, at) => {
    modelOfs.push(at);
    w.u32(0);
  });
  models.forEach((spec, mi) => {
    w.align(4);
    const m = w.length;
    w.setU32(modelOfs[mi] as number, m - block);
    const size = w.u32(0);
    const ofsSbc = w.u32(0);
    const ofsMat = w.u32(0);
    const ofsShp = w.u32(0);
    w.u32(0); // ofsEvpMtx
    const nodes = spec.nodes ?? [{ name: 'root' }];
    w.bytes([0, 0, 0, nodes.length, spec.materials.length, spec.shapes.length, 1, 0]);
    const ps = spec.posScale ?? 1;
    w.u32(fx32(ps));
    w.u32(fx32(1 / ps));
    w.u16(spec.numVertex);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    for (let i = 0; i < 6; i++) w.u16(0);
    w.u32(4096);
    w.u32(4096);
    // NodeInfo
    const nodeInfo = w.length;
    const nodeOfs: number[] = [];
    writeDict(w, nodes.map((n) => n.name), 4, (_, at) => {
      nodeOfs.push(at);
      w.u32(0);
    });
    nodes.forEach((n, i) => {
      w.align(4);
      w.setU32(nodeOfs[i] as number, w.length - nodeInfo);
      w.u16(n.flag ?? 0x0007);
      w.u16((n.m00 ?? 0) & 0xffff);
      for (const d of n.data ?? []) {
        if (d.u16 !== undefined) w.u16(d.u16);
        if (d.u32 !== undefined) w.u32(d.u32);
      }
    });
    // SBC
    w.align(4);
    w.setU32(ofsSbc, w.length - m);
    w.bytes(spec.sbc ?? defaultSbc(spec));
    // Materials
    w.align(4);
    const mat = w.length;
    w.setU32(ofsMat, mat - m);
    const ofsTexToMat = w.u16(0);
    const ofsPlttToMat = w.u16(0);
    const matOfs: number[] = [];
    writeDict(w, spec.materials.map((x) => x.name), 4, (_, at) => {
      matOfs.push(at);
      w.u32(0);
    });
    const bindDict = (key: 'texture' | 'palette', ofsField: number) => {
      const names = [...new Set(spec.materials.map((x) => x[key]).filter((x): x is string => !!x))];
      w.align(4);
      w.setU16(ofsField, w.length - mat);
      const units: number[] = [];
      writeDict(w, names, 4, (_, at) => {
        units.push(at);
        w.u16(0);
        w.u8(0);
        w.u8(1);
      });
      names.forEach((name, i) => {
        const list = spec.materials.map((x, k) => (x[key] === name ? k : -1)).filter((k) => k >= 0);
        w.setU16(units[i] as number, w.length - mat);
        w.setU16((units[i] as number) + 2, list.length | (1 << 8)); // u8 numMat, u8 bound
        w.bytes(list);
      });
    };
    bindDict('texture', ofsTexToMat);
    bindDict('palette', ofsPlttToMat);
    spec.materials.forEach((x, i) => {
      w.align(4);
      w.setU32(matOfs[i] as number, w.length - mat);
      w.u16(0);
      w.u16(0x2c);
      w.u32(x.diffAmb ?? 0x7fff8000 + 0x7fff);
      w.u32(x.specEmi ?? 0);
      w.u32(x.polyAttr ?? 0x1f0081);
      w.u32(0xffffffff);
      w.u32(x.texParam ?? 0x30000);
      w.u32(0xffffffff);
      w.u16(0);
      w.u16(x.flag ?? 0);
      w.u16(x.width ?? 0);
      w.u16(x.height ?? 0);
      w.u32(4096);
      w.u32(4096);
    });
    // Shapes
    w.align(4);
    const shp = w.length;
    w.setU32(ofsShp, shp - m);
    const shpOfs: number[] = [];
    writeDict(w, spec.shapes.map((s) => s.name), 4, (_, at) => {
      shpOfs.push(at);
      w.u32(0);
    });
    const dlOfs: number[] = [];
    spec.shapes.forEach((s, i) => {
      w.align(4);
      const at = w.length;
      w.setU32(shpOfs[i] as number, at - shp);
      w.u16(0);
      w.u16(16);
      w.u32(s.flag ?? 0);
      dlOfs.push(w.u32(0));
      w.u32(s.dl.length);
    });
    spec.shapes.forEach((s, i) => {
      w.align(4);
      const field = dlOfs[i] as number;
      w.setU32(field, w.length - (field - 8)); // relative to the shape start
      w.bytes(s.dl);
    });
    w.align(4);
    w.setU32(size, w.length - m);
  });
  return finish();
}

export function writeBmd0(models: ModelSpec[], tex?: { textures: TextureSpec[]; palettes: PaletteSpec[] }): Uint8Array {
  return writeNitroFile('BMD0', tex ? [writeMdl0(models), writeTex0(tex.textures, tex.palettes)] : [writeMdl0(models)]);
}

// ---------------------------------------------------------------- SRT0

export type TrackSpec = { const: number } | { fx16: number[] } | { fx32: number[] };

export interface SrtMaterialSpec {
  material: string;
  /** scaleS, scaleT, rotation (const: raw u32 cos<<16|sin), transS, transT */
  tracks: [TrackSpec, TrackSpec, TrackSpec, TrackSpec, TrackSpec];
}

export function writeBta0(name: string, frames: number, materials: SrtMaterialSpec[], rawInfo?: (track: number) => number | undefined): Uint8Array {
  const [w, finish] = blockWriter('SRT0');
  const animOfs: number[] = [];
  writeDict(w, [name], 4, (_, at) => {
    animOfs.push(at);
    w.u32(0);
  });
  w.align(4);
  const a = w.length;
  w.setU32(animOfs[0] as number, a);
  w.ascii('M\0AT', 4);
  w.u16(frames);
  w.u16(0);
  const pending: { at: number; track: TrackSpec }[] = [];
  writeDict(w, materials.map((m) => m.material), 40, (i) => {
    (materials[i] as SrtMaterialSpec).tracks.forEach((t, k) => {
      const raw = rawInfo?.(k);
      if ('const' in t) {
        w.u32(raw ?? (0x20000000 | frames));
        w.u32(t.const);
      } else {
        w.u32(raw ?? (('fx16' in t ? 0x10000000 : 0) | frames));
        pending.push({ at: w.u32(0), track: t });
      }
    });
  });
  for (const { at, track } of pending) {
    w.align(4);
    w.setU32(at, w.length - a);
    if ('fx16' in track) track.fx16.forEach((v) => w.u16(s16(v)));
    else if ('fx32' in track) track.fx32.forEach((v) => w.u32(fx32(v)));
  }
  return writeNitroFile('BTA0', [finish()]);
}

// ---------------------------------------------------------------- Platinum tables

export function writeFrameSequence(entries: { start: number; texture: number; palette?: number }[]): Uint8Array {
  const w = new Writer();
  w.u32(entries.length);
  entries.forEach((e) => w.u16(e.start));
  entries.forEach((e) => w.u8(e.texture));
  entries.forEach((e) => w.u8(e.palette ?? 0));
  return w.done();
}

export function writeFrameSwapTable(entries: { texture: string; frames: { index: number; duration: number }[] }[]): Uint8Array {
  const w = new Writer();
  w.u32(entries.length);
  for (const e of entries) {
    w.ascii(e.texture, 16);
    for (let k = 0; k < 18; k++) {
      const f = e.frames[k];
      if (f) {
        w.u8(f.index);
        w.u8(f.duration);
      } else {
        w.u8(k === e.frames.length ? 0xff : 0);
        w.u8(0);
      }
    }
  }
  return w.done();
}

// ---------------------------------------------------------------- JNT0

/** One axis: a constant, or per-frame samples stored as fx32 or fx16. */
export type AxisSpec = number | { fx32: number[] } | { fx16: number[] };

export interface JointTrackSpec {
  /** Absent = identity; `'rest'` = the model's own value. */
  translation?: [AxisSpec, AxisSpec, AxisSpec] | 'rest';
  /** Per-frame pivot rotations (rot3 entries), or one constant entry. Absent = identity. */
  rotation?: { pivot: number; neg: number; a: number; b: number }[] | 'rest';
  /** Absent = identity. Stored as (scale, inverse) pairs. */
  scale?: [AxisSpec, AxisSpec, AxisSpec] | 'rest';
}

export function writeBca0(name: string, frames: number, tracks: JointTrackSpec[]): Uint8Array {
  const [w, finish] = blockWriter('JNT0');
  const animOfs: number[] = [];
  writeDict(w, [name], 4, (_, at) => {
    animOfs.push(at);
    w.u32(0);
  });
  w.align(4);
  const a = w.length;
  w.setU32(animOfs[0] as number, a);
  w.ascii('J\0AC', 4);
  w.u16(frames);
  w.u16(tracks.length);
  w.u32(0);
  const ofsRot3 = w.u32(0);
  const ofsRot5 = w.u32(0);
  const tagOfs = tracks.map(() => w.u16(0));
  const pending: { at: number; write: () => void }[] = [];
  const rot3: { pivot: number; neg: number; a: number; b: number }[] = [];
  const axes = (spec: [AxisSpec, AxisSpec, AxisSpec], pair: boolean, constBits: number[]): number => {
    let flag = 0;
    spec.forEach((ax, k) => {
      if (typeof ax === 'number') {
        flag |= constBits[k] as number;
        w.u32(fx32(ax));
        if (pair) w.u32(fx32(1 / ax));
        return;
      }
      const fx16 = 'fx16' in ax;
      const values = 'fx16' in ax ? ax.fx16 : ax.fx32;
      if (values.length !== frames) throw new Error(`writeBca0: axis has ${values.length} samples, expected ${frames}`);
      w.u32((frames << 16) | (fx16 ? 0x20000000 : 0));
      const at = w.u32(0);
      pending.push({
        at,
        write: () => {
          for (const v of values) {
            for (const x of pair ? [v, 1 / v] : [v]) {
              if (fx16) w.u16(s16(x));
              else w.u32(fx32(x));
            }
          }
        },
      });
    });
    return flag;
  };
  tracks.forEach((t, i) => {
    w.align(4);
    w.setU16(tagOfs[i] as number, w.length - a);
    const flagAt = w.u16(0);
    w.u8(0);
    w.u8(i);
    let flag = 0;
    if (!t.translation) flag |= 0x2;
    else if (t.translation === 'rest') flag |= 0x4;
    else flag |= axes(t.translation, false, [0x8, 0x10, 0x20]);
    const rotation = t.rotation;
    if (!rotation) flag |= 0x40;
    else if (rotation === 'rest') flag |= 0x80;
    else if (rotation.length === 1) {
      flag |= 0x100;
      w.u32(0x8000 | (rot3.push(rotation[0]!) - 1));
    } else {
      if (rotation.length !== frames) throw new Error(`writeBca0: ${rotation.length} rotations, expected ${frames}`);
      const first = rot3.length;
      rot3.push(...rotation);
      w.u32(frames << 16);
      pending.push({ at: w.u32(0), write: () => rotation.forEach((_, k) => w.u16(0x8000 | (first + k))) });
    }
    if (!t.scale) flag |= 0x200;
    else if (t.scale === 'rest') flag |= 0x400;
    else flag |= axes(t.scale, true, [0x800, 0x1000, 0x2000]);
    w.setU16(flagAt, flag);
  });
  w.align(4);
  w.setU32(ofsRot3, w.length - a);
  for (const r of rot3) {
    w.u16(r.pivot | (r.neg << 4));
    w.u16(s16(r.a));
    w.u16(s16(r.b));
  }
  w.align(4);
  w.setU32(ofsRot5, w.length - a);
  for (const { at, write } of pending) {
    w.align(4);
    w.setU32(at, w.length - a);
    write();
  }
  return writeNitroFile('BCA0', [finish()]);
}
