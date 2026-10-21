# Platinum trainer AI: rules, adapter fidelity and decision tests

Researched 2026-10-16 against OpenSinnoh `60b31aba587c6d3092390606a3d9b78ffbf581e4` and pret/pokeplatinum `fe1ea418a7364c93daf0d07ae55e195452d8803c`. The latter was inspected in a local `reference-projects/pokeplatinum` checkout. Decomp names, behavioral facts and source links are used for understanding; no decomp code, script, ROM bytes or assets are included. Rule descriptions below are original prose. Existing research [battles.md](battles.md) and [double-battles.md](double-battles.md) supplies historical context; this note describes the current adapter rather than their earlier implementation milestones.

**Finding:** enemy trainers already execute imported Platinum AI bytecode through `packages/battle/src/ai`. The next implementation is a fidelity and test-coverage pass, chiefly on the live simulator view, not a new heuristic move picker. Trainer masks select additive scoring routines; switching and item decisions happen separately before move scoring. The catalog distinguishes stored masks, runtime flags, scoring scripts and controller behavior.

Navigation: [current adapter](#what-the-adapter-already-does), [trainer masks](#trainer-masks-stored-per-record-not-inferred-from-class), [scoring semantics](#scoring-execution-and-information-model), [BASIC/EXPERT](#basic-and-expert-scoring-catalogue), [auxiliary routines](#auxiliary-scoring-routines), [Tag Strategy](#tag-strategy-bit-7-exhaustive-handler-rules), [switching](#switching-ordered-rules-independent-of-scoring-flags), [items](#trainer-items), [doubles targets](#doubles-target-selection), [implementation plan](#remaining-fidelity-work-and-implementation-order), [decision tests](#decision-scenarios-and-acceptance-criteria). Labels in backticks identify decomp routines for navigation. Source comments sometimes describe an intention that differs from control flow; the observed branch behavior governs this note.


## What the adapter already does

Reviewed engine commit `60b31aba587c6d3092390606a3d9b78ffbf581e4`. This is already a ROM-script interpreter, not a highest-power move picker. [`foeAction`](../../packages/battle/src/controller.ts) uses the trainer record's `ai` mask and `createAiView`; ordinary trainers call `chooseAction`, the initial rival battle calls `chooseMove` directly, locked moves skip AI, and ordinary wild Pokémon choose uniformly among usable moves. Roamers take the controller’s separate escape/trap path. The controller consumes 16-bit battle-stream draws, maintains Quick Claw rolls and residual `powerMul`, applies item/switch/move actions, reveals announced abilities/items and clears observed knowledge on switch-in. A rejected disabled choice currently produces a counted `battle:ai-unusable-move` stub and substitutes the first usable move; preserving the AI's score is not yet proof of matching the DS command-validation path.

[`choose.ts`](../../packages/battle/src/ai/choose.ts) already implements switch-before-item-before-move, post-KO replacements, per-target doubles scoring, and the ally score threshold. [`script.ts`](../../packages/battle/src/ai/script.ts) initializes 100/0 scores, draws all four 85–100 damage multipliers, walks set flags in ascending bit order, and interprets 109 commands. [`memory.ts`](../../packages/battle/src/ai/memory.ts) owns knowledge, trainer item stock and reserved replacements. Keep these seams; do not add a parallel TypeScript strategy tree.


## Trainer masks: stored per record, not inferred from class

The census below covers all 928 JSON trainer records in `res/trainers/data`, including dummy and unused records (102 class identifiers). It describes stored data, not 928 reachable battles. `B` = BASIC (1), `A` = EVAL_ATTACK (2), `E` = EXPERT (4), `S` = SETUP_FIRST_TURN (8), `R` = RISKY (16), `X` = PRIORITIZE_EXTREMES (32). Masks add their bit values. Runtime code reads the trainer header; class is only a useful summary, never an AI lookup key. [Header access](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/trainer_data.c#L80-L89).

| Stored flags | Numeric mask | Records |
|---|---:|---:|
| 0 | 0 | 1 |
| B | 1 | 580 |
| BA | 3 | 1 |
| BE | 5 | 57 |
| BAE | 7 | 226 |
| BAES | 15 | 6 |
| BR | 17 | 4 |
| BX | 33 | 47 |
| BAX | 35 | 6 |

The next table is exhaustive by class. Each row names its most frequent mask, its record count, and **every exception** to it. An exception is an exact JSON filename stem; the linked representative establishes the usual mask. Counts include all variants and rematches.

| Class | Usual mask (count) | Other records |
|---|---|---|
| ACE_TRAINER_FEMALE | BAE (27); [ace_trainer_alyssa](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ace_trainer_alyssa.json#L1-L16) | B (3): [dummy_063](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_063.json#L1-L16), [dummy_251](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_251.json#L1-L16), [dummy_391](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_391.json#L1-L16) |
| ACE_TRAINER_MALE | BAE (27); [ace_trainer_abel](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ace_trainer_abel.json#L1-L16) | B (2): [dummy_062](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_062.json#L1-L16), [dummy_387](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_387.json#L1-L16) |
| ACE_TRAINER_SNOW_FEMALE | BAE (7); [ace_trainer_alicia](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ace_trainer_alicia.json#L1-L16) | B (2): [dummy_213](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_213.json#L1-L16), [dummy_214](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_214.json#L1-L16) |
| ACE_TRAINER_SNOW_MALE | BAE (7); [ace_trainer_anton](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ace_trainer_anton.json#L1-L16) | B (2): [dummy_211](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_211.json#L1-L16), [dummy_212](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_212.json#L1-L16) |
| ARCADE_STAR | B (1); [arcade_star_dahlia_dummy](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/arcade_star_dahlia_dummy.json#L1-L16) | — |
| AROMA_LADY | BE (9); [aroma_lady_alison](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/aroma_lady_alison.json#L1-L16) | — |
| ARTIST | B (6); [artist_ismael](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/artist_ismael.json#L1-L16) | — |
| BATTLE_GIRL | BX (6); [battle_girl_helen](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/battle_girl_helen.json#L1-L16) | B (2): [dummy_077](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_077.json#L1-L16), [dummy_109](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_109.json#L1-L16) |
| BEAUTY | B (13); [beauty_cyndy](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/beauty_cyndy.json#L1-L16) | — |
| BELLE_AND_PA | B (2); [belle_and_pa_ava_and_matt](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/belle_and_pa_ava_and_matt.json#L1-L16) | — |
| BIRD_KEEPER | B (12); [bird_keeper_alexandra](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/bird_keeper_alexandra.json#L1-L16) | — |
| BLACK_BELT | BX (25); [black_belt_adam](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/black_belt_adam.json#L1-L16) | B (1): [dummy_126](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_126.json#L1-L16) |
| BREEDER_FEMALE | B (7); [breeder_amber](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/breeder_amber.json#L1-L16) | — |
| BREEDER_MALE | B (6); [breeder_albert](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/breeder_albert.json#L1-L16) | — |
| BUG_CATCHER | B (6); [bug_catcher_brandon_rematch_1](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/bug_catcher_brandon_rematch_1.json#L1-L16) | BA (1): [bug_catcher_brandon](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/bug_catcher_brandon.json#L1-L16) |
| CAMERAMAN | B (13); [cameraman_darryl](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/cameraman_darryl.json#L1-L16) | — |
| CAMPER | BAE (11); [camper_anthony](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/camper_anthony.json#L1-L16) | B (7): [dummy_005](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_005.json#L1-L16), [dummy_006](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_006.json#L1-L16), [dummy_117](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_117.json#L1-L16), [dummy_252](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_252.json#L1-L16), [dummy_253](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_253.json#L1-L16), [dummy_254](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_254.json#L1-L16), [dummy_255](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_255.json#L1-L16) |
| CASTLE_VALET | B (1); [castle_valet_darach_dummy](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/castle_valet_darach_dummy.json#L1-L16) | — |
| CHAMPION_CYNTHIA | BAE (2); [champion_cynthia](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/champion_cynthia.json#L1-L16) | — |
| CLOWN | B (16); [clown_lee](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/clown_lee.json#L1-L16) | — |
| COLLECTOR | B (11); [collector_brady](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/collector_brady.json#L1-L16) | — |
| COMMANDER_JUPITER | BAES (2); [commander_jupiter_spear_pillar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/commander_jupiter_spear_pillar.json#L1-L16) | BAE (1): [commander_jupiter_team_galactic_eterna_building](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/commander_jupiter_team_galactic_eterna_building.json#L1-L16) |
| COMMANDER_MARS | BAE (2); [commander_mars_lake_verity](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/commander_mars_lake_verity.json#L1-L16) | BAES (2): [commander_mars_spear_pillar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/commander_mars_spear_pillar.json#L1-L16), [commander_mars_stark_mountain](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/commander_mars_stark_mountain.json#L1-L16) |
| COMMANDER_SATURN | BAE (2); [commander_saturn_galactic_hq](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/commander_saturn_galactic_hq.json#L1-L16) | — |
| COWGIRL | B (4); [cowgirl_shelley](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/cowgirl_shelley.json#L1-L16) | — |
| CYCLIST_FEMALE | B (7); [cyclist_kayla](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/cyclist_kayla.json#L1-L16) | — |
| CYCLIST_MALE | B (7); [cyclist_axel](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/cyclist_axel.json#L1-L16) | — |
| DOUBLE_TEAM | B (3); [double_team_al_and_kay](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/double_team_al_and_kay.json#L1-L16) | — |
| DP_PLAYER_FEMALE | BAE (6); [dawn_jubilife_city_chimchar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dawn_jubilife_city_chimchar.json#L1-L16) | — |
| DP_PLAYER_MALE | BAE (6); [lucas_jubilife_city_chimchar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/lucas_jubilife_city_chimchar.json#L1-L16) | — |
| DRAGON_TAMER | BAE (15); [dragon_tamer_clinton](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dragon_tamer_clinton.json#L1-L16) | B (1): [dummy_219](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_219.json#L1-L16) |
| ELITE_FOUR_AARON | BAE (2); [elite_four_aaron](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/elite_four_aaron.json#L1-L16) | — |
| ELITE_FOUR_BERTHA | BAE (2); [elite_four_bertha](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/elite_four_bertha.json#L1-L16) | — |
| ELITE_FOUR_FLINT | BAE (3); [elite_four_flint](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/elite_four_flint.json#L1-L16) | — |
| ELITE_FOUR_LUCIAN | BAES (2); [elite_four_lucian](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/elite_four_lucian.json#L1-L16) | — |
| FACTORY_HEAD | B (1); [factory_head_thorton_dummy](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/factory_head_thorton_dummy.json#L1-L16) | — |
| FISHERMAN | B (23); [dummy_054](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_054.json#L1-L16) | — |
| GALACTIC_BOSS | BAE (3); [galactic_boss_cyrus_celestic_town_ruins](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/galactic_boss_cyrus_celestic_town_ruins.json#L1-L16) | — |
| GALACTIC_GRUNT_FEMALE | B (16); [dummy_424](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_424.json#L1-L16) | — |
| GALACTIC_GRUNT_MALE | B (38); [dummy_411](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_411.json#L1-L16) | — |
| GENTLEMAN | B (6); [dummy_402](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_402.json#L1-L16) | — |
| GUITARIST | B (24); [dummy_122](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_122.json#L1-L16) | — |
| HALL_MATRON | B (1); [hall_matron_argenta_dummy](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/hall_matron_argenta_dummy.json#L1-L16) | — |
| HIKER | BX (16); [hiker_alexander](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/hiker_alexander.json#L1-L16) | B (1): [dummy_115](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_115.json#L1-L16) |
| IDOL | B (15); [dummy_437](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_437.json#L1-L16) | — |
| INTERVIEWERS | B (10); [dummy_795](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_795.json#L1-L16) | — |
| JOGGER | B (8); [dummy_059](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_059.json#L1-L16) | — |
| LADY | B (8); [dummy_336](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_336.json#L1-L16) | — |
| LASS | B (17); [dummy_239](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_239.json#L1-L16) | BE (5): [lass_kaitlin](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/lass_kaitlin.json#L1-L16), [lass_madeline](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/lass_madeline.json#L1-L16), [lass_natalie](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/lass_natalie.json#L1-L16), [lass_samantha](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/lass_samantha.json#L1-L16), [lass_sarah](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/lass_sarah.json#L1-L16) |
| LEADER_BYRON | BAE (2); [leader_byron](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_byron.json#L1-L16) | — |
| LEADER_CANDICE | BAE (2); [leader_candice](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_candice.json#L1-L16) | — |
| LEADER_FANTINA | BAE (2); [leader_fantina](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_fantina.json#L1-L16) | — |
| LEADER_GARDENIA | BAE (2); [leader_gardenia](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_gardenia.json#L1-L16) | — |
| LEADER_MAYLENE | BAE (2); [leader_maylene](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_maylene.json#L1-L16) | — |
| LEADER_ROARK | BAE (2); [leader_roark](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_roark.json#L1-L16) | — |
| LEADER_VOLKNER | BAE (3); [leader_volkner](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_volkner.json#L1-L16) | — |
| LEADER_WAKE | BAE (2); [leader_wake](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/leader_wake.json#L1-L16) | — |
| MAID | B (5); [maid_belinda](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/maid_belinda.json#L1-L16) | — |
| NINJA_BOY | B (13); [ninja_boy_brennan](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ninja_boy_brennan.json#L1-L16) | — |
| PARASOL_LADY | B (5); [parasol_lady_alexa](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/parasol_lady_alexa.json#L1-L16) | — |
| PI | BR (4); [pi_carlos](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/pi_carlos.json#L1-L16) | B (1): [dummy_123](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_123.json#L1-L16) |
| PICNICKER | BAE (11); [picnicker_ana](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/picnicker_ana.json#L1-L16) | B (3): [dummy_007](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_007.json#L1-L16), [dummy_008](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_008.json#L1-L16), [dummy_118](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_118.json#L1-L16) |
| PLAYER_MALE | 0 (1); [none](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/none.json#L1-L6) | — |
| POKEFAN_FEMALE | B (5); [dummy_051](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_051.json#L1-L16) | — |
| POKEFAN_MALE | B (4); [dummy_050](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_050.json#L1-L16) | — |
| POKE_KID | B (16); [dummy_804](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_804.json#L1-L16) | — |
| POLICEMAN | B (11); [dummy_466](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_466.json#L1-L16) | — |
| PSYCHIC_FEMALE | BE (13); [psychic_abigail](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/psychic_abigail.json#L1-L16) | B (1): [dummy_218](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_218.json#L1-L16) |
| PSYCHIC_MALE | BE (13); [psychic_bryce](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/psychic_bryce.json#L1-L16) | B (1): [dummy_217](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_217.json#L1-L16) |
| RANCHER | B (4); [dummy_291](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_291.json#L1-L16) | — |
| RANGER_FEMALE | BAE (8); [ranger_allison](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ranger_allison.json#L1-L16) | B (1): [dummy_097](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_097.json#L1-L16) |
| RANGER_MALE | BAE (9); [ranger_deshawn](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ranger_deshawn.json#L1-L16) | — |
| REPORTER | B (11); [dummy_809](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_809.json#L1-L16) | — |
| RICH_BOY | B (9); [dummy_334](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_334.json#L1-L16) | — |
| RIVAL | BAE (27); [rival_canalave_city_chimchar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_canalave_city_chimchar.json#L1-L16) | BAX (6): [rival_route_201_chimchar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_route_201_chimchar.json#L1-L16), [rival_route_201_piplup](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_route_201_piplup.json#L1-L16), [rival_route_201_turtwig](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_route_201_turtwig.json#L1-L16), [rival_route_203_chimchar](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_route_203_chimchar.json#L1-L16), [rival_route_203_piplup](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_route_203_piplup.json#L1-L16), [rival_route_203_turtwig](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/rival_route_203_turtwig.json#L1-L16) |
| ROUGHNECK | B (3); [dummy_176](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_176.json#L1-L16) | — |
| RUIN_MANIAC | BAE (9); [ruin_maniac_bryan](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/ruin_maniac_bryan.json#L1-L16) | B (2): [dummy_169](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_169.json#L1-L16), [dummy_441](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_441.json#L1-L16) |
| SAILOR | B (12); [dummy_220](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_220.json#L1-L16) | — |
| SCHOOL_KID_FEMALE | BE (3); [school_kid_christine](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/school_kid_christine.json#L1-L16) | B (2): [dummy_222](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_222.json#L1-L16), [dummy_485](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_485.json#L1-L16) |
| SCHOOL_KID_MALE | BE (4); [school_kid_chance](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/school_kid_chance.json#L1-L16) | B (2): [dummy_221](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_221.json#L1-L16), [dummy_484](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_484.json#L1-L16) |
| SCIENTIST | BE (9); [scientist_darrius](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/scientist_darrius.json#L1-L16) | B (6): [dummy_098](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_098.json#L1-L16), [dummy_198](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_198.json#L1-L16), [dummy_199](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_199.json#L1-L16), [dummy_200](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_200.json#L1-L16), [dummy_487](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_487.json#L1-L16), [dummy_813](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_813.json#L1-L16) |
| SIS_AND_BRO | B (3); [dummy_112](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_112.json#L1-L16) | — |
| SKIER_FEMALE | B (9); [dummy_350](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_350.json#L1-L16) | — |
| SKIER_MALE | B (9); [dummy_349](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_349.json#L1-L16) | — |
| SOCIALITE | B (5); [dummy_448](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_448.json#L1-L16) | — |
| SWIMMER_FEMALE | B (25); [dummy_151](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_151.json#L1-L16) | — |
| SWIMMER_MALE | B (27); [dummy_149](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_149.json#L1-L16) | — |
| TOWER_TYCOON | B (1); [tower_tycoon_palmer_dummy](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/tower_tycoon_palmer_dummy.json#L1-L16) | — |
| TRAINER_BUCK | BAE (2); [buck_battleground](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/buck_battleground.json#L1-L16) | — |
| TRAINER_CHERYL | BAE (2); [cheryl_battleground](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/cheryl_battleground.json#L1-L16) | — |
| TRAINER_MARLEY | BAE (2); [marley_battleground](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/marley_battleground.json#L1-L16) | — |
| TRAINER_MIRA | BAE (2); [mira_battleground](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/mira_battleground.json#L1-L16) | — |
| TRAINER_RILEY | BAE (2); [riley_battleground](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/riley_battleground.json#L1-L16) | — |
| TUBER_FEMALE | B (6); [tuber_caitlyn](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/tuber_caitlyn.json#L1-L16) | — |
| TUBER_MALE | B (6); [tuber_conner](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/tuber_conner.json#L1-L16) | — |
| TWINS | B (4); [twins_emma_and_lil](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/twins_emma_and_lil.json#L1-L16) | BE (1): [twins_liv_and_liz](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/twins_liv_and_liz.json#L1-L16) |
| VETERAN | BAE (12); [veteran_armando](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/veteran_armando.json#L1-L16) | B (5): [dummy_116](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_116.json#L1-L16), [dummy_215](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_215.json#L1-L16), [dummy_216](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_216.json#L1-L16), [dummy_605](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_605.json#L1-L16), [dummy_605_rematch](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_605_rematch.json#L1-L16) |
| WAITER | B (5); [dummy_363](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_363.json#L1-L16) | — |
| WAITRESS | B (2); [dummy_064](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_064.json#L1-L16) | — |
| WORKER | B (18); [dummy_197](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_197.json#L1-L16) | — |
| YOUNGSTER | B (30); [dummy_009](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_009.json#L1-L16) | — |
| YOUNG_COUPLE | B (5); [dummy_182](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/res/trainers/data/dummy_182.json#L1-L16) | — |

Notable non-dummy deviations: Brandon’s initial Bug Catcher battle adds attack evaluation, but his rematches do not; five initial Lasses add Expert; Liv and Liz add Expert; Route 201/203 rival records use BAX while the later rival uses BAE; Mars and Jupiter gain first-turn setup only at Spear Pillar/Stark Mountain. Lucian uses BAES in both records. Static Frontier-brain class records show B, but facility constructors below supply the live masks. No stored ordinary trainer record sets Baton Pass, Tag Strategy, Check HP, Weather, Harrassment, or the special wild routines.

## Runtime mask overrides

The 32 entry bits are named as follows. Bits are independent and their contributions accumulate; a mask is not a difficulty level.

| Bit(s) | Flag / entry | Stored ordinary records? |
|---|---|---|
| 0 | BASIC | Yes |
| 1 | EVAL_ATTACK | Yes |
| 2 | EXPERT | Yes |
| 3 | SETUP_FIRST_TURN | Yes |
| 4 | RISKY | Yes |
| 5 | PRIORITIZE_EXTREMES | Yes |
| 6 | BATON_PASS | No |
| 7 | TAG_STRATEGY | No; forced for doubles |
| 8 | CHECK_HP | No |
| 9 | WEATHER | No |
| 10 | HARRASSMENT (source spelling) | No |
| 11–28 | UNUSED_11 through UNUSED_28 → Terminate | No |
| 29 | ROAMING_POKEMON | No; roamer override |
| 30 | SAFARI | No |
| 31 | CATCH_TUTORIAL | No |

[Flag order](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/generated/ai_flags.txt), [entry table](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L15-L49).

Ordinary mask selection is the trainer header, except roaming battles replace it with bit 29; every doubles battle additionally enables bit 7 (Tag Strategy), even for a zero-mask trainer. `TrainerAI_Init` does not automatically enable SAFARI or CATCH_TUTORIAL; their entries existing in the program is not evidence that the corresponding battle mode executes them. [Initialization](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L211-L255).

Frontier masks are generated at encounter setup. Tower initializes all four header masks to BAE ([constructor](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay104/ov104_0223A0C4.c#L890-L928)). Factory, Castle and Arcade use no flags in rounds 1–2, B in 3–4, BAE from round 5; their silver/gold boss encounters in singles override that progression to BAE ([Factory](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay104/battle_factory_helpers.c#L622-L645), [Castle](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay104/battle_castle_helpers.c#L290-L315), [Arcade](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay104/battle_arcade_helpers.c#L311-L336)). Hall uses no flags at ranks 1–3, B at 4–7 and BAE at 8–10, with Argenta singles and multi challenges forced to BAE ([Hall](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay104/battle_hall_helpers.c#L1557-L1582)). These are encounter-level assignments; do not derive them from the static brain-class rows.


## Scoring execution and information model

Every initialization starts the four slots at 100 (the ordinary all-moves initialization mask), zeros slots rejected by the invalid-move check, and draws **four** damage multipliers `100 − (draw % 16)` even for absent or unusable moves. Set AI bits run in ascending order, each over move slots 0–3. Zero PP makes the current move absent and its score zero. Invalidity is not an absorbing score state: later script arithmetic can change a zero score for a still-present move. Scores are signed 8-bit values; addition wraps first, then negative values clamp to zero. A +30 applied to 100 therefore produces zero. HP comparisons use truncated integer `100×HP/maxHP`; stat-stage comparisons use 6 as neutral, 0/12 as the limits. [Initialization and loop](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L221-L340), [evaluation and score/HP operations](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L482-L671).

The final selection is uniform **modulo RNG** among maximum-score move slots, not weighted by score or damage. Slot 0 seeds the candidate list even at zero; subsequent slots must contain a move. A tie-break draw is consumed even with one candidate. Escape/Safari state can override move choice. In doubles, initialization and choice repeat per live non-self target, followed by a target tie-break; see the doubles section. Keep intermediate arithmetic and draw order in tests, but do not promise cartridge-identical full-battle RNG: our simulator consumes the shared deterministic stream differently. [Singles selection](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L299-L345), [project engine decision](../decisions.md).

The script interpreter has 109 commands, an accumulator and an eight-entry return stack. The imported overlay's 32 entry words point into the same signed-word array. Existing ROM tests expect 10,607 words, 86 reachable opcode kinds and 96 words not reachable from those entries; these are decoder expectations, not a claim of complete behavioral branch coverage. Import the overlay's `gTrainerAITable`; the older `tr_ai_seq.narc` is not interchangeable. Keep this imported program authoritative instead of embedding this prose catalog as a strategy table. [Importer](../../packages/importer/src/trainer-ai.ts), [overlay location and import choice](../decisions.md), [decoder tests](../../packages/battle/src/ai/ai.rom.test.ts).

The AI is neither wholly omniscient nor restricted uniformly to observations:

- Before scoring an opposing target, remember its previous move in the first free known-move slot. Opponent move-known predicates consult that history; own moves and selected partner predicates can inspect the live moveset. Clear knowledge on the appropriate switch-in paths.
- `LoadBattlerAbility` returns own/partner ability, known opposing ability or an innate trapping ability; otherwise it guesses between the species' two abilities using a fresh draw. `CheckBattlerAbility` instead returns a three-valued have/not-have/unknown result when two species abilities leave ambiguity. Suppression is checked first. Do not replace both operations with one omniscient lookup or one cached guess.
- Held-item predicates differ: raw item loading, remembered opposing item effects and own-side item equality have distinct semantics. `LoadAbility` at the special tail can read effective actual ability. The adapter must preserve those distinctions, rather than conceal all live state globally.

[Ability operations](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L1170-L1266), [history](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L2705-L2731), [current predicate implementations](../../packages/battle/src/ai/script.ts), [knowledge lifecycle](../../packages/battle/src/ai/memory.ts).

Interpreter compatibility details that can change a rule's outcome: `LoadTypeFrom(DEFENDER_PARTNER_TYPE_2)` reads that partner's **first** type; `IfBattlerDealsMoreDamage` uses the acting AI battler's IVs even for the other battler's move; `IfBattlerFainted` consults the switching/fainted mask rather than simply testing HP; stack and break state survive successive moves/flags until reinitialization. The current interpreter retains these behaviors. Its explicit departures for undefined/nonterminating inputs are an error for Dummy3E/3F or stack overflow, zero HP percentage for an empty battler, and Normal Weather Ball type without weather. [Interpreter behavior and comments](../../packages/battle/src/ai/script.ts), [recorded compatibility decisions](../decisions.md).

### Damage comparison is an AI estimate

A move is comparable when its effect is in the imported alternate-power list, or its base power exceeds 1 and its effect is not in the no-calculation list. An ineligible move returns **no comparison**, not “lowest damage.” Maximum-damage queries use variance 100; varied queries use that slot's initialization roll. The estimate applies the AI's special power/type handling and battle-library type/damage calculations; it does not simulate a future turn, critical hit, hit chance or the opponent's chosen command. A maximum estimate may still draw for Psywave or Magnitude. [Comparison and estimate](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L2799-L3126).

Special handling includes Natural Gift's berry power/type and Klutz/Embargo, Judgment's plate type, Hidden Power from IVs, Gyro Ball's capped speed ratio, Dragon Rage 40, Sonic Boom 20, Seismic Toss/Night Shade user level, Psywave's eleven level multipliers from 0.5 through 1.5, Return/Frustration friendship scaling, Magnitude's seven weighted powers, and Low Kick/Grass Knot weight thresholds. Weather Ball's variable type honors weather suppression; the current project deliberately uses Normal for the native uninitialized no-weather case. Type-check predicates and direct stat predicates need not ask precisely the same question as this damage estimate. [Current independently implemented helpers](../../packages/battle/src/ai/calc.ts), [native move-type helper](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3127-L3175).

## BASIC and EXPERT scoring catalogue

Read this as ordered scoring rules, not a modern competitive strategy. A penalty does not make a move illegal. Each named routine returns after its terminal branch; bonuses within a routine can accumulate where stated. A = acting battler; D = evaluated target; HP means integer percentage. Stages below use the familiar −6…+6 scale (the script stores 0…12). `R≥n` means a fresh uniform byte draw in n…255: probability `(256−n)/256`; two gates mean two draws, not one reused sample. “Resisted” below includes immunity, quarter, and half effectiveness. “Not slower” includes a speed tie unless separately stated. BASIC and EXPERT immediately return for a partner target. Conditions refer to the AI's knowledge model, not necessarily unrestricted battle state.

Inventory: BASIC has 152 effect-dispatch tests and 99 distinct destinations (including the direct shared penalty leaf); EXPERT has 178 dispatch tests and 137 distinct destinations. One EXPERT dispatch is a shadowed duplicate, so its Thunder destination is not reachable through this table. The catalogue groups branch-only helper labels into their owning entry handler. Shared score leaves apply exactly their named delta (−1, −2, −3, −5, −6, −8, −10, −12, −30, +1, +2, +3, +5, +10); −6 is unused. Membership tables and dead historical type tables are data, not independently executed routines. Sources below are pinned to `fe1ea418a7364c93daf0d07ae55e195452d8803c`, `src/battle/trainer_ai/script.s`; links cite the source of each grouped rule, without copying implementation code.

### BASIC: rejection and feasibility rules

When damage comparison has an eligible move (or the candidate is Fissure/Horn Drill), the opening damage gate applies type immunity −10 and ability absorption −12 (Electric: Volt Absorb/Motor Drive; Water: Water Absorb; Fire: Flash Fire; Ground: Levitate; Wonder Guard: anything not 2×/4×), except Mold Breaker bypasses ability checks. Fissure/Horn Drill explicitly enter the immunity path. The duplicate Levitate branch intended for Dry Skin is unreachable, so Dry Skin is omitted here. Soundproof penalizes Growl, Roar, Sing, Supersonic, Screech, Snore, Uproar, Metal Sound, Grass Whistle, Bug Buzz and Chatter by −10, unless Mold Breaker. The damage comparison command here gates evaluation; it is not itself a score bonus. [Basic opening, 52–133](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L52-L133).

| Effect / handler family | Scoring condition |
| --- | --- |
| Sleep / Yawn | −10 for an already statused target, Safeguard, Insomnia or Vital Spirit. No general Leaf Guard/Hydration check in this handler. |
| Explosion / Self-Destruct | −10 for immunity or Damp (unless Mold Breaker). With no own reserve: −10 if D has reserves, otherwise −1. |
| Nightmare | Existing Nightmare: −10; awake D: −8; Magic Guard: −10. Checks stop on first match. |
| Dream Eater | Awake D: −8; otherwise immunity: −10. |
| Belly Drum | HP <51: −10; otherwise ordinary Attack-raise cap check. |
| Single-stat raises (+1/+2), Defense Curl, Minimize | Corresponding stat at +6: −10; with Simple, already ≥+3: −10. Speed raise also −10 under Trick Room. Accuracy/evasion raises also −10 if either battler has No Guard. |
| Single-stat reductions (+1/+2) | Target's corresponding stat at −6: −10; Clear Body/White Smoke: −10. Attack also Hyper Cutter; Speed also Trick Room or known Speed Boost; Accuracy also target Keen Eye or either No Guard; Evasion also either No Guard. The dispatch for two-stage Accuracy and Evasion reductions is swapped. |
| Haze / Psych Up / Heart Swap | −10 unless A has at least one negative stage or D at least one positive stage, across all seven stats. |
| Roar / Whirlwind | −10 if D has no reserve; −10 for Suction Cups unless A has Mold Breaker. |
| Recovery, Roost, weather recovery, unused recovery effects | −8 at full HP. |
| Poison / Toxic | −10 for Steel/Poison typing, Immunity/Magic Guard/Poison Heal, sunny Leaf Guard, rainy Hydration, any existing status or Safeguard. |
| Light Screen / Reflect / Mist / Safeguard | −8 when the corresponding own-side effect exists. |
| OHKO | −10 for type immunity, Sturdy unless Mold Breaker, or A lower level than D. |
| Nonstandard damage and charge moves | −10 for immunity or non-super-effective damage into Wonder Guard, unless Mold Breaker bypasses Wonder Guard. Covers Bide, fixed damage, Counter/Mirror Coat, charge/recharge, variable-power legacy effects and others routed here. |
| Magnitude-named helper | Dispatch actually uses `BATTLE_EFFECT_PSYWAVE`; tests the already-loaded value for Mold Breaker, then D's Levitate (−10), before the nonstandard-damage handler. Preserve this peculiar dispatch/state dependence. |
| Focus Energy | −10 if already focused. |
| Confusion / Swagger / Flatter | −5 if already confused; otherwise −10 for Own Tempo/Safeguard. |
| Paralysis | −10 for immunity, Limber, Magic Guard, existing status or Safeguard. Thunder Wave adds Volt Absorb/Motor Drive unless Mold Breaker; Mold Breaker does not bypass the earlier Limber/Magic Guard checks. |
| Substitute | Existing substitute −8, otherwise HP <26 gives −10. |
| Leech Seed | −10 if already seeded, Grass type or Magic Guard. |
| Disable / Encore | −8 if corresponding effect is already active. |
| Snore / Sleep Talk | −8 unless asleep. |
| Lock-On / Mind Reader | −10 for existing target lock-on or either battler's No Guard. |
| Mean Look family | −10 if already under that trapping condition. |
| Curse | Ghost: −10 if target already cursed or Magic Guard. Non-Ghost: Attack capped gives −10, Defense capped −8; with Simple either stage ≥+3 gives −10. |
| Spikes / Toxic Spikes / Stealth Rock | −10 if fully layered (3/2/already present), or D has no reserve. |
| Foresight / Perish Song | −10 if D already has the corresponding effect. |
| Sandstorm | −8 if already sandstorm. |
| Attract | −10 if already attracted, Oblivious, genderless or not opposite genders. |
| Memento | −10 for Clear Body/White Smoke unless Mold Breaker; Attack at −6: −10, Sp. Attack at −6: −8; no own reserve: −10. |
| Baton Pass | −10 if A has no reserve. |
| Rain Dance | Unless A has Swift Swim/Hydration, statused D with Hydration gives −8. Existing rain gives −8. |
| Sunny Day | Unless A has Flower Gift/Leaf Guard/Solar Power, statused D with Hydration gives −10 (yes, Hydration). Existing sun gives −8. |
| Future Sight / Doom Desire | −12 if either side already has Future Sight pending. |
| Fake Out | −10 unless A's first active turn. |
| Stockpile | −10 at three stockpiles. |
| Spit Up / Swallow | −10 for immunity or no stockpile; Swallow additionally runs full-HP recovery check. |
| Hail | Existing hail −8 and return; otherwise D's Ice Body gives −8, refunded +8 if A also has Ice Body. |
| Torment / Ingrain / Mud Sport / Water Sport / Camouflage / Gravity / Miracle Eye | −10 when corresponding condition already exists (own battler/field except Torment and Miracle Eye on D). |
| Burn | −10 for Water Veil/Magic Guard, existing status, Fire typing or Safeguard. |
| Helping Hand | −10 outside doubles. |
| Trick / Switcheroo / Knock Off | −10 for target Sticky Hold or no held item. |
| Recycle | −10 if no recyclable item. |
| Imprison | −10 if A already has Imprison or D is already imprisoned. |
| Refresh | −10 unless A has poison, burn or paralysis. |
| Tickle | −10 for Clear Body/White Smoke unless Mold Breaker; Attack at −6: −10, Defense at −6: −8. |
| Cosmic Power / Bulk Up / Calm Mind / Dragon Dance | First stat capped: −10; second capped: −8. With Simple either stat ≥+3: −10. Dragon Dance also −10 under Trick Room. Stat pairs are Def/SpD, Atk/Def, SpA/SpD, Atk/Speed. |
| Healing Wish | Always −20. Another −10 if no reserve or no reserve is wounded/statused. |
| Lunar Dance | Always −20. Another −10 if no reserve, or none is wounded/statused/has spent PP. |
| Natural Gift | −10 unless a listed berry is held; −10 for immunity. |
| Tailwind | −10 under Trick Room or existing own Tailwind. |
| Acupressure | −10 if **any** of seven stats is capped, or any ≥+3 with Simple. |
| Metal Burst | −10 for immunity, D's Stall or **Shiny Stone**; A's Stall/Shiny Stone exits without further penalty; otherwise faster A gets −10. Shiny Stone is the erroneous item-ID comparison intended for Lagging Tail's held effect. |
| Embargo | −10 if D already embargoed. Also −10 in Frontier when D has a nonempty recycle-item slot. |
| Fling | −10 for immunity, Fling power <10 or A's Multitype. Poison/burn/paralysis item-specific rules are below. |
| Psycho Shift | −10 without A status, with D status or D Safeguard. Poison: also A Poison Heal; D Steel/Poison, Immunity/Poison Heal/Magic Guard. Burn: D Fire/Water Veil/Magic Guard. Paralysis: D Limber. |
| Heal Block / Power Trick / Lucky Chant / Aqua Ring | −10 if respective target effect / own Power Trick / own side effect / own Aqua Ring exists. |
| Gastro Acid | −10 if already suppressed or D has Multitype, Truant, Slow Start, Stench, Run Away, Pickup or Honey Gather. |
| Copycat | −10 on battle turn zero if A faster. |
| Power Swap / Guard Swap | −10 if neither target-minus-user relevant stat-stage difference is positive. |
| Last Resort | −10 unless usable. |
| Worry Seed | −10 for Truant/Insomnia/Vital Spirit/Multitype, or sleeping D without Sleep Talk/Snore. |
| Magnet Rise | −10 for existing Magnet Rise, Levitate or Flying typing. |
| Defog | No penalty if D evasion >−6, target screen exists or fog exists. Otherwise −10 with no target reserve; with reserves, −10 unless target-side Spikes/Stealth Rock/Toxic Spikes exists. |
| Trick Room | −10 if A faster **or tied**. |
| Captivate | −10 for target Oblivious/Clear Body/White Smoke unless Mold Breaker; not opposite genders; or Sp. Attack −6. |
| Teleport's flee effect | Unconditionally −10. |

Sources: [sleep through core status/stat checks, 288–689](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L288-L689), [Curse through Stockpile, 690–851](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L690-L851), [modern effects and combined boosts, 853–1180](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L853-L1180), [Fling through Lunar Dance, 1181–1565](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1181-L1565). Effects without a BASIC dispatch get only opening checks.

Fling's secondary-status helpers distinguish harming D from disposing of a harmful item. For poison, if D is Safeguarded/statused/Poison/Steel/Immunity/Poison Heal/Magic Guard, or **A** has Poison Heal, examine A: −5 if A is Safeguarded/statused/Poison/Steel or has Klutz/Immunity/Poison Heal/Magic Guard/Guts; otherwise +3. If D can be poisoned, no secondary modifier. Burn is analogous, using Fire typing, Magic Guard/Water Veil on D and Klutz/Magic Guard/Water Veil/Guts on A. Paralysis gives −5 for D Safeguard, status or Limber. [Fling helpers, 1200–1313](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1200-L1313).

### EXPERT: individual effect handlers

This section covers each dispatch destination and its reachable helper branches. “Standard penalty” is not implied: each row states whether resisted damage changes its score. The unusual aliases matter: Memento uses Explosion; Snore uses the routine named Nightmare (+2), while the actual Nightmare effect is **not** dispatched to it; Tickle uses Defense Down; Cosmic Power and Calm Mind use Sp. Defense Up; Bulk Up uses Defense Up; Roost/Swallow use Recovery; Healing Wish/Lunar Dance share Healing Wish. +1/+2 stat effects share handlers. Two-stage Accuracy/Evasion reduction destinations are swapped here too. Solar Beam's effect is listed twice; its first match reaches the charge handler, making the Thunder routine unreachable by this table. [Dispatch, 1623–1811](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1623-L1811).

| Routine(s) | Exact scoring summary |
| --- | --- |
| StatusSleep | +1 at R≥128 if A knows Dream Eater or Nightmare effect. |
| DrainMove | Resisted: −3 at R≥50. |
| Explosion | D evasion ≥+1: −1; ≥+4 adds another −1 at R≥128. A HP≥80 and not slower: −3 at R≥50, then return. Otherwise HP>50: −1 at R≥50. HP≤50: +1 at R≥128; HP≤30 adds independent +1 at R≥50. |
| DreamEater | Resisted −1; otherwise sleeping D gives +3 at R≥51. |
| MirrorMove | Not slower and last target move in the named move allowlist: +2 at R≥128. Last move outside allowlist: −1 at R≥80, regardless of speed; slow+listed is neutral. |
| StatusAttackUp / StatusSpAttackUp | Stat ≥+3: −1 at R≥100, skipping full-HP bonus. Otherwise full HP: +2 at R≥128. Then HP>70 ends; HP<40 −2; HP40–70 −2 at R≥40 (Attack) or R≥70 (SpA). |
| StatusDefenseUp / StatusSpDefenseUp | Same initial ≥+3 penalty/full-HP bonus. HP≥70 skips remaining penalty on R<200. Otherwise HP<40 gives −2; last move power zero gives −2 at R≥60; opposite damage class gives certain −2; matching class needs **two** R≥60 gates. For Defense the opposite is special; for SpD physical. |
| StatusSpeedUp | Not slower: −3; slower: +3 at R≥70. |
| StatusAccuracyUp | Stage ≥+3: −2 at R≥50; additionally HP≤70: −2. |
| StatusEvasionUp | HP≥90: +3 at R≥100. Stage≥+3: −1 at R≥128. Toxic D: +3 at R≥50, with preceding R≥80 gate if A HP≤50. Seeded D +3 at R≥70; A Ingrain or Aqua Ring +2 at R≥128 (once); cursed D +3 at R≥70. Finally, if A HP≤70 and its evasion≠0: −2 certainly when either HP<40, else at R≥70. |
| BypassAccuracyMove | D evasion≥+5 or A accuracy≤−5: +1 plus another +1 at R≥100. Otherwise D evasion≥+3 or A accuracy≤−3: +1 at R≥100. |
| StatusAttackDown / StatusSpAttackDown | If target stage≠0: −1, additional −1 when A HP≤90, and −2 at R≥50 if stage≤−3. Independently target HP≤70: −2. Last target move opposite class (special for Attack, physical for SpA): −2 at R≥128. |
| StatusDefenseDown / StatusSpDefenseDown / StatusEvasionDown | If A HP<70 **or** target corresponding stage≤−3: −2 at R≥50; independently D HP≤70: −2. |
| SpeedDownOnHit | Only Icy Wind/Rock Tomb/Mud Shot, and only nonresisted, run StatusSpeedDown. |
| StatusSpeedDown | Not slower −3; slower +2 at R≥70. |
| StatusAccuracyDown | If A HP<70 **or** D HP≤70: −1 at R≥100. A's own accuracy≤−2: −2 at R≥80. Toxic/seeded/cursed D each +2 at R≥70; A Ingrain/Aqua Ring +1 at R≥128 once. If A HP≤70 and D accuracy≠0: −2 certainly if either HP<40, otherwise R≥70. |
| Haze | A Atk/Def/SpA/SpD/Evasion≥+3 or D Atk/Def/SpA/SpD/Accuracy≤−3: −3 at R≥50. Then reverse beneficial pattern (D positives, A negatives in those same role-specific sets): +3 at R≥50; absent beneficial pattern, −1 at R≥50. Both passes may apply. Speed omitted. |
| Bide | −2 at A HP≤90. |
| ForceSwitch | D active >3 turns: independent +2 at R≥64 and +2 at R≥128. Otherwise any target-side entry hazard or D Atk/Def/SpA/SpD/Evasion≥+3: +2 at R≥128; otherwise −3. |
| Conversion | A HP≤90 −2; nonzero battle turn additionally −2 at R<200. |
| Synthesis | Rain/hail/sand −2, then Recovery. |
| Recovery | Full HP −3. Otherwise **not slower −8**. Slower with HP≥70: R≥30 gives −3 and exits, R<30 proceeds; below70 proceeds directly. Proceeding gives +2 at R≥20; known target Snatch additionally requires R≥100. The alternative faster HP helper is unreachable. |
| ToxicLeechSeed | If A has damaging moves: A HP≤50 and D HP≤50 each independently −3 at R≥50. With no damaging moves skip both. Knowing SpD-up effect or Protect gives +2 at R≥60. |
| LightScreen / Reflect | HP<50 −2 and stop. Otherwise HP≥90 +1 at R≥128; independently last target move special/physical respectively +1 at R≥64. |
| Rest | Not slower: full HP −8; HP>50 −3; HP40–50 proceeds only on R<70 else −3; HP<40 proceeds. Slower: HP>70 −3; HP60–70 proceeds only R<50 else −3; HP<60 proceeds. Proceeding yields +3 at R≥10, with extra R≥50 if target knows Snatch. |
| OHKOMove | +1 at R≥192. |
| SuperFang | D HP≤50: −1. |
| BindingMove | +1 at R≥128 if D toxic, cursed, under Perish Song or attracted. Also used by Mean Look effects. |
| HighCritical | Resisted neutral; 2×/4× +1 at R≥128; neutral effectiveness needs two R≥128 gates. |
| Swagger / Flatter / StatusConfuse | Swagger with Psych Up takes separate path: D Attack≤−3 gives +3, plus +2 on turn zero; otherwise −5. Without Psych Up, Swagger/Flatter +1 at R≥128, then Confuse. Confuse: D HP≤70 gives −1 at R≥128; HP≤50 adds certain −1; HP≤30 adds another certain −1. |
| StatusPoison | −1 if A HP<50 or D HP≤50. |
| StatusParalyze | Slower +3 at R≥20; otherwise −1 if A HP≤70. |
| VitalThrow | Slower or HP>60 neutral; HP<40 −1 at R≥50; HP40–60 needs R≥180 then R≥50 for −1. |
| Substitute | Knows Focus Punch: +1 at R≥96. HP≤90/70/50 adds respectively one/two/three independent −1 trials at R≥100. If not slower, and last target effect is sleep/poison/toxic/paralysis/burn/confusion/Leech Seed and **D** lacks that corresponding condition, +1 at R≥100. |
| RechargeTurn | Resisted −1. Otherwise Truant +1 at R≥80. Without Truant, not slower HP>40 or slower HP≥60: −1. |
| Disable | Slower neutral. Otherwise last target move power>0: +1; power0: −1 at R≥100. |
| Counter / MirrorCoat | Target asleep/attracted/confused: −1 and stop. A HP≤30 −1 at R≥10; HP≤50 independent −1 at R≥100. Knowing other retaliation move: +4 at R≥100 and stop. Otherwise target last damaging move: taunted target adds +1 at R≥100; wrong damage class −1, matching class +1 at R≥100. Last move power0: taunt bonus as above; if neither target type is in corresponding legacy physical/special type set, +4 after R≥50 then R≥100. A type in that set gives no final bonus. |
| Encore | Disabled target, or not-slower A with last target effect in encouraged-effect table: +3 at R≥30. Otherwise −2. |
| PainSplit | +1 iff D HP≥80 and A HP≤40 (not slower) / ≤60 (slower); otherwise −1. |
| Nightmare-named routine | +2 unconditionally; dispatch reaches it for **Snore**, not Nightmare. |
| LockOn | +2 at R≥128. |
| SleepTalk | Asleep +10, awake −5. |
| DestinyBond | Always −1. If not slower: HP≤70 +1 at R≥128, HP≤50 another +1 at R≥128, HP≤30 another +2 at R≥100. |
| Reversal | Not slower: HP>33 −1, HP21–33 neutral, HP8–20 +1 at R≥100, HP<8 adds certain +1 before that trial. Slower: HP>60 −1, HP41–60 neutral, HP≤40 +1 at R≥100. |
| HealBell | −5 if neither A nor a party member has status. |
| Thief | Target held-effect in desirable list: +1 at R≥50; otherwise −2. |
| Curse | Ghost HP≤80: −1. Non-Ghost Defense>+3 neutral. Otherwise knows Gyro Ball/Trick Room: +1 at R≥32; on success additionally +1 at R≥128; without those moves just the R≥128 trial. Defense≤+1 adds independent +1 at R≥128; Defense≤0 adds another. |
| Protect | Target knows Feint/Shadow Force: −2 at R≥128. Chain>1: −2 and stop. A toxic/cursed/perishing/attracted/seeded/yawning, or D knows Recover/Defense Curl effect: −2 unless A locked-on (then neutral), and stop. Otherwise D with those conditions, doubles, A locked-on, or R<85: +2. Then −1 at R≥128. Nonzero chain adds −1 and another −1 at R≥128. |
| Spikes / ToxicSpikes / StealthRock | R<128 ends unchanged; otherwise +1, and if Roar/Whirlwind known, +1 at R≥64. |
| Foresight | Checks **A** Ghost typing: +2 after two R≥80 gates. Non-Ghost A and D evasion≥+3: +2 at R≥80; otherwise −2. |
| Endure | HP<4 or HP≥35: −1; HP4–34: +1 at R≥70. |
| BatonPass | A Atk/Def/SpA/SpD/Evasion≥+3: +2 at R≥80 when HP≤60 (not slower) or ≤70 (slower), otherwise neutral. If only +2 boosts: neutral at HP≤60 (not slower) or HP<70 (slower), else −2. No ≥+2 boost: −2. |
| Pursuit | First active turn or Ghost/Psychic D: +1 at R≥128; independently target U-turn known: +1 at R≥128. |
| RainDance | Not-faster Swift Swim: +1 and return. Otherwise HP<40 −1. Else replacing hail/sun/sand, Rain Dish, or statused Hydration A: +1. |
| SunnyDay | HP<40 −1; otherwise replacing hail/rain/sand, Flower Gift, or **already statused** Leaf Guard A: +1. |
| BellyDrum | HP<90 −2. |
| PsychUp | Requires D Atk/Def/SpA/SpD/Evasion≥+3 else −2. Then any A first-four stat≤0: +1; otherwise A evasion≤0: +2; otherwise −2 at R≥50. |
| ChargeTurnNoInvuln | Resisted −2; otherwise Solar Beam in sun or Power Herb +2. Otherwise target Protect known −2; otherwise HP≤38 −1. Covers Razor Wind/Sky Attack/Skull Bash/Solar Beam charge effects. |
| Thunder | Unreachable via normal EXPERT dispatch. If invoked, resisted or sunny: −3 at R≥50; rain +1. |
| ChargeTurnWithInvuln / ShadowForce | Fly/Dive/Dig/Bounce: Power Herb +2 and return; known target Protect −1 and return; otherwise enter ShadowForce. ShadowForce: resisted **+1**; Power Herb +1; otherwise toxic/cursed/seeded target, sand-immune A under sand, Ice A under hail, or not-slower A whose target last effect was not Lock-On: +1 at R≥80. Otherwise neutral. |
| FakeOut | +2. |
| SpitUp | At least two stockpiles: +2 at R≥80. |
| Hail | HP<40 −1; otherwise only when replacing sun/rain/sand: +1, plus +2 for Blizzard known, plus +2 for Ice Body. Clear weather gives none of these bonuses. |
| Facade | +1 when **D**, not A, has poison/burn/paralysis. |
| FocusPunch | Resisted −1; otherwise own Substitute +5; sleeping D +1; attracted/confused D +1 at R≥100; otherwise after A's first active turn +1 at R≥200. |
| SmellingSalts | Paralyzed D +1. |
| Trick | See dedicated item matrix below. |
| ChangeUserAbility | A already has desirable ability: −1; otherwise D desirable ability +2 at R≥50; neither desirable −1. Shared by Role Play/Skill Swap. |
| Ingrain / GyroBall | No EXPERT modifier. |
| Superpower | Resisted or A Attack<0: −1; otherwise −1 if not-slower HP>40 or slower HP≥60. |
| MagicCoat | D HP≤30 −1 at R≥100. First active turn +1 at R≥150; later −1 at R≥30. One extra random instruction is unreachable. |
| Recycle | Recycled Chesto/Lum/Starf Berry +1 at R≥50; all other items −2. |
| Revenge | D asleep/attracted/confused −2; otherwise R<180 gives −2, R≥180 gives +2. |
| BrickBreak | Target Reflect or Light Screen +1. |
| KnockOff | D HP≥30 and A **not** first active turn: +1 at R≥180. |
| Endeavor | +1 iff D HP≥70 and A HP≤40 (not slower) / ≤50 (slower); otherwise −1. |
| WaterSpout | Resisted −1. Otherwise **D** HP≤50 (not slower A), or D HP≤70 (slower A): −1. |
| Imprison | A **not** first active turn: +2 at R≥100. |
| Refresh | D HP<50: −1. |
| Snatch | First active turn +2 at R≥150. Later initially R<30 ends. Slower with D HP≤25: known Recover/Defense Curl effect gives +2 at R≥150; otherwise R≥230 gives +1, failing that −2 at R≥30. Other cases −2 at R≥30; not-slower A at full HP with D HP≥70 has an extra R<60 neutral exit first. |
| MudSport / WaterSport | A HP≥50 and D Electric/Fire respectively: +1; otherwise −1. |
| Overheat / CloseCombat | Resisted −1; otherwise −1 if A HP≤60 (not slower) / ≤80 (slower). |
| DragonDance | Slower +1 at R≥128; not slower and HP≤50 −1 at R≥70. |
| Gravity | D Levitate/Magnet Rise/Flying: +1 at R≥64. Otherwise A HP≥60 gets +1 only after R<128 then fresh R≥64. |
| MiracleEye | Dark D: +2 after two R≥80 gates. Otherwise D evasion≥+3: +2 at R≥80; else −2. |
| WakeUpSlap | Resisted −1; otherwise sleeping D +1. |
| HammerArm | Resisted −1; otherwise slower A +1. |
| Brine | Resisted −1; otherwise D HP≤50 +1 plus another +1 at R≥128. |
| Feint | Proceed if Protect known, or R<64; otherwise neutral. A toxic/cursed/perishing/attracted/seeded/yawning, or wounded D with Leftovers/Black Sludge: +1 at R≥128. Then D Protect chain 0 **or exactly 2**: +1 at R≥128; chain1: +1 at R≥192; chain>2: −2. |
| Pluck | Resisted −1; otherwise first active turn +1 at R≥64; all nonresisted cases independent +1 at R≥128. |
| Tailwind | R<64 neutral. Otherwise faster A or HP<31: −1. HP>75: +1; HP31–75: +1 at another R≥64. |
| Acupressure | HP<51 −1; HP>90 +1 at R≥64; HP51–90 needs R≥128 then R≥64. |
| MetalBurst | D asleep/attracted/confused, or knows Revenge/Focus Punch/Vital Throw effects: −1 and stop. Otherwise HP≤30 −1 at R≥10; HP≤50 −1 at R≥100; independently +1 at R≥192. Taunted D adds +1 at R≥100, with an extra independent +1 at R≥100 if its last move had nonzero power. |
| UTurn | Resisted −1. No reserves neutral. Own super-effective move: −2 at R≥64. If no reserve outdamages A, R≥64 gives −2 and exits. Otherwise D HP>70: +1 at R≥64, then +1 at R≥128; HP31–70: only latter; HP≤30: latter only after an extra R≥128. Faster A then +1, otherwise +1 at R≥128. |
| Payback | Resisted −1; otherwise not-faster A with HP≥30: +1 at R≥64. |
| Assurance | Resisted −1; faster A neutral. Otherwise Rough Skin or recoil berry A: +1 at R≥128; other A requires preceding R<128. |
| Embargo | +1 at R≥128. |
| Fling | Resisted: −1 unless A's held effect is in favorable-fling list. Otherwise power<30 −2; power30–60 −1 at R≥128; power61–90 +1 at R≥64; power>90 and 2×/4× gives +4 plus +1 at R≥64; power>90 neutral effectiveness gives independent +1 at R≥128 and +1 at R≥64. |
| PsychoShift | No A status −10. Otherwise D HP≥30: +1 at R≥128. |
| TrumpCard | Resisted −1. PP1 +3; PP2 +1 and extra +1 at R≥100; PP3 +1 at R≥100. At higher PP, target Pressure adds +1 at R≥30; accuracy/evasion then follows BypassAccuracyMove's +1/+2 pattern. |
| HealBlock | +1 at R≥25 if target knows any listed recovery/drain/Leech Seed/Healing Wish/Lunar Dance effect, A is seeded, or D has Aqua Ring/Ingrain. Without evidence requires extra R<96 first. |
| WringOut | Resisted or D HP<50 −1. D full HP: +1 (slower A) or +2 (not slower), plus +1 at R≥25. D HP86–99: +1 at R≥25. HP50–85 neutral. |
| PowerTrick | HP≤30 −2; HP31–60 +1 at R≥164; HP61–90 +1 at R≥128; HP>90 +1 at R≥96. Does not compare actual Attack/Defense. |
| GastroAcid | R<64 neutral. Else +1; then D HP≤70 adds −1 at R≥128, HP≤50 certain −1, HP≤30 another certain −1. |
| LuckyChant | A HP<70 −1. Otherwise known high-critical/high-critical burn/high-critical poison effect gives +1; without evidence +1 at R<64. |
| MeFirst | Slower −2. Otherwise if D outdamages A, +1 at R≥32. Last target move status: +1 at R≥64; nonstatus: R<128 exits, else +1 and another +1 at R≥64. |
| Copycat | Not slower and D outdamages A: +2 at R≥32. Otherwise not slower with encouraged target previous move: +2 at R≥128. Remaining cases: if D does not outdamage A and last move not encouraged, −1 at R≥80. |
| PowerSwap / GuardSwap | Stage-difference matrix and descending random award, below. |
| Punishment | Resisted neutral. Sum of D positive stages≥7: independent +4/+3/+2/+1 each at R≥128; sum6: +3/+2/+1; sum5: +2/+1; sum3–4: +1; ≤2 neutral. Bonuses **accumulate**, unlike swaps. |
| LastResort | Resisted −1; otherwise usable +1. |
| WorrySeed | D knows Rest +1. A HP≥50 +1 at R≥128. All cases +1 at R≥64. |
| SuckerPunch | Resisted −1; otherwise +1 at R≥64. No prediction that D selected an attack. |
| HeartSwap | Requires D Atk/Def/SpA/SpD/Evasion≥+2 or Focus Energy; else −2. Any A first-four stage≤0 gives +1; else A evasion≤0 gives +2; else A lacks Focus Energy gives +1; otherwise −2 at R≥50. |
| AquaRing | A HP≥30: +1 at R≥128. |
| MagnetRise | A HP<50 neutral. Otherwise known Earthquake/Earth Power/Fissure +1; target Ground type adds +1, otherwise +1 at R≥128. |
| Defog | Target screens: if A HP≤30 and no reserves, skip screen reward and enter −2 random check; otherwise +1. If D has no reserves return; target hazards additionally −1 at R≥128. Without screens, target hazards −2. Then ordinary Evasion Down HP/stage penalties. |
| TrickRoom | Doubles neutral. Singles A HP≤30 with no reserves neutral; otherwise slower +3 at R≥64, not slower −1. |
| Blizzard | Resisted −3 at R≥50; otherwise hail +1. |
| Captivate | Same initial nonzero-stage/HP/low-stage rules as SpA Down. Target HP≤70 −2. Last target move physical: −1 at R≥64 (rather than SpA Down's −2 coin flip). |
| RecoilMove | Nonresisted with Rock Head/Magic Guard +1; otherwise neutral. |
| HealingWish | A HP≥80 and not slower: −5 at R≥192 and return. Other cases HP>50: −1 at R≥50. HP≤50: R≥192 adds +1 and opens further checks: absence of own super-effective move adds +1 at R≥192; stronger reserve adds +1 at R≥128. HP≤30 independently adds +1 at R≥128 even when initial trial fails. |

Sources by contiguous handler group: [1813–2572](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1813-L2572), [2574–3406](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L2574-L3406), [3408–3931](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L3408-L3931), [3933–4779](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L3933-L4779), [4782–5630](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L4782-L5630), [5632–6350](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L5632-L6350).

Power Swap/Guard Swap use target-minus-user stage difference for physical and special stats respectively. Choose a maximum award using this matrix; “none” means no modifier. Starting at that award N, each fresh coin R≥128 awards N and returns; R<128 tries N−1, continuing down through 1; failure at 1 awards nothing. Thus maximum5 is not a flat 50% +5/50% zero rule. [Swap matrices, 5632–5898](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L5632-L5898).

| Physical difference | Special ≥4 | Special 2–3 | Special 1 | Special 0 | Special negative |
| --- | --- | --- | --- | --- | --- |
| ≥4 | 5 | 4 | none | 3 | none |
| 2–3 | 4 | 3 | none | 2 | none |
| 1 | 3 | 2 | none | 1 | none |
| 0 | 3 | 2 | 1 | none | none |
| negative | none | none | none | none | none |

Trick/ Switcheroo item matrix: normally −3. A disruptive held effect (the three Choice effects, Iron Ball, forced-last items, Sticky Barb, and the six Power training item effects) gives +5 unless D already has a listed bad effect. Toxic Orb gives +5 if D is susceptible; if not, +5 only if A is susceptible and not Klutz, else −3. Flame Orb is analogous, except A Klutz takes shared −5. Black Sludge gives +5 against non-Poison D without Magic Guard; otherwise +5 if A is non-Poison, not Magic Guard/Klutz, else −3. The target-Magic-Guard Sludge branch erroneously uses the **poison susceptibility** helper. Flavor-confusion berries give +2 at R≥50 unless D already has a bad/flavor-berry effect, then −3. Poison susceptibility excludes status/Safeguard/Poison/Steel/Immunity/Magic Guard/Poison Heal; burn excludes status/Safeguard/Fire/Water Veil/Magic Guard. Macho Brace is missing from the disruptive-effect list despite related training items being included. [Trick, 4176–4413](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L4176-L4413).

### Tables and coverage boundaries

Keep these lookup tables in the imported AI program; do not recreate them as a second strategy implementation. Tests may use small independently authored sets to prove interpreter behavior. Named sets and source anchors: Natural Gift supported berries [1067–1131](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1067-L1131); Fling status effects [1295–1313](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1295-L1313); Mirror Move's move names [1928–1976](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L1928-L1976); Encore's encouraged effect names [3202–3285](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L3202-L3285); Thief's desirable held effects [3424–3450](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L3424-L3450); Trick's held-effect categories [4335–4413](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L4335-L4413); Role Play/Skill Swap desirable abilities [4435–4461](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L4435-L4461); Recycle Chesto/Lum/Starf [4536–4540](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L4536-L4540); Feint Leftovers/Black Sludge [4952–4955](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L4952-L4955); Assurance Jaboca/Rowap effects [5218–5221](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L5218-L5221); Fling desirable effects [5288–5294](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L5288-L5294); Copycat move names [5582–5630](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L5582-L5630). Counter's and Mirror Coat's legacy type lists remain live; similarly named historical type lists beside stat-up, stat-down and screens are unused. These anchors are necessary for exact set membership; the routine catalogue does not silently replace them with all moves of a general category.

Implementation tests should assert branch outcomes rather than trust the decomp's explanatory comments. Confirmed comment/code disagreements include Explosion's high-evasion cutoff (+4, not +3), its two low-HP bonuses accumulating, SpA-up's middle-HP random threshold70 (not Attack's40), Defense/SpD-up class branches and two-draw probabilities, Accuracy-up's ≤70 boundary, attack reductions penalizing the opposite class, accuracy-reduction's OR condition, Haze's fallback randomized −1, ForceSwitch's stacking +2 awards, Recovery's unconditional faster −8, and Feint chain2 following the chain0 route. These are directly visible in the pinned bodies above; compatibility should follow executed branches.

## Auxiliary scoring routines

These rules add to earlier flags; they do not replace BASIC/EXPERT. `r` means a fresh `RandNext % 256` at that branch, not a single random number shared across the routine. Unless stated otherwise, these routines immediately return for an ally target. Probabilities below are exact counts out of 256; a branch that returns ends this flag's evaluation of this move.

### EVAL_ATTACK (bit 1)

Evaluate maximum, non-critical predicted damage first. A predicted KO gives +4; effect `PRIORITY_1` gives another +2 (total +6), regardless of the move's numeric priority field. Explosion/Self-Destruct's effect gets no KO bonus. Future Sight's effect gets +4 only when r ≥170 (86/256). Focus Punch and Sucker Punch are listed in that latter branch but cannot reach it through the damage-eligibility helper. If not a KO, a move strictly out-damaged by another eligible move gets −1 and returns. Otherwise Explosion, Focus Punch and Sucker Punch lose 2 when r ≥51, then continue. A quadruple-effective move gains 2 when a subsequent r ≥80 (176/256). No-comparison moves can reach these later checks. [EvalAttack rules](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6353-L6417).

### SETUP_FIRST_TURN (bit 3)

Only whole-battle turn 0 qualifies; a later switch-in does not reset this gate. A listed setup effect gains +2 when r ≥80. The list covers all seven single-stat raises/drops by one or two stages; Conversion/Camouflage; Light Screen/Reflect; Focus Energy; confusion/poison/paralysis/burn; Substitute, Leech Seed, Minimize, Curse, Swagger/Flatter, Yawn, Defense Curl, Torment, Ingrain, Imprison, Teeter Dance, Tickle, Cosmic Power, Bulk Up, Calm Mind, Tailwind, Acupressure, Lucky Chant, Magnet Rise, Defog and Whirlpool. Dragon Dance's combined Attack/Speed effect is **not** listed. Ordinary poison is listed; Toxic's badly-poison effect is not. Duplicate entries (Sp. Def +2, Camouflage) do not award a second bonus. [Setup gate and membership](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6417-L6498).

### RISKY (bit 4)

A listed effect gains +2 when r ≥128. Membership: sleep, Explosion/Self-Destruct, Mirror Move, OHKO, high-critical-hit, confusion, Metronome, Psywave, Counter, Destiny Bond, Swagger, Attract, Present, all-stat-raising attacks, Belly Drum, Mirror Coat, Focus Punch, Revenge, Teeter Dance, Gyro Ball, Acupressure, Metal Burst, Payback, Me First and Sucker Punch. This is an effect list, so every move sharing one of those effects receives the rule. [Risky](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6521-L6563).

### PRIORITIZE_EXTREMES (bit 5)

Call the maximum-damage comparison. Only `AI_NO_COMPARISON_MADE` qualifies, gaining +2 when r ≥100 (156/256). This is not a general bonus for high power or variable power: eligibility depends on the imported no-calculation and alternate-power lists, with alternate-power eligibility taking precedence. [Extremes](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6499-L6517), [damage eligibility](../../packages/battle/src/ai/calc.ts).

### BATON_PASS (bit 6)

Require an eligible reserve and a no-comparison move. If the user knows the Baton Pass effect, proceed; otherwise r <80 returns. Then:

| Move/effect | Added score |
|---|---|
| Swords Dance, Dragon Dance, Calm Mind, Nasty Plot (move IDs) | Whole-battle turn 0: +5; otherwise HP% <60: −10; otherwise +1. |
| Protect effect | Previous move Protect or Detect: −2; otherwise +2. |
| Baton Pass itself | Whole-battle turn 0: −2. Otherwise examine Attack first: above neutral by 3+ gives +3, by 2 gives +2, by 1 gives +1, then return. Only if Attack is not positive, apply the same checks to Sp. Atk. These bonuses are **not summed**. |
| Any other no-comparison move | r <20 returns; otherwise add +3 **and fall through** to the setup rule: total +8 on turn 0, −7 below 60% later, +4 otherwise. |

The generic fall-through and Attack-before-Sp. Atk ordering matter more than the comments' suggested intent. [Baton Pass](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6564-L6636).

### CHECK_HP (bit 8)

An ally target jumps to `TagStrategy_Partner` instead of returning. For a foe, compute integer HP percentages independently for user then target. In each pass, membership in that HP band's list causes −2 if a fresh r ≥50 (206/256); then the next pass still runs. Total penalty is 0, −2 or −4. Bands are >70, 31–70 and ≤30. The following grouping is exhaustive; it is a prose membership description, not a replacement data table. [Control flow](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7696-L7747).

Let **S** mean the fourteen single-stat ±1 effects and fourteen single-stat ±2 effects for Attack, Defense, Speed, Sp. Atk, Sp. Def, Accuracy and Evasion. Let **C** mean Tickle, Cosmic Power, Bulk Up, Calm Mind and Dragon Dance's combined-stat effects. All following names describe effects, including other moves sharing them.

| Pass/band | Discouraged effects |
|---|---|
| User >70% | Explosion/Self-Destruct, half-HP recovery, Rest, Destiny Bond, Flail/Reversal, Endure, weather-dependent half healing, Memento, Grudge, Roost, Healing Wish, Lunar Dance. |
| User 31–70% | S + C; Explosion, Bide, Conversion, Light Screen, Mist, Focus Energy, Conversion 2, Safeguard, Belly Drum, Lucky Chant, Power Swap, Guard Swap, Captivate. |
| User ≤30% | S + C; Bide, Conversion, Light Screen, Mist, Focus Energy, Rage, Conversion 2, Lock-On/Mind Reader, Safeguard, Belly Drum, Psych Up, Mirror Coat, Eruption/Water Spout, Mud Sport, Water Sport, Acupressure, Metal Burst, Captivate. |
| Target >70% | Empty list: never penalized in this pass. |
| Target 31–70% | S + C; Mist, Focus Energy, ordinary poison, Pain Split, Perish Song, Safeguard, Acupressure, Wring Out/Crush Grip, Captivate. |
| Target ≤30% | S + C; sleep, Explosion, Bide, Conversion, Toxic, Light Screen, OHKO, Super Fang, Mist, Focus Energy, confusion, ordinary poison, paralysis, Pain Split, Conversion 2, Lock-On/Mind Reader, Spite, Perish Song, Swagger, Fury Cutter, Attract, Safeguard, Psych Up, Mirror Coat, burn, Acupressure, Wring Out/Crush Grip, Captivate. |

The duplicate Super Fang membership in the source does not apply the penalty twice. [User tables](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7748-L7865), [target tables](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7866-L7978).

### WEATHER (bit 9)

Require whole-battle turn 0. Sun/rain/sand/hail effects compare the corresponding current weather and return if already present; otherwise require that this is the user's first turn in battle and add +5. **A non-weather effect falls through into the sun check**, so it also gains +5 under those gates unless current weather is sunny. Do not implement the comment's apparent weather-only intention. [Weather](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7979-L8020).

### HARRASSMENT (bit 10; source spelling)

Listed effects gain +2 when r ≥128. Membership: sleep; Attack/Defense/Accuracy/Evasion −1; Attack/Defense/Speed/Sp. Def −2; confusion, poison, paralysis, Leech Seed, Encore, Spite, Spikes, Swagger, Attract, Torment, Flatter, burn, Nature Power, Yawn, Knock Off, Imprison, Secret Power, Teeter Dance, Tickle, Camouflage, Embargo, Psycho Shift, Toxic Spikes, Defog and Captivate. The uneven stat-drop membership is intentional fidelity, not shorthand for all stat drops. [Harassment](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L8021-L8072).

### Unused and special entries

Bits 11–28 point to `Terminate`, which returns without a score change. Bits 29–31 are special battle modes, not ordinary trainer intelligence tiers. [Entry table](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L15-L49).

- **ROAMING_POKEMON:** binding/Mean Look or defender Shadow Tag prevents the escape command. Otherwise the attacker's effective Levitate bypasses the Arena Trap check; without it, defender Arena Trap prevents escape. If none applies, set Escape. This script does not independently check Flying typing or Magnet Pull; distinguish it from the controller's escape legality. [Roamer](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L8073-L8090).
- **SAFARI:** reaches Dummy3E/3F before Escape. Those native handlers do not advance the cursor, so ordinary interpreter execution hangs; our interpreter throws explicitly. This is not a functional Safari strategy to enable through a trainer mask. [Special tail](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L8091-L8095), [current interpreter policy](../../packages/battle/src/ai/script.ts).
- **CATCH_TUTORIAL:** Escape when target integer HP% ≤20, otherwise return without changing scores. The tutorial controller interprets its sequence separately; Escape is not evidence that the tutorial should literally flee instead of catching. [Tutorial and terminal routine](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L8096-L8108).

Auxiliary-flag scenarios (planned, ROM-gated script with original state; isolate the named flag, no switch/item and no ally target):

| Controlled case | Expected score/choice |
|---|---|
| SETUP_FIRST_TURN; Swords Dance versus ordinary attack; turn 0, setup branch r=80 | 102 versus 100: Swords Dance. r=79 or whole-battle turn 1 leaves 100/100: controlled tie draw determines the choice. |
| RISKY; confusion effect versus plain attack; r=127 then 128 | Confusion 100 then 102; second case uniquely chooses confusion against 100. |
| PRIORITIZE_EXTREMES; status effect versus an ordinary comparable attack; r=99 then 100 | Status 100 then 102; only the latter uniquely wins. |
| BATON_PASS; user knows Baton Pass, has a reserve; an otherwise generic no-comparison move; r=20 | Turn 0 scores 108; turn 1 at 59% scores 93, at 60% scores 104. Against a 100 competitor: generic move, competitor, generic move respectively. |
| BATON_PASS; Baton Pass itself; turn 1, Attack +1 and Sp. Atk +6 | Score 101, not 104 or 107: Attack's first matching branch returns. Against alternative 100, choose Baton Pass. |
| CHECK_HP; Attack +1 effect; both user and foe at 70%, penalty draws 50/50 | Score 96. At 71% both lists omit this effect: 100. Pair with ordinary attack 100: attack wins in first case, controlled tie in second. |
| WEATHER; ordinary non-weather attack and Rain Dance; clear weather, turn 0 and first turn for user | Both 105 due to fall-through, so tie. In sun: plain attack 100, Rain Dance 105, choose Rain Dance. |
| HARRASSMENT; ordinary poison versus plain attack; r=128 | Poison 102 versus 100, choose poison. Toxic does not inherit this flag's ordinary-poison bonus. |
| CATCH_TUTORIAL; foe HP 20/100 then 21/100 | Escape override at 20; ordinary move selection at 21. |

## Tag Strategy (bit 7): exhaustive handler rules

All deltas below add to scores left by earlier flags. `r` is a fresh low-byte draw in [0,255] at each random test; sequential tests use independent draws. Percent HP uses integer truncation. Default is no additional delta unless stated. Partner-target handling branches before the ordinary enemy-target damage logic. The dispatcher and common damage path are at [script lines 6637–6753](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6637-L6753).

**Enemy-target common damage path.** Moves that the damage comparator does not score go straight to special handling. OHKO, Sonic Boom-like fixed 20, Dragon Rage-like fixed 40, level damage and Psywave effects skip resistance penalties. Otherwise half/quarter effectiveness gets −1/−2 when maximum damage does not KO, the defender's partner is alive, and r >= 64. Next compare maximum damage against the partner's moves too: if this move is highest on the attacking side, Explosion/Self-Destruct goes straight to special handling; priority +1 gets +1 when r >= 50; other highest-damage moves get +1 when r >= 128. Successful highest-damage bonuses skip super-effective scoring; failed random checks and non-highest moves enter it. There, fixed/OHKO effects skip; ×2 gets +1 when r >= 100, ×4 gets +1 when r >= 64. Then special handling applies.

Special enemy-target dispatch is ordered: Skill Swap; Earthquake/Magnitude; Future Sight/Doom Desire; Rain Dance; Sunny Day; Hail; Sandstorm; Gravity; Trick Room; Follow Me; Electric moves; Fire moves; Water moves; then other moves if the partner knows Helping Hand. Each handler exits rather than falling through to later handlers.

| Handler | Exact added scoring |
|---|---|
| Rain Dance | For self and partner separately: Hydration with any major status, or Dry Skin, gives +2; maximum +4. |
| Sunny Day | For self/partner separately: Leaf Guard while unstatused and HP >=30 gives +2; Flower Gift +2; Dry Skin −2; Solar Power gives +1 at HP >=50, **then in all Solar Power cases** another −2 when r >=128. Thus high-HP Solar Power gives +1 or −1, not an unconditional +1. |
| Hail | Each ally gets one +2 if Ice Body, Snow Cloak **or** knows Blizzard; these conditions do not stack within one battler. |
| Sandstorm | Each ally gets one +2 if Sand Veil or a Rock type. |
| Gravity | Already active: −30 and stop. Otherwise each ally with Levitate, Flying typing or Magnet Rise gets one −5; each enemy with any of those gets one +3 when r >=64. |
| Trick Room | Any other battler at zero HP: −30. With speed ranks 0 fastest through 3 slowest: self 0 with ally rank 0/1 gives −30; self 1 with ally 0 gives −30; self/ally ranks 2/3 or 3/2 gives +5 if r >=64, otherwise −5; all other rank combinations −5. |
| Follow Me | Each listed delta happens only when r >=64. Self HP >90: ally >90/ >50/ >30/ <=30 gives −1/+1/+2/+3. Self HP >50 through 90: −2/−1/+1/+2. Self HP >30 through 50: −2/−2/+1/+2. Self <=30: −5 regardless of ally HP. |
| Partner knows Helping Hand (default-handler path only) | +1 for a damage-comparable move except the five flat/OHKO effects above. |

Sources: [weather and Gravity](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6755-L6975), [Trick Room and Follow Me](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L6976-L7114), [Helping Hand and unused handlers](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7116-L7140).

| Handler | Exact added scoring |
|---|---|
| Earthquake/Magnitude | Ally Magnet Rise, Levitate or Flying: +2. Else ally Fire/Electric/Poison/Rock: −10. Else −3. Steel is omitted from the weak-type checks; ally life is not tested. |
| Future Sight/Doom Desire | If no live ally or ally knows neither delayed attack, 0. Otherwise self speed rank 3 gives −3; self rank 2 gives −3 if ally rank 0/1, or r >=128 and ally rank 2; self rank 1 gives −3 if ally rank 0, or r >=128 and ally rank 1; self rank 0 gives −3 only if r >=128 and ally rank 0. |
| Skill Swap | Self Truant/Slow Start/Stall/Klutz: +5 and stop. Else target Shadow Tag/Pure Power/Huge Power/Mold Breaker/Solid Rock/Filter/Flower Gift: +2. |
| Electric, except Discharge | Defender's ally Lightning Rod: −1, with another −8 if Ground; own ally Lightning Rod adds −10. |
| Discharge | Own ally Motor Drive/Volt Absorb: +3; else Water/Flying: −10; else Ground: +3; else −3. The ordering penalizes Water/Ground and Flying/Ground despite immunity. |
| Water, except Surf | Defender's ally Storm Drain: −1; own ally Storm Drain adds −10. |
| Surf | Own ally Dry Skin/Water Absorb: +3; else Ground/Fire: −10; else −3. Rock weakness is omitted. |
| Fire | Self Flash Fire already activated: +1. For Lava Plume, additionally: ally Dry Skin −3; else Flash Fire +3; else Grass/Steel/Ice/Bug −10; else −3. The Dry Skin branch is **negative**, despite the source comment. |

Sources: [Earthquake through Skill Swap](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7142-L7237), [type/redirection/spread handlers](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7239-L7338).

**Partner-target branch.** If the partner is marked fainted/switching by the corresponding opcode, −30 immediately. For damage-comparable moves: Fire uses Flash Fire logic; Electric uses absorption logic; Water uses absorption logic; Fling gives 0; all other damaging moves get −30. Fire/Electric/Water are tested before Fling. Non-comparable moves enter the explicit status-handler list; all unlisted moves receive −30. [Partner dispatcher](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7340-L7473).

| Partner-target handler | Exact added scoring |
|---|---|
| Fire absorption | Flash Fire and not already activated: +3; otherwise −30. |
| Electric absorption | Motor Drive: r <160 gives 0, otherwise Speed stage 12 gives −30 and lower stages +3. Else Volt Absorb uses healing table below; no matching ability gives −30. |
| Water absorption | Water Absorb/Dry Skin uses healing table; otherwise −30. |
| Absorption healing table | HP 100 gives −10; HP 91–99 gives 0; HP 76–90 gives +3 if r <64; HP 51–75 gives +3 if r <128; HP <=50 gives +3 if r <192. |
| Skill Swap | Ally Truant/Slow Start: +10. Otherwise self Levitate with ally already Levitate: −30. Self Levitate and ally first type Electric adds +1; if second type Electric adds another +1 and ends. **If only the first type is Electric, it falls into the accuracy-ability path and then −30, net −29.** Accuracy path: self Compound Eyes/No Guard and ally knows one listed inaccurate move gives +3, else −30. The list is Fire Blast, Thunder, Cross Chop, Hydro Pump, Dynamic Punch, Blizzard, Zap Cannon, Megahorn, Focus Blast, Gunk Shot, Magma Storm, Power Whip, Seed Flare, Head Smash. |
| Will-O-Wisp | Ally Flash Fire uses Fire absorption. Else +5 only for Guts, no major status, neither Fire type, neither Flame Orb nor Toxic Orb, and HP >=81; otherwise −30. |
| Thunder Wave | Ground ally: −30; otherwise Motor Drive/Volt Absorb uses Electric absorption; other abilities −30. |
| Poison / badly-poison effects | +5 only with Poison Heal, no existing major status, no Toxic Orb and HP **<=91**; otherwise −30. It does not check Poison/Steel immunity. The executed HP predicate differs from the nearby >=81 comment. |
| Helping Hand | HP 0 gives −30. Ally HP >50 or speed rank <1: −1 if r <64, otherwise +2. Else 0. |
| Swagger | Requires Persim/Lum Berry, else −30. With berry, Attack stage <=7 (+1 or less) gives +3, higher gives 0. Own Tempo is ignored. |
| Trick/Switcheroo/Fling | 0; these explicit partner handlers are empty. |
| Gastro Acid | Ability already suppressed gives −30; else Truant/Slow Start +5; else 0. |
| Acupressure | Simple: any of seven non-HP stages >8 gives −10; otherwise skip the normal maximum-stage test. Without Simple: any stage 12 gives −30. Then HP <=50 gives −1. HP >90 gives +2 when r >=80 (176/256). HP 51–90 first requires r >=128, then a **new** r >=80: +2 probability 88/256 = 34.375%, not 31.25% from the comment. Otherwise 0. |

Sources: [absorption](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7352-L7459), [partner Skill Swap and ailments](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7475-L7598), [remaining partner handlers](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/script.s#L7600-L7694).

The two unreachable `TagStrategy_Unused_1/2` labels would, if called, leave an unstatused attacker unchanged; for a statused attacker, give −5 to non-comparable moves, +1 to damage-comparable moves, and another +2 to a highest-damage move. They have no call from the flag's live control flow. Named common-score and end labels are terminal helpers, not additional independent routines.

Additional regression scenarios for the Tag flag alone (start score 100; suppress common damage bonuses where the test targets a special handler): Sunny Day + Solar Power at full HP with r=128 ends 99, with r=127 ends 101; ally Poison Heal at 91% HP gets poison-move score 105, at 92% gets 70; ally Water/Ground with Discharge gets the −10 branch, not the Ground +3 branch; self Levitate giving Skill Swap to a non-Levitate Electric-first dual-type ally ends 71, but a mono-Electric ally ends 102; Acupressure at 75% HP with draws [128,80] gets 102, [127] and [128,79] get 100. These fixtures pin actual branches and would catch reliance on misleading source comments.

## Switching: ordered rules, independent of scoring flags

The command chooser checks switching **before** items and moves, and only runs this command logic for a trainer battle or a player-side AI battler. A mask of zero does not disable switching/items. A successful branch stops the search. Bench eligibility normally excludes fainted Pokémon, eggs/empty species, both active slots in a shared party, and replacements already reserved this turn. Tag and 2-v-2 trainers instead own separate parties. [Command and switch gates](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3894-L4041).

The switch gate is deliberately less accurate than battle legality: trapped volatile status, Ingrain, opposing Shadow Tag/Arena Trap, or any other battler's Magnet Pull against a Steel type block switching. It ignores Shed Shell, the Flying exemption to Arena Trap, Shadow Tag's exemption, and Magnet Pull being on an ally. With an eligible bench, use this exact branch order:

1. Perish Song effect with counter already zero requests a generic replacement (sentinel slot 6). This describes the predicate; do not assume it triggers on the ordinary final countdown turn. [Perish predicate](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3263-L3272).
2. Singles only: opposing raw ability Wonder Guard and no super-effective move on the active Pokémon; scan living bench slots/moves and choose the first super-effective candidate whose draw modulo 3 is 0 or 1. This branch excludes only the current selected slot, unlike the general bench filter. [Wonder Guard](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3286-L3350).
3. At least **two** moves with nonzero power, all ineffective against both tested player battlers: scan bench attacks for a super-effective option (each opportunity accepts modulo 3 < 2), then neutral effectiveness (modulo 2 = 0). In singles it checks the same foe twice, so a failed random check can receive a second chance. The fixed defenders are player battlers 0/2, not relative opponents; a fainted defender leaves zero flags and can short-circuit the initial immunity check. PP is not checked here. [All-ineffective branch](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3361-L3547).
4. Absorption: if the active Pokémon has any super-effective move, abandon this branch when modulo 3 is nonzero (2/3). Otherwise, the last hit must have nonzero power and base type Fire/Water/Electric, mapping to Flash Fire/Water Absorb/Volt Absorb. If the active Pokémon does not already have that ability, choose the first matching eligible bench member whose random low bit is 1. Variable move type is not used for this lookup. [Absorb switch](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3640-L3714).
5. Sleeping Natural Cure at HP >= floor(maxHP/2): no previous hit offers a low-bit-1 generic-switch chance; a zero-power previous hit offers another such chance. Then try an immune replacement with a super-effective response, then a resistant replacement with a super-effective response; these use modulo **1**, hence always accept a qualifying candidate while still consuming a draw. Last, another low-bit-1 generic-switch chance. With no previous hit, the first two tests can both run. [Natural Cure](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3817-L3861).
6. Stay in if any super-effective active move passes its modulo-10 != 0 check; each qualifying move/foe receives a draw. Stay in if the sum of positive stat stages is at least four. These retention tests do not override earlier successful switch branches. [Retention](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3560-L3627), [boosts](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3872-L3884).
7. Try a bench Pokémon immune to the damaging last hit, with a super-effective response against that hit's user, accepting modulo 2 = 0; then a resistant one accepting modulo 3 = 0. These are **1/2 and 1/3**, not the 33%/25% stated in nearby decomp comments. Test code operations, not comments. [Candidate helper](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3727-L3806), [call arguments](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L3973-L3983).

Generic replacements and post-KO replacements use the same two-stage selector against one randomly chosen living opponent. First, rank bench Pokémon by the sum of their own two types' offensive matchup multipliers against that opponent; monotypes count the same type twice. Try highest score first, party order breaking ties, and accept the first with any super-effective move. Score storage is **u8**, including the sum (two ×4 matchups overflow from 320 to 64). Second, compare the maximum damage from each bench Pokémon's moves **as if used by the outgoing battler**, not using the bench member's own offensive stats. Both initial damage and type-chart damage truncate to u8; empty or power-1 slots retain the preceding score. No positive winner returns sentinel 6, and the caller falls back to first living eligible party slot. [Post-KO selector](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/battle_lib.c#L7923-L8095), [command fallback](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L4003-L4028).

## Trainer items

Inventory initialization is a separate gate: only enemy battlers receive trainer items, only in TRAINER battles, and only when none of LINK, FRONTIER, SAFARI, AI or PAL_PARK is set. Empty item IDs are compacted out before the initial count is stored. Consequently an AI-partner battle (type 75) gives **neither enemy trainer an AI inventory**, not merely a prohibition on the friendly partner. Ordinary trainer doubles can receive inventories. The item chooser below cannot use items that initialization never provided. [Native inventory setup](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/battle_controller_player.c#L4795-L4817), [current memory initialization](../../packages/battle/src/ai/memory.ts), [excluded battle flags](../../packages/battle/src/ai/constants.ts).

Item choice is deterministic and independent of the AI mask. AI partners on player slot 2 in trainer-with-partner battles cannot use trainer items; Embargo also prevents use. Count living non-egg party members. Scan four inventory slots in order: slot 0 is always eligible; later slot i requires `alive <= originalItemCount - i + 1`. [Item entry and inventory gate](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L4056-L4100).

The first matching **item property**, not first matching ailment, determines the branch:

- Full Restore: only living active Pokémon below floor(maxHP/4); status alone never triggers it.
- HP restoration: living active Pokémon below floor(maxHP/4), or missing HP **strictly greater than** the item's byte-sized restoration amount (not greater-or-equal).
- Status properties in priority order: sleep, poison/toxic, burn, freeze, paralysis, confusion. A multi-cure item whose first property is sleep never reaches poison if the Pokémon is merely poisoned. The corresponding condition bits are 5 through 0.
- Otherwise, only on entry turn (`switchInTurn >= totalTurns`): the first supplied boost among Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy, or Guard Spec if opponent-side index 1 lacks Mist. The predicate is entry-turn-only despite a contradictory decomp comment. Critical-hit boosters are not included in this list.

The loop does **not** stop after success and does not clear its success flag for later slots. It consumes every subsequent eligible nonzero item, even if that later item would not independently qualify, and ultimately returns the last consumed item; category/condition can remain from an earlier item or be changed by a later branch. Preserve this compatibility quirk in exact mode. [Item branches and loop tail](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L4101-L4199).

## Doubles target selection

Battlers are numbered 0/2 on the player side, 1/3 on the enemy side; partner is XOR 2. On move selection, Platinum first consumes the normal random-opponent draw and four damage-roll draws. Doubles then visits all living non-self battlers in numeric order, including the ally. Each candidate receives a fresh initialization, four fresh damage rolls (100 minus draw modulo 16), and every enabled routine; enemy last moves are recorded in known-move memory. Pick one highest-score move per candidate with a random tie draw **even for a singleton**. Ally best scores below 100 are demoted to −1; 100 is still eligible. Pick a target uniformly among candidates sharing the overall best score, with another draw. This is target-first tie weighting, not uniform selection among all tied move–target pairs. A user-or-ally move chosen against side 0 redirects to the attacker (a literal side check, also relevant for player-side AI); non-Ghost Curse redirects to the attacker. [Entire doubles selector](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L258-L279), [candidate scoring and redirection](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/trainer_ai/trainer_ai.c#L352-L470).

The Tag Strategy routine is always ORed into doubles masks; its partner-benefit and spread-move scoring therefore matters even when the stored trainer mask is zero. The selector above chooses a scored target; execution still applies the move's targeting/range semantics. An implementation must not reduce spread damage to a single selected defender or omit ally candidates.


## Remaining fidelity work and implementation order

1. **Prove current branches before widening the adapter.** Add original assembler fixtures for boundary comparisons, overflow, item and switch gates, allied-target cutoffs and exact draw order. Add ROM-gated score traces for real routines separately. Existing interpreter/decoder coverage and “all trainer leads choose” smoke tests prove execution coverage, not every branch's decision fidelity. Trace the chosen move, target, scores and consumed draws; retain no ROM bytecode or ROM-derived fixtures in source control.
2. **Supply missing battle state at the existing `AiSource` → `AiBattleView` seam.** [`ai-view.ts`](../../packages/battle/src/controller/ai-view.ts) hardcodes `lastResortCount: 0`, `recycleItem: () => 0`, and `switching: () => false`. Its `switching` contract means the DS switching/fainted mask, not prediction of a human's unsubmitted action. Capture the corresponding histories/mask from the controller and sim, with decomp reset timing. `protectSuccessTurns` is currently only `v.stall ? 1 : 0`: prove the DS consecutive-success count mapping. Active types/species/ability come from the persistent party/form record, whereas moves and stats come from the sim; current held item is mapped from the party item whenever `sim.item` is nonempty. Audit Transform, Conversion, Roost, Skill Swap/Trace and Trick against live sim state and protocol synchronization before asserting an end-to-end bug. Fix demonstrated cases by mapping live identifiers back to existing imported numeric records, not by making AI read sim internals directly.
3. **Bring doubles damage estimates to the same fidelity as target selection.** The view's `calcMoveDamage` always halves damage for Reflect/Light Screen and has no spread-target adjustment. At decomp [`battle_lib.c:6982–7052`](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/battle/battle_lib.c#L6982), screens use ×2/3 when two allied defenders are alive; qualifying spread damage uses ×3/4. Add both at the documented integer-truncation points and verify KO score transitions. `countOurSide` presently checks only its single supplied battler; audit Flower Gift partner contribution (Plus/Minus explicitly pass the partner). Helping Hand is explicitly unmodelled; compare its turn-flag lifetime with command-selection timing before supplying a multiplier. Audit existing doubles side-condition mapping and both active slots across shared-owner and separate-owner topologies; doubles themselves already work and do not need a replacement architecture.
4. **Close command/memory edge cases.** Exercise item stocks for both enemies, an allied trainer's item prohibition, simultaneous replacement reservations, and knowledge clearing on ordinary switch/Baton Pass. Replace the counted unusable-move substitution only after reconstructing the DS's actual command validation and proving the analogous sim request. Preserve the per-trainer mask, automatic TAG_STRATEGY, special battle overrides, and intentional arithmetic quirks.
5. **Integration and release gate.** Keep changes inside `packages/battle` unless a demonstrated pack field is missing. A needed shared contract is its own reviewed change; changing importer records/assets/layout requires `IMPORTER_VERSION`. Tests use `romSlice()` and browser tests use `seedRomImport(page)` unless testing import itself. Run targeted tests while iterating, then `pnpm check` and the explicit ROM `pnpm test`; report skip status honestly. A documentation-only change needs no importer or contract bump.

## Decision scenarios and acceptance criteria

“Existing” below means an assertion is present in the reviewed source; it is not a claim that this research ran it. All synthetic scripts must be written with our original test assembler.

| Status / tier | Controlled state | Expected observation |
|---|---|---|
| Existing, original fixture | One script adds 30 to a 100 score. | Signed-8 wrapping yields −126, then clamps to 0; do not saturate to 127. |
| Existing, original fixture | Doubles attacker 1; target 0 Ghost; target 2 neutral; partner 3 fainted; one move; original script subtracts 10 only on Ghost. | Scores target 0 `[90,0,0,0]`, target 2 `[100,0,0,0]`; move slot 0 targets 2. Consume 16 draws: random opponent 1, unused initial four rolls 4, each target four rolls plus one slot-tie draw 10, final target-tie draw 1. |
| Existing, original fixture | HP 20/100; only one usable party member; inventory Potion then Super Potion. | Chooses Super Potion, and both inventory slots become zero: later qualifying item overwrites the earlier action. No RNG draws for this case. |
| Existing, original fixture | All active damaging moves ineffective; eligible bench slot 1 has a super-effective move; switch random draw 1. | Switch slot 1, reserve slot 1 (`1 % 3 < 2`). |
| Existing, original fixture | Post-KO versus Fire/Rock; candidate 1 Water/Water (two ×4 scores), candidate 2 Normal/Normal with a super-effective Fighting move. | Chooses candidate 2: candidate 1's 320 type score wraps to 64; candidate 2 scores 80. |
| Existing, ROM script + synthetic state | BASIC only; Tackle/Ember against Gastly; seed 1, fake chart with Normal immunity. | `[90,100,0,0]`, choose Ember slot 1. |
| Existing, ROM script + synthetic state | EVAL_ATTACK only; Tackle/Thunderbolt versus 40 HP; fake damage 17/47; seed 2. | `[99,104,0,0]`, Thunderbolt. Against 20 HP with Tackle/Quick Attack, fake damage 17/20 and seed 3: `[99,106,0,0]`, Quick Attack. These are fake-calculator tests, not real level/stat damage claims. |
| Existing, ROM + real controller view | Roark Geodude versus two level-15 Piplup, no hazards, all draws 0 versus all draws 200. | Stealth Rock/Rock Throw scores `[100,100]` versus `[101,100]`; high roll chooses Stealth Rock. With one Piplup, scores `[90,100]` / `[91,100]`; high roll chooses Rock Throw. Already-present Stealth Rock yields `[91,100]` on high roll. |
| Planned, original fixture | Mask zero; two usable moves, no switch/item; singles; four initialization draws fixed then tie draw 0 or 1. | Both start 100; tie draw 0 chooses slot 0, draw 1 slot 1; five draws total. |
| Planned, original fixture | Doubles scores foe best 98; live partner best 99, then 100 in second case; only one usable move. | At 99 partner excluded; choose foe. At 100 partner eligible and wins. Add tied foes to prove final modulo target selection independently of slot ties. |
| Planned, adapter fixture | Synthetic physical move, unscreened pre-final-`+2` damage exactly 60; two defenders alive, Reflect; then one alive. | Estimate 42 with two alive (`60×2/3+2`), 32 with one (`60/2+2`). A separate qualifying spread-only case yields 47 (`60×3/4+2`), subject to exact other multipliers held neutral. |
| Planned, original interpreter + adapter fixture | Two known moves including Last Resort; first other move unused, then used; write a tiny original script awarding +1 only when Last Resort is usable. | Last Resort 100 before / 101 after; provide an alternative 100 and controlled tie draw choosing alternative before, Last Resort uniquely after. Reset the history on switch according to decomp. |
| Planned, original interpreter + adapter fixture | Recyclable item absent, then consumed; original script adds +1 for expected recycled item ID. | Recycle candidate 100 then 101; with alternative 100 and controlled tie choose alternative before and Recycle after. This proves state plumbing separately from ROM Expert scoring. |
| Planned, ROM script + adapter | Doubles screens/spread threshold chosen so expected damage is exactly below/at target HP. | Assert full scores after each enabled routine and final target; derive actual numeric expectation from chosen stats, move and fixed roll before adding fixture. Do not preclaim a particular boss move without that derivation. |

Existing scenario sources: [`ai.test.ts`](../../packages/battle/src/ai/ai.test.ts), [`ai.rom.test.ts`](../../packages/battle/src/ai/ai.rom.test.ts), [`ai-trace.rom.test.ts`](../../packages/battle/src/controller/ai-trace.rom.test.ts). Broader original topology tests already exist in [`doubles-topologies.test.ts`](../../packages/battle/src/controller/doubles-topologies.test.ts); they are integration foundations rather than exhaustive AI scoring tests.

## Additional action boundary scenarios
Use original fixture Pokémon and programmable RNG; assert the entire score/action plus draws consumed. For item/switch fixtures, disable earlier switch branches or provide no bench unless the scenario requires one.

| Scenario | Expected choice |
|---|---|
| Full Restore, maxHP 100, HP 24 versus 25; no bench | Use at 24, fight at 25. Poison with HP 100 still fights. |
| Potion restoring 20, maxHP 100, HP 80 versus 79 | Fight at 80 (missing = 20), use at 79 (missing = 21). |
| Multi-status cure with sleep and poison properties; poisoned but awake | Fight; sleep-property branch prevents poison evaluation. |
| Two eligible potions, one living party member, low HP | Both inventory slots become zero, final item is slot 1, as current regression demonstrates. |
| Stat booster on switch-in turn and next turn | Use on switch-in turn, fight next turn. |
| No usable attacks against Ghost, one damaging Normal move | No all-ineffective switch; at least two damaging moves are required. |
| Two ineffective attacks, bench has super-effective attack, modulo-3 draw 0/1 | Switch to first qualifying party slot. A 2 rejects that opportunity; singles can retry the duplicate foe. |
| Sleeping Natural Cure at HP 50/100; resistant bench with super-effective answer | Switch after the relevant modulo-1 draw, regardless of its value. At HP 49 this branch is skipped. |
| Flying active facing Arena Trap, or active holding Shed Shell | AI switch gate still rejects; this pins AI behavior rather than actual battle legality. |
| Ally candidate best 99 vs enemy 90 | Enemy chosen; ally is demoted to −1. Ally score 100 vs enemy 99 instead chooses ally. |
| Enemy A has two moves tied at 105; enemy B one move at 105 | Each enemy target has 1/2 tie probability, with A's two moves splitting A's half. |
| One live enemy, one live ally, attacker in doubles | Initial opponent draw + four initial rolls, then four rolls and one move-choice draw per candidate, then one target-choice draw, plus any script RNG. |
| Post-KO Water/Water vs Fire/Rock compared with a candidate whose summed matchup is 80, both possessing super-effective moves | The 80-score candidate beats Water/Water's overflowed 64; party order breaks equal scores. |
| Stored zero mask plus doubles battle | Tag Strategy still executes; zero mask in singles still permits command-level switching/items. |



## Additional EXPERT regression choices

Planned ROM-gated cases use the imported routine with original synthetic battle state and programmable draws. Isolate EXPERT so the expected delta is unambiguous, then add combined-mask cases separately:

| Controlled state | Expected decision |
|---|---|
| Half-HP Recovery user moves first; recovery vs a plain attack with no EXPERT modifier | Recovery 92, attack 100: choose attack. This deliberately pins the faster branch's −8. |
| Sleeping user, Snore versus ordinary attack, both otherwise neutral | Snore's `Expert_Nightmare` alias gives 102 vs 100: choose Snore. Actual Nightmare does not receive that EXPERT dispatch. |
| Feint; Protect known in target history, target full HP, user without the listed residual conditions; target Protect chain 2, branch draw 255; then chain 3 | Chain 2 follows chain 0's +1 branch; chain 3 loses 2. Against neutral 100, choose Feint at 101 in first case, alternative in second. |
| Punishment with seven positive target stat stages and all relevant draws 255, nonresisted; alternative neutral 100 | Its cumulative bonus reaches +10, so 110 wins. Do not confuse this with Power/Guard Swap's maximum-5 branch, which awards only +5 on its first successful draw. |
