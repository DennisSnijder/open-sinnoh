/**
 * Form round trips on the real ROM (OPENSINNOH_NDS_ROM): a Pokémon put in a
 * form by the game's own rules (services forms.ts: Rotom's appliances, the Griseous Orb, the Gracidea), saved, loaded
 * into a new game and sent into battle: the form, its moves, its ability and its stats are the stored ones, and the
 * battle uses the sim forme with exactly those.
 */
import { describe, expect, it } from 'vitest';
import type { Id, Pokemon } from '@opensinnoh/core';
import { dexOf, setupPokemon } from '@opensinnoh/contracts';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog } from '@opensinnoh/game';
import { setGiratinaFormByItem, setRotomForm, setShayminForm, SHAYMIN_SKY } from '@opensinnoh/services';
import { ROM } from '../rom.ts';
import { storyGame } from './checkpoints-anchors.ts';

const P = (s: string) => `platinum:${s}` as Id;
/** What this test reads of the battle's sim (the controller keeps it private). */
interface SimView {
  p1: { active: { species: { name: string }; ability: string; moveSlots: { id: string }[]; storedStats: Record<string, number> }[] };
}

describe.skipIf(!ROM)('form round trips: save → load → battle (OPENSINNOH_NDS_ROM)', () => {
  const cases: [string, (mon: Pokemon, reg: Parameters<typeof setRotomForm>[0]) => void, string, string][] = [
    ['ROTOM', (m, reg) => setRotomForm(reg, m, 1, 0), 'Rotom-Heat', 'overheat'],
    ['ROTOM', (m, reg) => setRotomForm(reg, m, 2, 0), 'Rotom-Wash', 'hydropump'],
    ['ROTOM', (m, reg) => setRotomForm(reg, m, 3, 0), 'Rotom-Frost', 'blizzard'],
    ['ROTOM', (m, reg) => setRotomForm(reg, m, 4, 0), 'Rotom-Fan', 'airslash'],
    ['ROTOM', (m, reg) => setRotomForm(reg, m, 5, 0), 'Rotom-Mow', 'leafstorm'],
    ['GIRATINA', (m, reg) => ((m.heldItem = P('ITEM_GRISEOUS_ORB')), setGiratinaFormByItem(reg, m)), 'Giratina-Origin', 'shadowforce'],
    ['SHAYMIN', (m, reg) => setShayminForm(reg, m, SHAYMIN_SKY), 'Shaymin-Sky', 'seedflare'],
  ];
  for (const [species, change, forme, move] of cases)
    it(`${forme}: the stored form survives a save and battles as ${forme}`, async () => {
      const game = storyGame(1);
      const reg = game.registries;
      const moves = species === 'ROTOM' ? ['MOVE_THUNDER_SHOCK', 'MOVE_DOUBLE_TEAM'] : species === 'GIRATINA' ? ['MOVE_SHADOW_FORCE'] : ['MOVE_SEED_FLARE'];
      const mon = setupPokemon(game.state, reg, 0, P(`SPECIES_${species}`), 50, moves.map(P));
      change(mon, reg);
      const stored = structuredClone(mon);
      game.state.party = [mon];
      // The save as written (the new game's opening is still running, so the envelope is made here, as `save()` writes it).
      const json = JSON.parse(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state: game.state }));
      const next = storyGame(2);
      next.load(json);
      const loaded = next.state.party[0]!;
      expect({ form: loaded.form, moves: loaded.moves, ability: loaded.ability, stats: loaded.stats, heldItem: loaded.heldItem }).toEqual({ form: stored.form, moves: stored.moves, ability: stored.ability, stats: stored.stats, heldItem: stored.heldItem });
      expect(loaded.form).toBeGreaterThan(0);
      const b = createBattle(
        { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_BIDOOF'), level: 5 }], background: null, terrain: null, time: 'day' },
        { registries: reg, party: [loaded], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 1, textSpeed: 1, log: new CountingStubLog(() => {}) },
      ) as ReturnType<typeof createBattle> & { sim: SimView };
      const sim = b.sim.p1.active[0]!;
      const ability = loaded.ability!.replace('platinum:ABILITY_', '').toLowerCase().replace(/[^a-z]/g, '');
      expect([sim.species.name, sim.ability]).toEqual([forme, ability]);
      expect(sim.moveSlots.map((m) => m.id)).toContain(move);
      expect(sim.storedStats).toEqual({ atk: loaded.stats.attack, def: loaded.stats.defense, spa: loaded.stats.spAttack, spd: loaded.stats.spDefense, spe: loaded.stats.speed });
      expect(dexOf(reg).form(loaded.species, loaded.form)).not.toBe(dexOf(reg).species(loaded.species));
    });
});
