/**
 * The summary screen on its DS screen (decomp pokemon_summary_screen: window.c window templates, sprites.c
 * positions, main.c bars): the page's ROM art (`summary/pages`), the move and ribbon detail panels
 * (`summary/move_info`), the page tabs (`summary/tabs`, centred at x 188 as CalcPageTabsBaseXPos lays them
 * out, EXIT last), the front picture at (52, 104), the HP and EXP bars from the page's own characters
 * (`summary/bars`), type and category icons, the move and ribbon cursors, and every text at its window's DS
 * rect in the page's colours (`summary/text`). A 256×192 board at the UI unit.
 *
 * Phones (compact): the same screen at the width's unit, its tabs and arrows the controls as on the DS
 * (DS-size targets on phones; the d-pad drives).
 *
 * Packs without the art (the fixture) get CSS stand-ins in the same rects.
 */
import type { Id } from '@opensinnoh/core';
import { dexOf, newGameRecord, type SummaryPageId, type SummaryView } from '@opensinnoh/contracts';
import { levelMark } from '@opensinnoh/text';
import { ICON_ANIM, hpColor, hpPixels } from './art.ts';
import { messageBox, stop, type DrawContext } from './apps.ts';
import { at, atTiles, board, boardContext } from './board.ts';
import { el } from './core.ts';
import { STATUS_CELLS, sprite, textColor } from './party.ts';
import type { Palette } from './pixel-font.ts';
import { plainText } from './strings.ts';
import './summary.css';

/** The moves page's PP label (decomp PrintMoveNameAndPP: PokemonSummary_Text_LabelPp of the base pack). */
function ppLabel(d: DrawContext): string {
  const id = `${newGameRecord(d.registries).id.split(':')[0]!}:PokemonSummary_Text_LabelPp` as Id;
  const text = d.registries.texts.get(id);
  if (!text) throw new Error(`summary: no text ${id}`);
  return plainText(text.text);
}

/** Decomp enum SummaryPage (INFO, MEMO, SKILLS, BATTLE_MOVES, CONDITION, CONTEST_MOVES, RIBBONS, EXIT): each page's tab animation (unselected; selected is + 8), EXIT's. */
const TAB_ANIM: Record<SummaryPageId, number> = { info: 0, memo: 1, skills: 2, moves: 3, condition: 4, ribbons: 6 };
const EXIT_ANIM = 7;
const SELECTED = 8;
/** sprites.c: CENTERED_TAB_POS_X, FOCUSED/UNFOCUSED_TAB_WIDTH, the tabs' y. */
const TABS = { centre: 188, focused: 24, unfocused: 16, y: 24 };
/** Front picture centre (3d_anim.c), status icon, the moves page's mon icon and its types (with the move detail). */
const FRONT = { x: 52, y: 104 };
const STATUS = { x: 80, y: 52 };
/** The caught ball (sprites.c SUMMARY_SPRITE_CAUGHT_BALL). */
const BALL = { x: 16, y: 32 };
const MOVE_MON_ICON = { x: 24, y: 48 };
const MOVE_MON_TYPES = [63, 97];
const MOVE_MON_TYPE_Y = 52;
/** Info page type icons: one centred, or two. */
const INFO_TYPES = { solo: 216, pair: [199, 233], y: 80 };
/** Moves: rows 32 px apart from y 32 (windows at (21, 4 + 4i)); the type icon's centre (151, 42 + 32i); the move cursor at (194, 48 + 32i); the category icon. */
const MOVES = { top: 32, step: 32, typeX: 151, typeY: 42, cursorX: 194, cursorY: 48, category: { x: 108, y: 72 }, ppX: 60 };
/** Ribbons: 4 per row from (132, 56), 32 × 40 apart (RIBBON_CURSOR_BASE, RIBBON_SPACING). */
const RIBBONS = { x: 132, y: 56, dx: 32, dy: 40, perRow: 4 };
/** The bars: HP at tiles (24..29, 6), EXP at (23..29, 23). */
const HP_BAR = { x: 24, y: 6, tiles: 6, px: 48 };
const EXP_BAR = { x: 23, y: 23, tiles: 7, px: 56 };
/** Window rects (tiles, window.c). */
const W = {
  title: [1, 0, 13, 2],
  prompt: [14, 0, 17, 2],
  name: [3, 3, 9, 2],
  level: [1, 5, 6, 2],
  itemLabel: [1, 20, 6, 2],
  itemName: [1, 22, 12, 2],
  info: { labels: [[14, 5, 9], [14, 7, 5], [14, 9, 5], [14, 11, 5], [14, 13, 5], [14, 15, 15], [14, 19, 12]], values: [[24, 5, 6], [23, 7, 8], null, [23, 11, 8], [25, 13, 4], [24, 17, 6], [24, 21, 6]] },
  memo: [14, 5, 17, 18],
  skills: { hpLabel: [18, 4, 2, 2], hp: [23, 4, 7, 2], labels: [16, 7, 6], values: [25, 7, 3], abilityLabel: [14, 18, 6, 2], ability: [21, 18, 11, 2], description: [14, 20, 18, 4] },
  moveDetail: { category: [1, 8, 6, 2], power: [1, 10, 6, 2], accuracy: [1, 12, 8, 2], powerValue: [12, 10, 3, 2], accuracyValue: [12, 12, 3, 2], description: [1, 14, 15, 10] },
  ribbons: { countLabel: [14, 21, 12, 2], count: [26, 21, 5, 2], index: [24, 15, 7, 2], name: [1, 18, 21, 2], description: [1, 20, 30, 4] },
  message: [0, 18, 32, 6],
  /** CONDITION (window.c): SHEEN, FAVORITE FOOD and its line (y 16), the feed mode's OK, the feed message. */
  condition: { sheen: [14, 20, 5, 2], food: [1, 20, 12, 4], prompt: [26, 0, 5, 2], feedMessage: [2, 21, 27, 2] },
} as const;

/**
 * CONDITION's spider graph (3d_anim.c sConditionRectBounds, the camera's view of z = 0: 97.06 fx16 units a DS px about
 * (128, 96)): each condition's vertex runs from `min` (0) by `len` per point to `max` (255); cool, beauty, cute, smart,
 * tough. Drawn GX_RGB(8, 31, 15) at polygon alpha 20 of 31.
 */
const GRAPH = {
  vertices: [
    { min: [5138, 735], len: [0, 12], max: [5138, 3784] },
    { min: [5538, 383], len: [11, 2], max: [8344, 965] },
    { min: [5380, -106], len: [7, -11], max: [7079, -2955] },
    { min: [4803, -106], len: [-7, -11], max: [3106, -2955] },
    { min: [4645, 383], len: [-11, 2], max: [1843, 965] },
  ],
  centre: [5138, 300],
  unit: 97.06,
  fill: 'rgb(66 255 123 / 0.645)',
};
/** sprites.c: the condition arrows' places (cool … tough), the sheen sparkles' row (152 + 8i, 168), the flashes' bounds (FLASH min/max). */
const CONDITION_ARROWS = [[208, 48], [224, 88], [216, 120], [144, 120], [136, 88]] as const;
const SHEEN = { x: 152, dx: 8, y: 168, sprites: 12 };
const FLASH_BOUNDS = [[180, 57, 180, 90], [213, 85, 184, 93], [200, 125, 182, 97], [159, 125, 178, 97], [146, 85, 176, 93]] as const;
type Rect = readonly [number, number, number, number];

type Colors = Record<'black' | 'white' | 'blue' | 'red', Palette>;

function colors(d: DrawContext): Colors {
  return { black: textColor(d, 'summary/text', 'black', 'ink'), white: textColor(d, 'summary/text', 'white', 'light'), blue: textColor(d, 'summary/text', 'blue', 'male'), red: textColor(d, 'summary/text', 'red', 'female') };
}

/** Text in a window rect (tiles); `align` within it. */
function label(d: DrawContext, s: string, palette: Palette, rect: Rect, align: 'left' | 'right' | 'center' = 'left', className = ''): HTMLElement {
  return atTiles(el('span', `sum-text ${align} ${className}`, d.text(s, palette)), ...rect);
}

/** A row of 8-px bar characters (`summary/bars`), `px` filled of the bar. */
function bar(d: DrawContext, prefix: string, tiles: number, px: number, x: number, y: number, className: string, fallback: string): HTMLElement {
  const names = Array.from({ length: tiles }, (_, k) => `${prefix}${Math.max(0, Math.min(8, px - k * 8))}`);
  const canvas = d.art.cells('summary/bars', names, d.unit);
  const e = canvas ? el('span', `${className} rom`, canvas) : el('span', `${className} css ${fallback}`, el('span', 'bar-fill'));
  e.style.setProperty('--fill', String(px / (tiles * 8)));
  return atTiles(e, x, y, tiles, 1);
}

function typeIcon(d: DrawContext, type: Id | 'physical' | 'special' | 'status', name: string, cx: number, cy: number): HTMLElement {
  const icon = d.art.typeIcon(type, d.unit);
  const e = icon ? el('span', 'type-icon', icon) : el('span', `type-chip t-${type.slice(type.indexOf(':') + 1).toLowerCase()}`, d.text(name, 'light'));
  e.title = name;
  return at(e, cx - 16, cy - 8, 32, 16);
}

/** A tap-only control. */
function button(d: DrawContext, id: string, className: string, content: Node[], label?: string): HTMLButtonElement {
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

/** The tab's cell for an animation (the NANR's first frame), or null without the sheet. */
function tabCell(d: DrawContext, anim: number): number | null {
  const sheet = d.art.sheet('summary/tabs');
  return sheet ? sheet.animations![anim]!.frames[0]!.cell : null;
}

/** The page tabs at their DS positions (CalcPageTabsBaseXPos, UpdatePageTabSprites), EXIT last. */
function tabs(d: DrawContext, v: SummaryView): HTMLElement[] {
  const all = [...v.pages.map((p) => ({ id: p.id as SummaryPageId | 'exit', label: p.label, anim: TAB_ANIM[p.id] })), { id: 'exit' as const, label: '', anim: EXIT_ANIM }];
  const current = all.findIndex((t) => t.id === v.page);
  const base = TABS.centre - (TABS.focused + (all.length - 1) * TABS.unfocused) / 2;
  return all.map((t, k) => {
    const on = k === current;
    const x = k <= current ? base + k * TABS.unfocused : base + TABS.focused + (k - 1) * TABS.unfocused;
    const cell = tabCell(d, t.anim + (on ? SELECTED : 0));
    const w = on ? TABS.focused : TABS.unfocused;
    const art = cell === null ? [d.text(t.id === 'exit' ? '×' : t.label.slice(0, 1), on ? 'light' : 'ink')] : [d.art.cells('summary/tabs', [cell], d.unit)!];
    const content = [...art, el('span', 'sr-only', t.label || 'Exit')];
    const cls = `${t.id === 'exit' ? 'sum-exit' : 'sum-tab'}${on ? ' on' : ''}${cell === null ? ' css' : ''}`;
    const tab = button(d, t.id === 'exit' ? 'back' : `page:${t.id}`, cls, content);
    if (t.id !== 'exit') {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(on));
    }
    if (t.label) tab.title = t.label;
    return at(tab, x - 8, TABS.y - 8, w, 16);
  });
}

function page(d: DrawContext, v: SummaryView, c: Colors): Node[] {
  const out: Node[] = [];
  switch (v.page) {
    case 'info': {
      const f = v.info.fields;
      f.forEach((field, i) => {
        const [x, y, w] = W.info.labels[i]!;
        out.push(label(d, field.label, c.white, [x, y, w, 2]));
        const at = W.info.values[i];
        if (at) out.push(label(d, field.value, i === 0 ? c.red : c.black, [at[0], at[1], at[2], 2], i === 0 ? 'center' : i >= 5 ? 'right' : 'left'));
      });
      const types = v.info.types;
      types.forEach((t, k) => out.push(typeIcon(d, t.id, t.name, types.length === 1 ? INFO_TYPES.solo : INFO_TYPES.pair[k]!, INFO_TYPES.y)));
      out.push(bar(d, 'exp_', EXP_BAR.tiles, Math.round(v.info.exp * EXP_BAR.px), EXP_BAR.x, EXP_BAR.y, 'exp-bar', ''));
      break;
    }
    case 'memo':
      out.push(atTiles(el('div', 'sum-memo', d.flow(v.memo.join('\n'), true, c.black)), ...W.memo));
      break;
    case 'skills': {
      const s = v.skills;
      const sk = W.skills;
      out.push(label(d, s.hp.label, c.white, sk.hpLabel), label(d, s.hp.value, c.black, sk.hp, 'right'));
      const px = hpPixels(s.hpNow, s.hpMax);
      const colour = hpColor(s.hpNow, s.hpMax) === 'max' ? 'green' : hpColor(s.hpNow, s.hpMax);
      out.push(bar(d, `hp_${colour}_`, HP_BAR.tiles, px, HP_BAR.x, HP_BAR.y, 'hp-bar', colour));
      s.stats.forEach((st, i) => {
        out.push(label(d, st.label, st.nature === 'up' ? c.red : st.nature === 'down' ? c.blue : c.white, [sk.labels[0], sk.labels[1] + 2 * i, sk.labels[2], 2], 'left', st.nature ? `nature-${st.nature}` : ''));
        out.push(label(d, st.value, c.black, [sk.values[0], sk.values[1] + 2 * i, sk.values[2], 2], 'right'));
      });
      out.push(label(d, s.ability.label, c.white, sk.abilityLabel), label(d, s.ability.value, c.black, sk.ability));
      out.push(atTiles(el('div', 'sum-ability', d.flow(s.abilityDescription, false, c.black)), ...sk.description));
      break;
    }
    case 'condition':
      out.push(...condition(d, v, c));
      break;
    case 'moves':
      out.push(...moves(d, v, c));
      break;
    case 'ribbons':
      out.push(...ribbons(d, v, c));
      break;
  }
  return out;
}

function moves(d: DrawContext, v: SummaryView, c: Colors): Node[] {
  const m = v.moves;
  const out: Node[] = [];
  m.rows.forEach((r, i) => {
    const y = MOVES.top + i * MOVES.step;
    const row = stop(d, `move:${i}`, [at(el('span', 'sum-text', d.text(r.name, c.white)), 41, 2), at(el('span', 'sum-text', d.text(ppLabel(d), c.black)), 56, 16), at(el('span', 'sum-text center', d.text(r.pp, c.black)), MOVES.ppX + 40 - 24, 16, 48)], `move-row${r.isNew ? ' new' : ''}${m.swapping === i ? ' swapping' : ''}`, m.cursor === i);
    out.push(at(row, 128, y, 128, MOVES.step));
    out.push(typeIcon(d, r.type, '', MOVES.typeX, MOVES.typeY + i * MOVES.step));
  });
  // Empty slots (decomp PrintMoveNameAndPP, MOVE_NONE): move name 0 and "--" where the PP goes, nothing to pick.
  for (let i = m.rows.length; i < 4; i++) {
    const slot = el('div', 'move-row empty', at(el('span', 'sum-text', d.text(m.empty.name, c.white)), 41, 2), at(el('span', 'sum-text center', d.text(m.empty.pp, c.black)), MOVES.ppX + 40 - 24, 16, 48));
    out.push(at(slot, 128, MOVES.top + i * MOVES.step, 128, MOVES.step));
  }
  // The cursor frames: the selected move's, and while switching the first pick's.
  if (m.swapping !== null && m.swapping !== m.cursor) {
    const s = sprite(d, 'summary/move_cursor', 1, MOVES.cursorX, MOVES.cursorY + m.swapping * MOVES.step, 'move-cursor');
    if (s) out.push(s);
  }
  if (m.cursor !== null) {
    const s = sprite(d, 'summary/move_cursor', 0, MOVES.cursorX, MOVES.cursorY + m.cursor * MOVES.step, 'move-cursor') ?? at(el('span', 'move-cursor css'), 130, MOVES.top + m.cursor * MOVES.step, 128, 32);
    out.push(s);
  }
  const dt = m.detail;
  if (dt) {
    const md = W.moveDetail;
    out.push(detailPanel(d, 'move_info'));
    out.push(at(el('span', 'sum-mon-icon', d.art.pokemonIcon(v.mon.species, v.mon.form, ICON_ANIM.hpMax, v.mon.egg)), MOVE_MON_ICON.x - 16, MOVE_MON_ICON.y - 16, 32, 32));
    v.info.types.forEach((t, k) => out.push(typeIcon(d, t.id, t.name, MOVE_MON_TYPES[k]!, MOVE_MON_TYPE_Y)));
    out.push(label(d, dt.categoryName, c.white, md.category), typeIcon(d, dt.category, dt.categoryName, MOVES.category.x, MOVES.category.y));
    out.push(label(d, dt.power.label, c.white, md.power), label(d, dt.power.value, c.black, md.powerValue, 'right'));
    out.push(label(d, dt.accuracy.label, c.white, md.accuracy), label(d, dt.accuracy.value, c.black, md.accuracyValue, 'right'));
    out.push(atTiles(el('div', 'move-desc', d.flow(dt.description, false, c.black)), ...md.description));
  }
  return out;
}

/** A vertex of the spider graph at a condition's value (SetConditionVecFromStat), in DS px. */
function graphPoint(i: number, value: number): [number, number] {
  const b = GRAPH.vertices[i]!;
  const v = Math.round(value);
  const [x, y] = v >= 255 ? b.max : v <= 0 ? b.min : [b.min[0]! + b.len[0]! * v, b.min[1]! + b.len[1]! * v];
  return [128 + x! / GRAPH.unit, 96 - y! / GRAPH.unit];
}

/** The frame of an animation `frame` frames in (forward ones hold their last frame), or null without the sheet. */
function frameOf(d: DrawContext, path: string, anim: number, frame: number): number | null {
  const a = d.art.sheet(path)?.animations?.[anim];
  if (!a?.frames.length) return null;
  const total = a.frames.reduce((n, f) => n + f.ticks, 0);
  let t = a.mode === 'forward' ? Math.min(frame, total - 1) : frame % total;
  for (const f of a.frames) {
    if (t < f.ticks) return f.cell;
    t -= f.ticks;
  }
  return a.frames.at(-1)!.cell;
}

/**
 * CONDITION: the spider graph (growing from `from` a quarter per frame), the highest conditions' flashes once drawn,
 * the sheen's sparkles (PokemonSummaryScreen_DrawSheenSprites: from frame 8 one every 10 frames, then all together
 * every 32 frames after the last has played), the raised conditions' arrows, the labels and the feed windows.
 */
function condition(d: DrawContext, v: SummaryView, c: Colors): Node[] {
  const k = v.condition;
  const out: Node[] = [];
  const step = k.graph / 4;
  const points = k.values.map((to, i) => graphPoint(i, k.from[i]! + (to - k.from[i]!) * step));
  const centre = [128 + GRAPH.centre[0]! / GRAPH.unit, 96 - GRAPH.centre[1]! / GRAPH.unit];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 256 192');
  svg.setAttribute('class', 'sum-graph');
  svg.setAttribute('aria-hidden', 'true');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', (k.values.some((x, i) => x || k.from[i]) ? points : [centre]).map((p) => p.join(',')).join(' '));
  poly.setAttribute('fill', GRAPH.fill);
  svg.append(poly);
  const graph = at(el('span', 'sum-graph-box'), 0, 0, 256, 192);
  graph.append(svg);
  out.push(graph);
  graph.setAttribute('aria-label', k.values.join(', '));
  // UpdateConditionFlashSprites: the highest conditions (not 0) flash at their place along the axis once drawn.
  if (k.graph >= 4) {
    const top = Math.max(...k.values);
    k.values.forEach((x, i) => {
      if (!x || x !== top) return;
      const [maxX, maxY, minX, minY] = FLASH_BOUNDS[i]!;
      const fx = minX + (((maxX - minX) * x) >> 8);
      const fy = minY + (((maxY - minY) * x) >> 8);
      const cell = frameOf(d, 'summary/condition_flash', 0, k.sheenFrame);
      const s = cell === null ? null : sprite(d, 'summary/condition_flash', cell, fx, fy, 'condition-flash');
      if (s) out.push(s);
    });
  }
  // The sheen: sparkle i starts at 8 + 10i; after the last one plays out and 32 frames, all of them together, and again.
  const sheet = d.art.sheet('summary/sheen');
  const length = sheet?.animations?.[0]?.frames.reduce((n, f) => n + f.ticks, 0) ?? 1;
  const firstRound = 8 + 10 * (k.sheen - 1) + length;
  for (let i = 0; i < k.sheen; i++) {
    const start = 8 + 10 * i;
    let t = k.sheenFrame - start;
    if (k.sheenFrame >= firstRound) t = (k.sheenFrame - firstRound) % (length + 32) - 32;
    if (t < 0 || t >= length) continue;
    const cell = frameOf(d, 'summary/sheen', 0, t);
    const s = cell === null ? null : sprite(d, 'summary/sheen', cell, SHEEN.x + SHEEN.dx * i, SHEEN.y, 'sheen');
    if (s) out.push(s);
  }
  k.arrows.forEach((on, i) => {
    if (!on) return;
    const cell = frameOf(d, 'summary/condition_arrow', 0, k.sheenFrame);
    const s = cell === null ? null : sprite(d, 'summary/condition_arrow', cell, CONDITION_ARROWS[i]![0], CONDITION_ARROWS[i]![1], 'condition-arrow');
    if (s) out.push(s);
  });
  out.push(label(d, k.sheenLabel, c.white, W.condition.sheen));
  if (k.flavor) {
    const [x, y, w] = W.condition.food;
    out.push(label(d, k.flavor.label, c.white, [x, y, w, 2]), label(d, k.flavor.text, c.black, [x, y + 2, w, 2]));
  }
  if (k.prompt) out.push(label(d, k.prompt, c.white, W.condition.prompt, 'right', 'sum-hint'));
  return out;
}

/** BG2's detail panel (`summary/move_info` cell), over the page. */
function detailPanel(d: DrawContext, cell: 'move_info' | 'ribbon_info'): HTMLElement {
  const canvas = d.art.cells('summary/move_info', [cell], d.unit);
  return at(canvas ? el('span', `sum-detail ${cell}`, canvas) : el('span', `sum-detail ${cell} css`), 0, 0, 256, 192);
}

/** RIBBONS: the shown rows (3, or 2 while one is selected), the arrows, the count, the selected ribbon's panel. */
function ribbons(d: DrawContext, v: SummaryView, c: Colors): Node[] {
  const r = v.ribbons;
  const R = W.ribbons;
  const out: Node[] = [];
  const first = r.row * RIBBONS.perRow;
  r.list.slice(first, first + r.rows * RIBBONS.perRow).forEach((x, k) => {
    const i = first + k;
    const cx = RIBBONS.x + (k % RIBBONS.perRow) * RIBBONS.dx;
    const cy = RIBBONS.y + Math.floor(k / RIBBONS.perRow) * RIBBONS.dy;
    const icon = d.art.cells('summary/ribbons', [x.ribbon], d.unit);
    const b = stop(d, `ribbon:${i}`, icon ? [icon, el('span', 'sr-only', x.name)] : [d.text(x.name.slice(0, 2))], 'ribbon-slot', r.cursor === i);
    b.title = x.name;
    out.push(at(b, cx - 16, cy - 20, RIBBONS.dx, RIBBONS.dy));
  });
  if (r.cursor !== null) {
    const k = r.cursor - first;
    const s = sprite(d, 'summary/ribbon_cursor', 0, RIBBONS.x + (k % RIBBONS.perRow) * RIBBONS.dx, RIBBONS.y + Math.floor(k / RIBBONS.perRow) * RIBBONS.dy, 'ribbon-cursor');
    if (s) out.push(s);
  }
  const lastRow = Math.ceil(r.list.length / RIBBONS.perRow) - r.rows;
  /** The arrows' buttons are taller than their 16-px art, to tap. */
  const ARROW_H = 36;
  const arrow = (dir: 'up' | 'down', show: boolean, y: number) => {
    if (!show) return;
    const art = d.art.cells('summary/ribbon_arrow', [dir === 'up' ? 1 : 0], d.unit);
    out.push(at(button(d, `ribbons:${dir}`, `ribbon-arrow ${dir}${art ? ' rom' : ''}`, art ? [art] : [], dir === 'up' ? 'Previous row' : 'Next row'), 240, y, 16, ARROW_H));
  };
  // Right of the grid, along the first shown row and the last.
  arrow('up', r.detail !== null && r.row > 0, RIBBONS.y - 20);
  arrow('down', r.detail !== null && r.row < lastRow, RIBBONS.y - 20 + r.rows * RIBBONS.dy - ARROW_H);
  if (!r.detail) out.push(label(d, r.count.label, c.white, R.countLabel), label(d, r.count.value, c.black, R.count, 'right'));
  else {
    out.push(detailPanel(d, 'ribbon_info'));
    out.push(label(d, r.detail.index, c.black, R.index, 'right'), label(d, r.detail.name, c.white, R.name));
    out.push(atTiles(el('div', 'ribbon-desc', d.flow(r.detail.description, false, c.black)), ...R.description));
  }
  return out;
}

export function summary(wide: DrawContext, v: SummaryView): HTMLElement {
  const d = boardContext(wide);
  const c = colors(d);
  const m = v.mon;
  const root = board(`summary-screen summary-${v.mode}`);
  const pageArt = v.page === 'moves' && v.mode === 'teach' ? 'moves_select' : v.page;
  // The open page's edges (each page has its own colours).
  if (d.art.sheet('summary/pages')) root.dataset.backdrop = `summary/pages#${pageArt}`;
  const bg = d.art.cells('summary/pages', [pageArt], d.unit);
  root.append(at(bg ? el('span', 'sum-bg', bg) : el('span', `sum-bg css page-${v.page}`), 0, 0, 256, 192));
  const title = v.pages.find((p) => p.id === v.page)!.label;
  root.append(label(d, title, c.white, W.title));
  const hint = v.page === 'moves' ? v.moves.hint : v.page === 'ribbons' ? v.ribbons.hint : '';
  if (hint) root.append(label(d, hint, c.white, W.prompt, 'right', 'sum-hint'));
  // The OpenSinnoh additions (options summaryRename, statView) sit where the DS prints its page hints, in the ROM font.
  const extra = v.page === 'info' && v.info.rename ? { id: 'rename', text: v.info.rename } : v.page === 'skills' && v.skills.values ? { id: 'values', text: v.skills.values.label } : null;
  if (extra) root.append(atTiles(button(d, extra.id, `sum-text right sum-hint sum-extra`, [d.text(extra.text, c.white)]), ...W.prompt));
  root.append(...tabs(d, v));

  // The left column: name and gender, level and status, the front picture, the held item.
  const name = label(d, m.name, c.white, W.name, 'left', 'sum-name');
  if (m.gender !== 'none') name.append(el('span', 'sum-gender', d.text(m.gender === 'male' ? '♂' : '♀', m.gender === 'male' ? c.blue : c.red)));
  root.append(name);
  // The caught ball (PokemonSummaryScreen_SetCaughtBallGfx), by the ball item's constant.
  const balls = d.art.sheet('summary/balls');
  if (balls) {
    const ball = m.ball.slice(m.ball.indexOf(':') + 1);
    if (!balls.names!.includes(ball)) throw new Error(`ui: no caught-ball art for ${m.ball}`);
    root.append(sprite(d, 'summary/balls', ball, BALL.x, BALL.y, 'sum-ball')!);
  }
  // PrintLevel: the level mark (the game language's "Lv" picture) at (0, 5) of the window, the number from x 16
  // (past a mark wider than that).
  const mark = levelMark(dexOf(d.registries).language);
  if (!m.egg) root.append(atTiles(el('span', 'sum-level', at(el('span', 'sum-text', d.text(mark, c.black)), 0, 0), at(el('span', 'sum-text', d.text(m.level, c.black)), Math.max(16, d.measure(mark) + 1), 0)), ...W.level));
  if (m.status !== 'none') {
    const s = sprite(d, 'summary/status', STATUS_CELLS[m.status], STATUS.x, STATUS.y, 'status-icon');
    if (s) root.append(s);
  }
  const front = d.art.pokemonFront(m.species, m.form, m.shiny, m.gender === 'female', d.unit, m.egg) ?? d.art.pokemonIcon(m.species, m.form, ICON_ANIM.hpMax, m.egg);
  root.append(at(el('span', 'sum-picture', front), FRONT.x - 40, FRONT.y - 40, 80, 80));
  // The feed modes print FAVORITE FOOD where the held item shows (window.c DrawConditionPageWindows).
  if (!v.condition.flavor) root.append(label(d, m.item.label, c.white, W.itemLabel), label(d, m.item.value, c.black, W.itemName));

  root.append(...page(d, v, c));
  // Previous/next beside the picture, while no detail panel covers it.
  if (!v.moves.detail && !v.ribbons.detail) root.append(at(button(d, 'prev', 'mon-step prev', [], 'Previous Pokémon'), 84, 64, 20, 24), at(button(d, 'next', 'mon-step next', [], 'Next Pokémon'), 84, 112, 20, 24));
  if (v.message) root.append(atTiles(messageBox(d, v.message.text, v.message.waiting), ...W.message));
  root.setAttribute('aria-label', m.name);
  return root;
}
