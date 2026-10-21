import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Skipped ROM files have duration zero: unit runs must not erase the ROM scheduler's timings.
  cacheDir: `.opensinnoh-cache/vitest/${process.env.OPENSINNOH_NDS_ROM ? 'platinum' : 'unit'}${process.env.OPENSINNOH_HGSS_ROM ? '-hgss' : ''}`,
  test: {
    // With OPENSINNOH_NDS_ROM: one slice import per run, cached on disk across runs (tests/rom.ts).
    globalSetup: ['tests/setup-rom.ts'],
    // Six-CPU probes preferred six reused forks; cap that measured budget on larger hosts.
    pool: 'forks',
    maxWorkers: Math.min(6, availableParallelism()),
    ...(process.env.OPENSINNOH_TIMING_DIR ? { reporters: ['default', './tools/timing-vitest.ts'] } : {}),
    hookTimeout: 60_000,
    // Workers are reused across files (saves a worker start and the module graph per file): a test file
    // must not rely on fresh module state or leave globals behind (storage.test.ts's fake-indexeddb is benign).
    isolate: false,
    // ROM tests decode whole archives in one test (all species sprites, every build model): 5 s is too tight.
    // Heavily contended local runs can raise the deadline without changing the normal gate.
    testTimeout: Number(process.env.OPENSINNOH_TEST_TIMEOUT_MS ?? (process.env.OPENSINNOH_NDS_ROM ? 60_000 : 5_000)),
    include: ['packages/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tools/*.test.ts'],
    exclude: ['reference-projects/**', '**/node_modules/**'],
  },
});
