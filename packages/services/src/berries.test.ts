/** The berry patch rules (decomp berry_patches.c) on original tables: stages, moisture, yield, mulch, replants. */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { BerryPatch, BerryTables } from '@opensinnoh/contracts';
import { elapseBerryMinutes, emptyBerryPatch, harvestBerryPatch, mulchBerryPatch, newBerryPatches, patchMoisture, plantBerry, waterBerryPatch } from './berries.ts';

const id = (s: string) => `test:${s}` as Id;
const sprites = { growing: id('G'), blooming: id('B'), fruit: id('F') };
/** Two original berries: 2-hour stages draining 10 an hour, base yield 3; 1-hour stages draining 30, base yield 1. */
const tables: BerryTables = {
  berries: [
    { item: id('ITEM_SLOW_BERRY'), stageHours: 2, drain: 10, baseYield: 3, sprites, flavors: [10, 0, 0, 10, 0], smoothness: 25 },
    { item: id('ITEM_FAST_BERRY'), stageHours: 1, drain: 30, baseYield: 1, sprites, flavors: [0, 10, 10, 0, 0], smoothness: 25 },
  ],
  patches: [{ item: id('ITEM_SLOW_BERRY'), yield: 4 }],
  mulches: [id('ITEM_GROWTH'), id('ITEM_DAMP'), id('ITEM_STABLE'), id('ITEM_GOOEY')],
  soil: id('SOIL'),
  sprout: id('SPROUT'),
  moisture: [id('VERY_DRY'), id('DRY'), id('MOIST')],
  sprayduck: { male: id('M'), female: id('F') },
};
const planted = (berry: string, mulch?: string): BerryPatch => {
  const p = emptyBerryPatch();
  if (mulch) mulchBerryPatch(tables, p, id(mulch));
  plantBerry(tables, p, id(berry));
  return p;
};
const elapse = (p: BerryPatch, minutes: number) => elapseBerryMinutes(tables, [p], minutes);

describe('berry patches (decomp berry_patches.c)', () => {
  it('a new game: each listed patch in fruit with 4 stages left, rating 3, not growing until seen', () => {
    const [p] = newBerryPatches(tables);
    expect(p).toEqual({ ...emptyBerryPatch(), berry: id('ITEM_SLOW_BERRY'), stage: 'fruit', stageMinutes: 4 * 120, yield: 4, moisture: 100, yieldRating: 3 });
    elapseBerryMinutes(tables, [p!], 10_000);
    expect(p!.stage).toBe('fruit');
  });

  it('grows a stage per stage length, at the exact minute', () => {
    const p = planted('ITEM_SLOW_BERRY');
    expect(p).toMatchObject({ stage: 'planted', stageMinutes: 120, moisture: 100, yieldRating: 5, growing: true });
    elapse(p, 119);
    expect(p.stage).toBe('planted');
    elapse(p, 1);
    expect(p).toMatchObject({ stage: 'sprouted', stageMinutes: 120 });
    elapse(p, 240);
    expect(p.stage).toBe('blooming');
    // 6 hours unwatered drained the soil to 40: no rating lost.
    expect(p).toMatchObject({ moisture: 40, yieldRating: 5 });
    elapse(p, 120);
    // The bloom's two hours drain 20 more before the fruit (which keeps its soil). Yield 3 × 5.
    expect(p).toMatchObject({ stage: 'fruit', yield: 15, moisture: 20, stageMinutes: 4 * 120 });
  });

  it('one long gap equals many small steps', () => {
    const a = planted('ITEM_FAST_BERRY');
    const b = planted('ITEM_FAST_BERRY');
    elapse(a, 307);
    for (let i = 0; i < 307; i++) elapse(b, 1);
    expect(b).toEqual(a);
  });

  it('dry hours cost a yield point each, counted in whole hours with the minutes carried', () => {
    const p = planted('ITEM_SLOW_BERRY');
    p.moisture = 10;
    // 90 minutes: one whole hour drains the last 10; 30 minutes carry over.
    elapse(p, 90);
    expect(p).toMatchObject({ moisture: 0, moistureMinutes: 30, yieldRating: 5 });
    // 30 + 150 minutes: three dry hours.
    elapse(p, 150);
    expect(p).toMatchObject({ stage: 'growing', moisture: 0, moistureMinutes: 0, yieldRating: 2 });
  });

  it('watering refills the soil; moisture reads very dry, dry, moist', () => {
    const p = planted('ITEM_FAST_BERRY');
    expect(patchMoisture(p)).toBe(2);
    elapse(p, 120);
    expect(p.moisture).toBe(40);
    expect(patchMoisture(p)).toBe(1);
    elapse(p, 60);
    expect(p.moisture).toBe(10);
    p.moisture = 0;
    expect(patchMoisture(p)).toBe(0);
    waterBerryPatch(p);
    expect(p.moisture).toBe(100);
  });

  it('a dry spell before bloom lowers the yield (rating floor 0, yield floor 2)', () => {
    const p = planted('ITEM_SLOW_BERRY');
    // Drain is 10 an hour: dry after 10 hours; the stages take 8 hours to fruit, so drain it first.
    p.moisture = 0;
    elapse(p, 8 * 60);
    expect(p).toMatchObject({ stage: 'fruit', yieldRating: 0, yield: 2 });
  });

  it('harvest gives the yield and clears the patch, mulch too', () => {
    const p = planted('ITEM_FAST_BERRY', 'ITEM_STABLE');
    elapse(p, 4 * 60);
    expect(harvestBerryPatch(p)).toEqual({ berry: id('ITEM_FAST_BERRY'), count: 5 });
    expect(p).toEqual(emptyBerryPatch());
    expect(() => harvestBerryPatch(p)).toThrow(/harvesting a none plant/);
  });

  it('mulch: Growth shortens the stages (×3/4) and drains faster; Damp lengthens them and drains slower; Stable keeps the fruit longer', () => {
    expect(planted('ITEM_SLOW_BERRY', 'ITEM_GROWTH').stageMinutes).toBe(90);
    expect(planted('ITEM_SLOW_BERRY', 'ITEM_DAMP').stageMinutes).toBe(180);
    const g = planted('ITEM_SLOW_BERRY', 'ITEM_GROWTH');
    elapse(g, 60);
    expect(g.moisture).toBe(85);
    const d = planted('ITEM_SLOW_BERRY', 'ITEM_DAMP');
    elapse(d, 60);
    expect(d.moisture).toBe(95);
    const s = planted('ITEM_FAST_BERRY', 'ITEM_STABLE');
    elapse(s, 4 * 60);
    expect(s).toMatchObject({ stage: 'fruit', stageMinutes: 6 * 60 });
    expect(() => mulchBerryPatch(tables, s, id('ITEM_FAST_BERRY'))).toThrow(/not a mulch/);
  });

  it('fruit left on the plant falls: back to sprouted, rating 5, until the replants run out (10, Gooey 15)', () => {
    const p = planted('ITEM_FAST_BERRY');
    elapse(p, 4 * 60 + 4 * 60);
    expect(p).toMatchObject({ stage: 'sprouted', yield: 0, replants: 1, yieldRating: 5 });
    // Each cycle: sprouted, growing, blooming, then 4 fruit hours = 7 hours.
    elapse(p, 9 * 7 * 60 - 1);
    expect(p.replants).toBe(9);
    expect(p.stage).toBe('fruit');
    elapse(p, 1);
    expect(p).toEqual(emptyBerryPatch());
    const g = planted('ITEM_FAST_BERRY', 'ITEM_GOOEY');
    elapse(g, 8 * 60 + 13 * 7 * 60);
    expect(g).toMatchObject({ stage: 'sprouted', replants: 14 });
  });

  it('a gap past the whole life clears the patch at once', () => {
    const p = planted('ITEM_FAST_BERRY');
    // Life: one stage × (1 + (3 + 4) × 10) = 71 hours.
    elapse(p, 71 * 60);
    expect(p).toEqual(emptyBerryPatch());
    const q = planted('ITEM_FAST_BERRY');
    elapse(q, 71 * 60 - 1);
    expect(q.stage).toBe('fruit');
  });

  it('planting over a plant, odd minutes and unknown berries fail loudly', () => {
    const p = planted('ITEM_FAST_BERRY');
    expect(() => plantBerry(tables, p, id('ITEM_FAST_BERRY'))).toThrow(/over a planted plant/);
    expect(() => elapse(p, -1)).toThrow(/-1 minutes/);
    expect(() => plantBerry(tables, emptyBerryPatch(), id('ITEM_NOPE'))).toThrow(/not a berry/);
  });
});
