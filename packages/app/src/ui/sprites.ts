/**
 * ROM sprites and BG pictures on DS boards (board.ts): a sheet cell drawn with its origin at a DS position,
 * as the DS places an OBJ, and a one-cell BG picture at a DS rect. Both return null when the pack has no
 * such sheet (the fixture), so the views can draw their own stand-in.
 */
import type { DrawContext } from './apps.ts';
import { at } from './board.ts';
import './ds-screen.css';
import { el } from './core.ts';

/** The cell of an animation's first frame (NANR sequence order), or null without the sheet. */
export function animCell(d: DrawContext, path: string, anim: number): number | null {
  const sheet = d.art.sheet(path);
  if (!sheet) return null;
  const a = sheet.animations?.[anim];
  if (!a) throw new Error(`ui: sheet ${path} has no animation ${anim}`);
  return a.frames[0]!.cell;
}

/** A cell (index or name) with its origin at DS (x, y) on the board; null without the sheet. */
export function sprite(d: DrawContext, path: string, cell: number | string, x: number, y: number, className = ''): HTMLElement | null {
  const sheet = d.art.sheet(path);
  if (!sheet) return null;
  const i = typeof cell === 'number' ? cell : (sheet.names?.indexOf(cell) ?? -1);
  const c = sheet.cells[i];
  if (!c) throw new Error(`ui: sheet ${path} has no cell ${cell}`);
  const node = el('span', `ds-sprite ${className}`.trim(), d.art.cells(path, [i], d.unit)!);
  node.setAttribute('aria-hidden', 'true');
  return at(node, x - c.ox, y - c.oy, c.w, c.h);
}

/** A tap-only control (not a cursor stop). */
export function tapButton(d: DrawContext, id: string, className: string, content: Node[], label?: string): HTMLButtonElement {
  const b = el('button', className, ...content);
  b.type = 'button';
  b.dataset.tap = id;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    d.tap(id);
  });
  return b;
}

/** A one-cell BG picture at DS (x, y), or null without the sheet. */
export function bgPicture(d: DrawContext, path: string, x: number, y: number, className = ''): HTMLElement | null {
  const node = d.art.picture(el('span', `ds-picture ${className}`.trim()), path);
  if (!node) return null;
  node.setAttribute('aria-hidden', 'true');
  const cell = d.art.sheet(path)!.cells[0]!;
  return at(node, x, y, cell.w, cell.h);
}
