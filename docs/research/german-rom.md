# German Platinum (CPUD)

Research date: 2026-10-27. The German Platin-Edition (CPUD rev 0) imports end to end and shows its game in German.
This note keeps the measured facts and how the port is built; only identity and aggregate results are kept here, no
ROM bytes or text. Tool: `pnpm relocate <rom> [--us <us.nds>] [--layout <file.ts>]` (`tools/relocate.ts`).

## Measured

- **Identity:** header `POKEMON PL`, `CPUD`, revision 0, 134,217,728 bytes, whole-file SHA-1
  `5d009a175c77d4387cde26d34efb71aee825a938`. arm9 and all overlays are uncompressed, like US rev 0.
- **Text:** 724 banks, every bank's message count equal to `names.json`, 0 unknown characters with `charmap.json`
  (umlauts and ß decode as they are). So every text id holds.
- **Pokédex text:** bank 706 (`TEXT_BANK_SPECIES_POKEDEX_ENTRY_EN` in the decomp's names) holds the game's own
  language: German on CPUD, so the importer needs no change. Heights and weights are metric strings ("  6,9kg");
  nothing parses them.
- **Files:** 19 files with text drawn in live in `/resource/ger/<folder>/` instead of their US paths (the general
  folders or `/resource/eng/`); no file exists in both places. `GERMAN_PATHS` in `importer/src/layout.ts`.
- **RAM:** every German overlay loads 0x1A0 higher than its US one (the larger arm9). The tool solved the US
  addresses it needed from their pointer tables: ov5 `0x021D0D80`, ov8 and ov9 `0x02249960`, ov23 `0x0223E140`,
  ov104 `0x0222DCE0`.
- **Pins:** all 185 placed. Shifts are small and constant per module: arm9 +0x58 and +0x19c, ov5 +0x1c (the
  weather tasks +0x20), ov16 +0x1c/+0x20, ov17 +0x4, ov7 −0x48, ov99 −0x50/0, the rest 0. 118 differ from US and
  are in `importer/src/layouts/platinum-de.ts`.
- **Placed by hand** (`tools/relocate-pins.ts`, each with its reason): the weather tasks (ov5 function pointers;
  matched by rank in `formats/weather.ts`), `contestEffectClasses` (handler pointers, not read), the staff credits
  (224 rows, US 237), the two Battle Factory pool tables (other set ranges, no pointers) and the healthbox parts
  (German status icons, +0x1c).
- **Scripts:** 575 files decode; they use 718 distinct commands (US 720). Two US commands it never uses are the Game
  Corner's: the European build has no slot machines (no ScrCmd_267) and no bonus-streak prize (no
  ScrCmd_CheckBonusRoundStreak), so the slot replays skip there. The Pokémon Center nurse greets the day with
  message 121 (named `_Night` in the decomp) where the US script uses message 0; the morning (120) is the same.
- **Text paging:** the same text splits into other pages and scrolls (and takes other ticks to print), so a
  conversation's A presses and a wait's length differ by language. Replays answer them with `advance message` /
  `advance text`.
- **Data the German build has of its own:** the staff credits, the Factory pools, the status icons, the naming
  keyboard's pages (row 4 of the letters ÄÖÜ / äöüß, the others row „ “ ‘ ’), the sorted lists in arm9 (the
  Pokédex A–Z, easy chat), which the German collator reproduces.

## How the port is built

- **Identity:** `SUPPORTED_ROMS` has the German SHA-1 with `language: 'de'`. Platinum is accepted by SHA only.
- **One importer, a layout per build:** `placeTables` applies the build's `{ offset, sha1, count? }` per pin key to
  the US constants; offsets inside a pinned region move with it (`shiftLayout`), and the readers take each overlay's
  RAM address from the ROM (Sunyshore, the weather tasks). NitroFs `paths` maps the US paths to `/resource/ger/`.
- **Our texts in the game's screens** (the modern and QoL options, the repel prompt, the summary's rename and
  stats, the contest labels, the objectives) are written in the ROM's language at import. Names of places,
  people and items in them are the German game's.
- **The game's language** goes into the pack (`NewGame.language`, 5), new Pokémon get it, and the outsider check
  compares with it.
- **Engine:** YES/NO and AP from the ROM's banks, the level mark per language, German keyboard pages and typed
  umlauts, the German collator for the Pokédex and easy chat, `isHmItem` by id, the gift-code prompt, the Wonder
  Cards and our credits card per language.
- **The shell** (`packages/app/src/strings/`) is German for a German game, or before an import with a German
  browser.

## Left

- **Mods:** custom species and moves get their sim id from `toID(name)` (`battle/src/sim/dex.ts`); an umlaut is
  dropped, which works unless two names collide.
- The HeartGold follower add-on stays US-only.
