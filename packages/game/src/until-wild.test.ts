/** `until wild <species> [<dir> <dir>]` (core replay.ts) on a scripted target: a step a tick, a wild battle every third step. */
import { describe, expect, it } from 'vitest';
import type { Button, Id } from '@opensinnoh/core';
import type { BattleChoice, BattleView, GameState } from '@opensinnoh/contracts';
import { runUntil, type UntilTarget } from './until.ts';

function target(foes: string[]) {
  const player = { x: 0, z: 0 };
  let held: Button | null = null;
  let steps = 0;
  let battle: { species: string } | null = null;
  const log: string[] = [];
  const t = {
    tick() {
      if (battle || !held) return;
      player.x += held === 'right' ? 1 : -1;
      log.push(`step ${player.x}`);
      if (++steps % 3 === 0 && foes.length) battle = { species: foes.shift()! };
    },
    canSave: () => !battle,
    state: () => ({ player }) as unknown as GameState,
    battle: () => (battle ? ({ kind: 'wild', battlers: [{ side: 'enemy', species: battle.species }], prompt: { kind: 'command' } } as unknown as BattleView) : null),
    inBattle: () => battle !== null,
    battleChoose(c: BattleChoice) {
      log.push(`${c.kind} ${battle!.species}`);
      battle = null;
    },
    press(b: Button) {
      held = b;
    },
    release(b: Button) {
      if (held === b) held = null;
    },
    wildBattles: () => 'battle',
    evolutions: () => 'manual',
    app: () => null,
    appView: () => null,
  } as unknown as UntilTarget;
  return { t, log };
}

describe('until wild', () => {
  it('walking: steps there and back, runs from other wild battles, stops when the species is up (its prompt left)', () => {
    const { t, log } = target(['fixture:SKYLET', 'fixture:SKYLET', 'fixture:MOSSLET']);
    expect(runUntil(t, { kind: 'wild', species: 'fixture:MOSSLET' as Id, walk: ['right', 'left'] }, 500)).not.toBeNull();
    expect(log).toEqual(['step 1', 'step 0', 'step 1', 'run fixture:SKYLET', 'step 0', 'step 1', 'step 0', 'run fixture:SKYLET', 'step 1', 'step 0', 'step 1']);
    expect(t.battle()?.prompt).not.toBeNull();
  });

  it('without directions it only waits; it gives up after max', () => {
    const { t } = target(['fixture:MOSSLET']);
    expect(runUntil(t, { kind: 'wild', species: 'fixture:MOSSLET' as Id }, 50)).toBeNull();
    t.press('right');
    expect(runUntil(t, { kind: 'wild', species: 'fixture:MOSSLET' as Id }, 50)).toBe(3);
  });
});
