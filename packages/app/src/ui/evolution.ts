/**
 * The evolution scene (contracts `EvolutionView`, packages/menus evolution.ts owns all timing): the DS's
 * 256×192 main screen drawn on one canvas in DS pixels and scaled by whole pixels, with the message box
 * and the YES/NO window in the DOM at their DS places (decomp evolution.c: the message window at tile
 * (2, 19) 27×4, YES/NO at (23, 13) 7×4). On big landscape views it is a window over the dimmed field
 * (the battle window's size, `panelScale`); elsewhere it fills the view over black.
 *
 * Layers, back to front (decomp Evolution_InitGraphics): the backdrop (black) and the background (BG3)
 * inside the GX window rows only, the palette fade over them, the two Pokémon (each with its own fade) and
 * the particles (both BG0, 3D: inside the window rows only, never palette-faded). The message box fades with the palettes only when the
 * view says so (the black fades in and out of the scene).
 */
import type { EvolutionView, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { capFlash } from '@opensinnoh/render/flash';
import { panelScale, SCENE } from '../battle/scene.ts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import './evolution.css';
import { S } from '../strings/index.ts';

/** decomp Evolution_CreateSprites: both pictures centred here. */
const CENTRE = { x: 128, y: 80 };
const PICTURE = 80;
/**
 * The message window (2,19) 27×4 with its frame (2 tiles left, 3 right: the whole screen, as the field's) and YES/NO with
 * its frame (tiles 22–30 × 12–17), in DS px.
 */
export const MESSAGE = { x: 0, y: 144, w: 256, h: 48 };
const YES_NO = { x: 176, y: 96, w: 72, h: 48 };

type Img = HTMLImageElement;

class EvolutionScene {
  readonly root = el('section', 'ds-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  private readonly scratch = document.createElement('canvas');
  private overlayKey = '';
  /** The last drawn view: redrawn when a picture finishes loading (a paused scene does not change its view). */
  private last: { d: DrawContext; v: EvolutionView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = SCENE.width;
    this.canvas.height = SCENE.height;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.scratch.width = PICTURE;
    this.scratch.height = PICTURE;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', S.aria.evolution);
  }

  private image(ref: string): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref as Id).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.draw(this.last.d, this.last.v);
    });
    return null;
  }

  draw(ctx: DrawContext, v: EvolutionView): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, SCENE.width, SCENE.height);
    // The background inside the GX window's rows (outside it only the message box and the Pokémon show).
    const bg = this.art.sheet('evolution/background');
    const bgImg = bg ? this.image(bg.atlas) : null;
    const rows = Math.max(0, v.window.bottom - v.window.top);
    if (bgImg && rows) g.drawImage(bgImg, 0, v.window.top, SCENE.width, rows, 0, v.window.top, SCENE.width, rows);
    else if (!bg && rows) {
      // A pack without the ROM background (the fixture): our own plain gradient.
      const grad = g.createLinearGradient(0, 0, 0, SCENE.height);
      grad.addColorStop(0, '#203048');
      grad.addColorStop(1, '#88c8b8');
      g.fillStyle = grad;
      g.fillRect(0, v.window.top, SCENE.width, rows);
    }
    // The palette fade covers the backdrop and the background (palettes 0–9).
    if (v.fade.level) {
      g.globalAlpha = v.fade.color === 'white' ? capFlash(v.fade.level / 16) : v.fade.level / 16;
      g.fillStyle = v.fade.color === 'white' ? '#fff' : '#000';
      g.fillRect(0, 0, SCENE.width, SCENE.height);
      g.globalAlpha = 1;
    }
    // The Pokémon and the particles are the 3D layer (BG0): outside the GX window only BG1 and OBJ show
    // (decomp G2_SetWndOutsidePlane), so they are cut to the window's rows too.
    g.save();
    g.beginPath();
    g.rect(0, v.window.top, SCENE.width, rows);
    g.clip();
    for (const s of v.sprites) this.drawPokemon(d, s);
    const sheet = this.art.sheet('evolution/particles');
    if (sheet) for (const p of v.particles) this.drawParticle(sheet, p);
    g.restore();
    this.drawBoxes(d, v);
  }

  private drawPokemon(d: DrawContext, s: EvolutionView['sprites'][number]): void {
    if (s.scale <= 0) return;
    const pictures = d.registries.pokemonSprites.get(s.species);
    const form = pictures?.forms[s.form] ?? pictures?.forms[0];
    if (!form) return;
    const img = this.image(s.shiny ? form.shinyAtlas : form.atlas);
    if (!img) return;
    const face = (s.female && form.frontFemale) || form.front;
    // The picture with its fade toward the colour (decomp BlendPalette: level/16 of the way).
    const c = this.scratch.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, PICTURE, PICTURE);
    c.drawImage(img, s.frame * PICTURE, face.y, PICTURE, PICTURE, 0, 0, PICTURE, PICTURE);
    if (s.fade.level) {
      c.globalCompositeOperation = 'source-atop';
      c.globalAlpha = s.fade.color === 'white' ? capFlash(s.fade.level / 16) : s.fade.level / 16;
      c.fillStyle = s.fade.color === 'white' ? '#fff' : '#000';
      c.fillRect(0, 0, PICTURE, PICTURE);
    }
    const k = s.scale / 256;
    const size = PICTURE * k;
    const x = CENTRE.x + s.dx - size / 2;
    const y = CENTRE.y + s.dy - size / 2;
    this.g.drawImage(this.scratch, 0, 0, PICTURE, PICTURE, Math.round(x), Math.round(y), Math.round(size), Math.round(size));
  }

  /** A particle: its texture modulated by its colour (DS GX_POLYGONMODE_MODULATE), at its alpha. */
  private drawParticle(sheet: Ui2dSheet, p: EvolutionView['particles'][number]): void {
    const cell = sheet.cells[p.texture];
    const img = this.image(sheet.atlas);
    if (!cell || !img || p.w <= 0 || p.h <= 0) return;
    const key = `${p.texture}|${p.color}`;
    let tex = this.tinted.get(key);
    if (!tex) {
      tex = document.createElement('canvas');
      tex.width = cell.w;
      tex.height = cell.h;
      const c = tex.getContext('2d')!;
      c.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = p.color;
      c.fillRect(0, 0, cell.w, cell.h);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
      this.tinted.set(key, tex);
    }
    const g = this.g;
    g.save();
    g.globalAlpha = Math.min(1, p.alpha / 31);
    g.translate(p.x, p.y);
    if (p.angle) g.rotate(p.angle);
    g.drawImage(tex, -p.w, -p.h, p.w * 2, p.h * 2);
    g.restore();
  }

  private drawBoxes(d: DrawContext, v: EvolutionView): void {
    const key = JSON.stringify([v.message, v.yesNo, v.fade.box ? v.fade : null, d.frame, d.scale]);
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const parts: HTMLElement[] = [];
    if (v.message) {
      const box = messageBox(d, v.message.text, v.message.waiting);
      box.classList.add('ds-scene-message');
      place(box, MESSAGE);
      if (v.fade.box && v.fade.level) box.style.filter = `brightness(${v.fade.color === 'white' ? 1 + v.fade.level / 16 : 1 - v.fade.level / 16})`;
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

export function place(e: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  e.style.left = `calc(var(--k) * ${r.x})`;
  e.style.top = `calc(var(--k) * ${r.y})`;
  e.style.width = `calc(var(--k) * ${r.w})`;
  e.style.height = `calc(var(--k) * ${r.h})`;
}

const scenes = new WeakMap<Art, EvolutionScene>();

/**
 * A DS screen scene (evolution, hatching): its whole-pixel scale, the battle window's on big landscape views,
 * else the largest that fits the room (full screen over black). Sizes the stage; returns CSS px per DS px.
 */
export function layoutScene(d: DrawContext, root: HTMLElement, stage: HTMLElement): number {
  const size = d.size ?? { width: innerWidth, height: innerHeight };
  const dpr = devicePixelRatio || 1;
  const panel = panelScale(size.width, size.height, d.compact);
  const k = panel || Math.max(1, Math.floor(Math.min(size.width / SCENE.width, size.height / SCENE.height) * dpr)) / dpr;
  root.classList.toggle('is-window', panel > 0);
  stage.style.setProperty('--k', `${k}px`);
  stage.style.setProperty('--dot', `${k}px`);
  stage.style.width = `${SCENE.width * k}px`;
  stage.style.height = `${SCENE.height * k}px`;
  return k;
}

/** Labels, flowed text and frames at the scene's scale `k` (one --dot per DS pixel). */
export function sceneContext(ctx: DrawContext, k: number): DrawContext {
  return { ...ctx, scale: k, text: (s, palette, className, scale) => ctx.text(s, palette, className, scale ?? k), flow: (s, lines, palette, scale) => ctx.flow(s, lines, palette, scale ?? k) };
}

/** The scene's root, redrawn in place (the layer keeps it while the view changes every tick). */
export function evolution(d: DrawContext, v: EvolutionView): HTMLElement {
  let scene = scenes.get(d.art);
  if (!scene || !scene.root.isConnected) scenes.set(d.art, (scene = new EvolutionScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
