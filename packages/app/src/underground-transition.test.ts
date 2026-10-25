import { describe, expect, it } from 'vitest';
import { transitionCell } from './underground-transition.ts';

/** The shapes of the transition's NANRs: the player's fall (a loop), the hole opening (forward, held at its end). */
const sheet = {
  animations: [
    { mode: 'loop' as const, loopStart: 0, frames: [{ cell: 0, ticks: 4 }, { cell: 6, ticks: 4 }, { cell: 7, ticks: 4 }] },
    { mode: 'forward' as const, loopStart: 0, frames: [{ cell: 0, ticks: 1 }, { cell: 1, ticks: 2 }, { cell: 3, ticks: 2 }] },
  ],
};

describe('transitionCell', () => {
  it('loops a looping animation and holds a forward one on its last cell', () => {
    expect([0, 3, 4, 8, 11, 12, 13].map((f) => transitionCell(sheet, 0, f))).toEqual([0, 0, 6, 7, 7, 0, 0]);
    expect([0, 1, 2, 3, 4, 5, 40].map((f) => transitionCell(sheet, 1, f))).toEqual([0, 1, 1, 3, 3, 3, 3]);
  });

  it('takes the whole frames of a fractional count (the spin speeds)', () => {
    expect(transitionCell(sheet, 0, 3.9)).toBe(0);
    expect(transitionCell(sheet, 0, 4.2)).toBe(6);
  });

  it('fails loudly on an animation the sheet does not have', () => {
    expect(() => transitionCell(sheet, 2, 0)).toThrow(/no animation 2/);
  });
});
