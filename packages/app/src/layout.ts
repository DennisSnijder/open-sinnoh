/**
 * Single-screen layout math (CSS pixels). Pure, so it is unit-tested.
 * - The main (field) view always fills the screen. On a portrait touch device the on-screen controls
 *   take a strip under it; in landscape they float over the bottom corners of the view. Either way the
 *   controls stay clear of the safe-area insets (notch, home indicator), at the sizes `controlMetrics`
 *   gives (style.css draws them at the same sizes).
 * - The DS bottom screen is not a second screen: the touch panel is a card drawn over the field view,
 *   shown only while it has content (e.g. a choice). It sits above the message box area, centred.
 * The panel scale is an integer when that keeps at least 80% of the size that fits, else the fit.
 */
import { PANEL_HEIGHT, PANEL_WIDTH } from '@opensinnoh/contracts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  mode: 'portrait' | 'landscape';
  main: Rect;
  /** Where the panel card goes when it is shown. */
  panel: Rect & { scale: number };
  /**
   * Portrait: the d-pad and the diamond mirrored about the centre line on one row, Select and Start centred under
   * them, the whole set centred in its strip (equal drawn margins above and below). Landscape: a column in each
   * bottom corner, the d-pad over Select and the diamond over Start, mirrored.
   */
  controls: ControlRects | null;
  /** The in-game UI's scales (CSS px, whole device pixels): see `uiScales`, computed for `room`. */
  ui: UiScales;
  /**
   * Insets of the main view that menu screens keep clear (CSS px): the side columns of the landscape controls
   * (the d-pad's and the buttons' widths, the same on both sides so a screen centred in the room is centred in
   * the view) and, in portrait, the HUD's row at the top. The HUD buttons sit outside the room: top right, or in
   * landscape with controls top left above the d-pad. The backdrop of a screen still covers the whole view.
   */
  room: Insets;
  /**
   * The part of `main` clear of the notch and the home indicator (the safe-area insets; the controls strip already
   * holds the bottom one). Full-view scenes that compose to the view's edges (the battle) place themselves in it.
   */
  safe: Rect;
}

/**
 * - `unit`: CSS px per DS px for DS-proportioned things (the boards of the DS-art apps, the field windows of
 *   scripts and the mart): the battle window's rule (×3 up to 1080p, ×4 at 1440p; capped and centred on big
 *   screens); views too small for ×3 with a margin fill instead (largest whole-device-pixel fit); phones in
 *   portrait fit the DS width.
 * - `dot`: CSS px per font pixel on the generic sheets (400 × 300 dots, centred): 3 once the unit is 4, else 2,
 *   or what fits on small views. Both are whole device pixels (the nearest that fits at fractional scaling). Phones in portrait (`compact`) get full-screen sheets at 2.
 */
export interface UiScales {
  dot: number;
  unit: number;
  compact: boolean;
}

/** The generic sheet in dots (4:3, as the DS screen). */
export const SHEET = { width: 400, height: 300 } as const;
const DS = { width: 256, height: 192 } as const;
const UI_MARGIN = 24;
const UNIT_MIN = 3;
const UNIT_HEIGHT_SHARE = 0.55;

export function uiScales(width: number, height: number, dpr: number, portrait: boolean): UiScales {
  const whole = (css: number) => Math.max(1, Math.floor(css * dpr + 1e-6)) / dpr;
  // Pixel text snaps to whole device pixels (pixel-font.ts), so the boxes it fills must too: at 175 % a 2-px dot is
  // 3.5 device px, and text drawn at 4 overflows its box. The nearest whole size when it still fits, else the one below.
  const snap = (css: number, ok: (s: number) => boolean) => {
    const near = Math.max(1, Math.round(css * dpr)) / dpr;
    return ok(near) ? near : whole(css);
  };
  const compact = portrait && width < 700;
  const fit = Math.min((width - 2 * UI_MARGIN) / DS.width, (height - 2 * UI_MARGIN) / DS.height);
  const unit =
    compact ? whole(width / DS.width)
    : fit >= UNIT_MIN ? snap(Math.min(Math.floor(fit), Math.max(UNIT_MIN, Math.floor((height * UNIT_HEIGHT_SHARE) / DS.height))), (u) => u <= fit)
    : whole(Math.min(width / DS.width, height / DS.height));
  if (compact) return { dot: whole(2), unit, compact };
  const fits = (dot: number) => SHEET.width * dot <= width - 2 * UI_MARGIN && SHEET.height * dot <= height - 2 * UI_MARGIN;
  const dot = unit >= 4 && fits(3) ? snap(3, fits) : fits(2) ? snap(2, fits) : whole(Math.min(width / SHEET.width, height / SHEET.height));
  return { dot, unit, compact };
}

/** Safe-area insets (CSS `env(safe-area-inset-*)`), in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The touch controls' spacing in CSS px, measured on what is drawn (a pill's visible capsule, not its 44-px hit
 * area): the margin around the controls, the gap between the d-pad and diamond row and the Select/Start pills,
 * and the gap between the two pills.
 */
export const CONTROL_SPACE = 16;
/** Portrait: the narrowest side margin and the smallest gap between the d-pad and the diamond; below them the set shrinks. */
const CONTROL_MIN_SIDE = 8;
const CONTROL_MIN_GAP = 16;
/** The smallest scale the portrait fit goes down to (a window narrower than any phone). */
const CONTROL_MIN_SCALE = 0.5;
const CONTROL_FIT_STEP = 0.05;

/**
 * The touch controls' sizes in CSS px at a scale (Options › Device › Control size; 1 is size M): the d-pad key, the
 * face button, the Select/Start pill's hit area and the inset of its drawn capsule. The gaps around a pill's hit area
 * are what is left of `CONTROL_SPACE` once the capsule's insets are taken off, so the drawn gaps stay the same at every
 * size. style.css reads these as `--c-*` variables, so the layout and the drawing never disagree.
 */
export interface ControlMetrics {
  scale: number;
  key: number;
  face: number;
  pillW: number;
  pillH: number;
  /** The drawn capsule's inset inside the pill's hit area, vertical and horizontal. */
  pillInsetY: number;
  pillInsetX: number;
  /** Hit-area gaps: the row above to the pills, and Select to Start. */
  pillGap: number;
  pillSpace: number;
  dpad: { width: number; height: number };
  buttons: { width: number; height: number };
}

export function controlMetrics(scale = 1): ControlMetrics {
  const key = Math.round(48 * scale);
  const face = Math.round(46 * scale);
  const pillInsetY = Math.round(12 * scale);
  const pillInsetX = Math.round(4 * scale);
  return {
    scale,
    key,
    face,
    pillW: Math.round(64 * scale),
    pillH: Math.round(44 * scale),
    pillInsetY,
    pillInsetX,
    pillGap: CONTROL_SPACE - pillInsetY,
    pillSpace: CONTROL_SPACE - 2 * pillInsetX,
    dpad: { width: 3 * key, height: 3 * key },
    buttons: { width: 3 * face, height: 3 * face },
  };
}

/** The portrait strip under the field view (plus the bottom safe-area inset): margin, d-pad row, gap, drawn pills, margin. */
export function controlsStrip(m: ControlMetrics): number {
  return 3 * CONTROL_SPACE + Math.max(m.dpad.height, m.buttons.height) + m.pillH - 2 * m.pillInsetY;
}
/** The portrait strip at size M. */
export const CONTROLS_STRIP = controlsStrip(controlMetrics(1));

/**
 * Portrait: the side margin of the d-pad (the diamond's mirrors it about the centre line), at most `CONTROL_SPACE`,
 * less on narrow phones to keep `CONTROL_MIN_GAP` between the two.
 */
function portraitSide(safeWidth: number, m: ControlMetrics): number {
  // With the centres mirrored, the gap between them is the width less both margins, 1.5 d-pads and half a diamond.
  return Math.min(CONTROL_SPACE, Math.floor((safeWidth - CONTROL_MIN_GAP - 1.5 * m.dpad.width - 0.5 * m.buttons.width) / 2));
}

/** Portrait: the chosen size, or the largest smaller one (in 0.05 steps) that fits the width (size L on a 320-px phone is M). */
function portraitMetrics(safeWidth: number, scale: number): ControlMetrics {
  let s = scale;
  while (portraitSide(safeWidth, controlMetrics(s)) < CONTROL_MIN_SIDE && s > CONTROL_MIN_SCALE) s = Math.round((s - CONTROL_FIT_STEP) * 100) / 100;
  return controlMetrics(s);
}

/** Where the touch controls go: each rect is the element's hit area, in whole CSS px. */
export interface ControlRects {
  dpad: Rect;
  buttons: Rect;
  select: Rect;
  start: Rect;
  /** The sizes they are drawn at (the chosen size, or smaller where it does not fit). */
  metrics: ControlMetrics;
}

const PANEL_MAX_WIDTH_SHARE = 0.92;
const PANEL_MAX_HEIGHT_SHARE = 0.6;
/** Panel card centre, as a share of the main view's height (leaves the message box at the bottom visible). */
const PANEL_CENTRE = 0.42;
const EDGE = 8;
/** The HUD row (style.css: 8 px margin, 44 px buttons, 8 px gap) that portrait menu screens keep clear. */
export const HUD_BAND = 60;

export function panelScale(maxFit: number): number {
  if (!(maxFit > 0)) throw new Error(`panelScale: bad fit ${maxFit}`);
  const whole = Math.floor(maxFit);
  return whole >= 1 && whole / maxFit >= 0.8 ? whole : maxFit;
}

export function computeLayout(width: number, height: number, opts: { controls: boolean; insets?: Insets; dpr?: number; controlScale?: number }): Layout {
  const mode = height > width ? 'portrait' : 'landscape';
  const insets = opts.insets ?? NO_INSETS;
  const safeWidth = width - insets.left - insets.right;
  const portraitControls = opts.controls && mode === 'portrait';
  const m = portraitControls ? portraitMetrics(safeWidth, opts.controlScale ?? 1) : controlMetrics(opts.controlScale);
  const strip = portraitControls ? controlsStrip(m) + insets.bottom : 0;
  const main: Rect = { x: 0, y: 0, width, height: height - strip };

  const scale = panelScale(Math.min((main.width * PANEL_MAX_WIDTH_SHARE) / PANEL_WIDTH, (main.height * PANEL_MAX_HEIGHT_SHARE) / PANEL_HEIGHT));
  const pw = Math.round(PANEL_WIDTH * scale);
  const ph = Math.round(PANEL_HEIGHT * scale);
  const y = Math.min(Math.max(EDGE, Math.round(main.height * PANEL_CENTRE - ph / 2)), Math.max(EDGE, main.height - ph - EDGE));
  const panel = { x: Math.round((width - pw) / 2), y, width: pw, height: ph, scale };

  let controls: ControlRects | null = null;
  if (opts.controls) {
    const row = Math.max(m.dpad.height, m.buttons.height);
    // The row's top and the d-pad's left edge; everything on the right mirrors the left about `centre2 / 2`.
    let top: number, left: number, centre2: number;
    if (portraitControls) {
      top = main.height + CONTROL_SPACE;
      left = insets.left + portraitSide(safeWidth, m);
      centre2 = 2 * insets.left + safeWidth;
    } else {
      // The pills' drawn bottom sits CONTROL_SPACE above the bottom inset; both sides keep the larger side inset.
      top = height - insets.bottom - controlsStrip(m) + CONTROL_SPACE;
      left = Math.max(insets.left, insets.right) + EDGE;
      centre2 = width;
    }
    const dpad = { x: left, y: top + Math.round((row - m.dpad.height) / 2), ...m.dpad };
    const buttons = { x: Math.round((2 * centre2 - 2 * left - m.dpad.width - m.buttons.width) / 2), y: top + Math.round((row - m.buttons.height) / 2), ...m.buttons };
    const pill = { y: top + row + m.pillGap, width: m.pillW, height: m.pillH };
    // Portrait: the pair centred on the centre line; landscape: Select centred under the d-pad.
    const selectX = portraitControls ? Math.round((centre2 - 2 * m.pillW - m.pillSpace) / 2) : Math.round(left + (m.dpad.width - m.pillW) / 2);
    const startX = portraitControls ? selectX + m.pillW + m.pillSpace : centre2 - selectX - m.pillW;
    controls = { dpad, buttons, select: { x: selectX, ...pill }, start: { x: startX, ...pill }, metrics: m };
  }
  // The landscape columns and an EDGE gap beyond them.
  const side = controls && mode === 'landscape' ? controls.dpad.x + Math.max(m.dpad.width, m.pillW) + EDGE : 0;
  // The room also keeps clear of the notch and the home indicator: the HUD row sits below the top inset, and with
  // no controls strip (which already holds the bottom inset) the bottom inset is kept clear too.
  const across = Math.max(insets.left, insets.right);
  const room: Insets = {
    top: mode === 'portrait' ? Math.max(EDGE, insets.top) + HUD_BAND - EDGE : insets.top,
    right: Math.max(side, across),
    bottom: strip ? 0 : insets.bottom,
    left: Math.max(side, across),
  };
  const ui = uiScales(main.width - room.left - room.right, main.height - room.top - room.bottom, opts.dpr ?? 1, mode === 'portrait');
  const safe: Rect = { x: insets.left, y: insets.top, width: width - insets.left - insets.right, height: main.height - insets.top - (strip ? 0 : insets.bottom) };
  return { mode, main, panel, controls, ui, room, safe };
}

/**
 * Render scale (Options › Device): the field's 3D drawing buffer, in device px per CSS px. Auto caps it at
 * `RENDER_DPR_CAP` on coarse pointers (a phone at DPR 3 fills 2.25× the pixels of DPR 2 for little visible
 * gain, and its GPU is the likely bottleneck); Full always uses the device's ratio. The 2D layers (boxes,
 * menus, the battle) keep whole device pixels either way. An app setting of this device (localStorage).
 */
export type RenderScale = 'auto' | 'full';
export const RENDER_SCALES: readonly RenderScale[] = ['auto', 'full'];
export const RENDER_DPR_CAP = 2;
export const RENDER_SCALE_KEY = 'lantern-nds:render-scale'; // pre-rename name, kept: players' stored data uses it

export function renderPixelRatio(dpr: number, coarse: boolean, scale: RenderScale): number {
  return scale === 'auto' && coarse ? Math.min(dpr, RENDER_DPR_CAP) : dpr;
}

/** The stored render scale (device data): missing or unreadable is Auto. */
export function readRenderScale(): RenderScale {
  try {
    return localStorage.getItem(RENDER_SCALE_KEY) === 'full' ? 'full' : 'auto';
  } catch {
    return 'auto'; // Blocked storage.
  }
}

/** Stores the render scale; returns the error message when storage refuses (private mode). */
export function storeRenderScale(scale: RenderScale): string | null {
  try {
    localStorage.setItem(RENDER_SCALE_KEY, scale);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
