/**
 * The Super Contests' visual round art (docs/research/contests.md §5). Ids `platinum:ui2d/contest/<name>`:
 *
 * From /graphic/imageclip.narc (decomp overlay022):
 * - `contest/dress_bg`: the dress-up touch screen (characters 121, map 122, every tile on NCLR 133's first palette:
 *   ov22_02256948 loads one palette at slot 2 and sets it on the map);
 * - `contest/case_bg`: the Fashion Case's two page papers, cells 0/1 (characters 129/131, maps 130/132, NCLR 133's
 *   first palette; ov22_02258354), drawn at (8, 16);
 * - `contest/clock_bg`: the top screen's clock (characters 224, map 226, NCLR 225; ov22_0225A6E0);
 * - `contest/backdrops`: the 18 backdrops, 112 × 128 each (characters 134 + 4n, map 136 + 4n, NCLR 135 + 4n's first
 *   palette; ov22_02257C88), drawn at the stage's (136, 16) or the photo's frame;
 * - `contest/backdrop_icons`: the 18 backdrops' Fashion Case pictures (bitmaps 206 + n on NCLR 135 + 4n's first palette,
 *   loaded to slot 1; ov22_02255B50);
 * - `contest/accessories`: the 100 accessories (bitmaps 1 + id on the palette member 235 names in NCLR 0;
 *   ov22_02255ACC, ov22_022580A4);
 * - `contest/buttons`: NEXT and BACK page buttons (cells 0–2 and 3–5: up, pressed, held), the ACCESSORIES and
 *   BACKDROPS tabs (6–8, 9–11) and DONE (12–14) (characters 107 + 3n, cells 106 + 3n, NCLR 104; ov22_0225A218);
 * - `contest/digits`, `contest/digits_hurry`: the clock's digits 0–9 (characters 229, cells 228, NCLR 230; the last ten
 *   seconds on its palette 1, ov22_0225ACE4);
 * - `contest/dots`: the top screen's accessory dots, cell 0 placed, 1 free (characters 103, cells 102, NCLR 225);
 * - `contest/photo_bg`: the lobby's photo frame (characters 125, map 127, NCLR 126's first palette; ov22_0225B85C);
 * - `contest/photo_banner`: its banner per contest type, cell = type (characters 233, cells 232, animations 231,
 *   NCLR 234; anim n → the type's cell); anim 5 is the TV gallery's (ov22_0225BB00);
 * - `contest/dress_photo_bg`: the dress-up's background once DONE is pressed (characters 123, map 124, NCLR 133's first
 *   palette: ov22_02256948(…, 1) in ov22_02256C70);
 * - `contest/gallery_photo_bg`: the TV gallery's photo frame (characters 125, map 128, NCLR 126's second palette:
 *   ov22_0225B85C's dress-up mode loads two palettes at slot 3 and sets slot 4 on the map).
 *
 * From /graphic/touch_subwindow.narc (decomp yes_no_touch_menu.c, YesNoTouchMenu_InitButtons):
 * - `gallery/yes_no`: the touch YES and NO buttons, 48 × 32 each, cells 0–3 YES (up, then the three press frames),
 *   4–7 NO (maps 2 + 2f + button, characters 1, NCLR 0's palette `button`).
 *
 * From /contest/graphic/contest_bg.narc and contest_obj.narc (decomp overlay017 ov17_0223D4A8, ov17_0224774C):
 * - `contest/judging_stage`: the judging's stage (characters 23, map 22, NCLR 35);
 * - `contest/judging_curtain`: the curtain over it (characters 24, map 21, NCLR 37's first palette at slot 12);
 * - `contest/hearts`: the judging's hearts, cell 0 condition, 1 dress-up (characters 67, cells 68, NCLR 8).
 *
 * `accessoryPictures` reads the accessories' sizes and masks for `ContestTables.accessories`.
 */
import type { ContestAccessory } from '@opensinnoh/contracts';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop, renderCell, type CellImage, type Image } from './compose.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555, type Screen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const IMAGECLIP = { path: '/graphic/imageclip.narc', count: 236 };
const CONTEST_BG = { path: '/contest/graphic/contest_bg.narc', count: 41 };
const CONTEST_OBJ = { path: '/contest/graphic/contest_obj.narc', count: 103 };
const TOUCH_SUBWINDOW = { path: '/graphic/touch_subwindow.narc', count: 10 };
/** Decomp ACCESSORY_COUNT, BACKDROP_COUNT. */
const ACCESSORY_COUNT = 100;
const BACKDROP_COUNT = 18;
/** imageclip.narc members (ov22_02255094.c, ov22_02259C58.c, ov22_0225A428.c). */
const CLIP = {
  accessoryPalette: 0,
  accessoryPaletteSlots: 235,
  dressBg: { chars: 121, map: 122, palette: 133 },
  casePages: [{ chars: 129, map: 130 }, { chars: 131, map: 132 }],
  clockBg: { chars: 224, map: 226, palette: 225 },
  backdrop: (n: number) => ({ chars: 134 + 4 * n, palette: 135 + 4 * n, map: 136 + 4 * n }),
  backdropIcon: (n: number) => 206 + n,
  buttons: { first: 105, count: 5, palette: 104 },
  digits: { ncgr: 229, ncer: 228, nanr: 227, nclr: 230 },
  dots: { ncgr: 103, ncer: 102, nanr: 101, nclr: 225 },
  photoBg: { chars: 125, map: 127, palette: 126 },
  dressPhotoBg: { chars: 123, map: 124 },
  galleryPhotoBg: { chars: 125, map: 128, palette: 126 },
  banner: { ncgr: 233, ncer: 232, nanr: 231, nclr: 234 },
} as const;

function narcOf(fs: NitroFs, f: { path: string; count: number }): Uint8Array[] {
  const narc = readNarc(fs.file(f.path));
  if (narc.length !== f.count) throw new Error(`${f.path}: ${narc.length} members, expected ${f.count}`);
  return narc;
}

/** Every entry of a map on palette `p` (Bg_ChangeTilemapRectPalette over the whole map). */
const onPalette = (s: Screen, p: number): Screen => ({ ...s, entries: s.entries.map((e) => (e & 0x0fff) | (p << 12)) });

/** A BG map's top-left `w` × `h` on the given palette RAM. */
function bg(narc: Uint8Array[], chars: number, map: Screen, ram: PaletteRam, w: number, h: number): Image {
  return crop({ width: map.width, height: map.height, rgba: renderScreen(map, readNcgr(narc[chars]!), ram) }, 0, 0, w, h);
}

/** A map drawn on the first palette of `palette` (the decomp loads that one palette and sets it on every tile). */
function bgFirstPalette(narc: Uint8Array[], chars: number, map: number, palette: number, w: number, h: number): Image {
  return bg(narc, chars, onPalette(readNscr(narc[map]!), 0), new PaletteRam().load(readNclr(narc[palette]!), 0, 32), w, h);
}

/** A map drawn on palette `which` of `palette` (Bg_ChangeTilemapRectPalette over the whole map). */
function bgOnPalette(narc: Uint8Array[], chars: number, map: number, palette: number, which: number, w: number, h: number): Image {
  return bg(narc, chars, onPalette(readNscr(narc[map]!), which), new PaletteRam().load(readNclr(narc[palette]!), 0, 32 * (which + 1)), w, h);
}

/** A software sprite's 4bpp bitmap (SoftwareSprite_LoadChars: a scanned NCGR) with 16 colours; colour 0 is clear. */
function bitmap(member: Uint8Array, colors: Uint16Array): Image & { opaque: Uint8Array } {
  const c = readNcgrData(member);
  if (!c.scanned || c.bitDepth !== 4 || c.width < 1 || c.height < 1) throw new Error('contest art: a software sprite that is not a 4bpp bitmap');
  const width = c.width * 8;
  const height = c.height * 8;
  const rgba = new Uint8Array(width * height * 4);
  const opaque = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const v = (c.data[i >> 1]! >> ((i & 1) * 4)) & 15;
    if (!v) continue;
    opaque[i] = 1;
    rgba.set([...rgb555(colors[v]!), 255], i * 4);
  }
  return { width, height, rgba, opaque };
}

const cellOf = (img: Image): CellImage => ({ ...img, originX: 0, originY: 0 });

function accessoryBitmaps(clip: Uint8Array[]): (Image & { opaque: Uint8Array })[] {
  const colors = readNclr(clip[CLIP.accessoryPalette]!).colors;
  const slots = clip[CLIP.accessoryPaletteSlots]!;
  if (slots.length !== ACCESSORY_COUNT) throw new Error(`imageclip member ${CLIP.accessoryPaletteSlots}: ${slots.length} palette slots, expected ${ACCESSORY_COUNT}`);
  return Array.from({ length: ACCESSORY_COUNT }, (_, a) => {
    const slot = slots[a]!;
    if (slot * 16 + 16 > colors.length) throw new Error(`accessory ${a}: palette ${slot} past the ${colors.length / 16} palettes`);
    return bitmap(clip[1 + a]!, colors.subarray(slot * 16, slot * 16 + 16));
  });
}

/** The accessories' sizes and opaque masks (contracts `ContestAccessory`). */
export function accessoryPictures(fs: NitroFs): ContestAccessory[] {
  return accessoryBitmaps(narcOf(fs, IMAGECLIP)).map((b) => {
    if (![16, 32, 64].includes(b.width) || ![16, 32, 64].includes(b.height)) throw new Error(`accessory picture ${b.width}×${b.height}`);
    const bits = new Uint8Array(Math.ceil((b.width * b.height) / 8));
    b.opaque.forEach((o, i) => o && (bits[i >> 3]! |= 1 << (i & 7)));
    return { width: b.width, height: b.height, mask: btoa(String.fromCharCode(...bits)) };
  });
}

export function importContestArt(fs: NitroFs, sheets: Sheets): void {
  const clip = narcOf(fs, IMAGECLIP);
  const d = CLIP.dressBg;
  sheets.image('contest/dress_bg', bgFirstPalette(clip, d.chars, d.map, d.palette, 256, 192));
  sheets.add('contest/case_bg', CLIP.casePages.map((p) => cellOf(bgFirstPalette(clip, p.chars, p.map, d.palette, 112, 128))));
  {
    const c = CLIP.clockBg;
    sheets.image('contest/clock_bg', bg(clip, c.chars, readNscr(clip[c.map]!), new PaletteRam().load(readNclr(clip[c.palette]!)), 256, 192));
  }
  sheets.add(
    'contest/backdrops',
    Array.from({ length: BACKDROP_COUNT }, (_, n) => {
      const b = CLIP.backdrop(n);
      return cellOf(bgFirstPalette(clip, b.chars, b.map, b.palette, 112, 128));
    }),
  );
  sheets.add(
    'contest/backdrop_icons',
    Array.from({ length: BACKDROP_COUNT }, (_, n) => {
      const colors = readNclr(clip[CLIP.backdrop(n).palette]!).colors;
      return cellOf(bitmap(clip[CLIP.backdropIcon(n)]!, colors.subarray(0, 16)));
    }),
  );
  sheets.add('contest/accessories', accessoryBitmaps(clip).map(({ width, height, rgba }) => cellOf({ width, height, rgba })));
  {
    const b = CLIP.buttons;
    const colors = readNclr(clip[b.palette]!).colors;
    const cells = Array.from({ length: b.count }, (_, n) => {
      const bank = readNcer(clip[b.first + 3 * n + 1]!);
      const chars = readNcgrData(clip[b.first + 3 * n + 2]!);
      if (bank.cells.length !== 3) throw new Error(`contest button ${n}: ${bank.cells.length} cells, expected 3`);
      return bank.cells.map((c) => renderCell(c, chars.data, colors, { mapping: bank.mapping }));
    }).flat();
    sheets.add('contest/buttons', cells);
  }
  sheets.obj('contest/digits', clip, CLIP.digits);
  sheets.obj('contest/digits_hurry', clip, { ...CLIP.digits, palette: 1 });
  sheets.obj('contest/dots', clip, CLIP.dots);
  sheets.image('contest/photo_bg', bgFirstPalette(clip, CLIP.photoBg.chars, CLIP.photoBg.map, CLIP.photoBg.palette, 256, 192));
  sheets.obj('contest/photo_banner', clip, CLIP.banner);
  sheets.image('contest/dress_photo_bg', bgFirstPalette(clip, CLIP.dressPhotoBg.chars, CLIP.dressPhotoBg.map, d.palette, 256, 192));
  sheets.image('contest/gallery_photo_bg', bgOnPalette(clip, CLIP.galleryPhotoBg.chars, CLIP.galleryPhotoBg.map, CLIP.galleryPhotoBg.palette, 1, 256, 192));
  {
    // YesNoTouchMenu_InitButtons: button i's frame f is map 2 + 2f + i, on palette i.
    const touch = narcOf(fs, TOUCH_SUBWINDOW);
    const chars = readNcgr(touch[1]!);
    const ram = new PaletteRam().load(readNclr(touch[0]!), 0, 64);
    const cells = [0, 1].flatMap((button) =>
      [0, 1, 2, 3].map((f) => {
        const map = onPalette(readNscr(touch[2 + 2 * f + button]!), button);
        const img = crop({ width: map.width, height: map.height, rgba: renderScreen(map, chars, ram) }, 0, 0, 48, 32);
        return cellOf(img);
      }),
    );
    sheets.add('gallery/yes_no', cells);
  }

  const cbg = narcOf(fs, CONTEST_BG);
  sheets.image('contest/judging_stage', bg(cbg, 23, readNscr(cbg[22]!), new PaletteRam().load(readNclr(cbg[35]!)), 256, 192));
  sheets.image('contest/judging_curtain', bg(cbg, 24, readNscr(cbg[21]!), new PaletteRam().load(readNclr(cbg[37]!), 12 * 32, 32), 256, 192));
  const cobj = narcOf(fs, CONTEST_OBJ);
  sheets.obj('contest/hearts', cobj, { ncgr: 67, ncer: 68, nanr: 69, nclr: 8 });
}
