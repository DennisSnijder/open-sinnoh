/**
 * Window frames (pl_winframe, decomp render_window.c; members per res/graphics/windows/pl_winframe.order):
 * the 20 message box frames (the options' FRAME 1–20, also the battle textbox) and the two standard
 * frames (system, field), and the field frame in the Underground's palette (`windows/standard_underground`). Each is a nine-slice sheet: the frame's characters in their grid (message
 * boxes 6×3: two columns left, three right; standard 3×3), the centre character being the interior.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, type Image } from './compose.ts';
import { readNclr, readNcgr, rgb555, type Characters } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const WINFRAME = { path: '/graphic/pl_winframe.narc', count: 50 };
const STANDARD = { system: 0, field: 1 };
const STANDARD_PALETTE = 24;
/** standard_underground.NCLR: the Underground's palette for the field frame (LoadStandardWindowGraphics, STANDARD_WINDOW_UNDERGROUND). */
const UNDERGROUND_PALETTE = 45;
const MESSAGE_BOX = (frame: number) => ({ ncgr: 2 + frame, nclr: 25 + frame });
export const MESSAGE_BOX_FRAMES = 20;

/** Draws `cols`×`rows` characters in row-major order with palette 0 of `colors`. */
function grid(chars: Characters, colors: Uint16Array, cols: number, rows: number): Image {
  if (chars.tiles.length < cols * rows) throw new Error(`window frame: ${chars.tiles.length} characters for a ${cols}×${rows} grid`);
  const img = blankImage(cols * 8, rows * 8);
  for (let t = 0; t < cols * rows; t++)
    chars.tiles[t]!.forEach((index, p) => {
      if (!index) return;
      const x = (t % cols) * 8 + (p & 7);
      const y = Math.floor(t / cols) * 8 + (p >> 3);
      img.rgba.set([...rgb555(colors[index]!), 255], (y * img.width + x) * 4);
    });
  return img;
}

export function importWindowFrames(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(WINFRAME.path));
  if (narc.length !== WINFRAME.count) throw new Error(`${WINFRAME.path}: ${narc.length} members, expected ${WINFRAME.count}`);
  const standardColors = readNclr(narc[STANDARD_PALETTE]!).colors;
  for (const [name, member] of Object.entries(STANDARD)) sheets.image(`windows/standard_${name}`, grid(readNcgr(narc[member]!), standardColors, 3, 3), { nineSlice: [8, 8, 8, 8] });
  sheets.image('windows/standard_underground', grid(readNcgr(narc[STANDARD.field]!), readNclr(narc[UNDERGROUND_PALETTE]!).colors, 3, 3), { nineSlice: [8, 8, 8, 8] });
  for (let f = 0; f < MESSAGE_BOX_FRAMES; f++) {
    const m = MESSAGE_BOX(f);
    sheets.image(`windows/message_box_${String(f).padStart(2, '0')}`, grid(readNcgr(narc[m.ncgr]!), readNclr(narc[m.nclr]!).colors, 6, 3), { nineSlice: [16, 8, 24, 8] });
  }
}
