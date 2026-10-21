/**
 * The Distortion World gate (final gate): the `dw-*` replays in tests/rom-replays,
 * one per room, from constructed starts (or chained with `from`) down the story path from 1F to the Giratina room's
 * portal to Sendoff Spring. Each asserts the 3D position, the support, the camera's saved angles, the story progress,
 * the puzzle and platform bits and the hidden ghost groups at its beats, and saves at rest on every surface it walks
 * (the land, both walls, a floor support, the ceiling). Each passes twice from seeds 1–3 and round-trips its save.
 * The routes were found by a breadth-first search over single steps of the engine itself (now
 * tools/replays/dw-search.ts); the replays are the plain input lines.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { ROM, romSlice } from '../rom.ts';

export function dwReplays(title: string, names: readonly string[]): void {
  describe.skipIf(!ROM)(`Distortion World replays: ${title} (OPENSINNOH_NDS_ROM)`, () => {
    let pack: PackData;
    beforeAll(() => {
      ({ pack } = romSlice());
    });
    const newGame = (seed: number) => createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });

    for (const name of names) {
      for (const seed of [1, 2, 3]) {
        it(`${name} passes twice from seed ${seed} and round-trips its save`, async () => {
          const game = newGame(seed);
          const file = `${name}.replay`;
          const result = await runReplay(gameDriver(game), readReplay(file), { registries: game.registries, seed, name: file, resolve: resolveReplay });
          expect(result.error).toBeUndefined();
          expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        }, 300_000);
      }
    }
  });
}
