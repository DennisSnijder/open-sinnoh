/**
 * The special encounters' rules (decomp SpecialEncounter, special_encounter.c; overlay005/honey_tree.c;
 * pokeradar.c; overlay006/swarm.c and trophy_garden_daily_encounters.c; pokemon.c Party_UpdatePokerusStatus).
 * Game-agnostic: the pack supplies the tables (contracts `NewGame.honeyTrees`, `swarms`, `trophyGarden`). Behavioural
 * references only; an independent implementation. `rand(n)` is the caller's stream (LCRNG_RandMod's role): an
 * integer in [0, n).
 */
import type { Id } from './ids.ts';
import { Prng } from './prng.ts';
import type { Pokemon, Rng } from './pokemon.ts';

/** Decomp NUM_HONEY_TREES. */
export const HONEY_TREES = 21;
/** HoneyTree_SlatherTree: a slathering lasts a day. */
export const HONEY_SLATHER_MINUTES = 24 * 60;
/** Decomp TREE_STATUS_BARE, _SLATHERED, _ENCOUNTER (constants/honey_tree.h). */
export const TREE_STATUS = { bare: 1, slathered: 2, encounter: 3 } as const;
/** Decomp NUM_RADAR_RECORDS, RADAR_BATTERY_STEPS, the chain's cap (IncWithCap). */
export const RADAR_RECORDS = 3;
export const RADAR_BATTERY_STEPS = 50;
export const RADAR_CHAIN_MAX = 999;
/** Decomp NUM_SWARMS (sSwarmMapIdTable). */
export const SWARMS = 22;

/** One honey tree (decomp HoneyTree): minutes left of the slathering, the slot, the table, the group (0 none, 1 A, 2 B, 3 C), the shakes. */
export interface HoneyTreeState {
  minutes: number;
  slot: number;
  table: number;
  group: number;
  shakes: number;
}

/** A Poké Radar chain record (decomp RadarChainRecord): the species and its chain. */
export interface RadarRecord {
  species: Id | null;
  count: number;
}

/**
 * The saved special encounters (decomp SpecialEncounter, without the marsh and swarm dailies, which live with the
 * clock, and the roamers, which have their own block): the honey trees and the last one slathered (21: none), the
 * Poké Radar's charge and best chains, whether swarms are on, and the Trophy Garden's two slots (indexes into
 * `NewGame.trophyGarden.species`; null = TROPHY_GARDEN_SLOT_NONE).
 */
export interface SpecialEncounterState {
  honeyTrees: HoneyTreeState[];
  lastHoneyTree: number;
  radarCharge: number;
  radarRecords: RadarRecord[];
  swarms: boolean;
  trophyGarden: [number | null, number | null];
}

/** SpecialEncounter_Init (the dailies apart). */
export function newSpecialEncounters(): SpecialEncounterState {
  return {
    honeyTrees: Array.from({ length: HONEY_TREES }, () => ({ minutes: 0, slot: 0, table: 0, group: 0, shakes: 0 })),
    lastHoneyTree: HONEY_TREES,
    radarCharge: 0,
    radarRecords: Array.from({ length: RADAR_RECORDS }, () => ({ species: null, count: 0 })),
    swarms: false,
    trophyGarden: [null, null],
  };
}

/** The state's block to read: a new game's when absent (nothing is written). */
export function readSpecialEncounters(s: { encounters?: SpecialEncounterState }): SpecialEncounterState {
  return s.encounters ?? newSpecialEncounters();
}

/** The state's block, created as a new game has it the first time a system writes it (absent in older saves). */
export function specialEncounters(s: { encounters?: SpecialEncounterState }): SpecialEncounterState {
  return (s.encounters ??= newSpecialEncounters());
}

// ---------------------------------------------------------------- honey trees

/** SixHoursSinceSlathered: from 6 hours after the slathering to just before 24. */
export const honeyTreeReady = (minutes: number): boolean => minutes > 0 && minutes <= 18 * 60;

/** HoneyTree_GetTreeSlatherStatus. */
export function honeyTreeStatus(tree: HoneyTreeState): number {
  if (honeyTreeReady(tree.minutes)) return TREE_STATUS.encounter;
  return tree.minutes !== 0 ? TREE_STATUS.slathered : TREE_STATUS.bare;
}

/** GetShakingValue while the tree is ready: animation 0, 1 or 2 for 1, 2 or 3 shakes; null for none (or not ready). */
export function honeyTreeShake(tree: HoneyTreeState): number | null {
  if (!honeyTreeReady(tree.minutes) || tree.shakes < 1 || tree.shakes > 3) return null;
  return tree.shakes - 1;
}

/**
 * IsMunchlaxTree: the trainer id's four bytes (high to low, all 32 bits) modulo 21, each later one moved on past an
 * equal earlier one in a single forward pass (so duplicates can remain, as on the DS).
 */
export function munchlaxTrees(trainerId: number): number[] {
  const ids = [24, 16, 8, 0].map((shift) => ((trainerId >>> shift) & 0xff) % HONEY_TREES);
  for (let i = 1; i < 4; i++) {
    for (let j = 0; j < i; j++) {
      if (ids[j] === ids[i]) ids[i] = (ids[i]! + 1) % HONEY_TREES;
    }
  }
  return ids;
}

/** GetTreeEncounterGroup: Munchlax trees 1/9/20/70 (C, none, A, B), the others 10/20/70 (none, B, A). */
function treeGroup(munchlax: boolean, rand: (n: number) => number): number {
  const roll = rand(100);
  if (munchlax) return roll < 1 ? 3 : roll < 10 ? 0 : roll < 30 ? 1 : 2;
  return roll < 10 ? 0 : roll < 30 ? 2 : 1;
}

/** GetTreeEncounterSlot: 40/20/20/10/5/5. */
function treeSlot(rand: (n: number) => number): number {
  const roll = rand(100);
  return roll < 5 ? 5 : roll < 10 ? 4 : roll < 20 ? 3 : roll < 40 ? 2 : roll < 60 ? 1 : 0;
}

/** GetShakesFromGroup. */
function treeShakes(group: number, rand: (n: number) => number): number {
  const roll = rand(100);
  if (group === 3) return roll < 5 ? 2 : roll < 6 ? 1 : roll < 7 ? 0 : 3;
  if (group === 2) return roll < 75 ? 2 : roll < 95 ? 1 : roll < 96 ? 0 : 3;
  if (group === 1) return roll < 19 ? 2 : roll < 79 ? 1 : roll < 99 ? 0 : 3;
  return roll < 1 ? 2 : roll < 19 ? 1 : roll < 99 ? 0 : 3;
}

/**
 * HoneyTree_SlatherTree: a day of honey. The tree slathered last keeps its group 90% of the time (a new slot and
 * shakes, the last tree unchanged); otherwise a new group (none clears the timer at once), slot, table and shakes.
 */
export function slatherHoneyTree(enc: SpecialEncounterState, id: number, trainerId: number, rand: (n: number) => number): void {
  const tree = enc.honeyTrees[id];
  if (!tree) throw new Error(`honey tree ${id}: no such tree`);
  tree.minutes = HONEY_SLATHER_MINUTES;
  const munchlax = munchlaxTrees(trainerId).includes(id);
  if (enc.lastHoneyTree === id && rand(100) < 90) {
    tree.slot = treeSlot(rand);
    tree.shakes = treeShakes(tree.group, rand);
    return;
  }
  tree.group = treeGroup(munchlax, rand);
  if (tree.group !== 0) {
    tree.slot = treeSlot(rand);
    // GetEncounterTableFromGroup: effectively group - 1.
    tree.table = tree.group - 1;
  } else {
    tree.table = 0;
    tree.slot = 0;
    tree.minutes = 0;
  }
  tree.shakes = treeShakes(tree.group, rand);
  enc.lastHoneyTree = id;
}

/** HoneyTree_GetSpecies: the tree's table (encdata_ex 2, 3, 4) at its slot. */
export function honeyTreeSpecies(tables: readonly (readonly Id[])[], tree: HoneyTreeState): Id {
  const species = tables[tree.table]?.[tree.slot];
  if (!species) throw new Error(`honey tree: no species in table ${tree.table} slot ${tree.slot}`);
  return species;
}

/** SpecialEncounter_DecrementHoneyTreeTimers: every slathered tree counts down, stopping at 0. */
export function elapseHoneyTrees(enc: SpecialEncounterState, minutes: number): void {
  for (const tree of enc.honeyTrees) if (tree.minutes !== 0) tree.minutes = Math.max(0, tree.minutes - minutes);
}

/** CreateWildMon_HoneyTree's level: 5–15 (Hustle, Vital Spirit or Pressure in the lead: 15 half the time). */
export function honeyTreeLevel(leadAbility: string | null, rand: (n: number) => number): number {
  let level = 5 + rand(15 - 5 + 1);
  if (leadAbility === 'HUSTLE' || leadAbility === 'VITAL_SPIRIT' || leadAbility === 'PRESSURE') {
    if (rand(2) !== 0) level = 15;
  }
  return level;
}

// ---------------------------------------------------------------- Poké Radar

/** CheckPatchContinueChain: by ring (outer to inner), after a defeat or a capture. */
const RADAR_CONTINUE = { won: [88, 68, 48, 28], caught: [98, 78, 58, 38] } as const;
export function radarPatchContinues(ring: number, result: 'won' | 'caught', rand: (n: number) => number): boolean {
  const rate = RADAR_CONTINUE[result][ring];
  if (rate === undefined) throw new Error(`radar: no ring ${ring}`);
  return rand(100) < rate;
}

/** CheckPatchShiny: none at 0, else 1 in max(200, 8200 − 200·count). */
export function radarShinyRate(count: number): number | null {
  return count === 0 ? null : Math.max(200, 8200 - count * 200);
}
export function radarPatchShiny(count: number, rand: (n: number) => number): boolean {
  const rate = radarShinyRate(count);
  return rate !== null && rand(rate) === 0;
}

/** GetLowestChainRecordSlot: the first empty record, else the lowest (later slots win ties against slot 0 or 1 as the DS compares). */
export function radarRecordSlot(records: readonly RadarRecord[]): number {
  const empty = records.findIndex((r) => r.species === null);
  if (empty >= 0) return empty;
  let slot = records[0]!.count < records[1]!.count ? 0 : 1;
  if (!(records[slot]!.count < records[2]!.count)) slot = 2;
  return slot;
}

/** RadarChainRecords_SortSavedRecords: highest chain first; the sort is stable. */
function sortRecords(records: RadarRecord[]): void {
  records.sort((a, b) => b.count - a.count);
}

/**
 * TryReplaceLowestChainRecord: the chain's record slot takes the chain when it beats it; after sorting, the slot is
 * found again (the last record with the chain's count). Returns the slot to keep for the chain.
 */
export function radarRecordChain(records: RadarRecord[], slot: number, species: Id, count: number): number {
  const record = records[slot];
  if (!record) throw new Error(`radar: no record slot ${slot}`);
  if (!(record.count < count)) return slot;
  record.count = count;
  record.species = species;
  sortRecords(records);
  if (records[slot]!.count <= count) {
    for (let i = RADAR_RECORDS - 1; i >= 0; i--) if (records[i]!.count === count) return i;
    throw new Error('radar: the chain is in no record after sorting');
  }
  return slot;
}

// ---------------------------------------------------------------- swarms and the Trophy Garden

/** The swarm daily's own seed stream, so its new-game value takes no draw from another stream. */
const swarmSeed = (seed: number): number => (seed ^ 0x5357524d) >>> 0;
/** SpecialEncounter swarmDaily: random at a new game (a draw from the game seed's own stream), then the day's RecordMixedRNG value. */
export function swarmDailyOf(s: { seed: number; gameTime: { swarmDaily?: number } }): number {
  return s.gameTime.swarmDaily ?? new Prng(swarmSeed(s.seed)).next() >>> 0;
}
/** Swarm_GetMapId's index: swarmDaily % NUM_SWARMS (the daily as the u32 it is). */
export const swarmIndex = (daily: number): number => (daily >>> 0) % SWARMS;

/**
 * TrophyGarden_AddNewMon: a new species index, unlike the two in the slots (by species), goes in slot 1 and slot 1's
 * moves to slot 2.
 */
export function addTrophyGardenMon(enc: SpecialEncounterState, species: readonly Id[], rand: (n: number) => number): void {
  const current = enc.trophyGarden.map((i) => (i === null ? null : species[i]!));
  for (;;) {
    const index = rand(species.length);
    if (current[0] !== species[index] && current[1] !== species[index]) {
      enc.trophyGarden = [index, enc.trophyGarden[0]];
      return;
    }
  }
}

// ---------------------------------------------------------------- Pokérus

/**
 * Party_UpdatePokerusStatus: each infected Pokémon's days count down by the days passed; more days than are left, or
 * more than 4, end it (strain kept: cured). A zero byte becomes 0x10.
 */
export function elapsePokerus(party: Pokemon[], days: number): void {
  for (const mon of party) {
    let p = mon.pokerus;
    if (!(p & 0xf)) continue;
    if ((p & 0xf) < days || days > 4) p &= 0xf0;
    else p -= days;
    mon.pokerus = p === 0 ? 0x10 : p;
  }
}

/** Pokemon_FindShinyPersonality: a PID that is shiny with this OT id (the low 3 bits of each half at random). */
export function shinyPid(otId: number, rng: Rng): number {
  const id = (((otId >>> 16) ^ (otId & 0xffff)) >>> 3) & 0x1fff;
  let low = rng.next() & 7;
  let high = rng.next() & 7;
  for (let i = 0; i < 13; i++) {
    const bit = 1 << (i + 3);
    if (id & (1 << i)) {
      if (rng.next() & 1) low |= bit;
      else high |= bit;
    } else if (rng.next() & 1) {
      low |= bit;
      high |= bit;
    }
  }
  return ((high << 16) | low) >>> 0;
}
