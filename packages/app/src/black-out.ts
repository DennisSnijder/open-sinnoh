/**
 * Draws the blackout screen (`Game.blackOutScreen()`, decomp FieldTask_BlackOutFromBattle) on the overlay
 * canvas: everything black, the text in the message font (the ROM's system font is the same file) in white
 * with a grey shadow (TEXT_COLOR(15, 2, 0)), its lines left-aligned in a block centred on the view (decomp
 * sub_02052AA4 centres the block by its widest line), faded by the view's alpha.
 */
import type { BlackOutView, LoadedFont } from '@opensinnoh/contracts';
import { drawText } from '@opensinnoh/text';
import { tint } from './map-popup.ts';

/** The font's line height in DS px. */
const LINE = 16;
const tinted = new WeakMap<LoadedFont, LoadedFont>();

export function drawBlackOut(ctx: CanvasRenderingContext2D, view: BlackOutView | null, font: LoadedFont, scale: number): void {
  if (!view) return;
  let white = tinted.get(font);
  if (!white) tinted.set(font, (white = tint(font, { fg: '#f8f8f8', shadow: '#686868' })));
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = view.alpha;
  const lines = view.text.split('\n');
  const widths = lines.map((l) => [...l].reduce((w, c) => w + (white.glyph.get(c)?.width ?? white.cellWidth), 0));
  const x = Math.round((width - Math.max(...widths) * scale) / 2);
  const y = Math.round((height - lines.length * LINE * scale) / 2);
  lines.forEach((l, i) => drawText(ctx, white, l, x, y + i * LINE * scale, scale));
  ctx.restore();
}
