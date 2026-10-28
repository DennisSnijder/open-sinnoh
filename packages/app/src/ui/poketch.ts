/**
 * The Pokétch card (docs/research/poketch.md). On the DS the Pokétch is the field's bottom screen; here it
 * is the same 256×192 screen as a card over the running field (one composed screen, summoned by P or
 * the HUD watch button), drawn whole-pixel from the ROM art: the device frame, then the app's `PoketchView`
 * (the model runs in the game), recoloured to the screen colour.
 *
 * Input is the DS's: touches on the card are panel touches (DS px) that the game hands the Pokétch. L/R
 * press the side button's halves. Y enters touch mode: the d-pad moves a pointer over the app's targets
 * (or freely), A touches, B or Y leaves; the field gets no buttons meanwhile.
 */
import { POKETCH_SCREEN, type PoketchSprite, type PoketchView, type Registries, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import type { InputFrame } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';
import type { Art } from './art.ts';
import { el } from './core.ts';
import type { PixelFont } from './pixel-font.ts';
import type { UiStrings } from './strings.ts';
import { S } from '../strings/index.ts';

const W = POKETCH_SCREEN.width;
const H = POKETCH_SCREEN.height;
const LCD = POKETCH_SCREEN.lcd;
/** The side button halves' centres (decomp sMainPoketchButtons). */
const SIDE = { up: { x: 240, y: 64 }, down: { x: 240, y: 128 } };
/** Decomp poketch_graphics button images: the border tile column V per state, and the source rows per drawn row. */
const BUTTON_V = { up: { pressed: 16, half: 12 }, down: { pressed: 28, half: 24 } } as const;
const BUTTON_ROWS = { up: [0, 1, 2, 3, 4, 4, 4, 5], down: [0, 1, 2, 2, 2, 3, 4, 5] } as const;
/** Decomp cover tile (border tile 164: the LCD switched off). */
const COVER_TILE = 164;
/** Decomp PoketchTask_MapToActivePaletteFromLuminance: luma 0–3 → these palette slots. */
const LUMA_SLOTS = [1, 8, 15, 4];

type Rgb = [number, number, number];
const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

/** The ROM's 16 screen palettes (sheet `poketch/palettes`: one row each). */
class Palettes {
  constructor(readonly rows: Rgb[][]) {}
  /** Theme `color`'s palette (the backlight one with `light`). */
  theme(color: number, light: boolean): Rgb[] {
    return this.rows[color * 2 + (light ? 1 : 0)]!;
  }
  /** Theme 0 (green, the colours the art is imported in) colour → slot. */
  slots(): Map<number, number> {
    const m = new Map<number, number>();
    for (const row of [this.rows[0]!, this.rows[1]!]) row.forEach((c, i) => m.set(key(...c), i));
    return m;
  }
}

export interface PoketchCardDeps {
  game(): Game;
  strings(): UiStrings;
  font(): PixelFont;
  art: Art;
  close(): void;
}

export class PoketchCard {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private drawn = '';
  shown = false;
  private palettes: Palettes | null = null;
  private loading = false;
  private readonly images = new Map<string, HTMLImageElement | 'loading'>();
  private readonly icons = new Map<string, HTMLCanvasElement>();
  /** Touches the card makes (pointer on the card, L/R, touch mode), in DS px; null = none. */
  private pointer: { x: number; y: number } | null = null;
  private synthetic: { x: number; y: number; ticks: number } | null = null;
  /** Touch mode (Y): a pointer the d-pad moves. */
  private cursor: { x: number; y: number } | null = null;
  private repeat = 0;
  /** The last frame's held buttons (touch mode's own edges). */
  private lastHeld = new Set<Button>();

  constructor(private readonly deps: PoketchCardDeps) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'poketch-lcd';
    this.canvas.setAttribute('role', 'img');
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.g.imageSmoothingEnabled = false;
    const at = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: Math.min(W - 1, Math.max(0, Math.floor(((e.clientX - r.left) * W) / r.width))), y: Math.min(H - 1, Math.max(0, Math.floor(((e.clientY - r.top) * H) / r.height))) };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer = at(e);
      this.cursor = null;
      e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.pointer = at(e);
    });
    const up = () => (this.pointer = null);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    const side = (half: 'up' | 'down', name: string) => {
      const b = el('button', `poketch-side ${half === 'up' ? 'prev' : 'next'}`);
      b.type = 'button';
      b.setAttribute('aria-label', name);
      b.addEventListener('click', () => this.side(half));
      return b;
    };
    const close = el('button', 'poketch-close');
    close.type = 'button';
    close.setAttribute('aria-label', S.aria.closeWatch);
    close.addEventListener('click', () => this.deps.close());
    this.el = el('aside', 'poketch', this.canvas, side('up', 'Previous app'), side('down', 'Next app'), close);
    this.el.hidden = true;
    this.el.setAttribute('aria-label', S.aria.watch);
  }

  show(on: boolean): void {
    this.shown = on;
    this.el.hidden = !on;
    this.drawn = '';
    this.pointer = null;
    this.cursor = null;
    if (on) this.frame();
  }

  /** Sizes the screen to a whole number of device pixels per DS pixel that fits the box (capped on big screens). */
  size(maxCssWidth: number, maxCssHeight: number): void {
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.floor(Math.min((maxCssWidth * dpr) / W, (maxCssHeight * dpr) / H)));
    this.canvas.style.width = `${(W * k) / dpr}px`;
    this.canvas.style.height = `${(H * k) / dpr}px`;
  }

  /** A press of a side button's half: a touch there for two ticks (down, then up: the DS's TAP). */
  side(half: 'up' | 'down'): void {
    this.synthetic = { ...SIDE[half], ticks: 2 };
  }

  /**
   * One tick of field input while the card is shown: L/R become side button presses, touch mode takes the
   * d-pad and A; the card's touches are added. Returns the frame the game steps with.
   */
  input(frame: InputFrame): InputFrame {
    const pressed = new Set(frame.pressed);
    const held = new Set(frame.held);
    if (pressed.has('l')) this.side('up');
    if (pressed.has('r')) this.side('down');
    const strip: Button[] = ['l', 'r'];
    if (pressed.has('y')) this.cursor = this.cursor ? null : { x: 112, y: 96 };
    else if (this.cursor && pressed.has('b')) this.cursor = null;
    let touch: { x: number; y: number } | null = this.pointer;
    if (this.cursor) {
      this.moveCursor(held);
      if (held.has('a')) touch = { ...this.cursor };
      strip.push('up', 'down', 'left', 'right', 'a', 'b', 'y', 'x', 'start', 'select');
    } else strip.push('y');
    if (this.synthetic) {
      touch = this.synthetic.ticks > 1 ? { x: this.synthetic.x, y: this.synthetic.y } : touch;
      if (--this.synthetic.ticks <= 0) this.synthetic = null;
    }
    this.lastHeld = held;
    return { held: frame.held.filter((b) => !strip.includes(b)), pressed: frame.pressed.filter((b) => !strip.includes(b)), touch: touch ?? frame.touch, ...(frame.tap ? { tap: frame.tap } : {}) };
  }

  /** The d-pad in touch mode: to the nearest target that way, or 4 px at a time without targets (auto-repeat 8, then every 2 ticks). */
  private moveCursor(held: Set<Button>): void {
    const dirs = (['up', 'down', 'left', 'right'] as const).filter((b) => held.has(b));
    if (!dirs.length) {
      this.repeat = 0;
      return;
    }
    const fresh = dirs.some((d) => !this.lastHeld.has(d));
    this.repeat = fresh ? 0 : this.repeat + 1;
    if (!fresh && (this.repeat < 8 || this.repeat % 2)) return;
    const c = this.cursor!;
    const dx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const dy = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    const targets = this.deps.game().poketch()?.targets ?? [];
    if (targets.length) {
      const centres = targets.map((t) => ({ x: t.x + Math.floor(t.width / 2), y: t.y + Math.floor(t.height / 2) }));
      const ahead = centres.filter((p) => (p.x - c.x) * dx + (p.y - c.y) * dy > 0);
      const best = ahead.sort((a, b) => Math.hypot(a.x - c.x, (a.y - c.y) * 2) - Math.hypot(b.x - c.x, (b.y - c.y) * 2))[0];
      if (best) Object.assign(c, best);
      return;
    }
    c.x = Math.min(LCD.x + LCD.width - 1, Math.max(LCD.x, c.x + 4 * dx));
    c.y = Math.min(LCD.y + LCD.height - 1, Math.max(LCD.y, c.y + 4 * dy));
  }

  get touchMode(): boolean {
    return this.cursor !== null;
  }

  private sheet(path: string): Ui2dSheet | undefined {
    return this.deps.art.sheet(path);
  }

  private image(ref: Id): HTMLImageElement | null {
    const got = this.images.get(ref);
    if (got && got !== 'loading') return got;
    if (!got) {
      this.images.set(ref, 'loading');
      void this.deps.art.image(ref).then((img) => {
        this.images.set(ref, img);
        this.drawn = '';
      });
    }
    return null;
  }

  private loadPalettes(): Palettes | null {
    if (this.palettes) return this.palettes;
    const sheet = this.sheet('poketch/palettes');
    if (!sheet) return null;
    const img = this.image(sheet.atlas);
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, 16, 16).data;
    this.palettes = new Palettes(Array.from({ length: 16 }, (_, r) => Array.from({ length: 16 }, (_, i) => [px[(r * 16 + i) * 4]!, px[(r * 16 + i) * 4 + 1]!, px[(r * 16 + i) * 4 + 2]!] as Rgb)));
    return this.palettes;
  }

  /** Redraws when the view (or a loaded image) changed. */
  frame(): void {
    if (!this.shown) return;
    const game = this.deps.game();
    const view = game.poketch();
    if (!view) return;
    const name = this.deps.strings().poketchApp(view.app);
    const k = JSON.stringify([view, this.cursor, game.state.gender]);
    if (k === this.drawn) return;
    this.drawn = k;
    this.el.dataset.app = view.app;
    const time = view.info.time;
    this.canvas.setAttribute('aria-label', typeof time === 'string' && /^\d\d:\d\d$/.test(time) ? `${name} ${time}` : name);
    const pal = this.loadPalettes();
    if (!pal) return this.placeholder(name, view);
    this.draw(view, pal, game.registries, game.state.gender);
  }

  /** Packs without the Pokétch art (the fixture): the app name on a plain green LCD. */
  private placeholder(name: string, view: PoketchView): void {
    const g = this.g;
    g.fillStyle = '#c8423a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#73b573';
    g.fillRect(LCD.x, LCD.y, LCD.width, LCD.height);
    const font = this.deps.font();
    const text = typeof view.info.time === 'string' ? `${name} ${view.info.time}` : name;
    font.draw(g, text, 'lcd', Math.round(LCD.x + (LCD.width - font.measure(text)) / 2), 88);
  }

  private draw(view: PoketchView, pal: Palettes, registries: Registries, gender: 'male' | 'female'): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const base = pal.theme(0, false);
    const rgb = (slot: number) => `rgb(${base[slot]!.join(',')})`;
    // The LCD under the app: its fill colour, or the backdrop (colour 0).
    g.fillStyle = rgb(view.fill ?? 0);
    g.fillRect(LCD.x, LCD.y, LCD.width, LCD.height);
    for (const bg of view.bg) this.cell(bg, 0, 0, 0, {});
    for (const b of view.blits) this.blit(b.sheet, b.from, b.x, b.y, b.hFlip, b.vFlip);
    if (view.bitmap) {
      const b = view.bitmap;
      for (let i = 0; i < b.data.length; i++) {
        const v = parseInt(b.data[i]!, 16);
        if (!v) continue;
        g.fillStyle = rgb(v);
        g.fillRect(b.x + (i % b.width) * b.scale, b.y + Math.floor(i / b.width) * b.scale, b.scale, b.scale);
      }
    }
    for (const icon of view.icons) this.icon(icon, registries, base);
    for (const s of view.sprites) this.sprite(s);
    const font = this.deps.font();
    for (const t of view.text) font.draw(g, t.text, 'lcd', t.align === 'center' ? Math.round(t.x - font.measure(t.text) / 2) : t.x, t.y);
    if (view.mosaic) this.mosaic(view.mosaic + 1);
    this.recolour(pal, view.color, view.backlight, false);
    if (view.counter !== null) {
      const tens = Math.floor(view.counter / 10);
      this.sprite({ sheet: 'poketch/digits', anim: { seq: tens, t: 0 }, x: 176, y: 40 });
      this.sprite({ sheet: 'poketch/digits', anim: { seq: view.counter % 10, t: 0 }, x: 192, y: 40 });
      this.recolour(pal, view.color, view.backlight, true, { x: 168, y: 24, width: 32, height: 32 });
    }
    // The device: the frame (the LCD shows through it), the pressed side button, the cover between apps.
    const frame = `poketch/border_${gender === 'female' ? 'pink' : 'blue'}`;
    this.cell(frame, 0, 0, 0, {});
    const tiles = `${frame}_tiles`;
    for (const half of ['up', 'down'] as const) {
      const state = view.buttons[half];
      if (state === 'idle') continue;
      const v = BUTTON_V[half][state];
      BUTTON_ROWS[half].forEach((row, y) => {
        for (let col = 0; col < 4; col++) this.tile(tiles, v + 32 * row + col, 28 + col, (half === 'up' ? 4 : 12) + y);
      });
    }
    if (view.cover) {
      for (let x = 2; x < 26; x++)
        for (let y = 0; y < view.cover / 8; y++) {
          this.tile(tiles, COVER_TILE, x, 2 + y);
          this.tile(tiles, COVER_TILE, x, 21 - y);
        }
    }
    if (this.cursor) {
      g.fillStyle = '#f2a93b';
      g.fillRect(this.cursor.x - 4, this.cursor.y, 9, 1);
      g.fillRect(this.cursor.x, this.cursor.y - 4, 1, 9);
    }
  }

  /** Recolours the LCD (or `area`) from the green palette to the screen colour; `invert` swaps 1↔4 and 8↔15 (the app counter). */
  private recolour(pal: Palettes, color: number, light: boolean, invert: boolean, area: { x: number; y: number; width: number; height: number } = LCD): void {
    if (color === 0 && !light && !invert) return;
    const img = this.g.getImageData(area.x, area.y, area.width, area.height);
    const px = img.data;
    const slots = pal.slots();
    const target = pal.theme(color, light);
    const swap: Record<number, number> = invert ? { 1: 4, 4: 1, 8: 15, 15: 8 } : {};
    for (let i = 0; i < px.length; i += 4) {
      const slot = slots.get(key(px[i]!, px[i + 1]!, px[i + 2]!));
      if (slot === undefined) continue;
      const c = target[swap[slot] ?? slot]!;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
    this.g.putImageData(img, area.x, area.y);
  }

  /** BG and OBJ mosaic: each `size`-px block takes its top-left pixel. */
  private mosaic(size: number): void {
    const img = this.g.getImageData(LCD.x, LCD.y, LCD.width, LCD.height);
    const px = img.data;
    for (let y = 0; y < LCD.height; y++)
      for (let x = 0; x < LCD.width; x++) {
        const from = ((y - (y % size)) * LCD.width + (x - (x % size))) * 4;
        const to = (y * LCD.width + x) * 4;
        for (let c = 0; c < 4; c++) px[to + c] = px[from + c]!;
      }
    this.g.putImageData(img, LCD.x, LCD.y);
  }

  private tile(sheet: string, index: number, tx: number, ty: number): void {
    this.blit(sheet, { x: (index % 32) * 8, y: Math.floor(index / 32) * 8, width: 8, height: 8 }, tx * 8, ty * 8);
  }

  private blit(path: string, from: { x: number; y: number; width: number; height: number }, x: number, y: number, h = false, v = false): void {
    const sheet = this.sheet(path);
    const img = sheet && this.image(sheet.atlas);
    if (!img) return;
    const g = this.g;
    g.save();
    g.translate(x + (h ? from.width : 0), y + (v ? from.height : 0));
    g.scale(h ? -1 : 1, v ? -1 : 1);
    g.drawImage(img, from.x, from.y, from.width, from.height, 0, 0, from.width, from.height);
    g.restore();
  }

  /** Cell `n` of a sheet with its origin at x, y; flips, rotation (degrees clockwise) and scale about the origin. */
  private cell(path: string, n: number, x: number, y: number, o: { hFlip?: boolean; vFlip?: boolean; angle?: number; scale?: number; sx?: number; sy?: number }): void {
    const sheet = this.sheet(path);
    const img = sheet && this.image(sheet.atlas);
    const c = sheet?.cells[n];
    if (!img || !c || !c.w) return;
    const g = this.g;
    g.save();
    g.translate(x, y);
    if (o.angle) g.rotate((o.angle * Math.PI) / 180);
    g.scale(o.sx ?? o.scale ?? 1, o.sy ?? o.scale ?? 1);
    // A flip mirrors the cell in its own box (the decomp flips each OAM's bit; these cells are one OAM).
    if (o.hFlip || o.vFlip) {
      const cx = c.w / 2 - c.ox;
      const cy = c.h / 2 - c.oy;
      g.translate(cx, cy);
      g.scale(o.hFlip ? -1 : 1, o.vFlip ? -1 : 1);
      g.translate(-cx, -cy);
    }
    g.drawImage(img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
    g.restore();
  }

  private sprite(s: PoketchSprite): void {
    if (s.cell !== undefined) return this.cell(s.sheet, s.cell, s.x, s.y, s);
    const seq = this.sheet(s.sheet)?.animations?.[s.anim!.seq];
    if (!seq) return;
    // NANR durations are 60 Hz frames; the Pokétch advances them by 2 a tick.
    const total = seq.frames.reduce((n, f) => n + f.ticks, 0);
    let units = s.anim!.t * 2;
    if (seq.mode === 'loop' && units >= total) {
      const start = seq.frames.slice(0, seq.loopStart).reduce((n, f) => n + f.ticks, 0);
      units = start + ((units - start) % Math.max(1, total - start));
    }
    let f = seq.frames[seq.frames.length - 1]!;
    for (const fr of seq.frames) {
      if (units < fr.ticks) {
        f = fr;
        break;
      }
      units -= fr.ticks;
    }
    this.cell(s.sheet, f.cell, s.x + (f.dx ?? 0), s.y + (f.dy ?? 0), { ...s, angle: (s.angle ?? 0) + (f.rotation ?? 0) * 360, sx: (s.scale ?? 1) * (f.scaleX ?? 1), sy: (s.scale ?? 1) * (f.scaleY ?? 1) });
  }

  /** A Pokémon icon in the LCD palette (by luma), or a silhouette in colour 15. */
  private icon(i: PoketchView['icons'][number], registries: Registries, base: Rgb[]): void {
    const sprites = registries.pokemonSprites.get(i.egg ? (`${i.species.split(':')[0]}:SPECIES_EGG` as Id) : i.species);
    const ref = (sprites?.forms[i.form] ?? sprites?.forms[0])?.icon;
    if (!ref) return;
    const img = this.image(ref);
    if (!img) return;
    const k = `${ref}|${i.frame}|${i.silhouette ? 1 : 0}`;
    let c = this.icons.get(k);
    if (!c) {
      c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 32 * i.frame, 32, 32, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32);
      for (let p = 0; p < d.data.length; p += 4) {
        if (!d.data[p + 3]) continue;
        const [r, gr, b] = [d.data[p]!, d.data[p + 1]!, d.data[p + 2]!].map((v) => Math.round((v * 31) / 255)) as Rgb;
        const luma = Math.min(3, Math.floor((r * 299 + gr * 587 + b * 114) / 1000) >> 3);
        const out = base[i.silhouette ? 15 : LUMA_SLOTS[luma]!]!;
        d.data.set([...out, 255], p);
      }
      g.putImageData(d, 0, 0);
      this.icons.set(k, c);
    }
    const g = this.g;
    g.save();
    g.translate(i.x, i.y);
    g.scale(i.scale * (i.hFlip ? -1 : 1), i.scale);
    g.drawImage(c, -16, -16);
    g.restore();
  }
}

