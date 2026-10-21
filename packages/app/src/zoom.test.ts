import { describe, expect, it } from 'vitest';
import { autoScale, fieldScale, maxZoom, minZoom, parseZoom, stepZoom, WheelSteps, zoomChoices, zoomLabel } from './zoom.ts';

describe('field zoom', () => {
  it('fits the DS view in Auto and allows whole scales that still show all of it', () => {
    expect(autoScale(2560, 1440)).toBe(7.5);
    expect(maxZoom(2560, 1440)).toBe(7);
    expect(maxZoom(1280, 720)).toBe(3);
    // A narrow window keeps the DS width.
    expect(autoScale(390, 640)).toBeCloseTo(390 / 256);
    expect(maxZoom(390, 640)).toBe(1);
    // Smaller than the DS view: 1x is still offered (the view cuts the DS view, as Auto would shrink it).
    expect(maxZoom(200, 150)).toBe(1);
  });

  it('never zooms out past 3.5 DS views wide or 2.5 high (896×480 DS px)', () => {
    // 1440 / 480 = 3; 2560 / 896 = 2.86.
    expect(minZoom(2560, 1440)).toBe(3);
    expect(minZoom(3440, 1440)).toBe(4);
    expect(minZoom(1920, 1080)).toBe(3);
    expect(minZoom(1280, 720)).toBe(2);
    expect(minZoom(896, 480)).toBe(1);
    // Never above the largest scale (a very wide, short window).
    expect(minZoom(5000, 300)).toBe(1);
    expect(zoomChoices(2560, 1440)).toEqual(['auto', 3, 4, 5, 6, 7]);
    expect(zoomChoices(1280, 720)).toEqual(['auto', 2, 3]);
  });

  it('clamps a fixed scale to the window and keeps Auto fractional', () => {
    expect(fieldScale('auto', 2560, 1440)).toBe(7.5);
    expect(fieldScale(5, 2560, 1440)).toBe(5);
    expect(fieldScale(1, 2560, 1440)).toBe(3);
    expect(fieldScale(12, 2560, 1440)).toBe(7);
    expect(fieldScale(3, 1280, 720)).toBe(3);
    expect(fieldScale(7, 1280, 720)).toBe(3);
  });

  it('steps whole scales from what is shown, Auto from its fitted scale', () => {
    expect(stepZoom('auto', -1, 2560, 1440)).toBe(7);
    expect(stepZoom('auto', 1, 2560, 1440)).toBe(7);
    expect(stepZoom('auto', -1, 1536, 1152)).toBe(5);
    expect(stepZoom(5, 1, 2560, 1440)).toBe(6);
    expect(stepZoom(5, -1, 2560, 1440)).toBe(4);
    expect(stepZoom(3, -1, 2560, 1440)).toBe(3);
    expect(stepZoom(7, 1, 2560, 1440)).toBe(7);
    // A stored scale the window cannot show steps from the clamped one.
    expect(stepZoom(12, -1, 2560, 1440)).toBe(6);
    expect(zoomLabel(3)).toBe('3x');
    expect(zoomLabel('auto')).toBe('Auto');
  });

  it('turns wheel notches and pinch deltas into steps, up/out zooming in', () => {
    const mouse = new WheelSteps();
    expect(mouse.add(-100, 0)).toBe(1);
    expect(mouse.add(100, 0)).toBe(-1);
    expect(mouse.add(3, 1)).toBe(-1);
    const pinch = new WheelSteps();
    const steps = Array.from({ length: 12 }, () => pinch.add(-6, 0));
    expect(steps.filter((s) => s !== 0)).toEqual([1]);
  });
});

it('reads a stored zoom strictly: anything unreadable is Auto', () => {
  expect(parseZoom(null)).toBe('auto');
  expect(parseZoom('3')).toBe(3);
  expect(parseZoom('"auto"')).toBe('auto');
  for (const bad of ['{', '0', '2.5', '"big"', '[3]', '1000']) expect(parseZoom(bad)).toBe('auto');
});
