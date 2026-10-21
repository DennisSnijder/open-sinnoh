# Test speed measurements — 2026-10-18

Observed warm ROM wall time: **13m 28.0s → 11m 54.5s (-11.6%)**. Warm `pnpm check`: **14.93s → 6.12s (-59.0%)**. All original scenarios and assertions remain. Host contention changed between measurements: these wall-time differences are observed results, not isolated estimates of the code’s effect.

## Conditions and totals

Same Linux QEMU VM: 10 exposed vCPUs, about 23 GiB RAM; every measured command restricted to **CPUs 0–5 with `taskset`**, modeling six available CPUs. Node 24.18.1, pnpm 10.29.2, Vitest 5.0.4. The original default was five fork workers; final configuration uses six forks for both tiers. Workers remain reused (`isolate: false`).

Unrelated browser suites were running on the same host. The 1-minute host load was sampled each second; it includes work outside our six-CPU affinity. These are contended local measurements, not isolated benchmark estimates. Warm means both the ROM slice and prefix anchors already existed; no ROM import or anchor cache was copied into a new key. The primary baseline already includes the timing instrumentation, six cache-key fixture cases and seven concurrently added browser-runner unit cases; the speed changes were still unapplied.

| Command, warm caches | Before wall | After wall | Change | Before CPU | After CPU | Before load min–max (mean) | After load min–max (mean) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ROM `pnpm test`, final tier cache | 13m 28.0s | 11m 54.5s | -11.6% | 43m 55.0s | 42m 5.3s | 23.2–32.0 (26.7) | 15.5–34.0 (21.0) |
| ROM, runtime fix before tier-cache separation | 13m 28.0s | 12m 26.5s | -7.6% | 43m 55.0s | 40m 46.5s | 23.2–32.0 (26.7) | 19.8–32.9 (28.6) |
| `pnpm check`, median of three final repeats | 14.93s | 6.12s | -59.0% | 44.81s | 32.73s | 23.6–24.4 (24.1) | 18.3–18.6 (18.5) |

ROM CPU change: -4.2%; check CPU change: -26.9%. The earlier post-runtime ROM run had contention closer to the baseline and took 746.52s wall / 2446.48s CPU (−7.6% wall, −7.2% CPU).

Final warm check repeats (wall seconds, in order): 6.00, 6.12, 7.82. Representative per-file table: `tier-check-warm-2`.

CPU is user+system time for the command and its descendants; it can exceed wall time because files run in parallel. Execution columns use Vitest durations including hooks, excluding collection/preparation; collection is shown separately. Summed file durations overlap and are not suite wall time.

The initial cold ROM baseline took 26m 12.6s (slice import 15.2s plus new anchors). It is context only, not the speedup denominator. After the harness/key changes, all 45 anchors were genuinely rebuilt via `chainAnchor` twice: initially in 148.65s wall / 335.72s CPU, then after the runtime fix in 140.12s wall / 276.35s CPU, with three seed processes. Every final save was byte-identical to its original. The first post-splitting `check` took 34.94s, dominated by typecheck at 34.3s after invalidation; its next warm run was 11.25s. The first check after the game change took 40.03s, typecheck 39.1s; the next warm check took 16.34s at load 27.2–30.3. The primary after-check figure above is the median of three final warm repeats, not the fastest run. Earlier checks were 20.03s then 14.93s; caches were not purged, so there is no clean cold-check comparison.

## What changed and what was verified

- **Field ticks:** CPU profiling of CP15 found two complete world views per field tick, both used only for their map-load count (popup and music observers). Actor previews and Distortion World geometry dominated the view cost. The observers now share one view on ticks, resets and loads, in the original order. The new regression rejects the original two-view implementation in a control run; existing popup/audio and full replay checks remain. No contract or importer-output change was needed.
- **Slice reuse:** `prepareRomCache()` already imported once, and the warm baseline did not rebuild it. `romSlice()` intentionally still returns a fresh copy for callers that mutate fixtures. The checkpoint `storyGame` previously deserialized the same ~23 MB slice for each game (279 calls in the warm baseline). It now shares one deeply frozen input pack per worker; each game still validates records and builds fresh registries and mutable state. A new ROM regression proves shared records reject mutation and game state remains independent.
- **Avoid unrelated anchor invalidation:** the old anchor key hashed every package, including app/UI/render code. It now follows the headless game's runtime workspace dependencies, package manifests, data, harness and lockfile. UI/render/`*.test.ts` edits keep these anchors warm; relevant engine, data, dependency and harness edits invalidate them. Seven original-fixture regressions exercise the key, including its actual wiring. ROM identity, importer version/source key and replay-prefix text still contribute to the anchor path.
- **Timing cache isolation:** no-ROM runs previously overwrote skipped ROM files’ learned durations with zero, damaging longest-first scheduling. Vitest now keeps separate cache directories by ROM tier. A full no-ROM run left the Platinum timing cache byte-for-byte unchanged. For the final warm comparison, only duration metadata from the preceding successful full ROM run was relocated into the new tier directory; ROM imports and anchors were not copied. The baseline likewise had a prior completed warm ROM run.
- **Parallel files:** split M5 checkpoint halves, late-start shifts, branch seeds, M1 checkpoint/shift cases, trainer seeds, system scenarios and service scenarios. All original seeds, replays, delays, repeat/determinism checks, save round trips, battle/frame checks, partners and stub allowlists remain. The wrappers choose subsets; they use the same assertion bodies.
- **Keep full prefixes where they prove something:** all three full-chain anchor proofs remain intact, twice from a new game with intermediate save checks and final anchored-state comparison. M1 checkpoint/late-start chains still run the opening. Rock Smash still runs CP4 and checks cumulative wild-battle counts. A save omits battle history and transient modes, so replacing those prefixes with an anchor would weaken their checks.
- **Collection:** move ROM byte reads/decoding into `beforeAll` in four files. No-ROM global setup lazily avoids the importer graph. With neither ROM environment variable set, `pnpm check` skips collection of `*.rom.test.ts`; the baseline audit found zero active cases in those files. Plain `rom.test.ts` keeps its original-byte rejection case. Direct `pnpm test` and ROM-file runs retain normal skip behavior. With either ROM variable set, `check` applies no additional exclusion.

The normalized ROM scenario inventory expands each old four-delay loop before comparison: 1,993 before, 1,996 after, **zero missing**, three added regressions. Raw ROM tests: 1,843 passed / 6 skipped before; 1,990 passed / 6 skipped after. The extra 144 reported cases expose existing delay iterations as separate tests, not new coverage. Files: 263 → 328. The assertion-expression AST audit of the five moved/refactored helpers was identical. No existing test was deleted or classified as redundant.

No-ROM `check` retains all 1,318 originally active cases and adds the key-wiring and field-view regressions: 1,320 passed / 28 skipped. An unfiltered no-ROM `pnpm test` also passed exactly those same 1,320 active cases (676 skipped), proving the collection filter removed no active check coverage. Lint and typecheck passed alongside the pack replays. Importer output and `IMPORTER_VERSION` are unchanged.

## Worker experiments

Original no-ROM suite, same six-CPU affinity, two orders reversed to reduce order bias. All runs passed 1,318 active cases. Times are external wall seconds; shared load makes small differences uncertain.

| Pool | Workers | First | Second | Median |
| --- | ---: | ---: | ---: | ---: |
| forks | 3 | 16.78 | 20.63 | 18.70 |
| forks | 4 | 17.18 | 13.52 | 15.35 |
| forks | 5 | 16.33 | 17.54 | 16.94 |
| forks | 6 | 10.84 | 15.67 | 13.26 |
| threads | 5 | 22.84 | 17.04 | 19.94 |
| threads | 6 | 17.88 | 22.78 | 20.33 |

Six forks won both unit comparisons with five. A full ROM experiment with six forks passed all cases but took 14m 23.3s and 3,037.61 CPU seconds, worse than the baseline. Five forks also passed every case but took 17m 9.5s and 2,972.86 CPU seconds. Six is retained after the runtime fix. These experiments differed in contention and Vitest's learned scheduling data, so they do not isolate a universal worker-count effect. Isolated CP4 and CP15 A/Bs in raw/frozen/frozen/raw order showed no frozen-pack CPU regression; all four runs of each replay had identical ticks, assertions and final state. CP15 before the world-view fix used 24.20–25.37 CPU seconds (27.67–35.31s wall); after, 20.55–20.62 CPU seconds (24.80–28.66s wall), with identical work and final state. These focused runs were also contended; the full-suite timings remain the primary comparison.

## Twenty slowest baseline files and why

M5 story games also paid for repeated pack deserialization, and every field tick built two full world views; the specific serial work is listed below. All paths in this table are under `tests/integration/` and end in `.rom.test.ts`. For a split file, **after total sums every replacement part**; longest part is the largest single file. This avoids claiming a quarter of the work as the whole improvement. Seconds, rounded to two decimals.

| Baseline file | Before | After total | Longest part | Parts | Why |
| --- | ---: | ---: | ---: | ---: | --- |
| `checkpoints-m5c-anchor` | 236.89 | 223.07 | 223.07 | 1 | Full CP1–19 chain twice, reload saves checked against the chunk’s anchors, plus the anchored end-state comparison. Kept intact. |
| `checkpoints-m5a-late-1` | 187.52 | 188.92 | 56.68 | 4 | CP5–8 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5b-anchor` | 184.91 | 151.88 | 151.88 | 1 | Full CP1–13 chain twice, reload saves checked against the chunk’s anchors, plus the anchored end-state comparison. Kept intact. |
| `checkpoints-m5a-late-3` | 182.33 | 168.99 | 50.30 | 4 | CP5–8 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5b-late-2` | 174.40 | 168.94 | 51.38 | 4 | CP9–13 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5a-late-2` | 166.85 | 150.84 | 42.60 | 4 | CP5–8 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5c-late-1` | 166.60 | 148.91 | 43.63 | 4 | CP14–19 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5c-late-2` | 163.73 | 147.13 | 39.66 | 4 | CP14–19 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5c-late-3` | 158.99 | 151.95 | 47.43 | 4 | CP14–19 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5b-late-3` | 151.20 | 156.29 | 56.32 | 4 | CP9–13 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `checkpoints-m5b-late-1` | 143.85 | 138.00 | 44.20 | 4 | CP9–13 on one seed at all four shifts; walking, battles and grinding ran serially. Each shift now has its own file. |
| `sys-replays` | 127.99 | 176.44 | 60.64 | 5 | 24 system scenarios plus the pending-feature guard; Rock Smash replays CP4 and checks cumulative wild-battle counts. Split independent systems. |
| `checkpoints-m5a-anchor` | 113.07 | 71.14 | 71.14 | 1 | Full CP1–8 chain twice, reload saves checked against the chunk’s anchors, plus the anchored end-state comparison. Kept intact. |
| `m2a` | 86.50 | 100.16 | 39.64 | 3 | Nine trainer scenarios on three seeds, twice each; several replay the opening/CP2 prefix and inspect every battle/blackout frame. Split by seed. |
| `checkpoints-m5b-3` | 81.62 | 96.09 | 49.06 | 2 | CP9–13 twice on one seed, with save round trips; serial checkpoints and repeated pack deserialization. Split into two parts. |
| `checkpoints-m5c-3` | 77.21 | 60.56 | 33.70 | 2 | CP14–19 twice on one seed, with save round trips; serial checkpoints and repeated pack deserialization. Split into two parts. |
| `checkpoints-m5a-1` | 74.40 | 79.43 | 48.49 | 2 | CP5–8 twice on one seed, with save round trips; serial checkpoints and repeated pack deserialization. Split into two parts. |
| `checkpoints-m5b-1` | 71.17 | 70.31 | 47.24 | 2 | CP9–13 twice on one seed, with save round trips; serial checkpoints and repeated pack deserialization. Split into two parts. |
| `checkpoints-m5c-2` | 70.97 | 68.57 | 44.86 | 2 | CP14–19 twice on one seed, with save round trips; serial checkpoints and repeated pack deserialization. Split into two parts. |
| `checkpoints-late-3` | 70.78 | 71.99 | 21.23 | 4 | Entire opening→CP4 chain at four shifts on one seed, including seeded wild grinding; each shift now has its own file. |

Some split families have higher summed durations: systems 127.99s → 176.44s, trainer scenarios 86.50s → 100.16s. Their largest individual files fell to 60.64s and 39.64s respectively. Extra files repeat per-file setup and distribute work across workers; contention and JIT warmup also affect these sums. The measurements do not isolate those costs. The table retains the regressions rather than treating every split as a CPU win.

## Every file: before and after

Execution and collection seconds for exact paths, rather than the family totals above. Shared module-graph import cost is charged to the first file that loads it in each worker. `—` means a new wrapper/regression. Skipped files have zero execution duration. Source moves retain the original wrapper path; the new subset wrappers appear on separate rows.

<details>
<summary>All measured files</summary>

| File | Before execution | After execution | Before collection | After collection |
| --- | ---: | ---: | ---: | ---: |
| `packages/app/src/app.test.ts` | 0.066 | 0.032 | 0.058 | 0.075 |
| `packages/app/src/chunk.test.ts` | 0.003 | 0.023 | 0.020 | 0.042 |
| `packages/app/src/controls.test.ts` | 0.008 | 0.014 | 0.012 | 0.020 |
| `packages/app/src/debug/actions.test.ts` | 0.208 | 0.210 | 0.019 | 0.012 |
| `packages/app/src/debug/perf.test.ts` | 0.002 | 0.005 | 0.079 | 0.049 |
| `packages/app/src/flashing.test.ts` | 0.004 | 0.006 | 0.010 | 0.034 |
| `packages/app/src/json-bytes.test.ts` | 0.192 | 0.397 | 0.015 | 0.035 |
| `packages/app/src/layout.test.ts` | 0.001 | 0.001 | 0.025 | 0.016 |
| `packages/app/src/mods.test.ts` | 0.024 | 0.121 | 0.143 | 0.154 |
| `packages/app/src/new-game.test.ts` | 0.002 | 0.002 | 0.036 | 0.047 |
| `packages/app/src/phone.test.ts` | 0.018 | 0.008 | 0.005 | 0.050 |
| `packages/app/src/platform.test.ts` | 0.003 | 0.005 | 0.043 | 0.060 |
| `packages/app/src/recorder.test.ts` | 0.014 | 0.027 | 0.020 | 0.019 |
| `packages/app/src/save-errors.test.ts` | 0.057 | 0.025 | 0.049 | 0.061 |
| `packages/app/src/speed.test.ts` | 0.002 | 0.028 | 0.032 | 0.045 |
| `packages/app/src/starter/starter.test.ts` | 0.027 | 0.033 | 0.051 | 0.046 |
| `packages/app/src/store-upgrade.test.ts` | 0.007 | 0.006 | 0.088 | 0.083 |
| `packages/app/src/store.test.ts` | 0.075 | 0.064 | 0.180 | 0.068 |
| `packages/app/src/telemetry/telemetry.test.ts` | 0.052 | 0.064 | 0.083 | 0.040 |
| `packages/app/src/title/title.test.ts` | 0.002 | 0.002 | 0.023 | 0.073 |
| `packages/app/src/ui/announce.test.ts` | 0.002 | 0.007 | 0.033 | 0.054 |
| `packages/app/src/ui/settings.test.ts` | 0.019 | 0.048 | 0.162 | 0.486 |
| `packages/app/src/ui/ui.test.ts` | 0.009 | 0.006 | 0.049 | 0.118 |
| `packages/app/src/zoom.test.ts` | 0.014 | 0.010 | 0.027 | 0.028 |
| `packages/audio/src/audio.rom.test.ts` | 2.309 | 4.497 | 0.019 | 0.038 |
| `packages/audio/src/audio.test.ts` | 0.282 | 0.166 | 0.025 | 0.038 |
| `packages/battle/src/ai/ai.rom.test.ts` | 3.856 | 3.760 | 0.075 | 0.031 |
| `packages/battle/src/ai/ai.test.ts` | 0.059 | 0.034 | 0.021 | 0.021 |
| `packages/battle/src/ai/flags.rom.test.ts` | 0.719 | 2.000 | 0.005 | 0.016 |
| `packages/battle/src/anim/anim.rom.test.ts` | 15.289 | 19.449 | 0.014 | 0.016 |
| `packages/battle/src/anim/anim.test.ts` | 0.030 | 0.051 | 0.030 | 0.025 |
| `packages/battle/src/anim/objects.test.ts` | 0.027 | 0.053 | 0.009 | 0.079 |
| `packages/battle/src/bag.test.ts` | 0.754 | 0.423 | 0.043 | 0.055 |
| `packages/battle/src/battle.test.ts` | 0.354 | 0.230 | 0.021 | 0.026 |
| `packages/battle/src/controller/ai-doubles.rom.test.ts` | 1.179 | 2.033 | 0.035 | 0.021 |
| `packages/battle/src/controller/ai-target.test.ts` | 0.026 | 0.044 | 0.025 | 0.109 |
| `packages/battle/src/controller/ai-trace.rom.test.ts` | 1.066 | 1.499 | 0.014 | 0.009 |
| `packages/battle/src/controller/ai-view.test.ts` | 0.055 | 0.069 | 0.090 | 0.036 |
| `packages/battle/src/controller/doubles-card.test.ts` | 0.076 | 0.115 | 0.031 | 0.025 |
| `packages/battle/src/controller/doubles-topologies.test.ts` | 2.723 | 2.594 | 0.025 | 0.157 |
| `packages/battle/src/controller/doubles.rom.test.ts` | 24.693 | 31.216 | 0.030 | 0.016 |
| `packages/battle/src/controller/doubles.test.ts` | 0.559 | 0.682 | 0.062 | 0.018 |
| `packages/battle/src/controller/experience-parity.test.ts` | 1.113 | 1.572 | 0.006 | 0.357 |
| `packages/battle/src/controller/message-speed.test.ts` | 0.144 | 0.116 | 0.032 | 0.018 |
| `packages/battle/src/controller/protocol.rom.test.ts` | 32.602 | 44.986 | 0.015 | 0.052 |
| `packages/battle/src/controller/start-items.rom.test.ts` | 1.237 | 2.040 | 0.005 | 0.008 |
| `packages/battle/src/controller/trainer.test.ts` | 0.630 | 1.322 | 0.040 | 0.118 |
| `packages/battle/src/controller/weather-parity.test.ts` | 1.604 | 2.993 | 0.062 | 0.341 |
| `packages/battle/src/damage.test.ts` | 0.032 | 0.145 | 0.023 | 0.135 |
| `packages/battle/src/roamer.test.ts` | 0.038 | 0.062 | 0.022 | 0.025 |
| `packages/battle/src/sim/dex.rom.test.ts` | 2.059 | 3.625 | 0.003 | 0.006 |
| `packages/battle/src/sim/dex.test.ts` | 0.084 | 0.131 | 0.038 | 0.028 |
| `packages/battle/src/sim/doubles-rules.test.ts` | 0.075 | 0.108 | 0.034 | 0.020 |
| `packages/battle/src/sim/trainer-pair.proof.test.ts` | 1.628 | 1.472 | 0.008 | 0.021 |
| `packages/battle/src/sim/warm.test.ts` | 0.023 | 0.072 | 0.011 | 0.012 |
| `packages/cli/src/cli.test.ts` | 0.538 | 0.374 | 0.612 | 0.006 |
| `packages/cli/src/debug-checkpoints.test.ts` | 0.352 | 0.250 | 0.031 | 0.017 |
| `packages/cli/src/pack-replays.test.ts` | 0.593 | 2.118 | 0.250 | 0.514 |
| `packages/cli/src/plugin.test.ts` | 0.087 | 0.051 | 0.020 | 0.054 |
| `packages/cli/src/replays.test.ts` | 0.185 | 0.312 | 0.015 | 0.016 |
| `packages/contracts/src/text.test.ts` | 0.001 | 0.001 | 0.013 | 0.019 |
| `packages/core/src/clock.test.ts` | 0.003 | 0.013 | 0.016 | 0.058 |
| `packages/core/src/core.test.ts` | 0.019 | 0.055 | 0.031 | 0.042 |
| `packages/core/src/egg.test.ts` | 0.019 | 0.018 | 0.022 | 0.009 |
| `packages/core/src/evolution.test.ts` | 0.012 | 0.010 | 0.015 | 0.018 |
| `packages/core/src/field-systems.test.ts` | 0.003 | 0.002 | 0.019 | 0.020 |
| `packages/core/src/json-patch.test.ts` | 0.002 | 0.016 | 0.010 | 0.034 |
| `packages/core/src/pokemon.test.ts` | 0.042 | 0.021 | 0.068 | 0.010 |
| `packages/core/src/prng.test.ts` | 0.001 | 0.001 | 0.009 | 0.021 |
| `packages/g3d/src/bma.test.ts` | 0.001 | 0.008 | 0.018 | 0.038 |
| `packages/g3d/src/g3d.test.ts` | 0.048 | 0.076 | 0.162 | 0.152 |
| `packages/g3d/src/scene-formats.test.ts` | 0.011 | 0.001 | 0.016 | 0.010 |
| `packages/game/src/battle-music.test.ts` | 0.006 | 0.002 | 0.050 | 0.038 |
| `packages/game/src/clear-game.test.ts` | 0.041 | 0.034 | 0.037 | 0.050 |
| `packages/game/src/evolution.test.ts` | 0.050 | 0.061 | 0.008 | 0.023 |
| `packages/game/src/field-items.test.ts` | 0.141 | 0.101 | 0.014 | 0.012 |
| `packages/game/src/field-moves.test.ts` | 0.185 | 0.108 | 0.008 | 0.010 |
| `packages/game/src/field-return.test.ts` | 0.711 | 0.467 | 0.050 | 0.003 |
| `packages/game/src/field-sound.test.ts` | 0.357 | 0.299 | 0.011 | 0.014 |
| `packages/game/src/field-systems.test.ts` | 0.547 | 0.231 | 0.041 | 0.032 |
| `packages/game/src/game.test.ts` | 0.154 | 0.227 | 0.010 | 0.011 |
| `packages/game/src/map-popup.test.ts` | 0.015 | 0.002 | 0.012 | 0.014 |
| `packages/game/src/partner-heal.test.ts` | 0.129 | 0.041 | 0.008 | 0.018 |
| `packages/game/src/replay-runner.test.ts` | 0.347 | 0.329 | 0.025 | 0.027 |
| `packages/game/src/save-files.test.ts` | 0.140 | 0.117 | 0.013 | 0.015 |
| `packages/game/src/save.test.ts` | 0.465 | 0.745 | 0.019 | 0.058 |
| `packages/game/src/sound.test.ts` | 0.210 | 0.215 | 0.025 | 0.021 |
| `packages/game/src/storage.test.ts` | 0.018 | 0.039 | 0.049 | 0.144 |
| `packages/game/src/until-auto.test.ts` | 0.011 | 0.002 | 0.020 | 0.022 |
| `packages/game/src/until-wild.test.ts` | 0.002 | 0.002 | 0.016 | 0.039 |
| `packages/game/src/validators.test.ts` | 0.622 | 0.642 | 0.044 | 0.008 |
| `packages/importer/src/assets/assets.rom.test.ts` | 20.207 | 23.019 | 0.248 | 0.008 |
| `packages/importer/src/assets/object-gfx.test.ts` | 0.011 | 0.018 | 0.021 | 0.030 |
| `packages/importer/src/battle/spa.test.ts` | 0.016 | 0.014 | 0.017 | 0.056 |
| `packages/importer/src/choose-starter.rom.test.ts` | 0.652 | 0.459 | 0.007 | 0.004 |
| `packages/importer/src/distortion/distortion.rom.test.ts` | 1.775 | 1.967 | 0.004 | 0.041 |
| `packages/importer/src/distortion/distortion.test.ts` | 0.048 | 0.088 | 0.023 | 0.024 |
| `packages/importer/src/followers.rom.test.ts` | 1.157 | 0.790 | 0.020 | 0.003 |
| `packages/importer/src/followers.test.ts` | 0.002 | 0.001 | 0.010 | 0.018 |
| `packages/importer/src/formats.test.ts` | 0.077 | 0.084 | 0.052 | 0.042 |
| `packages/importer/src/gyms/gyms.test.ts` | 0.014 | 0.024 | 0.010 | 0.044 |
| `packages/importer/src/gyms/sunyshore.test.ts` | 0.002 | 0.012 | 0.017 | 0.019 |
| `packages/importer/src/hgss/followers.rom.test.ts` | 0.000 | 0.000 | 0.017 | 0.045 |
| `packages/importer/src/hgss/followers.test.ts` | 0.028 | 0.032 | 0.012 | 0.022 |
| `packages/importer/src/object-clones.test.ts` | 0.002 | 0.001 | 0.015 | 0.014 |
| `packages/importer/src/pokemon.rom.test.ts` | 1.593 | 3.370 | 0.007 | 0.027 |
| `packages/importer/src/rom.test.ts` | 35.557 | 33.283 | 0.010 | 0.045 |
| `packages/importer/src/title/title.rom.test.ts` | 0.698 | 0.637 | 0.012 | 0.019 |
| `packages/importer/src/ui2d/nitro2d.test.ts` | 0.028 | 0.018 | 0.015 | 0.031 |
| `packages/importer/src/ui2d/ui2d.rom.test.ts` | 17.690 | 18.920 | 0.033 | 0.036 |
| `packages/importer/src/ui2d/ui2d.test.ts` | 0.081 | 0.090 | 0.013 | 0.020 |
| `packages/menus/src/apps-m3a.test.ts` | 0.305 | 0.134 | 0.076 | 0.039 |
| `packages/menus/src/battle.test.ts` | 0.027 | 0.018 | 0.102 | 0.039 |
| `packages/menus/src/daycare.test.ts` | 0.036 | 0.046 | 0.048 | 0.071 |
| `packages/menus/src/evolution.test.ts` | 0.177 | 0.174 | 0.027 | 0.014 |
| `packages/menus/src/library-tv.test.ts` | 0.008 | 0.002 | 0.018 | 0.016 |
| `packages/menus/src/menus.test.ts` | 0.033 | 0.011 | 0.030 | 0.049 |
| `packages/menus/src/pokedex-scroll.test.ts` | 0.001 | 0.014 | 0.012 | 0.037 |
| `packages/menus/src/pokedex.test.ts` | 0.021 | 0.093 | 0.040 | 0.070 |
| `packages/menus/src/poketch.test.ts` | 0.125 | 0.111 | 0.031 | 0.047 |
| `packages/menus/src/rowan-intro.test.ts` | 0.075 | 0.039 | 0.060 | 0.038 |
| `packages/menus/src/sound.test.ts` | 0.039 | 0.037 | 0.018 | 0.034 |
| `packages/nds/src/blz.test.ts` | 0.268 | 0.501 | 0.010 | 0.023 |
| `packages/nds/src/hgss.rom.test.ts` | 0.000 | 0.000 | 0.014 | 0.042 |
| `packages/nds/src/lz.test.ts` | 0.002 | 0.011 | 0.021 | 0.043 |
| `packages/nds/src/nds.test.ts` | 0.006 | 0.008 | 0.018 | 0.023 |
| `packages/nds/src/rom.test.ts` | 0.726 | 1.852 | 0.276 | 0.030 |
| `packages/render/src/ceilings.test.ts` | 0.018 | 0.019 | 0.098 | 0.183 |
| `packages/render/src/flash.test.ts` | 0.015 | 0.008 | 0.044 | 0.017 |
| `packages/render/src/render.test.ts` | 0.060 | 0.072 | 0.023 | 0.237 |
| `packages/render/src/ships.test.ts` | 0.001 | 0.001 | 0.008 | 0.025 |
| `packages/services/src/card.test.ts` | 0.151 | 0.174 | 0.052 | 0.045 |
| `packages/text/src/rom.test.ts` | 0.306 | 0.554 | 0.003 | 0.003 |
| `packages/text/src/text.test.ts` | 0.051 | 0.091 | 0.017 | 0.052 |
| `packages/ui/src/tokens.test.ts` | 0.116 | 0.053 | 0.065 | 0.097 |
| `packages/vm/src/audio-ops.test.ts` | 0.006 | 0.009 | 0.031 | 0.076 |
| `packages/vm/src/classify.test.ts` | 0.205 | 0.165 | 0.012 | 0.012 |
| `packages/vm/src/daycare-ops.test.ts` | 0.011 | 0.027 | 0.048 | 0.031 |
| `packages/vm/src/decode/decode.test.ts` | 0.007 | 0.011 | 0.026 | 0.027 |
| `packages/vm/src/decode/rom.test.ts` | 1.720 | 3.788 | 0.472 | 0.046 |
| `packages/vm/src/field-system-ops.test.ts` | 0.130 | 0.086 | 0.025 | 0.022 |
| `packages/vm/src/gym-ops.test.ts` | 0.048 | 0.039 | 0.063 | 0.066 |
| `packages/vm/src/m1b-ops.test.ts` | 0.034 | 0.023 | 0.037 | 0.049 |
| `packages/vm/src/m2a-ops.test.ts` | 0.027 | 0.037 | 0.033 | 0.039 |
| `packages/vm/src/m3a-ops.test.ts` | 0.011 | 0.021 | 0.033 | 0.030 |
| `packages/vm/src/m5-ops.test.ts` | 0.016 | 0.020 | 0.014 | 0.028 |
| `packages/vm/src/ops.test.ts` | 0.096 | 0.039 | 0.084 | 0.046 |
| `packages/vm/src/party-ops.test.ts` | 0.018 | 0.016 | 0.045 | 0.051 |
| `packages/vm/src/runner.test.ts` | 0.072 | 0.067 | 0.053 | 0.032 |
| `packages/vm/src/spear-app.test.ts` | 0.000 | 0.001 | 0.011 | 0.031 |
| `packages/vm/src/static-ops.test.ts` | 0.035 | 0.007 | 0.038 | 0.043 |
| `packages/world/src/avatar.test.ts` | 0.225 | 0.121 | 0.054 | 0.018 |
| `packages/world/src/battle-weather.test.ts` | 0.021 | 0.003 | 0.019 | 0.014 |
| `packages/world/src/boat.test.ts` | 0.009 | 0.013 | 0.012 | 0.038 |
| `packages/world/src/camera.test.ts` | 0.027 | 0.027 | 0.007 | 0.030 |
| `packages/world/src/connections.test.ts` | 0.045 | 0.110 | 0.012 | 0.019 |
| `packages/world/src/containment.test.ts` | 0.001 | 0.001 | 0.019 | 0.029 |
| `packages/world/src/distortion/distortion.test.ts` | 0.096 | 0.105 | 0.023 | 0.041 |
| `packages/world/src/distortion/sky.test.ts` | 0.001 | 0.001 | 0.005 | 0.024 |
| `packages/world/src/distortion/support.test.ts` | 0.003 | 0.010 | 0.049 | 0.085 |
| `packages/world/src/encounters.test.ts` | 1.041 | 0.599 | 0.020 | 0.114 |
| `packages/world/src/fishing.test.ts` | 0.060 | 0.065 | 0.034 | 0.018 |
| `packages/world/src/gate.test.ts` | 0.014 | 0.037 | 0.009 | 0.007 |
| `packages/world/src/grass.test.ts` | 0.056 | 0.054 | 0.010 | 0.017 |
| `packages/world/src/gyms/canalave.test.ts` | 0.057 | 0.020 | 0.032 | 0.044 |
| `packages/world/src/gyms/gyms.test.ts` | 0.178 | 0.288 | 0.014 | 0.024 |
| `packages/world/src/gyms/pastoria.test.ts` | 0.026 | 0.042 | 0.020 | 0.022 |
| `packages/world/src/gyms/sunyshore.test.ts` | 0.007 | 0.003 | 0.022 | 0.032 |
| `packages/world/src/heal-machine.test.ts` | 0.001 | 0.001 | 0.011 | 0.032 |
| `packages/world/src/ice.test.ts` | 0.134 | 0.174 | 0.023 | 0.011 |
| `packages/world/src/mapchange.test.ts` | 0.001 | 0.001 | 0.008 | 0.029 |
| `packages/world/src/movement-types.test.ts` | 0.977 | 0.743 | 0.026 | 0.016 |
| `packages/world/src/npc-types.test.ts` | 0.632 | 0.707 | 0.029 | 0.045 |
| `packages/world/src/party-follower.test.ts` | 0.072 | 0.116 | 0.023 | 0.038 |
| `packages/world/src/roamers.test.ts` | 0.045 | 0.086 | 0.006 | 0.051 |
| `packages/world/src/sound.test.ts` | 0.039 | 0.113 | 0.008 | 0.022 |
| `packages/world/src/special-location.test.ts` | 0.049 | 0.058 | 0.021 | 0.011 |
| `packages/world/src/sprite-anim.test.ts` | 0.004 | 0.002 | 0.011 | 0.022 |
| `packages/world/src/tiles.test.ts` | 0.038 | 0.016 | 0.014 | 0.050 |
| `packages/world/src/trainers.test.ts` | 0.099 | 0.136 | 0.010 | 0.026 |
| `packages/world/src/weather.test.ts` | 0.031 | 0.076 | 0.030 | 0.029 |
| `packages/world/src/world.test.ts` | 0.265 | 0.398 | 0.045 | 0.026 |
| `tests/integration/audio.rom.test.ts` | 5.552 | 7.357 | 0.003 | 0.018 |
| `tests/integration/checkpoints-2-cp3.rom.test.ts` | — | 23.356 | — | 0.057 |
| `tests/integration/checkpoints-2-cp4.rom.test.ts` | — | 24.530 | — | 0.007 |
| `tests/integration/checkpoints-2.rom.test.ts` | 56.954 | 18.060 | 0.016 | 0.071 |
| `tests/integration/checkpoints-3-cp3.rom.test.ts` | — | 31.974 | — | 0.003 |
| `tests/integration/checkpoints-3-cp4.rom.test.ts` | — | 26.858 | — | 0.023 |
| `tests/integration/checkpoints-3.rom.test.ts` | 66.200 | 11.115 | 0.018 | 0.008 |
| `tests/integration/checkpoints-cp3.rom.test.ts` | — | 28.882 | — | 0.063 |
| `tests/integration/checkpoints-cp4.rom.test.ts` | — | 26.774 | — | 0.008 |
| `tests/integration/checkpoints-late-1-shift-15.rom.test.ts` | — | 26.753 | — | 0.060 |
| `tests/integration/checkpoints-late-1-shift-2.rom.test.ts` | — | 18.238 | — | 0.033 |
| `tests/integration/checkpoints-late-1-shift-5.rom.test.ts` | — | 26.690 | — | 0.025 |
| `tests/integration/checkpoints-late-1.rom.test.ts` | 50.162 | 26.870 | 0.004 | 0.057 |
| `tests/integration/checkpoints-late-2-shift-15.rom.test.ts` | — | 27.335 | — | 0.007 |
| `tests/integration/checkpoints-late-2-shift-2.rom.test.ts` | — | 17.036 | — | 0.073 |
| `tests/integration/checkpoints-late-2-shift-5.rom.test.ts` | — | 28.593 | — | 0.052 |
| `tests/integration/checkpoints-late-2.rom.test.ts` | 58.075 | 28.118 | 0.009 | 0.031 |
| `tests/integration/checkpoints-late-3-shift-15.rom.test.ts` | — | 18.996 | — | 0.013 |
| `tests/integration/checkpoints-late-3-shift-2.rom.test.ts` | — | 17.320 | — | 0.003 |
| `tests/integration/checkpoints-late-3-shift-5.rom.test.ts` | — | 21.232 | — | 0.013 |
| `tests/integration/checkpoints-late-3.rom.test.ts` | 70.784 | 14.443 | 0.066 | 0.043 |
| `tests/integration/checkpoints-m5a-1-end.rom.test.ts` | — | 30.940 | — | 0.024 |
| `tests/integration/checkpoints-m5a-1.rom.test.ts` | 74.397 | 48.491 | 0.024 | 0.030 |
| `tests/integration/checkpoints-m5a-2-end.rom.test.ts` | — | 30.701 | — | 0.050 |
| `tests/integration/checkpoints-m5a-2.rom.test.ts` | 63.555 | 53.175 | 0.029 | 0.013 |
| `tests/integration/checkpoints-m5a-3-end.rom.test.ts` | — | 18.938 | — | 0.009 |
| `tests/integration/checkpoints-m5a-3.rom.test.ts` | 63.833 | 50.882 | 0.022 | 0.010 |
| `tests/integration/checkpoints-m5a-anchor.rom.test.ts` | 113.069 | 71.141 | 0.009 | 3.686 |
| `tests/integration/checkpoints-m5a-branches-2.rom.test.ts` | — | 30.479 | — | 0.014 |
| `tests/integration/checkpoints-m5a-branches-3.rom.test.ts` | — | 21.023 | — | 0.056 |
| `tests/integration/checkpoints-m5a-branches.rom.test.ts` | 61.221 | 25.254 | 0.027 | 0.014 |
| `tests/integration/checkpoints-m5a-late-1-shift-15.rom.test.ts` | — | 37.438 | — | 0.013 |
| `tests/integration/checkpoints-m5a-late-1-shift-2.rom.test.ts` | — | 48.705 | — | 0.077 |
| `tests/integration/checkpoints-m5a-late-1-shift-5.rom.test.ts` | — | 56.676 | — | 0.074 |
| `tests/integration/checkpoints-m5a-late-1.rom.test.ts` | 187.517 | 46.105 | 0.031 | 0.030 |
| `tests/integration/checkpoints-m5a-late-2-shift-15.rom.test.ts` | — | 42.596 | — | 0.067 |
| `tests/integration/checkpoints-m5a-late-2-shift-2.rom.test.ts` | — | 40.195 | — | 0.217 |
| `tests/integration/checkpoints-m5a-late-2-shift-5.rom.test.ts` | — | 29.968 | — | 0.031 |
| `tests/integration/checkpoints-m5a-late-2.rom.test.ts` | 166.852 | 38.078 | 0.028 | 0.047 |
| `tests/integration/checkpoints-m5a-late-3-shift-15.rom.test.ts` | — | 50.297 | — | 0.029 |
| `tests/integration/checkpoints-m5a-late-3-shift-2.rom.test.ts` | — | 45.578 | — | 0.125 |
| `tests/integration/checkpoints-m5a-late-3-shift-5.rom.test.ts` | — | 37.685 | — | 0.056 |
| `tests/integration/checkpoints-m5a-late-3.rom.test.ts` | 182.325 | 35.434 | 0.061 | 0.067 |
| `tests/integration/checkpoints-m5b-1-end.rom.test.ts` | — | 47.239 | — | 0.079 |
| `tests/integration/checkpoints-m5b-1.rom.test.ts` | 71.167 | 23.072 | 0.017 | 0.007 |
| `tests/integration/checkpoints-m5b-2-end.rom.test.ts` | — | 36.463 | — | 0.021 |
| `tests/integration/checkpoints-m5b-2.rom.test.ts` | 69.668 | 37.626 | 0.017 | 0.064 |
| `tests/integration/checkpoints-m5b-3-end.rom.test.ts` | — | 49.061 | — | 0.273 |
| `tests/integration/checkpoints-m5b-3.rom.test.ts` | 81.617 | 47.029 | 0.021 | 0.028 |
| `tests/integration/checkpoints-m5b-anchor.rom.test.ts` | 184.911 | 151.880 | 0.044 | 3.768 |
| `tests/integration/checkpoints-m5b-branches-2.rom.test.ts` | — | 16.875 | — | 0.047 |
| `tests/integration/checkpoints-m5b-branches-3.rom.test.ts` | — | 17.001 | — | 0.023 |
| `tests/integration/checkpoints-m5b-branches.rom.test.ts` | 42.672 | 15.752 | 0.023 | 0.011 |
| `tests/integration/checkpoints-m5b-late-1-shift-15.rom.test.ts` | — | 34.342 | — | 0.030 |
| `tests/integration/checkpoints-m5b-late-1-shift-2.rom.test.ts` | — | 24.978 | — | 0.062 |
| `tests/integration/checkpoints-m5b-late-1-shift-5.rom.test.ts` | — | 34.486 | — | 0.028 |
| `tests/integration/checkpoints-m5b-late-1.rom.test.ts` | 143.853 | 44.195 | 4.058 | 0.550 |
| `tests/integration/checkpoints-m5b-late-2-shift-15.rom.test.ts` | — | 37.147 | — | 0.016 |
| `tests/integration/checkpoints-m5b-late-2-shift-2.rom.test.ts` | — | 35.973 | — | 0.119 |
| `tests/integration/checkpoints-m5b-late-2-shift-5.rom.test.ts` | — | 44.432 | — | 0.075 |
| `tests/integration/checkpoints-m5b-late-2.rom.test.ts` | 174.399 | 51.383 | 0.043 | 0.035 |
| `tests/integration/checkpoints-m5b-late-3-shift-15.rom.test.ts` | — | 32.386 | — | 0.028 |
| `tests/integration/checkpoints-m5b-late-3-shift-2.rom.test.ts` | — | 38.113 | — | 0.170 |
| `tests/integration/checkpoints-m5b-late-3-shift-5.rom.test.ts` | — | 56.320 | — | 0.158 |
| `tests/integration/checkpoints-m5b-late-3.rom.test.ts` | 151.202 | 29.475 | 0.069 | 0.126 |
| `tests/integration/checkpoints-m5c-1-end.rom.test.ts` | — | 27.308 | — | 0.185 |
| `tests/integration/checkpoints-m5c-1.rom.test.ts` | 64.173 | 28.469 | 0.055 | 3.723 |
| `tests/integration/checkpoints-m5c-2-end.rom.test.ts` | — | 23.714 | — | 0.062 |
| `tests/integration/checkpoints-m5c-2.rom.test.ts` | 70.968 | 44.860 | 0.231 | 3.924 |
| `tests/integration/checkpoints-m5c-3-end.rom.test.ts` | — | 26.859 | — | 0.169 |
| `tests/integration/checkpoints-m5c-3.rom.test.ts` | 77.212 | 33.700 | 0.356 | 3.943 |
| `tests/integration/checkpoints-m5c-anchor.rom.test.ts` | 236.889 | 223.072 | 4.105 | 3.761 |
| `tests/integration/checkpoints-m5c-branches-2.rom.test.ts` | — | 7.294 | — | 0.030 |
| `tests/integration/checkpoints-m5c-branches-3.rom.test.ts` | — | 6.821 | — | 0.063 |
| `tests/integration/checkpoints-m5c-branches.rom.test.ts` | 19.285 | 7.854 | 0.035 | 0.007 |
| `tests/integration/checkpoints-m5c-late-1-shift-15.rom.test.ts` | — | 33.206 | — | 0.299 |
| `tests/integration/checkpoints-m5c-late-1-shift-2.rom.test.ts` | — | 41.091 | — | 0.203 |
| `tests/integration/checkpoints-m5c-late-1-shift-5.rom.test.ts` | — | 43.629 | — | 0.294 |
| `tests/integration/checkpoints-m5c-late-1.rom.test.ts` | 166.601 | 30.989 | 4.324 | 0.180 |
| `tests/integration/checkpoints-m5c-late-2-shift-15.rom.test.ts` | — | 36.175 | — | 0.118 |
| `tests/integration/checkpoints-m5c-late-2-shift-2.rom.test.ts` | — | 36.425 | — | 0.232 |
| `tests/integration/checkpoints-m5c-late-2-shift-5.rom.test.ts` | — | 34.876 | — | 0.233 |
| `tests/integration/checkpoints-m5c-late-2.rom.test.ts` | 163.734 | 39.659 | 4.495 | 0.105 |
| `tests/integration/checkpoints-m5c-late-3-shift-15.rom.test.ts` | — | 40.573 | — | 0.131 |
| `tests/integration/checkpoints-m5c-late-3-shift-2.rom.test.ts` | — | 47.433 | — | 0.186 |
| `tests/integration/checkpoints-m5c-late-3-shift-5.rom.test.ts` | — | 28.672 | — | 0.257 |
| `tests/integration/checkpoints-m5c-late-3.rom.test.ts` | 158.994 | 35.267 | 4.620 | 0.101 |
| `tests/integration/checkpoints.rom.test.ts` | 56.574 | 14.197 | 0.006 | 0.046 |
| `tests/integration/dex.rom.test.ts` | 2.521 | 3.460 | 0.007 | 0.010 |
| `tests/integration/distortion-world.rom.test.ts` | 9.496 | 13.135 | 0.009 | 0.012 |
| `tests/integration/door-sweep.rom.test.ts` | 2.577 | 4.823 | 0.064 | 0.075 |
| `tests/integration/dw-giratina.rom.test.ts` | 12.430 | 9.335 | 0.048 | 0.007 |
| `tests/integration/dw-lower.rom.test.ts` | 28.383 | 25.222 | 0.019 | 0.028 |
| `tests/integration/dw-upper.rom.test.ts` | 29.493 | 46.430 | 0.007 | 0.196 |
| `tests/integration/edge-colors.rom.test.ts` | 0.519 | 0.558 | 0.099 | 0.104 |
| `tests/integration/eterna-border.rom.test.ts` | 0.955 | 1.646 | 0.007 | 0.037 |
| `tests/integration/field-events.rom.test.ts` | 3.574 | 2.922 | 0.003 | 0.019 |
| `tests/integration/field-systems.rom.test.ts` | 22.433 | 32.773 | 0.026 | 0.020 |
| `tests/integration/fixture-pack.test.ts` | 0.032 | 0.050 | 0.008 | 0.019 |
| `tests/integration/fixture-trainers.test.ts` | 0.090 | 0.097 | 0.014 | 0.005 |
| `tests/integration/follower-animation.test.ts` | 0.053 | 0.077 | 0.112 | 0.199 |
| `tests/integration/gate.rom.test.ts` | 2.573 | 4.235 | 0.007 | 0.007 |
| `tests/integration/hall-of-fame.rom.test.ts` | 8.951 | 8.148 | 0.010 | 0.032 |
| `tests/integration/hidden-items.rom.test.ts` | 1.230 | 1.372 | 0.009 | 0.020 |
| `tests/integration/m2-bag-party.rom.test.ts` | 9.016 | 7.134 | 0.018 | 0.033 |
| `tests/integration/m2-evolve.rom.test.ts` | 6.399 | 6.520 | 0.050 | 0.004 |
| `tests/integration/m2-wild.rom.test.ts` | 15.783 | 35.048 | 0.006 | 0.021 |
| `tests/integration/m2a-2.rom.test.ts` | — | 39.641 | — | 0.054 |
| `tests/integration/m2a-3.rom.test.ts` | — | 32.205 | — | 0.034 |
| `tests/integration/m2a.rom.test.ts` | 86.498 | 28.319 | 0.020 | 0.010 |
| `tests/integration/m5-doubles.rom.test.ts` | 5.957 | 9.598 | 0.023 | 0.003 |
| `tests/integration/m5-league.rom.test.ts` | 3.234 | 4.882 | 0.006 | 0.008 |
| `tests/integration/m5-ops.rom.test.ts` | 3.290 | 4.157 | 0.007 | 0.006 |
| `tests/integration/m5-spear-pillar.rom.test.ts` | 15.118 | 14.950 | 0.004 | 0.049 |
| `tests/integration/m5-static.rom.test.ts` | 10.353 | 11.752 | 0.006 | 0.054 |
| `tests/integration/m5-tag-jubilife.rom.test.ts` | 42.206 | 33.580 | 0.004 | 0.005 |
| `tests/integration/m5c-giratina.rom.test.ts` | 20.136 | 17.881 | 0.012 | 0.015 |
| `tests/integration/m5c-systems.rom.test.ts` | 34.346 | 41.706 | 0.028 | 0.018 |
| `tests/integration/maintenance.test.ts` | 7.806 | 7.991 | 0.088 | 0.014 |
| `tests/integration/map-popup.rom.test.ts` | 2.557 | 4.180 | 0.021 | 0.030 |
| `tests/integration/metadata-tools.test.ts` | 7.329 | 6.635 | 0.012 | 0.011 |
| `tests/integration/opening.rom.test.ts` | 12.490 | 16.054 | 0.220 | 0.585 |
| `tests/integration/platinum-demo.rom.test.ts` | 14.927 | 6.785 | 0.024 | 0.009 |
| `tests/integration/pokedex.rom.test.ts` | 0.671 | 1.885 | 0.003 | 0.010 |
| `tests/integration/poketch.rom.test.ts` | 4.237 | 6.085 | 0.007 | 0.031 |
| `tests/integration/recorder.test.ts` | 0.198 | 0.296 | 0.015 | 0.037 |
| `tests/integration/rowan-intro.rom.test.ts` | 1.142 | 1.477 | 0.005 | 0.008 |
| `tests/integration/services-m3a-2.rom.test.ts` | — | 9.832 | — | 0.088 |
| `tests/integration/services-m3a.rom.test.ts` | 36.297 | 52.497 | 0.036 | 0.095 |
| `tests/integration/services-m3b.rom.test.ts` | 12.761 | 18.802 | 0.015 | 0.041 |
| `tests/integration/services.rom.test.ts` | 18.122 | 32.482 | 0.048 | 0.164 |
| `tests/integration/ships.rom.test.ts` | 0.580 | 0.589 | 0.050 | 0.020 |
| `tests/integration/story-pack.rom.test.ts` | — | 1.616 | — | 0.013 |
| `tests/integration/sys-replays-2.rom.test.ts` | — | 33.837 | — | 0.103 |
| `tests/integration/sys-replays-3.rom.test.ts` | — | 33.953 | — | 0.071 |
| `tests/integration/sys-replays-4.rom.test.ts` | — | 18.320 | — | 0.042 |
| `tests/integration/sys-replays-5.rom.test.ts` | — | 29.682 | — | 0.012 |
| `tests/integration/sys-replays.rom.test.ts` | 127.990 | 60.644 | 0.065 | 0.027 |
| `tests/integration/terrain.rom.test.ts` | 2.723 | 5.126 | 0.039 | 0.356 |
| `tests/integration/time-of-day.rom.test.ts` | 1.792 | 2.701 | 0.011 | 0.025 |
| `tests/integration/world-w2.rom.test.ts` | 2.654 | 3.588 | 0.021 | 0.020 |
| `tests/integration/world.rom.test.ts` | 1.472 | 2.319 | 0.044 | 0.030 |
| `tests/integration/zone-sweep.rom.test.ts` | 6.553 | 10.758 | 0.013 | 0.047 |
| `tools/browser-runner.test.ts` | 0.536 | 1.021 | 0.028 | 0.019 |
| `tools/perf.test.ts` | 0.026 | 0.022 | 0.061 | 0.062 |
| `tools/source-key.test.ts` | 0.057 | 0.092 | 0.033 | 0.018 |

</details>

## Check file timings

These are the exact `pnpm check` test-step file durations; the suite totals above also include parallel lint/typecheck and launch costs. `—` after means the file previously contained only skipped ROM cases and is no longer collected by the no-ROM check.

<details>
<summary>Every check file, seconds</summary>

| File | Before execution | After execution | Before collection | After collection |
| --- | ---: | ---: | ---: | ---: |
| `packages/app/src/app.test.ts` | 0.024 | 0.011 | 0.153 | 0.033 |
| `packages/app/src/chunk.test.ts` | 0.033 | 0.003 | 0.045 | 0.007 |
| `packages/app/src/controls.test.ts` | 0.054 | 0.005 | 0.044 | 0.016 |
| `packages/app/src/debug/actions.test.ts` | 0.137 | 0.069 | 0.102 | 0.013 |
| `packages/app/src/debug/perf.test.ts` | 0.002 | 0.001 | 0.076 | 0.013 |
| `packages/app/src/flashing.test.ts` | 0.002 | 0.001 | 0.017 | 0.004 |
| `packages/app/src/json-bytes.test.ts` | 0.170 | 0.083 | 0.012 | 0.011 |
| `packages/app/src/layout.test.ts` | 0.001 | 0.000 | 0.021 | 0.007 |
| `packages/app/src/mods.test.ts` | 0.106 | 0.006 | 0.121 | 0.076 |
| `packages/app/src/new-game.test.ts` | 0.008 | 0.001 | 0.045 | 0.009 |
| `packages/app/src/phone.test.ts` | 0.026 | 0.005 | 0.015 | 0.008 |
| `packages/app/src/platform.test.ts` | 0.009 | 0.001 | 0.045 | 0.011 |
| `packages/app/src/recorder.test.ts` | 0.068 | 0.011 | 0.063 | 0.007 |
| `packages/app/src/save-errors.test.ts` | 0.049 | 0.008 | 0.033 | 0.012 |
| `packages/app/src/speed.test.ts` | 0.014 | 0.002 | 0.048 | 0.010 |
| `packages/app/src/starter/starter.test.ts` | 0.009 | 0.005 | 0.037 | 0.016 |
| `packages/app/src/store-upgrade.test.ts` | 0.017 | 0.002 | 0.141 | 0.021 |
| `packages/app/src/store.test.ts` | 0.038 | 0.007 | 0.120 | 0.021 |
| `packages/app/src/telemetry/telemetry.test.ts` | 0.077 | 0.033 | 0.056 | 0.029 |
| `packages/app/src/title/title.test.ts` | 0.002 | 0.001 | 0.095 | 0.011 |
| `packages/app/src/ui/announce.test.ts` | 0.014 | 0.002 | 0.062 | 0.011 |
| `packages/app/src/ui/settings.test.ts` | 0.048 | 0.006 | 0.248 | 0.058 |
| `packages/app/src/ui/ui.test.ts` | 0.011 | 0.002 | 0.123 | 0.024 |
| `packages/app/src/zoom.test.ts` | 0.014 | 0.001 | 0.027 | 0.006 |
| `packages/audio/src/audio.rom.test.ts` | 0.000 | — | 0.026 | — |
| `packages/audio/src/audio.test.ts` | 0.146 | 0.096 | 0.035 | 0.031 |
| `packages/battle/src/ai/ai.rom.test.ts` | 0.000 | — | 0.018 | — |
| `packages/battle/src/ai/ai.test.ts` | 0.036 | 0.012 | 0.018 | 0.010 |
| `packages/battle/src/ai/flags.rom.test.ts` | 0.000 | — | 0.041 | — |
| `packages/battle/src/anim/anim.rom.test.ts` | 0.000 | — | 0.018 | — |
| `packages/battle/src/anim/anim.test.ts` | 0.066 | 0.011 | 0.027 | 0.006 |
| `packages/battle/src/anim/objects.test.ts` | 0.031 | 0.010 | 0.008 | 0.008 |
| `packages/battle/src/bag.test.ts` | 0.282 | 0.403 | 0.020 | 0.545 |
| `packages/battle/src/battle.test.ts` | 0.178 | 0.125 | 0.024 | 0.012 |
| `packages/battle/src/controller/ai-doubles.rom.test.ts` | 0.000 | — | 0.023 | — |
| `packages/battle/src/controller/ai-target.test.ts` | 0.033 | 0.012 | 0.071 | 0.015 |
| `packages/battle/src/controller/ai-trace.rom.test.ts` | 0.000 | — | 0.024 | — |
| `packages/battle/src/controller/ai-view.test.ts` | 0.042 | 0.037 | 0.084 | 0.018 |
| `packages/battle/src/controller/doubles-card.test.ts` | 0.170 | 0.079 | 0.049 | 0.014 |
| `packages/battle/src/controller/doubles-topologies.test.ts` | 1.830 | 1.045 | 3.039 | 1.178 |
| `packages/battle/src/controller/doubles.rom.test.ts` | 0.000 | — | 0.021 | — |
| `packages/battle/src/controller/doubles.test.ts` | 0.603 | 0.460 | 0.327 | 0.164 |
| `packages/battle/src/controller/experience-parity.test.ts` | 1.100 | 0.444 | 2.105 | 0.023 |
| `packages/battle/src/controller/message-speed.test.ts` | 0.062 | 0.050 | 0.049 | 0.022 |
| `packages/battle/src/controller/protocol.rom.test.ts` | 0.000 | — | 0.026 | — |
| `packages/battle/src/controller/start-items.rom.test.ts` | 0.000 | — | 0.019 | — |
| `packages/battle/src/controller/trainer.test.ts` | 1.207 | 0.635 | 1.071 | 1.129 |
| `packages/battle/src/controller/weather-parity.test.ts` | 1.401 | 0.957 | 2.931 | 1.227 |
| `packages/battle/src/damage.test.ts` | 0.039 | 0.018 | 0.054 | 0.016 |
| `packages/battle/src/roamer.test.ts` | 0.049 | 0.027 | 0.026 | 0.016 |
| `packages/battle/src/sim/dex.rom.test.ts` | 0.000 | — | 0.013 | — |
| `packages/battle/src/sim/dex.test.ts` | 0.083 | 0.044 | 0.081 | 0.015 |
| `packages/battle/src/sim/doubles-rules.test.ts` | 0.063 | 0.054 | 0.031 | 0.010 |
| `packages/battle/src/sim/trainer-pair.proof.test.ts` | 1.102 | 0.600 | 0.968 | 0.775 |
| `packages/battle/src/sim/warm.test.ts` | 0.047 | 0.016 | 0.013 | 0.013 |
| `packages/cli/src/cli.test.ts` | 0.275 | 0.629 | 0.006 | 0.941 |
| `packages/cli/src/debug-checkpoints.test.ts` | 0.309 | 0.184 | 0.026 | 0.041 |
| `packages/cli/src/pack-replays.test.ts` | 0.612 | 0.459 | 1.684 | 1.356 |
| `packages/cli/src/plugin.test.ts` | 0.063 | 0.026 | 0.016 | 0.010 |
| `packages/cli/src/replays.test.ts` | 0.156 | 0.221 | 0.007 | 0.565 |
| `packages/contracts/src/text.test.ts` | 0.001 | 0.001 | 0.012 | 0.004 |
| `packages/core/src/clock.test.ts` | 0.008 | 0.001 | 0.024 | 0.004 |
| `packages/core/src/core.test.ts` | 0.079 | 0.012 | 0.014 | 0.014 |
| `packages/core/src/egg.test.ts` | 0.027 | 0.006 | 0.019 | 0.006 |
| `packages/core/src/evolution.test.ts` | 0.011 | 0.003 | 0.013 | 0.005 |
| `packages/core/src/field-systems.test.ts` | 0.008 | 0.001 | 0.017 | 0.007 |
| `packages/core/src/json-patch.test.ts` | 0.013 | 0.002 | 0.018 | 0.005 |
| `packages/core/src/pokemon.test.ts` | 0.042 | 0.006 | 0.026 | 0.006 |
| `packages/core/src/prng.test.ts` | 0.001 | 0.001 | 0.015 | 0.005 |
| `packages/g3d/src/bma.test.ts` | 0.003 | 0.002 | 0.026 | 0.006 |
| `packages/g3d/src/g3d.test.ts` | 0.052 | 0.017 | 0.153 | 0.057 |
| `packages/g3d/src/scene-formats.test.ts` | 0.009 | 0.002 | 0.068 | 0.005 |
| `packages/game/src/battle-music.test.ts` | 0.001 | 0.001 | 0.038 | 0.011 |
| `packages/game/src/clear-game.test.ts` | 0.045 | 0.007 | 0.035 | 0.004 |
| `packages/game/src/evolution.test.ts` | 0.047 | 0.034 | 0.014 | 0.017 |
| `packages/game/src/field-items.test.ts` | 0.110 | 0.090 | 0.018 | 0.011 |
| `packages/game/src/field-moves.test.ts` | 0.196 | 0.063 | 0.043 | 0.011 |
| `packages/game/src/field-return.test.ts` | 0.535 | 0.283 | 0.012 | 0.010 |
| `packages/game/src/field-sound.test.ts` | 0.458 | 0.217 | 0.358 | 0.040 |
| `packages/game/src/field-systems.test.ts` | 0.329 | 0.165 | 0.008 | 0.052 |
| `packages/game/src/game.test.ts` | 0.213 | 0.146 | 0.025 | 0.026 |
| `packages/game/src/map-popup.test.ts` | 0.014 | 0.002 | 0.037 | 0.004 |
| `packages/game/src/partner-heal.test.ts` | 0.063 | 0.041 | 0.023 | 0.006 |
| `packages/game/src/replay-runner.test.ts` | 0.386 | 0.267 | 0.016 | 0.020 |
| `packages/game/src/save-files.test.ts` | 0.115 | 0.047 | 0.026 | 0.005 |
| `packages/game/src/save.test.ts` | 0.465 | 0.413 | 0.023 | 0.085 |
| `packages/game/src/sound.test.ts` | 0.136 | 0.099 | 0.027 | 0.007 |
| `packages/game/src/storage.test.ts` | 0.023 | 0.005 | 0.131 | 0.004 |
| `packages/game/src/until-auto.test.ts` | 0.027 | 0.004 | 0.048 | 0.005 |
| `packages/game/src/until-wild.test.ts` | 0.002 | 0.001 | 0.026 | 0.007 |
| `packages/game/src/validators.test.ts` | 0.504 | 0.263 | 0.011 | 0.053 |
| `packages/importer/src/assets/assets.rom.test.ts` | 0.000 | — | 0.016 | — |
| `packages/importer/src/assets/object-gfx.test.ts` | 0.009 | 0.005 | 0.063 | 0.006 |
| `packages/importer/src/battle/spa.test.ts` | 0.012 | 0.003 | 0.045 | 0.026 |
| `packages/importer/src/choose-starter.rom.test.ts` | 0.000 | — | 0.023 | — |
| `packages/importer/src/distortion/distortion.rom.test.ts` | 0.000 | — | 0.015 | — |
| `packages/importer/src/distortion/distortion.test.ts` | 0.057 | 0.016 | 0.039 | 0.021 |
| `packages/importer/src/followers.rom.test.ts` | 0.000 | — | 0.017 | — |
| `packages/importer/src/followers.test.ts` | 0.012 | 0.001 | 0.032 | 0.011 |
| `packages/importer/src/formats.test.ts` | 0.054 | 0.018 | 0.056 | 0.024 |
| `packages/importer/src/gyms/gyms.test.ts` | 0.030 | 0.004 | 0.071 | 0.025 |
| `packages/importer/src/gyms/sunyshore.test.ts` | 0.003 | 0.001 | 0.039 | 0.005 |
| `packages/importer/src/hgss/followers.rom.test.ts` | 0.000 | — | 0.022 | — |
| `packages/importer/src/hgss/followers.test.ts` | 0.033 | 0.005 | 0.028 | 0.036 |
| `packages/importer/src/object-clones.test.ts` | 0.005 | 0.001 | 0.022 | 0.006 |
| `packages/importer/src/pokemon.rom.test.ts` | 0.000 | — | 0.012 | — |
| `packages/importer/src/rom.test.ts` | 0.010 | 0.004 | 0.256 | 0.084 |
| `packages/importer/src/title/title.rom.test.ts` | 0.000 | — | 0.017 | — |
| `packages/importer/src/ui2d/nitro2d.test.ts` | 0.011 | 0.005 | 0.010 | 0.006 |
| `packages/importer/src/ui2d/ui2d.rom.test.ts` | 0.000 | — | 0.030 | — |
| `packages/importer/src/ui2d/ui2d.test.ts` | 0.049 | 0.047 | 0.007 | 0.005 |
| `packages/menus/src/apps-m3a.test.ts` | 0.178 | 0.059 | 0.059 | 0.048 |
| `packages/menus/src/battle.test.ts` | 0.026 | 0.007 | 0.027 | 0.015 |
| `packages/menus/src/daycare.test.ts` | 0.010 | 0.006 | 0.019 | 0.019 |
| `packages/menus/src/evolution.test.ts` | 0.164 | 0.142 | 0.052 | 0.027 |
| `packages/menus/src/library-tv.test.ts` | 0.002 | 0.001 | 0.016 | 0.004 |
| `packages/menus/src/menus.test.ts` | 0.044 | 0.010 | 0.055 | 0.057 |
| `packages/menus/src/pokedex-scroll.test.ts` | 0.003 | 0.001 | 0.023 | 0.004 |
| `packages/menus/src/pokedex.test.ts` | 0.042 | 0.016 | 0.115 | 0.018 |
| `packages/menus/src/poketch.test.ts` | 0.081 | 0.052 | 0.041 | 0.070 |
| `packages/menus/src/rowan-intro.test.ts` | 0.040 | 0.017 | 0.019 | 0.011 |
| `packages/menus/src/sound.test.ts` | 0.026 | 0.007 | 0.117 | 0.004 |
| `packages/nds/src/blz.test.ts` | 0.282 | 0.269 | 0.013 | 0.053 |
| `packages/nds/src/hgss.rom.test.ts` | 0.000 | — | 0.011 | — |
| `packages/nds/src/lz.test.ts` | 0.005 | 0.001 | 0.007 | 0.005 |
| `packages/nds/src/nds.test.ts` | 0.001 | 0.001 | 0.013 | 0.004 |
| `packages/nds/src/rom.test.ts` | 0.000 | 0.000 | 0.012 | 0.004 |
| `packages/render/src/ceilings.test.ts` | 0.011 | 0.004 | 0.008 | 0.003 |
| `packages/render/src/flash.test.ts` | 0.023 | 0.005 | 0.040 | 0.033 |
| `packages/render/src/render.test.ts` | 0.029 | 0.018 | 0.134 | 0.057 |
| `packages/render/src/ships.test.ts` | 0.001 | 0.000 | 0.133 | 0.049 |
| `packages/services/src/card.test.ts` | 0.085 | 0.091 | 0.011 | 0.025 |
| `packages/text/src/rom.test.ts` | 0.000 | 0.000 | 0.010 | 0.004 |
| `packages/text/src/text.test.ts` | 0.086 | 0.022 | 0.019 | 0.007 |
| `packages/ui/src/tokens.test.ts` | 0.055 | 0.015 | 0.050 | 0.050 |
| `packages/vm/src/audio-ops.test.ts` | 0.020 | 0.006 | 0.052 | 0.031 |
| `packages/vm/src/classify.test.ts` | 0.122 | 0.068 | 0.010 | 0.005 |
| `packages/vm/src/daycare-ops.test.ts` | 0.031 | 0.003 | 0.045 | 0.010 |
| `packages/vm/src/decode/decode.test.ts` | 0.017 | 0.004 | 0.047 | 0.007 |
| `packages/vm/src/decode/rom.test.ts` | 0.000 | 0.000 | 0.048 | 0.009 |
| `packages/vm/src/field-system-ops.test.ts` | 0.102 | 0.049 | 0.015 | 0.020 |
| `packages/vm/src/gym-ops.test.ts` | 0.021 | 0.005 | 0.020 | 0.007 |
| `packages/vm/src/m1b-ops.test.ts` | 0.029 | 0.009 | 0.029 | 0.013 |
| `packages/vm/src/m2a-ops.test.ts` | 0.008 | 0.004 | 0.020 | 0.007 |
| `packages/vm/src/m3a-ops.test.ts` | 0.058 | 0.018 | 0.045 | 0.010 |
| `packages/vm/src/m5-ops.test.ts` | 0.032 | 0.007 | 0.035 | 0.010 |
| `packages/vm/src/ops.test.ts` | 0.074 | 0.028 | 0.184 | 0.015 |
| `packages/vm/src/party-ops.test.ts` | 0.018 | 0.005 | 0.023 | 0.009 |
| `packages/vm/src/runner.test.ts` | 0.077 | 0.019 | 0.050 | 0.010 |
| `packages/vm/src/spear-app.test.ts` | 0.000 | 0.000 | 0.017 | 0.003 |
| `packages/vm/src/static-ops.test.ts` | 0.008 | 0.006 | 0.043 | 0.018 |
| `packages/world/src/avatar.test.ts` | 0.113 | 0.130 | 0.013 | 0.017 |
| `packages/world/src/battle-weather.test.ts` | 0.031 | 0.003 | 0.026 | 0.004 |
| `packages/world/src/boat.test.ts` | 0.014 | 0.002 | 0.033 | 0.003 |
| `packages/world/src/camera.test.ts` | 0.006 | 0.007 | 0.033 | 0.004 |
| `packages/world/src/connections.test.ts` | 0.093 | 0.052 | 0.175 | 0.013 |
| `packages/world/src/containment.test.ts` | 0.001 | 0.001 | 0.025 | 0.004 |
| `packages/world/src/distortion/distortion.test.ts` | 0.127 | 0.095 | 0.012 | 0.022 |
| `packages/world/src/distortion/sky.test.ts` | 0.002 | 0.001 | 0.011 | 0.005 |
| `packages/world/src/distortion/support.test.ts` | 0.013 | 0.002 | 0.064 | 0.009 |
| `packages/world/src/encounters.test.ts` | 0.696 | 0.318 | 0.023 | 0.067 |
| `packages/world/src/fishing.test.ts` | 0.049 | 0.019 | 0.013 | 0.011 |
| `packages/world/src/gate.test.ts` | 0.048 | 0.011 | 0.011 | 0.005 |
| `packages/world/src/grass.test.ts` | 0.046 | 0.008 | 0.027 | 0.004 |
| `packages/world/src/gyms/canalave.test.ts` | 0.027 | 0.007 | 0.007 | 0.006 |
| `packages/world/src/gyms/gyms.test.ts` | 0.147 | 0.108 | 0.006 | 0.080 |
| `packages/world/src/gyms/pastoria.test.ts` | 0.036 | 0.020 | 0.010 | 0.007 |
| `packages/world/src/gyms/sunyshore.test.ts` | 0.014 | 0.002 | 0.014 | 0.004 |
| `packages/world/src/heal-machine.test.ts` | 0.008 | 0.001 | 0.014 | 0.004 |
| `packages/world/src/ice.test.ts` | 0.157 | 0.034 | 0.032 | 0.002 |
| `packages/world/src/mapchange.test.ts` | 0.000 | 0.000 | 0.011 | 0.005 |
| `packages/world/src/movement-types.test.ts` | 0.744 | 0.491 | 0.442 | 0.365 |
| `packages/world/src/npc-types.test.ts` | 0.593 | 0.387 | 0.173 | 0.055 |
| `packages/world/src/party-follower.test.ts` | 0.065 | 0.029 | 0.007 | 0.013 |
| `packages/world/src/roamers.test.ts` | 0.130 | 0.047 | 0.010 | 0.007 |
| `packages/world/src/sound.test.ts` | 0.080 | 0.057 | 0.033 | 0.021 |
| `packages/world/src/special-location.test.ts` | 0.055 | 0.027 | 0.009 | 0.026 |
| `packages/world/src/sprite-anim.test.ts` | 0.002 | 0.001 | 0.023 | 0.005 |
| `packages/world/src/tiles.test.ts` | 0.051 | 0.004 | 0.017 | 0.006 |
| `packages/world/src/trainers.test.ts` | 0.142 | 0.056 | 0.019 | 0.006 |
| `packages/world/src/weather.test.ts` | 0.053 | 0.023 | 0.017 | 0.012 |
| `packages/world/src/world.test.ts` | 0.294 | 0.143 | 0.034 | 0.014 |
| `tests/integration/audio.rom.test.ts` | 0.000 | — | 0.359 | — |
| `tests/integration/checkpoints-2.rom.test.ts` | 0.000 | — | 0.048 | — |
| `tests/integration/checkpoints-3.rom.test.ts` | 0.000 | — | 0.048 | — |
| `tests/integration/checkpoints-late-1.rom.test.ts` | 0.000 | — | 0.237 | — |
| `tests/integration/checkpoints-late-2.rom.test.ts` | 0.000 | — | 0.013 | — |
| `tests/integration/checkpoints-late-3.rom.test.ts` | 0.000 | — | 0.013 | — |
| `tests/integration/checkpoints-m5a-1.rom.test.ts` | 0.000 | — | 0.072 | — |
| `tests/integration/checkpoints-m5a-2.rom.test.ts` | 0.000 | — | 0.056 | — |
| `tests/integration/checkpoints-m5a-3.rom.test.ts` | 0.000 | — | 0.536 | — |
| `tests/integration/checkpoints-m5a-anchor.rom.test.ts` | 0.000 | — | 0.011 | — |
| `tests/integration/checkpoints-m5a-branches.rom.test.ts` | 0.000 | — | 0.026 | — |
| `tests/integration/checkpoints-m5a-late-1.rom.test.ts` | 0.000 | — | 0.032 | — |
| `tests/integration/checkpoints-m5a-late-2.rom.test.ts` | 0.000 | — | 0.021 | — |
| `tests/integration/checkpoints-m5a-late-3.rom.test.ts` | 0.000 | — | 0.031 | — |
| `tests/integration/checkpoints-m5b-1.rom.test.ts` | 0.000 | — | 0.065 | — |
| `tests/integration/checkpoints-m5b-2.rom.test.ts` | 0.000 | — | 0.032 | — |
| `tests/integration/checkpoints-m5b-3.rom.test.ts` | 0.000 | — | 0.042 | — |
| `tests/integration/checkpoints-m5b-anchor.rom.test.ts` | 0.000 | — | 0.003 | — |
| `tests/integration/checkpoints-m5b-branches.rom.test.ts` | 0.000 | — | 0.026 | — |
| `tests/integration/checkpoints-m5b-late-1.rom.test.ts` | 0.000 | — | 0.044 | — |
| `tests/integration/checkpoints-m5b-late-2.rom.test.ts` | 0.000 | — | 0.061 | — |
| `tests/integration/checkpoints-m5b-late-3.rom.test.ts` | 0.000 | — | 0.039 | — |
| `tests/integration/checkpoints-m5c-1.rom.test.ts` | 0.000 | — | 0.110 | — |
| `tests/integration/checkpoints-m5c-2.rom.test.ts` | 0.000 | — | 0.397 | — |
| `tests/integration/checkpoints-m5c-3.rom.test.ts` | 0.000 | — | 0.169 | — |
| `tests/integration/checkpoints-m5c-anchor.rom.test.ts` | 0.000 | — | 0.019 | — |
| `tests/integration/checkpoints-m5c-branches.rom.test.ts` | 0.000 | — | 0.027 | — |
| `tests/integration/checkpoints-m5c-late-1.rom.test.ts` | 0.000 | — | 0.115 | — |
| `tests/integration/checkpoints-m5c-late-2.rom.test.ts` | 0.000 | — | 0.095 | — |
| `tests/integration/checkpoints-m5c-late-3.rom.test.ts` | 0.000 | — | 0.108 | — |
| `tests/integration/checkpoints.rom.test.ts` | 0.000 | — | 0.013 | — |
| `tests/integration/dex.rom.test.ts` | 0.000 | — | 0.008 | — |
| `tests/integration/distortion-world.rom.test.ts` | 0.000 | — | 0.012 | — |
| `tests/integration/door-sweep.rom.test.ts` | 0.000 | — | 0.004 | — |
| `tests/integration/dw-giratina.rom.test.ts` | 0.000 | — | 0.029 | — |
| `tests/integration/dw-lower.rom.test.ts` | 0.000 | — | 0.029 | — |
| `tests/integration/dw-upper.rom.test.ts` | 0.000 | — | 0.015 | — |
| `tests/integration/edge-colors.rom.test.ts` | 0.000 | — | 0.012 | — |
| `tests/integration/eterna-border.rom.test.ts` | 0.000 | — | 0.011 | — |
| `tests/integration/field-events.rom.test.ts` | 0.000 | — | 0.019 | — |
| `tests/integration/field-systems.rom.test.ts` | 0.000 | — | 0.024 | — |
| `tests/integration/fixture-pack.test.ts` | 0.023 | 0.006 | 0.011 | 0.003 |
| `tests/integration/fixture-trainers.test.ts` | 0.211 | 0.075 | 0.217 | 0.036 |
| `tests/integration/follower-animation.test.ts` | 0.140 | 0.114 | 0.240 | 0.213 |
| `tests/integration/gate.rom.test.ts` | 0.000 | — | 0.009 | — |
| `tests/integration/hall-of-fame.rom.test.ts` | 0.000 | — | 0.012 | — |
| `tests/integration/hidden-items.rom.test.ts` | 0.000 | — | 0.022 | — |
| `tests/integration/m2-bag-party.rom.test.ts` | 0.000 | — | 0.025 | — |
| `tests/integration/m2-evolve.rom.test.ts` | 0.000 | — | 0.014 | — |
| `tests/integration/m2-wild.rom.test.ts` | 0.000 | — | 0.019 | — |
| `tests/integration/m2a.rom.test.ts` | 0.000 | — | 0.015 | — |
| `tests/integration/m5-doubles.rom.test.ts` | 0.000 | — | 0.014 | — |
| `tests/integration/m5-league.rom.test.ts` | 0.000 | — | 0.015 | — |
| `tests/integration/m5-ops.rom.test.ts` | 0.000 | — | 0.010 | — |
| `tests/integration/m5-spear-pillar.rom.test.ts` | 0.000 | — | 0.008 | — |
| `tests/integration/m5-static.rom.test.ts` | 0.000 | — | 0.042 | — |
| `tests/integration/m5-tag-jubilife.rom.test.ts` | 0.000 | — | 0.026 | — |
| `tests/integration/m5c-giratina.rom.test.ts` | 0.000 | — | 0.050 | — |
| `tests/integration/m5c-systems.rom.test.ts` | 0.000 | — | 0.063 | — |
| `tests/integration/maintenance.test.ts` | 2.752 | 1.444 | 0.117 | 0.066 |
| `tests/integration/map-popup.rom.test.ts` | 0.000 | — | 0.019 | — |
| `tests/integration/metadata-tools.test.ts` | 3.858 | 2.415 | 0.064 | 0.028 |
| `tests/integration/opening.rom.test.ts` | 0.000 | — | 0.120 | — |
| `tests/integration/platinum-demo.rom.test.ts` | 0.000 | — | 0.014 | — |
| `tests/integration/pokedex.rom.test.ts` | 0.000 | — | 0.028 | — |
| `tests/integration/poketch.rom.test.ts` | 0.000 | — | 0.025 | — |
| `tests/integration/recorder.test.ts` | 0.270 | 0.294 | 0.024 | 0.017 |
| `tests/integration/rowan-intro.rom.test.ts` | 0.000 | — | 0.011 | — |
| `tests/integration/services-m3a.rom.test.ts` | 0.000 | — | 0.014 | — |
| `tests/integration/services-m3b.rom.test.ts` | 0.000 | — | 0.013 | — |
| `tests/integration/services.rom.test.ts` | 0.000 | — | 0.030 | — |
| `tests/integration/ships.rom.test.ts` | 0.000 | — | 0.018 | — |
| `tests/integration/sys-replays.rom.test.ts` | 0.000 | — | 0.020 | — |
| `tests/integration/terrain.rom.test.ts` | 0.000 | — | 0.014 | — |
| `tests/integration/time-of-day.rom.test.ts` | 0.000 | — | 0.023 | — |
| `tests/integration/world-w2.rom.test.ts` | 0.000 | — | 0.014 | — |
| `tests/integration/world.rom.test.ts` | 0.000 | — | 0.018 | — |
| `tests/integration/zone-sweep.rom.test.ts` | 0.000 | — | 0.031 | — |
| `tools/browser-runner.test.ts` | 0.512 | 0.385 | 0.020 | 0.014 |
| `tools/perf.test.ts` | 0.023 | 0.006 | 0.027 | 0.016 |
| `tools/source-key.test.ts` | 0.077 | 0.056 | 0.076 | 0.019 |

</details>

## Reproduce

Use the same Node version, machine and CPU affinity, with the ROM present locally. Run the exact command once to prime caches, then measure a second run. Keep the load trace and external wall/CPU totals beside the reporter JSON. Do not compare a cold first run with a warm second run as an implementation speedup.

```sh
mkdir -p .opensinnoh-cache/timing/rom
OPENSINNOH_TIMING_DIR="$PWD/.opensinnoh-cache/timing/rom" \
  OPENSINNOH_NDS_ROM="$PWD/Pokemon - Platinum Version (USA).nds" \
  /usr/bin/time -v taskset -c 0-5 pnpm test

mkdir -p .opensinnoh-cache/timing/check
OPENSINNOH_TIMING_DIR="$PWD/.opensinnoh-cache/timing/check" \
  /usr/bin/time -v taskset -c 0-5 pnpm check
```

Sample `/proc/loadavg` or `os.getloadavg()` every second while each command runs. The opt-in reporter writes `vitest.json`: file execution/collection/setup/preparation durations and test results. Worker probes use `pnpm test --pool=forks --maxWorkers=5` (or `threads` / other worker counts). The measurement process reads actual completed exit codes; all totals above include launcher/global setup time.

Local raw reports and load traces live in ignored `.opensinnoh-cache/test-speed/`: `before-rom-warm-2`, `final-rom-tier-warm`, `before-check-warm`, `tier-check-warm-*`, `pool-*`, and `comparison.json`. ROM-derived data and full test logs remain untracked.
