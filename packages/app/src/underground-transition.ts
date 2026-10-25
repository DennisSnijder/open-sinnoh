/**
 * Draws the way down to the Underground and back up (`World.undergroundTransition`, world underground-transition.ts) on
 * the overlay canvas over the field: the 256×192 DS frame centred on the view at the field's own scale, as Fly's
 * cut-in is (the player at its centre), the hole (`ui2d/underground/transition_hole`) under the player
 * (`transition_<gender>`), each at its animation's frame. The world's fade (`World.fadeState`) is drawn over the
 * sprites as over the field below them.
 */
import type { AssetSource, Registries, Ui2dSheet, UndergroundTransitionView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { capFlash } from '@opensinnoh/render/flash';

const W = 256;
const H = 192;

/** The cell `frame` frames into animation `anim` (looping ones wrap from their loop start; forward ones hold their last). */
export function transitionCell(sheet: Pick<Ui2dSheet, 'animations'>, anim: number, frame: number): number {
  const a = sheet.animations?.[anim];
  if (!a?.frames.length) throw new Error(`underground transition: the sheet has no animation ${anim}`);
  const total = a.frames.reduce((n, f) => n + f.ticks, 0);
  const start = a.frames.slice(0, a.loopStart).reduce((n, f) => n + f.ticks, 0);
  let t = Math.floor(frame);
  if (t >= total) t = a.mode === 'forward' ? total - 1 : start + ((t - start) % (total - start));
  for (const f of a.frames) {
    if (t < f.ticks) return f.cell;
    t -= f.ticks;
  }
  return a.frames.at(-1)!.cell;
}

export function createUndergroundTransitionDrawer(assets: AssetSource, registries: () => Registries) {
  const images = new Map<Id, ImageBitmap | null>();
  const layer = document.createElement('canvas');
  const sheet = (path: string): Ui2dSheet | undefined => registries().ui2d.get(`platinum:ui2d/${path}` as Id);
  const image = (s: Ui2dSheet): ImageBitmap | null => {
    if (!images.has(s.atlas)) {
      images.set(s.atlas, null);
      void assets
        .get(s.atlas)
        .then((blob) => createImageBitmap(blob))
        .then((img) => images.set(s.atlas, img));
    }
    return images.get(s.atlas) ?? null;
  };

  return (ctx: CanvasRenderingContext2D, view: UndergroundTransitionView | null, fade: { color: 'black' | 'white'; alpha: number } | null, k: number) => {
    if (!view || (!view.player && !view.hole)) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (layer.width !== cw || layer.height !== ch) [layer.width, layer.height] = [cw, ch];
    const g = layer.getContext('2d')!;
    g.clearRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = false;
    const ox = Math.round((cw - W * k) / 2);
    const oy = Math.round((ch - H * k) / 2);
    const put = (path: string, s: { anim: number; frame: number; x: number; y: number }) => {
      const sh = sheet(path);
      if (!sh) throw new Error(`underground transition: no sheet ui2d/${path}`);
      const img = image(sh);
      const c = sh.cells[transitionCell(sh, s.anim, s.frame)]!;
      if (!img || !c.w) return;
      g.drawImage(img, c.x, c.y, c.w, c.h, ox + (Math.trunc(s.x) - c.ox) * k, oy + (Math.trunc(s.y) - c.oy) * k, c.w * k, c.h * k);
    };
    // The hole's priority is under the player's (UndergroundMapTransition_GetSprite: 1 and 0).
    if (view.hole) put('underground/transition_hole', view.hole);
    if (view.player) put(`underground/transition_${view.gender}`, view.player);
    if (fade) {
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = fade.color === 'white' ? capFlash(fade.alpha) : fade.alpha;
      g.fillStyle = fade.color === 'white' ? '#fff' : '#000';
      g.fillRect(0, 0, cw, ch);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(layer, 0, 0);
  };
}
