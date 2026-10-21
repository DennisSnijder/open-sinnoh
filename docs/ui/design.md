# In-game UI design

Platinum's menus on a single web screen (no second screen; the field fills the view).
Code: `packages/app/src/ui/`. Tests: `tests/browser/ui.spec.ts` (fixture), `ui.rom.spec.ts` (ROM).

## 1. Design language: faithful-inspired

The UI uses DS windows with web layout. Each window has a paper fill, a two-ring slate frame, notched
"pixel-rounded" corners and a hard one-dot drop shadow. All text is drawn in the game's own message
font. The layout reflows: it does not scale a 256×192 bitmap.

- **Dot grid.** Frames, gaps and paddings are multiples of `--dot` (one DS pixel = 2 CSS px, or 3 when
  the short side is ≥ 900 px). Corners are notched by a `clip-path`; nothing is anti-aliased.
- **Type.** Every in-game label is the imported font (`LoadedFont`). It is drawn into a small canvas at
  a whole number of device pixels per font pixel, so it stays crisp at any `devicePixelRatio`, and
  recoloured by palette: ink, light (on slate), LCD, muted. A visually hidden copy of the text gives
  each label an accessible name. Chrome-only strings (hints, aria labels) use the system font.
- **Colour.** Paper `#f8f8f0`; slate frames and title bars; a pale blue band for the selected row; the
  red pixel arrow cursor from the DS menus; amber for pressed controls (the app's accent).
- **Motion.** Windows enter in 4 stepped frames (160 ms, `steps(4)`): pixel-like, never smooth easing.
  None with `prefers-reduced-motion`.
- **Labels from the ROM.** `strings.ts` maps UI keys to Platinum message names
  (`StartMenu_Text_Bag`, `pl_msg_00000395_*` pockets, `pl_msg_00000457_*` Pokétch apps). The UI
  looks them up in the base pack's namespace. The fixture carries original strings under the same
  names, and mods override them like any text. A missing message fails at mount.

## 2. Input and focus

- **One input path.** Menus are headless models in the game (packages/menus, contracts `apps.ts`);
  the DOM only draws their `AppView`. They read the field's `InputFrame` (keyboard, gamepad,
  on-screen d-pad/A/B, the replay bridge); a tap or click sends the element's tap id
  (`InputFrame.tap`). The field and the VM do not step while an app is open, as on the DS.
- **Open/close.** X (C key) or Start (Enter) opens the start menu, as does the HUD menu button. It
  opens only while the field is idle: no script, world idle, no VM box. B (X key) or Escape goes back.
  X/Start close the start menu.
- **Cursor.** `data-nav` elements are the cursor stops (list or grid). The d-pad moves the cursor, with
  auto-repeat (8 then every 3 ticks). A activates a stop; a tap or click activates it directly. Key
  navigation moves real DOM focus. Hover never moves the cursor, matching the DS. The start menu and
  the bag remember their cursor and pocket.
- **Touch.** Outside DS screens, stops are at least 40 px tall on desktop and 48 px on phones. On a DS screen
  (every menu app) targets are the DS's own, at least a 16-px DS row at the unit, each tapping across its full
  row or button; the d-pad drives every menu. A row alone on its line in a window also
  taps across the window's frame, through an invisible extension (`ui/hits.ts`). HUD buttons and the
  Pokétch side buttons are 44 px or larger.
- **Browser focus.** In an open menu, Enter/Space activate the focused control (elsewhere they stay A
  and Start). Focus follows the game cursor, survives redraws, stays in the menu (Tab wraps; the page
  behind is inert) and returns on close to what had it. Tab and radio groups take arrow keys. Escape
  is B, except in a text field. Tab fast-forward applies only outside menu apps.
- **Pokétch keys.** The Pokétch is not modal. P or the HUD watch button toggles it; field input reaches the
  field and the card stays. L/R or the side button switch apps. Touches on the card are the DS bottom
  screen's; Y enters touch mode (the d-pad moves a pointer over the app's targets, A touches, B or Y leaves).

## 3. Responsive surfaces

| Surface | Desktop / landscape | Phone portrait |
|---|---|---|
| Window (start menu, save) | Column at the top right of the field, under the HUD (where the DS draws it) | Bottom sheet over the field, full width, one column |
| DS screen (party, summary, bag, PC, naming, options, card, dex) | One or two DS boards at the unit, centred in the room (clear of the landscape controls and the HUD), field dimmed | Full screen: the board at the width's unit on an opaque backdrop of its edge colours; the controls strip and HUD stay usable |
| Pokétch card | Device at the bottom right; the field keeps running | Bottom centre above the controls strip |
| VM panel (choices, M1 `PanelView`) | Unchanged: card above the message box | Same |

## 4. Inventory: Platinum menus and every bottom-screen use

Sources: decomp `src/start_menu.c`, `src/applications/*`, battle and overlay code. "Bottom" means the
DS touch screen. The mapping column is the single-screen plan.

**Start menu** (X; B or X closes). Order: (Retire, Chat), Pokédex, Pokémon, Bag, *player name*, Save,
Options, Exit. Pokédex appears once obtained and Pokémon once there is a party. The Bag needs the bag
flag (not modelled yet: always shown). Safari and Pal Park swap Save for Retire and show a ball
counter; Union Room shows Chat.

| Feature | DS top / bottom | Web mapping | When |
|---|---|---|---|
| Start menu | Window over field / none | Window or bottom sheet | **now** |
| Party | 6 panels + context menu / 6 ball buttons | Sheet, 2×3 panels (folds both screens); context menu later | **now** (list), M3 (Summary/Switch/Item) |
| Summary | Page / arc of page buttons | Sheet with tabs | M3 |
| Bag | List + description / pocket dial (drag), pocket buttons | Sheet: pocket rail (desktop) or tab strip (phone); ←/→, L/R | **now** (list), M3 (use/give/toss, description) |
| Trainer card | Card front/back / badge case (rub to polish) | Sheet: card, then badge case under it | **now** (front), M3 (back, signature) |
| Save | Info window + message / none | Window with YES/NO | **now** (writes the app save slot) |
| Options | Top only | The DS options screen, a page per section (`docs/decisions.md`, 2026-10-15, OPTIONS redesign); ←/→ change values | done |
| Pokédex | List/entry / touch control panel | Sheet: list beside a showcase (phones: list only), entry with page tabs, search rows; touch panel → buttons + tabs | **now** (cry M4) |
| PC boxes | Box grid / preview + corner dials | Sheet: grid + side preview; dials → toolbar | M3 |
| Town Map | Map / location card + zoom | Sheet: map with an overlay info card | M3 |
| Naming screen | Prompt / keyboard | Sheet: real text input + on-screen pixel keyboard | M3 (M1 uses the app form) |
| Mail, Easy Chat | Sentence / word grid + mode buttons | Sheet; mode buttons → tabs | M3+ |
| Berry tag, Poffin case | Top / flavour pentagon filter | Sheet; pentagon → filter chips | M5+ |
| Pokétch (25 apps) | — / the field's bottom screen | Overlay card over the running field | **now** (watch + names), M3 apps |
| Battle | 3D + text / Fight-Bag-Pokémon-Run, moves, targets | Command card over the battle's lower third; keys and touch | M2 |
| Battle bag / party | — / touch lists | Sheets reusing bag/party in battle mode | M2 |
| Poké Radar, Vs. Seeker | Field only | Field effects; nothing extra | M3+ |
| Underground | Radar + log / 3D field (swapped); touch mining | Field fills the view; radar → HUD minimap card; mining full screen | Out (post-M5) |
| Contests | Stage / move and timing buttons | Command card like battle; dress-up as a drag sheet | post-M5 |
| Battle Frontier | Mostly top; Arcade stop button | Windows; Arcade stop → big tap target | post-M5 |
| GTS, Union Room, Wi-Fi, Plaza | Both screens | Out of scope (no network) | — |
| Scratch cards, capsule seals, Poffin cooking | Touch on the bottom | Full-screen touch sheets (pointer drag) | post-M5 |
| Great Marsh binoculars | Hides the Pokétch | Hide the HUD watch button | with the zone |

**Pokétch apps** (`POKETCH_APPID_*`): Digital Watch, Calculator, Memo Pad, Pedometer, Party Status,
Friendship Checker, Dowsing Machine, Berry Searcher, Day-Care Checker, Pokémon History, Counter, Analog
Watch, Marking Map, Link Searcher, Coin Toss, Move Tester, Calendar, Dot Artist, Roulette, Trainer
Counter, Kitchen Timer, Color Changer, Matchup Checker, Stopwatch, Alarm Clock. Jubilife gives watch,
calculator, pedometer and party status. The other apps come from Pokétch Co. (by badges), houses and
Pal Park; Stopwatch and Alarm Clock have no field script.

- **M3b:** all 25 apps are a headless model in the game (packages/menus `createPoketch`, docs/research/poketch.md);
  the card draws its `PoketchView` on the ROM's 256×192 screen (frame, app BG, tile edits, OBJ cells, icons)
  at whole device pixels, recoloured to the screen colour.

## 5. Waiting on 2D graphics import (NCGR/NCLR/NCER/NSCR)

These are placeholders today, as our own pixel art and CSS:

- party icons (`poke_icon`);
- the trainer sprite on the card;
- badge art;
- bag pocket icons and the bag picture;
- window frames for options "Frame" types 1–20;

When these are imported they become sprites drawn on the same dot grid. The layout does not change.

## 6. Not wired yet

- **Options.** Text speed belongs in the VM's printer. Battle scene and style wait for M2, sound for
  M4, button mode and frame for later.
- **Data the state lacks.** The Pokédex has no seen/caught counts. There is no trainer ID and no item
  descriptions.
- **Party context menu** (M3).
