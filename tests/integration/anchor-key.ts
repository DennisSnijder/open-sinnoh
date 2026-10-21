/**
 * The chain anchors' cache files (checkpoints-anchors.ts): which chunks have one and where each seed's save
 * is kept. Engine-free (node and the replay parser only), so the dev server's checkpoint loader
 * (tools/dev-checkpoints.ts) finds the same files the ROM tests write.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReplay } from '@opensinnoh/core';
import { sourceKey } from '../source-key.ts';

const REPO = join(import.meta.dirname, '../..');
export const REPLAYS = join(REPO, 'tests/rom-replays');
export const readReplay = (file: string): string => readFileSync(join(REPLAYS, file), 'utf8');

/**
 * A story chunk: the prefix its first anchor holds and its replays in chain order. Each replay starts from the
 * one before (`from`), so each plays from its parent's anchor; the parents' anchors are built one replay at a
 * time from the prefix's (checkpoints-anchors.ts playPrefix).
 */
export interface Chunk {
  name: string;
  prefix: string;
  replays: readonly string[];
}
export const M5A: Chunk = { name: 'M5a', prefix: 'cp4.replay', replays: ['cp5.replay', 'cp6.replay', 'cp7.replay', 'cp8.replay'] };
export const M5B: Chunk = { name: 'M5b', prefix: 'cp8.replay', replays: ['cp9.replay', 'cp10.replay', 'cp11.replay', 'cp12.replay', 'cp13.replay'] };
/** Checkpoints cp14 to cp19: cp14 (the Galactic HQ), cp15 (shared prefixes before Cyrus and Giratina; the first sets the team, docs/decisions.md), cp16 (Sunyshore), cp17 (Victory Road), cp18 (the Elite Four), cp19 (Cynthia, the Hall of Fame, the credits). */
export const M5C: Chunk = { name: 'M5c', prefix: 'cp13.replay', replays: ['cp14.replay', 'cp15-dw-cyrus.replay', 'cp15-giratina-room.replay', 'cp15.replay', 'cp16.replay', 'cp17.replay', 'cp18.replay', 'cp19.replay'] };
/** M6's checkpoints: cp20 (the Snowpoint ship and the Fight Area tag battle). */
export const M6: Chunk = { name: 'M6', prefix: 'cp19.replay', replays: ['cp20.replay', 'cp21a.replay', 'cp21b.replay', 'cp21c.replay', 'cp21d.replay', 'cp21e.replay', 'cp21f.replay', 'cp22.replay', 'cp23a.replay', 'cp23b.replay', 'cp24.replay'] };
/** Every chunk with an anchor, and the seeds the checkpoint tests anchor it on. */
export const CHUNKS: readonly Chunk[] = [M5A, M5B, M5C, M6];
export const ANCHOR_SEEDS = [1, 2, 3] as const;

/** The replay files a replay chains through with `from`, itself first. */
export function chainOf(file: string): string[] {
  const out = [file];
  for (let from = parseReplay(readReplay(file)).from; from; from = parseReplay(readReplay(from.file)).from) out.push(from.file);
  return out;
}

let engineHash: string | undefined;
/** The headless game's packages, their runtime dependencies, the harness and external dependency versions. */
export function headlessSourceKey(repo = REPO): string {
  return sourceKey(repo, ['game', 'battle', 'menus', 'vm', 'world'], [
    'tests/integration/checkpoints-anchors.ts', 'tests/integration/anchor-key.ts', 'tests/source-key.ts',
  ]);
}
const engineSources = () => (engineHash ??= headlessSourceKey());

/** The anchor's file for `prefix` on `seed` in the ROM test cache directory `cacheDir`. */
export function anchorFile(cacheDir: string, prefix: string, seed: number): string {
  const hash = createHash('sha1');
  for (const file of chainOf(prefix)) hash.update(file).update('\0').update(readReplay(file)).update('\0');
  hash.update(engineSources());
  return join(cacheDir, 'anchors', `${prefix.replace(/\.replay$/, '')}-s${seed}-${hash.digest('hex').slice(0, 16)}.json`);
}
