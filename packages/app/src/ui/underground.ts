/**
 * The Underground's screens (contracts `MiningView`, `UndergroundMenuView`, `UndergroundVendorView`; packages/menus owns
 * their state and timing):
 * - the Underground's menu and the vendors' shops: DS windows over the field at their decomp tiles (menus.c, vendors.c
 *   Window_Add), in the Underground's frame (`windows/standard_underground`);
 * - the mining game: the wall bulging prompt over the field, then one 256×192 DS screen on a canvas (mining.c): the
 *   interface with its crack, the side buttons, the buried objects (their shine's palette), the dirt, the tools'
 *   sprites and the crack's end, shaken and faded as the view says; the message box over it. The stylus is the pointer
 *   (`hit:<x>,<y>` in DS px); the keys' cursor (an addition) is a frame around its cell.
 * - 0.37.0: a trap's screen (its escape game on a canvas over the field), the secret base's prompts and its PC (the goods
 *   lists, CHECK FLAGS and the decoration's menus; the floor takes touches while a good is placed).
 * Packs without the art (the fixture) get plain shapes in the same places.
 */
import type { MiningView, Ui2dSheet, UndergroundBaseView, UndergroundMenuView, UndergroundPcView, UndergroundTrapView, UndergroundVendorView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { at, atTiles, board, boardContext, DS_HEIGHT, DS_WIDTH } from './board.ts';
import { el } from './core.ts';
import { layoutScene, place, sceneContext } from './evolution.ts';
import './underground.css';
import { S } from '../strings/index.ts';

type Img = HTMLImageElement;
const W = DS_WIDTH;
const H = DS_HEIGHT;
/** The board: 16 px cells from y 32 (MINING_GAME_WIDTH 13 × HEIGHT 10); the side buttons at tiles (26, 6) and (26, 15). */
const CELL = 16;
const TOP = 32;
const BUTTONS = { hammer: [26, 6], pickaxe: [26, 15] } as const;
/** The underground text printer's window (2, 19, 27, 4) and YES/NO (sYesNoWindowTemplate: 25, 13). */
const MESSAGE_TILES = [1, 18, 30, 6] as const;
const YES_NO_TILES = [24, 12, 8, 6] as const;

/** The Underground's own window frame (STANDARD_WINDOW_UNDERGROUND), else the field's. */
function ugFramed(d: DrawContext, className: string, ...children: Node[]): HTMLElement {
  const w = el('section', `window ${className}`, ...children);
  if (!d.art.frame(w, 'windows/standard_underground')) d.art.frame(w, 'windows/standard_field');
  return w;
}

function yesNo(d: DrawContext, v: { yes: string; no: string; cursor: 0 | 1 }): HTMLElement {
  return atTiles(ugFramed(d, 'yes-no', stop(d, 'yes', [d.text(v.yes)], 'choice', v.cursor === 0), stop(d, 'no', [d.text(v.no)], 'choice', v.cursor === 1)), ...YES_NO_TILES);
}

function message(d: DrawContext, m: { text: string; waiting: boolean }): HTMLElement {
  return atTiles(messageBox(d, m.text, m.waiting), ...MESSAGE_TILES);
}

/** A list window: six rows from `top`, CLOSE last (taps `row:<i>`, `close`). */
function listWindow(d: DrawContext, l: { rows: { name: string; right: string | null }[]; close: string; cursor: number; top: number; visible: number }, tiles: readonly [number, number, number, number], className: string): HTMLElement {
  const rows = el('div', 'item-list ug-list');
  const all = [...l.rows.map((r, i) => ({ ...r, i })), { name: l.close, right: null, i: l.rows.length }];
  for (const r of all.slice(l.top, l.top + l.visible)) {
    const parts = [el('span', 'item-name', d.text(r.name))];
    if (r.right !== null) parts.push(el('span', 'price', d.text(r.right)));
    rows.append(stop(d, r.i === l.rows.length ? 'close' : `row:${r.i}`, parts, `item-row${r.i === l.rows.length ? ' cancel' : ''}`, l.cursor === r.i));
  }
  return atTiles(ugFramed(d, `ug-list-window ${className}`, rows), ...tiles);
}

/** UndergroundMenu_* (menus.c): the start menu (20, 1, 11 × 21), a list (19, 3, 12 × 12), the item menu, the records. */
export function undergroundMenu(wide: DrawContext, v: UndergroundMenuView): HTMLElement {
  const d = boardContext(wide);
  const root = board('mart mart-board ug-board ug-menu');
  if (v.entries) root.append(atTiles(ugFramed(d, 'mart-menu ug-start', ...v.entries.map((e, i) => stop(d, `entry:${i}`, [d.text(e.label)], 'menu-entry', v.cursor === i))), 20, 1, 11, 2 + v.entries.length * 2));
  if (v.list) root.append(listWindow(d, v.list, [18, 1, 14, 2 + v.list.visible * 2], 'ug-items'));
  if (v.menu) root.append(atTiles(ugFramed(d, 'mart-menu ug-item-menu', ...v.menu.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', v.menu!.cursor === i))), 21, 9, 11, 2 + v.menu.entries.length * 2));
  if (v.records) {
    const rows = v.records.rows.map((r) => el('div', 'ug-record', d.text(r.label), el('span', 'ug-record-value', d.text(r.value))));
    const w = stop(d, 'back', [el('div', 'ug-record-title', d.text(v.records.title)), ...rows], 'ug-records', false);
    root.append(atTiles(ugFramed(d, 'ug-records-window', w), 2, 1, 28, 17));
  }
  if (v.message) root.append(message(d, v.message));
  else if (v.list) root.append(atTiles(el('div', 'ug-description', ugFramed(d, 'ug-description-box', d.flow(v.list.description, true))), ...MESSAGE_TILES));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  return root;
}

/** UndergroundVendors_ShopMenuTask (vendors.c): the options (19, 3, 12 × n·2), the list, the price (1, 12, 12 × 4), the heading (1, 1, 7 × 4). */
export function undergroundVendor(wide: DrawContext, v: UndergroundVendorView): HTMLElement {
  const d = boardContext(wide);
  const root = board('mart mart-board ug-board ug-vendor');
  if (v.options) root.append(atTiles(ugFramed(d, 'mart-menu ug-options', ...v.options.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', v.options!.cursor === i))), 18, 2, 14, 2 + v.options.entries.length * 2));
  if (v.list) {
    root.append(listWindow(d, v.list, [18, 2, 14, 2 + v.list.visible * 2], 'ug-shop'));
    if (v.list.heading) root.append(atTiles(ugFramed(d, 'ug-heading', d.flow(v.list.heading, true)), 0, 0, 9, 6));
  }
  if (v.price) root.append(atTiles(ugFramed(d, 'ug-price', el('div', '', d.text(v.price.label)), el('div', 'ug-price-value', d.text(v.price.value ?? ''))), 0, 11, 14, 6));
  if (v.message) root.append(message(d, v.message));
  else if (v.list) root.append(atTiles(el('div', 'ug-description', ugFramed(d, 'ug-description-box', d.flow(v.list.description, true))), ...MESSAGE_TILES));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  return root;
}

/** The prompt over the field (Mining_ProcessMiningSpotInteract): the message and YES/NO. */
export function miningPrompt(wide: DrawContext, v: MiningView): HTMLElement {
  const d = boardContext(wide);
  const root = board('mart mart-board ug-board ug-mining-prompt');
  if (v.message) root.append(message(d, v.message));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  return root;
}

/** A frame of a sheet's animation `anim` `frame` frames in (looping ones wrap; forward ones hold their last). */
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

class MiningScene {
  readonly root = el('section', 'ds-scene ug-mining-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private overlayKey = '';
  private last: { d: DrawContext; v: MiningView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', S.aria.mining);
    // The stylus: a press is a strike (or a side button) at its DS point (decomp gSystem.touchPressed).
    this.stage.addEventListener('pointerdown', (e) => {
      if (!this.last || (e.target as HTMLElement).closest('button, .msg-box')) return;
      e.preventDefault();
      const r = this.stage.getBoundingClientRect();
      this.last.d.tap(`hit:${Math.floor(((e.clientX - r.left) / r.width) * W)},${Math.floor(((e.clientY - r.top) / r.height) * H)}`);
    });
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

  /** A sheet's cell (by index or name) with its top-left at (x, y), clipped to `sw`×`sh` from (sx, sy) of the cell. */
  private cell(path: string, cell: number | string | null, x: number, y: number, clip?: { sx: number; sy: number; w: number; h: number }): boolean {
    const sheet = this.art.sheet(path);
    if (!sheet) return false;
    const index = typeof cell === 'string' ? (sheet.names?.indexOf(cell) ?? -1) : cell;
    const c = index === null || index < 0 ? undefined : sheet.cells[index];
    const img = c ? this.image(sheet.atlas) : null;
    if (!img || !c) return true;
    if (clip) this.g.drawImage(img, c.x + clip.sx, c.y + clip.sy, clip.w, clip.h, x + clip.sx, y + clip.sy, clip.w, clip.h);
    else this.g.drawImage(img, c.x, c.y, c.w, c.h, Math.round(x - c.ox), Math.round(y - c.oy), c.w, c.h);
    return true;
  }

  private anim(path: string, anim: number, frame: number, x: number, y: number): void {
    this.cell(path, animFrame(this.art.sheet(path), anim, frame), x, y);
  }

  draw(ctx: DrawContext, v: MiningView): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.save();
    // Mining_ShakeScreen: BG0–2 offset by the shake.
    g.translate(-v.shake.x, -v.shake.y);
    const rom = this.cell('underground/mining_interface', 0, 0, 0);
    this.root.classList.toggle('rom', rom);
    if (!rom) {
      g.fillStyle = '#a08860';
      g.fillRect(0, 0, W, H);
    }
    // Mining_DrawWallCrack: the crack's tiles from column 25 leftwards, (208 − (wall / 4 · 4 + 8)) / 8 of them.
    const w4 = Math.floor(v.crack / 4) * 4;
    const len = Math.max(0, Math.floor((MINING_W * CELL - (w4 + 8)) / 8));
    if (len) this.cell('underground/mining_crack', 0, 0, 0, { sx: (26 - len) * 8, sy: 0, w: len * 8, h: 32 });
    for (const tool of ['hammer', 'pickaxe'] as const) {
      const [tx, ty] = BUTTONS[tool];
      this.cell('underground/mining_buttons', `${tool}-${v.tool === tool ? 2 : 0}`, tx * 8, ty * 8);
    }
    for (const o of v.objects) {
      if (!this.cell('underground/mining_objects', `${o.sprite}-${o.palette}-${o.shine}`, o.x * CELL, o.y * CELL + TOP)) {
        g.fillStyle = '#7090c0';
        g.fillRect(o.x * CELL, o.y * CELL + TOP, o.width * CELL, o.height * CELL);
      }
    }
    v.dirt.forEach((layer, i) => {
      const x = (i % MINING_W) * CELL;
      const y = Math.floor(i / MINING_W) * CELL + TOP;
      if (!this.cell('underground/mining_dirt', String(layer), x, y) && layer) {
        g.fillStyle = `rgb(${120 - layer * 10} ${90 - layer * 8} ${60 - layer * 6})`;
        g.fillRect(x, y, CELL, CELL);
      }
    });
    g.restore();
    // The OAM: the crack's end (Mining_DrawWallCrack's anim 6 − (wall % 24) / 4), the tools and sparkles.
    this.anim('underground/mining_crack_end', 6 - Math.floor((w4 % 24) / 4), v.tick, w4 + 16 - v.shake.x, 16 - v.shake.y);
    for (const e of v.effects) this.anim('underground/mining_anims', e.anim, e.tick, e.x, e.y);
    if (v.cursor) {
      g.strokeStyle = '#f8f8f8';
      g.lineWidth = 2;
      g.strokeRect(v.cursor.x * CELL + 1, v.cursor.y * CELL + TOP + 1, CELL - 2, CELL - 2);
    }
    if (v.fade) {
      g.globalAlpha = v.fade / 16;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    this.drawBoxes(d, v);
  }

  private drawBoxes(d: DrawContext, v: MiningView): void {
    const key = JSON.stringify([v.message, d.frame, d.scale]);
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const parts: HTMLElement[] = [];
    if (v.message) {
      const box = messageBox(d, v.message.text, v.message.waiting);
      box.classList.add('ds-scene-message');
      place(box, { x: 8, y: 144, w: 240, h: 48 });
      parts.push(box);
    }
    // The side buttons as buttons too (the stylus' hit boxes for keyboards and screen readers).
    for (const tool of ['hammer', 'pickaxe'] as const) {
      const [tx, ty] = BUTTONS[tool];
      const b = stop(d, tool, [], `ug-tool ug-${tool}`, v.tool === tool);
      b.setAttribute('aria-label', tool === 'hammer' ? 'Hammer' : 'Pickaxe');
      place(b, { x: tx * 8, y: ty * 8, w: 48, h: 64 });
      parts.push(b);
    }
    this.boxes.replaceChildren(...parts);
  }
}
const MINING_W = 13;

const miningScenes = new WeakMap<Art, MiningScene>();

export function mining(d: DrawContext, v: MiningView): HTMLElement {
  let scene = miningScenes.get(d.art);
  if (!scene || !scene.root.isConnected) miningScenes.set(d.art, (scene = new MiningScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}

// ---------------------------------------------------------------- the secret base's prompts and PC

/** SecretBases' sLeaveOpenOrCloseWindowTemplate (16, 13, 15 × 4). */
const ENTRANCE_MENU_TILES = [15, 12, 16, 6] as const;

/** A secret base prompt (contracts `UndergroundBaseView`): the message, YES/NO and the entrance's two choices. */
export function undergroundBase(wide: DrawContext, v: UndergroundBaseView): HTMLElement {
  const d = boardContext(wide);
  const root = board('mart mart-board ug-board ug-base');
  if (v.menu) root.append(atTiles(ugFramed(d, 'mart-menu ug-entrance-menu', ...v.menu.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', v.menu!.cursor === i))), ...ENTRANCE_MENU_TILES));
  if (v.message) root.append(message(d, v.message));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  return root;
}

/**
 * The secret base's PC (contracts `UndergroundPcView`): the PC menu (UndergroundPC_InitMenu: 17, 3, 14 × n·2), the goods
 * lists with their heading window (1, 1, 8 × 4), CHECK FLAGS, the decoration's menu (19, 3, 12 × 8, DECOR at 1, 1),
 * the descriptions in the message box, the fades; while a good is placed or picked, a touch on the floor is a
 * `tile:<x>,<z>` tap (DrawContext.fieldTile).
 */
export function undergroundPc(wide: DrawContext, v: UndergroundPcView): HTMLElement {
  const d = boardContext(wide);
  const root = board('mart mart-board ug-board ug-pc');
  if (v.placing && d.fieldTile) {
    const floor = el('div', 'ug-floor-touch');
    floor.setAttribute('aria-hidden', 'true');
    floor.addEventListener('pointerdown', (e) => {
      const tile = d.fieldTile!(e.clientX, e.clientY);
      if (tile) d.tap(`tile:${tile.x},${tile.z}`);
    });
    root.append(floor);
  }
  if (v.entries) root.append(atTiles(ugFramed(d, 'mart-menu ug-pc-menu', ...v.entries.map((e, i) => stop(d, `entry:${i}`, [d.text(e.label)], 'menu-entry', v.cursor === i))), 16, 2, 16, 2 + v.entries.length * 2));
  if (v.list) {
    const l = v.list;
    const rows = el('div', 'item-list ug-list');
    const all = [...l.rows.map((r, i) => ({ ...r, i })), { name: l.close, placed: false, i: l.rows.length }];
    for (const r of all.slice(l.top, l.top + l.visible)) rows.append(stop(d, r.i === l.rows.length ? 'close' : `row:${r.i}`, [el('span', 'item-name', d.text(r.name, r.placed ? 'muted' : 'ink'))], `item-row${r.i === l.rows.length ? ' cancel' : ''}`, l.cursor === r.i));
    root.append(atTiles(ugFramed(d, 'ug-list-window ug-pc-list', rows), 18, 2, 14, 2 + l.visible * 2));
    root.append(atTiles(ugFramed(d, 'ug-heading', d.flow(l.heading, true)), 0, 0, 10, 6));
    if (!v.message) root.append(atTiles(el('div', 'ug-description', ugFramed(d, 'ug-description-box', d.flow(l.description, true))), ...MESSAGE_TILES));
  }
  if (v.flags) {
    const rows = v.flags.rows.map((r) => el('div', 'ug-record', d.text(r.label), el('span', 'ug-record-value', d.text(r.value))));
    const w = stop(d, 'back', [el('div', 'ug-record-title', d.text(v.flags.title)), ...rows], 'ug-records', false);
    root.append(atTiles(ugFramed(d, 'ug-records-window ug-flags', w), 2, 1, 28, 18));
  }
  if (v.decoration) {
    const m = v.decoration.menu;
    root.append(atTiles(ugFramed(d, 'mart-menu ug-decor-menu', ...m.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', m.cursor === i))), 18, 2, 14, 2 + m.entries.length * 2));
    root.append(atTiles(ugFramed(d, 'ug-heading', d.text(v.decoration.heading)), 0, 0, 9, 4));
  }
  if (v.message) root.append(message(d, v.message));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  if (v.fade) {
    const fade = at(el('div', 'ug-fade'), 0, 0, W, H);
    fade.style.opacity = String(v.fade / 16);
    root.append(fade);
  }
  return root;
}

// ---------------------------------------------------------------- a trap's screen

/** A cell of a sheet at its origin point, scaled about it, mirrored by `flip` (BG tiles: bit 0 h, bit 1 v). */
function drawCell(g: CanvasRenderingContext2D, img: Img, c: Ui2dSheet['cells'][number], x: number, y: number, scale = 1, flip = 0): void {
  g.save();
  g.translate(x, y);
  if (scale !== 1) g.scale(scale, scale);
  if (flip) g.scale(flip & 1 ? -1 : 1, flip & 2 ? -1 : 1);
  g.drawImage(img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
  g.restore();
}

/**
 * A trap's screen over the field (contracts `UndergroundTrapView`), one 256×192 DS canvas on the board: the flash or
 * dimming, the smoke tiles (`underground/trap_smoke`), the sprites (`underground/trap_*`, translucent ones at the
 * DS's blend), the keys' stylus, the message box. The stylus: a press is `hit:<x>,<y>`, a held one `rub:<x>,<y>` each
 * move and `blow:on` until it lifts (`rub:end`, `blow:off`).
 */
class TrapScene {
  readonly root = board('mart mart-board ug-board ug-trap');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ug-trap-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private last: { d: DrawContext; v: UndergroundTrapView } | null = null;
  private boxKey = '';
  private down = false;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ug-trap-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.root.append(at(this.canvas, 0, 0, W, H), this.boxes);
    this.root.setAttribute('aria-label', S.aria.trap);
    const point = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return `${Math.max(0, Math.min(W - 1, Math.floor(((e.clientX - r.left) / r.width) * W)))},${Math.max(0, Math.min(H - 1, Math.floor(((e.clientY - r.top) / r.height) * H)))}`;
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.last) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.down = true;
      const d = this.last.d;
      const p = point(e);
      d.tap(`hit:${p}`);
      d.tap(`rub:${p}`);
      d.tap('blow:on');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.down || !this.last) return;
      this.last.d.tap(`rub:${point(e)}`);
    });
    const up = () => {
      if (!this.down || !this.last) return;
      this.down = false;
      this.last.d.tap('rub:end');
      this.last.d.tap('blow:off');
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
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

  draw(wide: DrawContext, v: UndergroundTrapView): void {
    this.last = { d: wide, v };
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    if (v.smoke) {
      const sheet = this.art.sheet('underground/trap_smoke');
      const img = sheet ? this.image(sheet.atlas) : null;
      v.smoke.forEach((e, i) => {
        const tile = e & 0xff;
        if (!tile) return;
        const x = (i % 32) * 8;
        const y = Math.floor(i / 32) * 8;
        const c = sheet?.cells[tile];
        if (img && c) drawCell(g, img, c, x + 4, y + 4, 1, (e >> 10) & 3);
        else if (!sheet) {
          g.fillStyle = `rgba(200, 200, 200, ${0.25 + (5 - tile) * 0.15})`;
          g.fillRect(x, y, 8, 8);
        }
      });
    }
    for (const s of v.sprites) {
      const sheet = this.art.sheet(`underground/${s.sheet}`);
      const img = sheet ? this.image(sheet.atlas) : null;
      const cell = sheet ? animFrame(sheet, s.anim, s.tick) : null;
      const c = cell === null ? undefined : sheet!.cells[cell];
      g.globalAlpha = s.translucent ? 14 / 16 : 1;
      if (img && c) drawCell(g, img, c, s.x, s.y, s.scale);
      else if (!sheet) {
        g.fillStyle = '#d8e8f8';
        g.beginPath();
        g.arc(s.x, s.y, 12 * s.scale, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (v.cursor) {
      g.strokeStyle = '#f8f8f8';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(v.cursor.x, v.cursor.y, 6, 0, Math.PI * 2);
      g.stroke();
    }
    this.root.style.setProperty('--ug-brightness', String(v.brightness / 16));
    this.root.classList.toggle('is-bright', v.brightness > 0);
    this.root.classList.toggle('is-dim', v.brightness < 0);
    this.root.classList.toggle('is-blowing', v.blowing);
    const d = boardContext(wide);
    const key = JSON.stringify([v.message, d.frame, d.unit]);
    if (key === this.boxKey) return;
    this.boxKey = key;
    this.boxes.replaceChildren(...(v.message ? [message(d, v.message)] : []));
  }
}

const trapScenes = new WeakMap<Art, TrapScene>();

export function undergroundTrap(d: DrawContext, v: UndergroundTrapView): HTMLElement {
  let scene = trapScenes.get(d.art);
  if (!scene || !scene.root.isConnected) trapScenes.set(d.art, (scene = new TrapScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
