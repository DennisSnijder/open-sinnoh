/**
 * The send-out effect on the ROM (docs/research/seals.md §6): an NPC trainer whose lead carries a Ball Capsule sends
 * it out with one seal system per placed seal (held until they end), the player's Pokémon without one with its
 * ball's burst; the battle's outcome is the same as with the capsules taken off.
 */
import { describe, expect, it } from 'vitest';
import { type Id } from '@opensinnoh/core';
import { setupPokemon, type BattleResult, type NewGame, type Registries, type Trainer } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks, newGameState } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { romSlice } from '../rom.ts';

const IDLE = { held: [], pressed: [], touch: null };
const A = { held: ['a' as const], pressed: ['a' as const], touch: null };

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the send-out effect (OPENSINNOH_NDS_ROM)', () => {
  /** The trainer battle to its end, always the first move; the ticks with seal particles before the first command. */
  function run(registries: Registries, trainer: Trainer) {
    const { loaded } = loadGamePacks([romSlice().pack]);
    const s = newGameState([...registries.newGame.values()][0]! as NewGame, registries, loaded.order, 1);
    const mon = setupPokemon(s, registries, 0, 'platinum:SPECIES_EMPOLEON' as Id, 100);
    const se: number[] = [];
    const b = createBattle(
      { kind: 'trainer', trainers: [trainer.id], wild: [], background: null, terrain: null, time: 'day' },
      { registries, party: [mon], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 1, textSpeed: 1, log: new CountingStubLog(() => {}), options: { scene: false, style: 'set' }, sound: { victory: () => {}, se: (n) => se.push(n) } },
    );
    let firstCommand = -1;
    let particleTicks = 0;
    let maxParticles = 0;
    let result: BattleResult | null = null;
    for (let tick = 0; tick < 40000 && !result; tick++) {
      const v = b.view();
      if (firstCommand < 0 && v.sendOut) {
        particleTicks++;
        maxParticles = Math.max(maxParticles, v.sendOut.length);
      }
      if (v.prompt?.kind === 'command') {
        if (firstCommand < 0) firstCommand = tick;
        b.choose({ kind: 'move', slot: 0 });
      }
      b.step(tick % 2 ? A : IDLE);
      result = b.done();
    }
    if (!result) throw new Error('the battle did not end');
    return { firstCommand, particleTicks, maxParticles, se, result };
  }

  it("a capsule's seals play at the foe's send-out and hold it; the outcome is unchanged", () => {
    const { registries } = loadGamePacks([romSlice().pack]);
    const reg = registries as Registries;
    const trainer = [...reg.trainers.values()].find((t) => !t.double && (t.party[0]?.ballSeal ?? 0) > 0)!;
    expect(trainer).toBeDefined();
    const tables = (reg.newGame.values().next().value as NewGame).seals!;
    expect(tables.trainerCapsules[trainer.party[0]!.ballSeal - 1]!.length).toBeGreaterThan(0);
    const sealed = run(reg, trainer);
    const plain = run({ ...reg, trainers: new Map([[trainer.id, { ...trainer, party: trainer.party.map((m) => ({ ...m, ballSeal: 0 })) }]]) } as Registries, trainer);
    // The ball-open sound at every send-out (the foe's lead, the player's, and the foe's later Pokémon).
    expect(sealed.se.filter((n) => n === 1798).length).toBeGreaterThanOrEqual(2);
    expect(sealed.particleTicks).toBeGreaterThan(plain.particleTicks);
    expect(sealed.maxParticles).toBeGreaterThan(0);
    expect(plain.particleTicks).toBeGreaterThan(0);
    // The seals hold the foe's send-out: the first command comes later; the battle ends the same.
    expect(sealed.firstCommand).toBeGreaterThan(plain.firstCommand);
    expect(sealed.result).toEqual(plain.result);
  });
});
