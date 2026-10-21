import type { Id } from '@opensinnoh/core';
import type { Chunk, Facing, Matrix, Registries, TileBehavior } from '@opensinnoh/contracts';
import { terrainHeight } from './terrain.ts';

export const TILE = 16;
export const CHUNK_TILES = 32;
export const CHUNK_SIZE = TILE * CHUNK_TILES;

export const tileCentre = (t: number) => t * TILE + TILE / 2;

// Tile behaviours by `tileBehaviors` name (decomp include/constants/field/map_tile_behaviors.h without TILE_BEHAVIOR_).
/** Stairs (WARP_STAIRS_EAST/WEST): the side the stairs are on, pushed to take them. */
export const BEHAVIOUR_STAIRS: Partial<Record<string, Facing>> = { WARP_STAIRS_EAST: 'right', WARP_STAIRS_WEST: 'left' };
/** Step-on warps that set the arrival facing north (decomp Field_CheckTransition). */
export const BEHAVIOUR_WARP_NORTH = new Set(['WARP_ENTRANCE_NORTH', 'WARP_NORTH']);
/** Warp tiles that fire when pushed in their direction, not when stepped on (decomp Field_CheckMapTransition). */
export const BEHAVIOUR_PUSH_WARP: Partial<Record<string, Facing>> = {
  WARP_ENTRANCE_EAST: 'right',
  WARP_ENTRANCE_WEST: 'left',
  WARP_ENTRANCE_SOUTH: 'down',
  WARP_EAST: 'right',
  WARP_WEST: 'left',
  WARP_SOUTH: 'down',
  ...BEHAVIOUR_STAIRS,
};

const namesCache = new WeakMap<Registries['tileBehaviors'], Map<number, string>>();
function behaviourNames(reg: Registries): Map<number, string> {
  let m = namesCache.get(reg.tileBehaviors);
  if (!m) {
    m = new Map([...reg.tileBehaviors.values()].map((b) => [b.sourceIndex, b.name]));
    namesCache.set(reg.tileBehaviors, m);
  }
  return m;
}

/** The `tileBehaviors` name of a behaviour byte (a missing record fails loudly). */
export function behaviourName(reg: Registries, byte: number): string {
  const name = behaviourNames(reg).get(byte);
  if (name === undefined) throw new Error(`world: tile behaviour 0x${byte.toString(16)} has no tileBehaviors record`);
  return name;
}

/**
 * Where a matrix sits in its zone's tile space (contracts `DistortionRoom.offset`; decomp
 * LandDataManager_DistortionWorldSetOffsets): x/z in tiles, y in world units. Zero for ordinary zones.
 */
export interface GridOffset {
  x: number;
  y: number;
  z: number;
}

const NO_OFFSET: GridOffset = { x: 0, y: 0, z: 0 };

/** The grid offset of a zone: its Distortion World room's, else none. */
export function gridOffset(reg: Registries, zone: Id): GridOffset {
  const room = reg.distortionRooms.get(zone);
  return room ? { x: room.offset.x, y: room.offset.altitude * TILE, z: room.offset.z } : NO_OFFSET;
}

/**
 * Tile queries on one matrix: collision, behaviour byte, terrain height. Tile and world coordinates are the
 * zone's: with an `offset` (a Distortion World room) the matrix starts at that tile and its land is raised by
 * `offset.y` units (decomp TerrainCollisionManager GetHeight and GetTileAttributes).
 */
export class MapGrid {
  private readonly names: Map<number, string>;

  constructor(
    private readonly reg: Registries,
    readonly matrix: Matrix,
    readonly offset: GridOffset = NO_OFFSET,
  ) {
    this.names = behaviourNames(reg);
  }

  private chunk(id: Id): Chunk {
    const c = this.reg.chunks.get(id);
    if (!c) throw new Error(`world: missing chunks record ${id}`);
    return c;
  }

  /** Matrix cell index of a tile, or null outside the matrix. */
  cell(tx: number, tz: number): number | null {
    const m = this.matrix;
    tx -= this.offset.x;
    tz -= this.offset.z;
    if (tx < 0 || tz < 0 || tx >= m.width * CHUNK_TILES || tz >= m.height * CHUNK_TILES) return null;
    return Math.floor(tx / CHUNK_TILES) + Math.floor(tz / CHUNK_TILES) * m.width;
  }

  chunkAt(tx: number, tz: number): { chunk: Chunk; cell: number } | null {
    const cell = this.cell(tx, tz);
    if (cell === null) return null;
    const id = this.matrix.chunks[cell];
    return id ? { chunk: this.chunk(id), cell } : null;
  }

  tile(tx: number, tz: number): number | null {
    const c = this.chunkAt(tx, tz);
    return c ? c.chunk.tiles[((tx - this.offset.x) % CHUNK_TILES) + ((tz - this.offset.z) % CHUNK_TILES) * CHUNK_TILES]! : null;
  }

  /** The tile's behaviour name (`tileBehaviors` record by byte); outside the matrix = NONE. */
  behaviour(tx: number, tz: number): string {
    const byte = (this.tile(tx, tz) ?? 0) & 0xff;
    const name = this.names.get(byte);
    if (name === undefined) throw new Error(`world: tile behaviour 0x${byte.toString(16)} at ${tx},${tz} has no tileBehaviors record`);
    return name;
  }

  /** The A-press script of the tile's behaviour, if it has one. */
  interaction(tx: number, tz: number): TileBehavior['interact'] | undefined {
    const name = this.behaviour(tx, tz);
    for (const b of this.reg.tileBehaviors.values()) if (b.name === name) return b.interact;
    return undefined;
  }

  blocked(tx: number, tz: number): boolean {
    const t = this.tile(tx, tz);
    return t === null || (t & 0x8000) !== 0;
  }

  /** Height at a world position (x, z in world units). */
  heightAt(wx: number, wz: number, current: number): number {
    return this.terrainHeight(wx, wz, current) ?? current;
  }

  /** The BDHC height at a world point, or null where no plate is (decomp CalculateObjectHeight's FALSE). */
  terrainHeight(wx: number, wz: number, current: number): number | null {
    const c = this.chunkAt(Math.floor(wx / TILE), Math.floor(wz / TILE));
    if (!c) return null;
    const mx = c.cell % this.matrix.width;
    const mz = Math.floor(c.cell / this.matrix.width);
    const altitude = (this.matrix.altitudes?.[c.cell] ?? 0) * 8 + this.offset.y;
    const ox = this.offset.x * TILE;
    const oz = this.offset.z * TILE;
    const y = terrainHeight(c.chunk.terrain, wx - ox - (mx * CHUNK_SIZE + CHUNK_SIZE / 2), wz - oz - (mz * CHUNK_SIZE + CHUNK_SIZE / 2), current - altitude);
    return y === null ? null : y + altitude;
  }
}
