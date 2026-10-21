import type { Facing } from '@opensinnoh/contracts';
import { DELTA, OPPOSITE, REVEAL_TICKS, WALK_NORMAL_TICKS } from './movement.ts';
import { startAction, wait, walk, type Actor } from './npc.ts';
import { DISGUISE_TYPES } from './npc-types.ts';

/**
 * Trainer sight and approach (decomp src/trainer_encounter.c).
 *
 * Sight (FindUndefeatedTrainerInSight, GetDistanceNorth/South/West/East): a trainer object (trainerType
 * NORMAL and the facing variants look along their facing; VIEW_ALL_DIRECTIONS tries N, S, W, E) sees the
 * player in a straight line 1..data[0] tiles ahead, if every tile between is free (IsPathInterrupted:
 * terrain or another object blocks) and the trainer's flag is clear.
 *
 * Approach (SysTask_ApproachingTrainer): wait for the trainer to stop and face the player, wait for the
 * player's step to end, face, "!" (30 frames), walk distance − 1 tiles (WALK_NORMAL), wait 8 frames,
 * turn the player toward the trainer (slot 0, or both slots for two singles), then the trainer's
 * movement type becomes NONE. A disguised trainer (movement types 51–54) hops out of its cover instead
 * of the "!" (MOVEMENT_ACTION_REVEAL_TRAINER), then waits 30 frames before walking
 * (ApproachingTrainerTask_CheckRevealOrFaceDirection, _DelayCheckNextToPlayer).
 */

/** Approach types (decomp approach_type.h), passed as ScriptStart.trainer.sightType. */
export const APPROACH_SINGLES = 0;
export const APPROACH_DOUBLES = 1;
export const APPROACH_VS2 = 2;

/** Trainer types that look along their facing (NORMAL, FACE_SIDES, FACE_(COUNTER)CLOCKWISE, SPIN_*). */
const FACING_TYPES = new Set([1, 4, 5, 6, 7, 8]);
const VIEW_ALL_DIRECTIONS = 2;
const ALL_DIRS: Facing[] = ['up', 'down', 'left', 'right'];

/** Decomp TRAINER_DEFEATED_FLAGS_START: the trainer flag is the flag with sourceIndex 0x550 + trainer id. */
export const TRAINER_FLAGS_START = 0x550;

const EMOTE_TICKS = 30;
const AFTER_WALK_TICKS = 8;
/** STATE_DELAY_CHECK_NEXT_TO_PLAYER after a reveal. */
const AFTER_REVEAL_TICKS = 30;

/** The directions a trainer looks in. */
export function sightDirs(a: Actor): Facing[] {
  if (FACING_TYPES.has(a.trainerType)) return [a.facing];
  if (a.trainerType === VIEW_ALL_DIRECTIONS) return ALL_DIRS;
  return [];
}

/** Tiles from the trainer to the player along `dir` (1..sight), or null when not in line or out of range. */
export function lineDistance(t: Actor, p: { x: number; z: number }, dir: Facing): number | null {
  const [dx, dz] = DELTA[dir];
  const along = dx !== 0 ? (p.x - t.x) * dx : (p.z - t.z) * dz;
  const across = dx !== 0 ? p.z - t.z : p.x - t.x;
  return across === 0 && along >= 1 && along <= t.sight ? along : null;
}

export interface Approach {
  localId: number;
  dir: Facing;
  /** Tiles to the player when spotted; the trainer walks distance − 1. */
  distance: number;
  turnPlayer: boolean;
  phase: 'settle' | 'player' | 'face' | 'reveal' | 'emote' | 'walk' | 'pause' | 'turn' | 'done';
  walked: number;
}

/**
 * Advances one approach by a tick (runs before the actors' motions advance). Returns true once the
 * trainer's movement type should switch to NONE (the last phase).
 */
export function stepApproach(ap: Approach, t: Actor, hero: Actor): boolean {
  switch (ap.phase) {
    case 'settle':
      if (t.motion) return false;
      t.paused = true;
      ap.phase = 'player';
    // falls through
    case 'player':
      if (hero.motion) return false;
      t.facing = ap.dir;
      if (DISGUISE_TYPES.has(t.movementType)) {
        startAction(t, { kind: 'lift', lift: 'reveal', ticks: REVEAL_TICKS });
        t.motion!.source = 'approach';
        ap.phase = 'reveal';
        return false;
      }
      wait(t, 1, 'approach');
      ap.phase = 'face';
      return false;
    case 'reveal':
      if (t.motion) return false;
      wait(t, AFTER_REVEAL_TICKS, 'approach');
      ap.phase = 'emote';
      return false;
    case 'face':
      if (t.motion) return false;
      t.emote = EMOTE_TICKS;
      wait(t, EMOTE_TICKS, 'approach');
      ap.phase = 'emote';
      return false;
    case 'emote':
    case 'walk':
      if (t.motion) return false;
      if (ap.walked < ap.distance - 1) {
        ap.walked++;
        walk(t, ap.dir, WALK_NORMAL_TICKS, 'walk', 'approach');
        ap.phase = 'walk';
        return false;
      }
      wait(t, AFTER_WALK_TICKS, 'approach');
      ap.phase = 'pause';
      return false;
    case 'pause':
      if (t.motion) return false;
      ap.phase = 'turn';
      if (ap.turnPlayer && hero.facing !== OPPOSITE[ap.dir]) {
        hero.dirLocked = false;
        hero.facing = OPPOSITE[ap.dir];
        wait(hero, 1, 'approach');
      }
      return false;
    case 'turn':
      if (hero.motion?.source === 'approach') return false;
      ap.phase = 'done';
      return true;
    case 'done':
      return false;
  }
}
