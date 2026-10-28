/**
 * The starter-choice scene (decomp choose_starter_app.c), drawn for the VM's `choice` panel when its
 * options are the starter species. The game logic is the panel's: the VM's cursor is the selected ball,
 * left/right (or up/down) move it, A takes it, and a touch on an option's panel rect takes that one. This
 * view only draws, and turns taps into that input: a tap on another ball moves the cursor there (one
 * d-pad press per tick, so replays record plain presses), a tap on the selected ball, its disc or YES
 * takes it (a panel touch on its rect).
 *
 * One full-bleed composition (docs/decisions.md: single screen): the grass floor fills the view, the briefcase
 * opens (its clip), the camera moves in, the pointing hand bobs over the selected ball, and that ball's
 * Pokémon pops up on its white disc with its name and type; the message window asks the DS's question.
 * See docs/research/starter-choice.md.
 */
import type { Id } from '@opensinnoh/core';
import { choiceRects, type AssetSource, type LoadedFont, type PanelView, type Registries, type Ui2dSheet } from '@opensinnoh/contracts';
import { drawText } from '@opensinnoh/text';
import type { InputState } from '../input.ts';
import { starterLayout, type Rect, type StarterLayout } from './layout.ts';
import { BALL_POSITIONS, StarterScene3d } from './scene3d.ts';
import { askMarkup, colourLines, plain, type Run } from './text.ts';
import './starter.css';

/** Test handle (`window.openSinnohStarter`). */
export interface StarterHandle {
  readonly phase: Phase;
  readonly cursor: number;
  /** The species on the disc (null before the balls show). */
  readonly preview: string | null;
  /** The last frame drew the disc at rest (its pop-up is over). */
  readonly popped: boolean;
  /** Client coordinates of ball `i`'s centre. */
  ballPoint(i: number): { x: number; y: number };
  /** The disc at rest, in device pixels of the 2D canvas (`.starter-2d`). */
  previewBox(): { x: number; y: number; width: number; height: number };
}

declare global {
  interface Window {
    openSinnohStarter?: StarterHandle;
  }
}

type Phase = 'loading' | 'intro' | 'choose' | 'closing' | 'done';
type ChoicePanel = Extract<PanelView, { kind: 'choice' }>;

/** Bank 360 (pl_msg): entries 1–3 ask about each slot's species, entry 7 is "Now choose!". */
const CHOOSE_STARTER_BANK = 360;
const ASKS = [1, 2, 3];
const PROMPT = 7;
/** DS timings in 30 Hz frames (UpdateGraphics, AdvancePokeballChoiceGraphics, StartPreviewWindowMovement). */
const T = {
  fade: 6,
  /** The DS waits 36 frames (the bag noise) before opening; input is live here from the start, so less. */
  delay: 10,
  camera: 6,
  cursorDelay: 6,
  pop: 6,
  /** Cursor bob: sin over 32 frames, 8 px (StartCursorMovement). */
  bobPeriod: 32,
  bob: 8,
} as const;
/** DS backdrop (palette 0 colour 0 = 0x08C3). */
const BACKDROP = 'rgb(24 49 16)';
/** Where the hand points over each ball, DS px (MakeSelectionMatrices otherSelectionMatrix). */
const CURSOR_AT: readonly [number, number][] = [
  [78, 55],
  [130, 82],
  [172, 50],
];
const POP_FROM_Y = 48;
const POP_SCALE = 0.4;
/** Tap radius around a ball's centre, DS px. */
const BALL_HIT = 20;
/** Message window frame (the field's message box look, packages/text overlay). */
const FRAME = { border: '#484850', inner: '#a8b0b8' };
const LINE = 16;
const FPS = 30;

/** True when a choice panel offers species with starter slots: the briefcase scene draws it. */
export function isStarterChoice(view: PanelView, registries: Registries): view is ChoicePanel {
  return view.kind === 'choice' && view.options.length > 0 && view.options.every((o) => registries.species.get(o.id as Id)?.starterSlot !== undefined);
}

export interface StarterDeps {
  parent: HTMLElement;
  registries: Registries;
  /** The base pack's namespace (scene models and sheets). */
  ns: string;
  assets: AssetSource;
  font: LoadedFont;
  input: InputState;
}

interface Option {
  species: Id;
  name: string;
  types: string[];
  /** Front frames 0/1 as canvases (80×80). */
  frames: HTMLCanvasElement[];
  anim: { frame: number; ticks: number }[];
  /** Shift (px) that centres frame 0's opaque pixels on the disc. */
  centre: { x: number; y: number };
  ask: Run[][];
}

async function image(assets: AssetSource, ref: string): Promise<ImageBitmap> {
  return createImageBitmap(await assets.get(ref as never));
}

function crop(src: CanvasImageSource, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Offset of the opaque pixels' centre from the frame's centre (the disc shows the Pokémon centred). */
function opaqueCentre(c: HTMLCanvasElement): { x: number; y: number } {
  const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let [x0, y0, x1, y1] = [c.width, c.height, -1, -1];
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (px[(y * c.width + x) * 4 + 3]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (x1 < 0) throw new Error('starter scene: an empty front picture');
  return { x: Math.round((x0 + x1 + 1) / 2 - c.width / 2), y: Math.round((y0 + y1 + 1) / 2 - c.height / 2) };
}

/** The message font recoloured: the atlas has two inks (dark letters, light shadow). */
function tint(font: LoadedFont, fg: number[], shadow: number[]): LoadedFont {
  const src = font.image as ImageBitmap | HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const col = img.data[i]! < 140 ? fg : shadow;
    img.data.set(col.slice(0, 3), i);
  }
  ctx.putImageData(img, 0, 0);
  return { ...font, image: c };
}

export class StarterScene {
  private readonly el: HTMLDivElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly live: HTMLParagraphElement;
  private readonly buttons: HTMLButtonElement[];
  private scene3d: StarterScene3d | null = null;
  private art: { cursor: { img: ImageBitmap; sheet: Ui2dSheet }; disc: ImageBitmap; colors: number[][]; fonts: Map<number, LoadedFont>; options: Option[]; prompt: Run[][]; yes: string } | null = null;
  private layout: StarterLayout = starterLayout(1, 1, 1);
  private box: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private phase: Phase = 'loading';
  private start = 0;
  private closeAt = 0;
  private panel: ChoicePanel;
  private cursor = -1;
  private popAt = 0;
  /** Ball a tap asked for; the view presses toward it one step per tick. */
  private target: number | null = null;
  private steppedFrom: number | null = null;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** A load failure, thrown from the next frame (the loop shows it). */
  private failed: Error | null = null;
  private readonly handle: StarterHandle;
  private announced = '';
  /** The ball whose Pokémon the last frame drew at rest, or null mid-pop. */
  private poppedFor: number | null = null;

  constructor(
    private readonly deps: StarterDeps,
    panel: ChoicePanel,
  ) {
    this.panel = panel;
    this.el = document.createElement('div');
    this.el.className = 'starter';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', plain(panel.title));
    this.el.style.background = BACKDROP;
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'starter-2d';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.live = document.createElement('p');
    this.live.className = 'sr-only';
    this.live.setAttribute('aria-live', 'polite');
    // Visually hidden buttons: the options for assistive technology (they act like taps).
    this.buttons = panel.options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sr-only';
      b.textContent = o.label;
      b.addEventListener('click', () => this.tapBall(i));
      return b;
    });
    this.el.append(this.overlay, this.live, ...this.buttons);
    this.el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    deps.parent.append(this.el);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.handle = window.openSinnohStarter = {
      get phase() {
        return self.phase;
      },
      get cursor() {
        return self.panel.cursor;
      },
      get popped() {
        return self.poppedFor === self.panel.cursor;
      },
      get preview() {
        return self.phase === 'choose' || self.phase === 'closing' ? (self.art?.options[self.panel.cursor]?.species ?? null) : null;
      },
      ballPoint(i) {
        const p = self.ballCss(i);
        const r = self.el.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      previewBox() {
        const { preview } = self.layout;
        const dpr = devicePixelRatio || 1;
        const half = 48 * preview.k * dpr;
        return { x: Math.round(preview.x * dpr - half), y: Math.round(preview.y * dpr - half), width: Math.round(2 * half), height: Math.round(2 * half) };
      },
    };
    this.load().catch((e: Error) => {
      this.failed = e;
    });
  }

  private async load(): Promise<void> {
    const { registries, ns, assets, font } = this.deps;
    const sheet = (name: string) => {
      const s = registries.ui2d.get(`${ns}:ui2d/choose_starter/${name}` as Id);
      if (!s) throw new Error(`starter scene: no ui2d sheet ${ns}:ui2d/choose_starter/${name}`);
      return s;
    };
    const bank = [...registries.textBanks.values()].find((b) => b.sourceIndex === CHOOSE_STARTER_BANK);
    if (!bank) throw new Error(`starter scene: no text bank ${CHOOSE_STARTER_BANK}`);
    const message = (i: number) => {
      const text = registries.texts.get(bank.messages[i]!)?.text;
      if (text === undefined) throw new Error(`starter scene: bank ${bank.id} has no message ${i}`);
      return text;
    };
    const asks = ASKS.map(message);
    // The YES button's label: the field YES/NO box's (MenuEntries_Text_Yes).
    const yes = registries.texts.get(`${ns}:MenuEntries_Text_Yes` as Id)?.text;
    if (yes === undefined) throw new Error(`starter scene: no text ${ns}:MenuEntries_Text_Yes`);
    const cursorSheet = sheet('cursor');
    const [cursorImg, disc, colorsImg, scene3d, options] = await Promise.all([
      image(assets, cursorSheet.atlas),
      image(assets, sheet('preview_window').atlas),
      image(assets, sheet('text_colors').atlas),
      StarterScene3d.load(assets, registries, ns),
      Promise.all(
        this.panel.options.map(async (o, slot): Promise<Option> => {
          const species = registries.species.get(o.id as Id)!;
          const sprites = registries.pokemonSprites.get(o.id as Id);
          if (!sprites) throw new Error(`starter scene: no pokemonSprites for ${o.id}`);
          const form = sprites.forms[0]!;
          const atlas = await image(assets, form.atlas);
          const types = [...new Set(species.types)].map((t) => registries.types.get(t)?.name ?? t);
          return {
            species: o.id as Id,
            name: species.name,
            types,
            frames: [0, 80].map((x) => crop(atlas, x, form.front.y, 80, 80)),
            anim: sprites.front.frames.map((f) => ({ frame: f.frame, ticks: f.ticks })),
            centre: opaqueCentre(crop(atlas, 0, form.front.y, 80, 80)),
            ask: colourLines(askMarkup(asks, slot, species.name)),
          };
        }),
      ),
    ]);
    const cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 1;
    const cctx = cv.getContext('2d', { willReadFrequently: true })!;
    cctx.drawImage(colorsImg, 0, 0);
    const px = cctx.getImageData(0, 0, 16, 1).data;
    const colors = Array.from({ length: 16 }, (_, i) => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!]);
    const fonts = new Map<number, LoadedFont>();
    for (let n = 0; n < 4; n++) fonts.set(n, tint(font, colors[n ? 1 + 2 * n : 1]!, colors[n ? 2 + 2 * n : 2]!));
    if (this.phase === 'done') {
      scene3d.dispose();
      return;
    }
    this.art = { cursor: { img: cursorImg, sheet: cursorSheet }, disc, colors, fonts, options, prompt: colourLines(message(PROMPT)), yes: plain(yes) };
    this.scene3d = scene3d;
    this.el.prepend(scene3d.canvas);
    this.el.style.background = scene3d.floorEdge;
    this.resize(this.box);
    this.phase = 'intro';
    this.start = performance.now();
  }

  /** Places the scene over the field view (CSS px). */
  resize(box: Rect): void {
    this.box = box;
    Object.assign(this.el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    const dpr = devicePixelRatio || 1;
    this.layout = starterLayout(box.width, box.height, dpr);
    this.overlay.width = Math.round(box.width * dpr);
    this.overlay.height = Math.round(box.height * dpr);
    this.overlay.style.width = `${box.width}px`;
    this.overlay.style.height = `${box.height}px`;
    this.scene3d?.resize(box.width, box.height, this.layout.u, this.layout.ds);
  }

  private frameNo(): number {
    return Math.floor(((performance.now() - this.start) * FPS) / 1000);
  }

  /** Intro beats in frames: [the bag starts opening, it is open (the camera moves in), the cursor shows]. */
  private beats(): [number, number, number] {
    if (this.reduced) return [0, 0, 0];
    const open = T.delay + this.scene3d!.bagFrames;
    return [T.delay, open, open + T.camera + T.cursorDelay];
  }

  /** Per render frame: the panel as the VM shows it now. */
  frame(panel: ChoicePanel): void {
    this.panel = panel;
    if (this.failed) throw this.failed;
    if (!this.art || !this.scene3d) return;
    const t = this.frameNo();
    const [opens, open, cursorAt] = this.beats();
    if (this.phase === 'intro' && t >= cursorAt) this.phase = 'choose';
    if (panel.cursor !== this.cursor) {
      this.cursor = panel.cursor;
      this.popAt = Math.max(t, cursorAt);
    }
    this.stepToward();
    this.scene3d.render({
      bagFrame: t >= open ? null : Math.max(0, t - opens),
      camera: this.reduced ? 1 : Math.min(1, Math.max(0, (t - open) / T.camera)),
      selected: this.phase === 'choose' && !this.reduced ? panel.cursor : null,
      ballFrame: t - this.popAt,
    });
    this.draw(t, t >= cursorAt);
  }

  /** The VM took a ball (the panel went idle): fade to black, then remove. Resolves when gone. */
  close(): Promise<void> {
    if (this.phase === 'closing' || this.phase === 'done') return Promise.resolve();
    this.target = null;
    const wasLoading = this.phase === 'loading';
    this.phase = 'closing';
    this.closeAt = performance.now();
    if (wasLoading || this.reduced || !this.art) {
      this.dispose();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const step = () => {
        const t = this.frameNo();
        const k = Math.min(1, ((performance.now() - this.closeAt) * FPS) / 1000 / T.fade);
        this.scene3d!.render({ bagFrame: null, camera: 1, selected: null, ballFrame: 0 });
        this.draw(t, true, k);
        if (k >= 1) {
          this.dispose();
          resolve();
        } else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  dispose(): void {
    this.phase = 'done';
    this.scene3d?.dispose();
    this.el.remove();
    if (window.openSinnohStarter === this.handle) delete window.openSinnohStarter;
  }

  // --- input -----------------------------------------------------------------------------------

  private toDs(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const { ds, u } = this.layout;
    return { x: (e.clientX - r.left - ds.x) / u, y: (e.clientY - r.top - ds.y) / u };
  }

  private pointerDown(e: PointerEvent): void {
    if (this.phase !== 'choose') return;
    e.preventDefault();
    const p = this.toDs(e);
    const balls = BALL_POSITIONS.map((b) => StarterScene3d.toDs(b));
    const hit = balls.findIndex((b) => Math.hypot(b.x - p.x, b.y - p.y) <= BALL_HIT);
    if (hit >= 0 && hit < this.panel.options.length) return this.tapBall(hit);
    const r = this.el.getBoundingClientRect();
    const css = { x: e.clientX - r.left, y: e.clientY - r.top };
    const { preview, yes } = this.layout;
    const onDisc = Math.hypot(css.x - preview.x, css.y - preview.y) <= 48 * preview.k;
    const onYes = css.x >= yes.x - 6 * this.layout.u && css.x < yes.x + yes.width + 6 * this.layout.u && css.y >= yes.y - 6 * this.layout.u && css.y < yes.y + yes.height + 6 * this.layout.u;
    if (onDisc || onYes) this.confirm(this.panel.cursor);
  }

  /** A tap on ball `i`: take it when it is the selected one, else move the cursor there. */
  private tapBall(i: number): void {
    if (this.phase !== 'choose') return;
    if (i === this.panel.cursor) this.confirm(i);
    else {
      this.target = i;
      this.steppedFrom = null;
    }
  }

  /**
   * Takes option `i` the way the VM reads a panel touch: a touch inside its choice rect. A touch that
   * starts and ends between two ticks still reaches the next one (InputState keeps it).
   */
  private confirm(i: number): void {
    const r = choiceRects(this.panel.options.length)[i]!;
    this.target = null;
    this.deps.input.setTouch('starter', { x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y + r.height / 2) });
    this.deps.input.setTouch('starter', null);
  }

  /** One d-pad press toward the tapped ball, once the previous one has moved the cursor. */
  private stepToward(): void {
    if (this.target === null) return;
    const cursor = this.panel.cursor;
    if (cursor === this.target || this.phase !== 'choose') {
      this.target = null;
      return;
    }
    if (this.steppedFrom === cursor) return;
    this.steppedFrom = cursor;
    const button = this.target > cursor ? 'right' : 'left';
    this.deps.input.set('starter', button, true);
    this.deps.input.set('starter', button, false);
  }

  // --- drawing ---------------------------------------------------------------------------------

  private ballCss(i: number): { x: number; y: number } {
    const p = StarterScene3d.toDs(BALL_POSITIONS[i]!);
    const { ds, u } = this.layout;
    return { x: ds.x + p.x * u, y: ds.y + p.y * u };
  }

  private draw(t: number, cursorShown: boolean, fadeOut = 0): void {
    const art = this.art!;
    const ctx = this.overlay.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.imageSmoothingEnabled = false;
    const { ds, u, preview, message, yes } = this.layout;
    const s = Math.round(u * dpr);
    const dev = (v: number) => Math.round(v * dpr);
    const option = art.options[this.panel.cursor];
    const shown = cursorShown && this.phase !== 'loading' && !!option;

    if (shown) {
      // The pointing hand bobs over the selected ball (cell origin at the DS position).
      const [cx, cy] = CURSOR_AT[this.panel.cursor]!;
      const bob = this.reduced || this.phase === 'closing' ? 0 : Math.round(Math.sin(((t % T.bobPeriod) / T.bobPeriod) * Math.PI * 2) * T.bob);
      const cell = art.cursor.sheet.cells[0]!;
      ctx.drawImage(art.cursor.img, cell.x, cell.y, cell.w, cell.h, dev(ds.x) + (cx - cell.ox) * s, dev(ds.y) + (cy + bob - cell.oy) * s, cell.w * s, cell.h * s);

      // The disc and the Pokémon pop from the ball to their place (6 frames, scale 0.4 → 1).
      const pop = this.reduced ? 1 : Math.min(1, Math.max(0, (t - this.popAt) / T.pop));
      this.poppedFor = pop >= 1 ? this.panel.cursor : null;
      const from = { x: ds.x + cx * u, y: ds.y + (cy + POP_FROM_Y) * u };
      const at = { x: from.x + (preview.x - from.x) * pop, y: from.y + (preview.y - from.y) * pop };
      const ks = Math.max(1, Math.round(preview.k * dpr * (POP_SCALE + (1 - POP_SCALE) * pop)));
      ctx.drawImage(art.disc, dev(at.x) - 64 * ks, dev(at.y) - 64 * ks, 128 * ks, 128 * ks);
      const frame = this.spriteFrame(option, t - this.popAt - T.pop);
      ctx.drawImage(option.frames[frame]!, dev(at.x) - (40 + option.centre.x) * ks, dev(at.y) - (40 + option.centre.y) * ks, 80 * ks, 80 * ks);
      if (pop >= 1) this.drawNameplate(ctx, option, preview, dpr);
      this.drawWindow(ctx, message, option.ask, dpr, s);
      this.drawWindow(ctx, yes, [[{ text: art.yes, color: 0 }]], dpr, s, true);
      this.announce(`${plain(option.ask.map((l) => l.map((r) => r.text).join('')).join('\n'))}`);
    } else {
      this.drawWindow(ctx, message, art.prompt, dpr, s);
    }
    const fadeIn = this.reduced ? 0 : Math.max(0, 1 - t / T.fade);
    const black = Math.max(fadeIn, fadeOut);
    if (black > 0) {
      ctx.fillStyle = `rgb(0 0 0 / ${black})`;
      ctx.fillRect(0, 0, this.overlay.width, this.overlay.height);
    }
  }

  /** The front picture's frame: the record's animation plays once after the pop, then frame 0. */
  private spriteFrame(o: Option, t: number): number {
    if (this.reduced || t < 0) return 0;
    for (const f of o.anim) {
      if (t < f.ticks) return f.frame;
      t -= f.ticks;
    }
    return 0;
  }

  private drawNameplate(ctx: CanvasRenderingContext2D, o: Option, p: StarterLayout['preview'], dpr: number): void {
    const k = Math.round(p.k * dpr);
    const font = this.art!.fonts.get(0)!;
    const name = o.name;
    const w = this.measure(name);
    const y = Math.round(p.y * dpr) + 50 * k;
    // Name on a paper strip, types as slate tags under it.
    const strip = { x: Math.round(p.x * dpr) - Math.ceil(w / 2 + 6) * k, y, w: (Math.ceil(w) + 12) * k, h: 18 * k };
    this.frameRect(ctx, strip.x, strip.y, strip.w, strip.h, k);
    drawText(ctx, font, name, strip.x + 6 * k, strip.y + 1 * k, k);
    const tags = o.types.map((t) => t.toUpperCase());
    const tagW = tags.map((t) => this.measure(t) + 10);
    let x = Math.round(p.x * dpr) - Math.round(((tagW.reduce((a, b) => a + b, 0) + 4 * (tags.length - 1)) * k) / 2);
    const light = this.lightFont();
    tags.forEach((tag, i) => {
      ctx.fillStyle = '#3a4256';
      ctx.fillRect(x, strip.y + strip.h + 4 * k, tagW[i]! * k, 15 * k);
      drawText(ctx, light, tag, x + 5 * k, strip.y + strip.h + 4 * k, k);
      x += (tagW[i]! + 4) * k;
    });
  }

  private lightFont(): LoadedFont {
    let f = this.art!.fonts.get(-1);
    if (!f) {
      f = tint(this.deps.font, [248, 248, 248], [90, 96, 112]);
      this.art!.fonts.set(-1, f);
    }
    return f;
  }

  private measure(s: string): number {
    let w = 0;
    for (const c of s) w += this.deps.font.glyph.get(c)?.width ?? this.deps.font.cellWidth;
    return w;
  }

  /** The field message box's frame around an interior (device px). */
  private frameRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number): void {
    const fill = this.art!.colors[15]!;
    ctx.fillStyle = FRAME.border;
    ctx.fillRect(x - 6 * s, y - 6 * s, w + 12 * s, h + 12 * s);
    ctx.fillStyle = FRAME.inner;
    ctx.fillRect(x - 4 * s, y - 4 * s, w + 8 * s, h + 8 * s);
    ctx.fillStyle = `rgb(${fill.join(' ')})`;
    ctx.fillRect(x - 3 * s, y - 3 * s, w + 6 * s, h + 6 * s);
  }

  private drawWindow(ctx: CanvasRenderingContext2D, r: Rect, lines: Run[][], dpr: number, s: number, arrow = false): void {
    const x = Math.round(r.x * dpr);
    const y = Math.round(r.y * dpr);
    this.frameRect(ctx, x, y, Math.round(r.width * dpr), Math.round(r.height * dpr), s);
    const left = arrow ? 12 : 0;
    lines.slice(0, 2).forEach((line, i) => {
      let cx = x + left * s;
      for (const run of line) {
        drawText(ctx, this.art!.fonts.get(run.color) ?? this.art!.fonts.get(0)!, run.text, cx, y + i * LINE * s, s);
        cx += this.measure(run.text) * s;
      }
    });
    if (arrow) {
      // The DS menu cursor: a small right-pointing arrow.
      ctx.fillStyle = FRAME.border;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + (2 + i) * s, y + (4 + i) * s, s, (7 - i * 2) * s);
    }
  }

  private announce(text: string): void {
    if (text === this.announced) return;
    this.announced = text;
    this.live.textContent = text.replace(/\n/g, ' ');
    this.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === this.panel.cursor)));
  }
}
