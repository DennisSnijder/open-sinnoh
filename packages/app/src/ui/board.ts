/**
 * DS boards: a screen laid out in DS pixels (decomp window and sprite positions) at the UI unit (`DrawContext.unit`,
 * whole device pixels per DS pixel; layout.ts `uiScales`). Inside a board `--dot` is the unit, so ROM frames,
 * text and art all draw one DS pixel per unit, and every child sits at its DS rect.
 */
import type { DrawContext } from './apps.ts';
import { el } from './core.ts';

/** The DS screen. */
export const DS_WIDTH = 256;
export const DS_HEIGHT = 192;

/** The draw context for a board: text and art at the unit. */
export function boardContext(d: DrawContext): DrawContext {
  const u = d.unit;
  return { ...d, scale: u, text: (s, p, c, k = u) => d.text(s, p, c, k), flow: (s, l, p, k = u) => d.flow(s, l, p, k) };
}

/** A board element of `width` × `height` DS px (`board` plus `className`); children go at DS rects with `at`. */
export function board(className: string, width = DS_WIDTH, height = DS_HEIGHT, ...children: Node[]): HTMLElement {
  const b = el('div', `board ${className}`, ...children);
  b.style.setProperty('--board-w', String(width));
  b.style.setProperty('--board-h', String(height));
  return b;
}

/** Places `node` at a DS px rect of its board (no size: its own). */
export function at<T extends HTMLElement>(node: T, x: number, y: number, width?: number, height?: number): T {
  node.classList.add('board-at');
  node.style.setProperty('--at-x', String(x));
  node.style.setProperty('--at-y', String(y));
  if (width !== undefined) node.style.setProperty('--at-w', String(width));
  if (height !== undefined) node.style.setProperty('--at-h', String(height));
  return node;
}

/** Places `node` at a DS tile rect (8 px tiles, as decomp WindowTemplates give them). */
export function atTiles<T extends HTMLElement>(node: T, x: number, y: number, width: number, height: number): T {
  return at(node, x * 8, y * 8, width * 8, height * 8);
}

/**
 * Two DS screens of one app shown together (the PC's compare mode, the trainer card and its badge case): side by
 * side or stacked, whichever gives the larger unit in the room; the first is the DS's top screen.
 */
export function dsPair(d: DrawContext, className: string, top: HTMLElement, touch: HTMLElement): HTMLElement {
  const s = d.size ?? { width: innerWidth, height: innerHeight };
  const side = Math.min(s.width / (2 * DS_WIDTH), s.height / DS_HEIGHT) >= Math.min(s.width / DS_WIDTH, s.height / (2 * DS_HEIGHT));
  // Stacked, a phone's backdrop changes colour where the touch screen starts.
  if (!side) touch.dataset.backdropSplit = '';
  return el('div', `ds-screen ds-pair ${className} ${side ? 'side' : 'stacked'}`, top, touch);
}
