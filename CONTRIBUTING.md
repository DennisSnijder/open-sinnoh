# Contributing

Thanks for helping. This page is the short version; [AGENTS.md](AGENTS.md) has the detailed rules for
people and AI assistants alike, and [docs/decisions.md](docs/decisions.md) explains why things are the way
they are. Questions and playtest reports are welcome on [Discord](https://discord.gg/DHKCWq9WkF).

## The one rule that matters most

**Never share, commit or attach a ROM or anything taken from one.** That means no `.nds` files, no
extracted files, textures, models, sprites, music, text dumps or imported packs, and no screenshots of game
content in the repository. Do not attach any of these to issues, pull requests or Discord either. A ROM is
needed only for the ROM tests, and it stays on your machine.

## Parity with the DS

OpenSinnoh aims to play like the DS game. When behaviour is in question, the cartridge and the
[pret/pokeplatinum](https://github.com/pret/pokeplatinum) decompilation decide, not memory or other games.
Cite the decomp by file and line in code comments or `docs/research/`. Quality-of-life changes are options
whose default is the DS behaviour, so replays and tests are unaffected. The decompilation has no licence:
use it for names, offsets and understanding, and copy no code or assets from it.

## Setup

Requires Node 24 and pnpm 10 (`corepack enable` picks the pinned version).

```sh
pnpm install
pnpm dev          # prints a Packs URL that starts the original fixture game: no ROM needed
pnpm check        # lint, typecheck, unit tests and fixture replays
```

To test against the real game, keep your own dump of Pokémon Platinum (US, rev 0; the SHA-1 is in
[README.md](README.md#supported-roms)) outside the repository and point the tests at it.

## Tests

```sh
pnpm check                                                   # the gate without a ROM
pnpm test:changed                                            # tests touched by your diff, while you work
OPENSINNOH_NDS_ROM="/path/to/platinum.nds" pnpm test         # unit, integration and ROM replay tests
pnpm test:browser tests/browser/app-shell.spec.ts            # one Playwright spec, no ROM
OPENSINNOH_NDS_ROM="/path/to/platinum.nds" pnpm test:browser # the full browser suite
```

ROM tests skip without `OPENSINNOH_NDS_ROM`. More in [docs/testing.md](docs/testing.md) and
[docs/browser-tests.md](docs/browser-tests.md).

## Pull requests

- Keep each pull request to one change, and say what it does and how you checked it.
- `pnpm check` must pass. If your change touches game behaviour, run the ROM tests and the browser specs it
  touches too, and report the real results.
- Add or update tests: unit tests on the fixture pack, ROM tests or replays for game behaviour.
- Follow the code style in [AGENTS.md](AGENTS.md): simple code, no silent fallbacks, fail loudly on
  unexpected internal states.
- A change to the importer's output bumps `IMPORTER_VERSION`; a contract change bumps `CONTRACTS_VERSION`
  and gets a line in [docs/contracts.md](docs/contracts.md).
- A new runtime dependency needs its licence notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- OpenSinnoh's own screens follow the design system in [docs/design-system.md](docs/design-system.md).

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
