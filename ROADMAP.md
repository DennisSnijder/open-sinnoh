# Roadmap

OpenSinnoh reimplements Pokémon Platinum (US) in TypeScript for the browser. You bring your own ROM.
[STATUS.md](STATUS.md) has the current numbers. [docs/scope.md](docs/scope.md) has the scope and the rules.

## Done

**Story.** A new game plays to the Champion, the Hall of Fame and the credits, then on through the post-game.
Story checkpoints 1–24 are chained replays from a new game. Every battle on the path is real.
- The whole Team Galactic arc, all eight gyms and their puzzles, the boat, the library and lake scenes.
- The Distortion World with its own camera, gravity and floor rules, Cyrus and Giratina.
- The Elite Four, Cynthia, the Hall of Fame, the credits and the reset.
- Post-game: the Battle Zone ship, the Fight Area, Stark Mountain, the Survival Area and Battleground, Routes
  225–230, the Resort Area, Snowpoint Temple, the National Dex, and the Elite Four and Cynthia rematches.
- Legendaries: Heatran, Dialga, Palkia, Giratina (Turnback Cave), the lake trio, Mesprit and Cresselia
  roaming, the roaming birds, Rotom and its forms, the Regis and Regigigas. Hall of Fame respawns as on the DS.
- Event Pokémon (Darkrai, Shaymin, Arceus, Rotom's room, a fateful Regigigas) through Mystery Gift codes.
  Codes are checked locally against salted hashes. Dev and test builds can also grant them with a flag.

**Overworld.** All 567 playable zones load and render, apart from a few unused maps.
- DS movement timings, collision, terrain heights, warps, doors, stairs, ledges, elevators and lifts.
- NPC movement types, trainer sight, wild encounters, zone connections.
- Every HM and field move, the bike, Surf, Waterfall, Rock Climb, ice, mud and snow.
- Weather, fog and Flash, field effects, prop animations, edge marking, camera moves.
- Time of day from the device clock (frozen and steppable in tests).
- Following Pokémon.

**Script engine.** Every script file decodes. All 720 field script commands are classified (real or a logged,
counted stub; none unknown). The story path has no stub outside a short allowlist.

**Battles.** `@pkmn/sim` (gen 4) inside our own controller, with the decomp's formulas for catching, running,
experience, EVs and money.
- Wild, trainer, first battle and catching tutorial; singles and all four double topologies (one double trainer,
  two trainers, a tag partner, a partner in wild grass).
- The ROM's trainer AI bytecode, ported.
- Bag, switching, level-up and move learning, evolution, blackout.
- ROM battle graphics, the single-screen command card, the doubles target screen.
- Move animations from the ROM's particle data and animation scripts (about 98% of moves).
- Safari battles in the Great Marsh.

**Menus and services.** Start menu, party, summary, bag, PC boxes, marts, the Pokémon Center, the naming keyboard,
the trainer card, the Pokédex, the Town Map and Fly, all 25 Pokétch apps, options and saves.
- Daycare and eggs, move tutors, the relearner and the deleter, NPC trades, berries.
- Honey trees, the Poké Radar, swarms, the Trophy Garden, Pokérus.
- Poffins, condition, Feebas into Milotic, the Fashion Case, Amity Square.
- Super Contests, offline: reception, practice, rivals and judges from the ROM, final scoring, results, ribbons, prizes,
  Master flags and winner photos; the visual round (dress-up, judging, the photo frames); dance is a placeholder
  behind one seam.
- The contests' acting round: the ROM's effect, voltage and AI tables, the judges, hearts and voltage meters, the
  move animations in the animation VM's contest mode.
- The Underground, solo: the Explorer Kit, the field and radar, mining, spheres, vendors, fossil revival.
- The Battle Tower: singles, doubles and multi, the Battle Salon partners, Palmer, BP and the exchange, on a second
  script VM for the Battle Frontier's scenes.
- Mystery Gift with gift codes.

**Audio.** The SDAT sequencer and DS synth in an AudioWorklet: field music by zone and time, fanfares, sound effects,
cries, battle music by encounter, the title and app music.

**Platform.**
- One composed screen on every device; the DS bottom screen is a card over it.
- Touch, keyboard and gamepad, with remapping.
- A PWA that works offline after the first import.
- Storage checks and save export and import.
- WCAG 2.2 AA on OpenSinnoh's own screens, announcements for canvas text, a reduce-flashing option.
- Performance, memory, storage and bundle budgets ([docs/performance.md](docs/performance.md)).

**Quality-of-life options.** Each defaults to DS behaviour in replays and tests:
- fast-forward and field zoom;
- auto-run, the repeat-Repel prompt, an item wheel on a held Y;
- the EV/IV view, RENAME in the summary, a Pokédex name search;
- skipping the intro on a repeat play, a suspend point;
- a trade-evolution substitute.

**HeartGold/SoulSilver add-on.** An optional second import adds the HGSS follower set for Platinum's following
Pokémon, follower talk and the HGSS look.

## Next

- **Battle Frontier:** the Factory, Hall, Castle and Arcade with their Brains, on the Frontier VM the Tower uses.
- **Contests:** the dance round behind the contest round seam; the Jubilife TV dress-up gallery.
- **Underground:** traps, the Digger Drill and secret bases.
- **Town extras:** the journal, the Game Corner, the Villa, TV, the diplomas, Seals and Ball Capsules, and the
  remaining small NPC rules.
- **Polish:** the last move animations, the Frontier Brain cut-ins, the generic HM cut-in art.
- **Modding 1.0:** script eject to TypeScript, a mod sandbox, mod docs, and Gen 4 extension points (3D model
  replacement, mod Pokétch apps, camera hooks).
- **HeartGold/SoulSilver** as a second base pack: Johto and Kanto, the Pokégear, Apricorns, its Safari Zone and
  Battle Frontier, with its own checkpoint suite.
- **Beyond the original (opt-in):** higher resolution, widescreen camera options, texture filtering, replacement
  model and texture packs.
- **An original demo pack** that needs no ROM.
- **Later:** the one-way cartridge `.sav` import, Diamond and Pearl, other ROM regions.

## Out of scope

Wireless and online features: the Union Room, Wi-Fi, the GTS, link contests and link trades. Pal Park, which needs
a GBA cartridge in the second slot.
