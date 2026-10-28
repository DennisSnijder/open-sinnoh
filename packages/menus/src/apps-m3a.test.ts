/**
 * The menu models on the fixture pack: the party (context menu, switch, items, field moves), the
 * summary, bag use (party items, TM teaching with the forget flow, Repel, toss, register), the PC boxes, the naming screen, the trainer card and the Pokédex.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import {
  decodeSignature,
  DEFAULT_DEVICE_OPTIONS,
  setupPokemon,
  type AppHost,
  type AppModel,
  type AppRequest,
  type BagView,
  type GameState,
  type ItemWheelView,
  type NamingView,
  type PartyView,
  type StorageView,
  type SummaryView,
  type TrainerCardView,
} from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;

function fresh(): GameState {
  const s = newGameState(record, registries, loaded.order, 1);
  s.party.push(setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 12), setupPokemon(s, registries, 1, id('SPECIES_DRIPLING'), 9, [id('MOVE_SURF'), id('MOVE_BOP')]));
  return s;
}

function open(s: GameState, request: AppRequest, h: Partial<AppHost> = {}): AppModel {
  const options = { ...DEFAULT_DEVICE_OPTIONS };
  const host: AppHost = { options: () => options, setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK, ...h };
  return createApp(request, { registries, state: s, log: { stub: () => {} }, host });
}
function press(app: AppModel, ...buttons: Button[]) {
  let result = null;
  for (const b of buttons) {
    result = app.step({ held: [b], pressed: [b], touch: null }) ?? result;
    result = app.step({ held: [], pressed: [], touch: null }) ?? result;
  }
  return result;
}
const tap = (app: AppModel, t: string) => app.step({ held: [], pressed: [], touch: null, tap: t });
/** Opens the start menu's entry by id. */
function openEntry(app: AppModel, entry: string) {
  const v = app.view();
  if (v.app !== 'start-menu') throw new Error(`not the start menu: ${v.app}`);
  tap(app, `entry:${v.entries.findIndex((e) => e.id === entry)}`);
}
const party = (app: AppModel) => app.view() as PartyView;
const bag = (app: AppModel) => app.view() as BagView;
/** Presses A until no message waits. */
function dismiss(app: AppModel) {
  for (let i = 0; i < 20 && (app.view() as { message?: { waiting: boolean } | null }).message?.waiting; i++) press(app, 'a');
}

describe('party menu (field)', () => {
  it('lists SUMMARY, the field moves, SWITCH, ITEM and CANCEL; SWITCH swaps two members', () => {
    const s = fresh();
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'pokemon');
    tap(app, 'slot:1');
    expect(party(app).menu!.entries.map((e) => e.label)).toEqual(['DETAILS', 'Surf', 'SWAP', 'GEAR', 'BACK']);
    expect(party(app).prompt).toBe('What about\nDripling?');
    tap(app, 'menu:2');
    expect(party(app)).toMatchObject({ moving: 1, prompt: 'Swap with whom?', menu: null });
    tap(app, 'slot:0');
    expect(s.party.map((m) => m.species)).toEqual([id('SPECIES_DRIPLING'), id('SPECIES_MOSSLET')]);
  });

  it('refuses a field move with the DS reason and uses one through the host', () => {
    const s = fresh();
    const used: [number, Id][] = [];
    let check: ReturnType<AppHost['fieldMoveCheck']> = 'badge';
    const app = open(s, { app: 'start-menu' }, { fieldMoveCheck: () => check, useFieldMove: (slot, move) => void used.push([slot, move]) });
    openEntry(app, 'pokemon');
    tap(app, 'slot:1');
    tap(app, 'menu:1');
    expect(party(app).message).toEqual({ text: 'A new mark is needed first.', waiting: true });
    press(app, 'a');
    check = null;
    tap(app, 'slot:1');
    expect(tap(app, 'menu:1')).toEqual({ app: 'start-menu' });
    expect(used).toEqual([[1, id('MOVE_SURF')]]);
  });

  it('Softboiled gives a fifth of max HP, counting the bars a point a DS frame; refusals as the DS', () => {
    const softboiled = id('MOVE_SOFTBOILED');
    if (!registries.moves.has(softboiled)) (registries.moves as Map<Id, unknown>).set(softboiled, { ...structuredClone(registries.moves.get(id('MOVE_SURF'))!), id: softboiled });
    const s = fresh();
    s.party.push(setupPokemon(s, registries, 2, id('SPECIES_MOSSLET'), 30, [softboiled]));
    const [a, b, donor] = s.party as [GameState['party'][number], GameState['party'][number], GameState['party'][number]];
    const host = { fieldMoveCheck: () => { throw new Error('Softboiled stays in the party menu'); } };
    const app = open(s, { app: 'start-menu' }, host);
    openEntry(app, 'pokemon');
    // Not enough HP: at most a fifth left.
    donor.hp = Math.floor(donor.stats.hp / 5);
    tap(app, 'slot:2');
    tap(app, 'menu:1');
    expect(party(app).message!.text).toBe('Too tired to share.');
    dismiss(app);
    donor.hp = donor.stats.hp;
    tap(app, 'slot:2');
    tap(app, 'menu:1');
    expect(party(app)).toMatchObject({ prompt: 'Share with whom?', moving: 2, menu: null });
    // Itself and a full Pokémon are refused; the pick goes on.
    tap(app, 'slot:2');
    expect(party(app).message!.text).toBe('Not on that one.');
    dismiss(app);
    tap(app, 'slot:0');
    expect(party(app).message!.text).toBe('Not on that one.');
    dismiss(app);
    b.hp = 0;
    tap(app, 'slot:1');
    expect(party(app).message!.text).toBe('Not on that one.');
    dismiss(app);
    a.hp = 1;
    const give = Math.min(Math.floor(donor.stats.hp / 5), a.stats.hp - 1);
    const before = donor.hp;
    tap(app, 'slot:0');
    // Input waits while the bars move: two points per tick, the donor first.
    press(app, 'b');
    expect(donor.hp).toBeLessThan(before);
    for (let i = 0; i < give + 4 && !party(app).message; i++) app.step({ held: [], pressed: [], touch: null });
    expect([donor.hp, a.hp]).toEqual([before - give, 1 + give]);
    expect(party(app).message!.text).toContain(String(give));
    dismiss(app);
    expect(party(app)).toMatchObject({ prompt: 'Pick a companion.', moving: null });
  });

  it('gives an item from the bag, swaps it for a held one and takes it back', () => {
    const s = fresh();
    s.bag.items = [{ item: id('ITEM_LAMP_OIL'), count: 1 }, { item: id('ITEM_STILL_STONE'), count: 1 }];
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'pokemon');
    tap(app, 'slot:0');
    tap(app, 'menu:2'); // GEAR
    expect(party(app).menu!.entries.map((e) => e.label)).toEqual(['HAND', 'TAKE BACK', 'BACK']);
    tap(app, 'menu:0');
    expect(bag(app).mode).toBe('give');
    tap(app, 'row:0');
    expect(party(app).message!.text).toBe('Mosslet now carries\nthe Lamp Oil.');
    dismiss(app);
    expect(s.party[0]!.heldItem).toBe(id('ITEM_LAMP_OIL'));
    tap(app, 'slot:0');
    tap(app, 'menu:2');
    tap(app, 'menu:0');
    tap(app, 'row:0'); // Still Stone (the Lamp Oil left the bag)
    expect(party(app).message!.text).toBe('Mosslet carries\nLamp Oil.');
    press(app, 'a');
    expect(party(app).yesNo).not.toBeNull();
    tap(app, 'yes');
    expect(party(app).message!.text).toBe('Swapped the Lamp Oil\nfor the Still Stone.');
    dismiss(app);
    expect(s.party[0]!.heldItem).toBe(id('ITEM_STILL_STONE'));
    expect(s.bag.items).toEqual([{ item: id('ITEM_LAMP_OIL'), count: 1 }]);
    tap(app, 'slot:0');
    tap(app, 'menu:2');
    tap(app, 'menu:1');
    expect(party(app).message!.text).toBe('Took the Still Stone\nfrom Mosslet.');
    expect(s.party[0]!.heldItem).toBeNull();
  });

  it('opens the summary pages and switches moves on BATTLE MOVES', () => {
    const s = fresh();
    s.party[0]!.met.date = '2009-03-22';
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'pokemon');
    tap(app, 'slot:0');
    tap(app, 'menu:0');
    const v = () => app.view() as SummaryView;
    expect(v()).toMatchObject({ app: 'summary', page: 'info', mon: { name: 'Mosslet', level: '12' } });
    expect(v().info.fields.map((f) => f.value).slice(0, 3)).toEqual(['001', 'Mosslet', 'Grass']);
    press(app, 'right');
    expect(v().page).toBe('memo');
    expect(v().memo[1]).toBe('Since MAR 22, 2009');
    press(app, 'right');
    expect(v().skills.stats.map((x) => x.label)).toEqual(['Power', 'Guard', 'Focus', 'Calm', 'Pace']);
    tap(app, 'page:moves');
    const before = [...s.party[0]!.moves];
    press(app, 'a');
    expect(v().moves.detail).toMatchObject({ power: { value: '40' }, description: 'Bop: a physical move\nof the normal kind.' });
    press(app, 'a', 'down', 'a');
    expect(s.party[0]!.moves).toEqual([before[1], before[0], ...before.slice(2)]);
    press(app, 'b');
    press(app, 'down');
    expect(v().mon.name).toBe('Dripling');
  });

  it('EV/IV view and RENAME (OpenSinnoh options): off by default as the DS; on, A steps the numbers and renames', () => {
    const s = fresh();
    const mon = s.party[0]!;
    mon.evs = { hp: 4, attack: 252, defense: 0, speed: 8, spAttack: 0, spDefense: 12 };
    const v = (app: AppModel) => app.view() as SummaryView;
    const summary = (options: Partial<typeof DEFAULT_DEVICE_OPTIONS>) => {
      const app = open(s, { app: 'start-menu' }, { options: () => ({ ...DEFAULT_DEVICE_OPTIONS, ...options }) });
      openEntry(app, 'pokemon');
      tap(app, 'slot:0');
      tap(app, 'menu:0');
      return app;
    };
    // The DS: no RENAME, no EV/IV label; A does nothing on these pages.
    const ds = summary({});
    expect(v(ds).info.rename).toBeUndefined();
    press(ds, 'a');
    expect(v(ds).app).toBe('summary');
    tap(ds, 'page:skills');
    expect(v(ds).skills.values).toBeUndefined();
    press(ds, 'a');
    expect(v(ds).skills.stats[0]!.value).toBe(String(mon.stats.attack));
    // On: STATS, then EV, then IV.
    const app = summary({ statView: 0, summaryRename: 0 });
    tap(app, 'page:skills');
    expect(v(app).skills.values).toEqual({ mode: 'stats', label: 'STATS' });
    press(app, 'a');
    expect(v(app).skills).toMatchObject({ values: { mode: 'evs', label: 'EFFORT' }, hp: { value: '4' } });
    expect(v(app).skills.stats.map((x) => x.value)).toEqual(['252', '0', '0', '12', '8']);
    tap(app, 'values');
    expect(v(app).skills.values!.mode).toBe('ivs');
    expect(v(app).skills.stats[0]!.value).toBe(String(mon.ivs.attack));
    // RENAME on INFO: the naming screen; the species name clears the nickname, as the Name Rater.
    tap(app, 'page:info');
    expect(v(app).info.rename).toBe('RENAME');
    press(app, 'a');
    expect(app.view().app).toBe('naming');
    tap(app, 'type:Moss');
    tap(app, 'ok');
    expect(mon.nickname).toBe('Moss');
    expect(v(app).mon.name).toBe('Moss');
    tap(app, 'rename');
    tap(app, 'type:Mosslet');
    tap(app, 'ok');
    expect(mon.nickname).toBeNull();
    // Not for a Pokémon from another Trainer.
    mon.otId ^= 1;
    expect(v(app).info.rename).toBeUndefined();
    press(app, 'a');
    expect(app.view().app).toBe('summary');
  });

  it('shows the RIBBONS page: rows of 4, A selects, the cursor moves and scrolls as on the DS', () => {
    const s = fresh();
    s.party[0]!.ribbons = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'pokemon');
    tap(app, 'slot:0');
    tap(app, 'menu:0');
    tap(app, 'page:ribbons');
    const r = () => (app.view() as SummaryView).ribbons;
    expect(r()).toMatchObject({ count: { label: 'Sashes:', value: '14' }, row: 0, rows: 3, cursor: null, detail: null, hint: 'LOOK' });
    expect(r().list.slice(0, 2)).toEqual([
      { ribbon: 0, name: 'Lantern Sash' },
      { ribbon: 1, name: 'Brave Sash' },
    ]);
    press(app, 'a');
    expect(r()).toMatchObject({ rows: 2, cursor: 0, detail: { name: 'Lantern Sash', description: 'Given for lighting the\nfirst lantern.', index: '1/14' }, hint: 'DONE' });
    // Left/right stop at the row's ends; the page and the Pokémon stay while selecting.
    press(app, 'left');
    expect(r().cursor).toBe(0);
    press(app, 'right', 'right', 'right', 'right');
    expect(r().cursor).toBe(3);
    press(app, 'down');
    expect(r()).toMatchObject({ row: 0, cursor: 7 });
    press(app, 'down');
    expect(r()).toMatchObject({ row: 1, cursor: 11 });
    // Down past the last full row: ribbon 14 does not exist, so the cursor goes to the last ribbon (ChangeSelectedRibbon).
    press(app, 'down');
    expect(r()).toMatchObject({ row: 2, cursor: 13, detail: { index: '14/14' } });
    tap(app, 'ribbons:up');
    expect(r()).toMatchObject({ row: 2, cursor: 9 });
    press(app, 'up');
    expect(r()).toMatchObject({ row: 1, cursor: 5 });
    expect((app.view() as SummaryView).mon.name).toBe('Mosslet');
    press(app, 'b');
    expect(r()).toMatchObject({ row: 0, cursor: null });
    // A tap on a third-row ribbon selects it and scrolls a row; a second tap lets go.
    tap(app, 'ribbon:9');
    expect(r()).toMatchObject({ row: 1, cursor: 9, detail: { name: 'Dusk Sash' } });
    tap(app, 'ribbon:9');
    expect(r().cursor).toBeNull();
    // Dripling has none: only the count, and A does nothing.
    press(app, 'down');
    expect(r()).toMatchObject({ count: { value: '0' }, list: [], hint: '' });
    press(app, 'a');
    expect(r().cursor).toBeNull();
  });
});

describe('bag use (field)', () => {
  it('uses a Tonic on a hurt member: HP up, one item used, back to the bag', () => {
    const s = fresh();
    s.party[0]!.hp = 5;
    s.bag.medicine = [{ item: id('ITEM_TONIC'), count: 2 }];
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'bag');
    tap(app, 'pocket:1');
    tap(app, 'row:0');
    expect(bag(app).menu!.entries.map((e) => e.label)).toEqual(['USE', 'HAND', 'DROP', 'BACK']);
    tap(app, 'menu:0');
    expect(party(app)).toMatchObject({ mode: 'use', prompt: 'Use it on whom?' });
    tap(app, 'slot:1');
    expect(party(app).message!.text).toBe('That would do nothing.');
    expect(bag(app).app).toBe('party');
    press(app, 'a');
    expect(app.view().app).toBe('bag');
    tap(app, 'row:0');
    tap(app, 'menu:0');
    tap(app, 'slot:0');
    expect(party(app).message!.text).toBe('Mosslet got back\n20 HP.');
    expect(s.party[0]!.hp).toBe(25);
    press(app, 'a');
    expect(app.view().app).toBe('bag');
    expect(s.bag.medicine).toEqual([{ item: id('ITEM_TONIC'), count: 1 }]);
  });

  it('teaches a TM into a free slot, and through the forget flow when four are known', () => {
    const s = fresh();
    s.bag.tmhms = [{ item: id('ITEM_LESSON_DIG'), count: 2 }];
    s.party[0] = setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 16, ['BOP', 'STARE', 'LEAF_TAP', 'QUICK_DASH'].map((m) => id(`MOVE_${m}`)));
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'bag');
    tap(app, 'pocket:3');
    tap(app, 'row:0');
    tap(app, 'menu:0');
    expect(bag(app).message!.text).toBe('Opened a lesson.');
    press(app, 'a');
    expect(bag(app).message!.text).toBe('It teaches\nDig Paw.');
    press(app, 'a');
    expect(bag(app).yesNo).not.toBeNull();
    tap(app, 'yes');
    expect(party(app)).toMatchObject({ mode: 'teach', notes: ['CAN!', 'CAN!', null, null, null, null] });
    // Dripling knows two moves: learned at once.
    tap(app, 'slot:1');
    expect(party(app).message!.text).toBe('Dripling picked up\nDig Paw!');
    press(app, 'a');
    expect(s.party[1]!.moves).toEqual([id('MOVE_SURF'), id('MOVE_BOP'), id('MOVE_DIG_PAW')]);
    // Mosslet knows four: forget the first.
    expect(s.party[0]!.moves).toHaveLength(4);
    tap(app, 'row:0');
    tap(app, 'menu:0');
    press(app, 'a', 'a');
    tap(app, 'yes');
    tap(app, 'slot:0');
    press(app, 'a', 'a');
    tap(app, 'yes');
    expect(party(app).message!.text).toBe('Drop which skill?');
    press(app, 'a');
    const sv = app.view() as SummaryView;
    expect(sv).toMatchObject({ app: 'summary', mode: 'teach', page: 'moves' });
    expect(sv.moves.rows.map((r) => r.isNew)).toEqual([false, false, false, false, true]);
    const old = s.party[0]!.moves[0]!;
    press(app, 'a');
    expect(party(app).message!.text).toBe('One, two... done!');
    dismiss(app);
    expect(s.party[0]!.moves[0]).toBe(id('MOVE_DIG_PAW'));
    expect(s.party[0]!.moves).not.toContain(old);
    expect(s.bag.tmhms).toEqual([]);
    expect(app.view().app).toBe('bag');
  });

  it('uses a Repel (refused while one lasts), tosses and registers', () => {
    const s = fresh();
    s.bag.items = [{ item: id('ITEM_REPEL'), count: 3 }];
    s.bag.key_items = [{ item: id('ITEM_TOWN_GUIDE'), count: 1 }];
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'bag');
    tap(app, 'pocket:0');
    tap(app, 'row:0');
    tap(app, 'menu:0');
    expect(bag(app).message!.text).toBe('Ari sprayed the\nRepel.');
    expect(s.repel).toBe(100);
    press(app, 'a');
    tap(app, 'row:0');
    tap(app, 'menu:0');
    expect(bag(app).message!.text).toBe('The last spray still works.');
    press(app, 'a');
    expect(s.bag.items).toEqual([{ item: id('ITEM_REPEL'), count: 2 }]);
    tap(app, 'row:0');
    tap(app, 'menu:2'); // DROP
    expect(bag(app).quantity).toEqual({ count: 'x001' });
    press(app, 'up', 'a');
    expect(bag(app).message!.text).toBe('Drop 2\nRepel?');
    tap(app, 'yes');
    expect(bag(app).message!.text).toBe('Dropped 2 Repel.');
    expect(s.bag.items).toEqual([]);
    press(app, 'a');
    tap(app, 'pocket:7');
    tap(app, 'row:0');
    expect(bag(app).menu!.entries.map((e) => e.label)).toEqual(['PIN', 'BACK']);
    tap(app, 'menu:0');
    expect(s.registeredItem).toBe(id('ITEM_TOWN_GUIDE'));
    expect(bag(app).rows[0]!.registered).toBe(true);
  });
});

describe('bag pockets', () => {
  // The DS pocket type each listed pocket is drawn as (decomp POCKET_*); the one-pocket bags list just theirs.
  it('the field bag lists the eight in order, the one-pocket bags their own, the battle bag its four', () => {
    const s = fresh();
    const field = open(s, { app: 'start-menu' });
    openEntry(field, 'bag');
    expect(bag(field).pocketTypes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const [pocket, type] of [['items', 0], ['berries', 4]] as const) {
      const v = bag(open(s, { app: 'bag-pick', pocket }));
      expect(v).toMatchObject({ mode: 'pick', pocket: 0, pocketTypes: [type] });
      expect(v.pockets).toHaveLength(1);
    }
    const poffin = bag(open(s, { app: 'poffin-cooking' }));
    expect(poffin).toMatchObject({ mode: 'poffin', pocket: 0, pocketTypes: [4] });
    expect(poffin.pockets).toHaveLength(1);
    const battle = bag(open(s, { app: 'bag-select', mode: 'battle', party: s.party, active: 0, bag: s.bag, noRoomForBall: false, noEffect: [] }));
    expect(battle).toMatchObject({ mode: 'battle', pocketTypes: [1, 1, 2, 6] });
  });
});

describe('the item wheel (OpenSinnoh option itemWheel)', () => {
  it('REGISTER adds to the wheel (the oldest leaves a full one) and Y keeps the newest; DESELECT takes one off', () => {
    const s = fresh();
    s.bag.key_items = [{ item: id('ITEM_TOWN_GUIDE'), count: 1 }, { item: id('ITEM_TRAIL_BIKE'), count: 1 }];
    const app = open(s, { app: 'start-menu' }, { options: () => ({ ...DEFAULT_DEVICE_OPTIONS, itemWheel: 0 }) });
    openEntry(app, 'bag');
    tap(app, 'pocket:7');
    for (const row of [0, 1]) {
      tap(app, `row:${row}`);
      tap(app, `menu:${bag(app).menu!.entries.findIndex((e) => e.label === 'PIN')}`);
    }
    expect([s.registeredWheel, s.registeredItem]).toEqual([[id('ITEM_TOWN_GUIDE'), id('ITEM_TRAIL_BIKE')], id('ITEM_TRAIL_BIKE')]);
    expect(bag(app).rows.map((r) => r.registered)).toEqual([true, true]);
    tap(app, 'row:1');
    expect(bag(app).menu!.entries.map((e) => e.label)).toContain('UNPIN');
    tap(app, `menu:${bag(app).menu!.entries.findIndex((e) => e.label === 'UNPIN')}`);
    expect([s.registeredWheel, s.registeredItem]).toEqual([[id('ITEM_TOWN_GUIDE')], id('ITEM_TOWN_GUIDE')]);
    // A full wheel: the oldest leaves.
    s.registeredWheel = [id('ITEM_REPEL'), id('ITEM_POTION'), id('ITEM_POKE_BALL'), id('ITEM_TOWN_GUIDE')];
    tap(app, 'row:1');
    tap(app, `menu:${bag(app).menu!.entries.findIndex((e) => e.label === 'PIN')}`);
    expect(s.registeredWheel).toEqual([id('ITEM_POTION'), id('ITEM_POKE_BALL'), id('ITEM_TOWN_GUIDE'), id('ITEM_TRAIL_BIKE')]);
  });

  it('the wheel: a direction picks, letting go of Y uses it; let go with none, it waits for a tap; B closes', () => {
    const s = fresh();
    s.registeredWheel = [id('ITEM_TOWN_GUIDE'), id('ITEM_TRAIL_BIKE')];
    const wheel = () => open(s, { app: 'item-wheel' });
    const w = (app: AppModel) => app.view() as ItemWheelView;
    let app = wheel();
    expect(w(app)).toEqual({ app: 'item-wheel', items: [{ item: id('ITEM_TOWN_GUIDE'), name: 'Town Guide' }, { item: id('ITEM_TRAIL_BIKE'), name: 'Trail Bike' }], cursor: null });
    // Down is the third slot: there is none.
    expect(app.step({ held: ['y', 'down'], pressed: ['down'], touch: null })).toBeNull();
    expect(app.step({ held: ['y', 'right'], pressed: ['right'], touch: null })).toBeNull();
    expect(w(app).cursor).toBe(1);
    expect(app.step({ held: [], pressed: [], touch: null })).toEqual({ app: 'item-wheel', item: id('ITEM_TRAIL_BIKE') });
    app = wheel();
    expect(app.step({ held: [], pressed: [], touch: null })).toBeNull();
    expect(app.step({ held: [], pressed: [], touch: null, tap: 'item:0' })).toEqual({ app: 'item-wheel', item: id('ITEM_TOWN_GUIDE') });
    app = wheel();
    expect(app.step({ held: ['y', 'b'], pressed: ['b'], touch: null })).toEqual({ app: 'item-wheel', item: null });
  });
});

describe('bag USE of field items (decomp ItemActionFunc_Use)', () => {
  it('the Bicycle: the check refuses in the bag with the DS message, else the bag closes and the field mounts', () => {
    const s = fresh();
    s.bag.key_items = [{ item: id('ITEM_TRAIL_BIKE'), count: 1 }];
    let check: ReturnType<AppHost['fieldItemCheck']> = 'dismount';
    const used: Id[] = [];
    const app = open(s, { app: 'start-menu' }, { fieldItemCheck: () => check, useFieldItem: (item) => void used.push(item) });
    openEntry(app, 'bag');
    tap(app, 'pocket:7');
    tap(app, 'row:0');
    expect(bag(app).menu!.entries[0]!.label).toBe('USE');
    tap(app, 'menu:0');
    expect(bag(app).message!.text).toBe('You cannot get off\nthe bike here.');
    press(app, 'a');
    check = 'generic';
    tap(app, 'row:0');
    tap(app, 'menu:0');
    expect(bag(app).message!.text).toBe('Ari, this is not\nthe time for that.');
    press(app, 'a');
    check = 'partner';
    tap(app, 'row:0');
    tap(app, 'menu:0');
    expect(bag(app).message!.text).toBe('Not while someone\nis with you.');
    press(app, 'a');
    expect(used).toEqual([]);
    check = null;
    tap(app, 'row:0');
    expect(tap(app, 'menu:0')).toEqual({ app: 'start-menu' });
    expect(used).toEqual([id('ITEM_TRAIL_BIKE')]);
  });

  it('reads WALK while cycling (ITEM_ACTION_WALK)', () => {
    const s = fresh();
    s.bag.key_items = [{ item: id('ITEM_TRAIL_BIKE'), count: 1 }];
    s.playerState = 'cycle';
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'bag');
    tap(app, 'pocket:7');
    tap(app, 'row:0');
    expect(bag(app).menu!.entries[0]!.label).toBe('ON FOOT');
  });
});

describe('PC boxes (storage)', () => {
  const view = (app: AppModel) => app.view() as StorageView;
  it('deposits into a chosen box, refuses the last able member and withdraws again', () => {
    const s = fresh();
    const dep = open(s, { app: 'storage', mode: 'deposit' });
    expect(view(dep)).toMatchObject({ area: 'party', partyOpen: true, box: { name: 'CRATE 1', count: '0/30' } });
    tap(dep, 'party:1');
    tap(dep, 'menu:0'); // STORE
    expect(view(dep).message!.text).toBe('Into which crate?');
    press(dep, 'right', 'a');
    expect(s.boxes[1]!.slots[0]!.species).toBe(id('SPECIES_DRIPLING'));
    expect(s.party).toHaveLength(1);
    tap(dep, 'party:0');
    tap(dep, 'menu:0'); // STORE refuses before the box is chosen (STORE_MON_CHECK_CAN_STORE_MON)
    expect(view(dep).message!.text).toBe('That one is your last!');
    dismiss(dep);
    expect(press(dep, 'b')).toBeNull();
    expect(tap(dep, 'yes')).toEqual({ app: 'storage' });

    const wd = open(s, { app: 'storage', mode: 'withdraw' });
    expect(view(wd).box.name).toBe('CRATE 2');
    tap(wd, 'slot:0');
    tap(wd, 'menu:0'); // FETCH
    expect(s.party.map((m) => m.species)).toEqual([id('SPECIES_MOSSLET'), id('SPECIES_DRIPLING')]);
  });

  it('moves Pokémon across boxes and the party, moves held items and renames a box', () => {
    const s = fresh();
    s.party[1]!.heldItem = id('ITEM_LAMP_OIL');
    const app = open(s, { app: 'storage', mode: 'move' });
    tap(app, 'party:1');
    tap(app, 'menu:0'); // GRAB
    expect(view(app).held).toMatchObject({ species: id('SPECIES_DRIPLING') });
    tap(app, 'box:1');
    tap(app, 'slot:4');
    expect(s.boxes[1]!.slots[4]!.species).toBe(id('SPECIES_DRIPLING'));
    expect(s.party).toHaveLength(1);
    tap(app, 'slot:4');
    tap(app, 'menu:0');
    tap(app, 'box:-1');
    tap(app, 'slot:29');
    expect(s.boxes[0]!.slots[29]!.species).toBe(id('SPECIES_DRIPLING'));
    // The box menu: rename through the naming screen.
    tap(app, 'header');
    tap(app, 'menu:1');
    expect(app.view()).toMatchObject({ app: 'naming', kind: 'box', text: 'CRATE 1' });
    tap(app, 'del');
    tap(app, 'type:X');
    tap(app, 'ok');
    expect(s.boxes[0]!.name).toBe('CRATE X');
    // The wallpaper: a theme, then one of its wallpapers.
    tap(app, 'header');
    tap(app, 'menu:0');
    tap(app, 'menu:1');
    tap(app, 'menu:2');
    expect(s.boxes[0]!.wallpaper).toBe(6);

    const items = open(s, { app: 'storage', mode: 'items' });
    tap(items, 'slot:29');
    expect(view(items).heldItem).toBe(id('ITEM_LAMP_OIL'));
    tap(items, 'party:0');
    expect(s.party[0]!.heldItem).toBe(id('ITEM_LAMP_OIL'));
    expect(view(items).heldItem).toBeNull();
  });

  /** Boxes three Pokémon in BOX 1: a plain one, an Egg and one holding Mail. */
  function boxed(): GameState {
    const s = fresh();
    s.boxes[0]!.slots[0] = setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 5);
    s.boxes[0]!.slots[1] = { ...setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 5), isEgg: true };
    s.boxes[0]!.slots[2] = { ...setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 5), heldItem: id('ITEM_LEAF_LETTER') };
    return s;
  }
  const messages = (app: AppModel) => {
    const out: string[] = [];
    for (let i = 0; i < 10 && view(app).message?.waiting; i++) {
      out.push(view(app).message!.text);
      press(app, 'a');
    }
    return out;
  };

  it('releases from the box and the party after the DS refusals and its NO-first question', () => {
    const s = boxed();
    const app = open(s, { app: 'storage', mode: 'withdraw' });
    expect(view(app).menu).toBeNull();
    tap(app, 'slot:1');
    expect(view(app).menu!.entries.map((e) => e.label)).toEqual(['FETCH', 'DETAILS', 'MARK', 'LET GO', 'BACK']);
    tap(app, 'menu:3');
    expect(messages(app)).toEqual(['A shell cannot go free.']);
    tap(app, 'slot:2');
    tap(app, 'menu:3');
    expect(messages(app)).toEqual(['Take the letter off first.']);
    tap(app, 'slot:0');
    tap(app, 'menu:3');
    expect(view(app)).toMatchObject({ message: { text: 'Set this one free?', waiting: false }, yesNo: { cursor: 1 } });
    press(app, 'a'); // NO
    expect(s.boxes[0]!.slots[0]).not.toBeNull();
    tap(app, 'slot:0');
    tap(app, 'menu:3');
    tap(app, 'yes');
    expect(s.boxes[0]!.slots[0]).toBeNull();
    expect(messages(app)).toEqual(['Mosslet went free.', 'Farewell, Mosslet!']);

    // The party: Dripling is the only one that knows Surf, so it comes back; then Mosslet is the last able one.
    const dep = open(s, { app: 'storage', mode: 'deposit' });
    tap(dep, 'party:1');
    tap(dep, 'menu:3');
    tap(dep, 'yes');
    expect(messages(dep)).toEqual(['Dripling turned back!', 'It did not want to leave you.']);
    expect(s.party).toHaveLength(2);
    s.boxes[0]!.slots[5] = setupPokemon(s, registries, 0, id('SPECIES_DRIPLING'), 9, [id('MOVE_SURF')]);
    tap(dep, 'party:1');
    tap(dep, 'menu:3');
    tap(dep, 'yes');
    expect(messages(dep)).toEqual(['Dripling went free.', 'Farewell, Dripling!']);
    expect(s.party.map((m) => m.species)).toEqual([id('SPECIES_MOSSLET')]);
    expect(view(dep).cursor).toBe(0);
    tap(dep, 'party:0');
    tap(dep, 'menu:3');
    expect(messages(dep)).toEqual(['That one is your last!']);
    expect(s.party).toHaveLength(1);
  });

  it('edits the markings in the markings window: toggles, CONFIRM sets, CANCEL and B drop', () => {
    const s = boxed();
    const app = open(s, { app: 'storage', mode: 'move' });
    tap(app, 'slot:0');
    expect(view(app).preview!.markings).toBe(0);
    tap(app, 'menu:2'); // MARK
    expect(view(app)).toMatchObject({ menu: null, marking: { markings: 0, cursor: 0, confirm: 'OK', cancel: 'BACK' }, message: { text: 'Tag your companion.' } });
    tap(app, 'mark:0');
    press(app, 'down', 'down', 'down', 'a');
    expect(view(app).marking).toMatchObject({ markings: 0b1001, cursor: 3 });
    expect(s.boxes[0]!.slots[0]!.markings).toBe(0);
    tap(app, 'mark:6'); // CONFIRM
    expect(view(app).marking).toBeNull();
    expect(s.boxes[0]!.slots[0]!.markings).toBe(0b1001);
    expect(view(app).preview!.markings).toBe(0b1001);
    // CANCEL and B leave the marks as they were; up from the first row wraps to CANCEL.
    tap(app, 'slot:0');
    tap(app, 'menu:2');
    tap(app, 'mark:5');
    press(app, 'b');
    tap(app, 'slot:0');
    tap(app, 'menu:2');
    tap(app, 'mark:1');
    press(app, 'up', 'up', 'a');
    expect(view(app).marking).toBeNull();
    expect(s.boxes[0]!.slots[0]!.markings).toBe(0b1001);
  });

  it('compares two Pokémon: SET ON LEFT keeps one, the right side follows the cursor, three pages', () => {
    const s = boxed();
    const app = open(s, { app: 'storage', mode: 'compare' });
    expect(view(app)).toMatchObject({ area: 'header', partyOpen: true, compare: { page: 'stats', live: 0, sides: [null, null], set: ['LEFT', 'RIGHT'] } });
    expect(view(app).compare!.labels).toEqual(['TEMPER', 'Lv', 'HP', 'POWER', 'GUARD', 'FOCUS', 'CALM', 'PACE']);
    tap(app, 'party:1');
    expect(view(app).menu!.entries.map((e) => e.label)).toEqual(['LEFT', 'STORE', 'MARK', 'BACK']);
    tap(app, 'menu:0'); // SET ON LEFT
    const dripling = s.party[1]!;
    const left = view(app).compare!.sides[0]!;
    expect(left).toMatchObject({ name: 'Dripling', mon: { species: id('SPECIES_DRIPLING') }, contest: [0, 0, 0, 0, 0] });
    expect(left.values.slice(1)).toEqual([dripling.level, dripling.stats.hp, dripling.stats.attack, dripling.stats.defense, dripling.stats.spAttack, dripling.stats.spDefense, dripling.stats.speed].map(String));
    expect(view(app).compare!.live).toBe(1);
    press(app, 'up', 'up');
    expect(view(app).compare!.sides[1]).toMatchObject({ name: 'Mosslet' });
    tap(app, 'slot:3'); // an empty slot: the live side is blank
    expect(view(app).compare!.sides[1]).toBeNull();
    // The touch buttons: only the live side's sets, and only over a Pokémon.
    press(app, 'left', 'left');
    expect(view(app).compare!.sides[1]).toMatchObject({ name: 'Shell', values: ['???', '???', '???', '???', '???', '???', '???', '???'], contest: null });
    tap(app, 'compare:0');
    expect(view(app).compare!.live).toBe(1);
    tap(app, 'compare:1');
    // Now the left side is live again: it shows the cursor's Pokémon, the right one keeps the Egg.
    expect(view(app).compare).toMatchObject({ live: 0, sides: [{ mon: { egg: true } }, { mon: { egg: true } }] });
    press(app, 'right', 'right', 'right', 'right', 'right', 'right', 'down');
    expect(view(app)).toMatchObject({ area: 'party', cursor: 1, compare: { sides: [{ name: 'Dripling' }, { mon: { egg: true } }] } });
    tap(app, 'compare:page');
    expect(view(app).compare).toMatchObject({ page: 'contest', labels: [] });
    tap(app, 'compare:page');
    expect(view(app).compare).toMatchObject({ page: 'moves', labels: ['SKILL'], sides: [{ values: ['Surf', 'Bop'] }, { values: ['???', '???', '???', '???'] }] });
    tap(app, 'compare:page');
    expect(view(app).compare!.page).toBe('stats');
  });
});

describe('naming screen', () => {
  const view = (app: AppModel) => app.view() as NamingView;
  it('enters keys, pages, deletes, takes typed text and returns the name (or null when unchanged)', () => {
    const s = fresh();
    const app = open(s, { app: 'naming', kind: 'pokemon', initial: 'Mosslet', maxLength: 10, gender: 'male', pokemon: { species: id('SPECIES_MOSSLET'), form: 0, gender: 'male' } });
    expect(view(app)).toMatchObject({ prompt: 'A name for Mosslet?', text: '', page: 0, cursor: { row: 0, col: 0 } });
    expect(view(app).keys[0]!.join('')).toBe('ABCDEFGHIJ ,.');
    press(app, 'a', 'right', 'a');
    expect(view(app).text).toBe('AB');
    tap(app, 'page:1');
    tap(app, 'key:0:2');
    expect(view(app).text).toBe('ABc');
    press(app, 'b');
    tap(app, 'type:ce{}9');
    expect(view(app).text).toBe('ABce9');
    expect(tap(app, 'ok')).toEqual({ app: 'naming', name: 'ABce9' });
    const same = open(s, { app: 'naming', kind: 'player', initial: 'Ari', maxLength: 7, gender: 'male', pokemon: null });
    tap(same, 'type:   ');
    expect(tap(same, 'ok')).toEqual({ app: 'naming', name: null });
  });

  it('stops at the length limit and jumps to OK', () => {
    const app = open(fresh(), { app: 'naming', kind: 'player', initial: '', maxLength: 7, gender: 'female', pokemon: null });
    tap(app, 'type:ABCDEFGHIJ');
    expect(view(app)).toMatchObject({ text: 'ABCDEFG', cursor: { row: -1, col: 4 } });
  });

  // Decomp NamingScreen_ProcessCharacterInput: only the page buttons and Select change currentCharsIdx; entering a
  // character never does. Platinum has no auto-lowercase after the first capital, for any kind of name.
  it('with Auto lowercase off (the contract default) keeps the page after a capital (any kind, first character or after a space)', () => {
    for (const kind of ['player', 'rival', 'pokemon', 'box', 'tablet'] as const) {
      const pokemon = kind === 'pokemon' ? { species: id('SPECIES_MOSSLET'), form: 0, gender: 'male' as const } : null;
      const app = open(fresh(), { app: 'naming', kind, initial: kind === 'box' ? '' : 'Ari', maxLength: 10, gender: 'male', pokemon });
      press(app, 'right', 'right', 'right', 'a');
      expect(view(app)).toMatchObject({ text: 'D', page: 0 });
      tap(app, 'key:2:7');
      tap(app, 'key:0:4');
      expect(view(app)).toMatchObject({ text: 'D E', page: 0 });
      expect(view(app).keys[0]!.join('')).toBe('ABCDEFGHIJ ,.');
    }
  });

  // OpenSinnoh addition (docs/decisions.md): the device option autoLowercase (0 on) moves to the lowercase page once.
  it('with Auto lowercase on, the first capital switches to lowercase once (any kind); a manual return to capitals stays', () => {
    const on = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS, autoLowercase: 0 }) };
    for (const kind of ['player', 'rival', 'pokemon', 'box', 'tablet'] as const) {
      const pokemon = kind === 'pokemon' ? { species: id('SPECIES_MOSSLET'), form: 0, gender: 'male' as const } : null;
      const app = open(fresh(), { app: 'naming', kind, initial: kind === 'box' ? '' : 'Ari', maxLength: 10, gender: 'male', pokemon }, on);
      press(app, 'right', 'right', 'right', 'a');
      expect(view(app)).toMatchObject({ text: 'D', page: 1 });
      tap(app, 'type:en');
      expect(view(app)).toMatchObject({ text: 'Den', page: 1 });
      tap(app, 'page:0');
      tap(app, 'key:0:4');
      tap(app, 'key:0:2');
      expect(view(app)).toMatchObject({ text: 'DenEC', page: 0 });
      tap(app, 'type: ');
      expect(view(app).page).toBe(0);
    }
    // Typed text counts too, and a name that starts on another page is left alone.
    const typed = open(fresh(), { app: 'naming', kind: 'player', initial: '', maxLength: 7, gender: 'male', pokemon: null }, on);
    tap(typed, 'type:Barry');
    expect(view(typed)).toMatchObject({ text: 'Barry', page: 1 });
    const other = open(fresh(), { app: 'naming', kind: 'player', initial: '', maxLength: 7, gender: 'male', pokemon: null }, on);
    tap(other, 'page:2');
    tap(other, 'key:0:0');
    expect(view(other).page).toBe(2);
    // A gift code stays on the capitals page.
    const code = open(fresh(), { app: 'naming', kind: 'gift-code', initial: '', maxLength: 8, gender: 'male', pokemon: null }, on);
    tap(code, 'key:0:3');
    expect(view(code)).toMatchObject({ text: 'D', page: 0 });
  });
});

// The Pokédex: pokedex.test.ts.
describe('trainer card', () => {
  it('shows the card front and back with badges', () => {
    const s = fresh();
    s.badges.push('platinum:BADGE_ID_FOREST' as Id);
    s.pokedex.obtained = true;
    s.pokedex.seen.push(id('SPECIES_MOSSLET'));
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'trainer');
    const v = () => app.view() as TrainerCardView;
    expect(v().fields.map((f) => f.value)).toEqual([String(s.trainerId & 0xffff).padStart(5, '0'), 'Ari', '3000c', '1', '0', '0:00']);
    expect(v().started.value).toBe('MAR 22, 2009');
    expect(v().badges).toEqual([false, true, false, false, false, false, false, false]);
    press(app, 'a');
    expect(v().side).toBe('back');
    expect(v().back[0]!.value).toBe('-- --, ----');
    expect(v().stars).toBe(0);
    expect(v().pokedex).toBe(true);
  });

  it('blanks the Pokédex row before the Pokédex', () => {
    const app = open(fresh(), { app: 'start-menu' });
    openEntry(app, 'trainer');
    const v = app.view() as TrainerCardView;
    expect(v.pokedex).toBe(false);
    expect(v.fields[3]).toEqual({ label: '', value: '' });
  });

  it('signs the back: pen strokes, DONE, "Is this OK?" YES saves and scores; NO then redo clears', () => {
    const s = fresh();
    const app = open(s, { app: 'start-menu' });
    openEntry(app, 'trainer');
    const v = () => app.view() as TrainerCardView;
    tap(app, 'sign');
    expect(v().signing).toBeNull(); // the front: nothing to sign
    press(app, 'a');
    tap(app, 'sign');
    expect(v().signing).toMatchObject({ prompt: 'Sign your name here.', done: 'FINISH', message: null, cancel: true });
    tap(app, 'pen:10,10;20,10');
    tap(app, 'pen-up');
    const drawn = decodeSignature(v().signature);
    expect(drawn.reduce((n, p) => n + p, 0)).toBe(12 * 2); // 2×2 stamps at x 10..20, offset by 1: columns 11..22, rows 11..12
    // DONE → "Is this OK?" NO → "Start the signature over?" YES clears.
    tap(app, 'done');
    expect(v().signing!.message!.text).toBe('Keep this signature?');
    tap(app, 'no');
    expect(v().signing!.message!.text).toBe('Start the signature over?');
    tap(app, 'yes');
    expect(v().signature).toBeNull();
    tap(app, 'pen:0,0;5,5');
    tap(app, 'done');
    tap(app, 'yes');
    expect(v().signing).toBeNull();
    expect(s.signature).not.toBeNull();
    expect(s.records.score).toBe(5); // SIGNED_TRAINER_CARD (4) scores 5 in the fixture
    // B while signing cancels without saving.
    tap(app, 'sign');
    tap(app, 'pen:50,50;60,60');
    press(app, 'b');
    expect(v().signing).toBeNull();
    expect(s.records.score).toBe(5); // SIGNED_TRAINER_CARD (4) scores 5 in the fixture
    expect(v().signature).toBe(s.signature);
  });

  it('the signature app (start_signature_app) signs at once, has no cancel and closes on YES', () => {
    const s = fresh();
    const app = open(s, { app: 'signature' });
    const v = () => app.view() as TrainerCardView;
    expect(v()).toMatchObject({ side: 'back', signing: { cancel: false } });
    press(app, 'b');
    expect(v().signing).not.toBeNull();
    tap(app, 'pen:1,1;2,2');
    tap(app, 'done');
    expect(tap(app, 'yes')).toEqual({ app: 'signature' });
    expect(s.records.score).toBe(5); // SIGNED_TRAINER_CARD (4) scores 5 in the fixture
  });

  it('rejects a malformed pen tap', () => {
    const app = open(fresh(), { app: 'signature' });
    expect(() => tap(app, 'pen:1;2')).toThrow(/bad pen sample/);
  });
});
