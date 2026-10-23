/**
 * The Battle Frontier's DS screens (contracts `FactoryView`, `HallBoardView`; packages/menus frontier.ts owns their
 * state): one 256×192 DS screen on a canvas at a whole number of device pixels per DS pixel (as the other DS scenes,
 * evolution.ts `layoutScene`), the ROM's layers and sprites from `FrontierTables.factory.art` / `.hall.art`, and the
 * windows, names and Pokémon pictures as DOM at their decomp places.
 * - The Factory's rental app (battle_factory/main.c): BG2 the conveyor (scrolled), BG3 the panel (the selection,
 *   the confirm panel, or the startup screen while the balls ride in under the turning wheel, BG1); the balls
 *   (shaking when picked, PALETTE_POKEBALL_SELECTED) and the cursor; the Pokémon's front sprite at (120, 43) (the
 *   picks at x 44, 128, 212 on the confirm panel); the name windows (1, 1) and (1, 4 + 2i); the message box (2, 19,
 *   17 × 4) and the menu (23, 17, 8 × 6).
 * - The Hall's board (battle_hall/main.c): BG3 the grid, each cell in its palette (normal, selected, unselectable);
 *   the type names at (9 + 64 col, 16 + 36 row) and the ranks at (26 + 64 col, 4 + 36 row); the cursor box; the
 *   Pokémon's icon (160, 160) and name (80, 160); the message box (2, 19, 27 × 4) and YES/NO (24, 13, 7 × 4).
 * Packs without the art (the fixture) get flat colours in the same places.
 */
import { newGameRecord, type FactoryView, type HallBoardView, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { ICON_ANIM } from './art.ts';
import { el } from './core.ts';
import { layoutScene, place, sceneContext } from './evolution.ts';
import './frontier.css';

const W = 256;
const H = 192;
/** Decomp BattleFactoryApp's windows (tiles → DS px, with their 8 px frames). */
const FACTORY_MESSAGE = { x: 8, y: 144, w: 160, h: 48 };
const FACTORY_MENU = { x: 176, y: 128, w: 80, h: 64 };
/** Decomp BattleHallApp_InitWindows: the message box and YES/NO (with their frames); the cells (ChangeCellBackground's rects). */
const HALL_MESSAGE = { x: 8, y: 144, w: 240, h: 48 };
const HALL_YES_NO = { x: 184, y: 96, w: 72, h: 48 };
const HALL_ROWS = [
  { y: 0, h: 40 },
  { y: 40, h: 32 },
  { y: 72, h: 40 },
  { y: 112, h: 32 },
  { y: 144, h: 40 },
];
/** Decomp GetCursorX/Y (COL_WIDTH 64, ROW_HEIGHT 36) and the summary cells' cursor at (128, 168). */
const COL = 64;
const ROW = 36;
/** Decomp BattleHallAppSprite anims: 0 still (a pick being confirmed), 1 moving, 2 the summary cells' wide box. */
const HALL_CURSOR_ANIM = { still: 0, cell: 1, summary: 2 };
/** Decomp ANIM_ID_BALL_STATIC, _BALL_SHAKING, _CURSOR, _MENU_CURSOR. */
const FACTORY_ANIM = { ball: 6, shaking: 7, cursor: 8, menuCursor: 9 };

type Img = HTMLImageElement;

/** A sheet's animation frame at time `t` ticks (looping ones wrap, forward ones hold their last). */
function animCell(sheet: Ui2dSheet, anim: number, t: number): number {
  const a = sheet.animations?.[anim];
  if (!a?.frames.length) return 0;
  const total = a.frames.reduce((n, f) => n + f.ticks, 0) || 1;
  let left = a.mode === 'forward' ? Math.min(t, total - 1) : t % total;
  for (const f of a.frames) {
    if (left < f.ticks) return f.cell;
    left -= f.ticks;
  }
  return a.frames.at(-1)!.cell;
}

/** A canvas DS screen with DOM boxes over it (the frontier apps' common part). */
abstract class FrontierScene<V> {
  readonly root: HTMLElement;
  protected readonly stage = el('div', 'ds-scene-stage');
  protected readonly canvas = document.createElement('canvas');
  protected readonly boxes = el('div', 'ds-scene-boxes');
  protected readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private boxKey = '';
  protected last: { d: DrawContext; v: V } | null = null;

  constructor(
    protected readonly art: Art,
    className: string,
    label: string,
  ) {
    this.root = el('section', `ds-scene frontier-app ${className}`);
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', label);
  }

  protected sheetOf(d: DrawContext, id: Id): Ui2dSheet | undefined {
    return d.registries.ui2d.get(id);
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

  /** Cell `index` of a sheet at (x, y) (its origin), optionally clipped to a DS rect of the screen. */
  protected cell(sheet: Ui2dSheet | undefined, index: number, x: number, y: number, clip?: { x: number; y: number; w: number; h: number }): boolean {
    const c = sheet?.cells[index];
    const img = sheet ? this.image(sheet.atlas) : null;
    if (!c || !img) return false;
    if (clip) {
      this.g.drawImage(img, c.x + clip.x - x, c.y + clip.y - y, clip.w, clip.h, clip.x, clip.y, clip.w, clip.h);
      return true;
    }
    this.g.drawImage(img, c.x, c.y, c.w, c.h, Math.round(x - c.ox), Math.round(y - c.oy), c.w, c.h);
    return true;
  }

  draw(ctx: DrawContext, v: V): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    this.g.imageSmoothingEnabled = false;
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, W, H);
    this.paint(d, v);
    const key = JSON.stringify([this.boxesKey(v), d.frame, d.scale]);
    if (key === this.boxKey) return;
    this.boxKey = key;
    this.boxes.replaceChildren(...this.drawBoxes(d, v));
  }

  protected abstract paint(d: DrawContext, v: V): void;
  protected abstract boxesKey(v: V): unknown;
  protected abstract drawBoxes(d: DrawContext, v: V): HTMLElement[];
}

/** Presentation time for sprite animations (never game state). */
const animTicks = () => Math.floor(performance.now() / (1000 / 30));

class FactoryScene extends FrontierScene<FactoryView> {
  constructor(art: Art) {
    super(art, 'factory-app', 'Battle Factory: rental Pokémon');
  }

  protected paint(d: DrawContext, v: FactoryView): void {
    const art = newGameRecord(d.registries).frontier?.factory.art ?? null;
    const g = this.g;
    if (!art) {
      g.fillStyle = '#304860';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#586878';
      g.fillRect(0, 96, W, 32);
    } else {
      const conveyor = this.sheetOf(d, art.conveyor);
      const w = conveyor?.cells[0]?.w ?? W;
      const x = -(v.conveyor % w);
      this.cell(conveyor, 0, x, 0);
      if (x + w < W) this.cell(conveyor, 0, x + w, 0);
      const intro = v.stage === 'message' && !v.message;
      this.cell(this.sheetOf(d, intro ? art.noScreens : v.panel === 'summary' ? art.summary : art.selection), 0, 0, 0);
      if (intro) this.cell(this.sheetOf(d, art.wheel[v.wheel]!), 0, 0, 0);
    }
    const t = animTicks();
    const picked = art ? this.sheetOf(d, art.sprites) : undefined;
    const unpicked = art ? this.sheetOf(d, art.unpicked) : undefined;
    for (const b of v.balls) {
      const sheet = b.picked ? picked : unpicked;
      if (sheet) this.cell(sheet, animCell(sheet, b.picked ? FACTORY_ANIM.shaking : FACTORY_ANIM.ball, t), b.x, b.y);
      else {
        g.fillStyle = b.picked ? '#f05050' : '#e8e8e8';
        g.beginPath();
        g.arc(b.x, b.y, 8, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (v.stage === 'message') return;
    if (picked) this.cell(picked, animCell(picked, v.cursor.menu ? FACTORY_ANIM.menuCursor : FACTORY_ANIM.cursor, t), v.cursor.x, v.cursor.y);
    else {
      g.strokeStyle = '#f8f800';
      g.lineWidth = 2;
      g.strokeRect(v.cursor.x - 12, v.cursor.y - 12, 24, 24);
    }
  }

  protected boxesKey(v: FactoryView): unknown {
    return [v.mons, v.names, v.playerName, v.message, v.menu, v.balls.length, v.stage];
  }

  protected drawBoxes(d: DrawContext, v: FactoryView): HTMLElement[] {
    const parts: HTMLElement[] = [];
    for (const m of v.mons) {
      const pic = d.art.pokemonFront(m.species, m.form, m.shiny, m.gender === 'female', d.scale, false);
      if (!pic) continue;
      const box = el('div', 'frontier-mon', pic);
      place(box, { x: m.x - 40, y: m.y - 40, w: 80, h: 80 });
      parts.push(box);
    }
    if (v.stage !== 'message') {
      const player = el('div', 'frontier-name', d.text(v.playerName));
      place(player, { x: 8, y: 8, w: 80, h: 16 });
      parts.push(player);
    }
    v.names.forEach((name, i) => {
      const n = el('div', 'frontier-name', d.text(name));
      place(n, { x: 8, y: 32 + i * 16, w: 72, h: 16 });
      parts.push(n);
    });
    // The balls as buttons (taps `ball:<i>`), for the stylus, keyboards and screen readers.
    if (v.stage === 'pick' || v.stage === 'receive') {
      v.balls.forEach((b, i) => {
        const button = stop(d, `ball:${i}`, [], 'frontier-ball', !v.cursor.menu && v.cursor.x === b.x && v.cursor.y === b.y);
        button.setAttribute('aria-label', `Poké Ball ${i + 1}${b.picked ? ' (picked)' : ''}`);
        place(button, { x: b.x - 16, y: b.y - 16, w: 32, h: 32 });
        parts.push(button);
      });
    }
    if (v.message) {
      const box = messageBox(d, v.message, false);
      box.classList.add('ds-scene-message');
      place(box, FACTORY_MESSAGE);
      parts.push(box);
    }
    if (v.menu) {
      const w = framed(d, 'frontier-menu', ...v.menu.entries.map((e, i) => stop(d, `entry:${i}`, [d.text(e)], 'choice', v.menu!.cursor === i)));
      place(w, FACTORY_MENU);
      parts.push(w);
    }
    return parts;
  }
}

class HallBoardScene extends FrontierScene<HallBoardView> {
  constructor(art: Art) {
    super(art, 'hall-board', 'Battle Hall: choose a type');
  }

  private rect(cell: number): { x: number; y: number; w: number; h: number } {
    const r = HALL_ROWS[Math.floor(cell / 4)]!;
    return { x: (cell % 4) * COL, y: r.y, w: COL, h: r.h };
  }

  protected paint(d: DrawContext, v: HallBoardView): void {
    const art = newGameRecord(d.registries).frontier?.hall.art ?? null;
    const g = this.g;
    const normal = art ? this.sheetOf(d, art.board.normal) : undefined;
    if (!this.cell(normal, 0, 0, 0)) {
      g.fillStyle = '#283850';
      g.fillRect(0, 0, W, H);
    }
    v.cells.forEach((c, i) => {
      if (c.state === 'normal') return;
      const r = this.rect(i);
      if (art && this.cell(this.sheetOf(d, c.state === 'selected' ? art.board.selected : art.board.unselectable), 0, 0, 0, r)) return;
      g.fillStyle = c.state === 'selected' ? 'rgb(248 200 64 / 0.6)' : 'rgb(0 0 0 / 0.45)';
      g.fillRect(r.x, r.y, r.w, r.h);
    });
    const cursor = art ? this.sheetOf(d, art.cursor) : undefined;
    const summary = v.cursor === 17 || v.cursor === 18;
    const anim = v.yesNo ? HALL_CURSOR_ANIM.still : summary ? HALL_CURSOR_ANIM.summary : HALL_CURSOR_ANIM.cell;
    const [x, y] = summary ? [128, 168] : [(v.cursor % 4) * COL + 32, Math.floor(v.cursor / 4) * ROW + 16];
    if (cursor) this.cell(cursor, animCell(cursor, anim, animTicks()), x, y);
    else {
      g.strokeStyle = '#f8f800';
      g.lineWidth = 2;
      const r = this.rect(v.cursor);
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  protected boxesKey(v: HallBoardView): unknown {
    return [v.cells, v.mon, v.message, v.yesNo, v.cursor];
  }

  protected drawBoxes(d: DrawContext, v: HallBoardView): HTMLElement[] {
    const parts: HTMLElement[] = [];
    v.cells.forEach((c, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      // The cells as buttons (taps `cell:<i>`), the type name and rank drawn in them at their DS places.
      const r = this.rect(i);
      const b = stop(d, `cell:${i}`, [], 'frontier-cell', v.cursor === i);
      b.setAttribute('aria-label', c.rank === null ? c.label || 'Summary' : `${c.label} rank ${c.rank}`);
      place(b, r);
      parts.push(b);
      if (c.label) {
        const label = el('div', 'frontier-label', d.text(c.label));
        place(label, { x: 9 + COL * col, y: 16 + ROW * row, w: 54, h: 16 });
        parts.push(label);
      }
      if (c.rank !== null) {
        const rank = el('div', 'frontier-label frontier-rank', d.text(String(c.rank)));
        place(rank, { x: 26 + COL * col, y: 4 + ROW * row, w: 24, h: 16 });
        parts.push(rank);
      }
    });
    if (!v.message) {
      const icon = el('div', 'frontier-icon', d.art.pokemonIcon(v.mon.species, v.mon.form, ICON_ANIM.hpMax, false));
      place(icon, { x: 144, y: 144, w: 32, h: 32 });
      const name = el('div', 'frontier-name', d.text(v.mon.name));
      place(name, { x: 80, y: 160, w: 72, h: 16 });
      parts.push(icon, name);
    } else {
      const box = messageBox(d, v.message, !v.yesNo);
      box.classList.add('ds-scene-message');
      place(box, HALL_MESSAGE);
      parts.push(box);
    }
    if (v.yesNo) {
      const yn = framed(d, 'yes-no ds-scene-yes-no', stop(d, 'entry:0', [d.text(v.yesNo.yes)], 'choice', v.yesNo.cursor === 0), stop(d, 'entry:1', [d.text(v.yesNo.no)], 'choice', v.yesNo.cursor === 1));
      place(yn, HALL_YES_NO);
      parts.push(yn);
    }
    return parts;
  }
}

const factoryScenes = new WeakMap<Art, FactoryScene>();
const hallScenes = new WeakMap<Art, HallBoardScene>();

export function factoryApp(d: DrawContext, v: FactoryView): HTMLElement {
  let s = factoryScenes.get(d.art);
  if (!s || !s.root.isConnected) factoryScenes.set(d.art, (s = new FactoryScene(d.art)));
  s.draw(d, v);
  return s.root;
}

export function hallBoard(d: DrawContext, v: HallBoardView): HTMLElement {
  let s = hallScenes.get(d.art);
  if (!s || !s.root.isConnected) hallScenes.set(d.art, (s = new HallBoardScene(d.art)));
  s.draw(d, v);
  return s.root;
}
