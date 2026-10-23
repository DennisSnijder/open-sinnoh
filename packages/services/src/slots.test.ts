/**
 * The slot machine (services slots.ts) on original fixture tables: the lotteries' exact semantics, their draw order on
 * the session LCRNG, the line rules and the DS's payout quirk, reel control (the full slip lines up REPLAY and Pikachu;
 * no flag never wins), the bonus with its rounds and continue chance, the coin cap, the messages and quitting.
 */
import { describe, expect, it } from 'vitest';
import { SLOT, SLOT_SYMBOL as S, type SlotTables, type SlotsView } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { bonusDraw, clefairyKind, continueDrop, endTell, flagSymbol, SLOT_FLAG, SlotMachine, slotLines, slotMode, slotPayout, standbyFlag, winFlag } from './slots.ts';

const strip = (s: string) => [...s].map(Number);
const byMode = <T>(f: (m: number) => T) => Array.from({ length: SLOT.modes }, (_, m) => f(m));
/** Original tables (not the ROM's): every mode differs, shares sum under 100. */
const TABLES: SlotTables = {
  modes: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5],
  reels: [strip('012345012345012345012'), strip('543210543210543210543'), strip('024135024135024135024')],
  payouts: [50, 60, 0, 1, 5, 8],
  bonusPayouts: [50, 60, 9, 1, 5, 8],
  winChance: [20, 40, 60, 80, 100, 50],
  winFlags: byMode((m) => [2 + m, 3, 4, 5, 6, 7, 8]),
  hintChance: [50, 60, 70, 80, 90, 100],
  standbySmall: [40, 40, 40, 40, 40, 40],
  standbyFlags: byMode(() => [10, 20, 30, 40]),
  bonusTypes: byMode(() => [
    { chance: 10, type: 3, class: 0 },
    { chance: 10, type: 1, class: 1 },
    { chance: 20, type: 5, class: 2 },
    { chance: 20, type: 2, class: 2 },
    { chance: 10, type: 4, class: 1 },
    { chance: 30, type: 0, class: 0 },
  ]),
  continueStart: [40, 60, 80, 40, 60, 80],
  clefairyKinds: byMode(() => [
    [{ chance: 10, kind: 2 }, { chance: 30, kind: 0 }, { chance: 60, kind: 1 }],
    [{ chance: 30, kind: 2 }, { chance: 40, kind: 0 }, { chance: 30, kind: 1 }],
    [{ chance: 60, kind: 2 }, { chance: 30, kind: 0 }, { chance: 10, kind: 1 }],
  ]),
  redMoon: [10, 10, 10, 10, 10, 10],
  blueMoon: [4, 4, 4, 4, 4, 4],
  continueDrop: byMode(() => [30, 20]),
  endTells: byMode(() => [70, 50, 30, 10, 0].map((min, i) => ({ min, a: 10 * i, b: 20 }))),
  bonusOrders: [['y', 'b', 'a'], ['y', 'a', 'b'], ['b', 'y', 'a'], ['b', 'a', 'y'], ['a', 'y', 'b'], ['a', 'b', 'y']].map((buttons) => ({ buttons: buttons as ('y' | 'b' | 'a')[], clefairy: buttons.map((b) => ({ y: 6, b: 5, a: 7 })[b]!) })),
  lightShow: [{ mask: 1, from: 0, to: 12, step: 4 }, { mask: 1 << 5, from: 3, to: 0, step: 0 }, { mask: 1, from: 12, to: 0, step: 4 }, { mask: 1 << 6, from: 1, to: 0, step: 0 }],
  stopButtons: [{ x: 6, y: 16 }, { x: 14, y: 16 }, { x: 21, y: 16 }],
  linePalettes: [1, 2, 3, 4, 5],
  lineFlash: byMode(() => [{ x: 60, y: 50 }, { x: 120, y: 50 }, { x: 180, y: 50 }]).slice(0, 5),
  messageWindow: { x: 1, y: 18, width: 28, height: 4 },
  prizes: [{ item: 'fixture:ITEM_POTION' as Id, price: 10 }],
  messages: ['test:M0', 'test:M1', 'test:M2'] as Id[],
  streakVar: 'test:VAR_STREAK' as Id,
};

/** The session LCRNG, written out for the draw-order checks. */
function lcrng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 0x41c64e6d) + 0x6073) >>> 0;
    return x >>> 16;
  };
}

/** The symbols of the lines that won in a window ([reel][row 1–3]). */
function lineSymbols(w: number[][]): number[] {
  const rows = [[1, 1, 1], [2, 2, 2], [3, 3, 3], [1, 2, 3], [3, 2, 1]];
  return rows.map((r) => r.map((k, i) => w[i]![k - 1]!)).filter(([a, b, c]) => a === S.cherry || (a === b && a === c)).map(([a]) => a!);
}

/** Drives a machine: steps with presses, waits for a prompt (closing messages). */
function play(m: SlotMachine) {
  const step = (pressed: Button[] = [], held: Button[] = []) => m.step({ pressed, held });
  const view = (): SlotsView => m.view(null);
  const until = (ok: () => boolean, max = 3000) => {
    for (let i = 0; i < max && !ok(); i++) step();
    if (!ok()) throw new Error(`timed out: ${JSON.stringify(m.debug())}`);
  };
  const prompt = (p: SlotsView['prompt'][]) => until(() => m.done || p.includes(view().prompt) || m.message !== null);
  return { step, view, until, prompt };
}

/** One spin from the bet prompt (or a free spin at the stops), stops pressed in `order` (reels 0–2) `gap` frames apart. */
function spin(m: SlotMachine, order: number[] = [0, 1, 2], gap = 1, delay = 0): void {
  const p = play(m);
  p.prompt(['bet', 'stops']);
  if (p.view().prompt === 'bet') {
    p.step(['x']);
    p.prompt(['lever']);
    p.step(['down']);
    p.prompt(['stops']);
  }
  for (let i = 0; i < delay; i++) p.step();
  order.forEach((r, i) => {
    p.step([(['y', 'b', 'a'] as const)[r]!]);
    if (i < 2) for (let k = 1; k < gap; k++) p.step();
  });
  p.prompt(['bet', 'stops']);
}

describe('the slot lines (ov101_021D5778, ov101_021D597C)', () => {
  it('a line wins on cherries at its left or three equal symbols; the last winning line names the symbol', () => {
    const w = (l: number[], m: number[], r: number[]) => [l, m, r];
    expect(slotLines(w([S.pikachu, S.pikachu, S.replay], [S.moonStone, S.pikachu, S.red7], [S.red7, S.pikachu, S.replay]))).toEqual({ result: S.pikachu, lines: 1 });
    expect(slotLines(w([S.red7, S.cherry, S.replay], [S.moonStone, S.pikachu, S.red7], [S.red7, S.pikachu, S.replay]))).toEqual({ result: S.cherry, lines: 1 });
    // Cherries on the left reel's top row win the top line and the diagonal down: two lines, 2 × the rate.
    const top = slotLines(w([S.cherry, S.moonStone, S.replay], [S.red7, S.moonStone, S.red7], [S.pikachu, S.replay, S.red7]));
    expect(top).toEqual({ result: S.cherry, lines: (1 << 1) | (1 << 3) });
    expect(slotPayout(TABLES.payouts, top.result, top.lines)).toBe(2);
  });

  it('keeps the DS quirk: two lines with different symbols pay the last one\'s rate twice', () => {
    // The middle line is three red 7s, the diagonal down starts with cherries: the cherries line is checked last.
    const w = slotLines([[S.cherry, S.red7, S.moonStone], [S.pikachu, S.red7, S.pikachu], [S.replay, S.red7, S.moonStone]]);
    expect(w).toEqual({ result: S.cherry, lines: (1 << 1) | (1 << 0) | (1 << 3) });
    expect(slotPayout(TABLES.payouts, w.result, w.lines)).toBe(3 * TABLES.payouts[S.cherry]!);
    expect(() => slotPayout(TABLES.payouts, S.none, 0)).toThrow(/without a line/);
  });
});

describe('the lotteries (exact semantics on the fixture tables)', () => {
  it('winFlag walks the shares in check order (bits 3, 2, 7, 6, 5, 4, 1) and leaves REPLAY the rest', () => {
    // Mode 0: shares 2, 3, 4, 5, 6, 7, 8.
    const bits = [0, 1, 2, 4, 5, 8, 9, 13, 14, 19, 20, 26, 27, 34, 35, 99].map((r) => Math.log2(winFlag(TABLES, 0, r)));
    expect(bits).toEqual([3, 3, 2, 2, 7, 7, 6, 6, 5, 5, 4, 4, 1, 1, 0, 0]);
  });

  it('standbyFlag draws the 7 over the gate by the bonus type, and checks the Moon Stone share twice under it', () => {
    expect(standbyFlag(TABLES, 0, 0, 0, 40)).toBe(1 << SLOT_FLAG.red7);
    expect(standbyFlag(TABLES, 0, 2, 0, 99)).toBe(1 << SLOT_FLAG.red7);
    expect(standbyFlag(TABLES, 0, 3, 0, 40)).toBe(1 << SLOT_FLAG.galactic7);
    const flag = (pick: number) => Math.log2(standbyFlag(TABLES, 0, 0, pick, 39));
    // Shares 10, 20, 30, 40: cherries 0–9, Moon Stone 10–29, Pikachu 30–49 (share 1 again), REPLAY from 50.
    expect([0, 9, 10, 29, 30, 49, 50, 99].map(flag)).toEqual([2, 2, 6, 6, 4, 4, 0, 0]);
  });

  it('bonusDraw, clefairyKind, continueDrop and endTell walk their rows', () => {
    expect([0, 9, 10, 19, 20, 39, 40, 59, 60, 69, 70, 99].map((r) => bonusDraw(TABLES, 0, r))).toEqual([
      { type: 3, class: 0 }, { type: 3, class: 0 }, { type: 1, class: 1 }, { type: 1, class: 1 }, { type: 5, class: 2 }, { type: 5, class: 2 },
      { type: 2, class: 2 }, { type: 2, class: 2 }, { type: 4, class: 1 }, { type: 4, class: 1 }, { type: 0, class: 0 }, { type: 0, class: 0 },
    ]);
    expect([0, 9, 10, 39, 40, 99].map((r) => clefairyKind(TABLES, 0, 0, r))).toEqual([2, 2, 0, 0, 1, 1]);
    expect(clefairyKind(TABLES, 0, 2, 59)).toBe(2);
    // Drops 30 % (−10), then 20 % (−5); the red moon hit always −10; never below 0.
    expect([0, 29, 30, 49, 50, 99].map((r) => continueDrop(TABLES, 0, 60, false, r))).toEqual([50, 50, 55, 55, 60, 60]);
    expect(continueDrop(TABLES, 0, 60, true, 99)).toBe(50);
    expect(continueDrop(TABLES, 0, 4, false, 0)).toBe(0);
    // The rows' minimums 70, 50, 30, 10, 0 with A 0, 10, 20, 30, 40 % and B 20 %.
    expect([endTell(TABLES, 0, 80, 0), endTell(TABLES, 0, 80, 19), endTell(TABLES, 0, 80, 20)]).toEqual(['cry', 'cry', 'pikachu']);
    expect([endTell(TABLES, 0, 15, 29), endTell(TABLES, 0, 15, 30), endTell(TABLES, 0, 15, 49), endTell(TABLES, 0, 15, 50)]).toEqual(['ball', 'cry', 'cry', 'pikachu']);
  });

  it('the daily shuffle is a deterministic permutation of the mode list', () => {
    for (const r of [0, 1, 0xdeadbeef]) {
      const modes = Array.from({ length: SLOT.machines }, (_, m) => slotMode(TABLES, r, m));
      expect([...modes].sort()).toEqual([...TABLES.modes].sort());
      expect(Array.from({ length: SLOT.machines }, (_, m) => slotMode(TABLES, r, m))).toEqual(modes);
    }
    expect(() => slotMode(TABLES, 0, 12)).toThrow(/no machine/);
  });

  it('a spin draws the gate, the flag and the hint from the session LCRNG, after the reels\' three starting draws', () => {
    for (let mode = 0; mode < SLOT.modes; mode++)
      for (let seed = 0; seed < 150; seed++) {
        const next = lcrng(seed * 7919 + mode);
        for (let i = 0; i < 3; i++) next();
        const gate = next() % 100;
        const expected = TABLES.winChance[mode]! > gate ? winFlag(TABLES, mode, next() % 100) : 0;
        const m = new SlotMachine(TABLES, mode, 100, seed * 7919 + mode);
        const p = play(m);
        p.prompt(['bet']);
        p.step(['x']);
        p.prompt(['lever']);
        p.step(['down']);
        expect(m.debug().flags, `mode ${mode} seed ${seed}`).toBe(expected);
      }
  });

  it('over many seeded spins the flags come at the tables\' rates', () => {
    const next = lcrng(12345);
    const counts = new Map<number, number>();
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const gate = next() % 100;
      const f = TABLES.winChance[2]! > gate ? winFlag(TABLES, 2, next() % 100) : 0;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    expect((n - (counts.get(0) ?? 0)) / n).toBeCloseTo(0.6, 1);
    // Mode 2: Pikachu (bit 4) is 7 % of the 60 % that win.
    expect((counts.get(1 << 4) ?? 0) / n).toBeCloseTo(0.6 * 0.07, 2);
    expect((counts.get(1 << 0) ?? 0) / n).toBeCloseTo(0.6 * (1 - 0.39), 1);
  });
});

describe('the machine (frame by frame)', () => {
  /** Normal play only: no bonus flags. */
  const NORMAL: SlotTables = { ...TABLES, winFlags: byMode(() => [0, 5, 0, 10, 0, 30, 0]) };

  it('lines up REPLAY and Pikachu whatever the timing when stopped in order; a spin without a flag never wins', () => {
    let lined = 0;
    for (let seed = 0; seed < 60; seed++) {
      const m = new SlotMachine(NORMAL, 4, 5000, seed);
      for (let k = 0; k < 6; k++) {
        const before = m.coins;
        spin(m, [0, 1, 2], 1 + ((seed + k) % 5), (seed * 3 + k) % 11);
        const d = m.debug();
        const t = flagSymbol(d.resultFlags);
        if (d.resultFlags & ((1 << 0) | (1 << 1) | (1 << 4) | (1 << 5))) {
          expect(lineSymbols(d.window), `seed ${seed} spin ${k}`).toContain(t);
          lined++;
        }
        if (d.resultFlags === 0) expect(d.result, `seed ${seed} spin ${k}`).toBe(S.none);
        if (d.result !== S.none && d.result !== S.replay) expect(m.coins).toBeGreaterThan(before - 3);
      }
    }
    expect(lined).toBeGreaterThan(50);
  });

  it('a winning line is the flag\'s symbol (cherries and Moon Stones only land when reachable)', () => {
    let landed = 0;
    for (let seed = 0; seed < 120; seed++) {
      const m = new SlotMachine(NORMAL, 4, 5000, 1000 + seed);
      spin(m, [0, 1, 2], 1, seed % 9);
      const d = m.debug();
      if (d.result === S.none) continue;
      expect(d.resultFlags).not.toBe(0);
      expect(lineSymbols(d.window), `seed ${seed}`).toContain(flagSymbol(d.resultFlags));
      landed++;
    }
    expect(landed).toBeGreaterThan(60);
  });

  it('bets 3, refunds the bet on START after it, quits on START before it', () => {
    const m = new SlotMachine(TABLES, 0, 10, 1);
    const p = play(m);
    p.prompt(['bet']);
    p.step(['x']);
    expect(p.view().credit).toBe(7);
    p.prompt(['lever']);
    p.step(['start']);
    expect(m.coins).toBe(10);
    p.until(() => m.done);
    const q = new SlotMachine(TABLES, 0, 10, 1);
    play(q).prompt(['bet']);
    play(q).step(['start']);
    play(q).until(() => q.done);
    expect(q.coins).toBe(10);
  });

  it('shows the messages: fewer than 3 coins and none quit after A; at 50000 it says so and plays on, keeping the cap', () => {
    for (const [coins, message] of [[2, 0], [0, 2]] as const) {
      const m = new SlotMachine(TABLES, 0, coins, 1);
      const p = play(m);
      p.until(() => m.message !== null);
      expect(m.message).toBe(message);
      expect(p.view().prompt).toBeNull();
      p.step(['a']);
      p.until(() => m.done);
      expect(m.coins).toBe(coins);
    }
    // Mode 4 always wins; start just under the cap: the win's coins stop at 50000, then the "full" message.
    const m = new SlotMachine({ ...TABLES, winFlags: byMode(() => [0, 0, 0, 0, 0, 100, 0]) }, 4, SLOT.maxCoins - 1, 3);
    const p = play(m);
    spin(m);
    expect(m.debug().result).toBe(S.pikachu);
    p.until(() => m.message !== null);
    expect(m.message).toBe(1);
    expect(m.coins).toBe(SLOT.maxCoins);
    p.step(['b']);
    p.prompt(['bet']);
    expect(p.view().prompt).toBe('bet');
  });

  it('counts the payout a coin every 4 frames, every 2 while a button is held, and all at once on X', () => {
    const tables = { ...TABLES, payouts: [50, 60, 0, 1, 40, 8], winFlags: byMode(() => [0, 0, 0, 0, 0, 100, 0]) };
    const m = new SlotMachine(tables, 4, 100, 9);
    const p = play(m);
    p.prompt(['bet']);
    p.step(['x']);
    p.prompt(['lever']);
    p.step(['down']);
    p.prompt(['stops']);
    p.step(['y']);
    p.step(['b']);
    p.step(['a']);
    p.until(() => p.view().payout > 0);
    const owed = p.view().payout;
    const start = m.coins;
    // The flashes pulse first (4 × 8 frames), then the count.
    p.until(() => m.coins > start, 60);
    const at = m.tick;
    p.until(() => m.coins > start + 1, 10);
    expect(m.tick - at).toBe(4);
    const held = m.tick;
    for (let i = 0; i < 4; i++) p.step([], ['a']);
    expect(m.tick - held).toBe(4);
    expect(m.coins).toBe(start + 4);
    p.step(['x']);
    expect(p.view().payout).toBe(0);
    expect(m.coins).toBe(start + owed);
  });

  it('plays a bonus: Pikachu with its bonus flag brings Clefairy, a 7 line starts the rounds, each spin in Clefairy\'s order pays REPLAY\'s bonus rate', () => {
    // Consecutive symbols differ and the middle strip runs the other way: one line at most wins.
    const forward = strip('042042042042042042042');
    const backward = strip('024024024024024024024');
    const tables: SlotTables = {
      ...TABLES,
      reels: [forward, backward, forward],
      winChance: byMode(() => 100),
      winFlags: byMode(() => [0, 0, 0, 0, 100, 0, 0]),
      standbySmall: byMode(() => 0),
      bonusTypes: byMode(() => [{ chance: 100, type: 0, class: 0 }, { chance: 0, type: 1, class: 1 }, { chance: 0, type: 2, class: 2 }, { chance: 0, type: 3, class: 0 }, { chance: 0, type: 4, class: 1 }, { chance: 0, type: 5, class: 2 }]),
      continueStart: [0, 0, 0, 0, 0, 0],
      redMoon: byMode(() => 0),
      blueMoon: byMode(() => 0),
    };
    const m = new SlotMachine(tables, 1, 500, 77);
    const p = play(m);
    spin(m);
    expect(m.debug().spinFlags).toBe(1 << SLOT_FLAG.pikachuBonus);
    p.prompt(['bet']);
    expect(p.view().clefairy).not.toBeNull();
    // Standby: the red 7 flag (type 0) every spin; stopped in order it lines up within the slip limit.
    for (let i = 0; i < 10 && !p.view().counters; i++) {
      spin(m);
      p.prompt(['bet', 'stops']);
    }
    expect(p.view().counters).not.toBeNull();
    const before = m.coins;
    for (let k = 0; k < 15; k++) {
      p.prompt(['bet']);
      p.step(['x']);
      p.prompt(['lever']);
      p.step(['down']);
      p.prompt(['stops']);
      for (let s = 0; s < 3; s++) {
        const anim = p.view().clefairy!.anim;
        p.step([anim === 4 ? 'y' : anim === 5 ? 'b' : 'a']);
        p.step();
      }
      p.prompt(['bet']);
      expect(m.debug().result, `bonus spin ${k}`).toBe(S.replay);
    }
    p.prompt(['bet']);
    // Continue chance 0: the first round was the last; 15 spins at −1 +9.
    expect(m.coins).toBe(before + 15 * (9 - 1));
    expect(p.view().counters).toBeNull();
    expect(m.streak).toBe(1);
    expect(m.rounds).toBe(1);
    p.step(['start']);
    p.until(() => m.done);
  });
});
