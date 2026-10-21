# Title screen and main menu

Sources: decomp `src/applications/title_screen.c`, `src/main_menu/main_menu.c`, `titledemo.order`. 30 Hz frames.

## 1. What the DS shows

**Screens.** `whichScreenIs3D = SUB` swaps the displays: the **top** screen is engine B (logo), the **bottom**
is engine A (3D Giratina). Top: BG3 rocky border (prio 3), BG1 red glow `top_screen_border_2` blended
`G2S_SetBlendAlpha(BG1, BG3, 10, 10)`, BG2 logo (8bpp, ext palette slot 2), BG0 "PRESS START" (system font,
window tiles (2,19) 28×2, letter+shadow `GX_RGB(21,0,0)`). Bottom: BG3 dark border gradient, BG0 = 3D, BG1
"Developed by GAME FREAK inc." (decomp file names `gf_presents_*`). `Bg_MaskPalette` makes both backdrops black.

**3D.** `giratina.nsbmd` (27 joints, Maya SSC scaling, rigidly skinned: display lists `MTX_RESTORE` +
`MTX_SCALE`), `giratina.nsbca` (121-frame loop, basis-table "rot5" rotations), `giratina.nsbta` (wing texture
scroll on `lambert2`). Camera: target (0,100,−18), moves from (0,192,600) to (−64,192,484) over 60 frames,
FOV half-angle 15.996°, clip (0,300) (zero near plane: no clipping). Light 0 = camera→target, light 1 =
(−0.5534, 0.4768, −0.6828); materials use DS vertex lighting (body: light 1, ambient 1, emission 0.45; wings
emission 1). Hover: angle += 2°/frame, `y −= trunc(sin((angle·0xFFFF/360) mod 360)·0.3)` (decomp-noted bug).

**Intro (`TitleScreen_ShowIntro`, only after the opening movie).** Portal model `giratina_portal`
(+bca/bta) with Giratina's face (`giratina_face`, +bca and material/alpha `nsbma`), ~267 frames; two white
flashes (10+10 frames, light 1 brightening/darkening 5↔31 by 2/frame); fade to white; greyscale logo
(`op_demo.narc` 12/13/14) on the top; Giratina anim starts; main fades from black over 48 frames while the
camera moves in; then logo + glow, sub fades from white (16×3 frames), credit; done 90 frames later. A/Start/Select skip.

**Main loop.** Prompt blinks 16 on / 16 off. A or Start: Giratina cry, "blur" (the logo tilemap loaded again
into BG0, the logo layer scrolled 1 px, `G2S_SetBlendAlpha(BG0|BG1, BG2|BG3, 26, 10)`), 10 frames later a
6-frame fade to white → main menu. B+Up+Select → delete-save app. 900 idle frames → replay the opening.

**Main menu.** Background `GX_RGB(12,12,31)`. Option windows 26 tiles wide, stacked from tile row 1 with a
2-tile gap: CONTINUE (5 lines: PLAYER/TIME/BADGES/POKéDEX, values right-aligned with a 32 px margin, text in
the gender colour, Pokédex row only once obtained, seen count), NEW GAME, then Mystery Gift, Ranger,
GBA migration, Wii, WFC settings (each conditional). Focused frame: palette 3 colour 6 cycles
`GX_RGB(1..31..3, 28, 20)` one step a frame. Up/down without wrap, A opens, B → title. Scrolls (arrows from
NCER/NANR, `graphic/mystery.narc`) when the list exceeds 192 px. No save → straight to the intro/new game.

## 2. ROM files

We import only the two models (Giratina, portal); the 2D rows are reference.

| Asset | File | Format |
|---|---|---|
| Model, anim, tex scroll | `/demo/title/titledemo.narc` 1, 2, 0 | NSBMD (own TEX0), NSBCA, NSBTA |
| Portal / face (intro) | titledemo 16–18 / 19–21 | NSBMD, NSBTA, NSBCA / NSBMD, NSBMA, NSBCA |
| Logo | titledemo 12 (NCGR 8bpp), 11 (NCLR), 22 (NSCR 256×256) | 2D |
| Borders | titledemo 23/24/25 + 7 (top), 26/27 + 6 (bottom) | 4bpp 2D |
| Credit | titledemo 5/3 + 4 (first 3 palettes at palette 1) | 4bpp 2D |
| Grey logo | `/demo/title/op_demo.narc` 14/12/13 | 8bpp 2D |
| Texts | `TitleScreen_Text_PressStart`, `MainMenuOptions_Text_*` | pl_msg |

## 3. Pipeline: had vs built

- Had: NSBMD → glTF (single-matrix shapes), NSBCA (pivot rotations only), NSBTA, text, font.
- Built (g3d, reusable for battle models): `rot5` basis rotations (layout measured: five u16 whose top 13
  bits are entries 0–4; entry 5 = sign bit 0 of u16 4 + the low 3 bits of u16 0–3), `MTX_RESTORE`/`MTX_SCALE`
  in display lists → glTF skin (each vertex weight 1 on its node, bind pose in model space), Maya SSC accepted
  when every scale is 1.
- Built (importer `title/nitro2d.ts`): NCLR, NCGR (tiled 4/8bpp), NSCR (screen blocks), a palette-RAM model
  (`Graphics_LoadPalette` offsets, extended palettes) and a BG renderer → PNG layers.
- Not built: NCER/NANR cells and animations, LZ-compressed members, NSBMA material animation, the portal intro.

## 4. Our version (one screen)

Only the DS 3D is imported; no screen is drawn as a panel beside or above another. One full-bleed scene:
the intro's portal (Spear Pillar ring, clouds, its joint loop and SRT scrolls, the intro camera's final
position, shaded to 45 %) fills the frame; Giratina hovers over it (the title camera's final position,
pulled back ×1.3 in landscape, raised 14 %/12 % of the height). Our own OpenSinnoh wordmark (the brand's
pixel art, `wordmark()` in `packages/ui`, the same on every pack, not the Platinum logo) sits in
the lower third with "Press start" (touch: "Tap to start") blinking under it; a small note at the bottom
says the project is unofficial and unaffiliated. The DS logo, glow, borders and GAME FREAK credit are not
used. The 3D is drawn at about DS resolution (≈220 px on the short side) and its scale is whole in device
pixels. Portrait recomposes the same scene (wordmark over the ring, Giratina above). The title opens on
the finished scene with a 15-frame fade from black: the intro beats (flashes, grey logo, camera move-in,
logo from white) are dropped. Exit: the wordmark brightens, 10 frames, a 6-frame fade to white.
The main menu comes up over the still-running scene, washed in the DS menu blue. The `titleScreens`
record (contracts 0.9.2) holds the model and the background scene with their cameras and lights; timings
stay in the engine. Reduced motion: no fades, blink, hover or animation. Giratina's flat look is the DS's: body (light 1, ambient 1, emission 0.45) and wings (emission 1) saturate
under white light; the wings are dark where the scrolling red band of `gira01` is not.

Left: the face model and its NSBMA, the opening movie and its 900-frame replay, delete-save combo, menu scroll arrows (three entries fit), seen count (GameState lacks it).
