import type { Facing } from '@opensinnoh/contracts';
import { DELTA, WALK_NORMAL_TICKS } from './movement.ts';
import { onSpot, walk, wait, type Actor } from './npc.ts';

/**
 * Movement types 21–54 (decomp generated/movement_types.txt; init/update pairs in the Unk_020EE3A8 table of
 * src/unk_020EDBAC.c, behaviour in src/unk_0206450C.c and src/unk_02069BE0.c). The look, wander, rotate and
 * back-and-forth types are in movement-types.ts.
 */

const N: Facing = 'up';
const S: Facing = 'down';
const W: Facing = 'left';
const E: Facing = 'right';

/**
 * WALK_* loops 21–44 (sub_02064D98 and sub_0206502C): the route (Unk_020EEB08 lists 14–37, list = type − 7)
 * and the axis that ends leg 2 (0 = x back at the origin's x, 1 = z). The decomp's type names do not all
 * match their lists; the lists are what runs.
 */
const WALK_LOOPS: Record<number, { route: Facing[]; axis: 'x' | 'z' }> = {
  21: { route: [N, E, W, S], axis: 'x' },
  22: { route: [E, W, S, N], axis: 'x' },
  23: { route: [S, N, E, W], axis: 'z' },
  24: { route: [W, S, N, E], axis: 'z' },
  25: { route: [W, E, S, N], axis: 'x' },
  26: { route: [W, E, S, N], axis: 'x' },
  27: { route: [S, N, W, E], axis: 'z' },
  28: { route: [E, S, N, W], axis: 'z' },
  29: { route: [W, N, S, E], axis: 'z' },
  30: { route: [N, S, E, W], axis: 'z' },
  31: { route: [E, W, N, S], axis: 'x' },
  32: { route: [S, E, W, N], axis: 'x' },
  33: { route: [E, N, S, W], axis: 'z' },
  34: { route: [N, S, W, E], axis: 'z' },
  35: { route: [W, E, N, S], axis: 'x' },
  36: { route: [S, W, E, N], axis: 'x' },
  37: { route: [N, W, S, E], axis: 'z' },
  38: { route: [S, E, N, W], axis: 'z' },
  39: { route: [W, S, E, N], axis: 'x' },
  40: { route: [E, N, W, S], axis: 'x' },
  41: { route: [N, E, S, W], axis: 'z' },
  42: { route: [S, W, N, E], axis: 'z' },
  43: { route: [W, N, E, S], axis: 'x' },
  44: { route: [E, S, W, N], axis: 'x' },
};
/** Types 37–44 (sub_020650DC) first check trainer type 0xA (unused by Platinum's events). */
const WALK_LOOP_SIGHT_TRAINER_TYPE = 0xa;
/** Trainer types SPIN_CLOCKWISE (7) and SPIN_COUNTERCLOCKWISE (8): they turn a quarter per step instead of facing it (sub_02065568). */
const SPIN_WALK: Record<number, Facing[]> = { 7: [N, W, S, E], 8: [N, E, S, W] };

export const MOVEMENT_TYPE_BERRY_SOIL = 47;
export const MOVEMENT_TYPE_VS_SEEKER_SPIN = 49;
export const MOVEMENT_TYPE_FOLLOW_PARTNER_TRAINER = 50;
/** DISGUISE_SNOW, _SAND, _ROCK, _GRASS (sub_0206A0BC): hidden under a cover, revealed by MOVEMENT_ACTION_REVEAL_TRAINER. */
export const DISGUISE_TYPES = new Set([51, 52, 53, 54]);
/** A disguised trainer's sprite sits 32 units down (MapObject_SetSpriteJumpOffset −32), under its cover. */
export const DISGUISE_DEPTH = -32;
/** VS_SEEKER_SPIN (sub_02064AF0): face, wait 24 frames, turn a quarter; the turn reverses each time it is back at its initial facing. */
const VS_SEEKER_SPIN_TICKS = 24;
const VS_SEEKER_SPIN: Record<'cw' | 'ccw', Facing[]> = { cw: [N, E, S, W], ccw: [N, W, S, E] };

/** Types handled here that keep a TypeState (origin and stream). */
export function hasNpcTypeState(movementType: number): boolean {
  return movementType in WALK_LOOPS || movementType === MOVEMENT_TYPE_VS_SEEKER_SPIN || movementType === MOVEMENT_TYPE_FOLLOW_PARTNER_TRAINER;
}

/** Types handled here without an update: berry soil is drawn only; a disguise waits for its reveal. */
export function isStaticNpcType(movementType: number): boolean {
  return movementType === MOVEMENT_TYPE_BERRY_SOIL || DISGUISE_TYPES.has(movementType);
}

export interface NpcTypeHost {
  collision(a: Actor, dir: Facing): number;
  /** The other object of the same zone with the same trainer (the double-battle partner), or null. */
  partner(a: Actor): Actor | null;
  log(key: string, detail: string): void;
}

/** One update of a type from this module; returns false when the type is not one of them. */
export function updateNpcType(a: Actor, host: NpcTypeHost): boolean {
  const mt = a.movementType;
  const loop = WALK_LOOPS[mt];
  if (loop) {
    walkLoop(a, loop.route, loop.axis, host);
    return true;
  }
  if (mt === MOVEMENT_TYPE_VS_SEEKER_SPIN) {
    vsSeekerSpin(a);
    return true;
  }
  if (mt === MOVEMENT_TYPE_FOLLOW_PARTNER_TRAINER) {
    followPartner(a, host);
    return true;
  }
  return false;
}

function face(a: Actor, dir: Facing): void {
  if (!a.dirLocked) a.facing = dir;
}

/**
 * sub_02064EEC / sub_020651A4: walk the route's leg `loop` until the next step leaves the movement range
 * (then the next leg), leg 2 until back on the origin's x (or z), leg 3 until back at the origin. A blocked
 * step walks on the spot. Leg and range are relative to the origin (the event's tile).
 */
function walkLoop(a: Actor, route: Facing[], axis: 'x' | 'z', host: NpcTypeHost): void {
  const t = a.type!;
  if (a.movementType >= 37 && a.trainerType === WALK_LOOP_SIGHT_TRAINER_TYPE) host.log('movement-type:walk-loop-sight', 'trainer type 0xA sight step of types 37–44 is not implemented');
  if (t.loop === 2 && (axis === 'x' ? a.x === t.originX : a.z === t.originZ)) t.loop++;
  if (t.loop === 3 && a.x === t.originX && a.z === t.originZ) t.loop = 0;
  let dir = route[t.loop]!;
  let hit = host.collision(a, dir);
  if (hit & 1) {
    t.loop++;
    if (t.loop > 3) throw new Error(`world: object ${a.localId} walk loop ${a.movementType} left its range on the last leg`);
    dir = route[t.loop]!;
    hit = host.collision(a, dir);
  }
  const spin = SPIN_WALK[a.trainerType];
  const facing = spin ? spin[(spin.indexOf(a.facing) + 1) % 4]! : null;
  if (!spin) face(a, dir);
  const locked = a.dirLocked;
  if (spin) a.dirLocked = true;
  if (hit === 0) walk(a, dir, WALK_NORMAL_TICKS, 'walk', 'type');
  else onSpot(a, dir, WALK_NORMAL_TICKS, 'type');
  a.dirLocked = locked;
  if (facing) face(a, facing);
}

function vsSeekerSpin(a: Actor): void {
  const t = a.type!;
  if (t.phase === 'start' || t.phase === 'moving') {
    wait(a, 1, 'type');
    t.phase = 'delay';
    t.timer = VS_SEEKER_SPIN_TICKS;
    return;
  }
  if (--t.timer > 0) return;
  const list = VS_SEEKER_SPIN[t.returning ? 'ccw' : 'cw'];
  face(a, list[(list.indexOf(a.facing) + 1) % 4]!);
  if (a.facing === t.initial) t.returning = !t.returning;
  t.phase = 'moving';
}

/**
 * FOLLOW_PARTNER_TRAINER (sub_02069E1C, sub_02069FE8, sub_0206A034): while the partner (same zone and
 * trainer) walks off a tile (its previous tile; MapObject_StepDir) that is not ours, step toward that tile,
 * unless the step would land on the partner. Without a partner it stands.
 */
function followPartner(a: Actor, host: NpcTypeHost): void {
  const p = host.partner(a);
  if (!p) return;
  const walking = p.motion?.kind === 'walk';
  const px = walking ? p.motion!.fromX : p.x;
  const pz = walking ? p.motion!.fromZ : p.z;
  if ((a.x === px && a.z === pz) || (!walking && p.paused)) return;
  if (a.x === p.x && a.z === p.z) return;
  // GetDirectionBetweenPoints: x first.
  const dir: Facing = a.x > px ? W : a.x < px ? E : a.z > pz ? N : S;
  const [sx, sz] = DELTA[dir];
  if (a.x + sx === p.x && a.z + sz === p.z) return;
  walk(a, dir, WALK_NORMAL_TICKS, 'walk', 'type');
}
