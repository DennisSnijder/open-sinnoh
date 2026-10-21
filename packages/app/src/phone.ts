/**
 * Phone settings of this device (localStorage, never in the save): the touch controls' size and opacity,
 * haptics and keeping the screen on. Plus the platform bits behind them, each feature-detected with no fallback
 * pretending: `navigator.vibrate` (Safari has none), the Screen Wake Lock API and the Fullscreen API (iPhone
 * Safari has no page fullscreen: the installed app is the answer there).
 */
export const PHONE_KEY = 'lantern-nds:phone'; // pre-rename name, kept: players' stored data uses it

/** The touch controls' sizes (labels shown in Options) and what each scales the base boxes (layout.ts) by. */
export const CONTROL_SIZES = [
  { label: 'S', scale: 0.8 },
  { label: 'M', scale: 1 },
  { label: 'L', scale: 1.25 },
] as const;

export interface PhoneSettings {
  /** An index into `CONTROL_SIZES`. */
  size: number;
  /** The controls' opacity in percent, 10 to 100. */
  opacity: number;
  haptics: boolean;
  keepAwake: boolean;
}

/** The slider has ten cells of 10 %: the lowest (0) is kept at `OPACITY_MIN`, so the controls never vanish. */
export const OPACITY_RANGE = { min: 0, max: 100, step: 10 } as const;
export const OPACITY_MIN = 10;
export const DEFAULT_PHONE: PhoneSettings = { size: 1, opacity: 100, haptics: true, keepAwake: true };

/** Stored settings, validated (device data): each field that is missing or unreadable is its default. */
export function parsePhone(raw: string | null): PhoneSettings {
  const out = { ...DEFAULT_PHONE };
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<PhoneSettings> | null;
    if (v && Number.isInteger(v.size) && v.size! >= 0 && v.size! < CONTROL_SIZES.length) out.size = v.size!;
    if (v && Number.isInteger(v.opacity) && v.opacity! >= OPACITY_MIN && v.opacity! <= OPACITY_RANGE.max) out.opacity = v.opacity!;
    if (v && typeof v.haptics === 'boolean') out.haptics = v.haptics;
    if (v && typeof v.keepAwake === 'boolean') out.keepAwake = v.keepAwake;
  } catch {
    // Not JSON: the defaults.
  }
  return out;
}

export function readPhone(): PhoneSettings {
  try {
    return parsePhone(localStorage.getItem(PHONE_KEY));
  } catch {
    return { ...DEFAULT_PHONE }; // Blocked storage.
  }
}

/** Stores the settings; returns the error message when storage refuses (private mode). */
export function storePhone(p: PhoneSettings): string | null {
  try {
    localStorage.setItem(PHONE_KEY, JSON.stringify(p));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const hidden = (): boolean => document.visibilityState === 'hidden';
export const hapticsSupported = (): boolean => typeof navigator.vibrate === 'function';
export const wakeLockSupported = (): boolean => typeof (navigator as { wakeLock?: WakeLock }).wakeLock?.request === 'function';
/** The page can go fullscreen (not iPhone Safari). */
export const fullscreenSupported = (): boolean => document.fullscreenEnabled === true;
/** Running as an installed app: already without the browser's bars. */
export const standalone = (): boolean => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** A short tick for a control press (Android and desktop Chrome; Safari has no vibration API). */
export const HAPTIC_MS = 12;

/**
 * Holds a screen wake lock while `hold(true)` and the page is visible. The browser releases the lock itself when
 * the page is hidden, so it is taken again on `show()`. A refused request (low battery, policy) is reported
 * through `onError`, then tried again at the next `hold`/`show`.
 */
export class ScreenAwake {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private pending = false;
  constructor(private readonly onError: (message: string) => void) {}

  get held(): boolean {
    return this.sentinel !== null;
  }

  hold(wanted: boolean): void {
    this.wanted = wanted;
    if (wanted) void this.acquire();
    else this.release();
  }

  /** The page became visible again. */
  show(): void {
    if (this.wanted) void this.acquire();
  }

  /** The page was hidden: the browser has released the lock (or will); drop our handle. */
  hide(): void {
    this.release();
  }

  private async acquire(): Promise<void> {
    if (!wakeLockSupported() || this.sentinel || this.pending || hidden()) return;
    this.pending = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      this.pending = false;
      // Asked to release while the request was in flight.
      if (!this.wanted || hidden()) return void s.release();
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
    } catch (e) {
      this.pending = false;
      this.onError(`the screen wake lock was refused: ${(e as Error).message}`);
    }
  }

  private release(): void {
    const s = this.sentinel;
    this.sentinel = null;
    void s?.release();
  }
}
