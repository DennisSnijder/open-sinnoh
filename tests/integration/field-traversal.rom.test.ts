/**
 * Field traversal on the real Platinum data (OPENSINNOH_NDS_ROM), docs/decisions.md "Field traversal":
 * - Route 215 walks both ways between Celestic's side and Veilstone's (path.ts finds the walk, the engine plays it).
 * - Route 216's upper snowfield (Skiers Bradley and Kaitlyn) is reached by Rock Climb at x 323, not on foot.
 * - The load-height replays: a save on a bridge, under one, and on the Hall of Origin's upper floor.
 */
import { describe, expect, it } from 'vitest';
import type { Matrix } from '@opensinnoh/contracts';
import type { Button } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { MapGrid } from '../../packages/world/src/tiles.ts';
import { walkLines } from '../../tools/replays/path.ts';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

/** Decomp TRAINER_DEFEATED_FLAGS_START. */
const TRAINER_FLAGS_START = 0x550;

const newGame = (seed = 1) => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });

/** Setup lines: a warp into `zone` with its trainers beaten (they stand, but neither see nor battle) and its hideable objects hidden. */
function setup(game: Game, zone: string, x: number, z: number, facing: string, extra: string[] = []): string {
  const reg = game.registries;
  const lines = ['set state repel 250', ...extra];
  for (const o of reg.zones.get(`platinum:MAP_HEADER_${zone}` as never)!.events.objects) {
    if (o.hideFlag) lines.push(`set flag ${o.hideFlag} true`);
    if (!o.trainer) continue;
    const index = TRAINER_FLAGS_START + reg.trainers.get(o.trainer.id)!.sourceIndex!;
    lines.push(`set flag ${[...reg.flags.values()].find((f) => f.sourceIndex === index)!.id} true`);
  }
  return [...new Set(lines), `warp platinum:MAP_HEADER_${zone} ${x} ${z} ${facing}`, 'until idle', ''].join('\n');
}

const run = (game: Game, text: string) => runReplay(gameDriver(game), text, { name: 'traversal', registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });

/** path.ts's walk lines from where the player stands to (tx, tz); one comment line when there is none. */
function plan(game: Game, tx: number, tz: number): string[] {
  const zone = game.registries.zones.get(game.state.player.zone)!;
  const grid = new MapGrid(game.registries, game.registries.matrices.get(zone.matrix) as Matrix);
  return walkLines(game, grid, [...game.registries.zones.values()].filter((z) => z.matrix === zone.matrix), tx, tz);
}

/**
 * Plays `start`, then walks to (tx, tz) on the engine one straight run at a time, planning each run with path.ts
 * from where the player stands (a wanderer in the way is walked around). False when path.ts finds no walk.
 */
async function walk(start: string, tx: number, tz: number): Promise<{ found: boolean; game: Game }> {
  const game = newGame();
  expect((await run(game, start)).error).toBeUndefined();
  for (let leg = 0; leg < 100; leg++) {
    const p = game.state.player;
    if (p.x === tx && p.z === tz) return { found: true, game };
    const lines = plan(game, tx, tz);
    if (lines.length === 1) return { found: false, game };
    const dir = /press (\w+)/.exec(lines[1]!)![1] as Button;
    const [x, z] = /until position (\d+) (\d+)/.exec(lines[2]!)!.slice(1).map(Number);
    game.press(dir);
    // Until the run's end, or 2 s without a step (a wanderer in the way: plan again).
    for (let t = 0, still = 0, at = `${p.x},${p.z}`; t < 6000 && still < 60; t++) {
      game.tick();
      const now = `${game.state.player.x},${game.state.player.z}`;
      if (now === `${x},${z}`) break;
      still = now === at ? still + 1 : 0;
      at = now;
    }
    game.release(dir);
    for (let t = 0; t < 30; t++) game.tick();
  }
  throw new Error(`no arrival at ${tx},${tz} in 100 runs (player at ${game.state.player.x},${game.state.player.z})`);
}

/** Route 215's joggers battle in the morning (Route215_OnTransition); later their no-battle copies run laps across the paths. */
const MORNING = ['time 08:00'];

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('field traversal (OPENSINNOH_NDS_ROM)', () => {
  // Eastbound: down the west ledge, over the x 591 bridge, along the lower path, up the slope at z 599, north on
  // the x 613 bridge, west on the z 582 bridge, the north path, the z 582 ledge, under the x 623 bridge, east.
  it('Route 215: Celestic side to Veilstone side', async () => {
    const { found, game } = await walk(setup(newGame(), 'ROUTE_215', 577, 596, 'down', MORNING), 670, 598);
    expect(found).toBe(true);
    expect(game.state.player).toMatchObject({ x: 670, z: 598 });
  }, 300_000);

  it('Route 215: Veilstone side to Celestic side', async () => {
    const { found, game } = await walk(setup(newGame(), 'ROUTE_215', 669, 598, 'down', MORNING), 577, 596);
    expect(found).toBe(true);
    expect(game.state.player).toMatchObject({ x: 577, z: 596 });
  }, 300_000);

  // The snowfield (height 160) meets the lower land only through walls of blocked tiles; its way in is the Rock
  // Climb wall at x 323 (z 394–400), so it opens after the Icicle Badge, as on the DS.
  it('Route 216: the skiers’ snowfield is reached by Rock Climb only', async () => {
    const bradley = [351, 393] as const;
    const kaitlyn = [342, 386] as const;
    for (const [x, z] of [bradley, kaitlyn]) expect((await walk(setup(newGame(), 'ROUTE_216', 375, 404, 'down'), x, z)).found).toBe(false);
    const climb = [setup(newGame(), 'ROUTE_216', 323, 401, 'up', ['party 0 platinum:SPECIES_BIBAREL 50 platinum:MOVE_ROCK_CLIMB', 'give badge platinum:BADGE_ID_ICICLE']), '+0 field move 0 platinum:MOVE_ROCK_CLIMB', 'advance text', 'until idle', ''].join('\n');
    for (const [x, z] of [bradley, kaitlyn]) {
      const { found, game } = await walk(climb, x, z);
      expect(found).toBe(true);
      expect(game.state.player).toMatchObject({ x, z, y: 160 });
    }
  }, 300_000);

  for (const file of ['sys-load-heights-bridges', 'sys-load-heights-bike-bridge', 'sys-load-heights-hall-of-origin'])
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const game = newGame(seed);
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      }, 300_000);
});
