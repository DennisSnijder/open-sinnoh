import type { CanalaveGymPlatform, CanalaveGymTables, FeatureModelView, Facing } from '@opensinnoh/contracts';
import { walk } from '../npc.ts';
import { TILE } from '../tiles.ts';
import { gymTables, slotOf, type FeatureHost, type MapFeature } from './feature.ts';

/**
 * Canalave Gym's 24 lifts (decomp src/overlay008/gym_features.c CanalaveGym_*; docs/research/gym-puzzles.md).
 * The saved bitset (`MapFeatures` canalave-gym `platformStates`) puts each platform at endpoint A or B. A
 * completed player step onto a platform's tile at its height starts its ride (Field_ProcessStep →
 * CanalaveGym_CheckIfPlayerOnPlatform): its bit flips at once; a lift moves the platform and the player 8
 * units a tick with height calculation off, a horizontal platform walks the player WALK_FASTER tile by tile
 * and follows. The player's collision is the floor's authored 32×32 mask (it replaces the map's), the floor
 * being the player's height / 160. The upper floors and their platforms are drawn only once the player (or a
 * riding lift) is high enough.
 */

/** CANALAVE_XZ_OFFSET, CANALAVE_DIST_BETWEEN_FLOORS (tiles), the vertical ride's speed (FX32_CONST(8)). */
const XZ_OFFSET = 8;
const FLOOR_TILES = 10;
const LIFT_SPEED = 8;
/** MOVEMENT_ACTION_WALK_FASTER_*: 2 ticks a tile. */
const WALK_FASTER_TICKS = 2;
/** CanalaveGym_UpdateVisibleProps: floors 2–4 (and their platforms) show from these heights. */
const SHOW_FROM = [TILE, TILE * (FLOOR_TILES + 1), TILE * (FLOOR_TILES * 2 + 1)];
const MAP_TILES = 32;

interface Ride {
  index: number;
  axis: 'x' | 'y' | 'z';
  dir: Facing | 'up-lift' | 'down-lift';
  /** World units: the destination on the ride's axis. */
  destination: number;
  state: number;
}

export class CanalaveGym implements MapFeature {
  private readonly t: CanalaveGymTables;
  /** Each platform's logical endpoint (tiles), its floor, and where it is drawn (world units). */
  private readonly positions: [number, number, number][];
  private readonly floors: number[];
  private readonly drawn: { cur: [number, number, number]; prev: [number, number, number] }[];
  /** The height the upper floors' visibility follows (the player's at load, a riding lift's after). */
  private visibleY: number;
  private ride: Ride | null = null;

  constructor(private readonly h: FeatureHost) {
    this.t = gymTables(h.reg).canalave;
    const states = this.states;
    this.positions = this.t.platforms.map((p, i) => [...(this.inB(states, i) ? p.b : p.a)]);
    this.floors = this.t.platforms.map((p, i) => (this.inB(states, i) ? p.floorB : p.floorA));
    this.drawn = this.positions.map((pos) => {
      const at = this.world(pos);
      return { cur: at, prev: [...at] };
    });
    this.visibleY = h.hero().y;
  }

  private get states(): number {
    return slotOf(this.h.state, 'canalave-gym').platformStates;
  }

  private inB(states: number, i: number): boolean {
    return ((states >> i) & 1) === 1;
  }

  /** A platform's world position for a tile position: x/z at the tile centre, y in floor tiles. */
  private world([x, y, z]: [number, number, number]): [number, number, number] {
    return [x * TILE + XZ_OFFSET, y * TILE, z * TILE + XZ_OFFSET];
  }

  /** CanalaveGym_DynamicMapFeaturesCheckCollision: the floor's mask replaces the map's collision. */
  collides(x: number, z: number): boolean {
    const floor = Math.floor(this.h.hero().y / TILE / FLOOR_TILES);
    if (floor < 0 || floor > 3) throw new Error(`world: Canalave Gym floor ${floor} (player y ${this.h.hero().y})`);
    if (x < 0 || z < 0 || x >= MAP_TILES || z >= MAP_TILES) throw new Error(`world: Canalave Gym collision outside its map at ${x},${z}`);
    return this.t.collision[floor]![x + z * MAP_TILES] === 1;
  }

  /** CanalaveGym_CheckIfPlayerOnPlatform after a completed step: the platform at the player's tile and height rides. */
  stepped(): boolean {
    const p = this.h.hero();
    const ty = Math.floor(p.y / TILE);
    const i = this.positions.findIndex(([x, y, z]) => y === ty && x === p.x && z === p.z);
    if (i < 0) return false;
    this.start(i);
    return true;
  }

  /** CanalaveGym_MovePlatform: the bit flips now; the new endpoint is the platform's logical position at once. */
  private start(i: number): void {
    if (this.ride) throw new Error('world: a Canalave Gym platform rides already');
    const p: CanalaveGymPlatform = this.t.platforms[i]!;
    const wasB = this.inB(this.states, i);
    slotOf(this.h.state, 'canalave-gym').platformStates = this.states ^ (1 << i);
    const to = wasB ? p.a : p.b;
    this.positions[i] = [...to];
    const [wx, wy, wz] = this.world(to);
    if (p.axis === 'x') this.ride = { index: i, axis: 'x', dir: wasB ? 'left' : 'right', destination: wx, state: 0 };
    else if (p.axis === 'z') this.ride = { index: i, axis: 'z', dir: wasB ? 'up' : 'down', destination: wz, state: 0 };
    else {
      // Going down, the platform's floor changes at once; going up, when it arrives.
      if (wasB) this.floors[i] = p.floorA;
      this.ride = { index: i, axis: 'y', dir: wasB ? 'down-lift' : 'up-lift', destination: wy, state: 0 };
    }
  }

  busy(): boolean {
    return this.ride !== null;
  }

  step(): void {
    for (const d of this.drawn) d.prev = [...d.cur];
    const r = this.ride;
    if (!r) return;
    if (r.axis === 'y') this.stepLift(r);
    else this.stepAcross(r);
  }

  /** FieldTask_CanalaveGym_MovePlatformUpDown. */
  private stepLift(r: Ride): void {
    const d = this.drawn[r.index]!;
    switch (r.state) {
      case 0:
        this.h.sound.play(1553);
        this.h.setHeightCalculation(false);
        r.state = 1;
        return;
      case 1: {
        const up = r.dir === 'up-lift';
        let y = d.cur[1] + (up ? LIFT_SPEED : -LIFT_SPEED);
        if (up ? y >= r.destination : y <= r.destination) {
          y = r.destination;
          this.h.sound.stop(1553);
          if (up) this.floors[r.index] = this.t.platforms[r.index]!.floorB;
          r.state = 2;
        }
        d.cur[1] = y;
        this.h.hero().y = y;
        this.visibleY = y;
        return;
      }
      case 2:
        this.h.sound.play(1562);
        this.h.setHeightCalculation(true);
        r.state = 3;
        return;
      case 3:
        this.ride = null;
        return;
      default:
        throw new Error(`world: Canalave Gym lift task in state ${r.state}`);
    }
  }

  /**
   * FieldTask_CanalaveGym_MovePlatformEastWest / NorthSouth: the platform follows the player's position; while
   * short of the destination, a free player walks WALK_FASTER on. The east/west task's state 2 falls into 3.
   */
  private stepAcross(r: Ride): void {
    const p = this.h.hero();
    const d = this.drawn[r.index]!;
    const k = r.axis === 'x' ? 0 : 2;
    switch (r.state) {
      case 0:
        if (p.motion) return;
        this.h.sound.play(1553);
        r.state = 1;
        return;
      case 1: {
        d.cur[k] = p.cur[k]!;
        const ahead = r.dir === 'right' || r.dir === 'down';
        if (ahead ? d.cur[k] >= r.destination : d.cur[k] <= r.destination) {
          d.cur[k] = r.destination;
          this.h.sound.stop(1553);
          r.state = 2;
        } else if (!p.motion) walk(p, r.dir as Facing, WALK_FASTER_TICKS, 'walk', 'script');
        return;
      }
      case 2:
        if (p.motion) return;
        r.state = 3;
        if (r.axis === 'z') return;
      // falls through (the east/west task has no break)
      case 3:
        if (p.motion) return;
        this.h.sound.play(1562);
        r.state = 4;
        return;
      case 4:
        this.ride = null;
        return;
      default:
        throw new Error(`world: Canalave Gym platform task in state ${r.state}`);
    }
  }

  view(): ReturnType<MapFeature['view']> {
    const shown = (floor: number) => floor === 0 || this.visibleY >= SHOW_FROM[floor - 1]!;
    const models: FeatureModelView[] = [];
    this.t.floors.forEach((prop, k) => {
      if (shown(k + 1)) models.push({ key: `canalave-floor-${k + 2}`, prop, position: [256, TILE * FLOOR_TILES * (k + 1), 256], rotation: [0, 0, 0] });
    });
    this.t.platforms.forEach((p, i) => {
      if (!shown(this.floors[i]!)) return;
      const d = this.drawn[i]!;
      models.push({ key: `canalave-platform-${i}`, prop: p.prop, position: [...d.cur], prev: [...d.prev], rotation: [0, 0, 0] });
    });
    return { effects: [], features: { models, fog: FOG } };
  }

  /** Test probe: the platforms' logical tile positions and floors. */
  probe(): { positions: [number, number, number][]; floors: number[] } {
    return { positions: this.positions.map((p) => [...p]), floors: [...this.floors] };
  }
}

/**
 * CanalaveGym_DynamicMapFeaturesInit's fog: GX_FOGSLOPE_0x0200 (slope 6), offset 0x76A0, black, alpha 0, the
 * density table 2 × index.
 */
const FOG = { slope: 6, offset: 0x76a0, color: [0, 0, 0] as [number, number, number], alpha: 0, densities: Array.from({ length: 32 }, (_, i) => i * 2) };
