# Menus and services (M3 research)

Decomp evidence for the menus and services. Paths are relative to `reference-projects/pokeplatinum`
(names and understanding only; no code copied). Op use counts come from the imported IR of Platinum US
rev0. Everything was read in the source; sizes in §4 were derived by hand and matched against known
offsets.

## 1. Services

Script ids (`include/script_manager.h:89-120`): common scripts are 2000+n (`0x7D0` = index 0); berry
tree interactions start at 2800, the Poké Radar at 8970, `DayCareCommon` at 9500, Pokédex ratings at
9950. Op names below are our IR names (decomp macro in snake_case). Uses are counted in the imported IR;
"stub" means a logged stub in `packages/vm` today (`op-classification.json`).

### 1.1 Pokémon Center

- **Nurse.** Map scripts call `Common_CallPokecenterNurse <localID>` (`asm/macros/scrcmd.inc:5253`):
  VAR_0x8007 = nurse, `call_common_script 0x7D2` → `CommonScript_PokecenterNurse`
  (`res/field/scripts/scripts_common.s:95-232`).
  - Greeting by time of day (`get_time_of_day`); a different one for a gold-or-better trainer card
    (`get_trainer_card_level` ≥ 4, `FLAG_POKECENTER_GOLD_TRAINER_CARD_SEEN`).
  - Yes: `set_player_state` HEALING and the give pose, the nurse turns to the machine,
    `count_party_non_eggs VAR_0x8006`, `play_pokecenter_healing_animation VAR_0x8006`, `heal_party`, the
    Pokérus check (`check_party_pokerus`, `FLAG_POKECENTER_IDENTIFIED_POKERUS`), "restored", the bow.
  - `heal_party` → `Party_HealAllMembers` (`src/item_use_pokemon.c:603`): HP = max, status none, PP
    restored. The machine is `FieldSystem_PlayHealingAnimation_Pokecenter`
    (`src/overlay006/healing_machine_animation/pokecenter.c:41`), one ball per non-egg mon.
  - Whiteout: `CommonScript_PokecenterBlackOutRecover` (0x7E5, :1199) and the home variant (0x7E4). M2
    owns blacking out; M3 owns the heal.
- **PC.** No object: facing north on a PC tile (`Field_TileBehaviorToScript`,
  `src/overlay005/field_control.c:650-655`) runs `CommonScript_PC` (0x7E2, `scripts_common.s:906`).
  Boot and shut-down are map prop animations (`load_pc_animation`, `play_pc_*`,
  `src/overlay006/pc_animation.c:40`). The menu (`CommonScript_AccessWhichPC` :926-974) is a scripted
  menu that already runs:

  | Entry | Condition | Then |
  |---|---|---|
  | Someone's / Bebe's PC | `FLAG_MET_BEBE` picks the name | Deposit / Withdraw / Move Pokémon / Move Items (/ Compare after `FLAG_CONTEST_HALL_VISITED`) → `open_pokemon_storage 0..4` (:983-1040) |
  | `<Player>`'s PC | always | Mailbox (`count_mail_in_mailbox`, `scr_cmd_1b3`), Ball Capsules (`open_seal_capsule_editor`), log out (:1061) |
  | Rowan's / Oak's PC | national dex enabled picks the name | `PokedexRatings_CheckPC` (0x26DF): `load_pokedex_rating` from seen/caught counts (`src/scrcmd.c:3979`) |
  | Hall of Fame | `FLAG_GAME_COMPLETED` | `open_pc_hall_of_fame_screen` (later) |
  | Switch off | always | `CommonScript_PCSwitchOff` (:1132) |

  Ops: `heal_party` (32 uses), `count_party_non_eggs` (8), `play_pokecenter_healing_animation` (1),
  `get_trainer_card_level` (2), `check_party_pokerus` (1), `open_pokemon_storage` (5),
  `load/play_pc_*_animation` (3), `count_mail_in_mailbox` (1), `load_pokedex_rating` (2), the dex
  counts (7). All stubs.

### 1.2 PC storage

- `include/pc_boxes.h:7-23`: 18 boxes of 5 × 6 = 30; names of 20 u16; wallpapers u8 per box (16
  default + 8 unlockable, a u8 unlock mask); the current box. Init: wallpaper `i % 16`, names
  `PokemonStorageSystem_Text_Box1 + i` (`src/pc_boxes.c:28-50`).
- Wallpapers (`include/applications/pc_boxes/struct_box_menu.h:4-47`): Forest, City, Desert, Savanna,
  Crag, Volcano, Snow, Cave, Beach, Seafloor, River, Sky, Pokécenter, Machine, Checks, Simple; unlockable
  Distortion, Contest, Nostalgic, Croagunk, Trio, PikaPika, Legend, Team Galactic (Jubilife TV 3F
  passwords, `src/overlay006/wallpaper_passwords.c:93`: 4 easy-chat words keyed to the trainer ID; M3b).
- App: `src/applications/pc_boxes/` (overlay 19, 14.5k lines). Modes `PC_MODE_DEPOSIT`, `WITHDRAW`,
  `MOVE_MONS`, `MOVE_ITEMS`, `COMPARE` (`box_settings.h:4`), opened by `ScrCmd_OpenPokemonStorage`
  (`src/scrcmd.c:3290`). `box_app_manager.c` holds the actions: item give/take/put away (:1158,
  :2561–2850), markings (:1534, :3157), box jump (:1393), wallpaper (:1437), rename (:2459), release
  (:2174; refused for the last mon knowing a move in `sReleaseBlockingMoves`, :2353). The last
  non-fainted party mon cannot be deposited.
- Ops elsewhere: `get_pc_boxes_free_slot_count` (3), `count_alive_mons_and_box_mons` (1), and
  `give_pokemon` overflowing to a box.

### 1.3 Marts

- Macros: `PokeMartCommon` (:1944), `PokeMartSpecialties id` (:1949), `PokeMartDecor id` (:1954),
  `PokeMartSeal id` (:1959), `PokeMartFrontier id` (:4339), and the `…WithGreeting` wrappers (:5223,
  :5233). C: `src/scrcmd_shop.c` (:21–123) → `Shop_Start(…, MART_TYPE_NORMAL|DECOR|SEAL|FRONTIER,
  incBuyCount)`; the app is `src/overlay007/shop_menu.c`.
- **Common stock by badges** (`include/data/mart_items.h:14-34`, tiers in `scrcmd_shop.c:37-62`). Badges
  0 → tier 1, 1–2 → 2, 3–4 → 3, 5–6 → 4, 7 → 5, 8 → 6; an item shows when its tier ≤ the current one:

  | Tier | Adds |
  |---|---|
  | 1 | Poké Ball, Potion, Antidote, Parlyz Heal |
  | 2 | Super Potion, Awakening, Burn Heal, Ice Heal, Escape Rope, Repel |
  | 3 | Great Ball, Revive, Super Repel |
  | 4 | Ultra Ball, Hyper Potion, Full Heal, Max Repel |
  | 5 | Max Potion |
  | 6 | Full Restore |

  The IR passes 0 in Sandgem and 1 elsewhere; the C handler ignores it.
- **Specialty stock** (`include/data/mart_items.h:36-~250`, ids in `generated/mart_specialties_id.txt`;
  IR ids 0–19): Jubilife (Air Mail, Heal Ball), Oreburgh, Floaroma, Eterna, the Eterna Herb Shop (herbal
  medicine), Hearthome, Solaceon, Pastoria, Celestic, Snowpoint, Canalave, Sunyshore, Pokémon League
  (balls by town, plus one mail each).
- **Veilstone Department Store** (`res/field/scripts/scripts_veilstone_store_*.s`): 1F right (medicine,
  id 8), 1F left (balls, Escape Rope, Poké Doll, Repels, mail; 9), 2F (X items 10, vitamins 11), 3F (TMs
  12, 13), 4F decor (`poke_mart_decor` 0/1: furniture and dolls, i.e. Underground goods, deferred), B1F
  (berries, 19), 5F none. Every Veilstone id counts purchases (`SystemVars_IncrementDepartmentStoreBuyCount`,
  `src/system_vars.c:304`; "regular" at ≥ 5, `src/scrcmd.c:6047`).
- **Seals** (`poke_mart_seal` 0–6, Sunyshore Market, one stock per weekday) and **Frontier** (BP) are
  out of M3.
- **Flow** (`shop_menu.c`): price = item `ITEM_PARAM_PRICE` (:1325); quantity up to money / price,
  capped at 99 (:924-927); ≥ 10 Poké Balls bought at once adds a Premier Ball (:1259). **Selling** runs in
  the bag app: half price (`src/applications/bag/main.c:2610-2623`); price 0 or `PREVENT_TOSS` cannot be
  sold. Money cap 999,999 (`src/trainer_info.c:12`).
- Ops: `poke_mart_common` (19), `poke_mart_specialties` (22), `poke_mart_decor` (2), `check_money` (48),
  `remove_money` (34), `show/hide/update_money_display` (78), `check_money2`/`remove_money2` (8). All
  stubs; `check_money` returns 0 (at the time of this research).

### 1.4 Daycare and eggs

- **Scripts:** `res/field/scripts/scripts_day_care_common.s`: `DayCareCommon_Man` (9500, outside in
  Solaceon) and `DayCareCommon_Lady` (9501, inside). `scripts_solaceon_town.s:24` turns the man when
  `check_daycare_has_egg`. 19 ops, all stubs (at the time of this research).
- **Data** (`include/struct_defs/daycare.h`): 2 × {BoxPokemon, mail, steps}, `offspringPersonality`
  (≠ 0 = an egg is waiting), `stepCounter`. Constants `include/constants/daycare.h`.
- **Per step** (`Daycare_Update`, `src/overlay005/daycare.c:918`, from `field_control.c:826`): each
  slot's steps += 1. On withdraw the steps become exp, 1 per step (`:212`); the fee is 100 + 100 × levels
  gained (:272).
- **Egg roll:** when no egg is waiting, both slots are full and `(steps & 0xFF) == 0xFF` (every 256
  steps): an egg if `score > rand × 100 / 0xFFFF`. **Compatibility** (`:817`): 0 if either parent is
  Undiscovered, two Dittos, same gender, genderless without Ditto, or no shared egg group; Ditto + other
  20 (same OT) or 50; same species 70 (different OT) or 50; different species 50 or 20 (same OT).
- **Egg cycles:** `stepCounter` runs to 255 (230 on 12 special dates, :885-900). Each cycle every party
  egg's friendship (remaining cycles) drops by 1, or 2 with a Flame Body or Magma Armor mon (`:783`). At 0
  the field runs `CommonScript_HatchEgg` (0x7EF, `scripts_common.s:1429`) → `hatch_egg`
  (`src/egg_hatch.c`, cutscene `src/cutscenes/egg_hatch/`; nickname offered; friendship 120).
- **Inheritance** (`Daycare_GiveEggFromDaycare` :751):
  - Species: the mother's (or the non-Ditto's) base form (:619); Nidoran♀ and Illumise pick by PID bit
    0x8000; Manaphy gives Phione; incense babies (`sIncenseBabyTable` :562) need the incense held.
  - Nature: the mother or Ditto with an Everstone passes it 50% of the time (PID rerolled up to 2400
    times, :302).
  - Masuda: parents of different languages get up to 4 extra shiny rerolls (:719).
  - IVs: 3 stats copied from random parents (`Egg_InheritIVs` :396; the decomp removes the list index,
    not the stat: keep the bug for fidelity).
  - Moves (`Egg_BuildMoveset` :472): father's egg moves, father's TM/HM moves the baby can learn, then
    level-up moves both parents know; Volt Tackle for Pichu with a Light Ball (:602).

### 1.5 Name Rater, tutors, relearner, deleter, trades

- **Name Rater** (`scripts_eterna_city_condominiums_1f.s:10-80`): `select_move_tutor_pokemon` (the party
  picker), egg check, `check_is_party_mon_outsider` (other OT refused, `src/scrcmd_party.c:62`),
  `open_pokemon_naming_screen slot, result` (`src/scrcmd.c:3460`; 1 = unchanged), `scr_cmd_2b8` (TV, later).
- **Shard tutors** (Route 212 house 13 moves, Survival Area 17, Snowpoint 8; `TUTOR_LOCATION_*`):
  `select_move_tutor_pokemon` → `check_has_learnable_tutor_moves` → `show_move_tutor_move_selection_menu`
  → `check_can_afford_move` → 4 moves? `open_summary_screen_teach_move` + `get_summary_selected_move_slot`
  → `pay_shard_cost`. C: `src/overlay005/scrcmd_move_tutor.c`; data `res/pokemon/move_tutors.json`
  (38 moves, red/blue/yellow/green shard costs, location) → a `moveTutors` record.
- **Relearner** (`scripts_pastoria_city_east_house.s`): a Heart Scale, `check_has_learnable_reminder_moves`,
  `open_move_reminder_menu` (`src/applications/move_reminder.c`); list = level-up moves ≤ level, not known
  (`src/move_reminder_data.c:26`). Grandma Wilma and Route 228 use `open_move_tutor_menu` (the same app,
  one move).
- **Deleter** (`scripts_canalave_city_east_house.s:30-61`): `select_party_mon_move`,
  `clear_party_mon_move_slot`; refuses a mon with one move. The HM rule is inside the app.
- **NPC trades** (4 houses): `init/start/finish_npc_trade`, `get_npc_trade_*` (`src/npc_trade_task.c`).

### 1.6 Berries, honey trees, Poké Radar

- **Berry patches** (`include/berry_patches.h`, `src/berry_patches.c`, scripts
  `scripts_berry_tree_interaction.s`): 128 patches of {berry, stage, stage minutes left, moisture
  minutes left, replant count, yield, moisture, yield rating, mulch, growing}. Stages NONE, PLANTED,
  SPROUTED, GROWING, BLOOMING, FRUIT. Stage length = berry duration × 60 min (Growth Mulch × 3/4, Damp
  × 1.5); moisture drains per hour (Damp ÷ 2, Growth × 1.5) and each dry hour costs a yield point; yield
  = base × rating, at least 2; fruit lasts 4 stages (6 with Stable Mulch); regrows up to 10 times (15
  with Gooey). Driven by elapsed real minutes (`BerryPatches_ElapseTime`,
  `src/berry_patch_manager.c:97`). Ops: 11 berry ops, all stubs; `open_bag` + `get_selected_item` pick
  the berry and mulch.
- **Honey trees** (`src/overlay005/honey_tree.c`): 21 trees; `CommonScript_HoneyTree` (0x7D8,
  `scripts_common.s:460-543`). Slathering sets 24 h; encounters from 6 h to 24 h after. Group: normal tree
  10% none / 70% A / 20% B; a Munchlax tree 9 / 20 / 70 / 1% C; re-slathering keeps the group 90% of the
  time. Slot weights 40/20/20/10/5/5, levels 5–15. Munchlax trees: 4 distinct trees from the trainer ID
  bytes mod 21 (`IsMunchlaxTree` :384). Tables `encounters_honey_tree.json` (NARC `encdata_ex` members
  2–4). The battle is `CreateWildMon_HoneyTree` (`src/overlay006/wild_encounters.c:1196`, M2).
- **Poké Radar** (`src/pokeradar.c`): no script op; used from the bag (`item_use_functions.c:645`). 50
  steps of charge (charged per step while in the bag); 4 patches, one per ring of a 9×9 area, on tall
  grass at the same height. Chain continues per ring at 88/68/48/28% after a KO, 98/78/58/38% after a
  catch; shiny patch 1 in max(200, 8200 − 200 × chain); the chain caps at 999; 3 records saved. Messages
  in `scripts_poke_radar.s`. Battles via `wild_encounters.c:280` (M2).
## 2. Menu apps: DS screens and ROM graphics

MAIN is the top screen unless an app swaps (`src/system.c:155`); the trainer case (`main.c:570`) and
the naming screen (`naming_screen.c:1136`) swap. NARC ROM paths come from `platinum.us/filesys.csv` and
`include/constants/narc.h`; member names from `res/graphics/<app>/*.order` (index = line, `_lz` =
LZ-compressed). Text banks are `msgdata/pl_msg.narc` bank n = line n of `generated/text_banks.txt`.
The title screen's decoders (`packages/importer/src/title/nitro2d.ts`) read NCLR, NCGR and NSCR; **NCER and
NANR are missing**, and every OBJ below needs them.

| App | NARC (ROM path) | Code | Banks |
|---|---|---|---|
| Bag | `graphic/pl_bag_gra.narc` (36), `itemtool/itemdata/item_icon.narc`, `graphic/shop_gra.narc` | `src/applications/bag/` (4.3k) | 7, 392, 395, 647 |
| Party | `graphic/pl_plist_gra.narc` (25), `poketool/icongra/pl_poke_icon.narc`, status icons from `pl_pst_gra` | `src/applications/party_menu/` (7.7k) | 453 |
| Summary | `graphic/pl_pst_gra.narc`, `battle/graphic/pl_batt_obj.narc` (type/category icons), `pl_pokegra` + `pl_poke_data` | `src/applications/pokemon_summary_screen/` (6k) | 455, 535, 646, 647, 210, 612 |
| Pokédex | `resource/eng/zukan/zukan.narc` (all `_lz`), `pokefoot.narc`, `pl_pokegra`, `ZUKAN_ENC_PLATINUM` | `src/applications/pokedex/` (26k) | 697, 706, 711 |
| Trainer card | `graphic/trainer_case.narc` | `src/applications/trainer_case/` (2k) | 616 |
| Naming | `data/namein.narc` (19) | `src/applications/naming_screen.c` (3.4k) | 422, 427 |
| Options | `graphic/config_gra.narc` (3), `graphic/pl_winframe.narc` | `src/applications/options_menu.c` | 220 |
| Pokétch | `graphic/poketch.narc` | `src/applications/poketch/` (20.7k) | 456–461, 624 |
| Mail | `graphic/mail_gra.narc` (37) | `mail.c`, `mail_viewer.c`, easy_chat | 409, 437 |
| PC boxes | `graphic/box.narc` (prebuilt, numeric members) | `src/applications/pc_boxes/` (14.5k) | 18, 19, 412, 202, 610, 391 |
| Mart | `graphic/shop_gra.narc` (12) | `src/overlay007/shop_menu.c` | 543, 392, 647 |
| Town Map | `graphic/tmap_gra.narc` (30) | `src/applications/town_map/` | 615, 433 |

**What each DS app shows** (top / bottom):
- **Bag:** item list, pocket name, description, item icon, the male/female bag sprite / the rotating
  Poké Ball pocket dial (affine BG) and touch buttons (`bag/main.c:801-842`).
- **Party:** six panels (icon, ball, name, level, HP bar, status, held item/mail/capsule marker), the
  context menu and message box / six ball touch buttons, hidden in some modes (`main.c:335`). 24 modes
  (`PartyMenuMode`, `include/applications/party_menu/defs.h:48`): field, battle, items, TMs, mail,
  contest, daycare, …
- **Summary:** pages INFO, MEMO, SKILLS, BATTLE_MOVES, CONDITION, CONTEST_MOVES, RIBBONS
  (`pokemon_summary_screen/main.h:39`); modes NORMAL, LOCK_MOVES, SELECT_MOVE (teach/forget), FEED_POFFIN,
  SHOW_CONDITION_CHANGE. Page tilemaps are `page_info_NSCR + page`; the mon is a 3D-sprite at (52, 104)
  / an arc of page buttons (`subscreen.c:26-51`).
- **Pokédex:** list with a touch scroll wheel; entry with tabs Info / Area / Cry / Size / Forms; search
  (body shape, type, name, order) / the matching touch panels (decomp files: list
  `ov21_021D5AEC.c`/`ov21_021D76B0.c`, info `infomain.c`, area `ov21_021DC9BC.c`, cry, size, forms,
  search `pokedex_search.c`).
- **Trainer card:** front (ID, name, money, Pokédex, score, time, started) and back (Hall of Fame
  debut, link records, signature); the card colour by stars (`trainer_card_{normal,…,black}_NCLR`); the
  portrait is a BG (`lucas`/`dawn_NSCR`) / the badge case with lid; badges are OBJs with one palette
  per badge, polished by rubbing.
- **Naming:** prompt and entity icon (player, rival, box, mon icon with gender) / keyboard 6 × 13, pages
  Upper, Lower, Others (+ numpad for some kinds), BACK, OK (`naming_screen.c:57-97, 822`).
- **Options:** top only. TEXT SPEED (slow/mid/fast), SOUND (stereo/mono), BATTLE SCENE (on/off),
  BATTLE STYLE (shift/set), BUTTON MODE (normal / START = X / L = A), FRAME (type 1–20, previewed from
  `pl_winframe`), each with a description line and a confirm dialog.
- **Pokétch:** frame `poketch_border` with a colour row; 25 apps in `sAppOverlayIDs`
  (`poketch_system.c:83-110`); most have `<app>_bg_tiles` + `<app>_NSCR` + an OBJ set; the calculator and
  digital watch are BG only; party/friendship/daycare/matchup/trainer counter/history use the shared
  poke icon cells.
- **Mail:** 12 stationeries (grass … brick, `mail_viewer.c:704`), up to 3 mon icons; writing is Easy
  Chat (M3b, words only).
- **PC boxes:** wallpaper, 30 icons, header, preview of the held mon, the party / a touch dial and
  the Compare view (`ov19_021DEC04.c`). Wallpaper i = members NCLR 28+3i, NCGR 29+3i, NSCR 30+3i
  (`ov19_021D79F8.c:28-65`).
- **Mart:** top only: item list, price, money, description, item icon; the bottom stays on the
  Pokétch.
- **Town Map:** region map with names / a zoomed map and zoom button; modes ITEM, FLY, WALL_MAP.

**Shared graphics:**
- **Pokémon icons** `pl_poke_icon.narc`: member 0 the shared palette (3 used palettes), 1–6 the shared
  cell/anim (three VRAM mappings), 7+ one NCGR per species, then forms, egg and Manaphy egg
  (`src/pokemon_icon.c:37`, palette index `:115` from each species' `icon_palette` 0–2).
- **Item icons** `item_icon.narc` (711): a generic NANR and NCER, then an NCGR + NCLR pair per item
  (`Item_FileID`, `src/item.c:49`).
- **Trainer sprites** `poketool/trgra/trfgra.narc`/`trbgra.narc`: 5 members per class (NCGR, NCLR, NCER,
  NANR, scan). Battle only; the card uses its own BG portrait.
- **Type/category icons** `pl_batt_obj.narc`; the Pokédex has its own set.
- **Window frames** `graphic/pl_winframe.narc` (the 20 option frames) and `graphic/pl_font.narc`.
- **Mon front/back sprites** `pl_pokegra` (summary, Pokédex, PC preview, battle): shared with M2.
## 3. Single-screen design per app

Extends `docs/ui/design.md`: one composed screen, sheets (centred card ≤ 800×600 on desktop, full
screen on phones in portrait), the dot grid, the game font, the cursor and touch rules of §2 there. The
DS bottom screen's touch controls become parts of the same sheet, never a second surface. ROM art is drawn whole-pixel on the dot grid; the layout reflows around it.

| App | Desktop / landscape | Phone portrait | The DS bottom screen becomes |
|---|---|---|---|
| Bag | pocket rail left (the 8 pocket icons), list centre, item icon + description right; the bag sprite above the rail | pocket tab strip on top (icons, L/R), list, description docked at the bottom | the pocket dial → the rail/strip; its buttons → the context window |
| Party | 2 × 3 panels (DS panel art, icons animated), context window at the right | one column of six panels, context as a bottom sheet | the six ball buttons → the panels themselves are the tap targets |
| Summary | 3D-free: the front sprite and header left, page body right; page tabs as a row of the DS page icons | header with sprite on top, tabs as a scrollable strip, body below | the arc of page buttons → the tab row; the move detail panel slides in as on the DS |
| PC boxes | box grid (wallpaper art, 6 × 5) centre, preview card left, party column right, box header with ←/→ | box grid full width, preview as a strip above it, party as a toggled drawer | the touch dial → the box header arrows and a box list; Compare → a side-by-side card |
| Mart | list with prices left, money window and description right, item icon | list full width, money window pinned on top, description at the bottom | (top-only on the DS) quantity window as a centred stepper |
| Naming | prompt with entity icon on top, the DS keyboard below (pages UPPER/lower/others, BACK, OK) | same, keys sized ≥ 44 px, wraps to the 13-column grid at a smaller dot | the keyboard itself; physical typing fills the same buffer |
| Options | the DS list, the description line under it, frame preview inline | same, one column | (top only) |
| Trainer card | card (front/back flip on A) beside the badge case | card on top, badge case under it; rubbing = pointer drag | the badge case → the lower half of the sheet |
| Pokédex | list with a scroll thumb left, entry right; tabs Info / Area / Size / Forms / Search | list full screen; the entry pushes as its own sheet with a tab strip | the scroll wheel → list scroll + thumb; the tab panel → tabs; search panels → a filter sheet |
| Pokétch | the existing device card (bottom right), app area 192 × 160 LCD | bottom centre above the controls | unchanged: the card is the bottom screen |
| Mail | stationery card with the icons; Easy Chat as a word grid sheet | same, word grid below | the word grid → tabs per category |
| Town Map | the region map filling the sheet, location card overlay, zoom as a toggle | same, pinch/zoom button | the zoomed map → the zoom toggle on the same map |

Battle (M2) reuses party and bag in battle mode inside the battle's own layout, with the same sheets.
## 4. Saves

### 4.1 GameState growth

GameState v5 holds the Pokémon instances, boxes, bag pockets, money and dex. M3 adds v6 and v7.
Each step has a `migrateStateVn` and an id-only fixture test, as v1–v4 do. Decomp sources for
the field shapes:

| State | Decomp struct | Notes |
|---|---|---|
| trainer ID/SID, play time, coins | `TrainerInfo` (`include/trainer_info.h:9-21`), `PlayTime` (`include/play_time.h:11-15`) | ID u32: TID low, SID high; money cap 999,999 (`src/trainer_info.c:12`); coins max 50,000 |
| options | `Options` u16 bitfield (`include/game_options.h:8-16`) | text speed stays a device option (`docs/decisions.md`) |
| box names, wallpapers, current box | `PCBoxes` (`include/pc_boxes.h:7-24`) | 18 × 30; names 20 chars; 16 default + 8 unlockable wallpapers, a u8 unlock mask; defaults `src/pc_boxes.c:28-57` |
| registered item | `Bag.registeredItem` (`include/bag.h:35-45`) | |
| daycare | `Daycare` (`include/struct_defs/daycare.h:10-28`) | 2 × (BoxPokemon, mail, steps) |
| berry patches, rival name | `MiscSaveBlock` (`include/savedata_misc.h:20-35`) | |
| Pokétch | `Poketch` (`include/poketch.h:31-70`) | app list, memo, counter, pedometer, alarm, marking map, … |
| game records, trainer case | `GAME_RECORDS`, `TRAINER_CASE` save-table entries | the card's numbers and signature |

### 4.2 Cartridge `.sav` layout (Platinum, 512 KB flash)

All from `src/savedata.c`, `include/savedata.h` and `include/constants/savedata/*.h`. Sizes were
derived by hand from the structs (ARM alignment). Offsets 0x630 (bag), 0xFEC (flags), 0x1328 (dex),
0x1654 (daycare) and the storage size 0x121E4 match the community-known values. The general block size
0xCF2C is the community value; we derived entries 0–9 only.

- **Two copies.** Primary at 0x00000, backup at 0x40000 (sectors 0 and 64, 0x1000-byte sectors), 32
  sectors each. Each copy holds the **general block** at +0 (0xCF2C, footer at 0xCF18) and the
  **storage block** at +0xCF2C (0x121E4, footer at +0x121D0). Blocks are packed by byte, not by sector
  (`SaveBlockInfo_Init` :852-876).
- **Entry slots.** Each save-table entry takes `size + (4 − size % 4) + 4` bytes (`:813-824`; an aligned
  entry still grows by 8). The last 4 bytes may hold a per-entry CRC16 (TV, Mystery Gift, rankings,
  …; `:1328-1363`).
- **Footer** (0x14 bytes, `include/savedata.h:8-15`): saveCounter u32, blockCounter u32, size u32,
  signature 0x20060623, block id u8, pad, CRC16 over the block without the footer
  (`SaveData_CalculateFooterChecksum` :294-297). The CRC is NitroSDK `MATH_CalcCRC16CCITT`
  (`src/math_util.c:238-241`); the SDK source is absent: poly 0x1021, init 0xFFFF per PKHeX. Verify on
  our own writer and one real save.
- **Valid copy** (`SaveBlockFooter_Validate` :327-350): size, signature, id and CRC all match.
- **Choosing the copy** (`SaveData_LoadCheck` :441-523): per block, the valid copy with the higher
  saveCounter, then blockCounter (wrap-aware, :375-388); both blocks' winning saveCounters must agree,
  else the save is corrupt. A normal save writes only the general block to the inactive copy and bumps
  blockCounter; a full save writes both and bumps saveCounter (:634-760).
- **Extra blocks** (Hall of Fame at 0x20000/0x60000; Battle Hall records and recordings at 0x23000–0x2A000)
  have their own 16-byte footer. Not imported.

**General block entries** (`src/savedata/save_table.c:48-87`, in enum order):

| # | Entry | Offset | Size |
|---|---|---|---|
| 0 | SYSTEM (RTC offset, birthday, game time) | 0x0000 | 0x5C |
| 1 | PLAYER: `Options` + `TrainerInfo` | 0x0064 | 0x2C |
| 2 | PARTY: capacity, count, 6 × `Pokemon` (0xEC) | 0x0098 | 0x590 |
| 3 | BAG | 0x0630 | 0x774 |
| 4 | VARS_FLAGS: 288 u16 vars, then 2,912 flag bits | 0x0DAC | 0x3AC |
| 5 | POKETCH | 0x1160 | 0x118 |
| 6 | FIELD_PLAYER_STATE: 5 locations (map, warp, x, z, facing), weather, `PlayerData` | 0x1280 | 0xA0 |
| 7 | POKEDEX (magic 0xBEEFCAFE, caught/seen bitfields, genders, forms) | 0x1328 | 0x324 |
| 8 | DAYCARE | 0x1654 | 0x1E0 |
| 9 | PAL_PAD | 0x183C | 0x880 |
| 10–36 | MISC (berries, rival name), map objects, Underground, mailbox, Poffins, journal, trainer case, game records, seals, Chatot, Frontier, ribbons, encounters (honey trees, swarms), TV, Wi-Fi, … | from 0x20C4 | not derived |

**Trainer fields** (general offsets): name 0x68 (8 charcodes), ID 0x78, money 0x7C, gender 0x80, badges
0x82 (bit n = badge n), coins 0x88, play time 0x8A (u16 h, u8 m, u8 s).

**Bag** (+0x630; each slot {u16 item, u16 qty}): items 165, key items 50, TMs/HMs 100, mail 12,
medicine 40, berries 64, balls 15, battle items 30; `registeredItem` at bag +0x770.

**Storage block:** current box u32, then `BoxPokemon[18][30]` (0x88 each), box names 18 × 20 u16 at
+0x11EE4, wallpapers u8 × 18 at +0x121B4, unlock mask at +0x121C6.

**Flags and vars** (`src/vars_flags.c`): var `v` (0x4000–0x411F) at `vars[v − 0x4000]`; flag `f` at
byte `f/8`, bit `f%8`; flag 0 is never set. 0x8000+ script vars are not saved. Trainer flags
0x550–0x8EF; daily flags 0xAA0–0xB5F. Our ids map by `sourceIndex`.

### 4.3 Pokémon encryption

`include/struct_defs/pokemon.h`, `src/pokemon.c`, `src/math_util.c`.
- **BoxPokemon** is 136 bytes: PID u32, a u16 of runtime flags (0 on disk), checksum u16, then four
  32-byte blocks A–D. **Pokemon** (party) adds 100 bytes: status, level, HP, max HP, the five stats,
  mail (0x38), ball capsule (0x18).
- **Checksum:** 16-bit sum of the 64 plaintext u16 words of the blocks (`:4827-4839`).
- **Cipher:** for each u16, `seed = seed × 0x41C64E6D + 0x6073`, word ^= `seed >> 16`; the blocks use
  seed = checksum, the party extension seed = PID (`math_util.c:217-234`, `pokemon.c:317-378`).
- **Shuffle:** `s = ((PID & 0x3E000) >> 13) % 24` picks the physical slot of A, B, C, D
  (`BoxPokemon_GetDataBlock` :4861-4925). The 24 orders are ABCD, ABDC, ACBD, ADBC, ACDB, ADCB, BACD,
  BADC, CABD, DABC, CADB, DACB, BCAD, BDAC, CBAD, DBAC, CDAB, DCAB, BCDA, BDCA, CBDA, DBCA, CDBA, DCBA
  (read as: the letter in physical slot 0, 1, 2, 3). Decrypt first, then unshuffle.
- **Block A:** species, held item, OT ID (u32), exp, friendship (the egg cycle counter for eggs),
  ability, markings, language, 6 EVs, 6 contest stats, Sinnoh ribbons.
- **Block B:** 4 moves, 4 PP, 4 PP Ups, IVs packed in a u32 (5 bits each HP/Atk/Def/Spe/SpA/SpD; bit 30
  egg, bit 31 nicknamed), Hoenn ribbons, fateful/gender/form byte, Platinum egg and met locations.
- **Block C:** nickname (11 charcodes), origin game, contest ribbons.
- **Block D:** OT name (8 charcodes), egg and met dates, DP egg/met locations, Pokérus, ball, met level
  and OT gender, encounter type.
- **Shiny:** `(TID ^ SID ^ PIDhi ^ PIDlo) < 8`.
- **Text:** u16 charcodes (`include/constants/charcode.h`): '0'–'9' 0x121–0x12A, 'A'–'Z' 0x12B–0x144,
  'a'–'z' 0x145–0x15E, space 0x1DE, terminator 0xFFFF. Our text package's decoder already maps these.

### 4.4 Import plan (late M3b)

One-way, Platinum US first: pick the valid copies, check CRCs, decrypt and unshuffle every mon (checksum
mismatch = a bad egg, reported), map species/items/moves/flags/vars by `sourceIndex` to our ids, and
write a fresh GameState (current schema). The player's position comes from `FIELD_PLAYER_STATE`
location 0. Not imported, and listed in the import report: Underground, Frontier, Wi-Fi, TV, Pal Pad,
recordings, Hall of Fame. Tests use `.sav` bytes from our own writer; a real save only behind
`OPENSINNOH_NDS_SAV`.
