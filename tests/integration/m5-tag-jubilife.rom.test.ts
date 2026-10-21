/**
 * The Jubilife tag battle on the real ROM (OPENSINNOH_NDS_ROM): the Jubilife tag battle,
 * `m5-tag-jubilife.replay` from CP4's end, twice on seed 1 with a save round trip. The battle is real (no
 * `stub:double-battle`): the player and the counterpart against grunts 414 and 415 on the `ai-partner`
 * topology (decomp type 75), and the script's victory branch sets VAR_JUBILIFE_CITY_STATE 4 and gives the
 * Fashion Case (the replay's asserts).
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

describe.skipIf(!ROM)('the Jubilife tag battle (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  });

  it('m5-tag-jubilife.replay passes twice from seed 1 and round-trips its save', async () => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
    const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
    const result = await runReplay(gameDriver(game), read('m5-tag-jubilife.replay'), { registries: game.registries, seed: 1, name: 'm5-tag-jubilife.replay', resolve });
    console.log(`m5-tag-jubilife: ${result.ticks} ticks, ${result.assertions} asserts, round trip ${JSON.stringify(result.roundTrip)}; stubs ${log.report().map((s) => `${s.key}×${s.count}`).join(', ')}`);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.determinism).toBe('identical');
    expect(result.roundTrip).toBe('identical');
    // The battle log asserts (trainer, result, topology) are the replay's own; the log is not saved.
    expect(log.report().map((s) => s.key)).not.toContain('stub:double-battle');
  }, 900_000);
});
