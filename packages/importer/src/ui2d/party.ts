/**
 * The party menu's art (pl_plist_gra.narc, members per res/graphics/party_menu/party_menu_graphics.order;
 * decomp party_menu/main.c, windows.c, sprites.c):
 * - `party/bg`: the main screen's BG3 (menu.NSCR 17 over menu_tiles 15, menu.NCLR 16), the top 256×192, and
 *   `party/backdrop` its top-left pixel (the dark stripes' colour, around the panels) as a 1×1 image;
 * - `party/panels`: the member panels of menu_panels.NSCR 22 (PartyMenu_LoadMemberPanelTilemaps: rows 0–5
 *   the lead panel, 6–11 the others, 12–17 the empty one; 16×6 tiles each). DrawMemberPanel gives a panel BG
 *   palette 3 + slot and PartyMenu_UpdateSlotPalette loads its first 8 colours from menu.NCLR palette 3 + p:
 *   p = 0 normal, 2 fainted, 4 selected, 6 selected and fainted, 7 switching (both ends). Cells
 *   `<kind>_<state>`, kind `lead`/`back` (with the HP bar's frame) or `lead_nohp`/`back_nohp` (the bar's
 *   row filled with character 0x17, as for eggs and the comment modes), state `normal`, `fainted`,
 *   `selected`, `selected_fainted`, `switch`; and `none` (the empty slot, palette 1);
 * - `party/hp_fill`: the bar's fill (PartyMenu_DrawMemberHealthbar: rows 2–5 of the 8-px window in colours
 *   10, 9, 9, 10 of palette 3, 4 or 5 for green, yellow, red), as 8×8 characters `<colour>_<n>` with the
 *   first n columns filled (n = 0–8), so a bar is six of them;
 * - `party/text`: the panel texts' colours (TEXT_COLOR(15, 14, 0), (3, 4, 0), (5, 6, 0) of palette 0) as
 *   `textColors` of 1×1 swatches `name`, `male`, `female`;
 * - OBJ sets with the shared OBJ palette (shared.NCLR 8): `party/ball` (member_ball 0–2), `party/cursor`
 *   (cursor 5–7: the selection frame, animation 0 a back panel, 1 the lead, 2 the switch target),
 *   `party/cancel` (button 9–11: the CANCEL/CONFIRM button, animations 0/1 tall, 2/3 short, odd = selected);
 *   and `party/held` (icons 18–21, own NCLR: held item, mail, ball capsule).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, type CellImage, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, rgb555, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const PLIST = {
  path: '/graphic/pl_plist_gra.narc',
  count: 24,
  ball: { ncgr: 2, ncer: 1, nanr: 0 },
  cursor: { ncgr: 7, ncer: 6, nanr: 5 },
  button: { ncgr: 11, ncer: 10, nanr: 9 },
  sharedObj: 8,
  tiles: 15,
  nclr: 16,
  bg: 17,
  icons: { ncgr: 20, ncer: 19, nanr: 18, nclr: 21 },
  panels: 22,
};
/** MEMBER_PANEL_WIDTH/HEIGHT (tiles); the HP bar's row (MEMBER_HEALTHBAR_XPOS/YPOS/WIDTH, MEMBER_HEALTHBAR_EMPTY). */
const PANEL = { w: 16, h: 6, rows: { lead: 0, back: 6, none: 12 }, bar: { x: 6, y: 3, w: 9, empty: 0x17 } };
/** UpdateSlotPalette's p per state (menu.NCLR palette 3 + p); the empty panel uses palette 1. */
const STATES = { normal: 0, fainted: 2, selected: 4, selected_fainted: 6, switch: 7 } as const;
const MENU_PALETTES = 3;
const EMPTY_PALETTE = 1;
/** The HP colours: palette 3 + 0/1/2 (BARCOLOR green, yellow, red), colours 9 (fill) and 10 (edge). */
const HP_COLOURS = ['green', 'yellow', 'red'] as const;
const HP_ROWS = [10, 9, 9, 10];
const HP_TOP = 2;
/** The panel texts: palette 0, TEXT_COLOR(fg, shadow, 0). */
const TEXT = { name: [15, 14], male: [3, 4], female: [5, 6] } as const;

const hex = (c: number) => `#${rgb555(c).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** A panel: the 16×6 entries at `row` of the panel screen, drawn with BG palette 3 (as DrawMemberPanel sets it), its first 8 colours `state`'s. */
function panel(panels: Screen, row: number, noHp: boolean, colors: Uint16Array, tiles: ReturnType<typeof readNcgr>): CellImage {
  const entries = new Uint16Array(1024);
  for (let y = 0; y < PANEL.h; y++)
    for (let x = 0; x < PANEL.w; x++) {
      const bar = noHp && y === PANEL.bar.y && x >= PANEL.bar.x && x < PANEL.bar.x + PANEL.bar.w;
      const e = bar ? PANEL.bar.empty : panels.entries[(row + y) * 32 + x]!;
      entries[y * 32 + x] = (e & 0x0fff) | (MENU_PALETTES << 12);
    }
  const ram = new PaletteRam();
  ram.colors.set(colors.subarray(0, 16), MENU_PALETTES * 16);
  const width = PANEL.w * 8;
  const height = PANEL.h * 8;
  return { width, height, rgba: renderScreen({ width: 256, height: 256, entries }, tiles, ram, width, height), originX: 0, originY: 0 };
}

export function importPartyArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(PLIST.path));
  if (narc.length !== PLIST.count) throw new Error(`${PLIST.path}: ${narc.length} members, expected ${PLIST.count}`);
  const nclr = readNclr(narc[PLIST.nclr]!);
  const tiles = readNcgr(narc[PLIST.tiles]!);

  const bg = readNscr(narc[PLIST.bg]!);
  const ram = new PaletteRam().load(nclr);
  const full: Image = { width: bg.width, height: bg.height, rgba: renderScreen(bg, tiles, ram) };
  const [r, g, b] = rgb555(ram.colors[0]!);
  for (let p = 3; p < full.rgba.length; p += 4) if (!full.rgba[p]) full.rgba.set([r, g, b, 255], p - 3);
  const top = crop(full, 0, 0, 256, 192);
  sheets.image('party/bg', top);
  sheets.image('party/backdrop', crop(top, 0, 0, 1, 1));

  const panels = readNscr(narc[PLIST.panels]!);
  const cells: CellImage[] = [];
  const names: string[] = [];
  const palette = (p: number) => nclr.colors.subarray(p * 16, p * 16 + 16);
  for (const kind of ['lead', 'back'] as const)
    for (const noHp of [false, true])
      for (const [state, p] of Object.entries(STATES)) {
        // UpdateSlotPalette loads 8 colours over the slot's palette (menu.NCLR palette 3 + slot: colours 8–15 are the same in all six).
        const colors = new Uint16Array(palette(MENU_PALETTES));
        colors.set(palette(MENU_PALETTES + p).subarray(0, 8));
        cells.push(panel(panels, PANEL.rows[kind], noHp, colors, tiles));
        names.push(`${kind}${noHp ? '_nohp' : ''}_${state}`);
      }
  cells.push(panel(panels, PANEL.rows.none, false, palette(EMPTY_PALETTE), tiles));
  names.push('none');
  sheets.add('party/panels', cells, { names });

  const fill: CellImage[] = [];
  const fillNames: string[] = [];
  HP_COLOURS.forEach((colour, c) => {
    for (let n = 0; n <= 8; n++) {
      const rgba = new Uint8Array(8 * 8 * 4);
      HP_ROWS.forEach((index, row) => {
        const rgb = rgb555(nclr.colors[(MENU_PALETTES + c) * 16 + index]!);
        for (let x = 0; x < n; x++) rgba.set([...rgb, 255], ((HP_TOP + row) * 8 + x) * 4);
      });
      fill.push({ width: 8, height: 8, rgba, originX: 0, originY: 0 });
      fillNames.push(`${colour}_${n}`);
    }
  });
  sheets.add('party/hp_fill', fill, { names: fillNames });

  const swatches = Object.values(TEXT).map(([fg]) => ({ width: 1, height: 1, rgba: new Uint8Array([...rgb555(nclr.colors[fg]!), 255]), originX: 0, originY: 0 }));
  sheets.add('party/text', swatches, { names: Object.keys(TEXT), textColors: Object.values(TEXT).map(([fg, shadow]) => ({ fg: hex(nclr.colors[fg]!), shadow: hex(nclr.colors[shadow]!) })) });

  sheets.obj('party/ball', narc, { ...PLIST.ball, nclr: PLIST.sharedObj });
  sheets.obj('party/cursor', narc, { ...PLIST.cursor, nclr: PLIST.sharedObj });
  sheets.obj('party/cancel', narc, { ...PLIST.button, nclr: PLIST.sharedObj });
  sheets.obj('party/held', narc, PLIST.icons);
}
