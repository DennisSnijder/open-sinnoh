/**
 * The egg hatching scene's art (decomp cutscenes/egg_hatch/graphics.c; /demo/egg/data/egg_data.narc in the
 * res/graphics/egg_hatch order): the main BG (background NSCR 1 over NCGR 0, NCLR 8; 256×192 shown), the egg
 * (NCGR 4, NCLR 9, cells 3, animation 2: six frames from the whole egg to ready to shatter) and the black
 * bar (NCGR 7, NCLR 10, cells 6, animation 5). Sheets `egg_hatch/background`, `egg_hatch/egg`, `egg_hatch/bar`.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop } from './compose.ts';
import { screenImage } from './menus.ts';
import type { Sheets } from './sheets.ts';

const EGG_DATA = { path: '/demo/egg/data/egg_data.narc', count: 11 };
const DS_WIDTH = 256;
const DS_HEIGHT = 192;

export function importEggHatchArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(EGG_DATA.path));
  if (narc.length !== EGG_DATA.count) throw new Error(`${EGG_DATA.path}: ${narc.length} members, expected ${EGG_DATA.count}`);
  sheets.image('egg_hatch/background', crop(screenImage(narc, 1, 0, 8, true), 0, 0, DS_WIDTH, DS_HEIGHT));
  sheets.obj('egg_hatch/egg', narc, { ncgr: 4, nclr: 9, ncer: 3, nanr: 2 });
  sheets.obj('egg_hatch/bar', narc, { ncgr: 7, nclr: 10, ncer: 6, nanr: 5 });
}
