/**
 * Item icons (decomp item.c Item_FileID, item_icon.narc per res/items/item_icon.order): one 32×32 4bpp
 * NCGR and one NCLR per item, picked by the item's archive ids (the generated sItemArchiveIDs table in
 * arm9: {dataID, iconID, paletteID, gen3ID} per item). Drawn with the shared generic cell (one 32×32
 * OBJ, 1D mapping: 16 characters row-major). Items sharing an icon and palette share one PNG.
 */
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage } from './compose.ts';
import { readNanr } from './nanr.ts';
import { charactersOf, readNclr, readNcgrData, rgb555 } from './nitro2d.ts';
import { IndexedPng } from './png.ts';
import { animations, type Sheets } from './sheets.ts';

/** pl_poke_icon shared animations (32K and 64K VRAM variants, the same sequences): POKEICON_ANIM_* order. */
const ICON_ANIMS = { path: '/poketool/icongra/pl_poke_icon.narc', members: [3, 5] };

/**
 * The party/box icon animations as a sheet of the icon's two 32×32 frames (the species icon PNGs share
 * this layout; the sheet's own atlas is empty): POKEICON_ANIM_FAINTED, HP_MAX, HP_GREEN, HP_YELLOW,
 * HP_RED, STATUSED (pokemon_icon.h), id `platinum:ui2d/pokemon/icon_frames`.
 */
export function importIconFrames(fs: NitroFs, sheets: Sheets): void {
  const narc = readNarc(fs.file(ICON_ANIMS.path));
  const [a, b] = ICON_ANIMS.members.map((m) => JSON.stringify(readNanr(narc[m]!)));
  if (a !== b) throw new Error('pl_poke_icon: the 32K and 64K icon animations differ');
  const seqs = readNanr(narc[ICON_ANIMS.members[0]!]!);
  if (seqs.length !== 6) throw new Error(`pl_poke_icon: ${seqs.length} icon animations, expected 6`);
  const frame = () => ({ ...blankImage(32, 32), originX: 0, originY: 0 });
  sheets.add('pokemon/icon_frames', [frame(), frame()], { animations: animations(seqs) });
}

const ITEM_ICONS = { path: '/itemtool/itemdata/item_icon.narc', count: 711 };
/** sItemArchiveIDs entries: ITEM_NONE … NUM_ITEMS. */
export const ITEM_ARCHIVE_ENTRIES = 468;
const SIZE = 32;

/**
 * Item index → its icon PNG's pack path (`ui2d/items/<icon>-<palette>.png`), and the PNGs. `archive` is
 * sItemArchiveIDs (8 bytes per item).
 */
export function importItemIcons(fs: NitroFs, archive: Uint8Array): { icons: Map<number, string>; assets: Map<string, Uint8Array> } {
  const narc = readNarc(fs.file(ITEM_ICONS.path));
  if (narc.length !== ITEM_ICONS.count) throw new Error(`${ITEM_ICONS.path}: ${narc.length} members, expected ${ITEM_ICONS.count}`);
  if (archive.length !== ITEM_ARCHIVE_ENTRIES * 8) throw new Error(`item archive table: ${archive.length} bytes`);
  const dv = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const icons = new Map<number, string>();
  const assets = new Map<string, Uint8Array>();
  for (let item = 0; item < ITEM_ARCHIVE_ENTRIES; item++) {
    const iconId = dv.getUint16(item * 8 + 2, true);
    const paletteId = dv.getUint16(item * 8 + 4, true);
    const path = `ui2d/items/${iconId}-${paletteId}.png`;
    icons.set(item, path);
    if (assets.has(path)) continue;
    const c = readNcgrData(narc[iconId] ?? fail(`item ${item}: no icon member ${iconId}`));
    const tiles = charactersOf(c.data, c.bitDepth).tiles;
    if (c.bitDepth !== 4 || tiles.length !== 16) throw new Error(`item icon ${iconId}: ${tiles.length} characters at ${c.bitDepth} bpp, expected 16 at 4 bpp (32×32)`);
    const colors = readNclr(narc[paletteId] ?? fail(`item ${item}: no palette member ${paletteId}`)).colors;
    const indexes = new Uint8Array(SIZE * SIZE);
    tiles.forEach((t, k) => {
      for (let p = 0; p < 64; p++) indexes[((k >> 2) * 8 + (p >> 3)) * SIZE + (k & 3) * 8 + (p & 7)] = t[p]!;
    });
    const palette = new Uint8Array(64);
    for (let i = 1; i < 16; i++) palette.set([...rgb555(colors[i]!), 255], i * 4);
    assets.set(path, new IndexedPng({ width: SIZE, height: SIZE, indexes, palette }).encode());
  }
  return { icons, assets };
}

function fail(message: string): never {
  throw new Error(message);
}
