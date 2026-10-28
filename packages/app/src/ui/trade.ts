/**
 * The trade scene (`TradeView`; packages/menus trade.ts owns the timeline): one 256×192 DS screen on a canvas laid out
 * as the other DS scenes (evolution.ts `layoutScene`), with the DS message box. The ROM's 2D art per phase
 * (ui2d side-screens.ts): the send and receive phases' black field with the Pokémon's front picture; the ball's
 * light rings (`trade/ball` animation 0) as it goes into the ball and the Poké Ball cell bouncing; the ball rising in
 * the light column (cells 4–6) for the tube; the wormhole the ball rises through; the time of day's sky
 * (`trade/sky_<time>`) the other ball falls through; the rings opening on the received Pokémon (animation 2). The DS
 * draws the tube and the balls in 3D (BMD0 27): here they are these 2D layers. Packs without
 * the art (the fixture) get flat stand-ins.
 */
import type { TradeView } from '@opensinnoh/contracts';
import { capFlash } from '@opensinnoh/render/flash';
import { messageBox, type DrawContext } from './apps.ts';
import { el } from './core.ts';
import { layoutScene, MESSAGE, place, sceneContext } from './evolution.ts';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
/** Where the Pokémon stands (its 80×80 picture's centre) and the ball rests. */
const MON = { x: 128, y: 88 };
const BALL_CELL = 8;
/** `trade/ball` animations: the rings closing (0) and opening (2), one cell a frame every two ticks. */
const RINGS_IN = [0, 1, 2, 3, 4, 5, 6];
const RINGS_OUT = [6, 5, 4, 3, 2, 1, 0];
/** Send phase: the white flash into the ball (12 ticks), the ball's bounce, the fade out (menus trade.ts SEND). */
const SEND = { flash: 154, ball: 166, fade: 192 };

export function trade(ctx: DrawContext, v: TradeView): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.className = 'ds-scene-canvas trade-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const boxes = el('div', 'ds-scene-boxes');
  const stage = el('div', 'ds-scene-stage', canvas, boxes);
  const root = el('section', 'ds-scene trade-scene', stage);
  root.dataset.phase = v.phase;
  root.setAttribute('aria-label', v.message?.text ?? S.aria.trade);
  const d = sceneContext(ctx, layoutScene(ctx, root, stage));
  void paint(d, v, canvas);
  if (v.message) {
    const box = messageBox(d, v.message.text, v.message.waiting);
    box.classList.add('ds-scene-message');
    place(box, MESSAGE);
    boxes.append(box);
  }
  return root;
}

async function paint(d: DrawContext, v: TradeView, canvas: HTMLCanvasElement): Promise<void> {
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const sheet = (p: string) => d.art.sheet(p);
  const image = async (p: string) => {
    const s = sheet(p);
    return s ? { sheet: s, img: await d.art.image(s.atlas) } : null;
  };
  const mon = async (m: TradeView['sent']) => {
    const sprites = d.registries.pokemonSprites.get(m.species);
    const form = sprites?.forms[m.form] ?? sprites?.forms[0];
    const face = form && ((m.female && form.frontFemale) || form.front);
    return form && face ? { img: await d.art.image(m.shiny ? form.shinyAtlas : form.atlas), face } : null;
  };
  const backdrop = v.phase === 'wormhole' ? 'trade/wormhole' : v.phase === 'arrive' || v.phase === 'reveal' ? `trade/sky_${v.background}` : null;
  const [bg, ball, sent, received] = await Promise.all([backdrop ? image(backdrop) : null, image('trade/ball'), mon(v.sent), mon(v.received)]);

  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  if (backdrop) {
    if (bg) g.drawImage(bg.img, bg.sheet.cells[0]!.x, bg.sheet.cells[0]!.y, W, H, 0, 0, W, H);
    else {
      g.fillStyle = v.phase === 'wormhole' ? '#404048' : '#5868c8';
      g.fillRect(0, 0, W, H);
    }
  }
  const cell = (n: number, x: number, y: number, scale = 1) => {
    if (!ball) {
      g.fillStyle = n === BALL_CELL ? '#e04040' : 'rgb(255 240 160 / 0.6)';
      g.beginPath();
      g.arc(x, y, (n === BALL_CELL ? 7 : 24 - n * 3) * scale, 0, Math.PI * 2);
      g.fill();
      return;
    }
    const c = ball.sheet.cells[n]!;
    if (!c.w) return;
    const w = c.w * scale;
    const h = c.h * scale;
    g.drawImage(ball.img, c.x, c.y, c.w, c.h, Math.round(x - c.ox * scale), Math.round(y - c.oy * scale), Math.round(w), Math.round(h));
  };
  const drawMon = (m: Awaited<ReturnType<typeof mon>>, white = 0) => {
    if (!m) {
      g.fillStyle = '#d06048';
      g.fillRect(MON.x - 24, MON.y - 24, 48, 48);
      return;
    }
    g.drawImage(m.img, 0, m.face.y, 80, 80, MON.x - 40, MON.y - 40 + m.face.yOffset, 80, 80);
    if (white) {
      // The brightness fade on the Pokémon's own pixels (decomp BrightnessAnimState toward white).
      g.save();
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgb(255 255 255 / ${capFlash(white)})`;
      g.fillRect(MON.x - 40, MON.y - 40 + m.face.yOffset, 80, 80);
      g.restore();
    }
  };
  const t = v.tick;
  switch (v.phase) {
    case 'send': {
      if (t < SEND.ball) drawMon(sent, t < SEND.flash ? 0 : Math.min(1, (t - SEND.flash) / 12));
      if (t >= SEND.flash && t < SEND.ball) cell(RINGS_IN[Math.min(RINGS_IN.length - 1, (t - SEND.flash) >> 1)]!, MON.x, MON.y);
      if (t >= SEND.ball) {
        const k = t - SEND.ball;
        const bounce = Math.abs(Math.sin((k / 12) * Math.PI)) * Math.max(0, 16 - k / 2);
        cell(7, MON.x, MON.y + 24);
        cell(BALL_CELL, MON.x, MON.y + 16 - bounce);
      }
      if (t >= SEND.fade) {
        g.fillStyle = `rgb(0 0 0 / ${Math.min(1, (t - SEND.fade) / 24)})`;
        g.fillRect(0, 0, W, H);
      }
      break;
    }
    case 'tube': {
      // The ball rises in a column of light, smaller as it goes (the DS's 3D tube).
      const k = t / v.ticks;
      cell(4 + ((t >> 2) % 3), W / 2, H / 2);
      cell(BALL_CELL, W / 2, H - 40 - k * (H / 2 - 40), 1 - 0.75 * k);
      break;
    }
    case 'wormhole': {
      const k = t / v.ticks;
      cell(4 + ((t >> 2) % 3), W / 2, H / 2);
      cell(BALL_CELL, W / 2, H + 16 - k * (H + 32));
      break;
    }
    case 'arrive': {
      const k = Math.min(1, t / (v.ticks - 10));
      cell(BALL_CELL, MON.x, -16 + k * (MON.y + 32));
      break;
    }
    case 'reveal': {
      if (t < 30) {
        cell(BALL_CELL, MON.x, MON.y + 16);
        cell(RINGS_OUT[Math.min(RINGS_OUT.length - 1, t >> 2)]!, MON.x, MON.y);
      } else drawMon(received, Math.max(0, 1 - (t - 30) / 16));
      break;
    }
    case 'receive':
      drawMon(received);
      if (t >= v.ticks - 16) {
        g.fillStyle = `rgb(0 0 0 / ${(t - (v.ticks - 16)) / 16})`;
        g.fillRect(0, 0, W, H);
      }
      break;
  }
}
