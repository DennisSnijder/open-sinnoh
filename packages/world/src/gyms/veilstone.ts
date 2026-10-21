import type { EffectView, Facing, Tile, VeilstoneGymTables } from '@opensinnoh/contracts';
import { DELTA, OPPOSITE, WALK_NORMAL_TICKS } from '../movement.ts';
import { createActor, onSpot, walk, type Actor } from '../npc.ts';
import { tileCentre } from '../tiles.ts';
import { FEATURE_EFFECT_KEYS, gymTables, slotOf, type FeatureHost, type MapFeature } from './feature.ts';

/**
 * Veilstone Gym's punching bags and tyre stacks (decomp src/overlay008/gym_features.c VeilstoneGym_*,
 * src/overlay005/veilstone_gym_object_renderer.c; docs/research/gym-puzzles.md). The bags and stacks are
 * invisible map objects (they block the player, other objects and trainer sight), created at their table
 * position z − 2 when the slot is fresh, else where the slot says. Pushing into a bag (the map-transition
 * check, before warps) kicks it: it slides along the gym's own track grid until a stop point, a wall or a
 * stack; a stack just beyond its endpoint topples and is removed. A long push walks a camera object along.
 * The timing follows the decomp task's fixed-point speeds, one state per 30 Hz tick.
 */

/** fx32 one; the bag's starting speed and acceleration (FX32_ONE / 60). */
const FX = 4096;
const SPEED_STEP = Math.trunc(FX / 60);
/** The bag clip's frame step over the slide: FX32_CONST(13) / (distance · 16 / 2). */
const SLIDE_CLIP = 13 * FX;
/** VEILSTONE_TILE_FLAG_*. */
const CANT_MOVE = 1;
const STACK = 2;
const PAUSE = 4;
/** Track values (sVeilstoneTileBehaviors). */
const TRACK = { wall: 1, noNorthSouth: 2, noWestEast: 3, stop: 4, noWest: 5 } as const;
/** VEILSTONE_ANIM_STATE_*: the moving task's states. */
const enum S {
  Init,
  Kick,
  Start,
  Move,
  Topple,
  Remove,
  PrepCamera,
  CameraBack,
  FinishBag,
  WaitPlayer,
}
/** The models sit 6 units above the floor (InitPunchingBagRenderer, TireStackAnim_Init). */
const MODEL_LIFT = 6;
/** Ticks: the topple waits 4 before its animation (VeilstoneGym_AnimationState_ToppleTireStack). */
const TOPPLE_DELAY = 4;
/** Player actions: WALK_ON_SPOT_SLOW (a moving kick) and WALK_ON_SPOT_FASTER (a blocked one); camera walks NORMAL, FAST (back). */
const KICK_TICKS = 16;
const BLOCKED_KICK_TICKS = 2;
const WALK_FAST_TICKS = 4;
/** Decomp DIR_* order: the bag clips are indexed by the direction opposite the push. */
const DIR_NAMES: Record<Facing, string> = { up: 'n', down: 's', left: 'w', right: 'e' };
const BAG_CLIPS = ['still', 'move'].flatMap((k) => ['n', 's', 'w', 'e'].map((d) => `${k}-${d}`));

interface Bag {
  /** The collision object (moves only at the end of a slide). */
  actor: Actor;
  /** The bag's logical tile (VeilstoneGymMapObjectManager x/z: advances tile by tile during a slide). */
  x: number;
  z: number;
  /** Drawn position (world units) and the clip it plays (fx frames). */
  pos: [number, number, number];
  prev: [number, number, number];
  clip: { name: string; frame: number; delta: number; length: number; finished: boolean } | null;
}

interface Stack {
  actor: Actor;
  pos: [number, number, number];
  /** The topple clip's frame once it plays; it is removed when every component has finished. */
  topple: number | null;
}

interface CameraMove {
  obj: Actor;
  dir: Facing;
  distance: number;
  travelled: number;
  /** VeilstoneGymCameraManager.movementState: 0 idle, 1 walking, 2 arriving. */
  state: 0 | 1 | 2;
  finished: boolean;
}

interface Task {
  kind: 'move' | 'blocked';
  bag: Bag;
  dir: Facing;
  state: S;
  distance: number;
  speed: number;
  travelled: number;
  tiles: number;
  elapsed: number;
  stack: number | null;
  camera: CameraMove | null;
}

export class VeilstoneGym implements MapFeature {
  private readonly t: VeilstoneGymTables;
  private readonly bags: Bag[] = [];
  /** By table index; null once toppled. */
  private readonly stacks: (Stack | null)[] = [];
  private task: Task | null = null;

  constructor(private readonly h: FeatureHost) {
    this.t = gymTables(h.reg).veilstone;
    const slot = slotOf(h.state, 'veilstone-gym');
    if (!slot.initialized) {
      // VeilstoneGym_InitMapObjects: every object at its table position, two tiles north.
      slot.stacks = this.t.stacks.map((p) => ({ x: p.x, z: p.z - 2 }));
      slot.bags = this.t.bags.map((p) => ({ x: p.x, z: p.z - 2 }));
    }
    slot.initialized = true;
    for (const s of slot.stacks) this.stacks.push(s ? { actor: this.object(s), pos: this.modelAt(s.x, s.z), topple: null } : null);
    for (const b of slot.bags) {
      const pos = this.modelAt(b.x, b.z);
      this.bags.push({ actor: this.object(b), x: b.x, z: b.z, pos, prev: [...pos], clip: null });
    }
  }

  /** VeilstoneGym_CreateObject: an invisible, static map object. */
  private object(at: Tile): Actor {
    const a = createActor(0xfd, null, at.x, at.z, 0, 'down', 0, this.h.zone().id);
    a.visible = false;
    this.h.addObject(a);
    return a;
  }

  private modelAt(x: number, z: number): [number, number, number] {
    const wx = tileCentre(x);
    const wz = tileCentre(z);
    return [wx, this.h.heightAt(wx, wz, 0) + MODEL_LIFT, wz];
  }

  private track(x: number, z: number): number {
    if (x < 0 || x >= 32 || z < 0 || z >= 32) throw new Error(`world: Veilstone Gym track read off the grid at ${x},${z} (the decomp asserts)`);
    return this.t.track[z * 32 + x]!;
  }

  private stackAt(x: number, z: number): number | null {
    const i = this.stacks.findIndex((s) => s && s.actor.x === x && s.actor.z === z);
    return i < 0 ? null : i;
  }

  /** VeilstoneGym_GetTileFlags: restrictions and stop points on this tile, a wall or a stack on the next. */
  private flags(x: number, z: number, dir: Facing): number {
    let f = 0;
    const v = this.track(x, z);
    if (v === TRACK.stop) f |= PAUSE;
    else if (v === TRACK.noNorthSouth && (dir === 'up' || dir === 'down')) f |= CANT_MOVE;
    else if (v === TRACK.noWestEast && (dir === 'left' || dir === 'right')) f |= CANT_MOVE;
    else if (v === TRACK.noWest && dir === 'left') f |= CANT_MOVE;
    const [dx, dz] = DELTA[dir];
    if (this.track(x + dx, z + dz) === TRACK.wall) f |= CANT_MOVE;
    if (this.stackAt(x + dx, z + dz) !== null) f |= STACK;
    return f;
  }

  /** VeilstoneGym_CalculateDistanceBagWillTravel. */
  private distance(x: number, z: number, dir: Facing): number {
    let f = this.flags(x, z, dir);
    if (f !== 0 && f !== PAUSE) return 0;
    const [dx, dz] = DELTA[dir];
    let n = 0;
    do {
      x += dx;
      z += dz;
      n++;
      f = this.flags(x, z, dir);
    } while (f === 0);
    return n;
  }

  /** VeilstoneGym_HitPunchingBag: a bag on the tile the player pushes toward starts the kick. */
  push(dir: Facing): boolean {
    if (this.task) return false;
    const p = this.h.hero();
    const [dx, dz] = DELTA[dir];
    const bag = this.bags.find((b) => b.x === p.x + dx && b.z === p.z + dz);
    if (!bag) return false;
    const distance = this.distance(bag.x, bag.z, dir);
    this.task = { kind: distance === 0 ? 'blocked' : 'move', bag, dir, state: S.Init, distance: 0, speed: 0, travelled: 0, tiles: 0, elapsed: 0, stack: null, camera: null };
    return true;
  }

  busy(): boolean {
    return this.task !== null;
  }

  private startClip(bag: Bag, dir: Facing, moving: boolean): void {
    const name = `${moving ? 'move' : 'still'}-${DIR_NAMES[OPPOSITE[dir]]}`;
    // StartPunchingBagAnimation keeps the renderer's frame delta (FX32_ONE unless a slide is in progress).
    bag.clip = { name, frame: 0, delta: bag.clip?.delta ?? FX, length: this.clipTicks('bag', name) * FX, finished: false };
  }

  private clipTicks(which: 'bag' | 'toppled', use: string): number {
    const e = this.t.effects;
    if (!e) return 1;
    const id = which === 'bag' ? e.bag[use] : e.toppled;
    if (!id) throw new Error(`world: Veilstone Gym has no bag effect for '${use}'`);
    const clip = this.h.reg.fieldEffects.get(id)?.animations?.[use];
    if (!clip) throw new Error(`world: Veilstone Gym effect ${id} has no '${use}' animation`);
    return clip.ticks;
  }

  step(): void {
    for (const b of this.bags) b.prev = [...b.pos];
    const k = this.task;
    if (k) {
      if (k.kind === 'blocked') this.stepBlocked(k);
      else {
        // FieldTask_VeilstoneGym_HitPunchingBag: states return CONTINUE to run the next in the same frame.
        let more = true;
        while (more && this.task) more = this.stepMove(k);
      }
    }
    // The renderers' updates (PunchingBagAnim_Update, TireStackAnim_Update).
    for (const b of this.bags) {
      const c = b.clip;
      if (!c || c.finished) continue;
      c.frame += c.delta;
      if (c.frame >= c.length) {
        c.frame = c.length;
        c.finished = true;
      }
    }
    for (const s of this.stacks) if (s && s.topple !== null && s.topple < this.clipTicks('toppled', 'topple')) s.topple++;
  }

  /** FieldTask_VeilstoneGym_HitPunchingBagNoMovement. */
  private stepBlocked(k: Task): void {
    const p = this.h.hero();
    if (k.state === S.Init) {
      if (p.motion) return;
      onSpot(p, k.dir, BLOCKED_KICK_TICKS, 'auto');
      this.startClip(k.bag, k.dir, false);
      this.h.sound.play(1367);
      k.state = S.WaitPlayer;
      return;
    }
    if (!p.motion && k.bag.clip?.finished) this.task = null;
  }

  /** One state of the moving task; true = CONTINUE (run the next state this frame). */
  private stepMove(k: Task): boolean {
    const p = this.h.hero();
    const bag = k.bag;
    const [dx, dz] = DELTA[k.dir];
    switch (k.state) {
      case S.Init:
        k.distance = this.distance(bag.x, bag.z, k.dir);
        k.speed = SPEED_STEP;
        k.state = S.Kick;
        return false;
      case S.Kick: {
        if (p.motion) return false;
        onSpot(p, k.dir, KICK_TICKS, 'auto');
        this.startClip(bag, k.dir, true);
        this.h.sound.play(1367);
        if (k.distance > this.t.cameraDistance[k.dir]) {
          k.camera = { obj: this.h.trackCamera(p.x, p.z), dir: k.dir, distance: k.distance, travelled: 0, state: 1, finished: false };
        }
        k.state = S.Start;
        return true;
      }
      case S.Start:
        this.moveBag(bag, k.dir, k.speed);
        k.speed += SPEED_STEP;
        k.travelled += k.speed;
        k.elapsed++;
        if (k.elapsed >= 30) {
          this.h.sound.play(1356);
          bag.clip!.delta = Math.trunc(SLIDE_CLIP / Math.trunc((k.distance * 16) / 2));
          k.state = S.Move;
        }
        return false;
      case S.Move: {
        this.moveBag(bag, k.dir, k.speed);
        k.travelled += k.speed;
        k.elapsed++;
        if (k.elapsed < 36) {
          if (k.speed < FX) k.speed += k.speed;
        } else if (k.elapsed === 36 && k.speed <= 2 * FX) k.speed = 2 * FX;
        this.updateCamera(k);
        const tiles = Math.trunc((k.travelled >> 4) / FX);
        if (tiles > k.tiles) {
          k.tiles = tiles;
          bag.x += dx;
          bag.z += dz;
          const f = this.flags(bag.x, bag.z, k.dir);
          if (f !== 0) {
            // The bag snaps to its tile; only now does its collision object move.
            bag.pos = this.modelAt(bag.x, bag.z);
            bag.actor.x = bag.x;
            bag.actor.z = bag.z;
            this.saveSlot();
            this.h.sound.stop(1356);
            this.h.sound.play(1367);
            this.h.sound.play(1357);
            bag.clip!.delta = FX;
            if (f & STACK) {
              k.stack = this.stackAt(bag.x + dx, bag.z + dz);
              if (k.stack === null) throw new Error('world: Veilstone Gym stack flag without a stack');
              k.elapsed = 0;
              k.state = S.Topple;
            } else k.state = k.camera ? S.PrepCamera : S.FinishBag;
          }
        }
        return false;
      }
      case S.Topple:
        this.updateCamera(k);
        if (++k.elapsed >= TOPPLE_DELAY) {
          k.elapsed = 0;
          k.state = S.Remove;
          this.stacks[k.stack!]!.topple = 0;
          this.h.sound.play(1578);
        }
        return false;
      case S.Remove: {
        this.updateCamera(k);
        const s = this.stacks[k.stack!]!;
        if (s.topple! < this.clipTicks('toppled', 'topple')) return false;
        // VeilstoneGym_RemoveTireStack: the stack's object and renderer go.
        this.h.removeObject(s.actor);
        this.stacks[k.stack!] = null;
        this.saveSlot();
        k.elapsed = 0;
        k.state = k.camera ? S.PrepCamera : S.FinishBag;
        return false;
      }
      case S.PrepCamera: {
        this.updateCamera(k);
        const cam = k.camera!;
        if (cam.finished && bag.clip!.finished) {
          cam.travelled = 0;
          cam.state = 1;
          cam.finished = false;
          cam.dir = OPPOSITE[cam.dir];
          k.state = S.CameraBack;
        }
        return false;
      }
      case S.CameraBack:
        this.moveCamera(k.camera!, WALK_FAST_TICKS);
        if (k.camera!.finished) {
          this.h.releaseCamera();
          k.camera = null;
          k.state = S.WaitPlayer;
        }
        return false;
      case S.FinishBag:
        if (bag.clip!.finished) k.state = S.WaitPlayer;
        return false;
      case S.WaitPlayer:
        if (p.motion) return false;
        this.task = null;
        return false;
    }
  }

  private moveBag(bag: Bag, dir: Facing, speed: number): void {
    const [dx, dz] = DELTA[dir];
    bag.pos = [bag.pos[0] + (dx * speed) / FX, bag.pos[1], bag.pos[2] + (dz * speed) / FX];
  }

  /** VeilstoneGym_UpdateCamera: the camera walks while the bag is fast enough (NORMAL up to 2 units a tick, then FAST). */
  private updateCamera(k: Task): void {
    if (!k.camera) return;
    const units = Math.trunc(k.speed / FX);
    if (units === 0) return;
    this.moveCamera(k.camera, units <= 2 ? WALK_NORMAL_TICKS : WALK_FAST_TICKS);
  }

  /** VeilstoneGym_MoveCamera: one walk when the camera object is free, until it has walked the distance. */
  private moveCamera(cam: CameraMove, ticks: number): void {
    if (cam.state === 1) {
      if (cam.obj.motion) return;
      if (cam.travelled >= cam.distance) cam.state = 2;
      else {
        walk(cam.obj, cam.dir, ticks, 'walk', 'auto');
        cam.travelled++;
      }
    } else if (cam.state === 2) {
      cam.finished = true;
      cam.state = 0;
    }
  }

  private saveSlot(): void {
    const slot = slotOf(this.h.state, 'veilstone-gym');
    slot.bags = this.bags.map((b) => ({ x: b.actor.x, z: b.actor.z }));
    slot.stacks = this.stacks.map((s) => (s ? { x: s.actor.x, z: s.actor.z } : null));
  }

  view(): ReturnType<MapFeature['view']> {
    const e = this.t.effects;
    if (!e) return { effects: [], features: null };
    const effects: EffectView[] = [];
    this.stacks.forEach((s, i) => {
      if (!s) return;
      const toppling = s.topple !== null;
      effects.push({ key: FEATURE_EFFECT_KEYS + i, effect: toppling ? e.toppled : e.stack, cur: s.pos, prev: s.pos, ...(toppling ? { anim: 'topple' } : {}), tick: s.topple ?? 0 });
    });
    this.bags.forEach((b, i) => {
      const clip = b.clip?.name ?? 'still-s';
      const effect = e.bag[clip];
      if (!effect) throw new Error(`world: Veilstone Gym has no bag effect for '${clip}'`);
      // One effect record per clip: a new clip is a new instance.
      effects.push({ key: FEATURE_EFFECT_KEYS + 100 + i * 10 + BAG_CLIPS.indexOf(clip), effect, cur: [...b.pos], prev: [...b.prev], anim: clip, tick: b.clip ? b.clip.frame / FX : 0 });
    });
    return { effects, features: null };
  }

  /** Test probe: bag and stack tiles and the logical bag positions. */
  objects(): { bags: Tile[]; stacks: (Tile | null)[] } {
    return { bags: this.bags.map((b) => ({ x: b.actor.x, z: b.actor.z })), stacks: this.stacks.map((s) => (s ? { x: s.actor.x, z: s.actor.z } : null)) };
  }
}

