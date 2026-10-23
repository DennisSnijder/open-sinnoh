/**
 * Original strings for the menu screens (party, bag, summary, PC, naming, card, Pokédex) under the
 * Platinum message names packages/menus asks for. Wording is our own; only the slot layout matches. Also
 * the PC boxes' placeholder art (marks, compare pages) under the sheet paths the importer writes.
 */
import { encodePng } from './png.ts';

const pad = (n: number) => String(n).padStart(5, '0');
const NATURES = ['Even', 'Fierce', 'Sturdy', 'Swift', 'Clever'];

export const menuTexts: Record<string, string> = {
  PartyMenu_MoveToWhere: 'Swap with whom?',
  PartyMenu_Text_GiveToWhichMon: 'Hand it to whom?',
  PartyMenu_Text_UseOnWhichMon: 'Use it on whom?',
  PartyMenu_Text_UseOnWhichPokemon: 'Share with whom?',
  PartyMenu_Text_NotEnoughHP: 'Too tired to share.',
  PartyMenu_Text_ThisCantBeUsedOnThatPokemon: 'Not on that one.',
  PartyMenu_Text_TeachWhichMon: 'Teach whom?',
  PartyMenu_Text_PromptPokemon: 'What about\n{var 0}?',
  PartyMenu_Text_PromptEgg: 'What about\nthe shell?',
  PartyMenu_Text_DoWhatWithAnItem: 'Which gear\naction?',
  PartyMenu_Text_RestoreWhichMove: 'Refill which\nskill?',
  PartyMenu_Text_BoostPPOfWhichMove: 'Extend which\nskill?',
  PartyMenu_Text_Summary: 'DETAILS',
  PartyMenu_Text_Switch: 'SWAP',
  PartyMenu_Text_Item: 'GEAR',
  PartyMenu_Text_ItemGive: 'HAND',
  PartyMenu_Text_ItemTake: 'TAKE BACK',
  PartyMenu_Text_ContextCancel: 'BACK',
  PartyMenu_Text_Enter: 'JOIN',
  PartyMenu_Text_NoEntry: 'LEAVE',
  PartyMenu_Text_ConfirmButton: 'DONE',
  PartyMenu_Text_ChooseMonAndConfirm: 'Pick, then press DONE.',
  PartyMenu_Text_NotEntered: 'OUT',
  PartyMenu_Text_Banned: 'BARRED',
  PartyMenu_Text_EnteredFirst: '1ST',
  PartyMenu_Text_EnteredSecond: '2ND',
  PartyMenu_Text_EnteredThird: '3RD',
  PartyMenu_Text_EnteredFourth: '4TH',
  PartyMenu_Text_NoMoreThanOneMon: 'Only one may join.',
  PartyMenu_Text_NoMoreThanTwoMon: 'Only two may join.',
  PartyMenu_Text_NoMoreThanThreeMon: 'Only three may join.',
  PartyMenu_Text_NoMoreThanFourMon: 'Only four may join.',
  PartyMenu_Text_TwoMonAreNeeded: 'Pick two first.',
  PartyMenu_Text_ThreeMonAreNeeded: 'Pick three first.',
  PartyMenu_Text_FourMonAreNeeded: 'Pick four first.',
  PartyMenu_Text_IdenticalMonNotPermitted: 'No two of a kind.',
  PartyMenu_Text_SomeMonHoldingIdenticalItems: 'Two hold the same gear.',
  PartyMenu_Text_MustUseSameKindOfMon: 'Both must be one kind.',
  BattleFactoryApp_Text_ChoosePokemon: 'Pick rental\nnumber {var 0}.',
  BattleFactoryApp_Text_OkWithSelection: 'Keep these\n{var 0} rentals?',
  BattleFactoryApp_Text_Yes: 'KEEP',
  BattleFactoryApp_Text_No: 'UNDO',
  BattleFactoryApp_Text_Summary: 'DETAILS',
  BattleFactoryApp_Text_Rent: 'TAKE',
  BattleFactoryApp_Text_Cancel: 'BACK',
  BattleFactoryApp_Text_Remove: 'DROP',
  BattleFactoryApp_Text_ChooseExchange: 'Which one goes\nback?',
  BattleFactoryApp_Text_CancelTrade: 'Skip the\nswap?',
  BattleFactoryApp_Text_ChooseReceive: 'Which one do\nyou want?',
  BattleFactoryApp_Text_AcceptPokemon: 'Take this\none?',
  BattleFactoryApp_Text_Exchange: 'SWAP',
  BattleFactoryApp_Text_Back: 'RETURN',
  BattleHallScene_Text_ConfirmSelection: 'Face the {var 0} tile,\nlevel {var 1}?',
  BattleHallScene_Text_BattleHallMatron: 'Face the hall keeper?',
  BattleHallScene_Text_HallMatronApproaching: 'One moment!\nThe hall keeper wants a match.',
  BattleHallScene_Text_Yes: 'YES',
  BattleHallScene_Text_No: 'NO',
  PartyMenu_Text_EligibleForContest: 'READY',
  PartyMenu_Text_IneligibleForContest: 'NOT READY',
  Contest_Text_CoolContest: 'SHARP SHOW',
  Contest_Text_BeautyContest: 'GRACE SHOW',
  Contest_Text_CuteContest: 'CHARM SHOW',
  Contest_Text_SmartContest: 'WIT SHOW',
  Contest_Text_ToughContest: 'GRIT SHOW',
  Contest_Text_NormalRank: 'TIER 1',
  Contest_Text_GreatRank: 'TIER 2',
  Contest_Text_UltraRank: 'TIER 3',
  Contest_Text_MasterRank: 'TIER 4',
  Contest_Text_Practice: 'REHEARSAL',
  Contest_Text_Contest: 'SHOW',
  ContestCommon_Text_VisualCompetition: 'LOOKS ROUND',
  ContestCommon_Text_DanceCompetition: 'STEPS ROUND',
  ContestCommon_Text_ActingCompetition: 'STAGE ROUND',
  ContestResults_Text_JudgingCompleted: 'Scoring is done.{clear}Here come the results!',
  ContestResults_Text_VisualCompetitionResults: 'The looks round first.',
  ContestResults_Text_DanceCompetitionResults: 'Then the steps round.',
  ContestResults_Text_ActingCompetitionResults: 'And the stage round.',
  ContestResults_Text_TheWinnerIs: 'Top spot: No. {var 0}!\n{var 1} and {var 2}!',
  Lantern_Contest_Placeholder: '{var 0}\nStand-in round: scored by condition.',
  Lantern_Contest_Visual: 'LOOKS',
  Lantern_Contest_Dance: 'STEPS',
  Lantern_Contest_Acting: 'STAGE',
  Lantern_Contest_Total: 'SUM',
  PartyMenu_Text_AbleToLearn: 'CAN!',
  PartyMenu_Text_UnableToLearn: 'CANNOT',
  PartyMenu_Text_AlreadyLearned: 'KNOWS',
  Lantern_Options_TradeEvolution: 'SWAP GROWTH',
  Lantern_Options_TradeEvolutionDescription: 'Trade-only changes happen\nat a level-up instead.',
  Lantern_Options_FollowerStyle: 'FOLLOWER STYLE',
  Lantern_Options_FollowerStyleDescription: 'When you stop, your follower stands\nstill or walks in place.',
  Lantern_Options_FollowerStill: 'Still',
  Lantern_Options_FollowerWalk: 'Walk in place',
  Lantern_Options_AutoLowercase: 'Auto lowercase',
  Lantern_Options_AutoLowercaseDescription: 'Lowercase after the first letter.',
  Lantern_Options_SpiritombVendors: 'Spiritomb',
  Lantern_Options_SpiritombVendorsDescription: 'Vendors count for Spiritomb.',
  Lantern_Options_Followers: 'FOLLOW',
  Lantern_Options_FollowersDescription: 'Your lead creature walks\nbehind you.',
  Lantern_Options_AutoRun: 'AUTO-DASH',
  Lantern_Options_AutoRunDescription: 'Dash without holding B.',
  Lantern_Options_RepelPrompt: 'WARD PROMPT',
  Lantern_Options_RepelPromptDescription: 'Offer another ward when one ends.',
  Lantern_Options_ItemWheel: 'GEAR WHEEL',
  Lantern_Options_ItemWheelDescription: 'Hold Y for a wheel of gear.',
  Lantern_Options_FollowerTalk: 'COMPANION TALK',
  Lantern_Options_FollowerTalkDescription: 'Chat with your companion.',
  Lantern_Options_StatView: 'HIDDEN NUMBERS',
  Lantern_Options_StatViewDescription: 'Show the hidden numbers.',
  Lantern_Options_Rename: 'RENAME',
  Lantern_Options_RenameDescription: 'Rename from the details.',
  Lantern_Options_DexNameSearch: 'NAME LOOKUP',
  Lantern_Options_DexNameSearchDescription: 'Look up a typed name.',
  Lantern_Options_Character: 'LOOK',
  Lantern_Options_CharacterDescription: 'Your look outdoors.',
  Lantern_Options_CharacterPlatinum: 'HOME',
  Lantern_Options_CharacterHgss: 'AWAY',
  Lantern_Repel_UseAnother: 'Another {var 0}?',
  Lantern_Pokedex_ByName: 'TYPED',
  Lantern_Naming_DexSearch: 'Look up?',
  Lantern_Summary_Rename: 'RENAME',
  Lantern_Summary_CantRename: '{var 0} is not yours to rename.',
  Lantern_Summary_Stats: 'STATS',
  Lantern_Summary_Evs: 'EFFORT',
  Lantern_Summary_Ivs: 'GENES',
  PartyMenu_Text_AbleToEvolve: 'READY!',
  PartyMenu_Text_UnableToEvolve: 'NOT YET',
  PartyMenu_Text_LevelUp: '{var 0} climbed to\nlevel {var 1}.',
  PartyMenu_Text_MonLearnedMove2: '{var 0} picked up\n{var 1}!',
  PartyMenu_Text_LevelUpMaxHP: 'VIGOR',
  PartyMenu_Text_LevelUpAttack: 'POWER',
  PartyMenu_Text_LevelUpDefense: 'GUARD',
  PartyMenu_Text_LevelUpSpAttack: 'SPARK',
  PartyMenu_Text_LevelUpSpDefense: 'WARD',
  PartyMenu_Text_LevelUpSpeed: 'PACE',
  PartyMenu_Text_LevelUpStatIncrease: '+{var 0}',
  PartyMenu_Text_LevelUpNewStatValue: '{var 0}',
  PartyMenu_Text_MonWantsToLearnMove: '{var 0} wants to pick up\n{var 1}.{clear}But {var 0} already\nholds four skills.{clear}Drop one to make room for\n{var 1}?',
  PartyMenu_Text_StopTryingToTeachMove: 'Give up on teaching\n{var 1}?',
  PartyMenu_Text_MonDidNotLearnMove: '{var 0} skipped\n{var 1}.',
  PartyMenu_Text_WhichMoveShouldBeForgotten: 'Drop which skill?',
  PartyMenu_Text_MonForgotMove: 'One, two... done!{clear}{var 0} let go of\n{var 1}.{clear}Then...',
  PartyMenu_Text_MonLearnedMove: '{var 0} picked up\n{var 1}!',
  PartyMenu_Text_MonAndMoveAreNotCompatible: '{var 0} cannot use\n{var 1}.',
  PartyMenu_Text_MonAlreadyKnowsMove: '{var 0} already has\n{var 1}.',
  PartyMenu_Text_MonsHPWasRestored: '{var 0} got back\n{var 1} HP.',
  PartyMenu_Text_MonWasCuredOfPoison: '{var 0} shook off\nthe poison.',
  PartyMenu_Text_MonWasCuredOfParalysis: '{var 0} can move\nfreely again.',
  PartyMenu_Text_MonsBurnWasHealed: '{var 0}\nno longer burns.',
  PartyMenu_Text_MonWasThawedOut: '{var 0}\nwarmed up.',
  PartyMenu_Text_PPWasRestored: 'Skill uses refilled.',
  PartyMenu_Text_MonRegainedHealth: '{var 0}\nis back on its feet.',
  PartyMenu_Text_MonBecameHealthy: '{var 0}\nfeels fine now.',
  PartyMenu_Text_MovesPPIncreased: '{var 0} can be used\nmore often.',
  PartyMenu_Text_MonBaseStatRose: '{var 0} grew in\n{var 1}!',
  PartyMenu_Text_ItWontHaveAnyEffect: 'That would do nothing.',
  PartyMenu_Text_CantBeUsedUntilBadgeIsObtained: 'A new mark is needed first.',
  PartyMenu_Text_CantUseThatHere: 'Not here.',
  PartyMenu_Text_YoureAlreadySurfing: 'You are already afloat.',
  PartyMenu_Text_CantUseWhenYouHaveSomeoneWithYou: 'Not while someone walks\nwith you.',
  PartyMenu_Text_MonAlreadyHoldingItemsSwitchItems: '{var 0} carries\n{var 1}.{clear}Trade the two?',
  PartyMenu_Text_MonIsntHoldingAnything: '{var 0} carries\nnothing.',
  PartyMenu_Text_ReceivedItemFromMon: 'Took the {var 1}\nfrom {var 0}.',
  PartyMenu_Text_BagIsFull: 'The pack is full.',
  PartyMenu_Text_ItemWasTakenAndReplacedWithItem: 'Swapped the {var 1}\nfor the {var 2}.',
  PartyMenu_Text_MonWasGivenItem: '{var 0} now carries\nthe {var 1}.',
  PartyMenu_Text_ChangedForm: '{var 0} took on\na new shape!',
  PartyMenu_Text_MonWokeUp: '{var 0}\nwoke up.',
  BoxText_EggsCantHoldItems: 'A shell carries nothing.',
  PartyMenu_Text_MailStore: 'LEAVE',
  EggHatch_Text_MonHatched: '{var 0} broke out of the shell!',
  EggHatch_Text_WantToNickname: 'Give the newly hatched\n{var 0} a name?',
  EggHatch_Text_Yes: 'Yes',
  EggHatch_Text_No: 'No',

  // The move relearner / tutor screen (original wording).
  ...Object.fromEntries(
    (['Reminder', 'Tutor'] as const).flatMap((k) => [
      [`MoveReminder_Text_${k}_AskTeachWhichToMon`, 'Pick a move for\n{var 0}.'],
      [`MoveReminder_Text_${k}_AskShouldTeachMove`, 'Go with\n{var 1}?'],
      [`MoveReminder_Text_${k}_AskGiveUpTeachingMon`, 'Leave {var 0}\nas it is?'],
      [`MoveReminder_Text_${k}_LearnedMoveNoFanfare`, '{var 0} now knows\n{var 1}.{clear}'],
      [`MoveReminder_Text_${k}_AskMoreThanFourMoves`, '{var 0} wants {var 1}.{clear}But its head is full.{clear}Drop a move for {var 1}?'],
      [`MoveReminder_Text_${k}_12AndPoof`, 'Three, two, one... gone!{clear}{var 0} let go of\n{var 1}.{clear}Then...{clear}'],
      [`MoveReminder_Text_${k}_LearnedMoveFanfare`, '{var 0} now knows\n{var 1}.{clear}'],
      [`MoveReminder_Text_${k}_AskStopTryingToTeachMove`, 'Forget about\n{var 1}?'],
      [`MoveReminder_Text_${k}_MonDidNotLearnMove`, '{var 0} skipped\n{var 1}.{clear}'],
      [`MoveReminder_Text_${k}_AskForgetThisMove`, 'Drop {var 0}?'],
    ]),
  ),
  MoveReminder_Text_BattleMoves: 'MOVES',
  MoveReminder_Text_Category: 'KIND',
  MoveReminder_Text_Power: 'FORCE',
  MoveReminder_Text_Accuracy: 'AIM',
  MoveReminder_Text_Pp: 'USES',
  MoveReminder_Text_PowerValue: '{var 0}',
  MoveReminder_Text_AccuracyValue: '{var 0}',
  MoveReminder_Text_PpValue: '{var 0}/{var 0}',
  MoveReminder_Text_Cancel: 'BACK',
  MoveReminder_Text_Dashes: '--',
  // The trade scene (original wording).
  pl_msg_00000350_00000: '{var 0} goes off\nto {var 2}.',
  pl_msg_00000350_00001: 'So long, {var 0}!',
  pl_msg_00000350_00002: '{var 1} arrived\nfrom {var 2}.',
  pl_msg_00000350_00003: 'Look after {var 1}!',

  BattleParty_Text_MoveCategoryPhysical: 'BODY',
  BattleParty_Text_MoveCategorySpecial: 'MIND',
  BattleParty_Text_MoveCategoryStatus: 'OTHER',

  Bag_Text_Use: 'USE',
  Bag_Text_Plant: 'SOW',
  Bag_Text_Trash: 'DROP',
  Bag_Text_Register: 'PIN',
  Bag_Text_Deselect: 'UNPIN',
  Bag_Text_Give: 'HAND',
  Bag_Text_CloseBag: 'CLOSE PACK',
  Bag_Text_CloseBagDescription: 'Back to the field.',
  Bag_Text_Yes: 'YES',
  Bag_Text_No: 'NO',
  Bag_Text_ThrowAwayHowMany: 'Drop how many\n{var 0}?',
  Bag_Text_ThrowAwayCount: 'x{var 0}',
  Bag_Text_ThrowAwayOK: 'Drop {var 1}\n{var 0}?',
  Bag_Text_ThrewAwayItem: 'Dropped {var 1} {var 0}.',
  Bag_Text_BootedUpTM: 'Opened a lesson.',
  Bag_Text_BootedUpHM: 'Opened a field lesson.',
  Bag_Text_TMHMContainedMove: 'It teaches\n{var 0}.{clear}Teach {var 0}\nnow?',
  Bag_Text_UsedRepel: '{var 0} sprayed the\n{var 1}.',
  Bag_Text_RepelEffectsLinger: 'The last spray still works.',

  // Poffins and condition (0.31.0): our own wording.
  PokemonSummary_Text_PageTitleCondition: 'SHOWING',
  PokemonSummary_Text_LabelSheen: 'GLOSS',
  PokemonSummary_Text_FavoriteFood: 'BEST TREAT',
  PokemonSummary_Text_LikesItSpicy: 'Fond of hot.',
  PokemonSummary_Text_LikesItDry: 'Fond of crisp.',
  PokemonSummary_Text_LikesItSweet: 'Fond of honeyed.',
  PokemonSummary_Text_LikesItBitter: 'Fond of tart.',
  PokemonSummary_Text_LikesItSour: 'Fond of sharp.',
  PokemonSummary_Text_EatsAnything: 'Not picky.',
  PokemonSummary_Text_PoffinFeedOk: 'FEED',
  PokemonSummary_Text_CoolnessEnhanced: 'Flair went up!',
  PokemonSummary_Text_BeautyEnhanced: 'Grace went up!',
  PokemonSummary_Text_CutenessEnhanced: 'Charm went up!',
  PokemonSummary_Text_SmartnessEnhanced: 'Wit went up!',
  PokemonSummary_Text_ToughnessEnhanced: 'Grit went up!',
  PokemonSummary_Text_NothingChanged: 'No change at all.',
  PokemonSummary_Text_PokemonWontEatMore: 'It is too full to eat.',
  PoffinCase_Text_PoffinCase: 'TREAT TIN',
  PoffinCase_Text_Give: 'FEED',
  PoffinCase_Text_Trash: 'DROP',
  PoffinCase_Text_Back: 'BACK',
  PoffinCase_Text_Smooth: 'SOFT / {var 0}',
  PoffinCase_Text_Dummy: '',
  PoffinCase_Text_Close: 'SHUT',
  PoffinCase_Text_Discard: 'Drop this\n{var 0}?',
  PoffinCase_Text_ThrownOut: 'The {var 0} was\ndropped.',
  PoffinCase_Text_Spicy: 'HOT',
  PoffinCase_Text_Dry: 'CRISP',
  PoffinCase_Text_Sweet: 'HONEYED',
  PoffinCase_Text_Bitter: 'TART',
  PoffinCase_Text_Sour: 'SHARP',
  PoffinCase_Text_All: 'EVERY',
  PoffinCase_Text_RaiseCoolness: 'Adds flair.',
  PoffinCase_Text_RaiseBeauty: 'Adds grace.',
  PoffinCase_Text_RaiseCuteness: 'Adds charm.',
  PoffinCase_Text_RaiseSmartness: 'Adds wit.',
  PoffinCase_Text_RaiseToughness: 'Adds grit.',
  PoffinCase_Text_ListItem: '{var 0}{cursor_x 138}Lv. {var 1}',
  PoffinCutscene_Text_LikedPoffin: '{var 0} gobbled\nthe treat!',
  PoffinCutscene_Text_DislikedPoffin: '{var 0} nibbled the\ntreat with a frown...',
  PoffinCutscene_Text_NeutralToPoffin: '{var 0} ate the treat.',
  Bag_Text_PoffinCountLabel: 'Treats:',
  Bag_Text_PoffinCountNum: '{var 0}/100',
  Bag_Text_Confirm: 'PICK',
  Bag_Text_FashionCaseMessage: 'Trinkets: {var 0}\nScenes: {var 1}',
  Bag_Text_Open: 'LOOK',
  ...Object.fromEntries(
    Object.entries({
      1: 'In went the {var 0}!',
      3: 'Scorching! Keep stirring!',
      4: 'Too quick! It splashed!',
      5: 'Scorching! Faster!',
      6: 'Ease up a bit!',
      7: 'Go! Go!',
      9: 'TALLY',
      10: 'Time',
      11: '{var 0}:{var 1}:{var 2}',
      12: 'Splashed',
      13: '{var 0} time',
      14: 'Scorched',
      15: '{var 0} times',
      16: 'Treats baked:',
      17: '{var 3} Lv. {var 1} x {var 2}',
      20: '{var 0} stored the\n{var 3}(s) in the tin.',
      21: 'Bake more treats?',
      24: 'The treat tin is full.',
      25: 'No fruit left to bake.',
    }).map(([n, t]) => [`pl_msg_00000464_${pad(Number(n))}`, t]),
  ),
  ...Object.fromEntries(
    ['Hot', 'Hot-Crisp', 'Hot-Honeyed', 'Hot-Tart', 'Hot-Sharp', 'Crisp-Hot', 'Crisp', 'Crisp-Honeyed', 'Crisp-Tart', 'Crisp-Sharp', 'Honeyed-Hot', 'Honeyed-Crisp', 'Honeyed', 'Honeyed-Tart', 'Honeyed-Sharp',
      'Tart-Hot', 'Tart-Crisp', 'Tart-Honeyed', 'Tart', 'Tart-Sharp', 'Sharp-Hot', 'Sharp-Crisp', 'Sharp-Honeyed', 'Sharp-Tart', 'Sharp', 'Lavish', 'Mushy', 'Burnt', 'Gentle'].map((n, i) => [`pl_msg_00000465_${pad(i)}`, `${n} Treat`]),
  ),

  PokemonSummary_Text_PageTitleInfo: 'PROFILE',
  PokemonSummary_Text_PageTitleMemo: 'NOTES',
  PokemonSummary_Text_PageTitleSkills: 'STRENGTHS',
  PokemonSummary_Text_PageTitleBattleMoves: 'SKILLS',
  PokemonSummary_Text_PageTitleRibbons: 'SASHES',
  PokemonSummary_Text_LabelItem: 'Gear',
  PokemonSummary_Text_None: 'None',
  PokemonSummary_Text_LabelDexNum: 'Log No.',
  PokemonSummary_Text_LabelSpeciesName: 'Kind',
  PokemonSummary_Text_LabelType: 'Element',
  PokemonSummary_Text_LabelOTName: 'Partner',
  PokemonSummary_Text_LabelOtId: 'ID',
  PokemonSummary_Text_LabelExp: 'Growth',
  PokemonSummary_Text_LabelExpNextLv: 'Next Lv.',
  PokemonSummary_Text_ThreeQuestionMarks: '???',
  PokemonSummary_Text_LabelHp: 'HP',
  PokemonSummary_Text_LabelAttack: 'Power',
  PokemonSummary_Text_LabelDefense: 'Guard',
  PokemonSummary_Text_LabelSpAttack: 'Focus',
  PokemonSummary_Text_LabelSpDefense: 'Calm',
  PokemonSummary_Text_LabelSpeed: 'Pace',
  PokemonSummary_Text_LabelAbility: 'Trait',
  PokemonSummary_Text_LabelMovePower: 'POWER',
  PokemonSummary_Text_LabelMoveAccuracy: 'AIM',
  PokemonSummary_Text_ThreeDashes: '---',
  PokemonSummary_Text_TwoDashes: '--',
  'text/647/0': '-',
  PokemonSummary_Text_SelectBattleMoveInfo: 'INFO',
  PokemonSummary_Text_MoveSwitch: 'SWAP',
  PokemonSummary_Text_HmMovesCantBeForgotten: 'Field skills stay\nfor now.',
  PokemonSummary_Text_LabelRibbonCount: 'Sashes:',
  PokemonSummary_Text_RibbonSelectInfo: 'LOOK',
  PokemonSummary_Text_RibbonSelectCancel: 'DONE',
  PokemonSummary_Text_RibbonNumberSlash: '/',
  PokemonSummary_Text_SelectBattleMoveOk: 'OK',
  ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`pl_msg_00000455_${pad(24 + i)}`, `${NATURES[i % NATURES.length]} temper.`])),
  pl_msg_00000455_00049: 'Since {var 1} {var 2}, 20{var 0}\n{var 4}\nJoined at Lv. {var 3}.',
  pl_msg_00000455_00050: 'Since {var 1} {var 2}, 20{var 0}\n{var 4}\nSeemingly joined at Lv. {var 3}.',
  pl_msg_00000455_00052: 'Shell from {var 8}\n{var 6} {var 7}, 20{var 5}\nOpened at {var 4}\n{var 1} {var 2}, 20{var 0}',
  pl_msg_00000455_00053: 'Shell from {var 8}\n{var 6} {var 7}, 20{var 5}\nSeemingly opened at {var 4}\n{var 1} {var 2}, 20{var 0}',
  pl_msg_00000455_00101: '{var 6} {var 7}, 20{var 5}\nA shell handed over\nat {var 8}.',
  pl_msg_00000455_00102: '{var 6} {var 7}, 20{var 5}\nA shell found\nat {var 8}.',
  pl_msg_00000455_00105: 'Shell check:\nIt rattles. Any moment now!',
  pl_msg_00000455_00106: 'Shell check:\nIt rocks now and then.',
  pl_msg_00000455_00107: 'Shell check:\nIt sits quite still.',
  pl_msg_00000455_00108: 'Shell check:\nThis will take a long while.',
  ...Object.fromEntries(['Likes hot food.', 'Likes dry food.', 'Likes sweet food.', 'Likes bitter food.', 'Likes sour food.', 'Eats anything.'].map((t, i) => [`pl_msg_00000455_${pad(65 + i)}`, t])),
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`pl_msg_00000455_${pad(71 + i)}`, `${['Hardy', 'Bold', 'Steady', 'Quick', 'Sharp', 'Gentle'][Math.floor(i / 5)]} by nature (${(i % 5) + 1}).`])),

  MenuEntries_Text_PC_DepositPokemon: 'STORE COMPANIONS',
  MenuEntries_Text_PC_WithdrawPokemon: 'FETCH COMPANIONS',
  MenuEntries_Text_PC_MovePokemon: 'ARRANGE COMPANIONS',
  MenuEntries_Text_PC_MoveItems: 'ARRANGE GEAR',
  MenuEntries_Text_PC_SeeYa: 'LOG OFF',
  BoxText_PartyFull: 'Your team is full!',
  BoxText_LastMon: 'That one is your last!',
  BoxText_BoxFull: 'That crate is full.',
  BoxText_BagFull: 'The pack is full.',
  BoxText_ConfirmExit: 'Close the crates?',
  BoxText_PickDepositBox: 'Into which crate?',
  BoxText_NoItem: 'Nothing',
  BoxText_PutAwayItem: 'Pack away the {var 0}?',
  BoxText_PlaceItemInBag: 'Packed the {var 0}.',
  BoxText_Nature: 'TEMPER',
  BoxText_Level: 'Lv',
  MenuEntries_Text_PC_ComparePokemon: 'WEIGH COMPANIONS',
  BoxText_MarkMon: 'Tag your companion.',
  BoxText_ReleaseMon: 'Set this one free?',
  BoxText_MonReleased: '{var 0} went free.',
  BoxText_GoodbyeForever: 'Farewell, {var 0}!',
  BoxText_MonReturned: '{var 0} turned back!',
  BoxText_MonWasWorried: 'It did not want to leave you.',
  BoxText_CantReleaseEgg: 'A shell cannot go free.',
  BoxText_RemoveMail: 'Take the letter off first.',
  BoxText_HP: 'HP',
  BoxText_Attack: 'POWER',
  BoxText_Defense: 'GUARD',
  BoxText_SpecialAttack: 'FOCUS',
  BoxText_SpecialDefense: 'CALM',
  BoxText_Speed: 'PACE',
  BoxText_Move: 'SKILL',
  BoxText_QuestionMarks: '???',
  ...Object.fromEntries(['JUMP', 'BACKDROP', 'LABEL', 'BACK'].map((t, i) => [`pl_msg_00000018_${pad(24 + i)}`, t])),
  ...Object.fromEntries(['MEADOW', 'STONE', 'SHORE', 'MISC', 'FRIENDS A', 'FRIENDS B'].map((t, i) => [`pl_msg_00000018_${pad(28 + i)}`, t])),
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`pl_msg_00000018_${pad(34 + i)}`, `BACKDROP ${i + 1}`])),
  ...Object.fromEntries(
    ['GRAB', 'DROP', 'SWAP', 'DETAILS', 'FETCH', 'STORE', 'GEAR', 'MARK', 'LET GO', 'BACK', 'OK', 'BACK', 'HAND', 'TAKE', 'INFO', 'SWAP', 'PACK', 'BACK'].map((t, i) => [`pl_msg_00000018_${pad(58 + i)}`, t]),
  ),
  pl_msg_00000018_00076: 'LEFT',
  pl_msg_00000018_00077: 'RIGHT',
  pl_msg_00000018_00078: 'YES',
  pl_msg_00000018_00079: 'NO',

  NamingScreen_Text_PlayerPrompt: 'What is your name?',
  NamingScreen_Text_FriendNamePrompt: 'Your friend is called?',
  NamingScreen_Text_PokemonPrompt: 'A name for {var 0}?',
  NamingScreen_Text_BoxPrompt: 'Name this crate?',
  NamingScreen_Text_ThanksPrompt: 'Carve which word?',
  pl_msg_pokedex_back: 'BACK',

  TrainerCard_Text_Score: 'SCORE',
  TrainerCard_Text_AdventureStarted: 'SET OUT',
  TrainerCard_Text_HallOfFameDebut: 'HONOURED',
  TrainerCard_Text_TimesLinked: 'LINKS',
  TrainerCard_Text_LinkBattles: 'LINK MATCHES',
  TrainerCard_Text_LinkTrades: 'LINK SWAPS',
  TrainerCard_Text_W: 'W',
  TrainerCard_Text_L: 'L',
  TrainerCard_Text_BlankDate: '-- --, ----',
  TrainerCard_Text_Format_MMDD20YY: '{var 3} {var 4}, 20{var 2}',
  TrainerCard_Text_Format_Number_1: '{var 5}',
  Drawing_Text_WriteYourAutograph: 'Sign your name here.',
  Drawing_Text_IsThisOK: 'Keep this signature?',
  Drawing_Text_RedoAutographPrompt: 'Start the signature over?',
  Drawing_Text_Done: 'FINISH',
  pl_msg_pokedex_ht: 'HT',
  pl_msg_pokedex_wt: 'WT',
  ...Object.fromEntries(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((t, i) => [`pl_msg_00000414_${pad(i)}`, t])),
  ...Object.fromEntries(['HP', 'Power', 'Guard', 'Pace', 'Focus', 'Calm'].map((t, i) => [`pl_msg_00000551_${pad(i)}`, t])),
  ...castleTexts(),
};

/** The Battle Castle's apps (packages/menus frontier-castle.ts): our own words in the ROM's slot layout. */
function castleTexts(): Record<string, string> {
  const self: Record<string, string> = {
    PlayerName: '{var 0}', CastlePoints: '{var 0} PT', CastlePointsItemSelect: '{var 0} PT', ChoosePokemon: 'Pick a partner.', Exit: 'LEAVE',
    Heal: 'MEND', Rental: 'BORROW', Summary: 'DETAILS', Moves: 'SKILLS', Cancel: 'BACK', RestoreHPOrPP: 'Mend health or skill uses.',
    RentBerryOrItem: 'Borrow a fruit or a tool.', CheckStatsAndMore: 'See its strengths.', CheckMovesAndPP: 'See its skills.', GoBackToMonSelection: 'Pick again.',
    RestoreHP: 'HEALTH', RestorePP: 'SKILL USES', RestoreAll: 'BOTH', RankUp: 'GRADE UP', Cancel2: 'BACK', WhichToUse: 'Which one?',
    RankUpToRestorePP: 'A higher grade mends skill uses.', RankUpToRestoreHPAndPP: 'A higher grade mends both.', RankCannotBeRaised: 'The grade is at the top.', ReturnToPrevious: 'Go back.',
    Yes: 'YES', No: 'NO', NotEnoughCP: 'Not enough points.', HealRankTooLow: 'The mending grade is too low.', HPWillBeRestored: '{var 0} feels better.',
    PPWillBeRestored: '{var 0} can use its skills again.', HPAndPPWillBeRestored: '{var 0} is fully mended.', NoBenefit: 'That would do nothing.', RankUpForCP: 'Grade up for {var 0} PT?',
    NotEnoughCP2: 'Not enough points.', GainedAbilityToRestorePP: '{var 5} can mend skill uses now!', GainedAbilityToRestoreHPAndPP: '{var 5} can mend both now!',
    Berries: 'FRUIT', Items: 'TOOLS', RankUp2: 'GRADE UP', Cancel3: 'BACK', MayRentBerry: 'Borrow a fruit.', MayRentItem: 'Borrow a tool.',
    RankUpToRentItem: 'A higher grade lends tools.', RankUpToExpandChoices: 'A higher grade lends more.', RankCannotBeRaised2: 'The grade is at the top.', ReturnToPrevious2: 'Go back.',
    RentalRankTooLow: 'The lending grade is too low.', WillCostCP: 'That is {var 0} PT.\nAll right?', ItemGivenToMon: '{var 0} now holds\nthe {var 1}.',
    AlreadyHoldingItem: '{var 0} holds\n{var 1} already.', WantToSwitchItems: 'Swap the two?', GainedAbilityToRentItems: '{var 5} can borrow tools now!', ExpandedItemRentals: '{var 5} can borrow more now!',
  };
  const opponent: Record<string, string> = {
    CheckWhichPokemon: 'Look at which one?', Exit: 'LEAVE', Check: 'REVEAL', Level: 'SIZE', Summary: 'DETAILS', Cancel: 'BACK', CheckIdentity: 'Reveal who it is.',
    ChangeLevel: 'Change its size.', ExamineStats: 'Study it.', GoBackToMonSelection: 'Go back.', IdentifyForCP: 'Reveal it?\nThat is {var 0} PT.', IdentityRevealed: 'It is {var 0}.',
    MayChangeLevel: 'Change its size?', LevelUp5: 'BIGGER', LevelDown5: 'SMALLER', Cancel2: 'BACK', WillCostCP: 'That is {var 0} PT.\nAll right?', Yes: 'YES', No: 'NO',
    NotEnoughCP3: 'Not enough points.', LevelCantGoHigher: 'It cannot grow more.', LevelCantGoLower: 'It cannot shrink more.', LevelBoostedBy5: 'It grew.', LevelLoweredBy5: 'It shrank.',
    Summary2: 'STRENGTHS', Moves: 'SKILLS', RankUp: 'GRADE UP', Cancel3: 'BACK', CheckStats: 'See its strengths.', CheckMoveList: 'See its skills.',
    RankUpToCheckMoves: 'A higher grade shows skills.', CantRankUp: 'The grade is at the top.', ReturnToPreviousMenu: 'Go back.', TooLowForMoveList: 'The grade is too low.',
    CanCheckStats: 'See its strengths?\nThat is {var 0} PT.', NotEnoughCP: 'Not enough points.', MayCheckMoveList: 'See its skills?\nThat is {var 0} PT.', NotEnoughCP2: 'Not enough points.',
    RankUpForCP: 'Grade up for {var 0} PT?', GainedMoveListPurchasePower: '{var 5} can see skills now!',
  };
  const both: Record<string, string> = {
    Item: 'Holds', ItemValue: '{var 0}', Nature: 'Mood', NatureValue: '{var 0}', Ability: 'Gift', AbilityValue: '{var 0}', Attack: 'Power', AttackValue: '{var 0}',
    Defense: 'Guard', DefenseValue: '{var 0}', SpAttack: 'Focus', SpAttackValue: '{var 0}', SpDefense: 'Calm', SpDefenseValue: '{var 0}', Speed: 'Pace', SpeedValue: '{var 0}',
    MoveName1: '{var 0}', MoveName2: '{var 1}', MoveName3: '{var 2}', MoveName4: '{var 3}', MovePP: '{var 4}/{var 5}',
  };
  return {
    ...Object.fromEntries(Object.entries({ ...self, ...both }).map(([k, v]) => [`BattleCastleSelfApp_Text_${k}`, v])),
    ...Object.fromEntries(Object.entries({ ...opponent, ...both }).map(([k, v]) => [`BattleCastleOpponentApp_Text_${k}`, v])),
  };
}

/** Card colours per level (0–5 stars, then before the Pokédex), our own: fill, row band, text ink and shadow. */
const CARD_LEVELS: { name: string; fill: number[]; band: number[]; ink: string; shadow: string }[] = [
  { name: '0', fill: [92, 168, 156], band: [196, 232, 224], ink: '#303838', shadow: '#a0b0b0' },
  { name: '1', fill: [96, 140, 210], band: [204, 220, 246], ink: '#303838', shadow: '#a0a8b8' },
  { name: '2', fill: [184, 120, 80], band: [240, 214, 192], ink: '#303838', shadow: '#b0a098' },
  { name: '3', fill: [160, 168, 176], band: [226, 230, 234], ink: '#303838', shadow: '#a8a8a8' },
  { name: '4', fill: [212, 176, 60], band: [246, 232, 180], ink: '#303838', shadow: '#b0a880' },
  { name: '5', fill: [56, 56, 64], band: [104, 104, 112], ink: '#f8f070', shadow: '#303030' },
  { name: 'nodex', fill: [150, 120, 170], band: [226, 212, 236], ink: '#303838', shadow: '#a8a0b0' },
];
const CARD_W = 256;
const CARD_H = 192;

/**
 * Placeholder trainer card art in the importer's `trainer_case/card` layout (cells `front_<level>` then
 * `back_<level>`, 256×192 each, side by side): an outlined card, light bands where the rows go, a photo
 * frame on the front, a white signature box on the back and one notch per star.
 */
export function fixtureCard(): { png: Buffer; width: number; height: number; names: string[]; textColors: { fg: string; shadow: string }[] } {
  const sides = ['front', 'back'] as const;
  const width = CARD_W * CARD_LEVELS.length * sides.length;
  const rgba = new Uint8Array(width * CARD_H * 4);
  const rect = (ox: number, x: number, y: number, w: number, h: number, c: number[]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) rgba.set([c[0]!, c[1]!, c[2]!, 255], (yy * width + ox + xx) * 4);
  };
  const names: string[] = [];
  const textColors: { fg: string; shadow: string }[] = [];
  sides.forEach((side, s) =>
    CARD_LEVELS.forEach((level, l) => {
      const ox = (s * CARD_LEVELS.length + l) * CARD_W;
      rect(ox, 4, 4, CARD_W - 8, CARD_H - 8, [72, 72, 80]);
      rect(ox, 6, 6, CARD_W - 12, CARD_H - 12, level.fill);
      const rows = side === 'front' ? [[32, 136], [48, 136], [72, 136], [96, 136], [120, 136], [144, 224], [160, 224]] : [[16, 224], [32, 224], [56, 224], [72, 224], [88, 224]];
      for (const [y, w] of rows) rect(ox, 14, y! + 1, w! + 4, 14, level.band);
      if (side === 'front') {
        rect(ox, 166, 46, 68, 80, [72, 72, 80]);
        rect(ox, 168, 48, 64, 76, level.band);
      } else rect(ox, 30, 110, 196, 68, [252, 252, 248]);
      const stars = Number(level.name) || 0;
      for (let i = 0; i < stars; i++) rect(ox, 236 - i * 10, 12, 6, 6, [248, 232, 96]);
      names.push(`${side}_${level.name}`);
      textColors.push({ fg: level.ink, shadow: level.shadow });
    }),
  );
  return { png: encodePng(width, CARD_H, rgba), width, height: CARD_H, names, textColors };
}

// ---------- PC box art (original placeholders for the sheets the importer writes from box.narc) ----------

type Rgb = [number, number, number];

class Canvas {
  readonly rgba: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rgba = new Uint8Array(width * height * 4);
  }
  set(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.rgba.set([...c, 255], (y * this.width + x) * 4);
  }
  rect(x0: number, y0: number, w: number, h: number, c: Rgb): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }
}

/** The six marks as 8×8 bitmaps (circle, triangle, square, heart, star, diamond); '#' is ink. */
const MARK_SHAPES = [
  ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'],
  ['...##...', '...##...', '..####..', '..####..', '.######.', '.######.', '########', '########'],
  ['........', '.######.', '.######.', '.######.', '.######.', '.######.', '.######.', '........'],
  ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],
  ['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '##....##', '........'],
  ['...##...', '..####..', '.######.', '########', '########', '.######.', '..####..', '...##...'],
];

/** `ui2d/box/markings.png`: 12 cells of 8×8 in a row, 6 marked (dark) then 6 unmarked (grey). */
function markings(): Buffer {
  const c = new Canvas(96, 8);
  const inks: Rgb[] = [
    [40, 44, 60],
    [176, 176, 184],
  ];
  inks.forEach((ink, row) => MARK_SHAPES.forEach((shape, i) => shape.forEach((line, y) => [...line].forEach((ch, x) => ch === '#' && c.set((row * 6 + i) * 8 + x, y, ink)))));
  return encodePng(c.width, c.height, c.rgba);
}

/** A compare page (256×192): sky stripes, a blue left and an orange right column; contest: a pentagon panel. */
function comparePage(page: 'stats' | 'contest' | 'moves'): Buffer {
  const c = new Canvas(256, 192);
  for (let y = 0; y < 192; y++) c.rect(0, y, 256, 1, y % 4 < 2 ? [200, 232, 248] : [184, 222, 244]);
  if (page === 'contest') {
    c.rect(24, 8, 64, 16, [48, 112, 224]);
    c.rect(168, 8, 64, 16, [232, 112, 48]);
    c.rect(20, 36, 216, 120, [232, 236, 252]);
    const pts = [0, 1, 2, 3, 4].map((k) => [128 + Math.round(46 * Math.sin((k * 2 * Math.PI) / 5)), 100 - Math.round(46 * Math.cos((k * 2 * Math.PI) / 5))] as const);
    pts.forEach(([x, y], k) => {
      const [nx, ny] = pts[(k + 1) % 5]!;
      c.line(x, y, nx, ny, [96, 96, 112]);
      c.line(128, 100, x, y, [200, 200, 216]);
    });
  } else {
    c.rect(24, 4, 72, 180, [48, 112, 224]);
    c.rect(160, 4, 72, 180, [232, 112, 48]);
    for (let r = 0; r < (page === 'stats' ? 8 : 1); r++) c.rect(104, 34 + r * 16, 48, 10, [72, 216, 176]);
  }
  return encodePng(c.width, c.height, c.rgba);
}

interface SheetRecord {
  id: string;
  atlas: string;
  cells: { x: number; y: number; w: number; h: number; ox: number; oy: number }[];
}

/** The fixture's PC box sheets: files (pack paths) and their `ui2d` records. */
export function fixtureBoxArt(id: (s: string) => string): { files: Record<string, Buffer>; records: SheetRecord[] } {
  const files: Record<string, Buffer> = { 'ui2d/box/markings.png': markings() };
  const records: SheetRecord[] = [{ id: id('ui2d/box/markings'), atlas: id('ui2d/box/markings.png'), cells: Array.from({ length: 12 }, (_, i) => ({ x: i * 8, y: 0, w: 8, h: 8, ox: 0, oy: 0 })) }];
  for (const page of ['stats', 'contest', 'moves'] as const) {
    files[`ui2d/box/compare_${page}.png`] = comparePage(page);
    records.push({ id: id(`ui2d/box/compare_${page}`), atlas: id(`ui2d/box/compare_${page}.png`), cells: [{ x: 0, y: 0, w: 256, h: 192, ox: 0, oy: 0 }] });
  }
  return { files, records };
}

/**
 * Original placeholder ribbons (sashes) for the summary's RIBBONS page: texts per ribbon id and a
 * `ui2d/summary/ribbons` sheet whose cell i is ribbon i, a 32×32 rosette in its own colours.
 */
const SASHES: [string, string, [number, number, number]][] = [
  ['Lantern Sash', 'Given for lighting the\nfirst lantern.', [232, 184, 64]],
  ['Brave Sash', 'Given for a bold\nfirst outing.', [216, 88, 72]],
  ['Calm Sash', 'Given for keeping calm\nin a storm.', [88, 136, 216]],
  ['Leaf Sash', 'Given for a long walk\nthrough the woods.', [96, 176, 88]],
  ['Tide Sash', 'Given for crossing\nthe bay.', [64, 168, 184]],
  ['Stone Sash', 'Given for climbing\nthe ridge.', [152, 128, 104]],
  ['Frost Sash', 'Given for braving\nthe snowfield.', [176, 216, 240]],
  ['Ember Sash', 'Given for tending\nthe hearth.', [232, 120, 48]],
  ['Bloom Sash', 'Given for a garden\nin full flower.', [224, 136, 184]],
  ['Dusk Sash', 'Given for a walk\nat nightfall.', [120, 96, 168]],
  ['Dawn Sash', 'Given for rising\nwith the sun.', [248, 208, 136]],
  ['Rain Sash', 'Given for a day\nin the rain.', [104, 152, 176]],
  ['Wind Sash', 'Given for a kite\nthat flew high.', [184, 224, 176]],
  ['Echo Sash', 'Given for a song\nin the cave.', [168, 168, 184]],
  ['Star Sash', 'Given for counting\nthe stars.', [248, 232, 112]],
  ['Friend Sash', 'Given for a good\nfriendship.', [240, 160, 136]],
];

export const ribbonTexts: Record<string, string> = Object.fromEntries(SASHES.flatMap(([name, desc], i) => [[`Ribbon_Name_${i}`, name], [`Ribbon_Desc_${i}`, desc]]));
export const ribbonRecords = SASHES.map((_, i) => ({ name: `Ribbon_Name_${i}`, description: `Ribbon_Desc_${i}` }));

/** The atlas (cells side by side) and its cells, origin at the centre as on the DS. */
export function fixtureRibbonSheet(): { width: number; height: number; rgba: Uint8Array; cells: { x: number; y: number; w: number; h: number; ox: number; oy: number }[] } {
  const S = 32;
  const width = S * SASHES.length;
  const rgba = new Uint8Array(width * S * 4);
  const put = (x: number, y: number, c: readonly number[]) => rgba.set([...c, 255], (y * width + x) * 4);
  const shade = (c: readonly number[], k: number) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  SASHES.forEach(([, , color], i) => {
    const ox = i * S;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const [dx, dy] = [x + 0.5 - 16, y + 0.5 - 12];
        const r = Math.hypot(dx, dy);
        // two tails below the rosette
        const tail = y >= 18 && y < 31 && ((x >= 9 && x < 15 && x - 9 >= (y - 18) / 3) || (x >= 17 && x < 23 && 23 - x > (y - 18) / 3));
        if (r <= 10) put(ox + x, y, r > 9 ? [44, 40, 52] : r <= 5 ? shade(color, 1.25) : (Math.atan2(dy, dx) * 8) / Math.PI % 2 < 1 ? color : shade(color, 0.8));
        else if (tail) put(ox + x, y, x === 9 || x === 22 ? [44, 40, 52] : shade(color, 0.7));
      }
  });
  return { width, height: S, rgba, cells: SASHES.map((_, i) => ({ x: i * S, y: 0, w: S, h: S, ox: 16, oy: 16 })) };
}
