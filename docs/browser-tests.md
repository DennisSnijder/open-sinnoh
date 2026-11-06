# Browser runner

Use Node 24, `pnpm install --frozen-lockfile`, and an installed Chromium
(`OPENSINNOH_BROWSER_EXECUTABLE` overrides discovery). Run:

```sh
OPENSINNOH_NDS_ROM="$PWD/Pokemon - Platinum Version (USA).nds" pnpm test:browser
OPENSINNOH_TEST_WORKERS=4 pnpm test:browser tests/browser/debug.spec.ts
pnpm test:browser:changed --list
```

On Windows, Chromium is found in `%LOCALAPPDATA%\ms-playwright`. Check the repo out with LF line endings
(`git config core.autocrlf false` before checking out): several specs read the replay files line by line. On many
cores, set `OPENSINNOH_TEST_WORKERS` (8 on a 24-core machine): the default starts more software-GL browsers than the
CPU can draw for, and specs time out.

Without `OPENSINNOH_NDS_ROM`, ROM specs skip. `tools/browser-server.ts` builds once
with `vite.browser.config.ts`, then serves static Vite preview files and fixture
pack endpoints. It already did this before the runner tuning. The browser-only
config keeps the existing `import.meta.env.DEV` test switch, debug/recorder/report
hooks, `window.openSinnohApp`, and `/__test/*.js` module entries. The regular
`pnpm build` remains a production build without those dev-only entries.

`OPENSINNOH_TEST_WORKERS` is a positive integer override (Playwright's `--workers`
also works). The automatic default considers the process's available CPU cores
(including affinity) and memory limit: four workers per three available CPUs (rounded down), capped at one worker per
2 GiB after reserving 2 GiB for the OS/build, with a minimum of one worker.
Software GL uses multiple threads per browser. Divide the host's worker budget
between concurrent shard processes; each process otherwise sees the whole host.
`OPENSINNOH_TEST_PORT` overrides the preview port. `OPENSINNOH_TIMING_DIR` enables the
per-test/hook JSON timing reporter, separated by shard.

## Changed specs

`pnpm test:browser:changed [Playwright options]` compares the working tree with
`git merge-base main HEAD`, including branch commits, staged/unstaged edits, and
untracked, non-ignored files. Renames include the old and new paths. A missing
`main` ref is an error: fetch/create it first. Selection is a union; directly
changed `tests/browser/**/*.spec.ts` files (including subfolders) always run in all configured projects.
Deleted specs cannot run. Documentation and `*.test.ts` unit-test-only changes
do not start a browser.

The mapping in `tools/browser-changes.ts` is deliberately conservative. Spec
names below are relative to `tests/browser/`; `*` is a filename wildcard.

- `packages/app/src/debug/`: `debug.spec.ts` (the panel mounts only with `?debug=1`).
- `site/` (the landing page; it does not ship in the app): `site.spec.ts`.

The title, starter, battle, telemetry and audio code is not mapped: every ROM spec that loads a save goes
through the title, and story and system specs play battles, so those changes run the full suite.

Every other runtime path runs the **full suite**, including shared core,
contracts, game, VM, world, render, importers, menus/services, common app/UI code,
fixtures/packs, browser helpers, configs, tooling and dependencies. A missing
mapped spec also falls back to full. Add a narrow mapping only when its affected
specs are understood; update this doc and the selection tests with it.

## Shards and reports

Native [Playwright sharding and blob report merging](https://playwright.dev/docs/test-sharding)
work through the normal command:

```sh
# Run in separate terminals/checkouts or on separate hosts.
OPENSINNOH_NDS_ROM="/private/Platinum.nds" OPENSINNOH_TEST_WORKERS=2 pnpm test:browser --shard=1/2
OPENSINNOH_NDS_ROM="/private/Platinum.nds" OPENSINNOH_TEST_WORKERS=2 pnpm test:browser --shard=2/2
```

Each process builds once into `test-artifacts/shard-i-of-n/browser-build`, uses
port `4173 + i` unless overridden, and owns its `playwright/`, `playwright.json`
and `blob-report/` in that shard directory. This also isolates the PWA spec that
temporarily edits its served service worker. `test:browser:shard` remains an
alias. Explicitly serial spec groups remain serial within a shard.

On a second host, check out the **same commit**, use the same lockfile and
Playwright/Chromium versions, install dependencies, and provide that host's own
ROM copy through `OPENSINNOH_NDS_ROM`. Keep ROM availability and all test filters
(projects/grep/changed diff) identical between shards; otherwise their test sets
differ. Each host prepares its own ignored ROM import cache. Never commit the
ROM, import cache, screenshots or reports containing ROM content.

After all shards finish, collect only their blob ZIPs into a fresh directory on
one host. Copy the second host's ZIP with `scp` or your artifact transport. Keep
reports from different runs/commits separate. For example, once both shard
directories have been collected locally:

```sh
blob_dir=$(mktemp -d "$PWD/test-artifacts/merge-XXXXXX")
cp test-artifacts/shard-1-of-2/blob-report/*.zip "$blob_dir/"
cp test-artifacts/shard-2-of-2/blob-report/*.zip "$blob_dir/"
pnpm test:browser:merge "$blob_dir"
pnpm exec playwright show-report playwright-report
```

The merge writes `playwright-report/index.html` and
`test-artifacts/playwright-merged.json`; it needs neither a ROM nor a browser.
Merge failed shards too so their failures are visible. The shard exit codes are
the test gate; report generation is not a substitute for checking them.

## Measurements

2026-10-18, source baseline `9b6fa1e`: QEMU x86-64 VM, 10 vCPUs, 23 GiB RAM,
Node 24.18.1, Playwright 1.64.0, Chrome headless shell 151.0.7922.34 with
SwiftShader. All benchmark processes and their children were pinned to CPUs 0–5
with `taskset`; this is a six-CPU affinity limit on a ten-vCPU host, not a claim
of a separate physical six-core machine. Other suites were running browser and
ROM tests. Sample start/end one-minute load averages were roughly 32–46.

The fixed sample was `debug.spec.ts ui-gallery.spec.ts zoom.spec.ts
overhead.rom.spec.ts --project=desktop --project=phone`, with Platinum enabled
and its import cache warm. Each passing run had 11 passes and the same 5 existing
project skips. Wall times include a new static build, setup and report writing:

- Original config, 3 workers: **147.27 s**, passed.
- 2 workers: **187.55 s**, passed.
- 4 workers: **140.80 s**, failed (desktop zoom's existing 120 s timeout).
- 6 workers: **129.21 s**, passed; automatic-default trial **131.74 s**, failed (desktop zoom's existing 120 s timeout).
- 8 workers: **128.74 s**, passed; repeat **134.01 s**, passed; final automatic default **131.44 s**, passed (about 11% below the original 3-worker sample).

Eight workers passed all three trials; six timed out on its repeat. The default
therefore allows modest CPU oversubscription (8 workers on 6 available CPUs),
capped by the RAM budget. Failed runs are not counted as speed gains.

Reproduce a candidate (use a free port if 4173 is taken):

```sh
taskset -c 0-5 env OPENSINNOH_TEST_WORKERS=8 OPENSINNOH_TEST_PORT=4273 \
  OPENSINNOH_NDS_ROM="$PWD/Pokemon - Platinum Version (USA).nds" \
  pnpm test:browser debug.spec.ts ui-gallery.spec.ts zoom.spec.ts overhead.rom.spec.ts \
  --project=desktop --project=phone
```

The unchanged full ROM browser run was interrupted at **267.18 s** after 10
passes and three failures: fixture app-shell timed out, audio reported zero
active channels, and the first battle animation timed out. Three tests were
interrupted and 721 did not run. That failed, interrupted run is **not** a
full-suite timing baseline. No full-suite speedup is claimed from the sample.

Runner validation: `pnpm check` passed (1,318 tests passed, 531 ROM tests skipped).
Full `OPENSINNOH_NDS_ROM=… pnpm test` passed (1,843 passed, 6 skipped; 610 s wall time).
The ROM-enabled inventory split all 737 browser tests into disjoint shards of
374 and 363. Two concurrent smoke shards passed three debug/PWA tests and merged
into HTML and JSON with three passes, no skips or failures, and separate timing files.

Keep the same spec set, ROM/cache state, CPU affinity and browser executable for
before/after timings; include build and setup in wall time and record shared
load. Do not compare a ROM-skipping run with a ROM-enabled run.
