/**
 * The Great Marsh and its Safari Game (docs/research/great-marsh.md): constructed starts at the Pastoria gate, each run
 * twice on seeds 1–3 with a save round trip. The ops under test may log no stub. Seed-dependent outcomes (catches,
 * flights, the daily species, the binoculars' spots) are checked here, not in the replays.
 */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { marshDailyOf } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { newGameRecord } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld, dailyMarshSpecies } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const OPS = ['start_end_safari_game', 'get_current_safari_game_caught_num', 'init_great_marsh_tram', 'move_great_marsh_tram', 'check_great_marsh_tram_location', 'start_great_marsh_lookout'];

const dailies = (game: Game) => {
  const g = newGameRecord(game.registries).greatMarsh!;
  return g.zones.map((z) => dailyMarshSpecies(g, game.state, z));
};

const CHECKS: Record<string, (game: Game, logged: string[], seed: number) => void> = {
  // The battle log does not survive the round trip's reset: the state tells what happened.
  'sys-safari-battle': (game) => {
    const caught = game.state.safari!.caught;
    expect(caught).toBeLessThanOrEqual(2);
    expect(game.state.party.length).toBe(1 + caught);
    for (const mon of game.state.party.slice(1)) {
      expect(mon.species).toBe('platinum:SPECIES_WOOPER');
      expect(mon.ball).toBe('platinum:ITEM_SAFARI_BALL');
    }
    // Both Woopers may run off before a ball is thrown; a catch takes one at least.
    expect(game.state.safari!.balls).toBeLessThanOrEqual(30 - caught);
  },
  'sys-safari-balls': (game) => {
    expect(game.state.party.length).toBe(1 + game.state.safari!.caught);
  },
  'sys-safari-daily': (game) => {
    // The day's value replaced the new game's: the marsh daily is the RecordMixedRNG value now.
    expect(game.state.gameTime.marshDaily).toBe(game.state.gameTime.dailyRandom);
    const g = newGameRecord(game.registries).greatMarsh!;
    for (const [area, species] of dailies(game).entries()) expect(species).toBe(g.daily.regional[(marshDailyOf(game.state) >>> (5 * area)) & 31]);
  },
  'sys-safari-binoculars': (game) => {
    // The last view was in the marsh (the binoculars' temporary map changes record it as the previous map).
    expect(game.state.previousZone).toMatch(/GREAT_MARSH_\d$/);
  },
};

const FILES = ['sys-safari-retire', 'sys-safari-steps', 'sys-safari-battle', 'sys-safari-balls', 'sys-safari-daily', 'sys-safari-binoculars', 'sys-safari-tram'];

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the Great Marsh and the Safari Game', () => {
  for (const file of FILES)
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const log = new CountingStubLog(() => {});
        const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2009-03-22T12:00:00Z' });
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
        if (result.error) throw new Error(result.error);
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        CHECKS[file]?.(game, [...log.counts.keys()], seed);
        expect([...log.counts.keys()].filter((k) => OPS.some((op) => k.includes(op)))).toEqual([]);
      }, 300_000);

  it('the daily species change with the day, and the National Pokédex swaps the table', () => {
    const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
    const g = newGameRecord(game.registries).greatMarsh!;
    expect(g.zones).toHaveLength(6);
    expect(g.lookout).toHaveLength(36);
    const s = game.state;
    s.gameTime.marshDaily = 0;
    expect(dailies(game)).toEqual(Array(6).fill(g.daily.regional[0]));
    s.gameTime.marshDaily = 0b11111_00000_00000_00000_00000_00011;
    expect(dailies(game)[0]).toBe(g.daily.regional[3]);
    expect(dailies(game)[5]).toBe(g.daily.regional[31]);
    s.pokedex.national = true;
    expect(dailies(game)[0]).toBe(g.daily.national[3]);
    expect(() => dailyMarshSpecies(g, s, 'platinum:MAP_HEADER_PASTORIA_CITY' as Id)).toThrow(/not a Great Marsh area/);
  });
});
