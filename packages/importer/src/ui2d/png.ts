/**
 * PNG for 2D art: palette PNGs (colour type 3 with tRNS) when an image has at most 256 distinct RGBA
 * values, which every DS 4bpp/8bpp image has; RGBA otherwise. Palette PNGs are several times smaller
 * and faster to compress than RGBA, and `withPalette` swaps a palette (shiny sprites) without
 * recompressing the pixels.
 */
import { unzlibSync, zlibSync } from 'fflate';
import type { Image } from './compose.ts';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function file(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let o = 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function ihdr(width: number, height: number, depth: number, colorType: number): Uint8Array {
  const b = new Uint8Array(13);
  const v = new DataView(b.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  b.set([depth, colorType, 0, 0, 0], 8);
  return b;
}

/** An indexed image: one palette index per pixel, palette entries as RGBA. */
export interface Indexed {
  width: number;
  height: number;
  indexes: Uint8Array;
  /** RGBA, 4 bytes per entry, at most 256 entries. */
  palette: Uint8Array;
}

/** The image as indexed pixels, or null when it has more than 256 distinct RGBA values. Index 0 is transparent black when present. */
export function toIndexed(img: Image): Indexed | null {
  const index = new Map<number, number>();
  const view = new DataView(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength);
  const indexes = new Uint8Array(img.width * img.height);
  for (let i = 0; i < indexes.length; i++) {
    const a = img.rgba[i * 4 + 3]!;
    const key = a ? view.getUint32(i * 4) : 0;
    let k = index.get(key);
    if (k === undefined) {
      if (index.size === 256) return null;
      k = index.size;
      index.set(key, k);
    }
    indexes[i] = k;
  }
  const palette = new Uint8Array(index.size * 4);
  const pv = new DataView(palette.buffer);
  for (const [key, k] of index) pv.setUint32(k * 4, key);
  return { width: img.width, height: img.height, indexes, palette };
}

/** Packed scanlines (filter 0) of an indexed image at 1, 2, 4 or 8 bits per pixel, zlib-compressed. */
function idat(img: Indexed, depth: number): Uint8Array {
  const stride = Math.ceil((img.width * depth) / 8);
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const v = img.indexes[y * img.width + x]!;
      const bit = x * depth;
      raw[y * (stride + 1) + 1 + (bit >> 3)]! |= v << (8 - depth - (bit & 7));
    }
  return zlibSync(raw, { level: 9 });
}

const depthFor = (entries: number) => (entries <= 2 ? 1 : entries <= 4 ? 2 : entries <= 16 ? 4 : 8);

/** A palette PNG with these pixels (compressed once) and `palette` (RGBA entries, same count). */
export class IndexedPng {
  private readonly data: Uint8Array;
  private readonly depth: number;
  constructor(readonly img: Indexed) {
    this.depth = depthFor(img.palette.length / 4);
    this.data = idat(img, this.depth);
  }
  encode(palette = this.img.palette): Uint8Array {
    if (palette.length !== this.img.palette.length) throw new Error(`PNG: palette of ${palette.length / 4} entries, expected ${this.img.palette.length / 4}`);
    const n = palette.length / 4;
    const plte = new Uint8Array(n * 3);
    const trns = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      plte.set(palette.subarray(i * 4, i * 4 + 3), i * 3);
      trns[i] = palette[i * 4 + 3]!;
    }
    let lastOpaque = n;
    while (lastOpaque > 0 && trns[lastOpaque - 1] === 255) lastOpaque--;
    const chunks = [chunk('IHDR', ihdr(this.img.width, this.img.height, this.depth, 3)), chunk('PLTE', plte)];
    if (lastOpaque) chunks.push(chunk('tRNS', trns.subarray(0, lastOpaque)));
    chunks.push(chunk('IDAT', this.data), chunk('IEND', new Uint8Array()));
    return file(chunks);
  }
}

/** Decodes the PNGs this module writes (filter 0; palette with tRNS, or RGBA 8-bit) back to RGBA: tests and the dev dump. */
export function decodeImage(png: Uint8Array): Image {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let type = 6;
  let plte: Uint8Array = new Uint8Array();
  let trns: Uint8Array = new Uint8Array();
  const idat: Uint8Array[] = [];
  while (o < png.length) {
    const n = v.getUint32(o);
    const kind = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const body = png.subarray(o + 8, o + 8 + n);
    if (kind === 'IHDR') [width, height, depth, type] = [v.getUint32(o + 8), v.getUint32(o + 12), body[8]!, body[9]!];
    if (kind === 'PLTE') plte = body;
    if (kind === 'tRNS') trns = body;
    if (kind === 'IDAT') idat.push(body);
    o += 12 + n;
  }
  if (type !== 3 && !(type === 6 && depth === 8)) throw new Error(`decodeImage: colour type ${type} depth ${depth}`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  idat.reduce((at, c) => (joined.set(c, at), at + c.length), 0);
  const raw = unzlibSync(joined);
  const rgba = new Uint8Array(width * height * 4);
  const stride = type === 3 ? Math.ceil((width * depth) / 8) : width * 4;
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    if (raw[row]) throw new Error(`decodeImage: filter ${raw[row]} (only 0 is written here)`);
    for (let x = 0; x < width; x++) {
      if (type === 6) {
        rgba.set(raw.subarray(row + 1 + x * 4, row + 5 + x * 4), (y * width + x) * 4);
        continue;
      }
      const bit = x * depth;
      const k = (raw[row + 1 + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      rgba.set([plte[k * 3]!, plte[k * 3 + 1]!, plte[k * 3 + 2]!, k < trns.length ? trns[k]! : 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** Encodes RGBA pixels: a palette PNG when possible, else RGBA. */
export function encodeImage(img: Image): Uint8Array {
  if (img.rgba.length !== img.width * img.height * 4) throw new Error(`PNG: ${img.rgba.length} bytes for ${img.width}×${img.height}`);
  const indexed = toIndexed(img);
  if (indexed) return new IndexedPng(indexed).encode();
  const raw = new Uint8Array((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * (img.width * 4 + 1) + 1);
  return file([chunk('IHDR', ihdr(img.width, img.height, 8, 6)), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())]);
}
