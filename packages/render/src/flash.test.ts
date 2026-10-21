import { afterEach, describe, expect, it } from 'vitest';
import { capFlash, FLASH_CAP, FLASH_SLEW, FlashLimiter, reduceFlashing, setReduceFlashing } from './flash.ts';
import { Lightning } from '@opensinnoh/world';

afterEach(() => setReduceFlashing(false));

describe('reduce flashing', () => {
  it('off, every alpha passes through untouched', () => {
    const l = new FlashLimiter();
    expect([0, 0.3, 1, 0.5, 0].map((a, i) => l.apply(a, i * 16))).toEqual([0, 0.3, 1, 0.5, 0]);
    expect(capFlash(1)).toBe(1);
    expect(reduceFlashing()).toBe(false);
  });

  it('on, a white overlay never shows more than the cap', () => {
    setReduceFlashing(true);
    expect(capFlash(1)).toBe(FLASH_CAP);
    expect(capFlash(0.1)).toBe(0.1);
    const l = new FlashLimiter();
    let top = 0;
    for (let t = 0; t < 2000; t += 16) top = Math.max(top, l.apply(1, t));
    expect(top).toBe(FLASH_CAP);
  });

  it('on, it eases: no faster than the slew, up and down', () => {
    setReduceFlashing(true);
    const l = new FlashLimiter();
    l.apply(0, 0);
    const up = [l.apply(1, 16), l.apply(1, 32), l.apply(1, 48)];
    expect(up[0]).toBeCloseTo((FLASH_SLEW * 16) / 1000, 6);
    for (let i = 1; i < up.length; i++) expect(up[i]! - up[i - 1]!).toBeCloseTo((FLASH_SLEW * 16) / 1000, 6);
    // From the cap back to clear takes as long as it took to rise.
    for (let t = 64; t < 400; t += 16) l.apply(1, t);
    const level = l.apply(1, 400);
    expect(level).toBe(FLASH_CAP);
    expect(l.apply(0, 416)).toBeCloseTo(FLASH_CAP - (FLASH_SLEW * 16) / 1000, 6);
  });

  it('a long gap (a hidden tab) steps at most 100 ms of slew', () => {
    setReduceFlashing(true);
    const l = new FlashLimiter();
    l.apply(0, 0);
    expect(l.apply(1, 60_000)).toBeCloseTo(FLASH_SLEW * 0.1, 6);
  });

  it('black fades are not flashes and pass at any setting', () => {
    setReduceFlashing(true);
    const l = new FlashLimiter();
    expect([l.fade('black', 1, 0), l.fade('black', 0.6, 16)]).toEqual([1, 0.6]);
    expect(l.fade('white', 1, 32)).toBeLessThan(FLASH_CAP + 1e-9);
  });

  it('a lightning strobe becomes a soft, capped swell', () => {
    // The game's own lightning: the weather's brightness steps; with the setting on, the drawn flash is slower and dimmer.
    const bolt = new Lightning();
    const l = new FlashLimiter();
    setReduceFlashing(true);
    let raw = 0;
    let drawn = 0;
    let prev = 0;
    let steepest = 0;
    for (let tick = 0; tick < 900; tick++) {
      bolt.step();
      raw = Math.max(raw, bolt.alpha);
      // A display frame at 60 Hz: two per 30 Hz tick.
      for (let f = 0; f < 2; f++) {
        const a = l.apply(bolt.alpha, tick * (1000 / 30) + f * (1000 / 60));
        drawn = Math.max(drawn, a);
        steepest = Math.max(steepest, Math.abs(a - prev));
        prev = a;
      }
    }
    expect(raw).toBeGreaterThan(FLASH_CAP);
    expect(drawn).toBeLessThanOrEqual(FLASH_CAP);
    expect(steepest).toBeLessThanOrEqual((FLASH_SLEW * 1000) / 60 / 1000 + 1e-9);
  });
});
