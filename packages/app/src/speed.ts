/**
 * Fast-forward: the game runs at the chosen fast speed while a fast-forward key or button is held (Tab, the
 * gamepad's right trigger) or while it is latched (backtick, the phone's HUD button). The fast speed is an
 * app setting of this device (localStorage), not a DS option and not in the save. Presentation only: the
 * loop runs more of the same ticks (loop.ts), the synth's sequencer follows (packages/audio engine `speed`).
 */
export const SPEED_KEY = 'lantern-nds:speed'; // pre-rename name, kept: players' stored data uses it
export const FAST_SPEEDS = [2, 3, 4, 8] as const;
export type FastSpeed = (typeof FAST_SPEEDS)[number];
export const DEFAULT_FAST_SPEED: FastSpeed = 2;

/** A stored fast speed, validated (device data): missing or unreadable is the default. */
export function parseFastSpeed(raw: string | null): FastSpeed {
  try {
    const v = JSON.parse(raw ?? 'null') as unknown;
    if (FAST_SPEEDS.includes(v as FastSpeed)) return v as FastSpeed;
  } catch {
    // Not JSON: the default.
  }
  return DEFAULT_FAST_SPEED;
}

export function readFastSpeed(): FastSpeed {
  try {
    return parseFastSpeed(localStorage.getItem(SPEED_KEY));
  } catch {
    return DEFAULT_FAST_SPEED; // Blocked storage.
  }
}

/** Stores the fast speed; returns the error message when storage refuses (private mode). */
export function storeFastSpeed(speed: FastSpeed): string | null {
  try {
    localStorage.setItem(SPEED_KEY, JSON.stringify(speed));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Who asks for fast-forward now: held sources (keys, pads) and the latch. */
export class FastForward {
  private readonly held = new Set<string>();
  latched = false;
  constructor(public fast: FastSpeed) {}

  hold(source: string, down: boolean): void {
    if (down) this.held.add(source);
    else this.held.delete(source);
  }

  get active(): boolean {
    return this.latched || this.held.size > 0;
  }

  /** The game speed asked for: the fast speed while active, else 1. */
  speed(): number {
    return this.active ? this.fast : 1;
  }
}
