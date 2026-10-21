/**
 * Test doubles: a hand-built dex, a battle view with a small made-up type chart and damage formula, and
 * a scripted RNG that fails when a test draws more numbers than it planned.
 */
import type { AiScript } from '@opensinnoh/contracts';
import { divide } from '../calc.ts';
import { MOVE_STATUS } from '../constants.ts';
import type { AiDex, AiItem, AiMove } from '../dex.ts';
import { createAiMemory } from '../memory.ts';
import { EMPTY_BATTLER, type AiBattleView, type AiBattler, type AiPartyMon, type AiRng } from '../view.ts';

export function fakeDex(script: AiScript, moves: Record<number, Partial<AiMove>>, opts: { items?: Record<number, Partial<AiItem>>; abilities?: Record<number, [number, number]> } = {}): AiDex {
  return {
    script,
    move: (n) => (n === 0 ? { type: 0, power: 0, effect: 0, class: 0, range: 'SINGLE_TARGET' } : { type: 0, power: 0, effect: 0, class: 0, range: 'SINGLE_TARGET', ...(moves[n] ?? fail(`no move ${n}`)) }),
    item: (n) => ({ holdEffect: 0, holdEffectName: 'NONE', naturalGiftPower: 0, naturalGiftType: 0, flingPower: 0, partyFlags: new Set(), stages: {}, hpRestored: 0, ...opts.items?.[n] }),
    speciesAbilities: (n) => opts.abilities?.[n] ?? [0, 0],
    itemNumber: () => fail('itemNumber'),
  };
}

function fail(msg: string): never {
  throw new Error(msg);
}

export function mon(over: Partial<AiBattler> = {}): AiBattler {
  return {
    ...EMPTY_BATTLER,
    species: 1,
    level: 50,
    types: [0, 0],
    hp: 100,
    maxHp: 100,
    attack: 100,
    defense: 100,
    speed: 100,
    spAttack: 100,
    spDefense: 100,
    statStages: [6, 6, 6, 6, 6, 6, 6, 6],
    moves: [0, 0, 0, 0],
    pp: [10, 10, 10, 10],
    ivs: [0, 0, 0, 0, 0, 0],
    ...over,
  };
}

export function partyMon(over: Partial<AiPartyMon> = {}): AiPartyMon {
  return { species: 1, isEgg: false, hp: 100, maxHp: 100, status: 0, moves: [0, 0, 0, 0], pp: [10, 10, 10, 10], maxPp: [10, 10, 10, 10], heldItem: 0, ability: 0, types: [0, 0], ivs: [0, 0, 0, 0, 0, 0], ...over };
}

/** Made-up chart entries `[attacking, defending, ×10]`; anything else is neutral (10). */
export type Chart = [number, number, number][];

export interface FakeOptions {
  dex: AiDex;
  battlers: AiBattler[];
  parties?: AiPartyMon[][];
  chart?: Chart;
  battleType?: number;
  totalTurns?: number;
  /** Damage before the chart: default power × attack / defense / 2. */
  damage?: (move: number, attacker: AiBattler, defender: AiBattler, power: number) => number;
  previousMoves?: number[];
}

export interface FakeView extends AiBattleView {
  battlers: AiBattler[];
  parties: AiPartyMon[][];
}

export function fakeView(o: FakeOptions): FakeView {
  const chart = o.chart ?? [];
  const mul = (a: number, d: number) => chart.find(([x, y]) => x === a && y === d)?.[2] ?? 10;
  const parties = o.parties ?? [[partyMon()], [partyMon()], [], []];
  const battlers = [...o.battlers];
  while (battlers.length < 4) battlers.push(EMPTY_BATTLER);
  const flagsFor = (mulTotal: number) => (mulTotal === 0 ? MOVE_STATUS.INEFFECTIVE : mulTotal > 100 ? MOVE_STATUS.SUPER_EFFECTIVE : mulTotal < 100 ? MOVE_STATUS.NOT_VERY_EFFECTIVE : 0);
  const view: FakeView = {
    battlers,
    parties,
    battleType: o.battleType ?? 1,
    totalTurns: o.totalTurns ?? 0,
    fieldConditions: 0,
    memory: createAiMemory(o.battleType ?? 1, []),
    battler: (b) => battlers[b]!,
    sideConditions: () => 0,
    spikesLayers: () => 0,
    toxicSpikesLayers: () => 0,
    party: (b) => parties[b]!,
    selectedPartySlot: () => 0,
    previousMove: (b) => o.previousMoves?.[b] ?? 0,
    lastHitBy: () => ({ move: 0, battler: 0xff }),
    protectMove: () => 0,
    recycleItem: () => 0,
    switching: () => false,
    invalidMoves: () => 0,
    speedValue: (b) => battlers[b]!.speed,
    compareSpeed: (b1, b2) => (battlers[b1]!.speed > battlers[b2]!.speed ? 0 : battlers[b1]!.speed < battlers[b2]!.speed ? 1 : 2),
    applyTypeChart(move, type, attacker, defender, damage, ignore) {
      const t = type || o.dex.move(move).type;
      const a = battlers[attacker]!;
      const d = battlers[defender]!;
      let dmg = damage;
      if (!ignore && (a.types[0] === t || a.types[1] === t)) dmg = Math.trunc((dmg * 15) / 10);
      const m1 = mul(t, d.types[0]);
      const m2 = d.types[1] !== d.types[0] ? mul(t, d.types[1]) : 10;
      if (!ignore) dmg = divide(divide(dmg * m1, 10) * m2, 10);
      return { damage: m1 * m2 === 0 ? 0 : dmg, flags: flagsFor(m1 * m2) };
    },
    calcEffectiveness: (move, type, _aa, _da, _he, t1, t2) => {
      const t = type || o.dex.move(move).type;
      return flagsFor(mul(t, t1) * (t2 !== t1 ? mul(t, t2) : 10));
    },
    calcMoveDamage: (move, attacker, defender, power) => {
      const p = power || o.dex.move(move).power;
      return o.damage ? o.damage(move, battlers[attacker]!, battlers[defender]!, p) : Math.trunc((p * battlers[attacker]!.attack) / battlers[defender]!.defense / 2);
    },
    typeMatchup: (a, d1, d2) => Math.trunc((Math.trunc((40 * mul(a, d1)) / 10) * (d2 !== d1 ? mul(a, d2) : 10)) / 10),
  };
  return view;
}

/** Hands out `values` in order and throws on one draw too many. */
export function scriptedRng(values: number[]): AiRng & { left(): number } {
  let i = 0;
  return {
    next() {
      if (i >= values.length) throw new Error(`rng: draw ${i + 1}, only ${values.length} planned`);
      return values[i++]!;
    },
    left: () => values.length - i,
  };
}
