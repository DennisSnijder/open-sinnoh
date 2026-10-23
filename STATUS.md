# Status

OpenSinnoh is in beta. Pokémon Platinum (US, rev 0) plays from a new game through the Elite Four, the Hall of
Fame and the credits, and on into the post-game. What's next is in [ROADMAP.md](ROADMAP.md); the design
decisions are in [docs/decisions.md](docs/decisions.md).

Versions: contracts 0.35.0, importer `platinum-96`, HeartGold follower add-on `hgss-followers-4`.

## Works

- **Story:** all 24 story checkpoints, from the new game to the post-game's Stark Mountain, are recorded as
  replays and pass headless (seeds 1–3, with a save round trip and late starts) and in the browser on desktop
  and phone. Every battle on the path is a real battle.
- **World:** DS movement, collision, terrain, warps, doors, stairs, ledges, NPC movement and trainer sight;
  HM moves and the terrain they open; every weather, fog, darkness and Flash; day and night on a real clock;
  gym puzzles; the Distortion World; Fly and Teleport; the Great Marsh and the Safari Game; ships and other
  cut-scenes. All 567 playable zones load; the browser sweep renders all but a few unused maps.
- **Script engine:** decodes every script; the story path's commands are implemented. Commands not yet
  implemented are logged once and counted by `pnpm opensinnoh coverage`.
- **Battles:** wild, trainer, double, multi and tag battles on @pkmn/sim with the ROM's data, the ported
  trainer AI, catching, the bag, switching, move learning, evolution, prize money and the blackout; the DS
  battle scene and touch card; the ROM's move animations (all but nine moves play for real; those use a logged
  fallback).
- **Menus:** the start menu, party, summary, bag, PC storage, Pokédex, trainer card, naming keyboard, marts,
  the Pokémon Center, the Pokétch (25 apps), Mystery Gift, the Day Care and eggs, the Hall of Fame and credits.
- **Side and post-game systems:** berries, move tutors, the move relearner and deleter, NPC trades, honey
  trees, the Poké Radar, swarms, the Trophy Garden, Poffins and Amity Square, the Underground's mining,
  vendors and fossil revival, legendaries, roamers and forms, the Battle Tower (singles, doubles, multi),
  the event legendaries through Mystery Gift, and the offline Super Contest circuit (reception, rivals, judging,
  results, ribbons, prizes, Master flags; the acting round as on the DS, the visual and dance rounds placeholders).
- **Audio:** the ROM's sound archive on a DS sequencer and synth in an AudioWorklet: zone music by day and
  night, sound effects, fanfares and cries.
- **App:** the ROM import in the browser, saves with file export and import, the setup, Options, following
  Pokémon and the optional HeartGold sprites, quality-of-life options, remappable controls, zoom,
  fast-forward, accessibility options, touch controls and an installable, offline-capable app.

## Not yet

- The Battle Frontier's other facilities (Factory, Hall, Castle, Arcade).
- The visual (dress-up) and dance contest rounds (placeholders today), the Villa, TV shows and the journal, Seals and Ball Capsules, the Underground's traps
  and secret bases.
- Wireless and Wi-Fi features: they answer as "no connection".
- Mods beyond the current pack format (no editor or mod tooling yet).
- HeartGold and SoulSilver as games (only the follower sprites are imported from HeartGold).

## Tests

- `pnpm check`: lint, typecheck, about 1,600 unit tests and the fixture replays, no ROM needed.
- ROM `pnpm test`: the importer, the story chain and every system replay against the real game.
- ROM `pnpm test:browser`: the app on desktop and phone viewports, incl. the story in the browser.
