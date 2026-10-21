import { Prng } from '@opensinnoh/core';
import type { Facing } from '@opensinnoh/contracts';
import { OPPOSITE, WALK_NORMAL_TICKS } from './movement.ts';
import { onSpot, wait, walk, type Actor } from './npc.ts';
import { hasNpcTypeState, isStaticNpcType, updateNpcType, type NpcTypeHost } from './npc-types.ts';

/**
 * Field movement types (decomp generated/movement_types.txt, 0-based; behaviour in src/unk_0206450C.c,
 * driven once per 30 Hz frame by MapObject_Move in src/map_object_move.c).
 *
 * Deviation: the DS draws every roll from the one global LCRNG. Here each object has its own
 * stream (`ObjectState.wander.rng`), so an NPC never shifts another random roll and a save continues it.
 * The countdown and phase are not saved: a loaded object restarts its cycle.
 */
export const MOVEMENT_TYPE_FOLLOW_PLAYER = 48;
/** LOOK_NORTH/SOUTH/WEST/EAST: face once on the first update (sub_020648F4/sub_02064918). */
export const LOOK_TYPES: Record<number, Facing> = { 14: 'up', 15: 'down', 16: 'left', 17: 'right' };
/** NONE, PLAYER. */
export const STATIC_TYPES = new Set([0, 1]);

const N: Facing = 'up';
const S: Facing = 'down';
const W: Facing = 'left';
const E: Facing = 'right';
/** Look-around types and their direction lists (Unk_020EEB08). */
const LOOK_AROUND: Record<number, Facing[]> = {
  2: [N, S, W, E],
  6: [N, W],
  7: [N, E],
  8: [S, W],
  9: [S, E],
  10: [N, S, W],
  11: [N, S, E],
  12: [N, W, E],
  13: [S, W, E],
  45: [N, S],
  46: [W, E],
};
/** WANDER_AROUND, WANDER_NORTH_AND_SOUTH, WANDER_WEST_AND_EAST (sub_02064668/sub_02064690). */
const WANDER: Record<number, Facing[]> = { 3: [N, S, W, E], 4: [N, S], 5: [W, E], 67: [N, S, W, E] };
/**
 * MOVEMENT_TYPE_067 (sub_02064658: wander around in mode 2, the Distortion World's B4F Cyrus): only its range stops a
 * step, not the map or objects (sub_02064690 tests just the range bit in that mode).
 */
const WANDER_RANGE_ONLY = 67;
/** ROTATE_COUNTERCLOCKWISE (18), ROTATE_CLOCKWISE (19): one quarter turn every 24 frames (sub_020649A8). */
const ROTATE: Record<number, Facing[]> = { 18: [N, W, S, E], 19: [N, E, S, W] };
const ROTATE_TICKS = 24;
export const WALK_BACK_AND_FORTH = 20;
/** Random delays in frames (Unk_020EEA88), index LCRNG % 4 (sub_0206530C). */
const DELAYS = [16, 32, 48, 64];

/** Types that run an update here and keep `ObjectState.wander` (origin and PRNG stream). */
export function hasTypeState(movementType: number): boolean {
  return movementType in LOOK_AROUND || movementType in WANDER || movementType in ROTATE || movementType === WALK_BACK_AND_FORTH || hasNpcTypeState(movementType);
}

export function isKnownType(movementType: number): boolean {
  return hasTypeState(movementType) || movementType in LOOK_TYPES || STATIC_TYPES.has(movementType) || movementType === MOVEMENT_TYPE_FOLLOW_PLAYER || isStaticNpcType(movementType);
}

/** Runtime state of a movement type with an update (phase and countdown are not saved). */
export interface TypeState {
  originX: number;
  originZ: number;
  rng: { seed: number };
  /** The event's facing at spawn: WALK_BACK_AND_FORTH walks along it. */
  initial: Facing;
  phase: 'start' | 'delay' | 'moving';
  timer: number;
  returning: boolean;
  /** Walk loops (21–44): the route leg being walked, 0–3. */
  loop: number;
}

/** Collision bits as in decomp sub_02063E18: 1 out of range, 2 tile/terrain, 4 another object. */
export const COLLIDE_RANGE = 1;

export interface TypeHost extends NpcTypeHost {
  /** Collision bits for a step of `a` in `dir` (0 = free). */
  collision(a: Actor, dir: Facing): number;
  /** Direction toward a running player within the actor's sight square (trainer types 1–2), or null. */
  runningPlayer(a: Actor): { dx: number; dz: number } | null;
}

function roll(t: TypeState, n: number): number {
  const prng = Prng.from(t.rng);
  const v = prng.below(n);
  t.rng = prng.save();
  return v;
}

/** Faces the actor unless its direction is locked (MapObject_TryFace). */
function face(a: Actor, dir: Facing): void {
  if (!a.dirLocked) a.facing = dir;
}

/**
 * The running-player override of look types (sub_02065448/sub_0206537C): face the player when that
 * direction is allowed, else the horizontal or vertical component that is.
 */
function faceRunningPlayer(a: Actor, host: TypeHost, list: Facing[]): boolean {
  if (list.length < 2) return false;
  const d = host.runningPlayer(a);
  if (!d) return false;
  const h: Facing | null = d.dx > 0 ? E : d.dx < 0 ? W : null;
  const v: Facing | null = d.dz > 0 ? S : d.dz < 0 ? N : null;
  const toward = Math.abs(d.dx) > Math.abs(d.dz) ? h : v;
  for (const dir of [toward, h, v]) {
    if (dir && list.includes(dir)) {
      face(a, dir);
      return true;
    }
  }
  return false;
}

/** One movement-type update: runs only while the actor is unpaused, has no script and no motion. */
export function updateType(a: Actor, host: TypeHost): void {
  const t = a.type;
  if (!t) return;
  const mt = a.movementType;
  const look = LOOK_AROUND[mt];
  if (look) {
    if (t.phase === 'start') {
      t.timer = DELAYS[roll(t, 4)]!;
      t.phase = 'delay';
    }
    if (faceRunningPlayer(a, host, look)) return;
    if (--t.timer > 0) return;
    t.timer = DELAYS[roll(t, 4)]!;
    face(a, look[roll(t, look.length)]!);
    return;
  }
  const cycle = ROTATE[mt];
  if (cycle) {
    if (t.phase === 'start') {
      t.timer = ROTATE_TICKS;
      t.phase = 'delay';
    }
    if (faceRunningPlayer(a, host, [N, S, W, E])) {
      t.timer = ROTATE_TICKS;
      return;
    }
    if (--t.timer > 0) return;
    t.timer = ROTATE_TICKS;
    face(a, cycle[(cycle.indexOf(a.facing) + 1) % 4]!);
    return;
  }
  const dirs = WANDER[mt];
  if (dirs) {
    // Face (a 1-frame action), wait 16–64 frames, turn to a random direction, step if free.
    if (t.phase === 'start' || t.phase === 'moving') {
      t.timer = DELAYS[roll(t, 4)]!;
      t.phase = 'delay';
      return;
    }
    if (--t.timer > 0) return;
    const dir = dirs[roll(t, dirs.length)]!;
    face(a, dir);
    t.phase = 'moving';
    const hit = host.collision(a, dir) & (mt === WANDER_RANGE_ONLY ? COLLIDE_RANGE : ~0);
    if (hit === 0) walk(a, dir, WALK_NORMAL_TICKS, 'walk', 'type');
    else wait(a, 1, 'type');
    return;
  }
  if (mt === WALK_BACK_AND_FORTH) {
    // Out and back along the initial facing, range tiles; blocked → walk on the spot (sub_02064CA8).
    let dir = t.returning ? OPPOSITE[t.initial] : t.initial;
    if (t.returning && a.x === t.originX && a.z === t.originZ) {
      dir = t.initial;
      t.returning = false;
    }
    let hit = host.collision(a, dir);
    if (hit & COLLIDE_RANGE) {
      t.returning = !t.returning;
      dir = OPPOSITE[dir];
      hit = host.collision(a, dir);
    }
    face(a, dir);
    if (hit === 0) walk(a, dir, WALK_NORMAL_TICKS, 'walk', 'type');
    else onSpot(a, dir, WALK_NORMAL_TICKS, 'type');
    return;
  }
  if (updateNpcType(a, host)) return;
  throw new Error(`world: movement type ${mt} has state but no update`);
}
