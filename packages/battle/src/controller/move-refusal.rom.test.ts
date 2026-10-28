/**
 * The move list refusing a move that can't be used now, on the real ROM (OPENSINNOH_NDS_ROM): decomp
 * BattleSystem_CanUseMove's message for each reason the sim gives (the move slot's disabledSource), then the move
 * list again on that move (COMMAND_SELECTION_ALERT_MESSAGE_WAIT). The Choice item plays a real turn; the other
 * conditions are put on the sim between turns and its DisableMove event run again, as the sim does at a turn start.
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import type { Battle as SimBattle, Pokemon as SimMon } from '@pkmn/sim';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';
import { BattleText, pages } from '../messages.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;
type Harness = ReturnType<typeof createBattle> & { sim: SimBattle };

describe.skipIf(!ROM)('the move list refuses a move that cannot be used now (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let text: BattleText;
  const load = () => {
    reg ??= loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    text ??= new BattleText(reg);
  };
  const MOVES = ['SWORDS_DANCE', 'RECOVER', 'TACKLE', 'BOUNCE'];
  const lead = (item?: string): Pokemon =>
    createTrainerPokemon(dexOf(reg), { species: P('SPECIES_LUCARIO'), level: 100, ivs: 31, pid: 0x10, otId: 1, moves: MOVES.map((m) => P(`MOVE_${m}`)), ...(item ? { item: P(`ITEM_${item}`) } : {}) }, 'Lucas', P('ITEM_POKE_BALL'));
  const battle = (item?: string) =>
    createBattle(
      { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_MAGIKARP'), level: 100 }], background: null, terrain: null, time: 'day' },
      { registries: reg, party: [lead(item)], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log: new CountingStubLog(() => {}) },
    ) as Harness;
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
  const name = (kind: 'species' | 'moves' | 'items', n: string) => reg[kind].get(P(n))!.name;
  /** A message's pages as the battle shows them. */
  const page = (message: string, vars: string[], sided = true) => pages(text.get(message, vars, sided ? 'Ally' : undefined), []);
  /** A battle at its second command prompt, after Lucario used Swords Dance (its last move). */
  const secondTurn = (item?: string) => {
    const b = battle(item);
    untilPrompt(b);
    b.choose({ kind: 'move', slot: 0 });
    expect(untilPrompt(b).join('|')).not.toMatch(/fainted/);
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
    return b;
  };
  /** Puts a condition on the sim and asks it which moves are disabled again (its turn start: Battle.nextTurn). */
  const condition = (b: Harness, add: (me: SimMon, foe: SimMon) => void) => {
    const me = b.sim.p1.active[0]!;
    add(me, b.sim.p2.active[0]!);
    for (const slot of me.moveSlots) slot.disabled = false;
    b.sim.runEvent('DisableMove', me);
  };
  /** Picks `slot` in the move list (the card): the list closes, the message prints, the list comes back on it. */
  const refused = (b: Harness, slot: number, expected: string[]) => {
    b.choose({ kind: 'fight' });
    b.choose({ kind: 'move', slot });
    expect(b.view().prompt).toBeNull();
    expect(untilPrompt(b)).toEqual(expected);
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: slot });
  };
  const lucario = () => name('species', 'SPECIES_LUCARIO');
  const move = (i: number) => name('moves', `MOVE_${MOVES[i]}`);

  it('a Choice item: "The Choice Band allows the use of only Swords Dance!", then the locked move is taken', () => {
    load();
    const b = secondTurn('CHOICE_BAND');
    refused(b, 2, page('TheItemAllowsTheUseOfOnlyMove', [name('items', 'ITEM_CHOICE_BAND'), move(0)], false));
    // The d-pad: A on Tackle again, then on Swords Dance.
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    press('a');
    expect(b.view().prompt).toBeNull();
    expect(untilPrompt(b)).toEqual(page('TheItemAllowsTheUseOfOnlyMove', [name('items', 'ITEM_CHOICE_BAND'), move(0)], false));
    press('up');
    press('left');
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 0 });
    press('a');
    expect(untilPrompt(b).join('|')).toContain(lucario());
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
  }, 120_000);

  it('Disable, Encore, Torment, Taunt, Imprison, Gravity and Heal Block each print their message', () => {
    load();
    let b = secondTurn();
    condition(b, (me, foe) => me.addVolatile('disable', foe));
    refused(b, 0, page('PokemonsMoveIsDisabled', [lucario(), move(0)]));

    b = secondTurn();
    condition(b, (me, foe) => me.addVolatile('encore', foe));
    refused(b, 2, page('PokemonsMoveIsDisabled', [lucario(), move(2)]));

    b = secondTurn();
    condition(b, (me, foe) => me.addVolatile('torment', foe));
    refused(b, 0, page('PokemonCantUseTheSameMoveTwiceInARowDueToTheTorment', [lucario()], false));

    b = secondTurn();
    condition(b, (me, foe) => me.addVolatile('taunt', foe));
    refused(b, 1, page('PokemonCantUseMoveAfterTheTaunt', [lucario(), move(1)]));

    b = secondTurn();
    condition(b, (_me, foe) => foe.addVolatile('imprison', foe));
    const sealed = b.sim.p1.active[0]!.moveSlots.findIndex((s) => s.disabled);
    expect(sealed).toBeGreaterThanOrEqual(0);
    refused(b, sealed, page('PokemonCantUseTheSealedMove', [lucario(), move(sealed)]));

    b = secondTurn();
    condition(b, (me) => b.sim.field.addPseudoWeather('gravity', me));
    refused(b, 3, page('PokemonCantUseMoveBecauseOfGravity', [lucario(), move(3)]));

    b = secondTurn();
    condition(b, (me, foe) => me.addVolatile('healblock', foe));
    refused(b, 1, page('PokemonCantUseMoveBecauseOfMove', [lucario(), name('moves', 'MOVE_HEAL_BLOCK'), move(1)]));
    // Back on the list, a usable move goes ahead.
    b.choose({ kind: 'move', slot: 2 });
    expect(untilPrompt(b).join('|')).toContain(lucario());
  }, 120_000);
});
