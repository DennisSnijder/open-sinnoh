/**
 * The debug panel's checkpoints (packages/app/src/debug): the story chain anchors the ROM checkpoint tests
 * cache (tests/integration/anchor-key.ts), served only by Vite's development server. It never builds an
 * anchor; one missing from the cache is a 404 that names the file and how to make it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import type * as AnchorKey from '../tests/integration/anchor-key.ts';

export interface CheckpointEntry {
  /** `<prefix>:<seed>`, e.g. `cp4.replay:1`. */
  id: string;
  label: string;
  cached: boolean;
}

export class CheckpointError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const HOW = 'run the ROM checkpoint tests (OPENSINNOH_NDS_ROM=… pnpm vitest run tests/integration/checkpoints-m5a-1.rom.test.ts) in this checkout';

/** The ROM test cache directory (tests/rom.ts keeps one, pruning older keys), or null when there is none. */
function cacheDir(root: string): string | null {
  const tests = join(root, '.opensinnoh-cache/tests');
  const dirs = existsSync(tests) ? readdirSync(tests).filter((d) => existsSync(join(tests, d, 'key.json'))) : [];
  if (dirs.length > 1) throw new CheckpointError(500, `several ROM test caches in ${tests} (${dirs.join(', ')}): ${HOW}`);
  return dirs[0] ? join(tests, dirs[0]) : null;
}

/** Every anchored chunk on every anchor seed, whether its anchor is cached for the current sources. */
export function checkpointEntries(root: string, key: typeof AnchorKey): CheckpointEntry[] {
  const dir = cacheDir(root);
  return key.CHUNKS.flatMap((chunk) =>
    key.ANCHOR_SEEDS.map((seed) => {
      const cached = dir !== null && existsSync(key.anchorFile(dir, chunk.prefix, seed));
      return { id: `${chunk.prefix}:${seed}`, label: `${chunk.name} start (${chunk.prefix} end) · seed ${seed}${cached ? '' : ' · not cached'}`, cached };
    }),
  );
}

/** The anchor save for `id`; a CheckpointError when the id is unknown or the anchor is not cached. */
export function readCheckpoint(root: string, key: typeof AnchorKey, id: string): string {
  const [prefix, seedText] = id.split(':');
  const chunk = key.CHUNKS.find((c) => c.prefix === prefix);
  const seed = Number(seedText);
  if (!chunk || !key.ANCHOR_SEEDS.includes(seed as (typeof key.ANCHOR_SEEDS)[number])) throw new CheckpointError(404, `unknown checkpoint ${id}`);
  const dir = cacheDir(root);
  if (!dir) throw new CheckpointError(404, `no ROM test cache in ${join(root, '.opensinnoh-cache/tests')}: ${HOW}`);
  const file = key.anchorFile(dir, chunk.prefix, seed);
  if (!existsSync(file)) throw new CheckpointError(404, `no cached anchor for ${chunk.prefix} seed ${seed} (${file}; anchors are keyed by the engine sources): ${HOW}`);
  return readFileSync(file, 'utf8');
}

export function devCheckpoints(): Plugin {
  return {
    name: 'opensinnoh-dev-checkpoints',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      // Loaded through Vite on request: the key module imports the (TypeScript) replay parser.
      const key = () => server.ssrLoadModule('/tests/integration/anchor-key.ts') as Promise<typeof AnchorKey>;
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/__opensinnoh/debug/checkpoints') return next();
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('GET only');
          return;
        }
        const id = url.searchParams.get('id');
        key()
          .then((k) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(id === null ? JSON.stringify(checkpointEntries(root, k)) : readCheckpoint(root, k, id));
          })
          .catch((e: unknown) => {
            res.statusCode = e instanceof CheckpointError ? e.status : 500;
            res.setHeader('Content-Type', 'text/plain');
            res.end((e as Error).message);
          });
      });
    },
  };
}
