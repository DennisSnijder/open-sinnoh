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
 * - The Castle's apps (battle_castle/self_app.c, opponent_app.c, windows.c): BG3 the layout, BG2 the item list or the
 *   summary or moves panel over it; the slots' icons, HP bars, held-item marks or Poké Balls, the cursor; the header,
 *   levels, HP and EXIT text; the menus, the prompt, message box and YES/NO.
 * - The Arcade's board (battle_arcade/main.c): BG3 the board, the 16 panels and the cursor, the two columns of icons
 *   and held-item marks; the touch screen's STOP button at half size in a corner of the one screen.
 * The sprites animate on the canvas between views. Packs without the art (the fixture) get flat colours in the same
 * places.
 */
import { dexOf, newGameRecord, type ArcadeView, type CastleMonView, type CastleView, type FactoryView, type FrontierRecordsView, type HallBoardView, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { levelMark } from '@opensinnoh/text';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { hpColor, ICON_ANIM } from './art.ts';
import { el } from './core.ts';
import { layoutScene, place, sceneContext } from './evolution.ts';
import { DsScene } from './journal.ts';
import type { Palette } from './pixel-font.ts';
import './frontier.css';
import { S as words } from '../strings/index.ts';

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

/** The index of a sheet animation's frame at time `t` ticks (looping ones wrap, forward ones hold their last). */
function animFrame(sheet: Ui2dSheet, anim: number, t: number): number {
  const a = sheet.animations?.[anim];
  if (!a?.frames.length) return 0;
  const total = a.frames.reduce((n, f) => n + f.ticks, 0) || 1;
  let left = a.mode === 'forward' ? Math.min(t, total - 1) : t % total;
  for (const [i, f] of a.frames.entries()) {
    if (left < f.ticks) return i;
    left -= f.ticks;
  }
  return a.frames.length - 1;
}

/** A sheet's animation cell at time `t` ticks. */
function animCell(sheet: Ui2dSheet, anim: number, t: number): number {
  return sheet.animations?.[anim]?.frames[animFrame(sheet, anim, t)]?.cell ?? 0;
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
  /** The scene context and view last painted with the animation tick they were painted at; the repaint loop's frame. */
  private painted: { d: DrawContext; v: V; tick: number } | null = null;
  private loop = 0;

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

  protected image(ref: Id): Img | null {
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

  /**
   * A Pokémon's party icon (`PokemonSpriteForm.icon`: two 32×32 frames, top first) on frame `frame`, centred at
   * (x, y); a flat disc without its sprites (the fixture).
   */
  protected icon(d: DrawContext, species: Id, form: number, frame: number, x: number, y: number): void {
    const sprites = d.registries.pokemonSprites.get(species);
    if (!sprites) {
      this.g.fillStyle = '#a8b0c0';
      this.g.beginPath();
      this.g.arc(x, y, 10, 0, Math.PI * 2);
      this.g.fill();
      return;
    }
    const img = this.image((sprites.forms[form] ?? sprites.forms[0]!).icon);
    if (img) this.g.drawImage(img, 0, frame * 32, 32, 32, x - 16, y - 16, 32, 32);
  }

  /** The party's held-item mark (`ui2d/party/held` cell 0) with its origin at (x, y); a flat square without it. */
  protected heldMark(d: DrawContext, x: number, y: number): void {
    if (this.cell(d.art.sheet('party/held'), 0, x, y)) return;
    this.g.fillStyle = '#f8f8f8';
    this.g.fillRect(x - 4, y - 4, 8, 8);
  }

  draw(ctx: DrawContext, v: V): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    this.painted = { d, v, tick: animTicks() };
    this.repaint();
    // The sprites animate between views (presentation only): a repaint on each new tick while the scene is shown.
    if (!this.loop) this.loop = requestAnimationFrame(this.frame);
    const key = JSON.stringify([this.boxesKey(v), d.frame, d.scale]);
    if (key === this.boxKey) return;
    this.boxKey = key;
    this.boxes.replaceChildren(...this.drawBoxes(d, v));
  }

  private repaint(): void {
    const p = this.painted!;
    this.g.imageSmoothingEnabled = false;
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, W, H);
    this.paint(p.d, p.v);
  }

  private readonly frame = (): void => {
    this.loop = 0;
    if (!this.root.isConnected || !this.painted) return;
    const tick = animTicks();
    if (tick !== this.painted.tick) {
      this.painted.tick = tick;
      this.repaint();
    }
    this.loop = requestAnimationFrame(this.frame);
  };

  protected abstract paint(d: DrawContext, v: V): void;
  protected abstract boxesKey(v: V): unknown;
  protected abstract drawBoxes(d: DrawContext, v: V): HTMLElement[];
}

/** Presentation time for sprite animations (never game state). */
const animTicks = () => Math.floor(performance.now() / (1000 / 30));

class FactoryScene extends FrontierScene<FactoryView> {
  constructor(art: Art) {
    super(art, 'factory-app', words.aria.factory);
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
        button.setAttribute('aria-label', words.aria.ball(i + 1, !!b.picked));
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
    super(art, 'hall-board', words.aria.hall);
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
      b.setAttribute('aria-label', c.rank === null ? c.label || words.aria.summary : words.aria.rank(c.label, c.rank));
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

type Rect = { x: number; y: number; w: number; h: number };
/** A window at tiles (x, y), w × h, with the standard frame's tile round it (BattleCastleApp_DrawWindow), in DS px. */
const framedRect = (x: number, y: number, w: number, h: number): Rect => ({ x: x * 8 - 8, y: y * 8 - 8, w: w * 8 + 16, h: h * 8 + 16 });
/** A message box at tiles (x, y), w × h, with its frame (two tiles left, three right, one top and bottom: decomp render_window.c), in DS px. */
const messageRect = (x: number, y: number, w: number, h: number): Rect => ({ x: x * 8 - 16, y: y * 8 - 8, w: w * 8 + 40, h: h * 8 + 16 });

/** A line of text with its left edge, right edge or centre at DS (x, y). */
function line(d: DrawContext, text: string, x: number, y: number, palette: Palette = 'ink', align: 'left' | 'right' | 'centre' = 'left'): HTMLElement {
  // The line's box: up to 160 px wide, inside the screen.
  const w = align === 'left' ? Math.min(160, W - x) : align === 'right' ? Math.min(160, x) : 2 * Math.min(80, x, W - x);
  const n = el('div', `frontier-label frontier-line is-${align}`, d.text(text, palette));
  place(n, { x: align === 'left' ? x : align === 'right' ? x - w : x - w / 2, y, w, h: 16 });
  return n;
}

/** Decomp windows.c: the Castle apps' message boxes, YES/NO, the item list's player window, and each app's menus. */
const CASTLE_WINDOWS = {
  message: messageRect(2, 19, 27, 4),
  prompt: messageRect(2, 19, 20, 4),
  hint: messageRect(2, 19, 17, 4),
  yesNo: framedRect(24, 13, 7, 4),
  playerInfo: framedRect(1, 1, 8, 4),
};
const CASTLE_MENUS: Record<CastleView['mode'], Partial<Record<NonNullable<CastleView['menu']>['window'], Rect>>> = {
  self: { options: framedRect(23, 13, 8, 10), heal: framedRect(20, 7, 11, 10), rental: framedRect(22, 9, 9, 8) },
  opponent: { options: framedRect(23, 15, 8, 8), summary: framedRect(22, 9, 9, 8), level: framedRect(24, 11, 7, 6) },
};
/** Decomp sprites.h ANIM_ID_*. */
const CASTLE_ANIM = { exitCursor: 0, monCursor: 1, listCursor: 3, upArrow: 4, downArrow: 5, shakingBall: 7, flag: 12, red: 13, yellow: 14, green: 15 };
/**
 * Decomp self_app.c / opponent_app.c, solo: slot i is 64 px right of slot 0 — its icon at (64, 58) (the selected one 3 px
 * up on the icon's first frame, 1 down on its second: BattleCastle_UpdateMonSpritePosition), the HP bar at (64, 78),
 * the held-item mark at the icon + (8, 4), an unchecked opponent's Poké Ball at (60, 62), the cursor at (72, 88); EXIT's
 * cursor at (224, 160). The item list: the renting Pokémon's icon at (40, 80), the row cursor at (158, 24 + 16 row), the
 * arrows at (160, 10) and (160, 124), the item's icon at (24, 162).
 */
const SLOT = 64;
const CASTLE_AT = {
  icon: { x: 64, y: 58 },
  bar: { x: 64, y: 78 },
  item: { x: 8, y: 4 },
  ball: { x: 60, y: 62 },
  cursor: { x: 72, y: 88 },
  exit: { x: 224, y: 160 },
  rentIcon: { x: 40, y: 80 },
  listCursor: { x: 158, y: 24 },
  upArrow: { x: 160, y: 10 },
  downArrow: { x: 160, y: 124 },
  bigItem: { x: 24, y: 162 },
  /** Decomp GetFlagSpritesOffsets (solo): the stats flag at (96, 60) and the moves flag 12 px under it. */
  flag: { x: 96, y: 60, dy: 12 },
};
/**
 * Decomp windows.c and the Print* functions (window interiors in DS px): the header (2, 1) with the name at 28 and the
 * CP right-aligned at 132; EXIT (26, 19) centred at 16, 5; the levels (0, 4) — the level mark at 40 + 64i (its number
 * 16 on), the gender at 80 + 64i — and the HP (0, 9) at 36 + 64i (the current HP right-aligned to 24, the slash, the
 * maximum from 32), all one row down; the item list (12, 2) six 16-px rows, the price right-aligned at 128; the player
 * window (1, 1) with the name at 1, 1 and the CP at 16, 16; the renting Pokémon's level (1, 7) at 4 and gender at 48, its
 * HP (1, 13) at 4; the item's name (5, 16) at 0, 6; the summary and moves panel (5, 10).
 */
const CASTLE_TEXT = {
  header: { x: 16, y: 8, name: 28, cp: 132 },
  exit: { x: 224, y: 157 },
  levels: { y: 33, x: 40, gender: 80 },
  hp: { y: 73, x: 36 },
  list: { x: 96, y: 16, w: 152, rows: 6 },
  info: { x: 8, y: 8 },
  monLevel: { x: 12, y: 56, gender: 56 },
  monHp: { x: 12, y: 104 },
  itemName: { x: 40, y: 134 },
  panel: { x: 40, y: 80 },
};
/** Taps over the art: the slots, EXIT's window, the panels' side strips and their body. */
const CASTLE_TAPS = { slot: { x: 32, y: 22, w: 64, h: 76 }, exit: { x: 200, y: 152, w: 48, h: 24 }, pageLeft: { x: 0, y: 88, w: 32, h: 96 }, pageRight: { x: 224, y: 88, w: 32, h: 96 }, panel: { x: 32, y: 80, w: 192, h: 112 } };

/** Decomp GetPokeIconAnimID / GetHpBarAnimID by HealthBar_Color. */
function castleIconAnim(m: CastleMonView): number {
  if (m.hp === 0) return ICON_ANIM.fainted;
  return { max: ICON_ANIM.hpMax, green: ICON_ANIM.hpGreen, yellow: ICON_ANIM.hpYellow, red: ICON_ANIM.hpRed }[hpColor(m.hp, m.maxHp)];
}
function castleBarAnim(m: CastleMonView): number {
  const c = hpColor(m.hp, m.maxHp);
  return c === 'red' ? CASTLE_ANIM.red : c === 'yellow' ? CASTLE_ANIM.yellow : CASTLE_ANIM.green;
}

class CastleScene extends FrontierScene<CastleView> {
  constructor(art: Art) {
    super(art, 'castle-app', words.aria.castle);
  }

  /** A sprite animation of the apps' sheet at (x, y), or the flat stand-in without the art. */
  private sprite(sheet: Ui2dSheet | undefined, anim: number, t: number, x: number, y: number, flat: () => void): void {
    if (sheet) this.cell(sheet, animCell(sheet, anim, t), x, y);
    else flat();
  }

  private monIcon(d: DrawContext, m: CastleMonView, t: number, x: number, y: number, selected: boolean): void {
    const frames = d.art.sheet('pokemon/icon_frames');
    const anim = castleIconAnim(m);
    const f = frames ? animFrame(frames, anim, t) : 0;
    const cell = frames?.animations?.[anim]?.frames[f]?.cell ?? 0;
    this.icon(d, m.species, m.form, cell, x, selected ? y + (f === 0 ? -3 : 1) : y);
  }

  protected paint(d: DrawContext, v: CastleView): void {
    const art = newGameRecord(d.registries).frontier?.castle.art ?? null;
    const g = this.g;
    const t = animTicks();
    const self = v.mode === 'self';
    if (art) {
      const layers: Partial<Record<CastleView['panel'], Id>> = self ? art.self : art.opponent;
      this.cell(this.sheetOf(d, layers.main!), 0, 0, 0);
      if (v.panel !== 'main') {
        const panel = layers[v.panel];
        if (!panel) throw new Error(`ui: the Castle's ${v.mode} app has no ${v.panel} panel`);
        this.cell(this.sheetOf(d, panel), 0, 0, 0);
      }
    } else {
      g.fillStyle = '#5848a8';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#f8f0b0';
      if (v.panel === 'items') {
        g.fillRect(80, 8, 160, 112);
        g.fillRect(8, 48, 56, 72);
        g.fillRect(0, 128, W, 56);
      } else {
        g.fillRect(16, 8, 232, 16);
        g.fillRect(32, 32, 192, 48);
        if (v.panel === 'main') g.fillRect(200, 152, 48, 24);
        else g.fillRect(0, 84, W, 104);
      }
    }
    const sheet = art ? this.sheetOf(d, art.sprites) : undefined;
    const box = (r: Rect) => () => {
      g.strokeStyle = '#f04040';
      g.lineWidth = 2;
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    };
    if (v.panel === 'items') {
      const it = v.items!;
      const m = v.mons[it.mon]!;
      this.monIcon(d, m, t, CASTLE_AT.rentIcon.x, CASTLE_AT.rentIcon.y, false);
      if (m.item) this.heldMark(d, CASTLE_AT.rentIcon.x + CASTLE_AT.item.x, CASTLE_AT.rentIcon.y + CASTLE_AT.item.y);
      const row = it.cursor - it.top;
      this.sprite(sheet, CASTLE_ANIM.listCursor, t, CASTLE_AT.listCursor.x, CASTLE_AT.listCursor.y + 16 * row, box({ x: 86, y: 16 + 16 * row, w: 148, h: 16 }));
      // Decomp UpdateItemSelectMenuDisplay: the arrows where the list scrolls.
      if (it.top > 0) this.sprite(sheet, CASTLE_ANIM.upArrow, t, CASTLE_AT.upArrow.x, CASTLE_AT.upArrow.y, () => {});
      if (it.top + CASTLE_TEXT.list.rows < it.entries.length) this.sprite(sheet, CASTLE_ANIM.downArrow, t, CASTLE_AT.downArrow.x, CASTLE_AT.downArrow.y, () => {});
      if (it.item) {
        const rec = d.registries.items.get(it.item);
        if (!rec) throw new Error(`ui: unknown item ${it.item}`);
        const img = this.image(rec.icon);
        if (img) g.drawImage(img, CASTLE_AT.bigItem.x - 16, CASTLE_AT.bigItem.y - 16);
      }
    } else {
      v.mons.forEach((m, i) => {
        const dx = SLOT * i;
        // Decomp UpdateFlagSprites: a flag for the bought stats, one for the moves (drawn whatever the slot shows).
        (['stats', 'moves'] as const).forEach((k, j) => {
          if (!m.flags?.[k]) return;
          this.sprite(sheet, CASTLE_ANIM.flag, t, CASTLE_AT.flag.x + dx, CASTLE_AT.flag.y + CASTLE_AT.flag.dy * j, () => {
            g.fillStyle = '#e83830';
            g.fillRect(CASTLE_AT.flag.x + dx - 4, CASTLE_AT.flag.y + CASTLE_AT.flag.dy * j - 4, 8, 6);
          });
        });
        if (m.hidden) {
          this.sprite(sheet, CASTLE_ANIM.shakingBall, t, CASTLE_AT.ball.x + dx, CASTLE_AT.ball.y, () => {
            g.fillStyle = '#e83830';
            g.beginPath();
            g.arc(CASTLE_AT.ball.x + dx, CASTLE_AT.ball.y, 8, 0, Math.PI * 2);
            g.fill();
          });
          return;
        }
        this.sprite(sheet, castleBarAnim(m), t, CASTLE_AT.bar.x + dx, CASTLE_AT.bar.y, () => {
          g.fillStyle = hpColor(m.hp, m.maxHp) === 'red' ? '#e85838' : hpColor(m.hp, m.maxHp) === 'yellow' ? '#e8c838' : '#58d080';
          g.fillRect(CASTLE_AT.bar.x + dx - 24, CASTLE_AT.bar.y - 2, (48 * m.hp) / m.maxHp, 4);
        });
        this.monIcon(d, m, t, CASTLE_AT.icon.x + dx, CASTLE_AT.icon.y, i === v.cursor);
        if (self && m.item) this.heldMark(d, CASTLE_AT.icon.x + dx + CASTLE_AT.item.x, CASTLE_AT.icon.y + CASTLE_AT.item.y);
      });
      if (v.cursor < v.mons.length) this.sprite(sheet, CASTLE_ANIM.monCursor, t, CASTLE_AT.cursor.x + SLOT * v.cursor, CASTLE_AT.cursor.y, box({ ...CASTLE_TAPS.slot, x: CASTLE_TAPS.slot.x + SLOT * v.cursor }));
      else if (v.panel === 'main') this.sprite(sheet, CASTLE_ANIM.exitCursor, t, CASTLE_AT.exit.x, CASTLE_AT.exit.y, box(CASTLE_TAPS.exit));
    }
    if (v.sparkle && sheet) this.cell(sheet, animCell(sheet, v.sparkle.anim, v.sparkle.tick), v.sparkle.x, v.sparkle.y);
  }

  protected boxesKey(v: CastleView): unknown {
    // The sparkles are the canvas's alone.
    return { ...v, sparkle: undefined };
  }

  /** The level mark (the game language's) and number at x, the gender symbol at `gender` (decomp PrintMonLevelAndGender). */
  private level(d: DrawContext, m: CastleMonView, x: number, gender: number, y: number): HTMLElement[] {
    const mark = levelMark(dexOf(d.registries).language);
    const parts = [line(d, mark, x, y), line(d, String(m.level), x + 16, y)];
    if (m.gender !== 'none') parts.push(line(d, m.gender === 'male' ? '♂' : '♀', gender, y, m.gender));
    return parts;
  }

  /** The HP as current (right-aligned to 24), slash, maximum (from 32) (decomp PrintMonHP). */
  private hp(d: DrawContext, m: CastleMonView, x: number, y: number): HTMLElement[] {
    return [line(d, String(m.hp), x + 24, y, 'ink', 'right'), line(d, '/', x + 24, y), line(d, String(m.maxHp), x + 32, y)];
  }

  protected drawBoxes(d: DrawContext, v: CastleView): HTMLElement[] {
    const parts: HTMLElement[] = [];
    const exit = v.mons.length;
    const playerInk: Palette = d.gender === 'female' ? 'female' : 'male';
    const tap = (id: string, label: string, r: Rect, cursor = false) => {
      const b = stop(d, id, [], 'frontier-tap', cursor);
      b.setAttribute('aria-label', label);
      place(b, r);
      parts.push(b);
    };
    if (v.panel === 'items') {
      const it = v.items!;
      const m = v.mons[it.mon]!;
      const info = framed(d, 'frontier-window');
      place(info, CASTLE_WINDOWS.playerInfo);
      parts.push(info, line(d, v.playerName, CASTLE_TEXT.info.x + 1, CASTLE_TEXT.info.y + 1, playerInk), line(d, it.cpLine, CASTLE_TEXT.info.x + 16, CASTLE_TEXT.info.y + 16));
      parts.push(...this.level(d, m, CASTLE_TEXT.monLevel.x, CASTLE_TEXT.monLevel.gender, CASTLE_TEXT.monLevel.y), ...this.hp(d, m, CASTLE_TEXT.monHp.x, CASTLE_TEXT.monHp.y));
      const L = CASTLE_TEXT.list;
      it.entries.slice(it.top, it.top + L.rows).forEach((e, r) => {
        const i = it.top + r;
        const row = stop(d, `item:${i}`, [el('span', 'frontier-row-name', d.text(e.name)), el('span', 'frontier-row-cp', d.text(e.cp))], 'frontier-row', it.cursor === i);
        place(row, { x: L.x, y: L.y + 16 * r, w: L.w, h: 16 });
        parts.push(row);
      });
      if (it.item) parts.push(line(d, it.entries[it.cursor]!.name, CASTLE_TEXT.itemName.x, CASTLE_TEXT.itemName.y));
    } else {
      const hd = CASTLE_TEXT.header;
      parts.push(line(d, v.playerName, hd.x + hd.name, hd.y, playerInk), line(d, v.cp, hd.x + hd.cp, hd.y, 'ink', 'right'));
      v.mons.forEach((m, i) => {
        const dx = SLOT * i;
        parts.push(...this.level(d, m, CASTLE_TEXT.levels.x + dx, CASTLE_TEXT.levels.gender + dx, CASTLE_TEXT.levels.y));
        if (!m.hidden) parts.push(...this.hp(d, m, CASTLE_TEXT.hp.x + dx, CASTLE_TEXT.hp.y));
      });
      if (v.panel === 'main') parts.push(line(d, v.exit, CASTLE_TEXT.exit.x, CASTLE_TEXT.exit.y, 'ink', 'centre'));
      else {
        const P = CASTLE_TEXT.panel;
        for (const l of v.lines ?? []) parts.push(line(d, l.text, P.x + l.x, P.y + l.y, 'ink', l.align));
        // The panel's taps: the side strips page through the Pokémon (left, right), the body goes back (A, B).
        tap('page:-1', words.aria.previousMon, CASTLE_TAPS.pageLeft);
        tap('page:1', words.aria.nextMon, CASTLE_TAPS.pageRight);
        tap('next', words.aria.back, CASTLE_TAPS.panel);
      }
    }
    // Choosing a Pokémon or EXIT (taps `mon:<i>`, `exit`).
    if (v.panel === 'main' && !v.menu && !v.message && !v.yesNo && !v.sparkle) {
      v.mons.forEach((m, i) => tap(`mon:${i}`, m.hidden ? `Poké Ball ${i + 1}` : `Pokémon ${i + 1}, level ${m.level}`, { ...CASTLE_TAPS.slot, x: CASTLE_TAPS.slot.x + SLOT * i }, v.cursor === i));
      tap('exit', v.exit, CASTLE_TAPS.exit, v.cursor === exit);
    }
    if (v.hint) {
      const box = messageBox(d, v.hint, false);
      box.classList.add('ds-scene-message');
      place(box, v.menu?.window === 'options' ? CASTLE_WINDOWS.hint : CASTLE_WINDOWS.prompt);
      parts.push(box);
    }
    if (v.message) {
      const box = messageBox(d, v.message, !v.menu && !v.yesNo && !v.sparkle);
      box.classList.add('ds-scene-message');
      place(box, CASTLE_WINDOWS.message);
      parts.push(box);
    }
    if (v.menu) {
      const r = CASTLE_MENUS[v.mode][v.menu.window];
      if (!r) throw new Error(`ui: the Castle's ${v.mode} app has no ${v.menu.window} menu`);
      // Decomp: entries out of reach print in the grey colour.
      const w = framed(d, 'frontier-menu', ...v.menu.entries.map((e, i) => stop(d, `entry:${i}`, [d.text(e.label, e.enabled ? 'ink' : 'muted')], 'choice', v.menu!.cursor === i)));
      place(w, r);
      parts.push(w);
    }
    if (v.yesNo) {
      const yn = framed(d, 'yes-no ds-scene-yes-no', stop(d, 'answer:0', [d.text(v.yesNo.yes)], 'choice', v.yesNo.cursor === 0), stop(d, 'answer:1', [d.text(v.yesNo.no)], 'choice', v.yesNo.cursor === 1));
      place(yn, CASTLE_WINDOWS.yesNo);
      parts.push(yn);
    }
    return parts;
  }
}

/**
 * Decomp battle_arcade/main.c: tile i's centre (68 + 40 (i % 4), 36 + 40 (i / 4)), the cursor's the same; the icons at
 * x 16 (the player's) and 238 (the opponent's), y 46 + 40i, their held-item marks at x 24 and 246, y 50 + 40i.
 */
const ARCADE_AT = { tile: { x: 68, y: 36, step: 40 }, icon: { player: 16, opponent: 238, y: 46, step: 40 }, item: { player: 24, opponent: 246, y: 50 } };
/** Decomp ANIM_ID_CURSOR. */
const ARCADE_CURSOR_ANIM = 35;
/**
 * The STOP button (the DS touch screen's sprite at its centre, 128, 96) at half size in the free corner under the
 * opponent's icons, clear of the panels (their right edge is x 204): the round button (the 96-px plate's 48 px) centred
 * at (232, 168), in the screen's corner; its art drawn on the screen's corner box (192, 120)–(256, 192) (the pressed
 * ring's widest cell, 124 × 140 art px, is 62 × 70 here: its outer glow past the screen's edge is cut).
 */
const ARCADE_STOP = { x: 232, y: 168, r: 24, art: { x: 192, y: 120, w: 64, h: 72 } };

class ArcadeScene extends FrontierScene<ArcadeView> {
  private readonly button = document.createElement('canvas');
  /** The STOP button's state and the tick it took it (its pressed animation runs from there). */
  private buttonState = { state: -1, since: 0 };

  constructor(art: Art) {
    super(art, 'arcade-app', words.aria.arcade);
    this.button.className = 'frontier-stop-art';
    this.button.setAttribute('aria-hidden', 'true');
  }

  protected paint(d: DrawContext, v: ArcadeView): void {
    const art = newGameRecord(d.registries).frontier?.arcade.art ?? null;
    const g = this.g;
    const t = animTicks();
    if (art) this.cell(this.sheetOf(d, v.board === 'initial' ? art.initial : art.roulette), 0, 0, 0);
    else {
      g.fillStyle = '#181818';
      g.fillRect(0, 0, 128, H);
      g.fillStyle = '#c01818';
      g.fillRect(128, 0, 128, H);
      g.fillStyle = v.board === 'initial' ? '#d8e8c8' : '#282838';
      g.fillRect(40, 8, 176, 180);
    }
    const sheet = art ? this.sheetOf(d, art.sprites) : undefined;
    const A = ARCADE_AT.tile;
    v.tiles.forEach((tile, i) => {
      if (!tile.visible) return;
      const x = A.x + A.step * (i % 4);
      const y = A.y + A.step * Math.floor(i / 4);
      if (sheet) this.cell(sheet, animCell(sheet, tile.anim, t), x, y);
      else {
        g.fillStyle = `hsl(${tile.anim * 11} 60% 55%)`;
        g.fillRect(x - 16, y - 16, 32, 32);
      }
    });
    if (v.cursor !== null) {
      const x = A.x + A.step * (v.cursor % 4);
      const y = A.y + A.step * Math.floor(v.cursor / 4);
      if (sheet) this.cell(sheet, animCell(sheet, ARCADE_CURSOR_ANIM, t), x, y);
      else {
        g.strokeStyle = '#f8f800';
        g.lineWidth = 2;
        g.strokeRect(x - 19, y - 19, 38, 38);
      }
    }
    // Decomp: the icons hold their first frame (BattleArcadeAppSprite_SetAnimateFlag FALSE).
    const I = ARCADE_AT.icon;
    const columns = [
      { mons: v.player, x: I.player, item: ARCADE_AT.item.player },
      { mons: v.opponents, x: I.opponent, item: ARCADE_AT.item.opponent },
    ];
    for (const c of columns)
      c.mons.forEach((m, i) => {
        this.icon(d, m.species, m.form, 0, c.x, I.y + I.step * i);
        if (m.item) this.heldMark(d, c.item, ARCADE_AT.item.y + I.step * i);
      });
    this.paintButton(d, v, t);
  }

  private paintButton(d: DrawContext, v: ArcadeView, t: number): void {
    if (v.button !== this.buttonState.state) this.buttonState = { state: v.button, since: t };
    const art = newGameRecord(d.registries).frontier?.arcade.art ?? null;
    const g = this.button.getContext('2d')!;
    g.clearRect(0, 0, this.button.width, this.button.height);
    if (!art) return;
    const sheet = this.sheetOf(d, art.button);
    const img = sheet ? this.image(sheet.atlas) : null;
    const c = sheet?.cells[animCell(sheet, v.button, t - this.buttonState.since)];
    if (!img || !c) return;
    // n device pixels per art pixel (half a DS pixel).
    const S = ARCADE_STOP;
    const n = this.button.width / (2 * S.art.w);
    g.imageSmoothingEnabled = false;
    g.drawImage(img, c.x, c.y, c.w, c.h, (2 * (S.x - S.art.x) - c.ox) * n, (2 * (S.y - S.art.y) - c.oy) * n, c.w * n, c.h * n);
  }

  protected boxesKey(v: ArcadeView): unknown {
    return v.button;
  }

  protected drawBoxes(d: DrawContext, v: ArcadeView): HTMLElement[] {
    const S = ARCADE_STOP;
    // Half the art's size: whole device pixels per art pixel.
    const n = Math.max(1, Math.round((d.scale * (devicePixelRatio || 1)) / 2));
    if (this.button.width !== 2 * S.art.w * n) {
      this.button.width = 2 * S.art.w * n;
      this.button.height = 2 * S.art.h * n;
      this.paintButton(d, v, animTicks());
    }
    place(this.button, S.art);
    const art = newGameRecord(d.registries).frontier?.arcade.art ?? null;
    // The touch screen's STOP (tap `stop`; A stops the board too).
    const b = stop(d, 'stop', [], `frontier-stop${art ? '' : ' is-flat'}`, false);
    b.setAttribute('aria-label', words.aria.stop);
    b.dataset.state = String(v.button);
    b.disabled = v.button !== 0;
    place(b, { x: S.x - S.r, y: S.y - S.r, w: 2 * S.r, h: 2 * S.r });
    return [this.button, b];
  }
}

const factoryScenes = new WeakMap<Art, FactoryScene>();
const hallScenes = new WeakMap<Art, HallBoardScene>();
const castleScenes = new WeakMap<Art, CastleScene>();
const arcadeScenes = new WeakMap<Art, ArcadeScene>();

export function castleApp(d: DrawContext, v: CastleView): HTMLElement {
  let s = castleScenes.get(d.art);
  if (!s || !s.root.isConnected) castleScenes.set(d.art, (s = new CastleScene(d.art)));
  s.draw(d, v);
  return s.root;
}

export function arcadeApp(d: DrawContext, v: ArcadeView): HTMLElement {
  let s = arcadeScenes.get(d.art);
  if (!s || !s.root.isConnected) arcadeScenes.set(d.art, (s = new ArcadeScene(d.art)));
  s.draw(d, v);
  return s.root;
}

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

const recordsScenes = new WeakMap<Art, DsScene>();

/**
 * The record viewer (contracts `FrontierRecordsView`; decomp frontier/records/main.c): BG2 the records art, the lines in
 * the system font aligned as PrintMessage does, the brightness fade; a tap anywhere is A.
 */
export function frontierRecords(d: DrawContext, v: FrontierRecordsView): HTMLElement {
  let scene = recordsScenes.get(d.art);
  if (!scene || !scene.root.isConnected) recordsScenes.set(d.art, (scene = new DsScene(d.art, 'frontier-records', words.aria.records)));
  const s = scene;
  s.redraw = () => frontierRecords(d, v);
  layoutScene(d, s.root, s.stage);
  const g = s.g;
  g.imageSmoothingEnabled = false;
  const bg = v.bg ? s.image(v.bg) : null;
  const cell = bg?.cells[0];
  if (bg && cell) g.drawImage(bg.img, cell.x, cell.y, W, H, 0, 0, W, H);
  else {
    g.fillStyle = '#88b8e8';
    g.fillRect(0, 0, W, H);
  }
  const x = (l: FrontierRecordsView['lines'][number]) => (l.align === 'centre' ? l.x - Math.floor((d.measure(l.text) + 1) / 2) : l.align === 'right' ? l.x - d.measure(l.text) : l.x);
  if (d.paint) for (const l of v.lines) d.paint(g, l.text, 'ink', x(l), l.y);
  s.fade(v.black);
  const key = JSON.stringify(v.lines);
  if (key !== s.boxesKey) {
    s.boxesKey = key;
    const text = el('div', 'sr-only');
    text.textContent = v.lines.map((l) => l.text.trim()).join('. ');
    const back = el('button', 'diploma-next');
    back.type = 'button';
    back.tabIndex = -1;
    back.dataset.tap = 'back';
    back.setAttribute('aria-label', words.aria.close);
    back.addEventListener('click', () => d.tap('back'));
    place(back, { x: 0, y: 0, w: W, h: H });
    s.boxes.replaceChildren(text, back);
  }
  return s.root;
}
