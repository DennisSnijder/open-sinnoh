/**
 * The billboard frame counter against the decomp (overlay005/ov5_021EB1A0.c, src/billboard.c,
 * src/unk_020655F4.c). One update per 30 Hz tick; a step's last tick updates twice (the anim code of
 * the step, then code 0), as MovementAction_Walk_Step1 draws before it sets MAP_OBJ_UNK_A0_00 and the
 * object task (MapObjectTask_Move → MapObjectTask_Draw) draws again.
 *
 * Expected frames index the 16-frame loop of sWalkRunBillboardAnims. In the ROM's walk_and_run frame
 * sequence each texture covers 4 frames: walk frames 0–3 stand, 4–7 one foot, 8–11 stand, 12–15 the
 * other foot; run frames 64.. likewise with the run pictures.
 */
import { describe, expect, it } from 'vitest';
import type { Facing } from '@opensinnoh/contracts';
import { createSpriteAnim, drawSpriteAnim, spriteAnimView, type SpriteAnim } from './sprite-anim.ts';

/** Plays `steps` moves of `ticks` ticks with anim `code`, then `idle` standing ticks; returns the view per tick. */
function play(s: SpriteAnim, facing: Facing, code: number, ticks: number, steps: number, idle = 0): string[] {
  const out: string[] = [];
  const view = () => {
    const v = spriteAnimView(s);
    out.push(`${v.anim}:${v.animTick}`);
  };
  for (let n = 0; n < steps; n++) {
    for (let t = 1; t <= ticks; t++) {
      drawSpriteAnim(s, facing, code, false);
      if (t === ticks) drawSpriteAnim(s, facing, 0, false);
      view();
    }
  }
  for (let t = 0; t < idle; t++) {
    drawSpriteAnim(s, facing, 0, false);
    view();
  }
  return out;
}

/** An object standing facing `facing` (its first update binds the anim at frame 0). */
function standing(facing: Facing): SpriteAnim {
  const s = createSpriteAnim();
  drawSpriteAnim(s, facing, 0, false);
  return s;
}

const walk = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `walk:${from + i}`);
const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `run:${from + i}`);

describe('billboard frames (ov5_021EBAD0)', () => {
  it('WALK_NORMAL: 1 frame a tick (code 3, ov5_021EBC28); the counter carries over, so the steps alternate feet', () => {
    const s = standing('down');
    // Step 1 ends at frame 8 (rounded to 8: stays), step 2 wraps 15 → 0 (Billboard_AdvanceAnim restarts past
    // endFrame 15), step 3 is step 1 again. Step 1 shows the 4–7 foot, step 2 the 12–15 foot.
    expect(play(s, 'down', 3, 8, 3)).toEqual([...walk(1, 7), 'stand:8', ...walk(9, 15), 'stand:0', ...walk(1, 7), 'stand:8']);
    // A stop keeps the foot (ov5_021EB478/ov5_021EBB44 round to 8): the next step starts at 8, the other foot.
    expect(play(s, 'down', 0, 1, 0, 3)).toEqual(['stand:8', 'stand:8', 'stand:8']);
    expect(play(s, 'down', 3, 8, 1)).toEqual([...walk(9, 15), 'stand:0']);
  });

  it('RUN: 1 frame a tick on the run anim (code 9, ov5_021EBEFC); a run step is a quarter of the loop and never resets', () => {
    const s = standing('right');
    // 4 ticks a step, 4 frames a step: one run picture per step, continuous over steps. The step's last
    // tick keeps the run frame (ov5_021EBB44 after code 9 only sets unk_03_0).
    expect(play(s, 'right', 9, 4, 5)).toEqual([...run(1, 4), ...run(5, 8), ...run(9, 12), ...run(13, 15), 'run:0', ...run(1, 4)]);
    // Stopping: the held flag switches back to the walk anim, rounded to 8 (ov5_021EC69C).
    expect(play(s, 'right', 0, 1, 0, 2)).toEqual(['stand:0', 'stand:0']);
  });

  it('a run from a walk keeps the foot: the run anim takes over at the quarter (ov5_021EC674)', () => {
    const s = standing('up');
    expect(play(s, 'up', 3, 8, 1)).toEqual([...walk(1, 7), 'stand:8']);
    expect(play(s, 'up', 9, 4, 2)).toEqual([...run(9, 12), ...run(13, 15), 'run:0']);
    // Walking on straight from a run (B released): ov5_021EBC28 switches back only after code 9, but the
    // tick between was code 0, so the first walk step still plays the run pictures; its end (code 0 with
    // unk_03_0 set) binds the walk anim again.
    expect(play(s, 'up', 3, 8, 2)).toEqual([...run(1, 7), 'stand:8', ...walk(9, 15), 'stand:0']);
  });

  it('a turn restarts the loop at frame 0 (unk_00 differs from the facing)', () => {
    const s = standing('down');
    play(s, 'down', 3, 8, 1);
    // WALK_ON_SPOT_FASTER (code 5, ov5_021EBCD0): 4 frames a tick; an on-spot walk ends without a second draw.
    drawSpriteAnim(s, 'left', 5, false);
    expect(spriteAnimView(s)).toEqual({ anim: 'walk', animTick: 4 });
    drawSpriteAnim(s, 'left', 5, false);
    expect(spriteAnimView(s)).toEqual({ anim: 'walk', animTick: 8 });
  });

  it('bike speeds: every step covers 8 frames (codes 4 and 5 by 2 and 4, codes 6–8 by their patterns)', () => {
    // WALK_FAST (4 ticks, code 4) and WALK_FASTER (2 ticks, code 5).
    expect(play(standing('down'), 'down', 4, 4, 2)).toEqual(['walk:2', 'walk:4', 'walk:6', 'stand:8', 'walk:10', 'walk:12', 'walk:14', 'stand:0']);
    expect(play(standing('down'), 'down', 5, 2, 2)).toEqual(['walk:4', 'stand:8', 'walk:12', 'stand:0']);
    // WALK_SLIGHTLY_FAST (6 ticks, code 6: 1,1,2,1,1,2), restarting the pattern each step (code 0 in between).
    expect(play(standing('down'), 'down', 6, 6, 2)).toEqual(['walk:1', 'walk:2', 'walk:4', 'walk:5', 'walk:6', 'stand:8', 'walk:9', 'walk:10', 'walk:12', 'walk:13', 'walk:14', 'stand:0']);
    // WALK_SLIGHTLY_FASTER (3 ticks, code 7: 3,2,3).
    expect(play(standing('down'), 'down', 7, 3, 2)).toEqual(['walk:3', 'walk:5', 'stand:8', 'walk:11', 'walk:13', 'stand:0']);
  });

  it('WALK_SLOW: half a frame a tick (code 2, ov5_021EBBB4), shown as the whole frame', () => {
    const v = play(standing('down'), 'down', 2, 16, 1);
    expect(v).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7].map((n) => `walk:${n}`).concat('stand:8'));
  });

  it('PAUSE_ANIMATION holds the frame (ov5_021ECD38)', () => {
    const s = standing('down');
    for (let t = 0; t < 7; t++) drawSpriteAnim(s, 'down', 3, true);
    expect(spriteAnimView(s)).toEqual({ anim: 'walk', animTick: 0 });
  });
});
