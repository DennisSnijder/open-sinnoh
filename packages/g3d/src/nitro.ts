import { Reader } from '@opensinnoh/nds';

/** A G3D file (BMD0, BTX0, BTA0, …): magic plus its blocks by 4CC. Offsets are absolute in `bytes`. */
export interface NitroFile {
  magic: string;
  reader: Reader;
  blocks: Map<string, number>;
}

export function readNitroFile(bytes: Uint8Array, expect: string): NitroFile {
  const r = new Reader(bytes);
  const magic = r.ascii(0, 4);
  if (magic !== expect) throw new Error(`G3D: expected ${expect}, got "${magic}"`);
  if (r.u16(4) !== 0xfeff) throw new Error(`G3D ${magic}: bad byte-order mark`);
  const size = r.u32(8);
  if (size > bytes.length) throw new Error(`G3D ${magic}: header size ${size} exceeds ${bytes.length} bytes`);
  const count = r.u16(0x0e);
  const blocks = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const o = r.u32(0x10 + i * 4);
    blocks.set(r.ascii(o, 4), o);
  }
  return { magic, reader: r, blocks };
}

export function block(file: NitroFile, name: string): number {
  const o = file.blocks.get(name);
  if (o === undefined) throw new Error(`G3D ${file.magic}: no ${name} block`);
  return o;
}

export interface DictEntry {
  name: string;
  /** Absolute offset of this entry's data unit. */
  data: number;
}

/** ResDict at absolute offset `o`. The Patricia tree is skipped; entries are read in order. */
export function readDict(r: Reader, o: number): DictEntry[] {
  if (r.u8(o) !== 0) throw new Error(`G3D dict at 0x${o.toString(16)}: revision ${r.u8(o)}`);
  const n = r.u8(o + 1);
  const entries = o + r.u16(o + 6);
  const unit = r.u16(entries);
  const names = entries + r.u16(entries + 2);
  const out: DictEntry[] = [];
  for (let i = 0; i < n; i++) out.push({ name: r.ascii(names + i * 16, 16).replace(/\0.*$/s, ''), data: entries + 4 + i * unit });
  return out;
}
