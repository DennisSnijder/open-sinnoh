# Seals and Ball Capsules

2026-10-23. Everything needed to build the Seal Case, the Ball Capsule editor, the seal sources and the seals' send-out
effect in battle: the save data, the seal table, the scripts and their commands, the editor's screens and rules, the
battle effect, and the ROM tables (offsets and SHA-1s checked against the US ROM).

Source: pret/pokeplatinum at `1dc13dc` (local `reference-projects/pokeplatinum`), for names, offsets and understanding
only. Paths are relative to its root. "Frame" is one 30 Hz tick. **(inferred)** marks what was reasoned, not read.

## 1. What exists now

- **Script ops.** `count_seal_occurence` (0x093), `give_or_take_seal` (0x094), `open_seal_capsule_editor` (0x0A9),
  `poke_mart_seal` (0x14A) and `count_unique_seals_in_seal_case` (0x2AB) are stubs (`op-classification.json`: "returns
  0" or "no-op", milestone "later"). `buffer_ball_seal_name` (0x2B3) and `buffer_ball_seal_name_plural` (0x345) are
  real (`m1b-ops.ts`, the name banks with `v - 1`, as the decomp). Every other op the seal scripts use is implemented
  (§4). Because `count_unique_seals_in_seal_case` returns 0, the PC's BALL CAPSULES entry says "Ball Capsules can't be
  used because you don't have any Seals.", which is the right answer for a game without seals.
- **Data.** Trainer party members keep `ballSeal` raw (contracts `records.ts`, "Decomp cbSeal (ball capsule)"), but
  nothing reads it. The party screen's `party/held` sheet already has the capsule marker (cell 2). The battle
  particles (`ParticleSystem`, `particleSystems`) come only from `waza_particle.narc`; `ball_particle.narc` is read
  only for the catch stars (importer `ui2d/battle.ts` `BALL_STARS`, app `battle/scene.ts` `starParticles`).
- **Battle send-out.** `packages/battle/src/controller.ts`: `sendOut()` (the player's side: the throw, then 8 frames
  of white flash while the Pokémon scales from 1/8 to 1) and `foeSendOut()` → `appear()` (the foe's side, the same
  8-frame flash). No ball opens, no particles play, and no ball-open sound plays.
- **Save.** No Seal Case and no capsule on a Pokémon (core `Pokemon` says capsules are not modelled). Schema v20.

## 2. Save data

### 2.1 The Seal Case (`include/struct_defs/seal_case.h`, `src/ball_seal_info.c`)

| Field | Layout | Meaning |
|---|---|---|
| `capsules[12]` | 12 × `BallCapsule` (8 × `BallSeal`, 24 B) | the 12 capsules |
| `BallSeal` | `u8 type, u8 x, u8 y` | seal id (0 = empty slot), position on the editor's touch screen (§5.4) |
| `seals.count[80]` | u8 per seal id 1–80 (index id − 1) | **loose** seals: those not on a capsule |

368 bytes (288 + 80), save block NORMAL, zero-filled for a new game (`SealCase_Init`). Constants: 80 seal ids
(`SEAL_ID_MAX` 81 counts the dummy 0), `CAPSULE_NUM` 12, `SEALS_PER_CAPSULE` 8, `MAX_SEALS_PER_TYPE` 99.

Rules (`ball_seal_info.c`):

- **Owned** (`SealCase_CountSealOccurrenceAnywhere`) = loose count + the number of slots on all 12 capsules with that
  id. The 99 cap applies to the owned total, not to the loose count.
- **Give or take** (`GiveOrTakeSeal(id, q)`): q < 0 takes from the loose count, refused (no change) if it would go
  below 0; q > 0 adds, refused (no change, nothing partial) if owned + q > 99. Returns success; the script command
  ignores it.
- `GiveOrTakeSeal2` is the editor's "seal dropped off the capsule" path: adds when the **placed** count + q ≤ 99, then
  clamps the loose count to 99.
- `SealCase_CheckSealCount(id, q)`: the same test as give or take, without the change (the shop and Mystery Gift).
- **Unique** (`SealCase_CountUniqueSeals`): the number of ids 1–80 with owned ≠ 0.
- **Bag:** the Seal Case is a key item (`ITEM_SEAL_CASE`, `ITEM_USE_FUNC_BAG_MESSAGE`): "Use" prints
  `Bag_Text_SealCaseMessage` "Seals: N" with N = Σ owned over ids 1–80 (`bag_context.c` `CalcTotalBallSeals`). It
  does not open the editor.

### 2.2 The capsule on a Pokémon (`include/struct_defs/pokemon.h`, `src/pokemon.c`)

The party part of a `Pokemon` (not the box part) holds `ballCapsuleID` (u8 at 0x8D, `MON_DATA_BALL_CAPSULE_ID`) and a
full **copy** of the capsule (`BallCapsule` at 0xD4, `MON_DATA_BALL_CAPSULE`). The id is 0 for none, else
capsule index + 1 (1–12). The battle effect reads only the copy; the id only says "has one". The copy is what makes a
traded or NPC Pokémon's seals work without the owner's Seal Case.

Who sets and clears it:

| Event | What happens | Decomp |
|---|---|---|
| New Pokémon, boxed → party | id 0, copy zeroed | `Pokemon_InitWith`, `BoxPokemon` → `Pokemon` conversion (`pokemon.c:385`, `:4035`) |
| Editor SET | id = capsule + 1, copy = the capsule | `capsule_menu/main.c` `CAPSULE_MENU_ATTACH_CAPSULE_STATE_ID` |
| Editor CONFIRM on a capsule that is on a party Pokémon | its copy refreshed | `manager.c` (state 6) |
| Editor SHIFT (swap two capsules) | each holder's id follows its capsule (the copies already match) | `graphics.c` `CapsuleGraphics_SwapCapsules` |
| Editor REMOVE, or a capsule edited down to no seals | id 0 (the copy stays, unused) | `CapsuleManager_AssignCapsuleMon`, `CapsuleGraphics_AssignCapsules` |
| Day-Care STORE, NPC trade | "The Ball Capsule will be detached. Will that be OK?" YES: id 0 and copy zeroed, then go on; NO: back | party menu `PartyMenu_SelectBallSeal` (daycare context entry 8 "STORE"), `CheckForItemApplication` (`PARTY_MENU_MODE_NPC_TRADE`) |
| PC: deposit or move out of the party | refused: `BoxText_DetachBallCapsule` "Please detach the Ball Capsule." (checked after mail) | `box_app_manager.c:485`, `:2135` |
| Link trade, GTS receive | the received Pokémon's capsule cleared; GTS asks before offering one with a capsule | `trade_room/application.c:2453`, `gts_application/*` (out of scope) |
| Shedinja | born with id 0 and a zeroed copy | `evolution.c:762` |
| Battle Video playback | the recorded parties get id 0 (no seals on replay) | `unk_0202F1D4.c:611` |
| NPC trainers | `cbSeal` ≠ 0: id **1** and the copy = capsule `cbSeal − 1` of `application/custom_ball/edit/pl_cb_data.narc` member 0 | `trainer_data.c` → `Pokemon_SetBallSeal` |

A capsule is on at most one Pokémon: the editor offers SET only for a capsule with seals and no holder, and the party
menu refuses a Pokémon that already has a capsule ("Two capsules can't be set.").

## 3. The seals

### 3.1 Ids (generated `seals.txt`)

| Ids | Seals | Price (₽) |
|---|---|---|
| 1–6 | Heart Seal A–F | 50 (A–D), 100 (E, F) |
| 7–12 | Star Seal A–F | 50 (A–D), 100 (E, F) |
| 13–16 | Line Seal A–D | 100 |
| 17–20 | Smoke Seal A–D | 100 |
| 21–24 | Ele-Seal A–D | 100 |
| 25–28 | Foamy Seal A–D | 50 |
| 29–32 | Fire Seal A–D | 50 |
| 33–36 | Party Seal A–D | 50 (A, B), 100 (C, D) |
| 37–42 | Flora Seal A–F | 50 |
| 43–49 | Song Seal A–G | 50 |
| 50–75 | A Seal … Z Seal (alphabet) | 0 (not sold) |
| 76, 77 | Shock Seal (!), Mystery Seal (?) (alphabet) | 0 |
| 78–80 | Liquid Seal, Burst Seal, Twinkle Seal | 0 |

The prices are the table's, read from the ROM (§9), not this summary.

### 3.2 The seal table (`capsule_menu/main.c` `sealTypeValues`, arm9)

81 rows of 10 bytes, indexed by seal id (row 0 is the dummy):

| Offset | Type | Field | Use |
|---|---|---|---|
| 0 | u16 | `memberIdx` | the seal's NCGR in `application/custom_ball/data/cb_data.narc` (184–264) |
| 2 | u8 | `nameIndex` | the entry in `TEXT_BANK_BALL_SEAL_NAMES` (12) / `_PLURAL` (13) |
| 3 | u8 | unused | 0x25 everywhere |
| 4 | u8 | `particleIndex` | the SPA in `wazaeffect/effectdata/ball_particle.narc` (37–116) |
| 5 | u8 | `isAlphabetSeal` | 1 for ids 50–77 |
| 6 | u16 | `price` | the seal shop's price (row 0: 999) |
| 8 | u8 | `nonAlphabetIndex` | the description in `TEXT_BANK_UNK_0542` (0–48 for ids 1–49, 49–51 for ids 78–80; 0 for alphabet seals) |
| 9 | u8 | padding | 0 |

From the ROM: `nameIndex` = id for 1–15, id − 1 for 17–77 and id for 78–80; Line Seal D (16) is name 77 (added
late). `particleIndex` = 36 + id except where the order was shuffled (Smoke and Ele are swapped: 17–20 → 57–60,
21–24 → 53–56); `memberIdx` has a few neighbours swapped (Star A/B, Star C/D, …). Always read the table.

**Names quirk.** The script commands `BufferBallSealName`/`…Plural` pass `id − 1` straight to the name bank
(`scrcmd_strings.c:441`, `:565`), not `nameIndex`. That is right only for ids 17–77; the only script that uses them
(Solaceon, §4.1) passes alphabet seals, so it never shows. The shop and the editor use `nameIndex`. Keep both as the
DS does.

### 3.3 Text

| Bank | What |
|---|---|
| 12 `TEXT_BANK_BALL_SEAL_NAMES`, 13 `…_PLURAL` | names (81 entries; 0 is junk) |
| 542 `TEXT_BANK_UNK_0542` | shop descriptions (52) |
| 543 `TEXT_BANK_UNK_0543` | the shop's lines; seal ones: 13 "You placed the {seal} in the Seal Case.", 14 "The Seal Case is full. You have no more room for Seals.", 20 "In Bag: N" (shared by all marts) |
| 8 `TEXT_BANK_UNK_0008` | the editor (17): 0 EDIT, 1 QUIT, 2 SET, 3 REMOVE, 4 SHIFT, 5 CONFIRM, 6 CANCEL, 7 "Choose a capsule.", 8 "What would you like to do?", 9 "The capsule was removed.", 10 "Switch with which capsule?", 11 "The capsules were switched.", 12 "Finished editing the capsule.", 13 "Confirming...", 14 "Quit without changing the capsule design?", 15 "There's no more room!", 16 "There are no Seals left." |
| 453 party menu | `PartyMenu_Text_BallCapsuleWasSet`, `…TwoCapsulsesCantBeSet`, `…BallCapsuleWillBeDetached` |
| 19 box messages | `BoxText_DetachBallCapsule` |
| 213 common strings | `CommonStrings_Text_NoSeals` |
| 361 menu entries | `MenuEntries_Text_PC_BallCapsules`, `…_DescriptionBallCapsules` |

## 4. Getting seals

There is no daily seal giver in Platinum and no seal clerk in Solaceon (Diamond and Pearl's Solaceon seal shop moved to
Sunyshore Market). The sources are:

### 4.1 Solaceon Town, east house (`scripts_solaceon_town_east_house.s`)

**The mother (PokefanF, entry 2): the Seal Case and five seals, once.** Without `FLAG_RECEIVED_SOLACEON_TOWN_EAST_HOUSE_SEAL_CASE`:
the message, `ITEM_SEAL_CASE` ×1 through `Common_GiveItemQuantity` (common script 0x7FC), the flag, then
"Next, some Seals. Here you go!" and five `GiveOrTakeSeal …, 1` with `GetRandom`:

| Draw | Ids |
|---|---|
| `GetRandom 6` + 1 | 1–6 (a Heart Seal) |
| `GetRandom 6` + 7, twice | 7–12 (two Star Seals, may repeat) |
| `GetRandom 4` + 25 | 25–28 (a Foamy Seal) |
| `GetRandom 7` + 43 | 43–49 (a Song Seal) |

then the how-to ("…check the heading 'Ball Capsules' in the PC menu…"). Afterwards she repeats the how-to.

**The boy (NinjaBoy, entry 1): Unown seals.** Without the Seal Case flag: "talk to my mom". Otherwise, if the party has
an Unown (`CheckPartyHasSpecies`), take the first (`FindPartySlotWithSpecies`) and its form f
(`GetPartyMonForm`, 0–25 = A–Z, 26 = !, 27 = ?); the seal is id 50 + f. He gives nothing (just the "give me Unown"
line) when:

- f equals `VAR_MAP_LOCAL_0x00` (the last form he paid for; set to −1 when `FLAG_MAP_LOCAL_0x01` is clear, so it
  resets each time the map loads), or
- the player owns 99 of that seal.

Otherwise he gives `min(10, 99 − owned)` (the script: 10, less `owned − 89` when owned > 89), sets the local var to f
and the local flag, and says "The {seals} were put away in the Seal Case." (the singular name when he gave exactly 1).
No party Unown: the "give me Unown" line.

### 4.2 Sunyshore Market seal shop (`scripts_sunyshore_market.s` `SunyshoreMarket_SealShop`, entry 3)

`CheckItem ITEM_SEAL_CASE` (none: `SunyshoreMarket_Text_NoSealCase`), then the vendor greeting (common), then
`GetDayOfWeek` (0 = Sunday) → `PokeMartSeal MART_SEAL_ID_SUNYSHORE_<day>` (0 = Monday … 6 = Sunday). Seven seals a day
(`include/data/mart_items.h`):

| Day | Stock (ids) |
|---|---|
| Monday | 1, 8, 29, 43, 15, 22, 36 |
| Tuesday | 2, 9, 30, 37, 44, 16, 23 |
| Wednesday | 3, 10, 31, 38, 45, 17, 24 |
| Thursday | 4, 25, 32, 39, 46, 11, 18 |
| Friday | 26, 33, 40, 47, 5, 12, 19 |
| Saturday | 27, 34, 41, 48, 6, 13, 20 |
| Sunday | 7, 49, 28, 42, 14, 21, 35 |

Every non-alphabet seal 1–49 is sold on exactly one day. The PokefanM (entry 4) only comments by day (Sunday–Wednesday
"didn't have any Seals I wanted", Thursday–Saturday "came through with different Seals"). `SunyshoreCity_SealMerchant_Unused`
(`scripts_sunyshore_city.s:574`) is an unused copy whose day mapping is shifted by one; nothing calls it.

**The seal mart** (`ScrCmd_PokeMartSeal`, `scrcmd_shop.c:115` → `Shop_Start(…, MART_TYPE_SEAL)`; `overlay007/shop_menu.c`)
is the normal mart with these differences: the list shows `nameIndex` names; the description is bank 542
`nonAlphabetIndex`; no item icon; price = the table's `price`; "In Bag: N" shows the owned total; the quantity cap is
the usual one (money, at most 99), then the purchase is refused with bank 543 #14 when
`SealCase_CheckSealCount(id, n)` fails; the confirm line uses the singular name for 1, plural otherwise; buying calls
`GiveOrTakeSeal(id, n)`, takes the money and adds to `RECORD_MONEY_SPENT`; no Sinnoh Shopping Champ TV segment, no free
Premier Ball. The first menu is BUY / CANCEL only (bank 543 #15, #17; no SELL, `Shop_InitContextMenu`), and the
background is `shop_gra` `tilemap_no_item_NSCR` (no icon box).

### 4.3 Other sources

- **Mystery Gift** cosmetic gifts of type `MG_COSMETICS_SEAL` (`scrcmd_mystery_gift.c:466`): check, then give one.
  Liquid, Burst and Twinkle (78–80) appear in no script, so (inferred) they were Wi-Fi/Mystery Gift only. Out of scope
  unless a pack supplies a gift.
- Nothing else: no contest prize, no Pokétch app, no NPC gift elsewhere.

### 4.4 Script commands

| Op | Opcode | Arguments | Semantics | OpenSinnoh |
|---|---|---|---|---|
| `count_seal_occurence` | 0x093 | seal (var), dest var | dest = owned total of the seal (loose + on capsules) | stub (returns 0) |
| `give_or_take_seal` | 0x094 | seal (var), quantity (var, read as u16 then passed as s16) | §2.1 give or take; result ignored | stub (no-op) |
| `open_seal_capsule_editor` | 0x0A9 | — | runs the editor field task (§5) and returns TRUE: the script waits until the task ends (the field is restarted after) | stub (no-op) |
| `poke_mart_seal` | 0x14A | mart id (u16) | the seal mart with `SunyshoreMarketDailyStocks[id]` | stub (no-op) |
| `count_unique_seals_in_seal_case` | 0x2AB | dest var | dest = unique seal count | stub (returns 0) |
| `buffer_ball_seal_name` | 0x2B3 | template arg (u8), seal (var) | name bank 12 entry seal − 1 | implemented |
| `buffer_ball_seal_name_plural` | 0x345 | template arg (u8), seal (var) | name bank 13 entry seal − 1 | implemented |

The rest of these scripts (`check_item`, `check_party_has_species`, `find_party_slot_with_species`,
`get_party_mon_form`, `get_random`, `get_day_of_week`, `buffer_party_mon_species`, the list menu ops, the fades,
`unload_animation`, the common scripts) is implemented.

**The PC** (`scripts_common.s:1051` `CommonScript_PlayersPC`): "<Player>'s PC" → MAILBOX / BALL CAPSULES / LOG OFF.
BALL CAPSULES: `CountUniqueSealsInSealCase`; 0 → `CommonStrings_Text_NoSeals` and back to the menu; else close the
message, fade out, `UnloadAnimation ANIMATION_TAG_PC`, `OpenSealCapsuleEditor`, then "Access which PC?" instantly, the
PC menu re-drawn, the PC boot animation, fade in. Common script 2023 (`0x7E7`, fade, editor, fade) has no caller.

## 5. The Ball Capsule editor (`src/applications/capsule_menu/`)

`main.c` (arm9: the field task, the seal table), `manager.c`, `graphics.c`, `placement.c` (overlay 76 `capsule_menu`,
loaded with overlays 11 and 12 `battle_anim`, which hold the throw and the seal effect).

### 5.1 Field task (`CapsuleMenu_StartFieldTask`, `CapsuleMenu_FieldTaskCB`)

1. Finish the map; capsule index = 0; the party's Pokémon.
2. Run the app. It exits with an action: GO_TO_FIELD (B, QUIT) or GO_TO_PARTY_MENU (SET).
3. SET: the party menu in `PARTY_MENU_MODE_BALL_SEAL` ("Choose a Pokémon and confirm."). A or a tap on a non-Egg
   Pokémon opens the context menu [SET, CANCEL] (an Egg buzzes: `SEQ_SE_DP_CUSTOM06`); a tap selects at once. SET: if
   the Pokémon has no capsule, "The Ball Capsule was set." and its marker shows; else "Two capsules can't be set." and
   the choice is cancelled. Then, unless cancelled: id = capsule + 1, copy = the capsule, and a TV "Seal Club" segment
   with slot 0's seal name (`FieldSystem_SaveTVSegment_SealClubShow`; TV is a stub). Back to step 2, the cursor kept
   on the capsule.
4. GO_TO_FIELD: restart the map.

The app's own BGM call is `SOUND_SCENE_SUB_59` with `SEQ_NONE` (no new music; (inferred) the field BGM goes on).

### 5.2 Capsule selection (`CapsuleManager_SelectionActions`)

**Top screen** (main engine): the 12 capsules in a 4 × 3 grid, capsule i at (40 + 56·(i % 4), 27 + 53·⌊i / 4⌋)
(`CapsuleGraphics_GetCapsuleGridLocation`); each capsule sprite's animation 0 = empty, 1 = has seals; a capsule with a
holder shows the holder's party icon at (−16, +12) from it; the cursor sprite on the current capsule; the message box
at tiles (2, 21), 27 × 2: "Choose a capsule." **Bottom screen** (sub engine): the current capsule's seals, drawn at
their stored (x, y) shifted by (−56, +16) (circle centre (134, 86)), over the capsule background.

Input:

| Input | Effect |
|---|---|
| D-pad (repeat) | Right: +1 mod 12; Left: −1 mod 12; Up: −4 unless on the top row; Down: +4 unless on the bottom row. `SE_CONFIRM` (1500). The bottom screen re-loads the new capsule's seals |
| A | "What would you like to do?" and the capsule menu (`SE_CONFIRM`) |
| Tap anywhere | EDIT on the current capsule (no menu) |
| B | leave (`SEQ_SE_DP_DECIDE` 1501), fade out 6 frames |

The capsule menu (window at tile 21, top 13 (3 rows) or 11 (4 rows), 9 wide; B = QUIT):

| Capsule | Menu |
|---|---|
| empty | EDIT, SHIFT, QUIT |
| seals, no holder | SET, EDIT, SHIFT, QUIT |
| seals and a holder | REMOVE, EDIT, SHIFT, QUIT |

- **EDIT** → the editor (§5.3).
- **SET** → save, leave the app for the party menu (§5.1 step 3).
- **REMOVE** → the holder's id = 0, "The capsule was removed.", any of A, B, X, Y, L, R, Start, Select, D-pad
  (mask 0xCF3) to go on.
- **SHIFT** → a second cursor: "Switch with which capsule?"; D-pad moves it (`SE_CONFIRM`), A swaps the two capsules'
  contents and holders ("The capsules were switched.", any key), B cancels (`DECIDE`).
- **QUIT** → back to "Choose a capsule.".

### 5.3 The editor (`CapsuleManager_HandleCancelUpdateSeals`)

Entering: the seals and the bottom BG slide by (+56, −16) over 4 frames (`CapsuleGraphics_TaskStart`), so the capsule
sits at its edit position (circle centre (190, 70)); the seal list, the counts, the page arrows and the three buttons
fade in. Bottom-screen layout:

| Thing | Where (DS px) | Touch |
|---|---|---|
| Seal list: 8 per page, 2 columns × 4 rows | slot i at (19 + 56·(i % 2), 23 + 24·⌊i / 2⌋ − 1) | 16 × 16 box: x 8–24 / 64–80, y 16–32, 40–56, 64–80, 88–104 |
| Loose count per slot | 4 × 2-tile window at tile (3 or 10, 2 + 3·row), 3 digits, `TEXT_COLOR(1, 2, 0)`; empty slot filled with colour 0xEE | — |
| Page up / page down | (27, 124) / (67, 124) | ±(13, 10) around them |
| Test (throw) | (32, 171) | ±(16, 12) |
| CONFIRM / CANCEL (sprites with font-OAM labels, bank 8 #5, #6) | (104, 171) / (192, 171) | ±(28, 12) |
| The capsule | circle centre (190, 70), radius 60 | each placed seal: ±10 px around it while idle; the whole screen while dragged |
| The seal name | the top screen's message box (bank 12 `nameIndex`), while a seal is touched or dragged |

(The ROM's `CapsuleUIRects` holds 13 rects; `CapsuleGraphics_InitCapsuleUI` then overwrites rects 8–12 with the
sprite-centred ones in the table above.)

**The list** (`CapsuleGraphics_PopulateSealPage`): every seal id, in id order, that has a loose count > 0 or sits on
any of the 12 capsules; page p shows entries 8p … 8p + 7. Pages = ⌈unique / 8⌉, at most 10. Page up from 0 wraps to the
last; page down wraps to 0 (`SEQ_SE_DP_CUSTOM02` 1733). A seal whose loose count is 0 stays listed (with "0") while
any capsule uses it.

**Placing** (touch only on the DS; see §5.6 for keys):

1. Press a list slot: if the capsule already has 8 seals: "There's no more room!" (`CUSTOM06`); if the loose count is
   0: "There are no Seals left." (`CUSTOM06`); else a new seal appears at the touch point in the first free slot,
   drawn on top, its name shows, the loose count drops by 1 at once (`GiveOrTakeSeal −1`), `SEQ_SE_DP_BOX02` (1515),
   and it follows the stylus.
2. Press a placed seal: it comes to the front, its name shows, `BOX02`, and it follows the stylus.
3. While dragged: the seal's centre is the touch point (stored as u8 x, y); drawn translucent (OAM XLU) while more
   than 60 px from (190, 70) (`SealAnim_GetDistance`: integer √(dx² + dy²)).
4. Release: if more than 60 px away the seal goes back to the case (`GiveOrTakeSeal2 +1`, the counts redrawn) and its
   slot empties; else it stays where it is. `SEQ_SE_DP_BOX01` (1514) either way, the name cleared. No snapping, no
   grid: any pixel inside the circle.

Draw order: the last touched seal is in front (priority 0, the others pushed back). On save
(`SealPlacement_UpdateSeals`) the 8 slots are re-ordered front to back (slot 0 = front), empty slots last
((inferred) from the ascending sort on sprite priority).

**Buttons:**

- **CONFIRM** (`SEQ_SE_DP_PIRORIRO` 1506): "Finished editing the capsule.", save the capsule, the trainer score event
  6 (`TRAINER_SCORE_EVENT_UNK_06`, every CONFIRM), refresh the holder's copy, slide back to the selection.
- **CANCEL** (`DECIDE`): unchanged → leave. Changed → the screens dim, "Quit without changing the capsule design?" in a
  27 × 4 window at tile (2, 1) on the bottom screen and a touch YES/NO at tile (25, 6). YES: the capsule and **all
  loose counts** go back to how they were when EDIT started, then leave as CONFIRM does (message 12, score event).
  NO: back to editing.
- **Test** (`DECIDE`): "Confirming..."; the screens dim; the first non-Egg party Pokémon (or the holder, when the
  capsule has one) is thrown on the top screen as in a battle send-out (`BallThrow` type 1, mode SEND_OUT, that
  Pokémon's ball): when the ball opens, `SEQ_SE_DP_CUSTOM05` (1734), the seal effect (§6) with battler type 1 (the
  foe's spot), the front sprite at (192, 48 + y offset) grows by 0x20/256 a frame (8 frames); its cry animation plays;
  after the effect and the animation end, 30 frames, the ball takes it back (mode 5) while it shrinks; the screens
  undim. The test uses the capsule as it is on screen, on a copy of the Pokémon (nothing is saved). Frame by frame
  (`manager.c` THROW_* states, `ov12_02236F24`, `ov12_02237474`): the bottom screen dims to 10/16 two steps a frame
  (only the bottom screen: buffers SUB_BG palettes 0x80B and SUB_OBJ); the ball (type 1) sits still at (192, 86) for
  its 12-frame parabola, then plays animation 1 and opens on its 6th frame, its palette whitening 0 → 14 by 2 a frame,
  and ends 16 frames into the opening; the sprite grows 0x20 a frame from that frame; the ball's OBJ goes once it ends
  and the sprite is full size, then the front animation plays. The recall: the opening held on frames 0, 2 (2 frames
  each), the burst `ball_particle.narc` 36 (both emitters, `Unk_ov12_0223AE10` row 0xFF + 20) at (x − 190 + 61,
  70 − y + 30) · 172 from the ball, then frames 2, 1, 0 (6 frames each), until the burst ends; the sprite shrinks 0x20
  a frame. The 30-frame counter (`frameCounter`) is never reset while the app runs, so only the first Test after the
  app starts (and after SET, which restarts it) holds.

### 5.4 Coordinates

A seal's stored (x, y) is its centre on the bottom screen in edit position: the circle (190, 70) r 60, so x ∈ 130–250
and y ∈ 10–130 in practice. The selection view draws them at (x − 56, y + 16). The battle effect uses (x − 190,
70 − y + 30) (§6.3). Trainer capsules (`pl_cb_data`) use the same space; their empty slots are (0, 255, 255).

### 5.5 Graphics (`application/custom_ball/data/cb_data.narc`, 295 members)

Members 0–91 NANR, 92–183 NCER, 184–281 NCGR (LZ), 282–285 NSCR (LZ), 286–294 NCLR (plain).

| What | Screen | NCGR | NCLR | NCER | NANR | NSCR |
|---|---|---|---|---|---|---|
| BG main 2 (top background) | top | 268 | 288 (2 palettes) | | | 284 |
| BG main 3 | top | 269 | (288) | | | 285 |
| Capsules (12 sprites) | top | 266 | 286 | 174 | 82 | |
| Capsule cursor (×2) | top | 275 | 291 | 179 | 87 | |
| BG sub 1 (capsule backdrop, scrolled on EDIT) | bottom | 267 | 287 (2 palettes) | | | 283 |
| BG sub 3 | bottom | 267 | (287) | | | 282 |
| Bottom window palette (slot 11) | bottom | | 294 | | | |
| Placed seals | bottom | `memberIdx` (184–264) | 293 | 93 | 1 | |
| Seal list icons | bottom | `memberIdx` | 293 | 180 | 88 | |
| Page up / page down | bottom | 273 / 274 | 290 (3 palettes) | 177 / 178 | 85 / 86 | |
| Test button | bottom | 272 | 290 | 176 | 84 | |
| CONFIRM / CANCEL buttons | bottom | 270 | 290 | 175 | 83 | |
| Selection arrows (4, flipped corners at (136, 16), (136, 128), (240, 16), (240, 128)) | bottom | 265 | 290 | 173 | 81 | |

The seal NCGRs are 288 bytes of tiles (9 tiles: (inferred) 24 × 24 px cells). Button cells: frame 0 up, 1 pressed,
2 held. Party icons: `poketool/icongra/pl_poke_icon.narc`. Windows and font: the player's frame
(`pl_winframe`), `pl_font` palette 7.

### 5.6 Keyboard and touch in OpenSinnoh

The DS edits capsules by touch only (§5.3); the D-pad works only for capsule selection, the menus and SHIFT. OpenSinnoh
needs a keyboard path for the editor (a design choice, not in the ROM): for example a cursor over the list, page
arrows and buttons, A on a seal picks it up, the D-pad moves a held seal (1 px, faster when held) inside the screen,
A drops it, B drops it off (back to the case). Pointer input maps 1:1 onto the DS rules above.
The memory note "no split DS screens" applies: compose the top screen (capsules, preview) and the bottom screen
(editor) in one layout.

## 6. The send-out effect

### 6.1 What plays (`src/battle_anim/ov12_02235E94.c`, `ov12_02237E54.c`)

`BallCapsuleConfig { battlerType, ballTypeOverride, mon }` → `ov12_02236004` (`BallCapsuleSealEffect`):

- **No capsule** (id 0): the ball's default burst: `ball_particle.narc` member `sBallOpen[ball − 1][0]` with emitters
  0 … `[1] − 1`, all at the battler's anchor (`Unk_ov12_0223AD70`, 20 rows {SPA, emitter count}: the 17 balls, two
  unused rows (mud, bait), and 0xFF + 20 → SPA 36, 2 emitters). The ball comes from `ballTypeOverride` (the switch-in
  passes the captured ball) or the Pokémon's `MON_DATA_POKEBALL`.
- **A capsule** (id ≠ 0): **no ball burst**; for each slot 0 … 7 of the copy with a type in 1–80, one particle system:
  `ball_particle.narc` member `particleIndex` (every seal SPA has 1 emitter and 1 texture), emitter 0. The systems
  load over 4 frames (two slots a frame) before the ball may open.

All systems use the orthographic camera (`ParticleSystem_SetCameraProjection(…, 1)`).

### 6.2 Timing (`battle/battle_display.c` `Task_ShowEncounter` `:1975`, `Task_ShowPokemon` `:2224`)

1. When the send-out starts, the effect is created and its systems load.
2. The ball flies (`BallRotation`). The frame it opens (`ov12_02237810` = TRUE), and only once the systems have
   loaded: the Pokémon's sprite appears at scale 0 with the ball's fade colour, the effect starts
   (`ov12_022363B4`), and `SEQ_SE_DP_SLOT01_sseq_1` plays panned right (a foe, front sprite) or left (the player's).
   The same sound for every ball and with or without seals; (inferred) it is SDAT sequence 1798 `SEQ_SE_DP_BOWA2`
   (the second sequence on `SEQ_SE_DP_SLOT01.sseq`, bank `BANK_SE_BATTLE`), not 1744 `SEQ_SE_DP_SLOT01`.
   At a battle's start (`Task_ShowEncounter`), the player's second Pokémon in a double waits 12 more frames.
3. Each seal's emitter is created after a delay from the open (`ov12_02237EA0`, table `{0, 8, 14, 20, 20, 16, 16}`):
   an alphabet seal waits 8 frames; another seal at distance d from (190, 70): d ≥ 56 → 20; else index
   ⌊(d + 1) / 20⌋ (capped at 3) → 0 (d < 19), 8 (19–38), 14 (39–55). So the centre fires first and the rim last.
4. The Pokémon grows to full size; its cry and its animation start only when it is full size **and** every seal
   system has finished (no active emitters); then the systems are freed.

### 6.3 Where (`ov12_02236520`, `ov12_022365D4`)

Anchor = `BattleAnimUtil_GetBattlerTypeWorldPos(type, …, contest FALSE, ORTHOGRAPHIC)` minus
(172·(10 + ax), 172·(32 + ay), 0) with (ax, ay) per battler type: 0 (0, −16), 1 (−15, −25), 2 (−8, −12),
3 (−14, −25), 4 (−8, −12), 5 (−16, −29). Seal emitter = anchor + (172·(x − 190), 172·(70 − y + 30), 0). Values are
fx32 (4096 = 1). With the orthographic camera 172 fx32 ≈ 1 DS px (menus `particles.ts`: 24 px per unit), so the
capsule's layout is reproduced at screen scale around a point 30 px above the anchor, y flipped to "up". Alphabet and
other seals use the same formula. The default burst uses the anchor.

### 6.4 Where it plays

| Context | Seals? | Source |
|---|---|---|
| Any battle send-out (start of battle and switch-ins), both sides, wild and trainer | yes, whenever the sent-out Pokémon has a capsule; wild Pokémon have none | `Task_ShowEncounter`, `Task_ShowPokemon` |
| NPC trainers' Pokémon with `cbSeal` | yes (`pl_cb_data`) | §2.2 |
| Battle Frontier | (inferred) yes for the player's party (the party is used as is); the facility's trainers have no capsules | — |
| Battle Video playback | no (ids cleared) | §2.2 |
| Wild encounter appearance (no ball) | no (`Task_SetEncounter` has no ball) | — |
| Super Contest, Visual round judging: each entrant's photo pops in from a ball (`ov17_02247A48.c` `ov17_022489C8`) | yes for a capsule (the NPCs have none); the no-capsule burst is placed at (0, 0, 0); (inferred) the seals still use the battler-type-0 anchor (the capsule path ignores the contest's position callback) | `src/overlay017/ov17_02247A48.c:941` |
| The editor's test | yes, battler type 1 | §5.3 |

### 6.5 The OpenSinnoh seam

- **Where:** `packages/battle/src/controller.ts`, `sendOut()` (player side) and `foeSendOut()` → `appear()` (foe
  side): the first frame of the white-flash loop (`scale = 1/8`) is the DS's "ball opens" frame. Start the effect
  there for each side being sent out (one per battler, its battler type from the slot), play the ball-open SE there,
  and before `onSwitchIn` (where the cry and animation would go) wait until the effect has no active emitters.
- **What runs it:** the battle's own SPL (`packages/battle/src/anim/spl.ts` `ParticleManager`, `ParticleCamera`, as
  the move animations' `AnimVm` uses it), one manager per seal, emitter 0 created after its delay with its position
  set in the create callback (`createEmitter(0, (e) => …)`), `update()` once a tick, drawn into `AnimParticle[]`.
  World positions: the existing `battleAnimData.positions[type][0][1]` (kind 0, orthographic), as `AnimVm.typePos`.
- **How it reaches the screen:** the controller's view already carries `anim: AnimView | null` with `particles`,
  drawn by `packages/app/src/battle/scene.ts` (`this.particles.draw(ctx, view.anim.particles, …)`) over the battlers
  and under the healthboxes. A send-out is not a move animation, so add a field (for example
  `BattleView.sendOutParticles: AnimParticle[]`) drawn the same way: a contract change.
- **Data:** `ball_particle.narc` SPAs (members 37–116 for the seals; 0–17 and 36 for the default bursts if those are
  done too) imported as `ParticleSystem` records. Their member numbers collide with `waza_particle.narc`'s
  `sourceIndex`, so they need their own ids or a source field (`AnimVm.particleSystem` looks records up by
  `sourceIndex`). The seal table (§3.2) gives `particleIndex`; the Pokémon gives the capsule copy.
- The battle needs the capsule copy on the battle's Pokémon (`BattleDeps` party, and the NPC trainer's built from
  `ballSeal` and the imported `pl_cb_data` capsules).

## 7. What to build (inferred plan)

1. **Importer** (bump `IMPORTER_VERSION`): the seal table, the seal marts (pointer table, then each `0xFFFF`-ended
   list, as `martSpecialties` in `pokemon-data.ts`), the trainer capsules (`pl_cb_data` member 0, 128 × 24 B), the
   seal SPAs and default-burst SPAs, the delay table, the `cb_data` art as `ui2d` sheets (cells per §5.5), the text
   banks (most already in the pack).
2. **Contracts/core** (bump `CONTRACTS_VERSION`): a seal record (name, plural, description, price, alphabet, particle,
   sheet cell), the trainer capsules, `Pokemon.capsule: { id: number; seals: {seal, x, y}[] } | null` (party only),
   `GameState.sealCase { counts: number[80]; capsules: {seal, x, y}[][] }` (save schema v21 with a migration: empty
   case, no capsules). Box deposit must refuse a Pokémon with a capsule.
3. **Services:** the §2.1 rules (headless, unit-tested), the capsule ↔ Pokémon rules (§2.2), the Solaceon and shop
   logic through the script ops.
4. **VM:** the five ops (§4.4); `poke_mart_seal` opens the mart app with a seal currency/stock variant (`apps.ts`
   `{ app: 'mart'; … currency?: 'bp' }` already varies by currency; seals change the inventory side).
5. **Menus/app:** the editor screens (§5), the party menu's capsule marker (cell 2 at the item marker + 8 px) and the
   BALL_SEAL, Day-Care and NPC-trade detach prompts, the PC refusal.
6. **Battle:** the send-out effect at the seam (§6.5); the editor's test can share it.

## 8. Sounds

| SE | SDAT | Where |
|---|---|---|
| `SE_CONFIRM` | 1500 | capsule cursor, A on a capsule, SHIFT cursor and swap |
| `SEQ_SE_DP_DECIDE` | 1501 | B out, Test, CANCEL, SHIFT cancel |
| `SEQ_SE_DP_CUSTOM02` | 1733 | seal page up/down |
| `SEQ_SE_DP_PIRORIRO` | 1506 | CONFIRM |
| `SEQ_SE_DP_CUSTOM06` | 1522 | "no more room", "no Seals left", an Egg in the BALL_SEAL party menu |
| `SEQ_SE_DP_BOX02` | 1515 | a seal picked up (from the list or the capsule) |
| `SEQ_SE_DP_BOX01` | 1514 | a seal dropped |
| `SEQ_SE_DP_CUSTOM05` | 1734 | the test Pokémon comes out |
| `SEQ_SE_DP_SLOT01_sseq_1` | (inferred) 1798 | the battle ball opening (§6.2) |

(Field-sounds note `field-sounds.md` lists the editor's SE call sites too.)

## 9. ROM tables

In the shape of `TABLES` in `packages/importer/src/platinum.ts`, read from the US ROM (SHA-1 checked). Offsets are
into the decompressed module: RAM address − the module's base (arm9 0x02000000; overlay 12 `battle_anim`
0x0221FC20; overlay 76 `capsule_menu` 0x0223B140). The Platinum US overlays are stored uncompressed.

```ts
/** capsule_menu/main.c sealTypeValues (RAM 0x020F64D0): per seal id 0–80, §3.2. */
sealTypes: { where: 'arm9', offset: 0xf64d0, count: 81, size: 10, sha1: 'b722c8b73768aadb1bd5caba5a8c3477a9c43978' },
/** mart_items.h SunyshoreMarketDailyStocks (RAM 0x02100B00): a pointer per MART_SEAL_ID_SUNYSHORE_* (Monday … Sunday)
 * to a 0xFFFF-ended u16 seal id list; read the lists through the pointers (another list sits between them). */
sealMarts: { where: 'arm9', offset: 0x100b00, count: 7, size: 4, sha1: '8c6bc435bd5fe5d257264b242e39f1dbeeb48252' },
/** ov12_02235E94.c Unk_ov12_0223AD70: the default ball-open burst per ball, {ball_particle member, emitter count} (s32 each). */
ballOpenParticles: { where: 12, offset: 0x1b150, count: 20, size: 8, sha1: 'ac2a9cc8d2e6ea4be7263237a5e198d19779bb93' },
/** ov12_02237E54.c ov12_02237EA0's delay table (RAM 0x0223B040): a seal emitter's start delay in frames by distance step. */
sealDelays: { where: 12, offset: 0x1b420, count: 7, size: 1, sha1: 'f5af31e595e4a5912f406ed78354562d53375f26' },
/** capsule_menu/manager.c CapsuleUIRects (RAM 0x0223EE44): {top, bottom, left, right} u8; 8–12 are replaced at run time (§5.3). */
capsuleTouchRects: { where: 76, offset: 0x3d04, count: 13, size: 4, sha1: '94a6338313ed6e22b359f858c1ad724dc55c0505' },
/** graphics.c CapsuleGraphics_InitPageSprites initialXY (RAM 0x0223ED3C): the seal list's 8 icon positions, s16 x, y. */
capsulePageXY: { where: 76, offset: 0x3bfc, count: 8, size: 4, sha1: '19c0422eccf6bb5c98a37e04b108975183fc4c9a' },
/** graphics.c CapsuleGraphics_InitCapsuleUI xyPos (RAM 0x0223ED8C): s16 x, y; rows 8–12 are the arrows and buttons. */
capsuleUiXY: { where: 76, offset: 0x3c4c, count: 13, size: 4, sha1: 'b00031d96473e51773dc58e9c731ba36f069e56c' },
```

The last three are layout constants: reading them is optional (the numbers are in §5.3). The SunyshoreMarket lists as
read through the pointers match §4.2. The pointer table ends where `martSpecialties` (0x100b1c) begins.

Files (no table entry; check by content):

| File | What | Check |
|---|---|---|
| `/application/custom_ball/edit/pl_cb_data.narc` | 1 member: 128 trainer capsules × 24 B (`BallCapsule`) | member 0 SHA-1 `253ba2bd4b900bdd9b42c4f237ad3ec87efee069` |
| `/application/custom_ball/data/cb_data.narc` | 295 members (§5.5) | — |
| `/wazaeffect/effectdata/ball_particle.narc` | 117 SPA files: 0–17 and 36 the default bursts, 19–35 the catch stars, 37–116 the seals (1 emitter, 1 texture each) | — |

Code constants (no table): the battler-type offsets (§6.3), the circle (190, 70) r 60, the drag rect ±10, the grid
formula, the capsule menu layouts, the Test sprite position (192, 48), the 30-frame hold.

## 10. Open questions

- The ball-open SE: confirm `SEQ_SE_DP_SLOT01_sseq_1` is SDAT 1798 (`SEQ_SE_DP_BOWA2`) and not 1744 by listening or by
  the build's sequence list. OpenSinnoh plays no ball-open SE today.
- The default (no-capsule) ball burst is also missing in OpenSinnoh's send-out; the same seam would add it (table
  `ballOpenParticles`). Do it with the seals or separately?
- Slot order after save (§5.3, front-to-back) is read from the sort; it changes which seal loads first and the TV
  segment's seal, nothing visible in battle.
- The contest visual round's capsule anchor (§6.4) is inferred from the code path; the stage might put the photo
  somewhere the battler-type-0 anchor does not fit. OpenSinnoh's visual round has no ball pop-in yet.
- The editor's keyboard scheme (§5.6) is ours to design; the DS has none.
- Sharing the SPL (built): the menus reach the battle's SPL and `SendOutEffect` through `@opensinnoh/battle/particles`
  (as the Frontier scenes do); the editor's Test steps them headless in the menu model (`menus/capsule-test.ts`) and the
  app draws the particles with the battle's `ParticleTextures`.
- Frontier: (inferred) the player's capsules show there; not checked in the frontier code.

## 11. What is built

- **Importer.** `NewGame.seals` (importer `seals.ts`): the seal table (`sealTypes`), the Sunyshore stock per weekday
  through `sealMarts`' pointers, `pl_cb_data` member 0 as `trainerCapsules` (empty slots dropped), `sealDelays`. The
  editor's art (`ui2d/seals.ts`): `capsule/main2`, `main3`, `sub1`, `sub3`, `capsules`, `cursor`, `page_up`,
  `page_down`, `test`, `button`, `arrows` (each sprite with its template's explicit palette) and `capsule/seals` (one
  cell per NCGR 184–264, NCER 93); `shop/panel_seal` (tilemap_no_item).
- **Rules** (services `seals.ts`): owned, give/take, the editor's drop-off (`returnSeal`), unique and total counts, the
  list, the circle, SET/REMOVE/SHIFT/CONFIRM on party Pokémon, detach, the seal mart's purchase (money,
  RECORD_MONEY_SPENT 35). Contracts `trainerCapsule` for the battle.
- **Script ops** (vm `seal-ops.ts`): the five ops, `real: 'seals'`. The Solaceon mother and Unown boy and the
  Sunyshore merchant run through them; the PC's BALL CAPSULES opens the editor.
- **Menus.** The seal mart (`seal-mart.ts`, `MartView.seals`), the capsule editor (`capsule-editor.ts`), the party's
  `ball-seal` and `trade` modes, the Day-Care STORE and trade detach prompt, the PC's refusals (deposit and move out:
  mail, then capsule, checked at STORE before the box is chosen; release), the Bag's "Seals: N", the party's capsule
  marker (`party/held` cell 2).
- **Battle.** NPC trainers' Pokémon with `ballSeal` n carry `{ id: 1, seals: trainerCapsules[n − 1] }`.
- **Save.** `GameState.sealCase` and `Pokemon.capsule` in schema v22 (migration: an empty case). Boxed and Day-Care
  Pokémon may not hold a capsule; no two party Pokémon share one.
- **Screen.** One board: the DS screen (grid, editor or Test) and a 48 px strip under it, in the art's bottom colour,
  for the message box the DS shows on the other screen. Keys: a hand over the list, arrows, buttons and placed seals
  (the D-pad jumps to the nearest in that direction); A presses (a list seal comes out at the capsule's centre); a held
  seal moves 1 px a tick (2 after 8, 4 after 24); A drops, B puts it back; otherwise B is CANCEL, L/R the pages,
  START CONFIRM, SELECT Test.
- **Test** (menus `capsule-test.ts`): the editor dims, the board shows the top screen: the ball (`battle/ball_throws`)
  opens at (192, 86), the copy grows out at (192, 48) with SE 1734 and the battle's `SendOutEffect` (battler type 1, on
  its own SPL stream), its front animation, the 30-frame hold (first Test only, as the DS), the recall with burst 36,
  then the editor undims. Its length comes from the simulation; input waits.
- **Not built.** The selection screen does not preview the current capsule's design (the DS's bottom screen). No TV Seal
  Club segment (TV is a stub). Mystery Gift has no seal gift hook. Link trade and GTS capsule clearing are out of scope.
