/**
 * A trapped Pokémon can't be switched out from the command card (OPENSINNOH_NDS_ROM): decomp
 * COMMAND_SELECTION_PARTY_SELECT_INIT hands Battler_IsTrapped to the party menu, which refuses every pick
 * (BattleParty_Text_CantSwitchPokemon). The battle refused nothing and passed the switch to the sim, which threw
 * "Can't switch: The active Pokémon is trapped" (found by the battle soak, tools/battle-soak.ts).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!ROM)('a trapped Pokémon stays in (OPENSINNOH_NDS_ROM)', () => {
  it('after its own Ingrain: the command card refuses the switch, the party sheet is marked trapped and refuses the pick', () => {
    const reg: Registries = loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    const mon = (species: string, moves: string[]): Pokemon => createTrainerPokemon(dexOf(reg), { species: P(species), level: 100, ivs: 31, pid: 0x10, otId: 1, moves: moves.map((m) => P(`MOVE_${m}`)) }, 'Lucas', P('ITEM_POKE_BALL'));
    const b = createBattle(
      { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_MAGIKARP'), level: 5 }], background: null, terrain: null, time: 'day' },
      { registries: reg, party: [mon('SPECIES_LUCARIO', ['INGRAIN', 'SPLASH']), mon('SPECIES_BIDOOF', ['TACKLE'])], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log: new CountingStubLog(() => {}) },
    );
    /** Steps past the answered prompt to the next one. */
    const untilPrompt = () => {
      b.step(IDLE);
      for (let i = 0; i < 30000 && !b.view().prompt; i++) b.step(IDLE);
      expect(b.view().prompt).not.toBeNull();
    };
    for (let i = 0; i < 30000 && !b.view().prompt; i++) b.step(IDLE);
    // Before Ingrain it may leave: the sheet is not marked.
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'party-select', forced: false });
    expect(b.app()).not.toHaveProperty('trapped');
    b.appDone({ app: 'party-select', slot: null });
    untilPrompt();
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt();
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
    expect(() => b.choose({ kind: 'switch', slot: 1 })).toThrow("LUCARIO can't be switched out");
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'party-select', forced: false, trapped: true });
    expect(() => b.appDone({ app: 'party-select', slot: 1 })).toThrow("can't be switched out");
    b.appDone({ app: 'party-select', slot: null });
    untilPrompt();
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
    b.choose({ kind: 'move', slot: 1 });
    untilPrompt();
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
  }, 60_000);
});
