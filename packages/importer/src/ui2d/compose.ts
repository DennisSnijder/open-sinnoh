/**
 * The OBJ compositor: draws an NCER cell (its OAMs over the NCGR characters with a palette) to RGBA,
 * as the DS OBJ engine would at the cell's position, and packs cells into one atlas image.
 */
import type { Cell } from './ncer.ts';
import { rgb555 } from './nitro2d.ts';

export interface Image {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** A drawn cell: `origin` is where the cell's (0, 0) (the sprite position) lies inside the image. */
export interface CellImage extends Image {
  originX: number;
  originY: number;
}

export const blankImage = (width: number, height: number): Image => ({ width, height, rgba: new Uint8Array(width * height * 4) });

/**
 * Copies `src` into `dst` at (x, y); transparent source pixels (alpha 0) leave `dst` as it is. A pixel
 * outside `dst` throws, unless `clip` (a screen composition) drops it.
 */
export function blit(dst: Image, src: Image, x: number, y: number, clip = false): void {
  for (let sy = 0; sy < src.height; sy++)
    for (let sx = 0; sx < src.width; sx++) {
      const s = (sy * src.width + sx) * 4;
      if (!src.rgba[s + 3]) continue;
      const dx = x + sx;
      const dy = y + sy;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) {
        if (clip) continue;
        throw new Error(`blit: pixel (${dx}, ${dy}) outside ${dst.width}×${dst.height}`);
      }
      dst.rgba.set(src.rgba.subarray(s, s + 4), (dy * dst.width + dx) * 4);
    }
}

/** Copies the `w`×`h` rect at (x, y) out of `src`. */
export function crop(src: Image, x: number, y: number, w: number, h: number): Image {
  if (x < 0 || y < 0 || x + w > src.width || y + h > src.height) throw new Error(`crop: ${w}×${h} at (${x}, ${y}) outside ${src.width}×${src.height}`);
  const out = blankImage(w, h);
  for (let row = 0; row < h; row++) out.rgba.set(src.rgba.subarray(((y + row) * src.width + x) * 4, ((y + row) * src.width + x + w) * 4), row * w * 4);
  return out;
}

export interface DrawOptions {
  /** 0–4: the bank's character mapping (`CellBank.mapping`). */
  mapping: number;
  /** Replaces every OAM's palette number (NNS explicit palette offset, e.g. trainer sprites). */
  palette?: number;
}

/**
 * Draws `cell` from `chars` (decoded NCGR bytes; for a VRAM-transfer cell, the whole file: the cell's
 * range is taken here) with `colors` (16 per 4bpp palette; 8bpp OAMs index them directly). The first
 * OAM is on top, as on the DS. An affine OAM is drawn unrotated (identity matrix).
 */
export function renderCell(cell: Cell, chars: Uint8Array, colors: Uint16Array, opts: DrawOptions): CellImage {
  if (!cell.oams.length) return { ...blankImage(0, 0), originX: 0, originY: 0 };
  const data = cell.transfer ? chars.subarray(cell.transfer.offset, cell.transfer.offset + cell.transfer.size) : chars;
  if (cell.transfer && cell.transfer.offset + cell.transfer.size > chars.length) throw new Error(`renderCell: VRAM transfer ${cell.transfer.offset}+${cell.transfer.size} past ${chars.length} character bytes`);
  const box = (o: Cell['oams'][number]) => {
    const scale = o.doubleSize ? 2 : 1;
    return { x: o.x, y: o.y, w: o.width * scale, h: o.height * scale };
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of cell.oams) {
    const b = box(o);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const out: CellImage = { ...blankImage(maxX - minX, maxY - minY), originX: 0 - minX, originY: 0 - minY };
  for (const o of [...cell.oams].reverse()) {
    const b = box(o);
    const left = b.x - minX + (o.doubleSize ? o.width / 2 : 0);
    const top = b.y - minY + (o.doubleSize ? o.height / 2 : 0);
    const tileBytes = o.bitDepth * 8;
    const tilesWide = o.width / 8;
    const palette = opts.palette ?? o.palette;
    for (let py = 0; py < o.height; py++)
      for (let px = 0; px < o.width; px++) {
        const tx = px >> 3;
        const ty = py >> 3;
        const tileAt =
          opts.mapping === 4
            ? (o.char + ty * 32 + tx * (o.bitDepth / 4)) * 32
            : o.char * (32 << opts.mapping) + (ty * tilesWide + tx) * tileBytes;
        const inX = px & 7;
        const inY = py & 7;
        const at = tileAt + (o.bitDepth === 4 ? inY * 4 + (inX >> 1) : inY * 8 + inX);
        if (at >= data.length) throw new Error(`renderCell: OAM char ${o.char} reads byte ${at} of ${data.length}`);
        const byte = data[at]!;
        const index = o.bitDepth === 8 ? byte : inX & 1 ? byte >> 4 : byte & 15;
        if (!index) continue;
        const ci = o.bitDepth === 8 ? index : palette * 16 + index;
        const c = colors[ci];
        if (c === undefined) throw new Error(`renderCell: colour ${ci} of ${colors.length}`);
        const x = left + (o.hFlip ? o.width - 1 - px : px);
        const y = top + (o.vFlip ? o.height - 1 - py : py);
        const [r, g, bl] = rgb555(c);
        out.rgba.set([r, g, bl, 255], (y * out.width + x) * 4);
      }
  }
  return out;
}

/** An atlas rect plus the drawn cell's origin inside it (contracts `Ui2dCell`). */
export interface PackedCell {
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

/**
 * Packs images left to right in rows (no wider than `maxWidth`, or the widest image), in order. Rows are
 * as tall as their tallest image.
 */
export function pack(images: CellImage[], maxWidth = 256): { image: Image; cells: PackedCell[] } {
  const width = Math.max(maxWidth, ...images.map((i) => i.width));
  const cells: PackedCell[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const img of images) {
    if (x + img.width > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    cells.push({ x, y, w: img.width, h: img.height, ox: img.originX, oy: img.originY });
    x += img.width;
    rowHeight = Math.max(rowHeight, img.height);
  }
  const used = Math.max(1, ...cells.map((c) => c.x + c.w));
  const image = blankImage(used, Math.max(1, y + rowHeight));
  images.forEach((img, i) => blit(image, img, cells[i]!.x, cells[i]!.y));
  return { image, cells };
}
