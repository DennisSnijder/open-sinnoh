/**
 * On the real ROM (OPENSINNOH_NDS_ROM): the Giratina room's native script for every outcome its
 * get_battle_result branches on: `sys-giratina-caught|defeated|fled`, each twice
 * on seeds 1–3 with a save round trip. A constructed start in the room; its story objects are the Distortion
 * World's own. Separate `m5-giratina-caught|fled` tests branch from CP15's story prefixes.
 */
import { describe, expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { ROM, romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

describe.skipIf(!ROM)('the Giratina room (OPENSINNOH_NDS_ROM)', () => {
  for (const file of ['sys-giratina-caught', 'sys-giratina-defeated', 'sys-giratina-fled'])
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
        await game.loadBattleEngine();
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      }, 300_000);
});
