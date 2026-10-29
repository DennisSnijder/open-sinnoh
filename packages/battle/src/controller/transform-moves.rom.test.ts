/**
 * The move list is the battler's own moves (OPENSINNOH_NDS_ROM): after Transform the target's at 5 PP each (decomp
 * BtlCmd_TransformBattler copies the BattleMon up to its ability: the moves, not the PP Ups), not the party Pokémon's.
 * It showed Ditto's Transform alone, so only the first copied move could be picked (found by the battle soak,
 * tools/battle-soak.ts, whose player AI picked the second).
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

describe.skipIf(!ROM)('the move list after Transform (OPENSINNOH_NDS_ROM)', () => {
  it("lists the target's moves at 5 PP, each can be picked, and with all of them sealed FIGHT struggles", () => {
    const reg: Registries = loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    const ditto = createTrainerPokemon(dexOf(reg), { species: P('SPECIES_DITTO'), level: 100, ivs: 31, pid: 0x10, otId: 1, moves: [P('MOVE_TRANSFORM')] }, 'Lucas', P('ITEM_POKE_BALL'));
    const b = createBattle(
      { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_MAGIKARP'), level: 30 }], background: null, terrain: null, time: 'day' },
      { registries: reg, party: [ditto], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log: new CountingStubLog(() => {}) },
    ) as ReturnType<typeof createBattle> & { sim: SimBattle };
    const untilPrompt = () => {
      b.step(IDLE);
      for (let i = 0; i < 30000 && !b.view().prompt; i++) b.step(IDLE);
      expect(b.view().prompt).toMatchObject({ kind: 'command' });
    };
    untilPrompt();
    const name = (m: string) => reg.moves.get(P(`MOVE_${m}`))!.name;
    expect(b.view().prompt).toMatchObject({ moves: [{ name: name('TRANSFORM'), pp: 10, maxPp: 10 }] });
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt();
    const target = b.sim.p2.active[0]!.moveSlots;
    const copied = target.map((s) => s.id);
    expect(copied.length).toBeGreaterThan(1);
    const prompt = b.view().prompt as { moves: { move: Id; pp: number; maxPp: number }[] };
    expect(prompt.moves.map((m) => m.move)).toEqual(copied.map((id) => [...reg.moves.values()].find((m) => m.name.toLowerCase().replace(/[^a-z]/g, '') === id)!.id));
    // Decomp: 5 PP; the maximum from Ditto's own PP Ups by slot (none), as BattleMon.ppUps is not copied.
    expect(prompt.moves.map((m) => [m.pp, m.maxPp])).toEqual(copied.map((id) => [5, b.sim.dex.moves.get(id).pp]));
    b.choose({ kind: 'fight' });
    b.choose({ kind: 'move', slot: 1 });
    untilPrompt();
    expect(b.sim.p1.active[0]!.lastMove?.id).toBe(copied[1]);
    expect((b.view().prompt as { moves: { pp: number }[] }).moves[1]!.pp).toBe(4);
    // The foe's Imprison seals every copied move (the sim's request hides it): no refusal, FIGHT struggles (decomp
    // STRUGGLING_ALL). The move list refused each move in turn and never struggled (the soak's specials seed 1843).
    const me = b.sim.p1.active[0]!;
    b.sim.p2.active[0]!.addVolatile('imprison', b.sim.p2.active[0]!);
    for (const slot of me.moveSlots) slot.disabled = false;
    b.sim.runEvent('DisableMove', me);
    expect(me.moveSlots.every((slot) => slot.disabled)).toBe(true);
    const before = b.sim.log.length;
    b.choose({ kind: 'fight' });
    b.choose({ kind: 'move', slot: 2 });
    b.step(IDLE);
    for (let i = 0; i < 30000 && !b.done() && !b.view().prompt; i++) b.step(IDLE);
    expect(b.sim.log.slice(before).join('\n')).toMatch(/\|move\|p1a: DITTO\|Struggle/);
  }, 60_000);
});
