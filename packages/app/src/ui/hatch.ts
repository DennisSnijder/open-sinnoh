/**
 * The egg hatching scene (`HatchView`): one 256×192 DS screen on a canvas at a whole number of device pixels
 * per DS pixel, laid out as the evolution scene (a window over the dimmed field on big landscape views, else
 * full screen over black): the ROM background, the egg cell (shaken and scaled about its centre), the
 * Pokémon's front picture, the fade to white, the black bars; the DS message box and YES/NO at their DS places
 * (decomp EggHatch_CreateMessageWindow (2, 19) 27×4, EggHatch_CreateYesNoMenu (25, 13) 6×4, each in a one-tile
 * frame). Packs without the art (the fixture) get flat placeholder shapes.
 */
import type { HatchView } from '@opensinnoh/contracts';
import { capFlash } from '@opensinnoh/render/flash';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { el } from './core.ts';
import { layoutScene, MESSAGE, place, sceneContext } from './evolution.ts';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
const FADE = 16;
/** YES/NO with its frame: tiles 24–31 × 12–17, in DS px. */
const YES_NO = { x: 192, y: 96, w: 64, h: 48 };

export function hatch(ctx: DrawContext, v: HatchView): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.className = 'ds-scene-canvas hatch-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const boxes = el('div', 'ds-scene-boxes');
  const stage = el('div', 'ds-scene-stage', canvas, boxes);
  const root = el('section', 'ds-scene hatch-scene', stage);
  root.setAttribute('aria-label', v.message?.text ?? S.aria.egg);
  const d = sceneContext(ctx, layoutScene(ctx, root, stage));
  void paint(d, v, canvas);
  if (v.message) {
    const box = messageBox(d, v.message.text, v.message.waiting);
    box.classList.add('ds-scene-message');
    place(box, MESSAGE);
    boxes.append(box);
  }
  if (v.yesNo) {
    const yn = framed(d, 'yes-no ds-scene-yes-no', stop(d, 'yes', [d.text(v.yesNo.yes)], 'choice', v.yesNo.cursor === 0), stop(d, 'no', [d.text(v.yesNo.no)], 'choice', v.yesNo.cursor === 1));
    place(yn, YES_NO);
    boxes.append(yn);
  }
  return root;
}
async function paint(d: DrawContext, v: HatchView, canvas: HTMLCanvasElement): Promise<void> {
  const bg = d.art.sheet('egg_hatch/background');
  const eggSheet = d.art.sheet('egg_hatch/egg');
  const barSheet = d.art.sheet('egg_hatch/bar');
  const sprites = d.registries.pokemonSprites.get(v.mon.species);
  const form = sprites?.forms[v.mon.form] ?? sprites?.forms[0];
  const [bgImg, eggImg, barImg, monImg] = await Promise.all([
    bg ? d.art.image(bg.atlas) : null,
    eggSheet ? d.art.image(eggSheet.atlas) : null,
    barSheet ? d.art.image(barSheet.atlas) : null,
    form ? d.art.image(v.mon.shiny ? form.shinyAtlas : form.atlas) : null,
  ]);
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if (bgImg) g.drawImage(bgImg, 0, 0);
  else {
    g.fillStyle = '#58b8a0';
    g.fillRect(0, 0, W, H);
  }
  if (v.egg) {
    const cell = eggSheet?.cells[v.egg.frame];
    const w = 32 * v.egg.scaleX;
    const h = 32 * v.egg.scaleY;
    if (eggImg && cell) g.drawImage(eggImg, cell.x, cell.y, cell.w, cell.h, Math.round(v.egg.x - w / 2), Math.round(v.egg.y - h / 2), Math.round(w), Math.round(h));
    else {
      g.fillStyle = '#f0ecd8';
      g.beginPath();
      g.ellipse(v.egg.x, v.egg.y, w / 2 - 4, h / 2 - 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (v.showMon) {
    const face = form && ((v.mon.female && form.frontFemale) || form.front);
    if (monImg && face) g.drawImage(monImg, 0, face.y, 80, 80, W / 2 - 40, H / 2 - 40 + face.yOffset, 80, 80);
    else {
      g.fillStyle = '#d06048';
      g.fillRect(W / 2 - 24, H / 2 - 24, 48, 48);
    }
  }
  if (v.white) {
    g.fillStyle = `rgb(255 255 255 / ${capFlash(v.white / FADE)})`;
    g.fillRect(0, 0, W, H);
  }
  if (v.bars) {
    const cell = barSheet?.cells[0];
    for (const y of [v.bars.top, v.bars.bottom]) {
      if (barImg && cell) g.drawImage(barImg, cell.x, cell.y, cell.w, cell.h, 0, y, cell.w, cell.h);
      else {
        g.fillStyle = '#000';
        g.fillRect(0, y, W, 48);
      }
    }
  }
}
