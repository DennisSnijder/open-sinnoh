# Performance budgets

The target is the original's 30 Hz logic and a steady 60 fps display on a mid-range 2022 phone, inside fixed memory,
storage and download budgets. The numbers live in `tools/perf-budgets.json`. `pnpm perf` (`tools/perf.ts`, checks in
`tools/perf-check.ts`) measures them. Every number is an upper bound.

## Profiles

- **desktop:** 1280×720, DPR 1.
- **phone-4×:** 390×844, DPR 3, touch, CDP CPU throttling 4×. This approximates a Pixel 6a or Galaxy A53, which run
  browser JS about 4–5× slower than an M1 Max.
- **phone-6×:** the same with 6× throttling, the pessimistic case for a warm phone. It is informational, except its
  60 Hz frame row and the dropped-tick row.

All profiles use the real GPU, not the test suite's SwiftShader. The scenes are the bedroom, Route 201, Jubilife,
Hearthome, Eterna, Canalave, Distortion World B1F, a single battle, a doubles battle and the title.

## Budgets

| Budget | Number |
|---|---|
| Logic rate | 30 Hz with **0 dropped ticks** over a 10 s walk and a battle turn, every scene, phone-4× and phone-6× |
| Frame work (tick + render + UI per display frame, wall clock) | phone-4× **p95 ≤ 8 ms, p99 ≤ 12 ms**; phone-6× **p99 ≤ 16.7 ms**; desktop p99 ≤ 4 ms |
| Single tick | phone-4× p99 ≤ 4 ms, max ≤ 16 ms |
| Render resolution | Field, battle and title 3D at most **2 device px per CSS px** on coarse pointers (render scale Auto). Pixel art stays on whole device pixels. |
| JS heap | **≤ 150 MB** after a forced GC in any scene; **< 10 MB growth** over 20 zone round trips |
| Renderer memory (desktop Chromium, private footprint) | In game **≤ 450 MB**, import peak **≤ 600 MB** |
| GPU memory (estimate) | Live texture bytes ≤ 64 MB, geometry buffers ≤ 32 MB |
| Storage | Base pack in IndexedDB **≤ 130 MB**; a save ≤ 2 MB |
| Quota | The import refuses to start when `navigator.storage.estimate()` leaves **< 250 MB** free |
| JS bundle (gzip) | ROM page before a ROM is picked **≤ 300 kB**; game JS ≤ 1.1 MB; import worker ≤ 350 kB; the opt-in error-report chunk ≤ 40 kB, counted apart from the game |
| Load | Return visit to an interactive title **≤ 3 s** at phone-4×; CONTINUE to the first field frame ≤ 2 s at phone-4×; first visit to an interactive ROM page ≤ 4 s on Lighthouse's slow-4G profile (1.6 Mbps, 150 ms RTT) |
| Import | Desktop ≤ 25 s; a reference phone ≤ 60 s (manual) |

Renderer memory is the private footprint, not RSS: RSS counts shared mappings and freed pages the OS has not reclaimed.

## Running it

- `pnpm perf`: the ROM run on all three profiles. It needs `OPENSINNOH_NDS_ROM` and skips cleanly without it.
  `--profiles=` and `--scenes=` narrow it.
- `pnpm perf --bundle`: the built app's JS sizes. Run `pnpm build` first. It needs no ROM or browser.
- `pnpm perf --fixture`: heap growth over zone round trips on `packs/fixture`. It needs no ROM.

The ROM run writes `test-artifacts/perf/<section>.json`, prints each budget row and exits 1 on any miss, naming the
number and the budget. It is not part of `pnpm check`: frame numbers need a quiet machine and the real GPU.

**CI.** The `budgets` job in `.github/workflows/ci.yml` (manual trigger) runs `pnpm build && pnpm perf --bundle
--fixture`. It writes the numbers to the job summary and fails over budget. Frame-time rows are never judged on CI
runners (software GL, two cores).

**On a device.** Add `?perf` to any build for a small HUD with p50/p95 frame ms, dropped ticks and the heap where the
browser reports it. Players who allow error reports also send an anonymous performance summary per session: device
class, DPR, p95 frame, dropped ticks and import seconds. It carries no game state and is off when reports are off.

## What the desktop approximation misses

CPU throttling slows only the main thread, and the desktop GPU draws every frame. So these are not measured locally:
- the phone GPU filling a DPR 3 screen, the likely phone bottleneck;
- thermal throttling over a session;
- Safari and WebKit (JavaScriptCore, its IndexedDB, its memory limits);
- Android's slower storage;
- the import on a phone, since the import runs in a worker.

Timers have about 0.1 ms resolution without cross-origin isolation, so sub-0.1 ms ticks read as 0.

A real-device check covers these:
1. Pick the ROM and import it, timed.
2. Install as a PWA.
3. Play 20 minutes from Twinleaf to Jubilife, with a wild and a trainer battle.
4. Read p95 frame ≤ 16.7 ms and 0 dropped ticks from the HUD in Jubilife and in a battle.
5. Rotate mid-message, background the app and return.
6. Relaunch offline to CONTINUE.
7. Export and import a save.
8. Confirm the OS did not reload the tab during the session.

## Platform notes

- iOS Safari has no page Fullscreen API and no vibration API. There is no fullscreen button or haptics row there; the
  installed app is fullscreen. Wake Lock works in an installed iOS app (16.4+), and the setting shows only where the
  API exists.
- `beforeinstallprompt` exists only in Chromium. Safari installs from its Share menu.
- The service worker precaches the whole build at install. A new version waits and offers "Restart to update"; it never
  swaps mid-session. A stale dynamic chunk is retried once, then the crash screen offers a reload.
- The manifest's screenshots show the ROM page only, never ROM content. `tools/manifest-screenshots.ts` regenerates
  them.
