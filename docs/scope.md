# Scope and design

OpenSinnoh is a browser engine for the Nintendo DS generation of Pokémon games (Gen 4). It runs on desktop and phone.
You bring your own ROM. [ROADMAP.md](../ROADMAP.md) lists what is done and what comes next. `docs/decisions.md` records
the decisions and why.

## 1. Goal and choice of game

The engine reimplements the game in TypeScript. **Pokémon Platinum (US)** is the first base pack. The player imports it
locally from their own ROM, and it is never distributed. **HeartGold/SoulSilver** becomes the second base pack on the
same engine. Diamond and Pearl may follow as variant packs.

Why Platinum first:
- The [Platinum decompilation](https://github.com/pret/pokeplatinum) is the most complete Gen 4 decomp. The game's data
  and logic are well understood.
- The [HGSS decompilation](https://github.com/pret/pokeheartgold) has much less decompiled C.
- HGSS uses the same engine as Platinum, with additions. Building on Platinum and then adding HGSS as a second pack
  forces the engine to be general rather than Platinum-shaped.

## 2. What Gen 4 asks of the engine

| Area | Gen 4 (Platinum / HGSS) | Consequence |
|---|---|---|
| ROM data | A **NitroFS file system** of named files and NARC archives | The importer is mostly format parsing. Few symbol offsets are needed (tables inside `arm9.bin` and overlays). |
| Overworld | **3D map chunks** (DS models and textures), terrain heights, collision grids, 3D buildings, 2D billboard characters, a fixed camera | A WebGL renderer and model conversion at import. |
| Screens | **Two 256×192 screens**, the bottom one touch | One composed screen; the bottom screen's content is a card over it (§3). |
| Scripts | Gen 4 script bytecode in per-map script and event files | A VM over a decoded IR, with a large command set. |
| Text | Per-string encoded message archives | A small decoder. |
| Graphics | NCGR/NCLR/NCER/NANR (2D), NSBMD/NSBTX/NSBCA/NSBTP/NSBTA (3D) | A converter for each, tested on original fixtures. |
| Audio | **SDAT** (SSEQ sequences, SBNK banks, SWAR samples, STRM streams) | A sequencer and synth in an AudioWorklet. |
| Battles | Gen 4 rules: the physical/special split, more double battles | A Showdown-family engine with gen 4 rules, inside our own PvE controller. |
| Size | A ~128 MB ROM | Selective extraction and a storage budget for IndexedDB. |

Format names here are the community's common names. Each one is verified against the decomp and existing tools in
`docs/research/`.

## 3. Design

| Area | Decision |
|---|---|
| Engine | Reimplemented in TypeScript. No emulator and no compiled decomp. |
| Renderer | WebGL through three.js. DS models are converted at import into glTF plus textures, stored in the base pack. Characters are billboards. |
| DS look | Close to the DS: nearest-neighbour textures, the original camera angle and field of view, fog where maps use it. A pixel-exact DS GPU emulation is not a goal. |
| Screens | **One composed full-bleed screen** on every device. The DS bottom screen's content (Pokétch, menus, the battle command card) is a card over the main view, never a split layout. |
| Scripts | A VM over a readable IR decoded from the ROM. Overrides are by script label. |
| Data | Registries, JSON Patch and a load order. Mods are packs. |
| Determinism | Fixed **30 Hz** logic tick, as the DS runs its field logic. Seeded PRNG streams, serializable VM and world state. Presentation (sound, flashes, the device clock) never feeds the simulation. |
| Battles | `@pkmn/sim` (MIT) gen 4 for move, ability and damage resolution, loaded lazily, with ROM data written into its dex by a mod. Our controller owns the flow, the trainer AI (the ROM's bytecode), and the formulas for catching, running, experience, EVs and money, exact to the decomp. The random draw order is not cartridge-exact. |
| Menus | Every menu is a headless model (`packages/menus`): `open`, `step(input)`, `view()`. The DOM only draws its view, so replays drive menus the same way headless and in the browser. A script command that opens a menu yields and resumes with the result, as the DS's field tasks do. |
| Clock | The device's real-time clock drives time of day, berries, honey trees, daily events and the Pokétch, as on the DS. Replays freeze and step it. |
| UI | Screens that recreate the DS (battle, bag, party, summary, Pokédex, PC, naming) stay faithful and use the ROM's art. OpenSinnoh's own screens (Options, setup, crash, data, mods) use OpenSinnoh UI (`docs/design-system.md`). |
| QoL | Each quality-of-life change is an option whose contract default is the DS behaviour, so replays and tests are unaffected. |
| ROM support | Platinum US rev0, European English rev10 and German rev0, keyed by SHA-1. HGSS US later. |

## 4. Hard rules

- **No ROM content in git:** no ROM, no extracted or derived data, no generated base pack, no screenshots of ROM
  content.
- **ROM tests skip without a ROM.** They read the ROM's path from `OPENSINNOH_NDS_ROM`. Every other test uses the
  original fixture pack (`packs/fixture`) or bytes generated by our own writers.
- **The fixture pack is original.** It includes a tiny original 3D map chunk and building, and original NARC, NCGR and
  NSBMD byte fixtures for converter tests, made by our own code or by hand, never cut from a ROM.
- **The decomp is a reference only.** `reference-projects/` is a gitignored, local-only checkout of the pret decomp,
  which has no licence. Use it for names, offsets and understanding. Copy no code or assets.
- **Other tools:** read code closely only from permissively licensed tools (apicula, NitroPaint, nitrogfx, VGMTrans),
  and copy from none. Never copy code from GPL or unlicensed sources.
- **Storage budget:** convert only what the game needs, compress sensibly, and measure. The base pack stays well under
  150 MB of IndexedDB (`docs/performance.md`).
- **Gift codes** are checked locally against salted hashes.
- **Wireless and online features** (GTS, Wi-Fi, the Union Room, link contests and trades, the Pokéwalker in HGSS) are
  out of scope. Scripts that reach them get a logged "no connection" answer, the decomp's own decline branch, never a
  silent one.

## 5. Code style

Prove first, harden second. Keep it simple: no speculative abstraction, no defensive code for impossible states, no
silent fallbacks. Fail loudly on unexpected internal states. Validate strictly only at boundaries (ROM, packs, saves,
user input). Unimplemented script commands log once and are counted in coverage. They never crash, and they never pass
silently.

Game-agnostic code (pack loader, patching, scheduler, replay harness, CLI, save framework, mod sandbox) stays in
packages with no Gen 4 assumptions.

## 6. The first vertical slice

The first slice (v0.1) set the shape of everything after it. A person with a Platinum US ROM can:
1. Open the web app on desktop or phone, pick the ROM, see it verified by SHA-1 and imported locally, with progress.
2. Start a new game in the player's bedroom in Twinleaf Town.
3. Walk the 3D bedroom and house, go downstairs, talk to Mom, walk through Twinleaf Town, enter the rival's house.
4. Walk to Route 201 and Lake Verity and trigger the real scripted sequence that leads to the starter choice.
5. Use the bottom-screen content as a touch panel.
6. Save and reload, and export and import the save as a file.
7. Load a demo mod that overrides one script and patches one data record; disabling it restores vanilla.

A developer can run `dev`, `check` and `test` on the fixture pack and the demo mod, with headless replay tests on
desktop and phone viewports.

## 7. Credits

The credits play the staff roll from the player's ROM as-is, then one short OpenSinnoh card: "OpenSinnoh — an
unofficial fan engine. Not affiliated with Nintendo, Game Freak or The Pokémon Company." and a contributors line.

## 8. Roadmap

See [ROADMAP.md](../ROADMAP.md).

## 9. Story checkpoints

The story is tested as chained replays from a new game to the end of the post-game. The checkpoint list and the
rules every checkpoint passes are in `docs/testing.md`. Exact flags, variables and end states are in
`docs/research/story-cp5-19.md` and `docs/research/story-cp20-24.md`.

System tests also cover catch rates, damage ranges including the physical/special split, experience curves,
evolution triggers, the daycare and eggs, and save round trips.
