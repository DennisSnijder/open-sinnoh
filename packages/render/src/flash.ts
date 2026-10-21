/**
 * "Reduce flashing": one presentation setting (`setReduceFlashing`, the app's Options › Device) that dampens the
 * screen flashes and white fades drawn over the field, the battle and the story scenes. It changes only what is
 * painted: the world, the battle, the scripts and their timing never read it, so replays and saves are the
 * same. A white overlay is capped at `FLASH_CAP` of full white and, where it is drawn every display frame
 * (`FlashLimiter`), eased at no more than `FLASH_SLEW` per second, so a strobe becomes a soft swell. Black
 * fades are not flashes and stay as they are.
 */

/** The most a white overlay may show while flashing is reduced (0 clear, 1 full white). */
export const FLASH_CAP = 0.25;
/** The fastest a white overlay may change while flashing is reduced, in alpha per second (0 to the cap in about 150 ms). */
export const FLASH_SLEW = 1.6;

let reduce = false;

export const setReduceFlashing = (on: boolean): void => {
  reduce = on;
};

export const reduceFlashing = (): boolean => reduce;

/** A white overlay's alpha, capped when flashing is reduced (for draws that are not made every display frame). */
export const capFlash = (alpha: number): number => (reduce ? Math.min(alpha, FLASH_CAP) : alpha);

/** Eases one white overlay frame by frame: the cap, then the slew. Off, it passes the alpha through. */
export class FlashLimiter {
  private level = 0;
  private at = 0;

  /** The alpha to draw for the wanted `alpha` at time `now` (ms). */
  apply(alpha: number, now = performance.now()): number {
    const dt = Math.min(Math.max(0, now - this.at) / 1000, 0.1);
    this.at = now;
    if (!reduce) return (this.level = alpha);
    const goal = Math.min(alpha, FLASH_CAP);
    const step = FLASH_SLEW * dt;
    this.level += Math.max(-step, Math.min(step, goal - this.level));
    return this.level;
  }

  /** A fade of `color`: white is limited, black passes (and lets the white level settle). */
  fade(color: 'white' | 'black', alpha: number, now = performance.now()): number {
    if (color === 'white') return this.apply(alpha, now);
    this.apply(0, now);
    return alpha;
  }
}
