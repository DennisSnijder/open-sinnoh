/**
 * The Poffin `sys-` replays, spread over files: each runs twice on seeds 1–3 with the driver's
 * save round trip.
 */
import { expect, it } from 'vitest';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

export function poffinReplay(file: string): void {
  for (const seed of [1, 2, 3]) {
    it(`${file}: twice on seed ${seed}, save round trip`, async () => {
      const { pack } = romSlice();
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
      const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 600000);
  }
}
