/**
 * The game clear (decomp src/clear_game.c, ScrCmd_ClearGame; docs/research/hall-of-fame-credits.md §2): the
 * `clear_game` op asks for the Hall of Fame's record screen and never resumes. The game then runs this task:
 * the initialization (before the record screen), the record screen, the save (the party healed, the entry
 * added, the save written), the credits, and the reset. A load of the clear's save puts the player in the
 * Twinleaf upstairs room (`continueAtStart`). Our Hall of Fame is part of the one save, so the main save and
 * the history are written together (the DS writes them as two blocks).
 */
import { addHallOfFameEntry, dexOf, newGameRecord, type GameState, type Registries } from '@opensinnoh/contracts';
import { heal, type ClockTime, type Id } from '@opensinnoh/core';
import { addToGameRecord } from '@opensinnoh/services';

/** Decomp RIBBON_SINNOH_CHAMP (generated/ribbons.txt). */
export const RIBBON_SINNOH_CHAMP = 32;
/** Decomp RECORD_TIMES_ENTERED_HALL_OF_FAME (generated/game_records.txt). */
const RECORD_TIMES_ENTERED_HALL_OF_FAME = 73;
/** Decomp sPlayerFirstRespawnLocation: Twinleaf Town (116, 886), facing down. */
const FIRST_RESPAWN = { zone: 'MAP_HEADER_TWINLEAF_TOWN', x: 116, z: 886, facing: 'down' } as const;
/**
 * The save screen's states 1–8 (FieldTask_DoClearGameSequence): the 8-frame fade in, the "saving" message,
 * the save, the result, SEQ_SE_DP_SAVE, the 18-frame wait, the 8-frame fade out. The save is written on
 * `SAVE_AT`, the sound plays on `SAVE_SE_AT`.
 */
export const SAVE_TICKS = 36;
const SAVE_AT = 9;
const SAVE_SE_AT = 10;

const nsOf = (registries: Registries) => newGameRecord(registries).id.slice(0, newGameRecord(registries).id.indexOf(':'));
const flagId = (registries: Registries, name: string) => {
  const id = `${nsOf(registries)}:${name}` as Id;
  if (!registries.flags.has(id)) throw new Error(`clear_game: the pack has no ${id}`);
  return id;
};
const flag = (registries: Registries, state: GameState, name: string) => {
  const id = flagId(registries, name);
  return state.flags[id] ?? registries.flags.get(id)!.initial;
};
const setFlag = (registries: Registries, state: GameState, name: string, value: boolean) => {
  const id = flagId(registries, name);
  if (value === registries.flags.get(id)!.initial) delete state.flags[id];
  else state.flags[id] = value;
};

/**
 * Decomp ClearGame's initialization, in order: the prior completion (whether the credits may be skipped), the
 * first completion's date, the Champion ribbons, the continue location (the new game's start: Twinleaf
 * upstairs) and the first respawn (Twinleaf), the Communication Club and completion flags, the record. The
 * trainer's main-story-cleared bit has no state here (nothing reads it yet).
 */
export function startClearGame(registries: Registries, state: GameState, clock: ClockTime): { skippable: boolean } {
  const skippable = flag(registries, state, 'FLAG_GAME_COMPLETED');
  if (!skippable) state.records.hallOfFame = clock.date;
  for (const mon of state.party) if (!mon.isEgg && !mon.ribbons.includes(RIBBON_SINNOH_CHAMP)) mon.ribbons = [...mon.ribbons, RIBBON_SINNOH_CHAMP].sort((a, b) => a - b);
  const start = newGameRecord(registries);
  state.specialLocation = { zone: start.zone, warp: -1, x: start.x, z: start.z, facing: start.facing };
  const town = `${nsOf(registries)}:${FIRST_RESPAWN.zone}` as Id;
  if (!registries.zones.has(town)) throw new Error(`clear_game: the pack has no ${town}`);
  state.escapeLocation = { zone: town, x: FIRST_RESPAWN.x, z: FIRST_RESPAWN.z, facing: FIRST_RESPAWN.facing };
  setFlag(registries, state, 'FLAG_COMMUNICATION_CLUB_ACCESSIBLE', true);
  setFlag(registries, state, 'FLAG_GAME_COMPLETED', true);
  addToGameRecord(state, registries, RECORD_TIMES_ENTERED_HALL_OF_FAME, 1);
  return { skippable };
}

/** Decomp FieldTask_DoClearGameSequence states 3–4 before the write: the party healed, the Hall of Fame entry added. */
export function clearGameSave(registries: Registries, state: GameState, clock: ClockTime): void {
  for (const mon of state.party) heal(dexOf(registries), mon);
  addHallOfFameEntry(state, clock.date);
}

/**
 * Decomp FieldTask_LoadSavedGameMap: a save with the Communication Club flag (the clear's) continues at the
 * special location, the flag cleared, the map's objects created afresh. Returns whether it did.
 */
export function continueAtStart(registries: Registries, state: GameState): boolean {
  // A pack without the flag (the fixture) has no clear, so no save carries it.
  if (!registries.flags.has(`${nsOf(registries)}:FLAG_COMMUNICATION_CLUB_ACCESSIBLE` as Id)) return false;
  if (!flag(registries, state, 'FLAG_COMMUNICATION_CLUB_ACCESSIBLE')) return false;
  const loc = state.specialLocation;
  if (!loc || loc.warp !== -1) throw new Error(`continue: the Communication Club flag is set without a special x/z location (${JSON.stringify(loc)})`);
  const zone = registries.zones.get(loc.zone);
  if (!zone) throw new Error(`continue: unknown zone ${loc.zone}`);
  setFlag(registries, state, 'FLAG_COMMUNICATION_CLUB_ACCESSIBLE', false);
  state.previousZone = state.player.zone;
  state.player = { zone: loc.zone, x: loc.x, z: loc.z, y: 0, facing: loc.facing };
  state.weather = zone.weather;
  state.objects = [];
  state.follower = null;
  state.partyFollower = null;
  state.playerState = 'walk';
  state.mapFeatures = null;
  return true;
}

/** Where the clear task is: the record screen, the save screen (`t` ticks in), the credits, or reset. */
export type ClearPhase = { phase: 'record' } | { phase: 'save'; t: number } | { phase: 'credits' } | { phase: 'reset' };

/** The save screen's tick: what happens on it. */
export function saveScreenStep(t: number): 'save' | 'se' | 'done' | null {
  if (t === SAVE_AT) return 'save';
  if (t === SAVE_SE_AT) return 'se';
  return t >= SAVE_TICKS ? 'done' : null;
}
