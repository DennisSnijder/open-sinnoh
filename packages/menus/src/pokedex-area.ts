/**
 * The Pokédex area page's map (decomp ov21_021DC9BC.c, pokedex_enc_data.c, pokedex_field_map.c): the
 * fields a species lives on paint cells of a grid, the cells around them get an edge tile chosen from
 * their painted neighbours, and dungeons are markers. Two layers: the time-of-day lists, then the special
 * lists (honey trees, the Great Marsh, the Poké Radar …) minus what the first layer shows.
 */
import type { DexArea, GameState, PokedexMap, SpeciesDex } from '@opensinnoh/contracts';

/** A painted cell is tile 1; empty cells next to painted ones get an edge tile 2–47 by their neighbours. */
export const PAINTED = 1;

/**
 * Neighbour bits of an empty cell (grid columns run across the screen, rows down): up 1, down 2, left 4,
 * right 8; the diagonals count only when both cardinals beside them are empty: up-left 16, up-right 32,
 * down-left 64, down-right 128. The edge tile of each mask, in tile order from 2 (decomp GetNeighborType).
 */
const EDGE_MASKS = [
  1, 2, 4, 8, 3, 5, 9, 6, 10, 12, 7, 11, 13, 14, 15, 16, 32, 64, 128, 48, 80, 144, 96, 160, 192, 112, 176, 208, 224, 240, 193, 50, 164, 88, 133, 73, 38, 26, 65, 129, 18, 34, 36,
  132, 24, 72,
];
const EDGE_TILE = new Map(EDGE_MASKS.map((m, i) => [m, i + 2]));

export interface AreaLayers {
  /** [grid index (row · columns + column), tile] per drawn cell. */
  cells: [number, number][];
  specialCells: [number, number][];
  dungeons: { x: number; y: number; coronet: boolean; special: boolean }[];
  /** Overlays of the hidden places found (ui2d sheet ids). */
  overlays: PokedexMap['hidden'][number]['overlay'][];
  empty: boolean;
}

/** Visible fields and dungeons of one list, without those in `skip`. */
function visible(list: DexArea, skipFields: Set<number>, skipDungeons: Set<number>): DexArea {
  return { fields: list.fields.filter((f) => !skipFields.has(f)), dungeons: list.dungeons.filter((d) => !skipDungeons.has(d)) };
}

function paint(map: PokedexMap, fields: number[]): [number, number][] {
  const { columns, rows } = map;
  const grid = new Uint8Array(columns * rows);
  for (const f of fields) {
    const field = map.fields[f];
    if (!field) throw new Error(`pokedex: area field ${f} of ${map.fields.length}`);
    field.cells.forEach((on, k) => {
      if (!on) return;
      const col = field.x + (k % field.width);
      const row = field.y + Math.floor(k / field.width);
      if (col >= columns || row >= rows) throw new Error(`pokedex: area field ${f} paints outside the ${columns}×${rows} grid`);
      grid[row * columns + col] = PAINTED;
    });
  }
  const at = (col: number, row: number) => col >= 0 && row >= 0 && col < columns && row < rows && grid[row * columns + col] === PAINTED;
  const out: [number, number][] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      if (at(col, row)) {
        out.push([row * columns + col, PAINTED]);
        continue;
      }
      const up = at(col, row - 1);
      const down = at(col, row + 1);
      const left = at(col - 1, row);
      const right = at(col + 1, row);
      let mask = (up ? 1 : 0) | (down ? 2 : 0) | (left ? 4 : 0) | (right ? 8 : 0);
      if (!up && !left && at(col - 1, row - 1)) mask |= 16;
      if (!up && !right && at(col + 1, row - 1)) mask |= 32;
      if (!down && !left && at(col - 1, row + 1)) mask |= 64;
      if (!down && !right && at(col + 1, row + 1)) mask |= 128;
      if (!mask) continue;
      const tile = EDGE_TILE.get(mask);
      if (tile === undefined) throw new Error(`pokedex: no edge tile for neighbour mask ${mask}`);
      out.push([row * columns + col, tile]);
    }
  return out;
}

/** The area layers for a species at a time of day (0 morning, 1 day, 2 night). */
export function areaLayers(map: PokedexMap, dex: SpeciesDex, time: number, state: GameState): AreaLayers {
  const found = map.hidden.filter((h) => (state.vars[h.var] ?? 0) === h.value);
  const hiddenDungeons = new Set(map.hidden.filter((h) => !found.includes(h)).flatMap((h) => h.dungeons));
  const timed = dex.area[(['morning', 'day', 'night'] as const)[time]!];
  const special = dex.area[state.pokedex.national ? 'specialNational' : 'special'];
  const normal = visible(timed, new Set(), hiddenDungeons);
  const extra = visible(special, new Set(normal.fields), new Set([...hiddenDungeons, ...normal.dungeons]));
  const marker = (d: number, isSpecial: boolean) => {
    const at = map.dungeons[d];
    if (!at) throw new Error(`pokedex: area dungeon ${d} of ${map.dungeons.length}`);
    return { x: at.x, y: at.y, coronet: at.coronet, special: isSpecial };
  };
  return {
    cells: paint(map, normal.fields),
    specialCells: paint(map, extra.fields),
    dungeons: [...normal.dungeons.map((d) => marker(d, false)), ...extra.dungeons.map((d) => marker(d, true))],
    overlays: found.map((h) => h.overlay),
    empty: !normal.fields.length && !normal.dungeons.length && !extra.fields.length && !extra.dungeons.length,
  };
}
