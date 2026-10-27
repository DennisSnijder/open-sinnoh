/**
 * Menu apps (contracts 0.11.0, extended in 0.12.0 and 0.15.0): headless models (packages/menus) that the game hosts
 * next to the VM. The start menu and script ops open them; the app draws their `AppView` and nothing
 * else, so a replay runs the same headless and in the browser.
 */
import type { Bag, ClockTime, Gender, Id, Pokemon } from '@opensinnoh/core';
import type { AudioHost } from './audio.ts';
import type { AssetRef } from './records.ts';
import type { StubLog } from './runtime.ts';
import type { Registries } from './runtime.ts';
import type { GameState } from './state.ts';
import type { InputFrame } from './ui.ts';

/**
 * The DS options (decomp `Options`, game_options.h order). Text speed is a device option (the app
 * stores it); the others are game state since 0.12.0 (`GameState.options`, saved like the DS's).
 * The game applies text speed; the others are stored until their system exists.
 */
export interface DeviceOptions {
  /** 0 slow, 1 mid, 2 fast (decomp OPTIONS_TEXT_SPEED_*). */
  textSpeed: number;
  sound: number;
  battleScene: number;
  battleStyle: number;
  buttonMode: number;
  /** Message box frame type, 0–19. */
  frame: number;
  /**
   * 0.21.1. A modern option, not the DS's (docs/decisions.md: trade-only evolutions in single player): 0 on (the
   * default), 1 off. On, a level-up also evolves Pokémon that evolve by trading (holding the item where the
   * trade needs one). A device option like text speed.
   */
  tradeEvolution: number;
  /**
   * 0.27.12. A modern option (docs/decisions.md, "Following Pokémon"): 0 on (the default), 1 off. On, the
   * lead party Pokémon follows the player where it has a follower set. A device option like text speed.
   */
  followers: number;
  /** 0.27.21. Idle follower style: 0 Still (default), 1 Walk in place. Device only. */
  followerStyle: number;
  /**
   * 0.29.3. An OpenSinnoh addition, not Platinum's: 0 on, 1 off. On, the naming keyboard switches from the
   * capitals page to the lowercase page after the first character of an empty name. The contract default is
   * off (the DS behaviour, what replays and tests run); the app's stored default is on. Device only.
   */
  autoLowercase: number;
  /**
   * 0.32.1, the quality-of-life options (docs/decisions.md). Each is an OpenSinnoh addition; its contract default is the DS
   * behaviour (what replays and tests run) and the app stores the player's default. Device only. 0 on, 1 off:
   * - `autoRun`: with the Running Shoes the player runs without holding B; B held walks.
   * - `repelPrompt`: when a Repel wears off and the Bag holds another of its kind, a YES/NO offers to use it.
   * - `itemWheel`: holding Y opens the registered-item wheel (up to `ITEM_WHEEL_SIZE` items); a short press of Y
   *   uses the registered item as on the DS. The Bag's REGISTER then adds to the wheel.
   * - `followerTalk`: A on the following Pokémon shows its reaction (with the HGSS add-on's talk data; without it,
   *   nothing happens, as before).
   * - `statView`: A on the summary's SKILLS page shows the stats, then the EVs, then the IVs.
   * - `summaryRename`: the summary's INFO page offers RENAME for the player's own Pokémon.
   * - `dexNameSearch`: the Pokédex search's NAME row can take a typed name.
   */
  autoRun: number;
  repelPrompt: number;
  itemWheel: number;
  followerTalk: number;
  statView: number;
  summaryRename: number;
  dexNameSearch: number;
  /** 0.32.1. The player's look in the field: 0 Platinum's, 1 the HGSS add-on's (Ethan or Lyra by gender). Device only. */
  character: number;
  /**
   * 0.33.0. An OpenSinnoh addition, NOT DS: 0 on, 1 off (players too: opt-in). On, a vendor's first
   * talk on each Underground visit counts toward Route 209's Spiritomb (VAR_SPIRITOMB_COUNTER), standing in for the
   * 32 players met over DS Wireless, which a solo game cannot meet. Device only.
   */
  spiritombVendors: number;
  /**
   * 0.44.0. An OpenSinnoh addition, not Platinum's: 0 on, 1 off. On, the start menu shows the current objective
   * (`NewGame.objectives`). The contract default is off (the DS behaviour); the app's stored default is on. Device only.
   */
  objective: number;
}

/**
 * Decomp Options_Init defaults (mid text speed, stereo, scene on, shift, normal buttons, frame 1); the modern options
 * at the DS behaviour (trade evolutions and followers on: docs/decisions.md).
 */
export const DEFAULT_DEVICE_OPTIONS: Readonly<DeviceOptions> = {
  textSpeed: 1, sound: 0, battleScene: 0, battleStyle: 0, buttonMode: 0, frame: 0, tradeEvolution: 0, followers: 0, followerStyle: 0, autoLowercase: 1,
  autoRun: 1, repelPrompt: 1, itemWheel: 1, followerTalk: 1, statView: 1, summaryRename: 1, dexNameSearch: 1, character: 0, spiritombVendors: 1, objective: 1,
};
/** Number of values per option. */
export const DEVICE_OPTION_COUNTS: Readonly<Record<keyof DeviceOptions, number>> = {
  textSpeed: 3, sound: 2, battleScene: 2, battleStyle: 2, buttonMode: 3, frame: 20, tradeEvolution: 2, followers: 2, followerStyle: 2, autoLowercase: 2,
  autoRun: 2, repelPrompt: 2, itemWheel: 2, followerTalk: 2, statView: 2, summaryRename: 2, dexNameSearch: 2, character: 2, spiritombVendors: 2, objective: 2,
};
/** 0.32.1. The DS options kept in the save (`GameState.options`); every other option is the device's. */
export const SAVED_OPTIONS = ['sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame'] as const satisfies readonly (keyof DeviceOptions)[];
export type SavedOptionKey = (typeof SAVED_OPTIONS)[number];
export const isSavedOption = (key: keyof DeviceOptions): key is SavedOptionKey => (SAVED_OPTIONS as readonly string[]).includes(key);
/**
 * 0.32.1. The HGSS add-on's player sprites (`DeviceOptions.character` 1): Ethan's and Lyra's on foot (walk, run) and on the
 * bicycle (walk, its poses). Any other look, or none of these in the packs, stays Platinum's (`NewGame.player*Sprite`).
 */
export const HGSS_PLAYER_SPRITES = {
  walk: { male: 'hgss-followers:SPRITE_PLAYER_ETHAN', female: 'hgss-followers:SPRITE_PLAYER_LYRA' },
  cycle: { male: 'hgss-followers:SPRITE_PLAYER_ETHAN_BIKE', female: 'hgss-followers:SPRITE_PLAYER_LYRA_BIKE' },
} as const;
/** 0.32.1. The registered-item wheel's slots (`GameState.registeredWheel`). */
export const ITEM_WHEEL_SIZE = 4;

/**
 * A menu app the game opens: the start menu (X or Start on an idle field, or after a script's
 * `show_start_menu`), or a script op (or the battle) that waits for the result (`ScriptView.app`,
 * `ScriptRunner.appDone`). Later contract versions add teach move, tutor, relearner, daycare select.
 */
export type AppRequest =
  | { app: 'start-menu' }
  /**
   * Decomp Shop_Start, MART_TYPE_NORMAL: `mart` is a `marts` record; its items show when the player has
   * `minBadges` badges. `countVar` (decomp incBuyCount, the Veilstone Department Store) is incremented
   * per purchase up to 10000 (SystemVars_IncrementDepartmentStoreBuyCount); null elsewhere. `greeting`
   * is the message the script left in the box (`close_message_without_erasing`), plain text, or null.
   */
  | { app: 'mart'; mart: Id; countVar: Id | null; greeting: string | null; currency?: 'bp' }
  /**
   * Decomp ScrCmd_PokeMartSeal → Shop_Start(MART_TYPE_SEAL): the seal mart with `NewGame.seals.marts[seals]` (a
   * MART_SEAL_ID: the Sunyshore merchant's day). BUY / CANCEL only; seals go to the Seal Case.
   */
  | { app: 'mart'; seals: number; greeting: string | null }
  /**
   * 0.34.0. Decomp PARTY_MENU_MODE_BATTLE_TOWER (sub_0204A358 → sub_0206BBFC): the party picking `count` Pokémon in order
   * for the Battle Tower, then CONFIRM. Eggs and the Battle Frontier banlist (`FrontierTables.banlist`) are NOT ABLE; the
   * result is the party slots in the order picked, or null (CANCEL or B). 0.39.0: `castle`, the Castle's and the Arcade's
   * (PARTY_MENU_MODE_BATTLE_CASTLE: no level limit, held items may repeat, no species twice).
   */
  | { app: 'party-order'; count: number; hall?: true; castle?: true }
  /**
   * 0.37.0. The Battle Factory's rental app (decomp battle_factory/main.c, BattleFactoryApp_*): `rent` picks the
   * player's `count` Pokémon in order from `rentals` (the six rentals); `swap` offers to trade one of `rentals` (the
   * player's) for one of `offers` (the beaten trainer's). Result `factory`.
   */
  | import('./frontier.ts').FactoryRequest
  /**
   * 0.37.0. The Battle Hall's type board (decomp battle_hall/main.c, BattleHallApp_*): the next battle's type. Result
   * `hall-board`.
   */
  | import('./frontier.ts').HallBoardRequest
  /** 0.39.0. The Battle Castle's apps (decomp battle_castle/self_app.c, opponent_app.c). Result `castle`. */
  | import('./frontier.ts').CastleRequest
  /** 0.39.0. The Battle Arcade's game board (decomp battle_arcade/main.c). Result `arcade`. */
  | import('./frontier.ts').ArcadeRequest
  /** 0.45.0. The Frontier's record viewer (decomp ScrCmd_OpenFrontierRecordsApp → frontier/records/main.c). Result `frontier-records`. */
  | import('./frontier.ts').FrontierRecordsRequest
  /**
   * 0.12.0. The battle bag (decomp battle_bag.c, BattleBag_Init): the bag's items grouped by their
   * `battlePocket` bits into HP/PP, status, Poké Balls and battle items. A medicine asks for a party
   * Pokémon (the battle party, "Use on which Pokémon?") and is refused when it would do nothing; a battle
   * item applies to the active Pokémon. `party` and `bag` are the battle's own (they change during the
   * battle); `active` is the party slot in battle; `noRoomForBall`: the party and the PC are full (a ball is
   * refused); `noEffect`: the battle items that would do nothing on the active Pokémon now (refused).
   * 0.27.1: `twoWild`, two wild Pokémon stand (a wild double with an AI partner, type 74): a ball is refused
   * (decomp BattleBag_Text_CantUseBallTwoPokemon).
   */
  | { app: 'bag-select'; mode: 'battle'; party: Pokemon[]; active: number; bag: Bag; noRoomForBall: boolean; noEffect: Id[]; twoWild?: boolean }
  /**
   * 0.12.0. The battle party (decomp battle_party.c): pick a Pokémon to send in. Refused: the one in battle,
   * a fainted one, an Egg. `forced` (after a faint): no cancel.
   * 0.27.6, doubles the player commands alone (types 3 and 19): `inBattle`, the other battler's party slot (refused
   * as in battle; decomp partnerPokemonPartySlot), and `selected`, the slot the first command already picked to come
   * in (refused, decomp BattleParty_Text_CantSwitchWithAlreadySelectedPokemon). For a forced replacement `active` is
   * the fainted battler's slot.
   */
  | { app: 'party-select'; mode: 'battle'; party: Pokemon[]; active: number; forced: boolean; inBattle?: number; selected?: number }
  /**
   * 0.20.0. A script picks a party Pokémon (decomp FieldSystem_OpenPartyMenu_SelectPokemon,
   * PARTY_MENU_MODE_SELECT_NO_PROMPT: `select_move_tutor_pokemon`, read back by `get_selected_party_slot`):
   * A on a panel returns it at once (an Egg too), CANCEL or B returns null.
   */
  | { app: 'party'; mode: 'select' }
  /**
   * Decomp ScrCmd_OpenPartyMenuForTrade (PARTY_MENU_MODE_NPC_TRADE): picks like `select`, but a Pokémon with a Ball
   * Capsule asks "The Ball Capsule will be detached. Will that be OK?" first (YES detaches it and picks, NO goes back).
   */
  | { app: 'party'; mode: 'trade' }
  /** Decomp ScrCmd_OpenPokemonStorage (enum BoxMode): the PC boxes in one mode (0.15.0; `compare` 0.20.0). */
  | { app: 'storage'; mode: StorageMode }
  /**
   * 0.23.0. The Pokédex entry the battle shows after "X's data was added to the Pokédex." (decomp
   * SEQ_CATCH_MON_SET_POKEDEX_DATA, ov21_021E8D48): the caught species' info page, as caught; A closes it.
   */
  | { app: 'pokedex-entry'; species: Id; form: number }
  | NamingRequest
  /**
   * 0.19.0. The party in daycare mode (decomp PARTY_MENU_MODE_DAYCARE, `open_party_menu_for_daycare`):
   * a Pokémon's window is STORE, SUMMARY, CANCEL (an egg: SUMMARY, CANCEL); STORE returns its slot,
   * B or CANCEL returns null. SUMMARY opens the summary in the app (the DS returns to the script, which
   * reopens the party).
   */
  | { app: 'daycare-select' }
  /**
   * 0.19.0. The egg hatching scene (decomp egg_hatch.c, `hatch_egg`): the party Pokémon at `slot` has just
   * hatched (the op hatched it); the scene, its cry, the message and the nickname question, then the
   * naming screen on YES. The result is the entered nickname, or null.
   */
  | { app: 'hatch'; slot: number }
  /**
   * 0.20.0. Decomp ScrCmd_StartSignatureApp (the Pokémon Center 2F): the trainer card's signing mode on its
   * back, without cancel; it closes when the signature is saved.
   */
  | { app: 'signature' }
  /**
   * 0.27.25. The Canalave Library TV (decomp library_tv.c, ScrCmd_StartLibraryTV → FieldSystem_StartLibraryTV): the
   * news picture of Lake Valor through the TV frame and its scrolling scan lines, faded in and out; no input.
   */
  | { app: 'library-tv' }
  /**
   * 0.37.0. The journal (decomp journal_display, ITEM_USE_FUNC_JOURNAL and the auto-open on CONTINUE): today's page
   * first, Left/B to newer pages, A/Right to older ones, B on page 0 or START closes.
   */
  | { app: 'journal' }
  /** 0.37.0. A diploma (decomp ScrCmd_ShowDiplomaSinnoh / ShowDiplomaNationalDex → applications/diploma.c). */
  | { app: 'diploma'; national: boolean }
  /** 0.37.0. The Town Map to look at (decomp ScrCmd_OpenRegionMap → TOWN_MAP_MODE_WALL_MAP): no flying; B closes. */
  | { app: 'town-map' }
  /**
   * 0.27.19. The Hall of Fame (docs/research/hall-of-fame-credits.md §3): `record` is the Champion's induction
   * (decomp HallOfFameManager, opened by `clear_game` over the live party), `pc` the PC's viewer of the saved
   * entries (decomp PCHallOfFameManager, `open_pc_hall_of_fame_screen`; read only).
   */
  | { app: 'hall-of-fame'; mode: 'record' | 'pc' }
  /**
   * 0.27.19. The end credits (decomp end_credits/main.c), opened by the game's clear task after the save:
   * `skippable` is the game's prior completion (decomp gameCompleted, captured before `clear_game` set it).
   */
  | { app: 'credits'; skippable: boolean }
  /**
   * 0.28.1. Decomp ScrCmd_OpenSummaryScreenTeachMove (FieldSystem_OpenSummaryScreenTeachMove): the summary of party
   * slot `slot` in SUMMARY_MODE_SELECT_MOVE with `move` as the fifth row (Rotom's appliance move, the move
   * tutors). The result is the move slot picked to forget, or null for the new move or B (the script reads
   * LEARNED_MOVES_MAX, `get_summary_selected_move_slot`).
   */
  | { app: 'summary-teach'; slot: number; move: Id | null }
  /**
   * 0.32.1. The registered-item wheel (OpenSinnoh option `itemWheel`; not a DS screen): Y held on the idle field opens
   * it over the field with `GameState.registeredWheel`. The d-pad or a tap picks an item; letting go of Y (or A) with
   * one picked uses it, B closes. The result is the item, used as Y uses the registered item, or null.
   */
  | { app: 'item-wheel' }
  /**
   * 0.29.0. Decomp ScrCmd_OpenBag (FieldSystem_CreateBagContext): the bag on one pocket (`items` for OpenItemsBag,
   * the mulch; `berries` for OpenBerriesBag) picking an item: A on an item picks it, B or CLOSE BAG picks none. The
   * result is the item or null; `get_selected_item` reads it.
   */
  | { app: 'bag-pick'; pocket: string }
  /**
   * 0.29.0. Decomp FieldSystem_OpenMoveReminderMenu (applications/move_reminder.c): party slot `slot` learns one of
   * `moves`, forgetting one through the summary when it knows four. `tutor`: OpenMoveTutorMenu's one move (decomp
   * isMoveTutor FALSE), else the relearner's list (MoveReminderData_GetMoves). The result: whether it learned one.
   */
  | { app: 'move-reminder'; slot: number; moves: Id[]; tutor: boolean }
  /**
   * 0.29.0. Decomp the trade sequence (cutscenes/trade_sequence, TRADE_TYPE_NORMAL, NPCTrade_FillAnimationTemplate):
   * `sent` leaves for `otName`, `received` arrives, over the `background` of the time of day (TRADE_BACKGROUND_DAY
   * for morning and day, _EVENING for twilight, else _NIGHT). The op has made the trade already; the scene shows it.
   */
  | { app: 'trade'; sent: Pokemon; received: Pokemon; otName: string; background: 'day' | 'evening' | 'night' }
  /**
   * 0.30.0. Decomp ScrCmd_ChooseCustomMessageWord / ScrCmd_ChooseTwoCustomMessageWords (the Easy Chat word picker,
   * sub_0203D80C): `words` blanks to fill. The result is the words (decomp EasyChatWord ids: the word's index across
   * the word banks in EasyChatWord_FromBankAndEntry order), or null when the player quit.
   */
  | { app: 'easy-chat'; words: 1 | 2 }
  /**
   * 0.30.0. Mystery Gift (decomp main_menu/mystery_gift_app.c and wonder_cards_app.c), from the title's main menu: a
   * gift is received by gift code (our addition: no wireless or Wi-Fi) into the save's `mysteryGift`, its Wonder Card
   * kept, its gift held by the Poké Mart deliveryman. Edits the state it is given; the title then writes the save.
   */
  | { app: 'mystery-gift' }
  /**
   * 0.31.0. Decomp ScrCmd_OpenPoffinCooking with FALSE (PoffinBerrySelection, one player): the bag's berries (BAG_MODE_POFFIN_SINGLEPLAYER,
   * with the Poffin count), then the cooking (overlay083), its results and "keep cooking?", until the player stops or
   * runs out of berries or room. Cooking in a group (TRUE) needs a link: not supported.
   */
  | { app: 'poffin-cooking' }
  /** 0.31.0. The Poffin Case from the field (decomp UsePoffinCaseInField, the registered item on Y); the bag's OPEN opens the same screens. */
  | { app: 'poffin-case' }
  /**
   * 0.33.0. The Underground's mining game for the mining spot at `spot` in `UndergroundState.spots` (decomp
   * Mining_ProcessMiningSpotInteract): the wall bulging prompt, then on YES the spot goes and the board runs.
   */
  | { app: 'mining'; spot: number }
  /** 0.33.0. The Underground's menu (decomp UndergroundMenu_Start, X on the Underground's field). */
  | { app: 'ug-menu' }
  /** 0.33.0. Vendor `vendor`'s shop (decomp UndergroundVendors_StartShopMenuTask; `UndergroundTables.vendors` index). */
  | { app: 'ug-vendor'; vendor: number }
  /** 0.37.0. A trap gone off under the player (`tool`: a tool on display in the base set it off): contracts `UndergroundTrapView`. */
  | { app: 'ug-trap'; trap: number; tool: boolean }
  /** 0.37.0. A secret base prompt (contracts `UndergroundBasePrompt`). */
  | { app: 'ug-base'; prompt: import('./underground.ts').UndergroundBasePrompt }
  /** 0.37.0. The secret base's PC (UndergroundPC_TryUsePC on the player's own PC). */
  | { app: 'ug-pc' }
  /**
   * 0.35.0. Decomp ScrCmd_OpenPartyMenuForContest (PARTY_MENU_MODE_CONTEST): each panel says whether the Pokémon may
   * enter a `type` contest of `rank` (CheckContestEligibility: not an Egg, not fainted, at least `rank` ribbons of the
   * type, two moves); its window is ENTER (when eligible), SUMMARY, CANCEL. ENTER returns its slot, B or CANCEL null.
   */
  | { app: 'contest-select'; rank: number; type: number }
  /** 0.35.0. Decomp ScrCmd_RunContestApplication: the running contest's rounds and results (`GameState.contest`). */
  | { app: 'contest' }
  /** 0.35.1. Decomp ScrCmd_0A8 (the lobby's frames): the contest photo of type `slot` (`GameState.contestPhotos`). */
  | { app: 'contest-photo'; slot: number }
  /**
   * 0.42.0. Decomp ScrCmd_0A6 (the Jubilife TV gallery): party slot `slot`'s Pokémon in the gallery's dress-up
   * (`GalleryDressUpView`); `first` (FLAG_ENTERED_DRESSING_ROOM was unset) shows bank 385 message 47 first. A save writes
   * `GameState.dressUpPhotos[0]` (without a title) and the trainer score.
   */
  | { app: 'gallery-dress-up'; slot: number; first: boolean }
  /** 0.42.0. Decomp ScrCmd_ShowDressUpPhoto: the gallery photo in `GameState.dressUpPhotos[slot]` (`GalleryPhotoView`). */
  | { app: 'gallery-photo'; slot: number }
  /** Decomp ScrCmd_OpenSealCapsuleEditor (the PC's BALL CAPSULES): the Ball Capsule editor (contracts `CapsuleEditorView`). */
  | { app: 'capsule-editor' }
  /** 0.37.0. Decomp ScrCmd_267: the Game Corner's slot machine (`SlotsRequest`). */
  | import('./slots.ts').SlotsRequest
  | EvolutionRequest;

/**
 * 0.21.1. The evolution scene (decomp evolution.c, Evolution_Begin) for party slot `slot`. `method` is the
 * matched evolution method (decomp EVO_* without the prefix; `USE_ITEM` for items): it decides the Shedinja
 * copy (`LEVEL_NINJASK`) and the held item used up (`TRADE_WITH_HELD_ITEM`, `LEVEL_WITH_HELD_ITEM_*`).
 * `source` is the caller and sets the decomp flags: `battle` (after a battle: B cancels, "What?" first),
 * `level` (a Rare Candy: B cancels), `item` (an evolution stone) and `trade` (no cancel). The game opens it
 * after a battle; the bag pushes it after a Rare Candy or a stone.
 */
export interface EvolutionRequest {
  app: 'evolution';
  slot: number;
  target: Id;
  method: string;
  source: 'battle' | 'level' | 'item' | 'trade';
}

/** Decomp enum BoxMode (PC_MODE_DEPOSIT …, PC_MODE_COMPARE = 4 since 0.20.0), in script order. */
export type StorageMode = 'deposit' | 'withdraw' | 'move' | 'items' | 'compare';
export const STORAGE_MODES: readonly StorageMode[] = ['deposit', 'withdraw', 'move', 'items', 'compare'];

/**
 * The naming screen (0.15.0; decomp naming_screen.c, NamingScreenArgs). `initial` is the current name;
 * the result is the entered name, or null when it was left unchanged or empty (decomp: an all-space
 * entry keeps the old name). `pokemon`: the icon and gender shown for a nickname.
 */
export interface NamingRequest {
  app: 'naming';
  /**
   * 0.28.1 `tablet`: Route 224's tablet (decomp NAMING_SCREEN_TYPE_SHAYMIN_TABLET, `open_shaymin_tablet_naming_screen`).
   * 0.30.0 `gift-code`: Mystery Gift's gift code (our addition, on the friend code's prompt).
   * 0.32.1 `dex-search`: the Pokédex search's typed name (`DeviceOptions.dexNameSearch`; our addition).
   */
  kind: 'player' | 'rival' | 'pokemon' | 'box' | 'tablet' | 'gift-code' | 'dex-search';
  initial: string;
  maxLength: number;
  /** The player's gender (the player icon). */
  gender: 'male' | 'female';
  pokemon: { species: Id; form: number; gender: Gender } | null;
}

/** What an app returns to whoever opened it (a script op writes it to its vars; the battle plays the pick). */
export type AppResult =
  /** 0.29.1: `retire`, RETIRE was picked (decomp StartMenu_SelectRetire: the menu closes and SAFARI_GAME 21 starts). */
  | { app: 'start-menu'; retire?: true }
  /**
   * 0.37.0: `bought` and `sold`, the shop's purchase and sale counts for the journal (decomp itemPurchaseCount,
   * itemSoldCount: +1 per single item, 2 once a purchase or sale is of more than one; the sales of the last SELL visit).
   */
  | { app: 'mart'; bought?: number; sold?: number }
  /** 0.23.0: `move`, the move slot a one-move PP item (Ether, Leppa Berry) restores. */
  | { app: 'bag-select'; item: Id | null; target: number | null; move?: number }
  | { app: 'party-select'; slot: number | null }
  | { app: 'party'; slot: number | null }
  /** 0.34.0. The slots in the order entered, or null. */
  | { app: 'party-order'; order: number[] | null }
  /**
   * 0.37.0. `rent`: the rentals' indices in the order picked. `swap`: the player's slot and the offer taken, or null
   * (no trade; decomp selectedAppSlots[0] 0xFF).
   */
  | { app: 'factory'; picks: number[] }
  | { app: 'factory'; swap: [number, number] | null }
  /** 0.37.0. The board cell picked (decomp selectedCell: 0–16 a type, 19 the Matron's). */
  | { app: 'hall-board'; cell: number }
  /** 0.39.0. The parties as the app left them, what it unlocked, and the slot it closed on (decomp selectedMonSlot). */
  | { app: 'castle'; party: Pokemon[]; opponents: Pokemon[]; unlocked: import('./frontier.ts').CastleUnlocks; slot: number }
  /** 0.39.0. The board's effect (ARCADE_EFFECT_*), its cursor and the random number the app drew (decomp randomIndex). */
  | { app: 'arcade'; effect: number; cursor: number; random: number }
  /** 0.45.0. */
  | { app: 'frontier-records' }
  | { app: 'storage' }
  | { app: 'pokedex-entry' }
  | { app: 'naming'; name: string | null }
  /** 0.21.1. Whether the Pokémon evolved (false: cancelled with B). */
  | { app: 'evolution'; evolved: boolean }
  | { app: 'daycare-select'; slot: number | null }
  | { app: 'hatch'; nickname: string | null }
  | { app: 'signature' }
  | { app: 'library-tv' }
  | { app: 'journal' }
  | { app: 'diploma' }
  | { app: 'town-map' }
  | { app: 'hall-of-fame' }
  | { app: 'credits' }
  /** 0.28.1. The move slot to forget, or null (the new move, or B). 0.29.0: with no new move, the move slot picked. */
  | { app: 'summary-teach'; forget: number | null }
  /** 0.29.0. The item picked, or null. */
  | { app: 'bag-pick'; item: Id | null }
  /** 0.32.1. The wheel's item to use, or null. */
  | { app: 'item-wheel'; item: Id | null }
  /** 0.29.0. Whether a move was learned (decomp MoveReminderData keepOldMove FALSE). */
  | { app: 'move-reminder'; learned: boolean }
  /** 0.29.0. The scene ended. */
  | { app: 'trade' }
  /** 0.30.0. The chosen words (EasyChatWord ids), or null (quit). */
  | { app: 'easy-chat'; words: number[] | null }
  /** 0.30.0. Mystery Gift closed (EXIT, or after a gift was received: the DS returns to the title). */
  | { app: 'mystery-gift'; received: boolean }
  /** 0.31.0. The cooking ended (the Poffins made are in the case). */
  | { app: 'poffin-cooking' }
  /** 0.31.0. The Poffin Case closed. */
  | { app: 'poffin-case' }
  /** 0.33.0. The mining game ended (`dug`: YES was picked and the board played). */
  | { app: 'mining'; dug: boolean }
  /**
   * 0.33.0. The Underground's menu closed; `goUp`: GO UP was confirmed (the return to the surface starts). 0.37.0: `drill`:
   * the trap slot of the Digger Drill picked (SecretBases_UseDiggerDrill: the field tries the wall in front).
   */
  | { app: 'ug-menu'; goUp: boolean; drill?: number }
  | { app: 'ug-vendor' }
  /**
   * 0.37.0. The trap's screen closed: `escaped` (its escape game was won, or the alert ended), else the field part of the
   * trap begins (the slide, the hole, the altered steps).
   */
  | { app: 'ug-trap'; trap: number; escaped: boolean }
  /** 0.37.0. The prompt's answer: `yes`/`no` (drill, exit), `open`/`close`/`no` (enter). */
  | { app: 'ug-base'; prompt: import('./underground.ts').UndergroundBasePrompt; answer: 'yes' | 'no' | 'open' | 'close' }
  /** 0.37.0. The PC was switched off (EXIT or B); `decorated`: the decoration ran (FLAG_DECORATED_SECRET_BASE). */
  | { app: 'ug-pc'; decorated: boolean }
  /** 0.35.0. The slot entered, or null. */
  | { app: 'contest-select'; slot: number | null }
  /** 0.35.0. The contest app ended (its scores and placements are in `GameState.contest`). */
  | { app: 'contest' }
  /** 0.35.1. The photo viewer closed. */
  | { app: 'contest-photo' }
  /** 0.42.0. The gallery's dress-up closed; `saved`: the photo was saved (the script's var is 1). */
  | { app: 'gallery-dress-up'; saved: boolean }
  /** 0.42.0. The gallery's photo viewer closed. */
  | { app: 'gallery-photo' }
  | { app: 'capsule-editor' }
  /** 0.37.0. The slot machine closed (`SlotsResult`). */
  | import('./slots.ts').SlotsResult
  /** 0.27.30. Rowan's intro (packages/menus `createRowanIntro`): the names and gender the new game starts with. */
  | { app: 'rowan-intro'; names: { player: string; rival: string }; gender: 'male' | 'female' };

/** The game's services an app uses besides the state: device options, the save and field moves. */
export interface AppHost {
  /** Text speed from the device, the others from `GameState.options`. */
  options(): DeviceOptions;
  /** Stores an option; text speed applies to the game at once. */
  setOption(key: keyof DeviceOptions, value: number): void;
  /** Writes the game save (start menu SAVE). Throws a player-facing Error when it cannot. */
  save(): void;
  /**
   * The game's sound system (0.18.0): menu sounds and cries (the Pokédex: `playCry(species, form,
   * 'pokedex')`). Absent in hosts without sound (menu tests).
   */
  sound?: AudioHost;
  /**
   * Whether a party Pokémon's field move can be used now (0.15.0; decomp FieldMoves_Check*): null, or why
   * not (`unsupported`: a field move the game does not run yet, logged by the game).
   */
  fieldMoveCheck(slot: number, move: Id): 'location' | 'badge' | 'partner' | 'state' | 'unsupported' | null;
  /**
   * Uses a field move as the party menu does (0.15.0): the app closes and the move's `FIELD_MOVES`
   * script starts on the next tick (decomp: the party menu returns to the field, then the script runs).
   * 0.29.0: Fly passes the Town Map's chosen `TownMap.locations` index and its flight starts instead; Teleport warps.
   */
  useFieldMove(slot: number, move: Id, location?: number): void;
  /**
   * The bag's USE check of a field item (0.27.5; decomp ItemActionFunc_Use: the item's canUseItemFunc,
   * CanUseBicycle and the like): null, or why not, printed in the bag by BagContext_FormatErrorMessage
   * (`dismount` Bag_Text_CannotDismount, `partner` Bag_Text_CannotUseWithPartner, `fish`
   * Bag_Text_CannotUseNoFishing, `generic` CommonStrings_Text_CantDoThatRightNow). The registered item on Y
   * runs the same check.
   */
  fieldItemCheck(item: Id): 'dismount' | 'partner' | 'fish' | 'generic' | null;
  /**
   * Uses a field item from the bag (0.27.5; decomp useItemFromMenuFunc after FieldSystem_StartFieldMap):
   * the app closes and the item's use runs on the field (the Bicycle mounts or dismounts), as Y does.
   */
  useFieldItem(item: Id): void;
  /** The game clock (0.17.0; replaces the unused `date()`). */
  clock(): ClockTime;
  /**
   * 0.45.0. The start menu's Pokédex, party, bag, trainer card or options closed back to it: on the DS that app replaced
   * the field map, which starts again (StartMenu_Exit* → FieldSystem_StartFieldMap → FieldMap_Init: the zone's on-load
   * and on-resume scripts). Absent in hosts without a field (menu tests).
   */
  fieldReturn?(): void;
  /**
   * 0.33.0. The tile in front of the player in the Underground (decomp CommPlayer_GetX/ZInFrontOfPlayer) and what is
   * there for a burial (Spheres_TryBurySphere): `secretBase` (outside the main area), `object` (CommPlayer_
   * CheckNPCCollision), `wall` (TerrainCollisionManager_CheckCollision). Null off the Underground.
   */
  undergroundAhead?(): { x: number; z: number; secretBase: boolean; object: boolean; wall: boolean } | null;
  /**
   * 0.33.0. NOT DS: the Spiritomb option (`DeviceOptions.spiritombVendors`) is on: a vendor's first talk on a visit
   * counts toward Spiritomb (VAR_SPIRITOMB_COUNTER) as a new player met does on the DS.
   */
  spiritombVendors?(): boolean;
  /** 0.33.0. The visit's mining generator (core `miningRand`, CommSys_Seed at the arrival): every board rolls on it in turn. */
  undergroundMiningRand?(): import('@opensinnoh/core').Rand32 | null;
  /**
   * 0.37.0. The decoration's field view (contracts `UndergroundDecorationView`), or null when it ends: the field draws
   * the base's things from it and looks at the room from (15, 17) (UndergroundPC_MoveCamera) until then.
   */
  undergroundDecoration?(view: import('./underground.ts').UndergroundDecorationView | null): void;
  /**
   * 0.45.0. The rock trap's shadow under the player (Traps_ProcessBoulder's ov5_DrawGrowingFloorTexture: the black
   * circle at the size given, growing while the boulder falls), or null when it is gone.
   */
  undergroundTrapShadow?(size: number | null): void;
  /**
   * 0.37.0. Where the player is in the Underground (UndergroundMan_AreCoordinatesInSecretBase): in their base with the
   * entrance `open` or `closed` (CommServerClient_IsInClosedSecretBase), in the corridors (`corridor`), or null off it.
   */
  undergroundPlace?(): 'corridor' | 'open' | 'closed' | null;
  /**
   * 0.36.2. The contests' move animations (packages/battle `createContestMoveAnimation`). Absent in a game without the
   * battle engine (menu tests); a game that loads the engine lazily holds the contest app until it is in.
   */
  contestAnimation?: import('./contests.ts').CreateContestMoveAnimation;
}

/** A running app: one `step` per 30 Hz tick while it is open; a non-null result closes it. */
export interface AppModel {
  step(input: InputFrame): AppResult | null;
  view(): AppView;
}

export type CreateApp = (request: AppRequest, deps: { registries: Registries; state: GameState; log: StubLog; host: AppHost }) => AppModel;

/** A label and value pair (info windows, card fields). */
export interface AppField {
  label: string;
  value: string;
}

/** A small list window (context menus, YES/NO-style choices): taps `menu:<i>`. */
export interface AppMenu {
  entries: { label: string; right?: string }[];
  cursor: number;
}

/** A message box; `waiting` while it waits for A or B (tap `next`). */
export interface AppMessage {
  text: string;
  waiting: boolean;
}

/** The YES/NO window: taps `yes`, `no`. */
export interface AppYesNo {
  yes: string;
  no: string;
  cursor: 0 | 1;
}

/**
 * What a menu app shows. Strings are plain text from the base pack (lines split on `\n`). `cursor` is
 * the selected element; a list's cancel row is index `rows.length`. Tap ids (`InputFrame.tap`) are listed
 * per view; every view also takes `back` (B).
 */
export type AppView =
  | StartMenuView
  | SaveView
  | PartyView
  | BagView
  | SummaryView
  | TrainerCardView
  | OptionsView
  | PokedexView
  | MartView
  | StorageView
  | NamingView
  | EvolutionView
  | HatchView
  | LibraryTvView
  | JournalView
  | DiplomaView
  | TownMapView
  | HallOfFameView
  | CreditsView
  | RowanIntroView
  | MoveReminderView
  | TradeView
  | EasyChatView
  | MysteryGiftView
  | ItemWheelView
  | PoffinCookingView
  | PoffinCaseView
  | PoffinFeedView
  | import('./underground.ts').MiningView
  | import('./underground.ts').UndergroundMenuView
  | import('./underground.ts').UndergroundVendorView
  | import('./underground.ts').UndergroundTrapView
  | import('./underground.ts').UndergroundBaseView
  | import('./underground.ts').UndergroundPcView
  | import('./contests.ts').ContestView
  | import('./contests.ts').ContestPhotoView
  | import('./contests.ts').GalleryDressUpView
  | import('./contests.ts').GalleryPhotoView
  | import('./seals.ts').CapsuleEditorView
  | import('./frontier.ts').FactoryView
  | import('./frontier.ts').HallBoardView
  | import('./slots.ts').SlotsView
  | import('./frontier.ts').CastleView
  | import('./frontier.ts').ArcadeView
  | import('./frontier.ts').FrontierRecordsView;
export type AppName = AppView['app'];

/**
 * 0.32.1. The registered-item wheel (OpenSinnoh): up to ITEM_WHEEL_SIZE items, item i placed toward d-pad direction
 * `WHEEL_DIRECTIONS[i]` about the field's centre, drawn with the ROM's item icons, windows and font. `cursor`: the
 * picked item, or null. Taps: `item:<i>` uses item i, `back` closes.
 */
export interface ItemWheelView {
  app: 'item-wheel';
  items: { item: Id; name: string }[];
  cursor: number | null;
}
/** 0.32.1. The wheel's slot directions, in `registeredWheel` order. */
export const WHEEL_DIRECTIONS = ['up', 'right', 'down', 'left'] as const;

/** Taps: `entry:<i>`. */
export interface StartMenuView {
  app: 'start-menu';
  title: string;
  /** 0.29.1: `retire`, first in a Safari Game (decomp START_MENU_OPTION_RETIRE), where SAVE is hidden. */
  entries: { id: 'retire' | 'pokedex' | 'pokemon' | 'bag' | 'trainer' | 'save' | 'options' | 'exit'; label: string }[];
  cursor: number;
  /**
   * 0.29.1. In a Safari Game, the ball window beside the menu (decomp StartMenu_PrintBallCount: tile 1, 1, 12×4 tiles):
   * "SAFARI BALLS" over "Stock: N".
   */
  ballStock?: { label: string; stock: string };
  /** 0.44.0. With `DeviceOptions.objective` on and a pack with `NewGame.objectives`: the window's title and the current objective. */
  objective?: { title: string; text: string };
}

/** Taps: `yes`, `no`, `ok` (closes after "saved" or an error). */
export interface SaveView {
  app: 'save';
  info: AppField[];
  phase: 'ask' | 'done' | 'error';
  message: string;
  yes: string;
  no: string;
  cursor: 0 | 1;
}

/**
 * The party (decomp party_menu). Modes: `field` (start menu: SUMMARY, SWITCH, ITEM, field moves), `give`
 * (the bag's GIVE), `use` (a bag item on a member), `teach` (a TM/HM: notes ABLE/UNABLE/LEARNED),
 * `battle` (`party-select`, and the battle bag's medicine target), `daycare` (`daycare-select`), `select` (a script's pick, 0.20.0) and `feed` (the Poffin Case's GIVE, 0.31.0). Taps: `slot:<i>`, `cancel`, `menu:<i>` (the open `menu`), `next`
 * (a waiting message), `yes`, `no`.
 */
export interface PartyView {
  app: 'party';
  /** 0.34.0 `order`: the Battle Tower's pick (`party-order`): `notes` say each panel's entry or BANNED, `confirm` is set. */
  mode: 'field' | 'give' | 'use' | 'teach' | 'battle' | 'daycare' | 'select' | 'feed' | 'order' | 'contest' | 'trade' | 'ball-seal';
  title: string;
  slots: (PartySlotView | null)[];
  prompt: string;
  cancel: string;
  /** 0–5 a slot, 6 the cancel button; with `confirm`, 6 CONFIRM and 7 CANCEL (decomp sCursorPosTable_SelectOrder). */
  cursor: number;
  /** 0.34.0. The CONFIRM button's label (mode `order`). */
  confirm?: string;
  /** SWITCH: the slot being moved. */
  moving: number | null;
  /** Per slot, a line in place of the HP (teach mode: ABLE / UNABLE / LEARNED). */
  notes: (string | null)[];
  /** The context window, the item submenu or the move list of a PP item. */
  menu: AppMenu | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/** One party panel (decomp party_menu PartyMenuMember): the icon's species and form, HP, level, gender, status, held item. */
export interface PartySlotView {
  species: Id;
  form: number;
  name: string;
  levelLabel: string;
  level: string;
  hp: number;
  maxHp: number;
  egg: boolean;
  gender: 'male' | 'female' | 'none';
  /** Core StatusCondition; `fainted` at 0 HP (decomp SUMMARY_CONDITION_FAINTED). */
  status: 'none' | 'sleep' | 'poison' | 'toxic' | 'burn' | 'freeze' | 'paralysis' | 'fainted';
  heldItem: Id | null;
  /** The Ball Capsule marker (decomp PartyMenu_DrawMemberBallSeal, `party/held` cell 2 at the item marker + 8 px). */
  capsule?: true;
}

/**
 * The bag (decomp bag app). Modes: `field` (USE, GIVE, TOSS, REGISTER), `give` (from the party's ITEM →
 * GIVE: picks the item) and `battle` (`bag-select`: the battle pockets; a refusal shows as the message). Taps:
 * `pocket:<i>`, `prev`, `next`, `row:<i>`, `cancel`, `menu:<i>`, `qty:<+1|-1|+10|-10>`, `ok` (the
 * quantity), `yes`, `no`, `next` (a waiting message; the same id as the pocket arrow, which is unused
 * while a message waits).
 */
export interface BagView {
  app: 'bag';
  /**
   * 0.29.0 `pick`: a script's `bag-pick` (one pocket; A on an item picks it). 0.31.0 `poffin`: the cooking's berry
   * (BAG_MODE_POFFIN_SINGLEPLAYER: A opens CONFIRM / CANCEL; CHECK TAG, the berry tag app, is left out).
   */
  mode: 'field' | 'give' | 'battle' | 'pick' | 'poffin';
  title: string;
  pockets: string[];
  /**
   * 0.49.0. The DS pocket type each of `pockets` is drawn as (decomp POCKET_*: its icon and the bag picture): the field
   * bag's eight in order, the battle bag's four as medicine, medicine, balls and battle items, and the one pocket of
   * `pick` and `poffin`.
   */
  pocketTypes: number[];
  pocket: number;
  rows: { item: Id; label: string; count: string | null; registered: boolean }[];
  cancel: string;
  cursor: number;
  /** The selected item's description (empty on cancel). */
  description: string;
  /** The item's action window (USE, GIVE, TOSS, REGISTER, CANCEL). */
  menu: AppMenu | null;
  message: AppMessage | null;
  /** TOSS: how many. */
  quantity: { count: string } | null;
  yesNo: AppYesNo | null;
  /** 0.31.0. The `poffin` mode's window (decomp BagUI_DrawPoffinCountMsgBox): "POFFIN CASE" and the Poffins held. */
  poffins?: AppField;
}

/** Decomp SummaryPage order (pokemon_summary_screen/main.h); 0.31.0 `condition`; the contest moves page is later. */
export type SummaryPageId = 'info' | 'memo' | 'skills' | 'condition' | 'moves' | 'ribbons';

/**
 * The summary screen (decomp pokemon_summary_screen): pages INFO, MEMO, SKILLS, BATTLE MOVES and RIBBONS
 * (contest pages later), the front sprite, type and category icons. Mode `teach` is the forget-a-move
 * flow (decomp SUMMARY_MODE_SELECT_MOVE): the moves page with the new move as a fifth row; picking one
 * forgets it (HMs refused), picking the new move gives up. Taps: `page:<id>`, `prev`, `next` (the
 * previous/next party member), `move:<i>`, `ribbon:<i>` and `ribbons:up`/`ribbons:down` (0.20.0), `back`.
 */
export interface SummaryView {
  app: 'summary';
  /**
   * 0.31.0 `feed` (decomp SUMMARY_MODE_FEED_POFFIN: the CONDITION page alone, up/down the Pokémon, A gives the Poffin)
   * and `condition-change` (SUMMARY_MODE_SHOW_CONDITION_CHANGE: after the eating, A applies the Poffin: the graph grows,
   * the raised conditions' arrows and messages).
   */
  mode: 'view' | 'teach' | 'feed' | 'condition-change';
  pages: { id: SummaryPageId; label: string }[];
  page: SummaryPageId;
  mon: {
    species: Id;
    form: number;
    shiny: boolean;
    egg: boolean;
    name: string;
    gender: Gender;
    level: string;
    /** "ITEM" and the held item's name (or NONE). */
    item: AppField;
    ball: Id;
    status: PartySlotView['status'];
  };
  /**
   * INFO: Pokédex no., name, type, OT, ID no., exp, to next level; the exp bar fill (0–1). 0.32.1 `rename`: the
   * RENAME button's label (`DeviceOptions.summaryRename`, the player's own Pokémon only; tap `rename` or A), else absent.
   */
  info: { fields: AppField[]; types: { id: Id; name: string }[]; exp: number; rename?: string };
  /** TRAINER MEMO: nature, met date, place and level, characteristic. */
  memo: string[];
  /**
   * SKILLS: HP (current/max and the bar), the five stats (the nature's raised/lowered marks), ability and its description.
   * 0.32.1 `values` (`DeviceOptions.statView`): which numbers the HP and stat rows show, A (or tap `values`) stepping
   * STATS → EV → IV; its label is drawn on the page. Absent: the stats, as the DS.
   */
  skills: { hp: AppField; hpNow: number; hpMax: number; stats: (AppField & { nature: 'up' | 'down' | null })[]; ability: AppField; abilityDescription: string; values?: { mode: 'stats' | 'evs' | 'ivs'; label: string } };
  /** BATTLE MOVES: up to 4 moves (+ the new one in teach mode); `cursor` and `detail` while a move is selected. */
  moves: {
    rows: { move: Id; name: string; type: Id; pp: string; isNew: boolean }[];
    cursor: number | null;
    /** SWITCH (view mode): the first move picked. */
    swapping: number | null;
    detail: { category: 'physical' | 'special' | 'status'; categoryName: string; power: AppField; accuracy: AppField; description: string } | null;
    /** The DS hint line (e.g. "Pick a move to forget"). */
    hint: string;
    /**
     * 0.27.10. What an empty move slot shows (decomp PrintMoveNameAndPP with MOVE_NONE): move name 0 (the name)
     * and "--" (centred where the PP goes); no PP label, no type icon.
     */
    empty: { name: string; pp: string };
  };
  /**
   * RIBBONS (0.20.0; decomp pokemon_summary_screen, RIBBONS_PER_ROW 4): the ribbons it has in ribbon id
   * order (`ribbon` = decomp enum Ribbon = cell of the `summary/ribbons` sheet), shown in rows of 4 from
   * row `row`: 3 rows while browsing, 2 while one is selected (A, or a tap on a ribbon). The selected
   * ribbon (`cursor`, an index into `list`) shows its name, description and "n/N"; up/down (and the
   * `ribbons:up`/`ribbons:down` arrows) move the cursor a row and scroll. With no ribbons the page shows
   * only the count (and A does nothing).
   */
  ribbons: {
    /** "No. of Ribbons:" and the count. */
    count: AppField;
    list: { ribbon: number; name: string }[];
    /** The first shown row. */
    row: number;
    /** Rows shown: 3 while browsing, 2 while selecting. */
    rows: number;
    cursor: number | null;
    detail: { name: string; description: string; index: string } | null;
    /** The A-button prompt: INFO while browsing (with ribbons), CANCEL while selecting, '' otherwise. */
    hint: string;
  };
  /**
   * 0.31.0. CONDITION (decomp 3d_anim.c, sprites.c): the five conditions the spider graph shows (cool, beauty, cute,
   * smart, tough, 0–255) and `graph`, its growth step (0–4: the graph moves a quarter of the way per frame from
   * `from`, empty when the page opens and the old values when a Poffin changed them; SPIDER_GRAPH_STATE_*; 4 drawn); `sheen` the sparkles shown (0–12, MAX_SHEEN_SPRITES × sheen / 255) and
   * `sheenFrame` the frames since the page opened (their staggered start); the page's labels; `flavor` the FAVORITE
   * FOOD window (the feed modes); `prompt` the A-button's OK (feed mode); `arrows` the raised conditions
   * (condition-change mode).
   */
  condition: {
    title: string;
    sheenLabel: string;
    values: number[];
    from: number[];
    graph: number;
    sheen: number;
    sheenFrame: number;
    flavor: { label: string; text: string } | null;
    prompt: string | null;
    arrows: boolean[];
  };
  message: AppMessage | null;
}

/**
 * 0.31.0. The Poffin cooking (decomp overlay083 ov83_0223B5A0.c, ov83_0223D6A8.c, ov83_0223F7F4.c), one player, one 30 Hz
 * frame per view: the touch screen's pot drawn in DS px, back to front the tablecloth, the flames (the phase's palette,
 * `pulse` their scale, 4096 = 1), the batter (the phase's and, fading by `fade` 0–31, the next one's; turned by `angle`,
 * 0–0xFFFF a turn, scaled by `scale`, 4096 = 1) and the pot's rim. The berry drops into the pot (`berries`, the
 * splash), the cue sprites (`cue`), the direction `arrows` (0 and 1 clockwise, 2 and 3 counter-clockwise: 0 and 2
 * announce, 1 and 3 warn), the steam and drops (`effects`), the banner. `top` is the top screen's message.
 * `results`: the RESULTS window and the Poffin made, then the messages and YES/NO. `fade`: black, 0 shown … 16.
 * Taps: `spoon:<x>,<y>` (the stylus on the pot, DS px; it stays down until `spoon-up`), `spoon-up`, `next`, `yes`,
 * `no`. Keys: Right stirs clockwise, Left counter-clockwise, with A faster.
 */
export interface PoffinCookingView {
  app: 'poffin-cooking';
  tick: number;
  fade: number;
  top: string | null;
  berries: { item: Id; x: number; y: number }[];
  splashes: { x: number; y: number; frame: number }[];
  /** `pour` (the interface's animation 2 at 168, 60), `start` (its animation 0 at 128, 96), `done` (the done sheet's animation 0 at 128, 96). */
  cue: { kind: 'pour' | 'start' | 'done'; frame: number } | null;
  pot: { phase: number; angle: number; scale: number; pulse: number; fade: number; flames: boolean } | null;
  arrows: number[];
  banner: string | null;
  /** A puff or drop: the phase's `puff<set>` sheet, its animation and frame, centre (DS px) and scale (4096 = 1). */
  effects: { set: number; anim: number; frame: number; x: number; y: number; scale: number }[];
  /** The keys' stylus (drawn as the interface's spoon, animation 4: the DS draws no spoon for the stylus itself), or null. */
  spoon: { x: number; y: number } | null;
  /** `poffin`: the type of the Poffin shown, −1 before it shows. */
  results: { title: string; rows: AppField[]; made: AppField; poffin: number } | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.31.0. The Poffin Case (decomp applications/poffin_case/manager.c, menus.c): the list (newest first, six rows from
 * `top`, then CLOSE at index `rows.length`), the selected Poffin's picture (its type), SMOOTH and flavours; the flavour
 * buttons (decomp FLAVOR_* order, 5 = ALL) and the chosen one's line ("Raises coolness."); the GIVE / TRASH / BACK
 * window, the message box and YES/NO. Taps: `row:<i>`, `close`, `filter:<0-5>`, `menu:<i>`, `up`, `down`, `next`,
 * `yes`, `no`, `back`.
 */
export interface PoffinCaseView {
  app: 'poffin-case';
  title: string;
  rows: { name: string; level: string; type: number }[];
  close: string;
  cursor: number;
  top: number;
  visible: number;
  selected: { type: number; smooth: string; flavors: boolean[] } | null;
  filters: string[];
  filter: number;
  filterText: string | null;
  menu: AppMenu | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.31.0. Feeding a Poffin (decomp poffin_case/cutscene.c): the Pokémon's front picture centred at (x, y) and scaled
 * (4096 = 1), the Poffin (`poffin` its type, centre and scale; null once eaten), the message ("… happily ate the
 * Poffin!"). Taps: `next`.
 */
export interface PoffinFeedView {
  app: 'poffin-feed';
  tick: number;
  mon: { species: Id; form: number; shiny: boolean; female: boolean; x: number; y: number; scale: number };
  poffin: { type: number; x: number; y: number; scale: number } | null;
  message: AppMessage | null;
}

/**
 * Taps: `flip`, `done`; on the back `sign` (0.20.0). While signing (0.20.0, decomp signature.c): pen samples
 * `pen:<x>,<y>[;<x>,<y>…]` in signature pixels (0..191, 0..63; the first of a stroke only sets its start,
 * each later one draws a DS pen line from the previous), `pen-up` ends the stroke, `clear`, `done` (then the
 * YES/NO questions, `yes`/`no`), `back` cancels when `signing.cancel`.
 */
export interface TrainerCardView {
  app: 'trainer-card';
  title: string;
  side: 'front' | 'back';
  /** Front: ID no., name, money, Pokédex, score, time. */
  fields: AppField[];
  started: AppField;
  /** Back: Hall of Fame debut, times linked, link battles and trades. */
  back: AppField[];
  gender: 'male' | 'female';
  /** Badge i of the eight (decomp badge order) obtained. */
  badges: boolean[];
  /** Decomp TrainerCase_CalculateTrainerCardLevel (the stars and the card colour): 0–5. */
  stars: number;
  /** 0.20.0. The Pokédex is obtained: without it the DS card has its own colour (trainer_card_normal_no_dex) and no Pokédex row. */
  pokedex: boolean;
  /** 0.20.0. The signature on the back (`GameState.signature`'s format), or the one being drawn while signing. */
  signature: string | null;
  /**
   * 0.20.0. Signing mode (the back): the prompt, the DONE button, the confirmation message and YES/NO;
   * `cancel` (B leaves without saving) is false in the signature app. Null when not signing.
   */
  signing: { prompt: string; done: string; message: AppMessage | null; yesNo: AppYesNo | null; cancel: boolean } | null;
  done: string;
}

/** Taps: `row:<i>`, `value:<row>:<value>`, `step:<row>:<-1|1>`, `close`. */
export interface OptionsView {
  app: 'options';
  title: string;
  /** 0.25.1: each row's `description` (the app's OPTIONS screen shows the focused row's, its own cursor spanning the app's settings too). */
  rows: { key: keyof DeviceOptions; label: string; values: string[]; value: number; description: string }[];
  close: string;
  /** 0.25.1. The close row's description. */
  closeDescription: string;
  /** The cursor row's description (the close row has its own). */
  description: string;
  /** 0..rows-1 a row, rows.length the close row. */
  cursor: number;
}

/**
 * The Pokédex (0.16.0; decomp applications/pokedex): the list, an entry with its pages, the search.
 * Numbers are the list's (Sinnoh or national); every string comes from the base pack.
 */
export type PokedexView = PokedexListView | PokedexEntryView | PokedexSearchView;

/**
 * The list (decomp ov21_021D5AEC.c): seen species in Sinnoh or national order up to the highest seen
 * one, unseen gaps as blank rows ("-----"), or the search results. Taps: `row:<i>` (the cursor goes there
 * and a second tap on the centred seen row opens), `open`, `wheel:<signed travel/tick>` / `wheel-end`, `search`, `switch`, `quit` (QUIT, or CANCEL in results).
 */
export interface PokedexListView {
  app: 'pokedex';
  screen: 'list';
  title: string;
  national: boolean;
  /** SEEN and OBTAINED over this list, or RESULTS and the count. */
  counts: AppField[];
  rows: PokedexRow[];
  cursor: number;
  /** Fractional row position, advanced only at 30 Hz by the menu model. */
  scrollPosition: number;
  /** null when the button is hidden (no national dex, or in results). */
  switchLabel: string | null;
  searchLabel: string | null;
  quitLabel: string;
}

export interface PokedexRow {
  /** null: an unseen gap. */
  species: Id | null;
  form: number;
  number: string;
  name: string;
  caught: boolean;
}

export type PokedexPageId = 'info' | 'area' | 'cry' | 'size' | 'forms';

/**
 * One entry (decomp ov21_021E29DC.c and the page files). Caught species show everything; seen-only
 * ones show the name, number and picture with "?" placeholders, as on the DS. Taps: `page:<i>` (of `pages`), `prev`,
 * `next` (the previous or next seen species of the list), `time:<0-2>`, `form:<i>`, `back`.
 */
export interface PokedexEntryView {
  app: 'pokedex';
  screen: 'entry';
  pages: { id: PokedexPageId; label: string; enabled: boolean }[];
  page: PokedexPageId;
  species: Id;
  form: number;
  female: boolean;
  number: string;
  name: string;
  caught: boolean;
  category: string;
  /** Type records (caught only). */
  types: Id[];
  height: AppField;
  weight: AppField;
  description: string;
  footprint: AssetRef | null;
  /**
   * The area page: the map and found hidden places' overlays; [grid index, tile] of the cells drawn from
   * `ui2d/pokedex/area_fields` (the time of day's lists) and `area_fields_special` (the special lists),
   * tile t being the `cell`-px square at x = t·cell; dungeon markers at DS px.
   */
  area: {
    map: Id;
    overlays: Id[];
    origin: [number, number];
    cell: number;
    columns: number;
    cells: [number, number][];
    specialCells: [number, number][];
    dungeons: { x: number; y: number; coronet: boolean; special: boolean }[];
    times: string[];
    time: number;
    /** "Area Unknown", or null when something is shown. */
    unknown: string | null;
  } | null;
  /** The height check (decomp pokedex_height_check.c): both silhouettes scaled (256 = 1.0) and placed (y in DS px). */
  size: {
    title: string;
    pokemon: { name: string; height: string; scale: number; y: number };
    trainer: { name: string; height: string; gender: 'male' | 'female'; scale: number; y: number };
  } | null;
  /** The forms page: the forms and genders to show (decomp formmain.c), the selected one. */
  forms: { prompt: string; list: { form: number; female: boolean; label: string }[]; cursor: number } | null;
  /** The cry page: a stub. */
  cry: string | null;
}

/**
 * The search (decomp pokedex_search.c): order, name initials, two types and a body shape; each row's
 * value 0 is "none" except the order (0 numerical). Taps: `order:<i>`, `name:<i>`, `type1:<i>`,
 * `type2:<i>`, `shape:<i>`, `ok`, `back`; the d-pad picks a row (up/down) and its value (left/right).
 */
export interface PokedexSearchView {
  app: 'pokedex';
  screen: 'search';
  title: string;
  rows: { id: 'order' | 'name' | 'type1' | 'type2' | 'shape'; label: string; options: string[]; value: number }[];
  /** Body shape per `shape` option (index 0 none: -1; else decomp PokemonBodyShape), for the icons. */
  shapes: number[];
  /** Type record per `type1`/`type2` option (index 0 none). */
  types: (Id | null)[];
  /** rows.length = the OK button. */
  cursor: number;
  ok: string;
  description: string;
  /** "No matching Pokémon were found." until the next input. */
  message: string | null;
}

/**
 * The mart (decomp shop_menu.c; selling is the bag in sell mode, bag/main.c). Taps: `menu:<i>`,
 * `row:<i>`, `cancel`, `pocket:<i>`, `qty:<+1|-1|+10|-10>`, `ok`, `yes`, `no`, `next` (dismisses a
 * waiting message).
 */
export interface MartView {
  app: 'mart';
  /** `menu`: the BUY/SELL/SEE YA! window; `buy`: the stock; `sell`: the bag; `exit`: the goodbye message. */
  mode: 'menu' | 'buy' | 'sell' | 'exit';
  menu: string[];
  menuCursor: number;
  money: AppField;
  /** The clerk's message box; `waiting` while it waits for A or B. */
  message: { text: string; waiting: boolean } | null;
  /** Buy: the stock, price on the right; sell: the pocket's items, count on the right. */
  rows: { item: Id; label: string; right: string }[];
  cancel: string;
  cursor: number;
  /** Sell: the bag's pocket names and the current one (empty when buying). */
  pockets: string[];
  pocket: number;
  /** The item under the cursor (null on cancel). */
  item: { id: Id; name: string; description: string } | null;
  /** The quantity window while choosing how many. */
  quantity: { count: string; total: string; inBag: string } | null;
  yesNo: { yes: string; no: string; cursor: 0 | 1 } | null;
  /**
   * 0.34.0. The Battle Frontier's exchange counter (MART_TYPE_FRONTIER): the menu is YES / NO, prices and `money` are BP
   * (`money.label` empty: the BP window has one line), and the panel takes the frontier palette (`shop/panel_frontier`).
   */
  currency?: 'bp';
  /**
   * The seal mart (MART_TYPE_SEAL): BUY / CANCEL, no item icon (the panel `shop/panel_seal`); rows and `item` name a seal
   * as `seal:<id>`; "In Bag" counts the seals owned.
   */
  seals?: true;
}

/** A Pokémon in the PC (box or party column): its icon and held item. */
export interface BoxMonView {
  species: Id;
  form: number;
  egg: boolean;
  heldItem: Id | null;
}

/**
 * The PC boxes (decomp pc_boxes, one mode per script entry). The box grid (6 × 5, the box's wallpaper)
 * and the party column; the cursor is in `area` (`box` 0–29, `party` 0–5, `header` 0: the box name).
 * Taps: `slot:<i>`, `party:<i>`, `box:<-1|1>`, `header`, `party-toggle`, `close`, `menu:<i>`, `next`,
 * `yes`, `no`; since 0.20.0 `mark:<i>` (the markings window's rows) and, in compare mode,
 * `compare:<0|1>` (SET ON LEFT / RIGHT) and `compare:page` (the next compare page).
 */
export interface StorageView {
  app: 'storage';
  mode: StorageMode;
  title: string;
  box: { index: number; name: string; wallpaper: number; count: string };
  slots: (BoxMonView | null)[];
  party: (BoxMonView | null)[];
  /** Whether the party column shows (deposit and move-with-party show it; phones draw it as a drawer). */
  partyOpen: boolean;
  area: 'box' | 'party' | 'header';
  cursor: number;
  /** The Pokémon (move) or item (items) in hand. */
  held: (BoxMonView & { name: string }) | null;
  heldItem: Id | null;
  /**
   * The Pokémon under the cursor (or in hand): name, level, gender; `fields` its nature, item and (0.27.17)
   * ability, none for an Egg; `types` (0.27.17) its type or two (the decomp preview's type1, type2 when
   * different; none for an Egg); `markings` (0.20.0) its six box marks (bit i: circle, triangle, square, heart,
   * star, diamond).
   */
  preview: { mon: BoxMonView; shiny: boolean; name: string; species: string; level: string; gender: Gender; fields: AppField[]; types: Id[]; markings: number } | null;
  /** The Pokémon's or the box's action window. */
  menu: AppMenu | null;
  /**
   * 0.20.0. The markings window (decomp BoxMenu_FillMarkingsMenu): rows 0–5 the six marks (A toggles one),
   * 6 CONFIRM (sets them), 7 CANCEL; `markings` is the edited value. Taps `mark:<row>`.
   */
  marking: { markings: number; cursor: number; confirm: string; cancel: string } | null;
  /** 0.20.0. Compare mode's panel (decomp CompareModeHelper); null in the other modes. */
  compare: StorageCompare | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
  /** Labels: the PARTY POKéMON button and CLOSE BOX. */
  partyButton: string;
  close: string;
}

/**
 * 0.20.0. The compare panel (decomp CompareModeHelper; the DS draws it on the touch screen): two sides, left
 * and right. The `live` side (decomp compareMonSlot) shows the Pokémon under the cursor; SET ON LEFT / RIGHT
 * keeps it there and makes the other side live. `page` is the DS's three pages (the compare button cycles
 * them); `labels` the page's row names (stats: NATURE, Lv., HP … SPEED; moves: MOVE; contest: none, the
 * ROM art names the conditions).
 */
export interface StorageCompare {
  page: 'stats' | 'contest' | 'moves';
  live: 0 | 1;
  labels: string[];
  sides: [StorageCompareSide | null, StorageCompareSide | null];
  /** SET ON LEFT, SET ON RIGHT. */
  set: [string, string];
}

export interface StorageCompareSide {
  mon: BoxMonView;
  name: string;
  /** Stats: nature, level, HP, ATTACK, DEFENSE, SP. ATK, SP. DEF, SPEED; moves: its moves; an Egg: "???" per row. */
  values: string[];
  /** Contest conditions (cool, beauty, cute, smart, tough; 0–255), null for an Egg. */
  contest: number[] | null;
}

/**
 * The naming screen (decomp naming_screen.c): the prompt, the entity icon, the entered text and the
 * keyboard: pages UPPER, lower and Others (5 rows × 13), the home row's page buttons, BACK and OK.
 * Physical typing fills the same buffer. Taps: `key:<row>:<col>`, `page:<i>`, `del`, `ok`,
 * `type:<text>` (characters typed on a keyboard, entered in order; ones not on the pages are ignored).
 */
/**
 * 0.30.0. The Easy Chat word picker (decomp applications/easy_chat, group mode). `mode` `slots`: the cursor on a blank
 * (`cursor` its index); `groups`: the group list (`cursor` into `groups`, the last is CANCEL); `words`: the open group's
 * words in two columns (`cursor` into `words`, `top` the first row shown of `rows`). Taps: `slot:<i>`, `group:<i>`,
 * `word:<i>`, `up`, `down`, `next`, `yes`, `no`, `back`.
 */
export interface EasyChatView {
  app: 'easy-chat';
  prompt: string;
  slots: string[];
  mode: 'slots' | 'groups' | 'words';
  cursor: number;
  groups: string[];
  group: string | null;
  words: string[];
  top: number;
  rows: number;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.30.0. Mystery Gift (decomp mystery_gift_app.c, wonder_cards_app.c): the list window (`menu`: RECEIVE GIFT, CHECK
 * CARD, EXIT; or a card's INFO, TRASH, EXIT), the message box and YES/NO, and a Wonder Card: its title, text and
 * pictured species, the front or the back (`back`: the date received and whether the gift waits at a Poké Mart),
 * `index` of `count` cards (left and right switch). `busy`: the wait between messages ("Searching…", "Receiving…").
 * Taps: `menu:<i>`, `card:prev`, `card:next`, `next`, `yes`, `no`, `back`.
 */
export interface MysteryGiftView {
  app: 'mystery-gift';
  menu: AppMenu | null;
  card: { title: string; description: string; species: Id; label: string; back: { date: string; status: string } | null; index: number; count: number } | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
  busy: boolean;
}

export interface NamingView {
  app: 'naming';
  kind: NamingRequest['kind'];
  prompt: string;
  gender: 'male' | 'female';
  pokemon: NamingRequest['pokemon'];
  text: string;
  maxLength: number;
  pages: string[];
  page: number;
  /** The page's characters, 5 rows of 13 (a space key enters a space). */
  keys: string[][];
  /** Row -1 is the home row: columns 0–2 the page buttons, 3 BACK, 4 OK. */
  cursor: { row: number; col: number };
  back: string;
  ok: string;
}

/**
 * 0.21.1. The evolution scene (decomp evolution.c) on the DS's 256×192 main screen, one view per tick:
 * the evolving Pokémon and its new form at (128, 80), each scaled (256 = 1) and faded toward a colour
 * (0–16, PokemonSprite_StartFade); the background (`ui2d/evolution/background`) faded (0–16,
 * PaletteData_StartFade; `box` when the message box fades too) and shown only between rows `window.top`
 * and `window.bottom` (the GX window; outside it only the message box and the Pokémon show, over black);
 * the sparkles (the ROM's particle emitters, `ui2d/evolution/particles`) in DS px. Taps: `next` (a waiting
 * message), `yes`, `no`, `back` (B: cancels while `cancellable`).
 */
export interface EvolutionView {
  app: 'evolution';
  sprites: EvolutionSpriteView[];
  fade: { level: number; color: 'black' | 'white'; box: boolean };
  window: { top: number; bottom: number };
  particles: EvolutionParticleView[];
  message: AppMessage | null;
  yesNo: AppYesNo | null;
  /** B stops the evolution now (decomp: the alternating phase, when the caller allows it). */
  cancellable: boolean;
  /** Which YES/NO is up: "Should a move be deleted?" (`forget`) or "Stop trying to teach …?" (`give-up`). */
  question: 'forget' | 'give-up' | null;
}

export interface EvolutionSpriteView {
  species: Id;
  form: number;
  shiny: boolean;
  female: boolean;
  /** The picture (0 or 1) and its shift in px (the front animation's frame). */
  frame: number;
  dx: number;
  dy: number;
  /** 256 = full size, about the picture's centre. */
  scale: number;
  fade: { level: number; color: 'black' | 'white' };
}

/**
 * One particle: centre in DS px, half its width and height in px, turned by `angle` (radians, the texture's
 * height along the turned y axis), a cell of `ui2d/evolution/particles`, colour and alpha (0–31).
 */
export interface EvolutionParticleView {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  texture: number;
  color: string;
  alpha: number;
}

/**
 * The egg hatching scene (0.19.0; decomp cutscenes/egg_hatch/main.c, EggHatchCutscene_Normal), stepped once
 * per tick: the ROM background (`ui2d/egg_hatch/background`), the egg (`ui2d/egg_hatch/egg` cell `frame`,
 * centred at (128, 120) plus its shake offset, scaled while it bulges), the black bars (`ui2d/egg_hatch/bar`,
 * at y `bars.top` (rest −16) and `bars.bottom` (rest 144) as they slide off; null once gone), the scene's fade to white (`white`
 * 0–16, the decomp palette fade), then the Pokémon's front picture. The message box and YES/NO are the
 * DS's. Taps: `next` (a waiting message), `yes`, `no`.
 */
/**
 * 0.27.25. The Canalave Library TV (decomp library_tv.c, LibraryTV_Main), stepped once per tick (one DS frame): one
 * 256×192 DS screen of three BG layers on black: the picture (`ui2d/library_tv/picture`, BG3), the scan lines
 * (`ui2d/library_tv/scanlines`, BG1, 256×256, drawn from its row `scanY` and wrapping, alpha-blended over the
 * picture at 4/16 of their own colour and 12/16 of the picture's, decomp G2_SetBlendAlpha) and the TV frame
 * (`ui2d/library_tv/frame`, BG0, on top). `black` is the master brightness fade (0 shown, 16 black).
 */
export interface LibraryTvView {
  app: 'library-tv';
  scanY: number;
  black: number;
}

/**
 * 0.37.0. The journal (decomp journal_display/journal_controller.c, journal_printer.c), stepped once per tick: one 256×192
 * DS screen. Each page is the paper (`JournalTables.art` by gender, cell = the page number: page n's paper palette) and
 * its text in the system font (colours 1/2): `title` at (16, 16) and `weekday` 12 px after it; `rows` in the events window
 * at (32, 32) + (0, y). While a page turns, `turn` names the page on top and the wipe step (0–8) of
 * `JournalTables.pageTurn`: destination tile column i shows the top page's column `pageTurn[step][i]`, or the page under
 * it where that is 0xFF. `black` is the screen fade (0 shown, 16 black). Taps: `prev` (newer), `next` (older), `back`.
 */
export interface JournalView {
  app: 'journal';
  gender: 'male' | 'female';
  /** The page shown (under a turn: the page under the wipe). */
  page: JournalPageView;
  turn: { step: number; page: JournalPageView } | null;
  /** Newer and older pages exist (the taps' targets). */
  newer: boolean;
  older: boolean;
  black: number;
}

/** One printed journal page: its number (the paper palette) and lines. */
export interface JournalPageView {
  index: number;
  title: string;
  weekday: string;
  rows: { y: number; text: string }[];
}

/**
 * 0.37.0. A diploma (decomp applications/diploma.c, Diploma_Main), stepped once per tick: the document sheet
 * (`NewGame.diploma` sinnoh / national) with three lines in the system font (colours 1/2) at their DS positions;
 * `black` the brightness fade (0 shown, 16 black). Taps: `next` (A, B or a touch once the document has settled).
 */
export interface DiplomaView {
  app: 'diploma';
  sheet: Id;
  lines: { text: string; x: number; y: number }[];
  black: number;
}

/**
 * 0.29.0. The Town Map in fly mode (decomp applications/town_map, TOWN_MAP_MODE_FLY), stepped once per tick: one
 * 256×192 DS screen. Back to front: `TownMap.screen`, the patches of the found hidden locations (`hidden`, indexes
 * into `TownMap.hidden`), the fly location blocks (`TownMap.blocks[palette - 5]`, cell `shape`, at x, y), the player
 * icon and the cursor (its animation at twice the speed, from `tick`), each at (7·cell x + 25, 7·cell z − 34); then
 * the name window's text in the system font: `prompt` ("Fly to where?") at (24, 174) and the hovered cell's `name`
 * at (146, 174). `fade` (0 shown … 16 black) is the circle wipe as the map opens and closes. Taps: `town:<i>` (a
 * block of `TownMap.locations` index i) moves the cursor there and flies if it is unlocked, `back`.
 */
export interface TownMapView {
  app: 'town-map';
  hidden: number[];
  /**
   * 0.48.0: `objective` marks the current objective's destination (`ObjectiveTables` step `to`, with the objective option
   * on): drawn even where the DS hides a locked block, blinking in the hovered palette at half the hover's speed.
   */
  blocks: { location: number; palette: number; shape: number; x: number; y: number; unlocked: boolean; objective?: true }[];
  player: { x: number; y: number; gender: 'male' | 'female' };
  cursor: { x: number; y: number };
  tick: number;
  prompt: string;
  name: string | null;
  fade: number;
}

export interface HatchView {
  app: 'hatch';
  mon: { species: Id; form: number; shiny: boolean; female: boolean };
  /** The egg sprite, or null once it burst. */
  egg: { frame: number; x: number; y: number; scaleX: number; scaleY: number } | null;
  bars: { top: number; bottom: number } | null;
  white: number;
  /** The Pokémon's picture is shown (from the burst on, under `white`). */
  showMon: boolean;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/** 0.27.19. A Pokémon’s front picture in the Hall of Fame scenes. */
export interface HallOfFameSprite {
  species: Id;
  form: number;
  shiny: boolean;
  female: boolean;
}

/** 0.27.19. A line of text at a DS position: `x` its left edge, or the centre of a `width` px column when `width` is set. */
export interface SceneLine {
  text: string;
  x: number;
  y: number;
  width?: number;
}

export type HallOfFameView = HallOfFameRecordView | HallOfFamePcView;

/**
 * 0.27.19. The Champion's induction (decomp cutscenes/hall_of_fame.c), one 256×192 main screen in DS px:
 * `brightness` 0 (black) to 1. Each member alone (`member`): its picture centred at (`x`, 96), its frame (96×128
 * at `frame`, sliding in from the side, out upwards) and its text column. Then `group`: the player's picture
 * centred at (128, `player.y`) in its frame (`frame` left/right/top, 144 tall), the two lines, the party
 * pictures as they slide in, `confetti` once all are in. `wipe`: the inward black wipe (black above `top`,
 * below `bottom`). `waiting`: the final screen waits for A or B (tap `next`). `tick` drives the spotlights.
 */
export interface HallOfFameRecordView {
  app: 'hall-of-fame';
  mode: 'record';
  brightness: number;
  member: { mon: HallOfFameSprite; x: number; frame: { x: number; y: number } | null; lines: SceneLine[] } | null;
  group: {
    player: { gender: 'male' | 'female'; y: number };
    frame: { left: number; right: number; top: number };
    lines: SceneLine[];
    party: { mon: HallOfFameSprite; x: number; y: number }[];
    confetti: boolean;
  } | null;
  wipe: { top: number; bottom: number } | null;
  waiting: boolean;
  tick: number;
}

/**
 * 0.27.19. The PC's Hall of Fame viewer (decomp applications/pc_hall_of_fame): the entry's title line (number
 * and date), its team's pictures (`selected` opaque, the others faded), and the selected member's text: `info`
 * (nickname, species and gender, level, OT) or its `moves`. Left/Right an older/newer entry, Up/Down the member,
 * A toggles the moves, B closes. Taps: `older`, `newer`, `member:<i>`, `toggle`, `back`.
 */
export interface HallOfFamePcView {
  app: 'hall-of-fame';
  mode: 'pc';
  brightness: number;
  title: string;
  party: HallOfFameSprite[];
  selected: number;
  panel: 'info' | 'moves';
  lines: SceneLine[];
}

/**
 * 0.27.19. The end credits (decomp cutscenes/end_credits) on one 256×192 screen (no split DS layout): the
 * screen the staff rows rise through first. `frame` is the app's global frame (30 Hz); `scene` the
 * scene playing under the text (decomp EndCreditsScene order) and `memory` the gender's picture shown in a
 * memories scene (0–9) or the Twinleaf scene (0–3), null in the bicycle scenes; `lines` the staff rows on the
 * screen now (ROM text, `TEXT_BANK_END_CREDITS`); `brightness` the scene art's (the
 * DS brightness controller leaves the text layer alone) and `screen` the whole screen's, 0 (black) to 1.
 * `final` is the last row on the final screen; `card` the OpenSinnoh card after it,
 * engine text. Taps: `next` (A or Start once the final screen or the card waits), `skip` (Start, repeat clears).
 */
export interface CreditsView {
  app: 'credits';
  frame: number;
  /** Frames since this scene loaded; independent of the global staff scroll. */
  sceneFrame: number;
  scene: 'morning' | 'memories' | 'day' | 'night' | 'twinleaf' | 'final' | 'card';
  memory: number | null;
  gender: 'male' | 'female';
  lines: SceneLine[];
  brightness: number;
  screen: number;
  final: string | null;
  card: { title: string; lines: string[] } | null;
}

/**
 * 0.27.30. Rowan's intro (decomp applications/rowan_intro, one DS frame per tick) on one screen: the DS main
 * screen, or its touch screen while the Poké Ball waits for a touch. Pictures are cells of the base pack's
 * `intro/*` sheets (a pack without them gets stand-ins). Positions are DS px of the 256×192 screen; opacities
 * 0–16. While the naming keyboard is up the app's view is a `NamingView`. The app's setup screen draws with
 * this view too. Taps: `next` (a waiting message), `menu:<i>`, `ball` (the Poké Ball's button), `boy`, `girl`.
 */
export interface RowanIntroView {
  app: 'rowan-intro';
  screen: 'main' | 'touch';
  /** Main BG3 (an `intro/backdrops` cell), or null: the black backdrop. */
  backdrop: 'plain' | 'adventure' | null;
  /** Main BG1 and BG2 pictures, back to front: an `intro/people` cell, the screen position of its layer's (0, 0), its opacity. */
  layers: { cell: string; x: number; y: number; alpha: number }[];
  /** The Pokémon from the Poké Ball (main BG2): its 80×80 front picture's top-left, opacity, and its blend toward `tint.color` (RGB555) at `tint.level` of 16. */
  pokemon: { species: Id; x: number; y: number; alpha: number; tint: { color: number; level: number } } | null;
  /** The Poké Ball's button (an `intro/ball` cell) on the touch screen, or null. */
  ball: string | null;
  /** Master brightness: −16 black … 0. */
  brightness: number;
  /** Blend brightness toward white (the Poké Ball's flash), 0–16; the Pokémon is not affected. */
  flash: number;
  message: AppMessage | null;
  /** A text block (ADVENTURE INFO, in the system font): its top in DS px, its opacity, and whether it waits for A or B (tap `next`). */
  block: { text: string; y: number; alpha: number; waiting: boolean } | null;
  /** A choice window with its frame, in DS px. */
  menu: { entries: string[]; cursor: number; rect: { x: number; y: number; w: number; h: number } } | null;
  /** The gender choice is up, with the picked one: taps `boy` and `girl` pick, a tap on the picked one confirms. */
  gender: 'male' | 'female' | null;
}

/**
 * 0.29.0. The move relearner's and the move tutor's screen (decomp applications/move_reminder.c, waza_oshie_gra): the
 * Pokémon's name, the list of moves (name, type, PP "cur/max"; at most 7 rows shown from `top`, then CANCEL at index
 * `rows.length`), the selected move's category, power, accuracy and description, and the message box with its YES/NO.
 * Taps: `row:<i>`, `cancel`, `up`, `down` (the scroll arrows), `next`, `yes`, `no`, `back`.
 */
export interface MoveReminderView {
  app: 'move-reminder';
  mon: { species: Id; form: number; name: string; gender: Gender; level: string };
  /** The page's labels: BATTLE MOVES, CATEGORY, PP. */
  labels: { title: string; category: string; pp: string };
  rows: { move: Id; name: string; type: Id; pp: string }[];
  cancel: string;
  cursor: number;
  top: number;
  /** Rows shown at once (decomp MOVE_REMINDER_LIST_MAX). */
  visible: number;
  detail: { category: 'physical' | 'special' | 'status'; power: AppField; accuracy: AppField; description: string } | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.29.0. The trade scene (decomp cutscenes/trade_sequence): one deterministic timeline of `phase`s, `tick` 30 Hz
 * ticks into the current one (`ticks` long): `send` (the sent Pokémon on the time-of-day field, the message, into
 * its ball), `tube` (the ball rises), `wormhole`, `arrive` (the other ball comes down), `reveal` (it opens on the
 * received Pokémon) and `receive` (the messages). `message` is the box's text while one shows; it waits on A
 * (`waiting`). Taps: `next`.
 */
export interface TradeView {
  app: 'trade';
  background: 'day' | 'evening' | 'night';
  phase: 'send' | 'tube' | 'wormhole' | 'arrive' | 'reveal' | 'receive';
  tick: number;
  ticks: number;
  sent: { species: Id; form: number; shiny: boolean; female: boolean; ball: Id };
  received: { species: Id; form: number; shiny: boolean; female: boolean; ball: Id };
  message: AppMessage | null;
}
