/**
 * Hall of Fame on the real ROM (OPENSINNOH_NDS_ROM; docs/research/hall-of-fame-credits.md): `sys-hall-of-fame` (a
 * constructed start before Cynthia: her battle, the Hall of Fame, clear_game's record screen, save, credits and
 * reset, CONTINUE upstairs in Twinleaf) and `sys-hof-pc` (the PC's viewer after it), headless twice on seeds 1–3
 * with a save round trip. Their screenshot lines are checked here by the views they show.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import type { AppView } from '@opensinnoh/contracts';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game, type ReplayResolver } from '@opensinnoh/game';
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

/** What each screenshot line's beat shows (headless has no pixels). */
const HOF_BEATS: Record<string, (v: AppView | null) => void> = {
  'hall-of-fame-member': (v) => expect(v).toMatchObject({ app: 'hall-of-fame', mode: 'record' }),
  'hall-of-fame-group': (v) => {
    expect(v).toMatchObject({ app: 'hall-of-fame', mode: 'record', waiting: true, member: null });
    if (v?.app === 'hall-of-fame' && v.mode === 'record') expect(v.group?.party).toHaveLength(6);
  },
  'credits-scroll': (v) => {
    expect(v).toMatchObject({ app: 'credits', scene: 'morning', card: null });
    if (v?.app === 'credits') expect(v.lines.length).toBeGreaterThan(0);
  },
  'credits-final': (v) => expect(v).toMatchObject({ app: 'credits', scene: 'final', final: expect.any(String) }),
  'credits-card': (v) => expect(v).toMatchObject({ app: 'credits', scene: 'card', card: { title: 'OpenSinnoh' } }),
  'hof-pc': (v) => expect(v).toMatchObject({ app: 'hall-of-fame', mode: 'pc', selected: 0, panel: 'info' }),
  'hof-pc-moves': (v) => expect(v).toMatchObject({ app: 'hall-of-fame', mode: 'pc', panel: 'moves' }),
};

/**
 * Logged stand-ins the path may hit: the slice's lift is timed only and the journal is not modelled.
 */
const STAND_INS = ['platform-lift-prop', 'stub:create_journal_event'];

describe.skipIf(!ROM)('Hall of Fame and credits (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  });
  const newGame = (seed: number) => createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });

  for (const file of ['sys-hall-of-fame.replay', 'sys-hof-pc.replay']) {
    for (const seed of [1, 2, 3]) {
      it(`${file} passes twice from seed ${seed} and round-trips its save`, async () => {
        const game: Game = newGame(seed);
        const seen = new Set<string>();
        const result = await runReplay(gameDriver(game), read(file), {
          registries: game.registries,
          seed,
          name: file,
          resolve,
          beforeLine: (line) => {
            if (line.action.type !== 'screenshot') return;
            const check = HOF_BEATS[line.action.name];
            if (!check) throw new Error(`no check for screenshot ${line.action.name}`);
            check(game.app());
            seen.add(line.action.name);
          },
        });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        expect(seen.size).toBeGreaterThan(0);
        // No stub on the path but the listed stand-ins.
        expect(game.log.report().map((r) => r.key).filter((k) => !STAND_INS.includes(k))).toEqual([]);
      }, 900_000);
    }
  }
});
