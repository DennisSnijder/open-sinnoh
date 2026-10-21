import type { FieldSound } from './sound.ts';
import type { Id } from '@opensinnoh/core';
import type { Facing, GameState, InputFrame, Registries, StubLog, Vec3 } from '@opensinnoh/contracts';
import { BUMP_TICKS, DELTA, OPPOSITE, RUN_TICKS, TURN_TICKS, WALK_NORMAL_TICKS, WALK_SLOW_TICKS } from './movement.ts';
import { JUMP_TICKS, LEDGES, jump, onSpot, walk, walk3d, wait, type Actor, type Motion } from './npc.ts';
import { drawnFacing, type AvatarDistortion } from './distortion/feature.ts';
import { DW_JUMP, uprightStep, type Upright } from './distortion/actions.ts';
import type { DwJump } from '@opensinnoh/contracts';
import {
  SLIDES,
  blocksMovement,
  canRockClimb,
  isBikeRamp,
  isBikeSlope,
  isBridge,
  isBridgeStart,
  isDeepMud,
  isDeepMudWithGrass,
  isIce,
  isMud,
  isMudWithGrass,
  isPuddle,
  isShallowWater,
  isSnowWithShadows,
  isSurfable,
  isVeryTallGrass,
  isWaterfall,
  onBikeBridgeEW,
  onBikeBridgeNS,
  onSand,
  onShallowSnow,
  onSnow,
  onWater,
} from './behaviours.ts';
import { Effects, FLDEFF, TRACK_TICKS } from './effects.ts';
import { tileCentre } from './tiles.ts';

/**
 * The player avatar (decomp src/player_move.c, src/player_avatar.c, src/overlay005/ov5_021DFB54.c):
 * walking, cycling and surfing; tile-forced movement (ice, bike slopes and ramps, Fuego Ironworks spin
 * tiles, deep mud); the native Strength push; and the HM traversal tasks Surf, Waterfall and Rock Climb.
 * Speeds are the DS movement actions (frames = ticks): WALK_FASTER 2, WALK_SLIGHTLY_FASTER 3, WALK_FAST 4,
 * WALK_SLIGHTLY_FAST 6, WALK_NORMAL 8, WALK_SLOW 16, WALK_SLOWER 32.
 */

/** PLAYER_COLLISION_* (constants/player_avatar.h). */
const C = { NONE: 0, WILL_COLLIDE: 1 << 0, OBJECT: 1 << 1, JUMP: 1 << 2, BIKE_RAMP: 1 << 4, WATER: 1 << 5, BIKE_BRIDGE: 1 << 6, JUMP_TWICE: 1 << 7 };

const WALK_FASTER = 2;
const WALK_SLIGHTLY_FASTER = 3;
const WALK_FAST = 4;
/** ((16 * FX32_ONE) >> 1) / 2: the ice probe's distance ahead (PlayerAvatar_CheckIceHeightChange). */
const QUARTER_TILE = 4;
const WALK_SLIGHTLY_FAST = 6;
const WALK_SLOWER = 32;
/** JUMP_NEAR_FAST: 1 tile in 8 frames, arc rate 0x200 (surf mount and dismount, Rock Climb hops). */
const HOP = { tiles: 1, ticks: 8, rate: 0x200 };
/** JUMP_ON_SPOT_FAST (escaping deep mud). */
const HOP_ON_SPOT = { tiles: 0, ticks: 8, rate: 0x200 };
/** Bike ramps: JUMP_FARTHER (3 tiles, 12 frames, 0x140) in gear 1, else JUMP_NEAR_SLOW (1 tile, 16 frames, 0xF0). */
const RAMP_FAR = { tiles: 3, ticks: 12, rate: 0x140 };
const RAMP_NEAR = { tiles: 1, ticks: 16, rate: 0xf0 };
/** The ledge jump (JUMP_FAR, the existing world jump). */
const LEDGE_TICKS = JUMP_TICKS;

/**
 * The HM cut-in (decomp overlay006/hm_cut_in.c sCutInTaskFuncs, one state step per frame): init 1, sprites 1,
 * window X 4, window Y 6, speed-up 15, slide in 3, to centre 6, pause 8, slide out 7, shrink 5, cleanup 3 =
 * 59 frames, with the sprite resources ready the frame after init.
 */
export { HM_CUT_IN_TICKS } from './hm-cut-in.ts';
/** Waterfall (SubTask_Waterfall_*): 32 frames, then 64 more; the player ends 2 tiles up or down. */
const WATERFALL_TICKS = [32, 64] as const;
/** Strength: the boulder walks WALK_SLOW, the player WALK_ON_SPOT_NORMAL (ov5_021DFFBC). */
const STRENGTH_PUSH_TICKS = WALK_SLOW_TICKS;
const STRENGTH_PUSHER_TICKS = WALK_NORMAL_TICKS;
/** Deep mud: 5 direction changes (WALK_ON_SPOT_FASTER), then a JUMP_ON_SPOT_FAST frees the player. */
const MUD_WIGGLES = 5;
/** The Strength boulder's object graphics id (ov5_021DFF1C). */
const BOULDER_GFX = 0x54;

/** Fixed flags by number (decomp FLAG_STRENGTH_ACTIVE 2402; generated/vars_flags.txt). */
export const FLAG_STRENGTH_ACTIVE = 2402;

/** Spin tiles turn the player counter-clockwise (ov5_021E11E0: north → west → south → east). */
const SPIN: Record<Facing, Facing> = { up: 'left', left: 'down', down: 'right', right: 'up' };

type Hop = { tiles: number; ticks: number; rate: number; sound?: number };

type Task =
  | { kind: 'surf'; dir: Facing; phase: 'cut-in' | 'jump' }
  | { kind: 'dismount'; dir: Facing; phase: 'start' | 'jump' }
  | { kind: 'waterfall'; dir: 'up' | 'down'; phase: 'cut-in' | 'move'; t: number; from: Vec3; to: Vec3; tx: number; tz: number }
  | { kind: 'rockClimb'; dir: Facing; phase: 'cut-in' | 'hop-on' | 'move' | 'hop-off' }
  | { kind: 'strength'; dir: Facing; boulder: Actor; phase: 'wait' | 'push'; fall?: Generator<void, void, void> }
  | { kind: 'mud'; count: number; phase: 'ready' | 'input' }
  | { kind: 'slide'; dir: Facing; phase: 'walk' | 'spin'; t: number }
  /** JumpOnFloatingPlatform (overlay 9): a Distortion World jump point's jump to a support or the land. */
  | { kind: 'dwJump'; jump: DwJump; phase: 'dir' | 'move' };

/** What the avatar needs from the world. */
export interface AvatarHost {
  reg: Registries;
  state: GameState;
  log: StubLog;
  effects: Effects;
  sound: FieldSound;
  cutIn(slot: number): void;
  cutInDone(): boolean;
  hero(): Actor;
  /** The auto-run option (OpenSinnoh): B held walks instead of running. */
  autoRun(): boolean;
  behaviour(x: number, z: number): string;
  blocked(x: number, z: number): boolean;
  /** A map feature's jump tile (decomp DynamicMapFeatures_WillPlayerJumpEternaGymClock, before the ledges). */
  featureJump(x: number, z: number, dir: Facing): boolean;
  occupant(x: number, z: number, except: Actor): Actor | null;
  /** The follower when it walks along (hasPartner): the player may step into its tile. */
  partner(): Actor | null;
  follow(fromX: number, fromZ: number, ticks: number): void;
  /** Object collision bits of an object's step (world objectCollision: 1 range, 2 tile, 4 object). */
  objectCollision(a: Actor, dir: Facing): number;
  heightAt(wx: number, wz: number, current: number): number;
  flagBySource(index: number): boolean;
  /** The Distortion World room's runtime, or null outside one. */
  distortion(): AvatarDistortion | null;
  /**
   * ov5_021E06A8: the object one tile ahead (any height, sub_0206326C), if it is a snowball (graphics 0x76),
   * breaks: its break effect plays and the object is deleted, unsaved. Returns nothing; the slide goes on.
   */
  breakSnowball(x: number, z: number): void;
}

function inputDir(input: InputFrame): Facing | null {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  return dirs.find((d) => input.pressed.includes(d)) ?? dirs.find((d) => input.held.includes(d)) ?? null;
}

const vertical = (d: Facing) => d === 'up' || d === 'down';

export class Avatar {
  /** Bike speed 0–3 (PlayerAvatar speed); cleared on stops, turns and bumps. */
  speed = 0;
  private brake = false;
  /** The direction of the last move (MapObject_GetMovingDir; differs from facing while the facing is locked). */
  movingDir: Facing = 'down';
  /** DS "moving" move state: a held direction keeps walking without a turn in place. */
  moving = false;
  /** Tile-forced movement in progress (ice, slopes, ramps): the facing is locked, the sprite does not animate. */
  private forced = false;
  private retainSpeed = false;
  /** Sliding back down a bike slope (PlayerAvatar "move through mud" flag). */
  private slopeBack = false;
  /** Set when an ice slide stops: the underfoot tile is not forcing until the next step starts. */
  private ignoreTile = false;
  /** Escaped from deep mud: no new stuck task until the next step starts. */
  private escapedMud = false;
  /** MAP_OBJ_DO_NOT_SINK_INTO_TERRAIN: set by the jump out of deep mud, cleared when the next step starts. */
  private doNotSink = false;
  /** AVATAR_MOVE_ON_CYCLING_ROAD (FieldHost.forceBicycling): not saved; a map load clears it. */
  onCyclingRoad = false;
  /** MAP_OBJ_STATUS_ON_ELEVATED_BRIDGE: set by a BRIDGE_START step, kept on bridge tiles. */
  elevated = false;
  private task: Task | null = null;
  /** The surf blob and the Rock Climb mount (effect keys). */
  private mount: number | null = null;
  private ripple: number | null = null;
  /** Position override while a waterfall task moves the player off the grid. */
  private override: Vec3 | null = null;
  private lastStep: Motion | null = null;

  constructor(private readonly h: AvatarHost) {}

  private get p(): Actor {
    return this.h.hero();
  }

  private get surfing(): boolean {
    return this.h.state.playerState === 'surf';
  }

  private get cycling(): boolean {
    return this.h.state.playerState === 'cycle';
  }

  /** The running avatar task's kind (HM ride, Strength, deep mud, spin tiles), or null. */
  taskKind(): Task['kind'] | null {
    return this.task?.kind ?? null;
  }

  /** No avatar task (HM, Strength, deep mud, spin tiles) is running. */
  idle(): boolean {
    return this.task === null;
  }

  /**
   * The underfoot tile forces movement (decomp PlayerAvatar_UpdatePlayerMoveState: a tile movement other
   * than NONE or CYCLING_ROAD_DOWN keeps PLAYER_MOVE_STATE_MOVING, so FieldInput_Update takes no start
   * menu, A, sign, map transition or step events): ice, bike slopes and ramps, unless the stopped ice
   * slide set the ignore-tile flag.
   */
  onForcingTile(): boolean {
    if (this.ignoreTile) return false;
    const here = this.h.behaviour(this.p.x, this.p.z);
    return isIce(here) || isBikeSlope(here) || isBikeRamp(here);
  }

  /** The sprite does not sink into the terrain (decomp MapObject_CheckFlagDoNotSinkIntoTerrain). */
  noSink(): boolean {
    return this.doNotSink;
  }

  positionOverride(): Vec3 | null {
    return this.override;
  }

  /** A map load recreates the avatar from the saved player state (speed, tasks and effects are not saved). */
  reset(): void {
    if (this.task) throw new Error(`world: map load during the avatar task ${this.task.kind}`);
    this.speed = 0;
    this.brake = false;
    this.moving = false;
    this.forced = this.retainSpeed = this.slopeBack = this.ignoreTile = this.escapedMud = this.doNotSink = this.onCyclingRoad = false;
    this.override = null;
    this.lastStep = null;
    this.movingDir = this.h.distortion()?.movingDir() ?? this.p.facing;
    const here = this.h.behaviour(this.p.x, this.p.z);
    // The DS saves MAP_OBJ_STATUS_ON_ELEVATED_BRIDGE with the player (MapObjectSave.status); we derive it from the
    // saved height: on a bridge tile with land a level below the deck, a player on that lower land is under the bridge.
    this.elevated = !this.surfing && (isBridgeStart(here) || (isBridge(here) && !this.underBridge()));
    this.h.effects.clear();
    this.mount = this.ripple = null;
    if (this.surfing) this.mount = this.h.effects.add(FLDEFF.SURF_MOUNT, 'mount', this.p.cur, { follow: true, ticks: null });
  }

  /** Standing on the lower of two levels (a height step apart) of this tile: under a bridge's deck. */
  private underBridge(): boolean {
    const [x, z] = [tileCentre(this.p.x), tileCentre(this.p.z)];
    const low = this.h.heightAt(x, z, -1e9);
    const high = this.h.heightAt(x, z, 1e9);
    return high - low >= 20 && this.p.y - low < high - this.p.y;
  }

  /** Decomp PlayerAvatar_RequestState{Walking,Cycle,Surf}: clears the speed; surfing shows the blob under the player. */
  stateChanged(): void {
    this.speed = 0;
    this.brake = false;
    if (this.surfing && !this.h.effects.has(this.mount)) this.mount = this.h.effects.add(FLDEFF.SURF_MOUNT, 'mount', this.p.cur, { follow: true, ticks: null });
    if (!this.surfing) {
      this.h.effects.remove(this.mount);
      this.mount = null;
    }
  }

  // ---------- collision (PlayerAvatar_CheckCollision) ----------

  collision(dir: Facing): number {
    const p = this.p;
    const [dx, dz] = DELTA[dir];
    const nx = p.x + dx;
    const nz = p.z + dz;
    const here = this.h.behaviour(p.x, p.z);
    const next = this.h.behaviour(nx, nz);
    let c = C.NONE;
    if (this.h.blocked(nx, nz)) c |= C.WILL_COLLIDE;
    // A height step of 20 units or more is a wall (TerrainCollisionManager_WillPlayerCollide, GetVerticalDirection).
    if (Math.abs(this.h.heightAt(tileCentre(nx), tileCentre(nz), p.y) - p.y) >= 20) c |= C.WILL_COLLIDE;
    // Directional walls (sub_02064004): leaving this tile that way, or entering the next from that side.
    if (blocksMovement(here, dir) || blocksMovement(next, OPPOSITE[dir])) c |= C.WILL_COLLIDE;
    const other = this.h.occupant(nx, nz, p);
    if (other && other !== this.h.partner()) c |= C.OBJECT;
    if (next === LEDGES[dir] || this.h.featureJump(nx, nz, dir)) c |= C.JUMP;
    // DistWorld_IsBlockedByCynthia: after Giratina's battle, Cynthia's tile takes no double jump.
    if (next === `${LEDGES[dir]}_TWICE` && !this.h.distortion()?.blockedByCynthia(nx, nz, dir)) c |= C.JUMP_TWICE;
    if ((dir === 'right' && next === 'BIKE_RAMP_EASTWARD') || (dir === 'left' && next === 'BIKE_RAMP_WESTWARD')) c |= C.BIKE_RAMP;
    if (onWater(next, this.elevated)) c |= C.WATER;
    if (this.cycling) {
      if ((onBikeBridgeNS(next, this.elevated) && !vertical(dir)) || (onBikeBridgeEW(next, this.elevated) && vertical(dir))) c |= C.BIKE_BRIDGE | C.WILL_COLLIDE;
      // PlayerAvatar_CheckBikeCollision: no riding into water, snow, very tall grass or mud.
      if (onWater(next, this.elevated) || onSnow(next, this.elevated) || isVeryTallGrass(next) || isMud(next) || isMudWithGrass(next)) c |= C.WILL_COLLIDE;
    } else if (onBikeBridgeNS(next, this.elevated) || onBikeBridgeEW(next, this.elevated)) c |= C.BIKE_BRIDGE | C.WILL_COLLIDE;
    return c;
  }

  /** On an elevated bike bridge, turning across it is not allowed (PlayerAvatar_IsOnBikeBridgeWrongDirection). */
  private wrongBridgeDir(dir: Facing): boolean {
    const here = this.h.behaviour(this.p.x, this.p.z);
    if (onBikeBridgeNS(here, this.elevated)) return !vertical(dir);
    if (onBikeBridgeEW(here, this.elevated)) return vertical(dir);
    return false;
  }

  // ---------- motions ----------

  private step(dir: Facing, ticks: number, anim: 'walk' | 'run' = 'walk', source: Motion['source'] = 'input', follow = true): void {
    const p = this.p;
    const fromX = p.x;
    const fromZ = p.z;
    walk(p, dir, ticks, anim, source);
    this.movingDir = dir;
    if (follow) this.h.follow(fromX, fromZ, ticks);
  }

  /** A forced step (ice, slope slide): the facing is locked and the sprite does not animate. */
  private forcedStep(dir: Facing, ticks: number): void {
    const p = this.p;
    const facing = p.facing;
    this.step(dir, ticks);
    p.facing = facing;
    p.motion!.anim = 'stand';
  }

  private hop(dir: Facing, hop: Hop, source: Motion['source']): void {
    const p = this.p;
    const [dx, dz] = DELTA[dir];
    p.pose = null;
    if (!p.dirLocked) p.facing = dir;
    p.motion = { kind: 'walk', ticks: hop.ticks, elapsed: 0, anim: 'walk', fromX: p.x, fromZ: p.z, source, jump: true, jumpRate: hop.rate, takeoff: hop.sound ?? 1547 };
    p.x += hop.tiles * dx;
    p.z += hop.tiles * dz;
    this.movingDir = dir;
  }

  private ledge(dir: Facing): void {
    const p = this.p;
    const fromX = p.x;
    const fromZ = p.z;
    jump(p, dir, 'input');
    this.movingDir = dir;
    this.h.follow(fromX, fromZ, LEDGE_TICKS);
  }

  private bump(dir: Facing): void {
    this.h.sound.play(1537);
    onSpot(this.p, dir, BUMP_TICKS, 'input');
    this.movingDir = dir;
  }

  /** PlayerAvatar_SetMovement_Turning: on a wall or the ceiling the on-spot turn faces the drawn way. */
  private turn(dir: Facing): void {
    const up = this.upright();
    onSpot(this.p, up ? drawnFacing(up, dir) : dir, TURN_TICKS, 'input');
    this.movingDir = dir;
  }

  /** Stops on an elevated bike bridge facing along it (MapObject_Turn to the moving direction). */
  private faceMoving(): void {
    this.p.facing = this.movingDir;
    this.speed = 0;
  }

  private clearForced(): void {
    if (!this.forced) return;
    if (!this.retainSpeed) this.speed = 0;
    this.forced = this.retainSpeed = this.slopeBack = false;
  }

  // ---------- input (FieldInput_Process → ov5_021DFDE0, then PlayerAvatar_MoveMain) ----------

  /** Player input for one tick; called when no script, warp or script movement holds the player. */
  input(input: InputFrame): void {
    if (this.task) return;
    const p = this.p;
    // PlayerAvatar_TryCyclingGearChange runs every processed frame, mid-step too; not on a ramp.
    if (this.cycling && input.pressed.includes('b') && !isBikeRamp(this.h.behaviour(p.x, p.z))) {
      this.h.state.cyclingGear = this.h.state.cyclingGear === 1 ? 0 : 1;
      this.h.sound.play(this.h.state.cyclingGear === 0 ? 1564 : 1561);
    }
    const bumping = p.motion?.source === 'input' && p.motion.kind === 'onspot' && p.motion.ticks === BUMP_TICKS;
    if (p.motion && !bumping) return;
    const dir = inputDir(input);
    if (bumping) {
      if (!dir) this.moving = false;
      if (!dir || dir === this.curDir()) return;
      p.motion = null;
    }
    // ov5_021DFDE0: with forced movement, only the snowball check (speed ≥ 1) runs before the tile move.
    if (this.forced) {
      if (this.speed >= 1) {
        const [dx, dz] = DELTA[this.movingDir];
        this.h.breakSnowball(p.x + dx, p.z + dz);
      }
    } else if (this.events(dir)) return;
    if (this.tileMove(dir)) return;
    if (this.cycling) this.bike(dir);
    else this.normal(dir, input);
  }

  /** ov5_021DFE68 / ov5_021DFEF4: Strength, the waterfall descent, the surf dismount, deep mud. */
  private events(dir: Facing | null): boolean {
    if (dir) {
      // PLAYER_EVENT_DISTORTION_WORLD: DistWorld_HandlePlayerMoved first.
      const ms = this.moveState(dir);
      const jump = this.h.distortion()?.moved(dir, ms === 'moving');
      if (jump === 'event') {
        // A waterfall's cascade started (a field task): the feature holds the field.
        this.moving = false;
        return true;
      }
      if (jump) {
        this.task = { kind: 'dwJump', jump, phase: 'dir' };
        this.moving = false;
        return true;
      }
      const p = this.p;
      const [dx, dz] = DELTA[dir];
      if (ms === 'moving' && this.h.flagBySource(FLAG_STRENGTH_ACTIVE) && this.tryStrength(dir)) return true;
      if (ms === 'moving' && dir === 'down' && this.surfing && this.partyHasFieldMove(this.h.behaviour(p.x + dx, p.z + dz), isWaterfall)) {
        // ov5_021E04A8: surfing south into a waterfall with Waterfall in the party descends (no cut-in).
        this.startWaterfall('down', false);
        return true;
      }
      if (ms === 'moving' && this.surfing && this.tryDismount(dir)) return true;
    }
    return this.tryStuckInMud();
  }

  /** PlayerAvatar_GetMoveStateFromPlayerAvatarState (both gears use the fourth-gear rule there). */
  private moveState(dir: Facing): 'turning' | 'moving' {
    const cur = this.curDir();
    if (this.cycling) return cur !== dir && !this.moving && this.speed < 2 ? 'turning' : 'moving';
    return cur !== dir && !this.moving ? 'turning' : 'moving';
  }

  /** PlayerAvatar_CalcMoveState's current direction: the moving direction on a wall or the ceiling, else the facing. */
  private curDir(): Facing {
    return this.upright() ? this.movingDir : this.p.facing;
  }

  /** The Distortion World wall or ceiling the player is on, or null. */
  private upright(): Upright | null {
    const s = this.h.distortion()?.surface();
    return s === 'west-wall' || s === 'east-wall' || s === 'ceiling' ? s : null;
  }

  private partyHasFieldMove(behaviour: string, kind: (b: string) => boolean): boolean {
    if (!kind(behaviour)) return false;
    const move = this.behaviourRecord(behaviour)?.fieldMove?.move;
    return !!move && this.h.state.party.some((m) => m.moves?.includes(move));
  }

  private behaviourRecord(name: string) {
    for (const b of this.h.reg.tileBehaviors.values()) if (b.name === name) return b;
    return undefined;
  }

  // ---------- tile-forced movement (PlayerAvatar_TryMoveFromCurTileBehavior) ----------

  private tileMove(dir: Facing | null): boolean {
    const p = this.p;
    const here = this.h.behaviour(p.x, p.z);
    // PlayerAvatar_IsOnCyclingRoadBridge: before the ignore-tile check, with no d-pad input.
    if (dir === null && this.cycling && this.onCyclingRoad && this.elevated && isBridge(here)) return this.cyclingRoadDown();
    if (this.ignoreTile) return false;
    if (isIce(here)) return this.ice();
    if (isBikeSlope(here)) return this.slope(dir);
    if (here === 'BIKE_RAMP_EASTWARD' || here === 'BIKE_RAMP_WESTWARD') return this.ramp(here === 'BIKE_RAMP_EASTWARD' ? 'right' : 'left');
    this.clearForced();
    return false;
  }

  /**
   * PlayerAvatar_TileMove_Ice: slide on in the moving direction. The surface 4 units ahead
   * (PlayerAvatar_CheckIceHeightChange) speeds the slide up going down (to speed 3) and slows it going up;
   * slowing below 0 or bumping while climbing steps back one tile WALK_SLOW with the facing locked. A bump
   * otherwise stops the slide (Snowpoint Gym's slopes; flat ice keeps speed 0).
   */
  private ice(): boolean {
    const dir = this.movingDir;
    const change = this.iceHeightChange(dir);
    const blocked = this.collision(dir) !== C.NONE;
    this.forced = true;
    if (blocked) {
      this.clearForced();
      if (change !== 'up') {
        this.ignoreTile = true;
        this.moving = false;
        return false;
      }
      return this.iceStepBack(dir);
    }
    if (change === 'up' && this.speed - 1 < 0) {
      this.clearForced();
      return this.iceStepBack(dir);
    }
    if (change === 'up') this.speed--;
    else if (change === 'down') this.speed = Math.min(this.speed + 1, 3);
    this.forcedStep(dir, this.speed === 0 ? WALK_FAST : this.speed === 1 ? WALK_SLIGHTLY_FASTER : WALK_FASTER);
    this.moving = true;
    return true;
  }

  /** The ice's slow step back down the slope (MOVEMENT_ACTION_WALK_SLOW, the facing locked, the tile ignored). */
  private iceStepBack(dir: Facing): boolean {
    const back = OPPOSITE[dir];
    if (this.collision(back) !== C.NONE) return false;
    this.forcedStep(back, WALK_SLOW_TICKS);
    this.ignoreTile = true;
    this.forced = true;
    this.moving = true;
    return true;
  }

  /** PlayerAvatar_CheckIceHeightChange: the height a quarter tile ahead of the player against theirs. */
  private iceHeightChange(dir: Facing): 'up' | 'down' | null {
    const p = this.p;
    const [dx, dz] = DELTA[dir];
    const y = this.h.heightAt(p.cur[0] + dx * QUARTER_TILE, p.cur[2] + dz * QUARTER_TILE, p.y);
    if (y === p.y) return null;
    return y < p.y ? 'down' : 'up';
  }

  /** PlayerAvatar_TileMove_BikeSlope: up only on the bike at speed ≥ 3 holding up; otherwise slide back down. */
  private slope(dir: Facing | null): boolean {
    const moveDir = this.movingDir;
    if (moveDir === 'up') {
      if (this.cycling && this.speed >= 3 && dir === 'up') {
        this.step('up', WALK_FASTER);
        this.moving = true;
        return true;
      }
      if (this.collision('down') !== C.NONE) return false;
      this.forcedStep('down', WALK_SLOW_TICKS);
      this.speed = 0;
      this.forced = true;
      this.slopeBack = true;
      this.moving = true;
      return true;
    }
    if (moveDir === 'down') {
      if (!this.slopeBack) {
        this.step('down', WALK_FASTER);
        this.moving = true;
        if (this.h.state.cyclingGear === 1) this.speed = 3;
        return true;
      }
      this.forcedStep('down', WALK_SLOW_TICKS);
      this.forced = true;
      this.moving = true;
      return true;
    }
    return false;
  }

  /** PlayerAvatar_TileMove_CyclingRoadDown: roll south at full speed, or stop facing south when blocked. */
  private cyclingRoadDown(): boolean {
    if (this.collision('down') === C.NONE) {
      this.step('down', WALK_FASTER);
      this.moving = true;
      this.speed = 3;
      return true;
    }
    this.p.facing = 'down';
    this.speed = 0;
    this.moving = false;
    this.brake = false;
    return true;
  }

  /** PlayerAvatar_TileMove_BikeRamp*: the jump off a ramp (far in gear 1). */
  private ramp(dir: Facing): boolean {
    if (this.h.state.cyclingGear === 1) this.h.sound.play(1622);
    this.hop(dir, this.h.state.cyclingGear === 1 ? RAMP_FAR : RAMP_NEAR, 'input');
    this.forced = true;
    this.retainSpeed = true;
    return true;
  }

  // ---------- walking and surfing (PlayerAvatar_SetMovement_Normal) ----------

  private normal(dir: Facing | null, input: InputFrame): void {
    const p = this.p;
    if (!dir) {
      this.moving = false;
      return;
    }
    if (dir !== this.curDir() && !this.moving) return this.turn(dir);
    this.moving = true;
    const surface = this.h.distortion()?.surface();
    if (surface === 'floor') return this.supportFloor(dir, input);
    if (surface === 'west-wall' || surface === 'east-wall' || surface === 'ceiling') return this.supportUpright(surface, dir, input);
    const c = this.collision(dir);
    if (!this.surfing) {
      if (c & C.JUMP) return this.ledge(dir);
      if (c & C.JUMP_TWICE) return this.distortionJump(dir);
      if (c !== C.NONE) return this.bump(dir);
      const run = this.running(input);
      // MapObject_GetDeepSnowMovementAction: the underfoot snow slows the step (and stops running).
      const here = this.h.behaviour(p.x, p.z);
      const snow = here === 'SNOW_DEEPEST' ? WALK_SLOWER : here === 'SNOW_DEEPER' ? WALK_SLOW_TICKS : here === 'SNOW_DEEP' ? WALK_NORMAL_TICKS : null;
      if (snow !== null) return this.started(() => this.step(dir, snow));
      return this.started(() => this.step(dir, run ? RUN_TICKS : WALK_NORMAL_TICKS, run ? 'run' : 'walk'));
    }
    if (c === C.NONE || c === C.WATER) return this.started(() => this.step(dir, WALK_FAST));
    this.bump(dir);
  }

  /** JUMP_*_TWICE (PLAYER_COLLISION_JUMP_TWICE): MOVEMENT_ACTION_JUMP_DISTORTION_WORLD_*, 3 tiles in 24 frames. */
  private distortionJump(dir: Facing): void {
    this.started(() => this.hop(dir, { ...DW_JUMP, sound: 0 }, 'input'));
  }

  // ---------- Distortion World supports (player_move.c) ----------

  /** PlayerAvatar_SetMovement_DistortionFloor: ordinary steps on the support's grid, the height kept. */
  private supportFloor(dir: Facing, input: InputFrame): void {
    const c = this.h.distortion()!.floorCollision(dir);
    if (!this.surfing) {
      if (c & C.JUMP_TWICE) return this.distortionJump(dir);
      if (c !== C.NONE) return this.bump(dir);
      const run = this.running(input);
      return this.started(() => this.step(dir, run ? RUN_TICKS : WALK_NORMAL_TICKS, run ? 'run' : 'walk'));
    }
    if (c === C.NONE || c === C.WATER) return this.started(() => this.step(dir, WALK_FAST));
    this.bump(dir);
  }

  /**
   * PlayerAvatar_UpdateMovement_NormalDistortion on a wall or the ceiling: MOVEMENT_ACTION_105–116 (walk and surf)
   * and 121–132 (run) step in the surface's axes, drawn facing the action's way, and turn the moving direction as
   * the action does (the east wall's +z steps turn it west). A collision walks on the spot facing the drawn way
   * and turns the moving direction to the input's.
   */
  private supportUpright(surface: Upright, dir: Facing, input: InputFrame): void {
    const p = this.p;
    const c = this.h.distortion()!.collision(dir);
    const blocked = this.surfing ? c !== C.NONE && c !== C.WATER : c !== C.NONE;
    if (blocked) {
      onSpot(p, drawnFacing(surface, dir), BUMP_TICKS, 'input');
      this.movingDir = dir;
      return;
    }
    const s = uprightStep(surface, dir, !this.surfing && this.running(input));
    const move = () => walk3d(p, s.d, s.ticks, s.anim, 'input', s.face);
    // Only the surf branch starts a step (PlayerAvatar_StartStep).
    if (this.surfing) this.started(move);
    else move();
    this.movingDir = s.turn;
  }

  /** Running: B held with the Running Shoes (the DS); with auto-run (OpenSinnoh), the shoes unless B is held. */
  private running(input: InputFrame): boolean {
    return this.h.state.runningShoes && input.held.includes('b') !== this.h.autoRun();
  }

  /** PlayerAvatar_StartStep → EnableTileBehaviorCheck: a new step re-arms the underfoot tile and deep mud. */
  private started(move: () => void): void {
    move();
    this.ignoreTile = false;
    if (this.escapedMud) this.doNotSink = false;
    this.escapedMud = false;
  }

  // ---------- cycling (PlayerAvatar_SetMovement_Bike) ----------

  private bike(dir: Facing | null): void {
    const p = this.p;
    const gear = this.h.state.cyclingGear;
    // Bike state (GetBikeStateThirdGear / GetBikeStateFourthGear).
    let state: 'none' | 'turning' | 'moving' | 'brake';
    if (!dir) state = (gear === 1 ? this.speed >= 2 : this.brake) ? 'brake' : 'none';
    else if (p.facing !== dir && !this.moving) state = gear === 1 && this.speed >= 2 ? 'brake' : 'turning';
    else state = 'moving';
    if (gear === 0 && dir) this.brake = false;
    if (state === 'none') {
      this.moving = false;
      this.speed = 0;
      return;
    }
    if (state === 'turning') {
      this.speed = 0;
      if (!this.wrongBridgeDir(dir!)) this.turn(dir!);
      return;
    }
    this.moving = true;
    if (state === 'brake') return this.bikeBrake();
    const d = dir!;
    const c = this.collision(d);
    if (c & C.JUMP) {
      if (gear === 1) this.accelerate();
      return this.started(() => this.ledge(d));
    }
    if (c & C.JUMP_TWICE) return this.distortionJump(d);
    if (c & C.BIKE_RAMP) {
      if (gear === 0) {
        this.started(() => this.step(d, WALK_SLIGHTLY_FASTER));
        this.forced = true;
        return;
      }
      if (this.speed >= 3) {
        this.started(() => this.step(d, this.speedTicks()));
        this.forced = true;
        return;
      }
      this.speed = 0;
      return this.bump(d);
    }
    if (c & C.BIKE_BRIDGE) return this.faceMoving();
    if (c !== C.NONE) {
      if (this.wrongBridgeDir(d)) return this.faceMoving();
      this.speed = 0;
      return this.bump(d);
    }
    if (gear === 0) {
      this.started(() => this.step(d, WALK_SLIGHTLY_FASTER));
      this.speed = 2;
      return;
    }
    const ticks = this.speedTicks();
    this.accelerate();
    this.started(() => this.step(d, ticks));
  }

  /** PlayerAvatar_GetMovementActionFromSpeed: 0 → 6, 1 → 4, 2 → 3, 3 → 2 frames a tile. */
  private speedTicks(): number {
    return [WALK_SLIGHTLY_FAST, WALK_FAST, WALK_SLIGHTLY_FASTER, WALK_FASTER][this.speed]!;
  }

  private accelerate(): void {
    this.speed = Math.min(3, this.speed + 1);
    if (!this.brake && this.speed >= 2) this.brake = true;
  }

  /** Coasting after the d-pad is released at speed (PlayerAvatar_SetMovement_Bike*GearBrake). */
  private bikeBrake(): void {
    let moving = true;
    this.speed--;
    if (this.speed < 0) {
      this.speed = 0;
      moving = false;
    }
    if (this.brake && this.speed === 0) this.brake = false;
    const dir = this.movingDir;
    const c = this.collision(dir);
    if (c & C.JUMP) this.ledge(dir);
    else if (c & C.JUMP_TWICE) this.distortionJump(dir);
    else if (c & C.BIKE_BRIDGE) this.faceMoving();
    else if (c !== C.NONE) {
      moving = false;
      this.speed = 0;
      this.bump(dir);
    } else this.step(dir, this.speedTicks());
    if (!moving) this.brake = false;
  }

  // ---------- Strength (ov5_021DFF1C, ov5_021DFFBC) ----------

  private tryStrength(dir: Facing): boolean {
    const p = this.p;
    const [dx, dz] = DELTA[dir];
    const boulder = this.h.occupant(p.x + dx, p.z + dz, p);
    if (!boulder || !boulder.sprite || boulder.motion?.kind === 'walk' || boulder.x !== p.x + dx || boulder.z !== p.z + dz) return false;
    if (this.h.reg.sprites.get(boulder.sprite)?.sourceIndex !== BOULDER_GFX) return false;
    // A Distortion World boulder may be pushed into a hole or pit (DistWorld_WillBoulderBeAtFallLocation).
    if ((this.h.objectCollision(boulder, dir) & ~1) !== 0 && !this.h.distortion()?.boulderWillFall(boulder, dir)) return false;
    this.task = { kind: 'strength', dir, boulder, phase: 'wait' };
    return true;
  }

  // ---------- deep mud (FieldSystem_TryGetStuckInDeepMud, FieldTask_StuckInDeepMud) ----------

  private tryStuckInMud(): boolean {
    if (this.escapedMud) return false;
    const here = this.h.behaviour(this.p.x, this.p.z);
    if (!isDeepMud(here) && !isDeepMudWithGrass(here)) return false;
    this.task = { kind: 'mud', count: 0, phase: 'ready' };
    return true;
  }

  // ---------- surfing ----------

  /** ov5_021E032C: surfing toward free land jumps off the blob. */
  private tryDismount(dir: Facing): boolean {
    let c = this.collision(dir);
    if (c === C.WATER) return false;
    c &= ~C.WATER;
    if (c !== C.NONE) return false;
    this.task = { kind: 'dismount', dir, phase: 'start' };
    return true;
  }

  /** FieldHost.surf (FieldTask_StartUseSurf): cut-in, the blob appears on the water, the player jumps on. */
  surf(slot: number): void {
    this.slot(slot);
    if (this.task) throw new Error(`world: surf during ${this.task.kind}`);
    this.h.cutIn(slot);
    this.task = { kind: 'surf', dir: this.p.facing, phase: 'cut-in' };
  }

  /** FieldHost.waterfall (FieldTask_StartUseWaterfall): up or down two tiles in the facing direction. */
  waterfall(slot: number): void {
    this.slot(slot);
    const dir = this.p.facing;
    if (dir !== 'up' && dir !== 'down') throw new Error(`world: waterfall facing ${dir}`);
    this.startWaterfall(dir, true);
    this.h.cutIn(slot);
  }

  /** FieldHost.rockClimb (FieldTask_StartUseRockClimb). */
  rockClimb(slot: number): void {
    this.slot(slot);
    if (this.task) throw new Error(`world: rockClimb during ${this.task.kind}`);
    this.h.cutIn(slot);
    this.task = { kind: 'rockClimb', dir: this.p.facing, phase: 'cut-in' };
  }

  taskDone(kind: 'surf' | 'waterfall' | 'rockClimb'): boolean {
    return this.task?.kind !== kind;
  }

  private slot(slot: number): void {
    if (!this.h.state.party[slot]) throw new Error(`world: no party Pokémon in slot ${slot}`);
  }

  private startWaterfall(dir: 'up' | 'down', cutIn: boolean): void {
    if (this.task) throw new Error(`world: waterfall during ${this.task.kind}`);
    const p = this.p;
    const [, dz] = DELTA[dir];
    const tx = p.x;
    const tz = p.z + 2 * dz;
    const ty = this.h.heightAt(tileCentre(tx), tileCentre(tz), p.y);
    this.task = { kind: 'waterfall', dir, phase: cutIn ? 'cut-in' : 'move', t: 0, from: [...p.cur], to: [tileCentre(tx), ty, tileCentre(tz)], tx, tz };
    if (!cutIn) this.waterfallStart();
  }

  private waterfallStart(): void {
    this.override = [...this.p.cur];
    wait(this.p, WATERFALL_TICKS[0] + WATERFALL_TICKS[1], 'auto');
  }

  // ---------- spin tiles (ov5_021E1154) ----------

  /** After a completed step onto a SLIDE_* tile (Field_ProcessStep, before coord events). */
  startSlide(): boolean {
    if (this.task) return false;
    const dir = SLIDES[this.h.behaviour(this.p.x, this.p.z)];
    if (!dir) return false;
    this.h.sound.play(1624);
    this.task = { kind: 'slide', dir, phase: 'walk', t: 0 };
    return true;
  }

  // ---------- the avatar task, every tick (also while a script waits on it) ----------

  /** Returns whether a task ran: the DS processes no field input on a frame a field task runs. */
  stepTask(input: InputFrame): boolean {
    const t = this.task;
    if (!t) return false;
    this.runTask(t, input);
    return true;
  }

  private runTask(t: Task, input: InputFrame): void {
    const p = this.p;
    switch (t.kind) {
      case 'surf':
        if (t.phase === 'cut-in') {
          if (!this.h.cutInDone()) return;
          const [dx, dz] = DELTA[t.dir];
          this.h.effects.remove(this.mount);
          this.mount = this.h.effects.add(FLDEFF.SURF_MOUNT, 'mount', [tileCentre(p.x + dx), p.y, tileCentre(p.z + dz)], { ticks: null });
          this.h.state.playerState = 'surf';
          this.speed = 0;
          this.hop(t.dir, HOP, 'auto');
          this.elevated = false;
          t.phase = 'jump';
          return;
        }
        if (p.motion) return;
        this.h.effects.setFollow(this.mount, true);
        this.task = null;
        return;
      case 'dismount':
        // ov5_021E03C8: the walking sprite jumps off; the blob stays on the water until the jump ends.
        if (t.phase === 'start') {
          this.h.effects.setFollow(this.mount, false);
          this.hop(t.dir, HOP, 'auto');
          t.phase = 'jump';
          return;
        }
        if (p.motion) return;
        this.h.effects.remove(this.mount);
        this.mount = null;
        this.h.state.playerState = 'walk';
        this.speed = 0;
        this.task = null;
        return;
      case 'waterfall': {
        if (t.phase === 'cut-in') {
          if (!this.h.cutInDone()) return;
          t.phase = 'move';
          t.t = 0;
          this.waterfallStart();
          return;
        }
        t.t++;
        const [fy, fz] = [t.from[1], t.from[2]];
        const dy = (t.to[1] - fy) / 64;
        const dzw = (t.to[2] - fz) / 64;
        const clamp = (v: number, to: number, from: number) => (to >= from ? Math.min(v, to) : Math.max(v, to));
        const o = this.override!;
        // Ascent: 32 frames up, then 64 frames up and forward; descent: 32 frames forward, then 64 down and forward.
        if (t.dir === 'up') {
          o[1] = clamp(o[1] + dy, t.to[1], fy);
          if (t.t > WATERFALL_TICKS[0]) o[2] = clamp(o[2] + dzw, t.to[2], fz);
        } else {
          o[2] = clamp(o[2] + dzw, t.to[2], fz);
          if (t.t > WATERFALL_TICKS[0]) o[1] = clamp(o[1] + dy, t.to[1], fy);
        }
        if (t.t < WATERFALL_TICKS[0] + WATERFALL_TICKS[1]) return;
        p.x = t.tx;
        p.z = t.tz;
        p.y = t.to[1];
        p.motion = null;
        this.override = null;
        this.task = null;
        return;
      }
      case 'rockClimb':
        return this.stepRockClimb(t);
      case 'strength':
        if (t.phase === 'wait') {
          if (t.boulder.motion || p.motion) return;
          this.h.sound.play(1575);
          walk(t.boulder, t.dir, STRENGTH_PUSH_TICKS, 'walk', 'auto');
          onSpot(p, t.dir, STRENGTH_PUSHER_TICKS, 'auto');
          t.phase = 'push';
          return;
        }
        if (t.fall) {
          if (t.fall.next().done) this.task = null;
          return;
        }
        if (t.boulder.motion || p.motion) return;
        // The boulder stops on a fall location: it falls (DistWorldFallingBoulder_New / _Tick) before the task ends.
        t.fall = this.h.distortion()?.boulderFall(t.boulder, t.dir) ?? undefined;
        if (!t.fall) this.task = null;
        return;
      case 'mud': {
        if (t.phase === 'ready') {
          if (p.motion && !(p.motion.kind === 'onspot' && p.motion.ticks === BUMP_TICKS)) return;
          if (t.count >= MUD_WIGGLES) {
            this.escapedMud = true;
            this.task = null;
            return;
          }
          t.phase = 'input';
        }
        const dir = inputDir(input);
        if (!dir || dir === p.facing) return;
        p.motion = null;
        t.phase = 'ready';
        t.count++;
        if (isDeepMudWithGrass(this.h.behaviour(p.x, p.z))) this.h.log.stub('encounter:mud', 'deep-mud-with-grass encounters (WildEncounters_TryMudEncounter) are not rolled');
        if (t.count < MUD_WIGGLES) onSpot(p, dir, TURN_TICKS, 'auto');
        else {
          this.hop(dir, HOP_ON_SPOT, 'auto');
          this.doNotSink = true;
        }
        return;
      }
      case 'dwJump':
        return this.stepDwJump(t);
      case 'slide':
        if (t.phase === 'walk') {
          if (p.motion) return;
          this.forcedStep(t.dir, WALK_NORMAL_TICKS);
          p.motion!.source = 'auto';
          p.facing = t.dir;
          t.phase = 'spin';
          t.t = 7;
          return;
        }
        if (t.t === 6 || t.t === 4 || t.t === 2) {
          t.dir = SPIN[t.dir];
          p.facing = t.dir;
        }
        if (--t.t > 0) return;
        t.dir = SLIDES[this.h.behaviour(p.x, p.z)] ?? SPIN[t.dir];
        if (this.collision(t.dir) === C.NONE) {
          t.phase = 'walk';
          return;
        }
        p.facing = t.dir;
        this.movingDir = t.dir;
        this.h.sound.stop(1624);
        this.task = null;
        return;
    }
  }

  /**
   * JumpOnFloatingPlatform, from its first run on the frame the jump point took the input: the next frame turns
   * the player (and starts the sprite's turn) and moves them `displacement` over `steps` frames, the sprite
   * arcing on the jump's axis; the frame after the last move lands them (support, surface, final facing) and
   * ends the task, so input returns the frame after.
   */
  private stepDwJump(t: Extract<Task, { kind: 'dwJump' }>): void {
    const p = this.p;
    const dw = this.h.distortion();
    if (!dw) throw new Error('world: a Distortion World jump outside the Distortion World');
    const j = t.jump;
    if (t.phase === 'dir') {
      const facing = dw.jumpStart(j);
      const m = walk3d(p, [j.displacement.x, j.displacement.y, j.displacement.z], j.steps, 'walk', 'auto', facing);
      m.anim = 'stand';
      m.jump = true;
      m.jumpRate = Math.floor(0x1000 / j.steps);
      m.jumpAxis = j.axis;
      m.jumpInverted = j.inverted;
      t.phase = 'move';
      return;
    }
    if (p.motion) return;
    dw.land(j);
    if (!p.dirLocked) p.facing = j.finalFacing;
    this.speed = 0;
    this.task = null;
  }

  private stepRockClimb(t: Extract<Task, { kind: 'rockClimb' }>): void {
    const p = this.p;
    switch (t.phase) {
      case 'cut-in': {
        if (!this.h.cutInDone()) return;
        const [dx, dz] = DELTA[t.dir];
        this.mount = this.h.effects.add(FLDEFF.ROCK_CLIMB_MOUNT, 'mount', [tileCentre(p.x + dx), p.y, tileCentre(p.z + dz)], { ticks: null });
        this.hop(t.dir, HOP, 'auto');
        t.phase = 'hop-on';
        return;
      }
      case 'hop-on':
        if (p.motion) return;
        this.h.effects.setFollow(this.mount, true);
        this.step(t.dir, WALK_FAST, 'walk', 'auto', false);
        t.phase = 'move';
        return;
      case 'move': {
        if (p.motion) return;
        const [dx, dz] = DELTA[this.movingDir];
        if (canRockClimb(this.h.behaviour(p.x + dx, p.z + dz), this.movingDir)) {
          this.step(t.dir, WALK_FAST, 'walk', 'auto', false);
          return;
        }
        this.h.effects.setFollow(this.mount, false);
        this.hop(t.dir, HOP, 'auto');
        t.phase = 'hop-off';
        return;
      }
      case 'hop-off':
        if (p.motion) return;
        this.h.effects.remove(this.mount);
        this.mount = null;
        this.task = null;
        return;
    }
  }

  // ---------- step hooks: the bridge layer and the terrain effects (map_object_move.c) ----------

  /**
   * Called each tick after movements start: a player step that began this tick updates the bridge layer
   * and leaves tracks, splashes and mud on the tile it left (sub_0206363C / sub_020636F0).
   */
  observeStepStart(): void {
    const p = this.p;
    const m = p.motion;
    if (!m || m.kind !== 'walk' || m.elapsed !== 0 || m === this.lastStep) return;
    if (m.fromX === p.x && m.fromZ === p.z) return;
    this.lastStep = m;
    const to = this.h.behaviour(p.x, p.z);
    // MapObject_DetermineElevatedBridgeStatus.
    if (isBridgeStart(to)) this.elevated = true;
    else if (this.elevated && !isBridge(to)) this.elevated = false;
    const from = this.h.behaviour(m.fromX, m.fromZ);
    const at: Vec3 = [tileCentre(m.fromX), p.y, tileCentre(m.fromZ)];
    if (!m.jump) this.tracks(from, at);
    if (!m.jump && isPuddle(from)) this.h.effects.add(FLDEFF.SPLASH, 'splash', at);
    if (!m.jump && isMud(from)) this.h.effects.add(FLDEFF.MUD, 'mud', at);
    this.rippleCheck(to);
  }

  /** A completed player step (sub_0206375C): splashes and mud on the new tile, the shallow-water ripple. */
  stepEnded(): void {
    const p = this.p;
    const here = this.h.behaviour(p.x, p.z);
    const at: Vec3 = [tileCentre(p.x), p.y, tileCentre(p.z)];
    if (isPuddle(here)) this.h.effects.add(FLDEFF.SPLASH, 'splash', at);
    if (isMud(here)) this.h.effects.add(FLDEFF.MUD, 'mud', at);
    this.rippleCheck(here);
  }

  /**
   * sub_02063994: tracks on the tile left. The player's track type is feet (1) walking and bike tyres (2)
   * cycling; the surf avatar leaves none.
   */
  private tracks(from: string, at: Vec3): void {
    if (this.surfing) return;
    const bike = this.cycling;
    const facing = this.p.facing;
    const add = (anim: string) => void this.h.effects.add(FLDEFF.TRACKS, anim, at, { facing, ticks: TRACK_TICKS });
    if (isSnowWithShadows(from) && !bike) add('snow-shadow');
    if (onSand(from, this.elevated)) return add(bike ? 'bike-tracks' : 'footprints');
    if (from === 'SNOW_DEEP' || from === 'SNOW_DEEPER' || from === 'SNOW_DEEPEST') return add('snow-deep');
    if (onShallowSnow(from, this.elevated)) add('snow-shallow');
  }

  /** sub_02063A30: one looping ripple while the player stands in shallow water. */
  private rippleCheck(here: string): void {
    if (isShallowWater(here)) {
      if (!this.h.effects.has(this.ripple)) this.ripple = this.h.effects.add(FLDEFF.RIPPLE, 'ripple', this.p.cur, { follow: true, ticks: null });
    } else {
      this.h.effects.remove(this.ripple);
      this.ripple = null;
    }
  }

  // ---------- A-press field moves (Field_TileBehaviorToScript) ----------

  /**
   * The `FIELD_MOVES` script for the facing tile, if its behaviour carries one and the DS would start it:
   * a waterfall always, Rock Climb along its axis, Surf when not surfing, not from an elevated bridge,
   * with the Fen Badge and a party Pokémon that knows the move.
   */
  fieldMoveScript(fx: number, fz: number, behaviour?: string): Id | null {
    const p = this.p;
    const b = behaviour ?? this.h.behaviour(fx, fz);
    const fm = this.behaviourRecord(b)?.fieldMove;
    if (!fm) return null;
    if (isWaterfall(b)) return fm.label;
    if (canRockClimb(b, p.facing)) return fm.label;
    if (!isSurfable(b) || this.surfing) return null;
    const here = this.h.behaviour(p.x, p.z);
    if ((isBridge(here) || isBridgeStart(here)) && this.elevated) return null;
    const ns = fm.move.slice(0, fm.move.indexOf(':'));
    if (!this.h.state.badges.includes(`${ns}:BADGE_ID_FEN` as Id)) return null;
    return this.h.state.party.some((m) => m.moves?.includes(fm.move)) ? fm.label : null;
  }
}
