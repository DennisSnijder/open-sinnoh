# Field scripts and the v0.1 opening sequence (Platinum US)

Research, 2026-10-14. Sources: the US Platinum rev0 ROM (`/fielddata/script/scr_seq.narc`,
`/msgdata/pl_msg.narc`) and pret/pokeplatinum, which is used **for reference only** (it has no licence,
so do not copy its code). Every path below is relative to `reference-projects/pokeplatinum/`.

Everything here was **checked against the ROM** with a throwaway local decoder
(`scrdec.py`, `allscan.py`, `gapcheck.py`, `slice.py`, `slicedump.py`). The decoder builds its
operand-length table from `asm/macros/scrcmd.inc`. The `.s` sources were used only for names.

## TL;DR

- **The original plan for the first slice described Diamond/Pearl, not Platinum.** Platinum has no wild Starly attack
  and no Lake Verity scene with Rowan before the starter. The real order is:
  1. Rival in your bedroom.
  2. Mom.
  3. Rival bumps into you in Twinleaf.
  4. Rival's room.
  5. Route 201: rival heads for the tall grass and Rowan stops him. The assistant (Dawn or Lucas,
     whichever the player isn't) brings the briefcase.
  6. Starter choice on Route 201.
  7. **First battle against the rival** (`StartFirstBattle`).
  8. Warp home; Mom gives the Running Shoes.
  9. Rival joins you as a follower.
  10. Lake Verity, where you meet **Cyrus** (not Rowan).

  Details are in §6. The Starly objects and a "DP Rowan scene" are still in the ROM as unused leftovers.
- Script file = a table of u32 offsets, each relative to the end of its own field. The table usually ends
  with `0xFD13`, but **the engine never reads the terminator**, and 5 files lack it.
- Branches, calls and movement pointers use signed 32-bit offsets relative to the end of the operand.
  Messages are referenced by a **u8** index into a per-context text bank.
- The command table has **840 commands** (`0x000`–`0x347`). Across all 574 script files, **720 distinct
  commands** are reachable. Every reachable byte of every file decodes without error.
- The v0.1 slice uses **94 distinct commands**: 42 trivial, 37 medium, 15 complex. They are listed
  in §7.

---

## 1. Script archive and file format

### 1.1 Archive

- `/fielddata/script/scr_seq.narc` has **1124 members** (`res/field/scripts/scripts.order`, which has
  the same order as the meson list).
- There are two kinds of member, and nothing in the bytes says which kind a member is. You learn the
  kind from the map header that points at it:
  - **Script files** (574). These include `scripts_init_new_game` (412) and the shared files
    (`scripts_common` = 211, and so on).
  - **Level-script files** (549, all named `scripts_init_*`). These hold init-script tables.
  - The leftover, `scripts_unk_0402`, is the dummy file loaded for script ID 0.
- Each map header has three IDs: `scriptsArchiveID`, `initScriptsArchiveID` and `msgArchiveID`
  (`include/map_header.h:14-16`). The map header table is **C data in ARM9**
  (`include/data/map_headers.h`), not a NARC, so the importer must pull it out of `arm9.bin`.

The slice maps, verified against the ROM:

| Map header (id) | scripts member | init member | text bank (pl_msg member) |
|---|---|---|---|
| `TWINLEAF_TOWN_PLAYER_HOUSE_2F` (415) | 1056 | 986 | 558 (11 msgs) |
| `TWINLEAF_TOWN_PLAYER_HOUSE_1F` (414) | 1055 | 985 | 557 (42) |
| `TWINLEAF_TOWN` (411) | 1052 | 982 | 554 (15) |
| `TWINLEAF_TOWN_RIVAL_HOUSE_1F` (412) | 1053 | 983 | 555 (6) |
| `TWINLEAF_TOWN_RIVAL_HOUSE_2F` (413) | 1054 | 984 | 556 (4) |
| `ROUTE_201` (342) | 427 | 909 | 466 (63) |
| `VERITY_LAKEFRONT` (334) | 414 | 901 | 399 (4) |
| `LAKE_VERITY_LOW_WATER` (311) | 351 | 848 | 291 (12) |

For each bank, the message count in the ROM's `pl_msg.narc` header equals the number of entries in the
decomp's `res/text/<bank>.json`. That confirms the `TEXT_BANK_*` numbering.

`LAKE_VERITY_LOW_WATER` is the map used **before** Saturn is beaten. `verity_lakefront.s` disables one
pair of warps or the other in `ON_LOAD`, depending on `FLAG_DEFEATED_COMMANDER_SATURN_VALOR_CAVERN`
(318). So in the opening, the game uses `LAKE_VERITY_LOW_WATER`, not `LAKE_VERITY`. The name is
misleading.

### 1.2 Script file layout

```
u32 rel[0..n-1]     // entry i target = (4*i + 4) + (s32)rel[i]
u16 0xFD13          // optional terminator (ScriptEntryEnd)
code + movement data, interleaved; movement blocks are 4-byte aligned (.balign 4)
```

- The macros are at `asm/macros/scrcmd.inc:5105-5117` (`ScriptEntry` is `.long label-.-4`, and
  `ScriptEntryEnd` emits `.short 0xFD13`).
- The engine, `src/script_manager.c:412-416` (`ScriptContext_JumpToOffsetID`), does
  `ptr += id*4; ptr += read_u32()`. It never scans for `0xFD13`.
- **Five files have no terminator.** They are `scripts_battles`, `scripts_hidden_items`,
  `scripts_hearthome_city_dp_gym_leader_room`, `scripts_sunyshore_market` and
  `scripts_unused_battle_park_exchange_service_corner`.
- A decoder must therefore stop reading the table at `0xFD13` **or** at the lowest entry target,
  whichever comes first.
- Code and data are interleaved. Use recursive descent from the entry points; a linear sweep fails.
  - With recursive descent, the bytes left over are padding, dead code after `GoTo`/`End` (2683
    instructions), or 26 movement lists that nothing references.
  - None of the leftover bytes is unexplained.

### 1.3 Script ID → file and entry

`ScriptContext_LoadAndOffsetID` (`src/script_manager.c:228-255`) uses the range table at
`src/script_manager.c:31-62`.

- **ID 0** → `scripts_unk_0402`, entry 0, which is a bare `End`. Objects with `script: 0` (rivals and
  other cutscene actors) do nothing when you talk to them.
- **1–1999** → the current map's script file, entry `id-1`, with the map's text bank. Script numbers in
  the event files (`res/field/events/*.json`) and init tables are therefore **1-based**.
- **≥ 2000** → a shared file. The first threshold that matches, from highest to lowest, wins, and the
  entry is `id - base`. Each range also fixes the text bank:

| base | file | text bank |
|---|---|---|
| 2000 | `scripts_common` (211) | `COMMON_STRINGS` (213) |
| 2500 | `scripts_bg_events` | `BG_EVENTS` |
| 2800 | berry trees | |
| 3000 / 5000 | `scripts_battles` (single / double trainer) | `COMMON_STRINGS` |
| 7000 | visible items | |
| 8000 | hidden items (also loads hidden-item params, `script_manager.c:201`) | |
| 9600 | `scripts_init_new_game` | `COMMON_STRINGS` |
| 9700 | `scripts_follower_partners` | `FOLLOWER_PARTNERS` (429) |
| 10300 | counterpart talk | |
| … | full list at `include/script_manager.h:89-119` | |

The event files hold these global IDs directly. Twinleaf's hidden-item bg event is 8201, Verity
Lakefront's is 8160, Route 201's rival object is 9700 and Lake Verity's TM38 ball is 7239.

### 1.4 Level scripts (init scripts)

These are separate NARC members, read by `src/script_manager.c:706-800`. The macros are at
`asm/macros/scrcmd.inc:5121-5180`.

```
repeat:
  u8 type                    // 0 = end of table
  type 1 (ON_FRAME_TABLE):  s32 rel  -> table at (field_end + rel)
  type 2/3/4 (TRANSITION/RESUME/LOAD): u16 scriptID, u16 0
frame table rows: u16 var, u16 valueOrVar, u16 scriptID ; terminated by u16 0
(file padded to 4 bytes)
```

All 549 level-script files parse with no bytes left over. The ROM has 245 `ON_TRANSITION`, 105
`ON_FRAME_TABLE`, 46 `ON_LOAD` and 36 `ON_RESUME` entries. The decomp mislabels two bytes as type 253
and type 30 (`scripts_init_contest_hall_stage_ongoing_contest` has 4 extra padding bytes). Ignore them.

Each init type behaves differently:

- **Fixed IDs are global script IDs.** In practice they are always 1–1999, so they point into the map's
  own file.
- **Frame-table row check.** A row matches when `TryGetVar(var) == TryGetVar(valueOrVar)`. `TryGetVar`
  returns the literal number when the operand is below 0x4000.
  - The first matching row wins.
  - It is evaluated **every idle input frame** (`src/overlay005/field_control.c:176`, before
    trainer-sight and movement).
  - It starts the script as a normal task (`ScriptManager_Set`).
  - The script must change the variable, or it will fire again the next frame.
- **`ON_TRANSITION`** runs **synchronously, to completion** (`FieldSystem_RunScript`,
  `script_manager.c:696-704`) during the map change.
  - It runs in `FieldMapChange_UpdateGameData` (`src/field_map_change.c:299`, and also `:1354`).
  - That is **before objects are created**, which is why counterpart graphics are chosen here through
    `VAR_OBJ_GFX_ID_0` (0x4020).
- **`ON_LOAD`** (`src/overlay005/fieldmap.c:205`) and **`ON_RESUME`** (`:224`) also run
  synchronously. They run whenever the field overlay initialises, including after a battle or menu.
  `ON_LOAD` runs after objects exist (it uses `RemoveObject` and `SetWarpEventPos`).
- **Synchronous scripts must not block.** Anything run by `RunScript` should use only non-yielding
  commands.

### 1.5 Event triggers (from `zone_event`, structs at `include/map_header_data.h:10-53`)

- **Coord events.** A trigger is a rectangle `x ≤ px < x+width`, `z ≤ pz < z+length` plus the test
  `TryGetVar(var) == value`, where `value` is a literal.
  - The first match in list order wins (`src/unk_0203C954.c:208-222`).
  - It is checked after each completed step (`field_control.c:720,767`), before connections, wild
    encounters and so on.
  - **Struct field order is `script, x, z, width, length, y, value, var`.** `value` comes before
    `var`.
- **BG events.** Each has a `script`, a `type` (0 = normal, 1 = scrolling sign, 2 = hidden item), a
  position and the allowed facing direction.
- **Object events.**
  - Each has an explicit `localID` field. In the decomp it equals the index in the list, which is what
    `LOCALID_*` constants are.
  - A non-zero `hiddenFlag` means the object is not spawned while that flag is set.
  - The special local IDs are `LOCALID_PLAYER` 0xFF, `LOCALID_CAMERA` 0xF1 and `LOCALID_FOLLOWER`
    0xF2, which means "the object with `MOVEMENT_TYPE_FOLLOW_PLAYER`" (`src/scrcmd.c:2095-2110`).
  - For "clone" objects (those with `clone_id`, such as the guitarist and arrow signposts that cross
    map edges), `hidden_flag` holds a map header ID and `script` is 0xFFFF.

### 1.6 Execution model (`src/field_script_context.c:58-140`)

- **Encoding.** The opcode is a u16, and operands are little-endian, fixed per opcode except for
  six commands (§2.2). Every handler returns TRUE to yield the frame or FALSE to keep going.
  - Waits are implemented as `ScriptContext_Pause(ctx, predicate)`.
  - On the frame the predicate becomes true, the context returns without running the next command.
    That costs one extra frame of latency, which matters for timing-exact replays.
- **Call stack.** It has 20 slots.
  - When the stack is full, a push is silently dropped.
  - `Return` with an empty stack sets the script pointer to NULL, which stops the script just like
    `End`.
- **Comparisons.** `CompareVarToValue` / `CompareVarToVar` / `CheckFlag` set `comparisonResult` to
  0 (<), 1 (==) or 2 (>). For flags it is 0 or 1. `GoToIf` / `CallIf` index
  `sConditionTable[cond][result]` (`src/scrcmd.c:744-752`): cond 0 `<`, 1 `==`, 2 `>`, 3 `<=`,
  4 `>=`, 5 `!=`.
- **Macro idioms.** The macro layer expands `GoToIfEq var, x, L` into `CompareVar` + `GoToIf 1`, and
  `GoToIfSet` into `CheckFlag` + `GoToIf 1`. An IR builder should fold these pairs back for
  readability.
- **"Var or value" operands.** Most u16 operands are read with `ScriptContext_GetVar`
  (`include/inlines.h:150`), which applies `TryGetVar` to them.
  - Values of 0x4000 or more are variable IDs; smaller values are literals.
  - This applies to `ApplyMovement`'s local ID, `Warp`, `GivePokemon`, `StartFirstBattle` and others.
- **Variables.**
  - 0x4000–0x401F are map-local (cleared on map change).
  - 0x4020–0x402F are object-graphics variables.
  - 0x4000–0x411F are saved.
  - 0x8000–0x800D are script-manager temporaries (`VAR_0x8000`…`VAR_RESULT` 0x800C,
    `VAR_LAST_TALKED` 0x800D). They live in the ScriptManager, not the save
    (`script_manager.c:428-441`).
- **Flags.**
  - 1–0x40 are map-local.
  - Trainer flags start at 0x550 (trainer id + 0x550).
  - Daily flags are 0xAA0–0xB5F.
- **Common scripts (`CallCommonScript id`)** (`src/scrcmd.c:973-1001`).
  - The command creates a **second, concurrent `ScriptContext`** (the "sub" context) with its own
    file and **its own text bank**.
  - It pauses the caller until the sub-script executes `ReturnCommonScript` (which clears a flag).
    The sub-context then continues to its `End`.
  - Both contexts are stepped each frame, main first (`script_manager.c:119-168`).
- **WaitTime quirk.** `WaitTime frames, var` stores the countdown in a real variable (usually
  `VAR_RESULT`) and clobbers it.

---

## 2. Command set

### 2.1 Table and operand source

- The table is `gFieldScriptCommands` in `src/scrcmd.c:764`, built from
  `include/data/scripts/scrcmd.h`. It has **840 entries**, and each opcode is its index.
- Operand layouts come from `asm/macros/scrcmd.inc`. Each command macro starts with
  `.short SCRCMD_X` and continues with `.byte`/`.short`/`.long` lines.
  - Of the 840 commands, 839 match by constant name.
  - Opcode 756 is spelled `ScrCmd_GETRANDOMBATTLEGROUNDTRAINERS` (`scrcmd.inc:4513`).
- A `.long` written as `label-.-4` is a relative pointer. Nine commands have one: `GoTo`, `Call`,
  `GoToIf`, `CallIf`, `ApplyMovement`, `GoToIfTargetTrainerDefeated` and the unused 0x017–0x019.
- Pointer targets are relative to the end of the operand (`scriptPtr + offset` after the read,
  `src/scrcmd.c:1004-1075, 2029-2044`).
- **Usage.** 720 of the 840 commands are reachable from the entry points of the 574 script files
  (55,736 instructions; 1,879 movement lists). The 120 unused ones are mostly `Dummy*` and
  `ScrCmd_Unused_*` (list in the scratchpad `cmd_usage.json`).

### 2.2 Variable-length or special commands (decoder care)

- **Conditional operands.** Six macros emit operands conditionally, depending on the first operand's
  value. The C handlers read them the same way.
  - `DoStrengthFunc`, `DoFlashFunc`, `DoDefogFunc`: `u8 func`, then a `u16` dest only if `func == 2`.
  - `DoGroupConnectionAction`: `u16 action`; 2 extra u16 for actions 0–3, 1 extra for 4–5.
  - `CallTVBroadcast`: `u16 id`; 1 extra u16 for ids 0 and 6, 3 extra for 1, 3 and 5, 2 extra for 4.
  - `MysteryGiftGive`: `u16 stage`; 1 extra for stages 1–3, 2 extra for 5–6.
- **u8 operands.** `Message` and the other text commands take a **u8** message ID, so a script file can
  reach only the first 256 messages of its bank. `MessageVar` truncates to u8.
- **Native-code entry points.** Gen 4 has **no `special` multiplexer** like Gen 3. Native behaviour is
  one dedicated opcode per feature:
  - `StartChooseStarterScene`, `StartFirstBattle`, `GiveRunningShoes` and so on.
  - Commands that launch apps pause on `ScriptContext_WaitForApplicationExit`.
  - The only multiplexers are the variable-length ones above, plus
    `CallBattleTowerFunction`, `CallBattleHallLobbyFunction`, `CallBattleCastleLobbyFunction`,
    `CallBattleArcadeLobbyFunction` and `CallTVInterview`. Each takes a function selector.
- **Shared-script calls.** `CallCommonScript` is the shared-script call (§1.6). The `Common_*` aliases
  are listed at `asm/macros/scrcmd.inc:5243-5360`.

### 2.3 Movement data (`asm/macros/movement.inc`, `generated/movement_actions.txt`)

- A movement list is a sequence of `{u16 action, u16 count}` (`MapObjectAnimCmd`,
  `include/overlay005/map_object_anim_cmd.h`), ended by `{0x00FE, 0}` (`MOVEMENT_ACTION_END`).
  There are 155 actions.
- **Starting a list.** `ApplyMovement localID, rel` starts the list on that object and returns
  immediately.
  - Several `ApplyMovement`s can run at once.
  - `WaitMovement` waits for all of them (`src/scrcmd.c:2029-2115`).
  - `LOCALID_CAMERA` with `AddFreeCamera`/`RestoreCamera` moves the camera.
- **Actions used by the slice (27).**
  - `FACE_{N,W,E}`.
  - `WALK_NORMAL_{N,S,W,E}` and `WALK_FAST_{N,S,W,E}`.
  - `WALK_ON_SPOT_NORMAL_{N,S,W,E}` and `WALK_ON_SPOT_FAST_{N,S,W,E}`.
  - `DELAY_4`, `DELAY_8`, `DELAY_16`.
  - `EMOTE_EXCLAMATION_MARK`, `SET_INVISIBLE`, `LOCK_DIR`, `UNLOCK_DIR` and `END`.

---

## 3. Common and shared scripts

- Shared scripts are resolved by ID range (§1.3). There is no per-file import table.
- The common scripts the slice reaches, with ID, entry and purpose:
  - `0x7D0` HandleSignpostInput, reached through every `Show*Sign` macro. It can open the start menu.
  - `0x7E0` and `0x7FC`: give an item and print "obtained", used for the Potion.
  - `0x7E1`: bag full.
  - `0x7F8` / `0x7F9` / `0x7FA` / `0x7FB`: counterpart BGM, rival BGM and fades. These are audio only.
- Route 201's rival object uses script **9700**, `FollowerPartners_Rival` in
  `res/field/scripts/scripts_follower_partners.s`.
- The new-game script is **9600** (`scripts_init_new_game`).

---

## 4. Where the player name, gender and rival name come from

1. `GameStartRowanIntro_Main` → `StartNewSave` (`src/game_start.c:181-187`) does four things:
   - clears the save;
   - puts the player at **`TWINLEAF_TOWN_PLAYER_HOUSE_2F` (415), x=4, z=6, facing up**
     (`src/location.c:8-14`);
   - sets money to **3000**;
   - sets the bag-acquired system flag.
2. The Rowan intro app sets the player name, gender and rival name
   (`src/applications/rowan_intro/rowan_intro_app.c:433-450`; `MiscSaveBlock_SetRivalName`). The title's
   NEW GAME runs it (packages/menus `createRowanIntro`); replays skip it and write the defaults to the same
   three save fields.
3. `GameStartNewSave_Main` → `InitializeNewSave` (`src/game_start.c:144-172`) sets:
   - the trainer ID (random);
   - the appearance;
   - game time;
   - the berry patches;
   - the RNG seeds.
4. The field system then runs `FieldSystem_SetLoadNewGameSpawnTask` (`src/field_map_change.c:478-483`).
   That calls `FieldSystem_InitNewGameState`, which runs **script 9600 synchronously**
   (`script_manager.c:691-694`), then loads the map.

**`InitNewGame` (`res/field/scripts/scripts_init_new_game.s:7-133`)** runs 112 `SetFlag` (almost all `FLAG_HIDE_*`)
across the whole game. The ones that matter for the slice are:

| constant | id |
|---|---|
| `FLAG_HIDE_TWINLEAF_TOWN_PLAYER_HOUSE_2F_RIVAL` | 371 |
| `FLAG_HIDE_TWINLEAF_TOWN_RIVAL` | 372 |
| `FLAG_HIDE_TWINLEAF_TOWN_PLAYER_HOUSE_1F_RIVAL_MOM` | 497 |
| `FLAG_HIDE_ROUTE_201_PROF_ROWAN` | 376 |
| `FLAG_HIDE_ROUTE_201_COUNTERPART` | 377 |
| `FLAG_HIDE_ROUTE_201_BRIEFCASE` | 381 |
| `FLAG_HIDE_LAKE_VERITY_LOW_WATER_STARLY` | 399 (DP leftover) |
| `FLAG_HIDE_LAKE_VERITY_LOW_WATER_PROF_ROWAN` | 373 |
| `FLAG_HIDE_LAKE_VERITY_LOW_WATER_COUNTERPART` | 404 |

It also sets:

- `VAR_TWINLEAF_TOWN_GUITARIST_TRIGGER_STATE` (0x4070) to **1**, so the guitarist blocks the north
  exit from the start;
- `VAR_OREBURGH_GATE_1F_HIKER_STATE` to 1 and `VAR_CONSECUTIVE_BONUS_ROUND_WINS` to 9;
- `FLAG_OBTAINED_FULLMOON_ISLAND_FOREST_LUNAR_WING`.

It also calls `InitSizeContestRecord`, `RandomizeJubilifeLottery` and `InitDailyRandomLevel`. All three
are safe to stub, but log them.

These are **not** set, so the matching objects are visible from the start: `FLAG_HIDE_ROUTE_201_RIVAL`
(370), `FLAG_HIDE_TWINLEAF_TOWN_RIVAL_HOUSE_2F_RIVAL` (374) and `FLAG_HIDE_LAKE_VERITY_LOW_WATER_RIVAL`
(406). `FLAG_HIDE_LAKE_VERITY_LOW_WATER_CYRUS` (498) is not set either, so Cyrus is visible at the lake.

**How the text uses the names.**

- `BufferPlayerName n` and `BufferRivalName n` load the names into string-template slots.
- The counterpart's look comes from **`GetPlayerGender`**, through `VAR_OBJ_GFX_ID_0` set in
  `ON_TRANSITION` (player male → Dawn, `OBJ_EVENT_GFX_PLAYER_F`).
- Gendered lines branch on `GetPlayerGender` (`GENDER_MALE` = 0).

---

## 5. Key state variables for the slice

| constant | id | meaning / values |
|---|---|---|
| `VAR_PLAYER_HOUSE_SPECIAL_PROGRAM_STATE` | 0x40F9 | 0 = TV program still on (2F frame trigger) → 1 |
| `VAR_PLAYER_HOUSE_RIVAL_STATE` | 0x40A5 | 0 = rival bursts into 2F on first step → 1 |
| `VAR_PLAYER_HOUSE_STATE` | 0x40A4 | 0 → 1 (Mom told you) → 2 (warned at door) → 3 (back from rival battle) → 4 (shoes) → 5 (left house; Twinleaf ON_TRANSITION) |
| `VAR_TWINLEAF_TOWN_RIVAL_TRIGGER_STATE` | 0x40E6 | 0 = rival "thud" at his door → 1 |
| `VAR_TWINLEAF_TOWN_GUITARIST_TRIGGER_STATE` | 0x4070 | 1 = guitarist blocks north exit → 2 after the rival-room scene |
| `VAR_RIVAL_HOUSE_STATE` | 0x40A3 | 0 = rival-room frame trigger → 1 |
| `VAR_FOLLOWER_RIVAL_STATE` | 0x4086 | 0 = Route 201 Rowan scene → 1 = pick starter → 2 = back from battle, rival waits → 3 = rival following → 4 = after Lake Verity |
| `VAR_VERITY_LAKEFRONT_STATE` | 0x4082 | 0 = "we're at the lake" trigger → 1 |
| `VAR_VISITED_LAKE_VERITY_WITH_RIVAL` | 0x4095 | 0 = Cyrus frame trigger → 1 |
| `VAR_PLAYER_STARTER` | 0x4030 | species set by `SaveChosenStarter` |

The rival's starter is not stored. It is derived from the player's (`src/system_vars.c:75-89`):
Turtwig (387) → Chimchar (390), Chimchar → Piplup (393), anything else → Turtwig.

Flags written along the slice:

| flag | id |
|---|---|
| `FLAG_TALKED_TO_MOM` | 135 |
| `FLAG_RIVAL_LEFT_HOME` | 234 |
| `FLAG_TALKED_TO_RIVAL_HOUSE_RIVAL_MOM_RIVAL_LEFT` | 110 |
| `FLAG_RECEIVED_ROUTE_201_POTION` | 108 |
| `FLAG_TALKED_TO_LAKE_VERITY_LOW_WATER_PROF_ROWAN` | 184 |

The hide flags written along the slice are 370, 371, 372, 376, 377, 381, 406 and 497 (all are object
show/hide toggles).

Branches read but never true in the slice:

| flag | id |
|---|---|
| `FLAG_HAS_POKEDEX` | 144 |
| `FLAG_RECEIVED_PARCEL` | 143 |
| `FLAG_MOM_WARNED_PLAYER` | 248 |

---

## 6. The opening sequence, beat by beat

"Entry" means the 1-based script number in that map's file. Message IDs are indexes in the map's bank
(names from `res/text/<bank>.json`).

1. **Spawn in the bedroom** (`PLAYER_HOUSE_2F`, 4,6, facing up).
   - `ON_TRANSITION` entry 5 runs `SetInitialVolumeForSequence` for the TV jingle, only when
     `SPECIAL_PROGRAM_STATE == 0`.
   - On the first input frame, the frame table (`VAR_PLAYER_HOUSE_SPECIAL_PROGRAM_STATE == 0` → entry 3,
     `OnFrame_ConcludeSpecialProgram`) runs. It does `LockAll`, sets the variable to 1, shows messages
     0 and 1 with `PlayFanfare`, then `PlayDefaultMusic` and `ReleaseAll`.
   - The TV news is only audio plus two lines of text. There is no rival yet.
2. **Rival bursts in.** These are coord events on the 4 tiles around the spawn, each requiring
   `VAR_PLAYER_HOUSE_RIVAL_STATE == 0`. Entries 7, 8, 9 and 10 correspond to stepping N, W, E or S, and
   each sets `VAR_MAP_LOCAL_0x00` to 0–3 (`scripts_twinleaf_town_player_house_2f.s:60-130`).
   - The script clears hide flag 371, then `AddObject` for the rival.
   - It runs movement, `Common_SetRivalBGM`, then messages 6–10 (with `BufferRivalName` and
     `BufferPlayerName`).
   - Its 4-way `CallIf` movement variants depend on the direction stepped.
   - It then runs `RemoveObject`, sets 371 again and sets `VAR_PLAYER_HOUSE_RIVAL_STATE = 1`.
   - BG events in the room: Wii (1), PC (2), scrolling sign (4), TV (6).
3. **Downstairs, Mom** (`PLAYER_HOUSE_1F`, file `scripts_twinleaf_town_player_house_1f.s`).
   - `ON_TRANSITION` entry 1 repositions Mom when `STATE == 3`.
   - The frame table has three rows, checked in this order:
     - `PLAYER_HOUSE_STATE == 0` → entry 2;
     - `VAR_PLAYER_HOUSE_POSTGAME_STATE` (0x410F) `== 1` → entry 11;
     - `PLAYER_HOUSE_STATE == 3` → entry 3.
   - **Entry 2** (`:34-49`): Mom walks to you, sets `FLAG_TALKED_TO_MOM`, shows message 0
     `RivalAlreadyLeft`, sets `STATE = 1`.
   - **Coord event at the door** (6,10) with `STATE == 1` → entry 5 (`:736`): Mom says message 4
     `DontGoIntoTallGrass` and sets `STATE = 2`.
   - Talking to Mom is entry 4 (state-dependent lines 0, 1, 2, …). The TV, fridge, sink and counter are
     entries 7–10.
4. **Twinleaf Town** (`scripts_twinleaf_town.s`). `ON_TRANSITION` entry 1 only bumps `STATE` from 4 to 5
   and from 6 to 7.
   - **Coord event (105,876)**, the tile in front of the rival's door, with `RIVAL_TRIGGER_STATE == 0` →
     entry 2 `CoordEvent_RivalThud` (`:389-425`). It runs:
     - `LoadDoorAnimation` / `PlayDoorOpenAnimation`;
     - clear hide flag 372 and `AddObject`;
     - movements that push the player back;
     - message 0 `BigThud`, then rival BGM, then messages 1–2;
     - the rival goes back inside, the door closes, `RemoveObject`;
     - `GUITARIST_TRIGGER_STATE = 1` and `RIVAL_TRIGGER_STATE = 1`.
   - **Coord event (108..115, 867)** with `GUITARIST_TRIGGER_STATE == 1` → entry 4. It uses
     `GetPlayerMapPos` and 8 variants by x position; the guitarist pushes you back with message 3.
     This is the north-exit gate.
   - NPCs: guitarist 3, collector 5, breeder 6, map sign 7, mailboxes 8 and 9.
5. **Rival's house.**
   - 1F, entry 1: the rival's mom, with lines 0 and 1 by player gender.
   - **2F frame table** (`VAR_RIVAL_HOUSE_STATE == 0` → entry 1, `scripts_twinleaf_town_rival_house_2f.s`)
     runs:
     - messages 0–1;
     - the rival leaves;
     - set `FLAG_RIVAL_LEFT_HOME`;
     - `RIVAL_HOUSE_STATE = 1` and **`GUITARIST_TRIGGER_STATE = 2`**, which opens the route.
6. **Route 201: Rowan and the briefcase** (`scripts_route_201.s`).
   - `ON_TRANSITION` entry 1 sets the counterpart graphics.
   - The rival object (hide flag 370, initially visible) stands at (112,855).
   - **Coord event (110..113, 857)** with `VAR_FOLLOWER_RIVAL_STATE == 0` → entry 2
     `CoordEvent_ChooseStarterScene` (`:37-260`). In order:
     - the rival runs to you (4 variants by x), messages 0–4;
     - he dashes for the grass, message 5 `HoldIt`;
     - `PlayMusic`, clear hide flag 376, `AddObject Rowan`, `LockObject`;
     - messages 6–11;
     - a **yes/no loop** ("you love Pokémon?", messages 11–18);
     - messages 19–21;
     - clear hide flag 377 and `AddObject` for the counterpart, plus counterpart BGM;
     - by gender, messages 22, 23, 26 and 28 or messages 24, 25, 27 and 29;
     - clear hide flag 381 and **`AddObject` for the briefcase (112,854)**;
     - messages 30, 31, 33 and 34;
     - `SetObjectEventMovementType rival LOOK_WEST` and **`VAR_FOLLOWER_RIVAL_STATE = 1`**.
   - While `STATE == 1`, coord events at (113..114,855) and (115,854) → entry 4, which turns you back
     to the briefcase (message 35). Talking to Rowan → entry 15 (message 32). Talking to the rival →
     script 9700 (follower message 1).
7. **Briefcase → starter** (object entry 13, `Route201_Briefcase`, `:274`). In order:
   - `LockAll`, `FadeScreenOut`, set flag 381, `RemoveObject` briefcase;
   - **`StartChooseStarterScene`** → **`SaveChosenStarter`** (sets `VAR_PLAYER_STARTER`) →
     **`ReturnToField`**;
   - fade in;
   - `GetPlayerStarterSpecies 0x8000`;
   - **`GivePokemon 0x8000, 5, ITEM_NONE, VAR_RESULT`**. The met location is the map label for
     Route 201;
   - `BufferRivalStarterSpeciesName`, messages 36–38;
   - Rowan leaves (set 376, `RemoveObject`);
   - the counterpart says messages 39–40 or 41–42 by gender, then leaves (set 377);
   - message 43;
   - the rival runs up: message 44 plus a **yes/no loop** (message 45 on "no");
   - message 47, then `SetMovementType rival LOOK_SOUTH`.
8. **First battle.** `GetPlayerStarterSpecies` picks the trainer:
   - `TRAINER_RIVAL_ROUTE_201_TURTWIG` (851) if you chose Turtwig;
   - `…_CHIMCHAR` (852) if you chose Chimchar;
   - otherwise `…_PIPLUP` (850).

   Then `StartFirstBattle` runs. It calls `Encounter_NewVsFirstBattle` (`src/encounter.c:653-667`)
   with `BATTLE_STATUS_FIRST_BATTLE`.
   - After the battle, `CheckWonBattle VAR_RESULT` runs.
   - **On a win**, the encounter task restores the field itself (`encounter.c:183-210`), and the
     script continues with message 48.
   - **On a loss there is no blackout**. The task returns without restoring the field
     (`encounter.c:192-195`), and the script runs `ReturnToField` + `FadeScreenIn` itself, then
     message 49.
   - Both paths then set **`VAR_FOLLOWER_RIVAL_STATE = 2`** and **`VAR_PLAYER_HOUSE_STATE = 3`**,
     run `FadeScreenOut`, `HealParty`, then **`Warp PLAYER_HOUSE_1F, 2, 6, DIR_NORTH`**
     (`:399-411`).
   - The v0.1 stub should report a win.
9. **Running Shoes.** On `PLAYER_HOUSE_1F`, the `ON_TRANSITION` script puts Mom at (2,4), then the
   frame table (`STATE == 3`) runs entry 3 (`:119-150`): messages 6–9, `GiveRunningShoes` (a system
   flag), `PlayFanfare`, `STATE = 4`. Leaving to Twinleaf sets `STATE = 5`.
10. **Rival joins.** Back on Route 201, the coord event at (109..113, 857) with
    `FOLLOWER_RIVAL_STATE == 2` → entry 16 (`:1192-1245`) runs:
    - messages 50–51;
    - **`FOLLOWER_RIVAL_STATE = 3`**, `SetStepFlag`;
    - **`SetHasPartner`**, `SetMovementType rival MOVEMENT_TYPE_FOLLOW_PLAYER`;
    - **`SetObjectFlagIsPersistent rival TRUE`**, set hide flag 370.

    While `STATE == 3`, coord events stop you going back south ((110..113,858) → entry 3, message 52)
    or east toward Sandgem ((115,852..855) → entry 14, message 53). Both temporarily
    `ClearHasPartner`, walk you back, then re-enable following.
11. **Verity Lakefront** (`scripts_verity_lakefront.s`).
    - `ON_LOAD` entry 1 and `ON_TRANSITION` entry 2 run `SetWarpEventPos` to hide one pair of warps.
    - **Coord event (80..81, 844)** with `VAR_VERITY_LAKEFRONT_STATE == 0` → entry 3 runs:
      - `ApplyMovement LOCALID_FOLLOWER`, message 0;
      - `VERITY_LAKEFRONT_STATE = 1`;
      - **`Warp LAKE_VERITY_LOW_WATER, 46, 54, DIR_NORTH`**.
12. **Lake Verity: Cyrus** (`scripts_lake_verity_low_water.s`).
    - `ON_TRANSITION` entry 1 sets the counterpart graphics.
    - `ON_LOAD` entry 2 removes the unused Starly objects only if a map-local flag is set (a DP
      leftover).
    - **The frame table** (`VAR_VISITED_LAKE_VERITY_WITH_RIVAL == 0` → entry 3, `:41-115`) runs, in
      order:
      - `ClearHasPartner`;
      - the rival and player walk in, message 0;
      - **`AddFreeCamera 46,53`** + camera movement, messages 1–2 (Cyrus);
      - Cyrus leaves (`RemoveObject`);
      - messages 3–4, `PlayCry SPECIES_MESPRIT` (481), messages 5–7;
      - the rival leaves (set flag 406);
      - **`FOLLOWER_RIVAL_STATE = 4`** and **`VISITED_LAKE_VERITY_WITH_RIVAL = 1`**.

    This is the natural end of v0.1. The next beat is Sandgem Town.

**Unused DP material still in the ROM.**

- `Route201_DPProfRowanScene_Unused` (entry 5) is not referenced by any event.
- There are Starly objects on Lake Verity Low Water.
- `FLAG_HIDE_LAKE_VERITY_LOW_WATER_STARLY` is still set at init.

Do not build the slice from these.

**Open item (world and VM).**

- The follower rival is the Route 201 object (local 2), made persistent. Map changes keep persistent
  objects (`src/map_object.c:172-195`, `sub_0206244C` reconciles them against the new map's events).
- Lake Verity has its own `LOCALID_RIVAL` object (index 5, flag 406), and the lakefront script hides
  the follower with `SET_INVISIBLE` before the warp.
- Confirm how the two rival objects are reconciled. Until then, treat "partner follower
  across warps" as engine work, not script work.

---

## 7. VM implementation list (slice path)

The list was computed from the ROM by walking every entry used in §6, plus NPC, sign and BG entries on
those maps, follower script 9700 and the common scripts reached (`0x7D0`, `0x7E0`, `0x7E1`,
`0x7F8`–`0x7FC`).

That gives **94 commands**. Classes:

- **trivial**: state or data only, no wait.
- **medium**: waits, UI or objects.
- **complex**: a subsystem.

| op | command | operands | class | uses |
|---|---|---|---|---|
| 0x002 | End | - | trivial | 107 |
| 0x003 | WaitTime | frames:u16, countdownVarID:u16 | medium | 20 |
| 0x011 | CompareVarToValue | varID:u16, value:u16 | trivial | 190 |
| 0x014 | CallCommonScript | scriptID:u16 | medium | 20 |
| 0x015 | ReturnCommonScript | - | medium | 10 |
| 0x016 | GoTo | offset:s32rel | trivial | 117 |
| 0x01A | Call | offset:s32rel | trivial | 12 |
| 0x01B | Return | - | trivial | 69 |
| 0x01C | GoToIf | condition:u8, offset:s32rel | trivial | 152 |
| 0x01D | CallIf | condition:u8, offset:s32rel | trivial | 57 |
| 0x01E | SetFlag | flagID:u16 | trivial | 129 |
| 0x01F | ClearFlag | flagID:u16 | trivial | 8 |
| 0x020 | CheckFlag | flagID:u16 | trivial | 19 |
| 0x026 | AddVar | destVarID:u16, valueOrVarID:u16 | trivial | 3 |
| 0x028 | SetVarFromValue | destVarID:u16, value:u16 | trivial | 39 |
| 0x029 | SetVarFromVar | destVarID:u16, srcVarID:u16 | trivial | 6 |
| 0x02C | Message | messageID:u8 | medium | 179 |
| 0x031 | WaitButton | - | medium | 53 |
| 0x034 | CloseMessage | - | medium | 102 |
| 0x036 | DrawSignpostInstantMessage | messageID:u8, signpostType:u8, signpostNARCMemberIdx:u16, unused:u16 | medium | 5 |
| 0x037 | DrawSignpostTextBox | signpostType:u8, signpostNARCMemberIdx:u16 | medium | 3 |
| 0x038 | SetSignpostCommand | command:u8 | medium | 11 |
| 0x039 | WaitForSignpostDone | - | medium | 9 |
| 0x03A | DrawSignpostScrollingMessage | messageID:u8, destVarID:u16 | medium | 3 |
| 0x03B | GetSignpostInput | destVarID:u16 | medium | 6 |
| 0x03C | ShowStartMenu | - | medium | 1 |
| 0x03E | ShowYesNoMenu | destVarID:u16 | medium | 4 |
| 0x049 | PlaySE | seqID:u16 | medium | 33 |
| 0x04B | WaitSE | seqID:u16 | medium | 2 |
| 0x04C | PlayCry | species:u16, unused:u16 | medium | 1 |
| 0x04D | WaitCry | - | medium | 1 |
| 0x04E | PlayFanfare | seqID:u16 | medium | 11 |
| 0x04F | WaitFanfare | - | medium | 5 |
| 0x050 | PlayMusic | seqID:u16 | medium | 1 |
| 0x051 | StopMusic | 0:u16 | medium | 4 |
| 0x052 | PlayDefaultMusic | - | medium | 3 |
| 0x054 | FadeOutBGM | targetVolume:u16, frames:u16 | medium | 2 |
| 0x057 | SetBGM | seqID:u16 | medium | 3 |
| 0x05E | ApplyMovement | localID:u16, movementOffset:s32rel | complex | 205 |
| 0x05F | WaitMovement | - | complex | 133 |
| 0x060 | LockAll | - | medium | 41 |
| 0x061 | ReleaseAll | - | medium | 64 |
| 0x062 | LockObject | localID:u16 | medium | 4 |
| 0x064 | AddObject | localID:u16 | medium | 7 |
| 0x065 | RemoveObject | localID:u16 | medium | 11 |
| 0x066 | AddFreeCamera | x:u16, z:u16 | complex | 1 |
| 0x067 | RestoreCamera | - | complex | 1 |
| 0x068 | FacePlayer | - | medium | 15 |
| 0x069 | GetPlayerMapPos | destVarIDX:u16, destVarIDZ:u16 | trivial | 5 |
| 0x06C | SetObjectFlagIsPersistent | localID:u16, flag:u8 | medium | 2 |
| 0x06D | SetMovementType | localID:u16, movementType:u16 | medium | 5 |
| 0x07B | AddItem | item:u16, count:u16, destVarID:u16 | trivial | 2 |
| 0x07D | CanFitItem | item:u16, count:u16, destVarID:u16 | trivial | 1 |
| 0x080 | GetItemPocket | item:u16, destVarID:u16 | trivial | 22 |
| 0x096 | GivePokemon | species:u16, level:u16, heldItem:u16, successVar:u16 | complex | 1 |
| 0x0A1 | ReturnToField | - | complex | 2 |
| 0x0B4 | StartChooseStarterScene | - | complex | 1 |
| 0x0B5 | SaveChosenStarter | - | trivial | 1 |
| 0x0BC | FadeScreen | transition:u16, frames:u16, type:u16, color:u16 | medium | 9 |
| 0x0BD | WaitFadeScreen | - | medium | 9 |
| 0x0BE | Warp | mapID:u16, 0:u16, x:u16, z:u16, direction:u16 | complex | 2 |
| 0x0CD | BufferPlayerName | templateArg:u8 | trivial | 52 |
| 0x0CE | BufferRivalName | templateArg:u8 | trivial | 61 |
| 0x0D1 | BufferItemName | templateArg:u8, item:u16 | trivial | 6 |
| 0x0D2 | BufferPocketName | templateArg:u8, pocket:u16 | trivial | 16 |
| 0x0DC | BufferRivalStarterSpeciesName | templateArg:u8 | trivial | 2 |
| 0x0DE | GetPlayerStarterSpecies | destVar:u16 | trivial | 2 |
| 0x0EC | CheckWonBattle | destVarID:u16 | complex | 1 |
| 0x125 | StartFirstBattle | trainerID:u16 | complex | 3 |
| 0x14D | GetPlayerGender | destVarID:u16 | trivial | 8 |
| 0x14E | HealParty | - | trivial | 2 |
| 0x15A | GiveRunningShoes | - | trivial | 1 |
| 0x161 | SetHasPartner | - | trivial | 2 |
| 0x162 | ClearHasPartner | - | trivial | 3 |
| 0x164 | SetStepFlag | - | trivial | 1 |
| 0x168 | LoadDoorAnimation | mapX:u16, mapZ:u16, tileX:u16, tileZ:u16, tag:u8 | complex | 1 |
| 0x169 | WaitForAnimation | tag:u8 | complex | 2 |
| 0x16A | UnloadAnimation | tag:u8 | complex | 1 |
| 0x16B | PlayDoorOpenAnimation | tag:u8 | complex | 1 |
| 0x16C | PlayDoorCloseAnimation | tag:u8 | complex | 1 |
| 0x186 | SetObjectEventPos | localID:u16, x:u16, z:u16 | trivial | 1 |
| 0x188 | SetObjectEventMovementType | localID:u16, movementType:u16 | trivial | 2 |
| 0x189 | SetObjectEventDir | localID:u16, dir:u16 | trivial | 1 |
| 0x18A | SetWarpEventPos | index:u16, x:u16, z:u16 | trivial | 4 |
| 0x1B6 | GetTimeOfDay | destVarID:u16 | trivial | 2 |
| 0x1B7 | GetRandom | destVarID:u16, upperBound:u16 | trivial | 1 |
| 0x1BD | GetPlayerDir | destVarID:u16 | trivial | 3 |
| 0x1C5 | InitSizeContestRecord | - | trivial | 1 |
| 0x1CC | GiveJournal | - | trivial | 1 |
| 0x250 | RandomizeJubilifeLottery | - | trivial | 1 |
| 0x27B | InitDailyRandomLevel | - | trivial | 1 |
| 0x283 | SetInitialVolumeForSequence | seqID:u16, volume:u16 | medium | 1 |
| 0x2A7 | CheckItemIsPlate | item:u16, destVar:u16 | trivial | 2 |
| 0x33D | BufferItemNamePlural | templateArg:u8, item:u16 | trivial | 4 |

Notes for the VM:

- **Audio.** Audio is out of scope, but `PlayFanfare`/`WaitFanfare`, `WaitSE` and `WaitCry` gate
  progress. Give them deterministic stub durations; don't make them no-ops that complete instantly
  without a frame tick.
- **LockAll.** Besides pausing all objects, `LockAll` waits for a moving follower partner to stop
  (`src/scrcmd.c:2174-2198`).
- **Native calls in the slice.**
  - `StartChooseStarterScene`: an app. The slice can use a simple 3-way picker that writes
    `species` (387, 390 or 393).
  - `StartFirstBattle` + `CheckWonBattle`: stubbed as won.
  - `GivePokemon`: needs mon generation (level 5).
  - `GiveRunningShoes`, `GiveJournal`, `HealParty`, the three new-game inits, and `Warp`.
- **Out of the slice but nearby.** `GiveJournal` and the parcel path in Mom's script are reachable only
  after `FLAG_HAS_POKEDEX`, so you can log them.

## 8. Text

- **Text banks.** Each script context has a `MessageLoader` on `pl_msg.narc` member = text bank ID
  (`script_manager.c:257-269`).
  - Map scripts use the header's `msgArchiveID`.
  - Shared ranges use the bank listed in the range table: common = 213, follower = 429, and so on.
- **Bank switching.** A `CallCommonScript` sub-context prints from **its own** bank. The caller's bank
  is unchanged.
- **Banks used by the slice.** 558, 557, 554, 555, 556, 466, 399 and 291 (map banks), 213 (common),
  429 (follower partners).
- **Format.** Each bank starts with a u16 count and a u16 key, and the text is encrypted (Gen 4
  `msgdata` format).
- **Placeholders.** These are filled by `Buffer*` commands into `StringTemplate` slots 0–7
  (`script_manager.c:131`). The slice uses the player name, rival name, item name or plural, pocket
  name and rival starter species name.
- **Signposts.** `Show*Sign` uses separate commands (`DrawSignpost*`) with signpost types (map, arrow,
  landmark, scrolling). The text still comes from the map bank.
