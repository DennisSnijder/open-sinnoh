/**
 * The TV (docs/research/tv.md; decomp src/unk_0202E2CC.c, src/tv_segment.c, overlay006/ov6_022465FC.c, tv_episode.c,
 * tv_commercials.c, scrcmd_tv_broadcast.c). The saved part (decomp TVBroadcast): the time slot's progress, the player's
 * own segments of the three recorded programme types, and the pending data some interviews and records are made from.
 * Wi-Fi episodes (record mixing) are never received offline, so their lists are not kept.
 *
 * The recorders are shared state edits (as `journal.ts`): the world, the VM and the game call them at the decomp's
 * hooks. The broadcast (the schedule, choosing a segment, its message) is services `tv.ts`.
 */
import type { Id } from '@opensinnoh/core';
import type { GameState } from './state.ts';

/** Decomp TV_PROGRAM_TYPE_*. */
export const TV_PROGRAM_TYPE = { interviews: 1, sightings: 2, records: 3, sinnohNow: 4, varietyHour: 5 } as const;
/** The program types whose segments are saved (decomp sub_0202E4DC), in their `TvState` list. */
export const TV_SAVED_TYPES = { 1: 'interviews', 2: 'sightings', 3: 'records' } as const;
export type TvSavedType = (typeof TV_SAVED_TYPES)[keyof typeof TV_SAVED_TYPES];
/** Decomp: four instances per saved type, TV_BROADCAST_MAX_PLAYED_SEGMENTS, a segment's play cap (TVBroadcast_SaveSegmentData). */
export const TV = { slots: 4, played: 4, plays: 3, slotMinutes: 15 } as const;

/**
 * A saved segment's data (decomp TVSegmentData's members), by `kind`. Each kind is one segment id of one type
 * (`TV_SEGMENTS`). `word` is an Easy Chat word (the interview's answer); items, species and Ball Capsule seals are ids.
 */
export type TvSegmentData =
  // Trainer sightings (TV_PROGRAM_TYPE_TRAINER_SIGHTINGS)
  | { kind: 'catch-success'; species: Id; ball: Id; balls: number; nickname: string | null }
  | { kind: 'catch-failure'; balls: number; fainted: boolean }
  | { kind: 'fishing'; rod: Id; species: Id | null }
  | { kind: 'hidden-item'; item: Id; location: number }
  | { kind: 'shopping'; item: Id; amount: number }
  | { kind: 'egg'; species: Id; location: number }
  | { kind: 'name-change'; species: Id; nickname: string }
  | { kind: 'ug-treasure'; item: number; amount: number }
  | { kind: 'safari'; species: Id; caught: number }
  | { kind: 'storage'; species: Id; male: boolean }
  | { kind: 'berries'; berry: Id; amount: number }
  | { kind: 'no-berries'; berry: Id }
  | { kind: 'seal-club'; species: Id; seal: number }
  | { kind: 'villa-empty' }
  | { kind: 'villa'; furniture: number }
  // Records (TV_PROGRAM_TYPE_RECORDS)
  | { kind: 'tower-streak'; species: Id; streak: number; single: boolean }
  | { kind: 'size'; species: Id; size: number }
  | { kind: 'slots'; before: number; after: number; spent: number }
  | { kind: 'ribbons'; species: Id; nickname: string | null; ribbon: number; count: number }
  | { kind: 'traps'; trap: number; count: number }
  | { kind: 'bp'; total: number }
  // Interviews (TV_PROGRAM_TYPE_INTERVIEWS)
  | { kind: 'tower-corner'; win: boolean; streak: number; word: number }
  | { kind: 'your-pokemon'; species: Id; nickname: string | null; word: number }
  | { kind: 'poketch'; app: Id | null; word: number }
  | { kind: 'contest'; species: Id; type: number; rank: number; placement: number; word: number }
  | { kind: 'photo'; species: Id; word: number }
  | { kind: 'personality'; type: number }
  | { kind: 'poffin'; poffin: number; word: number }
  | { kind: 'amity'; species: Id; nature: number; found: TvAmityFind; word: number }
  | { kind: 'frontier-single'; species: Id; nickname: string | null; word: number }
  | { kind: 'in-your-face'; question: 1 | 2 | 3 | 4; word: number };

export type TvSegmentKind = TvSegmentData['kind'];

/** What an Amity Square walk found (decomp UnkStruct_0202E7E4 unk_1F: 0 nothing, 1 an item, 2 an accessory). */
export type TvAmityFind = { item: Id } | { accessory: number } | null;

/** The type and segment id (decomp TV_PROGRAM_SEGMENT_* and the records' bare numbers) of each kind. */
export const TV_SEGMENTS: Record<Exclude<TvSegmentKind, 'in-your-face'>, { type: 1 | 2 | 3; id: number }> = {
  'catch-success': { type: 2, id: 1 },
  'catch-failure': { type: 2, id: 2 },
  fishing: { type: 2, id: 3 },
  'hidden-item': { type: 2, id: 6 },
  shopping: { type: 2, id: 7 },
  egg: { type: 2, id: 8 },
  'name-change': { type: 2, id: 10 },
  'ug-treasure': { type: 2, id: 13 },
  safari: { type: 2, id: 15 },
  storage: { type: 2, id: 16 },
  berries: { type: 2, id: 18 },
  'no-berries': { type: 2, id: 19 },
  'seal-club': { type: 2, id: 21 },
  'villa-empty': { type: 2, id: 25 },
  villa: { type: 2, id: 26 },
  'tower-streak': { type: 3, id: 1 },
  size: { type: 3, id: 3 },
  slots: { type: 3, id: 4 },
  ribbons: { type: 3, id: 5 },
  traps: { type: 3, id: 8 },
  bp: { type: 3, id: 10 },
  'tower-corner': { type: 1, id: 2 },
  'your-pokemon': { type: 1, id: 4 },
  poketch: { type: 1, id: 6 },
  contest: { type: 1, id: 7 },
  photo: { type: 1, id: 9 },
  personality: { type: 1, id: 10 },
  poffin: { type: 1, id: 11 },
  amity: { type: 1, id: 13 },
  'frontier-single': { type: 1, id: 14 },
};

/** A kind's type and segment id (In-Your-Face Interview questions 1–4 are segments 15–18). */
export function tvSegmentId(data: TvSegmentData): { type: 1 | 2 | 3; id: number } {
  return data.kind === 'in-your-face' ? { type: 1, id: 14 + data.question } : TV_SEGMENTS[data.kind];
}

/** A saved segment (decomp TVSegmentInstance without its timestamp, which Platinum never reads): `plays` 0..TV.plays. */
export interface TvRecord {
  data: TvSegmentData;
  plays: number;
}

/**
 * The data the next interview or record is made from (decomp TVBroadcast's showcasedPokemon, unk_ADE, unk_B02, unk_B04,
 * safariGame, unk_B10, unk_B44). Null: nothing pending (the decomp's flag byte clear).
 */
export interface TvPending {
  /** TVBroadcast_SetContestHallShowInfo: the last official contest's entrant and its placement (1–4). */
  contest: { species: Id; type: number; rank: number; placement: number } | null;
  /** sub_0206CF48 / sub_0206CFB4 / sub_0206CF9C (ScrCmd_27C): the Amity Square walk. */
  amity: { species: Id; nature: number; found: TvAmityFind } | null;
  /** sub_0206CFCC: the type of the last Poffin cooked. */
  poffin: number | null;
  /** sub_0206CFE4: the last Battle Tower challenge of seven or more battles. */
  tower: { win: boolean; streak: number } | null;
  /** TVBroadcast_UpdateSafariGameData: the first Pokémon caught in the Safari Game being played (the count is `GameState.safari.caught`). */
  safari: Id | null;
  /** sub_0206D048: the Battle Hall's singles Pokémon. */
  hall: { species: Id; nickname: string | null } | null;
  /** sub_0206D0C8: Battle Points won today (at most 9999; the daily reset clears it). */
  bp: number;
}

/**
 * `GameState.tv` (0.42.0, schema v23; decomp TVBroadcast without the Wi-Fi episodes). `played`: the segments played in this
 * time slot (slot numbers 1–4 for the saved types, segment ids for Sinnoh Now and the Variety Hour); `slotMinutes` the
 * minutes left in the 15-minute slot; `finished` the programme's farewell was shown. `interviews`, `sightings` and
 * `records` hold `TV.slots` entries each (null: free).
 */
export interface TvState {
  played: number[];
  slotMinutes: number;
  finished: boolean;
  interviews: (TvRecord | null)[];
  sightings: (TvRecord | null)[];
  records: (TvRecord | null)[];
  pending: TvPending;
}

export const newTvState = (): TvState => ({
  played: [],
  slotMinutes: 0,
  finished: false,
  interviews: [null, null, null, null],
  sightings: [null, null, null, null],
  records: [null, null, null, null],
  pending: { contest: null, amity: null, poffin: null, tower: null, safari: null, hall: null, bp: 0 },
});

/**
 * `NewGame.tv` (0.42.0; arc/tv.narc). `schedule[slot][day]`: the programme (1–9) of each quarter hour from 5:00 (slot 0) and
 * day (0 Monday … 6 Sunday); `programs[id − 1]`: a programme's type and its segment ids in order.
 */
export interface TvTables {
  schedule: number[][];
  programs: { type: number; segments: number[] }[];
}

const listOf = (tv: TvState, type: 1 | 2 | 3) => tv[TV_SAVED_TYPES[type]];

/**
 * Decomp TVBroadcast_SaveSegmentData: a segment of a kind already saved replaces it once it has played three times (else
 * the new one is dropped); otherwise the first free slot; otherwise the first that has played three times; else dropped.
 */
export function saveTvSegment(state: GameState, data: TvSegmentData): boolean {
  const { type, id } = tvSegmentId(data);
  const list = listOf(state.tv, type);
  const same = list.findIndex((r) => r !== null && tvSegmentId(r.data).id === id);
  const at = same >= 0 ? (list[same]!.plays >= TV.plays ? same : -1) : list.indexOf(null) >= 0 ? list.indexOf(null) : list.findIndex((r) => r!.plays >= TV.plays);
  if (at < 0) return false;
  list[at] = { data, plays: 0 };
  return true;
}

/**
 * Decomp FieldSystem_SaveTVSegment_CatchThatPokemonShow (encounter.c, after a wild, roamer or AI-partner battle): nothing
 * without a ball thrown; a catch records the caught Pokémon (balls capped at 999); a win or a flight with more than two balls
 * records the failure.
 */
export function tvCatch(state: GameState, outcome: 'caught' | 'won' | 'fled' | 'enemy-fled' | 'lost' | 'draw', balls: number, caught: { species: Id; ball: Id; nickname: string | null } | null): void {
  if (balls === 0) return;
  const n = Math.min(balls, 999);
  if (outcome === 'caught' && caught) saveTvSegment(state, { kind: 'catch-success', species: caught.species, ball: caught.ball, balls: n, nickname: caught.nickname });
  else if ((outcome === 'won' || outcome === 'fled' || outcome === 'enemy-fled') && n > 2) saveTvSegment(state, { kind: 'catch-failure', balls: n, fainted: outcome === 'won' });
}

/** Decomp TVBroadcast_UpdateSafariGameData: the first Pokémon caught in this Safari Game. */
export function tvSafariCatch(state: GameState, species: Id, caughtBefore: number): void {
  if (caughtBefore === 0) state.tv.pending.safari = species;
}

/** sub_0206DE4C's ribbons (decomp Unk_020EFDDC as enum Ribbon ids): the Effort Ribbon and the Sinnoh ribbons 32–69. */
const COUNTED_RIBBONS = new Set([24, ...Array.from({ length: 38 }, (_, i) => 32 + i)]);

/**
 * Decomp sub_0206DDB8 (a ribbon given: a contest win, a script's ribbon, a Battle Tower streak): with 15, 20, 25, 30, 35
 * or 40 of the counted ribbons, the record names the Pokémon and the ribbon (its id is its TEXT_BANK_RIBBON_NAMES entry).
 */
export function tvRibbon(state: GameState, mon: { species: Id; nickname: string | null; ribbons: number[] }, ribbon: number): void {
  const count = mon.ribbons.filter((r) => COUNTED_RIBBONS.has(r)).length;
  if ([15, 20, 25, 30, 35, 40].includes(count)) saveTvSegment(state, { kind: 'ribbons', species: mon.species, nickname: mon.nickname, ribbon, count });
}

/** Decomp sub_0206D0C8: Battle Points won, summed for the day (at most 9999). */
export function tvBattlePoints(state: GameState, bp: number): void {
  state.tv.pending.bp = Math.min(9999, state.tv.pending.bp + bp);
}

/**
 * Decomp sub_0206F2F0 (FieldSystem_HandleDailyEvents): yesterday's Battle Points (30 or more) become a record; the GTS's
 * count is link-only. Both totals start again.
 */
export function tvDaily(state: GameState): void {
  if (state.tv.pending.bp >= 30) saveTvSegment(state, { kind: 'bp', total: state.tv.pending.bp });
  state.tv.pending.bp = 0;
}

/**
 * Decomp TVBroadcast_UpdateProgramTimeSlot (sub_02055B64, whole minutes passed): the slot runs down; at its end the next
 * slot starts at the clock's quarter hour, the programme is not finished and nothing has played.
 */
export function tvTimeSlot(state: GameState, minutes: number, minute: number): void {
  const tv = state.tv;
  if (tv.slotMinutes > minutes) {
    tv.slotMinutes -= minutes;
    return;
  }
  tv.slotMinutes = TV.slotMinutes - (minute % TV.slotMinutes);
  tv.finished = false;
  tv.played = [];
}
