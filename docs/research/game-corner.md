# Veilstone Game Corner (slot machines, prizes, coins)

2026-10-23. Research for the slot machine app (overlay 101), the launcher that opens it, the Game Corner and
Prize Exchange scripts, and coins. This note is for whoever builds the headless slot model (seeded RNG, frame-stepped)
and the DOM screen. Nothing here is built yet.

Source: pret/pokeplatinum (local `reference-projects/pokeplatinum`), used for names, offsets and understanding only.
Paths are relative to its root. Every ROM table was read and hashed from the user's Platinum (US) ROM with
`@opensinnoh/nds` (scratch scripts, not committed). A frame is one 30 Hz tick: the main loop waits for two vblanks per
pass (`src/main.c:120`), and the app runs once per pass. **(inferred)** marks reasoning that the code does not state.

## 1. What is needed

- A **slot model** (services or core): a 12-machine mode shuffle, a frame-stepped state machine (bet, spin, stops,
  result, payout count, standby, bonus rounds), the reel-control ("slip") rules, and the payout and odds tables read
  from the ROM. Inputs per frame: pressed and held buttons. Output: coins, the max bonus streak, the bonus rounds
  played, and the TV-record trigger.
- A **slot screen** (app), built from `/data/slot.narc` art. The DS uses two screens and has **no touch controls**:
  the machine and reels are on the top screen; the moon, the Poké Ball, Clefairy and the bonus counters are on the
  bottom screen. OpenSinnoh draws one composition (no split screens); touch is our own addition (§5.5).
- **Script ops**: `scr_cmd_267` (open the app) and the coin ops, all stubbed today (§7). Today, talking to a machine
  does nothing, the clerk always says "Your Coin Case is full" (the stubbed `check_can_add_coins` writes 0), and the
  prize menu does not open (`show_list_menu_remember_cursor` is stubbed).
- An `IMPORTER_VERSION` bump if the importer writes the new tables or art.

## 2. Sources

| What | Where |
|---|---|
| Script command | `src/scrcmd.c:5824` `ScrCmd_267` (reads the machine id var, calls `sub_0203E414`) |
| Launcher | `src/unk_0203D1B8.c`: `sub_0203E348` `:1484` (starts overlay 101), `sub_0203E35C` `:1499` (the return), `sub_0203E414` `:1534` (setup), `sub_0203E484` `:1568` (mode shuffle) |
| Record-mixed RNG | `src/record_mixed_rng.c` (`RecordMixedRNG_GetRand`, `_AdvanceEntries`); daily advance `src/unk_020559DC.c:92`; new-game seed `src/game_start.c:158` |
| TV record | `src/tv_segment.c:1357` `sub_0206DD38` |
| App entry and exit | `src/overlay101/ov101_021D0D80.c` (init `ov101_021D0D80`, main `ov101_021D0E40`, exit `ov101_021D0EE4`, results `ov101_021D0F3C`, BGs, BGM task `ov101_021D18F4`) |
| Rules | `src/overlay101/ov101_021D1A28.c`: state table `Unk_ov101_021D8838` `:1428` (64 states), reel tasks `:1536`–`:1657`, reel control `:1659`–`:2709`, lotteries `:2736`–`:3063`, payout counter `:3093`, palette effects `:3720`–`:4358`, line check `:4360`–`:4662` |
| Odds and reel tables | `src/overlay101/ov101_021D94D8.c` (all `const` tables) |
| Sprites and animations | `src/overlay101/ov101_021D59AC.c` (reels, counters, Poké Ball, Clefairy, Pikachu pair, bonus counters, 7-line flash) |
| Sprite resource slots | `src/overlay101/ov101_021D7E48.c` |
| Coins | `src/coins.c` (`MAX_COINS` 50000, `include/coins.h`), `src/scrcmd_coins.c` |
| Prizes | `src/scrcmd_game_corner_prize.c` (`sGameCornerPrizeData`, arm9) |
| Scripts | `res/field/scripts/scripts_game_corner.s`, `scripts_veilstone_city_prize_exchange.s`; events `res/field/events/events_game_corner.json` |
| Coin Case (bag) | `src/bag_context.c:163` (already done in OpenSinnoh: `packages/game/src/field-items.ts:187`, `packages/menus/src/bag.ts:113`) |
| Text | `res/text/unk_0544.json` (slot messages), `game_corner.json` (bank 147), `veilstone_city_prize_exchange.json` (bank 156), `menu_entries.json` (bank 361) |

## 3. Data and ROM locations

Overlay 101: RAM 0x021D0D80, 0x9100 bytes, not compressed. A decomp symbol `Unk_ov101_021DXXXX` is its own RAM address,
so its offset is the address minus 0x021D0D80. Every table below matched its decomp values at that offset. Enums are
u32. Specs in the shape of `TABLES` in `packages/importer/src/platinum.ts`:

```ts
// arm9
slotModes:        { where: 'arm9', offset: 0xea17c, count: 12, size: 1, sha1: 'c24ba7efc829cc45b324f5a4b181897495e182f9' },  // sub_0203E484 v0
prizes:           { where: 'arm9', offset: 0xec018, count: 19, size: 4, sha1: '5dbdef6918073da6526d07dcc8014e4c65a00576' },  // sGameCornerPrizeData {u16 item, u16 price}
// overlay 101 (rules)
slotReels:        { where: 101, offset: 0x8908, count: 3,  size: 84,  sha1: '3121f7360c16df1344591a6e68e2ba33221ede8d' }, // Unk_..9688 [3][21] u32 symbol
slotPayouts:      { where: 101, offset: 0x87d0, count: 6,  size: 4,   sha1: 'e1bd6f6fb960e5fd39be9585445e5b82100ab9b7' }, // Unk_..9550 coins per line, by symbol
slotBonusPayouts: { where: 101, offset: 0x8770, count: 6,  size: 4,   sha1: 'c8ec2041187dd608dc149d69bb20e9838fecfc60' }, // Unk_..94F0 same, in bonus rounds
slotWinChance:    { where: 101, offset: 0x87a0, count: 6,  size: 4,   sha1: '97bf9e77ebd371fcd83237504ad184ca39bd37da' }, // Unk_..9520 by mode
slotWinFlags:     { where: 101, offset: 0x8848, count: 6,  size: 16,  sha1: '45b0afa684fc577a16e1f343a24b79f41e8a0b86' }, // Unk_..95C8 8 × u16 by mode
slotHintChance:   { where: 101, offset: 0x8758, count: 6,  size: 4,   sha1: '7d78874fa16072c936e6b652e18f933b2e2124f4' }, // Unk_..94D8
slotStandbySmall: { where: 101, offset: 0x87b8, count: 6,  size: 4,   sha1: '97bf9e77ebd371fcd83237504ad184ca39bd37da' }, // Unk_..9538 (same bytes as slotWinChance)
slotStandbyFlags: { where: 101, offset: 0x88a8, count: 6,  size: 16,  sha1: '293cf9557e2f51f9280b53ba7f34b3e2f3f39a35' }, // Unk_..9628 [6][4] u32
slotBonusTypes:   { where: 101, offset: 0x8bb4, count: 6,  size: 72,  sha1: 'eabf869cce965162aa3ffb6247284ea97f5950dc' }, // Unk_..9934 [6][6] {u32 chance, type, class}
slotContinueStart:{ where: 101, offset: 0x87e8, count: 6,  size: 4,   sha1: '9f9e7094ee66fdd3ea6786afd4ec1696bd2c9a77' }, // Unk_..9568 by bonus type
slotClefairyKinds:{ where: 101, offset: 0x8a04, count: 6,  size: 72,  sha1: '0f8643315300bb323da842d5302eda187f8c35c0' }, // Unk_..9784 [6][3][3] {u32 chance, kind}
slotRedMoon:      { where: 101, offset: 0x8788, count: 6,  size: 4,   sha1: '6b0b9ad4867b961b8cac17714afac273c219b7db' }, // Unk_..9508
slotBlueMoon:     { where: 101, offset: 0x8800, count: 6,  size: 4,   sha1: 'b5d6d05018a6fc3563add35ee2f46a9e4a427c08' }, // Unk_..9580
slotContinueDrop: { where: 101, offset: 0x8818, count: 6,  size: 8,   sha1: 'a24f2e5c827f74097f907a5f601c036badd49d0e' }, // Unk_..9598 [6][2] u32
slotEndTells:     { where: 101, offset: 0x8d64, count: 6,  size: 144, sha1: '3d7937809c53136636b0db175b94206dd1dd70fa' }, // Unk_..9AE4 [6][9] {u32 min, p01, p00, unused}
slotBonusOrders:  { where: 101, offset: 0x7a28, count: 6,  size: 24,  sha1: '3a4b2b7f18c2088028e8da3d05858c31b071af11' }, // Unk_..87A8 {u32 pad[3], u32 clefairyAnim[3]}
// overlay 101 (presentation)
slotStopButtons:  { where: 101, offset: 0x79c0, count: 3,  size: 8,   sha1: '1c216e31ae69c1606894b667ad44597e11c91650' }, // Unk_..8740 {int tileX, tileY}
slotLightShow:    { where: 101, offset: 0x7bb8, count: 82, size: 16,  sha1: 'cc6c969829c25576ca495a481014306adb3ba40a' }, // Unk_..8938 {u32 mask, fx32 from, to, step}
slotLinePalettes: { where: 101, offset: 0x90e0, count: 5,  size: 4,   sha1: '33559b68e604100d3ca8a843f696b543e58b9e10' }, // Unk_..9E60 (.data)
slotSymbolAnims:  { where: 101, offset: 0x84fc, count: 6,  size: 4,   sha1: 'db17e883a647963a26d973378923ef4649801319' }, // Unk_..927C (identity 0..5)
slotHintSprites:  { where: 101, offset: 0x8654, count: 5,  size: 16,  sha1: '5af1a80c79120193cf15b5957b9126eee685fa50' }, // Unk_..93D4 {char, pal, cell, anim}
slotClefairySprites:{ where: 101, offset: 0x8624, count: 3, size: 16, sha1: 'ec816e28bbb30185dff30aa69d6ea457721b0491' }, // Unk_..93A4
slotLineFlashPos: { where: 101, offset: 0x86a4, count: 15, size: 12,  sha1: 'cabb6bf607c57d3f93d8784109c7b5426d053a75' }, // Unk_..9424 [5 lines][3 reels] VecFx32
slotMessageWindow:{ where: 101, offset: 0x7808, count: 1,  size: 8,   sha1: 'fa57d7eedc5bce8216ff803b0a1e7d2b36c1bd8f' }, // Unk_..8588 WindowTemplate
```

`/data/slot.narc`: 77 members, SHA-1 `7d890728684f972892221535e43f2dd07a63ac5c` (88388 bytes). Members in §5.

### 3.1 Symbols, reels, lines, payouts

Symbols (checked by rendering member 11; the paytable in BG member 0/1 agrees):

| id | Symbol | Pays per line (normal, `slotPayouts`) | Pays per line (bonus round, `slotBonusPayouts`) |
|---|---|---|---|
| 0 | red 7 | 100 | 100 |
| 1 | Team Galactic "G" 7 (Looker's "logo on the reels") | 100 | 100 |
| 2 | REPLAY | 0 (a free spin instead) | 15 |
| 3 | cherries | 2 | 2 |
| 4 | Pikachu | 10 | 10 |
| 5 | Moon Stone | 15 | 15 |

Value 6 means "no symbol" or "no line" throughout.

Reel strips (`slotReels`, index 0 to 20; the reels scroll down, so the index at a row goes down as the reel turns):

| Reel | Strip |
|---|---|
| left | 5 3 1 0 2 4 5 3 1 2 4 5 3 1 2 4 5 2 0 2 4 |
| middle | 3 0 1 5 4 2 3 0 5 4 2 3 0 5 4 2 3 1 5 4 2 |
| right | 4 2 1 0 2 5 4 2 1 3 5 4 2 1 3 5 4 2 0 3 5 |

Rows: 0 is above the window, 1 to 3 are the visible top, middle and bottom rows, and 4 is below. The symbol at row
`k` of reel `r` is `strip[r][(pos[r] + k) mod 21]`. `pos` is the reel's index (`unk_A8`). When the reel is half a
symbol past a boundary, every read uses `k − 1` (`ov101_021D55D4`). That is the symbol that will sit there once the
reel snaps to the next boundary.

Paylines, in the order they are checked, and their bits (`unk_48`; the light palettes and the flash positions use the
same index):

| Bit | Line | Rows (left, mid, right) |
|---|---|---|
| 1 | top | 1, 1, 1 |
| 0 | middle | 2, 2, 2 |
| 2 | bottom | 3, 3, 3 |
| 3 | diagonal down | 1, 2, 3 |
| 4 | diagonal up | 3, 2, 1 |

A line wins when its left symbol is cherries (3), whatever the other two are, or when all three symbols are equal. The
result symbol is the symbol of the **last** winning line in the check order. The payout is that one symbol's rate
times the number of winning lines, even if two lines won with different symbols (a DS quirk; reel control normally
prevents it). Cherries on the left reel's top or bottom row win two lines (top and diagonal down, or bottom and
diagonal up), so they pay 4. In bonus rounds only the middle line is checked (`ov101_021D57EC`), and the DS asserts that
it is a REPLAY.

### 3.2 Modes and odds (by machine mode 0–5)

| Table | m0 | m1 | m2 | m3 | m4 | m5 | Use |
|---|---|---|---|---|---|---|---|
| `slotWinChance` | 25 | 25 | 30 | 30 | 35 | 35 | normal spin: % that any win flag is drawn |
| `slotHintChance` | 80 | 80 | 80 | 80 | 80 | 70 | % that the Poké Ball shows the true flag |
| `slotStandbySmall` | 25 | 25 | 30 | 30 | 35 | 35 | standby spin: % of a small flag; otherwise the 7 flag |
| `slotRedMoon` | 3 | 3 | 5 | 5 | 7 | 7 | bonus spin: % of the red moon |
| `slotBlueMoon` | 1 | 1 | 3 | 3 | 5 | 5 | bonus spin: % of the other moon (guaranteed continue) |
| `slotContinueDrop` −10 | 25 | 20 | 15 | 15 | 10 | 5 | after a round: % the continue chance drops 10 |
| `slotContinueDrop` −5 | 20 | 15 | 15 | 15 | 15 | 10 | then: % it drops 5 |

`slotWinFlags`: 8 u16 a mode (the struct's last u16 is never read). Each entry is a % of the drawn win, checked in
this order:

| Order | Flag bit | Lands | Bonus | m0/m1 | m2 | m3 | m4/m5 |
|---|---|---|---|---|---|---|---|
| 1 | 3 | cherries | yes | 1 | 2 | 3 | 4 |
| 2 | 2 | cherries | no | 4 | 3 | 2 | 1 |
| 3 | 7 | Moon Stone | yes | 2 | 4 | 4 | 6 |
| 4 | 6 | Moon Stone | no | 13 | 11 | 11 | 9 |
| 5 | 5 | Pikachu | yes | 1 | 2 | 2 | 3 |
| 6 | 4 | Pikachu | no | 39 | 38 | 38 | 37 |
| 7 | 1 | REPLAY | yes | 1 | 2 | 2 | 3 |
| — | 0 | REPLAY | no | the rest (39) | 38 | 38 | 37 |

So a spin draws a bonus flag 1.25% of the time in m0/m1, 3% in m2, 3.3% in m3 and 5.6% in m4/m5.

`slotStandbyFlags` (all modes `5, 15, 30, 50`): cherries 5%, then Moon Stone 15%, then Pikachu 15%, then REPLAY the
rest (65%). The DS checks entry [1] twice and never reads [2] or [3] (`ov101_021D4394`). Keep that bug: it sets the
odds.

`slotBonusTypes`: six rows of (chance %, bonus type 0–5, class 0–2), checked in order:

| Row | Type | Class | m0/m1 | m2 | m3 | m4/m5 |
|---|---|---|---|---|---|---|
| 1 | 3 | 0 | 5 | 5 | 5 | 5 |
| 2 | 1 | 1 | 10 | 15 | 15 | 20 |
| 3 | 5 | 2 | 10 | 10 | 15 | 15 |
| 4 | 2 | 2 | 10 | 15 | 15 | 20 |
| 5 | 4 | 1 | 15 | 15 | 10 | 10 |
| 6 | 0 | 0 | 50 | 40 | 40 | 30 |

The bonus type picks the 7 to aim for: types 0–2 need the red 7 (flag bit 9), types 3–5 the Galactic 7 (bit 8). It
also sets the first continue chance (`slotContinueStart`: 50, 70, 90, 50, 70, 90 by type). The class matches that
chance (class 0 = 50, 1 = 70, 2 = 90) and picks the Clefairy variant (`slotClefairyKinds`, the same for every mode):

| Class | kind 2 | kind 0 | kind 1 |
|---|---|---|---|
| 0 | 5 | 20 | 75 |
| 1 | 20 | 60 | 20 |
| 2 | 75 | 20 | 5 |

So the Clefairy that appears hints at the bonus's staying power: kind 2 (palette 55) usually means a 90% start. Kinds
map to `slotClefairySprites` (§5.3).

`slotEndTells` (the same for every mode; the 4th u32 of each row is never read) is used only for presentation (§4.7).
Its rows, as (minimum continue chance: % anim A, % anim B, rest anim C): 75: 10/10/80; 65: 10/30/60; 55: 10/40/50;
45: 20/50/30; 35: 30/50/20; 25: 50/40/10; 15: 60/30/10; 5: 80/10/10; 0: 90/5/5.

`slotBonusOrders` (bonus-round stop orders, drawn as `rand % 6`): Y-B-A, Y-A-B, B-Y-A, B-A-Y, A-Y-B, A-B-Y. The u32s
are PAD masks (Y 0x800, B 0x2, A 0x1). The Clefairy animation for each button: Y 6, B 5, A 7.

### 3.3 Machines (launcher, `sub_0203E484`)

The 12 machines are bg events on the Game Corner map (script `n + 1` = machine `n`). `slotModes` holds a mode for
each machine id: 0, 5, 1, 1, 4, 4, 2, 2, 2, 3, 3, 3. So one machine is the worst (m0), one the best (m5), and modes
2 and 3 have three each. The launcher shuffles a copy of that list every time a machine is used:

1. Save the global LCRNG state and seed it with `RecordMixedRNG_GetRand`: the u32 `rand` of the record-mixed RNG's
   player-override entry. OpenSinnoh already has this as core `dailyRandomOf` (`GameTime.dailyRandom`).
2. For i = 0..11, and for each j = i+1..11 (j is only a counter), draw `LCRNG_Next() % 12` (high 16 bits of
   `x·0x41C64E6D + 0x6073`) and swap entries i and that draw. That is 66 draws in all.
3. Restore the LCRNG state. Return entry `machineId`.

The seed changes once a day: `FieldSystem_HandleDailyEvents` advances `rand` once per day passed
(ARNG: `x·1812433253 + 1`). Mixing records with a group (the Jubilife TV Group Connection, `scrcmd_group_connection.c`)
replaces it. OpenSinnoh already does the daily advance (`packages/core/src/field-systems.ts:213`). The machine's mode is
therefore fixed for the day.

Machine positions (bg events; x, z; facing): 0 (12,6) E; 1 (13,7) W; 2 (7,7) E; 3 (7,8) E; 4 (13,9) W; 5 (8,6) W;
6 (8,7) W; 7 (8,8) W; 8 (8,9) W; 9 (13,6) W; 10 (12,8) E; 11 (12,9) E. The bonus record sign is bg event 21 at (10,2).

## 4. Rules

### 4.1 Launch and return (`sub_0203E414`, `sub_0203E35C`, `ov101_021D0F3C`)

The field script (§7) checks for the Coin Case, fades out, adds the journal event `LOCATION_EVENT_GAME_CORNER`, and runs
`ScrCmd_267 VAR_0x8004` (the machine id). The launcher then:

- passes the coins, the options' message-box frame, the game records and the machine's mode (§3.3), and records the
  start time;
- adds `TRAINER_SCORE_EVENT_UNK_05` to the trainer score (+1, `trainerScoreIncrements[5]`);
- waits for the app to finish. Then:
  - TV: if coins after ≥ coins before + 1000, it saves the Records-program TV segment 4 (`sub_0206DD38`: coins before,
    coins after, minutes played = whole seconds elapsed / 60). OpenSinnoh's TV is still stubbed, so log this as a TV
    stub.
  - It sets the coins to the app's value (the app caps it at 50000).
  - `VAR_CONSECUTIVE_BONUS_ROUND_WINS` (var 0x4040; `VAR_PARTNER_TRAINER_ID` is 0x403f in `world/battle-setup.ts`) is
    set to the app's streak when the streak is larger.
- The app's exit also adds the number of bonus rounds played this session to game record 14 (`RECORD_UNK_014`).

The streak is the most rounds in one bonus this session, not a run across bonuses. It is only taken when a bonus ends
normally (state 58). If the player quits or runs out of coins inside a bonus, that bonus's rounds count toward record 14
but not toward the streak.

### 4.2 RNG

All draws use the game's global LCRNG (`LCRNG_Next`, u16; the same generator as the shuffle), `% 100` for odds. No
draw depends on anything but the state and the frame of each input. **Our choice:** like the contests (`contests.md` §2),
seed a session LCRNG with one draw of the main stream when the app opens, so a replay is determined by the seed and the
inputs per frame. Draw order:

| When | Draws |
|---|---|
| App start (`ov101_021D1A68`) | 3 × `% 21`: each reel's starting index |
| Normal spin start (state 3, `ov101_021D40A8`) | `% 100` win gate; if it wins, `% 100` flag pick; if any flag, `% 100` hint (`ov101_021D41EC`) |
| Bonus flag resolved (states 16/19/21) | `% 100` bonus type (`ov101_021D4210`), then `% 100` Clefairy kind (`ov101_021D42D0`) |
| Standby spin start (state 28, `ov101_021D4394`) | `% 100` small-flag pick, then `% 100` gate (the pick is drawn first) |
| Bonus round start (state 42) | `% 100` continue check (`ov101_021D44E8`) |
| Bonus spin start (state 46) | `% 6` stop order; then, if no moon has shown this round, `% 100` red moon and, if that fails, `% 100` blue moon |
| Round end, continuing (state 55) | `% 100` continue drop (`ov101_021D44FC`), `% 100` tell animation (`ov101_021D4550`) |

### 4.3 Controls (buttons only on the DS)

| Button | Action |
|---|---|
| X | bet (3 coins; 1 in a bonus round); after the bet, also starts the spin; skips the payout count |
| ↓ | starts the spin (after the bet) |
| Y / B / A | stop the left / middle / right reel. Y, then B, then A is checked in that order, one stop a frame |
| START | quit before betting. After the bet and before the spin, START refunds the bet and quits |
| A/B/X/Y held | doubles the payout count speed |
| A or B | closes a message |

Inputs are `pressedKeys` (new presses) except the held-speed check.

### 4.4 Normal play (states 0–24)

0. **Idle** (`ov101_021D1AD0`): reset, all stop buttons lit, the attract light show (§5.4) runs. If coins = 0, it shows
   message 2 and quits after A/B. If coins < 3, message 0, then quit. If coins ≥ 50000, message 1 and continue: play is
   still allowed, but wins over the cap are lost.
1. **Bet**: X takes 3 coins (SE `SEQ_SE_DP_ZUKAN02`) and lights all five lines dimly (blend 10/16). START quits.
2. **Lever**: ↓ or X spins. START refunds 3 and quits.
3. **Spin** (`ov101_021D1BD0`): the flag lottery runs (§3.2). Then:
   - The "full slip" switch is on when the flag is REPLAY or Pikachu (bits 0, 1, 4, 5): those line up whatever the
     timing ("Replays and PIKACHU line up even if you don't make an effort"). It is off for the others.
   - The "control" switch is on when any flag is set.
   - With a flag, the Poké Ball hint appears (§5.3). With chance `slotHintChance`, it is the ball for the flag's symbol
     (cherries 0, REPLAY 1, Pikachu 2, Moon Stone 3). Otherwise it is the neutral ball 4.
   - All reels start (16 px a frame, 2 frames a symbol, one turn in 42 frames). SE `SEQ_SE_DP_OPEN2`.
4. Stops are ignored for **8 frames**.
5. **Stops**: Y/B/A stops its reel (SE `SEQ_SE_DP_UG_022`; its stop button turns to palette 6). Pressing out of the
   order left, middle, right switches full slip off for the rest of the spin. Each reel's landing is decided at the
   frame of its press (§4.6).
6. Wait until all three reels have stopped and bounced.
7. **Result** (`ov101_021D1DEC`), with the lines checked as in §3.1:
   - No line, bonus flag set (bits 1, 3, 5, 7) → **standby entry**: states 16–18 and the standby begins anyway.
   - No line, other flag → the ball rolls away (state 10/11) → state 0.
   - No line, no flag → 8 frames → state 0.
   - Line with the REPLAY+bonus flag (bit 1) → state 21: no coins; the bonus is drawn; Clefairy appears after 8 frames;
     the next spin is a free standby spin (state 28).
   - Line with another bonus flag → state 19: pays, draws the bonus, Clefairy appears at frame 30 → standby (state 25).
   - REPLAY line → state 14: no coins; after 15 frames the ball leaves → state 3: **a free spin** with no bet.
   - Any other line → state 12: pays `rate × lines` (§3.1) through the payout counter (§4.8); at frame 30 the ball
     leaves → state 0.

   When the bonus is drawn (states 16, 19, 21): bonus type and class (`slotBonusTypes`), continue chance =
   `slotContinueStart[type]`, Clefairy kind (`slotClefairyKinds[mode][class]`), then BGM `SEQ_SLOT_ATARI` (§6).

### 4.5 Standby (Clefairy is out; states 25–40)

The same as normal play (bet 3, the same checks and messages), but:

- Each spin draws the standby lottery (§3.2). With chance `100 − slotStandbySmall` (75/70/65%), the flag is the bonus
  type's 7 (bit 9: red, bit 8: Galactic). Otherwise it is a small flag (cherries, Moon Stone, Pikachu, REPLAY). There
  is no Poké Ball hint. Clefairy cheers at the spin start (anim 9), waves after a paying or REPLAY line (anim 10), and
  goes back to standing (anim 7) otherwise.
- Full slip is never on for a 7 flag. The 7s line up only if the player stops each reel within 4 symbols of a
  reachable 7 (the NPC: "when CLEFAIRY appears, that's your chance to line up sevens").
- Result (`ov101_021D2420`): no line → state 25 (stays in standby; each spin redraws). A line with a 7 flag → state 39,
  **the bonus**. A REPLAY line → a free standby spin (state 28). Any other line pays → state 25.
- Standby never ends by itself. Quitting the app ends it (the next session starts in normal play).

On the 7 line (state 39): it pays (100 a line), the moon background fades to the bonus palette (32 frames), BGM
`SEQ_SLOT_OOATARI`, and the 7-line flash (§5.3) plays. After the payout count, state 41 sets up the bonus.

### 4.6 Reel control ("slip")

Each stop moves the reel to the next symbol boundary (0 or 1 half step), then **slips** S more symbols (2 frames
each), then bounces (the sprite y offset goes 4, −4, 1, −1, 0 px over 4 frames). The control picks S and a
**target row** (`unk_14`) when the reel is stopped. "Slip limit" L is 4, or 21 when full slip is on.
`sym(r, k)` is the symbol at row k after the snap. "No cherry" for the left reel at slip s means rows 1–3 of the left
reel hold no cherries after slipping s; a cherry flag ignores that test (`ov101_021D3B34`). T is the flag's symbol:
REPLAY for bits 0/1, cherries 2/3, Pikachu 4/5, Moon Stone 6/7, Galactic 7 for 8, red 7 for 9.

**Which rule runs.** Normal play and standby: if control is on, the reel uses the **aim** rules below. If an aim rule
finds nothing, that reel uses the **avoid** rules and control is switched off for the rest of the spin. With control
off, every reel uses avoid. Bonus rounds use the bonus rules.

**Candidate rows** (`ov101_021D394C`) for a reel stopped second or third, from the target rows of the reels already
stopped:

| Reel | Both others stopped | Only one other stopped |
|---|---|---|
| left | mid = right → that row; else right = 1 → [3]; else [1] | only mid: mid = 2 → [1,2,3], else [mid]. Only right: right = 2 → [2], else [1,3] |
| middle | left = right → that row; else [2] | only left: left 2 → [2], 1 → [1,2], 3 → [2,3]. Only right: the same with right |
| right | left = mid → that row; else left = 1 → [3]; else [1] | only left: left = 2 → [2], else [1,3]. Only mid: mid = 2 → [1,2,3], else [mid] |

Candidates are tried in list order (c1, c2, c3) unless a rule below says otherwise.

**Aim, left reel stopped first** (`ov101_021D2E94`):
1. For row v = 1..3 where sym(left, v) = T: try slips s = 0, 1, … while v + s ≤ 3. The first s with no cherry wins:
   row v + s, slip s.
2. Else, for d = 1..L where the symbol d rows above row 1 is T: try e = 0, 1, 2. At the first e where slip d + e has
   no cherry: if e = 0 and `pos[left] % 4 == 0` and slip d + 2 has no cherry, use row 3, slip d + 2. If e = 1 and
   `pos[left] % 6 < 2` and slip d + 2 has no cherry, use row 3, slip d + 2. Otherwise use row 1 + e, slip d + e.
   (`pos` is the reel's index at the press, so the timing randomises the row.)
3. Else fail.

**Aim, left reel stopped second or third** (`ov101_021D2FAC`), with candidates c1..c3:
1. If slip 0 has no cherry, take the first candidate row (c1, c2, c3) that shows T now, with slip 0.
2. One candidate: the first d = 1..L where T is d rows above c1 and slip d has no cherry → row c1, slip d.
3. Two candidates: for d = 1..L, try c1 then c2 when d is odd, c2 then c1 when even (each needs T d rows above it and
   no cherry at slip d).
4. Three candidates: for d = 1..L, by `d & 3`: 0 → c1, c2, c3; 1 → c2, c1 (c3 is skipped); 2 or 3 → c3, c1, c2.
5. Else fail.

**Aim, middle or right reel stopped first** (`ov101_021D32EC`): if T is on row 1–3 now → that row, slip 0. Else the
first d = 1..L with T d rows above row 1: d % 4 = 1 → row 3, slip d + 2; 2 or 3 → row 2, slip d + 1; 0 → row 1,
slip d. These slips can go past L. Else fail.

**Aim, middle or right reel stopped second or third** (`ov101_021D3394`): first, a candidate row that shows T now
(c1, c2, c3 in order), slip 0. Then search, where "search c" means the first d = 1..L with T d rows above row c → row
c, slip d:
- one candidate: search c1;
- two: if this reel's `pos` is odd, search c1 then c2, else c2 then c1;
- three: by `pos % 3`: 0 → c1, c2, c3; 1 → c2, c3, c1; 2 → c3, c1, c2.

If nothing is found, fail. There is no cherry test on these reels.

**Avoid** (`ov101_021D3780`; used with no flag, after an aim fails, and for every reel once control is off):
- Count the reels stopped so far, this one included. If it is under 2 (this is the first stop):
  - left reel: the smallest slip s = 0..21 with no cherry in its window;
  - middle or right reel: no slip.
- Otherwise, the smallest s = **1**..21 (at least one symbol) such that no payline would win with this reel slipped s.
  The other reels are read at their remaining slip; a reel still spinning is read at its current spot. For the left
  reel, a cherry at the left end of any line also counts as a win.

**Bonus rounds** (`ov101_021D3738`): T = REPLAY. The first s = 0..L where REPLAY is s rows above row 2 → row 2,
slip s. Else avoid-bonus (`ov101_021D3830`), and control turns off:
- First stop: left reel → the smallest s = 0..20 with no cherry on row 2; the others → no slip.
- Later stops: the smallest s = 0..21 so that the middle row is not three equal symbols. For the left reel, also no
  cherry on row 2.

Notes: the DS asserts if an avoid search finds nothing. Reels are updated in order left, middle, right, after the app
state each frame. Those helpers read the other reels' remaining slip (`unk_18`), which is 0 once a reel has finished.

### 4.7 Bonus rounds (states 41–58)

Setup (state 41): show the bonus counters (§5.3), round count = 0, coins gained = 0, bonus mode on.

**Round start** (state 42): rounds played +1 (the record), round count +1 (capped at 999; the big number shows for 60
frames). 15 spins a round (the counter is set to 16 and drops by one before each spin). Moons are reset. Draw
`final = (rand % 100 ≥ continueChance)`.

**Each spin** (states 43–53):
1. Coins: 0 → message 2 and quit. ≥ 50000 → message 1, then play on.
2. X bets **1 coin** (coins gained −1, not below 0). Only the middle line lights (blend 12/16). START quits; after the
   bet, START refunds the coin.
3. ↓/X spins. The flag is always REPLAY; control and full slip are on. The order is drawn: `slotBonusOrders[rand % 6]`.
4. Moons, if none has shown this round: red with `slotRedMoon` %, else blue with `slotBlueMoon` %. A moon pulses the
   background palette and plays SE `SEQ_SE_DP_025`.
5. After 8 frames, Clefairy points at the reel to stop first, then the next (animation by button, §3.2). It updates
   after each of the first two stops.
6. Stops (SE `SEQ_SE_DP_SELECT_SLOT`): a press out of Clefairy's order turns control and full slip off, so the spin
   **cannot** win. In order, REPLAY always lands on the middle row.
7. Result: a middle REPLAY pays **15** (`slotBonusPayouts[2]`) and adds to coins gained. A red moon shown this spin
   becomes "hit" if REPLAY landed and "dodged" if not. The NPC's advice: "If the moon turns red, you don't want to get a
   replay because it makes CLEFAIRY tired!"

**Round end** (state 54, after the 15th spin):
- If `final` and no blue moon this round → the bonus ends (state 58): end display, then the streak updates (the max of
  the round counts), BGM back to the field, the moon palette back over 32 frames, then normal play (state 0).
- Else the bonus continues (state 55). The continue chance drops: −10 if the red moon was hit this round; otherwise
  one draw against `slotContinueDrop[mode]`: < p10 → −10, else (minus p10) < p5 → −5. It never goes below 0. Then one
  draw picks the tell animation from the first `slotEndTells` row whose minimum is ≤ the new chance: A → anim 12 (Clefairy
  goes back into the ball and comes out again), B → only Clefairy's cry, else C → anim 5 (the Pikachu pair and a
  cheer). A blue moon forces C. **The tell only changes the presentation.** Then the next round (state 42).

So the chance for round n+1 is the start chance minus the drops, and the blue moon saves a final round. The best
outcome per spin is +14 coins (210 a round).

### 4.8 Payout counter (`ov101_021D4614`)

Up to two winning lines are flashed (palette fades: 4 pulses of 4 frames up and 4 down, then a fast blink while coins
are counted; a REPLAY stops after the 4 pulses). The DS asserts if more than two lines win. After the pulses, X (or a
payout of 0) pays the rest at once. Otherwise 1 coin is paid every 4 frames, or every 2 frames while A/B/X/Y is held,
with SE `SEQ_SE_DP_DENSI16` per coin. Coins are capped at 50000; in a bonus, coins gained count up too.

### 4.9 Messages (`TEXT_BANK_UNK_0544`)

0 "You don't have three Coins. You cannot play right now." · 1 "You have 50,000 Coins now. You cannot hold any more." ·
2 "You have no Coins. You cannot play now." Shown in the message window (`slotMessageWindow`: BG0, tile (2,19),
26×4, palette 15, base tile 0x3D, the player's frame style), printed at once, closed with A/B.

## 5. Screens and graphics

### 5.1 Layout

GX_DISP_SELECT_MAIN_SUB: the main engine is on top. **Top (main):** BG0 text (priority 0); BG1 the machine (chars
member 0, screen 1, palette member 3, 13 palettes; priority 1); BG2 the reel shading bars (chars 8, screen 9; priority
2, alpha-blended over the reel sprites 8/9); OBJ: reel symbols (priority 3, behind BG1, showing through its window
holes), the credit and payout digits. **Bottom (sub):** BG3 the moonlit field (chars 2, screen 4, palette member 3);
OBJ: the Poké Ball, Clefairy, the Pikachu pair, the bonus counters. The sprite system puts the sub screen at y + 192.

The top-screen BG already holds the help bar ("X: INSERT COINS, ✚: SPIN, START: EXIT"), the paytable (777 100,
GGG 100, cherries 2, Moon Stones 15, Pikachus 10, REPLAY/15), the line lamps, the Y/B/A stop buttons and the
CREDIT/PAYOUT boxes.

- Reels: centre x 68, 128, 188. Five sprites each at y = 16 + ((reelPx + 32·i) mod 160) + bounce. Row k's centre is
  y = 16 + 32k, so the window rows are at y 48, 80 and 112. Each sprite shows the strip symbol for its row. Symbol
  sprites: chars 11, palette 10, cells 12, anims 13 (anim n = symbol n, `slotSymbolAnims`).
- Stop buttons: BG1 rects of 3×2 tiles at tiles (7,17), (15,17), (22,17) (`slotStopButtons`). Palette 5 = armed,
  6 = pressed.
- Credit: 5 digits, ones digit at (108,180), 8 px apart leftwards; a leading digit is hidden while coins < its place.
  Payout: the same at (180,180), fully hidden at 0. Digits: chars 21, palette 20, cells 22, anims 23.
- Line lamps: the lines use BG1 palettes 2, 3, 12, 4, 11 (`slotLinePalettes`; line order as in §3.1, bits 0–4). Unlit
  colours come from member 3 rows 2, 3, 3, 4, 4; lit from members 74 (middle), 75 (top, bottom), 76 (diagonals).
  Light levels are blends of unlit toward lit in 16ths: 10 after a bet, 12 for the bonus middle line, 0↔16 for pulses.

### 5.2 Palette effects

Sub BG palette 1: member 3 row 1 normal; member 5 the bonus colouring (fades in over 32 frames at the bonus, out at
its end). A moon pulse fades from member 5 toward member 6 (blue moon) or member 7 (red moon) in 16 frames, then back
in 64 frames.

### 5.3 Sprites (`/data/slot.narc` members: chars, palette, cells, anims)

| What | Members | Notes |
|---|---|---|
| Reel symbols | 11, 10, 12, 13 | 6 cells |
| Credit/payout digits (top) | 21, 20, 22, 23 | 10 digits |
| 7-line flash: red 7 / Galactic 7 | 14, 10, 15, 16 / 17, 10, 18, 19 | three big symbols at the winning line's positions (`slotLineFlashPos`). They slide down 4 px a frame to the bottom screen (sub y 48), wait 30, blink 3 × 30 frames (hidden for the first 12), then wait 30 |
| Poké Ball hint, types 0–4 | 24–27, 28–31, 32–35, 36–39, 40–43 (char, cell, anim, palette = n, n+1, n+2, n+3) | `slotHintSprites`. Anims as used: 0 rising in, 1 opening, 2 still or wobbling, 3 bouncing, 4 rolling away (loop) |
| Sparkle | 44, 47, 45, 46 | at (128, sub 144), 15 frames |
| Clefairy kinds 0 / 1 / 2 | 48, 51, 49, 50 / 52, 51, 53, 54 / 48, 55, 49, 50 | `slotClefairySprites`. Anims: 0 still, 1 pop, 2 cheer loop, 3 points for A, 4 points for Y, 5 points for B (the arm poses; the direction of each is **(inferred)**) |
| Pikachu pair | 56, 59, 57, 58 | two mirrored sprites peeking in from both sides (anim 5 tell) |
| "BONUS:" / "GET:" labels | 68, 67, 69, 70 / 71, 67, 72, 73 | small at (24,8) and (200,184); 2× at the bonus end |
| Bonus counter digits (sub) | 64, 67, 65, 66 | spins left at (52,8); coins gained, 5 digits from (220,184) |
| Round number (sub, big) | 60, 63, 61, 62 | at (128,32) for 60 frames at each round start |

Ball choreography (bottom screen, centre x 128): it rises from the bottom at 2× scale to y 160 in 9 frames (SE
`SEQ_SE_DP_UG_020`), then wobbles. On a result it stops. It leaves rolling down and growing in 10 frames. On a bonus it
opens (SE `SEQ_SE_DP_SLOT01`), the sparkle plays, and Clefairy pops out (scale 0.25→1 in 16 frames, Clefairy cry) to
stand at y 128. At the bonus end, Clefairy shrinks back into the ball (SE `SEQ_SE_DP_SLOT02`), the ball bounces, the 2×
"BONUS: rounds" and "GET: coins" show for 45 frames, and the ball rolls away. The label meanings are **(inferred)** from
what each counter shows.

### 5.4 Attract light show

While waiting for a bet, `slotLightShow` steps through 82 entries {mask, from, to, step}. Bits 0–4 fade those lines
from `from` to `to` (16ths, fx32) by `step` a frame; bit 5 waits `from` frames; bit 6 restarts. A bet stops it and sets
the bet lighting.

### 5.5 OpenSinnoh screen (**our choices**)

There is one composition, not two screens. Use the keyboard for the DS buttons (§4.3). Touch: the three stop
buttons' rects, plus our own bet/spin/quit targets (the DS has none; the help bar in the BG names X, ✚ and START).

## 6. Sounds (SDAT index)

BGM: the field BGM keeps playing in normal play (the app plays `SEQ_NONE` under `SOUND_SCENE_SUB_66`); it is paused
when `SEQ_SLOT_ATARI` 1184 (standby) or `SEQ_SLOT_OOATARI` 1185 (bonus) starts, and resumes at the bonus end and on
exit (`ov101_021D18F4`).

SE: bet `SEQ_SE_DP_ZUKAN02` 1517 · spin `SEQ_SE_DP_OPEN2` 1518 · stop `SEQ_SE_DP_UG_022` 1574 · bonus stop
`SEQ_SE_DP_SELECT_SLOT` 1525 (the decomp's `SE_CONFIRM_sseq_6`: the 7th sequence that uses SE_CONFIRM.sseq, counting from 0, as `_sseq_3` is `SEQ_SE_DP_SELECT`; **(inferred)**) · coin count `SEQ_SE_DP_DENSI16` 1581 · ball rise
`SEQ_SE_DP_UG_020` 1572 · ball open `SEQ_SE_DP_SLOT01` 1744 · Clefairy into ball `SEQ_SE_DP_SLOT02` 1745 · moon
`SEQ_SE_DP_025` 1520 · Clefairy's cry (species cry). Field: `SEQ_SE_PL_COIN` 1493, `SEQ_SE_DP_REGI` 1604,
`SEQ_SE_DP_SELECT` 1500.

## 7. Script commands

Game Corner (`scripts_game_corner.s`):

- **Machines 0–11**: set `VAR_0x8004` = id. No Coin Case → "You can't play if you don't have a Coin Case.". Otherwise:
  fade out, `CreateJournalEvent LOCATION_EVENT_GAME_CORNER`, `ScrCmd_267 VAR_0x8004`, `ReturnToField`, fade in.
- **Clerk**: sells 50 coins for $1000 or 500 for $10000 (`GoToIfNotEnoughMoney`, `GoToIfCannotAddCoins`,
  `AddToGameRecord RECORD_MONEY_SPENT`, `RemoveMoney`, `AddCoins`, money and coin windows at (20,7) and (20,2)). With
  `CheckBonusRoundStreak` (var 0x4040 ≥ 10) and no `FLAG_RECEIVED_GAME_CORNER_TM64`, she gives **TM64**. With a full
  bag, she sets `FLAG_SAVED_GAME_CORNER_TM64` and gives it on a later visit.
- **NPCs**: an old man gives 20 coins once (`FLAG_RECEIVED_GAME_CORNER_20_COINS_OLD_MAN`), a farmer 50 once
  (`FLAG_RECEIVED_GAME_CORNER_50_COINS_FARMER`); each needs the Coin Case and room for the coins. The tips match §4.
- **Sign**: `BufferNumber` of var 0x4040 (shown as 999 above 999), "Shoot for 10!".
- There are no hidden coins or items on the floor (the map has no hidden-item bg events).

Prize Exchange (`scripts_veilstone_city_prize_exchange.s`): a list of 19 prizes from `GetGameCornerPrizeData`, then
yes/no, `HasCoins`, `GoToIfCannotFitItem`, `AddItem`, `SubtractCoins`. Prizes (`prizes`, arm9): Silk Scarf, Wide Lens,
Zoom Lens, Metronome 1000 · TM90, TM58 2000 · TM75, TM32 4000 · TM44, TM89, TM10 6000 · TM27, TM21 8000 · TM35, TM24,
TM13, TM29 10000 · TM74 15000 · TM68 20000. The guitarist tells Hidden Power types (`CalcHiddenPowerType`).

Semantics and OpenSinnoh status (`packages/vm/src/data/op-classification.json`; stubs write 0 to their dest vars):

| Op | Code | Status | Semantics |
|---|---|---|---|
| `show_coins` / `hide_coins` / `update_coin_display` | 117–119 | stubbed | the coin window (`FieldMenu_DrawCoinWindow`, text `pl_msg_00000361_00197` "{n} Coins", 5 digits right-aligned), like `show_money` |
| `get_coins_amount` | 120 | stubbed | var = coins |
| `add_coins` | 121 | stubbed | coins += n; does nothing at 50000 or more; clamps to 50000 |
| `subtract_coins_from_value` / `_from_var` | 122 / 680 | stubbed | coins −= n only if coins ≥ n |
| `has_coins_from_value` / `_from_var` | 628 / 681 | stubbed | var = coins ≥ n (value form: u32 operand) |
| `check_can_add_coins` | 630 | stubbed | var = coins + n ≤ 50000 |
| `get_game_corner_prize_data` | 678 | stubbed | (index) → item var, price var |
| `check_bonus_round_streak` | 629 | stubbed | var = var 0x4040 ≥ 10 |
| `scr_cmd_267` | 615 | stubbed | opens the slot app for machine `var` (§4.1) |
| `create_journal_event` | 461 | stubbed | the journal (not built) |
| `show_list_menu_remember_cursor` | 774 | stubbed | the prize list (cursor and scroll kept in `VAR_0x8005`/`0x8006`) |
| `calc_hidden_power_type` | 767 | stubbed | the guitarist |
| `show_money`, `check_money`, `remove_money`, `add_to_game_record`, `add_item`, `can_fit_item`, `buffer_tmhm_move_name`, `buffer_var_padding_digits`, `init_global_text_list_menu`, `add_list_menu_entry`, `wait_time`, `select_move_tutor_pokemon`, `get_selected_party_slot`, `check_party_mon_has_move`, `buffer_type_name` | — | implemented | |

The Coin Case's bag use ("Your Coins: n") is already implemented.

## 8. Open questions

1. **RNG source.** The DS draws from the global LCRNG that the field also uses. Seeding a session LCRNG from the main
   stream (as contests do) makes replays determined by the seed and the inputs, but the DS had no such seed. Confirm.
2. **Frame semantics for stops.** The landing depends on the reel's index at the frame of the press (`pos % 4`,
   `pos % 6`, `pos` parity, `pos % 3`), and the app state runs before the reel tasks in a frame (`src/main.c`). A
   headless model must step frames exactly so: on the press frame, the stop is applied and its control computed in
   the same frame, before that frame's movement. **(inferred)** from the run order (app, then SysTasks by priority:
   reels 129–131).
3. **Aim fallthrough when T is not reachable.** The aim rules for the middle/right reel stopped first can slip past
   L (d + 2). This is the DS behaviour; the model should keep it.
4. The **ball colours** for types 0–4 were not checked one by one. The mapping (cherries, REPLAY, Pikachu, Moon Stone,
   neutral) follows the decomp's enum use, not a render.
5. The **"BONUS:" counter** shows spins left in the round during play and the round count at the end. That reading is
   from the values each shows **(inferred)**.
6. **Member 6's colour** (the guaranteed-continue moon) was not rendered; "blue" is a placeholder name.
7. **TV segment** (Records program, ≥1000 coins won) and the **journal** event: both depend on systems still stubbed.
   Log them as stubs.
8. The **single-screen composition** (where the bottom-screen Clefairy area and counters go) is a design task for the
   screen lane. Nothing on the DS requires both screens to be seen at once, apart from the 7s sliding from the top
   screen to the bottom one.
