# Credits

OpenSinnoh stands on a lot of other people's work. This page lists the projects, specs and tools it
learned from or builds on, and what each was used for. The licences of the code and fonts we ship are
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Reverse engineering

- **[pret/pokeplatinum](https://github.com/pret/pokeplatinum)**, the Pokémon Platinum decompilation. The main
  reference for the whole engine: names, file layouts, table offsets, script commands, formulas, timings and
  behaviour, cited throughout the code and `docs/research/` by file and line. The repository has no licence, so
  we use it for understanding only: no code or assets are copied from it. Contributors keep a local checkout in
  `reference-projects/` (gitignored, never committed).
- **[pokeheartgold](https://github.com/pret/pokeheartgold)** (pret), and the fork
  [ctrl-cheeb-del/pokeheartgold](https://github.com/ctrl-cheeb-del/pokeheartgold) that our HeartGold/SoulSilver
  notes are pinned to: the HeartGold/SoulSilver file layout, the ROM hashes, and how following Pokémon are
  stored and move, for the optional follower add-on (`docs/research/hgss-import.md`,
  `docs/research/following-pokemon.md`). Same rule: names and understanding only.

## Nintendo DS formats and hardware

- **[GBATEK](https://problemkaputt.de/gbatek.htm)** (Martin Korth): the DS hardware reference for the 3D engine
  (geometry commands, texture formats, lighting, fog, edge marking, anti-aliasing), OBJ sizes and LZ
  compression.
- **[apicula](https://github.com/scurest/apicula)** (0BSD): how NSBMD models, NSBTX textures and their
  animations are laid out, while writing our own glTF converter (`packages/g3d`).
- **[NitroPaint](https://github.com/Garhoogin/NitroPaint)** (BSD-2-Clause) and **nitrogfx** (MIT, in the
  decomp's `tools/`): the 2D formats (NCGR, NCLR, NCER, NANR, NSCR) for our 2D importer
  (`packages/importer/src/ui2d`).
- **[VGMTrans](https://github.com/vgmtrans/vgmtrans)** (Zlib): format research for the DS sound archive (SDAT,
  SSEQ, SBNK, SWAR).
- **[melonDS](https://melonds.kuribo64.net/)**: a reference for how the DS composites anti-aliased edges and fog
  (`packages/render/src/composite.ts`), and an emulator for visual comparisons.
- Other DS tools surveyed for format documentation (no code read closely): Tinke, ndstool, ndspy, DSPRE,
  Pokémon DS Map Studio, Every File Explorer, NitroStudio2, SDATTool, GotaSequenceLib, loveemu's vgmdocs.
  The survey is in `docs/research/graphics-formats.md`.
- **[PKHeX](https://github.com/kwsch/PKHeX)**: the initial value of the Gen 4 save checksum.

## Libraries we ship

- **[Pokémon Showdown](https://github.com/smogon/pokemon-showdown)**'s battle simulator, as
  **[@pkmn/sim](https://github.com/pkmn/ps)** with @pkmn/streams, @pkmn/sets and @pkmn/types (MIT): the battle
  engine behind `packages/battle`, with Platinum's data from the player's ROM written over it.
- **[three.js](https://threejs.org/)** (MIT): the renderer.
- **[fflate](https://github.com/101arrowz/fflate)** (MIT): PNG compression when the importer writes textures and sprites.
- **[Sentry](https://github.com/getsentry/sentry-javascript)** (MIT): opt-out anonymous error reports.

## Fonts

All under the SIL Open Font License 1.1, self-hosted through [Fontsource](https://fontsource.org/):

- **[Pixelify Sans](https://github.com/eifetx/Pixelify-Sans)** by Stefie Justprince: the pixel face of our own screens: titles, labels, buttons.
- **[Silkscreen](https://github.com/googlefonts/silkscreen)** by Jason Kottke: numbers, counts and badges.
- **[Figtree](https://github.com/erikdkennedy/figtree)** by Erik Kennedy: body text on our own screens.
- **[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)** by JetBrains: crash details.

The game's own fonts, text and art come from the player's ROM at import time and are never part of this
repository.

## Tools

Built and tested with [Vite](https://vite.dev/), [Vitest](https://vitest.dev/),
[Playwright](https://playwright.dev/), [TypeScript](https://www.typescriptlang.org/),
[ESLint](https://eslint.org/), [pnpm](https://pnpm.io/) and [axe-core](https://github.com/dequelabs/axe-core).

## Pokémon

Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and Game Freak. OpenSinnoh is
an unofficial fan project, not affiliated with or endorsed by Nintendo, Game Freak, Creatures or The Pokémon
Company.
