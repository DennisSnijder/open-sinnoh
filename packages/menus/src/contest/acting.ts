/**
 * The acting round (decomp overlay017 ActingCompetition_*, ov17_0223B140.c; docs/research/contests.md §7): four turns
 * in which each contestant picks a move and a judge and performs, the hearts, the judges' voltage and the next turn's
 * order. The rules are acting-rules.ts; this is the round's flow and presentation, as the DS's state machine
 * (Unk_ov17_02252E10) runs its presentation commands (ov17_02243C28.c Unk_ov17_022539E4): the timings, sounds and
 * messages follow those tasks. One `step` is one DS frame: the contest LCRNG draws once a frame, as
 * ActingCompetition_Main does, before the state runs.
 *
 * Presentation approximations, all of them visual only: the hearts' gathering at the turn's end (ov17_0224331C spirals
 * each heart in) is a straight 16-frame flight; the panels' fade (ov17_022426E8, two 8-frame blends) is one 18-frame
 * fade; the heart sound's rising pitch (Sound_SetPitchForSequence) is not played.
 */
import {
  CONTEST_COMPETITION,
  type ContestActingMessage,
  type ContestActingProgress,
  type ContestActingRoundView,
  type ContestActingTables,
  type ContestMoveAnimation,
  type ContestRound,
  type ContestRoundContext,
  type ContestRoundOutcome,
  type ContestSession,
  type InputFrame,
} from '@opensinnoh/contracts';
import { genderOf, isShiny, type Button, type Id } from '@opensinnoh/core';
import { contestTables, roundWeights, visualRaw } from '@opensinnoh/services';
import { plainMarkup, TEXT_SPEED, TextPrinter, toPrintOps } from '@opensinnoh/text';
import { menuSe } from '../context.ts';
import { ACTING_MESSAGE, ACTING_TURNS, ActingEngine, aiChoose, applauseVolume, attentionMessage, firstActingOrder, HEART, judgesByPopularity, MAX_VOLTAGE, moveAllowed, newActingState, type Act, type EffectLine, type MessageArgs } from './acting-rules.ts';

type Tick = Generator<void, void, void>;

/** SDAT indexes of the sounds (SEQ_SE_DP_*). */
const SE = { CONFIRM: 1500, DECIDE: 1501, SELECT5: 1505, CON_001: 1759, CON_002: 1760, CON_003: 1761, CON_004: 1762, CON_007: 1765, CON_013: 1770, CON_021: 1774, CON_022: 1775, CON_023: 1776, CON_029: 1782, CON_031: 1784, CON_032: 1785, W234: 2041 } as const;
/** The voltage meters' pips and the judges' places (Unk_ov17_022536D8, Unk_ov17_022536E4). */
const PIP = (judge: number, k: number) => ({ x: 88 + 32 * judge + 5 * k, y: 12 });
const JUDGE = (judge: number) => ({ x: 96 + 32 * judge, y: 20 });
/** A panel's centre (ov17_0224331C: 40, 24 + 48 · row). */
const PANEL = (row: number) => ({ x: 40, y: 24 + 48 * row });
/** The performer's place and where it comes in from (ov17_02243F68: 216,112 from 256,172). */
const STAGE = { x: 216, y: 112 };
const WINGS = { x: 256, y: 172 };
/** StartScreenFade(…, 6, 1): six frames. */
const FADE_FRAMES = 6;
/** The move menu's key grid (Unk_ov17_0225323C) and the judge menu's (Unk_ov17_02253240: 3 is EXIT). */
const MOVE_GRID = [
  [0, 1],
  [2, 3],
];
const JUDGE_GRID = [
  [0, 1, 2],
  [3, 3, 3],
];
/** The button's press animation before the menu changes (ov17_0223FBC0 waits on it). */
const PRESS_FRAMES = 4;
/** The judges' hops (ov17_02241B3C): start speed in 1/256 px a frame, bounces after the first; 1 is the shake. */
const HOPS: Record<number, { v: number; bounces: number }> = { 0: { v: -0x200, bounces: 1 }, 2: { v: -0x300, bounces: 0 }, 3: { v: -0x400, bounces: 0 }, 4: { v: -0x480, bounces: 0 }, 5: { v: -0x280, bounces: 0 }, 6: { v: -0x100, bounces: 0 } };

interface Judge {
  pips: boolean[];
  blink: number | null;
  dx: number;
  dy: number;
  reaction: number | null;
}

interface Panel {
  hearts: number;
  gather: number;
  flash: number;
  slot: number | null;
}

interface Choice {
  stage: 'move' | 'judge';
}

export function actingRound(ctx: ContestRoundContext): ContestRound {
  const s = ctx.session;
  const reg = ctx.registries;
  const tables: ContestActingTables = (() => {
    const t = contestTables(reg).acting;
    if (!t) throw new Error('contest acting: the packs have no acting tables (ContestTables.acting)');
    return t;
  })();
  const ns = [...reg.newGame.values()][0]!.id.split(':')[0]!;
  const textOf = (id: Id): string => {
    const t = reg.texts.get(id);
    if (!t) throw new Error(`contest acting: no text ${id}`);
    return t.text;
  };
  const contest = (move: Id) => {
    const m = reg.moves.get(move);
    if (!m) throw new Error(`contest acting: no move ${move}`);
    return m.contest;
  };
  const nickname = (c: number): string => {
    const mon = s.entrants[c]!.mon;
    return mon.nickname ?? reg.species.get(mon.species)!.name;
  };
  const judgeName = (seat: number): string => textOf(contestTables(reg).judges[s.judges[seat]!]!.name);
  const moveName = (move: Id | null): string => (move ? reg.moves.get(move)!.name : '');

  // ov17_0223B8C4: the first turn's order is the contest's (Contest unk_156): from the visual and dance rounds in a
  // full contest (the dance round's write-back), 3, 2, 1, 0 in practice, 0, 1, 2, 3 otherwise (Contest_Init). Read
  // when the round starts (the app writes the earlier rounds' scores before).
  const firstOrder = (): number[] => {
    const scores = s.scores;
    if (!scores) throw new Error('contest acting: the session has no scores');
    if (s.competition === CONTEST_COMPETITION.full) return firstActingOrder(visualRaw(scores, s.rank), scores.dance, roundWeights(s.competition));
    return s.mode === 'practice' ? [3, 2, 1, 0] : [0, 1, 2, 3];
  };
  const st = newActingState([0, 1, 2, 3]);
  const engine = new ActingEngine(tables, st, s.type, contest, () => ctx.rng());
  const progress: ContestActingProgress = { turn: 0, choosing: false };
  (s as ContestSession).acting = progress;

  // ---------- presentation state ----------
  let fade = 1;
  let audience = 0;
  let glow = 0;
  const judges: Judge[] = [0, 1, 2].map(() => ({ pips: [false, false, false, false, false], blink: null, dx: 0, dy: 0, reaction: null }));
  const panels: Panel[] = [0, 1, 2, 3].map(() => ({ hearts: 0, gather: 0, flash: 0, slot: null }));
  let panelAlpha = 1;
  let performer: { contestant: number; x: number; y: number } | null = null;
  let anim: ContestMoveAnimation | null = null;
  const stars = new Set<{ kind: 'star' | 'pip'; x: number; y: number }>();
  let printer: TextPrinter | null = null;
  let choice: Choice | null = null;
  /** The menus' key cursors (ov17_0223F7E4 unk_2F6, kept between turns) and whether the key cursor is up (unk_300, unk_304). */
  const cursors = { move: [0, 0] as [number, number], judge: [0, 0] as [number, number], keys: false };
  let input: InputFrame = { held: [], pressed: [], touch: null };
  let outcome: ContestRoundOutcome | null = null;

  const se = (n: number) => menuSe(ctx, n);
  const pressed = (b: Button) => input.pressed.includes(b);

  // ---------- tasks (the DS's SysTasks run beside the state machine) ----------
  const tasks: { run: Tick; done: boolean }[] = [];
  const spawn = (run: Tick): { done: boolean } => {
    const t = { run, done: false };
    tasks.push(t);
    return t;
  };
  function* wait(frames: number): Tick {
    for (let i = 0; i < frames; i++) yield;
  }
  function* until(done: () => boolean): Tick {
    while (!done()) yield;
  }

  // ---------- messages (ov17_02242DC0: printed at the text speed, never waiting for a press) ----------
  const speed = () => [TEXT_SPEED.slow, TEXT_SPEED.normal, TEXT_SPEED.fast][ctx.host.options().textSpeed] ?? TEXT_SPEED.normal;
  /** Decomp ov17_0224290C: the line's slots by its argument mode. `current` is the act's contestant (mode 1). */
  const slots = (mode: number, a: MessageArgs, current: number, list?: { judge: number; contestants: number[] }): string[] => {
    const n = String(a.number);
    switch (mode) {
      case 0:
        return [];
      case 1:
        return [nickname(current)];
      case 2:
        return [nickname(a.contestant)];
      case 3:
        return [nickname(a.other)];
      case 4:
        return [moveName(a.move)];
      case 5:
        return [n];
      case 6:
        return [judgeName(a.judge)];
      case 7:
        return [nickname(a.contestant), nickname(a.other)];
      case 8:
        return [nickname(a.contestant), moveName(a.move)];
      case 9:
        return [nickname(a.contestant), n];
      case 10:
        return [nickname(a.contestant), judgeName(a.judge)];
      case 11:
      case 14:
        return [nickname(a.other), nickname(a.contestant)];
      case 12:
        return [nickname(a.other), moveName(a.move)];
      case 13:
        return [nickname(a.other), n];
      case 15:
      case 18:
        return [moveName(a.move), nickname(a.contestant)];
      case 16:
        return [moveName(a.move), nickname(a.other)];
      case 17:
        return [moveName(a.move), n];
      case 19:
      case 22:
        return [n, nickname(a.contestant)];
      case 20:
        return [n, nickname(a.other)];
      case 21:
        return [n, moveName(a.move)];
      case 23:
        return [judgeName(a.judge), nickname(a.contestant)];
      case 24:
        return [judgeName(a.judge), nickname(a.other)];
      case 25:
        return [judgeName(a.judge), moveName(a.move)];
      case 26:
        return [judgeName(a.judge), n];
      case 27:
        return [nickname(a.contestant), judgeName(a.judge), moveName(a.move)];
      case 28: {
        if (!list) throw new Error('contest acting: argument mode 28 without the judge’s contestants');
        return [judgeName(list.judge), ...list.contestants.map(nickname)];
      }
    }
    throw new Error(`contest acting: argument mode ${mode}`);
  };
  function* print(m: ContestActingMessage, a: MessageArgs, current: number, list?: { judge: number; contestants: number[] }): Tick {
    const p = new TextPrinter(toPrintOps(textOf(m.text), slots(m.args, a, current, list).map(plainMarkup)), { speed: m.instant ? TEXT_SPEED.instant : speed(), canSpeedUp: true, speedUpOnTouch: true, autoScroll: { skip: true } });
    printer = p;
    // Ov17_02242ECC: the state goes on once the printer is done (an instant line at once).
    while (!p.done) {
      yield;
      const press = pressed('a') || pressed('b') || input.tap === 'next';
      const held = input.held.includes('a') || input.held.includes('b');
      for (let i = 0; i < 2; i++) if (p.subStep({ pressed: press, held, touchPressed: input.tap === 'next', touchHeld: false })) se(SE.CONFIRM);
    }
  }
  /** Decomp ov17_02242E5C: one of the acting messages. */
  const say = (index: number, a: MessageArgs, current: number, list?: { judge: number; contestants: number[] }): Tick => {
    const m = tables.messages[index];
    if (!m) throw new Error(`contest acting: no acting message ${index}`);
    return print(m, a, current, list);
  };
  /** Decomp ov17_02242E9C: an effect's outcome line. */
  function* sayEffect(line: EffectLine | null, current: number): Tick {
    if (!line) return;
    const m = tables.effects[line.effect]?.messages[line.variant];
    if (!m) throw new Error(`contest acting: effect ${line.effect} has no line ${line.variant}`);
    yield* print(m, line.args, current);
  }

  // ---------- presentation tasks ----------
  /** Decomp ov17_022431A0 / ov17_022431E8: the applause (SEQ_SE_DP_CON_007 at `volume`), the audience's frames, and with `voltage` the glow. */
  function* applause(volume: number, voltage: number | null = null): Tick {
    se(SE.CON_007);
    const seq = [...reg.sequences.values()].find((q) => q.sourceIndex === SE.CON_007)?.id;
    if (seq) ctx.host.sound?.setPlayerVolume(seq, volume);
    let frame = 0;
    for (let cycle = 0; cycle < 3; cycle++)
      for (const half of [1, 0]) {
        audience = half;
        for (let t = 0; t < 4; t++) {
          if (voltage !== null) glow = Math.min(Math.floor((voltage * 16) / MAX_VOLTAGE), glow + 2);
          frame++;
          yield;
        }
      }
    audience = 0;
    while (voltage !== null && glow > 0) {
      glow = Math.max(0, glow - 2);
      yield;
    }
    void frame;
  }
  /** Decomp ov17_02241B3C: a judge hops (or shakes, type 1). */
  function* hop(seat: number, type: number): Tick {
    const j = judges[seat]!;
    if (type === 1) {
      for (let k = 0; k <= 4; k++) {
        j.dx = k & 1 ? 2 : -2;
        yield;
      }
      j.dx = 0;
      yield* wait(16);
      return;
    }
    const h = HOPS[type];
    if (!h) throw new Error(`contest acting: judge hop ${type}`);
    let bounces = h.bounces;
    let y = 0;
    let v = h.v;
    for (;;) {
      y += v;
      v += 0x80;
      if (y >= 0) {
        y = 0;
        j.dy = 0;
        if (bounces > 0) {
          bounces--;
          v = h.v;
          yield;
          continue;
        }
        yield;
        return;
      }
      j.dy = Math.trunc(y / 256);
      yield;
    }
  }
  /** Decomp ov17_02241A8C: the reaction bubble over a judge (0 a look, 1 a frown, 2 voltage up, 3 full) with its sound. */
  const react = (seat: number, kind: number) => {
    judges[seat]!.reaction = kind;
    se([SE.CON_003, SE.CON_001, SE.DECIDE, SE.DECIDE][kind]!);
  };
  /** Decomp ov17_022426E8: the panels fade out while a Pokémon performs, and back in. */
  function* fadePanels(out: boolean): Tick {
    const frames = 18;
    for (let t = 1; t <= frames; t++) {
      panelAlpha = out ? 1 - t / frames : t / frames;
      yield;
    }
  }
  /** Decomp ov17_02241F34 as the tasks call it: the row's hearts grow ten points at a time, every three frames. */
  function* grow(c: number, from: number, to: number): Tick {
    let v = from;
    while (v < to) {
      v += HEART;
      panels[c]!.hearts = v;
      se(SE.CON_003);
      yield* wait(3);
    }
  }
  /** Decomp ov17_022422B8: a star from the judge to the meter's next pip, then the pip lights. */
  function* star(seat: number, k: number): Tick {
    const from = JUDGE(seat);
    const to = PIP(seat, k);
    const s1 = { kind: 'star' as const, x: from.x, y: from.y };
    stars.add(s1);
    for (let t = 1; t <= 10; t++) {
      s1.x = from.x + (32 * t) / 10;
      s1.y = from.y + (72 * t) / 10;
      yield;
    }
    yield* wait(4);
    const mid = { x: s1.x, y: s1.y };
    for (let t = 1; t <= 6; t++) {
      s1.x = mid.x + ((to.x - mid.x) * t) / 6;
      s1.y = mid.y + ((to.y - mid.y) * t) / 6;
      yield;
    }
    yield* wait(3);
    stars.delete(s1);
    judges[seat]!.pips[k] = true;
    se(SE.CON_002);
  }
  /** Decomp ov17_02243750: a full meter's pip wobbles, then flies to the performer's panel. */
  function* pipFlight(seat: number, k: number, row: number): Tick {
    yield* wait(12 * k);
    judges[seat]!.pips[k] = false;
    const at = PIP(seat, k);
    const p = { kind: 'pip' as const, x: at.x, y: at.y };
    stars.add(p);
    se(SE.W234);
    let angle = 0;
    let by = at.y + 6;
    for (let t = 0; t <= 80; t++) {
      angle = (angle + 0x800) % (360 * 100);
      by += 0.5;
      p.x = at.x + Math.trunc(Math.sin((angle / 100) * (Math.PI / 180)) * 12);
      p.y = Math.trunc(by + Math.cos((angle / 100) * (Math.PI / 180)) * 6);
      yield;
    }
    se(SE.CON_013);
    const target = PANEL(row);
    const sx = p.x;
    const sy = p.y;
    const steps = Math.max(1, Math.ceil(Math.abs(sx - target.x) / 3));
    for (let t = 1; t <= steps; t++) {
      p.x = sx + ((target.x - sx) * t) / steps;
      p.y = sy + ((target.y - sy) * t) / steps;
      yield;
    }
    stars.delete(p);
    se(SE.SELECT5);
  }
  /** Decomp ov17_0224331C: the row's hearts fly into its panel, which flashes. */
  function* gather(c: number): Tick {
    if (panels[c]!.hearts < HEART) return;
    for (let t = 1; t <= 16; t++) {
      panels[c]!.gather = t / 16;
      yield;
    }
    panels[c]!.hearts = 0;
    panels[c]!.gather = 0;
    se(SE.SELECT5);
    for (let f = 10; f >= 0; f -= 2.5) {
      panels[c]!.flash = f;
      yield;
    }
  }

  // ---------- the player's choice (cmd 8, ov17_022449B8; the touch screen ov17_0223F7E4.c) ----------
  const playerMoves = (): (Id | null)[] => [0, 1, 2, 3].map((k) => s.entrants[0]!.mon.moves[k] ?? null);
  /**
   * A key on the menu (ov17_02241004): the D-pad moves the cursor in its grid, clamped, and not onto another cell of
   * the same entry (the judge menu's EXIT row); a move plays the cursor sound. A picks; B is EXIT on the judge menu.
   */
  const key = (grid: number[][], at: [number, number]): number | 'none' => {
    const [col, row] = at;
    if (pressed('a')) return grid[row]![col]!;
    if (pressed('b')) return grid === JUDGE_GRID ? 3 : 'none';
    let next: [number, number];
    if (pressed('up')) next = [col, Math.max(0, row - 1)];
    else if (pressed('down')) next = [col, Math.min(grid.length - 1, row + 1)];
    else if (pressed('left')) next = [Math.max(0, col - 1), row];
    else if (pressed('right')) next = [Math.min(grid[0]!.length - 1, col + 1), row];
    else return 'none';
    if (grid[next[1]]![next[0]] === grid[row]![col]) next = [col, row];
    if (next[0] !== col || next[1] !== row) {
      at[0] = next[0];
      at[1] = next[1];
      se(SE.CONFIRM);
    }
    return 'none';
  };
  const anyKey = () => (['a', 'b', 'x', 'y', 'up', 'down', 'left', 'right'] as const).some((b) => pressed(b));
  function* choose(): Generator<void, { move: Id; judge: number }, void> {
    const moves = playerMoves();
    let lastTurnSound = false;
    for (;;) {
      // Cases 1–4: the move menu and its line ("Which move …?", the last turn's own line and sound).
      choice = { stage: 'move' };
      const last = st.turn + 1 === ACTING_TURNS;
      if (last && !lastTurnSound) {
        se(SE.CON_029);
        lastTurnSound = true;
      }
      yield* say(last ? ACTING_MESSAGE.LAST_PERFORMANCE : ACTING_MESSAGE.WHICH_MOVE, { ...engine.args(0), number: st.turn + 1 }, 0);
      let slot = -1;
      while (slot < 0) {
        yield;
        slot = pick('move', moves);
      }
      const move = moves[slot]!;
      se(SE.DECIDE);
      yield* wait(PRESS_FRAMES);
      // Cases 6–9: the judge menu ("Choose a judge"); EXIT goes back to the moves.
      choice = { stage: 'judge' };
      yield* say(ACTING_MESSAGE.CHOOSE_JUDGE, { ...engine.args(0), number: st.turn + 1 }, 0);
      let judge = -1;
      while (judge < 0) {
        yield;
        judge = pick('judge', moves);
      }
      se(SE.DECIDE);
      yield* wait(PRESS_FRAMES);
      if (judge === 3) continue;
      choice = null;
      return { move, judge };
    }
  }
  /** One frame of the menu: a tap or a key (the first key only shows the cursor, ov17_02240C90). −1: nothing yet. */
  const pick = (stage: 'move' | 'judge', moves: (Id | null)[]): number => {
    const tap = input.tap;
    const usable = (k: number) => moveAllowed(st, 0, moves[k] ?? null);
    let chosen: number | 'none';
    let byKey = false;
    if (tap && stage === 'move' && tap.startsWith('move:')) chosen = Number(tap.slice(5));
    else if (tap && stage === 'judge' && tap.startsWith('judge:')) chosen = Number(tap.slice(6));
    else if (tap === 'back' && stage === 'judge') chosen = 3;
    else if (!cursors.keys) {
      if (anyKey()) {
        cursors.keys = true;
        se(SE.CONFIRM);
        // ov17_02240D04: the remembered cell, or the first when it holds no move.
        if (stage === 'move' && moves[MOVE_GRID[cursors.move[1]]![cursors.move[0]]!] == null) cursors.move = [0, 0];
      }
      return -1;
    } else {
      chosen = key(stage === 'move' ? MOVE_GRID : JUDGE_GRID, stage === 'move' ? cursors.move : cursors.judge);
      byKey = true;
    }
    if (chosen === 'none' || !Number.isInteger(chosen)) return -1;
    if (stage === 'move' && (chosen < 0 || chosen > 3 || !usable(chosen))) return -1;
    if (stage === 'judge' && (chosen < 0 || chosen > 3)) return -1;
    // ov17_02240E68 / ov17_02240FC4: the cursor remembers the pick; a pick by key keeps the cursor up for the next menu.
    if (stage === 'move') cursors.move = [chosen % 2, Math.floor(chosen / 2)];
    else if (chosen < 3) cursors.judge = [chosen, 0];
    cursors.keys = byKey;
    return chosen;
  };

  // ---------- the move animation (cmd 7 cases 9–11, ov17_022439C8 and ov17_022444BC) ----------
  const moveId = (name: string) => `${ns}:${name}` as Id;
  function* animate(c: number): Tick {
    const create = ctx.host.contestAnimation;
    if (!create) {
      ctx.log.stub('contest:anim:none', 'this game has no contest move animations (AppHost.contestAnimation): acts play without them');
      return;
    }
    const mon = s.entrants[c]!.mon;
    const target = s.entrants[(c + 1) % 4]!.mon;
    const move = st.moves[c]!;
    // Ov17_022439C8: Mirror Move shows Pound, Nature Power Tri Attack; the two-turn moves play twice (the second pass
    // with effect chance 1); a Ghost's Curse and Brick Break take their effect-chance arm.
    let shown = move;
    let passes = 1;
    let chance = 0;
    if (move === moveId('MOVE_MIRROR_MOVE')) shown = moveId('MOVE_POUND');
    else if (move === moveId('MOVE_NATURE_POWER')) shown = moveId('MOVE_TRI_ATTACK');
    else if ([moveId('MOVE_SOLAR_BEAM'), moveId('MOVE_RAZOR_WIND'), moveId('MOVE_SKULL_BASH'), moveId('MOVE_SKY_ATTACK'), moveId('MOVE_SHADOW_FORCE')].includes(move)) passes = 2;
    else if (move === moveId('MOVE_BRICK_BREAK')) chance = 1;
    else if (move === moveId('MOVE_CURSE')) chance = reg.species.get(mon.species)!.types.includes(moveId('TYPE_GHOST')) ? 1 : 0;
    for (let pass = 0; pass < passes; pass++) {
      const run = create({ move: shown, attacker: { species: mon.species, form: mon.form }, defender: { species: target.species, form: target.form }, effectChance: chance + pass, seed: (s.rng * 0x9e3779b1 + st.turn * 4 + pass) >>> 0 }, { registries: reg, log: ctx.log, ...(ctx.host.sound ? { sound: ctx.host.sound } : {}) });
      if (!run) return;
      anim = run;
      while (!run.done) {
        run.tick();
        yield;
      }
      anim = null;
    }
  }

  // ---------- one act (states 5–10) ----------
  function* act(pos: number): Tick {
    const c = st.order[pos]!;
    const already = engine.alreadyJudged(pos);
    const seat = st.judges[c]!;
    // Cmd 4 (ov17_02243F10): the panels fade; after 11 frames the Pokémon comes on from the right in 7 frames.
    const panelsOut = spawn(fadePanels(true));
    yield* wait(11);
    performer = { contestant: c, x: WINGS.x, y: WINGS.y };
    yield;
    if (c === 0) se(SE.CON_031);
    for (let t = 1; t <= 7; t++) {
      performer = { contestant: c, x: WINGS.x + ((STAGE.x - WINGS.x) * t) / 7, y: WINGS.y + ((STAGE.y - WINGS.y) * t) / 7 };
      yield;
    }
    yield* until(() => panelsOut.done);
    // Cmd 6 (ov17_022442AC): the applause for the contestant's total so far, then the judge looks (a frown when someone
    // already performed for them).
    const volume = applauseVolume(st.totals[c]!);
    if (volume > 0) {
      const a = spawn(applause(volume));
      yield* until(() => a.done);
    }
    react(seat, already ? 1 : 0);
    const h = spawn(hop(seat, already ? 1 : 0));
    yield* until(() => h.done);
    yield* wait(6);
    judges[seat]!.reaction = null;
    // Cmd 7 (ov17_022444BC): the move's line, an announced effect, "someone already …", the animation; panels back.
    const announced = engine.announce(c);
    const args = engine.args(c);
    yield* say(ACTING_MESSAGE.TO_JUDGE_MON_PERFORMED_MOVE, args, c);
    yield* sayEffect(announced.line, c);
    if (already) yield* say(ACTING_MESSAGE.SOMEONE_ALREADY_PERFORMED_FOR_JUDGE, args, c);
    yield* animate(c);
    yield* fadePanels(false);
    // Cmd 10: the base appeal.
    let a: Act = engine.base(c);
    yield* grow(c, a.before, a.score);
    // Cmd 11: the effect, the voltage lowered, the order marks that changed.
    a = engine.immediate(c, pos);
    yield* sayEffect(a.line, c);
    yield* grow(c, a.before, a.score);
    const turn = engine.turn!;
    if (a.lowered) {
      const before = [...turn.voltageBefore];
      for (let step = 1; ; step++) {
        let dropped = 0;
        for (let j = 0; j < 3; j++) {
          const v = before[j]! - step * HEART;
          if (turn.voltage[j]! <= v) {
            dropped++;
            judges[j]!.pips = judges[j]!.pips.map((_, k) => k < v / HEART);
            se(SE.CON_001);
          }
        }
        if (!dropped) break;
        yield* wait(3);
      }
    }
    for (let p = 0; p < 4; p++) {
      const x = turn.acts[st.order[p]!]!;
      if (x.forced !== x.forcedBefore || x.slot !== x.slotBefore) {
        panels[st.order[p]!]!.slot = x.slot;
        se(SE.CON_004);
      }
    }
    // Cmd 12: last turn's DOUBLE_NEXT_TURN.
    a = engine.pending(c);
    yield* sayEffect(a.line, c);
    yield* grow(c, a.before, a.score);
    // Cmd 13 (ov17_0224519C): the voltage.
    const v = engine.voltage(c);
    const was = turn.voltageBefore[seat]!;
    const now = turn.voltage[seat]!;
    const rose = now > was;
    if (rose) {
      react(seat, now >= MAX_VOLTAGE ? 3 : 2);
      const hp = spawn(hop(seat, now >= MAX_VOLTAGE ? 3 : 2));
      yield* until(() => hp.done);
    }
    yield* say(v.message, args, c);
    const cheer = rose ? spawn(applause(70, now)) : { done: true };
    yield* wait(9);
    let shown = was;
    while (shown !== now) {
      if (now > was) {
        shown += HEART;
        const k = shown / HEART - 1;
        const fly = spawn(star(seat, k));
        yield* until(() => fly.done);
      } else {
        shown -= HEART;
        judges[seat]!.pips = judges[seat]!.pips.map((_, k) => k < shown / HEART);
        se(SE.CON_001);
      }
      yield* wait(3);
    }
    if (shown >= MAX_VOLTAGE) judges[seat]!.blink = 0;
    yield* say(v.message2, { ...args, number: Math.trunc(a.maxBonus / HEART) }, c);
    if (shown >= MAX_VOLTAGE) {
      const flights = [0, 1, 2, 3, 4].map((k) => spawn(pipFlight(seat, k, pos)));
      yield* until(() => flights.every((f) => f.done));
    }
    yield* grow(c, a.before, a.score);
    judges[seat]!.reaction = null;
    if (shown >= MAX_VOLTAGE) {
      judges[seat]!.blink = null;
      judges[seat]!.pips = [false, false, false, false, false];
    }
    yield* until(() => cheer.done);
    engine.commit();
    // Cmd 5 (ov17_0224413C): the Pokémon leaves to the right.
    for (let t = 1; t <= 7; t++) {
      performer = { contestant: c, x: STAGE.x + ((WINGS.x - STAGE.x) * t) / 7, y: STAGE.y + ((WINGS.y - STAGE.y) * t) / 7 };
      yield;
    }
    performer = null;
    yield;
  }

  // ---------- the turn's judging (state 12, ov17_0223C350) ----------
  function* judging(): Tick {
    const t = engine.turn!;
    for (let c = 0; c < 4; c++) engine.share(c);
    // Cmd 16 per judge, the most picked first: the hop and sound by how many shared it, the line, everyone's hearts.
    for (const { judge, contestants } of judgesByPopularity(st.order, st.judges)) {
      if (!contestants.length) break;
      const first = t.acts[contestants[0]!]!;
      const kind = [4, 5, 6][first.sameJudge];
      se([SE.CON_023, SE.CON_022, SE.CON_021, SE.CON_001][first.sameJudge]!);
      if (kind !== undefined) {
        const h = spawn(hop(judge, kind));
        yield* until(() => h.done);
      }
      const message = [ACTING_MESSAGE.JUDGE_VERY_IMPRESSED, ACTING_MESSAGE.JUDGE_STRONGLY_IMPRESSED, ACTING_MESSAGE.JUDGE_WAS_IMPRESSED, ACTING_MESSAGE.EVERYONE_PERFORMED_FOR_SAME_JUDGE][contestants.length - 1]!;
      yield* say(message, engine.args(contestants[0]!), contestants[0]!, { judge, contestants });
      for (const c of contestants) yield* grow(c, t.acts[c]!.before, t.acts[c]!.score);
    }
    // Cmd 17: the judge effects (class 5), in performance order.
    for (let pos = 0; pos < 4; pos++) {
      const c = st.order[pos]!;
      if (!engine.judgeEffect(c, pos)) continue;
      const a = t.acts[c]!;
      yield* sayEffect(a.line, c);
      yield* grow(c, a.before, a.score);
    }
    // Cmd 15: the pity points (class 6).
    engine.pitySnapshot();
    for (let pos = 0; pos < 4; pos++) {
      const c = st.order[pos]!;
      if (!engine.pity(c, pos)) continue;
      const a = t.acts[c]!;
      yield* sayEffect(a.line, c);
      yield* grow(c, a.before, a.score);
    }
    // Cmd 18 (ov17_02245BC8): how much attention the player's Pokémon drew.
    yield* say(attentionMessage(t.acts[0]!.score), engine.args(0), 0);
    // Cmd 21 (ov17_02245CA4): the applause; every row's hearts fly into its panel.
    const cheer = spawn(applause(70));
    const rows = [0, 1, 2, 3].map((c) => spawn(gather(c)));
    yield* until(() => rows.every((r) => r.done) && cheer.done);
    // Cmd 20: "next turn the lowest scores go first", unless it was the last turn or everyone's place is forced.
    if (st.turn < ACTING_TURNS - 1 && t.acts.some((a) => a.forced === 0)) yield* say(ACTING_MESSAGE.NEXT_TURN_LOWEST_FIRST, engine.args(0), 0);
    engine.endTurn();
    // Cmd 19: the panels in the new order, the order marks gone.
    for (const p of panels) p.slot = null;
    yield;
  }

  function* main(): Generator<void, ContestRoundOutcome, void> {
    st.order = firstOrder();
    for (let t = FADE_FRAMES; t >= 0; t--) {
      fade = t / FADE_FRAMES;
      yield;
    }
    // State 0, cmd 2 (ov17_02243D34): the applause, 31 frames.
    const opening = spawn(applause(70));
    yield* wait(31);
    yield* until(() => opening.done);
    // State 2, cmd 20: the round's announcement.
    yield* say(s.mode === 'practice' ? ACTING_MESSAGE.BEGIN_PRACTICE : ACTING_MESSAGE.INTRO[s.type]!, engine.args(0), 0);
    while (st.turn < ACTING_TURNS) {
      progress.turn = st.turn;
      // State 4: the player's choice, then the AI's (ov17_02246ECC) for contestants 1–3.
      progress.choosing = true;
      const mine = yield* choose();
      progress.choosing = false;
      st.moves[0] = mine.move;
      st.judges[0] = mine.judge;
      for (let c = 1; c < 4; c++) {
        const e = s.entrants[c]!;
        const ai = aiChoose({ tables, st, contestant: c, moves: e.mon.moves, level: e.aiLevel, contestType: s.type, rank: s.rank, playerJudge: mine.judge, contest, rng: () => ctx.rng() });
        st.moves[c] = ai.move;
        st.judges[c] = ai.judge;
      }
      engine.startTurn();
      for (let pos = 0; pos < 4; pos++) yield* act(pos);
      yield* judging();
    }
    progress.turn = st.turn;
    // State 15, cmd 3 (ov17_02243E2C): "judging is over", 31 frames, the applause; then the fade out.
    se(SE.CON_032);
    yield* say(ACTING_MESSAGE.JUDGING_IS_OVER, engine.args(0), 0);
    yield* wait(31);
    const closing = spawn(applause(70));
    yield* until(() => closing.done);
    for (let t = 0; t <= FADE_FRAMES; t++) {
      fade = t / FADE_FRAMES;
      yield;
    }
    // Ov17_0223CA30: the acting points (unk_06) are the totals.
    return { kind: 'acting', points: [...st.totals] };
  }

  const script = main();
  const step = (frame: InputFrame): ContestRoundOutcome | null => {
    if (outcome) throw new Error('contest acting: stepped after its end');
    input = frame;
    // ActingCompetition_Main: one contest LCRNG draw every frame.
    ctx.rng();
    for (const j of judges) if (j.blink !== null) j.blink++;
    const r = script.next();
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      if (t.run.next().done) {
        t.done = true;
        tasks.splice(i--, 1);
      }
    }
    if (r.done) outcome = r.value;
    return outcome;
  };

  const view = (): ContestActingRoundView => ({
    round: 'acting',
    placeholder: false,
    turn: st.turn,
    fade,
    audience,
    glow,
    judges: judges.map((j, seat) => ({ name: judgeName(seat), main: seat === 1, pips: [...j.pips], blink: j.blink, dx: j.dx, dy: j.dy, reaction: j.reaction })),
    panels: st.order.map((c) => {
      const p = panels[c]!;
      const e = s.entrants[c]!;
      return { contestant: c, mon: nickname(c), trainer: e.trainerName, player: c === 0, hearts: p.hearts, gather: p.gather, flash: p.flash, slot: p.slot };
    }),
    panelAlpha,
    performer: performer && (() => {
      const mon = s.entrants[performer.contestant]!.mon;
      const sp = reg.species.get(mon.species)!;
      return { contestant: performer.contestant, species: mon.species, form: mon.form, shiny: isShiny(mon.otId, mon.pid), female: genderOf(sp.genderRatio, mon.pid) === 'female', x: Math.round(performer.x), y: Math.round(performer.y), flip: true };
    })(),
    anim: anim?.view() ?? null,
    stars: [...stars].map((x) => ({ kind: x.kind, x: Math.round(x.x), y: Math.round(x.y) })),
    message: printer?.text() ?? null,
    choice: choice && {
      stage: choice.stage,
      cursor: !cursors.keys ? null : choice.stage === 'move' ? MOVE_GRID[cursors.move[1]]![cursors.move[0]]! : JUDGE_GRID[cursors.judge[1]]![cursors.judge[0]]!,
      moves: playerMoves().map((m) => {
        if (!m) return null;
        const c = contest(m);
        const e = tables.effects[c.effect]!;
        return { name: moveName(m), type: c.type, hearts: Math.trunc(Math.abs(e.appeal) / HEART), description: [textOf(e.description[0]), textOf(e.description[1])], disabled: !moveAllowed(st, 0, m) };
      }),
      judges: [0, 1, 2].map((seat) => ({ name: judgeName(seat), main: seat === 1 })),
      back: textOf(`${ns}:Contest_Text_Exit` as Id),
    },
  });

  return { kind: 'acting', placeholder: false, step, view };
}
