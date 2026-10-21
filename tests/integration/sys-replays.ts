/**
 * Systems replays, headless (OPENSINNOH_NDS_ROM). Each replay that is not
 * pending runs twice from seed 1 with a save round trip, then on seeds 2 and 3, with its exact wild
 * battle count per seed. A pending replay (tests/rom-replays/sys-replays.ts) is skipped with the
 * features it waits for; this file fails when a pending replay already passes or when a feature it waits
 * for is already implemented, so the list stays honest.
 *
 * `screenshot <name>` lines are checks here (headless has no pixels): `rock-climb-offered` checks the
 * party menu offers Rock Climb (usableFieldMoves), `footprints` that FieldView.effects has snow
 * footprints.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData, ReplayLine } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { NEEDS, SYS_REPLAYS, readReplay, resolveReplay, type ProbeContext } from '../rom-replays/sys-replays.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

/** Checks at `screenshot <name>` lines of the main replay (by name). */
const SCREENSHOT_CHECKS: Record<string, (game: Game) => void> = {
  'rock-climb-offered': (game) => expect(game.usableFieldMoves()).toContainEqual({ slot: 0, move: 'platinum:MOVE_ROCK_CLIMB' }),
  footprints: (game) => expect(game.world.view().effects.map((e) => e.effect)).toContainEqual(expect.stringMatching(/:FIELD_EFFECT_(FOOTPRINT|TRACK)_SNOW_/)),
  // Pastoria Gym at rest: the water prop at the pressed colour's height, every button group posed on its last frame.
  ...Object.fromEntries(
    (['orange', 'green', 'blue'] as const).map((c, i) => [
      `pastoria-${c}`,
      (game: Game) => {
        const f = game.world.view().features!;
        expect(f.models.find((m) => m.key === 'pastoria-water')?.position[1]).toBe([0, 32, 64][i]);
        expect(f.propPoses!.map((p) => p.tick === 0)).toEqual([0, 1, 2].map((k) => k !== i));
      },
    ]),
  ),
  // Canalave Gym: the upper floors drawn from the player's height (16, 176, 336), every platform of a shown floor.
  'canalave-ground': (game) => expect(game.world.view().features!.models.filter((m) => m.key.startsWith('canalave-floor')).map((m) => m.key)).toEqual([]),
  // Snowpoint Gym: the live snowballs (OBJ_EVENT_GFX_SNOWBALL objects) at each count the route reaches.
  ...Object.fromEntries(
    [19, 18, 17, 16, 11].map((n) => [
      `snowpoint-balls-${n}`,
      (game: Game) => {
        const zone = game.registries.zones.get(game.state.player.zone)!;
        const balls = game.state.objects.filter((o) => {
          const sprite = zone.events.objects.find((e) => e.localId === o.localId)?.sprite;
          return typeof sprite === 'string' && game.registries.sprites.get(sprite)?.sourceIndex === 0x76;
        });
        expect(balls).toHaveLength(n);
      },
    ]),
  ),
  // Dynamic boats across the shared overworld matrix: Canalave's ship/bridges and Snowpoint's ship.
  'boat-canalave': (game) => {
    const boat = [...game.registries.newGame.values()][0]!.boat!;
    // The overworld's honey trees are world-drawn props too (FieldView.props).
    const honey = [...game.registries.newGame.values()][0]!.specialEncounters?.honeyTrees.prop;
    expect([...new Set(game.world.view().props!.map((p) => p.prop))].filter((p) => p !== honey).sort()).toEqual([boat.ship, ...boat.bridges, boat.snowpointShip!].sort());
  },
  'canalave-third-floor': (game) => expect(game.world.view().features!.models.filter((m) => m.key.startsWith('canalave-floor')).map((m) => m.key)).toEqual(['canalave-floor-2', 'canalave-floor-3']),
};

export function describeSystemReplays(group: number): void {
  describe.skipIf(!romPath)('systems replays (OPENSINNOH_NDS_ROM)', () => {
    let pack: PackData;
    beforeAll(async () => {
      ({ pack } = romSlice());
    }, 60_000);

    const newGame = (seed: number) => createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, seed, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });

    /**
     * The systems replays test the field: their wild encounters flee without a battle (a stub;
     * `wild flee`), counted per seed. A reset restores battles, so the driver sets it after each. Replays that
     * chain from the checkpoints (sys-rock-smash) inherit their `wild auto`: those battles are real and counted too.
     */
    const fieldDriver = (game: Game) => {
      const driver = gameDriver(game);
      const reset = driver.reset;
      driver.reset = (seed) => {
        void reset(seed);
        game.wildBattles = 'flee';
      };
      return driver;
    };

    const play = (file: string, seed: number, repeat: boolean, extra = '') => {
      const game = newGame(seed);
      const beforeLine = (line: ReplayLine) => {
        if (line.action.type === 'screenshot') SCREENSHOT_CHECKS[line.action.name]?.(game);
      };
      return runReplay(fieldDriver(game), readReplay(file) + extra, { registries: game.registries, seed, name: file, resolve: resolveReplay, repeat, beforeLine });
    };

    const probes: ProbeContext = {
      game: () => newGame(1),
      run: (text) => {
        const game = newGame(1);
        return runReplay(fieldDriver(game), text, { registries: game.registries, seed: 1, repeat: false });
      },
    };

    // Rock Smash keeps the full CP4 prefix and its cumulative wild-battle counts.
    // The other independent scenarios are distributed over four files.
    for (const r of SYS_REPLAYS.filter((r, i) => (r.file === 'sys-rock-smash.replay' ? 0 : 1 + i % 4) === group)) {
      const waits = (r.pending ?? []).map((k) => `${NEEDS[k].area}: ${NEEDS[k].what}`);
      it.skipIf(waits.length > 0)(`${r.file}${waits.length ? ` (pending: ${waits.join('; ')})` : ''} passes twice from seed 1 with a round trip, and on seeds 2–3`, async () => {
        if (r.wild === 'record') {
          const counts: number[] = [];
          for (const seed of [1, 2, 3]) {
            const result = await play(r.file, seed, false, '\n+0 assert battles wild 999999\n');
            counts.push(Number(/got (\d+)/.exec(result.error ?? '')?.[1]));
          }
          throw new Error(`${r.file}: record its wild battle counts per seed in sys-replays.ts: wild: [${counts.join(', ')}]`);
        }
        const wild = (seed: number) => (r.wild ? `\n+0 assert battles wild ${r.wild[seed - 1]}\n` : '');
        const first = await play(r.file, 1, true, wild(1));
        expect(first.error).toBeUndefined();
        expect(first).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        for (const seed of [2, 3]) {
          const result = await play(r.file, seed, false, wild(seed));
          expect(result.error, `seed ${seed}`).toBeUndefined();
        }
      }, 300_000);
    }

    if (group === 0) it('pending replays still fail, past their setup, and wait only on features that are not implemented yet', async () => {
      const problems: string[] = [];
      for (const r of SYS_REPLAYS.filter((x) => x.pending?.length)) {
        const result = await play(r.file, 1, false);
        if (result.ok) problems.push(`${r.file} passes: drop it from pending`);
        else if (/cannot parse|unknown (flag|var|item|zone|species)|setup lines|does not allow the bike|"from"/.test(result.error!)) problems.push(`${r.file} fails before it plays: ${result.error}`);
        for (const k of r.pending!) if (await NEEDS[k].probe(probes)) problems.push(`${r.file} lists ${k} (${NEEDS[k].what}), which works now: drop it (the replay fails with: ${result.error?.split('\n')[0]})`);
        console.log(`${r.file} pending on ${r.pending!.join(', ')}: ${result.error?.split('\n')[0]}`);
      }
      expect(problems).toEqual([]);
    }, 600_000);
  });
}
