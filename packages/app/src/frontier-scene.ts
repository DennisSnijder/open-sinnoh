/**
 * Draws a running Battle Frontier scene (`ScriptView.frontier`, contracts `FrontierView`; decomp frontier_graphics.c and
 * overlay 63) on the overlay canvas, in its 256×192 DS frame centred in the layout's room (`frontierFrame`, as the
 * DS-art menus are): black around it (the frontier app owns the screen), the room's BG3 at the camera (shaken by
 * FrontierScrCmd_4C; blended toward black by `bgDarken`, BattleArcade_SetPalette) with its patch (the Castle's emblem,
 * BattleCastle_UpdateEmblemFrame), the frontier_obj sprites (the doors), each character's shadow and its 2D sprite
 * (blended toward black by its `darken`), a party Pokémon's sprite on the stage (FrontierScrCmd_45), the Pokémon icons
 * and their held-item marks (the Arcade's columns, BattleFrontier_CreateMonSprite / _CreateItemSprite), the BG2 layer
 * above them (or under BG3 in the Factory corridor, scrolled on its own where it does not follow the camera, hidden
 * while toggled off), window 0 keeping the sprites out
 * of its rect (FrontierScrCmd_4E), then the brightness fade. The message, menu and yes/no boxes are drawn over it by
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
  /** An atlas with its colours blended `darken`/16 toward black (decomp palette blends), made once per level. */
  const darkenedAtlas = new Map<string, HTMLCanvasElement>();
  const darkImage = (atlas: AssetRef, darken: number): ImageBitmap | HTMLCanvasElement | null => {
    const img = image(atlas);
    if (!img || !darken) return img;
    const key = `${atlas}|${darken}`;
    let c = darkenedAtlas.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgb(0 0 0 / ${darken / 16})`;
      g.fillRect(0, 0, c.width, c.height);
      darkenedAtlas.set(key, c);
    }
    return c;
  };
  const sheetOf = (id: Id): Ui2dSheet => {
    const s = registries().ui2d.get(id);
    if (!s) throw new Error(`frontier scene: unknown ui2d sheet ${id}`);
    return s;
  };

  /** Decomp ov104_02232CE0: the Pokémon's 80×80 battle front, its palette blended `darken`/16 toward black. */
  const darkened = new Map<string, HTMLCanvasElement | null>();
  const pokemon = (ctx: CanvasRenderingContext2D, p: NonNullable<FrontierView['pokemon']>, scale: number) => {
    const key = `${p.species}|${p.form}|${p.female}|${p.shiny}|${p.darken}`;
    if (!darkened.has(key)) {
      darkened.set(key, null);
      const f = registries().pokemonSprites.get(p.species)?.forms[p.form] ?? registries().pokemonSprites.get(p.species)?.forms[0];
      if (!f) throw new Error(`frontier scene: no sprites for ${p.species}`);
      const face = (p.female && f.frontFemale) || f.front;
      void assets
        .get(p.shiny ? f.shinyAtlas : f.atlas)
        .then((blob) => createImageBitmap(blob))
        .then((img) => {
          const c = document.createElement('canvas');
          c.width = 80;
          c.height = 80;
          const g = c.getContext('2d')!;
          g.drawImage(img, 0, face.y, 80, 80, 0, 0, 80, 80);
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = `rgb(0 0 0 / ${p.darken / 16})`;
          g.fillRect(0, 0, 80, 80);
          darkened.set(key, c);
        });
    }
    const c = darkened.get(key);
    if (c) ctx.drawImage(c, 0, 0, 80, 80, (p.x - 40) * scale, (p.y - 40) * scale, 80 * scale, 80 * scale);
  };

  /**
   * Decomp BattleFrontier_CreateMonSprite / _CreateItemSprite: each Pokémon's party icon on its first frame (the top
   * 32×32 of the icon) centred at x, y, and its held-item mark (`ui2d/party/held` cell 0, the party's) with its origin
   * at item.x, item.y; screen px.
   */
  const icons = (ctx: CanvasRenderingContext2D, list: NonNullable<FrontierView['icons']>, shadow: Id, scale: number) => {
    const held = sheetOf(`${shadow.split(':')[0]}:ui2d/party/held` as Id);
    for (const i of list) {
      if (i.visible) {
        const sprites = registries().pokemonSprites.get(i.species);
        if (!sprites) throw new Error(`frontier scene: no sprites for ${i.species}`);
        const img = image((sprites.forms[i.form] ?? sprites.forms[0]!).icon);
        if (img) ctx.drawImage(img, 0, 0, 32, 32, (i.x - 16) * scale, (i.y - 16) * scale, 32 * scale, 32 * scale);
      }
      if (!i.item.visible) continue;
      const img = image(held.atlas);
      const c = held.cells[0]!;
      if (img) ctx.drawImage(img, c.x, c.y, c.w, c.h, (i.item.x - c.ox) * scale, (i.item.y - c.oy) * scale, c.w * scale, c.h * scale);
    }
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
    const cam = { x: view.camera.x + (view.shake?.x ?? 0), y: view.camera.y + (view.shake?.y ?? 0) };
    /** A cell of a sheet with its origin at room position x, y (its colours blended `darken`/16 toward black). */
    const cell = (sheet: Ui2dSheet, index: number, x: number, y: number, flip = false, darken = 0) => {
      const img = darkImage(sheet.atlas, darken);
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
    /** BG2: at the camera, or (decomp FR_SCENE_FLAG_2 0) at its own scroll, wrapping down its height. */
    const fg = () => {
      if (!view.fg || view.fgHidden) return;
      const s = sheetOf(view.fg.sheet);
      // The blend's weights as one alpha (BG2's `a`/16 over what is below; the DS also scales below by `b`/16).
      if (view.fgBlend) ctx.globalAlpha = view.fgBlend.a / 16;
      if (!view.fgFixed) cell(s, 0, 0, 0);
      else {
        const scroll = view.fgScroll ?? { x: 0, y: 0 };
        for (const dy of [0, view.fg.height]) cell(s, 0, cam.x - scroll.x, cam.y - scroll.y + dy);
      }
      ctx.globalAlpha = 1;
    };
    if (view.fgBelow) fg();
    if (view.bg) cell(sheetOf(view.bg.sheet), 0, 0, 0, false, view.bgDarken ?? 0);
    if (view.bgPatch) cell(sheetOf(view.bgPatch.sheet), 0, view.bgPatch.x, view.bgPatch.y, false, view.bgDarken ?? 0);
    if (view.window) {
      // Window 0: inside its rect only the BG layers show (G2_SetWnd0InsidePlane without OBJ).
      const w = view.window;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 256 * scale, 192 * scale);
      ctx.rect(w.x1 * scale, w.y1 * scale, (w.x2 - w.x1) * scale, (w.y2 - w.y1) * scale);
      ctx.clip('evenodd');
    }
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
      cell(s, animCell(s, a.anim, a.frame), a.x, a.y, false, a.darken ?? 0);
    }
    if (view.pokemon) pokemon(ctx, view.pokemon, scale);
    if (view.icons) icons(ctx, view.icons, view.shadow, scale);
    if (view.window) ctx.restore();
    if (!view.fgBelow) fg();
    if (view.fade) {
      ctx.globalAlpha = view.fade.alpha;
      ctx.fillStyle = view.fade.color === 'black' ? '#000' : '#fff';
      ctx.fillRect(0, 0, 256 * scale, 192 * scale);
    }
    ctx.restore();
  };
}
