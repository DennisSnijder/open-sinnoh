# Visual audit — 2026-10-16

Two audits of the DS presentation, merged here. Base `60b31ab`. Rules: `docs/scope.md`,
`docs/ui/design.md` and the UI entries in `docs/decisions.md` (single screen, battle card, OPTIONS, phone
backdrop); the newer decisions override older parts of the design document. Intentional adaptations are
not defects: one composed screen, the wider field projection, the portrait control strip, the trainer card
beside its badge case, the non-modal Pokétch card, the title's wordmark.

Reference: pret/pokeplatinum at `fe1ea418a7364c93daf0d07ae55e195452d8803c` (read for behaviour, positions
and asset names; nothing copied). Captures come from a local Platinum US import and stay in ignored
`test-artifacts/`; no ROM content or screenshot is part of this document.

**Viewports** (CSS px): desktop 1280×720 @1, wide 2560×1440 @1, phone portrait 390×844 @3, phone
landscape 844×390 @3, with touch emulation on phones. Integer means whole **device** pixels per DS pixel
(4/3 CSS px at DPR 3 is integer).

**Coverage.** Field (Twinleaf, Route 201, Jubilife Pokémon Center 1F, Oreburgh Gate 1F, Eterna City; the
map-name board); start menu and save; party and its context menu; bag; summary (all pages, ribbon and move
detail, Egg memo); trainer card; Pokédex (list, search, entry pages, area, size, forms, cry); PC (deposit,
box, preview, marking, compare); naming; mart (buy, sell, quantity); OPTIONS; all 25 Pokétch apps; battle
(Route 202 wild command/FIGHT/Bag/Pokémon, Route 204 twins target screen); starter, evolution and hatch
scenes; title and new-game menu. Menu states come from the `svc-*` replays. These are representative states,
not every species, item or story permutation. Field visits use the `?debug=1` panel's Map / Tile X /
Tile Z / Warp fields from an idle field.

No defect was found in the sampled field geometry, bag, trainer card, naming keyboard, OPTIONS or starter
layout beyond the items below.

## Fixed

1. **Eggs showed their hidden species** (#33, #32). The summary and PC preview drew the hatchling under
   “Egg”, the PC heading named its species, and Manaphy's Egg used the ordinary Egg icon.
   DS: `BoxPokemon_BuildSpriteTemplate` (pokemon.c) draws `SPECIES_EGG`, form 1 for Manaphy and form 0
   otherwise; the PC preview (`box_app_manager.c`, preview setup) shows the Egg's nickname as the heading
   and clears the name line. Files: `packages/app/src/ui/art.ts`, `summary.ts`, `storage.ts`,
   `packages/menus/src/storage.ts`. Regression: `tests/browser/egg-art.rom.spec.ts` (ROM pixels compared
   at run time, never committed).
2. **Pokétch under the landscape action controls** (#33). At 844×390 the watch spanned x 572–828 while the
   button column starts at x 690; the controls covered its keypad and app button. The card now keeps to
   the room between the controls, at whole device pixels. Files: `packages/app/src/ui/ui.css`,
   `index.ts`. Regression: `tests/browser/ui.spec.ts` (overlap and a real tap at three landscape sizes).
3. **Shop description crossed its bottom frame** (#33). The DS reserves six interior tiles for it
   (`shop_menu.c` `SHOP_WINDOW_ITEM_DESCRIPTION`, 27×6); our framed replacement had five. File:
   `packages/app/src/ui/apps.ts` (`MART_TILES.description`); `svc-mart.replay` gained a buy-list beat for
   the fit checks.
4. **Map-name board under the landscape Start button** (#33). The DS draws it at the top left of the main
   screen (`MapNamePopUp_CreateWindow`, map_name_popup.c), with nothing over it. It now starts inside the
   room's left inset on touch landscape. File: `packages/app/src/game-view.ts`.

5. **Landscape battle card covered the player's healthbox** (phone landscape). The card took the scene's
   lower half and hid the name, HP gauge and numbers. DS: the healthbox stays on the main screen at
   (192,116) (`healthbox.c`) while the touch screen shows the commands. Every landscape battle (window or
   filling the view) is now one composition: the scene with the card's band under the player's box
   (`LANDSCAPE_CARD`, singles y 140, 84 tall; doubles as before), at the largest whole-pixel scale that fits.
   Files: `packages/app/src/battle/scene.ts`, `index.ts`. Regression: `tests/browser/battle-card.rom.spec.ts`
   (no healthbox under the card at 844×390, 667×375, 932×430 and the window sizes),
   `battle-doubles.rom.spec.ts` (now in every mode).
6. **Hatch scene broke the phone rules.** Its canvas was `min(100%, dot × 256)` wide (4.57 device px per
   DS px at 390 CSS px), its text at the layer's `--dot` (the question wrapped over the Pokémon), and the
   field showed around it. DS: one 256×192 screen, message window (2,19) 27×4, YES/NO (25,13) 6×4
   (`cutscenes/egg_hatch/main.c`). The hatch now uses the evolution scene's layout (`layoutScene`,
   `sceneContext`): a whole-pixel stage, full screen over black on phones (the battle window's size on big
   landscape views), message box and YES/NO at their DS tiles with flowed text at the scene's unit and
   16-px DS rows (evolution's text and YES/NO rows were affected the same way: fixed with it). Files:
   `packages/app/src/ui/hatch.ts`, `evolution.ts`, `evolution.css`, `apps.css`. Regression:
   `tests/browser/daycare.rom.spec.ts` (integer scale, boxes on the screen and clear of the Pokémon, opaque
   full layer on phones, portrait and landscape).
7. **Mart was not a composed DS screen** (worst on phones: windows stacked over the live field). DS:
   `Shop_LoadGraphics` (shop_menu.c) puts the shop panel (`shop_gra` tilemap over tiles, `default` palette)
   on BG1 and prints the list (12,2) 19×14 and description (5,18) 27×6 on it, the icon at (22,172). The
   importer adds `shop/panel` (`platinum-60`); the mart is one 256×192 board at the unit on every viewport,
   its windows at the DS tiles; buying and selling draw the panel (the field shows through its open corner
   on wide screens, as on the DS); phones show that screen centred, full screen, on the opaque backdrop. The
   BUY/SELL menu stays over the field. Files: `packages/importer/src/ui2d/shop.ts`,
   `packages/app/src/ui/apps.ts`, `apps.css`, `index.ts`. Regression: `tests/browser/services.rom.spec.ts`
   (panel drawn, whole-pixel screen holding every window, opaque full-layer backdrop on phones),
   `fit.rom.spec.ts`.
8. **Summary had no caught-ball sprite.** DS: `SUMMARY_SPRITE_CAUGHT_BALL` at (16,32), the ball's NCGR
   (`master_ball` + ball − 1) in the condition-flash cell with `balls_<n>` by `sBallIDToPaletteNum`
   (`PokemonSummaryScreen_SetCaughtBallGfx`). The importer adds `summary/balls`, a cell per ball item
   (`platinum-61`); the summary draws `SummaryView.mon.ball` there and fails loudly on a ball without art.
   Files: `packages/importer/src/ui2d/summary.ts`, `packages/app/src/ui/summary.ts`. Regression:
   `ui2d.rom.test.ts`, `tests/browser/menus.rom.spec.ts` (svc-party summary beats).
9. **Start menu used stand-in icons and selection.** DS: `StartMenu_InitSprites` (start_menu.c) draws
   `menu_gra`'s icons (animation option × 3; the female bag at 9 × 3) in the grey palette, the cursor's entry
   coloured and wiggling, and the cursor sprite at x 204; the window is 11 tiles wide with three tile rows an
   entry and the label at x 28. The importer adds `start_menu/icons`, `icons_gray` and `cursor`
   (`platinum-62`); the window keeps its agreed place and uses those rows, icons, the wiggle (its NANR
   rotation frames) and the cursor sprite. Not done: the swell played when the cursor moves before the
   wiggle (the view is redrawn without the previous cursor). The fixture keeps our stand-ins. Files:
   `packages/importer/src/ui2d/start-menu.ts`, `packages/app/src/ui/apps.ts`, `ui.css`. Regression:
   `ui2d.rom.test.ts`, `tests/browser/ui.rom.spec.ts`.
10. **PC preview strip never cycled.** DS (`ov19_021DA92C.c`, `ov19_021DACF8`): window (1,21) shows 12×2
    tiles; four pages (held item, the type icons at x 24 + 36i, nature, ability) each held 81 frames, then
    scrolled up 4 px a frame, round and round; never for an Egg. The preview gains `types` and an ability field
    (contracts 0.27.17 draft) and the strip runs that cycle (a page column animated at the game tick;
    restarted when the preview is drawn anew; none with reduced motion). Files:
    `packages/contracts/src/apps.ts`, `packages/menus/src/storage.ts`, `packages/app/src/ui/storage.ts`,
    `storage.css`. Regression: `tests/browser/menus.rom.spec.ts` (svc-pc-compare's mark beat samples frames
    0, 40, 83 and 85).
11. **Pokédex cry page showed a made-up waveform.** DS (`ov21_021E3FFC.c`, sound.c): the page is
    `cry_button` over `entry_main`, the picture at (48,64); a 256-px window scrolls 4 px a frame, its newest
    columns the cry's samples between last frame's played count and this one's (NNS player ticks × 32), ±32 px
    about y 151 in the banner palette's colour 9/6; nine meter columns of `cry_bar` segments from the samples'
    midpoint crossings, with falling peak markers. The importer adds `pokedex/cry_screen`, `cry_bar` and
    `cry_wave` (`platinum-63`); the page runs that per game tick (`ui/dex-cry.ts`) from the cry's wave and a
    silent copy of the synth for the player's ticks (`SoundEngine.ticks`, `SoundSystem.cryTicks`). Files:
    `packages/importer/src/ui2d/pokedex.ts`, `packages/audio/src/engine.ts`, `packages/game/src/sound.ts`,
    `packages/app/src/ui/dex-cry.ts`, `dex.ts`. Regression: `ui2d.rom.test.ts`, `tests/browser/dex.rom.spec.ts`
    (new `dex-cry` beat in `svc-dex.replay`: the waveform moves and the meter lights while the cry plays, both
    rest after it).
12. **Double-battle target buttons had no Pokémon icons** (and the desktop target card covered the second
    player's healthbox). Fixed by PR #26 (battle DS details): the eligible opponents' icons on the target
    buttons (`BattleSubscreen_DrawTargetSelect`), and the doubles card below both friendly boxes; checked in
    `tests/browser/battle-details.rom.spec.ts`.

13. **Pokédex list was flat.** Nine recycled ROM plates now follow the reference centres and depth palettes,
    with the current entry at (170,82); the model owns 30 Hz travel, held-key acceleration and five-row
    Left/Right movement. Dragging the arc drives the touch-wheel travel; tapping a row selects before opening.
    Correction to the audit's resource name: the list uses `search_body_shapes` animation 0, whereas `name_tag`
    is the separate current-species label. Importer `platinum-67`, contracts 0.27.22. Files:
    `packages/app/src/ui/dex.ts`, `dex.css`, `packages/menus/src/pokedex-scroll.ts`, `pokedex.ts`.
    Regression: `tests/browser/dex.rom.spec.ts` (desktop/phone row centres at rest and during movement,
    touch drag, whole device pixels and opaque phone portrait/landscape backdrops).

## Open, ranked

None from this audit.
