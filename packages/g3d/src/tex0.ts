import type { Reader } from '@opensinnoh/nds';
import { block, readDict, readNitroFile } from './nitro.ts';

export const TEXEL_FORMATS = ['none', 'a3i5', '4c', '16c', '256c', '4x4', 'a5i3', 'direct'] as const;
export type TexelFormat = (typeof TEXEL_FORMATS)[number];

export interface TextureInfo {
  name: string;
  /** Raw TEXIMAGE_PARAM from the dict. */
  param: number;
  format: TexelFormat;
  width: number;
  height: number;
  color0Transparent: boolean;
  repeatS: boolean;
  repeatT: boolean;
  flipS: boolean;
  flipT: boolean;
  /** Absolute offset of the texel data. */
  data: number;
}

export interface PaletteInfo {
  name: string;
  /** Absolute offset of the BGR555 data. */
  data: number;
}

export interface Tex0 {
  reader: Reader;
  textures: TextureInfo[];
  palettes: PaletteInfo[];
  /** Absolute end of the palette data (bounds palette reads). */
  paletteEnd: number;
}

/** Parses the TEX0 block at absolute offset `o`. */
export function parseTex0(r: Reader, o: number): Tex0 {
  if (r.ascii(o, 4) !== 'TEX0') throw new Error(`TEX0: bad magic at 0x${o.toString(16)}`);
  const texData = o + r.u32(o + 0x14);
  const tex4x4Data = o + r.u32(o + 0x24);
  const plttDataSize = r.u16(o + 0x30) << 3;
  const plttData = o + r.u32(o + 0x38);
  const textures = readDict(r, o + r.u16(o + 0x0e)).map(({ name, data }): TextureInfo => {
    const param = r.u32(data);
    const format = TEXEL_FORMATS[(param >>> 26) & 7] as TexelFormat;
    if (format === 'none') throw new Error(`TEX0: texture ${name} has format 0`);
    return {
      name,
      param,
      format,
      width: 8 << ((param >>> 20) & 7),
      height: 8 << ((param >>> 23) & 7),
      color0Transparent: ((param >>> 29) & 1) === 1,
      repeatS: ((param >>> 16) & 1) === 1,
      repeatT: ((param >>> 17) & 1) === 1,
      flipS: ((param >>> 18) & 1) === 1,
      flipT: ((param >>> 19) & 1) === 1,
      data: (format === '4x4' ? tex4x4Data : texData) + ((param & 0xffff) << 3),
    };
  });
  const palettes = readDict(r, o + r.u16(o + 0x34)).map(({ name, data }) => ({ name, data: plttData + (r.u16(data) << 3) }));
  return { reader: r, textures, palettes, paletteEnd: plttData + plttDataSize };
}

/** TEX0 of a BTX0 or BMD0 file (null if a BMD0 has none). */
export function readTex0(bytes: Uint8Array): Tex0 | null {
  const f = readNitroFile(bytes, String.fromCharCode(...bytes.subarray(0, 4)) === 'BMD0' ? 'BMD0' : 'BTX0');
  if (f.magic === 'BMD0' && !f.blocks.has('TEX0')) return null;
  return parseTex0(f.reader, block(f, 'TEX0'));
}

export function findTexture(tex0: Tex0, name: string): TextureInfo {
  const t = tex0.textures.find((x) => x.name === name);
  if (!t) throw new Error(`TEX0: no texture "${name}"`);
  return t;
}

export function findPalette(tex0: Tex0, name: string): PaletteInfo {
  const p = tex0.palettes.find((x) => x.name === name);
  if (!p) throw new Error(`TEX0: no palette "${name}"`);
  return p;
}

export function rgb555(c: number): [number, number, number] {
  const e = (v: number) => (v << 3) | (v >> 2);
  return [e(c & 31), e((c >> 5) & 31), e((c >> 10) & 31)];
}

const PALETTE_SIZE: Record<TexelFormat, number> = { none: 0, a3i5: 32, '4c': 4, '16c': 16, '256c': 256, '4x4': 0, a5i3: 8, direct: 0 };

/**
 * Decodes a texture with a palette to RGBA8 (row-major, top row first).
 * `texels` may come from a different TEX0 than `tex` (frame swaps reuse the base texture's palette).
 */
export function decodeTexture(tex0: Tex0, tex: TextureInfo, palette: PaletteInfo | null, texels?: { reader: Reader; data: number }): Uint8Array {
  const { width: w, height: h, format } = tex;
  const out = new Uint8Array(w * h * 4);
  if (format === '4x4') throw new Error(`TEX0: texture ${tex.name} uses 4x4-compressed texels, which are not implemented (Platinum has none)`);
  const tr = texels ? texels.reader : tex0.reader;
  const base = texels ? texels.data : tex.data;
  if (format === 'direct') {
    for (let i = 0; i < w * h; i++) {
      const c = tr.u16(base + i * 2);
      out.set([...rgb555(c), c & 0x8000 ? 255 : 0], i * 4);
    }
    return out;
  }
  if (!palette) throw new Error(`TEX0: texture ${tex.name} (${format}) needs a palette`);
  const n = Math.min(PALETTE_SIZE[format], (tex0.paletteEnd - palette.data) >> 1);
  const colors: [number, number, number][] = [];
  for (let i = 0; i < n; i++) colors.push(rgb555(tex0.reader.u16(palette.data + i * 2)));
  const color = (idx: number): [number, number, number] => {
    const c = colors[idx];
    if (!c) throw new Error(`TEX0: texture ${tex.name} indexes colour ${idx} beyond palette ${palette.name} (${n} colours)`);
    return c;
  };
  const transparent0 = tex.color0Transparent;
  for (let i = 0; i < w * h; i++) {
    let idx: number;
    let a = 255;
    switch (format) {
      case 'a3i5': {
        const b = tr.u8(base + i);
        idx = b & 31;
        const a3 = b >> 5;
        a = expand5((a3 << 2) | (a3 >> 1));
        break;
      }
      case 'a5i3': {
        const b = tr.u8(base + i);
        idx = b & 7;
        a = expand5(b >> 3);
        break;
      }
      case '4c':
        idx = (tr.u8(base + (i >> 2)) >> ((i & 3) * 2)) & 3;
        break;
      case '16c':
        idx = (tr.u8(base + (i >> 1)) >> ((i & 1) * 4)) & 15;
        break;
      case '256c':
        idx = tr.u8(base + i);
        break;
      default:
        throw new Error(`TEX0: unexpected format ${format}`);
    }
    if (transparent0 && idx === 0 && format !== 'a3i5' && format !== 'a5i3') a = 0;
    out.set([...color(idx), a], i * 4);
  }
  return out;
}

function expand5(a5: number): number {
  return (a5 << 3) | (a5 >> 2);
}
