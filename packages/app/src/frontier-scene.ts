/**
 * Draws a running Battle Frontier scene (`ScriptView.frontier`, contracts `FrontierView`; decomp frontier_graphics.c and
 * overlay 63) on the overlay canvas, in its 256×192 DS frame centred in the layout's room (`frontierFrame`, as the
 * DS-art menus are): black around it (the frontier app owns the screen), the room's BG3 at the camera, the
 * frontier_obj sprites (the doors), each character's shadow and its 2D sprite, the BG2 layer above them, then the
 * brightness fade. The message, menu and yes/no boxes are drawn over it by
 * `drawScriptOverlay` in the same frame. Sheets load on first use; until they have, their layer is not drawn.
 */
import type { AssetRef, AssetSource, FrontierView, Registries, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { Insets } from './layout.ts';
import type { DsFrame } from './panel.ts';

/**
 * The scene's frame: centred in the room (the canvas less `room`, both in device px) at `scale` device px per DS px
 * (the layout's unit, which `uiScales` fits to the room), as the battle and the DS menus place themselves clear of
 * the notch, the HUD row and the landscape controls.
 */
export function frontierFrame(canvas: { width: number; height: number }, room: Insets, scale: number): DsFrame {
  const width = canvas.width - room.left - room.right;
  const height = canvas.height - room.top - room.bottom;
  return { x: room.left + Math.floor((width - 256 * scale) / 2), y: room.top + Math.floor((height - 192 * scale) / 2), scale };
}

/** Decomp ov63_0222B7E8: the shadow sits 8, 14 from the character's cells' origin. */
const SHADOW = { dx: 8, dy: 14 };

export function createFrontierDrawer(assets: AssetSource, registries: () => Registries) {
  const images = new Map<AssetRef, ImageBitmap | null>();
  const image = (atlas: AssetRef): ImageBitmap | null => {
    if (!images.has(atlas)) {
      images.set(atlas, null);
      void assets
        .get(atlas)
        .then((blob) => createImageBitmap(blob))
        .then((img) => images.set(atlas, img));
    }
    return images.get(atlas) ?? null;
  };
  const sheetOf = (id: Id): Ui2dSheet => {
    const s = registries().ui2d.get(id);
    if (!s) throw new Error(`frontier scene: unknown ui2d sheet ${id}`);
    return s;
  };

  return (ctx: CanvasRenderingContext2D, view: FrontierView | undefined, frame: DsFrame) => {
    if (!view) return;
    const scale = frame.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // From here on the frame's top-left corner is 0, 0.
    ctx.translate(frame.x, frame.y);
    ctx.beginPath();
    ctx.rect(0, 0, 256 * scale, 192 * scale);
    ctx.clip();
    const cam = view.camera;
    /** A cell of a sheet with its origin at room position x, y. */
    const cell = (sheet: Ui2dSheet, index: number, x: number, y: number, flip = false) => {
      const img = image(sheet.atlas);
      const c = sheet.cells[index];
      if (!img || !c) return;
      if (!flip) {
        ctx.drawImage(img, c.x, c.y, c.w, c.h, (x - cam.x + c.ox) * scale, (y - cam.y + c.oy) * scale, c.w * scale, c.h * scale);
        return;
      }
      // Mirrored about the sprite's origin (OAM H-flip).
      ctx.save();
      ctx.translate((x - cam.x) * scale, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, c.x, c.y, c.w, c.h, c.ox * scale, (y - cam.y + c.oy) * scale, c.w * scale, c.h * scale);
      ctx.restore();
    };
    /** The cell an animation shows at its frame. */
    const animCell = (sheet: Ui2dSheet, anim: number, frame: number): number => sheet.animations?.[anim]?.frames[frame]?.cell ?? 0;
    if (view.bg) cell(sheetOf(view.bg.sheet), 0, 0, 0);
    for (const o of view.objects) {
      if (!o.visible || o.anim < 0) continue;
      const s = sheetOf(o.sheet);
      cell(s, animCell(s, o.anim, o.frame), o.x, o.y, o.flip === true);
    }
    const shadow = sheetOf(view.shadow);
    for (const a of view.actors) {
      if (!a.visible || a.anim < 0) continue;
      cell(shadow, 0, a.x + SHADOW.dx, a.y + SHADOW.dy);
      const s = sheetOf(a.sheet);
      cell(s, animCell(s, a.anim, a.frame), a.x, a.y);
    }
    if (view.fg) cell(sheetOf(view.fg.sheet), 0, 0, 0);
    if (view.fade) {
      ctx.globalAlpha = view.fade.alpha;
      ctx.fillStyle = view.fade.color === 'black' ? '#000' : '#fff';
      ctx.fillRect(0, 0, 256 * scale, 192 * scale);
    }
    ctx.restore();
  };
}
