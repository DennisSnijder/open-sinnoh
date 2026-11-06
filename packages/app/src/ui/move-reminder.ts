/**
 * The move relearner's screen (`MoveReminderView`) on its DS screen (decomp applications/move_reminder.c window
 * templates and sprite positions): the battle-moves page (`move_reminder/background`), the labels and the selected
 * move's category icon (116, 8), power, accuracy, PP and description, the list of moves (window at tiles 21,3; rows
 * 16 px; their type icons at x 152) with the selector (196, 32 + 16·row) and the scroll arrows (196, 20 and 140), the
 * message box (the DS's 2,19 27×4 window in its frame) and YES/NO (23,13). The contest page's side arrows wait for contests. A 256×192 board at the
 * UI unit; packs without the art (the fixture) get CSS stand-ins in the same rects.
 */
import type { MoveReminderView } from '@opensinnoh/contracts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { at, atTiles, board, boardContext } from './board.ts';
import { el } from './core.ts';
import { sprite, textColor } from './party.ts';
import type { Palette } from './pixel-font.ts';
import './move-reminder.css';
import { S } from '../strings/index.ts';

/** Window rects in tiles (sWindowTemplates). */
const W = {
  title: [19, 0, 11, 2],
  category: [1, 0, 6, 2],
  power: [1, 2, 6, 2],
  accuracy: [1, 4, 8, 2],
  pp: [1, 6, 3, 2],
  powerValue: [13, 2, 3, 2],
  accuracyValue: [13, 4, 3, 2],
  ppValue: [11, 6, 5, 2],
  description: [1, 8, 15, 10],
  message: [0, 18, 32, 6],
  list: [21, 3, 11, 14],
  yesNo: [23, 13, 7, 4],
} as const;
type Rect = readonly [number, number, number, number];
const ROW = 16;
const LIST = { x: 21 * 8, y: 3 * 8 };
const SELECTOR = { x: 196, y: 32 };
const TYPE_X = 152;
const CATEGORY = { x: 116, y: 8 };
const ARROWS = { x: 196, up: 20, down: 140 };

function label(d: DrawContext, s: string, palette: Palette, rect: Rect, align: 'left' | 'right' | 'center' = 'left'): HTMLElement {
  return atTiles(el('span', `sum-text ${align}`, d.text(s, palette)), ...rect);
}

function icon(d: DrawContext, type: Parameters<DrawContext['art']['typeIcon']>[0], cx: number, cy: number): HTMLElement {
  const art = d.art.typeIcon(type, d.unit);
  return at(art ? el('span', 'type-icon', art) : el('span', `type-chip t-${String(type).slice(String(type).indexOf(':') + 1).toLowerCase()}`), cx - 16, cy - 8, 32, 16);
}

export function moveReminder(wide: DrawContext, v: MoveReminderView): HTMLElement {
  const d = boardContext(wide);
  const white = textColor(d, 'summary/text', 'white', 'light');
  const black = textColor(d, 'summary/text', 'black', 'ink');
  const root = board('move-reminder-screen');
  const bg = d.art.cells('move_reminder/background', [0], d.unit);
  if (d.art.sheet('move_reminder/background')) root.dataset.backdrop = 'move_reminder/background';
  root.append(at(bg ? el('span', 'mr-bg', bg) : el('span', 'mr-bg css'), 0, 0, 256, 192));

  root.append(label(d, v.labels.title, white, W.title, 'center'));
  const dt = v.detail;
  if (dt) {
    root.append(label(d, v.labels.category, white, W.category), label(d, dt.power.label, white, W.power), label(d, dt.accuracy.label, white, W.accuracy), label(d, v.labels.pp, black, W.pp));
    root.append(icon(d, dt.category, CATEGORY.x, CATEGORY.y));
    root.append(label(d, dt.power.value, black, W.powerValue, 'center'), label(d, dt.accuracy.value, black, W.accuracyValue, 'center'));
    root.append(label(d, v.rows[v.cursor]!.pp, black, W.ppValue, 'center'));
    root.append(atTiles(el('div', 'mr-desc', d.flow(dt.description, false, black)), ...W.description));
  }

  // The list: 7 rows from `top` (the moves, then CANCEL), each a tap target; type icons beside the moves.
  const rows = [...v.rows.map((r) => r.name), v.cancel];
  for (let k = 0; k < v.visible && v.top + k < rows.length; k++) {
    const i = v.top + k;
    const id = i === v.rows.length ? 'cancel' : `row:${i}`;
    const b = stop(d, id, [d.text(rows[i]!, black)], 'mr-row', i === v.cursor);
    root.append(at(b, LIST.x, LIST.y + k * ROW, 88, ROW));
    if (i < v.rows.length) root.append(icon(d, v.rows[i]!.type, TYPE_X, SELECTOR.y + k * ROW));
  }
  const sel = sprite(d, 'move_reminder/selector', 0, SELECTOR.x, SELECTOR.y + (v.cursor - v.top) * ROW, 'mr-selector') ?? at(el('span', 'mr-selector css'), SELECTOR.x - 64, SELECTOR.y - 8 + (v.cursor - v.top) * ROW, 128, 16);
  root.append(sel);
  if (!v.yesNo && !v.message?.waiting) {
    const arrow = (dir: 'up' | 'down', show: boolean) => {
      if (!show) return;
      const s = sprite(d, 'move_reminder/arrows', dir === 'up' ? 0 : 1, ARROWS.x, dir === 'up' ? ARROWS.up : ARROWS.down, `mr-arrow ${dir}`);
      const b = el('button', `mr-arrow-tap ${dir}`, ...(s ? [s] : []));
      b.type = 'button';
      b.dataset.tap = dir;
      b.setAttribute('aria-label', S.aria.scroll(dir === 'up'));
      b.addEventListener('click', () => d.tap(dir));
      root.append(at(b, ARROWS.x - 16, (dir === 'up' ? ARROWS.up : ARROWS.down) - 8, 32, 16));
    };
    arrow('up', v.top > 0);
    arrow('down', v.top + v.visible < rows.length);
  }
  if (v.message) root.append(atTiles(messageBox(d, v.message.text, v.message.waiting), ...W.message));
  if (v.yesNo) root.append(atTiles(framed(d, 'yes-no', stop(d, 'yes', [d.text(v.yesNo.yes)], 'choice', v.yesNo.cursor === 0), stop(d, 'no', [d.text(v.yesNo.no)], 'choice', v.yesNo.cursor === 1)), ...W.yesNo));
  root.setAttribute('aria-label', v.message?.text ?? v.mon.name);
  return root;
}
