/**
 * Rowan's intro art (decomp applications/rowan_intro/rowan_intro_app.c, /demo/intro/intro.narc; Platinum's palettes).
 * Main BG3 (RowanIntro_LoadLayer3Tilemap): NCGR 0 over NSCR 4 (`plain`) or 8 (`adventure`, the ADVENTURE INFO box),
 * palette file 3 at palettes 0–2. Main BG1/BG2 pictures (RowanIntro_LoadTilemap): one NCGR each over NSCR 23 with
 * every tile on palette 7 (Bg_ChangeTilemapRectPalette), the picture's palette file loaded there: Rowan (19, 20),
 * the boy's run (9–12, 13), the girl's (14–17, 18), the rival (21, 22), and the end's shrinking avatar (male 42–45,
 * female 46–49, on the avatar's palette). The touch screen's Poké Ball (RowanIntro_LoadPokeballTilemap,
 * LoadSubLayer3Tilemap index 4): sub BG3 NCGR 24 over NSCR 31 (palette file 27 at palettes 0–4) and the button,
 * sub BG2 NSCR 40 on palette 9 (palette file 41 at palettes 7–9) with NCGR 32, 33 or 34 at character 32 (the
 * characters below 32 are cleared). Sheets: `intro/backdrops` (two 256×192 cells), `intro/people` and `intro/ball`
 * (cells cropped to their pixels, origin at the screen's (0, 0); named).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, type CellImage, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, type Characters, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const INTRO = { path: '/demo/intro/intro.narc', count: 50 };
const W = 256;
const H = 192;
const PICTURES: [string, number, number][] = [
  ['rowan', 19, 20],
  ...[9, 10, 11, 12].map((c, i): [string, number, number] => [`boy-${i}`, c, 13]),
  ...[14, 15, 16, 17].map((c, i): [string, number, number] => [`girl-${i}`, c, 18]),
  ['rival', 21, 22],
  ...[42, 43, 44, 45].map((c, i): [string, number, number] => [`boy-shrink-${i + 1}`, c, 13]),
  ...[46, 47, 48, 49].map((c, i): [string, number, number] => [`girl-shrink-${i + 1}`, c, 18]),
];

/** The picture's pixels cropped to their bounds; origin = where the screen's (0, 0) lies in the crop. */
function cropped(img: Image, name: string): CellImage {
  let [x0, y0, x1, y1] = [W, H, -1, -1];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.rgba[(y * img.width + x) * 4 + 3]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (x1 < 0) throw new Error(`${INTRO.path}: the ${name} picture is empty`);
  return { ...crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1), originX: -x0, originY: -y0 };
}

/** Every entry on `palette` (Bg_ChangeTilemapRectPalette over the whole 32×24 screen). */
const onPalette = (s: Screen, palette: number): Screen => ({ ...s, entries: s.entries.map((e) => (e & 0x0fff) | (palette << 12)) });

export function importIntroArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(INTRO.path));
  if (narc.length !== INTRO.count) throw new Error(`${INTRO.path}: ${narc.length} members, expected ${INTRO.count}`);
  const member = (i: number) => narc[i]!;
  const render = (screen: Screen, chars: Characters, ram: PaletteRam): Image => ({ width: W, height: H, rgba: renderScreen(screen, chars, ram, W, H) });

  // Main BG3: Graphics_LoadPalette(…, 3, MAIN_BG, 0, 3 palettes).
  const bg3 = new PaletteRam().load(readNclr(member(3)), 0, 32 * 3);
  const bgChars = readNcgr(member(0));
  const backdrops = [4, 8].map((s) => render(readNscr(member(s)), bgChars, bg3));
  // The app runs each row's edge colour on past the screen's sides (app ui/rowan-intro.ts): both edges must agree.
  for (const [i, img] of backdrops.entries())
    for (let y = 0; y < H; y++) {
      const [l, r] = [y * W * 4, (y * W + W - 1) * 4];
      for (let k = 0; k < 4; k++) if (img.rgba[l + k] !== img.rgba[r + k] || img.rgba[l + 3] !== 255) throw new Error(`${INTRO.path}: backdrop ${i}'s row ${y} has two edge colours`);
    }
  sheets.add('intro/backdrops', backdrops.map((img) => ({ ...img, originX: 0, originY: 0 })), { names: ['plain', 'adventure'] });

  const layout = onPalette(readNscr(member(23)), 7);
  const people = PICTURES.map(([name, chr, pal]) => cropped(render(layout, readNcgr(member(chr)), new PaletteRam().load(readNclr(member(pal)), 7 * 32, 32)), name));
  sheets.add('intro/people', people, { names: PICTURES.map(([name]) => name) });

  // The touch screen: its Poké Ball background (opaque where drawn) and the button's three frames.
  const sub = render(readNscr(member(31)), readNcgr(member(24)), new PaletteRam().load(readNclr(member(27)), 0, 32 * 5));
  const ballRam = new PaletteRam().load(readNclr(member(41)), 7 * 32, 32 * 3);
  const button = onPalette(readNscr(member(40)), 9);
  const buttons = [32, 33, 34].map((c, i) => {
    const chars = readNcgr(member(c));
    const cleared: Characters = { ...chars, tiles: [...Array.from({ length: 32 }, () => new Uint8Array(64)), ...chars.tiles] };
    return cropped(render(button, cleared, ballRam), `ball button ${i}`);
  });
  sheets.add('intro/ball', [{ ...sub, originX: 0, originY: 0 }, ...buttons], { names: ['screen', 'button-0', 'button-1', 'button-2'] });
}
