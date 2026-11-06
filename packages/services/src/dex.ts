/**
 * The Pokédex counts and completion rules (decomp pokedex.c) and the trainer card's stars (trainer_case.c).
 * Headless; the Pokédex itself is packages/menus pokedex.ts.
 */
import type { Id } from '@opensinnoh/core';
import type { GameState, Registries, Species } from '@opensinnoh/contracts';
import { dexNameOrder, gameLanguage, nameInitial } from './language.ts';

/**
 * The species of the Pokédex list in order: the regional dex (by `regionalDex`) or, once the national dex
 * is obtained, the national one (by `sourceIndex`, 1..; eggs and SPECIES_NONE have no number).
 */
export function dexList(registries: Registries, national: boolean): Species[] {
  const all = [...registries.species.values()];
  if (!national) return all.filter((s) => s.regionalDex !== undefined).sort((a, b) => a.regionalDex! - b.regionalDex!);
  return all.filter((s) => (s.sourceIndex ?? 0) > 0 && s.dex !== undefined).sort((a, b) => a.sourceIndex! - b.sourceIndex!);
}

/** Seen and caught counts of a list (the card and the list header count the shown dex, decomp Pokedex_CountSeen). */
export function dexCounts(state: GameState, list: readonly Species[]): { seen: number; caught: number } {
  const ids = new Set<Id>(list.map((s) => s.id));
  return { seen: state.pokedex.seen.filter((s) => ids.has(s)).length, caught: state.pokedex.caught.filter((s) => ids.has(s)).length };
}

/** Decomp sExcludedMonsNational by national number: Mew, Lugia, Ho-Oh, Celebi, Jirachi, Deoxys, Phione, Manaphy, Darkrai, Shaymin, Arceus. */
const EXCLUDED_NATIONAL = new Set([151, 249, 250, 251, 385, 386, 489, 490, 491, 492, 493]);

/** Decomp Pokedex_NumCaught_National: caught species that count for completion (not the mythicals of `EXCLUDED_NATIONAL`). */
export function nationalCaughtCount(state: GameState, registries: Registries): number {
  return state.pokedex.caught.filter((id) => {
    const n = registries.species.get(id)?.sourceIndex;
    return n !== undefined && n > 0 && !EXCLUDED_NATIONAL.has(n);
  }).length;
}

/** Decomp NATIONAL_DEX_GOAL: the national dex (`dexList`) less the excluded mythicals (493 − 11 = 482 on Platinum). */
export function nationalDexGoal(registries: Registries): number {
  return dexList(registries, true).filter((s) => !EXCLUDED_NATIONAL.has(s.sourceIndex!)).length;
}

/** Decomp Pokedex_NumSeen_Local: seen species with a Sinnoh number (no local exclusions). */
export function localSeenCount(state: GameState, registries: Registries): number {
  return state.pokedex.seen.filter((id) => registries.species.get(id)?.regionalDex !== undefined).length;
}

/** Decomp LOCAL_DEX_GOAL: the Sinnoh dex (210 on Platinum; NUM_EXCLUDED_LOCAL is 0). */
export function localDexGoal(registries: Registries): number {
  return dexList(registries, false).length;
}

/** Decomp Pokedex_LocalDexCompleted: every Sinnoh species seen. */
export function localDexCompleted(state: GameState, registries: Registries): boolean {
  return localSeenCount(state, registries) >= localDexGoal(registries);
}

/** Decomp Pokedex_NationalDexCompleted: every national species but the mythicals caught. */
export function nationalDexCompleted(state: GameState, registries: Registries): boolean {
  return nationalCaughtCount(state, registries) >= nationalDexGoal(registries);
}

/** Fixed flags by number (generated/vars_flags.txt): FLAG_GAME_COMPLETED, FLAG_CONTEST_MASTER_COOL … _TOUGH. */
const FLAG_GAME_COMPLETED = 2404;
const FLAG_CONTEST_MASTERS = [2408, 2409, 2410, 2411, 2412];

/** A fixed system flag by its decomp number (`flags` sourceIndex); throws when the packs lack it. */
export function systemFlag(state: GameState, registries: Registries, sourceIndex: number): boolean {
  const flag = [...registries.flags.values()].find((f) => f.sourceIndex === sourceIndex);
  if (!flag) throw new Error(`no flag with sourceIndex ${sourceIndex}`);
  return state.flags[flag.id] ?? flag.initial;
}

/**
 * Decomp TrainerCase_CalculateTrainerCardLevel (the card's stars and colour, 0–5): one each for the game
 * completed, the national dex completed, a Battle Tower streak of 100, any contest master rank and the
 * Underground platinum base flag. The Battle Tower record and the Underground are not tracked (always 0).
 */
export function cardStars(state: GameState, registries: Registries): number {
  let stars = 0;
  if (systemFlag(state, registries, FLAG_GAME_COMPLETED)) stars++;
  if (nationalDexCompleted(state, registries)) stars++;
  if (FLAG_CONTEST_MASTERS.some((f) => systemFlag(state, registries, f))) stars++;
  return stars;
}

/** The nine name groups of the A–Z lists (decomp zukan_data members 18–26: ABC … YZ). */
export const NAME_GROUP_LETTERS = ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQR', 'STU', 'VWX', 'YZ'] as const;

/**
 * A name group's species, A–Z (decomp zukan_data members 18–26, which the Battle Hall's record list reads): the
 * national list whose names start with the group's letters (`nameInitial`), in the game language's A–Z order
 * (`dexNameOrder`), ties by number.
 */
export function nameGroupSpecies(registries: Registries, group: number): Species[] {
  const letters = NAME_GROUP_LETTERS[group];
  if (!letters) throw new Error(`dex: name group ${group}`);
  const order = dexNameOrder(gameLanguage(registries));
  return dexList(registries, true)
    .filter((s) => letters.includes(nameInitial(s.name)))
    .sort((a, b) => order(a.name, b.name) || a.sourceIndex! - b.sourceIndex!);
}
