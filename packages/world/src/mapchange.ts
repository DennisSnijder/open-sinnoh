import { hasFieldSystems, resetSeeker, type Id } from '@opensinnoh/core';
import type { GameState, Registries, Zone } from '@opensinnoh/contracts';
import { FLAG_STRENGTH_ACTIVE } from './avatar.ts';
import { roamersOnContinue, roamersOnWarp, roamersOnZoneConnection } from './roamers.ts';

/** Fixed system flags by number (decomp generated/vars_flags.txt). */
export const FLAG_FLASH_ACTIVE = 2426;
export const FLAG_DEFOG_ACTIVE = 2427;
export const FLAG_ON_CYCLING_ROAD = 2452;
export const FLAG_FORCE_BIKING_IN_GATE = 2454;
export const FLAG_SAFARI_GAME_ACTIVE = 2407;

const flagCache = new WeakMap<Registries['flags'], Map<number, Id>>();

/** The flag record with a fixed number (`sourceIndex`); a pack without it is a broken pack. */
export function flagId(reg: Registries, index: number): Id {
  let m = flagCache.get(reg.flags);
  if (!m) {
    m = new Map();
    for (const f of reg.flags.values()) if (f.sourceIndex !== undefined && !m.has(f.sourceIndex)) m.set(f.sourceIndex, f.id);
    flagCache.set(reg.flags, m);
  }
  const id = m.get(index);
  if (!id) throw new Error(`world: no flag with sourceIndex ${index}`);
  return id;
}

function clearFlag(reg: Registries, state: GameState, index: number): void {
  const id = flagId(reg, index);
  if (reg.flags.get(id)!.initial) state.flags[id] = false;
  else delete state.flags[id];
}

/**
 * TryUnlockFlyLocationByMap (decomp src/spawn_locations.c), from both map-change paths below: entering a town or
 * city sets its first-arrival flag (`Zone.firstArrival`), the Fly unlock that Rowan's lab and the Pokédex
 * rating also read. A loaded save does not run it (FieldTask_LoadSavedGameMap skips FieldMapChange_UpdateGameData).
 */
export function unlockFlyLocation(state: GameState, zone: Zone): void {
  if (zone.firstArrival) state.flags[zone.firstArrival] = true;
}

/** FieldSystem_InitFlagsOnMapChange (a zone connection into `zone`): Strength wears off; the fly location unlocks; the roamers move. */
export function onZoneConnection(reg: Registries, state: GameState, zone: Id): void {
  if (hasFieldSystems(reg)) resetSeeker(reg, state);
  clearFlag(reg, state, FLAG_STRENGTH_ACTIVE);
  unlockFlyLocation(state, reg.zones.get(zone)!);
  roamersOnZoneConnection(reg, state, zone);
}

/**
 * FieldSystem_InitFlagsWarp (decomp src/field_map_change_flags.c), run for the destination of every warp:
 * the gate's forced bike and the Cycling Road flag clear; Strength wears off; the fly location unlocks; Flash and Defog wear off unless the new map is a cave; surfing becomes walking, and
 * cycling becomes walking where the new map does not allow the bike; the roamers note the new zone.
 */
export function onWarp(reg: Registries, state: GameState, dest: Zone): void {
  if (hasFieldSystems(reg)) resetSeeker(reg, state);
  // SystemFlag_HandleForceBikingInGate(CLEAR), SystemFlag_ClearOnCyclingRoad: a gate's forced bike ends with it.
  clearFlag(reg, state, FLAG_FORCE_BIKING_IN_GATE);
  clearFlag(reg, state, FLAG_ON_CYCLING_ROAD);
  clearFlag(reg, state, FLAG_STRENGTH_ACTIVE);
  unlockFlyLocation(state, dest);
  roamersOnWarp(state, dest.id);
  if (dest.mapType !== 'cave') {
    clearFlag(reg, state, FLAG_FLASH_ACTIVE);
    clearFlag(reg, state, FLAG_DEFOG_ACTIVE);
  }
  if ((state.playerState === 'cycle' && !dest.flags.bike) || state.playerState === 'surf') state.playerState = 'walk';
}

/**
 * FieldSystem_SetFlyFlags and FieldSystem_SetTeleportFlags (decomp src/field_map_change_flags.c), after Fly's or
 * Teleport's map change: the Safari Game ends and every roamer moves to a random route
 * (RoamingPokemon_RandomizeAllLocations, as on CONTINUE).
 */
export function onFlyOrTeleport(reg: Registries, state: GameState): void {
  clearFlag(reg, state, FLAG_SAFARI_GAME_ACTIVE);
  roamersOnContinue(reg, state);
}

/** FieldSystem_SetEscapeFlags (decomp src/field_map_change_flags.c), after Dig's or an Escape Rope's map change: the Safari Game ends. */
export function onEscape(reg: Registries, state: GameState): void {
  clearFlag(reg, state, FLAG_SAFARI_GAME_ACTIVE);
}
