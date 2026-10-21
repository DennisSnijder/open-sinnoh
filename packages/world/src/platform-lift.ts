import type { GameState, Vec3 } from '@opensinnoh/contracts';
import { TILE } from './tiles.ts';

/**
 * Platform lifts (decomp src/platform_lift.c): Iron Island and the Pokémon League. A lift is a prop that
 * carries a 3×2-tile height plate (DynamicTerrainHeightManager_SetPlate) between two floor heights. Which
 * floor it is at is saved (`GameState.platformLift`, decomp PersistedMapFeatures); the zone's onTransition
 * sets it from the arrival tile (PersistedMapFeatures_InitForPlatformLift) and a coord event rides it
 * (PlatformLift_Trigger → FieldTask_PlatformLiftGoUp/GoDown).
 */

interface LiftConfig {
  /** Zone name without `MAP_HEADER_`; the index in LIFTS is the decomp PlatformLiftID. */
  zone: string;
  /** sPerMapPlatformLiftConfiguration floorHeights (MAP_OBJECT_TILE_SIZE = 16 units). */
  heights: [number, number];
  startX: number;
  startZ: number;
  preventGoingDown: boolean;
  /** Arriving on this z is the bottom floor (*_BOTTOM_FLOOR_WARP_Z). */
  bottomZ: number;
  kind: 'iron-island' | 'pokemon-league';
  /** Iron Island B2F left room: the lift is not a map prop; it is loaded at a fixed spot (world units). */
  loadedAt?: [number, number];
}

const T = TILE;
const MAP_TILES = 32;
const ELITE_FOUR_BOTTOM_Z = 15;

export const LIFTS: LiftConfig[] = [
  { zone: 'IRON_ISLAND_B1F_RIGHT_ROOM', heights: [T * 1, T * 9], startX: 10, startZ: 23, preventGoingDown: false, bottomZ: 26, kind: 'iron-island' },
  {
    zone: 'IRON_ISLAND_B2F_LEFT_ROOM',
    heights: [T * 1, T * 9],
    startX: 18,
    startZ: 44,
    preventGoingDown: false,
    bottomZ: MAP_TILES + 16,
    kind: 'iron-island',
    loadedAt: [T * 19 + 8, T * (MAP_TILES + 12) + 8],
  },
  { zone: 'IRON_ISLAND_B3F', heights: [T * 1, T * 9], startX: 8, startZ: 11, preventGoingDown: false, bottomZ: 15, kind: 'iron-island' },
  { zone: 'POKEMON_LEAGUE_ELEVATOR_TO_AARON_ROOM', heights: [0, T * 10], startX: 3, startZ: 11, preventGoingDown: true, bottomZ: ELITE_FOUR_BOTTOM_Z, kind: 'pokemon-league' },
  { zone: 'POKEMON_LEAGUE_ELEVATOR_TO_BERTHA_ROOM', heights: [0, T * 5], startX: 3, startZ: 11, preventGoingDown: true, bottomZ: ELITE_FOUR_BOTTOM_Z, kind: 'pokemon-league' },
  { zone: 'POKEMON_LEAGUE_ELEVATOR_TO_FLINT_ROOM', heights: [0, T * 5], startX: 3, startZ: 11, preventGoingDown: true, bottomZ: ELITE_FOUR_BOTTOM_Z, kind: 'pokemon-league' },
  { zone: 'POKEMON_LEAGUE_ELEVATOR_TO_LUCIAN_ROOM', heights: [0, T * 5], startX: 3, startZ: 11, preventGoingDown: true, bottomZ: ELITE_FOUR_BOTTOM_Z, kind: 'pokemon-league' },
  { zone: 'POKEMON_LEAGUE_ELEVATOR_TO_CHAMPION_ROOM', heights: [0, T * 5], startX: 3, startZ: 19, preventGoingDown: true, bottomZ: 23, kind: 'pokemon-league' },
  { zone: 'POKEMON_LEAGUE_CHAMPION_ROOM', heights: [0, T * 15], startX: 7, startZ: 8, preventGoingDown: true, bottomZ: 18, kind: 'pokemon-league' },
];

/** The plate: PLATFORM_LIFT_SIZE_X × PLATFORM_LIFT_SIZE_Y tiles from the start tile. */
const PLATE_W = 3;
const PLATE_D = 2;

/** The decomp PlatformLiftID of a zone id (`…:MAP_HEADER_<name>`), or -1. */
export function liftOf(zone: string): number {
  return LIFTS.findIndex((l) => zone.endsWith(`:MAP_HEADER_${l.zone}`));
}

/** PersistedMapFeatures_InitForPlatformLift: the floor from the arrival z; a lift that goes up only was used when arriving on top. */
export function initLift(lift: number, arrivalZ: number): NonNullable<GameState['platformLift']> {
  const c = LIFTS[lift]!;
  const bottom = arrivalZ === c.bottomZ;
  return { lift, floor: bottom ? 'bottom' : 'top', notUsedWhenEntered: bottom || c.kind === 'iron-island' };
}

/**
 * The lift of the current zone: its height plate and the ride (one state step per tick: start, move by 1
 * unit a tick (2 going up in the League) until the target, set the plate, end). `prop` is the lift's map
 * placement in world units (or the fixed spot of Iron Island B2F); its height is `height`.
 */
export class PlatformLift {
  height: number;
  /** The plate keeps the old height while the lift moves (it is set when the ride finishes). */
  private platePlaced: number;
  private ride: { phase: 'start' | 'move' | 'finish' | 'end'; target: number } | null = null;

  constructor(
    readonly lift: number,
    private readonly data: NonNullable<GameState['platformLift']>,
    readonly position: [number, number],
  ) {
    this.height = this.platePlaced = this.config.heights[data.floor === 'bottom' ? 0 : 1];
  }

  get config(): LiftConfig {
    return LIFTS[this.lift]!;
  }

  /** The plate's height on a tile, or null off the plate (DynamicTerrainHeightManager). */
  plateAt(tx: number, tz: number): number | null {
    const c = this.config;
    return tx >= c.startX && tx < c.startX + PLATE_W && tz >= c.startZ && tz < c.startZ + PLATE_D ? this.platePlaced : null;
  }

  /** PlatformLift_Trigger: no ride down a lift that goes up only; otherwise the saved floor flips now. */
  trigger(): void {
    if (this.ride) throw new Error('world: triggerPlatformLift while the lift moves');
    const c = this.config;
    if (c.preventGoingDown && this.data.floor === 'top') return;
    const up = this.data.floor === 'bottom';
    this.ride = { phase: 'start', target: c.heights[up ? 1 : 0] };
    this.data.floor = up ? 'top' : 'bottom';
  }

  done(): boolean {
    return this.ride === null;
  }

  /**
   * One task step. Returns what the avatar does: `height` (Player_SetYPos while moving), `calc` false at
   * the start and true at the finish (PlayerAvatar_SetHeightCalculationEnabled).
   */
  step(): { height?: number; calc?: boolean; play?: number; stop?: number } {
    const r = this.ride;
    if (!r) return {};
    switch (r.phase) {
      case 'start':
        r.phase = 'move';
        return { calc: false, play: this.config.kind === 'iron-island' ? 1553 : 1556 };
      case 'move': {
        const up = r.target > this.height;
        this.height += up ? (this.config.kind === 'iron-island' ? 1 : 2) : -1;
        if (up ? this.height >= r.target : this.height <= r.target) {
          this.height = r.target;
          r.phase = 'finish';
        }
        return { height: this.height, ...(r.phase === 'finish' ? { stop: this.config.kind === 'iron-island' ? 1553 : 1556 } : {}) };
      }
      case 'finish':
        this.platePlaced = r.target;
        r.phase = 'end';
        return { calc: true, play: 1562 };
      case 'end':
        this.ride = null;
        return {};
    }
  }

  view(): Vec3 {
    return [this.position[0], this.height, this.position[1]];
  }
}
