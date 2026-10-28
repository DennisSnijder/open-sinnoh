/**
 * The acting round's screen (contracts `ContestActingRoundView`; packages/menus contest/acting.ts owns the state):
 * the DS main screen as one 256×192 canvas in DS pixels at a whole number of device pixels per DS pixel, and the
 * touch screen's move and judge menus as a card while the player chooses. Layout as the other DS scenes (evolution):
 * a window over the dimmed field on big landscape views, else the room over black; on phones in portrait the card
 * has its own place under the stage, elsewhere it covers the stage while it is up (the judge buttons then carry each
 * judge's voltage meter).
 *
 * The stage, back to front (decomp ov17_0223B728's layers): BG3 the audience (its applause frame and glow; a move
 * animation's palette fade and switched background over it), the judges' boxes, the judges (hop, shake), the main
 * judge's mark, the voltage meters, BG2 the contestant panels with their names, hearts and order marks (faded while a
 * Pokémon performs), the performer's back picture (mirrored, as the DS flips symmetrical forms) and its move animation,
 * the flying stars and pips, the reaction bubble, BG1 the message window. Positions are the decomp's (see each draw).
 * Packs without the art (the fixture) get flat shapes in their place.
 */
import type { AnimBattlerView, AnimPicture, AssetRef, ContestActingChoiceView, ContestActingRoundView, Ui2dSheet } from '@opensinnoh/contracts';
import { capFlash } from '@opensinnoh/render/flash';
import { panelScale } from '../battle/scene.ts';
import { applyBattlerTransform, battlerTransform, css555, drawBgMon, fadeImage, mosaicImage, ParticleTextures } from '../battle/anim/draw.ts';
import { stop, type DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { place, sceneContext } from './evolution.ts';
import './contest-acting.css';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
/** Phones in portrait: the menu card's place under the stage (a gap, then the DS touch screen). */
const CARD = { gap: 4, height: 192 };
/** The message window's text (BG1's text box, two 16 px lines). */
const MESSAGE = { x: 88, y: 152, w: 160, h: 32 };
/** The touch screen's buttons (Unk_ov17_022532D0, Unk_ov17_022532A8: left, top, width, height). */
const MOVE_BUTTONS = [
  { x: 8, y: 8, w: 112, h: 88 },
  { x: 136, y: 8, w: 112, h: 88 },
  { x: 8, y: 104, w: 112, h: 88 },
  { x: 136, y: 104, w: 112, h: 88 },
];
const JUDGE_BUTTONS = [
  { x: 0, y: 8, w: 80, h: 120 },
  { x: 88, y: 8, w: 80, h: 120 },
  { x: 176, y: 8, w: 80, h: 120 },
  { x: 0, y: 136, w: 256, h: 56 },
];

type Img = HTMLImageElement;

class ActingScene {
  readonly root = el('section', 'ds-scene acting-scene');
  private readonly stage = el('div', 'ds-scene-stage acting-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly card = el('div', 'acting-card');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private readonly scratch = document.createElement('canvas');
  private readonly particles: ParticleTextures;
  private boxKey = '';
  private cardKey = '';
  private last: { d: DrawContext; v: ContestActingRoundView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas acting-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.particles = new ParticleTextures((id) => {
      const sheet = this.last?.d.registries.ui2d.get(id);
      const img = sheet ? this.image(sheet.atlas) : null;
      return sheet && img ? { sheet, img } : null;
    });
    this.stage.append(this.canvas, this.boxes, this.card);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', S.aria.acting);
  }

  private image(ref: string): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref as AssetRef).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.draw(this.last.d, this.last.v);
    });
    return null;
  }

  private sheet(path: string): { sheet: Ui2dSheet; img: Img } | null {
    const sheet = this.art.sheet(path);
    const img = sheet ? this.image(sheet.atlas) : null;
    return sheet && img ? { sheet, img } : null;
  }

  /** A sheet cell with its origin at (x, y). */
  private cell(path: string, n: number, x: number, y: number, alpha = 1): boolean {
    const s = this.sheet(path);
    const c = s?.sheet.cells[n];
    if (!s || !c) return false;
    const g = this.g;
    g.globalAlpha = alpha;
    g.drawImage(s.img, c.x, c.y, c.w, c.h, Math.round(x - c.ox), Math.round(y - c.oy), c.w, c.h);
    g.globalAlpha = 1;
    return true;
  }

  /** An animated sprite's cell: the sequence's frame at `tick` (NANR frames of `ticks` each, looped). */
  private animCell(path: string, anim: number, tick: number): number {
    const seq = this.art.sheet(path)?.animations?.[anim];
    if (!seq?.frames.length) return anim;
    const total = seq.frames.reduce((n, f) => n + f.ticks, 0) || 1;
    let t = tick % total;
    for (const f of seq.frames) {
      if (t < f.ticks) return f.cell;
      t -= f.ticks;
    }
    return seq.frames[0]!.cell;
  }

  draw(ctx: DrawContext, v: ContestActingRoundView): void {
    this.last = { d: ctx, v };
    const compact = ctx.compact;
    const d = sceneContext(ctx, this.layout(ctx, compact));
    this.paint(d, v);
    this.drawBoxes(d, v);
    this.drawCard(d, v.choice, v, compact);
  }

  /** The whole-pixel scale of the composition: the stage, and on phones in portrait the card's place under it. */
  private layout(d: DrawContext, compact: boolean): number {
    const size = d.size ?? { width: innerWidth, height: innerHeight };
    const dpr = devicePixelRatio || 1;
    const tall = compact ? H + CARD.gap + CARD.height : H;
    const panel = compact ? 0 : panelScale(size.width, size.height, false);
    const k = panel || Math.max(1, Math.floor(Math.min(size.width / W, size.height / tall) * dpr)) / dpr;
    this.root.classList.toggle('is-window', panel > 0);
    this.root.classList.toggle('is-compact', compact);
    this.stage.style.setProperty('--k', `${k}px`);
    this.stage.style.setProperty('--dot', `${k}px`);
    this.stage.style.width = `${W * k}px`;
    this.stage.style.height = `${tall * k}px`;
    this.canvas.style.height = `${H * k}px`;
    return k;
  }

  private paint(d: DrawContext, v: ContestActingRoundView): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const bg = v.anim?.bg;
    // BG3: the audience (the applause's other frame), its glow; an animation's shake, fade and switched background.
    g.save();
    if (bg?.grayscale) g.filter = 'grayscale(1)';
    if (bg && (bg.dx || bg.dy)) g.translate(-bg.dx, -bg.dy);
    const stage = v.audience ? 'contest/acting/stage_cheer' : 'contest/acting/stage';
    if (!this.cell(stage, 0, 0, 0)) {
      g.fillStyle = '#5a50b0';
      g.fillRect(0, 0, W, H);
    }
    if (v.glow) this.cell(`${stage}_glow`, 0, 0, 0, Math.min(1, v.glow / 16));
    g.restore();
    if (bg?.fade) {
      g.globalAlpha = capFlash(bg.fade.amount / 16);
      g.fillStyle = css555(bg.fade.color);
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    if (bg?.effect) {
      const s = this.sheet(bg.effect.sheet.slice(bg.effect.sheet.indexOf(':ui2d/') + 6));
      const c = s?.sheet.cells[bg.effect.cell];
      if (s && c) {
        g.globalAlpha = bg.effect.alpha;
        g.drawImage(s.img, c.x - bg.effect.dx, c.y - bg.effect.dy, W, H, 0, 0, W, H);
        g.globalAlpha = 1;
        if (bg.effect.fade) {
          g.globalAlpha = capFlash(bg.effect.fade.amount / 16) * bg.effect.alpha;
          g.fillStyle = css555(bg.effect.fade.color);
          g.fillRect(0, 0, W, H);
          g.globalAlpha = 1;
        }
      }
    }
    // The judges (ov17_02241720: x 96 + 32·seat, y 40; their boxes ov17_022418A4 at y 32), the main judge's mark
    // (ov17_02241D94: y 56), the voltage meters' pips (Unk_ov17_022536D8: 88 + 32·seat + 5·pip, 12; blinking at five).
    v.judges.forEach((j, seat) => {
      const x = 96 + 32 * seat;
      this.cell(`contest/acting/judge_box_${seat}`, 0, x, 32);
      if (!this.cell(`contest/acting/judge_${seat}`, 0, x + j.dx, 40 + j.dy)) {
        g.fillStyle = '#f0e0c0';
        g.fillRect(x - 8 + j.dx, 28 + j.dy, 16, 24);
      }
      if (j.main) this.cell('contest/acting/main_judge', 0, x, 56);
      j.pips.forEach((lit, k) => {
        if (!lit) return;
        const n = j.blink === null ? 0 : this.animCell('contest/acting/pip', 0, j.blink);
        if (!this.cell('contest/acting/pip', n, 88 + 32 * seat + 5 * k, 12)) {
          g.fillStyle = '#f8d840';
          g.fillRect(86 + 32 * seat + 5 * k, 10, 4, 4);
        }
      });
    });
    // BG2: the panels (ov17_022413E4: 80×48 a row, the contestant's palette), their hearts (Unk_ov17_0225370C:
    // 5 + 8·slot, 43 + 48·row; a heart's colour by the row of six it is in) and order marks (ov17_022430AC: 64, 42 + 48·row).
    v.panels.forEach((p, row) => {
      const a = v.panelAlpha;
      if (!this.cell('contest/acting/panel', p.contestant, 0, 48 * row, a)) {
        g.globalAlpha = a;
        g.fillStyle = p.player ? '#f8a830' : '#80d8f8';
        g.fillRect(0, 48 * row, 80, 48);
        g.globalAlpha = 1;
      }
      if (p.flash) {
        g.globalAlpha = (p.flash / 16) * a;
        g.fillStyle = '#fff';
        g.fillRect(0, 48 * row, 80, 48);
        g.globalAlpha = 1;
      }
      const hearts = Math.min(24, Math.floor(p.hearts / 10));
      for (let slot = 0; slot < Math.min(6, hearts); slot++) {
        const tier = Math.floor((hearts - 1 - slot) / 6);
        const x0 = 5 + 8 * slot;
        const y0 = 43 + 48 * row;
        const x = x0 + (40 - x0) * p.gather;
        const y = y0 + (24 + 48 * row - y0) * p.gather;
        if (!this.cell('contest/acting/hearts', tier, x, y, a)) {
          g.fillStyle = ['#f84868', '#f8a030', '#48a0f8', '#58c048'][tier]!;
          g.fillRect(x - 3, y - 3, 6, 6);
        }
      }
      if (p.slot !== null) this.cell('contest/acting/order', p.slot, 64, 42 + 48 * row, a);
    });
    // A move animation's BG2: a wave (Surf, Muddy Water) or a battler's picture, under the performer unless raised.
    const custom = v.anim?.bg.custom;
    if (custom) {
      const s = this.sheet(custom.sheet.slice(custom.sheet.indexOf(':ui2d/') + 6));
      const c = s?.sheet.cells[custom.cell];
      if (s && c && custom.alpha > 0) {
        const mod = (x: number, m: number) => ((x % m) + m) % m;
        g.globalAlpha = custom.alpha;
        for (const y of [mod(-custom.dy, 512), mod(-custom.dy, 512) - 512])
          for (const x of [mod(-custom.dx, 512), mod(-custom.dx, 512) - 512]) g.drawImage(s.img, c.x, c.y, c.w, c.h, x, y, c.w, c.h);
        g.globalAlpha = 1;
      }
    }
    const bgMon = v.anim?.bgMon;
    if (bgMon && !bgMon.front) this.drawBgMon(d, v, bgMon);
    // The performer: the back picture at (x, y + its height), mirrored; the move animation's transform on battler 0.
    if (v.performer) this.drawPerformer(d, v);
    if (bgMon?.front) this.drawBgMon(d, v, bgMon);
    if (v.anim) {
      for (const s of v.anim.sprites) {
        // Copies of the performer's sprite (a hidden target's are never drawn), at its place.
        if (s.kind === 'pokemon' && s.battler === 0 && v.performer) {
          const t: AnimBattlerView = { battler: 0, dx: s.x, dy: s.y, scaleX: s.scaleX, scaleY: s.scaleY, rotation: s.rotation, pivotX: 0, pivotY: 0, hidden: false, fade: s.fade, alpha: s.alpha };
          this.drawMon(d, v, s.picture ?? null, t, s.mosaic ?? 0);
          continue;
        }
        if (s.kind !== 'cell' || !s.sheet) continue;
        const sh = this.sheet(s.sheet.slice(s.sheet.indexOf(':ui2d/') + 6));
        const c = sh?.sheet.cells[s.cell!];
        if (!sh || !c) continue;
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.rotation * 2 * Math.PI);
        g.scale(s.scaleX, s.scaleY);
        g.globalAlpha = s.alpha;
        g.drawImage(sh.img, c.x, c.y, c.w, c.h, -c.ox, -c.oy, c.w, c.h);
        g.restore();
      }
      this.particles.draw(g, v.anim.particles, { x: 0, y: 0 }, 1);
    }
    for (const s of v.stars) this.cell(s.kind === 'star' ? 'contest/acting/star' : 'contest/acting/pip', 0, s.x, s.y);
    // The reaction bubble over the judge (Unk_ov17_022536E4: 96 + 32·seat, 20).
    v.judges.forEach((j, seat) => {
      if (j.reaction !== null) this.cell('contest/acting/reaction', j.reaction, 96 + 32 * seat, 20);
    });
    // BG1: the message window.
    if (!this.cell('contest/acting/window', 0, 0, 0)) {
      g.fillStyle = '#fff';
      g.fillRect(80, 144, 176, 48);
    }
    if (v.fade) {
      g.globalAlpha = v.fade;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  private drawPerformer(d: DrawContext, v: ContestActingRoundView): void {
    const t = battlerTransform(v.anim, 0);
    this.drawMon(d, v, t?.picture ?? null, t, 0);
  }

  /**
   * The 80×80 picture a contest animation shows: the performer's own back picture (mirrored as the DS flips symmetrical
   * forms) or another (`picture` of the hidden target: plain colours), drawn into the scratch canvas; null while it loads.
   */
  private monPicture(d: DrawContext, v: ContestActingRoundView, picture: AnimPicture | null, fade: { color: number; amount: number } | null, mosaic: number): { canvas: HTMLCanvasElement; yOffset: number } | null {
    const p = v.performer;
    const own = !picture || (picture.battler === 0 && p !== null);
    const species = picture?.species ?? p?.species;
    if (!species) return null;
    const sprites = d.registries.pokemonSprites.get(species);
    const form = sprites?.forms[picture?.form ?? p?.form ?? 0] ?? sprites?.forms[0];
    const back = picture ? picture.back : true;
    const female = own && p?.female === true;
    const face = form && ((female && (back ? form.backFemale : form.frontFemale)) || (back ? form.back : form.front));
    const img = form ? this.image(own && p?.shiny ? form.shinyAtlas : form.atlas) : null;
    if (!face || !img) return null;
    const c = this.scratch;
    c.width = 80;
    c.height = 80;
    const s = c.getContext('2d')!;
    s.clearRect(0, 0, 80, 80);
    s.save();
    if (own && p?.flip) {
      s.translate(80, 0);
      s.scale(-1, 1);
    }
    s.drawImage(img, 0, face.y, 80, 80, 0, 0, 80, 80);
    s.restore();
    fadeImage(s, 80, 80, fade);
    mosaicImage(s, 80, 80, mosaic);
    return { canvas: c, yOffset: face.yOffset };
  }

  /** A picture at the performer's place, at its own height, with an animation's transform, partial draw and OBJ mosaic. */
  private drawMon(d: DrawContext, v: ContestActingRoundView, picture: AnimPicture | null, t: AnimBattlerView | null, mosaic: number): void {
    const p = v.performer!;
    const pic = this.monPicture(d, v, picture, t?.fade ?? null, mosaic);
    const cx = p.x + (t?.dx ?? 0);
    const cy = p.y + (pic?.yOffset ?? 0) + (t?.dy ?? 0);
    const g = this.g;
    g.save();
    if (!applyBattlerTransform(g, t, { x: cx, y: cy, k: 1 })) {
      g.restore();
      return;
    }
    if (t?.partial) {
      g.beginPath();
      g.rect(Math.round(cx - 40) + t.partial.x, Math.round(cy - 40) + t.partial.y, t.partial.w, t.partial.h);
      g.clip();
    }
    if (!pic) {
      g.fillStyle = '#4060c0';
      g.beginPath();
      g.arc(cx, cy + 12, 24, 0, Math.PI * 2);
      g.fill();
    } else g.drawImage(pic.canvas, Math.round(cx - 40), Math.round(cy - 40));
    g.restore();
  }

  /** BG2 holding a battler's picture: the performer's (mirrored like it) or the hidden target's. */
  private drawBgMon(d: DrawContext, v: ContestActingRoundView, m: NonNullable<NonNullable<ContestActingRoundView['anim']>['bgMon']>): void {
    const pic = this.monPicture(d, v, m.picture, m.fade, 0);
    if (pic) drawBgMon(this.g, pic.canvas, m, { x: 0, y: 0 }, 1);
  }

  /** The panels' names (ov17_02242FE8: nickname at 1, 12 + 48·row; trainer at 1, 28 + 48·row) and the message. */
  private drawBoxes(d: DrawContext, v: ContestActingRoundView): void {
    const key = JSON.stringify([v.panels.map((p) => [p.mon, p.trainer, p.player]), v.panelAlpha > 0.5, v.message, d.scale]);
    if (key === this.boxKey) return;
    this.boxKey = key;
    const parts: HTMLElement[] = [];
    if (v.panelAlpha > 0.5)
      v.panels.forEach((p, row) => {
        // TEXT_COLOR(1, 2, 0) for the player, (5, 6, 0) for the others: the font's dark and blue-grey inks.
        for (const [text, y] of [[p.mon, 4 + 48 * row], [p.trainer, 20 + 48 * row]] as const) {
          const label = el('div', `acting-name${p.player ? ' is-player' : ''}`, d.text(text));
          place(label, { x: 4, y, w: 72, h: 16 });
          parts.push(label);
        }
      });
    if (v.message !== null) {
      const box = el('div', 'acting-message', d.flow(v.message, true));
      box.setAttribute('aria-live', 'polite');
      place(box, MESSAGE);
      parts.push(box);
    }
    this.boxes.replaceChildren(...parts);
  }

  /** The touch screen's menu (ov17_0223FCAC moves, ov17_0223FF38 judges), as a card. */
  private drawCard(d: DrawContext, c: ContestActingChoiceView | null, v: ContestActingRoundView, compact: boolean): void {
    const key = JSON.stringify([c, c?.stage === 'judge' ? v.judges.map((j) => j.pips) : null, d.scale, compact]);
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.classList.toggle('is-open', c !== null);
    this.card.classList.toggle('is-under', compact);
    if (!c) {
      this.card.replaceChildren();
      return;
    }
    const k = d.scale;
    const bg = this.art.cells(c.stage === 'move' ? 'contest/acting/menu_bg' : 'contest/acting/menu_judges', [0], k);
    const parts: HTMLElement[] = [];
    if (bg) parts.push(el('div', 'acting-card-bg', bg));
    if (c.stage === 'move')
      c.moves.forEach((m, i) => {
        const r = MOVE_BUTTONS[i]!;
        if (!m) {
          const blank = el('div', 'acting-button is-empty');
          const art = this.art.cells('contest/acting/move_button', [5], k);
          if (art) blank.append(art);
          place(blank, r);
          parts.push(blank);
          return;
        }
        const art = this.art.cells('contest/acting/move_button', [m.disabled ? 5 : m.type], k);
        const hearts = el('div', 'acting-hearts');
        for (let h = 0; h < m.hearts; h++) {
          const heart = this.art.cells('contest/acting/hearts', [0], k);
          if (heart) hearts.append(heart);
        }
        const icon = d.art.sheet('battle/type_icons') ? d.art.cells('battle/type_icons', [(['cool', 'beauty', 'cute', 'smart', 'tough'] as const)[m.type]!], k) : null;
        const b = stop(
          d,
          `move:${i}`,
          [...(art ? [el('div', 'acting-button-art', art)] : []), el('div', 'acting-move-name', d.text(m.name)), el('div', 'acting-move-meta', ...(icon ? [icon] : []), hearts), el('div', 'acting-move-lines', d.text(m.description[0]), d.text(m.description[1]))],
          `acting-button${m.disabled ? ' is-disabled' : ''}`,
          c.cursor === i,
        );
        if (m.disabled) b.setAttribute('aria-disabled', 'true');
        place(b, r);
        parts.push(b);
      });
    else
      JUDGE_BUTTONS.forEach((r, i) => {
        const content: HTMLElement[] = [];
        if (i < 3) {
          const j = c.judges[i]!;
          content.push(el('div', 'acting-judge-name', d.text(j.name)));
          const pips = el('div', 'acting-judge-pips');
          v.judges[i]!.pips.forEach((lit) => {
            const pip = lit ? this.art.cells('contest/acting/pip', [0], k) : null;
            pips.append(pip ?? el('span', `acting-pip${lit ? ' is-lit' : ''}`));
          });
          content.push(pips);
          if (j.main) {
            const mark = this.art.cells('contest/acting/main_judge', [0], k);
            if (mark) content.push(el('div', 'acting-judge-main', mark));
          }
        } else content.push(el('div', 'acting-judge-name', d.text(c.back)));
        const b = stop(d, i < 3 ? `judge:${i}` : 'back', content, 'acting-button acting-judge', c.cursor === i);
        place(b, r);
        parts.push(b);
      });
    this.card.replaceChildren(...parts);
  }
}

const scenes = new WeakMap<Art, ActingScene>();

/** The acting round's scene, redrawn in place every tick. */
export function actingScene(d: DrawContext, v: ContestActingRoundView): HTMLElement {
  let scene = scenes.get(d.art);
  if (!scene || !scene.root.isConnected) scenes.set(d.art, (scene = new ActingScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
