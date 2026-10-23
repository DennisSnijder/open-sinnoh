/**
 * The acting round's 2D art (decomp overlay017 ov17_0223B140.c, ov17_022413D8.c, ov17_0223F7E4.c;
 * /contest/graphic/contest_bg.narc and contest_obj.narc). Sheets `contest/acting/…`:
 * - `stage`, `stage_cheer`: BG3, the audience and the stage (NCGR 1 over NSCR 2, the applause's other frame NSCR 0;
 *   NCLR 30), the screen's left 256×192; `stage_glow`, `stage_cheer_glow`: only their pixels of palette 0 colours 1–2,
 *   in 0x237E (the applause's glow, decomp ov17_022431E8 PaletteData_Blend).
 * - `window`: BG1, the message window (NCGR 3, NSCR 4).
 * - `panel`: BG2's contestant panel (NCGR 3, NSCR 5: one 80×48 row), cells 0–3 in the contestants' palettes 6, 7, 10,
 *   11 (Unk_ov17_022536B4, ov17_022413E4).
 * - OBJs (each with its SpriteTemplate's palette): `judge_0`–`judge_2` (members 31/32/30, 37/38/36, 34/35/33 with
 *   NCLR 1, 3, 2), `judge_box_0`–`judge_box_2` (39/40/41, palettes 2, 4, 5), `main_judge` (20/19/18, NCLR 9),
 *   `reaction` (14/13/12), `hearts` (17/16/15, palette 3), `pip` (26/25/24, palette 2), `star` (29/28/27),
 *   `order` (23/22/21), from NCLR 0 where not said.
 * - The touch screen's menus (NCGR 11, NCLR 40): `menu_bg` (NSCR 29), `menu_judges` (NSCR 10 over it), `move_button`
 *   (NSCR 6's first button, 112×88 at 8,8) in cells 0–4 by contest type (the type palettes Unk_ov17_022534B8 in
 *   palette slots 4–7, ov17_02240424) and 5 greyed (NCLR 40 palette 8: a move used last turn).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, type Image } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const BG = { path: '/contest/graphic/contest_bg.narc', count: 41 };
const OBJ = { path: '/contest/graphic/contest_obj.narc', count: 103 };
const W = 256;
const H = 192;
/** The applause's glow colour and the palette entries it blends (palette 0, colours 1–2). */
const GLOW = 0x237e;
/** The contestants' panel palettes (Unk_ov17_022536B4). */
const PANEL_PALETTES = [6, 7, 10, 11];
/** The type palettes' order in Unk_ov17_022534B8 by contest type (ov17_02240424: cool 3, beauty 4, cute 1, smart 2, tough 0). */
const TYPE_PALETTE = [3, 4, 1, 2, 0];

function narcOf(fs: NitroFs, n: { path: string; count: number }): Uint8Array[] {
  const narc = readNarc(fs.file(n.path));
  if (narc.length !== n.count) throw new Error(`${n.path}: ${narc.length} members, expected ${n.count}`);
  return narc;
}

/** One BG layer's top-left DS screen. */
function layer(bg: Uint8Array[], chr: number, screen: Screen, ram: PaletteRam): Image {
  return crop({ width: screen.width, height: screen.height, rgba: renderScreen(screen, readNcgr(bg[chr]!), ram) }, 0, 0, W, H);
}

/** `top` over `under` (transparent pixels show what is under). */
function over(under: Image, top: Image): Image {
  const out = { width: under.width, height: under.height, rgba: new Uint8Array(under.rgba) };
  for (let p = 0; p < out.rgba.length; p += 4) if (top.rgba[p + 3]) out.rgba.set(top.rgba.subarray(p, p + 4), p);
  return out;
}

/** The pixels that differ between two renders of one layer (the rest transparent). */
function diff(base: Image, changed: Image): Image {
  const out = { width: base.width, height: base.height, rgba: new Uint8Array(base.rgba.length) };
  for (let p = 0; p < out.rgba.length; p += 4) {
    const same = base.rgba[p] === changed.rgba[p] && base.rgba[p + 1] === changed.rgba[p + 1] && base.rgba[p + 2] === changed.rgba[p + 2] && base.rgba[p + 3] === changed.rgba[p + 3];
    if (!same) out.rgba.set(changed.rgba.subarray(p, p + 4), p);
  }
  return out;
}

/** `palettes`: Unk_ov17_022534B8, the move buttons' five type palettes (contracts `ContestActingTables.buttonPalettes`). */
export function importContestActingArt(fs: NitroFs, sheets: Sheets, palettes: readonly (readonly number[])[]): void {
  const bg = narcOf(fs, BG);
  const obj = narcOf(fs, OBJ);
  const ram = new PaletteRam().load(readNclr(bg[30]!));
  const glowRam = new PaletteRam().load(readNclr(bg[30]!));
  glowRam.colors[1] = GLOW;
  glowRam.colors[2] = GLOW;
  for (const [name, scr] of [['stage', 2], ['stage_cheer', 0]] as const) {
    const screen = readNscr(bg[scr]!);
    const plain = layer(bg, 1, screen, ram);
    sheets.image(`contest/acting/${name}`, plain);
    sheets.image(`contest/acting/${name}_glow`, diff(plain, layer(bg, 1, screen, glowRam)));
  }
  sheets.image('contest/acting/window', layer(bg, 3, readNscr(bg[4]!), ram));
  // The panel: the first row of BG2 (10×6 tiles) with its palette bits set as ov17_022413E4 sets them.
  const panel = readNscr(bg[5]!);
  sheets.add(
    'contest/acting/panel',
    PANEL_PALETTES.map((p) => {
      const entries = new Uint16Array(panel.entries);
      for (let ty = 0; ty < 6; ty++) for (let tx = 0; tx < 10; tx++) entries[ty * 32 + tx] = (entries[ty * 32 + tx]! & 0xfff) | (p << 12);
      const img = layer(bg, 3, { ...panel, entries }, ram);
      return { ...crop(img, 0, 0, 80, 48), originX: 0, originY: 0 };
    }),
  );
  const objs: [string, number, number, number, number, number][] = [
    ['judge_0', 31, 1, 32, 30, 0],
    ['judge_1', 37, 3, 38, 36, 0],
    ['judge_2', 34, 2, 35, 33, 0],
    ['judge_box_0', 39, 0, 40, 41, 2],
    ['judge_box_1', 39, 0, 40, 41, 4],
    ['judge_box_2', 39, 0, 40, 41, 5],
    ['main_judge', 20, 9, 19, 18, 0],
    ['reaction', 14, 0, 13, 12, 0],
    ['hearts', 17, 0, 16, 15, 3],
    ['pip', 26, 0, 25, 24, 2],
    ['star', 29, 0, 28, 27, 0],
    ['order', 23, 0, 22, 21, 0],
  ];
  // SpriteSystem_NewSprite: the template's palette replaces every OAM's (Sprite_SetExplicitPalette).
  for (const [name, ncgr, nclr, ncer, nanr, palette] of objs) sheets.obj(`contest/acting/${name}`, obj, { ncgr, nclr, ncer, nanr, palette });
  // The touch screen's menus (modes 2 and 3 of Unk_ov17_02253558: NCGR 11, palettes NCLR 40).
  const menuRam = new PaletteRam().load(readNclr(bg[40]!));
  const menuBg = layer(bg, 11, readNscr(bg[29]!), menuRam);
  sheets.image('contest/acting/menu_bg', menuBg);
  sheets.image('contest/acting/menu_judges', over(menuBg, layer(bg, 11, readNscr(bg[10]!), menuRam)));
  const buttons = readNscr(bg[6]!);
  const button = (colors: readonly number[]) => {
    const r = new PaletteRam().load(readNclr(bg[40]!));
    for (let slot = 4; slot < 8; slot++) r.colors.set(colors, slot * 16);
    return { ...crop(layer(bg, 11, buttons, r), 8, 8, 112, 88), originX: 0, originY: 0 };
  };
  if (palettes.length !== TYPE_PALETTE.length) throw new Error(`contest acting: ${palettes.length} button palettes`);
  const grey = Array.from(readNclr(bg[40]!).colors.subarray(8 * 16, 9 * 16));
  sheets.add('contest/acting/move_button', [...TYPE_PALETTE.map((p) => button(palettes[p]!)), button(grey)]);
}
