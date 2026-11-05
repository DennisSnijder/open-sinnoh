/**
 * The keyboard and gamepad bindings of this device (`lantern-nds:controls`, never in the save). Options ›
 * Controls edits them; the input layer (input.ts) reads them. Replays and the bridge use logical buttons and
 * never see a key or a pad index.
 *
 * - Keyboard: `KeyboardEvent.code`s, any number per action (the defaults keep their aliases); binding a key
 *   to an action makes it that action's only key.
 * - Gamepad: one token per action and pad kind. A "standard"-mapping pad has the positional DS layout by
 *   default (`pad`). Any other pad has no known layout (`raw`): until the player binds something on one it runs on
 *   a guess (`RAW_GUESS`, so a pad-only player can reach Options › Controls at all); pressing a raw button
 *   (`b<index>`) or moving an axis (`a<index>+` / `a<index>-`) on the Controls page binds it.
 * - A binding already used by another action swaps: the other action takes the one this action had.
 */
import { BUTTONS, type Button } from '@opensinnoh/core';

export const CONTROLS_KEY = 'lantern-nds:controls'; // pre-rename name, kept: players' stored data uses it

/** What a binding triggers: a DS button, fast-forward (held; the backtick toggle is fixed), or the Pokétch (the DS has it always on screen). */
export type Action = Button | 'fast' | 'poketch';

export const ACTIONS: readonly { id: Action; label: string }[] = [
  { id: 'up', label: 'D-PAD UP' },
  { id: 'down', label: 'D-PAD DOWN' },
  { id: 'left', label: 'D-PAD LEFT' },
  { id: 'right', label: 'D-PAD RIGHT' },
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'x', label: 'X' },
  { id: 'y', label: 'Y' },
  { id: 'l', label: 'L' },
  { id: 'r', label: 'R' },
  { id: 'start', label: 'START' },
  { id: 'select', label: 'SELECT' },
  { id: 'fast', label: 'FAST-FORWARD' },
  { id: 'poketch', label: 'POKÉTCH' },
];

/** A pad binding: a button (`b12`) or an axis direction (`a2-`), or none. */
export type PadToken = string | null;

export interface Bindings {
  keys: Record<Action, string[]>;
  /** The "standard"-mapping pad's buttons. */
  pad: Record<Action, PadToken>;
  /** Any other pad's raw buttons and axes. */
  raw: Record<Action, PadToken>;
  /** The stick's and an axis binding's dead zone in percent, 10 to 90. */
  deadZone: number;
}

/** Keyboard defaults (physical keys, so any layout works), also the table the game starts with. */
export const KEY_MAP: Readonly<Record<string, Button>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyZ: 'a',
  KeyJ: 'a',
  Space: 'a',
  KeyX: 'b',
  KeyK: 'b',
  KeyC: 'x',
  KeyV: 'y',
  KeyQ: 'l',
  PageUp: 'l',
  KeyE: 'r',
  PageDown: 'r',
  Enter: 'start',
  Backspace: 'select',
  ShiftRight: 'select',
};

/** Fast-forward keys (`KeyboardEvent.code`): the default hold key, and the fixed toggle. */
export const FAST_FORWARD_HOLD = 'Tab';
export const FAST_FORWARD_TOGGLE = 'Backquote';
const POKETCH_KEY = 'KeyP';

/** Standard-mapping pad, positional like the DS: right face = A, bottom = B, top = X, left = Y; left trigger = Pokétch, right trigger = fast-forward. */
const STANDARD_PAD: Readonly<Partial<Record<Action, string>>> = {
  b: 'b0',
  a: 'b1',
  y: 'b2',
  x: 'b3',
  l: 'b4',
  r: 'b5',
  poketch: 'b6',
  fast: 'b7',
  select: 'b8',
  start: 'b9',
  up: 'b12',
  down: 'b13',
  left: 'b14',
  right: 'b15',
};

/** A pad without a layout, before anything is bound on it: most HID pads number their buttons as the standard does, the first stick is axes 0 and 1. */
const RAW_GUESS: Readonly<Partial<Record<Action, string>>> = { ...STANDARD_PAD, up: 'a1-', down: 'a1+', left: 'a0-', right: 'a0+' };

const actionIds = ACTIONS.map((a) => a.id);
const table = <T>(of: (a: Action) => T): Record<Action, T> => Object.fromEntries(actionIds.map((a) => [a, of(a)])) as Record<Action, T>;

export const DEFAULT_DEAD_ZONE = 50;
export const DEAD_ZONE_RANGE = { min: 10, max: 90 } as const;

export function defaultBindings(): Bindings {
  return {
    keys: table((a) => (a === 'fast' ? [FAST_FORWARD_HOLD] : a === 'poketch' ? [POKETCH_KEY] : Object.entries(KEY_MAP).filter(([, b]) => b === a).map(([code]) => code))),
    pad: table((a) => STANDARD_PAD[a] ?? null),
    raw: table(() => null),
    deadZone: DEFAULT_DEAD_ZONE,
  };
}

/** Keys the game itself uses (cancelling, the fast-forward toggle) and modifiers, which switch key reads off. */
const RESERVED: Readonly<Record<string, string>> = {
  Escape: 'Escape cancels and goes back',
  [FAST_FORWARD_TOGGLE]: 'the backtick toggles fast-forward',
  ControlLeft: 'a modifier key',
  ControlRight: 'a modifier key',
  AltLeft: 'a modifier key',
  AltRight: 'a modifier key',
  MetaLeft: 'a modifier key',
  MetaRight: 'a modifier key',
};

/** Why a key cannot be bound, or null. */
export function reservedKey(code: string): string | null {
  return RESERVED[code] ?? null;
}

const PAD_TOKEN = /^(b\d{1,2}|a\d{1,2}[+-])$/;

/**
 * Parses stored bindings strictly. Anything unreadable is the default for that entry, and each reason is
 * returned for the caller to log (device data is validated at the boundary, never trusted).
 */
export function parseBindings(raw: string | null): { bindings: Bindings; problems: string[] } {
  const bindings = defaultBindings();
  const problems: string[] = [];
  if (raw === null) return { bindings, problems };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { bindings, problems: [`not JSON (${(e as Error).message})`] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { bindings, problems: ['not an object'] };
  const v = value as Record<string, unknown>;
  const rec = (name: string): Record<string, unknown> => {
    const x = v[name];
    if (x === undefined) return {};
    if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>;
    problems.push(`${name} is not an object`);
    return {};
  };
  const keys = rec('keys');
  for (const a of actionIds) {
    const k = keys[a];
    if (k === undefined) continue;
    if (Array.isArray(k) && k.length > 0 && k.length <= 4 && k.every((c) => typeof c === 'string' && c.length > 0 && c.length < 24 && !reservedKey(c))) bindings.keys[a] = k as string[];
    else problems.push(`keys.${a} is ${JSON.stringify(k)}`);
  }
  for (const name of ['pad', 'raw'] as const) {
    const t = rec(name);
    for (const a of actionIds) {
      const p = t[a];
      if (p === undefined) continue;
      if (p === null || (typeof p === 'string' && PAD_TOKEN.test(p))) bindings[name][a] = p;
      else problems.push(`${name}.${a} is ${JSON.stringify(p)}`);
    }
  }
  const z = v.deadZone;
  if (z !== undefined) {
    if (Number.isInteger(z) && (z as number) >= DEAD_ZONE_RANGE.min && (z as number) <= DEAD_ZONE_RANGE.max) bindings.deadZone = z as number;
    else problems.push(`deadZone is ${JSON.stringify(z)}`);
  }
  const extra = Object.keys(v).filter((k) => !['keys', 'pad', 'raw', 'deadZone'].includes(k));
  if (extra.length) problems.push(`unknown keys ${extra.join(', ')}`);
  return { bindings, problems };
}

/** The key map for the input layer: `KeyboardEvent.code` → DS button. */
export function keyMapOf(b: Bindings): Record<string, Button> {
  const map: Record<string, Button> = {};
  for (const button of BUTTONS) for (const code of b.keys[button]) map[code] = button;
  return map;
}

export interface BindResult {
  /** The action that held the binding (it took this action's old one: a swap), or null. */
  holder: Action | null;
}

export function actionLabel(a: Action): string {
  return ACTIONS.find((x) => x.id === a)!.label;
}

/** Binds a key to an action (its only key); a key another action uses is swapped. */
export function bindKey(b: Bindings, action: Action, code: string): BindResult {
  const reason = reservedKey(code);
  if (reason) throw new Error(`${keyLabel(code)} cannot be bound: ${reason}.`);
  const old = b.keys[action];
  const holder = actionIds.find((a) => a !== action && b.keys[a].includes(code)) ?? null;
  b.keys[action] = [code];
  if (!holder) return { holder: null };
  const left = b.keys[holder].filter((c) => c !== code);
  // The holder takes this action's old key, so nothing is left unbound.
  const give = old.filter((c) => c !== code && !left.includes(c));
  b.keys[holder] = left.length ? left : give.slice(0, 1);
  return { holder };
}

/** The table a pad runs on: the standard one, the raw one, or the guess while nothing raw is bound. */
export function padTable(b: Bindings, raw: boolean): Record<Action, PadToken> {
  if (!raw) return b.pad;
  return actionIds.some((a) => b.raw[a] !== null) ? b.raw : table((a) => RAW_GUESS[a] ?? null);
}

/** Binds a pad button or axis to an action for one pad kind; a token another action uses is swapped. */
export function bindPad(b: Bindings, raw: boolean, action: Action, token: string): BindResult {
  // The first raw binding keeps the guess for the rest.
  if (raw) b.raw = { ...padTable(b, true) };
  const t = raw ? b.raw : b.pad;
  const old = t[action];
  const holder = actionIds.find((a) => a !== action && t[a] === token) ?? null;
  t[action] = token;
  if (holder) t[holder] = old;
  return { holder };
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '\\',
};

/** A key's name for the player. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code]!;
  const k = /^Key([A-Z])$/.exec(code);
  if (k) return k[1]!;
  const d = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (d) return code.startsWith('Numpad') ? `Num ${d[1]}` : d[1]!;
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

/** Which face a pad has, read from `Gamepad.id` (browsers put the name or the USB vendor there). */
export type PadKind = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export function padKind(id: string): PadKind {
  const s = id.toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|054c/.test(s)) return 'playstation';
  if (/nintendo|joy-?con|pro controller|057e/.test(s)) return 'nintendo';
  return 'generic';
}

const STANDARD_NAMES: Readonly<Record<number, string>> = {
  10: 'Left stick press',
  11: 'Right stick press',
  12: 'D-pad up',
  13: 'D-pad down',
  14: 'D-pad left',
  15: 'D-pad right',
};

/** Standard-mapping buttons 0 to 9, then the home button, as each pad prints them. */
const FACE_NAMES: Readonly<Record<PadKind, readonly string[]>> = {
  generic: ['Bottom button', 'Right button', 'Left button', 'Top button', 'Left bumper', 'Right bumper', 'Left trigger', 'Right trigger', 'Back', 'Start', 'Home'],
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'Xbox button'],
  playstation: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'PS button'],
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', 'Minus', 'Plus', 'Home'],
};

/** A pad token's name for the player (`raw`: the pad has no standard layout, so only its indices are known). */
export function padLabel(token: PadToken, raw: boolean, kind: PadKind = 'generic'): string {
  if (token === null) return 'Unbound';
  const n = Number(token.slice(1, token.length - (token[0] === 'a' ? 1 : 0)));
  if (token[0] === 'b') return raw ? `Button ${n}` : (FACE_NAMES[kind][n === 16 ? 10 : n] ?? STANDARD_NAMES[n] ?? `Button ${n}`);
  return `Axis ${n} ${token.endsWith('+') ? '+' : '-'}`;
}

/** A row's binding for the player: the keys, then the pad's button (`raw`: the pad in use has no standard layout). */
export function bindingText(b: Bindings, a: Action, raw: boolean, kind: PadKind = 'generic'): string {
  return `${b.keys[a].map(keyLabel).join(', ') || 'Unbound'} · ${padLabel(padTable(b, raw)[a], raw, kind)}`;
}

/** Something the player pressed while binding. */
export type Captured = { kind: 'key'; code: string } | { kind: 'pad'; token: string; raw: boolean };

/** The edge between the pads and the bindings: what a pad holds, what it newly pressed. */
export interface PadLike {
  mapping: string;
  /** The browser's name for the pad (absent in tests that do not care). */
  id?: string;
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

/** Whether a token is held by a pad. */
export function padHolds(pad: PadLike, token: PadToken, deadZone: number): boolean {
  if (token === null) return false;
  const n = Number(token.slice(1, token.length - (token[0] === 'a' ? 1 : 0)));
  if (token[0] === 'b') return pad.buttons[n]?.pressed === true;
  const v = pad.axes[n] ?? 0;
  return token.endsWith('+') ? v >= deadZone / 100 : v <= -deadZone / 100;
}

/** The bindings in use, their storage, and the one open "press something to bind it" request. */
export class Controls {
  private current: Bindings;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private pending: { done(c: Captured | null): void; down: Set<string>; axes: number[][] } | null = null;
  private keyCache: Record<string, Button> | null = null;
  private mapping: string | null = null;
  private kind: PadKind = 'generic';
  /** Pad buttons (`<pad>:<button>`) held when one was bound, until they are let go. */
  private holdOff = new Set<string>();
  /** A DOM screen drives the pad itself (pad-nav.ts): the game reads nothing. */
  padTaken = false;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly warn: (message: string) => void,
  ) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(CONTROLS_KEY) ?? null;
    } catch (e) {
      warn(`controls: storage is unavailable (${(e as Error).message}); the defaults are used`);
    }
    const { bindings, problems } = parseBindings(raw);
    for (const p of problems) warn(`controls: a stored binding was rejected, its default is used (${p})`);
    this.current = bindings;
  }

  get bindings(): Bindings {
    return this.current;
  }

  /** `KeyboardEvent.code` → DS button for the input layer. */
  keyMap(): Readonly<Record<string, Button>> {
    return (this.keyCache ??= keyMapOf(this.current));
  }

  /** Whether a key is the fast-forward hold key. */
  isFastKey(code: string): boolean {
    return this.current.keys.fast.includes(code);
  }

  /** Writes the bindings; returns the error message when storage refuses (private mode). */
  private save(): string | null {
    this.keyCache = null;
    try {
      this.storage?.setItem(CONTROLS_KEY, JSON.stringify(this.current));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Edits the bindings in place and stores them; returns what the edit returned and a storage error message. */
  edit<T>(fn: (b: Bindings) => T): { result: T; error: string | null } {
    const result = fn(this.current);
    return { result, error: this.save() };
  }

  reset(): string | null {
    this.current = defaultBindings();
    return this.save();
  }

  setDeadZone(percent: number): string | null {
    this.current.deadZone = Math.min(DEAD_ZONE_RANGE.max, Math.max(DEAD_ZONE_RANGE.min, percent));
    return this.save();
  }

  /** The pad in use (poll sets it), or null with none. */
  set pad(p: PadLike | null) {
    this.mapping = p?.mapping ?? null;
    this.kind = padKind(p?.id ?? '');
  }

  /** The face of the pad in use: what the Controls page calls its buttons. */
  get face(): PadKind {
    return this.kind;
  }

  /** Whether the Controls page shows the raw (non-standard) pad bindings: a pad is connected and has no standard layout. */
  get padRaw(): boolean {
    return this.mapping !== null && this.mapping !== 'standard';
  }

  get capturing(): boolean {
    return this.pending !== null;
  }

  /**
   * Waits for the next key or pad button/axis the player presses (Escape cancels: null). The key never reaches
   * the game: this listener runs first in the capture phase and stops the event.
   */
  capture(target: Window, pads: () => readonly (PadLike | null)[]): Promise<Captured | null> {
    if (this.pending) throw new Error('controls: a binding is already waiting for input');
    return new Promise((resolve) => {
      const state = {
        down: new Set<string>(),
        axes: pads().map((p) => [...(p?.axes ?? [])]),
        done: (c: Captured | null) => {
          if (this.onKey) target.removeEventListener('keydown', this.onKey, true);
          this.onKey = null;
          this.pending = null;
          resolve(c);
        },
      };
      // A pad button held while binding starts (the one that opened it) counts once it is let go.
      pads().forEach((p, i) => p?.buttons.forEach((b, n) => b.pressed && state.down.add(`${i}:${n}`)));
      this.pending = state;
      this.onKey = (e) => {
        if (e.repeat || e.isComposing) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') state.done(null);
        else state.done({ kind: 'key', code: e.code });
      };
      target.addEventListener('keydown', this.onKey, true);
    });
  }

  /** The pad is not read until the buttons held now are let go (a binding took them, a DOM screen pressed them). */
  holdPads(pads: readonly (PadLike | null)[]): void {
    this.holdOff = new Set(pads.flatMap((p, j) => (p ? p.buttons.flatMap((x, m) => (x.pressed ? [`${j}:${m}`] : [])) : [])));
  }

  /** Called every poll while a binding waits: the first new pad press. */
  pollCapture(pads: readonly (PadLike | null)[]): void {
    const c = this.pending;
    if (!c) return;
    pads.forEach((pad, i) => {
      if (!pad || !this.pending) return;
      const raw = pad.mapping !== 'standard';
      pad.buttons.forEach((b, n) => {
        const key = `${i}:${n}`;
        if (!b.pressed) c.down.delete(key);
        else if (!c.down.has(key)) {
          // The pad is not read again until the buttons held now are let go: the new binding must not fire from this very press.
          this.holdPads(pads);
          c.done({ kind: 'pad', token: `b${n}`, raw });
        }
      });
      // Axes bind only on pads without a layout (a standard pad's stick is the D-pad already), by how far they moved from rest.
      if (raw && this.pending) {
        pad.axes.forEach((v, n) => {
          const rest = c.axes[i]?.[n] ?? 0;
          if (this.pending && Math.abs(v - rest) >= 0.8) c.done({ kind: 'pad', token: `a${n}${v > rest ? '+' : '-'}`, raw });
        });
      }
    });
  }

  /** Whether the pad that just bound a button still holds it (then it is not read yet). */
  padHeldOff(pads: readonly (PadLike | null)[]): boolean {
    for (const key of this.holdOff) {
      const [i, n] = key.split(':').map(Number);
      if (pads[i!]?.buttons[n!]?.pressed !== true) this.holdOff.delete(key);
    }
    return this.holdOff.size > 0;
  }

  /** Cancels a waiting binding (the screen closed). */
  cancelCapture(): void {
    this.pending?.done(null);
  }
}
