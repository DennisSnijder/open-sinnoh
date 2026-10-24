import type { Id } from '@opensinnoh/core';
import type { Facing, Vec3 } from '@opensinnoh/contracts';
import { DELTA, WARP_LIFT_HEIGHT, WARP_LIFT_STEP, type Action, type Lift } from './movement.ts';
import type { TypeState } from './movement-types.ts';
import { TILE, tileCentre } from './tiles.ts';
import { animCode, createSpriteAnim, drawSpriteAnim, type SpriteAnim } from './sprite-anim.ts';

export interface Motion {
  kind: 'walk' | 'onspot' | 'wait';
  ticks: number;
  elapsed: number;
  anim: 'stand' | 'walk' | 'run';
  fromX: number;
  fromZ: number;
  /** 'type': started by the object's movement type (does not keep the world busy). */
  source: 'input' | 'script' | 'follow' | 'auto' | 'type' | 'approach';
  /** A jump: the walk is drawn with the DS jump arc (a ledge jump is 2 tiles in 16 ticks). */
  jump?: boolean;
  /** Explicit SEQ_NONE for custom silent takeoff; ordinary jumps default to 1547. */
  takeoff?: number;
  /** Arc steps per tick in 1/256 of an arc entry (decomp MovementAction_InitJump; default 0x100). */
  jumpRate?: number;
  /**
   * A Distortion World jump's arc: the axis it lifts the sprite on (default y) and whether it lifts the other
   * way (decomp jump point `jumpAxis`, `invertedJump`).
   */
  jumpAxis?: 'x' | 'y' | 'z';
  jumpInverted?: boolean;
  /** A step that also moves the height (Distortion World walls and jumps): the height it started at, interpolated to `Actor.y`. */
  fromY?: number;
  /** A pose action that ends its pose: the actor faces this way when the motion completes. */
  endPose?: Facing;
  /** A sprite lift action (warp out/in, reveal): `Actor.lift` follows it each tick. */
  lift?: Lift;
}

export interface Actor {
  localId: number;
  /** Zone whose event data the actor comes from (ObjectState.zone). */
  zone: Id;
  sprite: Id | null;
  label?: Id;
  /** The event's hide flag: remove_object sets it (decomp MapObject_SetFlagAndDeleteObject). */
  hideFlag?: Id;
  /** A clone object (ObjectEvent.cloneOf): the zone whose object it copies. */
  cloneOf?: Id;
  cloneLocalId?: number;
  x: number;
  z: number;
  y: number;
  facing: Facing;
  movementType: number;
  persistent: boolean;
  /**
   * Others pass through it (decomp MAP_OBJ_STATUS_18, skipped by sub_02063F00's object collision): the follow
   * type sets it (sub_02069BE0), switching the type away keeps it, `scr_cmd_2b6` sets or clears it.
   */
  passThrough: boolean;
  visible: boolean;
  dirLocked: boolean;
  /** Paused by lock_all/lock_object: the movement type does not run (decomp MAP_OBJ_STATUS_PAUSE_MOVEMENT). */
  paused: boolean;
  /**
   * A LOOK_* movement type's one-time turn, still to run. The DS movement type faces its direction on
   * its first update, which runs only while the object is unpaused and has no movement action
   * (decomp MapObject_Move, sub_02064918). An object added during a script and moved at once turns
   * only after its movement ends.
   */
  look: Facing | null;
  /** Movement type with an update (wander, look around, rotate, back and forth); null for the others. */
  type: TypeState | null;
  /** ObjectEvent trainerType and data[0] (sight range), and movement range around the origin (-1 = unlimited). */
  trainerType: number;
  sight: number;
  /** ObjectEvent.trainer: trainer objects only. */
  trainer?: { id: Id; battler: 0 | 1 };
  range: { x: number; z: number };
  motion: Motion | null;
  script: { steps: { op: string; count: number }[]; index: number; done: number } | null;
  emote: number;
  /** The emote is the '!!' (MOVEMENT_ACTION_EMOTE_DOUBLE_EXCLAMATION_MARK). */
  emoteDouble: boolean;
  /** The billboard's walk/run frame counter (DS draw updates, one per tick). */
  frames: SpriteAnim;
  /** One-shot sprite pose (ActorView.pose) and the ticks since it started; walks and turns end it. */
  pose: string | null;
  poseTick: number;
  /** PAUSE_ANIMATION: the sprite's frame holds (the frame counter does not advance). */
  animPaused: boolean;
  /** Sprite offset in world units (MapObject_SetSpritePosOffset: shake_object, move_camera on the player). Drawn only. */
  offset: Vec3;
  /** Sprite height offset in world units (MapObject_SetSpriteJumpOffset: disguises, warp out/in, reveal). Drawn only. */
  lift: number;
  /** World units the sprite sinks into mud or snow (MapObject_SetSpriteTerrainOffset; ActorView.sink). Drawn only. */
  sink: number;
  /** No height is calculated: the object keeps its y (decomp MapObject_SetHeightCalculationDisabled; Distortion World objects). */
  heightFixed: boolean;
  /** The sprite's roll in degrees (decomp DistWorldMapObjectRotator on an object; ActorView.roll). Drawn only. */
  roll: number;
  /** Transient RGB555 black blend for the Giratina arrival. */
  paletteDarkness?: number;
  cur: Vec3;
  prev: Vec3;
}

export function createActor(localId: number, sprite: Id | null, x: number, z: number, y: number, facing: Facing, movementType: number, zone: Id): Actor {
  return {
    localId,
    zone,
    sprite,
    x,
    z,
    y,
    facing,
    movementType,
    persistent: false,
    passThrough: false,
    visible: true,
    dirLocked: false,
    paused: false,
    look: null,
    type: null,
    trainerType: 0,
    sight: 0,
    range: { x: 0, z: 0 },
    motion: null,
    script: null,
    emote: 0,
    emoteDouble: false,
    frames: createSpriteAnim(),
    pose: null,
    poseTick: 0,
    animPaused: false,
    offset: [0, 0, 0],
    lift: 0,
    sink: 0,
    heightFixed: false,
    roll: 0,
    cur: [tileCentre(x), y, tileCentre(z)],
    prev: [tileCentre(x), y, tileCentre(z)],
  };
}

export function walk(a: Actor, dir: Facing, ticks: number, anim: 'walk' | 'run', source: Motion['source']): void {
  a.pose = null;
  if (!a.dirLocked) a.facing = dir;
  const [dx, dz] = DELTA[dir];
  a.motion = { kind: 'walk', ticks, elapsed: 0, anim, fromX: a.x, fromZ: a.z, source };
  a.x += dx;
  a.z += dz;
}

/**
 * A step in the Distortion World's shared space (decomp sub_02066824, MOVEMENT_ACTION_105–132; jump points):
 * `d` tiles on x and z and `d[1]` tiles of height, drawn facing `facing`.
 */
export function walk3d(a: Actor, d: readonly [number, number, number], ticks: number, anim: 'walk' | 'run', source: Motion['source'], facing: Facing): Motion {
  a.pose = null;
  if (!a.dirLocked) a.facing = facing;
  a.motion = { kind: 'walk', ticks, elapsed: 0, anim, fromX: a.x, fromZ: a.z, fromY: a.y, source };
  a.x += d[0];
  a.y += d[1] * TILE;
  a.z += d[2];
  return a.motion;
}

export function onSpot(a: Actor, dir: Facing, ticks: number, source: Motion['source']): void {
  a.pose = null;
  if (!a.dirLocked) a.facing = dir;
  a.motion = { kind: 'onspot', ticks, elapsed: 0, anim: 'walk', fromX: a.x, fromZ: a.z, source };
}

/** Ledge behaviours by the direction that jumps them (decomp TILE_BEHAVIOR_JUMP_*). */
export const LEDGES: Record<Facing, string> = { up: 'JUMP_NORTH', down: 'JUMP_SOUTH', left: 'JUMP_WEST', right: 'JUMP_EAST' };
/** JUMP_FAR: 2 units per frame for 16 frames, two tiles (decomp MovementAction_JumpFar*, MovementAction_InitJump). */
export const JUMP_TICKS = 16;
/** Arc height per frame in units (decomp JUMP_HEIGHT_HIGH, one entry per frame of a 16-frame jump). */
const JUMP_ARC = [4, 6, 8, 10, 11, 12, 12, 12, 11, 10, 9, 8, 6, 4, 0, 0];

/** Jumps two tiles in `dir` (over a ledge). */
export function jump(a: Actor, dir: Facing, source: Motion['source']): void {
  a.pose = null;
  if (!a.dirLocked) a.facing = dir;
  const [dx, dz] = DELTA[dir];
  a.motion = { kind: 'walk', ticks: JUMP_TICKS, elapsed: 0, anim: 'walk', fromX: a.x, fromZ: a.z, source, jump: true };
  a.x += 2 * dx;
  a.z += 2 * dz;
}

/** Height above the ground of a jumping actor this tick (0 when not jumping). */
export function jumpHeight(a: Actor): number {
  const m = a.motion;
  return m?.jump ? JUMP_ARC[Math.min(15, Math.floor((m.elapsed * (m.jumpRate ?? 0x100)) / 0x100))]! : 0;
}

/** The sprite lift after `elapsed` of `ticks` frames of a lift action. */
function liftAt(lift: Lift, elapsed: number, ticks: number): number {
  if (lift === 'warp-out') return Math.min(WARP_LIFT_HEIGHT, elapsed * WARP_LIFT_STEP);
  if (lift === 'warp-in') return Math.max(0, WARP_LIFT_HEIGHT - elapsed * WARP_LIFT_STEP);
  return elapsed < ticks ? JUMP_ARC[elapsed * 2]! : 0;
}

export function wait(a: Actor, ticks: number, source: Motion['source']): void {
  a.motion = { kind: 'wait', ticks, elapsed: 0, anim: 'stand', fromX: a.x, fromZ: a.z, source };
}

export function startAction(a: Actor, action: Action): void {
  switch (action.kind) {
    case 'walk':
      return walk(a, action.dir, action.ticks, action.anim, 'script');
    case 'onspot':
      return onSpot(a, action.dir, action.ticks, 'script');
    case 'face':
      a.pose = null;
      if (!a.dirLocked) a.facing = action.dir;
      return wait(a, 1, 'script');
    case 'pose':
      a.pose = action.pose;
      a.poseTick = 0;
      wait(a, action.ticks, 'script');
      if (!action.hold) a.motion!.endPose = action.end;
      return;
    case 'delay':
      return wait(a, action.ticks, 'script');
    case 'emote':
      a.emote = action.ticks;
      a.emoteDouble = action.double;
      return wait(a, action.ticks, 'script');
    case 'visible':
      a.visible = action.visible;
      return wait(a, 1, 'script');
    case 'lockDir':
      a.dirLocked = action.locked;
      return wait(a, 1, 'script');
    case 'animPause':
      a.animPaused = action.paused;
      return wait(a, 1, 'script');
    case 'lift':
      if (action.lift === 'reveal') a.lift = 0;
      wait(a, action.ticks, 'script');
      a.motion!.lift = action.lift;
      return;
    case 'walk3d':
      walk3d(a, action.d, action.ticks, action.anim, 'script', action.face);
      return;
    case 'hop':
      hop(a, action.dir, action.tiles, action.ticks, action.rate, 'script');
      a.motion!.takeoff = action.sound ?? 1547;
      return;
  }
}

/** A jump of `tiles` tiles in `ticks` frames, the arc read at `rate` (decomp MovementAction_InitJump's distance and arc rate). */
export function hop(a: Actor, dir: Facing, tiles: number, ticks: number, rate: number, source: Motion['source']): void {
  a.pose = null;
  if (!a.dirLocked) a.facing = dir;
  const [dx, dz] = DELTA[dir];
  a.motion = { kind: 'walk', ticks, elapsed: 0, anim: 'walk', fromX: a.x, fromZ: a.z, source, jump: true, jumpRate: rate };
  a.x += tiles * dx;
  a.z += tiles * dz;
}

/** Advances the actor's motion by one tick. Returns the motion if it completed this tick. */
export function advance(a: Actor): Motion | null {
  if (a.emote > 0) a.emote--;
  if (a.pose) a.poseTick++;
  const m = a.motion;
  if (!m) {
    drawSpriteAnim(a.frames, a.facing, 0, a.animPaused);
    return null;
  }
  m.elapsed++;
  drawSpriteAnim(a.frames, a.facing, animCode(m), a.animPaused);
  if (m.lift) a.lift = liftAt(m.lift, m.elapsed, m.ticks);
  if (m.elapsed < m.ticks) return null;
  a.motion = null;
  // A move ends with a second draw at anim code 0 in the same frame (MovementAction_Walk_Step1 and the
  // jump step draw, then set code 0; the object task draws again). An on-spot walk ends on code 0 alone.
  if (m.kind === 'walk') drawSpriteAnim(a.frames, a.facing, 0, a.animPaused);
  if (m.endPose) {
    a.pose = null;
    if (!a.dirLocked) a.facing = m.endPose;
  }
  return m;
}

/** The actor's height this tick: interpolated along a step that moves it (`Motion.fromY`), else `y`. */
export function actorY(a: Actor): number {
  const m = a.motion;
  return m?.kind === 'walk' && m.fromY !== undefined ? m.fromY + ((a.y - m.fromY) * m.elapsed) / m.ticks : a.y;
}

/** World x/z of the actor this tick (interpolated along a walk). */
export function actorXZ(a: Actor): [number, number] {
  const m = a.motion;
  let wx = tileCentre(a.x);
  let wz = tileCentre(a.z);
  if (m?.kind === 'walk') {
    const t = m.elapsed / m.ticks;
    wx = tileCentre(m.fromX) + (wx - tileCentre(m.fromX)) * t;
    wz = tileCentre(m.fromZ) + (wz - tileCentre(m.fromZ)) * t;
  }
  return [wx, wz];
}
