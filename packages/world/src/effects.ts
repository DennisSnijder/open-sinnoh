import type { Id } from '@opensinnoh/core';
import type { EffectView, Facing, Registries, StubLog, Vec3 } from '@opensinnoh/contracts';

/**
 * Field effect renderers the terrain spawns (decomp FIELD_EFFECT_RENDERER_* index = `FieldEffect.sourceIndex`;
 * src/overlay005/field_effect_renderer.c sFieldEffectRendererHandlers).
 */
export const FLDEFF = {
  /** Footprints and bike tracks in sand and snow (ov5_021F1CC8). */
  TRACKS: 0x0b,
  SURF_MOUNT: 0x0f,
  /** The Rock Climb mount (ov5_021F2850). */
  ROCK_CLIMB_MOUNT: 0x10,
  /** Puddle splash (ov5_021F2A7C): plays its clip once. */
  SPLASH: 0x11,
  /** Mud splatter (ov5_021F2BD0): plays its clip once. */
  MUD: 0x12,
  /** Tall grass (ov5_021F2D20): rustles 12 frames, then holds its last frame while the object stands in it. */
  TALL_GRASS: 0x13,
  /** Ripple while standing in shallow water (ov5_021F3284): loops 12 frames until the object leaves. */
  RIPPLE: 0x15,
  /** Very tall grass (ov5_021F37A8): as tall grass. */
  VERY_TALL_GRASS: 0x18,
  /** Grass over mud (ov5_021F3A50): rustles 2 frames, then holds. */
  MUD_GRASS: 0x19,
} as const;

/**
 * The grass effect a map object's step hook spawns on its tile (map_object_move.c), or null. `place`: the
 * object is put on the tile (spawn, set position; sub_020635AC), the grass shows settled. `walk`: a walk
 * into the tile starts (sub_0206363C), the grass rustles; walking, running and cycling alike. `land`: a
 * jump lands (sub_020637D4), only tall grass rustles. A jump's start spawns none.
 */
export function grassRenderer(behaviour: string, hook: 'place' | 'walk' | 'land'): number | null {
  if (behaviour === 'TALL_GRASS') return FLDEFF.TALL_GRASS;
  if (hook === 'land') return null;
  if (behaviour === 'VERY_TALL_GRASS') return FLDEFF.VERY_TALL_GRASS;
  if (behaviour === 'MUD_WITH_GRASS' || behaviour === 'MUD_DEEP_WITH_GRASS') return FLDEFF.MUD_GRASS;
  return null;
}

/** The object a held tile effect belongs to (a world actor). */
export interface Occupant {
  x: number;
  z: number;
}

/** Tracks stay 16 frames, then fade out by 2 of 31 alpha per frame (ov5_021F1FE4): 32 frames. */
export const TRACK_TICKS = 32;

interface Live {
  key: number;
  effect: Id;
  renderer: number;
  anim: string;
  tick: number;
  /** null = until removed (mounts, ripples). */
  ticks: number | null;
  cur: Vec3;
  prev: Vec3;
  facing?: Facing;
  /** Follows the player (the surf blob with its sync on, the Rock Climb mount, a ripple). */
  follow: boolean;
  /** Held on a tile by the object standing on it (grass): ends once its clip has played and the object has left the tile, or when the object is gone. */
  held?: { who: Occupant; x: number; z: number; clip: number };
}

const AXIS: Record<Facing, string> = { up: 'VERTICAL', down: 'VERTICAL', left: 'HORIZONTAL', right: 'HORIZONTAL' };

/**
 * A renderer with one record per drawn model (the Platinum import splits FIELD_EFFECT_RENDERER_0B into
 * FOOTPRINT_<SAND|SNOW>_<DIR> and TRACK_<SAND|SNOW>_<AXIS>) picks its record by use and facing.
 * Bike tracks and snow trenches take the axis of the facing (the DS's diagonal corners are not drawn).
 */
function recordName(anim: string, facing: Facing | undefined): string | undefined {
  const dir = (facing ?? 'down').toUpperCase();
  const axis = AXIS[facing ?? 'down'];
  return { footprints: `FOOTPRINT_SAND_${dir}`, 'bike-tracks': `TRACK_SAND_${axis}`, 'snow-shallow': `FOOTPRINT_SNOW_${dir}`, 'snow-shadow': `FOOTPRINT_SNOW_${dir}`, 'snow-deep': `TRACK_SNOW_${axis}` }[anim];
}

/** The live field effects of the current map (not saved; a map load clears them). */
export class Effects {
  private live: Live[] = [];
  private nextKey = 1;
  private readonly byIndex = new Map<number, { id: Id; name: string }[]>();

  constructor(
    private readonly reg: Registries,
    private readonly log: StubLog,
  ) {
    for (const e of reg.fieldEffects.values()) if (e.sourceIndex !== undefined) this.byIndex.set(e.sourceIndex, [...(this.byIndex.get(e.sourceIndex) ?? []), { id: e.id, name: e.name }]);
  }

  /**
   * Starts an effect at a position. A pack without that renderer's `fieldEffects` record logs a stub and
   * spawns nothing. Effects that play a clip once take its length from the record's `animations[anim]`.
   * A `held` effect stays while `who` is on tile x/z (see `Live.held`); `settled` starts it on its clip's
   * last frame (the DS user int 0: the object was placed there, not walked in).
   */
  add(renderer: number, anim: string, at: Vec3, opts: { facing?: Facing; follow?: boolean; ticks?: number | null; held?: { who: Occupant; x: number; z: number; settled: boolean } } = {}): number | null {
    const records = this.byIndex.get(renderer) ?? [];
    const effect = records.length > 1 ? records.find((r) => r.name === recordName(anim, opts.facing))?.id : records[0]?.id;
    if (records.length > 1 && !effect) throw new Error(`world: no fieldEffects record of renderer 0x${renderer.toString(16)} for ${anim} facing ${opts.facing}`);
    if (!effect) {
      this.log.stub(`fldeff:0x${renderer.toString(16)}`, `no fieldEffects record for renderer 0x${renderer.toString(16)} (${anim})`);
      return null;
    }
    let ticks = opts.ticks;
    let tick = 0;
    let held: Live['held'];
    if (ticks === undefined || opts.held) {
      const clip = this.reg.fieldEffects.get(effect)!.animations?.[anim];
      if (!clip) throw new Error(`world: fieldEffects ${effect} has no '${anim}' animation`);
      ticks = clip.ticks;
      if (opts.held) {
        const { who, x, z, settled } = opts.held;
        held = { who, x, z, clip: clip.ticks };
        ticks = null;
        if (settled) tick = clip.ticks - 1;
      }
    }
    const key = this.nextKey++;
    this.live.push({ key, effect, renderer, anim, tick, ticks, cur: [...at], prev: [...at], follow: opts.follow ?? false, ...(opts.facing ? { facing: opts.facing } : {}), ...(held ? { held } : {}) });
    return key;
  }

  /**
   * Starts a one-shot effect found by record name (the destroy-obstacle animations, which no
   * FIELD_EFFECT_RENDERER drives). It lasts its record clip `anim`. A pack without the record logs a stub.
   */
  addNamed(name: string, anim: string, at: Vec3): number | null {
    const effect = [...this.reg.fieldEffects.values()].find((e) => e.name === name);
    if (!effect) {
      this.log.stub(`fldeff:${name}`, `no fieldEffects record named ${name}`);
      return null;
    }
    const clip = effect.animations?.[anim];
    if (!clip) throw new Error(`world: fieldEffects ${effect.id} has no '${anim}' animation`);
    const key = this.nextKey++;
    this.live.push({ key, effect: effect.id, renderer: -1, anim, tick: 0, ticks: clip.ticks, cur: [...at], prev: [...at], follow: false });
    return key;
  }

  has(key: number | null): boolean {
    return key !== null && this.live.some((e) => e.key === key);
  }

  remove(key: number | null): void {
    this.live = this.live.filter((e) => e.key !== key);
  }

  /** Pins a following effect to a position (the surf blob while the player jumps on or off it). */
  setFollow(key: number | null, follow: boolean): void {
    const e = this.live.find((x) => x.key === key);
    if (e) e.follow = follow;
  }

  clear(): void {
    this.live = [];
  }

  /**
   * One tick: ages every effect, ends the timed ones, moves the following ones with the player. A held
   * effect ends when its object is not among `present`, or once `tick` reaches its clip length (the DS
   * plays the rustle to its end first) and the object stands elsewhere (ov5_021F2FAC).
   */
  step(player: { cur: Vec3; prev: Vec3; facing: Facing }, present: readonly Occupant[]): void {
    for (const e of this.live) {
      e.tick++;
      e.prev = e.follow ? [...player.prev] : [...e.cur];
      if (e.follow) {
        e.cur = [...player.cur];
        e.facing = player.facing;
      }
    }
    this.live = this.live.filter((e) => {
      const h = e.held;
      if (h) return present.includes(h.who) && (e.tick < h.clip || (h.who.x === h.x && h.who.z === h.z));
      return e.ticks === null || e.tick < e.ticks;
    });
  }

  view(): EffectView[] {
    return this.live.map((e) => ({ key: e.key, effect: e.effect, cur: [...e.cur], prev: [...e.prev], anim: e.anim, tick: e.tick, ...(e.facing ? { facing: e.facing } : {}) }));
  }
}
