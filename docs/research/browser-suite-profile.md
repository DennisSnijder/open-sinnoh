# ROM browser suite profile — 2026-10-18–20

The measurements use the same Linux VM (10 QEMU vCPUs, 24 GB RAM), Node 24.18.1,
Playwright 1.64.0 and Chromium headless shell revision 1234, with the configured three
workers, all nine viewport projects, SwiftShader and both ROM environment variables.
Other test jobs ran in the main checkout during the baseline; load samples accompany
both measurements. No other browser or unit jobs launched by this task overlapped the
measured after run.

The full-command wall times include the build, shared ROM import, setup, tests and
teardown. Individual test times come from Playwright's JSON reporter. `beforeAll` and
`afterAll` run outside those test durations; the optional timing reporter records them
separately. Per-spec totals sum test durations and those recorded suite hooks across
projects. Browser-worker startup and cleanup are included only in the full-command wall
time. Parallel tests overlap, so per-spec totals are not the suite's elapsed time.
Shared import seeding is charged to the first file that uses it in each worker;
per-file figures therefore include scheduling effects and are not isolated benchmarks.

Dominant-work labels combine the replay timing logs with inspection of the test bodies.
The JSON reporter does not separately time simulation, renderer work or PNG encoding.
No estimated component percentages are presented as measurements.

The baseline completed on October 18. An initial after attempt stopped before final
reporting; its partial log has neither a complete JSON report nor an elapsed time and
is excluded. The measured after run restarted on October 20 on the same VM. Its
1,041-file test/runtime source fingerprint matched the interrupted attempt exactly.

## Measured baseline and validation

The unchanged baseline took **2:26:09** wall clock (Playwright: 8,768.974 s), with
526 passed, 18 failed and 193 skipped out of 737 scheduled cases. Of the skips,
112 were explicitly marked skipped; **81 were downstream serial skips** with an
expected status of passed. This is a failing baseline, not a green timing reference.

The baseline occupied 25,592.838 summed worker-seconds including recorded suite hooks
(97.3% of three workers × elapsed time). Menus and fit alone used about 7,278 worker-
seconds (121.3 worker-minutes), despite downstream skips. Parallel scheduling by itself
has little room to reduce elapsed time here; the changes also remove replay/import/render
work, and let later cases run after failures.

The VM exposes 10 QEMU vCPUs (cpuset 0–9), with 24,603,528 KiB RAM. Its sampled
one-minute load during the baseline had median **28.245**, minimum **15.42** and
maximum **50.09** (290 samples, every 30 seconds). Other Vitest jobs were observed in
the main checkout. These elapsed times are not directly comparable to the reported
37–56-minute runs on an unspecified load/machine; the after run used this same VM.
Both measurements start with the local ROM-test import/anchor cache cold. Browser
imports are fresh in either run. The baseline's shared ROM slice/full imports took
6.732/9.757 s; both are included in the full-command wall time.

The final `pnpm check` passed (6.3 s): lint, typecheck, 167 test files / 1,305 fixture tests,
and the fixture pack replays; ROM-dependent cases skipped in that check. The full
ROM `pnpm test` also passed: 261 files / 1,836 tests in 705.37 s with both ROM
environment variables set. Focused browser validation passed both checkpoint/first-battle speeds, standalone save,
pointer and audio cases, and occlusion poses at desktop and phone sizes. The focused system
selection had one 30-second Pastoria readiness timeout; its separate rerun and both final
texture-loop cases passed (3/3). The clock, snow-track and fog noise checks passed at
their original thresholds. All free/held samples remain, with BTA0 maxima 125/1,268
and BTP0 maxima 163/167 against held/tick-zero frames and zero frozen-state noise.
The anchor probe passed 105 unchanged assertions across CP2, CP3, CP4, naming,
Rock Smash and the Jubilife tag battle, with all six save round trips identical.
An injected loss of physical-keyboard naming input failed the original nickname
assertion, demonstrating that shortcutting its prefix does not hide that regression.

## Before/after results

Both runs used the same VM, three workers, nine projects and both ROMs. Full command: **2:26:09 → 2:12:08**, 9.6% less wall time (841.00 s saved).

| Result | Before | After |
| --- | ---: | ---: |
| Scheduled | 737 | 741 |
| Passed | 526 | 622 |
| Failed | 18 | 7 |
| Skipped | 193 | 112 |
| Executed / attempted | 544 | 629 |
| Downstream serial skips | 81 | 0 |

Matched passing test bodies: **520 cases**, 22,670.577 → 16,078.009 summed worker-seconds (29.1% less). Shared hooks are excluded from this matched subset. Full recorded worker time including shared hooks was 25,592.838 → 23,333.519 s.

The after run started at load1 **0.10** (baseline **8.45**). During the after run, load1: median **22.650**, range **3.05–27.13**, 264 samples.

The table includes test bodies and recorded `beforeAll`/`afterAll` hooks. Increases in fit, menus, first-battle, audio and speed include newly executed cases; fit alone restores 52 cases and menus restores 24. Shared hooks increased from 1,680.169 to 1,948.361 worker-seconds.

| Changed spec | Before worker s | After worker s | Change | Before executed | After executed |
| --- | ---: | ---: | ---: | ---: | ---: |
| `audio.rom.spec.ts` | 57.8 | 88.2 | +52.7% | 3 | 4 |
| `battle-anim.rom.spec.ts` | 1,192.2 | 744.6 | -37.5% | 22 | 22 |
| `battle-card.rom.spec.ts` | 148.2 | 68.8 | -53.6% | 2 | 2 |
| `battle-sheets.rom.spec.ts` | 521.1 | 360.9 | -30.7% | 8 | 8 |
| `dex.rom.spec.ts` | 492.2 | 244.5 | -50.3% | 4 | 4 |
| `evolve.rom.spec.ts` | 181.9 | 121.7 | -33.1% | 4 | 4 |
| `field-occlusion.rom.spec.ts` | 893.5 | 328.9 | -63.2% | 18 | 18 |
| `first-battle.rom.spec.ts` | 311.5 | 480.7 | +54.3% | 3 | 5 |
| `fit.rom.spec.ts` | 3,407.0 | 5,707.8 | +67.5% | 74 | 126 |
| `gyms-m5b.rom.spec.ts` | 746.5 | 385.9 | -48.3% | 10 | 10 |
| `m5-tag-jubilife.rom.spec.ts` | 50.1 | 40.1 | -20.1% | 1 | 1 |
| `m5c-systems.rom.spec.ts` | 395.7 | 184.4 | -53.4% | 8 | 8 |
| `menus.rom.spec.ts` | 3,870.7 | 4,003.0 | +3.4% | 75 | 99 |
| `options.rom.spec.ts` | 1,051.7 | 678.6 | -35.5% | 15 | 15 |
| `platinum.rom.spec.ts` | 2,026.9 | 1,923.8 | -5.1% | 21 | 25 |
| `poketch.rom.spec.ts` | 336.7 | 227.4 | -32.5% | 2 | 2 |
| `speed.rom.spec.ts` | 82.5 | 108.8 | +31.9% | 1 | 2 |
| `sys.rom.spec.ts` | 1,567.5 | 1,507.1 | -3.9% | 35 | 36 |
| `ui.rom.spec.ts` | 78.0 | 57.7 | -25.9% | 2 | 2 |
| `zone-seam.rom.spec.ts` | 199.9 | 157.5 | -21.2% | 4 | 4 |

These are observed reductions, with different shared-machine contention. The 520-case comparison includes unchanged specs as well as changed ones; it does not isolate the effect of the code changes. No claim is made that the full 9.6% is caused by this patch.

The after Playwright report spans 7,927.222 s. Its cold slice/full imports took 7.505/10.527 s. The local ROM-test cache was cleared for both runs; the OS page cache was not flushed. The 1,041-file test/runtime fingerprint matched before and after the complete run (`6475d11af9c531aa92adb0e09f4ad59c7870ececd9a1474a2534474046058c0e`).

### Full-run failures

| Project | Spec / test | Before status | After error |
| --- | --- | --- | --- |
| phone | `announcements.spec.ts`: a message page is announced once, whole, when it has finished typing | passed | extra partial announcement “Morn” |
| mid | `menus.rom.spec.ts`: svc-bag-bicycle: the menus in the app, ROM art at each beat | passed | page.waitForFunction: 30-second readiness timeout |
| big | `menus.rom.spec.ts`: svc-bag-bicycle: the menus in the app, ROM art at each beat | skipped | page.waitForFunction: 30-second readiness timeout |
| tablet | `menus.rom.spec.ts`: svc-bag-bicycle: the menus in the app, ROM art at each beat | passed | page.waitForFunction: 30-second readiness timeout |
| tablet-landscape | `menus.rom.spec.ts`: svc-bag-bicycle: the menus in the app, ROM art at each beat | skipped | page.waitForFunction: 30-second readiness timeout |
| desktop | `sys.rom.spec.ts`: sys-waterfall.replay in the app, with a visible scene at each screenshot line | passed | page.waitForFunction: 30-second readiness timeout |
| desktop | `sys.rom.spec.ts`: prop loop, BTA0 scroll: the Route 210 North waterfall: the frames differ across ticks beyond the frozen noise | timedOut | 180-second test deadline |

The browser gate remains red. Only BTA0 failed in both runs. Four after failures had passed before; two bicycle cases had been skipped by an earlier serial failure. The errors are retained, with no longer deadlines, relaxed assertions or retries in the measured run. The baseline also had bicycle readiness failures on phone and landscape; those passed after. These observations do not establish a common cause for every readiness timeout.

Targeted follow-ups are diagnostics, excluded from every timing comparison above. Waterfall and BTA0 both passed (2/2), retaining the BTA0 125/1,268 maxima and zero noise; announcements passed (1/1). The four-project bicycle selection still failed on mid, big and portrait tablet, while landscape tablet passed. Running that same selection from a clean checkout of baseline commit `9b6fa1e` reproduced those same three failures with the original spec and fixed sleep. Those three persistent failures reproduce without the patch; the full-run landscape-tablet timeout did not reproduce in either targeted run. The full-suite seven failures remain reported rather than replaced by rerun results.

## What changed, and what is still proved

`rom-context.ts` seeds the imported database once per worker browser and project context
options, reusing it across the graphics/replay specs. Each file or independent case opens
its own page and resets device preferences and the separate save database; no earlier
test's game state is required.
The worker browser owns cached contexts and closes them on shutdown. Callers close their
pages. Actual import, autoplay, first-battle and cold battle-art checks keep dedicated
contexts. Seeding is timed inside the normal test/setup hooks, not moved outside the run.

- `platinum.rom.spec.ts`: one seeded database per worker, with independent pages, device
  defaults and games (the picker gets an empty context); later render,
  battle and save tests load their own opening save. CP2–4 become three independent tests
  from their predecessors' anchors, retaining every replay assertion and screenshot beat,
  the CP3 Pokétch check and CP4 Coal Badge check, and adding each checkpoint's save round
  trip. The continuous chain still runs in `checkpoints*.rom.test.ts`. The opening's three
  sprite-depth regressions all run; subsequent lines stop fetching views for finished checks.
- `menus.rom.spec.ts`, `fit.rom.spec.ts`, `sys.rom.spec.ts`: independent replay runs can
  use all workers. Naming starts at the opening anchor and Rock Smash at CP4, keeping
  every main-replay assertion and visual beat. The system import moves to worker setup,
  so no other test depends on the success of the import test. System pixel reads wait for
  a completed render after asset readiness instead of three render frames per read.
  Every captured tick, free/held pair, noise measurement and threshold stays unchanged;
  the same 30-second asset-readiness bound remains. Texture-loop tick/hold changes run
  in the same browser call as their pixel capture (two calls per pair instead of five),
  retaining every free/held sample and restoring the hold after the final pair.
- `replay-anchor.ts`: restores the prefix's actual battle history and replay policies
  alongside its save, so cumulative battle assertions and evolution/wild-battle behavior
  are preserved. Cold history construction verifies that its complete prefix ended in
  exactly the cached anchor's state. History is cached under the same ROM/importer/engine/
  replay key, in the ignored ROM-test cache. `m5-tag-jubilife.rom.spec.ts` now uses this
  cached start too, and also runs the cumulative assertions that it previously skipped.
- `battle-card.rom.spec.ts` and `zone-seam.rom.spec.ts`: later tests prepare their own
  battle or field instead of consuming an earlier test's state. `battle-anim`,
  `battle-sheets`, `gyms-m5b` and `m5c-systems` can run their already independent cases
  in parallel. Tick-condition loops that observed no drawn frames run inside the page;
  all frame-by-frame and pixel checks retain their original samples and thresholds.
- `field-occlusion.rom.spec.ts`: one imported database per worker, a fresh page per pose.
  The complete screenshot/pixel comparison code and thresholds are unchanged.
- `first-battle.rom.spec.ts`: the pre-briefcase save is prepared headless. CONTINUE,
  starter selection, Barry's approach and the first battle still use the real app loop
  at 1× and 3×. Held/released keys wait for sampled ticks; progress waits for ticks or
  the crash screen. The missing-art watchdog still must show its five-second error.
- `audio.rom.spec.ts`: each case resets its own game, so a worklet-test failure cannot
  skip the native-cue assertions. Waits for the worklet to report active channels after
  audible output; all RMS, handle, channel, mute and exact command/tick assertions stay.
- `speed.rom.spec.ts`: independent starts, one Enter per title transition followed by
  the actual menu condition, and no phone setup for its already-skipped phone cases.
  The four-second audio observation, eight-second walks and zero-underrun assertion stay.
- Menu/sheet/title screenshot sleeps use animation or readiness conditions. Sustained
  performance/audio windows and absence-observation windows are retained.
- `dex`, `poketch`, `evolve`, `ui` and `options` replace the remaining screenshot
  sleeps with the existing entering-animation/render condition. The Pokédex's known
  habitat map additionally waits for the same required pixel difference from its unknown
  map. Its entire beat list and all pixel thresholds remain. The PWA's two-second
  offline-request observation and the speed spec's measurement windows remain.

No test coverage is deleted. The combined CP2–4 case is split into three cases per
viewport. Replayed opening prefixes remain covered by the opening browser test and the
headless checkpoint tests. M5a/b/c already use their nearest preceding checkpoint
anchors and retain all their assertions and beats. Real imports remain in tests whose
purpose is the picker/import, incomplete-import repair or HGSS add-on import; other
starts use `seedRomImport(page)`. No game, importer or shared CLI behavior changes.

## Integration with main — 2026-10-21

This branch was subsequently merged with main at `63f7ed26`. The measurements above
compare `9b6fa1e` with `44fe17bc`, before that integration; they are not measurements
of the merged engine or its expanded browser suite. The integrated tests use main's
`@opensinnoh/*` packages, `OPENSINNOH_*` environment variables and `openSinnoh*`
browser globals. Stored save/database keys remain unchanged. The browser-start decision
now lives under Testing in `docs/decisions.md`.

Conflict resolution keeps main's newer naming-grid assertions and its one-call texture
free/held sampling loop. The general system counterfactual capture still waits for asset
readiness and a later completed draw. All replay assertions and sampled tick pairs remain.
The original two-call texture-loop implementation described above was superseded by
main's batching; the earlier timing table remains a record of the measured commit.

The landing-page Vercel project uses `site/` as its root. That directory was added on
main after the benchmark baseline and was absent from the original PR head. Merging
main brings in the existing site, workspace/build configuration and deployment settings.
Both `pnpm site:build` and `pnpm build` pass, and the landing-page browser spec passes
all seven desktop cases. `pnpm check` passes with 1,589 active fixture tests.
The full ROM test run on the integrated tree passes all 2,823 tests across 417 files
(617.46 s). The shared-context reset uses main's `/__opensinnoh/packs.json` static
endpoint; persisted save/database names are unchanged.

The focused merged-browser selection (three workers) finished with 22 passed,
7 failed and 7 explicit skips: six 30-second scene-readiness timeouts and one missing
phone save-import notice. All seven failed cases passed in a separate one-worker run
with two passing controls (9 passed, 1 explicit skip). Assertions and deadlines were
unchanged. These are integration diagnostics, not a new full-suite benchmark or a
claim that the expanded browser merge gate is green.

## Reproduction

The baseline used clean commit `9b6fa1e`; the measured after run used `44fe17bc`.
Run the commands below at those revisions. Current revisions use `OPENSINNOH_*`
instead of `LANTERN_*`, and `.opensinnoh-cache` instead of `.lantern-cache`. Set
`LANTERN_NDS_ROM` and `LANTERN_HGSS_ROM` to the two local ROM files. The default
Playwright configuration already enables its JSON reporter.

```sh
rm -rf -- .lantern-cache/tests
mkdir -p test-artifacts/profile/before
LANTERN_TIMING_DIR="$PWD/test-artifacts/profile/before" \
  /usr/bin/time -v -o test-artifacts/profile/before/time.txt \
  pnpm test:browser > test-artifacts/profile/before/run.log 2>&1
cp test-artifacts/playwright.json test-artifacts/profile/before/playwright.json
```

Repeat into `after` following the changes, with the same cache policy. Preserve the JSON
report before starting another browser command. To regenerate the timing tables:

```sh
pnpm exec tsx tools/browser-profile.ts \
  test-artifacts/profile/before/playwright.json \
  test-artifacts/profile/after/playwright.json
```

Raw reports are preserved under `test-artifacts/profile/{before,after}/`: `playwright.json`,
`browser.json`, `time.txt`, `run.log`, `load.jsonl` and `load-summary.json`.
Logs, saves, imports and screenshots stay in ignored directories.

## Baseline: 30 slowest tests

Times are Playwright test durations in seconds; shared suite hooks are separate. Dominant work
is an audit of replay logs and test bodies, not a measured component-time breakdown.

| Rank | Project | Spec / test | Seconds | Dominant work |
| ---: | --- | --- | ---: | --- |
| 1 | phone | `platinum.rom.spec.ts`: the opening replay in the app, new game → Lake Verity, with a visible scene at every beat | 432.0 | Replay ticks plus screenshots and sprite-depth pixel comparisons throughout the opening (phone rendering). |
| 2 | desktop | `platinum.rom.spec.ts`: checkpoints 2–4 in the app: one run from the opening through the Coal Badge, beats at the story asserts, the Pokétch after CP3 | 273.3 | 172,589 replay ticks plus desktop screenshots at story assertion groups; the full dependent chain. |
| 3 | desktop | `platinum.rom.spec.ts`: the opening replay in the app, new game → Lake Verity, with a visible scene at every beat | 231.1 | Replay ticks plus opening screenshots and sprite-depth pixel comparisons. |
| 4 | phone | `platinum.rom.spec.ts`: M2 step 0: a real wild battle on Route 201 (m2-wild-201), drawn from the ROM, the command card picks Fight → move 1 | 217.9 | Battle screenshots and repeated counterfactual pixel captures, including multiple viewport sizes; replay ticks. |
| 5 | desktop | `dex.rom.spec.ts`: svc-dex: the list, entries, area map, height check and search drawn with ROM art | 207.3 | Pokédex UI/art readiness, screenshots and pixel reads throughout the replay. |
| 6 | tablet | `fit.rom.spec.ts`: svc-dex: every app fits, centred, nothing cut | 193.2 | Menu/layout readiness and screenshots at every Pokédex replay beat. |
| 7 | phone | `dex.rom.spec.ts`: svc-dex: the list, entries, area map, height check and search drawn with ROM art | 181.6 | Pokédex UI/art readiness, screenshots and pixel reads throughout the replay. |
| 8 | desktop | `sys.rom.spec.ts`: prop loop, BTA0 scroll: the Route 210 North waterfall: the frames differ across ticks beyond the frozen noise | 180.0 (timeout) | Repeated field renders/readbacks at every free/held animation tick; hit the 180-second deadline. |
| 9 | phone | `services.rom.spec.ts`: svc-dept-store(-2f, -3f, -b1f): the Veilstone Department Store floors with ROM frames and item icons; the money window | 162.3 | Four store-floor replays, DOM/art readiness and screenshot checks. |
| 10 | tablet | `menus.rom.spec.ts`: svc-pc-compare: the menus in the app, ROM art at each beat | 151.8 | PC comparison art/readiness checks, screenshots and pixel reads. |
| 11 | desktop | `story-m5c.rom.spec.ts`: M5c in the app: cp15.replay from the cp14.replay anchor, beats distortion-world | 151.7 | CP15 replay ticks and Distortion World screenshots; already starts at the CP14 anchor. |
| 12 | desktop | `edges.rom.spec.ts`: Twinleaf outlines are the DS dark grey blended over the far side, at day, twilight and night | 150.8 | Full-resolution rendered-frame/PNG comparisons at three times of day. |
| 13 | phone | `poketch.rom.spec.ts`: svc-poketch: the device and its apps drawn from the ROM, driven like the DS bottom screen | 150.6 | Pokétch app readiness, screenshots and replay inputs across its apps. |
| 14 | desktop | `battle-doubles.rom.spec.ts`: the twins (type 3): four battlers and boxes at every size, the target screen, CANCEL | 146.7 | Doubles battle pixel comparisons and screenshots/layout checks across viewport sizes. |
| 15 | desktop | `battle-anim.rom.spec.ts`: MOVE_WATER_GUN: the ROM animation plays, its particles drawn at the defender | 146.6 | Per-tick animation renders and particle pixel counterfactuals; unobserved pre-animation polling. |
| 16 | desktop | `library-tv.rom.spec.ts`: the Canalave Library TV is one whole-pixel screen in the explosion scene | 145.2 | Cold import and CP10 anchor setup (the logged anchor build alone was 83.0 s), then TV scene/pixel checks. |
| 17 | phone | `edges.rom.spec.ts`: Twinleaf outlines are the DS dark grey blended over the far side, at day, twilight and night | 130.2 | Full-resolution rendered-frame/PNG comparisons at three times of day. |
| 18 | desktop | `poketch.rom.spec.ts`: svc-poketch: the device and its apps drawn from the ROM, driven like the DS bottom screen | 123.4 | Pokétch app readiness, screenshots and replay inputs across its apps. |
| 19 | desktop | `battle-card.rom.spec.ts`: the card fits every viewport: commands, moves, forget-a-move, YES/NO | 121.3 | Battle-card screenshots and geometry/art checks across eight viewport/DPR combinations. |
| 20 | mid | `menus.rom.spec.ts`: svc-card: the menus in the app, ROM art at each beat | 119.0 | Trainer-card art readiness, page screenshots and pixel checks. |
| 21 | tablet | `menus.rom.spec.ts`: svc-party: the menus in the app, ROM art at each beat | 117.0 | Party/summary art readiness, screenshots and pixel checks. |
| 22 | desktop | `story-m5c.rom.spec.ts`: M5c in the app: cp16.replay from the cp15.replay anchor, beats sunyshore-volkner | 115.4 | CP16 replay ticks and story screenshots; already starts at the CP15 anchor. |
| 23 | landscape | `fit.rom.spec.ts`: svc-dex: every app fits, centred, nothing cut | 113.0 | Menu/layout readiness and screenshots at every Pokédex replay beat. |
| 24 | mid | `menus.rom.spec.ts`: svc-pc-compare: the menus in the app, ROM art at each beat | 111.4 | PC comparison art/readiness checks, screenshots and pixel reads. |
| 25 | desktop | `gyms-m5b.rom.spec.ts`: the boat: the ship sails from Canalave, the bridges open, and the trip ends on Iron Island | 110.1 | Headless prepared save, ROM seeding, ship replay ticks and visual checks of ship/bridge transitions. |
| 26 | desktop | `battle-details.rom.spec.ts`: START HP mode, target icons and unobscured doubles boxes | 109.3 | Prepared doubles battle, target/HP icon art readiness, pixel and layout checks. |
| 27 | desktop | `hall-of-fame.rom.spec.ts`: the induction, the credits and the OpenSinnoh card on one screen, then CONTINUE upstairs | 107.4 | ROM seeding, induction/credits replay ticks and scene screenshots; credits progression is asserted. |
| 28 | phone | `story-m5c.rom.spec.ts`: M5c in the app: cp15.replay from the cp14.replay anchor, beats distortion-world | 105.0 | CP15 replay ticks and Distortion World screenshots; already starts at the CP14 anchor. |
| 29 | phone | `story-m5a.rom.spec.ts`: M5a in the app: cp6.replay from the cp5.replay anchor, beats eterna-forest-double, eterna-clock | 104.2 | CP6 replay ticks and forest/clock screenshots; already starts at the CP5 anchor. |
| 30 | desktop | `sys.rom.spec.ts`: sys-gym-pastoria.replay in the app, with a visible scene at each screenshot line | 103.0 | Gym replay ticks, screenshot beats and water-level pixel counterfactuals. |
