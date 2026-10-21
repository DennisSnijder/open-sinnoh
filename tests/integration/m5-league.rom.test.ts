/**
 * The League on the real ROM (OPENSINNOH_NDS_ROM): `m5-league-lost`, a loss to the Elite Four blacks out to the League's
 * Pokémon Center. A constructed start (setup lines); twice on seeds 1–3 with a save
 * round trip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

describe.skipIf(!ROM)('the Elite Four lost (OPENSINNOH_NDS_ROM)', () => {
  for (const seed of [1, 2, 3])
    it(`m5-league-lost.replay passes twice from seed ${seed} and round-trips its save`, async () => {
      const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
      const resolve: ReplayResolver = (f) => ({ name: f, text: read(f) });
      const result = await runReplay(gameDriver(game), read('m5-league-lost.replay'), { registries: game.registries, seed, name: 'm5-league-lost.replay', resolve });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      expect(game.state.party[0]!.hp).toBe(game.state.party[0]!.stats.hp);
    }, 600_000);
});
