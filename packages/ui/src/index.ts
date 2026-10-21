/**
 * @opensinnoh/ui: OpenSinnoh UI v0.7, the design system for OpenSinnoh's own screens and opensinnoh.com
 * (docs/design-system.md). Tokens (tokens.json → tokens.ts), base and component CSS (os.css), icons and DOM
 * components. It never styles ROM-drawn windows or game text: those are the engine's.
 */
import './fonts.css';
import './os.css';
import { tokensCss, WINDOW_FRAMES } from './tokens.ts';

export * from './tokens.ts';
export * from './icons.ts';
export * from './brand.ts';
export * from './components.ts';

export type ThemeMode = 'system' | 'dark' | 'light';
export const THEME_KEY = 'lantern-nds:theme'; // pre-rename name, kept: players' stored data uses it

/** The stored theme override ('system' when none, or storage is unavailable). */
export function themeMode(): ThemeMode {
  let v: string | null = null;
  try {
    v = localStorage.getItem(THEME_KEY);
  } catch {
    // Storage blocked: the system theme applies (this is a preference, not data).
  }
  return v === 'dark' || v === 'light' ? v : 'system';
}

/** Sets the theme on the page: the system's, or an override kept on this device. */
export function setThemeMode(mode: ThemeMode): void {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = mode;
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Kept for this visit only.
  }
}

export const FRAME_KEY = 'lantern-nds:ui-frame'; // pre-rename name, kept: players' stored data uses it

/** The stored window frame (Distortion when none, or storage is unavailable). */
export function frameMode(): string {
  let v: string | null = null;
  try {
    v = localStorage.getItem(FRAME_KEY);
  } catch {
    // Storage blocked: the default frame applies (a preference, not data).
  }
  return v && WINDOW_FRAMES.includes(v) ? v : 'distortion';
}

/** Sets the frame of every OpenSinnoh window on the page (`data-os-frame`), kept on this device. */
export function setFrameMode(frame: string): void {
  if (!WINDOW_FRAMES.includes(frame)) throw new Error(`ui: no window frame ${frame}`);
  if (frame === 'distortion') document.documentElement.removeAttribute('data-os-frame');
  else document.documentElement.dataset.osFrame = frame;
  try {
    if (frame === 'distortion') localStorage.removeItem(FRAME_KEY);
    else localStorage.setItem(FRAME_KEY, frame);
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Installs the system on the page, once: the generated token stylesheet, the stored theme and frame and the
 * density (`:root[data-density]`): a key or a gamepad switches to d-pad, a touch to touch; a mouse never
 * switches, and compatibility mouse events after a touch are ignored because only pointerType touch counts.
 */
export function installUi(): void {
  if (document.getElementById('os-tokens')) return;
  const style = document.createElement('style');
  style.id = 'os-tokens';
  style.textContent = tokensCss();
  document.head.append(style);
  const mode = themeMode();
  if (mode !== 'system') document.documentElement.dataset.theme = mode;
  const frame = frameMode();
  if (frame !== 'distortion') document.documentElement.dataset.osFrame = frame;
  const root = document.documentElement;
  const set = (d: 'dpad' | 'touch') => root.dataset.density !== d && (root.dataset.density = d);
  set(matchMedia('(pointer: coarse)').matches ? 'touch' : 'dpad');
  addEventListener('keydown', () => set('dpad'), true);
  addEventListener('gamepadconnected', () => set('dpad'));
  addEventListener('pointerdown', (e) => e.pointerType === 'touch' && set('touch'), true);
}

/** The pixel-art elements the whole-pixel rule covers. */
export const PIXEL_SELECTOR = '.os-win, .os-btn, .os-tab, .os-file.quiet, .os-ico, .os-cnt, .os-bdg, .os-tgl .tr, .os-sld .cell, .os-prog .cells i, .os-brand';

/**
 * The snap pass: moves any pixel-art element with a fractional position onto the whole CSS pixel with the
 * `translate` property (transform animations stay free). Run after layout, on resize and after a redraw.
 */
export function snapPixels(root: ParentNode = document): void {
  // Positions are measured without running transform animations (a window opening): snap once they end. The
  // brand intro only shows pixels (it moves nothing), so it is not waited for.
  const moving = (a: Animation) => !((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest('.os-brand');
  const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity && moving(a));
  if (running.length) {
    void Promise.allSettled(running.map((a) => a.finished)).then(() => snapPixels(root));
    return;
  }
  const els = [...root.querySelectorAll<HTMLElement | SVGElement>(PIXEL_SELECTOR)].filter((e) => e.getClientRects().length);
  for (const e of els) e.style.translate = '';
  for (const e of els) {
    const r = e.getBoundingClientRect();
    const dx = Math.round(r.left) - r.left;
    const dy = Math.round(r.top) - r.top;
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) e.style.translate = `${+dx.toFixed(3)}px ${+dy.toFixed(3)}px`;
  }
}
