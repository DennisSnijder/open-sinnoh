/** The Battle Factory's rental app and the Battle Hall's type board (frontier.ts) on the fixture pack. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppHost, type AppModel, type FactoryView, type FrontierTables, type GameState, type HallBoardView, type NewGame, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loaded = loadGamePacks([pack]);
const TYPES = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'FLYING', 'GROUND'].map((n) => `fixture:TYPE_${n}` as Id);
/** The Hall's board grid only (the board reads `FrontierTables.hall.grid`); cell 19 the Matron's. */
const registries = (() => {
  const out = Object.fromEntries(Object.entries(loaded.registries).map(([k, m]) => [k, m instanceof Map ? new Map(m) : m])) as Record<string, Map<Id, unknown>>;
  const record = [...out.newGame!.values()][0] as NewGame;
  const frontier = { hall: { grid: [...TYPES, ...TYPES, ...TYPES.slice(0, 5), 'summary', 'summary', TYPES[0]!] } } as unknown as FrontierTables;
  out.newGame!.set(record.id, { ...record, frontier });
  return out as unknown as Registries;
})();
const record = [...registries.newGame.values()][0]!;
const SPECIES = ['MOSSLET', 'EMBERKIT', 'DRIPLING', 'SKYLET', 'BURROWBIT', 'MOSSGROVE'].map((n) => `fixture:SPECIES_${n}` as Id);

function fresh(): GameState {
  return newGameState(record, registries, loaded.loaded.order, 1);
}
function host(): AppHost {
  const options = { ...DEFAULT_DEVICE_OPTIONS };
  return { options: () => options, setOption: (k, v) => void (options[k] = v), save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
}
function press(app: AppModel, ...buttons: Button[]) {
  let result = null;
  for (const b of buttons) {
    result = app.step({ held: [b], pressed: [b], touch: null }) ?? result;
    result = app.step({ held: [], pressed: [], touch: null }) ?? result;
  }
  return result;
}
const wait = (app: AppModel, ticks: number) => {
  for (let i = 0; i < ticks; i++) app.step({ held: [], pressed: [], touch: null });
};
const tap = (app: AppModel, t: string) => app.step({ held: [], pressed: [], touch: null, tap: t });

describe('Battle Factory rental app', () => {
  const open = (s: GameState) => {
    const rentals = SPECIES.map((sp, i) => setupPokemon(s, registries, i, sp, 50));
    return createApp({ app: 'factory', mode: 'rent', rentals, count: 3 }, { registries, state: s, log: { stub: () => {} }, host: host() });
  };

  it('rides the balls in, then picks three in order (B takes the last back) and confirms them', () => {
    const app = open(fresh());
    const first = app.view() as FactoryView;
    expect(first.stage).toBe('message');
    expect(first.balls[0]!.x).toBeGreaterThan(24);
    wait(app, 20);
    let v = app.view() as FactoryView;
    expect(v.stage).toBe('pick');
    expect(v.balls.map((b) => b.x)).toEqual([24, 64, 104, 144, 184, 224]);
    expect(v.mons[0]).toMatchObject({ species: SPECIES[0], x: 120, y: 43 });
    // Ball 2: A, then RENT.
    press(app, 'right', 'right', 'a');
    expect((app.view() as FactoryView).stage).toBe('menu');
    press(app, 'down', 'a');
    v = app.view() as FactoryView;
    expect(v.balls[2]!.picked).toBe(true);
    // B takes it back; then 0, 4, 5 by taps.
    press(app, 'b');
    expect((app.view() as FactoryView).balls.some((b) => b.picked)).toBe(false);
    for (const ball of [0, 4, 5]) {
      tap(app, `ball:${ball}`);
      tap(app, 'entry:1');
    }
    v = app.view() as FactoryView;
    expect(v.stage).toBe('confirm');
    expect(v.panel).toBe('summary');
    expect(v.mons.map((m) => m.x)).toEqual([44, 128, 212]);
    // NO takes the last back; RENT it again, YES.
    expect(tap(app, 'entry:1')).toBeNull();
    expect((app.view() as FactoryView).balls.filter((b) => b.picked)).toHaveLength(2);
    tap(app, 'ball:5');
    tap(app, 'entry:1');
    expect(tap(app, 'entry:0')).toEqual({ app: 'factory', picks: [0, 4, 5] });
  });

  it('trades: the player’s ball to give, the trainer’s to take, YES; CANCEL asks to skip the trade', () => {
    const s = fresh();
    const rentals = SPECIES.slice(0, 3).map((sp, i) => setupPokemon(s, registries, i, sp, 50));
    const offers = SPECIES.slice(3).map((sp, i) => setupPokemon(s, registries, i, sp, 50));
    const deps = { registries, state: s, log: { stub: () => {} }, host: host() };
    let app = createApp({ app: 'factory', mode: 'swap', rentals, offers }, deps);
    wait(app, 20);
    expect((app.view() as FactoryView).balls.map((b) => b.x)).toEqual([64, 120, 176]);
    tap(app, 'ball:1');
    tap(app, 'entry:1');
    const v = app.view() as FactoryView;
    expect(v.stage).toBe('receive');
    expect(v.mons[0]!.species).toBe(SPECIES[3]);
    tap(app, 'ball:2');
    tap(app, 'entry:1');
    expect(tap(app, 'entry:0')).toEqual({ app: 'factory', swap: [1, 2] });
    app = createApp({ app: 'factory', mode: 'swap', rentals, offers }, deps);
    wait(app, 20);
    tap(app, 'entry:0');
    expect((app.view() as FactoryView).stage).toBe('confirm');
    expect(tap(app, 'entry:0')).toEqual({ app: 'factory', swap: null });
  });
});

describe('Battle Hall type board', () => {
  const open = (s: GameState, o: { ranks?: number[]; streak?: number } = {}) => {
    const party = [setupPokemon(s, registries, 0, SPECIES[0]!, 50)];
    return createApp({ app: 'hall-board', challengeType: 0, ranks: o.ranks ?? Array(18).fill(0), streak: o.streak ?? 0, party, cursor: 0 }, { registries, state: s, log: { stub: () => {} }, host: host() });
  };

  it('shows each type’s rank, moves the cursor round the grid and confirms a pick with YES', () => {
    const ranks = Array(18).fill(0);
    ranks[1] = 10;
    const app = open(fresh(), { ranks });
    let v = app.view() as HallBoardView;
    expect(v.cells).toHaveLength(20);
    expect(v.cells[0]).toMatchObject({ rank: 1, state: 'normal' });
    expect(v.cells[1]).toMatchObject({ rank: 10, state: 'unselectable' });
    expect(v.cells[17]!.rank).toBeNull();
    expect(v.cells[19]!.state).toBe('unselectable');
    // Rank 10 is refused; up from the top row wraps to the bottom.
    press(app, 'right', 'a');
    expect((app.view() as HallBoardView).yesNo).toBeNull();
    press(app, 'up');
    expect((app.view() as HallBoardView).cursor).toBe(17);
    press(app, 'down', 'left', 'a');
    wait(app, 5);
    v = app.view() as HallBoardView;
    expect(v.cursor).toBe(0);
    expect(v.cells[0]!.state).toBe('selected');
    expect(v.yesNo).not.toBeNull();
    expect(press(app, 'a')).toEqual({ app: 'hall-board', cell: 0 });
  });

  it('at the 50th battle the Matron comes after a YES: only ??? can be picked, the earlier cell is the result', () => {
    const app = open(fresh(), { streak: 50 });
    tap(app, 'cell:2');
    wait(app, 5);
    press(app, 'a');
    const v = app.view() as HallBoardView;
    expect(v.message).not.toBeNull();
    for (let i = 0; i < 10 && (app.view() as HallBoardView).message; i++) press(app, 'a');
    const after = app.view() as HallBoardView;
    expect(after.cursor).toBe(19);
    expect(after.cells.slice(0, 17).every((c) => c.state === 'unselectable')).toBe(true);
    tap(app, 'cell:3');
    expect((app.view() as HallBoardView).yesNo).toBeNull();
    tap(app, 'cell:19');
    wait(app, 5);
    expect(tap(app, 'entry:0')).toEqual({ app: 'hall-board', cell: 2 });
  });
});
