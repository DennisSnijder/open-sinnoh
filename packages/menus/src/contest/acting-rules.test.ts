/**
 * The acting round's rules on original tables (made up for the test, shaped like the ROM's): appeal and effects,
 * voltage and its bonus, the judge share, the next turn's order, the first order from the earlier rounds, the move
 * menu's rule and the NPC AI.
 */
import { describe, expect, it } from 'vitest';
import type { ContestActingTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { ActingEngine, aiChoose, EFFECT, firstActingOrder, judgesByPopularity, judgeShare, moveAllowed, newActingState, nextOrder, type ActingState } from './acting-rules.ts';

const id = (s: string) => `test:${s}` as Id;
const line = { text: id('line'), args: 2 };
/** Every effect: class 5 for the judge effects, 6 for pity, else 3; the appeals are ours. */
const APPEAL: Record<number, number> = { [EFFECT.BASIC]: 30, [EFFECT.FIRST_NEXT_TURN]: 20, [EFFECT.LAST_NEXT_TURN]: 20, [EFFECT.PITY_POINTS]: 10, [EFFECT.UNIQUE_JUDGE]: 10 };
const tables: ContestActingTables = {
  effects: Array.from({ length: 24 }, (_, e) => ({
    description: [id('d1'), id('d2')],
    appeal: APPEAL[e] ?? 0,
    class: e === EFFECT.DOUBLED_JUDGE || e === EFFECT.UNIQUE_JUDGE || e === EFFECT.ALL_SAME_JUDGE ? 5 : e === EFFECT.PITY_POINTS ? 6 : 3,
    announce: e === EFFECT.UNIQUE_JUDGE || e === EFFECT.ALL_SAME_JUDGE,
    messages: [line, line, line, line, line],
  })),
  // The cyclic rule: +10 the same type, 0 a neighbour, −10 the two opposite.
  typeMatch: [0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((m) => (c === m ? 10 : (m - c + 5) % 5 === 1 || (c - m + 5) % 5 === 1 ? 0 : -10))),
  messages: [],
  rules: [],
  buttonPalettes: [],
};
/** Moves named by effect and type: `BASIC/0` is a cool BASIC move. */
const move = (effect: number, type: number) => id(`${effect}/${type}`);
const contest = (m: Id) => {
  const [e, t] = m.slice(5).split('/').map(Number);
  return { effect: e!, type: t! };
};

function turn(st: ActingState, choices: [Id, number][], rolls: number[] = []): ActingEngine {
  const e = new ActingEngine(tables, st, 0, contest, () => rolls.shift() ?? 0);
  choices.forEach(([m, j], c) => {
    st.moves[c] = m;
    st.judges[c] = j;
  });
  e.startTurn();
  return e;
}

/** One turn's acts and judging in the order, as the round runs them. */
function play(e: ActingEngine): void {
  const st = e.st;
  for (let pos = 0; pos < 4; pos++) {
    const c = st.order[pos]!;
    e.announce(c);
    e.base(c);
    e.immediate(c, pos);
    e.pending(c);
    e.voltage(c);
    e.commit();
  }
  for (let c = 0; c < 4; c++) e.share(c);
  for (let pos = 0; pos < 4; pos++) e.judgeEffect(st.order[pos]!, pos);
  e.pitySnapshot();
  for (let pos = 0; pos < 4; pos++) e.pity(st.order[pos]!, pos);
}

describe('acting rules', () => {
  it('scores the base appeal, raises the chosen judge’s voltage on a match and pays the max-voltage bonus', () => {
    const st = newActingState([0, 1, 2, 3]);
    st.voltage = [40, 40, 0];
    const e = turn(st, [
      [move(EFFECT.BASIC, 0), 1],
      [move(EFFECT.BASIC, 0), 0],
      [move(EFFECT.BASIC, 2), 2],
      [move(EFFECT.BASIC, 1), 2],
    ]);
    const a = e.base(0);
    expect(a.score).toBe(30);
    e.immediate(0, 0);
    e.pending(0);
    const v = e.voltage(0);
    expect(v.change).toBe(10);
    // The main judge (the middle seat) at five steps: +80; the voltage starts again from none once kept.
    expect(e.turn!.acts[0]!.maxBonus).toBe(80);
    expect(e.turn!.acts[0]!.score).toBe(110);
    e.commit();
    expect(st.voltage).toEqual([40, 0, 0]);
    // A side judge pays +50.
    e.base(1);
    e.voltage(1);
    expect(e.turn!.acts[1]!.score).toBe(80);
    e.commit();
    expect(st.voltage).toEqual([0, 0, 0]);
    // A mismatch (cute in a cool contest) lowers nothing at zero voltage; a neighbour type changes nothing.
    e.base(2);
    expect(e.voltage(2).change).toBe(0);
    e.base(3);
    expect(e.voltage(3).change).toBe(0);
  });

  it('lowers the voltage on a mismatch unless NO_VOLTAGE_DOWN came first, and SUPPRESS_VOLTAGE stops raises', () => {
    const st = newActingState([0, 1, 2, 3]);
    st.voltage = [20, 20, 20];
    const e = turn(st, [
      [move(EFFECT.BASIC, 2), 0],
      [move(EFFECT.NO_VOLTAGE_DOWN, 0), 1],
      [move(EFFECT.BASIC, 3), 1],
      [move(EFFECT.SUPPRESS_VOLTAGE, 0), 2],
    ]);
    e.base(0);
    e.immediate(0, 0);
    expect(e.voltage(0).change).toBe(-10);
    e.commit();
    expect(st.voltage).toEqual([10, 20, 20]);
    e.base(1);
    e.immediate(1, 1);
    expect(e.voltage(1).change).toBe(10);
    e.commit();
    e.base(2);
    e.immediate(2, 2);
    // After NO_VOLTAGE_DOWN (positions 1–3) a mismatch lowers nothing.
    expect(e.voltage(2).change).toBe(0);
    e.commit();
    // SUPPRESS_VOLTAGE reaches its own act: no raise.
    e.base(3);
    e.immediate(3, 3);
    expect(e.voltage(3).change).toBe(0);
  });

  it('shares the judges: +30 alone, +20, +10, nothing with all four; judges announced by popularity', () => {
    expect([0, 1, 2, 3].map(judgeShare)).toEqual([30, 20, 10, 0]);
    const st = newActingState([2, 0, 3, 1]);
    const e = turn(st, [
      [move(EFFECT.NONE, 1), 2],
      [move(EFFECT.NONE, 1), 0],
      [move(EFFECT.NONE, 1), 2],
      [move(EFFECT.NONE, 1), 1],
    ]);
    play(e);
    expect(e.turn!.acts.map((a) => a.score)).toEqual([20, 30, 20, 30]);
    expect(judgesByPopularity(st.order, st.judges)).toEqual([
      { judge: 2, contestants: [2, 0] },
      { judge: 0, contestants: [1] },
      { judge: 1, contestants: [3] },
    ]);
  });

  it('judges UNIQUE_JUDGE at the turn’s end and gives the pity points to the lowest act', () => {
    const st = newActingState([0, 1, 2, 3]);
    const e = turn(st, [
      [move(EFFECT.UNIQUE_JUDGE, 1), 0],
      [move(EFFECT.BASIC, 1), 1],
      [move(EFFECT.BASIC, 1), 1],
      [move(EFFECT.PITY_POINTS, 1), 2],
    ]);
    play(e);
    const acts = e.turn!.acts;
    // UNIQUE_JUDGE: 10 appeal, alone on its judge: +30 share, +30 effect.
    expect(acts[0]!.score).toBe(70);
    expect(acts[1]!.score).toBe(50);
    // PITY_POINTS: 10 appeal + 30 share = 40, lowest of all: +30.
    expect(acts[3]!.score).toBe(70);
  });

  it('orders the next turn by score, lowest first; a tie puts the later performer first; forced places win', () => {
    const none = [0, 1, 2, 3].map(() => ({ forced: 0, slot: 0 }));
    expect(nextOrder([0, 1, 2, 3], [50, 20, 50, 70], none)).toEqual([1, 2, 0, 3]);
    const forced = [{ forced: 2, slot: 3 }, { forced: 0, slot: 0 }, { forced: 1, slot: 0 }, { forced: 0, slot: 0 }];
    expect(nextOrder([0, 1, 2, 3], [10, 20, 90, 40], forced)).toEqual([2, 1, 3, 0]);
  });

  it('FIRST_NEXT_TURN takes the first place and pushes an earlier holder along', () => {
    const st = newActingState([0, 1, 2, 3]);
    const e = turn(st, [
      [move(EFFECT.FIRST_NEXT_TURN, 1), 0],
      [move(EFFECT.FIRST_NEXT_TURN, 1), 1],
      [move(EFFECT.NONE, 1), 2],
      [move(EFFECT.NONE, 1), 2],
    ]);
    play(e);
    expect(e.turn!.acts.map((a) => [a.forced, a.slot])).toEqual([
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 0],
    ]);
    // The second act says the first was pushed (variant 1, the other contestant 0).
    e.endTurn();
    expect(st.order.slice(0, 2)).toEqual([1, 0]);
  });

  it('takes the first turn’s order from the visual and dance rounds, highest first, ties to the lower id', () => {
    expect(firstActingOrder([8, 4, 8, 2], [10, 30, 10, 0], [3333, 3333, 3333])).toEqual([1, 0, 2, 3]);
    expect(firstActingOrder(null, null, [0, 0, 10000])).toEqual([3, 2, 1, 0]);
  });

  it('keeps last turn’s move off the menu unless CONSECUTIVE_USE unlocked it', () => {
    const st = newActingState([0, 1, 2, 3]);
    const repeat = move(EFFECT.CONSECUTIVE_USE, 0);
    const plain = move(EFFECT.BASIC, 0);
    const e = turn(st, [
      [plain, 0],
      [repeat, 1],
      [plain, 2],
      [plain, 2],
    ]);
    play(e);
    e.endTurn();
    expect(moveAllowed(st, 0, plain)).toBe(false);
    expect(moveAllowed(st, 1, repeat)).toBe(true);
    expect(moveAllowed(st, 0, repeat)).toBe(true);
  });

  it('the NPC AI weighs its rules, steers by the judges its condition marks, and breaks ties by the draws', () => {
    const st = newActingState([1, 0, 2, 3]);
    st.voltage = [40, 0, 0];
    const t: ContestActingTables = {
      ...tables,
      rules: [
        // Slot 1, voltage 40 somewhere (condition 20): +30 to BASIC, on the judges at 40.
        { slot: 1, condition: 20, target: EFFECT.BASIC, judges: 1, weights: [30, 0, 0, 0] },
        // Slot 1, a contest-type move (condition 15): +20 to those.
        { slot: 1, condition: 15, target: 240, judges: 0, weights: [20, 0, 0, 0] },
      ],
    };
    const draws = [5, 1, 1, 1, 0, 0, 0, 0];
    const pick = aiChoose({ tables: t, st, contestant: 1, moves: [move(EFFECT.BASIC, 1), move(EFFECT.NONE, 0)], level: 0, contestType: 0, rank: 3, playerJudge: 2, contest, rng: () => draws.shift()! });
    expect(pick).toEqual({ move: move(EFFECT.BASIC, 1), judge: 0 });
    // Equal scores: the moves' draws decide; no judge scored and the rank's chance hits: the player's judge loses 100.
    const tie = [1, 9, 0, 0, 0, 3, 5, 0];
    const st2 = newActingState([1, 0, 2, 3]);
    const p2 = aiChoose({ tables, st: st2, contestant: 1, moves: [move(EFFECT.NONE, 1), move(EFFECT.NONE, 2)], level: 0, contestType: 0, rank: 0, playerJudge: 1, contest, rng: () => tie.shift()! });
    expect(p2).toEqual({ move: move(EFFECT.NONE, 2), judge: 2 });
  });
});
