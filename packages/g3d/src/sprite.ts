import { Reader } from '@opensinnoh/nds';
import { decodeTexture, type Tex0 } from './tex0.ts';

/** Billboard frame-sequence table (mmodel `.bin`): anim frame → texture dict index. */
export interface FrameSequence {
  startFrame: number[];
  textureIndex: number[];
  paletteIndex: number[];
}

export function readFrameSequence(bytes: Uint8Array): FrameSequence {
  const r = new Reader(bytes);
  const n = r.u32(0);
  if (bytes.length < 4 + n * 4) throw new Error(`frame sequence: ${n} entries in ${bytes.length} bytes`);
  const seq: FrameSequence = { startFrame: [], textureIndex: [], paletteIndex: [] };
  for (let i = 0; i < n; i++) {
    seq.startFrame.push(r.u16(4 + i * 2));
    seq.textureIndex.push(r.u8(4 + n * 2 + i));
    seq.paletteIndex.push(r.u8(4 + n * 3 + i));
    if (i && (seq.startFrame[i] as number) <= (seq.startFrame[i - 1] as number)) throw new Error('frame sequence: start frames not increasing');
  }
  if (seq.startFrame[0] !== 0) throw new Error('frame sequence: first entry does not start at frame 0');
  return seq;
}

/** Texture dict index shown at an animation frame. */
export function textureAt(seq: FrameSequence, frame: number): number {
  let idx = 0;
  seq.startFrame.forEach((s, i) => {
    if (s <= frame) idx = i;
  });
  return seq.textureIndex[idx] as number;
}

export interface SpriteAtlas {
  frameSize: number;
  frameCount: number;
  /** Atlas width × frameSize, frames left to right in numeric name order (`x.1` first). */
  width: number;
  rgba: Uint8Array;
  /** Texture dict index → atlas frame. */
  frameOfTexture: number[];
}

/**
 * Character BTX0 → horizontal atlas. Textures are `<base>.<n>` (n = 1..N, square, one size) and the
 * set has one palette. The dict is sorted as strings, so frames are ordered by the numeric suffix.
 * A set of one texture may have no suffix (static objects: `bag`, `monstarball`).
 */
export function buildSpriteAtlas(tex0: Tex0): SpriteAtlas {
  if (tex0.palettes.length !== 1) throw new Error(`sprite: expected 1 palette, got ${tex0.palettes.length}`);
  const palette = tex0.palettes[0]!;
  const frames = tex0.textures.map((t, dictIndex) => {
    const m = /\.(\d+)$/.exec(t.name);
    if (!m && tex0.textures.length === 1) return { t, dictIndex, n: 1 };
    if (!m) throw new Error(`sprite: texture name ${t.name} has no frame number`);
    return { t, dictIndex, n: Number(m[1]) };
  });
  frames.sort((a, b) => a.n - b.n);
  frames.forEach((f, i) => {
    if (f.n !== i + 1) throw new Error(`sprite: frame numbers are not 1..${frames.length} (found ${f.t.name})`);
  });
  const size = frames[0]!.t.width;
  for (const { t } of frames) if (t.width !== size || t.height !== size) throw new Error(`sprite: ${t.name} is ${t.width}×${t.height}, expected ${size}×${size}`);
  const width = size * frames.length;
  const rgba = new Uint8Array(width * size * 4);
  const frameOfTexture: number[] = [];
  frames.forEach(({ t, dictIndex }, slot) => {
    frameOfTexture[dictIndex] = slot;
    const px = decodeTexture(tex0, t, palette);
    for (let y = 0; y < size; y++) rgba.set(px.subarray(y * size * 4, (y + 1) * size * 4), (y * width + slot * size) * 4);
  });
  return { frameSize: size, frameCount: frames.length, width, rgba, frameOfTexture };
}

/** Direction order of billboard animation tables (decomp DIR_NORTH..DIR_EAST). */
export const BILLBOARD_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

export type SpriteAnimations = Record<string, { frame: number; ticks: number }[]>;

/**
 * Animations from a frame-sequence table. Animation `a` covers anim frames 16a..16a+15 (walk tables:
 * 0–3 walk N/S/W/E, 4–7 run N/S/W/E). Walking and running advance one anim frame per 30 Hz tick.
 * Standing shows anim frame 0 of the walk animation.
 */
export function billboardAnimations(seq: FrameSequence, atlas: SpriteAtlas, withRun: boolean): SpriteAnimations {
  const out: SpriteAnimations = {};
  const frameAt = (f: number) => {
    const slot = atlas.frameOfTexture[textureAt(seq, f)];
    if (slot === undefined) throw new Error(`sprite: frame sequence names texture ${textureAt(seq, f)} beyond ${atlas.frameCount} textures`);
    return slot;
  };
  const range = (start: number) => {
    const list: { frame: number; ticks: number }[] = [];
    for (let f = start; f < start + 16; f++) {
      const frame = frameAt(f);
      const last = list[list.length - 1];
      if (last && last.frame === frame) last.ticks++;
      else list.push({ frame, ticks: 1 });
    }
    return list;
  };
  BILLBOARD_DIRECTIONS.forEach((dir, d) => {
    out[`stand-${dir}`] = [{ frame: frameAt(d * 16), ticks: 1 }];
    out[`walk-${dir}`] = range(d * 16);
    if (withRun) out[`run-${dir}`] = range((4 + d) * 16);
  });
  return out;
}
