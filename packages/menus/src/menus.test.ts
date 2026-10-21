import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppHost, type AppModel, type BagView, type GameState, type MartView, type StartMenuView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { buy, martStock, maxBuy, maxSell, sell, sellPrice } from '@opensinnoh/services';
import { createApp, MenuText, moveCursor, plainPages, REPEAT_DELAY } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;

function fresh(): GameState {
  return newGameState(record, registries, loaded.order, 1);
}

function host(saves: GameState[] = [], state?: GameState): AppHost {
  const options = { ...DEFAULT_DEVICE_OPTIONS };
  return { options: () => options, setOption: (k, v) => void (options[k] = v), save: () => void saves.push(structuredClone(state!)), fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
}

/** Presses a button for one tick (down, then up). */
function press(app: AppModel, ...buttons: Button[]) {
  let result = null;
  for (const b of buttons) {
    result = app.step({ held: [b], pressed: [b], touch: null }) ?? result;
    result = app.step({ held: [], pressed: [], touch: null }) ?? result;
  }
  return result;
}
const tap = (app: AppModel, t: string) => app.step({ held: [], pressed: [], touch: null, tap: t });

describe('mart rules (services; decomp shop_menu.c, bag sell mode)', () => {
  const mart = registries.marts.get(id('MART_COMMON'))!;
  it('the common stock grows with badges (minBadges)', () => {
    expect(martStock(mart, 0)).toEqual([id('ITEM_CAPTURE_ORB'), id('ITEM_TONIC')]);
    expect(martStock(mart, 1)).toEqual([id('ITEM_CAPTURE_ORB'), id('ITEM_TONIC'), id('ITEM_LAMP_OIL')]);
  });

  it('buys at price × count, refuses without money, adds the bonus ball for 10 balls, counts purchases', () => {
    const s = fresh();
    s.money = 2100;
    expect(maxBuy(s, registries, id('ITEM_CAPTURE_ORB'))).toBe(10);
    expect(buy(s, registries, id('ITEM_CAPTURE_ORB'), 11, null)).toEqual({ ok: false, reason: 'money' });
    expect(buy(s, registries, id('ITEM_CAPTURE_ORB'), 10, id('VAR_SCENE'))).toEqual({ ok: true, premierBall: true });
    expect(s.money).toBe(100);
    expect(s.bag.balls).toEqual([
      { item: id('ITEM_CAPTURE_ORB'), count: 10 },
      { item: id('ITEM_BONUS_ORB'), count: 1 },
    ]);
    expect(s.vars[id('VAR_SCENE')]).toBe(1);
    s.money = 30000;
    expect(maxBuy(s, registries, id('ITEM_CAPTURE_ORB'))).toBe(99);
    expect(buy(s, registries, id('ITEM_TONIC'), 9, null)).toEqual({ ok: true, premierBall: false });
  });

  it('sells for half, at most 99 at once; key items are refused', () => {
    const s = fresh();
    s.bag.items = [{ item: id('ITEM_LAMP_OIL'), count: 150 }];
    expect(sellPrice(registries, id('ITEM_LAMP_OIL'))).toBe(50);
    expect(maxSell(s, id('ITEM_LAMP_OIL'))).toBe(99);
    sell(s, registries, id('ITEM_LAMP_OIL'), 99);
    expect(s.money).toBe(3000 + 99 * 50);
    expect(s.bag.items).toEqual([{ item: id('ITEM_LAMP_OIL'), count: 51 }]);
    s.bag.key_items = [{ item: id('ITEM_TOWN_GUIDE'), count: 1 }];
    expect(() => sell(s, registries, id('ITEM_TOWN_GUIDE'), 1)).toThrow(/cannot be sold/);
  });
});

describe('mart app (headless model)', () => {
  const open = (s: GameState) => createApp({ app: 'mart', mart: id('MART_COMMON'), countVar: null, greeting: 'Hi!' }, { registries, state: s, log: { stub: () => {} }, host: host() });
  const view = (a: AppModel) => a.view() as MartView;

  it('buys with the quantity window (up/down wrap, right/left ±10) and closes with SEE YA!', () => {
    const s = fresh();
    const app = open(s);
    expect(view(app)).toMatchObject({ mode: 'menu', menuCursor: 0, message: { text: 'Hi!', waiting: false } });
    press(app, 'a');
    expect(view(app).rows.map((r) => r.label)).toEqual(['Capture Orb', 'Tonic']);
    expect(view(app).item).toMatchObject({ id: id('ITEM_CAPTURE_ORB'), description: 'A glass orb that holds a\nwild companion.' });
    press(app, 'a');
    expect(view(app).quantity).toEqual({ count: 'x01', total: '200c', inBag: 'Carried: 0' });
    press(app, 'down');
    expect(view(app).quantity!.count).toBe('x15');
    press(app, 'left', 'left');
    expect(view(app).quantity!.count).toBe('x01');
    press(app, 'right', 'up', 'up');
    expect(view(app).quantity!.count).toBe('x13');
    press(app, 'down', 'down', 'down', 'a');
    expect(view(app).yesNo).toMatchObject({ cursor: 0 });
    expect(view(app).message!.text).toBe('Capture Orb, 10 of them.\nThat comes to 2000c. Fine?');
    press(app, 'a');
    expect(s.money).toBe(1000);
    expect(view(app).message).toEqual({ text: 'There you go!', waiting: true });
    press(app, 'a');
    expect(view(app).message!.text).toBe('You stowed the Capture Orbs\nin the ORBS pouch.');
    press(app, 'a');
    expect(view(app).message!.text).toBe('Take a Bonus Orb\nwith that, too.');
    press(app, 'a', 'b');
    expect(view(app)).toMatchObject({ mode: 'menu', message: { text: 'Anything else\nfor you today?' } });
    press(app, 'down', 'down', 'a');
    expect(view(app)).toMatchObject({ mode: 'exit', message: { text: 'Thanks, see you soon!', waiting: true } });
    expect(press(app, 'a')).toEqual({ app: 'mart' });
  });

  it('shows the stock for the badge count when it opens', () => {
    const s = fresh();
    s.badges.push(id('BADGE_1'));
    const app = open(s);
    tap(app, 'menu:0');
    expect(view(app).rows.map((r) => r.item)).toEqual([id('ITEM_CAPTURE_ORB'), id('ITEM_TONIC'), id('ITEM_LAMP_OIL')]);
  });
});

describe('start menu app', () => {
  it('lists the DS entries by state, remembers the cursor, opens the bag and closes on B/X', () => {
    const s = fresh();
    const deps = { registries, state: s, log: { stub: () => {} }, host: host() };
    let app = createApp({ app: 'start-menu' }, deps);
    const entries = () => (app.view() as StartMenuView).entries.map((e) => e.id);
    expect(entries()).toEqual(['bag', 'trainer', 'save', 'options', 'exit']);
    expect((app.view() as StartMenuView).cursor).toBe(0);
    press(app, 'down');
    expect(press(app, 'x')).toEqual({ app: 'start-menu' });
    s.party.push(setupPokemon(s, registries, 0, id('SPECIES_EMBERKIT'), 5));
    s.pokedex.obtained = true;
    app = createApp({ app: 'start-menu' }, deps);
    expect(entries()).toEqual(['pokedex', 'pokemon', 'bag', 'trainer', 'save', 'options', 'exit']);
    expect((app.view() as StartMenuView).cursor).toBe(3);
    s.bag.medicine = [{ item: id('ITEM_TONIC'), count: 2 }];
    tap(app, 'entry:2');
    expect(app.view().app).toBe('bag');
    press(app, 'right');
    expect((app.view() as BagView).rows).toEqual([{ item: id('ITEM_TONIC'), label: 'Tonic', count: 'x2', registered: false }]);
    expect((app.view() as BagView).description).toBe('A bitter tonic that restores\n20 HP of one companion.');
    press(app, 'b');
    expect(app.view().app).toBe('start-menu');
    expect(press(app, 'b')).toEqual({ app: 'start-menu' });
  });

  it('SAVE asks, saves through the host and closes the menu', () => {
    const s = fresh();
    const saves: GameState[] = [];
    const app = createApp({ app: 'start-menu' }, { registries, state: s, log: { stub: () => {} }, host: host(saves, s) });
    tap(app, 'entry:2');
    expect(app.view()).toMatchObject({ app: 'save', phase: 'ask' });
    press(app, 'a');
    expect(app.view()).toMatchObject({ app: 'save', phase: 'done', message: 'Ari wrote the record.' });
    expect(saves).toHaveLength(1);
    expect(press(app, 'a')).toEqual({ app: 'start-menu' });
  });

  it('auto-repeats a held d-pad (8 ticks, then every 3)', () => {
    const s = fresh();
    const app = createApp({ app: 'start-menu' }, { registries, state: s, log: { stub: () => {} }, host: host() });
    app.step({ held: ['down'], pressed: ['down'], touch: null });
    for (let i = 0; i < REPEAT_DELAY; i++) app.step({ held: ['down'], pressed: [], touch: null });
    expect((app.view() as StartMenuView).cursor).toBe(2);
  });
});

describe('menu strings', () => {
  it('fail loudly when the pack lacks a label, and split pages on {clear}', () => {
    const partial = new Map([...registries.texts].filter(([k]) => k !== id('pl_msg_00000543_00015')));
    expect(() => new MenuText({ texts: partial, newGame: registries.newGame })).toThrow(/fixture:pl_msg_00000543_00015/);
    expect(plainPages('A{clear}B\n{var 0}', ['{x}'])).toEqual(['A', 'B\n{x}']);
    expect(moveCursor(6, 7, 2, 'up')).toBe(4);
  });
});
