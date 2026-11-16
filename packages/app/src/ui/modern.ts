/**
 * The Modern menus (Options › DEVICE › MENUS, menu-style.ts): a second drawing of the same app views in OpenSinnoh's
 * own style, one window with a list and a detail that follows the cursor. Same `data-tap` ids, same cursor, no state:
 * packages/menus runs exactly as it does for the original screens. Art stays the ROM's (sprites and icons); the text
 * is the game's strings in the design system's faces, with ♂ and ♀ drawn as icons.
 *
 * The party and bag a battle opens follow the setting too. The battle screen itself, the field and message boxes outside
 * these screens stay ROM-drawn.
 */
import { cursorMark, h, icon, titleTab, type IconName, type Tone } from '@opensinnoh/ui';
import type { AppMenu, AppMessage, AppYesNo } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { stop, type DrawContext } from './apps.ts';
import './modern.css';

/** A game string for a kit face: one line (the ROM's line breaks are for its windows), ♂ and ♀ as icons. */
export function gameText(s: string): Node[] {
  return s
    .replace(/\s*\n\s*/g, ' ')
    .split(/([♂♀])/)
    .filter(Boolean)
    .map((part) => (part === '♂' ? icon('male', 16, 'male') : part === '♀' ? icon('female', 16, 'female') : document.createTextNode(part)));
}

/** Below this room the action list is a bottom sheet; above it, it opens in the detail pane. */
const SHEET = { width: 480, height: 420 };
export function actionsInSheet(d: DrawContext): boolean {
  const room = d.size ?? { width: innerWidth, height: innerHeight };
  return d.compact || room.width < SHEET.width || room.height < SHEET.height;
}

export const line = (className: string, s: string): HTMLElement => h('span', className, ...gameText(s));

/** A cursor stop in a list: the ▶ and its parts. `selected` keeps its look while a window above holds the cursor. */
export function item(d: DrawContext, id: string, parts: Node[], className: string, cursor: boolean, selected = false): HTMLButtonElement {
  const b = stop(d, id, [cursorMark(), ...parts], `os-item ${className}${selected ? ' is-selected' : ''}`, cursor);
  b.tabIndex = cursor ? 0 : -1;
  return b;
}

/** A tap-only button (not a cursor stop): the title tab's arrows, a page's own buttons. */
export function tapButton(d: DrawContext, id: string, content: Node[], className = 'os-btn', label?: string): HTMLButtonElement {
  const b = h('button', className, ...content);
  b.type = 'button';
  b.dataset.tap = id;
  if (label) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  b.addEventListener('click', () => d.tap(id));
  return b;
}

/** The screen: the field over the whole room, one window with its tab (`end`: beside the title), the panes and the footer. */
export function screen(className: string, title: string, tone: Tone, tabIcon: IconName, left: Node[], right: Node[], foot: HTMLElement[], extras: Node[], end: Node[] = []): HTMLElement {
  const tab = titleTab(title, { tone, icon: tabIcon, end });
  tab.querySelector('.t')!.replaceChildren(...gameText(title));
  const win = h(
    'section',
    'os-win os-panel mm-win',
    tab,
    h('div', 'mm-body', h('div', 'mm-left', ...left), h('div', 'mm-right', ...right)),
    h('footer', 'os-foot', h('span', 'fill'), ...foot),
  );
  const root = h('div', `os os-screen os-field mm ${className}`, win, ...extras);
  root.setAttribute('aria-label', title.replace(/\s*\n\s*/g, ' '));
  return root;
}

/** A label and value list (the summary's fields, the PC's preview): the game's words on both sides. */
export function fields(rows: { label: string | Node[]; value: Node[] | string }[], className = ''): HTMLElement {
  const dl = h('dl', `mm-kv ${className}`.trim());
  for (const r of rows) dl.append(h('dt', '', ...(typeof r.label === 'string' ? gameText(r.label) : r.label)), h('dd', '', ...(typeof r.value === 'string' ? gameText(r.value) : r.value)));
  return dl;
}

/** A type (or a move's category) as the ROM draws it, named for a screen reader; the name in a chip without the art. */
export function typeMark(d: DrawContext, type: Id | 'physical' | 'special' | 'status', name: string): HTMLElement {
  const art = d.art.typeIcon(type, TYPE_SCALE);
  const e = art ? h('span', 'mm-type', art) : h('span', 'os-chip mm-type', ...gameText(name));
  e.setAttribute('role', 'img');
  e.setAttribute('aria-label', name);
  e.title = name;
  return e;
}
/** The ROM's type icons (32 × 16) at a whole scale. */
const TYPE_SCALE = 2;

/** A footer button (CANCEL, CONFIRM) as a cursor stop. */
export function footButton(d: DrawContext, id: string, label: string, cursor: boolean, primary = false, withIcon = true): HTMLButtonElement {
  return stop(d, id, [...(withIcon ? [icon('back')] : []), ...gameText(label)], `os-btn big${primary ? ' primary' : ''}`, cursor);
}

function actionRows(d: DrawContext, menu: AppMenu): HTMLElement[] {
  return menu.entries.map((e, i) => item(d, `menu:${i}`, [line('lab', e.label), ...(e.right ? [line('os-num', e.right)] : [])], 'mm-action', i === menu.cursor));
}

/** The action window: inline in the detail pane. */
export function actionsPane(d: DrawContext, menu: AppMenu): HTMLElement {
  const list = h('div', 'os-list mm-actions mm-prompt', ...actionRows(d, menu));
  list.setAttribute('role', 'menu');
  list.dataset.scrolls = '';
  return list;
}

/** The action window on a phone: a bottom sheet (a tap outside is B). */
export function actionsSheet(d: DrawContext, menu: AppMenu): HTMLElement[] {
  return promptSheet(d, actionRows(d, menu));
}

/** A window of cursor rows as a bottom sheet (a tap outside is B). */
export function promptSheet(d: DrawContext, rows: HTMLElement[]): HTMLElement[] {
  const scrim = h('div', 'os-sheet-scrim');
  scrim.addEventListener('click', () => d.tap('back'));
  const sheet = h('div', 'os-sheet mm-sheet mm-prompt', ...rows);
  sheet.setAttribute('role', 'menu');
  sheet.dataset.scrolls = '';
  return [scrim, sheet];
}

/** The game's message (bottom box) or question (a dialog, on the model's cursor). `extra`: the bag's toss count. */
export function prompts(d: DrawContext, v: { message: AppMessage | null; yesNo: AppYesNo | null }, extra?: HTMLElement): HTMLElement[] {
  if (v.yesNo || extra) {
    const acts = v.yesNo ? [stop(d, 'yes', gameText(v.yesNo.yes), 'os-btn', v.yesNo.cursor === 0), stop(d, 'no', gameText(v.yesNo.no), 'os-btn', v.yesNo.cursor === 1)] : [];
    const dlg = h('div', 'os-win os-dlg', v.message ? h('h3', '', ...gameText(v.message.text)) : null, extra ?? null, acts.length ? h('div', 'acts', ...acts) : null);
    dlg.setAttribute('role', 'alertdialog');
    return [h('div', 'os-layer', dlg)];
  }
  if (!v.message) return [];
  const text = h('span', 'mm-msgtext', ...gameText(v.message.text));
  if (!v.message.waiting) {
    const box = h('div', 'os-win mm-msg', text);
    box.dataset.frame = 'slim';
    box.setAttribute('aria-live', 'polite');
    return [h('div', 'os-layer mm-msglayer', box)];
  }
  const box = stop(d, 'next', [text, h('span', 'mm-next', icon('down'))], 'os-win mm-msg', true);
  box.dataset.frame = 'slim';
  box.setAttribute('aria-live', 'polite');
  const layer = h('div', 'os-layer mm-msglayer', box);
  layer.addEventListener('click', (e) => e.target === layer && d.tap('next'));
  return [layer];
}
