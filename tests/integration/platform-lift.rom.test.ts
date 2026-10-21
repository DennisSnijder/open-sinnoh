/** The slice used by story replays must retain the same lift metadata as the full import. */
import { describe, expect, it } from 'vitest';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

describe.skipIf(!ROM)('platform lift presentation data (OPENSINNOH_NDS_ROM)', () => {
  it.each([
    ['IRON_ISLAND_B1F_RIGHT_ROOM', 11, 26, 'ironIsland', 16],
    ['IRON_ISLAND_B2F_LEFT_ROOM', 19, 48, 'ironIsland', 16],
    ['IRON_ISLAND_B3F', 9, 15, 'ironIsland', 16],
    ['POKEMON_LEAGUE_ELEVATOR_TO_AARON_ROOM', 4, 15, 'pokemonLeague', 0],
    ['POKEMON_LEAGUE_ELEVATOR_TO_BERTHA_ROOM', 4, 15, 'pokemonLeague', 0],
    ['POKEMON_LEAGUE_ELEVATOR_TO_FLINT_ROOM', 4, 15, 'pokemonLeague', 0],
    ['POKEMON_LEAGUE_ELEVATOR_TO_LUCIAN_ROOM', 4, 15, 'pokemonLeague', 0],
    ['POKEMON_LEAGUE_ELEVATOR_TO_CHAMPION_ROOM', 4, 23, 'pokemonLeague', 0],
    ['POKEMON_LEAGUE_CHAMPION_ROOM', 8, 18, 'pokemonLeague', 0],
  ] as const)('%s exposes its prop at the bottom floor without a stub', async (zone, x, z, kind, y) => {
    const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
    const wait = zone === 'POKEMON_LEAGUE_CHAMPION_ROOM' ? 'until message' : 'until idle';
    const r = await runReplay(gameDriver(game), `warp platinum:MAP_HEADER_${zone} ${x} ${z} up\n${wait}`, { registries: game.registries, seed: 1, repeat: false });
    expect(r.error).toBeUndefined();
    const props = [...game.registries.newGame.values()][0]!.platformLiftProps!;
    expect(props).toEqual({ ironIsland: 'platinum:prop/258', pokemonLeague: 'platinum:prop/502' });
    expect(game.registries.props.has(props[kind])).toBe(true);
    const lift = game.world.view().platformLift!;
    expect(lift.prop).toBe(props[kind]);
    expect(lift.position[1]).toBe(y);
    expect(lift.position[0]).toBeGreaterThan(0);
    expect(lift.position[2]).toBeGreaterThan(0);
    expect(game.log.report().filter((r) => r.key === 'platform-lift-prop')).toEqual([]);
  });
});
