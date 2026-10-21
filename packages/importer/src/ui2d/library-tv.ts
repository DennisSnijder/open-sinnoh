/**
 * The Canalave Library TV's art (decomp library_tv/library_tv.c, LibraryTV_SetVramBank). The main BG palette RAM
 * holds /graphic/library_tv.narc NCLR 3 (256 colours; Bg_MaskPalette makes colour 0, the backdrop, black). BG3 is
 * the picture (library_tv NCGR 2 over NSCR 4, 256 colours), BG0 the frame (/demo/intro/intro_tv.narc NCGR 1 over
 * NSCR 4) and BG1 the scan lines (intro_tv NCGR 2 over NSCR 5), both 16 colours on palette 0 of that RAM (the
 * text palette Font_LoadTextPalette puts in palette 1 is not used). Sheets `library_tv/picture` and
 * `library_tv/frame` (256×192, as shown; the picture is opaque) and `library_tv/scanlines` (256×256: it scrolls and wraps).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { crop } from './compose.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const LIBRARY_TV = { path: '/graphic/library_tv.narc', count: 5 };
const INTRO_TV = { path: '/demo/intro/intro_tv.narc', count: 10 };
const DS_WIDTH = 256;
const DS_HEIGHT = 192;

export function importLibraryTvArt(fs: NitroFs, sheets: Sheets): void {
  const tv = readNarc(fs.file(LIBRARY_TV.path));
  if (tv.length !== LIBRARY_TV.count) throw new Error(`${LIBRARY_TV.path}: ${tv.length} members, expected ${LIBRARY_TV.count}`);
  const intro = readNarc(fs.file(INTRO_TV.path));
  if (intro.length !== INTRO_TV.count) throw new Error(`${INTRO_TV.path}: ${intro.length} members, expected ${INTRO_TV.count}`);
  const ram = new PaletteRam().load(readNclr(tv[3]!));
  const layer = (narc: Uint8Array[], path: string, chr: number, scr: number) => {
    const screen = readNscr(narc[scr]!);
    const chars = readNcgr(narc[chr]!);
    // 16-colour layers: every tile on palette 0 (the only one LibraryTV_SetVramBank fills for them).
    if (chars.bitDepth === 4 && screen.entries.some((e) => e >> 12)) throw new Error(`${path} NSCR ${scr}: a tile off palette 0`);
    return { width: screen.width, height: screen.height, rgba: renderScreen(screen, chars, ram) };
  };
  const picture = crop(layer(tv, LIBRARY_TV.path, 2, 4), 0, 0, DS_WIDTH, DS_HEIGHT);
  // The scan lines blend with the picture only (G2_SetBlendAlpha: second targets BG2 and BG3, not the backdrop).
  for (let p = 3; p < picture.rgba.length; p += 4) if (!picture.rgba[p]) throw new Error(`${LIBRARY_TV.path}: the picture shows the backdrop at pixel ${(p - 3) / 4}`);
  sheets.image('library_tv/picture', picture);
  sheets.image('library_tv/frame', crop(layer(intro, INTRO_TV.path, 1, 4), 0, 0, DS_WIDTH, DS_HEIGHT));
  sheets.image('library_tv/scanlines', layer(intro, INTRO_TV.path, 2, 5));
}
