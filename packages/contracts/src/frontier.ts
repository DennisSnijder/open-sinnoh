/**
 * The Battle Frontier (contracts 0.34.0): its second script system and the facilities on it. The
 * decomp's overlay 104 runs `fr_script` scenes (a 2D room of BG layers and 2D characters, decomp frontier_scenes.c,
 * frontier_graphics.c, overlay 63) with their own commands (`fr_*` ops, vm `frontier/`). A field op launches a scene
 * (`launch_battle_frontier_scene`); the field script waits until the frontier exits. The scene's messages, menus and
 * yes/no boxes are the field's (`ScriptView.message`, `menu`, `yesNo`); what is drawn is `ScriptView.frontier`.
 *
 * The Battle Tower is the first facility on it (decomp unk_02049D08.c, unk_0204AEE8.c, overlay 104
 * frscrcmd_battle_tower.c, ov104_0223A0C4.c). Its saved part is `GameState.frontier` (decomp WifiBattleTowerRecord,
 * WifiBattleTowerSave and BattleFrontierStats' tower stats); the challenge itself (decomp BattleTower) lives in the
 * VM between the receptionist's InitBattleTower and FreeBattleTower, as on the DS.
 */
import type { Gender, Id, Pokemon, StatusCondition } from '@opensinnoh/core';
import type { BattleWeather } from './battle.ts';
import type { Facing } from './records.ts';

/** A frontier scene (decomp sFrontierScenes, overlay 104; FRONTIER_SCENE_*): its script, text bank, music and room. */
export interface FrontierSceneData {
  /** The scene script's first entry label (`<FileLabel>/0`, vm `frontierFileLabelName`; a ChangeScript names others). */
  entry: Id;
  /** The text bank its messages are in (decomp FR_SCENE_BANK_ID). */
  textBank: Id;
  /** The scene BGM (decomp FR_SCENE_BGM_ID), null in packs without sound. */
  bgm: Id | null;
  /**
   * The room: BG3 (decomp FR_SCENE_TILEMAP_IDX) and the BG2 layer above the characters (FR_SCENE_SUB_TILEMAP_IDX), each
   * a `ui2d` sheet whose cell 0 is the whole layer, `width`×`height` px. Null without 2D art (the fixture).
   */
  bg: { sheet: Id; width: number; height: number } | null;
  fg: { sheet: Id; width: number; height: number } | null;
  /** The decomp's scene setup task (the other facilities' rooms: rotating BGs, the Castle's windows). Not run yet; logged. */
  setup: boolean;
  /** 0.37.0. Decomp FR_SCENE_FLAG_2 (unk_23) 0: BG2 does not scroll with the camera (the Factory corridor's floor). */
  fgFixed?: true;
}

/** A frontier trainer (decomp pl_btdtr member, FrontierTrainerBase; FRONTIER_TRAINER_*). */
export interface FrontierTrainerData {
  /** Decomp trainerType (a TRAINER_CLASS_*). */
  class: Id;
  /** The class name (TEXT_BANK_TRAINER_CLASS_NAMES), as `Trainer.className`. */
  className: Id;
  /** Its name (decomp TEXT_BANK_FRONTIER_TRAINER_NAMES message = the trainer id). */
  name: Id;
  /** The sets it draws from (indexes into `FrontierTables.sets`). */
  sets: number[];
}

/** A frontier Pokémon set (decomp pl_btdpm member, FrontierPokemonBase). */
export interface FrontierSetData {
  species: Id;
  form: number;
  moves: Id[];
  /** Decomp evFlags: bit i = stat i (HP, Attack, Defense, Speed, Sp. Atk, Sp. Def) gets 510 / count EVs (at most 255). */
  evFlags: number;
  nature: Id;
  item: Id | null;
}

/** The Battle Tower's own tables (decomp unk_0204AEE8.c, unk_02049D08.c, frontier_opponents.c). */
export interface BattleTowerTables {
  /** Decomp sBattleTowerTrainerRangesPerRoom: [first, last] trainer per room 0–7 (room 7 for every later room). */
  ranges: [number, number][];
  /** Decomp sBattleTowerBossTrainerRangesPerRoom: the seventh opponent's range per room. */
  bossRanges: [number, number][];
  /** FRONTIER_TRAINER_TOWER_TYCOON_PALMER_SILVER, _GOLD: the singles 21st and 49th opponents. */
  palmer: [number, number];
  /** FRONTIER_TRAINER_TRAINER_CHERYL_CHERYL: the first of the five multi partners (Cheryl, Mira, Riley, Marley, Buck). */
  partners: number;
  /** Decomp sBattleTowerReservedItems: the items a party gets after 50 failed draws (by party slot). */
  reservedItems: Id[];
  /** Decomp soloBattlePoints (BattleTower_GiveBattlePointsReward): BP for seven wins in room 0–7 (7 for later rooms). */
  battlePoints: number[];
  /** BP for beating Palmer (decomp BattleTower_GiveBattlePointsReward's beatPalmer branch). */
  palmerBattlePoints: number;
  /** Decomp sTrainerClassToObjectID: the 2D character (an object gfx number) a trainer class walks in as; others `defaultObject`. */
  classObjects: { class: Id; gfx: number }[];
  defaultObject: number;
}

/** Decomp BattleFactoryPokemonPool: the sets a trainer below `trainerMax` (or a player's round) draws from. */
export interface FactoryPool {
  trainerMax: number;
  setMin: number;
  setMax: number;
  ivs: number;
  /** Decomp canBeUpgraded: trades move some picks to the next pool (sTradeCountsNeededForUpgrades). */
  upgradable: boolean;
}

/**
 * 0.37.0. The Battle Factory's tables (decomp overlay 104 battle_factory_helpers.c, battle_factory.c). Rounds count
 * seven battles each; round 7 stands for every later round.
 */
export interface BattleFactoryTables {
  /** Decomp sBattleFactoryOpponentPools: per round, [first, past-last) trainers of battles 1–6 and of the seventh. */
  opponentRanges: [number, number, number, number][];
  /** Decomp sLevel50Pools (players and opponents at level 50). */
  level50Pools: FactoryPool[];
  /** Decomp sOpenLevelOpponentPools and sOpenLevelPlayerPools (Open Level, level 100). */
  openOpponentPools: FactoryPool[];
  openPlayerPools: FactoryPool[];
  /** Decomp sTradeCountsNeededForUpgrades: trade counts above which one more rental comes from the next pool. */
  tradeUpgrades: number[];
  /** Decomp sBPPerRoundSolo (BattleFactory_GetEarnedBP): BP per round completed, by round 0–8. */
  battlePoints: number[];
  /** FRONTIER_TRAINER_FACTORY_HEAD_THORTON_SILVER, _GOLD: the singles 21st and 49th opponents. */
  thorton: [number, number];
  /** The rental screens' art (battle_factory_app over frontier_bg, the app's frontier_obj sprites); null without 2D art. */
  art: FactoryAppArt | null;
}

/**
 * The Battle Factory app's layers (decomp battle_factory/main.c LoadBackgrounds): each a `ui2d` sheet of one cell,
 * drawn with the app's BG palette RAM (battle_factory_app NCLR, 11 palettes) as loaded. `conveyor` is 512 px wide
 * (BG2 scrolls); `panelPalettes` are the selection panel drawn in each of the decomp's panel palettes (hidden,
 * fading, shown; GetBackgroundPanelPalette), `wheel` the wheel in its four cycling palettes (6–9).
 */
export interface FactoryAppArt {
  wheel: Id[];
  conveyor: Id;
  selection: Id;
  noScreens: Id;
  summary: Id;
  /** The app's sprites (BATTLE_FACTORY_APP_SPRITES: the Poké Balls, cursors and panels) with their animations. */
  sprites: Id;
  /** The same in palette 1 (PALETTE_POKEBALL_NOT_SELECTED: a ball not picked). */
  unpicked: Id;
}

/**
 * 0.37.0. The Battle Hall's tables (decomp overlay 104 battle_hall_helpers.c, battle_hall.c; arm9 scrcmd_battle_hall.c).
 * Rounds count ten battles each.
 */
export interface BattleHallTables {
  /** The Hall's own sets (pl_bsdpm, 478; set 0 a placeholder), as `FrontierTables.sets`. */
  sets: FrontierSetData[];
  /** Decomp sBattleHallPotentialOpponents: entry i is set i + 1's species. */
  opponents: Id[];
  /** Decomp sBattleHallPotentialOpponentTypes: entry i's two types (the type it counts as for a pick). */
  opponentTypes: [Id, Id][];
  /** Decomp sPotentialMatchupRangesByRank: the entries (1-based, inclusive) a rank 0–9 draws from. */
  rankRanges: [number, number][];
  /** Decomp sMatchupGroupRanges: the four groups (the Matron's picks). */
  groupRanges: [number, number][];
  /** Decomp sIVsPerTypeRank. */
  ivs: number[];
  /** Decomp sFrontierTrainerClasses: frontier trainers 0–299 by class, the trainers the Hall picks from. */
  trainerClasses: Id[];
  /** Decomp sHallTrainerClassesByRank (8 per rank) and sHallTrainerClassesBySelectedType (4 per board cell 0–17). */
  classesByRank: Id[][];
  classesByCell: Id[][];
  /** Decomp sBattleHallAppGridOrder: the board's 20 cells, a type or `summary` (cells 17–18) or the Matron's `???` (19). */
  grid: (Id | 'summary')[];
  /** Decomp sBPPerRoundSolo (BattleHall_GetEarnedBP): BP per round completed, by round 0–18. */
  battlePoints: number[];
  /** Decomp sBattleHallRecordMilestones (arm9): the record keeper's total-record milestones and their BP. */
  milestones: { record: number; bp: number }[];
  /** FRONTIER_TRAINER_HALL_MATRON_ARGENTA_SILVER, _GOLD: the singles 50th and 170th opponents. */
  argenta: [number, number];
  /** The board's art (battle_hall_app over frontier_bg, the cursor box); null without 2D art. */
  art: HallAppArt | null;
}

/**
 * The Battle Hall board's art (decomp battle_hall/main.c): `board` is BG3 (battle_hall_app, 256×192) drawn in each
 * cell palette state (normal, selected, unselectable: ChangeCellBackground's palettes 0, 5, 3); `cursor` the
 * cursor box (BATTLE_HALL_APP_CURSOR_BOX) with its animations.
 */
export interface HallAppArt {
  board: { normal: Id; selected: Id; unselectable: Id };
  cursor: Id;
}

/** 0.39.0. A rentable item and its price in Castle Points (decomp sItemsForRent/sItemPrices, sBerriesForRent/sBerryPrices). */
export interface CastleRental {
  item: Id;
  cp: number;
}

/**
 * 0.39.0. The Battle Castle's tables (decomp overlay 104 battle_castle.c, battle_castle_helpers.c; overlay 107
 * battle_castle_app self_app.c). Rounds count seven battles each; round 7 stands for every later round.
 */
export interface BattleCastleTables {
  /** Decomp sBattleCastleOpponentPools: per round, [first, past-last) trainers of battles 1–6 and of the seventh. */
  opponentRanges: [number, number, number, number][];
  /** Decomp sBPPerRoundSolo (BattleCastle_GetEarnedBP): BP per round completed, by round 0–8. */
  battlePoints: number[];
  /** FRONTIER_TRAINER_CASTLE_VALET_DARACH_SILVER, _GOLD: the singles 21st and 49th opponents. */
  darach: [number, number];
  /** Decomp sItemsForRent, sBerriesForRent with their prices. */
  items: CastleRental[];
  berries: CastleRental[];
  /** Decomp sItemsAvailableByRank, sBerriesAvailableByRank: how many of each list the rental rank 1–3 shows. */
  itemsByRank: number[];
  berriesByRank: number[];
  /** Decomp sHealingCosts: restore HP, PP, all. */
  healCosts: number[];
  /** Decomp sRankUpCosts[rank type][rank]: the CP to raise the healing and rental ranks from rank 1, 2. */
  rankUpCosts: number[][];
  /** The apps' art and the battle room's emblem; null without 2D art. */
  art: CastleAppArt | null;
}

/**
 * 0.39.0. The Battle Castle's art (decomp battle_castle/self_app.c, opponent_app.c; battle_castle_helpers.c
 * GetEmblemTiles): each layer a `ui2d` sheet of one 256×192 cell drawn with the app's BG palettes as loaded (the first
 * four of battle_castle_self_app / _opponent_app NCLR): `main` BG3 (the solo layout), `items`, `summary` and `moves`
 * BG2 (the panels over it). `sprites` are BATTLE_CASTLE_APP_SPRITES (frontier_obj 15–17, 39) with their animations
 * (sprites.h ANIM_ID_*). `emblems` are the battle room's emblem frame for rounds 1–7 (10 × 3 tiles of the room's BG3
 * at tile 11, 6).
 */
export interface CastleAppArt {
  self: { main: Id; items: Id; summary: Id; moves: Id };
  opponent: { main: Id; summary: Id; moves: Id };
  sprites: Id;
  emblems: Id[];
}

/**
 * 0.39.0. The Battle Arcade's tables (decomp overlay 104 battle_arcade.c, battle_arcade_helpers.c; overlay 108
 * battle_arcade_app main.c). Effects are ARCADE_EFFECT_* 0–31; rounds count seven battles each.
 */
export interface BattleArcadeTables {
  /** Decomp sBattleArcadeOpponentPools (as the Castle's). */
  opponentRanges: [number, number, number, number][];
  /** Decomp sBPPerRoundSolo (BattleArcade_GetEarnedBP), by round 0–8. */
  battlePoints: number[];
  /** FRONTIER_TRAINER_ARCADE_STAR_DAHLIA_SILVER, _GOLD. */
  dahlia: [number, number];
  /** Decomp sRouletteSpeedByRound: from `round` on, the board starts at `speed`. */
  rouletteSpeeds: { round: number; speed: number }[];
  /** Decomp sCursorMoveFrames[speed][0]: the ticks between cursor steps at speed 0–7. */
  cursorTicks: number[];
  /** Decomp sEffectAvailabilityByRound: per effect, bit r for round r + 1 (round 7 for later ones). */
  effectsByRound: number[];
  /**
   * Decomp sEffectAvailabilityByBattle: bit b for battle b + 1 of the round, for SWAP_MONS, SPEED_UP, SLOW_DOWN,
   * RANDOMIZE_CURSOR, GET_1_BP, NO_BATTLE, GET_3_BP in that order.
   */
  effectsByBattle: number[];
  /** Decomp sCategoryWeights[tier][category] (foe, ally, environment, bonus; in percent) and the tier thresholds. */
  categoryWeights: number[][];
  categoryThresholds: number[];
  /** Decomp sPerformanceByNumWithStatus, sPerformanceByNumFainted, sPerformanceByTurnsElapsed. */
  performance: { status: number[]; fainted: number[]; turns: { turns: number; score: number }[] };
  /** Decomp sItemPools, sBerryPools: the item and berry an effect gives, by tier (rounds 1–3, 4–6, 7+). */
  itemPools: Id[][];
  berryPools: Id[][];
  /** The board's and the battle room's art; null without 2D art. */
  art: ArcadeAppArt | null;
}

/**
 * 0.39.0. The Battle Arcade's art (decomp battle_arcade/main.c, battle_arcade.c sBattleArcadeScreenAssets): `initial`
 * and `roulette` the board's BG3 (battle_arcade_app main NSCRs over the first seven palettes); `sprites`
 * BATTLE_ARCADE_APP_SPRITES (frontier_obj 18–20, 40: animations 0–31 the effect tiles, 32–34 the turning tile, 35 the
 * cursor); `button` the touch screen's STOP button (21–23, 41: 0 up, 1 pressed, 2 inactive); `screens` the battle
 * room's BG2 per effect (256 × 192).
 */
export interface ArcadeAppArt {
  initial: Id;
  roulette: Id;
  sprites: Id;
  button: Id;
  screens: Id[];
}

/** NewGame.frontier: the Battle Frontier tables (0.34.0). */
export interface FrontierTables {
  /** By scene id (FRONTIER_SCENE_*); null for the unused scenes 0–2 (no script or op launches them). */
  scenes: (FrontierSceneData | null)[];
  /** By frontier trainer id (FRONTIER_TRAINER_*, 315). */
  trainers: FrontierTrainerData[];
  /** By set id (951). */
  sets: FrontierSetData[];
  /** TEXT_BANK_FRONTIER_TRAINER_MESSAGES: trainer t's intro is message 3t, its win (the player lost) 3t + 1, its defeat 3t + 2. */
  trainerMessages: Id;
  tower: BattleTowerTables;
  /** 0.37.0. */
  factory: BattleFactoryTables;
  /** 0.37.0. */
  hall: BattleHallTables;
  /** 0.39.0. */
  castle: BattleCastleTables;
  /** 0.39.0. */
  arcade: BattleArcadeTables;
  /**
   * The 2D characters (decomp overlay 63's gfx table into wifi2dchar): an object gfx number (decomp OBJ_EVENT_GFX_*,
   * as the frontier scripts and tables hold them, decimal) → its `ui2d` sheet with the overlay's animations.
   */
  characters: Record<string, Id>;
  /** The frontier_obj sprites (FrontierScrCmd_2A ids, the tower's doors) → `ui2d` sheet with its animations. */
  objects: Record<string, Id>;
  /** The shadow under every 2D character (decomp ov63_0222B7E8: wifi2dchar cells 0). */
  shadow: Id;
  /** Decomp sBattleFrontierBanlist: species no facility accepts. */
  banlist: Id[];
  /** Decomp Shop_GetItemBPPrice (overlay 7): the exchange counters' BP prices. */
  prices: { item: Id; bp: number }[];
  /**
   * Decomp sHighestIVMessageIndices (ov5_021F6454.c): the IV judge's "best potential in …" message per stat (HP, Attack,
   * Defense, Speed, Sp. Atk, Sp. Def), which `judge_stats` returns as a message number of the script's bank.
   */
  judgeMessages: Id[];
}

/**
 * One character in a frontier scene (decomp FrontierScrCmd_24, an overlay 63 2D object and its sprite). `x`/`y` is the
 * sprite's position in room px (its cells' origin); its shadow (`FrontierView.shadow`) is drawn 8, 14 from it. `anim`
 * and `frame` are the sheet animation and its frame the 2D sprite shows (decomp ov63_0222B308: 0–3 standing by
 * direction up, down, left, right; 5–8 walking).
 */
export interface FrontierActorView {
  localId: number;
  sheet: Id;
  x: number;
  y: number;
  facing: Facing;
  anim: number;
  frame: number;
  visible: boolean;
  /** 0.39.0. Its palette blended `darken`/16 toward black (decomp BA_FUNC_UNK_44); absent at 0. */
  darken?: number;
}

/** A frontier_obj sprite (FrontierScrCmd_2C): the tower's doors. `anim`/`frame` as `FrontierActorView`'s. */
export interface FrontierObjectView {
  slot: number;
  sheet: Id;
  x: number;
  y: number;
  anim: number;
  frame: number;
  visible: boolean;
  /** Mirrored left to right (FrontierScrCmd_2F). */
  flip?: true;
}

/** What a running frontier scene draws (`ScriptView.frontier`). */
export interface FrontierView {
  scene: number;
  bg: FrontierSceneData['bg'];
  fg: FrontierSceneData['fg'];
  /** The view's top-left in room px (decomp ov63_0222D160: the player object's position − 112, 96). */
  camera: { x: number; y: number };
  /** The characters' shadow sheet (`FrontierTables.shadow`). */
  shadow: Id;
  actors: FrontierActorView[];
  objects: FrontierObjectView[];
  /** The screen fade (decomp FrontierScrCmd_FadeScreen, brightness): `alpha` 0 clear … 1 full. */
  fade: { color: 'black' | 'white'; alpha: number } | null;
  /** 0.37.0. BG2's scroll (decomp Bg_ScheduleScroll: the Factory corridor's moving floor), in px; absent at 0, 0. */
  fgScroll?: { x: number; y: number };
  /** 0.37.0. BG2 under BG3 (decomp BattleFactoryCorridorSceneSetup: priorities 3 and 2), the characters above both. */
  fgBelow?: true;
  /** 0.37.0. BG2 stays put as the camera moves (`FrontierSceneData.fgFixed`). */
  fgFixed?: true;
  /** 0.37.0. BG2 blended over the layers and sprites below (decomp G2_SetBlendAlpha: `a`/16 of BG2, `b`/16 of below). */
  fgBlend?: { a: number; b: number };
  /** 0.37.0. BG2 hidden (decomp GXLayers_EngineAToggleLayers BG2 off: the Hall's light beams). */
  fgHidden?: true;
  /** 0.37.0. The whole screen's shake offset in px (decomp FrontierScrCmd_4C), absent when still. */
  shake?: { x: number; y: number };
  /**
   * 0.37.0. Window 0 (decomp FrontierScrCmd_4E, ov104_022331E8): inside the rect (screen px, x1 ≤ x < x2, y1 ≤ y < y2)
   * only the BG layers show, so the characters and sprites are hidden there.
   */
  window?: { x1: number; y1: number; x2: number; y2: number };
  /**
   * 0.37.0. A party Pokémon's front sprite on the stage (decomp FrontierScrCmd_45, ov104_02232CE0): its sprite's centre
   * at x, y (screen px), its palette blended `darken`/16 toward black.
   */
  pokemon?: { species: Id; form: number; female: boolean; shiny: boolean; x: number; y: number; darken: number };
  /**
   * 0.39.0. A framed window over the room (decomp FrontierScrCmd_ShowCastlePointsWindows: BG1 at tile 1, 1, 10 × 4, the
   * standard frame): `x`/`y` its interior in screen px, each line at its offset inside it (the player's name at 0, 0,
   * the Castle Points at 16, 16).
   */
  infoWindow?: { x: number; y: number; width: number; height: number; lines: { text: string; x: number; y: number }[] };
  /** 0.39.0. A patch of BG3 at room px (decomp BattleCastle_UpdateEmblemFrame: the battle room's emblem for the round). */
  bgPatch?: { sheet: Id; x: number; y: number };
  /** 0.39.0. BG3's palette blended `bgDarken`/16 toward black (decomp BattleArcade_SetPalette); absent at 0. */
  bgDarken?: number;
  /**
   * 0.39.0. Pokémon icons on the room (decomp BattleFrontier_CreateMonSprite / _CreateItemSprite: the Arcade's two
   * columns): the icon's centre at x, y (screen px), still on its first frame, and its held-item mark.
   */
  icons?: { species: Id; form: number; x: number; y: number; visible: boolean; item: { x: number; y: number; visible: boolean } }[];
}

/** A frontier trainer in a battle (decomp FrontierTrainer, FieldBattleDTO_InitFrontierTrainer). */
export interface FrontierBattleTrainer {
  /** The frontier trainer id (its messages: `FrontierTables.trainerMessages`). */
  id: number;
  name: string;
  class: Id;
  className: Id;
  party: Pokemon[];
}

/**
 * 0.34.0. A Battle Frontier battle (decomp BATTLE_TYPE_FRONTIER, FieldBattleDTO_NewBattleTower): the player's battle
 * party (level-capped copies of the chosen Pokémon) against frontier trainers. No experience, money, bag or Pokédex
 * entries; RUN asks to forfeit (a loss); the result's party is not written back.
 */
export interface FrontierBattle {
  /** 0.37.0: `factory` and `hall` (their backdrops, BACKGROUND_BATTLE_FACTORY and _HALL); 0.39.0 `castle`, `arcade`. */
  facility: 'tower' | 'factory' | 'hall' | 'castle' | 'arcade';
  party: Pokemon[];
  /** The enemy trainers (battlers 1 and, in multi, 3). */
  trainers: FrontierBattleTrainer[];
  /** Multi with an AI partner: the partner (battler 2). */
  partner?: FrontierBattleTrainer;
  /**
   * 0.37.0. The trainers' AI flags (decomp trainer[i].header.aiMask, the AI_FLAG_* bits); absent: the tower's
   * AI_FLAG_BASIC | EVAL_ATTACK | EXPERT.
   */
  ai?: number;
  /** 0.39.0. The field condition the battle starts in (decomp battleDTO->fieldWeather: the Arcade's weather and Trick Room). */
  weather?: BattleWeather;
  /**
   * 0.39.0. Sleep turns by party slot (decomp: a Pokémon's sleep status is its turns left; the Arcade's sleep effect
   * gives 2–5), for the player's party and the first trainer's; 0 (or absent) leaves a sleeping Pokémon at the
   * battle's default.
   */
  sleep?: { player: number[]; enemy: number[] };
}

/** Decomp BATTLE_TOWER_MODE_* (generated/battle_tower_modes.txt). */
export const BATTLE_TOWER_MODES = ['single', 'double', 'multi', 'link-multi', 'wifi', 'wifi-earlier', 'wfc-multi'] as const;
export type BattleTowerMode = (typeof BATTLE_TOWER_MODES)[number];

/**
 * 0.34.0. The Battle Frontier's saved data (decomp WifiBattleTowerRecord, WifiBattleTowerSave, BattleFrontierStats'
 * tower stats). Absent until the frontier first writes it.
 */
export interface FrontierState {
  /** Battle Points (decomp WifiBattleTowerRecord battlePoints, at most 9999). */
  bp: number;
  /**
   * The tower's RNG (decomp WifiBattleTowerRecord rngState): the day's random through the second LCG, at a new game and
   * each day change (sub_0206C008); a challenge advances it (sub_0206C02C). Absent: derived from the day's random.
   */
  towerRng?: number;
  /** Decomp WifiBattleTowerRecord flags: the trophies (bits 13, 0, 1) and their "no room" notes (14, 2, 3), bit 8 + mode a streak in progress. */
  towerFlags: number;
  /** Decomp roomNums per mode index (`BATTLE_TOWER_MODES` 0–4, wfc-multi 5): sevens won in the current streak. */
  towerRooms: number[];
  /** Decomp STAT_TOWER_RECORD_STREAK_* and LATEST_STREAK_* per mode index 0–4: the best and the current streak. */
  towerStreaks: { record: number; latest: number }[];
  /**
   * Decomp WifiBattleTowerSave: the challenge saved by REST (or before the first battle), resumed by the receptionist.
   * `inProgress` is its isInProgress bit.
   */
  towerSave: {
    inProgress: boolean;
    mode: number;
    nextOpponent: number;
    slots: number[];
    trainers: number[];
    seed: number;
    partner: number;
    /** Multi: the chosen AI partner's party (decomp BattleTowerPartnerData: its sets, OT id, PIDs, reserved items used). */
    partnerParty?: { otId: number; sets: number[]; pids: number[]; reserved: boolean };
  };
  /** 0.37.0. The Battle Factory's saved part; absent until it is first written. */
  factory?: FactoryState;
  /** 0.37.0. The Battle Hall's saved part; absent until it is first written. */
  hall?: HallState;
  /** 0.39.0. The Battle Castle's saved part; absent until it is first written. */
  castle?: CastleState;
  /** 0.39.0. The Battle Arcade's saved part; absent until it is first written. */
  arcade?: ArcadeState;
}

/**
 * 0.37.0. The Battle Factory's saved part (decomp BattleFactorySave, BattleFactoryStreakFlags and the factory's
 * BattleFrontierStats). `active`, `streaks` index by `factoryIndex(openLevel, challengeType)` (openLevel × 4 + type).
 */
export interface FactoryState {
  /** Decomp FACTORY_SAVE_STREAK_FLAGS: a streak carries into the next challenge. */
  active: boolean[];
  /** Decomp STAT_FACTORY_RECORD_STREAK_*, LATEST_STREAK_*, RECORD_TRADE_COUNT_*, LATEST_TRADE_COUNT_*. */
  streaks: { record: number; latest: number; recordTrades: number; latestTrades: number }[];
  /**
   * Decomp BattleFactorySave: the round in progress (written at each save of the challenge, read when it resumes after
   * REST): the type and level, the battle, the round's 14 trainers, the player's and the opponent's sets, PIDs, IVs.
   */
  save: {
    saved: boolean;
    challengeType: number;
    openLevel: boolean;
    battle: number;
    trainers: number[];
    player: { set: number; pid: number; ivs: number }[];
    opponent: { set: number; pid: number; ivs: number }[];
  };
}

/** 0.37.0. Decomp FRONTIER_CHALLENGE_*: the challenge types a facility's index arrays use. */
export const FRONTIER_CHALLENGE = { single: 0, double: 1, multi: 2, multiWfc: 3 } as const;

/**
 * 0.37.0. The Battle Hall's saved part (decomp BattleHallSave, BattleHallStreakFlags, the hall's BattleFrontierStats
 * and BattleHallWinRecords). Arrays index by challenge type (single, double, multi).
 */
export interface HallState {
  /** Decomp HALL_SAVE_STREAK_FLAGS. */
  active: boolean[];
  /** Decomp STAT_HALL_CURRENT_STREAK_*, LATEST_STREAK_*, LATEST_SPECIES_* (null: none yet). */
  streaks: { current: number; latest: number; species: Id | null }[];
  /** Decomp STAT_HALL_CURRENT_RANKS_*: each board cell's rank 0–10 (cells 0–16 the types, 17 the Matron's). */
  ranks: number[][];
  /** Decomp BattleHallSave: the type, battle, party slots, the round's 20 trainers and 20 opponent entries. */
  save: { saved: boolean; challengeType: number; battle: number; slots: number[]; trainers: number[]; opponents: number[] };
  /** Decomp BattleHallWinRecords: each species' best streak, by challenge type. */
  records: Record<Id, number>[];
}

/** 0.37.0. Opens the Battle Factory's rental app (contracts `AppRequest`). */
export type FactoryRequest =
  | { app: 'factory'; mode: 'rent'; rentals: Pokemon[]; count: number }
  | { app: 'factory'; mode: 'swap'; rentals: Pokemon[]; offers: Pokemon[] };

/** A Pokémon as the Factory app shows it: its front sprite, name and gender. */
export interface FactoryMonView {
  species: Id;
  form: number;
  gender: Gender;
  shiny: boolean;
  name: string;
}

/**
 * 0.37.0. The Battle Factory's rental app (decomp battle_factory/main.c). `balls` are the Poké Balls on the conveyor
 * (`sInitialSelectionPokeballPositions`, `sExchangeSelectPokeballPositions`: their centres, DS px), each with whether it
 * is picked; `mons` the front sprites shown (one under the cursor while picking; the picks on the confirm panel);
 * `names` the name windows (the picks so far and the one under the cursor); `menu` the option or YES/NO window at the
 * bottom right (`sMonOptionsMenuCursorPositions`); `cursor` the ball (or `menu` entry 3+ in swap's CANCEL/BACK rows).
 * `stage`: `pick` the balls, `menu` a ball's options, `confirm` the YES/NO after the last pick or an exchange,
 * `receive` the offers, `message` a closing message. Taps: `ball:<i>`, `entry:<i>`, `back`.
 */
export interface FactoryView {
  app: 'factory';
  mode: 'rent' | 'swap';
  stage: 'pick' | 'menu' | 'confirm' | 'receive' | 'message';
  /** The panel the BG shows (decomp LoadMonSelectionBackground, LoadSelectionConfirmBackground). */
  panel: 'selection' | 'summary';
  balls: { x: number; y: number; picked: boolean }[];
  cursor: { x: number; y: number; menu: boolean };
  mons: (FactoryMonView & { x: number; y: number })[];
  names: string[];
  playerName: string;
  message: string;
  menu: { entries: string[]; cursor: number } | null;
  /** The conveyor's scroll (decomp conveyorXOffset) and the wheel's palette step (0–3). */
  conveyor: number;
  wheel: number;
}

/** 0.37.0. Opens the Battle Hall's type board (contracts `AppRequest`). */
export interface HallBoardRequest {
  app: 'hall-board';
  challengeType: number;
  /** The board's ranks by cell 0–17 (`HallState.ranks`), the streak, the entered Pokémon, the cell to start on. */
  ranks: number[];
  streak: number;
  party: Pokemon[];
  cursor: number;
}

/**
 * 0.37.0. The Battle Hall's type board (decomp battle_hall/main.c): 20 cells in a 4 × 5 grid (COL_WIDTH 64, ROW_HEIGHT
 * 36 px), each a type with its rank (1–10), the Pokémon's summary (cells 17–18) or the Matron's `???` (19). `state` is
 * ChangeCellBackground's: `selected` while a pick is confirmed, `unselectable` for a type at rank 10 and `???` (all but
 * `???` once the Matron comes). `mon` is the entered Pokémon's icon and name; `message`/`yesNo` the confirm box.
 * Taps: `cell:<i>`, `entry:<i>` (YES, NO).
 */
export interface HallBoardView {
  app: 'hall-board';
  cells: { label: string; rank: number | null; state: 'normal' | 'selected' | 'unselectable' }[];
  cursor: number;
  mon: { species: Id; form: number; gender: Gender; shiny: boolean; name: string };
  message: string | null;
  yesNo: { yes: string; no: string; cursor: number } | null;
}

/**
 * 0.39.0. The Battle Castle's saved part (decomp BattleCastleSave, BattleCastlePersistentSave and the castle's
 * BattleFrontierStats). Arrays index by challenge type (single, double, multi).
 */
export interface CastleState {
  /** Decomp CASTLE_SAVE_STREAK_FLAGS. */
  active: boolean[];
  /** Decomp CASTLE_SAVE_HAVE_HEARD_INTRO: Darach's introduction heard (the first challenge's longer welcome). */
  heardIntro: boolean;
  /**
   * Decomp STAT_CASTLE_RECORD_STREAK_*, LATEST_STREAK_*, LATEST_CP_* (the Castle Points), RECORD_CP_* (the CP when the
   * record was set) and SPENT_CP_* (the CP spent this streak).
   */
  streaks: { record: number; latest: number; cp: number; recordCp: number; spentCp: number }[];
  /** Decomp STAT_CASTLE_RANK_*: the healing, rental and opponent-summary ranks (1–3), by challenge type. */
  ranks: number[][];
  /**
   * Decomp BattleCastleSave: the round in progress (written at each save of the challenge, read when it resumes after
   * REST): the type, the battle, the party slots, the round's 14 trainers, the entered Pokémon's HP, PP, status and
   * held items, the opponent's sets.
   */
  save: {
    saved: boolean;
    challengeType: number;
    battle: number;
    slots: number[];
    trainers: number[];
    hp: number[];
    pp: number[][];
    status: StatusCondition[];
    items: (Id | null)[];
    sets: number[];
  };
}

/**
 * 0.39.0. The Battle Arcade's saved part (decomp BattleArcadeSave, BattleArcadeStreakFlags and the arcade's
 * BattleFrontierStats). Arrays index by challenge type.
 */
export interface ArcadeState {
  /** Decomp ARCADE_SAVE_STREAK_FLAGS. */
  active: boolean[];
  /** Decomp STAT_ARCADE_CURRENT_STREAK_* (the best, set if better) and LATEST_STREAK_*. */
  streaks: { record: number; latest: number }[];
  /**
   * Decomp BattleArcadeSave: the type, the battle, the board's speed, whether its cursor jumps, the party slots, the
   * entered Pokémon's held items (the board's gifts), the round's 14 trainers and the opponent's sets.
   */
  save: {
    saved: boolean;
    challengeType: number;
    battle: number;
    speed: number;
    randomCursor: boolean;
    slots: number[];
    items: (Id | null)[];
    trainers: number[];
    sets: number[];
  };
}

/** 0.39.0. What the Castle's opponent app has bought for each opponent slot (decomp BattleCastleAppArgs). */
export interface CastleUnlocks {
  /** Decomp identityUnlocked: the Pokémon shown (CHECK). */
  identity: boolean[];
  /** Decomp levelAdjustments: LEVEL_ADJUSTMENT_NONE, _UP_5, _DOWN_5. */
  level: ('none' | 'up' | 'down')[];
  /** Decomp statsUnlocked, movesUnlocked. */
  stats: boolean[];
  moves: boolean[];
}

/**
 * 0.39.0. Opens one of the Battle Castle's apps (decomp battle_castle/self_app.c, opponent_app.c): `self` heals and
 * rents items for the player's Pokémon, `opponent` scouts and levels the next opponent's. The Castle Points and ranks
 * are spent in the save as the app goes (decomp BattleCastle_SpendCastlePoints); the parties and the unlocks come back
 * in the result (`castle`).
 */
export interface CastleRequest {
  app: 'castle';
  mode: 'self' | 'opponent';
  challengeType: number;
  /** The player's challenge party and the next opponent's (copies). */
  party: Pokemon[];
  opponents: Pokemon[];
  unlocked: CastleUnlocks;
}

/** 0.39.0. A Pokémon on the Castle's apps: icon, level, gender, HP, a held item; `hidden` an opponent not yet checked (a Poké Ball). */
export interface CastleMonView {
  species: Id;
  form: number;
  gender: Gender;
  shiny: boolean;
  level: number;
  hp: number;
  maxHp: number;
  item: boolean;
  hidden: boolean;
}

/**
 * 0.39.0. The Battle Castle's apps (decomp battle_castle/self_app.c, opponent_app.c, windows.c). `panel` is the BG2
 * over the layout (`items` the rental list, `summary`, `moves`); `cp` the header's Castle Points line; `cursor` a slot
 * or `mons.length` (EXIT); `menu` the open list in its window (decomp MON_OPTIONS_MENU, HEAL_MENU, RENTAL_MENU,
 * SUMMARY_MENU, LEVEL_MENU); `hint` the small box beside the options menu or the selection prompt; `message` the
 * message box; `items` the rental list (rows from `top`, `mon` the slot renting, `cpLine` the player's CP); `lines`
 * the summary or moves panel's text at DS px inside its window (tile 5, 10). Taps: `mon:<i>`, `exit`, `entry:<i>`,
 * `answer:<i>` (YES, NO), `item:<i>` (a list row), `next` (a message), `page:<-1|1>` (the panels' left and right).
 */
export interface CastleView {
  app: 'castle';
  mode: 'self' | 'opponent';
  panel: 'main' | 'items' | 'summary' | 'moves';
  playerName: string;
  cp: string;
  mons: CastleMonView[];
  cursor: number;
  exit: string;
  menu: { window: 'options' | 'heal' | 'rental' | 'summary' | 'level'; entries: { label: string; enabled: boolean }[]; cursor: number } | null;
  hint: string | null;
  message: string | null;
  yesNo: { yes: string; no: string; cursor: number } | null;
  items: { entries: { name: string; cp: string }[]; cursor: number; top: number; item: Id | null; mon: number; cpLine: string } | null;
  lines: { text: string; x: number; y: number; align: 'left' | 'right' | 'centre' }[] | null;
  /** A purchase's sparkles (sprites.h ANIM_ID_HEAL_SPARKLES, _RENTAL_SPARKLES) at screen px, `tick` into the animation. */
  sparkle?: { anim: number; x: number; y: number; tick: number };
}

/**
 * 0.39.0. Opens the Battle Arcade's game board (decomp battle_arcade/main.c): its effects are drawn for the round, the
 * battle and the last battle's performance; the cursor runs at `speed` (or jumps when `randomCursor`) until STOP or
 * 30 seconds. Result `arcade`.
 */
export interface ArcadeRequest {
  app: 'arcade';
  challengeType: number;
  round: number;
  streak: number;
  performance: number;
  speed: number;
  randomCursor: boolean;
  /** The player's and the opponent's Pokémon (their icons and held items). */
  party: Pokemon[];
  opponents: Pokemon[];
}

/**
 * 0.39.0. The Battle Arcade's board (decomp battle_arcade/main.c): `board` the BG3 tilemap (`initial`, then
 * `roulette`); `tiles` the 16 panels' sprite animations (32–34 turning over, then their effects 0–31; the result's on
 * every panel); `cursor` the panel under the cursor (null hidden); `button` the touch screen's STOP (0 up, 1 pressed,
 * 2 inactive); the two columns of icons with their held items. Tap: `stop` (A stops it too).
 */
export interface ArcadeView {
  app: 'arcade';
  board: 'initial' | 'roulette';
  tiles: { anim: number; visible: boolean }[];
  cursor: number | null;
  button: 0 | 1 | 2;
  player: { species: Id; form: number; item: boolean }[];
  opponents: { species: Id; form: number; item: boolean }[];
}
