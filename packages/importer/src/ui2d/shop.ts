/**
 * The mart's buy screen panels (decomp overlay007/shop_menu.c Shop_LoadGraphics; /graphic/shop_gra.narc in
 * the res/graphics/shop_menu order): BG1 is `tilemap` NSCR 2 over `tiles` NCGR 0 with `default` NCLR 1, the
 * list's and the description's panels the windows print on. Sheet `shop/panel` (256×192; where the DS shows
 * the field through the panel, transparent); `shop/panel_frontier` is the exchange counters' (`frontier` NCLR 11).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop } from './compose.ts';
import { screenImage } from './menus.ts';
import type { Sheets } from './sheets.ts';

const SHOP_GRA = { path: '/graphic/shop_gra.narc', count: 12 };

export function importShopArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(SHOP_GRA.path));
  if (narc.length !== SHOP_GRA.count) throw new Error(`${SHOP_GRA.path}: ${narc.length} members, expected ${SHOP_GRA.count}`);
  sheets.image('shop/panel', crop(screenImage(narc, 2, 0, 1, false), 0, 0, 256, 192));
  // MART_TYPE_FRONTIER (the exchange counters) loads `frontier` NCLR 11 over the same panel.
  sheets.image('shop/panel_frontier', crop(screenImage(narc, 2, 0, 11, false), 0, 0, 256, 192));
}
