# Town extras: the Villa, the journal, the diplomas, small NPC rules

2026-10-23. What the Villa (Resort Area), the journal, the two diplomas and the remaining stubbed town/NPC script
commands do on the DS, precisely enough to build them, with the ROM tables they need (verified on the US ROM).

Source: pret/pokeplatinum (local `reference-projects/pokeplatinum`), for names, offsets and understanding only;
paths are relative to its root. "Frame" is one 30 Hz tick. **(inferred)** marks what was reasoned, not read. Flag
and var numbers are the decomp's (`packages/importer/data/names.json` agrees). SDAT sequence numbers are indexes in
`res/sound/pl_sound_data.json` `seqInfo` (as in contests.md).

## 1. The Villa

### 1.1 Getting it (free)

The Villa is not bought. Sources: `res/field/scripts/scripts_resort_area.s`, `events_resort_area.json`.

- Resort Area coord event (script 8) at x 815, z 472–474 (1 × 3 strip west of the Villa), active while
  `VAR_RESORT_AREA_STATE` (0x40C8) = 0. The School Kid M (local id SCHOOL_KID_M, hidden by
  `FLAG_HIDE_RESORT_AREA_SCHOOL_KID_M`) walks to the player's row (`get_player_map_pos`, z 472/473/474 pick the
  movement), offers the Villa (yes/no).
- No: a refusal message, both step back west; nothing changes, the strip triggers again.
- Yes: `save_tv_segment_home_and_manor_no_furniture` (TV, no-op for us), both walk to the door, the door animation
  (`load_door_animation 25, 14, 22, 21`), both enter, `remove_object` the kid, `VAR_RESORT_AREA_STATE` = 1,
  `VAR_RESORT_VILLA_VISITOR` = 0xFF (none), warp to MAP_HEADER_VILLA (10, 6) facing west.
- No precondition beyond reaching the Resort Area (the Battle Zone, post-game).

Inside, `scripts_init_villa.s`: onTransition = script 1, and an onFrame row `VAR_VILLA_STATE` (0x40A1) = 0 → script
41 (`Villa_OnFrame_FirstEntry`).

- First entry: `VAR_VILLA_STATE` = 1, money window (`show_money 21, 1`), a message, a one-entry list menu "Table
  (free)" (value 0). Picking it buys the Table (§1.3 purchase sequence, price 0) and delivers it; B shows "order a
  Table" and ends (the kid in the Villa, object script 42, repeats the same offer on talk).
- While `VAR_VILLA_STATE` = 1 a coord event (script 43) at (11, 11), the doormat, stops the player ("don't go yet"),
  the kid turns south, the player walks one tile north.
- The free Table's delivery (`Villa_DeliverFreeTable`): delivery guy message, fade, remove the delivery guy, kid
  and player face each other, kid's goodbye, fade, remove the kid, then the Table's visitor (the rival, §1.5),
  `VAR_VILLA_STATE` = 2.

### 1.2 The furniture catalogue

Bought from the **order form** (script 44), three bg events around the Table at (11, 7), (13, 7), (12, 8) (any
facing). A `BOOK` object (local id BOOK, `FLAG_HIDE_VILLA_BOOK`) lies on the Table at (12, 7) and a delivery guy
(`OBJ_EVENT_GFX_POKEMON_BREEDER_M`, `FLAG_HIDE_VILLA_DELIVERY_GUY`) at (10, 8); both flags are set by the new-game
script and cleared by each order.

One flag per piece: `FLAG_VILLA_FURNITURE_START` = 0x997 + type (`SystemFlag_HandleOwnsVillaFurniture`). No other
save data: the Villa's `PersistedMapFeatures` buffer is a dummy int, zeroed by `InitPersistedMapFeaturesForVilla`.

| Type | Piece | Flag | Price | Shown in the list when | Model (build_model) | Talk script |
|---|---|---|---|---|---|---|
| 0 | Table | 0x997 | 0 | always | 559 | 21: description |
| 1 | Big Sofa | 0x998 | 120,000 | always | 560 | 22: description |
| 2 | Small Sofa | 0x999 | 90,000 | always | 561 | 23: description |
| 3 | Bed | 0x99A | 187,000 | always | 562 | 24: description (no healing) |
| 4 | Night Table | 0x99B | 58,000 | always | 563 | 25: description |
| 5 | TV | 0x99C | 220,000 | always | 564 | common TV script 10100 (SCRIPT_ID_OFFSET_TV_BROADCAST), only facing north |
| 6 | Audio System | 0x99D | 160,000 | always | 565 | 27: `play_music` SEQ_PL_AUDIO (1198), description |
| 7 | Bookshelf | 0x99E | 150,000 | always | 566 | 28: description |
| 8 | Rack | 0x99F | 127,000 | always | 567 | 29: the music box if owned, else description |
| 9 | Houseplant | 0x9A0 | 120,000 | always | 568 | 30: description |
| 10 | PC Desk | 0x9A1 | 168,000 | always | 569 | 31: description (player name buffered) |
| 11 | Music Box | 0x9A2 | 25,300 | Rack owned | 570 | none (no collision; played through the Rack) |
| 12 | Pokémon Bust | 0x9A3 | 150,000 | ≥ 1 win in each of the 5 Frontier facilities | 571 | 33: description |
| 13 | Pokémon Bust (silver) | 0x9A4 | 150,000 | a Frontier print state ≥ 2 | 572 | 34: description |
| 14 | Piano | 0x9A5 | 146,700 | Hall of Fame entries ≥ 10 | 573 | 35: `play_music` SEQ_PL_PIANO (1197), description |
| 15 | Guest Set | 0x9A6 | 208,000 | Battleground battles ≥ 50 | 574 | 36: description |
| 16 | Wall Clock | 0x9A7 | 52,000 | berries planted ≥ 50 | 575 | none |
| 17 | Masterpiece | 0x9A8 | 140,000 | eggs hatched ≥ 30 | 576 | none |
| 18 | Tea Set | 0x9A9 | 108,000 | Guest Set owned | 577 | none |
| 19 | Chandelier | 0x9AA | 120,000 | steps ≥ 300,000 | 578 | none |

Talk scripts are the Villa script file's entries (1-based, `sVillaFurnitureScriptIDs`); 26 (`Villa_Furniture_TVDummy`)
is never used. Descriptions: `TEXT_BANK_VILLA` (602) messages 99 + type. Names: list entries "…Available" / "…SoldOut"
in the same bank (149 onward), the price buffered by `buffer_value_padding_digits 0, price, spaces, 6`;
`TEXT_BANK_VILLA_FURNITURE_NAMES` (603) holds plain names (used by no C code the decomp names; the TV segment
(inferred)).

`check_met_furniture_requirements furniture+1, var` (ScrCmd_CheckMetFurnitureRequirements, ov5_021F6454.c) — the
script passes type + 1 and the switch matches type + 1; result TRUE unless:

- Bust (13): FALSE if any of RECORD_BATTLE_TOWER_VICTORIES (record 29), FACTORY (60), CASTLE (61), HALL (62),
  ARCADE (63) is < 1.
- Silver Bust (14): FALSE unless one of the five `VAR_BATTLE_*_PRINT_STATE` ≥ 2 (states: 1 silver earned, 2 silver
  received, 3 gold earned, 4 gold received).
- Piano (15): RECORD_TIMES_ENTERED_HALL_OF_FAME (73) < 10. Guest Set (16): RECORD_TIMES_BATTLED_AT_BATTLEGROUND (57)
  < 50. Wall Clock (17): RECORD_BERRIES_PLANTED (4) < 50. Masterpiece (18): RECORD_EGGS_HATCHED (11) < 30.
  Chandelier (20): RECORD_STEPS (0) < 300,000.
- Any other value: TRUE.

### 1.3 The order form (script 44, `Villa_OrderForm`)

1. `show_money 21, 1`; "PLAYER opened the order form."; if every flag is set, "list of purchased furniture", else
   "which furniture?".
2. `init_local_text_list_menu 1, 1, 0, VAR_0x8002`, 20 entry calls in type order (gated entries skipped),
   `show_list_menu_set_width 18` (width in tiles; ScrCmd_ShowListMenuSetWidth = `show_list_menu` with a width).
   Owned pieces stay in the list as "sold out" entries with the same value.
3. B (−2): close, hide money. A sold-out piece: "You've already bought one." Otherwise "Order the chosen furniture?"
   yes/no; `check_money` against the price; short: "not enough money".
4. Purchase (`Villa_BuyFurniture`): SE `SEQ_SE_DP_REGI` (1604), `add_to_game_record_big_value RECORD_MONEY_SPENT
   (35), price`, `remove_money price`, set the flag, `update_money_display`, wait the SE, hide money,
   `save_tv_segment_home_and_manor VAR_0x8002` (TV).
5. Delivery (`Villa_WarpAndShowDeliveryGuyAndBook`): clear the delivery guy and book hide flags, fade, **warp to
   the Villa itself** at (10, 6) facing south (this reload is what makes the new piece appear: props are only
   built at map load, §1.4), fade in.
6. Not the Table: if all 20 are now owned, `increment_trainer_score TRAINER_SCORE_EVENT_BOUGHT_ALL_VILLA_FURNITURE`
   and the "we're out of furniture" variant, else the plain delivery message; fade, remove the delivery guy, then
   the piece's visitor (§1.5), fade in, the visitor walks in.

No purchase-order rule beyond the gates: any order of the always-available eleven, Music Box after Rack, Tea Set
after Guest Set.

### 1.4 How furniture appears (dynamic map features)

`src/overlay005/villa_furniture.c`, `src/dynamic_map_features.c`, `src/persisted_map_features_init.c`:

- The Villa's onTransition runs `init_persisted_map_features_for_villa` (selects the VILLA slot, clears it).
  Every map load with that slot runs `Villa_DynamicMapFeaturesInit`: for each owned type, every row of
  `sVillaFurnitures` with that type loads one prop (`MapPropManager_LoadOne`, model from
  `sVillaFurnitureModelIDs`, rotation 0). Nothing changes mid-visit; a purchase reloads the map (§1.3 step 5).
- Collision (`Villa_DynamicMapFeaturesCheckCollision`, the player's DynamicMapFeatures_CheckCollision hook): a tile
  is blocked when a row with `isCollisionEnabled` and an owned type has the tile inside its inclusive box.
- Talking (`FieldSystem_TrySetVillaFurnitureScript`, field_control.c): the last check of an A press, after objects,
  bg events, honey trees and tile behaviours, only while the persisted features are the Villa's: the faced tile
  (Field_Step) inside a collidable owned row's box starts that type's script; the TV row is skipped unless the
  player faces north. Rows without collision (music box, wall clock, masterpiece, tea set, chandelier) have no talk.

`sVillaFurnitures` (23 rows; positions in world units = fx32 / 4096, a tile is 16; c = tile centre ×16 + 8, e = tile
edge ×16; y always 0):

| Row | Type | x | z | Collision box (left, top, right, bottom tiles) |
|---|---|---|---|---|
| 0 | Table | c12 | e7 | 11, 5, 13, 8 |
| 1 | Big Sofa | e15 | e7 | 14, 5, 15, 8 |
| 2 | Small Sofa | c13 | c10 | 11, 9, 13, 10 |
| 3 | Bed | c18 | e8 | 18, 6, 20, 9 |
| 4 | Night Table | c20 | c7 | 17, 6, 17, 7 |
| 5 | TV | e12 | c3 | 11, 3, 12, 3 |
| 6 | Audio System | c14 | c3 | 13, 3, 15, 3 |
| 7 | Bookshelf | e17 | c3 | 16, 3, 17, 3 |
| 8 | Rack | e19 | c3 | 18, 3, 19, 3 |
| 9–12 | Houseplant ×4 | c1/c20 at c3, c1/c20 at c11 | | one tile each: (1,3) (20,3) (1,11) (20,11) |
| 13 | PC Desk | e2 | c8 | 1, 7, 2, 9 |
| 14 | Music Box | c18 | c3 | none |
| 15 | Bust | c2 | c3 | 2, 3, 2, 3 |
| 16 | Silver Bust | c6 | c3 | 6, 3, 6, 3 |
| 17 | Piano | c2 | c5 | 1, 4, 2, 6 |
| 18 | Guest Set | e6 | e10 | 4, 9, 7, 10 |
| 19 | Wall Clock | c11 | c1 | none |
| 20 | Masterpiece | c8 | c1 | none |
| 21 | Tea Set | c6 | c10 | none |
| 22 | Chandelier | c7 | c6 | none |

(The night table's box 17,6–17,7 sits west of its model at x c20, as in the ROM.) The furniture blocks only the
player (NPC wanderers are not checked by this hook (inferred)).

**OpenSinnoh mapping.** This is a `MapFeature` (packages/world/src/gyms/feature.ts) like the gyms':
`MapFeatures` gets a `{ kind: 'villa' }` slot (no fields; contracts `gyms.ts`, a contract bump), built on each map
load from the flags; `blocks(x, z)` answers the boxes; `view()` returns one `FeatureModelView` per loaded row
(`prop: platinum:prop/<559+type>`, position from the table, rotation 0). Talking needs one new hook on
`MapFeature` (an interact after the bg events and tile behaviours, given the faced tile and facing, returning the
script to start), which field_control's order above places. All 20 models are imported already (build_model members
559–578, `models/build/<n>.gltf`). Hiding props by flag on the zone's chunk does not fit: the furniture is not in
the Villa's land data.

### 1.5 The visitors

Constants `include/constants/villa_visitors.h`; state `VAR_RESORT_VILLA_VISITOR` (0x404E; 0xFF none),
`VAR_RESORT_VILLA_VISITOR_MESSAGE_NUM` (0x405A, 0–4), `FLAG_VILLA_VISITOR_INSIDE` (0x9AB), `FLAG_VILLA_VISITOR_OUTSIDE`
(0x9AC).

| Id | Visitor | Where they appear | Villa object (local id, hide flag) |
|---|---|---|---|
| 0 | Rival | in the Villa | RIVAL, 0x2A7, wanders W–E at (4, 3) |
| 1 | Counterpart (Dawn/Lucas by player gender, `VAR_OBJ_GFX_ID_1`) | in the Villa | COUNTERPART, 0x2A8, (7, 6) |
| 2 | Prof. Rowan | outside first (Resort Area), invited in | PROF_ROWAN, 0x2A9, (17, 4) |
| 3 | Mom | in the Villa | MOM, 0x2AB, (11, 4) |
| 4 | Roark | outside first | ROARK, 0x2AC, (18, 10) |
| 5 | Gardenia | outside first | GARDENIA, 0x2AE, wanders at (8, 6) |
| 6 | Fantina | knocks: enters when the player steps on (10, 7) | FANTINA, 0x2B0 |
| 7 | Maylene | outside first | MAYLENE, 0x2B1, (9, 6) |
| 8 | Crasher Wake | knocks | CRASHER_WAKE, 0x2B3 |
| 9 | Byron | outside first | BYRON, 0x2B4, wanders at (9, 11) |
| 10 | Candice | knocks | CANDICE, 0x2B6 |
| 11 | Volkner | in the Villa | VOLKNER, 0x2B7, (13, 4) |
| 12 | Cynthia | knocks | CYNTHIA, 0x2B8 |
| 13 | Flint and Volkner | in the Villa | FLINT 0x2B9 (14, 4) + VOLKNER |
| 14 | Maylene and Candice | in the Villa, moved to (6, 8) and (7, 8) | MAYLENE + CANDICE |

**Daily choice** (`SystemVars_UpdateVillaVisitor`, system_vars.c), run by FieldSystem_HandleDailyEvents (after the
daily random level), only when the player's saved map is neither the Resort Area nor the Villa:

1. Clear both visitor flags.
2. Count owned pieces n. Index 0 if n < 8, 1 if 8 ≤ n < 12, 2 if n ≥ 12.
3. `LCRNG_Next() % 100`; if it is **greater than** the chance (25, 75, 90 by index) → visitor 0xFF. So the odds are
   26 %, 76 %, 91 %.
4. Else visitor = `LCRNG_Next() % count` with count 4, 12, 15 by index (ids 0–3; 0–11; 0–14).
5. Always: message number = `LCRNG_Next() % 5`.

LCRNG_Next is the game's main LCRNG (OpenSinnoh's `nextFieldRandom`, as `initDailyLevel` uses (inferred)); the hook
goes after `initDailyLevel` in core `dailyEvents` (field-systems.ts), and game-time.ts's
`clock:daily-events` stub loses "villa".

**Showing them.** Villa onTransition (script 1): set counterpart gfx; if `FLAG_VILLA_VISITOR_OUTSIDE` is set, end
(the knocker already inside stays as the hide flags left them); else set all 14 visitor hide flags, and if a visitor
is chosen copy it to `VAR_MAP_LOCAL_0x0F` and clear the matching hide flag: rival, counterpart, mom, Volkner,
Flint+Volkner, Maylene+Candice always; Rowan, Roark, Gardenia, Maylene, Byron only with `FLAG_VILLA_VISITOR_INSIDE`;
the four knockers never here.

- Knockers: Villa coord events at (10, 7), on `VAR_MAP_LOCAL_0x0F` = 6 (script 17 Fantina), 8 (18 Wake), 10 (19
  Candice), 12 (20 Cynthia): door SE (`SEQ_SE_DP_DOOR_OPEN` 1541), place the visitor at (11, 11) facing north,
  `add_object`, walk in, the player turns to watch, `FLAG_VILLA_VISITOR_OUTSIDE` set, local var 0.
- Outside visitors: Resort Area onTransition (script 14) hides the five outside NPCs, then, if a visitor is chosen,
  `VAR_RESORT_AREA_STATE` ≠ 0 and not `FLAG_VILLA_VISITOR_INSIDE`, shows Rowan/Roark/Gardenia/Maylene/Byron (the
  matching one) by the Villa (x 821–823, z 472–474). Talking: yes/no "visit your Villa?"; yes → hide them outside,
  set the visitor var, `FLAG_VILLA_VISITOR_INSIDE`, warp to the Villa (11, 11) facing north; no → a decline message.
- Talk in the Villa: SE_CONFIRM, face player, one of five messages by `VAR_RESORT_VILLA_VISITOR_MESSAGE_NUM`
  (bank 602 messages 15–96, by visitor; the counterpart picks Dawn's or Lucas's by player gender). The pairs play
  turn-to-each-other movements first. Maylene and Candice's message 4 needs the Tea Set (else message 0). Nobody
  gives items.

**Furniture visitors** (on delivery, `Villa_TryAddFurnitureVisitor` / `TryEnterFurnitureVisitor`): Table → rival,
Small Sofa → counterpart, Bookshelf → Rowan, Houseplant → Gardenia, Piano → Cynthia. The current visitor is removed
(the outside ones hide the five Resort Area NPCs instead), the new one is placed at the door (11, 11) or, when it is
already today's visitor inside, at (10, 8), walks in (west 1, north 3), says its entry line (bank 602, 9–14) and
becomes today's visitor (`FLAG_VILLA_VISITOR_INSIDE`; Cynthia also `FLAG_VILLA_VISITOR_OUTSIDE` and local var 0).
The rival instead leaves (south 3, east 1, stairs SE `SEQ_SE_DP_KAIDAN2` 1539, removed) and the visitor becomes
none.

### 1.6 Furniture interactions

- No healing anywhere (the Bed only describes itself).
- TV: the common TV broadcast script (TV, out of this lane; facing north only).
- Audio System, Piano: `play_music` (Sound_PlayBGM) of a short field-bank sequence, then the description.
- Music Box (via the Rack once owned): `get_current_bgm` into 0x8004; `set_scene_play_bgm_music_box`
  (Sound_SetSceneAndPlayBGM(SOUND_SCENE_VILLA_MUSIC_BOX, SEQ_PL_TOWN02 1218): a cutscene-style BGM); then a loop of
  `wait_time 1`, `dummy1_f9` (no-op), `check_ab_press` (A or B **held**), up to 600 frames; then `set_field_scene
  saved bgm` (SOUND_SCENE_FIELD with that BGM), close, release.

### 1.7 Script commands the Villa needs (VM status today)

| Op (opcode) | Today | DS semantics |
|---|---|---|
| `init_persisted_map_features_for_villa` (0x2F0) | stub, no-op | select + clear the VILLA features slot (FieldHost `initMapFeatures('villa')`) |
| `check_met_furniture_requirements` (0x30F) | stub, returns 0 (hides 7 pieces) | §1.2 |
| `show_list_menu_set_width` (0x327) | stub, **no-op: the order form shows no menu** | `show_list_menu` with a width in tiles; also used by the Battle Hall |
| `check_ab_press` (0x2FC) | stub, returns 0 | TRUE while A or B is held |
| `set_scene_play_bgm_music_box` (0x2F8) | stub | play SEQ_PL_TOWN02 as a scene BGM |
| `set_field_scene` (0x2F9) | stub | back to the field scene with the given BGM |
| `save_tv_segment_home_and_manor[_no_furniture]` (0x30D/0x30C) | stub | TV records; stays a counted no-op |

All others in the two script files are real (`get_current_bgm`, `dummy1_f9`, list menus, money, records, objects,
doors, warps).

## 2. The journal

### 2.1 Getting it, opening it

- Mom gives it (`scripts_twinleaf_town_player_house_1f.s`, `TwinleafTownPlayerHouse1F_MomGiveJournal`, once
  `FLAG_HAS_POKEDEX`): item ITEM_JOURNAL (key item, registrable) and `give_journal`: set `FLAG_JOURNAL_ACQUIRED`
  (0x963), select today's page (`Journal_GetSavedPage`), write the title (date + current map).
- Opened from the Bag (ITEM_USE_FUNC_JOURNAL, menu and registered field use) and **automatically on Continue**
  (`FieldTask_LoadSavedGameMap`): if the journal is owned and the newest page's date is ≥ 2 days from today
  (`DayNumberForDate` difference ≤ −2 or ≥ 2; across new year, Dec 31 ↔ Jan 1 counts as 1 day unless the years
  differ by ≥ 2; otherwise any year change opens it), the journal app runs before the map loads.
- On Continue (and on the error-recovery load) `Journal_GetSavedPage`: if page 0 has a date and it is not today
  (year, month, day, weekday), pages shift down (page 9 drops) and page 0 is cleared; then the title is written
  (`JournalEntry_SaveTitle` keeps an existing same-day title). The page only rolls at a load, never at midnight
  while playing. Before the journal is owned the field's journal pointer is null and nothing is recorded.

### 2.2 Save layout (`include/journal.h`, `src/journal.c`)

10 pages × 112 bytes (page 0 = today):

| Part | Fields |
|---|---|
| title (u32 bits) | year 7 (0–99), month 4, weekday 3 (0 = Sunday), day 5, map header 13 |
| 4 location events (u32 each) | type 6 bits, trainer 10 bits, location / map label / gym index / item 16 bits |
| Pokémon (u32) | result u8 (1 caught, 2 defeated), string variant 2 bits, time of day 4 bits, gender 2 bits, species u16 |
| trainer (u32) | standard 1 bit, trainer id 15 bits, map header u16 |
| 2 online events (42 bytes each) | link/Wi-Fi only; out of scope |

**Location events** (`generated/journal_location_events.txt`): 0 none, 1 rested at home, 2 left research lab, 3 used
a PC box, 4 shopped, 5 lots of shopping, 6 sold a little, 7 sold a lot, 8 business at a mart, 9 gym too tough, 10 beat
gym leader, 11 beat Elite Four member, 12 beat Champion, 13 arrived in location, 14 left cave, 15 left building, 16 Game
Corner, 17 Safari Game, 18 item obtained, 19 + field move (Cut, Fly, Surf, Strength, Defog, Rock Smash, Waterfall, Rock
Climb, Flash, Teleport "warped", Dig, Sweet Scent "lured", 31 unused (Chatter), Milk Drink, Softboiled), 34 dug
underground, 35 built secret base, 36–40 played at Tower/Factory/Castle/Hall/Arcade.

Adding one (`JournalEntry_SaveLocationEvent`): the first empty of 4 slots; when full, slots shift up and the new one
goes last. Dedupe rules:
- "misc" types (1–8, 16, 17, 34–40): skipped when the last filled slot has the same type.
- travel (13–15), item (18), field moves (19–33): skipped when the last slot has the same type and the same 16-bit
  value.
- gym (9, 10): first removes a "too tough" slot of the same gym (closing the gap), then appends.
- Elite Four (11): first removes any earlier Elite Four slot, then appends. Champion (12): always appends.
- The Pokémon and trainer parts are single slots, overwritten.

### 2.3 Where entries come from

| Event | Caller | Rule |
|---|---|---|
| title | Continue, `give_journal` | date + map |
| arrived in location (13) | FieldSystem_InitFlagsOnMapChange → CreateFlyLocationJournalEvent | entering a map whose fly point (GetMapFlyWarpId) is not yet unlocked; then no transition event |
| left cave (14) | CreateMapTransitionJournalEvent | previous map a cave, new map outdoors; value = the cave's map label |
| rested at home (1) / left lab (2) | same | leaving MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F / SANDGEM_TOWN_POKEMON_RESEARCH_LAB to outdoors |
| left building (15) | same | building → outdoors, building label in `sMapsInfo` (27 labels); its flag picks "Exited from" vs "Departed from" |
| gym too tough (9) | same | outdoors → a gym map of `sGymsInfo` without its badge; value = gym index 0–7 |
| beat gym leader / E4 / Champion (10–12), standard trainer | Encounter end (encounter.c) on any trainer or tag battle **win** | `sGymsInfo` leaders → 10 (gym index, trainer); Aaron/Bertha/Flint/Lucian (+rematch) → 11; Cynthia (+rematch) → 12; anyone else → the trainer part (map, trainer) |
| Pokémon caught | wild/roamer/AI-partner/Safari battle ending in capture | species, gender, the battle's time of day; variant from play-time minutes / 10: 0,2,4 → 0; 1,3 → 1; 5 → 2 |
| Pokémon defeated | same battle types won, from the 5th win since the last map change (`wildMonDefeated`, reset by FieldMapChange_UpdateGameData) | variant: 1,3,5 → 0; 2,4 → 1; 0 → 2 |
| mart events (4–8) | shop_menu.c on leaving a MART_TYPE_NORMAL mart, not the Veilstone Store, Eterna Herb Shop, Celestic NW house | bought and sold → 8; bought > 1 → 5; sold > 1 → 7; bought 1 → 4; sold 1 → 6 |
| PC box (3) | closing the box app with `recordBoxUseInJournal` | |
| Safari Game (17) | `start_end_safari_game` ending a game | |
| Fly (20) | start menu fly, value = destination map | |
| Teleport (28), Dig (29), Sweet Scent (30) | field move tasks | value = current map |
| Underground (34, 35) | mining, secret bases | Underground lane |
| script `create_journal_event type, param` | below | |

`create_journal_event` (0x1CD; ScrCmd_CreateJournalEvent; five u16 args, the last three unused; always returns
TRUE, i.e. yields one frame — the VM's stand-in already yields): only types 16 (Game Corner), 17, 18 (item, param =
item; `scripts_visible_items.s`, picked-up item balls only), 19, 21–26 (Cut, Surf, Strength, Defog, Rock Smash,
Waterfall, Rock Climb; param = map, from the field-move scripts) and 36–40 make entries. **Every other type is a
no-op**: the gym scripts' "beat gym leader"/"too tough" and the League rooms' Elite Four/Champion calls (the 49 uses
in coverage are mostly these) do nothing; those entries come from the C paths above.

### 2.4 The journal screen (overlay 81, journal_controller.c / journal_printer.c)

- Graphics: NARC `/graphic/f_note_gra.narc` (NARC_INDEX_GRAPHIC__F_NOTE_GRA), 6 members: 0/1 tilemap (male/female
  player), 2/3 tiles, 4/5 palettes (552 bytes: 16 palettes). The page tilemap is drawn twice (two page layers);
  each page's tilemap palette is the page number (`Bg_ChangeTilemapRectPalette … page`), so older pages use palette
  1–9 (inferred: aged paper). Text palette 15 (system font, colour 1/2/0).
- Text: `TEXT_BANK_JOURNAL_ENTRIES` (366). Title window: tiles (2, 2), 24 × 2: "Month day" (month names bank 414) then
  the weekday (messages 2–8) 12 px after it. Events window (4, 4), 27 × 18 tiles, rows of 16 px: row 0 "Started
  from <location>" (title map's label), rows 1–4 the location events, y 80 the Pokémon line, y 96 the trainer line,
  y 112+ online events.
- Event texts: messages 9–48 by type. Gym names: `TEXT_BANK_GYM_NAMES` (378) by gym index (same order as
  `sGymsInfo`). Left cave: "Departed from" for Valley Windworks, Snowpoint Temple, Fuego Ironworks, else "Got
  through". Pokémon: variant 0 "Caught X (time)", 1 "X was caught (time)", 2 by gender male/female/genderless
  (49–56; time from `TEXT_BANK_TIMES_OF_DAY` 608). Trainer line: by length of location name + trainer name (rival
  class: the rival's name, message 61): ≤ 14 msg 57, ≤ 16 msg 58, ≤ 19 msg 59, else 60.
- Input: Left, and B when not on page 0, go to page − 1; A and Right go to page + 1 (older); each only when that
  page has a date. B on page 0 or START closes (fade). Page turn: SE `SEQ_SE_DP_MEKURU3` (1681) and a column
  wipe over 9 steps from `Unk_ov81_021D33E8` (a 9 × 32 table of source columns, 0xFF = blank). BGM scene SUB_67, no
  sequence.
- Single screen: the journal is one DS screen already (main engine only).

### 2.5 What OpenSinnoh needs

- Save: `journal: JournalPage[]` (≤ 10) with typed events (a save schema bump); `FLAG_JOURNAL_ACQUIRED` already exists.
- Services: the add/dedupe rules (§2.2), the page roll and the open-on-continue test, using the game clock
  (`GameState.gameTime` / ClockTime) for the date.
- Hooks: map change (cave/building/gym/fly-point), battle end, mart close, PC close, Safari end, field moves, the
  two script ops, and Bag use of the Journal.
- Screen: a menus app with the ROM page art and font.

## 3. Diplomas

- Giver: the **game director** in `GrandLakeValorLakefrontWestHouse` (Hotel Grand Lake, west cottage), object
  script 1. Not the Hearthome/Jubilife Game Freak rooms.
- Rules: if `FLAG_MAP_LOCAL_0x01` is set (already shown this visit) → a closing line. Else `check_local_dex_completed`
  FALSE → "I'm the game director". Else if `FLAG_RECEIVED_LOCAL_DEX_DIPLOMA` (0xAB) is unset, or national dex not
  complete → the Sinnoh diploma; else the National diploma. First time each: `increment_trainer_score2`
  TRAINER_SCORE_EVENT_LOCAL_DEX_DIPLOMA_RECEIVED / NATIONAL_…; set the received flag (0xAB / 0xAC) and
  `FLAG_MAP_LOCAL_0x01`; message, fanfare `SEQ_FANFA4` (1158), fade out, `show_diploma_sinnoh` (0x1EA) /
  `show_diploma_national_dex` (0x1EB) (FieldSystem_ShowDiploma, isNatDex false/true), `return_to_field`, fade in.
  Both ops are no-op stubs today.
- Screen (overlay 102, `src/applications/diploma.c`): NARC `/demo/syoujyou/syoujyou.narc` (12 members): NCGR 0
  Sinnoh document, 1 National document, 2/3 blank backgrounds; NCLR 4–7 same order; NSCR 8–11 same order (documents
  256 × 512, blanks 256 × 256). Document palette 1, blank palette 0, text palette 2.
- Text `TEXT_BANK_DIPLOMA` (1), system font, colour 1/2/0, at tile positions inside the document: message 0
  "PLAYER: name" at (6, 4); message 1 (Sinnoh) or 2 (National) at (8, 8); message 3 (the developer credit) at
  (17.25, 18) tiles.
- Timing: fade in 6 steps; 60 frames still; then the document scrolls 4 px/frame for 48 frames from the top screen to
  the bottom one (main shows rows 0–191, sub rows 192–383, ending main at −192 and sub at 0); then A, B or touch →
  fade out. Single screen: show the document's top 192 rows with the text (the DS's final bottom screen), with the
  hold and a 48-frame slide in (inferred presentation).

## 4. Remaining small NPC rules

`pnpm opensinnoh coverage` on a fresh import (IMPORTER_VERSION platinum-99, ROM-wide roots): 896 distinct ops, 618
real, 185 stub (706 uses), 93 unknown (all `fr_*` frontier). Stubbed ops reachable from town/NPC scripts, leaving out
TV, Battle Frontier, Underground, wireless/union/GTS, the Chatot microphone and Pal Park's GBA migration:

| Priority | Op(s) | Used by | DS behaviour |
|---|---|---|---|
| 1 | `show_list_menu_set_width` | Villa order form, Battle Hall | list menu with width (§1.7); a no-op breaks both menus |
| 1 | Villa ops (§1.7) | Villa | §1 |
| 1 | `give_journal`, `create_journal_event` | Mom; item balls, field moves, Game Corner, Safari | §2 |
| 1 | `open_region_map` | wall Town Maps (`BgEvents_TownMap`) | opens the town map app (view only) |
| 1 | `start_vs_seeker` | Vs Seeker use (`scripts_vs_seeker.s`) | rematch check over nearby trainers (rematch table imported) |
| 1 | `survive_poison` | common field-poison script | Pokemon_TrySurvivePoison: a poisoned mon at 1 HP is cured instead of fainting |
| 2 | `show_diploma_sinnoh`, `show_diploma_national_dex` | Hotel Grand Lake director | §3 |
| 2 | `check_is_department_store_regular` | Veilstone Store 2F–4F attendants | TRUE when `SystemVars_GetDepartmentStoreBuyCount` ≥ 5 |
| 2 | `get_party_mon_contest_stat` | Pastoria NE house (scarf giver) | party slot's condition stat (cool + contest type) |
| 2 | `check_party_combee_gender_count` | Pastoria middle house | whether the party has male and female non-egg Combee |
| 2 | `get_party_mon_footprint_type` | Dr. Footstep | has-print and footprint type of a party mon (ribbon) |
| 2 | `change_deoxys_form` | Veilstone meteorites | sets every party Deoxys's form, recalcs stats, dex capture |
| 2 | `calc_hidden_power_type` | Veilstone prize exchange NPC | Hidden Power type (with a species exception list) |
| 2 | `get_news_press_deadline`, `set_news_press_deadline`, `get_random_seen_species` | Solaceon News Press | daily-decremented deadline var; a random seen Sinnoh-dex species (`LCRNG_Next() % localSeen`, Pikachu fallback) |
| 2 | `get_spiritomb_counter`, `clear_spiritomb_counter` | Route 209 Hallowed Tower | the Underground-talk counter var |
| 2 | `turn_on_pokedex_form_detection` | Route 218 gate | Pokedex_TurnOnFormDetection |
| 2 | `message_unown` | Solaceon Ruins inscriptions | a message in the Unown font |
| 2 | `use_vista_lighthouse_binoculars` | Vista Lighthouse | the binocular view scene |
| 3 | coins: `add_coins`, `check_can_add_coins`, `show_coins`, `hide_coins`, `update_coin_display`, `has_coins_from_var`, `subtract_coins_from_var`, `get_game_corner_prize_data`, `check_bonus_round_streak`, `scr_cmd_267` | Veilstone Game Corner, Prize Exchange | coin case and prizes (the Game Corner is a later system) |
| 3 | seals: `poke_mart_seal`, `give_or_take_seal`, `count_seal_occurence`, `count_unique_seals_in_seal_case`, `open_seal_capsule_editor` | Sunyshore Market, Solaceon east house | needs the seal case system |
| 3 | `show_accessory_shop` | Floaroma Flower Shop | accessory shop (contest accessories exist) |
| 3 | `show_dress_up_photo`, `dress_up_photo_has_data`, `set_dress_up_photo_title`, `scr_cmd_0a6`, `buffer_custom_message_word` | Jubilife TV 2F gallery, Sunyshore NE house | photo gallery (contest photos are saved already) and Easy Chat words |
| 3 | `check_all_tough_words_unlocked`, `try_buffer_and_unlock_random_tough_word`, `get_wallpaper_from_custom_message_words` | Snowpoint east house, Jubilife TV 3F | Easy Chat word unlocks and the wallpaper password |
| 3 | `start_rankings_machine` | Jubilife TV 3F | record-mixing rankings (own records offline) |
| 3 | `buffer_mon_nickname_from_pc`, `check_is_today_player_birthday`, `set_step_flag` | Jubilife TV 1F, counterpart talk, Route 201 | small; the birthday has no data source (stays FALSE) |
| 4 | `poke_mart_decor`, `scr_cmd_27c` (Amity Square), `scr_cmd_2b8` (Eterna condominiums) | | Underground goods / TV-tagged |

## 5. ROM tables

Verified on `Pokemon - Platinum Version (USA).nds` with `@opensinnoh/nds` (scratch script: search of the decompressed
binaries for the byte image of the decomp's arrays; each match unique except where noted). Overlay offsets are inside
the decompressed overlay (symbol − RAM base 0x021D0D80 for overlays 5, 81, 102).

```ts
/** overlay005/villa_furniture.c sVillaFurnitures: {u16 type, u16 collision, s32 x, y, z (fx32), s16 left, top, right, bottom} (RAM 0x0220192C). */
villaFurnitures: { where: 5, offset: 0x30bac, count: 23, size: 24, sha1: '1e4153890ff365b42efa8d7e5d946c0cc46f1264' },
/** sVillaFurnitureModelIDs: u32 build_model member per type, 559–578 (RAM 0x0220188C). */
villaFurnitureModels: { where: 5, offset: 0x30b0c, count: 20, size: 4, sha1: 'e6b588c1393645f83d637810a239d98986c23b57' },
/** sVillaFurnitureScriptIDs: u32 script id per type, 0x15 + type, the TV 10100 (RAM 0x022018DC). */
villaFurnitureScripts: { where: 5, offset: 0x30b5c, count: 20, size: 4, sha1: '54b69a0e1b6256a20803f9872be96942df84faef' },
/** system_vars.c sNumPossibleVillaVisitors: u8 4, 12, 15 (RAM 0x020EFA6C; the same 3 bytes also occur at 0xec6bb, 0xec70f, 0xec72b). */
villaVisitorCounts: { where: 'arm9', offset: 0xefa6c, count: 3, size: 1, sha1: '137eb7237c866fe1409e7196a37aaf21ebf6470a' },
/** sVillaVisitorPercentChances: u8 25, 75, 90 (RAM 0x020EFA70). */
villaVisitorChances: { where: 'arm9', offset: 0xefa70, count: 3, size: 1, sha1: '6442add075d55961da0127e7affc33da9d54a58e' },
/** journal.c sGymsInfo: {u32 trainer, u16 map header, u16 badge} (RAM 0x020E5B50). */
journalGyms: { where: 'arm9', offset: 0xe5b50, count: 8, size: 8, sha1: '994042d1434960e8c09c39489b17751b43463803' },
/** journal.c sMapsInfo: {u32 location-name message, u32 use "Exited"} (RAM 0x020E5B90). */
journalBuildings: { where: 'arm9', offset: 0xe5b90, count: 27, size: 8, sha1: '9d43b00d536d0cbac0567ea6da46c9f2cf57250c' },
/** journal_controller.c Unk_ov81_021D33E8: 9 steps × 32 source columns (0xFF blank) of the page-turn wipe. */
journalPageTurn: { where: 81, offset: 0x2668, count: 9, size: 32, sha1: '0a3da3dd9b74045457514423963c1a0415a08196' },
/** journal_printer.c Unk_ov81_021D3508: WindowTemplate {u8 bg, left, top, width, height, palette, u16 baseTile}. */
journalWindows: { where: 81, offset: 0x2788, count: 4, size: 8, sha1: 'dc299c6c8823c0aaab103a5167a06dd35b6b2e5d' },
```

Values read back: `journalGyms` trainer/map = 246/47, 315/67, 316/122, 317/133, 318/88, 319/167, 250/35, 320/154;
`journalBuildings` labels = 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 71, 103, 64, 104, 105, 80, 106, 107,
108, 109, 110, 47, 49, 70 (`TEXT_BANK_LOCATION_NAMES` 433 messages).

Not tables: furniture prices and gates live in the Villa script (already decoded); the gate thresholds and the diploma
text positions are immediates in code (listed above). Archives: `/fielddata/build_model/build_model.narc` (590
members, furniture 559–578), `/graphic/f_note_gra.narc` (6), `/demo/syoujyou/syoujyou.narc` (12). Text banks: 1
diploma, 366 journal entries, 378 gym names, 404 the director's house, 414 month names, 433 location names, 596 Resort
Area, 602 Villa, 603 furniture names, 608 times of day, 618 NPC trainer names.

## 6. Open questions

- After `play_music` (Audio System, Piano) does the field BGM come back by itself when the short sequence ends, or
  only at the next map change? (SEQ_PL_AUDIO/PIANO sit in BANK_BGM_FIELD; check the sequences' loop or a ROM run.)
- Furniture collision for NPCs: the DS hook is the player's; confirm wanderers (Gardenia, Byron, the rival) never
  step into furniture (their wander ranges look chosen to avoid it).
- Who reads `TEXT_BANK_VILLA_FURNITURE_NAMES` (603): presumably the TV "Home and Manor" segment; no named C code.
- The journal page palettes 0–9: confirm in the NCLR that later palettes age the paper.
- Journal date edge: OpenSinnoh's clock has no separate "week" field drift; use the clock's weekday for the title.
- The Villa onTransition sets the counterpart gfx var every visit; OpenSinnoh's `VAR_OBJ_GFX_ID_*` handling should
  already cover it (check once in the ROM test).
- `check_ab_press` reads held keys; the VM's input model must expose held A/B (it exposes presses today (inferred)).

## 7. What is built (lane: Villa, journal, diplomas)

- **Importer:** `TABLES` `villaFurnitures`, `villaFurnitureModels`, `villaFurnitureScripts`, `villaVisitorCounts`,
  `villaVisitorChances`, `journalGyms`, `journalBuildings`, `journalPageTurn` (town-extras.ts) into `NewGame.villa` and
  `NewGame.journal`; the furniture models 559–578 are converted in a slice import too. Art: `ui2d/journal/page-male|female`
  (ten cells, the paper on palettes 0–9) and `ui2d/diploma/sinnoh|national` (the document's top 256×192 over the blank),
  `NewGame.diploma`. `journalWindows` is not read (the window positions are constants in menus and app).
- **Villa:** `MapFeatures` `{ kind: 'villa' }`; world `villa.ts` builds the props from the flags on each map load, blocks the
  player in the boxes and adds `MapFeature.interact` (the last A check; the TV facing north only). VM: the Villa ops and
  `show_list_menu_set_width` (a list at a set width, anchors ignored); `check_ab_press` reads `Runner.input.held`. The
  daily visitor is core `updateVillaVisitor` in `dailyEvents` (the field stream). The TV segments stay counted stubs.
- **Journal:** contracts `journal.ts` (types and rules), `GameState.journal` (schema v21); hooks in world mapchange (warps,
  zone connections), game (battle end with the fifth-win rule, Fly, Dig, Teleport, Sweet Scent, the load's page roll and
  auto-open), VM (the mart's exit counts from the mart app's result, PC box sessions, the Safari's end, `give_journal`,
  `create_journal_event`), menus mining (dug underground). Screen: menus `journal.ts`, app `ui/journal.ts`. The Bag and Y
  use of the Journal (and of the Town Map, view only) open the apps on the field.
- **Diplomas:** `show_diploma_*` open the `diploma` app (fade, 60-frame hold, 48 frames for the slide, A, B or a touch).
- **NPC ops:** `open_region_map` (the Town Map, view only), `survive_poison`, `check_is_department_store_regular`,
  `get_party_mon_contest_stat`, `check_party_combee_gender_count`, `change_deoxys_form`, the News Press deadline ops (and
  its daily countdown), `get_random_seen_species`, the Spiritomb counter ops.
- **Decided (inferred):** a Pokémon Center (imported as `other`) never makes a building entry (none is in `sMapsInfo`); an
  arrival is a zone whose first-arrival flag is still clear; the Pokémon line's time of day is the clock's period at the
  battle's end; "used a PC box" is a session that changed the boxes or the party; the diploma document stays put on the one
  screen. Not done: `turn_on_pokedex_form_detection` (needs a Pokédex flag), the secret-base journal entry, the online
  events. (`start_vs_seeker`, `get_party_mon_footprint_type` and the RECORD_STEPS and RECORD_EGGS_HATCHED counts came
  later.)
