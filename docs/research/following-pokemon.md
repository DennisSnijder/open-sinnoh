# Following Pokémon: what Platinum has, what HGSS adds

Question (2026-10-15): which Pokémon overworld sprites does the Platinum ROM hold, and do we need
HeartGold/SoulSilver for HGSS-style following Pokémon? Short answer: **Platinum has full walking sets for
24 species (Amity Square's walkers plus a few story Pokémon); every other species needs HGSS art or our own.**

Sources: pokeplatinum `generated/object_events_gfx.txt`, `src/overlay005/object_event_gfx_data.c`,
`res/field/scripts/scripts_amity_square.s`; pokeheartgold (fork `ctrl-cheeb-del/pokeheartgold`, read for
names and understanding only) `src/follow_mon.c`, `src/field/field_follow_mon.c`,
`src/field/follow_mon_interaction.c`, `src/map_object_follow_player.c`,
`files/fielddata/tsurepoke/tp_param.csv`, `include/constants/follow_mon_idx.h`, `src/data/map_headers.h`.
Platinum counts were measured on the US ROM with our own readers (overlay 5 gfx tables → `mmodel.narc`
TEX0). HGSS sizes were measured the same way. No ROM data is reproduced here.

## 1. Platinum

Overworld characters are NSBTX frame sets in `/data/mmodel/mmodel.narc` (members 0–420), drawn on a
billboard (graphics-formats.md §3.1). Overlay 5 maps each object gfx to a set, a billboard model and a
frame table. A walk set is 16 textures of 32×32: 4 directions × 4 frames (the stand pose and 3 walk poses).
It uses the generic walk sequence (member 445). Each Pokémon set has one palette (Giratina-Origin has two). **There are no shiny
palettes and no female variants.**

### Full walking sets (usable as followers): 24 species, 28 sets

All of these are 32×32, 16 textures, with walk N/S/W/E (`sWalkBillboardAnims`):

| gfx | Species | Where the game uses it |
|---|---|---|
| 71 PIKACHU, 72 CLEFAIRY, 73 JIGGLYPUFF, 74 PSYDUCK, 78 TORCHIC, 79 SKITTY | 6 | Amity Square follower (and Amity NPC pets) |
| 185 DRIFLOON, 204 PACHIRISU, 205 SHROOMISH, 206 BUNEARY, 207 HAPPINY | 5 | Amity Square follower |
| 220–228 TURTWIG … EMPOLEON (all three starter lines) | 9 | Amity Square follower (new in Platinum) |
| 208 MACHOP, 229 CROAGUNK, 158 SHAYMIN (Land) | 3 | Story NPC objects; not Amity followers |
| 237–241 ROTOM_HEAT/FAN/FROST/WASH/MOW | 1 (5 forms) | Rotom's room objects; **no base-form Rotom** |
| 236 PIKACHU_UNUSED | — | The same bytes as gfx 71 |

The Amity Square follower is a real Platinum follower. `AmitySquare_SetFollowerGfx` maps 20 species to these
gfx through `VAR_OBJ_GFX_ID_0`: the 11 non-starter Amity species plus the 9 starter-line species. The
follower then gets `SetHasPartner` and `MOVEMENT_TYPE_FOLLOW_PLAYER`.

### Partial sets (not usable as walking followers): 13 species

| gfx | Species | Size | Textures | Animation |
|---|---|---|---|---|
| 151–153 UXIE, MESPRIT, AZELF (+264–267 Distortion World copies) | 3 | 32×32 | 2 | 2-frame float loop, one facing |
| 157 DARKRAI, 159 CRESSELIA, 161 HEATRAN | 3 | 32×32 | 2 | 2-frame slow loop |
| 154 DIALGA, 155 PALKIA, 156 ARCEUS, 160 GIRATINA_ALTERED | 4 | 64×64 | 2 | 2-frame loop |
| 230 GIRATINA_ORIGIN | (Giratina) | 128×64, special billboard model | 2 (2 palettes) | 2-frame loop |
| 184 REGIGIGAS | 1 | 64×64 | 1 | static |
| 173 STARLY | 1 | 32×32 | 4 | 2 flying loops (not directional walking) |
| 195 MAGIKARP | 1 | 32×32 | 2 | flop loop |

12 `DUMMY_*` gfx (57, 58, 61, 66, 67, 75–77, 80, 146, 147, 162) point at one placeholder set ("ketsuban").
They are not Pokémon.

**Totals: 37 of 493 species have any overworld sprite. 24 have a full 4-direction walking set (4.9 %),
and Rotom has only its appliance forms.** The only `mmodel` set no gfx references is a water splash, so there are no hidden
Pokémon sets. Our importer already converts the walk sets as `platinum:SPRITE_<mmodel>`.

## 2. HeartGold/SoulSilver

- **Art:** `mmodel.narc` (ROM path `/a/0/8/1`), members 297–862 = **566 follower sets**. A species maps to its
  first set via `sModelIndexLUT` (`SpeciesToOverworldModelIndexOffset`, follow_mon.c). Sprite ids are
  `SPRITE_FOLLOWER_MON_BULBASAUR` (428) to `SPRITE_FOLLOWER_MON_ARCEUS_DARK` (993), and the index names are in
  `constants/follow_mon_idx.h` (`FOLLOWER_MON_*`).
- **Coverage:** **all 493 species**, plus 61 form sets and 12 female sets (493 + 61 + 12 = 566).
  - Forms (`sFormMaxLUT`): Pichu spiky-eared (+1), Unown (+27), Deoxys (+3), Burmy (+2), Wormadam (+2),
    Shellos (+1), Gastrodon (+1), Rotom (+5), Giratina Origin (+1), Shaymin Sky (+1), Arceus (+17).
  - Female sets (`sFemaleFlagLUT`): Venusaur, Pikachu, Meganium, Girafarig, Steelix, Heracross, Combee,
    Garchomp line ×3, Hippopotas, Hippowdon.
  - Castform and Cherrim have no form sets.
  - `FollowMon_GetSpriteID` picks the female set, or the base set plus the form (an out-of-range form
    falls back to 0).
- **Format (measured):** every set has 8 textures (4 directions × 2 frames), 4bpp palette16 (the same TEX0
  family we already decode) and **2 palettes: 0 normal, 1 shiny**. `MapObject_IsShinyPokemon` reads bit 0 of
  object param 2. Each direction’s two frames alternate continuously while unpaused, so the follower bobs while it
  walks and while it stands (verified in §2a). The billboard sequence is `BILLBOARD_SEQUENCE_FOLLOW_MON` (plus an `_ALT` variant).
- **Size classes:** 535 sets are 32×32 and 31 are 64×64, matching `too_tall` in `tp_param`:
  - Steelix (both), Lugia, Ho-Oh, Wailord, Kyogre, Groudon, Rayquaza, Dialga, Palkia, Regigigas
  - Giratina (both forms)
  - Arceus (all 18 types)
- **Per-set parameters:** `tp_param.narc` (`/a/1/4/1`), 4 bytes per set: `too_tall`, a 4-bit shape value
  (`unk2_0`, 79 sets), `hover` (179 sets: fliers and floaters; no hop) and two unused fields. These feed
  object params 1 and 2 and the hop height (`FollowMon_GetHopHeight`).
- **Where it may follow:** each map header has a follow mode. Over 540 maps: **178 ALLOW, 320
  HEIGHT_RESTRICT** (mostly indoors: the 31 tall sets cannot follow there), **42 PREVENT**. Diglett and
  Dugtrio are refused in Bell Tower (`FollowMon_DiglettPermissionCheck`). The follower is always the first
  alive party member.
- **Movement:** the follower is map object `obj_partner_poke` with `gFollowMonFollowPlayerStates`
  (start, moving, hop, wait; map_object_follow_player.c). It queues the player's steps
  (`FollowMon_QueuePlayerStep`) and speeds up through slow, step, run and fast movements
  (`FollowMon_GetFasterMovement`). It hops ledges (`gFollowMonHopHeights`). Other rules:
  - **Bike and Surf:** the follower is hidden and switched to movement 56 (`FollowMon_InitMapObject`,
    `FollowMon_Hide`). It reappears on a step (`FollowMon_HideUntilStep`).
  - **Warps:** a map change re-creates it next to the player (`FollowMon_RecreateForMap`).
  - **Lead changes:** `FollowMon_ChangeMon` swaps it.
  - **Field moves:** it hops into its ball (`Task_FollowMonHopIntoBall`, `Task_FollowMonHideForFieldMove`).
- **Talking to it:** std script 9700 (`scr_seq_0163`: face the player, `FollowMonInteract`, cry, emote
  bubble, hop on spot). `follow_mon_interaction.c` builds a situation from these:
  - the Pokémon's held item, HP, status, level, mood and friendship
  - nearby objects, hidden items, weather, terrain, map, time of day, facing
  - type and species attributes, its best Pokéathlon stat, Shiny Leaves

  The situation is matched against 100 rules: 30 per map section from `/a/2/2/0`, then 12 global ones.
  The winning rule picks a step script from `/a/2/2/1` (≤ 5 steps of movement, emote, message and wait).
  Messages are in msg 0265 (759 lines).
  - **Mood:** `FollowMonMood_*` keeps it in the mon's `MON_DATA_MOOD` (−127..127, drifting to neutral).
  - **Item gifts:** the follower can pick up items and Pokéathlon-style accessories.

## 2a. Idle animation verified (2026-10-16)

Read for behavior and names only; no reference code or assets copied.

- **HGSS really animates while idle.** At pokeheartgold commit `3215038a8095761395c20a62ae533b841ef0ea2f`,
  [`src/field/map_object_billboard_motion.c:507–527`](https://github.com/ctrl-cheeb-del/pokeheartgold/blob/3215038a8095761395c20a62ae533b841ef0ea2f/src/field/map_object_billboard_motion.c#L507-L527)
  updates the follower’s facing and billboard each draw without checking movement.
  [`src/field/map_object_models.c:69–113`](https://github.com/ctrl-cheeb-del/pokeheartgold/blob/3215038a8095761395c20a62ae533b841ef0ea2f/src/field/map_object_models.c#L69-L113)
  selects the facing sequence, resets on a turn and advances one frame when unpaused; it also applies
  the two-pixel bob on the bob frame. Standing still does not pause that sequence: the idle paths in
  [`src/map_object_follow.c:138–171,229–238`](https://github.com/ctrl-cheeb-del/pokeheartgold/blob/3215038a8095761395c20a62ae533b841ef0ea2f/src/map_object_follow.c#L138-L171)
  leave the billboard running. The pause check at `src/field/map_object_models.c:407–415` reads explicit
  pause flags, rather than whether the follower has a step in progress.
- **Platinum’s standing walking-set NPC holds its frame.** At pokeplatinum commit
  `fe1ea418a7364c93daf0d07ae55e195452d8803c`,
  [`src/overlay005/ov5_021EB1A0.c:233–259`](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay005/ov5_021EB1A0.c#L233-L259)
  dispatches the NPC’s animation code; its zero entry at lines 483–494 calls the standing handler at
  [lines 310–321](https://github.com/pret/pokeplatinum/blob/fe1ea418a7364c93daf0d07ae55e195452d8803c/src/overlay005/ov5_021EB1A0.c#L310-L321).
  A turn starts the facing sequence at frame zero; otherwise it aligns to a standing foot and advances
  by zero. The alignment at lines 1485–1501 rounds down to a multiple of eight.
- **OpenSinnoh policy:** Still is the default for either art source: `stand-<facing>` at tick zero even
  when the imported standing sequence has multiple frames. Walk in place is an optional device setting
  under OPTIONS > PLAY > FOLLOWER STYLE. Moving followers retain their set’s walk/loop timing.

## 3. Options

All four need the same behaviour layer (section 4). The estimates below cover sprites and import only.

| Option | Species | Quality | Effort |
|---|---|---|---|
| (a) Platinum only | 24 (Amity's 20 + Machop, Croagunk, Shaymin-Land, Rotom forms) | ROM art, 4-frame walk, no shiny | ~1 day: map species → gfx (the Amity table plus 4) and pick the existing sprite records |
| (b) Generated fallback | all | Poor | ~2–3 days |
| (c) HGSS as a second import | all 493 + forms + female + shiny | ROM art, the HGSS look | ~4–5 days for an import of the follower sets only |
| (d) Mod packs with original art | whatever is drawn | as drawn | engine ~1 day once (c)'s record exists; the art is the real cost (566 × 8 frames, ×2 palettes) |

- **(b) Generated fallback.** Two sources, both poor:
  - **Menu icons** are 32×32, 2 frames and front-facing only. They have no back or side views and only 3
    shared palettes. Mirroring gives one side view; "up" would reuse the front or a tinted back.
  - **Battle sprites** (80×80 front and back) give a real front and back. Scaled to 32 they blur, there is
    still no side view, and there is no walk cycle. A bob or squash animation is the best we can do.

  Usable as a "something rather than nothing" option, not as HGSS-style art.
- **(c) HGSS as a second import.** The file families are the same: NitroFS, NARC, BTX0 with palette16.
  `readTex0` and `buildSpriteAtlas` already read them (we measured these sets with them). The importer needs:
  - the HGSS US SHA1s (from pokeheartgold `heartgold.us/rom.sha1`, `soulsilver.us/rom.sha1`) in
    `SUPPORTED_ROMS`
  - an import of `/a/0/8/1` members 297–862, plus the follower frame sequence among the 17 sequence
    members (280–296)
  - `/a/1/4/1` (`tp_param`)
  - the species → set index: it can be rebuilt from the form and female lists above (names only) or read
    from the ROM's LUT
  - 8-texture and 64×64 atlases (64×64 already works for Dialga and Palkia)
  - shiny as a second atlas or palette swap

  Keep it optional: a separate "HGSS followers" pack in IndexedDB, keyed by the HGSS SHA1, loaded after the
  Platinum base pack. The game falls back to (a) without it. **Legal:** the player must own and supply their
  own HGSS ROM, the same bring-your-own rule as Platinum. Nothing from it is committed or distributed.
  Beyond the sprites, the HGSS ROM also carries the interaction rules, steps and texts. Those are a larger
  piece of HGSS logic, and they belong with the HGSS base pack (see `ROADMAP.md`).
- **(d) Mod packs.** Needs a follower sprite record keyed by species, form and gender (shiny as a palette
  or atlas) with a size class, so packs can add or override sets.

## 4. What our engine has, and what is missing

**Has** (packages/world):
- The story follower: any actor with `MOVEMENT_TYPE_FOLLOW_PLAYER` while `state.hasPartner`
  (`world.ts follow()`).
- On each player step it walks into the player's previous tile with the same ticks. When it is not adjacent
  it snaps there (logged `follower-snap`).
- The player may step into its tile (`avatar.ts partner()`).
- It persists across zones with its sprite and talk script in `GameState.follower`.
- The bicycle is refused with a partner (`bicycleCheck → 'partner'`).
- It draws as an ordinary billboard actor from its sprite record. The var-gfx sprite lookup (`spriteFor`)
  covers Amity's `VAR_OBJ_GFX_ID_0`. `set_has_partner` is real.
- The Amity Square ops (step count, accessory and berry picks) are stubs. Amity's follower is not covered by
  a replay or test.

**Missing for party followers:**
- Spawning from the lead party Pokémon outside scripts, with re-pick on faint or reorder and re-create
  behind the player after warps.
- Sprite choice by species, form, gender and shiny, a size class, and the idle bob.
- Movement rules:
  - catch-up speeds and ledge hops (we snap instead)
  - hide on Surf and Bike, reappear on the next step (we refuse the bike instead)
  - hide for field moves, Fly and Dig
  - a per-map permission: Platinum maps have no follow mode, so we need our own rule, e.g. indoor or
    tall → HEIGHT_RESTRICT
- Talking to it: face the player, cry, emote bubble, messages. Mood and friendship reactions are HGSS data
  (option c), or our own rules for Platinum.
- A GameState field for the follower toggle and mood, and the contract for follower sprite records.
  Both are contract changes.

## Recommendation

Build the follower behaviour once against a follower-sprite record. Then fill it in layers:

1. Platinum's 24 walking species now, with no follower for the rest.
2. The optional HGSS import for all 493 with shiny, which also serves the HGSS base pack. When it is present, use its sets
   for every species, so the art style stays consistent.
3. Mod packs as overrides.

A generated fallback only if every species should to follow before HGSS lands. Yes: for
Nintendo-drawn follower art beyond those 24 species, HGSS is required.
