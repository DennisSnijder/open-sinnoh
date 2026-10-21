/**
 * Title screen timings (decomp src/applications/title_screen.c), in 30 Hz frames. Pure functions of the
 * frame number, so the screen is deterministic and unit-tested.
 *
 * The title opens straight on the finished scene with a short fade from black (the DS intro's flashes,
 * grey logo and camera move are left out); "press start" blinks (16 on, 16 off). Start or A fires the
 * exit: 10 frames, then a 6-frame fade to white.
 */

/** The fade in from black when the title opens, frames. */
export const FADE_IN = 15;

/** "Press start" layer on for 16 frames, off for 16 (TitleScreen_RenderMain blink counter). */
export const promptOn = (framesSinceDone: number): boolean => (framesSinceDone & 31) < 16;

/** Exit after Start: the fade to white from frame 10 over 6 frames. */
export const EXIT_DELAY = 10;
export const EXIT_FADE = 6;
export function exitBrightness(framesSincePress: number): number {
  return Math.min(16, Math.max(0, Math.round((16 * (framesSincePress - EXIT_DELAY)) / EXIT_FADE)));
}

/**
 * Giratina's hover (TitleScreen_Render): each frame the angle steps 2°, the sine is taken of
 * (angle · 0xFFFF / 360) mod 360 degrees (a decomp-noted bug that shortens the range), × 0.3 truncated
 * in fx32, and subtracted from y. Returns y for frame `n` (one 180-frame angle cycle, repeated).
 */
const HOVER: number[] = (() => {
  const out: number[] = [];
  let angle = 0;
  let y = 0;
  for (let n = 0; n < 180; n++) {
    out.push(y);
    angle = (angle + 2) % 360;
    const deg = Math.floor((angle * 0xffff) / 360) % 360;
    y -= Math.trunc(Math.round(Math.sin((deg * Math.PI) / 180) * 4096) * 0.3) / 4096;
  }
  return out;
})();

export const hoverY = (n: number): number => HOVER[((n % 180) + 180) % 180]!;

/** The focused main-menu window's frame colour cycle (decomp sFocusedOptionBorderColors), one step a frame. */
export const FOCUS_CYCLE: readonly [number, number, number][] = Array.from({ length: 30 }, (_, i) => [i <= 15 ? 1 + 2 * i : 61 - 2 * i, 28, 20]);
