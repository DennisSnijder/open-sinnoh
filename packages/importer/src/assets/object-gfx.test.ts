import { expect, it } from 'vitest';
import { buildSpriteAtlas, readFrameSequence, readTex0 } from '@opensinnoh/g3d';
import { Writer, writeBtx0, writeFrameSequence } from '@opensinnoh/g3d/testing';
import { readBillboardModels, readModelObjects, readObjectGfxAnims } from './object-gfx.ts';
import { frameTableAnimations } from './poses.ts';

const words = (...v: number[]) => {
  const w = new Writer();
  for (const x of v) w.u32(x);
  return w.done();
};

it('reads per-gfx animation tables through overlay pointers', () => {
  const ram = 0x02000000;
  // overlay: two animation tables at 0x10 (loop 0–15, one-shot 16–20) and 0x40 (one-shot 0–8)
  const overlay = new Uint8Array(0x60);
  overlay.set(words(0, 15, 0, 16, 20, 1, 0, 0, 2), 0x10);
  overlay.set(words(0, 8, 1, 0, 0, 2), 0x40);
  const table = words(26, 0, 11, ram + 0x10, 198, 0, 14, ram + 0x40, 0xffff, 0xffff, 0xffff, 0);
  expect(readObjectGfxAnims(table, overlay, ram)).toEqual([
    { gfx: 26, billboardModel: 0, frameSeq: 11, anims: [{ start: 0, end: 15, loop: true }, { start: 16, end: 20, loop: false }] },
    { gfx: 198, billboardModel: 0, frameSeq: 14, anims: [{ start: 0, end: 8, loop: false }] },
  ]);
  expect(() => readObjectGfxAnims(words(26, 0, 11, ram + 0x1000, 0xffff, 0, 0, 0), overlay, ram)).toThrow(/outside overlay 5/);
});

it('reads the billboard model table up to its sentinel', () => {
  expect(readBillboardModels(words(0, 421, 7, 436, 0xffff, 0))).toEqual(new Map([[0, 421], [7, 436]]));
  expect(() => readBillboardModels(words(0, 421, 0xffff, 0, 1, 422))).toThrow(/sentinel before the end/);
});

it('reads model objects with their draw offsets', () => {
  const models = words(91, 69, 183, 79);
  const offsets = words(91, 0, 0, -2 * 4096, 183, 0, 4096, 0, 0xffff, 0, 0, 0);
  expect(readModelObjects(models, offsets)).toEqual([
    { gfx: 91, fldeff: 69, offset: [0, 0, -2] },
    { gfx: 183, fldeff: 79, offset: [0, 1, 0] },
  ]);
  expect(() => readModelObjects(words(92, 70), offsets)).toThrow(/no initial position/);
});

/** A set of n 8×8 frames `o.1..o.n` (texel value = frame index). */
function frames(n: number) {
  const tex = Array.from({ length: n }, (_, i) => ({ name: `o.${i + 1}`, format: '16c' as const, width: 8, height: 8, texels: new Array(32).fill(i * 17) }));
  return buildSpriteAtlas(readTex0(writeBtx0(tex, [{ name: 'o_pl', colors: Array.from({ length: 16 }, (_, i) => i) }]))!);
}

it('names walk animations and nurse/heal poses from the frame table', () => {
  // nurse: 4 walks of 4 textures (one per 4 frames) then a 5-frame bow on texture 16
  const nurseSeq = readFrameSequence(writeFrameSequence([...Array.from({ length: 16 }, (_, i) => ({ start: i * 4, texture: i })), { start: 64, texture: 16 }]));
  const walk = (k: number) => ({ start: k * 16, end: k * 16 + 15, loop: true });
  const nurse = frameTableAnimations(nurseSeq, 11, frames(17), [walk(0), walk(1), walk(2), walk(3), { start: 64, end: 68, loop: false }]);
  expect(nurse['walk-left']).toEqual([8, 9, 10, 11].map((frame) => ({ frame, ticks: 4 })));
  expect(nurse['stand-left']).toEqual([{ frame: 8, ticks: 1 }]);
  expect(nurse['pose-bow']).toEqual([{ frame: 16, ticks: 5 }]);

  // heal: no walks; give = frames 0–20, receive = 21–41; it stands on the first give frame
  const healSeq = readFrameSequence(writeFrameSequence([{ start: 0, texture: 0 }, { start: 10, texture: 1 }, { start: 21, texture: 2 }, { start: 30, texture: 3 }]));
  const heal = frameTableAnimations(healSeq, 15, frames(4), [{ start: 0, end: 20, loop: false }, { start: 21, end: 41, loop: false }]);
  expect(heal['pose-give']).toEqual([{ frame: 0, ticks: 10 }, { frame: 1, ticks: 11 }]);
  expect(heal['pose-receive']).toEqual([{ frame: 2, ticks: 9 }, { frame: 3, ticks: 12 }]);
  expect(heal['stand-up']).toEqual([{ frame: 0, ticks: 1 }]);
  expect(heal['walk-right']).toEqual([{ frame: 0, ticks: 1 }]);
  // unnamed extras keep their sequence name and index
  expect(Object.keys(frameTableAnimations(healSeq, 5, frames(4), [{ start: 0, end: 3, loop: true }]))).toContain('pose-spray-duck-0');
});

it('draws the surf sets one still frame per facing, standing or moving', () => {
  // surf: animation k (DIR_NORTH..DIR_EAST) starts on its own texture, in the sequence's order, not the atlas order
  const surfSeq = readFrameSequence(writeFrameSequence([{ start: 0, texture: 2 }, { start: 3, texture: 0 }, { start: 6, texture: 3 }, { start: 10, texture: 1 }]));
  const surf = frameTableAnimations(surfSeq, 6, frames(4), [{ start: 0, end: 2, loop: true }, { start: 3, end: 5, loop: true }, { start: 6, end: 9, loop: true }, { start: 10, end: 11, loop: true }]);
  for (const [dir, frame] of [['up', 2], ['down', 0], ['left', 3], ['right', 1]] as const) {
    expect(surf[`stand-${dir}`]).toEqual([{ frame, ticks: 1 }]);
    expect(surf[`walk-${dir}`]).toEqual([{ frame, ticks: 1 }]);
  }
});
