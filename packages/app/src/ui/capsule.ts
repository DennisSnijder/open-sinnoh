/**
 * The Ball Capsule editor (contracts `CapsuleEditorView`; packages/menus capsule-editor.ts owns the state): one canvas
 * board from the ROM's art (importer ui2d/seals.ts), with the ROM font and frames over it. The DS's two screens are
 * folded into one composition: the board is the screen the player works on (the capsule grid, the editor, or the
 * Test's still), and a strip under it, in the art's own bottom colour, carries the message box the DS shows on the other
 * screen (the prompts, the seal name while one is held, the refusals).
 * - select: `capsule/main2`, the 12 capsules (`capsule/capsules` animation 0 empty, 1 sealed) with their holders' icons,
 *   the cursor (`capsule/cursor` 0) and SHIFT's second cursor (1), the capsule menu. A tap on a capsule sends
 *   `capsule:<i>`.
 * - edit: `capsule/sub3` with the list's seals and loose counts, the page arrows, Test, CONFIRM and CANCEL (their
 *   pressed frame), the corner arrows round the capsule, the placed seals (translucent while held off the circle) and the
 *   keys' hand (`box/cursor`). The stylus is the pointer: `seal:<x>,<y>` while it is down, `seal-up` when it lifts.
 * - test: `capsule/main3`, the Pokémon's front picture and the seals around it.
 */
import type { CapsuleEditorView, Ui2dSheet } from '@opensinnoh/contracts';
import { capsuleGridAt } from '@opensinnoh/contracts';
import { CAPSULE_BUTTONS, listSlotAt } from '@opensinnoh/menus';
import type { Id } from '@opensinnoh/core';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { ICON_ANIM } from './art.ts';
import { at, atTiles, board, boardContext, DS_HEIGHT, DS_WIDTH } from './board.ts';
import { el } from './core.ts';
import './capsule.css';

const W = DS_WIDTH;
/** The DS screen and the message strip under it (six tiles: a two-line message box). */
const STRIP = 48;
const H = DS_HEIGHT + STRIP;
const MESSAGE_TILES = [1, 24, 30, 6] as const;
/** The capsule menu (decomp: a window 9 tiles wide at tile 21, top 13 with three entries, 11 with four), frame included. */
const menuTiles = (rows: number) => [20, (rows === 4 ? 11 : 13) - 1, 11, rows * 2 + 2] as const;
/** The cancel prompt's touch YES/NO (decomp tile (25, 6)), frame included. */
const YES_NO_TILES = [24, 5, 7, 6] as const;
/** A grid cell's touch target around each capsule (the grid's spacing). */
const CELL = { w: 56, h: 53 };
/** The loose counts' windows (decomp: 4 × 2 tiles at tile (3 or 10, 2 + 3·row)). */
const countAt = (i: number) => ({ x: (i % 2 ? 10 : 3) * 8, y: (2 + 3 * Math.floor(i / 2)) * 8 });
/** CapsuleGraphics_InitSelectionIndicator: the corner arrows' places and flips (bit 0 horizontal, bit 1 vertical). */
const ARROWS = [
  [136, 16, 1],
  [136, 128, 3],
  [240, 16, 0],
  [240, 128, 2],
] as const;
/** The holder's icon: (−16, +12) from its capsule. */
const HOLDER = { x: -16, y: 12 };
/** The Test's Pokémon (CAPSULE_MON_SPRITE_X / _Y_BASE). */
const TEST_MON = { x: 192, y: 48 };

type Img = HTMLImageElement;

class CapsuleCanvas {
  readonly root: HTMLElement;
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'capsule-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private boxesKey = '';
  private last: { d: DrawContext; redraw: () => void; editing: boolean } | null = null;
  private pointer: number | null = null;

  constructor(private readonly art: Art) {
    this.root = board('mart mart-board capsule-board', W, H);
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'capsule-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.root.append(at(this.canvas, 0, 0, W, H), at(this.boxes, 0, 0, W, H));
    // The stylus (decomp TouchScreen_GetHoldState) on the editor: down and moving send the DS point, up lifts it.
    const point = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return `seal:${Math.floor(((e.clientX - r.left) / r.width) * W)},${Math.floor(((e.clientY - r.top) / r.height) * H)}`;
    };
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.last?.editing || (e.target as HTMLElement).closest('.msg-box, .yes-no')) return;
      e.preventDefault();
      this.root.setPointerCapture(e.pointerId);
      this.pointer = e.pointerId;
      this.last.d.tap(point(e));
    });
    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointer && this.last) this.last.d.tap(point(e));
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer || !this.last) return;
      this.pointer = null;
      this.last.d.tap('seal-up');
    };
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
  }

  begin(d: DrawContext, redraw: () => void, editing: boolean): CanvasRenderingContext2D {
    this.last = { d, redraw, editing };
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    return g;
  }

  private image(ref: Id): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.last.redraw();
    });
    return null;
  }

  sheet(path: string): Ui2dSheet | undefined {
    return this.art.sheet(path);
  }

  /** A BG picture at (0, 0), its bottom row stretched down the message strip. */
  background(path: string): void {
    const sheet = this.art.sheet(path);
    const c = sheet?.cells[0];
    const img = sheet && c ? this.image(sheet.atlas) : null;
    if (!img || !c) return;
    this.g.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    this.g.drawImage(img, c.x, c.y + c.h - 1, c.w, 1, 0, c.h, c.w, H - c.h);
  }

  /** Cell `cell` of a sheet with its origin at (x, y), flipped (bit 0 horizontal, bit 1 vertical), at `alpha`. */
  cell(path: string, cell: number, x: number, y: number, flip = 0, alpha = 1): void {
    const sheet = this.art.sheet(path);
    const c = sheet?.cells[cell];
    const img = sheet && c ? this.image(sheet.atlas) : null;
    if (!img || !c) return;
    const g = this.g;
    g.save();
    g.globalAlpha = alpha;
    g.translate(Math.round(x), Math.round(y));
    g.scale(flip & 1 ? -1 : 1, flip & 2 ? -1 : 1);
    g.drawImage(img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
    g.restore();
  }

  /** The first frame's cell of a sheet's animation `anim` (frame `frame` of it when given). */
  anim(path: string, anim: number, x: number, y: number, frame = 0): void {
    const a = this.art.sheet(path)?.animations?.[anim];
    const f = a?.frames[Math.min(frame, a.frames.length - 1)];
    if (f) this.cell(path, f.cell, x, y);
  }

  /** A Pokémon's front picture (frame 0) centred at (x, y + its offset). */
  mon(d: DrawContext, m: NonNullable<CapsuleEditorView['test']>, x: number, y: number): void {
    const f = d.registries.pokemonSprites.get(m.species)?.forms[m.form] ?? d.registries.pokemonSprites.get(m.species)?.forms[0];
    if (!f) return;
    const face = (m.female && f.frontFemale) || f.front;
    const img = this.image(m.shiny ? f.shinyAtlas : f.atlas);
    if (img) this.g.drawImage(img, 0, face.y, 80, 80, x - 40, y - 40 + face.yOffset, 80, 80);
  }

  /** Replaces the overlay's windows when their content changed. */
  windows(key: string, build: () => HTMLElement[]): void {
    if (key === this.boxesKey) return;
    this.boxesKey = key;
    this.boxes.replaceChildren(...build());
  }
}

const scenes = new WeakMap<Art, CapsuleCanvas>();

export function capsuleEditor(wide: DrawContext, v: CapsuleEditorView): HTMLElement {
  const d = boardContext(wide);
  let s = scenes.get(d.art);
  if (!s || !s.root.isConnected) scenes.set(d.art, (s = new CapsuleCanvas(d.art)));
  const scene = s;
  const draw = () => drawEditor(scene, d, v);
  draw();
  return scene.root;
}

function drawEditor(s: CapsuleCanvas, d: DrawContext, v: CapsuleEditorView): void {
  const g = s.begin(d, () => drawEditor(s, d, v), v.screen === 'edit');
  s.root.dataset.phase = v.screen;
  const windows: (() => HTMLElement)[] = [];
  const keys: unknown[] = [v.screen, v.message, v.menu, v.yesNo, d.frame, d.unit];
  if (v.screen === 'select') {
    s.background('capsule/main2');
    s.root.dataset.backdrop = s.sheet('capsule/main2')?.atlas ?? '';
    v.capsules.forEach((c, i) => {
      const p = capsuleGridAt(i);
      s.anim('capsule/capsules', c.sealed ? 1 : 0, p.x, p.y);
    });
    s.anim('capsule/cursor', 0, capsuleGridAt(v.cursor).x, capsuleGridAt(v.cursor).y);
    if (v.shift !== null) s.anim('capsule/cursor', 1, capsuleGridAt(v.shift).x, capsuleGridAt(v.shift).y);
    keys.push(v.capsules, v.cursor, v.shift);
    windows.push(...v.capsules.map((c, i) => () => capsuleCell(d, c, i, v.cursor === i)));
    if (v.menu) {
      const m = v.menu;
      windows.push(() => atTiles(framed(d, 'capsule-menu', ...m.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'menu-entry', i === m.cursor))), ...menuTiles(m.entries.length)));
    }
  } else if (v.screen === 'edit') {
    s.background('capsule/sub3');
    s.root.dataset.backdrop = s.sheet('capsule/sub3')?.atlas ?? '';
    v.list.forEach((l, i) => s.cell('capsule/seals', l.cell, listSlotAt(i).x, listSlotAt(i).y));
    const pressed = (id: CapsuleEditorView['pressed']) => (v.pressed === id ? 1 : 0);
    const at0 = (id: string) => CAPSULE_BUTTONS.find((b) => b.id === id)!;
    s.anim('capsule/page_up', 0, at0('page-up').x, at0('page-up').y, pressed('page-up'));
    s.anim('capsule/page_down', 0, at0('page-down').x, at0('page-down').y, pressed('page-down'));
    s.anim('capsule/test', 0, at0('test').x, at0('test').y, pressed('test'));
    s.anim('capsule/button', 0, at0('confirm').x, at0('confirm').y, pressed('confirm'));
    s.anim('capsule/button', 0, at0('cancel').x, at0('cancel').y, pressed('cancel'));
    for (const [x, y, flip] of ARROWS) s.cell('capsule/arrows', 0, x, y, flip);
    for (const seal of v.seals) s.cell('capsule/seals', seal.cell, seal.x, seal.y, 0, seal.ghost ? 0.5 : 1);
    if (v.hand) s.anim('box/cursor', v.hand.grabbing ? 2 : 0, v.hand.x, v.hand.y);
    keys.push(v.list, v.pressed, v.buttons, v.status);
    windows.push(...v.list.map((l, i) => () => at(el('div', 'capsule-count', d.text(l.count, 'ink')), countAt(i).x, countAt(i).y, 32, 16)));
    const label = (id: 'confirm' | 'cancel', text: string) => () => {
      const b = at0(id);
      const down = v.pressed === id ? 1 : 0;
      return at(el('div', 'capsule-button-label', d.text(text, 'light')), b.x - 28, b.y - 8 + down, 56, 16);
    };
    windows.push(label('confirm', v.buttons.confirm), label('cancel', v.buttons.cancel));
    if (v.yesNo) {
      const q = v.yesNo;
      windows.push(() => atTiles(framed(d, 'yes-no', stop(d, 'yes', [d.text(q.yes)], 'choice', q.cursor === 0), stop(d, 'no', [d.text(q.no)], 'choice', q.cursor === 1)), ...YES_NO_TILES));
    }
  } else {
    s.background('capsule/main3');
    s.root.dataset.backdrop = s.sheet('capsule/main3')?.atlas ?? '';
    if (v.test) s.mon(d, v.test, TEST_MON.x, TEST_MON.y);
    for (const seal of v.seals) s.cell('capsule/seals', seal.cell, seal.x, seal.y);
  }
  if (v.dim) {
    g.fillStyle = 'rgb(0 0 0 / 0.45)';
    g.fillRect(0, 0, W, DS_HEIGHT);
  }
  const line = v.message ?? (v.status ? { text: v.status, waiting: false } : null);
  if (line) windows.push(() => atTiles(messageBox(d, line.text, line.waiting), ...MESSAGE_TILES));
  s.windows(JSON.stringify(keys), () => windows.map((w) => w()));
}

/** A capsule's touch target on the grid, with its holder's party icon. */
function capsuleCell(d: DrawContext, c: CapsuleEditorView['capsules'][number], i: number, cursor: boolean): HTMLElement {
  const p = capsuleGridAt(i);
  const content: Node[] = [];
  if (c.holder) {
    const icon = at(el('span', 'capsule-holder', d.art.pokemonIcon(c.holder.species, c.holder.form, ICON_ANIM.hpMax, c.holder.egg)), CELL.w / 2 + HOLDER.x - 16, CELL.h / 2 + HOLDER.y - 16, 32, 32);
    content.push(icon);
  }
  const b = stop(d, `capsule:${i}`, content, 'capsule-cell', cursor);
  b.setAttribute('aria-label', `Capsule ${i + 1}`);
  return at(b, p.x - CELL.w / 2, p.y - CELL.h / 2, CELL.w, CELL.h);
}
