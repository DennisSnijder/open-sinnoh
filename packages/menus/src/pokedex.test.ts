import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppModel, type GameState, type PokedexEntryView, type PokedexListView, type PokedexMap, type PokedexSearchView, type SpeciesDex } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { areaLayers, createApp, PAINTED } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;
const MOSSLET = id('SPECIES_MOSSLET');
const MOSSGROVE = id('SPECIES_MOSSGROVE');
const EMBERKIT = id('SPECIES_EMBERKIT');
const DRIPLING = id('SPECIES_DRIPLING');
const SKYLET = id('SPECIES_SKYLET');
const BURROWBIT = id('SPECIES_BURROWBIT');

function fresh(seen: Id[], caught: Id[], national = false): GameState {
  const s = newGameState(record, registries, loaded.order, 1);
  s.pokedex = { obtained: true, national, seen: [...new Set([...seen, ...caught])], caught, forms: {} };
  return s;
}

const press = (app: AppModel, ...buttons: Button[]) => {
  for (const b of buttons) {
    app.step({ held: [b], pressed: [b], touch: null });
    for (let tick = 0; tick < 12; tick++) app.step({ held: [], pressed: [], touch: null });
  }
};
const tap = (app: AppModel, t: string) => app.step({ held: [], pressed: [], touch: null, tap: t });

/** The start menu with the Pokédex opened (its first entry). */
function openDex(state: GameState, options: Partial<typeof DEFAULT_DEVICE_OPTIONS> = {}): AppModel {
  const app = createApp({ app: 'start-menu' }, { registries, state, log: { stub: () => {} } as never, host: { options: () => ({ ...DEFAULT_DEVICE_OPTIONS, ...options }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK } });
  tap(app, 'entry:0');
  expect(app.view()).toMatchObject({ app: 'pokedex', screen: 'list' });
  return app;
}
const list = (app: AppModel) => app.view() as PokedexListView;
const entry = (app: AppModel) => app.view() as PokedexEntryView;

describe('Pokédex list (decomp ov21_021D5AEC.c, pokedex_sort.c)', () => {
  it('lists the regional order up to the highest seen species, gaps as blank rows, caught marked', () => {
    const app = openDex(fresh([DRIPLING], [MOSSLET]));
    const v = list(app);
    expect(v.national).toBe(false);
    expect(v.rows.map((r) => [r.number, r.species, r.caught])).toEqual([
      ['001', MOSSLET, true],
      ['002', null, false],
      ['003', null, false],
      ['004', DRIPLING, false],
    ]);
    expect(v.rows[1]!.name).toBe('- - -');
    expect(v.counts.map((c) => [c.label, c.value])).toEqual([
      ['SPOTTED', '2'],
      ['LOGGED', '1'],
    ]);
    expect(v.switchLabel).toBeNull();
  });

  it('scrolls by one, by five (left/right) and by a page (L/R), clamped at both ends', () => {
    const app = openDex(fresh([SKYLET], []));
    expect(list(app).rows).toHaveLength(5);
    press(app, 'up');
    expect(list(app).cursor).toBe(0);
    press(app, 'down', 'down');
    expect(list(app).cursor).toBe(2);
    press(app, 'right');
    expect(list(app).cursor).toBe(4);
    press(app, 'l');
    expect(list(app).cursor).toBe(0);
  });

  it('SELECT switches to the national order once unlocked, with that list\'s counts and numbers', () => {
    const state = fresh([BURROWBIT, DRIPLING], [MOSSLET], true);
    const app = openDex(state);
    // The national dex opens first once it is unlocked.
    expect(list(app).national).toBe(true);
    expect(list(app).rows.map((r) => [r.number, r.species])).toEqual([
      ['001', MOSSLET],
      ['002', null],
      ['003', DRIPLING],
      ['004', null],
      ['005', BURROWBIT],
    ]);
    expect(list(app).counts.map((c) => c.value)).toEqual(['3', '1']);
    expect(list(app).switchLabel).not.toBeNull();
    press(app, 'select');
    expect(list(app).national).toBe(false);
    // Burrowbit is not in the regional dex.
    expect(list(app).counts.map((c) => c.value)).toEqual(['2', '1']);
    tap(app, 'switch');
    expect(list(app).national).toBe(true);
  });

  it('remembers the mode and the species between openings', () => {
    const state = fresh([DRIPLING, MOSSLET], [], true);
    let app = openDex(state);
    press(app, 'select', 'down', 'down', 'down');
    expect(list(app).rows[list(app).cursor]!.species).toBe(DRIPLING);
    press(app, 'b');
    expect(app.view().app).toBe('start-menu');
    app = openDex(state);
    expect(list(app).national).toBe(false);
    expect(list(app).rows[list(app).cursor]!.species).toBe(DRIPLING);
  });
});

describe('Pokédex search (decomp pokedex_search.c)', () => {
  const state = () => fresh([EMBERKIT, SKYLET, BURROWBIT], [MOSSLET, MOSSGROVE, DRIPLING], true);
  const search = (app: AppModel) => app.view() as PokedexSearchView;

  it('A to Z keeps seen species; the weight and height orders keep caught ones only', () => {
    const app = openDex(state());
    press(app, 'x');
    expect(search(app).screen).toBe('search');
    tap(app, 'order:1');
    tap(app, 'ok');
    expect(list(app).rows.map((r) => r.species)).toEqual([BURROWBIT, DRIPLING, EMBERKIT, MOSSGROVE, MOSSLET, SKYLET]);
    expect(list(app).counts).toEqual([{ label: 'FOUND', value: '6' }]);
    expect(list(app).searchLabel).toBeNull();
    expect(list(app).switchLabel).toBeNull();
    // B leaves the results (CANCEL), keeping the species under the cursor.
    press(app, 'down', 'b');
    expect(list(app).rows).toHaveLength(6);
    expect(list(app).rows[list(app).cursor]!.species).toBe(DRIPLING);
    press(app, 'x');
    tap(app, 'order:2');
    tap(app, 'ok');
    expect(list(app).rows.map((r) => r.species)).toEqual([MOSSGROVE, MOSSLET, DRIPLING]);
    press(app, 'b', 'x');
    tap(app, 'order:5');
    tap(app, 'ok');
    expect(list(app).rows.map((r) => r.species)).toEqual([DRIPLING, MOSSLET, MOSSGROVE]);
  });

  it('filters by name initials, types (caught only) and body shape; keys pick rows and values', () => {
    const app = openDex(state());
    press(app, 'x', 'down', 'right', 'right', 'right', 'right', 'right');
    // NAME: MNO.
    expect(search(app).rows[1]!.value).toBe(5);
    expect(search(app).description).toBe('Only names starting\nwith these letters.');
    tap(app, 'ok');
    expect(list(app).rows.map((r) => r.species)).toEqual([MOSSLET, MOSSGROVE]);
    press(app, 'b', 'x');
    const ground = search(app).types.indexOf(id('TYPE_GROUND'));
    tap(app, `type1:${ground}`);
    // A type cannot fill both slots.
    tap(app, `type2:${ground}`);
    expect(search(app).rows[3]!.value).toBe(0);
    tap(app, 'ok');
    // Burrowbit is Ground but only seen.
    expect(list(app).rows.map((r) => r.species)).toEqual([MOSSGROVE]);
    press(app, 'b', 'x');
    tap(app, 'shape:6');
    press(app, 'down', 'down', 'down', 'down', 'down', 'a');
    expect(list(app).rows.map((r) => r.species)).toEqual([SKYLET]);
  });

  it('name search (OpenSinnoh option): a typed name in the NAME row; off, the row is the DS letter groups', () => {
    const ds = openDex(state());
    press(ds, 'x');
    expect(search(ds).rows[1]!.options).toHaveLength(10);
    const app = openDex(state(), { dexNameSearch: 0 });
    press(app, 'x');
    expect(search(app).rows[1]!.options.at(-1)).toBe('TYPED');
    // The tenth NAME option opens the keyboard; the typed text finds names containing it, any case.
    tap(app, 'name:10');
    expect(app.view()).toMatchObject({ app: 'naming', kind: 'dex-search', prompt: 'Look up?' });
    tap(app, 'type:moss');
    tap(app, 'ok');
    expect(search(app).rows[1]).toMatchObject({ value: 10 });
    expect(search(app).rows[1]!.options.at(-1)).toBe('moss');
    tap(app, 'ok');
    expect(list(app).rows.map((r) => r.species)).toEqual([MOSSLET, MOSSGROVE]);
    // A new search starts empty: A on the typed option opens the keyboard, and no name leaves the row at none.
    press(app, 'b', 'x', 'down', 'left', 'a');
    expect(app.view()).toMatchObject({ app: 'naming', kind: 'dex-search' });
    tap(app, 'ok');
    expect(search(app).rows[1]!.value).toBe(0);
  });

  it('says so when nothing matches and stays on the search', () => {
    const app = openDex(state());
    press(app, 'x');
    tap(app, 'name:9');
    tap(app, 'ok');
    expect(search(app)).toMatchObject({ screen: 'search', message: 'Nothing matched.' });
    press(app, 'b');
    expect(list(app).screen).toBe('list');
  });
});

describe('Pokédex entry (decomp infomain.c, ov21_021E29DC.c)', () => {
  it('a caught species shows its category, types, height, weight and description; every page opens', () => {
    const state = fresh([], [MOSSGROVE]);
    state.party.push(setupPokemon(state, registries, 0, MOSSGROVE, 20));
    const app = openDex(state);
    press(app, 'down', 'a');
    const v = entry(app);
    expect(v).toMatchObject({
      screen: 'entry',
      species: MOSSGROVE,
      number: '002',
      name: 'Mossgrove',
      caught: true,
      category: 'Grove kind',
      types: [id('TYPE_GRASS'), id('TYPE_GROUND')],
      height: { label: 'HT', value: '3 ft 3 in' },
      weight: { label: 'WT', value: '61.7 lb' },
      description: 'A small grove grows on its\nback. Birds rest there on\nlong journeys.',
    });
    // No area map in the fixture: the area page is off.
    expect(v.pages.map((p) => [p.id, p.enabled])).toEqual([
      ['info', true],
      ['area', false],
      ['cry', true],
      ['size', true],
      ['forms', true],
    ]);
    tap(app, 'page:3');
    expect(entry(app).size).toMatchObject({ title: 'Size Up', pokemon: { name: 'Mossgrove', height: '3 ft 3 in' }, trainer: { name: 'Ari', height: '4\'07"', gender: 'male', scale: 256, y: 9 } });
    press(app, 'r');
    expect(entry(app).page).toBe('forms');
    expect(entry(app).forms!.list.length).toBe(1);
    press(app, 'r');
    expect(entry(app).page).toBe('info');
    press(app, 'l', 'l', 'l');
    expect(entry(app).page).toBe('cry');
    expect(entry(app).cry).toBe('CALL');
  });

  it('the forms page lists the genders seen, first seen first (GameState v9); one picture per distinct sprite', () => {
    const s = fresh([], [MOSSGROVE]);
    s.pokedex.forms[MOSSGROVE] = [{ form: 0, gender: 'female' }, { form: 0, gender: 'male' }, { form: 0, gender: 'female' }];
    const app = openDex(s);
    press(app, 'down', 'a');
    expect(entry(app).species).toBe(MOSSGROVE);
    tap(app, 'page:4');
    // The fixture's Mossgrove has no female sprite: both genders show the same picture, under the first seen.
    expect(entry(app).forms!.list.map((f) => [f.form, f.female, f.label])).toEqual([[0, false, 'She']]);
    // Nothing recorded (seen by a script): one form, form 0.
    s.pokedex.forms = {};
    expect(entry(app).forms!.list.map((f) => [f.form, f.label])).toEqual([[0, 'Single look']]);
  });

  it('a seen-only species shows its name and picture with unknown texts; size and forms stay closed', () => {
    const app = openDex(fresh([EMBERKIT], [MOSSLET]));
    press(app, 'down', 'down', 'a');
    expect(entry(app)).toMatchObject({ species: EMBERKIT, caught: false, category: '????? kind', types: [], height: { value: '? ft ?? in' }, weight: { value: '???.? lb' }, description: '', footprint: null });
    tap(app, 'page:3');
    expect(entry(app).page).toBe('info');
    // Up and down step through the seen species of the list (gaps skipped), clamped.
    press(app, 'up');
    expect(entry(app).species).toBe(MOSSLET);
    press(app, 'up');
    expect(entry(app).species).toBe(MOSSLET);
    tap(app, 'next');
    expect(entry(app).species).toBe(EMBERKIT);
    // Back to the list on the species the entry ended on.
    press(app, 'b');
    expect(list(app).rows[list(app).cursor]!.species).toBe(EMBERKIT);
  });

  it('touch selects a row; a second tap opens only a seen row', () => {
    const app = openDex(fresh([DRIPLING], [MOSSLET]));
    tap(app, 'row:1');
    for (let tick = 0; tick < 5; tick++) app.step({ held: [], pressed: [], touch: null });
    tap(app, 'row:1');
    expect(list(app).cursor).toBe(1);
    tap(app, 'row:3');
    for (let tick = 0; tick < 5; tick++) app.step({ held: [], pressed: [], touch: null });
    expect(list(app).screen).toBe('list');
    tap(app, 'row:3');
    expect(entry(app).species).toBe(DRIPLING);
  });
});

describe('Pokédex area map (decomp ov21_021DC9BC.c, pokedex_field_map.c)', () => {
  const map: PokedexMap = {
    image: id('ui2d/map'),
    origin: [0, 0],
    dungeonOrigin: [0, 0],
    cell: 5,
    columns: 6,
    rows: 5,
    fields: [
      { x: 1, y: 1, width: 2, height: 1, cells: [1, 1] },
      { x: 4, y: 3, width: 1, height: 1, cells: [1] },
    ],
    dungeons: [
      { x: 0, y: 0, coronet: false },
      { x: 5, y: 4, coronet: true },
    ],
    hidden: [{ var: id('VAR_SPRING'), value: 0x312, overlay: id('ui2d/spring'), dungeons: [1] }],
  };
  const area = (day: number[], special: number[], dungeons: number[]): SpeciesDex['area'] => ({
    morning: { fields: [], dungeons: [] },
    day: { fields: day, dungeons },
    night: { fields: [], dungeons: [] },
    special: { fields: special, dungeons: [] },
    specialNational: { fields: [], dungeons: [] },
  });
  const dex = (a: SpeciesDex['area']) => ({ area: a }) as SpeciesDex;

  it('paints field cells and picks edge tiles from the painted neighbours', () => {
    const state = fresh([], []);
    const l = areaLayers(map, dex(area([0], [], [])), 1, state);
    const tiles = new Map(l.cells);
    // Row 1, columns 1–2 painted; the cell left of them sees one painted neighbour on its right.
    expect(tiles.get(1 * 6 + 1)).toBe(PAINTED);
    expect(tiles.get(1 * 6 + 2)).toBe(PAINTED);
    expect(tiles.get(1 * 6 + 0)).toBe(5);
    expect(tiles.get(1 * 6 + 3)).toBe(4);
    expect(tiles.get(0 * 6 + 1)).toBe(3);
    expect(tiles.get(2 * 6 + 2)).toBe(2);
    // A corner: only the diagonal is painted.
    expect(tiles.get(0 * 6 + 0)).toBe(20);
    expect(l.empty).toBe(false);
  });

  it('the special lists skip what the time of day shows; hidden dungeons wait for their var', () => {
    const state = fresh([], []);
    const l = areaLayers(map, dex(area([0], [0, 1], [0, 1])), 1, state);
    expect(l.specialCells.filter(([, t]) => t === PAINTED).map(([i]) => i)).toEqual([3 * 6 + 4]);
    expect(l.dungeons).toEqual([{ x: 0, y: 0, coronet: false, special: false }]);
    state.vars[id('VAR_SPRING')] = 0x312;
    const found = areaLayers(map, dex(area([0], [0, 1], [0, 1])), 1, state);
    expect(found.dungeons.map((d) => d.coronet)).toEqual([false, true]);
    expect(found.overlays).toEqual([id('ui2d/spring')]);
    expect(areaLayers(map, dex(area([], [], [])), 1, state).empty).toBe(true);
  });
});
