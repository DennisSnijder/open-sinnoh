/**
 * Drawing a battle animation's `AnimView` on the battle scene's 2D canvas (packages/battle runs it; this
 * only draws), in whole device pixels per DS pixel like the rest of the scene:
 * - particles as the DS draws them: each a textured quad (its affine map from the VM), the texels multiplied
 *   by the particle's vertex colour (GX modulate) at the polygon's alpha, nearest-neighbour sampled; tiled
 *   and mirrored textures are expanded once and cached;
 * - battler changes (offset, scale, rotation, hiding, palette fade, translucency) through `battlerTransform`;
 * - the backdrop's fade and scroll through `bgEffect`.
 */
import type { AnimBattlerView, AnimParticle, AnimView, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

type Img = CanvasImageSource & { width: number; height: number };

/** BGR555 → CSS rgb(). */
export function css555(c: number): string {
  const ch = (v: number) => Math.round((v * 255) / 31);
  return `rgb(${ch(c & 31)} ${ch((c >> 5) & 31)} ${ch((c >> 10) & 31)})`;
}

/** Cached textures: tiled and tinted per (sheet, cell, tiles, mirror, colour). */
export class ParticleTextures {
  private readonly cache = new Map<string, HTMLCanvasElement>();

  constructor(
    private readonly sheet: (id: Id) => { sheet: Ui2dSheet; img: Img } | null,
    private readonly limit = 2048,
  ) {}

  /** The particle's texture as drawn: null while its atlas loads. */
  texture(p: AnimParticle): HTMLCanvasElement | null {
    const key = `${p.textures}/${p.cell}/${p.tile.join(',')}/${p.mirror.join(',')}/${p.color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = this.sheet(p.textures);
    const cell = s?.sheet.cells[p.cell];
    if (!s || !cell) return null;
    const [ts, tt] = p.tile;
    const nx = Math.max(1, Math.round(Math.abs(ts)));
    const ny = Math.max(1, Math.round(Math.abs(tt)));
    const c = document.createElement('canvas');
    c.width = cell.w * nx;
    c.height = cell.h * ny;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // GX repeat with flip: every other repeat mirrored; a negative count mirrors the whole quad.
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const fx = p.mirror[0] && i % 2 === 1;
        const fy = p.mirror[1] && j % 2 === 1;
        g.save();
        g.translate((i + (fx ? 1 : 0)) * cell.w, (j + (fy ? 1 : 0)) * cell.h);
        g.scale(fx ? -1 : 1, fy ? -1 : 1);
        g.drawImage(s.img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
        g.restore();
      }
    if (ts < 0 || tt < 0) {
      const m = document.createElement('canvas');
      m.width = c.width;
      m.height = c.height;
      const h = m.getContext('2d')!;
      h.translate(ts < 0 ? c.width : 0, tt < 0 ? c.height : 0);
      h.scale(ts < 0 ? -1 : 1, tt < 0 ? -1 : 1);
      h.drawImage(c, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(m, 0, 0);
    }
    if ((p.color & 0x7fff) !== 0x7fff) {
      // Modulate: texel × colour / 31 per channel, the texel's alpha kept.
      const shape = document.createElement('canvas');
      shape.width = c.width;
      shape.height = c.height;
      shape.getContext('2d')!.drawImage(c, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = css555(p.color);
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(shape, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    if (this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, c);
    return c;
  }

  /** Draws the particles: DS px → canvas by `scale` (device px per DS px) from `origin`. */
  draw(ctx: CanvasRenderingContext2D, particles: AnimParticle[], origin: { x: number; y: number }, scale: number): void {
    for (const p of particles) {
      const img = this.texture(p);
      if (!img) continue;
      const [a, b, c, d, e, f] = p.m;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.alpha / 31);
      ctx.setTransform((a * scale) / img.width, (b * scale) / img.width, (c * scale) / img.height, (d * scale) / img.height, origin.x + e * scale, origin.y + f * scale);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
  }
}

/** The animation's changes to one battler (by DS battler id), or null when it changes nothing. */
export function battlerTransform(anim: AnimView | null, battler: number): AnimBattlerView | null {
  return anim?.battlers.find((b) => b.battler === battler) ?? null;
}

/**
 * Applies a battler's animation transform about its sprite centre (DS px `cx`, `cy` on the canvas at
 * device px per DS px `k`): the caller draws the sprite as usual afterwards. Returns false when the battler is hidden.
 */
export function applyBattlerTransform(ctx: CanvasRenderingContext2D, t: AnimBattlerView | null, center: { x: number; y: number; k: number }): boolean {
  if (!t) return true;
  if (t.hidden) return false;
  ctx.translate(center.x, center.y);
  ctx.scale(t.scaleX, t.scaleY);
  if (t.rotation) {
    // About the pivot (DS px from the centre, device px here by the caller's scale in `center.k`).
    const px = t.pivotX * center.k;
    const py = t.pivotY * center.k;
    ctx.translate(px, py);
    ctx.rotate(t.rotation * 2 * Math.PI);
    ctx.translate(-px, -py);
  }
  ctx.translate(-center.x, -center.y);
  ctx.globalAlpha *= t.alpha;
  return true;
}

/** A palette fade on a drawn image (the DS blends every palette colour toward `color` by amount/16). */
export function fadeImage(g: CanvasRenderingContext2D, w: number, h: number, fade: { color: number; amount: number } | null): void {
  if (!fade || fade.amount <= 0) return;
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = Math.min(1, fade.amount / 16);
  g.fillStyle = css555(fade.color);
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
