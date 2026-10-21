/**
 * Double battles on the real ROM (OPENSINNOH_NDS_ROM): the double topologies, by their system replays, each
 * twice on seed 1 with a save round trip (docs/research/double-battles.md §6.3):
 * - `m5-double-twins`: Route 204 North's twins by sight (APPROACH_TYPE_DOUBLES), one double trainer (type 3);
 * - `m5-double-vs2`: two Eterna Forest psychics spotting the player together (APPROACH_TYPE_VS2), two trainers
 *   against the player alone (type 19);
 * - `m5-cheryl-wild-double`: Cheryl joins (has-partner, VAR_PARTNER_TRAINER_ID), a grass encounter is a wild double
 *   with her (type 74, healed after), then two trainers by sight battle her and the player (type 75).
 * Constructed starts (setup lines), labelled in each replay. The battle log asserts are the replays' own; no
 * double stub is logged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');

describe.skipIf(!ROM)('doubles: types 3, 19, 74 and 75 by sight and in the grass (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  });

  for (const file of ['m5-double-twins.replay', 'm5-double-vs2.replay', 'm5-cheryl-wild-double.replay']) {
    it(`${file} passes twice from seed 1 and round-trips its save`, async () => {
      const log = new CountingStubLog(() => {});
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
      const resolve: ReplayResolver = (f) => ({ name: f, text: read(f) });
      const topologies: string[] = [];
      const result = await runReplay(gameDriver(game), read(file), {
        registries: game.registries,
        seed: 1,
        name: file,
        resolve,
        beforeLine: () => {
          for (const b of game.battles.slice(topologies.length)) topologies.push(`${b.kind}:${b.topology}:${b.result}`);
        },
      });
      console.log(`${file}: ${result.ticks} ticks, ${result.assertions} asserts, battles ${topologies.join(', ')}; stubs ${log.report().map((s) => `${s.key}×${s.count}`).join(', ')}`);
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      expect(log.report().map((s) => s.key)).not.toContain('stub:double-battle');
      expect(log.report().filter((s) => s.key.startsWith('battle:party-in-battle') || s.key.startsWith('battle:bag-two-wild'))).toEqual([]);
    }, 900_000);
  }
});
