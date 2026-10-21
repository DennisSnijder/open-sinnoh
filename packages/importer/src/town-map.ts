/**
 * The Town Map's fly mode data (decomp applications/town_map, src/spawn_locations.c) and the fly destinations, read
 * from the ROM: sFlyLocations (overlay 80), sTownMapFlyLocationUnlockFlags and sSpawnLocations (arm9), and
 * /data/tmap_block.dat (u32 count, then per block 11 u16: x, z, signpost type, signpost member, area and landmark
 * description texts and their positions, hidden-location bits). The art is ui2d/town-map.ts.
 */
import type { NewGame, TownMap } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { Reader, type NitroFs } from '@opensinnoh/nds';
import type { HiddenPatch } from './ui2d/town-map.ts';

/** Decomp enum TownMapSpecialFlyLocation: REGULAR, PAL_PARK, VICTORY_ROAD, POKEMON_LEAGUE; the cell each special one is picked on (TownMap_GetFlyLocationAtPos). */
const SPECIAL_CELLS: Record<number, [number, number] | undefined> = { 1: [9, 28], 2: [26, 18], 3: [26, 17] };
/** Decomp TOWN_MAP_GRID_SPACING: a cell's size on the map, which the descriptors' sprite positions are given in. */
const GRID = 7;
/** Decomp LoadMapName's notOnMainMatrix: cells off the main matrix that still show a name. */
const NOT_ON_MAIN_MATRIX: [number, number, string][] = [
  ...[19, 20, 21, 22].map((z): [number, number, string] => [11, z, 'MAP_HEADER_MT_CORONET_1F_SOUTH']),
  ...[12, 13, 14, 15, 16, 17, 18, 19].map((z): [number, number, string] => [12, z, 'MAP_HEADER_MT_CORONET_1F_SOUTH']),
  [20, 12, 'MAP_HEADER_BATTLE_FRONTIER_GATE_TO_FIGHT_AREA'],
];
/** sSpawnLocations rows: blackout map, x, z, fly map, x, z, isWarpPos, unlockOnMapEntry, firstArrival (16 bytes). */
const SPAWN_SIZE = 16;
const BLOCK_SIZE = 24;

export interface TownMapDeps {
  zone(index: number): Id;
  zoneByName(name: string): Id;
  /** The FIRST_ARRIVAL_* flag of number n. */
  firstArrival(n: number): Id;
  matrix: Id;
  flyToWhere: Id;
  /** Pokédex HIDDEN_LOCATIONS by var name. */
  hiddenVar(name: string): { var: Id; value: number };
}

/** sSpawnLocations' fly destinations by spawn id − 1 (Location_InitFly). */
export function flyDestinations(spawns: Uint8Array, zone: (index: number) => Id): NonNullable<NewGame['flyDestinations']> {
  const r = new Reader(spawns);
  return Array.from({ length: spawns.length / SPAWN_SIZE }, (_, i) => ({ zone: zone(r.u16(i * SPAWN_SIZE + 6)), x: r.u16(i * SPAWN_SIZE + 8), z: r.u16(i * SPAWN_SIZE + 10) }));
}

/** Decomp GetSpawnIdByMapAndCoords for the cell (cx, cz): the spawn on that fly map in the cell, else its last one. */
function spawnFor(spawns: Uint8Array, mapHeader: number, cx: number, cz: number): number {
  const r = new Reader(spawns);
  let found = 0;
  for (let i = 0; i < spawns.length / SPAWN_SIZE; i++) {
    if (r.u16(i * SPAWN_SIZE + 6) !== mapHeader) continue;
    found = i + 1;
    if (Math.trunc(r.u16(i * SPAWN_SIZE + 8) / 32) === cx && Math.trunc(r.u16(i * SPAWN_SIZE + 10) / 32) === cz) return found;
  }
  return found;
}

export function readTownMap(fs: NitroFs, tables: { flyLocations: Uint8Array; flyUnlockFlags: Uint8Array; spawns: Uint8Array }, patches: HiddenPatch[], d: TownMapDeps): TownMap {
  const blocks = new Reader(fs.file('/data/tmap_block.dat'));
  const count = blocks.u32(0);
  if (4 + count * BLOCK_SIZE !== blocks.bytes.length) throw new Error(`tmap_block.dat: ${count} blocks in ${blocks.bytes.length} bytes`);
  const cells = Array.from({ length: count }, (_, i) => {
    const o = 4 + i * BLOCK_SIZE;
    return { x: blocks.u16(o), z: blocks.u16(o + 2), hidden: blocks.u16(o + 20) };
  });
  const loc = new Reader(tables.flyLocations);
  const locations = Array.from({ length: tables.flyUnlockFlags.length }, (_, i): TownMap['locations'][number] => {
    const o = i * 20;
    const header = loc.u32(o);
    const shape = loc.u8(o + 8);
    const palette = loc.u8(o + 9);
    const special = loc.u16(o + 10);
    if (palette > 1 || shape > 6 || special > 3) throw new Error(`sFlyLocations ${i}: shape ${shape}, palette ${palette}, special ${special}`);
    const cell = SPECIAL_CELLS[special];
    const sprite: [number, number] = [loc.u32(o + 12), loc.u32(o + 16)];
    // The block's own cell, for the destination: a special one's, else the cell its sprite position names.
    const [cx, cz] = cell ?? [Math.trunc(sprite[0] / GRID), Math.trunc(sprite[1] / GRID)];
    const spawn = spawnFor(tables.spawns, header, cx, cz);
    if (!spawn) throw new Error(`sFlyLocations ${i}: no spawn location flies to map header ${header}`);
    return { zone: d.zone(header), flag: d.firstArrival(tables.flyUnlockFlags[i]!), shape, palette: palette as 0 | 1, sprite, ...(cell ? { cell } : {}), spawn };
  });
  const hiddenVars = ['VAR_HIDDEN_LOCATION_FULL_MOON_ISLAND', 'VAR_HIDDEN_LOCATION_NEW_MOON_ISLAND', 'VAR_HIDDEN_LOCATION_SPRING_PATH', 'VAR_HIDDEN_LOCATION_SEABREAK_PATH'];
  return {
    screen: asId('platinum:ui2d/town_map/screen'),
    cursor: asId('platinum:ui2d/town_map/cursor'),
    player: { male: asId('platinum:ui2d/town_map/player_male'), female: asId('platinum:ui2d/town_map/player_female') },
    blocks: [5, 6, 7, 8, 9].map((p) => asId(`platinum:ui2d/town_map/blocks_${p}`)),
    matrix: d.matrix,
    everywhere: d.zoneByName('MAP_HEADER_EVERYWHERE'),
    names: NOT_ON_MAIN_MATRIX.map(([x, z, name]) => ({ x, z, zone: d.zoneByName(name) })),
    cells,
    hidden: hiddenVars.map((name, i) => ({ ...d.hiddenVar(name), patch: asId(`platinum:ui2d/town_map/hidden_${i}`), ...patches[i]! })),
    flyToWhere: d.flyToWhere,
    locations,
  };
}
