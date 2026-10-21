import { Prng, type DayPeriod, type Id, type PrngState } from '@opensinnoh/core';
import type { EncounterTable } from '@opensinnoh/contracts';
import { isSurfable } from './behaviours.ts';

/**
 * Wild encounter step check (decomp src/overlay006/wild_encounters.c, WildEncounters_TryWildEncounter).
 * Rolls come from `GameState.encounterRng` only (the DS uses its global LCRNG), so encounters never shift
 * other randomness. Not modelled: abilities, flutes, held items, special dates (Repel, roamers, swarms, the Trophy
 * Garden and the Poké Radar are the world's).
 */

/**
 * Behaviours with the encounter flag (TileBehavior_HasEncounters, sTileBehaviorFlags); the surfable ones
 * roll the surf table (GetTileEncounterRateAndType).
 */
export const ENCOUNTER_BEHAVIOURS = new Set([
  'WATER_RIVER',
  'UNUSED_x11',
  'UNUSED_x12',
  'WATER_SEA',
  'UNUSED_x22',
  'UNUSED_x2A',
  'UNUSED_x05',
  'UNUSED_x06',
  'UNUSED_x24',
  'UNUSED_x25',
  'TALL_GRASS',
  'VERY_TALL_GRASS',
  'CAVE_FLOOR',
  'OLD_CHATEAU_FLOOR',
  'BRIDGE_OVER_CAVE',
  'BIKE_BRIDGE_N_S_OVER_ENCS',
  'BIKE_BRIDGE_E_W_OVER_ENCS',
  'MUD_WITH_GRASS',
  'MUD_DEEP_WITH_GRASS',
]);

/** Cumulative land slot thresholds out of 100 (GetGroundEncounterSlot: 20,20,10,10,10,10,5,5,4,4,1,1). */
const LAND_SLOT_LIMITS = [20, 40, 50, 60, 70, 80, 85, 90, 94, 98, 99, 100];
/** Cumulative surf slot thresholds (GetWaterEncounterSlot: 60,30,5,4,1). */
const WATER_SLOT_LIMITS = [60, 90, 95, 99, 100];

export interface WildRoll {
  species: Id;
  level: number;
  /** A Poké Radar shiny patch's Pokémon (contracts `WildSpec.shiny`). */
  shiny?: true;
}

/**
 * One step on an encounter tile. `attempts` is the DS's encounterAttempts (grace period: while it is
 * below 8 − rate/10, each step counts up and passes only 5% of the time); it resets on a battle and on
 * every map or zone change. On water the surf table is rolled: its slot, then a level between the slot's
 * minimum and maximum (GetWildMonLevel). Cycling raises the flat gate like very tall grass. Land slots 2–3
 * follow the clock's period (`landSlot`). Returns the wild Pokémon, or null.
 *
 * `partner` (the has-partner flag): a land encounter rolls a second slot for the second wild Pokémon of a
 * double with the AI partner (decomp TryGenerateGrassEncounter_DoubleBattle: TryGenerateWildMon for battler 1,
 * then 3). On water the DS generates one (TryGenerateSurfEncounter): `second` stays null.
 */
export function rollWildEncounter(
  table: EncounterTable,
  behaviour: string,
  rng: PrngState,
  attempts: { count: number },
  cycling: boolean,
  period: DayPeriod,
  partner = false,
): { roll: WildRoll | null; second: WildRoll | null; rng: PrngState } {
  const prng = Prng.from(rng);
  const done = (roll: WildRoll | null, second: WildRoll | null = null) => ({ roll, second, rng: prng.save() });
  if (!encounterGate(table, behaviour, prng, attempts, cycling)) return done(null);
  const { roll, second } = encounterSlots(table, behaviour, prng, attempts, period, partner);
  return done(roll, second);
}

/**
 * GetTileEncounterRateAndType and ShouldGetRandomEncounter: null when the tile's table has no rate (no encounter, no
 * Poké Radar patch either), else whether the step passes the grace period, the flat gate (40, +30 in very tall grass
 * or cycling) and the rate.
 */
export function encounterGate(table: EncounterTable, behaviour: string, prng: Prng, attempts: { count: number }, cycling: boolean): boolean | null {
  const rate = tileEncounterRate(table, behaviour);
  if (rate === 0) return null;
  if (attempts.count < 8 - Math.min(8, Math.floor(rate / 10))) {
    attempts.count++;
    if (prng.below(100) >= 5) return false;
  }
  const gate = behaviour === 'VERY_TALL_GRASS' || cycling ? 70 : 40;
  if (prng.below(100) >= gate) return false;
  return prng.below(100) < rate;
}

/** GetTileEncounterRateAndType: the table's rate for this tile (water or land), 0 when it has none. */
export function tileEncounterRate(table: EncounterTable, behaviour: string): number {
  const water = isSurfable(behaviour);
  if (water ? table.surf.length !== 5 : table.land.length !== 12) return 0;
  return water ? table.surfRate : table.landRate;
}

/** GetGroundEncounterSlot: the land slot of a roll in [0, 100). */
export const landSlotIndex = (roll: number): number => LAND_SLOT_LIMITS.findIndex((limit) => roll < limit);

/**
 * The encounter's slot (TryGenerateWildMon): on water the surf slot, then a level between its minimum and maximum
 * (GetWildMonLevel); on land the slot at the clock's period, with a second for the walking partner's double. The
 * attempts count restarts.
 */
export function encounterSlots(table: EncounterTable, behaviour: string, prng: Prng, attempts: { count: number }, period: DayPeriod, partner: boolean): { roll: WildRoll; second: WildRoll | null } {
  const r = prng.below(100);
  if (isSurfable(behaviour)) {
    const w = table.surf[WATER_SLOT_LIMITS.findIndex((limit) => r < limit)]!;
    const lo = Math.min(w.minLevel, w.maxLevel);
    const hi = Math.max(w.minLevel, w.maxLevel);
    const level = lo + prng.below(hi - lo + 1);
    attempts.count = 0;
    return { roll: { species: w.species, level }, second: null };
  }
  const land = (roll: number): WildRoll => {
    const slot = landSlotIndex(roll);
    return { species: landSlot(table, slot, period), level: table.land[slot]!.minLevel };
  };
  const first = land(r);
  attempts.count = 0;
  return { roll: first, second: partner ? land(prng.below(100)) : null };
}

/**
 * The land slots a day's swarm, the Trophy Garden and the Poké Radar's hard shake replace (decomp
 * WildEncounters_ReplaceSwarmEncounters: slots 0–1 by `variants.swarm` on the swarm's zone; ReplaceTrophyGardenEncounters:
 * slots 6–7 by the garden's two species once the National Pokédex is obtained; TryGenerateGrassEncounter_WithRadar:
 * slots 4, 5, 10, 11 by `variants.radar`). Slots 2–3 stay to `landSlot`'s period.
 */
export function replaceLandSlots(table: EncounterTable, o: { swarm: boolean; trophy: [Id | null, Id | null] | null; radar: boolean }): EncounterTable {
  const swap = new Map<number, Id>();
  if (o.swarm) for (const v of table.variants.swarm ?? []) swap.set(v.slot, v.species);
  if (o.trophy) o.trophy.forEach((species, i) => species && swap.set(6 + i, species));
  if (o.radar) for (const v of table.variants.radar ?? []) swap.set(v.slot, v.species);
  if (!swap.size) return table;
  return { ...table, land: table.land.map((slot, i) => (swap.has(i) ? { ...slot, species: swap.get(i)! } : slot)) };
}

/**
 * The species of a land slot at a period (decomp WildEncounters_ReplaceTimedEncounters): the table's own
 * slots are the morning ones; day and twilight take the `day` replacements of slots 2–3, night and late
 * night the `night` ones.
 */
export function landSlot(table: EncounterTable, slot: number, period: DayPeriod): Id {
  const kind = period === 'day' || period === 'twilight' ? 'day' : period === 'night' || period === 'lateNight' ? 'night' : null;
  const replacement = kind ? table.variants[kind]?.find((v) => v.slot === slot) : undefined;
  return replacement?.species ?? table.land[slot]!.species;
}
