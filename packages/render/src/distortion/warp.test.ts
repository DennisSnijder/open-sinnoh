import { expect, it } from 'vitest';
import { warpFade, warpFov } from './warp.ts';

it('zooms throughout the application, including its independently timed fades', () => {
  expect([0, 8, 16, 101, 102, 112, 122].map(warpFade)).toEqual([1, 0.5, 0, 0, 0, 0.5, 1]);
  expect(warpFov(1)).toBe(warpFov(0) - 60 * 720 / 65536);
  expect(warpFov(100) - warpFov(101)).toBe(16 * 720 / 65536);
  expect(warpFov(122)).toBeGreaterThan(0);
  expect(warpFov(122)).toBeLessThan(warpFov(88));
});
