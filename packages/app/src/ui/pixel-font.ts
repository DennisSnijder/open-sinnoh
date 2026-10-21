/**
 * The game's own message font in DOM UI: labels are small canvases drawn with the imported bitmap
 * font at an integer device-pixel scale (crisp at any devicePixelRatio), recoloured per palette.
 * Each label also carries its text in a visually hidden span, so it has an accessible name.
 */
import type { LoadedFont } from '@opensinnoh/contracts';
import { drawText } from '@opensinnoh/text';

/** Foreground and shadow colours (the atlas has two inks: dark foreground, light shadow). */
export const PALETTES = {
  /** Dark text on the paper windows (the DS look). */
  ink: ['#484848', '#d0d0c8'],
  /** Light text on the slate title bars. */
  light: ['#f8f8f8', '#5a6070'],
  /** The selected row. */
  focus: ['#283048', '#b8c8e8'],
  /** Pokétch LCD. */
  lcd: ['#203820', '#88b088'],
  /** The options' chosen value (the system font's colours 3 and 4: options_menu.c TEXT_COLOR(3, 4, 15)). */
  chosen: ['#d03830', '#f0c0b8'],
  /** Muted (disabled, hints). */
  muted: ['#8a8a90', '#e4e4de'],
  /** The main menu's player info, by gender (decomp RenderContinueOption TEXT_COLOR(7, 8, 15) / (3, 4, 15)). */
  male: ['#3058c8', '#b8c8f0'],
  female: ['#d03830', '#f0c0b8'],
} as const;
/** A named palette, or a sheet's own `[foreground, shadow]` (`Ui2dSheet.textColors`, e.g. the trainer card). */
export type Palette = keyof typeof PALETTES | readonly [string, string];

const LINE_HEIGHT = 16;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export class PixelFont {
  private readonly tinted = new Map<string, LoadedFont>();

  constructor(private readonly font: LoadedFont) {}

  /** Width of a line in font pixels (unknown characters take a cell, as `drawText` does). */
  measure(s: string): number {
    let w = 0;
    for (const c of s) w += this.font.glyph.get(c)?.width ?? this.font.cellWidth;
    return w;
  }

  private palette(p: Palette): LoadedFont {
    const key = typeof p === 'string' ? p : p.join();
    let f = this.tinted.get(key);
    if (f) return f;
    const src = this.font.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [fg, shadow] = (typeof p === 'string' ? PALETTES[p] : p).map(hex) as [[number, number, number], [number, number, number]];
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const c = px[i]! < 140 ? fg : shadow;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
    ctx.putImageData(img, 0, 0);
    f = { ...this.font, image: canvas };
    this.tinted.set(key, f);
    return f;
  }

  /** A canvas showing `text` (lines split on \n) at `scale` CSS px per font pixel, snapped to whole device pixels. */
  canvas(text: string, palette: Palette, scale: number): HTMLCanvasElement {
    const lines = text.split('\n');
    const width = Math.max(1, ...lines.map((l) => this.measure(l)));
    const height = lines.length * LINE_HEIGHT;
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.round(scale * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = width * k;
    canvas.height = height * k;
    canvas.style.width = `${(width * k) / dpr}px`;
    canvas.style.height = `${(height * k) / dpr}px`;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const font = this.palette(palette);
    lines.forEach((line, i) => drawText(ctx, font, line, 0, i * LINE_HEIGHT * k, k));
    return canvas;
  }

  /** Draws one line onto a canvas at an integer scale (e.g. the Pokétch LCD at 1:1). */
  draw(ctx: CanvasRenderingContext2D, text: string, palette: Palette, x: number, y: number, scale = 1): void {
    ctx.imageSmoothingEnabled = false;
    drawText(ctx, this.palette(palette), text, x, y, scale);
  }

  /**
   * Text that wraps to its box, as the DS's fixed-width windows break it: one canvas per word in a wrapping
   * row, a space's width apart. `lines` keeps the text's own line breaks (each line wraps only when it does
   * not fit: messages); otherwise the lines are joined and reflowed (descriptions).
   */
  flow(text: string, palette: Palette, scale: number, lines: boolean, className = 'px-flow'): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = className;
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.round(scale * dpr));
    span.style.setProperty('--space', `${(this.measure(' ') * k) / dpr}px`);
    const row = (words: string[]) => {
      const r = document.createElement('span');
      r.className = 'px-flow-line';
      r.style.minHeight = `${(LINE_HEIGHT * k) / dpr}px`;
      for (const w of words) if (w) r.append(this.canvas(w, palette, scale));
      return r;
    };
    const paragraphs = lines ? text.split('\n') : [text.replace(/\n/g, ' ')];
    for (const p of paragraphs) span.append(row(p.split(' ')));
    const hidden = document.createElement('span');
    hidden.className = 'sr-only';
    hidden.textContent = text.replace(/\n/g, ' ');
    span.append(hidden);
    return span;
  }

  /** A label element: the pixel canvas plus the same text for assistive technology. */
  label(text: string, palette: Palette, scale: number, className = 'px'): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = className;
    const hidden = document.createElement('span');
    hidden.className = 'sr-only';
    hidden.textContent = text.replace(/\n/g, ' ');
    span.append(this.canvas(text, palette, scale), hidden);
    return span;
  }
}
