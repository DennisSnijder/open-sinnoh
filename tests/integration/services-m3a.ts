/**
 * Service replays, headless (OPENSINNOH_NDS_ROM): the PC boxes from a
 * Pokémon Center PC (and release, marks and compare mode), the naming keyboard (a nickname in Rowan's lab and by typing), the bag (a Potion,
 * a TM with the forget flow, Repel, toss, register), the party (switch, items, summary, a field move)
 * and the trainer card. Each runs twice from seed 1 (determinism) with a save round trip;
 * seeds 2 and 3 run once more. The menu apps are the real models, driven by buttons and taps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import type { PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
export const SERVICE_REPLAYS_M3A = ['svc-pc-storage', 'svc-pc-compare', 'svc-naming', 'svc-bag', 'svc-party', 'svc-card', 'svc-name-rater', 'svc-registered', 'svc-repel', 'svc-bag-bicycle'];

export function describeServicesM3a(group: 0 | 1): void {
  describe.skipIf(!romPath)('service replays (OPENSINNOH_NDS_ROM)', () => {
    let pack: PackData;
    beforeAll(() => {
      ({ pack } = romSlice());
    }, 60_000);

    const play = (name: string, seed: number, repeat: boolean) => {
      const log = new CountingStubLog(() => {});
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
      const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
      return runReplay(gameDriver(game), read(`${name}.replay`), { registries: game.registries, seed, name: `${name}.replay`, resolve, repeat });
    };

    if (group === 0) it('svc-repel is a real test: without the Repel the same walk meets wild Pokémon on seeds 1–3', async () => {
      const text = read('svc-repel.replay').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF line ends
      // The same replay with no Repel steps and, in place of its asserts, a wild encounter met on the way.
      const without = `${text.replace(/^set state repel 100\n/m, '').replace(/^\+0 assert (battles wild 0|state repel \d+)\n/gm, '')}+0 assert state battles[0].kind "wild"\n`;
      expect(without.split('\n').filter((l) => !l.startsWith('#')).join('\n')).not.toMatch(/repel|assert battles/);
      for (const seed of [1, 2, 3]) {
        const log = new CountingStubLog(() => {});
        const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
        const r = await runReplay(gameDriver(game), without, { registries: game.registries, seed, name: 'svc-repel (no Repel)', repeat: false });
        expect(r.error, `seed ${seed}`).toBeUndefined();
        expect(r.ok, `seed ${seed}`).toBe(true);
      }
    }, 120_000);

    for (const name of SERVICE_REPLAYS_M3A.filter((_, i) => i % 2 === group)) {
      it(`${name}.replay passes twice from seed 1 with a save round trip, and on seeds 2–3`, async () => {
        const result = await play(name, 1, true);
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        for (const seed of [2, 3]) {
          const r = await play(name, seed, false);
          expect(r.error, `seed ${seed}`).toBeUndefined();
          expect(r.roundTrip, `seed ${seed}`).toBe('identical');
        }
      }, 120_000);
    }
  });
}
