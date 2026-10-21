/**
 * Script ops in the real game (OPENSINNOH_NDS_ROM): the Eterna statue scene (scr_cmd_32d, 331,
 * 32e, 332), the Galactic Eterna Building 4F fog (scr_cmd_2cd) and the Cycle Shop blackout spawn
 * (set_black_out_warp_id). Short headless replays from setup lines; none of these ops may log a stub.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const OPS = ['scr_cmd_32d', 'scr_cmd_32e', 'scr_cmd_331', 'scr_cmd_332', 'scr_cmd_2cd', 'set_black_out_warp_id'];

describe.skipIf(!romPath)('script ops (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  const play = async (name: string, text: string) => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed: 1, log, now: () => '2026-01-01T00:00:00.000Z' });
    const result = await runReplay(gameDriver(game), text, { registries: game.registries, seed: 1, name, repeat: false });
    expect(result.error, name).toBeUndefined();
    expect(result.ok, name).toBe(true);
    expect([...log.counts.keys()].filter((k) => OPS.some((op) => k.includes(op))), name).toEqual([]);
    return result;
  };

  it('the Eterna statue scene: Barry pushes the player, Cyrus (local 32) and local 2 stand at 9 tiles (144) as 331 forces', async () => {
    // Our world has every chunk loaded, so 32D/331 have no unknown heights to override: Eterna's terrain under
    // locals 32 and 2 is already the 144 units ScrCmd_331 sets on the DS.
    await play(
      'eterna-statue',
      `warp platinum:MAP_HEADER_ETERNA_CITY 302 524 right
until idle
+0 assert state objects[localId=32].y 144
+0 assert state objects[localId=2].y 144
+0 press right
+1 release right
until message
+0 assert state objects[localId=32].y 144
advance text 3000
until idle 3000
+0 assert state vars.platinum:VAR_ETERNA_CITY_STATE 1
`,
    );
  });

  it('Galactic Eterna Building 4F: its on-load script turns on weather effect 26 (the fog)', async () => {
    await play(
      'galactic-4f-fog',
      `warp platinum:MAP_HEADER_TEAM_GALACTIC_ETERNA_BUILDING_4F 8 3 down
until idle
+0 assert state weather "platinum:OVERWORLD_WEATHER_26"
`,
    );
  });

  it('the Cycle Shop: getting the Bicycle makes the Eterna Pokémon Center the blackout spawn (spawn 9)', async () => {
    await play(
      'cycle-shop-blackout',
      `set flag platinum:FLAG_HIDE_CYCLE_SHOP_POKEFAN_M false
warp platinum:MAP_HEADER_CYCLE_SHOP 3 6 up
until idle
+0 press a
+1 release a
advance text 3000
until idle 3000
+0 assert state bag.key_items[item="platinum:ITEM_BICYCLE"].count 1
+0 assert state blackOut "platinum:MAP_HEADER_ETERNA_CITY_POKECENTER_1F"
`,
    );
  });
});
