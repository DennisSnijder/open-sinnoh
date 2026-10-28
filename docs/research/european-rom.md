# European English Platinum (CPUE rev 10)

Research date: 2026-10-28. The European English Platinum imports with the US layout. This note keeps the measured
facts; only identity and aggregate results are kept here, no ROM bytes or text. Tool: `pnpm relocate <rom> --us
<us.nds>` (`tools/relocate.ts`).

## Measured

- **Identity:** header `POKEMON PL`, game code `CPUE` (the US one), header revision 10, 134,217,728 bytes,
  whole-file SHA-1 `6b1bd310a0f7293b0d6b260cc6684183146270cc`. arm9 and all overlays are uncompressed.
- **Same as US rev 0:** the arm9, 121 of the 122 overlays and 457 of the 462 files are byte-identical. All 185 pins
  are in their US places with their US hashes, so the build's layout is empty and it has no path map (its
  localized files are the US ones, in the general folders and `/resource/eng/`).
- **Text:** 724 banks, every bank's message count equal to `names.json`, 0 unknown characters.
- **What differs:** the Game Corner. Its script file (`scripts_game_corner`), map, text bank and the slot machine
  graphics (4 members of `/data/slot.narc`), overlay 94; the Veilstone City text, the TV records and commercials, the
  journal entries, and one member of the opening demo. The script and text archives change size, so every file
  stored after them moves in the ROM (about 62 M bytes differ in all).
- **Scripts:** 575 files decode; they use 718 distinct commands, the German build's set: like it, the European
  English build never uses the slot machine game (`ScrCmd_267`, 0x267) or its bonus-streak prize
  (`CheckBonusRoundStreak`, 0x275), and uses no command the US build lacks. This is the European Game Corner, where
  the slot machines are "game machines" that give a few coins a day (Bulbapedia, PEGI rules); the slot replays skip
  on it as on the German build.

## How it is supported

`SUPPORTED_ROMS` has its SHA-1 (`platinum-eu-rev10`, `language: 'en'`) and the importer an empty layout. Tests that
differ by build key on the game code and revision (US rev 0 is the only build with playable slot machines).
