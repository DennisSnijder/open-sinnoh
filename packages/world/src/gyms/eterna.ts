import type { EffectView, EternaGymTables, Facing, FeatureModelView } from '@opensinnoh/contracts';
import { OPPOSITE, WALK_NORMAL_TICKS } from '../movement.ts';
import { walk, type Actor } from '../npc.ts';
import { TILE, tileCentre } from '../tiles.ts';
import { FEATURE_EFFECT_KEYS, gymTables, slotOf, type FeatureHost, type MapFeature } from './feature.ts';

/**
 * Eterna Gym's flower clock (decomp src/overlay008/gym_features.c EternaGym_*; docs/research/gym-puzzles.md).
 * The clock state (`MapFeatures` eterna-gym `clock`, 0–4) picks the clock time, an authored collision mask
 * over the 13×13 clock and the fountain row, and an hour-hand jump tile. Each won trainer advances it
 * (`advance_eterna_gym_clock`): a camera object walks to the clock's centre, the hands turn two clock
 * minutes a tick, then after trainers two and three the camera shows the fountain that drains and the
 * script's message is printed, before the camera walks back. The tables come from the ROM (`NewGame.gyms`).
 */

/** ETERNA_CLOCK_* bounds and centre (tiles). */
const CLOCK = { left: 5, top: 7, size: 13, centerX: 11, centerZ: 13 };
const FOUNTAIN_Z = 19;
const FOUNTAIN_LEFT_X = 2;
const FOUNTAIN_RIGHT_X = 20;
/** ETERNA_GYM_WIDTH: the fountain row's mask covers x 1–21. */
const GYM_WIDTH = 21;
const STATE_DEFEATED_SECOND = 2;
const STATE_DEFEATED_THIRD = 3;
const STATE_LEADER = 4;
/** fx32 one, and two clock minutes per tick (EternaGym_UpdateClockHandTimes: FX32_CONST(2)). */
const FX = 4096;
const STEP_MINUTES = 2 * FX;
/** A turn is 0x10000 (sEternaGymRotationForHour's units). */
const TURN = 0x10000;
/** DEG_TO_IDX(6) + 1: a minute's angle; F32_DEG_TO_IDX(90) and (180) are the hands' zero offsets. */
const MINUTE_ANGLE = Math.trunc((6 * 0xffff) / 360) + 1;
const QUARTER = 0x4000;
const HALF = 0x8000;
/** sEternaGymClockHandsCenter: the hands' heights (fx32 12 and 13 world units). */
const HOUR_HAND_Y = 12;
const MINUTE_HAND_Y = 13;
/** ov5_021F4098: four fountain tiles each side, on row 19 from x 1 and x 18. */
const FOUNTAIN_TILES = { left: 1, right: 18, count: 4 };
/** The camera's waits (FieldTask_EternaGym_AdvanceClockState): before and after the hands turn, before the fountain drains, while it drains. */
const WAIT_TICKS = { beforeTurn: 8, afterTurn: 8, beforeDrain: 4, drain: 60 };

/** The clock task's phase as the script sees it (the VM prints the fountain message and continues it). */
export type EternaClockTask = 'running' | 'message' | 'done';

/** The camera walk of EternaGymCameraManager: one axis first, then the other, one WALK_NORMAL a tile. */
interface CameraWalk {
  startX: number;
  startZ: number;
  destX: number;
  destZ: number;
  dirX: Facing;
  dirZ: Facing;
  moveXFirst: boolean;
}

interface Fountain {
  side: 'left' | 'right';
  draining: boolean;
  tick: number;
}

/** C's `%` (truncates toward zero), as the decomp's angle sums use it. */
const cmod = (a: number, b: number) => a % b;

export class EternaGym implements MapFeature {
  private readonly t: EternaGymTables;
  private fxHour = 0;
  private fxMinute = 0;
  private rotateHourHand = false;
  /** The hands' prop y rotation (0x10000 a turn). */
  private hourAngle = 0;
  private minuteAngle = 0;
  private fountains: Fountain[] = [];
  private task: {
    state: number;
    delay: number;
    hourDest: number;
    minuteDest: number;
    camera: CameraWalk;
    cameraObj: Actor | null;
    continued: boolean;
  } | null = null;

  constructor(private readonly h: FeatureHost) {
    this.t = gymTables(h.reg).eterna;
    const slot = slotOf(h.state, 'eterna-gym');
    // EternaGym_DynamicMapFeaturesInit: the saved var, not the slot's cleared zero, rebuilds the clock.
    slot.clock = h.varValue(this.t.clockVar);
    const time = this.time(slot.clock);
    this.fxHour = time.hour * FX;
    this.fxMinute = time.minute * FX;
    this.updateHands();
    // ov5_021F4098(fieldSystem, {2, 2, 0}[state]): both fountains, then the left one only.
    if (slot.clock < STATE_DEFEATED_THIRD) {
      this.fountains.push({ side: 'left', draining: false, tick: 0 });
      if (slot.clock < STATE_DEFEATED_SECOND) this.fountains.push({ side: 'right', draining: false, tick: 0 });
    }
  }

  private get clock(): number {
    return slotOf(this.h.state, 'eterna-gym').clock;
  }

  private time(state: number): { hour: number; minute: number } {
    const time = this.t.times[state];
    if (!time) throw new Error(`world: Eterna Gym clock state ${state} has no time`);
    return time;
  }

  /** EternaGym_DynamicMapFeaturesCheckCollision: the clock's mask, then the fountain row's. */
  blocks(x: number, z: number): boolean {
    const s = this.clock;
    if (z >= CLOCK.top && z < CLOCK.top + CLOCK.size && x >= CLOCK.left && x < CLOCK.left + CLOCK.size) {
      if (this.t.clock[s]![(z - CLOCK.top) * CLOCK.size + (x - CLOCK.left)] === 1) return true;
    }
    return z === FOUNTAIN_Z && x >= 1 && x <= GYM_WIDTH && this.t.fountains[s]![x - 1] === 1;
  }

  /** EternaGym_IsHourHandJumpTile, only in the gym's own zone (DynamicMapFeatures_WillPlayerJumpEternaGymClock). */
  jumps(x: number, z: number, dir: Facing): boolean {
    if (this.h.zone().id !== this.t.zone) return false;
    const j = this.t.jumps[this.clock];
    if (!j || j.x !== x || j.z !== z) return false;
    return j.northSouth ? dir === 'up' || dir === 'down' : dir === 'left' || dir === 'right';
  }

  /** EternaGym_UpdateClockHandPositions → EternaGym_UpdateHandPropRotation. */
  private updateHands(): void {
    const minute = Math.trunc(this.fxMinute / FX);
    let m = minute % 15 === 0 ? this.t.hourRotations[minute / 5]! : minute * MINUTE_ANGLE;
    m = cmod(m - QUARTER, TURN);
    this.minuteAngle = cmod(TURN - m, TURN);
    const hour = Math.trunc(this.fxHour / FX);
    let hr = this.t.hourRotations[hour]!;
    if (this.rotateHourHand) hr += Math.trunc((5 * MINUTE_ANGLE) / 60) * minute;
    hr = cmod(hr + HALF, TURN);
    this.hourAngle = cmod(TURN - hr, TURN);
  }

  /** EternaGym_IncrementClockTime. */
  private increment(step: number): void {
    this.fxMinute += step;
    while (this.fxMinute >= 60 * FX) {
      this.fxMinute -= 60 * FX;
      this.fxHour += FX;
    }
    this.fxHour %= 12 * FX;
  }

  /** EternaGym_UpdateClockHandTimes: two minutes, landing exactly on the destination minute; true when there. */
  private turnHands(hourDest: number, minuteDest: number): boolean {
    const oldHour = this.fxHour;
    const oldMinute = this.fxMinute;
    if (oldHour !== hourDest || oldMinute !== minuteDest) {
      this.increment(STEP_MINUTES);
      let newMinute = this.fxMinute;
      if (this.fxHour === hourDest) {
        if (oldMinute > newMinute) {
          if (oldMinute < minuteDest + 60 * FX && newMinute + 60 * FX > minuteDest + 60 * FX) newMinute = minuteDest;
        } else if (oldMinute < minuteDest && newMinute > minuteDest) newMinute = minuteDest;
      }
      this.fxMinute = newMinute;
    }
    return this.fxHour === hourDest && this.fxMinute === minuteDest;
  }

  /**
   * EternaGym_AdvanceClockState: at the leader state nothing happens (false); otherwise the slot and the var
   * advance at once and the clock task starts.
   */
  advance(): boolean {
    const slot = slotOf(this.h.state, 'eterna-gym');
    if (this.task) throw new Error('world: advance_eterna_gym_clock while the clock task runs');
    if (slot.clock >= STATE_LEADER) return false;
    slot.clock++;
    this.h.setVar(this.t.clockVar, slot.clock);
    const time = this.time(slot.clock);
    const p = this.h.hero();
    this.task = {
      state: 0,
      delay: 0,
      hourDest: time.hour * FX,
      minuteDest: time.minute * FX,
      camera: this.cameraWalk(p.x, p.z, CLOCK.centerX, CLOCK.centerZ, false),
      cameraObj: null,
      continued: false,
    };
    return true;
  }

  /** EternaGym_SetupCameraMove*: directions toward the destination; x first when it is the shorter leg. */
  private cameraWalk(startX: number, startZ: number, destX: number, destZ: number, moveXFirst: boolean): CameraWalk {
    return {
      startX,
      startZ,
      destX,
      destZ,
      dirX: destX - startX < 0 ? 'left' : 'right',
      dirZ: destZ - startZ < 0 ? 'up' : 'down',
      moveXFirst: moveXFirst || Math.abs(destX - startX) < Math.abs(destZ - startZ),
    };
  }

  /** EternaGym_MoveCamera: when the camera object is free, one WALK_NORMAL toward the destination; true there. */
  private moveCamera(): boolean {
    const cam = this.task!.cameraObj!;
    const w = this.task!.camera;
    if (cam.motion) return false;
    if (cam.x === w.destX && cam.z === w.destZ) return true;
    const along = (axis: 'x' | 'z') => (axis === 'x' ? (cam.x !== w.destX ? w.dirX : null) : cam.z !== w.destZ ? w.dirZ : null);
    const dir = w.moveXFirst ? (along('x') ?? along('z')) : (along('z') ?? along('x'));
    if (dir) walk(cam, dir, WALK_NORMAL_TICKS, 'walk', 'auto');
    return false;
  }

  /** The clock task's phase for the script (`advance_eterna_gym_clock` waits on it). */
  taskPhase(): EternaClockTask {
    if (!this.task) return 'done';
    return this.task.state === 11 || this.task.state === 12 ? 'message' : 'running';
  }

  /** The fountain message was printed and A or B pressed (the task's states 11–12). */
  continueTask(): void {
    if (this.taskPhase() !== 'message') throw new Error('world: the Eterna Gym clock is not waiting on its message');
    this.task!.continued = true;
  }

  busy(): boolean {
    return this.task !== null;
  }

  /** FieldTask_EternaGym_AdvanceClockState, one frame (cases fall through as in the decomp). */
  step(): void {
    for (const f of this.fountains) f.tick++;
    // A drained fountain's animation manager finishes at its clip's end (ov5_021F4240).
    this.fountains = this.fountains.filter((f) => !f.draining || f.tick < this.drainTicks());
    const k = this.task;
    if (!k) return;
    const clock = this.clock;
    switch (k.state) {
      case 0: {
        const p = this.h.hero();
        k.camera = this.cameraWalk(p.x, p.z, CLOCK.centerX, CLOCK.centerZ, false);
        k.cameraObj = this.h.trackCamera(p.x, p.z);
        k.state = 1;
      }
      // falls through
      case 1:
        if (this.moveCamera()) k.state = 2;
        return;
      case 2:
        if (++k.delay < WAIT_TICKS.beforeTurn) return;
        k.delay = 0;
        this.h.sound.play(1355);
        k.state = 3;
      // falls through
      case 3: {
        if (clock === STATE_LEADER && this.fxHour === k.hourDest && this.fxMinute > k.minuteDest) this.fxHour = 11 * FX;
        const finished = this.turnHands(k.hourDest, k.minuteDest);
        // The leader's turn keeps the hour hand on its hour (it only turns the minute hand round).
        if (clock === STATE_LEADER) this.fxHour = this.time(clock).hour * FX;
        if (this.fxHour === k.hourDest) {
          if (this.fxMinute <= k.minuteDest || clock === STATE_LEADER) this.rotateHourHand = false;
        } else this.rotateHourHand = true;
        this.updateHands();
        if (finished) {
          this.h.sound.stop(1355);
          this.h.sound.play(1507);
          k.state = 4;
        }
        return;
      }
      case 4:
        if (++k.delay < WAIT_TICKS.afterTurn) return;
        k.delay = 0;
        if (clock === STATE_DEFEATED_SECOND || clock === STATE_DEFEATED_THIRD) {
          const w = k.camera;
          k.camera = { ...w, moveXFirst: false, destX: CLOCK.centerX, destZ: FOUNTAIN_Z, dirX: 'left', dirZ: 'down' };
          k.state = 7;
        } else {
          const w = k.camera;
          k.camera = { ...w, moveXFirst: !w.moveXFirst, destX: w.startX, destZ: w.startZ, dirX: OPPOSITE[w.dirX], dirZ: OPPOSITE[w.dirZ] };
          k.state = 5;
        }
        return;
      case 5:
        if (this.moveCamera()) k.state = 6;
        return;
      case 6:
        this.h.releaseCamera();
        this.task = null;
        return;
      case 7: {
        if (!this.moveCamera()) return;
        const right = clock !== STATE_DEFEATED_THIRD;
        k.camera = { ...k.camera, moveXFirst: true, destX: right ? FOUNTAIN_RIGHT_X : FOUNTAIN_LEFT_X, destZ: FOUNTAIN_Z, dirX: right ? 'right' : 'left', dirZ: 'down' };
        k.state = 8;
      }
      // falls through
      case 8:
        if (this.moveCamera()) k.state = 9;
        return;
      case 9:
        if (++k.delay < WAIT_TICKS.beforeDrain) return;
        k.delay = 0;
        // ov5_021F416C: after trainer two the right fountain drains, after trainer three the left.
        this.drain(clock === STATE_DEFEATED_SECOND ? 'right' : 'left');
        this.h.sound.play(1593);
        k.state = 10;
        return;
      case 10:
        if (++k.delay < WAIT_TICKS.drain) return;
        this.h.sound.stop(1593);
        k.delay = 0;
        k.state = 11;
        return;
      case 11:
      case 12: {
        if (!k.continued) return;
        k.continued = false;
        // EternaGym_SetupCameraMoveFromLastPosition: from the fountain back to the player; the x-first choice only turns on.
        const cam = k.camera;
        const p = this.h.hero();
        const back = this.cameraWalk(cam.destX, cam.destZ, p.x, p.z, cam.moveXFirst);
        k.camera = back;
        k.state = 5;
        return;
      }
      default:
        throw new Error(`world: Eterna Gym clock task in state ${k.state}`);
    }
  }

  private drain(side: 'left' | 'right'): void {
    const f = this.fountains.find((x) => x.side === side);
    if (!f) throw new Error(`world: the ${side} Eterna Gym fountain is already gone`);
    f.draining = true;
    f.tick = 0;
  }

  private fountainClip(use: 'loop' | 'drain'): number {
    if (!this.t.fountain) return 1;
    const id = this.t.fountain[use];
    const clip = this.h.reg.fieldEffects.get(id)?.animations?.[use];
    if (!clip) throw new Error(`world: fountain effect ${id} has no '${use}' animation`);
    return clip.ticks;
  }

  private drainTicks(): number {
    return this.fountainClip('drain');
  }

  view(): ReturnType<MapFeature['view']> {
    const models: FeatureModelView[] = [];
    if (this.t.hands) {
      const x = tileCentre(CLOCK.centerX);
      const z = tileCentre(CLOCK.centerZ);
      const deg = (a: number) => (a * 360) / TURN;
      models.push({ key: 'eterna-hour-hand', prop: this.t.hands.hour, position: [x, HOUR_HAND_Y, z], rotation: [0, deg(this.hourAngle), 0] });
      models.push({ key: 'eterna-minute-hand', prop: this.t.hands.minute, position: [x, MINUTE_HAND_Y, z], rotation: [0, deg(this.minuteAngle), 0] });
    }
    const effects: EffectView[] = [];
    if (this.t.fountain) {
      const loop = this.fountainClip('loop');
      for (const f of this.fountains) {
        const x0 = f.side === 'left' ? FOUNTAIN_TILES.left : FOUNTAIN_TILES.right;
        for (let i = 0; i < FOUNTAIN_TILES.count; i++) {
          const wx = (x0 + i) * TILE + TILE / 2;
          const wz = FOUNTAIN_Z * TILE + TILE / 2;
          const at: [number, number, number] = [wx, this.h.heightAt(wx, wz, 0), wz];
          const key = FEATURE_EFFECT_KEYS + (f.draining ? 2 * FOUNTAIN_TILES.count : 0) + (f.side === 'left' ? 0 : FOUNTAIN_TILES.count) + i;
          effects.push({ key, effect: this.t.fountain[f.draining ? 'drain' : 'loop'], cur: at, prev: at, anim: f.draining ? 'drain' : 'loop', tick: f.draining ? f.tick : f.tick % loop });
        }
      }
    }
    return { effects, features: { models } };
  }

  /** Test probe: the hands' prop angles (0x10000 a turn) and the clock time (hour, minute). */
  hands(): { hourAngle: number; minuteAngle: number; hour: number; minute: number } {
    return { hourAngle: this.hourAngle, minuteAngle: this.minuteAngle, hour: this.fxHour / FX, minute: this.fxMinute / FX };
  }
}
