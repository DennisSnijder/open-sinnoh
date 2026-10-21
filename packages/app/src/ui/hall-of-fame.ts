/**
 * The Hall of Fame and the credits as DS scenes (contracts `HallOfFameView`, `CreditsView`): one composed screen
 * at a whole number of device pixels per DS pixel, full screen over black (never the split DS layout).
 *
 * - Induction: black, the ROM background (`ui2d/hall_of_fame/background`, the group's `…/group`) inside the
 *   frame window, the Pokémon's front picture, the player's trainer front picture, its text rows in the game font;
 *   the inward wipe and the fades.
 * - PC: the ROM background (`ui2d/hall_of_fame/pc`), the team's pictures (the selected one opaque), the title
 *   and the member's text in DS windows.
 * - Credits: one DS screen: the scene's ROM art (the bicycle rides' sky, the gender's memories and Twinleaf
 *   pictures), the ROM staff rows rising over it, the final line, then the OpenSinnoh card.
 *
 * Each scene is one root kept across ticks (redrawn in place); pictures draw once loaded.
 */
import type { AssetRef, CreditsView, HallOfFamePcView, HallOfFameRecordView, HallOfFameSprite, HallOfFameView, SceneLine } from '@opensinnoh/contracts';
import { CreditsScenery } from '@opensinnoh/render';
import type { Id } from '@opensinnoh/core';
import { wordmark } from '@opensinnoh/ui';
import { framed, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { sceneContext } from './evolution.ts';
import { drawSpotlights } from './hof-spotlights.ts';
import { bikePose } from './credits-bike.ts';

const W = 256;
const H = 192;

/** A canvas scene of `w`×`h` DS px with absolutely placed text, kept per Art and redrawn every tick. */
class Scene {
  readonly root = el('section', 'ds-scene');
  readonly stage = el('div', 'ds-scene-stage');
  readonly canvas = document.createElement('canvas');
  readonly boxes = el('div', 'ds-scene-boxes');
  readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, HTMLImageElement | null>();
  private readonly tints = new Map<string, HTMLCanvasElement>();
  redraw: (() => void) | null = null;
  textKey = '';
  ride: CreditsScenery | null = null;

  constructor(
    private readonly art: Art,
    readonly w: number,
    readonly h: number,
    label: string,
  ) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.g.imageSmoothingEnabled = false;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', label);
    let attached = false;
    const observer = new MutationObserver(() => {
      if (this.root.isConnected) attached = true;
      else if (attached) {
        this.ride?.dispose();
        this.ride = null;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Whole-pixel scale: the largest that fits the room (full screen over black). */
  layout(d: DrawContext): DrawContext {
    const size = d.size ?? { width: innerWidth, height: innerHeight };
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.floor(Math.min(size.width / this.w, size.height / this.h) * dpr)) / dpr;
    this.stage.style.setProperty('--k', `${k}px`);
    this.stage.style.setProperty('--dot', `${k}px`);
    this.stage.style.width = `${this.w * k}px`;
    this.stage.style.height = `${this.h * k}px`;
    return sceneContext(d, k);
  }

  image(ref: AssetRef | undefined): HTMLImageElement | null {
    if (!ref) return null;
    if (!this.images.has(ref)) {
      this.images.set(ref, null);
      void this.art.image(ref).then((img) => {
        this.images.set(ref, img);
        if (this.root.isConnected) this.redraw?.();
      });
    }
    return this.images.get(ref) ?? null;
  }

  sheet(path: string): HTMLImageElement | null {
    return this.image(this.art.sheet(path)?.atlas);
  }

  /** NANR advances two frames per application tick (Sprite.animSpeed); positions use the cell origin. */
  sprite(path: string, sequence: number, tick: number, x: number, y: number, opacity = 1, tint?: readonly number[]): void {
    const sheet = this.art.sheet(path);
    const anim = sheet?.animations?.[sequence];
    const loaded = sheet && this.image(sheet.atlas);
    if (!anim || !loaded) return;
    let image: CanvasImageSource = loaded;
    if (tint) {
      const key = `${path}:${tint.join(',')}`;
      let colored = this.tints.get(key);
      if (!colored) {
        colored = document.createElement('canvas');
        colored.width = loaded.width;
        colored.height = loaded.height;
        const g = colored.getContext('2d')!;
        g.drawImage(image, 0, 0);
        const pixels = g.getImageData(0, 0, colored.width, colored.height);
        // The rider's palette blend is 4/16 in RGB555, with integer channel truncation.
        for (let i = 0; i < pixels.data.length; i += 4) for (let c = 0; c < 3; c++) {
          const from = Math.round(pixels.data[i + c]! * 31 / 255);
          const value = from + ((tint[c]! - from) >> 2);
          pixels.data[i + c] = (value << 3) | (value >> 2);
        }
        g.putImageData(pixels, 0, 0);
        this.tints.set(key, colored);
      }
      image = colored;
    }
    const total = anim.frames.reduce((sum, f) => sum + f.ticks, 0);
    let t = (tick * 2 + 1) % total;
    const frame = anim.frames.find(f => (t -= f.ticks) < 0)!;
    const c = sheet!.cells[frame.cell]!;
    this.g.save();
    this.g.globalAlpha = opacity;
    this.g.translate(Math.round(x + (frame.dx ?? 0)), Math.round(y + (frame.dy ?? 0)));
    this.g.rotate((frame.rotation ?? 0) * Math.PI * 2);
    this.g.scale(frame.scaleX ?? 1, frame.scaleY ?? 1);
    this.g.drawImage(image, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
    this.g.restore();
  }

  /** A Pokémon's front picture (80×80) centred at (x, y). */
  mon(d: DrawContext, m: HallOfFameSprite, x: number, y: number, alpha = 1): void {
    const form = d.registries.pokemonSprites.get(m.species)?.forms[m.form] ?? d.registries.pokemonSprites.get(m.species)?.forms[0];
    const face = form && ((m.female && form.frontFemale) || form.front);
    const img = form ? this.image(m.shiny ? form.shinyAtlas : form.atlas) : null;
    if (!img || !face) return;
    this.g.globalAlpha = alpha;
    this.g.drawImage(img, 0, face.y, 80, 80, Math.round(x - 40), Math.round(y - 40 + face.yOffset), 80, 80);
    this.g.globalAlpha = 1;
  }

  /** Text rows in the game font (light on the dark scenes), replaced only when they change. */
  text(d: DrawContext, lines: SceneLine[], palette: 'light' | 'ink' = 'light'): void {
    const key = JSON.stringify(lines);
    if (key === this.textKey) return;
    this.textKey = key;
    this.boxes.replaceChildren(
      ...lines.map((l) => {
        const box = el('div', 'hof-line', d.text(l.text, palette));
        box.style.left = `calc(var(--k) * ${l.x})`;
        box.style.top = `calc(var(--k) * ${l.y})`;
        if (l.width !== undefined) {
          box.style.width = `calc(var(--k) * ${l.width})`;
          box.style.textAlign = 'center';
        }
        return box;
      }),
    );
  }

  /** Black over the whole canvas by `1 − brightness`. */
  dim(brightness: number): void {
    if (brightness >= 1) return;
    this.g.fillStyle = `rgb(0 0 0 / ${1 - brightness})`;
    this.g.fillRect(0, 0, this.w, this.h);
  }
}

const scenes = new WeakMap<Art, Map<string, Scene>>();
function scene(d: DrawContext, key: string, w: number, h: number, label: string): Scene {
  let byKey = scenes.get(d.art);
  if (!byKey) scenes.set(d.art, (byKey = new Map()));
  let s = byKey.get(key);
  if (!s || !s.root.isConnected) byKey.set(key, (s = new Scene(d.art, w, h, label)));
  return s;
}

export function hallOfFame(d: DrawContext, v: HallOfFameView): HTMLElement {
  return v.mode === 'record' ? record(d, v) : pc(d, v);
}

function record(d0: DrawContext, v: HallOfFameRecordView): HTMLElement {
  const s = scene(d0, 'record', W, H, 'Hall of Fame');
  const d = s.layout(d0);
  const draw = () => {
    const g = s.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const clip = (x0: number, y0: number, x1: number, y1: number, art: string) => {
      const img = s.sheet(art);
      const [l, t, r, b] = [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1)];
      if (!img || r <= l || b <= t) return;
      g.drawImage(img, l, t, r - l, b - t, l, t, r - l, b - t);
    };
    if (v.member?.frame) clip(v.member.frame.x, v.member.frame.y, v.member.frame.x + 96, v.member.frame.y + 128, 'hall_of_fame/background');
    if (v.member) s.mon(d, v.member.mon, v.member.x, 96);
    if (v.group) {
      const f = v.group.frame;
      clip(f.left, f.top, f.right + 1, f.top + 144, 'hall_of_fame/group');
      const ns = [...d.registries.newGame.keys()][0]!.split(':')[0]!;
      const trainer = d.registries.trainerSprites.get(`${ns}:TRAINER_CLASS_PLAYER_${v.group.player.gender === 'female' ? 'FEMALE' : 'MALE'}` as Id);
      const sheet = trainer && d.registries.ui2d.get(trainer.front);
      const img = sheet ? s.image(sheet.atlas) : null;
      const c = sheet?.cells[0];
      if (img && c) g.drawImage(img, c.x, c.y, c.w, c.h, 128 - c.ox, v.group.player.y - c.oy, c.w, c.h);
      for (const p of v.group.party) s.mon(d, p.mon, p.x, p.y);
      if (v.group.confetti) {
        // The confetti (decomp HallOfFame confetti task): falling flecks, from the tick.
        const colors = ['#f8e050', '#f87878', '#78b0f8', '#78e078', '#f8f8f8'];
        for (let i = 0; i < 48; i++) {
          g.fillStyle = colors[i % colors.length]!;
          g.fillRect((i * 53 + 7) % W, (((i * 37 + v.tick * (1 + (i % 3))) % (H + 8)) + H + 8) % (H + 8) - 4, 2, 2);
        }
      }
    }
    // BG0 is in front of the pictures (OBJ priority 3), but behind the black window mask and text.
    const window = v.member?.frame ? { x: v.member.frame.x, y: v.member.frame.y, w: 96, h: 128 }
      : v.group ? { x: v.group.frame.left, y: v.group.frame.top, w: v.group.frame.right + 1 - v.group.frame.left, h: 144 } : null;
    if (window) {
      g.save();
      g.beginPath();
      g.rect(window.x, window.y, window.w, window.h);
      g.clip();
      drawSpotlights(g, v.tick);
      g.restore();
    }
    if (v.wipe) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, v.wipe.top);
      g.fillRect(0, v.wipe.bottom, W, H - v.wipe.bottom);
    }
    s.dim(v.brightness);
  };
  s.redraw = draw;
  draw();
  s.text(d, [...(v.member?.lines ?? []), ...(v.group?.lines ?? [])]);
  s.boxes.style.opacity = String(v.brightness);
  return s.root;
}

function pc(d0: DrawContext, v: HallOfFamePcView): HTMLElement {
  const s = scene(d0, 'pc', W, H, 'Hall of Fame');
  const d = s.layout(d0);
  const draw = () => {
    const g = s.g;
    const bg = s.sheet('hall_of_fame/pc');
    if (bg) g.drawImage(bg, 0, 0);
    else {
      g.fillStyle = '#f0a020';
      g.fillRect(0, 0, W, H);
    }
    // The team in a row (decomp: the selected picture in front, the others translucent).
    const n = v.party.length;
    v.party.forEach((m, i) => s.mon(d, m, (W / n) * (i + 0.5), 72, i === v.selected ? 1 : 0.45));
    s.dim(v.brightness);
  };
  s.redraw = draw;
  draw();
  // The title window (tiles 1–30 × 1–2) and the member's window (1–30 × 16–22), standard frames.
  const key = JSON.stringify([v.title, v.lines]);
  if (s.boxes.dataset.key !== key) {
    s.boxes.dataset.key = key;
    const title = framed(d, 'hof-pc-title', d.text(v.title, 'ink'));
    place(title, { x: 8, y: 8, w: 240, h: 24 });
    const body = framed(d, 'hof-pc-body');
    place(body, { x: 8, y: 128, w: 240, h: 56 });
    const rows = v.lines.map((l) => {
      const row = el('div', 'hof-line', d.text(l.text, 'ink'));
      row.style.left = `calc(var(--k) * ${l.x})`;
      row.style.top = `calc(var(--k) * ${l.y})`;
      return row;
    });
    s.boxes.replaceChildren(title, body, ...rows);
  }
  s.boxes.style.opacity = String(v.brightness);
  return s.root;
}

function place(e: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  e.style.left = `calc(var(--k) * ${r.x})`;
  e.style.top = `calc(var(--k) * ${r.y})`;
  e.style.width = `calc(var(--k) * ${r.w})`;
  e.style.height = `calc(var(--k) * ${r.h})`;
}

/** Decomp EndCredits final screen: the last row centred at y 80. */
const FINAL_Y = 80;
/** The bicycle scenes' sky pictures by time. */
const RIDES = new Set(['morning', 'day', 'night']);

export function credits(d0: DrawContext, v: CreditsView): HTMLElement {
  const s = scene(d0, 'credits', W, H, 'Credits');
  const d = s.layout(d0);
  const draw = () => {
    const g = s.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const ride = RIDES.has(v.scene);
    const skyAge = Math.max(0, v.frame - 7621);
    const skyFrame = Math.min(7, Math.floor(skyAge / 5));
    const pic = ride ? s.sheet(v.scene === 'night' ? `credits/night_bottom_${skyFrame}` : `credits/${v.scene}_bottom`) : v.memory !== null ? s.sheet(`credits/${v.gender}/${v.scene === 'memories' ? 'memory' : 'twinleaf'}_${v.memory}`) : null;
    if (pic) {
      const ox = v.scene === 'morning' ? Math.trunc(-v.sceneFrame / 64) : 0;
      const oy = v.scene === 'day' ? Math.trunc(v.sceneFrame * 96 / 4096) : 0;
      const x = -((ox % pic.width + pic.width) % pic.width);
      const y = -((oy % pic.height + pic.height) % pic.height);
      for (let dy = y; dy < H; dy += pic.height) for (let dx = x; dx < W; dx += pic.width) g.drawImage(pic, dx, dy);
    }
    if (ride) {
      if (v.scene === 'night' && skyFrame < 7) {
        const next = s.sheet(`credits/night_bottom_${skyFrame + 1}`);
        if (next) { g.globalAlpha = (skyAge % 5) / 4; g.drawImage(next, 0, 0); g.globalAlpha = 1; }
      }
      const data = [...d.registries.newGame.values()][0]?.creditsRide;
      if (data && !s.ride) s.ride = new CreditsScenery(data, d.registries, { get: async ref => new Blob([await d.art.bytes(ref) as Uint8Array<ArrayBuffer>]) }, () => { if (s.root.isConnected) s.redraw?.(); });
      s.canvas.dataset.rideReady = String(s.ride?.ready ?? false);
      if (s.ride?.ready) {
        s.ride.draw(v.scene as 'morning' | 'day' | 'night', v.sceneFrame);
        g.drawImage(s.ride.canvas, 0, 0);
      }
      // Main-engine OBJ sprites: scarf behind the player, both anchored at (192,160).
      const tint = v.scene === 'morning' ? [28, 12, 6] : v.scene === 'night' ? [11, 11, 16] : undefined;
      s.sprite(`credits/${v.gender}/bike`, 2, v.sceneFrame, 192, 160, 1, tint);
      const animations = d.art.sheet(`credits/${v.gender}/bike`)?.animations;
      if (animations) {
        const pose = bikePose(animations, v.sceneFrame);
        s.sprite(`credits/${v.gender}/bike${pose.eyes === null ? '' : `_eyes_${pose.eyes}`}`, pose.sequence, pose.tick, 192, 160, 1, tint);
      }
      if (v.scene === 'night') {
        // The meteor enters this view only after traversing the other DS screen (18 frames).
        for (const [start, x] of [[7200, 200], [7380, 144], [7440, 180]]) {
          const age = v.frame - start! - 18;
          if (age >= 0 && age < 20) s.sprite('credits/objects', 3, v.sceneFrame, x! - 6 * (age + 18), -32 + 13 * age, Math.max(0, (31 - age * 3) / 31));
        }
      }
    }
    // The DS brightness controller darkens the scene, not the text layer.
    s.dim(v.brightness);
  };
  s.redraw = draw;
  draw();
  if (v.card) {
    // The OpenSinnoh card (engine text, not the ROM's): the brand's wordmark (×3 per DS pixel, dark tokens) and its
    // lines in the page's font. Static: the card's own fade is its timing.
    if (!s.boxes.querySelector('.credits-card')) {
      const mark = wordmark(3, { label: v.card.title });
      mark.classList.add('credits-card-mark');
      const card = el('div', 'credits-card', mark, ...v.card.lines.map((l) => el('p', '', l)));
      card.dataset.theme = 'dark';
      s.boxes.replaceChildren(card);
      s.textKey = 'card';
    }
  } else s.text(d, v.final !== null ? [{ text: v.final, x: 0, y: FINAL_Y, width: W }] : v.lines);
  s.boxes.style.opacity = String(v.screen);
  s.canvas.style.opacity = String(v.screen);
  return s.root;
}

