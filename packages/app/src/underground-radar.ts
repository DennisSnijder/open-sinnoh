/**
 * The Underground's top screen as a card over the field (`FieldView.underground`; decomp top_screen.c): the whole
 * Underground's map (`ui2d/underground/radar_map`), the player's marker and the radar's blips (`radar_markers`, MARKER_ANIM_*
 * animations) at UndergroundMap_DrawPlayerMarkers' positions, and the ticker's two lines in its message window
 * (FieldMessage_AddWindow: tiles 2, 19). One DS screen drawn at half the field's scale (at least 1) in the top-left
 * corner: the DS's second screen as a card (one composed screen, no split layout).
 */
import type { AssetSource, LoadedFont, Registries, UndergroundFieldView } from '@opensinnoh/contracts';
import { UNDERGROUND_MARKER, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { drawText } from '@opensinnoh/text';
import { tint } from './map-popup.ts';

/** MAP_MIN_X/Y, MAP_WIDTH/HEIGHT and the main area's size (UNDERGROUND_MAIN_AREA_WIDTH/DEPTH + 1). */
const MAP = { x: 7 * 8 + 4, y: 8 + 1, w: 17 * 8 + 2, h: 16 * 8, areaW: 448, areaD: 416 };
const TICKER = { x: 16, y: 152, line: 16 };
const MARGIN = 8;

export function createRadarDrawer(assets: AssetSource, registries: () => Registries) {
  const images = new Map<Id, ImageBitmap | null>();
  const fonts = new WeakMap<LoadedFont, LoadedFont>();
  const sheet = (path: string): Ui2dSheet | undefined => registries().ui2d.get(`platinum:ui2d/${path}` as Id);
  const image = (s: Ui2dSheet | undefined): ImageBitmap | null => {
    if (!s) return null;
    if (!images.has(s.atlas)) {
      images.set(s.atlas, null);
      void assets
        .get(s.atlas)
        .then((blob) => createImageBitmap(blob))
        .then((img) => images.set(s.atlas, img));
    }
    return images.get(s.atlas) ?? null;
  };
  const frame = (s: Ui2dSheet, anim: number, tick: number): number | null => {
    const a = s.animations?.[anim];
    if (!a?.frames.length) return null;
    const total = a.frames.reduce((n, f) => n + f.ticks, 0);
    let t = tick % total;
    for (const f of a.frames) {
      if (t < f.ticks) return f.cell;
      t -= f.ticks;
    }
    return a.frames.at(-1)!.cell;
  };
  /**
   * The touch radar (TouchRadar_DrawEffects, on the field): the ring at the touched tile growing to twice its size and
   * fading, a light sparkle on each trap found, a sparkle on each mining spot and buried sphere (`underground/trap_radar`
   * animations 0–2), at the tiles' places on the field (`screenOf`, CSS px of the field canvas; `ratio` device px each).
   */
  const drawTouchRadar = (ctx: CanvasRenderingContext2D, t: NonNullable<UndergroundFieldView['touchRadar']>, s: number, ratio: number, screenOf: (x: number, z: number) => { x: number; y: number } | null) => {
    const radar = sheet('underground/trap_radar');
    const img = image(radar);
    if (!radar || !img) return;
    const put = (x: number, z: number, anim: number, scale: number) => {
      const p = screenOf(x, z);
      const cell = p ? frame(radar, anim, t.tick) : null;
      const c = cell === null ? undefined : radar.cells[cell];
      if (!p || !c) return;
      const k = s * scale;
      ctx.drawImage(img, c.x, c.y, c.w, c.h, p.x * ratio - c.ox * k, p.y * ratio - c.oy * k, c.w * k, c.h * k);
    };
    ctx.save();
    ctx.globalAlpha = Math.max(0, (16 - t.tick / 2) / 16);
    put(t.x, t.z, 0, t.tick / 10);
    ctx.globalAlpha = 1;
    for (const p of t.traps) put(p.x, p.z, 1, 1);
    for (const p of [...t.spots, ...t.spheres]) put(p.x, p.z, 2, 1);
    ctx.restore();
  };
  return (ctx: CanvasRenderingContext2D, view: UndergroundFieldView | null, font: LoadedFont, fieldScale: number, tick: number, screenOf?: (x: number, z: number) => { x: number; y: number } | null) => {
    if (!view) return;
    if (view.touchRadar && screenOf) drawTouchRadar(ctx, view.touchRadar, fieldScale, ctx.canvas.width / (ctx.canvas.clientWidth || ctx.canvas.width), screenOf);
    const map = sheet('underground/radar_map');
    const markers = sheet('underground/radar_markers');
    const bg = image(map);
    const sprites = image(markers);
    if (!map || !bg) return;
    const s = Math.max(1, Math.floor(fieldScale / 2));
    const ox = MARGIN;
    const oy = MARGIN;
    const c = map.cells[0]!;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bg, c.x, c.y, c.w, c.h, ox, oy, c.w * s, c.h * s);
    const mark = (x: number, z: number, anim: number) => {
      if (!markers || !sprites) return;
      const cell = frame(markers, anim, tick);
      const m = cell === null ? undefined : markers.cells[cell];
      if (!m) return;
      const px = MAP.x + Math.floor((x * MAP.w) / MAP.areaW);
      const py = MAP.y + Math.floor((z * MAP.h) / MAP.areaD);
      ctx.drawImage(sprites, m.x, m.y, m.w, m.h, ox + (px - m.ox) * s, oy + (py - m.oy) * s, m.w * s, m.h * s);
    };
    for (const b of view.blips) mark(b.x, b.z, b.anim);
    if (view.player) mark(view.player.x, view.player.z, UNDERGROUND_MARKER.player);
    let white = fonts.get(font);
    if (!white) fonts.set(font, (white = tint(font, { fg: '#f8f8f8', shadow: '#686868' })));
    view.log.forEach((line, i) => drawText(ctx, white, line, ox + TICKER.x * s, oy + (TICKER.y + i * TICKER.line) * s, s));
    ctx.restore();
  };
}
