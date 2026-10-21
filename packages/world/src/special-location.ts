import type { Facing, GameState, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/**
 * The special location (decomp FieldOverworldState special location, src/field_map_change.c and
 * src/overlay005/field_control.c):
 * - A warp event to MAP_HEADER_DYNAMIC (dest warp 0x100; `toZone: 'dynamic'`) leads to the special
 *   location (Field_MapConnection).
 * - Every warp event that fires records the entrance: the zone, the warp's index, the tile and facing.
 * - Arriving at a warp whose own target is dynamic copies the entrance into the special location
 *   (FieldMapChange_SetNewLocation), so that warp leads back where the player came from (elevators).
 * - `set_special_location` (ScrCmd_SetSpecialLocation) writes it directly (elevator floors).
 */
export type Location = NonNullable<GameState['specialLocation']>;

/** The zone and tile a warp to the special location arrives at; `warp` is the arrival warp index or -1. */
export function specialDestination(reg: Registries, loc: GameState['specialLocation']): { zone: Id; x: number; z: number; warp: number } {
  if (!loc) throw new Error('world: a dynamic warp fired but no special location is set');
  if (loc.warp < 0) return { zone: loc.zone, x: loc.x, z: loc.z, warp: -1 };
  const zone = reg.zones.get(loc.zone);
  if (!zone) throw new Error(`world: special location names unknown zone ${loc.zone}`);
  const w = zone.events.warps[loc.warp];
  if (!w) throw new Error(`world: special location ${loc.zone} has no warp ${loc.warp}`);
  return { zone: loc.zone, x: w.x, z: w.z, warp: loc.warp };
}

export function entrance(zone: Id, warp: number, x: number, z: number, facing: Facing): Location {
  return { zone, warp, x, z, facing };
}
