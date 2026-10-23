/**
 * The system replays: constructed starts, each run twice on seeds 1–3 with a
 * save round trip. The ops under test may log no stub. Seed-dependent outcomes are checked here, not in the replays.
 */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { BATTLEGROUND_GYM_LEADERS, BATTLEGROUND_STAT_TRAINERS, BATTLEGROUND_TRAINER_NONE, createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const OPS = ['init_turnback_cave', 'get_random_battleground_trainers', 'activate_regi_ruins_dot', 'check_should_show_ghost', 'pokemon_preview'];
const v = (game: Game, name: string) => game.state.vars[`platinum:${name}` as Id];

const CHECKS: Record<string, (game: Game, logged: string[]) => void> = {
  'sys-battleground': (game) => {
    const [a, b, c, s] = [1, 2, 3, 4].map((n) => v(game, `VAR_BATTLEGROUND_TRAINER_${n}`)!);
    expect(BATTLEGROUND_GYM_LEADERS).toContain(a);
    const leaders = [a, b, c].filter((x) => x !== BATTLEGROUND_TRAINER_NONE);
    for (const x of leaders) expect(BATTLEGROUND_GYM_LEADERS).toContain(x);
    expect(new Set(leaders).size).toBe(leaders.length);
    expect([...BATTLEGROUND_STAT_TRAINERS, BATTLEGROUND_TRAINER_NONE]).toContain(s);
    for (const n of [1, 2, 3, 4]) expect(v(game, `VAR_OBJ_GFX_ID_${n}`)).toBe(v(game, `VAR_BATTLEGROUND_TRAINER_${n}`));
  },
  // The out-of-scope systems: each facility's or the Villa's own ops are logged stubs (counted), never silent.
  'sys-frontier-boundary': (_game, logged) => {
    for (const op of ['call_battle_castle_lobby_function', 'call_battle_arcade_lobby_function'])
      expect(logged, op).toContain(`stub:${op}`);
  },
  'sys-villa-boundary': (_game, logged) => {
    for (const op of ['save_tv_segment_home_and_manor_no_furniture', 'init_persisted_map_features_for_villa']) expect(logged, op).toContain(`stub:${op}`);
  },
};

const FILES = ['sys-turnback-routing', 'sys-turnback-timeout', 'sys-turnback-reload', 'sys-battleground', 'sys-survival-barry-weekend', 'sys-frontier-boundary', 'sys-villa-boundary', 'sys-snowpoint-temple', 'sys-fight-area-blockade', 'sys-regi-ruins-dots', 'sys-first-arrival'];

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('system replays', () => {
  for (const file of FILES)
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const log = new CountingStubLog(() => {});
        const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2009-03-22T12:00:00Z' });
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        CHECKS[file]?.(game, [...log.counts.keys()]);
        expect([...log.counts.keys()].filter((k) => OPS.some((op) => k.includes(op)))).toEqual([]);
      }, 300_000);
});
