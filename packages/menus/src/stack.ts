/**
 * The app stack: one `AppModel` holding a stack of screens (the start menu pushes the bag, party, …).
 * Input is the field's `InputFrame`: pressed buttons, the d-pad held with auto-repeat, and taps by id.
 * Each tick at most the frame's own presses (plus one repeat) reach the top screen, in BUTTONS order.
 */
import type { Button } from '@opensinnoh/core';
import type { AppModel, AppResult, AppView, InputFrame } from '@opensinnoh/contracts';

/** Held d-pad auto-repeat, in 30 Hz ticks: the first repeat, then every (decomp SetAutorepeat(4, 8), counted by ReadKeypadAndTouchpad once a tick). */
export const REPEAT_DELAY = 8;
export const REPEAT_EVERY = 4;
const DIRS: readonly Button[] = ['up', 'down', 'left', 'right'];

/** What a screen asks of the stack after an input. */
export type Step = { push: Screen } | 'pop' | { close: AppResult } | undefined;

export interface Screen {
  view(): AppView;
  /** One button press (auto-repeated d-pad included) or a tap on an element of the view. */
  input(i: { button: Button } | { tap: string }): Step;
  /**
   * Once per tick, before the input, with the tick's frame: screens that run on their own (the hatch and
   * evolution scenes). The evolution scene reads its presses and taps here and ignores `input`.
   */
  tick?(f: InputFrame): Step;
  /** Called when the screen above it has popped: what to do now (the party closes after an evolution). */
  resume?(): Step;
}

export class AppStack implements AppModel {
  private readonly screens: Screen[];
  private held: Button | null = null;
  private heldFor = 0;

  constructor(
    root: Screen,
    private readonly result: AppResult,
  ) {
    this.screens = [root];
  }

  view(): AppView {
    return this.screens.at(-1)!.view();
  }

  step(frame: InputFrame): AppResult | null {
    const ticked = this.apply(this.screens.at(-1)!.tick?.(frame));
    if (ticked) return ticked.result;
    const inputs: ({ button: Button } | { tap: string })[] = frame.pressed.map((button) => ({ button }));
    const dir = DIRS.find((d) => frame.held.includes(d)) ?? null;
    if (dir !== this.held) {
      this.held = dir;
      this.heldFor = 0;
    } else if (dir) {
      this.heldFor++;
      if (this.heldFor >= REPEAT_DELAY && (this.heldFor - REPEAT_DELAY) % REPEAT_EVERY === 0) inputs.push({ button: dir });
    }
    if (frame.tap !== undefined) inputs.push({ tap: frame.tap });
    for (const i of inputs) {
      const done = this.apply(this.screens.at(-1)!.input(i));
      if (done) return done.result;
    }
    return null;
  }

  /** Applies a screen's step; `{ result }` when the app closes. */
  private apply(step: Step): { result: AppResult } | null {
    if (step === undefined) return null;
    if (step === 'pop') {
      this.screens.pop();
      if (!this.screens.length) return { result: this.result };
      return this.apply(this.screens.at(-1)!.resume?.());
    }
    if ('push' in step) {
      this.screens.push(step.push);
      return null;
    }
    return { result: step.close };
  }
}

/** Moves a cursor in a grid of `count` stops with `columns` columns (lists wrap, grids stop at edges). */
export function moveCursor(cursor: number, count: number, columns: number, dir: Button): number {
  if (count === 0) return 0;
  if (columns <= 1) {
    if (dir === 'up') return (cursor - 1 + count) % count;
    if (dir === 'down') return (cursor + 1) % count;
    return cursor;
  }
  const col = cursor % columns;
  if (dir === 'left') return col > 0 ? cursor - 1 : cursor;
  if (dir === 'right') return col < columns - 1 && cursor + 1 < count ? cursor + 1 : cursor;
  if (dir === 'up') return cursor - columns >= 0 ? cursor - columns : cursor;
  if (dir === 'down') {
    if (cursor + columns < count) return cursor + columns;
    // From the row above a short last row, drop onto its last stop (e.g. a lone CANCEL).
    const lastRowStart = count - 1 - ((count - 1) % columns);
    return cursor < lastRowStart ? count - 1 : cursor;
  }
  return cursor;
}

/** `name:<n>` → n (a tap id with an index), or null. */
export function tapIndex(tap: string, name: string): number | null {
  const m = new RegExp(`^${name}:(-?\\d+)$`).exec(tap);
  return m ? Number(m[1]) : null;
}

/** Decomp sub_0208C15C: up +1 and down −1 wrap between 1 and max; right +10 and left −10 stop at the ends. */
export function stepCount(count: number, max: number, b: Button): number {
  if (b === 'up') return count + 1 > max ? 1 : count + 1;
  if (b === 'down') return count - 1 < 1 ? max : count - 1;
  if (b === 'right') return Math.min(max, count + 10);
  if (b === 'left') return Math.max(1, count - 10);
  return count;
}
