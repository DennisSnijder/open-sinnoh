/**
 * Decomp encounter.c FieldTask_Encounter / FieldTask_WildEncounter / FieldTask_CatchingTutorialEncounter: after a
 * battle the player did not lose or draw (the tutorial whatever its result), FieldTransition_StartMap rebuilds the
 * field, and FieldMap_Init runs the zone's on-load, then its on-resume script. One fake battle per kind and result.
 */
import { describe, expect, it } from 'vitest';
import type { BattleKind, BattleOutcome, BattleSetup, BattleView, CreateBattle, CreateScriptRunner, CreateWorld } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const id = (s: string) => `fixture:${s}` as Id;

function run(kind: BattleKind, outcome: BattleOutcome): string[] {
  let start!: (s: BattleSetup) => void;
  const world: CreateWorld = (deps) => {
    start = deps.battles.start;
    return createFakeWorld(deps);
  };
  const ran: string[] = [];
  const runner: CreateScriptRunner = (deps) => {
    const r = createFakeScriptRunner(deps);
    const immediate = r.runImmediate.bind(r);
    r.runImmediate = (s) => (s.label.startsWith('test:') ? void ran.push(`${s.source} ${s.label}`) : immediate(s));
    return r;
  };
  const battle: CreateBattle = (_setup, deps) => {
    let ticks = 0;
    return {
      step: () => void ticks++,
      choose: () => {},
      view: () => ({ battlers: [] }) as unknown as BattleView,
      done: () => (ticks >= 2 ? { outcome, turns: 1, party: deps.party, money: deps.money, bag: deps.bag, caught: null, seen: [], levelled: [] } : null),
      app: () => null,
      appDone: () => {},
    };
  };
  const game = createGame({ packs: [readPack('fixture')], createWorld: world, createScriptRunner: runner, createBattle: battle, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-10-14T00:00:00.000Z' });
  const zone = game.registries.zones.get(game.state.player.zone)!;
  zone.mapScripts = { ...zone.mapScripts, onLoad: 'test:OnLoad' as Id, onResume: 'test:OnResume' as Id };
  start({ kind, trainers: kind === 'trainer' || kind === 'first' ? [id('TRAINER_CAMPER')] : [], wild: kind === 'trainer' || kind === 'first' ? [] : [{ species: id('SPECIES_SKYLET'), level: 3 }], background: null, terrain: null, time: 'day' } as BattleSetup);
  for (let i = 0; i < 10 && game.inBattle(); i++) game.tick();
  expect(game.inBattle()).toBe(false);
  return ran;
}

describe("the field's return after a battle", () => {
  it('runs on-load, then on-resume, after every kind of battle not lost or drawn', () => {
    for (const kind of ['wild', 'trainer', 'first', 'static', 'legendary'] as const) {
      for (const outcome of ['won', 'fled', 'enemy-fled'] as const) expect(run(kind, outcome), `${kind} ${outcome}`).toEqual(['load test:OnLoad', 'resume test:OnResume']);
      for (const outcome of ['lost', 'draw'] as const) expect(run(kind, outcome), `${kind} ${outcome}`).toEqual([]);
    }
  });

  it('runs after the catching tutorial whatever its result (FieldTask_CatchingTutorialEncounter checks none)', () => {
    expect(run('tutorial', 'lost')).toEqual(['load test:OnLoad', 'resume test:OnResume']);
  });
});
