/**
 * The Poffin screens' 2D art (decomp overlay083 ov83_0223C958.c, ov83_0223D6A8.c; applications/poffin_case; poffin_sprite.c).
 *
 * - The cooking (/graphic/nutmixer.narc, members per res/graphics/poffin_cooking/poffin_cooking.order): the top screen
 *   (top_screen NCGR 0 over top_screen_single NSCR 2, every tile on BG palette 3 = top_screen NCLR 1's second palette:
 *   Graphics_LoadPaletteFromOpenNARC at palette 2, Bg_ChangeTilemapRectPalette 3) `poffin_cooking/top_screen`; the
 *   banner's box (textbox NCGR 5 over NSCR 7 on palette 4 = textbox NCLR 6) `poffin_cooking/textbox`; the pot's
 *   software-sprite textures (ov83_0223E368: 4bpp bitmaps, each with its own palette) `poffin_cooking/tablecloth`
 *   (40/41), `pot` (38/39), `flames0..2` (34 with 35, 36, 37: one per phase), `batter0..2` (42/43, 44/45, 46/47); the OBJ sets
 *   (ov83_0223CDD0) `interface` (14/13/12, palette 8), `sparkles` (17/16/15, 8), `puff0..2` (20, 23, 26; palettes 9, 10,
 *   11), `done` (29/28/27, 8), `arrow` (32/31/30, 33).
 * - The berry dropped in (/graphic/ntag_gra.narc, ov83_0223DB4C: berry NCGR 6 + n and NCLR 70 + n, cell bank 5) one
 *   cell per berry `poffin_cooking/berries`, named by the berry's number (0 Cheri).
 * - The Poffins (/graphic/poruact.narc, PoffinSprite: NCGR 0, cell bank 1, palette 3 + type) one cell per type
 *   `poffin/poffins`.
 * - The Poffin Case (/graphic/poru_gra.narc, poru_gra.naix): the main screen (main_tiles NCGR 2 over main_tilemap NSCR
 *   10, background NCLR 0) `poffin_case/main`, the touch screen (sub_tiles 3 over sub_tilemap 11) `poffin_case/sub`, the
 *   OBJ sets `poffin_case/main_sprites` (4/6/7) and `poffin_case/sub_sprites` (5/8/9), both with sprites NCLR 1.
 * - The feeding (/graphic/porudemo.narc): the top screen (top_screen_tiles NCGR 2 over NSCR 4 with NCLR 0) `poffin_feed/top`.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, renderCell, type CellImage, type Image } from './compose.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const NUT = { path: '/graphic/nutmixer.narc', count: 48 };
const NTAG = { path: '/graphic/ntag_gra.narc', berries: 64, ncgr: 6, nclr: 70, ncer: 5 };
const PORUACT = { path: '/graphic/poruact.narc', types: 29 };
const PORU = { path: '/graphic/poru_gra.narc', count: 12 };
const PORUDEMO = { path: '/graphic/porudemo.narc', count: 6 };

function narcOf(fs: NitroFs, path: string, count?: number): Uint8Array[] {
  const narc = readNarc(fs.file(path));
  if (count !== undefined && narc.length !== count) throw new Error(`${path}: ${narc.length} members, expected ${count}`);
  return narc;
}

/** Every entry of a screen on palette `p` (Bg_ChangeTilemapRectPalette over the whole map). */
const onPalette = (s: Screen, p: number): Screen => ({ ...s, entries: s.entries.map((e) => (e & 0x0fff) | (p << 12)) });

/** A BG's top-left 256×192, its backdrop (colour 0) filled when `backdrop`. */
function bgImage(narc: Uint8Array[], chr: number, scr: Screen, ram: PaletteRam, backdrop: boolean): Image {
  const img = crop({ width: scr.width, height: scr.height, rgba: renderScreen(scr, readNcgr(narc[chr]!), ram) }, 0, 0, 256, 192);
  if (backdrop) {
    const [r, g, b] = rgb555(ram.colors[0]!);
    for (let p = 3; p < img.rgba.length; p += 4) if (!img.rgba[p]) img.rgba.set([r, g, b, 255], p - 3);
  }
  return img;
}

/** A software sprite's texture (SoftwareSprite_LoadChars): a 4bpp bitmap (scanned NCGR) with its palette, colour 0 clear. */
function texture(narc: Uint8Array[], chr: number, pal: number): Image {
  const c = readNcgrData(narc[chr]!);
  if (!c.scanned || c.bitDepth !== 4 || c.width < 1) throw new Error(`poffin cooking: member ${chr} is not a 4bpp bitmap`);
  const colors = readNclr(narc[pal]!).colors;
  const w = c.width * 8;
  const h = c.height * 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = (c.data[i >> 1]! >> ((i & 1) * 4)) & 15;
    if (v) rgba.set([...rgb555(colors[v]!), 255], i * 4);
  }
  return { width: w, height: h, rgba };
}

export function importPoffinArt(fs: NitroFs, sheets: Sheets): void {
  const nut = narcOf(fs, NUT.path, NUT.count);
  {
    const ram = new PaletteRam().load(readNclr(nut[1]!), 2 * 32, 2 * 32);
    sheets.image('poffin_cooking/top_screen', bgImage(nut, 0, onPalette(readNscr(nut[2]!), 3), ram, true));
  }
  {
    const ram = new PaletteRam().load(readNclr(nut[6]!), 4 * 32, 32);
    sheets.image('poffin_cooking/textbox', bgImage(nut, 5, onPalette(readNscr(nut[7]!), 4), ram, false));
  }
  sheets.image('poffin_cooking/tablecloth', texture(nut, 40, 41));
  sheets.image('poffin_cooking/pot', texture(nut, 38, 39));
  [35, 36, 37].forEach((pal, i) => sheets.image(`poffin_cooking/flames${i}`, texture(nut, 34, pal)));
  [42, 44, 46].forEach((chr, i) => sheets.image(`poffin_cooking/batter${i}`, texture(nut, chr, chr + 1)));
  sheets.obj('poffin_cooking/interface', nut, { ncgr: 14, ncer: 13, nanr: 12, nclr: 8 });
  sheets.obj('poffin_cooking/sparkles', nut, { ncgr: 17, ncer: 16, nanr: 15, nclr: 8 });
  [9, 10, 11].forEach((nclr, i) => sheets.obj(`poffin_cooking/puff${i}`, nut, { ncgr: 20 + 3 * i, ncer: 19 + 3 * i, nanr: 18 + 3 * i, nclr }));
  sheets.obj('poffin_cooking/done', nut, { ncgr: 29, ncer: 28, nanr: 27, nclr: 8 });
  sheets.obj('poffin_cooking/arrow', nut, { ncgr: 32, ncer: 31, nanr: 30, nclr: 33 });

  const ntag = narcOf(fs, NTAG.path, NTAG.nclr + NTAG.berries);
  {
    const bank = readNcer(ntag[NTAG.ncer]!);
    const berries: CellImage[] = Array.from({ length: NTAG.berries }, (_, n) => {
      const chars = readNcgrData(ntag[NTAG.ncgr + n]!);
      return renderCell(bank.cells[0]!, chars.data, readNclr(ntag[NTAG.nclr + n]!).colors, { mapping: bank.mapping });
    });
    sheets.add('poffin_cooking/berries', berries, { names: berries.map((_, n) => String(n)) });
  }

  const act = narcOf(fs, PORUACT.path, 3 + PORUACT.types);
  {
    const bank = readNcer(act[1]!);
    const chars = readNcgrData(act[0]!);
    const poffins = Array.from({ length: PORUACT.types }, (_, type) => renderCell(bank.cells[0]!, chars.data, readNclr(act[3 + type]!).colors, { mapping: bank.mapping, palette: 0 }));
    sheets.add('poffin/poffins', poffins, { names: poffins.map((_, n) => String(n)) });
  }

  const poru = narcOf(fs, PORU.path, PORU.count);
  {
    const ram = new PaletteRam().load(readNclr(poru[0]!, { compressed: true }));
    sheets.image('poffin_case/main', bgImage(poru, 2, readNscr(poru[10]!), ram, true));
    sheets.image('poffin_case/sub', bgImage(poru, 3, readNscr(poru[11]!), ram, true));
  }
  sheets.obj('poffin_case/main_sprites', poru, { ncgr: 4, ncer: 6, nanr: 7, nclr: 1, compressed: true });
  sheets.obj('poffin_case/sub_sprites', poru, { ncgr: 5, ncer: 8, nanr: 9, nclr: 1, compressed: true });

  const demo = narcOf(fs, PORUDEMO.path, PORUDEMO.count);
  {
    const ram = new PaletteRam().load(readNclr(demo[0]!));
    sheets.image('poffin_feed/top', bgImage(demo, 2, readNscr(demo[4]!), ram, true));
  }
}
