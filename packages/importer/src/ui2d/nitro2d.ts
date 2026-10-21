/**
 * Nitro 2D graphics shared by every 2D import (title, battle, menus): NCLR palettes, NCGR character
 * (tile) data, tiled or scanned (linear), and NSCR screens, plus a renderer that draws a screen with its
 * tiles from a simulated palette RAM, as the DS BG engine does. NCER cells and NANR animations are in
 * `ncer.ts`/`nanr.ts`. Layouts as GBATEK and NitroPaint describe them, checked on the ROM.
 *
 * Every 2D file is `magic, u16 0xFEFF, u16 version, u32 size, u16 header size (0x10), u16 blocks`,
 * then the blocks back to back, each `magic, u32 size (incl. its 8-byte header), data`. A member that
 * starts with 0x10 instead of a magic (every magic starts with 'R') is LZ10-compressed and is
 * decompressed first (decomp `.lz` members).
 */
import { decompressLz10, Reader } from '@opensinnoh/nds';

/** The member's bytes, LZ10-decompressed when it is compressed. */
export function unpack(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 ? decompressLz10(bytes) : bytes;
}

export function blocks(packed: Uint8Array, magic: string): { r: Reader; blocks: Map<string, number> } {
  const bytes = unpack(packed);
  const r = new Reader(bytes);
  if (r.ascii(0, 4) !== magic) throw new Error(`2D: expected ${magic}, got "${r.ascii(0, 4)}"`);
  if (r.u16(4) !== 0xfeff) throw new Error(`2D ${magic}: bad byte-order mark`);
  if (r.u32(8) > bytes.length) throw new Error(`2D ${magic}: header size ${r.u32(8)} exceeds ${bytes.length} bytes`);
  const out = new Map<string, number>();
  let o = r.u16(12);
  for (let i = 0; i < r.u16(14); i++) {
    const size = r.u32(o + 4);
    if (size < 8) throw new Error(`2D ${magic}: block ${r.ascii(o, 4)} of ${size} bytes`);
    out.set(r.ascii(o, 4), o);
    o += size;
  }
  return { r, blocks: out };
}

export function need(b: Map<string, number>, name: string, magic: string): number {
  const o = b.get(name);
  if (o === undefined) throw new Error(`2D ${magic}: no ${name} block`);
  return o;
}

/** NCLR (`RLCN`, block `TTLP`): `u16 bit depth (3 = 4bpp, 4 = 8bpp), u16, u32, u32 data size, u32 data offset (from block + 8)`. */
export interface Palette {
  bitDepth: 4 | 8;
  /** RGB555 colours. */
  colors: Uint16Array;
}

const depth = (v: number, what: string): 4 | 8 => {
  if (v === 3) return 4;
  if (v === 4) return 8;
  throw new Error(`2D ${what}: bit depth code ${v}`);
};

/**
 * `compressed`: read a compressed palette (block `PMCP`: u16 count, …; NNS_G2dGetUnpackedPaletteCompressInfo) as its
 * `count` 16-colour palettes in slot order, whatever the size field says (the Poffin Case's sprites: 10 palettes, a
 * size of 6). Only where a caller knows the file is one.
 */
export function readNclr(bytes: Uint8Array, options: { compressed?: boolean } = {}): Palette {
  const { r, blocks: b } = blocks(bytes, 'RLCN');
  const o = need(b, 'TTLP', 'NCLR');
  const at = o + 8 + r.u32(o + 20);
  // Many files state the 512-byte palette RAM size (less the header) but carry fewer colours: the block ends first.
  let size = Math.min(r.u32(o + 16), o + r.u32(o + 4) - at);
  if (options.compressed) {
    const comp = need(b, 'PMCP', 'NCLR');
    const count = r.u16(comp + 8);
    if (r.u16(o + 8) !== 3) throw new Error('2D NCLR: a compressed 8bpp palette');
    for (let i = 0; i < count; i++) if (r.u16(comp + 8 + r.u32(comp + 12) + i * 2) !== i) throw new Error('2D NCLR: a compressed palette out of slot order');
    if (o + r.u32(o + 4) - at < count * 32) throw new Error(`2D NCLR: ${count} compressed palettes overrun the block`);
    size = count * 32;
  }
  const colors = new Uint16Array(size / 2);
  for (let i = 0; i < colors.length; i++) colors[i] = r.u16(at + i * 2);
  // u16 bit depth, then a u16 some tools fill (nitrogfx "-comp"; 10 in pl_pokegra).
  return { bitDepth: depth(r.u16(o + 8), 'NCLR'), colors };
}

/**
 * NCGR (`RGCN`, block `RAHC`): `u16 height, u16 width (tiles; 0xFFFF = unknown), u32 bit depth,
 * u32 mapping, u8 0 = tiled (8×8 characters) / 1 = scanned (linear rows), u8 VRAM-transfer flag, u16,
 * u32 data size, u32 data offset (from block + 8)`.
 */
export interface CharacterData {
  bitDepth: 4 | 8;
  /** Size in tiles; -1 when the file leaves it unknown (0xFFFF, cell graphics). */
  width: number;
  height: number;
  scanned: boolean;
  /** The raw character bytes (a copy: callers may decrypt in place). */
  data: Uint8Array;
}

export function readNcgrData(bytes: Uint8Array): CharacterData {
  const { r, blocks: b } = blocks(bytes, 'RGCN');
  const o = need(b, 'RAHC', 'NCGR');
  const bitDepth = depth(r.u32(o + 12), 'NCGR');
  const scanned = r.u8(o + 20);
  if (scanned > 1) throw new Error(`2D NCGR: scan flag ${scanned}`);
  const size = r.u32(o + 24);
  const at = o + 8 + r.u32(o + 28);
  const signed = (v: number) => (v === 0xffff ? -1 : v);
  return { bitDepth, height: signed(r.u16(o + 8)), width: signed(r.u16(o + 10)), scanned: scanned === 1, data: r.slice(at, at + size).slice() };
}

/** Colour indexes of 4bpp/8bpp bytes, low nibble first (the left pixel). */
export function indexes(data: Uint8Array, bitDepth: 4 | 8): Uint8Array {
  if (bitDepth === 8) return data;
  const out = new Uint8Array(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    out[i * 2] = data[i]! & 15;
    out[i * 2 + 1] = data[i]! >> 4;
  }
  return out;
}

export interface Characters {
  bitDepth: 4 | 8;
  /** Colour index per pixel, 64 per 8×8 character (row-major inside the character). */
  tiles: Uint8Array[];
}

/** Tiled character data as 8×8 characters (`data`: already decoded bytes, e.g. a VRAM-transfer slice). */
export function charactersOf(data: Uint8Array, bitDepth: 4 | 8): Characters {
  const tileBytes = bitDepth * 8;
  if (data.length % tileBytes) throw new Error(`2D NCGR: ${data.length} bytes is not a whole number of characters`);
  const px = indexes(data, bitDepth);
  const tiles: Uint8Array[] = [];
  for (let t = 0; t < data.length / tileBytes; t++) tiles.push(px.subarray(t * 64, t * 64 + 64));
  return { bitDepth, tiles };
}

export function readNcgr(bytes: Uint8Array): Characters {
  const c = readNcgrData(bytes);
  if (c.scanned) throw new Error('2D NCGR: scanned (linear) character data; use readNcgrData');
  return charactersOf(c.data, c.bitDepth);
}

/**
 * NSCR (`RCSN`, block `NRCS`): `u16 width, u16 height (px), u32 format, u32 data size`, then u16
 * entries: bits 0–9 character, 10 h-flip, 11 v-flip, 12–15 palette. Maps wider than 256 px are stored
 * as the hardware's 32×32-entry screen blocks.
 */
export interface Screen {
  width: number;
  height: number;
  entries: Uint16Array;
}

export function readNscr(bytes: Uint8Array): Screen {
  const { r, blocks: b } = blocks(bytes, 'RCSN');
  const o = need(b, 'NRCS', 'NSCR');
  const width = r.u16(o + 8);
  const height = r.u16(o + 10);
  const size = r.u32(o + 16);
  if (width % 8 || height % 8 || size < (width / 8) * (height / 8) * 2) throw new Error(`2D NSCR: ${size} bytes for ${width}×${height}`);
  const entries = new Uint16Array(size / 2);
  for (let i = 0; i < entries.length; i++) entries[i] = r.u16(o + 20 + i * 2);
  return { width, height, entries };
}

/**
 * Palette RAM for one BG: 256 colours (16 palettes × 16 for 4bpp, or one 256-colour palette), or, for
 * 8bpp with extended palettes, 16 × 256 (the entry's palette bits pick one).
 */
export class PaletteRam {
  readonly colors: Uint16Array;
  constructor(readonly extended = false) {
    this.colors = new Uint16Array(extended ? 16 * 256 : 256);
  }
  /** Copies `size` bytes (0 = all) of a palette file's colours to byte offset `offset` (decomp Graphics_LoadPalette). */
  load(palette: Palette, offset = 0, size = 0): this {
    const n = (size || palette.colors.length * 2) / 2;
    if (offset % 2 || offset / 2 + n > this.colors.length) throw new Error(`PaletteRam: ${n} colours at byte ${offset} overflow ${this.colors.length}`);
    this.colors.set(palette.colors.subarray(0, n), offset / 2);
    return this;
  }
}

/** RGB555 → [r, g, b] 0–255 (DS 5-bit channels scaled as x * 255 / 31). */
export const rgb555 = (c: number): [number, number, number] => [c & 31, (c >> 5) & 31, (c >> 10) & 31].map((v) => Math.round((v * 255) / 31)) as [number, number, number];

/**
 * Draws `screen` (or its top-left `width`×`height`) to RGBA. Colour index 0 of every palette is
 * transparent (the BG backdrop shows through), as on the DS.
 */
export function renderScreen(screen: Screen, chars: Characters, ram: PaletteRam, width = screen.width, height = screen.height): Uint8Array {
  if (width > screen.width || height > screen.height) throw new Error(`renderScreen: ${width}×${height} exceeds the ${screen.width}×${screen.height} screen`);
  const out = new Uint8Array(width * height * 4);
  const blocksWide = Math.max(1, screen.width / 256);
  for (let ty = 0; ty < height / 8; ty++)
    for (let tx = 0; tx < width / 8; tx++) {
      // A map narrower than a hardware screen (the box wallpapers' 21 tiles) is stored row by row.
      const e = screen.width < 256 ? screen.entries[ty * (screen.width / 8) + tx]! : screen.entries[((tx >> 5) + (ty >> 5) * blocksWide) * 1024 + (ty & 31) * 32 + (tx & 31)]!;
      const tile = chars.tiles[e & 0x3ff];
      if (!tile) throw new Error(`renderScreen: entry at ${tx},${ty} names character ${e & 0x3ff} of ${chars.tiles.length}`);
      const pal = e >> 12;
      const base = chars.bitDepth === 4 ? pal * 16 : ram.extended ? pal * 256 : 0;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const index = tile[(e & 0x800 ? 7 - y : y) * 8 + (e & 0x400 ? 7 - x : x)]!;
          if (index === 0) continue;
          const [cr, cg, cb] = rgb555(ram.colors[base + index]!);
          out.set([cr, cg, cb, 255], ((ty * 8 + y) * width + tx * 8 + x) * 4);
        }
    }
  return out;
}
