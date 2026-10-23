/**
 * The party menu on its DS screen (decomp party_menu: main.c sMemberPanelTemplates, windows.c window
 * templates, sprites.c): the ROM's backdrop (`party/bg`), the six member panels with their palette per
 * state (normal, fainted, selected, switching: `party/panels`), the selection frame (`party/cursor`), the
 * HP bar's fill (`party/hp_fill`), the panel texts in the panel's colours, the status and held-item icons,
 * the CANCEL button (`party/cancel`), and the windows at their DS rects: the prompt (the short message box,
 * or the medium one beside the context window), the context window (standard frame), YES/NO and the long
 * message box. Every element sits at its DS rect on a 256×192 board at the UI unit.
 *
 * Phones (compact) get the panels in one column at the largest whole unit that fits the screen, the windows
 * along the bottom (the same art and rects inside each panel; bigger panels to tap).
 *
 * Packs without the art (the fixture) get CSS stand-ins in the same rects.
 */
import type { AppMenu, PartySlotView, PartyView } from '@opensinnoh/contracts';
import { ICON_ANIM, hpColor, hpPixels } from './art.ts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { at, atTiles, board, boardContext } from './board.ts';
import { el } from './core.ts';
import type { Palette } from './pixel-font.ts';
import './party.css';

/** sMemberPanelTemplates[0] (basic type): panel tile positions. */
const PANELS: [x: number, y: number][] = [
  [0, 0],
  [16, 1],
  [0, 6],
  [16, 7],
  [0, 12],
  [16, 13],
];
/** MEMBER_PANEL_WIDTH/HEIGHT in px. */
const PANEL_W = 128;
const PANEL_H = 48;
/** Inside a panel (px): the species icon's centre, the ball's, the selection frame's (cursor positions less the panel), the held item (icon + 8, 8), the status icon. */
const ICON = { x: 30, y: 16 };
const BALL = { x: 16, y: 14 };
const CURSOR = { x: 64, y: 24 };
const HELD = { x: ICON.x + 8, y: ICON.y + 8 };
const STATUS = { x: 36, y: 44 };
/** Window rects inside a panel (tiles, windows.c sMemberWindowTemplates less the panel): name, level, HP, HP bar, comment. */
const WIN = { name: [6, 1, 9, 2], level: [0, 4, 6, 2], hp: [7, 4, 8, 2], bar: [8, 3, 6, 1], comment: [6, 4, 10, 2] } as const;
/**
 * In-window text offsets (px): the gender mark (x 64 of the name window); the level (FontSpecialChars_DrawPartyScreenText
 * draws its small "Lv" glyph at x 5 and the number 16 px further; our "Lv." label in the system font is wider and inks from
 * its first column, so it starts at x 8 and the number at x 22, clear of the lead panel's rounded edge and its selection
 * frame: an adjustment, not measured against the glyph);
 * the HP numbers (current right-aligned to 28, the slash, the maximum from 36).
 */
const GENDER_X = 64;
const LEVEL = { mark: 8, number: 22 };
const HP_SLASH = 28;
const HP_MAX = 36;
/** CANCEL: the button sprite (template 232, 184, moved up 8 with no CONFIRM; tall cells 0/1) and its text window (26, 21, 5 × 2). */
const CANCEL = { x: 232, y: 176, text: [26, 21, 5, 2] } as const;
/** Windows (outer tile rects, frame included): the short and medium message boxes, the long one, YES/NO; the context window's interior at (19, 23 − rows) × 12. */
const SHORT_MESSAGE = [0, 20, 25, 4] as const;
const MEDIUM_MESSAGE = [0, 18, 18, 6] as const;
const LONG_MESSAGE = [0, 18, 32, 6] as const;
const YES_NO = [22, 12, 9, 6] as const;
const MENU = { x: 19, bottom: 23, width: 12 };
/** status_icons cells (decomp SUMMARY_CONDITION_* order). */
export const STATUS_CELLS: Record<Exclude<PartySlotView['status'], 'none'>, number> = { paralysis: 1, freeze: 2, sleep: 3, poison: 4, toxic: 4, burn: 5, fainted: 6 };
/** party/held cells: held item, mail, ball capsule. */
const HELD_ITEM = 0;
const HELD_CAPSULE = 2;

/** A sprite: the sheet's cell drawn with its origin at (x, y) of the parent's DS px; null without the sheet. */
export function sprite(d: DrawContext, path: string, cell: number | string, x: number, y: number, className: string): HTMLElement | null {
  const sheet = d.art.sheet(path);
  if (!sheet) return null;
  const i = typeof cell === 'number' ? cell : sheet.names!.indexOf(cell);
  const c = sheet.cells[i];
  if (!c) throw new Error(`ui: sheet ${path} has no cell ${cell}`);
  return at(el('span', `sprite ${className}`, d.art.cells(path, [i], d.unit)!), x - c.ox, y - c.oy, c.w, c.h);
}

/** A sheet's named text colours (`textColors`), or the stand-in palette. */
export function textColor(d: DrawContext, path: string, name: string, fallback: Palette): Palette {
  const sheet = d.art.sheet(path);
  const c = sheet?.textColors?.[sheet.names!.indexOf(name)];
  return c ? [c.fg, c.shadow] : fallback;
}

type State = 'normal' | 'fainted' | 'selected' | 'selected_fainted' | 'switch';

/** Decomp PartyMenu_UpdateSlotPalette: both ends of a switch; else selected (+4) and fainted (+2). */
function panelState(v: PartyView, i: number, m: PartySlotView): State {
  if (v.moving !== null && (i === v.moving || i === v.cursor)) return 'switch';
  const fainted = m.status === 'fainted' && !m.egg;
  return i === v.cursor ? (fainted ? 'selected_fainted' : 'selected') : fainted ? 'fainted' : 'normal';
}

/** The HP bar's fill: six 8-px characters of `party/hp_fill`, or a CSS bar. */
function hpFill(d: DrawContext, hp: number, max: number): HTMLElement {
  const px = hpPixels(hp, max);
  const colour = hpColor(hp, max) === 'max' ? 'green' : hpColor(hp, max);
  const canvas = d.art.cells('party/hp_fill', Array.from({ length: 6 }, (_, k) => `${colour}_${Math.max(0, Math.min(8, px - k * 8))}`), d.unit);
  const bar = canvas ? el('span', 'hp-bar rom', canvas) : el('span', `hp-bar css ${colour}`, el('span', 'hp-fill'));
  bar.style.setProperty('--hp', String(px / 48));
  return atTiles(bar, ...WIN.bar);
}

function slot(d: DrawContext, v: PartyView, i: number, m: PartySlotView, x: number, y: number): HTMLElement {
  const state = panelState(v, i, m);
  const kind = `${i === 0 ? 'lead' : 'back'}${m.egg || v.notes[i] ? '_nohp' : ''}`;
  const parts: Node[] = [];
  const panel = d.art.cells('party/panels', [`${kind}_${state}`], d.unit);
  parts.push(panel ? at(el('span', 'party-panel', panel), 0, 0, PANEL_W, PANEL_H) : at(el('span', `party-panel css ${i === 0 ? 'lead' : 'back'} ${state}`), 0, 0, PANEL_W, PANEL_H));
  if (state !== 'normal' && state !== 'fainted') {
    const frame = sprite(d, 'party/cursor', state === 'switch' ? (i === 0 ? 3 : 2) : i === 0 ? 1 : 0, CURSOR.x, CURSOR.y, 'party-cursor');
    if (frame) parts.push(frame);
  }
  const ball = sprite(d, 'party/ball', 0, BALL.x, BALL.y, 'party-ball');
  if (ball) parts.push(ball);
  const anim = m.egg ? ICON_ANIM.hpMax : m.status === 'fainted' ? ICON_ANIM.fainted : m.status !== 'none' ? ICON_ANIM.statused : { max: ICON_ANIM.hpMax, green: ICON_ANIM.hpGreen, yellow: ICON_ANIM.hpYellow, red: ICON_ANIM.hpRed }[hpColor(m.hp, m.maxHp)];
  parts.push(at(el('span', 'party-icon', d.art.pokemonIcon(m.species, m.form, anim, m.egg)), ICON.x - 16, ICON.y - 16, 32, 32));
  if (m.heldItem) {
    const held = sprite(d, 'party/held', HELD_ITEM, HELD.x, HELD.y, 'held-item') ?? at(el('span', 'held-item css'), HELD.x, HELD.y, 8, 8);
    held.title = d.registries.items.get(m.heldItem)?.name ?? '';
    parts.push(held);
  }
  // PartyMenu_AlignMemberBallSeal: the Ball Capsule marker 8 px right of the held item's place.
  if (m.capsule) {
    const capsule = sprite(d, 'party/held', HELD_CAPSULE, HELD.x + 8, HELD.y, 'held-capsule') ?? at(el('span', 'held-capsule css'), HELD.x + 8, HELD.y, 8, 8);
    parts.push(capsule);
  }
  const ink = textColor(d, 'party/text', 'name', 'light');
  const name = atTiles(el('span', 'party-name', d.text(m.name, ink)), ...WIN.name);
  if (m.gender !== 'none' && !m.egg) name.append(at(el('span', 'party-gender', d.text(m.gender === 'male' ? '♂' : '♀', textColor(d, 'party/text', m.gender, m.gender))), GENDER_X, 0));
  parts.push(name);
  if (!m.egg) {
    const status = m.status === 'none' ? null : (sprite(d, 'summary/status', STATUS_CELLS[m.status], STATUS.x, STATUS.y, 'status-icon') ?? at(el('span', `status-chip ${m.status}`, m.status.slice(0, 3).toUpperCase()), STATUS.x - 16, STATUS.y - 8, 24, 8));
    if (status) parts.push(status);
    else parts.push(atTiles(el('span', 'party-level', at(el('span', 'party-level-mark', d.text(m.levelLabel, ink)), LEVEL.mark, 0), at(el('span', 'party-level-number', d.text(m.level, ink)), LEVEL.number, 0)), ...WIN.level));
    const note = v.notes[i];
    if (note) parts.push(atTiles(el('span', 'party-note', d.text(note, ink)), ...WIN.comment));
    else {
      const [hx, hy, hw, hh] = WIN.hp;
      parts.push(hpFill(d, m.hp, m.maxHp));
      parts.push(at(el('span', 'party-hp', at(el('span', 'party-hp-now', d.text(String(m.hp), ink)), 0, 0, HP_SLASH), at(el('span', 'party-hp-slash', d.text('/', ink)), HP_SLASH, 0), at(el('span', 'party-hp-max', d.text(String(m.maxHp), ink)), HP_MAX, 0)), hx * 8, hy * 8, hw * 8, hh * 8));
    }
  }
  const b = at(stop(d, `slot:${i}`, parts, `party-slot ${state}${i === 0 ? ' lead' : ''}${m.status === 'fainted' ? ' fainted' : ''}${v.moving === i ? ' moving' : ''}`, v.cursor === i), x, y, PANEL_W, PANEL_H);
  b.dataset.species = m.species;
  return b;
}

function emptySlot(d: DrawContext, x: number, y: number): HTMLElement {
  const panel = d.art.cells('party/panels', ['none'], d.unit);
  return at(el('div', `party-slot empty${panel ? '' : ' css'}`, ...(panel ? [panel] : [])), x, y, PANEL_W, PANEL_H);
}

/** The context window: 16-px entries in the standard frame (the cursor's 8 px at the left); on the DS at (19, 23 − 2n), 12 tiles wide. */
function contextMenu(d: DrawContext, menu: AppMenu): HTMLElement {
  const list = el('div', 'party-menu-list', ...menu.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label), ...(e.right ? [el('span', 'menu-right', d.text(e.right))] : [])], 'menu-entry', i === menu.cursor)));
  const w = framed(d, 'party-menu', list);
  w.setAttribute('role', 'menu');
  return w;
}

/** CANCEL: the tall button cell (selected: the next one) with its text window. */
function cancelButton(d: DrawContext, v: PartyView, place: boolean): HTMLElement {
  const c = d.art.sheet('party/cancel')?.cells[0];
  const left = CANCEL.x - (c?.ox ?? 32);
  const top = CANCEL.y - (c?.oy ?? 16);
  const [tx, ty, tw, th] = CANCEL.text;
  const art = c ? [at(el('span', 'party-cancel-art', d.art.cells('party/cancel', [v.cursor === 6 ? 1 : 0], d.unit)!), 0, 0, c.w, c.h)] : [];
  const text = at(el('span', 'party-cancel-text', d.text(v.cancel, textColor(d, 'party/text', 'name', 'ink'))), tx * 8 - left, ty * 8 - top, tw * 8, th * 8);
  const b = stop(d, 'cancel', [...art, text], `party-cancel${c ? '' : ' css'}`, v.cursor === 6);
  b.style.setProperty('--w', String(c?.w ?? 56));
  b.style.setProperty('--h', String(c?.h ?? 32));
  return place ? at(b, left, top, c?.w ?? 56, c?.h ?? 32) : b;
}

/**
 * Order mode (`party-order`, decomp PARTY_MENU_MODE_BATTLE_TOWER): the short CONFIRM (232, 168) and CANCEL (232, 184)
 * buttons (button animations 2/3, the selected one odd), their text windows at tiles 25,20 (7×2) and 26,22 (5×2).
 */
function orderButtons(d: DrawContext, v: PartyView, place: boolean): HTMLElement[] {
  const sheet = d.art.sheet('party/cancel');
  const button = (tap: 'confirm' | 'cancel', label: string, selected: boolean, y: number, text: readonly [number, number, number, number]) => {
    const cellIndex = sheet?.animations?.[selected ? 3 : 2]?.frames[0]?.cell;
    const c = cellIndex === undefined ? undefined : sheet!.cells[cellIndex];
    const left = 232 - (c?.ox ?? 32);
    const top = y - (c?.oy ?? 8);
    const art = c && cellIndex !== undefined ? [at(el('span', 'party-cancel-art', d.art.cells('party/cancel', [cellIndex], d.unit)!), 0, 0, c.w, c.h)] : [];
    const [tx, ty, tw, th] = text;
    const t = at(el('span', 'party-cancel-text', d.text(label, textColor(d, 'party/text', 'name', 'ink'))), tx * 8 - left, ty * 8 - top, tw * 8, th * 8);
    const b = stop(d, tap, [...art, t], `party-cancel party-order-button${c ? '' : ' css'}`, selected);
    b.style.setProperty('--w', String(c?.w ?? 56));
    b.style.setProperty('--h', String(c?.h ?? 16));
    return place ? at(b, left, top, c?.w ?? 56, c?.h ?? 16) : b;
  };
  return [button('confirm', v.confirm!, v.cursor === 6, 168, [25, 20, 7, 2]), button('cancel', v.cancel, v.cursor === 7, 184, [26, 22, 5, 2])];
}

function yesNo(d: DrawContext, v: NonNullable<PartyView['yesNo']>): HTMLElement {
  return framed(d, 'yes-no party-yes-no', stop(d, 'yes', [d.text(v.yes)], 'menu-entry', v.cursor === 0), stop(d, 'no', [d.text(v.no)], 'menu-entry', v.cursor === 1));
}

/** The bottom windows (prompt or message, menu, YES/NO) and CANCEL, at their DS rects. */
function windows(d: DrawContext, v: PartyView): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (v.confirm) out.push(...orderButtons(d, v, true));
  else if (v.cancel) out.push(cancelButton(d, v, true));
  if (v.message) out.push(atTiles(messageBox(d, v.message.text, v.message.waiting), ...LONG_MESSAGE));
  else {
    const [x, y, w, h] = v.menu ? MEDIUM_MESSAGE : SHORT_MESSAGE;
    out.push(atTiles(messageBox(d, v.prompt, false), x, y, w, h));
  }
  if (v.menu) out.push(atTiles(contextMenu(d, v.menu), MENU.x - 1, MENU.bottom - v.menu.entries.length * 2 - 1, MENU.width + 2, v.menu.entries.length * 2 + 2));
  if (v.yesNo) out.push(atTiles(yesNo(d, v.yesNo), ...YES_NO));
  return out;
}

/** Phones: the six panels in one column (empty ones as the DS's empty panel) over the prompt and CANCEL (room for a two-line message, 48 px as on the DS); at least `width` DS px wide (the prompt beside CANCEL). */
const COLUMN = { gap: 2, foot: 48, width: 192 };

/** The column's unit (the largest whole one its content fits at) and its size: the whole room (full screen on phones). */
function compactBoard(d: DrawContext, members: number): { unit: number; width: number; height: number; content: number } {
  const dpr = devicePixelRatio || 1;
  const space = d.size ?? { width: innerWidth, height: innerHeight };
  const content = members * (PANEL_H + COLUMN.gap) + COLUMN.foot;
  const unit = Math.max(1, Math.floor(Math.min(space.width / COLUMN.width, space.height / content) * dpr + 1e-6)) / dpr;
  return { unit, width: Math.floor(space.width / unit + 1e-6), height: Math.max(content, Math.floor(space.height / unit + 1e-6)), content };
}

export function party(wide: DrawContext, v: PartyView): HTMLElement {
  if (wide.compact) return partyColumn(wide, v);
  const d = boardContext(wide);
  const root = board(`party-screen party-${v.mode}`);
  if (d.art.sheet('party/bg')) root.dataset.backdrop = 'party/bg';
  root.append(background(d, 256, 192));
  v.slots.forEach((m, i) => {
    const [tx, ty] = PANELS[i]!;
    root.append(m ? slot(d, v, i, m, tx * 8, ty * 8) : emptySlot(d, tx * 8, ty * 8));
  });
  root.append(...windows(d, v));
  root.setAttribute('aria-label', v.title);
  return root;
}

function background(d: DrawContext, width: number, height: number): HTMLElement {
  const bg = el('div', 'party-bg');
  if (!d.art.picture(bg, 'party/bg')) bg.classList.add('css');
  return at(bg, 0, 0, width, height);
}

/**
 * Phones: one panel per row at the largest whole unit that fits (the panels' own art and rects), the prompt
 * (or message) and CANCEL along the bottom; the context window and YES/NO stack over the panels' bottom
 * right, and a long message grows up over them, as the DS draws its windows over the panels.
 */
function partyColumn(wide: DrawContext, v: PartyView): HTMLElement {
  const size = compactBoard(wide, v.slots.length);
  const d = boardContext({ ...wide, unit: size.unit });
  const root = board(`party-screen party-column party-${v.mode}`, size.width, size.height);
  if (d.art.sheet('party/backdrop')) root.dataset.backdrop = 'party/backdrop';
  root.style.setProperty('--unit', `${size.unit}px`);
  const bg = el('div', 'party-bg');
  if (!d.art.picture(bg, 'party/backdrop')) bg.classList.add('css');
  root.append(at(bg, 0, 0, size.width, size.height));
  // The panels centred in the space above the foot.
  const x = Math.floor((size.width - PANEL_W) / 2);
  const top = Math.floor((size.height - size.content) / 2);
  // Every slot as the DS shows them (empty ones as its empty panel), so the column fills the phone.
  v.slots.forEach((m, i) => {
    const y = top + i * (PANEL_H + COLUMN.gap);
    root.append(m ? slot(d, v, i, m, x, y) : emptySlot(d, x, y));
  });
  const foot = el('div', `party-column-foot${v.cancel && !v.message ? ' with-cancel' : ''}`);
  if (v.message) foot.append(messageBox(d, v.message.text, v.message.waiting));
  else {
    foot.append(messageBox(d, v.prompt, false));
    if (v.confirm) foot.append(el('div', 'party-order-buttons', ...orderButtons(d, v, false)));
    else if (v.cancel) foot.append(cancelButton(d, v, false));
  }
  const side: HTMLElement[] = [];
  if (v.menu) side.push(contextMenu(d, v.menu));
  if (v.yesNo) side.push(yesNo(d, v.yesNo));
  if (side.length) foot.prepend(el('div', 'party-column-side', ...side));
  root.append(foot);
  root.setAttribute('aria-label', v.title);
  return root;
}
