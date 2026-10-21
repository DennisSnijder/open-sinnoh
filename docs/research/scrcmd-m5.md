# M5 script-command specification: story checkpoints 5–19

Research date: 2026-10-15. Engine baseline: `abd53e8`; classification snapshot: **840 commands, 318 implemented, 449 stubbed, 73 unimplemented**. Decomp reference: [pret/pokeplatinum `1dc13dcea40c04ab53f1f607de46023dc409ef20`](https://github.com/pret/pokeplatinum/tree/1dc13dcea40c04ab53f1f607de46023dc409ef20), the same pin as [the story map](story-cp5-19.md). This is an original behavioral specification, not a port. No source code, dialogue, ROM, extracted assets, saves or screenshots are reproduced or used. The output of `tools/cp-path-ops.ts` is authoritative.

## Scope and conventions

The command set is the intersection of **`status: "stubbed"` in [op-classification.json](../../packages/vm/src/data/op-classification.json)** and commands used in the checkpoint script corpus described below: **88 distinct commands**. `unimplemented` is a separate classifier status and is not silently included. A command with a real implementation elsewhere but still classified as stubbed remains in scope; classification is the requested selection criterion, not proof of native parity.

Coverage is deliberately broader than a fastest story route: local map script files include their optional NPC, puzzle, event-distribution and postgame branches. Each entry identifies such uses. **A CP number means script presence at that checkpoint, not that the command is an unavoidable success condition.** The same Eterna scene appears in CP6/7, the library in CP11/12, warehouse/HQ in CP8/14, and optional lake guardians in CP15. These are shared coverage boundaries, not repeated required events. CP13 has no unique new stub in its local Snowpoint/Acuity/Rock Climb sequence at this baseline. CP18 likewise uses existing battle/lift primitives; its remaining journal stub is shared with earlier checkpoints.

Inventory procedure:

1. Take the named script files and map headers from each numbered section of `story-cp5-19.md`; resolve their map-local scripts and initialization tables. Expand abbreviated transit floors: Eterna HQ 2F/3F, the Hearthome gym rooms, Canalave library 2F, Iron Island floors, Galactic HQ floors, Mt. Coronet ascent, Great Marsh 1–6, Victory Road 2F/B1F and the cited route approaches and corridor gates. Map headers that reference `scripts_empty` add no commands. Keep the optional branches explicitly discussed by the story map.
2. Expand assembly macros to their opcode-bearing commands, including compound aliases such as ship travel, Safari start/end and accessory rewards. Match command IDs against the engine classification snapshot. Native argument reads take precedence over the generated operand metadata.
3. Follow map calls and wrapper aliases into `scripts_common` and through its local labels. This reaches the Underground rewards and accessory helpers; it does **not** make the entire shared library a CP13 requirement merely because CP13 cites an HM item helper. Thirty-six otherwise unrelated common-only service commands were removed from the broad file scan. Add the event-dispatched ordinary trainer script, including its defeated-trainer/rematch branch. Generic PC, save-menu, honey-tree, berry-tree, hidden-item, communication and other service roots are outside the named story interactions unless a checkpoint script calls them. The native `ClearGame` save/credits path is specified separately below.
4. The appendix records the exact selected opcode/CP matrix. Caller citations in every command entry provide reviewable occurrence evidence. This is a source inventory, not a ROM execution or proof that all paths through a map are reachable before Champion. Minimum unavoidable sight-trainer routes remain uncertain as in the story map.

Argument notation: `u8/u16/u32` are encoded widths; **literal** means consumed directly; **V** (var-or-value) means a halfword resolved through the script variable lookup; **D** means an encoded variable ID yielding a writable pointer; **R** means an encoded variable ID read through that pointer, never interpreted as an immediate value. Variable IDs at or above `0x4000` use variable lookup (including temporary script vars); ordinary smaller values remain literals under V. An operand described as D may be used as a task output later. Do not confuse an object's local ID or a flag ID with a variable ID. [inline operand readers](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/inlines.h#L145-L153); [value/variable lookup](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/script_manager.c#L428-L453)

Wait notation distinguishes three native behaviors: **immediate** (`FALSE`, execute the next opcode in the same interpreter run); **yield** (`TRUE`, end this run without necessarily installing a completion predicate); and **pause/task wait** (resume only when the named predicate or owning field/application task completes). A `TRUE` return alone is not evidence that a visual task has finished. A satisfied pause predicate changes state to running but does not execute the next opcode until the following interpreter run. Numeric “ticks” in the entries below mean native task-update counts or native fade-duration parameters, not 30 Hz engine ticks. Preserve the distinction when mapping to the VM's `continue`, `yield` and `r.pause`. [native interpreter](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/field_script_context.c#L41-L101); [current runner](../../packages/vm/src/runner.ts), [field op style](../../packages/vm/src/m1b-ops.ts), [battle op style](../../packages/vm/src/m2a-ops.ts).

**NEW SYSTEM** flags a required capability beyond one state-editing handler; it is an implementation assessment against the existing [contracts](../contracts.md), not a request to change contracts in this PR. Persisted feature state, transient task state and ordinary story flags/vars are different stores. Unless an entry says otherwise, it has no additional party, bag, flag, variable, save, object, camera or sound writes beyond the state explicitly described. Assertions/internal object requirements are decomp preconditions; validate imported/script boundaries rather than inventing silent zero-result fallbacks.

## Battle starts, doubles, legendary encounters and results — first CP5

Battle lifecycle shared by StartWildBattle, StartLegendaryBattle, StartGiratinaOriginBattle and StartTagBattle: the encounter task pauses field object movement, performs intro/BGM and map teardown, runs battle, then transfers player trainer info, player party, bag, Pokédex and Safari Ball count back into save-backed state. Raw result is copied even on loss/draw. Loss/draw returns early; caller's blackout path owns recovery. Other outcomes heal the player party when the persistent has-partner flag is set, update game records/journal and last-battle-turns var, restore map, unpause objects and fade in. Thus “wait for encounter” includes restoration on the successful continuation, while a loss does not take that restoration branch. [src/encounter.c:136–232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L136-L232), [src/field_battle_data_transfer.c:415–430](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/field_battle_data_transfer.c#L415-L430).

<a id="cmd-2a0"></a>

### ScrCmd_StartTagBattle — 0x2A0 (672)

Arguments (wire order): `partnerTrainer: u16 var-or-value`, `enemyTrainer1: u16 var-or-value`, `enemyTrainer2: u16 var-or-value`.

**NEW SYSTEM: multiple trainers and AI partner ownership**, beyond the existing single trainer adapter. Resolves partner first, then enemy 1 and enemy 2; constructs trainer encounter and writes the script battle-result mask on completion. Distinct nonzero enemies select player-versus-two (battle type 19) when partner is zero, or AI partner multi (75) otherwise. Equal enemy IDs select ordinary doubles (3); a lone enemy selects trainer singles (1), even if partner is supplied. Clears Radar chain, initializes battle DTO from save, loads trainer parties, increments trainer-battles record, chooses intro/BGM and sets Distortion status on applicable maps. Waits for the encounter field task including battle, result transfer, evolution/field restoration; visible battle screen, battle music, item/HP/status/experience/capture/prize effects belong to that task. Caller controls story flags and object removal; do not assume victory or set those flags in this op.

Behavior source: [src/scrcmd_trainer.c:146–161](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_trainer.c#L146-L161) Helpers: [src/encounter.c:724–757](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L724-L757), [src/encounter.c:151–232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L151-L232), [include/constants/battle.h:24–55](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/constants/battle.h#L24-L55).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_jubilife_city.s:876–876](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L876-L876); CP8,14 [res/field/scripts/scripts_veilstone_city.s:503–503](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city.s#L503-L503); CP15 [res/field/scripts/scripts_spear_pillar.s:176–176](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L176-L176).

<a id="cmd-2bd"></a>

### ScrCmd_StartLegendaryBattle — 0x2BD (701)

Arguments (wire order): `species: u16 var-or-value`, `level: u16 var-or-value`.

Battle adapter extension; **NEW SYSTEM if legendary encounter status/presentation is not supported**. Resolves species and level (level narrows to u8), clears Radar chain, creates one scripted wild opponent, marks legendary status, increments wild-battles record, selects cut-in/BGM and starts normal encounter task. Waits through battle, save/party transfer, evolution and return to field, storing raw result mask. Legendary is a status bit, not an automatic capture or fateful-encounter flag. HP/status/items/capture/dex outcomes are real battle effects; script decides hide/defeat flags and retry policy. Drifloon in CP5 is optional; lake guardians/Dialga/Palkia are also optional encounters, not minimum-route requirements merely because their files appear in the checkpoint map.

Behavior source: [src/scrcmd.c:4008–4016](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4008-L4016) Helpers: [src/encounter.c:549–566](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L549-L566), [src/encounter.c:151–232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L151-L232).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_valley_windworks_outside.s:146–146](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_valley_windworks_outside.s#L146-L146); CP12,15 [res/field/scripts/scripts_valor_cavern.s:47–47](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_valor_cavern.s#L47-L47); CP15 [res/field/scripts/scripts_acuity_cavern.s:33–33](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_acuity_cavern.s#L33-L33); CP15 [res/field/scripts/scripts_spear_pillar_dialga.s:43–43](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_dialga.s#L43-L43); CP15 [res/field/scripts/scripts_spear_pillar_palkia.s:43–43](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_palkia.s#L43-L43).

<a id="cmd-124"></a>

### ScrCmd_StartWildBattle — 0x124 (292)

Arguments (wire order): `species: u16 var-or-value`, `level: u16 var-or-value`.

Small extension to existing wild-battle dispatch. Resolves species and level, narrows level to u8; clears Radar chain, creates scripted opponent, increments wild-battles record and starts cut-in/BGM/battle task **without** legendary status. Waits until encounter finishes and raw result transfers to script state. Actual battle mutates party, consumed bag items, dex/capture/storage and records; script handles story flags. CP8 Route 209 Spiritomb is optional; no automatic fateful flag or guaranteed victory/capture.

Behavior source: [src/scrcmd.c:3998–4006](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3998-L4006) Helpers: [src/encounter.c:549–566](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L549-L566), [src/encounter.c:151–232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L151-L232).

Checkpoint uses (file occurrence; optional interactions remain optional): CP8 [res/field/scripts/scripts_route_209.s:78–78](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_209.s#L78-L78).

<a id="cmd-09b"></a>

### ScrCmd_GetRematchTrainerID — 0x09B (155)

Arguments (wire order): `trainerID: u16 var-or-value`, `destVar: u16 destination variable ID`.

**NEW SYSTEM dependency: Vs. Seeker rematch progression**; query itself is small. Resolves base trainer ID, reads target map object, writes rematch trainer ID. Returns TRAINER_NONE=0 unless object movement is Vs. Seeker spin and base trainer has rematch-table entry. Chooses first nondefeated available rematch tier before end sentinel; if selected tier is not unlocked, falls back to the next lower populated tier, then reads its trainer ID. Reads trainer-defeat and Vs. Seeker unlock flags without changing them. No battle launch, animation start, recharge, wait, screen or sound. Shared trainer revisit branch is optional and can occur CP5–18; Vs. Seeker award first occurs CP7.

Behavior source: [src/scrcmd.c:2821–2829](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2821-L2829) Helpers: [src/overlay005/vs_seeker.c:697–779](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/vs_seeker.c#L697-L779).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5,6,7,8,9,10,11,12,13,14,15,16,17,18 [res/field/scripts/scripts_battles.s:45–45](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_battles.s#L45-L45).

<a id="cmd-314"></a>

### ScrCmd_GetBattleResult — 0x314 (788)

Arguments (wire order): `destVar: u16 destination variable ID`.

Small query, but needs a **raw battle result mask** beyond a won/lost Boolean. Reads script-manager battle result and writes destination (u16); returns TRUE, a single yield without asynchronous wait. Values: win=1, lose=2, draw=3, caught=4, player fled=5, enemy fled=6 (attempt flags also exist). Does not clear result. CP15 Giratina branches distinguish captured from defeated/fled; substituting CheckWonBattle is incorrect. No screen/sound or save mutation.

Behavior source: [src/scrcmd_trainer.c:329–336](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_trainer.c#L329-L336) Helpers: [include/constants/battle.h:72–80](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/constants/battle.h#L72-L80).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_distortion_world_giratina_room.s:72–72](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L72-L72).

<a id="cmd-319"></a>

### ScrCmd_StartGiratinaOriginBattle — 0x319 (793)

Arguments (wire order): `species: u16 var-or-value`, `level: u16 var-or-value`.

**NEW SYSTEM: Giratina/Distortion encounter presentation**, atop real wild battle. Resolves species and level (u8 narrowing), clears Radar chain, creates scripted opponent and forces Origin form if species is Giratina (ability/stats recalculated). Sets legendary, Giratina and Distortion status bits and Giratina terrain regardless of species operand; increments wild-battles record and dispatches intro/BGM/encounter. Waits through encounter completion/result/field restoration. Actual party, items, capture, dex and storage persist through normal battle transfer; raw result is consumed by subsequent GetBattleResult. No automatic story completion flag or forced capture.

Behavior source: [src/scrcmd.c:4018–4026](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4018-L4026) Helpers: [src/encounter.c:970–992](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L970-L992), [src/pokemon.c:4407–4417](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokemon.c#L4407-L4417), [src/encounter.c:151–232](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/encounter.c#L151-L232).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_distortion_world_giratina_room.s:69–69](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L69-L69).

## Items, party, money and persistent records — first CP5

<a id="cmd-072"></a>

### ScrCmd_ShowMoney — 0x072 (114)

Arguments (wire order): `tilemapLeft: u16 var-or-value`, `tilemapTop: u16 var-or-value`.

Small UI op. Creates the script-owned money window, draws its frame and current trainer money, and stores the window handle. Coordinates are resolved u16 operands narrowed to u8 by the window helper. It does not subtract money. No wait; the VRAM copy is scheduled. Edge: this is a create operation, so callers must pair it with HideMoney; creating twice overwrites the stored handle.

Behavior source: [src/scrcmd_money.c:82–91](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_money.c#L82-L91) Helpers: [src/overlay005/field_menu.c:682–736](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/field_menu.c#L682-L736).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_floaroma_meadow.s:162–162](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_meadow.s#L162-L162); CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:27–27](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L27-L27); CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s:15–15](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L15-L15).

<a id="cmd-073"></a>

### ScrCmd_HideMoney — 0x073 (115)

Arguments (wire order): none.

Small UI op. Erases the existing money-window frame and deletes its window; no money/save change and no wait. Requires the live handle created by ShowMoney; there is no null/idempotence guard.

Behavior source: [src/scrcmd_money.c:93–100](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_money.c#L93-L100) Helpers: [src/overlay005/field_menu.c:702–707](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/field_menu.c#L702-L707).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_floaroma_meadow.s:202–202](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_meadow.s#L202-L202), [res/field/scripts/scripts_floaroma_meadow.s:210–210](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_meadow.s#L210-L210), [res/field/scripts/scripts_floaroma_meadow.s:218–218](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_meadow.s#L218-L218), [res/field/scripts/scripts_floaroma_meadow.s:226–226](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_meadow.s#L226-L226); CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:50–50](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L50-L50), [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:81–81](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L81-L81), [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:89–89](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L89-L89), [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:96–96](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L96-L96); CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s:20–20](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L20-L20), [res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s:30–30](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L30-L30), [res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s:39–39](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L39-L39).

<a id="cmd-074"></a>

### ScrCmd_UpdateMoneyDisplay — 0x074 (116)

Arguments (wire order): none.

Small UI op. Reads trainer money, clears the numeric area, prints the right-aligned amount and schedules the window copy. No subtraction, flags or other save writes; no wait. Requires the existing window; caller performs any transaction separately.

Behavior source: [src/scrcmd_money.c:102–109](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_money.c#L102-L109) Helpers: [src/overlay005/field_menu.c:709–736](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/field_menu.c#L709-L736).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_floaroma_meadow.s:198–198](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_meadow.s#L198-L198); CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:44–44](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L44-L44); CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s:27–27](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L27-L27).

<a id="cmd-1d2"></a>

### ScrCmd_AddAccessory — 0x1D2 (466)

Arguments (wire order): `accessoryID: u16 var-or-value`, `amount: u16 var-or-value`.

**NEW SAVE SUBSYSTEM: Fashion Case**, then small mutation op. Resolves accessory and amount and mutates ImageClips/Fashion Case, separate from bag. Multiple-copy accessories store capped count 9, unique accessories cap at 1; invalid accessory ID asserts in helper. Repeats at cap do not grant additional useful copies. Helper computes through an u8 count, so arbitrary oversized amounts have narrowing behavior before cap; story amounts are small. No output, wait or visible screen; caller owns award messaging, sounds and flags.

Behavior source: [src/scrcmd.c:5077–5087](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5077-L5087) Helpers: [src/unk_020298BC.c:421–447](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020298BC.c#L421-L447), [include/constants/accessories.h:1–7](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/constants/accessories.h#L1-L7).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_jubilife_city.s:1006–1006](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L1006-L1006), [res/field/scripts/scripts_jubilife_city.s:1013–1013](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L1013-L1013); CP7,9,10 [res/field/scripts/scripts_common.s:752–752](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L752-L752).

<a id="cmd-1d5"></a>

### ScrCmd_AddContestBackdrop — 0x1D5 (469)

Arguments (wire order): `backdropID: u16 var-or-value`.

**NEW SAVE SUBSYSTEM: Fashion Case**, then small mutation op. Resolves backdrop ID; if not owned, stores its acquisition-order index in the backdrop flags. Already owned is unchanged. Invalid ID asserts. No bag item, destination, wait or automatic message/sound.

Behavior source: [src/scrcmd.c:5120–5129](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5120-L5129) Helpers: [src/unk_020298BC.c:473–485](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020298BC.c#L473-L485).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_jubilife_city.s:996–996](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L996-L996), [res/field/scripts/scripts_jubilife_city.s:1022–1022](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_jubilife_city.s#L1022-L1022).

<a id="cmd-31c"></a>

### ScrCmd_FindPartySlotWithFatefulEncounterSpecies — 0x31C (796)

Arguments (wire order): `destVar: u16 destination variable ID`, `species: u16 var-or-value`.

Small party query. Sets destination to 0xFF, scans current party in order, skips eggs and returns first slot whose species matches and whose fateful-encounter bit is true. No mutation beyond destination; no wait, screen or sound. No match (including empty party/only eggs) remains 255. CP5 use is optional Floaroma event access, not a Works Key/Mars requirement.

Behavior source: [src/scrcmd_party.c:777–804](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_party.c#L777-L804).

Checkpoint uses (file occurrence; optional interactions remain optional): CP5 [res/field/scripts/scripts_floaroma_town.s:105–105](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_floaroma_town.s#L105-L105).

<a id="cmd-1cd"></a>

### ScrCmd_CreateJournalEvent — 0x1CD (461)

Arguments (wire order): `eventType: u16 var-or-value`, `eventParam: u16 var-or-value`, `unused1: u16 var-or-value`, `unused2: u16 var-or-value`, `unused3: u16 var-or-value`.

**NEW SYSTEM: journal location-event persistence**, then dispatch op. Reads five resolved u16 operands; final three are consumed and ignored. Supported event types build location events for Game Corner, Safari game, obtained item (parameter=item), Cut/Surf/Strength/Defog/Rock Smash/Waterfall/Rock Climb (parameter=map ID and move index derived from event type), or battle facilities. Saves into current field journal entry; null entry discards the temporary event. Unsupported eventType yields without creating data. Returns TRUE (one script yield), with no asynchronous wait, visible journal screen or sound. The actual Gym-too-tough, beat-Gym-leader, beat-Elite-Four-member and beat-Champion event IDs used by checkpoint scripts hit this handler’s default branch and create **no event** at this pinned revision; journal support elsewhere does not override that dispatch. This surprising behavior is established directly by the handler switch. No independent flags/party/bag changes.

Behavior source: [src/scrcmd.c:5023–5070](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5023-L5070) Helpers: [src/journal.c:210–234](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/journal.c#L210-L234), [src/journal.c:735–796](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/journal.c#L735-L796).

Checkpoint uses (file occurrence; optional interactions remain optional): CP6 [res/field/scripts/scripts_eterna_city_gym.s:65–65](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L65-L65), [res/field/scripts/scripts_eterna_city_gym.s:83–83](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L83-L83); CP7 [res/field/scripts/scripts_hearthome_city_gym_leader_room.s:58–58](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_gym_leader_room.s#L58-L58), [res/field/scripts/scripts_hearthome_city_gym_leader_room.s:81–81](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_gym_leader_room.s#L81-L81); CP8 [res/field/scripts/scripts_veilstone_city_gym.s:23–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_gym.s#L23-L23), [res/field/scripts/scripts_veilstone_city_gym.s:40–40](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_gym.s#L40-L40); CP8,13,14 [res/field/scripts/scripts_visible_items.s:2392–2392](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_visible_items.s#L2392-L2392); CP9 [res/field/scripts/scripts_pastoria_city_gym.s:47–47](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L47-L47), [res/field/scripts/scripts_pastoria_city_gym.s:69–69](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L69-L69); CP11 [res/field/scripts/scripts_canalave_city_gym.s:20–20](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_gym.s#L20-L20), [res/field/scripts/scripts_canalave_city_gym.s:40–40](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_gym.s#L40-L40); CP13 [res/field/scripts/scripts_snowpoint_city_gym.s:24–24](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_gym.s#L24-L24), [res/field/scripts/scripts_snowpoint_city_gym.s:43–43](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_snowpoint_city_gym.s#L43-L43); CP15,16,17 [res/field/scripts/scripts_field_moves.s:58–58](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L58-L58), [res/field/scripts/scripts_field_moves.s:75–75](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L75-L75), [res/field/scripts/scripts_field_moves.s:159–159](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L159-L159), [res/field/scripts/scripts_field_moves.s:176–176](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L176-L176), [res/field/scripts/scripts_field_moves.s:219–219](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L219-L219), [res/field/scripts/scripts_field_moves.s:243–243](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L243-L243), [res/field/scripts/scripts_field_moves.s:284–284](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L284-L284), [res/field/scripts/scripts_field_moves.s:295–295](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L295-L295), [res/field/scripts/scripts_field_moves.s:325–325](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L325-L325), [res/field/scripts/scripts_field_moves.s:338–338](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L338-L338), [res/field/scripts/scripts_field_moves.s:369–369](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L369-L369), [res/field/scripts/scripts_field_moves.s:389–389](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L389-L389), [res/field/scripts/scripts_field_moves.s:446–446](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L446-L446), [res/field/scripts/scripts_field_moves.s:459–459](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_field_moves.s#L459-L459); CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_3.s:30–30](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L30-L30), [res/field/scripts/scripts_sunyshore_city_gym_room_3.s:53–53](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L53-L53); CP18 [res/field/scripts/scripts_pokemon_league_aaron_room.s:42–42](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_aaron_room.s#L42-L42), [res/field/scripts/scripts_pokemon_league_aaron_room.s:46–46](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_aaron_room.s#L46-L46); CP18 [res/field/scripts/scripts_pokemon_league_bertha_room.s:42–42](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_bertha_room.s#L42-L42), [res/field/scripts/scripts_pokemon_league_bertha_room.s:46–46](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_bertha_room.s#L46-L46); CP18 [res/field/scripts/scripts_pokemon_league_flint_room.s:44–44](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_flint_room.s#L44-L44), [res/field/scripts/scripts_pokemon_league_flint_room.s:48–48](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_flint_room.s#L48-L48); CP18 [res/field/scripts/scripts_pokemon_league_lucian_room.s:42–42](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_lucian_room.s#L42-L42), [res/field/scripts/scripts_pokemon_league_lucian_room.s:46–46](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_lucian_room.s#L46-L46); CP19 [res/field/scripts/scripts_pokemon_league_champion_room.s:71–71](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_champion_room.s#L71-L71), [res/field/scripts/scripts_pokemon_league_champion_room.s:75–75](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_champion_room.s#L75-L75).

<a id="cmd-14c"></a>

### ScrCmd_SetBlackOutWarpId — 0x14C (332)

Arguments (wire order): `warpId: u16 var-or-value`.

Small persistence op using existing blackout system. Resolves warp ID and writes FieldOverworldState blackout-warp ID. Does not warp, heal, charge money or start an animation; no wait/screen/sound. Cycle Shop uses it after the Bicycle event. The saved value is consumed by later blackout handling.

Behavior source: [src/scrcmd.c:4489–4496](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4489-L4496).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_cycle_shop.s:23–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_cycle_shop.s#L23-L23).

<a id="cmd-263"></a>

### ScrCmd_ChangeDeoxysForm — 0x263 (611)

Arguments (wire order): `form: u16 var-or-value`.

Small party mutation requiring form/stat and dex support. Resolves form; loops every occupied party slot, and for each species Deoxys writes form, recalculates level/stats and calls Pokedex_Capture. Does not stop at first match. Handler has no egg exclusion and no explicit form-range check; only callers’ valid form IDs are established. Returns TRUE (one yield), no asynchronous wait or visible transformation animation; meteorite caller supplies effects. Optional Veilstone interaction appears again with CP14’s reused map.

Behavior source: [src/scrcmd.c:5752–5770](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5752-L5770).

Checkpoint uses (file occurrence; optional interactions remain optional): CP8,14 [res/field/scripts/scripts_veilstone_city.s:1287–1287](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city.s#L1287-L1287), [res/field/scripts/scripts_veilstone_city.s:1301–1301](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city.s#L1301-L1301), [res/field/scripts/scripts_veilstone_city.s:1315–1315](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city.s#L1315-L1315), [res/field/scripts/scripts_veilstone_city.s:1329–1329](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city.s#L1329-L1329).

<a id="cmd-2a2"></a>

### ScrCmd_TrySetUnusedCollectedOrbFlag — 0x2A2 (674)

Arguments (wire order): `item: u16 var-or-value`.

Small Underground-save bit mutation: resolves item, and sets the unused collected-orb flag only for Adamant Orb or Lustrous Orb; every other item is a no-op. No item grant/removal, dex or party change, output, wait, screen or sound. Shared visible-item code uses it; its occurrence does not make obtaining either orb mandatory.

Behavior source: [src/scrcmd.c:6403–6413](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6403-L6413).

Checkpoint uses (file occurrence; optional interactions remain optional): CP8,13,14 [res/field/scripts/scripts_visible_items.s:2318–2318](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_visible_items.s#L2318-L2318).

<a id="cmd-284"></a>

### ScrCmd_GetUnownFormsSeenCount — 0x284 (644)

Arguments (wire order): `destVar: u16 destination variable ID`.

Small Pokédex query. Writes number of distinct Unown forms seen; checks dex integrity via helper. Does not count party/box Unown, require capture, alter dex or open a screen. No wait or sound. CP9 Route 214 optional Ruin Maniac interaction; not the bomb pursuit gate.

Behavior source: [src/scrcmd.c:6076–6083](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6076-L6083) Helpers: [src/pokedex.c:150–161](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokedex.c#L150-L161), [src/pokedex.c:914–918](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokedex.c#L914-L918).

Checkpoint uses (file occurrence; optional interactions remain optional): CP9 [res/field/scripts/scripts_route_214.s:12–12](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_214.s#L12-L12), [res/field/scripts/scripts_route_214.s:34–34](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_214.s#L34-L34).

<a id="cmd-22c"></a>

### ScrCmd_TurnOnPokedexFormDetection — 0x22C (556)

- **Arguments:** none. **Small op:** persisted Pokédex capability bit; forms UI must subsequently honor it.
- **Behavior/state:** obtains the saved Pokédex block, asserts its integrity magic, and sets `canDetectForms = TRUE`. It does not grant the Pokédex or National Dex, mark any species/form seen or caught, scan or change the party, or retroactively create Pokémon. Repeating it is idempotent. The saved byte is separate from species seen/caught/form records and from script flags. No bag, field-object, camera, sound or transient message state is changed by the opcode.
- **Wait/screen/edges:** immediate, no pause and no direct visual effect. The Pokédex app reads the capability via `Pokedex_CanDetectForms`/`PokedexSort_CanDetectForms`; it gates entry to the forms option and hides that option's sprite while disabled. The surrounding aide scene supplies messages, NPC movement/removal, sound, hide flag and route-gate state change. The user-facing scene describes gender/form display; the exact op is only the capability write, not a party transformation.
- **Use:** CP11 required westward Route 218→Canalave gate aide coordinate scene: [scripts_route_218_gate_to_canalave_city.s:10–40](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_218_gate_to_canalave_city.s#L10-L40).
- **Implementation evidence:** [src/scrcmd.c:5460–5464](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5460-L5464), integrity assertion [src/pokedex.c:48–51](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokedex.c#L48-L51), saved accessors [1070–1080](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokedex.c#L1070-L1080), sort wrapper [src/applications/pokedex/pokedex_sort.c:605–608](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/applications/pokedex/pokedex_sort.c#L605-L608), option gate [src/applications/pokedex/ov21_021E29DC.c:549–556](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/applications/pokedex/ov21_021E29DC.c#L549-L556), hidden sprite [1572–1577](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/applications/pokedex/ov21_021E29DC.c#L1572-L1577).

<a id="cmd-32b"></a>

### ScrCmd_CheckPartyHasFatefulEncounterRegigigas — 0x32B (811)

Arguments (wire order): `destVar: u16 destination variable ID`.

Small party query. Writes false, scans occupied party slots and returns true at first non-egg Regigigas whose fateful-encounter bit is true. Ignores level, held item and party order except early match; ordinary Regigigas or an egg fails. No party/save mutation beyond destination, wait, screen or sound. CP11 Iron Island B3F optional event cave check; not Riley or HM04 progression.

Behavior source: [src/scrcmd.c:7113–7134](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7113-L7134).

Checkpoint uses (file occurrence; optional interactions remain optional): CP11 [res/field/scripts/scripts_iron_island_b3f.s:11–11](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_island_b3f.s#L11-L11), [res/field/scripts/scripts_iron_island_b3f.s:19–19](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_island_b3f.s#L19-L19).

<a id="cmd-1e5"></a>

### ScrCmd_IncrementGameRecord — 0x1E5 (485)

Arguments (wire order): `recordID: u16 literal`.

Small persistent-record op. Reads **literal** u16 record ID and increments selected GameRecords field with its configured limit, encoding the storage afterward. At limit it remains capped. No destination, wait, screen or sound. CP15/16 occurrence is incidental Rowan research-lab starter-nickname shared-map logic (RECORD_POKEMON_NICKNAMED), not a post-Distortion event; record identity comes from caller, not opcode. Does not grant trainer score directly unless that specific record’s helper semantics do so.

Behavior source: [src/scrcmd.c:5211–5217](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5211-L5217) Helpers: [src/game_records.c:360–371](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/game_records.c#L360-L371).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15,16 [res/field/scripts/scripts_sandgem_town_pokemon_research_lab.s:188–188](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sandgem_town_pokemon_research_lab.s#L188-L188).

## Field objects, movement and gym geometry — first CP6

<a id="cmd-32d"></a>

### ScrCmd_32D — 0x32D (813)

- **Arguments:** none. **Small op over the existing live-object renderer**, with height/status behavior that a simple visibility toggle would miss.
- **Behavior/state:** reads the player's live fixed-point Y coordinate, then iterates active (`MAP_OBJ_STATUS_0`) map objects excluding the player. Sets `MAP_OBJ_STATUS_13` on each. For objects also carrying status 12, replaces their world Y with the player's Y and their logical Y with the handler's fixed-point conversion (world Y divided by eight world units, using its integer conversion). Finds the object's billboard; berry patches may first have their graphics initialized if their helper says they are eligible. Synchronizes the billboard with the object and explicitly enables its draw flag. It writes live object/render state, not script flags, bag, party or save variables. It does not move the camera or play sound.
- **Wait/screen/edges:** immediate, no pause. Existing NPC/berry graphics can move vertically and become drawable as part of scene staging. Objects without billboards still receive the status/height changes. The player is always excluded. Do not interpret unnamed status 13 as a persistent hide flag; its semantic name remains **uncertain** in this revision. The corresponding `ScrCmd_32E` clears status 13 globally; the Eterna event also uses more targeted companion commands.
- **Use:** CP6/CP7 map coverage, Eterna rival coordinate scene (same script use, not two distinct scenes): [scripts_eterna_city.s:705–715](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L705-L715).
- **Implementation evidence:** [src/overlay005/ov5_021F6454.c:914–956](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L914-L956), companion cleanup [958–975](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L958-L975).

<a id="cmd-32e"></a>

### ScrCmd_32E — 0x32E (814)

**Arguments:** none. **State/effect:** visits all active live map objects except the player and clears status bit 13. This removes the related scene visibility override: billboard update hides an object with status12 when status13 is clear. It does not restore old coordinates itself. **Wait:** FALSE. No flags/save/party/bag writes. Objects with status12 can disappear on their next billboard update. **Small op** once object status/visibility behavior exists. **Uncertain:** bit 13 has no descriptive enum name in this revision; preserve the exact bit operation rather than claiming a general movement unlock.

**Decomp:** [src/overlay005/ov5_021F6454.c:958–973](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L958-L973), [src/overlay005/ov5_021F6454.c:912–976](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L912-L976), [src/overlay005/ov5_021EB1A0.c:1525–1541](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021EB1A0.c#L1525-L1541).

**Checkpoint uses:** CP6 [res/field/scripts/scripts_eterna_city.s:790–790](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L790-L790); CP7 [res/field/scripts/scripts_eterna_city.s:790–790](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L790-L790).

<a id="cmd-331"></a>

### ScrCmd_331 — 0x331 (817)

**Arguments:** none. **State/effect:** independently looks up locals 32 and 2. For each present object sets status bit 13, assigns render Y to 9 tile units (144 world units), assigns logical map-object Y=18, refreshes its billboard if present and enables billboard drawing. Missing objects are deliberately skipped. **Wait:** FALSE. This is a synchronous height placement, **not** an animation, despite the current `classify.ts` triage wording. No save/party/bag writes. **Small op** over object heights/billboards; needs their existing coordinate units.

**Decomp:** [src/overlay005/ov5_021F6454.c:996–1015](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L996-L1015), [src/overlay005/ov5_021F6454.c:978–1015](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L978-L1015).

**Checkpoint uses:** CP6 [res/field/scripts/scripts_eterna_city.s:708–708](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L708-L708); CP7 [res/field/scripts/scripts_eterna_city.s:708–708](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L708-L708).

<a id="cmd-332"></a>

### ScrCmd_332 — 0x332 (818)

**Arguments:** none. **State/effect:** looks up locals 32 and 2 separately and clears status bit 13 for each present object, removing the forced-draw exception for objects carrying status12. Missing locals are skipped. Does not itself restore previous Y, run movement or remove the objects. **Wait:** FALSE. No save, party or bag write; status12 objects can become hidden on their next billboard update. **Small op** once object height/status semantics are available; bit name remains unresolved.

**Decomp:** [src/overlay005/ov5_021F6454.c:1017–1035](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L1017-L1035), [src/overlay005/ov5_021F6454.c:1017–1037](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021F6454.c#L1017-L1037), [src/overlay005/ov5_021EB1A0.c:1525–1541](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021EB1A0.c#L1525-L1541).

**Checkpoint uses:** CP6 [res/field/scripts/scripts_eterna_city.s:791–791](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L791-L791); CP7 [res/field/scripts/scripts_eterna_city.s:791–791](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city.s#L791-L791).

<a id="cmd-2c9"></a>

### ScrCmd_InitPersistedMapFeaturesForEternaGym — 0x2C9 (713)

**Arguments:** none. **State/effect:** selects the Eterna Gym variant of the single persisted dynamic-map-feature save buffer, then zeros its clock feature, including progression state. This is puzzle initialization, not merely a visual refresh; later dynamic-map loading reads this state to construct clock hands and routes. No flag, party or bag write. **Wait:** FALSE, immediate. No animation by this command. **Edge:** applying it after progress resets the clock state. **NEW SYSTEM:** persisted Gym geometry and collision.

**Decomp:** [src/scrcmd.c:4768–4772](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4768-L4772), [src/persisted_map_features_init.c:104–111](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L104-L111), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP6 [res/field/scripts/scripts_eterna_city_gym.s:16–16](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L16-L16).

<a id="cmd-2ca"></a>

### ScrCmd_AdvanceEternaGymClock — 0x2CA (714)

**Arguments:** none. **State/effect:** increments the persisted Eterna clock state unless already at the defeated-leader state; updates the flower-clock state and constructs a field task using the script message window, loader, options and buffer. Pans to the clock, delays, rotates hands to the new time with clock sounds, then returns camera. After the second/third trainers it also pans to the appropriate fountain, lowers its water effect, prints the internal explanatory message, waits for printing and A/B, removes the message window, and returns camera to player. **Wait:** handler TRUE; real completion is the nested field task, including the input branch. At terminal clock state the helper starts no task although handler still returns TRUE. **NEW SYSTEM:** moving puzzle geometry, camera and fountain tasks. No party/bag writes.

**Decomp:** [src/scrcmd.c:6597–6605](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6597-L6605), [src/overlay008/gym_features.c:2745–2933](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay008/gym_features.c#L2745-L2933).

**Checkpoint uses:** CP6 [res/field/scripts/scripts_eterna_city_gym.s:128–128](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L128-L128), [res/field/scripts/scripts_eterna_city_gym.s:135–135](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L135-L135), [res/field/scripts/scripts_eterna_city_gym.s:159–159](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L159-L159), [res/field/scripts/scripts_eterna_city_gym.s:187–187](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L187-L187), [res/field/scripts/scripts_eterna_city_gym.s:215–215](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_gym.s#L215-L215).

<a id="cmd-171"></a>

### ScrCmd_InitPersistedMapFeaturesForHearthomeGym — 0x171 (369)

**Arguments:** none. **State/effect:** selects Hearthome Gym's persisted dynamic-map-feature variant and retrieves its feature buffer; there is no additional field initialization in this handler/helper. The common initializer clears the entire shared feature buffer before setting the system identity. Room mechanisms are consumers, not work this opcode directly performs. **Wait:** FALSE. No direct screen, flag, party or bag effect. **NEW SYSTEM:** Hearthome dark-room/puzzle state; do not invent extra writes from this command's name.

**Decomp:** [src/scrcmd.c:4724–4728](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4724-L4728), [src/persisted_map_features_init.c:122–128](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L122-L128), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP7 [res/field/scripts/scripts_hearthome_city_gym_trainer_room_1.s:9–9](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_gym_trainer_room_1.s#L9-L9); CP7 [res/field/scripts/scripts_hearthome_city_gym_trainer_room_2.s:9–9](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city_gym_trainer_room_2.s#L9-L9).

<a id="cmd-174"></a>

### ScrCmd_InitPersistedMapFeaturesForVeilstoneGym — 0x174 (372)

**Arguments:** none. **State/effect:** selects Veilstone Gym persisted-feature storage and marks its `initialized` field false, allowing dynamic-map setup to initialize the punching-bag puzzle. **Wait:** FALSE; no direct animation or party/bag/flag write. Reapplying is a puzzle-reset operation, not a harmless redraw. **NEW SYSTEM:** punching bags, their geometry and persisted puzzle state.

**Decomp:** [src/scrcmd.c:4744–4748](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4744-L4748), [src/persisted_map_features_init.c:113–120](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L113-L120), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP8 [res/field/scripts/scripts_veilstone_city_gym.s:15–15](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_veilstone_city_gym.s#L15-L15).

<a id="cmd-16f"></a>

### ScrCmd_InitPersistedMapFeaturesForPastoriaGym — 0x16F (367)

**Arguments:** none. **State/effect:** selects Pastoria Gym's persisted-feature variant and records green as the pressed button. Dynamic-map setup derives water/platform presentation and collision from that save feature. **Wait:** FALSE. No direct water animation, flag, party or bag write. **NEW SYSTEM:** dynamic water floor and collision.

**Decomp:** [src/scrcmd.c:4710–4714](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4710-L4714), [src/persisted_map_features_init.c:49–56](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L49-L56), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_pastoria_city_gym.s:18–18](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L18-L18).

<a id="cmd-170"></a>

### ScrCmd_PressPastoriaGymButton — 0x170 (368)

**Arguments:** none; identifies button by colliding a one-tile hitbox at the player's X/Z with loaded blue/green/orange button props. **State/effect:** records the selected button immediately and starts its field task. Animates button groups, changes water prop height to the selected level (orange low, green middle, blue high), then changes dynamic terrain height/collision and stops the water effect sound. **Wait:** TRUE; nested task completes after animation and height endpoint. No matching button means no task, still a one-pass yield. No party/bag writes. **NEW SYSTEM:** water and button props plus dynamic terrain, rather than a script-variable toggle.

**Decomp:** [src/scrcmd.c:4716–4722](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4716-L4722), [src/overlay008/gym_features.c:423–466](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay008/gym_features.c#L423-L466), [src/overlay008/gym_features.c:496–649](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay008/gym_features.c#L496-L649).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_pastoria_city_gym.s:22–22](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L22-L22), [res/field/scripts/scripts_pastoria_city_gym.s:29–29](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L29-L29), [res/field/scripts/scripts_pastoria_city_gym.s:36–36](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_gym.s#L36-L36).

<a id="cmd-173"></a>

### ScrCmd_InitPersistedMapFeaturesForCanalaveGym — 0x173 (371)

**Arguments:** none. **State/effect:** selects Canalave Gym's persisted-feature variant and writes every one of 24 platform-position bits from the authored initial-position table. Consumers use those bits to position lifts and determine routes. **Wait:** FALSE. No direct lift ride, screen effect, flag, party or bag write. Reinitialization resets all lifts. **NEW SYSTEM:** platform lifts and dynamic terrain, with position bits persisted in the miscellaneous save block.

**Decomp:** [src/scrcmd.c:4738–4742](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4738-L4742), [src/persisted_map_features_init.c:22–47](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L22-L47), [src/persisted_map_features_init.c:58–68](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L58-L68), [src/persisted_map_features_init.c:149–158](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L149-L158), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP11 [res/field/scripts/scripts_canalave_city_gym.s:12–12](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city_gym.s#L12-L12).

<a id="cmd-175"></a>

### ScrCmd_InitPersistedMapFeaturesForSunyshoreGym — 0x175 (373)

**Arguments:** `roomID:u8` literal. **State/effect:** asserts room below the three-room count, selects Sunyshore persisted-feature storage, writes room ID and initial rotation state (rooms 0/1/2 initially 2/1/0). If the current location Z is that room's entrance Z (14/21/25), overrides rotation to 0. Thus entry side changes the initialization outcome. **Wait:** FALSE; no direct animation. No party/bag write. **NEW SYSTEM:** coupled gears with rotation-dependent walkable geometry.

**Decomp:** [src/scrcmd.c:4750–4757](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4750-L4757), [src/persisted_map_features_init.c:70–102](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L70-L102), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_1.s:14–14](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_1.s#L14-L14); CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_2.s:13–13](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_2.s#L13-L13); CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_3.s:14–14](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L14-L14).

<a id="cmd-176"></a>

### ScrCmd_PressSunyshoreGymButton — 0x176 (374)

**Arguments:** `buttonType:u8` literal, normal/reverse/double. **State/effect:** reads persisted room/rotation, configures room gear count and task state, advances rotation modulo four by +1/−1/+2 and writes both persisted and live rotation state immediately. Starts gear sound and animates each gear around its authored horizontal/vertical axis and direction through 90° or 180°. **Wait:** TRUE; nested task ends at rotation goal. Invalid type asserts. Assumes initialized Sunyshore dynamic state. No bag/party write. **NEW SYSTEM:** gear transforms and the existing Gym collision consumer must agree on the same persisted rotation.

**Decomp:** [src/scrcmd.c:4759–4766](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4759-L4766), [src/overlay008/gym_features.c:2150–2270](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay008/gym_features.c#L2150-L2270).

**Checkpoint uses:** CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_1.s:18–18](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_1.s#L18-L18); CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_2.s:17–17](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_2.s#L17-L17), [res/field/scripts/scripts_sunyshore_city_gym_room_2.s:21–21](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_2.s#L21-L21); CP16 [res/field/scripts/scripts_sunyshore_city_gym_room_3.s:18–18](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L18-L18), [res/field/scripts/scripts_sunyshore_city_gym_room_3.s:22–22](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city_gym_room_3.s#L22-L22).

<a id="cmd-2b6"></a>

### ScrCmd_2B6 — 0x2B6 (694)

**Arguments:** `localID:u16` var-or-value, `enabled:u8` literal. **State/effect:** finds a live local object (asserts if absent) and calls the status-18 setter: byte exactly TRUE clears bit 18; every other byte sets it. The script uses this around object staging; it neither removes the object nor writes hide flags. In the object-collision scan, bit 18 makes that object skip occupancy checks, so false makes it nonblocking and true makes it participate in collision. **Wait:** FALSE. No save/party/bag/sound write. **Small op** once object status behavior exists. **Edge:** values other than byte 1 use the false branch; this is not a generic nonzero boolean.

**Decomp:** [src/scrcmd.c:6511–6524](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6511-L6524), [src/map_object.c:1764–1771](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/map_object.c#L1764-L1771), [src/map_object_move.c:623–660](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/map_object_move.c#L623-L660).

**Checkpoint uses:** CP11 [res/field/scripts/scripts_iron_island_b2f_left_room.s:194–194](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_island_b2f_left_room.s#L194-L194), [res/field/scripts/scripts_iron_island_b2f_left_room.s:436–436](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_island_b2f_left_room.s#L436-L436).

<a id="cmd-18c"></a>

### ScrCmd_18C — 0x18C (396)

**Arguments:** `localID:u16`, `direction:u16`, both var-or-value. **State/effect:** finds live local object (asserts if missing), attempts to change facing through MapObject_TryFace (preserves facing when LOCK_DIR is set), and refreshes graphics state when its update-ready flag permits. This is not a movement path or unconditional orientation overwrite; the TryFace constraints still apply. **Wait:** FALSE. Visible object facing may change; no save/party/bag/sound write. **Small op** over existing object-facing support.

**Decomp:** [src/scrcmd.c:4630–4643](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4630-L4643), [src/overlay005/ov5_021ECC20.c:148–155](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021ECC20.c#L148-L155), [src/map_object.c:1295–1302](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/map_object.c#L1295-L1302).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_spear_pillar.s:189–189](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L189-L189), [res/field/scripts/scripts_spear_pillar.s:217–217](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L217-L217), [res/field/scripts/scripts_spear_pillar.s:225–225](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L225-L225), [res/field/scripts/scripts_spear_pillar.s:233–233](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L233-L233), [res/field/scripts/scripts_spear_pillar.s:245–245](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L245-L245), [res/field/scripts/scripts_spear_pillar.s:252–252](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L252-L252), [res/field/scripts/scripts_spear_pillar.s:259–259](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L259-L259), [res/field/scripts/scripts_spear_pillar.s:314–314](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L314-L314), [res/field/scripts/scripts_spear_pillar.s:315–315](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L315-L315), [res/field/scripts/scripts_spear_pillar.s:319–319](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L319-L319), [res/field/scripts/scripts_spear_pillar.s:320–320](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L320-L320), [res/field/scripts/scripts_spear_pillar.s:324–324](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L324-L324), [res/field/scripts/scripts_spear_pillar.s:325–325](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L325-L325).

## Camera and screen effects — first CP6

<a id="cmd-2cd"></a>

### ScrCmd_2CD — 0x2CD (717)

- **Arguments:** none. **NEW SYSTEM:** field atmosphere/fog effect manager and its deferred readiness task, unless already supplied by another field effects milestone.
- **Behavior/state:** starts a system task at priority 128. On each task update it checks the field effect manager pointer (`fieldSystem->unk_04->unk_0C`). Once available, requests effect **26**, then destroys the system task. The effect switch asserts manager state 6 and index below 31; identical current effect is an immediate no-op, otherwise it releases the old effect, initializes and starts the selected effect, and stores 26 as current. No script/save flag or variable is written; no party, bag, camera or sound change occurs in this handler or the selected fog-only effect.
- **Wait/screen/edges:** the opcode returns the script-yield result once, **without a pause predicate**; it does not wait for manager readiness or visual completion. The separate system task can remain pending until the manager exists. Effect 26 selects a dark blue-grey fog treatment: fog mode parameter 3, value 26095, RGB5 `(2,2,6)`, using the shared fog effect state machine. It can affect field depth/appearance, not just a flat UI overlay. The human-friendly name of effect 26 is **uncertain**; retain its numeric identity rather than inventing a weather name. The second occurrence is explicitly an unused script label, not an additional required event.
- **Use:** CP6 Galactic Eterna building 4F OnLoad: [scripts_team_galactic_eterna_building_4f.s:14–20](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_team_galactic_eterna_building_4f.s#L14-L20).
- **Implementation evidence:** deferred task and handler [src/scrcmd.c:6607–6623](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6607-L6623); effect switching [src/overlay005/ov5_021D5EB8.c:401–422](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021D5EB8.c#L401-L422), index table [730–762](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021D5EB8.c#L730-L762), selected effect [5239–5246](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021D5EB8.c#L5239-L5246), shared lifecycle [4073–4136](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/ov5_021D5EB8.c#L4073-L4136).

<a id="cmd-29f"></a>

### ScrCmd_29F — 0x29F (671)

**Arguments:** `mode:u16` var-or-value. **State/effect:** mode 0 creates the smaller fixed camera oscillation (amplitude 2, configured 16 oscillation cycles); every nonzero value creates the larger/damped variant (amplitude 4, 24 oscillation cycles). The nonzero task fades BGM out, waits for fade, pauses 16 ticks, starts a rumble sound and camera motion with amplitude decaying by one eighth on cycle changes, stops the effect, pauses, fades BGM back to 127 over 16 ticks and waits for fade completion. **Wait:** TRUE; nested camera/audio task, not just one tick. Both variants start the common camera-shake effect sound during setup and restore the original active camera when finished. No saved flag/party/bag writes. **NEW SYSTEM:** task-controlled camera shake and coordinated audio fades. Names remain opaque; exact implementation is oscillation, not arbitrary camera pan.

**Decomp:** [src/scrcmd.c:6374–6385](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6374-L6385), [src/overlay006/ov6_0223E140.c:496–622](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_0223E140.c#L496-L622), [src/overlay006/ov6_0223E140.c:1761–1963](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_0223E140.c#L1761-L1963).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_pastoria_city.s:658–658](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city.s#L658-L658); CP10 [res/field/scripts/scripts_pastoria_city.s:658–658](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city.s#L658-L658); CP11 [res/field/scripts/scripts_canalave_library_3f.s:136–136](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_library_3f.s#L136-L136); CP12 [res/field/scripts/scripts_canalave_library_3f.s:136–136](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_library_3f.s#L136-L136).

<a id="cmd-310"></a>

### ScrCmd_StartLibraryTV — 0x310 (784)

**Arguments:** none. **State/effect:** starts LibraryTV child application with save-data pointer and pauses interpreter until application exits. Application replaces field display with TV presentation and animated scan lines, fades in for 6 ticks, holds 240 ticks, fades out for 6 ticks and frees display resources. Its state named BGM_START does not actually start audio in this implementation. **Wait:** TRUE plus explicit application-exit poll. No A/B completion branch, party/bag or progression write in handler/application main sequence. **NEW SYSTEM:** full-screen TV application/rendering; script surrounds it with its own story writes.

**Decomp:** [src/scrcmd.c:3213–3219](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3213-L3219), [src/unk_0203D1B8.c:1762–1775](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1762-L1775), [src/library_tv/library_tv.c:20–159](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/library_tv/library_tv.c#L20-L159).

**Checkpoint uses:** CP11 [res/field/scripts/scripts_canalave_library_3f.s:147–147](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_library_3f.s#L147-L147); CP12 [res/field/scripts/scripts_canalave_library_3f.s:147–147](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_library_3f.s#L147-L147).

## Distribution event gates — first CP6; optional branches

<a id="cmd-28b"></a>

### ScrCmd_CheckDistributionEvent — 0x28B (651)

- **Arguments:** `eventID: u8 literal`, `dest: u16 destination variable ID`. Event ID is not var-or-value. **Small op:** read a saved system variable and write a Boolean destination; no network or distribution application is needed to evaluate the gate.
- **Behavior/state:** reads `VAR_DISTRIBUTION_EVENT_DARKRAI + eventID`, compares against the event's magic value, and writes exact equality as TRUE/FALSE. IDs Darkrai/Shaymin/Arceus/Rotom correspond to magic values `0x1209/0x1112/0x1123/0x1103`. Does not enable an event or consume its key item; surrounding scripts separately inspect items, completion, dex and caught flags. No party/bag writes, field-object changes, camera, sound or direct screen effect.
- **Wait/edges:** immediate, no pause. Handler asserts event ID against `DISTRIBUTION_EVENT_MAX`; the helper additionally asserts that the ID indexes the four-element magic table. Invalid IDs are programming errors, not a false-result fallback. Unset/incorrect magic yields FALSE.
- **Use:** CP6 optional Secret Key/Rotom wall [scripts_team_galactic_eterna_building_1f.s:91–101](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_team_galactic_eterna_building_1f.s#L91-L101); CP11 map load's postgame Darkrai gate [scripts_canalave_city.s:91–102](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city.s#L91-L102); CP15 Spear Pillar variants' postgame Arceus gate [scripts_spear_pillar.s:35–47](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L35-L47), [scripts_spear_pillar_dialga.s:14–26](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_dialga.s#L14-L26), [scripts_spear_pillar_palkia.s:14–26](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_palkia.s#L14-L26). These occurrences do not make distribution content a required CP6/11/15 story gate. The optional CP15 Azure Flute background-event dispatch also calls this gate in [scripts_common.s:1534–1542](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L1534-L1542). No CP13 attribution follows from unrelated `scripts_common` services.
- **Implementation evidence:** [src/scrcmd.c:6248–6257](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6248-L6257), magic mapping/read [src/system_vars.c:143–164](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/system_vars.c#L143-L164).

## Underground rewards and counters — first CP7; optional follow-up branches

<a id="cmd-083"></a>

### ScrCmd_SendGoodToPC — 0x083 (131)

Arguments (wire order): `goodID: u16 var-or-value`, `unused: u16 var-or-value`, `destVar: u16 destination variable ID`.

**NEW SAVE SUBSYSTEM: Underground PC goods**. Reads good ID, ignored second resolved halfword and destination. Inserts one good in first empty PC goods slot and returns BOOL success; full PC returns false without mutation. Second operand is not quantity. No bag, field object, screen, sound or wait. No duplicate/ownership restriction is checked here.

Behavior source: [src/scrcmd_underground_inventory.c:13–25](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L13-L25) Helpers: [src/underground.c:358–372](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground.c#L358-L372).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_common.s:703–703](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L703-L703).

<a id="cmd-085"></a>

### ScrCmd_CheckHasRoomForGoodsInPC — 0x085 (133)

Arguments (wire order): `unused: u16 var-or-value`, `unused2: u16 var-or-value`, `destVar: u16 destination variable ID`.

Small query once Underground save exists. Reads two resolved halfwords and destination; first is passed to a helper whose parameter is unused, second is ignored. Returns whether any PC goods slot is empty, independent of good ID or quantity. No mutation beyond destination, wait, screen or sound. This gates optional NPC rewards; Explorer Kit story gate itself must not require every Underground reward.

Behavior source: [src/scrcmd_underground_inventory.c:37–49](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L37-L49) Helpers: [src/underground.c:374–384](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground.c#L374-L384).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_eterna_city_underground_man_house.s:296–296](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L296-L296), [res/field/scripts/scripts_eterna_city_underground_man_house.s:319–319](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L319-L319), [res/field/scripts/scripts_eterna_city_underground_man_house.s:339–339](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L339-L339), [res/field/scripts/scripts_eterna_city_underground_man_house.s:359–359](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L359-L359); CP7 [res/field/scripts/scripts_hearthome_city.s:250–250](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L250-L250), [res/field/scripts/scripts_hearthome_city.s:265–265](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L265-L265), [res/field/scripts/scripts_hearthome_city.s:279–279](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L279-L279), [res/field/scripts/scripts_hearthome_city.s:293–293](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L293-L293), [res/field/scripts/scripts_hearthome_city.s:307–307](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L307-L307), [res/field/scripts/scripts_hearthome_city.s:321–321](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L321-L321), [res/field/scripts/scripts_hearthome_city.s:335–335](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L335-L335), [res/field/scripts/scripts_hearthome_city.s:350–350](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L350-L350), [res/field/scripts/scripts_hearthome_city.s:365–365](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L365-L365), [res/field/scripts/scripts_hearthome_city.s:380–380](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L380-L380), [res/field/scripts/scripts_hearthome_city.s:395–395](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L395-L395).

<a id="cmd-087"></a>

### ScrCmd_GiveTrap — 0x087 (135)

Arguments (wire order): `trapID: u16 var-or-value`, `unused: u16 var-or-value`, `destVar: u16 destination variable ID`.

**NEW SAVE SUBSYSTEM: Underground trap inventory**. Resolves trap ID, consumes ignored second halfword and writes destination BOOL. Adds exactly one trap to first free inventory slot; full inventory returns false without mutation. Does not place a trap in the world or count a trap as set; no bag changes, message, sound or wait.

Behavior source: [src/scrcmd_underground_inventory.c:61–73](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L61-L73) Helpers: [src/underground.c:736–750](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground.c#L736-L750).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_common.s:717–717](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L717-L717).

<a id="cmd-08f"></a>

### ScrCmd_GiveSphere — 0x08F (143)

Arguments (wire order): `type: u16 var-or-value`, `size: u16 var-or-value`, `destVar: u16 destination variable ID`.

**NEW SAVE SUBSYSTEM: Underground spheres**. Resolves sphere type and size and writes destination BOOL. Finds first empty sphere slot and stores the type/size pair; full inventory returns false. Not a quantity and not a merge into existing sphere. No bag/item award, screen, sound or wait; internal storage narrows fields to their array element widths.

Behavior source: [src/scrcmd_underground_inventory.c:148–159](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_underground_inventory.c#L148-L159) Helpers: [src/underground.c:601–614](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground.c#L601-L614).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_common.s:730–730](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_common.s#L730-L730).

<a id="cmd-24a"></a>

### ScrCmd_GetCapturedFlagCount — 0x24A (586)

Arguments (wire order): `destFlagCount: u16 destination variable ID`.

Small query over UndergroundRecord save: copies captured-flag counter to destination; leaves counter unchanged. This is the Underground capture-the-flag statistic, not a count of ordinary script flags or Pokémon. No wait/screen/sound. Optional Underground Man reward thresholds use it.

Behavior source: [src/scrcmd.c:5600–5611](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5600-L5611).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_eterna_city_underground_man_house.s:313–313](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L313-L313), [res/field/scripts/scripts_eterna_city_underground_man_house.s:333–333](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L333-L333), [res/field/scripts/scripts_eterna_city_underground_man_house.s:353–353](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_eterna_city_underground_man_house.s#L353-L353).

<a id="cmd-286"></a>

### ScrCmd_GetUndergroundItemsGivenAway — 0x286 (646)

Arguments (wire order): `destVarID: u16 destination variable ID`.

Small save query: copies SystemVars Underground items-given-away counter to destination. No increment/reset, screen, sound or wait. Optional Hearthome reward check; unrelated to bag quantity.

Behavior source: [src/scrcmd.c:6175–6181](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6175-L6181).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_hearthome_city.s:360–360](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L360-L360).

<a id="cmd-287"></a>

### ScrCmd_GetUndergroundFossilsUnearthed — 0x287 (647)

Arguments (wire order): `destVarID: u16 destination variable ID`.

Small save query: copies SystemVars Underground fossils-unearthed counter to destination. No mining action or item grant, reset, screen, sound or wait. Optional Hearthome reward check.

Behavior source: [src/scrcmd.c:6183–6189](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6183-L6189).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_hearthome_city.s:375–375](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L375-L375).

<a id="cmd-288"></a>

### ScrCmd_GetUndergroundTrapsSet — 0x288 (648)

Arguments (wire order): `destVarID: u16 destination variable ID`.

Small save query: copies SystemVars Underground traps-set counter to destination. Does not count currently held traps, place traps or reset the statistic. No wait, screen or sound; optional Hearthome reward check.

Behavior source: [src/scrcmd.c:6191–6197](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6191-L6197).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_hearthome_city.s:390–390](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L390-L390).

<a id="cmd-293"></a>

### ScrCmd_GetUndergroundTalkCounter — 0x293 (659)

Arguments (wire order): `destVarID: u16 destination variable ID`.

Small save query: copies SystemVars Underground talk counter to destination. No increment, screen, sound or wait. Do not substitute Spiritomb counter by name alone; this handler calls the Underground-talk system variable getter. Optional Hearthome reward check.

Behavior source: [src/scrcmd.c:6366–6372](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6366-L6372).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_hearthome_city.s:345–345](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_hearthome_city.s#L345-L345).

## Contest photos and Poffins — first CP7; optional interactions

<a id="cmd-0a8"></a>

### ScrCmd_0A8 — 0x0A8 (168)

- **Arguments:** `slot: u16 literal` (not var-or-value), `result: u16 destination variable ID`. **NEW SYSTEM:** saved contest image clips and the photo viewer application; independent of communication despite generic classification heuristics.
- **Behavior/state:** checks contest-photo data in saved `ImageClips` for the selected slot, creates viewer arguments in `SCRIPT_MANAGER_PARTY_MANAGEMENT_DATA`, and launches overlay 22 in contest-photo mode (mode 1). Writes result **1** if the slot has no photo and **0** when a viewer is launched. Reads the existing clip; it does not take a picture, modify Pokémon or party, award contest results, write save flags, move field objects, or change the field camera. The viewer temporarily changes the DS display arrangement and shows the selected saved contest composition/type frame. Its input is A/B to leave; it fades in and out over six frames per transition. The script separately handles its field fade and restoration.
- **Wait/edges:** missing data yields once without launching or installing a pause callback. Otherwise pauses until the application stops, then frees the argument block and clears the manager pointer. That wait includes viewer input and exit fade, not a fixed animation timer. Bounds are the underlying image-clip slot contract; callers here pass only **0–4**. Do not default an empty slot to a fabricated photo. No sound call is made by the command itself.
- **Use:** CP7 Contest Hall lobby optional five frame interactions, not required Fantina progression: [scripts_contest_hall_lobby.s:177–247](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L177-L247).
- **Implementation evidence:** [src/scrcmd.c:3140–3159](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3140-L3159), clip validation/argument construction [2933–2967](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2933-L2967), wait and cleanup [2859–2874](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2859-L2874), launch [src/unk_0203D1B8.c:895–910](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L895-L910), viewer [src/overlay022/ov22_0225B660.c:60–155](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay022/ov22_0225B660.c#L60-L155).

<a id="cmd-12f"></a>

### ScrCmd_ContestPhotoHasData — 0x12F (303)

Arguments (wire order): `slot: u16 literal`, `destVar: u16 destination variable ID`.

Small query over ImageClips contest photos: reads literal u16 slot and writes BOOL saved-data presence. Returns TRUE, causing a script yield, but registers no completion callback and opens no application. No save mutation, screen or sound. Photo slot validity/integrity is the helper’s contract; absence is false.

Behavior source: [src/scrcmd.c:3178–3192](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3178-L3192) Helpers: [src/scrcmd.c:2933–2948](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L2933-L2948).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_contest_hall_lobby.s:181–181](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L181-L181), [res/field/scripts/scripts_contest_hall_lobby.s:195–195](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L195-L195), [res/field/scripts/scripts_contest_hall_lobby.s:209–209](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L209-L209), [res/field/scripts/scripts_contest_hall_lobby.s:223–223](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L223-L223), [res/field/scripts/scripts_contest_hall_lobby.s:237–237](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L237-L237).

<a id="cmd-289"></a>

### ScrCmd_GivePoffin — 0x289 (649)

Arguments (wire order): `destVar: u16 destination variable ID`, `spiciness: u16 var-or-value`, `dryness: u16 var-or-value`, `sweetness: u16 var-or-value`, `bitterness: u16 var-or-value`, `sourness: u16 var-or-value`, `smoothness: u16 var-or-value`.

**NEW SAVE SUBSYSTEM: Poffin Case and Poffin recipe**. Reads destination first, then five **resolved** u16 flavor values and resolved smoothness; each narrows to u8. Schema lacks vov annotations on these inputs, but the C reader is GetVar. Creates a Poffin, derives type, copies into first empty case slot and returns type; full case returns POFFIN_NONE=65535 with no addition. Zero flavors yields Foul with three randomly chosen distinct flavors set to strength 2; one/two flavors select primary/secondary (ties favor earlier flavor); three=Rich, four/five=Overripe; any flavor≥50 changes result to Mild except the zero-flavor Foul path. Stores five flavors and smoothness. No wait, visible menu or sound; caller handles reward text and full-case branch.

Behavior source: [src/scrcmd.c:6199–6223](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6199-L6223) Helpers: [src/poffin.c:82–170](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/poffin.c#L82-L170), [src/poffin.c:245–269](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/poffin.c#L245-L269), [include/poffin.h:1–8](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/poffin.h#L1-L8).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_contest_hall_lobby.s:331–331](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L331-L331).

<a id="cmd-28a"></a>

### ScrCmd_CheckHasEmptyPoffinCaseSlot — 0x28A (650)

Arguments (wire order): `destVar: u16 destination variable ID`.

Small query once Poffin Case save exists. Writes BOOL whether first-empty-slot search succeeds; full case is false. No addition, screen, sound or wait. This is case capacity, independent of bag room or Poffin type.

Behavior source: [src/scrcmd.c:6225–6237](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6225-L6237) Helpers: [src/poffin.c:245–256](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/poffin.c#L245-L256).

Checkpoint uses (file occurrence; optional interactions remain optional): CP7 [res/field/scripts/scripts_contest_hall_lobby.s:284–284](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L284-L284), [res/field/scripts/scripts_contest_hall_lobby.s:306–306](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_contest_hall_lobby.s#L306-L306).

## Spiritomb event — first CP8; optional interaction

<a id="cmd-214"></a>

### ScrCmd_GetSpiritombCounter — 0x214 (532)

**Arguments:** `destination:u16` variable reference. **State/effect:** reads `VAR_SPIRITOMB_COUNTER` from saved VarsFlags into destination. This is the Underground encounter counter, not party count or a battle result; the script decides thresholds and dialogue branches. **Wait:** FALSE. No screen/sound or other state write. **Small op** if that saved variable exists; incrementing it during Underground play is a separate system.

**Decomp:** [src/scrcmd.c:5357–5363](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5357-L5363), [src/system_vars.c:274–282](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/system_vars.c#L274-L282), [src/underground/player.c:226–240](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/underground/player.c#L226-L240).

**Checkpoint uses:** CP8 [res/field/scripts/scripts_route_209.s:64–64](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_209.s#L64-L64).

<a id="cmd-26f"></a>

### ScrCmd_ClearSpiritombCounter — 0x26F (623)

**Arguments:** none. **State/effect:** writes zero to saved `VAR_SPIRITOMB_COUNTER`; it does not remove the Hallowed Tower object, consume an item or start a battle. Those are script/other-command responsibilities. **Wait:** FALSE. No direct screen/sound/party/bag effect. **Small op** using ordinary persistent VarsFlags; separate Underground interactions supply counter increments.

**Decomp:** [src/scrcmd.c:5932–5936](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5932-L5936), [src/system_vars.c:274–282](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/system_vars.c#L274-L282).

**Checkpoint uses:** CP8 [res/field/scripts/scripts_route_209.s:82–82](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_209.s#L82-L82).

## Messages and input variants — first CP8

<a id="cmd-26d"></a>

### ScrCmd_MessageUnown — 0x26D (621)

- **Arguments:** `messageID: u16 literal` into the current script's message loader; not var-or-value. **Small op** if the text renderer supports the Unown font; otherwise **NEW renderer/font capability**, not a new gameplay system.
- **Behavior/state:** builds ordinary message options from saved text speed, selects `FONT_UNOWN`, opens/clears the field message window if necessary, loads and expands the selected message through current string-template state, and prints with delay skipping disabled and auto-scroll false. Writes transient message/printer/window state. No saved flag/var, party, bag, camera, sound or object writes.
- **Wait/screen/edges:** pauses until the printer finishes, then script proceeds; it does not itself wait for a post-message confirmation or close the window. The caller supplies `WaitButton` and `CloseMessage`. Message ID is a full halfword unlike `MessageInstant`'s byte. Uses the special glyph font; displaying ordinary text with the same contents is incomplete behavior.
- **Use:** CP8 optional Solaceon Ruins room 7 inscription [scripts_solaceon_ruins_room_7.s:8–15](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_solaceon_ruins_room_7.s#L8-L15).
- **Implementation evidence:** [src/scrcmd.c:1289–1301](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1289-L1301); options and message dispatch [src/overlay005/script_message.c:36–65](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/script_message.c#L36-L65), message opening/formatting [127–142](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/script_message.c#L127-L142).

<a id="cmd-02b"></a>

### ScrCmd_MessageInstant — 0x02B (43)

- **Arguments:** `messageID: u8 literal` into the current loader; not var-or-value. **Small op** over message window/template support.
- **Behavior/state:** uses current message loader and string-template buffers, opens the message window if closed, clears it, formats the requested message and creates an instant-speed message-font printer. Stores its transient printer ID. Does not change persistent flags, vars, party, bag, camera, objects or sound. The library explosion's subsequent effect belongs to `ScrCmd_29F`, not to this opcode.
- **Wait/screen/edges:** immediate, no pause or input wait; displays the formatted text at once, including replacing text in an already-open window. Does not close the box. The operand is one byte, not the halfword accepted by `MessageUnown`.
- **Use:** CP11 library explosion, also included at the CP11→12 boundary in the story map: [scripts_canalave_library_3f.s:127–138](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_library_3f.s#L127-L138). Shared services elsewhere do not establish a CP13 requirement.
- **Implementation evidence:** [src/scrcmd.c:1188–1194](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1188-L1194); helper [src/overlay005/script_message.c:67–76](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/script_message.c#L67-L76), open/format [127–142](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/script_message.c#L127-L142), printer [165–168](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay005/script_message.c#L165-L168).

<a id="cmd-032"></a>

### ScrCmd_WaitABPadPress — 0x032 (50)

- **Arguments:** none. **Small op** over the existing input suspension mechanism.
- **Behavior/state:** installs a pause predicate that reads newly pressed keys and succeeds for A, B or any D-pad direction. Does not turn the player, open the start menu, close text, or play a confirmation sound; it only gates continuation. No saved or transient gameplay values are written except the script's pause state.
- **Wait/screen/edges:** waits indefinitely for the qualifying new press, not merely a held key, and not X or touch. No direct screen effect; callers typically leave their existing message visible until the following `CloseMessage`. Keep distinct from `WaitButton`, whose directional input may turn the player and whose X path opens a menu.
- **Use:** CP15 Distortion World conversations at [scripts_distortion_world_1f.s:80–87](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L80-L87), [scripts_distortion_world_b7f.s:41–48](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b7f.s#L41-L48), and [scripts_distortion_world_giratina_room.s:147–163](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L147-L163).
- **Implementation evidence:** [src/scrcmd.c:1447–1460](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1447-L1460), contrasting input handler [1421–1445](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L1421-L1445).

## Great Marsh, tram and lookout — first CP9; optional system

<a id="cmd-202"></a>

### ScrCmd_StartEndSafariGame — 0x202 (514)

Arguments (wire order): `activeState: u8 literal`.

**NEW SYSTEM: Safari session state, counters and TV reporting**. Literal u8 mode 0 starts: sets Safari-active system flag, resets current TV Safari data, sets Safari Balls=30 and step count=0. Mode 1 ends: clears active flag, saves Safari TV segment only if catches>0 (last tracked species/gender/language/game and count), creates Safari journal location event, zeroes balls and steps. Other mode values leave state unchanged. No wait or automatic warp/message/sound; caller moves player and handles fee. End can be called without an active-session guard. Great Marsh is optional for CP9 bomb progression.

Behavior source: [src/scrcmd.c:5277–5306](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5277-L5306) Helpers: [include/constants/scrcmd.h:25–26](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/include/constants/scrcmd.h#L25-L26), [src/journal.c:210–234](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/journal.c#L210-L234), [src/tv_segment.c:1002–1021](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/tv_segment.c#L1002-L1021).

Checkpoint uses (file occurrence; optional interactions remain optional): CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:68–68](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L68-L68), [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:154–154](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L154-L154); CP9 [res/field/scripts/scripts_safari_game.s:48–48](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L48-L48), [res/field/scripts/scripts_safari_game.s:55–55](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L55-L55), [res/field/scripts/scripts_safari_game.s:71–71](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L71-L71), [res/field/scripts/scripts_safari_game.s:87–87](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L87-L87), [res/field/scripts/scripts_safari_game.s:103–103](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L103-L103).

<a id="cmd-31b"></a>

### ScrCmd_GetCurrentSafariGameCaughtNum — 0x31B (795)

Arguments (wire order): `destVar: u16 destination variable ID`.

Small read once Safari/TV state exists: copies current Safari TV tracking struct’s numPokemonCaught to destination. Counts this game, not lifetime catches or currently occupied party slots. No reset, message/sound, wait or other mutation. Used on exit/report branches.

Behavior source: [src/scrcmd_tv_broadcast.c:469–480](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L469-L480).

Checkpoint uses (file occurrence; optional interactions remain optional): CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:155–155](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L155-L155), [res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s:204–204](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_1f.s#L204-L204).

<a id="cmd-206"></a>

### ScrCmd_StartGreatMarshLookout — 0x206 (518)

**Arguments:** none. **State/effect:** allocates a lookout task, saves the return-location data and marks map changes temporary. Cycles through binocular-selected Great Marsh locations, hides Pokétch and player, creates/displays the selected species sprite, plays shutter sounds and binocular wipes; each view lasts at least its task setup and then 60 ticks or a new A press. Returns to saved origin, restores player/Pokétch and clears temporary-map flag. **Wait:** TRUE; nested task spans all views, sprite teardown and restoration. Payment is outside this opcode. No catches or party/bag writes. **NEW SYSTEM:** temporary remote-map visits, lookout species sprites and binocular transitions.

**Decomp:** [src/scrcmd.c:5308–5312](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5308-L5312), [src/great_marsh_lookout.c:39–136](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/great_marsh_lookout.c#L39-L136).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s:31–31](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pastoria_city_observatory_gate_2f.s#L31-L31).

<a id="cmd-20e"></a>

### ScrCmd_InitGreatMarshTram — 0x20E (526)

**Arguments:** none. **State/effect:** reads current persisted dynamic-feature ID. If already Great Marsh it preserves current tram location; otherwise selects Great Marsh storage and initializes tram at Areas 5/6. Dynamic-map loading later creates the train prop at that saved stop. **Wait:** FALSE. No direct movement or sound; no party/bag/flag write. **NEW SYSTEM:** tram persisted state/prop. Unlike the Gym initializers this deliberately preserves an existing instance.

**Decomp:** [src/scrcmd.c:5323–5327](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5323-L5327), [src/persisted_map_features_init.c:165–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L165-L175), [src/overlay006/great_marsh_tram.c:89–113](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/great_marsh_tram.c#L89-L113), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_safari_game.s:33–33](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L33-L33).

<a id="cmd-20f"></a>

### ScrCmd_MoveGreatMarshTram — 0x20F (527)

**Arguments:** `locationVar:u16` **variable reference read through a pointer** (no assignment), `movementType:u16` literal. **State/effect:** loads sound subscene 65, reads saved tram stop, chooses destination/direction/slowing point and immediately writes destination stop. CALL moves the tram to player; other movement types select the ride task. Loads looping train prop animation; ride waits for departure sound, carries player via forced directional movement/speed changes, and moves train prop to endpoint before unloading animation. **Wait:** TRUE; nested task spans sound, movement and cleanup. Same-stop/out-of-range destination is not validated as a benign no-op: branch defaults can choose another stop. **NEW SYSTEM:** train prop, player transport and saved stop. No bag/party writes.

**Decomp:** [src/scrcmd.c:5329–5338](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5329-L5338), [src/overlay006/great_marsh_tram.c:115–244](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/great_marsh_tram.c#L115-L244), [src/overlay006/great_marsh_tram.c:245–329](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/great_marsh_tram.c#L245-L329).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_safari_game.s:286–286](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L286-L286), [res/field/scripts/scripts_safari_game.s:290–290](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L290-L290).

<a id="cmd-210"></a>

### ScrCmd_CheckGreatMarshTramLocation — 0x210 (528)

**Arguments:** `location:u16` literal, `destination:u16` variable reference. **State/effect:** compares saved Great Marsh tram stop with the literal and writes 5 (AT_LOCATION) or 6 (NOT_AT_LOCATION). Does not locate a live train by coordinates or start it moving. **Wait:** FALSE. No screen/sound or bag/party writes. **Small op** on the tram system; it reports the persisted destination even if queried during travel because MoveGreatMarshTram commits that destination before motion.

**Decomp:** [src/scrcmd.c:5340–5347](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5340-L5347), [src/overlay006/great_marsh_tram.c:181–192](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/great_marsh_tram.c#L181-L192).

**Checkpoint uses:** CP9 [res/field/scripts/scripts_safari_game.s:124–124](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L124-L124), [res/field/scripts/scripts_safari_game.s:153–153](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L153-L153), [res/field/scripts/scripts_safari_game.s:182–182](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L182-L182), [res/field/scripts/scripts_safari_game.s:211–211](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L211-L211), [res/field/scripts/scripts_safari_game.s:240–240](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L240-L240), [res/field/scripts/scripts_safari_game.s:269–269](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_safari_game.s#L269-L269).

## TV interview gate — first CP9; incidental map-entry branch

<a id="cmd-238"></a>

### ScrCmd_CheckTVInterviewEligible — 0x238 (568)

- **Arguments:** `interviewSegmentID: u16 var-or-value`, `dest: u16 destination variable ID`. **NEW SYSTEM:** persisted TV interview slot lifecycle; the caller's reporter visibility can use a small read-only slice of that system. Returning a hardcoded false is not the decomp behavior.
- **Behavior/state:** reads the TV broadcast save block's four local interview slots, through `sub_0202E6B0(broadcast, 1, segmentID)`. Eligibility is FALSE if any matching segment is still unplayed (`timesPlayed == 0`). Otherwise, if matching played segments exist, eligibility is TRUE only if at least one has played three times. If no matching segment exists at all, it requires at least one empty slot (`segmentID == 0`) or a slot played at least three times. After that capacity/repeat check succeeds, the handler dispatches the selected segment's additional eligibility callback, or returns TRUE when none exists. The four Route 214 question segments **15–18** have no extra callback, so only the slot/repeat rules apply there.
- **Other valid segment callbacks:** Battle Tower, contest showcase, Poffin, Amity Square and Frontier single/multi segments read their respective saved TV staging data's `unk_00` availability field; the Pokétch segment requires the Pokétch to be enabled; photo-corner requires Dress-Up photo slot 0 to contain data. Remaining table entries with no callback need only the same slot/repeat check. The availability byte fields' detailed staging semantics remain **uncertain** here and are not needed by Route 214 IDs 15–18. This opcode writes only the destination Boolean; it does not record an interview, mutate times-played counts, award trainer score, consume party/bag data, change save flags, move objects/camera, or play audio.
- **Wait/screen/edges:** immediate, no pause and no direct screen effect. The calling transition script uses results to hide/show a reporter; those flag changes are separate commands. Segment IDs must be valid one-based entries in the interview table; this handler does not bounds-check before indexing. Do not silently treat arbitrary IDs as FALSE.
- **Use:** CP9 transit through the Veilstone south gate to Route 214, automatic OnTransition; four checks gate reporter visibility. This is incidental TV state on a story transit map, not a required interview: [scripts_route_214_gate_to_veilstone_city.s:9–24](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_route_214_gate_to_veilstone_city.s#L9-L24).
- **Implementation evidence:** opcode [src/scrcmd_tv_broadcast.c:176–186](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L176-L186), dispatch [230–246](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L230-L246), extra callbacks [298–350](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L298-L350), callback table [352–467](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_tv_broadcast.c#L352-L467); local-slot matching [src/unk_0202E2CC.c:278–298](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0202E2CC.c#L278-L298), four-slot selection and eligibility [320–389](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0202E2CC.c#L320-L389).

## Boat travel — first CP11

<a id="cmd-23d"></a>

### ScrCmd_PlayBoatCutscene — 0x23D (573)

**Arguments:** `travelDir:u8`, `exitDir:u8`, `mapHeaderID:u16`, `x:u16`, `z:u16`, all literals. **State/effect:** loads boat sound subscene 64. Selected outward directions find the nearby ship prop, detach camera onto a moving target and animate departure; Canalave also animates bridge halves and waits for them. Fades both screens/BGM, tears down map, runs the directional boat-travel application, changes to destination with no warp ID and supplied facing, starts destination BGM and restores field/fade. **Wait:** TRUE; nested tasks span boat/bridge, fades, application and map rebuild. Missing required boat asserts; no party/bag writes. **NEW SYSTEM:** boat travel cutscene/application plus map transition and bridge props. This opcode alone does not enforce story access gates.

**Decomp:** [src/scrcmd.c:5553–5563](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5553-L5563), [src/cutscenes/boat_cutscene/boat_cutscene.c:74–269](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/cutscenes/boat_cutscene/boat_cutscene.c#L74-L269).

**Checkpoint uses:** CP11 [res/field/scripts/scripts_canalave_city.s:528–528](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city.s#L528-L528), [res/field/scripts/scripts_canalave_city.s:537–537](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city.s#L537-L537), [res/field/scripts/scripts_canalave_city.s:546–546](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_canalave_city.s#L546-L546); CP11 [res/field/scripts/scripts_iron_island.s:33–33](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_iron_island.s#L33-L33).

## Galactic HQ containment — first CP14

<a id="cmd-25e"></a>

### ScrCmd_InitLakeGuardianContainmentUnits — 0x25E (606)

**Arguments:** none. **State/effect:** reads saved freed-Galactic-HQ-Pokémon system flag. Before release, configures containment-unit animation 1 for one loop and pauses it; after release, pauses animation 0 and places animation 1 on its final frame paused. This establishes prop state on load; does not set the release flag or spawn/delete guardians. **Wait:** FALSE. Requires both prop animations to exist. **NEW SYSTEM:** containment prop animation channels; bag/party unchanged.

**Decomp:** [src/scrcmd.c:5722–5726](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5722-L5726), [src/overlay006/lake_guardian_containment_units.c:16–31](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/lake_guardian_containment_units.c#L16-L31).

**Checkpoint uses:** CP14 [res/field/scripts/scripts_galactic_hq_control_room.s:32–32](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_galactic_hq_control_room.s#L32-L32); CP15 [res/field/scripts/scripts_galactic_hq_control_room.s:32–32](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_galactic_hq_control_room.s#L32-L32).

<a id="cmd-25f"></a>

### ScrCmd_DeactivateLakeGuardianContainmentUnits — 0x25F (607)

**Arguments:** none. **State/effect:** starts containment field task. Waits until animation 0 is on its last frame, pauses it, unpauses animation 1, then waits for its configured loop to finish. No flag is set here: caller scripts own release progression and guardian movement/removal. **Wait:** TRUE and real nested task until final animation loop; calling without correctly initialized live animations is unsupported. **NEW SYSTEM:** sequenced prop animation. Visible containment shutdown; no party/bag write.

**Decomp:** [src/scrcmd.c:5728–5732](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5728-L5732), [src/overlay006/lake_guardian_containment_units.c:33–69](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/lake_guardian_containment_units.c#L33-L69).

**Checkpoint uses:** CP14 [res/field/scripts/scripts_galactic_hq_control_room.s:191–191](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_galactic_hq_control_room.s#L191-L191); CP15 [res/field/scripts/scripts_galactic_hq_control_room.s:191–191](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_galactic_hq_control_room.s#L191-L191).

## Sound scene resources — first new stub CP15

The ordinary BGM, SE, cry, fanfare and their waits are already classified implemented at this baseline; they are dependencies of these scenes, not remaining stub specs. The qualifying sound-resource command below is easy to miss because its classification bucket is `field`. Its scene/bank load is distinct from playing a track. [Current audio handlers](../../packages/vm/src/audio-ops.ts); [classification](../../packages/vm/src/data/op-classification.json).

<a id="cmd-05d"></a>

### ScrCmd_SetSubScene63 — 0x05D (93)

**Arguments:** none. **State/effect:** requests sound subscene 63 with no BGM sequence. The sound system skips reloading if that subscene is already current; otherwise updates scene and loads its associated sound data. It does not start a music track by passing SEQ_NONE. **Wait:** TRUE is a one-interpreter-pass yield; no completion poll. No direct screen or gameplay/save/party/bag write. **Small op** on sound scene/bank support (a scene-63 resource dependency for Spear Pillar).

**Decomp:** [src/scrcmd_sound.c:202–206](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L202-L206), [src/scrcmd_sound.c:202–206](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_sound.c#L202-L206), [src/sound.c:247–313](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/sound.c#L247-L313).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_spear_pillar.s:378–378](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L378-L378).

## Spear Pillar cinematic systems — first CP15

<a id="cmd-20d"></a>

### ScrCmd_20D — 0x20D (525)

**Arguments:** `selector:u8` literal, `destination:u16` variable reference. **State/effect:** selector dispatch with **one static global live-effect handle**. 0 starts the pillar/red-chain visual sequence; 1 returns 1 and destroys it only at terminal state 11, otherwise 0. 2 starts an effect anchored to live local 0's X/Z (asserts if absent); 3 destroys it. 4 starts the guardian cinematic, with animated Uxie/Mesprit/Azelf models, cries, sound effects and master-brightness changes; 5 forces its state to 3; 6 returns 1 and destroys it only at state 6, otherwise 0. 7/8/9 start one of three fixed camera/framing plus paired-effect configurations; 8/9 also replace area lighting with set 3. All nonpoll branches write 0. **Wait:** handler always TRUE, only one-pass yield; selectors 1/6 implement explicit script polling, not implicit task completion. No progression flags, party or bag writes. **NEW SYSTEM:** Spear Pillar visual actors/effect controllers and camera/lighting profiles. **Edge/uncertain:** invalid selector asserts; caller must respect handle lifecycle; unnamed effect internals are only mechanically identified here, so detailed artistic appearance is not established from symbol names.

**Decomp:** [src/scrcmd.c:5314–5321](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5314-L5321), [src/overlay006/ov6_02243004.c:14–65](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_02243004.c#L14-L65), [src/overlay006/ov6_0223E140.c:638–1035](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_0223E140.c#L638-L1035), [src/overlay006/ov6_0223E140.c:1037–1704](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/ov6_0223E140.c#L1037-L1704).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_spear_pillar.s:373–373](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L373-L373), [res/field/scripts/scripts_spear_pillar.s:383–383](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L383-L383); CP15 [res/field/scripts/scripts_spear_pillar_distorted.s:36–36](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_distorted.s#L36-L36), [res/field/scripts/scripts_spear_pillar_distorted.s:39–39](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_distorted.s#L39-L39).

<a id="cmd-2fb"></a>

### ScrCmd_2FB — 0x2FB (763)

**Arguments:** none. **State/effect:** constructs overlay100 cinematic arguments from saved options, trainer info and trainer gender. A field task fades brightness out, waits for fade, runs overlay100, waits for child application exit, restarts field map and frees arguments. Overlay100 runs three cinematic phases with its own 3D/sprite/message presentation, permits two simultaneous Pokémon cries and restores that sound mode when exiting. No party, bag or explicit progression write in launcher. **Wait:** TRUE; nested task/application lifecycle owns actual completion. **NEW SYSTEM:** complete Spear Pillar cinematic application, including options-aware message frame and player-gender presentation. **Uncertain:** exact timing/visual choreography of all three opaque overlay100 phases is outside this command's launcher; do not replace it with a single fade.

**Decomp:** [src/scrcmd.c:6878–6882](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6878-L6882), [src/unk_020985E4.c:23–86](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020985E4.c#L23-L86), [src/overlay100/ov100_021D0D80.c:47–170](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay100/ov100_021D0D80.c#L47-L170).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_spear_pillar.s:385–385](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar.s#L385-L385).

## Distortion World objects, camera, traversal and party form — first CP15

These ops are the script surface of a larger traversal system: gravity/orientation, rotating collision, camera frames, elevators, guardian/boulder events and map-object lifecycle must cooperate. Implementing only their synchronous state writes cannot make CP15 traversable. See [the companion Distortion World study](distortion-world.md) for event and movement-action dependencies outside ScrCmd handlers.

<a id="cmd-2f2"></a>

### ScrCmd_InitPersistedMapFeaturesForDistortionWorld — 0x2F2 (754)

**Arguments:** none. **State/effect:** selects Distortion World's variant of miscellaneous saved persisted-map-feature storage and zeros its entire DistWorldPersistedData structure, including camera angles and other persisted dynamic-world state. The dedicated overlay later consumes the state. **Wait:** FALSE. No immediate visual, audio or party/bag effect. Reinitialization is destructive to that puzzle feature's progress; scripts control when it is appropriate. **NEW SYSTEM:** Distortion World dynamic-world save state and traversal.

**Decomp:** [src/scrcmd.c:4780–4784](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4780-L4784), [src/persisted_map_features_init.c:139–147](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features_init.c#L139-L147), [src/persisted_map_features.c:11–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/persisted_map_features.c#L11-L23).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_distortion_world_1f.s:12–12](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L12-L12); CP15 [res/field/scripts/scripts_distortion_world_b1f.s:10–10](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L10-L10); CP15 [res/field/scripts/scripts_distortion_world_b2f.s:10–10](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b2f.s#L10-L10); CP15 [res/field/scripts/scripts_distortion_world_b3f.s:9–9](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b3f.s#L9-L9); CP15 [res/field/scripts/scripts_distortion_world_b4f.s:9–9](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b4f.s#L9-L9); CP15 [res/field/scripts/scripts_distortion_world_b5f.s:9–9](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b5f.s#L9-L9); CP15 [res/field/scripts/scripts_distortion_world_b6f.s:15–15](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b6f.s#L15-L15); CP15 [res/field/scripts/scripts_distortion_world_b7f.s:13–13](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b7f.s#L13-L13); CP15 [res/field/scripts/scripts_distortion_world_giratina_room.s:16–16](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L16-L16).

<a id="cmd-311"></a>

### ScrCmd_AddDistortionWorldMapObject — 0x311 (785)

**Arguments:** `localID:u16` var-or-value. **State/effect:** uses current map header and dedicated Distortion event tables to create/register the object in a free DW manager slot. Sets persistence, disables normal height calculation and sets status13 (the forced-draw exception for status12); applies authored orientation/rotator and event coordinates when newly created. B6F pit-text local IDs additionally set status 18 via the false setter. Registers object with DW management rather than ordinary AddObject alone. **Wait:** FALSE; visible object can appear immediately, no movement task. Event conditions/hidden flags can prevent creation; an already managed matching object is not duplicated. Invalid map/local table match or exhausted manager assumptions assert. No explicit story flag/party/bag write. **NEW SYSTEM:** DW object templates, orientation and managed floor/object lifecycle.

**Decomp:** [src/scrcmd.c:6995–7002](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6995-L7002), [src/overlay009/ov9_02249960.c:7210–7278](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L7210-L7278), [src/overlay009/ov9_02249960.c:7315–7359](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L7315-L7359).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_distortion_world_1f.s:44–44](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L44-L44); CP15 [res/field/scripts/scripts_distortion_world_b1f.s:34–34](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L34-L34); CP15 [res/field/scripts/scripts_distortion_world_b3f.s:14–14](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b3f.s#L14-L14); CP15 [res/field/scripts/scripts_distortion_world_giratina_room.s:78–78](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L78-L78), [res/field/scripts/scripts_distortion_world_giratina_room.s:79–79](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L79-L79), [res/field/scripts/scripts_distortion_world_giratina_room.s:88–88](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L88-L88), [res/field/scripts/scripts_distortion_world_giratina_room.s:89–89](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L89-L89), [res/field/scripts/scripts_distortion_world_giratina_room.s:101–101](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L101-L101), [res/field/scripts/scripts_distortion_world_giratina_room.s:102–102](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L102-L102).

<a id="cmd-312"></a>

### ScrCmd_DeleteDistortionWorldMapObject — 0x312 (786)

**Arguments:** `localID:u16` var-or-value. **State/effect:** scans active live map objects for matching local ID **and current map header**, then deletes through DW object management, releasing its managed references/orientation support. Missing object asserts. Does not set an object hide flag; persistent story availability remains caller-owned. **Wait:** FALSE; object disappears immediately, no animation/sound. No party/bag write. **NEW SYSTEM:** DW manager deletion, paired with AddDistortionWorldMapObject.

**Decomp:** [src/scrcmd.c:7004–7011](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7004-L7011), [src/overlay009/ov9_02249960.c:7361–7379](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L7361-L7379).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_distortion_world_1f.s:76–76](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L76-L76); CP15 [res/field/scripts/scripts_distortion_world_b1f.s:23–23](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L23-L23), [res/field/scripts/scripts_distortion_world_b1f.s:38–38](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b1f.s#L38-L38); CP15 [res/field/scripts/scripts_distortion_world_b3f.s:31–31](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b3f.s#L31-L31); CP15 [res/field/scripts/scripts_distortion_world_b6f.s:51–51](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b6f.s#L51-L51), [res/field/scripts/scripts_distortion_world_b6f.s:63–63](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b6f.s#L63-L63), [res/field/scripts/scripts_distortion_world_b6f.s:75–75](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b6f.s#L75-L75); CP15 [res/field/scripts/scripts_distortion_world_b7f.s:73–73](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b7f.s#L73-L73); CP15 [res/field/scripts/scripts_distortion_world_giratina_room.s:124–124](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L124-L124).

<a id="cmd-317"></a>

### ScrCmd_GetPlayer3DPos — 0x317 (791)

**Arguments:** three `u16` destination variable references in X,Y,Z order. **State/effect:** reads live player object X and Z directly and writes logical Y divided by two (integer division), then stores all three. These are not world fx32 render coordinates; retain DW's height-unit conversion. No movement, orientation or camera change. **Wait:** FALSE. Only destination variables written; no screen/sound/party/bag effect. **Small op** once player 3D logical position exists; missing Y in current contracts would require a contract extension.

**Decomp:** [src/scrcmd.c:4786–4801](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4786-L4801), [src/scrcmd.c:4786–4802](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L4786-L4802).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_distortion_world_b2f.s:17–17](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b2f.s#L17-L17), [res/field/scripts/scripts_distortion_world_b2f.s:41–41](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_b2f.s#L41-L41).

<a id="cmd-31f"></a>

### ScrCmd_ResetDistortionWorldPersistedCameraAngles — 0x31F (799)

**Arguments:** none. **State/effect:** obtains Distortion persisted feature buffer and writes cameraAngleX/Y/Z to zero. Does not reset the entire DW puzzle, relocate player or directly call Camera_SetAngle. The dedicated camera system consumes these saved offsets. **Wait:** FALSE. No immediate animation/sound or party/bag effect. **Small op** on the **NEW SYSTEM** DW persisted camera state; requires initialized correct feature variant.

**Decomp:** [src/scrcmd.c:7013–7019](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7013-L7019), [src/overlay009/ov9_02249960.c:2056–2066](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L2056-L2066).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_distortion_world_giratina_room.s:24–24](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_giratina_room.s#L24-L24).

<a id="cmd-320"></a>

### ScrCmd_DoDWWarp — 0x320 (800)

**Arguments:** none. **State/effect:** starts the DWWarp child application with save-data pointer and explicitly pauses until application exit. It runs its own 3D model/animation and moving camera, fades in over 16 ticks, runs a timed phase until frame count exceeds 85, plays warp sound when its counter reaches 15, then fades out over 20 ticks and tears down resources. **Wait:** TRUE plus explicit application-exit callback. No map-header or player-coordinate assignment here: surrounding script performs actual Warp. No party/bag write. **NEW SYSTEM:** standalone warp cinematic/application, not a normal map transition.

**Decomp:** [src/scrcmd.c:7050–7056](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7050-L7056), [src/unk_0203D1B8.c:1777–1787](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_0203D1B8.c#L1777-L1787), [src/dw_warp/dw_warp.c:60–179](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/dw_warp/dw_warp.c#L60-L179).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_spear_pillar_distorted.s:69–69](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_distorted.s#L69-L69).

<a id="cmd-321"></a>

### ScrCmd_StartDistortionWorldGiratinaShadowEvent — 0x321 (801)

Arguments (wire order): `eventIndex: u16 var-or-value`.

**NEW SYSTEM: Distortion dynamic-prop renderer/effect lifecycle**. Resolves event index, asserts within external-template count (only index 0 here), initializes Giratina shadow prop renderer and effect animation. External template starts at tile (6,297,42), rotated by preset 3, full scale, moves +48 fixed world units per animation step for 64 steps and plays Giratina cry at animation start. No wait; effect updates concurrently, marks finished and stops drawing at endpoint. Does not move player/camera, award Pokémon or write story flags. Requires initialized Distortion dynamic-map-features state; repeated starts without finish are not a safe general-purpose queue.

Behavior source: [src/scrcmd.c:7058–7065](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7058-L7065) Helpers: [src/overlay009/ov9_02249960.c:6685–6752](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6685-L6752), [src/overlay009/ov9_02249960.c:6810–6905](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6810-L6905).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_distortion_world_1f.s:60–60](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L60-L60).

<a id="cmd-322"></a>

### ScrCmd_FinishDistortionWorldGiratinaShadowEvent — 0x322 (802)

Arguments (wire order): none.

Small cleanup op once Distortion prop subsystem exists. Finishes any live shadow animation manager and frees shadow renderer/resources. **Does not wait for natural completion**; caller supplies timing. No save/party/flag writes, camera movement or explicit sound stop in handler/helper. Requires Distortion map state; animation-manager null is guarded inside helper.

Behavior source: [src/scrcmd.c:7067–7073](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7067-L7073) Helpers: [src/overlay009/ov9_02249960.c:6706–6710](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6706-L6710), [src/overlay009/ov9_02249960.c:6768–6777](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay009/ov9_02249960.c#L6768-L6777).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_distortion_world_1f.s:65–65](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L65-L65).

<a id="cmd-328"></a>

### ScrCmd_SetPartyGiratinaForm — 0x328 (808)

Arguments (wire order): `form: u16 var-or-value`.

Small party mutation requiring form/ability/stat support. Resolves form; any nonzero value forces Origin for all party Giratina; zero derives form from held item (Griseous Orb keeps Origin, otherwise Altered), so zero is **not** unconditional Altered. Recalculates ability and stats; then for each non-egg party Giratina records dex capture/form data. Underlying Party_SetGiratinaForm loop itself does not skip eggs. Non-Giratina slots are unchanged. No wait, screen or sound; used on Distortion entry/exit.

Behavior source: [src/scrcmd.c:7092–7111](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L7092-L7111) Helpers: [src/pokemon.c:4380–4433](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/pokemon.c#L4380-L4433).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_distortion_world_1f.s:30–30](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_distortion_world_1f.s#L30-L30); CP15 [res/field/scripts/scripts_sendoff_spring.s:21–21](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sendoff_spring.s#L21-L21); CP15 [res/field/scripts/scripts_spear_pillar_distorted.s:71–71](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_spear_pillar_distorted.s#L71-L71).

<a id="cmd-2b5"></a>

### ScrCmd_2B5 — 0x2B5 (693)

**Arguments:** `mapHeaderID:u16`, `x:u16`, `z:u16`, all var-or-value. **State/effect:** writes saved FieldOverworldState exit location: supplied map/X/Z, WARP_ID_NONE and south facing. It does not warp player now; Dig/Escape Rope and other later exit consumers use the saved location. **Wait:** FALSE. No direct screen/sound/party/bag/flag effect. **Small op** over saved exit-location support.

**Decomp:** [src/scrcmd.c:6494–6509](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6494-L6509), [src/scrcmd.c:6494–6509](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6494-L6509).

**Checkpoint uses:** CP15 [res/field/scripts/scripts_sendoff_spring.s:22–22](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sendoff_spring.s#L22-L22).

## Lake guardian preview and roamer — first CP15; optional encounters

<a id="cmd-208"></a>

### ScrCmd_DrawPokemonPreview — 0x208 (520)

Arguments (wire order): `species: u16 var-or-value`, `gender: u16 var-or-value`.

**NEW UI CAPABILITY: script Pokémon portrait**, plus seen-dex write. Resolves species and gender (gender narrows in drawing helper), loads framed portrait on main BG3 at tile position 10,5, stores preview control pointer in SCRIPT_MANAGER_DATA_PTR and calls FieldSystem_WriteSpeciesSeen. No wait, battle, party addition or cry in handler. Caller must later remove it and avoid reusing the shared pointer while live; optional Mesprit scene is a seen encounter, not a capture.

Behavior source: [src/scrcmd.c:3000–3011](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3000-L3011) Helpers: [src/render_window.c:736–771](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/render_window.c#L736-L771).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_verity_cavern.s:18–18](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_verity_cavern.s#L18-L18).

<a id="cmd-209"></a>

### ScrCmd_RemovePokemonPreview — 0x209 (521)

Arguments (wire order): none.

Small lifecycle op for live preview. Writes PREVIEW_STATE_REMOVE into the first byte of script data-pointer’s preview control state and returns TRUE (one yield). The renderer task performs removal; this handler installs no wait callback and does not synchronously free the pointer. Requires a live preview; no null guard. No party/dex rollback or sound.

Behavior source: [src/scrcmd.c:3027–3035](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3027-L3035) Helpers: [src/render_window.c:766–791](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/render_window.c#L766-L791).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_verity_cavern.s:20–20](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_verity_cavern.s#L20-L20).

<a id="cmd-21c"></a>

### ScrCmd_ActivateRoamingPokemon — 0x21C (540)

Arguments (wire order): `slot: u8 literal`.

**NEW SYSTEM: persistent roamers and route movement**. Reads literal u8 slot and initializes that SpecialEncounter roamer: Mesprit/Cresselia level 50, Darkrai 40, birds 60; invalid slot asserts and returns. Generates random IVs/personality using player trainer ID, clears status, activates, sets full HP and assigns random route different from previous player map and current roamer route. Re-activation overwrites existing roamer data. No battle/application wait, screen, cry or automatic seen/captured-dex write; caller’s Mesprit scene handles those separately.

Behavior source: [src/scrcmd.c:5409–5415](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5409-L5415) Helpers: [src/roaming_pokemon.c:241–324](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/roaming_pokemon.c#L241-L324).

Checkpoint uses (file occurrence; optional interactions remain optional): CP15 [res/field/scripts/scripts_verity_cavern.s:44–44](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_verity_cavern.s#L44-L44).

## Vista Lighthouse binoculars — first CP16; optional view

<a id="cmd-27a"></a>

### ScrCmd_UseVistaLighthouseBinoculars — 0x27A (634)

**Arguments:** none. **State/effect:** saves player X/Z, marks temporary-map change, fades out and loads Pokémon League at (847,561), hides Pokétch/player and sets special binocular camera FOV/distance/target/angles/clipping. Plays shutter/wipe, waits for pressed A or B, wipes back, reloads Lighthouse at saved X/Z facing north, restores visibility/fade, clears temporary flag. **Wait:** TRUE; nested task covers input, both transitions and cleanup. Does not set Volkner story progression or charge money. **NEW SYSTEM:** binocular view/temporary map visit. Uses a fixed return map/facing, not an arbitrary original-location snapshot.

**Decomp:** [src/scrcmd.c:5996–6002](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5996-L6002), [src/binoculars_vista_lighthouse.c:39–152](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/binoculars_vista_lighthouse.c#L39-L152).

**Checkpoint uses:** CP16 [res/field/scripts/scripts_vista_lighthouse.s:26–26](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_vista_lighthouse.s#L26-L26).

## Seal market — first CP16; optional shop

<a id="cmd-14a"></a>

### ScrCmd_PokeMartSeal — 0x14A (330)

Arguments (wire order): `martID: u16 var-or-value`.

**NEW SHOP CAPABILITY: seal currency/inventory transaction**, reusing existing shop lifecycle where possible. Resolves mart ID and indexes SunyshoreMarketDailyStocks; starts Shop task with MART_TYPE_SEAL and false auxiliary flag. Waits for shop field task to close; displays seal purchase UI and checks Seal Case capacity, adds purchased seals, subtracts price×quantity from trainer money and increments RECORD_MONEY_SPENT. Shop camera and menu transitions are owned by that task. No explicit day lookup here: script selects stock index for weekday. Invalid stock index is not range checked in handler. No direct story flags; optional Sunyshore market.

Behavior source: [src/scrcmd_shop.c:115–121](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd_shop.c#L115-L121) Helpers: [src/overlay007/shop_menu.c:240–279](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay007/shop_menu.c#L240-L279), [src/overlay007/shop_menu.c:1042–1061](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay007/shop_menu.c#L1042-L1061), [src/overlay007/shop_menu.c:1212–1243](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay007/shop_menu.c#L1212-L1243).

Checkpoint uses (file occurrence; optional interactions remain optional): CP16 [res/field/scripts/scripts_sunyshore_city.s:592–592](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L592-L592), [res/field/scripts/scripts_sunyshore_city.s:596–596](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L596-L596), [res/field/scripts/scripts_sunyshore_city.s:600–600](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L600-L600), [res/field/scripts/scripts_sunyshore_city.s:604–604](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L604-L604), [res/field/scripts/scripts_sunyshore_city.s:608–608](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L608-L608), [res/field/scripts/scripts_sunyshore_city.s:612–612](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L612-L612), [res/field/scripts/scripts_sunyshore_city.s:616–616](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_sunyshore_city.s#L616-L616).

## Hall of Fame, save, credits and restart — first CP19

<a id="cmd-28f"></a>

### ScrCmd_GetLeagueVictories — 0x28F (655)

Arguments (wire order): `arg0: u16 destination variable ID`.

**NEW SAVE SUBSYSTEM: Hall of Fame** (query op is small). Reads destination, loads HallOfFame extra-save block; empty or corrupt returns 0, valid returns HallOfFame_GetEntryNum(hall,0), i.e. newest entry’s number, not occupied ring-buffer size. Known load paths free temporary data; fallback returns 0. Returns TRUE (one yield), no asynchronous wait or screen/sound. Does not repair corruption or mutate save. CP19 chooses pre/post completion Hall-of-Fame scene branch.

Behavior source: [src/scrcmd.c:6259–6282](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L6259-L6282) Helpers: [src/hall_of_fame_entries.c:105–113](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/hall_of_fame_entries.c#L105-L113).

Checkpoint uses (file occurrence; optional interactions remain optional): CP19 [res/field/scripts/scripts_pokemon_league_hall_of_fame.s:16–16](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_hall_of_fame.s#L16-L16).

<a id="cmd-25a"></a>

### ScrCmd_PlayHallOfFameHealingAnimation — 0x25A (602)

**Arguments:** `pokeballCount:u16` var-or-value, narrowed to u8 by helper. **State/effect:** finds Hall of Fame machine prop (asserts if absent), derives absolute position from map-matrix origin, loads mini-ball animation, adds balls sequentially at authored machine slots with per-ball delays, plays final animation, waits for loop completion and removes ball props/resources. Despite its name it does **not** heal party HP/status/PP. **Wait:** TRUE; nested task through all props and cleanup. No save, flag, bag or party writes. **Edge:** helper assumes normal party count 1–6; it does not validate zero or over-six counts and enters add-ball phase unconditionally. **NEW SYSTEM:** machine/ball prop animation, reusable with healing-machine presentation.

**Decomp:** [src/scrcmd.c:5689–5695](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L5689-L5695), [src/overlay006/healing_machine_animation/hall_of_fame.c:40–145](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/overlay006/healing_machine_animation/hall_of_fame.c#L40-L145).

**Checkpoint uses:** CP19 [res/field/scripts/scripts_pokemon_league_hall_of_fame.s:52–52](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_hall_of_fame.s#L52-L52).

<a id="cmd-0b0"></a>

### ScrCmd_ClearGame — 0x0B0 (176)

Arguments (wire order): none.

**NEW SYSTEM: endgame transition, Hall-of-Fame save and credits/reset**. No operands. Records prior completed state; on first clear stores first-completion timestamp. Gives `MON_DATA_SINNOH_CHAMP_RIBBON` to every non-Egg party member (including fainted members), sets the special start location to Twinleaf house 2F (4,6), north, and the exit/first-respawn location to Twinleaf Town (116,886), south, both with no warp ID; sets `FLAG_COMMUNICATION_CLUB_ACCESSIBLE`, `FLAG_GAME_COMPLETED` and trainer main-story-cleared fields; increments Hall-of-Fame entry record. Calls task that displays Hall of Fame, waits for application exit/fade/message printers, heals party, requests full save and saves main data plus Hall-of-Fame entry with current party/date. Missing/corrupt Hall-of-Fame or first completion reinitializes its data before adding. Save overwrite-check branch skips save work; save result selects success/error message, then save SE, 18-frame delay, fade, credits app and clean system reset. No ordinary script resume after reset. Screen: team/clear display, saving state, result message, credits; sound includes save effect and credits app audio. Do not equate op completion with simply setting a cleared flag.

Behavior source: [src/scrcmd.c:3337–3341](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/scrcmd.c#L3337-L3341) Helpers: [src/clear_game.c:74–221](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/clear_game.c#L74-L221), [src/clear_game.c:281–318](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/clear_game.c#L281-L318), [src/unk_020559DC.c:178–183](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_020559DC.c#L178-L183), ribbon eligibility [src/unk_02054884.c:162–175](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/unk_02054884.c#L162-L175), locations [src/location.c:9–32](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/location.c#L9-L32), flags [src/system_flags.c:64–67](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/system_flags.c#L64-L67), [351–355](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/src/system_flags.c#L351-L355).

Checkpoint uses (file occurrence; optional interactions remain optional): CP19 [res/field/scripts/scripts_pokemon_league_hall_of_fame.s:57–57](https://github.com/pret/pokeplatinum/blob/1dc13dcea40c04ab53f1f607de46023dc409ef20/res/field/scripts/scripts_pokemon_league_hall_of_fame.s#L57-L57).

## Implementation boundaries and unresolved details

Field subsystem boundary summary: reuse existing `FieldHost` synchronous camera/object/event methods and the established `r.pause(...done())` pattern; the current `moveCamera`/`cameraOffset` hooks alone do not represent full camera FOV/angles, prop transforms, native overlay applications or save-backed dynamic geometry. Gym clock/water/bags/lifts/gears, Great Marsh tram and remote binocular views, boat cinematic/bridge, Galactic containment animation, Spear Pillar applications/effects and Distortion World require new world-owned systems exposed through contracts/core. Hall of Fame mini-ball presentation can build on the current healing-machine view/task seam, but its opcode does not heal Pokémon. Spiritomb saved counter, exit location, facing, status18 and explicit object height changes are small operations once their underlying contracts/state exist. No contract changes are made in this research.


The primary new systems are multiple-owner battles/raw outcomes (CP5 onward); persisted gym geometry (CP6 onward); Fashion Case and other distinct save inventories on optional branches; camera/effect task orchestration (CP6/9 onward); boat travel (CP11); containment props (CP14); Spear Pillar and Distortion World (CP15); and Hall of Fame/credits/reset (CP19). These should be owned by the relevant world, battle, menu/audio and save hosts. VM handlers should resolve operands, dispatch and wait through contracts rather than reach into another package's internals. Pure queries, flags, counters, form changes, object status updates and input predicates are small handlers once those capabilities exist.

Uncertainty remains explicitly attached to unnamed effect artistic choreography, the descriptive names of raw status bits, and pre-Champion reachability/minimum routes on optional branches. The fixed source pin establishes observed native behavior, not that every numeric input is a supported public API. No timing or visual claims here have been validated by ROM replay. Keep native frame/task counts as source observations and translate them through the engine's deterministic scheduler; do not casually equate every overlay frame with one 30 Hz engine tick.

## Opcode and checkpoint coverage index

The CP column records file/dispatch coverage, including optional and postgame branches described in each entry. It is not a mandatory-op checklist. The generic defeated-trainer query is a shared revisit branch for CP5–18. Full field-move and visible-item libraries are included where the story map calls them; their incidental item/form branches are marked in the specs.

| ID (hex / decimal) | Native command | CP coverage |
|---|---|---|
| `0x02B` / 43 | [ScrCmd_MessageInstant](#cmd-02b) | 11,12 |
| `0x032` / 50 | [ScrCmd_WaitABPadPress](#cmd-032) | 15 |
| `0x05D` / 93 | [ScrCmd_SetSubScene63](#cmd-05d) | 15 |
| `0x072` / 114 | [ScrCmd_ShowMoney](#cmd-072) | 5,9 |
| `0x073` / 115 | [ScrCmd_HideMoney](#cmd-073) | 5,9 |
| `0x074` / 116 | [ScrCmd_UpdateMoneyDisplay](#cmd-074) | 5,9 |
| `0x083` / 131 | [ScrCmd_SendGoodToPC](#cmd-083) | 7 |
| `0x085` / 133 | [ScrCmd_CheckHasRoomForGoodsInPC](#cmd-085) | 7 |
| `0x087` / 135 | [ScrCmd_GiveTrap](#cmd-087) | 7 |
| `0x08F` / 143 | [ScrCmd_GiveSphere](#cmd-08f) | 7 |
| `0x09B` / 155 | [ScrCmd_GetRematchTrainerID](#cmd-09b) | 5,6,7,8,9,10,11,12,13,14,15,16,17,18 |
| `0x0A8` / 168 | [ScrCmd_0A8](#cmd-0a8) | 7 |
| `0x0B0` / 176 | [ScrCmd_ClearGame](#cmd-0b0) | 19 |
| `0x124` / 292 | [ScrCmd_StartWildBattle](#cmd-124) | 8 |
| `0x12F` / 303 | [ScrCmd_ContestPhotoHasData](#cmd-12f) | 7 |
| `0x14A` / 330 | [ScrCmd_PokeMartSeal](#cmd-14a) | 16 |
| `0x14C` / 332 | [ScrCmd_SetBlackOutWarpId](#cmd-14c) | 7 |
| `0x16F` / 367 | [ScrCmd_InitPersistedMapFeaturesForPastoriaGym](#cmd-16f) | 9 |
| `0x170` / 368 | [ScrCmd_PressPastoriaGymButton](#cmd-170) | 9 |
| `0x171` / 369 | [ScrCmd_InitPersistedMapFeaturesForHearthomeGym](#cmd-171) | 7 |
| `0x173` / 371 | [ScrCmd_InitPersistedMapFeaturesForCanalaveGym](#cmd-173) | 11 |
| `0x174` / 372 | [ScrCmd_InitPersistedMapFeaturesForVeilstoneGym](#cmd-174) | 8 |
| `0x175` / 373 | [ScrCmd_InitPersistedMapFeaturesForSunyshoreGym](#cmd-175) | 16 |
| `0x176` / 374 | [ScrCmd_PressSunyshoreGymButton](#cmd-176) | 16 |
| `0x18C` / 396 | [ScrCmd_18C](#cmd-18c) | 15 |
| `0x1CD` / 461 | [ScrCmd_CreateJournalEvent](#cmd-1cd) | 6,7,8,9,11,13,14,15,16,17,18,19 |
| `0x1D2` / 466 | [ScrCmd_AddAccessory](#cmd-1d2) | 5,7,9,10 |
| `0x1D5` / 469 | [ScrCmd_AddContestBackdrop](#cmd-1d5) | 5 |
| `0x1E5` / 485 | [ScrCmd_IncrementGameRecord](#cmd-1e5) | 15,16 |
| `0x202` / 514 | [ScrCmd_StartEndSafariGame](#cmd-202) | 9 |
| `0x206` / 518 | [ScrCmd_StartGreatMarshLookout](#cmd-206) | 9 |
| `0x208` / 520 | [ScrCmd_DrawPokemonPreview](#cmd-208) | 15 |
| `0x209` / 521 | [ScrCmd_RemovePokemonPreview](#cmd-209) | 15 |
| `0x20D` / 525 | [ScrCmd_20D](#cmd-20d) | 15 |
| `0x20E` / 526 | [ScrCmd_InitGreatMarshTram](#cmd-20e) | 9 |
| `0x20F` / 527 | [ScrCmd_MoveGreatMarshTram](#cmd-20f) | 9 |
| `0x210` / 528 | [ScrCmd_CheckGreatMarshTramLocation](#cmd-210) | 9 |
| `0x214` / 532 | [ScrCmd_GetSpiritombCounter](#cmd-214) | 8 |
| `0x21C` / 540 | [ScrCmd_ActivateRoamingPokemon](#cmd-21c) | 15 |
| `0x22C` / 556 | [ScrCmd_TurnOnPokedexFormDetection](#cmd-22c) | 11 |
| `0x238` / 568 | [ScrCmd_CheckTVInterviewEligible](#cmd-238) | 9 |
| `0x23D` / 573 | [ScrCmd_PlayBoatCutscene](#cmd-23d) | 11 |
| `0x24A` / 586 | [ScrCmd_GetCapturedFlagCount](#cmd-24a) | 7 |
| `0x25A` / 602 | [ScrCmd_PlayHallOfFameHealingAnimation](#cmd-25a) | 19 |
| `0x25E` / 606 | [ScrCmd_InitLakeGuardianContainmentUnits](#cmd-25e) | 14,15 |
| `0x25F` / 607 | [ScrCmd_DeactivateLakeGuardianContainmentUnits](#cmd-25f) | 14,15 |
| `0x263` / 611 | [ScrCmd_ChangeDeoxysForm](#cmd-263) | 8,14 |
| `0x26D` / 621 | [ScrCmd_MessageUnown](#cmd-26d) | 8 |
| `0x26F` / 623 | [ScrCmd_ClearSpiritombCounter](#cmd-26f) | 8 |
| `0x27A` / 634 | [ScrCmd_UseVistaLighthouseBinoculars](#cmd-27a) | 16 |
| `0x284` / 644 | [ScrCmd_GetUnownFormsSeenCount](#cmd-284) | 9 |
| `0x286` / 646 | [ScrCmd_GetUndergroundItemsGivenAway](#cmd-286) | 7 |
| `0x287` / 647 | [ScrCmd_GetUndergroundFossilsUnearthed](#cmd-287) | 7 |
| `0x288` / 648 | [ScrCmd_GetUndergroundTrapsSet](#cmd-288) | 7 |
| `0x289` / 649 | [ScrCmd_GivePoffin](#cmd-289) | 7 |
| `0x28A` / 650 | [ScrCmd_CheckHasEmptyPoffinCaseSlot](#cmd-28a) | 7 |
| `0x28B` / 651 | [ScrCmd_CheckDistributionEvent](#cmd-28b) | 6,11,15 |
| `0x28F` / 655 | [ScrCmd_GetLeagueVictories](#cmd-28f) | 19 |
| `0x293` / 659 | [ScrCmd_GetUndergroundTalkCounter](#cmd-293) | 7 |
| `0x29F` / 671 | [ScrCmd_29F](#cmd-29f) | 9,10,11,12 |
| `0x2A0` / 672 | [ScrCmd_StartTagBattle](#cmd-2a0) | 5,8,14,15 |
| `0x2A2` / 674 | [ScrCmd_TrySetUnusedCollectedOrbFlag](#cmd-2a2) | 8,13,14 |
| `0x2B5` / 693 | [ScrCmd_2B5](#cmd-2b5) | 15 |
| `0x2B6` / 694 | [ScrCmd_2B6](#cmd-2b6) | 11 |
| `0x2BD` / 701 | [ScrCmd_StartLegendaryBattle](#cmd-2bd) | 5,12,15 |
| `0x2C9` / 713 | [ScrCmd_InitPersistedMapFeaturesForEternaGym](#cmd-2c9) | 6 |
| `0x2CA` / 714 | [ScrCmd_AdvanceEternaGymClock](#cmd-2ca) | 6 |
| `0x2CD` / 717 | [ScrCmd_2CD](#cmd-2cd) | 6 |
| `0x2F2` / 754 | [ScrCmd_InitPersistedMapFeaturesForDistortionWorld](#cmd-2f2) | 15 |
| `0x2FB` / 763 | [ScrCmd_2FB](#cmd-2fb) | 15 |
| `0x310` / 784 | [ScrCmd_StartLibraryTV](#cmd-310) | 11,12 |
| `0x311` / 785 | [ScrCmd_AddDistortionWorldMapObject](#cmd-311) | 15 |
| `0x312` / 786 | [ScrCmd_DeleteDistortionWorldMapObject](#cmd-312) | 15 |
| `0x314` / 788 | [ScrCmd_GetBattleResult](#cmd-314) | 15 |
| `0x317` / 791 | [ScrCmd_GetPlayer3DPos](#cmd-317) | 15 |
| `0x319` / 793 | [ScrCmd_StartGiratinaOriginBattle](#cmd-319) | 15 |
| `0x31B` / 795 | [ScrCmd_GetCurrentSafariGameCaughtNum](#cmd-31b) | 9 |
| `0x31C` / 796 | [ScrCmd_FindPartySlotWithFatefulEncounterSpecies](#cmd-31c) | 5 |
| `0x31F` / 799 | [ScrCmd_ResetDistortionWorldPersistedCameraAngles](#cmd-31f) | 15 |
| `0x320` / 800 | [ScrCmd_DoDWWarp](#cmd-320) | 15 |
| `0x321` / 801 | [ScrCmd_StartDistortionWorldGiratinaShadowEvent](#cmd-321) | 15 |
| `0x322` / 802 | [ScrCmd_FinishDistortionWorldGiratinaShadowEvent](#cmd-322) | 15 |
| `0x328` / 808 | [ScrCmd_SetPartyGiratinaForm](#cmd-328) | 15 |
| `0x32B` / 811 | [ScrCmd_CheckPartyHasFatefulEncounterRegigigas](#cmd-32b) | 11 |
| `0x32D` / 813 | [ScrCmd_32D](#cmd-32d) | 6,7 |
| `0x32E` / 814 | [ScrCmd_32E](#cmd-32e) | 6,7 |
| `0x331` / 817 | [ScrCmd_331](#cmd-331) | 6,7 |
| `0x332` / 818 | [ScrCmd_332](#cmd-332) | 6,7 |

## Source corpus and validation

All file names below are under `res/field/scripts/`, with the `scripts_` prefix and `.s` suffix omitted for compactness. Each listed local file includes its `scripts_init_*` companion when present. `common` is followed by called labels only, and `battles` is the shared event-trainer dispatch described above. Empty-script map headers contribute no command.

| CP | Local/reference script corpus |
|---|---|
| 5 | `floaroma_meadow`, `floaroma_town`, `jubilife_city`, `route_205_south`, `valley_windworks_building`, `valley_windworks_outside` |
| 6 | `eterna_city`, `eterna_city_gym`, `eterna_forest`, `route_205_north`, `team_galactic_eterna_building_1f`, `team_galactic_eterna_building_2f`, `team_galactic_eterna_building_3f`, `team_galactic_eterna_building_4f` |
| 7 | `contest_hall_lobby`, `cycle_shop`, `eterna_city`, `eterna_city_underground_man_house`, `hearthome_city`, `hearthome_city_gym_entrance_room`, `hearthome_city_gym_leader_room`, `hearthome_city_gym_trainer_room_1`, `hearthome_city_gym_trainer_room_2`, `mt_coronet_1f_south`, `route_206`, `route_206_cycling_road_north_gate`, `route_207`, `route_208`, `wayward_cave_1f` |
| 8 | `route_209`, `route_209_gate_to_hearthome_city`, `route_210_south`, `route_215`, `solaceon_ruins_room_7`, `solaceon_town`, `veilstone_city`, `veilstone_city_galactic_warehouse`, `veilstone_city_gym`, `visible_items` |
| 9 | `great_marsh_1`, `great_marsh_2`, `great_marsh_3`, `great_marsh_4`, `great_marsh_5`, `great_marsh_6`, `pastoria_city`, `pastoria_city_gym`, `pastoria_city_observatory_gate_1f`, `pastoria_city_observatory_gate_2f`, `route_213`, `route_214`, `route_214_gate_to_veilstone_city`, `safari_game`, `valor_lakefront` |
| 10 | `celestic_town`, `celestic_town_cave`, `grand_lake_route_213_lobby`, `pastoria_city`, `route_210_north`, `route_210_south`, `route_213`, `valor_lakefront` |
| 11 | `canalave_city`, `canalave_city_gym`, `canalave_library_1f`, `canalave_library_2f`, `canalave_library_3f`, `iron_island`, `iron_island_1f`, `iron_island_b1f_right_room`, `iron_island_b2f_left_room`, `iron_island_b3f`, `route_218`, `route_218_gate_to_canalave_city` |
| 12 | `canalave_library_3f`, `lake_valor_drained`, `lake_verity`, `valor_cavern`, `valor_lakefront` |
| 13 | `acuity_lakefront`, `lake_acuity`, `route_216`, `route_217`, `snowpoint_city_gym`, `visible_items` |
| 14 | `galactic_hq_1f`, `galactic_hq_2f`, `galactic_hq_3f`, `galactic_hq_4f`, `galactic_hq_b1f`, `galactic_hq_b2f`, `galactic_hq_control_room`, `galactic_hq_hall`, `galactic_hq_laboratory`, `veilstone_city`, `veilstone_city_galactic_warehouse`, `visible_items` |
| 15 | `acuity_cavern`, `celestic_town_north_house`, `distortion_world_1f`, `distortion_world_b1f`, `distortion_world_b2f`, `distortion_world_b3f`, `distortion_world_b4f`, `distortion_world_b5f`, `distortion_world_b6f`, `distortion_world_b7f`, `distortion_world_giratina_room`, `field_moves`, `galactic_hq_control_room`, `mt_coronet_1f_south`, `mt_coronet_2f`, `mt_coronet_6f`, `sandgem_town_pokemon_research_lab`, `sendoff_spring`, `spear_pillar`, `spear_pillar_dialga`, `spear_pillar_distorted`, `spear_pillar_palkia`, `valor_cavern`, `verity_cavern` |
| 16 | `field_moves`, `route_222`, `sandgem_town_pokemon_research_lab`, `sunyshore_city`, `sunyshore_city_gym_room_1`, `sunyshore_city_gym_room_2`, `sunyshore_city_gym_room_3`, `valor_lakefront`, `vista_lighthouse`, `vista_lighthouse_elevator` |
| 17 | `field_moves`, `pokemon_league`, `pokemon_league_north_pokecenter_1f`, `victory_road_1f` |
| 18 | `pokemon_league_aaron_room`, `pokemon_league_bertha_room`, `pokemon_league_elevator_to_aaron_room`, `pokemon_league_elevator_to_bertha_room`, `pokemon_league_elevator_to_champion_room`, `pokemon_league_elevator_to_flint_room`, `pokemon_league_elevator_to_lucian_room`, `pokemon_league_flint_room`, `pokemon_league_lucian_room`, `pokemon_league_north_pokecenter_1f` |
| 19 | `pokemon_league_champion_room`, `pokemon_league_hall_of_fame`, `pokemon_league_hallway_to_hall_of_fame` |

The audit checked every selected opcode against the classification and native command table, checked one detailed section per selected opcode, and validated all pinned path/line-range links against the source checkout. Metadata discrepancies are documented in the affected entries rather than changing generated engine tables in this documentation-only PR.

`pnpm check` passed at the engine baseline: lint, typecheck, fixture/demo pack replays and unit suite; **84 test files passed, 43 skipped; 775 tests passed, 200 skipped**. Host runtime was Node 26.8.2 (repository declares Node 24.x). ROM-dependent tests skipped without `OPENSINNOH_NDS_ROM`; no ROM, save or screenshot was opened or generated for this task. No ROM test or browser replay result is claimed.
