import type { Facing } from '@opensinnoh/contracts';
import type { Motion } from './npc.ts';

/**
 * The walk/run frame counter of a map object's billboard, as the DS keeps it (decomp
 * overlay005/ov5_021EB1A0.c: the player's renderer ov5_021EBAD0 and its table Unk_ov5_021FF3F8; the
 * NPC renderer ov5_021EB398 is the same for anim codes 0–8, and only the player gets code 9).
 *
 * The billboard plays one 16-frame loop per direction (walk anims 0–3, run anims 4–7: decomp
 * sWalkRunBillboardAnims), and the counter persists from step to step. Every draw update advances it by
 * the anim code's speed: a walk step covers 8 frames (half a cycle, one foot) at any speed, a run step 4.
 * When a step ends the DS draws twice in that frame (MovementAction_Walk_Step1 calls the draw before it
 * sets anim code 0, then the object task draws again), so the last tick still advances and is then
 * rounded down to a multiple of 8: consecutive steps alternate feet, and a stop keeps the next foot.
 */
export interface SpriteAnim {
  /** Frame in the 16-frame loop (fx32 in the DS: half frames at the slow speeds). */
  frame: number;
  /** The run anims (4–7) are bound, not the walk anims. */
  run: boolean;
  /** Facing at the last update (unk_00); a change restarts the loop at frame 0. */
  facing: Facing | null;
  /** Anim code at the last update (unk_02). */
  code: number;
  /** unk_03_0: stopped after a run or a slow walk; the next stand update switches back to the walk anim. */
  held: boolean;
  /** unk_01: position in an uneven speed pattern (codes 6–8). */
  pattern: number;
}

/** Codes 6–8 advance by a pattern per draw (each sums to 8 frames over the step). */
const PATTERNS: Record<number, number[]> = { 6: [1, 1, 2, 1, 1, 2], 7: [3, 2, 3], 8: [2, 1, 1, 1, 1, 1, 1] };
/** Frames per draw by anim code (ov5_021EBBB4 0.5, ov5_021EBC28 1, ov5_021EBC7C 2, ov5_021EBCD0 4, ov5_021EBEFC 1). */
const SPEED: Record<number, number> = { 1: 0.5, 2: 0.5, 3: 1, 4: 2, 5: 4, 9: 1 };
const RUN = 9;
/** Anim code a walk action sets by its length in ticks (decomp MovementAction_Walk*_Step0, MAP_OBJ_UNK_A0_*). */
const WALK_CODE: Record<number, number> = { 32: 1, 16: 2, 8: 3, 4: 4, 2: 5, 1: 0, 6: 6, 3: 7, 7: 8 };

export function createSpriteAnim(): SpriteAnim {
  return { frame: 0, run: false, facing: null, code: 0, held: false, pattern: 0 };
}

/**
 * The anim code a motion draws with. Jumps (ledges, hops, surf mount) are code 3; the bike ramp jumps
 * (codes 9/10 on the bike's own anims 4/5) are drawn as code 3 too. Tile-forced slides do not animate.
 */
export function animCode(m: Motion | null): number {
  if (!m || m.anim === 'stand') return 0;
  if (m.anim === 'run') return RUN;
  if (m.jump) return 3;
  const code = WALK_CODE[m.ticks];
  if (code === undefined) throw new Error(`world: no anim code for a ${m.ticks}-tick ${m.kind}`);
  return code;
}

/** Billboard_AdvanceAnim on a 0–15 loop: past the end it restarts at 0 (no remainder carried). */
function advanceFrame(s: SpriteAnim, n: number): void {
  s.frame = s.frame + n > 15 ? 0 : s.frame + n;
}

/** ov5_021EC638: round the frame down to a multiple of `m` (8: the stand frame of the current foot). */
function roundFrame(s: SpriteAnim, m: number): void {
  const whole = Math.floor(s.frame);
  s.frame = whole - (whole % m);
}

/** ov5_021EC69C: back to the walk anim, rounded to the foot. */
function toWalk(s: SpriteAnim): void {
  roundFrame(s, 8);
  s.run = false;
}

/** One draw update (ov5_021EBAD0 → Unk_ov5_021FF3F8[code]); `paused` is ov5_021ECD38 (no advance). */
export function drawSpriteAnim(s: SpriteAnim, facing: Facing, code: number, paused: boolean): void {
  const turned = facing !== s.facing;
  const restart = (run: boolean) => {
    s.run = run;
    s.frame = 0;
  };
  if (code === 0) {
    // ov5_021EBB44
    if (turned) {
      restart(false);
      s.held = false;
    } else if (s.code === RUN) s.held = true;
    else if (s.held) {
      toWalk(s);
      s.held = false;
    } else roundFrame(s, 8);
  } else if (code === RUN) {
    // ov5_021EBEFC: from a walk or a stop, the run anim takes over at the current quarter (ov5_021EC674).
    if (turned) restart(true);
    else if (s.code !== RUN) {
      roundFrame(s, 4);
      s.run = true;
    }
    if (!paused) advanceFrame(s, SPEED[RUN]!);
  } else if (code === 1 || code === 2) {
    // ov5_021EBBB4: the first slow update after a run only holds.
    let hold = false;
    if (turned) restart(false);
    else if (s.code === RUN) hold = s.held = true;
    else if (s.held) {
      toWalk(s);
      s.held = false;
    }
    if (!hold && !paused) advanceFrame(s, SPEED[code]!);
  } else {
    // ov5_021EBC28 / EBC7C / EBCD0 (codes 3–5) and ov5_021EBD24 / EBDC4 / EBE5C (patterns 6–8).
    if (turned) {
      restart(false);
      s.pattern = 0;
    } else if (s.code === RUN) toWalk(s);
    const pattern = PATTERNS[code];
    if (pattern) {
      if (s.code !== code) s.pattern = 0;
      if (!paused) {
        advanceFrame(s, pattern[s.pattern]!);
        s.pattern = (s.pattern + 1) % pattern.length;
      }
    } else if (!paused) advanceFrame(s, SPEED[code]!);
  }
  s.facing = facing;
  s.code = code;
}

/** What the renderer shows: the bound anim and the whole frame. A stop shows the stand frame. */
export function spriteAnimView(s: SpriteAnim): { anim: 'stand' | 'walk' | 'run'; animTick: number } {
  return { anim: s.run ? 'run' : s.code === 0 ? 'stand' : 'walk', animTick: Math.floor(s.frame) };
}
