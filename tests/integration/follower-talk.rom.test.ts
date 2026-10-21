/**
 * Follower talk with the HGSS add-on (OPENSINNOH_NDS_ROM and OPENSINNOH_HGSS_ROM): A on the following Pokémon picks one of
 * HGSS's global rules and plays its interaction (a message from HGSS's bank, a bubble, motions), as `sys-follower-talk`
 * on seeds 1–3, twice with a save round trip, with the option on; with the contract default (off) A does nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import type { PackData } from '@opensinnoh/core';
import type { DeviceOptions } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, memoryDevice, runReplay, type ReplayResolver } from '@opensinnoh/game';
import { importHgssFollowers, platinumSpeciesOf } from '@opensinnoh/importer';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const HGSS = process.env.OPENSINNOH_HGSS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM || !HGSS)('follower talk with the HGSS add-on (OPENSINNOH_NDS_ROM, OPENSINNOH_HGSS_ROM)', () => {
  let hgss: PackData;
  beforeAll(async () => {
    hgss = (await importHgssFollowers(new Uint8Array(readFileSync(HGSS!)), platinumSpeciesOf)).pack;
  }, 300_000);
  const newGame = (seed: number, options: Partial<DeviceOptions>) =>
    createGame({ packs: [romSlice().pack, hgss], createWorld, createScriptRunner, createApp, createBattle, seed, log: new CountingStubLog(() => {}), device: memoryDevice(options), now: () => '2026-01-01T00:00:00.000Z' });

  for (const seed of [1, 2, 3])
    it(`sys-follower-talk: twice on seed ${seed}, save round trip`, async () => {
      const game = newGame(seed, { followerTalk: 0 });
      const result = await runReplay(gameDriver(game), read('sys-follower-talk.replay'), { registries: game.registries, seed, name: 'sys-follower-talk.replay', resolve, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 300_000);

  it('on, A shows the talk (a bubble or a message) and holds the field; off (the DS), A does nothing', async () => {
    const text = read('sys-follower-talk.replay');
    const upTo = text.indexOf('+1 press a');
    for (const on of [true, false]) {
      const game = newGame(1, { followerTalk: on ? 0 : 1 });
      const r = await runReplay(gameDriver(game), text.slice(0, upTo), { registries: game.registries, seed: 1, name: 'talk', resolve, repeat: false });
      expect(r.error).toBeUndefined();
      // The runner ends on a fresh load (its fade-in).
      for (let i = 0; i < 60 && !game.canSave(); i++) game.tick();
      game.press('a');
      game.tick();
      game.release('a');
      // Seed 1's roll picks an interaction with a bubble or a message (some have only motions and a bubble).
      let shown = false;
      let busy = false;
      for (let i = 0; i < 300 && !shown; i++) {
        game.tick();
        busy ||= !game.canSave();
        shown = !!game.scripts.view().message || game.world.view().actors.some((a) => a.bubble);
      }
      expect([shown, busy], `talk ${on ? 'on' : 'off'}`).toEqual([on, on]);
    }
  }, 300_000);
});
