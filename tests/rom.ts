/**
 * The ROM import, shared by ROM-gated tests (OPENSINNOH_NDS_ROM): imported once, kept on disk, loaded by
 * every suite. Test-only; the cache is ROM-derived and lives in the gitignored `.opensinnoh-cache/`.
 *
 * - The global setups (vitest.setup-rom.ts, tests/browser/setup.ts) call `prepareRomCache()` once per run.
 * - Suites call `romSlice()` for the `{ slice: true }` import (what the headless game needs).
 * - Playwright specs call `romFullFiles()` for the files the app's import worker writes to IndexedDB.
 *
 * The cache directory is keyed by the ROM's SHA-1, `IMPORTER_VERSION` and a hash of the importer's
 * sources (it and every package it reads), so editing the importer re-imports even before the version
 * bump. Tests that exercise the importer itself still call `importPlatinum` directly.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import type { PackData } from '@opensinnoh/core';
import { importPlatinum, type ImportReport } from '@opensinnoh/importer';
import { IMPORTER_VERSION } from '../packages/app/src/importer.ts';
import { PACK_DATA_PATH } from '../packages/app/src/store.ts';

export const ROM = process.env.OPENSINNOH_NDS_ROM;

const REPO = join(import.meta.dirname, '..');
const ROOT = join(REPO, '.opensinnoh-cache/tests');
/** Set by `prepareRomCache` for the test workers. */
const ENV = 'OPENSINNOH_TEST_ROM_CACHE';
/** What the importer's output depends on: its own code and data, and the packages it calls into. */
const SOURCES = ['importer', 'nds', 'g3d', 'text', 'vm', 'core', 'contracts', 'audio'].flatMap((p) => [`packages/${p}/src`, `packages/${p}/data`]);

interface Key {
  romSha1: string;
  importerVersion: string;
  sources: string;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => !/\.test\.ts$/.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => join(dir, f));
}

function currentKey(rom: Uint8Array): Key {
  const sources = createHash('sha1');
  for (const file of [...SOURCES.flatMap((d) => sourceFiles(join(REPO, d))), join(REPO, 'packages/app/src/importer.ts')]) {
    sources.update(file.slice(REPO.length)).update('\0').update(readFileSync(file)).update('\0');
  }
  return { romSha1: createHash('sha1').update(rom).digest('hex'), importerVersion: IMPORTER_VERSION, sources: sources.digest('hex').slice(0, 16) };
}

const dirOf = (key: Key) => join(ROOT, `${key.romSha1.slice(0, 12)}-${key.importerVersion}-${key.sources}`);

/** Writes atomically, so a concurrent run never reads half a file. */
function writeAtomic(path: string, data: Uint8Array | string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/**
 * Makes sure the cache for this ROM and importer exists (importing on a miss) and points the test
 * workers at it. `full` also prepares the full import the browser specs seed the app with.
 */
export async function prepareRomCache(options: { full?: boolean } = {}): Promise<void> {
  if (!ROM) return;
  const rom = new Uint8Array(readFileSync(ROM));
  const key = currentKey(rom);
  const dir = dirOf(key);
  mkdirSync(dir, { recursive: true });
  const stamp = JSON.stringify(key);
  const ensure = async (file: string, build: () => Promise<Uint8Array>) => {
    if (existsSync(join(dir, file))) return;
    const t0 = Date.now();
    writeAtomic(join(dir, file), await build());
    console.log(`rom cache: ${file} imported in ${Date.now() - t0} ms → ${dir}`);
  };
  await ensure('slice.v8', async () => {
    const { pack, report } = await importPlatinum(rom, () => {}, { slice: true });
    return serialize({ pack, report });
  });
  if (options.full) {
    // Exactly the files the app's import worker (packages/app/src/import-worker.ts) writes.
    await ensure('full.v8', async () => {
      const { pack, assets } = await importPlatinum(rom, () => {}, {});
      return serialize([[PACK_DATA_PATH, new TextEncoder().encode(JSON.stringify(pack))], ...assets]);
    });
  }
  writeAtomic(join(dir, 'key.json'), stamp);
  // Older keys are dead weight (tens of MB each).
  for (const other of readdirSync(ROOT)) if (join(ROOT, other) !== dir) rmSync(join(ROOT, other), { recursive: true, force: true });
  process.env[ENV] = dir;
}

/** The prepared cache directory; fails loudly when the global setup did not run or the cache changed under it. */
function cacheDir(): string {
  const dir = process.env[ENV];
  if (!dir) throw new Error(`${ENV} is not set: ROM tests need the global setup (prepareRomCache) from vitest.config.ts / playwright.config.ts`);
  const keyFile = join(dir, 'key.json');
  if (!existsSync(keyFile)) throw new Error(`ROM test cache ${dir} is gone (another run pruned it?): rerun the tests`);
  const key = JSON.parse(readFileSync(keyFile, 'utf8')) as Key;
  if (dirOf(key) !== dir) throw new Error(`ROM test cache ${dir} holds a different import (${JSON.stringify(key)}): rerun the tests`);
  return dir;
}

/** The prepared cache directory (chain anchors keep their saves under it: checkpoints-anchors.ts). */
export const romCacheDir = (): string => cacheDir();

/** The ROM's SHA-1 (hex), as the cache key has it. */
export function romSha1(): string {
  return (JSON.parse(readFileSync(join(cacheDir(), 'key.json'), 'utf8')) as Key).romSha1;
}

function load<T>(file: string): T {
  const path = join(cacheDir(), file);
  if (!existsSync(path)) throw new Error(`ROM test cache has no ${file}: the global setup did not prepare it`);
  return deserialize(readFileSync(path)) as T;
}

/** A fresh copy of `importPlatinum(rom, …, { slice: true })`'s pack and report. */
export function romSlice(): { pack: PackData; report: ImportReport } {
  return load('slice.v8');
}

/** The full import as the app stores it: [path, bytes] for the PackData JSON and every asset. */
export function romFullFiles(): [string, Uint8Array][] {
  return load('full.v8');
}
