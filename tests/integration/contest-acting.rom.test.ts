/**
 * The acting round on the ROM (docs/research/contests.md §7): the imported tables (appeal, effect classes, the type
 * table, the acting messages, the AI's rules, the art), an NPC AI decision worked out by hand from the ROM's rules,
 * the move animations the contest mode of the animation VM plays, and a whole acting round driven by keys.
 */
import { describe, expect, it } from 'vitest';
import { CONTEST_COMPETITION, type ContestActingTables, type ContestRound, type InputFrame, type NewGame } from '@opensinnoh/contracts';
import { setupPokemon } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { contestAnimCoverage, createBattle, createContestMoveAnimation } from '@opensinnoh/battle';
import { actingRules, createApp, createContestRound } from '@opensinnoh/menus';
import { conditionPoints, contestRandom, newContest } from '@opensinnoh/services';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

const game = (seed = 1) => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
const acting = (): ContestActingTables => (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.contests!.acting!;
const P = (s: string) => `platinum:${s}` as Id;
const { EFFECT } = actingRules;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Super Contests: the acting round (OPENSINNOH_NDS_ROM)', () => {
  it('imports the acting tables: appeal and classes per effect, the type table, the messages, the AI rules, the art', () => {
    const t = acting();
    expect(t.effects).toHaveLength(24);
    // Unk_020F568C's base appeal (docs/research/contests.md §7.6).
    const appeal = (e: number) => t.effects[e]!.appeal;
    expect(appeal(EFFECT.BASIC)).toBe(30);
    expect([EFFECT.FIRST_NEXT_TURN, EFFECT.TWO_HEARTS_WHEN_VOLTAGE_UP, EFFECT.NO_VOLTAGE_DOWN, EFFECT.MAX_VOLTAGE_ADVANTAGE].map(appeal)).toEqual([20, 20, 20, 20]);
    expect([EFFECT.UNIQUE_JUDGE, EFFECT.TWO_VOLTAGE_IN_A_ROW_ADVANTAGE, EFFECT.PITY_POINTS].map(appeal)).toEqual([10, 10, 10]);
    expect([EFFECT.VOLTAGE, EFFECT.DOUBLE_NEXT_TURN, EFFECT.HIGH_SCORE_LATER_TURN].map(appeal)).toEqual([0, 0, 0]);
    // Unk_ov17_02253AF8's classes and the announced effects.
    expect(t.effects.map((e, i) => [i, e.class]).filter(([, c]) => c !== 3)).toEqual([
      [EFFECT.DOUBLED_JUDGE, 5],
      [EFFECT.UNIQUE_JUDGE, 5],
      [EFFECT.ALL_SAME_JUDGE, 5],
      [EFFECT.PITY_POINTS, 6],
    ]);
    expect(t.effects.flatMap((e, i) => (e.announce ? [i] : []))).toEqual([EFFECT.UNIQUE_JUDGE, EFFECT.ALL_SAME_JUDGE]);
    // The cyclic voltage table.
    expect(t.typeMatch).toEqual([
      [10, 0, -10, -10, 0],
      [0, 10, 0, -10, -10],
      [-10, 0, 10, 0, -10],
      [-10, -10, 0, 10, 0],
      [0, -10, -10, 0, 10],
    ]);
    expect(t.rules).toHaveLength(165);
    expect(t.rules[0]).toEqual({ slot: 1, condition: 20, target: 240, judges: 1, weights: [70, 20, 20, -20] });
    expect(t.messages).toHaveLength(47);
    const texts = romSlice().pack.registries.texts as { id: string }[];
    const ids = new Set(texts.map((x) => x.id));
    expect(t.messages[2]!.text).toBe(P('Contest_Text_WhichMoveIsYourChoice'));
    expect(t.messages.every((m) => ids.has(m.text))).toBe(true);
    expect(t.effects.flatMap((e) => [...e.description, ...e.messages.flatMap((m) => (m ? [m.text] : []))]).every((x) => ids.has(x))).toBe(true);
    expect(t.buttonPalettes.map((p) => p.length)).toEqual([16, 16, 16, 16, 16]);
    const sheets = new Set((romSlice().pack.registries.ui2d as { id: string }[]).map((s) => s.id));
    for (const s of ['stage', 'stage_cheer', 'stage_glow', 'window', 'panel', 'judge_0', 'judge_box_1', 'main_judge', 'reaction', 'hearts', 'pip', 'star', 'order', 'menu_bg', 'menu_judges', 'move_button']) expect(sheets.has(`platinum:ui2d/contest/acting/${s}`), s).toBe(true);
  });

  it('the NPC AI follows the ROM rules: first to perform with a judge at 40, it plays its Cool BASIC move to that judge', () => {
    const g = game();
    const moves = [...g.registries.moves.values()];
    const coolBasic = moves.find((m) => m.contest.type === 0 && m.contest.effect === EFFECT.BASIC)!.id;
    const beautyDoubled = moves.find((m) => m.contest.type === 1 && [EFFECT.DOUBLED_JUDGE, EFFECT.CONSECUTIVE_USE, EFFECT.DOUBLE_FINAL_ACT].includes(m.contest.effect as never))!.id;
    const st = actingRules.newActingState([1, 0, 2, 3]);
    st.voltage = [0, 40, 0];
    const contest = (m: Id) => g.registries.moves.get(m)!.contest;
    for (const level of [0, 3]) {
      // Slot 1: rule 0 (a judge at 40, a Cool move: 70, marks that judge), rule 13 (a Cool move: 15), rule 28 (has BASIC:
      // 30); level 3 adds weights[3] (−20, 20, −20) to weights[0]. The Beauty move scores nothing.
      for (const order of [[beautyDoubled, coolBasic], [coolBasic, beautyDoubled]]) {
        const pick = actingRules.aiChoose({ tables: acting(), st, contestant: 1, moves: order, level, contestType: 0, rank: 0, playerJudge: 0, contest, rng: () => 7 });
        expect(pick).toEqual({ move: coolBasic, judge: 1 });
      }
    }
  });

  it('plays move animations in contest mode: most move scripts run, the rest are counted', () => {
    const reg = game().registries;
    const cov = contestAnimCoverage(reg);
    expect(cov.moves).toBeGreaterThan(450);
    // Report the coverage (the battle plays its own; the contest's differs by the contest-only sprite callbacks).
    console.log(`contest move animations: ${cov.real}/${cov.moves}; missing ${JSON.stringify([...cov.missing].sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
    expect(cov.real / cov.moves).toBeGreaterThan(0.6);
    // One animation end to end: the performer moves (Tackle) and the run ends.
    const run = createContestMoveAnimation({ move: P('MOVE_TACKLE'), attacker: { species: P('SPECIES_STARAVIA'), form: 0 }, defender: { species: P('SPECIES_PIKACHU'), form: 0 }, effectChance: 0, seed: 1 }, { registries: reg, log: new CountingStubLog(() => {}) });
    expect(run).not.toBeNull();
    let moved = false;
    let ticks = 0;
    while (!run!.done) {
      run!.tick();
      ticks++;
      const b = run!.view().battlers.find((x) => x.battler === 0);
      if (b && (b.dx || b.dy)) moved = true;
    }
    expect(ticks).toBeGreaterThan(10);
    expect(moved).toBe(true);
  });

  it('a whole practice acting round on keys: four turns, the AI, the voltage, the points; the same seed twice the same', () => {
    const runRound = (seed: number) => {
      const g = game(seed);
      g.state.party.push(setupPokemon(g.state, g.registries, 0, P('SPECIES_STARAVIA'), 20, [P('MOVE_WING_ATTACK'), P('MOVE_QUICK_ATTACK'), P('MOVE_AERIAL_ACE'), P('MOVE_GROWL')]));
      const session = newContest(g.state, g.registries, { mode: 'practice', rank: 0, type: 0, competition: CONTEST_COMPETITION.practiceActing, partySlot: 0, seed });
      session.scores = { condition: session.entrants.map((e) => conditionPoints(g.registries, e.mon, session.type)), dressUp: null, dance: null, acting: null };
      const log = new CountingStubLog(() => {});
      const host = { options: () => ({ textSpeed: 2 }), contestAnimation: createContestMoveAnimation } as never;
      const round: ContestRound = createContestRound('acting', { session, registries: g.registries, state: g.state, host, log, rng: () => contestRandom(session) });
      expect(round.placeholder).toBe(false);
      let out = null;
      let ticks = 0;
      const press = (b: Button | null): InputFrame => ({ held: b ? [b] : [], pressed: b ? [b] : [], touch: null });
      let chose = 0;
      let wasChoosing = false;
      while (!out) {
        if (++ticks > 30 * 60 * 30) throw new Error('the acting round did not end');
        // While the menus are up, A every other frame: the first shows the cursor, the next picks move slot 0, then judge 0;
        // a disabled move (used last turn) moves the cursor to its neighbour instead.
        const choosing = session.acting!.choosing;
        if (choosing && !wasChoosing) chose++;
        wasChoosing = choosing;
        const view = round.view();
        const choice = view.round === 'acting' && !view.placeholder ? view.choice : null;
        const key: Button | null = !choosing || ticks % 2 ? null : choice?.stage === 'move' && choice.cursor !== null && choice.moves[choice.cursor]?.disabled ? (choice.cursor % 2 ? 'left' : 'right') : 'a';
        out = round.step(press(key));
      }
      return { out, totals: out.kind === 'acting' ? out.points : [], chose, turn: session.acting!.turn, rng: session.rng, stubs: log };
    };
    const a = runRound(5);
    expect(a.out.kind).toBe('acting');
    expect(a.chose).toBe(4);
    expect(a.turn).toBe(4);
    expect(a.totals).toHaveLength(4);
    expect(a.totals.every((p) => p >= 0)).toBe(true);
    expect(Math.max(...a.totals)).toBeGreaterThan(0);
    const b = runRound(5);
    expect(b.totals).toEqual(a.totals);
    expect(b.rng).toBe(a.rng);
  }, 120000);

  poffinReplay('sys-contest-practice-acting');
});
