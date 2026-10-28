/**
 * The Poffin screens (contracts `PoffinCookingView`, `PoffinCaseView`, `PoffinFeedView`; packages/menus owns their
 * state and timing):
 * - the cooking: one 256×192 DS screen on a canvas (the touch screen's pot, laid out as the other DS scenes): the
 *   tablecloth, the phase's flames, the batters turned and scaled about the pot's centre, the rim; the berry, the
 *   cues, the arrows, the steam; the banner, the top screen's message as a message box, RESULTS in the DS windows. The
 *   stylus is the pointer on the pot (`spoon:<x>,<y>` while it is down, `spoon-up`);
 * - the Poffin Case: the list screen and the flavour buttons' touch screen as a DS pair (board.ts `dsPair`);
 * - the feeding: the Pokémon and the Poffin on the cutscene's screen.
 * Packs without the art (the fixture) get plain shapes in the same places.
 */
import { dexOf, type PoffinCaseView, type PoffinCookingView, type PoffinFeedView, type Ui2dSheet } from '@opensinnoh/contracts';
import { ENGLISH, forLanguage, GERMAN, type Id } from '@opensinnoh/core';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { at, atTiles, board, boardContext, DS_HEIGHT, DS_WIDTH, dsPair } from './board.ts';
import { el } from './core.ts';
import { layoutScene, MESSAGE, place, sceneContext } from './evolution.ts';
import { animCell, bgPicture, sprite, tapButton } from './sprites.ts';
import './evolution.css';
import './poffin.css';

type Img = HTMLImageElement;
const W = DS_WIDTH;
const H = DS_HEIGHT;
/** The pot's centre and the batters' 128-px textures at (64, 32) (ov83_0223E368). */
const POT = { x: 128, y: 96, batter: 128 };
/** The banner's window (E77C: tiles 8, 11, 16 × 4) and RESULTS' (2, 1, 28 × 15 and 2, 18, 28 × 5), the message's (2, 2, 27 × 5), YES/NO (24, 8). */
const BANNER = { x: 64, y: 88, w: 128, h: 32 };
const RESULTS = { x: 16, y: 8, w: 224, h: 120 };
const MADE = { x: 16, y: 144, w: 224, h: 40 };
/** A window's frame is drawn in the tile around its text area (the DS's window frame tiles). */
const outside = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 });
const RESULT_MESSAGE = { x: 16, y: 16, w: 216, h: 40 };
const YES_NO = { x: 184, y: 64, w: 64, h: 48 };
/** EA6C: the rows' places in RESULTS (x 0 and 160; y 24, 48, 68). */
const ROWS_Y = [24, 48, 68];

/** A frame of a sheet's animation `anim` at `frame` frames in (looping ones wrap; forward ones hold their last). */
function animFrame(sheet: Ui2dSheet | undefined, anim: number, frame: number): number | null {
  const a = sheet?.animations?.[anim];
  if (!a?.frames.length) return null;
  const total = a.frames.reduce((n, f) => n + f.ticks, 0);
  let t = a.mode === 'forward' ? Math.min(frame, total - 1) : frame % total;
  for (const f of a.frames) {
    if (t < f.ticks) return f.cell;
    t -= f.ticks;
  }
  return a.frames.at(-1)!.cell;
}

class CookingScene {
  readonly root = el('section', 'ds-scene poffin-cooking-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private overlayKey = '';
  private last: { d: DrawContext; v: PoffinCookingView } | null = null;
  private pointer: number | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', 'Poffin cooking: stir the pot');
    // The stylus: down or moving on the pot sends its DS point, up lifts it (decomp gSystem.touchHeld).
    const point = (e: PointerEvent) => {
      const r = this.stage.getBoundingClientRect();
      return `spoon:${Math.floor(((e.clientX - r.left) / r.width) * W)},${Math.floor(((e.clientY - r.top) / r.height) * H)}`;
    };
    this.stage.addEventListener('pointerdown', (e) => {
      if (!this.last || (e.target as HTMLElement).closest('button, .msg-box')) return;
      e.preventDefault();
      this.stage.setPointerCapture(e.pointerId);
      this.pointer = e.pointerId;
      this.last.d.tap(point(e));
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointer && this.last) this.last.d.tap(point(e));
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer || !this.last) return;
      this.pointer = null;
      this.last.d.tap('spoon-up');
    };
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', up);
  }

  private image(ref: Id): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.draw(this.last.d, this.last.v);
    });
    return null;
  }

  /** A one-cell sheet's picture with its top-left at (x, y), scaled about (cx, cy), turned by `turn` (0–1), at `alpha`. */
  private picture(path: string, x: number, y: number, o: { scale?: number; turn?: number; alpha?: number } = {}): boolean {
    const sheet = this.art.sheet(path);
    const img = sheet ? this.image(sheet.atlas) : null;
    const c = sheet?.cells[0];
    if (!img || !c) return !!sheet;
    const g = this.g;
    g.save();
    g.globalAlpha = o.alpha ?? 1;
    g.translate(POT.x, POT.y);
    if (o.turn) g.rotate(o.turn * Math.PI * 2);
    if (o.scale !== undefined) g.scale(o.scale, o.scale);
    g.drawImage(img, c.x, c.y, c.w, c.h, x - POT.x, y - POT.y, c.w, c.h);
    g.restore();
    return true;
  }

  /** Cell `cell` of a sheet with its origin at (x, y), scaled about it. */
  private cell(path: string, cell: number | null, x: number, y: number, scale = 1): void {
    const sheet = this.art.sheet(path);
    const c = cell === null ? undefined : sheet?.cells[cell];
    const img = sheet && c ? this.image(sheet.atlas) : null;
    if (!img || !c) return;
    const g = this.g;
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.scale(scale, scale);
    g.drawImage(img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
    g.restore();
  }

  private anim(path: string, anim: number, frame: number, x: number, y: number, scale = 1): void {
    this.cell(path, animFrame(this.art.sheet(path), anim, frame), x, y, scale);
  }

  draw(ctx: DrawContext, v: PoffinCookingView): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.fillStyle = '#f8f0b8';
    g.fillRect(0, 0, W, H);
    const rom = this.picture('poffin_cooking/tablecloth', 0, 0);
    this.root.classList.toggle('rom', rom);
    const pot = v.pot;
    if (pot) {
      // The software sprites by priority (ov83_0223E368): the flames, the batters (the phase's over the next, fading), the rim.
      if (pot.flames) this.picture(`poffin_cooking/flames${pot.phase}`, 0, 0, { scale: pot.pulse / 4096 });
      const turn = pot.angle / 0x10000;
      const scale = pot.scale / 4096;
      const bx = POT.x - POT.batter / 2;
      const by = POT.y - POT.batter / 2;
      if (pot.phase < 2) this.picture(`poffin_cooking/batter${pot.phase + 1}`, bx, by, { turn, scale });
      this.picture(`poffin_cooking/batter${pot.phase}`, bx, by, { turn, scale, alpha: pot.phase < 2 ? pot.fade / 31 : 1 });
      if (!this.picture('poffin_cooking/pot', 0, 0)) {
        g.strokeStyle = '#e08830';
        g.lineWidth = 10;
        g.beginPath();
        g.arc(POT.x, POT.y, 86, 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (const e of v.effects) this.anim(`poffin_cooking/puff${e.set}`, e.anim, e.frame, e.x, e.y, e.scale / 4096);
    const berries = this.art.sheet('poffin_cooking/berries');
    for (const b of v.berries) {
      const n = (d.registries.items.get(b.item)?.sourceIndex ?? 149) - 149;
      this.cell('poffin_cooking/berries', berries?.names?.indexOf(String(n)) ?? null, b.x, b.y);
    }
    for (const s of v.splashes) this.anim('poffin_cooking/interface', 1, s.frame, s.x, s.y);
    if (v.cue?.kind === 'pour') this.anim('poffin_cooking/interface', 2, v.cue.frame, 168, 60);
    if (v.cue?.kind === 'start') this.anim('poffin_cooking/interface', 0, v.cue.frame, POT.x, POT.y);
    if (v.cue?.kind === 'done') this.anim('poffin_cooking/done', 0, v.cue.frame, POT.x, POT.y);
    for (const a of v.arrows) this.anim('poffin_cooking/arrow', a < 2 ? 0 : 1, v.tick, POT.x, POT.y);
    if (v.spoon) this.anim('poffin_cooking/sparkles', 4, v.tick, v.spoon.x, v.spoon.y);
    if (v.banner) this.picture('poffin_cooking/textbox', 0, 0);
    if (v.results && v.results.poffin >= 0) {
      const sheet = this.art.sheet('poffin/poffins');
      this.cell('poffin/poffins', sheet?.names?.indexOf(String(v.results.poffin)) ?? null, 128, 144);
    }
    if (v.fade) {
      g.globalAlpha = v.fade / 16;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    this.drawBoxes(d, v);
  }

  private drawBoxes(d: DrawContext, v: PoffinCookingView): void {
    const key = JSON.stringify([v.banner, v.top, v.results, v.message, v.yesNo, d.frame, d.scale]);
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const parts: HTMLElement[] = [];
    const text = (s: string, r: { x: number; y: number; w: number; h: number }, className: string) => {
      const e = el('div', `poffin-text ${className}`, d.text(s, 'ink'));
      place(e, r);
      parts.push(e);
    };
    if (v.banner) text(v.banner, BANNER, 'poffin-banner');
    if (v.results) {
      const r = v.results;
      const win = framed(d, 'poffin-results');
      place(win, outside(RESULTS));
      parts.push(win);
      text(r.title, { x: RESULTS.x, y: RESULTS.y, w: RESULTS.w, h: 16 }, 'center');
      r.rows.forEach((row, i) => {
        text(row.label, { x: RESULTS.x, y: RESULTS.y + ROWS_Y[i]!, w: 160, h: 16 }, '');
        text(row.value, { x: RESULTS.x + 160, y: RESULTS.y + ROWS_Y[i]!, w: 64, h: 16 }, '');
      });
      const made = framed(d, 'poffin-made');
      place(made, outside(MADE));
      parts.push(made);
      text(r.made.label, { x: MADE.x, y: MADE.y, w: MADE.w, h: 16 }, '');
      if (r.made.value) text(r.made.value, { x: MADE.x + 16, y: MADE.y + 24, w: MADE.w - 16, h: 16 }, '');
    }
    const message = v.top !== null ? { text: v.top, waiting: false } : v.message;
    if (message) {
      const box = messageBox(d, message.text, message.waiting);
      box.classList.add('ds-scene-message');
      place(box, v.top !== null ? MESSAGE : RESULT_MESSAGE);
      parts.push(box);
    }
    if (v.yesNo) {
      const yn = framed(d, 'yes-no ds-scene-yes-no', stop(d, 'yes', [d.text(v.yesNo.yes)], 'choice', v.yesNo.cursor === 0), stop(d, 'no', [d.text(v.yesNo.no)], 'choice', v.yesNo.cursor === 1));
      place(yn, YES_NO);
      parts.push(yn);
    }
    this.boxes.replaceChildren(...parts);
  }
}

const cookingScenes = new WeakMap<Art, CookingScene>();

export function poffinCooking(d: DrawContext, v: PoffinCookingView): HTMLElement {
  let scene = cookingScenes.get(d.art);
  if (!scene || !scene.root.isConnected) cookingScenes.set(d.art, (scene = new CookingScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}

/** manager.c InitWindows (tiles), InitSprites (px): the list, SMOOTH, the message, the action menu, YES/NO, the header; the touch screen's buttons. */
const CASE = {
  list: [2, 4, 22, 12] as const,
  smooth: [11, 20, 10, 2] as const,
  message: [2, 19, 27, 4] as const,
  menu: [26, 17, 5, 6] as const,
  yesNo: [26, 13, 5, 4] as const,
  header: [0, 0, 16, 2] as const,
  filterText: [6, 0, 20, 3] as const,
  row: 16,
  selectBox: { x: 105, y: 40 },
  arrows: { x: 80, up: 18, down: 140 },
  poffin: { x: 231, y: 76 },
  flavors: [[40, 156], [54, 165], [49, 180], [31, 180], [26, 165]] as const,
  buttons: [[128, 48], [192, 96], [168, 162], [88, 164], [64, 96], [128, 116]] as const,
};

/** A list row's level before its number, per game language (English as before; German as the German ROM's PoffinCase_Text_ListItem). */
const POFFIN_LEVEL: Readonly<Record<number, string>> = { [ENGLISH]: 'Lv. ', [GERMAN]: 'Lv.' };

/** The Poffin Case: the list (top screen) and the flavour buttons (touch screen) as a DS pair. */
export function poffinCase(wide: DrawContext, v: PoffinCaseView): HTMLElement {
  const d = boardContext(wide);
  const levelLabel = forLanguage(dexOf(d.registries).language, POFFIN_LEVEL);
  const top = board('poffin-case-main');
  const bg = bgPicture(d, 'poffin_case/main', 0, 0);
  top.append(bg ?? at(el('span', 'poffin-css-screen'), 0, 0, W, H));
  top.append(atTiles(el('span', 'poffin-case-text', d.text(v.title, 'light')), ...CASE.header));
  const shown = [...v.rows.map((r, i) => ({ ...r, i })), { name: v.close, level: '', type: -1, i: v.rows.length }].slice(v.top, v.top + v.visible);
  const list = atTiles(el('div', 'poffin-case-list'), ...CASE.list);
  shown.forEach((r, k) => {
    const row = stop(d, r.type < 0 ? 'close' : `row:${r.i}`, [el('span', 'poffin-row-name', d.text(r.name, 'ink')), ...(r.level ? [el('span', 'poffin-row-level', d.text(`${levelLabel}${r.level}`, 'ink'))] : [])], 'poffin-row', v.cursor === r.i);
    at(row, 8, k * CASE.row, CASE.list[2] * 8 - 8, CASE.row);
    list.append(row);
  });
  top.append(list);
  const box = sprite(d, 'poffin_case/main_sprites', 0, CASE.selectBox.x, CASE.selectBox.y + (v.cursor - v.top) * CASE.row, `poffin-select${v.menu ? ' held' : ''}`);
  if (box) top.append(box);
  if (v.top > 0) top.append(at(tapButton(d, 'up', 'poffin-scroll up', [sprite(d, 'poffin_case/main_sprites', 1, 8, 8) ?? el('span')], 'Scroll up'), CASE.arrows.x - 8, CASE.arrows.up - 8, 16, 16));
  if (v.top + v.visible < v.rows.length + 1) top.append(at(tapButton(d, 'down', 'poffin-scroll down', [sprite(d, 'poffin_case/main_sprites', 2, 8, 8) ?? el('span')], 'Scroll down'), CASE.arrows.x - 8, CASE.arrows.down - 8, 16, 16));
  if (v.selected) {
    const s = v.selected;
    const pic = sprite(d, 'poffin/poffins', String(s.type), CASE.poffin.x, CASE.poffin.y, 'poffin-picture');
    if (pic) top.append(pic);
    s.flavors.forEach((on, i) => {
      const dot = on ? sprite(d, 'poffin_case/main_sprites', 3 + i, CASE.flavors[i]![0], CASE.flavors[i]![1]) : null;
      if (dot) top.append(dot);
    });
    top.append(atTiles(el('span', 'poffin-case-text', d.text(s.smooth, 'ink')), ...CASE.smooth));
  }
  if (v.menu) {
    const m = framed(d, 'poffin-case-menu', ...v.menu.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', v.menu!.cursor === i)));
    top.append(atTiles(m, ...CASE.menu));
  }
  if (v.yesNo) top.append(atTiles(framed(d, 'yes-no', stop(d, 'yes', [d.text(v.yesNo.yes)], 'menu-entry', v.yesNo.cursor === 0), stop(d, 'no', [d.text(v.yesNo.no)], 'menu-entry', v.yesNo.cursor === 1)), ...CASE.yesNo));
  if (v.message) top.append(atTiles(messageBox(d, v.message.text, v.message.waiting), ...CASE.message));

  const touch = board('poffin-case-touch');
  touch.append(bgPicture(d, 'poffin_case/sub', 0, 0) ?? at(el('span', 'poffin-css-screen sub'), 0, 0, W, H));
  if (v.filterText) touch.append(atTiles(el('span', 'poffin-case-text center', d.text(v.filterText, 'ink')), ...CASE.filterText));
  v.filters.forEach((label, i) => {
    const [x, y] = CASE.buttons[i]!;
    // Each button's animations (PoffinManager_UpdateFilterButton: i·3 idle, i·3 + 1 the chosen one); its label over it.
    const cell = animCell(d, 'poffin_case/sub_sprites', i * 3 + (v.filter === i ? 1 : 0));
    const art = cell === null ? null : sprite(d, 'poffin_case/sub_sprites', cell, 32, 16);
    const b = tapButton(d, `filter:${i}`, `poffin-filter${v.filter === i ? ' on' : ''}${art ? ' rom' : ''}`, [...(art ? [art] : []), el('span', 'poffin-filter-label', d.text(label, 'ink'))], label);
    touch.append(at(b, x - 32, y - 16, 64, 32));
  });
  const pair = dsPair(wide, 'poffin-case', top, touch);
  // The ROM's boards fill the room around the pair, as the trainer card's.
  if (d.art.sheet('poffin_case/main')) Object.assign(pair.dataset, { backdrop: 'poffin_case/main', backdropBottom: 'poffin_case/sub' });
  return pair;
}

class FeedScene {
  readonly root = el('section', 'ds-scene poffin-feed-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private last: { d: DrawContext; v: PoffinFeedView } | null = null;
  private key = '';

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', 'Feeding a Poffin');
  }

  private image(ref: Id): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.draw(this.last.d, this.last.v);
    });
    return null;
  }

  draw(ctx: DrawContext, v: PoffinFeedView): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#f8d8a0';
    g.fillRect(0, 0, W, H);
    const bg = this.art.sheet('poffin_feed/top');
    const bgImg = bg ? this.image(bg.atlas) : null;
    if (bg && bgImg) g.drawImage(bgImg, bg.cells[0]!.x, bg.cells[0]!.y, W, H, 0, 0, W, H);
    // The Pokémon's front picture (80 px frames), centred at (x, y) and scaled.
    const pics = d.registries.pokemonSprites.get(v.mon.species);
    const form = pics?.forms[v.mon.form] ?? pics?.forms[0];
    const img = form ? this.image(v.mon.shiny ? form.shinyAtlas : form.atlas) : null;
    if (form && img) {
      const face = (v.mon.female && form.frontFemale) || form.front;
      const size = (80 * v.mon.scale) / 4096;
      g.drawImage(img, 0, face.y, 80, 80, Math.round(v.mon.x - size / 2), Math.round(v.mon.y - size / 2), Math.round(size), Math.round(size));
    }
    if (v.poffin) {
      const sheet = this.art.sheet('poffin/poffins');
      const c = sheet?.cells[sheet.names!.indexOf(String(v.poffin.type))];
      const pimg = sheet ? this.image(sheet.atlas) : null;
      if (c && pimg) {
        const k = v.poffin.scale / 4096;
        g.drawImage(pimg, c.x, c.y, c.w, c.h, Math.round(v.poffin.x - c.ox * k), Math.round(v.poffin.y - c.oy * k), Math.round(c.w * k), Math.round(c.h * k));
      }
    }
    const key = JSON.stringify([v.message, d.frame, d.scale]);
    if (key !== this.key) {
      this.key = key;
      const parts: HTMLElement[] = [];
      if (v.message) {
        const box = messageBox(d, v.message.text, v.message.waiting);
        box.classList.add('ds-scene-message');
        place(box, MESSAGE);
        parts.push(box);
      }
      this.boxes.replaceChildren(...parts);
    }
  }
}

const feedScenes = new WeakMap<Art, FeedScene>();

export function poffinFeed(d: DrawContext, v: PoffinFeedView): HTMLElement {
  let scene = feedScenes.get(d.art);
  if (!scene || !scene.root.isConnected) feedScenes.set(d.art, (scene = new FeedScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
