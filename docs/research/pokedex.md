# The Platinum Pokédex

Sources: decomp `src/applications/pokedex/` (26k lines, many files still `ov21_*`), `src/pokedex.c`,
`res/graphics/pokedex/pokedex.order`, `tools/dataproc/src/speciesproc.c`. Read for understanding only.
Our model: `packages/menus/src/pokedex.ts`; view: `packages/app/src/ui/dex.ts`; import:
`packages/importer/src/pokedex.ts` and `ui2d/pokedex.ts`.

## Screens

| Screen | Decomp | What it does |
|---|---|---|
| List | `ov21_021D5AEC.c` (top), `ov21_021D76B0.c` (touch wheel) | Seen species in Sinnoh or national order, **up to the highest seen one**; unseen gaps are rows numbered as usual with the name "-----" (`pl_msg_pokedex_noname`); caught rows carry a Poké Ball (`search_body_shapes` anim 1). 9 rows on an arc, cursor in the centre. Up/down ±1 with acceleration, left/right ±5, clamped (no wrap). A opens a seen row, B quits, X searches, SELECT switches Sinnoh/National. Counters SEEN/OBTAINED count the current mode's list; in search results the counter is RESULTS and B/CANCEL restores the full list. |
| Entry tabs | `ov21_021E29DC.c` | INFO, AREA, CRY always; SIZE only for caught species; FORMS behind a global save flag (`canDetectForms`, set at the Route 218 gate). Up/down step through the seen species of the list. |
| Info | `infomain.c` | Name and number, front sprite (first-seen form and gender, never shiny). Caught only: type icons, footprint, category, height, weight, description. Seen-only: species 0's texts ("????? Pokémon", `???’??”`, `????.?`), no description. |
| Area | `ov21_021DC9BC.c`, `ov21_021DDD2C.c`, `pokedex_field_map.c`, `pokedex_enc_data.c` | Works for seen-only species. Morning / Day / Night (the RTC picks the first; left/right change it). Fields paint a 30×30 grid of 5 px cells at (89, 30); empty cells beside painted ones get one of 46 edge tiles by their neighbours; dungeons are markers (`dungeon_highlight`, Mt. Coronet its own). A second layer shows the special lists (honey trees, Great Marsh, Trophy Garden, Poké Radar after the national dex) minus the first. "Area Unknown" when both are empty. Turnback Cave (dungeon 10) stays hidden until `VAR_HIDDEN_LOCATION_SPRING_PATH` holds 0x312; the four hidden places also have map overlays. |
| Cry | `ov21_021E3FFC.c`, `crysub.c` | Waveform, play/loop, pitch, chorus, pan. Sound is M4: our page is a stub (logged). |
| Size | `pokedex_height_check.c`, `ov21_021E737C.c` | Height check: the player's silhouette (`size_check_icons` anim 5 Lucas / 6 Dawn) at (168, 88 + y) and the front sprite faded black at (88, 88 + y), each scaled by 256/scale from per-species, per-player-gender tables; labels "4’8”"/"4’6”". The weight check (a seesaw against 38.0/34.0 kg) is not done. |
| Forms | `formmain.c`, `formsub.c` | Seen forms (Unown "One form", Shellos/Gastrodon seas, Burmy/Wormadam cloaks, Deoxys, Rotom, Giratina, Shaymin), otherwise the seen genders. Castform and Cherrim are not recorded. |
| Search | `pokedex_search.c`, `pokedex_sort.c`, `ov21_021D94BC.c` | ORDER (Numerical, A to Z, Heaviest, Lightest, Tallest, Smallest), NAME (ABC … YZ), TYPE ×2 (17 types, never the same twice), FORM (14 body shapes). Seen species only; the weight/height orders and the type filters keep **caught** ones only; A to Z, names and shapes keep seen. No match: "No matching Pokémon were found." and the search stays open. |

**Sinnoh vs National.** `Pokedex.nationalDexObtained` (our `pokedex.national`); the list opens on the
national dex once it is unlocked and remembers the last mode and species (PokedexMemory). The regional
order is `pl_pokezukan` (our `Species.regionalDex`; 210, Turtwig … Giratina). POKéDEX appears in the
start menu once `pokedexObtained` (our `pokedex.obtained`).

**Seen.** The DS marks a species seen when it appears in battle (wild at the start, each trainer
Pokémon when sent out) and caught on capture. Ours: wild battles at the start (game.ts), catches, script
ops, and now the trainer battle stub marks the whole party (it counts as a won battle).

## Data

| What | Where | Format |
|---|---|---|
| Height, weight | `zkn_data/zukan_data.narc` members 0, 1 | u32 per species 0..493, decimetres / hectograms |
| Body shape | member 2 | u8, enum PokemonBodyShape 0..13 |
| Size check | members 3–10 | u16 trainer/Pokémon scale (female, then male), then s16 positions in the same order |
| Sorted lists | members 11–57 | u16 species: national, Sinnoh, A–Z, heaviest, lightest, tallest, smallest, 9 name groups (A–Z order), 17 types, 14 shapes |
| Giratina Altered | `zukan_data_gira.narc`, banks 708/710 | same layout; the DS swaps them in while Giratina shows its Altered Forme |
| Texts (US) | `pl_msg.narc` banks 706 (entries), 707 (weight), 709 (height), 711 (category), 697 (UI: `pl_msg_pokedex_*`) | message = species; heights and weights are pre-formatted imperial strings |
| Area | `zkn_data/zukan_enc_platinum.narc` | member 0: 22 dungeons {x, y, coronet}; member 2: 51 fields {x, y, w, h, cells[32]} (the decomp names x/y swapped); 4 + species + 495·list: u32 indexes, 0-terminated; lists: dungeon morning/day/night/special/special-national, then the same for fields |
| Footprints | `pokefoot/pokefoot.narc` | 0 palette, 1 NANR, 2 NCER (two 16×8 OAMs), 3 + species NCGR; 108 species leave none |
| UI art | `resource/eng/zukan/zukan.narc` (130 members, `pokedex.order`) | BGs with `banner_sinnoh` palette: `info_main`, `area_map` (+ 4 hidden-place overlays), `height_check_main`; field tiles `dummy1`/`dummy2` NCGR (5 px squares at x = 5·tile, BG palette 8); OBJs: `type_icons` (type → anim per infomain.c), `search_body_shapes` (ball mark), `search_button_forms` (shapes), `size_check_icons`, `page_buttons`, `time_day_icons`, `dungeon_highlight`, `unseen_icon` |
| Front sprites | `pl_pokegra` / `pl_otherpoke` | the `pokemonSprites` records |

Checked on the ROM (`tests/integration/pokedex.rom.test.ts`): every regional species has its texts and
valid area indexes (120 of 210 live in the wild), and our sorts and filters reproduce members 11–57 of
`zukan_data_gira` exactly.

## Not done

Weight check, cry playback (M4), the foreign-language pages, seen forms and genders (the state keeps
none: the forms page and the picture use the owned ones), the time of day from a clock (the game has
none yet: Day, as battles use), the separate touch-screen composition (the wheel gesture runs over the arc in our single screen).

## Curved list measurements (2026-10-16)

`ov21_021D5AEC.c`: nine plates, centre (170,82), other visible centres (185,22), (181,26),
(177,42), (175,58), then mirrored below at y106,122,138,142. Recycling stops are (189,12)/(180 + 9/4096,152), including the reference's final fixed-point value.
The plates are `search_body_shapes` animation 0, the caught mark animation 1 at x−54, the scroll
thumb animation 2. The audit called the plates `name_tag`; that is the separate current-species label
loaded by pokedex_graphics.c. Explicit plate palettes by distance are 0,7,8,9,9. Text starts at
centre−(64,8), number x22 and name x49. No party icons in these rows.

One row travels 640 units, initially 60/tick (11 ticks), multiplied by 1.6 after 4,4,8,12 completed
held rows. Left/right queue five one-tick rows and do not auto-repeat. Release finishes the active
row. `ov21_021D76B0.c`: wheel centre (248,104), radius104, angular travel measured at radius524,
×10 travel units, loses 2/tick after touch and stops at a row boundary. These are behavior and numeric
observations only; no decomp code or assets copied. The browser uses that gesture over the list arc,
selects a touched row before opening it on a second tap, and keeps the existing SEARCH/SWITCH/QUIT band.
The headless view owns `scrollPosition`; the renderer samples it without a wall-clock tween.
