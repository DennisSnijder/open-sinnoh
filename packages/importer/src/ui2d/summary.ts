/**
 * The summary screen's page art (pl_pst_gra.narc, members per res/graphics/pokemon_summary_screen/
 * pokemon_summary_screen.order; decomp pokemon_summary_screen/main.c, window.c, sprites.c). The tabs and
 * ribbons are menus.ts's (`summary/tabs`, `summary/ribbons`).
 * - `summary/pages`: each page's BG3 (page_*.NSCR over tiles_main 0 with tiles_main.NCLR 1), the top
 *   256×192 with the backdrop (colour 0) filled; cells `info`, `memo`, `skills`, `condition` (0.31.0), `moves`, `moves_select`
 *   (the teach mode's five rows, page_battle_moves_select_mode), `ribbons`;
 * - `summary/move_info`: BG2 (move_info.NSCR 11, 512×512) where the move detail panel shows (scroll 0, 0),
 *   and `ribbon_info` where the ribbon detail shows (scroll 256, 56), 256×192, transparent around them;
 * - `summary/bars`: the HP bar characters (DrawHealthBar: 0xC0/0xE0/0x100 + n with BG palette 10, n filled
 *   px of 8) `hp_<colour>_<n>` and the EXP bar's (DrawExperienceProgressBar: 0xAC + n, palette 0) `exp_<n>`;
 * - `summary/text`: the text colours (main.h SUMMARY_TEXT_*: TEXT_COLOR(fg, shadow, 0) of the windows'
 *   palette 15) as `textColors` of 1×1 swatches `black`, `white`, `blue`, `red`;
 * - `summary/status`: the status icons (status_icons 62–65), one cell per SUMMARY_CONDITION_* (the party
 *   menu's too); with sprites.NCLR 69: `summary/move_cursor` (move_cursor 130–132: the selected move's frame,
 *   cell 1 the switch's second one), `summary/ribbon_cursor` (ribbon_cursor 125/126 over ribbon_cursor.NCGR
 *   120) and `summary/ribbon_arrow` (ribbon_arrow 41–43: cell 0 down, 1 up); 0.31.0 CONDITION's `summary/condition_arrow`,
 *   `summary/condition_flash` and `summary/sheen` (on palette 2);
 * - `summary/balls`: the caught ball (PokemonSummaryScreen_SetCaughtBallGfx: master_ball.NCGR 21 + ball − 1 in
 *   the caught-ball template's cell, condition_flash_cell 48, with balls_<n>.NCLR 37 + sBallIDToPaletteNum),
 *   one cell per ball named by its item constant (`ITEM_MASTER_BALL` … `ITEM_CHERISH_BALL`).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, renderCell, type CellImage, type Image } from './compose.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555, type Characters } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const PST = {
  path: '/graphic/pl_pst_gra.narc',
  count: 137,
  tiles: 0,
  nclr: 1,
  pages: { info: 3, memo: 4, skills: 5, condition: 7, moves: 6, ribbons: 9, moves_select: 12 },
  moveInfo: 11,
  status: { ncgr: 64, ncer: 63, nanr: 62, nclr: 65 },
  /** OBJ sets drawn with sprites.NCLR 69 (as the tabs). */
  objPalette: 69,
  moveCursor: { ncgr: 132, ncer: 131, nanr: 130 },
  ribbonCursor: { ncgr: 120, ncer: 125, nanr: 126 },
  ribbonArrow: { ncgr: 43, ncer: 42, nanr: 41 },
  /** 0.31.0: CONDITION's sprites (condition_arrow 17–19, condition_flash 47–49, sheen 66–68; the sheen on palette 2, its template's plttIdx). */
  conditionArrow: { ncgr: 19, ncer: 18, nanr: 17 },
  conditionFlash: { ncgr: 49, ncer: 48, nanr: 47 },
  sheen: { ncgr: 68, ncer: 67, nanr: 66 },
  balls: { ncgr: 21, ncer: 48, nclr: 37 },
};
/** Ball items 1–16 in item order (decomp items ITEM_MASTER_BALL … ITEM_CHERISH_BALL) and each one's balls_<n>.NCLR (sBallIDToPaletteNum). */
const BALLS = [
  ['MASTER', 0], ['ULTRA', 2], ['GREAT', 2], ['POKE', 0], ['SAFARI', 1], ['NET', 1], ['DIVE', 1], ['NEST', 1],
  ['REPEAT', 2], ['TIMER', 2], ['LUXURY', 2], ['PREMIER', 2], ['DUSK', 3], ['HEAL', 3], ['QUICK', 2], ['CHERISH', 0],
] as const;
/** BG2's scroll while each detail panel shows (main.c: the move info at 0, 0; the ribbon info at 256, 56). */
const DETAIL = { move_info: [0, 0], ribbon_info: [256, 56] } as const;
const BARS = { hp: { green: 0xc0, yellow: 0xe0, red: 0x100 }, hpPalette: 10, exp: 0xac, expPalette: 0 };
/** Window text colours (palette 15). */
const TEXT_PALETTE = 15;
const TEXT = { black: [1, 2], white: [15, 14], blue: [3, 4], red: [5, 6] } as const;

const hex = (c: number) => `#${rgb555(c).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** One 8×8 character drawn with a 16-colour palette (colour 0 transparent). */
function character(tiles: Characters, n: number, colors: Uint16Array, palette: number): CellImage {
  const tile = tiles.tiles[n];
  if (!tile) throw new Error(`summary bars: character ${n} of ${tiles.tiles.length}`);
  const rgba = new Uint8Array(8 * 8 * 4);
  tile.forEach((index, p) => {
    if (index) rgba.set([...rgb555(colors[palette * 16 + index]!), 255], p * 4);
  });
  return { width: 8, height: 8, rgba, originX: 0, originY: 0 };
}

export function importSummaryArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(PST.path));
  if (narc.length !== PST.count) throw new Error(`${PST.path}: ${narc.length} members, expected ${PST.count}`);
  const nclr = readNclr(narc[PST.nclr]!);
  const tiles = readNcgr(narc[PST.tiles]!);
  const ram = new PaletteRam().load(nclr);
  const draw = (member: number): Image => {
    const screen = readNscr(narc[member]!);
    return { width: screen.width, height: screen.height, rgba: renderScreen(screen, tiles, ram) };
  };

  const [r, g, b] = rgb555(ram.colors[0]!);
  const pages = Object.values(PST.pages).map((member): CellImage => {
    const img = crop(draw(member), 0, 0, 256, 192);
    for (let p = 3; p < img.rgba.length; p += 4) if (!img.rgba[p]) img.rgba.set([r, g, b, 255], p - 3);
    return { ...img, originX: 0, originY: 0 };
  });
  sheets.add('summary/pages', pages, { names: Object.keys(PST.pages) });

  const info = draw(PST.moveInfo);
  sheets.add(
    'summary/move_info',
    Object.values(DETAIL).map(([x, y]) => ({ ...crop(info, x, y, 256, 192), originX: 0, originY: 0 })),
    { names: Object.keys(DETAIL) },
  );

  const bars: CellImage[] = [];
  const barNames: string[] = [];
  for (const [colour, base] of Object.entries(BARS.hp))
    for (let n = 0; n <= 8; n++) {
      bars.push(character(tiles, base + n, nclr.colors, BARS.hpPalette));
      barNames.push(`hp_${colour}_${n}`);
    }
  for (let n = 0; n <= 8; n++) {
    bars.push(character(tiles, BARS.exp + n, nclr.colors, BARS.expPalette));
    barNames.push(`exp_${n}`);
  }
  sheets.add('summary/bars', bars, { names: barNames });

  const color = (i: number) => nclr.colors[TEXT_PALETTE * 16 + i]!;
  const swatches = Object.values(TEXT).map(([fg]) => ({ width: 1, height: 1, rgba: new Uint8Array([...rgb555(color(fg)), 255]), originX: 0, originY: 0 }));
  sheets.add('summary/text', swatches, { names: Object.keys(TEXT), textColors: Object.values(TEXT).map(([fg, shadow]) => ({ fg: hex(color(fg)), shadow: hex(color(shadow)) })) });

  sheets.obj('summary/status', narc, PST.status);
  sheets.obj('summary/move_cursor', narc, { ...PST.moveCursor, nclr: PST.objPalette });
  sheets.obj('summary/ribbon_cursor', narc, { ...PST.ribbonCursor, nclr: PST.objPalette });
  sheets.obj('summary/ribbon_arrow', narc, { ...PST.ribbonArrow, nclr: PST.objPalette });
  sheets.obj('summary/condition_arrow', narc, { ...PST.conditionArrow, nclr: PST.objPalette });
  sheets.obj('summary/condition_flash', narc, { ...PST.conditionFlash, nclr: PST.objPalette });
  sheets.obj('summary/sheen', narc, { ...PST.sheen, nclr: PST.objPalette, palette: 2 });

  const ballCell = readNcer(narc[PST.balls.ncer]!);
  const balls = BALLS.map(([, palette], i) => {
    const chars = readNcgrData(narc[PST.balls.ncgr + i]!);
    if (chars.scanned) throw new Error(`${PST.path}: ball member ${PST.balls.ncgr + i} is a scanned NCGR`);
    return renderCell(ballCell.cells[0]!, chars.data, readNclr(narc[PST.balls.nclr + palette]!).colors, { mapping: ballCell.mapping, palette: 0 });
  });
  sheets.add('summary/balls', balls, { names: BALLS.map(([name]) => `ITEM_${name}_BALL`) });
}
