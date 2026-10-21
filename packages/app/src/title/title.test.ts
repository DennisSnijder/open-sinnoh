import { describe, expect, it } from 'vitest';
import { titleLayout, wordmarkScale } from './layout.ts';
import { exitBrightness, FOCUS_CYCLE, hoverY, promptOn } from './timeline.ts';

describe('title timeline', () => {
  it('blinks the prompt 16/16, exits after 10 frames over 6, hovers and cycles the focus colour', () => {
    expect([0, 15, 16, 31, 32].map(promptOn)).toEqual([true, true, false, false, true]);
    expect([0, 10, 13, 16, 30].map(exitBrightness)).toEqual([0, 0, 8, 16, 16]);
    expect(hoverY(0)).toBe(0);
    const ys = Array.from({ length: 180 }, (_, i) => hoverY(i));
    expect(Math.min(...ys)).toBeLessThan(-8);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0);
    expect(FOCUS_CYCLE).toHaveLength(30);
    expect(FOCUS_CYCLE[15]).toEqual([31, 28, 20]);
  });
});

describe('title layout', () => {
  it('raises and pulls back the model in landscape, the 3D at about DS resolution', () => {
    expect(titleLayout(1280, 720, 1)).toEqual({ landscape: true, k3d: 3, lift: 0.14, zoom: 1.3 });
  });

  it('keeps the 3D scale whole in device pixels in portrait', () => {
    const l = titleLayout(390, 844, 3);
    expect(l.landscape).toBe(false);
    expect((l.k3d * 3) % 1).toBeCloseTo(0, 9);
    expect(l.k3d).toBeGreaterThan(1.5);
  });
});

describe('title wordmark scale', () => {
  it('fits a whole scale on desktop and phone, portrait and landscape', () => {
    expect([wordmarkScale(1280, 720), wordmarkScale(1920, 1080), wordmarkScale(390, 844), wordmarkScale(844, 390), wordmarkScale(320, 568)]).toEqual([7, 8, 5, 4, 4]);
  });
});
