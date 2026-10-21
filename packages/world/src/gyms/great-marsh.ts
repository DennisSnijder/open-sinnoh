import type { FeatureModelView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { slotOf, type FeatureHost, type MapFeature } from './feature.ts';

/**
 * The Great Marsh's quick tram (decomp src/overlay006/great_marsh_tram.c). The saved station (`MapFeatures`
 * great-marsh `tram`) places the tram prop (great_marsh_train) at x 1056, y 16 and the station's z (world units).
 * `move` changes the station at once and runs MoveTram: the prop's clip plays, a ride waits for SEQ_SE_DP_TRAIN04,
 * then the tram moves. Called, it brakes in speed levels once near the station (CallTramToPlayer); ridden, it stays
 * half a tile ahead of the invisible player, who walks faster and faster, then slower near the station
 * (RideTramToArea).
 */

/** GreatMarshTram_DynamicMapFeaturesInit: the tram's x and y. */
const TRAM_X = 1056;
const TRAM_Y = 16;
/** TRAM_POSITION_AREA_1_2 / _3_4 / _5_6 (16 · tile). */
const TRAM_Z = [16 * (32 + 8), 16 * (64 + 18), 16 * (96 + 12)] as const;
/** TRAM_AREA_*_SLOW_DOWN_POINT (tiles). */
const SLOW = { area12: 32 + 14, area34North: 64 + 10, area34South: 64 + 24, area56: 96 + 4 } as const;
/** sRidingTramNorthMovements / sRidingTramSouthMovements, by speed level. */
const RIDE_SPEEDS = ['slower', 'slow', 'normal', 'normal', 'fast', 'fast', 'faster'] as const;
/** sCalledTramFramesPerSpeedLevel and sCalledTramSpeeds (world units a frame). */
const CALL_FRAMES = [2, 4, 4, 8, 8, 16, 32] as const;
const CALL_SPEEDS = [8, 4, 4, 2, 2, 1, 0.5] as const;
/** SEQ_SE_DP_TRAIN02 (speeding up), TRAIN03 (braking), TRAIN04 (departing a ride). */
const SE_TRAIN02 = 1753;
const SE_TRAIN03 = 1754;
const SE_TRAIN04 = 1755;

interface Task {
  movement: 'call' | 'ride';
  south: boolean;
  dest: number;
  slowDown: number;
  state: number;
  speed: number;
  frames: number;
}

export class GreatMarshTram implements MapFeature {
  private z: number;
  private prevZ: number;
  private task: Task | null = null;
  /** The prop's clip tick while it plays (MoveTram states 0–3), null otherwise. */
  private clip: number | null = null;

  constructor(
    private readonly h: FeatureHost,
    private readonly prop: Id | null,
  ) {
    this.z = this.prevZ = TRAM_Z[slotOf(h.state, 'great-marsh').tram]!;
  }

  /** GreatMarshTram_MoveToLocation. */
  move(destination: number, movement: 'call' | 'ride'): void {
    if (this.task) throw new Error('great marsh tram: already moving');
    const slot = slotOf(this.h.state, 'great-marsh');
    let south: boolean;
    let to: number;
    let slowDown: number;
    if (slot.tram === 0) {
      south = true;
      [to, slowDown] = destination === 1 ? [1, SLOW.area34North] : [2, SLOW.area56];
    } else if (slot.tram === 1) {
      [south, to, slowDown] = destination === 0 ? [false, 0, SLOW.area12] : [true, 2, SLOW.area56];
    } else {
      south = false;
      [to, slowDown] = destination === 0 ? [0, SLOW.area12] : [1, SLOW.area34South];
    }
    slot.tram = to;
    this.task = { movement, south, dest: TRAM_Z[to]!, slowDown, state: 0, speed: 0, frames: 0 };
  }

  done(): boolean {
    return this.task === null;
  }

  step(): void {
    this.prevZ = this.z;
    const t = this.task;
    if (!t) return;
    switch (t.state) {
      case 0:
        this.clip = 0;
        t.state = 1;
        return;
      case 1:
        if (t.movement === 'ride') this.h.sound.play(SE_TRAIN04);
        t.state = 2;
      // falls through
      case 2:
        if (!this.h.sound.playing(SE_TRAIN04)) t.state = 3;
        break;
      case 3:
        if (t.movement === 'call' ? this.call(t) : this.ride(t)) t.state = 4;
        break;
      case 4:
        this.clip = null;
        t.state = 5;
        return;
      case 5:
        this.task = null;
        return;
    }
    if (this.clip !== null) this.clip++;
  }

  /** CallTramToPlayer: full speed, braking a level every few frames once past the slow-down point. */
  private call(t: Task): boolean {
    this.z += t.south ? CALL_SPEEDS[t.speed]! : -CALL_SPEEDS[t.speed]!;
    const tile = Math.trunc((this.z - 8) / 16);
    if (t.speed < CALL_FRAMES.length - 1 && (t.south ? tile >= t.slowDown : tile <= t.slowDown) && ++t.frames >= CALL_FRAMES[t.speed]!) {
      if (t.speed === 0) this.h.sound.play(SE_TRAIN03);
      t.speed++;
      t.frames = 0;
    }
    return this.z === t.dest;
  }

  /** RideTramToArea: the tram half a tile ahead of the player; each new step at the speed level, up before the slow-down point and down after it. */
  private ride(t: Task): boolean {
    const p = this.h.hero();
    this.z = p.cur[2] + 8;
    if (this.z === t.dest) return true;
    if (p.script) return false;
    const before = t.south ? p.z < t.slowDown : p.z > t.slowDown;
    this.h.applySteps(p, [{ op: `walk_${RIDE_SPEEDS[t.speed]}_${t.south ? 'south' : 'north'}`, count: 1 }]);
    if (t.speed < RIDE_SPEEDS.length - 1 && before) {
      if (t.speed === 0) this.h.sound.play(SE_TRAIN02);
      t.speed++;
    } else if (!before && t.speed !== 0) {
      if (t.speed === RIDE_SPEEDS.length - 1) this.h.sound.play(SE_TRAIN03);
      t.speed--;
    }
    return false;
  }

  /** The clip's length (MapPropOneShotAnimationManager_LoadPropAnimations with loop count 255: it repeats). */
  private clipTicks(): number {
    const ticks = this.h.reg.props.get(this.prop!)?.animations?.['tram']?.ticks;
    if (!ticks) throw new Error(`great marsh tram: prop ${this.prop} has no tram clip`);
    return ticks;
  }

  busy(): boolean {
    return false;
  }

  view(): ReturnType<MapFeature['view']> {
    if (!this.prop) return { effects: [], features: null };
    const model: FeatureModelView = {
      key: 'great-marsh-tram',
      prop: this.prop,
      position: [TRAM_X, TRAM_Y, this.z],
      prev: [TRAM_X, TRAM_Y, this.prevZ],
      rotation: [0, 0, 0],
      ...(this.clip !== null ? { clip: { name: 'tram', tick: this.clip % this.clipTicks() } } : {}),
    };
    return { effects: [], features: { models: [model] } };
  }
}
