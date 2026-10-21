import { BUTTONS, type Button } from '@opensinnoh/core';
import type { InputFrame } from '@opensinnoh/contracts';

/** Buttons held now but not last tick, in BUTTONS order. */
export function computePressed(held: ReadonlySet<Button>, previous: ReadonlySet<Button>): Button[] {
  return BUTTONS.filter((b) => held.has(b) && !previous.has(b));
}

/** Decomp OPTIONS_BUTTON_MODE_*: the saved BUTTON MODE option's values. */
export const BUTTON_MODE = { normal: 0, startIsX: 1, lIsA: 2 } as const;

/**
 * Decomp ApplyButtonModeToInput (system.c), applied to every frame as the DS applies it to every key read:
 * START=X adds X wherever Start is down (Start stays); L=A adds A for L, and L and R read as up.
 */
export function applyButtonMode(frame: InputFrame, mode: number): InputFrame {
  if (mode === BUTTON_MODE.normal) return frame;
  const map = (list: readonly Button[]): Button[] => {
    const out = new Set(list);
    if (mode === BUTTON_MODE.startIsX && out.has('start')) out.add('x');
    if (mode === BUTTON_MODE.lIsA) {
      if (out.has('l')) out.add('a');
      out.delete('l');
      out.delete('r');
    }
    return BUTTONS.filter((b) => out.has(b));
  };
  return { ...frame, held: map(frame.held), pressed: map(frame.pressed) };
}

/** Raw input between ticks (press/release/touch), sampled once per tick into an InputFrame. */
export class InputState {
  private held = new Set<Button>();
  private previous = new Set<Button>();
  private touchPoint: { x: number; y: number } | null = null;
  private tapId: string | null = null;

  /** A tap on the open menu app, delivered with the next sample only. */
  tap(id: string): void {
    this.tapId = id;
  }

  press(button: Button): void {
    this.held.add(button);
  }

  release(button: Button): void {
    this.held.delete(button);
  }

  touch(x: number, y: number): void {
    this.touchPoint = { x, y };
  }

  untouch(): void {
    this.touchPoint = null;
  }

  /** Samples the frame for this tick and remembers `held` for the next `pressed`. */
  sample(): InputFrame {
    const frame: InputFrame = {
      held: BUTTONS.filter((b) => this.held.has(b)),
      pressed: computePressed(this.held, this.previous),
      touch: this.touchPoint ? { ...this.touchPoint } : null,
      ...(this.tapId !== null ? { tap: this.tapId } : {}),
    };
    this.previous = new Set(this.held);
    this.tapId = null;
    return frame;
  }

  clear(): void {
    this.held.clear();
    this.previous.clear();
    this.touchPoint = null;
    this.tapId = null;
  }
}
