/**
 * The start menu's sprites (decomp start_menu.c StartMenu_InitSprites; /graphic/menu_gra.narc in the
 * res/graphics/start_menu order): the icons (icons.NCGR 6, cells 4, animations 3) with menu.NCLR 5, three
 * animations per entry (none, swell, wiggle: anim = option × 3; the female bag at 9 × 3), drawn in
 * PALETTE_GRAYSCALE (0) as `start_menu/icons_gray` and PALETTE_COLORED (1) as `start_menu/icons`; the cursor
 * (cursor.NCGR 2, cells 1, animations 0) in palette 1 as `start_menu/cursor`.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import type { Sheets } from './sheets.ts';

const MENU_GRA = { path: '/graphic/menu_gra.narc', count: 11 };
const ICONS = { ncgr: 6, ncer: 4, nanr: 3, nclr: 5 };
const CURSOR = { ncgr: 2, ncer: 1, nanr: 0, nclr: 5 };

export function importStartMenuArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(MENU_GRA.path));
  if (narc.length !== MENU_GRA.count) throw new Error(`${MENU_GRA.path}: ${narc.length} members, expected ${MENU_GRA.count}`);
  sheets.obj('start_menu/icons_gray', narc, { ...ICONS, palette: 0 });
  sheets.obj('start_menu/icons', narc, { ...ICONS, palette: 1 });
  sheets.obj('start_menu/cursor', narc, { ...CURSOR, palette: 1 });
}
