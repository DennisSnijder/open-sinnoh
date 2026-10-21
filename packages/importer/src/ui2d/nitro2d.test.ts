/** Nitro 2D decoders on original bytes written here (the writer below is the layout spec). */
import { describe, expect, it } from 'vitest';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, rgb555 } from './nitro2d.ts';

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A one-block 2D file: header, then `block` with its 8-byte header. */
function file(magic: string, block: string, body: number[]): Uint8Array {
  const blockBytes = [...ascii(block), ...u32(8 + body.length), ...body];
  return Uint8Array.from([...ascii(magic), ...u16(0xfeff), ...u16(0x0100), ...u32(16 + blockBytes.length), ...u16(16), ...u16(1), ...blockBytes]);
}

const nclr = (bitDepth: 3 | 4, colors: number[]) => file('RLCN', 'TTLP', [...u32(bitDepth), ...u32(0), ...u32(colors.length * 2), ...u32(0x10), ...colors.flatMap(u16)]);
const ncgr = (bitDepth: 3 | 4, data: number[]) => file('RGCN', 'RAHC', [...u16(0xffff), ...u16(0xffff), ...u32(bitDepth), ...u32(0), ...u32(0), ...u32(data.length), ...u32(0x18), ...data]);
const nscr = (width: number, height: number, entries: number[]) => file('RCSN', 'NRCS', [...u16(width), ...u16(height), ...u32(0), ...u32(entries.length * 2), ...entries.flatMap(u16)]);

const RED = 0x001f;
const GREEN = 0x03e0;
const BLUE = 0x7c00;

describe('nitro 2D', () => {
  it('reads palettes, 4bpp characters and screens', () => {
    const pal = readNclr(nclr(3, [0, RED, GREEN, BLUE]));
    expect(pal.bitDepth).toBe(4);
    expect([...pal.colors]).toEqual([0, RED, GREEN, BLUE]);
    // One character: left half index 1, right half index 2 (low nibble = left pixel).
    const chars = readNcgr(ncgr(3, Array.from({ length: 32 }, (_, i) => (i % 4 < 2 ? 0x11 : 0x22))));
    expect(chars.bitDepth).toBe(4);
    expect(chars.tiles).toHaveLength(1);
    expect([...chars.tiles[0]!.subarray(0, 8)]).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    const screen = readNscr(nscr(8, 8, [0]));
    expect(screen).toMatchObject({ width: 8, height: 8 });
    expect(rgb555(RED)).toEqual([255, 0, 0]);
  });

  it('renders with flips, palette banks and a transparent colour 0', () => {
    // Character 0: index 1 at (0,0), index 3 at (7,7), the rest 0.
    const data = Array<number>(32).fill(0);
    data[0] = 0x01;
    data[31] = 0x30;
    const chars = readNcgr(ncgr(3, data));
    const ram = new PaletteRam().load(readNclr(nclr(3, [0, RED, GREEN, BLUE])));
    ram.load(readNclr(nclr(3, [0, GREEN])), 32); // palette 1, colour 1 = green
    // Entries: plain, h+v flipped, palette 1.
    const px = renderScreen(readNscr(nscr(24, 8, [0x0000, 0x0c00, 0x1000])), chars, ram);
    const at = (x: number, y: number) => [...px.subarray((y * 24 + x) * 4, (y * 24 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(7, 7)).toEqual([0, 0, 255, 255]);
    expect(at(1, 0)).toEqual([0, 0, 0, 0]);
    expect(at(8, 0)).toEqual([0, 0, 255, 255]); // flipped: (7,7) lands at (0,0)
    expect(at(15, 7)).toEqual([255, 0, 0, 255]);
    expect(at(16, 0)).toEqual([0, 255, 0, 255]);
  });

  it('renders 8bpp characters through extended palettes', () => {
    const chars = readNcgr(ncgr(4, Array<number>(64).fill(2)));
    expect(chars.bitDepth).toBe(8);
    const ram = new PaletteRam(true).load(readNclr(nclr(4, [0, 0, RED])), 0).load(readNclr(nclr(4, [0, 0, BLUE])), 512);
    const px = renderScreen(readNscr(nscr(16, 8, [0x0000, 0x1000])), chars, ram);
    expect([...px.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...px.subarray(8 * 4, 8 * 4 + 4)]).toEqual([0, 0, 255, 255]);
  });

  it('reads maps narrower than a screen row by row (the box wallpapers)', () => {
    const chars = readNcgr(ncgr(3, [...Array<number>(32).fill(0x11), ...Array<number>(32).fill(0x22)]));
    const ram = new PaletteRam().load(readNclr(nclr(3, [0, RED, GREEN])));
    // 2 × 2 tiles: row 0 = characters 0, 1; row 1 = 1, 0 (not 32 entries a row).
    const px = renderScreen(readNscr(nscr(16, 16, [0, 1, 1, 0])), chars, ram);
    const at = (x: number, y: number) => [...px.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
    expect([at(0, 0), at(8, 0), at(0, 8), at(8, 8)]).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ]);
  });

  it('reads 512-wide maps as two screen blocks', () => {
    const chars = readNcgr(ncgr(3, [...Array<number>(32).fill(0x11), ...Array<number>(32).fill(0x22)]));
    const ram = new PaletteRam().load(readNclr(nclr(3, [0, RED, GREEN])));
    // Block 0 (x 0–255) all character 0, block 1 (x 256–511) all character 1.
    const entries = [...Array<number>(1024).fill(0), ...Array<number>(1024).fill(1)];
    const px = renderScreen(readNscr(nscr(512, 256, entries)), chars, ram, 512, 8);
    expect([...px.subarray(255 * 4, 256 * 4)]).toEqual([255, 0, 0, 255]);
    expect([...px.subarray(256 * 4, 257 * 4)]).toEqual([0, 255, 0, 255]);
  });

  it('fails loudly on bad input', () => {
    expect(() => readNclr(nscr(8, 8, [0]))).toThrow(/expected RLCN/);
    expect(() => readNcgr(ncgr(3, [1, 2, 3]))).toThrow(/whole number/);
    const chars = readNcgr(ncgr(3, Array<number>(32).fill(0)));
    expect(() => renderScreen(readNscr(nscr(8, 8, [5])), chars, new PaletteRam())).toThrow(/character 5/);
    expect(() => new PaletteRam().load(readNclr(nclr(3, [1, 2])), 510)).toThrow(/overflow/);
  });
});
