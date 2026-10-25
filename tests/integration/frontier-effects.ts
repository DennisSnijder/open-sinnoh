/**
 * Runs a frontier `sys-` replay once (seed 1) and samples the frontier scene after every tick: the scene effects'
 * ROM tests (frontier-effects.rom.test.ts, frontier-particles.rom.test.ts) check what the scenes drew.
 */
import { expect } from 'vitest';
import type { FrontierView } from '@opensinnoh/contracts';
import { createGame, CountingStubLog, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

export interface Sampled {
  game: Game;
  log: CountingStubLog;
  views: FrontierView[];
  /** The BGM after each sampled tick. */
  bgm: (string | null)[];
}

export async function sampleFrontier(file: string): Promise<Sampled> {
  const { pack } = romSlice();
  const log = new CountingStubLog(() => {});
  const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log, now: () => '2009-03-22T12:00:00Z' });
  const views: FrontierView[] = [];
  const bgm: (string | null)[] = [];
  const tick = game.tick.bind(game);
  game.tick = () => {
    tick();
    const v = game.scripts.view().frontier;
    if (!v) return;
    views.push(structuredClone(v));
    bgm.push(game.sound.currentBgm());
  };
  const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  return { game, log, views, bgm };
}

/** Runs of consecutive views with a pre-battle wipe (FrontierScrCmd_3F): one per battle. */
export function wipeRuns(views: FrontierView[]): FrontierView[][] {
  const runs: FrontierView[][] = [];
  views.forEach((v, i) => {
    if (!v.wipe) return;
    if (!views[i - 1]?.wipe) runs.push([]);
    runs.at(-1)!.push(v);
  });
  return runs;
}
