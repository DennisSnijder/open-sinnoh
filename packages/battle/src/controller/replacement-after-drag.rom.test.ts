/**
 * A faint replacement after the sim went on mid-turn (OPENSINNOH_NDS_ROM): the foe's U-turn knocks out the player's
 * second battler; the foe's switch for U-turn lets the sim finish the turn, where Roar drags another of the player's
 * Pokémon in; only then does the player pick the replacement. The party sheet was opened before the battle had played
 * the drag, so the dragged-in Pokémon looked free and the sim refused it ("You can't switch to an active Pokémon";
 * found by the battle soak, tools/battle-soak.ts, at a Battle Tower double).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type AppRequest, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import type { Battle as SimBattle } from '@pkmn/sim';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!ROM)('a replacement after a drag (OPENSINNOH_NDS_ROM)', () => {
  it('the Pokémon Roar dragged in is in battle on the replacement sheet; another goes in', () => {
    const reg: Registries = loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    const mon = (species: string, moves: string[], level = 50, hp?: number): Pokemon => {
      const m = createTrainerPokemon(dexOf(reg), { species: P(`SPECIES_${species}`), level, ivs: 31, pid: 0x10, otId: 1, moves: moves.map((x) => P(`MOVE_${x}`)) }, 'Lucas', P('ITEM_POKE_BALL'));
      if (hp !== undefined) m.hp = hp;
      return m;
    };
    const aaron = reg.trainers.get(P('TRAINER_ELITE_FOUR_AARON'))!;
    const run = (seed: number) => {
      const party = [mon('SNORLAX', ['SPLASH'], 100), mon('MAGIKARP', ['SPLASH'], 50, 1), mon('BIDOOF', ['SPLASH']), mon('KRICKETOT', ['SPLASH'])];
      const foes = [mon('NINJASK', ['U_TURN'], 100), mon('WAILMER', ['ROAR']), mon('SABLEYE', ['DETECT'])];
      const b = createBattle(
        { kind: 'trainer', trainers: [], wild: [], background: null, terrain: null, time: 'day', topology: 'double', frontier: { facility: 'tower', party, trainers: [{ id: 1, name: 'Foe', class: aaron.class, className: aaron.className, party: foes }] } },
        { registries: reg, party: [], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed, textSpeed: 1, log: new CountingStubLog(() => {}) },
      ) as ReturnType<typeof createBattle> & { sim: SimBattle };
      const untilPrompt = () => {
        b.step(IDLE);
        for (let i = 0; i < 30000 && !b.view().prompt && !b.done(); i++) b.step(IDLE);
      };
      untilPrompt();
      b.choose({ kind: 'move', slot: 0 });
      untilPrompt();
      b.choose({ kind: 'move', slot: 0 });
      untilPrompt();
      return b;
    };
    // The seeds where U-turn takes Magikarp and Roar then drags out Snorlax.
    const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(run).find((x) => /\|drag\|p1a: /.test(x.sim.log.join('\n')) && /\|faint\|p1b: MAGIKARP/.test(x.sim.log.join('\n')))!;
    expect(b).toBeDefined();
    const dragged = b.sim.p1.active[0]!.name === 'BIDOOF' ? 2 : 3;
    expect(b.view().prompt).toMatchObject({ kind: 'party', forced: true, actor: 2 });
    const sheet = b.app() as Extract<AppRequest, { app: 'party-select' }>;
    expect(sheet.inBattle).toBe(dragged);
    expect(() => b.choose({ kind: 'switch', slot: dragged })).toThrow('is already in battle');
    b.choose({ kind: 'switch', slot: dragged === 2 ? 3 : 2 });
    b.step(IDLE);
    for (let i = 0; i < 30000 && !b.view().prompt && !b.done(); i++) b.step(IDLE);
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
  }, 120_000);
});
