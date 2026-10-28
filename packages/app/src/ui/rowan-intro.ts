/**
 * Rowan's intro and the setup before it (contracts `RowanIntroView`; packages/menus rowan-intro.ts and
 * title/setup.ts own the timing): one 256×192 DS screen on a canvas at a whole number of device pixels per DS
 * pixel, as large as fits but at most `MAX_SCALE` CSS px per DS pixel, centred on black (full width on phones).
 * The message box, the choice windows (the ROM's frames) and ADVENTURE INFO's text are DOM at their DS places;
 * the Poké Ball's button and the two avatars are tap targets. Back to front (decomp RowanIntro_InitGraphics): the
 * backdrop (BG3), the people (BG1, BG2) at their opacity, the flash toward white, the Pokémon (BG2, not flashed),
 * then the master brightness over everything. Packs without the art (the fixture) get plain stand-ins.
 */
import type { RowanIntroView, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { capFlash } from '@opensinnoh/render/flash';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { MESSAGE, place, sceneContext } from './evolution.ts';
import './evolution.css';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
/** CSS px per DS px at most (a 1024×768 screen): big screens get the scene centred, not stretched. */
export const MAX_SCALE = 4;
const PICTURE = 80;
/** RowanIntro_WasPokeballOpened: a touch within 16 px of (128, 100). */
const BALL_BUTTON = { x: 112, y: 84, w: 32, h: 32 };
/** Stand-in people (no `intro/people` sheet): where the DS pictures stand. */
const STAND_IN = { x: 100, y: 24, w: 56, h: 112 };

const rgb555 = (c: number) => `rgb(${[c & 31, (c >> 5) & 31, (c >> 10) & 31].map((v) => Math.round((v * 255) / 31)).join(' ')})`;

/** Whole device pixels per DS pixel, capped. */
export function introScale(width: number, height: number, dpr: number): number {
  return Math.max(1, Math.min(Math.floor(Math.min(width / W, height / H) * dpr), MAX_SCALE * dpr)) / dpr;
}

/**
 * The backdrop's edge colour per row (read at runtime, so nothing of the ROM is stored): the colour the screen's
 * backdrop runs on with past its sides. The picture itself is drawn on the stage (ADVENTURE INFO's backdrop has a
 * box in its middle); a row whose two edge pixels differ fails loudly, as it could not run on past the screen.
 */
function bandRows(img: HTMLImageElement, c: Ui2dSheet['cells'][number]): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = c.h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, c.x, c.y, 1, c.h, 0, 0, 1, c.h);
  g.drawImage(img, c.x + c.w - 1, c.y, 1, c.h, 1, 0, 1, c.h);
  const px = g.getImageData(0, 0, 2, c.h).data;
  const rows: string[] = [];
  for (let y = 0; y < c.h; y++) {
    const [l, r] = [y * 8, y * 8 + 4].map((i) => `rgb(${px[i]} ${px[i + 1]} ${px[i + 2]})`);
    if (px[y * 8 + 3] !== 255 || px[y * 8 + 7] !== 255 || l !== r) throw new Error(`ui: the intro backdrop's row ${y} has edges ${l} and ${r}, not one opaque colour`);
    rows.push(l!);
  }
  return rows;
}

/**
 * The rows as a viewport-wide gradient lined up with the screen (its top `y0` px down, `k` px per DS px): each row
 * exactly where the screen shows it, the top row's colour above and the bottom row's below, so the screen's
 * backdrop runs on to every edge with no seam.
 */
function bandGradient(rows: string[], y0: number, k: number): string {
  const stops = [`${rows[0]} 0 ${y0}px`];
  for (let y = 0, start = 0; y < rows.length; y++) {
    if (y + 1 < rows.length && rows[y + 1] === rows[y]) continue;
    stops.push(`${rows[y]} ${y0 + start * k}px ${y0 + (y + 1) * k}px`);
    start = y + 1;
  }
  stops.push(`${rows.at(-1)} ${y0 + rows.length * k}px 100%`);
  return `linear-gradient(${stops.join(', ')})`;
}

class IntroScene {
  readonly root = el('section', 'ds-scene intro-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly shade = el('div', 'intro-shade');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, HTMLImageElement | null>();
  private readonly scratch = document.createElement('canvas');
  private readonly flash = el('div', 'intro-flash');
  private readonly bands = new Map<string, string[]>();
  private boxesKey = '';
  private last: { d: DrawContext; v: RowanIntroView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.scratch.width = PICTURE;
    this.scratch.height = PICTURE;
    this.shade.setAttribute('aria-hidden', 'true');
    this.flash.setAttribute('aria-hidden', 'true');
    this.stage.append(this.canvas, this.boxes);
    // Behind the stage: the backdrop's bands and their flash fill the viewport; the shade fades everything.
    this.root.append(this.flash, this.stage, this.shade);
  }

  private image(ref: string): HTMLImageElement | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref as Id).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.draw(this.last.d, this.last.v);
    });
    return null;
  }

  /** A named cell of a sheet: its image and atlas rect, or null (no sheet, or not loaded yet). */
  private cell(path: string, name: string): { img: HTMLImageElement; c: Ui2dSheet['cells'][number] } | null | undefined {
    const sheet = this.art.sheet(path);
    if (!sheet) return undefined;
    const i = sheet.names?.indexOf(name) ?? -1;
    if (i < 0) throw new Error(`ui: ${path} has no cell ${name}`);
    const img = this.image(sheet.atlas);
    return img ? { img, c: sheet.cells[i]! } : null;
  }

  private drawCell(path: string, name: string, x: number, y: number): boolean {
    const got = this.cell(path, name);
    if (got) this.g.drawImage(got.img, got.c.x, got.c.y, got.c.w, got.c.h, x - got.c.ox, y - got.c.oy, got.c.w, got.c.h);
    return got !== undefined;
  }

  /** The viewport-wide gradient of a backdrop cell at the stage's place, once its art has loaded (null: the pack has none). */
  private gradient(name: string, k: number): string | null {
    const got = this.cell('intro/backdrops', name);
    if (!got) return null;
    if (!this.bands.has(name)) this.bands.set(name, bandRows(got.img, got.c));
    return bandGradient(this.bands.get(name)!, this.stage.offsetTop, k);
  }

  /** The room the scene has: the viewport inside the safe area. */
  private room(ctx: DrawContext): { width: number; height: number } {
    if (this.root.isConnected && this.root.clientWidth > 0) {
      const cs = getComputedStyle(this.root);
      const pad = (side: string) => parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0;
      return { width: this.root.clientWidth - pad('left') - pad('right'), height: this.root.clientHeight - pad('top') - pad('bottom') };
    }
    return ctx.size ?? { width: innerWidth, height: innerHeight };
  }

  draw(ctx: DrawContext, v: RowanIntroView): void {
    this.last = { d: ctx, v };
    const size = this.room(ctx);
    const k = introScale(size.width, size.height, devicePixelRatio || 1);
    this.stage.style.setProperty('--k', `${k}px`);
    this.stage.style.setProperty('--dot', `${k}px`);
    this.stage.style.width = `${W * k}px`;
    this.stage.style.height = `${H * k}px`;
    const d = sceneContext(ctx, k);
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    // Packs without the art get a plain stand-in colour, also viewport-wide.
    const standIn = v.screen !== 'touch' && v.backdrop && !this.art.sheet('intro/backdrops') ? (v.backdrop === 'plain' ? '#e8e0a8' : '#9cc8f0') : null;
    const bands = standIn ?? (v.screen !== 'touch' && v.backdrop ? this.gradient(v.backdrop, k) : null);
    this.root.style.background = bands ?? '';
    if (v.screen === 'touch') {
      if (!this.drawCell('intro/ball', 'screen', 0, 0)) this.standInBall();
      if (v.ball && this.art.sheet('intro/ball')) this.drawCell('intro/ball', v.ball, 0, 0);
    } else {
      if (v.backdrop && !standIn) this.drawCell('intro/backdrops', v.backdrop, 0, 0);
      for (const l of v.layers) {
        g.globalAlpha = l.alpha / 16;
        if (!this.drawCell('intro/people', l.cell, l.x, l.y)) {
          g.fillStyle = l.cell.startsWith('girl') ? '#d06070' : l.cell.startsWith('boy') ? '#4070c0' : l.cell === 'rival' ? '#e0a030' : '#606878';
          const shrink = /-shrink-(\d)/.exec(l.cell);
          const s = shrink ? 1 - Number(shrink[1]) / 5 : 1;
          g.fillRect(l.x + STAND_IN.x + (STAND_IN.w * (1 - s)) / 2, l.y + STAND_IN.y + STAND_IN.h * (1 - s), STAND_IN.w * s, STAND_IN.h * s);
        }
      }
      g.globalAlpha = 1;
    }
    // The flash whitens the backdrop (the page-wide bands and the canvas) and the people (the canvas), not the Pokémon.
    this.flash.style.opacity = bands ? String(capFlash(v.flash / 16)) : '0';
    if (v.flash) {
      g.globalAlpha = capFlash(v.flash / 16);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    if (v.pokemon) this.drawPokemon(d, v.pokemon);
    this.shade.style.opacity = String(-v.brightness / 16);
    this.drawBoxes(d, v);
  }

  private drawPokemon(d: DrawContext, p: NonNullable<RowanIntroView['pokemon']>): void {
    const form = d.registries.pokemonSprites.get(p.species)?.forms[0];
    const img = form ? this.image(form.atlas) : null;
    if (!form || !img) return;
    const c = this.scratch.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, PICTURE, PICTURE);
    c.drawImage(img, 0, form.front.y, PICTURE, PICTURE, 0, 0, PICTURE, PICTURE);
    if (p.tint.level) {
      c.globalCompositeOperation = 'source-atop';
      c.globalAlpha = p.tint.level / 16;
      c.fillStyle = rgb555(p.tint.color);
      c.fillRect(0, 0, PICTURE, PICTURE);
    }
    this.g.globalAlpha = p.alpha / 16;
    this.g.drawImage(this.scratch, p.x, p.y);
    this.g.globalAlpha = 1;
  }

  private standInBall(): void {
    const g = this.g;
    g.fillStyle = '#e8e0a8';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#605850';
    g.beginPath();
    g.arc(128, 100, 84, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e06060';
    g.beginPath();
    g.arc(128, 100, 78, Math.PI, 0);
    g.fill();
    g.fillStyle = '#f8f8f8';
    g.beginPath();
    g.arc(128, 100, 78, 0, Math.PI);
    g.fill();
    g.fillStyle = '#d8e8f8';
    g.beginPath();
    g.arc(128, 100, 16, 0, Math.PI * 2);
    g.fill();
  }

  private drawBoxes(d: DrawContext, v: RowanIntroView): void {
    const key = JSON.stringify([v.message, v.menu, v.block, v.screen, v.ball !== null, v.gender, v.gender ? v.layers.map((l) => [l.cell, l.x]) : null, d.scale, d.frame]);
    if (key === this.boxesKey) return;
    this.boxesKey = key;
    const parts: HTMLElement[] = [];
    if (v.block) {
      const block = el('div', 'intro-block', d.flow(v.block.text, true, 'ink'));
      place(block, { x: 32, y: v.block.y, w: 192, h: H - v.block.y });
      block.style.opacity = String(v.block.alpha / 16);
      if (v.block.waiting) {
        block.setAttribute('role', 'button');
        block.dataset.tap = 'next';
        block.addEventListener('click', () => d.tap('next'));
      }
      parts.push(block);
    }
    if (v.screen === 'touch' && v.ball) {
      const button = el('button', 'intro-ball');
      button.type = 'button';
      button.dataset.tap = 'ball';
      button.setAttribute('aria-label', S.aria.ballButton);
      button.addEventListener('click', () => d.tap('ball'));
      place(button, BALL_BUTTON);
      parts.push(button);
    }
    if (v.gender) {
      for (const l of v.layers) {
        const kind = l.cell.startsWith('boy') ? 'boy' : 'girl';
        const cell = this.art.sheet('intro/people');
        const c = cell?.cells[cell.names!.indexOf(l.cell)];
        const rect = c ? { x: l.x - c.ox, y: l.y - c.oy, w: c.w, h: c.h } : { x: l.x + STAND_IN.x, y: l.y + STAND_IN.y, w: STAND_IN.w, h: STAND_IN.h };
        const b = el('button', 'intro-avatar');
        b.type = 'button';
        b.dataset.tap = kind;
        b.setAttribute('aria-label', kind === 'boy' ? S.aria.boy : S.aria.girl);
        b.setAttribute('aria-pressed', String((v.gender === 'male') === (kind === 'boy')));
        b.addEventListener('click', () => d.tap(kind));
        place(b, rect);
        parts.push(b);
      }
    }
    if (v.message) {
      const box = messageBox(d, v.message.text, v.message.waiting);
      box.classList.add('ds-scene-message');
      place(box, MESSAGE);
      parts.push(box);
    }
    if (v.menu) {
      const menu = framed(d, 'intro-menu', ...v.menu.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e)], 'choice', v.menu!.cursor === i)));
      menu.setAttribute('role', 'menu');
      place(menu, v.menu.rect);
      parts.push(menu);
    }
    this.boxes.replaceChildren(...parts);
  }
}

const scenes = new WeakMap<Art, IntroScene>();

/** The scene's root, redrawn in place. */
export function rowanIntro(d: DrawContext, v: RowanIntroView): HTMLElement {
  let scene = scenes.get(d.art);
  if (!scene || !scene.root.isConnected) scenes.set(d.art, (scene = new IntroScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
