/**
 * The PC boxes on the DS screens (decomp applications/pc_boxes, ov19_*): one 256 × 192 board at the UI unit
 * for the top screen (the preview panel, the box's wallpaper with its name and arrows, the box's Pokémon,
 * the hand cursor, the party tray, the PARTY POKéMON / CLOSE buttons), and in compare mode a second board
 * for the touch screen's compare page, beside or above the whole top screen (whichever is larger in the view). The menu,
 * markings, YES/NO and message windows sit at their DS windows. Without the sheets (the fixture) our own
 * CSS stands in for the ROM pictures at the same places.
 */
import type { BoxMonView, StorageCompare, StorageView } from '@opensinnoh/contracts';
import type { Palette } from './pixel-font.ts';
import { ICON_ANIM } from './art.ts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { at, atTiles, board, boardContext, DS_HEIGHT, DS_WIDTH, dsPair } from './board.ts';
import { el } from './core.ts';
import { animCell, bgPicture, sprite, tapButton } from './sprites.ts';
import './storage.css';
import { S } from '../strings/index.ts';

/** Compare mode moves the box 44 px left (ov19_021D7820). */
const COMPARE_SHIFT = -44;
/** The wallpaper's place (ov19_021D8764: tile column 11). */
const WALLPAPER_X = 88;
/** The box's Pokémon: icon centres at (112 + 24 col, 40 + 24 row) (ov19_021D803C). */
const SLOT = { x: 112, y: 40, step: 24, columns: 6 };
/**
 * The header: the name centred on the wallpaper's plate at x + 84, y 13 (ov19_021D7C58); the arrows at 108 and 236, y 20
 * (ov19_021D8C1C), tapped over 24 px around them (the plate between).
 */
const HEADER = { nameX: 84, nameY: 13, arrows: [108, 236], arrowY: 20 };
/** The party tray (ov19_021DCD64: tile column 14, 9 in compare mode) and its icon centres (Unk_ov19_021E0234). */
const TRAY_X = [112, 72];
/** The tray's EXIT (its art, in tray px). */
const TRAY_EXIT = { x: 56, y: 168, w: 38, h: 20 };
const PARTY = [[144, 28], [192, 36], [144, 68], [192, 76], [144, 108], [192, 116]] as const;
/** PARTY POKéMON / CLOSE (ov19_021DA864) at (183, 176). */
const BUTTONS = { x: 183, y: 176 };
/** The preview (ov19_021DA92C): the front sprite's centre, the windows' text, the marks' tile row. */
const PREVIEW = { front: [44, 84], species: [2, 8], name: [2, 128], gender: [70, 128], level: [2, 144], info: [8, 168], marks: [32, 152] } as const;
/** box/cursor animations (ov19_021D8C1C): open hand, grabbing hand, shadow, the header arrows (selected: + 2). */
const CURSOR = { open: 0, grab: 2, shadow: 5, arrows: [6, 7], selected: 2 };
/** The box marks' names (chrome, for assistive technology), in bit order. */
const MARK_NAMES = ['circle', 'triangle', 'square', 'heart', 'star', 'diamond'];
const markCell = (markings: number, i: number) => ((markings >> i) & 1 ? i : 6 + i);

function boxMon(d: DrawContext, m: BoxMonView): HTMLElement {
  const icon = d.art.pokemonIcon(m.species, m.form, ICON_ANIM.hpMax, m.egg);
  if (m.heldItem) icon.append(el('span', 'held-item'));
  return icon;
}

/** Where the hand points (ov19_021D9D48): over the slot, party slot or header. */
function handAt(v: StorageView, shift: number): [number, number] {
  if (v.area === 'header') return [168 + shift, 8];
  if (v.area === 'party') {
    const [x, y] = PARTY[v.cursor]!;
    return [x + (shift ? -40 : 0), y - 16];
  }
  return [SLOT.x + shift + (v.cursor % SLOT.columns) * SLOT.step, SLOT.y + Math.floor(v.cursor / SLOT.columns) * SLOT.step - 16];
}

export function storage(wide: DrawContext, v: StorageView): HTMLElement {
  const d = boardContext(wide);
  const top = boxBoard(d, v);
  if (!v.compare) {
    top.classList.add('ds-screen');
    if (d.art.sheet('box/screen')) top.dataset.backdrop = 'box/screen';
    return top;
  }
  // Compare: the touch screen's page and the whole top screen (never cropped through its art), side by side or
  // stacked, whichever is larger in the view.
  const pair = dsPair(d, 'storage-compare', compareBoard(d, v.compare), top);
  if (d.art.sheet(`box/compare_${v.compare.page}`)) Object.assign(pair.dataset, { backdrop: `box/compare_${v.compare.page}`, backdropBottom: 'box/screen' });
  return pair;
}

function boxBoard(d: DrawContext, v: StorageView): HTMLElement {
  const shift = v.compare ? COMPARE_SHIFT : 0;
  const root = board(`box-board storage-${v.mode}`);
  const screen = v.compare ? sprite(d, 'box/compare_sides', v.compare.live, 0, 0) : bgPicture(d, 'box/screen', 0, 0);
  root.classList.toggle('rom', !!screen);
  root.append(screen ?? at(el('span', `box-css-screen${v.compare ? ' compare' : ''}`), 0, 0, DS_WIDTH, DS_HEIGHT));

  // The wallpaper with the box's name on its plate (the name in the wallpaper's own colours).
  const wallpaperPath = `box/wallpaper_${String(v.box.wallpaper).padStart(2, '0')}`;
  const wx = WALLPAPER_X + shift;
  root.append(bgPicture(d, wallpaperPath, wx, 0, 'box-wallpaper') ?? at(el('span', `box-wallpaper css-wallpaper w${v.box.wallpaper % 4}`), wx, 0, 168, 160));
  const colors = d.art.sheet(wallpaperPath)?.textColors?.[0];
  const ink: Palette = colors ? [colors.fg, colors.shadow] : 'ink';
  root.append(at(el('div', 'box-title', d.text(v.box.name, ink)), wx, HEADER.nameY, 168, 16));
  const header = stop(d, 'header', [el('span', 'sr-only', `${v.box.name} ${v.box.count}`)], 'box-name', v.area === 'header');
  root.append(at(header, wx + 32, 4, 104, 28));
  HEADER.arrows.forEach((x, i) => {
    const cell = animCell(d, 'box/cursor', CURSOR.arrows[i]! + (v.area === 'header' ? CURSOR.selected : 0));
    const art = cell === null ? null : sprite(d, 'box/cursor', cell, x + shift, HEADER.arrowY);
    if (art) root.append(art);
    root.append(at(tapButton(d, i ? 'box:1' : 'box:-1', `box-arrow ${i ? 'next' : 'prev'}${art ? ' rom' : ''}`, [], i ? 'Next box' : 'Previous box'), x + shift - 12, HEADER.arrowY - 12, 24, 24));
  });

  // The hand's shadow while it is over the box: drawn behind the box's Pokémon (ov19_021D8B54: sprite priority 42,
  // after the icons' 0–29).
  const [hx, hy] = handAt(v, shift);
  const shadowCell = animCell(d, 'box/cursor', CURSOR.shadow);
  if (v.area === 'box' && shadowCell !== null) root.append(sprite(d, 'box/cursor', shadowCell, hx, hy + 24, 'box-shadow')!);

  // The box's Pokémon.
  v.slots.forEach((m, i) => {
    const x = SLOT.x + shift + (i % SLOT.columns) * SLOT.step;
    const y = SLOT.y + Math.floor(i / SLOT.columns) * SLOT.step;
    const s = stop(d, `slot:${i}`, m ? [boxMon(d, m)] : [], `box-slot${m ? ' filled' : ''}`, v.area === 'box' && v.cursor === i);
    if (m) s.dataset.species = m.species;
    root.append(at(s, x - 12, y - 12, 24, 24));
  });

  // The party tray, while the cursor is on it (or depositing: only the party is in play). It covers PARTY
  // POKéMON / CLOSE and has its own EXIT, which closes as CLOSE does.
  const tray = v.partyOpen && (v.area === 'party' || v.mode === 'deposit');
  if (tray) {
    const tx = TRAY_X[v.compare ? 1 : 0]!;
    root.append(bgPicture(d, 'box/tray', tx, 0, 'box-tray') ?? at(el('span', 'box-tray css'), tx, 0, 120, 192));
    v.party.forEach((m, i) => {
      const [x, y] = PARTY[i]!;
      const s = stop(d, `party:${i}`, m ? [boxMon(d, m)] : [], `box-slot party${m ? ' filled' : ''}`, v.area === 'party' && v.cursor === i);
      if (m) s.dataset.species = m.species;
      root.append(at(s, x + (v.compare ? -40 : 0) - 16, y - 16, 32, 32));
    });
    const art = !!d.art.sheet('box/tray');
    root.append(at(tapButton(d, 'close', `box-close${art ? ' rom' : ' pill'}`, art ? [el('span', 'sr-only', v.close)] : [d.text(v.close)], v.close), tx + TRAY_EXIT.x, TRAY_EXIT.y, TRAY_EXIT.w, TRAY_EXIT.h));
  } else {
    // PARTY POKéMON / CLOSE: the ROM buttons, CLOSE taps.
    const buttons = sprite(d, 'box/buttons', 0, BUTTONS.x + shift, BUTTONS.y);
    if (buttons) root.append(buttons);
    const close = tapButton(d, 'close', `box-close${buttons ? ' rom' : ' pill'}`, buttons ? [el('span', 'sr-only', v.close)] : [d.text(v.close)], v.close);
    root.append(at(close, BUTTONS.x + shift + 13, 160, 59, 32));
  }

  if (!v.compare) root.append(...preview(d, v));

  // The hand (and what it holds), or our band on the cursor's slot without the art.
  const holding = !!(v.held || v.heldItem);
  const handCell = animCell(d, 'box/cursor', holding ? CURSOR.grab : CURSOR.open);
  if (handCell !== null) {
    root.classList.add('rom-cursor');
    if (v.held) root.append(at(el('span', 'in-hand', boxMon(d, v.held)), hx - 16, hy + 4 - 16, 32, 32));
    else if (v.heldItem) root.append(at(el('span', 'in-hand', d.art.itemIcon(v.heldItem, true)), hx - 16, hy + 4 - 16, 32, 32));
    root.append(sprite(d, 'box/cursor', handCell, hx, hy, 'box-hand')!);
  } else if (v.held) root.append(at(el('span', 'in-hand', boxMon(d, v.held)), hx - 16, hy + 4 - 16, 32, 32));

  root.append(...overlays(d, v));
  return root;
}

/** The preview panel (ov19_021DB0E4): front sprite, species, nickname and gender, level, held item, marks. */
function preview(d: DrawContext, v: StorageView): HTMLElement[] {
  const p = v.preview;
  const out: HTMLElement[] = [];
  if (!p) return out;
  const pic = d.art.pokemonFront(p.mon.species, p.mon.form, p.shiny, p.gender === 'female', d.unit, p.mon.egg) ?? boxMon(d, p.mon);
  out.push(at(el('span', 'box-preview-pic', pic), PREVIEW.front[0] - 40, PREVIEW.front[1] - 40, 80, 80));
  const text = (s: string, [x, y]: readonly [number, number], className: string, palette: Palette = 'ink') => at(el('div', className, d.text(s, palette)), x, y);
  out.push(text(p.species, PREVIEW.species, 'box-preview-species'), text(p.name, PREVIEW.name, 'box-preview-name'));
  if (p.gender !== 'none') out.push(text(p.gender === 'male' ? '♂' : '♀', PREVIEW.gender, 'box-preview-gender', p.gender));
  if (p.level) out.push(text(p.level, PREVIEW.level, 'box-preview-level'));
  if (p.fields.length) out.push(previewStrip(d, p));
  const marks = d.art.cells('box/preview_marks', MARK_NAMES.map((_, i) => markCell(p.markings, i)), d.unit);
  if (marks) {
    const row = at(el('div', 'box-marks', marks), PREVIEW.marks[0], PREVIEW.marks[1], 48, 8);
    row.setAttribute('aria-label', MARK_NAMES.filter((_, i) => (p.markings >> i) & 1).join(', ') || S.aria.noMarks);
    out.push(row);
  }
  return out;
}

/** The strip's pages (ov19_021DAE60): held item, types, nature, ability; `fields` is nature, item, ability. */
const STRIP_PAGES = [1, 'types', 0, 2] as const;
/** ov19_021DACF8, in DS frames (the game tick, 30 Hz, as contracts Ui2dFrame counts them): a page shows for 81 frames, then scrolls 4 px a frame to the next. */
const STRIP = { x: 8, y: 168, w: 96, h: 16, hold: 81, scroll: 4, frameMs: 1000 / 30 };
/** The type icons' centres in a page (sprites at x 24 + 36i, y 176). */
const STRIP_TYPES = { x: 24 - STRIP.x, dx: 36, y: 8 };

/**
 * The preview's info strip (window (1, 21), 12 × 2 tiles shown): its four pages cycle, each held, then scrolled up
 * to the next, round and round (never for an Egg, which has none). The cycle restarts when the preview is drawn
 * anew, as the DS's task restarts at the held item for a new Pokémon.
 */
function previewStrip(d: DrawContext, p: NonNullable<StorageView['preview']>): HTMLElement {
  const page = (k: (typeof STRIP_PAGES)[number]) => {
    const e = el('div', 'box-preview-page');
    if (k === 'types')
      p.types.forEach((t, i) => {
        const icon = d.art.typeIcon(t, d.unit);
        const name = d.registries.types.get(t)!.name;
        const chip = icon ? el('span', 'type-icon', icon) : el('span', `type-chip t-${t.slice(t.indexOf(':') + 1).toLowerCase()}`, d.text(name, 'light'));
        chip.title = name;
        e.append(at(chip, STRIP_TYPES.x + i * STRIP_TYPES.dx - 16, STRIP_TYPES.y - 8, 32, 16));
      });
    else e.append(el('span', 'box-preview-info', d.text(p.fields[k]!.value)));
    return e;
  };
  // The four pages and the first again, so the last scroll ends where the cycle starts.
  const pages = el('div', 'box-preview-pages', ...[...STRIP_PAGES, STRIP_PAGES[0]].map(page));
  const strip = at(el('div', 'box-preview-strip', pages), STRIP.x, STRIP.y, STRIP.w, STRIP.h);
  // Shows one page of the five at a time on purpose.
  strip.dataset.scrolls = '';
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const per = STRIP.hold + STRIP.scroll;
    const total = per * STRIP_PAGES.length;
    const keyframes: Keyframe[] = [];
    for (let i = 0; i < STRIP_PAGES.length; i++)
      for (let f = 0; f <= STRIP.scroll; f++) keyframes.push({ offset: (i * per + (f === 0 ? 0 : STRIP.hold + f - 1)) / total, transform: `translateY(${-(i * STRIP.h + f * (STRIP.h / STRIP.scroll)) * d.unit}px)`, easing: 'steps(1, end)' });
    keyframes.push({ offset: 1, transform: `translateY(${-STRIP_PAGES.length * STRIP.h * d.unit}px)` });
    pages.animate(keyframes, { duration: total * STRIP.frameMs, iterations: Infinity });
  }
  return strip;
}

/** The menu window (ov19_021DB57C): 12 tiles wide at tile x 19, its rows ending at tile row 19 (frame included here). */
function menuAt(n: number): [number, number, number, number] {
  return [18, 2 + (8 - n) * 2, 14, 2 * n + 2];
}

/** The menu, markings, YES/NO and message windows. */
function overlays(d: DrawContext, v: StorageView): HTMLElement[] {
  const out: HTMLElement[] = [];
  const place = (node: HTMLElement, [x, y, w, h]: [number, number, number, number]) => atTiles(node, x, y, w, h);
  if (v.menu) {
    const list = el('div', 'app-menu-list');
    v.menu.entries.forEach((e, i) => list.append(stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', i === v.menu!.cursor)));
    const w = place(framed(d, 'app-menu', list), menuAt(v.menu.entries.length));
    w.setAttribute('role', 'menu');
    out.push(w);
  }
  if (v.marking) {
    // BoxMenu_FillMarkingsMenu: the six marks (8 × 8 at x 44 of the window), then CONFIRM and CANCEL.
    const m = v.marking;
    const list = el('div', 'app-menu-list');
    MARK_NAMES.forEach((name, i) => {
      const canvas = d.art.cells('box/markings', [markCell(m.markings, i)], d.unit);
      const row = stop(d, `mark:${i}`, [...(canvas ? [canvas] : [el('span', `mark-css${(m.markings >> i) & 1 ? ' on' : ''}`)]), el('span', 'sr-only', name)], 'menu-entry mark-entry', m.cursor === i);
      row.setAttribute('aria-pressed', String(((m.markings >> i) & 1) === 1));
      list.append(row);
    });
    list.append(stop(d, 'mark:6', [d.text(m.confirm)], 'menu-entry', m.cursor === 6), stop(d, 'mark:7', [d.text(m.cancel)], 'menu-entry', m.cursor === 7));
    const w = place(framed(d, 'app-menu marking-menu', list), menuAt(8));
    w.setAttribute('role', 'menu');
    out.push(w);
  }
  if (v.yesNo) {
    const yn = v.yesNo;
    out.push(place(framed(d, 'yes-no', stop(d, 'yes', [d.text(yn.yes)], 'choice', yn.cursor === 0), stop(d, 'no', [d.text(yn.no)], 'choice', yn.cursor === 1)), menuAt(2)));
  }
  // ov19_021DB2FC: the message window (2, 21) 27 × 2 tiles under the menu; two lines take the frame's height above.
  if (v.message) out.push(place(messageBox(d, v.message.text, v.message.waiting), v.message.text.includes('\n') ? [0, 18, 32, 6] : [0, 20, 32, 4]));
  return out;
}

/** Contest dots (decomp ov19_021DF178): from 10 % of the way out along each axis to its corner at 255; cool, beauty, cute, smart, tough. */
const CONTEST_CENTRE = [128, 100] as const;
const CONTEST_CORNERS = [
  [128, 54],
  [172, 86],
  [155, 136],
  [100, 136],
  [84, 86],
] as const;
/** ov19_021DF5D0: SET ON LEFT / RIGHT at the bottom corners (0, 184) and (256, 184), the page button at (128, 176). */
const SET_BUTTONS = [[0, 184], [256, 184]] as const;
const PAGE_BUTTON = [128, 176] as const;

/**
 * Compare mode's touch screen (ov19_021DEC04.c): the page's ROM art, both sides' names and icons, the page's
 * rows (stats: labels in the middle, values in the blue and orange columns; moves; the contest board's
 * dots), SET ON LEFT / RIGHT (the live side's button raised) and the page button.
 */
function compareBoard(d: DrawContext, c: StorageCompare): HTMLElement {
  const root = board(`compare-touch page-${c.page}`);
  const text = (s: string) => d.text(s, 'light');
  const page = bgPicture(d, `box/compare_${c.page}`, 0, 0, 'compare-board') ?? at(el('span', 'compare-board css'), 0, 0, DS_WIDTH, DS_HEIGHT);
  page.setAttribute('aria-label', c.sides.map((s) => s?.name ?? '-').join(' / '));
  root.append(page);
  // Decomp windows 0/1 (names), 2 (labels), 3/4 (stats), 5/6 (moves), in DS px.
  const columns = [24, 160];
  c.sides.forEach((side, i) => {
    if (!side) return;
    root.append(at(el('div', 'cmp-name', text(side.name)), columns[i]!, 8, 72, 16));
    root.append(at(el('div', 'cmp-icon', d.art.pokemonIcon(side.mon.species, side.mon.form, ICON_ANIM.hpMax, side.mon.egg)), [112, 144][i]! - 16, 10 - 16, 32, 32));
    if (c.page === 'stats') side.values.forEach((v, r) => root.append(at(el('div', 'cmp-cell', text(v)), columns[i]!, 32 + 16 * r, 72, 16)));
    if (c.page === 'moves') side.values.forEach((v, r) => root.append(at(el('div', 'cmp-cell', text(v)), [8, 160][i]!, 36 + 24 * r, 88, 16)));
    if (c.page === 'contest' && side.contest)
      side.contest.forEach((value, a) => {
        const [cx, cy] = CONTEST_CENTRE;
        const [vx, vy] = CONTEST_CORNERS[a]!;
        const x0 = cx + (vx - cx) / 10;
        const y0 = cy + (vy - cy) / 10;
        const x = Math.round(x0 + ((vx - x0) * value) / 256);
        const y = Math.round(y0 + ((vy - y0) * value) / 256);
        root.append(sprite(d, 'box/compare_buttons', `dot_${i}`, x, y, `cmp-dot side-${i}`) ?? at(el('span', `cmp-dot css side-${i}`), x - 3, y - 3, 6, 6));
      });
  });
  c.labels.forEach((l, r) => root.append(at(el('div', 'cmp-cell', text(l)), 104, 32 + 16 * r, 48, 16)));
  SET_BUTTONS.forEach(([x, y], i) => {
    // ov19_021DEDDC: the live side's button plays animation 0, the other's 1 (its pressed-down cell).
    const label = c.set[i as 0 | 1];
    const art = sprite(d, 'box/compare_buttons', `${i ? 'right' : 'left'}_${c.live === i ? 0 : 2}`, x, y);
    if (art) root.append(art);
    const b = tapButton(d, `compare:${i}`, `cmp-set side-${i}${c.live === i ? ' live' : ''}${art ? ' rom' : ' pill'}`, art ? [el('span', 'sr-only', label)] : [d.text(label)], label);
    b.title = label;
    if (c.live !== i) b.setAttribute('aria-disabled', 'true');
    root.append(at(b, i ? DS_WIDTH - 56 : 0, 136, 56, 56));
  });
  const pageArt = sprite(d, 'box/compare_buttons', 'page_0', PAGE_BUTTON[0], PAGE_BUTTON[1]);
  if (pageArt) root.append(pageArt);
  root.append(at(tapButton(d, 'compare:page', `cmp-page${pageArt ? ' rom' : ' pill'}`, [], 'Next compare page'), PAGE_BUTTON[0] - 16, PAGE_BUTTON[1] - 16, 32, 32));
  return root;
}
