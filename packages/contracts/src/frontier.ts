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
import type { Id, Pokemon } from '@opensinnoh/core';
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
  facility: 'tower';
  party: Pokemon[];
  /** The enemy trainers (battlers 1 and, in multi, 3). */
  trainers: FrontierBattleTrainer[];
  /** Multi with an AI partner: the partner (battler 2). */
  partner?: FrontierBattleTrainer;
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
}
