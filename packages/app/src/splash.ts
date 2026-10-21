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

export type SplashPhase = 'data' | 'game' | 'graphics';

/** Each phase: its label and the hint after its time (a slow phone at 4x CPU takes up to a third of it). */
const PHASES: Record<SplashPhase, [label: string, slow: string, ms: number]> = {
  data: ['Reading your game data…', 'Reading your game data is taking longer than usual. If OpenSinnoh is open in another tab, close it, then reload.', 20_000],
  game: ['Loading game…', 'Loading is taking longer than usual. Check your connection, then reload.', 30_000],
  graphics: ['Preparing graphics…', 'Preparing graphics is taking longer than usual. Reload to try again.', 30_000],
};

export function splashPhase(phase: SplashPhase): void {
  window.openSinnohSplash.phase(...PHASES[phase]);
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
