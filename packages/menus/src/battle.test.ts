/**
 * The battle bag and party apps on the fixture pack: the battle pockets by `battlePocket`
 * bits, medicine asks for a Pokémon and refuses one it would not help, a ball with no room is refused, and
 * the party refuses the active, fainted and Egg Pokémon; a forced party has no cancel.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Bag, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppHost, type AppModel, type BagView, type PartyView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;
const state = newGameState(record, registries, loaded.order, 1);
const host: AppHost = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };

function press(app: AppModel, ...buttons: Button[]) {
  let result = null;
  for (const b of buttons) {
    result = app.step({ held: [b], pressed: [b], touch: null }) ?? result;
    result = app.step({ held: [], pressed: [], touch: null }) ?? result;
  }
  return result;
}
const tap = (app: AppModel, t: string) => app.step({ held: [], pressed: [], touch: null, tap: t });

const party = () => {
  const lead = setupPokemon(state, registries, 0, id('SPECIES_MOSSLET'), 10);
  const full = setupPokemon(state, registries, 1, id('SPECIES_EMBERKIT'), 10);
  const fainted = setupPokemon(state, registries, 2, id('SPECIES_DRIPLING'), 10);
  lead.hp = 3;
  fainted.hp = 0;
  return [lead, full, fainted];
};
const bag = (): Bag => ({
  items: [{ item: id('ITEM_LAMP_OIL'), count: 1 }],
  medicine: [{ item: id('ITEM_TONIC'), count: 2 }, { item: id('ITEM_CALM_LEAF'), count: 1 }, { item: id('ITEM_FOCUS_DROPS'), count: 1 }],
  balls: [{ item: id('ITEM_CAPTURE_ORB'), count: 5 }],
  tmhms: [],
  berries: [],
  mail: [],
  battle_items: [{ item: id('ITEM_SPARK_CHARM'), count: 1 }],
  key_items: [],
});

describe('battle bag (bag-select)', () => {
  const open = (o: { noRoomForBall?: boolean; noEffect?: Id[] } = {}) =>
    createApp({ app: 'bag-select', mode: 'battle', party: party(), active: 0, bag: bag(), noRoomForBall: o.noRoomForBall ?? false, noEffect: o.noEffect ?? [] }, { registries, state, log: { stub: () => {} }, host });

  it('a one-move PP item asks "Restore which move?" over the Pokémon\'s moves; a full move is refused; the pick closes with the move', () => {
    const p = party();
    p[0]!.pp = p[0]!.pp.map((x, i) => (i === 0 ? x : 0));
    const app = createApp({ app: 'bag-select', mode: 'battle', party: p, active: 0, bag: bag(), noRoomForBall: false, noEffect: [] }, { registries, state, log: { stub: () => {} }, host });
    tap(app, 'pocket:0');
    tap(app, 'row:1');
    expect(tap(app, 'slot:0')).toBeNull();
    const v = app.view() as PartyView;
    expect(v.prompt).toMatch(/^Refill which\sskill\?/);
    expect(v.menu!.entries.map((e) => e.label).slice(0, -1)).toEqual(p[0]!.moves.map((m) => registries.moves.get(m)!.name));
    expect(v.menu!.entries[1]!.right).toMatch(/^0\//);
    // The first move's PP is full: refused, and the press after it goes back to the bag (decomp TASK_STATE_EXIT).
    expect(tap(app, 'menu:0')).toBeNull();
    expect((app.view() as PartyView).message?.text).toBe('That would do nothing.');
    press(app, 'a');
    expect(app.view().app).toBe('bag');
    tap(app, 'row:1');
    tap(app, 'slot:0');
    press(app, 'down');
    expect(press(app, 'a')).toEqual({ app: 'bag-select', item: id('ITEM_FOCUS_DROPS'), target: 0, move: 1 });
  });

  it('groups the bag into the four battle pockets; field items are not there', () => {
    const app = open();
    const v = app.view() as BagView;
    expect(v).toMatchObject({ app: 'bag', mode: 'battle', pocket: 0, pockets: ['TONICS & DRAUGHTS', 'CURES & SALVES', 'ORBS', 'BOUT ITEMS'] });
    expect(v.rows.map((r) => r.item)).toEqual([id('ITEM_TONIC'), id('ITEM_FOCUS_DROPS')]);
    press(app, 'right');
    expect((app.view() as BagView).rows.map((r) => r.item)).toEqual([id('ITEM_CALM_LEAF')]);
    tap(app, 'pocket:2');
    expect((app.view() as BagView).rows.map((r) => r.label)).toEqual(['Capture Orb']);
    tap(app, 'pocket:3');
    expect((app.view() as BagView).rows.map((r) => r.label)).toEqual(['Spark Charm']);
  });

  it('a medicine asks for a Pokémon; one it would not help is refused and the bag comes back; the pick closes with item and target', () => {
    const app = open();
    tap(app, 'pocket:0');
    tap(app, 'row:0');
    const v = app.view() as PartyView;
    expect(v).toMatchObject({ app: 'party', mode: 'battle', prompt: 'Give it to whom?' });
    expect(tap(app, 'slot:1')).toBeNull();
    expect((app.view() as PartyView).message?.text).toBe('That would do nothing.');
    // A press ends the refusal and goes back to the bag (decomp BattlePartyTask_UseItem: no selection, TASK_STATE_EXIT).
    press(app, 'a');
    expect(app.view().app).toBe('bag');
    tap(app, 'row:0');
    expect(tap(app, 'slot:2')).toBeNull();
    expect((app.view() as PartyView).message?.text).toBe('That would do nothing.');
    // B and a tap end it the same way; B on the party itself also goes back.
    press(app, 'b');
    expect(app.view().app).toBe('bag');
    tap(app, 'row:0');
    expect(tap(app, 'slot:1')).toBeNull();
    tap(app, 'next');
    expect(app.view().app).toBe('bag');
    tap(app, 'row:0');
    press(app, 'b');
    expect(app.view().app).toBe('bag');
    tap(app, 'row:0');
    expect(tap(app, 'slot:0')).toEqual({ app: 'bag-select', item: id('ITEM_TONIC'), target: 0 });
  });

  it('balls and battle items close at once, unless refused; cancel returns no item', () => {
    tap(open(), 'pocket:2');
    let app = open();
    tap(app, 'pocket:2');
    expect(tap(app, 'row:0')).toEqual({ app: 'bag-select', item: id('ITEM_CAPTURE_ORB'), target: null });
    app = open({ noRoomForBall: true });
    tap(app, 'pocket:2');
    expect(tap(app, 'row:0')).toBeNull();
    expect((app.view() as BagView).message?.text).toBe('The archive is full!');
    app = open({ noEffect: [id('ITEM_SPARK_CHARM')] });
    tap(app, 'pocket:3');
    expect(tap(app, 'row:0')).toBeNull();
    expect((app.view() as BagView).message?.text).toBe('That will not help now!');
    expect(press(app, 'b')).toEqual({ app: 'bag-select', item: null, target: null });
  });

  it('refuses a ball while two wild Pokémon stand (bag-select twoWild), medicine still works', () => {
    const app = createApp({ app: 'bag-select', mode: 'battle', party: party(), active: 0, bag: bag(), noRoomForBall: true, noEffect: [], twoWild: true }, { registries, state, log: { stub: () => {} }, host });
    tap(app, 'pocket:2');
    expect(tap(app, 'row:0')).toBeNull();
    expect((app.view() as BagView).message?.text).toBe('Two stand there: no clear\nthrow!');
    tap(app, 'pocket:0');
    tap(app, 'row:0');
    expect(tap(app, 'slot:0')).toEqual({ app: 'bag-select', item: id('ITEM_TONIC'), target: 0 });
  });
});

describe('battle party (party-select)', () => {
  const open = (forced: boolean) => createApp({ app: 'party-select', mode: 'battle', party: party(), active: 0, forced }, { registries, state, log: { stub: () => {} }, host });

  it('refuses the active and the fainted Pokémon with the DS messages, sends in another', () => {
    const app = open(false);
    expect(app.view()).toMatchObject({ app: 'party', mode: 'battle', prompt: 'Who goes in?', cancel: 'BACK', cursor: 0 });
    expect(tap(app, 'slot:0')).toBeNull();
    // The refusal is in the two-line message window over the prompt, which stays the pick's prompt.
    expect(app.view()).toMatchObject({ prompt: 'Who goes in?', message: { text: 'Mosslet is out\nalready!', waiting: false } });
    // A, B or a tap clears it and does nothing else; directions wait.
    expect(press(app, 'right', 'b')).toBeNull();
    expect((app.view() as PartyView)).toMatchObject({ message: null, cursor: 0 });
    expect(tap(app, 'slot:2')).toBeNull();
    expect((app.view() as PartyView).message?.text).toBe('Dripling is too\nworn out to go!');
    expect(tap(app, 'slot:1')).toBeNull();
    expect(press(app, 'up', 'right', 'a')).toEqual({ app: 'party-select', slot: 1 });
    expect(press(open(false), 'b')).toEqual({ app: 'party-select', slot: null });
  });

  it('in a double, refuses the other battler\'s Pokémon (in battle) and the first command\'s pick (already selected)', () => {
    const p = [...party(), setupPokemon(state, registries, 3, id('SPECIES_MOSSLET'), 12)];
    const app = createApp({ app: 'party-select', mode: 'battle', party: p, active: 0, forced: false, inBattle: 1, selected: 3 }, { registries, state, log: { stub: () => {} }, host });
    expect(tap(app, 'slot:1')).toBeNull();
    expect((app.view() as PartyView).message?.text).toBe('Emberkit is out\nalready!');
    press(app, 'a');
    expect(tap(app, 'slot:3')).toBeNull();
    expect((app.view() as PartyView).message?.text).toBe('Mosslet is picked\nalready!');
    // A forced replacement for battler 2 (its slot `active` fainted): the standing battler 0's Pokémon is in battle.
    const forced = createApp({ app: 'party-select', mode: 'battle', party: p, active: 2, forced: true, inBattle: 0 }, { registries, state, log: { stub: () => {} }, host });
    expect((forced.view() as PartyView).cursor).toBe(2);
    expect(tap(forced, 'slot:0')).toBeNull();
    press(forced, 'b');
    expect(tap(forced, 'slot:3')).toEqual({ app: 'party-select', slot: 3 });
  });

  it('after a faint it cannot be cancelled', () => {
    const app = open(true);
    expect((app.view() as PartyView).cancel).toBe('');
    expect(press(app, 'b')).toBeNull();
    expect(tap(app, 'cancel')).toBeNull();
    expect(tap(app, 'slot:1')).toEqual({ app: 'party-select', slot: 1 });
  });
});

describe('the Pokédex entry after a catch (pokedex-entry)', () => {
  it('shows the caught species\' info page as caught, whatever the state says; A closes it', () => {
    const app = createApp({ app: 'pokedex-entry', species: id('SPECIES_SKYLET'), form: 0 }, { registries, state, log: { stub: () => {} }, host });
    const v = app.view();
    expect(v).toMatchObject({ app: 'pokedex', screen: 'entry', species: id('SPECIES_SKYLET'), caught: true, page: 'info', name: 'Skylet' });
    expect(state.pokedex.caught).not.toContain(id('SPECIES_SKYLET'));
    expect((v as { pages: { id: string; enabled: boolean }[] }).pages.filter((p) => p.enabled).map((p) => p.id)).toEqual(['info']);
    expect(press(app, 'down', 'r')).toBeNull();
    expect(press(app, 'a')).toEqual({ app: 'pokedex-entry' });
  });
});
