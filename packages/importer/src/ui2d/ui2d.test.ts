/** NCER, NANR, the OBJ compositor, LZ members, picture descrambling and PNG, on bytes written here (the writers are the layout spec). */
import { compressLz10 } from '@opensinnoh/nds';
import { describe, expect, it } from 'vitest';
import { blankImage, pack, renderCell } from './compose.ts';
import { readNanr } from './nanr.ts';
import { readNcer } from './ncer.ts';
import { readNclr, readNcgrData } from './nitro2d.ts';
import { decodeImage, encodeImage, IndexedPng } from './png.ts';
import { encryptPt, MON_HEIGHT, MON_WIDTH, readMonPicture } from './pokegra.ts';

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
function file(magic: string, block: string, body: number[]): Uint8Array {
  const blockBytes = [...ascii(block), ...u32(8 + body.length), ...body];
  return Uint8Array.from([...ascii(magic), ...u16(0xfeff), ...u16(0x0100), ...u32(16 + blockBytes.length), ...u16(16), ...u16(1), ...blockBytes]);
}

interface OamSpec {
  x: number;
  y: number;
  shape: number;
  size: number;
  char: number;
  palette?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}
const oam = (o: OamSpec) => [
  ...u16((o.y & 0xff) | (o.shape << 14)),
  ...u16((o.x & 0x1ff) | (o.hFlip ? 0x1000 : 0) | (o.vFlip ? 0x2000 : 0) | (o.size << 14)),
  ...u16(o.char | ((o.palette ?? 0) << 12)),
];
/** NCER: extended bank (bounds zeroed), optional VRAM transfer ranges per cell. */
function ncer(cells: OamSpec[][], mapping: number, transfer?: [number, number][]): Uint8Array {
  const oams: number[] = [];
  const entries: number[] = [];
  for (const c of cells) {
    entries.push(...u16(c.length), ...u16(0), ...u32(oams.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    for (const o of c) oams.push(...oam(o));
  }
  const cellData = [...entries, ...oams];
  while (cellData.length % 4) cellData.push(0);
  const transferAt = transfer ? 0x18 + cellData.length : 0;
  const transferData = transfer ? [...u32(0x1000), ...u32(8), ...transfer.flatMap(([o, s]) => [...u32(o), ...u32(s)])] : [];
  return file('RECN', 'KBEC', [...u16(cells.length), ...u16(1), ...u32(0x18), ...u32(mapping), ...u32(transferAt), ...u32(0), ...u32(0), ...cellData, ...transferData]);
}
const ncgr = (data: number[], scanned = false) =>
  file('RGCN', 'RAHC', [...u16(0xffff), ...u16(0xffff), ...u32(3), ...u32(0), scanned ? 1 : 0, 0, 0, 0, ...u32(data.length), ...u32(0x18), ...data]);
const nclr = (colors: number[]) => file('RLCN', 'TTLP', [...u16(3), ...u16(0), ...u32(0), ...u32(0x200 - 0x20), ...u32(0x10), ...colors.flatMap(u16)]);

const RED = 0x001f;
const GREEN = 0x03e0;
const BLUE = 0x7c00;
/** A 4bpp character filled with one index. */
const solid = (i: number) => Array<number>(32).fill(i | (i << 4));

describe('NCER and the compositor', () => {
  it('reads OAM shapes, sizes, signed positions and flips', () => {
    const bank = readNcer(ncer([[{ x: -8, y: -4, shape: 1, size: 0, char: 1, palette: 2, hFlip: true }, { x: 300, y: 200, shape: 2, size: 1, char: 3, vFlip: true }]], 1));
    expect(bank.mapping).toBe(1);
    const [a, b] = bank.cells[0]!.oams;
    expect(a).toMatchObject({ x: -8, y: -4, width: 16, height: 8, char: 1, palette: 2, hFlip: true, vFlip: false, bitDepth: 4 });
    expect(b).toMatchObject({ x: 300 - 512, y: 200 - 256, width: 8, height: 32, vFlip: true });
  });

  it('draws OAMs from 1D characters with flips and palettes, first OAM on top', () => {
    // Characters: 0 index 1, 1 index 2 with one index-3 pixel at its top-left, 2 index 3.
    const c1 = solid(2);
    c1[0] = 0x23;
    const chars = Uint8Array.from([...solid(1), ...c1, ...solid(3)]);
    const colors = Uint16Array.from([0, RED, GREEN, BLUE, ...Array<number>(12).fill(0), 0, BLUE, RED, GREEN]);
    // 32K mapping: char name = character. A 16×8 OAM (chars 1, 2) h-flipped over an 8×8 (char 0, palette 1).
    const bank = readNcer(ncer([[{ x: 0, y: 0, shape: 1, size: 0, char: 1, hFlip: true }, { x: -4, y: 0, shape: 0, size: 0, char: 0, palette: 1 }]], 0));
    const img = renderCell(bank.cells[0]!, chars, colors, { mapping: 0 });
    expect([img.width, img.height, img.originX, img.originY]).toEqual([20, 8, 4, 0]);
    const at = (x: number, y: number) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([0, 0, 255, 255]); // second OAM, palette 1 colour 1
    // h-flipped: char 2 (index 3) on the left, char 1 on the right with its marked pixel at the far right.
    expect(at(4, 0)).toEqual([0, 0, 255, 255]);
    expect(at(19, 0)).toEqual([0, 0, 255, 255]);
    expect(at(18, 0)).toEqual([0, 255, 0, 255]);
    // 64K mapping: char name 1 = byte 64 = character 2.
    const wide = renderCell(readNcer(ncer([[{ x: 0, y: 0, shape: 0, size: 0, char: 1 }]], 1)).cells[0]!, chars, colors, { mapping: 1 });
    expect([...wide.rgba.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    // An explicit palette replaces the OAM's.
    const forced = renderCell(bank.cells[0]!, chars, colors, { mapping: 0, palette: 0 });
    expect([...forced.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('takes a VRAM-transfer cell its own character range', () => {
    const chars = Uint8Array.from([...solid(1), ...solid(2)]);
    const bank = readNcer(ncer([[{ x: 0, y: 0, shape: 0, size: 0, char: 0 }], [{ x: 0, y: 0, shape: 0, size: 0, char: 0 }]], 1, [[0, 32], [32, 32]]));
    expect(bank.cells[1]!.transfer).toEqual({ offset: 32, size: 32 });
    const colors = Uint16Array.from([0, RED, GREEN]);
    expect([...renderCell(bank.cells[1]!, chars, colors, { mapping: 1 }).rgba.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  it('packs cells into one atlas, rows wrapping', () => {
    const cell = (w: number, h: number) => ({ ...blankImage(w, h), originX: 1, originY: 2 });
    const { image, cells } = pack([cell(200, 10), cell(100, 20), cell(50, 5)]);
    expect(cells.map((c) => [c.x, c.y, c.w, c.h, c.ox, c.oy])).toEqual([[0, 0, 200, 10, 1, 2], [0, 10, 100, 20, 1, 2], [100, 10, 50, 5, 1, 2]]);
    expect([image.width, image.height]).toEqual([200, 30]);
  });

  it('fails loudly on characters it cannot reach', () => {
    const bank = readNcer(ncer([[{ x: 0, y: 0, shape: 0, size: 1, char: 0 }]], 0));
    expect(() => renderCell(bank.cells[0]!, Uint8Array.from(solid(1)), Uint16Array.from([0, RED]), { mapping: 0 })).toThrow(/reads byte/);
  });
});

describe('NANR', () => {
  it('reads sequences of index, SRT and translation frames', () => {
    // Sequence 0: index frames (cells 0, 1); sequence 1: one SRT frame; sequence 2: one T frame.
    const seqs = [
      [...u16(2), ...u16(1), ...u16(0), ...u16(1), ...u32(2), ...u32(0)],
      [...u16(1), ...u16(0), ...u16(1), ...u16(1), ...u32(4), ...u32(16)],
      [...u16(1), ...u16(0), ...u16(2), ...u16(1), ...u32(1), ...u32(24)],
    ].flat();
    const frames = [
      [...u32(0), ...u16(5), ...u16(0xbeef)],
      [...u32(2), ...u16(7), ...u16(0xbeef)],
      [...u32(4), ...u16(3), ...u16(0xbeef)],
      [...u32(20), ...u16(9), ...u16(0xbeef)],
    ].flat();
    const results = [...u16(0), ...u16(1), ...u16(2), ...u16(0x4000), ...u32(0x2000), ...u32(0x1000), ...u16(3), ...u16(-4 & 0xffff), ...u16(3), ...u16(0), ...u16(5), ...u16(-6 & 0xffff)];
    const body = [...u16(3), ...u16(4), ...u32(0x18), ...u32(0x18 + seqs.length), ...u32(0x18 + seqs.length + frames.length), ...u32(0), ...u32(0), ...seqs, ...frames, ...results];
    const anims = readNanr(file('RNAN', 'KNBA', body));
    expect(anims[0]).toEqual({ mode: 'loop', loopStart: 1, frames: [{ cell: 0, ticks: 5 }, { cell: 1, ticks: 7 }] });
    expect(anims[1]).toEqual({ mode: 'pingpong-loop', loopStart: 0, frames: [{ cell: 2, ticks: 3, rotation: 0.25, scaleX: 2, scaleY: 1, dx: 3, dy: -4 }] });
    expect(anims[2]).toEqual({ mode: 'forward', loopStart: 0, frames: [{ cell: 3, ticks: 9, dx: 5, dy: -6 }] });
  });
});

describe('LZ10 members and palettes', () => {
  it('reads compressed members transparently and palettes shorter than they claim', () => {
    const plain = ncgr(solid(4));
    expect([...readNcgrData(compressLz10(plain)).data]).toEqual([...readNcgrData(plain).data]);
    expect([...readNclr(nclr([0, RED, GREEN])).colors]).toEqual([0, RED, GREEN]);
  });
});

describe('Platinum pictures', () => {
  it('unscrambles a 160×80 scanned picture', () => {
    const indexes = new Uint8Array(MON_WIDTH * MON_HEIGHT);
    for (let i = 4; i < indexes.length; i++) indexes[i] = (i * 7) % 16; // the first u16 (4 pixels) must be 0: it is the seed
    const data = new Uint8Array(indexes.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = indexes[i * 2]! | (indexes[i * 2 + 1]! << 4);
    encryptPt(data, 0xbeef);
    expect(data[0]! | (data[1]! << 8)).toBe(0xbeef);
    expect([...readMonPicture(ncgr([...data], true))]).toEqual([...indexes]);
    expect(() => readMonPicture(ncgr(solid(1), true))).toThrow(/expected 6400/);
    expect(() => readMonPicture(ncgr(solid(1)))).toThrow(/scanned 4bpp/);
  });
});

describe('PNG', () => {
  it('round-trips palette and RGBA images, and swaps palettes', () => {
    const img = blankImage(3, 2);
    img.rgba.set([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255], 0);
    expect(decodeImage(encodeImage(img))).toEqual(img);
    const many = blankImage(300, 1);
    for (let x = 0; x < 300; x++) many.rgba.set([x & 255, x >> 8, 7, 255], x * 4);
    expect(decodeImage(encodeImage(many))).toEqual(many);
    const png = new IndexedPng({ width: 2, height: 1, indexes: Uint8Array.from([0, 1]), palette: Uint8Array.from([0, 0, 0, 0, 10, 20, 30, 255]) });
    expect([...decodeImage(png.encode(Uint8Array.from([0, 0, 0, 0, 1, 2, 3, 255]))).rgba]).toEqual([0, 0, 0, 0, 1, 2, 3, 255]);
  });
});
