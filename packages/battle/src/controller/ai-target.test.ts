/** The controller must format AI choices using the sim's current target, including Curse's live-type change. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Battle as SimBattle } from '@pkmn/sim';
import { expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id } from '@opensinnoh/core';
import { dexOf, type InputFrame, type Move } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from '../controller.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined;
const fixture = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const f = (s: string) => `fixture:${s}` as Id;
const idle: InputFrame = { held: [], pressed: [], touch: null };

it('formats non-Ghost Curse without a target, but preserves the target when live typing becomes Ghost', () => {
  const curse: Move = { ...fixture.moves.get(f('MOVE_BOP'))!, id: f('MOVE_CURSE'), sourceIndex: 1002,
    name: 'Curse', power: 0, category: 'status', effect: f('BATTLE_EFFECT_CURSE'), target: 'SINGLE_TARGET' };
  const reg = { ...fixture, moves: new Map(fixture.moves).set(curse.id, curse) };
  const dex = dexOf(reg);
  for (const ghost of [false, true]) {
    const party = [curse.id, f('MOVE_BOP')].map((move) => createPokemon(dex, {
      species: f('SPECIES_MOSSLET'), level: 20, pid: 0, ivs: 0, otId: 1, otName: 'Test', otGender: 'male',
      ball: f('ITEM_CAPTURE_ORB'), moves: [move],
    }));
    const b = createBattle({ kind: 'trainer', trainers: [f('TRAINER_TWINS')], topology: 'double', wild: [], background: null, terrain: null, time: 'day' }, {
      registries: reg, party, bag: {}, pc: { current: { box: 0, name: 'Box' }, free: { box: 0, name: 'Box' }, metBebe: false },
      met: { zone: null, date: null }, player: { name: 'Test', gender: 'male', trainerId: 1, rival: 'Rival' },
      money: 0, badges: 0, caught: [], seed: 1, textSpeed: 1, log: new CountingStubLog(() => {}),
    });
    for (let tick = 0; tick < 2000 && b.view().prompt?.kind !== 'command'; tick++) b.step(idle);
    expect(b.view().prompt?.kind).toBe('command');
    const live = b as typeof b & { sim: SimBattle; battlers: { id: number }[]; moveChoice(user: { id: number }, slot: number, target: number): string };
    if (ghost) live.sim.p1.active[0]!.setType('Ghost');
    // AI output may contain a self-target for non-Ghost Curse; sim.getMoves supplies the executable target.
    const choice = live.moveChoice(live.battlers[0]!, 1, ghost ? 1 : 0);
    expect(() => live.sim.choose('p1', `${choice}, move 1 1`)).not.toThrow();
    expect(choice).toBe(ghost ? 'move 1 1' : 'move 1');
    live.sim.destroy();
  }
});
