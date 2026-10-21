/**
 * Game Freak "NFGR" 2bpp font → Font record + PNG atlas (docs/research/graphics-formats.md §3.3).
 *
 * Layout: u32 headerSize, u32 widthTableOffset, u32 numGlyphs, u8 maxW, u8 maxH, u8 tilesW, u8 tilesH;
 * glyphs follow the header, each tilesW×tilesH 8×8 tiles in row-major tile order, 16 bytes per tile
 * (2 bytes per pixel row: the second byte holds pixels 0–3, the first pixels 4–7, leftmost pixel in the
 * high bits). Pixel values: 0 = transparent, 1 = foreground, 2 = shadow, 3 = background.
 * Glyph i is character code i + 1 in Game Freak's charmap.
 */
import type { Font } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { encodePng } from './png.ts';

/** RGBA per pixel value (fg / shadow on transparent), matching the field message colours closely enough. */
export const FONT_COLORS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [72, 72, 72, 255],
  [208, 208, 200, 255],
  [0, 0, 0, 0],
];

export interface NfgrFont {
  numGlyphs: number;
  maxWidth: number;
  maxHeight: number;
  cellWidth: number;
  cellHeight: number;
  widths: number[];
  /** Pixel values 0–3, glyph-major: glyph g pixel (x, y) at g*cellW*cellH + y*cellW + x. */
  pixels: Uint8Array;
}

export function readNfgr(bytes: Uint8Array): NfgrFont {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = v.getUint32(0, true);
  const widthTableOffset = v.getUint32(4, true);
  const numGlyphs = v.getUint32(8, true);
  const [maxWidth, maxHeight, tilesW, tilesH] = [bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!];
  const cellWidth = tilesW * 8;
  const cellHeight = tilesH * 8;
  const glyphBytes = tilesW * tilesH * 16;
  if (headerSize + numGlyphs * glyphBytes > widthTableOffset || widthTableOffset + numGlyphs > bytes.length) {
    throw new Error(`NFGR: inconsistent header (${numGlyphs} glyphs, width table at ${widthTableOffset}, ${bytes.length} bytes)`);
  }
  const pixels = new Uint8Array(numGlyphs * cellWidth * cellHeight);
  for (let g = 0; g < numGlyphs; g++) {
    for (let t = 0; t < tilesW * tilesH; t++) {
      const tx = (t % tilesW) * 8;
      const ty = Math.floor(t / tilesW) * 8;
      for (let row = 0; row < 8; row++) {
        const o = headerSize + g * glyphBytes + t * 16 + row * 2;
        for (let x = 0; x < 8; x++) {
          const byte = x < 4 ? bytes[o + 1]! : bytes[o]!;
          const value = (byte >> (6 - 2 * (x % 4))) & 3;
          pixels[g * cellWidth * cellHeight + (ty + row) * cellWidth + tx + x] = value;
        }
      }
    }
  }
  const widths = Array.from(bytes.subarray(widthTableOffset, widthTableOffset + numGlyphs));
  return { numGlyphs, maxWidth, maxHeight, cellWidth, cellHeight, widths, pixels };
}

/**
 * Converts an NFGR font for the importer. `charmap` maps Game Freak char codes to Unicode; glyphs whose
 * code has no single-code-point mapping are left out. Returns the record (atlas path `<pack>:fonts/<name>.png`)
 * and the PNG bytes; 16 glyphs per atlas row.
 */
export function importFont(
  nfgrBytes: Uint8Array,
  charmap: ReadonlyMap<number, string>,
  opts: { id?: Id; atlas?: Id } = {},
): { record: Font; png: Uint8Array; skipped: number } {
  const f = readNfgr(nfgrBytes);
  const keep: { glyph: number; char: string }[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (let g = 0; g < f.numGlyphs; g++) {
    const char = charmap.get(g + 1);
    if (char === undefined || Array.from(char).length !== 1 || seen.has(char)) {
      skipped++;
      continue;
    }
    seen.add(char);
    keep.push({ glyph: g, char });
  }
  const cols = 16;
  const rows = Math.max(1, Math.ceil(keep.length / cols));
  const width = cols * f.cellWidth;
  const height = rows * f.cellHeight;
  const rgba = new Uint8Array(width * height * 4);
  keep.forEach(({ glyph }, i) => {
    const ox = (i % cols) * f.cellWidth;
    const oy = Math.floor(i / cols) * f.cellHeight;
    for (let y = 0; y < f.cellHeight; y++)
      for (let x = 0; x < f.cellWidth; x++) {
        const value = f.pixels[glyph * f.cellWidth * f.cellHeight + y * f.cellWidth + x]!;
        rgba.set(FONT_COLORS[value]!, ((oy + y) * width + ox + x) * 4);
      }
  });
  const record: Font = {
    id: opts.id ?? 'platinum:FONT_MESSAGE',
    atlas: opts.atlas ?? 'platinum:fonts/message.png',
    cellWidth: f.cellWidth,
    cellHeight: f.cellHeight,
    chars: keep.map((k) => k.char).join(''),
    widths: keep.map((k) => f.widths[k.glyph]!),
  };
  return { record, png: encodePng(width, height, rgba), skipped };
}
