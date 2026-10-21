import { describe, expect, it } from 'vitest';
import type { EncounterTable, InputFrame, Registries } from '@opensinnoh/contracts';
import { FishingTask, fishingRoll } from './fishing.ts';
import { f, newState, registries, setup } from './testing.ts';

const input = (a = false): InputFrame => ({ held: a ? ['a'] : [], pressed: a ? ['a'] : [], touch: null });
const slots = Array.from({ length: 5 }, (_, i) => ({ species: f(`ORIGINAL_FISH_${i}`), minLevel: 11 + i, maxLevel: 13 + i }));
const table: EncounterTable = { id: f('POND'), landRate: 0, land: [], surfRate: 0, surf: [], variants: {}, oldRod: { rate: 100, slots }, goodRod: { rate: 100, slots }, superRod: { rate: 100, slots } };

for (const rod of [0, 1, 2] as const) describe(`fishing rod ${rod}`, () => {
  it('uses that rod’s encounter table and level range; a zero rate consumes no RNG', () => {
    const t = structuredClone(table);
    const rodTable = [t.oldRod, t.goodRod, t.superRod][rod]!;
    rodTable.slots = slots.map((s) => ({ ...s, species: f(`ROD_${rod}`) }));
    for (let seed = 1; seed <= 50; seed++) {
      const { roll } = fishingRoll(t, rod, { seed });
      expect(roll!.species).toBe(f(`ROD_${rod}`));
      expect(roll!.level).toBeGreaterThanOrEqual(11);
      expect(roll!.level).toBeLessThanOrEqual(17);
    }
    rodTable.rate = 0;
    expect(fishingRoll(t, rod, { seed: 8 })).toEqual({ roll: null, random: { seed: 8 } });
  });
  it('casts for 34 ticks, waits 30–120, allows the last hook tick, then reels, prints by text id and closes', () => {
    const notices: string[] = [];
    const fish = { species: f('ORIGINAL_FISH'), level: 12 };
    const task = new FishingTask(rod, fish, () => 0, (n) => notices.push(n), () => { throw new Error('not away'); });
    for (let i = 0; i < 34; i++) task.step(input(), false);
    expect(task.phase).toBe('cast');
    task.step(input(), false);
    expect(task.phase).toBe('wait');
    for (let i = 0; i < 29; i++) task.step(input(), false);
    expect(task.phase).toBe('bite');
    for (let i = 0; i < [43, 28, 13][rod]!; i++) task.step(input(), false);
    task.step(input(true), false);
    expect(task.phase).toBe('reel');
    for (let i = 0; i < 16; i++) task.step(input(), false);
    expect(notices).toEqual(['CommonStrings_Text_LandedAPokemon']);
    task.step(input(), true);
    expect(task.phase).toBe('message');
    for (let i = 0; i < 5; i++) task.step(input(), false);
    expect(task.result()).toEqual(fish);
    expect(task.phase).toBe('done');
  });
  it('distinguishes an early reel, an expired hook window and no nibble', () => {
    for (const kind of ['early', 'late', 'empty'] as const) {
      const notices: string[] = [];
      let away = 0;
      const task = new FishingTask(rod, kind === 'empty' ? null : { species: f('ORIGINAL_FISH'), level: 5 }, () => 0, (n) => notices.push(n), () => away++);
      for (let i = 0; i < 35; i++) task.step(input(), false);
      if (kind === 'early') task.step(input(true), false);
      else for (let i = 0; i < 140 && !notices.length; i++) task.step(input(), false);
      expect(notices).toEqual([`CommonStrings_Text_${kind === 'early' ? 'ReeledItInTooQuickly' : kind === 'late' ? 'ThePokemonGotAway' : 'NotEvenANibble'}`]);
      expect(task.result()).toBeNull();
      // FishingTask_FishGotAway alone counts RECORD_FISH_GOT_AWAY and saves its TV segment.
      expect(away).toBe(kind === 'late' ? 1 : 0);
    }
  });
});

describe('fishing rolls', () => {
  it('swaps an inverted level range, as GetWildMonLevel does', () => {
    const t = structuredClone(table);
    t.oldRod.slots = slots.map((s) => ({ ...s, minLevel: 30, maxLevel: 20 }));
    const levels = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) levels.add(fishingRoll(t, 0, { seed }).roll!.level);
    expect(Math.min(...levels)).toBe(20);
    expect(Math.max(...levels)).toBe(30);
  });
  it('a Feebas zone passes a 50% gate, then the facing tile check; a hit fills every slot with Feebas at 10–20', () => {
    const feebas = { species: f('ORIGINAL_FEEBAS'), facing: () => true };
    const species = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const { roll } = fishingRoll(table, 2, { seed }, feebas);
      species.add(roll!.species);
      if (roll!.species === feebas.species) expect(roll!.level).toBeGreaterThanOrEqual(10);
      if (roll!.species === feebas.species) expect(roll!.level).toBeLessThanOrEqual(20);
    }
    expect(species.has(feebas.species) && species.size > 1).toBe(true);
    for (let seed = 1; seed <= 50; seed++) expect(fishingRoll(table, 2, { seed }, { ...feebas, facing: () => false }).roll!.species).not.toBe(feebas.species);
  });
});

describe('rod field checks', () => {
  it('requires surfable water ahead; rejects elevated bridges and semantic no-fishing zones', () => {
    const reg = structuredClone(registries) as Registries;
    const water = [...reg.tileBehaviors.values()].find((b) => b.name === 'WATER_RIVER');
    // Original fixture behavior added if its tiny room does not need water.
    const n = water?.sourceIndex ?? 201;
    (reg.tileBehaviors as Map<string, unknown>).set(f('ORIGINAL_WATER'), { id: f('ORIGINAL_WATER'), sourceIndex: n, name: 'WATER_RIVER', flags: [] });
    const zone = reg.zones.get(f('ROOM'))!;
    const matrix = reg.matrices.get(zone.matrix)!;
    const chunk = reg.chunks.get(matrix.chunks[0]!)!;
    const g = setup(newState('ROOM', 14, 16, 'up'), { regs: reg });
    expect(g.world.fishingCheck()).toBe('generic');
    chunk.tiles[14 + 15 * 32] = n;
    expect(g.world.fishingCheck()).toBeNull();
    zone.noFishing = true;
    expect(g.world.fishingCheck()).toBe('fish');
    const bridgeReg = structuredClone(reg);
    bridgeReg.zones.get(f('ROOM'))!.noFishing = false;
    (bridgeReg.tileBehaviors as Map<string, unknown>).set(f('ORIGINAL_BRIDGE'), { id: f('ORIGINAL_BRIDGE'), sourceIndex: 202, name: 'BRIDGE', flags: [] });
    bridgeReg.chunks.get(matrix.chunks[0]!)!.tiles[14 + 16 * 32] = 202;
    const elevated = setup(newState('ROOM', 14, 16, 'up'), { regs: bridgeReg });
    expect(elevated.world.fishingCheck()).toBe('generic');
  });
});
