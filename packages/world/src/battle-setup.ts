import type { Id } from '@opensinnoh/core';
import type { BattleSetup, Registries, TimeOfDay, Zone } from '@opensinnoh/contracts';
import { isSurfable } from './behaviours.ts';
import type { WildRoll } from './encounters.ts';

/** Decomp sTerrainForBackground (field_battle_data_transfer.c): the platforms when the tile says nothing. */
const TERRAIN_FOR_BACKGROUND: Record<string, string> = {
  PLAIN: 'PLAIN',
  WATER: 'WATER',
  CITY: 'BUILDING',
  FOREST: 'GRASS',
  MOUNTAIN: 'MOUNTAIN',
  SNOW: 'SNOW',
  INDOORS_1: 'BUILDING',
  INDOORS_2: 'BUILDING',
  INDOORS_3: 'BUILDING',
  CAVE_1: 'CAVE',
  CAVE_2: 'CAVE',
  CAVE_3: 'CAVE',
  AARON: 'AARON',
  BERTHA: 'BERTHA',
  FLINT: 'FLINT',
  LUCIAN: 'LUCIAN',
  CYNTHIA: 'CYNTHIA',
  DISTORTION_WORLD: 'DISTORTION_WORLD',
  BATTLE_TOWER: 'BATTLE_TOWER',
  BATTLE_FACTORY: 'BATTLE_FACTORY',
  BATTLE_ARCADE: 'BATTLE_ARCADE',
  BATTLE_CASTLE: 'BATTLE_CASTLE',
  BATTLE_HALL: 'BATTLE_HALL',
};

/** Decomp CalcTerrain's tile checks (TileBehavior_IsIce, IsTallGrass, IsSand, IsSnow, IsMud, IsCaveFloor), in its order. */
function tileTerrain(behaviour: string): string | null {
  if (behaviour === 'ICE') return 'ICE';
  if (behaviour === 'TALL_GRASS' || behaviour === 'VERY_TALL_GRASS') return 'GRASS';
  if (behaviour === 'SAND') return 'SAND';
  if (behaviour.startsWith('SNOW_')) return 'SNOW';
  if (behaviour.startsWith('MUD')) return 'GREAT_MARSH';
  if (behaviour === 'CAVE_FLOOR') return 'CAVE';
  if (isSurfable(behaviour)) return 'WATER';
  return null;
}

/** A wild battle's setup: the roll on the scene of `battleScene`. */
export function wildBattleSetup(zone: Zone, behaviour: string, surfing: boolean, roll: WildRoll, time: TimeOfDay): BattleSetup {
  return { kind: 'wild', trainers: [], wild: [{ species: roll.species, level: roll.level, ...(roll.shiny ? { shiny: true as const } : {}) }], ...battleScene(zone, behaviour, surfing, time) };
}

/** Decomp VAR_PARTNER_TRAINER_ID: the walking partner's trainer number. */
export const VAR_PARTNER_TRAINER_ID = 0x403f;

/**
 * A wild double with the walking AI partner (decomp BATTLE_TYPE_AI_PARTNER, 74; WildEncounters_TryWildEncounter
 * with the has-partner flag): the two rolls in battlers 1 and 3, the partner (`VAR_PARTNER_TRAINER_ID`'s trainer,
 * `partner` its value) in battler 2.
 */
export function partnerWildBattleSetup(reg: Registries, zone: Zone, behaviour: string, rolls: [WildRoll, WildRoll], partner: number, time: TimeOfDay): BattleSetup {
  const trainer = [...reg.trainers.values()].find((t) => t.sourceIndex === partner);
  if (!trainer) throw new Error(`world: the walking partner is trainer ${partner} (VAR_PARTNER_TRAINER_ID), which no pack has`);
  return { kind: 'wild', trainers: [], wild: rolls.map((r) => ({ species: r.species, level: r.level })), topology: 'ai-partner', partner: trainer.id, ...battleScene(zone, behaviour, false, time) };
}

/**
 * A battle's scene (decomp SetBackgroundAndTerrain, for wild and trainer battles alike): the zone's backdrop
 * (WATER while surfing) and the terrain under the player; `time` is the field's time of day as a palette
 * (decomp FieldSystem_GetTimeOfDay, core `battleTime`). Zones without `battleBackground` (packs without
 * battle art) give null for background and terrain.
 */
export function battleScene(zone: Zone, behaviour: string, surfing: boolean, time: TimeOfDay): Pick<BattleSetup, 'background' | 'terrain' | 'time'> {
  const art = zone.battleBackground;
  let background: Id | null = null;
  let terrain: Id | null = null;
  if (art) {
    const ns = art.slice(0, art.indexOf(':'));
    const bg = surfing ? 'WATER' : art.slice(art.indexOf(':') + 1).replace(/^BACKGROUND_/, '');
    const t = tileTerrain(behaviour) ?? TERRAIN_FOR_BACKGROUND[bg];
    if (!t) throw new Error(`world: no battle terrain for background ${art}`);
    background = `${ns}:BACKGROUND_${bg}` as Id;
    terrain = `${ns}:TERRAIN_${t}` as Id;
  }
  return { background, terrain, time };
}

/** Field dispatch, by weather name (not the visual fog layer, which many clear maps also have). */
export function battleWeather(name: string): BattleSetup['weather'] {
  switch (name) {
    case 'RAINING': case 'HEAVY_RAIN': case 'THUNDERSTORM': return 'rain';
    case 'SNOWING': case 'HEAVY_SNOW': case 'BLIZZARD': return 'hail';
    case 'SANDSTORM': return 'sandstorm';
    case 'FOG': case 'DEEP_FOG': return 'fog';
    case 'HARSH_SUN': return 'sun';
    case 'TRICK_ROOM': return 'trickroom';
    default: return undefined;
  }
}
