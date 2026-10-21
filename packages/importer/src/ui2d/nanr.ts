/**
 * NANR cell animations (`RNAN`, block `KNBA`), as NitroPaint and nitrogfx describe them:
 * `u16 sequence count, u16 frame count, u32 sequence offset, u32 frame offset, u32 result offset`
 * (from block + 8). A sequence is `u16 frames, u16 loop start, u16 element type, u16 animation type,
 * u32 play mode, u32 first frame offset`; a frame is `u32 result offset, u16 duration, u16 0xBEEF`;
 * a result is the cell index (type 0), plus rotation, fx32 scale and translation (type 1, "SRT"), or
 * plus a translation (type 2, "T").
 */
import { blocks, need } from './nitro2d.ts';

/** NNS_G2D_ANIMATIONPLAYMODE 1–4: forward once, forward loop, forward then back once, back-and-forth loop. */
export const PLAY_MODES = ['forward', 'loop', 'pingpong', 'pingpong-loop'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

export interface AnimFrame {
  cell: number;
  /** Duration in sprite updates (one per game frame). */
  ticks: number;
  /** Translation in px (types 1 and 2). */
  dx?: number;
  dy?: number;
  /** Scale (type 1; 1 = unscaled) and rotation in turns (type 1; 0–1). */
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
}

export interface AnimSequence {
  mode: PlayMode;
  loopStart: number;
  frames: AnimFrame[];
}

export function readNanr(bytes: Uint8Array): AnimSequence[] {
  const { r, blocks: b } = blocks(bytes, 'RNAN');
  const o = need(b, 'KNBA', 'NANR');
  const count = r.u16(o + 8);
  const base = o + 8;
  const seqAt = base + r.u32(o + 12);
  const frameAt = base + r.u32(o + 16);
  const resultAt = base + r.u32(o + 20);
  const out: AnimSequence[] = [];
  for (let i = 0; i < count; i++) {
    const s = seqAt + i * 16;
    const element = r.u16(s + 4);
    const mode = PLAY_MODES[r.u32(s + 8) - 1];
    if (!mode) throw new Error(`2D NANR: sequence ${i} play mode ${r.u32(s + 8)}`);
    if (element > 2) throw new Error(`2D NANR: sequence ${i} element type ${element}`);
    const frames: AnimFrame[] = [];
    for (let k = 0; k < r.u16(s); k++) {
      const f = frameAt + r.u32(s + 12) + k * 8;
      const res = resultAt + r.u32(f);
      const frame: AnimFrame = { cell: r.u16(res), ticks: r.u16(f + 4) };
      if (element === 1) {
        frame.rotation = r.u16(res + 2) / 65536;
        frame.scaleX = r.i32(res + 4) / 4096;
        frame.scaleY = r.i32(res + 8) / 4096;
        frame.dx = r.i16(res + 12);
        frame.dy = r.i16(res + 14);
      } else if (element === 2) {
        frame.dx = r.i16(res + 4);
        frame.dy = r.i16(res + 6);
      }
      frames.push(frame);
    }
    out.push({ mode, loopStart: r.u16(s + 2), frames });
  }
  return out;
}
