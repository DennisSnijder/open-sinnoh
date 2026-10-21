/**
 * Menu art for the menu screens (used by the app's views):
 * - the summary's page tabs (pl_pst_gra, res/graphics/pokemon_summary_screen order: tabs 129, cells 128,
 *   animations 127, sprites.NCLR 69): `summary/tabs`, 8 small tabs then 8 selected ones, in page order
 *   INFO, MEMO, SKILLS, CONDITION, BATTLE MOVES, CONTEST MOVES, RIBBONS, EXIT;
 * - the 24 box wallpapers (box.narc; decomp ov19_021D79F8.c Unk_ov19_021E0178: NSCR 30 + 3i, NCGR
 *   29 + 3i, NCLR 28 + 3i; 168 × 160): `box/wallpaper_NN`, palette colour 0 filled as the backdrop, `textColors`
 *   the box name's (colours 2 and 1);
 * - the box marks (box.narc 25, the markings window's 6 × 2 characters, drawn with BG palette 4 of NCLR 5 as
 *   ov19_021DB2FC.c blits them into the window): `box/markings`, cells 0–5 marked and 6–11 unmarked, in
 *   circle, triangle, square, heart, star, diamond order; colour 15 (the window's fill) left transparent;
 * - compare mode's three touch-screen pages (box.narc screens 129–131 over tiles 132, the four palettes
 *   of NCLR 133; ov19_021DEC04.c): `box/compare_stats`, `box/compare_contest`, `box/compare_moves`,
 *   256 × 192;
 * - the naming screen's background and key panels (namein.narc per naming_screen.order: NCLR 0, tiles
 *   2, bg 4, the three page panels 6–8): `naming/bg`, `naming/keys_N`, each panel with the keyboard window the
 *   game draws over it (NamingScreen_InitWindows: tiles (2, 1), 26 × 12, palette 1; NamingScreen_InitializeCharsGraphics:
 *   filled with sCharsBgColor, the 16 × 19 cells checkered with sCharsAltBgColor), `textColors` the keys'
 *   TEXT_COLOR(14, 15, 0); its OBJs (sprites NCGR 10, NCLR 1, NCER
 *   12, NANR 14) as `naming/sprites`, whose animations 48/49 (the boy, the girl) and 51 (the rival) are the entry
 *   box's icon;
 * - the badge case's badges (trainer_case.narc: sprites 33, cells 44, one NCLR per badge from 16):
 *   `trainer_case/badges`, cell i = badge i (decomp BADGE_ID_* order);
 * - the card portraits (lucas/dawn.NSCR 40/41 over player_tiles 31, trainer_card_normal.NCLR 0), cropped
 *   to the picture: `trainer_case/portrait_male`, `trainer_case/portrait_female`; the cell origin is minus
 *   the crop's top-left, so drawn at the card's (0, 0) it lands where the DS shows it (BG_LAYER_SUB_3 at 0, 0);
 * - the card itself (trainer_card_tiles 27, 8 bpp, under trainer_card_front/back.NSCR 35/36, which are
 *   256×256 affine screens of one byte per entry; the top 24 rows show): `trainer_case/card`, cells
 *   `front_0` … `front_5`, `front_nodex`, `back_0` … `back_nodex`. TrainerCase_LoadCardPalette: the normal
 *   palette (0) with palettes 1–3 and 15 from the card level's (0–5: normal, cobalt, bronze, silver, gold,
 *   black; 6: normal_no_dex before the Pokédex). `textColors`: palette 15 colours 1 and 2 (the card's
 *   TEXT_COLOR(1, 2, 0)).
 * - the badge case, the card's touch screen (badge_case.NSCR 38 over badge_case_tiles 29 with the first palette of
 *   case_platinum.NCLR 10, as TrainerCase_LoadCasePalette loads it for Platinum): `trainer_case/case`, 256 × 192;
 *   the top screen behind the card (case_top_screen.NSCR 37 over its tiles 28, BG_LAYER_SUB_1, the same palette):
 *   `trainer_case/top_screen`, 256 × 192.
 * - the summary's ribbons (pl_pst_gra: ribbons_cell.NCER 71, one NCGR per ribbon 72–119, ribbons.NCLR 136):
 *   `summary/ribbons`, cell i = ribbon i (decomp enum Ribbon) drawn with its palette, per the arm9
 *   sRibbonDataTable (ribbon.c), which also gives each ribbon's name and description message.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, renderCell, type CellImage, type Image } from './compose.ts';
import { readNcer } from './ncer.ts';
import { blocks, charactersOf, need, PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555, type Characters } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const SUMMARY = { path: '/graphic/pl_pst_gra.narc', count: 137, tabs: { ncgr: 129, ncer: 128, nanr: 127, nclr: 69 }, ribbons: { ncer: 71, firstNcgr: 72, lastNcgr: 119, nclr: 136 } };
/** Decomp RIBBON_MAX; sRibbonDataTable rows are {u32 monDataParam, u16 spriteID, u16 paletteNum, u16 nameID, u16 descriptionID}. */
export const RIBBON_COUNT = 80;
export const RIBBON_ROW_SIZE = 12;
/**
 * Decomp ribbon.c: a description id with SPECIAL_DESCRIPTION_MASK set is an index into the save's special
 * ribbon table (set by Mystery Gift), whose entry is added to SPECIAL_DESCRIPTIONS_START. The engine has
 * no Mystery Gift, so every entry is the fresh save's 0 (PokemonSummaryScreen_GetRibbonDescriptionID).
 */
const SPECIAL_DESCRIPTION_MASK = 0x8000;
const SPECIAL_DESCRIPTIONS_START = 146;

/** A ribbon's name and description: message numbers in TEXT_BANK_RIBBON_NAMES. */
export interface RibbonText {
  name: number;
  description: number;
}
const BOX = { path: '/graphic/box.narc', count: 145, wallpapers: 24, marks: { ncgr: 25, nclr: 5, palette: 4, fill: 15 }, compare: { tiles: 132, nclr: 133, palettes: 4, pages: { stats: 129, contest: 130, moves: 131 } } };
const NAMING = {
  path: '/data/namein.narc',
  count: 19,
  nclr: 0,
  tiles: 2,
  bg: 4,
  pages: [6, 7, 8],
  sprites: { ncgr: 10, nclr: 1, ncer: 12, nanr: 14 },
  /** The keyboard window (DS px of the panel's screen), its palette, cell, and per page sCharsBgColor / sCharsAltBgColor. */
  keys: { x: 16, y: 8, width: 26 * 8, height: 12 * 8, palette: 1, cellW: 16, cellH: 19, rows: 5, fill: [4, 7, 13], alt: [3, 6, 12], text: { fg: 14, shadow: 15 } },
};
const CASE = {
  path: '/graphic/trainer_case.narc',
  badgeChars: 33,
  badgeCells: 44,
  badgePalette: 16,
  badges: 8,
  portraitTiles: 31,
  portraits: { male: 40, female: 41 },
  cardPalette: 0,
  cardTiles: 27,
  cardScreens: { front: 35, back: 36 },
  cardLevels: ['0', '1', '2', '3', '4', '5', 'nodex'],
  /** The badge case (the touch screen; main.c TrainerCase_DrawTrainerCard: BG_LAYER_MAIN_2, TrainerCase_LoadCasePalette). */
  case: { screen: 38, tiles: 29, top: 37, topTiles: 28, platinumPalette: 10 },
};
/** The DS screen: the card shows its top 32×24 tiles. */
const CARD_W = 256;
const CARD_H = 192;

const hex = (c: number) => `#${rgb555(c).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * The trainer card's BG (an 8 bpp affine screen: one byte per entry, a character number; no flips or
 * palette bits), its top 256×192 drawn with `colors` (colour 0 is transparent).
 */
function cardImage(screenFile: Uint8Array, tiles: Characters, colors: Uint16Array): Image {
  const { r, blocks: b } = blocks(screenFile, 'RCSN');
  const o = need(b, 'NRCS', 'NSCR');
  const [width, height, size] = [r.u16(o + 8), r.u16(o + 10), r.u32(o + 16)];
  if (width !== 256 || height !== 256 || size !== 1024) throw new Error(`trainer card NSCR: ${width}×${height}, ${size} bytes (expected a 256×256 affine screen)`);
  const rgba = new Uint8Array(CARD_W * CARD_H * 4);
  for (let ty = 0; ty < CARD_H / 8; ty++)
    for (let tx = 0; tx < CARD_W / 8; tx++) {
      const n = screenFile[o + 20 + ty * 32 + tx]!;
      const tile = tiles.tiles[n];
      if (!tile) throw new Error(`trainer card: character ${n} of ${tiles.tiles.length}`);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const i = tile[y * 8 + x]!;
          if (i) rgba.set([...rgb555(colors[i]!), 255], ((ty * 8 + y) * CARD_W + tx * 8 + x) * 4);
        }
    }
  return { width: CARD_W, height: CARD_H, rgba };
}

/** A key panel with the keyboard window as NamingScreen_InitializeCharsGraphics draws it for page `page`. */
function namingKeys(panel: Image, colors: Uint16Array, page: number): Image {
  const k = NAMING.keys;
  const fill = (x: number, y: number, w: number, h: number, color: number) => {
    const rgb = [...rgb555(colors[color]!), 255];
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) panel.rgba.set(rgb, ((k.y + py) * panel.width + k.x + px) * 4);
  };
  fill(0, 0, k.width, k.height, k.fill[page]!);
  // Rows 0, 2, 4 start on the fill colour, rows 1 and 3 on the alternate one.
  for (let row = 0; row < k.rows; row++)
    for (let x = row % 2 ? 0 : k.cellW; x < k.width; x += k.cellW * 2) fill(x, row * k.cellH, k.cellW, k.cellH, k.alt[page]!);
  return panel;
}

function narcOf(fs: NitroFs, n: { path: string; count: number }): Uint8Array[] {
  const narc = readNarc(fs.file(n.path));
  if (narc.length !== n.count) throw new Error(`${n.path}: ${narc.length} members, expected ${n.count}`);
  return narc;
}

/**
 * A BG screen drawn with its file's palettes from palette 0 (the first `palettes` of them, else all that
 * fit); `backdrop` fills transparent pixels with colour 0.
 */
export function screenImage(narc: Uint8Array[], scr: number, chr: number, pal: number, backdrop: boolean, palettes?: number): Image {
  const screen = readNscr(narc[scr]!);
  const palette = readNclr(narc[pal]!);
  const ram = new PaletteRam().load(palette, 0, palettes ? palettes * 0x20 : Math.min(512, palette.colors.length * 2));
  const rgba = renderScreen(screen, readNcgr(narc[chr]!), ram);
  if (backdrop) {
    const [r, g, b] = rgb555(ram.colors[0]!);
    for (let p = 3; p < rgba.length; p += 4) if (!rgba[p]) rgba.set([r, g, b, 255], p - 3);
  }
  return { width: screen.width, height: screen.height, rgba };
}

/** The smallest rect holding every opaque pixel, and its top-left in `img`. */
function trim(img: Image): { image: Image; x: number; y: number } {
  let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (!img.rgba[(y * img.width + x) * 4 + 3]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (x1 < 0) throw new Error('trim: an empty image');
  return { image: crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1), x: x0, y: y0 };
}

/** The 12 mark characters (6 marked, then 6 unmarked) as 8×8 cells. */
function markCells(box: Uint8Array[]): CellImage[] {
  const { ncgr, nclr, palette, fill } = BOX.marks;
  const chars = readNcgr(box[ncgr]!);
  if (chars.tiles.length !== 12 || chars.bitDepth !== 4) throw new Error(`box.narc ${ncgr}: ${chars.tiles.length} ${chars.bitDepth}bpp characters, expected 12 4bpp marks`);
  const colors = readNclr(box[nclr]!).colors;
  return chars.tiles.map((tile) => {
    const rgba = new Uint8Array(8 * 8 * 4);
    tile.forEach((index, p) => {
      if (index === 0 || index === fill) return;
      const [r, g, b] = rgb555(colors[palette * 16 + index]!);
      rgba.set([r, g, b, 255], p * 4);
    });
    return { width: 8, height: 8, rgba, originX: 0, originY: 0 };
  });
}

/** `ribbonTable`: the SHA1-checked arm9 sRibbonDataTable bytes. Returns each ribbon's texts, by ribbon id. */
export function importMenuArt(fs: NitroFs, sheets: Sheets, ribbonTable: Uint8Array): RibbonText[] {
  const pst = narcOf(fs, SUMMARY);
  sheets.obj('summary/tabs', pst, SUMMARY.tabs);
  const ribbons = importRibbons(pst, ribbonTable, sheets);

  const box = narcOf(fs, BOX);
  // The box name is printed on the wallpaper in its palette's colours 2 and 1 (ov19_021D7C58: TEXT_COLOR(2, 1, 0)).
  for (let i = 0; i < BOX.wallpapers; i++) {
    const colors = readNclr(box[28 + 3 * i]!).colors;
    sheets.image(`box/wallpaper_${String(i).padStart(2, '0')}`, screenImage(box, 30 + 3 * i, 29 + 3 * i, 28 + 3 * i, true), { textColors: [{ fg: hex(colors[2]!), shadow: hex(colors[1]!) }] });
  }
  sheets.add('box/markings', markCells(box));
  for (const [page, scr] of Object.entries(BOX.compare.pages)) sheets.image(`box/compare_${page}`, crop(screenImage(box, scr, BOX.compare.tiles, BOX.compare.nclr, true, BOX.compare.palettes), 0, 0, 256, 192));

  const namein = narcOf(fs, NAMING);
  sheets.image('naming/bg', screenImage(namein, NAMING.bg, NAMING.tiles, NAMING.nclr, true));
  const keyColors = readNclr(namein[NAMING.nclr]!).colors.subarray(NAMING.keys.palette * 16);
  const keyText = { fg: hex(keyColors[NAMING.keys.text.fg]!), shadow: hex(keyColors[NAMING.keys.text.shadow]!) };
  NAMING.pages.forEach((member, p) => sheets.image(`naming/keys_${p}`, namingKeys(screenImage(namein, member, NAMING.tiles, NAMING.nclr, false), keyColors, p), { textColors: [keyText] }));
  // The screen's OBJs (naming_screen_sprites): among them the entry box's icons (NamingScreen_InitIconSprite).
  sheets.obj('naming/sprites', namein, NAMING.sprites);

  const tc = readNarc(fs.file(CASE.path));
  const bank = readNcer(tc[CASE.badgeCells]!);
  const chars = readNcgrData(tc[CASE.badgeChars]!).data;
  const badges: CellImage[] = Array.from({ length: CASE.badges }, (_, i) => {
    const cell = bank.cells[i];
    if (!cell) throw new Error(`trainer case: no badge cell ${i}`);
    return renderCell(cell, chars, readNclr(tc[CASE.badgePalette + i]!).colors, { mapping: bank.mapping, palette: 0 });
  });
  sheets.add('trainer_case/badges', badges);
  for (const [gender, member] of Object.entries(CASE.portraits)) {
    const t = trim(screenImage(tc, member, CASE.portraitTiles, CASE.cardPalette, false));
    sheets.add(`trainer_case/portrait_${gender}`, [{ ...t.image, originX: -t.x, originY: -t.y }]);
  }

  const cardTiles = readNcgrData(tc[CASE.cardTiles]!);
  if (cardTiles.bitDepth !== 8) throw new Error(`trainer card tiles: ${cardTiles.bitDepth} bpp, expected 8`);
  const cardChars = charactersOf(cardTiles.data, 8);
  const base = readNclr(tc[CASE.cardPalette]!).colors;
  const cards: CellImage[] = [];
  const names: string[] = [];
  const textColors: { fg: string; shadow: string }[] = [];
  for (const [side, member] of Object.entries(CASE.cardScreens))
    CASE.cardLevels.forEach((level, i) => {
      const colors = new Uint16Array(base.subarray(0, 256));
      const own = readNclr(tc[CASE.cardPalette + i]!).colors;
      colors.set(own.subarray(16, 64), 16);
      colors.set(own.subarray(240, 256), 240);
      cards.push({ ...cardImage(tc[member]!, cardChars, colors), originX: 0, originY: 0 });
      names.push(`${side}_${level}`);
      textColors.push({ fg: hex(colors[241]!), shadow: hex(colors[242]!) });
    });
  sheets.add('trainer_case/card', cards, { names, textColors });

  const caseRam = new PaletteRam().load(readNclr(tc[CASE.case.platinumPalette]!), 0, 32);
  sheets.image('trainer_case/case', { width: 256, height: 192, rgba: renderScreen(readNscr(tc[CASE.case.screen]!), readNcgr(tc[CASE.case.tiles]!), caseRam, 256, 192) });
  sheets.image('trainer_case/top_screen', { width: 256, height: 192, rgba: renderScreen(readNscr(tc[CASE.case.top]!), readNcgr(tc[CASE.case.topTiles]!), caseRam, 256, 192) });
  return ribbons;
}

function importRibbons(pst: Uint8Array[], table: Uint8Array, sheets: Sheets): RibbonText[] {
  const r = SUMMARY.ribbons;
  if (table.length !== RIBBON_COUNT * RIBBON_ROW_SIZE) throw new Error(`ribbons: table of ${table.length} bytes`);
  const bank = readNcer(pst[r.ncer]!);
  const cell = bank.cells[0];
  if (bank.cells.length !== 1 || !cell) throw new Error(`ribbons: ${bank.cells.length} cells, expected 1`);
  const colors = readNclr(pst[r.nclr]!).colors;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const texts: RibbonText[] = [];
  const cells: CellImage[] = [];
  for (let i = 0; i < RIBBON_COUNT; i++) {
    const at = i * RIBBON_ROW_SIZE;
    const sprite = view.getUint16(at + 4, true);
    const palette = view.getUint16(at + 6, true);
    const description = view.getUint16(at + 10, true);
    if (sprite < r.firstNcgr || sprite > r.lastNcgr) throw new Error(`ribbon ${i}: sprite ${sprite} is not a ribbon NCGR`);
    if ((palette + 1) * 16 > colors.length) throw new Error(`ribbon ${i}: palette ${palette} past ${colors.length} colours`);
    cells.push(renderCell(cell, readNcgrData(pst[sprite]!).data, colors, { mapping: bank.mapping, palette }));
    texts.push({ name: view.getUint16(at + 8, true), description: description & SPECIAL_DESCRIPTION_MASK ? SPECIAL_DESCRIPTIONS_START : description });
  }
  sheets.add('summary/ribbons', cells);
  return texts;
}
