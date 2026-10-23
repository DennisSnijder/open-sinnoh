/**
 * The Ball Capsule editor's 2D art (docs/research/seals.md §5.5; decomp capsule_menu/graphics.c,
 * /application/custom_ball/data/cb_data.narc, 295 members: 0–91 NANR, 92–183 NCER, 184–281 NCGR, 282–285 NSCR,
 * 286–294 NCLR):
 * - the top screen's BGs (CapsuleGraphics_LoadBgLayer2Tilemap): main 2 (NCGR 268 over NSCR 284) and main 3 (269
 *   over 285), both with NCLR 288's two palettes: `capsule/main2`, `capsule/main3`;
 * - the touch screen's BGs (LoadBgLayer5/7Tilemap): sub 1, the capsule's backdrop that scrolls on EDIT (267 over 283),
 *   and sub 3 (267 over 282), with NCLR 287's two palettes: `capsule/sub1`, `capsule/sub3`;
 * - the OBJ sets: the 12 capsules (266/174/82, NCLR 286) `capsule/capsules`, the capsule cursor (275/179/87, 291)
 *   `capsule/cursor`, the page arrows (273/177/85 and 274/178/86, 290 palette 1) `capsule/page_up`, `capsule/page_down`,
 *   the Test button (272/176/84, 290 palette 1) `capsule/test`, CONFIRM/CANCEL (270/175/83, 290 palette 0)
 *   `capsule/button` and the editor's corner arrows (265/173/81, 290 palette 2) `capsule/arrows`;
 * - the seals: each seal NCGR (184–264) drawn with the placed seals' cell bank (NCER 93, centred; the list's NCER 180 is
 *   the same cell a pixel higher) and NCLR 293, `capsule/seals`, one cell per NCGR member less 184.
 * Sprites take the palette of their template's plttIdx (Sprite_SetExplicitPalette), not their cells' OAM palette.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { renderCell, type Image } from './compose.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const CB_DATA = { path: '/application/custom_ball/data/cb_data.narc', count: 295 };
/** The seal NCGRs (sealTypeValues memberIdx). */
export const SEAL_ART = { first: 184, last: 264 };

/** A BG's top-left 256×192 with `palettes` of NCLR `pal` loaded at palette 0. */
function bg(narc: Uint8Array[], chr: number, scr: number, pal: number, palettes: number): Image {
  const screen = readNscr(narc[scr]!);
  const ram = new PaletteRam().load(readNclr(narc[pal]!), 0, palettes * 0x20);
  const full = { width: screen.width, height: screen.height, rgba: renderScreen(screen, readNcgr(narc[chr]!), ram) };
  const out = { width: 256, height: 192, rgba: new Uint8Array(256 * 192 * 4) };
  for (let y = 0; y < 192; y++) out.rgba.set(full.rgba.subarray(y * full.width * 4, (y * full.width + 256) * 4), y * 256 * 4);
  return out;
}

export function importSealArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(CB_DATA.path));
  if (narc.length !== CB_DATA.count) throw new Error(`${CB_DATA.path}: ${narc.length} members, expected ${CB_DATA.count}`);
  sheets.image('capsule/main2', bg(narc, 268, 284, 288, 2));
  sheets.image('capsule/main3', bg(narc, 269, 285, 288, 2));
  sheets.image('capsule/sub1', bg(narc, 267, 283, 287, 2));
  sheets.image('capsule/sub3', bg(narc, 267, 282, 287, 2));
  sheets.obj('capsule/capsules', narc, { ncgr: 266, ncer: 174, nanr: 82, nclr: 286 });
  sheets.obj('capsule/cursor', narc, { ncgr: 275, ncer: 179, nanr: 87, nclr: 291 });
  sheets.obj('capsule/page_up', narc, { ncgr: 273, ncer: 177, nanr: 85, nclr: 290, palette: 1 });
  sheets.obj('capsule/page_down', narc, { ncgr: 274, ncer: 178, nanr: 86, nclr: 290, palette: 1 });
  sheets.obj('capsule/test', narc, { ncgr: 272, ncer: 176, nanr: 84, nclr: 290, palette: 1 });
  sheets.obj('capsule/button', narc, { ncgr: 270, ncer: 175, nanr: 83, nclr: 290, palette: 0 });
  sheets.obj('capsule/arrows', narc, { ncgr: 265, ncer: 173, nanr: 81, nclr: 290, palette: 2 });
  const bank = readNcer(narc[93]!);
  const colors = readNclr(narc[293]!).colors;
  const seals = Array.from({ length: SEAL_ART.last - SEAL_ART.first + 1 }, (_, k) =>
    renderCell(bank.cells[0]!, readNcgrData(narc[SEAL_ART.first + k]!).data, colors, { mapping: bank.mapping }),
  );
  sheets.add('capsule/seals', seals);
}
