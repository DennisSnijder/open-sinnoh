import { describe, expect, it } from 'vitest';
import { computeLayout, controlMetrics, CONTROLS_STRIP, panelScale, SHEET, uiScales, type Rect } from './layout.ts';
import { gamepadButtons, InputState, KEY_MAP } from './input.ts';
import { bottomFrame, choiceRects, hitChoice, toOverlayPoint, toPanelPoint } from './panel.ts';
import { MAX_CATCH_UP, stepClock, TICK_MS } from './loop.ts';
import { checkRomSize, verifyRom } from './rom-check.ts';
import { mapPopupScale, mapPopupTextX } from './map-popup.ts';

describe('map popup layout', () => {
  it('places the name by the decomp rule', () => {
    // MapNamePopUp_DrawWindowFrame worked by hand: width 50 → 4 + 11.
    expect(mapPopupTextX(50)).toBe(15);
    expect(mapPopupTextX(0)).toBe(4);
  });

  it('keeps the DS scale on phones and caps it at the UI dot on big screens', () => {
    expect(mapPopupScale(4, { width: 390, height: 696 }, 3)).toBe(4);
    expect(mapPopupScale(3, { width: 1280, height: 720 }, 1)).toBe(2);
    expect(mapPopupScale(11, { width: 2560, height: 1440 }, 2)).toBe(6);
    expect(mapPopupScale(1, { width: 300, height: 200 }, 1)).toBe(1);
  });
});
import type { PanelView } from '@opensinnoh/contracts';

const inside = (inner: Rect, w: number, h: number) => inner.x >= 0 && inner.y >= 0 && inner.x + inner.width <= w && inner.y + inner.height <= h;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('layout', () => {
  it('prefers an integer panel scale only when it keeps at least 80% of the fit', () => {
    expect(panelScale(2.3)).toBe(2);
    expect(panelScale(1.1)).toBe(1);
    expect(panelScale(1.52)).toBe(1.52);
    expect(panelScale(0.8)).toBe(0.8);
    expect(() => panelScale(0)).toThrow();
  });

  it('the field view fills the screen; the panel card floats over it, centred', () => {
    for (const [w, h] of [
      [1280, 720],
      [390, 844],
    ] as const) {
      const l = computeLayout(w, h, { controls: false });
      expect(l.main).toEqual({ x: 0, y: 0, width: w, height: h });
      expect(inside(l.panel, w, h)).toBe(true);
      expect(l.panel.x).toBe(Math.round((w - l.panel.width) / 2));
      expect(l.panel.width / l.panel.height).toBeCloseTo(256 / 192, 1);
    }
  });

  it('portrait phone with controls: a controls strip under the field view, panel inside the view', () => {
    const l = computeLayout(390, 844, { controls: true });
    expect(l.mode).toBe('portrait');
    expect(l.main.height).toBe(844 - CONTROLS_STRIP);
    expect(l.controls!.dpad.y).toBeGreaterThan(l.main.height);
    expect(inside(l.panel, l.main.width, l.main.height)).toBe(true);
  });

  it('the controls stay clear of the safe-area insets', () => {
    const m = controlMetrics(1);
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    const p = computeLayout(390, 844, { controls: true, insets });
    expect(p.main.height).toBe(844 - CONTROLS_STRIP - 34);
    for (const r of [p.controls!.select, p.controls!.start]) expect(r.y + r.height - m.pillInsetY).toBe(844 - 34 - 16);
    const side = { top: 0, right: 47, bottom: 21, left: 47 };
    const l = computeLayout(844, 390, { controls: true, insets: side });
    expect(l.controls!.dpad).toMatchObject({ x: 47 + 8, ...m.dpad });
    expect(l.controls!.buttons.x + m.buttons.width).toBe(844 - 47 - 8 - (m.dpad.width - m.buttons.width) / 2);
    expect(l.controls!.select.y + m.pillH - m.pillInsetY).toBe(390 - 21 - 16);
  });

  it('landscape with controls: d-pad and buttons float over the bottom corners', () => {
    const l = computeLayout(844, 390, { controls: true });
    expect(l.main).toEqual({ x: 0, y: 0, width: 844, height: 390 });
    expect(l.controls!.dpad.x).toBe(8);
    expect(l.controls!.start.x + l.controls!.start.width).toBe(844 - l.controls!.select.x);
  });

  it('big desktop gets an integer panel scale', () => {
    const l = computeLayout(2560, 1440, { controls: false });
    expect(Number.isInteger(l.panel.scale)).toBe(true);
  });

  it('UI scales: the DS unit as the battle window (x3 to 1080p, x4 at 1440p), the sheet dot, whole device pixels', () => {
    expect(uiScales(1280, 720, 1, false)).toEqual({ dot: 2, unit: 3, compact: false });
    expect(uiScales(1920, 1080, 1, false)).toEqual({ dot: 2, unit: 3, compact: false });
    expect(uiScales(2560, 1440, 1, false)).toEqual({ dot: 3, unit: 4, compact: false });
    expect(uiScales(844, 390, 3, false)).toEqual({ dot: 1, unit: 2, compact: false });
    expect(uiScales(390, 696, 3, true)).toEqual({ dot: 2, unit: 4 / 3, compact: true });
    for (const [w, h, dpr] of [
      [1280, 720, 1],
      [1366, 768, 1],
      [1920, 1080, 1],
      [2560, 1440, 1],
      [2560, 1440, 2],
      [844, 390, 3],
      [1024, 600, 2],
      [667, 375, 2],
      // Fractional scaling (Windows 125–175 %, Android): whole device pixels too.
      [1463, 836, 1.75],
      [1536, 864, 1.25],
      [1280, 720, 1.5],
      [412, 915, 2.625],
    ] as const) {
      const s = uiScales(w, h, dpr, false);
      expect(SHEET.width * s.dot).toBeLessThanOrEqual(w);
      expect(SHEET.height * s.dot).toBeLessThanOrEqual(h);
      expect(256 * s.unit).toBeLessThanOrEqual(w);
      expect(192 * s.unit).toBeLessThanOrEqual(h);
      expect(Number.isInteger(Math.round(s.dot * dpr * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(s.unit * dpr * 1e6) / 1e6)).toBe(true);
    }
  });

  it('everything stays on screen across sizes; the panel stays inside the field view', () => {
    for (const [w, h] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [844, 390],
      [1280, 720],
      [1920, 1080],
    ] as const) {
      for (const controls of [false, true]) {
        const l = computeLayout(w, h, { controls });
        expect(inside(l.main, w, h)).toBe(true);
        expect(inside(l.panel, l.main.width, l.main.height)).toBe(true);
        if (l.controls) {
          const rects = [l.controls.dpad, l.controls.buttons, l.controls.select, l.controls.start];
          for (const r of rects) expect(inside(r, w, h)).toBe(true);
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
        }
      }
    }
  });
});

describe('input', () => {
  it('maps the documented keys', () => {
    expect(KEY_MAP.ArrowUp).toBe('up');
    expect(KEY_MAP.KeyW).toBe('up');
    expect(KEY_MAP.KeyZ).toBe('a');
    expect(KEY_MAP.KeyX).toBe('b');
    expect(KEY_MAP.Enter).toBe('start');
    expect(KEY_MAP.Backspace).toBe('select');
  });

  it('held and pressed across frames', () => {
    const s = new InputState();
    s.set('keyboard', 'up', true);
    expect(s.frame()).toEqual({ held: ['up'], pressed: ['up'], touch: null });
    expect(s.frame()).toEqual({ held: ['up'], pressed: [], touch: null });
    s.set('keyboard', 'up', false);
    expect(s.frame().held).toEqual([]);
  });

  it('a tap shorter than a tick still produces one pressed frame', () => {
    const s = new InputState();
    s.set('screen-a', 'a', true);
    s.set('screen-a', 'a', false);
    expect(s.frame()).toEqual({ held: ['a'], pressed: ['a'], touch: null });
    expect(s.frame().held).toEqual([]);
  });

  it('a button is held while any source holds it', () => {
    const s = new InputState();
    s.set('keyboard', 'a', true);
    s.set('bridge', 'a', true);
    s.frame();
    s.set('keyboard', 'a', false);
    expect(s.frame().held).toEqual(['a']);
    s.clear('bridge');
    expect(s.frame().held).toEqual([]);
  });

  it('frames list buttons in canonical order', () => {
    const s = new InputState();
    s.set('k', 'start', true);
    s.set('k', 'a', true);
    s.set('k', 'left', true);
    expect(s.frame().held).toEqual(['left', 'a', 'start']);
  });

  it('touch passes through, and a quick tap is latched for one frame', () => {
    const s = new InputState();
    s.setTouch('panel', { x: 10, y: 20 });
    expect(s.frame().touch).toEqual({ x: 10, y: 20 });
    s.setTouch('panel', null);
    expect(s.frame().touch).toBeNull();
    s.setTouch('panel', { x: 1, y: 2 });
    s.setTouch('panel', null);
    expect(s.frame().touch).toEqual({ x: 1, y: 2 });
    expect(s.frame().touch).toBeNull();
  });

  it('polled sources report newly held buttons as pressed', () => {
    const s = new InputState();
    s.setAll('gamepad', ['a']);
    expect(s.frame().pressed).toEqual(['a']);
    s.setAll('gamepad', ['a']);
    expect(s.frame().pressed).toEqual([]);
  });

  it('maps a standard gamepad positionally and ignores unknown mappings', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
    buttons[1] = { pressed: true };
    buttons[0] = { pressed: true };
    buttons[9] = { pressed: true };
    expect(gamepadButtons({ mapping: 'standard', buttons, axes: [-0.9, 0.2] })).toEqual(['left', 'a', 'b', 'start']);
    expect(gamepadButtons({ mapping: 'standard', buttons: [], axes: [0.4, 0.6] })).toEqual(['down']);
    expect(gamepadButtons({ mapping: '', buttons, axes: [-1, 0] })).toEqual([]);
  });
});

describe('panel', () => {
  it('maps client coordinates to panel coordinates at any scale', () => {
    const box = { left: 100, top: 50, width: 512, height: 384 };
    expect(toPanelPoint(100, 50, box)).toEqual({ x: 0, y: 0 });
    expect(toPanelPoint(611.9, 433.9, box)).toEqual({ x: 255, y: 191 });
    expect(toPanelPoint(356, 242, box)).toEqual({ x: 128, y: 96 });
    expect(toPanelPoint(99, 60, box)).toBeNull();
    expect(toPanelPoint(612, 60, box)).toBeNull();
  });

  it('choice options are large, stacked, inside the panel', () => {
    for (let n = 1; n <= 6; n++) {
      const rects = choiceRects(n);
      expect(rects).toHaveLength(n);
      for (const r of rects) {
        expect(inside(r, 256, 192)).toBe(true);
        expect(r.height).toBeGreaterThanOrEqual(20);
      }
      for (let i = 1; i < n; i++) expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.height);
    }
  });

  it('hit-tests choice options', () => {
    const view: PanelView = { kind: 'choice', title: 't', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], cursor: 0 };
    const [first, second] = choiceRects(2);
    expect(hitChoice(view, { x: first!.x + 1, y: first!.y + 1 })).toBe(0);
    expect(hitChoice(view, { x: 128, y: second!.y + second!.height - 1 })).toBe(1);
    expect(hitChoice(view, { x: 0, y: 0 })).toBe(-1);
    expect(hitChoice({ kind: 'idle', title: 't' }, { x: 128, y: 96 })).toBe(-1);
  });
});

describe('loop clock', () => {
  it('accumulates fixed 30 Hz ticks with an interpolation alpha', () => {
    let s = stepClock(0, 16);
    expect(s.ticks).toBe(0);
    expect(s.alpha).toBeCloseTo(16 / TICK_MS);
    s = stepClock(s.accumulator, 20);
    expect(s.ticks).toBe(1);
    expect(s.accumulator).toBeCloseTo(36 - TICK_MS);
  });

  it('caps catch-up after a stall and ignores negative time', () => {
    expect(stepClock(0, 10_000).ticks).toBe(MAX_CATCH_UP);
    expect(stepClock(0, 10_000).capped).toBe(300 - MAX_CATCH_UP);
    expect(stepClock(5, -100)).toEqual({ ticks: 0, capped: 0, accumulator: 5, alpha: 5 / TICK_MS });
  });
});

describe('ROM boundary', () => {
  it('rejects implausible sizes before reading', () => {
    expect(checkRomSize(100)).toMatch(/too small/);
    expect(checkRomSize(600 * 1024 * 1024)).toMatch(/too large/);
    expect(checkRomSize(128 * 1024 * 1024)).toBeNull();
  });

  it('rejects an unsupported ROM and reports its hash and game code', async () => {
    const bytes = new Uint8Array(0x4000);
    bytes.set(new TextEncoder().encode('TESTGAME\0\0\0\0ABCD'), 0);
    const r = await verifyRom(bytes);
    expect(r.ok).toBe(false);
    expect(r.sha1).toMatch(/^[0-9a-f]{40}$/);
    if (!r.ok) expect(r.message).toMatch(/not supported \(game code ABCD/);
  });
});

describe('overlay touches (scripted menus)', () => {
  it('maps a client point to the bottom-centred DS frame the overlay draws in', () => {
    // 1280×720 CSS px at dpr 2 → canvas 2560×1440, scale 7: frame 1792×1344 device px at (378, 91).
    const box = { left: 0, top: 0, width: 1280, height: 720 };
    const canvas = { width: 2560, height: 1440 };
    const frame = bottomFrame(canvas, 7);
    expect(frame).toEqual({ x: 378, y: 91, scale: 7 });
    expect(toOverlayPoint(192, 48, box, canvas, frame)).toEqual({ x: 0, y: 0 });
    expect(toOverlayPoint(192 + 128 * 3.5, 48 + 96 * 3.5, box, canvas, frame)).toEqual({ x: 128, y: 96 });
    expect(toOverlayPoint(100, 300, box, canvas, frame)).toBeNull();
  });

  it('maps a client point to a frame placed elsewhere (a frontier scene centred in the room)', () => {
    const box = { left: 0, top: 0, width: 400, height: 600 };
    const canvas = { width: 800, height: 1200 };
    const frame = { x: 10, y: 500, scale: 4 };
    expect(toOverlayPoint(5, 250, box, canvas, frame)).toEqual({ x: 0, y: 0 });
    expect(toOverlayPoint(5, 249.5, box, canvas, frame)).toBeNull();
    expect(toOverlayPoint(5 + 192, 250 + 192, box, canvas, frame)).toEqual({ x: 96, y: 96 });
  });
});
