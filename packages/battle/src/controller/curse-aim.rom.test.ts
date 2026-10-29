/**
 * Curse's target in a double (OPENSINNOH_NDS_ROM): the user alone unless it is a Ghost type (decomp
 * BattleControllerPlayer_MustSelectTarget: RANGE_USER), any other battler for a Ghost (its own range). The card offered
 * the others for every user and refused the user, which the AI's own pick names (found by the battle soak,
 * tools/battle-soak.ts).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type BattleMoveView, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!ROM)("Curse's target in a double (OPENSINNOH_NDS_ROM)", () => {
  it('a Snorlax aims it at itself, a Gengar at any other battler', () => {
    const reg: Registries = loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    const mon = (species: string) => createTrainerPokemon(dexOf(reg), { species: P(`SPECIES_${species}`), level: 100, ivs: 31, pid: 0x10, otId: 1, moves: [P('MOVE_CURSE'), P('MOVE_PROTECT')] }, 'Lucas', P('ITEM_POKE_BALL'));
    const trainer = [...reg.trainers.values()].find((t) => t.double && t.party.length >= 2)!;
    const b = createBattle(
      { kind: 'trainer', trainers: [trainer.id], wild: [], background: null, terrain: null, time: 'day', topology: 'double' },
      { registries: reg, party: [mon('SNORLAX'), mon('GENGAR')], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log: new CountingStubLog(() => {}) },
    );
    for (let i = 0; i < 30000 && !b.view().prompt; i++) b.step(IDLE);
    const curse = () => (b.view().prompt as { moves: BattleMoveView[] }).moves[0]!.aim;
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0 });
    expect(curse()).toEqual({ targets: [0], group: true });
    // The user as the target (the trainer AI's own pick for a non-Ghost Curse) is taken.
    b.choose({ kind: 'move', slot: 0, target: 0 });
    b.step(IDLE);
    for (let i = 0; i < 30000 && !b.view().prompt; i++) b.step(IDLE);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 2 });
    expect(curse()).toEqual({ targets: [3, 1, 0], group: false });
  }, 60_000);
});
