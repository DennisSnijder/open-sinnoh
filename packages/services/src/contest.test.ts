/** Super Contest rules (decomp unk_02094EDC.c, ov17_0223F118.c, ov17_02250744.c, party_menu/main.c) on original data. */
import { describe, expect, it } from 'vitest';
import { zeroCondition, type Id, type Pokemon } from '@opensinnoh/core';
import { newFashionCase, type ContestOpponent, type ContestRawScores, type ContestSession, type ContestTables, type Registries } from '@opensinnoh/contracts';
import {
  conditionHearts, conditionPoints, contestEligible, contestFame, contestRandom, contestRibbon, dressUpHearts, finalResult, opponentPool,
  pickJudges, pickOpponents, pickTheme, practicePlacement, victoryAccessory, NO_ACCESSORY,
} from './contest.ts';

const scarf = (n: number) => `test:ITEM_SCARF_${n}` as Id;
const registries = { items: new Map([260, 261, 262, 263, 264].map((n) => [scarf(n), { id: scarf(n), sourceIndex: n }])) } as unknown as Registries;
const mon = (o: Partial<Pokemon> = {}): Pokemon => ({ isEgg: false, hp: 10, moves: ['test:A', 'test:B'], ribbons: [], heldItem: null, condition: zeroCondition(), ...o }) as unknown as Pokemon;
const fixedRng = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('the contest RNG (LCRNG_Next)', () => {
  it('steps the session state and returns the high half', () => {
    const s = { rng: 1 };
    expect(contestRandom(s)).toBe(0x41c6);
    expect(s.rng).toBe(0x41c6aee0);
    expect(contestRandom({ rng: 0 })).toBe(0);
  });
});

describe('who may enter (CheckContestEligibility) and the fame (CalcMonContestFame)', () => {
  it('needs two moves, HP, no Egg and `rank` ribbons of the type', () => {
    expect(contestEligible(mon(), 0, 0)).toBe(true);
    expect(contestEligible(mon({ moves: ['test:A' as Id] }), 0, 0)).toBe(false);
    expect(contestEligible(mon({ hp: 0 }), 0, 0)).toBe(false);
    expect(contestEligible(mon({ isEgg: true }), 0, 0)).toBe(false);
    expect(contestEligible(mon(), 1, 2)).toBe(false);
    // Any one Cute ribbon counts for Great rank, as the decomp counts ribbons, not ranks.
    expect(contestEligible(mon({ ribbons: [contestRibbon(2, 3)] }), 1, 2)).toBe(true);
    expect(contestEligible(mon({ ribbons: [contestRibbon(1, 0)] }), 1, 2)).toBe(false);
  });

  it('fame counts the ribbons from Normal up without a gap, reading one past Master', () => {
    expect(contestFame(mon(), 0)).toBe(1);
    expect(contestFame(mon({ ribbons: [33, 34] }), 0)).toBe(3);
    expect(contestFame(mon({ ribbons: [34, 35] }), 0)).toBe(1);
    expect(contestFame(mon({ ribbons: [33, 34, 35, 36, 37] }), 0)).toBe(6);
    expect(contestFame(mon({ ribbons: [49, 50, 51, 52, 53] }), 4)).toBe(5);
  });
});

describe('the condition score (ov17_0223F374) and its hearts (sub_02095928, sub_0209598C)', () => {
  const cond = { cool: 100, beauty: 31, cute: 0, smart: 0, tough: 20, sheen: 50 };
  it('adds half the neighbours and the sheen, then the scarf', () => {
    expect(conditionPoints(registries, mon({ condition: cond }), 0)).toBe(100 + 50);
    expect(conditionPoints(registries, mon({ condition: cond, heldItem: scarf(260) }), 0)).toBe(165);
    expect(conditionPoints(registries, mon({ condition: cond, heldItem: scarf(261) }), 0)).toBe(157);
    expect(conditionPoints(registries, mon({ condition: cond, heldItem: scarf(264) }), 0)).toBe(157);
    expect(conditionPoints(registries, mon({ condition: cond, heldItem: scarf(262) }), 0)).toBe(150);
    // Beauty: beauty + (cool + cute + sheen) / 2.
    expect(conditionPoints(registries, mon({ condition: cond }), 1)).toBe(31 + 75);
  });

  it('turns points into hearts at the rank thresholds', () => {
    expect([9, 10, 79, 80, 999].map((p) => conditionHearts(p, 0))).toEqual([0, 1, 7, 8, 8]);
    expect([319, 320, 600].map((p) => conditionHearts(p, 3))).toEqual([0, 1, 8]);
    expect([0, 1, 3, 4, 8, 9].map((p) => dressUpHearts(p, 0))).toEqual([0, 1, 1, 2, 3, 4]);
    expect([10, 11, 30, 31].map((p) => dressUpHearts(p, 3))).toEqual([1, 2, 3, 4]);
  });
});

describe('the final scoring (ov17_02251A1C)', () => {
  const scores: ContestRawScores = { condition: [80, 50, 25, 5], dressUp: [0, 0, 0, 0], dance: [10, 20, 5, 5], acting: [3, 3, 3, 3] };
  it('normalises each round against its leader, sums bars and places by the bars', () => {
    const r = finalResult(scores, 0, 2, fixedRng([0, 0, 0, 0]));
    expect(r.points).toEqual([[33, 21, 8, 0], [17, 33, 8, 8], [33, 33, 33, 33]]);
    expect(r.bars).toEqual([[64, 40, 15, 0], [32, 64, 15, 15], [64, 64, 64, 64]]);
    expect(r.totals).toEqual([83, 87, 49, 41]);
    expect(r.placements).toEqual([1, 0, 2, 3]);
  });

  it('breaks a tie by the higher random draw', () => {
    const tied: ContestRawScores = { condition: [10, 10, 10, 10], dressUp: [0, 0, 0, 0], dance: [1, 1, 1, 1], acting: [1, 1, 1, 1] };
    expect(finalResult(tied, 0, 2, fixedRng([5, 9, 1, 7])).placements).toEqual([2, 0, 3, 1]);
  });

  it('fails loudly when a round has no points at all', () => {
    expect(() => finalResult({ ...scores, dance: [0, 0, 0, 0] }, 0, 2, fixedRng([0]))).toThrow(/no points/);
  });

  it('places a practice by the rivals with more points (FieldTask_RunPracticeCompetition)', () => {
    expect(practicePlacement({ ...scores, dance: [10, 20, 10, 5] }, 0, 5)).toBe(1);
    expect(practicePlacement(scores, 0, 3)).toBe(0);
  });
});

const opponent = (o: Partial<ContestOpponent>): ContestOpponent => ({
  species: 'test:S' as Id, moves: [], nickname: 'test:N' as Id, trainerName: 'test:T' as Id, condition: zeroCondition(), rank: 0, types: [0],
  practice: false, single: false, pool: 0, gender: 'male', aiLevel: 0, gfx: 1, trainerClass: 0, fame: 1, dressUps: [], ...o,
});
const tables = (opponents: ContestOpponent[]): ContestTables => ({
  opponents,
  judges: [
    { name: 'test:J0' as Id, rank: 0, roles: [2, 2, 2, 2, 2] },
    { name: 'test:J1' as Id, rank: 0, roles: [1, 1, 1, 1, 1] },
    { name: 'test:J2' as Id, rank: 0, roles: [1, 1, 1, 1, 1] },
    { name: 'test:J3' as Id, rank: 1, roles: [2, 2, 2, 2, 2] },
  ],
  dressUps: [],
  themes: [],
  playerGfx: { male: 1, female: 2 },
  playerSprite: { male: 'test:M' as Id, female: 'test:F' as Id },
  dance: { songs: [], choice: [], variants: [], aiJitter: [], aiRepeat: [], stage: [], grades: [], noteRows: [], tints: [], shades: [], buttons: [] },
});

describe('the rivals, judges and theme (sub_02094F04, sub_020954F0, sub_02095A74)', () => {
  it('filters the pool by rank, type, competition and the post-game', () => {
    const t = tables([opponent({}), opponent({ rank: 1 }), opponent({ types: [1] }), opponent({ practice: true }), opponent({ pool: 2 }), opponent({ pool: 1 }), opponent({ pool: 3 })]);
    expect(opponentPool(t, 0, 0, 2, false)).toEqual([0, 5]);
    expect(opponentPool(t, 0, 0, 2, true)).toEqual([0, 4, 6]);
    expect(opponentPool(t, 0, 0, 3, false)).toEqual([3]);
  });

  it('draws three without repeats and seats a post-game star', () => {
    const t = tables([opponent({}), opponent({}), opponent({}), opponent({}), opponent({ pool: 3 })]);
    // The star first (draw % 1), then seats from the pool (a star drawn there is drawn again), then the star's seat.
    expect(pickOpponents(t, [0, 1, 2, 3, 4], fixedRng([0, 4, 0, 0, 0, 2]))).toEqual([0, 1, 4]);
    expect(pickOpponents(t, [0, 1, 2, 3], fixedRng([3, 0, 1]))).toEqual([3, 0, 2]);
  });

  it('seats the main judge in the middle', () => {
    expect(pickJudges(tables([]), 0, 3, fixedRng([0]))).toEqual([1, 0, 2]);
    expect(() => pickJudges(tables([]), 1, 0, fixedRng([0]))).toThrow(/side judges/);
  });

  it('picks the theme from the rank pool', () => {
    expect([0, 1, 2].map((v) => pickTheme(0, fixedRng([v])))).toEqual([2, 3, 4]);
    expect(pickTheme(1, fixedRng([3]))).toBe(0);
    expect(pickTheme(2, fixedRng([8]))).toBe(8);
    expect(pickTheme(3, fixedRng([23]))).toBe(11);
  });
});

describe('the first-win accessory (Contest_CalcFirstTimeVictoryAccessoryReward)', () => {
  const session = (o: Partial<ContestSession>) => ({ type: 0, rank: 0, placement: 0, ...o }) as ContestSession;
  it('gives the type and rank prize to a winner with room', () => {
    expect(victoryAccessory(session({}), newFashionCase())).toBe(73);
    expect(victoryAccessory(session({ type: 2, rank: 3 }), newFashionCase())).toBe(87);
    expect(victoryAccessory(session({ placement: 1 }), newFashionCase())).toBe(NO_ACCESSORY);
    const held = newFashionCase();
    held.accessories[73] = 1;
    expect(victoryAccessory(session({}), held)).toBe(NO_ACCESSORY);
  });
});
