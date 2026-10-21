/**
 * The dex mod's id mapping on the fixture pack (no ROM): the fixture's original creatures become custom sim
 * entries, but a species or move of the ROM import (the `platinum` namespace) that maps to no sim id fails
 * when the battle data is built, instead of battling as a made-up entry.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Dex } from '@pkmn/sim';
import { readPackFolder, type Id } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { simData } from './dex.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const fixture = readPackFolder(read, 'packs/fixture');
const registries = loadGamePacks([fixture]).registries;
const f = (n: string) => `fixture:${n}` as Id;

/** The fixture's registries with one record copied under another id. */
function withRecord(kind: 'species' | 'moves', from: Id, id: Id): Registries {
  const map = new Map(registries[kind] as unknown as Map<Id, { id: Id }>);
  map.set(id, { ...map.get(from)!, id });
  return { ...registries, [kind]: map } as Registries;
}

describe('sim ids', () => {
  it('preserves inherited condition hooks in consecutive pack dexes', () => {
    const shields = [];
    for (let i = 0; i < 2; i++) {
      const data = simData(loadGamePacks([fixture]).registries, new CountingStubLog(() => {}));
      const b = data.createBattle('trainer', 'singles', { seed: 'sodium,00000000000000000000000000000000' });
      b.setPlayer('p1', { team: [{ species: 'Mosslet', moves: ['substitute'] }] } as never);
      b.setPlayer('p2', { team: [{ species: 'Mosslet', moves: ['splash'] }] } as never);
      const p = b.p1.active[0]!;
      p.hp = p.maxhp = p.baseMaxhp = 160;
      b.makeChoices('move 1', 'move 1');
      shields.push(p.volatiles['substitute']?.hp);
    }
    expect(shields).toEqual([40, 40]);
  });

  it('does not retain per-game dexes in the simulator global registry', () => {
    const before = Object.keys(Dex.dexes).sort();
    for (let i = 0; i < 4; i++) simData(loadGamePacks([fixture]).registries, new CountingStubLog(() => {}));
    expect(Object.keys(Dex.dexes).sort()).toEqual(before);
  });

  it('keeps two live pack dexes independent without global registration', () => {
    const before = Object.keys(Dex.dexes).sort();
    const left = loadGamePacks([fixture]).registries;
    const right = loadGamePacks([fixture]).registries;
    const move = left.moves.get(f('MOVE_LEAF_TAP'))!;
    const changedMoves = new Map(right.moves);
    changedMoves.set(move.id, { ...move, power: move.power + 40 });
    const dataA = simData(left, new CountingStubLog(() => {}));
    const dataB = simData({ ...right, moves: changedMoves }, new CountingStubLog(() => {}));
    const a = dataA.createBattle('wild', 'singles', { seed: 'sodium,00000000000000000000000000000000' });
    const b = dataB.createBattle('wild', 'singles', { seed: 'sodium,00000000000000000000000000000000' });
    expect(a.dex).not.toBe(b.dex);
    expect(a.dex.moves.get('leaftap').basePower).toBe(move.power);
    expect(b.dex.moves.get('leaftap').basePower).toBe(move.power + 40);
    expect(Object.keys(Dex.dexes).sort()).toEqual(before);
  });

  it('original creatures and moves become custom sim entries', () => {
    const data = simData(registries, new CountingStubLog(() => {}));
    expect(data.species(f('SPECIES_MOSSLET'))).toBe('mosslet');
    expect(data.move(f('MOVE_LEAF_TAP'))).toBe('leaftap');
  });

  it('an unknown ROM species or move fails', () => {
    expect(() => simData(withRecord('species', f('SPECIES_MOSSLET'), 'platinum:SPECIES_MOSSLET' as Id), new CountingStubLog(() => {}))).toThrow('the ROM species platinum:SPECIES_MOSSLET maps to no sim species');
    expect(() => simData(withRecord('moves', f('MOVE_LEAF_TAP'), 'platinum:MOVE_LEAF_TAP' as Id), new CountingStubLog(() => {}))).toThrow('the ROM move platinum:MOVE_LEAF_TAP maps to no sim move');
    // A ROM id the sim knows maps.
    expect(simData(withRecord('moves', f('MOVE_SURF'), 'platinum:MOVE_SURF' as Id), new CountingStubLog(() => {})).move('platinum:MOVE_SURF' as Id)).toBe('surf');
  });
});
