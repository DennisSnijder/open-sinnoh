# Remaining script-command stubs

Research date: **2026-10-16**. Engine baseline: `60b31aba587c6d3092390606a3d9b78ffbf581e4`. Native reference: [pret/pokeplatinum at `1dc13dcea40c04ab53f1f607de46023dc409ef20`](https://github.com/pret/pokeplatinum/tree/1dc13dcea40c04ab53f1f607de46023dc409ef20), inspected locally (the local checkout is at `fe1ea418`; the cited files are identical there). Stub entries were updated to main after M5b on 2026-10-16. These are original behavioral summaries and implementation judgments; no decomp implementation, dialogue, ROM bytes, extracted assets or screenshots are included.

## Scope, reachability and estimates

The selection is **every `status: "stubbed"` entry** in [op-classification.json](../../packages/vm/src/data/op-classification.json): **402 of 840 commands**. The other counts are **365 implemented** and **73 unimplemented**. The latter are a separate classifier status, listed in the final appendix, rather than silently counted as stubs. An implemented command may still have fidelity gaps; this inventory does not audit those. A native dummy can nevertheless have an engine stub, and remains listed.

[The CLI coverage tool](../../packages/cli/src/coverage.ts) maps implemented → real, stubbed → stub, and unimplemented → unknown. It starts at map load/transition/resume/frame scripts and object/background/coordinate events, follows all label operands, and, without `--zones`, also starts at tile-behavior hooks, new-game hooks and every non-internal script entry. It explores both branch outcomes without evaluating flags. Therefore **presence on a checkpoint path or a reachable map does not prove the command is a required story gate**, or even executable in the current story state. Native callers below come from opcode-macro expansion (including compound aliases) and map-header script bindings; each linked caller identifies the exact script occurrence. Generic service scripts have no unique map: their dispatch context is stated, rather than assigning them an invented location.

The live classification matched the committed JSON exactly. Applying the CLI's `reachableLabels` and `romRoots` to the shared `romSlice()` import found **593 zones, 9,824 reachable labels, 720 distinct ops: 346 real, 374 stub, 0 unknown** (measured at the baseline; since then M5b made `scr_cmd_2b6`, `get_unown_forms_seen_count` and `try_set_unused_collected_orb_flag` real, all three reached, so expect 349 real, 371 stub). Per-command coverage lists all zone-root maps, with long identical sets factored into the reachability appendix. A zero zone-root count can still have ROM-wide instruction sites through service/entry roots; a zero ROM-wide count means no reached IR occurrence, not that no native source handler exists. Counts describe static instruction sites, not execution frequency. Native source callers and imported reachability are separate evidence. No imported script text or game data is reproduced.

Ordering is by **P0** main-story progression/state and completion; **P1** main-story presentation or journal/reward fidelity; **P2** optional before Champion; **P3** postgame; **P4** unused or communication features excluded from scope. Systems are ordered by their highest-impact member, then earliest cited checkpoint; commands use the same ordering within each system. The native caller lists include optional and postgame uses even when a command also serves the main story. CP numbers follow [story-cp5-19.md](story-cp5-19.md) and [the scope](../scope.md); a “story” note describes the interaction, not a proof of every route's necessity.

**Effort is an engineering estimate, in person-days (d), not measured decomp work.** Per-op ranges are incremental once the named shared dependencies exist; new application/rules/persistence foundations are called out separately. They include handler integration, relevant original-fixture checks and a targeted ROM/replay verification, with uncertainty for unresolved native helpers. Do not add all rows: shared app/task, data, UI and save work overlaps. A small query can depend on weeks of subsystem work. Contract additions are separate reviewed changes; importer-output changes require an `IMPORTER_VERSION` bump.

Underground, NPC Super Contests and Battle Frontier remain eventual completion scope at last priority under [the recorded decision](../decisions.md); optional before Champion does not mean out of scope. Wireless/online features are excluded by [the scope](../scope.md). P4 estimates for those commands are conditional sizing, not a proposal to enable them. See [Underground/Contest sizing](underground-contests-scope.md), [postgame](postgame.md), [Distortion World](distortion-world.md), [gym puzzles](gym-puzzles.md), [story scenes](story-scenes.md) and [Hall of Fame](hall-of-fame-credits.md) for the shared-system work behind the small wrappers. This note uses its pinned native source when older research/classification counts differ.

The checkpoint-path report provides a useful integration boundary (not a list of unavoidable calls):

| Chunk | Story checkpoints | Owned ops real | Owned stubs left | All path stubs left |
|---|---|---:|---:|---:|
| M5a | CP5–8 | 12/12 | 0 | 4 |
| M5b | CP9–13 | 7/8 | 1 | 6 |
| M5c | CP14–19 | 3/23 | 20 | 23 |

M5a has no remaining owned command stub; its four path stubs belong to journal, accessory/backdrop and TV systems. The one owned M5b gap is the Library report. M5c still owns twenty stubs. (Counts from main's `op-classification.json` summary after M5b.)

## System index

| System | Stubs | Highest impact |
|---|---:|---|
| [Distortion World](#system-01) | 9 | P0 |
| [Sunyshore Gym](#system-02) | 2 | P0 |
| [Hall of Fame and credits](#system-03) | 5 | P0 |
| [Save UI and persistence](#system-04) | 11 | P0 |
| [Opening system flags](#system-05) | 3 | P1 |
| [Fashion Case and accessories](#system-06) | 7 | P1 |
| [Library television report](#system-07) | 1 | P1 |
| [Pokédex upgrades and diplomas](#system-08) | 4 | P1 |
| [Galactic HQ containment units](#system-09) | 2 | P1 |
| [Field objects and scene staging](#system-10) | 2 | P1 |
| [Spear Pillar cinematics](#system-11) | 3 | P1 |
| [Journal](#system-12) | 2 | P1 |
| [Field poison survival](#system-13) | 2 | P1 |
| [Script text and input](#system-14) | 14 | P1 |
| [Trainer wireless appearance](#system-15) | 4 | P2 |
| [Television and interviews](#system-16) | 10 | P2 |
| [Daily events and swarms](#system-17) | 5 | P2 |
| [Department Store rewards](#system-18) | 1 | P2 |
| [Game Corner](#system-19) | 13 | P2 |
| [Great Marsh](#system-20) | 6 | P2 |
| [Amity Square](#system-21) | 8 | P2 |
| [Berry patches](#system-22) | 11 | P2 |
| [Chatot recording](#system-23) | 4 | P2 |
| [Clock and owner profile](#system-24) | 1 | P2 |
| [Combee dialogue](#system-25) | 1 | P2 |
| [Dress-Up and photos](#system-26) | 6 | P2 |
| [Easy Chat and custom words](#system-27) | 8 | P2 |
| [Footstep ribbon service](#system-28) | 1 | P2 |
| [Fossil revival](#system-29) | 3 | P2 |
| [Hidden Power type service](#system-30) | 1 | P2 |
| [Honey trees](#system-31) | 4 | P2 |
| [Jubilife rankings](#system-32) | 1 | P2 |
| [Legendary event encounters](#system-33) | 4 | P2 |
| [Mailbox](#system-34) | 2 | P2 |
| [Move services and party selection](#system-35) | 23 | P2 |
| [Mystery Gift and distribution events](#system-36) | 5 | P2 |
| [NPC trades](#system-37) | 6 | P2 |
| [Old Chateau ghosts](#system-38) | 1 | P2 |
| [Poffins](#system-39) | 5 | P2 |
| [Pokémon News Press](#system-40) | 1 | P2 |
| [Pokémon forms](#system-41) | 4 | P2 |
| [Pokémon previews](#system-42) | 5 | P2 |
| [Regi event ruins](#system-43) | 1 | P2 |
| [Seals and Ball Capsules](#system-44) | 5 | P2 |
| [Shops and exchanges](#system-45) | 1 | P2 |
| [Spiritomb and Underground encounters](#system-46) | 2 | P2 |
| [Super Contests](#system-47) | 37 | P2 |
| [Town Map and Fly](#system-48) | 2 | P2 |
| [Trainer battle compatibility](#system-49) | 4 | P2 |
| [Underground](#system-50) | 16 | P2 |
| [Vista Lighthouse binoculars](#system-52) | 1 | P2 |
| [Turnback Cave](#system-53) | 1 | P3 |
| [Battle Arcade](#system-54) | 4 | P3 |
| [Battle Castle](#system-55) | 4 | P3 |
| [Battle Frontier](#system-56) | 4 | P3 |
| [Battle Frontier services](#system-57) | 6 | P3 |
| [Battle Hall](#system-58) | 9 | P3 |
| [Battle Points](#system-59) | 7 | P3 |
| [Battle Tower](#system-60) | 13 | P3 |
| [Battleground rematches](#system-61) | 1 | P3 |
| [Pal Park Catching Show](#system-62) | 4 | P3 |
| [Shaymin event](#system-63) | 3 | P3 |
| [Trophy Garden](#system-64) | 2 | P3 |
| [Villa](#system-65) | 5 | P3 |
| [Wireless sessions](#system-66) | 28 | P4 |
| [Global Terminal favorite Pokémon](#system-67) | 2 | P4 |
| [Legacy Diamond/Pearl gym lifts](#system-68) | 1 | P4 |
| [Union Room](#system-69) | 28 | P4 |

<a id="system-01"></a>

## Distortion World

### `init_persisted_map_features_for_distortion_world` — `0x2F2`

**Story / impact:** P0 — CP15 map transition scripts throughout DW; also postgame Turnback Cave entrance and unused header script.

**Native maps/callers:** [DISTORTION WORLD 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L12); [DISTORTION WORLD B1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L10); [DISTORTION WORLD B2F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b2f.s#L10); [DISTORTION WORLD B3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b3f.s#L9); [DISTORTION WORLD B4F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b4f.s#L9); [DISTORTION WORLD B5F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b5f.s#L9); [DISTORTION WORLD B6F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b6f.s#L15); [DISTORTION WORLD B7F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b7f.s#L13); [DISTORTION WORLD GIRATINA ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L16); [DISTORTION WORLD TURNBACK CAVE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_turnback_cave_room.s#L10); [UNKNOWN 578](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_map_header_unknown_578.s#L9).

**Coverage:** 11 ROM-wide instruction sites; zone-root maps: `DISTORTION_WORLD_1F`, `DISTORTION_WORLD_B1F`, `DISTORTION_WORLD_B2F`, `DISTORTION_WORLD_B3F`, `DISTORTION_WORLD_B4F`, `DISTORTION_WORLD_B5F`, `DISTORTION_WORLD_B6F`, `DISTORTION_WORLD_B7F`, `DISTORTION_WORLD_GIRATINA_ROOM`, `DISTORTION_WORLD_TURNBACK_CAVE_ROOM`, `UNKNOWN_578`.

**Decomp:** Selects the Distortion World persisted-feature buffer and zeroes its saved runtime data.\
This prepares camera/geometry state for DW entry; callers control when initialization happens, so it must not be generalized into an unconditional reset on every ordinary frame. [src/scrcmd.c:4780–4784](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4780-L4784); [src/persisted_map_features_init.c:139–146](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L139-L146)

**Dependencies:** Existing persisted-map-feature seam; Distortion World state schema, gravity/camera/runtime overlay data.\
**Effort:** 0.5–1 person-day command integration; DW traversal/render foundation roughly 12–20 person-days shared, see existing audit

### `add_distortion_world_map_object` — `0x311`

**Story / impact:** P0 — CP15: Cynthia, Mesprit, Cyrus and Giratina story object appearance, including Giratina battle outcomes.

**Native maps/callers:** [DISTORTION WORLD 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L44); [DISTORTION WORLD B1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L34); [DISTORTION WORLD B3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b3f.s#L14); [DISTORTION WORLD GIRATINA ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L78).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: `DISTORTION_WORLD_1F`.

**Decomp:** Creates the requested current-map/local-ID object from DW’s separate authored event tables in its managed object pool.\
Special DW object initialization is applied; this is not a lookup in the ordinary map event file and it completes synchronously. [src/scrcmd.c:6995–7002](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6995-L7002); [src/overlay009/ov9_02249960.c:7319–7359](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L7319-L7359)

**Dependencies:** DW authored object-event importer/runtime registry, managed pool and coordinate/gravity transforms; existing NPC rendering/script bindings.\
**Effort:** 0.5–1 person-day after DW event/object foundation (2–4 person-days shared within DW total)

### `delete_distortion_world_map_object` — `0x312`

**Story / impact:** P0 — CP15: removes departed Cynthia/guardians/Cyrus, boulder-pit hint objects and postbattle Giratina.

**Native maps/callers:** [DISTORTION WORLD 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L76); [DISTORTION WORLD B1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L23); [DISTORTION WORLD B3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b3f.s#L31); [DISTORTION WORLD B6F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b6f.s#L51); [DISTORTION WORLD B7F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b7f.s#L73); [DISTORTION WORLD GIRATINA ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L124).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: `DISTORTION_WORLD_1F`, `DISTORTION_WORLD_B1F`.

**Decomp:** Finds the managed DW object by both current map header and local ID, then deletes it through the DW manager.\
Failure to find the expected authored object is an internal assertion in the source; it must not silently delete an unrelated same-ID object. [src/scrcmd.c:7004–7011](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7004-L7011); [src/overlay009/ov9_02249960.c:7361–7381](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L7361-L7381)

**Dependencies:** DW managed object pool and map-qualified identity; matching event creation and object cleanup.\
**Effort:** 0.25–0.5 person-day after DW object foundation

### `get_player3_d_pos` — `0x317`

**Story / impact:** P0 — CP15: B2F first-entry and Cynthia proximity/position branches.

**Native maps/callers:** [DISTORTION WORLD B2F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b2f.s#L17).

**Coverage:** 2 ROM-wide instruction sites; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Writes the player map object’s X, half of its Y, and Z to three destination variables.\
It uses map-grid coordinates, including the engine’s half-height conversion, rather than camera-space coordinates or raw 3D world units. [src/scrcmd.c:4786–4801](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4786-L4801)

**Dependencies:** Existing player coordinate access; consistent DW height/grid representation and integer conversion.\
**Effort:** 0.25–0.5 person-day

### `reset_distortion_world_persisted_camera_angles` — `0x31F`

**Story / impact:** P0 — CP15: Giratina room cleanup restores the persisted camera basis before leaving.

**Native maps/callers:** [DISTORTION WORLD GIRATINA ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L24).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `DISTORTION_WORLD_GIRATINA_ROOM`.

**Decomp:** Zeroes saved DW camera angles X/Y/Z in the persisted-feature buffer.\
Returns synchronously; this clears stored offsets for future camera initialization rather than running a camera interpolation itself. [src/scrcmd.c:7013–7019](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7013-L7019); [src/overlay009/ov9_02249960.c:2056–2066](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L2056-L2066)

**Dependencies:** DW persisted camera-angle state and correct camera reinitialization/readback.\
**Effort:** 0.25 person-day after DW camera foundation

### `wait_ab_pad_press` — `0x032`

**Story / impact:** P1 — CP15: Cynthia elevator, Cyrus confrontation, and Giratina shadow/arrival acknowledgments.

**Native maps/callers:** [DISTORTION WORLD 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L84); [DISTORTION WORLD B7F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b7f.s#L45); [DISTORTION WORLD GIRATINA ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L151).

**Coverage:** 4 ROM-wide instruction sites; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Installs an input wait accepting a newly pressed A, B, or any direction on the D-pad.\
Resumes without moving or turning the player; X and held-only input do not satisfy this callback. [src/scrcmd.c:1447–1451](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1447-L1451); [src/scrcmd.c:1453–1460](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1453-L1460)

**Dependencies:** Existing VM waits and input edge events; preserve direction input while field movement is locked.\
**Effort:** 0.25–0.5 person-day

### `do_dw_warp` — `0x320`

**Story / impact:** P1 — CP15: distorted Spear Pillar entrance animation before the actual DW map transition.

**Native maps/callers:** [SPEAR PILLAR DISTORTED](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_distorted.s#L69).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SPEAR_PILLAR_DISTORTED`.

**Decomp:** Opens the dedicated 3D DW-warp application and waits for its exit.\
Its timed animation fades in, plays the warp sound after a delay, runs beyond 85 updates and fades out; the script performs the subsequent map warp separately. [src/scrcmd.c:7050–7056](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7050-L7056); [src/unk_0203D1B8.c:1776–1787](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1776-L1787); [src/dw_warp/dw_warp.c:25–163](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/dw_warp/dw_warp.c#L25-L163)

**Dependencies:** Imported warp model/two animations, cinematic camera and sound; existing app/fade/model animation seam.\
**Effort:** 2–3 person-days

### `start_distortion_world_giratina_shadow_event` — `0x321`

**Story / impact:** P1 — Required CP15 Distortion World 1F first-entry scene presentation.

**Native maps/callers:** [DISTORTION WORLD 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L60).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `DISTORTION_WORLD_1F`.

**Decomp:** Starts the indexed external Giratina shadow prop animation in the Distortion map renderer.\
It runs concurrently, with template movement/cry; the command does not wait, move the player or write story flags. [src/scrcmd.c:7058–7065](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7058-L7065); [src/overlay009/ov9_02249960.c:6684–6704](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6684-L6704); [src/overlay009/ov9_02249960.c:6709–6751](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6709-L6751)

**Dependencies:** Distortion dynamic-map state, new shadow prop/effect animation lifecycle and imported model/clip; existing cry host.\
**Effort:** 1–2 d once Distortion prop renderer exists

### `finish_distortion_world_giratina_shadow_event` — `0x322`

**Story / impact:** P1 — Required CP15 Distortion World 1F first-entry cleanup.

**Native maps/callers:** [DISTORTION WORLD 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L65).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `DISTORTION_WORLD_1F`.

**Decomp:** Finishes any active Giratina shadow animation manager and frees its prop renderer/resources.\
It does not wait for natural completion; caller timing controls when the first-entry shadow is removed. [src/scrcmd.c:7067–7073](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7067-L7073); [src/overlay009/ov9_02249960.c:6706–6711](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6706-L6711); [src/overlay009/ov9_02249960.c:6766–6777](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6766-L6777)

**Dependencies:** Same Distortion shadow effect lifecycle as start; existing field/script timing.\
**Effort:** 0.25–0.5 d after shadow start exists

<a id="system-02"></a>

## Sunyshore Gym

### `init_persisted_map_features_for_sunyshore_gym` — `0x175`

**Story / impact:** P0 — CP16: all three gear rooms initialize their traversal puzzle state.

**Native maps/callers:** [SUNYSHORE CITY GYM ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_1.s#L14); [SUNYSHORE CITY GYM ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_2.s#L13); [SUNYSHORE CITY GYM ROOM 3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L14).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `SUNYSHORE_CITY_GYM_ROOM_1`, `SUNYSHORE_CITY_GYM_ROOM_2`, `SUNYSHORE_CITY_GYM_ROOM_3`.

**Decomp:** Selects the Sunyshore persisted-feature buffer and records the room ID.\
Initial rotation depends on room and entrance Z; arriving through the entrance resets it to the canonical entrance orientation. [src/scrcmd.c:4750–4757](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4750-L4757); [src/persisted_map_features_init.c:71–107](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L71-L107)

**Dependencies:** Existing persisted gym feature seam; new Sunyshore room/gear tables, rotation state and save/load handling.\
**Effort:** 0.5–1 person-day integration after Sunyshore foundation (4–7 person-days shared with press button)

### `press_sunyshore_gym_button` — `0x176`

**Story / impact:** P0 — CP16: gear buttons form the walking route to Volkner.

**Native maps/callers:** [SUNYSHORE CITY GYM ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_1.s#L18); [SUNYSHORE CITY GYM ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_2.s#L17); [SUNYSHORE CITY GYM ROOM 3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L18).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `SUNYSHORE_CITY_GYM_ROOM_1`, `SUNYSHORE_CITY_GYM_ROOM_2`, `SUNYSHORE_CITY_GYM_ROOM_3`.

**Decomp:** Updates saved rotation according to the normal/reverse/double button: +90, −90, or 180 degrees modulo the room’s rotation states.\
Plays the gear sound and runs an asynchronous task rotating all room gears; puzzle collision and player/platform positioning follow the rotation. [src/scrcmd.c:4759–4766](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4759-L4766); [src/overlay008/gym_features.c:2150–2247](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay008/gym_features.c#L2150-L2247)

**Dependencies:** Sunyshore persisted state, room-specific gear connections/collision, animated map props and passenger movement; existing platform/audio primitives.\
**Effort:** 2–4 person-days incremental; Sunyshore shared foundation roughly 4–7 person-days

<a id="system-03"></a>

## Hall of Fame and credits

### `clear_game` — `0x0B0`

**Story / impact:** P0 — CP19: mandatory Champion completion, durable completion state, credits and restart.

**Native maps/callers:** [POKEMON LEAGUE HALL OF FAME](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_hall_of_fame.s#L57).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `POKEMON_LEAGUE_HALL_OF_FAME`.

**Decomp:** Captures prior completion state, grants Champion ribbons, updates completion/first-clear records and continuation locations, then starts a field task.\
Shows the Hall of Fame record presentation, heals the party, attempts the main save and Hall of Fame-history append, and reports the save outcome.\
Runs the original credits using prior-clear skippability and resets after their application exits; overwrite-conflict handling skips the saving branch. [src/scrcmd.c:3337–3341](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3337-L3341); [src/clear_game.c:72–232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/clear_game.c#L72-L232)

**Dependencies:** New history save block/migration; safe internal save during script/task, completion flags/records, Hall of Fame presentation, imported credits resources/timeline and browser reset/continuation signal.\
**Effort:** 8–14 person-days shared HoF/credits/save integration foundation; includes this command, not additive to its child screens

### `get_league_victories` — `0x28F`

**Story / impact:** P0 — CP19 Hall of Fame entry flow; also postgame Survival Area rival team scaling.

**Native maps/callers:** [POKEMON LEAGUE HALL OF FAME](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_hall_of_fame.s#L16); [SURVIVAL AREA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area.s#L154).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `POKEMON_LEAGUE_HALL_OF_FAME`, `SURVIVAL_AREA`.

**Decomp:** Loads Hall of Fame data and returns the newest entry’s cumulative League victory number.\
Returns zero for absent, corrupt or unsuccessful loads, and releases loaded data; it yields once. [src/scrcmd.c:6259–6282](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6259-L6282)

**Dependencies:** Existing/new Hall of Fame persistent record/ordinal and load result; rival rematch thresholds.\
**Effort:** 0.5–1 d once Hall of Fame save exists

### `play_hall_of_fame_healing_animation` — `0x25A`

**Story / impact:** P1 — CP19: machine/Poké Ball healing presentation before ClearGame.

**Native maps/callers:** [POKEMON LEAGUE HALL OF FAME](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_hall_of_fame.s#L52).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `POKEMON_LEAGUE_HALL_OF_FAME`.

**Decomp:** Starts the Hall of Fame machine healing scene with the script-provided number of Poké Balls.\
This is the field animation task; actual party HP/status healing belongs to the later ClearGame save sequence. [src/scrcmd.c:5689–5695](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5689-L5695); [src/clear_game.c:133–144](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/clear_game.c#L133-L144)

**Dependencies:** Imported Hall of Fame machine props/animations and Poké Ball sequence; existing prop-animation/field-task seam. The native routine does not explicitly request the healing jingle.\
**Effort:** 1–2 person-days after common healing scene primitives

### `check_is_hall_of_fame_corrupted` — `0x336`

**Story / impact:** P3 — Optional PC Hall of Fame viewer refusal after Champion; not the CP19 registration command.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1115).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Loads the Hall of Fame block and tests its load result for corruption.\
Writes the boolean then frees the loaded block; it neither repairs nor presents records. [src/scrcmd.c:3353–3366](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3353-L3366)

**Dependencies:** Hall of Fame persisted records and explicit load integrity/error results; existing PC/text flow.\
**Effort:** 0.25–0.5 d

### `open_pc_hall_of_fame_screen` — `0x0B1`

**Story / impact:** P3 — Post-Champion common PC menu Hall of Fame viewer.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1118).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Loads and opens the PC Hall of Fame application, retains its arguments, and pauses until exit.\
The launcher rejects a corrupt history; the common script separately enforces completed-game and corruption checks before offering the viewer. [src/scrcmd.c:3343–3351](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3343-L3351); [src/unk_0203D1B8.c:1390–1408](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1390-L1408)

**Dependencies:** HoF history foundation from clear_game, read-only team/member viewer, PC menu app lifecycle.\
**Effort:** 1–2 person-days after HoF history and display foundation

<a id="system-04"></a>

## Save UI and persistence

### `try_save_game` — `0x12D`

**Story / impact:** P0 — Common save workflow throughout the game; Frontier save-and-quit also calls it.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L460); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L455); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L411); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L583); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L438); [BATTLE TOWER BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_room.s#L119); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L158); [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L414).

**Coverage:** 8 ROM-wide instruction sites; zone-root maps: [R05](#reach-r05) (48 maps).

**Decomp:** Snapshots current objects and player location, sends the Pokétch save event, and attempts the durable main save.\
Writes true only when the save result is OK; command execution is synchronous in the DS implementation. [src/scrcmd.c:4112–4119](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4112-L4119); [src/overlay005/save_info_window.c:188–205](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/save_info_window.c#L188-L205)

**Dependencies:** Existing save serializer/storage, field snapshot and Pokétch event seam; internal script-safe save entry point with truthful storage result.\
**Effort:** 1–2 person-days shared script-save integration foundation

### `store_save_result` — `0x18F`

**Story / impact:** P0 — Common save script returns its outcome to the calling save task.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L352).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Reads a script save-result value and writes it through the script manager’s optional caller-owned result pointer.\
If there is no registered caller result target, leaves it alone; no save is initiated here. [src/scrcmd.c:4645–4655](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4645-L4655)

**Dependencies:** Common-save caller/task result channel; existing script variables and save-outcome enum.\
**Effort:** 0.25–0.5 person-day

### `save_extra_data` — `0x2D6`

**Story / impact:** P0 — Common save initializes extra save data the first time it is needed.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L445).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** If the extra-data initialization flag is already set, returns without work.\
Otherwise initializes and saves every extra block except Hall of Fame, then marks initialization complete; it does not append Champion history. [src/scrcmd.c:4121–4125](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4121-L4125); [src/savedata.c:896–925](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/savedata.c#L896-L925)

**Dependencies:** Existing durable save infrastructure; typed extra-data blocks/init flag and storage error semantics; keep HoF lifecycle separate.\
**Effort:** 0.5–1 person-day after shared extra-save foundation

### `show_saving_icon` — `0x18D`

**Story / impact:** P1 — Common saving messages and Frontier challenge saves.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L459); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L454); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L410); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L582); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L437); [BATTLE TOWER BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_room.s#L118); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L157); [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L412).

**Coverage:** 8 ROM-wide instruction sites; zone-root maps: [R05](#reach-r05) (48 maps).

**Decomp:** Adds an animated wait dial to the active script message window and stores its handle.\
Returns synchronously; the icon does not itself initiate a save or gate continuation. [src/scrcmd.c:1787–1795](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1787-L1795)

**Dependencies:** Existing message-window rendering; temporary wait indicator ownership.\
**Effort:** 0.25–0.5 person-day

### `hide_saving_icon` — `0x18E`

**Story / impact:** P1 — Common saving messages and Frontier challenge saves.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L461); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L456); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L412); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L584); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L439); [BATTLE TOWER BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_room.s#L120); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L159); [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L415).

**Coverage:** 8 ROM-wide instruction sites; zone-root maps: [R05](#reach-r05) (48 maps).

**Decomp:** Destroys the wait dial created by show_saving_icon.\
Completes synchronously; storage outcome and message dismissal remain separate. [src/scrcmd.c:1797–1803](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1797-L1803)

**Dependencies:** Matching saving-icon handle/lifecycle in message renderer.\
**Effort:** 0.25 person-day

### `scr_cmd_258` — `0x258`

**Story / impact:** P1 — Common save start: player saving pose.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L405).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** If the avatar is walking, switches it to the SAVE transition sprite and starts a recurring graphics-refresh task.\
Stores that task for the matching end command; a non-walking avatar leaves a null task, and the command yields once. [src/scrcmd.c:5671–5679](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5671-L5679); [src/overlay005/ov5_021DFB54.c:1638–1697](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021DFB54.c#L1638-L1697)

**Dependencies:** Existing avatar states/sprites and field task lifecycle; save-pose sprite import and request/restore protocol.\
**Effort:** 0.5–1 person-day shared with scr_cmd_259

### `scr_cmd_259` — `0x259`

**Story / impact:** P1 — Common save end: restore player walking pose.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L408).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** Ends the player-save graphics task stored by scr_cmd_258 and requests the walking state.\
A null task is accepted when the initial avatar was not walking; command yields once without an extra completion wait. [src/scrcmd.c:5681–5687](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5681-L5687); [src/overlay005/ov5_021DFB54.c:1664–1697](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021DFB54.c#L1664-L1697)

**Dependencies:** Matching avatar save-pose task and restoration seam.\
**Effort:** 0.25–0.5 person-day after save-pose foundation

### `open_save_info` — `0x2C1`

**Story / impact:** P1 — Common save confirmation/info display.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L372).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** Creates and draws the save-information window when the save is not in an overwrite-conflict state.\
Stores that window for later closing; returns synchronously and does not write to storage. [src/scrcmd.c:6535–6546](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6535-L6546)

**Dependencies:** Existing trainer/profile/location/play-time data and menu renderer; save overwrite-conflict state and dedicated info panel.\
**Effort:** 0.5–1 person-day shared save-info panel

### `close_save_info` — `0x2C2`

**Story / impact:** P1 — Common save cancellation/success cleanup.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L425).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** Erases and frees the save-information window when overwrite-conflict handling has not suppressed it.\
Does not close other script messages or perform any save operation. [src/scrcmd.c:6548–6559](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6548-L6559)

**Dependencies:** Matching save-info handle and overwrite-conflict lifecycle.\
**Effort:** 0.25 person-day after panel creation

### `check_save_type` — `0x12C`

**Story / impact:** P2 — Optional explicit SAVE menu branches throughout the journey; main-story play does not require saving.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L370).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** Returns one of overwrite, no prior save, full save or quick save according to saved-data status.\
The checks have that priority order and complete synchronously; this command does not perform the save. [src/scrcmd.c:4094–4110](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4094-L4110)

**Dependencies:** Existing save host; model DS save-kind/misc-block initialization only where meaningful for the browser.\
**Effort:** 0.25–0.5 d

### `check_is_misc_save_init` — `0x2D7`

**Story / impact:** P2 — Optional quick-save validation before activities that need the extra save block.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L455).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R04](#reach-r04) (46 maps).

**Decomp:** Returns the saved miscellaneous-block initialization flag.\
Does not initialize the block or save the game; synchronous query. [src/scrcmd.c:4127–4133](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4127-L4133)

**Dependencies:** Meaningful persistent misc-record initialization status or explicit browser save mapping.\
**Effort:** 0.25–0.5 d

<a id="system-05"></a>

## Opening system flags

### `set_step_flag` — `0x164`

**Story / impact:** P1 — CP1 Route 201 rival-following scene writes the saved step flag. No progression consumer was found beyond the unused check/clear command family; this is state parity, not a proven story gate.

**Native maps/callers:** [ROUTE 201](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_201.s#L1237).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_201`.

**Decomp:** Sets the saved system step flag.\
No counter is incremented and no task is started; subsequent step-flag checks see it set. [src/scrcmd_system_flags.c:136–140](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_system_flags.c#L136-L140); [src/system_flags.c:89–102](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/system_flags.c#L89-L102)

**Dependencies:** Existing VarsFlags model and source-index mapping for FLAG_STEP; step-flag readers/clearers.\
**Effort:** 0.25 d

### `check_bag_acquired` — `0x15E`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Returns the saved Bag-acquired system flag.\
Writes a boolean immediately. [src/scrcmd_system_flags.c:71–76](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_system_flags.c#L71-L76)

**Dependencies:** Existing flags and Bag model; wire the acquisition flag boundary.\
**Effort:** 0.25 d

### `give_bag` — `0x15F`

**Story / impact:** P4 — Only called by the unused Twinleaf house entry; not the live opening sequence.

**Native maps/callers:** [TWINLEAF TOWN PLAYER HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_twinleaf_town_player_house_1f.s#L507).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Sets the Bag-acquired system flag.\
Immediate flag write; does not create or fill Bag inventory. [src/scrcmd_system_flags.c:104–108](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_system_flags.c#L104-L108)

**Dependencies:** Existing flags and Bag model.\
**Effort:** 0.25 d

<a id="system-06"></a>

## Fashion Case and accessories

### `add_accessory` — `0x1D2`

**Story / impact:** P1 — CP5 compulsory Jubilife Fashion Case reward grants ten accessories; also optional gifts, massage, Floaroma shop and Contest preparation.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L752); [JUBILIFE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L1006).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `AMITY_SQUARE`, `CONTEST_HALL_LOBBY`, `ETERNA_FOREST_OUTSIDE`, `JUBILIFE_CITY`, `JUBILIFE_TV_2F`, `PAL_PARK_LOBBY`, `PASTORIA_CITY`, `ROUTE_206_CYCLING_ROAD_SOUTH_GATE`, `VEILSTONE_CITY_SOUTHWEST_HOUSE`, `VEILSTONE_STORE_1F`.

**Decomp:** Adds the requested accessory quantity to the saved Fashion Case, separately from Bag inventory.\
The helper caps ordinary accessory quantities at nine and unique accessories at one. [src/scrcmd.c:5077–5087](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5077-L5087); [src/unk_020298BC.c:421–447](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020298BC.c#L421-L447); [res/field/scripts/scripts_jubilife_city.s:986–1014](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L986-L1014)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 0.25 d; Fashion Case/save foundation 1–2 d

### `add_contest_backdrop` — `0x1D5`

**Story / impact:** P1 — Includes the early Jubilife Fashion Case reward scene as well as optional repeat backdrop gifts.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L775); [JUBILIFE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L996).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `GLOBAL_TERMINAL_1F`, `JUBILIFE_CITY`, `PAL_PARK_LOBBY`.

**Decomp:** Records a newly acquired backdrop in the Fashion Case, independently of Bag items.\
An already-owned backdrop is unchanged; a new one receives the next acquisition-order index, rather than just setting an ownership bit. [src/scrcmd.c:5120–5129](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5120-L5129); [src/unk_020298BC.c:473–486](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020298BC.c#L473-L486)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 0.25–0.5 d

### `can_fit_accessory` — `0x1D3`

**Story / impact:** P2 — Optional accessory/backdrop gifts, massage, Floraroma shop and contest preparation.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L383); [PAL PARK LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park_lobby.s#L509).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `AMITY_SQUARE`, `PAL_PARK_LOBBY`.

**Decomp:** Tests whether the Fashion Case can fit the requested count of an accessory.\
Writes a boolean without granting it. [src/scrcmd.c:5089–5100](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5089-L5100)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 0.25–0.5 d

### `check_backdrop` — `0x1D6`

**Story / impact:** P2 — Optional accessory/backdrop gifts, massage, Floraroma shop and contest preparation.

**Native maps/callers:** [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L483); [PAL PARK LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park_lobby.s#L526).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `GLOBAL_TERMINAL_1F`, `PAL_PARK_LOBBY`.

**Decomp:** Checks whether a backdrop is already owned in the Fashion Case.\
Writes the ownership boolean immediately; no item is consumed. [src/scrcmd.c:5131–5141](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5131-L5141)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 0.25–0.5 d

### `show_accessory_shop` — `0x257`

**Story / impact:** P2 — Optional Floaroma Flower Shop berry-for-accessory exchange.

**Native maps/callers:** [FLOWER SHOP](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_flower_shop.s#L64).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `FLOWER_SHOP`.

**Decomp:** Starts the flower-shop accessory-exchange field task.\
Yields until the shop workflow finishes. [src/scrcmd_shop.c:123–127](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_shop.c#L123-L127)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 1–2 d

### `try_get_random_massage_girl_accessory` — `0x26C`

**Story / impact:** P2 — Optional Veilstone massage accessory reward; daily massage timing is handled by the script.

**Native maps/callers:** [VEILSTONE CITY SOUTHWEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_southwest_house.s#L42).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VEILSTONE_CITY_SOUTHWEST_HOUSE`.

**Decomp:** Chooses uniformly among massage-girl accessories that can still fit in the Fashion Case.\
Returns 0xFFFF when none fit; selection does not grant the accessory itself. [src/scrcmd.c:5882–5922](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5882-L5922)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 0.25–0.5 d

### `remove_accessory` — `0x279`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Removes the requested quantity of an accessory from the Fashion Case.\
Immediate save-state edit; no UI opens. [src/scrcmd.c:5984–5994](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5984-L5994)

**Dependencies:** New Fashion Case accessory quantities/backdrop flags and save fields; existing Bag/RNG/menu host.\
**Effort:** 0.25–0.5 d

<a id="system-07"></a>

## Library television report

### `start_library_tv` — `0x310`

**Story / impact:** P1 — CP11: Canalave Library Lake Valor explosion report, before the lake missions.

**Native maps/callers:** [CANALAVE LIBRARY 3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_library_3f.s#L147).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CANALAVE_LIBRARY_3F`.

**Decomp:** Launches the dedicated Library TV application and pauses until it exits.\
The app fades in, animates its scanline display for its fixed 240-update display interval, fades out and exits; there is no input-based skip in its main loop. [src/scrcmd.c:3213–3219](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3213-L3219); [src/library_tv/library_tv.c:20–162](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/library_tv/library_tv.c#L20-L162)

**Dependencies:** Imported TV graphics/message resources, dedicated scanline/presentation effect and deterministic app timer; existing child-app and fades.\
**Effort:** 2–3 person-days

<a id="system-08"></a>

## Pokédex upgrades and diplomas

### `turn_on_pokedex_form_detection` — `0x22C`

**Story / impact:** P1 — Rowan’s assistant upgrades the Pokédex at the Route 218 Canalave gate during CP11; the flag is presentation, not a badge gate.

**Native maps/callers:** [ROUTE 218 GATE TO CANALAVE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_218_gate_to_canalave_city.s#L33).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_218_GATE_TO_CANALAVE_CITY`.

**Decomp:** Enables the saved Pokédex form-detection flag immediately.\
The Pokédex application uses that flag to enable its form-viewing controls. [src/scrcmd.c:5460–5464](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5460-L5464); [src/pokedex.c:1070–1080](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokedex.c#L1070-L1080); [src/applications/pokedex/ov21_021E29DC.c:1379–1389](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/applications/pokedex/ov21_021E29DC.c#L1379-L1389)

**Dependencies:** Existing Pokédex/seen-form state; persist the upgrade flag and wire it to the Pokédex application.\
**Effort:** 0.25 d

### `show_diploma_sinnoh` — `0x1EA`

**Story / impact:** P2 — Valor Lakefront west house Sinnoh Dex completion reward; optional and not itself Champion-gated.

**Native maps/callers:** [GRAND LAKE VALOR LAKEFRONT WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_grand_lake_valor_lakefront_west_house.s#L37).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GRAND_LAKE_VALOR_LAKEFRONT_WEST_HOUSE`.

**Decomp:** Launches the diploma viewer with the National-Dex selector false, choosing the Sinnoh diploma.\
Stores application arguments and pauses until the viewer closes; script checks are responsible for award eligibility. [src/scrcmd.c:5171–5179](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5171-L5179)

**Dependencies:** Existing app lifecycle/Pokédex completion checks; diploma image/text resources and viewer.\
**Effort:** 1–2 person-days shared diploma viewer

### `show_diploma_national_dex` — `0x1EB`

**Story / impact:** P3 — Optional National Dex completion diploma in Grand Lake’s west house.

**Native maps/callers:** [GRAND LAKE VALOR LAKEFRONT WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_grand_lake_valor_lakefront_west_house.s#L54).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GRAND_LAKE_VALOR_LAKEFRONT_WEST_HOUSE`.

**Decomp:** Opens the National Dex diploma application using the saved trainer/game state.\
Waits until the certificate viewer closes. [src/scrcmd.c:5181–5189](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5181-L5189)

**Dependencies:** Existing Pokédex/seen forms; new upgrade flags or diploma app as applicable.\
**Effort:** 0.5–1 d

### `turn_on_pokedex_language_detection` — `0x22B`

**Story / impact:** P3 — Optional Meister conversation on postgame Route 226.

**Native maps/callers:** [ROUTE 226 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_226_house.s#L22).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_226_HOUSE`.

**Decomp:** Enables saved Pokédex language detection.\
Immediate feature-flag change; no trade is performed. [src/scrcmd.c:5454–5458](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5454-L5458)

**Dependencies:** Existing Pokédex/seen forms; new upgrade flags or diploma app as applicable.\
**Effort:** 0.25 d

<a id="system-09"></a>

## Galactic HQ containment units

### `init_lake_guardian_containment_units` — `0x25E`

**Story / impact:** P1 — CP14: control room on-resume shows containment units before/after freeing the guardians.

**Native maps/callers:** [GALACTIC HQ CONTROL ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_galactic_hq_control_room.s#L32).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GALACTIC_HQ_CONTROL_ROOM`.

**Decomp:** Chooses paused prop-animation states from the freed-Galactic-HQ-Pokémon flag.\
Before release it primes the one-shot opening clip; after release it holds the loop and opening clip at their completed states. [src/scrcmd.c:5722–5726](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5722-L5726); [src/overlay006/lake_guardian_containment_units.c:16–31](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/lake_guardian_containment_units.c#L16-L31)

**Dependencies:** Existing flags and map props; imported containment model/animations and precise frame/pause control.\
**Effort:** 0.5–1 person-day shared containment-scene integration

### `deactivate_lake_guardian_containment_units` — `0x25F`

**Story / impact:** P1 — CP14: red-button release scene after Saturn.

**Native maps/callers:** [GALACTIC HQ CONTROL ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_galactic_hq_control_room.s#L191).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GALACTIC_HQ_CONTROL_ROOM`.

**Decomp:** Starts a field task that waits for the containment loop’s last frame, pauses it, then unpauses the opening animation.\
The script resumes after that one-shot animation loop finishes; this command itself does not set the guardians-freed flag. [src/scrcmd.c:5728–5732](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5728-L5732); [src/overlay006/lake_guardian_containment_units.c:33–69](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/lake_guardian_containment_units.c#L33-L69)

**Dependencies:** Same containment props/animation frame control as initialization; deterministic blocking scene task.\
**Effort:** 0.5–1 person-day after containment props

<a id="system-10"></a>

## Field objects and scene staging

### `scr_cmd_18c` — `0x18C`

**Story / impact:** P1 — CP15 Mars/Jupiter and Barry staging; also optional Route224 Oak and postgame Battle Tower Teala.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L77); [ROUTE 224](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_224.s#L38); [SPEAR PILLAR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L189).

**Coverage:** 15 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`, `ROUTE_224`, `SPEAR_PILLAR`.

**Decomp:** Finds the specified local object and attempts to turn it to the supplied direction.\
If its graphics need refresh, refreshes them immediately; it does not enqueue a walking animation or wait. [src/scrcmd.c:4630–4643](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4630-L4643); [src/overlay005/ov5_021ECC20.c:148–155](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021ECC20.c#L148-L155)

**Dependencies:** Existing local-object lookup and facing; drawn billboard pose refresh on direction changes.\
**Effort:** 0.25–0.5 person-day

### `lock_last_talked` — `0x2B4`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Pauses all objects, while allowing the player, last-talked object and relevant follower/associated object to finish movement already in progress.\
Waits for those selected movements to settle before completing the lock; it is not simply freeze-everything immediately. [src/scrcmd.c:2276–2314](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2276-L2314)

**Dependencies:** Existing lock/movement waits; last-talked object identity, active partner and associated-object relationship.\
**Effort:** 0.5–1 person-day

<a id="system-11"></a>

## Spear Pillar cinematics

### `set_sub_scene63` — `0x05D`

**Story / impact:** P1 — CP15: Cyrus sequence immediately before the large Spear Pillar cinematic.

**Native maps/callers:** [SPEAR PILLAR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L378).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SPEAR_PILLAR`.

**Decomp:** Selects audio sub-scene 63, which loads the climax sound-effect group rather than starting a new BGM track.\
Yields once with no completion wait or script result; it prepares sounds needed by the ensuing Spear Pillar scene. [src/scrcmd_sound.c:202–206](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L202-L206); [src/sound.c:227–229](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/sound.c#L227-L229); [src/sound.c:283–304](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/sound.c#L283-L304)

**Dependencies:** Existing audio host; semantic scene/sub-scene handling, including no-sequence behavior.\
**Effort:** 0.25–0.5 person-day

### `scr_cmd_20d` — `0x20D`

**Story / impact:** P1 — Required CP15 Red Chain/Giratina and lake-guardian scene presentation; scripts poll completion before advancing.

**Native maps/callers:** [SPEAR PILLAR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L373); [SPEAR PILLAR DISTORTED](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_distorted.s#L36).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `SPEAR_PILLAR`, `SPEAR_PILLAR_DISTORTED`.

**Decomp:** Dispatches Spear Pillar visual controllers: start/stop, source-bound effects and camera/lighting profiles.\
Modes 1 and 6 poll terminal states and free the live effect only when done; other modes return zero after starting/changing it. [src/scrcmd.c:5314–5321](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5314-L5321); [src/overlay006/ov6_02243004.c:14–65](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_02243004.c#L14-L65); [src/overlay006/ov6_0223E140.c:638–1035](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_0223E140.c#L638-L1035); [src/overlay006/ov6_0223E140.c:1037–1704](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_0223E140.c#L1037-L1704)

**Dependencies:** New source-driven cinematic actors/effects, shared live-effect lifecycle, camera/lighting and imported models/animations; existing sound host.\
**Effort:** 4–7 d; new cinematic controller foundation included

### `scr_cmd_2fb` — `0x2FB`

**Story / impact:** P1 — CP15: Cyrus/Dialga/Palkia/Giratina Spear Pillar cinematic before changing to distorted Spear Pillar.

**Native maps/callers:** [SPEAR PILLAR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L385).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SPEAR_PILLAR`.

**Decomp:** Creates a field task carrying options and the trainer profile/gender, then fades out and launches overlay100’s three-phase application.\
Waits for the application, restarts the field and releases temporary state; it returns no script result and does not itself perform the following story map warp. [src/scrcmd.c:6878–6882](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6878-L6882); [src/unk_020985E4.c:23–86](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020985E4.c#L23-L86); [src/overlay100/ov100_021D0D80.c:99–150](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay100/ov100_021D0D80.c#L99-L150)

**Dependencies:** New imported overlay100 models/animations/dialogue and authored cinematic timeline, camera/effects and multi-cry audio; existing child-app/field transition seam.\
**Effort:** 6–10 person-days shared Spear Pillar cinematic foundation

<a id="system-12"></a>

## Journal

### `create_journal_event` — `0x1CD`

**Story / impact:** P1 — Shared activity logging plus gym/Elite Four/Champion callers through CP19; optional records do not gate battle victories.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L293); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L290); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L241); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L410); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L446); [CANALAVE CITY GYM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_gym.s#L20); [ETERNA CITY GYM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L65); [field moves (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L58); [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L87); [HEARTHOME CITY DP GYM LEADER ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_dp_gym_leader_room.s#L45); [HEARTHOME CITY GYM LEADER ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_gym_leader_room.s#L58); [OREBURGH CITY GYM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_gym.s#L15); [PASTORIA CITY GYM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L47); [POKEMON LEAGUE AARON ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_aaron_room.s#L42); [POKEMON LEAGUE BERTHA ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_bertha_room.s#L42); [POKEMON LEAGUE CHAMPION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_champion_room.s#L71); [POKEMON LEAGUE FLINT ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_flint_room.s#L44); [POKEMON LEAGUE LUCIAN ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_lucian_room.s#L42); [SNOWPOINT CITY GYM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_gym.s#L24); [SUNYSHORE CITY GYM ROOM 3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L30); [VEILSTONE CITY GYM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_gym.s#L23); [visible items (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_visible_items.s#L2392).

**Coverage:** 49 ROM-wide instruction sites; zone-root maps: [R11](#reach-r11) (164 maps).

**Decomp:** Creates and saves a supported location event for activities, obtained items, field moves or facilities.\
Only one parameter is used; unsupported event IDs return without recording, so call labels alone do not prove gym/Elite Four event support. [src/scrcmd.c:5023–5070](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5023-L5070)

**Dependencies:** New journal pages/event persistence and event mapping; existing flags, clock and text.\
**Effort:** 0.5–1 d

### `give_journal` — `0x1CC`

**Story / impact:** P1 — Mom gives the Journal during the early Twinleaf departure sequence; presentation/state bookkeeping, not a later progression gate.

**Native maps/callers:** [TWINLEAF TOWN PLAYER HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_twinleaf_town_player_house_1f.s#L264).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `TWINLEAF_TOWN_PLAYER_HOUSE_1F`.

**Decomp:** Sets the journal-acquired system flag and attaches a saved journal page to the field.\
Creates its title from the current map header and saves it to that page; no Bag item is granted. [src/scrcmd.c:5012–5021](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5012-L5021); [src/field_map_change.c:417–423](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/field_map_change.c#L417-L423)

**Dependencies:** New journal pages/event persistence and event mapping; existing flags, clock and text.\
**Effort:** 0.5 d; journal page/event/save foundation 3–5 d

<a id="system-13"></a>

## Field poison survival

### `survive_poison` — `0x1F7`

**Story / impact:** P1 — Shared field-poison survival script during ordinary travel; affects party health, no named story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L316).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Checks whether the chosen Pokémon is poisoned/toxic and at exactly 1 HP.\
Cures its status and returns true in that case, otherwise returns false. [src/scrcmd_party.c:168–176](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L168-L176); [src/unk_02054884.c:215–226](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_02054884.c#L215-L226)

**Dependencies:** Existing party HP/status and field-poison step handling; wire boolean/script dialogue.\
**Effort:** 0.25–0.5 d

### `black_out_from_battle2` — `0x14B`

**Story / impact:** P2 — Shared poison-whiteout recovery branch; a failure/recovery path, not a mandatory Champion-route event.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L346).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Starts the dedicated blackout field task used by the poison-whiteout common script.\
The task controls recovery/return to the field; the script yields and receives no direct result. [src/scrcmd.c:4483–4487](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4483-L4487)

**Dependencies:** Existing blackout/healing/respawn host plus poison step damage and field-task transition.\
**Effort:** 0.5–1 d

<a id="system-14"></a>

## Script text and input

### `wait_ab_press_time` — `0x190`

**Story / impact:** P1 — Common save result acknowledgment; optional wireless and Battle Tower messages also use it.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L620); [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L424); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L313); [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L187).

**Coverage:** 7 ROM-wide instruction sites; zone-root maps: [R10](#reach-r10) (47 maps).

**Decomp:** Pauses until a newly pressed A/B or the specified callback countdown reaches zero.\
Each callback decrements the stored counter when no A/B edge is present; D-pad/X/touch are not accepted by this wait. [src/scrcmd.c:1400–1405](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1400-L1405); [src/scrcmd.c:1407–1416](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1407-L1416)

**Dependencies:** Existing input edges and deterministic VM timers; preserve 16-bit counter semantics.\
**Effort:** 0.25–0.5 person-day

### `buffer_trainer_class_from_appearance` — `0x0D9`

**Story / impact:** P2 — Oreburgh Pokémon Center appearance/class conversation; optional NPC dialogue.

**Native maps/callers:** [OREBURGH CITY POKECENTER 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_pokecenter_1f.s#L37).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `OREBURGH_CITY_POKECENTER_1F`.

**Decomp:** Derives a trainer class from the player’s gender and saved communication appearance.\
Buffers that class name with grammatical article into a template slot; no message or menu opens. [src/scrcmd_strings.c:240–251](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L240-L251)

**Dependencies:** Trainer profile appearance data, gender/appearance-to-class mapping, article-aware localized class-name template helper.\
**Effort:** 0.5–1 person-day

### `message_from_bank` — `0x1FB`

**Story / impact:** P2 — TV broadcasts/interviews and Mystery Gift delivery dialogue; optional; external gift acquisition is out of scope.

**Native maps/callers:** [mystery gift deliveryman (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_mystery_gift_deliveryman.s#L55); [tv broadcast (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_tv_broadcast.s#L24); [tv reporter interviews (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_tv_reporter_interviews.s#L119).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: [R12](#reach-r12) (25 maps).

**Decomp:** Loads a variable-selected bank and message and prints it through the normal skippable field-message path.\
Releases its temporary bank loader and pauses until the text printer has finished. [src/scrcmd.c:1209–1221](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1209-L1221)

**Dependencies:** Existing message printer/bank registry; access to non-current-map TV and gift banks.\
**Effort:** 0.25–0.5 person-day

### `buffer_mon_nickname_from_pc` — `0x251`

**Story / impact:** P2 — Jubilife TV 1F lottery dialogue naming a boxed Pokémon; optional.

**Native maps/callers:** [JUBILIFE TV 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_1f.s#L86).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `JUBILIFE_TV_1F`.

**Decomp:** Treats the given index as a flat PC-box slot: divides by box capacity to select the box and takes the remainder for its slot.\
Buffers that boxed Pokémon’s nickname in the requested template slot; it does not move the Pokémon. [src/scrcmd_strings.c:202–216](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L202-L216)

**Dependencies:** Existing PC storage and nickname/template services; preserve index units used by lottery result.\
**Effort:** 0.25–0.5 person-day

### `message_unown` — `0x26D`

**Story / impact:** P2 — Solaceon Ruins wall inscriptions and Maniac Tunnel chamber; optional.

**Native maps/callers:** [SOLACEON RUINS MANIAC TUNNEL ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_ruins_maniac_tunnel_room.s#L11); [SOLACEON RUINS ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_ruins_room_1.s#L16); [SOLACEON RUINS ROOM 7](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_ruins_room_7.s#L11).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `SOLACEON_RUINS_MANIAC_TUNNEL_ROOM`, `SOLACEON_RUINS_ROOM_1`, `SOLACEON_RUINS_ROOM_7`.

**Decomp:** Prints a literal current-bank message using the Unown font, with manual speed-up disabled.\
Pauses until the text printer completes; this changes the message font rather than spawning Unown Pokémon. [src/scrcmd.c:1289–1301](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1289-L1301)

**Dependencies:** Existing message system; imported Unown glyph/font resources and per-message font selection.\
**Effort:** 0.5–1 person-day

### `show_list_menu_remember_cursor` — `0x306`

**Story / impact:** P2 — Veilstone prize exchange item list; also postgame Frontier records.

**Native maps/callers:** [battle frontier records (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier_records.s#L178); [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L94).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `BATTLE_HALL`, `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Shows the built list using caller-owned list-offset and cursor-position variables.\
Keeps the saved scroll/cursor state through interaction, pauses until menu selection, and resumes through the standard selection continuation. [src/scrcmd.c:1984–1995](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1984-L1995); [src/overlay005/field_menu.c:327–355](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/field_menu.c#L327-L355)

**Dependencies:** Existing script list-menu builder/results; scroll offset and cursor state round-trip.\
**Effort:** 0.5–1 person-day

### `message_no_skip` — `0x02E`

**Story / impact:** P3 — Wireless Colosseum and Frontier multi-challenge entry; no required story call.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L326); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L323); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L274); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L443); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L312).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: [R01](#reach-r01) (22 maps).

**Decomp:** Displays the selected current-bank message with A/B acceleration disabled.\
Pauses the script until text printing finishes; closing/acknowledgment remains a separate command. [src/scrcmd.c:1346–1354](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1346-L1354)

**Dependencies:** Existing message window, message-bank lookup, printer completion; add per-message speed-up permission.\
**Effort:** 0.25–0.5 person-day

### `show_list_menu_set_width` — `0x327`

**Story / impact:** P3 — Battle Hall selection and Villa furniture list; optional postgame.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L287); [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L1163).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `BATTLE_HALL`, `VILLA`.

**Decomp:** Shows the currently built script list menu with a script-provided explicit width.\
Pauses until the normal selection/cancel continuation completes; it does not rebuild the entries. [src/scrcmd.c:1972–1982](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1972-L1982); [src/overlay005/field_menu.c:303–325](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/field_menu.c#L303-L325)

**Dependencies:** Existing script list menus; explicit width/single-screen sizing policy and imported UI units.\
**Effort:** 0.25–0.5 person-day

### `scroll_bg3` — `0x03D`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads independent X/Y step sizes, iteration counts, and direction selectors for the main BG3 layer.\
Each wait callback applies configured offsets and reduces nonzero counts; the script resumes only when both counts are zero. [src/scrcmd.c:1500–1520](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1500-L1520); [src/scrcmd.c:1522–1563](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1522-L1563)

**Dependencies:** Layer-scrolling renderer primitive and deterministic frame wait; no existing story demand.\
**Effort:** 0.5–1 person-day

### `buffer_trainer_class_name` — `0x0D8`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves a trainer-class ID and writes its localized class name into the requested string-template slot.\
Completes synchronously without displaying a message or changing trainer state. [src/scrcmd_strings.c:229–238](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L229-L238)

**Dependencies:** Existing template engine; imported trainer-class name bank.\
**Effort:** 0.25–0.5 person-day

### `buffer_player_counterpart_starter_species_name` — `0x0DD`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the saved counterpart-starter species and resolves its localized species name.\
Stores it in the requested message-template slot, then returns synchronously. [src/scrcmd_strings.c:304–315](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L304-L315)

**Dependencies:** Existing species-name/template service and saved counterpart-starter selection.\
**Effort:** 0.25 person-day

### `message_from_bank_instant` — `0x1FA`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Loads the supplied text bank and message, renders it instantly, then releases the temporary loader.\
Returns synchronously with the message window active; acknowledgment/closing are separate. [src/scrcmd.c:1196–1207](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1196-L1207)

**Dependencies:** Existing imported text banks, string templates and instant message rendering.\
**Effort:** 0.25–0.5 person-day

### `message_auto_scroll` — `0x2C0`

**Story / impact:** P4 — Only Union Room dialogue; wireless is out of scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L51).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Prints a variable-selected current-bank message with automatic scrolling enabled and ordinary manual speed-up allowed.\
Pauses until printing ends; the message ID is narrowed to a byte by this command. [src/scrcmd.c:1331–1344](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1331-L1344)

**Dependencies:** Existing text printer plus auto-scroll behavior; wireless dialogue scope.\
**Effort:** 0.25–0.5 person-day

### `buffer_stat_name` — `0x2EF`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves a stat index and buffers the corresponding localized Pokémon stat name in a template slot.\
Returns synchronously without inspecting or changing any Pokémon stat value. [src/scrcmd_strings.c:35–44](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L35-L44)

**Dependencies:** Existing text templates and imported localized stat names.\
**Effort:** 0.25 person-day

<a id="system-15"></a>

## Trainer wireless appearance

### `load_trainer_appearances` — `0x154`

**Story / impact:** P2 — Optional Oreburgh Pokémon Center NPC changes the avatar/class shown to linked players (CP4).

**Native maps/callers:** [OREBURGH CITY POKECENTER 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_pokecenter_1f.s#L43).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `OREBURGH_CITY_POKECENTER_1F`.

**Decomp:** Calculates the gender/ID-specific trainer appearance choices and inserts their names into string-template slots.\
No appearance is committed here; this prepares the Oreburgh NPC’s choice menu. [src/scrcmd.c:4442–4449](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4442-L4449)

**Dependencies:** Saved trainer ID/gender/appearance, imported appearance-choice table, existing string templates.\
**Effort:** 0.25–0.5 d

### `get_trainer_info_trainer_class` — `0x155`

**Story / impact:** P2 — Optional Oreburgh Pokémon Center NPC changes the avatar/class shown to linked players (CP4).

**Native maps/callers:** [OREBURGH CITY POKECENTER 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_pokecenter_1f.s#L55).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `OREBURGH_CITY_POKECENTER_1F`.

**Decomp:** Maps a requested variant through the trainer ID/gender appearance choices to a trainer-class value.\
Writes that class ID to the destination synchronously; does not alter the saved appearance. [src/scrcmd.c:4451–4461](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4451-L4461)

**Dependencies:** Saved trainer ID/gender/appearance, imported appearance-choice table, existing string templates.\
**Effort:** 0.25–0.5 d

### `set_trainer_info_appearance` — `0x156`

**Story / impact:** P2 — Optional Oreburgh Pokémon Center NPC changes the avatar/class shown to linked players (CP4).

**Native maps/callers:** [OREBURGH CITY POKECENTER 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_pokecenter_1f.s#L75).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `OREBURGH_CITY_POKECENTER_1F`.

**Decomp:** Writes the supplied appearance index into the saved trainer profile.\
It does not recalculate the choice or update a live field actor itself. [src/scrcmd.c:4474–4481](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4474-L4481)

**Dependencies:** Saved trainer ID/gender/appearance, imported appearance-choice table, existing string templates.\
**Effort:** 0.25–0.5 d

### `calculate_trainer_info_appearance` — `0x29C`

**Story / impact:** P2 — Optional Oreburgh Pokémon Center NPC changes the avatar/class shown to linked players (CP4).

**Native maps/callers:** [OREBURGH CITY POKECENTER 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_pokecenter_1f.s#L74).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `OREBURGH_CITY_POKECENTER_1F`.

**Decomp:** Calculates the saved trainer ID/gender’s appearance index for the requested variant.\
Returns the index synchronously; a separate setter commits it. [src/scrcmd.c:4463–4472](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4463-L4472)

**Dependencies:** Saved trainer ID/gender/appearance, imported appearance-choice table, existing string templates.\
**Effort:** 0.25–0.5 d

<a id="system-16"></a>

## Television and interviews

### `scr_cmd_2b8` — `0x2B8`

**Story / impact:** P2 — Optional Eterna Condominiums nickname change service (CP6).

**Native maps/callers:** [ETERNA CITY CONDOMINIUMS 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_condominiums_1f.s#L78).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ETERNA_CITY_CONDOMINIUMS_1F`.

**Decomp:** Records the selected party Pokémon’s new nickname as a Rate That Name Change TV segment.\
Returns immediately; it does not perform the nickname edit itself. [src/scrcmd_tv_broadcast.c:116–123](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L116-L123); [src/scrcmd_tv_broadcast.c:116–122](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L116-L122)

**Dependencies:** Existing nickname result and Pokémon metadata plus saved TV segment queue.\
**Effort:** 0.5–1 d; shared TV foundation 5–8 d

### `scr_cmd_27c` — `0x27C`

**Story / impact:** P2 — Optional Amity Square walking and follower pickup broadcasts (Hearthome, CP7).

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L204).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Records the Amity Square follower Pokémon’s identity, nickname and nature for a TV segment.\
Other selectors record whether its pickup was an accessory or an item and the associated ID; saved TV checksum is refreshed. [src/scrcmd_tv_broadcast.c:188–208](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L188-L208); [src/tv_segment.c:539–572](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/tv_segment.c#L539-L572)

**Dependencies:** New saved TV program/segment queue, eligibility rules, message-bank/template routing and game records.\
**Effort:** 0.5–1 d; shared TV foundation 5–8 d

### `call_tv_broadcast` — `0x235`

**Story / impact:** P2 — Optional TV broadcasts and reporter interviews encountered across the journey.

**Native maps/callers:** [tv broadcast (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_tv_broadcast.s#L12).

**Coverage:** 10 ROM-wide instruction sites; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Dispatches TV scheduling/status, framing/commercial message lookup, segment loading and next-segment selection.\
Returns message-bank/message IDs and fills templates as needed; finishing marks the program consumed, without an app wait. [src/scrcmd_tv_broadcast.c:60–108](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L60-L108)

**Dependencies:** New saved TV program/segment queue, eligibility rules, message-bank/template routing and game records.\
**Effort:** 2–4 d after TV foundation

### `save_tv_segment_hidden_item` — `0x236`

**Story / impact:** P2 — Incidental news recording during hidden-item or PC use; no story gate.

**Native maps/callers:** [hidden items (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hidden_items.s#L22).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R14](#reach-r14) (99 maps).

**Decomp:** Saves a hidden-item news segment containing the item and current map label.\
Records a later broadcast candidate immediately; does not display TV or grant the item. [src/scrcmd_tv_broadcast.c:110–114](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L110-L114); [src/tv_segment.c:873–882](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/tv_segment.c#L873-L882)

**Dependencies:** New saved TV episode queue and segment payloads; existing party/items/map labels.\
**Effort:** 0.25–0.5 d

### `call_tv_interview` — `0x237`

**Story / impact:** P2 — Optional TV broadcasts and reporter interviews encountered across the journey.

**Native maps/callers:** [tv reporter interviews (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_tv_reporter_interviews.s#L118).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_FRONTIER`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_WEST_HOUSE`, `CONTEST_HALL_LOBBY`, `HEARTHOME_CITY_EAST_GATE_TO_AMITY_SQUARE`, `HEARTHOME_CITY_POKEMON_FAN_CLUB`, `HEARTHOME_CITY_WEST_GATE_TO_AMITY_SQUARE`, `JUBILIFE_TV_2F`, `POFFIN_HOUSE`, `POKETCH_CO_1F`, `ROUTE_214_GATE_TO_VEILSTONE_CITY`.

**Decomp:** Loads a reporter interview prompt or saves the chosen Easy Chat response for a segment.\
Saving records the response and increments trainer score for giving an interview; operations are synchronous. [src/scrcmd_tv_broadcast.c:147–174](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L147-L174)

**Dependencies:** Saved interview/TV segment schemas, Easy Chat words, segment-specific eligibility/data and game-record score.\
**Effort:** 0.5–1 d; shared TV foundation 5–8 d

### `check_tv_interview_eligible` — `0x238`

**Story / impact:** P2 — Optional TV broadcasts and reporter interviews encountered across the journey.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L28); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L25); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L24); [BATTLE FRONTIER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier.s#L48); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L100); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L38); [CANALAVE CITY WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_west_house.s#L9); [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L147); [HEARTHOME CITY EAST GATE TO AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_east_gate_to_amity_square.s#L11); [HEARTHOME CITY POKEMON FAN CLUB](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_pokemon_fan_club.s#L14); [HEARTHOME CITY WEST GATE TO AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_west_gate_to_amity_square.s#L12); [JUBILIFE TV 2F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f.s#L12); [POFFIN HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poffin_house.s#L15); [POKETCH CO 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poketch_co_1f.s#L14); [ROUTE 214 GATE TO VEILSTONE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_214_gate_to_veilstone_city.s#L11); [tv reporter interviews (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_tv_reporter_interviews.s#L109).

**Coverage:** 22 ROM-wide instruction sites; zone-root maps: [R15](#reach-r15) (15 maps).

**Decomp:** Tests the requested TV interview segment’s eligibility against current field/save state.\
Returns the eligibility result; it does not start an interview or place the reporter. [src/scrcmd_tv_broadcast.c:176–186](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L176-L186)

**Dependencies:** New saved TV program/segment queue, eligibility rules, message-bank/template routing and game records.\
**Effort:** 0.5–1 d; shared TV foundation 5–8 d

### `save_tv_segment_pokemon_storage_bulletin` — `0x30B`

**Story / impact:** P2 — Incidental news recording during hidden-item or PC use; no story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1043).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** When all non-egg party Pokémon are exclusively male or exclusively female, saves a bulletin about the first hatched party Pokémon.\
Mixed-gender or genderless parties produce no segment; PC boxes are not inspected. [src/scrcmd_tv_broadcast.c:125–129](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L125-L129); [src/tv_segment.c:1041–1082](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/tv_segment.c#L1041-L1082)

**Dependencies:** New saved TV episode queue and segment payloads; existing party/items/map labels.\
**Effort:** 0.25–0.5 d

### `save_tv_segment_home_and_manor_no_furniture` — `0x30C`

**Story / impact:** P3 — Resort Area Villa ownership interview; optional postgame.

**Native maps/callers:** [RESORT AREA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_resort_area.s#L114).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `RESORT_AREA`.

**Decomp:** Records the no-furniture variant of the Home and Manor TV segment.\
Updates saved TV broadcast data synchronously; it does not play a broadcast or buy furniture. [src/scrcmd_tv_broadcast.c:131–135](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L131-L135); [src/tv_segment.c:1239–1257](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/tv_segment.c#L1239-L1257)

**Dependencies:** Saved TV segment queue/schema, player/profile details and broadcast eligibility; Villa acquisition script state.\
**Effort:** 0.5–1 person-day after TV-record foundation

### `save_tv_segment_home_and_manor` — `0x30D`

**Story / impact:** P3 — Villa furniture purchase/interview segment; optional postgame.

**Native maps/callers:** [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L1191).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VILLA`.

**Decomp:** Resolves a furniture ID and records the corresponding Home and Manor TV segment.\
Returns synchronously; purchase logic, decoration placement and eventual broadcast are separate. [src/scrcmd_tv_broadcast.c:137–143](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L137-L143); [src/tv_segment.c:1260–1277](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/tv_segment.c#L1260-L1277)

**Dependencies:** Saved TV segment schema, furniture identifiers and Villa ownership data.\
**Effort:** 0.5–1 person-day after shared TV-record foundation

### `get_battle_frontier_reporter_position` — `0x329`

**Story / impact:** P3 — Optional postgame Battle Frontier reporter placement on map transition.

**Native maps/callers:** [BATTLE FRONTIER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier.s#L50).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Reads the Frontier TV reporter’s saved category and selects one of five fixed position/facing configurations.\
Writes X/Z, direction and movement type; unknown/default category uses the Tower-side location. [src/scrcmd_tv_broadcast.c:482–530](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L482-L530)

**Dependencies:** Saved Frontier TV category and existing actor placement/movement-type primitives.\
**Effort:** 0.25–0.5 d

<a id="system-17"></a>

## Daily events and swarms

### `start_vs_seeker` — `0x20A`

**Story / impact:** P2 — Optional key-item rematches after receiving the Vs. Seeker (CP7); repeated field use.

**Native maps/callers:** [vs seeker (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_vs_seeker.s#L10).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Starts the Vs. Seeker field task with string templates and an output variable.\
The task drives rematch scanning/charge feedback and writes its result before returning. [src/scrcmd.c:3072–3079](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3072-L3079)

**Dependencies:** Existing Vs. Seeker field-item implementation, rematch tables/flags and charge state; bridge the script task entry.\
**Effort:** 0.5–1 d

**Caveat:** Classifier stub is a script-command gap; existing item-use support does not prove this wrapper is real.

### `set_news_press_deadline` — `0x219`

**Story / impact:** P2 — Optional Solaceon News Press requested-Pokémon errand (CP8).

**Native maps/callers:** [SOLACEON TOWN POKEMON NEWS PRESS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_town_pokemon_news_press.s#L33).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SOLACEON_TOWN_POKEMON_NEWS_PRESS`.

**Decomp:** Stores the requested Pokémon News Press deadline in days in system variables.\
Synchronous setter only; the daily rollover system is responsible for decrementing it. [src/scrcmd.c:5388–5393](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5388-L5393)

**Dependencies:** Existing game clock and variables; daily-event state and imported swarm table.\
**Effort:** 0.25–0.5 d

### `get_news_press_deadline` — `0x21A`

**Story / impact:** P2 — Optional Solaceon News Press delivery and overdue checks (CP8).

**Native maps/callers:** [SOLACEON TOWN POKEMON NEWS PRESS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_town_pokemon_news_press.s#L43).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `SOLACEON_TOWN_POKEMON_NEWS_PRESS`.

**Decomp:** Reads the remaining News Press deadline from saved system variables.\
Returns the day count; it does not advance time or select a requested Pokémon. [src/scrcmd.c:5395–5400](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5395-L5400)

**Dependencies:** Existing game clock and variables; daily-event state and imported swarm table.\
**Effort:** 0.25–0.5 d

### `get_swarm_map_and_species` — `0x0E3`

**Story / impact:** P3 — Post-National-Dex announcement from the counterpart’s sister in Sandgem.

**Native maps/callers:** [SANDGEM TOWN COUNTERPART HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sandgem_town_counterpart_house_1f.s#L72).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SANDGEM_TOWN_COUNTERPART_HOUSE_1F`.

**Decomp:** Reads the saved daily swarm index and resolves it to the corresponding map ID and species.\
Writes both destination variables synchronously; does not enable swarms or create an encounter. [src/scrcmd.c:3767–3775](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3767-L3775)

**Dependencies:** Existing game clock and variables; daily-event state and imported swarm table.\
**Effort:** 0.25–0.5 d

### `enable_swarms` — `0x21B`

**Story / impact:** P3 — Optional Sandgem counterpart-house dialogue after obtaining the National Dex.

**Native maps/callers:** [SANDGEM TOWN COUNTERPART HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sandgem_town_counterpart_house_1f.s#L62).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SANDGEM_TOWN_COUNTERPART_HOUSE_1F`.

**Decomp:** Enables the swarm feature in the saved special-encounter state.\
Returns synchronously; choosing/advancing the day’s swarm belongs to the daily encounter system. [src/scrcmd.c:5402–5407](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5402-L5407)

**Dependencies:** Existing game clock and variables; daily-event state and imported swarm table.\
**Effort:** 0.25–0.5 d

<a id="system-18"></a>

## Department Store rewards

### `check_is_department_store_regular` — `0x27E`

**Story / impact:** P2 — Optional Veilstone Department Store regular-customer attendant dialogue/rewards (CP8).

**Native maps/callers:** [VEILSTONE STORE 2F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_store_2f.s#L20); [VEILSTONE STORE 3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_store_3f.s#L19); [VEILSTONE STORE 4F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_store_4f.s#L19).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `VEILSTONE_STORE_2F`, `VEILSTONE_STORE_3F`, `VEILSTONE_STORE_4F`.

**Decomp:** Tests whether the saved Department Store purchase counter has reached five.\
Returns a boolean; it does not increment the counter or award the attendant’s reward. [src/scrcmd.c:6047–6059](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6047-L6059)

**Dependencies:** Saved store-specific purchase count wired to successful mart purchases; existing variables.\
**Effort:** 0.25–0.5 d

<a id="system-19"></a>

## Game Corner

### `scr_cmd_267` — `0x267`

**Story / impact:** P2 — Optional Veilstone Game Corner play and prize exchange (CP8).

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L88).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GAME_CORNER`.

**Decomp:** Starts the selected slot machine with saved coins, machine difficulty/context and user options.\
The task updates resulting coins and bonus-round record, with elapsed-time/game-record accounting, then returns to the field. [src/scrcmd.c:5824–5830](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5824-L5830); [src/unk_0203D1B8.c:1470–1550](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1470-L1550)

**Dependencies:** New slot-machine app/rules and bonus streak save; existing coins, bag and menu hosts.\
**Effort:** 4–7 d; new slots app foundation included

### `get_game_corner_prize_data` — `0x2A6`

**Story / impact:** P2 — Optional Veilstone Game Corner play and prize exchange (CP8).

**Native maps/callers:** [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L28).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Looks up the indexed Game Corner prize definition.\
Writes its item ID and coin cost to the two destinations; it neither charges coins nor grants the item. [src/scrcmd_game_corner_prize.c:16–48](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_game_corner_prize.c#L16-L48)

**Dependencies:** Imported 19-entry prize table, existing item IDs/coin store and script variables.\
**Effort:** 0.25–0.5 d

### `show_coins` — `0x075`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L124); [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L17).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `GAME_CORNER`, `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Creates the special-currency window at script-supplied tile coordinates.\
Displays the current saved coin count and retains a window handle. [src/scrcmd_coins.c:19–28](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L19-L28)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.5 d; shared coin state/window 1–2 d

### `hide_coins` — `0x076`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L174); [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L49).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `GAME_CORNER`, `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Deletes the retained special-currency window.\
Immediate UI cleanup; does not change coins. [src/scrcmd_coins.c:30–37](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L30-L37)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `update_coin_display` — `0x077`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L148); [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L39).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `GAME_CORNER`, `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Reprints the current balance into the existing coin window.\
Immediate refresh after purchases, gifts or prize exchange. [src/scrcmd_coins.c:39–46](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L39-L46)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `add_coins` — `0x079`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L147).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `GAME_CORNER`.

**Decomp:** Adds the resolved amount through the coin-balance helper.\
Changes saved coins immediately; window refresh is separate. [src/scrcmd_coins.c:59–68](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L59-L68)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `subtract_coins_from_value` — `0x07A`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L38).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Subtracts a resolved amount from saved coins.\
Does not return a status; affordability is checked by the caller. [src/scrcmd_coins.c:70–80](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L70-L80)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `has_coins_from_value` — `0x274`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L33).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Compares the saved balance with a literal 32-bit price.\
Writes whether the balance is sufficient without spending coins. [src/scrcmd_coins.c:95–112](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L95-L112)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `check_bonus_round_streak` — `0x275`

**Story / impact:** P2 — Optional Veilstone coins-clerk bonus reward condition.

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L111).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GAME_CORNER`.

**Decomp:** Checks whether the saved best consecutive slot bonus-round win count is at least ten.\
Returns a boolean synchronously; the slot-machine task is responsible for updating the count. [src/scrcmd.c:5963–5975](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5963-L5975)

**Dependencies:** New slot-machine app/rules and bonus streak save; existing coins, bag and menu hosts.\
**Effort:** 0.5–1 d; shared slots foundation 5–8 d

### `check_can_add_coins` — `0x276`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [GAME CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_game_corner.s#L140).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `GAME_CORNER`.

**Decomp:** Tests whether adding the requested amount would fit the coin-balance limit.\
Writes a boolean; no coins change. [src/scrcmd_coins.c:134–144](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L134-L144)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `subtract_coins_from_var` — `0x2A8`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L38).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Reads the debit amount from a variable pointer and subtracts it from saved coins.\
Immediate balance change; separate affordability checks precede the debit. [src/scrcmd_coins.c:82–93](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L82-L93)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `has_coins_from_var` — `0x2A9`

**Story / impact:** P2 — Optional Veilstone Game Corner coin purchases, gifts and prize exchange.

**Native maps/callers:** [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L33).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Reads a variable-held price and compares it with saved coins.\
Writes a sufficiency boolean without spending. [src/scrcmd_coins.c:114–132](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L114-L132)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

### `get_coins_amount` — `0x078`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the saved coin balance.\
Writes that amount to the output variable immediately. [src/scrcmd_coins.c:48–57](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_coins.c#L48-L57)

**Dependencies:** Existing Bag/menu/money services; new persisted coin balance and coin window.\
**Effort:** 0.25 d

<a id="system-20"></a>

## Great Marsh

### `start_end_safari_game` — `0x202`

**Story / impact:** P2 — Optional Great Marsh safari admission, retirement and results near Pastoria (CP9).

**Native maps/callers:** [PASTORIA CITY OBSERVATORY GATE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L68); [safari game (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L48).

**Coverage:** 7 ROM-wide instruction sites; zone-root maps: `PASTORIA_CITY_OBSERVATORY_GATE_1F`.

**Decomp:** Starting a safari sets its active flag, resets TV capture data and gives 30 Safari Balls with zero steps used.\
Ending clears the flag, records TV/journal results and zeros balls/steps; it does not warp by itself. [src/scrcmd.c:5277–5306](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5277-L5306)

**Dependencies:** New safari session, ball/step counters, safari battle rules, capture counters; existing journal and TV hooks.\
**Effort:** 0.5–1 d; shared safari foundation 4–7 d

### `get_current_safari_game_caught_num` — `0x31B`

**Story / impact:** P2 — Optional Great Marsh safari admission, retirement and results near Pastoria (CP9).

**Native maps/callers:** [PASTORIA CITY OBSERVATORY GATE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L155).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `PASTORIA_CITY_OBSERVATORY_GATE_1F`.

**Decomp:** Reads the current safari session’s number of Pokémon caught from saved TV/safari data.\
Returns the count synchronously; ending the session and displaying results are separate commands. [src/scrcmd_tv_broadcast.c:469–480](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L469-L480)

**Dependencies:** New safari session, ball/step counters, safari battle rules, capture counters; existing journal and TV hooks.\
**Effort:** 0.5–1 d; shared safari foundation 4–7 d

### `start_great_marsh_lookout` — `0x206`

**Story / impact:** P2 — Pastoria observatory paid binocular lookout; optional.

**Native maps/callers:** [PASTORIA CITY OBSERVATORY GATE 2F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L31).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PASTORIA_CITY_OBSERVATORY_GATE_2F`.

**Decomp:** Starts a temporary field-map tour through the selected Great Marsh viewing locations, hiding the player and Pokétch while showing encountered Pokémon sprites.\
Each view advances after its timer or A input, then restores the observatory map and player; the task retains control throughout. [src/scrcmd.c:5308–5312](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5308-L5312); [src/great_marsh_lookout.c:39–136](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/great_marsh_lookout.c#L39-L136)

**Dependencies:** Great Marsh encounter/view selection, temporary map transitions, camera/mask/sprite resources; existing encounter data and field tasks.\
**Effort:** 3–5 person-days shared lookout presentation foundation

### `init_great_marsh_tram` — `0x20E`

**Story / impact:** P2 — Safari-game initialization; optional Great Marsh activity.

**Native maps/callers:** [safari game (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L33).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GREAT_MARSH_1`, `GREAT_MARSH_2`, `GREAT_MARSH_3`, `GREAT_MARSH_4`, `GREAT_MARSH_5`, `GREAT_MARSH_6`.

**Decomp:** Selects the Great Marsh persisted-feature buffer.\
Only when switching from another dynamic-map feature, initializes the tram at the Area 5/6 stop; revisiting preserves its prior stop. [src/scrcmd.c:5323–5327](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5323-L5327); [src/persisted_map_features_init.c:165–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L165-L175)

**Dependencies:** Existing persisted features/save seam; Great Marsh tram-location state.\
**Effort:** 0.25–0.5 person-day after tram foundation

### `move_great_marsh_tram` — `0x20F`

**Story / impact:** P2 — Safari tram travel between Great Marsh areas; optional.

**Native maps/callers:** [safari game (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L286).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `GREAT_MARSH_1`, `GREAT_MARSH_2`, `GREAT_MARSH_3`, `GREAT_MARSH_4`, `GREAT_MARSH_5`, `GREAT_MARSH_6`.

**Decomp:** Resolves a destination stop and movement mode, selecting call-the-tram or ride-the-tram behavior and updating its persisted stop.\
Loads the train sound sub-scene and runs the asynchronous travel task with direction and slowdown appropriate to the current and destination stops. [src/scrcmd.c:5329–5338](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5329-L5338); [src/overlay006/great_marsh_tram.c:115–179](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/great_marsh_tram.c#L115-L179)

**Dependencies:** Tram model/route and stop tables, passenger attachment, collision and persisted stop; existing audio and movement tasks.\
**Effort:** 3–5 person-days shared tram foundation

### `check_great_marsh_tram_location` — `0x210`

**Story / impact:** P2 — Safari-game tram boarding/stop selection; optional.

**Native maps/callers:** [safari game (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L124).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `GREAT_MARSH_1`, `GREAT_MARSH_2`, `GREAT_MARSH_3`, `GREAT_MARSH_4`, `GREAT_MARSH_5`, `GREAT_MARSH_6`.

**Decomp:** Compares the persisted tram stop with the literal requested stop.\
Writes the location-result enum: 5 when at that stop and 6 otherwise, rather than an ordinary boolean; returns synchronously. [src/scrcmd.c:5340–5347](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5340-L5347); [src/overlay006/great_marsh_tram.c:181–193](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/great_marsh_tram.c#L181-L193); [include/constants/great_marsh_tram.h:4–10](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/constants/great_marsh_tram.h#L4-L10)

**Dependencies:** Shared persisted tram location and stop identifiers.\
**Effort:** 0.25 person-day after tram state

<a id="system-21"></a>

## Amity Square

### `clear_amity_square_step_count` — `0x215`

**Story / impact:** P2 — Amity Square follower item-retrieval cycle; optional.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L202).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Clears the saved Amity Square step counter through the system-variable helper.\
Returns synchronously without changing the follower or generating an item. [src/scrcmd_amity_square.c:15–19](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_amity_square.c#L15-L19)

**Dependencies:** Saved Amity step count and field-step producer; existing follower service.\
**Effort:** 0.25–0.5 person-day

### `get_amity_square_step_count` — `0x216`

**Story / impact:** P2 — Amity Square companion reward eligibility; optional.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L912).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Copies the saved Amity Square step count into a script variable.\
Does not increment or reset the count; the script owns threshold/reward logic. [src/scrcmd_amity_square.c:21–26](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_amity_square.c#L21-L26)

**Dependencies:** Same persisted step counter and per-step update producer as clear operation.\
**Effort:** 0.25 person-day after shared counter

### `calc_amity_square_found_accessory` — `0x217`

**Story / impact:** P2 — Optional Amity Square follower pickups and random gift man.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L286).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Rolls a weighted accessory slot and chooses the pool by follower species group.\
Writes the accessory ID without granting it; the script handles the later pickup. [src/scrcmd_amity_square.c:75–146](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_amity_square.c#L75-L146)

**Dependencies:** Existing RNG/species/follower steps; new gift tables plus Fashion Case capacity.\
**Effort:** 0.5 d

### `calc_amity_square_berry_and_accessory_man_option_id` — `0x2DF`

**Story / impact:** P2 — Optional Amity Square follower pickups and random gift man.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L64).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Rolls an index into the Amity Square gift man’s option table.\
Writes the option index, not the item/accessory ID; performed on transition. [src/scrcmd_amity_square.c:167–173](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_amity_square.c#L167-L173)

**Dependencies:** Existing RNG/species/follower steps; new gift tables plus Fashion Case capacity.\
**Effort:** 0.25–0.5 d

### `check_amity_square_man_gift_is_accessory` — `0x2E0`

**Story / impact:** P2 — Optional Amity Square follower pickups and random gift man.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L924).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Classifies the gift-man option index as a berry below 9 or accessory from 9 upward.\
Writes a boolean immediately; no gift is granted. [src/scrcmd_amity_square.c:175–187](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_amity_square.c#L175-L187)

**Dependencies:** Existing RNG/species/follower steps; new gift tables plus Fashion Case capacity.\
**Effort:** 0.25–0.5 d

### `get_amity_square_berry_or_accessory_id_from_man` — `0x2E1`

**Story / impact:** P2 — Optional Amity Square follower pickups and random gift man.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L923).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Looks up a gift-man option index in the berry/accessory table.\
Writes the resulting item/accessory ID for the script to grant. [src/scrcmd_amity_square.c:189–196](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_amity_square.c#L189-L196)

**Dependencies:** Existing RNG/species/follower steps; new gift tables plus Fashion Case capacity.\
**Effort:** 0.25–0.5 d

### `scr_cmd_338` — `0x338`

**Story / impact:** P2 — Amity Square warp staging for the companion; optional.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L1121).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Looks up local object 15 and chooses a height from its X coordinate (28, 38, 40, 48, or a default).\
Sets its forced-height flag and adjusts world/grid height, refreshing the billboard so the companion remains aligned during the scene; a missing object is ignored. [src/overlay005/ov5_021F6454.c:1037–1062](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L1037-L1062); [src/overlay005/ov5_021F6454.c:975–992](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L975-L992)

**Dependencies:** Existing companion/local object lookup, forced Y positioning and billboard refresh; preserve mapping as behavioral constants.\
**Effort:** 0.5–1 person-day shared with scr_cmd_339

### `scr_cmd_339` — `0x339`

**Story / impact:** P2 — Amity Square warp cleanup for the companion; optional.

**Native maps/callers:** [AMITY SQUARE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_amity_square.s#L1162).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `AMITY_SQUARE`.

**Decomp:** Looks up local object 15 and clears status bit 8192, the forced-height flag used by the matching setup.\
Returns synchronously and ignores a missing companion; it does not delete or teleport the object. [src/overlay005/ov5_021F6454.c:1064–1071](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L1064-L1071)

**Dependencies:** Matching companion forced-height lifecycle and terrain-height recalculation.\
**Effort:** 0.25 person-day

<a id="system-22"></a>

## Berry patches

### `open_bag` — `0x178`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L240).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Opens a script Bag selection app restricted to items for zero, or berries otherwise.\
Waits for the app to close and retains its context for selected-item retrieval. [src/scrcmd.c:3418–3436](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3418-L3436); [src/unk_0203D1B8.c:290–313](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L290-L313)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.5 d

### `get_selected_item` — `0x179`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L244).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Returns the item selected by the preceding script Bag app.\
Frees its retained selection context; cancellation yields the app’s empty item ID. [src/scrcmd.c:3438–3450](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3438-L3450); [src/unk_0203D1B8.c:316–326](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L316-L326)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

### `get_berry_growth_stage` — `0x17D`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L19).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Reads the growth stage of the currently targeted berry patch.\
Writes the stage immediately; patch identity comes from the map object. [src/scrcmd_berry.c:18–27](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L18-L27)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25 d; shared growth/timer/import foundation 4–7 d

### `get_berry_item_id` — `0x17E`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L17).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Converts the targeted patch’s planted berry to its item ID.\
Writes the result immediately; does not remove or harvest it. [src/scrcmd_berry.c:29–36](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L29-L36)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

### `get_berry_mulch_type` — `0x17F`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L196).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Reads the targeted patch’s mulch and converts it to an item ID.\
Writes the current mulch item immediately. [src/scrcmd_berry.c:38–45](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L38-L45)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

### `get_berry_yield` — `0x181`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L18).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Reads the targeted patch’s current harvest yield.\
Writes the quantity immediately; inventory is unchanged. [src/scrcmd_berry.c:56–63](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L56-L63)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

### `set_berry_mulch` — `0x182`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L255).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Sets mulch for the targeted patch after converting the supplied item ID.\
Synchronous patch-state mutation; Bag removal is handled by the script. [src/scrcmd_berry.c:65–72](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L65-L72); [src/berry_patch_manager.c:167–172](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/berry_patch_manager.c#L167-L172)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

### `plant_berry` — `0x183`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L286).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Plants the supplied berry in the targeted patch using its species growth data.\
Also increments berries-planted records; Bag removal is handled outside this command. [src/scrcmd_berry.c:74–84](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L74-L84); [src/berry_patch_manager.c:174–180](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/berry_patch_manager.c#L174-L180)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

### `set_berry_watering_state` — `0x184`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L117).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Starts or ends the field’s berry-watering interaction according to the immediate mode.\
Yields after handing control to the watering state/task. [src/scrcmd_berry.c:86–100](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L86-L100)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.5–1 d

### `harvest_berry` — `0x185`

**Story / impact:** P2 — Optional shared berry-soil interactions across Sinnoh; no story gate.

**Native maps/callers:** [berry tree interaction (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_berry_tree_interaction.s#L149).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R09](#reach-r09) (30 maps).

**Decomp:** Harvests the targeted patch, updates its graphics and adds its yield to the Bag.\
Also records TV harvest data and trainer score; capacity is expected to have been checked by the caller. [src/scrcmd_berry.c:102–111](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L102-L111); [src/berry_patch_manager.c:151–165](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/berry_patch_manager.c#L151-L165)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.5–1 d

### `get_berry_moisture` — `0x180`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the targeted patch’s saved moisture value.\
Writes it immediately; does not water the soil. [src/scrcmd_berry.c:47–54](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_berry.c#L47-L54)

**Dependencies:** New patch identity/growth/moisture/mulch save state and clock rules; existing Bag/field/menu host.\
**Effort:** 0.25–0.5 d

<a id="system-23"></a>

## Chatot recording

### `check_recorded_chatot_cry_is_playable` — `0x059`

**Story / impact:** P2 — Optional Chatot Chatter field-move recording; no story gate.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L13).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Returns whether the saved Chatot sample can currently be played.\
Writes a boolean immediately; does not record or play the cry. [src/scrcmd_sound.c:164–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L164-L175)

**Dependencies:** Existing audio/party/VM; new microphone input, recorded-cry buffer and save data.\
**Effort:** 0.25–0.5 d

### `try_record_chatot_cry` — `0x05A`

**Story / impact:** P2 — Optional Chatot Chatter field-move recording; no story gate.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L28).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Starts microphone capture for a Chatot sample.\
Writes true only if recording starts successfully; capture continues after the command. [src/scrcmd_sound.c:177–188](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L177-L188)

**Dependencies:** Existing audio/party/VM; new microphone input, recorded-cry buffer and save data.\
**Effort:** 0.5–1 d; shared recording foundation 2–4 d

### `stop_recording_chatot_cry` — `0x05B`

**Story / impact:** P2 — Optional Chatot Chatter field-move recording; no story gate.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L34).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Stops the active Chatot microphone recording.\
Yields once; persistence is a separate command. [src/scrcmd_sound.c:190–194](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L190-L194)

**Dependencies:** Existing audio/party/VM; new microphone input, recorded-cry buffer and save data.\
**Effort:** 0.25–0.5 d

### `store_recorded_chatot_cry` — `0x05C`

**Story / impact:** P2 — Optional Chatot Chatter field-move recording; no story gate.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L36).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Copies the captured Chatot recording into its saved cry block.\
Yields once; later Chatter playback reads this stored sample. [src/scrcmd_sound.c:196–200](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L196-L200)

**Dependencies:** Existing audio/party/VM; new microphone input, recorded-cry buffer and save data.\
**Effort:** 0.25–0.5 d

<a id="system-24"></a>

## Clock and owner profile

### `check_is_today_player_birthday` — `0x282`

**Story / impact:** P2 — Counterpart’s optional birthday conversation; not a required progression branch.

**Native maps/callers:** [counterpart talk (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_counterpart_talk.s#L42).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SANDGEM_TOWN`, `SANDGEM_TOWN_POKEMON_RESEARCH_LAB`.

**Decomp:** Compares the saved DS owner birth month/day to the field calendar’s current month/day.\
Writes true only when both match; year and play-time are irrelevant. [src/scrcmd.c:6061–6074](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6061-L6074)

**Dependencies:** Existing game clock; original owner birthday profile field and migration/user-input policy for browser saves.\
**Effort:** 0.5–1 person-day

<a id="system-25"></a>

## Combee dialogue

### `check_party_combee_gender_count` — `0x264`

**Story / impact:** P2 — Optional Pastoria middle-house Combee conversation.

**Native maps/callers:** [PASTORIA CITY MIDDLE HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_middle_house.s#L25).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PASTORIA_CITY_MIDDLE_HOUSE`.

**Decomp:** Scans non-egg party Combee for presence of each gender.\
Returns 0 for none, 1 for one gender and 2 for both; yields once. [src/scrcmd.c:5772–5808](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5772-L5808)

**Dependencies:** Existing party species/gender/isEgg fields.\
**Effort:** 0.25 d

<a id="system-26"></a>

## Dress-Up and photos

### `scr_cmd_0a6` — `0x0A6`

**Story / impact:** P2 — Jubilife TV 2F gallery dressing room; optional Pokémon dress-up.

**Native maps/callers:** [JUBILIFE TV 2F GALLERY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f_gallery.s#L126).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `JUBILIFE_TV_2F_GALLERY`.

**Decomp:** Launches the Dress-Up application for the chosen party slot, passing the saved Fashion Case, first dress-up photo, trainer profile and options.\
Waits through the application task and writes a boolean result (one only for the app’s success result); a separate operand controls the app mode. [src/scrcmd.c:3108–3116](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3108-L3116); [src/unk_0203D1B8.c:816–899](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L816-L899)

**Dependencies:** Party and naming/menu infrastructure exists; new accessory placement UI, Fashion Case inventory, photo persistence and imported Dress-Up resources.\
**Effort:** 1–2 person-days command integration; new shared Dress-Up app roughly 6–12 person-days

### `show_dress_up_photo` — `0x0A7`

**Story / impact:** P2 — Optional Jubilife TV gallery or Hearthome Contest Hall displays.

**Native maps/callers:** [JUBILIFE TV 2F GALLERY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f_gallery.s#L294).

**Coverage:** 11 ROM-wide instruction sites; zone-root maps: `JUBILIFE_TV_2F_GALLERY`.

**Decomp:** Opens the saved dress-up photo in the requested gallery slot.\
Returns 1 when the slot is empty, otherwise 0 and waits for the viewer to close. [src/scrcmd.c:3118–3138](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3118-L3138); [src/scrcmd.c:2950–2966](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2950-L2966)

**Dependencies:** New persisted ImageClips photos and photo-viewer app; existing Pokémon sprites/text/menu host.\
**Effort:** 0.5–1 d; shared photo/save/viewer foundation 3–5 d

### `scr_cmd_0a8` — `0x0A8`

**Story / impact:** P2 — Optional Hearthome Contest Hall lobby photo-frame displays; these are its only native script callers.

**Native maps/callers:** [CONTEST HALL LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L185).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Opens the requested saved contest photograph, using the contest rather than dress-up photo collection.\
Returns 1 for missing data, otherwise 0 and waits for the viewer to close. [src/scrcmd.c:3140–3160](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3140-L3160); [src/scrcmd.c:2950–2966](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2950-L2966)

**Dependencies:** New persisted ImageClips photos and photo-viewer app; existing Pokémon sprites/text/menu host.\
**Effort:** 0.25–0.5 d

### `dress_up_photo_has_data` — `0x12E`

**Story / impact:** P2 — Optional Jubilife TV gallery or Hearthome Contest Hall displays.

**Native maps/callers:** [JUBILIFE TV 2F GALLERY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f_gallery.s#L290).

**Coverage:** 11 ROM-wide instruction sites; zone-root maps: `JUBILIFE_TV_2F_GALLERY`.

**Decomp:** Checks whether the requested dress-up photograph slot contains data.\
Writes a boolean and yields once; no viewer opens. [src/scrcmd.c:3162–3176](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3162-L3176)

**Dependencies:** New persisted ImageClips photos and photo-viewer app; existing Pokémon sprites/text/menu host.\
**Effort:** 0.25–0.5 d

### `contest_photo_has_data` — `0x12F`

**Story / impact:** P2 — Optional Jubilife TV gallery or Hearthome Contest Hall displays.

**Native maps/callers:** [CONTEST HALL LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L181).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Checks whether the requested contest photograph slot contains data.\
Writes a boolean and yields once; no viewer opens. [src/scrcmd.c:3178–3192](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3178-L3192)

**Dependencies:** New persisted ImageClips photos and photo-viewer app; existing Pokémon sprites/text/menu host.\
**Effort:** 0.25–0.5 d

### `set_dress_up_photo_title` — `0x130`

**Story / impact:** P2 — Optional Jubilife TV gallery or Hearthome Contest Hall displays.

**Native maps/callers:** [JUBILIFE TV 2F GALLERY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f_gallery.s#L185).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `JUBILIFE_TV_2F_GALLERY`.

**Decomp:** Sets the title word of dress-up photo slot zero.\
Writes the saved photo metadata and yields once. [src/scrcmd.c:3194–3203](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3194-L3203)

**Dependencies:** New persisted ImageClips photos and photo-viewer app; existing Pokémon sprites/text/menu host.\
**Effort:** 0.25–0.5 d

<a id="system-27"></a>

## Easy Chat and custom words

### `choose_custom_message_word` — `0x243`

**Story / impact:** P2 — Jubilife TV Dress-Up/TV interviews and Sunyshore house conversations; optional.

**Native maps/callers:** [JUBILIFE TV 2F GALLERY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f_gallery.s#L180); [SUNYSHORE CITY NORTHEAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_northeast_house.s#L119); [tv reporter interviews (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_tv_reporter_interviews.s#L124).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: [R17](#reach-r17) (14 maps).

**Decomp:** Opens a one-word Easy Chat selection task; the first operand is consumed but unused.\
Initializes word output to 0xFFFF; after the app exits, writes status 1 and the chosen word only for a modified/updated choice, otherwise status 0. [src/scrcmd.c:3504–3514](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3504-L3514); [src/unk_0203D1B8.c:623–689](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L623-L689)

**Dependencies:** Existing menus and imported text; new Easy Chat dictionary/category UI, unlock filtering and explicit result channel.\
**Effort:** 1–2 person-days integration after shared Easy Chat picker (4–7 person-days foundation)

### `choose_two_custom_message_words` — `0x244`

**Story / impact:** P2 — Jubilife TV 3F producer password conversation for wallpapers; optional.

**Native maps/callers:** [JUBILIFE TV 3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_3f.s#L60).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `JUBILIFE_TV_3F`.

**Decomp:** Opens the two-word Easy Chat selection task, consuming an unused leading operand.\
Initializes both word outputs to 0xFFFF; returns status 1 and both words only for a modified/updated selection, otherwise status 0. [src/scrcmd.c:3516–3528](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3516-L3528); [src/unk_0203D1B8.c:623–689](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L623-L689)

**Dependencies:** Same Easy Chat picker and unlocked dictionary as one-word command; two-word selection mode.\
**Effort:** 0.5–1 person-day after Easy Chat picker

### `buffer_custom_message_word` — `0x245`

**Story / impact:** P2 — Jubilife TV gallery and Sunyshore word-choice dialogue; optional.

**Native maps/callers:** [JUBILIFE TV 2F GALLERY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_2f_gallery.s#L188); [SUNYSHORE CITY NORTHEAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_northeast_house.s#L124).

**Coverage:** 8 ROM-wide instruction sites; zone-root maps: `JUBILIFE_TV_2F_GALLERY`, `SUNYSHORE_CITY_NORTHEAST_HOUSE`.

**Decomp:** Resolves an encoded Easy Chat word and destination template index.\
Buffers that localized word for later dialogue, without selecting/unlocking a word or showing a message. [src/scrcmd.c:3530–3539](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3530-L3539)

**Dependencies:** Imported Easy Chat word mapping and existing template engine.\
**Effort:** 0.25–0.5 person-day

### `get_wallpaper_from_custom_message_words` — `0x249`

**Story / impact:** P2 — Jubilife TV 3F producer’s four-word PC wallpaper password; optional.

**Native maps/callers:** [JUBILIFE TV 3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_3f.s#L74).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `JUBILIFE_TV_3F`.

**Decomp:** Checks four words against the trainer-specific wallpaper password algorithm.\
Writes 0xFF for invalid/out-of-range, zero if already unlocked, or wallpaper index + 1 after unlocking a new PC wallpaper. [src/scrcmd.c:5573–5598](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5573-L5598)

**Dependencies:** Password algorithm and player trainer ID/profile, saved PC wallpaper unlock bits; existing PC storage UI.\
**Effort:** 1–2 person-days

### `try_buffer_and_unlock_random_tough_word` — `0x27D`

**Story / impact:** P2 — Snowpoint east-house tough-word teacher; optional vocabulary unlock.

**Native maps/callers:** [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L20).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SNOWPOINT_CITY_EAST_HOUSE`.

**Decomp:** Attempts to select and unlock a random remaining tough word from saved Easy Chat vocabulary.\
Writes its bank-entry index and buffers the word, or writes 0xFFFF when there is no unlock available; no dialogue or app opens. [src/scrcmd.c:6010–6030](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6010-L6030)

**Dependencies:** Saved vocabulary bits, seeded random selection and imported tough-word mapping; template engine.\
**Effort:** 0.5–1 person-day

### `check_all_tough_words_unlocked` — `0x27F`

**Story / impact:** P2 — Snowpoint east-house tough-word teacher completion branch; optional.

**Native maps/callers:** [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L15).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SNOWPOINT_CITY_EAST_HOUSE`.

**Decomp:** Checks the saved Easy Chat vocabulary against the complete tough-word set.\
Writes true/false to the destination variable without granting or choosing a word. [src/scrcmd.c:6032–6045](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6032-L6045)

**Dependencies:** Same tough-word unlock state and complete set bounds as random unlock.\
**Effort:** 0.25 person-day

### `sentence_instant` — `0x1FC`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Builds a predefined sentence from its sentence type, sentence ID and two word IDs.\
Displays the resulting sentence instantly; it does not open the word-selection app or wait for printing. [src/scrcmd.c:1223–1232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1223-L1232)

**Dependencies:** Imported sentence templates and Easy Chat word tables; existing field text renderer.\
**Effort:** 0.5–1 person-day after Easy Chat text foundation

### `sentence` — `0x1FD`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Builds a predefined sentence from the supplied sentence identifiers and two word IDs.\
Uses the normal printed-message path and waits for the printer to finish. [src/scrcmd.c:1234–1245](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1234-L1245)

**Dependencies:** Same sentence/word data and template builder as sentence_instant; existing text printer wait.\
**Effort:** 0.25–0.5 person-day after sentence builder

<a id="system-28"></a>

## Footstep ribbon service

### `get_party_mon_footprint_type` — `0x23A`

**Story / impact:** P2 — Optional Route 213 Footstep House friendship/ribbon conversation.

**Native maps/callers:** [FOOTSTEP HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_footstep_house.s#L28).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `FOOTSTEP_HOUSE`.

**Decomp:** Reads the selected Pokémon’s species/form footprint availability and footprint personality/type.\
Writes both codes immediately for Dr. Footstep’s dialogue selection. [src/scrcmd.c:5521–5534](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5521-L5534)

**Dependencies:** Existing party species/form data; imported footprint availability/type tables.\
**Effort:** 0.25–0.5 d

<a id="system-29"></a>

## Fossil revival

### `get_fossil_count` — `0x1F1`

**Story / impact:** P2 — Optional Oreburgh Mining Museum revival after Explorer Kit receipt; entering Underground is unnecessary.

**Native maps/callers:** [MINING MUSEUM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_mining_museum.s#L36).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `MINING_MUSEUM`.

**Decomp:** Totals Bag quantities across every supported fossil item.\
Writes the total immediately; no fossil is consumed. [src/scrcmd_fossil.c:26–40](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_fossil.c#L26-L40)

**Dependencies:** Existing Bag/party gifting; imported fossil-to-species mapping and script menu results.\
**Effort:** 0.25 d

### `get_species_from_fossil` — `0x1F4`

**Story / impact:** P2 — Optional Oreburgh Mining Museum revival after Explorer Kit receipt; entering Underground is unnecessary.

**Native maps/callers:** [MINING MUSEUM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_mining_museum.s#L101).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `MINING_MUSEUM`.

**Decomp:** Looks up the revived species for the supplied fossil item.\
Writes zero when the item is absent from the fossil mapping. [src/scrcmd_fossil.c:42–58](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_fossil.c#L42-L58)

**Dependencies:** Existing Bag/party gifting; imported fossil-to-species mapping and script menu results.\
**Effort:** 0.25 d

### `find_fossil_at_threshold` — `0x1F5`

**Story / impact:** P2 — Optional Oreburgh Mining Museum revival after Explorer Kit receipt; entering Underground is unnecessary.

**Native maps/callers:** [MINING MUSEUM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_mining_museum.s#L198).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `MINING_MUSEUM`.

**Decomp:** Scans fossil types and their quantities until the cumulative count reaches the threshold.\
Returns the corresponding fossil item and mapping index; outputs remain zero if no match. [src/scrcmd_fossil.c:60–83](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_fossil.c#L60-L83)

**Dependencies:** Existing Bag/party gifting; imported fossil-to-species mapping and script menu results.\
**Effort:** 0.25 d

<a id="system-30"></a>

## Hidden Power type service

### `calc_hidden_power_type` — `0x2FF`

**Story / impact:** P2 — Optional Veilstone Prize Exchange Hidden Power adviser.

**Native maps/callers:** [VEILSTONE CITY PRIZE EXCHANGE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_prize_exchange.s#L128).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VEILSTONE_CITY_PRIZE_EXCHANGE`.

**Decomp:** Calculates Hidden Power’s type from the selected Pokémon’s IVs.\
For listed non-egg species that cannot learn it, returns 0xFFFF instead; writes only type, not power. [src/overlay005/ov5_021F6454.c:633–670](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L633-L670)

**Dependencies:** Existing IVs/species/isEgg; Gen 4 Hidden Power type calculation and native exclusion list.\
**Effort:** 0.25–0.5 d

<a id="system-31"></a>

## Honey trees

### `slather_honey_tree` — `0x127`

**Story / impact:** P2 — Optional honey-tree encounters across Sinnoh; no story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L524).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Slathers the current tree and resets its lifetime to 24 hours, rolling encounter group, slot and shaking.\
Trainer ID affects special trees; repeating the same tree can preserve its prior group. [src/scrcmd.c:4054–4060](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4054-L4060); [src/overlay005/honey_tree.c:135–177](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/honey_tree.c#L135-L177)

**Dependencies:** New per-tree saved timers/rolls and imported encounter tables; existing clock, RNG, field and battles.\
**Effort:** 0.5–1 d; honey state/timers/table foundation 3–5 d

### `get_honey_tree_status` — `0x128`

**Story / impact:** P2 — Optional honey-tree encounters across Sinnoh; no story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L465).

**Coverage:** 2 ROM-wide instruction sites; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Reads the current tree’s saved timer as bare, slathered or encounter-ready.\
The encounter-ready condition starts after six hours; writes the status immediately. [src/scrcmd.c:4062–4069](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4062-L4069); [src/overlay005/honey_tree.c:118–133](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/honey_tree.c#L118-L133)

**Dependencies:** New per-tree saved timers/rolls and imported encounter tables; existing clock, RNG, field and battles.\
**Effort:** 0.25–0.5 d

### `start_honey_tree_battle` — `0x129`

**Story / impact:** P2 — Optional honey-tree encounters across Sinnoh; no story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L534).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Starts a wild encounter using the current honey tree’s saved selection.\
Yields to battle and stores the normal battle result mask. [src/scrcmd.c:4071–4077](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4071-L4077)

**Dependencies:** New per-tree saved timers/rolls and imported encounter tables; existing clock, RNG, field and battles.\
**Effort:** 0.5–1 d

### `stop_honey_tree_shaking` — `0x12A`

**Story / impact:** P2 — Optional honey-tree encounters across Sinnoh; no story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L537).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Stops the current tree’s shaking map-prop animation.\
Immediate visual change; the command does not itself initiate battle. [src/scrcmd.c:4079–4085](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4079-L4085); [src/overlay005/honey_tree.c:179–202](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/honey_tree.c#L179-L202)

**Dependencies:** New per-tree saved timers/rolls and imported encounter tables; existing clock, RNG, field and battles.\
**Effort:** 0.25–0.5 d

<a id="system-32"></a>

## Jubilife rankings

### `start_rankings_machine` — `0x1B5`

**Story / impact:** P2 — Jubilife TV 3F global/group ranking machines; optional.

**Native maps/callers:** [JUBILIFE TV 3F GLOBAL RANKING ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_3f_global_ranking_room.s#L17); [JUBILIFE TV 3F GROUP RANKING ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_3f_group_ranking_room.s#L16).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `JUBILIFE_TV_3F_GLOBAL_RANKING_ROOM`, `JUBILIFE_TV_3F_GROUP_RANKING_ROOM`.

**Decomp:** Starts the local rankings-machine task, deriving the record category and global/group mode from machine ID.\
Provides record/ranking lists and deletion confirmation for stored entries while protecting the player’s own ranking; the task blocks until cleanup completes. [src/scrcmd.c:4926–4932](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4926-L4932); [src/rankings_machine.c:264–280](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/rankings_machine.c#L264-L280); [src/rankings_machine.c:921–994](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/rankings_machine.c#L921-L994)

**Dependencies:** New rankings records and group/global datasets; existing list menus, profile names and field-task UI seam.\
**Effort:** 2–4 person-days shared rankings-machine foundation

<a id="system-33"></a>

## Legendary event encounters

### `find_party_slot_with_fateful_encounter_species` — `0x31C`

**Story / impact:** P2 — Optional Floaroma Beauty/Shaymin event branch encountered before Champion if event data is present.

**Native maps/callers:** [FLOAROMA TOWN](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_town.s#L105).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `FLOAROMA_TOWN`.

**Decomp:** Scans non-egg party Pokémon for the requested species with fateful-encounter provenance.\
Returns the first matching zero-based slot, or 0xFF if none; does not award or transform a Pokémon. [src/scrcmd_party.c:777–804](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L777-L804)

**Dependencies:** Existing party/species/battle model; add persistent fateful-encounter provenance and event availability.\
**Effort:** 0.25–0.5 d

### `check_party_has_fateful_encounter_regigigas` — `0x32B`

**Story / impact:** P2 — Optional event titan chambers and adjacent map setup (some available before Champion, Route 228 postgame); not required route traversal.

**Native maps/callers:** [ICEBERG RUINS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iceberg_ruins.s#L31); [IRON ISLAND B3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_island_b3f.s#L11); [IRON RUINS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_ruins.s#L31); [MT CORONET 1F NORTH ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_mt_coronet_1f_north_room_2.s#L11); [ROCK PEAK RUINS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rock_peak_ruins.s#L31); [ROUTE 228](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_228.s#L13).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: `ICEBERG_RUINS`, `IRON_ISLAND_B3F`, `IRON_RUINS`, `MT_CORONET_1F_NORTH_ROOM_2`, `ROCK_PEAK_RUINS`, `ROUTE_228`.

**Decomp:** Scans non-egg party Pokémon for a Regigigas marked as a fateful encounter.\
Returns true on the first such match; ordinary Regigigas do not satisfy this event gate. [src/scrcmd.c:7113–7134](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7113-L7134)

**Dependencies:** Existing party/species/battle model; add persistent fateful-encounter provenance and event availability.\
**Effort:** 0.25–0.5 d

### `check_has_all_legendary_titans_in_party` — `0x26B`

**Story / impact:** P3 — Optional post-National-Dex Regigigas battle at Snowpoint Temple B5F.

**Native maps/callers:** [SNOWPOINT TEMPLE B5F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_temple_b5f.s#L25).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SNOWPOINT_TEMPLE_B5F`.

**Decomp:** Scans the party for the three legendary titans required by the Snowpoint Temple encounter.\
Returns the helper’s boolean result synchronously; it neither spawns nor starts Regigigas itself. [src/scrcmd.c:5874–5880](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5874-L5880); [src/unk_0205DFC4.c:229–255](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205DFC4.c#L229-L255)

**Dependencies:** Existing party/species model and titan species IDs.\
**Effort:** 0.25–0.5 d

### `start_fateful_encounter` — `0x318`

**Story / impact:** P3 — Optional event Shaymin battle in Flower Paradise.

**Native maps/callers:** [FLOWER PARADISE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_flower_paradise.s#L46).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `FLOWER_PARADISE`.

**Decomp:** Starts a wild encounter at the given species/level using fateful-encounter provenance and legendary encounter treatment.\
Uses the normal battle-result pointer and yields through the encounter task; capture/party placement follows normal battle handling.\
Clears any Poké Radar chain and increments the wild-battles-fought game record before the encounter. [src/scrcmd.c:4028–4037](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4028-L4037); [src/encounter.c:568–589](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L568-L589)

**Dependencies:** Existing static/legendary battle pipeline plus fateful provenance in encounter/capture save model.\
**Effort:** 0.5–1 d

<a id="system-34"></a>

## Mailbox

### `scr_cmd_1b3` — `0x1B3`

**Story / impact:** P2 — Optional player PC mailbox service.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1079).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Starts the mailbox field task used by the PC Mailbox option.\
The task opens the mail-management workflow and yields until it completes. [src/scrcmd.c:4910–4914](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4910-L4914); [src/unk_020722AC.c:187–213](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020722AC.c#L187-L213); [src/unk_020722AC.c:1263–1294](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020722AC.c#L1263-L1294)

**Dependencies:** New saved mail/messages, mailbox list/actions and party-mail transfer; existing PC/app host.\
**Effort:** 1–2 d; mailbox/save/actions foundation 3–5 d

### `count_mail_in_mailbox` — `0x1B4`

**Story / impact:** P2 — Optional player PC mailbox service.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1077).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Counts mail stored in the PC mailbox context.\
Writes the count immediately; party-held mail is not included. [src/scrcmd.c:4916–4924](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4916-L4924)

**Dependencies:** New saved mail/messages, mailbox list/actions and party-mail transfer; existing PC/app host.\
**Effort:** 0.25–0.5 d

<a id="system-35"></a>

## Move services and party selection

### `open_party_menu_for_contest` — `0x194`

**Story / impact:** P2 — Optional contest registration or Day Care summary-selection branches.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L446).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Opens contest-specific party selection with initial slot, rank and category constraints.\
Waits for the app to close, retaining selection data for the paired result command. [src/scrcmd.c:2725–2737](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2725-L2737)

**Dependencies:** Existing party/summary apps and VM app lifecycle; add script selection/result modes.\
**Effort:** 0.25–0.5 d

### `get_contest_party_menu_result` — `0x195`

**Story / impact:** P2 — Optional contest registration or Day Care summary-selection branches.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L447).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Retrieves selected slot plus whether the player requested Summary.\
Converts the cancel slot to PARTY_SLOT_NONE, writes outputs and frees the party-menu context. [src/scrcmd.c:2739–2765](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2739-L2765)

**Dependencies:** Existing party/summary apps and VM app lifecycle; add script selection/result modes.\
**Effort:** 0.25–0.5 d

### `set_mon_summary` — `0x196`

**Story / impact:** P2 — Optional contest registration or Day Care summary-selection branches.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L449); [day care common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_day_care_common.s#L136).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`, `POKEMON_DAY_CARE`.

**Decomp:** Opens the party Pokémon summary app at the requested slot.\
Waits for it to close and retains the summary context for slot retrieval. [src/scrcmd.c:2767–2776](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2767-L2776)

**Dependencies:** Existing party/summary apps and VM app lifecycle; add script selection/result modes.\
**Effort:** 0.25–0.5 d

### `get_mon_party_slot` — `0x197`

**Story / impact:** P2 — Optional contest registration or Day Care summary-selection branches.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L450); [day care common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_day_care_common.s#L137).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`, `POKEMON_DAY_CARE`.

**Decomp:** Returns the party slot currently selected when the preceding summary app closed.\
Frees and clears that retained summary context. [src/scrcmd.c:2778–2791](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2778-L2791)

**Dependencies:** Existing party/summary apps and VM app lifecycle; add script selection/result modes.\
**Effort:** 0.25–0.5 d

### `select_party_mon_move` — `0x1C6`

**Story / impact:** P2 — Optional Canalave Move Deleter move-selection step; no compulsory story gate.

**Native maps/callers:** [CANALAVE CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_east_house.s#L47).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CANALAVE_CITY_EAST_HOUSE`.

**Decomp:** Opens the selected party Pokémon’s summary screen in move-selection mode.\
Waits for selection/cancellation and retains its result context. [src/scrcmd_party_mon_moves.c:20–29](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L20-L29)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `get_selected_party_mon_move` — `0x1C7`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [CANALAVE CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_east_house.s#L48).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CANALAVE_CITY_EAST_HOUSE`.

**Decomp:** Returns the selected move slot from that summary screen.\
Converts the cancel slot to MOVE_NOT_SELECTED, then frees and clears the context. [src/scrcmd_party_mon_moves.c:31–47](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L31-L47)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `clear_party_mon_move_slot` — `0x1C9`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [CANALAVE CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_east_house.s#L61).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CANALAVE_CITY_EAST_HOUSE`.

**Decomp:** Clears one move slot on the selected party Pokémon.\
Synchronous permanent move-data edit; the script owns confirmation and dialogue. [src/scrcmd_party.c:529–539](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L529-L539)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `check_has_learnable_reminder_moves` — `0x21F`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [PASTORIA CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_east_house.s#L47).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PASTORIA_CITY_EAST_HOUSE`.

**Decomp:** Builds the selected Pokémon’s reminder-move list.\
Returns whether at least one learnable reminder move exists, then frees the temporary list. [src/scrcmd_party_mon_moves.c:54–65](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L54-L65)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `open_move_reminder_menu` — `0x221`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [PASTORIA CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_east_house.s#L53).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PASTORIA_CITY_EAST_HOUSE`.

**Decomp:** Builds the reminder-move list and opens the move-learning application.\
Waits through move selection/replacement before returning. [src/scrcmd_party_mon_moves.c:89–99](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L89-L99)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.5–1 d

### `check_learned_reminder_move` — `0x223`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [PASTORIA CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_east_house.s#L54).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PASTORIA_CITY_EAST_HOUSE`.

**Decomp:** Reads the move-reminder application’s keep-old-move result.\
Writes 0 for a learned move or 0xFF for cancellation/refusal, then frees its context. [src/scrcmd_party_mon_moves.c:122–135](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L122-L135)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `open_move_tutor_menu` — `0x224`

**Story / impact:** P2 — Optional Draco Meteor tutor before Champion; ultimate-move tutor on postgame Route 228.

**Native maps/callers:** [ROUTE 210 GRANDMA WILMA HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_210_grandma_wilma_house.s#L117); [ROUTE 228 NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_228_north_house.s#L76).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `ROUTE_210_GRANDMA_WILMA_HOUSE`, `ROUTE_228_NORTH_HOUSE`.

**Decomp:** Builds a one-move tutor list for the requested move and chosen party Pokémon.\
Runs the same learning application and waits for it to close. [src/scrcmd_party_mon_moves.c:101–115](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L101-L115)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.5 d

### `check_learned_tutor_move` — `0x225`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [ROUTE 210 GRANDMA WILMA HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_210_grandma_wilma_house.s#L118); [ROUTE 228 NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_228_north_house.s#L77).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `ROUTE_210_GRANDMA_WILMA_HOUSE`, `ROUTE_228_NORTH_HOUSE`.

**Decomp:** Reads the single-move tutor application’s keep-old-move result.\
Writes 0 for learning or 0xFF for cancellation/refusal, then frees its context. [src/scrcmd_party_mon_moves.c:137–150](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L137-L150)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `check_has_learnable_tutor_moves` — `0x2E5`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L52); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L73); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L38).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Tests whether the selected Pokémon has any unknown tutor-compatible move at the given location.\
Writes a boolean; compatibility uses the Pokémon’s species/form tutor bitmask. [src/overlay005/scrcmd_move_tutor.c:95–105](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L95-L105)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.5 d; tutor data/filter/menu foundation 2–4 d

### `show_move_tutor_move_selection_menu` — `0x2E6`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1659); [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L56); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L77); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L42).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Builds a menu of compatible unknown moves at the selected tutor location; no party slot lists all location moves.\
Adds Exit and waits for selection, writing the chosen move ID or cancel sentinel. [src/overlay005/scrcmd_move_tutor.c:298–379](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L298-L379)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.5–1 d

### `open_summary_screen_teach_move` — `0x2E7`

**Story / impact:** P2 — Route212/Snowpoint shard tutors, Rotom form moves and postgame Survival Area tutor; optional.

**Native maps/callers:** [ROTOMS ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rotoms_room.s#L306); [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L76); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L97); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L62).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ROTOMS_ROOM`, `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Opens the selected party Pokémon’s summary in move-selection mode for a proposed move.\
Restricts pages to battle/Contest moves and pauses until the app exits; the subsequent result/teaching flow determines what move is replaced. [src/scrcmd.c:2793–2803](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2793-L2803); [src/unk_0203D1B8.c:1711–1742](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1711-L1742)

**Dependencies:** Existing party/summary/move data; summary selection/cancel result and selected move slot, tutor/Rotom script continuation.\
**Effort:** 1–2 person-days

### `get_summary_selected_move_slot` — `0x2E8`

**Story / impact:** P2 — Optional Canalave Move Deleter, Pastoria Move Reminder or move tutors; no compulsory story gate.

**Native maps/callers:** [ROTOMS ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rotoms_room.s#L307); [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L77); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L98); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L63).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ROTOMS_ROOM`, `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Reads the selected move slot from the retained summary-screen context.\
Frees/clears that context and yields once; used by tutors and Rotom replacement. [src/scrcmd.c:2805–2819](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2805-L2819)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `reset_move_slot` — `0x2E9`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L132); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L153); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L118).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Reads party slot, replacement-move slot, then new move ID, despite misleading native variable/macro parameter names.\
Replaces that party move immediately through the shared helper; the Route 212 tutor caller establishes the operand meaning. [src/overlay005/scrcmd_move_tutor.c:107–115](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L107-L115); [src/unk_02054884.c:79–82](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_02054884.c#L79-L82); [res/field/scripts/scripts_route_212_house.s:54–82](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L54-L82); [res/field/scripts/scripts_route_212_house.s:130–133](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L130-L133)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.25–0.5 d

### `check_can_afford_move` — `0x2EA`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L59); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L80); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L45).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Looks up all four shard-color costs for the selected tutor move.\
Writes true only if every nonzero cost can be removed from the Bag; does not spend shards. [src/overlay005/scrcmd_move_tutor.c:117–162](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L117-L162)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.25–0.5 d

### `pay_shard_cost` — `0x2EB`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [ROUTE 212 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_212_house.s#L131); [SNOWPOINT CITY EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_east_house.s#L152); [SURVIVAL AREA NORTH HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_survival_area_north_house.s#L117).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Looks up and removes the selected tutor move’s red, blue, yellow and green shard costs.\
Immediate Bag mutation; affordability and move confirmation belong to earlier script steps. [src/overlay005/scrcmd_move_tutor.c:164–192](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L164-L192)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.25–0.5 d

### `show_shard_cost` — `0x2EC`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1662).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Creates the tutor-cost window at the supplied screen coordinates.\
Displays all four color costs for the selected move and retains its manager handle. [src/overlay005/scrcmd_move_tutor.c:573–587](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L573-L587)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.25–0.5 d

### `close_shard_cost_window` — `0x2ED`

**Story / impact:** P2 — Optional Route 212, Snowpoint and postgame Survival Area shard tutors.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1664).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_212_HOUSE`, `SNOWPOINT_CITY_EAST_HOUSE`, `SURVIVAL_AREA_NORTH_HOUSE`.

**Decomp:** Deletes the retained tutor shard-cost window.\
Immediate UI cleanup; no inventory change. [src/overlay005/scrcmd_move_tutor.c:589–596](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/scrcmd_move_tutor.c#L589-L596)

**Dependencies:** Imported tutor compatibility/cost/location tables; existing Bag/summary/move editing and menu host.\
**Effort:** 0.25–0.5 d

### `reset_party_mon_move_slot_unused` — `0x098`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Replaces the selected party Pokémon move slot using the move-reset helper.\
Synchronous mutation; no move-learning menu or result variable. [src/scrcmd_party.c:106–114](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L106-L114)

**Dependencies:** Existing Pokémon move/PP model, learnset, summary and app host; new script picker/result wiring.\
**Effort:** 0.25–0.5 d

### `get_party_mon_gender_unused` — `0x11A`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the selected party Pokémon’s stored gender.\
Writes the gender code immediately; unused command variant. [src/scrcmd_party.c:483–492](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L483-L492)

**Dependencies:** Existing party/summary apps and VM app lifecycle; add script selection/result modes.\
**Effort:** 0.25–0.5 d

<a id="system-36"></a>

## Mystery Gift and distribution events

### `mystery_gift_give` — `0x23E`

**Story / impact:** P2 — Optional event-distribution branches; no main-story requirement.

**Native maps/callers:** [mystery gift deliveryman (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_mystery_gift_deliveryman.s#L10).

**Coverage:** 12 ROM-wide instruction sites; zone-root maps: [R16](#reach-r16) (14 maps).

**Decomp:** Dispatches deliveryman gift loading/unloading, availability/type/capacity queries and the actual type-specific award.\
Giving consumes the current pending gift; separate selectors format success/refusal messages into bank/message destinations. [src/scrcmd_mystery_gift.c:89–155](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_mystery_gift.c#L89-L155)

**Dependencies:** New distribution/gift save fields and imported gift definitions; existing party, bag and message templates.\
**Effort:** 3–5 d once gift schema exists

**Caveat:** Offline delivery of a supported imported gift is distinct from reimplementing discontinued network distribution.

### `check_distribution_event` — `0x28B`

**Story / impact:** P2 — Optional Shaymin/Darkrai/Rotom/Hall of Origin and legendary-side-branch gates; presence near story maps is not required progression.

**Native maps/callers:** [CANALAVE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city.s#L98); [CANALAVE CITY HARBOR INN](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_harbor_inn.s#L31); [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1538); [FLOWER PARADISE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_flower_paradise.s#L18); [HALL OF ORIGIN](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hall_of_origin.s#L14); [NEWMOON ISLAND FOREST](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_newmoon_island_forest.s#L17); [ROTOMS ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rotoms_room.s#L34); [ROUTE 224](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_224.s#L25); [SPEAR PILLAR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L42); [SPEAR PILLAR DIALGA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_dialga.s#L21); [SPEAR PILLAR PALKIA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_palkia.s#L21); [TEAM GALACTIC ETERNA BUILDING 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_team_galactic_eterna_building_1f.s#L95).

**Coverage:** 13 ROM-wide instruction sites; zone-root maps: `CANALAVE_CITY`, `CANALAVE_CITY_HARBOR_INN`, `FLOWER_PARADISE`, `HALL_OF_ORIGIN`, `NEWMOON_ISLAND_FOREST`, `ROTOMS_ROOM`, `ROUTE_224`, `SPEAR_PILLAR`, `SPEAR_PILLAR_DIALGA`, `SPEAR_PILLAR_PALKIA`, `TEAM_GALACTIC_ETERNA_BUILDING_1F`.

**Decomp:** Checks the saved availability bit for the requested distribution-event ID, asserting that the ID is in range.\
Returns the event gate synchronously; does not unlock the event or consume an event item. [src/scrcmd.c:6248–6257](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6248-L6257)

**Dependencies:** New distribution/gift save fields and imported gift definitions; existing party, bag and message templates.\
**Effort:** 0.5–1 d; shared offline gift foundation 4–7 d

### `check_is_mystery_gift_phrase` — `0x2AA`

**Story / impact:** P2 — Optional Jubilife TV 3F Mystery Gift unlock conversation (available early).

**Native maps/callers:** [JUBILIFE TV 3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_3f.s#L80).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `JUBILIFE_TV_3F`.

**Decomp:** Expands the four selected Easy Chat words using the Mystery Gift phrase message template.\
Compares the resulting text to the unlock phrase and returns equality; comparison uses localized message data. [src/scrcmd.c:6429–6455](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6429-L6455)

**Dependencies:** Easy Chat words, localized phrase text bank and string-template expansion.\
**Effort:** 0.5–1 d

### `unlock_mystery_gift` — `0x2AC`

**Story / impact:** P2 — Optional Jubilife TV 3F unlock conversation.

**Native maps/callers:** [JUBILIFE TV 3F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_tv_3f.s#L108).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `JUBILIFE_TV_3F`.

**Decomp:** Sets the saved system flag enabling Mystery Gift.\
No app launch, network connection or gift award is performed. [src/scrcmd.c:6457–6464](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6457-L6464)

**Dependencies:** New distribution/gift save fields and imported gift definitions; existing party, bag and message templates.\
**Effort:** 0.25 d

### `get_gba_cartridge_version` — `0x26E`

**Story / impact:** P3 — Optional Pal Park lobby GBA-cartridge bonus gift after the main story.

**Native maps/callers:** [PAL PARK LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park_lobby.s#L483).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PAL_PARK_LOBBY`.

**Decomp:** Returns the detected GBA cartridge-version code from the global system state.\
Yields once; it performs no cartridge parsing or gift award itself. [src/scrcmd.c:5924–5930](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5924-L5930)

**Dependencies:** Explicit browser substitute/import policy for GBA-slot detection; saved source-game version.\
**Effort:** 0.5–1 d after product decision

<a id="system-37"></a>

## NPC trades

### `init_npc_trade` — `0x226`

**Story / impact:** P2 — Optional Oreburgh, Eterna, Snowpoint and postgame Route 226 NPC trades.

**Native maps/callers:** [ETERNA CITY CONDOMINIUMS 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_condominiums_1f.s#L114); [OREBURGH CITY NORTH HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_north_house_1f.s#L29); [ROUTE 226 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_226_house.s#L44); [SNOWPOINT CITY WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_west_house.s#L46).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_CONDOMINIUMS_1F`, `OREBURGH_CITY_NORTH_HOUSE_1F`, `ROUTE_226_HOUSE`, `SNOWPOINT_CITY_WEST_HOUSE`.

**Decomp:** Loads the selected NPC trade record and initializes the temporary Pokémon/trainer context.\
Keeps it in the script session for requested-species checks and the later exchange. [src/scrcmd.c:5417–5422](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5417-L5422); [src/overlay006/npc_trade.c:28–50](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/npc_trade.c#L28-L50)

**Dependencies:** New imported NPC-trade records/name text and trade session/animation; existing party, catch records and menu host.\
**Effort:** 0.5 d; records/name import and trade foundation 3–5 d

### `get_npc_trade_requested_species` — `0x228`

**Story / impact:** P2 — Optional Oreburgh, Eterna, Snowpoint and postgame Route 226 NPC trades.

**Native maps/callers:** [ETERNA CITY CONDOMINIUMS 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_condominiums_1f.s#L117); [OREBURGH CITY NORTH HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_north_house_1f.s#L32); [ROUTE 226 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_226_house.s#L47); [SNOWPOINT CITY WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_west_house.s#L49).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_CONDOMINIUMS_1F`, `OREBURGH_CITY_NORTH_HOUSE_1F`, `ROUTE_226_HOUSE`, `SNOWPOINT_CITY_WEST_HOUSE`.

**Decomp:** Reads the species requested by the initialized NPC trade.\
Writes it immediately; the script decides whether the selected party Pokémon qualifies. [src/scrcmd.c:5432–5438](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5432-L5438)

**Dependencies:** New imported NPC-trade records/name text and trade session/animation; existing party, catch records and menu host.\
**Effort:** 0.25–0.5 d

### `start_npc_trade` — `0x229`

**Story / impact:** P2 — Optional Oreburgh, Eterna, Snowpoint and postgame Route 226 NPC trades.

**Native maps/callers:** [ETERNA CITY CONDOMINIUMS 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_condominiums_1f.s#L119); [OREBURGH CITY NORTH HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_north_house_1f.s#L34); [ROUTE 226 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_226_house.s#L49); [SNOWPOINT CITY WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_west_house.s#L51).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_CONDOMINIUMS_1F`, `OREBURGH_CITY_NORTH_HOUSE_1F`, `ROUTE_226_HOUSE`, `SNOWPOINT_CITY_WEST_HOUSE`.

**Decomp:** Constructs the NPC Pokémon at the offered Pokémon’s level and replaces the chosen party slot.\
Updates catch records, plays the trade sequence, then returns to the field; waits for task completion. [src/scrcmd.c:5440–5445](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5440-L5445); [src/overlay006/npc_trade.c:73–105](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/npc_trade.c#L73-L105); [src/npc_trade_task.c:47–99](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/npc_trade_task.c#L47-L99)

**Dependencies:** New imported NPC-trade records/name text and trade session/animation; existing party, catch records and menu host.\
**Effort:** 1–2 d

### `finish_npc_trade` — `0x22A`

**Story / impact:** P2 — Optional Oreburgh, Eterna, Snowpoint and postgame Route 226 NPC trades.

**Native maps/callers:** [ETERNA CITY CONDOMINIUMS 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_condominiums_1f.s#L120); [OREBURGH CITY NORTH HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_north_house_1f.s#L35); [ROUTE 226 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_226_house.s#L50); [SNOWPOINT CITY WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_west_house.s#L52).

**Coverage:** 8 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_CONDOMINIUMS_1F`, `OREBURGH_CITY_NORTH_HOUSE_1F`, `ROUTE_226_HOUSE`, `SNOWPOINT_CITY_WEST_HOUSE`.

**Decomp:** Frees the initialized NPC trade’s temporary data and trainer/Pokémon objects.\
Immediate cleanup on both cancelled and successful exchange paths. [src/scrcmd.c:5447–5452](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5447-L5452)

**Dependencies:** New imported NPC-trade records/name text and trade session/animation; existing party, catch records and menu host.\
**Effort:** 0.25–0.5 d

### `open_party_menu_for_trade` — `0x2A5`

**Story / impact:** P2 — Optional Oreburgh, Eterna, Snowpoint and postgame Route 226 NPC trades.

**Native maps/callers:** [ETERNA CITY CONDOMINIUMS 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_condominiums_1f.s#L110); [OREBURGH CITY NORTH HOUSE 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_oreburgh_city_north_house_1f.s#L25); [ROUTE 226 HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_226_house.s#L40); [SNOWPOINT CITY WEST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_west_house.s#L42).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_CONDOMINIUMS_1F`, `OREBURGH_CITY_NORTH_HOUSE_1F`, `ROUTE_226_HOUSE`, `SNOWPOINT_CITY_WEST_HOUSE`.

**Decomp:** Opens the party menu in NPC-trade selection mode.\
Waits for the app to close and retains the result context for the shared party-result command. [src/scrcmd.c:2592–2599](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2592-L2599)

**Dependencies:** New imported NPC-trade records/name text and trade session/animation; existing party, catch records and menu host.\
**Effort:** 0.25–0.5 d

### `get_npc_trade_species` — `0x227`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the species offered by the initialized NPC trade.\
Writes it immediately without constructing or receiving the Pokémon. [src/scrcmd.c:5424–5430](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5424-L5430)

**Dependencies:** New imported NPC-trade records/name text and trade session/animation; existing party, catch records and menu host.\
**Effort:** 0.25–0.5 d

<a id="system-38"></a>

## Old Chateau ghosts

### `check_should_show_ghost` — `0x292`

**Story / impact:** P2 — Dining-area/back-room ghost sightings; optional atmospheric events.

**Native maps/callers:** [OLD CHATEAU BACK MIDDLE EAST ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_old_chateau_back_middle_east_room.s#L10); [OLD CHATEAU DINING AREA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_old_chateau_dining_area.s#L10).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `OLD_CHATEAU_BACK_MIDDLE_EAST_ROOM`, `OLD_CHATEAU_DINING_AREA`.

**Decomp:** Caps the provided chance at 100, draws RNG modulo 101, and returns whether the value is at most that chance.\
The comparison includes zero, so its exact probability is (chance + 1)/101 rather than chance/100. [src/scrcmd.c:6322–6340](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6322-L6340)

**Dependencies:** Existing deterministic field RNG and script variable result.\
**Effort:** 0.25–0.5 person-day

<a id="system-39"></a>

## Poffins

### `open_poffin_cooking` — `0x1D7`

**Story / impact:** P2 — Optional Hearthome cooking/gift and Veilstone basement vendor; supports contest condition.

**Native maps/callers:** [poffin common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poffin_common.s#L87).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `POFFIN_HOUSE`.

**Decomp:** Creates the berry-selection/cooking context for solo or group Poffin cooking.\
Yields until its application workflow exits; group play also depends on excluded link services. [src/scrcmd.c:3240–3249](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3240-L3249)

**Dependencies:** New Poffin Case recipes/capacity/save state and cooking app; existing berries/party/menu host.\
**Effort:** 1–2 d integration; solo cooking/save foundation 5–8 d

### `check_can_cook_poffin` — `0x1D8`

**Story / impact:** P2 — Optional Hearthome cooking/gift and Veilstone basement vendor; supports contest condition.

**Native maps/callers:** [poffin common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poffin_common.s#L82).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `POFFIN_HOUSE`.

**Decomp:** Checks for berries first, then free Poffin Case capacity.\
Returns 1 for no berries, 2 for a full case, otherwise 0; it does not reserve ingredients. [src/scrcmd.c:3251–3267](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3251-L3267)

**Dependencies:** New Poffin Case recipes/capacity/save state and cooking app; existing berries/party/menu host.\
**Effort:** 0.25–0.5 d

### `give_poffin` — `0x289`

**Story / impact:** P2 — Optional Veilstone Store B1F vendor and Hearthome Contest Hall Mild Poffin gift; supports Pokémon condition independently of cooking.

**Native maps/callers:** [CONTEST HALL LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L331); [VEILSTONE STORE B1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_store_b1f.s#L270).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`, `VEILSTONE_STORE_B1F`.

**Decomp:** Builds a Poffin from five supplied flavor values and smoothness, then attempts to store it.\
Returns its resulting flavor/type on success or POFFIN_NONE when the case is full. [src/scrcmd.c:6199–6223](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6199-L6223)

**Dependencies:** New Poffin Case recipes/capacity/save state; existing menu host. The gift/vendor command does not depend on the cooking application.\
**Effort:** 0.5–1 d; case/recipe/save foundation 2–3 d

### `check_has_empty_poffin_case_slot` — `0x28A`

**Story / impact:** P2 — Optional Hearthome cooking/gift and Veilstone basement vendor; supports contest condition.

**Native maps/callers:** [CONTEST HALL LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L284).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Checks the saved case for an empty Poffin slot.\
Writes true if a slot exists, false otherwise; no reservation or grant occurs. [src/scrcmd.c:6225–6237](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6225-L6237)

**Dependencies:** New Poffin Case recipes/capacity/save state and cooking app; existing berries/party/menu host.\
**Effort:** 0.25–0.5 d

### `get_empty_poffin_case_slot_count` — `0x307`

**Story / impact:** P2 — Optional Hearthome cooking/gift and Veilstone basement vendor; supports contest condition.

**Native maps/callers:** [VEILSTONE STORE B1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_store_b1f.s#L263).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VEILSTONE_STORE_B1F`.

**Decomp:** Counts empty slots in the saved Poffin Case.\
Writes remaining capacity immediately for the basement vendor. [src/scrcmd.c:6239–6246](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6239-L6246)

**Dependencies:** New Poffin Case recipes/capacity/save state and cooking app; existing berries/party/menu host.\
**Effort:** 0.25–0.5 d

<a id="system-40"></a>

## Pokémon News Press

### `get_random_seen_species` — `0x218`

**Story / impact:** P2 — Optional Solaceon newspaper daily request.

**Native maps/callers:** [SOLACEON TOWN POKEMON NEWS PRESS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_town_pokemon_news_press.s#L31).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `SOLACEON_TOWN_POKEMON_NEWS_PRESS`.

**Decomp:** Chooses uniformly from seen Pokémon that belong to the Sinnoh Pokédex.\
Writes the requested species for the newspaper task; the decomp initializes a Pikachu fallback. [src/scrcmd.c:5365–5386](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5365-L5386)

**Dependencies:** Existing Pokédex/seen flags, regional Dex mapping and seeded RNG.\
**Effort:** 0.25–0.5 d

<a id="system-41"></a>

## Pokémon forms

### `change_deoxys_form` — `0x263`

**Story / impact:** P2 — Optional Veilstone meteorites; obtaining Deoxys is event/transfer-dependent.

**Native maps/callers:** [VEILSTONE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city.s#L1287).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `VEILSTONE_CITY`.

**Decomp:** Changes every party Deoxys to the requested meteorite form.\
Recalculates level/stats and records the form in the Pokédex, then yields once. [src/scrcmd.c:5752–5770](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5752-L5770)

**Dependencies:** Existing party/forms/stats/Pokédex; add species-specific form and move rules.\
**Effort:** 0.5 d

### `get_rotom_forms_in_save` — `0x302`

**Story / impact:** P2 — Optional Secret Key Rotom appliance room; event access is required.

**Native maps/callers:** [ROTOMS ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rotoms_room.s#L36).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROTOMS_ROOM`.

**Decomp:** Checks all saved Pokémon for non-base Rotom forms and decodes the result bitmask.\
Writes one boolean for each appliance form, then yields once. [src/scrcmd.c:6901–6939](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6901-L6939)

**Dependencies:** Existing party/boxes/forms; all-save Rotom form scan and appliance occupancy mapping.\
**Effort:** 0.5 d

### `get_party_rotom_count_and_first` — `0x303`

**Story / impact:** P2 — Optional species-form interactions; special-event access may be required.

**Native maps/callers:** [ROTOMS ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rotoms_room.s#L119).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ROTOMS_ROOM`.

**Decomp:** Counts non-egg party Rotom currently in appliance forms.\
Returns the count plus the first matching slot, or PARTY_SLOT_NONE if absent. [src/overlay005/ov5_021F6454.c:585–614](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L585-L614)

**Dependencies:** Existing party/forms/stats/Pokédex; add species-specific form and move rules.\
**Effort:** 0.25–0.5 d

### `set_rotom_form` — `0x304`

**Story / impact:** P2 — Optional Secret Key Rotom appliance room; event access is required.

**Native maps/callers:** [ROTOMS ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rotoms_room.s#L160).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `ROTOMS_ROOM`.

**Decomp:** Sets the selected party Rotom’s form and updates its appliance move, using an empty move slot or the supplied replacement slot; the third operand is unused.\
Removes or replaces the prior appliance move, ensures a first move with ThunderShock when needed, and recalculates ability and stats. [src/overlay005/ov5_021F6454.c:616–631](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L616-L631); [src/pokemon.c:4520–4592](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokemon.c#L4520-L4592)

**Dependencies:** Existing party/forms/stats/Pokédex; add species-specific form and move rules.\
**Effort:** 0.5–1 d

<a id="system-42"></a>

## Pokémon previews

### `draw_pokemon_preview` — `0x208`

**Story / impact:** P2 — Optional mansion book (Manaphy), Mesprit and postgame Cresselia previews; Manaphy sighting supports National Dex completion.

**Native maps/callers:** [FULLMOON ISLAND FOREST](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_fullmoon_island_forest.s#L17); [POKEMON MANSION OFFICE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_mansion_office.s#L306); [VERITY CAVERN](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_verity_cavern.s#L18).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `FULLMOON_ISLAND_FOREST`, `POKEMON_MANSION_OFFICE`, `VERITY_CAVERN`.

**Decomp:** Draws a framed preview of the requested species and gender.\
Also marks that species seen immediately; no battle starts. [src/scrcmd.c:3000–3011](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3000-L3011)

**Dependencies:** Existing Pokémon sprites, Pokédex and field UI; new preview lifecycle/animation completion state.\
**Effort:** 0.5–1 d; preview foundation 1–2 d

### `remove_pokemon_preview` — `0x209`

**Story / impact:** P2 — Optional book/roamer/Chatot preview presentation; preview may also register the species as seen.

**Native maps/callers:** [FULLMOON ISLAND FOREST](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_fullmoon_island_forest.s#L19); [POKEMON MANSION OFFICE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_mansion_office.s#L308); [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L48); [VERITY CAVERN](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_verity_cavern.s#L20).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `FULLMOON_ISLAND_FOREST`, `POKEMON_MANSION_OFFICE`, `VERITY_CAVERN`.

**Decomp:** Changes the active Pokémon preview’s state to request removal.\
Yields once; the preview task performs its own cleanup. [src/scrcmd.c:3027–3035](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3027-L3035)

**Dependencies:** Existing Pokémon sprites, Pokédex and field UI; new preview lifecycle/animation completion state.\
**Effort:** 0.25–0.5 d

### `draw_pokemon_preview_from_party_slot` — `0x28C`

**Story / impact:** P2 — Optional book/roamer/Chatot preview presentation; preview may also register the species as seen.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L12).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Draws the actual selected party Pokémon in the preview window.\
Also marks its species seen; retains preview state for animation/removal. [src/scrcmd.c:3013–3025](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3013-L3025)

**Dependencies:** Existing Pokémon sprites, Pokédex and field UI; new preview lifecycle/animation completion state.\
**Effort:** 0.25–0.5 d

### `set_pokemon_preview_anim` — `0x28D`

**Story / impact:** P2 — Optional book/roamer/Chatot preview presentation; preview may also register the species as seen.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L38).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Requests the active preview Pokémon’s animation state.\
Yields once while its preview task performs the animation. [src/scrcmd.c:3037–3045](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3037-L3045)

**Dependencies:** Existing Pokémon sprites, Pokédex and field UI; new preview lifecycle/animation completion state.\
**Effort:** 0.25–0.5 d

### `wait_pokemon_preview_anim` — `0x28E`

**Story / impact:** P2 — Optional book/roamer/Chatot preview presentation; preview may also register the species as seen.

**Native maps/callers:** [record chatot cry (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_record_chatot_cry.s#L41).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Installs a pause callback waiting for the active preview animation to finish.\
Resumes only after completion; its immediate operand is unused. [src/scrcmd.c:3047–3056](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3047-L3056)

**Dependencies:** Existing Pokémon sprites, Pokédex and field UI; new preview lifecycle/animation completion state.\
**Effort:** 0.25–0.5 d

<a id="system-43"></a>

## Regi event ruins

### `activate_regi_ruins_dot` — `0x32C`

**Story / impact:** P2 — Iron/Rock Peak/Iceberg Ruins event-Regigigas puzzles; optional, with map access varying before/after Champion.

**Native maps/callers:** [ICEBERG RUINS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iceberg_ruins.s#L133); [IRON RUINS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_ruins.s#L133); [ROCK PEAK RUINS](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_rock_peak_ruins.s#L133).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ICEBERG_RUINS`, `IRON_RUINS`, `ROCK_PEAK_RUINS`.

**Decomp:** For the selected ruin, matches X/Z against its seven authored floor dots and ORs the matching bit into the caller’s state, playing a step sound on a match.\
When all seven bits are set, replaces the mask with the activated-all-dots sentinel; it does not itself spawn or battle a Regi. [src/overlay005/ov5_021F6454.c:863–912](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L863-L912)

**Dependencies:** Imported dot-coordinate tables, existing script vars/player position and sound; event eligibility handled by caller.\
**Effort:** 0.5–1 person-day

<a id="system-44"></a>

## Seals and Ball Capsules

### `count_seal_occurence` — `0x093`

**Story / impact:** P2 — Optional Solaceon seals and Ball Capsule editing; no badge/story dependency.

**Native maps/callers:** [SOLACEON TOWN EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_town_east_house.s#L33).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `SOLACEON_TOWN_EAST_HOUSE`.

**Decomp:** Counts a seal type across both loose inventory and assigned capsules.\
Writes the combined count immediately. [src/scrcmd.c:2552–2561](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2552-L2561); [src/ball_seal_info.c:198–207](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/ball_seal_info.c#L198-L207)

**Dependencies:** New Seal Case counts/capsule placements and save fields; existing party, shop and menu host.\
**Effort:** 0.25–0.5 d

### `give_or_take_seal` — `0x094`

**Story / impact:** P2 — Optional Solaceon seals and Ball Capsule editing; no badge/story dependency.

**Native maps/callers:** [SOLACEON TOWN EAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_town_east_house.s#L43).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `SOLACEON_TOWN_EAST_HOUSE`.

**Decomp:** Adds or removes the signed quantity of a seal type.\
The helper enforces loose-stock removal and the overall per-type cap; the command ignores its success flag. [src/scrcmd.c:2563–2570](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2563-L2570); [src/ball_seal_info.c:108–132](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/ball_seal_info.c#L108-L132)

**Dependencies:** New Seal Case counts/capsule placements and save fields; existing party, shop and menu host.\
**Effort:** 0.25–0.5 d

### `open_seal_capsule_editor` — `0x0A9`

**Story / impact:** P2 — Optional Solaceon seals and Ball Capsule editing; no badge/story dependency.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1097).

**Coverage:** 2 ROM-wide instruction sites; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Starts the Ball Capsule editor against the saved Seal Case.\
Yields to the field task until editing finishes. [src/scrcmd.c:3221–3225](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3221-L3225)

**Dependencies:** New Seal Case counts/capsule placements and save fields; existing party, shop and menu host.\
**Effort:** 1–2 d; capsule/save/editor foundation 4–7 d

### `poke_mart_seal` — `0x14A`

**Story / impact:** P2 — Optional Sunyshore Market weekday seal seller; duplicate city-labelled merchant scripts are unused.

**Native maps/callers:** [SUNYSHORE CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L592); [SUNYSHORE MARKET](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_market.s#L93).

**Coverage:** 14 ROM-wide instruction sites; zone-root maps: `SUNYSHORE_MARKET`.

**Decomp:** Starts the seal mart with the selected Sunyshore daily stock table.\
Yields through the shop; purchases update Seal Case inventory rather than Bag items. [src/scrcmd_shop.c:115–121](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_shop.c#L115-L121)

**Dependencies:** New Seal Case counts/capsule placements and save fields; existing party, shop and menu host.\
**Effort:** 0.5–1 d

### `count_unique_seals_in_seal_case` — `0x2AB`

**Story / impact:** P2 — Optional Solaceon seals and Ball Capsule editing; no badge/story dependency.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1093).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Counts distinct seal types owned, including seals assigned to capsules.\
Writes the distinct-type count for the shared Ball Capsule menu. [src/scrcmd.c:2542–2550](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2542-L2550); [src/ball_seal_info.c:184–207](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/ball_seal_info.c#L184-L207)

**Dependencies:** New Seal Case counts/capsule placements and save fields; existing party, shop and menu host.\
**Effort:** 0.25–0.5 d

<a id="system-45"></a>

## Shops and exchanges

### `poke_mart_decor` — `0x149`

**Story / impact:** P2 — Veilstone Department Store 4F decoration vendors; optional.

**Native maps/callers:** [VEILSTONE STORE 4F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_store_4f.s#L96).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `VEILSTONE_STORE_4F`.

**Decomp:** Opens a decoration-mode shop using the selected fixed Veilstone 4F stock.\
Both actual vendor IDs enable purchase-count recording; the shop field task holds control until shopping finishes. [src/scrcmd_shop.c:96–112](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_shop.c#L96-L112)

**Dependencies:** Existing mart app/money; decoration inventory and prices, accessory stock imports and purchase records.\
**Effort:** 1–2 person-days

<a id="system-46"></a>

## Spiritomb and Underground encounters

### `get_spiritomb_counter` — `0x214`

**Story / impact:** P2 — Route209 Hallowed Tower/Spiritomb side quest; optional.

**Native maps/callers:** [ROUTE 209](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_209.s#L64).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_209`.

**Decomp:** Reads the saved Spiritomb interaction counter and writes it to the supplied script variable.\
Makes no encounter check or increment itself; the Route209 script interprets the value. [src/scrcmd.c:5357–5363](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5357-L5363)

**Dependencies:** Saved system variable and Underground distinct-player-interaction producer (wireless scope limitation).\
**Effort:** 0.25–0.5 person-day for read; interaction producer depends on Underground scope

### `clear_spiritomb_counter` — `0x26F`

**Story / impact:** P2 — Route209 Hallowed Tower/Spiritomb side quest; optional.

**Native maps/callers:** [ROUTE 209](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_209.s#L82).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_209`.

**Decomp:** Sets the saved Spiritomb encounter-interaction counter to zero.\
Returns synchronously; does not remove the Odd Keystone, clear other quest flags or create an encounter. [src/scrcmd.c:5932–5936](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5932-L5936)

**Dependencies:** Same saved Spiritomb counter as the query command.\
**Effort:** 0.25 person-day

<a id="system-47"></a>

## Super Contests

### `message_synchronized` — `0x02F`

**Story / impact:** P2 — Contest ceremony dialogue; optional Hearthome activity, scope decision pending.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L547).

**Coverage:** 16 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Without an initialized communication session, prints the normal skippable current-bank message.\
In a communication session it forces fast printing and automatic scrolling with manual acceleration disabled, then waits for printing to finish. [src/scrcmd.c:1367–1386](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1367-L1386)

**Dependencies:** Existing message printer; communication-session state and auto-scroll options; Contest flow foundation.\
**Effort:** 0.5–1 person-day after shared Contest UI exists

### `change_into_contest_attire` — `0x0C6`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L619).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Starts the field task that changes the player into contest attire.\
Yields through the costume-change sequence. [src/scrcmd.c:3701–3705](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3701-L3705); [src/overlay005/ov5_021DFB54.c:1518–1567](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021DFB54.c#L1518-L1567)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.5–1 d

### `new_contest` — `0x0FA`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L541).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Creates a contest session from category, rank, competition mode and selected party Pokémon.\
Includes trainer identity, completion/National Dex flags, photos, options and Chatot cry; stores the session immediately. [src/scrcmd_contests.c:59–93](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L59-L93)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.5–1 d; full solo contest foundation 25–45 d

### `end_contest` — `0x0FB`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L661).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Finalizes contest results, then frees the retained session.\
Official results can award ribbons, update records/TV/Pokédex/photos/friendship; individual practice rounds skip these awards. [src/scrcmd_contests.c:95–105](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L95-L105); [src/contest.c:1536–1631](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1536-L1631)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 1–2 d

### `buffer_contestant_trainer_name` — `0x0FD`

**Story / impact:** P2 — Contest introductions and result announcements; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L549).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Uses the active Contest and entry number to resolve the contestant trainer’s display name.\
Places it in a variable-selected string-template slot and continues synchronously. [src/scrcmd_contests.c:119–129](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L119-L129); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Contest entrants including NPC/link trainer profiles; existing templates.\
**Effort:** 0.25–0.5 person-day after Contest context

### `buffer_contestant_mon_name` — `0x0FE`

**Story / impact:** P2 — Contest dialogue naming entrants’ Pokémon; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L550).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Resolves the contestant’s Pokémon nickname from the active Contest and registration entry number.\
Buffers it into the chosen template slot without opening dialogue or waiting. [src/scrcmd_contests.c:131–141](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L131-L141); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Contest entry-to-Pokémon mapping and nickname data; existing templates.\
**Effort:** 0.25–0.5 person-day after Contest context

### `buffer_contest_registration_entry_number` — `0x0FF`

**Story / impact:** P2 — Contest registration and entrant introduction dialogue; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L546).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Buffers the provided entry number as a numeric template value with a one-digit minimum width.\
It does not look up or assign an entrant; it only formats the already supplied number. [src/scrcmd_contests.c:143–152](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L143-L152)

**Dependencies:** Existing variable resolution and numeric message templates; no Contest engine dependency for the command itself.\
**Effort:** 0.25 person-day

### `run_contest_application` — `0x101`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L650).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Runs the contest application using the retained session.\
Yields to the visual/dance/acting competition task until it returns. [src/scrcmd_contests.c:170–176](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L170-L176)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 1–2 d integration; shared solo minigames included in contest foundation

### `buffer_contest_rank` — `0x102`

**Story / impact:** P2 — Contest opening announcements; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L695).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Reads the current Contest’s rank and buffers its localized name into the requested template slot.\
Runs synchronously and does not change the rank or start the Contest. [src/scrcmd_contests.c:178–186](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L178-L186); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Contest context rank and localized rank names; template service.\
**Effort:** 0.25–0.5 person-day after Contest context

### `buffer_contest_type` — `0x103`

**Story / impact:** P2 — Contest opening announcements; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L696).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Reads the active Contest category and buffers the corresponding localized type name.\
Only updates the selected template slot; no menu or wait is started. [src/scrcmd_contests.c:188–196](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L188-L196); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Contest category and localized category-name bank; template service.\
**Effort:** 0.25–0.5 person-day after Contest context

### `buffer_winning_contestant_trainer_name` — `0x104`

**Story / impact:** P2 — Contest winner ceremony; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L768).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Resolves the winning entry from the completed Contest and buffers its trainer name.\
The command neither computes results nor awards ribbons; it returns synchronously. [src/scrcmd_contests.c:198–206](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L198-L206); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Contest result ranking, winner entry/profile and template service.\
**Effort:** 0.25–0.5 person-day after Contest results

### `buffer_winning_contestant_mon_name` — `0x106`

**Story / impact:** P2 — Contest winner ceremony; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L769).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Resolves the completed Contest’s winning Pokémon and buffers its name in the selected template slot.\
It relies on the active result context and does not award or modify anything. [src/scrcmd_contests.c:217–225](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L217-L225); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Contest results, winner Pokémon nickname data and template service.\
**Effort:** 0.25–0.5 person-day after Contest results

### `get_player_contest_placement` — `0x107`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L659).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Reads the player Pokémon’s contest placement from the session.\
Writes the zero-based placement immediately; it does not calculate scoring. [src/scrcmd_contests.c:227–234](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L227-L234)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `get_winning_contestant_entry_num` — `0x108`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L760).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Finds the winning contestant and converts it to the ceremony entry number.\
Writes the entry number immediately for winner staging and dialogue. [src/scrcmd_contests.c:236–243](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L236-L243)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `get_contest_registration_entry_num` — `0x109`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L544).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Converts the player’s contestant ID to their registration entry number.\
Writes that number immediately for positioning and dialogue. [src/scrcmd_contests.c:245–252](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L245-L252)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `get_contestant_obj_event_gfx` — `0x10A`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L897).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Looks up the overworld graphics ID for a contestant entry.\
Resolves entry order to contestant identity, then returns the selected character graphic. [src/scrcmd_contests.c:254–262](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L254-L262); [src/contest.c:1235–1242](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1235-L1242)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `get_contestant_mon_contest_fame` — `0x10B`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L704).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Returns the stored contest-fame value of the Pokémon at a contestant entry.\
Resolves ceremony entry order before reading the session value; no fame is awarded here. [src/scrcmd_contests.c:264–272](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L264-L272); [src/contest.c:1244–1248](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1244-L1248)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `get_contest_mode` — `0x10C`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L657).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Classifies the session as link, practice or official.\
Writes the mode immediately; link takes precedence over practice. [src/scrcmd_contests.c:274–281](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L274-L281); [src/contest.c:1250–1261](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1250-L1261)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `check_player_mon_has_ribbon` — `0x10D`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L771).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Checks the player Pokémon for the ribbon matching the session’s category and rank.\
Writes a boolean without awarding or removing a ribbon. [src/scrcmd_contests.c:295–302](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L295-L302); [src/contest.c:1281–1290](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1281-L1290)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `set_ribbon_name` — `0x10E`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L770).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Resolves the category/rank ribbon name into a requested string-template slot.\
Immediate text-buffer operation; no award is made. [src/scrcmd_contests.c:304–312](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L304-L312); [src/contest.c:1292–1319](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1292-L1319)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `get_first_time_victory_accessory` — `0x10F`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L808).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Calculates the category/rank accessory reward for a first-place result.\
Returns 0xFFFF if the player did not win or the accessory will not fit; granting it is separate. [src/scrcmd_contests.c:314–321](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L314-L321); [src/contest.c:1321–1421](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1321-L1421)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25–0.5 d

### `get_contest_info` — `0x110`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L651).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Reads the session’s rank, category, competition mode and party slot.\
Writes all four outputs immediately. [src/scrcmd_contests.c:283–293](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L283-L293)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `start_contest_camera_flash_task` — `0x111`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L705).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Starts the ceremony camera-flash task for a contestant entry.\
Returns immediately while the effect runs. [src/scrcmd_contests.c:339–346](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L339-L346)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.5 d

### `wait_for_contest_camera_flash_task` — `0x112`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L707).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Installs the wait callback for the contest camera-flash effect.\
Script resumes only when that effect’s task has completed. [src/scrcmd_contests.c:348–354](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L348-L354)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25 d

### `stop_h_blank` — `0x113`

**Story / impact:** P2 — Contest scene/application transitions; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L686).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Stops the field’s HBlank callback system.\
Completes synchronously without stopping the Contest, script runner, or ordinary game clock. [src/scrcmd_contests.c:367–371](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L367-L371)

**Dependencies:** Renderer effect-lifecycle abstraction for scanline effects; Contest transition ownership.\
**Effort:** 0.25–0.5 person-day after renderer effect lifecycle

### `start_h_blank` — `0x114`

**Story / impact:** P2 — Contest return-to-field transitions; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L689).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Starts the field HBlank callback system again.\
Returns synchronously; this is renderer callback ownership, not a whole-game pause/resume command. [src/scrcmd_contests.c:373–377](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L373-L377)

**Dependencies:** Same shared renderer scanline-effect lifecycle as stop_h_blank.\
**Effort:** 0.25 person-day after matching stop/start seam

### `get_should_skip_award_ceremony` — `0x115`

**Story / impact:** P2 — Optional Hearthome official/practice contests, ceremony and rewards; not required to face Fantina.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L766).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Skips the award ceremony for link play, an NPC winner, practice or a single-round competition.\
Writes the boolean synchronously; a full solo contest won by the player retains the ceremony. [src/scrcmd_contests.c:379–394](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L379-L394); [src/contest.c:1497–1534](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1497-L1534)

**Dependencies:** New contest session/results, NPC entrants and visual/dance/acting apps; existing party/ribbons/menu host.\
**Effort:** 0.25–0.5 d

### `lock_text_speed` — `0x118`

**Story / impact:** P2 — Contest text-mode setup/cleanup flow; optional.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L660).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Calls the active Contest’s text-speed lock helper.\
That helper sets the global field-text speed lock; no message is printed and no wait occurs. [src/scrcmd_contests.c:331–337](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L331-L337); [src/contest.c:1276–1279](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1276-L1279)

**Dependencies:** Existing text printer; global temporary text-speed override with correct restoration at app/field transitions.\
**Effort:** 0.25–0.5 person-day

### `get_party_mon_contest_stat` — `0x281`

**Story / impact:** P2 — Optional Pastoria scarf judge checks Cool/Beauty/Cute/Smart/Tough thresholds.

**Native maps/callers:** [PASTORIA CITY NORTHEAST HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_northeast_house.s#L130).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `PASTORIA_CITY_NORTHEAST_HOUSE`.

**Decomp:** Reads one of the selected Pokémon’s five contest condition stats.\
Writes the value chosen by category; no judging or condition gain occurs. [src/scrcmd_party.c:331–341](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L331-L341)

**Dependencies:** Existing Pokémon contest condition fields or add their save representation; category mapping.\
**Effort:** 0.25 d

### `start_contest_comm_sync` — `0x0F8`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L552).

**Coverage:** 10 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Starts the requested synchronization barrier only when the Contest is a link Contest.\
For an offline Contest it is deliberately a no-op; this command never waits by itself. [src/scrcmd_contests.c:33–40](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L33-L40); [src/contest.c:1191–1198](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1191-L1198)

**Dependencies:** Contest session object, solo/link distinction, synchronized peers and app/task lifecycle.\
**Effort:** 0.5–1 d once Contests and wireless exist

### `wait_for_comm_sync_state` — `0x0F9`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L553).

**Coverage:** 10 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Pauses until the Contest reports that the requested communication sync state has been reached.\
Offline Contests report synchronized immediately, so solo play must not wait for peers. [src/scrcmd_contests.c:42–51](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L42-L51); [src/scrcmd_contests.c:53–57](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L53-L57); [src/contest.c:1200–1211](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1200-L1211)

**Dependencies:** Contest session object, solo/link distinction, synchronized peers and app/task lifecycle.\
**Effort:** 0.5–1 d once Contests and wireless exist

### `buffer_judge_name` — `0x0FC`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves a judge index and destination template index from script variables.\
Asks the active Contest context to insert the judge’s localized name; no display or wait occurs. [src/scrcmd_contests.c:107–117](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L107-L117); [src/contest.c:1120–1184](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1120-L1184)

**Dependencies:** Active Contest context, judge name data and existing message templates.\
**Effort:** 0.25–0.5 person-day after Contest context

### `wait_for_link_contest_setup` — `0x100`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L574).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Begins link Contest participant/session setup using the active Contest object.\
Pauses until its communication setup task completes; the helper declines setup if communication is uninitialized. [src/scrcmd_contests.c:154–162](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L154-L162); [src/contest.c:970–1000](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L970-L1000); [src/scrcmd_contests.c:164–169](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L164-L169)

**Dependencies:** Contest session object, solo/link distinction, synchronized peers and app/task lifecycle.\
**Effort:** 0.5–1 d once Contests and wireless exist

### `show_link_contest_records` — `0x116`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L1399).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Starts the field task that displays saved link Contest records.\
The record-display task owns the app’s lifetime; no value is returned to the script. [src/scrcmd_contests.c:396–400](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L396-L400)

**Dependencies:** Link Contest record save and result-display app, existing app host.\
**Effort:** 1–2 d once records exist

### `lock_auto_scroll_for_link_contests` — `0x117`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L684).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Sets the global auto-scroll text lock from whether the current Contest uses linked players.\
This locks linked Contest text flow but explicitly leaves offline auto-scroll unlocked. [src/scrcmd_contests.c:323–329](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L323-L329); [src/contest.c:1271–1274](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/contest.c#L1271-L1274)

**Dependencies:** Contest session object, solo/link distinction, synchronized peers and app/task lifecycle.\
**Effort:** 0.5–1 d once Contests and wireless exist

### `scr_cmd_2b0` — `0x2B0`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L757).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Initializes the network status icon renderer.\
No synchronization or connection operation occurs; presentation updates independently afterwards. [src/scrcmd.c:6476–6480](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6476-L6480)

**Dependencies:** Network icon UI/art and current communication status.\
**Effort:** 0.25–0.5 d

### `destroy_network_icon` — `0x2B1`

**Story / impact:** P4 — Optional multiplayer Contest phases; no main-story gate.

**Native maps/callers:** [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L751).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `CONTEST_HALL_LOBBY`.

**Decomp:** Destroys the network status icon renderer.\
No save or session mutation occurs; synchronous presentation cleanup. [src/scrcmd.c:6482–6486](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6482-L6486)

**Dependencies:** Network icon presentation lifecycle.\
**Effort:** 0.25 d

<a id="system-48"></a>

## Town Map and Fly

### `open_region_map` — `0x0AA`

**Story / impact:** P2 — Wall map background-event interaction; optional navigation aid.

**Native maps/callers:** [bg events (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_bg_events.s#L53).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Creates a Town Map context in wall-map mode and launches its application.\
Keeps script-owned context until application exit; the normal application-exit continuation resumes the script. [src/scrcmd.c:3227–3238](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3227-L3238)

**Dependencies:** Existing child-app/menus seam; Town Map region art, location markers and wall-map interaction mode.\
**Effort:** 1–2 person-days after Town Map app; new shared app roughly 3–5 person-days

### `use_fly` — `0x0C2`

**Story / impact:** P4 — No source script callers; ordinary field Fly may use a separate path.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads a destination map and variable-resolved X/Z coordinates and starts a Fly map-change task.\
Uses no warp index and faces down at arrival; the task owns the transition rather than returning a destination/result. [src/scrcmd.c:3647–3655](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3647-L3655)

**Dependencies:** Existing map transitions; Fly departure/arrival effect, temporary field task and valid destination resolution.\
**Effort:** 0.5–1 person-day after field Fly transition foundation

<a id="system-49"></a>

## Trainer battle compatibility

### `message_from_trainer_type` — `0x20C`

**Story / impact:** P2 — Shared trainer-type message common script; map use depends on its callers.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1379).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Uses the target map object’s trainer-type field as an index in the current script message bank.\
Displays that message and pauses until printing finishes. [src/scrcmd.c:1356–1365](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1356-L1365)

**Dependencies:** Existing target object trainer-type metadata and script-bank messages.\
**Effort:** 0.25–0.5 d

### `start_dummy_trainer_battle` — `0x0EF`

**Story / impact:** P4 — No native macro call sites in the pinned script corpus.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Starts a trainer battle against the fixed Youngster Tristan trainer entry.\
Passes the normal script battle-result storage to the encounter task and yields to battle completion. [src/scrcmd_trainer.c:291–297](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_trainer.c#L291-L297)

**Dependencies:** Existing target-object trainer identity, defeated flags and battle host.\
**Effort:** 0.25–0.5 d

### `set_target_trainer_defeated` — `0x0F0`

**Story / impact:** P4 — No native macro call sites in the pinned script corpus.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves the current script target object to its local trainer ID and marks that trainer defeated.\
Writes the normal defeated-trainer flag synchronously; does not run a battle. [src/scrcmd_trainer.c:299–308](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_trainer.c#L299-L308)

**Dependencies:** Existing target-object trainer identity, defeated flags and battle host.\
**Effort:** 0.25–0.5 d

### `go_to_if_target_trainer_defeated` — `0x0F1`

**Story / impact:** P4 — No native macro call sites in the pinned script corpus.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Checks whether the current target object’s trainer is defeated.\
If true jumps to the relative script offset and yields once; otherwise execution continues in place. [src/scrcmd_trainer.c:310–327](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_trainer.c#L310-L327)

**Dependencies:** Existing target-object trainer identity, defeated flags and battle host.\
**Effort:** 0.25–0.5 d

<a id="system-50"></a>

## Underground

### `send_good_to_pc` — `0x083`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L703).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`, `ETERNA_CITY_UNDERGROUND_MAN_HOUSE`, `HEARTHOME_CITY`.

**Decomp:** Attempts to append one good to Underground PC storage.\
Writes success/failure; the second input is unused. [src/scrcmd_underground_inventory.c:13–25](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L13-L25)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d; inventory/save foundation 2–4 d

### `check_has_room_for_goods_in_pc` — `0x085`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [ETERNA CITY UNDERGROUND MAN HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L296); [HEARTHOME CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L250).

**Coverage:** 15 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_UNDERGROUND_MAN_HOUSE`, `HEARTHOME_CITY`.

**Decomp:** Checks whether Underground PC goods storage has room.\
Writes the capacity result without granting an item; quantity-like operands are unused by this implementation. [src/scrcmd_underground_inventory.c:37–49](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L37-L49); [src/underground.c:374–382](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground.c#L374-L382)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `give_trap` — `0x087`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L717).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ETERNA_CITY_UNDERGROUND_MAN_HOUSE`.

**Decomp:** Attempts to add one trap to its separate Underground inventory.\
Returns whether insertion succeeds; no trap is placed in the field. [src/scrcmd_underground_inventory.c:61–73](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L61-L73)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `give_sphere` — `0x08F`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L730).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ETERNA_CITY_UNDERGROUND_MAN_HOUSE`.

**Decomp:** Attempts to add a sphere with the supplied type and size.\
Writes inventory-insertion success; does not bury or grow a sphere. [src/scrcmd_underground_inventory.c:148–159](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L148-L159)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `underground_npc_message` — `0x19F`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [UNDERGROUND](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_underground.s#L50).

**Coverage:** 15 ROM-wide instruction sites; zone-root maps: `UNDERGROUND`.

**Decomp:** Prints a message from the Underground NPC text bank with the local trainer name buffered.\
Waits for that Underground-specific printer to finish. [src/scrcmd.c:4837–4845](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4837-L4845); [src/underground/vendors.c:542–549](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground/vendors.c#L542-L549)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.5 d

### `close_underground_npc_message` — `0x1A0`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [UNDERGROUND](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_underground.s#L98).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNDERGROUND`.

**Decomp:** Erases the Underground NPC message window.\
Immediate printer-window cleanup, including the Roark introduction. [src/scrcmd.c:4853–4857](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4853-L4857); [src/underground/vendors.c:551–554](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground/vendors.c#L551-L554)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `get_underground_fossils_unearthed` — `0x287`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [HEARTHOME CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L375).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `HEARTHOME_CITY`.

**Decomp:** Reads the saved number of Underground fossils unearthed.\
Writes it immediately for Hearthome’s red-crystal reward. [src/scrcmd.c:6183–6189](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6183-L6189)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `get_underground_traps_set` — `0x288`

**Story / impact:** P2 — Optional Underground tutorial, goods gifts and mission rewards; Explorer Kit receipt alone clears the Eterna story gate.

**Native maps/callers:** [HEARTHOME CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L390).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `HEARTHOME_CITY`.

**Decomp:** Reads the saved Underground traps-set counter.\
Writes it immediately for Hearthome’s yellow-crystal reward. [src/scrcmd.c:6191–6197](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6191-L6197)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `dummy19_e` — `0x19E`

**Story / impact:** P4 — Only unused Underground vendor-script entries call this native dummy.

**Native maps/callers:** [UNDERGROUND](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_underground.s#L55).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `UNDERGROUND`.

**Decomp:** Calls an intentionally empty native vendor constructor, then polls its dummy result.\
The helper always returns 0xFFFE, so this unused path never resumes; it is not the live vendor implementation. [src/scrcmd.c:4809–4821](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4809-L4821); [src/scrcmd.c:4823–4835](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4823-L4835); [src/underground/vendors.c:523–540](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground/vendors.c#L523-L540)

**Dependencies:** Existing VM logging/coverage and unused-entry isolation; the native dummy itself needs no real Underground vendor or inventory implementation.\
**Effort:** 0.25 d to document/preserve unused semantics

### `buffer_treasure_name_for_underground_vendor_unused` — `0x1A1`

**Story / impact:** P4 — Explicitly unused command; no source callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves a treasure ID and template argument, then asks Underground vendors to set their printer’s treasure-name value.\
Completes synchronously using the vendor printer context rather than opening an ordinary field message. [src/scrcmd.c:4859–4866](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4859-L4866)

**Dependencies:** Underground vendor message context and treasure name bank; Underground scope decision.\
**Effort:** 0.25–0.5 person-day after Underground vendor foundation

### `buffer_trap_name_for_underground_vendor_unused` — `0x1A2`

**Story / impact:** P4 — Explicitly unused command; no source callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves a trap ID and destination argument, then buffers the trap name in the Underground vendor printer.\
Has no display, inventory mutation or asynchronous wait of its own. [src/scrcmd.c:4868–4875](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4868-L4875)

**Dependencies:** Underground vendor printer context and localized trap names.\
**Effort:** 0.25–0.5 person-day after Underground vendor foundation

### `get_captured_flag_count` — `0x24A`

**Story / impact:** P4 — Optional Underground flag missions depend on local wireless, excluded from scope.

**Native maps/callers:** [ETERNA CITY UNDERGROUND MAN HOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L313).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `ETERNA_CITY_UNDERGROUND_MAN_HOUSE`.

**Decomp:** Reads the saved Underground captured-flag count.\
Writes it immediately for the 3/10/50-flag tutorial rewards; flags require multiplayer. [src/scrcmd.c:5600–5611](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5600-L5611)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `get_underground_items_given_away` — `0x286`

**Story / impact:** P4 — Optional Hearthome reward for gifting items to human Underground players; wireless is excluded from scope.

**Native maps/callers:** [HEARTHOME CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L360).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `HEARTHOME_CITY`.

**Decomp:** Reads the saved Underground items-given-away counter.\
Writes it immediately for Hearthome’s pink-crystal reward. [src/scrcmd.c:6175–6181](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6175-L6181)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `get_underground_talk_counter` — `0x293`

**Story / impact:** P4 — Optional reward depends on Underground human-player talk, a wireless feature excluded from scope.

**Native maps/callers:** [HEARTHOME CITY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L345).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `HEARTHOME_CITY`.

**Decomp:** Reads the saved Underground talk counter.\
Writes it immediately for Hearthome’s blue-crystal reward; the count comes from human-player interactions. [src/scrcmd.c:6366–6372](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6366-L6372)

**Dependencies:** New Underground inventories/records/save schema; existing variables, item gifts and text.\
**Effort:** 0.25 d

### `buffer_underground_trap_name_with_article` — `0x33F`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves an Underground trap ID and buffers its localized name with grammatical article.\
Updates a template slot only, without granting a trap or starting a vendor interaction. [src/scrcmd_strings.c:498–507](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L498-L507)

**Dependencies:** Imported Underground trap names/article metadata and existing templates; Underground scope decision.\
**Effort:** 0.25–0.5 person-day

### `buffer_underground_item_name_with_article` — `0x340`

**Story / impact:** P4 — No source script callers.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Resolves an Underground item ID and buffers its localized name with grammatical article.\
Returns synchronously; no inventory or Underground gameplay state changes. [src/scrcmd_strings.c:509–518](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L509-L518)

**Dependencies:** Imported Underground item names/article metadata and existing templates.\
**Effort:** 0.25–0.5 person-day

<a id="system-52"></a>

## Vista Lighthouse binoculars

### `use_vista_lighthouse_binoculars` — `0x27A`

**Story / impact:** P2 — Vista Lighthouse optional telescope view; visiting Volkner does not require using it.

**Native maps/callers:** [VISTA LIGHTHOUSE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_vista_lighthouse.s#L26).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VISTA_LIGHTHOUSE`.

**Decomp:** Temporarily changes to the Pokémon League overlook, hides the player/Pokétch and installs the binocular camera/mask.\
Waits for new A or B, fades away, returns to the saved lighthouse coordinates facing north and restores normal field presentation. [src/scrcmd.c:5996–6002](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5996-L6002); [src/binoculars_vista_lighthouse.c:39–144](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/binoculars_vista_lighthouse.c#L39-L144)

**Dependencies:** Existing map/camera/fade tasks; temporary-map semantics, mask rendering and player/Pokétch visibility restoration.\
**Effort:** 2–3 person-days

<a id="system-53"></a>

## Turnback Cave

### `init_turnback_cave` — `0x285`

**Story / impact:** P3 — Optional Turnback Cave navigation after the main Distortion World arc; not CP16’s required route.

**Native maps/callers:** [TURNBACK CAVE ENTRANCE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_entrance.s#L12); [TURNBACK CAVE PILLAR 1 ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_1_room_1.s#L9); [TURNBACK CAVE PILLAR 1 ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_1_room_2.s#L9); [TURNBACK CAVE PILLAR 1 ROOM 3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_1_room_3.s#L9); [TURNBACK CAVE PILLAR 1 ROOM 4](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_1_room_4.s#L9); [TURNBACK CAVE PILLAR 1 ROOM 5](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_1_room_5.s#L9); [TURNBACK CAVE PILLAR 1 ROOM 6](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_1_room_6.s#L9); [TURNBACK CAVE PILLAR 2 ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_2_room_1.s#L9); [TURNBACK CAVE PILLAR 2 ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_2_room_2.s#L9); [TURNBACK CAVE PILLAR 2 ROOM 3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_2_room_3.s#L9); [TURNBACK CAVE PILLAR 2 ROOM 4](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_2_room_4.s#L9); [TURNBACK CAVE PILLAR 2 ROOM 5](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_2_room_5.s#L9); [TURNBACK CAVE PILLAR 2 ROOM 6](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_2_room_6.s#L9); [TURNBACK CAVE PILLAR 3 ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_3_room_1.s#L9); [TURNBACK CAVE PILLAR 3 ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_3_room_2.s#L9); [TURNBACK CAVE PILLAR 3 ROOM 3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_3_room_3.s#L9); [TURNBACK CAVE PILLAR 3 ROOM 4](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_3_room_4.s#L9); [TURNBACK CAVE PILLAR 3 ROOM 5](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_3_room_5.s#L9); [TURNBACK CAVE PILLAR 3 ROOM 6](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_3_room_6.s#L9); [TURNBACK CAVE PILLAR ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_turnback_cave_pillar_room.s#L11).

**Coverage:** 20 ROM-wide instruction sites; zone-root maps: [R18](#reach-r18) (20 maps).

**Decomp:** Selects the next cave destination from pillars seen, rooms visited and RNG.\
Three pillars route to Giratina, 30 rooms route out; otherwise rolls pillar/maze rooms and rewrites all exits except the entry. [src/scrcmd.c:6085–6173](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6085-L6173)

**Dependencies:** Existing seeded RNG/warps/script vars; add per-instance warp-destination mutation and entry-side detection.\
**Effort:** 1–2 d

<a id="system-54"></a>

## Battle Arcade

### `call_battle_arcade_lobby_function` — `0x2D9`

**Story / impact:** P3 — Optional postgame Battle Arcade challenges.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L95).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `BATTLE_ARCADE`.

**Decomp:** Dispatches Arcade party eligibility, active-streak checks, streak deletion and challenger selection.\
Normal selectors return synchronously; party selection starts its task and yields. [src/scrcmd_battle_arcade.c:72–118](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_arcade.c#L72-L118)

**Dependencies:** New Arcade streak save, eligibility rules, party picker and facility battles.\
**Effort:** 1–2 d after Arcade foundation

### `get_battle_arcade_selected_slots` — `0x2DB`

**Story / impact:** P3 — Optional postgame Battle Arcade challenges.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L138).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_ARCADE`.

**Decomp:** Consumes the Arcade party picker’s confirmed ordered selections as zero-based party slots.\
Cancellation writes PARTY_SLOT_NONE to the first result; the optional third is adjusted only when present, then state is freed. [src/scrcmd.c:2691–2723](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2691-L2723)

**Dependencies:** Ordered party-select result and Arcade slot counts/cancel sentinel.\
**Effort:** 0.25–0.5 d

### `delete_active_battle_arcade_streak` — `0x2DC`

**Story / impact:** P3 — Optional postgame Battle Arcade challenges.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L468).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_ARCADE`.

**Decomp:** Clears the selected mode’s active Arcade streak flag and resets its latest streak to zero.\
Also clears the Wi-Fi active-streak stat when relevant; used after an unsaved challenge exit. [src/scrcmd_battle_arcade.c:120–127](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_arcade.c#L120-L127); [src/scrcmd_battle_arcade.c:129–140](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_arcade.c#L129-L140)

**Dependencies:** New Arcade streak save, eligibility rules, party picker and facility battles.\
**Effort:** 0.5–1 d; shared Arcade facility foundation 5–8 d

### `check_battle_arcade_partner_uses_different_species` — `0x2DA`

**Story / impact:** P4 — Optional linked Arcade multi-challenge entry; wireless excluded.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L229).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_ARCADE`.

**Decomp:** Starts a linked Arcade check using the two locally selected species.\
The task exchanges the partner’s selected species and returns compatibility asynchronously. [src/scrcmd_battle_arcade.c:142–150](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_arcade.c#L142-L150)

**Dependencies:** Arcade multi-party selection and peer species exchange.\
**Effort:** 0.5–1 d; shared Arcade facility foundation 5–8 d

<a id="system-55"></a>

## Battle Castle

### `call_battle_castle_lobby_function` — `0x2D2`

**Story / impact:** P3 — Optional postgame Battle Castle challenges.

**Native maps/callers:** [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L92).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `BATTLE_CASTLE`.

**Decomp:** Dispatches Castle party eligibility, active-streak checks, streak deletion and challenger selection.\
Normal selectors return synchronously; selecting challengers opens its party task and yields. [src/scrcmd_battle_castle.c:72–117](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_castle.c#L72-L117)

**Dependencies:** New Castle persistent challenge/streak save, eligibility rules, party picker and facility battles.\
**Effort:** 1–2 d after Castle foundation

### `get_battle_castle_selected_slots` — `0x2D4`

**Story / impact:** P3 — Optional postgame Battle Castle challenges.

**Native maps/callers:** [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L135).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_CASTLE`.

**Decomp:** Consumes the Castle party picker’s confirmed ordered selections as zero-based party slots.\
Cancellation writes PARTY_SLOT_NONE to the first output; the optional third slot is adjusted only when present, then state is freed. [src/scrcmd.c:2657–2689](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2657-L2689)

**Dependencies:** Ordered party-select result and Castle slot counts/cancel sentinel.\
**Effort:** 0.25–0.5 d

### `delete_active_battle_castle_streak` — `0x2D5`

**Story / impact:** P3 — Optional postgame Battle Castle challenges.

**Native maps/callers:** [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L463).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_CASTLE`.

**Decomp:** Clears the selected mode’s active Castle streak flag, latest streak and Castle Points.\
Resets each Castle rank to one and clears the Wi-Fi active stat when relevant; used after an unsaved exit. [src/scrcmd_battle_castle.c:119–126](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_castle.c#L119-L126); [src/scrcmd_battle_castle.c:128–144](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_castle.c#L128-L144)

**Dependencies:** New Castle persistent challenge/streak save, eligibility rules, party picker and facility battles.\
**Effort:** 0.5–1 d; shared Castle facility foundation 5–8 d

### `check_battle_castle_partner_uses_different_species` — `0x2D3`

**Story / impact:** P4 — Optional linked Castle multi-challenge entry; wireless excluded.

**Native maps/callers:** [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L226).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_CASTLE`.

**Decomp:** Starts a linked Castle check using the two locally selected species.\
The asynchronous task exchanges species with the partner and returns the compatibility result. [src/scrcmd_battle_castle.c:146–154](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_castle.c#L146-L154)

**Dependencies:** Castle multi-party selection and peer species exchange.\
**Effort:** 0.5–1 d; shared Castle facility foundation 5–8 d

<a id="system-56"></a>

## Battle Frontier

### `launch_battle_frontier_scene` — `0x2C4`

**Story / impact:** P3 — Optional postgame Frontier challenges and records.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L295); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L292); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L243); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L412); [BATTLE TOWER ELEVATOR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_elevator.s#L49).

**Coverage:** 7 ROM-wide instruction sites; zone-root maps: `BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER_ELEVATOR`.

**Decomp:** Launches the requested Battle Frontier scene with options, save, map, journal and battle UI context.\
Tower corridor scenes also receive active Tower runtime; retains arguments and waits until the application ends. [src/scrcmd.c:6567–6595](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6567-L6595)

**Dependencies:** New Frontier facilities, streak/record saves, party-selection results and existing battle/app hosts.\
**Effort:** 3–5 d adapter work after facilities; each facility’s gameplay is separate

### `delete_active_battle_factory_streak` — `0x2C5`

**Story / impact:** P3 — Optional postgame Factory penalty after quitting without saving.

**Native maps/callers:** [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L419).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FACTORY`.

**Decomp:** Clears the active Factory streak flag for the selected mode and level bracket.\
Zeros latest streak/trade-count stats, including the Wi-Fi active stat when relevant; no app wait. [src/scrcmd_battle_factory.c:11–37](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_factory.c#L11-L37)

**Dependencies:** Factory mode/level streak flags and Frontier stat indices.\
**Effort:** 0.5–1 d

### `open_frontier_records_app` — `0x2C8`

**Story / impact:** P3 — Optional postgame Frontier challenges and records.

**Native maps/callers:** [battle frontier records (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier_records.s#L198).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`.

**Decomp:** Opens Frontier records for a selected challenge type, facility and optional species.\
Stores the app result/context and pauses until application exit and cleanup. [src/scrcmd.c:6693–6704](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6693-L6704)

**Dependencies:** Frontier facility records and Hall per-species records; record-view app and existing app host.\
**Effort:** 2–3 d once saved records exist

### `get_scratch_off_cards_won_item` — `0x2E4`

**Story / impact:** P3 — Optional postgame Scratch-Off Cards prize delivery.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L55).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Reads the completed scratch-card application’s prize result for a selected card index.\
Returns item ID and quantity from retained app arguments; it does not award the prize or free app state. [src/scrcmd.c:6727–6740](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6727-L6740)

**Dependencies:** New scratch-card minigame result data and existing item-award operations.\
**Effort:** 0.25–0.5 d; shared scratch-card app 3–5 d

<a id="system-57"></a>

## Battle Frontier services

### `message_seen_banlist_species` — `0x1FF`

**Story / impact:** P3 — Optional postgame Battle Frontier reception refusal/rules dialogue.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L122); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L119); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L246); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L231).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: `BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_HALL`, `BATTLE_TOWER`.

**Decomp:** Builds the frontier restriction message using banned species the player has seen.\
Selects the message variant by the number found and waits for printing. [src/scrcmd.c:1271–1287](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1271-L1287)

**Dependencies:** New Frontier eligibility/banlist rules; existing Pokédex/text templates.\
**Effort:** 0.5 d

### `poke_mart_frontier` — `0x2D8`

**Story / impact:** P3 — Battle Frontier BP exchange desks; unused Battle Park script also calls it.

**Native maps/callers:** [BATTLE FRONTIER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier.s#L151); [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L28).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `BATTLE_FRONTIER`, `UNUSED_BATTLE_PARK_EXCHANGE_SERVICE_CORNER`.

**Decomp:** Selects one of two fixed exchange inventories and starts a Frontier-mode shop.\
The shop task handles browsing/purchasing in BP; the command does not increment the regular mart purchase count. [src/scrcmd.c:6634–6691](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6634-L6691)

**Dependencies:** Existing mart and bag; saved BP balance, BP prices and imported stock selectors.\
**Effort:** 1–2 person-days after Frontier currency model

### `open_scratch_off_cards_app` — `0x2E2`

**Story / impact:** P3 — Battle Frontier optional Scratch-Off Cards minigame.

**Native maps/callers:** [BATTLE FRONTIER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier.s#L161); [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L54).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Allocates the Scratch-Off Cards application arguments and opens its child application.\
Pauses until app exit while retaining arguments for subsequent script result/reward handling. [src/scrcmd.c:6706–6714](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6706-L6714)

**Dependencies:** New scratch-card minigame UI/input/prize model and imported art; existing app lifecycle and inventory rewards.\
**Effort:** 4–7 person-days shared minigame foundation

### `free_scratch_off_cards_args` — `0x2E3`

**Story / impact:** P3 — Scratch-Off Cards common-script cleanup after rewards.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L58).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Frees the retained scratch-card application arguments and clears the script-owned pointer.\
Yields once; it does not itself calculate or grant prizes. [src/scrcmd.c:6716–6725](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6716-L6725)

**Dependencies:** Matching scratch-card app result lifetime; separate reward getters must run first.\
**Effort:** 0.25 person-day after minigame

### `judge_stats` — `0x2EE`

**Story / impact:** P3 — Optional Battle Tower stat judge.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L1235).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Sums the selected Pokémon’s six IVs and finds its highest IV.\
Randomly resolves equal maxima during the scan, then writes sum, dialogue-mapped stat and value. [src/overlay005/ov5_021F6454.c:407–449](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L407-L449)

**Dependencies:** Existing party IVs/RNG; imported stat-to-message ordering.\
**Effort:** 0.25–0.5 d

### `get_exchange_service_corner_item_and_cost` — `0x29B`

**Story / impact:** P4 — Only unused Battle Park exchange-map scripts call it; Platinum’s live Frontier shops use other commands.

**Native maps/callers:** [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L54).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Indexes the old Battle Park item/TM prize table by mart type and prize selection.\
Writes the item ID and BP cost; no BP is spent and no item is granted. [src/unk_020494DC.c:473–534](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L473-L534)

**Dependencies:** Imported item/BP-price table and existing variables; no live shop dependency.\
**Effort:** 0.25–0.5 d

<a id="system-58"></a>

## Battle Hall

### `call_battle_hall_lobby_function` — `0x2CC`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [battle frontier records (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier_records.s#L80); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L225).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: `BATTLE_HALL`.

**Decomp:** Dispatches Hall party eligibility, active-streak checks, current streak species, deletion and challenger selection.\
State/query selectors finish synchronously; challenger selection starts its party task and yields. [src/scrcmd_battle_hall.c:80–128](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L80-L128)

**Dependencies:** New Hall challenge/record save, eligibility rules, party picker and Frontier currency.\
**Effort:** 2–3 d after Hall foundation

### `get_battle_hall_selected_slots` — `0x2D0`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L262).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Consumes the Hall party picker’s result, converting confirmed one-based selection order into zero-based party slots.\
Cancellation writes PARTY_SLOT_NONE to the first result; frees selection state afterwards. [src/scrcmd.c:2628–2655](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2628-L2655)

**Dependencies:** Existing ordered party picker with Hall confirmation/cancel result conventions.\
**Effort:** 0.25–0.5 d

### `delete_active_battle_hall_streak` — `0x2D1`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L591).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Clears the selected mode’s active Hall streak flag and resets the latest streak stat to zero.\
Also clears the Wi-Fi active-streak stat for that mode; used after an unsaved challenge exit. [src/scrcmd_battle_hall.c:191–198](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L191-L198); [src/scrcmd_battle_hall.c:650–662](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L650-L662)

**Dependencies:** New Hall challenge/record save, eligibility rules, party picker and Frontier currency.\
**Effort:** 0.5–1 d; shared Hall facility foundation 5–8 d

### `show_battle_hall_record_mon_selection_menu` — `0x2DE`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [battle frontier records (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_frontier_records.s#L111).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Builds an alphabetical species list restricted to Pokémon with nonzero Hall records in the selected mode.\
Adds Exit and waits for selection, preserving list/cursor positions in caller variables; returns the species or cancellation. [src/overlay005/ov5_021F6454.c:123–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L123-L175)

**Dependencies:** Hall per-species records, imported alphabetical species groups/names and existing scrolling list menu.\
**Effort:** 1–2 d

### `get_battle_hall_record_keeper_stats` — `0x324`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L683).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Sums saved single Hall species records, awards newly reached milestone BP and advances the caller’s milestone index.\
Buffers total/passed/next/BP values and returns dialogue status (no record, new reward, unchanged, completed); unavailable records yield zero. [src/scrcmd_battle_hall.c:462–539](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L462-L539)

**Dependencies:** Hall per-species records/misc-save validity, milestone table, BP currency/received record and string templates.\
**Effort:** 1–2 d

### `get_num_species_with_battle_hall_records` — `0x325`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L34).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_HALL`.

**Decomp:** Counts species with any nonzero Hall record across single, double or multi mode.\
Returns zero if the misc save block is absent or records cannot load; otherwise returns that species count. [src/scrcmd_battle_hall.c:541–579](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L541-L579)

**Dependencies:** New Hall challenge/record save, eligibility rules, party picker and Frontier currency.\
**Effort:** 0.5–1 d; shared Hall facility foundation 5–8 d

### `get_battle_hall_total_singles_record` — `0x326`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L71).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Sums every species’ Hall single-mode record.\
Returns zero on unavailable saved records and caps the resulting total at 10,000. [src/scrcmd_battle_hall.c:581–614](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L581-L614)

**Dependencies:** New Hall challenge/record save, eligibility rules, party picker and Frontier currency.\
**Effort:** 0.5–1 d; shared Hall facility foundation 5–8 d

### `check_if_battle_hall_streak_is50` — `0x32A`

**Story / impact:** P3 — Optional postgame Battle Hall entry, streaks and records.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L102).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Reads the latest single Battle Hall streak.\
Returns true only when it equals the silver-Brain battle threshold (50), rather than at least that value. [src/scrcmd_battle_hall.c:616–634](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L616-L634)

**Dependencies:** New Hall challenge/record save, eligibility rules, party picker and Frontier currency.\
**Effort:** 0.5–1 d; shared Hall facility foundation 5–8 d

### `check_battle_hall_partner_uses_different_species` — `0x2CF`

**Story / impact:** P4 — Optional linked Hall multi-challenge entry; wireless excluded.

**Native maps/callers:** [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L371).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_HALL`.

**Decomp:** Starts a linked Hall partner-species compatibility check with the locally selected species.\
The task exchanges partner selection and returns whether species differ; completion is asynchronous. [src/scrcmd_battle_hall.c:200–207](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_battle_hall.c#L200-L207)

**Dependencies:** Hall multi-party selection and peer species exchange with disconnect handling.\
**Effort:** 0.5–1 d; shared Hall facility foundation 5–8 d

<a id="system-59"></a>

## Battle Points

### `show_battle_points` — `0x294`

**Story / impact:** P3 — Optional Frontier prize purchases and scratch-card payment after the story.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L12); [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L46).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Creates the special-currency window at the requested tile coordinates and draws saved Battle Points.\
Keeps the window handle in script state; no task wait. [src/unk_020494DC.c:388–397](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L388-L397)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

### `hide_battle_points` — `0x295`

**Story / impact:** P3 — Optional Frontier prize purchases and scratch-card payment after the story.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L52); [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L73).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Deletes the retained special-currency/BP window.\
Does not modify the saved Battle Point balance; synchronous UI cleanup. [src/unk_020494DC.c:399–406](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L399-L406)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

### `update_bp_display` — `0x296`

**Story / impact:** P3 — Optional Frontier prize purchases and scratch-card payment after the story.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L48); [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L66).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Reprints the current BP balance into the retained currency window.\
Does not create the window or alter currency; synchronous refresh. [src/unk_020494DC.c:408–415](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L408-L415)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

### `remove_battle_points` — `0x299`

**Story / impact:** P3 — Optional Frontier prize purchases and scratch-card payment after the story.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L47); [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L65).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Subtracts the requested BP amount through the saved-currency helper.\
Also adds the amount to the total BP spent game record; no wait. [src/unk_020494DC.c:439–449](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L439-L449)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

### `check_battle_points` — `0x29A`

**Story / impact:** P3 — Optional Frontier prize purchases and scratch-card payment after the story.

**Native maps/callers:** [scratch off cards (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_scratch_off_cards.s#L45); [UNUSED BATTLE PARK EXCHANGE SERVICE CORNER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_unused_battle_park_exchange_service_corner.s#L59).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_FRONTIER`.

**Decomp:** Compares the saved BP balance with the requested cost.\
Writes true when the balance covers the cost, otherwise false; does not spend BP. [src/unk_020494DC.c:451–468](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L451-L468)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

### `get_battle_points` — `0x297`

**Story / impact:** P4 — No native macro callers in the pinned script corpus.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the saved Battle Point balance with the currency helper’s query operation.\
Writes it to the destination without changing records or balance. [src/unk_020494DC.c:417–425](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L417-L425)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

### `give_battle_points` — `0x298`

**Story / impact:** P4 — No native macro callers in the pinned script corpus.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Adds the requested BP amount through the saved-currency helper.\
Also adds the amount to the total BP received game record; no wait. [src/unk_020494DC.c:427–437](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L427-L437)

**Dependencies:** New saved BP balance/caps, earned/spent game records; existing menu window and item award primitives.\
**Effort:** 0.25–0.5 d; shared BP model/window 1–2 d

<a id="system-60"></a>

## Battle Tower

### `open_battle_tower_records_app` — `0x1D9`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L1164).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Launches the Tower records/rankings app with the requested screen type, results type and save.\
Retains its arguments until app exit and pauses through that app lifecycle. [src/scrcmd.c:3269–3288](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3269-L3288)

**Dependencies:** Tower records/rankings save data, records app and existing app host.\
**Effort:** 1–2 d once record save exists

### `set_battle_tower_null` — `0x1DA`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L179).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Clears the field system’s current Battle Tower handle through the Tower helper.\
Returns synchronously; initializes the absence state before selecting or resuming a challenge. [src/unk_020494DC.c:47–51](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L47-L51)

**Dependencies:** New Tower challenge save/runtime, rules and teams, party selection, Frontier records and existing battle host.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

### `init_battle_tower` — `0x1DB`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L89).

**Coverage:** 7 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Creates Battle Tower runtime state from save data, initialization selector and challenge mode.\
The allocated challenge handle is retained on the field system; no implicit application or wait. [src/unk_020494DC.c:38–45](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L38-L45)

**Dependencies:** New Tower challenge save/runtime, rules and teams, party selection, Frontier records and existing battle host.\
**Effort:** 2–4 d once Tower model exists

### `free_battle_tower` — `0x1DC`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L478); [BATTLE TOWER BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_room.s#L116); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L155).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`, `BATTLE_TOWER_BATTLE_ROOM`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`.

**Decomp:** Frees the current Battle Tower runtime object and clears the field’s handle.\
Returns synchronously; does not by itself award prizes or end a challenge in saved state. [src/unk_020494DC.c:53–59](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L53-L59)

**Dependencies:** New Tower challenge save/runtime, rules and teams, party selection, Frontier records and existing battle host.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

### `call_battle_tower_function` — `0x1DD`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L229); [BATTLE TOWER BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_room.s#L18); [BATTLE TOWER BATTLE SALON](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_salon.s#L22); [BATTLE TOWER CORRIDOR MULTI](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_corridor_multi.s#L15); [BATTLE TOWER ELEVATOR](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_elevator.s#L15); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L20).

**Coverage:** 121 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`, `BATTLE_TOWER_BATTLE_ROOM`, `BATTLE_TOWER_BATTLE_SALON`, `BATTLE_TOWER_CORRIDOR_MULTI`, `BATTLE_TOWER_ELEVATOR`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`.

**Decomp:** Dispatches Tower entry eligibility, party selection, duplicate rules, streaks, opponent/partner lookup and challenge bookkeeping.\
Most selectors return/update state synchronously; the party-selection and other app/task selectors yield until their own workflows finish. [src/unk_020494DC.c:61–200](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L61-L200)

**Dependencies:** New Tower challenge save/runtime, rules and teams, party selection, Frontier records and existing battle host.\
**Effort:** 4–7 d after Tower foundation; largest Tower script multiplexer

**Caveat:** Includes opaque numeric selectors; implement selector-by-selector from callees, not a single fake success result.

### `get_battle_tower_partner_species_and_move` — `0x1DE`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER BATTLE SALON](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_salon.s#L145).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER_BATTLE_SALON`.

**Decomp:** Reads one selected NPC partner Pokémon from the active Tower partner data.\
Returns that Pokémon’s species and its first move for the lobby dialogue; no wait. [src/unk_020494DC.c:202–217](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L202-L217)

**Dependencies:** New Tower challenge save/runtime, rules and teams, party selection, Frontier records and existing battle host.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

### `scr_cmd_1df` — `0x1DF`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L119).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Checks single-Tower record streak milestones 20/50/100 against previously claimed milestone prizes.\
Marks a claim when Underground PC goods have space and returns its prize code; returns 4 when storage is full. [src/unk_020494DC.c:219–229](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L219-L229); [src/unk_0206B9D8.c:321–388](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0206B9D8.c#L321-L388)

**Dependencies:** Tower streak record and reward flags, Underground PC goods capacity/prizes.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

### `scr_cmd_1e0` — `0x1E0`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L41).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Reports the next unclaimed Tower milestone prize from single streaks at 20/50/100.\
Returns different codes when a previous storage-full attempt was recorded; this availability query does not claim a prize. [src/unk_020494DC.c:231–241](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L231-L241); [src/unk_0206B9D8.c:390–445](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0206B9D8.c#L390-L445)

**Dependencies:** Tower streak and milestone reward/failed-capacity flags.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

### `print_battle_tower_intro_message` — `0x1FE`

**Story / impact:** P3 — Optional Battle Tower challenges after reaching the Battle Zone.

**Native maps/callers:** [BATTLE TOWER BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_battle_room.s#L94); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L108).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER_BATTLE_ROOM`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`.

**Decomp:** Selects the active Tower opponent’s introduction: a fixed text-bank message or an Easy Chat sentence.\
Shows it and pauses until printing completes; with no active Tower object the command does nothing. [src/scrcmd.c:1247–1269](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1247-L1269)

**Dependencies:** Tower opponent data, Easy Chat sentence formatter, existing message renderer.\
**Effort:** 0.5–1 d

### `scr_cmd_1e1` — `0x1E1`

**Story / impact:** P4 — Optional linked Tower multi-battle setup/decision exchange; wireless excluded.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L802); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L248).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`.

**Decomp:** Builds and sends one of three Tower multiplayer payloads selected by the action operand.\
Reports whether submission succeeded, using the Wi-Fi route or local packet commands 62–64; failed sends must be retried. [src/unk_020494DC.c:243–286](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L243-L286)

**Dependencies:** Tower multi-peer state, local/Wi-Fi payload encoders, send acceptance/retry handling.\
**Effort:** 1–2 d after Tower and networking exist

### `scr_cmd_1e2` — `0x1E2`

**Story / impact:** P4 — Optional linked Tower multi-battle decisions; wireless excluded.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L804); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L249).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`.

**Decomp:** Starts the Tower multiplayer receive operation, selecting Wi-Fi task handling or local packet polling.\
Local mode waits for the expected message count, returns the received decision and resets that counter. [src/unk_020494DC.c:290–309](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L290-L309); [src/unk_020494DC.c:311–331](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L311-L331)

**Dependencies:** Tower linked receive queue/counts and peer decision state, network task lifecycle.\
**Effort:** 1–2 d

### `scr_cmd_1e3` — `0x1E3`

**Story / impact:** P4 — Optional downloaded Wi-Fi Tower leader display; online content excluded.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L635).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Reads the saved downloaded Wi-Fi Tower match indices.\
Writes rank and opponent index into two destinations without launching the network. [src/unk_020494DC.c:333–345](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L333-L345)

**Dependencies:** Downloaded Wi-Fi Tower match-list save.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

### `scr_cmd_1e4` — `0x1E4`

**Story / impact:** P4 — Optional Wi-Fi Tower leaders machine; online content excluded.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L1147).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Checks whether the saved downloaded Wi-Fi Tower match list exists.\
Returns that saved-data validity as a boolean; does not download anything. [src/unk_020494DC.c:347–353](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020494DC.c#L347-L353)

**Dependencies:** Downloaded Wi-Fi Tower match-list validity save.\
**Effort:** 0.5–1 d; shared Tower foundation 12–20 d

<a id="system-61"></a>

## Battleground rematches

### `get_random_battleground_trainers` — `0x2F4`

**Story / impact:** P3 — Postgame Battleground on-transition daily trainer selection; called by Battleground_SetTrainers before actor graphics and visibility are refreshed.

**Native maps/callers:** [BATTLEGROUND](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battleground.s#L32).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLEGROUND`.

**Decomp:** Randomly chooses up to three distinct eligible Gym Leaders plus one eligible stat trainer for the Battleground.\
Initializes missing choices to NONE and returns four trainer IDs; eligibility filtering belongs to its random-choice helpers. [src/scrcmd.c:6761–6794](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6761-L6794)

**Dependencies:** Deterministic RNG, Battleground availability/visited flags and imported trainer candidate lists.\
**Effort:** 0.5–1 d

<a id="system-62"></a>

## Pal Park Catching Show

### `set_clear_in_catching_show_flag` — `0x253`

**Story / impact:** P3 — Optional postgame Pal Park migration/Catching Show; GBA transfer requires a separate scope decision.

**Native maps/callers:** [PAL PARK](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park.s#L35).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `PAL_PARK`.

**Decomp:** Mode zero marks the player in Pal Park and starts the Catching Show; mode one clears the flag and ends it.\
Immediate field/session update; does not itself migrate Pokémon. [src/scrcmd_catching_show.c:24–40](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_catching_show.c#L24-L40)

**Dependencies:** New six-mon migration buffer, Catching Show field/score state and save schema; existing PC/Pokédex.\
**Effort:** 0.5 d; migration/show foundation 6–10 d

### `check_has_enough_mon_for_catching_show` — `0x254`

**Story / impact:** P3 — Optional postgame Pal Park migration/Catching Show; GBA transfer requires a separate scope decision.

**Native maps/callers:** [PAL PARK LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park_lobby.s#L111).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PAL_PARK_LOBBY`.

**Decomp:** Counts Pokémon in the saved Pal Park migration buffer.\
Returns true only when exactly the six Catching Show participants are present. [src/scrcmd_catching_show.c:42–56](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_catching_show.c#L42-L56)

**Dependencies:** New six-mon migration buffer, Catching Show field/score state and save schema; existing PC/Pokédex.\
**Effort:** 0.25–0.5 d

### `move_catching_show_mons_to_pc_boxes` — `0x255`

**Story / impact:** P3 — Optional postgame Pal Park migration/Catching Show; GBA transfer requires a separate scope decision.

**Native maps/callers:** [PAL PARK LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park_lobby.s#L256).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `PAL_PARK_LOBBY`.

**Decomp:** Converts all six migrated Pokémon and stores them into PC boxes, updating met/trainer/catch records.\
Clears the transfer buffer afterward; the caller must have ensured box capacity. [src/scrcmd_catching_show.c:58–79](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_catching_show.c#L58-L79)

**Dependencies:** New six-mon migration buffer, Catching Show field/score state and save schema; existing PC/Pokédex.\
**Effort:** 1–2 d

### `calc_catching_show_points` — `0x256`

**Story / impact:** P3 — Optional postgame Pal Park migration/Catching Show; GBA transfer requires a separate scope decision.

**Native maps/callers:** [PAL PARK LOBBY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pal_park_lobby.s#L219).

**Coverage:** 7 ROM-wide instruction sites; zone-root maps: `PAL_PARK_LOBBY`.

**Decomp:** Returns Catching Show catching, time or type points according to the requested category.\
The total category sums those three components; scoring does not award the prize here. [src/scrcmd_catching_show.c:81–102](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_catching_show.c#L81-L102)

**Dependencies:** New six-mon migration buffer, Catching Show field/score state and save schema; existing PC/Pokédex.\
**Effort:** 0.5 d

<a id="system-63"></a>

## Shaymin event

### `open_shaymin_tablet_naming_screen` — `0x271`

**Story / impact:** P3 — Route224 Oak’s Letter gratitude-tablet event; optional postgame event.

**Native maps/callers:** [ROUTE 224](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_224.s#L88).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `ROUTE_224`.

**Decomp:** Opens the naming application in Shaymin-tablet mode with a ten-character limit.\
On acceptance the naming task persists the tablet text and returns its status through the provided result variable; it waits through the child task. [src/scrcmd.c:3474–3478](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3474-L3478); [src/unk_0203D1B8.c:1142–1200](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1142-L1200)

**Dependencies:** Existing naming keyboard; tablet-name save field/migration and naming mode/result handling.\
**Effort:** 0.5–1 person-day

### `buffer_tablet_name` — `0x272`

**Story / impact:** P3 — Route224 reads the engraved gratitude-tablet name; optional postgame event.

**Native maps/callers:** [ROUTE 224](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_224.s#L62).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `ROUTE_224`.

**Decomp:** Reads the persisted tablet text from the miscellaneous save block.\
Buffers it into the requested string-template argument, preserving game-language formatting; no naming screen opens. [src/scrcmd_strings.c:399–413](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_strings.c#L399-L413)

**Dependencies:** Tablet-name state from naming command; existing template service.\
**Effort:** 0.25 person-day

### `set_player_volume` — `0x333`

**Story / impact:** P3 — Route224 Oak’s Letter sequence audio duck/restore; optional postgame event.

**Native maps/callers:** [ROUTE 224](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_224.s#L104).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `ROUTE_224`.

**Decomp:** Sets the field sound player’s volume to the variable-resolved value.\
Completes synchronously without changing BGM identity or starting a fade. [src/overlay005/ov5_021F6454.c:1081–1087](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L1081-L1087)

**Dependencies:** Existing audio host; per-field-player gain control distinct from global user volume.\
**Effort:** 0.25–0.5 person-day

<a id="system-64"></a>

## Trophy Garden

### `add_trophy_garden_mon` — `0x1EC`

**Story / impact:** P3 — Optional National Dex Trophy Garden daily guest-species conversation.

**Native maps/callers:** [POKEMON MANSION OFFICE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_mansion_office.s#L71).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `POKEMON_MANSION_OFFICE`.

**Decomp:** Rolls a new special encounter species distinct from both existing guest species.\
Shifts the two saved guest slots; daily eligibility is enforced by the script, not this command. [src/scrcmd.c:5191–5195](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5191-L5195); [src/overlay006/trophy_garden_daily_encounters.c:14–46](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/trophy_garden_daily_encounters.c#L14-L46)

**Dependencies:** New two-slot guest-species state and imported encounter pool; existing daily clock, RNG and wild encounters.\
**Effort:** 0.5–1 d; guest-table/save/encounter foundation 1–2 d

### `get_trophy_garden_slot1_species` — `0x1ED`

**Story / impact:** P3 — Optional National Dex Trophy Garden daily guest-species conversation.

**Native maps/callers:** [POKEMON MANSION OFFICE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_mansion_office.s#L72).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `POKEMON_MANSION_OFFICE`.

**Decomp:** Reads the current first Trophy Garden guest slot and resolves its species from the encounter table.\
Writes the species immediately; assumes a guest has already been installed. [src/scrcmd.c:5197–5203](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5197-L5203); [src/overlay006/trophy_garden_daily_encounters.c:48–63](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/trophy_garden_daily_encounters.c#L48-L63)

**Dependencies:** New two-slot guest-species state and imported encounter pool; existing daily clock, RNG and wild encounters.\
**Effort:** 0.25–0.5 d

<a id="system-65"></a>

## Villa

### `init_persisted_map_features_for_villa` — `0x2F0`

**Story / impact:** P3 — Resort Area Villa initialization; optional postgame home.

**Native maps/callers:** [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L53).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `VILLA`.

**Decomp:** Selects the Villa persisted-feature buffer and zero-initializes its Villa-specific dynamic data.\
Returns synchronously; furniture inventory and guest/story flags are separate save state. [src/scrcmd.c:4774–4778](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4774-L4778); [src/persisted_map_features_init.c:130–137](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L130-L137)

**Dependencies:** Existing persisted features seam; new Villa dynamic-state shape and corresponding furniture/guest renderer foundation.\
**Effort:** 0.5–1 person-day after Villa model

### `set_scene_play_bgm_music_box` — `0x2F8`

**Story / impact:** P3 — Villa music-box interaction; optional postgame furniture.

**Native maps/callers:** [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L1012).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Changes the sound scene to the Villa music-box scene and requests the named town-music sequence with parameter one.\
Yields once without waiting for music completion; it does not open a furniture menu. [src/scrcmd_sound.c:217–221](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L217-L221)

**Dependencies:** Existing audio host and imported town track; semantic music-scene/priority handling.\
**Effort:** 0.25–0.5 person-day

### `set_field_scene` — `0x2F9`

**Story / impact:** P3 — Villa returns from music-box playback to field music; optional postgame.

**Native maps/callers:** [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L1030).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Resolves the requested BGM ID and switches the audio engine to the field scene with parameter one.\
Yields once and does not wait for the track to end. [src/scrcmd_sound.c:223–229](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L223-L229)

**Dependencies:** Existing audio playback host and correct scene-aware BGM switching.\
**Effort:** 0.25–0.5 person-day

### `check_ab_press` — `0x2FC`

**Story / impact:** P3 — Villa furniture/music interaction input polling; optional postgame.

**Native maps/callers:** [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L1022).

**Coverage:** 1 ROM-wide instruction site; no zone-root path. Reached through extra entry/service roots.

**Decomp:** Writes true if A or B is currently held, otherwise false.\
This is a synchronous level-triggered poll, unlike wait commands that require a newly pressed edge. [src/scrcmd.c:6884–6899](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6884-L6899)

**Dependencies:** Existing input held-state exposed to VM.\
**Effort:** 0.25 person-day

### `check_met_furniture_requirements` — `0x30F`

**Story / impact:** P3 — Optional postgame Resort Area Villa catalogue unlocks.

**Native maps/callers:** [VILLA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_villa.s#L1761).

**Coverage:** 7 ROM-wide instruction sites; zone-root maps: `VILLA`.

**Decomp:** Checks the selected Villa furniture unlock condition against Frontier wins/prints or lifetime game records.\
Requirements cover all-facility wins, a silver print, ten Hall of Fame entries, fifty Battleground battles, berries, eggs and steps; returns a boolean. [src/overlay005/ov5_021F6454.c:741–826](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L741-L826)

**Dependencies:** Existing lifetime game records; Frontier victories/prints and saved Villa furniture state.\
**Effort:** 0.5–1 d

<a id="system-66"></a>

## Wireless sessions

### `set_comm_player_dir` — `0x152`

**Story / impact:** P4 — Underground Roark introduction; optional Explorer Kit branch (CP7).

**Native maps/callers:** [UNDERGROUND](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_underground.s#L176).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNDERGROUND`.

**Decomp:** Sets the communication player’s facing direction from the literal operand.\
Returns synchronously; affects the network/Underground player representation rather than ordinary script movement. [src/scrcmd.c:4551–4555](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4551-L4555)

**Dependencies:** Underground communication-player actor, direction and local/network synchronization.\
**Effort:** 0.25–0.5 d after Underground actors exist

### `scr_cmd_0a2` — `0x0A2`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [communication club (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_communication_club.s#L23).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `COMMUNICATION_CLUB_COLOSSEUM_2P`, `COMMUNICATION_CLUB_COLOSSEUM_4P`.

**Decomp:** Runs the post-session friend-registration task, comparing connected trainers with the saved friend list.\
Prompts to register eligible friends, including replacement when the list is full; nested task owns completion. [src/scrcmd.c:2968–2972](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2968-L2972); [src/overlay005/ov5_021EA874.c:57–164](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021EA874.c#L57-L164); [src/overlay005/ov5_021EA874.c:368–485](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021EA874.c#L368-L485)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `scr_cmd_0a3` — `0x0A3`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L465); [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L231).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: [R02](#reach-r02) (18 maps).

**Decomp:** Starts the communication-menu task in mode 2, passing the current save into the Wi-Fi activity flow.\
The task runs child applications and returns to the field after the chosen activity; the command itself has no output. [src/scrcmd.c:2974–2978](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2974-L2978); [src/unk_0207DA28.c:97–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0207DA28.c#L97-L175); [src/unk_0207DA28.c:309–324](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0207DA28.c#L309-L324)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 2–4 d once wireless/app adapters exist

### `try_start_gts_app` — `0x0B2`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L189).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GLOBAL_TERMINAL_1F`.

**Decomp:** Checks the saved Wi-Fi login; reports false immediately if it is absent.\
Otherwise reports true, launches GTS with the requested connection mode and waits for app exit. [src/scrcmd.c:3368–3382](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3368-L3382)

**Dependencies:** Wi-Fi login/profile, new GTS service protocol, deposits/trades, party/PC ownership and GTS app.\
**Effort:** 5–10 d after shared networking; external compatible service required

### `scr_cmd_0b3` — `0x0B3`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L585); [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1619); [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L187); [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L422); [WIFI PLAZA ENTRANCE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_wifi_plaza_entrance.s#L71).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `BATTLE_TOWER`, `GLOBAL_TERMINAL_1F`, `GLOBAL_TERMINAL_2F`, `GLOBAL_TERMINAL_3F`, `WIFI_PLAZA_ENTRANCE`.

**Decomp:** Starts the common communication launcher in mode 1 and supplies a destination variable.\
A valid login can bypass setup; the launcher returns its connection/setup result after its application flow. [src/scrcmd.c:3384–3388](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3384-L3388); [src/unk_0207DA28.c:97–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0207DA28.c#L97-L175); [src/unk_0207DA28.c:317–324](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0207DA28.c#L317-L324)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `start_battle_client` — `0x0F2`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L189); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L186); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L170); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L333); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L759); [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L505); [poffin common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poffin_common.s#L123); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L248).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: [R03](#reach-r03) (25 maps).

**Decomp:** Starts a joiner communication lobby with a requested activity type and two activity parameters.\
Waits until the client lobby has a nonzero return code, writes it to the destination and deletes the lobby. [src/scrcmd.c:3804–3817](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3804-L3817); [src/scrcmd.c:3804–3832](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3804-L3832); [src/overlay007/communication_club.c:1590–1619](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay007/communication_club.c#L1590-L1619)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `start_battle_server` — `0x0F3`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L209); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L206); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L199); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L353); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L779); [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L524); [poffin common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poffin_common.s#L144); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L281).

**Coverage:** 9 ROM-wide instruction sites; zone-root maps: [R03](#reach-r03) (25 maps).

**Decomp:** Starts a leader communication lobby with a requested activity type and two activity parameters.\
Waits until the server lobby has a nonzero return code, writes it to the destination and deletes the lobby. [src/scrcmd.c:3834–3847](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3834-L3847); [src/scrcmd.c:3834–3862](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3834-L3862); [src/overlay007/communication_club.c:1621–1652](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay007/communication_club.c#L1621-L1652)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `start_link_battle` — `0x0F6`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L352); [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L166).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Starts a trainer/link battle using the order selected by the retained party-menu result.\
Frees that selection data after passing it to the encounter task; battle/task lifecycle owns completion. [src/scrcmd.c:3880–3891](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3880-L3891)

**Dependencies:** Peer battle protocol and result agreement, link-compatible battle setup and party selection.\
**Effort:** 3–5 d after shared networking/battle support

### `clear_received_temp_data_all_players` — `0x136`

**Story / impact:** P4 — Frontier linked challenge coordination; wireless features are out of scope.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L225); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L222); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L276); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L369); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L795); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L74).

**Coverage:** 21 ROM-wide instruction sites; zone-root maps: `BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`.

**Decomp:** Clears each player’s received temporary communication buffer through the communication tool.\
Returns synchronously; it does not clear durable save data or ordinary VM variables. [src/scrcmd.c:4194–4198](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4194-L4198)

**Dependencies:** Communication session and per-player temporary receive buffers; scope decision before implementation.\
**Effort:** 0.25–0.5 person-day after communication foundation; foundation unestimated/out of scope

### `end_communication` — `0x150`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L200); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L197); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L182); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L344); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L770); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L80); [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L223); [poffin common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_poffin_common.s#L130); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L256).

**Coverage:** 32 ROM-wide instruction sites; zone-root maps: [R07](#reach-r07) (26 maps).

**Decomp:** Requests unsynchronized end-of-battle communication shutdown.\
Pauses until the communication manager has been deleted, avoiding resuming while teardown is live. [src/scrcmd.c:4520–4525](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4520-L4525)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `field_comm_enter_battle_room` — `0x151`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [COMMUNICATION CLUB COLOSSEUM 2P](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_communication_club_colosseum_2p.s#L8); [COMMUNICATION CLUB COLOSSEUM 4P](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_communication_club_colosseum_4p.s#L8); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L353).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `COMMUNICATION_CLUB_COLOSSEUM_2P`, `COMMUNICATION_CLUB_COLOSSEUM_4P`.

**Decomp:** Moves the field communication manager into its battle-room state.\
Returns immediately; this prepares linked field/battle coordination without starting a battle. [src/scrcmd.c:4545–4549](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4545-L4549)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `warp_to_colosseum` — `0x203`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L331).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R08](#reach-r08) (18 maps).

**Decomp:** Saves the current location as the return point and changes to the requested Colosseum map and coordinates.\
Ignores the supplied warp ID in favor of coordinate arrival (-1), using Colosseum map-load/transition mode. [src/scrcmd.c:3578–3592](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3578-L3592); [src/field_map_change.c:1509–1560](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/field_map_change.c#L1509-L1560)

**Dependencies:** Existing warp/fade host, saved special location and Colosseum communication map mode.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `scr_cmd_204` — `0x204`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [communication club (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_communication_club.s#L28).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `COMMUNICATION_CLUB_COLOSSEUM_2P`, `COMMUNICATION_CLUB_COLOSSEUM_4P`.

**Decomp:** Restores ordinary overworld map-load mode after the communication activity.\
Starts the map-change task back to the saved special/return location and yields through that task. [src/scrcmd.c:3594–3598](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3594-L3598); [src/field_map_change.c:1562–1569](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/field_map_change.c#L1562-L1569)

**Dependencies:** Saved communication return location and existing map-change host.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `scr_cmd_205` — `0x205`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1368).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GLOBAL_TERMINAL_1F`.

**Decomp:** Launches the Geonet/Wi-Fi Earth application using the save data.\
Pauses until the globe application closes; it does not itself modify a script result. [src/scrcmd.c:3205–3211](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3205-L3211); [src/unk_0203D1B8.c:1362–1374](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1362-L1374)

**Dependencies:** New Geonet globe UI, location settings and Wi-Fi history save.\
**Effort:** 3–5 d

### `get_cur_net_id` — `0x207`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L812); [BATTLE TOWER CORRIDOR MULTI](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_corridor_multi.s#L13); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L18); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L329).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: [R13](#reach-r13) (21 maps).

**Decomp:** Reads this console’s current communication network/player ID.\
Writes the ID and yields once; it does not initiate discovery or a connection. [src/scrcmd.c:2992–2998](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2992-L2998)

**Dependencies:** Active communication session peer identity.\
**Effort:** 0.25 d

### `do_group_connection_action` — `0x21D`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [group connection (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_group_connection.s#L12).

**Coverage:** 38 ROM-wide instruction sites; zone-root maps: `JUBILIFE_CITY`.

**Decomp:** Dispatches saved group checks, group/leader-name buffering, naming, joining and creating a record-mixing group.\
Naming starts an app; joining copies the selected seed/name entry to the override, and creation chooses a seed and queues TV news. [src/scrcmd_group_connection.c:21–91](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_group_connection.c#L21-L91)

**Dependencies:** Record-mixed RNG group entries/seed propagation, naming app, template names and TV hooks.\
**Effort:** 2–3 d once record-mixing save exists

### `open_battle_regulation_menu` — `0x239`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L174).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R08](#reach-r08) (18 maps).

**Decomp:** Opens battle-regulation selection and passes the destination result pointer to that task.\
Yields through the menu workflow; the choice configures optional linked battle rules. [src/scrcmd.c:5515–5519](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5515-L5519)

**Dependencies:** Battle regulation definitions/menu and party eligibility rules; communication session.\
**Effort:** 1–2 d

### `check_has_wi_fi_list_valid_login` — `0x2A3`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L149).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R02](#reach-r02) (18 maps).

**Decomp:** Checks whether the save has a valid Wi-Fi login/profile.\
Returns the boolean immediately; does not connect or create credentials. [src/scrcmd.c:6387–6393](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6387-L6393)

**Dependencies:** Wi-Fi profile/login-validity save fields.\
**Effort:** 0.25–0.5 d

### `get_wi_f_list_valid_friends_count` — `0x2A4`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L143).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R02](#reach-r02) (18 maps).

**Decomp:** Counts valid friend entries in the saved Wi-Fi friend list.\
Returns the count synchronously; disconnected friends still count as saved entries. [src/scrcmd.c:6395–6401](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6395-L6401)

**Dependencies:** Saved friend-list entries and friend-data validity rules.\
**Effort:** 0.25–0.5 d

### `scr_cmd_2b2` — `0x2B2`

**Story / impact:** P4 — Global Terminal entrance application setup; online features are out of scope.

**Native maps/callers:** [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L186).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GLOBAL_TERMINAL_1F`.

**Decomp:** Snapshots current field objects into the field save representation.\
Does not write the durable save, change maps or itself open a Global Terminal application. [src/scrcmd.c:6488–6492](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6488-L6492)

**Dependencies:** Existing map-object snapshot seam; online app would call it at the application boundary.\
**Effort:** 0.25–0.5 person-day

### `check_party_has_bad_egg` — `0x2B7`

**Story / impact:** P4 — Wireless/online entry validation, outside the project's scope.

**Native maps/callers:** [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L94); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L87); [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L118); [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L333).

**Coverage:** 6 ROM-wide instruction sites; zone-root maps: [R20](#reach-r20) (38 maps).

**Decomp:** Scans the party for an egg whose cartridge checksum has failed.\
Writes true when found, false otherwise; the native redundant outer loop adds no semantic effect. [src/scrcmd_party.c:746–770](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L746-L770)

**Dependencies:** Would require wireless feature scope plus checksum/form normalization boundaries.\
**Effort:** 0.25–0.5 d

### `scr_cmd_2bb` — `0x2BB`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [communication club (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_communication_club.s#L27); [contests (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contests.s#L800).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `COMMUNICATION_CLUB_COLOSSEUM_2P`, `COMMUNICATION_CLUB_COLOSSEUM_4P`, `CONTEST_HALL_LOBBY`.

**Decomp:** Requests synchronized end-of-battle communication teardown.\
Pauses until the communication manager is deleted; differs from the no-sync shutdown command. [src/scrcmd.c:4538–4543](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4538-L4543)

**Dependencies:** New peer/session transport, connection UI, cancellation/disconnect semantics and saved partner identity.\
**Effort:** 1–2 d; shared wireless foundation 15–30 d

### `scr_cmd_2f6` — `0x2F6`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1621).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GLOBAL_TERMINAL_1F`, `GLOBAL_TERMINAL_2F`, `GLOBAL_TERMINAL_3F`.

**Decomp:** Checks saved Wi-Fi login before starting the online application wrapper with two selected mode parameters.\
Writes 1 and pauses through app exit when allowed; writes 0 without launching when login is invalid.\
The wrapper initializes networking, runs the connection UI and selected child app, then shuts networking down. [src/scrcmd.c:6850–6865](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6850-L6865); [src/unk_0203D1B8.c:1741–1763](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1741-L1763); [src/unk_02017498.c:35–137](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_02017498.c#L35-L137); [src/unk_0208BA78.c:401–405](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0208BA78.c#L401-L405)

**Dependencies:** Global Terminal online app modes/services, saved Wi-Fi login and existing app host.\
**Effort:** 4–8 d after network foundation

**Caveat:** Wrapper identifies overlay61 and two mode operands; precise per-mode online UI needs that overlay’s behavior specification.

### `scr_cmd_2f7` — `0x2F7`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L424); [WIFI PLAZA ENTRANCE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_wifi_plaza_entrance.s#L73).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `WIFI_PLAZA_ENTRANCE`.

**Decomp:** If the saved Wi-Fi login is valid, starts the Wi-Fi Plaza application task using the current destination variable as its input mode.\
No result is written by this wrapper; the task passes save and field cooldown state through the child application. [src/scrcmd.c:6867–6876](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6867-L6876); [src/unk_0205749C.c:30–58](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205749C.c#L30-L58)

**Dependencies:** New Wi-Fi Plaza app/protocol, saved login, timestamp/cooldown state and child-app lifecycle.\
**Effort:** 8–15 d; Plaza is a separate large optional system

### `scr_cmd_30e` — `0x30E`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L449).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GLOBAL_TERMINAL_1F`.

**Decomp:** Opens Easy Chat with the saved Union Room introduction sentence.\
Returns 0 when unchanged/canceled; otherwise saves the edited sentence and returns 1 after the field fades back in. [src/scrcmd.c:3100–3106](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3100-L3106); [src/unk_0209B344.c:34–106](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0209B344.c#L34-L106)

**Dependencies:** Saved introduction sentence, Easy Chat editor/word data, existing application/fade host.\
**Effort:** 1–2 d after Easy Chat foundation

### `try_revert_party_pokemon_forms` — `0x31D`

**Story / impact:** P4 — Wireless/online entry validation, outside the project's scope.

**Native maps/callers:** [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L409); [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L176).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: [R21](#reach-r21) (36 maps).

**Decomp:** Returns held Griseous Orbs to the Bag, failing with 0xFF before mutation if they will not fit.\
Otherwise reverts Giratina, appliance Rotom and Sky Shaymin forms for link entry and returns 0. [src/overlay005/ov5_021F6454.c:451–514](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L451-L514)

**Dependencies:** Would require wireless feature scope plus checksum/form normalization boundaries.\
**Effort:** 0.5–1 d

### `check_no_wi_fi_plaza_cooldown` — `0x323`

**Story / impact:** P4 — Optional local/Wi-Fi activities; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center b1f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_b1f_common.s#L345).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R02](#reach-r02) (18 maps).

**Decomp:** Compares the current timestamp with the field’s last Wi-Fi Plaza timestamp.\
Returns true only after at least 120 seconds; this query neither resets the timestamp nor opens the Plaza. [src/scrcmd.c:7075–7090](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7075-L7090)

**Dependencies:** Saved/field Plaza exit timestamp and deterministic clock support.\
**Effort:** 0.25–0.5 d

### `log_link_info_in_wi_fi_history` — `0x330`

**Story / impact:** P4 — Optional postgame Battle Tower Wi-Fi exchange history.

**Native maps/callers:** [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L856).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Visits each connected peer other than the local player and records the peer’s country/region in Geonet history.\
Returns without changes if trainer metadata is unavailable; otherwise marks previously unvisited locations and yields once. [src/overlay005/ov5_021F6454.c:1073–1079](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L1073-L1079); [src/unk_02038F8C.c:13–38](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_02038F8C.c#L13-L38)

**Dependencies:** Saved Geonet history, link-country/region metadata and history flag update rules.\
**Effort:** 0.5–1 d

<a id="system-67"></a>

## Global Terminal favorite Pokémon

### `set_favorite_mon` — `0x300`

**Story / impact:** P4 — Favorite setting in Global Terminal online feature context, excluded from scope.

**Native maps/callers:** [GLOBAL TERMINAL 1F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_global_terminal_1f.s#L408).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `GLOBAL_TERMINAL_1F`.

**Decomp:** Saves party slot zero’s species, form and egg flag as the favorite Pokémon.\
Immediate MiscSaveBlock write; no online exchange occurs. [src/overlay005/ov5_021F6454.c:696–708](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L696-L708)

**Dependencies:** Existing party fields; new favorite tuple in save schema.\
**Effort:** 0.25 d

### `get_favorite_mon` — `0x301`

**Story / impact:** P4 — No direct call sites in the pinned decomp script sources; retain for command completeness.

**Native maps/callers:** No opcode-bearing macro call found in the pinned field scripts (native handler exists).

**Coverage:** 0 ROM-wide instruction sites; no zone-root path. Not reached by the CLI root model.

**Decomp:** Reads the favorite Pokémon tuple from miscellaneous save data.\
Writes species, form and egg flag to three variables immediately. [src/overlay005/ov5_021F6454.c:710–726](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L710-L726)

**Dependencies:** Saved favorite tuple and existing VM variables.\
**Effort:** 0.25 d

<a id="system-68"></a>

## Legacy Diamond/Pearl gym lifts

### `move_hearthome_gym_dp_lift` — `0x172`

**Story / impact:** P4 — Only Diamond/Pearl Hearthome elevator-room scripts; unused by Platinum’s real Fantina puzzle.

**Native maps/callers:** [HEARTHOME CITY DP GYM ELEVATOR ROOM 1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_dp_gym_elevator_room_1.s#L16); [HEARTHOME CITY DP GYM ELEVATOR ROOM 2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_dp_gym_elevator_room_2.s#L16).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `HEARTHOME_CITY_DP_GYM_ELEVATOR_ROOM_1`, `HEARTHOME_CITY_DP_GYM_ELEVATOR_ROOM_2`.

**Decomp:** Uses the player’s current height to choose raising or lowering the legacy Hearthome lift, recording its direction in persisted features.\
Runs a field task carrying the player with the platform, temporarily controlling height calculation and updating dynamic terrain at the endpoint. [src/scrcmd.c:4730–4736](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4730-L4736); [src/overlay008/gym_features.c:776–835](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay008/gym_features.c#L776-L835)

**Dependencies:** Legacy lift geometry, moving platform/collision and passenger attachment; existing platform engine can supply pieces.\
**Effort:** 1–2 person-days if legacy map support is desired

<a id="system-69"></a>

## Union Room

### `scr_cmd_0a5` — `0x0A5`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1456).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `BATTLE_TOWER`.

**Decomp:** Starts a sentence-based Easy Chat dialogue task using the communication text bank.\
Creates message/choice windows and an Easy Chat editor, then cleans up on exit; nested task controls completion. [src/scrcmd.c:3094–3098](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3094-L3098); [src/unk_0209ACF4.c:62–100](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0209ACF4.c#L62-L100)

**Dependencies:** Easy Chat sentence/word data and editor, communication messages and persistent greeting data.\
**Effort:** 2–3 d; Easy Chat foundation 3–5 d

### `scr_cmd_0ac` — `0x0AC`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L192).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Launches the Union Room drawing application with peer-field state, journal and saved options.\
Pauses until its child application exits; returns no script value. [src/scrcmd.c:3305–3313](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3305-L3313); [src/unk_0203D1B8.c:1067–1091](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1067-L1091)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `open_union_room_trainer_case` — `0x0AD`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L102).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Sends the local Trainer Case and waits for the remote case to arrive.\
Opens that remote case, then clears exchange state after the viewer closes; no script result is exposed. [src/scrcmd.c:3315–3319](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3315-L3319); [src/trainer_case.c:247–285](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/trainer_case.c#L247-L285)

**Dependencies:** Union Room connection plus Trainer Case serialization, remote profile viewer and journal event.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_0ae` — `0x0AE`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L127).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Starts the Union Room trade task, which coordinates party selection, summary and trading applications.\
The task can cycle through further trades, updates trade-related records and returns when the trade flow ends. [src/scrcmd.c:3321–3325](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3321-L3325); [src/unk_0203D1B8.c:929–1065](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L929-L1065)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 3–5 d once network trade foundation exists

### `scr_cmd_0af` — `0x0AF`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L213).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Launches the record-mixing application with save, peer-field state, options, game records and journal.\
Stores its arguments in script scratch state; pauses until the app exits, then frees them. [src/scrcmd.c:3327–3335](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3327-L3335); [src/unk_0203D1B8.c:1094–1108](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1094-L1108)

**Dependencies:** Union Room session, record-mixing merge rules for each save subsystem and app lifecycle.\
**Effort:** 3–5 d once all mixed save models exist

### `scr_cmd_135` — `0x135`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [BATTLE ARCADE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_arcade.s#L226); [BATTLE CASTLE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_castle.s#L223); [BATTLE FACTORY](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_factory.s#L277); [BATTLE HALL](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_hall.s#L370); [BATTLE TOWER](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower.s#L796); [BATTLE TOWER MULTI BATTLE ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battle_tower_multi_battle_room.s#L75); [communication club (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_communication_club.s#L25); [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L314); [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L49).

**Coverage:** 44 ROM-wide instruction sites; zone-root maps: [R06](#reach-r06) (27 maps).

**Decomp:** Starts the requested common communication synchronization barrier.\
Pauses until it is reached, or immediately completes if fewer than two players remain connected. [src/scrcmd.c:4169–4179](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4169-L4179); [src/scrcmd.c:4169–4192](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4169-L4192)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `get_union_room_teala_message` — `0x138`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L767).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Chooses Teala’s message from nearby-peer presence and the saved greeting sentence.\
If appropriate, fills trainer-class or Easy Chat word placeholders and returns the message index synchronously. [src/scrcmd.c:4210–4218](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4210-L4218); [src/unk_0205B33C.c:1185–1226](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L1185-L1226)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_139` — `0x139`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L57).

**Coverage:** 14 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Changes communication-manager state between the Union Room and a selected Union application.\
For the host, publishes the selected activity/status to nearby peers; no script result or wait. [src/scrcmd.c:4220–4235](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4220-L4235); [src/unk_0205B33C.c:1116–1180](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L1116-L1180)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_13a` — `0x13A`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L263).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Publishes Union Room busy state 4 and pauses the Union Room server.\
The effect is immediate; later commands must resume discovery after the interaction. [src/scrcmd.c:4358–4363](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4358-L4363); [src/unk_0205B33C.c:1116–1180](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L1116-L1180)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_13b` — `0x13B`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L258).

**Coverage:** 5 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Restores ordinary Union Room communication state and restarts peer searching.\
Clears the advertised activity back to idle (0), synchronously. [src/scrcmd.c:4365–4371](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4365-L4371); [src/unk_0205B33C.c:1116–1180](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L1116-L1180)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `do_union_room_greeting` — `0x13C`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L33).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Builds the chosen greeting using local trainer info, unlocked Easy Chat words and the selected remote player.\
Mode 0 uses the target object’s local ID; the other mode uses peer index zero. No wait or result variable. [src/scrcmd.c:4237–4254](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4237-L4254)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `init_comm_field_cmd` — `0x13D`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L719).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Initializes field communication command dispatch for the current field system.\
This establishes the peer/field command context; it neither launches an activity nor returns a result. [src/scrcmd.c:4256–4260](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4256-L4260); [src/unk_02099500.c:169–173](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_02099500.c#L169-L173)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_13e` — `0x13E`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L456).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Marks active communication-field entries for removal and restarts Union Room searching.\
Pauses until fewer than two players remain connected, completing cancellation/disconnect cleanup. [src/scrcmd.c:4262–4271](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4262-L4271); [src/unk_0205C22C.c:80–90](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205C22C.c#L80-L90); [src/scrcmd.c:4262–4276](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4262-L4276)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `get_union_room_message` — `0x13F`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L50).

**Coverage:** 37 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Selects a Union Room dialogue by message kind and target peer, filling the string template.\
Returns the message ID synchronously; it does not display or wait for that message. [src/scrcmd.c:4278–4287](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4278-L4287)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_140` — `0x140`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L30).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Inspects the target peer’s advertised Union Room activity and caches that advertisement for negotiation.\
Returns a compact activity category; missing, busy or unsupported peers return category 5. [src/scrcmd.c:4304–4312](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4304-L4312); [src/unk_0205B33C.c:427–476](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L427-L476)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_141` — `0x141`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L41).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Waits for the pending Union Room connection/negotiation status to become nonzero.\
Writes that status to the destination on completion; does not complete merely because a frame elapsed. [src/scrcmd.c:4325–4333](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4325-L4333); [src/scrcmd.c:4325–4347](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4325-L4347); [src/unk_0205B33C.c:560–563](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L560-L563)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_142` — `0x142`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L23).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Restores connected peer avatars after the Union Room resumes from an application.\
For active peer entries it restores sprite state, facing, warp-in animation and visibility. [src/scrcmd.c:4349–4356](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4349-L4356); [src/unk_0205C22C.c:435–490](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205C22C.c#L435-L490)

**Dependencies:** Union Room peer-to-map-object mapping, avatar appearance, activity sprites and warp animations.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_143` — `0x143`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L82).

**Coverage:** 20 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Sends either an activity-choice packet or a host response packet according to the action operand.\
Stores the local proposal/response state alongside that send; synchronous wrapper does not await acknowledgement. [src/scrcmd.c:4373–4381](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4373-L4381); [src/unk_0205B33C.c:597–622](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L597-L622)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_144` — `0x144`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L92).

**Coverage:** 12 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Waits for an incoming Union Room activity response or disconnection.\
Writes the response and resets temporary negotiation state when ready; otherwise keeps waiting. [src/scrcmd.c:4383–4391](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4383-L4391); [src/scrcmd.c:4383–4407](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4383-L4407); [src/unk_0205B33C.c:565–584](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L565-L584)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_145` — `0x145`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L490).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Waits for the Union Room host-side activity request to become nonzero.\
B attempts cancellation via status 8 only while no request is active; the returned status goes to the destination. [src/scrcmd.c:4409–4417](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4409-L4417); [src/scrcmd.c:4409–4434](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4409-L4434); [src/unk_0205B33C.c:587–595](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L587-L595); [src/unk_0205B33C.c:671–680](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L671-L680)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_146` — `0x146`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L37).

**Coverage:** 4 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Checks the target peer’s advertised activity against the requested join kind.\
On a compatible match records peer/session negotiation state and returns 1; incompatible or unavailable peers return 5. [src/scrcmd.c:4314–4323](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4314-L4323); [src/unk_0205B33C.c:478–558](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L478-L558)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_153` — `0x153`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [pokemon center 2f common (shared/service script)](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_center_2f_common.s#L438).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: [R08](#reach-r08) (18 maps).

**Decomp:** Saves the current field location as the return location and initializes Union Room peer managers.\
Sets Union map-load mode and runs the transition/warp animation to Union Room coordinates (8,14). [src/scrcmd.c:4436–4440](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4436-L4440); [src/field_map_change.c:1442–1507](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/field_map_change.c#L1442-L1507)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `open_party_menu_for_union_room_battle` — `0x192`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L157).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Opens party selection configured for a Union Room battle and retains the menu result.\
The asynchronous task owns selection; a later link-battle command consumes its selection order. [src/scrcmd.c:2601–2607](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2601-L2607)

**Dependencies:** Union Room battle rules, existing party-select app extended to retain ordered selection.\
**Effort:** 0.5–1 d

### `get_trainer_case_player_message` — `0x2AF`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L510).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Chooses the remote Trainer Case introduction from both players’ country/region metadata.\
Fills partner country/city template fields and returns a message for same place, city or country; it does not show the case. [src/scrcmd.c:6466–6474](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6466-L6474); [src/unk_0205B33C.c:960–996](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L960-L996)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `show_union_room_menu` — `0x2B9`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L73).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Shows the already-built Union Room single-column activity menu.\
Waits for selection, but converts a peer disconnect into the cancellation choice instead of hanging. [src/scrcmd.c:1886–1895](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1886-L1895); [src/scrcmd.c:1886–1915](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1886-L1915)

**Dependencies:** Existing menu host plus Union Room disconnect state and cancellation result mapping.\
**Effort:** 0.5–1 d

### `scr_cmd_2ba` — `0x2BA`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L163).

**Coverage:** 2 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Reports whether local or remote party selection rejected/canceled a Union Room battle (codes 1/2).\
When a rejection is reported it frees the retained party-menu data; zero means no rejection. [src/scrcmd.c:4289–4302](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4289-L4302); [src/unk_0205B33C.c:729–742](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0205B33C.c#L729-L742)

**Dependencies:** New Union Room peer roster/session state, activity negotiation, network actors and disconnect handling.\
**Effort:** 0.5–1 d; shared Union Room foundation 10–20 d plus transport

### `scr_cmd_2c6` — `0x2C6`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L238).

**Coverage:** 3 ROM-wide instruction sites; zone-root maps: `UNION_ROOM`.

**Decomp:** Creates the Union Room Spin Trade workflow, including spin-trade party selection and summary access.\
Retains workflow state and pauses while successive child applications run; the workflow frees itself when finished. [src/scrcmd.c:3480–3488](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3480-L3488); [src/unk_0209C194.c:64–125](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0209C194.c#L64-L125)

**Dependencies:** New Spin Trade rules/app, peer selection/transfer protocol, existing party/summary hosts and records.\
**Effort:** 3–5 d once trade/network foundation exists

### `is_comm_game_code_platinum` — `0x2C7`

**Story / impact:** P4 — Optional Union Room interactions; wireless is outside the current engine scope.

**Native maps/callers:** [UNION ROOM](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_union_room.s#L222).

**Coverage:** 1 ROM-wide instruction site; zone-root maps: `UNION_ROOM`.

**Decomp:** Reads the connected partner’s game code.\
Returns false for the Diamond/Pearl code and true otherwise; despite the name this is not strict equality with Platinum. [src/scrcmd.c:3490–3502](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3490-L3502)

**Dependencies:** Union Room partner game/version metadata.\
**Effort:** 0.25 d

## Reachability map sets

These are exhaustive zone-root results from the coverage tool, factored only to avoid repeating long map lists. Names omit the common `platinum:MAP_HEADER_` prefix. They include conditional/optional branches and are not walkthrough claims. Behavior/new-game/entry roots are additional to these sets.

<a id="reach-r01"></a>

### R01 — 22 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `CANALAVE_CITY_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `RESORT_AREA_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_2F`.

<a id="reach-r02"></a>

### R02 — 18 maps

`CANALAVE_CITY_POKECENTER_B1F`, `CELESTIC_TOWN_POKECENTER_B1F`, `ETERNA_CITY_POKECENTER_B1F`, `FIGHT_AREA_POKECENTER_B1F`, `FLOAROMA_TOWN_POKECENTER_B1F`, `HEARTHOME_CITY_POKECENTER_B1F`, `JUBILIFE_CITY_POKECENTER_B1F`, `OREBURGH_CITY_POKECENTER_B1F`, `PASTORIA_CITY_POKECENTER_B1F`, `POKEMON_LEAGUE_NORTH_POKECENTER_B1F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_B1F`, `RESORT_AREA_POKECENTER_B1F`, `SANDGEM_TOWN_POKECENTER_B1F`, `SNOWPOINT_CITY_POKECENTER_B1F`, `SOLACEON_TOWN_POKECENTER_B1F`, `SUNYSHORE_CITY_POKECENTER_B1F`, `SURVIVAL_AREA_POKECENTER_B1F`, `VEILSTONE_CITY_POKECENTER_B1F`.

<a id="reach-r03"></a>

### R03 — 25 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_2F`, `CONTEST_HALL_LOBBY`, `ETERNA_CITY_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_2F`, `POFFIN_HOUSE`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `RESORT_AREA_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_2F`.

<a id="reach-r04"></a>

### R04 — 46 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_POKECENTER_2F`, `CANALAVE_CITY_POKECENTER_B1F`, `CELESTIC_TOWN_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_B1F`, `CONTEST_HALL_LOBBY`, `ETERNA_CITY_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_B1F`, `FIGHT_AREA_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_B1F`, `FLOAROMA_TOWN_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_B1F`, `GLOBAL_TERMINAL_1F`, `GLOBAL_TERMINAL_2F`, `GLOBAL_TERMINAL_3F`, `HEARTHOME_CITY_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_B1F`, `JUBILIFE_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_B1F`, `OREBURGH_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_B1F`, `PASTORIA_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_B1F`, `POFFIN_HOUSE`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_B1F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_B1F`, `RESORT_AREA_POKECENTER_2F`, `RESORT_AREA_POKECENTER_B1F`, `SANDGEM_TOWN_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_B1F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_B1F`, `SOLACEON_TOWN_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_B1F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_B1F`, `SURVIVAL_AREA_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_B1F`, `VEILSTONE_CITY_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_B1F`.

<a id="reach-r05"></a>

### R05 — 48 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `BATTLE_TOWER_BATTLE_ROOM`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`, `CANALAVE_CITY_POKECENTER_2F`, `CANALAVE_CITY_POKECENTER_B1F`, `CELESTIC_TOWN_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_B1F`, `CONTEST_HALL_LOBBY`, `ETERNA_CITY_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_B1F`, `FIGHT_AREA_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_B1F`, `FLOAROMA_TOWN_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_B1F`, `GLOBAL_TERMINAL_1F`, `GLOBAL_TERMINAL_2F`, `GLOBAL_TERMINAL_3F`, `HEARTHOME_CITY_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_B1F`, `JUBILIFE_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_B1F`, `OREBURGH_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_B1F`, `PASTORIA_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_B1F`, `POFFIN_HOUSE`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_B1F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_B1F`, `RESORT_AREA_POKECENTER_2F`, `RESORT_AREA_POKECENTER_B1F`, `SANDGEM_TOWN_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_B1F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_B1F`, `SOLACEON_TOWN_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_B1F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_B1F`, `SURVIVAL_AREA_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_B1F`, `VEILSTONE_CITY_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_B1F`.

<a id="reach-r06"></a>

### R06 — 27 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`, `CANALAVE_CITY_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_2F`, `COMMUNICATION_CLUB_COLOSSEUM_2P`, `COMMUNICATION_CLUB_COLOSSEUM_4P`, `ETERNA_CITY_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `RESORT_AREA_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_2F`, `UNION_ROOM`, `VEILSTONE_CITY_POKECENTER_2F`.

<a id="reach-r07"></a>

### R07 — 26 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`, `CANALAVE_CITY_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_2F`, `CONTEST_HALL_LOBBY`, `ETERNA_CITY_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_2F`, `POFFIN_HOUSE`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `RESORT_AREA_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_2F`.

<a id="reach-r08"></a>

### R08 — 18 maps

`CANALAVE_CITY_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `RESORT_AREA_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_2F`.

<a id="reach-r09"></a>

### R09 — 30 maps

`ETERNA_FOREST_OUTSIDE`, `FIGHT_AREA`, `FLOAROMA_TOWN`, `FUEGO_IRONWORKS_OUTSIDE`, `PASTORIA_CITY`, `RESORT_AREA`, `ROUTE_205_NORTH`, `ROUTE_205_SOUTH`, `ROUTE_206`, `ROUTE_207`, `ROUTE_208`, `ROUTE_209`, `ROUTE_210_NORTH`, `ROUTE_210_SOUTH`, `ROUTE_211_EAST`, `ROUTE_212_NORTH`, `ROUTE_212_SOUTH`, `ROUTE_213`, `ROUTE_214`, `ROUTE_215`, `ROUTE_218`, `ROUTE_221`, `ROUTE_222`, `ROUTE_224`, `ROUTE_225`, `ROUTE_226`, `ROUTE_228`, `ROUTE_229`, `ROUTE_230`, `SOLACEON_TOWN`.

<a id="reach-r10"></a>

### R10 — 47 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_POKECENTER_2F`, `CANALAVE_CITY_POKECENTER_B1F`, `CELESTIC_TOWN_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_B1F`, `CONTEST_HALL_LOBBY`, `ETERNA_CITY_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_B1F`, `FIGHT_AREA_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_B1F`, `FLOAROMA_TOWN_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_B1F`, `GLOBAL_TERMINAL_1F`, `GLOBAL_TERMINAL_2F`, `GLOBAL_TERMINAL_3F`, `HEARTHOME_CITY_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_B1F`, `JUBILIFE_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_B1F`, `OREBURGH_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_B1F`, `PASTORIA_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_B1F`, `POFFIN_HOUSE`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_B1F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_B1F`, `RESORT_AREA_POKECENTER_2F`, `RESORT_AREA_POKECENTER_B1F`, `SANDGEM_TOWN_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_B1F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_B1F`, `SOLACEON_TOWN_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_B1F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_B1F`, `SURVIVAL_AREA_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_B1F`, `UNION_ROOM`, `VEILSTONE_CITY_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_B1F`.

<a id="reach-r11"></a>

### R11 — 164 maps

`ACUITY_LAKEFRONT`, `AMITY_SQUARE`, `BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY`, `CANALAVE_CITY_GYM`, `CELESTIC_TOWN`, `ETERNA_CITY`, `ETERNA_CITY_GYM`, `ETERNA_FOREST`, `ETERNA_FOREST_OUTSIDE`, `FLOAROMA_MEADOW`, `FUEGO_IRONWORKS_BUILDING`, `FULLMOON_ISLAND_FOREST`, `GALACTIC_HQ_1F`, `GALACTIC_HQ_2F`, `GALACTIC_HQ_3F`, `GALACTIC_HQ_B2F`, `GALACTIC_HQ_LABORATORY`, `GAME_CORNER`, `GREAT_MARSH_1`, `GREAT_MARSH_2`, `GREAT_MARSH_3`, `GREAT_MARSH_4`, `GREAT_MARSH_5`, `GREAT_MARSH_6`, `HEARTHOME_CITY_DP_GYM_LEADER_ROOM`, `HEARTHOME_CITY_GYM_LEADER_ROOM`, `IRON_ISLAND_B1F_LEFT_ROOM`, `IRON_ISLAND_B1F_RIGHT_ROOM`, `IRON_ISLAND_B2F_LEFT_ROOM`, `IRON_ISLAND_B2F_RIGHT_ROOM`, `IRON_ISLAND_B3F`, `IRON_ISLAND_IRON_RUINS`, `JUBILIFE_CITY`, `LAKE_ACUITY`, `LAKE_ACUITY_LOW_WATER`, `LAKE_VALOR`, `LAKE_VALOR_DRAINED`, `LAKE_VERITY`, `LAKE_VERITY_LOW_WATER`, `MANIAC_TUNNEL`, `MT_CORONET_1F_NORTH_ROOM_1`, `MT_CORONET_1F_SOUTH`, `MT_CORONET_1F_TUNNEL_ROOM`, `MT_CORONET_2F`, `MT_CORONET_4F_ROOMS_1_AND_2`, `MT_CORONET_B1F`, `MT_CORONET_ICEBERG_RUINS`, `MT_CORONET_OUTSIDE_NORTH`, `MT_CORONET_OUTSIDE_SOUTH`, `OLD_CHATEAU_BACK_EAST_ROOM`, `OLD_CHATEAU_BACK_MIDDLE_EAST_ROOM`, `OLD_CHATEAU_BACK_MIDDLE_WEST_ROOM`, `OLD_CHATEAU_BACK_WEST_ROOM`, `OLD_CHATEAU_DINING_AREA`, `OLD_CHATEAU_SIDE_ROOMS`, `OREBURGH_CITY`, `OREBURGH_CITY_GYM`, `OREBURGH_GATE_1F`, `OREBURGH_GATE_B1F`, `OREBURGH_MINE_B1F`, `OREBURGH_MINE_B2F`, `PASTORIA_CITY`, `PASTORIA_CITY_GYM`, `POKEMON_LEAGUE_AARON_ROOM`, `POKEMON_LEAGUE_BERTHA_ROOM`, `POKEMON_LEAGUE_CHAMPION_ROOM`, `POKEMON_LEAGUE_FLINT_ROOM`, `POKEMON_LEAGUE_LUCIAN_ROOM`, `POKEMON_MANSION_MAIDS_ROOM`, `POKEMON_MANSION_OFFICE`, `RAVAGED_PATH`, `RESORT_AREA`, `ROUTE_202`, `ROUTE_203`, `ROUTE_204_NORTH`, `ROUTE_204_SOUTH`, `ROUTE_205_NORTH`, `ROUTE_205_SOUTH`, `ROUTE_206`, `ROUTE_207`, `ROUTE_208`, `ROUTE_209`, `ROUTE_209_LOST_TOWER_2F`, `ROUTE_209_LOST_TOWER_3F`, `ROUTE_209_LOST_TOWER_4F`, `ROUTE_210_NORTH`, `ROUTE_210_SOUTH`, `ROUTE_211_EAST`, `ROUTE_211_WEST`, `ROUTE_212_NORTH`, `ROUTE_212_SOUTH`, `ROUTE_213`, `ROUTE_214`, `ROUTE_215`, `ROUTE_216`, `ROUTE_217`, `ROUTE_218`, `ROUTE_219`, `ROUTE_220`, `ROUTE_221`, `ROUTE_222`, `ROUTE_223`, `ROUTE_224`, `ROUTE_225`, `ROUTE_226`, `ROUTE_227`, `ROUTE_228`, `ROUTE_228_ROCK_PEAK_RUINS`, `ROUTE_229`, `ROUTE_230`, `RUIN_MANIAC_CAVE_LONG`, `RUIN_MANIAC_CAVE_SHORT`, `SNOWPOINT_CITY`, `SNOWPOINT_CITY_GYM`, `SNOWPOINT_TEMPLE_B1F`, `SNOWPOINT_TEMPLE_B2F`, `SNOWPOINT_TEMPLE_B4F`, `SOLACEON_RUINS_ROOM_7`, `SOLACEON_TOWN`, `STARK_MOUNTAIN_OUTSIDE`, `STARK_MOUNTAIN_ROOM_1`, `STARK_MOUNTAIN_ROOM_2`, `SUNYSHORE_CITY`, `SUNYSHORE_CITY_GYM_ROOM_3`, `SURVIVAL_AREA`, `TEAM_GALACTIC_ETERNA_BUILDING_2F`, `TEAM_GALACTIC_ETERNA_BUILDING_3F`, `TEAM_GALACTIC_ETERNA_BUILDING_4F`, `TRAINERS_SCHOOL`, `TURNBACK_CAVE_PILLAR_1_ROOM_1`, `TURNBACK_CAVE_PILLAR_1_ROOM_2`, `TURNBACK_CAVE_PILLAR_1_ROOM_3`, `TURNBACK_CAVE_PILLAR_1_ROOM_4`, `TURNBACK_CAVE_PILLAR_1_ROOM_5`, `TURNBACK_CAVE_PILLAR_1_ROOM_6`, `TURNBACK_CAVE_PILLAR_2_ROOM_1`, `TURNBACK_CAVE_PILLAR_2_ROOM_2`, `TURNBACK_CAVE_PILLAR_2_ROOM_3`, `TURNBACK_CAVE_PILLAR_2_ROOM_4`, `TURNBACK_CAVE_PILLAR_2_ROOM_5`, `TURNBACK_CAVE_PILLAR_2_ROOM_6`, `TURNBACK_CAVE_PILLAR_3_ROOM_1`, `TURNBACK_CAVE_PILLAR_3_ROOM_2`, `TURNBACK_CAVE_PILLAR_3_ROOM_3`, `TURNBACK_CAVE_PILLAR_3_ROOM_4`, `TURNBACK_CAVE_PILLAR_3_ROOM_5`, `TURNBACK_CAVE_PILLAR_3_ROOM_6`, `UNUSED_BATTLE_PARK`, `VALLEY_WINDWORKS_OUTSIDE`, `VALOR_LAKEFRONT`, `VEILSTONE_CITY`, `VEILSTONE_CITY_GALACTIC_WAREHOUSE`, `VEILSTONE_CITY_GYM`, `VICTORY_ROAD_1F`, `VICTORY_ROAD_1F_ROOM_2`, `VICTORY_ROAD_2F`, `VICTORY_ROAD_B1F`, `WAYWARD_CAVE_1F`, `WAYWARD_CAVE_B1F`.

<a id="reach-r12"></a>

### R12 — 25 maps

`BATTLE_FRONTIER`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_MART`, `CANALAVE_CITY_WEST_HOUSE`, `CONTEST_HALL_LOBBY`, `ETERNA_CITY_MART`, `FIGHT_AREA_MART`, `FLOAROMA_TOWN_MART`, `HEARTHOME_CITY_EAST_GATE_TO_AMITY_SQUARE`, `HEARTHOME_CITY_MART`, `HEARTHOME_CITY_POKEMON_FAN_CLUB`, `HEARTHOME_CITY_WEST_GATE_TO_AMITY_SQUARE`, `JUBILIFE_CITY_MART`, `JUBILIFE_TV_2F`, `OREBURGH_CITY_MART`, `PASTORIA_CITY_MART`, `POFFIN_HOUSE`, `POKETCH_CO_1F`, `ROUTE_214_GATE_TO_VEILSTONE_CITY`, `SANDGEM_TOWN_MART`, `SNOWPOINT_CITY_MART`, `SOLACEON_TOWN_MART`, `SUNYSHORE_CITY_MART`, `SURVIVAL_AREA_MART`.

<a id="reach-r13"></a>

### R13 — 21 maps

`BATTLE_TOWER`, `BATTLE_TOWER_CORRIDOR_MULTI`, `BATTLE_TOWER_MULTI_BATTLE_ROOM`, `CANALAVE_CITY_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `RESORT_AREA_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_2F`.

<a id="reach-r14"></a>

### R14 — 99 maps

`CANALAVE_CITY`, `CELESTIC_TOWN`, `ETERNA_CITY`, `ETERNA_FOREST`, `FLOAROMA_MEADOW`, `FUEGO_IRONWORKS_BUILDING`, `FUEGO_IRONWORKS_OUTSIDE`, `GALACTIC_HQ_1F`, `GALACTIC_HQ_2F`, `GALACTIC_HQ_3F`, `GALACTIC_HQ_4F`, `GRAND_LAKE_ROUTE_213_NORTHEAST_HOUSE`, `GREAT_MARSH_1`, `GREAT_MARSH_2`, `GREAT_MARSH_3`, `GREAT_MARSH_4`, `GREAT_MARSH_5`, `GREAT_MARSH_6`, `HEARTHOME_CITY`, `IRON_ISLAND`, `IRON_ISLAND_B1F_RIGHT_ROOM`, `IRON_ISLAND_B2F_LEFT_ROOM`, `IRON_ISLAND_B2F_RIGHT_ROOM`, `IRON_ISLAND_IRON_RUINS`, `JUBILIFE_CITY`, `LAKE_VALOR_DRAINED`, `MT_CORONET_1F_NORTH_ROOM_1`, `MT_CORONET_1F_NORTH_ROOM_2`, `MT_CORONET_1F_SOUTH`, `MT_CORONET_1F_TUNNEL_ROOM`, `MT_CORONET_2F`, `MT_CORONET_3F`, `MT_CORONET_4F_ROOMS_1_AND_2`, `MT_CORONET_4F_ROOM_3`, `MT_CORONET_5F`, `MT_CORONET_B1F`, `MT_CORONET_ICEBERG_RUINS`, `MT_CORONET_OUTSIDE_NORTH`, `MT_CORONET_OUTSIDE_SOUTH`, `OLD_CHATEAU_DINING_AREA`, `OREBURGH_CITY`, `PASTORIA_CITY`, `POKEMON_LEAGUE`, `POKEMON_MANSION_MAIDS_ROOM`, `RESORT_AREA`, `ROUTE_202`, `ROUTE_205_NORTH`, `ROUTE_205_SOUTH`, `ROUTE_206`, `ROUTE_207`, `ROUTE_208`, `ROUTE_209`, `ROUTE_209_LOST_TOWER_2F`, `ROUTE_209_LOST_TOWER_4F`, `ROUTE_210_NORTH`, `ROUTE_210_SOUTH`, `ROUTE_211_EAST`, `ROUTE_211_WEST`, `ROUTE_212_NORTH`, `ROUTE_212_SOUTH`, `ROUTE_213`, `ROUTE_214`, `ROUTE_215`, `ROUTE_216`, `ROUTE_217`, `ROUTE_219`, `ROUTE_220`, `ROUTE_221`, `ROUTE_222`, `ROUTE_223`, `ROUTE_224`, `ROUTE_225`, `ROUTE_226`, `ROUTE_227`, `ROUTE_228`, `ROUTE_228_ROCK_PEAK_RUINS`, `ROUTE_229`, `ROUTE_230`, `SNOWPOINT_CITY`, `SNOWPOINT_TEMPLE_B3F`, `SOLACEON_RUINS_ROOM_1_NORTHWEST_DEAD_END`, `SOLACEON_RUINS_ROOM_3_SOUTHWEST_DEAD_END`, `SOLACEON_RUINS_ROOM_5_SOUTHEAST_DEADEND`, `SOLACEON_TOWN`, `STARK_MOUNTAIN_ROOM_1`, `STARK_MOUNTAIN_ROOM_2`, `SUNYSHORE_CITY`, `SURVIVAL_AREA`, `TWINLEAF_TOWN`, `VALLEY_WINDWORKS_OUTSIDE`, `VALOR_LAKEFRONT`, `VEILSTONE_CITY`, `VERITY_LAKEFRONT`, `VICTORY_ROAD_1F`, `VICTORY_ROAD_1F_ROOM_2`, `VICTORY_ROAD_2F`, `VICTORY_ROAD_B1F`, `WAYWARD_CAVE_1F`, `WAYWARD_CAVE_B1F`.

<a id="reach-r15"></a>

### R15 — 15 maps

`BATTLE_ARCADE`, `BATTLE_CASTLE`, `BATTLE_FACTORY`, `BATTLE_FRONTIER`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_WEST_HOUSE`, `CONTEST_HALL_LOBBY`, `HEARTHOME_CITY_EAST_GATE_TO_AMITY_SQUARE`, `HEARTHOME_CITY_POKEMON_FAN_CLUB`, `HEARTHOME_CITY_WEST_GATE_TO_AMITY_SQUARE`, `JUBILIFE_TV_2F`, `POFFIN_HOUSE`, `POKETCH_CO_1F`, `ROUTE_214_GATE_TO_VEILSTONE_CITY`.

<a id="reach-r16"></a>

### R16 — 14 maps

`CANALAVE_CITY_MART`, `ETERNA_CITY_MART`, `FIGHT_AREA_MART`, `FLOAROMA_TOWN_MART`, `HEARTHOME_CITY_MART`, `JUBILIFE_CITY_MART`, `OREBURGH_CITY_MART`, `PASTORIA_CITY_MART`, `SANDGEM_TOWN_MART`, `SNOWPOINT_CITY_MART`, `SOLACEON_TOWN_MART`, `SUNYSHORE_CITY_MART`, `SURVIVAL_AREA_MART`, `UNUSED_RESORT_AREA_MART`.

<a id="reach-r17"></a>

### R17 — 14 maps

`BATTLE_FRONTIER`, `BATTLE_HALL`, `BATTLE_TOWER`, `CANALAVE_CITY_WEST_HOUSE`, `CONTEST_HALL_LOBBY`, `HEARTHOME_CITY_EAST_GATE_TO_AMITY_SQUARE`, `HEARTHOME_CITY_POKEMON_FAN_CLUB`, `HEARTHOME_CITY_WEST_GATE_TO_AMITY_SQUARE`, `JUBILIFE_TV_2F`, `JUBILIFE_TV_2F_GALLERY`, `POFFIN_HOUSE`, `POKETCH_CO_1F`, `ROUTE_214_GATE_TO_VEILSTONE_CITY`, `SUNYSHORE_CITY_NORTHEAST_HOUSE`.

<a id="reach-r18"></a>

### R18 — 20 maps

`TURNBACK_CAVE_ENTRANCE`, `TURNBACK_CAVE_PILLAR_1_ROOM_1`, `TURNBACK_CAVE_PILLAR_1_ROOM_2`, `TURNBACK_CAVE_PILLAR_1_ROOM_3`, `TURNBACK_CAVE_PILLAR_1_ROOM_4`, `TURNBACK_CAVE_PILLAR_1_ROOM_5`, `TURNBACK_CAVE_PILLAR_1_ROOM_6`, `TURNBACK_CAVE_PILLAR_2_ROOM_1`, `TURNBACK_CAVE_PILLAR_2_ROOM_2`, `TURNBACK_CAVE_PILLAR_2_ROOM_3`, `TURNBACK_CAVE_PILLAR_2_ROOM_4`, `TURNBACK_CAVE_PILLAR_2_ROOM_5`, `TURNBACK_CAVE_PILLAR_2_ROOM_6`, `TURNBACK_CAVE_PILLAR_3_ROOM_1`, `TURNBACK_CAVE_PILLAR_3_ROOM_2`, `TURNBACK_CAVE_PILLAR_3_ROOM_3`, `TURNBACK_CAVE_PILLAR_3_ROOM_4`, `TURNBACK_CAVE_PILLAR_3_ROOM_5`, `TURNBACK_CAVE_PILLAR_3_ROOM_6`, `TURNBACK_CAVE_PILLAR_ROOM`.

<a id="reach-r20"></a>

### R20 — 38 maps

`CANALAVE_CITY_POKECENTER_2F`, `CANALAVE_CITY_POKECENTER_B1F`, `CELESTIC_TOWN_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_B1F`, `ETERNA_CITY_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_B1F`, `FIGHT_AREA_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_B1F`, `FLOAROMA_TOWN_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_B1F`, `GLOBAL_TERMINAL_1F`, `HEARTHOME_CITY_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_B1F`, `JUBILIFE_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_B1F`, `OREBURGH_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_B1F`, `PASTORIA_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_B1F`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_B1F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_B1F`, `RESORT_AREA_POKECENTER_2F`, `RESORT_AREA_POKECENTER_B1F`, `SANDGEM_TOWN_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_B1F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_B1F`, `SOLACEON_TOWN_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_B1F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_B1F`, `SURVIVAL_AREA_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_B1F`, `UNION_ROOM`, `VEILSTONE_CITY_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_B1F`.

<a id="reach-r21"></a>

### R21 — 36 maps

`CANALAVE_CITY_POKECENTER_2F`, `CANALAVE_CITY_POKECENTER_B1F`, `CELESTIC_TOWN_POKECENTER_2F`, `CELESTIC_TOWN_POKECENTER_B1F`, `ETERNA_CITY_POKECENTER_2F`, `ETERNA_CITY_POKECENTER_B1F`, `FIGHT_AREA_POKECENTER_2F`, `FIGHT_AREA_POKECENTER_B1F`, `FLOAROMA_TOWN_POKECENTER_2F`, `FLOAROMA_TOWN_POKECENTER_B1F`, `HEARTHOME_CITY_POKECENTER_2F`, `HEARTHOME_CITY_POKECENTER_B1F`, `JUBILIFE_CITY_POKECENTER_2F`, `JUBILIFE_CITY_POKECENTER_B1F`, `OREBURGH_CITY_POKECENTER_2F`, `OREBURGH_CITY_POKECENTER_B1F`, `PASTORIA_CITY_POKECENTER_2F`, `PASTORIA_CITY_POKECENTER_B1F`, `POKEMON_LEAGUE_NORTH_POKECENTER_2F`, `POKEMON_LEAGUE_NORTH_POKECENTER_B1F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_2F`, `POKEMON_LEAGUE_SOUTH_POKECENTER_B1F`, `RESORT_AREA_POKECENTER_2F`, `RESORT_AREA_POKECENTER_B1F`, `SANDGEM_TOWN_POKECENTER_2F`, `SANDGEM_TOWN_POKECENTER_B1F`, `SNOWPOINT_CITY_POKECENTER_2F`, `SNOWPOINT_CITY_POKECENTER_B1F`, `SOLACEON_TOWN_POKECENTER_2F`, `SOLACEON_TOWN_POKECENTER_B1F`, `SUNYSHORE_CITY_POKECENTER_2F`, `SUNYSHORE_CITY_POKECENTER_B1F`, `SURVIVAL_AREA_POKECENTER_2F`, `SURVIVAL_AREA_POKECENTER_B1F`, `VEILSTONE_CITY_POKECENTER_2F`, `VEILSTONE_CITY_POKECENTER_B1F`.

## Appendix: 73 unimplemented commands (not classifier stubs)

These remain `unknown` to the CLI. The macro-expanded native field-script scan found no callers for any of them; none is reached by the ROM-wide coverage roots. No command here was promoted to a stub or assigned a fabricated story dependency. Source links identify the native handler for future triage.

| Opcode | Command | Native handler |
|---|---|---|
| `0x004` | `unused_004` | [ScrCmd_Unused_004](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L817-L823) |
| `0x005` | `unused_005` | [ScrCmd_Unused_005](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L825-L832) |
| `0x006` | `unused_006` | [ScrCmd_Unused_006](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L834-L841) |
| `0x007` | `unused_007` | [ScrCmd_Unused_007](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L843-L850) |
| `0x008` | `unused_008` | [ScrCmd_Unused_008](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L852-L859) |
| `0x009` | `unused_009` | [ScrCmd_Unused_009](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L861-L868) |
| `0x00A` | `unused_00_a` | [ScrCmd_Unused_00A](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L870-L877) |
| `0x00B` | `unused_00_b` | [ScrCmd_Unused_00B](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L890-L897) |
| `0x00C` | `unused_00_c` | [ScrCmd_Unused_00C](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L899-L906) |
| `0x00D` | `unused_00_d` | [ScrCmd_Unused_00D](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L908-L915) |
| `0x00E` | `unused_00_e` | [ScrCmd_Unused_00E](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L917-L924) |
| `0x00F` | `unused_00_f` | [ScrCmd_Unused_00F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L926-L933) |
| `0x010` | `unused_010` | [ScrCmd_Unused_010](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L935-L942) |
| `0x013` | `unused_013` | [ScrCmd_Unused_013](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L960-L971) |
| `0x017` | `unused_017` | [ScrCmd_Unused_017](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1010-L1023) |
| `0x018` | `unused_018` | [ScrCmd_Unused_018](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1025-L1036) |
| `0x019` | `unused_019` | [ScrCmd_Unused_019](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1038-L1051) |
| `0x021` | `check_flag_from_var` | [ScrCmd_CheckFlagFromVar](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1109-L1117) |
| `0x02A` | `unused_02_a` | [ScrCmd_Unused_02A](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1180-L1186) |
| `0x03F` | `unused_03_f` | [ScrCmd_Unused_03F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4877-L4880) |
| `0x06A` | `unused_06_a` | [ScrCmd_Unused_06A](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2462-L2473) |
| `0x06E` | `unused_06_e` | [ScrCmd_Unused_06E](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2534-L2540) |
| `0x081` | `dummy081` | [ScrCmd_Dummy081](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_item.c#L90-L93) |
| `0x082` | `dummy082` | [ScrCmd_Dummy082](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_item.c#L95-L98) |
| `0x084` | `dummy084` | [ScrCmd_Dummy084](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L27-L35) |
| `0x086` | `dummy086` | [ScrCmd_Dummy086](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L51-L59) |
| `0x088` | `dummy088` | [ScrCmd_Dummy088](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L75-L83) |
| `0x089` | `dummy089` | [ScrCmd_Dummy089](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L85-L93) |
| `0x08A` | `dummy08_a` | [ScrCmd_Dummy08A](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L95-L103) |
| `0x08B` | `dummy08_b` | [ScrCmd_Dummy08B](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L105-L116) |
| `0x08C` | `dummy08_c` | [ScrCmd_Dummy08C](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L118-L126) |
| `0x08D` | `dummy08_d` | [ScrCmd_Dummy08D](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L128-L136) |
| `0x08E` | `dummy08_e` | [ScrCmd_Dummy08E](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L138-L146) |
| `0x090` | `dummy090` | [ScrCmd_Dummy090](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L161-L169) |
| `0x091` | `dummy091` | [ScrCmd_Dummy091](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L171-L179) |
| `0x092` | `dummy092` | [ScrCmd_Dummy092](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L181-L189) |
| `0x09C` | `unused_09_c` | [ScrCmd_Unused_09C](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2839-L2842) |
| `0x09D` | `unused_09_d` | [ScrCmd_Unused_09D](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2844-L2847) |
| `0x09E` | `unused_09_e` | [ScrCmd_Unused_09E](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2849-L2852) |
| `0x09F` | `unused_09_f` | [ScrCmd_Unused_09F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2854-L2857) |
| `0x0A0` | `dummy0_a0` | [ScrCmd_Dummy0A0](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L772-L775) |
| `0x0A4` | `unused_0_a4` | [ScrCmd_Unused_0A4](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2980-L2990) |
| `0x0BA` | `unused_0_ba` | [ScrCmd_Unused_0BA](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3452-L3458) |
| `0x0F4` | `unused_0_f4` | [ScrCmd_Unused_0F4](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3864-L3870) |
| `0x0F5` | `unused_0_f5` | [ScrCmd_Unused_0F5](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3872-L3878) |
| `0x0F7` | `unused_0_f7` | [ScrCmd_Unused_0F7](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3893-L3896) |
| `0x105` | `set_true` | [ScrCmd_SetTrue](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_contests.c#L208-L215) |
| `0x122` | `unused_122` | [ScrCmd_Unused_122](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3972-L3977) |
| `0x137` | `unused_137` | [ScrCmd_Unused_137](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4200-L4208) |
| `0x163` | `check_step_flag` | [ScrCmd_CheckStepFlag](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_system_flags.c#L129-L134) |
| `0x165` | `clear_step_flag` | [ScrCmd_ClearStepFlag](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_system_flags.c#L142-L146) |
| `0x1A5` | `dummy1_a5` | [ScrCmd_Dummy1A5](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_daycare.c#L186-L192) |
| `0x1A6` | `dummy1_a6` | [ScrCmd_Dummy1A6](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_daycare.c#L194-L198) |
| `0x1A7` | `dummy1_a7` | [ScrCmd_Dummy1A7](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_daycare.c#L200-L204) |
| `0x1AD` | `dummy1_ad` | [ScrCmd_Dummy1AD](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_daycare.c#L206-L211) |
| `0x1CE` | `unused_1_ce` | [ScrCmd_Unused_1CE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5072-L5075) |
| `0x1D4` | `unused_1_d4` | [ScrCmd_Unused_1D4](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5102-L5118) |
| `0x1E6` | `unused_1_e6` | [ScrCmd_Unused_1E6](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5219-L5232) |
| `0x1E7` | `unused_1_e7` | [ScrCmd_Unused_1E7](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5234-L5257) |
| `0x1EF` | `unused_1_ef` | [ScrCmd_Unused_1EF](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5205-L5209) |
| `0x1F2` | `dummy_1_f2` | [ScrCmd_Dummy_1F2](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_fossil.c#L85-L88) |
| `0x1F3` | `dummy_1_f3` | [ScrCmd_Dummy_1F3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_fossil.c#L90-L93) |
| `0x21E` | `dummy21_e` | [ScrCmd_Dummy21E](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L49-L52) |
| `0x220` | `scr_cmd_220` | [ScrCmd_220](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L84-L87) |
| `0x222` | `scr_cmd_222` | [ScrCmd_222](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party_mon_moves.c#L117-L120) |
| `0x23F` | `dummy23_f` | [ScrCmd_Dummy23F](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_dummy_23F_242.c#L8-L12) |
| `0x240` | `dummy240` | [ScrCmd_Dummy240](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_dummy_23F_242.c#L14-L18) |
| `0x241` | `dummy241` | [ScrCmd_Dummy241](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_dummy_23F_242.c#L20-L23) |
| `0x242` | `dummy242` | [ScrCmd_Dummy242](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_dummy_23F_242.c#L25-L28) |
| `0x2A1` | `unused_2_a1` | [ScrCmd_Unused_2A1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2046-L2093) |
| `0x2C3` | `unused_2_c3` | [ScrCmd_Unused_2C3](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6561-L6565) |
| `0x2CE` | `unused_2_ce` | [ScrCmd_Unused_2CE](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6625-L6632) |
| `0x2F1` | `scr_cmd_2f1` | [ScrCmd_2F1](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L572-L583) |
