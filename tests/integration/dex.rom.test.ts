/**
 * svc-dex headless (OPENSINNOH_NDS_ROM): the Pokédex from the start menu, driven by the replay's keys and
 * taps through the real menu model; each `screenshot` beat checks what the Pokédex shows. Twice from
 * seed 1 (determinism) with a save round trip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Id, PackData, ReplayLine } from '@opensinnoh/core';
import { newGameRecord, type PokedexEntryView, type PokedexListView, type PokedexSearchView, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp, MenuText } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const REPLAY = readFileSync(join(import.meta.dirname, '../rom-replays/svc-dex.replay'), 'utf8');
const P = (s: string) => `platinum:SPECIES_${s}`;

/** What each beat shows: the Pokédex's own texts (pl_msg_pokedex_*) and the species' records, read from the ROM. */
const beats = (registries: Registries): Record<string, (v: PokedexListView | PokedexEntryView | PokedexSearchView) => void> => {
  const menu = new MenuText(registries);
  const dex = (key: string) => menu.message(`pl_msg_pokedex_${key}`);
  const record = (id: Id) => menu.text(id).trim();
  const piplup = registries.species.get(P('PIPLUP') as Id)!.dex!;
  const unknown = newGameRecord(registries).pokedexUnknown!;
  return {
  'dex-list': (v) => {
    const l = v as PokedexListView;
    expect(l.screen).toBe('list');
    expect(l.rows).toHaveLength(13);
    expect(l.rows.filter((r) => r.species).map((r) => [r.number, r.species, r.caught])).toEqual([
      ['007', P('PIPLUP'), true],
      ['010', P('STARLY'), false],
      ['013', P('BIDOOF'), false],
    ]);
    expect(l.counts.map((c) => [c.label, c.value])).toEqual([
      [dex('seen'), '3'],
      [dex('obtained'), '1'],
    ]);
    expect(l.switchLabel).toBeNull();
  },
  'dex-scrolled': (v) => expect((v as PokedexListView).cursor).toBe(9),
  'dex-entry-caught': (v) => {
    expect(v).toMatchObject({ screen: 'entry', page: 'info', species: P('PIPLUP'), number: '007', caught: true, category: record(piplup.category), types: ['platinum:TYPE_WATER'], height: { value: record(piplup.heightText) }, weight: { value: record(piplup.weightText) } });
    expect((v as PokedexEntryView).description).toBe(record(piplup.description));
  },
  // The cry page (the app draws its waveform and meter from the cry; headless there is no sound).
  'dex-cry': (v) => expect(v).toMatchObject({ screen: 'entry', page: 'cry', species: P('PIPLUP') }),
  'dex-area-unknown': (v) => expect((v as PokedexEntryView).area).toMatchObject({ unknown: dex('areaunknown'), cells: [], dungeons: [] }),
  'dex-size': (v) => expect((v as PokedexEntryView).size).toMatchObject({ pokemon: { height: record(piplup.heightText) }, trainer: { gender: 'male', height: dex('lucasheight') } }),
  // GameState v9 seen forms: Piplup seen as a female, then a male; the forms page lists both, first seen first.
  'dex-forms': (v) =>
    expect((v as PokedexEntryView).forms!.list).toEqual([
      { form: 0, female: true, label: dex('female') },
      { form: 0, female: false, label: dex('male') },
    ]),
  'dex-entry-seen': (v) => {
    expect(v).toMatchObject({ screen: 'entry', species: P('STARLY'), caught: false, category: record(unknown.category), types: [], description: '', footprint: null });
    expect((v as PokedexEntryView).pages.find((p) => p.id === 'size')!.enabled).toBe(false);
  },
  'dex-area': (v) => {
    const a = (v as PokedexEntryView).area!;
    expect(a.time).toBe(2);
    expect(a.unknown).toBeNull();
    expect(a.cells.length).toBeGreaterThan(10);
  },
  'dex-search': (v) => expect((v as PokedexSearchView).rows[0]!.value).toBe(1),
  'dex-results': (v) => expect((v as PokedexListView).rows.map((r) => r.species)).toEqual([P('BIDOOF'), P('PIPLUP'), P('STARLY')]),
  };
};

describe.skipIf(!romPath)('svc-dex (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  it('svc-dex.replay passes twice from seed 1 with a save round trip, and on seeds 2–3; every beat shows what it should', async () => {
    const log = new CountingStubLog(() => {});
    const game: Game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
    const seen: string[] = [];
    const BEATS = beats(game.registries);
    const result = await runReplay(gameDriver(game), REPLAY, {
      registries: game.registries,
      seed: 1,
      name: 'svc-dex.replay',
      repeat: true,
      beforeLine(line: ReplayLine) {
        if (line.action.type !== 'screenshot') return;
        const view = game.app();
        if (view?.app !== 'pokedex') throw new Error(`${line.action.name}: the Pokédex is not open`);
        BEATS[line.action.name]!(view);
        seen.push(line.action.name);
      },
    });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    // Both runs check every beat.
    expect(seen).toEqual([...Object.keys(BEATS), ...Object.keys(BEATS)]);
    // Seeds 2 and 3 once more, with the save round trip.
    for (const seed of [2, 3]) {
      const g = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
      const r = await runReplay(gameDriver(g), REPLAY, { registries: g.registries, seed, name: 'svc-dex.replay', repeat: false });
      expect(r.error, `seed ${seed}`).toBeUndefined();
      expect(r.roundTrip, `seed ${seed}`).toBe('identical');
    }
  }, 120_000);
});
