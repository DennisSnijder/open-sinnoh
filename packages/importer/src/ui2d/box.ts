/**
 * The PC boxes' screen art (box.narc; decomp applications/pc_boxes, ov19_*), beside the wallpapers, marks
 * and compare pages menus.ts imports. Ids `platinum:ui2d/box/<name>`:
 * - `box/screen`: the top screen's BG2 (member 0 on characters 1, the seven palettes of NCLR 5;
 *   ov19_021D75CC), the preview panel and its item bar, over colour 0. The wallpaper (BG3) shows through
 *   at (88, 0) (ov19_021D7D00: tile column 11), so the BG2 art must leave that rect clear;
 * - `box/tray`: the party tray (member 6, a 15-tile-wide map on the same characters; ov19_021DCD64 shows
 *   its rows 2–25 at tile column 14, or 9 in compare mode);
 * - `box/compare_sides`: compare mode's BG2 side panels (members 7 and 8 by the compared slot, columns 0–5
 *   and 26–31; ov19_021DEEFC) over colour 0, cell i = slot i live;
 * - `box/preview_marks`: the preview's six marks (BG2 characters 152 + i marked, 132 + i not, palette 2;
 *   ov19_021DB24C), cells 0–5 marked and 6–11 unmarked as `box/markings`;
 * - `box/cursor`: the hand, its shadow and the header arrows (characters 12, cells 13, animations 14,
 *   NCLR 26; ov19_021D8C1C): animations 0 open hand, 2 grabbing, 5 shadow, 6/7 arrows, 8/9 selected;
 * - `box/buttons`: PARTY POKéMON and CLOSE (characters 9, cells 10, animations 11, palette 1 of NCLR 26;
 *   ov19_021DA864);
 * - `box/compare_buttons`: compare mode's touch-screen buttons (characters 134, cells 135, NCLR 137;
 *   ov19_021DF5D0): `left_0`–`left_2` (palette 0), `right_0`–`right_2` (palette 1, drawn flipped as the DS
 *   flips the right sprite), `page_0`–`page_2` (palette 2), `dot_0`/`dot_1` (the contest dots per side).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, crop, renderCell, type CellImage, type Image } from './compose.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, rgb555 } from './nitro2d.ts';
import { screenImage } from './menus.ts';
import type { Sheets } from './sheets.ts';

const BOX = {
  path: '/graphic/box.narc',
  count: 145,
  screen: 0,
  tiles: 1,
  palette: 5,
  palettes: 7,
  tray: 6,
  compareSides: [7, 8],
  cursor: { ncgr: 12, nclr: 26, ncer: 13, nanr: 14 },
  buttons: { ncgr: 9, nclr: 26, ncer: 10, nanr: 11, palette: 1 },
  compareButtons: { ncgr: 134, ncer: 135, nclr: 137 },
};
/** Where the wallpaper shows on the top screen (ov19_021D8764: 21 × 20 tiles at tile column 11). */
const WALLPAPER = { x: 88, y: 0, w: 168, h: 160 };
/** The tray's shown rows (ov19_021DCD64 with the tray up). */
const TRAY_ROWS = [2, 26];
/** Compare mode's side panel columns (ov19_021DEEFC). */
const SIDE_COLUMNS = [6, 26];
/** ov19_021DB24C: the mark characters and palette. */
const MARKS = { marked: 152, unmarked: 132, palette: 2 };

function flipped(c: CellImage): CellImage {
  const out = blankImage(c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) out.rgba.set(c.rgba.subarray((y * c.width + x) * 4, (y * c.width + x) * 4 + 4), (y * c.width + c.width - 1 - x) * 4);
  return { ...out, originX: c.width - c.originX, originY: c.originY };
}

const opaqueIn = (img: Image, x0: number, y0: number, w: number, h: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (img.rgba[(y * img.width + x) * 4 + 3]) return true;
  return false;
};

export function importBoxArt(fs: NitroFs, sheets: Sheets): void {
  const box = readNarc(fs.file(BOX.path));
  if (box.length !== BOX.count) throw new Error(`${BOX.path}: ${box.length} members, expected ${BOX.count}`);
  const ram = new PaletteRam().load(readNclr(box[BOX.palette]!), 0, BOX.palettes * 0x20);
  const chars = readNcgr(box[BOX.tiles]!);

  const top = screenImage(box, BOX.screen, BOX.tiles, BOX.palette, false, BOX.palettes);
  if (opaqueIn(top, WALLPAPER.x, WALLPAPER.y, WALLPAPER.w, WALLPAPER.h)) throw new Error('box.narc 0: the top screen draws over the wallpaper');
  const withBackdrop = screenImage(box, BOX.screen, BOX.tiles, BOX.palette, true, BOX.palettes);
  sheets.image('box/screen', crop(withBackdrop, 0, 0, 256, 192));

  const tray = screenImage(box, BOX.tray, BOX.tiles, BOX.palette, false, BOX.palettes);
  sheets.image('box/tray', crop(tray, 0, TRAY_ROWS[0]! * 8, tray.width, (TRAY_ROWS[1]! - TRAY_ROWS[0]!) * 8));

  const sides = BOX.compareSides.map((member): CellImage => {
    const img = crop(screenImage(box, member, BOX.tiles, BOX.palette, false, BOX.palettes), 0, 0, 256, 192);
    for (let y = 0; y < 192; y++) img.rgba.fill(0, (y * 256 + SIDE_COLUMNS[0]! * 8) * 4, (y * 256 + SIDE_COLUMNS[1]! * 8) * 4);
    // Over the backdrop (colour 0), which shows where neither the panels nor the wallpaper draw.
    const backdrop = [...rgb555(ram.colors[0]!), 255];
    for (let p = 3; p < img.rgba.length; p += 4) if (!img.rgba[p]) img.rgba.set(backdrop, p - 3);
    return { ...img, originX: 0, originY: 0 };
  });
  sheets.add('box/compare_sides', sides);

  const mark = (n: number): CellImage => {
    const img = blankImage(8, 8);
    chars.tiles[n]!.forEach((i, p) => {
      if (i) img.rgba.set([...rgb555(ram.colors[MARKS.palette * 16 + i]!), 255], p * 4);
    });
    return { ...img, originX: 0, originY: 0 };
  };
  sheets.add('box/preview_marks', [...Array.from({ length: 6 }, (_, i) => mark(MARKS.marked + i)), ...Array.from({ length: 6 }, (_, i) => mark(MARKS.unmarked + i))]);

  sheets.obj('box/cursor', box, BOX.cursor);
  sheets.obj('box/buttons', box, BOX.buttons);

  const cb = BOX.compareButtons;
  const bank = readNcer(box[cb.ncer]!);
  const data = readNcgrData(box[cb.ncgr]!).data;
  const colors = readNclr(box[cb.nclr]!).colors;
  const cell = (i: number, palette: number) => {
    const c = bank.cells[i];
    if (!c) throw new Error(`box.narc ${cb.ncer}: no cell ${i}`);
    return renderCell(c, data, colors, { mapping: bank.mapping, palette });
  };
  // ov19_021DF5D0: the side buttons (cells 0–2) with palettes 0 and 1, the page button (cells 3–5) with 2, the contest dots (cells 6, 7).
  const cells = [0, 1, 2].map((i) => cell(i, 0)).concat([0, 1, 2].map((i) => flipped(cell(i, 1))), [3, 4, 5].map((i) => cell(i, 2)), [cell(6, 0), cell(7, 1)]);
  const names = ['left_0', 'left_1', 'left_2', 'right_0', 'right_1', 'right_2', 'page_0', 'page_1', 'page_2', 'dot_0', 'dot_1'];
  sheets.add('box/compare_buttons', cells, { names });
}
