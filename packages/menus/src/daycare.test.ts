/** The daycare menu models on the fixture pack: the daycare party menu, the hatch scene and an egg's summary. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEgg, DEFAULT_CLOCK, hatchEgg, Prng, readPackFolder, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, dexOf, setupPokemon, type AppHost, type AppModel, type AppRequest, type GameState, type HatchView, type PartyView, type SummaryView } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;
const idle = { held: [], pressed: [], touch: null };

function fresh(): GameState {
  const s = newGameState(record, registries, loaded.order, 1);
  s.party.push(setupPokemon(s, registries, 0, id('SPECIES_MOSSLET'), 12));
  const rng = Prng.from({ seed: 7 });
  s.party.push(createEgg(dexOf(registries), { next: () => rng.next(), below: (n) => rng.below(n) }, { species: id('SPECIES_SKYLET'), trainer: { otId: s.trainerId, otName: s.names.player, otGender: s.gender }, ball: record.pokeBall, met: { zone: id('TOWN'), level: 0, date: '2026-01-02' } }));
  return s;
}
function open(s: GameState, request: AppRequest): AppModel {
  const host: AppHost = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
  return createApp(request, { registries, state: s, log: { stub: () => {} }, host });
}
const tap = (app: AppModel, t: string) => app.step({ ...idle, tap: t });

describe('the daycare party menu (PARTY_MENU_MODE_DAYCARE)', () => {
  it('offers STORE, SUMMARY, CANCEL (an egg: SUMMARY, CANCEL); STORE returns the slot, cancel none', () => {
    const s = fresh();
    const app = open(s, { app: 'daycare-select' });
    tap(app, 'slot:0');
    const v = app.view() as PartyView;
    expect(v.mode).toBe('daycare');
    expect(v.menu?.entries.map((e) => e.label)).toEqual(['LEAVE', 'DETAILS', 'BACK']);
    tap(app, 'menu:2');
    tap(app, 'slot:1');
    expect((app.view() as PartyView).menu?.entries.map((e) => e.label)).toEqual(['DETAILS', 'BACK']);
    expect((app.view() as PartyView).slots[1]).toMatchObject({ egg: true, name: 'Shell' });
    tap(app, 'menu:0');
    expect(app.view().app).toBe('summary');
    tap(app, 'back');
    tap(app, 'menu:1');
    expect(tap(app, 'slot:0')).toBeNull();
    expect(tap(app, 'menu:0')).toEqual({ app: 'daycare-select', slot: 0 });
    expect(tap(open(s, { app: 'daycare-select' }), 'cancel')).toEqual({ app: 'daycare-select', slot: null });
  });
});

describe("an egg's summary", () => {
  it('shows the TRAINER MEMO only: where it was received and the Egg Watch by cycles left', () => {
    const s = fresh();
    s.party[1]!.friendship = 4;
    const app = open(s, { app: 'start-menu' });
    tap(app, `entry:${(app.view() as { entries: { id: string }[] }).entries.findIndex((e) => e.id === 'pokemon')}`);
    tap(app, 'slot:1');
    tap(app, 'menu:0');
    const v = app.view() as SummaryView;
    expect(v.pages.map((p) => p.id)).toEqual(['memo']);
    expect(v.page).toBe('memo');
    expect(v.memo).toEqual(['JAN 2, 2026', 'A shell handed over', `at ${registries.zones.get(id('TOWN'))!.name}.`, 'Shell check:', 'It rattles. Any moment now!']);
    // The next Pokémon (not an egg) shows its own pages again.
    tap(app, 'next');
    expect((app.view() as SummaryView).pages.length).toBe(5);
  });
});

describe('the hatch scene (EggHatchCutscene_Normal)', () => {
  it('cracks the egg, shows the Pokémon and asks for a nickname; YES opens the naming screen', () => {
    const s = fresh();
    const egg = s.party[1]!;
    hatchEgg(dexOf(registries), egg, { ball: record.pokeBall, zone: id('TOWN'), date: '2026-01-03' });
    const app = open(s, { app: 'hatch', slot: 1 });
    const frames: number[] = [];
    let v = app.view() as HatchView;
    for (let i = 0; i < 400 && !v.yesNo; i++) {
      expect(app.step(idle)).toBeNull();
      v = app.view() as HatchView;
      if (v.egg && frames.at(-1) !== v.egg.frame) frames.push(v.egg.frame);
    }
    expect(frames).toEqual([0, 1, 2, 3, 4, 5]);
    expect(v).toMatchObject({ egg: null, bars: null, showMon: true, white: 0, message: { text: 'Give the newly hatched\nSkylet a name?' } });
    expect(tap(app, 'yes')).toBeNull();
    expect(app.view().app).toBe('naming');
    tap(app, 'type:Zip');
    expect(tap(app, 'ok')).toEqual({ app: 'hatch', nickname: 'Zip' });
  });

  it('NO closes without a nickname', () => {
    const s = fresh();
    hatchEgg(dexOf(registries), s.party[1]!, { ball: record.pokeBall, zone: null, date: null });
    const app = open(s, { app: 'hatch', slot: 1 });
    let result = null;
    for (let i = 0; i < 400 && !result; i++) result = app.step({ held: ['b'], pressed: ['b'], touch: null });
    expect(result).toEqual({ app: 'hatch', nickname: null });
  });
});
