/**
 * The move relearner's screen and the trade scene's 2D art.
 *
 * - The move reminder (decomp applications/move_reminder.c, /graphic/waza_oshie_gra.narc): BG2's battle-moves page
 *   (NCGR 10 over NSCR 11, NCLR 12; the 512×256 map's left 256×192), the move selector (NCGR 2, NCER 1, NANR 0, NCLR
 *   9 palette 0) and the list's scroll arrows (NCGR 8, NCER 7, NANR 6). Sheets `move_reminder/background`,
 *   `move_reminder/selector`, `move_reminder/arrows`.
 * - The trade scene (decomp cutscenes/trade_sequence, /graphic/demo_trade.narc): the sky the balls cross (NCGR 16, NSCR 15, NCLR 17 at 0x00/0x20/0x40 by time of day; its top 256×192 of 256×512) and the wormhole (NCGR
 *   19, NSCR 18, NCLR 20); the ball sprites (NCGR 9, NCER 7, NANR 8, NCLR 10). Sheets
 *   `trade/sky_<time>`, `trade/wormhole`, `trade/ball`. The send and receive phases' BG2 (NCGR 22: one black tile) is the canvas's black; the tube phase's layers (an 8bpp extended-palette
 *   BG3 under an affine BG2 and the 3D tube, BMD0 27) are not converted.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, rgb555 } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const WAZA = { path: '/graphic/waza_oshie_gra.narc', count: 13 };
const TRADE = { path: '/graphic/demo_trade.narc', count: 28 };
const DS_WIDTH = 256;
const DS_HEIGHT = 192;
export const TRADE_TIMES = ['day', 'evening', 'night'] as const;
/** The ball phases' palette offsets (day, evening, night). */
const SKY_PALETTE = [0x00, 0x20, 0x40];

function narcOf(fs: NitroFs, n: { path: string; count: number }): Uint8Array[] {
  const narc = readNarc(fs.file(n.path));
  if (narc.length !== n.count) throw new Error(`${n.path}: ${narc.length} members, expected ${n.count}`);
  return narc;
}

/** One BG layer (`scr` over `chr`) with the palette RAM given, its top-left DS screen. */
function layer(narc: Uint8Array[], chr: number, scr: number, ram: PaletteRam): Image {
  const screen = readNscr(narc[scr]!);
  const rgba = renderScreen(screen, readNcgr(narc[chr]!), ram);
  return crop({ width: screen.width, height: screen.height, rgba }, 0, 0, DS_WIDTH, DS_HEIGHT);
}

/** Fills the transparent pixels with palette RAM colour 0 (the backdrop). */
function backdrop(img: Image, ram: PaletteRam): Image {
  const [r, g, b] = rgb555(ram.colors[0]!);
  for (let p = 3; p < img.rgba.length; p += 4) if (!img.rgba[p]) img.rgba.set([r, g, b, 255], p - 3);
  return img;
}

export function importMoveReminderArt(fs: NitroFs, sheets: Sheets): void {
  const narc = narcOf(fs, WAZA);
  const ram = new PaletteRam().load(readNclr(narc[12]!));
  sheets.image('move_reminder/background', backdrop(layer(narc, 10, 11, ram), ram));
  sheets.obj('move_reminder/selector', narc, { ncgr: 2, nclr: 9, ncer: 1, nanr: 0 });
  sheets.obj('move_reminder/arrows', narc, { ncgr: 8, nclr: 9, ncer: 7, nanr: 6 });
}

export function importTradeArt(fs: NitroFs, sheets: Sheets): void {
  const narc = narcOf(fs, TRADE);
  const pal = (i: number) => readNclr(narc[i]!);
  TRADE_TIMES.forEach((time, k) => {
    const sky = pal(17);
    const skyRam = new PaletteRam();
    skyRam.colors.set(sky.colors.subarray(SKY_PALETTE[k]! / 2, SKY_PALETTE[k]! / 2 + 0x10), 0);
    sheets.image(`trade/sky_${time}`, backdrop(layer(narc, 16, 15, skyRam), skyRam));
  });
  {
    const ram = new PaletteRam().load(pal(20), 0, 0x20);
    sheets.image('trade/wormhole', backdrop(layer(narc, 19, 18, ram), ram));
  }
  sheets.obj('trade/ball', narc, { ncgr: 9, nclr: 10, ncer: 7, nanr: 8 });
}
