import { describe, expect, it } from 'vitest';
import { FAST_TICK_BUDGET_MS, MAX_CATCH_UP, runTicks, stepClock, TICK_MS } from './loop.ts';
import { DEFAULT_FAST_SPEED, FastForward, parseFastSpeed } from './speed.ts';

/** Ticks over one wall second of 60 Hz frames at `speed`. */
function ticksPerSecond(speed: number, frameMs = 1000 / 60): number[] {
  let acc = 0;
  const perFrame: number[] = [];
  for (let t = 0; t < 1000 - 1e-9; t += frameMs) {
    const s = stepClock(acc, frameMs, speed);
    acc = s.accumulator;
    perFrame.push(s.ticks);
  }
  return perFrame;
}

describe('game speed: tick scheduling', () => {
  it('runs N ticks per 30 Hz of wall time at speed N, spread over the display frames', () => {
    for (const speed of [1, 2, 3, 4, 8]) {
      const perFrame = ticksPerSecond(speed);
      // ±1 for the accumulator's float remainder at the second's edge.
      expect(Math.abs(perFrame.reduce((a, b) => a + b, 0) - 30 * speed)).toBeLessThanOrEqual(1);
      // At 60 Hz: half a tick per frame at 1x, N/2 per frame at N.
      expect(Math.max(...perFrame)).toBe(Math.ceil(speed / 2));
    }
    // A 120 Hz display at 4x: one tick most frames, never a burst.
    expect(Math.max(...ticksPerSecond(4, 1000 / 120))).toBe(1);
  });

  it('caps catch-up after a stall at MAX_CATCH_UP ticks times the speed', () => {
    expect(stepClock(0, 10_000).ticks).toBe(MAX_CATCH_UP);
    expect(stepClock(0, 10_000, 4)).toMatchObject({ ticks: MAX_CATCH_UP * 4, capped: 1200 - MAX_CATCH_UP * 4 });
    // The remainder below one tick is kept, as at 1x.
    const s = stepClock(0, TICK_MS / 2, 3);
    expect(s.ticks).toBe(1);
    expect(s.accumulator).toBeCloseTo(TICK_MS / 2);
  });

  it('drops fast ticks a slow machine has no time for, never the 1x share', () => {
    const run = (count: number, speed: number, tickMs: number) => {
      let now = 0;
      let ran = 0;
      const n = runTicks(
        count,
        speed,
        () => {
          now += tickMs;
          ran++;
        },
        () => now,
      );
      expect(n).toBe(ran);
      return n;
    };
    // Cheap ticks: everything runs.
    expect(run(8, 4, 0.1)).toBe(8);
    // 3 ms ticks: the budget (10 ms) stops the fast ones after the fourth.
    expect(FAST_TICK_BUDGET_MS).toBe(10);
    expect(run(8, 4, 3)).toBe(4);
    // 30 ms ticks: only the 1x share (ceil(8 / 4) = 2) runs.
    expect(run(8, 4, 30)).toBe(2);
    // 1x never drops: every tick is the 1x share.
    expect(run(5, 1, 30)).toBe(5);
  });
});

describe('game speed: setting and fast-forward state', () => {
  it('reads a stored fast speed strictly (device data)', () => {
    expect(parseFastSpeed(null)).toBe(DEFAULT_FAST_SPEED);
    expect(parseFastSpeed('3')).toBe(3);
    expect(parseFastSpeed('8')).toBe(8);
    for (const bad of ['5', '1', '"4"', '4.0x', '{}', 'null']) expect(parseFastSpeed(bad)).toBe(DEFAULT_FAST_SPEED);
  });

  it('runs fast while any source holds it or while latched', () => {
    const ff = new FastForward(4);
    expect(ff.speed()).toBe(1);
    ff.hold('keyboard', true);
    ff.hold('gamepad', true);
    expect(ff.speed()).toBe(4);
    ff.hold('keyboard', false);
    expect(ff.speed()).toBe(4);
    ff.hold('gamepad', false);
    expect(ff.speed()).toBe(1);
    ff.latched = true;
    expect(ff.speed()).toBe(4);
    ff.fast = 2;
    expect(ff.speed()).toBe(2);
  });
});
