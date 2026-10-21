# Starter choice (the briefcase scene)

Sources: decomp `src/choose_starter/choose_starter_app.c` (launched by `ScrCmd_StartChooseStarterScene`,
`res/field/scripts/scripts_route_201.s` `Route201_Briefcase`), `res/text/unk_0360.json`. 30 Hz frames.

## 1. What the DS shows

**Screens.** Main engine only: BG0 is 3D, BG1 the message window, BG3 three name windows (their EN text
is blank padding: entries 4–6 are `garbage`), OBJ the cursor. The backdrop is `0x08C3` (dark green). The
scene fades in from black (6 frames) and out to black (6 frames).

**3D** (all from `graphic/ev_pokeselect.narc`, edge marking dark grey, toon shading, one white light
pointing into the screen, `(0, 0, −1)`):
- the grass floor `pmsel_bg` (member 9) at (0, −28, 40), scaled 3.5 × 1 × 3.5, turned 180°;
- the closed briefcase `psel_all` (member 1) with its opening clip (member 0, 41 frames);
- once that clip ends: the open briefcase `psel_trunk` (member 8) and the three balls `psel_mb_a/b/c`
  (members 3/5/7, each with a 73-frame wobble clip 2/4/6) at (−44, −4, 32), (0, −4, 62), (38, −4, 26).
  The selected ball loops its clip; the others rest at frame 0.

**Camera.** Target 0, distance 300, pitch −30°, FOV index 22° (the half angle, as on the title). After the
briefcase opens it moves over 6 frames to pitch −50°, distance 200, target z 36 (integer linear steps).

**Sequence.** Fade in → 36 frames (bag sound) → opening clip → camera move → 6 frames → the
briefcase intro line (entry 0, waits for A) → the choose prompt (entry 7) → the cursor shows. Left/right move it (no wrap); A confirms.

**Cursor.** A white pointing hand (members 10–13: NCGR, NCLR, NCER, NANR; one 32×32 cell, origin at its
centre) at (78, 55), (130, 82), (172, 50) per ball, bobbing `sin` over 32 frames × 8 px.

**Pop-up.** On A: a 128×128 software sprite (member 14, scanned 4bpp, palette 15: a white disc ~96 px
wide) and the Pokémon's front sprite both move from (cursor x, cursor y + 48) to the screen centre
(128, 96) and scale 0.4 → 1 over 6 frames; then the cry.

**Confirm.** The message window (tiles (4, 19), 23×4, the options' message frame, text colours from
palette 16) shows entry 1–3 for the slot: the species' category and name wrapped in a `{COLOR n}` … `{COLOR 0}`
pair, a line break, then the take-it question (`COLOR n`: palette colours 1 + 2n / 2 + 2n: red, blue,
green), and a YES/NO menu at
tiles (23, 12). YES ends the app; NO shrinks the pop-up back (−2 frames a step) and returns to choosing.
The DS shows no type; the name sits in the message with the species' category.

## 2. ROM files

| Asset | `graphic/ev_pokeselect.narc` | Format |
|---|---|---|
| Closed briefcase + opening clip | 1, 0 | NSBMD, NSBCA |
| Balls + wobble clips | 3/5/7, 2/4/6 | NSBMD, NSBCA |
| Open briefcase, floor | 8, 9 | NSBMD |
| Cursor | 10–13 | NCGR, NCLR, NCER, NANR |
| Pop-up disc | 14, 15 | scanned NCGR, NCLR |
| Message / name-window colours | 16, 17 | NCLR |
| Texts | pl_msg bank 360 | entries 0–3, 7 |

## 3. Our version (one screen)

- **Import** (`packages/importer/src/choose-starter.ts`): six glTF models `MODEL_CHOOSE_STARTER_*` (the
  g3d path, clips kept), and `ui2d` sheets `choose_starter/cursor`, `preview_window` and `text_colors`
  (palette 16 as a 16×1 image). Pokémon pictures are the existing `pokemonSprites`. The view finds these by
  id in the base pack's namespace; the fixture has original versions (a crate, lanterns, a pointer).
- **Logic stays the VM's `choice` panel** (`start_choose_starter_scene`): its cursor is the selected ball,
  left/right (and up/down) move it, A takes it, a touch on an option's panel rect takes that one. So the
  DS's separate YES/NO step does not exist: the selected ball's Pokémon is always shown with the slot's
  question and a YES window, and A or a tap on YES, the disc or the selected ball takes it. A tap on another
  ball moves the cursor with one d-pad press per tick, so replays and recordings see plain input.
- **Composition**: the floor fills the view (the backdrop takes the floor texture's edge colour); the DS
  view (with room for the open lid) sits left of centre in landscape, with the disc, name and type tags on
  the right; in portrait the disc sits above the briefcase. Message and YES windows sit at the bottom of the
  DS view, raised 6 px so the lid's rim (54 px above the DS view) and the windows fit 720 px at 3×. The 3D draws at DS-pixel size; every scale is whole in device pixels.
- **Asks follow the species, not the slot**: the ask is the bank entry (1–3) naming the species now in the
  slot; if none does (a mod's own species), it is "NAME!" and the slot entry's question line.
- **Timeline**: fade in, 10 frames (the DS's 36 are shortened: input is live from the start), opening
  clip, camera move, 6 frames, cursor. Reduced motion: open at once, final camera, no bob, pop, wobble or
  fades.

Left: edge marking and toon shading; entry 0 (the intro line); the cry and sounds; the
DS's YES/NO step (needs a confirm step in the VM's panel model); the options' message frame graphics
(the window uses the field message box's drawn frame, like the field).
