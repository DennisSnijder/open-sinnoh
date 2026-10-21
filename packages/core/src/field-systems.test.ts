import { describe, expect, it } from 'vitest';
import { dailyRandomOf, FIELD_VARS, fieldSeed, hasFieldSystems, isFeebasTile, newDailyRandom, SEEKER_USED, type FieldSystemRegistries } from './field-systems.ts';
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
