/**
 * The Pokédex art (zukan.narc, members per res/graphics/pokedex/pokedex.order; docs/research/pokedex.md):
 * the area map and its hidden-location overlays, the field highlight tiles, the height check and entry
 * backgrounds (BG renders with the banner palette, as ov21_021E29DC.c loads it), and the OBJ sets the
 * pages use (type icons, body shapes, page buttons, time-of-day icons, dungeon markers, the unseen icon,
 * the size-check silhouettes). Ids `platinum:ui2d/pokedex/<name>`.
 *
 * The DS screens the Pokédex boards draw on, composed as the decomp loads their tilemaps:
 * - `pokedex/list_screen`: the list's top screen, scroll_main_background (BG3, background_scroll_default.NCLR)
 *   with register_species_window at tile (1, 4) (ov21_021D5AEC.c ov21_021D62E4);
 * - `pokedex/entry_screen`: the entry's info page, info_main with info_species_window at tile (0, 3),
 *   info_footprint_window at (12, 8) and info_entry_window at (0, 16) (infomain.c LoadBackground);
 * - `pokedex/banner`: the entry's banner (banner_sinnoh on BG2 over every entry page, ov21_021E29DC.c), drawn over
 *   the area and size pages' own screens; `entry_screen` has it composed in;
 * - `pokedex/search_screen`: the search's top screen, search_sinnoh's top 256×192 (pokedex_search.c, BG3 with
 *   scroll_main_background's characters and search.NCLR's first palette).
 * The cry page (ov21_021E3FFC.c): `pokedex/cry_screen` (cry_button over entry_main, BG3), `pokedex/cry_bar` (the
 * level meter's OBJ set: cry_bar cells, animations, characters and palette) and `pokedex/cry_wave` (a 1×1 swatch
 * of the waveform's colour: the window's palette 9, colour 6, of the banner palette).
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, blit, renderCell, type Image } from './compose.ts';
import { readNanr } from './nanr.ts';
import { readNcer } from './ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555 } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';

const ZUKAN = { path: '/resource/eng/zukan/zukan.narc', count: 130 };
const NCLR = { scrollDefault: 0, buttons: 3, search: 5, bannerSinnoh: 6, info: 11, typeIcons: 13, sizeCheckIcons: 14, cryBar: 19 };
const NCGR = { scrollMain: 28, areaFields: 30, areaFieldsSpecial: 31, entryMain: 33 };
const NSCR = {
  scrollMain: 38,
  registerWindow: 39,
  searchSinnoh: 40,
  infoMain: 50,
  infoSpeciesWindow: 51,
  infoFootprintWindow: 52,
  infoEntryWindow: 54,
  bannerSinnoh: 57,
  areaMap: 64,
  map_newmoon_island: 65,
  map_seabreak_path: 66,
  map_fullmoon_island: 67,
  map_spring_path: 68,
  heightCheck: 74,
  cryButton: 70,
};
/** ov21_021E4ABC / ov21_021E495C: the waveform window's palette and colour. */
const CRY_WAVE = { palette: 9, color: 6 };
/** OBJ sets: [cells, animations, characters, palette]. */
const OBJS: Record<string, [number, number, number, number]> = {
  body_shapes: [79, 80, 81, NCLR.buttons],
  type_icons: [88, 89, 90, NCLR.typeIcons],
  size_check_icons: [91, 92, 93, NCLR.sizeCheckIcons],
  page_buttons: [94, 95, 96, NCLR.info],
  time_day_icons: [103, 104, 105, NCLR.info],
  dungeon_highlight: [106, 107, 108, NCLR.sizeCheckIcons],
  unseen_icon: [109, 110, 111, NCLR.buttons],
  search_shapes: [129, 127, 128, NCLR.buttons],
  cry_bar: [117, 115, 116, NCLR.cryBar],
};
/** The area field windows use BG palette 8 (ov21_021DC9BC.c). */
const FIELD_PALETTE = 8;

export function importPokedexArt(fs: NitroFs, sheets: Sheets): void {
  const z = readNarc(fs.file(ZUKAN.path));
  if (z.length !== ZUKAN.count) throw new Error(`${ZUKAN.path}: ${z.length} members, expected ${ZUKAN.count}`);
  const banner = readNclr(z[NCLR.bannerSinnoh]!);
  const entry = readNcgr(z[NCGR.entryMain]!);
  const bg = (name: string, nscr: number) => {
    const screen = readNscr(z[nscr]!);
    const width = Math.min(256, screen.width);
    const height = Math.min(192, screen.height);
    sheets.image(`pokedex/${name}`, { width, height, rgba: renderScreen(screen, entry, new PaletteRam().load(banner), width, height) });
  };
  bg('info_background', NSCR.infoMain);

  // The DS screens of the boards: tilemaps composed at their tile rects, colour 0 transparent.
  const layer = (nscr: number, chars: ReturnType<typeof readNcgr>, ram: PaletteRam): Image => {
    const s = readNscr(z[nscr]!);
    const width = Math.min(256, s.width);
    const height = Math.min(192, s.height);
    return { width, height, rgba: renderScreen(s, chars, ram, width, height) };
  };
  const bannerRam = new PaletteRam().load(banner);
  const bannerLayer = layer(NSCR.bannerSinnoh, entry, bannerRam);
  const entryScreen = layer(NSCR.infoMain, entry, bannerRam);
  for (const [nscr, tx, ty] of [[NSCR.infoSpeciesWindow, 0, 3], [NSCR.infoFootprintWindow, 12, 8], [NSCR.infoEntryWindow, 0, 16]] as const) blit(entryScreen, layer(nscr, entry, bannerRam), tx * 8, ty * 8, true);
  blit(entryScreen, bannerLayer, 0, 0);
  sheets.image('pokedex/entry_screen', entryScreen);
  sheets.image('pokedex/banner', bannerLayer);
  const scrollChars = readNcgr(z[NCGR.scrollMain]!);
  const scrollRam = new PaletteRam().load(readNclr(z[NCLR.scrollDefault]!));
  const listScreen = layer(NSCR.scrollMain, scrollChars, scrollRam);
  blit(listScreen, layer(NSCR.registerWindow, scrollChars, scrollRam), 8, 32, true);
  sheets.image('pokedex/list_screen', listScreen);
  sheets.image('pokedex/search_screen', layer(NSCR.searchSinnoh, scrollChars, new PaletteRam().load(readNclr(z[NCLR.scrollDefault]!)).load(readNclr(z[NCLR.search]!), 0, 32)));
  bg('area_map', NSCR.areaMap);
  bg('height_check', NSCR.heightCheck);
  bg('cry_screen', NSCR.cryButton);
  sheets.image('pokedex/cry_wave', { width: 1, height: 1, rgba: new Uint8Array([...rgb555(banner.colors[CRY_WAVE.palette * 16 + CRY_WAVE.color]!), 255]) });
  for (const name of ['map_newmoon_island', 'map_seabreak_path', 'map_fullmoon_island', 'map_spring_path'] as const) bg(name, NSCR[name]);

  // The field highlight tiles: one row of 8×8 characters read as a bitmap; tile type t is the 5×5 square at x = 5t.
  const fieldTiles = (member: number): Image => {
    const chars = readNcgr(z[member]!);
    const img = blankImage(chars.tiles.length * 8, 8);
    chars.tiles.forEach((tile, t) =>
      tile.forEach((index, p) => {
        if (index) img.rgba.set([...rgb555(banner.colors[FIELD_PALETTE * 16 + index]!), 255], ((p >> 3) * img.width + t * 8 + (p & 7)) * 4);
      }),
    );
    return img;
  };
  sheets.image('pokedex/area_fields', fieldTiles(NCGR.areaFields));
  sheets.image('pokedex/area_fields_special', fieldTiles(NCGR.areaFieldsSpecial));

  for (const [name, [ncer, nanr, ncgr, nclr]] of Object.entries(OBJS)) sheets.obj(`pokedex/${name}`, z, { ncer, nanr, ncgr, nclr });

  // The list uses search_body_shapes animation 0 (the plate), 1 (caught ball), 2 (scroll thumb).
  // Explicit palette offsets by distance from the centre: 0, 7, 8, 9 (ov21_021D69A0).
  for (const palette of [0, 7, 8, 9]) sheets.obj(`pokedex/list_tags_${palette}`, z, { ncer: 79, nanr: 80, ncgr: 81, nclr: NCLR.buttons, palette });

  // Named sheets: the first frame of each animation, in the order the menus look them up.
  const named = (path: string, [ncer, nanr, ncgr, nclr]: [number, number, number, number], anims: number[], names: string[]) => {
    const bank = readNcer(z[ncer]!);
    const seqs = readNanr(z[nanr]!);
    const chars = readNcgrData(z[ncgr]!).data;
    const colors = readNclr(z[nclr]!).colors;
    const cells = anims.map((a) => {
      const frame = seqs[a]?.frames[0];
      if (!frame) throw new Error(`ui2d ${path}: no animation ${a}`);
      return renderCell(bank.cells[frame.cell]!, chars, colors, { mapping: bank.mapping });
    });
    sheets.add(path, cells, { names });
  };
  named('pokedex/types', OBJS.type_icons!, TYPE_ANIMS.map(([, a]) => a), TYPE_ANIMS.map(([n]) => n));
  named(
    'pokedex/shapes',
    OBJS.search_shapes!,
    SHAPE_ANIMS,
    SHAPE_ANIMS.map((_, s) => `shape_${s}`),
  );
}

/** Type icon animations (infomain.c PokedexGraphics_GetAnimIDfromType; Mystery shows Ghost's), by type name; 17 is the category box. */
const TYPE_ANIMS: [string, number][] = [
  ['normal', 0], ['fighting', 6], ['flying', 14], ['poison', 10], ['ground', 8], ['rock', 5], ['bug', 11], ['ghost', 7], ['steel', 9], ['mystery', 7],
  ['fire', 1], ['water', 3], ['grass', 2], ['electric', 4], ['psychic', 15], ['ice', 13], ['dragon', 16], ['dark', 12], ['category', 17],
];
/**
 * The search's body-shape buttons (search_button_forms) by decomp PokemonBodyShape 0–13 (the search grid
 * of ov21_021D94BC.c; quadruped and insectoid checked by eye against the pictures).
 */
const SHAPE_ANIMS = [7, 13, 11, 5, 4, 12, 9, 6, 1, 2, 3, 10, 0, 8];
