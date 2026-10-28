# Development and testing

## Setup

- The ROM is never in git. Keep your own dump of Pokémon Platinum (US, rev0, SHA-1 `ce81046e…`) outside version
  control, for example as `./Pokemon - Platinum Version (USA).nds` (gitignored). ROM tests read its path from
  `OPENSINNOH_NDS_ROM` and skip without it.
- `reference-projects/pokeplatinum` is an optional, gitignored local checkout of
  [pret/pokeplatinum](https://github.com/pret/pokeplatinum). It has no licence: use it for names, offsets and
  understanding only, and copy no code or assets.
- `pnpm dev` serves the fixture pack and the demo mod (`?packs=fixture`). Without parameters the app asks for the
  ROM. `?time=hh:mm` or `?clock=yyyy-mm-ddThh:mm` sets the clock; `?debug=1` opens the developer tools in dev builds.

## Packages

- `core`: game-agnostic packs, patches, IR, replays, PRNG.
- `contracts`: the cross-package types (`docs/contracts.md` has the changelog).
- `nds`: ROM containers. `importer`: ROM to the `platinum` pack. `g3d`: NSBMD/NSBTX to glTF.
- `vm`: the field script decoder and interpreter.
- `battle`: `@pkmn/sim` gen 4 behind our controller, and the ROM trainer AI.
- `menus` and `services`: headless menu models and service rules (marts, PC, Pokédex, daycare…).
- `audio`: the SDAT sequencer and DS synth. `text`: font and message box.
- `world`: the field simulation. `render`: three.js.
- `game`: composition, saves and replays. `cli`: `opensinnoh dev|check|test|import|coverage|sweep`.
- `ui`: OpenSinnoh UI, the design system for our own screens and the website (`docs/design-system.md`).
- `app`: the web app.

Packs: `packs/fixture` (original content, built by `pnpm fixtures`), `packs/demo-mod`, `packs/platinum-demo`.

## Test tiers

- **Fast, while working:** `pnpm test:changed` (tests touched by the diff against `main`), or
  `pnpm vitest run <file>`. Run only the browser specs a change touches: `pnpm test:browser tests/browser/<spec>`.
- **Full:** `pnpm check` (lint, typecheck, unit tests and pack replays, in parallel), then the ROM tests:
  `OPENSINNOH_NDS_ROM="$PWD/Pokemon - Platinum Version (USA).nds" pnpm test`, then the full ROM `pnpm test:browser`.

Rules:
- ROM tests use original fixtures when no ROM is present. Every other test uses `packs/fixture` or bytes from our own
  writers. No test fixture is cut from a ROM.
- ROM tests share one import: `romSlice()` in `tests/rom.ts`. It is made once per run and cached in
  `.opensinnoh-cache/tests`, keyed by the ROM's SHA-1, `IMPORTER_VERSION` and the importer's sources. Browser specs
  that need the imported game but do not test the import call `seedRomImport(page)` (`tests/browser/seed.ts`).
  Call `importPlatinum` directly only to test the importer.
- Vitest runs files in parallel and the tests in a file in order, so spread long ROM work over files.
- Any change to what the importer writes bumps `IMPORTER_VERSION` in `packages/app/src/importer.ts`, or browsers keep
  a stale cached import.
- Look at screenshots. A test can pass on a black screen.
- ROM tests and specs hold on every supported ROM: name the words they expect by text or record id, or take them
  from the app's string tables for the game's language (`tests/browser/words.ts`), never as English literals.

Browser runner details (workers, sharding, changed-spec selection) are in `docs/browser-tests.md`. Measured suite
timings are in `docs/test-speed.md`. Performance budgets are in `docs/performance.md`.

If SwiftShader stalls on a loaded machine, `OPENSINNOH_TEST_HARDWARE_GPU=1` uses the browser's default GPU backend.

## Replays

A replay is a text file of timed inputs, waits and asserts, played by the headless game and by the app in a browser.
The grammar is documented at the top of `packages/core/src/replay.ts`. Ticks are 30 Hz.

- Replays wait on the game (`until idle|message|yesno|menu|battle|app|state …`, `advance text`) instead of counting
  ticks, so they survive timing changes. `tools/replays/retime.ts` re-times a recording.
- Setup lines (`set flag`, `give item`, `party`, `warp`, `date`, …) run only before the first timed line and are
  echoed in the output.
- `assert state <path> <json>` checks any `GameState` value and the battle log. ROM replays name texts by id, never
  by their words: `assert text <text id> <page>`, `assert state <path> <record id>` (a nickname from a text bank),
  `tap word:<text id>` (an Easy Chat word, wherever the language sorts it).
- A conversation is answered with `advance message` (one box, however many pages) or `advance text` (until a choice
  or idle), never with a counted chain of A presses: each language splits the same text into its own pages. ROM
  tests compare with the text records (`texts.get(id)`), not with English words.
- Randomness that only some paths use (encounters, wandering NPCs, daily rolls) has its own saved PRNG stream, so
  adding an NPC or an encounter check moves no other roll.
- `battle auto` picks the highest-damage legal move. Story replays use it for grinding, and explicit moves elsewhere.
- The dev build's replay recorder writes replay lines from play.

## Story checkpoints

`tests/rom-replays/cp*.replay` chain from a new game. Each checkpoint replay starts with `from <previous>`.

| CP | Scope | Ends at |
|---|---|---|
| 1 | New game → Route 201 starter and rival battle → Lake Verity | starter in the party |
| 2 | Sandgem lab, Pokédex, Journal, Parcel | Route 202 |
| 3 | Jubilife, Trainers' School, the Pokétch | Pokétch with four apps |
| 4 | Route 203, Oreburgh Gate, Roark | Coal Badge |
| 5 | Jubilife tag battle → Floaroma Meadow, Works Key → Valley Windworks, Mars | Looker leaves the Windworks |
| 6 | Eterna Forest with Cheryl → Gardenia → Galactic Eterna Building, Jupiter | Forest Badge, Rad Rickshaw back |
| 7 | Togepi Egg, Bicycle, Explorer Kit → Cycling Road → Hearthome, Fantina | Relic Badge |
| 8 | Barry at the Route 209 gate → Solaceon → Maylene → Veilstone tag battle, warehouse | HM02, Pastoria state 1 |
| 9 | Barry in Pastoria → Wake → the bomb | Fen Badge, Pastoria state 5 |
| 10 | Grunt chase → SecretPotion → Celestic grunt and Cyrus → Surf | Route 218 blockade hidden |
| 11 | Barry in Canalave → Iron Island → Byron → library explosion | Mine Badge, Canalave state 5 |
| 12 | Saturn at Valor Cavern → Mars at Verity | Lake Acuity state 1 |
| 13 | Route 217, HM08 → Candice → Acuity scene | Icicle Badge |
| 14 | Storage Key → Galactic HQ → Cyrus → Saturn → the release | Mt. Coronet 2F state 1 |
| 15 | Mt. Coronet → Spear Pillar → Distortion World → Cyrus → Giratina → Rowan's lab | lab state 3 |
| 16 | Vista Lighthouse → Volkner → Jasmine, HM07 | Beacon Badge |
| 17 | Route 223 → Victory Road → Barry | before the Elite Four |
| 18 | Aaron, Bertha, Flint, Lucian | before the Champion |
| 19 | Cynthia → Hall of Fame → credits → reset | CONTINUE in Twinleaf |
| 20 | Snowpoint ship → Fight Area tag battle | Fight Area state 2 |
| 21 | The dex sweep (`cp21a`–`f`): 210 Sinnoh species seen → National Dex, Poké Radar | Fight Area blockade hidden |
| 22 | Route 225 → Survival Area → Stark Mountain: Mars, Jupiter, Buck, Charon arrested | Stark Mountain cleared |
| 23 | Battleground Buck → Heatran → Routes 228–230 → Snowpoint Temple to B5F (`cp23a`, `cp23b`) | Snowpoint state 1 |
| 24 | Elite Four and Cynthia rematches → Hall of Fame entry 2 → credits | `hallOfFame.total` 2 |

Exact flags, vars and trainer ids per checkpoint are in `docs/research/story-cp5-19.md` and
`docs/research/story-cp20-24.md`. The team is raised once in the chain before CP15 and again before the CP24
rematches (a fixed set team), because levelling that far in play would take hours of ticks. `docs/decisions.md` has
the details.

**Every checkpoint passes:**
- headless, twice from seeds 1–3, with a save round trip;
- started +1, +2, +5 and +15 ticks late;
- with every scripted battle asserted in the battle log by trainer id, result and topology (gym leaders set their
  trainers' flags in bulk, so flags alone prove nothing);
- with no `party` setup lines inside the chain apart from the set-team steps: the team is caught and levelled in
  play, HM users included;
- in the browser on desktop and phone, from the previous chunk's save, with one checked beat per checkpoint.

**Chain anchors.** A chunk's prefix is played once per seed and cached under `.opensinnoh-cache/tests`, keyed by
every replay text in the prefix, the importer key and the headless game's sources (`tests/integration/anchor-key.ts`).
The chunk's replays and late starts run from the anchor. One from-scratch run per chunk compares the full chain with
the anchors, so an anchor cannot hide nondeterminism or a gap in the save. Browser specs load anchors through
`tests/browser/story-seed.ts`. `tools/replays/explore.ts` plays a replay from an anchor and prints where it stopped.

**Branches and systems.**
- `m5-*` and `m6-*` replays branch from a checkpoint anchor (other starters, losses, legendary outcomes). Their only
  setup lines are named in the replay's header: a warp off the chain, a clock, or a dev-only event grant.
- `sys-*` replays test one system and may construct their state with setup lines.
- `svc-*` replays test a service (marts, the PC, the daycare…).

## Coverage and sweeps

- `opensinnoh coverage [--zones <regex>]` classifies every field script op the ROM uses as real or a logged stub.
  Roots are each zone's map scripts and events; branches, calls and common scripts are followed. An unknown op fails.
- `tools/cp-path-ops.ts` regenerates `packages/vm/src/cp-path.ts`: the ops each story chunk reaches. The story path
  has no stub except a short allowlist (journal, TV and shared link ops).
- A stub returns the decomp's "nothing happened" value, logs once and is counted. Where a branch depends on a stub's
  value, the stub cites the decomp.
- The headless zone sweep (part of ROM `pnpm test`) loads all 567 playable zones: every warp arrival is standable,
  every object spawns, every init script runs, no unknown op, movement type or walkable tile behaviour is hit.
- `pnpm sweep:browser` (opt-in, about 27 minutes) renders every zone and records frame times. Run it from a separate
  checkout: Vite HMR breaks it when files change underneath.

## Saves

Each `GameState` version has a migration and an id-only fixture test. Every replay above survives a save round trip.
A fixture-pack save written by an earlier release is part of the round-trip specs.
