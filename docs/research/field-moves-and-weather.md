# Field moves, terrain and weather

Decomp notes behind the HM obstacles, the bike, terrain and weather. Counts were measured on Platinum US rev0.

## HM obstacles

Obstacle scripts are in `res/field/scripts/scripts_field_moves.s`. Each checks `FindPartySlotWithMove` and the badge,
then asks yes/no.

| HM | Trigger (decomp) | Badge | Where |
|---|---|---|---|
| Cut | object `FieldMoves_CutTree` | FOREST | 49 trees, 14 zones |
| Rock Smash | object `FieldMoves_Rock`; the smash's encounter and item roll use the encounter PRNG stream | COAL | 590 rocks, 44 zones |
| Strength | object `FieldMoves_Boulder` sets `FLAG_STRENGTH_ACTIVE`; the push is native movement that reads the flag (`field_control.c`) | MINE | 49 boulders, 13 zones |
| Surf | A facing water → `Field_TileBehaviorToScript` → `FIELD_MOVES 4` → `use_surf` | FEN | 55 zones |
| Waterfall | A facing `WATERFALL` → `FIELD_MOVES 6` | BEACON | 55 tiles, 6 zones |
| Rock Climb | `PlayerAvatar_CanUseRockClimb` → `FIELD_MOVES 3` | ICICLE | 247 tiles |
| Defog | menu only: `do_defog_func` → `FLAG_DEFOG_ACTIVE`, weather CLEAR | RELIC | fog on 51 zones |
| Flash | menu only: `do_flash_func` → `FLAG_FLASH_ACTIVE`, weather CLEAR | none | `DARK_FLASH`, Wayward Cave 1F |

Menu moves go through a port of `FieldMoves_SetUsableMoves` (game `useFieldMove`): it reads the facing tile's
behaviour, the weather, the badges and the party's moves, then starts `FIELD_MOVES 8–15`.

**Clearing rules** (`field_map_change_flags.c`):
- `FLAG_STRENGTH_ACTIVE` clears on every map change.
- Flash and Defog clear only on a warp into a non-cave map.
- On a warp, surfing becomes walking, and cycling becomes walking when the map header disallows the bike.

## The bike

- The B button toggles the gear (`PlayerAvatar_TryCyclingGearChange`, `player_move.c`); it is ignored on ramps.
- Slopes need speed ≥ 3 (`player_move.c`): a run-up in gear 1 climbs, a standstill does not.

## Tile behaviours

Walkable behaviours beyond the basics, as tiles / zones:
- mud 4.3k / 7; snow 5.1k / 8; mountain floor 5.4k / 3;
- bridges 2k / 20+; bike bridges 223 / 4, slopes 34 / 5, ramps 24 / 4;
- ice 823 / 7; slides 58 / 1 (Fuego Ironworks);
- puddles 1.4k / 13; shallow water 346 / 5; reflective 444 / 5;
- very tall grass 1.1k / 3; warp panels 86 / 13; escalators 17.

## Weather

22 weather values are used across the 567 playable zones:

| Weather | Zones |
|---|---|
| clear | 434 |
| fog (14) | 51 |
| 29 | 32 (Mt. Coronet 4F–6F, Solaceon Ruins, Snowpoint Temple) |
| 27 | 12 (Old Chateau, Lost Tower) |
| CLEAR_13 | 6 |
| CLEAR_8 | 5 |
| 26 | 5 (Galactic HQ) |
| yearly | 5 (Routes 212 South, 213 and 216, Acuity Lakefront, Snowpoint) |
| 23 | 3 (Eterna Forest) |
| 28 | 3 (Stark Mountain rooms) |
| heavy snow, ashfall (Stark Mountain outside, Route 227), 30 | 2 each |
| cloudy, rain (Route 215), blizzard (Route 217), sandstorm (Route 228), dark Flash | 1 each |

How weather works on the DS:
- `FieldOverworldState.weather` is saved.
- It is set on every map change and connection crossing. Yearly values are resolved from the saved date.
- Script commands 0C3 and 0C4 set it to CLEAR.
- Defog and Flash eligibility and encounter rates read it.
- Fog is hard-coded per weather task in the 31-entry table in `ov5_021D5EB8.c`; `fog_manager.c` only applies it. Fog
  density is in DS depth units (slope and offset), mapped through the DS projection.
- Weather draws no simulation random numbers.

The DS draws weather particles with SPL. The engine draws its own particles from the decoded task parameters, so the
`weathers` registry carries particles, fog, light and the darkness radius. The dark-Flash circle is screen-space on
the DS; the engine pins it to the player at DS scale and darkens the extra width of wide screens.

Edge marking is on for field maps: `area_data.c` sets the indoor and outdoor edge tables.

## Field effects

The decomp has 39 `FIELD_EFFECT_RENDERER_*`. The engine draws those seen on common paths from the ROM's `fldeff`
models: grass rustle, the shadow model, ledge dust, footprints in sand and snow, splashes and ripples, the surf blob,
reflections, sinking into mud and snow, bike tracks, the Cut, Rock Smash and Strength animations, and warp panels.
The rest are logged as `render:fldeff-<n>`.
