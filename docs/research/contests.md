# Super Contests

2026-10-23. The offline Super Contest circuit: what is built (reception, the session, scoring, rewards, saves), the seam
the three rounds plug into, and for each round (visual, dance, acting) its decomp sources and rules, so each round lane
can start from here. Scope and the decomp's size are in [underground-contests-scope.md](underground-contests-scope.md) §2.
Link contests are out of scope (docs/scope.md); their receptionist answers "no connection".

Source: pret/pokeplatinum at `1dc13dc` (local `reference-projects/pokeplatinum`), for names, offsets and understanding
only. Paths are relative to its root. "Frame" is one 30 Hz tick. **(inferred)** marks what was reasoned, not read.

## 1. Before this work

Talking to the official receptionist walked the whole script on stubs: the menus worked, but the party menu never
opened, `new_contest` did nothing, every `message_synchronized` was skipped (the entry, the MC's introductions), the
player was walked through the door, warped to the stage and straight back, and handed "Congratulations! Here is your
prize!" with a White Fluff (`get_first_time_victory_accessory` returned 0, accessory 0), every time, with no ribbon. The
practice receptionist did the same without the prize.

## 2. What is built

| Layer | Where | What |
|---|---|---|
| Tables | importer `contests.ts` → `NewGame.contests` (contracts `ContestTables`) | contest_data.narc members 0–14 (§3), the player's stage gfx and attire sprites |
| Rules | services `contest.ts` | eligibility, fame, the contest LCRNG, theme, judges, rivals (and the post-game pool), NPC Pokémon, condition points and hearts, final scoring, placement, practice placement, first-win accessory, rewards (`endContest`) |
| Script ops | vm `contest-ops.ts` (`REAL_CONTESTS` in coverage.ts) | every op the Hall's scripts use offline (scrcmd_contests.c, the contest party menu, `message_synchronized`, the attire spin, the camera flashes, `contest_photo_has_data`) |
| Session | `GameState.contest` (contracts `ContestSession`) | from `new_contest` to `end_contest`; never in a save (saves happen between scripts) |
| App | menus `contest/contest.ts`, app `ui/contest.ts` | the rounds in order through the seam, then the final scoring and the results (ROM frames, font, `TEXT_BANK_CONTEST_RESULTS`, `SEQ_CON_TEST`, `SEQ_CO_KEKKA`, `SEQ_CO_FANFA`) |
| Rounds | menus `contest/rounds.ts` | the seam's registry: the visual round (`contest/visual.ts`, §5.8), the dance (`contest/dance.ts`, §6.8), acting a placeholder |
| Party | menus `party.ts` mode `contest` (app `contest-select`) | ELIGIBLE/INELIGIBLE notes, ENTER/SUMMARY/CANCEL |
| Saves | schema v20 `contestPhotos` | the winner photo per type, with the visual round's outfit |
| Photo frames | menus `contest/photo.ts`, vm `scr_cmd_0a8` | the lobby's frames show a type's winner photo (§5.8) |

Still stubs: the TV segment (`tv:contest-hall`), link ops.

**Placeholder rounds** (acting today). Each logs `contest:placeholder:<round>` once ("contest round visual: placeholder …"), counted
in the stub log, and `CONTEST_ROUNDS_STATUS` (vm coverage.ts) puts them in the coverage report
(`contestRoundsPlaceholder`); a ROM test checks the status against the registry. A placeholder shows the round's name
and "Placeholder: scored by condition." and ends on A. Its outcome: visual dress-up points 0 (so the visual value is the
condition hearts), dance and acting points = each contestant's condition points + 1.

**RNG.** The contest LCRNG (`ContestSession.rng`, services `contestRandom`: `x·0x41C64E6D + 0x6073`, high 16 bits) is
seeded with one draw of the game's main stream at `new_contest` (the DS reseeds from the clock, Contest_SetLCRNGSeed).
Draw order as Contest_Init: theme, judges' main seat, rivals (star, seats, star's seat), each rival's IVs (two draws),
then the rounds' draws, then the four tie-break draws of the final scoring.

## 3. Data (contest_data.narc and friends)

| Member | Record | Fields (`ContestTables`) |
|---|---|---|
| 0 | 96 × 48 B (UnkStruct_ov6_02248BE8) | `ContestOpponent`: species, 4 moves, nickname/trainer (TEXT_BANK_CONTEST_OPPONENT_NAMES), condition ×6, `rank`, `types`, `single` (unk_20_8), `practice` (unk_20_9), `pool` (unk_20_10: 0 always, 1 pre-post-game, 2 post-game, 3 post-game star), `gender`, `aiLevel` (unk_20_14, unk_FC), `gfx` (unk_08), `trainerClass` (unk_0A: the trainer picture), `fame` (unk_2E), `dressUps` (unk_22–2D, per theme) |
| 1 | 12 × 8 B (UnkStruct_020954F0) | `ContestJudge`: name (TEXT_BANK_CONTEST_JUDGE_NAMES), `rank`, `roles` per type (1 side, 2 main candidate) |
| 2 | 96 × 84 B (UnkStruct_020951B0) | `ContestDressUp`: ≤ 20 × {accessory, x, y, s8 priority}, `monPriority` (s8, unk_51), `backdrop` (unk_52) |
| 3–14 | 12 × 100 B | `themes[t][accessory]`: dress-up points per accessory for theme t (ov17_02252A70) |

Not read by the decomp, kept out of the records: opponent u32 0x00 (0 everywhere), u32 0x04 (0xFFFF everywhere), u8
0x2F (100 everywhere); judge u16 0x02 (36/62/35 by judge identity) and the top nibble of 0x04 (1 everywhere).
Opponents 92–95 enter no type (unused). Each rank has, per type, two side judges and one main candidate, so the judges
are fixed per rank (the main seat's draw still happens).

Other data: move contest effect and type are already on `Move.contest` (`{effect, type}`). Accessory names, articles and
backdrop names are text banks 386–388; theme names TEXT_BANK_UNK_0385 messages 7 + theme; round texts
TEXT_BANK_CONTEST_{TEXT, VISUAL_COMPETITION, DANCE_COMPETITION, ACTING_COMPETITION, EFFECTS, RESULTS} — all imported
with every bank. Sequences by SDAT index: SEQ_CON_TEST 1135 (CONTEST_DRESSING_ROOM), SEQ_CO_DRESS 1169, SEQ_CO_KAWAI
1176, KASHI 1177, UTSUK 1178, TAKUMA 1179, KAKKO 1180, KEKKA 1181, FANFA 1182, SEQ_SE_DP_KATI 1527 (shutter),
SEQ_SE_DP_CON_* 1759–1787. Not imported yet (round lanes): the per-effect table Unk_020F568C (arm9, src/unk_02094EDC.c:34:
base appeal and message ids), Unk_ov17_02253AF8 (overlay 17: effect classes), the dance song table, the acting AI
rules, the dance and acting rounds' contest_bg/contest_obj art (the visual round's is imported, §5.8).

## 4. The round seam (contracts `contests.ts`)

```ts
type ContestRoundKind = 'visual' | 'dance' | 'acting';
interface ContestRoundContext { session; registries; state; host; log; rng(): number }   // rng: the contest LCRNG (u16)
interface ContestRound { kind; placeholder: boolean; step(input: InputFrame): ContestRoundOutcome | null; view(): ContestRoundView }
type ContestRoundOutcome =
  | { kind: 'visual'; dressUp: number[]; outfit: ContestDressUp }   // unk_02 per contestant id; the player's photo
  | { kind: 'dance'; points: number[] }                            // unk_04
  | { kind: 'acting'; points: number[] };                          // unk_06
type CreateContestRound = (kind, ctx) => ContestRound;
```

- The app (`contestScreen`) computes the condition points (`scores.condition`, unk_00) first, then for each round of the
  competition creates it with `createContestRound(kind, ctx)` (menus `contest/rounds.ts`), steps it once per tick with
  the frame (`InputFrame`: pressed/held buttons, taps), and stores the outcome in `session.scores` (and the visual
  outfit in `session.dressUp`) before the next round. A round sees the earlier rounds' scores in `ctx.session.scores`
  (the acting round needs visual + dance for its first order, §7.2).
- A round owns everything inside it: its screens, BGM and SEs (`ctx.host.sound`), its RNG draws (`ctx.rng`), its NPC
  AI. It writes nothing else; the app does the final scoring and the results.
- Views: `ContestRoundView` is a union; a lane adds its own member (`{ round: 'dance', placeholder: false, … }`) and
  draws it in `packages/app/src/ui/contest.ts` `round()`. Taps go through `InputFrame.tap`.
- A lane replaces its case in `createContestRound`, flips its `CONTEST_ROUNDS_STATUS` entry to `'real'`, and adds its
  replay. Contest ids: contestant 0 is the player; entry number = 3 − id; the DS presents in entry order 1–4 (ids 3,2,1,0).
- Practice runs one round (competition 3/5/7), placement = rivals with more points in that round
  (`practicePlacement`); the full contest (2) runs all three, then `finalResult`.

## 5. Visual round (dress-up, then judging)

### 5.1 Sources

| what | where |
|---|---|
| Dress-up app | `src/overlay022/ov22_02255D44.c`: `VisualCompetition_Init` `:404`, `_Main` `:469`, `_Exit` `:628` |
| Accessory limit per rank | `ov22_02257580` `:1451` |
| Timer and countdown | `src/overlay022/ov22_0225A428.c`: `ov22_0225AB54` `:372`, tick `ov22_0225AC8C`, `ov22_0225AD5C`, last-10 s `ov22_0225ACBC` |
| Photo save into the contest struct | `ov22_02256FD8` `:1166` (called from `_Exit`) |
| Scoring app | `src/overlay017/ov17_0223CB1C.c`: `VisualCompetitionScoring_Main` `:223`, state table `Unk_ov17_02252F44` `:76` |
| Score formulas | `src/overlay017/ov17_0223F118.c`: `ov17_0223F334` `:192` (dress-up), `ov17_0223F374` `:206` (condition) |
| Accessory sum and theme table load | `src/overlay017/ov17_02252A70.c:11`, `:29` |
| Heart counts | `src/unk_02094EDC.c`: `sub_02095928` `:932` (condition), `sub_0209598C` `:964` (dress-up) |
| Presentation commands | `src/overlay017/ov17_02247A48.c`: table `Unk_ov17_02254488` `:103`; hearts `ov17_02247F2C` / `ov17_02247F8C` `:394`/`:413`; photo pop-in `ov17_02248860` `:888` |

### 5.2 Flow and timings

**Dress-up app** (`VisualCompetition_Main`):

1. Fade the BGM out (`Sound_FadeOutBGM(42, 30)`), then wait for the fade to finish.
2. Show bank 385 messages: 26 (practice uses 28), then `29 + theme`, then 42 (practice uses 41). Each waits for its
   printer.
3. In link play, sync on comm timing 2.
4. Play SE `SEQ_SE_DP_CON_016`, run a circle fade-in (speed 6), then start BGM `SEQ_CO_DRESS`.
5. Run the timer. It holds 60 s × 30 = **1800 frames** (`unk_20 = 60*30`) and counts down 1 per frame. The display
   shows `frames / 30` with two digits. When the shown second reaches 10 or less, each change plays
   `SEQ_SE_DP_HYUN2` and the digits switch to the alternate palette. The round ends when the shown value is 0, about
   1771 frames after the start.
6. Pressing the finish button sets state 3 (`ov22_02256AE4` `:868`). Single player then forces the timer to 0 at once
   (`ov22_022577A0` `:1612`). In link play, everyone must be done first.
7. At the end: SE `SEQ_SE_DP_MAZYO`, wait for the timer's end animation, wait until MAZYO stops, fade out (speed 6),
   SE `SEQ_SE_DP_CON_017`.

**Scoring app.** BGM `CONTEST_DRESSING_ROOM_sseq` (sequence id 1135, `SEQ_CON_TEST`); SE `DOOR_OPEN` on start.

1. Compute `unk_02` and `unk_00` for all 4 contestants.
2. Show the intro message.
3. For each contestant in the order 3, 2, 1, 0:
   - Show the photo (cmd 0) and run a brightness transition (cmd 14).
   - Show the message for the nth entry (3..6), then cmd 2 and cmd 15.
   - Show hearts (cmd 6). The hearts sequence:
     1. Play SE `CON_007` and wait 15 frames.
     2. Spawn one heart sprite every 4 frames at a random screen position: condition hearts first, then dress-up hearts
        in a different style.
     3. Play SE `CON_007` and hold for 30 frames.
4. Play SE 1765 (`CON_007`), show the closing message (7 in a full contest, else 0), then end with a circle fade-out.

### 5.3 Scoring (`ov17_0223F374`, `ov17_0223F334`)

**Condition score**, using integer arithmetic:

```text
score   = primary + (secondaryA + secondaryB + sheen) / 2
unk_00  = score * itemPct / 100
```

| contest | primary | secondary A / B | scarf for 110% | scarves for 105% |
|---|---|---|---|---|
| Cool | Cool | Tough / Beauty | Red | Blue, Yellow |
| Beauty | Beauty | Cool / Cute | Blue | Red, Pink |
| Cute | Cute | Beauty / Smart | Pink | Blue, Green |
| Smart | Smart | Cute / Tough | Green | Pink, Yellow |
| Tough | Tough | Smart / Cool | Yellow | Green, Red |

`itemPct` is 100 for any other held item.

**Dress-up score.** `unk_02` is the sum, over the photo's 20 accessory slots that are in use, of
`themeTable[accessoryId]`. `themeTable` is contest_data.narc member `3 + theme`, a u8 array of 100 entries. The
backdrop does not count.

**Hearts.** These are the values the final scoring uses.

- Condition hearts (0..8): the number of thresholds `t` with `unk_00 >= t`.

  | rank | thresholds |
  |---|---|
  | Normal | 10 20 30 40 50 60 70 80 |
  | Great | 90 110 130 150 170 190 210 230 |
  | Ultra | 170 200 230 260 290 320 350 380 |
  | Master | 320 360 400 440 480 520 560 600 |
  | Link | 100 200 300 400 450 500 550 600 |

- Dress-up hearts (0..4): 0 if `unk_02 == 0`. Otherwise 1 plus the number of thresholds `t` with `unk_02 > t`.

  | rank | thresholds |
  |---|---|
  | Normal | 3 5 8 |
  | Great | 5 10 15 |
  | Ultra | 7 15 23 |
  | Master and Link | 10 20 30 |

- The visual round's raw value in the final scoring is `conditionHearts + dressHearts`, from 0 to 12.

### 5.4 NPC behaviour

NPCs do not dress up live. Their photos come from the templates in member 2 (§3). The scoring math is the
same for everyone.

### 5.5 Player inputs

Touch-screen accessory placement on the dress-up screen. The maximum number of accessories is 5, 10, 15 or 20 for
Normal to Master; link play allows 20. There is also a finish button.

### 5.6 Writes

- `unk_E8[player]`, the photo, written on exit.
- `unk_118[c].unk_00` and `unk_02` for all 4 contestants.

### 5.7 Data and assets

- contest_data.narc members 2 and 3..14.
- `NARC_INDEX_GRAPHIC__IMAGECLIP`: members 224..226 for the timer background, 227..230 for the clock digits.
- Scoring screen: contest_bg members 34..37 (palettes) and 19..24 (`ov17_0223D3B8`); contest_obj 7 and 73..75 for heart
  sprites (`ov17_0223F118.c:313`).
- Text banks:
  - `TEXT_BANK_UNK_0385`, used by the dress-up UI and for theme names.
  - `TEXT_BANK_CONTEST_VISUAL_COMPETITION`.
  - `TEXT_BANK_CONTEST_ACCESSORY_NAMES` and `TEXT_BANK_CONTEST_BACKDROP_NAMES` sit next to bank 385 **(inferred: used by
    the case UI)**.

### 5.8 What is built (the visual round)

- **Model** (menus `contest/visual.ts`, rules in services `contest-visual.ts`): the intro (the BGM's 30-frame fade, bank
  385 messages 26/28, 29 + theme, 42/41 with the limit), the dress-up and the judging, frame by frame as §5.2.
- **Fashion Case** (ov22_022567FC, ov22_02257F50.c): each accessory held, as often as held, on its page (14 pages by id,
  ov22_02257FB0) at a random place; backdrops nine to a page in the order received. NEXT/BACK turn to the next page
  that holds something; the ACCESSORIES/BACKDROPS tabs switch lists. The scatter and the "back to a random place" use
  a local LCRNG seeded from the contest RNG's state (the DS: MTRNG); the dress-up draws nothing from the contest RNG.
- **Stylus** (ov22_022589E0.c): a touch picks the stage's first hit (on-Pokémon list, then the Pokémon itself picks
  nothing in a contest, then the others), else the shown page's; accessories by their pixels within ±4 px
  (ov22_02254E54). A drop with the picture's inner rectangle (margins 0/10/20 for 16/32/64 px) wholly in the stage
  places it if fewer than the limit are there (5/10/15/20), else "There is no more space." and it slides back over 4
  frames; a drop wholly in the case stays; anything else slides back (from the stage: to a random place). An accessory
  is on the Pokémon when one of its 16 sample points hits the front picture's opaque pixels (`PokemonFace.opaque`); the
  Pokémon is centred at (192, 101 + height). A backdrop is chosen by picking it up.
- **Photo** (ov22_02256FD8): on the Pokémon plus everything whose rectangle a kept accessory's sample point falls in,
  repeatedly; in the photo's coordinates (dress-up screen + (−64, +40)); priorities −1… on the Pokémon, then the
  Pokémon, then 8 lower the others. Dress-up points: the photo's accessories' theme points. NPC photos: their outfit
  for the theme.
- **Judging**: one contest-RNG draw a frame (VisualCompetitionScoring_Main), the entry messages, the photo with the
  Pokémon's centre at (128, 64 + height) (no backdrop), hearts from the RNG (ov17_02247F8C: 4 or 5 draws each), the
  closing message in a full contest.
- **Screens** (app `ui/contest-visual.ts`, art importer `ui2d/contests.ts`): the intro is the top screen's clock; the
  dress-up is the touch screen with the top screen folded into one line (theme or held accessory's name, placed/limit,
  seconds); the judging is the stage, curtain, photo and hearts. Keys (not on the DS): the PC's hand; Y jumps to the
  next item of the page, or with one held to the Pokémon's head; A picks/drops, B puts back, L/R pages, SELECT tabs,
  X/START DONE.
- **Photo frames** (ScrCmd_0A8, ov22_0225B660): the photo at (72, 16) with its backdrop, the type's banner and bank 385
  messages 43 and 44; A or B closes it.
- **Deviations**: Platinum front pictures (the DS uses the DP ones here); backdrop icons are picked by their
  rectangle; the case's page turn and the clock's pulse are drawn simply; the end waits fixed frames (45) for MAZYO.
- **Tests**: services `contest-visual.test.ts` (fixtures), `tests/integration/contest-visual.rom.test.ts`, replays
  `sys-contest-normal-cool` (official, by keys), `sys-contest-hall-story` (practice), `sys-contest-photo`, browser
  `contests.rom.spec.ts` (keys and a mouse/finger drag).

---

## 6. Dance round

### 6.1 Sources

| what | where |
|---|---|
| App and state machine | `src/overlay017/ov17_0223DAD0.c`: `DanceCompetition_Main` `:331`, states `Unk_ov17_02253050` `:174` |
| Song table and song choice | `Unk_ov17_02253084` `:92`, `Unk_ov17_0225312C` `:158`, `ov17_0223E3CC` `:674` |
| Measure variants | `Unk_ov17_02252FC4` `:168`, `ov17_0223F0BC` `:1278` |
| Timing setup | `ov17_0223E9A4` `:948` |
| Write-back and acting order | `ov17_0223EEB8` `:1175` (writes `unk_04` at `:1187`) |
| Frame clock synced to the sequencer | VBlank handler `ov17_0223E09C` `:454` |
| Per-measure dance task | `src/overlay017/ov17_0224CFB8.c`: `ov17_0224D710` `:552` |
| Input gate | `ov17_0224DC1C` `:756` |
| Grading | `ov17_0224DDE4` `:887`, `ov17_0224DD90` `:867`, `ov17_0224DE54` `:924` |
| Command table | `Unk_ov17_022549E4` `:92` |
| Points and lead-step log | `src/overlay017/ov17_0224A0FC.c`: `ov17_0224B20C` `:1173` |
| Round start time | `ov17_0224C660` `:2105` |
| NPC AI | `src/overlay017/ov17_0224E930.c` (whole file) |
| Input | `src/overlay017/ov17_022492DC.c`: rectangles `:211`, `ov17_02249760` `:454` |

### 6.2 Songs and the timing model

`Unk_ov17_02253084` holds the song entries. Each has a sequence id, a BPM, `unk_04` (measures per round), `unk_05`
(moves the lead may make per measure), `unk_06` (lead-in beats), `unk_07` (extra gap beats) and timing windows
`{a, b, c, d}` in frames.

| idx | sequence | BPM | meas./round | moves | `unk_06` | `unk_07` | windows a,b,c,d |
|---|---|---|---|---|---|---|---|
| 0 | `SEQ_CO_KASHI` (1177) | 120 | 2 | 3 | 4 | 4 | 2,2,3,3 |
| 1 | `SEQ_CO_TAKUMA` (1179) | 120 | 2 | 4 | 4 | 4 | 2,2,3,3 |
| 2 | `SEQ_PL_MTKAKKO` (1205) | 100 | 2 | 4 | 3 | 3 | 1,1,2,2 |
| 3 | `SEQ_PL_MTUTSUK` (1209) | 60 | 2 | 4 | 3 | 3 | 2,2,3,3 |
| 4 | `SEQ_PL_MTKAWA` (1207) | 150 | 2 | 4 | 4 | 4 | 1,1,2,2 |
| 5 | `SEQ_PL_MTKASHI` (1206) | 132 | 2 | 4 | 4 | 4 | 1,1,2,2 |
| 6 | `SEQ_PL_MTTAKMA` (1208) | 140 | 2 | 4 | 4 | 4 | 1,1,2,2 |

Song and variant by rank × type (`Unk_ov17_0225312C`):

| rank | Cool | Beauty | Cute | Smart | Tough |
|---|---|---|---|---|---|
| Normal | 0 / v0 | 0 / v0 | 0 / v0 | 0 / v0 | 0 / v0 |
| Great | 1 / v0 | 1 / v0 | 1 / v0 | 1 / v0 | 1 / v0 |
| Ultra | 2 / v1 | 3 / v1 | 4 / v0 | 5 / v0 | 6 / v0 |
| Master | 2 / v1 | 3 / v1 | 4 / v0 | 5 / v0 | 6 / v0 |

Link play with `unk_15B > 0` forces song 1 with variant 0.

Measure variants (`Unk_ov17_02252FC4`):

| variant | `unk_02` beats per measure | half-beats (`ov17_0223F0BC` case 4) | `unk_03` timeline tiles (case 2; ×8 px case 3) | `unk_00` |
|---|---|---|---|---|
| v0 | 16 | 32 | 32 (256 px) | 14 |
| v1 | 12 | 24 | 30 (240 px) | 15 |

`unk_00` (case 0) is the stage's tilemap: `ov17_0223E67C` loads contest_bg member 14 or 15 with it.

Derived values, stored ×10000 (`ov17_0223E9A4`):

```text
beat      = 1800 * 10000 / BPM            (frames per beat ×10000; 120 BPM = 15 frames)
measure   = round(beat * beatsPerMeasure / 10000)    frames
leadIn    = beat * unk_06
gap       = beat * unk_07
tickFrames = beat / 48                    (sequencer at 48 ticks per beat)
```

**Clock.** Once the song starts (cmd 11 plays the BGM directly), the frame counter is driven by the sequencer:
`round(seqTicks * tickFrames / 10000)`. VBlank adds 1 per frame and re-syncs to the sequencer when it drifts by more
than 1, or after 18 frames.

**Round start** (`ov17_0224C660`): round `r` (0..3) starts at song frame
`r*(unk_04*measure) + (r*(leadIn+gap) + leadIn)/10000`.

**Measure layout.** The lead dances in the first half of the measure. The other three copy in the second half. Each
round has `unk_04` = 2 measures.

### 6.3 Round structure (`ov17_0223DAD0.c` states)

1. Sync (link waits 120 frames when `unk_15B > 0`).
2. Intro message (cmd 9). Its parameter is `ov17_0224C57C(rank)`, which is {3, 3, 4, 4}.
3. Cmd 3: fade the dressing-room BGM out over 30 frames, then SE `CON_019`.
4. Compute timing, then cmd 11 starts the song.
5. Run 4 rounds (`unk_A3C.unk_04` = 0..3). The lead of round `r` is `unk_A3C.unk_00[r]`, which is 3, 2, 1, 0, so the
   player leads last. Stage positions `unk_05` start at {3, 2, 1, 0} and rotate left by one after each round; position
   0 is the lead. Each round:
   1. Store a new AI seed for each NPC.
   2. Cmd 7 (set positions), cmd 5 (dance the round), cmd 8 (end of round).
   3. If more rounds follow, cmd 6 announces the next lead.
6. Cmd 12: wait for the song to end, show the result (`ov17_0224CE28`), wait 60 frames, return to the dressing-room
   BGM with SE `CON_007`.
7. Write-back (§6.7), then the closing message.

### 6.4 Inputs and grading

**Inputs.** Four directions (`ov17_02249760`):

| touch area (x × y) | keys | direction index | stored code |
|---|---|---|---|
| 88..168 × 0..80 | X / Up | 0 | 1 |
| 88..168 × 96..176 | B / Down | 1 | 2 |
| 8..88 × 40..120 | Y / Left | 2 | 3 |
| 168..248 × 40..120 | A / Right | 3 | 4 |

Stored step codes are `index + 1`.

**Input gate** (`ov17_0224D710`, `ov17_0224DC1C`):

- **Lead.** Steps are accepted while `t < measure/2 - quarterBeat` (quarterBeat = `beat/4/10000` frames) and while the
  number of steps is below the song's move count. `t` is frames since the start of the measure.
- **Backup.** Steps are accepted while `t >= measure/2` and `t < measure - quarterBeat`, with the same step cap.
- **Cooldown.** After each accepted step there is a cooldown of `beat/10000 - 2` frames.

**Grading** (`ov17_0224DE54`):

1. Snap `t` to the nearest half-beat. The result is a frame distance `d` and a half-beat index `k`; on an exact tie
   the earlier half-beat wins.
2. **Backup check.** For a backup, look up the lead's logged step whose index equals `k - halfBeatsPerMeasure/2`.
   - If there is none, the step is a miss.
   - If the timing is good (class 0 or 1) but the direction differs from the lead's, the step is a miss and is flagged
     as a wrong move.
3. **Classify `d`** with the windows `{a, b, c, d}`:

   | `d` (frames) | class | sub-grade | points |
   |---|---|---|---|
   | ≤ a | 0 | 0 | +2 |
   | ≤ b | 0 | 1 | +2 |
   | ≤ c | 1 | 2 | +1 |
   | ≤ d | 1 | 3 | +1 |
   | otherwise | 2 | 4 | 0 |

   Because a = b and c = d in every song, only three outcomes exist.
4. **Points** (`ov17_0224B20C`): add the step's points to `unk_A3C.unk_0A[contestant]`. Nothing else adds to it.
5. **Lead log.** Every lead step is written to the lead-step log `unk_1AD4[8]`, misses included.

**Effects and sound.**

- Combo counters drive SE `CON_021`, `CON_022` and `CON_023` (rising combo), `CON_024` (class 1), and `CON_026` or
  `CARD10` (miss or wrong move).
- `CON_028` or `CON_027_3` marks the last step of a measure.
- An "all synced" effect (`ov17_0224CB80`) plays when the lead hit all its moves cleanly, or when every backup step in a
  measure was class 0. It is cosmetic only.

**Maximum points (inferred).** When leading: 2 measures × moves × 2. As a backup: 2 measures × the lead's step count ×
2, in each of 3 rounds. With 4 moves, the total is 16 + 48 = 64.

### 6.5 NPC AI (`ov17_0224E930.c`)

The AI uses a per-NPC ARNG seed, reset every round, and level `L = unk_FC` (0..3).

**AI as lead** (`ov17_0224E990`):

1. **Choose step positions** in the first half of the measure. Exactly `moves` positions are drawn, never position 0.
   - Normal and Great draw from whole-beat slots 1..7 (v0) or 1..5 (v1).
   - Ultra and Master draw from half-beat slots 1..15 or 1..11. Two adjacent slots are never both used, and an off-beat
     (odd) slot is rejected half the time.
2. **Add jitter** to each step's time: `rand % (2+J) - (1 + J/2)` frames.
   - `J = {1,2,3,4}[L]`, doubled for Normal, unchanged for Great, halved for Ultra, a third for Master.
   - A negative time becomes 0; then `t − planned >= limit` (a quarter beat for variant 0, a sixth for variant 1,
     rounded) sets `t = planned + limit − 1`. The compare is unsigned (`s32 − u32`), so every early jitter lands on
     the latest time the limit allows: the result is always in `[planned, planned + limit − 1]`.
3. **Choose directions.** The first is random (0..3). Each later one repeats the previous direction with probability
   {90, 40, 0, 0}% by rank. The last move is always random.

**AI as backup** (`ov17_0224EE90`):

1. **Target time.** Aim at the lead's logged half-beat (`k × halfBeat`) in the second half, with jitter
   `rand % (2+J2) - (1 + J2/2)`.
   - `J2 = {1,2,3,4}[L]`, then ×2 for Normal and Great and ×1.5 for Ultra.
   - In link-forced-song mode with Cute or Smart, the multiplier is ×3 for Ultra and ×2.5 for Master.
   - The function first computes extra terms from the beat spacing and then overwrites them, so those terms have no
     effect.
2. **Mistake chance.** The chance of a wrong direction is `(J2 + M)%`. `M` adds:
   - +3 for a level-specific direction (L0 = up, L1 = down, L2 = right, L3 = left);
   - +8 if the lead changed direction from its previous step;
   - +2 if one of this step and the previous lead step is on the beat and the other is off it;
   - +5 if the gap since the previous lead step is 8 half-beats or more.

   `M` is then ×2 for Normal and Great, ×1.5 for Ultra (×2 in link-forced Cute or Smart), and ×1 for Master (×1.5 in
   link-forced Cute or Smart).
3. **On a mistake,** the AI picks a random direction different from the lead's.
4. **Cooldown.** The AI has the same cooldown as the player.

### 6.6 Text, sound, graphics

- Text: `TEXT_BANK_CONTEST_DANCE_COMPETITION`. Message ids are in `Unk_ov17_0225470C` (`ov17_0224A0FC.c:244`).
- BGM: `CONTEST_DRESSING_ROOM_sseq` around the dance, and the song table above during it.
- SE: `CON_007`, `CON_019`, `CON_021..028`, `CON_030`, `CON_031`, `CARD10`.
- Graphics: contest_bg 32 and 36 (palettes) and 13; contest_obj sprites; particle data member 3
  (`ov17_0223DAD0.c:834`).

### 6.7 Writes

- `unk_118[c].unk_04 = unk_A3C.unk_0A[c]` (raw points).
- Acting order. The dance app normalizes the visual round and the dance round with `ov17_02251930` (§8), sums
  the two, and bubble-sorts the contestants descending. Ties keep the lower contestant id first. The result goes to
  `Contest->unk_156`, which becomes the first acting turn's order. Practice modes set `unk_156` to 3, 2, 1, 0 instead.

### 6.8 What is built

| Layer | Where | What |
|---|---|---|
| Tables | importer `contest-dance.ts` → `ContestTables.dance` (contracts `ContestDanceTables`) | overlay 17 by offset and SHA-1: songs (`Unk_ov17_02253084`), song per rank × type (`Unk_ov17_0225312C`), variants (`Unk_ov17_02252FC4`), AI spread and repeat (`Unk_ov17_02254A80`, `A84`), stage places (`Unk_ov17_022546F4`), grade spots (`546CC`), note rows (`549BC`), stage tints (`546DC`), shades by place (`549C0`), button rects (`Unk_ov17_02254564`) |
| Art | importer `ui2d/contest-dance.ts` | the stage per variant (contest_bg 13, 14/15, 32, 36), the timeline strips (row 19, variant 1's tiles `Unk_ov17_02254898`), the touch screen's buttons and their press steps (18, 17, 28, 33, 16; `Unk_ov17_02254630`), the OBJ sets (notes, grades, arrow, shadow, hearts, cursor, ball on contest_obj 6) |
| Rules | menus `contest/dance-rules.ts` | timing, round starts, the beat clock, snap/classify/grade, points, the lead log, the AI (ARNG per NPC) |
| Round | menus `contest/dance.ts` | the app's states and commands in DS frame order, the step gate, the points task, the presentation (dancers' steps, idle sway and bob, rotation, hearts, notes, grades, tints, flashes, shades by place), the sounds |
| View | app `ui/contest-dance.ts` | the stage on a canvas, the buttons as a card beside or under it (pointer down sends `step:<dir>`) |

Found while building it:
- **Frame order** (main.c): the app's Main runs first (it draws one contest LCRNG value every frame, so the stream
  depends on how long the intro's pages stay up), then the tasks by priority (the per-measure task 30000, the step
  points 30100, the dancers 39010, the hearts 40000), then the VBlank handler moves the clock. A task added from a
  task of lower or equal priority number runs from the next frame (sys_task_manager.c).
- **The button press animation** (`ov17_02249DA0`) copies its three steps on frames 1, 4 and 7 and ends on frame 10;
  the gate takes no step until it ends, and not before the cooldown `beat − 2` has run out (it counts only inside the
  window). The first frame of a window only opens the gate.
- **Hearts** (`ov17_0224AD70`) draw two contest LCRNG values each, up to `points / 2` (16) per scoring step, as long as
  the dancer has a free heart (each lives 11 frames).
- `ov17_0224B0E8` places the copy note on the row of `unk_05[playerContestantID]`, an index by contestant id into a
  table by position; offline the player is contestant 0, so it is the row of the round's lead, which is the player's.
- The intro (`CompetitionIsReady`) and the closing (`AnnounceLeadingMon`, official only, var 0 = the leader's trainer)
  take the message table's mode (`Unk_ov17_0225470C.unk_02`), not its index.
- The dancers carry no accessories here (the visual round's outfits are the visual lane's).

**Timing decision.** On the DS the counter `unk_107C` runs once a frame (one VBlank callback per main loop, 30 Hz) and
is re-set from the BGM sequencer whenever it differs. Our sequencer runs in the AudioWorklet, which only plays: the
game cannot read it. So the round runs the sequencer's tick count as a function of the game tick: after `n` ticks of
1/30 s the song has had `floor(n · 33513982 / (30 · 2728 · 64))` sound frames, each adding the BPM to a counter that
ticks at 240 (starting full) — exactly what the worklet plays at the app's 30 Hz, and a ROM test checks it against the
sound engine for all seven songs. That count feeds the VBlank handler's resync unchanged (`DanceClock`). Steps are
graded on the tick their input arrives; nothing depends on the render rate, and a replay is the same every run. Our
game tick is 30.00 Hz, not the DS's 29.91 Hz, so on our clock the counter runs a little ahead of the sequencer and the
resync now and then repeats a frame instead of skipping one. The song's end comes from its measured length on the same
time base.

---

## 7. Acting round

### 7.1 Sources

| what | where |
|---|---|
| App and states | `src/overlay017/ov17_0223B140.c`: `Unk_ov17_02252E10` `:89` |
| Per-act sequence | `ov17_0223C100` `:912` |
| End-of-turn judging | `ov17_0223C350` `:1011` |
| Next-turn reorder | `ov17_0223C888` `:1266` |
| Write-back | `ov17_0223CA30` `:1346` |
| Scoring engine | `src/overlay017/ov17_02245F14.c`: effect table `Unk_ov17_02253AF8` `:77`, steps `ov17_022460DC`..`ov17_02246518` |
| Type match, judge bonus, reorder | `src/overlay017/ov17_02243AC4.c` |
| Base appeal per effect | `Unk_020F568C` in `src/unk_02094EDC.c:34`, field `unk_04` |
| NPC AI | `src/overlay017/ov17_02246ECC.c`: `ov17_02246F9C` `:1291`, rule table `Unk_ov17_02253C30` `:101` (165 rows), conditions `Unk_ov17_02253BBC` `:69` |
| Move menu rule | `ov17_02243A98` (`ov17_022413D8.c:2132`) |
| Player UI | `src/overlay017/ov17_0223F7E4.c` (touch, plus D-pad/A/B) |
| Move animation bridge | `ov17_02243C28.c` |

### 7.2 Flow

There are 4 turns (`unk_220.unk_00`). Each turn:

1. **Selection.** The player picks a move and one of 3 judges (cmd 8). Then the AI picks for each NPC.
2. **Acts.** Each contestant acts in the order `unk_220.unk_01`, which starts as `Contest->unk_156` (§6.7). An act:
   1. Announce the move (cmd 7). An extra line appears if someone already played to this judge this turn.
   2. Base appeal (cmd 10).
   3. Immediate effect (cmd 11).
   4. Pending double from last turn (cmd 12).
   5. Voltage (cmd 13).
   6. Commit the voltage.
3. **Judging** (`ov17_0223C350`), after all four have acted:
   1. Add the judge-share bonus for everyone.
   2. Announce each judge by popularity.
   3. Run the class-5 judge effects in performance order.
   4. Run the pity effect in performance order.
4. Show the hearts (cmd 18).
5. Show the next-turn message, add the turn totals, reorder, and save the moves just used.

After turn 4: the "judging is over" message, then the write-back.

### 7.3 Scoring (all values are points; 10 points = 1 heart)

**Per act** (`ov17_02245F14.c`):

1. **Base.** The effect's base appeal: 0, 10, 20 or 30 (BASIC = 30). See the table in 3.6.
2. **Immediate effect** (class 3, run at once) adds its bonus.
3. **Pending double.** If last turn's move had DOUBLE_NEXT_TURN, the act's score so far is added again.
4. **Voltage** (`ov17_022463C4`). `m = typeMatch[contestType][moveType]`, using the cyclic order
   Cool → Beauty → Cute → Smart → Tough: +10 for the same type, 0 for a neighbour, −10 for the two opposite types.
   - `m > 0`, and the contestant is not under SUPPRESS: the chosen judge's voltage +10, capped at 50.
   - `m < 0`, the contestant is not under NO_VOLTAGE_DOWN, and the voltage is above 0: voltage −10, floored at 0.
   - If the judge's voltage is now 50, the act gets **+80** if it is the main judge (`unk_10E`) and **+50** otherwise.
     That voltage resets to 0 when it is committed.

**End-of-turn steps.**

- **Judge share** (`ov17_02243AE4`): +30, +20, +10 or 0 when 0, 1, 2 or 3 other contestants picked the same judge.
- **Class-5 judge effects:**
  - DOUBLED_JUDGE: +20 for each other contestant on the same judge.
  - UNIQUE_JUDGE: +30 if alone on the judge.
  - ALL_SAME_JUDGE: +150 if all 3 others picked the same judge.
- **PITY_POINTS** (class 6): +30 if no other contestant's snapshot score is below this contestant's pre-pity score.
  **(inferred: "lowest this turn, ties allowed".)** The snapshots come from different moments, so ties may resolve in a
  way that depends on order.
- **Turn total** `unk_18` is added to the acting total `unk_12[c]` and stored as the turn score `unk_1A[c]`.

**Immediate effects (class 3).** `pos` is the 0-based performance position.

| effect | rule |
|---|---|
| FIRST_NEXT_TURN / LAST_NEXT_TURN | Force this contestant to perform first / last next turn. Earlier forced contestants are shifted by one slot. |
| RANDOM_ORDER | Draw a random permutation as next turn's order for everyone. |
| 2_HEARTS_WHEN_VOLTAGE_UP | +20 if the move type exactly matches the contest type and the contestant is not suppressed. |
| CONSECUTIVE_USE | If this move was not used last turn, it may be used again next turn. |
| VOLTAGE | + the chosen judge's voltage before this act (0..40). |
| LOWERS_VOLTAGE | Every judge with voltage above 0 loses 10. Does nothing if the user is under NO_VOLTAGE_DOWN or all voltages are 0. |
| DOUBLE_NEXT_TURN | Next turn's act score is doubled (step 3 above). |
| STEAL_VOLTAGE | + the max-voltage bonus the previous performer got (50 or 80). Needs `pos > 0`. |
| SUPPRESS_VOLTAGE | Contestants at positions `pos..3` (the user included) cannot raise voltage this turn. |
| DOUBLE_FINAL_ACT | If last, + the current act score. |
| LOW_VOLTAGE_ADVANTAGE | +40, 30, 20, 10, 0 for judge voltage 0, 10, 20, 30, 40. |
| FIRST_PERFORMANCE_ADVANTAGE / FINAL_PERFORMANCE_ADVANTAGE | +20 if first / last. |
| NO_VOLTAGE_DOWN | Positions `pos..3` cannot lower voltage. |
| TWO_VOLTAGE_IN_A_ROW_ADVANTAGE | +30 if both this act and the previous one were voltage-raising matches and neither was suppressed. |
| HIGH_SCORE_LATER_TURN | +10, 20, 30, 40 by `pos`. |
| MAX_VOLTAGE_ADVANTAGE | +30 if the previous performer got the max-voltage bonus. |
| BASIC / NONE | No effect. |

**Move menu rule.** A move used last turn cannot be chosen again unless CONSECUTIVE_USE unlocked it.

**Next-turn order** (`ov17_02243B0C`):

- Sort ascending by this turn's score, so the lowest score performs first.
- On equal scores, whoever performed later this turn goes earlier.
- Forced keys override the score:
  - forced-first: −30000 + 10·slot;
  - forced-last: 29970 + 10·slot;
  - random order: {−10000, −500, 500, 10000}[slot].

**Voltage storage.** Per judge (3 values, 0..50 in steps of 10), carried across turns in `unk_220.unk_22`.

### 7.4 NPC AI (`ov17_02246F9C`)

1. **Candidate moves.** Disallowed moves are dropped (the menu rule, §7.3).
2. **Rules.** Each of the 165 rows of `Unk_ov17_02253C30` is {performance slot 1..4, condition id, target, judge mode,
   weights[4]}. A row applies when its slot equals this NPC's current slot + 1 and its condition holds.
   - The condition may also mark judges (by voltage state).
   - Weight = `weights[L] + (L ? weights[0] : 0)`.
   - The weight goes to every move that matches the target: a contest-effect id, 240 (the move type matches the
     contest type) or 241 (base appeal ≥ 20).
   - The same weight goes to the judge scores of the marked judges. Judge mode 0 clears the marks first; modes 2 and 3
     invert them.
3. **Pick the move** with the highest score. Ties break by a fresh LCRNG draw per slot.
4. **Help the player.** Outside link play, if no judge was scored, then with probability {230, 128, 51, 0}/256 by rank
   the AI takes −100 on the player's chosen judge, so it steers away from the player.
5. **Pick the judge** with the highest score, with a random tie-break.

The conditions check: owned effect types, a pending double, being the lowest acting total, voltage of 40, 30, ≤ 10,
< 20, > 20 or 0, and similar. Some conditions test "turn == 4", but the turn counter is only 0..3 when moves are
chosen, so those rules look like they never fire **(inferred)**.

### 7.5 Inputs, text, sound

- **Inputs:** a touch menu with 4 move buttons, then 3 judge buttons. The D-pad and A/B mirror them; B goes back.
- **Text:**
  - `TEXT_BANK_CONTEST_TEXT`, `TEXT_BANK_CONTEST_OPPONENT_NAMES`, `TEXT_BANK_CONTEST_EFFECTS` (move descriptions:
    `Unk_020F568C` line one and line two), `TEXT_BANK_CONTEST_ACTING_COMPETITION` (outcome lines).
  - Effect outcome messages use the `(messageId, argMode)` pairs in `Unk_020F568C` (variants 0..4, through
    `sub_02095790`). Effects with `Unk_ov17_02253AF8.unk_05 == 0` (UNIQUE_JUDGE, ALL_SAME_JUDGE) announce variant 4
    before the act.
  - Attention lines depend on the act score: ≤ 0, ≤ 20, ≤ 50 … (`ov17_0224314C`).
- **BGM:** `CONTEST_DRESSING_ROOM_sseq`.
- **Graphics:** contest_bg 1..5 and 30; judges come from `ov17_02241D94`.

### 7.6 Move data

`res/moves/<move>/data.json` stores these under a `"contest"` object with keys `"effect"` (`CONTEST_EFFECT_*`) and
`"type"` (`CONTEST_TYPE_*`). The brief named the keys `contest_effect`/`contest_type`; those are not the real names.

Base appeal per effect (`Unk_020F568C.unk_04`) and class (`Unk_ov17_02253AF8.unk_04`):

| base | effects |
|---|---|
| 30 | BASIC |
| 20 | FIRST_NEXT_TURN, LAST_NEXT_TURN, 2_HEARTS_WHEN_VOLTAGE_UP, CONSECUTIVE_USE, LOWERS_VOLTAGE, SUPPRESS_VOLTAGE, RANDOM_ORDER, DOUBLE_FINAL_ACT, FIRST/FINAL_PERFORMANCE_ADVANTAGE, NO_VOLTAGE_DOWN, MAX_VOLTAGE_ADVANTAGE |
| 10 | UNIQUE_JUDGE, TWO_VOLTAGE_IN_A_ROW_ADVANTAGE, PITY_POINTS |
| 0 | NONE, DOUBLED_JUDGE, VOLTAGE, ALL_SAME_JUDGE, DOUBLE_NEXT_TURN, STEAL_VOLTAGE, LOW_VOLTAGE_ADVANTAGE, HIGH_SCORE_LATER_TURN |

Classes: 5 for DOUBLED_JUDGE, UNIQUE_JUDGE and ALL_SAME_JUDGE; 6 for PITY_POINTS; 3 for everything else. Classes 2 and
4 have code paths but no effect uses them.

### 7.7 Writes

`unk_118[c].unk_06 = unk_220.unk_12[c]` (the raw acting total).

---

## 8. Final scoring and results (`src/overlay017/ov17_02250744.c`, `ov17_0224F4D4.c`, `ov17_02251D6C.c`)

**Weights** (`ov17_02251860` `:879`):

| competitionType | visual | dance | acting |
|---|---|---|---|
| Full contest (2) | 3333 | 3333 | 3333 |
| 0 | 6000 | — | 4000 |
| 1 | 7000 | 3000 | — |
| solo / practice | 10000 for its own round | | |

**Normalisation** (`ov17_02251930` `:947`):

```text
raw[c]  = visual: conditionHearts + dressHearts;  dance: unk_04;  acting: unk_06
f       = weight / max(raw)                        (integer division)
norm[c] = (raw[c] * f + 50) / 100
```

If every raw value in a round is 0, this divides by zero. The code has no guard.

**Bars and totals** (`ov17_02251A1C` `:1001`):

```text
pct[c]   = 100 * norm[c] / max(norm)
barMax   = (192 * weight + 5000) / 10000       (64 px at 3333)
bar[c]   = barMax * pct[c] / 100
total[c] = sum of bar[c] over the rounds
```

`unk_52`, the sum of the normalized points, is also stored.

Implemented in services `finalResult` (unit-tested on original numbers). **Placement** is ranked by the **bar total**, not by the normalized points. Ties break by a random u16 drawn per
contestant from the contest LCRNG. The result is written to `unk_118[c].contestPlacement`.

**Presentation** (BGM `CONTEST_DRESSING_ROOM_sseq`, then `SEQ_CO_KEKKA`, then `SEQ_CO_FANFA`; text
`TEXT_BANK_CONTEST_RESULTS`):

1. Announcer lines: judging is complete, then the individual categories (60-frame wait).
2. For each round that took place (visual, dance, acting), in that order:
   1. The round's announcer line.
   2. Bar animation (`ov17_02252858`):
      1. SE `CON_033`, then wait 45 frames.
      2. Loop SE `PL_CON_034` while the bars grow **1 px per frame**, all four together, until each reaches its length.
      3. SE `CON_032`, then stop the loop.
   3. Wait 60 frames (90 after dance and acting).
3. The BGM fades out over 30 frames and the screen fades. `SEQ_CO_KEKKA` starts.
4. Winner: play `SEQ_CO_FANFA` with SE `CON_007`, show the winner, play the winner's cry, hold 60 frames.
5. `SEQ_CO_FANFA` fades out over 90 frames.

Camera-flash timings for the field scene (`src/contest.c:127`) depend on rank.

---

## 9. Opaque or unclear

- `competitionType` 0 and 1 (2-round contests weighted 60/40 and 70/30) look unused. Solo modes take the first 4
  opponent matches, not random ones.
- `unk_15B` is link-only (it adds a 120-frame wait and forces song 1); what it means is not clear.
- In the dance backup AI, the spacing terms of `ov17_0224EC24` are dead code. The link-forced Cute/Smart multipliers
  read `unk_1B26`, the link-forced-song flag, which looks odd.
- PITY_POINTS compares snapshots taken at different moments; the exact tie behaviour depends on order.
- AI rules that test "turn == 4" probably never fire.
- The photo save (`ov22_02256FD8`) was traced for the visual round: §5.8.
- Most graphics member ids are loaded through open-NARC helpers; only some are listed here. Each app's
  `*_LoadGraphics` functions need a full pass.
- Acting presentation timings (animations, message waits) live in `ov17_02243C28.c` and `ov17_022413D8.c`. They were
  not extracted.
- The camera flash brightness curve is approximated (+4/16 white fading over 6 frames through `FieldView.lightning`).
- Friendship on a win skips the met-location bonus (the Pokémon model keeps no egg location), as the battle code does.

## 10. What each round lane must do

All three: implement the round model in `packages/menus/src/contest/<round>.ts` behind `createContestRound`, its view
member in `ContestRoundView` (contracts `contests.ts`, a CONTRACTS_VERSION bump), its DOM in `packages/app/src/ui/contest.ts`
(DS screens: ROM art and font), import the art and tables it needs (bump IMPORTER_VERSION), flip
`CONTEST_ROUNDS_STATUS`, replace its placeholder in `sys-contest-normal-cool.replay` (and give it a practice replay),
and keep the draws on `ctx.rng` in the decomp's order.

- **Visual:** done (§5.8). It was: the dress-up app (overlay022: Fashion Case accessories, the rank's limit, the 1800-frame timer, the
  backdrop), the dress-up points from `ContestTables.themes`, the scoring presentation (§5), the NPC outfits from
  `dressUps`, the outfit into `outcome.outfit` (the winner photo), and the lobby's photo viewer (`scr_cmd_0a8`) and the
  Jubilife TV gallery if wanted. Import imageclip.narc and contest_bg/obj art.
- **Dance:** built (§6.8).
- **Acting:** the per-effect table Unk_020F568C (arm9) and the classes Unk_ov17_02253AF8 (overlay 17), voltage, the
  judge-share and class-5/6 effects, the next-turn order, the first order from visual + dance (§7.2), the 165-row AI rule
  table, move animations through the battle animation VM (contest arms of JumpIfContest), `points` = unk_06.
