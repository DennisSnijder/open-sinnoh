import { Reader } from '@opensinnoh/nds';

/** One encounter slot with raw species and levels (land slots have one level: min = max). */
export interface RawEncounterSlot {
  species: number;
  minLevel: number;
  maxLevel: number;
}

export interface RawWaterEncounters {
  rate: number;
  slots: RawEncounterSlot[];
}

/** pl_enc_data member (decomp `WildEncounters`, include/overlay006/wild_encounters.h). */
export interface RawEncounters {
  landRate: number;
  land: RawEncounterSlot[];
  /** Replacement species lists by decomp field (swarm, day, night, radar, dual slots). */
  replacements: Record<string, number[]>;
  surf: RawWaterEncounters;
  oldRod: RawWaterEncounters;
  goodRod: RawWaterEncounters;
  superRod: RawWaterEncounters;
}

export const ENCOUNTER_DATA_SIZE = 424;
const LAND_SLOTS = 12;
const WATER_SLOTS = 5;
/** Replacement lists after the land table: name and slot count, in struct order (u32 species each). */
const REPLACEMENTS: [string, number][] = [
  ['swarm', 2],
  ['day', 2],
  ['night', 2],
  ['radar', 4],
];
const DUAL_SLOTS = ['dualSlotRuby', 'dualSlotSapphire', 'dualSlotEmerald', 'dualSlotFireRed', 'dualSlotLeafGreen'];
/** encounterRatesForms[5] and unownTableID: not imported (Shellos/Gastrodon and Unown forms come later). */
const FORM_FIELDS_SIZE = 6 * 4;

/**
 * Layout: u32 land rate, 12 × {u8 level, 3 pad, u32 species}; swarm 2, day 2, night 2, radar 4 (u32 species);
 * 5 × u32 form fields + u32 Unown table; 5 dual-slot pairs (u32 species); then 5 water tables (surf, unused,
 * old, good, super rod), each u32 rate + 5 × {u8 max level, u8 min level, 2 pad, u32 species}.
 */
export function readEncounters(bytes: Uint8Array): RawEncounters {
  if (bytes.length !== ENCOUNTER_DATA_SIZE) throw new Error(`encounter data: ${bytes.length} bytes, expected ${ENCOUNTER_DATA_SIZE}`);
  const r = new Reader(bytes);
  let o = 0;
  const u32 = () => {
    const v = r.u32(o);
    o += 4;
    return v;
  };
  const landRate = u32();
  const land = Array.from({ length: LAND_SLOTS }, () => {
    const level = r.u8(o);
    o += 4;
    return { species: u32(), minLevel: level, maxLevel: level };
  });
  const replacements: Record<string, number[]> = {};
  for (const [name, n] of REPLACEMENTS) replacements[name] = Array.from({ length: n }, u32);
  o += FORM_FIELDS_SIZE;
  for (const name of DUAL_SLOTS) replacements[name] = [u32(), u32()];
  const water = (): RawWaterEncounters => {
    const rate = u32();
    const slots = Array.from({ length: WATER_SLOTS }, () => {
      const maxLevel = r.u8(o);
      const minLevel = r.u8(o + 1);
      o += 4;
      return { species: u32(), minLevel, maxLevel };
    });
    return { rate, slots };
  };
  const surf = water();
  water(); // unused table
  const oldRod = water();
  const goodRod = water();
  const superRod = water();
  if (o !== ENCOUNTER_DATA_SIZE) throw new Error(`encounter data: read ${o} bytes`);
  return { landRate, land, replacements, surf, oldRod, goodRod, superRod };
}

/** Land slots each replacement list overwrites (decomp wild_encounters.c: swarm 0–1, day/night 2–3, radar 4, 5, 10, 11, dual slot 8–9). */
export const REPLACEMENT_SLOTS: Record<string, number[]> = {
  swarm: [0, 1],
  day: [2, 3],
  night: [2, 3],
  radar: [4, 5, 10, 11],
  ...Object.fromEntries(DUAL_SLOTS.map((n) => [n, [8, 9]])),
};
