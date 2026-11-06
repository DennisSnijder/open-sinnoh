/**
 * The Game Corner's slot machine (contracts `SlotsView`; packages/menus slots.ts and services `SlotMachine` own the state
 * and timing), drawn on one canvas as one composition (no split screens): the DS's bottom screen, the moonlit field
 * with Clefairy's stage, is the backdrop at the top, and the machine (the DS's top screen) stands in front of it from
 * `MACHINE_Y` down, so the stage's floor (the Poké Ball at y 160) meets the cabinet's top. The bonus counters the DS
 * draws at the field's bottom right sit at its top right here (the cabinet covers that corner).
 * - Back to front: the field (its palette blends: the bonus colouring, a moon), the machine's backdrop, the reel
 *   symbols, the reel shading (BG2, half blended), the machine (BG1) with its lamps and stop buttons, the counters,
 *   then the stage's sprites (the ball, the sparkle, Clefairy, the Pikachu pair, the 7s, the bonus counters) and the
 *   fade.
 * - Input: the keys are the DS's buttons (the game's bindings). Touch (our addition): a reel's column stops it, and the
 *   machine's help bar ("X INSERT COINS / ✚ SPIN / START EXIT") bets, spins and quits, its three parts reaching up into
 *   the field so they are thumb-sized.
 * Packs without the art (the fixture) get plain shapes in the same places.
 */
import type { SlotsView, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { place, sceneContext } from './evolution.ts';
import './slots.css';
import { S } from '../strings/index.ts';

type Img = HTMLImageElement;
const W = 256;
/** The machine's top in the composition (the field above it is 192 tall: the cabinet covers its bottom 16 px). */
const MACHINE_Y = 176;
const H = MACHINE_Y + 192;
/** The reels' centres (ov101_021D59AC: 40 + 28 + 60 · reel). */
const REEL_X = [68, 128, 188];
/** The touch targets, in composition px: the reel columns and the help bar's three parts. */
const COLUMNS = REEL_X.map((x) => ({ x: x - 28, y: MACHINE_Y + 24, w: 56, h: 136 }));
const HELP = [
  { id: 'bet', label: () => S.aria.insertCoins, x: 0, w: 92 },
  { id: 'spin', label: () => S.aria.spin, x: 92, w: 84 },
  { id: 'quit', label: () => S.aria.exit, x: 176, w: 80 },
];
const HELP_Y = MACHINE_Y - 28;
const HELP_H = 40;

/** A frame of animation `anim` of a sheet, `frame` frames in (looping ones wrap, forward ones hold their last). */
function animCell(sheet: Ui2dSheet | undefined, anim: number, frame: number): number | null {
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

class SlotsScene {
  readonly root = el('section', 'ds-scene slots-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private boxesKey = '';
  private last: { d: DrawContext; v: SlotsView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', S.aria.slots);
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

  /** Draws a sheet's cell (index or name) with its origin at (x, y); false when the pack has no such sheet. */
  private cell(path: string, cell: number | string | null, x: number, y: number, o: { alpha?: number; scale?: number; rotation?: number; flip?: boolean } = {}): boolean {
    const sheet = this.art.sheet(path);
    if (!sheet) return false;
    const index = typeof cell === 'string' ? (sheet.names?.indexOf(cell) ?? -1) : cell;
    const c = index === null || index < 0 ? undefined : sheet.cells[index];
    const img = c ? this.image(sheet.atlas) : null;
    if (!img || !c) return true;
    const g = this.g;
    g.save();
    g.globalAlpha = o.alpha ?? 1;
    g.translate(Math.round(x), Math.round(y));
    if (o.rotation) g.rotate((o.rotation * Math.PI) / 180);
    const s = o.scale ?? 1;
    g.scale(o.flip ? -s : s, s);
    g.drawImage(img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
    g.restore();
    return true;
  }

  private anim(path: string, anim: number, frame: number, x: number, y: number, o: Parameters<SlotsScene['cell']>[4] = {}): boolean {
    return this.cell(path, animCell(this.art.sheet(path), anim, frame), x, y, o);
  }

  /** A row of digits from a digit sheet (animation n = digit n), right-aligned so its last digit is at `x`. */
  private digits(path: string, value: number, count: number, x: number, y: number, step: number, scale = 1, pad = ' '): void {
    const s = String(value).padStart(count, pad).slice(-count);
    [...s].forEach((ch, i) => {
      if (ch !== ' ') this.anim(path, Number(ch), 0, x - (count - 1 - i) * step, y, { scale });
    });
  }

  draw(ctx: DrawContext, v: SlotsView): void {
    this.last = { d: ctx, v };
    const k = layoutSlots(ctx, this.root, this.stage);
    const d = sceneContext(ctx, k);
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const rom = !!this.art.sheet('slots/machine');
    this.root.classList.toggle('rom', rom);

    // The field (BG3 sub) and its palette blends.
    this.cell('slots/backdrop', 'sub', 0, 0, { scale: 32 });
    if (!this.cell('slots/field', 'normal', 0, 0)) {
      g.fillStyle = '#284878';
      g.fillRect(0, 0, W, 192);
    }
    if (v.field.bonus) this.cell('slots/field', 'bonus', 0, 0, { alpha: v.field.bonus / 16 });
    if (v.field.moon) this.cell('slots/field', v.field.moon.kind, 0, 0, { alpha: v.field.moon.level / 16 });

    // The machine: the backdrop, the reels behind BG1, the shading, BG1 and its lamps and buttons.
    g.save();
    g.beginPath();
    g.rect(0, MACHINE_Y, W, 192);
    g.clip();
    if (!this.cell('slots/backdrop', 'main', 0, MACHINE_Y, { scale: 32 })) {
      g.fillStyle = '#f8f8f8';
      g.fillRect(0, MACHINE_Y, W, 192);
    }
    v.reels.forEach((sprites, r) => {
      for (const s of sprites) {
        if (!this.anim('slots/symbols', s.symbol, 0, REEL_X[r]!, MACHINE_Y + s.y)) {
          g.fillStyle = ['#e03030', '#4040c0', '#30a030', '#c03070', '#e0c020', '#8080a0'][s.symbol] ?? '#000';
          g.fillRect(REEL_X[r]! - 12, MACHINE_Y + s.y - 12, 24, 24);
        }
      }
    });
    this.cell('slots/shade', 0, 0, MACHINE_Y, { alpha: 0.5 });
    if (!this.cell('slots/machine', 0, 0, MACHINE_Y)) {
      g.fillStyle = '#e08020';
      g.fillRect(0, MACHINE_Y, W, 32);
      g.fillRect(0, MACHINE_Y + 128, W, 64);
    }
    v.lamps.forEach((level, line) => {
      if (level) this.cell('slots/lamps', line, 0, MACHINE_Y, { alpha: Math.min(16, level) / 16 });
    });
    const stops = this.art.sheet('slots/stops');
    v.stops.forEach((state, r) => {
      const at = COLUMNS[r]!;
      // Each button's cell carries its place on the machine as its origin.
      if (stops) this.cell('slots/stops', `${r}-${state}`, 0, MACHINE_Y);
      else {
        g.fillStyle = state === 'armed' ? '#f0d040' : '#806020';
        g.fillRect(at.x + 16, MACHINE_Y + 136, 24, 16);
      }
    });
    // The CREDIT and PAYOUT counters (ov101_021D5AF0, ov101_021D5C28): ones digit at x 108 and 180, y 180.
    for (const [value, x, hideZero] of [[v.credit, 108, false], [v.payout, 180, true]] as const) {
      for (let place = 0, unit = 1; place < 5; place++, unit *= 10) {
        if (value < unit && (place > 0 || hideZero)) continue;
        this.anim('slots/digits', Math.floor(value / unit) % 10, 0, x - place * 8, MACHINE_Y + 180);
      }
    }
    g.restore();

    // The stage: the 7s, the ball and its sparkle, Clefairy, the Pikachu pair; then the bonus counters.
    if (v.sevens) {
      const to = 48;
      for (const p of v.sevens.at) {
        const t = Math.min(1, Math.max(0, (p.y - v.sevens.from) / (192 + to - v.sevens.from)));
        const y = (v.sevens.from + MACHINE_Y) * (1 - t) + to * t;
        this.anim(v.sevens.symbol === 0 ? 'slots/seven_red' : 'slots/seven_galactic', 0, v.tick, p.x, y);
      }
    }
    if (v.sparkle) this.anim('slots/sparkle', 0, v.sparkle.frame, 128, 144);
    if (v.ball && !this.anim(`slots/ball_${v.ball.kind}`, v.ball.anim, v.ball.frame, v.ball.x, v.ball.y, { scale: v.ball.scale, rotation: v.ball.rotation })) {
      g.fillStyle = '#e04040';
      g.beginPath();
      g.arc(v.ball.x, v.ball.y, 12 * v.ball.scale, 0, Math.PI * 2);
      g.fill();
    }
    if (v.clefairy && !this.anim(`slots/clefairy_${v.clefairy.kind}`, v.clefairy.anim, v.clefairy.frame, 128, v.clefairy.y, { scale: v.clefairy.scale })) {
      g.fillStyle = '#f8b0c8';
      g.fillRect(112, v.clefairy.y - 16, 32, 32);
    }
    if (v.pikachu) {
      this.anim('slots/pikachu', 0, v.tick, v.pikachu.left.x, v.pikachu.left.y);
      this.anim('slots/pikachu', 0, v.tick, v.pikachu.right.x, v.pikachu.right.y, { flip: true });
    }
    if (v.counters) {
      this.anim('slots/bonus_label', 0, v.tick, 24, 8);
      this.digits('slots/counter_digits', v.counters.spins, v.counters.spins >= 10 ? 2 : 1, v.counters.spins >= 10 ? 60 : 52, 8, 8);
      this.anim('slots/get_label', 0, v.tick, 200, 8);
      this.digits('slots/counter_digits', v.counters.gained, 5, 252, 8, 8, 1, '0');
    }
    if (v.banner) {
      const n = v.banner.round;
      const count = n >= 100 ? 3 : n >= 10 ? 2 : 1;
      this.digits('slots/round_digits', n, count, 128 + (count - 1) * 8, 32, 16);
    }
    if (v.summary) {
      this.anim('slots/bonus_label', 0, v.tick, 128 - 44, 112, { scale: 2 });
      this.anim('slots/get_label', 0, v.tick, 128 - 60, 80, { scale: 2 });
      this.digits('slots/counter_digits', v.summary.rounds, String(v.summary.rounds).length, 128 + 72, 112, 16, 2);
      this.digits('slots/counter_digits', v.summary.gained, String(v.summary.gained).length, 128 + 72, 80, 16, 2);
    }
    this.sampleEdges();
    if (v.fade) {
      g.globalAlpha = v.fade / 16;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    this.drawBoxes(d, v);
  }

  /** The room around the composition takes the sky's and the cabinet's edge colours (once the art has drawn). */
  private edges = false;
  private sampleEdges(): void {
    if (this.edges || this.last?.v.fade || !this.art.sheet('slots/field') || [...this.images.values()].some((i) => i === null)) return;
    const px = (x: number, y: number) => {
      const [r, g, b] = this.g.getImageData(x, y, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    };
    this.root.style.background = `linear-gradient(${px(0, 0)} 50%, ${px(0, H - 1)} 50%)`;
    this.edges = true;
  }

  /** The message box and the touch targets (DOM, at composition px). */
  private drawBoxes(d: DrawContext, v: SlotsView): void {
    const key = JSON.stringify([v.message, d.frame, d.scale]);
    if (key === this.boxesKey) return;
    this.boxesKey = key;
    const parts: HTMLElement[] = [];
    COLUMNS.forEach((c, r) => {
      const b = stop(d, `stop:${r}`, [], 'slots-target slots-stop', false);
      b.setAttribute('aria-label', S.aria.stopReel(r));
      place(b, c);
      parts.push(b);
    });
    for (const h of HELP) {
      const b = stop(d, h.id, [], `slots-target slots-help slots-${h.id}`, false);
      b.setAttribute('aria-label', h.label());
      place(b, { x: h.x, y: HELP_Y, w: h.w, h: HELP_H });
      parts.push(b);
    }
    if (v.message) {
      // The message window (slotMessageWindow: BG0 tile (2, 19), 26 × 4) with its frame.
      const box = messageBox(d, v.message.text, v.message.waiting);
      box.classList.add('ds-scene-message');
      place(box, { x: 8, y: MACHINE_Y + 144, w: 240, h: 48 });
      parts.push(box);
    }
    this.boxes.replaceChildren(...parts);
  }
}

/**
 * The composition's scale: whole device pixels per DS pixel when that fills at least three quarters of the room, else
 * the room's exact fit (a short landscape view). Sizes the stage; returns CSS px per DS px.
 */
function layoutSlots(d: DrawContext, root: HTMLElement, stage: HTMLElement): number {
  const size = d.size ?? { width: innerWidth, height: innerHeight };
  const dpr = devicePixelRatio || 1;
  const fit = Math.min(size.width / W, size.height / H);
  const whole = Math.floor(fit * dpr) / dpr;
  const k = whole >= fit * 0.75 ? whole : fit;
  stage.style.setProperty('--k', `${k}px`);
  stage.style.setProperty('--dot', `${k}px`);
  stage.style.width = `${W * k}px`;
  stage.style.height = `${H * k}px`;
  return k;
}

const scenes = new WeakMap<Art, SlotsScene>();

export function slots(d: DrawContext, v: SlotsView): HTMLElement {
  let scene = scenes.get(d.art);
  if (!scene || !scene.root.isConnected) scenes.set(d.art, (scene = new SlotsScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
