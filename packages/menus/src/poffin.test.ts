/** The Poffin menus on the fixture pack: the Poffin Case's GIVE (party, summary, eating, the condition's change). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppHost, type AppModel, type AppRequest, type GameState, type PoffinCaseView, type SummaryView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const idle = { held: [], pressed: [], touch: null };

function fresh(): GameState {
  const s = newGameState(record, registries, loaded.order, 1);
  s.party.push(setupPokemon(s, registries, 0, 'fixture:SPECIES_MOSSLET' as Id, 12));
  s.poffins = [{ type: 7, flavors: [0, 32, 32, 0, 0], smoothness: 20 }];
  return s;
}
function open(s: GameState, request: AppRequest): AppModel {
  const host: AppHost = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  return createApp(request, { registries, state: s, log: { stub: () => {} }, host });
}
const tap = (app: AppModel, t: string) => app.step({ ...idle, tap: t });
const press = (app: AppModel, button: 'a' | 'b') => app.step({ ...idle, held: [button], pressed: [button] });
function until(app: AppModel, name: string): void {
  for (let i = 0; i < 2000 && app.view().app !== name; i++) app.step(idle);
  expect(app.view().app).toBe(name);
}

describe('the Poffin Case (poffin_case/main.c)', () => {
  it('GIVE: the party, the summary CONDITION and OK, the eating, then A feeds and the raised conditions show', () => {
    const s = fresh();
    const app = open(s, { app: 'poffin-case' });
    expect((app.view() as PoffinCaseView).app).toBe('poffin-case');
    tap(app, 'row:0');
    tap(app, 'menu:0');
    until(app, 'party');
    tap(app, 'slot:0');
    until(app, 'summary');
    const feed = app.view() as SummaryView;
    expect([feed.mode, feed.page]).toEqual(['feed', 'condition']);
    tap(app, 'ok');
    until(app, 'poffin-feed');
    until(app, 'summary');
    expect((app.view() as SummaryView).mode).toBe('condition-change');
    const before = { ...s.party[0]!.condition };
    for (let i = 0; i < 12 && app.view().app === 'summary'; i++) {
      press(app, 'a');
      for (let j = 0; j < 8; j++) app.step(idle);
    }
    until(app, 'poffin-case');
    expect(s.poffins).toEqual([]);
    const after = s.party[0]!.condition;
    expect(after.sheen).toBe(before.sheen + 20);
    expect(after.beauty + after.cute).toBeGreaterThan(before.beauty + before.cute);
  });
});
