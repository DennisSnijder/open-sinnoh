/**
 * The DOM for each menu app's `AppView` (packages/menus owns the state). Nothing here keeps state: the
 * view is redrawn when it changes, and a tap or click sends the element's tap id (`InputFrame.tap`), so
 * the browser runs exactly what a headless replay runs. Windows use the ROM's frames (`ui2d/windows`)
 * where the pack has them. Layout: docs/ui/design.md §3 and docs/research/menus-and-services.md §3.
 */
import type { AppView, MartView, Registries, SaveView, StartMenuView } from '@opensinnoh/contracts';
import { trainerCard } from './apps-m3a.ts';
import { bag } from './bag.ts';
import { naming } from './naming.ts';
import { storage } from './storage.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { drawPokedex } from './dex.ts';
import { evolution } from './evolution.ts';
import { hatch } from './hatch.ts';
import { libraryTv } from './library-tv.ts';
import { diploma, journal } from './journal.ts';
import { townMap } from './town-map.ts';
import { rowanIntro } from './rowan-intro.ts';
import { moveReminder } from './move-reminder.ts';
import { trade } from './trade.ts';
import { easyChat, mysteryGift } from './mystery-gift.ts';
import { itemWheel } from './item-wheel.ts';
import { poffinCase, poffinCooking, poffinFeed } from './poffin.ts';
import { mining, miningPrompt, undergroundBase, undergroundMenu, undergroundPc, undergroundTrap, undergroundVendor } from './underground.ts';
import { contestApp } from './contest.ts';
import { contestDance } from './contest-dance.ts';
import { contestPhoto, galleryDressUp, galleryPhoto } from './contest-visual.ts';
import { capsuleEditor } from './capsule.ts';
import { slots } from './slots.ts';
import { arcadeApp, frontierRecords, castleApp, factoryApp, hallBoard } from './frontier.ts';
import { credits, hallOfFame } from './hall-of-fame.ts';
import { icon, type IconName } from './icons.ts';
import { party } from './party.ts';
import { summary } from './summary.ts';
import { at, atTiles, board, boardContext } from './board.ts';
import { bgPicture } from './sprites.ts';
import type { Palette } from './pixel-font.ts';
import type { OptionsScreen } from './options-screen.ts';
import { S } from '../strings/index.ts';

export interface DrawContext {
  /** A label in the game font; `scale` (CSS px per font px) defaults to the UI's. */
  text(s: string, palette?: Palette, className?: string, scale?: number): HTMLSpanElement;
  /** Text that wraps to its box (PixelFont.flow): `lines` keeps its line breaks (messages), else it reflows (descriptions). */
  flow(s: string, lines: boolean, palette?: Palette, scale?: number): HTMLSpanElement;
  tap(id: string): void;
  /** 0.37.0. The field's tile under a page point (the secret base's decoration takes touches on the floor). */
  fieldTile?(clientX: number, clientY: number): { x: number; z: number } | null;
  art: Art;
  registries: Registries;
  /** The message box frame option (0–19). */
  frame: number;
  /** Width of a line in font pixels. */
  measure(s: string): number;
  /** Draws one line in the game font onto a canvas at 1:1 (DS screens that paint their text: the journal). Absent: no text. */
  paint?(g: CanvasRenderingContext2D, s: string, palette: Palette, x: number, y: number): void;
  /** The OPTIONS screen (its page, cursor and the app's settings); absent outside a game. */
  options?: OptionsScreen;
  /** CSS px per font pixel on the generic sheets (the dot grid): pixel art canvases are drawn at this scale. */
  scale: number;
  /** CSS px per DS pixel for DS-proportioned screens (boards, the mart's windows): layout.ts `uiScales`. */
  unit: number;
  /** Phone portrait layout (design.md §3). */
  compact: boolean;
  /** The UI layer's size in CSS px (the evolution scene picks its whole-pixel scale from it). */
  size?: { width: number; height: number };
  /** The player's gender (the bag picture); absent outside a game (the title's naming screen). */
  gender?: 'male' | 'female';
  /** The game's tick and the game ticks its cry has played (null: none plays); absent outside a game. The Pokédex cry page. */
  sound?(): { tick: number; cryTicks: number | null };
}

/** What the layer shows: a `window` (start menu, save, mart menu: over the field), a `sheet`, or a `scene` (one DS frame, capped: the hatch). */
export interface Drawn {
  /** `os`: an OpenSinnoh UI screen (@opensinnoh/ui) that places its own window in the room. */
  kind: 'window' | 'sheet' | 'mart' | 'scene' | 'os' | 'wheel';
  root: HTMLElement;
}

/** A cursor stop: tapping it sends `id`. */
export function stop(d: DrawContext, id: string, content: Node[], className: string, cursor: boolean): HTMLButtonElement {
  const b = el('button', `${className}${cursor ? ' is-cursor' : ''}`, ...content);
  b.type = 'button';
  b.dataset.nav = '';
  b.dataset.tap = id;
  if (cursor) b.setAttribute('aria-current', 'true');
  b.addEventListener('click', () => d.tap(id));
  return b;
}

/** A window with the ROM's standard frame (or the CSS frame). */
export function framed(d: DrawContext, className: string, ...children: Node[]): HTMLElement {
  const w = el('section', `window ${className}`, ...children);
  d.art.frame(w, 'windows/standard_field');
  return w;
}

/** A DS message box (the options' frame type). */
export function messageBox(d: DrawContext, text: string, waiting: boolean): HTMLElement {
  const box = el('div', `msg-box${waiting ? ' waiting' : ''}`, d.flow(text, true));
  d.art.frame(box, `windows/message_box_${String(d.frame).padStart(2, '0')}`);
  box.setAttribute('aria-live', 'polite');
  if (waiting) {
    // Focusable like a button, but a div: a <button> would lay out (shrink-to-fit) differently.
    box.setAttribute('role', 'button');
    box.tabIndex = 0;
    box.dataset.tap = 'next';
    box.addEventListener('click', () => d.tap('next'));
    box.addEventListener('keydown', (e) => {
      if ((e.code !== 'Space' && e.code !== 'Enter') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      d.tap('next');
    });
  }
  return box;
}

export function drawApp(d: DrawContext, v: AppView): Drawn {
  switch (v.app) {
    case 'start-menu':
      return { kind: 'window', root: startMenu(d, v) };
    case 'save':
      return { kind: 'window', root: save(d, v) };
    case 'party':
      return { kind: 'sheet', root: party(d, v) };
    case 'bag':
      return { kind: 'sheet', root: bag(d, v) };
    case 'summary':
      return { kind: 'sheet', root: summary(d, v) };
    case 'trainer-card':
      return { kind: 'sheet', root: trainerCard(d, v) };
    case 'options':
      if (!d.options) throw new Error('ui: OPTIONS without the options screen');
      return { kind: 'os', root: d.options.draw(d, v) };
    case 'pokedex':
      return { kind: 'sheet', root: drawPokedex(d, v) };
    case 'mart':
      return { kind: 'mart', root: mart(d, v) };
    case 'storage':
      return { kind: 'sheet', root: storage(d, v) };
    case 'naming':
      return { kind: 'sheet', root: naming(d, v) };
    case 'evolution':
      return { kind: 'scene', root: evolution(d, v) };
    case 'hatch':
      return { kind: 'scene', root: hatch(d, v) };
    case 'library-tv':
      return { kind: 'scene', root: libraryTv(d, v) };
    case 'journal':
      return { kind: 'scene', root: journal(d, v) };
    case 'diploma':
      return { kind: 'scene', root: diploma(d, v) };
    case 'town-map':
      return { kind: 'scene', root: townMap(d, v) };
    case 'hall-of-fame':
      return { kind: 'scene', root: hallOfFame(d, v) };
    case 'credits':
      return { kind: 'scene', root: credits(d, v) };
    case 'rowan-intro':
      return { kind: 'scene', root: rowanIntro(d, v) };
    case 'move-reminder':
      return { kind: 'sheet', root: moveReminder(d, v) };
    case 'trade':
      return { kind: 'scene', root: trade(d, v) };
    case 'easy-chat':
      return { kind: 'sheet', root: easyChat(d, v) };
    case 'mystery-gift':
      return { kind: 'sheet', root: mysteryGift(d, v) };
    case 'item-wheel':
      return { kind: 'wheel', root: itemWheel(d, v) };
    case 'poffin-cooking':
      return { kind: 'scene', root: poffinCooking(d, v) };
    case 'poffin-case':
      return { kind: 'sheet', root: poffinCase(d, v) };
    case 'poffin-feed':
      return { kind: 'scene', root: poffinFeed(d, v) };
    case 'mining':
      return v.phase === 'prompt' ? { kind: 'mart', root: miningPrompt(d, v) } : { kind: 'scene', root: mining(d, v) };
    case 'ug-menu':
      return { kind: 'mart', root: undergroundMenu(d, v) };
    case 'ug-vendor':
      return { kind: 'mart', root: undergroundVendor(d, v) };
    case 'ug-trap':
      return { kind: 'mart', root: undergroundTrap(d, v) };
    case 'ug-base':
      return { kind: 'mart', root: undergroundBase(d, v) };
    case 'ug-pc':
      return { kind: 'mart', root: undergroundPc(d, v) };
    case 'contest':
      if (v.round?.round === 'dance' && !v.round.placeholder) return { kind: 'scene', root: contestDance(d, v.round) };
      return contestApp(d, v);
    case 'contest-photo':
      return { kind: 'mart', root: contestPhoto(d, v) };
    case 'gallery-dress-up':
      return { kind: 'mart', root: galleryDressUp(d, v) };
    case 'gallery-photo':
      return { kind: 'mart', root: galleryPhoto(d, v) };
    case 'capsule-editor':
      return { kind: 'mart', root: capsuleEditor(d, v) };
    case 'factory':
      return { kind: 'scene', root: factoryApp(d, v) };
    case 'hall-board':
      return { kind: 'scene', root: hallBoard(d, v) };
    case 'slots':
      return { kind: 'scene', root: slots(d, v) };
    case 'castle':
      return { kind: 'scene', root: castleApp(d, v) };
    case 'arcade':
      return { kind: 'scene', root: arcadeApp(d, v) };
    case 'frontier-records':
      return { kind: 'scene', root: frontierRecords(d, v) };
  }
}

const START_ICONS: Record<StartMenuView['entries'][number]['id'], IconName> = { retire: 'exit', pokedex: 'dex', pokemon: 'team', bag: 'bag', trainer: 'card', save: 'save', options: 'options', exit: 'exit' };
/** start_menu.c enum StartMenuOption: each entry's icon animations start at option × 3 (none, swell, wiggle); the female bag's at 9 × 3. */
const START_OPTION: Record<StartMenuView['entries'][number]['id'], number> = { retire: 8, pokedex: 0, pokemon: 1, bag: 2, trainer: 3, save: 4, options: 5, exit: 6 };
const ICON_ANIM_WIGGLE = 2;
/** One NANR frame tick (contracts Ui2dFrame: 30 Hz). */
const TICK_MS = 1000 / 30;

/**
 * The start menu (start_menu.c StartMenu_InitMenu): a window 11 tiles wide, three tile rows an entry, the label at
 * x 28 of the window; the ROM icons (StartMenu_InitSprites: centre x 174 for the window at x 160, y 12 into the
 * row), grey but for the cursor's, which is coloured and wiggles, and the cursor sprite (centre x 204). Packs
 * without the art (the fixture) get our stand-in icons and selection band.
 */
function startMenu(d: DrawContext, v: StartMenuView): HTMLElement {
  const list = el('div', 'start-list');
  const rom = !!d.art.sheet('start_menu/icons');
  list.classList.toggle('rom', rom);
  v.entries.forEach((e, i) => {
    const cursor = i === v.cursor;
    const b = stop(d, `entry:${i}`, [rom ? startIcon(d, e.id, cursor) : icon(START_ICONS[e.id]), d.text(e.label)], 'start-entry', cursor);
    if (rom && cursor) b.prepend(el('span', 'start-cursor', d.art.cells('start_menu/cursor', [0], d.scale)!));
    b.dataset.entry = e.id;
    list.append(b);
  });
  const root = framed(d, 'start-menu', list);
  root.setAttribute('aria-label', v.title);
  // In a Safari Game, StartMenu_PrintBallCount's window (12×4 tiles): the label over the stock.
  if (v.ballStock) root.append(framed(d, 'start-balls', el('div', '', d.text(v.ballStock.label)), el('div', '', d.text(v.ballStock.stock))));
  // OpenSinnoh, not Platinum: the current objective in a field window beside the menu (above it on phones). The UI
  // layer reads it out once when the menu opens (index.ts).
  if (v.objective) root.append(framed(d, 'start-objective', el('h3', 'start-objective-title', d.text(v.objective.title)), el('p', 'start-objective-text', d.flow(v.objective.text, false))));
  return root;
}

function startIcon(d: DrawContext, id: StartMenuView['entries'][number]['id'], cursor: boolean): HTMLElement {
  const path = cursor ? 'start_menu/icons' : 'start_menu/icons_gray';
  const sheet = d.art.sheet(path)!;
  const base = (id === 'bag' && d.gender === 'female' ? 9 : START_OPTION[id]) * 3;
  const node = el('span', 'start-icon', d.art.cells(path, [sheet.animations![base]!.frames[0]!.cell], d.scale)!);
  node.setAttribute('aria-hidden', 'true');
  const wiggle = sheet.animations![base + ICON_ANIM_WIGGLE]!;
  if (cursor && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // The wiggle (an affine sequence: rotation about the icon's centre), frame by frame.
    const total = wiggle.frames.reduce((n, f) => n + f.ticks, 0);
    let at = 0;
    const keyframes = wiggle.frames.map((f) => {
      const k = { offset: at / total, transform: `rotate(${-(f.rotation ?? 0)}turn) scale(${f.scaleX ?? 1}, ${f.scaleY ?? 1})`, easing: 'steps(1, end)' };
      at += f.ticks;
      return k;
    });
    keyframes.push({ ...keyframes[0]!, offset: 1 });
    node.animate(keyframes, { duration: total * TICK_MS, iterations: Infinity });
  }
  return node;
}

function save(d: DrawContext, v: SaveView): HTMLElement {
  const info = el('dl', 'save-info');
  for (const f of v.info) info.append(el('dt', '', d.text(f.label)), el('dd', '', d.text(f.value)));
  const box = el('div', 'save-box');
  if (v.phase === 'ask') {
    box.append(el('p', 'message', d.text(v.message)), el('div', 'choices', stop(d, 'yes', [d.text(v.yes)], 'choice', v.cursor === 0), stop(d, 'no', [d.text(v.no)], 'choice', v.cursor === 1)));
  } else {
    const msg = v.phase === 'done' ? d.text(v.message) : el('span', 'ui-error', v.message);
    box.append(stop(d, 'ok', [msg], 'message message-button', true));
  }
  box.setAttribute('aria-live', 'polite');
  return framed(d, 'save-window', framed(d, 'save-info-window', info), box);
}

/**
 * Window rects in DS tiles (decomp shop_menu.c sShop_DefaultWindowTemplates; framed windows include their
 * frame's tile): the BUY/SELL/SEE YA! menu and the message box over the field, then the buy screen's windows
 * over the shop panel (`shop/panel`, Shop_LoadGraphics): the list and the description print on the panel
 * without a frame of their own.
 */
const MART_TILES = {
  menu: [0, 0, 15, 8],
  money: [0, 0, 11, 6],
  /** sShop_FrontierCurrMoneyWindowTemplate: the exchange counter's one-line BP window. */
  moneyBp: [0, 0, 11, 4],
  list: [12, 2, 19, 14],
  description: [5, 18, 27, 6],
  /** MART_TYPE_SEAL: the BUY / SEE YA! window (Shop_InitContextMenu, 13 × 4) and the description without an icon (sShop_NormalItemDescWindowTemplate). */
  menuSeal: [0, 0, 15, 6],
  descriptionSeal: [1, 18, 27, 6],
  message: [0, 18, 32, 6],
  inBag: [0, 14, 16, 4],
  quantity: [18, 12, 14, 6],
  yesNo: [22, 12, 9, 6],
} as const;
/** The item icon sprite's centre (sShop_SpriteTemplates SHOP_SPRITE_ITEM_ICON), its 32×32 cell around it. */
const MART_ICON = { x: 22, y: 172 };

/**
 * The mart as one DS screen at the UI unit (decomp shop_menu.c): the BUY/SELL/SEE YA! window and the clerk's
 * message box over the field; buying or selling, the shop panel with the money window, the list (prices or
 * counts), the item's icon and description, the quantity window and YES/NO. Phones show the buy screen full
 * screen (no field around it).
 */
function mart(wide: DrawContext, v: MartView): HTMLElement {
  const d = boardContext(wide);
  const place = (node: HTMLElement, at: keyof typeof MART_TILES) => atTiles(node, MART_TILES[at][0], MART_TILES[at][1], MART_TILES[at][2], MART_TILES[at][3]);
  const listing = v.mode !== 'menu' && v.mode !== 'exit';
  const root = board(`mart mart-${v.mode} mart-board${listing ? ' mart-screen' : ''}`);
  const message = v.message ? place(messageBox(d, v.message.text, v.message.waiting), 'message') : null;
  if (!listing) {
    if (v.mode === 'menu') root.append(place(framed(d, 'mart-menu', ...v.menu.map((m, i) => stop(d, `menu:${i}`, [d.text(m)], 'menu-entry', i === v.menuCursor))), v.seals ? 'menuSeal' : 'menu'));
    if (message) root.append(message);
    return root;
  }
  // A pack without the shop's art (the fixture): a CSS stand-in.
  const bp = v.currency === 'bp';
  const panel = bgPicture(d, bp ? 'shop/panel_frontier' : v.seals ? 'shop/panel_seal' : 'shop/panel', 0, 0, 'mart-panel') ?? at(el('span', 'mart-css-panel'), 0, 0, 256, 192);
  const money = bp
    ? place(framed(d, 'money-window money-window-bp', el('span', 'money-value', d.text(v.money.value))), 'moneyBp')
    : place(framed(d, 'money-window', d.text(v.money.label), el('span', 'money-value', d.text(v.money.value))), 'money');
  const list = el('div', 'item-list mart-list');
  list.dataset.scrolls = '';
  v.rows.forEach((r, i) => {
    const row = stop(d, `row:${i}`, [el('span', 'item-name', d.text(r.label)), el('span', 'price', d.text(r.right))], 'item-row', v.cursor === i);
    row.dataset.item = r.item;
    list.append(row);
  });
  list.append(stop(d, 'cancel', [d.text(v.cancel)], 'item-row cancel', v.cursor === v.rows.length));
  const listWindow = place(el('div', 'mart-list-window'), 'list');
  if (v.pockets.length) {
    // The pocket bar (one pocket at a time, as the bag): arrows step to the neighbouring pocket.
    const n = v.pockets.length;
    const arrow = (dir: 'prev' | 'next') => {
      const id = `pocket:${(v.pocket + (dir === 'prev' ? n - 1 : 1)) % n}`;
      const b = el('button', `pocket-arrow ${dir}`);
      b.type = 'button';
      b.dataset.tap = id;
      b.setAttribute('aria-label', S.aria.pocket(dir === 'prev'));
      b.addEventListener('click', () => d.tap(id));
      return b;
    };
    listWindow.append(el('div', 'pocket-bar mart-pockets', arrow('prev'), el('div', 'pocket-name', d.text(v.pockets[v.pocket]!)), arrow('next')));
  }
  listWindow.append(list);
  root.append(panel, money, listWindow);
  // The DS draws the message box over the description and the icon.
  if (message) root.append(message);
  else if (v.item && v.seals) root.append(place(el('div', 'item-panel-text mart-description', d.flow(v.item.description, true, 'light')), 'descriptionSeal'));
  else if (v.item) {
    root.append(
      at(el('span', 'mart-item-icon', d.art.itemIcon(v.item.id as never, true)), MART_ICON.x - 16, MART_ICON.y - 16, 32, 32),
      place(el('div', 'item-panel-text mart-description', d.flow(v.item.description, true, 'light')), 'description'),
    );
  }
  if (v.quantity) {
    const q = v.quantity;
    const btn = (id: string, label: string, cls: string) => {
      const b = el('button', `qty-step ${cls}`);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.dataset.tap = id;
      b.addEventListener('click', () => d.tap(id));
      return b;
    };
    root.append(
      place(framed(d, 'in-bag-window', d.text(q.inBag)), 'inBag'),
      place(
        framed(
          d,
          'qty-window',
          btn('qty:-10', 'Ten fewer', 'down10'),
          btn('qty:-1', 'One fewer', 'down'),
          stop(d, 'ok', [d.text(q.count)], 'qty-count', true),
          btn('qty:+1', 'One more', 'up'),
          btn('qty:+10', 'Ten more', 'up10'),
          el('span', 'qty-total', d.text(q.total)),
        ),
        'quantity',
      ),
    );
  }
  if (v.yesNo) root.append(place(framed(d, 'yes-no', stop(d, 'yes', [d.text(v.yesNo.yes)], 'choice', v.yesNo.cursor === 0), stop(d, 'no', [d.text(v.yesNo.no)], 'choice', v.yesNo.cursor === 1)), 'yesNo'));
  return root;
}
