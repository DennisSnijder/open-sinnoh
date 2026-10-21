/**
 * The special encounters on the ROM: honey trees, the Poké Radar, swarms, the Trophy
 * Garden, Sweet Scent and Honey, Pokérus on the clock. The imported tables are checked against the decomp's, and each
 * `sys-` replay runs twice on seeds 1–3 with the driver's save round trip; its ops may log no stub. The garden's Pokémon
 * depends on the seed: the test reads it as the player would (Mr. Backlot names it) and plays the battle in a replay it
 * writes.
 */
import { describe, expect, it } from 'vitest';
import { newGameRecord, type NewGame } from '@opensinnoh/contracts';
import { dailyRandomOf, munchlaxTrees, swarmIndex, type Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

/** The ops and logs: none may be a stub any more. */
const OPS = ['get_honey_tree_status', 'slather_honey_tree', 'start_honey_tree_battle', 'stop_honey_tree_shaking', 'enable_swarms', 'get_swarm_map_and_species', 'add_trophy_garden_mon', 'get_trophy_garden_slot1_species', 'field:item-use', 'poketch:trainer-counter', 'poketch:berries'];

const newGame = (seed = 1, log = new CountingStubLog(() => {})) =>
  createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2009-03-22T12:00:00Z' });

const CHECKS: Record<string, (game: Game) => void> = {
  'sys-honey-tree': (game) => {
    // Route 205 South is a Munchlax tree for this trainer id; the battle left it slathered again, then the day passed.
    expect(munchlaxTrees(game.state.trainerId)).toContain(0);
    expect(game.state.encounters!.honeyTrees[0]!.minutes).toBe(0);
  },
  'sys-poke-radar': (game) => {
    // The best chain is the one walked; the reload ended the live chain.
    expect(game.state.encounters!.radarRecords[0]!.count).toBe(10);
    expect(game.world.radarChain()).toBeNull();
  },
  'sys-swarm': (game) => {
    // The day's value replaced the swarm daily the twin named.
    expect(game.state.gameTime.swarmDaily).toBe(dailyRandomOf(game.state));
    expect(swarmIndex(game.state.gameTime.swarmDaily!)).toBe(swarmIndex(dailyRandomOf(game.state)));
  },
  'sys-trophy-garden': (game) => {
    const [first, second] = game.state.encounters!.trophyGarden;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  },
};

export const SPECIAL_ENCOUNTER_REPLAYS = ['sys-honey-tree', 'sys-poke-radar', 'sys-swarm', 'sys-trophy-garden', 'sys-sweet-scent', 'sys-sweet-scent-snow', 'sys-pokerus'];

/** Plays `part`, then a battle against `species` in `zone`'s grass (`until wild`, running from the others). */
const battleText = (part: string, zone: Id, at: { x: number; z: number }, species: Id) =>
  `from ${part}\n# The battle the player goes to.\nwarp ${zone} ${at.x} ${at.z} left\nuntil idle\nuntil wild ${species} left right 90000\nuntil battle\n+0 battle run\nuntil battle end\nuntil idle\n`;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('special encounters (OPENSINNOH_NDS_ROM)', () => {
  it('imports the honey trees, swarms, the Trophy Garden and the Poké Radar as the decomp has them', () => {
    const { pack } = romSlice();
    const ng = (pack.registries.newGame as unknown as NewGame[])[0]!;
    const e = ng.specialEncounters!;
    expect(e.honeyTrees.zones).toHaveLength(21);
    expect(e.honeyTrees.zones[0]).toBe('platinum:MAP_HEADER_ROUTE_205_SOUTH');
    expect(e.honeyTrees.zones[20]).toBe('platinum:MAP_HEADER_FLOAROMA_MEADOW');
    expect(e.honeyTrees.tables[2]).toEqual(Array(6).fill('platinum:SPECIES_MUNCHLAX'));
    expect(e.honeyTrees.tables[1]![5]).toBe('platinum:SPECIES_HERACROSS');
    expect(e.swarms).toHaveLength(22);
    expect(e.swarms[0]).toBe('platinum:MAP_HEADER_ROUTE_201');
    expect(e.swarms[21]).toBe('platinum:MAP_HEADER_ETERNA_FOREST');
    expect(e.trophyGarden.zone).toBe('platinum:MAP_HEADER_TROPHY_GARDEN');
    expect(e.trophyGarden.species).toHaveLength(16);
    expect(e.trophyGarden.species).toContain('platinum:SPECIES_EEVEE');
    expect(ng.berries!.searcher).toHaveLength(118);
  });

  for (const file of SPECIAL_ENCOUNTER_REPLAYS)
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const log = new CountingStubLog(() => {});
        const game = newGame(seed, log);
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
        if (result.error) throw new Error(result.error);
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        CHECKS[file]?.(game);
        expect([...log.counts.keys()].filter((k) => OPS.some((op) => k.includes(op)))).toEqual([]);
      }, 300_000);

  for (const seed of [1, 2, 3]) {
    it(`the Trophy Garden's Pokémon of the day in slots 6–7 (seed ${seed}, twice, round trip)`, async () => {
      const probe = newGame(seed);
      const first = await runReplay(gameDriver(probe), readReplay('parts/trophy-garden-office.replay'), { name: 'parts/trophy-garden-office.replay', registries: probe.registries, resolve: resolveReplay, seed });
      if (first.error) throw new Error(first.error);
      const tables = newGameRecord(probe.registries).specialEncounters!.trophyGarden;
      const species = tables.species[probe.state.encounters!.trophyGarden[0]!]!;
      const game = newGame(seed);
      const text = battleText('parts/trophy-garden-office.replay', tables.zone, { x: 15, z: 12 }, species);
      const result = await runReplay(gameDriver(game), text, { name: 'sys-trophy-garden-battle.replay', registries: game.registries, resolve: resolveReplay, seed, repeat: true });
      if (result.error) throw new Error(result.error);
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 600_000);
  }

  /** A game standing at Route 222's grass (744, 778) with the Radar charged, its patches shaking out. */
  const radarGame = () => {
    const game = newGame(1);
    const state = structuredClone(game.state);
    state.party = [];
    state.player = { ...state.player, zone: 'platinum:MAP_HEADER_ROUTE_222' as Id, x: 744, z: 778, y: 0, facing: 'up' };
    state.objects = [];
    state.encounters = { honeyTrees: Array.from({ length: 21 }, () => ({ minutes: 0, slot: 0, table: 0, group: 0, shakes: 0 })), lastHoneyTree: 21, radarCharge: 50, radarRecords: [0, 1, 2].map(() => ({ species: null, count: 0 })), swarms: false, trophyGarden: [null, null] };
    game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }, 'arrival');
    game.advance(30);
    game.world.pokeRadar();
    game.advance(60);
    expect(game.world.radarPatches()?.patches.length).toBeGreaterThan(0);
    return game;
  };

  it('ends the Poké Radar chain on the bike, a warp, a load and a scripted battle (RadarChain_Clear)', () => {
    const bike = radarGame();
    bike.world.setPlayerState('cycle');
    expect(bike.world.radarPatches()).toBeNull();
    const warp = radarGame();
    warp.world.warp('platinum:MAP_HEADER_ROUTE_222' as Id, 750, 777, 'down');
    warp.advance(60);
    expect(warp.world.radarPatches()).toBeNull();
    const load = radarGame();
    load.load(load.save());
    expect(load.world.radarPatches()).toBeNull();
    const battle = radarGame();
    battle.world.startBattle({ kind: 'static', trainers: [], wild: [{ species: 'platinum:SPECIES_BIDOOF' as Id, level: 5 }] });
    expect(battle.world.radarPatches()).toBeNull();
    // The charge emptied with the use; the records stay.
    expect(load.state.encounters!.radarCharge).toBe(0);
  });

  it('shakes a honey tree whose Pokémon waits when its map loads (the honey tree prop with its shake clip)', () => {
    const game = newGame(1);
    const state = structuredClone(game.state);
    state.player = { ...state.player, zone: 'platinum:MAP_HEADER_ROUTE_205_SOUTH' as Id, x: 213, z: 653, y: 0, facing: 'up' };
    state.objects = [];
    const trees = Array.from({ length: 21 }, () => ({ minutes: 0, slot: 0, table: 0, group: 0, shakes: 0 }));
    trees[0] = { minutes: 600, slot: 1, table: 0, group: 1, shakes: 3 };
    state.encounters = { honeyTrees: trees, lastHoneyTree: 0, radarCharge: 0, radarRecords: [0, 1, 2].map(() => ({ species: null, count: 0 })), swarms: false, trophyGarden: [null, null] };
    game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }, 'load');
    game.advance(2);
    const prop = newGameRecord(game.registries).specialEncounters!.honeyTrees.prop;
    expect(game.world.view().props!.filter((p) => p.prop === prop && p.clip?.name === 'shake-2')).toHaveLength(1);
  });
});
