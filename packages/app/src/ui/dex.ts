/**
 * The Pokédex on its DS screens (packages/menus pokedex.ts owns the state; docs/research/pokedex.md): each
 * screen is a 256×192 board at the UI unit on the zukan art the decomp loads for it, every window at its DS
 * place. The list (ov21_021D5AEC.c's top screen: the species window with the picture, the counters, the 9-row
 * list, which scrolls as the DS's wheel does, and the touch screen's SEARCH / SWITCH / QUIT along the bottom); an
 * entry (the banner with the page tabs over the page's own screen: info as infomain.c lays it out, the area
 * map, the height check, forms, cry); the search (rows of ◀ value ▶ over the search screen, the message box).
 * The list is patched in place, sampling the headless 30 Hz position without a browser scroll container.
 */
import type { AssetRef, InputFrame, PokedexEntryView, PokedexListView, PokedexPageId, PokedexRow, PokedexSearchView, PokedexView, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { messageBox, stop, type DrawContext } from './apps.ts';
import { at, board, boardContext } from './board.ts';
import { el } from './core.ts';
import { CryPage } from './dex-cry.ts';
import { bgPicture, sprite } from './sprites.ts';
import './dex.css';


const dpr = () => devicePixelRatio || 1;

/** A canvas of `w`×`h` DS px shown at `k` device px per DS px (whole pixels, never smoothed). */
function pixelCanvas(w: number, h: number, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.setAttribute('aria-hidden', 'true');
  sizeCanvas(c, k);
  return c;
}

function sizeCanvas(c: HTMLCanvasElement, k: number): void {
  c.style.width = `${(c.width * k) / dpr()}px`;
  c.style.height = `${(c.height * k) / dpr()}px`;
}

/** Device px per DS px for `dots` DS px per UI dot (the UI scale). */
const kOf = (d: DrawContext, dots = 1) => Math.max(1, Math.round(d.scale * dots * dpr()));

function sheetOf(d: DrawContext, path: string): Ui2dSheet | undefined {
  return d.art.sheet(path);
}

/** Cell `cell` of a sheet drawn at (x, y) as the DS would (origin at the position), optionally scaled about the origin. */
function drawCell(g: CanvasRenderingContext2D, img: CanvasImageSource, s: Ui2dSheet, cell: number, x: number, y: number, scale = 1): void {
  const c = s.cells[cell];
  if (!c) throw new Error(`ui: sheet ${s.id} has no cell ${cell}`);
  g.drawImage(img, c.x, c.y, c.w, c.h, Math.round(x - c.ox * scale), Math.round(y - c.oy * scale), Math.round(c.w * scale), Math.round(c.h * scale));
}

/** The first frame's cell of an animation of a sheet. */
function animCell(s: Ui2dSheet, anim: number): number {
  const f = s.animations?.[anim]?.frames[0];
  if (!f) throw new Error(`ui: sheet ${s.id} has no animation ${anim}`);
  return f.cell;
}

/** One cell of a sheet as its own canvas (k device px per DS px); an empty span on packs without the sheet. */
function cellCanvas(d: DrawContext, path: string, pick: (s: Ui2dSheet) => number, k: number): HTMLElement {
  const s = sheetOf(d, path);
  if (!s) return el('span', 'dex-art-missing');
  const cell = pick(s);
  const c = s.cells[cell]!;
  const canvas = pixelCanvas(c.w, c.h, k);
  void d.art.image(s.atlas).then((img) => canvas.getContext('2d')!.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h));
  return canvas;
}

/** A species' front picture (80×80, pl_pokegra), optionally as a black silhouette. */
function frontPicture(d: DrawContext, species: Id, form: number, female: boolean): Promise<HTMLCanvasElement> | null {
  const sprites = d.registries.pokemonSprites.get(species);
  if (!sprites) return null;
  const f = sprites.forms[form] ?? sprites.forms[0]!;
  const face = female && f.frontFemale ? f.frontFemale : f.front;
  return d.art.image(f.atlas).then((img) => {
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 80;
    c.getContext('2d')!.drawImage(img, 0, face.y, 80, 80, 0, 0, 80, 80);
    return c;
  });
}

function frontCanvas(d: DrawContext, species: Id, form: number, female: boolean, k: number): HTMLCanvasElement {
  const canvas = pixelCanvas(80, 80, k);
  canvas.className = 'dex-mon';
  void frontPicture(d, species, form, female)?.then((pic) => canvas.getContext('2d')!.drawImage(pic, 0, 0));
  return canvas;
}

function silhouette(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function button(d: DrawContext, id: string, className: string, content: Node[], label?: string): HTMLButtonElement {
  const b = el('button', className, ...content);
  b.type = 'button';
  b.dataset.tap = id;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', () => d.tap(id));
  return b;
}


/** A Pokédex board: the screen's art (or our stand-in) and the screen's class for the views and tests. */
function dexBoard(d: DrawContext, className: string, art: string): HTMLElement {
  const root = board(`ds-screen dex-board ${className}`);
  const bg = bgPicture(d, art, 0, 0, 'dex-screen-art');
  root.append(bg ?? at(el('span', 'dex-css-screen'), 0, 0, 256, 192));
  if (bg) root.dataset.backdrop = art;
  return root;
}

/** Text at a DS rect of a board, aligned in it. */
function textAt(d: DrawContext, s: string, x: number, y: number, w: number, h: number, align: 'left' | 'center' | 'right' = 'left', className = ''): HTMLElement {
  return at(el('div', `dex-text ${align} ${className}`.trim(), d.text(s)), x, y, w, h);
}

// --- The list ------------------------------------------------------------------------------------

/** DS plate centres, including the two recycling stops just outside the nine visible slots.
 * Measurements from ov21_021D5AEC.c; interpolated only by the model's 30 Hz scroll position.
 */
const ARC = [[189, 12], [185, 22], [181, 26], [177, 42], [175, 58], [170, 82], [175, 106], [177, 122], [181, 138], [185, 142], [180 + 9 / 4096, 152]] as const;
const LIST = { window: [16, 40, 80, 80], name: [8, 128, 96, 14], counts: [8, 142, 96, 28], list: [104, 4, 152, 154], actions: [8, 172, 240, 16] } as const;

interface ListDom {
  unit: number;
  root: HTMLElement;
  list: HTMLElement;
  head: HTMLElement;
  showcase: HTMLElement;
  actions: HTMLElement;
  rowsKey: string;
  rows: Map<number, HTMLElement>;
  showcaseKey: string;
  headKey: string;
  actionsKey: string;
}
let listDom: ListDom | null = null;

/** Drag the DS wheel over the arc in the composed screen. The original touch wheel's centre is (248,104),
 * radius 104; its angular travel is measured at radius 524, with ten travel units per arc pixel.
 * A stationary tap selects a row; tapping the current row (or its picture) opens it.
 */
const wheelGesture = { travel: 0, released: false };

/** Sample all pointer events since the last game tick, so event frequency cannot change wheel speed. */
export function dexInput(frame: InputFrame, active: boolean): InputFrame {
  if (!active) {
    wheelGesture.travel = 0;
    wheelGesture.released = false;
    return frame;
  }
  if (frame.tap !== undefined) return frame;
  const speed = Math.round(wheelGesture.travel);
  wheelGesture.travel = 0;
  if (Math.abs(speed) > 16) return { ...frame, tap: `wheel:${speed}` };
  if (wheelGesture.released) {
    wheelGesture.released = false;
    return { ...frame, tap: 'wheel-end' };
  }
  return frame;
}

function wheelTouch(d: DrawContext, list: HTMLElement, root: HTMLElement): void {
  let drag: { id: number; x: number; y: number; angle: number; moved: boolean } | null = null;
  let suppressClick = false;
  const point = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const x = (e.clientX - r.left) / d.unit;
    const y = (e.clientY - r.top) / d.unit;
    return { x, y, angle: Math.atan2(y - 104, x - 248) };
  };
  list.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = point(e);
    drag = { id: e.pointerId, ...p, moved: false };
    suppressClick = false;
  });
  list.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = point(e);
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 3) return;
    drag.moved = true;
    list.setPointerCapture(e.pointerId);
    const angle = Math.atan2(Math.sin(p.angle - drag.angle), Math.cos(p.angle - drag.angle));
    wheelGesture.released = false;
    wheelGesture.travel += angle * 5240;
    drag.angle = p.angle;
    e.preventDefault();
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    suppressClick = drag.moved;
    if (drag.moved) { wheelGesture.released = true; }
    drag = null;
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('lostpointercapture', end);
  list.addEventListener('click', e => {
    if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; }
  }, true);
}

function listRow(d: DrawContext, r: PokedexRow, i: number): HTMLElement {
  const row = button(d, `row:${i}`, `dex-row${r.species ? '' : ' unseen'}`, [
    d.text(r.number, 'ink', 'px dex-no'), d.text(r.name, 'ink', 'px dex-name'),
  ]);
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');
  row.setAttribute('aria-posinset', String(i + 1));
  row.dataset.nav = '';
  if (r.species) row.dataset.species = r.species;
  return row;
}

/** Repaint only the ROM sprite layers as a plate changes depth. Text and focus remain stable. */
function plateArt(d: DrawContext, row: HTMLElement, r: PokedexRow, depth: number): void {
  const palette = depth === 0 ? 0 : Math.min(9, 6 + depth);
  if (row.dataset.palette === String(palette)) return;
  row.dataset.palette = String(palette);
  row.querySelector('.dex-row-art')?.remove();
  const path = `pokedex/list_tags_${palette}`;
  const sheet = sheetOf(d, path);
  const art = el('span', 'dex-row-art');
  if (sheet) {
    art.append(sprite(d, path, animCell(sheet, 0), 64, 8)!);
    if (r.caught) art.append(sprite(d, path, animCell(sheet, 1), 10, 8, 'dex-ball')!);
    row.classList.add('rom-plate');
  } else if (r.caught) art.append(at(ballMark(d), 6, 4));
  row.prepend(art);
}

/** The caught mark (search_body_shapes anim 1): an 8×8 DS px ball, its cell drawn about its origin. */
function ballMark(d: DrawContext): HTMLElement {
  const box = el('span', 'dex-ball');
  const s = sheetOf(d, 'pokedex/body_shapes');
  if (!s) return box;
  const cell = animCell(s, 1);
  const c = s.cells[cell]!;
  const canvas = cellCanvas(d, 'pokedex/body_shapes', () => cell, kOf(d));
  canvas.style.left = `${(4 - c.ox) * d.unit}px`;
  canvas.style.top = `${(4 - c.oy) * d.unit}px`;
  box.append(canvas);
  return box;
}

function showcase(d: DrawContext, v: PokedexListView): HTMLElement[] {
  const r = v.rows[v.cursor];
  const pic = at(button(d, 'open', 'dex-showcase-pic', [], r?.name), ...LIST.window);
  if (r?.species) pic.append(frontCanvas(d, r.species, r.form, false, kOf(d)));
  else pic.append(cellCanvas(d, 'pokedex/unseen_icon', () => 0, kOf(d)));
  const name = at(el('div', 'dex-showcase-name', ...(r ? [d.text(r.number, 'light'), d.text(r.name, 'light')] : [])), ...LIST.name);
  return [pic, name];
}

function actions(d: DrawContext, v: PokedexListView): HTMLElement[] {
  const one = (s: string | null) => s?.replace('\n', ' ') ?? null;
  const out: HTMLElement[] = [];
  if (v.searchLabel) out.push(button(d, 'search', 'dex-action search', [d.text(one(v.searchLabel)!)]));
  if (v.switchLabel) out.push(button(d, 'switch', 'dex-action switch', [d.text(one(v.switchLabel)!)]));
  out.push(button(d, 'quit', 'dex-action quit', [d.text(v.quitLabel)]));
  return out;
}

function drawList(wide: DrawContext, v: PokedexListView): HTMLElement {
  const d = boardContext(wide);
  let dom = listDom;
  if (!dom || dom.unit !== d.unit) {
    const list = at(el('div', 'dex-list'), ...LIST.list);
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', v.title);
    const head = at(el('div', 'dex-list-head'), ...LIST.counts);
    const showcasePanel = el('div', 'dex-showcase');
    const actionBar = at(el('div', 'dex-actions'), ...LIST.actions);
    const root = dexBoard(d, 'dex-list-sheet', 'pokedex/list_screen');
    root.append(showcasePanel, head, list, actionBar);
    wheelTouch(d, list, root);
    dom = listDom = { unit: d.unit, root, list, head, showcase: showcasePanel, actions: actionBar, rowsKey: '', rows: new Map(), showcaseKey: '', headKey: '', actionsKey: '' };
  }
  dom.root.classList.toggle('national', v.national);
  const headKey = JSON.stringify(v.counts);
  if (headKey !== dom.headKey) {
    dom.headKey = headKey;
    dom.head.replaceChildren(...v.counts.map((f) => el('span', 'dex-count', d.text(f.label, 'light'), d.text(f.value, 'light'))));
  }
  const rowsKey = JSON.stringify(v.rows);
  if (rowsKey !== dom.rowsKey) {
    dom.rowsKey = rowsKey;
    dom.rows.clear();
    dom.list.replaceChildren();
  }
  // Nine recycled plates, with the selected entry always at the centre, even at either list boundary.
  for (const [i, row] of dom.rows) if (Math.abs(i - v.cursor) > 4) { row.remove(); dom.rows.delete(i); }
  for (let i = Math.max(0, v.cursor - 4); i <= Math.min(v.rows.length - 1, v.cursor + 4); i++) {
    let row = dom.rows.get(i);
    if (!row) {
      row = listRow(d, v.rows[i]!, i);
      dom.rows.set(i, row);
      dom.list.append(row);
    }
    const slot = Math.max(0, Math.min(10, i - v.scrollPosition + 5));
    const lo = Math.floor(slot);
    const a = ARC[lo]!;
    const b = ARC[Math.min(10, lo + 1)]!;
    const t = slot - lo;
    // The DS truncates fixed-point screen positions. Snap in DS pixels before whole-device-pixel scaling.
    const x = Math.floor(a[0] + (b[0] - a[0]) * t);
    const y = Math.floor(a[1] + (b[1] - a[1]) * t);
    at(row, x - 64 - LIST.list[0], y - 8 - LIST.list[1], 128, 16);
    const depth = Math.abs(i - v.cursor);
    row.style.zIndex = String(9 - depth);
    row.classList.toggle('is-cursor', i === v.cursor);
    row.setAttribute('aria-selected', String(i === v.cursor));
    row.setAttribute('aria-setsize', String(v.rows.length));
    row.tabIndex = i === v.cursor ? 0 : -1;
    plateArt(d, row, v.rows[i]!, depth);
  }
  dom.root.querySelector('.dex-scroll-thumb')?.remove();
  const tags = sheetOf(d, 'pokedex/body_shapes');
  if (tags && v.rows.length) dom.root.append(sprite(d, 'pokedex/body_shapes', animCell(tags, 2), 248, Math.floor(58 + 54 * v.cursor / v.rows.length), 'dex-scroll-thumb')!);
  dom.root.dataset.scrollPosition = String(v.scrollPosition);
  dom.root.dataset.cursor = String(v.cursor);
  const showKey = `${v.cursor}|${JSON.stringify(v.rows[v.cursor] ?? null)}`;
  if (showKey !== dom.showcaseKey) {
    dom.showcaseKey = showKey;
    dom.showcase.replaceChildren(...showcase(d, v));
  }
  const actKey = `${v.searchLabel}|${v.switchLabel}|${v.quitLabel}`;
  if (actKey !== dom.actionsKey) {
    dom.actionsKey = actKey;
    dom.actions.replaceChildren(...actions(d, v));
  }
  return dom.root;
}

// --- The entry -----------------------------------------------------------------------------------

/**
 * infomain.c: the picture in the species window at tile (0, 3), the category box at (192, 52), the type icons at
 * (170, 72) and (220, 72), HT/WT at (152, 88/104) with their values from x 184, the footprint at (120, 88) in its
 * window at tile (12, 8), the entry text from y 136 in the entry window at tile (0, 16).
 */
const INFO = { picture: [8, 32], plate: [104, 24, 144, 16], category: [144, 44, 96, 16], types: [154, 64, 96, 16], ht: [152, 88], wt: [152, 104], value: [184, 64], foot: [112, 80, 16, 16], entry: [8, 136, 240, 48] } as const;
/** The banner's row (BG2's top 16 px): its mark (back to the list), the page tabs, the caught ball, previous/next. */
const BANNER = { back: [0, 0, 16, 16], tabs: [16, 0, 184, 16], ball: [208, 8], prev: [216, 0, 16, 16], next: [232, 0, 16, 16] } as const;

function typeIcons(d: DrawContext, types: Id[]): HTMLElement {
  const box = el('div', 'dex-types');
  for (const t of types) {
    const name = t.slice(t.indexOf(':') + 1).replace(/^TYPE_/, '').toLowerCase();
    const s = sheetOf(d, 'pokedex/types');
    const i = s?.names?.indexOf(name) ?? -1;
    if (s && i >= 0) box.append(el('span', 'sr-only', d.registries.types.get(t)?.name ?? name), cellCanvas(d, 'pokedex/types', () => i, kOf(d)));
    else box.append(el('span', 'dex-type-chip', d.text(d.registries.types.get(t)?.name ?? name)));
  }
  return box;
}

function footprint(d: DrawContext, ref: AssetRef | null): HTMLElement {
  const box = at(el('div', 'dex-foot'), ...INFO.foot);
  if (!ref) return box;
  const c = pixelCanvas(16, 16, kOf(d));
  void d.art.image(ref).then((img) => c.getContext('2d')!.drawImage(img, 0, 0));
  box.append(c);
  return box;
}

/** The front picture (80×80) in the species window. */
const pictureAt = (d: DrawContext, v: PokedexEntryView, form = v.form, female = v.female) => at(el('div', 'dex-pic', frontCanvas(d, v.species, form, female, kOf(d))), INFO.picture[0], INFO.picture[1], 80, 80);

function infoPage(d: DrawContext, v: PokedexEntryView): HTMLElement[] {
  const out = [
    pictureAt(d, v),
    at(el('div', 'dex-plate-text', d.text(v.number), d.text(v.name)), ...INFO.plate),
    textAt(d, v.category, ...INFO.category, 'center', 'dex-category'),
    at(typeIcons(d, v.types), ...INFO.types),
    textAt(d, v.height.label, INFO.ht[0], INFO.ht[1], 32, 16),
    textAt(d, v.height.value, INFO.value[0], INFO.ht[1], INFO.value[1], 16),
    textAt(d, v.weight.label, INFO.wt[0], INFO.wt[1], 32, 16),
    textAt(d, v.weight.value, INFO.value[0], INFO.wt[1], INFO.value[1], 16),
    footprint(d, v.footprint),
  ];
  if (v.description) out.push(at(el('div', 'dex-entry-text', d.flow(v.description, true)), ...INFO.entry));
  return out;
}

/** The parts of the DS screens the pages paint: the area map's frame, the height check's panel (x, y, w, h). */
const AREA_VIEW = [80, 56, 168, 128] as const;
const SIZE_VIEW = [39, 43, 179, 91] as const;
/** The area page's panel left of the map: the time-of-day buttons (the DS has them on its touch screen). */
const AREA_TIMES = [4, 64, 72, 54] as const;
/** The height check's two label windows at the bottom (height_check_main). */
const SIZE_LEGEND = [[18, 150, 100, 36], [138, 150, 100, 36]] as const;

/** A canvas of `view` of a 256×192 DS screen at its DS rect: its context draws in screen coordinates. */
function screenCanvas(d: DrawContext, view: readonly [number, number, number, number]): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; node: HTMLElement } {
  const canvas = pixelCanvas(view[2], view[3], kOf(d));
  canvas.classList.add('dex-map');
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.translate(-view[0], -view[1]);
  return { canvas, g, node: at(el('div', 'dex-stage', canvas), ...view) };
}

function areaPage(d: DrawContext, v: PokedexEntryView): HTMLElement[] {
  const a = v.area!;
  const { g, node } = screenCanvas(d, AREA_VIEW);
  const sheets = [a.map, ...a.overlays].map((id) => d.registries.ui2d.get(id)!);
  const fields = sheetOf(d, 'pokedex/area_fields');
  const special = sheetOf(d, 'pokedex/area_fields_special');
  const dungeon = sheetOf(d, 'pokedex/dungeon_highlight');
  void Promise.all([...sheets.map((s) => d.art.image(s.atlas)), ...[fields, special, dungeon].map((s) => (s ? d.art.image(s.atlas) : Promise.resolve(null)))]).then((imgs) => {
    sheets.forEach((s, i) => drawCell(g, imgs[i]!, s, 0, 0, 0));
    const [fImg, sImg, dImg] = imgs.slice(sheets.length);
    const paint = (cells: [number, number][], src: Ui2dSheet | undefined, img: CanvasImageSource | null | undefined) => {
      if (!src || !img) return;
      const c = src.cells[0]!;
      for (const [i, tile] of cells) g.drawImage(img, c.x + ((tile * a.cell) % c.w), c.y, a.cell, a.cell, a.origin[0] + (i % a.columns) * a.cell, a.origin[1] + Math.floor(i / a.columns) * a.cell, a.cell, a.cell);
    };
    paint(a.specialCells, special, sImg);
    paint(a.cells, fields, fImg);
    // Dungeon markers (dungeon_highlight: 0/1 Mt. Coronet, 2 a dungeon, 3 a special one).
    if (dungeon && dImg) for (const m of a.dungeons) drawCell(g, dImg, dungeon, animCell(dungeon, (m.coronet ? 0 : 2) + (m.special ? 1 : 0)), m.x, m.y);
  });
  // The plate at the top left holds the species' name (area_map's own plate).
  const out: HTMLElement[] = [node, textAt(d, v.name, 4, 30, 80, 20, 'center', 'dex-area-name')];
  if (a.unknown) out.push(at(el('div', 'dex-unknown', d.text(a.unknown)), AREA_VIEW[0] + 20, AREA_VIEW[1] + 52, AREA_VIEW[2] - 40, 24));
  const times = at(el('div', 'dex-times'), ...AREA_TIMES);
  times.setAttribute('role', 'radiogroup');
  a.times.forEach((t, i) => {
    const b = button(d, `time:${i}`, `dex-time${i === a.time ? ' on' : ''}`, [cellCanvas(d, 'pokedex/time_day_icons', (s) => animCell(s, i), Math.max(1, Math.round((dpr() * d.unit) / 2))), d.text(t, i === a.time ? 'chosen' : 'ink')]);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === a.time));
    b.tabIndex = i === a.time ? 0 : -1;
    times.append(b);
  });
  out.push(times);
  return out;
}

function sizePage(d: DrawContext, v: PokedexEntryView): HTMLElement[] {
  const s = v.size!;
  const { g, node } = screenCanvas(d, SIZE_VIEW);
  const bg = sheetOf(d, 'pokedex/height_check');
  const icons = sheetOf(d, 'pokedex/size_check_icons');
  const pic = frontPicture(d, v.species, v.form, v.female);
  void Promise.all([bg ? d.art.image(bg.atlas) : null, icons ? d.art.image(icons.atlas) : null, pic]).then(([bgImg, iconImg, mon]) => {
    if (bg && bgImg) drawCell(g, bgImg, bg, 0, 0, 0);
    // Decomp pokedex_height_check.c: the trainer at (168, 88 + y), the Pokémon centred at (88, 88 + y), both scaled by 256 / scale and black.
    if (icons && iconImg) {
      const t = document.createElement('canvas');
      const cell = icons.cells[animCell(icons, s.trainer.gender === 'male' ? 5 : 6)]!;
      t.width = cell.w;
      t.height = cell.h;
      t.getContext('2d')!.drawImage(iconImg, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
      const k = 256 / s.trainer.scale;
      g.drawImage(silhouette(t), Math.round(168 - cell.ox * k), Math.round(88 + s.trainer.y - cell.oy * k), Math.round(cell.w * k), Math.round(cell.h * k));
    }
    if (mon) {
      const k = 256 / s.pokemon.scale;
      g.drawImage(silhouette(mon), Math.round(88 - 40 * k), Math.round(88 + s.pokemon.y - 40 * k), Math.round(80 * k), Math.round(80 * k));
    }
  });
  const who = (w: { name: string; height: string }, rect: readonly [number, number, number, number]) => at(el('div', 'dex-size-who', d.text(w.name), d.text(w.height)), ...rect);
  return [textAt(d, s.title, 0, 22, 256, 16, 'center', 'dex-size-title'), node, who(s.pokemon, SIZE_LEGEND[0]), who(s.trainer, SIZE_LEGEND[1])];
}

/** The forms page: the selected form in the species window, the forms as a list beside it (Unown has 28), the prompt in the entry window. */
function formsPage(d: DrawContext, v: PokedexEntryView): HTMLElement[] {
  const f = v.forms!;
  const list = at(el('div', 'dex-forms'), 104, 24, 144, 96);
  list.dataset.scrolls = '';
  f.list.forEach((o, i) => list.append(stop(d, `form:${i}`, [d.text(o.label)], 'dex-form', i === f.cursor)));
  const sel = f.list[f.cursor];
  return [pictureAt(d, v, sel?.form ?? v.form, sel?.female ?? v.female), list, textAt(d, f.prompt, ...INFO.entry, 'left', 'dex-prompt')];
}

/** The cry page (ov21_021E3FFC.c): the picture at (48, 64), the waveform and level meter (dex-cry.ts) over cry_button. */
const CRY_PICTURE = [48, 64] as const;

function cryPage(d: DrawContext, v: PokedexEntryView): HTMLElement[] {
  const pic = at(el('div', 'dex-pic', frontCanvas(d, v.species, v.form, v.female, kOf(d))), CRY_PICTURE[0] - 40, CRY_PICTURE[1] - 40, 80, 80);
  // Outside a game (no sound) or without the ROM's art, the page has the picture only.
  return d.sound && d.art.sheet('pokedex/cry_screen') ? [pic, new CryPage(d, v.species).el] : [pic];
}

/** Each page's screen: info on info_main with its windows composed in, forms and cry on info_main, area and size on their own (the banner over them). */
const PAGE_ART: Record<PokedexPageId, string> = { info: 'pokedex/entry_screen', cry: 'pokedex/cry_screen', forms: 'pokedex/info_background', area: 'pokedex/area_map', size: 'pokedex/height_check' };

function drawEntry(wide: DrawContext, v: PokedexEntryView): HTMLElement {
  const d = boardContext(wide);
  const root = dexBoard(d, `dex-entry-sheet page-${v.page}`, PAGE_ART[v.page]);
  if (v.page !== 'info') {
    const banner = bgPicture(d, 'pokedex/banner', 0, 0, 'dex-banner');
    if (banner) root.append(banner);
  }
  root.append(...(v.page === 'area' ? areaPage(d, v) : v.page === 'size' ? sizePage(d, v) : v.page === 'forms' ? formsPage(d, v) : v.page === 'cry' ? cryPage(d, v) : infoPage(d, v)));
  const tabs = at(el('div', 'dex-tabs'), ...BANNER.tabs);
  tabs.setAttribute('role', 'tablist');
  for (const [i, p] of v.pages.entries()) {
    const b = button(d, `page:${i}`, `dex-tab${p.id === v.page ? ' on' : ''}`, [d.text(p.label, p.id === v.page ? 'chosen' : p.enabled ? 'ink' : 'muted')]);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(p.id === v.page));
    b.tabIndex = p.id === v.page ? 0 : -1;
    b.disabled = !p.enabled;
    tabs.append(b);
  }
  root.append(at(button(d, 'back', 'dex-back', [], 'Back to the list'), ...BANNER.back), tabs);
  if (v.caught) root.append(at(ballMark(d), BANNER.ball[0] - 4, BANNER.ball[1] - 4, 8, 8));
  root.append(at(button(d, 'prev', 'dex-step prev', [], 'Previous'), ...BANNER.prev), at(button(d, 'next', 'dex-step next', [], 'Next'), ...BANNER.next));
  root.setAttribute('aria-label', `${v.number} ${v.name}`);
  return root;
}

// --- The search ----------------------------------------------------------------------------------

/** One row per filter (the DS's touch-screen grid): its label at x 8, ◀ value ▶ from x 88; OK; the message box at the bottom. */
const SEARCH = { y: 12, row: 22, ok: [184, 124, 64, 18], message: [0, 144, 256, 48] } as const;

function drawSearch(wide: DrawContext, v: PokedexSearchView): HTMLElement {
  const d = boardContext(wide);
  const root = dexBoard(d, 'dex-search-sheet', 'pokedex/search_screen');
  const rows = at(el('div', 'dex-search'), 0, SEARCH.y, 256, SEARCH.row * v.rows.length);
  v.rows.forEach((r, i) => {
    const n = r.options.length;
    const k = r.value;
    const type = (r.id === 'type1' || r.id === 'type2') && k > 0 ? v.types[k] : null;
    const content = type ? [typeIcons(d, [type])] : r.id === 'shape' && k > 0 ? [cellCanvas(d, 'pokedex/shapes', (s) => s.names!.indexOf(`shape_${v.shapes[k]}`), kOf(d))] : [d.text(r.options[k]!, 'light')];
    const arrow = (dir: -1 | 1) => button(d, `${r.id}:${(k + dir + n) % n}`, `dex-chip-step ${dir < 0 ? 'prev' : 'next'}`, [], dir < 0 ? 'Previous option' : 'Next option');
    const chip = button(d, `${r.id}:${k}`, `dex-chip on${type ? ' type' : ''}`, content, r.id === 'shape' && k > 0 ? `Body shape ${v.shapes[k]! + 1}` : undefined);
    chip.setAttribute('aria-pressed', 'true');
    const row = el('div', `dex-search-row${i === v.cursor ? ' is-cursor' : ''}`, el('span', 'dex-search-label', d.text(r.label, 'light')), el('div', 'dex-chips stepper', arrow(-1), chip, arrow(1)));
    row.dataset.row = r.id;
    rows.append(row);
  });
  root.append(rows, at(stop(d, 'ok', [d.text(v.ok)], 'dex-ok', v.cursor === v.rows.length), ...SEARCH.ok), at(messageBox(d, v.message ?? v.description, false), ...SEARCH.message));
  root.setAttribute('aria-label', v.title);
  return root;
}

export function drawPokedex(d: DrawContext, v: PokedexView): HTMLElement {
  if (v.screen === 'list') return drawList(d, v);
  return v.screen === 'entry' ? drawEntry(d, v) : drawSearch(d, v);
}
