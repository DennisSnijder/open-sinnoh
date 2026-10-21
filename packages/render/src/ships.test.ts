import { expect, it } from 'vitest';
import { shipFade } from './ships.ts';

it('fades over the animation and holds the final pose through the six-frame exit', () => {
  expect([0, 3, 6, 89, 90, 93, 96].map(t => shipFade(t, 90))).toEqual([1, 0.5, 0, 0, 0, 0.5, 1]);
});
