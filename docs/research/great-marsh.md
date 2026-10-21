# The Great Marsh and the Safari Game

Behaviour notes from the decomp (pokeplatinum, names and numbers only) and where the engine has each piece.

## The game

- **Start** (`scripts_pastoria_city_observatory_gate_1f.s`): the gate 1F coord event (z 6) asks to play; YES costs
  $500 and needs room (a free box slot or a party under 6). `VAR_SAFARI_GAME_STATE` 1, `start_end_safari_game 0`
  (ScrCmd_StartEndSafariGame: FLAG_SAFARI_GAME_ACTIVE, 30 balls, 0 steps, the TV catch count reset), the special
  location (the gate's warp 2, facing south), the warp to area 6 (68, 116). State: `GameState.safari` {balls, steps,
  caught}; ops `vm/src/safari-ops.ts`.
- **Steps** (field_control.c Field_UpdateSafari, after the pedometer and before the daycare, not on forced
  movement): no balls left starts SAFARI_GAME 2; else the step counts and the 500th starts SAFARI_GAME 1. Platinum's
  limit is 500 steps; there is no timer. `world/src/safari.ts` `safariStep`.
- **End:** SAFARI_GAME 1 (time's up), 2 (out of balls, in the field), 9 (out of balls, after a battle), 21 (RETIRE),
  22 (no room) set state 2 and `start_end_safari_game 1`; the gate's on-frame table then walks the player out
  (state 2) or asks "exit early?" (state 1, back in the gate from the marsh). Five catches in a game give the
  Matchup Checker (`get_current_safari_game_caught_num`).
- **Start menu** (start_menu.c): in a game RETIRE comes first and SAVE (and CHAT) is hidden; a window shows
  "SAFARI BALLS / Stock: N". RETIRE closes the menu and starts SAFARI_GAME 21 (`menus/start-menu.ts`, `AppResult`
  `retire`).
- **Elsewhere:** Fly and Teleport refuse in a game (field_move_tasks.c PlayerInSafariZoneOrPalPark; game
  `field-moves.ts`) and their warps clear the flag (FieldSystem_SetFlyFlags / SetTeleportFlags; world `mapchange.ts`).
  Escape Rope and Dig clear it too (SetEscapeFlags), but the marsh's headers forbid the rope and Dig is not ported;
  the Explorer Kit (not ported) refuses. Roamers stay put on map changes in a game (roamers.ts). The TV bulletin and
  journal entry at the end are those systems' (a logged stub).

## Encounters and battles

- **Daily species** (great_marsh_daily_encounters.c): land slots 6 and 7 of each area take entry
  `(marshDaily >> 5·area) & 31` of encdata_ex member 10 (before the National Pokédex) or 9 (after). `marshDaily`
  (SpecialEncounter) is random at a new game and becomes the day's RecordMixedRNG value at each day change
  (`GameTime.marshDaily`, core `marshDailyOf`, `dailyEvents`). Only in a Safari Game (the binoculars always).
- **Safari battle** (BATTLE_TYPE_SAFARI): no send-out; the trainer stays; the Safari healthbox ("SAFARI BALLS",
  "Left: N"). Commands BALL, BAIT, MUD, RUN on the usual buttons. The player always acts first. Each turn the wild
  Pokémon first decides: flee when `rand % 255 ≤ safariFleeRate · f(escape)`; else "is watching carefully!".
  Catch stage and escape count start at 6 (×1), range 0–12 over the fractions 10/40 … 40/10.
  - Ball: one fewer; the catch rate × f(stage), ball ×1.5. Out of balls without a catch: "Game over!", the player's
    flight.
  - Bait: stage +1; escape +1 unless `rand % 10 == 0` ("busy eating").
  - Mud: escape −1; stage −1 unless `rand % 10 == 0` ("beside itself with anger").
  - Run always gets away (BATTLE_TYPE_NO_EXPERIENCE). No abilities, held items or statuses count.
- **After a battle** (encounter.c FieldTask_SafariEncounter): the balls come back, a catch counts; out of balls without
  a catch the map changes to the special location while the screen is black, then SAFARI_GAME 9; with a catch,
  SAFARI_GAME 2; a full party and PC, SAFARI_GAME 22.

## The quick trams

`great_marsh_tram.c`: the `great_marsh_train` prop at x 1056, y 16 and z 16·40 / 16·82 / 16·108 (areas 1–2, 3–4,
5–6), saved in the map features slot (`great-marsh`, starts at 5–6; a warp clears it, a connection keeps it).
The station menus (bg events) call the tram when it is elsewhere (it brakes in seven speed levels past a slow-down
tile) and ride it: the hidden player walks along the rail at speeds rising to FASTER and falling to SLOWER near the
station, the tram half a tile ahead. Its joint clip plays while it moves. `world/src/gyms/great-marsh.ts`.

## The binoculars

`great_marsh_lookout.c`, `great_marsh_binoculars.c`: $100, then five random spots of encdata_ex member 11 (36 marsh
tiles, drawn with replacement), each a temporary map change (no warp flags, no BGM, no location name) with the player
hidden: the circle fade opens on a front picture (80×80, frame 0) of one of the area's 12 land slots, uniformly,
with the daily and time-of-day replacements; 60 frames or A; the circle closes. The Pokétch is hidden meanwhile.
Then the player is back facing north and the screen fades in. `world/src/great-marsh-lookout.ts`; the app draws the
picture and the iris over the field (`World.lookoutView`).

## Mud

Already in the world: MUD and MUD_WITH_GRASS sink the sprite, MUD_DEEP(_WITH_GRASS) traps the player until five
direction presses (avatar.ts); bikes refuse mud; the battle terrain is the marsh's.
