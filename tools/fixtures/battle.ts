/**
 * The fixture's battle texts: original wording under the Platinum battle string names the battle controller
 * reads (packages/battle `BATTLE_STRINGS`), the "used" bank (3 lines per move by move number: own, wild,
 * foe) and the stat names bank.
 */
import type { AiScript, Text, TextBank } from '@opensinnoh/contracts';
import { Asm } from '../../packages/battle/src/ai/testing/asm.ts';
import { PROTOCOL_STRINGS } from '../../packages/battle/src/messages.ts';
import type { Id } from '@opensinnoh/core';

const sided = (own: string, wild: string, foe: string) => ({ Ally: own, Wild: wild, Foe: foe });
const as = (who: 'Ally' | 'Wild' | 'Foe', s: string) => s.replace('{who}', { Ally: '{var 0}', Wild: 'wild {var 0}', Foe: 'rival {var 0}' }[who]);

const PLAIN: Record<string, string> = {
  TheFogIsDeep: 'A thick mist covers\nthe arena.',
  TheDimensionsBecameDistorted: 'Space bends around\nthe arena!',
  TheTwistedDimensionsReturnedToNormal: 'Space settles back\ninto place.',
  AWildPokemonAppeared: 'A wild {var 0} leaps out!{clear}',
  GoPokemon: 'Your turn, {var 0}!',
  WhatWillPokemonDo: 'What should {var 0} try?',
  GotAwaySafely: 'You slipped away!{clear}',
  CantEscape: 'No way out!{clear}',
  TheWildPokemonFled: 'The wild {var 0} slipped away!{clear}',
  ACriticalHit: 'A lucky strike!',
  ItsSuperEffective: 'That one landed hard!',
  ItsNotVeryEffective: 'It barely stung...',
  ButItFailed: 'Nothing came of it!',
  PlayerBlackedOut: '{var 0} ran out of companions!{clear}',
  PokemonGainedExpPoints: '{var 0} earned\n{var 1} experience!{clear}',
  PokemonGainedABoostedExpPoints: '{var 0} earned a bonus\n{var 1} experience!{clear}',
  PokemonGrewToLevel: '{var 0} reached\nlevel {var 1}!{clear}',
  PokemonLearnedMove: '{var 0} now knows\n{var 1}!{clear}',
  PokemonIsTryingToLearnMove: '{var 0} wants to know\n{var 1}.{clear}',
  ButPokemonCantLearnMoreThanFourMoves: '{var 0} already knows\nfour moves.{clear}',
  DeleteAMoveToMakeRoomForMove: 'Drop a move for\n{var 1}?{clear}',
  OneTwoAndPoof: 'One, two... gone!',
  PokemonForgotTheMove: '{var 0} let go of\n{var 2}.{clear}',
  AndDotDotDot: 'Then...',
  PokemonDidNotLearnMove: '{var 0} kept its moves\nand skipped {var 1}.{clear}',
  PokemonWantsToLearnMove: '{var 0} longs to know\n{var 1}.{clear}',
  ButPokemonCantLearnMoreThanFourMoves2: 'Yet {var 0} holds\nfour moves already.{clear}',
  MakeItForgetAnotherMoveYesNo: 'Let go of an old\nmove?',
  WhichMoveShouldBeForgotten2: 'Which move goes?',
  WellThen: 'Alright...{clear}',
  ShouldPokemonGiveUpOnLearningMove: 'Skip the new move\nfor good?',
  PokemonDidNotLearnMove2: '{var 0} passed on\n{var 1}.{clear}',
  BattleOneTwoAndPoof: 'One, two... gone!{clear}',
  BattlePokemonForgotHowToUseMove: '{var 0} let go of\n{var 1}.{clear}',
  BattleAndDotDotDot: 'Then...{clear}',
  BattlePokemonLearnedMove: '{var 0} now knows\n{var 1}!{clear}',
  YouAreChallengedByTr: '{var 0} {var 1}\nwants a match!{clear}',
  TrSentOutPokemon: '{var 0} {var 1}\ncalls on {var 2}!',
  TrWithdrewPokemon: '{var 0} {var 1}\ncalls back {var 2}!',
  TrUsedOneItem: '{var 0} {var 1}\nreached for a {var 2}!',
  NoTheresNoRunningFromATrainerBattle: 'You cannot slip away\nfrom a match!{clear}',
  WouldYouLikeToForfeitTheMatchAndQuitNowYesNo: 'Give up this match\nand leave now?',
  PlayerForfeitedTheMatch: 'You gave up\nthe match.{clear}',
  PlayerDefeatedTr: 'You won against\n{var 0} {var 1}!',
  // Doubles: two enemy trainers, an AI partner.
  YouAreChallengedByTr1AndTr2: '{var 0} {var 1} and\n{var 2} {var 3} want a match!{clear}',
  Tr1SentOutPokemon1Tr2SentOutPokemon2: '{var 0} {var 1} calls on {var 2}!\n{var 3} {var 4} calls on {var 5}!',
  TrSentOutPokemon1GoPokemon2: '{var 0} {var 1} calls on {var 2}!\nYour turn, {var 3}!',
  PlayerBeatTr1AndTr2: 'You won against {var 0} {var 1}\nand {var 2} {var 3}!',
  // Other double topologies: one trainer's two leads, the player's two, two wild Pokémon.
  TrSentOutPokemon1AndPokemon2: '{var 0} {var 1} calls on\n{var 2} and {var 3}!',
  GoPokemon1AndPokemon2: 'Your turn, {var 0}\nand {var 1}!',
  AWildPokemonAndPokemonAppeared: 'A wild {var 0} and\n{var 1} leap out!{clear}',
  PlayerGotMoneyForWinning: '{var 0} earned\n${var 1}!{clear}',
  PlayerIsOutOfUsablePokemon: '{var 0} has no one\nleft to battle!{clear}',
  PlayerPaidOutMoneyToTheWinner: '{var 0} handed over\n${var 1}.{clear}',
  PlayerDroppedMoneyInPanic: '{var 0} lost ${var 1}\nin the scramble!{clear}',
  BlackedOutDotDotDot: '...{clear}',
  AllRightIGotItsHPDownTimeToThrowAPokeBall: 'It looks worn out.\nOrb time!',
  OKTheGotIsHPDownTimeItsReadyForAPokeBall: 'It is tired now.\nOrb time!',
  PlayerUsedOneItem: '{var 0} tossed\na {var 1}!',
  UsedTheItem: 'The {var 0} is used!',
  TheTrainerBlockedTheBall: 'The opponent swatted\nthe orb away!',
  DontBeAThief: 'Hands off my companion!{clear}',
  YourTeamBecameShroudedInAWhiteFog: 'A pale haze settles\nover your team!',
  PokemonIsGettingPumped: '{var 0} is fired up!',
  GotchaPokemonWasCaught: 'Got it!\n{var 0} is yours!{clear}',
  PokemonsDataWasAddedToThePokedex: '{var 0} was noted\nin the log.{clear}',
  OhNoThePokemonBrokeFree: 'Oh no!\nIt slipped out!',
  AwwItAppearedToBeCaught: 'So close!\nIt slipped out!',
  AarghAlmostHadIt: 'Argh!\nNearly had it!',
  ShootItWasSoCloseToo: 'Drat!\nThat was close!',
  PokemonWasTransferredToBoxInSomeonesPC: '{var 0} went to\n{var 1} in the archive.{clear}',
  PokemonWasTransferredToBoxInBebesPC: '{var 0} went to\n{var 1} in Bea\'s archive.{clear}',
  BoxInSomeonesPCIsFullPokemonWasTransferredToOtherBoxInstead: '{var 1} is full.{clear}{var 0} went to\n{var 2} instead.{clear}',
  BoxInBebesPCIsFullPokemonWasTransferredToOtherBoxInstead: '{var 1} is full.{clear}{var 0} went to\n{var 2} in Bea\'s archive.{clear}',
  UseNextPokemonYesNo: 'Send out another\ncompanion?',
  GiveANicknameToTheCaughtPokemonYesNo: 'Name the new\n{var 0}?',
  PokemonSwitchOutComeBack: '{var 0}, swap out!\nBack you come!',
  PokemonComeBack: '{var 0}, back you come!',
  PokemonGoodComeBack: '{var 0}, nice!\nBack you come!',
  PokemonOKComeBack: '{var 0}, well done!\nBack you come!',
  PokemonEnoughGetBack: '{var 0}, that will do!\nBack you come!',
  YourFoesWeakGetEmPokemon: 'It is nearly beaten!\nFinish it, {var 0}!',
  JustALittleMoreHangInTherePokemon: 'Almost there!\nHold on, {var 0}!',
  GoForItPokemon: 'Give it all, {var 0}!',
  YoureInChargePokemon: 'Lead the way, {var 0}!',
  WillYouSwitchYourPokemon: '{var 0} {var 1} calls\n{var 2} next.{clear}Swap companions, {var 3}?',
  // The evolution scene.
  What: 'Oh?{clear}',
  PokemonIsEvolving: '{var 0} is changing!',
  WhatPokemonIsEvolving: 'Oh?\n{var 0} is changing!',
  CongratulationsYourPokemonEvolvedIntoPokemon: '{wait 3}Well done! {var 0}\nbecame {var 1}!{wait 2}{clear}',
  HuhPokemonStoppedEvolving: 'Hm? {var 0}\nstayed as it was!{clear}',
  PokemonWantsToLearnTheMove: '{var 0} wants to know\n{var 1}.{clear}',
  HoweverPokemonAlreadyKnowsFourMoves: 'But {var 0} already\nholds four skills.{clear}',
  ShouldAMoveBeDeleted: 'Drop a skill for it?',
  StopTryingToTeachMove: 'Give up on\n{var 0}?',
  PokemonDidNotLearnTheMove: '{var 0} skipped\n{var 1}.{clear}',
  EvolutionOneTwoAndPoof: 'One, {pause 20}two... {pause 20}{wait 4}gone!{clear}',
  PokemonForgotHowToUseMove: '{var 0} let go of\n{var 1}.{clear}',
  EvolutionAndDotDotDot: 'Then...{clear}',
  EvolvedPokemonLearnedMove: '{var 0} now knows\n{var 1}!{wait 5}{wait 2}{clear}',
};

/**
 * The protocol lines' strings (`PROTOCOL_STRINGS`): placeholders that show the string's name, with the first
 * slot when the message names a Pokémon ("{var 0}: PokemonWasSeeded").
 */
function protocolText(name: string, who: string): string {
  return name.includes('Pokemon') ? `${who}{var 0}: ${name}` : name;
}

/** The battle party's medicine messages (`BattleParty_Text_<name>`). */
const PARTY: Record<string, string> = {
  ItemRestoredHealth: '{var 0} got back\n{var 1} HP.',
  ItemCuredPoisoning: '{var 0} is free\nof poison.',
  ItemCuredParalysis: '{var 0} can move\nfreely again.',
  ItemCuredBurn: '{var 0}\'s burn cooled off.',
  ItemCuredFreeze: '{var 0} thawed.',
  ItemRestoredPP: 'Its moves are refreshed.',
  ItemRevivedPokemon: '{var 0} is back\non its feet!',
  ItemCuredMultipleStatuses: '{var 0} feels fine again.',
  ItemCuredConfusion: '{var 0} is clear-headed.',
  ItemCuredInfatuation: '{var 0} is calm again.',
  ItemCuredSleep: '{var 0} is wide awake.',
};

const SIDED: Record<string, string> = {
  PokemonBlewAwayTheDeepFogWithMove: '{var 0} clears the mist\nwith {var 1}!',
  PokemonFainted: '{who} is out!{clear}',
  PokemonCantEscape: '{who} is held fast!',
  ItDoesntAffectPokemon: '{who} shrugs it off...',
  PokemonIsHurtByPoison: 'Poison stings {who}!',
  PokemonIsHurtByItsBurn: 'The burn hurts {who}!',
  PokemonsStatRose: '{who}: {var 1}\nwent up!',
  PokemonsStatSharplyRose: '{who}: {var 1}\nwent way up!',
  PokemonsStatFell: '{who}: {var 1}\nwent down!',
  PokemonsStatHarshlyFell: '{who}: {var 1}\nwent way down!',
  PokemonsStatWontGoHigher: '{who}: {var 1}\nis at its peak!',
  PokemonsStatWontGoLower: '{who}: {var 1}\nis at its lowest!',
  PokemonIsParalyzedItMayBeUnableToMove: '{who} is stiff!\nIt may not move!',
  PokemonWasPoisoned: '{who} was\npoisoned!',
  PokemonWasBadlyPoisoned: '{who} was\nbadly poisoned!',
  PokemonWasBurned: '{who} got\nburned!',
  PokemonFellAsleep: '{who} dozed\noff!',
  PokemonWasFrozenSolid: '{who} froze\nover!',
  PokemonIsParalyzedItCantMove: '{who} is stiff!\nIt cannot move!',
  PokemonIsFastAsleep: '{who} is\nsound asleep.',
  PokemonIsFrozenSolid: '{who} is\nfrozen stiff!',
};

const MISSED = sided('{var 0} missed!', 'The wild {var 0} missed!', 'Rival {var 0} missed!');

export function battleTexts(id: (name: string) => Id, moves: { sourceIndex?: number; name: string }[]): { texts: Text[]; textBanks: TextBank[] } {
  const texts: Text[] = [];
  const add = (name: string, text: string) => texts.push({ id: id(`BattleStrings_Text_${name}`), text });
  for (const [name, text] of Object.entries(PLAIN)) add(name, text);
  for (const [name, text] of Object.entries(SIDED)) for (const who of ['Ally', 'Wild', 'Foe'] as const) add(`${name}_${who}`, as(who, text).replace(/^wild/, 'The wild').replace(/^rival/, 'Rival'));
  add('PokemonsAttackMissed_Ally', MISSED.Ally);
  add('PokemonsAttackMissed_Wild', MISSED.Wild);
  add('TheAttackOfPokemonMissed_Foe', MISSED.Foe);
  for (const [name, text] of Object.entries(PARTY)) texts.push({ id: id(`BattleParty_Text_${name}`), text });
  const prefix = { Ally: '', Wild: 'wild ', Foe: 'rival ' } as const;
  for (const name of PROTOCOL_STRINGS.plain) add(name, protocolText(name, ''));
  for (const name of PROTOCOL_STRINGS.sided) for (const who of ['Ally', 'Wild', 'Foe'] as const) add(`${name}_${who}`, protocolText(name, prefix[who]));
  for (const name of PROTOCOL_STRINGS.pair) {
    for (const pair of ['AllyAlly', 'AllyWild', 'AllyFoe', 'WildAlly', 'WildWild', 'FoeAlly', 'FoeFoe']) add(`${name}_${pair}`, protocolText(name, prefix[pair.match(/^(Ally|Wild|Foe)/)![1] as 'Ally']));
  }
  for (const name of PROTOCOL_STRINGS.species) for (const who of ['Ally', 'Wild', 'Foe'] as const) add(`${name}_${who}Ally`, `${protocolText(name, prefix[who])} {var 1}`);

  const top = Math.max(...moves.map((m) => m.sourceIndex ?? 0));
  const used: Id[] = [];
  for (let n = 0; n <= top; n++) {
    const move = moves.find((m) => m.sourceIndex === n);
    ['{var 0} tries', 'The wild {var 0} tries', 'Rival {var 0} tries'].forEach((who, v) => {
      const tid = id(`Text_MoveUsed_${n}_${v}`);
      texts.push({ id: tid, text: move ? `${who}\n${move.name}!` : '...' });
      used.push(tid);
    });
  }
  const stats = ['HP', 'Power', 'Guard', 'Pace', 'Spark', 'Ward', 'aim', 'dodge'].map((name, i) => {
    const tid = id(`Text_StatName_${i}`);
    texts.push({ id: tid, text: name });
    return tid;
  });
  // The blackout screen (TEXT_BANK_BLACK_OUT_SCENE: messages 3, a centre, and 4, home; 0–2 unused).
  const blackOut = ['', '', '', '{var 0} hurried back to\nthe rest stop to let\nthe team recover.', '{var 0} hurried back\nhome to let the\nteam recover.'].map((text, i) => {
    const tid = id(`Text_BlackOut_${i}`);
    texts.push({ id: tid, text });
    return tid;
  });
  return {
    texts,
    textBanks: [
      { id: id('TEXT_BANK_BLACK_OUT_SCENE'), sourceIndex: 373, messages: blackOut },
      { id: id('TEXT_BANK_MOVES_USED_IN_BATTLE'), sourceIndex: 0, messages: used },
      { id: id('TEXT_BANK_POKEMON_STAT_NAMES'), sourceIndex: 551, messages: stats },
    ],
  };
}

/**
 * The fixture's trainer AI: our own bytecode (no ROM code), every flag routine an immediate end, so every
 * move keeps its score of 100 and the tie-break draw picks one. The effect and hold-effect tables list the
 * fixture's own names.
 */
export function fixtureAiScript(id: (name: string) => Id, effects: readonly string[], holdEffects: readonly string[]): AiScript {
  const built = new Asm().build();
  return {
    ...built,
    id: id('TRAINER_AI'),
    flags: built.flags.map((f, bit) => ({ ...f, name: `AI_FLAG_${bit}` })),
    battleEffects: [...new Set(effects)] as Id[],
    holdEffects: [...new Set(holdEffects)],
  };
}
