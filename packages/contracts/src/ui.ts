/**
 * UI surfaces and input.
 * - `main`: the 3D field view fills the screen, with the message box and yes/no box drawn on top.
 * - `panel`: the DS bottom screen's content as a logical 256×192 surface. It is shown as an overlay
 *   card over the field only while it has content (single screen, no split view).
 */
import type { Button } from '@opensinnoh/core';

export const PANEL_WIDTH = 256;
export const PANEL_HEIGHT = 192;

/**
 * Input sampled once per tick. `pressed` = held now but not last tick. Touch is in panel coordinates, or,
 * with `screen: 'main'`, in DS pixels of the 256×192 main screen as `DrawScriptOverlay` places it (a tap on
 * a scripted menu or the yes/no box).
 */
export interface InputFrame {
  held: Button[];
  pressed: Button[];
  touch: { x: number; y: number; screen?: 'panel' | 'main' } | null;
  /**
   * A tap or click on the open menu app (0.11.0): the tap id of an element of its `AppView` (ids per
   * view below). One tick only; replays send it with `tap <id>`.
   */
  tap?: string;
}

/** What the panel shows; the VM sets it, the app draws it and maps touches back to option ids. */
export type PanelView =
  | { kind: 'idle'; title: string }
  | { kind: 'choice'; title: string; options: { id: string; label: string }[]; cursor: number };

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CHOICE_TITLE_HEIGHT = 28;
const CHOICE_MARGIN = 8;
const CHOICE_GAP = 6;
const CHOICE_MAX_HEIGHT = 44;

/** Option rectangles of a 'choice' panel, in panel coordinates. The app draws these; the VM hit-tests touches against them. */
export function choiceRects(count: number): PanelRect[] {
  if (count < 1) return [];
  const avail = PANEL_HEIGHT - CHOICE_TITLE_HEIGHT - CHOICE_MARGIN;
  const height = Math.min(CHOICE_MAX_HEIGHT, Math.floor((avail - CHOICE_GAP * (count - 1)) / count));
  return Array.from({ length: count }, (_, i) => ({ x: CHOICE_MARGIN, y: CHOICE_TITLE_HEIGHT + i * (height + CHOICE_GAP), width: PANEL_WIDTH - 2 * CHOICE_MARGIN, height }));
}

/** Index of the choice option under a panel point, or -1. */
export function hitChoice(count: number, point: { x: number; y: number }): number {
  return choiceRects(count).findIndex((r) => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height);
}

/**
 * A scripted multichoice or list menu (decomp FieldMenuManager), a VM-owned box on the main screen. Geometry
 * is in DS pixels of the 256×192 main screen: `x`/`y` is the window interior (the frame is drawn around it).
 * Entries are column-major (`rows` per column). A list menu has one column and shows `rows` entries from `top`.
 */
export interface MenuView {
  entries: string[];
  cursor: number;
  columns: number;
  rows: number;
  top: number;
  x: number;
  y: number;
  /** Interior width of one column. */
  width: number;
}

/** Row height and text inset of menu entries (decomp GLYPH_ROW_HEIGHT, CURSOR_MARGIN_SIZE). */
export const MENU_ROW_HEIGHT = 16;
export const MENU_TEXT_X = 12;

/** Main-screen rectangle of every entry (null when a list has it scrolled out of view). */
export function menuRects(menu: MenuView): (PanelRect | null)[] {
  return menu.entries.map((_, i) => {
    const k = i - menu.top;
    const col = Math.floor(k / menu.rows);
    if (k < 0 || col >= menu.columns) return null;
    return { x: menu.x + col * menu.width, y: menu.y + (k % menu.rows) * MENU_ROW_HEIGHT, width: menu.width, height: MENU_ROW_HEIGHT };
  });
}

/** Index of the menu entry under a main-screen point, or -1. */
export function hitMenu(menu: MenuView, point: { x: number; y: number }): number {
  return menuRects(menu).findIndex((r) => r !== null && point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height);
}
