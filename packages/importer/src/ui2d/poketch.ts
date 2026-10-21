/**
 * The Pokétch art (graphic/poketch.narc, members per res/graphics/poketch/poketch.order;
 * docs/research/poketch.md). Ids `platinum:ui2d/poketch/<name>`:
 * - `palettes`: the 16 screen palettes (generic_bg_tiles.NCLR: 8 colours × normal and backlight), one
 *   16-pixel row each; the app recolours the art (drawn in palette 0, green) with them.
 * - `border_pink`, `border_blue`: the device frame (poketch_border, palette by the player's gender,
 *   decomp PoketchSystem_GetBorderColor), 256×192.
 * - `<app>_bg`: each app's BG screen (its NSCR over its tiles, BG palette 0), 256×192, colour 0 clear.
 * - `<tiles>_tiles`: BG tile sets the apps copy from at run time (decomp tilemap edits), as a grid of 8×8
 *   tiles as wide as the NCGR says.
 * - `<app>`: each app's OBJ cells with its NANR sequences (OBJ palette 0); `digits` the shared digits.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, renderCell, type CellImage, type Image } from './compose.ts';
import { readNanr } from './nanr.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555 } from './nitro2d.ts';
import { animations, type Sheets } from './sheets.ts';

const NARC = { path: '/graphic/poketch.narc', count: 126 };
const PALETTES = 0;
const DIGITS = { ncgr: 2, ncer: 3, nanr: 4 };
/** Decomp POKETCH_DIGITS_NCGR_NUM_TILES: app OBJ characters follow the digits'. */
const DIGITS_TILES = 80;
const DIGITAL_WATCH_DIGITS = { nscr: 25, tiles: 23 };
const BORDER = { nclr: 13, ncgr: 14, nscr: 15 };
/** Decomp POKETCH_BORDER_PINK / _BLUE: the border file's palettes, loaded into BG palette 15. */
/** The border's character base (decomp Graphics_LoadTilesToBgLayer at 64). */
const BORDER_CHAR_BASE = 64;
const BORDER_COLORS = { pink: 0, blue: 1 } as const;

/** BG screens: [NSCR, tiles NCGR]. */
const SCREENS: Record<string, [number, number]> = {
  unavailable: [11, 10],
  calculator: [17, 16],
  stopwatch: [20, 21],
  digital_watch: [24, 23],
  analog_watch: [26, 23],
  memo_pad: [31, 30],
  dowsing_machine: [38, 39],
  counter: [43, 44],
  pedometer: [48, 49],
  coin_toss: [53, 54],
  move_tester: [60, 61],
  color_changer: [65, 66],
  matchup_checker: [70, 71],
  alarm_clock: [75, 76],
  daycare_checker: [80, 81],
  roulette: [85, 86],
  kitchen_timer: [90, 91],
  link_searcher: [95, 96],
  party_status: [105, 106],
  calendar: [110, 111],
  marking_map: [115, 117],
  berry_searcher: [116, 117],
  trainer_counter: [121, 122],
};

/** BG tile sets kept for run-time tilemap edits. */
const TILES: Record<string, number> = { watch: 23, stopwatch: 21, calendar: 111, calculator: 16, map: 117, party_status: 106, daycare_checker: 81, friendship_checker: 7, generic: 7 };

/**
 * OBJ sets: [NCER, NANR, NCGR, characters]: `own` = the cells name the app's NCGR from 0 (the decomp
 * adds POKETCH_DIGITS_NCGR_NUM_TILES with SetSpriteCharNo, or loads it at 0); `after-digits` = absolute
 * names past the digits (the stopwatch's cells).
 */
const OBJS: Record<string, [number, number, number, 'own' | 'after-digits']> = {
  stopwatch: [18, 19, 22, 'after-digits'],
  analog_watch: [27, 28, 29, 'own'],
  memo_pad: [33, 34, 32, 'own'],
  friendship_checker: [36, 37, 35, 'own'],
  dowsing_machine: [40, 41, 42, 'own'],
  counter: [45, 46, 47, 'own'],
  pedometer: [50, 51, 52, 'own'],
  coin_toss: [55, 56, 57, 'own'],
  move_tester: [62, 63, 64, 'own'],
  color_changer: [67, 68, 69, 'own'],
  matchup_checker: [72, 73, 74, 'own'],
  alarm_clock: [77, 78, 79, 'own'],
  daycare_checker: [82, 83, 84, 'own'],
  roulette: [87, 88, 89, 'own'],
  kitchen_timer: [92, 93, 94, 'own'],
  link_searcher: [97, 98, 99, 'own'],
  party_status: [107, 108, 109, 'own'],
  calendar: [112, 113, 114, 'own'],
  map: [118, 119, 120, 'own'],
  trainer_counter: [123, 124, 125, 'own'],
};

export function importPoketchArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(NARC.path));
  if (narc.length !== NARC.count) throw new Error(`${NARC.path}: ${narc.length} members, expected ${NARC.count}`);
  const member = (i: number) => narc[i]!;
  const palettes = readNclr(member(PALETTES));
  if (palettes.colors.length !== 256) throw new Error(`Pokétch palettes: ${palettes.colors.length} colours, expected 256`);

  const rows = blankImage(16, 16);
  palettes.colors.forEach((c, i) => rows.rgba.set([...rgb555(c), 255], i * 4));
  sheets.image('poketch/palettes', rows);

  const screen = (nscr: number, ram: PaletteRam, tiles: number): Image => {
    const s = readNscr(member(nscr));
    return { width: 256, height: 192, rgba: renderScreen(s, readNcgr(member(tiles)), ram, 256, 192) };
  };
  const lcd = new PaletteRam().load(palettes);
  for (const [name, [nscr, tiles]] of Object.entries(SCREENS)) sheets.image(`poketch/${name}_bg`, screen(nscr, lcd, tiles));

  // digital_watch_digits.NSCR is 320×72: columns 0–31 then 32–39, each block row-major (decomp
  // DigitalWatchGraphics repacks it); digit d is the 32×72 rect at x = 32d.
  {
    const s = readNscr(member(DIGITAL_WATCH_DIGITS.nscr));
    if (s.width !== 320 || s.height !== 72) throw new Error(`Pokétch watch digits: ${s.width}×${s.height}, expected 320×72`);
    const entries = new Uint16Array(32 * 32 * 2);
    for (let row = 0; row < 9; row++)
      for (let col = 0; col < 40; col++) entries[(col >> 5) * 1024 + row * 32 + (col & 31)] = col < 32 ? s.entries[row * 32 + col]! : s.entries[288 + row * 8 + (col - 32)]!;
    const rgba = renderScreen({ width: 512, height: 256, entries }, readNcgr(member(DIGITAL_WATCH_DIGITS.tiles)), lcd, 320, 72);
    sheets.image('poketch/digital_watch_digits', { width: 320, height: 72, rgba });
  }

  // The border's characters load at char 64 (its NSCR names them from 64), palette 15 by gender.
  const border = readNclr(member(BORDER.nclr));
  const borderChars = readNcgr(member(BORDER.ncgr));
  const shifted = { bitDepth: borderChars.bitDepth, tiles: [...Array.from({ length: BORDER_CHAR_BASE }, () => new Uint8Array(64)), ...borderChars.tiles] };
  for (const [name, p] of Object.entries(BORDER_COLORS)) {
    const ram = new PaletteRam().load(palettes);
    ram.colors.set(border.colors.subarray(p * 16, p * 16 + 16), 15 * 16);
    sheets.image(`poketch/border_${name}`, { width: 256, height: 192, rgba: renderScreen(readNscr(member(BORDER.nscr)), shifted, ram, 256, 192) });
    sheets.image(`poketch/border_${name}_tiles`, tileGrid(borderChars.tiles, 32, ram.colors.subarray(15 * 16)));
  }

  for (const [name, ncgr] of Object.entries(TILES)) {
    const wide = readNcgrData(member(ncgr)).width;
    sheets.image(`poketch/${name}_tiles`, tileGrid(readNcgr(member(ncgr)).tiles, wide > 0 ? wide : 32, palettes.colors));
  }

  const digits = readNcgrData(member(DIGITS.ncgr)).data;
  if (digits.length !== DIGITS_TILES * 32) throw new Error(`Pokétch digits: ${digits.length / 32} tiles, expected ${DIGITS_TILES}`);
  const objSheet = (name: string, ncer: number, nanr: number, chars: Uint8Array) => {
    const bank = readNcer(member(ncer));
    const cells: CellImage[] = bank.cells.map((c) => renderCell(c, chars, palettes.colors, { mapping: bank.mapping, palette: 0 }));
    const anims = animations(readNanr(member(nanr)));
    for (const a of anims) for (const f of a.frames) if (f.cell >= cells.length) throw new Error(`poketch/${name}: animation frame names cell ${f.cell} of ${cells.length}`);
    sheets.add(`poketch/${name}`, cells, { animations: anims });
  };
  objSheet('digits', DIGITS.ncer, DIGITS.nanr, digits);
  for (const [name, [ncer, nanr, ncgr, chars]] of Object.entries(OBJS)) {
    const own = readNcgrData(member(ncgr)).data;
    objSheet(name, ncer, nanr, chars === 'own' ? own : concat(digits, own));
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** 8×8 tiles in a grid `wide` tiles across, coloured with palette `colors` (colour 0 clear). */
function tileGrid(tiles: Uint8Array[], wide: number, colors: Uint16Array): Image {
  const img = blankImage(wide * 8, Math.ceil(tiles.length / wide) * 8);
  tiles.forEach((tile, t) =>
    tile.forEach((index, p) => {
      if (index) img.rgba.set([...rgb555(colors[index]!), 255], ((Math.floor(t / wide) * 8 + (p >> 3)) * img.width + (t % wide) * 8 + (p & 7)) * 4);
    }),
  );
  return img;
}
