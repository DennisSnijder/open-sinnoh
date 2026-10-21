/**
 * On the real ROM (OPENSINNOH_NDS_ROM): static and legendary battles and the roamers.
 * - `sys-static-drifloon`, `sys-static-lake-trio` and `sys-static-azelf-early` (constructed starts): headless twice on seeds 1–3, with a save
 *   round trip.
 * - Mesprit roams: from the lake trio's end, Mesprit put on Route 201 (a constructed save; Repel keeps the other
 *   wild Pokémon away) is met in the grass as a roamer battle; it flees after the player's move, keeps its HP and
 *   leaves the route.
 * - Giratina's Origin battle on ROM data, all outcomes the Distortion World's script branches on: caught, defeated,
 *   fled (get_battle_result 4, 1, 5), with the field's return and set_party_giratina_form. The Giratina room's own
 *   script needs the Distortion World's map objects, so a test pack (original, scripts only) runs the same
 *   command sequence from Route 201. The room's own script runs in `sys-giratina-caught|defeated|fled`
 *   (m5c-giratina.rom.test.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseIR, type Id, type PackData } from '@opensinnoh/core';
import type { GameState } from '@opensinnoh/contracts';
import { advanceText, battleAuto, battleCatch, CountingStubLog, createGame, gameDriver, runReplay, runUntil, untilTarget, type Game, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const resolve: ReplayResolver = (file, base) => {
  const name = join(base ? dirname(base) : '', file);
  return { name, text: readFileSync(join(dir, name), 'utf8') };
};
const read = (name: string) => readFileSync(join(dir, name), 'utf8');
const p = (name: string) => `platinum:${name}` as Id;

describe.skipIf(!ROM)('static and legendary battles, roamers (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  });
  const newGame = (seed: number, packs: PackData[] = [pack], log = new CountingStubLog(() => {})) =>
    createGame({ packs, createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });

  for (const file of ['sys-static-drifloon.replay', 'sys-static-lake-trio.replay', 'sys-static-azelf-early.replay']) {
    for (const seed of [1, 2, 3]) {
      it(`${file} passes twice from seed ${seed} and round-trips its save`, async () => {
        const game = newGame(seed);
        const result = await runReplay(gameDriver(game), read(file), { registries: game.registries, seed, name: file, resolve });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      }, 600_000);
    }
  }

  /** Loads `state` as an arrival (a map change) and waits until the field is idle. */
  const enter = (game: Game, state: GameState) => {
    game.load({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }, 'arrival');
    expect(runUntil(untilTarget(game), { kind: 'idle' }, 600)).not.toBeNull();
  };

  it('Mesprit roams: met in the grass of its route, it flees after the player’s move, keeps its HP and leaves the route', async () => {
    const game = newGame(1);
    const trio = await runReplay(gameDriver(game), read('sys-static-lake-trio.replay'), { registries: game.registries, seed: 1, name: 'sys-static-lake-trio.replay', resolve, repeat: false });
    expect(trio.error).toBeUndefined();
    await game.loadBattleEngine();
    const state = structuredClone(game.state);
    const full = state.roamers.slots[0]!.hp;
    // Azelf leads (a resisted Psychic move cannot knock Mesprit out); Mesprit on Route 201 (route index 0).
    state.party = [state.party[1]!, state.party[0]!];
    state.roamers.routes[0] = 0;
    state.repel = 250;
    state.player = { ...state.player, zone: p('MAP_HEADER_ROUTE_201'), x: 116, z: 853, y: 0, facing: 'right' };
    state.objects = [];
    enter(game, state);
    const t = untilTarget(game);
    // Pace in the grass west of Sandgem (x 116–124) until a battle starts.
    let dir: 'left' | 'right' = 'right';
    t.press(dir);
    for (let n = 0; n < 6000 && !game.inBattle(); n++) {
      game.tick();
      const x = game.state.player.x;
      const next: 'left' | 'right' = x >= 124 ? 'left' : x <= 116 ? 'right' : dir;
      if (next !== dir) {
        t.release(dir);
        dir = next;
        t.press(dir);
      }
    }
    t.release(dir);
    expect(game.inBattle()).toBe(true);
    expect(game.battleSetup()?.wild).toEqual([{ species: p('SPECIES_MESPRIT'), level: 50, roamer: { pid: state.roamers.slots[0]!.pid, ivs: state.roamers.slots[0]!.ivs, hp: full, status: 'none' } }]);
    expect(battleAuto(t, 5000)).not.toBeNull();
    expect(game.battles.at(-1)).toMatchObject({ kind: 'wild', species: [p('SPECIES_MESPRIT')], result: 'fled', turns: 1 });
    game.tick();
    const mesprit = game.state.roamers.slots[0]!;
    expect(mesprit.hp).toBeGreaterThan(0);
    expect(mesprit.hp).toBeLessThan(full);
    expect(game.state.roamers.routes[0]).not.toBe(0);
    expect(game.state.vars[p('VAR_ROAMING_MESPRIT_STATE')]).toBeUndefined();
  }, 600_000);

  it('Giratina’s Origin battle (start_giratina_origin_battle 487, 47): caught, defeated and fled, as get_battle_result tells them apart', async () => {
    // A test pack: original scripts only, the Giratina room's command sequence without its Distortion World objects;
    // Route 201's on-load script counts the removals FLAG_MAP_LOCAL_REMOVE_OBJECT asks for, as the room's does.
    const ir = `
giratina-test:Giratina::
  set_flag flag(platinum:FLAG_MAP_LOCAL_REMOVE_OBJECT)
  start_giratina_origin_battle 487, 47
  clear_flag flag(platinum:FLAG_MAP_LOCAL_REMOVE_OBJECT)
  check_won_battle var(giratina-test:VAR_WON)
  get_battle_result var(giratina-test:VAR_RESULT)
  end
giratina-test:OnLoad::
  check_flag flag(platinum:FLAG_MAP_LOCAL_REMOVE_OBJECT)
  go_to_if "eq", label(giratina-test:Removed)
  end
giratina-test:Removed::
  add_var var(giratina-test:VAR_LOADS), 1
  clear_flag flag(platinum:FLAG_MAP_LOCAL_REMOVE_OBJECT)
  end
giratina-test:Altered::
  set_party_giratina_form 0
  end
`;
    const mod: PackData = {
      manifest: { id: 'giratina-test', name: 'Giratina test scripts', version: '0.1.0', engine: '^0.1.0', base: pack.manifest.id, dependencies: { [pack.manifest.id]: `^${pack.manifest.version}` }, loadAfter: [pack.manifest.id] },
      registries: { vars: ['WON', 'RESULT', 'LOADS'].map((n) => ({ id: `giratina-test:VAR_${n}` as Id, initial: 0, scope: 'saved' })) },
      scripts: parseIR(ir),
      patches: [{ registry: 'zones', id: p('MAP_HEADER_ROUTE_201'), operations: [{ op: 'add', path: '/mapScripts/onLoad', value: 'giratina-test:OnLoad' }] }],
      remove: [],
      provenance: 'original',
    } as unknown as PackData;
    // Each outcome on its own game: a lead that outruns and outclasses Giratina L47, a Master Ball for the catch.
    const outcome = async (act: 'catch' | 'defeat' | 'run') => {
      const game = newGame(1, [pack, mod]);
      await game.loadBattleEngine();
      const setup = await runReplay(gameDriver(game), `party 0 platinum:SPECIES_GARCHOMP 100 platinum:MOVE_DRAGON_CLAW\ngive item platinum:ITEM_MASTER_BALL 1\nwarp platinum:MAP_HEADER_ROUTE_201 110 853 down\nuntil idle\n`, { registries: game.registries, seed: 1, repeat: false });
      expect(setup.error).toBeUndefined();
      const t = untilTarget(game);
      const v = (n: string) => game.state.vars[`giratina-test:VAR_${n}` as Id] ?? 0;
      const before = v('LOADS');
      game.scripts.start({ label: 'giratina-test:Giratina' as Id, zone: game.state.player.zone, source: 'test' });
      expect(runUntil(t, { kind: 'battle' }, 3000)).not.toBeNull();
      expect(game.battleSetup()).toMatchObject({ kind: 'legendary', wild: [{ species: p('SPECIES_GIRATINA'), level: 47, form: 1 }], giratina: true, terrain: p('TERRAIN_GIRATINA') });
      const foe = game.battle!.view().battlers.find((b) => b.side === 'enemy')!;
      expect(foe).toMatchObject({ species: p('SPECIES_GIRATINA'), form: 1 });
      if (act === 'catch') expect(battleCatch(t, p('ITEM_MASTER_BALL'), 20000)).not.toBeNull();
      else if (act === 'defeat') expect(battleAuto(t, 20000)).not.toBeNull();
      else {
        game.battleChoose({ kind: 'run' });
        expect(runUntil(t, { kind: 'battle-end' }, 5000)).not.toBeNull();
      }
      expect(advanceText(t, 3000)).not.toBeNull();
      return { game, won: v('WON'), result: v('RESULT'), loads: v('LOADS') - before };
    };
    const caught = await outcome('catch');
    expect(caught).toMatchObject({ won: 1, result: 4, loads: 1 });
    expect(caught.game.battles.at(-1)).toMatchObject({ kind: 'scripted', species: [p('SPECIES_GIRATINA')], result: 'caught' });
    const giratina = caught.game.state.party[1]!;
    expect([giratina.species, giratina.form, giratina.ability]).toEqual([p('SPECIES_GIRATINA'), 1, p('ABILITY_LEVITATE')]);
    expect(caught.game.state.flags[p('FLAG_MAP_LOCAL_REMOVE_OBJECT')] ?? false).toBe(false);
    // Out of the Distortion World (Sendoff Spring): Altered without the Griseous Orb, Pressure, its own stats.
    caught.game.scripts.start({ label: 'giratina-test:Altered' as Id, zone: caught.game.state.player.zone, source: 'test' });
    expect(runUntil(untilTarget(caught.game), { kind: 'idle' }, 300)).not.toBeNull();
    const altered = caught.game.state.party[1]!;
    expect([altered.form, altered.ability]).toEqual([0, p('ABILITY_PRESSURE')]);
    expect(altered.stats.defense).toBeGreaterThan(altered.stats.attack);
    expect(await outcome('defeat')).toMatchObject({ won: 1, result: 1, loads: 1 });
    expect(await outcome('run')).toMatchObject({ won: 1, result: 5, loads: 1 });
  }, 900_000);
});
