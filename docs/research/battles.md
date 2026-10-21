# Battles: engine, decomp flow, visuals, integration (M2 research)

Measured 2026-10-14. The decomp is `reference-projects/pokeplatinum`; we use it for understanding only.
Engines were installed in a scratch directory, never in the repo. Node 26, Apple silicon.

## 1. Engine choice

### 1.1 Candidates

| Candidate | Licence | Gen 4 | Verdict |
|---|---|---|---|
| `@pkmn/sim` 0.10.11 (Showdown, packaged for the browser) | MIT | `gen4` mod (inherits gen5→gen9 data) | **Use** |
| `@pkmn/engine` 0.1.0-dev | MIT | **None.** The package ships Zig for gen1/gen2 only. Its README puts gen 3–4 in "stage 2", after gen 1–2 are finished | Not usable |
| `pokemon-showdown` 0.11 (upstream) | MIT | The same code as `@pkmn/sim`, Node-first, with server parts | No gain |
| `@smogon/calc` 0.12 | MIT | A damage calculator only | Useful for cross-checks in tests, not as an engine |
| Our own port of the decomp's battle engine | ours | exact | ~46.7k lines of C in `src/battle/*.c` (`battle_script.c` 12.1k, `battle_lib.c` 8.2k), plus 223 script commands, 297 subscripts and 277 effect scripts. Months of work. Keep it as the fallback if exactness ever becomes a hard requirement |

### 1.2 Measurements (`@pkmn/sim` 0.10.11)

The benchmark was a Gen 4 wild battle (Turtwig L5 vs Starly L3), run headless in Node, with both sides
driven turn by turn through `battle.choose()`.

| What | Result |
|---|---|
| Runs a gen 4 wild battle headless in Node | yes |
| 100 battles (432 turns) | **194 ms** with the trimmed bundle; 255 ms with the full package. About 0.45 ms per turn |
| The same with an injected Gen 4 LCRNG | 137 ms, about 6.3 RNG calls per turn |
| Deterministic | yes: the same seed gives a byte-identical log, and different seeds give different logs |
| Browser bundle, whole package (esbuild, minified ESM) | 6.53 MB; 1.01 MB gzip; 669 KB brotli |
| Browser bundle, **gen 4 only** (learnsets, legality, flavour text and gen1–3/bdsp/legends mods stubbed by an esbuild plugin) | **1.81 MB; 381 KB gzip; 267 KB brotli**. It gives the same 432 turns as the full build |
| Cold import plus first `Battle` (Node) | 58–68 ms trimmed; 225–257 ms full |
| Doubles (`gameType: 'doubles'`) and multi (`'multi'`, 4 players) in gen 4 | both run to the end |

Learnsets (2.7 MB) are only used for team validation, which we do not need, so they can always be
dropped. The battle chunk loads lazily the first time a battle starts.

### 1.3 Driving it from our controller

- **Turn by turn:** `new Battle({format, prng})`, `setPlayer`, `choose(side, 'move 1' | 'switch 2')`. `choose` runs the turn synchronously and appends protocol lines (`|move|`, `|-damage|`, `|faint|`, …) to `battle.log`. Our controller reads those lines, turns them into ROM messages and animation steps, and the scene plays them over ticks.
- **The PRNG is injectable** (`options.prng`). Measured: a Gen 4 LCRNG object (`seed*0x41C64E6D + 0x6073`, top 16 bits, the decomp's `BattleSystem_RandNext`) drives the sim. We seed it from our game stream, never from the wall clock.
- **Turns spent outside the sim** (bag item, failed run, failed catch, Safari bait and rock). Showdown has no `pass` in singles: it is refused with "must make a move". Measured fix: a custom dex mod `gen4os` (`Dex.mod`) with a hidden priority-6 move that does nothing. We apply the item ourselves, then submit that move, and the foe acts normally. The message layer hides its `|move|` line.
- **Data overlay:** the same mod mechanism lets us write the pack's species and move records into the dex (base stats, types, abilities, power, accuracy, PP, priority), so ROM data and mods are authoritative and Showdown supplies behaviour by move and ability id. This is required for the fixture pack's original creatures as well.
- **Not in Showdown:** catching, running, exp, EVs, money, level-up, move learning, evolution, bag items in battle, wild and trainer AI, Safari, Pal Park, the first-battle and tutorial rules, prize money and blackout. All of these belong in our controller (§1.5).

### 1.4 How exact is it against the cartridge?

| Area | Decomp | Showdown gen4 | Gap |
|---|---|---|---|
| Damage stages | `BattleSystem_CalcMoveDamage` (battle_lib.c:6601): base, burn, screens, spread ×3/4, weather, Flash Fire, +2, then crit, Life Orb and Metronome item; random `100 - rand%16`; then STAB, then type chart per type with truncation | `modifyDamage` in `mods/gen4/scripts`: the same DPP stage order (Phase1, spread, weather, +2, crit, Phase2 floor, random, STAB, type ×2 / ÷2 per step) | Formula and rounding match by reading. To prove: golden damage ranges against the decomp formula in tests |
| Crit stages | `{16, 8, 4, 3, 2}`; ×2, or ×3 with Sniper; no crits in the first battle or the catch tutorial | `[0, 16, 8, 4, 3, 2]`, ×2 | Same. The first-battle no-crit rule is ours |
| Speed and turn order | Run first, then items and switches, then moves; ties broken by `rand & 1`; Quick Claw rolls are drawn the turn before | Priority, then speed, then a random shuffle | Distribution matches. Run and item order is ours anyway (they are outside the sim) |
| Accuracy | `rand%100+1 > hit` misses | `randomChance(acc, 100)` | Same distribution |
| **RNG call order** | 98 call sites in one LCRNG stream | A different order and number of calls | **Not cartridge-exact.** With the same seed we do not reproduce a cartridge battle frame for frame. Results are deterministic for us and statistically faithful |
| Platinum vs DP | `src/battle` has no DP/Pt conditionals | gen4 = DPPt | Nothing visible to patch |

**Patches we own,** each from the decomp and each with a unit test:
- **Catch** (`BattleScript_CalcCatchShakes`, battle_script.c:10904). The rate is `catchRate·ball/10 · (3max−2cur)/(3max)`, then ×2 for sleep or freeze, ×1.5 for poison, burn or paralysis.
  - Ball table: Ultra 20, Great 15, Poké 10, Safari 15, Net 30, Dive 35, Nest 40−lvl, Repeat 30, Timer 10+turns, Dusk 35, Quick 40; ×10 fixed point.
  - 4 shake checks against `(0xFFFF<<4)/sqrt(sqrt((0xFF<<16)/rate))`. There is no critical capture. Pal Park and the tutorial always catch.
- **Run** (`Battler_CanEscape`, battle_lib.c:3269): `u8 escape = spd·128/enemySpd + attempts·30`, escaping when `escape > rand%256`. The **u8 wrap** is kept.
  - Smoke Ball, Run Away and no-exp battle types always escape.
- **Exp:** `baseExp·level/7`, split half and half between participants and Exp. Share holders (each at least 1). Then ×1.5 for Lucky Egg, ×1.5 in trainer battles, ×1.5 if traded (×1.7 for a foreign language).
- **EVs:** the yield, plus Power items, ×2 for Pokérus, ×2 for Macho Brace; caps 510/255.
- **Money:**
  - Prize: last mon's level ·4 · class multiplier, ×2 in non-tag doubles.
  - Loss: max party level ·4 · `{2,4,6,9,12,16,20,25,30}[badges]`.
- **AI picks:**
  - Wild: a uniformly random valid move.
  - Roamers: flee unless trapped.
  - The catch tutorial: the counterpart's side runs the AI with flag CATCH_TUTORIAL, whose script ends in "escape" at 20% HP or less. We read that as the cue to throw the ball; verify this in M2a.
- **Safari:** flee and catch stages, 13 fractions from 10/40 to 40/10, starting at 6.
- **Gen 4 quirks:**
  - The speed RNG timing for Quick Claw.
  - The trainer AI item loop, which consumes several items: reproduce it, don't fix it.
  - The u8 run counter.
  - The no-crit first battle.

### 1.5 Decision

Use `@pkmn/sim` (MIT) for move, ability, item and damage resolution only, behind our own controller in
a new package. Build a gen-4-only lazy chunk, inject our LCRNG, and overlay pack data through a dex mod.
We accept that RNG call order differs from the cartridge, the same way the field accepts "not
pixel-exact". The formulas we own are exact.

## 2. Decomp battle flow

- **State machine.** `battle_controller_player.c` holds it: `BattleContext_Main` → `sBattleControlCommands`, 45 states.
  - Turn: `INIT_COMMAND_SELECTION → COMMAND_SELECTION_INPUT → CALC_TURN_ORDER → CHECK_PRE_MOVE_ACTIONS → BRANCH_ACTIONS` (FIGHT/ITEM/PARTY/RUN/SAFARI_BALL/BAIT/ROCK).
  - Move pipeline: BEFORE_MOVE … MOVE_END.
  - End of turn: field, mon and side conditions.
  - End of battle: `RESULT → SCREEN_WIPE → FIGHT_END`.
  - `battle_controller.c` is the server→client message layer (`BattleController_Emit*`). We mirror that split: the sim is the "server", our scene is the "client".
- **Battle types** (`include/constants/battle.h`): TRAINER, DOUBLES, LINK, 2vs2, TAG, SAFARI, AI, FRONTIER, ROAMER, PAL_PARK, CATCH_TUTORIAL; status flags FIRST_BATTLE, HONEY_TREE, NO_RUNNING, LEGENDARY, ….
  - `Encounter_NewVsTrainer` picks the type:
    - two different enemies without a partner → TAG_DOUBLES;
    - two different enemies with a partner → TRAINER_WITH_AI_PARTNER (a Showdown `multi`);
    - the same enemy twice → TRAINER_DOUBLES;
    - otherwise → TRAINER.
- **Results:**

  | Result | Value |
  |---|---|
  | WIN | 1 |
  | LOSE | 2 |
  | CAPTURED_MON | 4 |
  | DRAW | 3 |
  | PLAYER_FLED | 5 |
  | ENEMY_FLED | 6 |

  `CheckWonBattle`/`CheckLostBattle`/`CheckDidNotCapture` read them. A loss in a normal battle runs `FieldTask_BlackOutFromBattle` (money penalty, blackout warp).
  - The first battle and the tutorial do not black out. Route 201 branches on `CheckWonBattle` to `Route201_RivalWonLetsGoHome`.
- **Script commands:**
  - `StartTrainerBattle` 0xE5, which adds the partner if one is set.
  - `BlackOutFromBattle` 0xEB, `CheckWonBattle` 0xEC, `CheckLostBattle` 0xED.
  - `StartWildBattle` 0x124, `StartFirstBattle` 0x125, `StartCatchingTutorial` 0x126, `StartHoneyTreeBattle` 0x129.
  - `StartTagBattle` 0x2A0, `CheckDidNotCapture` 0x2BC, `StartLegendaryBattle` 0x2BD.
  - `StartFatefulEncounter` 0x318, `StartGiratinaOriginBattle` 0x319.
  - The catching tutorial is Bidoof L2 against the counterpart's starter L5, with 20 balls. The counterpart's side is AI-driven (see the CATCH_TUTORIAL flag) and the catch always succeeds.
- **Exp, level-up and evolution happen inside the battle app.**
  - Exp and level-up happen as the foe faints (`subscript_grant_exp`). Learning a move with 4 moves known prompts at that point.
  - Evolution runs after the result (WIN, CAPTURED or PLAYER_FLED) through `Battle_FindEvolvingPartyMember` over the leveled-up mask, before returning to the field.
- **Messages.**
  - Bank `battle_strings`: 1,269 entries. The decomp's ordering suggests pl_msg 368; the importer confirms the number.
  - "X used Y!" comes from a separate bank (`TEXT_BANK_MOVES_USED_IN_BATTLE`).
  - A wild battle prints, in order: `AWildPokemonAppeared` (965) → `GoPokemon` (979) → `WhatWillPokemonDo` (921) → the move-used line, `ACriticalHit` (774), `ItsSuperEffective` (780)/`ItsNotVeryEffective` (779) → `PokemonFainted_Wild` (31) → `PokemonGainedExpPoints` (1)/boosted (2) → `PokemonGrewToLevel` (3) → learned move.
  - Other key lines: `GotAwaySafely` 781, `CantEscape` 42, `Gotcha` 867, broke free 863–866, money lost 34, blacked out 37, `PlayerDefeatedTr` 839.
  - Our message layer maps sim protocol lines to these ids; the order follows the subscripts.
- **Trainer AI** (`src/battle/trainer_ai/`):
  - Size: `trainer_ai.c` is 4,199 lines. The bytecode, `script.s`, is 8,108 lines (≈4.6k of instructions) and is linked into the battle overlay as `gTrainerAITable`; a prebuilt `tr_ai_seq.narc` is also in the ROM.
  - **We import the bytecode from the player's ROM and write our own interpreter. We do not transcribe `script.s`.**
  - Interpreter: 109 opcodes, a stack of 8 and one accumulator.
  - Scoring: every move starts at 100, and each set flag runs its script once per move (s8 score, clamped at 0). Each move takes a `100 - rand%16` damage roll. The highest score wins; ties are random.
  - Doubles re-score per target.
  - Switch AI: about 730 lines. Item AI: about 150 lines, up to 4 trainer items.
  - Only about 10 opcodes need the damage, type or speed engine. We answer those through the sim's calc (`getDamage` with a fixed roll).
  - Flag use across 928 trainers:
    - BASIC only: 580.
    - +EVAL_ATTACK+EXPERT: 226. All leaders, the E4, Cynthia and the bosses are here.
    - +EXPERT: 57.
    - +PRIORITIZE_EXTREMES: 47.
    - The rest: 16.
    - Doubles force TAG_STRATEGY.
    - BATON_PASS, CHECK_HP, WEATHER and HARASSMENT are used by no trainer.
  - The script has 24 `BUG` comments, which we keep.
  - Estimate: about 2–2.6k lines of TS, 1–2 weeks once a battle-state model exists.
- **Safari (Great Marsh):** balls, bait and rock, with flee rolls before each turn. The healthbox uses the `safari` variant; the start menu swaps Save for Retire. M2b.
- **Pal Park:** the wild side always picks command 4, the player always acts first and Park Balls always catch. This is post-game: M6.

## 3. Battle visuals: what the ROM has

- **Backdrop:** `pl_batt_bg.narc` (342 members) holds 23 backgrounds as BG tiles + a shared tilemap + palettes.
  - The tiles are member 3+bg, the tilemap is member 2, the palette is member 172+bg·3+time.
  - Time of day is a palette swap (day, twilight, night) for PLAIN, WATER, CITY, FOREST, MOUNTAIN and SNOW only.
  - The zone header picks the background (`MapHeader_GetBattleBG`); surfing forces WATER.
- **Platforms:** 24 terrains of 2D OAM sprites (NCGR LZ + NCER + NANR, shared cells), with 3 palettes by time, in `pl_batt_obj.narc` (343 members).
  - `CalcTerrain` picks the terrain from the tile behaviour under the player (grass, sand, snow, mud→marsh, cave, water, ice), else from the background.
  - Off-screen start positions (336,136) and (−80,88) drive the slide-in.
- **Pokémon:**
  - Storage: `pl_pokegra.narc`, 6 members per species (back F/M, front F/M, normal and shiny NCLR); forms in `pl_otherpoke.narc`.
  - Images: 160×80 4bpp = two 80×80 frames. The **NCGR data is scrambled** (the "scan" encryption) and must be decoded.
  - Drawing: each mon is a textured quad with transforms, not OAM cells.
  - Animation: per-species frame tables (up to 10 frames with delay and shift, in `pl_poke_data`) plus 143 transform scripts (`pl_poke_anm.narc`, 34 commands: sin/linear offset, scale, rotation).
  - Also: y offsets, shadows and the idle bob.
- **Trainers:** `trfgra.narc`/`trbgra.narc`, NCGR + NCER + NANR + NCLR per class, 108 classes. Player backs throw in 5 frames.
- **HUD:**
  - Healthbox variants for singles, doubles, enemy and Safari (NCER), with HP/EXP fill and digits blitted from raw 4bpp parts.
  - The party ball gauge.
  - The textbox is a BG window with the `pl_winframe` palette and the message font.
- **Bottom screen** (`battle_subscreen.c`, 3,964 lines): Fight/Bag/Pokémon/Run, the 4 move buttons coloured by type, targets, the bag and the party. Its graphics are in `pl_batt_bg`/`pl_batt_obj`, `b_bag_gra` and `pl_b_plist_gra`.
- **Move animations:** 468 move scripts (12.5k lines → `we.arc`) and 51 common scripts (`we_sub.narc`), run by an 85-opcode VM plus 84 native effect functions (`battle_anim/`, about 27.6k lines of C).
  - 425 of 468 moves use **SPA 3D particles**: `waza_particle.narc` (485 SPA, 4 MB) and `ball_particle.narc` (117). `CreateEmitter` is used 1,584 times.
  - Only 31 moves use 2D sprites; 54 switch the background.
- **Transitions:** 31 encounter cut-ins (grass, water and cave × level, trainer, 8 leaders, E4/Champion, legendary, Galactic, double) in `overlay005/encounter_effect*.c` (about 5.3k lines).
  - In-battle intro tasks: the trainer slide-in, ball throw, send-out, capture ball and healthbox slide (`battle_display.c`).
  - The wild grass cut-in (`EncounterEffect_Grass_LowerLevel/HigherLevel`, chosen by `CutInEffects_ForBattle`: higher when the foe's level is above the lead's): two master-brightness flashes (0 → ±16 → 0 in 3 + 3 steps; black when lower, white when higher), then the screen slice (an HBlank scrolls bands of 5 rows, 2 when higher, in alternate directions: 7 frames out to about 20 px and back to 2, then 6 frames off the screen; windows hide the wrapped part) while the camera distance moves +50 then −30 (−50 when higher), then black. Water and cave differ; trainers have their own.
  - The capture ball (`ov12_02235E94.c` BallRotation, `BattleScript_CatchMonTask`): drop 32 px over 10 frames, a 20-frame bounce (17, 10, 3, 2 px; the open animation's frame 1 at each touch), then per shake 14 still frames, a 6-frame rock (±2 px sideways and 2° per px, half the swing for shakes 2 and 3) and 12 frames before the next. Caught: 12 frames, the ball's palette fades to 10/16 black while one emitter of `catch_<ball>.spa` throws 3 stars (19-frame particles), "Gotcha!", the palette fades back and the ball blends out over 16 frames. Broke free is the send-out (`ShowPokemon`) at the ball.
  - Healthbox numbers: `font_special_chars` (pl_font.narc 4) digits, ink 14 (white) and outline 2 of the healthbox palette (`FontSpecialChars_Init(14, 2, 15)`); the level 4 rows down after the "Lv" glyph, current HP right-aligned in 3 tiles before the box's "/", max HP after it.
- **What our repo has:** NCLR/NCGR/NSCR plus a BG compositor (`importer/src/title/nitro2d.ts`) and NARC.
  - **Missing:** LZ10 decompression (the terrain and healthbox members are LZ), NCER/NANR, OAM cell compositing, the pokegra scan decryption, and SPA/SPL particles.

**Subset strategy for move animations:**
- M2a draws no move scripts. Every hit plays the DS's common damage blink and shake, and status, stat and weather use the common scripts' simplest form. A missing animation is logged once per move and counted (`anim:<move>`).
- M2b ports the SPA decoder and an SPL emitter simulator. This unlocks about 90% of moves.
- M2b also ports the 85-opcode VM and the 20 most-used native functions (shake, fade, move, scale the battler).
- Coverage is reported as n/468. The long tail follows by use.

## 4. Single-screen battle layout

One composed scene, never two DS screens. The battle scene replaces the field canvas while a battle
runs, and the field is paused under it.

- **Scene.**
  - The DS top screen (256×192 logical) is drawn at an integer scale.
  - Wide screens see more backdrop: the BG tilemap is repeated by its edge columns, and platforms and sprites stay at their DS positions relative to the centre.
  - The battle textbox and healthboxes stay where the DS draws them.
- **Command card** (replaces the bottom screen):
  - It appears only while the game waits for a choice, as a card over the lower third of the scene, in the same window language as `docs/ui/design.md`.
  - Root: Fight is the large button, with Bag, Run and Pokémon in a row under it, as the DS lays them out.
  - Fight: 4 move buttons, 2×2, coloured by type, with PP.
  - Targets (doubles): the 2×2 battler grid.
  - Bag and party open as the existing sheets in battle mode.
  - While the card is up, "What will X do?" stays in the scene's textbox.
- **Desktop and landscape:** the card is centred over the textbox area, at most 60% of the scene width.
- **Phone portrait:**
  - The scene is width-fitted at the top.
  - The card is a sheet anchored to the bottom of the scene, overlapping it and extending into the space below; the controls strip stays.
  - Nothing is shown below the scene when no choice is pending.
- **Input:**
  - D-pad moves between buttons; A picks; B goes back; Start does nothing. The DS menus are fully d-pad driven.
  - Touch or click picks directly.
  - Gamepad uses the same `InputFrame`.
  - Move info (type, PP, power) appears on focus. That is a web addition and is off in faithful mode.
- **Motion:** the DS's own slide-ins and blinks, in DS ticks. Under `prefers-reduced-motion`, slides become cuts; blinks stay, because they carry information.

## 5. Integration with our engine today

- **Stubs.**
  - `start_trainer_battle`/`start_tag_battle` → `trainerBattle` (`vm/src/ops.ts:433`) logs `{kind:'trainer', result:'won'}` and yields.
  - `start_first_battle` (`runner.ts:808`) and `start_catching_tutorial` log `scripted`.
  - `check_won_battle` is always 1. `check_lost_battle` falls through to 0.
  - `black_out_from_battle` throws.
  - The world's wild check (`world/src/world.ts:628`) rolls `{species, level}` on `encounterRng`, logs `{kind:'wild', result:'fled'}` and drops the level.
- **Plug point.** A battle is one long wait. A script context already waits with `pause(c, wait)`, so the battle ops become `startBattle(setup)` plus a wait on the result, which is written to the script's var when the battle ends.
  - Wild battles start from the world, not a script, so the game needs a battle mode: while a battle is active, `step` routes input to the battle and the field and VM do not tick.
  - The app already precedes field input with UI input (`game-view.ts:98`).
- **Saves only between scripts.** A battle is never saved. A wild battle has no script, so the save rule extends to "and no battle active". Replays and the save round trip are unaffected.
- **Replays.**
  - The grammar has no battle verbs. Battle choices are deterministic given the battle seed, which comes from the game's main stream at battle start.
  - Asserts are already by content (`assert battle <kind> <id|*> <result>`), so real battles change only the results (`caught`, `lost`) and the lengths.
  - CP1–4 currently assert 10 trainer battles (rival 201, 3 on Route 202, rival 203, 5 more trainers, Roark), the tutorial, and wild `fled`. The player party is Piplup L5 throughout, so real battles need levelling on the way.
- **Data needed from the Pokémon model.**
  - The `Monster` instance: personality, IVs, EVs, nature, ability, exp, HP, status, moves with PP, friendship, OT.
  - Species: base stats, types, abilities, growth rate, base exp, EV yield, catch rate, learnsets, evolutions.
  - Moves: type, category, power, accuracy, PP, priority, effect.
  - Items: battle use, ball type, held effect.
  - The bag, money and Pokédex seen/caught.
  - Today `Trainer.party` keeps only `{species, level}`. Moves, held items, the IV/difficulty byte, form, `aiFlags` and trainer `items` must be imported.
