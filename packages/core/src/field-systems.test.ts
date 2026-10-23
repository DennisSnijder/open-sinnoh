import { describe, expect, it } from 'vitest';
import { dailyRandomOf, FIELD_VARS, fieldSeed, hasFieldSystems, isFeebasTile, newDailyRandom, SEEKER_USED, updateVillaVisitor, type FieldSystemRegistries } from './field-systems.ts';
import type { Id } from './ids.ts';
import { Prng } from './prng.ts';

const id = (n: string) => n as Id;
function registries(base: string, parts: { vars?: boolean; flag?: boolean; item?: boolean }): FieldSystemRegistries {
  const vars = parts.vars ? Object.values(FIELD_VARS).map((n) => ({ id: id(`${base}:V${n}`), sourceIndex: n, initial: 0 })) : [];
  const flags = parts.flag ? [{ id: id(`${base}:F`), sourceIndex: SEEKER_USED, initial: false }] : [];
  const items = parts.item ? [{ id: id(`${base}:SEEKER`), fieldUse: 15 }] : [];
  return {
    vars: new Map(vars.map((v) => [v.id, v])),
    flags: new Map(flags.map((f) => [f.id, f])),
    items: new Map(items.map((i) => [i.id, i])),
    zones: new Map(),
    matrices: new Map(),
    trainers: new Map(),
    newGame: new Map([[id(`${base}:NEW_GAME`), { id: id(`${base}:NEW_GAME`) }]]),
  };
}

describe('field systems', () => {
  it('a base pack carries every part; only the original fixture pack may carry none', () => {
    expect(hasFieldSystems(registries('platinum', { vars: true, flag: true, item: true }))).toBe(true);
    expect(hasFieldSystems(registries('fixture', {}))).toBe(false);
    expect(() => hasFieldSystems(registries('platinum', {}))).toThrow(/lacks/);
    expect(() => hasFieldSystems(registries('fixture', { vars: true, flag: true }))).toThrow(/lacks/);
  });

  it('the daily random is ARNG of a new game draw; an older save derives it from its seed', () => {
    expect(newDailyRandom(0)).toBe(1);
    expect(newDailyRandom(1)).toBe((1812433253 + 1) >>> 0);
    const derived = newDailyRandom(new Prng(fieldSeed(7)).next());
    expect(dailyRandomOf({ seed: 7, gameTime: {} })).toBe(derived);
    expect(dailyRandomOf({ seed: 7, gameTime: { dailyRandom: 5 } })).toBe(5);
  });

  it('Feebas tiles: one per quarter of the list by the daily random bytes, excess tiles spread over the first quarters', () => {
    const tiles = Array.from({ length: 10 }, (_, i) => 100 + i); // quarters of 2, excess 2
    // Bytes 1, 0, 1, 0: quarter 0 → index 1; quarter 1 → 2+0+1 = 3; quarter 2 → 4+1+2 = 7; quarter 3 → 6+0+2 = 8.
    const random = 0x01000100;
    const hits = tiles.filter((t) => isFeebasTile(tiles, random, t));
    expect(hits).toEqual([101, 103, 107, 108]);
    expect(() => isFeebasTile([1, 2, 3], random, 1)).toThrow(/four groups/);
  });
});

describe('the Villa visitor (SystemVars_UpdateVillaVisitor)', () => {
  const furniture = Array.from({ length: 20 }, (_, i) => id(`t:F${i}`));
  const reg: FieldSystemRegistries = {
    ...registries('platinum', { vars: true, flag: true, item: true }),
    flags: new Map([...furniture, id('t:IN'), id('t:OUT')].map((f) => [f, { id: f, initial: false }])),
    vars: new Map([id('t:VISITOR'), id('t:MESSAGE')].map((v) => [v, { id: v, initial: 0 }])),
  };
  const villa = (away: boolean) => ({ furniture, chances: [25, 75, 90], counts: [4, 12, 15], visitorVar: id('t:VISITOR'), messageVar: id('t:MESSAGE'), insideFlag: id('t:IN'), outsideFlag: id('t:OUT'), away });
  const roll = (owned: number, seed: number) => {
    const s = { seed: 0, vars: {} as Record<Id, number>, flags: Object.fromEntries([...furniture.slice(0, owned), id('t:IN'), id('t:OUT')].map((f) => [f, true])) as Record<Id, boolean>, gameTime: {} };
    const rng = new Prng(seed);
    updateVillaVisitor(reg, s, villa(true), () => rng.next());
    return s;
  };

  it('clears both visitor flags and rolls a visitor and a message; nothing at the Resort Area or the Villa', () => {
    const s = roll(3, 5);
    expect(s.flags[id('t:IN')]).toBeUndefined();
    expect(s.flags[id('t:OUT')]).toBeUndefined();
    expect(s.vars[id('t:MESSAGE')] ?? 0).toBeLessThan(5);
    const kept = { seed: 0, vars: {}, flags: { [id('t:IN')]: true }, gameTime: {} };
    updateVillaVisitor(reg, kept, villa(false), () => 0);
    expect(kept).toEqual({ seed: 0, vars: {}, flags: { [id('t:IN')]: true }, gameTime: {} });
  });

  it('visits 26, 76 and 91 % of days by owned-piece band, among the first 4, 12 and 15 visitors', () => {
    for (const [owned, odds, count] of [[3, 0.26, 4], [9, 0.76, 12], [15, 0.91, 15]] as const) {
      const seen = new Set<number>();
      let visits = 0;
      const runs = 4000;
      for (let seed = 1; seed <= runs; seed++) {
        const v = roll(owned, seed).vars[id('t:VISITOR')] ?? 0;
        if (v === 0xff) continue;
        visits++;
        seen.add(v);
      }
      expect(Math.abs(visits / runs - odds)).toBeLessThan(0.03);
      expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });
});
