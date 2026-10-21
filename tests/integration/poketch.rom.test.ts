/**
 * svc-poketch headless (OPENSINNOH_NDS_ROM): the Pokétch from the Jubilife president, driven by the replay's
 * panel touches through the real Pokétch model; each `screenshot` beat checks what the Pokétch shows.
 * Twice from seeds 1–3 (determinism) with a save round trip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData, ReplayLine } from '@opensinnoh/core';
import type { PoketchView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp, createPoketch } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const REPLAY = readFileSync(join(import.meta.dirname, '../rom-replays/svc-poketch.replay'), 'utf8');
const app = (s: string) => `platinum:POKETCH_APPID_${s}`;

/** What each beat shows. */
export const POKETCH_BEATS: Record<string, (v: PoketchView) => void> = {
  'poketch-dowsing-start': (v) => expect(v).toMatchObject({ app: app('DOWSINGMACHINE'), cover: 0, sprites: [] }),
  'poketch-watch': (v) => expect(v).toMatchObject({ app: app('DIGITALWATCH'), cover: 0, info: { time: '12:00' } }),
  'poketch-calc-15': (v) => expect(v).toMatchObject({ app: app('CALCULATOR'), info: { display: '15', op: null } }),
  'poketch-calc-18': (v) => expect(v.info.display).toBe('18'),
  'poketch-pedometer-0': (v) => expect(v).toMatchObject({ app: app('PEDOMETER'), info: { steps: 0 } }),
  'poketch-pedometer-6': (v) => expect(v.sprites.slice(1).map((s) => s.anim!.seq)).toEqual([0, 0, 0, 0, 6]),
  'poketch-party': (v) => {
    expect(v.app).toBe(app('PARTYSTATUS'));
    expect(v.icons).toMatchObject([{ species: 'platinum:SPECIES_PIPLUP', x: 64, y: 36, scale: 2 }]);
  },
  'poketch-dowsing': (v) => expect(v).toMatchObject({ app: app('DOWSINGMACHINE'), cover: 0 }),
  'poketch-dowsing-ping': (v) => {
    expect(v.info).toMatchObject({ result: 'near', items: ['112,156'] });
    expect(v.sprites).toMatchObject([{ sheet: 'poketch/dowsing_machine', anim: { seq: 0 }, x: 112, y: 150 }]);
  },
  'poketch-dowsing-found': (v) => expect(v.sprites).toMatchObject([{ sheet: 'poketch/dowsing_machine', anim: { seq: 3 }, x: 112, y: 156 }]),
};

describe.skipIf(!romPath)('svc-poketch (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  it.each([1, 2, 3])('svc-poketch.replay passes twice from seed %i with a save round trip; every beat shows what it should', async (seed) => {
    const log = new CountingStubLog(() => {});
    const game: Game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, createPoketch, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const seen: string[] = [];
    const result = await runReplay(gameDriver(game), REPLAY, {
      registries: game.registries,
      seed,
      name: 'svc-poketch.replay',
      repeat: true,
      beforeLine(line: ReplayLine) {
        if (line.action.type !== 'screenshot') return;
        const view = game.poketch();
        if (!view) throw new Error(`${line.action.name}: the Pokétch does not run`);
        POKETCH_BEATS[line.action.name]!(view);
        seen.push(line.action.name);
      },
    });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    expect(seen).toEqual([...Object.keys(POKETCH_BEATS), ...Object.keys(POKETCH_BEATS)]);
  }, 120_000);
});
