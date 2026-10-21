/**
 * The tool apps (decomp src/applications/poketch/{calculator,memo_pad,counter,coin_toss,roulette,
 * dot_artist,color_changer,move_tester}). What the decomp keeps only in RAM (the memo pad's drawing, the
 * counter, the coin, the move tester's types) lives in the app and is lost on an app change, as on the DS
 * (PoketchMemory is reset whenever the app changes).
 */
import { POKETCH_COLORS, type PoketchBlit } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Buttons, digit, digitsOf, insideLcd, layers, rect, SE, tile, type AppCtx, type PoketchApp, type Point } from './common.ts';

// ---------------------------------------------------------------- calculator

/** Decomp CALCULATOR_MAX_DIGITS: symbols on the display. */
const MAX_DIGITS = 10;

/** Decomp CalculatorValue: a fixed-point number (significand, decimal places, sign) or invalid. */
export interface CalcValue {
  sig: bigint;
  dp: number;
  neg: boolean;
  invalid: boolean;
  /** "." was pressed: the next digits are decimals (the dot shows once one follows). */
  decimal: boolean;
}

export const calcZero = (): CalcValue => ({ sig: 0n, dp: 0, neg: false, invalid: false, decimal: false });
const TEN = (n: number) => 10n ** BigInt(n);

/** Symbols on the display: integer digits, "−", "." and each decimal (decomp CalculatorValue length). */
export function calcText(v: CalcValue): string {
  const s = v.sig.toString().padStart(v.dp + 1, '0');
  const int = s.slice(0, s.length - v.dp);
  const frac = s.slice(s.length - v.dp);
  return `${v.neg && v.sig !== 0n ? '-' : ''}${int}${v.dp ? `.${frac}` : ''}`;
}
const calcLength = (v: CalcValue) => calcText(v).length;

/** Digit entry (refused at 10 symbols). */
export function calcDigit(v: CalcValue, d: number): CalcValue {
  if (calcLength(v) >= MAX_DIGITS) return v;
  return v.decimal ? { ...v, sig: v.sig * 10n + BigInt(d), dp: v.dp + 1 } : { ...v, sig: v.sig * 10n + BigInt(d) };
}

const signed = (v: CalcValue) => (v.neg ? -v.sig : v.sig);
const fromSigned = (n: bigint, dp: number): CalcValue => ({ sig: n < 0n ? -n : n, dp, neg: n < 0n, invalid: false, decimal: false });

/** Strips trailing fractional zeros, then truncates decimals that do not fit (decomp, after + − ×). */
function tidy(v: CalcValue): CalcValue {
  let { sig, dp } = v;
  while (dp > 0 && sig % 10n === 0n) {
    sig /= 10n;
    dp--;
  }
  const out = { ...v, sig, dp };
  const excess = calcLength(out) - MAX_DIGITS;
  if (excess > 0 && excess <= dp) return { ...out, sig: sig / TEN(excess), dp: dp - excess };
  return out;
}

export type CalcOp = '+' | '-' | '*' | '/';

export function calcEval(a: CalcValue, op: CalcOp, b: CalcValue): CalcValue {
  if (op === '/') {
    if (b.sig === 0n) return { ...calcZero(), invalid: true };
    const p = a.sig * TEN(b.dp);
    const q = b.sig * TEN(a.dp);
    let sig = p / q;
    let r = p % q;
    const intLen = sig.toString().length;
    let dp = 0;
    // Decimals by long division until it divides out or the display is full (truncated).
    while (r !== 0n && intLen + 1 + dp < MAX_DIGITS) {
      r *= 10n;
      sig = sig * 10n + r / q;
      r %= q;
      dp++;
    }
    return { sig, dp, neg: a.neg !== b.neg && sig !== 0n, invalid: false, decimal: false };
  }
  if (op === '*') return tidy({ sig: a.sig * b.sig, dp: a.dp + b.dp, neg: a.neg !== b.neg && a.sig * b.sig !== 0n, invalid: false, decimal: false });
  const dp = Math.max(a.dp, b.dp);
  const x = signed(a) * TEN(dp - a.dp);
  const y = signed(b) * TEN(dp - b.dp);
  return tidy(fromSigned(op === '+' ? x + y : x - y, dp));
}

const calcValid = (v: CalcValue) => !v.invalid && calcLength(v) <= MAX_DIGITS;

/** Decomp calculator keys: 0–9, ".", −, +, ×, ÷, =, C; [left, top, right, bottom] and the tile rect (x, y, w). */
const KEYS: { key: string; r: [number, number, number, number]; t: [number, number, number]; glyph: number }[] = [
  { key: '0', r: [32, 144, 96, 176], t: [4, 18, 8], glyph: 85 },
  { key: '1', r: [32, 112, 64, 144], t: [4, 14, 4], glyph: 87 },
  { key: '2', r: [64, 112, 96, 144], t: [8, 14, 4], glyph: 89 },
  { key: '3', r: [96, 112, 128, 144], t: [12, 14, 4], glyph: 91 },
  { key: '4', r: [32, 80, 64, 112], t: [4, 10, 4], glyph: 93 },
  { key: '5', r: [64, 80, 96, 112], t: [8, 10, 4], glyph: 95 },
  { key: '6', r: [96, 80, 128, 112], t: [12, 10, 4], glyph: 97 },
  { key: '7', r: [32, 48, 64, 80], t: [4, 6, 4], glyph: 99 },
  { key: '8', r: [64, 48, 96, 80], t: [8, 6, 4], glyph: 101 },
  { key: '9', r: [96, 48, 128, 80], t: [12, 6, 4], glyph: 103 },
  { key: '.', r: [96, 144, 128, 176], t: [12, 18, 4], glyph: 105 },
  { key: '-', r: [160, 80, 192, 112], t: [20, 10, 4], glyph: 107 },
  { key: '+', r: [128, 80, 160, 112], t: [16, 10, 4], glyph: 109 },
  { key: '*', r: [128, 112, 160, 144], t: [16, 14, 4], glyph: 111 },
  { key: '/', r: [160, 112, 192, 144], t: [20, 14, 4], glyph: 113 },
  { key: '=', r: [128, 144, 192, 176], t: [16, 18, 8], glyph: 115 },
  { key: 'C', r: [128, 48, 192, 80], t: [16, 6, 8], glyph: 117 },
];

/** Decomp calculator graphics: a pressed key's tiles (frame, glyph, filler); the bottom-row keys end in 337–339. */
function pressedKey(k: (typeof KEYS)[number]): PoketchBlit[] {
  const [tx, ty, w] = k.t;
  const bottom = k.key === '0' || k.key === '.' || k.key === '=' ? 337 : 331;
  const T = (n: number, x: number, y: number) => tile('poketch/calculator_tiles', 40, n, tx + x, ty + y);
  const out: PoketchBlit[] = [];
  for (let x = 0; x < w; x++) {
    const edge = x === 0 ? 0 : x === w - 1 ? 2 : 1;
    out.push(T(251 + edge, x, 0), T(bottom + edge, x, 3));
    for (const row of [1, 2]) out.push(T(x === 0 ? 291 : x === w - 1 ? 293 : x <= 2 ? k.glyph + (x - 1) + (row - 1) * 40 : 292, x, row));
  }
  return out;
}

export function calculator(ctx: AppCtx): PoketchApp {
  const buttons = new Buttons(KEYS.map((k) => rect(...k.r)));
  let state: 'op1' | 'operator' | 'op2' | 'result' | 'error' = 'op1';
  let a = calcZero();
  let b = calcZero();
  let op: CalcOp | null = null;
  /** What the display shows: a value, an error, or nothing (blank at first). */
  let shown: CalcValue | 'error' | null = null;
  let shownOp: CalcOp | null = null;
  let down: number | null = null;
  const cry = (v: CalcValue) => {
    // Decomp: "=" plays the cry of the National (or, before it, Sinnoh) Pokédex number shown, if seen.
    const n = Number((v.neg ? -1n : 1n) * (v.sig / TEN(v.dp)));
    if (n < 1 || n > 493) return;
    const reg = ctx.deps.registries.species;
    const state = ctx.deps.state;
    const species = [...reg.values()].find((s) => (state.pokedex.national ? s.sourceIndex === n : s.regionalDex === n));
    if (species && state.pokedex.seen.includes(species.id)) ctx.cry(species.id, 0);
  };
  const reset = () => {
    a = calcZero();
    b = calcZero();
    op = null;
    shownOp = null;
  };
  const evaluate = (): CalcValue | null => {
    const r = calcEval(a, op!, b);
    if (calcValid(r)) return r;
    state = 'error';
    shown = 'error';
    shownOp = null;
    return null;
  };
  const key = (k: string) => {
    const d = /^\d$/.test(k) ? Number(k) : null;
    const isOp = k === '+' || k === '-' || k === '*' || k === '/';
    if (k === 'C') {
      reset();
      state = 'op1';
      shown = a;
      return;
    }
    switch (state) {
      case 'op1':
        if (d !== null) shown = a = calcDigit(a, d);
        else if (k === '.') shown = a = { ...a, decimal: true };
        else if (isOp) {
          op = shownOp = k;
          state = 'operator';
        } else if (k === '=') {
          cry(a);
          a = calcZero();
        }
        return;
      case 'operator':
        if (isOp) op = shownOp = k;
        else if (d !== null) {
          shown = b = calcDigit(calcZero(), d);
          state = 'op2';
        } else if (k === '.') {
          shown = b = { ...calcZero(), decimal: true };
          state = 'op2';
        } else if (k === '=') {
          b = a;
          const r = evaluate();
          if (r) {
            shown = r;
            shownOp = null;
            state = 'result';
            cry(r);
          }
        }
        return;
      case 'op2':
        if (d !== null) shown = b = calcDigit(b, d);
        else if (k === '.') shown = b = { ...b, decimal: true };
        else if (isOp || k === '=') {
          const r = evaluate();
          if (!r) return;
          shown = r;
          if (isOp) {
            a = r;
            op = shownOp = k;
            state = 'operator';
          } else {
            shownOp = null;
            state = 'result';
            cry(r);
          }
        }
        return;
      case 'result': {
        const r = shown as CalcValue;
        if (k === '=') {
          a = r;
          const next = evaluate();
          if (next) {
            shown = next;
            cry(next);
          }
        } else if (isOp) {
          a = r;
          op = shownOp = k;
          state = 'operator';
        } else if (d !== null) {
          reset();
          shown = a = calcDigit(calcZero(), d);
          state = 'op1';
        } else if (k === '.') {
          reset();
          shown = a = { ...calcZero(), decimal: true };
          state = 'op1';
        }
        return;
      }
      case 'error':
        if (d !== null || k === '.') {
          reset();
          shown = a = d !== null ? calcDigit(calcZero(), d) : { ...calcZero(), decimal: true };
          state = 'op1';
        }
        return;
    }
  };
  return {
    step(tick) {
      const e = buttons.update(tick.touch);
      if (!e) return;
      if (e.event === 'touch') {
        down = e.id;
        ctx.se(SE.POKETCH_003);
      } else if (e.event === 'tap' || e.event === 'drag') {
        down = null;
        if (e.event === 'tap') key(KEYS[e.id]!.key);
      }
    },
    view() {
      const l = layers(['poketch/calculator_bg']);
      const T = (n: number, tx: number, ty: number) => [n, n + 1, n + 40, n + 41].map((m, i) => tile('poketch/calculator_tiles', 40, m, tx + (i & 1), ty + (i >> 1)));
      if (shown !== null) {
        const ops: CalcOp[] = ['-', '+', '*', '/'];
        l.blits.push(...T(shownOp ? 240 + ops.indexOf(shownOp) * 2 : 41, 3, 3));
        const text = shown === 'error' ? 'E'.repeat(MAX_DIGITS) : calcText(shown);
        const symbols = [...text].map((c) => (c === 'E' ? 12 : c === '.' ? 10 : c === '-' ? 11 : Number(c)));
        for (let i = 0; i < MAX_DIGITS; i++) {
          const s = symbols[i - (MAX_DIGITS - symbols.length)];
          l.blits.push(...T(s === undefined ? 43 : 165 + 2 * s, 5 + 2 * i, 3));
        }
      }
      if (down !== null) l.blits.push(...pressedKey(KEYS[down]!));
      l.targets = buttons.rects;
      l.info = { display: shown === null ? '' : shown === 'error' ? 'error' : calcText(shown), op: shownOp };
      return l;
    },
  };
}

// ---------------------------------------------------------------- bitmaps

/** A pixel layer in LCD palette indexes (contracts `PoketchView.bitmap`). */
class Bitmap {
  readonly px: Uint8Array;
  private hex: string | null = null;
  constructor(
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
    readonly scale: number,
    fill: number,
  ) {
    this.px = new Uint8Array(width * height).fill(fill);
  }
  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = c;
    this.hex = null;
  }
  fill(c: number): void {
    this.px.fill(c);
    this.hex = null;
  }
  view() {
    this.hex ??= Array.from(this.px, (v) => v.toString(16)).join('');
    return { x: this.x, y: this.y, width: this.width, height: this.height, scale: this.scale, data: this.hex };
  }
}

/** Decomp memo pad / roulette line: a DDA along the major axis (X only when |dx| > |dy|), ends excluded; the end is plotted after. */
function line(from: Point, to: Point, plot: (x: number, y: number) => void): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    const step = Math.trunc((dy * 4096) / dx) * Math.sign(dx);
    const dir = Math.sign(dx);
    let fy = from.y * 4096 + step;
    for (let x = from.x + dir; x !== to.x; x += dir, fy += step) plot(x, fy >> 12);
  } else if (dy !== 0) {
    const step = Math.trunc((dx * 4096) / dy) * Math.sign(dy);
    const dir = Math.sign(dy);
    let fx = from.x * 4096 + step;
    for (let y = from.y + dir; y !== to.y; y += dir, fx += step) plot(fx >> 12, y);
  }
  plot(to.x, to.y);
}

/** LCD palette: paper 4, ink 1. */
const PAPER = 4;
const INK = 1;

/** Decomp memo pad: a 78×75 canvas of 2×2 dots; the pencil draws 1 dot, the eraser clears 4×4. */
export function memoPad(ctx: AppCtx): PoketchApp {
  void ctx;
  const bitmap = new Bitmap(16, 16, 160, 152, 1, PAPER);
  const tools = new Buttons([rect(180, 24, 204, 88), rect(180, 104, 204, 168)]);
  let eraser = false;
  let last: Point | null = null;
  const plot = (x: number, y: number) => {
    if (eraser) {
      // Decomp: an 8×8 paper square at window (2x − 4, 2y − 4), clamped at the left and top only.
      for (let py = Math.max(0, 2 * y - 4); py < 2 * y + 4; py++) for (let px = Math.max(0, 2 * x - 4); px < 2 * x + 4; px++) bitmap.set(px, py, PAPER);
    } else for (let k = 0; k < 4; k++) bitmap.set(2 * x + (k & 1), 2 * y + (k >> 1), INK);
  };
  return {
    step(tick) {
      const e = tools.update(tick.touch);
      if (e?.event === 'touch' && (e.id === 0) !== eraser) {
        eraser = e.id === 0;
        ctx.se(SE.POKETCH_003);
      }
      const h = tick.touch.held;
      const inside = h !== null && h.x - 16 < 156 && h.x >= 16 && h.y - 16 < 150 && h.y >= 16;
      if (!inside) {
        last = null;
        return;
      }
      const p = { x: (h.x - 16) >> 1, y: (h.y - 16) >> 1 };
      if (last) line(last, p, plot);
      else plot(p.x, p.y);
      last = p;
    },
    view() {
      const l = layers(['poketch/memo_pad_bg']);
      l.bitmap = bitmap.view();
      l.sprites.push({ sheet: 'poketch/memo_pad', anim: { seq: eraser ? 1 : 0, t: 0 }, x: 192, y: 56 }, { sheet: 'poketch/memo_pad', anim: { seq: eraser ? 2 : 3, t: 0 }, x: 192, y: 136 });
      l.targets = [];
      l.info = { tool: eraser ? 'eraser' : 'pencil', inked: bitmap.px.filter((v) => v === INK).length };
      return l;
    },
  };
}

/** Decomp roulette: draw on the board, START spins the arrow, STOP slows it down, CLEAR (released inside) wipes the board. */
export function roulette(ctx: AppCtx): PoketchApp {
  const bitmap = new Bitmap(16, 16, 160, 152, 1, PAPER);
  const buttons = new Buttons([rect(167, 34, 207, 66), rect(167, 80, 207, 112), rect(167, 126, 207, 158)]);
  let state: 'idle' | 'spinning' | 'stopping' | 'clearing' = 'idle';
  const anims = [1, 4, 5];
  let angle = 0;
  let speed = 0;
  let phase = 0;
  let stopDelay = 0;
  let stopRequested = false;
  let last: Point | null = null;
  const drawn = new Set<number>();
  const plot = (x: number, y: number) => {
    for (let k = 0; k < 4; k++) bitmap.set(2 * x + (k & 1), 2 * y + (k >> 1), INK);
  };
  const spin = (): boolean => {
    // Decomp graphics.c spinner task: angle in 1/65536 turns; returns true when it has stopped.
    if (phase === 0) {
      angle += 336;
      speed = 336;
      phase = 1;
    } else if (phase === 1) {
      angle += speed;
      speed += 336;
      if (speed >= 12288) {
        speed = 12288;
        phase = 2;
      }
    } else if (phase === 2) {
      angle += 12288;
      if (stopRequested) {
        stopDelay = (ctx.deps.rng() >>> 0) % 8;
        speed = 6656;
        phase = 3;
      }
    } else if (phase === 3) {
      angle += speed;
      // Decomp quirk: a delay other than 0 moves on after one tick, 0 after two.
      if (stopDelay !== 0) phase = 4;
      else stopDelay = -1;
    } else if (speed > 80) {
      speed -= 80;
      angle += speed;
    } else {
      speed = 0;
      return true;
    }
    angle &= 0xffff;
    return false;
  };
  return {
    step(tick) {
      if (state === 'spinning' || state === 'stopping') {
        if (spin()) {
          ctx.se(SE.POKETCH_011);
          anims.splice(0, 3, 1, 4, 5);
          state = 'idle';
        }
      }
      const e = buttons.update(tick.touch);
      if (state === 'idle') {
        if (e?.event === 'touch' && e.id === 0) {
          anims.splice(0, 3, 2, 3, 6);
          phase = 0;
          stopRequested = false;
          ctx.se(SE.POKETCH_003);
          state = 'spinning';
          return;
        }
        if (e?.event === 'touch' && e.id === 1) ctx.se(SE.BEEP);
        if (e?.event === 'touch' && e.id === 2) {
          anims[2] = 6;
          ctx.se(SE.POKETCH_003);
          state = 'clearing';
          return;
        }
        const h = tick.touch.held;
        if (!h || h.x < 16 || h.y < 16 || h.x - 16 >= 155 || h.y - 16 >= 149) {
          last = null;
          return;
        }
        const p = { x: (h.x - 16) >> 1, y: (h.y - 16) >> 1 };
        if (!last) {
          if (drawn.has(p.y * 160 + p.x)) return;
          drawn.add(p.y * 160 + p.x);
          plot(p.x, p.y);
        } else line(last, p, plot);
        last = p;
      } else if (state === 'spinning') {
        if (e?.event === 'touch' && e.id === 1) {
          anims.splice(0, 3, 2, 4, 6);
          stopRequested = true;
          ctx.se(SE.POKETCH_003);
          state = 'stopping';
        } else if (e?.event === 'touch') ctx.se(SE.BEEP);
      } else if (state === 'clearing') {
        if (e?.event === 'tap' && e.id === 2) {
          bitmap.fill(PAPER);
          drawn.clear();
        }
        if (e && (e.event === 'tap' || e.event === 'drag') && e.id === 2) {
          anims[2] = 5;
          state = 'idle';
        }
      }
    },
    view() {
      const l = layers(['poketch/roulette_bg']);
      l.bitmap = bitmap.view();
      l.sprites.push({ sheet: 'poketch/roulette', anim: { seq: 0, t: 0 }, x: 96, y: 96, angle: (angle * 360) / 65536 });
      [187, 187, 187].forEach((x, i) => l.sprites.push({ sheet: 'poketch/roulette', anim: { seq: anims[i]!, t: 0 }, x, y: [50, 96, 142][i]! }));
      l.targets = buttons.rects;
      l.info = { state, angle };
      return l;
    },
  };
}

// ---------------------------------------------------------------- dot artist

const DOT_W = 24;
const DOT_H = 20;
/** Decomp dot artist: cell values 1–4 shown in LCD colours 4, 15, 8, 1. */
const DOT_COLORS = [0, 4, 15, 8, 1];
/** Decomp DotArtist default picture ("Touch!"): rows 7–12, the x of each value-4 cell. */
const TOUCH: Record<number, number[]> = {
  7: [1, 2, 3, 4, 5, 22],
  8: [3, 22],
  9: [3, 18, 22],
  10: [3, 6, 7, 8, 10, 12, 14, 15, 16, 18, 19, 20, 22],
  11: [3, 6, 8, 10, 12, 14, 18, 20],
  12: [3, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 20, 22],
};

/** The 120-byte save format: cell i's value − 1 in bits 2(i % 4) of byte i / 4. */
export function packDots(cells: Uint8Array): string {
  const bytes = new Uint8Array(120);
  cells.forEach((v, i) => (bytes[i >> 2]! |= (v - 1) << ((i & 3) * 2)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function unpackDots(hex: string): Uint8Array {
  const cells = new Uint8Array(DOT_W * DOT_H);
  for (let i = 0; i < cells.length; i++) cells[i] = ((parseInt(hex.slice((i >> 2) * 2, (i >> 2) * 2 + 2), 16) >> ((i & 3) * 2)) & 3) + 1;
  return cells;
}

export function dotArtist(ctx: AppCtx): PoketchApp {
  const p = ctx.deps.state.poketch;
  const cells = p.dotArt ? unpackDots(p.dotArt) : new Uint8Array(DOT_W * DOT_H).fill(1);
  if (!p.dotArt) for (const [y, xs] of Object.entries(TOUCH)) for (const x of xs) cells[Number(y) * DOT_W + x] = 4;
  let last = { x: 25, y: 21 };
  const save = () => (p.dotArt = packDots(cells));
  return {
    step(tick) {
      const h = tick.touch.held;
      if (!h || !insideLcd(h)) return;
      const c = { x: (h.x - 16) >> 3, y: (h.y - 16) >> 3 };
      if (c.x >= DOT_W || c.y >= DOT_H || (c.x === last.x && c.y === last.y && !tick.touch.tapped)) return;
      const i = c.y * DOT_W + c.x;
      cells[i] = (cells[i]! % 4) + 1;
      last = c;
      save();
    },
    close: save,
    view() {
      const l = layers();
      l.bitmap = { x: 16, y: 16, width: DOT_W, height: DOT_H, scale: 8, data: Array.from(cells, (v) => DOT_COLORS[v]!.toString(16)).join('') };
      l.info = { saved: p.dotArt !== null };
      return l;
    },
  };
}

// ---------------------------------------------------------------- counter, coin toss, colour

/** Decomp counter: the button counts on release inside it, 0000–9999 then 0. */
export function counter(ctx: AppCtx): PoketchApp {
  const button = new Buttons([rect(82, 100, 146, 156)]);
  let value = 0;
  let down = false;
  return {
    step(tick) {
      const e = button.update(tick.touch);
      if (e?.event === 'touch') {
        down = true;
        ctx.se(SE.POKETCH_010);
      } else if (e) {
        down = false;
        if (e.event === 'tap') value = value >= 9999 ? 0 : value + 1;
      }
    },
    view() {
      const l = layers(['poketch/counter_bg']);
      l.sprites.push({ sheet: 'poketch/counter', anim: { seq: down ? 1 : 0, t: 0 }, x: 114, y: 128 });
      digitsOf(value, 4).forEach((d, i) => l.sprites.push(digit(d, 88 + 16 * i, 64)));
      l.targets = button.rects;
      l.info = { count: value };
      return l;
    },
  };
}

/** Decomp coin toss: a tap on the coin (r 24 around 112, 144) tosses it; the side is rolled first; it bounces until slow. */
export function coinToss(ctx: AppCtx): PoketchApp {
  const REST = 144 * 4096;
  let heads = true;
  let tossing = false;
  let y = REST;
  let speed = 0;
  let t = 0;
  return {
    step(tick) {
      t++;
      if (tossing) {
        y += speed;
        speed += 2816;
        if (speed > 0 && y >= REST) {
          speed = -Math.trunc((speed * 56) / 100);
          y = REST;
          ctx.se(SE.DENSI10);
          if (speed >= -8192) tossing = false;
        }
        return;
      }
      const h = tick.touch.held;
      if (!tick.touch.tapped || !h || !insideLcd(h) || (h.x - 112) ** 2 + (h.y - 144) ** 2 >= 576) return;
      heads = (ctx.deps.rng() >>> 0) % 2 === 1;
      tossing = true;
      y = REST;
      speed = -43008;
      ctx.se(SE.DENSI09);
    },
    view() {
      const l = layers(['poketch/coin_toss_bg']);
      l.sprites.push({ sheet: 'poketch/coin_toss', anim: { seq: tossing ? 0 : heads ? 1 : 2, t }, x: 112, y: Math.floor(y / 4096) });
      l.targets = [rect(88, 120, 136, 168)];
      l.info = { tossing, side: heads ? 'heads' : 'tails' };
      return l;
    },
  };
}

/** Decomp color changer: hold on the slider (48–183 × 136–159) to pick one of the 8 screen colours at once. */
export function colorChanger(ctx: AppCtx): PoketchApp {
  const p = ctx.deps.state.poketch;
  return {
    step(tick) {
      const h = tick.touch.held;
      if (!h || h.x < 48 || h.x >= 184 || h.y < 136 || h.y >= 160) return;
      const c = Math.min(POKETCH_COLORS - 1, Math.floor((h.x - 48) / 16));
      if (c === p.color) return;
      p.color = c;
      ctx.se(SE.POKETCH_003);
    },
    view() {
      const l = layers(['poketch/color_changer_bg']);
      l.sprites.push({ sheet: 'poketch/color_changer', anim: { seq: 0, t: 0 }, x: 56 + 16 * p.color, y: 148 });
      l.targets = Array.from({ length: POKETCH_COLORS }, (_, i) => rect(48 + 16 * i, 136, 64 + 16 * i, 160));
      l.info = { color: p.color };
      return l;
    },
  };
}

// ---------------------------------------------------------------- move tester

/** Decomp move tester: the type order of its arrows (Mystery never shows); "none" for the second type. */
const TYPE_ORDER = ['NORMAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE', 'FIGHTING', 'POISON', 'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL'];

export function moveTester(ctx: AppCtx): PoketchApp {
  const types = TYPE_ORDER.map((n) => {
    const t = ctx.deps.registries.types.get(`${ctx.ns}:TYPE_${n}` as Id);
    if (!t) throw new Error(`Pokétch move tester: no type ${n}`);
    return t;
  });
  const buttons = new Buttons([rect(16, 112, 40, 144), rect(104, 112, 128, 144), rect(96, 24, 120, 56), rect(184, 24, 208, 56), rect(96, 56, 120, 88), rect(184, 56, 208, 88)]);
  // Indexes into TYPE_ORDER; the second type may be null (none).
  let attack = 0;
  let def1 = 0;
  let def2: number | null = null;
  let down: number | null = null;
  const mult = (atk: number, def: number) => types[atk]!.matchups.find((m) => m.type === types[def]!.id)?.multiplier ?? 10;
  /** Decomp: 0 when immune, else 3 + one step per ×2 and −1 per ×½ (the second type once, if it differs). */
  const marks = (): number => {
    const step = (m: number) => (m === 20 ? 1 : m === 5 ? -1 : 0);
    const m1 = mult(attack, def1);
    const m2 = def2 === null ? 10 : mult(attack, def2);
    if (m1 === 0 || m2 === 0) return 0;
    return 3 + step(m1) + (def2 !== null && def2 !== def1 ? step(m2) : 0);
  };
  const MESSAGES = ['MoveTester_Text_NotEffective', 'MoveTester_Text_NotVeryEffective', 'MoveTester_Text_NotVeryEffective2', 'MoveTester_Text_RegularlyEffective', 'MoveTester_Text_SuperEffective', 'MoveTester_Text_SuperEffective2'];
  const N = TYPE_ORDER.length;
  return {
    step(tick) {
      const e = buttons.update(tick.touch);
      if (!e) return;
      if (e.event === 'touch') {
        down = e.id;
        ctx.se(SE.POKETCH_003);
        return;
      }
      down = null;
      if (e.event !== 'tap') return;
      const d = e.id % 2 ? 1 : -1;
      if (e.id < 2) attack = (attack + d + N) % N;
      else if (e.id < 4) def1 = (def1 + d + N) % N;
      else {
        const v = (def2 === null ? (d > 0 ? -1 : N) : def2) + d;
        def2 = v < 0 || v >= N ? null : v;
      }
    },
    view() {
      const l = layers(['poketch/move_tester_bg']);
      const n = marks();
      [[28, 128], [116, 128], [108, 40], [196, 40], [108, 72], [196, 72]].forEach(([x, y], i) => l.sprites.push({ sheet: 'poketch/move_tester', anim: { seq: (i % 2 ? 2 : 0) + (down === i ? 1 : 0), t: 0 }, x: x!, y: y! }));
      for (let i = 0; i < 5; i++) l.sprites.push({ sheet: 'poketch/move_tester', anim: { seq: i < n ? 4 : 5, t: 0 }, x: 44 + 8 * i, y: 48 });
      const name = (i: number | null) => (i === null ? ctx.text('MoveTester_Text_None') : types[i]!.name);
      l.text.push({ text: name(attack), x: 72, y: 120, align: 'center' }, { text: name(def1), x: 152, y: 32, align: 'center' }, { text: name(def2), x: 152, y: 64, align: 'center' }, { text: ctx.text(MESSAGES[n]!), x: 24, y: 152 });
      l.targets = buttons.rects;
      l.info = { attack: types[attack]!.id, defend: [types[def1]!.id, def2 === null ? null : types[def2]!.id], marks: n };
      return l;
    },
  };
}
