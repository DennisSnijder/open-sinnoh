/**
 * One input path: every source (keyboard, gamepad, on-screen buttons, panel touch, the replay
 * bridge) writes into an `InputState`, and the loop samples one `InputFrame` per 30 Hz tick.
 *
 * Keyboard and gamepad bindings are the player's (`controls`, controls.ts; Options › Controls). The defaults:
 *   Keyboard (physical keys, `KeyboardEvent.code`, so it works on any layout): D-pad Arrow keys and W A S D;
 *   A Z, J, Space; B X, K; X C; Y V; L Q, Page Up; R E, Page Down; Start Enter; Select Backspace, Right Shift.
 *   Gamepad (W3C "standard" mapping), positional like the DS: right face button = A, bottom = B, top = X,
 *   left = Y; shoulders = L/R; Back/View = Select; Start/Menu = Start; D-pad and the left stick = D-pad.
 *   A pad with another mapping has no defaults: its raw buttons and axes are bound by pressing them.
 *
 * Fast-forward (not a DS button; game-view.ts and speed.ts): the bound key or the right trigger held, backtick toggles.
 * One gamepad is active: the one pressed last.
 */
import { BUTTONS, type Button } from '@opensinnoh/core';
import type { InputFrame } from '@opensinnoh/contracts';
import { Controls, defaultBindings, padHolds, type Bindings, type PadLike } from './controls.ts';

export { KEY_MAP, FAST_FORWARD_HOLD, FAST_FORWARD_TOGGLE, type PadLike } from './controls.ts';

/** This device's bindings (no storage in tests without a browser). */
export const controls = new Controls(typeof localStorage === 'undefined' ? null : localStorage, (m) => console.warn(m));

/** Held DS buttons for one gamepad under the given bindings (default: the factory ones). */
export function gamepadButtons(pad: PadLike, bindings: Bindings = defaultBindings()): Button[] {
  const standard = pad.mapping === 'standard';
  const t = standard ? bindings.pad : bindings.raw;
  const out = new Set<Button>();
  for (const b of BUTTONS) if (padHolds(pad, t[b], bindings.deadZone)) out.add(b);
  if (standard) {
    const [x = 0, y = 0] = pad.axes;
    const dz = bindings.deadZone / 100;
    if (x <= -dz) out.add('left');
    if (x >= dz) out.add('right');
    if (y <= -dz) out.add('up');
    if (y >= dz) out.add('down');
  }
  return BUTTONS.filter((b) => out.has(b));
}

/** Whether a pad is being used: a button down, or a standard pad's stick past the dead zone. */
function padActive(pad: PadLike, bindings: Bindings): boolean {
  if (pad.buttons.some((b) => b.pressed)) return true;
  if (pad.mapping !== 'standard') return false;
  const dz = bindings.deadZone / 100;
  return pad.axes.slice(0, 2).some((v) => Math.abs(v) >= dz);
}

/** The one active gamepad: the one pressed last. It stays active until another pad is pressed. */
export class ActivePad {
  private index: number | null = null;

  /** The pad to read this poll (null: none has been used, or it is gone). */
  pick(pads: readonly (PadLike | null)[], bindings: Bindings): PadLike | null {
    const current = this.index !== null ? pads[this.index] : null;
    if (!current) this.index = null;
    if (current && padActive(current, bindings)) return current;
    const used = pads.findIndex((p, i) => p && i !== this.index && padActive(p, bindings));
    if (used >= 0) this.index = used;
    return this.index !== null ? (pads[this.index] ?? null) : null;
  }

  /** The pad with this index was unplugged. */
  gone(index: number): void {
    if (this.index === index) this.index = null;
  }
}

type Point = { x: number; y: number };

/**
 * Accumulates input between ticks. A button that went down and up again between two samples
 * still counts as held and pressed for one frame (so short taps are never lost); a touch likewise.
 */
export class InputState {
  private readonly sources = new Map<string, Set<Button>>();
  private readonly touches = new Map<string, Point>();
  private downSinceSample = new Set<Button>();
  private touchSinceSample: Point | null = null;
  /** Taps waiting for a frame: one per frame, in order (typed text then Enter must not lose a keystroke). */
  private taps: string[] = [];
  private previous = new Set<Button>();

  /** Start a new deterministic input session, discarding queued taps and press edges too. */
  reset(): void {
    this.sources.clear();
    this.touches.clear();
    this.downSinceSample.clear();
    this.touchSinceSample = null;
    this.taps = [];
    this.previous.clear();
  }

  set(source: string, button: Button, down: boolean): void {
    let held = this.sources.get(source);
    if (!held) this.sources.set(source, (held = new Set()));
    if (down && !held.has(button)) this.downSinceSample.add(button);
    if (down) held.add(button);
    else held.delete(button);
  }

  /** Replaces everything a polled source holds (gamepads). */
  setAll(source: string, buttons: readonly Button[]): void {
    const before = this.sources.get(source) ?? new Set<Button>();
    for (const b of buttons) if (!before.has(b)) this.downSinceSample.add(b);
    this.sources.set(source, new Set(buttons));
  }

  clear(source: string): void {
    this.sources.delete(source);
    this.touches.delete(source);
  }

  setTouch(source: string, point: Point | null): void {
    if (point) {
      this.touches.set(source, point);
      this.touchSinceSample ??= point;
    } else this.touches.delete(source);
  }

  /**
   * A tap on the open menu app (DOM click/tap or the bridge): taps are delivered one per frame, in order.
   * Typed text (`type:<text>`, the naming screen) arriving within one tick is joined into one tap, as are
   * pen samples (`pen:<x>,<y>`, the card's signature: `pen:<x>,<y>;<x>,<y>…`).
   */
  tap(id: string): void {
    const last = this.taps.at(-1);
    if (id.startsWith('type:') && last?.startsWith('type:')) this.taps[this.taps.length - 1] = last + id.slice(5);
    else if (id.startsWith('pen:') && last?.startsWith('pen:')) this.taps[this.taps.length - 1] = `${last};${id.slice(4)}`;
    // The Poffin pot's stylus: only the latest point of a tick counts (the DS reads the touch once a frame).
    else if (id.startsWith('spoon:') && last?.startsWith('spoon:')) this.taps[this.taps.length - 1] = id;
    else this.taps.push(id);
  }

  frame(): InputFrame {
    const held = new Set<Button>(this.downSinceSample);
    for (const s of this.sources.values()) for (const b of s) held.add(b);
    const pressed = BUTTONS.filter((b) => held.has(b) && (!this.previous.has(b) || this.downSinceSample.has(b)));
    const touch = this.touches.values().next().value ?? this.touchSinceSample;
    const tap = this.taps.shift() ?? null;
    this.previous = held;
    this.downSinceSample = new Set();
    this.touchSinceSample = null;
    return { held: BUTTONS.filter((b) => held.has(b)), pressed, touch: touch ? { ...touch } : null, ...(tap !== null ? { tap } : {}) };
  }
}

/** Keyboard → InputState. Returns a detach function. Keys with modifiers (shortcuts) are left alone. */
export function attachKeyboard(target: Window, input: InputState): () => void {
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    const button = controls.keyMap()[e.code];
    if (!button || e.metaKey || e.ctrlKey || e.altKey) return;
    // Focus may move into a control while a game key is held; its release must still reach the game.
    if (!down) input.set('keyboard', button, false);
    const form = e.target instanceof HTMLElement ? e.target.closest('input, textarea, select, dialog') : null;
    if (form && !(form.matches('input[type="range"]') && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'PageUp', 'PageDown'].includes(e.code))) return;
    // In an open menu, native activation belongs to the focused control, not the game's separate cursor.
    // Elsewhere (a HUD button left focused by a click) Space and Enter stay the game's A and Start.
    if ((e.code === 'Space' || e.code === 'Enter') && e.target instanceof HTMLElement && e.target.closest('[data-screen] :is(button:not([data-button]), [role="button"], [role="slider"])')) return;
    e.preventDefault();
    input.set('keyboard', button, down);
  };
  const keydown = onKey(true);
  const keyup = onKey(false);
  const blur = () => input.clear('keyboard');
  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', blur);
  return () => {
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('keyup', keyup);
    target.removeEventListener('blur', blur);
  };
}

const activePad = new ActivePad();

function connectedPads(): readonly (PadLike | null)[] {
  return typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
}

/** The gamepad in use (the one pressed last), or null. */
function currentPad(): PadLike | null {
  const pads = connectedPads();
  const pad = activePad.pick(pads, controls.bindings);
  controls.padMapping = pad?.mapping ?? pads.find((p) => p)?.mapping ?? null;
  return pad;
}

/** Whether the active gamepad holds its fast-forward button. */
export function gamepadFastForward(): boolean {
  const pad = currentPad();
  if (!pad) return false;
  const t = pad.mapping === 'standard' ? controls.bindings.pad : controls.bindings.raw;
  return padHolds(pad, t.fast, controls.bindings.deadZone);
}

/** An unplugged gamepad is dropped at once (its held buttons let go). */
export function attachGamepadEvents(target: Window, input: InputState, gone: () => void): void {
  target.addEventListener('gamepaddisconnected', (e) => {
    activePad.gone(e.gamepad.index);
    input.clear('gamepad');
    gone();
  });
}

/** Polls the active gamepad into the 'gamepad' source; call once per tick. A waiting binding takes the press instead. */
export function pollGamepads(input: InputState): void {
  if (controls.capturing || controls.padHeldOff(connectedPads())) {
    controls.pollCapture(connectedPads());
    input.setAll('gamepad', []);
    return;
  }
  const pad = currentPad();
  input.setAll('gamepad', pad ? gamepadButtons(pad, controls.bindings) : []);
}
