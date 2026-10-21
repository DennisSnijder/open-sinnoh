import { expect, it } from 'vitest';
import { spotlightAngle } from './hof-spotlights.ts';
import { bikePose } from './credits-bike.ts';
import type { Ui2dAnimation } from '@opensinnoh/contracts';

it('reverses a spotlight on the VBlank crossing, keeping its fractional overshoot', () => {
  expect(spotlightAngle(20, 0.75, 200)).toBe(170);
  expect(spotlightAngle(20, 0.75, 201)).toBe(169.25);
  expect(spotlightAngle(20, 0.75, 414)).toBe(9.5);
  expect(spotlightAngle(20, 0.75, 415)).toBe(10.25);
});

it('replays cosmetic bike glances identically without touching game state', () => {
  const animation = (ticks: number): Ui2dAnimation => ({ mode: 'forward', loopStart: 0, frames: [{ cell: 0, ticks }] });
  const data = [animation(8), animation(180), animation(4)];
  const poses = Array.from({ length: 300 }, (_, frame) => bikePose(data, frame));
  expect(poses.slice(0, 60).every(p => p.sequence === 0 && p.eyes === null)).toBe(true);
  expect(new Set(poses.filter(p => p.sequence === 1).map(p => p.eyes))).toEqual(new Set([0, 1]));
  expect(bikePose(data, 170)).toEqual(poses[170]);
  expect(bikePose(data, 0)).toEqual(poses[0]);
});
