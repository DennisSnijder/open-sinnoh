/**
 * Menu labels come from the base pack's text records, never from source code (docs/decisions.md). A label is
 * a Platinum message name (decomp names, as in names.json) in the base pack's namespace:
 * `platinum:StartMenu_Text_Bag` on the ROM, `fixture:StartMenu_Text_Bag` in the fixture pack, which
 * carries its own original strings under the same names. Mods override them like any text record. Every
 * name is checked when the strings are made, so a pack that lacks one fails loudly.
 */
import { newGameRecord, parseTextMarkup, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { expandTemplate, plainMarkup } from '@opensinnoh/text';

const POCKET_NAMES = Array.from({ length: 8 }, (_, i) => `pl_msg_00000395_0000${i}`);
const MONTHS = Array.from({ length: 12 }, (_, i) => `pl_msg_00000414_${String(i).padStart(5, '0')}`);
/** Decomp TEXT_BANK_POKEMON_STAT_NAMES: HP, Attack, Defense, Speed, Sp. Atk, Sp. Def. */
const STAT_NAMES = Array.from({ length: 6 }, (_, i) => `pl_msg_00000551_${String(i).padStart(5, '0')}`);
const FRAME_TYPES = Array.from({ length: 20 }, (_, i) => `OptionsMenu_Text_MessageBoxStyle_${String(i + 1).padStart(2, '0')}`);
/** Shop menu bank (decomp TEXT_BANK_UNK_0543, shop_menu.c). */
const shop = (n: number) => `pl_msg_00000543_${String(n).padStart(5, '0')}`;
/** The capsule editor's bank (decomp TEXT_BANK_UNK_0008, capsule_menu). */
const capsule = (n: number) => `pl_msg_00000008_${String(n).padStart(5, '0')}`;

/** Label key → message name. */
export const MENU_TEXT = {
  startPokedex: 'StartMenu_Text_Pokedex',
  startPokemon: 'StartMenu_Text_Pokemon',
  startBag: 'StartMenu_Text_Bag',
  /** {var 0} = player name. */
  startTrainer: 'StartMenu_Text_PlayerTemplate',
  startSave: 'StartMenu_Text_Save',
  startOptions: 'StartMenu_Text_Options',
  startExit: 'StartMenu_Text_Exit',
  startRetire: 'StartMenu_Text_Retire',
  startSafariBalls: 'StartMenu_Text_SafariBalls',
  /** {var 0} = the Safari Balls left. */
  startBallStock: 'StartMenu_Text_BallStock',

  bagCancel: 'Bag_Text_Cancel',
  /** A berry facing empty soil (0.29.0). */
  bagPlant: 'Bag_Text_Plant',
  bagCountX: 'Bag_Text_ItemCountX',
  /** {var 0} = item. */
  bagCantSell: 'Bag_Text_CantSellItem',
  /** {var 0} = item. */
  bagSellHowMany: 'Bag_Text_SellHowMany',
  /** {var 0} = money. */
  bagConfirmSell: 'Bag_Text_ConfirmSellPrice',
  /** {var 0} = item, {var 1} = money. */
  bagSold: 'Bag_Text_TurnedOverItems',

  /** The battle bag's pockets (two words each on the DS buttons), its refusals. */
  battleBagHpPp: 'BattleBag_Text_PocketNameHPPP',
  battleBagRestore: 'BattleBag_Text_PocketNameRestore',
  battleBagStatus: 'BattleBag_Text_PocketNameStatus',
  battleBagHealers: 'BattleBag_Text_PocketNameHealers',
  battleBagBalls: 'BattleBag_Text_PocketNamePokeBalls',
  battleBagItems: 'BattleBag_Text_PocketNameBattleItems',
  battleBagNoUse: 'BattleBag_Text_ItemHasNoUse',
  battleBagNoRoom: 'BattleBag_Text_CantUseBallNoRoomLeft',
  battleBagTwoWild: 'BattleBag_Text_CantUseBallTwoPokemon',
  /** The battle party's prompts and refusals; {var 0} = the Pokémon. */
  battlePartyChoose: 'BattleParty_Text_ChooseAPokemon',
  battlePartyUseOn: 'BattleParty_Text_UseOnWhichPokemon',
  battlePartyInBattle: 'BattleParty_Text_CantSwitchWithPokemonAlreadyInBattle',
  battlePartyFainted: 'BattleParty_Text_CantSwitchWithFaintedPokemon',
  battlePartySelected: 'BattleParty_Text_CantSwitchWithAlreadySelectedPokemon',
  battlePartyEgg: 'BattleParty_Text_CantSwitchWithEgg',
  battlePartyNoEffect: 'BattleParty_Text_ItemWontHaveAnyEffect',

  partyChoose: 'PartyMenu_Text_ChooseAPokemon',
  partyCancel: 'PartyMenu_Text_CancelButton',
  level: 'BattleParty_Text_PokemonLevelLabel',
  partyMoveToWhere: 'PartyMenu_MoveToWhere',
  partyGiveToWhich: 'PartyMenu_Text_GiveToWhichMon',
  partyUseOnWhich: 'PartyMenu_Text_UseOnWhichMon',
  /** Softboiled and Milk Drink (PartyMenu_StartFieldMoveHPTransfer). */
  partyTransferWhich: 'PartyMenu_Text_UseOnWhichPokemon',
  partyNotEnoughHp: 'PartyMenu_Text_NotEnoughHP',
  partyCantUseOnThat: 'PartyMenu_Text_ThisCantBeUsedOnThatPokemon',
  partyTeachWhich: 'PartyMenu_Text_TeachWhichMon',
  /** {var 0} = Pokémon. */
  partyPromptMon: 'PartyMenu_Text_PromptPokemon',
  partyPromptEgg: 'PartyMenu_Text_PromptEgg',
  partyDoWhatItem: 'PartyMenu_Text_DoWhatWithAnItem',
  partyRestoreWhichMove: 'PartyMenu_Text_RestoreWhichMove',
  partyBoostWhichMove: 'PartyMenu_Text_BoostPPOfWhichMove',
  partySummary: 'PartyMenu_Text_Summary',
  partySwitch: 'PartyMenu_Text_Switch',
  partyItem: 'PartyMenu_Text_Item',
  partyItemGive: 'PartyMenu_Text_ItemGive',
  partyItemTake: 'PartyMenu_Text_ItemTake',
  partyContextCancel: 'PartyMenu_Text_ContextCancel',
  /** The Battle Tower's order pick (PARTY_MENU_MODE_BATTLE_TOWER): ENTER / NO ENTRY, CONFIRM, the panel comments, the refusals. */
  partyEnter: 'PartyMenu_Text_Enter',
  /** 0.35.0. The contest mode's panel notes (PrintMemberContestComment). */
  partyContestAble: 'PartyMenu_Text_EligibleForContest',
  partyContestUnable: 'PartyMenu_Text_IneligibleForContest',
  /** The Ball Capsule (PARTY_MENU_MODE_BALL_SEAL, the detach prompt of STORE and NPC trades). */
  partyPromptCustomBall: 'PartyMenu_Text_PromptCustomBall',
  partySet: 'PartyMenu_Text_Set',
  partyCapsuleSet: 'PartyMenu_Text_BallCapsuleWasSet',
  partyTwoCapsules: 'PartyMenu_Text_TwoCapsulsesCantBeSet',
  partyCapsuleDetached: 'PartyMenu_Text_BallCapsuleWillBeDetached',
  partyNoEntry: 'PartyMenu_Text_NoEntry',
  partyConfirm: 'PartyMenu_Text_ConfirmButton',
  partyChooseAndConfirm: 'PartyMenu_Text_ChooseMonAndConfirm',
  partyNotEntered: 'PartyMenu_Text_NotEntered',
  partyBanned: 'PartyMenu_Text_Banned',
  partyEntered1: 'PartyMenu_Text_EnteredFirst',
  partyEntered2: 'PartyMenu_Text_EnteredSecond',
  partyEntered3: 'PartyMenu_Text_EnteredThird',
  partyEntered4: 'PartyMenu_Text_EnteredFourth',
  partyNoMoreThan1: 'PartyMenu_Text_NoMoreThanOneMon',
  partyNoMoreThan2: 'PartyMenu_Text_NoMoreThanTwoMon',
  partyNoMoreThan3: 'PartyMenu_Text_NoMoreThanThreeMon',
  partyNoMoreThan4: 'PartyMenu_Text_NoMoreThanFourMon',
  partyNeeded2: 'PartyMenu_Text_TwoMonAreNeeded',
  partyNeeded3: 'PartyMenu_Text_ThreeMonAreNeeded',
  partyNeeded4: 'PartyMenu_Text_FourMonAreNeeded',
  partyIdentical: 'PartyMenu_Text_IdenticalMonNotPermitted',
  partyIdenticalItems: 'PartyMenu_Text_SomeMonHoldingIdenticalItems',
  /** 0.37.0. The Battle Hall's pick (PARTY_MENU_MODE_BATTLE_HALL): the two must be of one species. */
  partySameKind: 'PartyMenu_Text_MustUseSameKindOfMon',
  /** The daycare party's STORE (decomp PARTY_MENU_STR_MAIL_STORE). */
  partyStore: 'PartyMenu_Text_MailStore',
  partyAble: 'PartyMenu_Text_AbleToLearn',
  partyUnable: 'PartyMenu_Text_UnableToLearn',
  partyLearnedNote: 'PartyMenu_Text_AlreadyLearned',
  partyAbleEvolve: 'PartyMenu_Text_AbleToEvolve',
  partyUnableEvolve: 'PartyMenu_Text_UnableToEvolve',
  /** {var 0} = Pokémon, {var 1} = level (the Rare Candy). */
  partyLevelUp: 'PartyMenu_Text_LevelUp',
  /** {var 0} = Pokémon, {var 1} = move (a level-up move learned in the party menu). */
  partyLearnedMove2: 'PartyMenu_Text_MonLearnedMove2',
  /** The level-up stats window: MAX HP, ATTACK, DEFENSE, SP. ATK, SP. DEF, SPEED; "+ {var 0}"; "{var 0}". */
  partyStatHp: 'PartyMenu_Text_LevelUpMaxHP',
  partyStatAttack: 'PartyMenu_Text_LevelUpAttack',
  partyStatDefense: 'PartyMenu_Text_LevelUpDefense',
  partyStatSpAttack: 'PartyMenu_Text_LevelUpSpAttack',
  partyStatSpDefense: 'PartyMenu_Text_LevelUpSpDefense',
  partyStatSpeed: 'PartyMenu_Text_LevelUpSpeed',
  partyStatIncrease: 'PartyMenu_Text_LevelUpStatIncrease',
  partyStatValue: 'PartyMenu_Text_LevelUpNewStatValue',
  /** {var 0} = Pokémon, {var 1} = move. Three pages, the last a question. */
  partyWantsToLearn: 'PartyMenu_Text_MonWantsToLearnMove',
  partyStopTeaching: 'PartyMenu_Text_StopTryingToTeachMove',
  partyDidNotLearn: 'PartyMenu_Text_MonDidNotLearnMove',
  partyWhichForget: 'PartyMenu_Text_WhichMoveShouldBeForgotten',
  partyForgot: 'PartyMenu_Text_MonForgotMove',
  partyLearned: 'PartyMenu_Text_MonLearnedMove',
  partyNotCompatible: 'PartyMenu_Text_MonAndMoveAreNotCompatible',
  partyAlreadyKnows: 'PartyMenu_Text_MonAlreadyKnowsMove',
  /** {var 0} = Pokémon, {var 1} = amount. */
  partyHpRestored: 'PartyMenu_Text_MonsHPWasRestored',
  partyCuredPoison: 'PartyMenu_Text_MonWasCuredOfPoison',
  partyCuredParalysis: 'PartyMenu_Text_MonWasCuredOfParalysis',
  partyBurnHealed: 'PartyMenu_Text_MonsBurnWasHealed',
  partyThawedOut: 'PartyMenu_Text_MonWasThawedOut',
  partyWokeUp: 'PartyMenu_Text_MonWokeUp',
  partyPpRestored: 'PartyMenu_Text_PPWasRestored',
  partyRegainedHealth: 'PartyMenu_Text_MonRegainedHealth',
  partyBecameHealthy: 'PartyMenu_Text_MonBecameHealthy',
  /** {var 0} = move. */
  partyPpIncreased: 'PartyMenu_Text_MovesPPIncreased',
  /** {var 0} = Pokémon, {var 1} = stat. */
  partyStatRose: 'PartyMenu_Text_MonBaseStatRose',
  partyNoEffect: 'PartyMenu_Text_ItWontHaveAnyEffect',
  partyNeedBadge: 'PartyMenu_Text_CantBeUsedUntilBadgeIsObtained',
  partyCantUseHere: 'PartyMenu_Text_CantUseThatHere',
  partyAlreadySurfing: 'PartyMenu_Text_YoureAlreadySurfing',
  partyPartner: 'PartyMenu_Text_CantUseWhenYouHaveSomeoneWithYou',
  /** {var 0} = Pokémon, {var 1} = item. Two pages, the last a question. */
  partyAlreadyHolding: 'PartyMenu_Text_MonAlreadyHoldingItemsSwitchItems',
  partyNotHolding: 'PartyMenu_Text_MonIsntHoldingAnything',
  /** {var 0} = Pokémon, {var 1} = item. */
  partyReceived: 'PartyMenu_Text_ReceivedItemFromMon',
  partyBagFull: 'PartyMenu_Text_BagIsFull',
  /** {var 1} = the old item, {var 2} = the new one. */
  partyItemSwapped: 'PartyMenu_Text_ItemWasTakenAndReplacedWithItem',
  /** {var 0} = Pokémon, {var 1} = item. */
  partyGiven: 'PartyMenu_Text_MonWasGivenItem',
  /** {var 0} = the Pokémon (the Griseous Orb's form change). */
  partyChangedForm: 'PartyMenu_Text_ChangedForm',
  partyEggNoItem: 'BoxText_EggsCantHoldItems',

  bagUse: 'Bag_Text_Use',
  bagToss: 'Bag_Text_Trash',
  bagRegister: 'Bag_Text_Register',
  bagDeselect: 'Bag_Text_Deselect',
  bagGive: 'Bag_Text_Give',
  bagCloseBag: 'Bag_Text_CloseBag',
  bagCloseDescription: 'Bag_Text_CloseBagDescription',
  bagYes: 'Bag_Text_Yes',
  bagNo: 'Bag_Text_No',
  /** {var 0} = item. */
  bagTossHowMany: 'Bag_Text_ThrowAwayHowMany',
  /** {var 0} = count. */
  bagTossCount: 'Bag_Text_ThrowAwayCount',
  /** {var 0} = item, {var 1} = count. */
  bagTossOk: 'Bag_Text_ThrowAwayOK',
  bagThrewAway: 'Bag_Text_ThrewAwayItem',
  bagBootedTm: 'Bag_Text_BootedUpTM',
  bagBootedHm: 'Bag_Text_BootedUpHM',
  /** {var 0} = move. Two pages, the last a question. */
  bagTmContained: 'Bag_Text_TMHMContainedMove',
  /** {var 0} = player, {var 1} = item. */
  bagUsedRepel: 'Bag_Text_UsedRepel',
  bagRepelLingers: 'Bag_Text_RepelEffectsLinger',
  /** The Bicycle's action while cycling (decomp ITEM_ACTION_WALK). */
  bagWalk: 'Bag_Text_Walk',
  /** {var 0} = coins. */
  bagCoinCase: 'Bag_Text_CoinCaseMessage',
  /** BagContext_FormatErrorMessage: ITEM_USE_CANNOT_DISMOUNT, _WITH_PARTNER, _FISH_HERE, _USE_GENERIC ({var 0} = player). */
  bagCannotDismount: 'Bag_Text_CannotDismount',
  bagCannotUseWithPartner: 'Bag_Text_CannotUseWithPartner',
  bagCannotFish: 'Bag_Text_CannotUseNoFishing',
  bagCantDoThat: 'CommonStrings_Text_CantDoThatRightNow',

  sumInfo: 'PokemonSummary_Text_PageTitleInfo',
  sumMemo: 'PokemonSummary_Text_PageTitleMemo',
  sumSkills: 'PokemonSummary_Text_PageTitleSkills',
  sumMoves: 'PokemonSummary_Text_PageTitleBattleMoves',
  sumRibbons: 'PokemonSummary_Text_PageTitleRibbons',
  /** 0.31.0: the CONDITION page and its Poffin feeding (decomp window.c DrawConditionPageWindows, PrintPoffinFeedMsg). */
  sumCondition: 'PokemonSummary_Text_PageTitleCondition',
  sumSheen: 'PokemonSummary_Text_LabelSheen',
  sumFavoriteFood: 'PokemonSummary_Text_FavoriteFood',
  sumLikesSpicy: 'PokemonSummary_Text_LikesItSpicy',
  sumLikesDry: 'PokemonSummary_Text_LikesItDry',
  sumLikesSweet: 'PokemonSummary_Text_LikesItSweet',
  sumLikesBitter: 'PokemonSummary_Text_LikesItBitter',
  sumLikesSour: 'PokemonSummary_Text_LikesItSour',
  sumEatsAnything: 'PokemonSummary_Text_EatsAnything',
  sumPoffinOk: 'PokemonSummary_Text_PoffinFeedOk',
  sumCoolEnhanced: 'PokemonSummary_Text_CoolnessEnhanced',
  sumBeautyEnhanced: 'PokemonSummary_Text_BeautyEnhanced',
  sumCuteEnhanced: 'PokemonSummary_Text_CutenessEnhanced',
  sumSmartEnhanced: 'PokemonSummary_Text_SmartnessEnhanced',
  sumToughEnhanced: 'PokemonSummary_Text_ToughnessEnhanced',
  sumNothingChanged: 'PokemonSummary_Text_NothingChanged',
  sumWontEatMore: 'PokemonSummary_Text_PokemonWontEatMore',
  /** 0.31.0: the Poffin Case (TEXT_BANK_POFFIN_CASE) and the feeding scene (TEXT_BANK_POFFIN_CUTSCENE). */
  poffinCaseTitle: 'PoffinCase_Text_PoffinCase',
  poffinGive: 'PoffinCase_Text_Give',
  poffinTrash: 'PoffinCase_Text_Trash',
  poffinBack: 'PoffinCase_Text_Back',
  /** {var 0} = the smoothness. */
  poffinSmooth: 'PoffinCase_Text_Smooth',
  poffinClose: 'PoffinCase_Text_Close',
  /** {var 0} = the Poffin. */
  poffinDiscard: 'PoffinCase_Text_Discard',
  poffinThrownOut: 'PoffinCase_Text_ThrownOut',
  poffinSpicy: 'PoffinCase_Text_Spicy',
  poffinDry: 'PoffinCase_Text_Dry',
  poffinSweet: 'PoffinCase_Text_Sweet',
  poffinBitter: 'PoffinCase_Text_Bitter',
  poffinSour: 'PoffinCase_Text_Sour',
  poffinAll: 'PoffinCase_Text_All',
  poffinRaiseCool: 'PoffinCase_Text_RaiseCoolness',
  poffinRaiseBeauty: 'PoffinCase_Text_RaiseBeauty',
  poffinRaiseCute: 'PoffinCase_Text_RaiseCuteness',
  poffinRaiseSmart: 'PoffinCase_Text_RaiseSmartness',
  poffinRaiseTough: 'PoffinCase_Text_RaiseToughness',
  /** {var 0} = the Poffin, {var 1} = its level. */
  poffinListItem: 'PoffinCase_Text_ListItem',
  /** {var 0} = the Pokémon. */
  poffinLiked: 'PoffinCutscene_Text_LikedPoffin',
  poffinDisliked: 'PoffinCutscene_Text_DislikedPoffin',
  poffinNeutral: 'PoffinCutscene_Text_NeutralToPoffin',
  /** The bag's cooking mode (decomp Bag_Text_PoffinCountLabel, Bag_Text_PoffinCountNum: {var 0} = the Poffins). */
  bagPoffinCount: 'Bag_Text_PoffinCountLabel',
  bagPoffinCountNum: 'Bag_Text_PoffinCountNum',
  bagConfirm: 'Bag_Text_Confirm',
  /** The Fashion Case's message (decomp Bag_Text_FashionCaseMessage: {var 0} accessories, {var 1} backdrops). */
  bagFashionCase: 'Bag_Text_FashionCaseMessage',
  /** {var 0} = the seals owned (decomp CalcTotalBallSeals). */
  bagSealCase: 'Bag_Text_SealCaseMessage',
  bagOpen: 'Bag_Text_Open',
  sumItem: 'PokemonSummary_Text_LabelItem',
  sumNone: 'PokemonSummary_Text_None',
  sumDexNo: 'PokemonSummary_Text_LabelDexNum',
  sumName: 'PokemonSummary_Text_LabelSpeciesName',
  sumType: 'PokemonSummary_Text_LabelType',
  sumOt: 'PokemonSummary_Text_LabelOTName',
  sumIdNo: 'PokemonSummary_Text_LabelOtId',
  sumExp: 'PokemonSummary_Text_LabelExp',
  sumToNext: 'PokemonSummary_Text_LabelExpNextLv',
  sumUnknown: 'PokemonSummary_Text_ThreeQuestionMarks',
  sumHp: 'PokemonSummary_Text_LabelHp',
  sumAttack: 'PokemonSummary_Text_LabelAttack',
  sumDefense: 'PokemonSummary_Text_LabelDefense',
  sumSpAttack: 'PokemonSummary_Text_LabelSpAttack',
  sumSpDefense: 'PokemonSummary_Text_LabelSpDefense',
  sumSpeed: 'PokemonSummary_Text_LabelSpeed',
  sumAbility: 'PokemonSummary_Text_LabelAbility',
  sumPower: 'PokemonSummary_Text_LabelMovePower',
  sumAccuracy: 'PokemonSummary_Text_LabelMoveAccuracy',
  sumThreeDashes: 'PokemonSummary_Text_ThreeDashes',
  sumTwoDashes: 'PokemonSummary_Text_TwoDashes',
  /** MOVE_NONE's name: TEXT_BANK_MOVE_NAMES (647) message 0, unnamed in the decomp. */
  sumNoMove: 'text/647/0',
  sumMoveInfo: 'PokemonSummary_Text_SelectBattleMoveInfo',
  sumSwitch: 'PokemonSummary_Text_MoveSwitch',
  sumHmCantForget: 'PokemonSummary_Text_HmMovesCantBeForgotten',
  sumRibbonCount: 'PokemonSummary_Text_LabelRibbonCount',
  sumRibbonInfo: 'PokemonSummary_Text_RibbonSelectInfo',
  sumRibbonCancel: 'PokemonSummary_Text_RibbonSelectCancel',
  sumRibbonSlash: 'PokemonSummary_Text_RibbonNumberSlash',
  sumPhysical: 'BattleParty_Text_MoveCategoryPhysical',
  sumSpecial: 'BattleParty_Text_MoveCategorySpecial',
  sumStatus: 'BattleParty_Text_MoveCategoryStatus',

  pcDeposit: 'MenuEntries_Text_PC_DepositPokemon',
  pcWithdraw: 'MenuEntries_Text_PC_WithdrawPokemon',
  pcMove: 'MenuEntries_Text_PC_MovePokemon',
  pcItems: 'MenuEntries_Text_PC_MoveItems',
  pcCompare: 'MenuEntries_Text_PC_ComparePokemon',
  pcSeeYa: 'MenuEntries_Text_PC_SeeYa',
  boxPartyFull: 'BoxText_PartyFull',
  boxLastMon: 'BoxText_LastMon',
  boxBoxFull: 'BoxText_BoxFull',
  boxBagFull: 'BoxText_BagFull',
  boxConfirmExit: 'BoxText_ConfirmExit',
  boxPickDepositBox: 'BoxText_PickDepositBox',
  boxNoItem: 'BoxText_NoItem',
  boxNoItemLabel: 'BoxText_NoItem',
  boxEggNoItem: 'BoxText_EggsCantHoldItems',
  /** {var 0} = item. */
  boxPutAway: 'BoxText_PutAwayItem',
  boxPlacedInBag: 'BoxText_PlaceItemInBag',
  boxNature: 'BoxText_Nature',
  boxLevel: 'BoxText_Level',
  /** RELEASE and MARK; {var 0} = the Pokémon. */
  boxMarkMon: 'BoxText_MarkMon',
  boxReleaseMon: 'BoxText_ReleaseMon',
  boxMonReleased: 'BoxText_MonReleased',
  boxGoodbye: 'BoxText_GoodbyeForever',
  boxMonReturned: 'BoxText_MonReturned',
  boxMonWorried: 'BoxText_MonWasWorried',
  boxCantReleaseEgg: 'BoxText_CantReleaseEgg',
  boxRemoveMail: 'BoxText_RemoveMail',
  boxDetachCapsule: 'BoxText_DetachBallCapsule',
  /** The compare panel's row names. */
  boxHp: 'BoxText_HP',
  boxAttack: 'BoxText_Attack',
  boxDefense: 'BoxText_Defense',
  boxSpAttack: 'BoxText_SpecialAttack',
  boxSpDefense: 'BoxText_SpecialDefense',
  boxSpeed: 'BoxText_Speed',
  boxMove: 'BoxText_Move',
  boxQuestionMarks: 'BoxText_QuestionMarks',

  namePlayer: 'NamingScreen_Text_PlayerPrompt',
  nameRival: 'NamingScreen_Text_FriendNamePrompt',
  /** {var 0} = species. */
  namePokemon: 'NamingScreen_Text_PokemonPrompt',
  nameBox: 'NamingScreen_Text_BoxPrompt',
  /** Route 224's tablet (decomp NAMING_SCREEN_TYPE_SHAYMIN_TABLET). */
  nameTablet: 'NamingScreen_Text_ThanksPrompt',
  nameBack: 'pl_msg_pokedex_back',
  nameOk: 'PokemonSummary_Text_SelectBattleMoveOk',

  cardIdNo: 'TrainerCard_Text_IDNo',
  cardName: 'TrainerCard_Text_Name',
  cardMoney: 'TrainerCard_Text_Money',
  cardPokedex: 'TrainerCard_Text_Pokedex',
  cardTime: 'TrainerCard_Text_Time',
  /** {var 5} = amount. */
  cardMoneyFormat: 'TrainerCard_Text_Format_Money',
  /** {var 0} = hours, {var 1} = minutes. */
  cardTimeFormat: 'TrainerCard_Text_Format_HHMMWithColon',
  cardScore: 'TrainerCard_Text_Score',
  cardStarted: 'TrainerCard_Text_AdventureStarted',
  cardHallOfFame: 'TrainerCard_Text_HallOfFameDebut',
  cardTimesLinked: 'TrainerCard_Text_TimesLinked',
  cardLinkBattles: 'TrainerCard_Text_LinkBattles',
  cardLinkTrades: 'TrainerCard_Text_LinkTrades',
  cardW: 'TrainerCard_Text_W',
  cardL: 'TrainerCard_Text_L',
  cardBlankDate: 'TrainerCard_Text_BlankDate',
  /** {var 2} = year (2 digits), {var 3} = month, {var 4} = day. */
  cardDate: 'TrainerCard_Text_Format_MMDD20YY',
  /** {var 5} = number. */
  cardNumber: 'TrainerCard_Text_Format_Number_1',
  /** The signature app (decomp TEXT_BANK_DRAWING). */
  signPrompt: 'Drawing_Text_WriteYourAutograph',
  signOk: 'Drawing_Text_IsThisOK',
  signRedo: 'Drawing_Text_RedoAutographPrompt',
  signDone: 'Drawing_Text_Done',

  saveAsk: 'CommonStrings_Text_WouldYouLikeToSave',
  /** {var 0} = player name. */
  saveDone: 'CommonStrings_Text_PlayerSavedTheGame',
  savePlayer: 'pl_msg_00000534_00001',
  saveBadges: 'pl_msg_00000534_00002',
  savePokedex: 'pl_msg_00000534_00003',
  saveTime: 'pl_msg_00000534_00004',
  yes: 'OptionsMenu_Text_ConfirmDialogYes',
  no: 'OptionsMenu_Text_ConfirmDialogNo',

  optionsTitle: 'OptionsMenu_Text_Title',
  optTextSpeed: 'OptionsMenu_Text_TextSpeedLabel',
  optTextSpeedDesc: 'OptionsMenu_Text_TextSpeedDescription',
  optSlow: 'OptionsMenu_Text_TextSpeedSlow',
  optMid: 'OptionsMenu_Text_TextSpeedMid',
  optFast: 'OptionsMenu_Text_TextSpeedFast',
  optBattleScene: 'OptionsMenu_Text_BattleSceneLabel',
  optBattleSceneDesc: 'OptionsMenu_Text_BattleSceneDescription',
  optOn: 'OptionsMenu_Text_BattleSceneOn',
  optOff: 'OptionsMenu_Text_BattleSceneOff',
  optBattleStyle: 'OptionsMenu_Text_BattleStyleLabel',
  optBattleStyleDesc: 'OptionsMenu_Text_BattleStyleDescription',
  optShift: 'OptionsMenu_Text_BattleStyleShift',
  optSet: 'OptionsMenu_Text_BattleStyleSet',
  optSound: 'OptionsMenu_Text_SoundModeLabel',
  optSoundDesc: 'OptionsMenu_Text_SoundModeDescription',
  optStereo: 'OptionsMenu_Text_SoundModeStereo',
  optMono: 'OptionsMenu_Text_SoundModeMono',
  optButtonMode: 'OptionsMenu_Text_ButtonModeLabel',
  optButtonModeDesc: 'OptionsMenu_Text_ButtonModeDescription',
  optButtonNormal: 'OptionsMenu_Text_ButtonModeNormal',
  optButtonStartX: 'OptionsMenu_Text_ButtonModeStartIs_x',
  optButtonLA: 'OptionsMenu_Text_ButtonMode_l_is_a',
  optFrame: 'OptionsMenu_Text_MessageBoxStyleLabel',
  optFrameDesc: 'OptionsMenu_Text_MessageBoxStyleDescription',
  /** Ours, not the DS's (the base pack's modern option labels). */
  optTradeEvolution: 'Lantern_Options_TradeEvolution',
  optTradeEvolutionDesc: 'Lantern_Options_TradeEvolutionDescription',
  optFollowers: 'Lantern_Options_Followers',
  optFollowersDesc: 'Lantern_Options_FollowersDescription',
  optFollowerStyle: 'Lantern_Options_FollowerStyle',
  optFollowerStyleDesc: 'Lantern_Options_FollowerStyleDescription',
  optFollowerStill: 'Lantern_Options_FollowerStill',
  optFollowerWalk: 'Lantern_Options_FollowerWalk',
  optAutoLowercase: 'Lantern_Options_AutoLowercase',
  optAutoLowercaseDesc: 'Lantern_Options_AutoLowercaseDescription',
  optAutoRun: 'Lantern_Options_AutoRun',
  optAutoRunDesc: 'Lantern_Options_AutoRunDescription',
  optRepelPrompt: 'Lantern_Options_RepelPrompt',
  optRepelPromptDesc: 'Lantern_Options_RepelPromptDescription',
  optItemWheel: 'Lantern_Options_ItemWheel',
  optItemWheelDesc: 'Lantern_Options_ItemWheelDescription',
  optFollowerTalk: 'Lantern_Options_FollowerTalk',
  optFollowerTalkDesc: 'Lantern_Options_FollowerTalkDescription',
  optStatView: 'Lantern_Options_StatView',
  optStatViewDesc: 'Lantern_Options_StatViewDescription',
  optRename: 'Lantern_Options_Rename',
  optRenameDesc: 'Lantern_Options_RenameDescription',
  optDexNameSearch: 'Lantern_Options_DexNameSearch',
  optDexNameSearchDesc: 'Lantern_Options_DexNameSearchDescription',
  optCharacter: 'Lantern_Options_Character',
  optCharacterDesc: 'Lantern_Options_CharacterDescription',
  optCharacterPlatinum: 'Lantern_Options_CharacterPlatinum',
  optCharacterHgss: 'Lantern_Options_CharacterHgss',
  /** The QoL additions inside the game's screens (OpenSinnoh, not Platinum). {var 0} = the item. */
  repelUseAnother: 'Lantern_Repel_UseAnother',
  dexByName: 'Lantern_Pokedex_ByName',
  nameDexSearch: 'Lantern_Naming_DexSearch',
  sumRename: 'Lantern_Summary_Rename',
  /** {var 0} = the Pokémon. */
  sumCantRename: 'Lantern_Summary_CantRename',
  sumStatsView: 'Lantern_Summary_Stats',
  sumEvsView: 'Lantern_Summary_Evs',
  sumIvsView: 'Lantern_Summary_Ivs',
  optSpiritombVendors: 'Lantern_Options_SpiritombVendors',
  optSpiritombVendorsDesc: 'Lantern_Options_SpiritombVendorsDescription',
  optObjective: 'OpenSinnoh_Options_Objective',
  optObjectiveDesc: 'OpenSinnoh_Options_ObjectiveDescription',
  optClose: 'OptionsMenu_Text_CloseLabel',
  optCloseDesc: 'OptionsMenu_Text_CloseDescription',

  dexSeen: 'pl_msg_pokedex_seen',
  dexObtained: 'pl_msg_pokedex_obtained',
  dexHt: 'pl_msg_pokedex_ht',
  dexWt: 'pl_msg_pokedex_wt',
  dexBack: 'pl_msg_pokedex_back',

  martWelcome: shop(0),
  martComeAgain: shop(1),
  martAnythingElse: shop(2),
  martNoMoney: shop(3),
  /** {var 0} = item. */
  martHowMany: shop(4),
  /** {var 0} = item, {var 1} = count, {var 2} = money. */
  martConfirm: shop(5),
  /** {var 0} = item (plural when more than one), {var 1} = pocket. Two pages. */
  martThanks: shop(6),
  martNoRoom: shop(7),
  martCancel: shop(8),
  /** {var 0} = price. */
  martPrice: shop(9),
  martPremier: shop(10),
  martBuy: shop(15),
  martSell: shop(16),
  martSeeYa: shop(17),
  martMoney: shop(18),
  /** {var 0} = money. */
  martMoneyValue: shop(19),
  /** {var 0} = count. */
  martInBag: shop(20),
  /** {var 0} = count, two digits. */
  martCount: shop(21),
  /** {var 0} = money. */
  martTotal: shop(22),
  martYes: shop(23),
  martNo: shop(24),
  /** {var 0} = TM item, {var 3} = its move, {var 1} = count, {var 2} = money. */
  martConfirmTm: shop(27),
  /** The exchange counter (MART_TYPE_FRONTIER): its YES / NO menu, goodbye, prices and purse in BP. */
  bpMenuYes: shop(29),
  bpMenuNo: shop(30),
  bpComeAgain: shop(31),
  /** {var 0} = BP. */
  bpPrice: shop(32),
  bpHowMany: shop(33),
  bpTotal: shop(34),
  /** {var 0} = item, {var 1} = count, {var 2} = BP. */
  bpConfirm: shop(35),
  /** {var 0} = TM item, {var 3} = its move, {var 1} = count, {var 2} = BP. */
  bpConfirmTm: shop(36),
  bpNotEnough: shop(37),
  bpValue: shop(38),
  /** The seal mart (MART_TYPE_SEAL): {var 0} = the seal (plural for more than one). */
  martSealPlaced: shop(13),
  martSealFull: shop(14),

  /** The Ball Capsule editor (decomp TEXT_BANK_UNK_0008). */
  capsuleEdit: capsule(0),
  capsuleQuit: capsule(1),
  capsuleSet: capsule(2),
  capsuleRemove: capsule(3),
  capsuleShift: capsule(4),
  capsuleConfirm: capsule(5),
  capsuleCancel: capsule(6),
  capsuleChoose: capsule(7),
  capsuleWhat: capsule(8),
  capsuleRemoved: capsule(9),
  capsuleSwitchWith: capsule(10),
  capsuleSwitched: capsule(11),
  capsuleFinished: capsule(12),
  capsuleConfirming: capsule(13),
  capsuleQuitAsk: capsule(14),
  capsuleNoRoom: capsule(15),
  capsuleNoSeals: capsule(16),

  /** {var 0} = Pokémon. */
  hatchHatched: 'EggHatch_Text_MonHatched',
  /** {var 0} = Pokémon. */
  hatchNickname: 'EggHatch_Text_WantToNickname',
  hatchYes: 'EggHatch_Text_Yes',
  hatchNo: 'EggHatch_Text_No',
} as const;

export type MenuKey = keyof typeof MENU_TEXT;

/** Markup → the characters a label shows: template slots expanded, formatting codes dropped; pages split on {clear}/{scroll}. */
export function plainPages(markup: string, slots: readonly string[] = []): string[] {
  const pages = [''];
  for (const t of expandTemplate(parseTextMarkup(markup), slots.map(plainMarkup))) {
    if (t.kind === 'chars') pages[pages.length - 1] += t.value;
    else if (t.kind === 'newline') pages[pages.length - 1] += '\n';
    else if (t.kind === 'clear' || t.kind === 'scroll') pages.push('');
  }
  return pages.filter((p, i) => p !== '' || i === 0);
}

/** One label: pages joined by line breaks. */
export function plainText(markup: string, slots: readonly string[] = []): string {
  return plainPages(markup, slots).join('\n');
}

export class MenuText {
  private readonly texts: Registries['texts'];
  readonly ns: string;
  /** Bag pocket names (`NewGame.pockets` order is the DS order). */
  readonly pocketIds: readonly string[];

  /** Checks that every menu message exists in the base pack (the newGame record's namespace). */
  constructor(registries: Pick<Registries, 'texts' | 'newGame'>, extra: readonly string[] = []) {
    this.texts = registries.texts;
    const game = newGameRecord(registries as Registries);
    this.ns = game.id.slice(0, game.id.indexOf(':'));
    this.pocketIds = game.pockets.map((p) => p.name);
    if (this.pocketIds.length !== POCKET_NAMES.length) throw new Error(`menus: ${this.pocketIds.length} bag pockets, the menus name ${POCKET_NAMES.length}`);
    const names = [...Object.values(MENU_TEXT), ...POCKET_NAMES, ...FRAME_TYPES, ...MONTHS, ...STAT_NAMES, ...extra];
    const missing = names.filter((n) => !this.texts.has(this.id(n)));
    if (missing.length) throw new Error(`menus: the ${this.ns} pack has no text for ${missing.map((n) => this.id(n)).join(', ')}`);
  }

  id(name: string): Id {
    return `${this.ns}:${name}` as Id;
  }

  /** A message by name in the base namespace. */
  message(name: string, ...slots: string[]): string {
    return plainText(this.texts.get(this.id(name))!.text, slots);
  }

  /** A message's pages by name in the base namespace. */
  messagePages(name: string, ...slots: string[]): string[] {
    return plainPages(this.markup(this.id(name)), slots);
  }

  /** A text record by id (item names, descriptions), slots expanded. */
  text(id: Id, ...slots: string[]): string {
    return plainText(this.markup(id), slots);
  }

  /** A label; slots are plain strings. */
  t(key: MenuKey, ...slots: string[]): string {
    return this.message(MENU_TEXT[key], ...slots);
  }

  /** A message's pages (a message box shows one at a time). */
  pages(key: MenuKey, ...slots: string[]): string[] {
    return plainPages(this.texts.get(this.id(MENU_TEXT[key]))!.text, slots);
  }

  /** `{var n}`-style templates: slot n set, the others empty. */
  slot(key: MenuKey, n: number, value: string): string {
    return this.t(key, ...Array.from({ length: n + 1 }, (_, i) => (i === n ? value : '')));
  }

  pocket(pocket: string): string {
    const i = this.pocketIds.indexOf(pocket);
    if (i < 0) throw new Error(`menus: unknown pocket ${pocket}`);
    return this.message(POCKET_NAMES[i]!);
  }

  frameType(i: number): string {
    return this.message(FRAME_TYPES[i]!);
  }

  /** A month name, 0 = January (decomp TEXT_BANK_MONTH_NAMES). */
  month(i: number): string {
    return this.message(MONTHS[i]!);
  }

  /** A stat name in HP, Attack, Defense, Speed, Sp. Atk, Sp. Def order. */
  statName(i: number): string {
    return this.message(STAT_NAMES[i]!);
  }

  private markup(id: Id): string {
    const rec = this.texts.get(id);
    if (!rec) throw new Error(`menus: unknown text ${id}`);
    return rec.text;
  }
}
