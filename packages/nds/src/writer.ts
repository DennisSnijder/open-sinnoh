/**
 * Fixture writers: original DS ROM images and NARCs for tests (never on the import path). They write only
 * what our readers read: the header fields, the ARM9 with its footer, the overlay table, the FNT and FAT,
 * NARC archives.
 */

export interface RomImageOptions {
  title?: string;
  gameCode: string;
  makerCode?: string;
  version?: number;
  /** The ARM9 as stored (compressed or not) and its RAM address; `moduleParams` is its offset in it. */
  arm9: Uint8Array;
  arm9RamAddress?: number;
  moduleParams: number;
  /** Overlays in file id order (ids 0…), as stored; `ramSize` and `compressed` go to the overlay table. */
  overlays?: { bytes: Uint8Array; ramAddress: number; ramSize: number; compressed: boolean }[];
  /** Named files by absolute path (`/a/0/8/1`); directories are made as needed. */
  files: Record<string, Uint8Array>;
}

const align = (n: number, a = 4) => (n + a - 1) & ~(a - 1);

/** The ARM9 module parameters (crt0 `_start_ModuleParams`): 9 words, `compressedEnd` at +0x14 (RAM address, 0 = none). */
export function moduleParams(compressedEnd: number): Uint8Array {
  const b = new Uint8Array(0x24);
  const v = new DataView(b.buffer);
  v.setUint32(0x14, compressedEnd, true);
  v.setUint32(0x1c, 0xdec00621, true);
  v.setUint32(0x20, 0x2106c0de, true);
  return b;
}

interface Dir {
  name: string;
  dirs: Dir[];
  files: { name: string; bytes: Uint8Array }[];
}

export function writeRomImage(o: RomImageOptions): Uint8Array {
  // The directory tree, files sorted by path within each directory (ids in walk order).
  const root: Dir = { name: '', dirs: [], files: [] };
  for (const path of Object.keys(o.files).sort()) {
    const parts = path.split('/').filter(Boolean);
    let d = root;
    for (const p of parts.slice(0, -1)) {
      let next = d.dirs.find((x) => x.name === p);
      if (!next) d.dirs.push((next = { name: p, dirs: [], files: [] }));
      d = next;
    }
    d.files.push({ name: parts.at(-1)!, bytes: o.files[path]! });
  }
  const dirs: Dir[] = [];
  const number = (d: Dir) => {
    dirs.push(d);
    d.dirs.forEach(number);
  };
  number(root);
  const overlays = o.overlays ?? [];
  const fileBytes: Uint8Array[] = overlays.map((x) => x.bytes);
  const firstFile: number[] = [];
  // Each directory's files take consecutive ids, in directory order (the reader walks the same way).
  for (const d of dirs) {
    firstFile.push(fileBytes.length);
    for (const f of d.files) fileBytes.push(f.bytes);
  }
  const enc = new TextEncoder();
  const subtables = dirs.map((d) => {
    const out: number[] = [];
    for (const f of d.files) out.push(f.name.length, ...enc.encode(f.name));
    for (const c of d.dirs) out.push(c.name.length | 0x80, ...enc.encode(c.name), dirs.indexOf(c) & 0xff, 0xf0 | (dirs.indexOf(c) >> 8));
    out.push(0);
    return out;
  });
  // Files in a directory come before its subdirectories in the subtable; the reader numbers files by
  // entry order, which matches since every directory lists its files first.
  const fntSize = dirs.length * 8 + subtables.reduce((n, t) => n + t.length, 0);
  const header = 0x4000;
  const arm9At = header;
  const footerAt = arm9At + o.arm9.length;
  const ovtAt = align(footerAt + 12);
  const fatAt = align(ovtAt + overlays.length * 32);
  const fntAt = align(fatAt + fileBytes.length * 8);
  let at = align(fntAt + fntSize, 0x200);
  const offsets = fileBytes.map((b) => {
    const start = at;
    at = align(at + b.length, 0x200);
    return start;
  });
  const rom = new Uint8Array(at);
  const v = new DataView(rom.buffer);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => (rom[off + i] = c.charCodeAt(0)));
  ascii(0, (o.title ?? 'FIXTURE').slice(0, 12));
  ascii(0x0c, o.gameCode);
  ascii(0x10, o.makerCode ?? '01');
  rom[0x1e] = o.version ?? 0;
  v.setUint32(0x20, arm9At, true);
  v.setUint32(0x28, o.arm9RamAddress ?? 0x02000000, true);
  v.setUint32(0x2c, o.arm9.length, true);
  v.setUint32(0x40, fntAt, true);
  v.setUint32(0x44, fntSize, true);
  v.setUint32(0x48, fatAt, true);
  v.setUint32(0x4c, fileBytes.length * 8, true);
  v.setUint32(0x50, ovtAt, true);
  v.setUint32(0x54, overlays.length * 32, true);
  rom.set(o.arm9, arm9At);
  v.setUint32(footerAt, 0xdec00621, true);
  v.setUint32(footerAt + 4, o.moduleParams, true);
  overlays.forEach((x, i) => {
    const e = ovtAt + i * 32;
    v.setUint32(e, i, true);
    v.setUint32(e + 4, x.ramAddress, true);
    v.setUint32(e + 8, x.ramSize, true);
    v.setUint32(e + 24, i, true);
    v.setUint32(e + 28, (x.compressed ? 0x01000000 : 0) | (x.bytes.length & 0xffffff), true);
  });
  fileBytes.forEach((b, i) => {
    v.setUint32(fatAt + i * 8, offsets[i]!, true);
    v.setUint32(fatAt + i * 8 + 4, offsets[i]! + b.length, true);
    rom.set(b, offsets[i]!);
  });
  let sub = fntAt + dirs.length * 8;
  dirs.forEach((d, i) => {
    v.setUint32(fntAt + i * 8, sub - fntAt, true);
    v.setUint16(fntAt + i * 8 + 4, firstFile[i]!, true);
    v.setUint16(fntAt + i * 8 + 6, i === 0 ? dirs.length : 0xf000, true);
    rom.set(subtables[i]!, sub);
    sub += subtables[i]!.length;
  });
  return rom;
}

/** An original NARC from members (BTAF, an empty BTNF, GMIF). */
export function writeNarc(members: Uint8Array[]): Uint8Array {
  const btafSize = 12 + members.length * 8;
  const btnfSize = 16;
  let off = 0;
  const ranges = members.map((m) => {
    const r = [off, off + m.length] as const;
    off = align(off + m.length);
    return r;
  });
  const gmifSize = 8 + off;
  const total = 16 + btafSize + btnfSize + gmifSize;
  const b = new Uint8Array(total);
  const v = new DataView(b.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, 'NARC');
  v.setUint16(4, 0xfffe, true);
  v.setUint16(6, 0x0100, true);
  v.setUint32(8, total, true);
  v.setUint16(12, 16, true);
  v.setUint16(14, 3, true);
  let o = 16;
  tag(o, 'BTAF');
  v.setUint32(o + 4, btafSize, true);
  v.setUint16(o + 8, members.length, true);
  ranges.forEach(([s, e], i) => {
    v.setUint32(o + 12 + i * 8, s, true);
    v.setUint32(o + 16 + i * 8, e, true);
  });
  o += btafSize;
  tag(o, 'BTNF');
  v.setUint32(o + 4, btnfSize, true);
  v.setUint32(o + 8, 4, true);
  v.setUint16(o + 14, 1, true);
  o += btnfSize;
  tag(o, 'GMIF');
  v.setUint32(o + 4, gmifSize, true);
  members.forEach((m, i) => b.set(m, o + 8 + ranges[i]![0]));
  return b;
}
