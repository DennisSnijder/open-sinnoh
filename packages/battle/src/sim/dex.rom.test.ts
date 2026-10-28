/**
 * The ROM's battle data in the sim (OPENSINNOH_NDS_ROM): every species and move maps to a sim id (the three
 * non-Pokémon species are listed), and all 928 trainers build legal sim teams. "Legal" here: the sim takes
 * the team as the controller builds it (`simSet`), every Pokémon comes out with the trainer's species,
 * level, moves, ability, held item, types (a form is the sim's forme) and our stats. Every ROM item the sim
 * lacks is known inert there (hold effect NONE or one that acts outside the sim), so none is a stub.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PRNG, toID } from '@pkmn/sim';
import { createTrainerPokemon, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { simData, simSet } from './dex.ts';
import { moveAnimations } from '../coverage.ts';

const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!ROM)('ROM battle data in the sim (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  /** The sim data is built once per registries; its stub log collects what has no sim counterpart. */
  const log = new CountingStubLog(() => {});
  let data: ReturnType<typeof simData>;
  beforeAll(() => {
    const { pack } = romSlice() as { pack: PackData };
    reg = loadGamePacks([pack]).registries;
    data = simData(reg, log);
  });

  it('maps every species and move; the non-Pokémon species are the listed ones', () => {
    const unmapped = [...reg.species.keys()].filter((id) => {
      try {
        data.species(id);
        return false;
      } catch {
        return true;
      }
    });
    expect(unmapped).toEqual([P('SPECIES_NONE'), P('SPECIES_EGG'), P('SPECIES_BAD_EGG')]);
    expect(reg.species.size - unmapped.length).toBe(493);
    for (const m of reg.moves.values()) expect(() => data.move(m.id), m.id).not.toThrow();
    expect(data.move(P('MOVE_SMELLING_SALT'))).toBe('smellingsalts');
  });

  it('builds legal sim teams for all 928 trainers', () => {
    const dex = dexOf(reg);
    const trainers = [...reg.trainers.values()];
    expect(trainers).toHaveLength(928);
    let mons = 0;
    for (const t of trainers) {
      if (!t.party.length) continue; // one empty placeholder trainer
      const party = t.party.map((m) => createTrainerPokemon(dex, m, t.name, P('ITEM_POKE_BALL')));
      const sim = data.createBattle('trainer', 'singles', { prng: new PRNG('sodium,00000000000000000000000000000000') } as never);
      sim.setPlayer('p1', { name: 'trainer', team: party.map((m) => simSet(data, dex, m, t.name)) } as never);
      sim.setPlayer('p2', { name: 'player', team: [simSet(data, dex, party[0]!, 'x')] } as never);
      party.forEach((m, i) => {
        const s = sim.p1.pokemon[i]!;
        const where = `${t.id} #${i + 1}`;
        expect(s.species.id, where).toBe(data.species(m.species, m.form));
        expect(s.level, where).toBe(m.level);
        // Forms battle as the sim's formes, with their own types (Wormadam's cloaks, Rotom).
        const types = dex.form(m.species, m.form).types.map((x) => reg.types.get(x)!.id.replace('platinum:TYPE_', '').toLowerCase());
        expect(s.species.types.map((x) => x.toLowerCase()), where).toEqual([...new Set(types)]);
        expect(s.baseMoveSlots.map((x) => x.id), where).toEqual(m.moves.map((x) => data.move(x)));
        expect(s.baseAbility, where).toBe(sim.dex.abilities.get(data.ability(m.ability)).id);
        if (m.heldItem) expect(s.item, where).toBe(data.item(m.heldItem) ? sim.dex.items.get(data.item(m.heldItem)).id : '');
        // The sim's own stats from the pack's base stats, IVs and EVs are ours (the controller writes ours over them anyway).
        expect([s.maxhp, s.storedStats.atk, s.storedStats.def, s.storedStats.spa, s.storedStats.spd, s.storedStats.spe], where).toEqual([m.stats.hp, m.stats.attack, m.stats.defense, m.stats.spAttack, m.stats.spDefense, m.stats.speed]);
        mons++;
      });
    }
    expect(mons).toBe(1878);
    expect(log.report().map((s) => s.key)).toEqual([]);
  });

  it('knows every ROM item: the sim has it, or it is inert in the sim (no stub), and maps back', () => {
    for (const i of reg.items.values()) {
      const name = data.item(i.id);
      if (name) expect(data.packItem(toID(name)), i.id).toBe(i.id);
    }
    expect(log.report()).toEqual([]);
    expect(data.item(P('ITEM_EVERSTONE'))).toBe('');
  });

  it('reports how each move animates: the 468 entries less MOVE_NONE, every one real', () => {
    const anims = moveAnimations(reg);
    expect(anims.size).toBe(467);
    const real = [...anims.values()].filter((a) => a === 'real').length;
    expect(real).toBe(anims.size);
  });
});
