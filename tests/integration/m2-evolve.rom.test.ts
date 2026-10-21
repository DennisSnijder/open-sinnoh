/**
 * Evolution on the real ROM (OPENSINNOH_NDS_ROM): the imported scene art and particle emitters, the zones'
 * special evolution methods, and the replays (tests/rom-replays), each twice with a save round trip:
 * - m2-evolve: a level-up in a wild battle evolves Piplup into Prinplup, which learns Metal Claw;
 * - m2-evolve-cancel: the same, stopped with B;
 * - svc-evolve-stone: a Water Stone from the bag (ABLE! / UNABLE!, no effect on Piplup) evolves Eevee;
 * - svc-rare-candy: a Rare Candy levels Piplup to 16, then it evolves (the move question answered NO).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Id, PackData } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, loadGamePacks, runReplay, type Game, type ReplayResolver } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { ROM, romSlice } from '../rom.ts';

const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const P = (n: string) => `platinum:${n}` as Id;

const REPLAYS: [string, number[]][] = [
  ['m2-evolve.replay', [1, 2, 3]],
  ['m2-evolve-cancel.replay', [1, 2, 3]],
  ['svc-evolve-stone.replay', [1]],
  ['svc-rare-candy.replay', [1]],
];

describe.skipIf(!ROM)('evolution (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  it('imports the zones’ evolution methods, the scene background and its 13 particle emitters', () => {
    const { registries: reg } = loadGamePacks([pack]);
    const zones = [...reg.zones.values()];
    expect(reg.zones.get(P('MAP_HEADER_ROUTE_217'))!.mapEvolution).toBe('LEVEL_ICE_ROCK');
    expect(reg.zones.get(P('MAP_HEADER_ETERNA_FOREST'))!.mapEvolution).toBe('LEVEL_MOSS_ROCK');
    expect(reg.zones.get(P('MAP_HEADER_MT_CORONET_1F_SOUTH'))!.mapEvolution).toBe('LEVEL_MAGNETIC_FIELD');
    expect(zones.filter((z) => z.mapEvolution === 'LEVEL_MAGNETIC_FIELD')).toHaveLength(19);
    expect(zones.filter((z) => z.mapEvolution)).toHaveLength(21);
    const bg = reg.ui2d.get(P('ui2d/evolution/background'))!;
    expect(bg.cells).toEqual([{ x: 0, y: 0, w: 256, h: 256, ox: 0, oy: 0 }]);
    const particles = reg.ui2d.get(P('ui2d/evolution/particles'))!;
    // The textures as the emitters tile and mirror them: the round glow, the ray, the ring.
    expect(particles.cells.map((c) => [c.w, c.h])).toEqual([[32, 32], [16, 64], [64, 64]]);
    expect(particles.emitters).toHaveLength(13);
    // Every emitter ends (self-maintaining, with a lifetime): the swap waits on them.
    for (const e of particles.emitters!) expect(e.life).toBeGreaterThan(0);
  });

  const play = async (file: string, seed: number): Promise<{ game: Game; log: CountingStubLog }> => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const resolve: ReplayResolver = (f) => ({ name: f, text: read(f) });
    const result = await runReplay(gameDriver(game), read(file), { registries: game.registries, seed, name: file, resolve });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    return { game, log };
  };

  for (const [file, seeds] of REPLAYS) {
    for (const seed of seeds) {
      it(`${file} passes from seed ${seed}, twice, with a save round trip`, async () => {
        const { game } = await play(file, seed);
        if (file === 'm2-evolve.replay') expect(game.state.pokedex.caught).toContain(P('SPECIES_PRINPLUP'));
        if (file === 'svc-evolve-stone.replay') expect(game.state.pokedex.caught).toContain(P('SPECIES_VAPOREON'));
      }, 120_000);
    }
  }
});
