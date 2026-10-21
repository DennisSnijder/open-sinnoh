/**
 * The map-name popup signboards (arc/area_win_gra.narc; decomp overlay 5 map_name_popup.c and
 * res/graphics/map_popups/map_popup.order). Window style s is NCGR member 2s and NCLR member 2s + 1.
 * The board is the first 17×5 characters laid out row by row (136×40 px, MapNamePopUp_DrawWindowFrame),
 * drawn with the file's first palette; colour 0 is transparent. The name is printed in colours 3
 * (foreground) and 2 (shadow) of that palette (MapNamePopUp_PrintMapName, TEXT_COLOR(3, 2, 0)).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import type { Id } from '@opensinnoh/core';
import { blankImage } from './compose.ts';
import { readNclr, readNcgr, rgb555 } from './nitro2d.ts';
import { sheetId, type Sheets } from './sheets.ts';

const NARC = '/arc/area_win_gra.narc';
/** Decomp MAP_LABEL_WINDOW_* order (map header window id − 1). */
export const MAP_POPUP_STYLES = ['city', 'town', 'route', 'cave', 'forest', 'water', 'park', 'lake', 'indoors'] as const;
export const MAP_POPUP_SIZE = { cols: 17, rows: 5 } as const;
const TEXT_FG = 3;
const TEXT_SHADOW = 2;

export const mapPopupSheet = (style: number): Id => {
  const name = MAP_POPUP_STYLES[style];
  if (!name) throw new Error(`map popup: no window style ${style}`);
  return sheetId(`map_popups/${name}`);
};

const hex = (c: number) => `#${rgb555(c).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export function importMapPopups(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(NARC));
  if (narc.length !== MAP_POPUP_STYLES.length * 2) throw new Error(`${NARC}: ${narc.length} members, expected ${MAP_POPUP_STYLES.length * 2}`);
  const { cols, rows } = MAP_POPUP_SIZE;
  MAP_POPUP_STYLES.forEach((name, s) => {
    const chars = readNcgr(narc[s * 2]!);
    const colors = readNclr(narc[s * 2 + 1]!).colors;
    if (chars.tiles.length < cols * rows) throw new Error(`${NARC} member ${s * 2}: ${chars.tiles.length} characters, expected ${cols * rows}`);
    const img = blankImage(cols * 8, rows * 8);
    for (let t = 0; t < cols * rows; t++)
      chars.tiles[t]!.forEach((index, p) => {
        if (!index) return;
        const x = (t % cols) * 8 + (p & 7);
        const y = Math.floor(t / cols) * 8 + (p >> 3);
        img.rgba.set([...rgb555(colors[index]!), 255], (y * img.width + x) * 4);
      });
    sheets.add(`map_popups/${name}`, [{ ...img, originX: 0, originY: 0 }], { textColors: [{ fg: hex(colors[TEXT_FG]!), shadow: hex(colors[TEXT_SHADOW]!) }] });
  });
}
