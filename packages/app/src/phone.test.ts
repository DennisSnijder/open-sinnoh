import { describe, expect, it } from 'vitest';
import { computeLayout, CONTROL_SPACE, controlMetrics, controlsStrip, HUD_BAND, type Insets, type Rect } from './layout.ts';
import { DEFAULT_PHONE, parsePhone } from './phone.ts';

describe('phone settings (device data, validated)', () => {
  it('keeps what is valid, field by field, and defaults the rest', () => {
    expect(parsePhone(null)).toEqual(DEFAULT_PHONE);
    expect(parsePhone('not json')).toEqual(DEFAULT_PHONE);
    expect(parsePhone(JSON.stringify({ size: 2, opacity: 60, haptics: false, keepAwake: false }))).toEqual({ size: 2, opacity: 60, haptics: false, keepAwake: false });
    // A bad field is its default; the good ones stay.
    expect(parsePhone(JSON.stringify({ size: 3, opacity: 5, haptics: 'yes', keepAwake: false }))).toEqual({ ...DEFAULT_PHONE, keepAwake: false });
    expect(parsePhone(JSON.stringify({ size: 1.5, opacity: 101 }))).toEqual(DEFAULT_PHONE);
  });
});

describe('control sizes', () => {
  it('M is the base size; the gaps around a pill keep the drawn spacing at every size', () => {
    const m = controlMetrics(1);
    expect(m).toMatchObject({ key: 48, face: 46, pillW: 64, pillH: 44, dpad: { width: 144, height: 144 }, buttons: { width: 138, height: 138 } });
    for (const scale of [0.8, 1, 1.25]) {
      const c = controlMetrics(scale);
      expect(c.pillGap + c.pillInsetY).toBe(CONTROL_SPACE);
      expect(c.pillSpace + 2 * c.pillInsetX).toBe(CONTROL_SPACE);
    }
  });

  it('the portrait strip and the landscape boxes take the size', () => {
    for (const scale of [0.8, 1, 1.25]) {
      const c = controlMetrics(scale);
      const p = computeLayout(390, 844, { controls: true, controlScale: scale });
      expect(p.main.height).toBe(844 - controlsStrip(c));
      expect(p.controls!.metrics).toEqual(c);
      const l = computeLayout(844, 390, { controls: true, controlScale: scale });
      expect(l.controls!.dpad).toMatchObject(c.dpad);
      expect(l.controls!.buttons).toMatchObject(c.buttons);
    }
  });

  it('size L shrinks to what fits a 320-px phone in portrait, and keeps 44-px targets', () => {
    const l = computeLayout(320, 568, { controls: true, controlScale: 1.25 });
    expect(l.controls!.metrics.scale).toBe(1);
    expect(computeLayout(430, 932, { controls: true, controlScale: 1.25 }).controls!.metrics.scale).toBe(1.25);
  });
});

describe('the controls composition', () => {
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const notch: Insets = { top: 47, right: 0, bottom: 34, left: 0 };
  const sideNotch: Insets = { top: 0, right: 47, bottom: 21, left: 47 };
  const cases: [number, number, Insets][] = [
    [320, 568, { top: 20, right: 0, bottom: 0, left: 0 }],
    [375, 667, { top: 20, right: 0, bottom: 0, left: 0 }],
    [375, 812, notch],
    [390, 844, notch],
    [430, 932, notch],
    [820, 1180, { top: 24, right: 0, bottom: 20, left: 0 }],
    [568, 320, { top: 0, right: 0, bottom: 0, left: 0 }],
    [844, 390, sideNotch],
    [932, 430, sideNotch],
    [1180, 820, { top: 24, right: 0, bottom: 20, left: 0 }],
  ];
  for (const [w, h, insets] of cases) {
    for (const scale of [0.8, 1, 1.25]) {
      it(`${w}×${h} at ${scale}: mirrored, Select and Start centred, equal drawn margins, nothing overlaps, whole pixels`, () => {
        const l = computeLayout(w, h, { controls: true, insets, controlScale: scale });
        const c = l.controls!;
        const m = c.metrics;
        const rects = [c.dpad, c.buttons, c.select, c.start];
        for (const r of rects) for (const v of [r.x, r.y, r.width, r.height]) expect(Number.isInteger(v)).toBe(true);
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
        // Inside the safe area.
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(insets.left);
          expect(r.x + r.width).toBeLessThanOrEqual(w - insets.right);
          expect(r.y + r.height).toBeLessThanOrEqual(h - insets.bottom);
        }
        const centre = (r: Rect) => r.x + r.width / 2;
        const middle = (r: Rect) => r.y + r.height / 2;
        const line = l.mode === 'portrait' ? insets.left + (w - insets.left - insets.right) / 2 : w / 2;
        // The d-pad and the diamond mirror each other about the centre line, their centres level; so do the pills.
        expect(Math.abs(centre(c.dpad) + centre(c.buttons) - 2 * line)).toBeLessThanOrEqual(1);
        expect(Math.abs(centre(c.select) + centre(c.start) - 2 * line)).toBeLessThanOrEqual(1);
        expect(Math.abs(middle(c.dpad) - middle(c.buttons))).toBeLessThanOrEqual(1);
        expect(c.select.y).toBe(c.start.y);
        const drawnBottom = c.select.y + c.select.height - m.pillInsetY;
        if (l.mode === 'portrait') {
          // Equal drawn margins above (from the field view's bottom) and below (to the bottom inset).
          const above = Math.min(c.dpad.y, c.buttons.y) - l.main.height;
          const below = h - insets.bottom - drawnBottom;
          expect(above).toBe(CONTROL_SPACE);
          expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
          // The pills sit centred under the row, the drawn gap the same as the margins.
          expect(c.select.y + m.pillInsetY - (c.dpad.y + c.dpad.height)).toBe(CONTROL_SPACE);
          expect(c.dpad.x - insets.left).toBeGreaterThanOrEqual(8);
          expect(c.buttons.x - (c.dpad.x + c.dpad.width)).toBeGreaterThanOrEqual(16);
        } else {
          // Select under the d-pad, Start under the diamond, the drawn bottom CONTROL_SPACE above the inset.
          expect(Math.abs(centre(c.select) - centre(c.dpad))).toBeLessThanOrEqual(1);
          expect(Math.abs(centre(c.start) - centre(c.buttons))).toBeLessThanOrEqual(1);
          expect(h - insets.bottom - drawnBottom).toBe(CONTROL_SPACE);
          expect(c.dpad.y).toBeGreaterThanOrEqual(insets.top);
        }
        // Hit areas: at least 44 px at sizes M and L (S may go under, by choice).
        if (scale >= 1) for (const r of rects.slice(2)) expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(44);
        if (scale >= 1) expect(Math.min(m.key, m.face)).toBeGreaterThanOrEqual(44);
      });
    }
  }
});

describe('the room keeps clear of the safe areas', () => {
  it('portrait: the HUD row sits under the top inset; no controls strip: the bottom inset too', () => {
    expect(computeLayout(390, 844, { controls: false }).room).toEqual({ top: HUD_BAND, right: 0, bottom: 0, left: 0 });
    expect(computeLayout(390, 844, { controls: false, insets: { top: 47, right: 0, bottom: 34, left: 0 } }).room).toEqual({ top: 47 + HUD_BAND - 8, right: 0, bottom: 34, left: 0 });
    // With the strip, the strip holds the bottom inset.
    expect(computeLayout(390, 844, { controls: true, insets: { top: 47, right: 0, bottom: 34, left: 0 } }).room.bottom).toBe(0);
  });

  it('landscape: both sides take the larger inset (or the control columns), the bottom inset is kept', () => {
    const noControls = computeLayout(844, 390, { controls: false, insets: { top: 0, right: 47, bottom: 21, left: 30 } }).room;
    expect(noControls).toEqual({ top: 0, right: 47, bottom: 21, left: 47 });
    const withControls = computeLayout(844, 390, { controls: true, insets: { top: 0, right: 47, bottom: 21, left: 47 } });
    expect(withControls.room.left).toBe(withControls.room.right);
    expect(withControls.room.left).toBeGreaterThanOrEqual(47 + 160);
  });
});

describe('the safe rect', () => {
  it('is the view clear of the insets; the controls strip already holds the bottom one', () => {
    expect(computeLayout(390, 844, { controls: false }).safe).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(computeLayout(844, 390, { controls: false, insets: { top: 0, right: 47, bottom: 21, left: 47 } }).safe).toEqual({ x: 47, y: 0, width: 750, height: 369 });
    const withStrip = computeLayout(390, 844, { controls: true, insets: { top: 47, right: 0, bottom: 34, left: 0 } });
    expect(withStrip.safe).toEqual({ x: 0, y: 47, width: 390, height: withStrip.main.height - 47 });
  });
});
