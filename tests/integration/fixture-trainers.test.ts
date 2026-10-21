/**
 * Trainer sight end to end on the fixture pack: the real world spots the player, starts the approach
 * script, and the VM's trainer commands run the approach, the dialogue, a real battle and the flag.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackFolder, type Id } from '@opensinnoh/core';
import { setupPokemon, type Facing } from '@opensinnoh/contracts';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

const root = join(import.meta.dirname, '../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const f = (n: string) => `fixture:${n}` as Id;

function gameAt(x: number, z: number, facing: Facing, party: number, flags: string[] = []) {
  const game = createGame({ packs: [readPackFolder(read, 'packs/fixture')], createWorld, createScriptRunner, createBattle, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
  game.state.player = { zone: f('ROUTE_E'), x, z, y: 0, facing };
  game.state.objects = [];
  for (const fl of flags) game.state.flags[f(fl)] = true; // a fresh map load, not the new-game room's objects
  for (let i = 0; i < party; i++) game.state.party.push(setupPokemon(game.state, game.registries, i, f('SPECIES_SKYLET'), 20));
  game.world.enter('arrival');
  runUntil(game, () => game.world.idle());
  return game;
}

function runUntil(game: ReturnType<typeof createGame>, cond: () => boolean, max = 600) {
  for (let i = 0; i < max; i++) {
    if (cond()) return;
    // A battle's command prompt: fight with the first move (the fixture's Skylet at level 20 wins).
    const p = game.battle?.view().prompt;
    if (p?.kind === 'command') game.battleChoose({ kind: 'move', slot: 0 });
    else if (p?.kind === 'learn') game.battleChoose({ kind: 'keep' });
    game.step({ held: [], pressed: [], touch: null });
  }
  throw new Error(`not reached in ${max} ticks; view=${JSON.stringify(game.scripts.view())}`);
}

describe('fixture trainers (world sight + VM trainer commands)', () => {
  it('a single trainer spots the player, walks up, speaks, battles (a real battle, won) and is flagged', () => {
    const game = gameAt(42, 15, 'up', 1);
    for (let i = 0; i < 8; i++) game.step({ held: ['up'], pressed: i === 0 ? ['up'] : [], touch: null });
    runUntil(game, () => game.scripts.running());
    runUntil(game, () => game.scripts.view().message?.text === 'The hills made me strong. Ready?');
    runUntil(game, () => !game.scripts.running(), 20000);
    expect(game.battles.map(({ kind, trainers, result }) => ({ kind, trainers, result }))).toEqual([{ kind: 'trainer', trainers: [f('TRAINER_HIKER')], result: 'won' }]);
    expect(game.state.flags[f('FLAG_TRAINER_HIKER')]).toBe(true);
    // Each Pokémon the trainer sent out is marked seen (decomp Pokedex_Encounter), not caught.
    const sent = game.registries.trainers.get(f('TRAINER_HIKER'))!.party.map((m) => m.species);
    expect(new Set(game.state.pokedex.seen)).toEqual(new Set(sent));
    expect(game.state.pokedex.caught).toEqual([]);
  });

  it('talking to a defeated trainer prints its post-battle message', () => {
    const game = gameAt(42, 11, 'up', 1, ['FLAG_TRAINER_HIKER']);
    const hiker = game.state.objects.find((o) => o.localId === 0)!;
    expect([hiker.x, hiker.z]).toEqual([42, 10]);
    game.step({ held: ['a'], pressed: ['a'], touch: null });
    runUntil(game, () => game.scripts.view().message?.text === 'Keep climbing, friend.');
    expect(game.battles).toEqual([]);
  });
});
