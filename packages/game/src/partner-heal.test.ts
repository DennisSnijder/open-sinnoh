/**
 * Decomp encounter.c FieldTask_Encounter / FieldTask_WildEncounter: after a battle the player did not lose, the
 * party is healed while a partner walks along (SystemFlag_CheckHasPartner → Party_HealAllMembers). A fake battle
 * that returns the party hurt and poisoned.
 */
import { describe, expect, it } from 'vitest';
import { setupPokemon, type BattleSetup, type BattleView, type CreateBattle, type CreateWorld } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const id = (s: string) => `fixture:${s}` as Id;

function run(outcome: 'won' | 'fled' | 'draw', hasPartner: boolean) {
  let start!: (s: BattleSetup) => void;
  const world: CreateWorld = (deps) => {
    start = deps.battles.start;
    return createFakeWorld(deps);
  };
  const battle: CreateBattle = (_setup, deps) => {
    let ticks = 0;
    const party = structuredClone(deps.party);
    party[0]!.hp = 1;
    party[0]!.status = 'poison';
    party[0]!.pp[0] = 0;
    return {
      step: () => void ticks++,
      choose: () => {},
      view: () => ({ battlers: [] }) as unknown as BattleView,
      done: () => (ticks >= 2 ? { outcome, turns: 1, ballsThrown: 0, party, money: deps.money, bag: deps.bag, caught: null, seen: [], levelled: [] } : null),
      app: () => null,
      appDone: () => {},
    };
  };
  const game = createGame({ packs: [readPack('fixture')], createWorld: world, createScriptRunner: createFakeScriptRunner, createBattle: battle, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-10-14T00:00:00.000Z' });
  game.state.party = [setupPokemon(game.state, game.registries, 0, id('SPECIES_MOSSLET'), 12)];
  game.state.hasPartner = hasPartner;
  start({ kind: 'wild', trainers: [], wild: [{ species: id('SPECIES_SKYLET'), level: 3 }, { species: id('SPECIES_SKYLET'), level: 3 }], background: null, terrain: null, time: 'day', topology: 'ai-partner', partner: id('TRAINER_PARTNER') } as BattleSetup);
  for (let i = 0; i < 10 && game.inBattle(); i++) game.tick();
  return game.state.party[0]!;
}

describe('healing after a battle with a walking partner', () => {
  it('a won (or fled) battle heals HP, status and PP while the partner walks along; not without one, not after a draw', () => {
    for (const outcome of ['won', 'fled'] as const) {
      const healed = run(outcome, true);
      expect([healed.hp, healed.status, healed.pp[0]], outcome).toEqual([healed.stats.hp, 'none', 35]);
    }
    expect(run('won', false)).toMatchObject({ hp: 1, status: 'poison' });
    expect(run('draw', true)).toMatchObject({ hp: 1, status: 'poison' });
  });
});
