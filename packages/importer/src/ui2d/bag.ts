/**
 * The bag screen's art (pl_bag_gra.narc, members per res/graphics/bag/bag_graphics.order; decomp
 * applications/bag/main.c, sprites.c, windows.c). Ids `platinum:ui2d/bag/<name>`:
 * - `bag/screen`: the main screen, 256 × 192: bag_ui_main.NSCR (BG1) over item_list_border.NSCR (BG3), both on
 *   bag_ui_main_tileset with bag_ui_main.NCLR, over its colour 0 (decomp BagUI_LoadGraphics);
 * - `bag/bag_male`, `bag/bag_female`: the bag picture (bag_sprite_cell, bag_sprite_anim; the female set uses
 *   the same cells and animations, LoadSpriteResources), animation i = pocket type i;
 * - `bag/arrows` (pocket_selector_arrows), `bag/pocket_highlight`, `bag/item_highlight` with ui_elements.NCLR;
 * - `bag/pocket_icons`: the 10 × 10 pocket icons BagUI_DrawPocketSelectorIcon blits from
 *   pocket_selector_icons.NCGR (palette pocket_selector_icons.NCLR): cell 2t pocket type t, 2t + 1 its
 *   focused icon (x = 32t, 32t + 16);
 * - `bag/entry_icons`: item_entry_icons.NCGR on the list window's palette 3: `registered` (the SELECT
 *   mark, BagUI_DrawRegisteredIcon: 40 × 16 at x 0) and `hm` (DrawHMIcon: 24 × 16 at x 40).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, blit, crop, type CellImage, type Image } from './compose.ts';
import { indexes, readNclr, readNcgrData, rgb555 } from './nitro2d.ts';
import { screenImage } from './menus.ts';
import type { Sheets } from './sheets.ts';

const BAG = {
  path: '/graphic/pl_bag_gra.narc',
  count: 39,
  bag: { male: { ncgr: 2, nclr: 3 }, female: { ncgr: 6, nclr: 7 }, ncer: 1, nanr: 0 },
  arrows: { ncgr: 10, ncer: 9, nanr: 8 },
  uiTiles: 11,
  uiPalette: 12,
  listBorder: 13,
  uiMain: 14,
  uiElements: 20,
  pocketIcons: { ncgr: 21, nclr: 22 },
  pocketHighlight: { ncgr: 25, ncer: 24, nanr: 23 },
  itemHighlight: { ncgr: 28, ncer: 27, nanr: 26 },
  entryIcons: 38,
};
/** Decomp POCKET_MAX; the icon blit (Window_BlitBitmapRect: 10 × 10 from a 256 × 16 bitmap). */
const POCKETS = 8;
const ICON = 10;
/** The list window's BG palette (BagUI_CreateWindows: palette 3). */
const LIST_PALETTE = 3;

/** A character-format bitmap (`width` px wide, as Window_BlitBitmapRect reads it) cut at a rect with 16 colours. */
function bitmapRect(chars: Uint8Array, bitDepth: 4 | 8, width: number, colors: Uint16Array, x: number, y: number, w: number, h: number): CellImage {
  const px = indexes(chars, bitDepth);
  const tilesWide = width / 8;
  const img = blankImage(w, h);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx;
      const sy = y + yy;
      const i = px[((sy >> 3) * tilesWide + (sx >> 3)) * 64 + (sy & 7) * 8 + (sx & 7)];
      if (i === undefined) throw new Error(`bag bitmap: pixel (${sx}, ${sy}) outside the characters`);
      if (i) img.rgba.set([...rgb555(colors[i]!), 255], (yy * w + xx) * 4);
    }
  return { ...img, originX: 0, originY: 0 };
}

export function importBagArt(fs: NitroFs, sheets: Sheets): void {
  const bag = readNarc(fs.file(BAG.path));
  if (bag.length !== BAG.count) throw new Error(`${BAG.path}: ${bag.length} members, expected ${BAG.count}`);

  // BG3 (the list's border, priority 3) under BG1 (the screen, priority 1), over the backdrop.
  const screen: Image = screenImage(bag, BAG.listBorder, BAG.uiTiles, BAG.uiPalette, true);
  blit(screen, screenImage(bag, BAG.uiMain, BAG.uiTiles, BAG.uiPalette, false), 0, 0);
  sheets.image('bag/screen', crop(screen, 0, 0, 256, 192));

  for (const gender of ['male', 'female'] as const) sheets.obj(`bag/bag_${gender}`, bag, { ...BAG.bag[gender], ncer: BAG.bag.ncer, nanr: BAG.bag.nanr });
  sheets.obj('bag/arrows', bag, { ...BAG.arrows, nclr: BAG.uiElements });
  sheets.obj('bag/pocket_highlight', bag, { ...BAG.pocketHighlight, nclr: BAG.uiElements });
  sheets.obj('bag/item_highlight', bag, { ...BAG.itemHighlight, nclr: BAG.uiElements });

  const icons = readNcgrData(bag[BAG.pocketIcons.ncgr]!);
  const iconColors = readNclr(bag[BAG.pocketIcons.nclr]!).colors;
  const iconCells: CellImage[] = [];
  for (let t = 0; t < POCKETS; t++) for (const focus of [0, 16]) iconCells.push(bitmapRect(icons.data, icons.bitDepth, 32 * POCKETS, iconColors, t * 32 + focus, 0, ICON, ICON));
  sheets.add('bag/pocket_icons', iconCells);

  const entry = readNcgrData(bag[BAG.entryIcons]!);
  const listColors = readNclr(bag[BAG.uiPalette]!).colors.subarray(LIST_PALETTE * 16, LIST_PALETTE * 16 + 16);
  sheets.add('bag/entry_icons', [bitmapRect(entry.data, entry.bitDepth, 64, listColors, 0, 0, 40, 16), bitmapRect(entry.data, entry.bitDepth, 64, listColors, 40, 0, 24, 16)], { names: ['registered', 'hm'] });
}
