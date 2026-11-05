/**
 * The automatic quality step of the enhanced visuals. A device that cannot hold their cost eases them by one step
 * (`visualStyleConfig`, enhanced/config.ts); the stored style is never touched, so the Options keep showing the
 * player's choice and say that it is eased. Only the enhanced styles are watched: the DS look has nothing to ease.
 *
 * A step is a trial: frames that do not get faster mean something else limits them (a browser capped at 30 fps in low
 * power mode, a busy main thread), so the step is taken back, nothing is said or stored, and the session stops
 * watching. A step that helps is stored and announced. A hand-picked style after that is final: the look is the
 * player's, and this device is not watched again.
 */
export const AUTO_QUALITY_KEY = 'lantern-nds:auto-quality'; // the stored names keep the pre-rename prefix

/** Stored: `eased`, the step helped and stays; `off`, the player chose the full look after it. Absent: watching. */
export type StoredQuality = 'eased' | 'off' | null;

/** Display frames in one measure (about 2 s at 60 Hz, 4 s at 30). */
export const WINDOW_FRAMES = 120;
/** Slow windows in a row before the step. */
const SLOW_WINDOWS = 2;
/** A window's median interval over this is slow: under about 38 fps. */
export const SLOW_MS = 26;
/** Frames left out after the step (programs compile, the buffers resize). */
export const SETTLE_FRAMES = 30;
/** The step helped: the median fell to this share of what it was. */
const HELPED = 0.85;
/** A gap over this is no frame (a stall, a tab switch): the window starts again. */
const GAP_MS = 250;

export type QualityStep = 'ease' | 'keep' | 'revert';

export class AutoQuality {
  private readonly samples: number[] = [];
  private slow = 0;
  private settle = 0;
  /** The median before the step, during its trial. */
  private before: number | null = null;
  private watching: boolean;

  constructor(stored: StoredQuality) {
    this.watching = stored === null;
  }

  /** One drawn display frame's interval. Returns what to do, if anything. */
  frame(ms: number): QualityStep | null {
    if (!this.watching) return null;
    if (ms > GAP_MS) {
      this.samples.length = 0;
      return null;
    }
    if (this.settle > 0) {
      this.settle--;
      return null;
    }
    this.samples.push(ms);
    if (this.samples.length < WINDOW_FRAMES) return null;
    const median = this.samples.sort((a, b) => a - b)[WINDOW_FRAMES >> 1]!;
    this.samples.length = 0;
    if (this.before !== null) {
      this.watching = false;
      return median <= this.before * HELPED ? 'keep' : 'revert';
    }
    this.slow = median > SLOW_MS ? this.slow + 1 : 0;
    if (this.slow < SLOW_WINDOWS) return null;
    this.before = median;
    this.settle = SETTLE_FRAMES;
    return 'ease';
  }

  /** The window so far does not count (a frame that is not the field). */
  skip(): void {
    this.samples.length = 0;
  }

  /** The player picked a style: nothing more to watch this session. */
  stop(): void {
    this.watching = false;
  }
}

export function readStoredQuality(): StoredQuality {
  try {
    const v = localStorage.getItem(AUTO_QUALITY_KEY);
    return v === 'eased' || v === 'off' ? v : null;
  } catch {
    return null; // Blocked storage.
  }
}

/** Blocked storage keeps it for this visit. */
export function storeQuality(v: Exclude<StoredQuality, null>): void {
  try {
    localStorage.setItem(AUTO_QUALITY_KEY, v);
  } catch {
    // Blocked storage.
  }
}
