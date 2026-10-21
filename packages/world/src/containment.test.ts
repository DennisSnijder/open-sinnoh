import { describe, expect, it } from 'vitest';
import { ContainmentUnits } from './containment.ts';

describe('containment channels (original clips)', () => {
  for (const phase of [0, 2, 5])
    it(`waits for the residual loop from phase ${phase}, then the opening endpoint`, () => {
      const units = new ContainmentUnits(7, 5, false);
      for (let i = 0; i < phase; i++) units.step();
      units.deactivate();
      let ticks = 0;
      while (!units.done() && ticks < 30) {
        units.step();
        ticks++;
      }
      expect(ticks).toBe(7 - phase + 5);
      expect(units.loop).toBe(6);
      expect(units.opening).toBe(4);
      const frames = [units.loop, units.opening];
      for (let i = 0; i < 20; i++) units.step();
      expect([units.loop, units.opening]).toEqual(frames);
    });
  it('reconstructs the released terminal pose without running another release', () => {
    const units = new ContainmentUnits(9, 4, true);
    for (let i = 0; i < 30; i++) units.step();
    expect(units.done()).toBe(true);
    expect(units.opening).toBe(3);
    expect(units.loop).toBe(0);
  });
});
