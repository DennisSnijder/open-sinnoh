/**
 * Battle messages from the packs' texts: the battle strings bank (Platinum pl_msg 368,
 * `<ns>:BattleStrings_Text_<name>`, decomp battle_strings.gmm names), "X used Y!" from
 * TEXT_BANK_MOVES_USED_IN_BATTLE (3 per move: ally, wild, foe) and the stat names from
 * TEXT_BANK_POKEMON_STAT_NAMES. The fixture pack carries original strings under the same names.
 */
import { parseTextMarkup, printTextMarkup, type Move, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/** Which side's wording a message takes: the player's (`Ally`), a wild foe's, a trainer's foe's. */
export type Who = 'Ally' | 'Wild' | 'Foe';
/** Two battlers' wordings, for the messages that name two Pokémon (`PokemonWasWrappedByPokemon_AllyFoe`). */
export type WhoPair = `${Who}${Who}`;
/** The pairs the battle strings have (decomp: no wild-on-foe or foe-on-wild). */
const PAIRS: WhoPair[] = ['AllyAlly', 'AllyWild', 'AllyFoe', 'WildAlly', 'WildWild', 'FoeAlly', 'FoeFoe'];

/**
 * The battle strings the controller prints (decomp battle_strings.gmm names), and whether each comes in
 * `_Ally`/`_Wild`/`_Foe` versions. Checked when a battle starts, so a pack missing one fails at once.
 */
export const BATTLE_STRINGS: Record<string, boolean> = {
  AWildPokemonAppeared: false,
  TheFogIsDeep: false,
  PokemonBlewAwayTheDeepFogWithMove: true,
  TheDimensionsBecameDistorted: false,
  TheTwistedDimensionsReturnedToNormal: false,
  GoPokemon: false,
  WhatWillPokemonDo: false,
  GotAwaySafely: false,
  // A frontier battle's RUN.
  WouldYouLikeToForfeitTheMatchAndQuitNowYesNo: false,
  PlayerForfeitedTheMatch: false,
  CantEscape: false,
  // A roamer's escape.
  TheWildPokemonFled: false,
  PokemonCantEscape: true,
  ACriticalHit: false,
  ItsSuperEffective: false,
  ItsNotVeryEffective: false,
  ButItFailed: false,
  PlayerBlackedOut: false,
  PokemonGainedExpPoints: false,
  PokemonGainedABoostedExpPoints: false,
  PokemonGrewToLevel: false,
  PokemonLearnedMove: false,
  // The move-learn questions (decomp SEQ_GET_EXP_*).
  PokemonWantsToLearnMove: false,
  ButPokemonCantLearnMoreThanFourMoves2: false,
  MakeItForgetAnotherMoveYesNo: false,
  WhichMoveShouldBeForgotten2: false,
  WellThen: false,
  ShouldPokemonGiveUpOnLearningMove: false,
  PokemonDidNotLearnMove2: false,
  BattleOneTwoAndPoof: false,
  BattlePokemonForgotHowToUseMove: false,
  BattleAndDotDotDot: false,
  BattlePokemonLearnedMove: false,
  // Trainer battles, the end of a battle, the catching tutorial.
  YouAreChallengedByTr: false,
  TrSentOutPokemon: false,
  TrWithdrewPokemon: false,
  TrUsedOneItem: false,
  NoTheresNoRunningFromATrainerBattle: false,
  PlayerDefeatedTr: false,
  PlayerGotMoneyForWinning: false,
  PlayerIsOutOfUsablePokemon: false,
  PlayerPaidOutMoneyToTheWinner: false,
  PlayerDroppedMoneyInPanic: false,
  BlackedOutDotDotDot: false,
  AllRightIGotItsHPDownTimeToThrowAPokeBall: false,
  OKTheGotIsHPDownTimeItsReadyForAPokeBall: false,
  PokemonFainted: true,
  ItDoesntAffectPokemon: true,
  PokemonIsHurtByPoison: true,
  PokemonIsHurtByItsBurn: true,
  PokemonsStatRose: true,
  PokemonsStatSharplyRose: true,
  PokemonsStatFell: true,
  PokemonsStatHarshlyFell: true,
  PokemonsStatWontGoHigher: true,
  PokemonsStatWontGoLower: true,
  PokemonIsParalyzedItMayBeUnableToMove: true,
  PokemonWasPoisoned: true,
  PokemonWasBadlyPoisoned: true,
  PokemonWasBurned: true,
  PokemonFellAsleep: true,
  PokemonWasFrozenSolid: true,
  PokemonIsParalyzedItCantMove: true,
  PokemonIsFastAsleep: true,
  PokemonIsFrozenSolid: true,
  // Bag, catching, switching.
  PlayerUsedOneItem: false,
  UsedTheItem: false,
  YourTeamBecameShroudedInAWhiteFog: false,
  PokemonIsGettingPumped: false,
  GotchaPokemonWasCaught: false,
  TheTrainerBlockedTheBall: false,
  DontBeAThief: false,
  PokemonsDataWasAddedToThePokedex: false,
  OhNoThePokemonBrokeFree: false,
  AwwItAppearedToBeCaught: false,
  AarghAlmostHadIt: false,
  ShootItWasSoCloseToo: false,
  PokemonWasTransferredToBoxInSomeonesPC: false,
  PokemonWasTransferredToBoxInBebesPC: false,
  BoxInSomeonesPCIsFullPokemonWasTransferredToOtherBoxInstead: false,
  BoxInBebesPCIsFullPokemonWasTransferredToOtherBoxInstead: false,
  UseNextPokemonYesNo: false,
  GiveANicknameToTheCaughtPokemonYesNo: false,
  PokemonSwitchOutComeBack: false,
  PokemonComeBack: false,
  PokemonGoodComeBack: false,
  PokemonOKComeBack: false,
  PokemonEnoughGetBack: false,
  YourFoesWeakGetEmPokemon: false,
  JustALittleMoreHangInTherePokemon: false,
  GoForItPokemon: false,
  YoureInChargePokemon: false,
  // The shift question.
  WillYouSwitchYourPokemon: false,
  // Doubles: two enemy trainers (decomp TAG, 2vs2), an AI partner's lead with the player's.
  YouAreChallengedByTr1AndTr2: false,
  Tr1SentOutPokemon1Tr2SentOutPokemon2: false,
  TrSentOutPokemon1GoPokemon2: false,
  PlayerBeatTr1AndTr2: false,
  // One trainer's two leads (973), the player's two (978), two wild Pokémon (967).
  TrSentOutPokemon1AndPokemon2: false,
  GoPokemon1AndPokemon2: false,
  AWildPokemonAndPokemonAppeared: false,
};

/**
 * The battle strings of the protocol lines the controller shows, by kind: plain, sided
 * (`_Ally`/`_Wild`/`_Foe`) or naming two battlers (`_AllyFoe` …, see `WhoPair`). Names and the battler order
 * of each follow the decomp subscript that prints it. Checked when a battle starts, like `BATTLE_STRINGS`.
 */
export const PROTOCOL_STRINGS: { plain: readonly string[]; sided: readonly string[]; pair: readonly string[]; species: readonly string[] } = {
  plain: [
    'ItHurtItselfInItsConfusion', 'HitXTimes', 'ButNothingHappened', 'ButThereWasNoTarget', 'ItsAOneHitKO', 'MagnitudeX', 'AllStatChangesWereEliminated',
    'ASoothingAromaWaftedThroughTheArea', 'ABellChimed', 'TheBattlersSharedTheirPain', 'AllPokemonHearingTheSongWillFaintInThreeTurns', 'GravityIntensified',
    'GravityReturnedToNormal', 'FirePowerWasWeakened', 'ElectricitysPowerWasWeakened', 'PokemonHasNoMovesLeft', 'CoinsScatteredEverywhere', 'ItSuckedUpTheLiquidOoze',
    // Magnet Rise's end: the foe's line has its own name.
    'PokemonsElectromagnetismWoreOff_Ally', 'PokemonsElectromagnetismWoreOff_Wild', 'TheElectromagnetismOfPokemonsWoreOff_Foe',
    'ItStartedToRain', 'RainContinuesToFall', 'TheRainStopped', 'TheSunlightTurnedHarsh', 'TheSunlightIsStrong', 'TheSunlightFaded',
    'ASandstormBrewed', 'TheSandstormRages', 'TheSandstormSubsided', 'ItStartedToHail', 'HailContinuesToFall', 'TheHailStopped',
    // Side conditions: the player's side's message, then the foe's (decomp TAG_NONE_SIDE_CONSCIOUS).
    'YourTeamBecameShroudedInMist', 'TheFoesTeamBecameShroudedInMist', 'YourTeamBecameCloakedInAMysticalVeil', 'TheFoesTeamBecameCloakedInAMysticalVeil',
    'YourTeamIsNoLongerProtectedBySafeguard', 'TheFoeIsNoLongerProtectedBySafeguard', 'TheTailwindBlewFromBehindYourTeam', 'TheTailwindBlewFromBehindTheFoe',
    'YourTeamsTailwindPeteredOut', 'TheFoesTailwindPeteredOut', 'TheLuckyChantShieldedYourTeamFromCriticalHits', 'TheLuckyChantShieldedTheFoeFromCriticalHits',
    'YourTeamsLuckyChantWoreOff', 'TheFoesLuckyChantWoreOff', 'SpikesWereScatteredAllAroundYourTeamsFeet', 'SpikesWereScatteredAllAroundTheFeetOfTheFoesTeam',
    'PoisonSpikesWereScatteredAllAroundYourTeamsFeet', 'PoisonSpikesWereScatteredAllAroundTheEnemyTeamsFeet', 'PointedStonesFloatInTheAirAroundYourTeam',
    'ThePoisonSpikesDisappearedFromAroundYourTeamsFeet', 'ThePoisonSpikesDisappearedFromAroundTheEnemyTeamsFeet',
    'PointedStonesFloatInTheAirAroundYourFoesTeam', 'MoveRaisedYourTeamsDefense', 'TheFoesMoveRaisedItsTeamsDefense', 'MoveRaisedYourTeamsSpecialDefense',
    'TheFoesMoveRaisedItsTeamsSpecialDefense', 'YourTeamsMoveEffectWoreOff', 'TheFoesMoveEffectWoreOff',
  ],
  sided: [
    'PokemonIsConfused', 'PokemonBecameConfused', 'PokemonBecameConfusedDueToFatigue', 'PokemonSnappedOutOfConfusion', 'PokemonFlinched', 'PokemonIsHitWithRecoil',
    'PokemonHadItsEnergyDrained', 'PokemonsHealthIsSappedByLeechSeed', 'PokemonWasSeeded', 'MoveRestoredPokemonsHP', 'PokemonAbsorbedWithItsRoots', 'PokemonPlantedItsRoots',
    'PokemonSurroundedItselfWithAVeilOfWater', 'PokemonIsBuffetedByTheWeather', 'PokemonIsAfflictedByTheCurse', 'PokemonIsHurtByMove', 'PokemonWasFreedFromMove',
    'PokemonWasTrappedInAVortex', 'PokemonWasTrappedBySandTomb', 'PokemonBecameTrappedBySwirlingMagma', 'PokemonIsHurtByTheSpikes', 'PointedStonesDugIntoPokemon',
    'PokemonRestoredItsHealthUsingItsItem', 'PokemonRestoredALittleHPUsingItsItem', 'PokemonIsHurtByItsItem', 'PokemonIsHurtByItsAbility', 'PokemonRestoredHPUsingItsAbility',
    // Doubles: Follow Me; an absorbing ability at full HP (decomp subscript_ability_restores_hp).
    'PokemonBecameTheCenterOfAttention', 'PokemonsAbilityMadeMoveUseless', 'PokemonShroudedItselfWithMagicCoat',
    'PokemonProtectedItself', 'PokemonProtectedItself2', 'PokemonBracedItself', 'PokemonEnduredTheHit', 'TheSubstituteTookDamageForPokemon', 'PokemonMadeASubstitute',
    'PokemonsSubstituteFaded', 'PokemonIsProtectedBySafeguard', 'PokemonIsProtectedByMist', 'PokemonIsStoringEnergy', 'PokemonUnleashedEnergy', 'PokemonFellForTheFeint',
    'PokemonIsGettingPumped', 'PokemonFellForTheTaunt', 'PokemonsTauntWoreOff', 'PokemonReceivedAnEncore', 'PokemonsEncoreEnded', 'PokemonsMoveWasDisabled',
    'PokemonIsNoLongerDisabled', 'PokemonForesawAnAttack', 'PokemonTookTheMoveAttack', 'PokemonFellInLove', 'PokemonIsImmobilizedByLove', 'PokemonLevitatedOnElectromagnetism',
    'PokemonWasPreventedFromHealing', 'PokemonsPerishCountFellToX', 'PokemonStockpiledX', 'PokemonCausedAnUproar', 'PokemonIsMakingAnUproar', 'PokemonCalmedDown',
    'PokemonsStockpiledEffectWoreOff', 'PokemonSwitchedItsAttackAndDefense', 'PokemonWokeUp', 'PokemonThawedOut', 'PokemonsItemCuredItsParalysis', 'PokemonsItemCuredItsPoison',
    'PokemonsItemCuredItsBurn', 'PokemonsItemDefrostedIt', 'PokemonsItemWokeItUp', 'PokemonNormalizedItsStatusUsingItsItem', 'PokemonMustRecharge',
    'PokemonCantUseMoveAfterTheTaunt', 'PokemonsMoveIsDisabled', 'PokemonCantUseTheSealedMove', 'PokemonLostItsFocusAndCouldntMove', 'PokemonIsTighteningItsFocus',
    'PokemonVanishedInstantly', 'PokemonSprangUp', 'PokemonBurrowedItsWayUnderTheGround', 'PokemonHidUnderwater', 'PokemonFlewUpHigh', 'PokemonAbsorbedLight', 'PokemonTuckedInItsHead',
    'PokemonWhippedUpAWhirlwind', 'PokemonBecameCloakedInAHarshLight', 'PokemonWasDraggedOut', 'PokemonIsExertingItsAbility', 'PokemonWasAbility',
    'PokemonsAbilityRaisedItsStat', 'PokemonsAbilityMadeItShudder', 'PokemonsAbilityMadeItRain', 'PokemonsAbilityIntensifiedTheSunsRays', 'PokemonsAbilityWhippedUpASandstorm',
    'PokemonsAbilityWhippedUpAHailstorm', 'PokemonMakesGroundMovesMissByUsingAbility', 'PokemonAvoidedDamageByUsingAbility', 'PokemonsAbilityRaisedThePowerOfItsFireTypeMoves',
    'PokemonsBeatUpAttack', 'PokemonFriskedItsFoeAndFoundOneItem', 'PokemonObtainedOneItem', 'PokemonCanNoLongerEscape', 'PokemonTransformedIntoType',
    'PokemonBeganChargingPower', 'PokemonWasSubjectedToTorment', 'ItReducedThePPOfPokemonsMoveByX', 'PokemonsWishCameTrue', 'PokemonStayedAwakeBecauseOfItsAbility',
    'PokemonSwitchedAllAttackChangesWithItsTarget', 'PokemonSwitchedAllDefenseChangesWithItsTarget', 'PokemonSwitchedStatChangesWithTheTarget',
    'PokemonCutItsOwnHPAndMaximizedItsAttack', 'PokemonsAbilityWasSuppressed', 'PokemonAcquiredAbility', 'PokemonSwappedAbilitiesWithItsTarget',
    // Slow Start (decomp subscript_slow_start, _end) and Flash Fire (subscript_absorb_and_boost_fire_type_moves).
    'PokemonCantGetItGoingBecauseOfItsAbility', 'PokemonFinallyGotItsActTogether', 'PokemonsAbilityMadeMoveIneffective',
    'PokemonsAbilityBlocksMove', 'PokemonSealedTheOpponentsMoves', 'PokemonCantUseItemsAnymore', 'PokemonCanUseItemsAgain', 'PokemonsMoveWoreOff', 'PokemonWantsTheFoeToBearAGrudge',
  ],
  pair: [
    'PokemonWasSqueezedByPokemon', 'PokemonWasWrappedByPokemon', 'PokemonClampedPokemon', 'PokemonIsInLoveWithPokemon', 'PokemonTookAimAtPokemon',
    'PokemonCutItsOwnHPAndLaidACurseOnPokemon', 'PokemonIdentifiedPokemon', 'PokemonMadePokemonDrowsy', 'PokemonsAbilityCutsPokemonsStat', 'PokemonsAbilityHurtPokemon',
    'PokemonWasHurtByPokemonsAbility', 'PokemonTracedPokemonsAbility', 'PokemonsAbilityInfatuatedPokemon', 'PokemonCopiedPokemonsStatChanges', 'PokemonCopiedPokemonsAbility',
    // Doubles: Helping Hand.
    'PokemonIsReadyToHelpPokemon',
  ],
  // A battler, then a species name (TAG_NICKNAME_POKE): by the battler's side only (`_AllyAlly`, `_WildAlly`, `_FoeAlly`).
  species: ['PokemonTransformedIntoPokemon'],
};
/**
 * Messages of the battle party sheet (decomp battle_party.gmm, `BattleParty_Text_<name>`): what a medicine
 * did (battle_party_text.c BattlePartyText_PrintUseItemEffect). We print them in the battle's textbox.
 */
export const PARTY_STRINGS = [
  'ItemRestoredHealth',
  'ItemCuredPoisoning',
  'ItemCuredParalysis',
  'ItemCuredBurn',
  'ItemCuredFreeze',
  'ItemRestoredPP',
  'ItemRevivedPokemon',
  'ItemCuredMultipleStatuses',
  'ItemCuredConfusion',
  'ItemCuredInfatuation',
  'ItemCuredSleep',
] as const;
export type PartyString = (typeof PARTY_STRINGS)[number];
/** The miss message is worded differently per side (decomp: _Ally, _Wild, then TheAttackOfPokemonMissed_Foe). */
export const MISSED = { Ally: 'PokemonsAttackMissed_Ally', Wild: 'PokemonsAttackMissed_Wild', Foe: 'TheAttackOfPokemonMissed_Foe' } as const;

/** Every battle string name as stored (`Name` or `Name_Ally`, …). */
export function battleStringNames(): string[] {
  return [
    ...Object.entries(BATTLE_STRINGS).flatMap(([name, sided]) => (sided ? ['Ally', 'Wild', 'Foe'].map((w) => `${name}_${w}`) : [name])),
    ...Object.values(MISSED),
    ...PROTOCOL_STRINGS.plain,
    ...PROTOCOL_STRINGS.sided.flatMap((name) => ['Ally', 'Wild', 'Foe'].map((w) => `${name}_${w}`)),
    ...PROTOCOL_STRINGS.pair.flatMap((name) => PAIRS.map((w) => `${name}_${w}`)),
    ...PROTOCOL_STRINGS.species.flatMap((name) => ['Ally', 'Wild', 'Foe'].map((w) => `${name}_${w}Ally`)),
  ];
}

/** Stat names bank order: HP, Attack, Defense, Speed, Sp. Atk, Sp. Def, accuracy, evasiveness. */
const STAT_INDEX: Record<string, number> = { atk: 1, def: 2, spe: 3, spa: 4, spd: 5, accuracy: 6, evasion: 7 };

export class BattleText {
  private readonly ns: string;

  constructor(private readonly reg: Registries) {
    const record = [...reg.newGame.keys()][0];
    if (!record) throw new Error('battle: no newGame record (its namespace names the battle texts)');
    this.ns = record.slice(0, record.indexOf(':'));
    const missing = battleStringNames().filter((n) => !reg.texts.has(`${this.ns}:BattleStrings_Text_${n}` as Id));
    if (missing.length) throw new Error(`battle: the packs lack battle texts ${missing.map((n) => `${this.ns}:BattleStrings_Text_${n}`).join(', ')}`);
    const party = PARTY_STRINGS.filter((n) => !reg.texts.has(`${this.ns}:BattleParty_Text_${n}` as Id));
    if (party.length) throw new Error(`battle: the packs lack battle party texts ${party.map((n) => `${this.ns}:BattleParty_Text_${n}`).join(', ')}`);
    this.bank('TEXT_BANK_MOVES_USED_IN_BATTLE');
    this.bank('TEXT_BANK_POKEMON_STAT_NAMES');
  }

  /** The side's miss message. */
  missed(user: string, who: Who): string {
    return fill(this.text(`${this.ns}:BattleStrings_Text_${MISSED[who]}` as Id), [user]);
  }

  private text(id: Id): string {
    const t = this.reg.texts.get(id);
    if (!t) throw new Error(`battle: missing text ${id}`);
    return t.text;
  }

  private bank(name: string): Id[] {
    const b = this.reg.textBanks.get(`${this.ns}:${name}` as Id);
    if (!b) throw new Error(`battle: missing text bank ${this.ns}:${name}`);
    return b.messages;
  }

  /** A battle string (`AWildPokemonAppeared`, or a sided one by its stem and `who`) with its slots filled. */
  get(name: string, vars: readonly string[] = [], who?: Who | WhoPair): string {
    return fill(this.text(`${this.ns}:BattleStrings_Text_${who ? `${name}_${who}` : name}` as Id), vars);
  }

  /** Any text's markup with its slots filled (trainer lines from the field banks). */
  markup(markup: string, vars: readonly string[]): string {
    return fill(markup, vars);
  }

  /** A battle party message (`BattleParty_Text_<name>`). */
  party(name: PartyString, vars: readonly string[] = []): string {
    return fill(this.text(`${this.ns}:BattleParty_Text_${name}` as Id), vars);
  }

  moveUsed(move: Move, who: Who, user: string): string {
    const index = (move.sourceIndex ?? NaN) * 3 + { Ally: 0, Wild: 1, Foe: 2 }[who];
    const id = this.bank('TEXT_BANK_MOVES_USED_IN_BATTLE')[index];
    if (!id) throw new Error(`battle: no "used" message ${index} for ${move.id}`);
    return fill(this.text(id), [user]);
  }

  stat(stat: string): string {
    const i = STAT_INDEX[stat];
    const id = i === undefined ? undefined : this.bank('TEXT_BANK_POKEMON_STAT_NAMES')[i];
    if (!id) throw new Error(`battle: no stat name for ${stat}`);
    return plainText(this.text(id));
  }
}

/**
 * A message as the battle prints it: the markup with its template slots filled with plain text (escaped);
 * {clear}, {scroll} and the other commands stay for the text printer.
 */
export function fill(markup: string, vars: readonly string[]): string {
  return printTextMarkup(
    parseTextMarkup(markup).map((t) => {
      if (t.kind !== 'var') return t;
      const v = vars[t.slot];
      if (v === undefined) throw new Error(`battle: text slot ${t.slot} not set in "${markup}"`);
      return { kind: 'chars' as const, value: v };
    }),
  );
}

/** A name's markup (a stat or trainer class name) as plain text: its characters and line breaks. */
export function plainText(markup: string): string {
  return pages(markup, [])[0] ?? '';
}

/**
 * Markup → the pages the textbox shows once each is printed (two lines each, joined by \n): `{clear}` starts
 * a new page, `{scroll}` one that keeps the last line. Template slots are filled; other commands are dropped.
 */
export function pages(markup: string, vars: readonly string[]): string[] {
  const out: string[] = [];
  let lines = [''];
  const flush = (keep: boolean) => {
    if (lines.some((l) => l)) out.push(lines.join('\n'));
    lines = keep ? [lines[lines.length - 1]!, ''] : [''];
  };
  for (const t of parseTextMarkup(markup)) {
    if (t.kind === 'chars') lines[lines.length - 1] += t.value;
    else if (t.kind === 'var') {
      const v = vars[t.slot];
      if (v === undefined) throw new Error(`battle: text slot ${t.slot} not set in "${markup}"`);
      lines[lines.length - 1] += v;
    } else if (t.kind === 'newline') lines.push('');
    else if (t.kind === 'clear') flush(false);
    else if (t.kind === 'scroll') flush(true);
  }
  flush(false);
  return out;
}
