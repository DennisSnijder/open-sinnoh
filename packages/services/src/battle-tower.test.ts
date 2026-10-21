/** The Battle Tower's pure rules (decomp unk_02049D08.c, unk_0204AEE8.c, ScrCmd_JudgeStats) on original values. */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@opensinnoh/contracts';
import type { Pokemon } from '@opensinnoh/core';
import { judgeStats, newFrontierState, towerIvs, towerLcg, towerReseed, towerTrophyDue } from './battle-tower.ts';

describe('Battle Tower rules', () => {
  it('steps its two LCGs as u32', () => {
    expect(towerLcg(0)).toBe(1);
    expect(towerLcg(1)).toBe(48828126);
    expect(towerReseed(1)).toBe(1566083942);
    expect(towerLcg(0xffffffff)).toBe((Math.imul(0xffffffff, 48828125) + 1) >>> 0);
  });

  it('gives trainers one IV by their tier (3 below 100 … 31 from 220)', () => {
    expect([0, 99, 100, 199, 219, 220, 305].map(towerIvs)).toEqual([3, 3, 6, 18, 21, 31, 31]);
  });

  it('judges the best IV, a tie going to the later stat on the coin', () => {
    const mon = { ivs: { hp: 30, attack: 31, defense: 31, speed: 2, spAttack: 31, spDefense: 0 } } as Pokemon;
    expect(judgeStats(mon, () => false)).toEqual({ total: 125, best: 1, bestIv: 31 });
    expect(judgeStats(mon, () => true)).toEqual({ total: 125, best: 4, bestIv: 31 });
  });

  it("dues Teala's trophies by the singles record: 20 bronze, 50 silver, 100 gold", () => {
    const state = (record: number, flags = 0) => ({ frontier: { ...newFrontierState(), towerFlags: flags, towerStreaks: [{ record, latest: 0 }, ...newFrontierState().towerStreaks.slice(1)] } }) as unknown as GameState;
    expect(towerTrophyDue(state(19))).toBe(0);
    expect(towerTrophyDue(state(20))).toBe(1);
    expect(towerTrophyDue(state(49, 1 << 13))).toBe(0);
    expect(towerTrophyDue(state(50, 1 << 13))).toBe(2);
    expect(towerTrophyDue(state(100, (1 << 13) | 1))).toBe(3);
    expect(towerTrophyDue(state(100, (1 << 13) | 1 | 2))).toBe(0);
  });
});
