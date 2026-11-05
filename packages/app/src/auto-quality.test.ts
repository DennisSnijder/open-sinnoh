import { describe, expect, it } from 'vitest';
import { AutoQuality, SETTLE_FRAMES, WINDOW_FRAMES } from './auto-quality.ts';

const run = (q: AutoQuality, ms: number, frames: number) => {
  const out: string[] = [];
  for (let i = 0; i < frames; i++) {
    const step = q.frame(ms);
    if (step) out.push(step);
  }
  return out;
};

describe('AutoQuality', () => {
  it('leaves a device at speed alone', () => {
    expect(run(new AutoQuality(null), 16.7, WINDOW_FRAMES * 20)).toEqual([]);
  });

  it('eases after two slow windows in a row, not one', () => {
    const q = new AutoQuality(null);
    expect(run(q, 40, WINDOW_FRAMES)).toEqual([]);
    expect(run(q, 16.7, WINDOW_FRAMES)).toEqual([]);
    expect(run(q, 40, WINDOW_FRAMES)).toEqual([]);
    expect(run(q, 40, WINDOW_FRAMES)).toEqual(['ease']);
  });

  it('keeps a step that helped and stops watching', () => {
    const q = new AutoQuality(null);
    expect(run(q, 40, WINDOW_FRAMES * 2)).toEqual(['ease']);
    expect(run(q, 30, SETTLE_FRAMES + WINDOW_FRAMES)).toEqual(['keep']);
    expect(run(q, 40, WINDOW_FRAMES * 4)).toEqual([]);
  });

  it('takes back a step that did not help (a browser capped at 30 fps) and does not try again', () => {
    const q = new AutoQuality(null);
    expect(run(q, 33.3, WINDOW_FRAMES * 2)).toEqual(['ease']);
    expect(run(q, 33.3, SETTLE_FRAMES + WINDOW_FRAMES)).toEqual(['revert']);
    expect(run(q, 33.3, WINDOW_FRAMES * 4)).toEqual([]);
  });

  it('does not count stalls, skipped windows or the frames after the step', () => {
    const q = new AutoQuality(null);
    run(q, 40, WINDOW_FRAMES - 1);
    expect(q.frame(2000)).toBeNull();
    expect(run(q, 40, WINDOW_FRAMES - 1)).toEqual([]);
    q.skip();
    expect(run(q, 40, WINDOW_FRAMES * 2)).toEqual(['ease']);
    // Frames still slow from the step itself are left out: only those after them count.
    expect(run(q, 100, SETTLE_FRAMES)).toEqual([]);
    expect(run(q, 30, WINDOW_FRAMES)).toEqual(['keep']);
  });

  it('watches nothing once a stored answer exists or the player picks a style', () => {
    expect(run(new AutoQuality('eased'), 40, WINDOW_FRAMES * 4)).toEqual([]);
    expect(run(new AutoQuality('off'), 40, WINDOW_FRAMES * 4)).toEqual([]);
    const q = new AutoQuality(null);
    q.stop();
    expect(run(q, 40, WINDOW_FRAMES * 4)).toEqual([]);
  });
});
