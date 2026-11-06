/**
 * The Canalave Library TV (contracts `LibraryTvView`; packages/menus library-tv.ts owns the timing): one 256×192 DS
 * screen on a canvas at a whole number of device pixels per DS pixel, laid out as the other DS screen scenes
 * (evolution.ts `layoutScene`). Back to front (decomp LibraryTV_SetVramBank): the picture (BG3), the scan lines
 * (BG1) from row `scanY`, wrapping, blended over it at 4/16 (G2_SetBlendAlpha: 4 of the scan line's colour, 12 of
 * the picture's), the TV frame (BG0), then the brightness fade to black. Packs without the art (the fixture) get a
 * flat picture and frame.
 */
import type { LibraryTvView } from '@opensinnoh/contracts';
import type { DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { layoutScene } from './evolution.ts';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
/** The scan lines' BG is 256×256 (it wraps). */
const BG = 256;
/** Decomp G2_SetBlendAlpha(…, 0x4, 0xc): the first target's weight, of 16. */
const EVA = 4 / 16;
const BLACK = 16;

interface Scene {
  root: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
}

const scenes = new WeakMap<Art, Scene>();

/** The scene's root, redrawn in place (the layer keeps it while the view changes every tick). */
export function libraryTv(d: DrawContext, v: LibraryTvView): HTMLElement {
  let s = scenes.get(d.art);
  if (!s || !s.root.isConnected) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'ds-scene-canvas library-tv-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const stage = el('div', 'ds-scene-stage', canvas);
    const root = el('section', 'ds-scene library-tv-scene', stage);
    root.setAttribute('aria-label', S.aria.television);
    scenes.set(d.art, (s = { root, stage, canvas }));
  }
  layoutScene(d, s.root, s.stage);
  void paint(d, v, s.canvas);
  return s.root;
}

async function paint(d: DrawContext, v: LibraryTvView, canvas: HTMLCanvasElement): Promise<void> {
  const sheets = ['library_tv/picture', 'library_tv/scanlines', 'library_tv/frame'].map((p) => d.art.sheet(p));
  const [picture, scanlines, frame] = await Promise.all(sheets.map((s) => (s ? d.art.image(s.atlas) : null)));
  const [pc, sc, fc] = sheets.map((s) => s?.cells[0] ?? { x: 0, y: 0 });
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.globalAlpha = 1;
  if (picture) g.drawImage(picture, pc!.x, pc!.y, W, H, 0, 0, W, H);
  else {
    g.fillStyle = '#2a2050';
    g.fillRect(0, 0, W, H);
  }
  if (scanlines) {
    g.globalAlpha = EVA;
    const top = Math.min(H, BG - v.scanY);
    g.drawImage(scanlines, sc!.x, sc!.y + v.scanY, W, top, 0, 0, W, top);
    if (top < H) g.drawImage(scanlines, sc!.x, sc!.y, W, H - top, 0, top, W, H - top);
    g.globalAlpha = 1;
  }
  if (frame) g.drawImage(frame, fc!.x, fc!.y, W, H, 0, 0, W, H);
  else {
    g.strokeStyle = '#384048';
    g.lineWidth = 12;
    g.strokeRect(6, 6, W - 12, H - 12);
  }
  if (v.black) {
    g.fillStyle = `rgb(0 0 0 / ${v.black / BLACK})`;
    g.fillRect(0, 0, W, H);
  }
}
