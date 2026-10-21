/** The `battle auto` policy (`autoChoice`) against a foe's shown ability (BattlerView.ability). */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { BattleChoice, BattleView, Registries } from '@opensinnoh/contracts';
import { autoChoice, battleAuto, type UntilTarget } from './until.ts';

const reg = {
  species: new Map([
    ['t:EMPOLEON', { types: ['t:TYPE_WATER', 't:TYPE_STEEL'] }],
    ['t:QUAGSIRE', { types: ['t:TYPE_WATER', 't:TYPE_GROUND'] }],
    ['t:SHEDINJA', { types: ['t:TYPE_BUG', 't:TYPE_GHOST'] }],
    ['t:TANGROWTH', { types: ['t:TYPE_GRASS'] }],
  ]),
  types: new Map([
    ['t:TYPE_WATER', { matchups: [{ type: 't:TYPE_GROUND', multiplier: 20 }, { type: 't:TYPE_WATER', multiplier: 5 }, { type: 't:TYPE_GRASS', multiplier: 5 }] }],
    ['t:TYPE_NORMAL', { matchups: [{ type: 't:TYPE_GHOST', multiplier: 0 }] }],
    ['t:TYPE_STEEL', { matchups: [] }],
    ['t:TYPE_FIRE', { matchups: [{ type: 't:TYPE_BUG', multiplier: 20 }] }],
  ]),
} as unknown as Registries;

const move = (type: string, power: number) => ({ move: `t:M_${type}` as Id, type: `t:TYPE_${type}` as Id, power, pp: 10 });

function view(foe: string, ability: string | undefined, moves: ReturnType<typeof move>[]): BattleView {
  return {
    topology: 'single',
    battlers: [
      { battler: 0, side: 'player', species: 't:EMPOLEON', form: 0, visible: true },
      { battler: 1, side: 'enemy', species: foe, form: 0, visible: true, ...(ability ? { ability } : {}) },
    ],
    prompt: { kind: 'command', cursor: 0, enabled: [true, true, true, true], moves, actor: 0 },
  } as unknown as BattleView;
}

describe('battle auto against a shown ability', () => {
  const moves = [move('STEEL', 80), move('WATER', 95)];

  it('Surf on a Quagsire with no ability shown: the strongest by the plain estimate', () => {
    expect(autoChoice(view('t:QUAGSIRE', undefined, moves), reg)).toEqual({ kind: 'move', slot: 1 });
  });

  it('once Water Absorb is shown, water moves rank below the rest', () => {
    expect(autoChoice(view('t:QUAGSIRE', 't:ABILITY_WATER_ABSORB', moves), reg)).toEqual({ kind: 'move', slot: 0 });
    expect(autoChoice(view('t:QUAGSIRE', 't:ABILITY_DRY_SKIN', moves), reg)).toEqual({ kind: 'move', slot: 0 });
  });

  it('an ability that takes another type changes nothing', () => {
    expect(autoChoice(view('t:QUAGSIRE', 't:ABILITY_FLASH_FIRE', moves), reg)).toEqual({ kind: 'move', slot: 1 });
  });

  it('Wonder Guard: only a super-effective move', () => {
    const vs = [move('STEEL', 80), move('FIRE', 40)];
    expect(autoChoice(view('t:SHEDINJA', undefined, vs), reg)).toEqual({ kind: 'move', slot: 0 });
    expect(autoChoice(view('t:SHEDINJA', 't:ABILITY_WONDER_GUARD', vs), reg)).toEqual({ kind: 'move', slot: 1 });
  });

  it('with every move taken it still answers (the first)', () => {
    expect(autoChoice(view('t:QUAGSIRE', 't:ABILITY_WATER_ABSORB', [move('WATER', 95), move('WATER', 40)]), reg)).toEqual({ kind: 'move', slot: 0 });
  });
});

describe('battle auto against a move the battle refuses', () => {
  const moves = [move('STEEL', 80), move('WATER', 95), move('FIRE', 60)];

  it('skips the refused slots', () => {
    expect(autoChoice(view('t:QUAGSIRE', undefined, moves), reg, new Set([1]))).toEqual({ kind: 'move', slot: 0 });
  });

  it('a refusal by the battle (Disable, Encore, Taunt, a Choice item…) moves on to the next best move', () => {
    const tried: number[] = [];
    let inBattle = true;
    const t = {
      battle: () => view('t:QUAGSIRE', undefined, moves),
      registries: () => reg,
      battleChoose(c: BattleChoice) {
        if (c.kind !== 'move') throw new Error('not a move');
        tried.push(c.slot);
        if (c.slot === 1) throw new Error("battle: Hydro Pump can't be used now (disabled, encored, taunted, tormented, sealed or choice-locked)");
        inBattle = false;
      },
      tick: () => {},
      inBattle: () => inBattle,
    } as unknown as UntilTarget;
    expect(battleAuto(t, 5)).toBe(1);
    expect(tried).toEqual([1, 0]);
  });

  it('any other refusal still fails loudly', () => {
    const t = {
      battle: () => view('t:QUAGSIRE', undefined, moves),
      registries: () => reg,
      battleChoose: () => {
        throw new Error('battle: Hydro Pump has no PP left');
      },
    } as unknown as UntilTarget;
    expect(() => battleAuto(t, 5)).toThrow(/no PP left/);
  });
});

describe('battle auto by power × STAB × type effectiveness', () => {
  it('a neutral STAB Flash Cannon (80 × 1.5) beats a resisted STAB Hydro Pump (120 × 1.5 × ½)', () => {
    expect(autoChoice(view('t:TANGROWTH', undefined, [move('WATER', 120), move('STEEL', 80)]), reg)).toEqual({ kind: 'move', slot: 1 });
  });
});
