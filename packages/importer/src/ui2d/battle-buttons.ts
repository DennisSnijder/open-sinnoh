/**
 * The battle touch screen's buttons (decomp battle_subscreen.c), each a nine-slice sheet
 * `battle/buttons/<name>` for the command card: the command menu (FIGHT, BAG, POKéMON, RUN), the move
 * buttons in every type's colours and the empty slot, CANCEL, and YES / NO.
 *
 * The bottom screen's BG: pl_batt_bg member 28 (4bpp tiles) with palette file 242, and one NSCR per menu
 * (sBgScreenNarcIndices): 42 the command menu, 43 the move select, 45 YES / NO. The move buttons use
 * palettes 8–11, loaded per move from overlay 11's type palettes (move_palettes.c LoadMoveSelectPltt);
 * an empty slot shifts the button's tiles by sEmptyMoveSlotTileOffsets and takes palette 14
 * (LoadEmptyMoveSlotBg, ApplyMoveSlotTilemap). RUN and CANCEL run off the screen's bottom edge:
 * they get a bottom edge mirrored from their top one, as the other buttons have.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, crop, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const BATT_BG = '/battle/graphic/pl_batt_bg.narc';
const TILES = 28;
const PALETTES = 242;
const SCREEN = { command: 42, moves: 43, yesNo: 45, target: 44, targetFrames: 48 };
/**
 * The target screen (sBgScreenNarcIndices 4 and 5: BG4 the buttons, BG5 their frames): its four battler buttons by
 * battler id at their touch rects' art (sTargetSelectMenuTouchRects), the blank a slot that cannot be aimed at shows
 * (ClearMenuSlotBg: tiles moved by sClearMenuSlotTileOffsets, palette 14 into the slot's palette, the frame cleared),
 * and the link tile BattleSubscreen_DrawTargetSelectBg fills between the buttons of a group.
 */
const TARGET_BUTTONS: { battler: number; x: number; y: number; w: number; h: number; tiles: [number, number, number, number]; offset: number; palette: number }[] = [
  { battler: 0, x: 0, y: 88, w: 120, h: 56, tiles: [0xb, 0x11, 0x0, 0xe], offset: 0x238, palette: 6 },
  { battler: 1, x: 136, y: 8, w: 120, h: 72, tiles: [0x1, 0x9, 0x11, 0x1f], offset: 0x235, palette: 12 },
  { battler: 2, x: 136, y: 88, w: 120, h: 56, tiles: [0xb, 0x11, 0x11, 0x1f], offset: 0x232, palette: 13 },
  { battler: 3, x: 0, y: 8, w: 120, h: 72, tiles: [0x1, 0x9, 0x0, 0xe], offset: 0x23b, palette: 5 },
];
const TARGET_SLICE: [number, number, number, number] = [16, 10, 16, 8];
const TARGET_LINK = { tile: 0x2a4 };
/** The move buttons' palette slot (button 0); the empty slot's palette, tile offset and tile rows (button 0). */
const MOVE_SLOT_PALETTE = 8;
const EMPTY = { palette: 14, tileOffset: 0x22f, rows: [3, 9], cols: [0, 15] };

/**
 * Overlay 11 move_palettes.c: 19 palettes of 16 colours back to back from 0x14c, not in TYPE_* order:
 * Normal, None, then Dark back to Fighting. The type names follow type_icons (TYPE_* order).
 */
export const MOVE_PALETTES = { overlay: 11, offset: 0x14c, size: 19 * 32 };
const MOVE_PALETTE_SLOT: Record<string, number> = {
  normal: 0, dark: 2, dragon: 3, ice: 4, psychic: 5, electric: 6, grass: 7, water: 8, fire: 9, mystery: 10,
  steel: 11, ghost: 12, bug: 13, rock: 14, ground: 15, poison: 16, flying: 17, fighting: 18,
};

/** [name, screen, x, y, width, height, nine-slice insets (left, top, right, bottom), mirror a bottom edge]. */
const BUTTONS: [string, number, number, number, number, number, [number, number, number, number], boolean][] = [
  ['fight', SCREEN.command, 20, 34, 216, 93, [19, 10, 19, 4], false],
  ['bag', SCREEN.command, 1, 144, 78, 47, [11, 10, 11, 4], false],
  ['pokemon', SCREEN.command, 177, 144, 78, 47, [11, 10, 11, 4], false],
  ['run', SCREEN.command, 89, 152, 78, 40, [11, 10, 11, 4], true],
  ['cancel', SCREEN.moves, 9, 152, 238, 40, [11, 10, 11, 4], true],
  ['yes', SCREEN.yesNo, 4, 34, 248, 61, [19, 10, 19, 4], false],
  ['no', SCREEN.yesNo, 4, 106, 248, 61, [19, 10, 19, 4], false],
];
/** The first move button and its insets: the centre is the cream panel's flat middle. */
const MOVE_BUTTON = { x: 2, y: 24, w: 124, h: 55, slice: [15, 14, 15, 15] as [number, number, number, number] };

/** A button that runs off the screen: its top rows' outline (0–2) and shade (9) mirrored under it. */
function withBottomEdge(img: Image): Image {
  const rows = [9, 2, 1, 0];
  const out = blankImage(img.width, img.height + rows.length);
  out.rgba.set(img.rgba);
  rows.forEach((src, i) => out.rgba.set(img.rgba.subarray(src * img.width * 4, (src + 1) * img.width * 4), (img.height + i) * img.width * 4));
  return out;
}

/** `movePalettes`: the overlay bytes of MOVE_PALETTES (checked by the caller). */
export function importBattleButtons(fs: NitroFs, sheets: Sheets, movePalettes: Uint8Array): void {
  const bg = readNarc(fs.file(BATT_BG));
  const chars = readNcgr(bg[TILES]!);
  const palette = readNclr(bg[PALETTES]!);
  const ram = () => new PaletteRam().load(palette, 0, 512);
  const parsed = new Map(Object.values(SCREEN).map((s) => [s, readNscr(bg[s]!)]));
  /** The screen's top-left `width`×`height` (its entries changed by `edit` first, on a copy). */
  const render = (screen: number, r: PaletteRam, edit?: (entries: Uint16Array) => void, width = 256, height = 256): Image => {
    const scr = parsed.get(screen)!;
    const entries = scr.entries.slice();
    edit?.(entries);
    return { width, height, rgba: renderScreen({ ...scr, entries }, chars, r, width, height) };
  };
  const screens = new Map(Object.values(SCREEN).map((s) => [s, render(s, ram())]));
  for (const [name, screen, x, y, w, h, nineSlice, mirror] of BUTTONS) {
    const img = crop(screens.get(screen)!, x, y, w, h);
    sheets.image(`battle/buttons/${name}`, mirror ? withBottomEdge(img) : img, { nineSlice });
  }
  const move = (name: string, colors: Uint16Array, edit?: (entries: Uint16Array) => void) => {
    const r = ram();
    r.colors.set(colors, MOVE_SLOT_PALETTE * 16);
    const m = MOVE_BUTTON;
    sheets.image(`battle/buttons/move_${name}`, crop(render(SCREEN.moves, r, edit, 128, 80), m.x, m.y, m.w, m.h), { nineSlice: m.slice });
  };
  // The target screen: each battler's button with its frame (BG5 over BG4), its blank, and the group link tile.
  const framed = render(SCREEN.target, ram());
  const frames = render(SCREEN.targetFrames, ram());
  for (let i = 0; i < frames.rgba.length; i += 4) if (frames.rgba[i + 3]) framed.rgba.set(frames.rgba.subarray(i, i + 4), i);
  for (const t of TARGET_BUTTONS) {
    sheets.image(`battle/buttons/target_${t.battler}`, crop(framed, t.x, t.y, t.w, t.h), { nineSlice: TARGET_SLICE });
    const r = ram();
    r.colors.set(palette.colors.subarray(EMPTY.palette * 16, EMPTY.palette * 16 + 16), t.palette * 16);
    const [top, bottom, left, right] = t.tiles;
    const blank = render(SCREEN.target, r, (entries) => {
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) entries[y * 32 + x] = (entries[y * 32 + x]! + t.offset) & 0xffff;
    });
    sheets.image(`battle/buttons/target_${t.battler}_empty`, crop(blank, t.x, t.y, t.w, t.h), { nineSlice: TARGET_SLICE });
  }
  sheets.image(
    'battle/buttons/target_link',
    render(SCREEN.targetFrames, ram(), (entries) => entries.fill(0).set([TARGET_LINK.tile]), 8, 8),
  );
  const words = new Uint16Array(movePalettes.slice().buffer);
  for (const [type, slot] of Object.entries(MOVE_PALETTE_SLOT)) move(type, words.subarray(slot * 16, slot * 16 + 16));
  move('empty', palette.colors.subarray(EMPTY.palette * 16, EMPTY.palette * 16 + 16), (entries) => {
    for (let y = EMPTY.rows[0]!; y <= EMPTY.rows[1]!; y++) for (let x = EMPTY.cols[0]!; x <= EMPTY.cols[1]!; x++) entries[y * 32 + x] = (entries[y * 32 + x]! + EMPTY.tileOffset) & 0xffff;
  });
}
