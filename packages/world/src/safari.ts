/**
 * The Safari Game's field rules (decomp field_control.c Field_UpdateSafari, wild_encounters.c CreateWildSingleBattle
 * and WildEncounters_ReplaceGreatMarshDailyEncounters, great_marsh_daily_encounters.c, encounter.c
 * FieldTask_SafariEncounter). The game itself is FLAG_SAFARI_GAME_ACTIVE and `GameState.safari`, written by the
 * script op `start_end_safari_game`; the tables come from `NewGame.greatMarsh`.
 */
import { marshDailyOf, type Id } from '@opensinnoh/core';
import { tvSafariCatch, firstFreeBox, newGameRecord, type BattleResult, type EncounterTable, type GameState, type GreatMarshTables, type Registries } from '@opensinnoh/contracts';

/** Decomp ScrCmd_StartEndSafariGame: the balls a game starts with. */
export const SAFARI_BALLS = 30;
/** Decomp Field_UpdateSafari: the game ends at this many steps. */
export const SAFARI_STEPS = 500;
/** Decomp ReplaceGreatMarshDailyEncounters: the land slots the daily species take. */
const DAILY_SLOTS = [6, 7];

export function greatMarsh(reg: Registries): GreatMarshTables | null {
  return newGameRecord(reg).greatMarsh ?? null;
}

/** SystemFlag_CheckSafariGameActive (false in packs without a Great Marsh). */
export function safariActive(reg: Registries, state: GameState): boolean {
  const g = greatMarsh(reg);
  if (!g) return false;
  const on = state.flags[g.flag] ?? reg.flags.get(g.flag)?.initial ?? false;
  if (on && !state.safari) throw new Error('safari: FLAG_SAFARI_GAME_ACTIVE is set but no Safari Game was started (GameState.safari)');
  return on;
}

/**
 * ReplaceGreatMarshDailyEncounters: the area's daily species (both slots take the same one): entry
 * `(marshDaily >> 5·area) & 31` of the National Pokédex table once it is obtained, else of the regional one.
 */
export function dailyMarshSpecies(g: GreatMarshTables, state: Pick<GameState, 'seed' | 'gameTime' | 'pokedex'>, zone: Id): Id {
  const area = g.zones.indexOf(zone);
  if (area < 0) throw new Error(`safari: ${zone} is not a Great Marsh area (GreatMarsh_GetAreaNumFromMapId)`);
  const index = (marshDailyOf(state) >>> (5 * area)) & 0x1f;
  return (state.pokedex.national ? g.daily.national : g.daily.regional)[index]!;
}

/** The zone's table as a Safari Game rolls it: land slots 6 and 7 replaced by the area's daily species. */
export function safariEncounterTable(reg: Registries, state: GameState, table: EncounterTable, zone: Id): EncounterTable {
  if (!safariActive(reg, state)) return table;
  const species = dailyMarshSpecies(greatMarsh(reg)!, state, zone);
  return { ...table, land: table.land.map((slot, i) => (DAILY_SLOTS.includes(i) ? { ...slot, species } : slot)) };
}

/**
 * Field_UpdateSafari, on a step (after the Pokétch pedometer, before the daycare): no balls left starts the
 * out-of-balls script; else the step counts and the 500th starts the out-of-steps script. Returns the label to run.
 */
export function safariStep(reg: Registries, state: GameState): Id | null {
  if (!safariActive(reg, state)) return null;
  const g = greatMarsh(reg)!;
  const s = state.safari!;
  if (s.balls === 0) return g.labels.outOfBalls;
  s.steps = Math.min(0xffff, s.steps + 1);
  return s.steps >= SAFARI_STEPS ? g.labels.outOfSteps : null;
}

/**
 * FieldTask_SafariEncounter after the battle: the balls left come back (UpdateFieldSystemFromDTO), a catch counts
 * (TVBroadcast_UpdateSafariGameData). Then, out of balls without a catch: back to the special location (the gate) and
 * SAFARI_GAME 9; out of balls after a catch: SAFARI_GAME 2 (its message, then the warp); balls left but the party and
 * every box full: SAFARI_GAME 22. Returns whether to warp to the special location and the script to run (after it).
 */
export function afterSafariBattle(reg: Registries, state: GameState, result: BattleResult): { warp: boolean; label: Id | null } {
  const g = greatMarsh(reg);
  if (!g || !state.safari || result.safariBalls === undefined) throw new Error('safari: a Safari battle ended outside a Safari Game');
  const s = state.safari;
  s.balls = result.safariBalls;
  if (result.outcome === 'caught') {
    tvSafariCatch(state, result.caught!.mon.species, s.caught);
    s.caught = Math.min(0xffff, s.caught + 1);
  }
  if (s.balls === 0) return result.outcome === 'caught' ? { warp: false, label: g.labels.outOfBalls } : { warp: true, label: g.labels.outOfBallsBattle };
  if (firstFreeBox(state) === null && state.party.length >= 6) return { warp: false, label: g.labels.noRoom };
  return { warp: false, label: null };
}
