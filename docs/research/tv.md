## The Jubilife TV gallery

### Sources

| what | where |
|---|---|
| Scripts (the Hiker, Frame0–10) | `res/field/scripts/scripts_jubilife_tv_2f_gallery.s` |
| Commands | `src/scrcmd.c`: `ScrCmd_0A6`, `ScrCmd_ShowDressUpPhoto` (`sub_02041DC8`), `ScrCmd_DressUpPhotoHasData` (`ImageClipsSlotHasData`), `ScrCmd_SetDressUpPhotoTitle`, `ScrCmd_BufferCustomMessageWord` |
| The app's args and its exit | `src/unk_0203D1B8.c`: `sub_0203DAC0`, `sub_0203DA00`, `sub_0203DA64` |
| The dress-up's gallery mode | `src/overlay022/ov22_02255D44.c`: `ov22_02255D44` (init), `ov22_02255E50` (states 0–12), `ov22_02256098` (exit, the save), `ov22_02256C70` / `ov22_02256DE0` (to the photo's place and back), `ov22_02256F38` (the photo), `ov22_02257278` / `ov22_02257624` (the two YES/NO) |
| The Pokémon on the stage | `ov22_02259098.c`: `ov22_022590D4` (centre (192, 56) in the gallery), `ov22_022593B8` (its opaque box); `ov22_022589E0.c`: `ov22_02258A48` (picks), `ov22_02258D7C` / `ov22_02258DAC` (moves it); `ov22_022578F4.c`: `ov22_02257D04` |
| Touch YES/NO | `src/yes_no_touch_menu.c` |
| The photo viewer's dress-up mode | `src/overlay022/ov22_0225B660.c` (`ov22_0225B85C`, `ov22_0225BB00`), `ov22_0225AF8C.c` |
| The photo | `src/unk_020298BC.c` (`DressUpPhoto_*`), `include/struct_defs/dress_up_photo.h` |

### What the DS does

- **The Hiker** asks (yes/no, the explanation on request), picks a party Pokémon (`SelectMoveTutorPokemon`, not an Egg;
  with one Pokémon that one), walks the player in, sets `FLAG_ENTERED_DRESSING_ROOM` and runs `ScrCmd_0A6 slot, dest,
  first` (`first` is 1 while the flag was unset). With the var 1 it asks for a title (`ChooseCustomMessageWord` until a
  word is given), `SetDressUpPhotoTitle`, `IncrementGameRecord RECORD_TIMES_DRESSED_UP_POKEMON`, and says the word
  (`BufferCustomMessageWord`).
- **The dress-up** is the visual round's case and stage (contests.md §5) in a gallery mode: ten accessories
  (`ov22_02256708(…, 10, 0)`), no clock and no theme (the top screen has only the help window and the ten dots), no BGM
  change (`SOUND_SCENE_SUB_53`, `SEQ_NONE`: the field's music goes on). The Pokémon stands centred at (192, 56) and the
  stylus picks it too (the stylus's flag): it moves with the accessories on it, its opaque box kept inside the stage,
  then everything again by the farthest any of those accessories sticks out. The first time, bank 385 message 47 (seven
  pages) shows first, then 48 (empty).
- **DONE** turns the case to an empty page, darkens the background (8 steps), slides the buttons down (8 px a frame,
  8 frames) and the stage to the photo's place ((−8, +5) a frame, 8 frames; BG1 slides along while dark), loads the
  photo's background (imageclip 123/124; its x scroll stays −64, only y is reset), shows message 1 "Is your Pokémon all
  dressed up?" with the touch YES/NO, and lightens. NO goes back the same way. YES asks message 2 "Would you like to
  save this design?": YES saves, NO does not; either fades out. A touch button's press animates 6 frames first.
- **The save** (`ov22_02256F38`): photo slot 0 cleared, the Pokémon (species, form, PID, OT id, nickname) at its
  centre, the trainer's name and gender, every accessory on the stage (on the Pokémon front to back, then the others,
  their sprite places and priorities), the backdrop; the title stays empty. `TRAINER_SCORE_EVENT_UNK_07`. The dest var
  is 1 when saved.
- **The frames**: `DressUpPhotoHasData n`, then `ShowDressUpPhoto n` (the var 1 and no viewer for an empty slot). The
  viewer's dress-up mode differs from the contest one: frame map 128 on palette 4 (contest: 127 on 3), the banner's
  animation 5 at (48, 144), line one the trainer's name, line two bank 385 message 45 (the title word); the Pokémon at its
  saved centre. Offline only slot 0 is written; slots 1–10 come from record mixing, so their frames say "a frame for
  holding a portrait".

### What is built

- **Model**: the case and stage are shared with the contest (packages/menus `contest/dress-up.ts`, used by
  `contest/visual.ts` unchanged in behaviour); the gallery's frame around it is `gallery.ts` (`galleryDressUpScreen`,
  `galleryPhotoScreen`). Contracts 0.41.0: requests `gallery-dress-up` (slot, first) and `gallery-photo` (slot),
  results, `GalleryDressUpView`, `GalleryPhotoView`, `DressUpStageView`.
- **VM** (`gallery-ops.ts`, `REAL_GALLERY` in coverage): `scr_cmd_0a6`, `set_dress_up_photo_title`,
  `dress_up_photo_has_data`, `show_dress_up_photo`, `buffer_custom_message_word`.
- **Screens** (`ui/contest-visual.ts`): the dress-up on one canvas board as the visual round's (the top screen's window
  folded into the line with the count of ten; the help in the message box), the finish's slide, the question's window
  and the ROM's touch YES/NO; the gallery's photo frame.
- **Art** (importer `ui2d/contests.ts`): `contest/dress_photo_bg` (123/124), `contest/gallery_photo_bg` (125/128 on
  NCLR 126's second palette), `gallery/yes_no` (touch_subwindow.narc).
- **Tests**: `vm/src/gallery-ops.test.ts` (fixture), `tests/integration/tv-gallery.rom.test.ts` with
  `sys-tv-gallery.replay` (twice on seeds 1–3, save round trip), browser `tv-gallery.rom.spec.ts` (desktop, phone).

### Deviations

- Keys (not DS; the dress-up and the YES/NO are touch only): the visual round's hand; on the question up/down choose,
  A takes the choice, B is NO.
- The case's turn to an empty page is drawn as the page vanishing halfway through 8 frames; the frame counts of the
  finish's steps are the decomp's, the screen fades 8 frames.
- The case's scatter uses a local LCRNG seeded from the game stream's state (read, not drawn); the DS uses MTRNG.
- Platinum front pictures (the DS builds DP ones here), as in the visual round.
