/**
 * The journal's pages and the diplomas' documents (docs/research/villa-journal.md §2.4, §3).
 *
 * - Journal (decomp journal_display/journal_controller.c JournalController_LoadGraphics): /graphic/f_note_gra.narc
 *   members 0/1 the page tilemap (male/female), 2/3 its tiles, 4/5 the 16 palettes. A page's paper is the tilemap with
 *   every entry on palette n, the page number (JournalController_LoadNewPagePalette). Sheets `journal/page-male` and
 *   `journal/page-female`: ten 256×192 cells, page 0–9, on the backdrop (palette 0 colour 0).
 * - Diplomas (decomp applications/diploma.c Diploma_LoadGraphics): /demo/syoujyou/syoujyou.narc NCGR 0/1 (the Sinnoh and
 *   National documents), 2/3 the blank backgrounds; NCLR 4–7 and NSCR 8–11 in the same order. BG3 the blank on
 *   palette 0, BG1 the document with every entry on palette 1. Sheets `diploma/sinnoh` and `diploma/national`: the
 *   document's top 256×192 (its text rows) over the blank, as the DS's bottom screen ends.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen, rgb555, type Screen } from './nitro2d.ts';
import type { Image } from './compose.ts';
import type { Sheets } from './sheets.ts';

const JOURNAL = { path: '/graphic/f_note_gra.narc', count: 6 };
const DIPLOMA = { path: '/demo/syoujyou/syoujyou.narc', count: 12 };
const W = 256;
const H = 192;
/** Decomp MAX_JOURNAL_ENTRIES: one paper palette per page. */
const PAGES = 10;

/** The screen with every entry on palette `p` (Bg_ChangeTilemapRectPalette over the whole map). */
const onPalette = (s: Screen, p: number): Screen => ({ ...s, entries: s.entries.map((e) => (e & 0x0fff) | (p << 12)) });

/** `top` over `bottom` (index-0 pixels of the top are transparent), on an opaque backdrop colour. */
function layer(bottom: Uint8Array | null, top: Uint8Array, backdrop: [number, number, number]): Image {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const src = top[i * 4 + 3] ? top : bottom && bottom[i * 4 + 3] ? bottom : null;
    if (src) rgba.set(src.subarray(i * 4, i * 4 + 4), i * 4);
    else rgba.set([...backdrop, 255], i * 4);
  }
  return { width: W, height: H, rgba };
}

export function importJournalArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(JOURNAL.path));
  if (narc.length !== JOURNAL.count) throw new Error(`${JOURNAL.path}: ${narc.length} members, expected ${JOURNAL.count}`);
  for (const [gender, g] of [['male', 0], ['female', 1]] as const) {
    const screen = readNscr(narc[g]!);
    const chars = readNcgr(narc[2 + g]!);
    const ram = new PaletteRam().load(readNclr(narc[4 + g]!));
    const backdrop = rgb555(ram.colors[0]!);
    const cells = Array.from({ length: PAGES }, (_, p) => ({ ...layer(null, renderScreen(onPalette(screen, p), chars, ram, W, H), backdrop), originX: 0, originY: 0 }));
    sheets.add(`journal/page-${gender}`, cells);
  }
}

export function importDiplomaArt(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(DIPLOMA.path));
  if (narc.length !== DIPLOMA.count) throw new Error(`${DIPLOMA.path}: ${narc.length} members, expected ${DIPLOMA.count}`);
  for (const [kind, k] of [['sinnoh', 0], ['national', 1]] as const) {
    // Graphics_LoadPalette(blank NCLR → palette 0, 32 bytes) and (document NCLR → palette 1, 32 bytes).
    const ram = new PaletteRam().load(readNclr(narc[6 + k]!), 0, 32).load(readNclr(narc[4 + k]!), 32, 32);
    const blank = renderScreen(readNscr(narc[10 + k]!), readNcgr(narc[2 + k]!), ram, W, H);
    const doc = renderScreen(onPalette(readNscr(narc[8 + k]!), 1), readNcgr(narc[k]!), ram, W, H);
    sheets.image(`diploma/${kind}`, layer(blank, doc, rgb555(ram.colors[0]!)));
  }
}
