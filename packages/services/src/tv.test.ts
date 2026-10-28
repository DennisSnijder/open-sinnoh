/** The TV (decomp unk_0202E2CC.c, ov6_022465FC.c, tv_segment.c, tv_commercials.c, scrcmd_tv_broadcast.c) on original data. */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { newTvState, saveTvSegment, tvCatch, tvDaily, tvBattlePoints, tvRibbon, tvTimeSlot, TV, type GameState, type Registries, type TvTables } from '@opensinnoh/contracts';
import {
  TV_FRAMING, TV_STATUS, tvCommercial, tvFinish, tvFraming, tvInterviewEligible, tvInterviewMessage, tvLoadSegment, tvNextSegment, tvProgram, tvSaveInterview, tvStatus,
  type TvContext,
} from './tv.ts';

const id = (s: string) => `t:${s}` as Id;
/** A schedule that airs programme 1 (interviews), 2 (sightings), 3 (Sinnoh Now) or 4 (the Variety Hour) by the quarter hour. */
const TABLES: TvTables = {
  schedule: Array.from({ length: 96 }, (_, slot) => Array.from({ length: 7 }, (_, day) => ((slot + day) % 4) + 1)),
  programs: [
    { type: 1, segments: [7, 15, 2] },
    { type: 2, segments: [1, 2, 3] },
    { type: 4, segments: [2, 12, 5] },
    { type: 5, segments: [3, 4] },
  ],
};
/** A text bank of `n` messages, named where the TV looks them up by name. */
const bank = (name: string, n: number, named: Record<number, string> = {}) => ({ id: id(name), sourceIndex: 0, messages: Array.from({ length: n }, (_, i) => id(named[i] ?? `${name}_${i}`)) });
const BANKS = [
  bank('TEXT_BANK_TV_PROGRAMS', 63),
  bank('TEXT_BANK_TV_COMMERCIALS', 35),
  bank('TEXT_BANK_TV_REPORTER_INTERVIEWS', 39),
  bank('TEXT_BANK_TV_PROGRAMS_INTERVIEWS', 57, { 17: 'TVProgramInterviews_Text_ContestHall_Lose', 18: 'TVProgramInterviews_Text_ContestHall_Win', 49: 'TVProgramInterviews_Text_InYourFaceInterview_Question2' }),
  bank('TEXT_BANK_TV_PROGRAMS_TRAINER_SIGHTINGS', 40, {
    0: 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_Nicknamed',
    1: 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_NotNicknamed',
    2: 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_Fainted',
    3: 'TVProgramTrainerSightings_Text_CatchThatPokemonShow_RanAway',
    4: 'TVProgramTrainerSightings_Text_WhatsFishing_Success',
    5: 'TVProgramTrainerSightings_Text_WhatsFishing_Failure',
  }),
  bank('TEXT_BANK_TV_PROGRAMS_SINNOH_NOW', 56),
  bank('TEXT_BANK_TV_PROGRAMS_VARIETY_HOUR', 29),
  bank('TEXT_BANK_CONTEST_TEXT', 60, { 42: 'Contest_Text_BeautyContest', 47: 'Contest_Text_GreatRank' }),
];
const FLAGS = ['FLAG_GAME_COMPLETED', 'FLAG_FIRST_ARRIVAL_JUBILIFE_CITY', 'FLAG_FIRST_ARRIVAL_FLOAROMA_TOWN', 'FLAG_FIRST_ARRIVAL_OREBURGH_CITY', 'FLAG_FIRST_ARRIVAL_ETERNA_CITY', 'FLAG_FIRST_ARRIVAL_HEARTHOME_CITY', 'FLAG_FIRST_ARRIVAL_FIGHT_AREA', 'FLAG_FIRST_ARRIVAL_OREBURGH_MINE'];
const registries = {
  newGame: new Map([[id('NEW_GAME'), { id: id('NEW_GAME'), tv: TABLES }]]),
  textBanks: new Map(BANKS.map((b) => [b.id, b])),
  flags: new Map(FLAGS.map((f) => [id(f), { id: id(f), initial: false }])),
  species: new Map(['PIKACHU', 'STARLY'].map((s, i) => [id(`SPECIES_${s}`), { id: id(`SPECIES_${s}`), sourceIndex: i + 1, name: s }])),
  items: new Map([['ITEM_POKE_BALL', 4], ['ITEM_OLD_ROD', 445]].map(([s, n]) => [id(s as string), { id: id(s as string), sourceIndex: n, name: s }])),
} as unknown as Registries;
const PIKACHU = id('SPECIES_PIKACHU');
const STARLY = id('SPECIES_STARLY');

/** Monday 2009-03-23 at 5:00 + `slot` quarter hours: programme slot % 4 + 1. */
function state(slot = 0): GameState {
  const h = 5 + Math.floor(slot / 4);
  return {
    tv: newTvState(),
    flags: {},
    names: { player: 'Lucas', rival: 'Barry' },
    gender: 'male',
    badges: [],
    bag: {},
    party: [],
    pokedex: { obtained: false, national: false, seen: [PIKACHU], caught: [], forms: {} },
    poketch: { enabled: true, current: null },
    dressUpPhotos: Array.from({ length: 11 }, () => null),
    unlockedToughWords: 0,
    gameTime: { now: { date: '2009-03-23', hour: h % 24, minute: (slot % 4) * 15, second: 0 }, penaltyMinutes: 0 },
  } as unknown as GameState;
}
/** A context whose draws are `values` in turn. */
function ctx(s: GameState, values: number[] = [0]): TvContext & { draws: () => number } {
  let i = 0;
  return { registries, state: s, rng: () => values[i++ % values.length]!, draws: () => i };
}
const catchOf = (species: Id, nickname: string | null = null) => ({ kind: 'catch-success' as const, species, ball: id('ITEM_POKE_BALL'), balls: 1, nickname });

describe('saving a segment (TVBroadcast_SaveSegmentData)', () => {
  it('takes the first free slot of its type, and keeps an unworn one of the same segment', () => {
    const s = state();
    expect(saveTvSegment(s, catchOf(PIKACHU))).toBe(true);
    expect(saveTvSegment(s, { kind: 'fishing', rod: id('ITEM_OLD_ROD'), species: null })).toBe(true);
    // The same segment again: the old one has not played three times, so the new one is dropped.
    expect(saveTvSegment(s, catchOf(STARLY))).toBe(false);
    expect(s.tv.sightings.map((r) => r?.data.kind ?? null)).toEqual(['catch-success', 'fishing', null, null]);
    // Worn out (three plays), the same segment is replaced where it is.
    s.tv.sightings[0]!.plays = TV.plays;
    expect(saveTvSegment(s, catchOf(STARLY))).toBe(true);
    expect(s.tv.sightings[0]).toEqual({ data: catchOf(STARLY), plays: 0 });
    expect(s.tv.interviews).toEqual([null, null, null, null]);
  });

  it('with no free slot, replaces the first worn one, else drops it', () => {
    const s = state();
    s.tv.records = [1, 2, 3, 4].map((n) => ({ data: { kind: 'bp', total: 30 + n }, plays: n === 3 ? TV.plays : 1 }));
    // A different kind than all four: the worn third slot.
    expect(saveTvSegment(s, { kind: 'traps', trap: 1, count: 10 })).toBe(true);
    expect(s.tv.records[2]!.data.kind).toBe('traps');
    s.tv.records[2]!.plays = 1;
    expect(saveTvSegment(s, { kind: 'size', species: PIKACHU, size: 400 })).toBe(false);
  });

  it('the Catch That Pokémon Show: no ball thrown records nothing; a failure needs three balls; balls cap at 999', () => {
    const s = state();
    tvCatch(s, 'caught', 0, { species: PIKACHU, ball: id('ITEM_POKE_BALL'), nickname: null });
    tvCatch(s, 'fled', 2, null);
    expect(s.tv.sightings.every((r) => r === null)).toBe(true);
    tvCatch(s, 'won', 1200, null);
    expect(s.tv.sightings[0]!.data).toEqual({ kind: 'catch-failure', balls: 999, fainted: true });
    tvCatch(s, 'caught', 2, { species: PIKACHU, ball: id('ITEM_POKE_BALL'), nickname: 'Sparky' });
    expect(s.tv.sightings[1]!.data).toEqual({ ...catchOf(PIKACHU, 'Sparky'), balls: 2 });
  });

  it('ribbon counts of 15, 20 … 40 Sinnoh ribbons make a record', () => {
    const s = state();
    tvRibbon(s, { species: PIKACHU, nickname: null, ribbons: Array.from({ length: 14 }, (_, i) => 33 + i) }, 33);
    expect(s.tv.records[0]).toBeNull();
    tvRibbon(s, { species: PIKACHU, nickname: null, ribbons: [1, 2, 24, ...Array.from({ length: 14 }, (_, i) => 33 + i)] }, 24);
    expect(s.tv.records[0]!.data).toEqual({ kind: 'ribbons', species: PIKACHU, nickname: null, ribbon: 24, count: 15 });
  });

  it('Battle Points add up for the day (to 9999) and 30 or more make a record at the day change', () => {
    const s = state();
    tvBattlePoints(s, 20);
    tvDaily(s);
    expect(s.tv.records[0]).toBeNull();
    expect(s.tv.pending.bp).toBe(0);
    tvBattlePoints(s, 9000);
    tvBattlePoints(s, 9000);
    expect(s.tv.pending.bp).toBe(9999);
    tvDaily(s);
    expect(s.tv.records[0]!.data).toEqual({ kind: 'bp', total: 9999 });
  });
});

describe('the time slot and the programme', () => {
  it('a slot runs down by whole minutes and the next starts at the quarter hour (TVBroadcast_UpdateProgramTimeSlot)', () => {
    const s = state();
    s.tv.played = [1, 2];
    s.tv.finished = true;
    tvTimeSlot(s, 1, 7);
    expect(s.tv).toMatchObject({ slotMinutes: 8, played: [], finished: false });
    s.tv.played = [3];
    tvTimeSlot(s, 5, 12);
    expect(s.tv).toMatchObject({ slotMinutes: 3, played: [3] });
    tvTimeSlot(s, 3, 15);
    expect(s.tv).toMatchObject({ slotMinutes: 15, played: [] });
  });

  it('the schedule is read from 5:00 by quarter hour and weekday, Monday first; the status follows the played count', () => {
    expect([0, 1, 2, 3, 4].map((slot) => tvProgram(registries, state(slot)))).toEqual([1, 2, 3, 4, 1]);
    const sunday = state(0);
    sunday.gameTime.now.date = '2009-03-22';
    expect(tvProgram(registries, sunday)).toBe(3);
    const s = state();
    expect(tvStatus(s)).toBe(TV_STATUS.begin);
    s.tv.played = [1];
    expect(tvStatus(s)).toBe(TV_STATUS.continue);
    s.tv.played = [1, 2, 3, 4];
    expect(tvStatus(s)).toBe(TV_STATUS.finish);
    tvFinish(s);
    expect(tvStatus(s)).toBe(TV_STATUS.finished);
  });

  it('framing messages: seven per programme; the greeting by the time of day, the intro by what has played', () => {
    const s = state(1); // 5:15, programme 2, morning
    expect(tvFraming(registries, s, TV_FRAMING.greeting)).toBe(7);
    expect(tvFraming(registries, s, TV_FRAMING.intro)).toBe(10);
    s.tv.played = [1];
    expect(tvFraming(registries, s, TV_FRAMING.intro)).toBe(11);
    expect(tvFraming(registries, s, TV_FRAMING.farewellExtended)).toBe(13);
    s.gameTime.now.hour = 21;
    expect(tvFraming(registries, s, TV_FRAMING.greeting)).toBe(9);
  });

  it('commercials: one of those unlocked, drawn; five are always on', () => {
    const s = state();
    const c = ctx(s, [7]);
    expect(tvCommercial(c, false)).toBe(2);
    s.flags[id('FLAG_FIRST_ARRIVAL_JUBILIFE_CITY')] = true;
    expect(tvCommercial(ctx(s, [5]), false)).toBe(5);
  });
});

describe('choosing a segment (TVBroadcast_GetNextSegmentID)', () => {
  it('unplayed saved segments first, in the programme order, then played ones; one at random when several', () => {
    const s = state(1); // trainer sightings: segments 1, 2, 3
    s.tv.sightings = [
      { data: { kind: 'fishing', rod: id('ITEM_OLD_ROD'), species: null }, plays: 0 },
      { data: catchOf(PIKACHU), plays: 1 },
      { data: { kind: 'catch-failure', balls: 3, fainted: false }, plays: 0 },
      null,
    ];
    // Unplayed: slot 3 (segment 2) before slot 1 (segment 3) by the programme's order; the draw picks among them.
    const c = ctx(s, [1]);
    expect(tvNextSegment(c)).toBe(1);
    expect(c.draws()).toBe(1);
    s.tv.sightings[0]!.plays = 1;
    s.tv.sightings[2]!.plays = 1;
    // All played once: the played pass.
    expect(tvNextSegment(ctx(s, [0]))).toBe(2);
    s.tv.played = [1, 2, 3];
    expect(tvNextSegment(ctx(s))).toBe(0);
  });

  it('an unseen species makes a segment ineligible; one candidate takes no draw', () => {
    const s = state(1);
    s.tv.sightings[0] = { data: catchOf(STARLY), plays: 0 };
    expect(tvNextSegment(ctx(s))).toBe(0);
    s.pokedex.seen.push(STARLY);
    const c = ctx(s);
    expect(tvNextSegment(c)).toBe(1);
    expect(c.draws()).toBe(0);
  });

  it('the played ones are left out only before the first ineligible one (TVBroadcast_ExcludePlayedSegments stops there)', () => {
    const s = state(1);
    s.tv.sightings = [{ data: catchOf(STARLY), plays: 0 }, { data: { kind: 'catch-failure', balls: 3, fainted: false }, plays: 0 }, null, null];
    s.tv.played = [2];
    // Segment 1 (unseen Starly, slot 1) is ineligible and comes first, so the played slot 2 stays a candidate.
    expect(tvNextSegment(ctx(s))).toBe(2);
  });

  it('loading a segment plays it: the slot is played, the record once more, its message and template', () => {
    const s = state(1);
    s.tv.sightings[0] = { data: catchOf(PIKACHU, 'Sparky'), plays: 2 };
    const m = tvLoadSegment(ctx(s), 1);
    expect(m).toEqual({ bank: 'TEXT_BANK_TV_PROGRAMS_TRAINER_SIGHTINGS', message: 0, slots: { 0: { plain: 'Lucas' }, 1: { plain: 'PIKACHU' }, 2: { plain: 'ITEM_POKE_BALL' }, 3: { number: 1 }, 4: { plain: 'Sparky' } } });
    expect(s.tv.played).toEqual([1]);
    expect(s.tv.sightings[0]!.plays).toBe(3);
    tvLoadSegment(ctx(s), 1);
    expect(s.tv.sightings[0]!.plays).toBe(3);
  });

  it('Sinnoh Now and the Variety Hour make their segments up: each once a slot, on the unplayed pass', () => {
    const s = state(3); // the Variety Hour: segments 3, 4
    expect(tvNextSegment(ctx(s, [1]))).toBe(4);
    const m = tvLoadSegment(ctx(s, [2]), 4);
    expect(m).toEqual({ bank: 'TEXT_BANK_TV_PROGRAMS_VARIETY_HOUR', message: 16, slots: {} });
    expect(tvNextSegment(ctx(s, [1]))).toBe(3);
    s.tv.played.push(3);
    expect(tvNextSegment(ctx(s))).toBe(0);
  });
});

describe('interviews (scrcmd_tv_broadcast.c)', () => {
  it('the Contest Hall needs a contest; its answer becomes a segment and the pending data is used up', () => {
    const s = state(0);
    const c = ctx(s);
    expect(tvInterviewEligible(c, 7)).toBe(false);
    s.tv.pending.contest = { species: PIKACHU, type: 1, rank: 1, placement: 1 };
    expect(tvInterviewEligible(c, 7)).toBe(true);
    expect(tvInterviewMessage(c, 7)).toEqual({ bank: 'TEXT_BANK_TV_REPORTER_INTERVIEWS', message: 9, slots: {} });
    tvSaveInterview(c, 7, 1177);
    expect(s.tv.pending.contest).toBeNull();
    expect(s.tv.interviews[0]).toEqual({ data: { kind: 'contest', species: PIKACHU, type: 1, rank: 1, placement: 1, word: 1177 }, plays: 0 });
    // An unplayed answer of the segment leaves no room for another.
    s.tv.pending.contest = { species: PIKACHU, type: 0, rank: 0, placement: 2 };
    expect(tvInterviewEligible(c, 7)).toBe(false);
    // Programme 1 airs it: the win message, with the type and rank names.
    expect(tvNextSegment(c)).toBe(1);
    expect(tvLoadSegment(c, 1)).toEqual({
      bank: 'TEXT_BANK_TV_PROGRAMS_INTERVIEWS',
      message: 18,
      slots: { 0: { plain: 'PIKACHU' }, 1: { bank: 'TEXT_BANK_CONTEST_TEXT', entry: 42 }, 2: { bank: 'TEXT_BANK_CONTEST_TEXT', entry: 47 }, 3: { number: 1 }, 4: { plain: 'Lucas' }, 5: { word: 1177 } },
    });
  });

  it('the In-Your-Face Interview saves the question with the word; the multi partner interview is never eligible offline', () => {
    const s = state(0);
    const c = ctx(s);
    tvSaveInterview(c, 16, 42);
    expect(s.tv.interviews[0]!.data).toEqual({ kind: 'in-your-face', question: 2, word: 42 });
    expect(tvLoadSegment(c, 1)).toMatchObject({ message: 49, slots: { 1: { word: 42 } } });
    expect(tvInterviewEligible(c, 19)).toBe(false);
  });
});
