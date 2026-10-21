# M5 visual audit — 2026-10-18

Base: `2331c4b`. This is an **incomplete comparative audit**, not an emulator parity sign-off.
A local US Platinum ROM was used; no emulator save or save states were available.
melonDS 1.1 (official macOS build, temporary local installation) successfully booted the same
ROM into the new-game introduction using its built-in firmware. No matching M5 emulator run was
completed: no late-game cartridge save/checkpoint was available. App observations, source-confirmed differences and
unverified comparisons are distinguished below. No ROM, imported assets, saves or screenshots belong
in this document. Local captures stay under ignored `test-artifacts/visual-audit-m5/`.

Reference source: pret/pokeplatinum `fe1ea418a7364c93daf0d07ae55e195452d8803c`, consulted for behaviour,
constants and resource names only. No reference implementation or art copied.
Additional visual reference, a gameplay video: Jordan Parker,
[How To Get Through The Distortion World](https://www.youtube.com/watch?v=LHNq8dEEYM4)
(2024-08-02). Viewed in the browser, not downloaded. Samples include the entry platform (0:06),
platforms/trees (0:24–0:29), tree occlusion (1:23), the pond approach (1:37), and the sideways waterfall
ride (1:42). This edited, scaled video establishes composition and visible features; its ROM revision,
colour processing and elapsed game frames are unknown. It cannot establish exact colours or UI timing.

Intentional adaptations from the first audit still apply: one composed screen, a wider field view,
whole device-pixel UI scaling, the battle command card, and accessibility options. They are not defects.

## Ranked defects

Ranking combines visibility and scope; “source-confirmed” does not mean measured against an emulator.

1. **P1 — Distortion World distant geometry receives almost no fog. Fixed.**
   `packages/render/src/distortion/index.ts` used fog slope 1. The reference `InitFog`
   (`src/overlay009/ov9_02249960.c:3287`) selects `GX_FOGSLOPE_0x0200`, shift **6**: the whole table spans
   0x200 depth units, with 16 units between entries. The old code treated 0x200 as the distance between
   entries. At depth 0x7700 our density was 1 instead of 32; at 0x77F0 it was 1.9375 instead of 62.
   Both colour darkening and transparency into the sky were too weak, reducing depth separation from
   near platforms. The offset, integer density increment, black colour and alpha 16 were already correct.
   Fixed the slope and its misleading comment. No importer/contract/save changes.
   Regression: `packages/render/src/distortion/fog.test.ts` fails before the fix (1 versus 32), passes
   afterward; `tests/browser/distortion-fog.rom.spec.ts` compares our own canvas at one frozen scene
   against the old slope, restoring the configuration afterward. No image golden.
   In the frozen desktop B1F sample, **8.75%** of canvas pixels darkened by more than 12 summed RGB
   levels; **91.04%** stayed within three levels. This measures the fix's visible reach, not ROM parity.

2. **P1 — Elite Four/Champion encounters use the ordinary battle transition. Open; source-confirmed.**
   Aaron, Bertha, Flint, Lucian and Cynthia all enter through `BattleController.intro`'s common flash
   and slice. Their room-specific background/terrain is a separate mechanism and does not supply the
   special encounter choreography. Reference:
   `src/overlay005/encounter_effect.c` dispatches distinct handlers;
   `src/overlay005/encounter_effect_core.c:3213` (`EncounterEffect_EliteFourChampion`) and the five
   wrappers at 3595 onward. Faithful work needs the encounter resources and timelines, not simply a
   different flash duration. Do not change message pacing to disguise the missing transition.

3. **P1 — Distortion World warp application is missing its 3D scene. Open; existing limitation.**
   The Spear Pillar → Distortion World and return transitions progress, but the dedicated warp scene
   remains a presentation stub. Reference: `src/dw_warp/dw_warp.c` (see `distortion-world.md`, warp section).
   This requires imported scene assets plus its camera/animation timeline. The reference video cuts
   through progression and is not sufficient to time this application. Recheck against a same-ROM
   emulator before declaring the transition matched.

4. **P2 — Canalave Gym does not apply its special clipping planes. Open; source-confirmed.**
   `CanalaveGym_DynamicMapFeaturesInit` in `src/overlay008/gym_features.c:1544` sets near/far to
   **100/1700** (line 1595). Our gym supplies its fog and floor/platform visibility, but the renderer
   continues using the zone camera's clipping planes. Clipping affects the depth values used by fog as
   well as visibility; correcting only fog density cannot reproduce this setup. A feature-owned camera
   override needs a contract decision, and upper/lower lift views need numeric regressions. Do not
   change the shared camera preset for unrelated maps.

5. **P2 — Distortion World surf mount does not follow the cascade orbit. Open; observed and source-confirmed.**
   The reference video at **1:42** shows the player and mount travelling sideways together on the
   waterfall. Our cascade controller implements the traversal and avatar rotation, but the mount's
   special displacement/orbit remains unimplemented (see `distortion-world.md` and STATUS).
   Reference: overlay 9 cascade tasks and `CASCADE_*_MOUNT_POSITION_FIX_*` constants in
   `src/overlay009/ov9_02249960.c`. The B4F replay-derived capture at tile 104,76 shows the upside-down
   ceiling and descending avatar. At 16 and 56 ticks after pushing right, the avatar turns while the
   dark mount stays a flat shape to its left; the native clip shows the paired pose on the waterfall.
   The static mount does not reproduce the reference's authored orbit/3-axis turn. The video uses a
   different protagonist and is not synchronized to these exact ticks; a global sprite-roll sign
   change is not justified from those frames. The upward return ride remains unmeasured.

6. **P2 — Giratina's field arrival lacks its palette brightening. Open; source-confirmed.**
   `packages/world/src/distortion/events.ts` times the arrival/sky darkening, but explicitly leaves the
   sprite tint undrawn. Reference: overlay 9 Giratina arrival event; see `distortion-world.md`.
   This is the **field** arrival, distinct from the battle's implemented shaded vertical entrance.
   Needs a presentation seam for the sprite tint and a pixel-count test at successive arrival stages.

7. **P2 — Snowpoint snow uses substitute particles. Open; source-confirmed.**
   `packages/render/src/weather.ts` generates white square flakes/streaks with locally chosen motion;
   the weather system's OAM art is not imported. The fog and weather selection are separate imported
   data. Reference: `src/overlay005/ov5_021D5EB8.c` weather tasks and `weather_sys` resources.
   A local scene can confirm falling snow, but cannot certify particle shape, density or cadence.
   Import the native sprite/animation resources before tuning by eye. Check ordinary snow and the
   diamond-dust date separately; do not bake March's weather into all Snowpoint visits.

8. **P2 — Hall of Fame presentation still substitutes effects. Open; observed and source-confirmed.**
   The record screen has the member/group staging and text, but no native spotlights; confetti is a
   deterministic set of coloured rectangles (`packages/app/src/ui/hall-of-fame.ts`). Reference:
   `src/cutscenes/hall_of_fame.c` spotlight/confetti tasks; detailed timing research in
   `hall-of-fame-credits.md`. The machine's terminal flash was tracked separately.
   The induction replay's member and group captures were inspected: the picture/text staging and
   rectangular confetti draw, while the native spotlights are absent. Its checks reach the credits and
   CONTINUE upstairs. Matching member/group transitions to emulator frame boundaries remains open.

9. **P2 — Spear Pillar presentation remains an approximation in some phases. Open; existing limitation.**
   The application has imported models and animation channels, but field blends and guardian curves
   are simplified. The intentional single-screen composition is not part of this defect.
   Reference: `story-scenes.md`, the Spear Pillar overlay references there, and `docs/decisions.md`
   “M5c gears, HQ transitions and Spear Pillar”. Capture the same summoning/guardians/Giratina phases
   before changing curves. This pass inspected all three existing phase captures: a dimmed field,
   guardian silhouettes with bright backing, and the large Giratina shadow in front of Dialga/Palkia.
   The existing coloured-pixel checks prove content, not matching choreography.

## Coverage and remaining comparison work

The B1F land and west-wall captures were inspected locally. The app draws the pink platforms, blue
edges, twisted trees and layered background geometry seen in the reference video. Its west-wall replay
rotates the avatar and camera; tree crowns overlap the avatar in that view. These observations confirm
the broad composition and presence of occlusion, not exact tree placement or a camera match: the video
samples are not synchronized to the same tile and simulation frame. Its wider visible world is an
intentional adaptation. The fog regression measures a change in our canvas, not an error against a
video pixel target.

The field probe `tests/browser/visual-audit-m5.rom.spec.ts` fixes the clock to **2009-03-22 12:00**,
loads constructed checkpoints through the app's save loader, and reads its canvas numerically. The
coordinates are reproducible audit locations, not a claim that the whole story was played in a DS.

Observed in the desktop captures: Pastoria has bright green ground, houses, trees and town NPCs;
Canalave has the waterfront, bridge edge and patterned water; Snowpoint has pale fog, square flakes
and the avatar partly sunk in snow. The gym captures show Pastoria's blue platforms, Canalave's
floor/lift pads, Snowpoint's ice walls/snowballs and Sunyshore's large gears. These are static samples,
not checks of every water-level change, lift ride or gear axis. Sunyshore's street sample does not
cover the solar walkway's above/below occlusion.

The League rooms retain their distinct sets: Aaron's trees/rocks, Bertha's rock formations, Flint's
flame-lined walls, Lucian's bright round lights and Cynthia's dark floor with luminous panels. The
Hall of Fame field room draws Rowan, Cynthia, the machine and floor reflections. The induction app
is a separate scene; seeing its field room does not validate its member/group animation or text timing.

`m5-battle-scenes.rom.spec.ts` starts each League encounter with the same seeded level-100 Empoleon.
All five retain their named background and terrain at the command prompt. Desktop command readiness
was Aaron **419**, Bertha **425**, Flint **421**, Lucian **425**, Cynthia **533** simulation ticks after
the request. These include the app's current messages/send-outs; they are not wall-clock timings or
matched-ROM timing errors. The common field transition remains defect 2.

| Area | App checkpoint (tile x,z) | What still requires a matched reference |
|---|---|---|
| Pastoria | city 601,837; gym 13,40 | Framing/colour at noon; water levels, rain/marsh effects and Wake intro |
| Canalave | city 39,733; gym 8,15 | Bridge occlusion, upper-floor lifts, special camera clipping, Byron intro |
| Snowpoint | city 366,201; gym 7,15 | Flakes, snow tracks, ice/snowball occlusion, Candice intro |
| Sunyshore | city 849,764; gym room 3 11,25 | Solar-walkway above/below occlusion, gears, Volkner intro |
| Victory Road | 1F 7,47; 2F 23,26; B1F 6,46 | Bridge/rock overlap, cave lighting, water effects and wild backgrounds |
| Pokémon League | each Elite Four room 8,8; Champion room 8,16 | Room lights/props and each battle's special intro/timing |
| Spear Pillar | 31,35 | Matching summoning, guardian and Giratina camera/effect phases |
| Distortion World | B1F 16,49; wall jump; B4F replay to 104,76 | Fog, ceiling and downward-cascade captures inspected; return cascade, arrival and warp remain |
| Hall of Fame | room 8,12; existing induction replay | Machine animation, spotlights/confetti and member/group/UI frame boundaries |

Outstanding for the requested full comparison: usable M5 cartridge save/checkpoints in the local
emulator; matching date/time, protagonist, story flags, position/facing and camera
phase; noon/dusk/night colours; walking above and below the relevant bridges; each field effect and
battle intro; frame-by-frame UI timing. The video helps the Distortion World only. Do not convert
“no error” or “more than eight colours” into “looks correct”, and do not treat unmeasured areas as clean.

## Validation

Node 24; ROM tests read a local `OPENSINNOH_NDS_ROM`. Local screenshots are inspection aids
only; no screenshots or other ROM-derived files are committed or uploaded.

- `pnpm check`: passed (168 test files, 1,306 tests; 94 files/531 tests skipped without the ROM),
  with `VITEST_MAX_WORKERS=2 OPENSINNOH_TEST_TIMEOUT_MS=60000` on the shared machine.
- `pnpm vitest run packages/render/src/distortion/fog.test.ts packages/render/src/render.test.ts
  --maxWorkers=1`: 24 tests passed. The new density assertion was first observed failing against
  slope 1 (actual 1, expected 32 at depth 0x7700).
- ROM browser checks passed: the 19 field checkpoints on desktop; B1F land/wall on desktop;
  Hall of Fame induction/credits/return and the three Spear Pillar phases on desktop; the new fog
  canvas regression and all five League battle backgrounds on desktop and phone.
- The B4F ceiling/descent audit passed on desktop and phone after fixing its setup to wait for a
  saveable checkpoint and a painted frame (three traversal phases on each).
- The **full ROM test gate is not green**. The initial `OPENSINNOH_NDS_ROM=… pnpm test` reported failed
  importer suites at roughly 65 and 93 seconds. A retry with test/hook deadlines of 300,000 ms spent over 25 minutes in its first
  two importer suites without completing them and was stopped. A further run excluding those two
  files also completed no suites in over eight minutes and was stopped. This is not evidence that
  those suites pass, nor evidence of a visual regression from this change.

The initial Hall of Fame art wait and Sunyshore scene wait also timed out under load. Hall of Fame
passed unchanged on retry; the isolated Spear Pillar test passed. The full browser suite was not run
in this pass. Before merge, complete the full ROM unit and browser gates on an uncontended machine.
