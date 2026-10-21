import { describe, expect, it } from 'vitest';
import type { Id } from './ids.ts';
import { isShiny, type Pokemon } from './pokemon.ts';
import { Prng } from './prng.ts';
import {
  addTrophyGardenMon, elapseHoneyTrees, elapsePokerus, HONEY_TREES, honeyTreeLevel, honeyTreeShake, honeyTreeSpecies, honeyTreeStatus, munchlaxTrees, newSpecialEncounters,
  radarPatchContinues, radarPatchShiny, radarRecordChain, radarRecordSlot, radarShinyRate, shinyPid, slatherHoneyTree, swarmDailyOf, swarmIndex, TREE_STATUS,
} from './special-encounters.ts';

/** A scripted stream: each roll returns the next value (checked against its bound). */
const rolls = (...values: number[]) => (n: number) => {
  const v = values.shift();
  if (v === undefined) throw new Error('out of rolls');
  if (v >= n) throw new Error(`roll ${v} not below ${n}`);
  return v;
};

describe('honey trees (honey_tree.c)', () => {
  it('reads the 6-hour window: 1081 minutes left is slathered, 1080 waits, 0 is bare', () => {
    const tree = { minutes: 1440, slot: 0, table: 0, group: 1, shakes: 2 };
    expect(honeyTreeStatus(tree)).toBe(TREE_STATUS.slathered);
    elapseHoneyTrees({ ...newSpecialEncounters(), honeyTrees: [tree] }, 359);
    expect([tree.minutes, honeyTreeStatus(tree), honeyTreeShake(tree)]).toEqual([1081, TREE_STATUS.slathered, null]);
    elapseHoneyTrees({ ...newSpecialEncounters(), honeyTrees: [tree] }, 1);
    expect([tree.minutes, honeyTreeStatus(tree), honeyTreeShake(tree)]).toEqual([1080, TREE_STATUS.encounter, 1]);
    elapseHoneyTrees({ ...newSpecialEncounters(), honeyTrees: [tree] }, 5000);
    expect([tree.minutes, honeyTreeStatus(tree)]).toEqual([0, TREE_STATUS.bare]);
  });

  it('finds the Munchlax trees from all 32 bits in one forward pass (duplicates can stay)', () => {
    expect(munchlaxTrees(0)).toEqual([0, 1, 2, 3]);
    // Bytes 1, 0, 0, 0: 0 equals 0 and moves to 1, which the pass does not compare with the first again.
    expect(munchlaxTrees(0x01000000)).toEqual([1, 0, 1, 2]);
    expect(munchlaxTrees(0x15002a00 >>> 0)).toEqual([0, 1, 2, 3]);
    expect(munchlaxTrees(0xffffffff)).toEqual([3, 4, 5, 6]);
  });

  it('slathers: a day of honey, the group by the odds, the slot, the table and the shakes', () => {
    const enc = newSpecialEncounters();
    // Group roll 30 on an ordinary tree: A (≥ 30); slot roll 39: slot 2; shakes roll 18 in A: two shakes.
    slatherHoneyTree(enc, 5, 0x01020304, rolls(30, 39, 18));
    expect(enc.honeyTrees[5]).toEqual({ minutes: 1440, slot: 2, table: 0, group: 1, shakes: 2 });
    expect(enc.lastHoneyTree).toBe(5);
    // The same tree again: 89 < 90 keeps group A (new slot 4 by roll 5, shakes 0 by roll 79).
    slatherHoneyTree(enc, 5, 0x01020304, rolls(89, 5, 79));
    expect(enc.honeyTrees[5]).toEqual({ minutes: 1440, slot: 4, table: 0, group: 1, shakes: 0 });
    // 90 rolls a fresh group: 9 is none on an ordinary tree: the timer clears at once.
    slatherHoneyTree(enc, 5, 0x01020304, rolls(90, 9, 50));
    expect(enc.honeyTrees[5]).toEqual({ minutes: 0, slot: 0, table: 0, group: 0, shakes: 0 });
    // Tree 0 is a Munchlax tree for id 0: roll 0 is group C, the Munchlax table.
    slatherHoneyTree(enc, 0, 0, rolls(0, 70, 7));
    expect(enc.honeyTrees[0]).toEqual({ minutes: 1440, slot: 0, table: 2, group: 3, shakes: 3 });
    expect(enc.lastHoneyTree).toBe(0);
  });

  it('keeps a retained none group with a running timer, as the DS does', () => {
    const enc = newSpecialEncounters();
    slatherHoneyTree(enc, 1, 0x01020304, rolls(5, 50));
    expect(enc.honeyTrees[1]!.group).toBe(0);
    slatherHoneyTree(enc, 1, 0x01020304, rolls(0, 70, 50));
    expect(enc.honeyTrees[1]).toMatchObject({ minutes: 1440, group: 0, table: 0 });
  });

  it('takes the species from the table and slot, and the level 5–15 (Hustle: 15 half the time)', () => {
    const tables = [['t:a', 't:b', 't:c', 't:d', 't:e', 't:f'], [], ['t:m', 't:m', 't:m', 't:m', 't:m', 't:m']] as Id[][];
    expect(honeyTreeSpecies(tables, { minutes: 1, slot: 3, table: 0, group: 1, shakes: 0 })).toBe('t:d');
    expect(honeyTreeLevel(null, rolls(0))).toBe(5);
    expect(honeyTreeLevel(null, rolls(10))).toBe(15);
    expect(honeyTreeLevel('HUSTLE', rolls(0, 1))).toBe(15);
    expect(honeyTreeLevel('PRESSURE', rolls(2, 0))).toBe(7);
    expect(HONEY_TREES).toBe(21);
  });
});

describe('the Poké Radar (pokeradar.c)', () => {
  it('continues by ring and result', () => {
    expect([0, 1, 2, 3].map((ring) => radarPatchContinues(ring, 'won', rolls(67)))).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map((ring) => radarPatchContinues(ring, 'won', rolls(88)))).toEqual([false, false, false, false]);
    expect([0, 1, 2, 3].map((ring) => radarPatchContinues(ring, 'caught', rolls(37)))).toEqual([true, true, true, true]);
  });

  it('rolls the shiny patch 1 in max(200, 8200 − 200·count), none at 0', () => {
    expect([0, 1, 10, 39, 40, 999].map(radarShinyRate)).toEqual([null, 8000, 6200, 400, 200, 200]);
    expect(radarPatchShiny(0, rolls())).toBe(false);
    expect(radarPatchShiny(40, rolls(0))).toBe(true);
    expect(radarPatchShiny(40, rolls(199))).toBe(false);
  });

  it('keeps the three best chains', () => {
    const records = newSpecialEncounters().radarRecords;
    expect(radarRecordSlot(records)).toBe(0);
    let slot = radarRecordChain(records, 0, 'x' as Id, 1);
    for (let n = 2; n <= 5; n++) slot = radarRecordChain(records, slot, 'x' as Id, n);
    expect(records[0]).toEqual({ species: 'x', count: 5 });
    expect(radarRecordSlot(records)).toBe(1);
    slot = radarRecordChain(records, 1, 'y' as Id, 7);
    // Sorted: y's 7 first, the chain's slot follows it.
    expect(records.map((r) => r.count)).toEqual([7, 5, 0]);
    expect(slot).toBe(0);
    radarRecordChain(records, 2, 'z' as Id, 3);
    expect(radarRecordSlot(records)).toBe(2);
    expect(records.map((r) => r.species)).toEqual(['y', 'x', 'z']);
  });
});

describe('swarms, the Trophy Garden, Pokérus', () => {
  it('takes the swarm from the daily value modulo 22, a new game from its own stream', () => {
    expect(swarmIndex(0)).toBe(0);
    expect(swarmIndex(0xffffffff)).toBe(0xffffffff % 22);
    const a = swarmDailyOf({ seed: 1, gameTime: {} });
    expect(swarmDailyOf({ seed: 1, gameTime: {} })).toBe(a);
    expect(swarmDailyOf({ seed: 1, gameTime: { swarmDaily: 7 } })).toBe(7);
  });

  it('adds a garden species unlike the two there and shifts slot 1 to slot 2', () => {
    const enc = newSpecialEncounters();
    const species = ['t:a', 't:b', 't:a', 't:c'] as Id[];
    addTrophyGardenMon(enc, species, rolls(1));
    expect(enc.trophyGarden).toEqual([1, null]);
    // Slot 1 holds b: a roll of 1 (b again) is drawn again; 2 (a) is unlike it.
    addTrophyGardenMon(enc, species, rolls(1, 2));
    expect(enc.trophyGarden).toEqual([2, 1]);
    addTrophyGardenMon(enc, species, rolls(0, 1, 3));
    expect(enc.trophyGarden).toEqual([3, 2]);
  });

  it('counts Pokérus down by the days passed; more than four days, or than are left, cure it', () => {
    const party = [0x13, 0x13, 0x13, 0x10, 0].map((pokerus) => ({ pokerus }) as Pokemon);
    elapsePokerus(party.slice(0, 1), 1);
    elapsePokerus(party.slice(1, 2), 4);
    elapsePokerus(party.slice(2, 3), 5);
    elapsePokerus(party.slice(3), 9);
    expect(party.map((m) => m.pokerus)).toEqual([0x12, 0x10, 0x10, 0x10, 0]);
    const strain0 = [{ pokerus: 0x02 } as Pokemon];
    elapsePokerus(strain0, 2);
    // Strain 0 at 0 days left is stored as 0x10 (cured).
    expect(strain0[0]!.pokerus).toBe(0x10);
  });

  it('makes a PID shiny with the OT id', () => {
    const rng = new Prng(5);
    for (const otId of [0, 0x12345678, 0xffffffff, 0xabcd0001]) expect(isShiny(otId, shinyPid(otId, rng))).toBe(true);
  });
});
