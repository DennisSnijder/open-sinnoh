/**
 * Draws Fly's cut-in and landing (`FieldView.fly`, world fly.ts) on the overlay canvas over the field: the 256×192 DS
 * frame centred on the view at the field's own scale (CSS px per DS px times the pixel ratio), so the sprites stand
 * where the DS draws them over the player. The window band hides the field under the cut-in pattern, its rows those of
 * the DS frame, spanning the view once it reaches both DS edges (it widens from the right edge as on the DS); the
 * pattern and the wind repeat every 256 DS px across it. The Pokémon's front picture, the player and the bird are
 * scaled and turned about their centres. The world's fade (`World.fadeState`) is drawn over the sprites as over the
 * field below them.
 */
import type { AssetRef, AssetSource, FlySceneView, Registries, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { capFlash } from '@opensinnoh/render/flash';

const W = 256;
const H = 192;
const PICTURE = 80;

export function createFlyDrawer(assets: AssetSource, registries: () => Registries) {
  const images = new Map<AssetRef, ImageBitmap | null>();
  const layer = document.createElement('canvas');
  const image = (ref: AssetRef): ImageBitmap | null => {
    if (!images.has(ref)) {
      images.set(ref, null);
      void assets
        .get(ref)
        .then((blob) => createImageBitmap(blob))
        .then((img) => images.set(ref, img));
    }
    return images.get(ref)!;
  };
  const sheet = (path: string): Ui2dSheet | undefined => {
    const reg = registries();
    const ns = [...reg.newGame.keys()][0]!.split(':')[0]!;
    return reg.ui2d.get(`${ns}:ui2d/${path}` as Id);
  };

  return (ctx: CanvasRenderingContext2D, fly: FlySceneView | null, fade: { color: 'black' | 'white'; alpha: number } | null, k: number) => {
    if (!fly) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (layer.width !== cw || layer.height !== ch) [layer.width, layer.height] = [cw, ch];
    const g = layer.getContext('2d')!;
    g.clearRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = false;
    const ox = Math.round((cw - W * k) / 2);
    const oy = Math.round((ch - H * k) / 2);
    /** DS x positions repeating every 256 px across [left, right). */
    const across = (x: number, left: number, right: number) => {
      const out: number[] = [];
      const first = x + Math.floor((left - ox) / (W * k)) * W - W;
      for (let sx = first; ox + sx * k < right; sx += W) if (ox + (sx + W) * k > left) out.push(sx);
      return out;
    };

    const b = fly.band;
    if (b && b.y2 > b.y1) {
      // A band at the right edge widens across the view as its left edge sweeps from 255 to 0.
      const left = b.x1 <= 0 ? 0 : b.x2 >= 255 ? Math.round((cw * b.x1) / 255) : ox + b.x1 * k;
      const right = b.x2 >= 255 ? cw : ox + b.x2 * k;
      const band = { left, right, top: oy + Math.trunc(b.y1) * k, bottom: oy + Math.trunc(b.y2) * k };
      g.save();
      g.beginPath();
      g.rect(band.left, band.top, band.right - band.left, band.bottom - band.top);
      g.clip();
      g.fillStyle = '#000';
      g.fillRect(band.left, band.top, band.right - band.left, band.bottom - band.top);
      const pattern = b.pattern ? sheet('field_cutin/pattern') : undefined;
      const img = pattern ? image(pattern.atlas) : null;
      const c = pattern?.cells[0];
      if (img && c) for (const sx of across(0, band.left, band.right)) g.drawImage(img, c.x, c.y, c.w, c.h, ox + sx * k, oy, c.w * k, c.h * k);
      const wind = sheet('field_cutin/wind');
      const windImg = wind ? image(wind.atlas) : null;
      if (wind && windImg)
        for (const p of fly.wind) {
          const cell = wind.cells[wind.animations![p.anim]!.frames[0]!.cell]!;
          for (const sx of across(Math.trunc(p.x) % W, band.left, band.right))
            g.drawImage(windImg, cell.x, cell.y, cell.w, cell.h, ox + (sx - cell.ox) * k, oy + (Math.trunc(p.y) - cell.oy) * k, cell.w * k, cell.h * k);
        }
      g.restore();
    }

    /** A sprite at its position (x, y), its image's (originX, originY) there, scaled and turned about it. */
    const sprite = (img: CanvasImageSource, sx: number, sy: number, w: number, h: number, originX: number, originY: number, at: { x: number; y: number; scale: number; rotation: number }) => {
      g.save();
      g.translate(ox + Math.trunc(at.x) * k, oy + Math.trunc(at.y) * k);
      if (at.rotation) g.rotate((at.rotation * Math.PI) / 180);
      g.scale(at.scale * k, at.scale * k);
      g.drawImage(img, sx, sy, w, h, -originX, -originY, w, h);
      g.restore();
    };
    if (fly.mon) {
      const form = registries().pokemonSprites.get(fly.mon.species)?.forms[fly.mon.form] ?? registries().pokemonSprites.get(fly.mon.species)?.forms[0];
      const img = form ? image(fly.mon.shiny ? form.shinyAtlas : form.atlas) : null;
      if (form && img) {
        const face = (fly.mon.female && form.frontFemale) || form.front;
        sprite(img, 0, face.y, PICTURE, PICTURE, PICTURE / 2, PICTURE / 2, { x: fly.mon.x, y: fly.mon.y, scale: 1, rotation: 0 });
      }
    }
    const cell = (path: string, index: number, at: { x: number; y: number; scale: number; rotation: number }) => {
      const s = sheet(path);
      const img = s ? image(s.atlas) : null;
      const c = s?.cells[index];
      if (img && c) sprite(img, c.x, c.y, c.w, c.h, c.ox, c.oy, at);
    };
    if (fly.player) {
      const s = sheet(`field_cutin/player_${fly.gender}`);
      const frames = s?.animations?.[fly.player.anim]?.frames ?? [];
      let t = fly.player.tick;
      let index = frames[0]?.cell ?? 0;
      for (const f of frames) {
        index = f.cell;
        if (t < f.ticks) break;
        t -= f.ticks;
      }
      cell(`field_cutin/player_${fly.gender}`, index, fly.player);
    }
    if (fly.bird) cell('field_cutin/bird', 0, fly.bird);

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
