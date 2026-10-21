import type { Facing } from '@opensinnoh/contracts';

/**
 * Tile behaviour predicates by `tileBehaviors` name (decomp src/map_tile_behavior.c, TileBehavior_Is*).
 * The world keys off names, not bytes.
 *
 * The bytes the decomp calls UNKNOWN_x3C–x3F, x60, x88, x8E and x8F (76 tiles on Platinum) have no
 * predicate and no flag in the decomp (`sTileBehaviorFlags` = NONE): no code reads them, so they walk
 * like NONE. They are listed here so that is a decision, not an accident.
 */
export const INERT_UNKNOWN = new Set(['UNKNOWN_x3C', 'UNKNOWN_x3D', 'UNKNOWN_x3E', 'UNKNOWN_x3F', 'UNKNOWN_x60', 'UNKNOWN_x88', 'UNKNOWN_x8E', 'UNKNOWN_x8F']);

/** TILE_BEHAVIOR_FLAG_SURFABLE in sTileBehaviorFlags. */
const SURFABLE = new Set([
  'WATER_RIVER',
  'UNUSED_x11',
  'UNUSED_x12',
  'WATERFALL',
  'UNUSED_x14',
  'WATER_SEA',
  'UNUSED_x19',
  'UNUSED_x22',
  'UNUSED_x2A',
  'UNUSED_x50',
  'UNUSED_x51',
  'UNUSED_x52',
  'UNUSED_x53',
  'BRIDGE_OVER_WATER',
  'BIKE_BRIDGE_N_S_OVER_WATER',
  'BIKE_BRIDGE_E_W_OVER_WATER',
]);
export const isSurfable = (b: string) => SURFABLE.has(b);

export const isIce = (b: string) => b === 'ICE';
export const isWaterfall = (b: string) => b === 'WATERFALL';
export const isSand = (b: string) => b === 'SAND';
export const isPuddle = (b: string) => b === 'PUDDLE' || b === 'PUDDLE_NO_SPLASHING';
export const isShallowWater = (b: string) => b === 'SHALLOW_WATER';
export const isVeryTallGrass = (b: string) => b === 'VERY_TALL_GRASS';
export const isMud = (b: string) => b === 'MUD' || b === 'MUD_DEEP';
export const isDeepMud = (b: string) => b === 'MUD_DEEP';
export const isMudWithGrass = (b: string) => b === 'MUD_WITH_GRASS' || b === 'MUD_DEEP_WITH_GRASS';
export const isDeepMudWithGrass = (b: string) => b === 'MUD_DEEP_WITH_GRASS';
export const isSnow = (b: string) => b === 'SNOW_DEEP' || b === 'SNOW_DEEPER' || b === 'SNOW_DEEPEST' || b === 'SNOW_SHALLOW';
export const isShallowSnow = (b: string) => b === 'SNOW_SHALLOW';
export const isSnowWithShadows = (b: string) => b === 'SNOW_WITH_SHADOWS';
/** Deep snow levels slow walking (MapObject_GetDeepSnowMovementAction). */
export const isDeepSnowAny = (b: string) => b === 'SNOW_DEEP' || b === 'SNOW_DEEPER' || b === 'SNOW_DEEPEST';
/**
 * How far a sprite sinks into the tile, in world units (decomp MapObject_SinkIntoTerrain: deep mud 14, mud
 * 12, deepest snow 16, deeper snow 14, deep snow 12; checked in that order).
 */
export function sinkDepth(b: string): number {
  if (isDeepMud(b) || isDeepMudWithGrass(b)) return 14;
  if (isMud(b) || isMudWithGrass(b)) return 12;
  if (b === 'SNOW_DEEPEST') return 16;
  if (b === 'SNOW_DEEPER') return 14;
  if (b === 'SNOW_DEEP') return 12;
  return 0;
}
export const isBikeSlope = (b: string) => b === 'BIKE_SLOPE_TOP' || b === 'BIKE_SLOPE_BOTTOM';
export const isBikeRamp = (b: string) => b === 'BIKE_RAMP_EASTWARD' || b === 'BIKE_RAMP_WESTWARD';
export const isBridgeStart = (b: string) => b === 'BRIDGE_START';

const BIKE_BRIDGE_NS = new Set(['BIKE_BRIDGE_N_S', 'BIKE_BRIDGE_N_S_OVER_ENCS', 'BIKE_BRIDGE_N_S_OVER_WATER', 'BIKE_BRIDGE_N_S_OVER_SAND']);
const BIKE_BRIDGE_EW = new Set(['BIKE_BRIDGE_E_W', 'BIKE_BRIDGE_E_W_OVER_ENCS', 'BIKE_BRIDGE_E_W_OVER_WATER', 'BIKE_BRIDGE_E_W_OVER_SAND']);
const BRIDGE = new Set(['BRIDGE', 'BRIDGE_OVER_CAVE', 'BRIDGE_OVER_WATER', 'BRIDGE_OVER_SAND', 'BRIDGE_OVER_SNOW', ...BIKE_BRIDGE_NS, ...BIKE_BRIDGE_EW]);
export const isBridge = (b: string) => BRIDGE.has(b);
export const isBikeBridgeNS = (b: string) => BIKE_BRIDGE_NS.has(b);
export const isBikeBridgeEW = (b: string) => BIKE_BRIDGE_EW.has(b);
const isBridgeOverWater = (b: string) => b === 'BRIDGE_OVER_WATER' || b === 'BIKE_BRIDGE_N_S_OVER_WATER' || b === 'BIKE_BRIDGE_E_W_OVER_WATER';
const isBridgeOverSand = (b: string) => b === 'BRIDGE_OVER_SAND' || b === 'BIKE_BRIDGE_N_S_OVER_SAND' || b === 'BIKE_BRIDGE_E_W_OVER_SAND';
const isBridgeOverSnow = (b: string) => b === 'BRIDGE_OVER_SNOW';

/**
 * The bridge height layer (decomp MAP_OBJ_STATUS_ON_ELEVATED_BRIDGE, map_object_move.c MapObject_IsOn*):
 * a bridge over water, sand or snow is that ground for an object below the bridge (not elevated).
 */
export const onWater = (b: string, elevated: boolean) => (isBridgeOverWater(b) ? !elevated : isSurfable(b));
export const onSand = (b: string, elevated: boolean) => (isBridgeOverSand(b) ? !elevated : isSand(b));
export const onSnow = (b: string, elevated: boolean) => (isBridgeOverSnow(b) ? !elevated : isSnow(b));
export const onShallowSnow = (b: string, elevated: boolean) => (isBridgeOverSnow(b) ? !elevated : isShallowSnow(b));
export const onBikeBridgeNS = (b: string, elevated: boolean) => elevated && isBikeBridgeNS(b);
export const onBikeBridgeEW = (b: string, elevated: boolean) => elevated && isBikeBridgeEW(b);

/** Rock Climb accepts the facing direction along its axis (PlayerAvatar_CanUseRockClimb). */
export function canRockClimb(b: string, facing: Facing): boolean {
  if (facing === 'up' || facing === 'down') return b === 'ROCK_CLIMB_N_S';
  return b === 'ROCK_CLIMB_E_W';
}

/** Spin tiles (Fuego Ironworks; decomp ov5_021E1154): the direction a SLIDE_* tile sends the player. */
export const SLIDES: Partial<Record<string, Facing>> = { SLIDE_EASTWARD: 'right', SLIDE_WESTWARD: 'left', SLIDE_NORTHWARD: 'up', SLIDE_SOUTHWARD: 'down' };

/** Directional blocks (TileBehavior_BlocksMovement*): the directions a BLOCK_* tile stops movement in. */
const BLOCKS: Record<string, Facing[]> = {
  BLOCK_EASTWARD: ['right'],
  BLOCK_WESTWARD: ['left'],
  BLOCK_NORTHWARD: ['up'],
  BLOCK_SOUTHWARD: ['down'],
  BLOCK_NORTH_AND_EAST: ['up', 'right'],
  BLOCK_NORTH_AND_WEST: ['up', 'left'],
  BLOCK_SOUTH_AND_EAST: ['down', 'right'],
  BLOCK_SOUTH_AND_WEST: ['down', 'left'],
  BLOCK_NORTH_AND_SOUTH: ['up', 'down'],
  BLOCK_EAST_AND_WEST: ['left', 'right'],
};
export const blocksMovement = (b: string, dir: Facing) => BLOCKS[b]?.includes(dir) ?? false;
