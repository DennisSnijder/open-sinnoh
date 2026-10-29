/**
 * An item turn is no move (OPENSINNOH_NDS_ROM): the battler's hidden pass move is taken out of the sim's queue before
 * the turn's moves, so move-time effects never see it. A taunted Pokémon using an X Attack had its pass stopped by
 * Taunt ("can't use OpenSinnoh Pass after the taunt"), and the battle threw naming it (found by the battle soak,
 * tools/battle-soak.ts, at Byron's rematch).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import type { Battle as SimBattle } from '@pkmn/sim';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!ROM)('an item turn is no move (OPENSINNOH_NDS_ROM)', () => {
  it('taunted, confused and Choice-locked, the Pokémon uses X Attacks: no line for its pass, nothing remembers it as a move', () => {
    const reg: Registries = loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    const lucario = createTrainerPokemon(dexOf(reg), { species: P('SPECIES_LUCARIO'), level: 100, ivs: 31, pid: 0x10, otId: 1, moves: [P('MOVE_SWORDS_DANCE'), P('MOVE_SPLASH')], item: P('ITEM_CHOICE_BAND') }, 'Lucas', P('ITEM_POKE_BALL'));
    const b = createBattle(
      { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_MAGIKARP'), level: 5 }], background: null, terrain: null, time: 'day' },
      { registries: reg, party: [lucario], bag: { battle: [{ item: P('ITEM_X_ATTACK'), count: 5 }] }, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log: new CountingStubLog(() => {}) },
    ) as ReturnType<typeof createBattle> & { sim: SimBattle };
    const untilPrompt = () => {
      b.step(IDLE);
      for (let i = 0; i < 30000 && !b.view().prompt; i++) {
        if (b.done()) throw new Error(b.sim.log.slice(-40).join('\n'));
        b.step(IDLE);
      }
      expect(b.view().prompt).toMatchObject({ kind: 'command' });
    };
    untilPrompt();
    // Swords Dance locks the Choice Band onto it; then Taunt and confusion.
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt();
    const me = b.sim.p1.active[0]!;
    me.addVolatile('taunt', b.sim.p2.active[0]!);
    me.addVolatile('confusion');
    const before = b.sim.log.length;
    for (let turn = 0; turn < 4; turn++) {
      b.choose({ kind: 'item', item: P('ITEM_X_ATTACK') });
      untilPrompt();
    }
    const log = b.sim.log.slice(before).join('\n');
    expect(log).not.toMatch(/OpenSinnoh Pass|\|cant\||\[from\] confusion/);
    // The foe moved every turn; Lucario's last move is still Swords Dance.
    expect(log.match(/\|move\|p2a: MAGIKARP\|Splash/g)).toHaveLength(4);
    expect(me.lastMove?.id).toBe('swordsdance');
    expect(me.boosts.atk).toBe(6);
    // Taunted and locked onto a status move, nothing can be used, yet the command card came each turn (the DS's
    // STRUGGLING_ALL); FIGHT struggles whatever the pick.
    me.removeVolatile('confusion');
    b.choose({ kind: 'fight' });
    b.choose({ kind: 'move', slot: 1 });
    b.step(IDLE);
    for (let i = 0; i < 30000 && !b.done() && !b.view().prompt; i++) b.step(IDLE);
    expect(b.sim.log.join('\n')).toMatch(/\|move\|p1a: LUCARIO\|Struggle/);
  }, 60_000);
});
