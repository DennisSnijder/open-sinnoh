/**
 * The Pokédex data (decomp applications/pokedex, docs/research/pokedex.md): per species the entry texts
 * (category, description, imperial height and weight strings), height and weight, body shape, the size
 * comparison against the player (zukan_data, zukan_data_gira for Giratina's Altered Forme), the area
 * lists (zukan_enc_platinum) and the footprint (pokefoot); and the area map's fields and dungeons.
 */
import type { DexArea, DexAreaList, DexSize, PokedexMap, SpeciesDex } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { renderCell } from './ui2d/compose.ts';
import { readNcer } from './ui2d/ncer.ts';
import { readNclr, readNcgrData } from './ui2d/nitro2d.ts';
import { IndexedPng } from './ui2d/png.ts';

const ZUKAN_DATA = { path: '/application/zukanlist/zkn_data/zukan_data.narc', gira: '/application/zukanlist/zkn_data/zukan_data_gira.narc', count: 58 };
const ZUKAN_ENC = { path: '/application/zukanlist/zkn_data/zukan_enc_platinum.narc', count: 4954 };
const POKEFOOT = { path: '/poketool/pokefoot/pokefoot.narc', count: 497, palette: 0, cells: 2, first: 3 };
/** National dex size (decomp NATIONAL_DEX_COUNT); per-species arrays have one more entry (species 0). */
export const NATIONAL_DEX_COUNT = 493;
/** decomp MAX_SPECIES (SPECIES_BAD_EGG): the stride of zukan_enc_platinum's per-species lists. */
const ENC_STRIDE = 495;
/** pokedex_enc_data.h PokedexEncFileCatgegory: dungeon lists 0–4, field lists 5–9. */
const ENC_LISTS: DexAreaList[] = ['morning', 'day', 'night', 'special', 'specialNational'];
/** Text banks (generated/text_banks.txt): entries (the game's own language: the US build's English, the German build's German; 706 is named _EN), weight, weight (Altered Giratina), height, height (Altered Giratina), category. */
const BANKS = { description: 706, weight: 707, weightGira: 708, height: 709, heightGira: 710, category: 711 };
const GIRATINA = 487;
/** ov21_021DC9BC.c: a 30×30 grid of 5 px cells; fields drawn from (89, 30), dungeon markers at (92, 32) + 5·(x, y). */
export const AREA_GRID = { columns: 30, rows: 30, cell: 5, origin: [89, 30] as [number, number], dungeonOrigin: [92, 32] as [number, number] };
/**
 * Hidden locations (decomp system_vars.c sHiddenLocationMagicNumbers, ov21_021DC9BC.c): the var that holds
 * the magic number once found, the zukan.narc overlay and the dungeons hidden until then (Spring Path:
 * dungeon 10, Turnback Cave).
 */
export const HIDDEN_LOCATIONS = [
  { var: 'VAR_HIDDEN_LOCATION_NEW_MOON_ISLAND', value: 0x229, overlay: 'map_newmoon_island', dungeons: [] as number[] },
  { var: 'VAR_HIDDEN_LOCATION_SEABREAK_PATH', value: 0x1028, overlay: 'map_seabreak_path', dungeons: [] as number[] },
  { var: 'VAR_HIDDEN_LOCATION_FULL_MOON_ISLAND', value: 0x208, overlay: 'map_fullmoon_island', dungeons: [] as number[] },
  { var: 'VAR_HIDDEN_LOCATION_SPRING_PATH', value: 0x312, overlay: 'map_spring_path', dungeons: [10] },
];

export interface PokedexImport {
  /** By national number (1–493). */
  entries: Map<number, SpeciesDex>;
  map: Omit<PokedexMap, 'image' | 'hidden'>;
  /** Species 0's texts: what a seen-only entry shows. */
  unknown: { category: Id; height: Id; weight: Id };
  assets: Map<string, Uint8Array>;
}

/** `text(bank, msg)`: the text record id of a message. */
export function importPokedex(fs: NitroFs, text: (bank: number, msg: number) => Id): PokedexImport {
  const data = readNarc(fs.file(ZUKAN_DATA.path));
  const gira = readNarc(fs.file(ZUKAN_DATA.gira));
  const enc = readNarc(fs.file(ZUKAN_ENC.path));
  const foot = readNarc(fs.file(POKEFOOT.path));
  if (data.length !== ZUKAN_DATA.count || gira.length !== ZUKAN_DATA.count) throw new Error(`zukan_data: ${data.length}/${gira.length} members, expected ${ZUKAN_DATA.count}`);
  if (enc.length !== ZUKAN_ENC.count) throw new Error(`${ZUKAN_ENC.path}: ${enc.length} members, expected ${ZUKAN_ENC.count}`);
  if (foot.length !== POKEFOOT.count) throw new Error(`${POKEFOOT.path}: ${foot.length} members, expected ${POKEFOOT.count}`);

  const array = (narc: Uint8Array[], member: number, size: 1 | 2 | 4, signed = false) => {
    const m = narc[member]!;
    if (m.length !== (NATIONAL_DEX_COUNT + 1) * size) throw new Error(`zukan_data member ${member}: ${m.length} bytes, expected ${(NATIONAL_DEX_COUNT + 1) * size}`);
    const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
    return (i: number) => (size === 1 ? dv.getUint8(i) : size === 2 ? (signed ? dv.getInt16(i * 2, true) : dv.getUint16(i * 2, true)) : dv.getUint32(i * 4, true));
  };
  const tables = (narc: Uint8Array[]) => ({
    height: array(narc, 0, 4),
    weight: array(narc, 1, 4),
    shape: array(narc, 2, 1),
    // Members 3–10 (pokedex_heightweight.c): female trainer/Pokémon scale, male trainer/Pokémon scale, then the same order for the positions.
    size: (i: number): { male: DexSize; female: DexSize } => ({
      female: { trainerScale: array(narc, 3, 2)(i), pokemonScale: array(narc, 4, 2)(i), trainerY: array(narc, 7, 2, true)(i), pokemonY: array(narc, 8, 2, true)(i) },
      male: { trainerScale: array(narc, 5, 2)(i), pokemonScale: array(narc, 6, 2)(i), trainerY: array(narc, 9, 2, true)(i), pokemonY: array(narc, 10, 2, true)(i) },
    }),
  });
  const plain = tables(data);
  const altered = tables(gira);

  const u32s = (m: Uint8Array) => {
    if (m.length % 4) throw new Error(`zukan_enc_platinum: a ${m.length}-byte list`);
    const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
    return Array.from({ length: m.length / 4 }, (_, i) => dv.getUint32(i * 4, true));
  };
  const dungeonsRaw = enc[0]!;
  const dungeons = Array.from({ length: dungeonsRaw.length / 4 }, (_, i) => ({ x: dungeonsRaw[i * 4]!, y: dungeonsRaw[i * 4 + 1]!, coronet: dungeonsRaw[i * 4 + 2] === 1 }));
  const fieldsRaw = enc[2]!;
  if (fieldsRaw.length % 36) throw new Error(`zukan_enc_platinum fields: ${fieldsRaw.length} bytes`);
  // FieldCoordinates {u8 y, x, height, width, cellMatrix[32]}: the decomp's "y" runs across the screen (the window blit takes it as x), "height" is its extent; the matrix is row-major with rows of "height" cells.
  const fields = Array.from({ length: fieldsRaw.length / 36 }, (_, i) => {
    const b = fieldsRaw.subarray(i * 36, i * 36 + 36);
    const width = b[2]!;
    const height = b[3]!;
    if (width * height > 32) throw new Error(`zukan_enc_platinum field ${i}: ${width}×${height} cells`);
    return { x: b[0]!, y: b[1]!, width, height, cells: [...b.subarray(4, 4 + width * height)] };
  });
  // The lists end with a 0 terminator (the loops stop one short).
  const list = (category: number, species: number, count: number) => {
    const values = u32s(enc[4 + species + ENC_STRIDE * category]!);
    if (values.at(-1) !== 0) throw new Error(`zukan_enc_platinum: species ${species} list ${category} has no terminator`);
    const out = values.slice(0, -1);
    const bad = out.find((v) => v >= count);
    if (bad !== undefined) throw new Error(`zukan_enc_platinum: species ${species} list ${category} names ${bad} of ${count}`);
    return out;
  };

  // Footprints: one NCGR per species drawn with the shared cell (two 16×8 OAMs, footprint.c) and footprint.NCLR, whose ink is black.
  const footCell = readNcer(foot[POKEFOOT.cells]!);
  const footColors = readNclr(foot[POKEFOOT.palette]!).colors;
  if (footCell.cells.length !== 1) throw new Error(`pokefoot: ${footCell.cells.length} cells, expected 1`);
  const assets = new Map<string, Uint8Array>();
  const footprint = (species: number): string | null => {
    const img = renderCell(footCell.cells[0]!, readNcgrData(foot[POKEFOOT.first + species]!).data, footColors, { mapping: footCell.mapping });
    if (img.width !== 16 || img.height !== 16) throw new Error(`footprint ${species}: ${img.width}×${img.height}, expected 16×16`);
    const indexes = new Uint8Array(16 * 16);
    let ink = 0;
    for (let p = 0; p < indexes.length; p++) {
      const [r, g, b, alpha] = img.rgba.subarray(p * 4, p * 4 + 4);
      if (!alpha || r! + g! + b! > 600) continue;
      indexes[p] = 1;
      ink++;
    }
    if (!ink) return null;
    const path = `pokedex/footprints/${species}.png`;
    const palette = new Uint8Array(8);
    palette.set([0, 0, 0, 255], 4);
    assets.set(path, new IndexedPng({ width: 16, height: 16, indexes, palette }).encode());
    return path;
  };

  const entries = new Map<number, SpeciesDex>();
  for (let n = 1; n <= NATIONAL_DEX_COUNT; n++) {
    // Giratina's species data is its Altered Forme (form 0): the _gira tables and banks; the plain ones are the Origin Forme.
    const t = n === GIRATINA ? altered : plain;
    const area = Object.fromEntries(
      ENC_LISTS.map((key, k): [DexAreaList, DexArea] => [key, { dungeons: list(k, n, dungeons.length), fields: list(5 + k, n, fields.length) }]),
    ) as Record<DexAreaList, DexArea>;
    const foot = footprint(n);
    const entry: SpeciesDex = {
      category: text(BANKS.category, n),
      description: text(BANKS.description, n),
      heightText: text(n === GIRATINA ? BANKS.heightGira : BANKS.height, n),
      weightText: text(n === GIRATINA ? BANKS.weightGira : BANKS.weight, n),
      height: t.height(n),
      weight: t.weight(n),
      shape: t.shape(n),
      footprint: foot ? asId(`platinum:${foot}`) : null,
      size: t.size(n),
      area,
    };
    if (n === GIRATINA)
      entry.forms = [{ form: 1, heightText: text(BANKS.height, n), weightText: text(BANKS.weight, n), height: plain.height(n), weight: plain.weight(n), size: plain.size(n) }];
    entries.set(n, entry);
  }
  return {
    entries,
    map: { origin: AREA_GRID.origin, dungeonOrigin: AREA_GRID.dungeonOrigin, cell: AREA_GRID.cell, columns: AREA_GRID.columns, rows: AREA_GRID.rows, fields, dungeons },
    unknown: { category: text(BANKS.category, 0), height: text(BANKS.height, 0), weight: text(BANKS.weight, 0) },
    assets,
  };
}

/**
 * The ROM's own sorted lists (zukan_data members 11–57: national, Sinnoh, A–Z, heaviest, lightest,
 * tallest, smallest, 9 name groups, 17 types, 14 shapes), species numbers; `gira`: the Altered Forme
 * Giratina's. The menus compute these from the records, and the ROM test compares.
 */
export function readDexLists(fs: NitroFs, gira: boolean): number[][] {
  const data = readNarc(fs.file(gira ? ZUKAN_DATA.gira : ZUKAN_DATA.path));
  return data.slice(11).map((m) => {
    const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
    return Array.from({ length: m.length / 2 }, (_, i) => dv.getUint16(i * 2, true));
  });
}
