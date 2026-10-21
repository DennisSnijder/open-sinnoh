/**
 * The Town Map's art (decomp applications/town_map, res/graphics/town_map/town_map_graphics.order) and the field
 * move cut-in's (overlay006/hm_cut_in.c, /data/field_cutin.narc).
 *
 * Town Map (/graphic/tmap_gra.narc), the top screen as TownMap_LoadGraphics leaves it in fly mode: every main BG
 * shares the characters of top_screen_map_tiles and the palette RAM of top_screen_map.NCLR; BG3 is the region
 * background, BG2 the region map, alpha blended over BG3 (G2_SetBlendAlpha(BG2, BG3, 28, 4): the coefficients
 * clamp at 16, so a BG2 pixel over a BG3 pixel is BG2 + BG3 / 4, saturated). The fly mode keeps the arrow
 * between "Fly to where?" and the name. Sheets:
 * - `town_map/screen` (256×192);
 * - `town_map/hidden_<i>`, i in decomp enum HiddenLocation order: ShowHiddenLocation's tile rects of
 *   hidden_locations_top_screen copied into BG2 (and BG3, but for the Spring Path), composed as above, cropped to
 *   the tiles they change (`TownMapArt.hidden` gives each patch's place);
 * - the OBJ sets on top_screen_sprites.NCLR (the sprite templates' palette, loaded at OBJ palette 0): `town_map/cursor`
 *   (plttIdx 0), `town_map/player_male` / `_female` (plttIdx 1 / 0; the frame is the gender), and
 *   `town_map/blocks_<p>` for each explicit palette p in 5–9 (TownMap_LoadFlyLocations: 5 + palette + unlocked, the
 *   hovered one blinking with 8 + palette; the animation is the block shape).
 *
 * Field cut-in (field_cutin.narc): `field_cutin/pattern` (BG3: NCGR 0 under NSCR 1 with palette 12 = NCLR 2's first
 * palette; 256×256), `field_cutin/wind` (NCGR 10, NCER 11, NANR 12, NCLR 3), `field_cutin/player_male` (13, 14, 15,
 * NCLR 3), `field_cutin/player_female` (16, 17, 18, NCLR 4) and `field_cutin/bird` (NCGR 7, NCER 8, NCLR 3; no
 * animation).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, crop, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, type Characters, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const TMAP = { path: '/graphic/tmap_gra.narc', count: 30 };
const CUTIN = { path: '/data/field_cutin.narc', count: 19 };
/** town_map_graphics.order. */
const M = {
  bgPalette: 0,
  spritePalette: 2,
  cursor: [7, 8, 9],
  player: [10, 11, 12],
  blocks: [16, 17, 18],
  tiles: 19,
  regionBg: 22,
  hidden: 23,
  regionMap: 24,
} as const;
const W = 256;
const H = 192;
const COLS = W / 8;
const ROWS = H / 8;

/** Decomp ShowHiddenLocation's rects (srcX, srcY, destX, destY, width, height) in enum HiddenLocation order: BG3, then BG2. */
const HIDDEN_RECTS: readonly (readonly [bg3: readonly number[] | null, bg2: readonly number[]])[] = [
  [[5, 0, 3, 1, 2, 3], [5, 3, 3, 2, 2, 2]], // Fullmoon Island
  [[0, 0, 6, 1, 2, 3], [0, 3, 6, 2, 2, 2]], // Newmoon Island
  [null, [4, 5, 22, 13, 3, 3]], // Spring Path
  [[2, 0, 26, 0, 3, 3], [2, 3, 27, 0, 2, 9]], // Seabreak Path
];

/** Where each hidden location's patch goes on the screen (DS px). */
export interface HiddenPatch {
  x: number;
  y: number;
}

/** The visible 32×24 entries of a full-screen map, row by row. */
function entries(screen: Screen): Uint16Array {
  const out = new Uint16Array(COLS * ROWS);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) out[ty * COLS + tx] = screen.entries[ty * 32 + tx]!;
  return out;
}

/** Bg_CopyToTilemapRect (flat source of `src.width / 8` tiles a row). */
function copyRect(dest: Uint16Array, src: Screen, [srcX, srcY, destX, destY, w, h]: readonly number[]): void {
  const srcW = src.width / 8;
  const srcH = src.height / 8;
  for (let i = 0; i < h!; i++) {
    if (destY! + i >= ROWS || srcY! + i >= srcH) break;
    for (let j = 0; j < w!; j++) {
      if (destX! + j >= COLS || srcX! + j >= srcW) break;
      dest[(destY! + i) * COLS + destX! + j] = src.entries[(srcY! + i) * srcW + srcX! + j]!;
    }
  }
}

function render(e: Uint16Array, chars: Characters, ram: PaletteRam): Image {
  return { width: W, height: H, rgba: renderScreen({ width: W, height: H, entries: e }, chars, ram) };
}

/** BG2 alpha blended over BG3 (28 → 16, 4) over the backdrop (palette colour 0). */
function compose(bg2: Image, bg3: Image, backdrop: [number, number, number]): Image {
  const out = blankImage(W, H);
  for (let p = 0; p < W * H * 4; p += 4) {
    const top = bg2.rgba[p + 3] ? bg2.rgba : bg3.rgba[p + 3] ? bg3.rgba : null;
    if (!top) {
      out.rgba.set([...backdrop, 255], p);
      continue;
    }
    if (top === bg2.rgba && bg3.rgba[p + 3]) {
      for (let c = 0; c < 3; c++) out.rgba[p + c] = Math.min(255, bg2.rgba[p + c]! + Math.trunc(bg3.rgba[p + c]! / 4));
      out.rgba[p + 3] = 255;
    } else out.rgba.set(top.subarray(p, p + 4), p);
  }
  return out;
}

export function importTownMapArt(fs: NitroFs, sheets: Sheets): HiddenPatch[] {
  const t = readNarc(fs.file(TMAP.path));
  if (t.length !== TMAP.count) throw new Error(`${TMAP.path}: ${t.length} members, expected ${TMAP.count}`);
  const palette = readNclr(t[M.bgPalette]!);
  const ram = new PaletteRam().load(palette);
  const chars = readNcgr(t[M.tiles]!);
  const regionBg = readNscr(t[M.regionBg]!);
  const regionMap = readNscr(t[M.regionMap]!);
  const hidden = readNscr(t[M.hidden]!);
  for (const s of [regionBg, regionMap]) if (s.width !== W || s.height < H) throw new Error(`${TMAP.path}: a region tilemap is ${s.width}×${s.height}, smaller than the screen`);
  const c0 = palette.colors[0]!;
  const backdrop: [number, number, number] = [c0 & 31, (c0 >> 5) & 31, (c0 >> 10) & 31].map((v) => Math.round((v * 255) / 31)) as [number, number, number];
  const bg3 = entries(regionBg);
  const bg2 = entries(regionMap);
  const screen = compose(render(bg2, chars, ram), render(bg3, chars, ram), backdrop);
  sheets.image('town_map/screen', screen);

  const patches: HiddenPatch[] = HIDDEN_RECTS.map(([r3, r2], i) => {
    const b3 = bg3.slice();
    const b2 = bg2.slice();
    if (r3) copyRect(b3, hidden, r3);
    copyRect(b2, hidden, r2);
    const shown = compose(render(b2, chars, ram), render(b3, chars, ram), backdrop);
    // The patch: the tiles either rect covers.
    const rects = [r2, ...(r3 ? [r3] : [])];
    const x0 = Math.min(...rects.map((r) => r[2]!));
    const y0 = Math.min(...rects.map((r) => r[3]!));
    const x1 = Math.max(...rects.map((r) => r[2]! + r[4]!));
    const y1 = Math.max(...rects.map((r) => r[3]! + r[5]!));
    sheets.image(`town_map/hidden_${i}`, crop(shown, x0 * 8, y0 * 8, (Math.min(x1, COLS) - x0) * 8, (Math.min(y1, ROWS) - y0) * 8));
    return { x: x0 * 8, y: y0 * 8 };
  });

  const obj = (path: string, [ncgr, ncer, nanr]: readonly [number, number, number], extra: { palette?: number; paletteFrom?: number } = {}) =>
    sheets.obj(path, t, { ncgr, ncer, nanr, nclr: M.spritePalette, ...extra });
  obj('town_map/cursor', M.cursor);
  obj('town_map/player_male', M.player, { paletteFrom: 1 });
  obj('town_map/player_female', M.player);
  for (let p = 5; p <= 9; p++) obj(`town_map/blocks_${p}`, M.blocks, { palette: p });

  const c = readNarc(fs.file(CUTIN.path));
  if (c.length !== CUTIN.count) throw new Error(`${CUTIN.path}: ${c.length} members, expected ${CUTIN.count}`);
  // CutIn_LoadBgPalette: 32 bytes of NCLR 2 into BG palette 12; Bg_ChangeTilemapRectPalette puts every tile on it.
  const patternRam = new PaletteRam().load(readNclr(c[2]!), 12 * 32, 32);
  const pattern = readNscr(c[1]!);
  const onTwelve = { ...pattern, entries: pattern.entries.map((e) => (e & 0x0fff) | (12 << 12)) };
  sheets.image('field_cutin/pattern', { width: pattern.width, height: pattern.height, rgba: renderScreen(onTwelve, readNcgr(c[0]!), patternRam) });
  sheets.obj('field_cutin/wind', c, { ncgr: 10, ncer: 11, nanr: 12, nclr: 3 });
  sheets.obj('field_cutin/player_male', c, { ncgr: 13, ncer: 14, nanr: 15, nclr: 3 });
  sheets.obj('field_cutin/player_female', c, { ncgr: 16, ncer: 17, nanr: 18, nclr: 4 });
  sheets.obj('field_cutin/bird', c, { ncgr: 7, ncer: 8, nclr: 3 });
  return patches;
}
