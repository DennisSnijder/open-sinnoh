/**
 * The trainer score and the game records (decomp src/game_records.c: GameRecords_IncrementTrainerScore,
 * GameRecords_AddToRecordValue, GameRecords_IncrementTrainerScoreOnCatch; encounter.c UpdateGameRecords). Headless: the game applies it
 * when a battle ends, the VM for `increment_trainer_score(2)` and gift Pokémon, the card when it is signed.
 */
import { GAME_RECORDS, isWildKind, newGameRecord, TRAINER_SCORE_MAX, type BattleKind, type BattleOutcome, type GameState, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/** Decomp TRAINER_SCORE_EVENT_* in order (generated/trainer_score_events.txt); increments are `NewGame.gameRecords.scoreIncrements`. */
const EVENTS = [
  'BERRY_HARVESTED', 'HONEY_USED', 'MAIL_WRITTEN', 'TV_INTERVIEW_GIVEN', 'SIGNED_TRAINER_CARD', 'UNK_05', 'UNK_06', 'UNK_07', 'WON_WILD_BATTLE',
  'CAPTURED_REGIONAL_MON', 'CAPTURED_NATIONAL_MON', 'WON_TRAINER_BATTLE', 'UNK_12', 'WIN_OFFICIAL_CONTEST', 'UNK_14', 'UNK_15', 'UNK_16',
  'FINISHED_CATCHING_SHOW', 'UNK_18', 'WIN_LINK_CONTEST', 'UNK_20', 'FOUGHT_LINK_BATTLE', 'CAUGHT_SPECIES', 'BADGE_EARNED', 'HALL_OF_FAME_ENTRY',
  'GTS_TRADE_COMPLETE', 'LOCAL_DEX_DIPLOMA_RECEIVED', 'NATIONAL_DEX_DIPLOMA_RECEIVED', 'UNDERGROUND_CAPTURE_FLAG', 'UNDERGROUND_UNUSED',
  'UNDERGROUND_UNCOVER_FOSSIL', 'UNDERGROUND_GIVE_PLAYER_GOODS', 'UNDERGROUND_GREET_PLAYER', 'UNDERGROUND_ASK_PLAYER_QUESTION',
  'UNDERGROUND_HELP_TRAPPED_PLAYER', 'UNDERGROUND_NEW_SECRET_BASE', 'UNDERGROUND_ENTERED', 'UNDERGROUND_100_STEPS', 'BATTLE_FACTORY_ROUND_COMPLETED',
  'BATTLE_CASTLE_ROUND_COMPLETED', 'BATTLE_HALL_ROUND_COMPLETED', 'BATTLE_ARCADE_ROUND_COMPLETED', 'ALL_BATTLE_FRONTIER_GOLD_PRINTS', 'UNK_43',
  'UNK_44', 'UNK_45', 'UNK_46', 'UNK_47', 'UNK_48', 'BOUGHT_ALL_VILLA_FURNITURE', 'UNK_50',
];

/** A trainer score event: its decomp name without `TRAINER_SCORE_EVENT_`, or its number (script operands). */
export type ScoreEvent = 'BERRY_HARVESTED' | 'TV_INTERVIEW_GIVEN' | 'SIGNED_TRAINER_CARD' | 'WON_WILD_BATTLE' | 'CAPTURED_REGIONAL_MON' | 'CAPTURED_NATIONAL_MON' | 'WON_TRAINER_BATTLE' | 'CAUGHT_SPECIES' | 'BADGE_EARNED' | number;

/** Decomp GameRecords_IncrementTrainerScore: adds the event's increment, capped at TRAINER_SCORE_LIMIT. */
export function incrementTrainerScore(state: GameState, registries: Registries, event: ScoreEvent): void {
  const i = typeof event === 'number' ? event : EVENTS.indexOf(event);
  const add = newGameRecord(registries).gameRecords.scoreIncrements[i];
  if (add === undefined) throw new Error(`trainer score: no event ${event}`);
  state.records.score = Math.min(TRAINER_SCORE_MAX, state.records.score + add);
}

/**
 * Decomp GameRecords_AddToRecordValue (GameRecords_IncrementRecordValue adds 1): record `id` (RECORD_*) grows
 * by `n`, capped at its limit (GetRecordLimit: u32 or u16, high or low per `NewGame.gameRecords.highLimit`).
 * The trainer score has its own rules (`incrementTrainerScore`).
 */
export function addToGameRecord(state: GameState, registries: Registries, id: number, n: number): void {
  if (!Number.isInteger(id) || id < 0 || id >= GAME_RECORDS.count) throw new Error(`game record: no record ${id}`);
  if (id === GAME_RECORDS.trainerScore) throw new Error('game record: the trainer score is added through incrementTrainerScore');
  const high = newGameRecord(registries).gameRecords.highLimit[id]!;
  const limit = id < GAME_RECORDS.u32 ? (high ? GAME_RECORDS.u32High : GAME_RECORDS.u32Low) : high ? GAME_RECORDS.u16High : GAME_RECORDS.u16Low;
  state.records.counts[id] = Math.min(limit, (state.records.counts[id] ?? 0) + n);
}

/** Decomp GameRecords_IncrementTrainerScoreOnCatch: a species caught for the first time (call before marking it caught). */
export function scoreCatch(state: GameState, registries: Registries, species: Id): void {
  if (!state.pokedex.caught.includes(species)) incrementTrainerScore(state, registries, 'CAUGHT_SPECIES');
}

/**
 * Decomp encounter.c UpdateGameRecords after a battle the player did not lose: a won wild battle, a caught
 * wild Pokémon (regional when it has a Sinnoh dex number: GetDexNumber), a won trainer battle (the first
 * battle is a trainer battle). The catching tutorial counts nothing (FieldTask_CatchingTutorialEncounter).
 * `caught`: the caught species (its first-catch score is `scoreCatch`, in the battle's catch sequence).
 */
export function scoreBattle(state: GameState, registries: Registries, kind: BattleKind, outcome: BattleOutcome, caught: Id | null): void {
  if (kind === 'tutorial') return;
  if (isWildKind(kind)) {
    if (outcome === 'won') incrementTrainerScore(state, registries, 'WON_WILD_BATTLE');
    else if (outcome === 'caught') {
      if (!caught) throw new Error('scoreBattle: a catch without a caught species');
      incrementTrainerScore(state, registries, registries.species.get(caught)?.regionalDex !== undefined ? 'CAPTURED_REGIONAL_MON' : 'CAPTURED_NATIONAL_MON');
    }
  } else if (outcome === 'won') incrementTrainerScore(state, registries, 'WON_TRAINER_BATTLE');
}
