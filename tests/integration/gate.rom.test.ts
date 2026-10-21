/**
 * The gate fixes on the real ROM (OPENSINNOH_NDS_ROM): Cycling Road (Route 206 onResume →
 * get_previous_map_id, force_bicycling) and the platform lifts (Iron Island B3F, the Pokémon League).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Id, PackData } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (name: string) => `platinum:${name}` as Id;

describe.skipIf(!romPath)('gate fixes (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  });
  const newGame = () => createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });
  const run = async (text: string) => {
    const game = newGame();
    const driver = gameDriver(game);
    const reset = driver.reset;
    driver.reset = (seed) => {
      void reset(seed);
      game.wildBattles = 'flee';
    };
    return { game, result: await runReplay(driver, text, { registries: game.registries, seed: 1, repeat: false }) };
  };

  it('Cycling Road: out of the north gate the Route 206 onResume forces the bike, and with no input it rolls south down the road', async () => {
    // Driven by hand after the setup: a save round trip would run onResume again (as on the DS), which
    // rewrites map-local vars, so the replay runner's round trip does not apply on Route 206.
    const { game, result } = await run(`player cycle 1
warp platinum:MAP_HEADER_ROUTE_206_CYCLING_ROAD_NORTH_GATE 7 11 down
until idle
`);
    expect(result.error).toBeUndefined();
    // Down onto the elevated road (BRIDGE_START at z 593), then let go.
    game.press('down');
    for (let i = 0; i < 200 && game.state.player.z < 596; i++) game.tick();
    game.release('down');
    expect(game.state.previousZone).toBe(P('MAP_HEADER_ROUTE_206_CYCLING_ROAD_NORTH_GATE'));
    expect(game.state.flags[P('FLAG_ON_CYCLING_ROAD')]).toBe(true);
    const z = game.state.player.z;
    // 2 ticks a tile with no input (until the cyclist at (302, 601) spots the player), on the bike, facing south.
    game.advance(8);
    expect(game.state.player.z - z).toBeGreaterThanOrEqual(3);
    expect(game.state.player).toMatchObject({ x: 304, facing: 'down' });
    expect(game.state.playerState).toBe('cycle');
  });

  /** Loads a zone as a map change (onTransition runs) at x/z. */
  const enterZone = (game: Game, zone: string, x: number, z: number) => {
    const state = structuredClone(game.state);
    state.player = { ...state.player, zone: P(`MAP_HEADER_${zone}`), x, z, facing: 'up' };
    state.objects = [];
    game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }, 'arrival');
    for (let i = 0; i < 60 && !game.world.idle(); i++) game.tick();
  };

  it('Iron Island B3F: arriving on the bottom floor, the coord event rides the lift up 128 units; a save keeps the floor', () => {
    const game = newGame();
    enterZone(game, 'IRON_ISLAND_B3F', 14, 15);
    expect(game.state.platformLift).toEqual({ lift: 2, floor: 'bottom', notUsedWhenEntered: true });
    // Onto the lift (the plate is x 8–10, z 11–12, at height 16) from its south edge: a saved game keeps the floor.
    const saved = game.save();
    saved.state.player = { ...saved.state.player, x: 9, z: 12, y: 16, facing: 'up' };
    game.load(JSON.parse(JSON.stringify(saved)));
    for (let i = 0; i < 30 && !game.world.idle(); i++) game.tick();
    expect(game.state.player.y).toBe(16);
    game.press('up');
    game.tick();
    game.release('up');
    let ticks = 0;
    for (; ticks < 400 && !(game.state.platformLift?.floor === 'top' && !game.snapshot().scriptRunning && game.world.idle()); ticks++) game.tick();
    expect(game.state.player).toMatchObject({ x: 9, z: 11, y: 144 });
    expect(game.state.platformLift).toMatchObject({ floor: 'top' });
    expect(ticks).toBeGreaterThan(128);
  });

  it('the League lifts go up only: entered from the top floor they were used, and the coord event does nothing', () => {
    const game = newGame();
    enterZone(game, 'POKEMON_LEAGUE_ELEVATOR_TO_AARON_ROOM', 4, 2);
    expect(game.state.platformLift).toEqual({ lift: 3, floor: 'top', notUsedWhenEntered: false });
    expect(game.state.player.y).toBe(160);
  });
});
