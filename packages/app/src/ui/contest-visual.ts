/**
 * The visual round's screens and the lobby's photo frames (contracts `ContestVisualRoundView`, `ContestPhotoView`;
 * packages/menus contest/visual.ts and contest/photo.ts own their state), each one 256 × 192 DS board drawn on a
 * canvas from the ROM's art (importer ui2d/contests.ts), with the ROM font and frames over it:
 * - intro: the top screen's clock (60, the rank's empty accessory dots, the theme window) and the host's messages;
 * - dress-up: the touch screen (the Fashion Case's page, the stage's backdrop, the Pokémon and the accessories, the
 *   buttons), the top screen folded into a line over it (the theme or the held accessory's name, the accessories
 *   placed of the limit, the seconds), the PC's hand for the keys. The stylus is the pointer: `dress:<x>,<y>` while it
 *   is down, `dress-up` when it lifts;
 * - judging: the stage, the curtain, the entrant's photo and its hearts, the messages;
 * - the lobby's photo: its frame and backdrop, the photo, the type's banner and its two lines.
 * Accessories draw only inside the frames' window (ov22_02255390: (10, 18) to (246, 143)).
 */
import type { ContestPhotoView, ContestPicture, ContestVisualRoundView, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { framed, messageBox, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { at, atTiles, board, boardContext, DS_HEIGHT, DS_WIDTH } from './board.ts';
import { el } from './core.ts';
import './contest.css';

const W = DS_WIDTH;
const H = DS_HEIGHT;
/** The message box's tiles, as the contest app's (contest.ts). */
const MESSAGE_TILES = [1, 18, 30, 6] as const;
/** The frames' window the accessories draw in. */
const CLIP = { x: 10, y: 18, w: 236, h: 125 };
/** The buttons' sprite places (ov22_02259DBC) and their cells in `contest/buttons` (three each: up, pressed, held). */
const BUTTON_AT = { next: [48, 144, 0], prev: [8, 144, 3], accessories: [96, 144, 6], backdrops: [136, 144, 9], done: [184, 144, 12] } as const;
/** The clock's digits and the accessory dots on the top screen (ov22_0225AB54, ov22_0225A914). */
const DIGITS = [[103, 58], [127, 58]] as const;
const dotAt = (i: number) => ({ x: 38 + 18 * (i % 10), y: 104 + 18 * Math.floor(i / 10) });

type Img = HTMLImageElement;

/** A canvas board with an overlay for the ROM-font windows; persistent per art, so the stylus keeps its capture. */
class ContestCanvas {
  readonly root: HTMLElement;
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'contest-canvas-boxes');
  private readonly shade = el('div', 'contest-canvas-fade');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private boxesKey = '';
  private last: { d: DrawContext; redraw: () => void } | null = null;
  private pointer: number | null = null;

  constructor(
    private readonly art: Art,
    className: string,
    stylus: boolean,
  ) {
    this.root = board(`mart mart-board contest-board ${className}`);
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'contest-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.root.append(at(this.canvas, 0, 0, W, H), at(this.boxes, 0, 0, W, H), at(this.shade, 0, 0, W, H));
    if (!stylus) return;
    // The stylus (decomp gSystem.touchHeld): down and moving send the DS point, up lifts it.
    const point = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return `dress:${Math.floor(((e.clientX - r.left) / r.width) * W)},${Math.floor(((e.clientY - r.top) / r.height) * H)}`;
    };
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.last || (e.target as HTMLElement).closest('.msg-box')) return;
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
      this.last.d.tap('dress-up');
    };
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
  }

  begin(d: DrawContext, redraw: () => void): CanvasRenderingContext2D {
    this.last = { d, redraw };
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    return g;
  }

  fade(level: number): void {
    this.shade.style.opacity = String(Math.max(0, Math.min(16, level)) / 16);
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

  /** Cell `cell` of a sheet with its origin at (x, y), `scale` about that origin. */
  cell(path: string, cell: number, x: number, y: number, scale = 1): void {
    const sheet = this.art.sheet(path);
    const c = sheet?.cells[cell];
    const img = sheet && c ? this.image(sheet.atlas) : null;
    if (!img || !c) return;
    const g = this.g;
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.scale(scale, scale);
    g.drawImage(img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
    g.restore();
  }

  /** The first frame's cell of a sheet's animation `anim`. */
  anim(path: string, anim: number, x: number, y: number, scale = 1): void {
    const a = this.art.sheet(path)?.animations?.[anim];
    if (a) this.cell(path, a.frames[0]!.cell, x, y, scale);
  }

  sheet(path: string): Ui2dSheet | undefined {
    return this.art.sheet(path);
  }

  /** A contest photo: the backdrop, then the accessories and the Pokémon back to front (clipped to `clip` if given). */
  picture(d: DrawContext, p: ContestPicture, clip: { x: number; y: number; w: number; h: number } | null): void {
    if (p.backdrop !== null) this.cell('contest/backdrops', p.backdrop, p.backdropX, p.backdropY);
    const g = this.g;
    g.save();
    if (clip) {
      g.beginPath();
      g.rect(clip.x, clip.y, clip.w, clip.h);
      g.clip();
    }
    p.accessories.forEach((a, i) => {
      if (i === p.monAt) this.mon(d, p.mon);
      this.cell('contest/accessories', a.accessory, a.x, a.y);
    });
    if (p.monAt >= p.accessories.length) this.mon(d, p.mon);
    g.restore();
  }

  /** The dress-up's case and stage items back to front with the Pokémon after the first `monAt`, clipped to `clip`. */
  items(d: DrawContext, v: NonNullable<ContestVisualRoundView['dress']>, clip: { x: number; y: number; w: number; h: number }): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(clip.x, clip.y, clip.w, clip.h);
    g.clip();
    v.items.forEach((i, k) => {
      if (k === v.monAt) this.mon(d, v.mon);
      this.cell(i.kind === 'accessory' ? 'contest/accessories' : 'contest/backdrop_icons', i.id, i.x, i.y);
    });
    if (v.monAt >= v.items.length) this.mon(d, v.mon);
    g.restore();
  }

  /** A Pokémon's front picture (frame 0) centred at (x, y). */
  mon(d: DrawContext, m: ContestPicture['mon']): void {
    const sprites = d.registries.pokemonSprites.get(m.species);
    const f = sprites?.forms[m.form] ?? sprites?.forms[0];
    if (!f) return;
    const face = (m.female && f.frontFemale) || f.front;
    const img = this.image(m.shiny ? f.shinyAtlas : f.atlas);
    if (img) this.g.drawImage(img, 0, face.y, 80, 80, m.x - 40, m.y - 40, 80, 80);
  }

  /** Replaces the overlay's windows when their content changed. */
  windows(key: string, build: () => HTMLElement[]): void {
    if (key === this.boxesKey) return;
    this.boxesKey = key;
    this.boxes.replaceChildren(...build());
  }
}

const visualScenes = new WeakMap<Art, ContestCanvas>();
const photoScenes = new WeakMap<Art, ContestCanvas>();

/** The visual round's screen (the contest app's round view). */
export function contestVisual(wide: DrawContext, v: ContestVisualRoundView): HTMLElement {
  const d = boardContext(wide);
  let s = visualScenes.get(d.art);
  if (!s || !s.root.isConnected) visualScenes.set(d.art, (s = new ContestCanvas(d.art, 'contest-visual', true)));
  const scene = s;
  const draw = () => drawVisual(scene, d, v);
  draw();
  return scene.root;
}

function drawVisual(s: ContestCanvas, d: DrawContext, v: ContestVisualRoundView): void {
  s.begin(d, () => drawVisual(s, d, v));
  s.root.dataset.phase = v.phase;
  const windows: (() => HTMLElement)[] = [];
  const keys: unknown[] = [v.phase, v.message, d.frame, d.unit];
  if (v.intro) {
    s.cell('contest/clock_bg', 0, 0, 0);
    const digits = String(v.intro.seconds).padStart(2, '0');
    DIGITS.forEach(([x, y], i) => s.anim('contest/digits', Number(digits[i]), x, y));
    for (let i = 0; i < v.intro.limit; i++) s.anim('contest/dots', 1, dotAt(i).x, dotAt(i).y);
  }
  const dv = v.dress;
  if (dv) {
    s.cell('contest/dress_bg', 0, 0, 0);
    s.cell('contest/case_bg', dv.pageBg, 8, 16);
    s.cell('contest/backdrops', dv.backdrop, 136, 16);
    s.items(d, dv, CLIP);
    const [nx, ny, nc] = BUTTON_AT.next;
    s.cell('contest/buttons', nc + (dv.pressed === 'case-next' ? 1 : 0), nx, ny);
    const [px, py, pc] = BUTTON_AT.prev;
    s.cell('contest/buttons', pc + (dv.pressed === 'case-prev' ? 1 : 0), px, py);
    const [ax, ay, ac] = BUTTON_AT.accessories;
    s.cell('contest/buttons', ac + (dv.tab === 'accessories' ? 2 : 0), ax, ay);
    const [bx, by, bc] = BUTTON_AT.backdrops;
    s.cell('contest/buttons', bc + (dv.tab === 'backdrops' ? 2 : 0), bx, by);
    const [dx, dy, dc] = BUTTON_AT.done;
    s.cell('contest/buttons', dc + (dv.pressed === 'done' ? 1 : 0), dx, dy);
    if (dv.cursor) s.anim('box/cursor', dv.cursor.grabbing ? 2 : 0, dv.cursor.x, dv.cursor.y);
    keys.push(dv.theme, dv.status, dv.seconds, dv.hurry, dv.pulse, dv.placed, dv.limit, dv.pressed === 'done');
    windows.push(() => {
      const line = el('div', 'contest-dress-line', d.text(dv.status ?? dv.theme, 'light'));
      return at(line, 4, 1, 152, 14);
    });
    windows.push(() => {
      const right = el('div', `contest-dress-clock${dv.hurry ? ' is-hurry' : ''}`, d.text(`${dv.placed}/${dv.limit}`, 'light'), d.text(String(dv.seconds).padStart(2, '0'), dv.hurry ? 'chosen' : 'light'));
      if (dv.pulse !== 1) right.style.setProperty('--pulse', String(dv.pulse));
      return at(right, 196, 1, 56, 14);
    });
    windows.push(() => at(el('div', `contest-done-label${dv.pressed === 'done' ? ' is-pressed' : ''}`, d.text(doneLabel(d), 'ink')), 184, dv.pressed === 'done' ? 159 : 163, 72, 16));
  }
  const sv = v.scoring;
  if (sv) {
    s.cell('contest/judging_stage', 0, 0, 0);
    if (sv.curtain) s.cell('contest/judging_curtain', 0, 0, 0);
    if (sv.picture) s.picture(d, sv.picture, { x: 0, y: 0, w: 256, h: 136 });
    for (const h of sv.hearts) s.cell('contest/hearts', h.kind === 'condition' ? 0 : 1, h.x, h.y);
  }
  if (v.intro) {
    keys.push(v.intro.limit, v.intro.theme);
    windows.push(() => {
      const theme = framed(d, 'contest-theme', d.text(v.intro!.theme, 'ink'));
      // The window (2, 1) 27 × 2 in its frame, a tile around it.
      return atTiles(theme, 1, 0, 29, 4);
    });
  }
  if (v.message) {
    const m = v.message;
    windows.push(() => atTiles(messageBox(d, m.text, m.waiting), ...MESSAGE_TILES));
  }
  s.windows(JSON.stringify(keys), () => windows.map((w) => w()));
  s.fade(v.fade);
}

/** "DONE!" (bank 385 message 0) for the button. */
function doneLabel(d: DrawContext): string {
  return d.registries.texts.get(textId(d, 'pl_msg_00000385_00000'))?.text ?? '';
}
const textId = (d: DrawContext, name: string): Id => `${[...d.registries.newGame.keys()][0]!.split(':')[0]}:${name}` as Id;

/** The lobby's photo frame (the photo viewer app). */
export function contestPhoto(wide: DrawContext, v: ContestPhotoView): HTMLElement {
  const d = boardContext(wide);
  let s = photoScenes.get(d.art);
  if (!s || !s.root.isConnected) photoScenes.set(d.art, (s = new ContestCanvas(d.art, 'contest-photo', false)));
  const scene = s;
  const draw = () => {
    scene.begin(d, draw);
    scene.cell('contest/photo_bg', 0, 0, 0);
    scene.picture(d, v.picture, { x: v.picture.backdropX, y: v.picture.backdropY, w: 112, h: 129 });
    scene.anim('contest/photo_banner', v.type, 0, 144);
    scene.windows(JSON.stringify([v.lines, d.unit]), () => [
      at(el('div', 'contest-photo-line', d.text(v.lines[0], 'ink')), 0, 151, 256, 16),
      at(el('div', 'contest-photo-line', d.text(v.lines[1], 'ink')), 0, 171, 256, 16),
    ]);
    scene.fade(0);
  };
  draw();
  scene.root.dataset.tap = 'next';
  scene.root.onclick = () => d.tap('next');
  return scene.root;
}
