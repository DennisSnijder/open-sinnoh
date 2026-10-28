/**
 * The startup splash (index.html `#splash`, drawn before any script): the app names each phase of the start on it
 * and ends it once its first real screen is on screen (the title's first frame, the ROM page, the crash screen).
 * A phase that runs past its time shows its hint with a Reload (the page's script keeps the timer). Each phase also
 * leaves a `splash: <label>` performance mark, for timing the start.
 */
interface SplashApi {
  phase(label: string, slow: string, ms: number): void;
  done(fade: boolean): void;
}

declare global {
  interface Window {
    openSinnohSplash: SplashApi;
  }
}

import { S } from './strings/index.ts';

export type SplashPhase = 'data' | 'game' | 'graphics';

/** Each phase's time before its hint shows (a slow phone at 4x CPU takes up to a third of it); its label and hint are `S.splash`'s. */
const PHASE_MS: Record<SplashPhase, number> = { data: 20_000, game: 30_000, graphics: 30_000 };

export function splashPhase(phase: SplashPhase): void {
  window.openSinnohSplash.phase(...S.splash[phase], PHASE_MS[phase]);
}

/**
 * Ends the splash. `fade`: it fades out over the next 15 frames (the title fading in from black under it), once
 * the frame being drawn now is on screen; otherwise it goes at once, for a screen that is already in the page.
 */
export function splashDone(fade = false): void {
  if (!fade) return window.openSinnohSplash.done(false);
  // Two frames: the first runs before the screen's first draw, the second after that frame was presented.
  requestAnimationFrame(() => requestAnimationFrame(() => window.openSinnohSplash.done(true)));
}
