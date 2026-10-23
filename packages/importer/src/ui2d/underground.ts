/**
 * The Underground's 2D art (decomp src/underground/mining.c, top_screen.c; res/graphics/mining, underground_top_screen):
 * - The mining board (/data/ug_fossil.narc: interface_tiles NCGR 0, NCLR 1 (three palettes at BG palette 0), the
 *   interface NSCR 2 on BG0) `underground/mining_interface`; the wall's crack fully drawn (Mining_DrawWallCrack: rows 0–3,
 *   columns 25 down to 0, tile ROW_BASE − i % 3 with the map's palette) `underground/mining_crack`; the side buttons
 *   (Mining_DrawButton on BG1, palette 0: 6×8 tiles, base + 54·row + col; hammer 18/24/30, pickaxe 36/42/48 for
 *   unpressed, the transition and pressed) `underground/mining_buttons`, cells named `hammer-0..2`, `pickaxe-0..2`.
 * - The dirt (/data/ug_parts.narc dirt_tiles NCGR 9 on BG2 with the interface's palette 2; Mining_DrawDirt's 2×2 tiles
 *   per layer) `underground/mining_dirt`, a 16×16 cell per layer 0–6.
 * - The buried objects (ug_parts: each table entry's NCGR, tiles row-major over its rectangle, only its shape's cells
 *   drawn, Mining_DrawBuriedObject) in the three palettes the shine steps through (sItemShineAnimSequence: the NCLR's
 *   palettes 0–2, each brighter) `underground/mining_objects`, cells `<sprite>-<palette>-<step>`.
 * - The tools, impacts and sparkles (/data/ug_anim.narc 4–7) `underground/mining_anims`; the crack's end (0–3)
 *   `underground/mining_crack_end`.
 * - The top screen (/data/underg_radar.narc: background NCLR 0 (two palettes), NCGR 1, NSCR 2) `underground/radar_map`;
 *   its markers (NCLR 3, NCGR 4, NCER 5, NANR 6) `underground/radar_markers`.
 * - The traps' effects (/data/ug_trap.narc, res/graphics/trap_effects): the OBJ sets `underground/trap_<name>` (petals,
 *   bubbles, the touch radar, fire, embers, leaves, the boulder and its six damaged stages, which keep the boulder's
 *   cells and animations: SpriteTransfer_ReplaceCharData), the smoke's BG characters with their palette
 *   `underground/trap_smoke` (cells named by character number) and the smoke patterns (NSCR 11–14 and the big one, 8),
 *   returned as data: the first 32×24 entries (Graphics_LoadTilemapToBgLayer's 32 × 24 × 2 bytes).
 */
import type { MiningObject } from '@opensinnoh/contracts';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, crop, type CellImage, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, rgb555, type Characters, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const FOSSIL = { path: '/data/ug_fossil.narc', count: 3 };
const PARTS = { path: '/data/ug_parts.narc', dirt: 9 };
const ANIM = { path: '/data/ug_anim.narc', count: 8 };
const RADAR = { path: '/data/underg_radar.narc', count: 7 };
/** res/graphics/trap_effects/trap_effects.order: the members by name. */
const TRAP = {
  path: '/data/ug_trap.narc',
  count: 53,
  objs: {
    petal: { nanr: 0, ncer: 1, ncgr: 2, nclr: 3 },
    bubble: { nanr: 4, ncer: 5, ncgr: 6, nclr: 7 },
    radar: { nanr: 15, ncer: 16, ncgr: 17, nclr: 18 },
    fire: { nanr: 20, ncer: 21, ncgr: 22, nclr: 19 },
    ember: { nanr: 23, ncer: 24, ncgr: 25, nclr: 19 },
    leaf: { nanr: 26, ncer: 27, ncgr: 28, nclr: 29 },
    boulder: { nanr: 30, ncer: 31, ncgr: 32, nclr: 51 },
  },
  /** boulder_damaged_<k>.NCGR: member 32 + 3k. */
  damaged: (k: number) => 32 + 3 * k,
  bigSmoke: 8,
  smokeTiles: { ncgr: 9, nclr: 10, count: 9 },
  smoke: [11, 12, 13, 14],
};
/** BG_LAYER_MAIN_2's 32 × 24 tiles. */
const SMOKE_TILES = 32 * 24;
/** CRACK_START_TILEMAP_INDEX_ROW_1..4 (column 25 of rows 0–3) and MINING_BASE_TILE_CRACK_ROW_1..4. */
const CRACK = { column: 25, bases: [11, 65, 119, 173] };
/** Mining_DrawButton's rectangles and tiles. */
const BUTTON = { w: 6, h: 8, gap: 54, hammer: [18, 24, 30], pickaxe: [36, 42, 48], at: { hammer: [26, 6], pickaxe: [26, 15] } };
/** Mining_DrawDirt's tiles per layer (0 bare … 6 the deepest). */
const DIRT = [[14, 15, 30, 31], [10, 11, 26, 27], [8, 9, 24, 25], [6, 7, 22, 23], [4, 5, 20, 21], [2, 3, 18, 19], [0, 1, 16, 17]];
/** The shine's palettes (sItemShineAnimSequence): steps 0, 1, 2. */
const SHINE_PALETTES = [0, 1, 2];

function narcOf(fs: NitroFs, path: string, count?: number): Uint8Array[] {
  const narc = readNarc(fs.file(path));
  if (count !== undefined && narc.length !== count) throw new Error(`${path}: ${narc.length} members, expected ${count}`);
  return narc;
}

/** Characters drawn at tile positions (entries: [tile, column, row, palette]) on a `w`×`h`-tile image. */
function tiles(chars: Characters, colors: Uint16Array, w: number, h: number, entries: [number, number, number, number][]): Image {
  const img = blankImage(w * 8, h * 8);
  for (const [t, col, row, pal] of entries) {
    const tile = chars.tiles[t];
    if (!tile) throw new Error(`underground art: no character ${t} of ${chars.tiles.length}`);
    tile.forEach((index, p) => {
      if (!index) return;
      const [r, g, b] = rgb555(colors[pal * 16 + index]!);
      img.rgba.set([r, g, b, 255], ((row * 8 + (p >> 3)) * img.width + col * 8 + (p & 7)) * 4);
    });
  }
  return img;
}

const cell = (img: Image): CellImage => ({ ...img, originX: 0, originY: 0 });

export function importUndergroundArt(fs: NitroFs, sheets: Sheets, miningObjects: readonly MiningObject[] | null): void {
  const fossil = narcOf(fs, FOSSIL.path, FOSSIL.count);
  const chars = readNcgr(fossil[0]!);
  const ram = new PaletteRam().load(readNclr(fossil[1]!), 0, 3 * 32);
  const screen = readNscr(fossil[2]!);
  sheets.image('underground/mining_interface', crop({ width: screen.width, height: screen.height, rgba: renderScreen(screen, chars, ram) }, 0, 0, 256, 192));
  {
    // The full crack: the interface map's rows 0–3, columns 25 down to 0 retiled, its palette and flips kept.
    const cracked: Screen = { ...screen, entries: screen.entries.slice() };
    const at = (tx: number, ty: number) => (screen.width < 256 ? ty * (screen.width / 8) + tx : ((tx >> 5) + (ty >> 5) * Math.max(1, screen.width / 256)) * 1024 + (ty & 31) * 32 + (tx & 31));
    for (let row = 0; row < 4; row++)
      for (let i = 0; i <= CRACK.column; i++) {
        const k = at(CRACK.column - i, row);
        cracked.entries[k] = (cracked.entries[k]! & 0xfc00) | (CRACK.bases[row]! - (i % 3));
      }
    sheets.image('underground/mining_crack', crop({ width: screen.width, height: screen.height, rgba: renderScreen(cracked, chars, ram) }, 0, 0, 26 * 8, 32));
  }
  {
    const buttons: CellImage[] = [];
    const names: string[] = [];
    for (const tool of ['hammer', 'pickaxe'] as const)
      BUTTON[tool].forEach((base, state) => {
        const entries: [number, number, number, number][] = [];
        for (let row = 0; row < BUTTON.h; row++) for (let col = 0; col < BUTTON.w; col++) entries.push([base + BUTTON.gap * row + col, col, row, 0]);
        buttons.push(cell(tiles(chars, ram.colors, BUTTON.w, BUTTON.h, entries)));
        names.push(`${tool}-${state}`);
      });
    sheets.add('underground/mining_buttons', buttons, { names });
  }

  const parts = readNarc(fs.file(PARTS.path));
  {
    const dirt = readNcgr(parts[PARTS.dirt]!);
    sheets.add('underground/mining_dirt', DIRT.map((t) => cell(tiles(dirt, ram.colors, 2, 2, [[t[0]!, 0, 0, 2], [t[1]!, 1, 0, 2], [t[2]!, 0, 1, 2], [t[3]!, 1, 1, 2]]))), { names: DIRT.map((_, i) => String(i)) });
  }
  if (miningObjects) {
    // One picture per art (several table entries share one: the plates, the rotations) and shine step.
    const objects: CellImage[] = [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const o of miningObjects) {
      const key = `${o.sprite}-${o.palette}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = readNcgr(parts[o.sprite]!);
      const w = o.width * 2;
      const h = o.height * 2;
      if (c.tiles.length < w * h) throw new Error(`underground art: object art ${o.sprite} has ${c.tiles.length} characters for ${w}×${h}`);
      const entries: [number, number, number, number][] = [];
      for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) if (!o.shape || o.shape[(ty >> 1) * o.width + (tx >> 1)] !== 'o') entries.push([ty * w + tx, tx, ty, 0]);
      for (const [step, pal] of SHINE_PALETTES.entries()) {
        const colors = readNclr(parts[o.palette]!).colors;
        objects.push(cell(tiles(c, colors.subarray(pal * 16), w, h, entries)));
        names.push(`${o.sprite}-${o.palette}-${step}`);
      }
    }
    sheets.add('underground/mining_objects', objects, { names });
  }

  const anim = narcOf(fs, ANIM.path, ANIM.count);
  sheets.obj('underground/mining_anims', anim, { ncgr: 6, ncer: 5, nanr: 4, nclr: 7 });
  sheets.obj('underground/mining_crack_end', anim, { ncgr: 3, ncer: 2, nanr: 1, nclr: 0 });

  const radar = narcOf(fs, RADAR.path, RADAR.count);
  {
    const ramRadar = new PaletteRam().load(readNclr(radar[0]!), 0, 2 * 32);
    const s = readNscr(radar[2]!);
    sheets.image('underground/radar_map', crop({ width: s.width, height: s.height, rgba: renderScreen(s, readNcgr(radar[1]!), ramRadar) }, 0, 0, 256, 192));
  }
  sheets.obj('underground/radar_markers', radar, { ncgr: 4, ncer: 5, nanr: 6, nclr: 3 });
}

/** The objects sheet's cell for a table entry and shine step. */
export const miningObjectCell = (o: Pick<MiningObject, 'sprite' | 'palette'>, step: number): string => `${o.sprite}-${o.palette}-${step}`;

/** The traps' 2D art (see the header) and the smoke patterns. */
export function importTrapArt(fs: NitroFs, sheets: Sheets): { smoke: number[][]; bigSmoke: number[] } {
  const narc = narcOf(fs, TRAP.path, TRAP.count);
  for (const [name, m] of Object.entries(TRAP.objs)) sheets.obj(`underground/trap_${name}`, narc, m);
  for (let k = 1; k <= 6; k++) sheets.obj(`underground/trap_boulder_${k}`, narc, { ...TRAP.objs.boulder, ncgr: TRAP.damaged(k) });
  const chars = readNcgr(narc[TRAP.smokeTiles.ncgr]!);
  const colors = readNclr(narc[TRAP.smokeTiles.nclr]!).colors;
  const cells = Array.from({ length: TRAP.smokeTiles.count }, (_, t) => cell(tiles(chars, colors, 1, 1, [[t, 0, 0, 0]])));
  sheets.add('underground/trap_smoke', cells, { names: cells.map((_, t) => String(t)) });
  const pattern = (member: number): number[] => {
    const s = readNscr(narc[member]!);
    if (s.entries.length < SMOKE_TILES) throw new Error(`ug_trap ${member}: ${s.entries.length} entries, fewer than 32 × 24`);
    const out = [...s.entries.subarray(0, SMOKE_TILES)];
    const bad = out.find((e) => (e & 0x3ff) >= TRAP.smokeTiles.count || e >> 12 !== 0);
    if (bad !== undefined) throw new Error(`ug_trap ${member}: entry 0x${bad.toString(16)} outside the smoke's characters or palette 0`);
    return out;
  };
  return { smoke: TRAP.smoke.map(pattern), bigSmoke: pattern(TRAP.bigSmoke) };
}
