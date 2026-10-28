/**
 * The Dance Competition (contracts `ContestDanceRoundView`; packages/menus contest/dance.ts owns its state and timing).
 * One composition: the stage (the DS top screen) on a canvas at a whole-pixel scale, and while the round takes steps
 * the step buttons (the touch screen's content) as a card beside it on wide rooms or under it on tall ones. The card's
 * place is kept for the whole round, so the stage never moves when it comes and goes.
 *
 * The stage: the ROM's backdrop and timeline (`contest_dance/stage{v}`, `timeline{v}_*`), the step colour's tint, the
 * dancers (their outfits' accessories and front pictures, scaled by depth, turned, greyed), their shadows, hearts, notes,
 * the beat ball, the cursor, the player's arrow, the grades with their words; the MC's message box and the instruction
 * banner at the DS windows.
 * A button is pressed on pointer down (the DS reads a new touch), sending `step:<dir>`.
 */
import { newGameRecord, type ContestDanceRoundView, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { messageBox, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { at, board, boardContext, DS_HEIGHT, DS_WIDTH } from './board.ts';
import { el } from './core.ts';
import { MESSAGE, place, sceneContext } from './evolution.ts';
import './evolution.css';
import './contest-dance.css';
import { S } from '../strings/index.ts';

type Img = HTMLImageElement;
const W = DS_WIDTH;
const H = DS_HEIGHT;
/** ov17_0223E380: the banner's window (tiles 2, 11, 27 × 2). */
const BANNER = { x: 16, y: 88, w: 216, h: 16 };
/** ov17_0224A214: the timeline's tile row. */
const TIMELINE_Y = 19 * 8;
/** ov17_022498F4: the button labels' centres (UP, FRONT, LEFT, RIGHT) on the touch screen. */
const LABELS: [number, number][] = [
  [128, 24],
  [128, 120],
  [48, 64],
  [208, 64],
];
/** ov22_0225B198's grey (0x254a) as a multiplier, and the touch screen's dim (ov17_0224A0E0: 6/16 toward black). */
const GREY = [10 / 31, 10 / 31, 9 / 31];
const DIM = 6 / 16;
const DIRECTIONS = ['Up', 'Front', 'Left', 'Right'];
/** A dancer's composition canvas, its centre in the middle: room for the photo's accessories around the Pokémon. */
const OUTFIT = 256;

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

const rgb = (c: number) => `rgb(${((c & 31) * 255) / 31} ${(((c >> 5) & 31) * 255) / 31} ${(((c >> 10) & 31) * 255) / 31})`;

class DanceScene {
  readonly root = el('section', 'ds-scene contest-dance-scene');
  private readonly room = el('div', 'dance-room');
  private readonly stage = el('div', 'ds-scene-stage dance-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly pad = el('div', 'dance-pad');
  private readonly g: CanvasRenderingContext2D;
  private readonly scratch = document.createElement('canvas');
  private readonly mask = document.createElement('canvas');
  private readonly images = new Map<string, Img | null>();
  private boxKey = '';
  private padKey = '';
  private padParts: { picture: HTMLElement; labels: HTMLElement[]; dim: HTMLElement; path: string } | null = null;
  private last: { d: DrawContext; v: ContestDanceRoundView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    for (const c of [this.scratch, this.mask]) {
      c.width = OUTFIT;
      c.height = OUTFIT;
    }
    this.stage.append(this.canvas, this.boxes);
    this.room.append(this.stage, this.pad);
    this.root.append(this.room);
    this.root.setAttribute('aria-label', S.aria.dance);
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

  /** The whole-pixel scale that fits the stage and the card side by side or stacked, whichever is larger. */
  private layout(d: DrawContext): number {
    const size = d.size ?? { width: innerWidth, height: innerHeight };
    const dpr = devicePixelRatio || 1;
    const fit = (w: number, h: number) => Math.max(1, Math.floor(Math.min(size.width / w, size.height / h) * dpr)) / dpr;
    const side = fit(2 * W, H);
    const stacked = fit(W, 2 * H);
    const k = Math.max(side, stacked);
    this.room.classList.toggle('stacked', stacked > side);
    for (const e of [this.stage, this.pad]) {
      e.style.setProperty('--k', `${k}px`);
      e.style.setProperty('--dot', `${k}px`);
      // The card's board lays out at the UI unit (ui.css .board): the stage's scale here.
      e.style.setProperty('--unit', `${k}px`);
      e.style.width = `${W * k}px`;
      e.style.height = `${H * k}px`;
    }
    return k;
  }

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

  /** A one-cell sheet's picture (or part of it) at (x, y). */
  private picture(path: string, x: number, y: number, width?: number): boolean {
    const sheet = this.art.sheet(path);
    const img = sheet ? this.image(sheet.atlas) : null;
    const c = sheet?.cells[0];
    if (!img || !c) return false;
    const w = Math.min(width ?? c.w, c.w);
    if (w > 0) this.g.drawImage(img, c.x, c.y, w, c.h, x, y, w, c.h);
    return true;
  }

  draw(ctx: DrawContext, v: ContestDanceRoundView): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, this.layout(ctx));
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#f8b8d8';
    g.fillRect(0, 0, W, H);
    const rom = this.picture(`contest_dance/stage${v.variant}`, 0, 0);
    this.root.classList.toggle('rom', rom);
    // ov17_0224C864: the stage (not the timeline) blends toward the last step's colour.
    if (v.tint) {
      g.globalAlpha = v.tint.level / 16;
      g.fillStyle = rgb(v.tint.color);
      g.fillRect(0, 0, W, TIMELINE_Y);
      g.globalAlpha = 1;
    }
    const tl = v.timeline;
    const width = v.variant === 0 ? 256 : 240;
    const left = (W - width) / 2;
    this.picture(`contest_dance/timeline${v.variant}_empty`, left, TIMELINE_Y);
    this.picture(`contest_dance/timeline${v.variant}_full`, left, TIMELINE_Y, tl.fill);
    if (tl.flash) {
      g.globalAlpha = tl.flash.level / 16;
      g.fillStyle = '#fff';
      g.fillRect(tl.flash.half * 128, TIMELINE_Y, 128, H - TIMELINE_Y);
      g.globalAlpha = 1;
    }
    let accessories = 0;
    for (const m of v.dancers) {
      const s = m.scale / 256;
      this.cell('contest_dance/shadow', 0, m.x, m.ground, s);
      accessories += this.dancer(d, m);
    }
    this.root.dataset.accessories = String(accessories);
    for (const h of v.hearts) this.anim('contest_dance/hearts', h.anim, 0, h.x, h.y);
    for (const n of tl.notes) this.anim(`contest_dance/note${n.code}`, n.anim, n.frame, n.x, n.y);
    if (tl.ball) this.anim('contest_dance/ball', 0, tl.ball.frame, tl.ball.x, tl.ball.y);
    if (tl.cursor !== null) this.cell('contest_dance/cursor', 0, tl.cursor, 0x16 * 8);
    if (v.arrow) this.cell('contest_dance/arrow', 0, v.arrow.x, v.arrow.y);
    for (const gr of v.grades) this.anim('contest_dance/grades', gr.grade, gr.frame, gr.x, gr.y);
    if (v.flash) {
      g.globalAlpha = v.flash / 16;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
    }
    if (v.fade) {
      g.globalAlpha = v.fade / 16;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 1;
    this.drawBoxes(d, v);
    this.drawPad(ctx, v);
  }

  /**
   * A dancer: its outfit's accessories and its front picture composed about its centre (decomp ov22_0225AFD4's dress-up
   * record), then scaled, turned and greyed as one (ov22_0225B198's colour multiplies every palette). Returns the
   * accessories drawn (their pictures loaded).
   */
  private dancer(d: DrawContext, m: ContestDanceRoundView['dancers'][number]): number {
    const pics = d.registries.pokemonSprites.get(m.species);
    const form = pics?.forms[m.form] ?? pics?.forms[0];
    const img = form ? this.image(m.shiny ? form.shinyAtlas : form.atlas) : null;
    if (!form || !img) return 0;
    const face = (m.female && form.frontFemale) || form.front;
    const sc = this.scratch.getContext('2d')!;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, OUTFIT, OUTFIT);
    const c = OUTFIT / 2;
    const mon = () => sc.drawImage(img, 0, face.y, 80, 80, c - 40, c - 40, 80, 80);
    let drawn = 0;
    m.accessories.forEach((a, i) => {
      if (i === m.monAt) mon();
      if (this.accessory(sc, a.accessory, c + a.x, c + a.y)) drawn++;
    });
    if (m.monAt >= m.accessories.length) mon();
    if (m.shade) {
      const mask = this.mask.getContext('2d')!;
      mask.clearRect(0, 0, OUTFIT, OUTFIT);
      mask.drawImage(this.scratch, 0, 0);
      const k = m.shade / 16;
      const [r, gg, b] = GREY.map((x) => Math.round(255 * (1 - k + k * x)));
      sc.globalCompositeOperation = 'multiply';
      sc.fillStyle = `rgb(${r} ${gg} ${b})`;
      sc.fillRect(0, 0, OUTFIT, OUTFIT);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(this.mask, 0, 0);
    }
    const g = this.g;
    g.save();
    g.translate(m.x, m.y);
    if (m.angle) g.rotate((m.angle * Math.PI) / 180);
    g.scale(m.scale / 256, m.scale / 256);
    g.drawImage(this.scratch, -c, -c);
    g.restore();
    return drawn;
  }

  /** An accessory's picture (`contest/accessories` cell `id`) with its top-left at (x, y); false until it has loaded. */
  private accessory(g: CanvasRenderingContext2D, id: number, x: number, y: number): boolean {
    const sheet = this.art.sheet('contest/accessories');
    const c = sheet?.cells[id];
    const img = sheet && c ? this.image(sheet.atlas) : null;
    if (!img || !c) return false;
    g.drawImage(img, c.x, c.y, c.w, c.h, x - c.ox, y - c.oy, c.w, c.h);
    return true;
  }

  private drawBoxes(d: DrawContext, v: ContestDanceRoundView): void {
    const key = JSON.stringify([v.message, v.banner, v.grades.map((gr) => [gr.x, gr.y, gr.text]), d.frame, d.scale]);
    if (key === this.boxKey) return;
    this.boxKey = key;
    const parts: HTMLElement[] = [];
    for (const gr of v.grades) {
      const t = el('div', 'dance-grade', d.text(gr.text, 'ink'));
      place(t, { x: gr.x - 40, y: gr.y - 8, w: 80, h: 16 });
      parts.push(t);
    }
    if (v.banner) {
      const b = messageBox(d, v.banner, false);
      b.classList.add('ds-scene-message', 'dance-banner');
      place(b, { x: BANNER.x - 8, y: BANNER.y - 8, w: BANNER.w + 16, h: BANNER.h + 16 });
      parts.push(b);
    }
    if (v.message) {
      const box = messageBox(d, v.message.text, v.message.waiting);
      box.classList.add('ds-scene-message');
      place(box, MESSAGE);
      parts.push(box);
    }
    this.boxes.replaceChildren(...parts);
  }

  /**
   * The step buttons: the ROM's touch screen (its press steps), the labels, a dim while no step is taken; hit areas on
   * the DS rects. Built once per scale and kept, so a touch never lands on a replaced element: each tick only swaps the
   * picture, moves the pressed label and shows or hides the dim.
   */
  private drawPad(wide: DrawContext, v: ContestDanceRoundView): void {
    const b = v.buttons;
    this.pad.classList.toggle('shown', !!b);
    if (!b) return;
    const k = parseFloat(this.pad.style.getPropertyValue('--k')) || wide.unit;
    const d = boardContext({ ...wide, unit: k });
    const buildKey = JSON.stringify([k, wide.frame, b.labels]);
    if (!this.padParts || buildKey !== this.padKey) {
      this.padKey = buildKey;
      const screen = board('dance-buttons');
      const picture = at(el('span', 'dance-pad-art'), 0, 0, W, H);
      screen.append(picture);
      const rects = newGameRecord(d.registries).contests?.dance.buttons ?? [];
      const labels = rects.map((r, dir) => {
        const hit = at(el('div', 'dance-step'), r.x, r.y, r.w, r.h);
        hit.dataset.tap = `step:${dir}`;
        hit.setAttribute('role', 'button');
        hit.setAttribute('aria-label', DIRECTIONS[dir]!);
        hit.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.last?.d.tap(`step:${dir}`);
        });
        const [x, y] = LABELS[dir]!;
        const label = at(el('span', 'dance-label', d.text(b.labels[dir]!, 'light')), x - 32, y - 8, 64, 16);
        screen.append(hit, label);
        return label;
      });
      const dim = at(el('span', 'dance-dim'), 0, 0, W, H);
      dim.style.setProperty('--dim', String(DIM));
      screen.append(dim);
      this.pad.replaceChildren(screen);
      this.padParts = { picture, labels, dim, path: '' };
    }
    const parts = this.padParts;
    const press = b.press;
    const path = press && press.step !== null ? `contest_dance/buttons${press.dir}_${press.step}` : 'contest_dance/buttons';
    if (path !== parts.path) {
      parts.path = path;
      const pic = d.art.sheet(path) ? d.art.picture(el('span', 'ds-picture dance-pad-picture'), path) : null;
      parts.picture.replaceChildren(...(pic ? [pic] : []));
      parts.picture.classList.toggle('rom', !!pic);
    }
    parts.labels.forEach((label, dir) => label.style.setProperty('--at-y', String(LABELS[dir]![1] - 8 + (press?.dir === dir ? press.label : 0))));
    parts.dim.hidden = !b.dim;
  }
}

const scenes = new WeakMap<Art, DanceScene>();

export function contestDance(d: DrawContext, v: ContestDanceRoundView): HTMLElement {
  let scene = scenes.get(d.art);
  if (!scene || !scene.root.isConnected) scenes.set(d.art, (scene = new DanceScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
