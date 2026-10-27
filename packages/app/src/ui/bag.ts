/**
 * The bag on the DS screen (decomp applications/bag: main.c, sprites.c, windows.c), one 256 × 192 board
 * at the UI unit: the ROM screen (`bag/screen`), the bag picture for the pocket (the player's bag, male or
 * female), the pocket icons with the highlight and the arrows, the pocket name, the item list (9 rows of
 * 16 px on the DS; here the rows inside the list frame, scrolling with the cursor), the item's icon and
 * description, and the action window, toss count, YES/NO and message box at their DS windows. Without the
 * sheets (the fixture) our own CSS stands in for the ROM pictures at the same places.
 */
import type { BagView } from '@opensinnoh/contracts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { at, atTiles, board, boardContext } from './board.ts';
import { el } from './core.ts';
import { animCell, bgPicture, sprite, tapButton } from './sprites.ts';
import './bag.css';

/** sprites.c sBagUISpriteTemplates (sprite positions: the cell's origin). */
const SPRITES = { bag: [48, 50], prevArrow: [2, 96], nextArrow: [98, 96], item: [22, 172] } as const;
/** BagUI_DrawPocketSelectorIcons: the icons' row (window at tile row 11, + 3 px), 10 px icons. */
const ICON_Y = 91;
const ICON = 10;
/**
 * The list: window BAG_UI_WINDOW_ITEM_LIST at x 112 (tile 14), 16-px rows; the item highlight at x 177 (centre) over a 152-px
 * cell, so its last column falls just past the screen's edge (the board clips it, as the DS screen does).
 */
const LIST = { x: 104, y: 8, w: 153, h: 128, textX: 112, row: 16, highlightX: 177 };
/** windows.c: the count's right edge (ITEM_COUNT_NUMBER_START_POS) and the SELECT mark's x in the list window. */
const COUNT_RIGHT = 17 * 8 - 2;
const REGISTERED_X = 96;
/** The description window (0, 18) 32 × 6 tiles, text from x 40. */
const DESCRIPTION = { x: 40, y: 144, w: 216, h: 48 };

export function bag(wide: DrawContext, v: BagView): HTMLElement {
  const d = boardContext(wide);
  const root = board(`ds-screen bag-board bag-${v.mode}`);
  const types = v.pocketTypes;
  if (types.length !== v.pockets.length) throw new Error(`ui: the bag has ${v.pockets.length} pockets and ${types.length} pocket types`);
  const screen = bgPicture(d, 'bag/screen', 0, 0);
  root.classList.toggle('rom', !!screen);
  if (screen) root.dataset.backdrop = 'bag/screen';
  root.append(screen ?? at(el('span', 'bag-css-screen'), 0, 0, 256, 192));
  const bagSheet = `bag/bag_${d.gender ?? 'male'}`;
  const bagCell = animCell(d, bagSheet, types[v.pocket]!);
  if (bagCell !== null) root.append(sprite(d, bagSheet, bagCell, SPRITES.bag[0], SPRITES.bag[1], 'bag-picture')!);
  root.append(...pockets(d, v, types));

  // The item list (the DS's ListMenu rows; the cursor row carries the item highlight).
  const list = at(el('div', 'item-list'), LIST.x, LIST.y, LIST.w, LIST.h);
  list.dataset.scrolls = '';
  list.setAttribute('role', 'tabpanel');
  const highlight = () => sprite(d, 'bag/item_highlight', 0, LIST.highlightX - LIST.x, LIST.row / 2, 'item-highlight');
  v.rows.forEach((r, i) => {
    const content: Node[] = [el('span', 'item-name', d.text(r.label))];
    if (r.registered) content.push(sprite(d, 'bag/entry_icons', 'registered', REGISTERED_X + LIST.textX - LIST.x, 0, 'registered-mark') ?? el('span', 'registered-mark css', 'SELECT'));
    if (r.count) content.push(el('span', 'count', d.text(r.count)));
    const row = stop(d, `row:${i}`, content, 'item-row', v.cursor === i);
    row.dataset.item = r.item;
    row.tabIndex = v.cursor === i ? 0 : -1;
    if (v.cursor === i) row.prepend(...[highlight()].filter((x) => x !== null));
    list.append(row);
  });
  const cancel = stop(d, 'cancel', [el('span', 'item-name', d.text(v.cancel))], 'item-row cancel', v.cursor === v.rows.length);
  if (v.cursor === v.rows.length) cancel.prepend(...[highlight()].filter((x) => x !== null));
  cancel.tabIndex = v.cursor === v.rows.length ? 0 : -1;
  list.append(cancel);
  list.classList.toggle('rom', !!d.art.sheet('bag/item_highlight'));
  list.style.setProperty('--count-right', String(LIST.w - (LIST.textX - LIST.x) - COUNT_RIGHT));
  root.append(list);

  // The selected item's icon and description (BAG_SPRITE_ITEM; the description window).
  const selected = v.rows[v.cursor];
  if (selected) root.append(at(el('span', 'bag-item-icon', d.art.itemIcon(selected.item, true)), SPRITES.item[0] - 16, SPRITES.item[1] - 16, 32, 32));
  root.append(at(el('div', 'item-panel-text', d.flow(v.description, true, 'light')), DESCRIPTION.x, DESCRIPTION.y, DESCRIPTION.w, DESCRIPTION.h));

  if (v.menu || v.message || v.quantity || v.yesNo) for (const e of [...root.children]) (e as HTMLElement).inert = true;
  root.append(...overlays(d, v));
  return root;
}

/**
 * The pocket icons (BagUI_DrawPocketSelectorIcons) as tabs, the highlight, the arrows and the pocket's name. As on the DS
 * (InitSprites), one pocket has no arrows and the Poffin bag (BAG_MODE_POFFIN_*) no highlight.
 */
function pockets(d: DrawContext, v: BagView, types: number[]): HTMLElement[] {
  const n = v.pockets.length;
  // main.c: pocketSelectorIconsX and pocketSelectorIconsSpacing.
  const iconsX = 6 + Math.floor((90 - ICON * n) / (n + 1));
  const spacing = ICON + iconsX - 6;
  const tabs = el('div', 'pocket-tabs');
  tabs.setAttribute('role', 'tablist');
  v.pockets.forEach((p, i) => {
    const on = i === v.pocket;
    const icon = d.art.cells('bag/pocket_icons', [types[i]! * 2 + (on ? 1 : 0)], d.unit);
    const tab = tapButton(d, `pocket:${i}`, `pocket-tab${on ? ' on' : ''}`, [...(icon ? [icon] : []), el('span', 'sr-only', p)]);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    tab.title = p;
    tabs.append(at(tab, iconsX + spacing * i - (spacing - ICON) / 2, ICON_Y - 3, spacing, 16));
  });
  const out: HTMLElement[] = [tabs];
  const hl = v.mode === 'poffin' ? null : sprite(d, 'bag/pocket_highlight', 0, iconsX + spacing * v.pocket + ICON / 2, ICON_Y + ICON / 2, 'pocket-highlight');
  if (hl) out.push(hl);
  const arrow = (dir: 'prev' | 'next') => {
    const [x, y] = dir === 'prev' ? SPRITES.prevArrow : SPRITES.nextArrow;
    // sprites.c: the left arrow plays animation 1, the right 0.
    const cell = animCell(d, 'bag/arrows', dir === 'prev' ? 1 : 0);
    const art = cell === null ? null : sprite(d, 'bag/arrows', cell, x, y);
    if (art) out.push(art);
    out.push(at(tapButton(d, dir, `pocket-arrow ${dir}${art ? ' rom' : ''}`, [], dir === 'prev' ? 'Previous pocket' : 'Next pocket'), Math.max(0, x - 8), y - 8, dir === 'prev' ? 12 : 14, 16));
  };
  if (n > 1) {
    arrow('prev');
    arrow('next');
  }
  // windows.c PrintPocketNameCentered: centred at x 50, 2 px into the window at tile row 13.
  out.push(at(el('div', 'pocket-name', d.text(v.pockets[v.pocket]!)), 0, 106, 100, 16));
  return out;
}

/** The DS windows over the screen: the action menu, the toss count, YES/NO and the message box. */
function overlays(d: DrawContext, v: BagView): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (v.menu) {
    // windows.c BagUI_ShowItemActionsMenu: 7 tiles wide at tile x 24, its bottom at row 23 (frame included here).
    const n = v.menu.entries.length;
    const list = el('div', 'app-menu-list');
    v.menu.entries.forEach((e, i) => list.append(stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', i === v.menu!.cursor)));
    const w = atTiles(framed(d, 'app-menu', list), 23, 22 - 2 * n, 9, 2 * n + 2);
    w.setAttribute('role', 'menu');
    out.push(w);
  }
  if (v.message) {
    // The message box over the description (the narrow one beside the toss count).
    out.push(atTiles(messageBox(d, v.message.text, v.message.waiting), 0, 18, v.quantity ? 23 : 32, 6));
  }
  if (v.quantity) {
    // BAG_UI_WINDOW_THROW_AWAY_COUNT (24, 19) 7 × 4 tiles; the count arrows at x 220, y 156 / 180 (sprites.c).
    out.push(atTiles(framed(d, 'qty-window'), 23, 18, 9, 6));
    const step = (id: string, label: string, cls: string, x: number, y: number, w: number) => at(tapButton(d, id, `qty-step ${cls}`, [], label), x, y, w, 16);
    out.push(
      step('qty:+1', 'One more', 'up', 212, 144, 16),
      step('qty:-1', 'One fewer', 'down', 212, 176, 16),
      step('qty:-10', 'Ten fewer', 'down10', 192, 160, 12),
      step('qty:+10', 'Ten more', 'up10', 244, 160, 12),
      at(stop(d, 'ok', [d.text(v.quantity.count)], 'qty-count', true), 204, 160, 40, 16),
    );
  }
  if (v.yesNo) {
    // sYesNoMenuTemplate: (23, 13) 7 × 4 tiles.
    const yn = v.yesNo;
    out.push(atTiles(framed(d, 'yes-no', stop(d, 'yes', [d.text(yn.yes)], 'choice', yn.cursor === 0), stop(d, 'no', [d.text(yn.no)], 'choice', yn.cursor === 1)), 22, 12, 9, 6));
  }
  return out;
}
