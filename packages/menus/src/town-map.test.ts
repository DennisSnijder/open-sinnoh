/**
 * The Town Map's fly targets and its cursor (decomp applications/town_map), on the fixture with a made-up 30×30 main
 * matrix: Town at (4, 23)–(5, 24) (a 2×2 city), Route West at (6, 23), Terrain at (9, 23); the fly locations Town
 * (unlocked) and Terrain (locked), and a League-like location on one cell of Route West's zone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, type AppHost, type GameState, type InputFrame, type Matrix, type Registries, type TownMap, type TownMapView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { menuContext } from './context.ts';
import { AppStack, type Step } from './stack.ts';
import { cellPosition, flyLocationAt, foundHidden, locationCell, namedCell, startCell, townMapScreen, unlockedLocations } from './town-map.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loaded = loadGamePacks([pack]);
const id = (s: string) => `fixture:${s}` as Id;
const TOWN = id('TOWN');
const ROUTE = id('ROUTE_W');
const TERRAIN = id('TERRAIN');
const [FLAG_TOWN, FLAG_TERRAIN, FLAG_LEAGUE] = [...loaded.registries.flags.keys()];

const matrix: Matrix = { id: id('MATRIX_MAIN'), width: 30, height: 30, chunks: Array<null>(900).fill(null), zones: Array<Id | null>(900).fill(null) };
for (const [x, z, zone] of [[4, 23, TOWN], [5, 23, TOWN], [4, 24, TOWN], [5, 24, TOWN], [6, 23, ROUTE], [6, 22, ROUTE], [9, 23, TERRAIN]] as const) matrix.zones![x + z * 30] = zone;
const sheet = [...loaded.registries.ui2d.keys()][0]!;
const map: TownMap = {
  screen: sheet,
  cursor: sheet,
  player: { male: sheet, female: sheet },
  blocks: [sheet, sheet, sheet, sheet, sheet],
  matrix: matrix.id,
  everywhere: id('ROOM'),
  names: [{ x: 7, z: 23, zone: id('GROTTO') }],
  cells: [{ x: 4, z: 23, hidden: 0 }, { x: 5, z: 24, hidden: 0 }, { x: 6, z: 23, hidden: 0 }, { x: 6, z: 22, hidden: 0 }, { x: 7, z: 23, hidden: 0 }, { x: 8, z: 23, hidden: 2 }, { x: 9, z: 23, hidden: 0 }],
  hidden: [{ var: id('VAR_SCENE'), value: 7, patch: sheet, x: 0, y: 0 }, { var: id('VAR_ROOM_INTRO'), value: 3, patch: sheet, x: 8, y: 8 }],
  flyToWhere: [...loaded.registries.texts.values()].find((t) => !t.text.includes('{'))!.id,
  locations: [
    { zone: TOWN, flag: FLAG_TOWN!, shape: 2, palette: 1, sprite: [4 * 7 + 3, 23 * 7 + 3], spawn: 1 },
    { zone: TERRAIN, flag: FLAG_TERRAIN!, shape: 0, palette: 0, sprite: [9 * 7, 23 * 7], spawn: 2 },
    { zone: ROUTE, flag: FLAG_LEAGUE!, shape: 6, palette: 1, sprite: [6 * 7, 22 * 7], cell: [6, 22], spawn: 3 },
  ],
};
const record = [...loaded.registries.newGame.values()][0]!;
const registries: Registries = { ...loaded.registries, matrices: new Map([...loaded.registries.matrices, [matrix.id, matrix]]), newGame: new Map([[record.id, { ...record, townMap: map }]]) };

function fresh(): GameState {
  const s = newGameState(record, registries, loaded.loaded.order, 1);
  s.player = { zone: TERRAIN, x: 0, z: 0, y: 0, facing: 'down' };
  return s;
}

describe('the fly targets (sFlyLocations, sTownMapFlyLocationUnlockFlags)', () => {
  it('a location is selectable once its first-arrival flag is set', () => {
    const s = fresh();
    expect(unlockedLocations(registries, s, map)).toEqual([false, false, false]);
    s.flags[FLAG_TOWN!] = true;
    expect(unlockedLocations(registries, s, map)).toEqual([true, false, false]);
  });

  it("TownMap_GetFlyLocationAtPos: any cell of the location's zone, a special location only on its own cell", () => {
    expect(flyLocationAt(map, TOWN, 4, 23)).toBe(0);
    expect(flyLocationAt(map, TOWN, 5, 24)).toBe(0);
    expect(flyLocationAt(map, TERRAIN, 9, 23)).toBe(1);
    expect(flyLocationAt(map, ROUTE, 6, 22)).toBe(2);
    expect(flyLocationAt(map, ROUTE, 6, 23)).toBeNull();
    expect(flyLocationAt(map, null, 1, 1)).toBeNull();
    expect(locationCell(map, 0)).toEqual([4, 23]);
    expect(locationCell(map, 2)).toEqual([6, 22]);
  });

  it('names show on tmap_block cells, a hidden one only once its place is found', () => {
    const s = fresh();
    expect(foundHidden(registries, s, map)).toBe(0);
    expect(namedCell(map, 0, 8, 23)).toBe(false);
    s.vars[id('VAR_ROOM_INTRO')] = 3;
    expect(foundHidden(registries, s, map)).toBe(2);
    expect(namedCell(map, 2, 8, 23)).toBe(true);
    expect(namedCell(map, 0, 3, 3)).toBe(false);
  });

  it("the cursor starts on the player's cell on the main matrix, else the exit location, else (3, 27)", () => {
    const s = fresh();
    expect(startCell(registries, s, map)).toEqual([3, 27]);
    s.escapeLocation = { zone: TOWN, x: 6 * 32 + 5, z: 22 * 32 + 31, facing: 'down' };
    expect(startCell(registries, s, map)).toEqual([6, 22]);
    expect(cellPosition(6, 22)).toEqual({ x: 67, y: 120 });
  });
});

describe('the Town Map screen (TOWN_MAP_MODE_FLY)', () => {
  const host = (): AppHost => {
    const options = { ...DEFAULT_DEVICE_OPTIONS };
    return { options: () => options, setOption: () => {}, save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  };
  const open = (s: GameState) => {
    const picked: (number | 'cancel')[] = [];
    const ctx = menuContext({ registries, state: s, log: { stub: () => {} }, host: host() });
    const pick = (i: number): Step => (picked.push(i), { close: { app: 'start-menu' } });
    const app = new AppStack(townMapScreen(ctx, pick, () => (picked.push('cancel'), 'pop')), { app: 'start-menu' });
    return { app, picked, view: () => app.view() as TownMapView };
  };
  const frame = (f: Partial<InputFrame> = {}): InputFrame => ({ held: [], pressed: [], touch: null, ...f });
  const run = (app: AppStack, n: number, f: Partial<InputFrame> = {}) => {
    let r = null;
    for (let i = 0; i < n; i++) r = app.step(frame(f)) ?? r;
    return r;
  };
  /** The player on Terrain's cell (9, 23). */
  const atTerrain = () => {
    const s = fresh();
    s.escapeLocation = { zone: TERRAIN, x: 9 * 32 + 16, z: 23 * 32 + 16, facing: 'down' };
    s.flags[FLAG_TOWN!] = true;
    return s;
  };

  it('opens black, wipes in, then shows the player, the cursor, the blocks and the name', () => {
    const { app, view } = open(atTerrain());
    expect(view()).toMatchObject({ app: 'town-map', fade: 16, cursor: cellPosition(9, 23), player: cellPosition(9, 23), name: registries.zones.get(TERRAIN)!.name });
    run(app, 5 + 6);
    expect(view().fade).toBe(0);
    // Locked Terrain shows palette 5 (blue), unlocked Town 7 (red); the locked one-cell location is not drawn.
    expect(view().blocks.map((b) => [b.location, b.palette, b.unlocked])).toEqual([[0, 7, true], [1, 5, false]]);
  });

  it('a held d-pad moves the cursor a cell every three frames, within the bounds; the name follows', () => {
    const { app, view } = open(atTerrain());
    run(app, 11);
    run(app, 1, { held: ['left'], pressed: ['left'] });
    expect(view().cursor).toEqual(cellPosition(8, 23));
    run(app, 2, { held: ['left'] });
    expect(view().cursor).toEqual(cellPosition(8, 23));
    run(app, 1, { held: ['left'] });
    expect(view().cursor).toEqual(cellPosition(7, 23));
    expect(view().name).toBe(registries.zones.get(id('GROTTO'))!.name);
    run(app, 3, { held: ['left'] });
    expect(view().cursor).toEqual(cellPosition(6, 23));
    expect(view().name).toBe(registries.zones.get(ROUTE)!.name);
    run(app, 60, { held: ['up', 'left'] });
    expect(view().cursor).toEqual(cellPosition(1, 6));
  });

  it('A on a locked location does nothing; on an unlocked one it wipes out and picks it; B cancels', () => {
    const { app, view, picked } = open(atTerrain());
    run(app, 11);
    run(app, 1, { pressed: ['a'] });
    expect(view().fade).toBe(0);
    for (let i = 0; i < 5; i++) run(app, 3, { held: ['left'] });
    run(app, 1);
    expect(view().cursor).toEqual(cellPosition(4, 23));
    // The hovered block blinks (palette 8 + its colour) once the d-pad is let go.
    expect(view().blocks[0]!.palette).toBe(9);
    run(app, 16);
    expect(view().blocks[0]!.palette).toBe(7);
    expect(run(app, 1, { pressed: ['a'] })).toBeNull();
    expect(picked).toEqual([]);
    expect(run(app, 8)).toEqual({ app: 'start-menu' });
    expect(picked).toEqual([0]);
    const b = open(atTerrain());
    run(b.app, 11);
    run(b.app, 1, { pressed: ['b'] });
    run(b.app, 8);
    expect(b.picked).toEqual(['cancel']);
  });

  it('a tap on an unlocked block moves the cursor there and picks it; locked ones ignore taps', () => {
    const { app, view, picked } = open(atTerrain());
    run(app, 11);
    run(app, 1, { tap: 'town:1' });
    expect(view().fade).toBe(0);
    run(app, 1, { tap: 'town:0' });
    expect(view().cursor).toEqual(cellPosition(4, 23));
    run(app, 8);
    expect(picked).toEqual([0]);
  });
});
