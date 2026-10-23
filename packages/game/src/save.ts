/** Save boundary: strict envelope validation, pack-set match and id resolution. */
import { ACCESSORIES, JOURNAL_LOCATION_EVENTS, JOURNAL_PAGES, CONTEST_RANKS, CONTEST_TYPES, BERRY_STAGES, newFashionCase, POFFIN_CASE_SIZE, POFFIN_TYPES, type FashionCase, BOX_SIZE, COINS_MAX, DW_PLATFORM_FLAGS, DW_PUZZLE_FLAGS, GAME_RECORDS, HALL_OF_FAME_ENTRIES, HALL_OF_FAME_TOTAL_MAX, DEFAULT_DEVICE_OPTIONS, ITEM_WHEEL_SIZE, DEFAULT_WALLPAPERS, DELIVERY_SLOTS, EXTRA_WALLPAPERS, TABLET_NAME_LENGTH, markSeen, MONEY_MAX, newPoketchState, newRoamerState, ROAMING_SLOTS, PLAY_HOURS_MAX, POKETCH_COLORS, POKETCH_DEFAULT_MARKERS, POKETCH_HISTORY_MAX, POKETCH_PEDOMETER_MAX, poketchAppIndex, seenFormOf, setupPidIvs, trainerIdFor, type GameState, type Labels, type MysteryGiftState, WONDER_CARD_SLOTS, type ObjectState, type PoketchState, type Registries, type SaveEnvelope } from '@opensinnoh/contracts';
import { addItem, CONDITIONS, createPokemon, MAX_CONDITION, zeroCondition, DAYCARE_SLOTS, DEFAULT_CLOCK, Dex, emptyBag, emptyDaycare, HONEY_SLATHER_MINUTES, HONEY_TREES, isDate, PARTY_SIZE, RADAR_BATTERY_STEPS, RADAR_CHAIN_MAX, RADAR_RECORDS, STATS, UNDERGROUND_LIMITS, type Id, type Pokemon, type UndergroundState } from '@opensinnoh/core';
import { newBerryPatches } from '@opensinnoh/services';
import { arr, bool, collectRefs, dict, id, int, lit, nullable, num, obj, ref, str, opt, tagged, tuple, validate, ValidationError, type Schema } from './schema.ts';

const facing = lit('up', 'down', 'left', 'right');
const prng = obj({ seed: int(0, 0xffffffff) });
const objectStateV1 = {
  localId: int(0, 0xff),
  x: int(),
  z: int(),
  y: num,
  facing,
  movementType: int(0),
};
const objectState = {
  ...objectStateV1,
  zone: ref('zones'),
  wander: opt(obj({ originX: int(), originZ: int(), rng: prng })),
  cloneOf: opt(ref('zones')),
  passThrough: opt(bool),
};

const stateV1Fields = {
  schemaVersion: lit(1),
  packs: arr(obj({ id: str(/^[a-z][a-z0-9-]*$/), version: str(/^\d+\.\d+\.\d+$/) })),
  names: obj({ player: str(), rival: str() }),
  gender: lit('male', 'female'),
  flags: dict(ref('flags'), bool),
  vars: dict(ref('vars'), int(0, 0xffff)),
  party: arr(obj({ species: ref('species'), level: int(1, 100), heldItem: opt(ref('items')) })),
  money: int(0),
  items: dict(ref('items'), int(1)),
  player: obj({ zone: ref('zones'), x: int(), z: int(), y: num, facing }),
  objects: arr(obj(objectStateV1)),
  hasPartner: bool,
  runningShoes: bool,
  follower: nullable(obj({ ...objectStateV1, sprite: ref('sprites'), label: opt(ref('labels')) })),
  rng: prng,
  tick: int(0),
};

/** v0.1 saves (contracts < 0.7). Only read to migrate. */
export const GAME_STATE_V1_SCHEMA: Schema = obj(stateV1Fields);

const stateV2Fields = {
  ...stateV1Fields,
  schemaVersion: lit(2),
  party: arr(obj({ species: ref('species'), level: int(1, 100), heldItem: opt(ref('items')), moves: opt(arr(id)) })),
  objects: arr(obj(objectState)),
  follower: nullable(obj({ ...objectState, sprite: ref('sprites'), label: opt(ref('labels')) })),
  encounterRng: prng,
  badges: arr(id),
  pokedex: obj({ obtained: bool, national: bool }),
  poketch: obj({ enabled: bool, apps: arr(id), current: nullable(id) }),
  playerState: lit('walk', 'cycle', 'surf'),
};

/** Saves of contracts 0.7.0–0.7.3. Only read to migrate. */
export const GAME_STATE_V2_SCHEMA: Schema = obj(stateV2Fields);

const stateV3Fields = { ...stateV2Fields, schemaVersion: lit(3), seed: int(0, 0xffffffff) };

/** Saves of contracts 0.7.4–0.7.5. Only read to migrate. */
export const GAME_STATE_V3_SCHEMA: Schema = obj(stateV3Fields);

const stateV4Fields = {
  ...stateV3Fields,
  schemaVersion: lit(4),
  cyclingGear: lit(0, 1),
  weather: ref('weathers'),
  specialLocation: nullable(obj({ zone: ref('zones'), warp: int(-1), x: int(), z: int(), facing })),
};

/** Saves of contracts 0.8. Only read to migrate. */
export const GAME_STATE_V4_SCHEMA: Schema = obj(stateV4Fields);

const stats = (max: number) => obj(Object.fromEntries(STATS.map((s) => [s, int(0, max)])));
const pokemonV5Fields: Record<string, Schema> = {
    species: ref('species'),
    form: int(0, 63),
    nickname: nullable(str()),
    isEgg: bool,
    pid: int(0, 0xffffffff),
    otId: int(0, 0xffffffff),
    otName: str(),
    otGender: lit('male', 'female'),
    level: int(1, 100),
    exp: int(0),
    ivs: stats(31),
    evs: stats(255),
    ability: nullable(ref('abilities')),
    moves: arr(ref('moves')),
    pp: arr(int(0, 255)),
    ppUps: arr(int(0, 3)),
    heldItem: nullable(ref('items')),
    stats: stats(0xffff),
    hp: int(0, 0xffff),
    status: lit('none', 'sleep', 'poison', 'toxic', 'burn', 'freeze', 'paralysis'),
    friendship: int(0, 255),
    pokerus: int(0, 255),
    ball: ref('items'),
    met: obj({ zone: nullable(ref('zones')), level: int(0, 100), date: nullable(str(/^\d{4}-\d{2}-\d{2}$/)), egg: opt(obj({ zone: nullable(ref('zones')), date: nullable(str(/^\d{4}-\d{2}-\d{2}$/)) })) }),
};
const pokemonCheck = (v: Record<string, unknown>) => {
  const n = (v.moves as unknown[]).length;
  if (n > 4 || (v.pp as unknown[]).length !== n || (v.ppUps as unknown[]).length !== n) return 'moves, pp and ppUps must be parallel (at most 4)';
  return (v.hp as number) > (v.stats as { hp: number }).hp ? 'hp is above the max HP' : undefined;
};
/** core `Pokemon` of contracts 0.9–0.19 (schemas v5–v10). Only read to migrate. */
const POKEMON_V5_SCHEMA: Schema = obj(pokemonV5Fields, pokemonCheck);
/** Decomp RIBBON_MAX: ribbon ids 0..79. */
const RIBBONS = 80;
/**
 * core `Pokemon` (contracts 0.20: markings and ribbons; 0.28: the fateful-encounter bit, written by v17 and
 * never present before it). Moves, PP and PP Ups are parallel; caught ⊆ seen is not checked (data, not structure).
 */
const pokemonV11Fields: Record<string, Schema> = { ...pokemonV5Fields, language: opt(lit(1, 2, 3, 4, 5, 7, 8)), markings: int(0, 63), ribbons: arr(int(0, RIBBONS - 1)), fatefulEncounter: opt(bool) };
const pokemonV11Check = (v: Record<string, unknown>) => {
  const ribbons = v.ribbons as number[];
  if (v.fatefulEncounter === false) return 'fatefulEncounter is true or absent';
  return pokemonCheck(v) ?? (ribbons.some((r, i) => i > 0 && r <= ribbons[i - 1]!) ? 'ribbons must be ascending and unique' : undefined);
};
/** core `Pokemon` of schemas v11–v18 (no condition). Only read to migrate. */
const POKEMON_V11_SCHEMA: Schema = obj(pokemonV11Fields, pokemonV11Check);
/** core `Pokemon` (schema v19: the contest condition, decomp MON_DATA_COOL … MON_DATA_SHEEN). */
export const POKEMON_SCHEMA: Schema = obj({ ...pokemonV11Fields, condition: obj(Object.fromEntries(CONDITIONS.map((c) => [c, int(0, MAX_CONDITION)]))) }, pokemonV11Check);

// v5 replaces `items` with `bag`.
const stateV4Kept: Record<string, Schema> = Object.fromEntries(Object.entries(stateV4Fields).filter(([k]) => k !== 'items'));

const stateV5Fields: Record<string, Schema> = {
    ...stateV4Kept,
    schemaVersion: lit(5),
    trainerId: int(0, 0xffffffff),
    party: arr(POKEMON_V5_SCHEMA),
    boxes: arr(obj({ name: str(), wallpaper: int(0, 255), slots: arr(nullable(POKEMON_V5_SCHEMA)) })),
    currentBox: int(0),
    money: int(0, MONEY_MAX),
    bag: dict(str(/^[a-z][a-z0-9_]*$/), arr(obj({ item: ref('items'), count: int(1, 999) }))),
    pokedex: obj({ obtained: bool, national: bool, seen: arr(ref('species')), caught: arr(ref('species')) }),
};
const stateV5Check = (v: Record<string, unknown>) => {
    if ((v.party as unknown[]).length > PARTY_SIZE) return `party has ${(v.party as unknown[]).length} members (at most ${PARTY_SIZE})`;
    const boxes = v.boxes as { slots: unknown[] }[];
    if (boxes.some((b) => b.slots.length !== BOX_SIZE)) return `every box has ${BOX_SIZE} slots`;
    return (v.currentBox as number) < boxes.length ? undefined : 'currentBox is not a box';
};

/** Saves of contracts 0.9–0.11 (the Pokémon model). Only read to migrate. */
export const GAME_STATE_V5_SCHEMA: Schema = obj(stateV5Fields, stateV5Check);

const stateV6Fields: Record<string, Schema> = {
  ...stateV5Fields,
  schemaVersion: lit(6),
  previousZone: nullable(ref('zones')),
  platformLift: nullable(obj({ lift: int(0, 8), floor: lit('bottom', 'top'), notUsedWhenEntered: bool })),
  blackOut: opt(ref('zones')),
};

/** Saves of contracts 0.13. Only read to migrate. */
export const GAME_STATE_V6_SCHEMA: Schema = obj(stateV6Fields, stateV5Check);

const date = str(/^\d{4}-\d{2}-\d{2}$/);
const count = int(0, 0xffffffff);
const stateV7Fields: Record<string, Schema> = {
    ...stateV6Fields,
    schemaVersion: lit(7),
    startDate: nullable(date),
    playTime: obj({ hours: int(0, PLAY_HOURS_MAX), minutes: int(0, 59), seconds: int(0, 59) }),
    coins: int(0, COINS_MAX),
    registeredItem: nullable(ref('items')),
    wallpapersUnlocked: int(0, (1 << EXTRA_WALLPAPERS) - 1),
    repel: int(0, 255),
    records: obj({ score: count, hallOfFame: nullable(date), timesLinked: count, linkBattleWins: count, linkBattleLosses: count, linkTrades: count }),
    signature: nullable(str(/^[0-9a-f]{3072}$/)),
    options: obj({ sound: int(0, 1), battleScene: int(0, 1), battleStyle: int(0, 1), buttonMode: int(0, 2), frame: int(0, 19) }),
};
const stateV7Check = (v: Record<string, unknown>) =>
  stateV5Check(v) ?? ((v.boxes as { wallpaper: number }[]).some((b) => b.wallpaper >= DEFAULT_WALLPAPERS + EXTRA_WALLPAPERS) ? 'a box wallpaper is out of range' : undefined);

/** Saves of contracts 0.15–0.16. Only read to migrate. */
export const GAME_STATE_V7_SCHEMA: Schema = obj(stateV7Fields, stateV7Check);

/** core `ClockTime`. */
const clockTime: Schema = obj({ date, hour: int(0, 23), minute: int(0, 59), second: int(0, 59) }, (v) => (isDate(v.date as string) ? undefined : 'not a calendar date'));

const stateV8Fields: Record<string, Schema> = { ...stateV7Fields, schemaVersion: lit(8), gameTime: obj({ now: clockTime, penaltyMinutes: int(0, 24 * 60), dailyRandom: opt(int(0, 0xffffffff)), marshDaily: opt(int(0, 0xffffffff)), swarmDaily: opt(int(0, 0xffffffff)) }) };

/** Saves of contracts 0.17–0.18 (the clock). Only read to migrate. */
export const GAME_STATE_V8_SCHEMA: Schema = obj(stateV8Fields, stateV7Check);

/** core `Daycare` (schema v10): two slots, the waiting egg's PID, the u8 step counter. */
const daycareOf = (pokemon: Schema): Schema =>
  obj(
    { mons: arr(nullable(obj({ mon: pokemon, steps: int(0, 0xffffffff) }))), offspring: int(0, 0xffffffff), stepCounter: int(0, 255) },
    (v) => {
      const mons = v.mons as ({ mon: { isEgg: boolean } } | null)[];
      if (mons.length !== DAYCARE_SLOTS) return `the daycare has ${DAYCARE_SLOTS} slots`;
      if (!mons[0] && mons[1]) return 'the daycare fills slot 0 first';
      return mons.some((m) => m?.mon.isEgg) ? 'an egg in the daycare' : undefined;
    },
  );

const stateV10Fields: Record<string, Schema> = { ...stateV8Fields, schemaVersion: lit(10), daycare: daycareOf(POKEMON_V5_SCHEMA) };

/** Saves of contracts 0.19 (daycare). Only read to migrate. */
export const GAME_STATE_V10_SCHEMA: Schema = obj(stateV10Fields, stateV7Check);

const seenForm = obj({ form: int(0, 63), gender: lit('male', 'female', 'none') });
const stateV11Fields: Record<string, Schema> = {
  ...stateV10Fields,
  schemaVersion: lit(11),
  party: arr(POKEMON_V11_SCHEMA),
  boxes: arr(obj({ name: str(), wallpaper: int(0, 255), slots: arr(nullable(POKEMON_V11_SCHEMA)) })),
  pokedex: obj({ obtained: bool, national: bool, seen: arr(ref('species')), caught: arr(ref('species')), forms: dict(ref('species'), arr(seenForm)) }),
  daycare: daycareOf(POKEMON_V11_SCHEMA),
};

/** Saves of the Pokédex and summary additions (seen forms, markings, ribbons) before the Pokétch. Only read to migrate. */
export const GAME_STATE_V11_SCHEMA: Schema = obj(stateV11Fields, stateV7Check);

const point = obj({ x: int(0, 255), y: int(0, 255) });
/** contracts `PoketchState` (v12). */
const poketchSchema: Schema = obj(
  {
    enabled: bool,
    apps: arr(id),
    current: nullable(id),
    color: int(0, POKETCH_COLORS - 1),
    steps: int(0, POKETCH_PEDOMETER_MAX),
    alarm: obj({ on: bool, hour: int(0, 23), minute: int(0, 59) }),
    calendar: obj({ month: int(1, 12), marks: int(0, 0x7fffffff) }),
    markers: arr(point),
    dotArt: nullable(str(/^[0-9a-f]{240}$/)),
    history: arr(obj({ species: ref('species'), form: int(0, 63) })),
  },
  (v) => {
    if ((v.markers as unknown[]).length !== POKETCH_DEFAULT_MARKERS.length) return `markers has ${(v.markers as unknown[]).length} entries (${POKETCH_DEFAULT_MARKERS.length})`;
    if ((v.history as unknown[]).length > POKETCH_HISTORY_MAX) return `history has more than ${POKETCH_HISTORY_MAX} entries`;
    const apps = v.apps as Id[];
    for (const a of apps) {
      try {
        poketchAppIndex(a);
      } catch (e) {
        return (e as Error).message;
      }
    }
    if (new Set(apps).size !== apps.length) return 'apps has duplicates';
    return v.current === null || apps.includes(v.current as Id) ? undefined : 'current is not a registered app';
  },
);

const stateV12Fields: Record<string, Schema> = { ...stateV11Fields, schemaVersion: lit(12), poketch: poketchSchema };

/** Saves of the Pokétch (v12) before the game records' counts. Only read to migrate. */
export const GAME_STATE_V12_SCHEMA: Schema = obj(stateV12Fields, stateV7Check);

/** contracts `GameRecords` (v13): `counts` by RECORD_* id, each within its kind's high limit (the trainer score is `score`). */
const recordsSchema: Schema = obj(
  {
    score: count,
    hallOfFame: nullable(date),
    timesLinked: count,
    linkBattleWins: count,
    linkBattleLosses: count,
    linkTrades: count,
    counts: dict(str(/^(0|[1-9][0-9]{0,2})$/), int(0, GAME_RECORDS.u32High)),
  },
  (v) => {
    for (const [k, n] of Object.entries(v.counts as Record<string, number>)) {
      const i = Number(k);
      if (i >= GAME_RECORDS.count || i === GAME_RECORDS.trainerScore) return `counts: ${k} is not a counted record id`;
      if (i >= GAME_RECORDS.u32 && n > GAME_RECORDS.u16High) return `counts: u16 record ${k} is ${n}`;
    }
    return undefined;
  },
);

const stateV13Fields: Record<string, Schema> = { ...stateV12Fields, schemaVersion: lit(13), records: recordsSchema };

/** Saves of v13 before the map features. Only read to migrate. */
export const GAME_STATE_V13_SCHEMA: Schema = obj(stateV13Fields, stateV7Check);

const tile = obj({ x: int(0, 0xffff), z: int(0, 0xffff) });
/** contracts `MapFeatures` (v14; decomp PersistedMapFeatures). */
const mapFeaturesSchema: Schema = nullable(
  tagged('kind', {
    'eterna-gym': obj({ kind: lit('eterna-gym'), clock: int(0, 4) }),
    'hearthome-gym': obj({ kind: lit('hearthome-gym'), initialized: bool, correctDoor: int(0, 8), clueX: int(0, 0xffff), clueZ: int(0, 0xffff) }),
    'veilstone-gym': obj({ kind: lit('veilstone-gym'), initialized: bool, bags: arr(tile), stacks: arr(nullable(tile)) }),
    'pastoria-gym': obj({ kind: lit('pastoria-gym'), pressedButton: int(0, 2) }),
    'canalave-gym': obj({ kind: lit('canalave-gym'), platformStates: int(0, 0xffffff) }),
    'sunyshore-gym': obj({ kind: lit('sunyshore-gym'), roomID: int(0, 2), rotationState: int(0, 3) }),
    // 0.29.1 (decomp GreatMarshTramState); same schema v17: older saves hold none.
    'great-marsh': obj({ kind: lit('great-marsh'), tram: int(0, 2) }),
    // 0.37.0 (decomp VillaPersistedData, a dummy int); in the v21 schema, older saves hold none.
    villa: obj({ kind: lit('villa') }),
    // 0.27.18 (decomp DistWorldPersistedData); same schema v15: older saves hold none.
    'distortion-world': obj({
      kind: lit('distortion-world'),
      valid: bool,
      hiddenGhostGroups: int(0, 0xffffff),
      support: nullable(int(0, 14)),
      cameraAngle: tuple(int(0, 0xffff), int(0, 0xffff), int(0, 0xffff)),
      platformFlags: int(0, (1 << DW_PLATFORM_FLAGS) - 1),
      puzzleFlags: int(0, (1 << DW_PUZZLE_FLAGS) - 1),
      movingDir: facing,
      platforms: arr(obj({ zone: ref('zones'), index: int(0, 0xffff), x: int(), y: int(), z: int(), path: int(0, 0xffff) })),
    }),
  }),
);

const stateV14Fields: Record<string, Schema> = { ...stateV13Fields, schemaVersion: lit(14), mapFeatures: mapFeaturesSchema };

/** Saves of v14 (the gym puzzles) before the roamers. Only read to migrate. */
export const GAME_STATE_V14_SCHEMA: Schema = obj(stateV14Fields, stateV7Check);

/** contracts `RoamerState` (v15; decomp SpecialEncounter roamers, roamerRouteIndexes, recentRoutes; RI_MAX = 29 routes). */
const roamerSchema: Schema = obj(
  {
    slots: arr(nullable(obj({ species: ref('species'), level: int(1, 100), pid: int(0, 0xffffffff), ivs: stats(31), hp: int(0, 0xffff), status: pokemonV5Fields.status! }))),
    routes: arr(int(0, 28)),
    current: nullable(ref('zones')),
    previous: nullable(ref('zones')),
  },
  (v) => ((v.slots as unknown[]).length !== ROAMING_SLOTS || (v.routes as unknown[]).length !== ROAMING_SLOTS ? `slots and routes must have ${ROAMING_SLOTS} entries` : undefined),
);

const stateV15Fields: Record<string, Schema> = { ...stateV14Fields, schemaVersion: lit(15), roamers: roamerSchema, fieldRng: opt(prng), escapeLocation: opt(obj({ zone: ref('zones'), x: int(), z: int(), facing })), partyFollower: opt(nullable(obj({ x: int(), z: int(), facing, waiting: bool }))) };

/** Saves of the roamers (v15) before the Hall of Fame. Only read to migrate. */
export const GAME_STATE_V15_SCHEMA: Schema = obj(stateV15Fields, stateV7Check);

/** contracts `HallOfFameMon` (v16; decomp HallOfFamePokemon: up to 4 moves). */
const hallOfFameMon: Schema = obj({ species: ref('species'), form: int(0, 63), level: int(1, 100), pid: int(0, 0xffffffff), otId: int(0, 0xffffffff), nickname: nullable(str()), otName: str(), moves: arr(ref('moves')) }, (v) =>
  (v.moves as unknown[]).length > 4 ? 'at most 4 moves' : undefined,
);
/** contracts `GameState.hallOfFame` (v16): at most HALL_OF_FAME_ENTRIES teams of 1–6, no more entries than the total. */
const hallOfFameSchema: Schema = obj({ total: int(0, HALL_OF_FAME_TOTAL_MAX), entries: arr(obj({ date, party: arr(hallOfFameMon) })) }, (v) => {
  const entries = v.entries as { party: unknown[] }[];
  if (entries.length > HALL_OF_FAME_ENTRIES) return `more than ${HALL_OF_FAME_ENTRIES} entries`;
  if (entries.length > Math.min(v.total as number, HALL_OF_FAME_ENTRIES)) return 'more entries than the total';
  return entries.some((e) => e.party.length < 1 || e.party.length > PARTY_SIZE) ? `an entry's team has 1–${PARTY_SIZE} Pokémon` : undefined;
});

const stateV16Fields: Record<string, Schema> = { ...stateV15Fields, schemaVersion: lit(16), hallOfFame: hallOfFameSchema };

/** Saves of the Hall of Fame (v16) before the fateful-encounter bit and the tablet name. Only read to migrate. */
export const GAME_STATE_V16_SCHEMA: Schema = obj(stateV16Fields, stateV7Check);

const stateV17Fields: Record<string, Schema> = {
  ...stateV16Fields,
  schemaVersion: lit(17),
  tabletName: opt(str(new RegExp(`^.{1,${TABLET_NAME_LENGTH}}$`, 'u'))),
  // 0.29.1, same schema v17: the Safari Game's balls, steps and catches (decomp u16 fields).
  safari: opt(obj({ balls: int(0, 0xffff), steps: int(0, 0xffff), caught: int(0, 0xffff) })),
};
/** Saves of v17 before the berry patches. Only read to migrate. */
export const GAME_STATE_V17_SCHEMA: Schema = obj(stateV17Fields, stateV7Check);

/** The state version this build writes (older ones are migrated on load). */
export const SAVE_SCHEMA_VERSION = 21;

/** Decomp BerryPatch (0.29.0): an empty patch has no berry, stage none and no yield. */
const berryPatchSchema: Schema = obj(
  {
    berry: nullable(ref('items')),
    stage: lit(...BERRY_STAGES),
    stageMinutes: int(0, 0xffff),
    moistureMinutes: int(0, 59),
    replants: int(0, 15),
    yield: int(0, 0xffff),
    moisture: int(0, 100),
    yieldRating: int(0, 5),
    mulch: nullable(ref('items')),
    growing: bool,
  },
  (v) => ((v.stage === 'none') !== (v.berry === null) ? 'a patch has a berry exactly when it has a stage' : undefined),
);

const giftId = lit('darkrai', 'shaymin', 'arceus', 'rotom', 'regigigas');
/** 0.30.0, same schema v18: Mystery Gift (decomp MysteryGift: received flags, WONDER_CARD_SLOTS cards, DELIVERY_SLOTS gifts). */
const mysteryGiftSchema: Schema = obj(
  {
    unlocked: bool,
    received: arr(giftId),
    cards: arr(nullable(obj({ gift: giftId, received: str() }))),
    deliveries: arr(nullable(obj({ gift: giftId, card: int(0, WONDER_CARD_SLOTS - 1) }))),
  },
  (v) => {
    const mg = v as unknown as MysteryGiftState;
    if (mg.cards.length !== WONDER_CARD_SLOTS || mg.deliveries.length !== DELIVERY_SLOTS) return 'the Mystery Gift slots have the wrong count';
    if (new Set(mg.received).size !== mg.received.length) return 'a Mystery Gift is received twice';
    if (mg.cards.some((c) => c && !isDate(c.received))) return 'a Wonder Card has a bad date';
    if (mg.deliveries.some((d) => d && mg.cards[d.card]?.gift !== d.gift)) return "a Mystery Gift's card is missing";
    return undefined;
  },
);

/** The current state's own checks: v7's, and the item wheel's size and duplicates (0.31.0). */
const stateCheck = (v: Record<string, unknown>) => {
  const wheel = v.registeredWheel as Id[] | undefined;
  if (wheel && wheel.length > ITEM_WHEEL_SIZE) return `the item wheel holds ${wheel.length} items (at most ${ITEM_WHEEL_SIZE})`;
  if (wheel && new Set(wheel).size !== wheel.length) return 'an item is on the item wheel twice';
  return stateV7Check(v);
};

/**
 * 0.31.0, same schema v18: the special encounters (decomp SpecialEncounter; core `SpecialEncounterState`): 21 honey
 * trees, the last slathered (21: none), the Poké Radar's charge (0–50) and three records, swarms, the Trophy Garden.
 */
const encountersSchema: Schema = obj(
  {
    honeyTrees: arr(obj({ minutes: int(0, HONEY_SLATHER_MINUTES), slot: int(0, 5), table: int(0, 2), group: int(0, 3), shakes: int(0, 3) })),
    lastHoneyTree: int(0, HONEY_TREES),
    radarCharge: int(0, RADAR_BATTERY_STEPS),
    radarRecords: arr(obj({ species: nullable(ref('species')), count: int(0, RADAR_CHAIN_MAX) })),
    swarms: bool,
    trophyGarden: tuple(nullable(int(0, 15)), nullable(int(0, 15))),
  },
  (v) => ((v.honeyTrees as unknown[]).length !== HONEY_TREES ? `the honey trees must be ${HONEY_TREES}` : (v.radarRecords as unknown[]).length !== RADAR_RECORDS ? `the Poké Radar records must be ${RADAR_RECORDS}` : undefined),
);

/** contracts `FrontierState` (0.34.0): the tower's saved part (decomp WifiBattleTowerRecord, WifiBattleTowerSave, tower stats). */
const frontierSchema: Schema = obj(
  {
    bp: int(0, 9999),
    towerRng: opt(int(0, 0xffffffff)),
    towerFlags: int(0, 0xffff),
    towerRooms: arr(int(0, 0xffff)),
    towerStreaks: arr(obj({ record: int(0, 9999), latest: int(0, 9999) })),
    towerSave: obj({
      inProgress: bool,
      mode: int(0, 6),
      nextOpponent: int(0, 255),
      slots: arr(int(0, 255)),
      trainers: arr(int(0, 0xffff)),
      seed: int(0, 0xffffffff),
      partner: int(0, 7),
      partnerParty: opt(obj({ otId: int(0, 0xffffffff), sets: arr(int(0, 0xffff)), pids: arr(int(0, 0xffffffff)), reserved: bool })),
    }),
  },
  (v) => {
    const f = v as { towerRooms: unknown[]; towerStreaks: unknown[]; towerSave: { slots: unknown[]; trainers: unknown[] } };
    if (f.towerRooms.length !== 6 || f.towerStreaks.length !== 5) return 'frontier: 6 tower rooms and 5 tower streaks';
    return f.towerSave.slots.length !== 4 || f.towerSave.trainers.length !== 14 ? 'frontier.towerSave: 4 slots and 14 trainers' : undefined;
  },
);

const stateV18Fields: Record<string, Schema> = { ...stateV17Fields, schemaVersion: lit(18), berryPatches: arr(berryPatchSchema), mysteryGift: opt(mysteryGiftSchema), encounters: opt(encountersSchema) };
/** Saves of the berry patches, Mystery Gift and the special encounters (v18) before the contest condition and the Poffin and Fashion Cases. Only read to migrate. */
export const GAME_STATE_V18_SCHEMA: Schema = obj(stateV18Fields, stateV7Check);

/** contracts `Poffin` (decomp Poffin): a type and five flavours and the smoothness (u8). */
const poffinSchema: Schema = obj({ type: int(0, POFFIN_TYPES - 1), flavors: tuple(int(0, 255), int(0, 255), int(0, 255), int(0, 255), int(0, 255)), smoothness: int(0, 255) });
/** contracts `FashionCase` (decomp FashionCase): a count per accessory (9 or 1 at most), the backdrops once each. */
const fashionCaseSchema: Schema = obj({ accessories: arr(int(0, ACCESSORIES.maxNonUnique)), backdrops: arr(int(0, ACCESSORIES.backdrops - 1)) }, (v) => {
  const fc = v as unknown as FashionCase;
  if (fc.accessories.length !== ACCESSORIES.count) return `accessories has ${fc.accessories.length} entries (${ACCESSORIES.count})`;
  if (fc.accessories.some((n, i) => i >= ACCESSORIES.nonUnique && n > ACCESSORIES.maxUnique)) return 'a unique accessory is held more than once';
  return new Set(fc.backdrops).size === fc.backdrops.length ? undefined : 'a backdrop is held twice';
});

/**
 * 0.33.0, same schema v19: the Underground (contracts `UndergroundState`): inventories within their limits, sizes 1–99,
 * spheres of the five types, mining ids, the spots and buried spheres on Underground tiles.
 */
const L = UNDERGROUND_LIMITS;
const ugTile = { x: int(0, L.max.x), z: int(0, L.max.z) };
const undergroundSchema: Schema = obj(
  {
    seed: int(0, 0xffffffff),
    respawn: bool,
    mined: bool,
    spheres: arr(obj({ type: int(1, 5), size: int(1, L.sphereSize) })),
    treasures: arr(int(11, 59)),
    traps: arr(int(1, 33)),
    goods: arr(int(1, 138)),
    goodsPc: arr(int(1, 138)),
    buried: arr(obj({ ...ugTile, type: int(1, 5), size: int(1, L.sphereSize), growth: int(0, L.sphereSize) })),
    spots: arr(obj(ugTile)),
    spawnedTraps: arr(nullable(obj({ trap: int(1, 33), ...ugTile }))),
    plates: int(0, 0xffff),
    records: obj({ spheresDug: int(0, 999999), fossilsDug: int(0, 999999), otherDug: int(0, 999999) }),
    steps: int(0, 99),
    vendorTalks: arr(int(0, 19)),
  },
  (v) => {
    const u = v as unknown as UndergroundState;
    const over = (['spheres', 'treasures', 'traps', 'goods', 'goodsPc', 'buried', 'spots'] as const).find((k) => u[k].length > { spheres: L.spheres, treasures: L.treasures, traps: L.traps, goods: L.goods, goodsPc: L.goodsPc, buried: L.buried, spots: L.spots }[k]);
    if (over) return `underground.${over} is over its limit`;
    return u.spawnedTraps.length !== L.spawnedTraps ? `underground.spawnedTraps must have ${L.spawnedTraps} slots` : undefined;
  },
);

const stateV19Fields: Record<string, Schema> = {
    ...stateV18Fields,
    underground: opt(undergroundSchema),
    schemaVersion: lit(SAVE_SCHEMA_VERSION),
    party: arr(POKEMON_SCHEMA),
    boxes: arr(obj({ name: str(), wallpaper: int(0, 255), slots: arr(nullable(POKEMON_SCHEMA)) })),
    daycare: daycareOf(POKEMON_SCHEMA),
    poffins: arr(poffinSchema),
    fashionCase: fashionCaseSchema,
    // 0.32.1, optional (no schema bump): the repeat-Repel prompt's item and the registered-item wheel.
    repelItem: opt(ref('items')),
    registeredWheel: opt(arr(ref('items'))),
    // 0.34.0, optional (no schema bump): the Battle Frontier's saved part.
    frontier: opt(frontierSchema),
};
const stateV19Check = (v: Record<string, unknown>) => stateCheck(v) ?? ((v.poffins as unknown[]).length > POFFIN_CASE_SIZE ? `more than ${POFFIN_CASE_SIZE} Poffins` : undefined);
/** Saves of Poffins, the Fashion Case, the Underground and the frontier (v19) before the contest photos. Only read to migrate. */
export const GAME_STATE_V19_SCHEMA: Schema = obj({ ...stateV19Fields, schemaVersion: lit(19) }, stateV19Check);

/** contracts `ContestDressUp`: up to 20 placed accessories, the Pokémon's priority and the backdrop. */
const dressUpSchema: Schema = obj({
  accessories: arr(obj({ accessory: int(0, ACCESSORIES.count - 1), x: int(0, 255), y: int(0, 255), priority: int(-128, 127) })),
  monPriority: int(-128, 127),
  backdrop: int(0, ACCESSORIES.backdrops - 1),
}, (v) => ((v.accessories as unknown[]).length > 20 ? 'more than 20 accessories' : undefined));
/** contracts `ContestPhoto` (schema v20). */
const contestPhotoSchema: Schema = obj({
  mon: obj({ species: ref('species'), form: int(0, 255), pid: int(0, 0xffffffff), otId: int(0, 0xffffffff), nickname: nullable(str()) }),
  trainerName: str(),
  rank: int(0, CONTEST_RANKS.length - 1),
  dressUp: dressUpSchema,
});

const stateV20Fields: Record<string, Schema> = { ...stateV19Fields, schemaVersion: lit(20), contestPhotos: arr(nullable(contestPhotoSchema)) };
const stateV20Check = (v: Record<string, unknown>) => stateV19Check(v) ?? ((v.contestPhotos as unknown[]).length !== CONTEST_TYPES.length ? `contestPhotos must have ${CONTEST_TYPES.length} slots` : undefined);
/** Saves with the contest photos (v20) before the journal. Only read to migrate. */
export const GAME_STATE_V20_SCHEMA: Schema = obj(stateV20Fields, stateV20Check);

/** contracts `JournalPage` (schema v21; decomp JournalEntry without the online events). */
const journalPageSchema: Schema = obj({
  date: obj({ year: int(0, 99), month: int(1, 12), day: int(1, 31), weekday: int(0, 6) }),
  zone: ref('zones'),
  events: arr(obj({ type: int(1, 40), value: int(0, 0xffff), trainer: int(0, 0x3ff) })),
  mon: nullable(obj({ result: lit('caught', 'defeated'), variant: int(0, 2), timeOfDay: int(0, 15), gender: int(0, 2), species: ref('species') })),
  trainer: nullable(obj({ trainer: ref('trainers'), zone: ref('zones') })),
}, (v) => ((v.events as unknown[]).length > JOURNAL_LOCATION_EVENTS ? `more than ${JOURNAL_LOCATION_EVENTS} location events` : undefined));

export const GAME_STATE_SCHEMA: Schema = obj(
  { ...stateV20Fields, schemaVersion: lit(SAVE_SCHEMA_VERSION), journal: arr(journalPageSchema) },
  (v) => stateV20Check(v) ?? ((v.journal as unknown[]).length > JOURNAL_PAGES ? `more than ${JOURNAL_PAGES} journal pages` : undefined),
);

const envelope = (state: Schema): Schema =>
  obj({
    format: lit('lantern-nds-save'),
    version: lit(1),
    savedAt: str(),
    state,
  });

export const SAVE_SCHEMA: Schema = envelope(GAME_STATE_SCHEMA);
const OLD_SAVE_SCHEMAS: Record<number, Schema> = {
  1: envelope(GAME_STATE_V1_SCHEMA),
  2: envelope(GAME_STATE_V2_SCHEMA),
  3: envelope(GAME_STATE_V3_SCHEMA),
  4: envelope(GAME_STATE_V4_SCHEMA),
  5: envelope(GAME_STATE_V5_SCHEMA),
  6: envelope(GAME_STATE_V6_SCHEMA),
  7: envelope(GAME_STATE_V7_SCHEMA),
  8: envelope(GAME_STATE_V8_SCHEMA),
  10: envelope(GAME_STATE_V10_SCHEMA),
  11: envelope(GAME_STATE_V11_SCHEMA),
  12: envelope(GAME_STATE_V12_SCHEMA),
  13: envelope(GAME_STATE_V13_SCHEMA),
  14: envelope(GAME_STATE_V14_SCHEMA),
  15: envelope(GAME_STATE_V15_SCHEMA),
  16: envelope(GAME_STATE_V16_SCHEMA),
  17: envelope(GAME_STATE_V17_SCHEMA),
  18: envelope(GAME_STATE_V18_SCHEMA),
  19: envelope(GAME_STATE_V19_SCHEMA),
  20: envelope(GAME_STATE_V20_SCHEMA),
};

/**
 * Seed of the wild-encounter stream, derived from the game seed (or, for migrated saves, the main
 * stream's state) so it never shares values with the main stream.
 */
export function encounterSeed(seed: number): number {
  let x = (seed ^ 0x454e4352) >>> 0; // "ENCR"
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** A v1–v4 party member (contracts < 0.9 `Monster`). */
interface MonsterV4 {
  species: Id;
  level: number;
  heldItem?: Id;
  moves?: Id[];
}
/** The fields v7 added. */
type V7Fields = 'startDate' | 'playTime' | 'coins' | 'registeredItem' | 'wallpapersUnlocked' | 'repel' | 'records' | 'signature' | 'options';
/** A Pokémon of schemas v5–v10 (no markings, no ribbons). */
type PokemonV10 = Omit<Pokemon, 'markings' | 'ribbons'>;
/** A Pokémon of schemas v11–v18 (no condition). */
type PokemonV18 = Omit<Pokemon, 'condition'>;
/** v18 (berries, Mystery Gift): no condition, no Poffin Case, no Fashion Case. */
/** v19 (Poffins, the Fashion Case, the Underground): no contest photos. */
/** v20 (the contest photos): no journal. */
type StateV20 = Omit<GameState, 'schemaVersion' | 'journal'> & { schemaVersion: 20 };
type StateV19 = Omit<StateV20, 'schemaVersion' | 'contestPhotos' | 'contest'> & { schemaVersion: 19 };
type StateV18 = Omit<StateV19, 'schemaVersion' | 'party' | 'boxes' | 'daycare' | 'poffins' | 'fashionCase'> & {
  schemaVersion: 18;
  party: PokemonV18[];
  boxes: { name: string; wallpaper: number; slots: (PokemonV18 | null)[] }[];
  daycare: { mons: ({ mon: PokemonV18; steps: number } | null)[]; offspring: number; stepCounter: number };
};
/** v17: no berry patches. */
type StateV17 = Omit<StateV18, 'schemaVersion' | 'berryPatches'> & { schemaVersion: 17 };
/** v16 (the Hall of Fame): no tablet name, and no Pokémon carries the fateful-encounter bit. */
type StateV16 = Omit<StateV17, 'schemaVersion' | 'tabletName' | 'safari'> & { schemaVersion: 16 };
/** v15 (the roamers): no Hall of Fame. */
type StateV15 = Omit<StateV16, 'schemaVersion' | 'hallOfFame'> & { schemaVersion: 15 };
/** v14 (the gym puzzles): no roamers. */
type StateV14 = Omit<StateV15, 'schemaVersion' | 'roamers'> & { schemaVersion: 14 };
/** v13: no map features. */
type StateV13 = Omit<StateV14, 'schemaVersion' | 'mapFeatures'> & { schemaVersion: 13 };
/** v12 (the Pokétch): records without `counts`. */
type StateV12 = Omit<StateV13, 'schemaVersion' | 'records'> & { schemaVersion: 12; records: Omit<GameState['records'], 'counts'> };
/** v11: the v8 Pokétch (enabled, apps, current). */
type StateV11 = Omit<StateV12, 'schemaVersion' | 'poketch'> & { schemaVersion: 11; poketch: Pick<PoketchState, 'enabled' | 'apps' | 'current'> };
type StateV10 = Omit<StateV11, 'schemaVersion' | 'party' | 'boxes' | 'pokedex' | 'daycare'> & {
  schemaVersion: 10;
  party: PokemonV10[];
  boxes: { name: string; wallpaper: number; slots: (PokemonV10 | null)[] }[];
  pokedex: Omit<GameState['pokedex'], 'forms'>;
  daycare: { mons: ({ mon: PokemonV10; steps: number } | null)[]; offspring: number; stepCounter: number };
};
type StateV8 = Omit<StateV10, 'schemaVersion' | 'daycare'> & { schemaVersion: 8 };
type StateV7 = Omit<StateV8, 'schemaVersion' | 'gameTime'> & { schemaVersion: 7 };
type StateV6 = Omit<StateV7, 'schemaVersion' | V7Fields> & { schemaVersion: 6 };
type StateV5 = Omit<StateV6, 'schemaVersion' | 'previousZone' | 'platformLift'> & { schemaVersion: 5 };
type StateV4 = Omit<StateV5, 'schemaVersion' | 'trainerId' | 'party' | 'boxes' | 'currentBox' | 'bag' | 'pokedex'> & {
  schemaVersion: 4;
  party: MonsterV4[];
  items: Record<Id, number>;
  pokedex: { obtained: boolean; national: boolean };
};
type StateV3 = Omit<StateV4, 'schemaVersion' | 'cyclingGear' | 'weather' | 'specialLocation'> & { schemaVersion: 3 };
type StateV2 = Omit<StateV3, 'schemaVersion' | 'seed'> & { schemaVersion: 2 };
type StateV1 = Omit<StateV2, 'schemaVersion' | 'objects' | 'follower' | 'encounterRng' | 'badges' | 'pokedex' | 'poketch' | 'playerState'> & {
  schemaVersion: 1;
  objects: Omit<ObjectState, 'zone' | 'wander'>[];
  follower: (Omit<ObjectState, 'zone' | 'wander'> & { sprite: Id; label?: Id }) | null;
};

/**
 * v1 → v2: objects (and the follower) belong to the player's zone, new progress fields start empty, and
 * the encounter stream is derived from the main stream's saved state.
 */
export function migrateStateV1(v1: StateV1): StateV2 {
  const zone = v1.player.zone;
  return {
    ...v1,
    schemaVersion: 2,
    objects: v1.objects.map((o) => ({ zone, ...o })),
    follower: v1.follower ? { zone, ...v1.follower } : null,
    encounterRng: { seed: encounterSeed(v1.rng.seed) },
    badges: [],
    pokedex: { obtained: false, national: false },
    poketch: { enabled: false, apps: [], current: null },
    playerState: 'walk',
  };
}

/** v2 → v3: the new-game seed is not known any more; the main stream's saved state stands in for it. */
export function migrateStateV2(v2: StateV2): StateV3 {
  return { ...v2, schemaVersion: 3, seed: v2.rng.seed };
}

/**
 * v3 → v4: the weather is the player's zone's header weather (`registries.zones`; a yearly value is
 * resolved by the world on the next map change), gear 0, no special location.
 */
export function migrateStateV3(v3: StateV3, registries: Registries): StateV4 {
  const zone = registries.zones.get(v3.player.zone);
  if (!zone) throw new SaveError(`invalid save: state.player.zone: unknown zones ${v3.player.zone}`);
  return { ...v3, schemaVersion: 4, cyclingGear: 0, weather: zone.weather, specialLocation: null };
}

/**
 * v4 → v5 (the Pokémon model): party members become real Pokémon (PID and IVs from the seed per slot,
 * the player as OT, the pack's ball, the kept moves or the default ones), items move into their bag
 * pockets (in item order), boxes start empty with their default names, the trainer id and Pokédex sets
 * are derived (party species seen and caught).
 */
export function migrateStateV4(v4: StateV4, registries: Registries): StateV5 {
  const record = [...registries.newGame.values()][0];
  if (!record) throw new SaveError('invalid save: the packs have no newGame record');
  const { party, items, pokedex, ...rest } = v4;
  const dex = new Dex(registries);
  const trainerId = trainerIdFor(v4.seed);
  const trainer = { otId: trainerId, otName: v4.names.player, otGender: v4.gender };
  const mons = party.map((m, slot) =>
    createPokemon(dex, { species: m.species, level: m.level, ...setupPidIvs(v4.seed, slot), ...trainer, ball: record.pokeBall, heldItem: m.heldItem ?? null, ...(m.moves ? { moves: m.moves } : {}) }),
  );
  const bag = emptyBag(record.pockets);
  const order = (id: Id) => registries.items.get(id)?.sourceIndex ?? 0;
  for (const [item, count] of Object.entries(items).sort(([a], [b]) => order(a as Id) - order(b as Id))) {
    const rec = registries.items.get(item as Id);
    const pocket = record.pockets.find((p) => p.name === rec?.pocket);
    if (!rec || !pocket) throw new SaveError(`invalid save: state.items.${item}: no bag pocket`);
    if (!addItem(bag, pocket, rec.id, Math.min(count, pocket.max), order)) throw new SaveError(`invalid save: state.items.${item}: does not fit the bag`);
  }
  const species = [...new Set(party.map((m) => m.species))];
  const boxes = record.boxNames.map((text, i) => {
    const name = registries.texts.get(text);
    if (!name) throw new SaveError(`newGame box name: unknown text ${text}`);
    return { name: name.text, wallpaper: i % DEFAULT_WALLPAPERS, slots: Array.from({ length: BOX_SIZE }, () => null) };
  });
  return { ...rest, schemaVersion: 5, trainerId, party: mons, boxes, currentBox: 0, bag, pokedex: { ...pokedex, seen: species, caught: species } };
}

/** v5 → v6: no previous zone is known and no platform lift was entered yet. */
export function migrateStateV5(v5: StateV5): StateV6 {
  return { ...v5, schemaVersion: 6, previousZone: null, platformLift: null };
}

/**
 * v6 → v7: the play time from the tick counter, no start date (the card shows the blank date), no
 * coins, no registered item, no extra wallpapers, no Repel steps, empty records, no signature, and the
 * DS option defaults (the device kept them before; text speed stays a device option).
 */
export function migrateStateV6(v6: StateV6): StateV7 {
  const seconds = Math.min(Math.floor(v6.tick / 30), PLAY_HOURS_MAX * 3600 + 59 * 60 + 59);
  return {
    ...v6,
    schemaVersion: 7,
    startDate: null,
    playTime: { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds / 60) % 60, seconds: seconds % 60 },
    coins: 0,
    registeredItem: null,
    wallpapersUnlocked: 0,
    repel: 0,
    records: { score: 0, hallOfFame: null, timesLinked: 0, linkBattleWins: 0, linkBattleLosses: 0, linkTrades: 0 },
    signature: null,
    options: { sound: DEFAULT_DEVICE_OPTIONS.sound, battleScene: DEFAULT_DEVICE_OPTIONS.battleScene, battleStyle: DEFAULT_DEVICE_OPTIONS.battleStyle, buttonMode: DEFAULT_DEVICE_OPTIONS.buttonMode, frame: DEFAULT_DEVICE_OPTIONS.frame },
  };
}

/**
 * v7 → v8: the saved clock is not known; it starts at DEFAULT_CLOCK with no penalty. The load moves it to
 * the game clock (as after any time away).
 */
export function migrateStateV7(v7: StateV7): StateV8 {
  return { ...v7, schemaVersion: 8, gameTime: { now: { ...DEFAULT_CLOCK }, penaltyMinutes: 0 } };
}

/**
 * v8 → v10 (daycare; v9 was a draft number, never released): an empty daycare. Eggs
 * keep their friendship, which is now their egg cycles (earlier eggs had the species' base friendship).
 */
export function migrateStateV8(v8: StateV8): StateV10 {
  return { ...v8, schemaVersion: 10, daycare: emptyDaycare() };
}

/**
 * v10 → v11: Pokémon get no markings and no ribbons; the Pokédex's seen forms and genders
 * are not known, so each caught species gets those of the Pokémon owned now (party, then boxes; the DS
 * recorded them at the catch), and seen-only species none.
 */
export function migrateStateV10(v10: StateV10, registries: Registries): StateV11 {
  const upgrade = (m: PokemonV10): PokemonV18 => ({ ...m, markings: 0, ribbons: [] });
  const party = v10.party.map(upgrade);
  const boxes = v10.boxes.map((b) => ({ ...b, slots: b.slots.map((m) => (m ? upgrade(m) : null)) }));
  const daycare = { ...v10.daycare, mons: v10.daycare.mons.map((d) => (d ? { ...d, mon: upgrade(d.mon) } : null)) };
  const state: StateV11 = { ...v10, schemaVersion: 11, party, boxes, daycare, pokedex: { ...v10.pokedex, forms: {} } };
  const caught = new Set(v10.pokedex.caught);
  for (const mon of [...party, ...boxes.flatMap((b) => b.slots)]) if (mon && !mon.isEgg && caught.has(mon.species)) markSeen(state, mon.species, seenFormOf(registries, mon));
  return state;
}

/**
 * v11 → v12 (the Pokétch; it only touches `poketch`): the apps and the current app are kept; the rest is a
 * new Pokétch's (decomp Poketch_Init: no steps, green, alarm off, the default markers, no dot art, no
 * history). The current app, if any, must be registered (the card used to show the first app otherwise).
 */
export function migrateStateV11(v11: StateV11): StateV12 {
  const { enabled, apps, current } = v11.poketch;
  return { ...v11, schemaVersion: 12, poketch: { ...newPoketchState(), enabled, apps: [...apps], current: current !== null && apps.includes(current) ? current : (apps[0] ?? null) } };
}

/** v12 → v13: no game record was counted yet. */
export function migrateStateV12(v12: StateV12): StateV13 {
  return { ...v12, schemaVersion: 13, records: { ...v12.records, counts: {} } };
}

/**
 * v13 → v14 (the map features): a save in a gym room gets that gym's freshly selected slot, as if its
 * onTransition had just run (Eterna's clock is rebuilt from its saved var; Veilstone and Hearthome start their
 * puzzle again); elsewhere none.
 */
export function migrateStateV13(v13: StateV13, registries: Registries): StateV14 {
  const gyms = [...registries.newGame.values()][0]?.gyms;
  const zone = v13.player.zone;
  const mapFeatures: GameState['mapFeatures'] =
    !gyms ? null
    : zone === gyms.eterna.zone ? { kind: 'eterna-gym', clock: 0 }
    : zone === gyms.veilstone.zone ? { kind: 'veilstone-gym', initialized: false, bags: [], stacks: [] }
    : gyms.hearthome.rooms.some((r) => r.zone === zone) ? { kind: 'hearthome-gym', initialized: false, correctDoor: 0, clueX: 0, clueZ: 0 }
    : null;
  return { ...v13, schemaVersion: 14, mapFeatures };
}

/** v14 → v15 (the roamers): none was ever activated (activate_roaming_pokemon was a stub). */
export function migrateStateV14(v14: StateV14): StateV15 {
  return { ...v14, schemaVersion: 15, roamers: newRoamerState() };
}

/** v15 → v16 (the Hall of Fame): no entry (clear_game was a stub). */
export function migrateStateV15(v15: StateV15): StateV16 {
  return { ...v15, schemaVersion: 16, hallOfFame: { total: 0, entries: [] } };
}

/**
 * v16 → v17 (the fateful-encounter bit and Route 224's tablet): nothing to add. No Pokémon was fateful
 * (`start_fateful_encounter` was a stub and no distribution existed) and no tablet was written
 * (`open_shaymin_tablet_naming_screen` was a stub), so both stay absent.
 */
export function migrateStateV16(v16: StateV16): StateV17 {
  return { ...v16, schemaVersion: 17 };
}

/**
 * v17 → v18 (the berry patches): every patch as a new game has it (decomp BerryPatches_Init): the berry soil was
 * inert before, so nothing was planted or picked. Packs without berry tables have none.
 */
export function migrateStateV17(v17: StateV17, registries: Registries): StateV18 {
  const tables = [...registries.newGame.values()][0]?.berries;
  return { ...v17, schemaVersion: 18, berryPatches: tables ? newBerryPatches(tables) : [] };
}

/**
 * v18 → v19 (Poffins, the Fashion Case): every Pokémon's condition is 0, as on a DS Pokémon that never ate a Poffin
 * (nothing raised it before; NPC trades kept none), the Poffin Case is empty and the Fashion Case holds nothing
 * (`give_poffin` and `add_accessory` were logged stubs).
 */
export function migrateStateV18(v18: StateV18): StateV19 {
  const upgrade = (m: PokemonV18): Pokemon => ({ ...m, condition: zeroCondition() });
  return {
    ...v18,
    schemaVersion: 19,
    party: v18.party.map(upgrade),
    boxes: v18.boxes.map((b) => ({ ...b, slots: b.slots.map((m) => (m ? upgrade(m) : null)) })),
    daycare: { ...v18.daycare, mons: v18.daycare.mons.map((d) => (d ? { ...d, mon: upgrade(d.mon) } : null)) },
    poffins: [],
    fashionCase: newFashionCase(),
  };
}

/** v19 → v20 (the contest photos): none, as no contest could be won before (`end_contest` was a logged stub). */
export function migrateStateV19(v19: StateV19): StateV20 {
  return { ...v19, schemaVersion: 20, contestPhotos: CONTEST_TYPES.map(() => null) };
}

/**
 * v20 → v21 (the journal): an empty journal. A save that owns it (FLAG_JOURNAL_ACQUIRED) gets today's page at the load
 * (Journal_GetSavedPage), as the DS opens one; `give_journal` was a logged stub before, so nothing was recorded.
 */
export function migrateStateV20(v20: StateV20): GameState {
  return { ...v20, schemaVersion: 21, journal: [] };
}

export class SaveError extends Error {}
/** The file is not an OpenSinnoh save at all (not JSON, or JSON of another kind). The message is for the player. */
export class NotASaveError extends SaveError {}
/** A save written by a newer version of the game than this one. The message is for the player. */
export class NewerSaveError extends SaveError {}
/** A well-formed save made with a different pack set or pack versions (e.g. after toggling a mod). */
export class PackMismatchError extends SaveError {
  constructor(
    message: string,
    /** `id@version` of the packs the save needs and this run does not have (or has at another version). */
    readonly needed: readonly string[] = [],
    /** `id@version` of the packs this run has and the save was made without. */
    readonly extra: readonly string[] = [],
  ) {
    super(message);
  }
}

/**
 * Validates an untrusted save against the loaded packs. Throws SaveError naming the field.
 * v1–v20 saves are migrated to v21 (`migrateStateV1` … `migrateStateV20`) after validation. `packs` is the current load order; a save must have been made with the same packs and versions, cosmetic packs aside.
 */
export function validateSave(input: unknown, registries: Registries, packs: readonly { id: string; version: string; cosmetic?: true }[], labels: Labels): SaveEnvelope {
  if (typeof input !== 'object' || input === null || (input as { format?: unknown }).format !== 'lantern-nds-save') throw new NotASaveError('This file is not an OpenSinnoh save.');
  const version = (input as { state?: { schemaVersion?: unknown } } | null)?.state?.schemaVersion;
  if (typeof version === 'number' && version > SAVE_SCHEMA_VERSION) throw new NewerSaveError('This save was made by a newer version of OpenSinnoh. Update the app, then import it again.');
  const old = typeof version === 'number' ? OLD_SAVE_SCHEMAS[version] : undefined;
  try {
    validate(old ?? SAVE_SCHEMA, input);
  } catch (e) {
    if (e instanceof ValidationError) throw new SaveError(`invalid save: ${e.message}`);
    throw e;
  }
  const state = (input as { state: unknown }).state;
  const v3 =
    version === 1 ? migrateStateV2(migrateStateV1(state as StateV1))
    : version === 2 ? migrateStateV2(state as StateV2)
    : version === 3 ? (state as StateV3)
    : null;
  const v4 = v3 ? migrateStateV3(v3, registries) : version === 4 ? (state as StateV4) : null;
  const v5 = v4 ? migrateStateV4(v4, registries) : version === 5 ? (state as StateV5) : null;
  const v6 = v5 ? migrateStateV5(v5) : version === 6 ? (state as StateV6) : null;
  const v7 = v6 ? migrateStateV6(v6) : version === 7 ? (state as StateV7) : null;
  const v8 = v7 ? migrateStateV7(v7) : version === 8 ? (state as StateV8) : null;
  const v10 = v8 ? migrateStateV8(v8) : version === 10 ? (state as StateV10) : null;
  const v11 = v10 ? migrateStateV10(v10, registries) : version === 11 ? (state as StateV11) : null;
  const v12 = v11 ? migrateStateV11(v11) : version === 12 ? (state as StateV12) : null;
  const v13 = v12 ? migrateStateV12(v12) : version === 13 ? (state as StateV13) : null;
  const v14 = v13 ? migrateStateV13(v13, registries) : version === 14 ? (state as StateV14) : null;
  const v15 = v14 ? migrateStateV14(v14) : version === 15 ? (state as StateV15) : null;
  const v16 = v15 ? migrateStateV15(v15) : version === 16 ? (state as StateV16) : null;
  const v17 = v16 ? migrateStateV16(v16) : version === 17 ? (state as StateV17) : null;
  const v18 = v17 ? migrateStateV17(v17, registries) : version === 18 ? (state as StateV18) : null;
  const v19 = v18 ? migrateStateV18(v18) : version === 19 ? (state as StateV19) : null;
  const v20 = v19 ? migrateStateV19(v19) : version === 20 ? (state as StateV20) : null;
  const env: SaveEnvelope = v20 ? { ...(input as SaveEnvelope), state: migrateStateV20(v20) } : (input as SaveEnvelope);
  // Cosmetic packs (art only) are not part of a save's identity: one made before such a pack was added, or
  // while it was loaded, still loads. A save from before the flag may list one; it is dropped here.
  const cosmetic = new Set(packs.filter((p) => p.cosmetic).map((p) => p.id));
  const want = packs.filter((p) => !p.cosmetic).map((p) => `${p.id}@${p.version}`).join(', ');
  const have = env.state.packs.filter((p) => !cosmetic.has(p.id)).map((p) => `${p.id}@${p.version}`).join(', ');
  if (want !== have) {
    const wanted = new Set(want ? want.split(', ') : []);
    const had = new Set(have ? have.split(', ') : []);
    throw new PackMismatchError(`save was made with packs [${have}], but [${want}] are loaded`, [...had].filter((p) => !wanted.has(p)), [...wanted].filter((p) => !had.has(p)));
  }
  for (const use of collectRefs(GAME_STATE_SCHEMA, env.state, 'state')) {
    if (use.to === 'assets') continue;
    if (use.to === 'labels' ? !labels.has(use.id) : !registries[use.to].has(use.id)) throw new SaveError(`invalid save: ${use.path}: unknown ${use.to} ${use.id}`);
  }
  return env;
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** A copy with flags and vars sorted by id, so equal states serialize to equal bytes (the bag keeps its order). */
export function canonicalState(state: GameState): GameState {
  const out = cloneState(state);
  out.flags = sorted(out.flags);
  out.vars = sorted(out.vars);
  return out;
}
