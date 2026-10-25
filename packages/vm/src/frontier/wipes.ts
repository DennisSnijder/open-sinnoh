/**
 * The facilities' pre-battle wipes (decomp FrontierScrCmd_3F → Unk_ov104_0223F65C types 1–4, ov104_0223E894.c), headless:
 * - The Hall (1) and the Arcade (2): `BlockWipe` (ov104_0223EBA0 / EBF0 and its steppers EC34, EE44). 96 blocks, four
 *   started each frame in mirrored rows (columns), each a rect slid one block over one frame (ov104_0223EA84/EADC) and
 *   filled black on BG1 where it passes; the rows (columns) go left and right (up and down) by turns.
 * - The Factory (3) and the Castle (4): `LineWipe` (ov104_02231720 / 02231864 and the H-blank task ov104_022313FC). Each
 *   pair of lines (96) moves its BG2 and BG3 affine reference point by its own speed each frame; the hardware latches a
 *   reference point written in H-blank as that line's origin, so the pair shows the layer's row at the point's y.
 */
import type { FrontierWipeView } from '@opensinnoh/contracts';

/** Decomp ov104_0223EA28 / EA38: a value from `start` by `diff` over `frames` steps (C division). */
class Lerp {
  value: number;
  private n = 0;
  constructor(
    private readonly start: number,
    private readonly diff: number,
    private readonly frames: number,
  ) {
    this.value = start;
  }

  step(): boolean {
    this.value = Math.trunc((this.diff * this.n) / this.frames) + this.start;
    if (this.n + 1 <= this.frames) {
      this.n++;
      return false;
    }
    this.n = this.frames;
    return true;
  }
}

type Rect = { x: number; y: number; w: number; h: number };

/** Decomp ov104_0223EA84 / EADC: a w × h rect whose centre slides from (x0, y0) to (x1, y1), filled each step. */
class Block {
  private readonly x: Lerp;
  private readonly y: Lerp;
  constructor(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    frames: number,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.x = new Lerp(x0, x1 - x0, frames);
    this.y = new Lerp(y0, y1 - y0, frames);
  }

  step(fill: (r: Rect) => void): boolean {
    const done = this.x.step();
    this.y.step();
    // ov104_0223EB44: clipped to 0–256 on both axes, nothing when empty.
    let x1 = this.x.value - Math.trunc(this.w / 2);
    let y1 = this.y.value - Math.trunc(this.h / 2);
    let x2 = x1 + this.w;
    let y2 = y1 + this.h;
    if (x2 <= 0 || y2 <= 0 || x1 === x2 || y1 === y2) return done;
    x1 = Math.max(0, x1);
    y1 = Math.max(0, y1);
    x2 = Math.min(256, x2);
    y2 = Math.min(256, y2);
    fill({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    return done;
  }
}

/** Unk_ov104_02241970 (the rows' columns) and Unk_ov104_02241964 (the columns' rows), by direction. */
const COLUMN_ORDER = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [7, 6, 5, 4, 3, 2, 1, 0],
];
const ROW_ORDER = [
  [0, 1, 2, 3, 4, 5],
  [5, 4, 3, 2, 1, 0],
];
/** (256 / 16) × (192 / 32): the blocks of either wipe. */
const BLOCKS = 96;

/**
 * Decomp ov104_0223EBA0 with ov104_0223EBF0(…, frames, interval, window, 15) and the stepper ov104_0223EC34 (`rows`,
 * the Hall: 32 × 16 blocks across the rows) or ov104_0223EE44 (`columns`, the Arcade: 16 × 32 blocks down the columns).
 */
export class BlockWipe {
  private readonly blocks: Block[] = [];
  private readonly rects: Rect[] = [];
  private readonly keys = new Set<string>();
  private started = 0;
  private finished = 0;
  private along = 0;
  private across = 0;
  private dir = 0;
  private timer = 0;
  private active = true;

  constructor(
    private readonly kind: 'rows' | 'columns',
    private readonly frames = 1,
    private readonly interval = 1,
  ) {}

  private fill = (r: Rect) => {
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.rects.push(r);
  };

  /** One frame; true once every block has finished. */
  step(): boolean {
    if (!this.active) return true;
    if (this.started < BLOCKS && --this.timer <= 0) {
      this.timer = this.interval;
      if (this.kind === 'rows') this.startRows();
      else this.startColumns();
      this.started += 4;
    }
    let done = false;
    for (let i = this.finished; i < this.started; i++) {
      done = this.blocks[i]!.step(this.fill);
      if (done) this.finished++;
    }
    if (this.finished >= BLOCKS && done) {
      this.active = false;
      return true;
    }
    return false;
  }

  /** EC34: a 32 px step along rows r, 5 − r, 6 + r and 11 − r (16 px each), the outer pair one way and the inner the other. */
  private startRows(): void {
    const col = (d: number) => 32 * COLUMN_ORDER[d]![this.along]!;
    const row = (r: number) => 8 + r * 16;
    for (const [d, r] of [
      [this.dir, this.across],
      [this.dir ^ 1, 6 - this.across - 1],
      [this.dir, 6 + this.across],
      [this.dir ^ 1, 12 - this.across - 1],
    ] as const) {
      const x = col(d);
      this.blocks.push(new Block(x, x + 32, row(r), row(r), this.frames, 32, 16));
    }
    if (++this.along % 8 === 0) {
      this.dir ^= 1;
      this.across++;
      this.along = 0;
    }
  }

  /** EE44: a 32 px step down columns c, 7 − c, 8 + c and 15 − c (16 px each). */
  private startColumns(): void {
    const rowAt = (d: number) => 32 * ROW_ORDER[d]![this.along]!;
    const colX = (c: number) => 8 + c * 16;
    for (const [d, c] of [
      [this.dir, this.across],
      [this.dir ^ 1, 8 - this.across - 1],
      [this.dir, 8 + this.across],
      [this.dir ^ 1, 16 - this.across - 1],
    ] as const) {
      const y = rowAt(d);
      this.blocks.push(new Block(colX(c), colX(c), y, y + 32, this.frames, 16, 32));
    }
    if (++this.along % 6 === 0) {
      this.dir ^= 1;
      this.across++;
      this.along = 0;
    }
  }

  view(): FrontierWipeView {
    return { kind: 'blocks', rects: this.rects.map((r) => ({ ...r })) };
  }
}

/** 192 / 2: the H-blank table's line pairs. */
const PAIRS = 96;
const HALF = PAIRS / 2;

/** A layer's place for the wipe: its tilemap's origin in room px and its X offset (the decomp reads it for both axes). */
export interface LineLayer {
  origin: { x: number; y: number };
  offset: number;
}

/**
 * Decomp ov104_02231720 (`mode` 1, the Factory) and ov104_02231864 (`mode` 2, the Castle) with ov104_022313FC: each line
 * pair's speed, and its reference point = the layer's X offset (Bg_GetXOffset2, for x and y alike) plus the distance
 * moved, wrapped as the mode does (1: x into 0–255 from below, y mirrored at 0; 2: both by C's remainder, so negative
 * stays off the layer).
 */
export class LineWipe {
  private readonly speeds: { x: number; y: number }[];
  private readonly moved: { x: number; y: number }[];
  bgHidden = false;

  constructor(
    private readonly mode: 1 | 2,
    private readonly layers: { bg: LineLayer; fg: LineLayer },
  ) {
    this.speeds = Array.from({ length: PAIRS }, (_, v) => {
      if (mode === 1) return { x: (HALF - v + 1) % 8, y: Math.trunc((HALF - v + 1) / 4) };
      const x = Math.trunc((HALF - v) / 8) + 1;
      return { x: v % 2 ? -x : x, y: v < HALF ? v : PAIRS - v };
    });
    this.moved = this.speeds.map(() => ({ x: 0, y: 0 }));
  }

  /** One run of the H-blank task: every pair one step further. */
  step(): void {
    this.moved.forEach((m, v) => {
      m.x += this.speeds[v]!.x;
      m.y += this.speeds[v]!.y;
    });
  }

  private points(layer: LineLayer): { x: number; y: number }[] {
    const s16 = (n: number) => ((n + 0x8000) & 0xffff) - 0x8000;
    return this.moved.map((m) => {
      let x = s16(layer.offset + m.x);
      let y = s16(layer.offset + m.y);
      if (this.mode === 2) {
        x %= 256;
        y %= 256;
      } else {
        if (x < 0) x += 256;
        if (y < 0) y = -y;
        x %= 256;
      }
      return { x: layer.origin.x + x, y: layer.origin.y + y };
    });
  }

  view(): FrontierWipeView {
    return { kind: 'lines', bg: this.points(this.layers.bg), fg: this.points(this.layers.fg), bgHidden: this.bgHidden };
  }
}
