# The Pokétch (M3b)

Sources: decomp `src/poketch.c`, `src/applications/poketch/*` (20.7k lines), `res/graphics/poketch/poketch.order`,
the field scripts that give apps. Code: `packages/menus/src/poketch/` (model), `packages/app/src/ui/poketch.ts`
(card), `packages/importer/src/ui2d/poketch.ts` (art), `packages/vm/src/m3b-poketch-ops.ts` (ops).

## 1. Device and save

- **Saved** (decomp `Poketch`, GameState v11 `poketch`): enabled, registered apps, current app, screen colour
  (8 themes), pedometer steps (0–99999, wraps; counted only once the Pedometer is registered and only while the
  Pokétch runs: enabled and `FLAG_POKETCH_HIDDEN` clear), alarm (on, hour, minute), calendar (one month + a
  day bitmap), six map markers (default x 104…184 step 16, y 152, LCD-relative), dot art (120 bytes, 2 bits a
  cell), the Pokémon history (12, oldest first; added on catch, gift, hatch, evolution).
- **Not saved** (decomp `PoketchMemory`, one 12 KB RAM slot reset on every app change): the memo pad's drawing,
  the counter, the coin, the move tester's types, the stopwatch and kitchen timer. Switching apps loses them on
  the DS too; here they live in the app until the app changes.
- **Ticks:** the Pokétch runs once per 30 Hz main loop (two VBlanks); NANR durations are 60 Hz frames advanced
  by 2 a tick. Every touch rect is half-open. The decomp's button manager: TOUCH on a press that starts inside,
  TAP on release inside, DRAGGING when the finger leaves, timers and repeat counted in ticks. Input and sounds
  are off while a field task (script) runs.
- **Side button** (x 224–255; UP y 32–95 = previous app, DOWN y 96–159 = next): apps cycle in **app id order**
  (not registration order). A TAP (or UP held 7 ticks) closes the screen (5 ticks), waits 3, opens the next app
  (4 ticks). More presses meanwhile show the app counter (app id + 1, inverted colours at 176/192, 40) and
  step it; 30 ticks after the last press the app loads. Pressed/half-pressed button images are border tiles.
- **Frame:** `poketch_border` (chars at 64), BG palette 15 from the border NCLR: pink for a girl, blue for a boy.
  The LCD is x 16–207, y 16–175. Colour: `generic_bg_tiles.NCLR` = 8 themes × (normal, backlight); apps use
  slots 1 (ink), 4 (paper), 8 and 15 (mid). Pokémon icons map each colour's luma ((299R+587G+114B)/1000 on
  5-bit channels, >> 3) to slots 1, 8, 15, 4, drawn 2× (poke_icon anim 4/6, SRT scale 2).
- **Ops:** `enable_poketch`, `check_poketch_enabled`, `register_poketch_app`, `check_poketch_app_registered`,
  `hide_poketch`/`show_poketch` (FLAG_POKETCH_HIDDEN: binoculars, the Great Marsh lookout),
  `buffer_poketch_app_name`. All `real: 'M3b'`.

## 2. How Platinum gives the apps

| App | Where (script) |
|---|---|
| Digital Watch, Calculator, Pedometer, Party Status | Jubilife, the president for the three coupons (`JubilifeCity_GivePoketch`) |
| Memo Pad, Marking Map, Link Searcher, Move Tester | Pokétch Co. 1F president at 1, 3, 5, 7 badges, in that order |
| Friendship Checker | Eterna Pokémon Center 1F |
| Dowsing Machine | Route 207, Dawn/Lucas |
| Day-Care Checker | Solaceon, the Day-Care |
| Pokémon History | Solaceon Town (50+ seen) |
| Counter | Veilstone Department Store 2F |
| Berry Searcher | Route 208 house |
| Analog Watch | Celestic Town house |
| Coin Toss | Route 213 house (Grand Lake) |
| Matchup Checker | Pastoria Great Marsh gate (5+ Safari games) |
| Calendar, Dot Artist, Roulette | Sunyshore east house (party natures) |
| Trainer Counter, Kitchen Timer, Color Changer | Pal Park lobby |
| Stopwatch, Alarm Clock | no field script (Mystery Gift only) |

Gifts go through `CommonScript_ObtainPoketchApp` (fanfare SEQ_POCKETCH, "installed", per-app message).

## 3. Apps (graphics: poketch.narc member = line − 1 of poketch.order)

- **Digital Watch:** watch tiles 23 + NSCR 24; digits are 32×72 copies from `digital_watch_digits` (320×72,
  stored as 32 + 8 columns) at x 24, 64, 120, 160, y 56; 24-hour; holding the screen lights the backlight
  palette. **Analog Watch:** NSCR 26, affine hands at (116, 100): minute m × 6°, hour (h % 12) × 30 + m / 2.
- **Calculator:** NSCR 17, tiles 16 (40 wide); keys as tilemap edits (pressed tiles 251–253, 291–293, 331–333
  or 337–339, glyph + 40); 10 symbols (165 + 2·sym), operator at (24, 24). Fixed point, 10 symbols, truncation;
  divide by zero = error; chaining left to right; "=" repeats; a successful "=" plays the cry of that dex
  number if seen.
- **Memo Pad:** a 78×75 canvas of 2×2 dots at (16, 16); pencil 1 dot, eraser 4×4; DDA lines. Tools at
  x 180–203 (eraser y 24–87, pencil 104–167).
- **Pedometer:** five digits with leading zeros at x 80…144, y 64; the button (82–145, 100–155) resets on TAP.
- **Party Status:** no NSCR (tile 5 fill); icons 2× at (64|160, 36|84|132); HP bars 64 px (2 × 32 steps) in
  8×1-tile windows framed by tiles 1, 2, 6; fainted or statused icons are a silhouette (slot 15); held item or
  mail marker at icon + (28, 21). A tap on an icon bounces it (±2 px) and plays the cry; elsewhere refreshes.
- **Friendship Checker:** icons wander; near a held touch they come (or run, when they dislike) at 1–2 px a
  tick; hearts by friendship (< 1, 35, 70, 150, 200, 255 tiers); a double tap makes them jump.
- **Dowsing Machine:** hidden items (bg events of type 3, flag 730 + n for script 8000 + n, range from
  arm9 `gHiddenItems`) within x ±7, z −7..+6; the player is at (112, 101), 11 px a tile; an item within
  8/24/48 px (range 0/1/2) blinks; within 48 px otherwise the ping keeps looping; moving stops it.
- **Day-Care Checker:** both Pokémon (level after the steps' experience, gender), the egg; a tap refreshes with
  a mosaic. **Matchup Checker:** the daycare compatibility of two party Pokémon, as a Luvdisc show.
- **Marking Map:** the player's chunk (main matrix, tile / 32) at x 26 + 6cx, y 24 + 6(cz − 5); six
  draggable markers (17×17 hit); hidden locations once found; roamers (none yet).
- **Counter** (0–9999 on TAP), **Coin Toss** (fx32 bounce, 56 % restitution), **Stopwatch** (Voltorb tile
  groups, hold 15 then 75 ticks to reset), **Kitchen Timer** (to 99:59, hands beat while it rings),
  **Alarm Clock** (Loudred cry; turning it off is not saved, a decomp quirk), **Calendar**, **Dot Artist**
  ("Touch!" default), **Roulette**, **Color Changer**, **Move Tester**, **Pokémon History**.
- **Not wired (logged):** Berry Searcher (no berries yet: the map, the player, the legend), Trainer Counter
  (no Poké Radar yet), roamers on the Marking Map, Link Searcher (no wireless: 00 everywhere after 60 ticks).
