/**
 * Drawing the trainer card signature (decomp src/applications/signature.c): pen samples in signature-window
 * pixels (0..191, 0..63; the DS's touch point less the window's 32, 72). The first sample of a stroke only
 * sets the start; each later one draws a line from the previous sample (SignatureApp_DrawLine, Bresenham
 * stepping along the longer axis), stamping the 2×2 pen at (x + 1, y + 1) of its 4×4 brush
 * (sBrushData[0][0]) at every step, clipped to the window.
 */
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from '@opensinnoh/contracts';

export interface PenPoint {
  x: number;
  y: number;
}

/** The pen's 2×2 dot of the 4×4 brush whose top-left is (x, y). */
function stamp(px: Uint8Array, x: number, y: number): void {
  for (let dy = 1; dy <= 2; dy++)
    for (let dx = 1; dx <= 2; dx++) {
      const X = x + dx;
      const Y = y + dy;
      if (X >= 0 && Y >= 0 && X < SIGNATURE_WIDTH && Y < SIGNATURE_HEIGHT) px[Y * SIGNATURE_WIDTH + X] = 1;
    }
}

/** Decomp SignatureApp_DrawLine from `from` to `to` (both stamped), as the DS steps it. */
export function penLine(px: Uint8Array, from: PenPoint, to: PenPoint): void {
  let x = from.x;
  let y = from.y;
  let maxX = to.x;
  let maxY = to.y;
  const dx = Math.abs(maxX - x);
  const dy = Math.abs(maxY - y);
  if (dx > dy) {
    let stepY: number;
    if (x > maxX) {
      stepY = y > maxY ? 1 : -1;
      [x, maxX] = [maxX, x];
      y = maxY;
    } else stepY = y < maxY ? 1 : -1;
    stamp(px, x, y);
    let acc = dx >> 1;
    while (++x <= maxX) {
      if ((acc -= dy) < 0) {
        acc += dx;
        y += stepY;
      }
      stamp(px, x, y);
    }
  } else {
    let stepX: number;
    if (y > maxY) {
      stepX = x > maxX ? 1 : -1;
      [y, maxY] = [maxY, y];
      x = maxX;
    } else stepX = x < maxX ? 1 : -1;
    stamp(px, x, y);
    let acc = dy >> 1;
    while (++y <= maxY) {
      if ((acc -= dx) < 0) {
        acc += dy;
        x += stepX;
      }
      stamp(px, x, y);
    }
  }
}

/** A signature being drawn: the pixels and the stroke's last sample (null between strokes). */
export class SignaturePad {
  readonly pixels: Uint8Array;
  private last: PenPoint | null = null;

  constructor(pixels?: Uint8Array) {
    this.pixels = pixels ?? new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
  }

  /** Pen samples of the current stroke, in order. */
  pen(points: PenPoint[]): void {
    for (const p of points) {
      if (this.last) penLine(this.pixels, this.last, p);
      this.last = p;
    }
  }

  /** The pen lifted: the next sample starts a new stroke. */
  up(): void {
    this.last = null;
  }

  /** Decomp SignatureApp_ConfirmReset YES: the window is filled blank. */
  clear(): void {
    this.pixels.fill(0);
    this.last = null;
  }
}
