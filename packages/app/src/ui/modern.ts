/**
 * The Modern menus (Options › DEVICE › MENUS, menu-style.ts): a second drawing of the same app views in OpenSinnoh's
 * own style, one window with a list and a detail that follows the cursor. Same `data-tap` ids, same cursor, no state:
 * packages/menus runs exactly as it does for the original screens. Art stays the ROM's (sprites and icons); the text
 * is the game's strings in the design system's faces, with ♂ and ♀ drawn as icons.
 *
 * `MODERN_IN_BATTLE` is the one switch for the party and bag a battle opens. The battle screen itself, the field and
 * message boxes outside these screens stay ROM-drawn.
 */
import { cursorMark, h, icon, titleTab, type IconName, type Tone } from '@opensinnoh/ui';
import type { AppMenu, AppMessage, AppYesNo, BagView, PartyView } from '@opensinnoh/contracts';
import { stop, type DrawContext } from './apps.ts';
import './modern.css';

const MODERN_IN_BATTLE = true;

/** Whether this view draws in the Modern style. */
export function modernMenu(d: Pick<DrawContext, 'modern'>, v: PartyView | BagView): boolean {
  return !!d.modern && (MODERN_IN_BATTLE || v.mode !== 'battle');
}

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

/** The screen: the field over the whole room, one window with its tab, the panes and the footer. */
export function screen(className: string, title: string, tone: Tone, tabIcon: IconName, left: Node[], right: Node[], foot: HTMLElement[], extras: Node[]): HTMLElement {
  const win = h(
    'section',
    'os-win os-panel mm-win',
    titleTab(title, { tone, icon: tabIcon }),
    h('div', 'mm-body', h('div', 'mm-left', ...left), h('div', 'mm-right', ...right)),
    h('footer', 'os-foot', h('span', 'fill'), ...foot),
  );
  const root = h('div', `os os-screen os-field mm ${className}`, win, ...extras);
  root.setAttribute('aria-label', title);
  return root;
}

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
  const scrim = h('div', 'os-sheet-scrim');
  scrim.addEventListener('click', () => d.tap('back'));
  const sheet = h('div', 'os-sheet mm-sheet mm-prompt', ...actionRows(d, menu));
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
