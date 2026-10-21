/**
 * After a battle (decomp BATTLE_STATE_CHECK_EVOLUTION, Battle_FindEvolvingPartyMember): each party member
 * that levelled is checked in slot order and the evolution scene opens for each that evolves, one after
 * the other; nothing after a loss. A fake battle and a fake evolution app (the menus own the scene).
 */
import { describe, expect, it } from 'vitest';
import { setupPokemon, type AppRequest, type BattleSetup, type BattleView, type CreateApp, type CreateBattle, type CreateWorld } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const id = (s: string) => `fixture:${s}` as Id;

function setup(outcome: 'won' | 'lost' | 'fled', levelled: number[]) {
  let start!: (s: BattleSetup) => void;
  const world: CreateWorld = (deps) => {
    start = deps.battles.start;
    return createFakeWorld(deps);
  };
  const battle: CreateBattle = (_setup, deps) => {
    let ticks = 0;
    return {
      step: () => void ticks++,
      choose: () => {},
      view: () => ({ battlers: [] }) as unknown as BattleView,
      done: () => (ticks >= 2 ? { outcome, turns: 1, party: deps.party, money: deps.money, bag: deps.bag, caught: null, seen: [], levelled } : null),
      app: () => null,
      appDone: () => {},
    };
  };
  const opened: AppRequest[] = [];
  const createApp: CreateApp = (request) => {
    opened.push(request);
    // The scene "plays" for three ticks.
    let n = 0;
    return { step: () => (++n >= 3 ? { app: 'evolution', evolved: true } : null), view: () => ({ app: 'evolution' }) as never };
  };
  const log = new CountingStubLog(() => {});
  const game = createGame({ packs: [readPack('fixture')], createWorld: world, createScriptRunner: createFakeScriptRunner, createBattle: battle, createApp, seed: 1, log, now: () => '2026-10-14T00:00:00.000Z' });
  const s = game.state;
  // Slot 0: Mosslet at 16 (evolves by level), 1: Burrowbit (a stone only), 2: Mosslet at 15 (not yet), 3: Mosslet at 18.
  s.party = [setupPokemon(s, game.registries, 0, id('SPECIES_MOSSLET'), 16), setupPokemon(s, game.registries, 1, id('SPECIES_BURROWBIT'), 9), setupPokemon(s, game.registries, 2, id('SPECIES_MOSSLET'), 15), setupPokemon(s, game.registries, 3, id('SPECIES_MOSSLET'), 18)];
  start({ kind: 'wild', trainers: [], wild: [{ species: id('SPECIES_SKYLET'), level: 3 }], background: null, terrain: null, time: 'day' } as BattleSetup);
  return { game, opened, log };
}

describe('evolutions after a battle', () => {
  it('opens the scene for each levelled member that can evolve, in slot order, B allowed and "What?" first', () => {
    const { game, opened } = setup('won', [0, 1, 2, 3]);
    for (let i = 0; i < 30 && (game.inBattle() || game.app()); i++) game.tick();
    expect(opened).toEqual([
      { app: 'evolution', slot: 0, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' },
      { app: 'evolution', slot: 3, target: id('SPECIES_MOSSGROVE'), method: 'LEVEL', source: 'battle' },
    ]);
    expect(game.app()).toBeNull();
  });

  it('a flight counts too; a loss evolves nothing', () => {
    const fled = setup('fled', [0]);
    for (let i = 0; i < 10; i++) fled.game.tick();
    expect(fled.opened).toHaveLength(1);
    const lost = setup('lost', [0, 3]);
    for (let i = 0; i < 10; i++) lost.game.tick();
    expect(lost.opened).toEqual([]);
  });
});
