/** The form rules (forms.ts) on the fixture pack, with original stand-ins for the decomp records they find by constant. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackFolder, type Id } from '@opensinnoh/core';
import { giveItem, setupPokemon, type GameState, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { boxHeldItemChanged, giveHeldItem, revertForm, setShayminForm, takeHeldItem, takeItemFrom } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loadedPacks = loadGamePacks([pack]);
const registries = (() => {
  const out = Object.fromEntries(Object.entries(loadedPacks.registries).map(([k, m]) => [k, m instanceof Map ? new Map(m) : m])) as Record<string, Map<Id, unknown>>;
  const base = out.species!.get('fixture:SPECIES_MOSSLET' as Id) as object;
  const form = (n: number, attack: number) => ({ ...base, form: n, baseStats: { hp: 150, attack, defense: 100, speed: 90, spAttack: 100, spDefense: 100 }, abilities: ['fixture:ABILITY_BURROW', null] });
  out.species!.set('test:SPECIES_GIRATINA' as Id, { ...base, id: 'test:SPECIES_GIRATINA', sourceIndex: 487, forms: [form(1, 120)] });
  out.species!.set('test:SPECIES_SHAYMIN' as Id, { ...base, id: 'test:SPECIES_SHAYMIN', sourceIndex: 492, forms: [form(1, 103)] });
  out.species!.set('test:SPECIES_ARCEUS' as Id, { ...base, id: 'test:SPECIES_ARCEUS', sourceIndex: 493, abilities: ['test:ABILITY_MULTITYPE', null] });
  out.abilities!.set('test:ABILITY_MULTITYPE' as Id, { id: 'test:ABILITY_MULTITYPE', sourceIndex: 121, name: 'MULTITYPE' });
  const tonic = out.items!.get('fixture:ITEM_TONIC' as Id) as object;
  out.items!.set('test:ITEM_GRISEOUS_ORB' as Id, { ...tonic, id: 'test:ITEM_GRISEOUS_ORB', sourceIndex: 112, holdEffect: 'GRISEOUS_ORB' });
  out.items!.set('test:ITEM_FLAME_PLATE' as Id, { ...tonic, id: 'test:ITEM_FLAME_PLATE', sourceIndex: 298, holdEffect: 'ARCEUS_FIRE' });
  return out as unknown as Registries;
})();
const record = [...registries.newGame.values()][0]!;
const fresh = (): GameState => {
  const s = newGameState(record, registries, loadedPacks.loaded.order, 1);
  for (const item of ['test:ITEM_GRISEOUS_ORB', 'test:ITEM_FLAME_PLATE', 'fixture:ITEM_TONIC']) giveItem(s, registries, item as Id, 2);
  return s;
};
const mon = (s: GameState, species: string) => {
  const m = setupPokemon(s, registries, s.party.length, species as Id, 50);
  s.party.push(m);
  return m;
};

describe('the Griseous Orb (decomp party menu give/take, BoxPokemon_SetGiratinaForm)', () => {
  it('giving it makes Giratina Origin (ability and stats too) and reports the change; taking it back reverts', () => {
    const s = fresh();
    const g = mon(s, 'test:SPECIES_GIRATINA');
    const altered = { ...g.stats };
    expect(giveHeldItem(s, registries, 0, 'test:ITEM_GRISEOUS_ORB' as Id)).toEqual({ previous: null, formChanged: true });
    expect([g.form, g.ability]).toEqual([1, 'fixture:ABILITY_BURROW']);
    expect(g.stats.attack).toBeGreaterThan(altered.attack);
    expect(takeHeldItem(s, registries, g)).toEqual({ item: 'test:ITEM_GRISEOUS_ORB', formChanged: true });
    expect([g.form, g.stats]).toEqual([0, altered]);
  });

  it('swapping the orb for another item reverts; another species is untouched and reports nothing', () => {
    const s = fresh();
    const g = mon(s, 'test:SPECIES_GIRATINA');
    giveHeldItem(s, registries, 0, 'test:ITEM_GRISEOUS_ORB' as Id);
    expect(giveHeldItem(s, registries, 0, 'fixture:ITEM_TONIC' as Id)).toEqual({ previous: 'test:ITEM_GRISEOUS_ORB', formChanged: true });
    expect(g.form).toBe(0);
    const other = mon(s, 'fixture:SPECIES_EMBERKIT');
    expect(giveHeldItem(s, registries, 1, 'test:ITEM_GRISEOUS_ORB' as Id)).toEqual({ previous: null, formChanged: false });
    expect(other.form).toBe(0);
  });

  it('in the Distortion World a give or take leaves the form (decomp MAP_HEADER_DISTORTION_WORLD_*); a swap still follows the item', () => {
    const s = fresh();
    s.player.zone = 'fixture:MAP_HEADER_DISTORTION_WORLD_1F' as Id;
    const g = mon(s, 'test:SPECIES_GIRATINA');
    expect(giveHeldItem(s, registries, 0, 'test:ITEM_GRISEOUS_ORB' as Id)).toEqual({ previous: null, formChanged: false });
    expect(g.form).toBe(0);
    expect(giveHeldItem(s, registries, 0, 'test:ITEM_GRISEOUS_ORB' as Id)).toEqual({ previous: 'test:ITEM_GRISEOUS_ORB', formChanged: true });
    expect(g.form).toBe(1);
    expect(takeHeldItem(s, registries, g)).toEqual({ item: 'test:ITEM_GRISEOUS_ORB', formChanged: false });
    expect(g.form).toBe(1);
  });

  it('the PC’s MOVE ITEMS: taking the orb from a boxed Origin Giratina reverts it', () => {
    const s = fresh();
    const g = mon(s, 'test:SPECIES_GIRATINA');
    g.heldItem = 'test:ITEM_GRISEOUS_ORB' as Id;
    boxHeldItemChanged(registries, g);
    expect(g.form).toBe(1);
    expect(takeItemFrom(s, registries, { area: 'party', slot: 0 })).toBe('test:ITEM_GRISEOUS_ORB');
    expect(g.form).toBe(0);
  });
});

describe('Arceus, Shaymin and the Day Care revert', () => {
  it('Arceus with Multitype takes its plate’s type as its form (decomp Pokemon_GetArceusTypeOf), Normal without one', () => {
    const s = fresh();
    const a = mon(s, 'test:SPECIES_ARCEUS');
    giveHeldItem(s, registries, 0, 'test:ITEM_FLAME_PLATE' as Id);
    expect(a.form).toBe(10);
    takeHeldItem(s, registries, a);
    expect(a.form).toBe(0);
  });

  it('revertForm: Shaymin and Giratina (no orb) go back to form 0 with their stats', () => {
    const s = fresh();
    const sh = mon(s, 'test:SPECIES_SHAYMIN');
    const land = { ...sh.stats };
    setShayminForm(registries, sh, 1);
    expect(sh.stats).not.toEqual(land);
    revertForm(registries, sh);
    expect([sh.form, sh.stats]).toEqual([0, land]);
    const g = mon(s, 'test:SPECIES_GIRATINA');
    g.form = 1;
    revertForm(registries, g);
    expect(g.form).toBe(0);
  });
});
