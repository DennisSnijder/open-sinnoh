# Story CP20–24: replay findings and stub allowlists

The post-game checkpoints (`docs/testing.md`) chained from cp19's anchor (CONTINUE upstairs in Twinleaf), in
chunk `M6` (`tests/integration/anchor-key.ts`). The same rules as every checkpoint: seeds 1–3 twice with a save round
trip, late starts +1/+2/+5/+15, the anchor proof from a new game, a browser beat per CP (`story-m6.rom.spec.ts`,
desktop and phone), no setup lines except cp24's team raise.

## CP20: the Snowpoint ship and the Fight Area tag battle

- **Route.** Fly is not a field move yet (`packages/game/src/field-moves.ts`: Fly, Teleport and Dig are M3), so
  cp20 goes on foot and by bike: Twinleaf → Route 201 → Sandgem (round Dawn, who stands outside the lab after the
  credits) → Jubilife → Route 203 → Oreburgh → Cycling Road → Eterna → Route 211 → Mt. Coronet's north rooms
  (Rock Smash, Strength) → Route 216 → Route 217 → Snowpoint: CP13's way, minus the trainers and scenes it
  finished. About 15k ticks. Wild encounters are fled (`wild flee`).
- **The ship.** The S.S. Spiral's sailor (`SnowpointCity_SailorSSSpiral`, 356, 247) with `FLAG_GAME_COMPLETED`:
  Cynthia's first-trip scene, `FLAG_SAILED_TO_BATTLE_ZONE`, the boat to the Fight Area (623, 434).
- **The tag battle.** `FightArea_OnFrame_Rival` walks the player to Volkner and Flint; YES to Barry; type 75 with
  `TRAINER_RIVAL_FIGHT_AREA_PIPLUP` as partner against `TRAINER_LEADER_VOLKNER_FIGHT_AREA` and
  `TRAINER_ELITE_FOUR_FLINT_FIGHT_AREA`; then Palmer and Buck. `VAR_FIGHT_AREA_STATE 2`; no National Dex yet, so
  `FLAG_HIDE_FIGHT_AREA_BLOCKADE` stays 0. The team heals at the Fight Area's Pokémon Center and cp20 ends outside
  its door (647, 430). About 30k ticks in all.
- **Engine fix found here.** The partner AI replaced a fainted Pokémon with a stale commanded switch slot (already
  active), and the battle threw. The DS clears the AI's chosen switch after every action (BattleContext_Init), so at
  the post-KO pick a fainted battler has none; the controller now clears it for the battlers being replaced.

## CP21: the dex sweep to the National Pokédex (cp21a–f)

At cp19's end 165 of the 210 Sinnoh species are seen (seed 1; seeds 2 and 3 also lack Chansey and see Tentacruel by
chance). CP21 meets the rest in six parts, each well under 400k ticks, with wild Pokémon fought by the auto policy
(`wild auto`: seen, and out of the way) and every species that matters met deterministically on every seed: a
trainer battle, a scripted encounter, a preview, or an `until wild <species>` grind.

| Part | Ticks (s1–s3) | Route | Species (source) |
|---|---|---|---|
| cp21a | 77–92k | Fight Area ship → Snowpoint → Lake Acuity → Routes 217/216 → Mt. Coronet → Route 211 → Celestic → Route 210 → Café → Solaceon Ruins | Uxie (L50, defeated); Riolu (Luke), Glaceon (Lexie), Skorupi (Ethan), Dusclops (Garrett), Ambipom, Porygon2 (Blake), Sudowoodo (Maria), Snorunt (Madison), Swinub (Bjorn); Clefairy (Kati), Munchlax (Edwin), Togepi, Magby (Amber), Clefairy (Teri and Tia), Happiny, Elekid (Kahlil); Unown (grind) |
| cp21b | 93–98k | Solaceon → Route 209 (Lost Tower) → Hearthome → Route 212 (the Mansion) → Pastoria → Route 213 → Lake Valor → Route 214 → Veilstone | Barboach, Chatot (Oliver); Manaphy (the Mansion book's preview); Chatot again (Jeremy); Wooper (Sabrina); Tentacool (Paul); Finneon (Mary); Azelf (defeated); Vaporeon (Douglas), Porygon (Jamal), Yanma (Brady), Wormadam (Devon); Hippopotas, Rhyhorn (grinds) |
| cp21c | 64–71k | Route 214 → Valor Lakefront → Route 222 → Sunyshore → Route 223 → Victory Road → the League's south Pokémon Center | Magikarp, Finneon, Feebas (Brett); Lopunny (Nicola); Octillery (Colton, with Paige); Tentacruel (Ricardo); Togetic (Hana); Gengar, Gardevoir (Bryce); Rhydon (grind) |
| cp21d | 20–24k | down the waterfall, Route 223 → Sunyshore → Route 222 → Route 213 → Pastoria → Route 212 → Hearthome → Route 209 | Chansey (grind) |
| cp21e | 20–25k | Route 208 → Mt. Coronet 2F → Route 207 → Cycling Road → Eterna → Eterna Forest → the Old Chateau | Combee (Hannah); Medicham (2F grind by day); Rotom (the TV at night) |
| cp21f | 29–36k | Eterna Forest → Route 205 → Route 204 → Jubilife → Route 218 → Route 202 → Sandgem → Route 201 → Lake Verity → Rowan's lab | Kricketot (Brandon); Kricketune (Tony); Mesprit (Verity Cavern's preview) |

- **Night for Rotom.** The Old Chateau's TV wakes only at night (`GetTimeOfDay` ≥ night). cp21e steps the frozen
  clock on with one timed `+0 time 20:00` line before Cycling Road: time passing, not a forged state (coordinator,
  2026-10-18). It logs `clock:timed-events` once (honey trees and the TV slot are not modelled; the berry patches grow since 2026-10-19).
- **Route choices forced by the map.** Route 215 eastbound goes under and over its bridges (the drafting path tool
  missed it then; fixed on main since), and Route 216's snowfield is reached only by the Rock Climb wall at x 323,
  so cp21a/b take other trainers and the long way round by Routes 209, 212, 213 and 214. Cut goes to Garchomp
  over Fire Fang in cp21b (two cut trees close Route 212 South's bike bridge; the Old Chateau's and Eterna Forest's
  trees later). Victory Road's low corridor (Bryce) is a one-way drop with a Rock Climb wall back up at x 18.
- **Look-around and walking trainers** are met by waiting in their line (`until message`), never by passing at a
  lucky moment; pairs facing each other are met together (`trainer-pair`) or one by talking from outside the
  other's reach (Jeremy).
- **The National Pokédex needed an engine fix:** the town `FLAG_FIRST_ARRIVAL_*` flags were never set, so Rowan
  took the rating branch at 210 seen (`docs/decisions.md` 2026-10-18, "Town first-arrival flags set on map entry").
- **Safari (the Great Marsh)** is still a stub: no species on the route depends on it.

## CP22: Stark Mountain (Mars and Jupiter, Buck's tag battle, Charon's arrest)

cp22 (99–109k ticks on seeds 1–3) goes from Rowan's lab north to Snowpoint (cp20's way, wild Pokémon fled), by ship
to the Fight Area, then fights wild Pokémon with the auto policy over Route 225, the Survival Area (a PC heal),
Routes 226 and 227 to Stark Mountain.

- **Route 225.** Audrey and Ashlee face each other with look-around turns; Audrey is met alone (step in as Ashlee
  turns east), then Ashlee by waiting in her line. Dwayne and Rodolfo are met by waiting in their lines.
- **Route 226:** Rock Climb down at x 690, up at x 700, down at x 705, Geneva waited for at (705, 331), Surf east
  past Lydia to the shore by the Route 228 gate.
- **Route 227 needs the bike's ramps.** From the shore's north pocket the only way on is two westward
  `BIKE_RAMP_WESTWARD` jumps in gear 1 (x 760 and x 753, three tiles each, at speed 3); Saul and Felicia's ledges are
  passed outside their lines, Crasher Wake and Barry's scene fires at (738, 306), Buck's question at the north end of
  the x 758 bike bridge. Griffin (looks south or east) is talked to from the west; the Rock Climb wall at x 756
  leads to Stark Mountain's outside, where the grunts' scene fires at (752, 235).
- **Room 1:** Mars and Jupiter as soon as the room loads, then Strength through the boulders at x 26, round by x 32,
  the boulder at (27, 13) four pushes west, Rock Smash at (11, 11), the boulder at (18, 9) three pushes east.
- **Room 2:** Buck joins at (42, 69). With a partner, Rock Climb is refused (`cannot be used here (partner)`, as the
  DS), so the way is Strength and Rock Smash only: the boulder at (53, 52) seven pushes north, Rock Smash at
  (41, 15), the tag battle against Drake and Jarrett at (16, 22) (`ai-partner`), the boulder at (29, 12) nineteen
  pushes east, and Buck goes on alone at (47, 3). Wild Pokémon in room 2 are double battles beside Buck.
- **Room 3:** Charon and the Magma Stone, Looker's arrest; outside, Buck goes home (outside state 3).

## CP23: Buck at the Battleground, Heatran, Routes 228–230, the Resort Area, Snowpoint Temple

cp23 is two parts. cp23a starts at Stark Mountain's door and ends in front of Heatran, after Buck's talk; the
`m6-heatran-*` branches start from its anchor. cp23b fights Heatran, takes Routes 228–230, goes down Snowpoint
Temple to B5F and back up, and ends healed at Snowpoint's Pokémon Center, cp24's way to the League.

- **Buck.** He waits in front of the Battleground in the Survival Area after Charon's arrest. Talking to him there
  sends him inside; the Battleground's owner greets the player at the door. Talking to Buck inside sets
  `FLAG_TALKED_TO_BATTLEGROUND_BUCK`, which shows Heatran in room 3.
- **Back up Stark Mountain** the same way: Route 226's walls and Surf, Route 227's ramps. The ramp landing leaves the bike
  in gear 1, so gear 0 is taken on the plateau before the x 758 bridge. The boulders are back in place in room 1, so it
  is cp22's solution again. Room 2 is alone this time, so Rock Climb at x 52 is allowed. Skylar and Natasha's
  double battle is `trainer-pair`.
- **Heatran (L50)** is fought and defeated by the auto policy (`FLAG_BATTLED_...`, not caught). The way down
  reverses rooms 2 and 1 with the boulders back in place: room 2 by the x 52 wall and Rock Smash at (60, 53); room
  1 by the boulder at (18, 9) seven pushes west, (27, 13) three pushes east, (26, 16) four pushes west.
- **The team was spent** by Stark Mountain with no Pokémon Center between. Route 228's trainers knocked out
  four of five Pokémon and Felix and Dana won once, so cp23 goes back west to the Survival Area's Pokémon Center
  and flees wild Pokémon from there on. A bag block (Revives and Full Restores on the first four, no effect where
  none is needed) runs before each trainer fight. The auto policy loses ground against these postgame trainers;
  that matters for cp24.
- **Route 228:** the slope at x 791 is climbed in gear 1 from two tiles below. Krista and Kyler (row 375) are a
  `trainer-pair`, Meagan a single. On Route 229, Felix looks west or east next to Dana: wait at (799, 431) for
  Felix to face east, then step in for their `trainer-pair`.
- **Route 230 under a Max Repel.** Its swimmers walk fixed loops. With no wild battles on the way, the player
  passes them at the same moment on every seed, and the surf route crosses no swimmer's line. The Max
  Repel then wears off in Snowpoint at a fixed step count.
- **Snowpoint Temple:** the guard's coord event at (366, 198) brings Candice, who lets the champion in. 1F to B5F
  is the `sys-snowpoint-temple` walk. The way back up runs each floor's ice the other way, a shortest path that
  models the slides.

## CP24: the set team raised, the Elite Four and Cynthia's rematches, Hall of Fame entry 2

cp24 (96–99k ticks on seeds 1–3) starts with its one setup step (`docs/decisions.md` 2026-10-18, "Set team raised for the
rematches": Garchomp, Luxray and Staraptor to 85) and walks from Snowpoint's Pokémon Center to the League with wild
Pokémon fled.

- **The way:** Routes 217 and 216 (the path tool's way), Mt. Coronet to Celestic and Route 210 (cp21a's lines),
  Solaceon, **Route 215** east to Veilstone, then cp21c's way (Route 214, Valor Lakefront, Route 222, Sunyshore,
  Route 223's surf and waterfall), and cp17's way through Victory Road to the north Pokémon Center. Lines copied from
  earlier CPs drop their trainer battles, since those trainers were beaten.
- **Route 215's trainers were never met** (cp21 went round it). Under Max Repels bought at Solaceon's Mart (two used
  on the route at fixed step counts), its joggers walk their loops in step with the player on every seed, and the path
  crosses no trainer's line.
- **Route 212 North at night is avoided:** the frozen clock has stood at 20:00 since cp21e, so the night-only
  policemen are out there.
- **Rematches:** the door guard already stood aside. The four rooms are cp18's lines with the `_REMATCH` trainers,
  with a bag Revive and Full Restore block before each room, then Cynthia's rematch (the beat `cynthia-rematch` at
  her first command), the Hall of Fame (`hallOfFame.total` 2), the credits, the reset, and CONTINUE upstairs in
  Twinleaf.

## Stub allowlist

Each replay's stubs, by seed (`STUBS` in `tests/integration/checkpoints-m5a.ts`); a run that meets an unlisted stub
or misses a listed one fails.

| Replay | Stub | Seeds | Reason |
|---|---|---|---|
| cp20 | `battle:wild-flee` | 1–3 | Wild Pokémon met on the way are fled (the replay's mode, as cp15–17). |
| cp20 | `render:hm-cut-in` | 1–3 | Rock Smash and Strength in Mt. Coronet: the HM cut-in graphic is not drawn (shared, as M5). |
| cp20 | `anim:platinum:MOVE_SURF` | 1–3 | Empoleon's Surf in the tag battle: its animation is deferred (story-cp5-19.md). |
| cp20 | `stub:create_journal_event` | 1–3 | The journal (owned elsewhere, as M5). |
| cp21a–f | `render:hm-cut-in`, `anim:platinum:MOVE_SURF`, `stub:create_journal_event` | 1–3 | As cp20. |
| cp21a | `anim:platinum:MOVE_EXTRASENSORY` | 2 | Uxie's Extrasensory: its animation is deferred (story-cp5-19.md). |
| cp21b, cp21c | `stub:check_tv_interview_eligible` | 1–3 | The TV interviewer in a Pokémon Center (TV, owned elsewhere). |
| cp21e | `clock:timed-events` | 1–3 | The frozen clock stepped to 20:00: berries, honey trees and the TV time slot are not modelled. |
| cp22 | `battle:wild-flee`, `render:hm-cut-in`, `anim:platinum:MOVE_SURF`, `stub:create_journal_event` | 1–3 | As cp20 (the way north flees; Surf and the HMs on the way). |
| cp22 | `anim:platinum:MOVE_EXTRASENSORY` | 3 | A wild Pokémon's Extrasensory: its animation is deferred (story-cp5-19.md). |
| cp23a | `render:hm-cut-in`, `anim:platinum:MOVE_SURF`, `stub:create_journal_event` | 1–3 | As cp20 (Surf, Rock Climb, Strength and Rock Smash). |
| cp23b | `battle:wild-flee`, `render:hm-cut-in`, `anim:platinum:MOVE_SURF`, `stub:create_journal_event` | 1–3 | As cp20 (wild Pokémon fled after the second heal). |
| cp24 | `battle:wild-flee`, `render:hm-cut-in`, `anim:platinum:MOVE_SURF`, `stub:create_journal_event` | 1–3 | As cp20. |
| cp24 | `stub:check_tv_interview_eligible`, `stub:mystery_gift_give` | 1–3 | Pokémon Center side systems (the TV interviewer, the deliveryman), as cp21b and cp12. |
