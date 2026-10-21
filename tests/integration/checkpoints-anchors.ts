/**
 * Chain anchors: a story chunk's prefix (opening → cp4 for the first chunk) is played once
 * per seed and its end saved, cached in the ROM test cache (tests/rom.ts) under `anchors/`. The chunk's
 * replays then start from that save instead of replaying the whole story again.
 *
 * - The key is every replay text in the prefix (its `from` chain), the import key (the cache directory:
 *   ROM SHA-1, IMPORTER_VERSION, importer sources) and a hash of the engine's sources (the headless packages and their runtime dependencies,
 *   the harness and lockfile, tests left out), so any change that can move the prefix's end rebuilds it.
 * - A chunk replay's first line is `from <prefix>`, then `+0 reload` (save → load) before any input:
 *   played from scratch it is the prefix, a save and a load; played from the anchor it is a load of the
 *   same save (both lines left out). Both runs are the same ticks from there (the anchor proof in
 *   checkpoints-m5a.ts compares their end states).
 * - What a save does not hold is not in the anchor: the battle log (a chunk asserts its own battles, never
 *   counts since the new game) and the replay modes (`wild`, `evolve`: a chunk sets its own).
 * - Concurrent test files build an anchor once: a lock file, the others wait for it.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReplay, type PackData } from '@opensinnoh/core';
import type { GameState } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game, type ReplayDriver, type ReplayResolver } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romCacheDir, romSlice } from '../rom.ts';
import { anchorFile, chainOf, M5A, M5B, M5C, M6, readReplay, REPLAYS, type Chunk } from './anchor-key.ts';

export { chainOf, M5A, M5B, M5C, M6, readReplay, REPLAYS, type Chunk };

// Checkpoint games only read the pack. Freeze it once per worker so a mutation fails at its source;
// each createGame still validates the pack and builds fresh registries and mutable game state.
let pack: PackData | undefined;
function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
function storyPack(): PackData {
  if (!pack) {
    pack = romSlice().pack;
    freeze(pack);
  }
  return pack;
}

/** A headless game as the checkpoint tests play it (the menu apps run, as in the browser). */
export function storyGame(seed: number, log = new CountingStubLog(() => {})): Game {
  return createGame({ packs: [storyPack()], createWorld, createScriptRunner, createBattle, createApp, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
}

/** The anchor's cache file for `prefix` on `seed`. */
export const anchorPath = (prefix: string, seed: number): string => anchorFile(romCacheDir(), prefix, seed);

/** The replay a chunk replay starts from (`from <file>` then `+0 reload`), or undefined for any other replay. */
export function chunkParent(file: string): string | undefined {
  const replay = parseReplay(readReplay(file));
  const reload = replay.lines[0];
  const isReload = !replay.setup.length && reload?.action.type === 'reload' && 'after' in reload.at && reload.at.after === 0;
  return replay.from && isReload ? replay.from.file : undefined;
}

/**
 * The replay a branch replay starts from: a chunk-style branch (`from <parent>`, `+0 reload`), or one that stages
 * its scene with setup lines after `from <parent>` (applied to the parent's anchor as to its end). Undefined for
 * any other replay.
 */
export function branchParent(file: string): string | undefined {
  const replay = parseReplay(readReplay(file));
  return chunkParent(file) ?? (replay.from && replay.setup.length ? replay.from.file : undefined);
}

/**
 * Plays `prefix` on `seed` (once, no determinism run) and returns the save at its end. A chunk replay (one
 * that starts `from <parent>` and `+0 reload`) plays from its parent's anchor, so a chunk's anchors are
 * built one checkpoint at a time; so does a replay that stages its start with setup lines after `from <parent>`
 * (a constructed start); any other prefix plays from a new game.
 */
export async function playPrefix(prefix: string, seed: number): Promise<string> {
  const game = storyGame(seed);
  const resolve: ReplayResolver = (file) => ({ name: file, text: readReplay(file) });
  // The runner's round trip saves the end (and loads it back, which starts the map's fade-in): keep that save.
  const parent = branchParent(prefix);
  const base = gameDriver(game);
  const driver = parent ? anchoredDriver(base, await chainAnchor(parent, seed)) : base;
  const text = parent ? anchoredText(prefix, parent) : readReplay(prefix);
  let saved: string | undefined;
  const result = await runReplay({ ...driver, save: () => (saved = base.save() as string) }, text, { registries: game.registries, seed, name: prefix, repeat: false, resolve });
  if (!result.ok) throw new Error(`anchor ${prefix} seed ${seed}: ${result.error}`);
  if (typeof result.roundTrip !== 'string' || !saved) throw new Error(`anchor ${prefix} seed ${seed}: the prefix does not end where the game can save`);
  return saved;
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The save at the end of `prefix` on `seed`: from the cache, or played now (and cached). */
export async function chainAnchor(prefix: string, seed: number): Promise<string> {
  const path = anchorPath(prefix, seed);
  mkdirSync(join(path, '..'), { recursive: true });
  const lock = `${path}.lock`;
  for (;;) {
    if (existsSync(path)) return readFileSync(path, 'utf8');
    let fd: number;
    try {
      fd = openSync(lock, 'wx');
    } catch {
      // Another worker builds it; take over only when that process is gone.
      const holder = Number(readFileSync(lock, 'utf8') || 0);
      if (holder && !pidAlive(holder)) rmSync(lock, { force: true });
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    try {
      const t0 = Date.now();
      const save = await playPrefix(prefix, seed);
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, save);
      renameSync(tmp, path);
      console.log(`anchor ${prefix} seed ${seed}: played in ${Date.now() - t0} ms → ${path}`);
      return save;
    } finally {
      rmSync(lock, { force: true });
    }
  }
}

/**
 * The chunk or branch replay's text without its `from <prefix>` line and the `+0 reload` after it: the anchor's
 * load stands in for both (the same save loaded at the same point). A branch with setup lines keeps them: they
 * edit the anchor as they edit the prefix's end. Fails when the replay starts neither way.
 */
export function anchoredText(file: string, prefix: string): string {
  const text = readReplay(file);
  const replay = parseReplay(text);
  if (replay.from?.file !== prefix) throw new Error(`${file}: a chunk replay starts with "from ${prefix}"`);
  const lines = text.split('\n');
  lines[replay.from.line - 1] = `# from ${prefix}: the chain anchor`;
  if (replay.setup.length) return lines.join('\n');
  const reload = replay.lines[0];
  if (reload?.action.type !== 'reload' || !('after' in reload.at) || reload.at.after !== 0) throw new Error(`${file}: the line after "from ${prefix}" must be "+0 reload" (the anchor is a save) or setup lines`);
  lines[reload.line - 1] = '# reload: the anchor is loaded';
  return lines.join('\n');
}

/**
 * A driver whose reset is the anchor: a new game, the anchor's clock frozen (as the replay runner's round
 * trip does), the save loaded (where the chain from scratch has its `+0 reload`).
 */
export function anchoredDriver(driver: ReplayDriver, save: string): ReplayDriver {
  const now = (JSON.parse(save) as { state: GameState }).state.gameTime.now;
  return {
    ...driver,
    async reset(seed) {
      await driver.reset(seed);
      await driver.setClock(now.date, `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`);
      await driver.load(save);
    },
  };
}
