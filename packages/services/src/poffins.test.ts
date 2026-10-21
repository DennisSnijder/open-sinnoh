/** Poffins (decomp poffin.c, poffin_case/main.c, ov83_0223F7F4.c) and the Fashion Case (unk_020298BC.c) on original data. */
import { describe, expect, it } from 'vitest';
import { Prng, zeroCondition, type Dex, type NatureData, type Pokemon } from '@opensinnoh/core';
import { newFashionCase, POFFIN_TYPE, type Poffin } from '@opensinnoh/contracts';
import { arcLength, feedPoffin, makePoffin, PoffinCook, poffinLevel, poffinPreference, POT_CENTER, wontEat } from './poffins.ts';
import { accessoryCount, addAccessory, addBackdrop, canFitAccessory, removeAccessory, totalAccessories } from './fashion.ts';

const rng = () => new Prng(7);
/** A nature that raises Sp. Atk (likes dry) and lowers Speed (dislikes sweet). */
const modest: NatureData = { up: 'spAttack', down: 'speed' };
const dex = (nature: NatureData) => ({ nature: () => nature }) as unknown as Dex;
const mon = (): Pokemon => ({ pid: 0, friendship: 70, condition: zeroCondition() }) as unknown as Pokemon;

describe('making a Poffin (Poffin_MakePoffin, Poffin_CalcLevel)', () => {
  it('names it by its flavours', () => {
    expect(makePoffin([10, 0, 0, 0, 0], 20, false, rng()).type).toBe(0);
    const two = makePoffin([10, 0, 20, 0, 0], 20, false, rng());
    expect(two.type).toBe(2 * 5 + 0);
    expect(poffinLevel(two)).toBe(20);
    expect(makePoffin([10, 0, 20, 5, 0], 20, false, rng()).type).toBe(POFFIN_TYPE.rich);
    expect(makePoffin([10, 1, 20, 5, 0], 20, false, rng()).type).toBe(POFFIN_TYPE.overripe);
    expect(makePoffin([50, 0, 0, 0, 0], 20, false, rng()).type).toBe(POFFIN_TYPE.mild);
  });

  it('a foul one has three random flavours at 2', () => {
    const p = makePoffin([0, 0, 0, 0, 0], 30, false, rng());
    expect(p.type).toBe(POFFIN_TYPE.foul);
    expect(p.flavors.filter((f) => f === 2)).toHaveLength(3);
    expect(p.flavors.reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe('feeding a Poffin (PoffinCase_UpdateMonContestStats)', () => {
  const dry: Poffin = { type: 7, flavors: [0, 32, 32, 0, 0], smoothness: 20 };

  it('the liked flavour ×1.1, the disliked ×0.9, the smoothness to the sheen, friendship +1', () => {
    const m = mon();
    expect(poffinPreference(dry, modest)).toBe('neutral');
    feedPoffin(dex(modest), m, dry);
    expect(m.condition).toEqual({ cool: 0, beauty: 35, cute: 28, smart: 0, tough: 0, sheen: 20 });
    expect(m.friendship).toBe(71);
  });

  it('a neutral nature takes the flavours as they are; each condition stops at 255, and a full sheen eats no more', () => {
    const m = mon();
    for (let i = 0; i < 13; i++) feedPoffin(dex({ up: null, down: null }), m, dry);
    expect(m.condition).toMatchObject({ beauty: 255, cute: 255, sheen: 255 });
    expect(wontEat(m)).toBe(true);
  });
});

describe('cooking (ov83_0223F7F4.c)', () => {
  const cheri = { flavors: [10, 0, 0, 0, 0], smoothness: 25 };

  it('the arc is positive clockwise on screen', () => {
    expect(arcLength(48, 0, 47, 9)).toBeGreaterThan(0);
    expect(arcLength(48, 0, 47, -9)).toBeLessThan(0);
  });

  it('left alone, each phase runs out its 20 s and the batter burns every 3 s after a warning', () => {
    const cook = new PoffinCook(rng());
    while (cook.step(null));
    expect(cook.frames).toBe(1800);
    expect(cook.burns).toBe(19);
    expect(cook.time()).toEqual({ minutes: 1, seconds: 0, hundredths: 0 });
    expect(cook.result(cheri).type).toBe(POFFIN_TYPE.foul);
  });

  it('stirring the way it asks finishes each phase in 16 laps, faster than a minute, so the Poffin comes out stronger', () => {
    const cook = new PoffinCook(rng());
    let angle = -Math.PI / 2;
    let laps = 0;
    while (cook.step((angle += (cook.direction === 0 ? 1 : -1) * (32 / 48), { x: Math.round(POT_CENTER.x + Math.cos(angle) * 40), y: Math.round(POT_CENTER.y + Math.sin(angle) * 40) }))) laps = Math.max(laps, cook.laps);
    expect(laps).toBe(16);
    expect(cook.frames).toBeLessThan(1800);
    const p = cook.result({ flavors: [0, 0, 0, 0, 0], smoothness: 25 });
    expect(p.smoothness).toBe(24);
    const strong = cook.result({ flavors: [40, 0, 0, 0, 0], smoothness: 25 });
    expect(strong.flavors[0]).toBeGreaterThan(39 - cook.burns - cook.spills);
  });
});

describe('the Fashion Case (FashionCase_*)', () => {
  it('holds up to 9 of the first 61 accessories and one of the rest', () => {
    const fc = newFashionCase();
    addAccessory(fc, 0, 12);
    expect(accessoryCount(fc, 0)).toBe(9);
    expect(canFitAccessory(fc, 0, 1)).toBe(false);
    addAccessory(fc, 70, 1);
    expect(canFitAccessory(fc, 70, 1)).toBe(false);
    removeAccessory(fc, 0, 4);
    removeAccessory(fc, 70, 0);
    expect(totalAccessories(fc)).toBe(5);
    expect(() => addAccessory(fc, 100, 1)).toThrow();
  });

  it('keeps backdrops once, in the order received', () => {
    const fc = newFashionCase();
    addBackdrop(fc, 5);
    addBackdrop(fc, 2);
    addBackdrop(fc, 5);
    expect(fc.backdrops).toEqual([5, 2]);
  });
});
