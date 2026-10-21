/**
 * What the Pokétch apps share (docs/research/poketch.md): the decomp's touch button manager
 * (poketch_button.c), the drawing layers, sound lookups and small helpers. Everything runs on the game's
 * 30 Hz tick, as the DS Pokétch does (its tasks run once per main-loop pass, two VBlanks each).
 */
import type { PoketchBlit, PoketchDeps, PoketchRect, PoketchSprite, PoketchView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

export type Point = { x: number; y: number };

/** Decomp SEQ_SE_DP_* indexes (pl_sound_data seqInfo order) the apps play. */
export const SE = {
  POKETCH_003: 1635,
  POKETCH_006: 1638,
  POKETCH_009: 1640,
  POKETCH_010: 1641,
  POKETCH_011: 1642,
  POKETCH_012: 1643,
  POKETCH_013: 1644,
  POKETCH_014: 1645,
  BEEP: 1646,
  DENSI01: 1647,
  DENSI04: 1649,
  DENSI09: 1653,
  DENSI10: 1654,
  DENSI11: 1655,
  DENSI12: 1656,
} as const;

/** The LCD (decomp POKETCH_SCREEN_MIN/MAX_X/Y, the unsigned compare: 16 ≤ x < 207, 16 ≤ y < 175). */
export const insideLcd = (p: Point) => p.x >= 16 && p.x < 207 && p.y >= 16 && p.y < 175;

/** Half-open rectangle test (decomp TouchScreen hit tables: left ≤ x < right, top ≤ y < bottom). */
export const inRect = (p: Point, r: PoketchRect) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
export const rect = (left: number, top: number, right: number, bottom: number): PoketchRect => ({ x: left, y: top, width: right - left, height: bottom - top });

/** The touch as an app sees it this tick: the held point (null when not touched) and whether it went down this tick. */
export interface Touch {
  held: Point | null;
  tapped: boolean;
}

export type ButtonEvent = 'touch' | 'tap' | 'drag' | 'timer0' | 'timer1' | 'repeat';

/**
 * Decomp PoketchButtonManager: per button idle → pressed on a touch that starts inside it (TOUCH); while
 * pressed its timer counts ticks: TIMER0/1 at their durations, REPEAT every `repeat` ticks; leaving the rect
 * while touching is DRAGGING (cancelled), lifting inside is TAP. Only the first button with an event is
 * reported per tick; the others still update. `reset(i)` (decomp ResetButtonState) waits for the release.
 */
export class Buttons {
  private readonly state: { mode: 'idle' | 'pressed' | 'reset'; timer: number }[];
  constructor(
    readonly rects: PoketchRect[],
    /** `circles`: buttons that are circles (decomp hit table circle form: dx² + dy² < r²), by index. */
    private readonly opts: { timers?: Record<number, [number, number]>; repeat?: Record<number, number>; circles?: Record<number, { x: number; y: number; r: number }> } = {},
  ) {
    this.state = rects.map(() => ({ mode: 'idle', timer: 0 }));
  }

  update(t: Touch): { id: number; event: ButtonEvent } | null {
    let out: { id: number; event: ButtonEvent } | null = null;
    this.rects.forEach((r, id) => {
      const s = this.state[id]!;
      const c = this.opts.circles?.[id];
      const on = t.held !== null && (c ? (t.held.x - c.x) ** 2 + (t.held.y - c.y) ** 2 < c.r * c.r : inRect(t.held, r));
      let event: ButtonEvent | null = null;
      if (s.mode === 'idle') {
        if (on && t.tapped) {
          s.mode = 'pressed';
          s.timer = 0;
          event = 'touch';
        }
      } else if (s.mode === 'reset') {
        if (!on) s.mode = 'idle';
      } else {
        s.timer++;
        if (on) {
          const [t0, t1] = this.opts.timers?.[id] ?? [0, 0];
          const repeat = this.opts.repeat?.[id] ?? 0;
          if (t0 && s.timer === t0) event = 'timer0';
          else if (t1 && s.timer === t1) event = 'timer1';
          else if (repeat && s.timer >= repeat) {
            s.timer = 0;
            event = 'repeat';
          }
        } else {
          s.mode = 'idle';
          event = t.held ? 'drag' : 'tap';
        }
      }
      if (event && !out) out = { id, event };
    });
    return out;
  }

  reset(id: number): void {
    this.state[id]!.mode = 'reset';
  }
}

/** The layers an app draws (contracts `PoketchView` minus the system's fields). */
export interface AppLayers {
  fill: number | null;
  bg: string[];
  blits: PoketchBlit[];
  bitmap: PoketchView['bitmap'];
  icons: PoketchView['icons'];
  sprites: PoketchSprite[];
  text: PoketchView['text'];
  mosaic: number;
  backlight: boolean;
  targets: PoketchRect[];
  info: PoketchView['info'];
}

export const layers = (bg: string[] = []): AppLayers => ({ fill: null, bg, blits: [], bitmap: null, icons: [], sprites: [], text: [], mosaic: 0, backlight: false, targets: [], info: {} });

/** What an app gets each tick. */
export interface AppTick {
  touch: Touch;
  /** A field task runs (decomp PoketechSystem_IsRunningTask): no input, no sound. */
  busy: boolean;
  moved: boolean;
}

/** Services an app uses: the game deps, sounds by decomp index, cries and text by message name. */
export interface AppCtx {
  deps: PoketchDeps;
  ns: string;
  /** PoketchSystem_PlaySoundEffect (silent while busy or changing apps; the system gates it). */
  se(index: number): void;
  /** PoketchSystem_PlayCry. */
  cry(species: Id, form: number): void;
  /** A text record of the base pack by message name (plain text); throws when the pack lacks it. */
  text(name: string): string;
}

export interface PoketchApp {
  step(tick: AppTick): void;
  view(): AppLayers;
  /** The app is switched away from (decomp app Free: the dot artist saves its picture). */
  close?(): void;
}

export type AppFactory = (ctx: AppCtx) => PoketchApp;

/** A digit sprite of the shared digits sheet (decomp digits_cell: 16×32 centred on x, y; sequence d = digit d). */
export const digit = (d: number, x: number, y: number): PoketchSprite => ({ sheet: 'poketch/digits', anim: { seq: d, t: 0 }, x, y });

/** The decimal digits of `n`, `count` wide, most significant first, with leading zeros. */
export const digitsOf = (n: number, count: number): number[] => String(n).padStart(count, '0').slice(-count).split('').map(Number);

/** A tile of a tile sheet (`<name>_tiles`, `wide` tiles across) copied to tile (tx, ty) of the screen. */
export function tile(sheet: string, wide: number, index: number, tx: number, ty: number, flip: { h?: boolean; v?: boolean } = {}): PoketchBlit {
  return { sheet, from: { x: (index % wide) * 8, y: Math.floor(index / wide) * 8, width: 8, height: 8 }, x: tx * 8, y: ty * 8, ...(flip.h ? { hFlip: true } : {}), ...(flip.v ? { vFlip: true } : {}) };
}

/** Ticks a NANR sequence of `frames` (60 Hz delays, advanced by 2 per tick) has run: its length in ticks. */
export const animTicks = (delays: number[]) => Math.ceil(delays.reduce((a, b) => a + b, 0) / 2);

/** Day of the week of a `yyyy-mm-dd` date, 0 = Sunday (the DS RTC's week). */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Decomp days per month, with the leap year rule (calendar app). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 400 === 0 || (year % 100 !== 0 && year % 4 === 0) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}
