/**
 * A turn spent outside the sim (an item, a ball, a failed run: the hidden pass move) on the real ROM
 * (OPENSINNOH_NDS_ROM). The DS runs no move for it (decomp BattleControllerPlayer_ItemCommand goes to MOVE_END,
 * past UpdateMoveBuffers), so the moves that read the target's last move see the move used before: Spite, Encore
 * and Disable after an X Attack turn hit Swords Dance, and an item turn runs no status check (sleep).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import type { Battle as SimBattle, Pokemon as SimMon } from '@pkmn/sim';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;
type Harness = ReturnType<typeof createBattle> & { sim: SimBattle };

describe.skipIf(!ROM)('a pass turn leaves the last move as the DS does (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  const load = () => (reg ??= loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries);
  /** Lucario (Swords Dance first) against a wild Gengar that knows only `foeMove`; X Attacks in the bag. */
  const battle = (foeMove: string): Harness => {
    load();
    const lead = createTrainerPokemon(dexOf(reg), { species: P('SPECIES_LUCARIO'), level: 100, ivs: 31, pid: 0x10, otId: 1, moves: ['SWORDS_DANCE', 'RECOVER', 'TACKLE', 'BOUNCE'].map((m) => P(`MOVE_${m}`)) }, 'Lucas', P('ITEM_POKE_BALL'));
    const b = createBattle(
      { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_GENGAR'), level: 100 }], background: null, terrain: null, time: 'day' },
      { registries: reg, party: [lead], bag: { battleItems: [{ item: P('ITEM_X_ATTACK'), count: 5 }] }, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log: new CountingStubLog(() => {}) },
    ) as Harness;
    untilPrompt(b);
    const move = b.sim.dex.moves.get(foeMove);
    const slot = { move: move.name, id: move.id, pp: 40, maxpp: 40, target: move.target, disabled: false, used: false };
    foe(b).moveSlots = [slot];
    (foe(b) as { baseMoveSlots: unknown[] }).baseMoveSlots = [{ ...slot }];
    return b;
  };
  const me = (b: Harness): SimMon => b.sim.p1.active[0]!;
  const foe = (b: Harness): SimMon => b.sim.p2.active[0]!;
  /** Steps to the next prompt, returning the finished message pages on the way. */
  const untilPrompt = (b: Harness): string[] => {
    const messages: string[] = [];
    for (let i = 0; i < 30000; i++) {
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && messages.at(-1) !== m.text) messages.push(m.text);
      if (b.view().prompt) return messages;
    }
    throw new Error('the battle never reached a prompt');
  };
  const swordsDance = (b: Harness) => {
    b.choose({ kind: 'move', slot: 0 });
    return untilPrompt(b);
  };
  const xAttack = (b: Harness) => {
    b.choose({ kind: 'item', item: P('ITEM_X_ATTACK') });
    return untilPrompt(b);
  };
  const ppUsed = (b: Harness) => me(b).moveSlots[0]!.maxpp - me(b).moveSlots[0]!.pp;

  it('Spite after an item turn cuts the move used before by 4, also while the user sleeps through an item turn', () => {
    const b = battle('spite');
    swordsDance(b);
    expect(ppUsed(b)).toBe(1); // Gengar's Spite went first and failed: Lucario had not moved yet
    xAttack(b);
    expect(ppUsed(b)).toBe(5);
    expect(me(b).lastMove?.id).toBe('swordsdance');
    // Asleep: the item turn runs no status check (no "fast asleep", no sleep turn spent); Spite hits Swords Dance again.
    me(b).setStatus('slp', foe(b));
    const sleepTurns = me(b).statusState['time'];
    const messages = xAttack(b);
    expect(messages.join('|')).not.toMatch(/asleep|OpenSinnoh/);
    expect(me(b).statusState['time']).toBe(sleepTurns);
    expect(ppUsed(b)).toBe(9);
    expect(me(b).moveSlots.map((m) => m.id)).toEqual(['swordsdance', 'recover', 'tackle', 'bounce']);
  }, 120_000);

  it('Spite on a Pokémon that only used items fails (OPEN-SINNOH-D: the sim cut the pass move and its name threw)', () => {
    const b = battle('spite');
    xAttack(b);
    me(b).setStatus('slp', foe(b));
    expect(() => xAttack(b)).not.toThrow();
    expect(me(b).lastMove).toBeNull();
    expect(me(b).moveSlots.every((m) => m.pp === m.maxpp)).toBe(true);
  }, 120_000);

  it('Encore after an item turn locks the move used before', () => {
    const b = battle('encore');
    swordsDance(b);
    xAttack(b);
    expect(me(b).volatiles['encore']?.['move']).toBe('swordsdance');
  }, 120_000);

  it('Disable after an item turn disables the move used before', () => {
    const b = battle('disable');
    swordsDance(b);
    xAttack(b);
    expect(me(b).volatiles['disable']?.['move']).toBe('swordsdance');
  }, 120_000);

  it('Copycat after an item turn copies the last move used before it (decomp movePrev)', () => {
    const b = battle('copycat');
    swordsDance(b);
    expect(foe(b).boosts.atk).toBe(0);
    xAttack(b);
    expect(foe(b).boosts.atk).toBe(2);
  }, 120_000);
});
