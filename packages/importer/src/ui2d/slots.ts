/**
 * The slot machine's 2D art (decomp overlay101 ov101_021D0D80.c ov101_021D121C, ov101_021D1A28.c ov101_021D4D38,
 * ov101_021D59AC.c; /data/slot.narc, docs/research/game-corner.md §5):
 * - `slots/machine`: the machine (BG1: characters 0, screen 1, palette member 3) with the line lamps unlit (the
 *   `linePalettes` from member 3 rows 2, 3, 3, 4, 4: ov101_021D4FF8); `slots/lamps`: per line (bit order) only the
 *   pixels of its lamp palette, lit (member 74 for the middle line, 75 for top and bottom, 76 for the diagonals), so a
 *   lamp's level is the lit cell drawn at level / 16 over the unlit machine (a palette blend per colour).
 * - `slots/stops`: each stop button's 3×2-tile rect with palette 5 (armed) and 6 (pressed), cells `<reel>-armed`,
 *   `<reel>-pressed`.
 * - `slots/shade`: the reel shading (BG2: characters 8, screen 9), blended over the reel symbols at 8/16 (and 9/16).
 * - `slots/field`: the bottom screen's moonlit field (BG3 sub: characters 2, screen 4) with its palette 1 from member 3
 *   row 1 (`normal`), member 5 (`bonus`), member 6 (`blue`, the guaranteed-continue moon) and member 7 (`red`).
 * - `slots/backdrop`: the two screens' backdrop colour (palette 0 colour 0), an 8×8 cell each (`main`, `sub`).
 * - The OBJ sets: `slots/symbols`, `slots/digits`, `slots/seven_red`, `slots/seven_galactic`, `slots/ball_<0–4>`,
 *   `slots/sparkle`, `slots/clefairy_<0–2>`, `slots/pikachu`, `slots/bonus_label`, `slots/get_label`,
 *   `slots/counter_digits`, `slots/round_digits`.
 */
import type { SlotTables } from '@opensinnoh/contracts';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, crop, type CellImage, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, rgb555, type Screen } from './nitro2d.ts';
import type { ObjMembers, Sheets } from './sheets.ts';

const NARC = { path: '/data/slot.narc', count: 77 };
const MACHINE = { chars: 0, screen: 1, palette: 3, palettes: 13 };
const SHADE = { chars: 8, screen: 9 };
const FIELD = { chars: 2, screen: 4, normal: 3, bonus: 5, blue: 6, red: 7 };
/** ov101_021D4D38: each line's unlit row of member 3 and its lit member, in line bit order. */
const LAMPS = { unlit: [2, 3, 3, 4, 4], lit: [74, 75, 75, 76, 76] };
/** ov101_021D58F4 / ov101_021D5938: a stop button's rect (3×2 tiles) and its two palettes. */
const STOP = { w: 3, h: 2, armed: 5, pressed: 6 };
const OBJS: Record<string, ObjMembers> = {
  symbols: { ncgr: 11, nclr: 10, ncer: 12, nanr: 13 },
  digits: { ncgr: 21, nclr: 20, ncer: 22, nanr: 23 },
  seven_red: { ncgr: 14, nclr: 10, ncer: 15, nanr: 16 },
  seven_galactic: { ncgr: 17, nclr: 10, ncer: 18, nanr: 19 },
  sparkle: { ncgr: 44, nclr: 47, ncer: 45, nanr: 46 },
  pikachu: { ncgr: 56, nclr: 59, ncer: 57, nanr: 58 },
  bonus_label: { ncgr: 68, nclr: 67, ncer: 69, nanr: 70 },
  get_label: { ncgr: 71, nclr: 67, ncer: 72, nanr: 73 },
  counter_digits: { ncgr: 64, nclr: 67, ncer: 65, nanr: 66 },
  round_digits: { ncgr: 60, nclr: 63, ncer: 61, nanr: 62 },
};

/** Index of a screen entry at tile (tx, ty), for maps of one or more 256-px hardware blocks. */
const entryAt = (s: Screen, tx: number, ty: number) => (s.width < 256 ? ty * (s.width / 8) + tx : ((tx >> 5) + (ty >> 5) * Math.max(1, s.width / 256)) * 1024 + (ty & 31) * 32 + (tx & 31));
const screenImage = (s: Screen, rgba: Uint8Array): Image => crop({ width: s.width, height: s.height, rgba }, 0, 0, 256, 192);
const cell = (img: Image): CellImage => ({ ...img, originX: 0, originY: 0 });

export function importSlotArt(fs: NitroFs, sheets: Sheets, tables: Pick<SlotTables, 'linePalettes' | 'stopButtons'>, members: { balls: ObjMembers[]; clefairy: ObjMembers[] }): void {
  const narc = readNarc(fs.file(NARC.path));
  if (narc.length !== NARC.count) throw new Error(`${NARC.path}: ${narc.length} members, expected ${NARC.count}`);
  const palette = (m: number) => readNclr(narc[m]!).colors;

  const chars = readNcgr(narc[MACHINE.chars]!);
  const screen = readNscr(narc[MACHINE.screen]!);
  const ram = new PaletteRam().load(readNclr(narc[MACHINE.palette]!), 0, MACHINE.palettes * 32);
  // The lamps' palettes (`linePalettes`) must be on the machine.
  const lampPalettes = tables.linePalettes;
  const used = new Set(Array.from(screen.entries, (e) => e >> 12));
  if (lampPalettes.some((p) => !used.has(p))) throw new Error('slot art: a lamp palette is not on the machine');
  lampPalettes.forEach((p, i) => ram.colors.set(palette(MACHINE.palette).subarray(LAMPS.unlit[i]! * 16, LAMPS.unlit[i]! * 16 + 16), p * 16));
  sheets.image('slots/machine', screenImage(screen, renderScreen(screen, chars, ram)));
  sheets.add(
    'slots/lamps',
    lampPalettes.map((p, i) => {
      const only: Screen = { ...screen, entries: screen.entries.map((e) => (e >> 12 === p ? e : 0)) };
      const lit = new PaletteRam();
      lit.colors.set(palette(LAMPS.lit[i]!).subarray(0, 16), p * 16);
      return cell(screenImage(only, renderScreen(only, chars, lit)));
    }),
    { names: ['middle', 'top', 'bottom', 'down', 'up'] },
  );
  {
    const cells: CellImage[] = [];
    const names: string[] = [];
    tables.stopButtons.forEach(({ x: tx, y: ty }, reel) => {
      for (const [state, pal] of [['armed', STOP.armed], ['pressed', STOP.pressed]] as const) {
        const recoloured: Screen = { ...screen, entries: screen.entries.slice() };
        for (let y = 0; y < STOP.h; y++) for (let x = 0; x < STOP.w; x++) {
          const k = entryAt(screen, tx + x, ty + y);
          recoloured.entries[k] = (recoloured.entries[k]! & 0x0fff) | (pal << 12);
        }
        // The cell's origin is the machine's top left, so it draws at its place on the machine.
        cells.push({ ...crop({ width: screen.width, height: screen.height, rgba: renderScreen(recoloured, chars, ram) }, tx * 8, ty * 8, STOP.w * 8, STOP.h * 8), originX: -tx * 8, originY: -ty * 8 });
        names.push(`${reel}-${state}`);
      }
    });
    sheets.add('slots/stops', cells, { names });
  }
  {
    const s = readNscr(narc[SHADE.screen]!);
    sheets.image('slots/shade', screenImage(s, renderScreen(s, readNcgr(narc[SHADE.chars]!), new PaletteRam().load(readNclr(narc[MACHINE.palette]!), 0, MACHINE.palettes * 32))));
  }
  {
    const s = readNscr(narc[FIELD.screen]!);
    const c = readNcgr(narc[FIELD.chars]!);
    const variants = [['normal', palette(FIELD.normal).subarray(16, 32)], ['bonus', palette(FIELD.bonus).subarray(0, 16)], ['blue', palette(FIELD.blue).subarray(0, 16)], ['red', palette(FIELD.red).subarray(0, 16)]] as const;
    sheets.add(
      'slots/field',
      variants.map(([, colors]) => {
        const r = new PaletteRam().load(readNclr(narc[MACHINE.palette]!), 0, MACHINE.palettes * 32);
        r.colors.set(colors, 16);
        return cell(screenImage(s, renderScreen(s, c, r)));
      }),
      { names: variants.map(([n]) => n) },
    );
  }
  {
    const backdrop = rgb555(palette(MACHINE.palette)[0]!);
    const img = blankImage(8, 8);
    for (let i = 0; i < 64; i++) img.rgba.set([...backdrop, 255], i * 4);
    sheets.add('slots/backdrop', [cell(img), cell(img)], { names: ['main', 'sub'] });
  }
  for (const [name, m] of Object.entries(OBJS)) sheets.obj(`slots/${name}`, narc, m);
  members.balls.forEach((m, i) => sheets.obj(`slots/ball_${i}`, narc, m));
  members.clefairy.forEach((m, i) => sheets.obj(`slots/clefairy_${i}`, narc, m));
}
