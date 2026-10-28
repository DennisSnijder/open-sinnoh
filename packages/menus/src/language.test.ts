/**
 * The menus in a German game on the fixture pack (its new game's language set to 5, our own names; no ROM text):
 * the naming screen's keyboard, typed input and gift-code prompt, and the Pokédex search's A–Z order and name groups.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, GERMAN, readPackFolder, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, type AppHost, type AppModel, type AppRequest, type GameState, type NamingView, type NewGame, type Registries, type Species } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp, dexLists, NO_QUERY, searchDex } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;

/** The fixture as a German game, `names` replacing species names by id. */
function german(names: Record<string, string> = {}): Registries {
  const species = new Map([...registries.species].map(([id, s]): [Id, Species] => [id, names[id] ? { ...s, name: names[id] } : s]));
  return { ...registries, species, newGame: new Map([[record.id, { ...record, language: GERMAN } as NewGame]]) };
}

function open(reg: Registries, request: AppRequest): AppModel {
  const host: AppHost = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  return createApp(request, { registries: reg, state: newGameState(record, reg, loaded.order, 1), log: { stub: () => {} }, host });
}
const naming = (app: AppModel) => app.view() as NamingView;
const tap = (app: AppModel, t: string) => app.step({ held: [], pressed: [], touch: null, tap: t });
const player: AppRequest = { app: 'naming', kind: 'player', initial: '', maxLength: 7, gender: 'male', pokemon: null };

describe('the naming screen in the game language', () => {
  it('English: the US pages; umlauts typed on a keyboard are not taken', () => {
    const app = open(registries, player);
    expect(naming(app).keys[3]!.join('')).toBe('             ');
    tap(app, 'type:Jürgen');
    expect(naming(app).text).toBe('Jrgen');
  });

  it('German: Ä Ö Ü on the fourth row, ä ö ü ß on the lowercase page, umlauts and „“ typed', () => {
    const app = open(german(), player);
    expect(naming(app).keys[3]!.join('')).toBe('ÄÖÜ          ');
    tap(app, 'key:3:1');
    tap(app, 'page:1');
    expect(naming(app).keys[3]!.join('')).toBe('äöüß         ');
    tap(app, 'key:3:3');
    tap(app, 'type:„ü“');
    expect(naming(app).text).toBe('Öß„ü“');
  });

  it('asks for the gift code in the game language', () => {
    const gift: AppRequest = { app: 'naming', kind: 'gift-code', initial: '', maxLength: 8, gender: 'male', pokemon: null };
    expect(naming(open(registries, gift)).prompt).toBe('Gift code?');
    expect(naming(open(german(), gift)).prompt).toBe('Geschenkcode?');
  });
});

describe('the Pokédex search in the game language', () => {
  it('orders A–Z by letters alone and files umlauts under their letter', () => {
    const reg = german({ 'fixture:SPECIES_MOSSLET': 'ÖLMOOS', 'fixture:SPECIES_EMBERKIT': 'O-LMA', 'fixture:SPECIES_DRIPLING': 'OLM' });
    const { national, types } = dexLists(reg);
    const all = national.map((e) => e.species.id);
    const state = { pokedex: { obtained: true, national: true, seen: all, caught: all } } as unknown as GameState;
    const names = (name: number) => searchDex(national, { ...NO_QUERY, order: 1, name }, state, types, GERMAN).map((e) => e.species.name);
    // MNO: OLM, O-LMA (OLMA), ÖLMOOS (OLMOOS) — the code-unit order would put O-LMA first and ÖLMOOS after Z.
    expect(names(5).filter((n) => n.startsWith('O') || n.startsWith('Ö'))).toEqual(['OLM', 'O-LMA', 'ÖLMOOS']);
  });
});
