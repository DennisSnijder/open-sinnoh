/**
 * Message printing, modelled on the DS text printer (decomp render_text.c / text.c, behaviour only):
 * one render call per sub-step, 2 sub-steps per 30 Hz tick. At the default text speed (NORMAL = 4) a char
 * takes 4 render calls; with `canSpeedUp` (RenderControlFlags canABSpeedUpPrint) a fresh A/B press while a char
 * waits speeds the printer up, and from then on holding A/B prints one char per call. With `speedUpOnTouch`
 * (the battle's flag) a fresh touch speeds up like A/B, and a held touch prints one char per call even without one.
 * {clear} waits for A/B and clears the box; {scroll} waits for A/B and scrolls one line (4 px per call). With
 * `autoScroll` (AUTO_SCROLL_ENABLED, the battle's) they wait 100 render calls instead, and with `skip`
 * (AUTO_SCROLL_NO_WAIT) a fresh A/B press (or touch, with `speedUpOnTouch`) ends that wait early.
 * `subStep` reports a press that ended such a wait: the DS plays SE_CONFIRM there (TextPrinter_Continue); an
 * auto-scroll wait that runs out is silent.
 * `text()` is what the window shows: as on the DS a clear only empties the window's buffer, which reaches the
 * screen with the next printed char (SysTask_RunTextPrinter copies to VRAM on RENDER_PRINT), so a message
 * ending in {clear} still shows its last page.
 * With a `callback` (decomp TextPrinter callback, Text_AddPrinterWithParams), a {wait n} sets its parameter
 * and the callback runs after every render call; while it returns true the printer waits (decomp
 * SysTask_RunTextPrinter: callbackResult). Without one, {wait n} is skipped like other formatting.
 */
import { parseTextMarkup, type TextToken } from '@opensinnoh/contracts';

export type PrintOp =
  | { kind: 'char'; c: string }
  | { kind: 'newline' }
  | { kind: 'clear' }
  | { kind: 'scroll' }
  | { kind: 'pause'; frames: number }
  /** Formatting commands (colour, size, cursor, …): consumed without printing. */
  | { kind: 'format'; token: TextToken };

export const TEXT_SPEED = { instant: 0, fast: 1, quick: 2, normal: 4, slow: 8 } as const;
/** Height of a message line in pixels (message font). */
export const LINE_HEIGHT = 16;
/** Render calls an auto-scrolling {clear} or {scroll} waits (decomp TextPrinter_WaitAutoMode). */
export const AUTO_SCROLL_WAIT = 100;
export const VISIBLE_LINES = 2;

/**
 * Replaces {var N} with template slot contents. Slots hold text markup (as DS string templates keep control
 * codes, e.g. the pocket names' colour codes); plain strings such as player names must be stored escaped.
 * A missing slot, or a slot that itself uses {var}, is an error (fail loudly).
 */
export function expandTemplate(tokens: readonly TextToken[], slots: readonly (string | undefined)[]): TextToken[] {
  return tokens.flatMap((t) => {
    if (t.kind !== 'var') return [t];
    const s = slots[t.slot];
    if (s === undefined) throw new Error(`text: template slot ${t.slot} is not set`);
    const inner = parseTextMarkup(s);
    if (inner.some((x) => x.kind === 'var')) throw new Error(`text: template slot ${t.slot} contains {var}: "${s}"`);
    return inner;
  });
}

/** Text markup for a plain string (escapes braces), for template slots. */
export function plainMarkup(s: string): string {
  return s.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

export function toPrintOps(markup: string, slots: readonly (string | undefined)[] = []): PrintOp[] {
  const ops: PrintOp[] = [];
  for (const t of expandTemplate(parseTextMarkup(markup), slots)) {
    if (t.kind === 'chars') for (const c of t.value) ops.push({ kind: 'char', c });
    else if (t.kind === 'newline' || t.kind === 'clear' || t.kind === 'scroll') ops.push({ kind: t.kind });
    else if (t.kind === 'pause') ops.push({ kind: 'pause', frames: t.value });
    else ops.push({ kind: 'format', token: t });
  }
  return ops;
}

type State = 'char' | 'clear' | 'start-scroll' | 'scroll' | 'pause' | 'done';
type Result = 'print' | 'update' | 'repeat' | 'finish';

export interface PrinterInput {
  /** A or B newly pressed this tick. */
  pressed: boolean;
  /** A or B held this tick. */
  held: boolean;
  /** The touch screen newly touched this tick (gSystem.touchPressed); read only with `speedUpOnTouch`. */
  touchPressed?: boolean;
  /** The touch screen held this tick (gSystem.touchHeld); read only with `speedUpOnTouch`. */
  touchHeld?: boolean;
}

export interface PrinterOptions {
  speed?: number;
  /** RenderControlFlags canABSpeedUpPrint. */
  canSpeedUp?: boolean;
  /** RenderControlFlags speedUpOnTouch. */
  speedUpOnTouch?: boolean;
  /** RenderControlFlags autoScroll; `skip` is speedUpAutoScroll (AUTO_SCROLL_NO_WAIT). */
  autoScroll?: { skip: boolean };
  callback?: (param: number) => boolean;
}

/** Deterministic text printer. Plain data (JSON-serializable through `save`/`restore` is not needed: saves happen between scripts). */
export class TextPrinter {
  private state: State = 'char';
  private i = 0;
  private delay = 0;
  private readonly speedBottom: number;
  private speedUp = false;
  private scrollLeft = 0;
  /** Rows of text in the window; the cursor row may run past the visible two (clipped, as on the DS). */
  private rows: string[] = [''];
  /** The rows on screen (the window as last copied to VRAM). */
  private shown: string[] = [''];
  private row = 0;
  private autoScrollDelay = 0;
  private callbackParam = 0;
  private callbackWaiting = false;
  /** A press ended a wait in the current render call. */
  private continued = false;

  constructor(
    private readonly ops: readonly PrintOp[],
    private readonly opts: PrinterOptions = {},
  ) {
    const speed = opts.speed ?? TEXT_SPEED.normal;
    this.speedBottom = speed === 0 ? 0 : speed - 1;
    if (speed === 0) {
      // Instant: render everything that does not wait for input now.
      while (this.state === 'char') this.render({ pressed: false, held: false });
    }
  }

  get done(): boolean {
    return this.state === 'done';
  }

  /** Waiting for A/B at a {clear} or {scroll}. */
  get waiting(): boolean {
    return this.state === 'clear' || this.state === 'start-scroll';
  }

  /** The two visible rows, joined with "\n" (trailing empty row dropped). */
  text(): string {
    const visible = [this.shown[0] ?? '', this.shown[1] ?? ''];
    return visible[1] ? visible.join('\n') : visible[0]!;
  }

  /**
   * One render call (the DS runs two per 30 Hz tick). True when an A/B press (or touch) ended a {clear} or
   * {scroll} wait in it: the caller plays SE_CONFIRM (decomp TextPrinter_Continue).
   */
  subStep(input: PrinterInput): boolean {
    if (this.state === 'done') return false;
    const callback = this.opts.callback;
    if (callback && this.callbackWaiting) {
      this.callbackWaiting = callback(this.callbackParam);
      return false;
    }
    this.callbackParam = 0;
    this.continued = false;
    let r: Result;
    do r = this.render(input);
    while (r === 'repeat');
    if (callback && r !== 'finish') this.callbackWaiting = callback(this.callbackParam);
    return this.continued;
  }

  private render(input: PrinterInput): Result {
    switch (this.state) {
      case 'char': {
        const touch = this.opts.speedUpOnTouch === true;
        if ((input.held && this.speedUp) || (touch && input.touchHeld)) this.delay = 0;
        if (this.delay && this.speedBottom) {
          this.delay--;
          if (this.opts.canSpeedUp && (input.pressed || (touch && input.touchPressed))) {
            this.speedUp = true;
            this.delay = 0;
          }
          return 'update';
        }
        this.delay = this.speedBottom;
        const op = this.ops[this.i++];
        if (!op) {
          this.state = 'done';
          return 'finish';
        }
        switch (op.kind) {
          case 'char':
            while (this.rows.length <= this.row) this.rows.push('');
            this.rows[this.row] += op.c;
            this.shown = [...this.rows];
            return 'print';
          case 'newline':
            this.row++;
            while (this.rows.length <= this.row) this.rows.push('');
            return 'repeat';
          case 'format':
            if (op.token.kind === 'wait' && this.opts.callback) {
              this.callbackParam = op.token.value;
              return 'update';
            }
            return 'repeat';
          case 'pause':
            this.delay = op.frames;
            this.state = 'pause';
            return 'update';
          case 'clear':
            this.state = 'clear';
            this.autoScrollDelay = 0;
            return 'update';
          case 'scroll':
            this.state = 'start-scroll';
            this.autoScrollDelay = 0;
            return 'update';
        }
        throw new Error('unreachable');
      }
      case 'clear':
        if (this.proceed(input)) {
          this.rows = [''];
          this.row = 0;
          this.state = 'char';
        }
        return 'update';
      case 'start-scroll':
        if (this.proceed(input)) {
          this.scrollLeft = LINE_HEIGHT;
          this.state = 'scroll';
        }
        return 'update';
      case 'scroll':
        if (this.scrollLeft) {
          this.scrollLeft = Math.max(0, this.scrollLeft - 4);
          if (!this.scrollLeft) {
            // The window content has moved up one line; printing continues on the same row.
            this.rows.shift();
            while (this.rows.length <= this.row) this.rows.push('');
            this.rows[this.row] = '';
            this.shown = [...this.rows];
          }
        } else this.state = 'char';
        return 'update';
      case 'pause':
        if (this.delay) this.delay--;
        else this.state = 'char';
        return 'update';
      case 'done':
        return 'finish';
    }
  }

  /** Decomp TextPrinter_WaitWithScrollArrow: a fresh A/B (or touch) press, or the auto-scroll wait. */
  private proceed(input: PrinterInput): boolean {
    const key = input.pressed || (this.opts.speedUpOnTouch === true && input.touchPressed === true);
    const auto = this.opts.autoScroll;
    if (auto) {
      if (this.autoScrollDelay === AUTO_SCROLL_WAIT) return true;
      this.autoScrollDelay++;
      if (!auto.skip) return false;
    }
    this.continued = key;
    return key;
  }
}
