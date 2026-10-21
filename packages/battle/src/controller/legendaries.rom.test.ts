/**
 * Battle goldens for the post-game legendaries on the real ROM (OPENSINNOH_NDS_ROM):
 * Regigigas's Slow Start (decomp subscript_slow_start / _end), Heatran's Flash Fire
 * (subscript_absorb_and_boost_fire_type_moves), and the formes in battle: Rotom's appliance forms (services
 * `setRotomForm`) and Giratina's Origin Forme (the Griseous Orb) battle as their sim formes, with the stored
 * Pokémon's stats, ability and moves.
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type BattleSetup, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { setGiratinaFormByItem, setRotomForm } from '@opensinnoh/services';
import type { Battle as SimBattle, Pokemon as SimMon } from '@pkmn/sim';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';
import { BattleText, pages } from '../messages.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;
type Harness = ReturnType<typeof createBattle> & { sim: SimBattle };

describe.skipIf(!ROM)('legendary battle goldens (OPENSINNOH_NDS_ROM)', () => {
  const load = () => {
    const { pack } = romSlice() as { pack: PackData };
    return loadGamePacks([pack]).registries;
  };
  let reg: Registries;
  const mon = (species: string, level: number, moves: string[], item?: string): Pokemon =>
    createTrainerPokemon(dexOf(reg), { species: P(`SPECIES_${species}`), level, ivs: 31, pid: 0x10, otId: 1, moves: moves.map((m) => P(`MOVE_${m}`)), ...(item ? { item: P(`ITEM_${item}`) } : {}) }, 'Lucas', P('ITEM_POKE_BALL'));
  const battle = (party: Pokemon[], wild: BattleSetup['wild'], log = new CountingStubLog(() => {})) =>
    createBattle(
      { kind: 'legendary', trainers: [], wild, background: null, terrain: null, time: 'day' },
      { registries: reg, party, bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 3, textSpeed: 1, log },
    ) as Harness;
  /** Steps to the next prompt (or the end), collecting every finished message page. */
  const untilPrompt = (b: Harness, messages: string[]) => {
    for (let i = 0; i < 30000; i++) {
      if (b.done()) return;
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && messages.at(-1) !== m.text) messages.push(m.text);
      if (b.view().prompt) return;
    }
    throw new Error('the battle never reached a prompt');
  };
  const page = (text: BattleText, name: string, vars: string[]) => pages(text.get(name, vars, 'Wild'), [])[0]!;
  const nameOf = (kind: 'species' | 'abilities' | 'moves', n: string) => reg[kind].get(P(n))!.name;
  const sims = (b: Harness): [SimMon, SimMon] => [b.sim.p1.active[0]!, b.sim.p2.active[0]!];

  it('Slow Start: the wild Regigigas cannot get going, at half Attack and Speed for five turns, then gets its act together', () => {
    reg = load();
    const text = new BattleText(reg);
    const log = new CountingStubLog(() => {});
    const b = battle([mon('SHUCKLE', 100, ['WITHDRAW'])], [{ species: P('SPECIES_REGIGIGAS'), level: 70 }], log);
    const messages: string[] = [];
    untilPrompt(b, messages);
    expect(messages).toContain(page(text, 'PokemonCantGetItGoingBecauseOfItsAbility', [nameOf('species', 'SPECIES_REGIGIGAS'), nameOf('abilities', 'ABILITY_SLOW_START')]));
    const [, gigas] = sims(b);
    // The sim's Slow Start counter halves physical Attack while it runs (asked per move, not here).
    expect(gigas.abilityState.counter).toBe(5);
    expect(gigas.getStat('spe')).toBe(Math.floor(gigas.storedStats.spe / 2));
    const done = page(text, 'PokemonFinallyGotItsActTogether', [nameOf('species', 'SPECIES_REGIGIGAS')]);
    let turns = 0;
    while (!messages.includes(done) && turns < 8) {
      b.choose({ kind: 'move', slot: 0 });
      turns++;
      untilPrompt(b, messages);
    }
    expect(turns).toBe(5);
    expect(gigas.abilityState.counter).toBeUndefined();
    expect(gigas.getStat('spe')).toBe(gigas.storedStats.spe);
    expect(log.report().filter((s) => s.key.startsWith('battle:protocol')).map((s) => s.key)).toEqual([]);
  }, 120_000);

  it('Flash Fire: the first Fire move raises the wild Heatran’s Fire moves, the next is made ineffective', () => {
    reg = load();
    const text = new BattleText(reg);
    const log = new CountingStubLog(() => {});
    const b = battle([mon('SHUCKLE', 100, ['EMBER'])], [{ species: P('SPECIES_HEATRAN'), level: 50 }], log);
    const messages: string[] = [];
    untilPrompt(b, messages);
    const [, heatran] = sims(b);
    expect(heatran.ability).toBe('flashfire');
    const full = heatran.hp;
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt(b, messages);
    expect(messages).toContain(page(text, 'PokemonsAbilityRaisedThePowerOfItsFireTypeMoves', [nameOf('species', 'SPECIES_HEATRAN'), nameOf('abilities', 'ABILITY_FLASH_FIRE')]));
    expect(heatran.volatiles['flashfire']).toBeDefined();
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt(b, messages);
    expect(messages).toContain(page(text, 'PokemonsAbilityMadeMoveIneffective', [nameOf('species', 'SPECIES_HEATRAN'), nameOf('abilities', 'ABILITY_FLASH_FIRE'), nameOf('moves', 'MOVE_EMBER')]));
    expect(heatran.hp).toBe(full);
    expect(log.report().filter((s) => s.key.startsWith('battle:protocol')).map((s) => s.key)).toEqual([]);
  }, 120_000);

  it('Rotom’s appliance forms battle as their formes: types, Levitate, the appliance move and the stored stats', () => {
    reg = load();
    const formes: [number, string, string[], string][] = [
      [1, 'Rotom-Heat', ['Electric', 'Ghost'], 'overheat'],
      [2, 'Rotom-Wash', ['Electric', 'Ghost'], 'hydropump'],
      [3, 'Rotom-Frost', ['Electric', 'Ghost'], 'blizzard'],
      [4, 'Rotom-Fan', ['Electric', 'Ghost'], 'airslash'],
      [5, 'Rotom-Mow', ['Electric', 'Ghost'], 'leafstorm'],
    ];
    for (const [form, name, types, move] of formes) {
      const rotom = mon('ROTOM', 40, ['THUNDER_SHOCK', 'CONFUSE_RAY']);
      setRotomForm(reg, rotom, form, 0);
      const b = battle([rotom], [{ species: P('SPECIES_BIDOOF'), level: 5 }]);
      untilPrompt(b, []);
      const [sim] = sims(b);
      // Gen 4 appliance formes keep Electric/Ghost (their own types came in Gen 5).
      expect([sim.species.name, sim.types, sim.ability], name).toEqual([name, types, 'levitate']);
      expect(sim.moveSlots.map((m) => m.id)).toEqual(['thundershock', 'confuseray', move]);
      expect(sim.storedStats).toEqual({ atk: rotom.stats.attack, def: rotom.stats.defense, spa: rotom.stats.spAttack, spd: rotom.stats.spDefense, spe: rotom.stats.speed });
    }
  }, 120_000);

  it('Giratina holding the Griseous Orb battles in its Origin Forme (Levitate, its own stats); without it, Altered', () => {
    reg = load();
    const origin = mon('GIRATINA', 47, ['SHADOW_FORCE'], 'GRISEOUS_ORB');
    setGiratinaFormByItem(reg, origin);
    expect(origin.form).toBe(1);
    const b = battle([origin], [{ species: P('SPECIES_BIDOOF'), level: 5 }]);
    untilPrompt(b, []);
    const [sim] = sims(b);
    expect([sim.species.name, sim.ability, sim.item]).toEqual(['Giratina-Origin', 'levitate', 'griseousorb']);
    expect(sim.storedStats.atk).toBe(origin.stats.attack);
    const altered = mon('GIRATINA', 47, ['SHADOW_FORCE']);
    setGiratinaFormByItem(reg, altered);
    const a = battle([altered], [{ species: P('SPECIES_BIDOOF'), level: 5 }]);
    untilPrompt(a, []);
    expect([sims(a)[0].species.name, sims(a)[0].ability]).toEqual(['Giratina', 'pressure']);
    // The wild Giratina of the Distortion World's battle (start_giratina_origin_battle): Origin without the orb.
    const w = battle([mon('SHUCKLE', 100, ['WITHDRAW'])], [{ species: P('SPECIES_GIRATINA'), level: 47, form: 1 }]);
    untilPrompt(w, []);
    expect([sims(w)[1].species.name, sims(w)[1].ability]).toEqual(['Giratina-Origin', 'levitate']);
  }, 120_000);
});
