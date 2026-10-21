import { calcStats, Prng, randomIvs, randomPid, type Id } from '@opensinnoh/core';
import { dexOf, ROAMING_SLOTS, type BattleOutcome, type BattleResult, type GameState, type Registries, type Roamer, type WildSpec } from '@opensinnoh/contracts';

/**
 * The roaming Pokémon (decomp src/roaming_pokemon.c, special_encounter.c, overlay006/roamer_after_battle.c and the
 * roamer branch of wild_encounters.c). The state is `GameState.roamers`; every draw comes from
 * `GameState.encounterRng` (the DS's LCRNG, which also rolls the encounters), so roamers never shift other
 * randomness. The Pokétch's Marking Map shows them (menus poketch/field.ts). Not here: the TV mentions them (no TV
 * yet). CONTINUE scatters them (`roamersOnContinue`, RoamingPokemon_RandomizeAllLocations), from the title's CONTINUE
 * only (a plain load, as in replays' round trips, does not), and so do Fly and Teleport (mapchange.ts onFlyOrTeleport).
 */

/** Decomp RoamingPokemonRoutes, in RoamerRouteIndex order (RI_*): the map headers a roamer can be on. */
const ROUTES = [
  'ROUTE_201', 'ROUTE_202', 'ROUTE_203', 'ROUTE_204_SOUTH', 'ROUTE_204_NORTH', 'ROUTE_205_SOUTH', 'ROUTE_205_NORTH', 'ROUTE_206',
  'ROUTE_207', 'ROUTE_208', 'ROUTE_209', 'ROUTE_210_SOUTH', 'ROUTE_210_NORTH', 'ROUTE_211_WEST', 'ROUTE_211_EAST', 'ROUTE_212_NORTH',
  'ROUTE_212_SOUTH', 'ROUTE_213', 'ROUTE_214', 'ROUTE_215', 'ROUTE_216', 'ROUTE_217', 'ROUTE_218', 'ROUTE_219', 'ROUTE_220', 'ROUTE_221',
  'ROUTE_222', 'VALLEY_WINDWORKS_OUTSIDE', 'FUEGO_IRONWORKS_OUTSIDE',
].map((n) => `MAP_HEADER_${n}`);

/**
 * Decomp sNearbyRoutes, by route index: the routes a roamer moves to (adjacent ones and the routes of adjacent
 * towns). Route 205 North's third entry is the decomp's literal 9 (Route 208), kept as it is.
 */
const NEARBY: readonly number[][] = [
  [1, 23], [0, 2, 3, 22, 23], [1, 3, 8, 22], [1, 2, 4, 22], [3, 5], [4, 6, 27, 28], [5, 7, 9], [6, 8, 13],
  [2, 7, 9], [8, 10, 15], [9, 11, 15], [10, 12, 19], [11, 14], [6, 7, 14, 20], [12, 13, 20], [9, 10, 16],
  [15, 17], [16, 18, 26], [17, 19, 26], [11, 18], [13, 14, 21], [20], [1, 2, 3], [0, 1, 24], [23, 25], [24],
  [17, 18], [5], [5],
];

/** Decomp RoamingPokemon_ActivateSlot: each ROAMING_SLOT_*'s species and level. */
const SLOT_SPECIES: readonly [species: string, level: number][] = [
  ['SPECIES_MESPRIT', 50],
  ['SPECIES_CRESSELIA', 50],
  ['SPECIES_DARKRAI', 40],
  ['SPECIES_MOLTRES', 60],
  ['SPECIES_ZAPDOS', 60],
  ['SPECIES_ARTICUNO', 60],
];

/** Decomp SystemVars_SetRoamingSpeciesState's vars by species (Darkrai has none), and the ROAMER_STATE_* values. */
const STATE_VARS: Record<string, number> = {
  SPECIES_CRESSELIA: 0x4058, // VAR_ROAMING_CRESSELIA_STATE
  SPECIES_MESPRIT: 0x4059, // VAR_ROAMING_MESPRIT_STATE
  SPECIES_MOLTRES: 0x405e, // VAR_ROAMING_MOLTRES_STATE
  SPECIES_ZAPDOS: 0x405f, // VAR_ROAMING_ZAPDOS_STATE
  SPECIES_ARTICUNO: 0x4060, // VAR_ROAMING_ARTICUNO_STATE
};
const ROAMER_STATE_CAPTURED = 1;
const ROAMER_STATE_DEFEATED = 2;
/** Decomp FLAG_SAFARI_GAME_ACTIVE: roamers stay put on map changes inside the Great Marsh. */
const FLAG_SAFARI_GAME_ACTIVE = 2407;

const local = (id: Id) => id.slice(id.indexOf(':') + 1);

const routeCache = new WeakMap<Registries['zones'], Id[]>();
/** The route list's zones (by decomp map header name); a pack without one of them has no roamers. */
function routeZones(reg: Registries): Id[] {
  let zones = routeCache.get(reg.zones);
  if (!zones) {
    const byName = new Map([...reg.zones.keys()].map((id) => [local(id), id]));
    zones = ROUTES.map((name) => {
      const id = byName.get(name);
      if (!id) throw new Error(`roamers: no zone ${name} (the roaming route list)`);
      return id;
    });
    routeCache.set(reg.zones, zones);
  }
  return zones;
}

function byName(reg: Registries, registry: 'species', name: string): Id {
  for (const id of reg[registry].keys()) if (local(id) === name) return id;
  throw new Error(`roamers: no ${registry} record ${name}`);
}

/** Draws from `GameState.encounterRng`, saved back after `f`. */
function withRng<T>(state: GameState, f: (rng: Prng) => T): T {
  const prng = Prng.from(state.encounterRng);
  const out = f(prng);
  state.encounterRng = prng.save();
  return out;
}

const active = (state: GameState) => state.roamers.slots.flatMap((r, slot) => (r ? [slot] : []));

function zoneOf(reg: Registries, state: GameState, slot: number): Id {
  return routeZones(reg)[state.roamers.routes[slot]!]!;
}

/** Decomp MoveRoamerRandom: any route but the player's previous zone and the roamer's own. */
function moveRandom(reg: Registries, state: GameState, slot: number, rng: Prng): void {
  const routes = routeZones(reg);
  const current = zoneOf(reg, state, slot);
  for (;;) {
    const i = rng.below(routes.length);
    if (routes[i] !== state.roamers.previous && routes[i] !== current) {
      state.roamers.routes[slot] = i;
      return;
    }
  }
}

/** Decomp MoveRoamerNearby: a nearby route other than the player's previous zone (none left: a random one). */
function moveNearby(reg: Registries, state: GameState, slot: number, rng: Prng): void {
  const routes = routeZones(reg);
  const nearby = NEARBY[state.roamers.routes[slot]!]!;
  if (nearby.length === 1) {
    if (routes[nearby[0]!] === state.roamers.previous) moveRandom(reg, state, slot, rng);
    else state.roamers.routes[slot] = nearby[0]!;
    return;
  }
  for (;;) {
    const i = nearby[rng.below(nearby.length)]!;
    if (routes[i] !== state.roamers.previous) {
      state.roamers.routes[slot] = i;
      return;
    }
  }
}

/**
 * Decomp RoamingPokemon_ActivateSlot (`activate_roaming_pokemon`): a fresh roamer at the slot's level (random PID
 * and IVs, Pokemon_InitWith; full HP, no status), then a random route. A second activation overwrites the first.
 */
export function activateRoamer(reg: Registries, state: GameState, slot: number): void {
  const def = SLOT_SPECIES[slot];
  if (!def) throw new Error(`activate_roaming_pokemon: no roaming slot ${slot} (0–${ROAMING_SLOTS - 1})`);
  const [name, level] = def;
  const species = byName(reg, 'species', name);
  withRng(state, (rng) => {
    const pid = randomPid(rng);
    const ivs = randomIvs(rng);
    const dex = dexOf(reg);
    const hp = calcStats(dex.form(species, 0).baseStats, level, ivs, { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 }, dex.nature(pid)).hp;
    state.roamers.slots[slot] = { species, level, pid, ivs, hp, status: 'none' };
    moveRandom(reg, state, slot, rng);
  });
}

/** Decomp SpecialEncounter_UpdateRecentRoutes, while a roamer is active (RoamingPokemon_UpdatePlayerRecentRoutes). */
function updateRecent(state: GameState, zone: Id): void {
  if (!active(state).length || state.roamers.current === zone) return;
  state.roamers.previous = state.roamers.current;
  state.roamers.current = zone;
}

/**
 * A zone connection (decomp FieldSystem_InitFlagsOnMapChange): outside a Safari game the recent zones update and
 * every roamer moves, one time in 16 to a random route, else to a nearby one (RoamingPokemon_MoveAllLocations).
 */
export function roamersOnZoneConnection(reg: Registries, state: GameState, zone: Id): void {
  if (!active(state).length || safariGame(reg, state)) return;
  updateRecent(state, zone);
  withRng(state, (rng) => {
    for (const slot of active(state)) {
      if (rng.below(16) === 0) moveRandom(reg, state, slot, rng);
      else moveNearby(reg, state, slot, rng);
    }
  });
}

/**
 * The player's CONTINUE (decomp FieldTask_LoadSavedGameMap → RoamingPokemon_RandomizeAllLocations): every active roamer
 * moves to a random route other than its own and the player's previous zone. World `continued()`; not a plain load.
 */
export function roamersOnContinue(reg: Registries, state: GameState): void {
  if (!active(state).length) return;
  withRng(state, (rng) => {
    for (const slot of active(state)) moveRandom(reg, state, slot, rng);
  });
}

/** A warp (decomp FieldSystem_InitFlagsWarp): the recent zones update; the roamers stay. */
export function roamersOnWarp(state: GameState, zone: Id): void {
  updateRecent(state, zone);
}

/**
 * Decomp TryEncounterRoamer, once the encounter gates have passed: with a roamer on this zone, one time in 2 the
 * encounter is a roamer (one of several at random). Returns its slot.
 */
export function rollRoamerEncounter(reg: Registries, state: GameState, zone: Id): number | null {
  const here = active(state).filter((slot) => zoneOf(reg, state, slot) === zone);
  if (!here.length) return null;
  return withRng(state, (rng) => {
    if (rng.below(2) === 0) return null;
    return here.length > 1 ? here[rng.below(here.length)]! : here[0]!;
  });
}

/** The wild side of a roamer's battle (decomp AddRoamerToEnemyParty). */
export function roamerWildSpec(state: GameState, slot: number): WildSpec {
  const r = state.roamers.slots[slot];
  if (!r) throw new Error(`roamers: slot ${slot} has no roamer`);
  return { species: r.species, level: r.level, roamer: { pid: r.pid, ivs: { ...r.ivs }, hp: r.hp, status: r.status } };
}

/** Decomp MoveRoamersOffMap: every roamer on this zone goes to a random route. */
function moveOffZone(reg: Registries, state: GameState, zone: Id, rng: Prng): void {
  for (const slot of active(state)) if (zoneOf(reg, state, slot) === zone) moveRandom(reg, state, slot, rng);
}

function safariGame(reg: Registries, state: GameState): boolean {
  const f = [...reg.flags.values()].find((x) => x.sourceIndex === FLAG_SAFARI_GAME_ACTIVE);
  if (!f) throw new Error(`roamers: no flag ${FLAG_SAFARI_GAME_ACTIVE} (FLAG_SAFARI_GAME_ACTIVE)`);
  return state.flags[f.id] ?? f.initial;
}

function setVar(reg: Registries, state: GameState, index: number, value: number): void {
  const v = [...reg.vars.values()].find((x) => x.sourceIndex === index);
  if (!v) throw new Error(`roamers: no var ${index}`);
  if (value === v.initial) delete state.vars[v.id];
  else state.vars[v.id] = value;
}

/**
 * Decomp RoamerAfterBattle_UpdateRoamers, after a wild battle from the field the player did not lose: the roamer of
 * the first foe's species, if any, is gone when defeated or caught (its species' state var says which) or keeps its
 * HP and status; then every roamer on this zone moves away. Without one, they move away 30% of the time. With no
 * roamer active nothing is drawn (the DS draws the 30% anyway; our stream stays as it was before roamers).
 */
export function roamersAfterBattle(reg: Registries, state: GameState, zone: Id, foe: Id, result: Pick<BattleResult, 'outcome' | 'roamer'>): void {
  if (!active(state).length) return;
  const slot = active(state).find((s) => state.roamers.slots[s]!.species === foe);
  withRng(state, (rng) => {
    if (slot === undefined) {
      if (rng.below(100) < 30) moveOffZone(reg, state, zone, rng);
      return;
    }
    const roamer = state.roamers.slots[slot]!;
    if (!result.roamer) throw new Error(`roamers: a battle against roaming ${foe} without its roamer data`);
    const gone = (outcome: BattleOutcome): number | null => (outcome === 'won' && result.roamer!.hp === 0 ? ROAMER_STATE_DEFEATED : outcome === 'caught' ? ROAMER_STATE_CAPTURED : null);
    const end = gone(result.outcome);
    if (end !== null) {
      state.roamers.slots[slot] = null;
      const v = STATE_VARS[local(roamer.species)];
      if (v !== undefined) setVar(reg, state, v, end);
    } else {
      roamer.hp = result.roamer.hp;
      roamer.status = result.roamer.status;
    }
    moveOffZone(reg, state, zone, rng);
  });
}

/** Each active roamer and the zone it is on (tests and tools). */
export function roamerZones(reg: Registries, state: GameState): { slot: number; roamer: Roamer; zone: Id }[] {
  return active(state).map((slot) => ({ slot, roamer: state.roamers.slots[slot]!, zone: zoneOf(reg, state, slot) }));
}
