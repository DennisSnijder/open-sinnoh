import { doorSounds } from './assets/door-sounds.ts';
import { objectiveTables, objectiveTexts } from './objectives.ts';
import { importSpearPillar } from './spear-pillar.ts';
import { animationFrames } from './gyms/index.ts';
import { readSunyshoreTables, SUNYSHORE_REGION } from './gyms/sunyshore.ts';
import type { Area, BgEvent, Model, Light, LightTemplate, Camera, MapPopup, Chunk, CoordEvent, EncounterSlot, EncounterTable, Facing, Flag, Item, Matrix, NewGame, ObjectEvent, Prop, Sprite, Text, TextBank, TileBehavior, Var, WarpEvent, Weather, WeatherSprites, Zone } from '@opensinnoh/contracts';
import { GAME_RECORDS } from '@opensinnoh/contracts';
import { asId, type Id, type PackData, type RegistryRecord } from '@opensinnoh/core';
import { importFont } from '@opensinnoh/text';
import { decodeScripts, MOVEMENT_ACTIONS, SCRIPT_FILES } from '@opensinnoh/vm';
import { importAssets } from './assets/index.ts';
import { GYM_REGION, importGymEffects, LIGHT_REGION, readGymTables, readHearthomeLight } from './gyms/index.ts';
import { importBattleAnims } from './battle/anim.ts';
import { readBillboardModels, readModelObjects, readObjectGfxAnims } from './assets/object-gfx.ts';
import { importChooseStarter } from './choose-starter.ts';
import { ARCHIVES, importDistortionWorld, type DistortionAudit, type Overlay9Layout } from './distortion/index.ts';
import { distortionRecords } from './distortion/records.ts';
import { importDistortionWarp } from './distortion/warp.ts';
import { importDistortionArt } from './distortion/art.ts';
import { importSound } from './sound.ts';
import { resolveUnscriptedClones } from './object-clones.ts';
import { importShips } from './ships.ts';
import { importTitle } from './title/index.ts';
import { importCreditsRide } from './credits.ts';
import { accessoryPictures, BACKGROUNDS, importSlotArt, importTrapArt, importUi2d, importUndergroundArt, mapPopupSheet, MAP_POPUP_STYLES, Sheets } from './ui2d/index.ts';
import { HIDDEN_LOCATIONS, importPokedex } from './pokedex.ts';
import { matrixVariants } from './matrix-variants.ts';
import { flyDestinations, readTownMap } from './town-map.ts';
import { frontierSceneEntry, importFrontier, type FrontierRomTables } from './frontier.ts';
import { PLATINUM_FOLLOW_MODES, platinumFollowers } from './followers.ts';
import { decodeMessageBank, NitroFs, Reader, readNarc, sha1Hex, SUPPORTED_ROMS, type HashedRom, type RomLanguage } from '@opensinnoh/nds';
import charmapFile from '../data/charmap.json' with { type: 'json' };
import namesFile from '../data/names.json' with { type: 'json' };
import { readCameraTable } from './formats/camera.ts';
import { readObjectGfxTable, readScriptEntryOffsets } from './formats/data.ts';
import { importPokemonData, type PokemonData } from './pokemon-data.ts';
import { readJournalTables, readVillaTables, VILLA_ROW_SIZE } from './town-extras.ts';
import { berryTreeGfx, readBerryTables, readNpcTrades, readTutorTables, TUTOR_MASK_SIZE, TUTOR_MOVE_SIZE } from './side-systems.ts';
import { readTrainerAi } from './trainer-ai.ts';
import { readEncounters, REPLACEMENT_SLOTS, type RawWaterEncounters } from './formats/encounters.ts';
import { readZoneEvents, type RawZoneEvents } from './formats/events.ts';
import { readInitScripts } from './formats/init-scripts.ts';
import { readAreaLight, templateAt, type RawLightTemplate } from './formats/area-light.ts';
import { readAreaData, readLandData, readMapMatrix } from './formats/map.ts';
import { decodeText } from './formats/text.ts';
import { readWeatherBgs, readWeatherTasks, usWeatherTasks, readYearlyWeather, WEATHER_BG_COUNT, weatherBgPng, weatherParts, weatherSpriteSet, WEATHER_TASK_COUNT, WEATHER_TASK_SIZE } from './formats/weather.ts';
import { readZoneHeaders, type ZoneHeader } from './formats/zone-headers.ts';
import { placeTables, romBuild } from './layout.ts';
import { charTable, Names, type CharmapFile, type NamesFile } from './names.ts';
import { convertBaseCursor, readUndergroundTables } from './underground.ts';
import { readContestTables } from './contests.ts';
import { readTvTables } from './tv.ts';
import { readSealTables, SEAL_TYPE_SIZE } from './seals.ts';
import { LIGHT_SHOW, readSlotTables, readSpriteMembers, SLOT_PRIZES } from './slots.ts';
import { ACTING_MESSAGES, AI_RULE_SIZE, AI_RULES, BUTTON_PALETTES, CONTEST_EFFECTS, EFFECT_CLASS_SIZE, EFFECT_SIZE, readActingTables } from './contest-acting.ts';
import { DANCE_BUTTONS, DANCE_CHOICE_SIZE, DANCE_LEVELS, DANCE_POSITIONS, DANCE_SONG_SIZE, DANCE_TINTS, DANCE_VARIANT_SIZE, readContestDance } from './contest-dance.ts';

/**
 * The base pack: data records (this file), script IR and movements (vm `decodeScripts`, entry n of file
 * f labelled `names.scriptEntry(f, n)`), models/textures/sprite atlases (`importAssets`), and the
 * message font (text `importFont`). Every id the records or the IR reference exists as a record.
 */

export type ImportProgress = (stage: string, done: number, total: number) => void;

export interface ImportOptions {
  names?: { player: string; rival: string };
  gender?: 'male' | 'female';
  /** Convert only the v0.1 slice's chunk models and texture sets (faster; other zones lack models). */
  slice?: boolean;
}

/** Counts and anything the importer could not map exactly; printed by tools/import-local.ts. */
export interface ImportReport {
  rom: string;
  counts: Record<string, number>;
  unknowns: Record<string, string[]>;
  /** The Distortion World inventory per room and its still-opaque fields (distortion/index.ts). */
  distortionWorld: DistortionAudit;
  ms: number;
}

/** CalcAmitySquareFoundAccessory's switch: the species of each sMonFindableAccessories pool (others take pool 0). */
const AMITY_FINDERS = [
  ['CHIMCHAR', 'MONFERNO', 'INFERNAPE'],
  ['PIPLUP', 'PRINPLUP', 'EMPOLEON'],
  ['TURTWIG', 'GROTLE', 'TORTERRA'],
  ['PSYDUCK', 'BUNEARY', 'DRIFLOON'],
  ['PIKACHU', 'CLEFAIRY', 'PACHIRISU', 'HAPPINY'],
  ['JIGGLYPUFF', 'TORCHIC', 'SKITTY', 'SHROOMISH'],
];
/** ScrCmd_CheckAmitySquareManGiftIsAccessory: gift ids below 9 are items. */
const AMITY_ITEM_GIFTS = 9;
/** The Villa's furniture build models (sVillaFurnitureModelIDs: 559–578), converted in a slice import too. */
const VILLA_FURNITURE_MODELS = Array.from({ length: 20 }, (_, i) => 559 + i);
/** MAP_HEADER_UNDERGROUND. */
const UNDERGROUND_ZONE = 2;
/** The badges by decomp BADGE_ID_* number. */
const BADGE_IDS = ['COAL', 'FOREST', 'COBBLE', 'FEN', 'RELIC', 'MINE', 'ICICLE', 'BEACON'].map((b) => asId(`platinum:BADGE_ID_${b}`));

/** ROM tables located inside arm9/overlays, each verified by SHA1 before use. */
const TABLES = {
  /** gHiddenItems (data/field/hidden_items.h): {u16 item, u8 quantity, u8 dowsing range 0–2, u16 pad, u16 script} per hidden item. */
  /** gVsSeekerRematchData (240 rows, six u16 tiers). */
  rematches: { where: 5, offset: 0x280c8, count: 240, size: 12, sha1: 'bf31de2274a87203cdd168d0a8588af29406a5f6' },
  /** footprint_type.c sFootprintTypes: {u16 type, u16 hasPrint} per national dex number (0–493). */
  footprintTypes: { where: 5, offset: 0x2ecd4, count: 494, size: 4, sha1: 'b0d175fdc5eaea9fd7811013f89abbadf1a4db56' },
  /** SizeContest sUniformToNormalIntervals: base, divisor, intervalStart, padding. */
  sizeIntervals: { where: 5, offset: 0x2e788, count: 16, size: 8, sha1: 'b87c1a51519db6c2cd7e73b51ccb7b11d4ff574b' },
  hiddenItems: { where: 'arm9', offset: 0xea378, count: 257, size: 8, sha1: 'afc122cf537e4b07fffc361ce7ae07eae08bdd53' },
  /** honey_tree.c sHoneyTreeMapHeaderIDs: the 21 trees' map headers (s32), in tree-id order. */
  honeyTreeZones: { where: 5, offset: 0x2e834, count: 21, size: 4, sha1: '19a38e9b987eda54797eb99eece44a822190fbea' },
  /** swarm.c sSwarmMapIdTable: the 22 swarm map headers (u32), in swarm-id order. */
  swarmZones: { where: 6, offset: 0xaf50, count: 22, size: 4, sha1: '7e7ba513d9fdd327207a208c64788c6d10993ac8' },
  /** berry_searcher/main.c sBerryPositions: {u8 x, u8 y} per berry patch, the Pokétch map's main-matrix chunk. */
  berrySearcher: { where: 48, offset: 0x878, count: 118, size: 2, sha1: 'f7715deeb5aabcd4d3a86eb54752d2e49ccfa124' },
  /** Underground (underground.ts): mining.c sMiningObjects and the shapes they point at (overlay 23). */
  miningObjects: { where: 23, offset: 0x18d70, count: 85, size: 20, sha1: '313132e015b1a829cbb3ff011ffb609b6e7999f2' },
  miningShapes: { where: 23, offset: 0x18ab0, count: 0x18d70 - 0x18ab0, size: 1, sha1: '2cd5bfc48110d2e643bf6d8f4803d7355487965b' },
  /** underground.c sMiningItems: u16 bag item per treasure. */
  treasureItems: { where: 'arm9', offset: 0x100920, count: 49, size: 2, sha1: 'ef6231705de2edf6472f40ba795ad45f8f90585b' },
  /** scrcmd_fossil.c sFossilItemToSpeciesMapping: {u16 item, u16 species}. */
  fossils: { where: 'arm9', offset: 0xebffc, count: 7, size: 4, sha1: 'ea69d6f56dda14331b555ab4daa3c8a5a3ed5169' },
  /** trap_prices.c sTrapPrices and treasure_prices.c sTreasurePrices: SpherePrice {u8 type, min, max}. */
  trapPrices: { where: 23, offset: 0x18974, count: 34, size: 3, sha1: '24e5f2457adbd98799e8646e2878f41a0dca22d6' },
  /** traps.c Traps_SpawnRandomTrap's `traps`: the 26 traps that spawn. */
  spawnTraps: { where: 23, offset: 0x18648, count: 26, size: 1, sha1: '004108872911a341b94ad527482480662647e6b3' },
  treasurePrices: { where: 23, offset: 0x188c0, count: 60, size: 3, sha1: '168ca09d8de5901b1b2d145da51a25aedd54c795' },
  /** goods.c sGoodData: 28 bytes per good. */
  goods: { where: 'arm9', offset: 0xec598, count: 139, size: 28, sha1: '1fc511235ac8effa0be655b01b75d4f813e2cdc5' },
  /** vendors.c sUndergroundVendors: {u16 vendorType, u16 x, u16 z}. */
  ugVendors: { where: 23, offset: 0x19534, count: 20, size: 6, sha1: 'ce25f47a666059369287d61b7b76cd5ce7267a04' },
  zoneHeaders: { where: 'arm9', offset: 0xe601c, count: 593, size: 24, sha1: '4a54ec61a43d4cfb684f5c6e9a93ca0866929f04' },
  /** sYearlyWeather (field_overworld_weather.c): u8 weather per day of a 366-day year, per yearly weather (5). */
  yearlyWeather: { where: 'arm9', offset: 0xe98f4, count: 366, size: 5, sha1: '1c357310e95edb58aac3639021c4ef43cf8a37f3' },
  cameras: { where: 5, offset: 0x27d64, count: 17, size: 24, sha1: 'e036030921ad887264cd6d53d869324663a5d9aa' },
  objectGfx: { where: 5, offset: 0x2bc34, count: 441, size: 8, sha1: 'edc8cbdf61693db05f14aac6f5d4ea7a2053fb40' },
  /** gObjectEventGfxModelAnimsTable: billboard model, frame sequence, animation table per gfx. */
  objectGfxAnims: { where: 5, offset: 0x2c9fc, count: 441, size: 16, sha1: '9b541c91bd7b760c5818bc9a75b9da7b871e5d15' },
  /** gObjectEventGfxModelsTable: billboard model → mmodel member (the quad or shaped model a gfx is drawn on). */
  billboardModels: { where: 5, offset: 0x2a704, count: 19, size: 8, sha1: '4f61e881475dc68d5304deb1a46f1aae4058ba7a' },
  /** ov5_021F10E8.c gfx → fldeff model of the 3D model objects (signposts, mailboxes …). */
  modelObjects: { where: 5, offset: 0x2f4b0, count: 9, size: 8, sha1: '6c452edb6a9759efe23cbb138a102623500875fb' },
  /**
   * DoorAnimation_FindDoorAndLoad's `doorModelIDs` (s32 build model ids; two more copies follow for the
   * other door functions): door01, wooden, iron, Jubilife building, Pokécenter, … elevator.
   */
  doorModels: { where: 5, offset: 0x27c74, count: 20, size: 4, sha1: 'fe28c323ce6e402ecd1185e01e556c1116c5988a' },
  /** gObjectEventGfxOverworldAnimsInitialPosTable: their draw offsets. */
  modelObjectOffsets: { where: 5, offset: 0x2a79c, count: 10, size: 16, sha1: '59ed937f0ca590c7b92ce6bc3ecc1af8531e5b93' },
  /** ov5_021D5EB8.c Unk_ov5_02201D78: the 31 weather tasks (formats/weather.ts). */
  weatherTasks: { where: 5, offset: 0x30ff8, count: WEATHER_TASK_COUNT, size: WEATHER_TASK_SIZE, sha1: '2daff4e9efb252948e5d691a0ca496a1b5014e86' },
  /** ov5_021D5EB8.c Unk_ov5_021F8E14: the fog density table of weather tasks 24 and 25. */
  weatherFogDensities: { where: 5, offset: 0x28094, count: 32, size: 1, sha1: 'dab296d3050016a2962a2fc308ba009696dd9827' },
  /** ov5_021D5EB8.c Unk_ov5_021F8D90: the weather BG resources (weather_sys.narc NCLR, NCGR, NSCR). */
  weatherBgs: { where: 5, offset: 0x28010, count: WEATHER_BG_COUNT, size: 12, sha1: 'c21cc1f6adb85650e736de1347b4d460c82f3e0c' },
  /** item.c sTMHMMoves: the move of TM01..HM08. */
  tmMoves: { where: 'arm9', offset: 0xf0bfc, count: 100, size: 2, sha1: '59e4c4913da5aeee69399f00d7c61822b2c7eab7' },
  /** daycare.c sEggMoves (species_egg_moves.h), with its 0xFFFF terminator. */
  eggMoves: { where: 5, offset: 0x29222, count: 1910, size: 2, sha1: 'b7f45f49efb20a25aa8e30f764cf6a9ed6a13c10' },
  /** trainer_data.c sTrainerClassGender: GENDER_* per trainer class. */
  trainerClassGenders: { where: 'arm9', offset: 0xf0714, count: 105, size: 1, sha1: '1a8cc4a4e5d810db1bae481a946f87964a71b0fa' },
  /** ov16 (battle) sTrainerClassPrizeMul: u8 per trainer class. */
  /** field_bgm.c sTrainerEncounterBGMs: {u16 trainer class, u16 eyes-meet sequence} (79 rows). */
  trainerEncounterBgms: { where: 'arm9', offset: 0xec3e0, count: 79, size: 4, sha1: 'd02810335656d029902fc3424c94cf1d25e89d6c' },
  trainerClassPrizes: { where: 16, offset: 0x359e0, count: 105, size: 1, sha1: 'f36fb97ec9e01aedcdaa95f602e45037208e8c2b' },
  /** ov16 sTypeMatchupMultipliers: 112 rows of [attacking, defending, ×10], the Foresight separator and the end row. */
  typeChart: { where: 16, offset: 0x33b94, count: 112, size: 3, sha1: '189d7165bf28d957a0ae4ffab5c05d43b25727fe' },
  /** map_header.c MapHeader_GetMapEvolutionMethod's mapEvolutionMethods: {u16 map header, u16 EVO_*} pairs. */
  mapEvolutions: { where: 'arm9', offset: 0xe5fc8, count: 21, size: 4, sha1: 'e7e354ebe5367b64134f6c875272727274f8d56a' },
  /** arm9 sSpawnLocations (spawn_locations.c): blackout and fly destinations, 16 bytes each. */
  spawnLocations: { where: 'arm9', offset: 0xe97b4, count: 20, size: 16, sha1: '666c9fe6c09b15ac9b0d927a740e1b4467674e00' },
  /** town_map/fly_locations.c sFlyLocations (the town map overlay 80): {int map header, int first arrival, u8 shape, u8 palette, u16 special, u32 x, u32 y}. */
  flyLocations: { where: 80, offset: 0x2458, count: 20, size: 20, sha1: '74083cc51af43a7f76795a1d705d1db774237e0d' },
  /** town_map/context.c sTownMapFlyLocationUnlockFlags: the FIRST_ARRIVAL_* number per fly location. */
  flyUnlockFlags: { where: 'arm9', offset: 0xefa84, count: 20, size: 1, sha1: '380cb86ab35c335460ae9c91b2e5a6416ad94962' },
  /** pokemon.c sNatureStatAffinities: 5 s8 per nature. */
  natureAffinities: { where: 'arm9', offset: 0xf0618, count: 25, size: 5, sha1: '48180501f54ffaff098e5c24fcc2d5be59358967' },
  /** mart_items.h PokeMartCommonItems: {u16 item, u16 requiredBadges}. */
  martCommon: { where: 'arm9', offset: 0xebafc, count: 19, size: 4, sha1: '629e5850dc3cb17581aea879813e36eeed80c6ea' },
  /** mart_items.h PokeMartSpecialties: a pointer per MART_SPECIALTIES_ID_*. */
  martSpecialties: { where: 'arm9', offset: 0x100b1c, count: 20, size: 4, sha1: '26e5e6547df95770d129d816bae163fa3201b9f1' },
  /** capsule_menu/main.c sealTypeValues: a row per seal id 0–80 (seals.ts). */
  sealTypes: { where: 'arm9', offset: 0xf64d0, count: 81, size: SEAL_TYPE_SIZE, sha1: 'b722c8b73768aadb1bd5caba5a8c3477a9c43978' },
  /** mart_items.h SunyshoreMarketDailyStocks: a pointer per MART_SEAL_ID_SUNYSHORE_* (Monday … Sunday) to a 0xFFFF-ended list. */
  sealMarts: { where: 'arm9', offset: 0x100b00, count: 7, size: 4, sha1: '8c6bc435bd5fe5d257264b242e39f1dbeeb48252' },
  /** ov12_02237EA0's delay table: a seal emitter's start delay in frames by distance step. */
  sealDelays: { where: 12, offset: 0x1b420, count: 7, size: 1, sha1: 'f5af31e595e4a5912f406ed78354562d53375f26' },
  /** ov12_02235E94.c Unk_ov12_0223AD70: the default ball-open burst per ball, {ball_particle member, emitter count} (s32 each). */
  ballOpenParticles: { where: 12, offset: 0x1b150, count: 20, size: 8, sha1: 'ac2a9cc8d2e6ea4be7263237a5e198d19779bb93' },
  /** gTrainerAITable (overlay trainer_ai = 14): the AI flag table and bytecode, through Terminate's PopOrEnd. */
  aiScript: { where: 14, offset: 0x4c84, count: 10607, size: 4, sha1: '981183191070373d80362e94c09f8456f7f4f793' },
  /** trainer_ai.c sNoDamageCalcMoveEffects, sAltPowerMoveEffects (u16, 0xFFFF-ended) and sWeightToPower. */
  aiNoDamageCalcEffects: { where: 14, offset: 0xf270, count: 14, size: 2, sha1: '44b093682184425b247b780acfc73c0bf5e7c06b' },
  aiAltPowerEffects: { where: 14, offset: 0xf258, count: 12, size: 2, sha1: '5e4992e0125cb85fb014522edea153ba9ac10550' },
  aiWeightToPower: { where: 14, offset: 0xf240, count: 6, size: 4, sha1: '553b95d575fcc69a758f22f2ba4d4332e5939595' },
  /**
   * Overlay 9 (ov9_02249960.c) from the first byte the Distortion World tables read to the last: the
   * waterfall command lists, the props, moving platforms, events, objects, connections and elevator
   * paths, and everything they point at (`DW_TABLES` gives each table's overlay offset).
   */
  distortionWorld: { where: 9, offset: 0x78b4, count: 0xa36c - 0x78b4, size: 1, sha1: '25f56c6b9a64630feb3175dcc7cf6367697c67e5' },
  /** gym_features.c: the gym puzzles' tables, from the camera thresholds to the Veilstone track (gyms/index.ts). */
  sunyshore: { where: 8, offset: SUNYSHORE_REGION.offset, count: SUNYSHORE_REGION.end - SUNYSHORE_REGION.offset, size: 1, sha1: 'ee85f34d1446a2ece93872270fbf5fa57fe655c7' },
  gyms: { where: 8, offset: GYM_REGION, count: 0x4ddc - GYM_REGION, size: 1, sha1: '11ab8b2eb14bb1dc8b5fc1d71f99c53d1ceef9b5' },
  /** ov5_021F47B0.c: Hearthome Gym's light, its rotation, scale and offset tables and fldeff members (gyms/index.ts). */
  hearthomeLight: { where: 5, offset: LIGHT_REGION.offset, count: LIGHT_REGION.end - LIGHT_REGION.offset, size: 1, sha1: '085a84e58ff8d0800dd14fb9a665f6ea72e31f07' },
  /** game_records.c sTrainerScoreIncrements: a u16 per TRAINER_SCORE_EVENT_*. */
  trainerScoreIncrements: { where: 'arm9', offset: 0xe5c68, count: GAME_RECORDS.scoreEvents, size: 2, sha1: 'fc3d43a3ff9ce1fa169245c87edd80c1a869d2ad' },
  /** game_records.c sUsesHighLimit: a u8 per RECORD_* (the ROM's table; the decomp's initializer lists only some of it). */
  /** persisted_map_features_init.c sCanalaveGymPlatformsStartInPositionB: a u8 per platform. */
  canalaveStarts: { where: 'arm9', offset: 0xf04cc, count: 24, size: 1, sha1: 'cc7843d77c3d8f2b3af2e892afd69e3934e3e029' },
  recordHighLimits: { where: 'arm9', offset: 0x100984, count: GAME_RECORDS.count, size: 1, sha1: 'bfa467896781e12f389479b35ba67c441f194f77' },
  /** scrcmd_move_tutor.c sTeachableMoves (tutorable_moves.h): {u16 move, u8 red, blue, yellow, green, u32 location}. */
  tutorMoves: { where: 5, offset: 0x2ff64, count: 38, size: TUTOR_MOVE_SIZE, sha1: 'e90e4e7565eb91a2999efc52e441cde50ceb41ab' },
  /** sSpeciesLearnsetsByTutor (MOVESET_MAX = 493 species + 12 forms): a 5-byte move mask per personal member − 1. */
  tutorMasks: { where: 5, offset: 0x3012c, count: 505, size: TUTOR_MASK_SIZE, sha1: '4967fa8c989250a5a4ffb0dd7cb2469167c76a2f' },
  /** game_start.c sBerryInitTable (berry_init.h, in the game-start overlay 57): {u16 berry item, u16 yield} per patch id. */
  berryInit: { where: 57, offset: 0x220, count: 118, size: 4, sha1: '99139a26758e52f5414f930388a0d760d273e0e7' },
  /** sBerryAndAccessoryManOptions (scrcmd_amity_square.c): Amity Square's man's 16 gifts (9 items, then accessories). */
  amityGifts: { where: 'arm9', offset: 0xebf64, count: 16, size: 2, sha1: '198589fce01ac265466f80edd8391740b2b51481' },
  /** Dance Competition (overlay 17, contest-dance.ts): Unk_ov17_02253084 songs, Unk_ov17_0225312C the song per rank × type, Unk_ov17_02252FC4 measure variants. */
  danceSongs: { where: 17, offset: 0x17f44, count: 7, size: DANCE_SONG_SIZE, sha1: '31a5ba84fe355b133f42ba4b5369c2227ddd5d6c' },
  danceChoice: { where: 17, offset: 0x17fec, count: 4 * 5, size: DANCE_CHOICE_SIZE, sha1: '24939bb9f28f8a3ddc1da7d36a70113ab9e60b4d' },
  danceVariants: { where: 17, offset: 0x17e84, count: 2, size: DANCE_VARIANT_SIZE, sha1: 'bcce75a6e79a849f4f8309cb0ccba8563638e1ec' },
  /** ov17_0224E930.c Unk_ov17_02254A80 (the AI's timing spread per level) and Unk_ov17_02254A84 (% a lead repeats its direction, per rank). */
  danceAiJitter: { where: 17, offset: 0x19940, count: DANCE_LEVELS, size: 1, sha1: '12dada1fff4d4787ade3333147202c3b443e376f' },
  danceAiRepeat: { where: 17, offset: 0x19944, count: DANCE_LEVELS, size: 1, sha1: 'dffc313d2c6a66b55d629ed905b1d07b59e7e1c1' },
  /** ov17_0224A0FC.c Unk_ov17_022546F4: the dancers' stage positions; ov17_022492DC.c Unk_ov17_02254564: the step buttons' touch rects and terminator. */
  danceStage: { where: 17, offset: 0x195b4, count: DANCE_POSITIONS, size: 6, sha1: 'cd7b971cfd7bc08f7652830e01db24bc596550c2' },
  danceButtons: { where: 17, offset: 0x19424, count: DANCE_BUTTONS + 1, size: 4, sha1: 'ca58258fcbba629f043c7fed6cd249a34929cad5' },
  /** ov17_0224A0FC.c Unk_ov17_022546CC (grade pop-ups), Unk_ov17_022549BC (note rows), Unk_ov17_022546DC (stage tints), Unk_ov17_022549C0 (shades by place). */
  danceGrades: { where: 17, offset: 0x1958c, count: DANCE_POSITIONS, size: 4, sha1: 'f3bc8e4853d83f91a35424cb32fe6222740655cc' },
  danceNoteRows: { where: 17, offset: 0x1987c, count: DANCE_POSITIONS, size: 1, sha1: '32217dbbd17725103461f1d227c683ba9f731709' },
  danceTints: { where: 17, offset: 0x1959c, count: DANCE_TINTS, size: 4, sha1: '42a74eb957bd05544df1707a1ce02807dab6cbbb' },
  danceShades: { where: 17, offset: 0x19880, count: DANCE_POSITIONS, size: 1, sha1: 'e103557ffbeb74541a66d7815fcf0bb85ebbe780' },
  /** sMonFindableAccessories: the 6 pools of 10 accessories a walking Pokémon finds. */
  amityFinds: { where: 'arm9', offset: 0xebf84, count: 60, size: 2, sha1: '496aec185ca0a68b2a9477ffc26efa183a81953f' },
  /** end_credits/strings.c sEndCreditStringProps (the end_credits overlay): {u16 message, u16 y, u16 centred} per staff row. */
  credits: { where: 99, offset: 0x3f64, count: 237, size: 6, sha1: '95df5e39b155b5bc01cb31e1ac31ff83a5fa5378' },
  creditsRows: { where: 99, offset: 0x46b4, count: 6, size: 28, sha1: 'a58fb22e4fe0854a129637d1edcabefa24d1e2d7' },
  creditsTrees: { where: 99, offset: 0x3f2c, count: 28, size: 2, sha1: '8c372dcca2be868b72778a81f3194054152f676f' },
  /** The Battle Frontier (frontier.ts `FrontierRomTables`). */
  frontierScenes: { where: 104, offset: 0x116b4, count: 17, size: 40, sha1: 'bce278b5df36cc052d76ec8e60e8e08c5ccef1e5' },
  towerRanges: { where: 'arm9', offset: 0xebd58, count: 8, size: 4, sha1: 'fd8751a5c9afaf2a532170b4085583e1705705fb' },
  towerBossRanges: { where: 'arm9', offset: 0xebd78, count: 8, size: 4, sha1: 'e0a650cabc0b6e10aa275a410a39a49c4d06746e' },
  towerReservedItems: { where: 'arm9', offset: 0xebd50, count: 4, size: 2, sha1: 'a1b255faccd76b25bdb75f306bddef8e4bef4990' },
  towerBattlePoints: { where: 'arm9', offset: 0xebd30, count: 8, size: 1, sha1: '020b754f8c87750f54ef1ad789d92dc81537594b' },
  towerClassObjects: { where: 104, offset: 0x115b8, count: 63, size: 4, sha1: '11f0f9b7a112d2c20d807b476f4d1ab45e3f05e4' },
  frontierCharacters: { where: 63, offset: 0x2b40, count: 151, size: 4, sha1: 'ee81567142d4f2f4eede8bccc1703b4bde8ac84f' },
  frontierObjects: { where: 104, offset: 0x13af8, count: 4, size: 52, sha1: 'dcbba738f6399c6fc7a42d2d8ea8db7d5ab2dd97' },
  frontierBpPrices: { where: 7, offset: 0x5a98, count: 41, size: 4, sha1: 'eb10aa37bf539a6f0e7a5db13d930a427d1452ab' },
  frontierMartLeft: { where: 'arm9', offset: 0xeac20, count: 27, size: 2, sha1: '60fb58b301acf716e6a7cdcf3b4711bfd31f9add' },
  frontierMartRight: { where: 'arm9', offset: 0xeabb8, count: 16, size: 2, sha1: '8a10d46ff0675f5d9d90e584c2bb9776e402c880' },
  frontierBanlist: { where: 'arm9', offset: 0xf05be, count: 18, size: 2, sha1: '6f80ec8e0e1576663aefacd8c3873739a5cb0cca' },
  /** The Battle Factory (frontier.ts `FrontierRomTables.factory`): overlay 104 battle_factory_helpers.c and battle_factory.c. */
  factoryOpponentPools: { where: 104, offset: 0x1251c, count: 8, size: 8, sha1: '2ab5c1509c794cb56e58c3bb555d0b5df1f3ac9b' },
  factoryTradeUpgrades: { where: 104, offset: 0x12508, count: 5, size: 4, sha1: '255973581dd007f803c7fd4498c221f17dc9a37e' },
  factoryOpenPlayerPools: { where: 104, offset: 0x1255c, count: 10, size: 8, sha1: '1a7492ee6bfc76a6849e0aa84f0d032cdfb04c8b' },
  factoryLevel50Pools: { where: 104, offset: 0x125ac, count: 10, size: 8, sha1: '983c03995645a07f02a9fb3cd2e388248ca864fe' },
  factoryOpenOpponentPools: { where: 104, offset: 0x125fc, count: 10, size: 8, sha1: '2e1275a5c83ad0d2e38e200a5c1d85d0842c3415' },
  factoryBattlePoints: { where: 104, offset: 0x11d54, count: 9, size: 1, sha1: 'ab2a051f7a39a4f72ada20693b1f26a8ffed3191' },
  /** The Battle Hall (frontier.ts `FrontierRomTables.hall`): overlay 104 battle_hall_helpers.c and battle_hall.c, arm9 scrcmd_battle_hall.c. */
  hallBattlePoints: { where: 104, offset: 0x11d7c, count: 19, size: 1, sha1: 'dd72b4325f5c993ad927c0693d743f88261a4091' },
  hallIvs: { where: 104, offset: 0x1265c, count: 10, size: 4, sha1: 'f9fcb2b99eb52071083d0f4d001f8abbd0480b39' },
  hallGroupRanges: { where: 104, offset: 0x1264c, count: 4, size: 4, sha1: '95bccd3b2d8d22f027544470c7ae7997264c874b' },
  hallRankRanges: { where: 104, offset: 0x12684, count: 10, size: 4, sha1: '5c59e4d6f37f83493daccfca7225b74a0e9c5ce1' },
  hallGrid: { where: 104, offset: 0x13564, count: 20, size: 1, sha1: '8c466468bfadeafcc0392d65924c10c7e46c2333' },
  hallOpponents: { where: 104, offset: 0x12a34, count: 477, size: 2, sha1: 'd955029c4b9af0b65477d2220b4b28245a1b6ce4' },
  hallOpponentTypes: { where: 104, offset: 0x12dee, count: 477, size: 4, sha1: '7a907864f9a5e3b8dbf95adc8c01b2bd5cd98cf0' },
  hallMilestones: { where: 'arm9', offset: 0xec078, count: 47, size: 8, sha1: '683ca120ae558ed840c9778f87bbde73940f78e1' },
  hallClassesByRank: { where: 104, offset: 0x1273c, count: 10, size: 16, sha1: 'bf311dd5c5c7e454e19f4171dd097fbd74000efb' },
  hallClassesByCell: { where: 104, offset: 0x126ac, count: 18, size: 8, sha1: '8aee14452d6802f4cbc7f47c08dac9afe58e6626' },
  hallTrainerClasses: { where: 104, offset: 0x127dc, count: 300, size: 2, sha1: 'c80f888edd52fa7c3d52ae3cffc3f132d06b2f9e' },
  /**
   * The Battle Castle (frontier.ts `FrontierRomTables.castle`): overlay 104 battle_castle_helpers.c and battle_castle.c,
   * overlay 107 (battle_castle_app) self_app.c.
   */
  castleOpponentPools: { where: 104, offset: 0x13578, count: 8, size: 8, sha1: '2ab5c1509c794cb56e58c3bb555d0b5df1f3ac9b' },
  castleBattlePoints: { where: 104, offset: 0x11dd4, count: 9, size: 1, sha1: '58aa2dda738e42172b00a162a85e29119c66c9c0' },
  castleItems: { where: 107, offset: 0x84a4, count: 27, size: 2, sha1: '584bff214ba2f185708b09fbba2b14e42d6b92e2' },
  castleItemPrices: { where: 107, offset: 0x84da, count: 27, size: 2, sha1: '7e99e64dc8b4d1754336f841206b522a35b3b160' },
  castleBerries: { where: 107, offset: 0x854c, count: 32, size: 2, sha1: '2c6f730240bc820dd45a41fdcc16f2502b52a15c' },
  castleBerryPrices: { where: 107, offset: 0x858c, count: 32, size: 2, sha1: '48c23249e7efc39bf58c9936107678ce714b91b7' },
  castleItemsByRank: { where: 107, offset: 0x8326, count: 3, size: 2, sha1: '9fc116d68ae2be83f6738dceecb1754867b9c512' },
  castleBerriesByRank: { where: 107, offset: 0x8332, count: 3, size: 2, sha1: 'b86c0c4a865ace0a2f7fe53351dd9a24aa045a8e' },
  castleHealCosts: { where: 107, offset: 0x832c, count: 3, size: 2, sha1: '76c81c905d6fbe59be6513f6f185ea45e7f6e968' },
  castleRankUpCosts: { where: 107, offset: 0x8366, count: 9, size: 2, sha1: '9d30339ba1aa61b63fb8a6a597129f1ae3788ae9' },
  /**
   * The Battle Arcade (frontier.ts `FrontierRomTables.arcade`): overlay 104 battle_arcade_helpers.c and battle_arcade.c,
   * overlay 108 (battle_arcade_app) main.c.
   */
  arcadeOpponentPools: { where: 104, offset: 0x135b8, count: 8, size: 8, sha1: '2ab5c1509c794cb56e58c3bb555d0b5df1f3ac9b' },
  arcadeBattlePoints: { where: 104, offset: 0x11f9c, count: 9, size: 1, sha1: '6b0dc0ead2589e847590c921e484bcbc0068077d' },
  arcadeRouletteSpeeds: { where: 104, offset: 0x11e18, count: 3, size: 2, sha1: '9e21dbc7e35236dd5449ee61a0d325bd853e038d' },
  arcadePerformanceStatus: { where: 104, offset: 0x11e10, count: 5, size: 1, sha1: '4958f5be04f735dcde1a0586c6943bf0056479e1' },
  arcadePerformanceFainted: { where: 104, offset: 0x11e08, count: 5, size: 1, sha1: 'c1a087c835f81356e793d34766f565e4369383b7' },
  arcadePerformanceTurns: { where: 104, offset: 0x11e1e, count: 5, size: 2, sha1: '5bf7b2c044f0bc45539387e62cb1a5d30069168a' },
  arcadeBerryPool1: { where: 104, offset: 0x11e28, count: 8, size: 2, sha1: 'a9869919d5a7a871d64c5148be45f7f18e2df49e' },
  arcadeBerryPool2: { where: 104, offset: 0x11eb2, count: 20, size: 2, sha1: 'b695a559e5539dada90aa7ba1727587842cb2057' },
  arcadeBerryPool3: { where: 104, offset: 0x11e58, count: 10, size: 2, sha1: 'c133f2e1a512ff402dc36a7d1585ecb388fb25b9' },
  arcadeItemPool1: { where: 104, offset: 0x11e6c, count: 11, size: 2, sha1: '1b358c15dc086a5b5c190beaf92053a30c81e3e8' },
  arcadeItemPool2: { where: 104, offset: 0x11e98, count: 13, size: 2, sha1: '95790f72c3cf827d270586acd6e6d920edb9aa5b' },
  arcadeItemPool3: { where: 104, offset: 0x11e82, count: 11, size: 2, sha1: '5c004b5cbfdcb9a401cfd66dfc5c975eefcd172f' },
  arcadeScreens: { where: 104, offset: 0x11eda, count: 32, size: 6, sha1: 'fec77102914609cc542cdd2ce865f69cf04b87b5' },
  arcadeCursorFrames: { where: 108, offset: 0x1baf, count: 8, size: 2, sha1: 'b28388e8cbe100cf44a44447bd06269b1d4a8756' },
  arcadeEffectsByRound: { where: 108, offset: 0x1c38, count: 32, size: 1, sha1: '5c0c95a686905a49778ecd10cf2f996ab5f549a1' },
  arcadeEffectsByBattle: { where: 108, offset: 0x1ba0, count: 7, size: 1, sha1: '3d5e6f87852c11a8f069553dcf41ab4728316396' },
  arcadeCategoryWeights: { where: 108, offset: 0x1bd0, count: 5, size: 4, sha1: 'e727eb59688b36aec13eb9516a978578d33e91f2' },
  arcadeCategoryThresholds: { where: 108, offset: 0x1b9c, count: 4, size: 1, sha1: 'd9ea312d5d01d23d13aac15db838e6d671dc636c' },
  /** ov5_021F6454.c sHighestIVMessageIndices: the judge's "best potential in …" message per stat (TEXT_BANK_BATTLE_TOWER). */
  judgeStatsMessages: { where: 5, offset: 0x2ff04, count: 6, size: 2, sha1: '1811b05e153df12434fa2e0d3e1d60b928360eec' },
  /** The contests' acting round (contest-acting.ts): arm9 Unk_020F568C, then overlay 17's tables (RAM base 0x0223B140). */
  contestEffects: { where: 'arm9', offset: 0xf568c, count: CONTEST_EFFECTS, size: EFFECT_SIZE, sha1: '59732b6c4721be3972a0bdbe2c49d50dad609b58' },
  contestEffectClasses: { where: 17, offset: 0x189b8, count: CONTEST_EFFECTS, size: EFFECT_CLASS_SIZE, sha1: '5901df2f40af6d21e882144b5d717a6e3ab6f4c7' },
  contestTypeMatch: { where: 17, offset: 0x18888, count: 25, size: 1, sha1: '43b0c5de31685d06cce74bc24ef8e252e3290862' },
  contestActingMessages: { where: 17, offset: 0x187b0, count: ACTING_MESSAGES, size: 4, sha1: 'efe260c58c8c545077b2b11c51bd1a44a95f1d0d' },
  contestAiRules: { where: 17, offset: 0x18af0, count: AI_RULES, size: AI_RULE_SIZE, sha1: 'fc154d44a628d2943337163a6fcccce44373db8a' },
  contestButtonPalettes: { where: 17, offset: 0x18378, count: BUTTON_PALETTES * 16, size: 2, sha1: '88229a78266a8e8de6b1f9f93f3fdee09ac60f55' },
  /** The Game Corner (slots.ts, docs/research/game-corner.md §3): arm9's machine modes and prizes, then overlay 101's tables (RAM base 0x021D0D80). */
  slotModes: { where: 'arm9', offset: 0xea17c, count: 12, size: 1, sha1: 'c24ba7efc829cc45b324f5a4b181897495e182f9' },
  slotPrizes: { where: 'arm9', offset: 0xec018, count: SLOT_PRIZES, size: 4, sha1: '5dbdef6918073da6526d07dcc8014e4c65a00576' },
  slotReels: { where: 101, offset: 0x8908, count: 3, size: 84, sha1: '3121f7360c16df1344591a6e68e2ba33221ede8d' },
  slotPayouts: { where: 101, offset: 0x87d0, count: 6, size: 4, sha1: 'e1bd6f6fb960e5fd39be9585445e5b82100ab9b7' },
  slotBonusPayouts: { where: 101, offset: 0x8770, count: 6, size: 4, sha1: 'c8ec2041187dd608dc149d69bb20e9838fecfc60' },
  slotWinChance: { where: 101, offset: 0x87a0, count: 6, size: 4, sha1: '97bf9e77ebd371fcd83237504ad184ca39bd37da' },
  slotWinFlags: { where: 101, offset: 0x8848, count: 6, size: 16, sha1: '45b0afa684fc577a16e1f343a24b79f41e8a0b86' },
  slotHintChance: { where: 101, offset: 0x8758, count: 6, size: 4, sha1: '7d78874fa16072c936e6b652e18f933b2e2124f4' },
  slotStandbySmall: { where: 101, offset: 0x87b8, count: 6, size: 4, sha1: '97bf9e77ebd371fcd83237504ad184ca39bd37da' },
  slotStandbyFlags: { where: 101, offset: 0x88a8, count: 6, size: 16, sha1: '293cf9557e2f51f9280b53ba7f34b3e2f3f39a35' },
  slotBonusTypes: { where: 101, offset: 0x8bb4, count: 6, size: 72, sha1: 'eabf869cce965162aa3ffb6247284ea97f5950dc' },
  slotContinueStart: { where: 101, offset: 0x87e8, count: 6, size: 4, sha1: '9f9e7094ee66fdd3ea6786afd4ec1696bd2c9a77' },
  slotClefairyKinds: { where: 101, offset: 0x8a04, count: 6, size: 72, sha1: '0f8643315300bb323da842d5302eda187f8c35c0' },
  slotRedMoon: { where: 101, offset: 0x8788, count: 6, size: 4, sha1: '6b0b9ad4867b961b8cac17714afac273c219b7db' },
  slotBlueMoon: { where: 101, offset: 0x8800, count: 6, size: 4, sha1: 'b5d6d05018a6fc3563add35ee2f46a9e4a427c08' },
  slotContinueDrop: { where: 101, offset: 0x8818, count: 6, size: 8, sha1: 'a24f2e5c827f74097f907a5f601c036badd49d0e' },
  slotEndTells: { where: 101, offset: 0x8d64, count: 6, size: 144, sha1: '3d7937809c53136636b0db175b94206dd1dd70fa' },
  slotBonusOrders: { where: 101, offset: 0x7a28, count: 6, size: 24, sha1: '3a4b2b7f18c2088028e8da3d05858c31b071af11' },
  slotStopButtons: { where: 101, offset: 0x79c0, count: 3, size: 8, sha1: '1c216e31ae69c1606894b667ad44597e11c91650' },
  slotLightShow: { where: 101, offset: 0x7bb8, count: LIGHT_SHOW, size: 16, sha1: 'cc6c969829c25576ca495a481014306adb3ba40a' },
  slotLinePalettes: { where: 101, offset: 0x90e0, count: 5, size: 4, sha1: '33559b68e604100d3ca8a843f696b543e58b9e10' },
  slotSymbolAnims: { where: 101, offset: 0x84fc, count: 6, size: 4, sha1: 'db17e883a647963a26d973378923ef4649801319' },
  slotHintSprites: { where: 101, offset: 0x8654, count: 5, size: 16, sha1: '5af1a80c79120193cf15b5957b9126eee685fa50' },
  slotClefairySprites: { where: 101, offset: 0x8624, count: 3, size: 16, sha1: 'ec816e28bbb30185dff30aa69d6ea457721b0491' },
  slotLineFlash: { where: 101, offset: 0x86a4, count: 15, size: 12, sha1: 'cabb6bf607c57d3f93d8784109c7b5426d053a75' },
  slotMessageWindow: { where: 101, offset: 0x7808, count: 1, size: 8, sha1: 'fa57d7eedc5bce8216ff803b0a1e7d2b36c1bd8f' },
  /** The Villa (town-extras.ts): overlay005/villa_furniture.c sVillaFurnitures, sVillaFurnitureModelIDs, sVillaFurnitureScriptIDs. */
  villaFurnitures: { where: 5, offset: 0x30bac, count: 23, size: VILLA_ROW_SIZE, sha1: '1e4153890ff365b42efa8d7e5d946c0cc46f1264' },
  villaFurnitureModels: { where: 5, offset: 0x30b0c, count: 20, size: 4, sha1: 'e6b588c1393645f83d637810a239d98986c23b57' },
  villaFurnitureScripts: { where: 5, offset: 0x30b5c, count: 20, size: 4, sha1: '54b69a0e1b6256a20803f9872be96942df84faef' },
  /** system_vars.c sNumPossibleVillaVisitors (u8 × 3) and sVillaVisitorPercentChances (u8 × 3). */
  villaVisitorCounts: { where: 'arm9', offset: 0xefa6c, count: 3, size: 1, sha1: '137eb7237c866fe1409e7196a37aaf21ebf6470a' },
  villaVisitorChances: { where: 'arm9', offset: 0xefa70, count: 3, size: 1, sha1: '6442add075d55961da0127e7affc33da9d54a58e' },
  /** journal.c sGymsInfo and sMapsInfo; journal_controller.c Unk_ov81_021D33E8 (the page-turn wipe). */
  journalGyms: { where: 'arm9', offset: 0xe5b50, count: 8, size: 8, sha1: '994042d1434960e8c09c39489b17751b43463803' },
  journalBuildings: { where: 'arm9', offset: 0xe5b90, count: 27, size: 8, sha1: '9d43b00d536d0cbac0567ea6da46c9f2cf57250c' },
  journalPageTurn: { where: 81, offset: 0x2668, count: 9, size: 32, sha1: '0a3da3dd9b74045457514423963c1a0415a08196' },
} as const;
/** The US layout of these tables (tools/relocate.ts finds them in other builds). */
export { TABLES as PLATINUM_TABLES };

/** Overlay 9 offsets of the Distortion World tables, inside `TABLES.distortionWorld`. */
const DW_TABLES: Overlay9Layout = {
  cascadeUp: 0x7a78, // sMapEventB5F_Waterfall
  cascadeDown: 0x7ad8, // sMapEventB4F_Waterfall
  simpleProps: 0x8be8, // sSimplePropsMapTemplates
  movingPlatforms: 0x92d8, // sMovingPlatformsMapTemplates
  mapEvents: 0x93d8, // sMapEvents
  objectEvents: 0x9554, // sMapObjectEvents
  connections: 0x9744, // sDistWorldMapConnectionList
  elevatorPaths: 0x9ed0, // sElevatorPlatformPaths
};

/** The modern options' labels (original wording, ours): the OPTIONS row and its description; the QoL additions' texts.
 * The `Lantern_` ids are the pre-rename names, kept: stored imports and mods use them. */
const MODERN_OPTION_TEXTS_EN = {
  Lantern_Options_TradeEvolution: 'TRADE EVOS',
  Lantern_Options_TradeEvolutionDescription: 'Pokémon that evolve by trading\nevolve by leveling up instead.',
  Lantern_Options_FollowerStyle: 'FOLLOWER STYLE',
  Lantern_Options_FollowerStyleDescription: 'When you stop, your follower stands\nstill or walks in place.',
  Lantern_Options_FollowerStill: 'Still',
  Lantern_Options_FollowerWalk: 'Walk in place',
  Lantern_Options_Followers: 'FOLLOWING',
  Lantern_Options_AutoLowercase: 'AUTO LOWERCASE',
  Lantern_Options_AutoLowercaseDescription: 'The naming keyboard switches to\nlowercase after the first letter.',
  Lantern_Options_FollowersDescription: 'The first Pokémon in your party\nwalks behind you.',
  // The quality-of-life options and the texts their additions show in the game's own screens (ROM font, our words).
  Lantern_Options_AutoRun: 'AUTO-RUN',
  Lantern_Options_AutoRunDescription: 'With the Running Shoes you run\nwithout holding B. Hold B to walk.',
  Lantern_Options_RepelPrompt: 'REPEL PROMPT',
  Lantern_Options_RepelPromptDescription: 'When a Repel wears off, asks to\nuse another one from the Bag.',
  Lantern_Options_ItemWheel: 'ITEM WHEEL',
  Lantern_Options_ItemWheelDescription: 'REGISTER up to four items. Hold Y\nto choose one; a tap uses the last.',
  Lantern_Options_FollowerTalk: 'FOLLOWER TALK',
  Lantern_Options_FollowerTalkDescription: 'Talk to the Pokémon following you.\nNeeds the HGSS add-on.',
  Lantern_Options_StatView: 'EV/IV VIEW',
  Lantern_Options_StatViewDescription: 'A on the summary\'s SKILLS page\nshows effort and individual values.',
  Lantern_Options_Rename: 'RENAME',
  Lantern_Options_RenameDescription: 'Rename your own Pokémon from\nthe summary\'s INFO page.',
  Lantern_Options_DexNameSearch: 'NAME SEARCH',
  Lantern_Options_DexNameSearchDescription: 'The Pokédex search can look for\na name you type.',
  Lantern_Options_Character: 'CHARACTER',
  Lantern_Options_CharacterDescription: 'Your look in the field. HGSS uses\nthe add-on\'s Ethan or Lyra.',
  Lantern_Options_CharacterPlatinum: 'PLATINUM',
  Lantern_Options_CharacterHgss: 'HGSS',
  Lantern_Repel_UseAnother: 'Use another {var 0}?',
  Lantern_Pokedex_ByName: 'TYPE A NAME',
  Lantern_Naming_DexSearch: 'Look for which name?',
  Lantern_Summary_Rename: 'RENAME',
  Lantern_Summary_CantRename: '{var 0} came from another\nTrainer, so it can\'t be renamed.',
  Lantern_Summary_Stats: 'STATS',
  Lantern_Summary_Evs: 'EV',
  Lantern_Summary_Ivs: 'IV',
  Lantern_Options_SpiritombVendors: 'SPIRITOMB',
  Lantern_Options_SpiritombVendorsDescription: 'Underground vendors you talk to\ncount as people met for Spiritomb.',
  Lantern_Contest_Placeholder: '{var 0}\nPlaceholder: scored by condition.',
  Lantern_Contest_Visual: 'VISUAL',
  Lantern_Contest_Dance: 'DANCE',
  Lantern_Contest_Acting: 'ACTING',
  Lantern_Contest_Total: 'TOTAL',
};

/** The same in German (our words; labels in capitals and terms as the German game has them). */
const MODERN_OPTION_TEXTS: Record<RomLanguage, Record<keyof typeof MODERN_OPTION_TEXTS_EN, string>> = {
  en: MODERN_OPTION_TEXTS_EN,
  de: {
    Lantern_Options_TradeEvolution: 'TAUSCH-ENTW.',
    Lantern_Options_TradeEvolutionDescription: 'Tausch-Entwicklungen geschehen\nstattdessen durch Level-Aufstieg.',
    Lantern_Options_FollowerStyle: 'BEGLEITSTIL',
    Lantern_Options_FollowerStyleDescription: 'Wenn du stehst, steht dein Begleiter\nstill oder läuft auf der Stelle.',
    Lantern_Options_FollowerStill: 'Stehen',
    Lantern_Options_FollowerWalk: 'Auf der Stelle',
    Lantern_Options_Followers: 'BEGLEITER',
    Lantern_Options_AutoLowercase: 'KLEINSCHREIBUNG',
    Lantern_Options_AutoLowercaseDescription: 'Nach dem ersten Buchstaben schreibt\ndie Tastatur klein weiter.',
    Lantern_Options_FollowersDescription: 'Das erste Pokémon in deinem Team\nläuft hinter dir her.',
    Lantern_Options_AutoRun: 'AUTO-RENNEN',
    Lantern_Options_AutoRunDescription: 'Mit Turbotretern rennst du, ohne B\nzu halten. Halte B, um zu gehen.',
    Lantern_Options_RepelPrompt: 'SCHUTZ-FRAGE',
    Lantern_Options_RepelPromptDescription: 'Wirkt Schutz nicht mehr, kannst du\ngleich einen neuen einsetzen.',
    Lantern_Options_ItemWheel: 'ITEM-RAD',
    Lantern_Options_ItemWheelDescription: 'Registriere bis zu vier Items. Halte\nY zum Wählen, tippe für das letzte.',
    Lantern_Options_FollowerTalk: 'ANSPRECHEN',
    Lantern_Options_FollowerTalkDescription: 'Sprich dein folgendes Pokémon an.\nBraucht das HGSS-Add-on.',
    Lantern_Options_StatView: 'EV/IV-ANSICHT',
    Lantern_Options_StatViewDescription: 'A auf der Seite POKéMON-FÄHIG. zeigt\nFleißpunkte und Individualwerte.',
    Lantern_Options_Rename: 'UMBENENNEN',
    Lantern_Options_RenameDescription: 'Benenne deine eigenen Pokémon auf\nder Seite POKéMON-INFO um.',
    Lantern_Options_DexNameSearch: 'NAMENSSUCHE',
    Lantern_Options_DexNameSearchDescription: 'Die Pokédex-Suche findet auch\neinen Namen, den du eingibst.',
    Lantern_Options_Character: 'FIGUR',
    Lantern_Options_CharacterDescription: 'Dein Aussehen im Feld. HGSS nutzt\ndie Figuren aus dem Add-on.',
    Lantern_Options_CharacterPlatinum: 'PLATIN',
    Lantern_Options_CharacterHgss: 'HGSS',
    Lantern_Repel_UseAnother: 'Noch einmal {var 0} einsetzen?',
    Lantern_Pokedex_ByName: 'NAME EINGEBEN',
    Lantern_Naming_DexSearch: 'Nach welchem Namen suchen?',
    Lantern_Summary_Rename: 'UMBENENNEN',
    Lantern_Summary_CantRename: '{var 0} stammt von einem anderen\nTrainer und behält seinen Namen.',
    Lantern_Summary_Stats: 'WERTE',
    Lantern_Summary_Evs: 'EV',
    Lantern_Summary_Ivs: 'IV',
    Lantern_Options_SpiritombVendors: 'KRYPPUK',
    Lantern_Options_SpiritombVendorsDescription: 'Händler im Untergrund, die du\nansprichst, zählen für Kryppuk.',
    Lantern_Contest_Placeholder: '{var 0}\nPlatzhalter: nach Zustand bewertet.',
    Lantern_Contest_Visual: 'MODEL',
    Lantern_Contest_Dance: 'TANZ',
    Lantern_Contest_Acting: 'AKTION',
    Lantern_Contest_Total: 'GESAMT',
  },
};

/** Offsets inside a pinned region, moved with it (the region matched whole, so its insides kept their places). */
function shiftLayout<L extends { [K in keyof L]: number }>(offsets: L, by: number): L {
  return Object.fromEntries((Object.entries(offsets) as [string, number][]).map(([k, o]) => [k, o + by])) as L;
}

/** Map header map types (decomp MAP_TYPE_*), measured on the ROM: 1 town/city, 2 outdoors, 3 cave, 4 indoors. */
/** The zone header's battle backdrop (decomp MapHeader_GetBattleBG → BACKGROUND_*). */
function battleBackground(bg: number, zone: Id): Id {
  const name = BACKGROUNDS[bg];
  if (!name) throw new ImportError(`${zone}: battle background ${bg} is not a BACKGROUND_*`);
  return asId(`platinum:BACKGROUND_${name}`);
}

const MAP_TYPES: Record<number, Zone['mapType']> = { 1: 'town', 2: 'outdoors', 3: 'cave', 4: 'indoors' };
/** decomp MAP_TYPE_INDOORS, MAP_TYPE_POKECENTER (MapHeader_IsBuilding). */
const BUILDING_MAP_TYPES = new Set([4, 5]);

/**
 * decomp FieldMap_ChangeZone and FieldSystem_RequestLocationName: a crossing shows window id − 1 (window
 * 0 shows style 0); a warp shows nothing for window 0 or a building.
 */
function mapPopup(h: { mapLabelText: number; mapLabelWindow: number; mapType: number }, zone: Id): MapPopup {
  const style = h.mapLabelWindow === 0 ? 0 : h.mapLabelWindow - 1;
  if (style >= MAP_POPUP_STYLES.length) throw new ImportError(`${zone}: map label window ${h.mapLabelWindow}`);
  return { label: h.mapLabelText, window: mapPopupSheet(style), onWarp: h.mapLabelWindow !== 0 && !BUILDING_MAP_TYPES.has(h.mapType) };
}
const OBJECT_DIRS: Facing[] = ['up', 'down', 'left', 'right'];
/** decomp BG_EVENT_DIR_*: NORTH, EAST, WEST, SOUTH, ALL, WEST_EAST, NORTH_SOUTH. */
const BG_DIRS: BgEvent['facing'][] = ['up', 'right', 'left', 'down', 'any', 'horizontal', 'vertical'];
const BG_KINDS: BgEvent['kind'][] = ['interact', 'sign', 'hidden-item'];
/** Decomp SCRIPT_ID_OFFSET_HIDDEN_ITEMS and HIDDEN_ITEM_FLAGS_START (the first hidden item's flag). */
const SCRIPT_ID_OFFSET_HIDDEN_ITEMS = 8000;
const HIDDEN_ITEM_FLAGS_START = 730;
/** Trainer scripts (decomp script_manager.h, Script_GetTrainerID): 3000+ battler 0, 5000+ battler 1; trainer id = script − base + 1. */
const SCRIPT_ID_SINGLE_BATTLES = 3000;
const SCRIPT_ID_DOUBLE_BATTLES = 5000;
const SCRIPT_ID_VISIBLE_ITEMS = 7000;
/** Battles_ApproachingTrainer = SCRIPT_ID(SINGLE_BATTLES, MAX_TRAINERS) (decomp FieldSystem_CheckForTrainersWantingBattle). */
const SCRIPT_ID_TRAINER_APPROACH = 3928;
/** Decomp SCRIPT_ID(COMMON_SCRIPTS, 32): CommonScript_RepelsEffectWoreOff (Repel_UpdateSteps). */
const SCRIPT_ID_REPEL_WORE_OFF = 2032;
/** Decomp SCRIPT_ID(COMMON_SCRIPTS, 31): CommonScript_HatchEgg (Field_UpdateDaycare). */
const SCRIPT_ID_HATCH_EGG = 2031;
/** A press facing a tile behaviour (decomp Field_TileBehaviorToScript): script id and the facing it needs. */
const TILE_BEHAVIOR_SCRIPTS: Record<string, { script: number; facing: Facing | 'any' }> = {
  PC: { script: 2018, facing: 'up' },
  SMALL_BOOKSHELF_1: { script: 2500, facing: 'any' },
  SMALL_BOOKSHELF_2: { script: 2501, facing: 'any' },
  BOOKSHELF_1: { script: 2502, facing: 'any' },
  BOOKSHELF_2: { script: 2503, facing: 'any' },
  TRASH_CAN: { script: 2504, facing: 'any' },
  MART_SHELF_1: { script: 2505, facing: 'any' },
  MART_SHELF_2: { script: 2506, facing: 'any' },
  MART_SHELF_3: { script: 2507, facing: 'any' },
  TOWN_MAP: { script: 2508, facing: 'any' },
  TV: { script: 10100, facing: 'up' },
};
/**
 * Facing-tile field moves (decomp field_control.c A press, and FieldMoves_SetUsableMoves): the
 * `FIELD_MOVES` script (SCRIPT_ID(FIELD_MOVES, n) = 10000 + n) each behaviour starts. Surf = every
 * behaviour with TILE_BEHAVIOR_FLAG_SURFABLE (map_tile_behavior.c sTileBehaviorFlags), except the
 * waterfall, which the A press checks first.
 */
const FIELD_MOVES_SCRIPT = 10000;
const SURFABLE = ['WATER_RIVER', 'UNUSED_x11', 'UNUSED_x12', 'UNUSED_x14', 'WATER_SEA', 'UNUSED_x19', 'UNUSED_x22', 'UNUSED_x2A', 'UNUSED_x50', 'UNUSED_x51', 'UNUSED_x52', 'UNUSED_x53', 'BRIDGE_OVER_WATER', 'BIKE_BRIDGE_N_S_OVER_WATER', 'BIKE_BRIDGE_E_W_OVER_WATER'];
const TILE_FIELD_MOVES: Record<string, { move: string; script: number }> = {
  ...Object.fromEntries(SURFABLE.map((b) => [b, { move: 'MOVE_SURF', script: 4 }])),
  WATERFALL: { move: 'MOVE_WATERFALL', script: 6 },
  ROCK_CLIMB_N_S: { move: 'MOVE_ROCK_CLIMB', script: 3 },
  ROCK_CLIMB_E_W: { move: 'MOVE_ROCK_CLIMB', script: 3 },
};

/** decomp OVERWORLD_WEATHER_YEARLY_START. */
const YEARLY_WEATHER_START = 32;
const NEW_GAME = { zone: 415, x: 4, z: 6, facing: 'up' as Facing, money: 3000, script: 9600 };
const MAP_HEADER_DYNAMIC = 4095;
/** Build models of the Pokémon Center healing machine, its screen and its balls (decomp map_prop_models.order: pokecenter_healing_machine, …_tv, …_mini_pokeball) and the Hall of Fame machine (pokemon_league_hall_of_fame_machine). */
const HEAL_MACHINE = { machine: 123, ball: 517, hallOfFame: 507, screen: 124 };
/** Decomp prop_models.naix: eterna_gym_model_clock_hour_hand, _minute_hand (gym_features.c sEternaGymClockModelIds). */
const CLOCK_HAND_PROPS = { hour: 537, minute: 536 };
/** Decomp map_prop_models.order: pastoria_gym_blue_button, _green_button, _orange_button, _water_floor (gym_features.c). */
const PASTORIA_PROPS = { blue: 239, green: 240, orange: 241, water: 242 };
/** Decomp map_prop_models.order: canalave_gym_platform_z/x/y_direction, _red, _second/_third/_fourth_floor. */
const CANALAVE_PROPS = [294, 295, 296, 297, 300, 301, 302];
/** Decomp FIRST_BERRY_IDX (ITEM_CHERI_BERRY) and NUM_BERRIES. */
const FIRST_BERRY_ITEM = 149;
const BERRY_COUNT = 64;
/** OBJ_EVENT_GFX_SNOWBALL (Snowpoint Gym's snowballs). */
const SNOWBALL_GFX = 0x76;
/** Decomp map_prop_models.order: regular_ship, canalave_bridge_left, _right (boat_cutscene.c). */
const BOAT_PROPS = { ship: 34, snowpointShip: 538, bridges: [31, 32] as const };
/** Decomp map headers the gym code names (MAP_HEADER_ETERNA_CITY_GYM, _VEILSTONE_CITY_GYM, _HEARTHOME_CITY_GYM_ENTRANCE_ROOM). */
const GYM_ZONES = { eterna: 67, veilstone: 133, hearthomeEntrance: 88 };
/** Decomp prop_models.naix: iron_island_platform_lift, pokemon_league_platform_lift (platform_lift.c). */
const PLATFORM_LIFT_PROPS = { ironIsland: 258, pokemonLeague: 502 };
/**
 * The Great Marsh (great_marsh_daily_encounters.c, great_marsh_tram.c, scripts_safari_game.s): MAP_HEADER_GREAT_MARSH_1..6,
 * FLAG_SAFARI_GAME_ACTIVE, the encdata_ex members (9 after the National Pokédex, 10 before, 11 the binoculars' spots),
 * the SAFARI_GAME script ids the field starts and the tram's build model (great_marsh_train).
 */
const GREAT_MARSH = {
  zones: [504, 505, 506, 507, 508, 509],
  flag: 2407,
  members: { national: 9, regional: 10, lookout: 11 },
  scripts: { outOfSteps: 8801, outOfBalls: 8802, outOfBallsBattle: 8809, retire: 8821, noRoom: 8822 },
  tram: 475,
};
/**
 * The special encounters (honey_tree.c, trophy_garden_daily_encounters.c, pokeradar.c, ov5_021F007C.c): the honey tree
 * prop (map_prop_models honey_tree), the encdata_ex members of the honey tree groups A, B, C (2, 3, 4) and the Trophy
 * Garden (8), MAP_HEADER_TROPHY_GARDEN (MapHeader_IsTrophyGarden), the common scripts (8 the honey tree, 28 the scent
 * faded, 29 nothing here) and the POKE_RADAR scripts (0 low battery, 1 no patch).
 */
const SPECIAL_ENCOUNTERS = {
  honeyTreeProp: 26,
  honeyMembers: [2, 3, 4],
  trophyMember: 8,
  trophyZone: 287,
  scripts: { honeyTree: 'CommonScript_HoneyTree', faded: 'CommonScript_SweetScentFaded', nothing: 'CommonScript_SweetScentNothingHere', noCharge: 'PokeRadar_BatteryHasRunDry', quiet: 'PokeRadar_GrassyPatchRemainedQUiet' },
  sounds: { radar: 'SEQ_KUSAGASA', sweetScent: 'SEQ_SE_DP_FW230' },
};
const DEFAULT_NAMES = { player: 'Lucas', rival: 'Barry' };
/** Decomp LANGUAGE_ENGLISH, LANGUAGE_GERMAN: the game's language id by ROM language. */
const GAME_LANGUAGES: Record<RomLanguage, number> = { en: 2, de: 5 };
/** decomp SEQ_EYE_KID: FieldBGM_GetEyesMeetForTrainer's default. */
const SEQ_EYE_KID = 1101;
/** pl_font.narc member of the message font (decomp FONT_MESSAGE). */
const MESSAGE_FONT = 1;
/** pl_font.narc member of the Unown font (decomp FONT_UNOWN, `message_unown`). */
const UNOWN_FONT = 3;
/** Seconds since midnight of the area light template a `Light` carries outside its schedule (title and scene models). */
const MIDDAY = 12 * 3600;



export class ImportError extends Error {}

export async function importPlatinum(
  rom: Uint8Array | HashedRom,
  onProgress: ImportProgress = () => {},
  options: ImportOptions = {},
): Promise<{ pack: PackData; assets: Map<string, Uint8Array>; report: ImportReport }> {
  const start = Date.now();
  onProgress('verify', 0, 1);
  const sha1 = rom instanceof Uint8Array ? await sha1Hex(rom) : rom.sha1;
  const supported = SUPPORTED_ROMS[sha1];
  if (!supported) {
    const known = Object.entries(SUPPORTED_ROMS).map(([h, r]) => `${r.name} (SHA1 ${h})`);
    throw new ImportError(`Unsupported ROM: SHA1 ${sha1}. OpenSinnoh needs an untrimmed dump of ${known.join(' or ')}.`);
  }
  const build = romBuild(supported);
  const T = placeTables(TABLES, build.layout, 'platinum');
  const fs = new NitroFs(rom, { paths: build.paths });
  const names = new Names(namesFile as NamesFile);
  const chars = charTable(charmapFile as CharmapFile);
  const unknowns: Record<string, string[]> = {};
  const unknown = (kind: string, what: string) => (unknowns[kind] ??= []).push(what);

  const table = async (key: keyof typeof T): Promise<Uint8Array> => {
    const t = T[key];
    const src = t.where === 'arm9' ? fs.arm9() : fs.overlay(t.where);
    const bytes = src.subarray(t.offset, t.offset + t.count * t.size);
    const got = await sha1Hex(bytes);
    if (got !== t.sha1) throw new ImportError(`ROM table ${key} at ${t.where}:0x${t.offset.toString(16)} has SHA1 ${got}, expected ${t.sha1}`);
    return bytes;
  };
  const readGameRecordTables = async (): Promise<NewGame['gameRecords']> => {
    const scores = new Reader(await table('trainerScoreIncrements'));
    const limits = await table('recordHighLimits');
    return {
      scoreIncrements: Array.from({ length: GAME_RECORDS.scoreEvents }, (_, i) => scores.u16(i * 2)),
      highLimit: Array.from(limits, (b) => {
        if (b > 1) throw new ImportError(`sUsesHighLimit: ${b} is not a bool`);
        return b === 1;
      }),
    };
  };
  const headers = readZoneHeaders(await table('zoneHeaders'), T.zoneHeaders.count);
  /** Decomp Script_GetHiddenItemFlag / Script_GetHiddenItemRange: a hidden item's bg script is 8000 + n, its flag HIDDEN_ITEM_FLAGS_START + n. */
  const hiddenItems = new Map<number, NonNullable<BgEvent['hiddenItem']>>();
  {
    const r = new Reader(await table('hiddenItems'));
    for (let i = 0; i < T.hiddenItems.count; i++) {
      const n = r.u16(i * 8 + 6);
      hiddenItems.set(SCRIPT_ID_OFFSET_HIDDEN_ITEMS + n, { flag: names.flag(HIDDEN_ITEM_FLAGS_START + n), range: r.u8(i * 8 + 3), item: names.item(r.u16(i * 8)), quantity: r.u8(i * 8 + 2) });
    }
  }
  const cameras = readCameraTable(await table('cameras'), T.cameras.count);
  const gfxToMmodel = readObjectGfxTable(await table('objectGfx'));
  const ov5 = fs.overlays().find((o) => o.id === 5)!;
  const objectGfx = {
    mmodelOf: gfxToMmodel,
    anims: readObjectGfxAnims(await table('objectGfxAnims'), fs.overlay(5), ov5.ramAddress),
    billboardModels: readBillboardModels(await table('billboardModels')),
    modelObjects: readModelObjects(await table('modelObjects'), await table('modelObjectOffsets')),
  };
  onProgress('verify', 1, 1);

  // --- text ---
  const bankIndex = (bank: string) => {
    const i = names.file.textBanks.findIndex((b) => b.bank === bank);
    if (i < 0) throw new Error(`names: no text bank ${bank}`);
    return i;
  };
  const bankMembers = readNarc(fs.file('/msgdata/pl_msg.narc'));
  const bankTexts: string[][] = [];
  const texts: Text[] = [];
  const textBanks: TextBank[] = [];
  const textStats = { unknownChars: new Map<number, number>() };
  bankMembers.forEach((member, b) => {
    const msgs = decodeMessageBank(member).map((codes, m) => {
      try {
        return decodeText(codes, chars, textStats);
      } catch (e) {
        throw new ImportError(`text bank ${b} message ${m}: ${(e as Error).message}`);
      }
    });
    const named = names.file.textBanks[b]?.messages;
    if (named && named.length !== msgs.length) throw new ImportError(`text bank ${b} has ${msgs.length} messages, names.json lists ${named.length}`);
    bankTexts.push(msgs);
    msgs.forEach((text, m) => texts.push({ id: names.text(b, m), text }));
    textBanks.push({ id: asId(`platinum:${names.file.textBanks[b]?.bank ?? `text-bank/${b}`}`), sourceIndex: b, messages: msgs.map((_, m) => names.text(b, m)) });
    if (b % 50 === 0) onProgress('text', b, bankMembers.length);
  });
  for (const [c, n] of textStats.unknownChars) unknown('char', `0x${c.toString(16)} ×${n}`);
  // Our own labels for the modern options (not in the ROM; docs/decisions.md: trade-only evolutions in single player).
  for (const [name, text] of Object.entries(MODERN_OPTION_TEXTS[supported.language])) texts.push({ id: asId(`platinum:${name}`), text });
  // The start menu's objectives and their option (our words; objectives.ts).
  for (const [name, text] of Object.entries(objectiveTexts(supported.language))) texts.push({ id: asId(`platinum:${name}`), text });
  const bankText = (bank: number, msg: number) => {
    const t = bankTexts[bank]?.[msg];
    if (t === undefined) throw new ImportError(`text bank ${bank} has no message ${msg}`);
    return t;
  };
  onProgress('text', bankMembers.length, bankMembers.length);

  // --- scripts: entry counts per file, to check every label we reference exists ---
  const scriptMembers = readNarc(fs.file('/fielddata/script/scr_seq.narc'));
  if (scriptMembers.length !== names.file.scripts.length) throw new ImportError(`scr_seq has ${scriptMembers.length} members, names.json lists ${names.file.scripts.length}`);
  const initFiles = new Set(headers.map((h) => h.initScripts));
  const entryCounts = new Map<number, number>();
  const entryCount = (file: number) => {
    let n = entryCounts.get(file);
    if (n === undefined) {
      if (initFiles.has(file)) throw new ImportError(`script file ${file} is a level-script file, not a script file`);
      n = readScriptEntryOffsets(scriptMembers[file] as Uint8Array).length;
      entryCounts.set(file, n);
    }
    return n;
  };
  const trainerOf = (script: number): NonNullable<ObjectEvent['trainer']> => {
    const battler = script >= SCRIPT_ID_DOUBLE_BATTLES ? 1 : 0;
    return { id: names.trainer(script - (battler ? SCRIPT_ID_DOUBLE_BATTLES : SCRIPT_ID_SINGLE_BATTLES) + 1), battler };
  };
  const labelFor = (scriptId: number, h: ZoneHeader, where: string): Id | undefined => {
    const ref = names.scriptRef(scriptId, h.scripts);
    if (!ref) return undefined;
    const { file, entry } = ref;
    const label = names.scriptEntry(file, entry);
    if (entry < entryCount(file)) return label;
    unknown('dangling-script', `${where}: script ${scriptId} → ${names.scriptFileName(file)} entry ${entry} of ${entryCount(file)} (dropped)`);
    return undefined;
  };

  // --- zones ---
  const eventMembers = readNarc(fs.file('/fielddata/eventdata/zone_event.narc'));
  const locationBank = bankIndex('TEXT_BANK_LOCATION_NAMES');
  const gfxVar0 = [...names.gfxNames].find(([, n]) => n === 'OBJ_EVENT_GFX_VAR_0')?.[0];
  if (gfxVar0 === undefined) throw new Error('names: OBJ_EVENT_GFX_VAR_0 missing');
  // The berry trees' gfx (berry_tree_obj_event_gfx.h, not in the gfx name table): OBJ_EVENT_GRAPHICS_<BERRY>_GROWING, _BLOOMING, _FRUIT.
  names.file.items.slice(FIRST_BERRY_ITEM, FIRST_BERRY_ITEM + BERRY_COUNT).forEach((item, b) => {
    const base = (item ?? '').replace(/^ITEM_/, '').replace(/_BERRY$/, '');
    if (!base) throw new ImportError(`names: berry item ${FIRST_BERRY_ITEM + b} has no name`);
    (['GROWING', 'BLOOMING', 'FRUIT'] as const).forEach((stage, k) => names.gfxNames.set(berryTreeGfx(b, (k + 1) as 1 | 2 | 3), `OBJ_EVENT_GRAPHICS_${base}_${stage}`));
  });
  // Sprites are keyed by object-gfx id (what scripts store in VAR_OBJ_GFX_ID_*): `platinum:<OBJ_EVENT_GFX_*>`.
  const spriteId = (gfx: number) => asId(`platinum:${names.gfxNames.get(gfx) ?? `sprite/${gfx}`}`);
  const spriteGfx = new Set<number>();
  const spriteFor = (gfx: number): ObjectEvent['sprite'] => {
    if (gfx >= gfxVar0 && gfx < gfxVar0 + 16) return { var: names.var(0x4020 + gfx - gfxVar0) };
    spriteGfx.add(gfx);
    return spriteId(gfx);
  };
  const sound = importSound(fs, names.file.species.map((_, i) => names.species(i)), (done, total) => onProgress('sound', done, total));
  // Blackout spawns (decomp sSpawnLocations rows with isWarpPos; GetMapBlackOutWarpId takes the first match).
  const spawnBytes = new Reader(await table('spawnLocations'));
  const blackOuts = new Map<number, { spawn: number; x: number; z: number; label: Id }>();
  for (let i = 0; i < T.spawnLocations.count; i++) {
    const o = i * T.spawnLocations.size;
    const zone = spawnBytes.u16(o);
    const label = asId(`platinum:CommonScript_${i === 0 ? 'PlayerHouse' : 'Pokecenter'}BlackOutRecover`);
    if (spawnBytes.u8(o + 12) && !blackOuts.has(zone)) blackOuts.set(zone, { spawn: i + 1, x: spawnBytes.u16(o + 2), z: spawnBytes.u16(o + 4), label });
  }
  // Fly unlocks (TryUnlockFlyLocationByMap: the first sSpawnLocations row whose fly map is the zone and has
  // unlockOnMapEntry): its firstArrival, a flag at FLAG_FIRST_ARRIVAL_TWINLEAF_TOWN (SYSTEM_FLAGS_FIRST_ARRIVAL_TO_ZONE) + n.
  const firstArrivalBase = [...names.flagNames].find(([, n]) => n === 'FLAG_FIRST_ARRIVAL_TWINLEAF_TOWN')?.[0];
  if (firstArrivalBase === undefined) throw new ImportError('no FLAG_FIRST_ARRIVAL_TWINLEAF_TOWN flag name');
  const firstArrivals = new Map<number, Id>();
  for (let i = 0; i < T.spawnLocations.count; i++) {
    const o = i * T.spawnLocations.size;
    const zone = spawnBytes.u16(o + 6);
    if (spawnBytes.u8(o + 13) && !firstArrivals.has(zone)) firstArrivals.set(zone, names.flag(firstArrivalBase + spawnBytes.u16(o + 14)));
  }
  // The zones' special evolution methods (decomp enum EvolutionMethod values 24–26).
  const MAP_EVOLUTION_METHODS: Record<number, NonNullable<Zone['mapEvolution']>> = { 24: 'LEVEL_MAGNETIC_FIELD', 25: 'LEVEL_MOSS_ROCK', 26: 'LEVEL_ICE_ROCK' };
  const mapEvolutionBytes = new Reader(await table('mapEvolutions'));
  const mapEvolutions = new Map<number, NonNullable<Zone['mapEvolution']>>();
  for (let i = 0; i < T.mapEvolutions.count; i++) {
    const method = MAP_EVOLUTION_METHODS[mapEvolutionBytes.u16(i * 4 + 2)];
    if (!method) throw new ImportError(`mapEvolutions row ${i}: method ${mapEvolutionBytes.u16(i * 4 + 2)} is not a map evolution`);
    mapEvolutions.set(mapEvolutionBytes.u16(i * 4), method);
  }
  // MapHeader_HasFeebasTiles (MAP_HEADER_MT_CORONET_B1F) and encdata_ex members 0 (species, u32) and 1
  // (u32 group count, u32 tile count per group, then u16 tiles): PlayerAvatar_IsFacingFeebasTile's data.
  const encEx = readNarc(fs.file('/arc/encdata_ex.narc'));
  const feebasSpecies = new Reader(encEx[0]!).u32(0);
  const feebasBytes = new Reader(encEx[1]!);
  const feebasGroups = feebasBytes.u32(0);
  let feebasCount = 0;
  for (let i = 0; i < feebasGroups; i++) feebasCount += feebasBytes.u32(4 + i * 4);
  const feebasTiles = Array.from({ length: feebasCount }, (_, i) => feebasBytes.u16(4 + feebasGroups * 4 + i * 2));
  const feebas = { species: names.species(feebasSpecies), tiles: feebasTiles };
  const MAP_HEADER_MT_CORONET_B1F = 219;
  const zones: Zone[] = headers.map((h, zi) => {
    const zid = names.zone(zi);
    const raw = eventMembers[h.events];
    if (!raw) throw new ImportError(`zone ${zi}: no zone_event member ${h.events}`);
    let ev: RawZoneEvents;
    try {
      ev = readZoneEvents(raw);
    } catch (e) {
      throw new ImportError(`zone ${zi} events ${h.events}: ${(e as Error).message}`);
    }
    const init = readInitScripts(scriptMembers[h.initScripts] as Uint8Array);
    const where = (kind: string, i: number) => `${zid} ${kind} ${i}`;
    const bgs: BgEvent[] = [];
    ev.bgs.forEach((b, i) => {
      const label = labelFor(b.script, h, where('bg', i));
      if (!label) return b.script === 0 ? unknown('bg-no-script', where('bg', i)) : undefined;
      const facing = BG_DIRS[b.facing];
      if (!facing) throw new ImportError(`${where('bg', i)}: facing ${b.facing}`);
      const kind = BG_KINDS[b.type] ?? 'other';
      const hidden = kind === 'hidden-item' ? hiddenItems.get(b.script) : undefined;
      if (kind === 'hidden-item' && !hidden) throw new ImportError(`${where('bg', i)}: hidden item script ${b.script} is not in gHiddenItems`);
      bgs.push({ label, kind, sourceType: b.type, x: b.x, z: b.z, y: b.y, facing, ...(hidden ? { hiddenItem: hidden } : {}) });
    });
    /** A clone's hide flag holds the zone it copies an object of (decomp sub_0206244C). */
    const cloneSource = (zone: number, at: string) => {
      if (zone >= headers.length) throw new ImportError(`${at}: clone of zone ${zone}`);
      return names.zone(zone);
    };
    const objects: ObjectEvent[] = ev.objects.map((o, i) => {
      const facing = OBJECT_DIRS[o.dir];
      if (!facing) throw new ImportError(`${where('object', i)}: direction ${o.dir}`);
      const clone = o.script === 0xffff;
      const label = clone ? undefined : labelFor(o.script, h, where('object', i));
      return {
        localId: o.localId,
        sprite: spriteFor(o.gfx),
        movementType: o.movementType,
        trainerType: o.trainerType,
        ...(!clone && o.hiddenFlag ? { hideFlag: names.flag(o.hiddenFlag) } : {}),
        ...(label ? { label } : {}),
        ...(!clone && o.script >= SCRIPT_ID_SINGLE_BATTLES && o.script < SCRIPT_ID_VISIBLE_ITEMS ? { trainer: trainerOf(o.script) } : {}),
        ...(clone ? { cloneOf: cloneSource(o.hiddenFlag, where('object', i)) } : {}),
        facing,
        data: o.data,
        range: { x: o.rangeX, z: o.rangeZ },
        x: o.x,
        z: o.z,
        y: o.y,
      };
    });
    // Warp indexes are referenced (toWarp, setWarpPosition), so every warp is kept. Elevators use the
    // decomp's MAP_HEADER_DYNAMIC (4095, "where you came from"): contract `toZone: 'dynamic'`.
    const warps: WarpEvent[] = ev.warps.map((w, i) => {
      if (w.destZone === MAP_HEADER_DYNAMIC) unknown('warp-dynamic', `${where('warp', i)} → dynamic`);
      else if (w.destZone >= headers.length) throw new ImportError(`${where('warp', i)}: destination zone ${w.destZone}`);
      const toZone = w.destZone === MAP_HEADER_DYNAMIC ? 'dynamic' : names.zone(w.destZone);
      return { x: w.x, z: w.z, toZone, toWarp: w.destWarp };
    });
    const coords: CoordEvent[] = ev.coords.map((c, i) => {
      const label = labelFor(c.script, h, where('coord', i));
      if (!label) throw new ImportError(`${where('coord', i)}: script 0`);
      return { label, x: c.x, z: c.z, width: c.width, length: c.length, y: c.y, var: names.var(c.var), value: c.value };
    });
    const mapType = MAP_TYPES[h.mapType] ?? 'other';
    if (!MAP_TYPES[h.mapType]) unknown('map-type', `${zid}: ${h.mapType} imported as other`);
    const fixed = (id: number | undefined, kind: string) => (id === undefined ? undefined : labelFor(id, h, `${zid} ${kind}`));
    const onLoad = fixed(init.onLoad, 'onLoad');
    const onTransition = fixed(init.onTransition, 'onTransition');
    const onResume = fixed(init.onResume, 'onResume');
    const onFrame = init.onFrame.map((row, i) => {
      if (row.value >= 0x4000) unknown('frame-value-var', `${zid} onFrame ${i}: value is var 0x${row.value.toString(16)}`);
      const label = labelFor(row.script, h, `${zid} onFrame ${i}`);
      if (!label) throw new ImportError(`${zid} onFrame ${i}: script 0`);
      return { var: names.var(row.var), value: row.value, label };
    });
    return {
      id: zid,
      sourceIndex: zi,
      name: bankText(locationBank, h.mapLabelText),
      matrix: names.matrix(h.matrix),
      area: names.area(h.area),
      camera: names.camera(h.camera),
      mapType,
      follow: PLATINUM_FOLLOW_MODES[mapType],
      weather: names.weather(h.weather),
      music: { day: sound.music(h.music.day, `${zid} day music`), night: sound.music(h.music.night, `${zid} night music`) },
      // CanUseFishingRod: native header ids 573..583 (includes UNKNOWN_578). No name matching at runtime.
      noFishing: zi >= 573 && zi <= 583,
      ...(zi === MAP_HEADER_MT_CORONET_B1F ? { feebas } : {}),
      flags: { bike: h.bike, running: h.running, escapeRope: h.escapeRope, fly: h.fly },
      ...(h.encounters !== null ? { encounters: names.encounters(h.encounters) } : {}),
      battleBackground: battleBackground(h.battleBg, zid),
      ...(blackOuts.has(zi) ? { blackOut: blackOuts.get(zi)! } : {}),
      ...(firstArrivals.has(zi) ? { firstArrival: firstArrivals.get(zi)! } : {}),
      mapScripts: { ...(onLoad ? { onLoad } : {}), ...(onTransition ? { onTransition } : {}), ...(onResume ? { onResume } : {}), onFrame },
      events: { bgs, objects, warps, coords },
      mapPopup: mapPopup(h, zid),
      ...(mapEvolutions.has(zi) ? { mapEvolution: mapEvolutions.get(zi)! } : {}),
    };
  });
  onProgress('zones', zones.length, zones.length);

  // --- the Distortion World (distortion/index.ts): rooms, supports, cameras, ghosts, overlay 9 tables ---
  const distortion = importDistortionWorld(fs, await table('distortionWorld'), T.distortionWorld.offset, shiftLayout(DW_TABLES, T.distortionWorld.offset - TABLES.distortionWorld.offset), {
    mapCount: headers.length,
    zone: (h) => names.zone(h),
    label: (h, script, where) => labelFor(script, headers[h]!, where),
    gfx: (g) => names.gfxNames.get(g),
    // Movement ops are named as the script decoder names them (MOVEMENT_ACTION_* lower-cased, without the prefix).
    movement: (a) => MOVEMENT_ACTIONS[a] ?? undefined,
    flag: (f) => names.flag(f),
  });
  const dw = distortionRecords(distortion.world, (gfx) => {
    const sprite = spriteFor(gfx);
    if (typeof sprite !== 'string') throw new ImportError(`Distortion World object gfx ${gfx} is a var sprite`);
    return sprite;
  });

  // --- maps ---
  const matrices: Matrix[] = readNarc(fs.file('/fielddata/mapmatrix/map_matrix.narc')).map((m, i) => {
    const mx = readMapMatrix(m);
    return {
      id: names.matrix(i),
      sourceIndex: i,
      width: mx.width,
      height: mx.height,
      chunks: mx.chunks.map((c) => (c === null ? null : names.chunk(c))),
      ...(mx.zones
        ? {
            zones: mx.zones.map((z) => {
              if (z < headers.length) return names.zone(z);
              unknown('matrix-zone', `matrix ${i}: cell zone ${z} imported as null`);
              return null;
            }),
          }
        : {}),
      ...(mx.altitudes ? { altitudes: mx.altitudes } : {}),
    };
  });
  resolveUnscriptedClones(zones, matrices);
  {
    const hidden = (name: string) => {
      const h = HIDDEN_LOCATIONS.find((x) => x.var === name);
      if (!h) throw new ImportError(`no hidden location ${name}`);
      return { var: asId(`platinum:${h.var}`), value: h.value };
    };
    matrices.push(...matrixVariants(matrices[0]!, (land) => names.chunk(land), { springPath: hidden('VAR_HIDDEN_LOCATION_SPRING_PATH'), seabreakPath: hidden('VAR_HIDDEN_LOCATION_SEABREAK_PATH') }));
  }
  const landMembers = readNarc(fs.file('/fielddata/land_data/land_data.narc'));
  const buildCount = readNarc(fs.file('/fielddata/build_model/build_model.narc')).length;
  const chunks: Chunk[] = landMembers.map((m, i) => {
    let land;
    try {
      land = readLandData(m);
    } catch (e) {
      throw new ImportError(`land_data ${i}: ${(e as Error).message}`);
    }
    if (i % 100 === 0) onProgress('maps', i, landMembers.length);
    return {
      id: names.chunk(i),
      sourceIndex: i,
      tiles: land.tiles,
      model: asId(`platinum:MODEL_LAND_${i}`),
      props: land.props.map((p) => {
        if (p.model < 0 || p.model >= buildCount) throw new ImportError(`land_data ${i}: prop model ${p.model} outside build_model (${buildCount})`);
        return { prop: names.prop(p.model), position: p.position, rotation: p.rotation, scale: p.scale };
      }),
      terrain: land.terrain,
    };
  });
  onProgress('maps', landMembers.length, landMembers.length);
  // Area lights: the midday template, and every time-of-day template as the schedule (decomp
  // AreaLightManager; end times are seconds since midnight / 2). A set whose templates all equal the
  // midday one (the interiors) has no schedule.
  const c31 = (c: readonly number[]) => c.map((x) => x / 31) as [number, number, number];
  const template = (t: RawLightTemplate): LightTemplate => ({
    lights: t.lights.map((l) => (l ? { color: c31(l.color), direction: l.direction.map((x) => x / 4096) as [number, number, number] } : null)),
    diffuse: c31(t.diffuse),
    ambient: c31(t.ambient),
    specular: c31(t.specular),
    emission: c31(t.emission),
  });
  const lights: Light[] = readNarc(fs.file('/data/arealight.narc')).map((m, i) => {
    let all;
    try {
      all = readAreaLight(m);
    } catch (e) {
      throw new ImportError(`arealight ${i}: ${(e as Error).message}`);
    }
    const midday = template(templateAt(all, MIDDAY));
    const schedule = all.map((t) => ({ until: t.endTime * 2, ...template(t) }));
    const same = schedule.every(({ until: _, ...t }) => JSON.stringify(t) === JSON.stringify(midday));
    // AreaDataManager_IsOutdoorsLighting: land models take the template's colours under arealight 0 and 3 only.
    return { id: names.light(i), sourceIndex: i, ...midday, ...(same ? {} : { schedule }), ...(i === 0 || i === 3 ? {} : { indoor: true as const }) };
  });
  const areas: Area[] = readNarc(fs.file('/fielddata/areadata/area_data.narc')).map((m, i) => {
    const a = readAreaData(m);
    if (a.light >= lights.length) throw new ImportError(`area_data ${i}: light ${a.light} outside arealight (${lights.length})`);
    return {
      id: names.area(i),
      sourceIndex: i,
      light: names.light(a.light),
      mapTextures: asId(`platinum:textures/map/${a.mapTextureSet}`),
      propTextures: asId(`platinum:textures/build/${a.propSet}`),
    };
  });
  const props: Prop[] = Array.from({ length: buildCount }, (_, i) => ({ id: names.prop(i), sourceIndex: i, model: asId(`platinum:MODEL_BUILD_${i}`) }));
  const cameraRecords: Camera[] = cameras.map((c, i) => ({
    id: names.camera(i),
    sourceIndex: i,
    distance: c.distance,
    angle: c.angle,
    projection: c.projection,
    fovY: c.fovYHalf * 2,
    near: c.near,
    far: c.far,
  }));

  // --- flags and vars (every named one) ---
  const flags: Flag[] = [...names.flagNames.keys()].map((i) => ({ id: names.flag(i), sourceIndex: i, initial: false, scope: i >= 1 && i <= 0x40 ? 'map' : 'saved' }));
  const vars: Var[] = [...names.varNames.keys()].map((i) => ({
    id: names.var(i),
    sourceIndex: i,
    initial: 0,
    scope: i >= 0x8000 ? 'temp' : i <= 0x401f ? 'map' : 'saved',
  }));

  // --- Pokémon data: species, moves, items, trainers, marts, … (pokemon-data.ts) ---
  onProgress('data', 0, 3);
  const pokemonTables = {
    tmMoves: await table('tmMoves'),
    eggMoves: await table('eggMoves'),
    trainerClassGenders: await table('trainerClassGenders'),
    trainerClassPrizes: await table('trainerClassPrizes'),
    typeChart: await table('typeChart'),
    natureAffinities: await table('natureAffinities'),
    martCommon: await table('martCommon'),
    martSpecialties: await table('martSpecialties'),
    tutorMoves: await table('tutorMoves'),
    tutorMasks: await table('tutorMasks'),
  };
  let mon: PokemonData;
  try {
    mon = importPokemonData({ fs, names, tables: pokemonTables, bankIndex, bankText, unknown });
  } catch (e) {
    throw new ImportError(`Pokémon data: ${(e as Error).message}`);
  }
  const { species } = mon;
  // The eyes-meet music by class (decomp FieldBGM_GetEyesMeetForTrainer: SEQ_EYE_KID when the class has no row).
  const eyes = new Reader(await table('trainerEncounterBgms'));
  const eyesByClass = new Map<string, number>();
  for (let i = 0; i < T.trainerEncounterBgms.count; i++) eyesByClass.set(names.trainerClass(eyes.u16(i * 4)), eyes.u16(i * 4 + 2));
  const trainers: import('@opensinnoh/contracts').Trainer[] = mon.trainers.map((t) => ({ ...t, encounterBgm: sound.music(eyesByClass.get(t.class) ?? SEQ_EYE_KID, `${t.id} eyes-meet music`)! }));

  // --- wild encounters (pl_enc_data), tile behaviours ---
  const encMembers = readNarc(fs.file('/fielddata/encountdata/pl_enc_data.narc'));
  if (encMembers.length !== names.file.encounters.length) throw new ImportError(`pl_enc_data has ${encMembers.length} members, names.json lists ${names.file.encounters.length}`);
  const slotOf = (s: { species: number; minLevel: number; maxLevel: number }): EncounterSlot => ({ species: names.species(s.species), minLevel: s.minLevel, maxLevel: s.maxLevel });
  const encounters: EncounterTable[] = encMembers.map((m, i) => {
    const raw = readEncounters(m);
    const where = names.encounters(i);
    /** A rate of 0 means the table is unused: no slots (contracts EncounterTable). */
    const slots = (rate: number, list: RawWaterEncounters['slots'], kind: string) => {
      if (!rate && list.some((x) => x.species)) unknown('encounter-slots-without-rate', `${where} ${kind}`);
      return rate ? list.map(slotOf) : [];
    };
    const rod = (w: RawWaterEncounters, kind: string) => ({ rate: w.rate, slots: slots(w.rate, w.slots, kind) });
    const variants: EncounterTable['variants'] = {};
    for (const [kind, list] of Object.entries(raw.replacements)) {
      const replaced = list.flatMap((species, k) => (species ? [{ slot: REPLACEMENT_SLOTS[kind]![k]!, species: names.species(species) }] : []));
      if (replaced.length) variants[kind] = replaced;
    }
    return {
      id: where,
      sourceIndex: i,
      landRate: raw.landRate,
      land: slots(raw.landRate, raw.land, 'land'),
      surfRate: raw.surf.rate,
      surf: slots(raw.surf.rate, raw.surf.slots, 'surf'),
      oldRod: rod(raw.oldRod, 'oldRod'),
      goodRod: rod(raw.goodRod, 'goodRod'),
      superRod: rod(raw.superRod, 'superRod'),
      variants,
    };
  });
  const tileBehaviors: TileBehavior[] = names.file.tileBehaviors.flatMap((name, i) => {
    if (!name) return [];
    const short = name.replace(/^TILE_BEHAVIOR_/, '');
    const use = TILE_BEHAVIOR_SCRIPTS[short];
    const label = use && names.scriptLabel(use.script, 0);
    if (use && !label) throw new ImportError(`tile behaviour ${short}: script ${use.script} has no label`);
    const fm = TILE_FIELD_MOVES[short];
    const fieldLabel = fm && names.scriptLabel(FIELD_MOVES_SCRIPT + fm.script, 0);
    if (fm && !fieldLabel) throw new ImportError(`tile behaviour ${short}: FIELD_MOVES ${fm.script} has no label`);
    return [
      {
        id: names.tileBehavior(i),
        sourceIndex: i,
        name: short,
        ...(label && use ? { interact: { label, facing: use.facing } } : {}),
        ...(fm && fieldLabel ? { fieldMove: { move: asId(`platinum:${fm.move}`), label: fieldLabel } } : {}),
      },
    ];
  });
  const behaviorNames = new Set(tileBehaviors.map((b) => b.name));
  for (const b of Object.keys(TILE_FIELD_MOVES)) if (!behaviorNames.has(b)) throw new ImportError(`field-move tile behaviour ${b} is not in names.json`);
  // Weathers: every named field weather and every value a zone uses. Values 0–30 are decoded from the
  // weather task table (formats/weather.ts); 32–36 resolve per day from the yearly table.
  const weatherTasks = usWeatherTasks(readWeatherTasks(await table('weatherTasks')));
  const fogDensities = [...(await table('weatherFogDensities'))];
  const yearly = readYearlyWeather(await table('yearlyWeather'), T.yearlyWeather.size);
  const weatherBgs = readWeatherBgs(await table('weatherBgs'));
  const weatherSys = readNarc(fs.file('/data/weather_sys.narc'));
  /** Weather BG PNGs by pack path, rendered once per BG resource a layer uses. */
  const weatherAssets = new Map<string, Uint8Array>();
  const layerImage = (bg: number) => {
    const entry = weatherBgs[bg];
    if (!entry) throw new ImportError(`weather BG resource ${bg} is not in the BG table`);
    const path = `weather/bg${bg}.png`;
    if (!weatherAssets.has(path)) weatherAssets.set(path, weatherBgPng(weatherSys, entry));
    return asId(`platinum:${path}`);
  };
  /** Weather OAM sets by set index, packed once per set a weather uses. */
  const spriteSets = new Map<number, WeatherSprites>();
  const weatherSprites = (set: number): WeatherSprites => {
    let sprites = spriteSets.get(set);
    if (!sprites) {
      const { png, cells, frames } = weatherSpriteSet(weatherSys, set);
      const path = `weather/sprites${set}.png`;
      weatherAssets.set(path, png);
      sprites = { image: asId(`platinum:${path}`), cells, frames };
      spriteSets.set(set, sprites);
    }
    return sprites;
  };
  const weatherValues = new Set([...Array.from({ length: WEATHER_TASK_COUNT }, (_, v) => v), ...names.weatherNames.keys(), ...headers.map((h) => h.weather), ...yearly.flat()]);
  const weathers: Weather[] = [...weatherValues].sort((a, b) => a - b).map((v) => {
    const name = names.weatherNames.get(v)?.replace(/^OVERWORLD_WEATHER_/, '') ?? String(v);
    const base = { id: names.weather(v), sourceIndex: v, name };
    if (v < WEATHER_TASK_COUNT) return { ...base, ...weatherParts(v, weatherTasks[v]!, fogDensities, layerImage, (w) => names.weather(w), weatherSprites) };
    const days = yearly[v - YEARLY_WEATHER_START];
    if (!days) throw new ImportError(`weather ${v}: neither a weather task nor a yearly weather`);
    return { ...base, yearly: days.map((d) => names.weather(d)) };
  });
  onProgress('data', 3, 3);

  // --- new game (decomp StartNewSave + script 9600) ---
  const playerGfx = (name: string) => {
    const gfx = [...names.gfxNames].find(([, n]) => n === name)?.[0];
    if (gfx === undefined) throw new ImportError(`names: no ${name}`);
    return spriteFor(gfx) as Id;
  };
  const newGameLabel = names.scriptLabel(NEW_GAME.script, 0);
  const commonScript = (id: number, what: string): Id => {
    const label = names.scriptLabel(id, 0);
    if (!label) throw new ImportError(`names: no label for common script ${id} (${what})`);
    return label;
  };
  const repelWoreOff = (): Id => {
    const label = names.scriptLabel(SCRIPT_ID_REPEL_WORE_OFF, 0);
    if (!label) throw new ImportError(`names: no label for common script ${SCRIPT_ID_REPEL_WORE_OFF} (Repel wore off)`);
    return label;
  };
  const rematchBytes = new Reader(await table('rematches'));
  for (let row = 0; row < T.rematches.count; row++) {
    const tiers: (Id | null)[] = [];
    for (let tier = 0; tier < 6; tier++) {
      const n = rematchBytes.u16(row * 12 + tier * 2);
      if (n === 0) break;
      tiers.push(n === 0xffff ? null : names.trainer(n));
    }
    const base = tiers[0];
    const trainer = trainers.find((t) => t.id === base);
    if (!trainer) throw new ImportError(`rematch row ${row}: unknown base trainer ${base}`);
    trainer.rematches = tiers;
  }
  const tradeBank = bankIndex('TEXT_BANK_NPC_TRADE_NAMES');
  const side = {
    fs,
    item: (i: number) => names.item(i),
    species: (i: number) => names.species(i),
    move: (i: number) => names.move(i),
    sprite: (gfx: number) => spriteFor(gfx) as Id,
    sprayduck: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_SPRAYDUCK'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_SPRAYDUCK') },
    moistureEffects: (['VERY_DRY', 'DRY', 'MOIST'] as const).map((d) => asId(`platinum:FIELD_EFFECT_BERRY_PATCH_SOIL_${d}`)) as [Id, Id, Id],
    tradeName: (n: number) => {
      const t = bankText(tradeBank, n);
      if (/[{}]/.test(t)) throw new ImportError(`NPC trade name ${n}: markup in ${JSON.stringify(t)}`);
      return t;
    },
  };
  const sizeBytes = new Reader(await table('sizeIntervals'));
  const sizeIntervals = Array.from({ length: 16 }, (_, i) => ({ base: sizeBytes.u16(i * 8), divisor: sizeBytes.u16(i * 8 + 2), start: sizeBytes.u16(i * 8 + 4) }));
  const newGame: NewGame = {
    sizeIntervals,
    id: asId('platinum:NEW_GAME'),
    zone: names.zone(NEW_GAME.zone),
    x: NEW_GAME.x,
    z: NEW_GAME.z,
    facing: NEW_GAME.facing,
    money: NEW_GAME.money,
    ...(newGameLabel ? { label: newGameLabel } : {}),
    names: options.names ?? DEFAULT_NAMES,
    gender: options.gender ?? 'male',
    language: GAME_LANGUAGES[supported.language],
    playerSprite: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F') },
    playerHealSprite: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_POKECENTER_HEAL'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_POKECENTER_HEAL') },
    playerVsSeekerSprite: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_VS_SEEKER'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_VS_SEEKER') },
    playerCycleSprite: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_BIKE'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_BIKE') },
    playerSurfSprite: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_SURF'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_SURF') },
    messageFont: asId('platinum:FONT_MESSAGE'),
    unownFont: asId('platinum:FONT_UNOWN'),
    trainerApproach: names.scriptLabel(SCRIPT_ID_TRAINER_APPROACH, 0)!,
    repelWoreOff: repelWoreOff(),
    hatchEgg: commonScript(SCRIPT_ID_HATCH_EGG, 'hatch egg'),
    exclamationSprite: asId('platinum:SPRITE_EXCLAMATION'),
    doubleExclamationSprite: asId('platinum:SPRITE_DOUBLE_EXCLAMATION'),
    pockets: mon.pockets,
    boxNames: mon.boxNames,
    pokeBall: mon.pokeBall,
    premierBall: mon.premierBall,
    gameRecords: await readGameRecordTables(),
    berries: readBerryTables(side, await table('berryInit'), await table('berrySearcher')),
    moveTutors: readTutorTables(side, await table('tutorMoves')),
    npcTrades: readNpcTrades(side),
  };

  // --- scripts (the VM's decoder, names from names.json) ---
  onProgress('scripts', 0, 1);
  if (SCRIPT_FILES.length !== names.file.scripts.length || SCRIPT_FILES.some((f, m) => f !== names.file.scripts[m]?.file)) throw new ImportError('vm command table and names.json disagree on scr_seq file names');
  const memberOf = new Map(SCRIPT_FILES.map((f, m) => [f, m]));
  const mapTextBanks = new Map<number, number>();
  for (const h of headers) if (!mapTextBanks.has(h.scripts)) mapTextBanks.set(h.scripts, h.textBank);
  // The frontier scenes' scripts (frontier.ts), for the field's launch_battle_frontier_scene labels.
  const frontierRom: FrontierRomTables = {
    scenes: await table('frontierScenes'),
    ranges: await table('towerRanges'),
    bossRanges: await table('towerBossRanges'),
    reservedItems: await table('towerReservedItems'),
    battlePoints: await table('towerBattlePoints'),
    classObjects: await table('towerClassObjects'),
    characters: await table('frontierCharacters'),
    objects: await table('frontierObjects'),
    prices: await table('frontierBpPrices'),
    martLeft: await table('frontierMartLeft'),
    martRight: await table('frontierMartRight'),
    banlist: await table('frontierBanlist'),
    factory: {
      opponentPools: await table('factoryOpponentPools'),
      tradeUpgrades: await table('factoryTradeUpgrades'),
      openPlayerPools: await table('factoryOpenPlayerPools'),
      level50Pools: await table('factoryLevel50Pools'),
      openOpponentPools: await table('factoryOpenOpponentPools'),
      battlePoints: await table('factoryBattlePoints'),
    },
    hall: {
      battlePoints: await table('hallBattlePoints'),
      ivs: await table('hallIvs'),
      groupRanges: await table('hallGroupRanges'),
      rankRanges: await table('hallRankRanges'),
      grid: await table('hallGrid'),
      opponents: await table('hallOpponents'),
      opponentTypes: await table('hallOpponentTypes'),
      milestones: await table('hallMilestones'),
      classesByRank: await table('hallClassesByRank'),
      classesByCell: await table('hallClassesByCell'),
      trainerClasses: await table('hallTrainerClasses'),
    },
    castle: {
      opponentPools: await table('castleOpponentPools'),
      battlePoints: await table('castleBattlePoints'),
      items: await table('castleItems'),
      itemPrices: await table('castleItemPrices'),
      berries: await table('castleBerries'),
      berryPrices: await table('castleBerryPrices'),
      itemsByRank: await table('castleItemsByRank'),
      berriesByRank: await table('castleBerriesByRank'),
      healCosts: await table('castleHealCosts'),
      rankUpCosts: await table('castleRankUpCosts'),
    },
    arcade: {
      opponentPools: await table('arcadeOpponentPools'),
      battlePoints: await table('arcadeBattlePoints'),
      rouletteSpeeds: await table('arcadeRouletteSpeeds'),
      performanceStatus: await table('arcadePerformanceStatus'),
      performanceFainted: await table('arcadePerformanceFainted'),
      performanceTurns: await table('arcadePerformanceTurns'),
      berryPools: [await table('arcadeBerryPool1'), await table('arcadeBerryPool2'), await table('arcadeBerryPool3')],
      itemPools: [await table('arcadeItemPool1'), await table('arcadeItemPool2'), await table('arcadeItemPool3')],
      screens: await table('arcadeScreens'),
      cursorFrames: await table('arcadeCursorFrames'),
      effectsByRound: await table('arcadeEffectsByRound'),
      effectsByBattle: await table('arcadeEffectsByBattle'),
      categoryWeights: await table('arcadeCategoryWeights'),
      categoryThresholds: await table('arcadeCategoryThresholds'),
    },
  };
  const decoded = decodeScripts({
    members: scriptMembers,
    mapTextBanks,
    names: {
      entry: (file, i) => names.scriptEntry(memberOf.get(file)!, i),
      text: (b, m) => names.text(b, m),
      flag: (f) => names.flag(f),
      var: (v) => names.var(v),
      frontierScene: (scene) => frontierSceneEntry(frontierRom.scenes, scene),
    },
  });
  onProgress('scripts', 1, 1);

  // --- models, textures, sprite atlases, message font ---
  onProgress('assets', 0, 1);
  const doorTable = new Reader(await table('doorModels'));
  const doorModels = new Set(Array.from({ length: T.doorModels.count }, (_, i) => doorTable.i32(i * 4)));
  const converted = importAssets(fs, { slice: options.slice ?? false, objectGfx, doorModels, sliceModels: new Set([...Object.values(HEAL_MACHINE), ...Object.values(PLATFORM_LIFT_PROPS), ...Object.values(PASTORIA_PROPS), ...CANALAVE_PROPS, 458, 459, 460, 461, 462, 463, 464, 496, ...VILLA_FURNITURE_MODELS, BOAT_PROPS.ship, BOAT_PROPS.snowpointShip, ...BOAT_PROPS.bridges, SPECIAL_ENCOUNTERS.honeyTreeProp]) });
  for (const w of converted.warnings) unknown('asset', w);
  const assets = new Map(converted.assets);
  const font = importFont(readNarc(fs.file('/graphic/pl_font.narc'))[MESSAGE_FONT] as Uint8Array, chars, { id: asId('platinum:FONT_MESSAGE'), atlas: asId('platinum:fonts/message.png') });
  if (font.skipped) unknown('font', `${font.skipped} message-font glyphs have no single-character mapping (left out)`);
  assets.set('fonts/message.png', font.png);
  const unownFont = importFont(readNarc(fs.file('/graphic/pl_font.narc'))[UNOWN_FONT] as Uint8Array, chars, { id: asId('platinum:FONT_UNOWN'), atlas: asId('platinum:fonts/unown.png'), drawnOnly: true });
  if (unownFont.skipped) unknown('font', `${unownFont.skipped} Unown-font glyphs have no single-character mapping (left out)`);
  assets.set('fonts/unown.png', unownFont.png);
  for (const [path, bytes] of weatherAssets) assets.set(path, bytes);
  const title = importTitle(fs);
  const creditsRide = importCreditsRide(fs, assets, await table('creditsRows'), await table('creditsTrees'));
  newGame.creditsRide = creditsRide.ride;
  for (const [path, bytes] of title.assets) assets.set(path, bytes);
  onProgress('assets', 1, 1);
  const art = await importUi2d(
    fs,
    build,
    names.file.species.map((_, i) => names.species(i)),
    names.file.trainerClasses.map((_, i) => names.trainerClass(i)),
    (done, total) => onProgress('2d art', done, total),
  );
  for (const [path, bytes] of art.assets) assets.set(path, bytes);
  const ui2dIds = new Set(art.ui2d.map((u) => u.id));
  for (const [path, bytes] of sound.assets) assets.set(path, bytes);
  // Battle animations: the scripts, the particle files (textures as ui2d sheets) and the VM's tables.
  const animSheets = new Sheets();
  const anims = await importBattleAnims(fs, build.layout, new Map(mon.moves.map((m) => [m.sourceIndex!, m.id])), animSheets);
  for (const [path, bytes] of animSheets.assets) assets.set(path, bytes);
  const starterSheets = new Sheets();
  const undergroundSheets = new Sheets();
  const undergroundModels: Model[] = [];
  const slotSheets = new Sheets();
  const starter = importChooseStarter(fs, starterSheets);
  for (const [path, bytes] of [...starter.assets, ...starterSheets.assets]) assets.set(path, bytes);
  // The Battle Frontier (frontier.ts): its scenes' scripts join the IR; the tables, art and exchange marts.
  const frontierSheets = new Sheets();
  const frontier = importFrontier(fs, names, frontierRom, { bankId: (b) => textBanks[b]!.id, bankIndex, sequences: sound.sequences, sheets: frontierSheets });
  for (const [id, cmds] of Object.entries(frontier.labels)) {
    if (decoded.ir.labels[id as Id]) throw new ImportError(`frontier label ${id} clashes with a field label`);
    decoded.ir.labels[id as Id] = cmds;
  }
  decoded.movements.push(...frontier.movements);
  for (const [path, bytes] of frontierSheets.assets) assets.set(path, bytes);
  newGame.frontier = frontier.tables;
  const judge = new Reader(await table('judgeStatsMessages'));
  newGame.frontier.judgeMessages = Array.from({ length: T.judgeStatsMessages.count }, (_, i) => names.text(bankIndex('TEXT_BANK_BATTLE_TOWER'), judge.u16(i * 2)));
  // The Pokédex: entries on the species, the area map on the new-game record, footprints as assets.
  const dex = importPokedex(fs, (bank, msg) => names.text(bank, msg));
  for (const [path, bytes] of dex.assets) assets.set(path, bytes);
  for (const s of species) {
    const entry = s.sourceIndex !== undefined ? dex.entries.get(s.sourceIndex) : undefined;
    if (entry) s.dex = entry;
  }
  const footprints = new Reader(await table('footprintTypes'));
  for (const s of species) {
    if (s.sourceIndex === undefined || s.sourceIndex >= T.footprintTypes.count) continue;
    const hasPrint = footprints.u16(s.sourceIndex * 4 + 2);
    if (hasPrint > 1) throw new ImportError(`footprint type ${s.sourceIndex}: hasPrint ${hasPrint}`);
    s.footprintType = { type: footprints.u16(s.sourceIndex * 4), hasPrint: hasPrint === 1 };
  }
  newGame.pokedexUnknown = dex.unknown;
  const dwArt = importDistortionArt(readNarc(fs.file('/data/mmodel/fldeff.narc')), readNarc(fs.file(ARCHIVES.sky)), assets, (w) => unknown('asset', w));
  const dwWarp = importDistortionWarp(fs, assets);
  dwArt.models.push(dwWarp.model);
  newGame.distortionWorld = {
    warp: dwWarp.scene,
    ...dw.tables,
    ...dwArt.tables,
    playerSprite: { male: playerGfx('OBJ_EVENT_GFX_DIST_WORLD_PLAYER_M'), female: playerGfx('OBJ_EVENT_GFX_DIST_WORLD_PLAYER_F') },
    playerSurfSprite: { male: playerGfx('OBJ_EVENT_GFX_DIST_WORLD_PLAYER_M_SURF'), female: playerGfx('OBJ_EVENT_GFX_DIST_WORLD_PLAYER_F_SURF') },
  };
  const ribbonBank = bankIndex('TEXT_BANK_RIBBON_NAMES');
  newGame.ribbons = art.ribbons.map((r) => {
    bankText(ribbonBank, r.name);
    bankText(ribbonBank, r.description);
    return { name: names.text(ribbonBank, r.name), description: names.text(ribbonBank, r.description) };
  });
  {
    const creditsBank = bankIndex('TEXT_BANK_END_CREDITS');
    const rows = new Reader(await table('credits'));
    newGame.credits = Array.from({ length: T.credits.count }, (_, i) => {
      const message = rows.u16(i * 6);
      const centered = rows.u16(i * 6 + 4);
      if (message >= bankTexts[creditsBank]!.length || centered > 1) throw new ImportError(`credits row ${i}: message ${message}, centred ${centered}`);
      return { text: names.text(creditsBank, message), y: rows.u16(i * 6 + 2), centered: centered === 1 };
    });
  }
  newGame.pokedexMap = {
    ...dex.map,
    image: asId('platinum:ui2d/pokedex/area_map'),
    hidden: HIDDEN_LOCATIONS.map((h) => ({ var: asId(`platinum:${h.var}`), value: h.value, overlay: asId(`platinum:ui2d/pokedex/${h.overlay}`), dungeons: h.dungeons })),
  };
  // The Town Map's fly mode and the fly destinations (town-map.ts).
  {
    const spawns = await table('spawnLocations');
    newGame.flyDestinations = flyDestinations(spawns, (h) => names.zone(h));
    const zoneByName = (name: string) => {
      const i = names.file.zones.indexOf(name);
      if (i < 0) throw new ImportError(`names: no zone ${name}`);
      return names.zone(i);
    };
    newGame.townMap = readTownMap(fs, { flyLocations: await table('flyLocations'), flyUnlockFlags: await table('flyUnlockFlags'), spawns }, art.townMapPatches, {
      zone: (h) => names.zone(h),
      zoneByName,
      firstArrival: (n) => names.flag(firstArrivalBase + n),
      matrix: names.matrix(0),
      flyToWhere: names.text(bankIndex('TEXT_BANK_TOWN_MAP'), 0),
      hiddenVar: (name) => {
        const h = HIDDEN_LOCATIONS.find((x) => x.var === name);
        if (!h) throw new ImportError(`no hidden location ${name}`);
        return { var: asId(`platinum:${h.var}`), value: h.value };
      },
    });
  }
  const items: Item[] = mon.items.map((item) => {
    const icon = art.itemIcons.get(item.sourceIndex!);
    if (!icon) throw new ImportError(`item ${item.id} has no icon`);
    return { ...item, icon: asId(`platinum:${icon}`) };
  });

  // Props whose build model is in no area's prop list are not converted. The DS draws such a
  // placement as its dummy box (build model 0, also not in any list), so the placement is dropped.
  const modelIds = new Set(converted.records.models.map((m) => m.id));
  const keptProps = new Set(props.filter((p) => modelIds.has(p.model)).map((p) => p.id));
  if (keptProps.size !== props.length) unknown('prop-unconverted', `${props.length - keptProps.size} build models in no area prop list (no prop record)`);
  props.splice(0, props.length, ...props.filter((p) => keptProps.has(p.id)));
  for (const p of props) {
    const animations = converted.propAnimations.get(p.sourceIndex!);
    if (animations) {
      p.animations = animations;
      if (animations.open) p.doorSounds = doorSounds(p.sourceIndex!);
    }
  }
  // Both imports keep the machines and the ball pattern, so their timing is identical.
  const healProps = [HEAL_MACHINE.machine, HEAL_MACHINE.ball, HEAL_MACHINE.hallOfFame, HEAL_MACHINE.screen].map((p) => names.prop(p));
  if (healProps.every((p) => keptProps.has(p))) newGame.healMachine = { machine: healProps[0]!, ball: healProps[1]!, hallOfFame: healProps[2]!, screen: healProps[3]! };
  else if (!options.slice) throw new ImportError(`the healing machine props ${healProps.join(', ')} were not converted`);
  const ironIsland = names.prop(PLATFORM_LIFT_PROPS.ironIsland);
  const pokemonLeague = names.prop(PLATFORM_LIFT_PROPS.pokemonLeague);
  if (keptProps.has(ironIsland) && keptProps.has(pokemonLeague)) newGame.platformLiftProps = { ironIsland, pokemonLeague };
  else if (!options.slice) throw new ImportError(`the platform lift props ${ironIsland}, ${pokemonLeague} were not converted`);
  {
    const species = (b: Uint8Array, what: string) => {
      if (b.length !== 32 * 4) throw new ImportError(`encdata_ex ${what}: ${b.length} bytes, expected 32 species`);
      const r = new Reader(b);
      return Array.from({ length: 32 }, (_, i) => names.species(r.u32(i * 4)));
    };
    const spots = new Reader(encEx[GREAT_MARSH.members.lookout]!);
    const label = (id: number) => {
      const l = names.scriptLabel(id, 0);
      if (!l) throw new ImportError(`names: no label for Safari Game script ${id}`);
      return l;
    };
    const s = GREAT_MARSH.scripts;
    const tram = names.prop(GREAT_MARSH.tram);
    newGame.greatMarsh = {
      zones: GREAT_MARSH.zones.map((z) => names.zone(z)),
      flag: names.flag(GREAT_MARSH.flag),
      daily: { regional: species(encEx[GREAT_MARSH.members.regional]!, 'regional'), national: species(encEx[GREAT_MARSH.members.national]!, 'national') },
      lookout: Array.from({ length: spots.bytes.length / 4 }, (_, i) => ({ x: spots.u16(i * 4), z: spots.u16(i * 4 + 2) })),
      labels: { outOfSteps: label(s.outOfSteps), outOfBalls: label(s.outOfBalls), outOfBallsBattle: label(s.outOfBallsBattle), retire: label(s.retire), noRoom: label(s.noRoom) },
      ...(keptProps.has(tram) ? { tram } : {}),
    };
    if (!keptProps.has(tram) && !options.slice) throw new ImportError(`the Great Marsh tram prop ${tram} was not converted`);
  }
  {
    // Amity Square (scrcmd_amity_square.c): the step var, the finds' pools with CalcAmitySquareFoundAccessory's species,
    // the man's gifts (CheckAmitySquareManGiftIsAccessory: the first 9 are items).
    const varByName = (name: string) => {
      const e = [...names.varNames].find(([, n]) => n === name);
      if (!e) throw new ImportError(`names: no ${name}`);
      return names.var(e[0]);
    };
    const speciesByName = (name: string) => {
      const i = names.file.species.indexOf(name);
      if (i < 0) throw new ImportError(`names: no ${name}`);
      return names.species(i);
    };
    const u16s = (b: Uint8Array) => Array.from({ length: b.length / 2 }, (_, i) => b[i * 2]! | (b[i * 2 + 1]! << 8));
    const finds = u16s(await table('amityFinds'));
    newGame.amitySquare = {
      stepVar: varByName('VAR_AMITY_SQUARE_STEP_COUNT'),
      finds: AMITY_FINDERS.map((species, k) => ({ species: species.map((n) => speciesByName(`SPECIES_${n}`)), accessories: finds.slice(k * 10, k * 10 + 10) })),
      gifts: u16s(await table('amityGifts')),
      itemGifts: AMITY_ITEM_GIFTS,
    };
    const visited = [...names.flagNames].find(([, n]) => n === 'FLAG_CONTEST_HALL_VISITED');
    if (!visited) throw new ImportError('names: no FLAG_CONTEST_HALL_VISITED');
    newGame.contestHallFlag = names.flag(visited[0]);
    const flagByName = (name: string) => {
      const e = [...names.flagNames].find(([, n]) => n === name);
      if (!e) throw new ImportError(`names: no ${name}`);
      return names.flag(e[0]);
    };
    newGame.objectives = objectiveTables({ flag: flagByName, var: varByName }, newGame.townMap.locations.map((l) => l.zone));
    const gfxNumber = (name: string) => {
      const gfx = [...names.gfxNames].find(([, n]) => n === name)?.[0];
      if (gfx === undefined) throw new ImportError(`names: no ${name}`);
      return gfx;
    };
    const opponentBank = bankIndex('TEXT_BANK_CONTEST_OPPONENT_NAMES');
    const judgeBank = bankIndex('TEXT_BANK_CONTEST_JUDGE_NAMES');
    newGame.contests = readContestTables(fs.file('/contest/data/contest_data.narc'), {
      species: (i) => names.species(i),
      move: (i) => names.move(i),
      opponentName: (n) => names.text(opponentBank, n),
      judgeName: (n) => names.text(judgeBank, n),
      opponentNames: bankTexts[opponentBank]!.length,
      judgeNames: bankTexts[judgeBank]!.length,
      playerGfx: { male: gfxNumber('OBJ_EVENT_GFX_PLAYER_M_CONTEST'), female: gfxNumber('OBJ_EVENT_GFX_PLAYER_F_CONTEST') },
      playerSprite: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_CONTEST'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_CONTEST') },
      acting: await (async () => {
        const banks = { effects: bankIndex('TEXT_BANK_CONTEST_EFFECTS'), outcomes: bankIndex('TEXT_BANK_CONTEST_ACTING_COMPETITION'), contest: bankIndex('TEXT_BANK_CONTEST_TEXT') };
        return readActingTables(
          {
            effects: await table('contestEffects'),
            classes: await table('contestEffectClasses'),
            typeMatch: await table('contestTypeMatch'),
            messages: await table('contestActingMessages'),
            rules: await table('contestAiRules'),
            palettes: await table('contestButtonPalettes'),
          },
          {
            effectText: (n) => names.text(banks.effects, n),
            outcomeText: (n) => names.text(banks.outcomes, n),
            contestText: (n) => names.text(banks.contest, n),
            counts: { effects: bankTexts[banks.effects]!.length, outcomes: bankTexts[banks.outcomes]!.length, contest: bankTexts[banks.contest]!.length },
          },
        );
      })(),
      dance: readContestDance(
        { songs: await table('danceSongs'), choice: await table('danceChoice'), variants: await table('danceVariants'), aiJitter: await table('danceAiJitter'), aiRepeat: await table('danceAiRepeat'), stage: await table('danceStage'), grades: await table('danceGrades'), noteRows: await table('danceNoteRows'), tints: await table('danceTints'), shades: await table('danceShades'), buttons: await table('danceButtons') },
        (n) => {
          const q = sound.sequences.find((s) => s.sourceIndex === n);
          if (!q) throw new ImportError(`dance songs: no sequence ${n}`);
          return q.id;
        },
      ),
      accessories: accessoryPictures(fs),
    });
    newGame.seals = readSealTables({
      types: await table('sealTypes'),
      marts: await table('sealMarts'),
      arm9: fs.arm9(),
      arm9Ram: fs.header.arm9RamAddress,
      delays: await table('sealDelays'),
      ballOpen: await table('ballOpenParticles'),
      trainerCapsules: fs.file('/application/custom_ball/edit/pl_cb_data.narc'),
      names: bankTexts[bankIndex('TEXT_BANK_BALL_SEAL_NAMES')]!.length,
      descriptions: bankTexts[bankIndex('TEXT_BANK_UNK_0542')]!.length,
    });
    const e = SPECIAL_ENCOUNTERS;
    const ints = (b: Uint8Array, n: number, what: string) => {
      if (b.length !== n * 4) throw new ImportError(`encdata_ex ${what}: ${b.length} bytes, expected ${n} species`);
      const r = new Reader(b);
      return Array.from({ length: n }, (_, i) => names.species(r.u32(i * 4)));
    };
    const zones = async (key: 'honeyTreeZones' | 'swarmZones') => {
      const r = new Reader(await table(key));
      return Array.from({ length: T[key].count }, (_, i) => names.zone(r.u32(i * 4)));
    };
    const label = (name: string) => {
      const id = asId(`platinum:${name}`);
      if (!decoded.ir.labels[id]) throw new ImportError(`special encounters: no script label ${id}`);
      return id;
    };
    const sequence = (name: string) => {
      const id = asId(`platinum:${name}`);
      if (!sound.sequences.some((q) => q.id === id)) throw new ImportError(`special encounters: no sequence ${id}`);
      return id;
    };
    const prop = names.prop(e.honeyTreeProp);
    if (!keptProps.has(prop)) throw new ImportError(`the honey tree prop ${prop} was not converted`);
    if (!props.find((p) => p.id === prop)?.animations?.['shake-2']) throw new ImportError(`the honey tree prop ${prop} has no shake clips`);
    const effect = (name: string) => {
      const id = asId(`platinum:FIELD_EFFECT_${name}`);
      if (!converted.records.fieldEffects.some((f) => f.id === id)) throw new ImportError(`special encounters: no field effect ${id}`);
      return id;
    };
    newGame.specialEncounters = {
      honeyTrees: { zones: await zones('honeyTreeZones'), prop, tables: e.honeyMembers.map((m) => ints(encEx[m]!, 6, `honey tree ${m}`)), label: label(e.scripts.honeyTree) },
      swarms: await zones('swarmZones'),
      trophyGarden: { zone: names.zone(e.trophyZone), species: ints(encEx[e.trophyMember]!, 16, 'Trophy Garden') },
      pokeRadar: {
        labels: { noCharge: label(e.scripts.noCharge), quiet: label(e.scripts.quiet) },
        bgm: sequence(e.sounds.radar),
        effects: { soft: effect('RADAR_GRASS_SOFT'), hard: effect('RADAR_GRASS_HARD'), shiny: effect('RADAR_GRASS_SHINY') },
      },
      sweetScent: { labels: { faded: label(e.scripts.faded), nothing: label(e.scripts.nothing) }, sound: sequence(e.sounds.sweetScent) },
    };
  }
  {
    // The Underground (underground.ts): overlay 23's and arm9's tables, its flags and vars, the buried sphere's sparkle.
    const byName = (list: Iterable<[number, string]>, name: string, get: (i: number) => Id) => {
      const e = [...list].find(([, n]) => n === name);
      if (!e) throw new ImportError(`names: no ${name}`);
      return get(e[0]);
    };
    const flag = (name: string) => byName(names.flagNames, name, (i) => names.flag(i));
    const varId = (name: string) => byName(names.varNames, name, (i) => names.var(i));
    const sparkle = asId('platinum:FIELD_EFFECT_BURIED_SPHERE_SPARKLE');
    const fieldEffect = (name: string) => {
      const id = asId(`platinum:FIELD_EFFECT_${name}`);
      if (!converted.records.fieldEffects.some((f) => f.id === id)) throw new ImportError(`underground: no field effect ${id}`);
      return id;
    };
    fieldEffect('BURIED_SPHERE_SPARKLE');
    // AreaDataManager_GetMapPropModelID: the Underground area's prop list (area_build, its count first) at the good id.
    const areaProps = new Reader(readNarc(fs.file('/fielddata/areadata/area_data.narc'))[headers[UNDERGROUND_ZONE]!.area]!).u16(0);
    const propList = new Reader(readNarc(fs.file('/fielddata/areadata/area_build_model/area_build.narc'))[areaProps]!);
    const goodProp = (good: number): Id | null => {
      if (good > propList.u16(0)) throw new ImportError(`underground: good ${good} is past the Underground's prop list (${propList.u16(0)})`);
      const prop = names.prop(propList.u16(good * 2));
      return keptProps.has(prop) ? prop : null;
    };
    const trapArt = importTrapArt(fs, undergroundSheets);
    const cursor = options.slice ? null : convertBaseCursor(fs, assets, (w) => unknown('asset', w));
    if (cursor) undergroundModels.push(cursor);
    const ov23 = fs.overlays().find((o) => o.id === 23)!;
    newGame.underground = readUndergroundTables(
      {
        miningObjects: await table('miningObjects'),
        shapes: { bytes: await table('miningShapes'), ram: ov23.ramAddress + T.miningShapes.offset },
        treasureItems: await table('treasureItems'),
        fossils: await table('fossils'),
        trapPrices: await table('trapPrices'),
        treasurePrices: await table('treasurePrices'),
        goods: await table('goods'),
        vendors: await table('ugVendors'),
        spawnTraps: await table('spawnTraps'),
      },
      {
        zone: names.zone(UNDERGROUND_ZONE),
        item: (i) => names.item(i),
        species: (i) => names.species(i),
        flags: { entered: flag('FLAG_ENTERED_UNDERGROUND'), digging: flag('FLAG_DIGGING_FOR_FOSSILS'), sphereAcquired: flag('FLAG_SPHERE_ACQUIRED') },
        vars: { fossilsUnearthed: varId('VAR_UNDERGROUND_FOSSILS_UNEARTHED'), spiritomb: varId('VAR_SPIRITOMB_COUNTER') },
        sparkle,
        goodProp,
        traps: {
          ...trapArt,
          marks: Array.from({ length: 32 }, (_, i) => fieldEffect(`UG_FLOOR_TRAP_${i + 1}`)),
          hole: fieldEffect('UG_FLOOR_BLACK_CIRCLE'),
          emotes: { exclamation: fieldEffect('UG_EMOTE_EXCLAMATION'), ok: fieldEffect('UG_EMOTE_OK') },
          vars: { trapsSet: varId('VAR_UNDERGROUND_TRAPS_SET') },
        },
        base: { cursor: cursor?.id ?? null, flags: { created: flag('FLAG_CREATED_SECRET_BASE'), decorated: flag('FLAG_DECORATED_SECRET_BASE') } },
      },
    );
    importUndergroundArt(fs, undergroundSheets, newGame.underground.miningObjects);
    for (const [path, bytes] of undergroundSheets.assets) assets.set(path, bytes);
  }
  {
    // The Game Corner (slots.ts): the slot tables, the prizes, the slot messages and the streak var; the slot art.
    const v = [...names.varNames].find(([, n]) => n === 'VAR_CONSECUTIVE_BONUS_ROUND_WINS');
    if (!v) throw new ImportError('names: no VAR_CONSECUTIVE_BONUS_ROUND_WINS');
    const bank = bankIndex('TEXT_BANK_UNK_0544');
    newGame.slots = readSlotTables(
      {
        modes: await table('slotModes'), prizes: await table('slotPrizes'), reels: await table('slotReels'), payouts: await table('slotPayouts'),
        bonusPayouts: await table('slotBonusPayouts'), winChance: await table('slotWinChance'), winFlags: await table('slotWinFlags'),
        hintChance: await table('slotHintChance'), standbySmall: await table('slotStandbySmall'), standbyFlags: await table('slotStandbyFlags'),
        bonusTypes: await table('slotBonusTypes'), continueStart: await table('slotContinueStart'), clefairyKinds: await table('slotClefairyKinds'),
        redMoon: await table('slotRedMoon'), blueMoon: await table('slotBlueMoon'), continueDrop: await table('slotContinueDrop'),
        endTells: await table('slotEndTells'), bonusOrders: await table('slotBonusOrders'), stopButtons: await table('slotStopButtons'),
        lightShow: await table('slotLightShow'), linePalettes: await table('slotLinePalettes'), symbolAnims: await table('slotSymbolAnims'),
        lineFlash: await table('slotLineFlash'), messageWindow: await table('slotMessageWindow'),
      },
      { item: (i) => names.item(i), messages: [0, 1, 2].map((n) => names.text(bank, n)), streakVar: names.var(v[0]) },
    );
    importSlotArt(fs, slotSheets, newGame.slots, { balls: readSpriteMembers(await table('slotHintSprites'), 5), clefairy: readSpriteMembers(await table('slotClefairySprites'), 3) });
    for (const [path, bytes] of slotSheets.assets) assets.set(path, bytes);
  }
  // The gym puzzles (gyms/index.ts): overlay 8 tables, the clock hand props, the gym field effects.
  const hands = { hour: names.prop(CLOCK_HAND_PROPS.hour), minute: names.prop(CLOCK_HAND_PROPS.minute) };
  const handsKept = keptProps.has(hands.hour) && keptProps.has(hands.minute);
  if (!handsKept && !options.slice) throw new ImportError(`the Eterna Gym clock hand props ${hands.hour}, ${hands.minute} were not converted`);
  const pastoria = Object.fromEntries(Object.entries(PASTORIA_PROPS).map(([k, v]) => [k, names.prop(v)])) as Record<keyof typeof PASTORIA_PROPS, Id>;
  for (const p of [...Object.values(pastoria), ...CANALAVE_PROPS.map((m) => names.prop(m))]) if (!keptProps.has(p)) throw new ImportError(`the gym prop ${p} was not converted`);
  const boatProps = [BOAT_PROPS.ship, BOAT_PROPS.snowpointShip, ...BOAT_PROPS.bridges].map((m) => names.prop(m));
  for (const p of boatProps) if (!keptProps.has(p)) throw new ImportError(`the boat prop ${p} was not converted`);
  const ships = importShips(fs, assets);
  newGame.boat = {
    ship: boatProps[0]!,
    bridges: [boatProps[2]!, boatProps[3]!],
    cinematicFrames: ships.scenes.map(s => s.frames),
    snowpointShip: names.prop(BOAT_PROPS.snowpointShip),
    scenes: ships.scenes,
  };
  const canalaveStarts = [...(await table('canalaveStarts'))].map((b) => {
    if (b > 1) throw new ImportError(`sCanalaveGymPlatformsStartInPositionB: ${b}`);
    return b === 1;
  });
  const light = readHearthomeLight(await table('hearthomeLight'));
  const gymEffects = importGymEffects(readNarc(fs.file('/data/mmodel/fldeff.narc')), light.members, assets, (w) => unknown('asset', w));
  const gymText = asId('platinum:EternaGym_Text_FountainWaterLevelDropped');
  if (!texts.some((t) => t.id === gymText)) throw new ImportError(`no text ${gymText}`);
  const clockVar = asId('platinum:VAR_ETERNA_GYM_FLOWER_CLOCK_STATE');
  if (!vars.some((v) => v.id === clockVar)) throw new ImportError(`no var ${clockVar}`);
  newGame.gyms = readGymTables(
    await table('gyms'),
    {
      zone: (i) => names.zone(i),
      eternaZone: names.zone(GYM_ZONES.eterna),
      veilstoneZone: names.zone(GYM_ZONES.veilstone),
      hearthomeEntrance: names.zone(GYM_ZONES.hearthomeEntrance),
      clockVar,
      fountainMessage: gymText,
      relicBadge: asId('platinum:BADGE_ID_RELIC'),
      hearthomePlayer: { male: playerGfx('OBJ_EVENT_GFX_PLAYER_M_HEARTHOME_GYM'), female: playerGfx('OBJ_EVENT_GFX_PLAYER_F_HEARTHOME_GYM') },
      hands: handsKept ? hands : null,
      pastoria: { buttons: { blue: pastoria.blue, green: pastoria.green, orange: pastoria.orange }, water: pastoria.water },
      prop: (m) => names.prop(m),
      canalaveStarts,
      canalaveFloors: [names.prop(300), names.prop(301), names.prop(302)],
    },
    gymEffects,
    light.tables,
  );
  newGame.gyms.sunyshore = readSunyshoreTables(await table('sunyshore'), fs.overlays().find((o) => o.id === T.sunyshore.where)!.ramAddress + T.sunyshore.offset, (m) => names.prop(m));
  const containmentLookup = new Reader(readNarc(fs.file('/arc/bm_anime_list.narc'))[496]!);
  const containmentAnimations = readNarc(fs.file('/arc/bm_anime.narc'));
  {
    // The Villa and the journal (town-extras.ts): their ROM tables, flags, vars, zones and scripts.
    const byName = (list: Iterable<[number, string]>, name: string) => {
      const e = [...list].find(([, n]) => n === name);
      if (!e) throw new ImportError(`names: no ${name}`);
      return e[0];
    };
    const flag = (name: string) => names.flag(byName(names.flagNames, name));
    const varId = (name: string) => names.var(byName(names.varNames, name));
    const zoneNamed = (name: string) => {
      const i = names.file.zones.indexOf(name);
      if (i < 0) throw new ImportError(`names: no ${name}`);
      return i;
    };
    const villaHeader = zoneNamed('MAP_HEADER_VILLA');
    const furnitureStart = byName(names.flagNames, 'FLAG_VILLA_FURNITURE_TABLE');
    newGame.villa = readVillaTables(await table('villaFurnitures'), await table('villaFurnitureModels'), await table('villaFurnitureScripts'), await table('villaVisitorChances'), await table('villaVisitorCounts'), {
      zone: names.zone(villaHeader),
      resortArea: names.zone(zoneNamed('MAP_HEADER_RESORT_AREA')),
      flag: (type) => names.flag(furnitureStart + type),
      prop: (model) => {
        const p = names.prop(model);
        if (!keptProps.has(p)) throw new ImportError(`the Villa furniture prop ${p} was not converted`);
        return p;
      },
      label: (script) => {
        const l = names.scriptLabel(script, headers[villaHeader]!.scripts);
        if (!l) throw new ImportError(`the Villa furniture script ${script} has no label`);
        return l;
      },
      visitors: { visitorVar: varId('VAR_RESORT_VILLA_VISITOR'), messageVar: varId('VAR_RESORT_VILLA_VISITOR_MESSAGE_NUM'), insideFlag: flag('FLAG_VILLA_VISITOR_INSIDE'), outsideFlag: flag('FLAG_VILLA_VISITOR_OUTSIDE') },
    });
    const trainerNamed = (name: string) => {
      const i = names.file.trainers.indexOf(name);
      if (i < 0) throw new ImportError(`names: no ${name}`);
      return names.trainer(i);
    };
    const label = (name: string) => {
      const m = textBanks[bankIndex('TEXT_BANK_LOCATION_NAMES')]!.messages.indexOf(asId(`platinum:${name}`));
      if (m < 0) throw new ImportError(`names: no ${name}`);
      return m;
    };
    const bank = (name: string) => textBanks[bankIndex(name)]!.id;
    const classIndex = names.file.trainerClasses.indexOf('TRAINER_CLASS_RIVAL');
    if (classIndex < 0) throw new ImportError('names: no TRAINER_CLASS_RIVAL');
    // The TV schedule (tv.ts).
    newGame.tv = readTvTables(fs.file('/arc/tv.narc'));
    newGame.journal = readJournalTables(await table('journalGyms'), await table('journalBuildings'), await table('journalPageTurn'), {
      flag: flag('FLAG_JOURNAL_ACQUIRED'),
      caveDeparted: ['LocationNames_Text_ValleyWindworks', 'LocationNames_Text_SnowpointTemple', 'LocationNames_Text_FuegoIronworks'].map(label),
      eliteFour: ['AARON', 'AARON_REMATCH', 'BERTHA', 'BERTHA_REMATCH', 'FLINT', 'FLINT_REMATCH', 'LUCIAN', 'LUCIAN_REMATCH'].map((n) => trainerNamed(`TRAINER_ELITE_FOUR_${n}`)),
      champion: [trainerNamed('TRAINER_CHAMPION_CYNTHIA'), trainerNamed('TRAINER_CHAMPION_CYNTHIA_REMATCH')],
      home: names.zone(zoneNamed('MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F')),
      lab: names.zone(zoneNamed('MAP_HEADER_SANDGEM_TOWN_POKEMON_RESEARCH_LAB')),
      rivalClass: names.trainerClass(classIndex),
      martExcluded: { label: label('LocationNames_Text_VeilstoneStore'), zones: [names.zone(zoneNamed('MAP_HEADER_ETERNA_CITY_HERB_SHOP')), names.zone(zoneNamed('MAP_HEADER_CELESTIC_TOWN_NORTHWEST_HOUSE'))] },
      banks: { entries: bank('TEXT_BANK_JOURNAL_ENTRIES'), months: bank('TEXT_BANK_MONTH_NAMES'), gyms: bank('TEXT_BANK_GYM_NAMES'), locations: bank('TEXT_BANK_LOCATION_NAMES'), times: bank('TEXT_BANK_TIMES_OF_DAY') },
      ...(ui2dIds.has('platinum:ui2d/journal/page-male') ? { art: { male: asId('platinum:ui2d/journal/page-male'), female: asId('platinum:ui2d/journal/page-female') } } : {}),
      trainer: (i) => names.trainer(i),
      zone: (i) => names.zone(i),
      badge: (i) => BADGE_IDS[i] ?? (() => { throw new ImportError(`sGymsInfo: badge ${i}`); })(),
    });
    const diplomaBank = textBanks[bankIndex('TEXT_BANK_DIPLOMA')]!.messages;
    if (ui2dIds.has('platinum:ui2d/diploma/sinnoh')) {
      newGame.diploma = { sinnoh: asId('platinum:ui2d/diploma/sinnoh'), national: asId('platinum:ui2d/diploma/national'), texts: { player: diplomaBank[0]!, sinnoh: diplomaBank[1]!, national: diplomaBank[2]!, credit: diplomaBank[3]! } };
    }
  }
  newGame.containment = { prop: names.prop(496), loopFrames: animationFrames(containmentAnimations[containmentLookup.i32(4)]!), openingFrames: animationFrames(containmentAnimations[containmentLookup.i32(8)]!) };
  const spear = importSpearPillar(fs, assets, textBanks.find(b => b.id === 'platinum:TEXT_BANK_SPEAR_PILLAR')!.messages);
  newGame.spearPillar = spear.tables;
  let droppedPlacements = 0;
  for (const c of chunks) {
    const before = c.props.length;
    c.props = c.props.filter((p) => keptProps.has(p.prop));
    droppedPlacements += before - c.props.length;
  }
  if (droppedPlacements) unknown('prop-placement-dropped', `${droppedPlacements} placements of unconverted build models (the DS draws its dummy box)`);
  // A texture set with no converted pair has no folder: such areas bind no set.
  const assetDirs = new Set([...converted.assets.keys()].map((p) => p.slice(0, p.lastIndexOf('/'))));
  for (const a of areas)
    for (const key of ['mapTextures', 'propTextures'] as const) {
      const ref = a[key];
      if (ref && !assetDirs.has(ref.replace(/^platinum:/, ''))) {
        delete a[key];
        unknown('texture-set-empty', `${a.id} ${key}: ${ref} has no converted textures`);
      }
    }

  // Sprite records keyed by object gfx: a converted mmodel walk set → billboard, else a model object
  // (signposts, mailboxes, and mmodel sets the asset import does not convert yet) with no model.
  const billboards = new Map(converted.records.sprites.map((b) => [b.sourceIndex!, b]));
  for (const [gfx, name] of names.gfxNames) if (!name.startsWith('OBJ_EVENT_GFX_VAR_')) spriteGfx.add(gfx);
  const sprites: Sprite[] = [...spriteGfx]
    .sort((a, b) => a - b)
    .map((gfx) => {
      const mmodel = gfxToMmodel.get(gfx);
      const b = mmodel === undefined ? undefined : billboards.get(mmodel);
      if (b) return { ...b, id: spriteId(gfx), sourceIndex: gfx };
      return { id: spriteId(gfx), sourceIndex: gfx, model: converted.modelObjects.get(gfx) ?? null };
    });
  // OBJ_EVENT_GFX_SNOWBALL draws through its own renderer (ov5_021F23D0.c), not a billboard: the fldeff model.
  const snowball = sprites.find((sp) => sp.sourceIndex === SNOWBALL_GFX);
  if (!snowball || !('model' in snowball) || snowball.model !== null) throw new ImportError(`object gfx 0x${SNOWBALL_GFX.toString(16)} is not an unconverted model object`);
  snowball.model = gymEffects.snowball.model;
  sprites.push(converted.exclamation, converted.doubleExclamation);
  // Field-effect billboards (assets/field-effects.ts) are not object gfx: they carry no sourceIndex.
  sprites.push(...converted.records.sprites.filter((s) => s.sourceIndex === undefined));
  // Party follower sets: the Pokémon gfx with a walking set (followers.ts).
  const followers = platinumFollowers(names.gfxNames, sprites, spriteId, (i) => names.species(i));
  const unconverted = sprites.filter((s) => 'model' in s && s.model === null).length;
  if (unconverted) unknown('sprite-model', `${unconverted} of ${sprites.length} object gfx have neither a billboard atlas nor a converted model (model: null)`);

  // Every flag/var/text the zones or the IR name must exist: unnamed ones get records here.
  const flagIds = new Set(flags.map((f) => f.id));
  const varIds = new Set(vars.map((v) => v.id));
  const textIds = new Set(texts.map((t) => t.id));
  const indexOf = (id: Id, kind: string) => {
    const m = new RegExp(`^platinum:${kind}/(\\d+)$`).exec(id);
    if (!m) throw new ImportError(`${id}: not a named ${kind} and not platinum:${kind}/<n>`);
    return Number(m[1]);
  };
  const needFlag = (id: Id) => {
    if (flagIds.has(id)) return;
    const i = indexOf(id, 'flag');
    flagIds.add(id);
    flags.push({ id, sourceIndex: i, initial: false, scope: i >= 1 && i <= 0x40 ? 'map' : 'saved' });
  };
  const needVar = (id: Id) => {
    if (varIds.has(id)) return;
    const i = indexOf(id, 'var');
    varIds.add(id);
    vars.push({ id, sourceIndex: i, initial: 0, scope: i >= 0x8000 ? 'temp' : i <= 0x401f ? 'map' : 'saved' });
  };
  for (const z of zones) {
    for (const c of z.events.coords) needVar(c.var);
    for (const r of z.mapScripts.onFrame) needVar(r.var);
    for (const o of z.events.objects) {
      if (o.hideFlag) needFlag(o.hideFlag);
      if (typeof o.sprite === 'object') needVar(o.sprite.var);
    }
  }
  for (const [label, cmds] of Object.entries(decoded.ir.labels))
    for (const c of cmds)
      for (const a of c.args) {
        if (a.kind === 'flag') needFlag(a.id);
        else if (a.kind === 'var') needVar(a.id);
        else if (a.kind === 'text' && !textIds.has(a.id)) {
          // Messages past the end of a bank, or in a map file no zone uses (no known bank).
          textIds.add(a.id);
          texts.push({ id: a.id, text: '' });
          unknown('missing-text', `${label} ${c.op}: ${a.id} (empty text)`);
        }
      }

  const registries = {
    zones,
    matrices,
    chunks,
    areas,
    lights,
    weathers,
    fieldEffects: [...converted.records.fieldEffects, ...gymEffects.records.fieldEffects],
    encounters,
    tileBehaviors,
    props,
    cameras: cameraRecords,
    models: [...converted.records.models, ...title.models, ...creditsRide.models, ...ships.models, ...spear.models, ...starter.models, ...gymEffects.records.models, ...dwArt.models, ...undergroundModels],
    textureAnimations: [...converted.records.textureAnimations, ...gymEffects.records.textureAnimations, ...dwArt.textureAnimations],
    sprites,
    followers,
    movements: decoded.movements,
    fonts: [font.record, unownFont.record],
    texts,
    textBanks,
    flags,
    vars,
    species,
    moves: mon.moves,
    abilities: mon.abilities,
    types: mon.types,
    natures: mon.natures,
    growthRates: mon.growthRates,
    items,
    trainers,
    marts: [...mon.marts, ...frontier.marts],
    newGame: [newGame],
    titleScreens: [title.titleScreen],
    ui2d: [...art.ui2d, ...starterSheets.records, ...animSheets.records, ...frontierSheets.records, ...undergroundSheets.records, ...slotSheets.records],
    pokemonSprites: art.pokemonSprites,
    trainerSprites: art.trainerSprites,
    battleBackgrounds: art.battleBackgrounds,
    battleTerrains: art.battleTerrains,
    sequences: sound.sequences,
    soundBanks: sound.soundBanks,
    waveArchives: sound.waveArchives,
    soundPlayers: sound.soundPlayers,
    cries: sound.cries,
    distortionRooms: dw.rooms,
    battleAnimations: anims.battleAnimations,
    particleSystems: anims.particleSystems,
    battleAnimData: anims.battleAnimData,
    aiScripts: [
      readTrainerAi(
        {
          script: await table('aiScript'),
          noDamageCalcEffects: await table('aiNoDamageCalcEffects'),
          altPowerEffects: await table('aiAltPowerEffects'),
          weightToPower: await table('aiWeightToPower'),
        },
        names,
      ),
    ],
  };
  const pack: PackData = {
    manifest: { id: 'platinum', name: 'Pokémon Platinum (imported from your ROM)', version: '0.1.0', engine: '^0.1.0', dependencies: {}, loadAfter: [] },
    registries: registries as unknown as Record<string, RegistryRecord[]>,
    scripts: decoded.ir,
    patches: [],
    remove: [],
    provenance: 'rom-derived',
  };
  const counts = Object.fromEntries(Object.entries(registries).map(([k, v]) => [k, v.length]));
  counts.events = zones.reduce((n, z) => n + z.events.bgs.length + z.events.objects.length + z.events.warps.length + z.events.coords.length, 0);
  counts.labels = Object.keys(decoded.ir.labels).length;
  counts.assets = assets.size;
  return { pack, assets, report: { rom: supported.id, counts, unknowns, distortionWorld: distortion.audit, ms: Date.now() - start } };
}
