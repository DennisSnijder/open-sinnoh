/**
 * Saved game state and the save envelope (contracts v0.27.19, schema v16). Plain JSON; no functions.
 * Saving is allowed only when no script is running and the world is idle (no step, warp, fade or
 * movement); otherwise `save()` throws. Validated strictly on load (a boundary).
 */
import type { BagSlot, ClockTime, Daycare, Gender, Id, Pokemon, PrngState, SpecialEncounterState, Stats, StatusCondition } from '@opensinnoh/core';
import type { Facing } from './records.ts';
import type { MapFeatures } from './gyms.ts';
import type { FrontierState } from './frontier.ts';

/** Slots per PC box (decomp MAX_MONS_PER_BOX); the box count is `NewGame.boxNames.length`. */
export const BOX_SIZE = 30;
/** Decomp MAX_DEFAULT_WALLPAPERS: box i starts with wallpaper i % 16. */
export const DEFAULT_WALLPAPERS = 16;
/** Decomp MONEY_MAX. */
export const MONEY_MAX = 999999;
/** Decomp TRAINER_SCORE_LIMIT: the trainer score's cap. */
export const TRAINER_SCORE_MAX = 99999999;
/**
 * Decomp game_records.h: records 0..70 are u32 and 71..147 u16 (NUM_U32_RECORDS, MAX_RECORDS); each caps at
 * its kind's high or low limit (GetRecordLimit, `NewGame.gameRecords.highLimit`). Record 1 is RECORD_TRAINER_SCORE;
 * there are 51 TRAINER_SCORE_EVENT_* (MAX_TRAINER_SCORE_EVENTS).
 */
export const GAME_RECORDS = { trainerScore: 1, scoreEvents: 51, u32: 71, count: 148, u32High: 999999999, u32Low: 999999, u16High: 0xffff, u16Low: 9999 } as const;
/** Decomp SIGNATURE_WIDTH × SIGNATURE_HEIGHT in pixels (24 × 8 tiles; 0.20.0). */
export const SIGNATURE_WIDTH = 192;
export const SIGNATURE_HEIGHT = 64;
/** Decomp MAX_COINS. */
export const COINS_MAX = 50000;
/** Decomp PlayTime: the clock stops at 999:59:59. */
export const PLAY_HOURS_MAX = 999;
/** Decomp MAX_PC_WALLPAPERS − MAX_DEFAULT_WALLPAPERS: the unlockable wallpapers (a bit each in `wallpapersUnlocked`). */
export const EXTRA_WALLPAPERS = 8;

/** The DS options saved with the game (decomp Options; text speed stays a device option, docs/decisions.md). */
export interface SavedOptions {
  sound: number;
  battleScene: number;
  battleStyle: number;
  buttonMode: number;
  /** Message box frame type, 0–19. */
  frame: number;
}

/** The game records the trainer card shows (decomp GameRecords / TrainerCard). */
export interface GameRecords {
  /** Decomp RECORD_SCORE (the trainer score, GameRecords_IncrementTrainerScore; at most TRAINER_SCORE_MAX). */
  score: number;
  /** The Hall of Fame debut date (`yyyy-mm-dd`), null before it. */
  hallOfFame: string | null;
  timesLinked: number;
  linkBattleWins: number;
  linkBattleLosses: number;
  linkTrades: number;
  /**
   * Schema v13: the other game records (decomp GameRecords: RECORD_* ids, e.g. RECORD_MONEY_SPENT) that
   * scripts count (`increment_game_record`, `add_to_game_record`), by record id; absent = 0. The trainer
   * score is `score`, not here.
   */
  counts: Record<string, number>;
}

/** A PC box (decomp PCBoxes): its name, wallpaper id and 30 slots (null = empty). */
export interface PcBox {
  name: string;
  wallpaper: number;
  slots: (Pokemon | null)[];
}

export interface ObjectState {
  /** The zone whose event data the object comes from (objects of a previous zone stay until out of range). */
  zone: Id;
  /** Wander movement: origin tile and its own PRNG stream, so NPCs never shift other random rolls. */
  wander?: { originX: number; originZ: number; rng: PrngState };
  localId: number;
  /**
   * The object is `zone`'s clone of this zone's object (`ObjectEvent.cloneOf`; the DS saves a clone's
   * flag, which holds that zone). A zone may list a clone and an object of its own under one local id
   * (Eterna City: the Route 205 arrow signpost and a Galactic grunt), so the local id alone is ambiguous.
   */
  cloneOf?: Id;
  x: number;
  z: number;
  y: number;
  facing: Facing;
  movementType: number;
  /** Others pass through it (0.27.13; decomp MAP_OBJ_STATUS_18, saved with the object's status): absent when not. */
  passThrough?: boolean;
}

/**
 * The clock as the game last saw it (schema v8; decomp GameTime in SystemData, saved). `now` follows the
 * game clock on every field tick with no script running and on a load (decomp sub_020559DC): forward by
 * whole minutes, or straight back when the clock went back. The field's time of day (`get_time_of_day`,
 * `get_hour`, the battle palette) reads `now`, not the live clock. The decomp's startTimestamp is
 * `GameState.startDate`, its firstCompletionTimestamp `records.hallOfFame`.
 */
export interface GameTime {
  /** RecordMixedRNG player override's rand, seeded at new game; absent in older saves (derived from the seed, core `dailyRandomOf`). */
  dailyRandom?: number;
  /**
   * 0.29.1. The Great Marsh's daily value (decomp SpecialEncounter marshDaily): random at a new game (absent: derived
   * from the game seed, core `marshDailyOf`), then the day's `dailyRandom` after each day change
   * (SpecialEncounter_SetMixedRecordDailies). Five bits per area pick its two daily species.
   */
  marshDaily?: number;
  /**
   * 0.31.0. The swarm daily (decomp SpecialEncounter swarmDaily): random at a new game (absent: derived from the game
   * seed, core `swarmDailyOf`), then the day's `dailyRandom` with `marshDaily`. `% 22` is the day's swarm.
   */
  swarmDaily?: number;
  now: ClockTime;
  /**
   * Minutes of the clock-change penalty left (decomp penaltyInMinutes, 0..1440): set to 24 h when a save
   * is loaded with the clock behind it (the DS: when the RTC offset changed), counted down by the
   * minutes the clock moves on. Yearly weathers read it (January 2); berries, honey trees and the Underground will.
   */
  penaltyMinutes: number;
}

/**
 * A form and gender the Pokédex has seen (schema v11; decomp Pokedex recordedGenders and the form
 * records of Unown, Shellos, Gastrodon, Burmy, Wormadam, Deoxys, Rotom, Shaymin and Giratina): the
 * entry picture shows the first, the forms page lists them in the order seen.
 */
export interface SeenForm {
  form: number;
  gender: Gender;
}

/**
 * The Pokétch (schema v12; decomp `Poketch`, include/poketch.h, saved). Apps are `<ns>:POKETCH_APPID_<NAME>`
 * ids (contracts `POKETCH_APPS`). What the decomp keeps only in memory (the memo pad's drawing, the
 * counter, the calculator) is not saved: the Pokétch model holds it (`PoketchModel`).
 */
export interface PoketchState {
  enabled: boolean;
  /** Registered apps (decomp appRegistry), in the order they were registered. */
  apps: Id[];
  /** The app shown (decomp appIndex); null before the first app is registered. */
  current: Id | null;
  /** Screen colour (decomp PoketchScreenColor: green, yellow, orange, red, purple, blue, teal, white). */
  color: number;
  /** Pedometer steps (decomp stepCount, 0..POKETCH_PEDOMETER_MAX); counted once the Pedometer is registered. */
  steps: number;
  /** Alarm Clock (decomp alarmSet, alarmHour, alarmMinute). */
  alarm: { on: boolean; hour: number; minute: number };
  /** Calendar marks (decomp calendarMonth 1–12, calendarMarkBitmap: bit d − 1 = day d marked). */
  calendar: { month: number; marks: number };
  /** Marking Map markers (decomp markMapPositions): 6 positions in Pokétch screen px. */
  markers: { x: number; y: number }[];
  /** Dot Artist picture (decomp dotArtData, 120 bytes as hex); null until the player draws (decomp dotArtModifiedByPlayer). */
  dotArt: string | null;
  /** Pokémon History (decomp pokemonHistoryQueue): the last 12 Pokémon caught, received or hatched, oldest first. */
  history: { species: Id; form: number }[];
}

/** Decomp ROAMING_SLOT_MAX: Mesprit, Cresselia, Darkrai, Moltres, Zapdos, Articuno. */
export const ROAMING_SLOTS = 6;
/** Decomp RoamingPokemonRoutes, in RoamerRouteIndex order (RI_*): the map headers a roamer can be on. */
export const ROAMING_ROUTES = [
  'ROUTE_201', 'ROUTE_202', 'ROUTE_203', 'ROUTE_204_SOUTH', 'ROUTE_204_NORTH', 'ROUTE_205_SOUTH', 'ROUTE_205_NORTH', 'ROUTE_206',
  'ROUTE_207', 'ROUTE_208', 'ROUTE_209', 'ROUTE_210_SOUTH', 'ROUTE_210_NORTH', 'ROUTE_211_WEST', 'ROUTE_211_EAST', 'ROUTE_212_NORTH',
  'ROUTE_212_SOUTH', 'ROUTE_213', 'ROUTE_214', 'ROUTE_215', 'ROUTE_216', 'ROUTE_217', 'ROUTE_218', 'ROUTE_219', 'ROUTE_220', 'ROUTE_221',
  'ROUTE_222', 'VALLEY_WINDWORKS_OUTSIDE', 'FUEGO_IRONWORKS_OUTSIDE',
].map((n) => `MAP_HEADER_${n}`);


/** An active roamer (decomp Roamer): what its battles start from and leave behind. */
export interface Roamer {
  species: Id;
  level: number;
  pid: number;
  ivs: Stats;
  hp: number;
  status: StatusCondition;
}

/**
 * The roaming Pokémon (schema v15; decomp SpecialEncounter roamers, roamerRouteIndexes, recentRoutes; world
 * `roamers.ts`). `slots` and `routes` have `ROAMING_SLOTS` entries in ROAMING_SLOT_* order: the roamer or null,
 * and its route index into the roaming route list (decomp RoamerRouteIndex, kept when the roamer is gone, as on
 * the DS). `current`/`previous`: the zones the player is in and was in before, updated on map changes while a
 * roamer is active (a roamer never moves to `previous`).
 */
export interface RoamerState {
  slots: (Roamer | null)[];
  routes: number[];
  current: Id | null;
  previous: Id | null;
}

/** Decomp HALL_OF_FAME_MAX_ENTRIES and the total's cap (HallOfFame_AddEntry stops adding at 9999). */
export const HALL_OF_FAME_ENTRIES = 30;
export const HALL_OF_FAME_TOTAL_MAX = 9999;

/**
 * A Pokémon of a Hall of Fame team (schema v16; decomp HallOfFamePokemon): what the PC viewer shows. The gender
 * and shininess follow from `pid`, `otId` and the species; `nickname` null is the species name.
 */
export interface HallOfFameMon {
  species: Id;
  form: number;
  level: number;
  pid: number;
  otId: number;
  nickname: string | null;
  otName: string;
  moves: Id[];
}

/** One Hall of Fame entry (decomp HallOfFameEntry): the date of the clear and the team, Eggs left out, in party order. */
export interface HallOfFameEntry {
  date: string;
  party: HallOfFameMon[];
}

export interface GameState {
  /** Independent saved field-event stream; absent in older saves, seeded from the game seed on first use. */
  fieldRng?: PrngState;
  /** FieldOverworldState exit location (not the elevator special location). Absent until an entrance is recorded. */
  escapeLocation?: { zone: Id; x: number; z: number; facing: Facing };
  schemaVersion: 23;
  packs: { id: string; version: string }[];
  names: { player: string; rival: string };
  gender: 'male' | 'female';
  /** The player's trainer id (low 16 bits) and secret id (high 16 bits), rolled at new game (decomp TrainerInfo id). */
  trainerId: number;
  /** Only flags/vars that differ from their registry `initial` value. */
  flags: Record<Id, boolean>;
  vars: Record<Id, number>;
  /** At most 6 (core `PARTY_SIZE`), no gaps. */
  party: Pokemon[];
  /** PC boxes (decomp PCBoxes): one per `NewGame.boxNames` entry, `BOX_SIZE` slots each. */
  boxes: PcBox[];
  currentBox: number;
  /** 0..MONEY_MAX. */
  money: number;
  /** Bag pockets by `NewGame.pockets` name, slots in bag order (decomp Bag). Every pocket is present. */
  bag: Record<string, BagSlot[]>;
  player: { zone: Id; x: number; z: number; y: number; facing: Facing };
  /** Live objects of the current zone (as the DS keeps them). */
  objects: ObjectState[];
  hasPartner: boolean;
  /** PlayerData running shoes (not a script flag on the DS). Running = B held + shoes. */
  runningShoes: boolean;
  /** The follower (e.g. the rival on Route 201) travels between zones: its sprite and talk script are saved with it. */
  follower: (ObjectState & { sprite: Id; label?: Id }) | null;
  /**
   * 0.27.12. The lead party Pokémon walking behind the player (world `party-follower.ts`), where it stands:
   * `waiting` while it is recalled under the player until their next step (after a warp, a dismount, a lead
   * change). Null: no party follower out (none can follow, the option is off, the story's `follower` owns
   * the slot). Saved so a load puts it back where it was; same schema (v15), absent in older saves.
   */
  partyFollower?: { x: number; z: number; facing: Facing; waiting: boolean } | null;
  rng: PrngState;
  /**
   * The new-game seed (never changes). Seeds per-object streams, e.g. a wanderer's stream from (seed,
   * zone, local id), so earlier timing does not move later NPCs.
   */
  seed: number;
  /** Separate stream for wild encounter rolls. */
  encounterRng: PrngState;
  badges: Id[];
  /**
   * Seen and caught species (decomp Pokedex), in the order first seen/caught; caught ⊆ seen. `forms`
   * (v11): per seen species, the forms and genders seen, in order (absent when seen without a Pokémon,
   * e.g. `set_species_seen`).
   */
  pokedex: { obtained: boolean; national: boolean; seen: Id[]; caught: Id[]; forms: Record<Id, SeenForm[]> };
  poketch: PoketchState;
  playerState: 'walk' | 'cycle' | 'surf';
  /** Bike gear (decomp PlayerData cycling gear): 0 = slow, 1 = fast. Kept while walking, as on the DS. */
  cyclingGear: 0 | 1;
  /**
   * The current overworld weather (decomp FieldOverworldState weather, saved): set on every map change and
   * connection crossing (yearly values resolved from the date; FOG under Defog and DARK_FLASH under Flash
   * become CLEAR), and by `FieldHost.setWeather`. Strength, Flash and Defog stay flags (2402, 2426, 2427).
   */
  weather: Id;
  /**
   * The special location (decomp FieldOverworldState special location, `set_special_location`): where a
   * warp to `toZone: 'dynamic'` leads (elevators). `warp` is a warp index in that zone, or -1 for x/z.
   * Null until a script sets it.
   */
  specialLocation: { zone: Id; warp: number; x: number; z: number; facing: Facing } | null;
  /**
   * The blackout destination (decomp FieldOverworldState blackOutWarpId, 0.14.0; optional, so v6 saves stay valid): the last zone with a
   * `Zone.blackOut` spawn entered by a warp. Absent: the default spawn (`Zone.blackOut.spawn` 1).
   */
  blackOut?: Id;
  /**
   * The zone before the last warp (schema v6; decomp FieldOverworldState previous location, set by
   * FieldMapChange_SetNewLocation; `get_previous_map_id`). Null until the first warp.
   */
  previousZone: Id | null;
  /**
   * The platform lift data (schema v6; decomp PersistedMapFeatures DYNAMIC_MAP_FEATURES_PLATFORM_LIFT_ROOM,
   * saved): which lift (`PlatformLiftID` order), the floor it is at, and whether the player arrived on the
   * bottom floor of a lift that goes up only. Set by `FieldHost.initPlatformLift`; null before the first.
   */
  platformLift: { lift: number; floor: 'bottom' | 'top'; notUsedWhenEntered: boolean } | null;
  /**
   * The map's persisted features (schema v14; decomp PersistedMapFeatures, saved; contracts `gyms.ts`): the
   * gym puzzles' slot. A warp clears it (null); the zone's onTransition selects it (`FieldHost.initMapFeatures`).
   */
  mapFeatures: MapFeatures | null;
  /** The saved clock fields (schema v8). */
  gameTime: GameTime;
  tick: number;
  /** The game date the adventure started (`yyyy-mm-dd`; the trainer card), null for migrated saves (v7). */
  startDate: string | null;
  /** Play time (decomp PlayTime): one second per 30 ticks, menus and battles included, stopping at 999:59:59 (v7). */
  playTime: { hours: number; minutes: number; seconds: number };
  /** 0..COINS_MAX (v7; the Game Corner is later). */
  coins: number;
  /** The item on Select (decomp Bag registeredItem), v7. */
  registeredItem: Id | null;
  /** Unlocked extra box wallpapers, bit i = wallpaper DEFAULT_WALLPAPERS + i (decomp PCBoxes unlockedWallpapers), v7. */
  wallpapersUnlocked: number;
  /** Repel steps left (decomp SpecialEncounter repel steps), v7. */
  repel: number;
  /** 0.32.1. The Repel used last (`useRepel`), for the repeat-Repel prompt (`DeviceOptions.repelPrompt`). */
  repelItem?: Id;
  /**
   * 0.32.1. The registered-item wheel (`DeviceOptions.itemWheel`): up to ITEM_WHEEL_SIZE items, in the order registered.
   * The Bag's REGISTER adds to it while the option is on (DESELECT removes); `registeredItem` stays the one item Y uses.
   */
  registeredWheel?: Id[];
  records: GameRecords;
  /**
   * The trainer card signature (decomp TrainerCaseSaveData signature, v7): 1 bpp, 192×64, in the DS's own
   * layout (0.20.0): 24×8 tiles of 8×8 in row order, 8 bytes per tile (one per pixel row, bit x = column x),
   * as 3072 lowercase hex chars (`encodeSignature`/`decodeSignature`). Null when nothing is drawn.
   */
  signature: string | null;
  options: SavedOptions;
  /** The Solaceon daycare (schema v10; decomp Daycare): two slots with their steps, the waiting egg's PID, the egg-cycle step counter. */
  daycare: Daycare;
  /** The roaming Pokémon (schema v15). */
  roamers: RoamerState;
  /**
   * The Hall of Fame (schema v16; decomp HallOfFame, the save's extra block, here in the main state): `total`
   * entries ever added (the PC's entry number and `get_league_victories`; at most HALL_OF_FAME_TOTAL_MAX), and
   * the last HALL_OF_FAME_ENTRIES of them, oldest first (the DS's ring buffer read in order).
   * `records.hallOfFame` stays the debut date.
   */
  hallOfFame: { total: number; entries: HallOfFameEntry[] };
  /**
   * The word written on Route 224's tablet (schema v17; decomp MiscSaveBlock tabletName, at most
   * TABLET_NAME_LENGTH characters): `open_shaymin_tablet_naming_screen` writes it, `buffer_tablet_name` reads it.
   * Absent until written.
   */
  tabletName?: string;
  /**
   * 0.29.1. The Safari Game (decomp FieldOverworldState safariBalls, safariSteps; TVBroadcast safari data
   * numPokemonCaught): the balls left and the steps taken in the game being played, and the Pokémon caught in the
   * last game started. `start_end_safari_game` writes it; FLAG_SAFARI_GAME_ACTIVE says whether a game runs. Absent
   * until the first game.
   */
  safari?: { balls: number; steps: number; caught: number };
  /**
   * The berry patches (schema v18; decomp MiscSaveBlock berryPatches, BerryPatch), indexed by patch id (the soil
   * object's `ObjectEvent.data[0]`); as many as `NewGame.berries.patches` lists. A new game starts each with its
   * listed berry in fruit, not growing until first seen (decomp BerryPatches_Init).
   */
  berryPatches: BerryPatch[];
  /**
   * 0.30.0. Mystery Gift (same schema v18; decomp SystemData isMysteryGiftUnlocked and the MysteryGift save block).
   * Absent until the questionnaire's phrase unlocks it or a gift arrives.
   */
  mysteryGift?: MysteryGiftState;
  /**
   * The Poffin Case (schema v19; decomp PoffinCase, MAX_POFFINS slots, kept compact: a new Poffin goes to the first
   * empty slot and the case is compacted after the Poffins fed are removed). At most POFFIN_CASE_SIZE.
   */
  poffins: Poffin[];
  /** The Fashion Case (schema v19; decomp ImageClips fashionCase). */
  fashionCase: FashionCase;
  /**
   * 0.31.0. The special encounters (same schema v18; decomp SpecialEncounter, core `SpecialEncounterState`): honey
   * trees, the Poké Radar's charge and records, swarms on, the Trophy Garden's slots. Absent until a system writes it
   * (core `specialEncounters` creates it as a new game has it).
   */
  encounters?: SpecialEncounterState;
  /**
   * 0.34.0. The Battle Frontier's saved data (optional, schema v19; contracts `frontier.ts`): Battle Points, the tower's
   * streaks, rooms, flags and RNG, and the challenge saved by REST. Absent until the frontier first writes it.
   */
  frontier?: FrontierState;
  /**
   * 0.33.0. The Underground (same schema v19; decomp `Underground`, contracts `UndergroundState`): inventories, buried
   * spheres, mining spots, records. Absent until a system writes it (core `underground` creates it as a new game has it).
   */
  underground?: import('./underground.ts').UndergroundState;
  /**
   * 0.35.0. The winner photos (schema v20; decomp ImageClips contest photos), one per contest type (CONTEST_TYPE_*
   * order): the last official win of that type, or null.
   */
  contestPhotos: (import('./contests.ts').ContestPhoto | null)[];
  /**
   * 0.37.0. The journal (schema v22; decomp JournalEntry × MAX_JOURNAL_ENTRIES, `journal.ts`): at most ten pages, page 0
   * today's; empty until the journal is given. The online events are not kept.
   */
  journal: import('./journal.ts').JournalPage[];
  /** 0.35.0. The contest running between `new_contest` and `end_contest` (`ContestSession`); absent otherwise, so never in a save. */
  contest?: import('./contests.ts').ContestSession;
  /**
   * The Seal Case (schema v22; decomp SealCase, contracts `seals.ts`): the loose seals per id and the 12 Ball Capsules. A
   * party Pokémon's `capsule` is a copy of one of them.
   */
  sealCase: import('./seals.ts').SealCase;
  /** 0.41.0. The TV (schema v23; decomp TVBroadcast, contracts `TvState`). */
  tv: import('./tv.ts').TvState;
  /**
   * 0.41.0. The Jubilife TV gallery's photos (schema v23; decomp ImageClips savedPhotos, SAVED_PHOTOS_COUNT slots): slot 0
   * is the player's own (the gallery's dress-up writes it); the others come only from record mixing, so stay null offline.
   */
  dressUpPhotos: (import('./contests.ts').DressUpPhoto | null)[];
}

/** Decomp MAX_POFFINS. */
export const POFFIN_CASE_SIZE = 100;
/** Decomp enum PoffinType: 0–24 the flavour pairs (main × 5 + second), then RICH, OVERRIPE, FOUL, MILD. */
export const POFFIN_TYPE = { rich: 25, overripe: 26, foul: 27, mild: 28 } as const;
export const POFFIN_TYPES = 29;

/**
 * One Poffin (decomp Poffin): its type (decomp enum PoffinType, fixed when it is made), its five flavours (spicy, dry,
 * sweet, bitter, sour; decomp FLAVOR_* order, 0–255) and its smoothness (0–255).
 */
export interface Poffin {
  type: number;
  flavors: [number, number, number, number, number];
  smoothness: number;
}

/** Decomp NON_UNIQUE_ACCESSORY_COUNT, ACCESSORY_COUNT, MAX_NON_UNIQUE_ACCESSORIES_PER_TYPE, MAX_UNIQUE_ACCESSORIES_PER_TYPE, BACKDROP_COUNT. */
export const ACCESSORIES = { nonUnique: 61, count: 100, maxNonUnique: 9, maxUnique: 1, backdrops: 18 } as const;

/**
 * The Fashion Case (decomp FashionCase): `accessories` the count held of each accessory by decomp accessory id
 * (ACCESSORIES.count entries; ids below ACCESSORIES.nonUnique hold up to 9, the rest 1); `backdrops` the contest
 * backdrops held, by decomp backdrop id in the order received (the DS stores each one's position).
 */
export interface FashionCase {
  accessories: number[];
  backdrops: number[];
}

export const newFashionCase = (): FashionCase => ({ accessories: Array.from({ length: ACCESSORIES.count }, () => 0), backdrops: [] });

/** The built-in gifts (contracts `MYSTERY_GIFTS`): our own definitions, received by gift code. */
export type MysteryGiftId = 'darkrai' | 'shaymin' | 'arceus' | 'rotom' | 'regigigas';

/** Decomp NUM_WONDERCARD_SLOTS and NUM_PGT_SLOTS. */
export const WONDER_CARD_SLOTS = 3;
export const DELIVERY_SLOTS = 8;

/**
 * 0.30.0. The Mystery Gift save block (decomp MysteryGift). `unlocked`: `unlock_mystery_gift` ran (the Jubilife TV
 * questionnaire's phrase; with the Pokédex, the main menu lists MYSTERY GIFT). `received`: the gifts ever received
 * (the block's received flags; trashing a card whose gift was not picked up clears its flag, as
 * MysteryGift_FreeWcErasePgt). `cards`: the Wonder Cards by slot, `received` the date (yyyy-mm-dd). `deliveries`: the
 * gifts the Poké Mart deliveryman holds (PGT slots) with their card's slot.
 */
export interface MysteryGiftState {
  unlocked: boolean;
  received: MysteryGiftId[];
  cards: ({ gift: MysteryGiftId; received: string } | null)[];
  deliveries: ({ gift: MysteryGiftId; card: number } | null)[];
}

/** Decomp enum BerryGrowthStage: NONE, PLANTED, SPROUTED, GROWING, BLOOMING, FRUIT. */
export const BERRY_STAGES = ['none', 'planted', 'sprouted', 'growing', 'blooming', 'fruit'] as const;
export type BerryStage = (typeof BERRY_STAGES)[number];

/**
 * One berry patch (0.29.0; decomp BerryPatch). `berry` is the berry item (null when empty); `mulch` the mulch item
 * laid down (null for none); `moisture` 0–100 and `yieldRating` 0–5 are the decomp ratings; `stageMinutes` the
 * minutes left in the stage and `moistureMinutes` the minute remainder of the hourly drain; `replants` counts
 * fruit cycles; `yield` the berries on the plant (fruit stage). `growing`: time passes for it (decomp isGrowing).
 */
export interface BerryPatch {
  berry: Id | null;
  stage: BerryStage;
  stageMinutes: number;
  moistureMinutes: number;
  replants: number;
  yield: number;
  moisture: number;
  yieldRating: number;
  mulch: Id | null;
  growing: boolean;
}

/** Decomp the Shaymin tablet naming screen's length (NAMING_SCREEN_TYPE_SHAYMIN_TABLET, 10 characters). */
export const TABLET_NAME_LENGTH = 10;

export interface SaveEnvelope {
  format: 'lantern-nds-save'; // pre-rename name, kept: every exported save carries it
  version: 1;
  savedAt: string;
  state: GameState;
}
