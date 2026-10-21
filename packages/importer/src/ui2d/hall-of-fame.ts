/**
 * The Hall of Fame and end credits art (docs/research/hall-of-fame-credits.md §5).
 *
 * - `/graphic/dendou_demo.narc` (decomp hall_of_fame.c ov86_0223B74C): BG3, tiles 3 with palette 4, under
 *   screen 0 (the individual members) or 1 (the closing group, HallOfFame_State_ShowPartyAndPlayer); the UI
 *   shows it inside the sliding frame window. Sheets `hall_of_fame/background`, `…/group`.
 * - `/graphic/dendou_pc.narc` (pc_hall_of_fame/display.c): screen 0 over tiles 1, palette 2. Sheet `hall_of_fame/pc`.
 * - `/graphic/ending.narc` (end_credits, res/graphics/end_credits/ending.order): the bicycle scenes' top and
 *   bottom backgrounds per time (`credits/<time>_top`, `…_bottom`, their complete scrolling maps), and
 *   per gender the ten memories (`credits/<gender>/memory_<i>`) and four Twinleaf pictures
 *   (`credits/<gender>/twinleaf_<i>`): 8 bpp with extended palettes, at the decomp's BG offsets
 *   (common.c sEndCredits*Memories), colour 0 black (PaletteData_FillBufferRange).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, crop, type Image } from './compose.ts';
import { screenImage } from './menus.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, readNcgrData, renderScreen, rgb555 } from './nitro2d.ts';
import { renderCell } from './compose.ts';
import { readNcer } from './ncer.ts';
import { readNanr } from './nanr.ts';
import { animations } from './sheets.ts';
import type { Sheets } from './sheets.ts';

const W = 256;
const H = 192;
const DENDOU = { path: '/graphic/dendou_demo.narc', count: 5 };
const DENDOU_PC = { path: '/graphic/dendou_pc.narc' };
const ENDING = { path: '/graphic/ending.narc', count: 103 };
/** ending.order: the backgrounds' screens (morning, day, night; bottom then top), tiles and palettes. */
const BIKE = {
  morning: { bottom: [3, 9, 18], top: [6, 12, 21] },
  day: { bottom: [4, 10, 19], top: [7, 13, 22] },
  night: { bottom: [5, 11, 20], top: [8, 14, 23] },
} as const;
const MEMORY_SCREEN = 37;
const TWINLEAF_SCREEN = 86;
/** ending.order: the memories' and Twinleaf pictures' first tiles and palettes, by gender. */
const PICTURES = {
  male: { memory: { tiles: 38, palettes: 48 }, twinleaf: { tiles: 87, palettes: 91 } },
  female: { memory: { tiles: 58, palettes: 68 }, twinleaf: { tiles: 95, palettes: 99 } },
} as const;
/** Decomp sEndCreditsMaleMemories / sEndCreditsFemaleMemories BG offsets (the same for both genders). */
const MEMORY_OFFSETS = [[0, 0], [-32, -48], [-16, -30], [-42, -2], [-8, -20], [-50, -16], [-40, -34], [-16, -1], [-44, -15], [-30, -30]] as const;

/** A BG screen at BG offset (ox, oy), wrapping, as the 256×192 a DS screen shows; transparent pixels black. */
function shifted(img: Image, ox: number, oy: number): Image {
  const out = blankImage(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = (((x + ox) % img.width) + img.width) % img.width;
      const sy = (((y + oy) % img.height) + img.height) % img.height;
      const i = (sy * img.width + sx) * 4;
      const o = (y * W + x) * 4;
      if (img.rgba[i + 3]) out.rgba.set(img.rgba.subarray(i, i + 4), o);
      else out.rgba.set([0, 0, 0, 255], o);
    }
  return out;
}

export function importHallOfFameArt(fs: NitroFs, sheets: Sheets): void {
  const demo = readNarc(fs.file(DENDOU.path));
  if (demo.length !== DENDOU.count) throw new Error(`${DENDOU.path}: ${demo.length} members, expected ${DENDOU.count}`);
  sheets.image('hall_of_fame/background', crop(screenImage(demo, 0, 3, 4, true, 3), 0, 0, W, H));
  sheets.image('hall_of_fame/group', crop(screenImage(demo, 1, 3, 4, true, 3), 0, 0, W, H));
  const pc = readNarc(fs.file(DENDOU_PC.path));
  sheets.image('hall_of_fame/pc', crop(screenImage(pc, 0, 1, 2, true, 2), 0, 0, W, H));

  const ending = readNarc(fs.file(ENDING.path));
  if (ending.length !== ENDING.count) throw new Error(`${ENDING.path}: ${ending.length} members, expected ${ENDING.count}`);
  for (const [time, parts] of Object.entries(BIKE))
    for (const [half, [scr, chr, pal]] of Object.entries(parts)) sheets.image(`credits/${time}_${half}`, screenImage(ending, scr, chr, pal, true));
  sheets.obj('credits/objects', ending, { ncgr: 0, ncer: 1, nanr: 2, nclr: 15 });
  sheets.obj('credits/male/bike', ending, { ncgr: 28, ncer: 29, nanr: 30, nclr: 31 });
  sheets.obj('credits/female/bike', ending, { ncgr: 33, ncer: 34, nanr: 35, nclr: 36 });
  for (const [gender, eye, chr, cell, anim, palette, tiles] of [
    ['male', 27, 28, 29, 30, 31, [0x1d, 0x1e, 0x25, 0x26]],
    ['female', 32, 33, 34, 35, 36, [0x45, 0x46, 0x4d, 0x4e]],
  ] as const) {
    const bank = readNcer(ending[cell]!);
    const data = readNcgrData(ending[chr]!).data.slice();
    const eyes = readNcgrData(ending[eye]!).data;
    const colors = readNclr(ending[palette]!).colors;
    // Each eye state replaces four 4bpp tiles; no authored pixels are stored in source.
    for (let state = 0; state < 2; state++) {
      tiles.forEach((tile, i) => data.set(eyes.subarray(state * 128 + i * 32, state * 128 + (i + 1) * 32), tile * 32));
      sheets.add(`credits/${gender}/bike_eyes_${state}`, bank.cells.map(c => renderCell(c, data, colors, { mapping: bank.mapping })), { animations: animations(readNanr(ending[anim]!)) });
    }
  }
  // The night sky changes only palette slot 1; both physical displays share this palette animation.
  const nightPalette = readNclr(ending[17]!);
  for (let i = 0; i < 8; i++) {
    const base = readNclr(ending[20]!);
    base.colors.set(nightPalette.colors.subarray(i * 16, i * 16 + 16), 16);
    const screen = readNscr(ending[5]!);
    const ram = new PaletteRam().load(base);
    const rgba = renderScreen(screen, readNcgr(ending[11]!), ram);
    for (let p = 3; p < rgba.length; p += 4) if (!rgba[p]) rgba.set([...rgb555(ram.colors[0]!), 255], p - 3);
    sheets.image(`credits/night_bottom_${i}`, { width: screen.width, height: screen.height, rgba });
  }
  const picture = (scr: number, chr: number, pal: number, ox: number, oy: number) => {
    const ram = new PaletteRam(true).load(readNclr(ending[pal]!));
    const screen = readNscr(ending[scr]!);
    return shifted({ width: screen.width, height: screen.height, rgba: renderScreen(screen, readNcgr(ending[chr]!), ram) }, ox, oy);
  };
  for (const [gender, p] of Object.entries(PICTURES)) {
    MEMORY_OFFSETS.forEach(([ox, oy], i) => sheets.image(`credits/${gender}/memory_${i}`, picture(MEMORY_SCREEN, p.memory.tiles + i, p.memory.palettes + i, ox, oy)));
    for (let i = 0; i < 4; i++) sheets.image(`credits/${gender}/twinleaf_${i}`, picture(TWINLEAF_SCREEN, p.twinleaf.tiles + i, p.twinleaf.palettes + i, 0, 0));
  }
}
