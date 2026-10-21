import type { DistortionRoom, DwBox, DwSupportKind, DwTile, Facing } from '@opensinnoh/contracts';

/**
 * Support-local geometry of a Distortion World room (decomp ov9_02249960.c floating platforms, player_move.c
 * step tables). Everything is in whole tiles of the room's shared space; Y is the height in tiles (world
 * height / 16, decomp map object Y grid / 2). Pure: the current support is passed in, never kept here.
 */

/** The player's surface: a support's kind, or the room's land (decomp AVATAR_DISTORTION_STATE_ACTIVE). */
export type Surface = DwSupportKind | 'land';

type Step = readonly [number, number, number];

/**
 * sDistortionStepDirection{Floor,WestWall,EastWall,Ceiling}: the tile one step in an input direction. On the
 * walls up/down change Y (the west wall's left/right run +z/−z, the east wall's −z/+z); on the ceiling up/down
 * reverse Z. The land uses the floor's.
 */
export const STEPS: Record<DwSupportKind, Record<Facing, Step>> = {
  floor: { up: [0, 0, -1], down: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] },
  'west-wall': { up: [0, 1, 0], down: [0, -1, 0], left: [0, 0, 1], right: [0, 0, -1] },
  'east-wall': { up: [0, 1, 0], down: [0, -1, 0], left: [0, 0, -1], right: [0, 0, 1] },
  ceiling: { up: [0, 0, 1], down: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] },
};

/** PlayerAvatar_GetStepDistortionWorldPos. */
export function stepFrom(surface: Surface, dir: Facing, t: DwTile): DwTile {
  const [dx, dy, dz] = STEPS[surface === 'land' ? 'floor' : surface][dir];
  return { x: t.x + dx, y: t.y + dy, z: t.z + dz };
}

/** DistWorldBounds_AreCoordinatesInBounds: start ≤ t ≤ start + size on each axis. */
export function inBox(t: DwTile, b: DwBox): boolean {
  return t.y >= b.y && t.y <= b.y + b.sizeY && t.z >= b.z && t.z <= b.z + b.sizeZ && t.x >= b.x && t.x <= b.x + b.sizeX;
}

/** Terrain cell bits (decomp TERRAIN_ATTRIBUTES_*): collision is bit 15, the behaviour the low byte. */
export const CELL_COLLISION = 0x8000;
export const CELL_BEHAVIOUR = 0xff;

/** The surface of support `support` (null: none current, the land). */
export function surfaceOf(room: DistortionRoom, support: number | null): Surface {
  if (support === null) return 'land';
  const s = room.supports[support];
  if (!s) throw new Error(`distortion: ${room.id} has no support ${support}`);
  return s.kind;
}

/**
 * GetCurrentFloatingPlatformTileAttributes: the current support's cell under tile t, or null where there is
 * none (no current support, or t outside its box: decomp INVALID / OUT_OF_BOUNDS_TERRAIN_ATTRIBUTES). The grid
 * axes by kind are in contracts `DwSupport`.
 */
export function cellAt(room: DistortionRoom, support: number | null, t: DwTile): number | null {
  if (support === null) return null;
  const s = room.supports[support];
  if (!s) throw new Error(`distortion: ${room.id} has no support ${support}`);
  const b = s.box;
  if (!inBox(t, b)) return null;
  const h = t.z - b.z;
  const v = s.kind === 'floor' ? t.x - b.x : s.kind === 'west-wall' ? b.sizeY - (t.y - b.y) : s.kind === 'east-wall' ? t.y - b.y : b.sizeX - (t.x - b.x);
  const cell = s.cells[v + h * s.vertical];
  if (cell === undefined) throw new Error(`distortion: ${room.id} support ${support} has no cell ${v},${h} (${s.vertical}×${s.horizontal})`);
  return cell;
}

/** DistWorld_CheckCollisionOnCurrentFloatingPlatform: no cell, or the collision bit. */
export function blockedAt(room: DistortionRoom, support: number | null, t: DwTile): boolean {
  const c = cellAt(room, support, t);
  return c === null || (c & CELL_COLLISION) !== 0;
}

/** DistWorld_GetTileBehaviorOnCurrentFloatingPlatform: the behaviour byte, or null without a cell. */
export function behaviourAt(room: DistortionRoom, support: number | null, t: DwTile): number | null {
  const c = cellAt(room, support, t);
  return c === null ? null : c & CELL_BEHAVIOUR;
}

/**
 * DistWorld_AreCoordinatesValidOnCurrentFloatingPlatformKind → HasFloatingPlatformAtCoords with the current
 * support's kind. The decomp's test there is `kind != INVALID || kind == template kind`, so any support whose box
 * holds t answers, whatever its kind, while some support is current; with none current, nothing does.
 */
export function supportAt(room: DistortionRoom, support: number | null, t: DwTile): boolean {
  if (support === null) return false;
  return room.supports.some((s) => inBox(t, s.box));
}

/**
 * FindAndPrepareNewCurrentFloatingPlatform: the first support of `kind` whose box holds t (`land`: any kind), or
 * null (the decomp's index = count: none current).
 */
export function findSupport(room: DistortionRoom, t: DwTile, kind: Surface): number | null {
  const i = room.supports.findIndex((s) => inBox(t, s.box) && (kind === 'land' || s.kind === kind));
  return i < 0 ? null : i;
}

/** PLAYER_COLLISION_* bits a support step can raise (constants/player_avatar.h; avatar.ts `C`). */
export const DW_COLLISION = { WILL_COLLIDE: 1 << 0, OBJECT: 1 << 1, WATER: 1 << 5, JUMP_TWICE: 1 << 7 } as const;

/** TILE_BEHAVIOR_JUMP_<dir>_TWICE by the input direction that takes it. */
export const JUMP_TWICE: Record<Facing, string> = { up: 'JUMP_NORTH_TWICE', down: 'JUMP_SOUTH_TWICE', left: 'JUMP_WEST_TWICE', right: 'JUMP_EAST_TWICE' };

/** What a support step's collision asks of the world. */
export interface SupportCollisionHost {
  /** An object stands on (or is leaving) tile t, within a tile of its height (sub_02063F00). */
  occupied(t: DwTile): boolean;
  /** The `tileBehaviors` name of a cell's behaviour byte. */
  behaviour(byte: number): string;
  surfable(name: string): boolean;
}

/**
 * PlayerAvatar_CheckDistortionCollision for a step `dir` from tile `from` on `surface` with support `support`
 * current: the terrain cell (none, or its collision bit), an object, a surfable cell, and on a floor a
 * JUMP_<dir>_TWICE cell.
 */
export function supportCollision(room: DistortionRoom, support: number | null, surface: Surface, from: DwTile, dir: Facing, h: SupportCollisionHost): number {
  const t = stepFrom(surface, dir, from);
  let c = 0;
  if (blockedAt(room, support, t)) c |= DW_COLLISION.WILL_COLLIDE;
  if (h.occupied(t)) c |= DW_COLLISION.OBJECT;
  const byte = behaviourAt(room, support, t);
  // A missing cell reads as the null behaviour (GetNullTileBehaviorID): neither water nor a jump.
  const name = byte === null ? null : h.behaviour(byte);
  if (name !== null && h.surfable(name)) c |= DW_COLLISION.WATER;
  if (surface === 'floor' && name === JUMP_TWICE[dir]) c |= DW_COLLISION.JUMP_TWICE;
  return c;
}

/**
 * PlayerAvatar_SetMovement_DistortionFloor's support change: when the step collides for anything but a double
 * jump, and its tile has no cell on the current support but lies in some support's box (`supportAt`), the first
 * support of the current kind there becomes current (or none), and the collision is taken again. The change
 * stands whatever the second answer is.
 */
export function floorCollision(room: DistortionRoom, support: number | null, from: DwTile, dir: Facing, collide: (support: number | null) => number): { support: number | null; collision: number } {
  let collision = collide(support);
  if (collision & ~DW_COLLISION.JUMP_TWICE) {
    const t = stepFrom('floor', dir, from);
    if (cellAt(room, support, t) === null && supportAt(room, support, t)) {
      support = findSupport(room, t, surfaceOf(room, support));
      collision = collide(support);
    }
  }
  return { support, collision };
}
