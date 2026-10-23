/**
 * The acting round's rules (docs/research/contests.md §7), headless and independent of the screens: the scoring
 * engine (decomp ov17_02245F14.c: the per-act steps, the effect handlers, the voltage), the judge share and the next
 * turn's order (ov17_02243AC4.c), the move menu's rule (ov17_02243A98), the NPC AI (ov17_02246ECC.c) and the first
 * turn's order from the visual and dance rounds (ov17_0223EEB8). The tables are the ROM's (`ContestActingTables`).
 *
 * The state mirrors the decomp's: `ActingState` is the round's (UnkStruct_ov17_022472F8), `TurnState` a turn's
 * (UnkStruct_ov17_02246540) and `Act` one contestant's in it (UnkStruct_ov17_022444BC). Each step resets the
 * contestant's step fields first (ov17_02246090) and keeps the snapshots the DS keeps, so the pity points, which
 * compare snapshots taken at different steps, come out as on the DS.
 */
import type { ContestActingTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

export const ACTING_TURNS = 4;
/** The main judge's seat (decomp Contest unk_10E, set to 1 in Contest_Init). */
export const MAIN_JUDGE = 1;
/** Ten points to the heart; the voltage meter's five steps. */
export const HEART = 10;
export const MAX_VOLTAGE = 50;

/** Decomp enum MoveContestEffect. */
export const EFFECT = {
  NONE: 0,
  FIRST_NEXT_TURN: 1,
  LAST_NEXT_TURN: 2,
  DOUBLED_JUDGE: 3,
  TWO_HEARTS_WHEN_VOLTAGE_UP: 4,
  BASIC: 5,
  UNIQUE_JUDGE: 6,
  CONSECUTIVE_USE: 7,
  VOLTAGE: 8,
  ALL_SAME_JUDGE: 9,
  LOWERS_VOLTAGE: 10,
  DOUBLE_NEXT_TURN: 11,
  STEAL_VOLTAGE: 12,
  SUPPRESS_VOLTAGE: 13,
  RANDOM_ORDER: 14,
  DOUBLE_FINAL_ACT: 15,
  LOW_VOLTAGE_ADVANTAGE: 16,
  FIRST_PERFORMANCE_ADVANTAGE: 17,
  FINAL_PERFORMANCE_ADVANTAGE: 18,
  NO_VOLTAGE_DOWN: 19,
  TWO_VOLTAGE_IN_A_ROW_ADVANTAGE: 20,
  HIGH_SCORE_LATER_TURN: 21,
  MAX_VOLTAGE_ADVANTAGE: 22,
  PITY_POINTS: 23,
} as const;

/** Decomp enum ActingCompetitionMessagesID (the index into `ContestActingTables.messages`). */
export const ACTING_MESSAGE = {
  NONE: 0,
  CHOOSE_JUDGE: 1,
  WHICH_MOVE: 2,
  LAST_PERFORMANCE: 3,
  TO_JUDGE_MON_PERFORMED_MOVE: 4,
  SOMEONE_ALREADY_PERFORMED_FOR_JUDGE: 5,
  JUDGE_STRONGLY_IMPRESSED: 7,
  JUDGE_WAS_IMPRESSED: 8,
  EVERYONE_PERFORMED_FOR_SAME_JUDGE: 9,
  JUDGE_VERY_IMPRESSED: 10,
  /** COOL … TOUGH_MOVE_VOLTAGE_UP: 12 + contest type. */
  VOLTAGE_UP: 12,
  /** COOL … TOUGH_MOVE_VOLTAGE_DOWN: 18 + contest type. */
  VOLTAGE_DOWN: 18,
  AUDIENCE_PRETTY_EXCITED: 25,
  AUDIENCE_GOING_WILD: 26,
  /** MON_DIDNT_STAND_OUT … MON_COMMANDED_TOTAL_ATTENTION: 31–35. */
  ATTENTION: 31,
  /** TIME_FOR_<TYPE>_ACTING_COMPETITION, in the decomp's order (Contest_GetActingCompetitionMessageIntroAnnouncement). */
  INTRO: [41, 40, 36, 38, 39],
  NEXT_TURN_LOWEST_FIRST: 42,
  JUDGING_IS_OVER: 43,
  BEGIN_PRACTICE: 45,
} as const;

/** A message's arguments (decomp UnkStruct_ov17_022449B8): two contestants, a move, a number, a judge seat. */
export interface MessageArgs {
  contestant: number;
  other: number;
  move: Id | null;
  number: number;
  judge: number;
}

/** The effect line an act shows after a step (decomp unk_12 the effect, unk_13 the variant), with its arguments (unk_0C). */
export interface EffectLine {
  effect: number;
  variant: number;
  args: MessageArgs;
}

/** One contestant's act in a turn (decomp UnkStruct_ov17_022444BC). */
export interface Act {
  move: Id;
  effect: number;
  /** The chosen judge seat (unk_03). */
  judge: number;
  /** The base appeal (unk_04). */
  base: number;
  /** The max-voltage bonus this act got (unk_08: 50, 80 at the main judge, else 0). */
  maxBonus: number;
  /** How many others picked the same judge (unk_09). */
  sameJudge: number;
  args: MessageArgs;
  line: EffectLine | null;
  /** The act's score (unk_18) and its snapshots: before the current step (unk_1A), before the pity step (unk_1C). */
  score: number;
  before: number;
  beforePity: number;
  /** The step's bonus (unk_1E). */
  bonus: number;
  /** SUPPRESS_VOLTAGE / NO_VOLTAGE_DOWN reached this act (unk_28_1, unk_28_2); LOWERS_VOLTAGE ran (unk_28_3). */
  suppressed: boolean;
  noDown: boolean;
  lowered: boolean;
  /** The next turn's forced place: 0 none, 1 first, 2 last, 3 random (unk_28_4), its slot (unk_28_6), and both before the act (unk_28_8, unk_28_10). */
  forced: number;
  slot: number;
  forcedBefore: number;
  slotBefore: number;
  /** DOUBLE_NEXT_TURN's effect, for the next turn (unk_28_12). */
  doubleNext: number;
}

/** A turn's scoring state (decomp UnkStruct_ov17_02246540). */
export interface TurnState {
  acts: Act[];
  /** Per contestant: the move CONSECUTIVE_USE unlocked for the next turn (unk_A0.moveID) and last turn's DOUBLE_NEXT_TURN (unk_A0.contestMoveEffect). */
  unlocked: (Id | null)[];
  doubled: number[];
  /** Per judge: the voltage before the current step (unk_B0) and now (unk_B3). */
  voltageBefore: number[];
  voltage: number[];
}

/** The round (decomp UnkStruct_ov17_022472F8). */
export interface ActingState {
  turn: number;
  /** Contestant ids by performance slot (unk_01). */
  order: number[];
  /** This turn's choices per contestant (moveIDs, unk_0E). */
  moves: Id[];
  judges: number[];
  /** The acting totals (unk_12) and last turn's scores (unk_1A). */
  totals: number[];
  turnScores: number[];
  /** Per judge, carried across turns (unk_22). */
  voltage: number[];
  /** The moves used last turn (unk_26). */
  lastMoves: (Id | null)[];
  /** The last turn's state (unk_30). */
  last: TurnState | null;
}

/** A move's contest data. */
export type MoveContest = (move: Id) => { effect: number; type: number };

/** The voltage the outcome of a voltage step shows (decomp UnkStruct_ov17_022463C4). */
export interface VoltageOutcome {
  /** −10, 0 or +10 as applied. */
  change: number;
  message: number;
  message2: number;
}

const blankArgs = (): MessageArgs => ({ contestant: 0, other: 0, move: null, number: 0, judge: 0 });

export function newActingState(firstOrder: readonly number[]): ActingState {
  return { turn: 0, order: [...firstOrder], moves: [], judges: [0, 0, 0, 0], totals: [0, 0, 0, 0], turnScores: [0, 0, 0, 0], voltage: [0, 0, 0], lastMoves: [null, null, null, null], last: null };
}

/**
 * Decomp ov17_0223EEB8 (the dance round's write-back) and Contest_Init: the first acting turn's order. A full contest
 * sorts by the visual and dance rounds normalised (ov17_02251930) and summed, highest first, ties keeping the lower
 * contestant id first; a practice runs 3, 2, 1, 0; the unused single competition 0, 1, 2, 3.
 */
export function firstActingOrder(visual: readonly number[] | null, dance: readonly number[] | null, weights: readonly [number, number, number]): number[] {
  if (!visual || !dance) return [3, 2, 1, 0];
  const norm = (raw: readonly number[], weight: number) => {
    const top = Math.max(...raw);
    if (top <= 0) throw new Error('contest acting: a round before acting has no points at all (the decomp divides by zero)');
    const f = Math.floor(weight / top);
    return raw.map((v) => Math.floor((v * f + 50) / 100));
  };
  const v = norm(visual, weights[0]);
  const d = norm(dance, weights[1]);
  const sum = [0, 1, 2, 3].map((i) => v[i]! + d[i]!);
  const order = [0, 1, 2, 3];
  for (let i = 0; i < 3; i++)
    for (let j = 3; j > i; j--)
      if (sum[j - 1]! < sum[j]!) {
        [sum[j - 1], sum[j]] = [sum[j]!, sum[j - 1]!];
        [order[j - 1], order[j]] = [order[j]!, order[j - 1]!];
      }
  return order;
}

/** Decomp ov17_02243A98: a move may be chosen unless it was used last turn and CONSECUTIVE_USE did not unlock it. */
export function moveAllowed(st: ActingState, contestant: number, move: Id | null): boolean {
  if (move === null) return false;
  return !(move === st.lastMoves[contestant] && st.last?.unlocked[contestant] !== move);
}

/** Decomp ov17_02243AC4: how many others picked this contestant's judge. */
export function sameJudge(judges: readonly number[], contestant: number): number {
  return judges.filter((j) => j === judges[contestant]).length - 1;
}

/** Decomp ov17_02243AE4: the judge share: +30, +20, +10, 0 for 0–3 others on the judge. */
export function judgeShare(others: number): number {
  return [30, 20, 10, 0][others]!;
}

/** Decomp ov17_0224314C: the attention line for the player's turn score. */
export function attentionMessage(score: number): number {
  if (score <= 0) return ACTING_MESSAGE.ATTENTION;
  if (score <= 20) return ACTING_MESSAGE.ATTENTION + 1;
  if (score <= 50) return ACTING_MESSAGE.ATTENTION + 2;
  if (score <= 90) return ACTING_MESSAGE.ATTENTION + 3;
  return ACTING_MESSAGE.ATTENTION + 4;
}

/** Decomp ov17_02243174: the applause's volume for an acting total (0 none). */
export function applauseVolume(total: number): number {
  return [0, 40, 70, 100][Math.min(3, Math.floor(total / 50))]!;
}

/**
 * The scoring engine of one round: the decomp's per-act and end-of-turn steps over the state. `rng` is the contest
 * LCRNG (RANDOM_ORDER draws from it), `contestType` the contest's type.
 */
export class ActingEngine {
  turn: TurnState | null = null;

  constructor(
    readonly tables: ContestActingTables,
    readonly st: ActingState,
    readonly contestType: number,
    readonly contest: MoveContest,
    private readonly rng: () => number,
  ) {}

  /** typeMatch[contest type][the move's contest type] (decomp ov17_02243AF0). */
  match(move: Id): number {
    return this.tables.typeMatch[this.contestType]![this.contest(move).type]!;
  }

  appeal(effect: number): number {
    return this.effect(effect).appeal;
  }

  private effect(effect: number) {
    const e = this.tables.effects[effect];
    if (!e) throw new Error(`contest acting: no contest effect ${effect}`);
    return e;
  }

  private get t(): TurnState {
    if (!this.turn) throw new Error('contest acting: no turn is running');
    return this.turn;
  }

  /** The message arguments for a contestant (decomp ov17_02243120). */
  args(contestant: number): MessageArgs {
    return { ...blankArgs(), contestant, move: this.st.moves[contestant] ?? null, judge: this.st.judges[contestant]! };
  }

  /**
   * Decomp ov17_02245F44: the turn's state once everyone has chosen: last turn's carried over (its CONSECUTIVE_USE
   * unlocks and DOUBLE_NEXT_TURN), the acts fresh.
   */
  startTurn(): TurnState {
    const last = this.st.last;
    const acts = [0, 1, 2, 3].map((c): Act => {
      const move = this.st.moves[c];
      if (!move) throw new Error(`contest acting: contestant ${c} has no move this turn`);
      return {
        move,
        effect: this.contest(move).effect,
        judge: this.st.judges[c]!,
        base: 0,
        maxBonus: 0,
        sameJudge: sameJudge(this.st.judges, c),
        args: this.args(c),
        line: null,
        score: 0,
        before: 0,
        beforePity: 0,
        bonus: 0,
        suppressed: false,
        noDown: false,
        lowered: false,
        forced: 0,
        slot: 0,
        forcedBefore: 0,
        slotBefore: 0,
        doubleNext: 0,
      };
    });
    this.turn = { acts, unlocked: [null, null, null, null], doubled: last ? last.acts.map((a) => a.doubleNext) : [0, 0, 0, 0], voltageBefore: [...(last?.voltageBefore ?? [0, 0, 0])], voltage: [...(last?.voltage ?? [0, 0, 0])] };
    return this.turn;
  }

  /** Decomp ov17_02246090: the step's start for a contestant. */
  private begin(c: number): Act {
    const t = this.t;
    const a = t.acts[c]!;
    a.before = a.score;
    a.bonus = 0;
    t.voltageBefore = [...t.voltage];
    for (const x of t.acts) x.line = null;
    return a;
  }

  /** Decomp ov17_02245F14: sets the act's effect line (`null` keeps an argument, the decomp's 30000). */
  private say(a: Act, effect: number, variant: number, o: { contestant?: number; other?: number; move?: Id; number?: number } = {}): void {
    if (o.contestant !== undefined) a.args.contestant = o.contestant;
    if (o.other !== undefined) a.args.other = o.other;
    if (o.move !== undefined) a.args.move = o.move;
    if (o.number !== undefined) a.args.number = o.number;
    a.line = { effect, variant, args: a.args };
  }

  /** Decomp ov17_0223BF1C: someone already performed for this contestant's judge this turn. */
  alreadyJudged(pos: number): boolean {
    const c = this.st.order[pos]!;
    return this.st.order.slice(0, pos).some((o) => this.st.judges[o] === this.st.judges[c]);
  }

  /** Decomp ov17_022460DC: an effect announced before the act (its variant 4). */
  announce(c: number): Act {
    const a = this.begin(c);
    const e = this.effect(a.effect);
    if (e.announce && e.messages[4]) this.say(a, a.effect, 4, { contestant: c });
    return a;
  }

  /** Decomp ov17_02245FB4 and ov17_02246138: the turn's voltage snapshot, then the base appeal. */
  base(c: number): Act {
    const t = this.t;
    for (const x of t.acts) {
      x.forcedBefore = x.forced;
      x.slotBefore = x.slot;
    }
    t.voltageBefore = [...this.st.voltage];
    t.voltage = [...this.st.voltage];
    const a = this.begin(c);
    a.base = this.appeal(a.effect);
    a.score = a.base;
    return a;
  }

  /** Decomp ov17_02246160: the effect, when it is scored in the act (class 3; class 2 has no effects). */
  immediate(c: number, pos: number): Act {
    const a = this.begin(c);
    if (this.effect(a.effect).class === 3) {
      this.run(a.effect, c, pos);
      a.score += a.bonus;
    }
    return a;
  }

  /** Decomp ov17_02246228: last turn's DOUBLE_NEXT_TURN adds the act's score so far. */
  pending(c: number): Act {
    const t = this.t;
    const a = this.begin(c);
    const effect = t.doubled[c]!;
    if (effect !== EFFECT.NONE) {
      const v = a.score;
      a.bonus += v;
      this.say(a, effect, 0, { contestant: c, number: Math.trunc(v / HEART) });
    }
    a.score += a.bonus;
    return a;
  }

  /** Decomp ov17_022463C4: the chosen judge's voltage, the max-voltage bonus and the lines they show. */
  voltage(c: number): VoltageOutcome {
    const t = this.t;
    const a = this.begin(c);
    const j = a.judge;
    let change = this.match(a.move);
    if (change > 0 && !a.suppressed) {
      t.voltage[j] = Math.min(MAX_VOLTAGE, t.voltage[j]! + change);
    } else if (change < 0 && !a.noDown && t.voltage[j]! > 0) {
      t.voltage[j] = Math.max(0, t.voltage[j]! + change);
    } else change = 0;
    if (t.voltage[j]! >= MAX_VOLTAGE) a.maxBonus = j === MAIN_JUDGE ? 80 : 50;
    const type = this.contest(a.move).type;
    let message: number = ACTING_MESSAGE.NONE;
    let message2: number = ACTING_MESSAGE.NONE;
    if (change > 0) {
      message = ACTING_MESSAGE.VOLTAGE_UP + type;
      const level = Math.trunc(t.voltage[j]! / HEART);
      if (level === 4) message2 = ACTING_MESSAGE.AUDIENCE_PRETTY_EXCITED;
      else if (level === 5) message2 = ACTING_MESSAGE.AUDIENCE_GOING_WILD;
    } else if (change < 0) message = ACTING_MESSAGE.VOLTAGE_DOWN + type;
    a.score += a.maxBonus;
    return { change, message, message2 };
  }

  /** Decomp ov17_02246018: the act's voltage is kept; a judge at five steps starts again from none. */
  commit(): void {
    this.st.voltage = this.t.voltage.map((v) => (v >= MAX_VOLTAGE ? 0 : v));
  }

  /** Decomp ov17_02246518: the judge share, for everyone. */
  share(c: number): Act {
    const a = this.begin(c);
    a.score += judgeShare(a.sameJudge);
    return a;
  }

  /** Decomp ov17_02246304: an effect judged at the turn's end (class 5). False when it has none. */
  judgeEffect(c: number, pos: number): boolean {
    const a = this.begin(c);
    if (this.effect(a.effect).class !== 5) return false;
    this.run(a.effect, c, pos);
    a.score += a.bonus;
    return true;
  }

  /** Decomp ov17_022460C8: the scores before the pity step. */
  pitySnapshot(): void {
    for (const a of this.t.acts) a.beforePity = a.score;
  }

  /** Decomp ov17_02246364: the pity points (class 6). False when the act has none. */
  pity(c: number, pos: number): boolean {
    const a = this.begin(c);
    if (this.effect(a.effect).class !== 6) return false;
    this.run(a.effect, c, pos);
    a.score += a.bonus;
    return true;
  }

  /**
   * Decomp ov17_0223C888 state 4: the totals (ov17_02246044), the next turn's order (ov17_02243B0C), the moves used,
   * the turn count.
   */
  endTurn(): void {
    const t = this.t;
    t.acts.forEach((a, c) => {
      this.st.totals[c]! += a.score;
      this.st.turnScores[c] = a.score;
    });
    this.st.last = t;
    this.st.order = nextOrder(this.st.order, this.st.turnScores, t.acts);
    this.st.lastMoves = [...this.st.moves];
    this.st.turn++;
    this.turn = null;
  }

  /** Decomp Unk_ov17_02253AF8's handlers. */
  private run(effect: number, c: number, pos: number): void {
    const t = this.t;
    const a = t.acts[c]!;
    const st = this.st;
    switch (effect) {
      case EFFECT.NONE:
      case EFFECT.BASIC:
        return;
      case EFFECT.FIRST_NEXT_TURN:
        return this.force(c, 1);
      case EFFECT.LAST_NEXT_TURN:
        return this.force(c, 2);
      case EFFECT.DOUBLED_JUDGE:
        a.bonus += a.sameJudge * 20;
        this.say(a, effect, Math.min(3, a.sameJudge), { contestant: c });
        return;
      case EFFECT.TWO_HEARTS_WHEN_VOLTAGE_UP:
        if (this.match(a.move) > 0 && !a.suppressed) {
          a.bonus += 20;
          this.say(a, effect, 0, { contestant: c, move: a.move });
        }
        return;
      case EFFECT.UNIQUE_JUDGE:
        if (a.sameJudge === 0) {
          a.bonus += 30;
          this.say(a, effect, 0, { contestant: c });
        } else this.say(a, effect, 1, { contestant: c });
        return;
      case EFFECT.CONSECUTIVE_USE:
        if (a.move !== st.lastMoves[c]) {
          t.unlocked[c] = a.move;
          this.say(a, effect, 0, { contestant: c });
        }
        return;
      case EFFECT.VOLTAGE: {
        const v = t.voltageBefore[a.judge]!;
        a.bonus += v;
        this.say(a, effect, 0, { number: Math.trunc(v / HEART) });
        return;
      }
      case EFFECT.ALL_SAME_JUDGE:
        if (a.sameJudge === 3) {
          a.bonus += 150;
          this.say(a, effect, 0, { contestant: c });
        } else this.say(a, effect, 1, { contestant: c });
        return;
      case EFFECT.LOWERS_VOLTAGE:
        if (a.noDown || t.voltage.every((v) => v === 0)) return;
        a.lowered = true;
        t.voltage = t.voltage.map((v) => (v > 0 ? v - 10 : v));
        this.say(a, effect, 0);
        return;
      case EFFECT.DOUBLE_NEXT_TURN:
        a.doubleNext = a.effect;
        return;
      case EFFECT.STEAL_VOLTAGE: {
        if (pos === 0) return;
        const prev = st.order[pos - 1]!;
        if (t.acts[prev]!.maxBonus === 0) return;
        a.bonus += t.acts[prev]!.maxBonus;
        this.say(a, effect, 0, { contestant: c, other: prev });
        return;
      }
      case EFFECT.SUPPRESS_VOLTAGE:
        for (let p = pos; p < 4; p++) t.acts[st.order[p]!]!.suppressed = true;
        this.say(a, effect, 0);
        return;
      case EFFECT.RANDOM_ORDER: {
        const slots = [0, 1, 2, 3];
        const free = [0, 1, 2, 3];
        for (let k = 0; k < 4; k++) {
          let n = (this.rng() % (4 - k)) & 0xff;
          for (let i = 0; i < 4; i++) {
            if (free[i] === -1) continue;
            if (n === 0) {
              slots[i] = k;
              free[i] = -1;
              break;
            }
            n--;
          }
        }
        t.acts.forEach((x, i) => {
          x.forced = 3;
          x.slot = slots[i]!;
        });
        this.say(a, effect, 0);
        return;
      }
      case EFFECT.DOUBLE_FINAL_ACT:
        if (pos === 3) {
          a.bonus += a.score;
          this.say(a, effect, 0, { number: Math.trunc(a.score / HEART) });
        }
        return;
      case EFFECT.LOW_VOLTAGE_ADVANTAGE: {
        const v = [40, 30, 20, 10, 0, 0][Math.trunc(t.voltageBefore[a.judge]! / HEART)]!;
        a.bonus += v;
        this.say(a, effect, 0, { number: Math.trunc(v / HEART) });
        return;
      }
      case EFFECT.FIRST_PERFORMANCE_ADVANTAGE:
        if (pos === 0) {
          a.bonus += 20;
          this.say(a, effect, 0);
        }
        return;
      case EFFECT.FINAL_PERFORMANCE_ADVANTAGE:
        if (pos === 3) {
          a.bonus += 20;
          this.say(a, effect, 0);
        }
        return;
      case EFFECT.NO_VOLTAGE_DOWN:
        for (let p = pos; p < 4; p++) t.acts[st.order[p]!]!.noDown = true;
        this.say(a, effect, 0);
        return;
      case EFFECT.TWO_VOLTAGE_IN_A_ROW_ADVANTAGE: {
        if (pos === 0) return;
        const prev = st.order[pos - 1]!;
        const p = t.acts[prev]!;
        if (a.suppressed || p.suppressed) return;
        if (this.match(p.move) > 0 && this.match(a.move) > 0) {
          a.bonus += 30;
          this.say(a, effect, 0, { contestant: c, other: prev });
        }
        return;
      }
      case EFFECT.HIGH_SCORE_LATER_TURN:
        a.bonus += [10, 20, 30, 40][pos]!;
        this.say(a, effect, Math.min(3, pos), { contestant: c });
        return;
      case EFFECT.MAX_VOLTAGE_ADVANTAGE: {
        if (pos === 0) return;
        if (t.acts[st.order[pos - 1]!]!.maxBonus >= MAX_VOLTAGE) {
          a.bonus += 30;
          this.say(a, effect, 0, { contestant: c });
        }
        return;
      }
      case EFFECT.PITY_POINTS:
        // Decomp ov17_02246E68: no other act's snapshot (unk_1A) under this act's score before the pity step (unk_1C).
        if (t.acts.some((x, i) => i !== c && x.before < a.beforePity)) return;
        a.bonus += 30;
        this.say(a, effect, 0, { contestant: c });
        return;
    }
    throw new Error(`contest acting: contest effect ${effect} has no handler`);
  }

  /**
   * Decomp ov17_02246578 (FIRST_NEXT_TURN, kind 1) and ov17_02246668 (LAST_NEXT_TURN, kind 2): the contestant takes
   * the first (last) slot; others already forced there move one along while they are packed (the slot is 2 bits
   * on the DS: a push past the last slot wraps to 0, a push before the first is dropped).
   */
  private force(c: number, kind: 1 | 2): void {
    const t = this.t;
    const a = t.acts[c]!;
    const target = kind === 1 ? 0 : 3;
    let previous = -1;
    const slots = t.acts.map((x, i) => {
      if (x.forced === 0) return null;
      if (x.forced === kind && x.slot === target) previous = i;
      return x.slot;
    });
    slots[c] = null;
    const steps = kind === 1 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    for (const s of steps) {
      const i = slots.findIndex((v, k) => v !== null && v === s && v === t.acts[k]!.slot);
      if (i < 0) break;
      slots[i] = slots[i]! + (kind === 1 ? 1 : -1);
    }
    slots.forEach((v, i) => {
      // u8 arithmetic: −1 is 0xFF, which the decomp skips; 4 lands in the 2-bit field as 0.
      if (v !== null && v >= 0) t.acts[i]!.slot = v & 3;
    });
    a.forced = kind;
    a.slot = target;
    if (previous >= 0) this.say(a, a.effect, 1, { contestant: c, other: previous });
    else this.say(a, a.effect, 0, { contestant: c });
  }
}

/**
 * Decomp ov17_02243B0C: the next turn's order: by this turn's score, lowest first; on a tie whoever performed later
 * goes first. Forced places override the score: first −30000 + 10·slot, last 29970 + 10·slot, random
 * {−10000, −500, 500, 10000}[slot].
 */
export function nextOrder(order: readonly number[], scores: readonly number[], acts: readonly Pick<Act, 'forced' | 'slot'>[]): number[] {
  const key = [0, 1, 2, 3].map((c) => {
    const a = acts[c]!;
    if (a.forced === 1) return -30000 + 10 * a.slot;
    if (a.forced === 2) return 29970 + 10 * a.slot;
    if (a.forced === 3) return [-10000, -500, 500, 10000][a.slot]!;
    return scores[c]!;
  });
  const ids = [0, 1, 2, 3];
  const was = ids.map((c) => order.indexOf(c));
  for (let i = 0; i < 3; i++)
    for (let j = 3; j > i; j--)
      if (key[j - 1]! > key[j]! || (key[j - 1] === key[j] && was[j - 1]! < was[j]!)) {
        [key[j - 1], key[j]] = [key[j]!, key[j - 1]!];
        [ids[j - 1], ids[j]] = [ids[j]!, ids[j - 1]!];
        [was[j - 1], was[j]] = [was[j]!, was[j - 1]!];
      }
  return ids;
}

/**
 * Decomp ov17_0223C350 state 7: the judges by how many picked them (most first; a tie keeps the seat order), each with
 * the contestants on it in performance order.
 */
export function judgesByPopularity(order: readonly number[], judges: readonly number[]): { judge: number; contestants: number[] }[] {
  const count = [0, 0, 0];
  const on: number[][] = [[], [], []];
  for (const c of order) {
    count[judges[c]!]!++;
    on[judges[c]!]!.push(c);
  }
  const seats = [0, 1, 2];
  for (let i = 0; i < 2; i++)
    for (let j = 2; j > i; j--)
      if (count[j - 1]! < count[j]!) {
        [count[j - 1], count[j]] = [count[j]!, count[j - 1]!];
        [seats[j - 1], seats[j]] = [seats[j]!, seats[j - 1]!];
      }
  return seats.map((judge) => ({ judge, contestants: on[judge]! }));
}

/** The NPC AI's view of one of its moves (decomp UnkStruct_ov17_02246F9C_sub1). */
interface AiMove {
  move: Id | null;
  effect: number;
  type: number;
  score: number;
  judges: number[];
}

/**
 * Decomp ov17_02246F9C: an NPC's move and judge. The moves it may use (the menu rule), the rules for its performance
 * slot whose condition holds add their weight (`weights[level]`, plus `weights[0]` above level 0) to the matching moves
 * and to the judges the condition marked; the best move wins (ties by a fresh draw each), then, outside link play, when
 * that move scored no judge, the rank's chance (230, 128, 51, 0 of 256) puts −100 on the player's judge; the best judge
 * wins (ties by a draw each). Draws: four for the moves, three for the judges, then the chance's.
 */
export function aiChoose(o: { tables: ContestActingTables; st: ActingState; contestant: number; moves: readonly Id[]; level: number; contestType: number; rank: number; playerJudge: number; contest: MoveContest; rng: () => number }): { move: Id; judge: number } {
  const { tables, st, contestant: c, level } = o;
  const moves: AiMove[] = [0, 1, 2, 3].map((k) => {
    const move = o.moves[k] ?? null;
    if (!moveAllowed(st, c, move)) return { move: null, effect: 0, type: 0, score: 0, judges: [0, 0, 0] };
    const d = o.contest(move!);
    return { move, effect: d.effect, type: d.type, score: 0, judges: [0, 0, 0] };
  });
  const slot = st.order.indexOf(c) + 1;
  for (const rule of tables.rules) {
    if (rule.slot !== slot) continue;
    const marks = [false, false, false];
    if (!aiCondition(rule.condition, st, c, moves, marks, o.contestType)) continue;
    if (rule.judges === 0) marks.fill(false);
    else if (rule.judges === 2 || rule.judges === 3) for (let j = 0; j < 3; j++) marks[j] = !marks[j];
    const weight = rule.weights[level]! + (level !== 0 ? rule.weights[0]! : 0);
    for (const m of moves) {
      const hit = rule.target === 240 ? o.contestType === m.type : rule.target === 241 ? tables.effects[m.effect]!.appeal >= 20 : rule.target === m.effect;
      if (!hit) continue;
      m.score += weight;
      for (let j = 0; j < 3; j++) if (marks[j]) m.judges[j]! += weight;
    }
  }
  const moveDraws = [0, 1, 2, 3].map(() => o.rng());
  const judgeDraws = [0, 1, 2].map(() => o.rng());
  let best = moves.findIndex((m) => m.move !== null);
  if (best < 0) throw new Error(`contest acting: contestant ${c} has no move it may use`);
  for (let k = best + 1; k < 4; k++) {
    const m = moves[k]!;
    if (m.move === null) continue;
    if (m.score > moves[best]!.score || (m.score === moves[best]!.score && moveDraws[k]! > moveDraws[best]!)) best = k;
  }
  const chosen = moves[best]!;
  if (chosen.judges.every((v) => v === 0)) {
    const chance = [230, 128, 51, 0][o.rank]!;
    if ((o.rng() & 0xff) < chance) chosen.judges[o.playerJudge]! -= 100;
  }
  let judge = 0;
  for (let j = 1; j < 3; j++) if (chosen.judges[j]! > chosen.judges[judge]! || (chosen.judges[j] === chosen.judges[judge] && judgeDraws[j]! > judgeDraws[judge]!)) judge = j;
  return { move: chosen.move!, judge };
}

/** Decomp Unk_ov17_02253BBC: the AI's conditions (1–28). `marks` gets the judges a condition names. */
function aiCondition(id: number, st: ActingState, c: number, moves: readonly AiMove[], marks: boolean[], contestType: number): boolean {
  const has = (effect: number) => moves.some((m) => m.effect === effect);
  const typed = () => moves.some((m) => m.type === contestType);
  const mark = (test: (v: number) => boolean) => {
    let n = 0;
    st.voltage.forEach((v, j) => {
      if (test(v)) {
        marks[j] = true;
        n++;
      }
    });
    return n;
  };
  const lowest = () => st.totals.every((t) => !(st.totals[c]! > t));
  switch (id) {
    case 1:
      // The turn counter is 0–3 while the AI chooses: this never holds (inferred).
      return st.turn === 4;
    case 2:
      // unk_30.unk_A0: the double last turn's state carried in (the one that applied last turn), not this turn's.
      return (st.last?.doubled[c] ?? EFFECT.NONE) !== EFFECT.NONE;
    case 3:
      return has(EFFECT.BASIC);
    case 4:
      return has(EFFECT.ALL_SAME_JUDGE);
    case 5:
      return has(EFFECT.STEAL_VOLTAGE);
    case 6:
      return has(EFFECT.DOUBLE_FINAL_ACT);
    case 7:
      return has(EFFECT.FIRST_PERFORMANCE_ADVANTAGE);
    case 8:
      return has(EFFECT.FINAL_PERFORMANCE_ADVANTAGE);
    case 9:
      return has(EFFECT.NO_VOLTAGE_DOWN);
    case 10:
      return has(EFFECT.TWO_VOLTAGE_IN_A_ROW_ADVANTAGE);
    case 11:
      return has(EFFECT.HIGH_SCORE_LATER_TURN);
    case 12:
      return lowest();
    case 13:
      return st.turn === 4 && lowest();
    case 14:
      return moves.some((m) => m.effect === EFFECT.TWO_HEARTS_WHEN_VOLTAGE_UP && m.type === contestType);
    case 15:
      return typed();
    case 16:
      return typed() && mark((v) => v === 40) > 0;
    case 17:
      return typed() && mark((v) => v === 30) > 0;
    case 18:
      return has(EFFECT.VOLTAGE);
    case 19:
      return has(EFFECT.SUPPRESS_VOLTAGE);
    case 20:
      return mark((v) => v === 40) > 0;
    case 21:
      return mark((v) => v === 30) > 0;
    case 22:
      return mark((v) => v <= 10) > 0;
    case 23:
      if (st.voltage.some((v) => v < 20)) return false;
      marks.fill(true);
      return true;
    case 24:
      if (st.voltage.some((v) => v > 20)) return false;
      marks.fill(true);
      return true;
    case 25:
      return mark((v) => v <= 20) === 1;
    case 26:
      return mark((v) => v === 40) === 2;
    case 27:
      return mark((v) => v === 0) === 1;
    case 28:
      return typed() && mark((v) => v === 40) > 0;
  }
  throw new Error(`contest acting: AI condition ${id}`);
}
