/**
 * The Dance Competition's 2D art (decomp overlay017 ov17_0223DAD0.c, ov17_022492DC.c, ov17_0224A0FC.c), from
 * /contest/graphic/contest_bg.narc and contest_obj.narc:
 *
 * - The stage (ov17_0223E67C: BG3 characters 13, the variant's NSCR 14 or 15, NCLR 32 and NCLR 36 into palette 13):
 *   `contest_dance/stage0`, `stage1`, the top-left 256×192 of the 512-px map. Its timeline (tile row 19,
 *   ov17_0224A214: palette 2; variant 0 the tiles 0x0c, 0x2c, 0x4c by column, variant 1 the row table
 *   Unk_ov17_02254898 from x 8; a tile + n has n px filled) as two strips per variant, `timeline{v}_empty` and
 *   `timeline{v}_full`.
 * - The touch screen in the dance layout (ov17_022493DC, Unk_ov17_02254578[1]: characters 18, NSCR 17 on BG0 over
 *   NSCR 28 on BG2, NCLR 33) `contest_dance/buttons`; the press animation (ov17_02249DA0) copies a block of characters
 *   16 over each button's characters (Unk_ov17_02254630 per step and button: destination column and row, source
 *   column and row, width, height; 18 source and 32 destination tiles a row): its first two steps as
 *   `buttons{dir}_{0|1}` (the third puts the button back at rest).
 * - The OBJ sets on contest_obj NCLR 6 (8 palettes, ov17_0223E4B0) with each SpriteTemplate's palette: the step notes
 *   (ov17_0224A46C: characters 58–61 per step code, cells 62, animations 63) `note{code}`, the grades (55/56/57)
 *   `grades`, the player's arrow (64/65/66) `arrow`, the shadows (90/89/88) `shadow`, the hearts that fly from a
 *   dancer (96/95/94) `hearts`, the progress cursor (99/98/97) `cursor`, the beat ball (76/77/78) `ball`.
 */
import { readNarc, Reader, type NitroFs } from '@opensinnoh/nds';
import { crop } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, type Characters, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const BG = { path: '/contest/graphic/contest_bg.narc', count: 41 };
const OBJ = { path: '/contest/graphic/contest_obj.narc', count: 103 };
/** ov17_0224A214: variant 1's timeline tiles (Unk_ov17_02254898) and the row they sit on. */
export const DANCE_TIMELINE_TILES = 30;
const TIMELINE_ROW = 19;
/** Unk_ov17_02254630: the press animation's steps (each a row of the four buttons' copies). */
export const DANCE_PRESS_STEPS = 3;
/** ov17_02249B54: tiles a row in contest_bg 16's press frames, and in the BG's characters. */
const PRESS_SOURCE_ROW = 18;
const BG_ROW = 32;
/** ov17_0223E4B0: contest_obj NCLR 6 (the main OBJ palettes); the sprite sets' palettes (their SpriteTemplate plttIdx). */
const OBJ_NCLR = 6;
const NOTES: Record<number, { ncgr: number; palette: number }> = { 1: { ncgr: 60, palette: 7 }, 2: { ncgr: 58, palette: 2 }, 3: { ncgr: 59, palette: 2 }, 4: { ncgr: 61, palette: 6 } };

function narcOf(fs: NitroFs, path: string, count: number): Uint8Array[] {
  const narc = readNarc(fs.file(path));
  if (narc.length !== count) throw new Error(`${path}: ${narc.length} members, expected ${count}`);
  return narc;
}

function render(screen: Screen, chars: Characters, ram: PaletteRam) {
  return crop({ width: screen.width, height: screen.height, rgba: renderScreen(screen, chars, ram) }, 0, 0, 256, 192);
}

/** `timelineTiles`: Unk_ov17_02254898 (u16 screen entries); `press`: Unk_ov17_02254630 (six u16 a button and step). */
export function importContestDanceArt(fs: NitroFs, sheets: Sheets, timelineTiles: Uint8Array, press: Uint8Array): void {
  const bg = narcOf(fs, BG.path, BG.count);
  const stageChars = readNcgr(bg[13]!);
  const stageRam = new PaletteRam().load(readNclr(bg[32]!)).load(readNclr(bg[36]!), 13 * 32, 32);
  const v1 = new Reader(timelineTiles);
  const rows = [Array.from({ length: 32 }, (_, i) => 0x2000 | (i % 8 === 0 ? 0x0c : i & 1 ? 0x2c : 0x4c)), Array.from({ length: DANCE_TIMELINE_TILES }, (_, i) => v1.u16(i * 2))];
  for (const variant of [0, 1]) {
    const screen = readNscr(bg[14 + variant]!);
    if (screen.width < 256 || screen.height < (TIMELINE_ROW + 1) * 8) throw new Error(`contest_bg ${14 + variant}: ${screen.width}×${screen.height} has no timeline row`);
    sheets.image(`contest_dance/stage${variant}`, render(screen, stageChars, stageRam));
    for (const [name, fill] of [['empty', 0], ['full', 8]] as const) {
      const entries = Uint16Array.from(rows[variant]!, (e) => e + fill);
      const row: Screen = { width: entries.length * 8, height: 8, entries };
      sheets.image(`contest_dance/timeline${variant}_${name}`, { width: row.width, height: 8, rgba: renderScreen(row, stageChars, stageRam) });
    }
  }

  const buttonRam = new PaletteRam().load(readNclr(bg[33]!));
  const upper = readNscr(bg[17]!);
  const lower = readNscr(bg[28]!);
  const pressChars = readNcgr(bg[16]!);
  const draw = (chars: Characters) => {
    const out = render(lower, chars, buttonRam);
    const top = render(upper, chars, buttonRam);
    for (let p = 0; p < top.rgba.length; p += 4) if (top.rgba[p + 3]) out.rgba.set(top.rgba.subarray(p, p + 4), p);
    return out;
  };
  const buttonChars = readNcgr(bg[18]!);
  sheets.image('contest_dance/buttons', draw(buttonChars));
  const p = new Reader(press);
  for (let step = 0; step < DANCE_PRESS_STEPS - 1; step++)
    for (let dir = 0; dir < 4; dir++) {
      const o = (step * 4 + dir) * 12;
      const [dx, dy, sx, sy, w, h] = [0, 2, 4, 6, 8, 10].map((k) => p.u16(o + k)) as [number, number, number, number, number, number];
      const tiles = [...buttonChars.tiles];
      for (let row = 0; row < h; row++)
        for (let x = 0; x < w; x++) {
          const src = pressChars.tiles[(sy + row) * PRESS_SOURCE_ROW + sx + x];
          if (!src) throw new Error(`contest_bg 16: no character for button ${dir} step ${step}`);
          tiles[(dy + row) * BG_ROW + dx + x] = src;
        }
      sheets.image(`contest_dance/buttons${dir}_${step}`, draw({ bitDepth: buttonChars.bitDepth, tiles }));
    }

  const obj = narcOf(fs, OBJ.path, OBJ.count);
  for (const [code, n] of Object.entries(NOTES)) sheets.obj(`contest_dance/note${code}`, obj, { ncgr: n.ncgr, ncer: 62, nanr: 63, nclr: OBJ_NCLR, palette: n.palette });
  sheets.obj('contest_dance/grades', obj, { ncgr: 55, ncer: 56, nanr: 57, nclr: OBJ_NCLR, palette: 3 });
  sheets.obj('contest_dance/arrow', obj, { ncgr: 64, ncer: 65, nanr: 66, nclr: OBJ_NCLR, palette: 1 });
  sheets.obj('contest_dance/shadow', obj, { ncgr: 90, ncer: 89, nanr: 88, nclr: OBJ_NCLR, palette: 1 });
  sheets.obj('contest_dance/hearts', obj, { ncgr: 96, ncer: 95, nanr: 94, nclr: OBJ_NCLR, palette: 3 });
  sheets.obj('contest_dance/cursor', obj, { ncgr: 99, ncer: 98, nanr: 97, nclr: OBJ_NCLR, palette: 2 });
  sheets.obj('contest_dance/ball', obj, { ncgr: 76, ncer: 77, nanr: 78, nclr: OBJ_NCLR, palette: 5 });
}
