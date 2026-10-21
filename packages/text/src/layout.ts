/**
 * Static layout of a message: markup → pages of lines with pixel widths, as the DS message box shows
 * them (2 visible lines; {clear} starts a new page, {scroll} keeps the last line and continues below).
 * Gen 4 text carries its own line breaks, so nothing is wrapped here; `overflow` reports lines wider
 * than the box.
 */
import type { LoadedFont } from '@opensinnoh/contracts';
import { toPrintOps, VISIBLE_LINES } from './printer.ts';

/** Message window interior on the 256×192 main screen (decomp field message window: tiles 2,19, 27×4). */
export const MESSAGE_BOX = { x: 16, y: 152, width: 216, height: 32 } as const;

export type Measure = (s: string) => number;

/** Width in pixels of a string with a loaded font (unknown chars use the cell width). */
export function measureWith(font: Pick<LoadedFont, 'glyph' | 'cellWidth'>): Measure {
  return (s) => {
    let w = 0;
    for (const c of s) w += font.glyph.get(c)?.width ?? font.cellWidth;
    return w;
  };
}

export interface LaidOutLine {
  text: string;
  width: number;
}
export interface Page {
  lines: LaidOutLine[];
  /** How the page ends: wait-and-clear, wait-and-scroll, or end of message. */
  end: 'clear' | 'scroll' | 'end';
}

export function layoutMessage(markup: string, slots: readonly (string | undefined)[], measure: Measure): Page[] {
  const pages: Page[] = [];
  let lines = [''];
  const finish = (end: Page['end']) => pages.push({ lines: lines.map((text) => ({ text, width: measure(text) })), end });
  for (const op of toPrintOps(markup, slots)) {
    if (op.kind === 'char') lines[lines.length - 1] += op.c;
    else if (op.kind === 'newline') lines.push('');
    else if (op.kind === 'clear') {
      finish('clear');
      lines = [''];
    } else if (op.kind === 'scroll') {
      finish('scroll');
      lines = [lines[lines.length - 1]!, ''];
    }
  }
  finish('end');
  return pages;
}

/** Lines that do not fit the message box (too wide, or more than 2 lines on a page). */
export function overflow(pages: readonly Page[], width = MESSAGE_BOX.width): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (p.lines.length > VISIBLE_LINES) out.push(`page has ${p.lines.length} lines: ${p.lines.map((l) => l.text).join(' / ')}`);
    for (const l of p.lines) if (l.width > width) out.push(`line is ${l.width}px wide: ${l.text}`);
  }
  return out;
}
