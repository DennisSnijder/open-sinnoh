# The TV

2026-10-24. The TV broadcasts (the TV sets in houses and other buildings, the interviews that feed them, the segments
the game's systems record) and the Jubilife TV gallery. Source: pret/pokeplatinum (local `reference-projects/pokeplatinum`),
for names, offsets and understanding only. Paths are relative to its root.

## 1. Sources

| what | where |
|---|---|
| Save block (TVBroadcast), saving a segment, the time slot | `src/unk_0202E2CC.c`, `include/struct_defs/tv.h` |
| Segment data, recorders, eligibility, messages | `src/tv_segment.c` |
| Schedule, choosing a segment, framing messages | `src/overlay006/ov6_022465FC.c` |
| Episodes (the trainer name) | `src/overlay006/tv_episode.c` |
| Commercials | `src/overlay006/tv_commercials.c` |
| Script commands, interviews | `src/scrcmd_tv_broadcast.c` |
| Scripts | `res/field/scripts/scripts_tv_broadcast.s` (the TV, tile behaviour TV → script 10100), `scripts_tv_reporter_interviews.s` |
| Clock hooks | `src/unk_020559DC.c` (`sub_02055B64`: the slot; `FieldSystem_HandleDailyEvents`: `sub_0206F2F0`) |
| Schedule data | `arc/tv.narc`: member 0, a programme id per quarter hour from 5:00 (96 rows) and day (Monday first); member 1, nine 12-byte programme rows: type, then up to 11 segment ids ended by 0 |

## 2. What the DS does

**Presentation.** Watching TV is the field's message box: `TVBroadcast_Interact` prints the bank and message the
commands put in vars with `MessageFromBank`. There is no TV screen app in Platinum (the Canalave Library's TV and the
gallery are separate).

**A watch** (`TVBroadcast_Interact`): the status (`TVBroadcast_GetPendingBroadcastType`): the programme's farewell was
shown → a commercial (one of the unlocked ones, MTRNG); four segments played → the farewell, then finished; none played
→ the greeting (by GetTimeOfDay: morning, day, else evening), then on; else the next segment
(`TVBroadcast_GetNextSegmentID`): none → the early farewell and finished; one → the intro (the lead-in before any
segment, else "next"), then the segment. `RECORD_WATCHED_TV` each time.

**The schedule.** The programme is `tv.narc[0][((19 + hour) % 24) × 4 + minute / 15][weekday]` (weekday Monday = 0),
from the saved clock. Nine programmes of five types: 1 Interviews (Battling Trainers, Trainer Research), 2 Trainer
Sightings (Battle Watch, Trainer's Day, Sinnoh News Net), 3 Records (Rack 'Em Up Records), 4 Sinnoh Now (Sinnoh Now,
Trend Tracker), 5 the Variety Hour. Every hour opens with Sinnoh Now.

**The time slot.** On whole minutes passing (`TVBroadcast_UpdateProgramTimeSlot`): the slot's minutes run down; at its
end the next ends at the clock's next quarter hour, the programme is not finished and nothing has played.

**Saved segments.** Types 1–3 keep four segment instances each (`TVSegmentInstance`: id, times played 0–3, 40 bytes of
data); Wi-Fi episodes (record mixing) have their own lists, empty offline. `TVBroadcast_SaveSegmentData`: an instance of
the same segment is replaced once it has played three times (else the new one is dropped); else the first free slot;
else the first played three times; else dropped.

**Choosing a segment** (`ov6_022468B0`, four passes: Wi-Fi unplayed, local unplayed, Wi-Fi played, local played): the
programme's segment ids in order; for each, the saved slots (1–4) holding it whose play count is 0 (or above 0);
Sinnoh Now and the Variety Hour list their own ids not played this slot, on the local unplayed pass only. Then the
ineligible ones are blanked (`TVSegment_IsEligible`: no message → never; a check per segment, mostly "the species is
seen" or a first-arrival flag), then those played this slot — `TVBroadcast_ExcludePlayedSegments` stops at the first
blank, so a played one after an ineligible one stays. One of the first 11 left at random (MTRNG, only with two or more).

**Playing one** (`TVBroadcast_LoadSegmentMessage`): the slot joins the slot's played list, the instance's play count
goes up (to 3), then its message: the template from the data (the player's name for "the trainer"), some with a random
variant (LCRNG: Rate That Name Change 5, the Seal Club 3, …). Sinnoh Now and the Variety Hour make theirs up now: the
weather on one of five yearly-weather maps, the town the player is in, the day's swarm, a berry patch of a visited
place, a random nature, a roamer and a random route, a gallery photo, trivia.

**Recorders** (who writes what): the Catch That Pokémon Show after a wild, roamer or AI-partner battle (a catch; or a
win or flight with three balls or more); What's Fishing (a hook or a fish that got away); Hidden Item Breaking News
(`SaveTVSegmentHiddenItem`); the Sinnoh Shopping Champ (ten or more bought at a normal mart); the Happy Happy Egg Club
(a hatch); Rate That Name Change (the Name Rater, `ScrCmd_2B8`); the Underground Treasures Corner (each treasure dug);
the Safari Game bulletin (its end, with the first catch and the count); the Pokémon Storage bulletin (a one-gender
party, `SaveTVSegmentPokemonStorageBulletin`); the Planting and Watering Show (a harvest rated 4, or 0); the Seal Club
(a capsule put on a Pokémon); Home and Manor (the Villa); records: a Battle Tower streak record, a size record, 1000
coins won at the slots, 15/20/…/40 Sinnoh ribbons, ten traps taken back underground, 30 BP in a day (at the day
change). Pending data for the interviews: the last official contest (`TVBroadcast_SetContestHallShowInfo`), the Amity
Square walk (`ScrCmd_27C`), the last Poffin cooked alone, a Battle Tower challenge of seven or more, the Battle Hall's
singles Pokémon; the interview's answer (an Easy Chat word) saves the segment and clears its pending data.

**Interviews** (`scripts_tv_reporter_interviews.s`, reporters in the Contest Hall, the Poffin House, the Pokétch
Company, the Fan Club, Hearthome's gates, Jubilife TV, a Canalave house, Route 214's gate, the Frontier):
`CheckTVInterviewEligible` (`sub_0202E6B0`: no unplayed answer of that segment, and a free or worn slot; then the
segment's check), the question (`TVInterview_LoadMessage`), the word, `SaveTVInterviewResponse`
(`TRAINER_SCORE_EVENT_TV_INTERVIEW_GIVEN`).

## 3. What is built

- **Contracts** `tv.ts` (0.41.0): `TvState` (`GameState.tv`, schema v23: the slot, the three saved types' four slots of
  `TvRecord`, the pending data), `TvSegmentData` (one kind per segment), `TvTables` (`NewGame.tv`), and the recorders as
  shared state edits (`saveTvSegment`, `tvCatch`, `tvSafariCatch`, `tvRibbon`, `tvBattlePoints`, `tvDaily`, `tvTimeSlot`).
- **Importer** `tv.ts`: tv.narc into `NewGame.tv`, checked (programmes 1–9, types 1–5, segment ids within the type's).
- **Services** `tv.ts`: the status, schedule, framing messages, commercials, the four passes, eligibility, every
  segment's message and template (`TvMessage`: a bank by name, a message index, template slots), the interviews.
- **VM** `tv-ops.ts` (`REAL_TV`): `call_tv_broadcast` (its operands decoded per call), `call_tv_interview`,
  `check_tv_interview_eligible`, `save_tv_segment_hidden_item`, `scr_cmd_2b8`, `save_tv_segment_pokemon_storage_bulletin`,
  `save_tv_segment_home_and_manor(_no_furniture)`, `scr_cmd_27c`, `get_battle_frontier_reporter_position`.
- **Hooks**: the game (the catch show after a wild battle, the slot on minutes, the BP record at the day change), the
  world (fishing, the Safari Game's catches), the VM (contests' end, ribbons, the Safari Game's end, hatching, the Name
  Rater, berries, the size contest, the slots, the Battle Tower, the Hall, BP), the menus (marts, mining, the capsule
  editor's SET, Poffin cooking). `BattleResult.ballsThrown` counts the balls thrown.
- **Tests**: services `tv.test.ts` (fixtures: saving, the slot, the schedule, the passes and the exclusion quirk,
  messages, interviews), `tests/integration/tv.rom.test.ts` (the schedule; `sys-tv-contest` — a contest win, the
  reporter, EVERYONE — and `sys-tv-contest-watch` — the greeting, the lead-in and the Contest Hall segment at 14:20 on
  the Sunday, the early farewell, a commercial; each twice on seeds 1–3 with the save round trip), browser
  `tv.rom.spec.ts` (desktop, phone).

## 4. Deviations and what is left

- One stream: the DS's MTRNG and LCRNG draws are both the game's main stream, in the DS's order. The Seal Club's unused
  MTRNG draw is not made (the capsule editor has no stream).
- The slots' record counts the minutes the slot app ran (the DS: real seconds / 60).
- Not recorded: Love That Group Corner (groups are not built), Capture the Flag Digest and the GTS count (link-only),
  the traps record (the DS counts traps others set; the solo Underground's spawned traps have no setter), the Battle
  Frontier multi partner interview (a link partner's name; never eligible offline). Discovering Groups (Sinnoh Now)
  needs a group, so it never airs.
- The Variety Hour's random move can be the DS's move −1 (a draw of 0); the first move name bank entry stands in.

## 5. The Jubilife TV gallery

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
