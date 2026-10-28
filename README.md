<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/wordmark-dark.svg">
    <img src="docs/brand/wordmark-light.svg" alt="OpenSinnoh" width="464" height="88">
  </picture>
</p>

<p align="center">
  An open-source reimplementation of the Nintendo DS Pokémon games, Platinum first, playable in the browser.
</p>

<p align="center">
  <a href="https://play.opensinnoh.com"><b>Play</b></a> ·
  <a href="https://opensinnoh.com">Website</a> ·
  <a href="https://discord.gg/DHKCWq9WkF">Discord</a> ·
  <a href="STATUS.md">Status</a> ·
  <a href="ROADMAP.md">Roadmap</a>
</p>

OpenSinnoh is an engine, not an emulator. It reimplements the game's systems in TypeScript (the
overworld, the script engine, battles, menus, audio) and runs them on the data of Pokémon Platinum. It plays
in any modern browser on desktop and phone, with keyboard, gamepad or touch, and can be installed as an app.

**Bring your own ROM.** This repository and the website ship no game code, graphics, text, music or data.
You choose a dump of a cartridge you own; the importer converts it inside your browser, and the result and
your saves stay on your device.

## Status

Beta. The whole of Pokémon Platinum is playable on real game data, from the new game to the Elite Four, the
Hall of Fame and the credits, then on into the post-game:

- **Story:** every story event, gym and rival fight, the Galactic storyline, the Distortion World and
  Giratina, the Elite Four and Cynthia, the Hall of Fame and the credits.
- **Battles:** wild, trainer, double and tag battles on the Pokémon Showdown simulator with Platinum's data
  and trainer AI, the DS battle scene and touch command card, and the move animations from the game's own
  animation scripts.
- **The world:** all of Sinnoh with the DS's movement, terrain, weather, day and night, HM moves, gym puzzles,
  Fly, the Great Marsh and the Safari Game, berries, honey trees, the Poké Radar, swarms, the Underground's
  mining, Poffins and Amity Square, eggs and the Day Care, the Pokétch with all 25 apps.
- **Post-game:** the National Pokédex, Stark Mountain, the Battle Tower (singles, doubles, multi with a
  partner), legendaries and roamers, and the event legendaries through Mystery Gift with gift codes.
- **Quality of life (optional):** following Pokémon (with HeartGold's follower sprites as an add-on imported
  from your own HeartGold ROM), auto-run, fast-forward, a registered-item wheel, the repeat-Repel prompt,
  EV/IV view, renaming from the summary, a Pokédex name search, a suspend point, remappable controls, zoom,
  and accessibility options (reduce flashing, screen-reader announcements).
- **Mobile:** a single-screen layout made for phones in portrait and landscape, touch controls, offline play
  after the first visit.

Still to come: the other Battle Frontier facilities, Contests, the Underground's traps and secret
bases, Wi-Fi features (answered as "no connection"), modding tools, then HeartGold and SoulSilver. See
[STATUS.md](STATUS.md) for the current state and [ROADMAP.md](ROADMAP.md) for what's next.

## Supported ROMs

| Game | Region and revision | SHA-1 of the whole `.nds` file | Use |
|---|---|---|---|
| Pokémon Platinum | US, rev 0 | `ce81046eda7d232513069519cb2085349896dec7` | The game |
| Pokémon Platinum | Europe (English), rev 10 | `6b1bd310a0f7293b0d6b260cc6684183146270cc` | The game |
| Pokémon Platin-Edition | Germany, rev 0 | `5d009a175c77d4387cde26d34efb71aee825a938` | The game, in German |
| Pokémon HeartGold | US, rev 0 | `4fcded0e2713dc03929845de631d0932ea2b5a37` | Optional follower add-on |

Other dumps are refused with a message. The list lives in `packages/nds/src/supported-roms.ts`.

## Development

Requires Node 24 and pnpm 10 (`corepack enable` picks the pinned pnpm version). No ROM and no environment
variables are needed to build, test or run the fixture game.

```sh
pnpm install
pnpm dev          # the dev server with the original fixture pack and a demo mod
pnpm check        # lint, typecheck, unit tests and fixture replays (the merge gate without a ROM)
pnpm build        # the static production build in dist/
pnpm site:dev     # the opensinnoh.com landing page
```

`pnpm dev` prints two URLs. The **Packs** URL (`http://127.0.0.1:5173/?packs=fixture,demo-mod`) starts the
small original fixture game. The plain URL opens the ROM page; to play your own ROM in development, import
it there as a player would.
Add `?debug=1` to the URL for the developer tools overlay (warp, flags and vars, items, Pokémon, clock); see
[docs/development.md](docs/development.md). Deploying: [docs/deploying.md](docs/deploying.md).

### Tests

- **Unit and fixture tests** (`pnpm check`) use only original fixture data (`packs/fixture`) and bytes made by
  our own writers. They need no ROM.
- **ROM tests** read the ROM path from `OPENSINNOH_NDS_ROM` and are skipped without it. They share one cached
  import in `.opensinnoh-cache/` (gitignored, never committed).

  ```sh
  OPENSINNOH_NDS_ROM="/path/to/platinum.nds" pnpm test
  ```

- **Browser tests** (Playwright) run the real app on desktop and phone viewports:

  ```sh
  pnpm test:browser tests/browser/app-shell.spec.ts                       # one spec, no ROM
  OPENSINNOH_NDS_ROM="/path/to/platinum.nds" pnpm test:browser             # the full suite
  pnpm test:browser:changed                                                # specs touched by your change
  ```

- **Replays** play scripted inputs headless and assert on the game state: the story checkpoints from a new
  game to the credits, and per-system replays (`tests/rom-replays/`, `packs/*/replays/`).

More in [docs/testing.md](docs/testing.md) and [docs/browser-tests.md](docs/browser-tests.md).

### Repository layout

| Path | What it is |
|---|---|
| `packages/contracts` | The shared types and interfaces between packages (versioned, see `docs/contracts.md`) |
| `packages/core` | IDs, the PRNG, the clock, the replay format and the game rules that need no I/O |
| `packages/nds` | ROM containers (NitroFS, NARC), compression and the supported-ROM list |
| `packages/importer` | Converts a ROM into a pack: records, scripts, models, textures, sprites, audio |
| `packages/g3d` | DS 3D models and animations (NSBMD, NSBTX, BCA and friends) to glTF |
| `packages/text` | The game's fonts and text layout |
| `packages/vm` | The script engine (Platinum's script commands and the Battle Frontier's) |
| `packages/world` | The overworld simulation: movement, collision, NPCs, warps, terrain, weather |
| `packages/render` | The three.js renderer for the field and the DS 3D pipeline's look |
| `packages/battle` | Battles: the simulator adapter, the controller, trainer AI, move animations |
| `packages/services` | Game services: marts, the PC, the Day Care, berries, Mystery Gift, the Battle Tower |
| `packages/menus` | Headless models of the game's menus and screens |
| `packages/audio` | The DS sound archive: a sequencer and synth in an AudioWorklet |
| `packages/game` | The game: state, the loop, saves, packs and mods, the replay runner |
| `packages/ui` | OpenSinnoh's own design system and brand (`docs/design-system.md`) |
| `packages/app` | The browser app: the ROM page and import worker, screens, input, storage, telemetry |
| `packages/cli` | The `opensinnoh` command: dev server, replays, sweeps, script coverage |
| `packs/` | The original fixture pack, a demo mod and a Platinum demo mod |
| `site/` | The opensinnoh.com landing page |
| `tests/` | Integration, ROM, replay and browser tests |
| `tools/` | Scripts for fixtures, performance budgets, brand assets and test tooling |
| `docs/` | Design decisions, research notes, the contracts and the design system |

`reference-projects/` is not part of the repository: it is a gitignored, local-only checkout of reference
material (the pret decompilations) that some contributors keep for names and offsets.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md), then [AGENTS.md](AGENTS.md): it has the hard rules (no ROM
content, ever), the code style and the checks to run, for people and AI assistants alike. [docs/decisions.md](docs/decisions.md) explains the design
decisions and their reasons, and `docs/research/` holds the format and parity notes. Questions and playtest
reports are welcome on [Discord](https://discord.gg/DHKCWq9WkF). Report security problems privately
([SECURITY.md](SECURITY.md)). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Privacy

Your ROM, the imported data and your saves never leave your device. The deployed game can send anonymous
error reports (you choose during setup and can change it in Options) and counts visits without cookies. What
is and isn't sent is described in [docs/privacy.md](docs/privacy.md).

## Credits and legal

OpenSinnoh builds on the work of many others, above all the [pret](https://github.com/pret) decompilation
projects and [Pokémon Showdown](https://github.com/smogon/pokemon-showdown); see [CREDITS.md](CREDITS.md). The
licences of the bundled libraries and fonts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

OpenSinnoh is an unofficial fan project, not affiliated with or endorsed by Nintendo, Game Freak, Creatures or
The Pokémon Company. Pokémon and all related names are trademarks of their respective owners. No ROMs or game
files are provided, and none are in this repository.

OpenSinnoh's code is licensed under the [MIT License](LICENSE).
