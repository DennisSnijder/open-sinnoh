import type { Facing } from '@opensinnoh/contracts';
import { DW_JUMP, DW_STEPS } from './distortion/actions.ts';

/**
 * Movement actions (decomp MOVEMENT_ACTION_* names, lower-cased without the prefix) and their
 * durations in 30 Hz ticks. Durations from the decomp's `MovementAction_*_Step0` init calls in
 * `src/unk_020655F4.c`: a walk moves 16 units in `frames` frames.
 */
export type Action =
  | { kind: 'walk'; dir: Facing; ticks: number; anim: 'walk' | 'run' }
  | { kind: 'onspot'; dir: Facing; ticks: number }
  | { kind: 'face'; dir: Facing }
  | { kind: 'delay'; ticks: number }
  | { kind: 'emote'; ticks: number; double: boolean }
  | { kind: 'visible'; visible: boolean }
  | { kind: 'lockDir'; locked: boolean }
  /** PAUSE_ANIMATION / RESUME_ANIMATION: the sprite's animation frame holds (MAP_OBJ_STATUS_PAUSE_ANIMATION). */
  | { kind: 'animPause'; paused: boolean }
  /** A sprite lift (MapObject_SetSpriteJumpOffset): WARP_OUT / WARP_IN, and REVEAL_TRAINER's hop out of a disguise. */
  | { kind: 'lift'; lift: Lift; ticks: number }
  /** A one-shot sprite pose (`pose-<pose>`) for `ticks`; `hold` keeps it after the action, else it ends facing `end`. */
  | { kind: 'pose'; pose: string; ticks: number; hold: true }
  | { kind: 'pose'; pose: string; ticks: number; hold: false; end: Facing }
  /** A Distortion World step in the shared space (MOVEMENT_ACTION_105–116, 121–132; distortion/actions.ts). */
  | { kind: 'walk3d'; d: readonly [number, number, number]; face: Facing; ticks: number; anim: 'walk' | 'run' }
  /** A jump of `tiles` in `ticks` frames with an arc rate (MOVEMENT_ACTION_JUMP_DISTORTION_WORLD_*). */
  | { kind: 'hop'; dir: Facing; tiles: number; ticks: number; rate: number; sound?: number };

/** Sprite lifts of `lift` actions (decomp unk_020655F4.c). */
export type Lift = 'warp-out' | 'warp-in' | 'reveal';
/** WARP_OUT/IN: 16 units per frame up to (or down from) 8 × 40 = 320 (MovementAction_WarpOut_Step1). */
export const WARP_LIFT_STEP = 16;
export const WARP_LIFT_HEIGHT = 8 * 40;
/** REVEAL_TRAINER: every other entry of the 16-frame JUMP_HEIGHT_HIGH arc, 8 frames (MovementAction_RevealTrainer_Step1). */
export const REVEAL_TICKS = 8;

export const DIRS: Record<string, Facing> = { north: 'up', south: 'down', west: 'left', east: 'right' };
export const DELTA: Record<Facing, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPPOSITE: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** WALK_<speed>: slower 0.5 u/frame (32), slow 1 (16), normal 2 (8), fast 4 (4), faster 8 (2), fastest 16 (1). */
const WALK_TICKS: Record<string, number> = { slower: 32, slow: 16, normal: 8, fast: 4, faster: 2, fastest: 1 };
/**
 * WALK_SLIGHTLY_FAST (6 frames) and WALK_SLIGHTLY_FASTER (3 frames): uneven steps summing to a tile
 * (MovementAction_InitWalkUneven); drawn evenly here.
 */
const UNEVEN_WALK_TICKS: Record<string, number> = { fast: 6, faster: 3 };
/** WALK_ON_SPOT_<speed>: slow 16, normal 8, fast 4, faster 2. */
const ON_SPOT_TICKS: Record<string, number> = { slow: 16, normal: 8, fast: 4, faster: 2 };
/** RUN_<dir>: 4 u/frame, 4 frames (MovementAction_RunNorth_Step0). */
export const RUN_TICKS = 4;
export const WALK_NORMAL_TICKS = 8;
export const WALK_SLOW_TICKS = 16;
/** Turn on tap: the player uses WALK_ON_SPOT_FASTER (player_move.c PlayerAvatar_SetMovement_Turning). */
export const TURN_TICKS = 2;
/** Bumping into a wall: WALK_ON_SPOT_SLOW (player_move.c PlayerAvatar_SetMovement_NormalOverworld). */
export const BUMP_TICKS = 16;
/** Emote balloons finish after 30 frames (ov5_021F5A10.c, counter >= 30). */
const EMOTE_TICKS = 30;
const DELAYS = new Set([1, 2, 4, 8, 15, 16, 32]);
/**
 * Pose actions (decomp unk_020655F4.c): PlayerGive/PlayerReceive set anim code 0/1 and wait 21 frames;
 * the pose stays until the next action that sets an anim code. PokecenterNurseBow sets code 9 for 8
 * frames, then faces south with code 0 (standing).
 */
const POSES: Record<string, Action> = {
  player_give: { kind: 'pose', pose: 'give', ticks: 21, hold: true },
  player_receive: { kind: 'pose', pose: 'receive', ticks: 21, hold: true },
  pokecenter_nurse_bow: { kind: 'pose', pose: 'bow', ticks: 8, hold: false, end: 'down' },
};

/** Parses an op, or returns null for an unknown/unimplemented op (the caller logs it). */
export function parseAction(op: string): Action | null {
  let m = /^walk_(slower|slow|normal|fast|faster|fastest)_(north|south|west|east)$/.exec(op);
  if (m) return { kind: 'walk', dir: DIRS[m[2]!]!, ticks: WALK_TICKS[m[1]!]!, anim: 'walk' };
  m = /^walk_slightly_(fast|faster)_(north|south|west|east)$/.exec(op);
  if (m) return { kind: 'walk', dir: DIRS[m[2]!]!, ticks: UNEVEN_WALK_TICKS[m[1]!]!, anim: 'walk' };
  m = /^run_(north|south|west|east)$/.exec(op);
  if (m) return { kind: 'walk', dir: DIRS[m[1]!]!, ticks: RUN_TICKS, anim: 'run' };
  m = /^walk_on_spot_(slow|normal|fast|faster)_(north|south|west|east)$/.exec(op);
  if (m) return { kind: 'onspot', dir: DIRS[m[2]!]!, ticks: ON_SPOT_TICKS[m[1]!]! };
  m = /^face_(north|south|west|east)$/.exec(op);
  if (m) return { kind: 'face', dir: DIRS[m[1]!]! };
  m = /^delay_(\d+)$/.exec(op);
  if (m && DELAYS.has(Number(m[1]))) return { kind: 'delay', ticks: Number(m[1]) };
  // 153: the exclamation emote with its third argument set (sub_020664A0(mapObj, 0, 1); DW and Eterna Forest).
  if (op === 'emote_exclamation_mark' || op === 'emote_double_exclamation_mark' || op === '153') return { kind: 'emote', ticks: EMOTE_TICKS, double: op === 'emote_double_exclamation_mark' };
  if (op === 'set_invisible' || op === 'set_visible') return { kind: 'visible', visible: op === 'set_visible' };
  if (op === 'lock_dir' || op === 'unlock_dir') return { kind: 'lockDir', locked: op === 'lock_dir' };
  if (op === 'pause_animation' || op === 'resume_animation') return { kind: 'animPause', paused: op === 'pause_animation' };
  if (op === 'warp_out' || op === 'warp_in') return { kind: 'lift', lift: op === 'warp_out' ? 'warp-out' : 'warp-in', ticks: WARP_LIFT_HEIGHT / WARP_LIFT_STEP };
  if (op === 'reveal_trainer') return { kind: 'lift', lift: 'reveal', ticks: REVEAL_TICKS };
  m = /^jump_(on_spot_slow|on_spot_fast|near_slow|near_fast|far|farther)_(north|south|west|east)$/.exec(op);
  if (m) {
    const family = m[1]!;
    const fast = family.endsWith('fast');
    return { kind: 'hop', dir: DIRS[m[2]!]!, tiles: family.startsWith('on_spot') ? 0 : family === 'far' ? 2 : family === 'farther' ? 3 : 1, ticks: family === 'farther' ? 12 : fast ? 8 : 16, rate: family === 'farther' ? 0x140 : fast ? 0x200 : 0x100 };
  }
  const dw = /^\d+$/.test(op) ? DW_STEPS.get(Number(op)) : undefined;
  if (dw) return { kind: 'walk3d', d: dw.d, face: dw.face, ticks: dw.ticks, anim: dw.anim };
  m = /^jump_distortion_world_(north|south|west|east)$/.exec(op);
  if (m) return { kind: 'hop', dir: DIRS[m[1]!]!, ...DW_JUMP, sound: 0 };
  return POSES[op] ?? null;
}
