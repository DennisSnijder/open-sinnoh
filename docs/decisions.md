# Design decisions

Design decisions and the reasons for them, by topic. Each bullet states the current decision; history is
kept only where it explains a non-obvious why. Names in `code` are our own; names in CamelCase or
SCREAMING_CASE without a path are the pret pokeplatinum decompilation's (the decomp). The contract
changelog lives in [`docs/contracts.md`](contracts.md); scope and the core rules are in
[`docs/scope.md`](scope.md).

## Principles and rules

- **Bring your own ROM.** The engine reimplements Platinum's systems and reads the player's own ROM once,
  to import it. We never ship or commit a ROM, anything extracted or derived from one, or screenshots of
  ROM content. ROM-derived output stays in local caches and ignored test artifacts.
- **The one exception:** the landing page (`site/shots/`, the site's link card) shows a small, curated set
  of gameplay screenshots and clips captured from OpenSinnoh, compressed for the web. No extracted asset files,
  audio or ROM data.
- **Supported ROMs** are pinned by whole-file SHA-1: Platinum US rev0
  (`ce81046eda7d232513069519cb2085349896dec7`, `packages/nds/src/supported-roms.ts`); HeartGold/SoulSilver US
  only as the source of the follower add-on. Anything else is refused with a clear message. We hash the file as given, with no
  normalisation (the tail fill changes the hash).
- **References.** `reference-projects/` is a local, gitignored checkout of pret/pokeplatinum. It has no
  licence, so it is used for names, offsets and understanding only; no code or assets are copied. Code is
  read closely only from permissively licensed tools (apicula, NitroPaint, nitrogfx, VGMTrans) and copied
  from none. GBATEK is the hardware reference. Research notes describe comparisons in words; browser
  checks measure our own renders.
- **ROM tables are located by offset and checked by SHA-1.** Source code holds names, char codes and the
  decomp's `#define` constants, never ROM-derived values. An unexpected table, pointer or enum value fails
  the import.
- **Prove first, harden second.** Keep it simple: no speculative abstraction, no defensive code for
  impossible states, no silent fallbacks. Validate strictly only at boundaries (ROM, packs, saves, user
  input) and fail loudly on internal invariants.
- **Unimplemented script commands log once and are counted in coverage.** They never crash and never
  pass silently. Stubs fall back by name bucket (0 in destination vars, empty text buffers, no wait).
- **Faithful by default; departures are labelled.** Where we change DS behaviour (a quality-of-life option,
  a readability tweak) the code names it as not DS, and replays run the DS behaviour.
- **One screen.** No split DS screens anywhere, the title included. The DS bottom screen's content is a
  card or overlay on one composed screen, shown only while it has content.
- **Licence:** MIT.
- **Naming.** The project is OpenSinnoh. Packages are `@opensinnoh/*`, environment variables
  `OPENSINNOH_*`, the local cache `.opensinnoh-cache/`. Names already stored in players' browsers and
  files keep their pre-rename strings, so stored imports and exported saves keep working without a
  re-import: the localStorage keys `lantern-nds:*`, the IndexedDB databases `lantern-nds` (imports) and
  `lantern-nds-saves` (saves), the save format id `lantern-nds-save`, glTF `extras.lantern`, and the
  `Lantern_*` engine text ids in imported packs.

## Architecture and packages

- **Packages:** `nds` (NitroFS, LZ10, BLZ), `g3d` (NSBMD/BCA/BTA/BTP to glTF), `importer`, `contracts`,
  `core`, `vm`, `world`, `game`, `battle`, `menus`, `services`, `text`, `audio`, `render`, `ui`, `app`,
  `cli`. Packages depend on `@opensinnoh/contracts` and `@opensinnoh/core`, not on each other's internals.
- **Simulation tick = 30 Hz.** The decomp's main loop runs once per two vblanks; only the print task runs
  twice. Every timing ported from a SysTask counts one decomp frame per tick. Rendering interpolates at
  display rate. We swept for code that ran two decomp frames a tick (gauges, cut-ins, fades, evolution,
  the catch, key repeat) and fixed it.
- **Determinism.** The game is a pure function of seed, inputs and the clock option. Saved RNG streams:
  the main stream (`GameState.rng`), `encounterRng`, `fieldRng`, and per-object wander streams seeded
  from (game seed, zone, local id). The DS uses one global LCRNG; separate streams keep systems from
  shifting each other's draws, and keep old replays stable when a system becomes real. Draw counts and
  distributions follow the decomp; cartridge-exact interleaving does not.
- **State is plain JSON.** VM and world state serialize; saves are canonical (flags, vars and items
  sorted by id) so the save round trip is byte-identical.
- **The world owns movement, fades and the camera; the VM owns the message box, YES/NO, menus and the
  touch panel** (`ScriptView`). The renderer only draws `FieldView`; it never changes game state.
- **Menus are headless models** (`packages/menus`). The DOM draws their `AppView` only; taps send element
  ids (`InputFrame.tap`), so the browser runs exactly what headless replays run. A script op that opens
  an app yields until it returns. While an app is open the field and VM do not step.
- **Sound never gates state or timing.** Waits use lengths measured at import, never the audio clock.
- **Presentation is drawn only.** Bobbing platforms, weather fades, ghost props and similar effects run
  on render state, so replays and saves do not change with them.
- **The battle engine is a lazy chunk**; the game does not tick while it loads, replays preload it.

## Contracts and versioning

- **`packages/contracts`** is the one cross-package surface (records, views, hosts); `packages/core` holds
  the game-agnostic pieces (IDs, PRNG, JSON Patch, semver, script IR, replay grammar, pack loader).
  `CONTRACTS_VERSION` is semver: a minor bump for new or changed shapes, a patch for additive or
  documentation changes. Each bump gets a line in `docs/contracts.md`.
- **`IMPORTER_VERSION`** (`platinum-N`) bumps on any change to importer output, or browsers keep a stale
  cached import. The HGSS add-on has its own version (`hgss-followers-N`).
- **The save schema** has its own version with migrations from every earlier version (tests per step).
  An added optional field or union member needs no migration; a bump still lets an older build refuse a
  newer save cleanly.
- **Parallel branches** merge with `pnpm merge:main`: it resolves both-sides version bumps (one past the
  larger) and both-sides decision-log additions, and leaves every other conflict to git. A script, not a
  git merge driver: drivers need per-clone config, and git never runs one when both sides bumped to the
  same value.

## Importer and pack format

- **IDs** are `namespace:NAME`, decomp constant names unchanged (`platinum:MAP_HEADER_TWINLEAF_TOWN`,
  `platinum:FLAG_*`). Records without a decomp name use `platinum:<kind>/<index>`. Script labels are the
  `ScriptEntry` name, else `platinum:<file>/<n>`.
- **Other builds of Platinum** are the same importer with a per-build layout: each pinned table's offset, SHA-1
  and, where it differs, row count (`packages/importer/src/layouts/`, generated by `pnpm relocate`, the pins it
  can't prove placed by hand in `tools/relocate-pins.ts` with a reason), and the paths of the files a localized
  build keeps in its own language folder (NitroFs `paths`). No other code branches on the build. The text ids hold
  because every bank has the same messages. Our own texts in the game's screens (the modern options, the
  objectives) are written per language at import; the pack's `NewGame.language` (decomp `LANGUAGE_*`) is the
  language new Pokémon get.
- **Packs:** `pack.json` manifest, `PackData` registries, `RecordPatch` (RFC 6902 JSON Patch), load order
  base, then add-ons, then mods; later packs win. Records are strictly validated on every load; dangling
  references are reported by `opensinnoh check`, not by `createGame`.
- **Models are glTF 2.0** (JSON + PNG). DS material state (polygon alpha, cull, fog flag, lit vs vertex
  colour, polygon ID) goes under `extras.lantern`. Three.js loads it natively, Blender exports it, and
  modders need no custom tooling. Texture animations (frame swap, SRT scroll, pattern) are our own JSON
  next to the model.
- **Characters are not models:** a sprite set is a PNG atlas plus frame and animation JSON, drawn on one
  billboard quad. Shaped billboards (a non-square quad, such as the Galactic HQ doors) are model objects.
- **Everything is PNG plus a record; no runtime palettes.** Shiny sprites are a second atlas;
  backgrounds are rendered per time of day. Platinum's Pokémon pictures are decrypted with the LCRNG
  (front to back, unlike D/P).
- **Texture sets per DS set index;** materials bind by name to the area's set, as on the DS. A name the
  set lacks draws untextured and logs once. A chunk from a neighbouring area binds from its own area's
  set when the loaded set lacks the name (our wider view sees chunks the DS never shows).
- **Build models with a material/shape list draw untransformed** (`build_model_matshp.dat`), which is how
  Twinleaf houses hide their own door.
- **Records stay procedural for sound:** SSEQ bytecode and SWAR files as assets, banks as JSON, lengths
  measured at import. Nothing is pre-rendered.
- **Format findings:** interiors use an orthographic camera; rev0 overlays and arm9 are uncompressed;
  land chunks carry no textures; fonts are Game Freak's 2bpp NFGR, not NFTR; the ROM's 2D NARCs use LZ10
  only.
- **Kept ROM oddities** show in the import report rather than being fixed (warps to `MAP_HEADER_DYNAMIC`,
  a bg event past its file's entries, build models in no area's prop list, which the DS draws as a dummy
  box and we drop).
- **Import in a worker.** The worker gets the `File`, hashes it once, then reads ranges (`RomSource`), so
  the ROM buffer is not live for the whole run; the pack JSON is encoded in pieces. It writes IndexedDB
  itself; the meta row is written last, so an interrupted import never counts.
- **Import integrity:** at boot each import's file count, byte total and pack data are checked against
  its meta row. A partial base import returns to the ROM page and keeps the saves; a file lost later
  throws `ImportIncompleteError` and the crash screen offers the re-import. An import needs 250 MB free
  (checked with `estimate()` before the ROM is read); a quota error removes the partial pack.
- **Re-import notice:** an import from an older `IMPORTER_VERSION` asks for a re-import with a calm
  notice. Saves live in their own database that no import touches, and the base pack's version is fixed,
  so the save still loads.
- **Cosmetic packs** (`cosmetic: true`) may touch only `sprites` and `followers` and bind no scripts.
  Saves ignore them when checking the pack set, so adding or removing the HGSS add-on keeps progress.
- **Engine text** our additions need (option labels, QoL prompts) lives in the base pack as `Lantern_*`
  text records, never in source. Game UI strings always come from the imported text banks.
- **HGSS add-on** (optional, US 1.0 HeartGold/SoulSilver, pinned SHA-1s, never a base game): imports the
  566 follower sets from the decompressed ARM9 tables into a cosmetic `hgss-followers` pack, stored as
  its own IndexedDB import and kept across base re-imports. SoulSilver's tables are not measured yet; its
  import fails loudly until they are.

## Saves and storage

- **Saves happen only between scripts.** The DS saves only from the field menu, so nothing is lost, and
  there are no continuation stacks to persist. Saves are refused while an app is open or the field is
  mid-slide.
- **A save records its pack set;** a different (non-cosmetic) pack set raises `PackMismatchError`, never
  a silent adaptation. Toggling a mod restarts from the last save when the new set accepts it.
- **Loading a save is not a map change** (FieldTask_LoadSavedGameMap): no flag clearing, weather reset,
  onTransition or blackout spawn; the saved objects return. `World.enter('load' | 'arrival')` is told
  which it is, never guesses. Arrivals (warps, new game) set first-arrival and fly flags.
- **CONTINUE scatters the roamers** (`Game.onContinue()`), as the DS does; `game.load()` stays a pure
  load so replays and round trips give back the saved state.
- **One save slot plus a suspend slot.** The Hall of Fame history lives in the one save. The save
  envelope has a format id and version; export and import are plain JSON files. Errors are typed
  (`NotASaveError`, `NewerSaveError`, `PackMismatchError`, `SaveStorageFullError`); a failed write keeps
  the previous save (one transaction).
- **Storage:** imports in IndexedDB `lantern-nds`, saves in `lantern-nds-saves`, device settings in
  localStorage under `lantern-nds:*`, each validated per entry on read. Persistent storage is requested
  after an import and from Options › Data, not at every boot (Firefox would ask each time).
- **`.sav` import:** one-way, Platinum US first.

## Script VM

- **Op names from the decomp's handler table**, operand layouts from the `scrcmd.inc` macros. Unnamed
  handlers become `scr_cmd_0a2`. Message banks by number come from a `textBanks` registry.
- **Coverage:** `opensinnoh coverage` classifies every op (real, stub by bucket, unimplemented) over
  ROM-wide roots; milestone tags (`real: …`) fail coverage when a tagged op is not implemented. A script
  op that would need state the engine does not keep says so in its stub, never fakes it.
- **Native tasks the script waits on** (cut-ins, boat, elevator, camera shake) run as field tasks with a
  `…Done` poll, timed state by state from the decomp.
- **Starter species are data** (`Species.starterSlot`), so a mod swaps a starter with one patch.
- **TS script labels are deferred;** an async `ctx` resumes in microtasks that do not line up with the tick.
  When needed they will be generator-based labels stepped by the VM.
- **The frontier VM runs inside the field VM,** as the DS's frontier app runs over the waiting field
  script. It shares the field's message box and menus; its battles run on copies (nothing written back).
- **A/B waits without an arrow are in the view.** `wait_ab_press` and `wait_ab_pad_press` draw no "more" arrow on the DS,
  so `ScriptView.waitsForAB` (not `message.waitingForInput`, which draws one) says the script waits; `until message`
  and `advance text` treat it as a waiting message, as `FrontierView.waitsForAB` in the frontier.
- **The field map starts again after an app** as FieldMap_Init does on the DS: the zone's on-load script, its dynamic
  features, then its on-resume script, run to completion. It happens at `return_to_field` (ScrCmd_ReturnToField: every
  script that opens an app), when the start menu's Pokédex, party, bag, trainer card or options close back to it
  (StartMenu_Exit* → FieldSystem_StartFieldMap; SAVE runs over the field), before a field move or item those started,
  and after a battle. The field itself stays up; only the scripts and the dynamic features run again.
- **Choices where the decomp is undefined** throw rather than guess (for example AI commands that never
  advance, an unknown operand).
- **Link commands answer "no connection".** Field link stubs return 0 or a cancelled connection; the frontier's link and
  Wi-Fi commands (each script reaches them only on its link branch) are logged stand-ins that write 0. Clearing the
  linked players' received data (`clear_received_temp_data_all_players`, its frontier twin) is real: offline nothing is
  received, so there is nothing to clear. Our Pokémon carry no checksum, so `check_party_has_bad_egg` is always no.

## World and field

- **Timings from the decomp:** walk 8 ticks a tile, run 4, turn 2, bump 16; a held direction keeps
  walking without a gap. Running needs the shoes and B (Platinum never reads the header's running flag).
- **Movement types** follow the decomp per type (look-around, wander, rotate, walk loops by route list).
  Phases are not saved; a loaded object restarts its cycle.
- **Trainer sight** runs after frame scripts on idle ticks; map objects collide and see only within two
  grid units of height.
- **Wild encounters** roll on `encounterRng`: grace period, flat gate, rate, slot; time of day replaces
  slots 2–3. Roamers, swarms, the Poké Radar and honey trees follow their decomp files; their rolls
  happen only when those systems run, so earlier replays do not move.
- **Zone connections** delete the old zone's non-persistent objects at once, as the DS does. Clone objects
  (script 0xFFFF) carry over with their tile and facing. Saves record a clone's source zone.
- **Departed and preview objects** are a renderer concern: on screens wider than the DS's 16×12 tiles
  the renderer keeps a deleted object drawn until it is off screen and shows the next zone's objects
  only once off screen. The world still deletes and spawns as the DS does.
- **Loading builds every chunk,** so ops that snap objects with unknown terrain height do nothing here.
- **Heights:** the player stands at the terrain height nearest the saved y on load; the bridge layer is
  derived from the underfoot tile. The player collides on a height step of 20 units or more.
- **Map features** (gym puzzles, the Distortion World) keep one saved slot, as PersistedMapFeatures:
  a warp clears it, the zone's onTransition selects it, every map load builds the runtime from it. The
  world calls a feature at the decomp's hook points. Their tables come from SHA-pinned overlay regions.
- **The field's return after a battle** is the game's, for every battle: FieldMap_Init's on-load and
  on-resume scripts run when the result lands, as encounter.c does.
- **Doors, stairs and escalators** follow the decomp step for step (door open, walk in, hide, close, fade).
  Script warps keep the plain arrival.
- **The Distortion World** is one shared space addressed as the DS addresses it (matrix tile + room offset,
  height + altitude × 16). Walls and ceilings are surfaces with their own step tables; elevators, jump
  points, camera rows and the boulder puzzle follow the overlay's state machines. Room records are
  imported, not an asset. No party follower there.
- **Weather** comes from the ROM's task table; changes without a map load fade as ov5_021D5F7C does.
  Yearly weathers read the saved game time. Particles are the tasks' own OAM sprites and spawn and update functions,
  ported per kind; a view wider or taller than the DS screen runs one task per DS screen, each clipped to its screen, so
  the density is the DS's everywhere. Fades spawn at the ramp's rate (not the DS's whole spawns per interval).
- **Clock:** the game reads time only through `GameOptions.clock`. The app passes the device's local time;
  headless runs freeze it (2009-03-22 12:00). Two readings as on the DS: the saved `gameTime` (field time
  of day, yearly weather) and the clock itself (encounters, lights, day of week). A clock moved backwards
  starts the DS penalty. Daily events advance per elapsed calendar day.
- **Hidden-location matrix variants** (Spring Path, Seabreak Path) are copies of matrix 0 picked by vars
  at map load; a zone connection keeps the loaded matrix.
- **Field moves and items** port FieldMoves_Check* and item_use_functions.c; bag USE and the registered
  item share one module (`field-items.ts`). Platinum's registered button is Y.
- **Map-name popup** lives in the game, not the world, with the decomp's timing and building rules.
- **Following Pokémon** (an addition, on by default): the lead party Pokémon follows on Platinum's 24
  species with walking sets, or every species with the HGSS add-on; no generated art. It is drawn only:
  it never blocks, is never seen and starts no script, so every replay plays the same with or without
  it. Follow rules per map type are written by the importer so mods can patch a zone. A stopped follower
  holds its stand frame by default (Options: Still or Walk in place). Large followers use HGSS's facing
  offset.
- **Nurse turn-away** after healing is a labelled departure: mashing A at fast-forward would otherwise
  re-talk and heal again.
- **Galactic HQ haze** is drawn at 40 % of its density for readability, a named non-DS constant.

## Rendering

- **The renderer works on display values,** no sRGB decode or encode, like the DS. Lit materials are lit
  per vertex with the DS formula and the imported area lights (`Light.schedule` by time of day, switched
  without a blend as AreaLightManager).
- **Whose material colours light a map model** follows the decomp: the land takes the template's (AreaLight_
  UseGlobalModelAttributes) only under the outdoor lights (arealight 0 and 3; `Light.indoor` otherwise), and props
  always keep their own (map_prop.c never calls NNS_G3dMdlUseGlb*), under the template's lights either way. Unlit
  polygons keep their vertex colours: the global diffuse would replace one only where DIF_AMB sets it, and every
  unlit material of the outdoor land sends COLOR commands instead (`h_kage` prop shadows keep their own colour).
- **Light view space is the camera's.** Normals turn into the DS's view space (camera looking down -Z, a
  camera-facing normal is +Z) with `viewToWorld`, taken from a three.js camera: `lookAt` on a plain
  Object3D points +Z at the target, which mirrored x and z and lit the walls facing away from the sun.
- **Billboards take the area light too.** Map objects and the billboard field effects (grass, ripples,
  dust, smoke, reflections) use the template's global material colours on a camera-facing quad that
  enables light 0, so they get one colour per template (`billboardLight`) that modulates the texture.
  The '!' over a trainer enables no light and stays at full brightness. Field effect models (surf blob,
  footprints, splashes, shadow) keep their own material colours under the template's lights. Weather is
  2D and unlit.
- **DS per-pixel passes in one composite:** colour plus polygon ID, fog flag and depth; one pass does edge
  marking (the ROM's edge colour tables, one DS pixel wide, blended 17/32 for the DS anti-aliasing) and
  DS fog (our 15-bit depth equals the DS Z-buffer within one unit). Translucent polygons keep the ID and
  fog flag under them. The edge table never changes by time, as on the DS.
- **Translucency follows the DS rules** (GBATEK "DS 3D Alpha Blending"). A polygon is translucent at polygon alpha
  under 31 or with an a3i5/a5i3 texture. Its pixel alpha is ((texel + 1) × (polygon + 1) − 1) / 32: 0 is not drawn,
  31 is an opaque pixel (depth, polygon ID, fog flag), 1..30 blends at (alpha + 1) / 32 after the opaque polygons.
  A texture with both opaque and translucent texels (puddle rims, the Iron Ruins floor) draws its opaque texels with
  the opaque polygons and the rest from a child mesh; a texture with only 0 and 31 stays a cut-out. Translucent
  pixels write depth only with the material's depth-update bit (no field map material sets it), and one is not
  drawn over a translucent pixel of the same polygon ID (the stencil holds it), so overlapping shadows blend once.
- **Billboards are opaque** (alpha-tested) so they write their own polygon ID. The DS gives the whole quad the
  anchor's depth (object z + 6), as if it leaned back with the camera; drawn so, its top cuts into walls behind and
  its low pixels sink to the ground our texture cards stand on. Ours take the depth of a plane leaning back from
  the anchor 6 units per 16 up and upright from the object's own position: walls behind stay behind, counters in
  front stay in front, and a surface leaning back over the anchor covers the sprite as on the DS (Pastoria City's
  face-in-hole board shows only the face of a character behind it). Under a map surface their head depth is capped by the connected faces above them; low faces
  over walkable floor and the frame's margins do not cap.
- **Billboard model nodes turn as drawn.** A node with the SBC BB (BBY) flag takes the camera's rotation (about its
  own Y) each time it is drawn, keeping its position and scale, and is lit by its local normals in view space: the
  Galactic HQ hall's grunt groups, one wide quad each. No map prop placed on a map has such a node (build models
  571 and 572 do, unused), and the fldeff billboards are drawn as sprites.
- **Reflections hang under the ground,** as on the DS (ov5_021F17B8.c): 12 units under a puddle or reflective
  floor, 16 under river water, 7 units north of the character, drawn before the translucent map polygons. Their
  depth is that of a plane 1 unit under the character's ground, not the quad's own: the quad reaches past a shallow
  puddle bed (Pastoria City, Route 212: 16 units deep), which would hide all but the feet where the DS shows the
  whole reflection. The opaque ground in front still hides them outside the water of the reflective tiles.
- **Flat field effect models** are lifted to 0.5 units over the ground, except the berry soil, which keeps its DS
  height (2 units): the map draws berry plots 0.5 units up, and the soil at that height fought the plot for depth.
- **Texture cards rest on the map:** a leaning single-quad prop is moved along the DS view direction
  until its lowest opaque row meets the ground, so it looks grounded from our wider camera too.
- **Sprite frames follow the DS frame counter** (one update per tick, two on a step's last tick).
- **Zoom widens the view, not the camera:** the DS framing and target stay; the projection widens to the
  view. The minimum zoom keeps the view within 3.5 × 2.5 DS screens, because further out the view passes
  the DS far plane and objects beyond 32 tiles would pop in. Chunk loading follows the view's corners.
- **One-tick pattern frames** (TV screens) are blended with the previous frame: a hard 15 Hz flicker on a
  modern display is not what the DS's LCD showed. Ties between translucent and coplanar opaque polygons
  go to the translucent one.
- **Whole device pixels.** DS screens and scenes are drawn at a whole device-pixel scale; a fractional
  fit is a counted last resort that tests require to stay at zero.
- **Render scale:** Auto caps the field's 3D at 2 device px per CSS px on coarse pointers; 2D keeps the
  full ratio.
- **One WebGL renderer per canvas;** a disposed field frees its scene. Cinematic scene models load on
  first use, not at each mount.
- **The generic HM cut-in is Fly's cut-in without Fly's states** (one `FlyCutIn`, `fly` false: sCutInTaskFuncs closes
  the window after the slide), drawn through the same `FieldView.fly`; its timing (cry on tick 36, done on tick 59)
  is the one the field moves already waited on.
- **Cinematics draw the authored scenes** (ships, Spear Pillar, the Distortion World entry, the title)
  from their own models, cameras and animations, with no procedural stand-ins. Where a scene used both DS
  screens it is recomposed as one; sub-screen-only parts are left out.
- **Enhanced visuals are opt-in** (`packages/render/src/enhanced/`): Options › VISUAL STYLE (DS, SUBTLE, CINEMATIC) and
  ANGLED CAMERA, device settings off by default; the setup asks the style once (DS first and default) and skips the
  question once a style is stored. The DS look pays nothing (one null check per frame); the effects are a
  lazy chunk, and replays and tests keep the DS look. Lighting stays the DS's: the angled camera keeps the DS view
  space for the area light. The angled camera only replaces the DS camera outdoors (towns, cities, routes); caves show
  the void past their rooms. Under it the fog reads linear view depth, shifted so the camera target sits at the DS
  camera's distance, and maps it back through the DS camera's planes to the density table; the rear plane takes the
  fog colour. Fog turns the sun off and lifts the bloom threshold over the fog's pale colour.
- **Night glows come from the map's own light sources:** materials the models name as lights (`light`, `lamp`,
  `_light`, `_lamp`) or windows (`mado`, `window`) are drawn again, additively, with only their bright texels, so a
  glow has its texture's shape and colour (red beacons stay red and blink with their animation) and the bloom spreads
  it. No hand-placed points. Lamps the map draws as plain land texture (Jubilife's plaza) have no glow.
- **Phones take a cheaper post chain** (`lowPower`, a coarse pointer): the bloom at a quarter of the pixels, half the
  AO and sun samples, and depth of field as one 8-tap disc pass instead of two 13-tap passes. A fixed tier, not an
  auto-scale: the same device draws the same frame.
- The 2D layers (weather, darkness, tints, fades) draw on the screen over the post chain's output, never into its
  buffers.
- **Reduce flashing** caps white overlays at 25 % and eases them; black fades are untouched. It follows
  `prefers-reduced-motion` until chosen.

## Audio

- **The DS sound engine in an AudioWorklet.** The sequencer and synth follow the SND driver: 5.2095 ms
  sound frames, tempo, the end rule, channel allocation and priorities, PSG and noise, ADPCM, envelope,
  LFO and sweep. Decibel and sine tables are computed and checked against the ARM7 binary. No third-party
  sound code was read.
- **Two seams:** `AudioHost` (the game's deterministic sound system, a port of sound_system.c and
  field_bgm.c on the tick) and `AudioOutput` (start, stop, volume, pan per handle; the worklet synth in
  the app). The same commands come at the same ticks on every run.
- **One BGM at a time,** as the DS: cutscene BGM stops every sequence first. Battle and trainer-encounter
  music come from the decomp's tables; day and night music follow the game clock.
- **Fast-forward keeps pitch:** the sequencer and fades run N times per sound frame; channels stay in real
  time.
- **The message box's confirm sound comes from the text printer,** as the DS's TextPrinter_Continue: SE_CONFIRM
  when a press ends a {clear}/{scroll} wait, in the field, battle, evolution and intro alike. The closing
  press (wait_button), speed-up presses, a battle message's auto-scroll running out and the battle's
  post-message wait stay silent; talking to someone sounds through the script's own PlaySE.
- **The start menus sound as the DS's** (main_menu.c, mystery_gift_app.c, naming_screen.c): SE_CONFIRM on the
  main menu's moves, choices and B, Mystery Gift's SEQ_PRESENT and list sounds, the naming keyboard's own. The
  DS plays a choice's SE out during the menu's fade; we have no fade there, so a cutscene BGM that follows (the
  title's theme, Rowan's intro) waits for the SE to end. OpenSinnoh's own screens (setup, Options pages,
  data, mods) stay silent: they are not the game's, and DS sounds there would claim they are.
- **The weather sounds as the DS's weather tasks** (ov5_021D5EB8.c): rain loops SEQ_SE_DP_T_AME, heavy rain and the
  thunderstorm SEQ_SE_DP_T_OOAME, at the sequence's own volume with no pan and no fade. The loop starts with the task
  (its fade in, or at full on a map load or the field's return) and stops at the fade out's start, a warp, a battle or a
  menu app that replaces the field map (the start menu, save prompt, shop and item wheel keep it). Each lightning flash
  plays SEQ_SE_DP_T_KAMI2 (long) or SEQ_SE_DP_T_KAMI (short) as it starts, so the world times the flash and the renderer
  draws `FieldView.lightning`. Other weathers are silent. The world runs it on the game tick through the game's sound
  system with its own PRNG: no game state, no game random numbers. The world does not see the renderer's particles
  drain, so a fade out's end is its ramp length (`weatherFadeTicks`), a few ticks before the drawn rain is gone.
- **The Dance Competition's beat clock follows the music as we play it.** The DS drives the dance's frame counter from
  the BGM sequencer; ours plays in the worklet and reports nothing back. The round computes the sequencer's ticks from
  the game tick (the sound frames 1/30 s ticks hold, the song's tempo per frame) and runs the DS's VBlank resync on
  that, so the beat stays on the music the player hears and replays stay exact; steps are graded on their input's tick
  (docs/research/contests.md §6.8).
- Volume and mute are device settings; the DS STEREO/MONO option applies. The audio context suspends with
  the page and resumes on the next gesture.

## Battles

- **Engine:** `@pkmn/sim` (MIT, gen 4, pinned) inside our own controller in `packages/battle`. Pack
  numbers overwrite the sim's through a dex mod built per pack (constructed privately per pack, so no
  global registration leaks). Catch, run, exp, EVs, prize money, trainer AI, Safari and the first-battle
  rules come from the decomp. Battles are deterministic but not frame-identical to a cartridge; porting
  the decomp's engine stays the fallback.
- **The controller is one generator on the tick:** intro, prompts, the turn's protocol in DS order, the DS
  gauge speeds, faints, exp, level-ups, move learning, the end. Battlers are DS ids with owners; doubles,
  two-trainer and tag battles run on the sim's `doubles` and `multi` formats with adapters where the sim
  mixes owners. DS rules win over the sim's (loss when the player's own party is out, prizes, Heal Bell).
- **Trainer AI is the ROM's bytecode** on our interpreter (all 109 commands, kept quirks such as s8
  scores), fed by a view of the sim's state that ports the battle_lib routines it calls.
- **Local dex patches** fix parity gaps against the decomp (accuracy stages, multi-hit, Substitute,
  Pursuit, fog, field weather, EXP rules). Remaining gaps are listed in `docs/research/battle-parity.md`.
- **Messages are the ROM's battle strings** with their markup, printed by the shared `TextPrinter` with
  the battle's flags (A/B and touch speed-up, auto-scroll). Every protocol line maps to a string or the
  test fails.
- **Presentation from the ROM:** the command card is the touch-screen buttons, the target screen and the
  move-learn flow are the decomp's, healthbox digits are the ROM's, and the scene preloads its art (the
  game holds on the cut-in's black screen until it is in; a 5 s watchdog fails loudly).
- **Move animations run the ROM's scripts on our animation VM** (SPL particles, OBJ cells, BG fades), one
  DS frame a tick. A script plays only when everything its static walk reaches is implemented; otherwise
  the battle keeps the generic hit and logs it. Choreography is an independent approximation, not a
  pixel-exact reproduction.
- **The last nine move animations** follow the decomp's functions: BG2 holding a battler's picture
  (LoadPokemonSpriteIntoBg) is a view of its own (`AnimView.bgMon`: the picture, the layer's offsets, its HBlank lines,
  blend, priority and window 0), Surf's and Muddy Water's waves are a background in BG2 (`AnimBgView.custom`), and
  StartBattlerSlideIn mode 0 is the decomp's picture swap (`picture` on battlers and copies), not a slide. Blends draw
  as BG2's or the OBJ's EVA alone, as the other translucent effects do. Spite's darkening of BG palette 8 never shows on
  the DS: LoadPokemonSpriteIntoBg, the next command in the same script frame, loads the picture's palette over both
  buffers before the VBlank transfer, so the picture keeps its own colours. Substitute's doll (mode 2) is not in the
  packs; it keeps its slide.
- **Transform's look stays** (`BattlerView.look`): from the `-transform` line the battler's sprite shows the target's
  species, form, shininess and gender (BtlCmd_Transform's copy, `transformedGender`) until it leaves the field, in the
  scene, the animations' pictures and BG2. Its name, level and healthbox stay its own.
- **The shiny sparkle** is common animation 11 (`shiny`) on the animation VM, played once a shiny Pokémon is in place
  (wild after its slide-in, a send-out after the flash and any capsule seals), before the healthbox slides in. The DS
  runs it beside the healthbox and plays a doubles pair's at once; we play them in turn. Like the DS
  (BattleDisplay_PlayMoveAnimation), it plays with the battle scene off.
- **Layout:** a framed window over the dimmed field on big landscape views, full screen on phones; scene
  and card composed at the largest whole-pixel scale.
- **Items the sim lacks** are known inert (their effect acts outside the battle), not stubs.

## Menus and UI

- **Who owns the screen picks its style.** Whatever the game draws (message boxes, YES/NO, the start menu,
  battle, bag, party, summary, PC, Pokédex, naming, the intro) stays DS-faithful with the ROM's art, font
  and frames. OpenSinnoh's own screens use the OpenSinnoh UI design system, even when opened mid-game.
- **Every menu app is a DS screen** laid out in DS pixels at a whole unit (`ui/board.ts`), windows at the
  decomp's rects. Menus never scroll internally or clip; only lists the DS scrolls do. On phones a DS
  screen sits on a backdrop of its art's edge colours over the whole view.
- **Touch on DS screens:** rows keep their DS size (16 DS px at the unit); a row alone on its line taps
  across its whole window, and the d-pad drives every menu. Outside DS screens targets are 44 px.
- **Text reflows to its window;** message boxes wrap a line only when it does not fit.
- **Words the game draws come from the ROM where the DS has them** (YES/NO, AP/PP, the level mark from the font), so
  the game's language shows. Where the DS has no such text (the gift-code prompt, the Wonder Cards, our credits card),
  a small table per game language. Alphabetical lists (the Pokédex A–Z and name groups, easy chat) sort by code unit
  in English.
- **A medicine that would do nothing goes back to the bag,** as the DS: "It won't have any effect.", then A, B (or a
  tap, in battle) returns to the Bag, in the field (ApplyItemEffectOnPokemon) and in battle (BattlePartyTask_UseItem,
  the error window). A refusal to send a Pokémon in stays on the party. In the field an Egg cannot be picked for an
  item (SEQ_SE_DP_CUSTOM06), and an item's message closes without a sound.
- **Naming keyboard:** the DS layout at its 16 × 19 cells, with physical typing through a hidden text
  field on fine-pointer devices.
- **The Pokédex, Pokétch, Town Map and others are headless models** with ROM art. The Pokétch runs next
  to the field and keeps the decomp's saved data (the memo is lost on app change, as on the DS); its
  timers count game ticks so replays are exact.
- **Keyboard and accessibility:** menus trap Tab, follow the game cursor with focus and restore focus on
  close; Escape is B outside text fields. Canvas-drawn messages are read once per finished page into a
  polite live region.
- **Input:** physical key codes (arrows/WASD, Z/J/Space = A, X/K = B, …); gamepads map positionally.
  Options › Controls rebinds keys and pad buttons; replays use logical buttons only.
- **Touch controls** are one layout (`computeLayout`) for the title, menus, intro and field: d-pad and
  face buttons mirrored, Select and Start centred, sizes S/M/L, an opacity floor, safe-area insets. They
  fade (not hide) during cut-scenes.
- **Page zoom:** gameplay and game-drawn screens disable page zoom (the game has its own); OpenSinnoh's
  screens keep pinch zoom. iOS's loupe and double-tap zoom are cancelled on the game surfaces.
- **Title:** the finished scene from the ROM with our wordmark over it, no intro. CONTINUE, NEW GAME,
  OPTIONS. NEW GAME is Rowan's intro from the ROM, after a one-time setup.
- **One Options screen** from the title and in game: Game, Device, Controls, Data, Privacy. What does not
  work where it is open stays listed, muted, with a reason. Destructive actions confirm, defaulting to No.
- **First run** on the ROM page: one picker, the setup (add-on, error reports, text speed) answered while
  the import runs, and Start playing once the game is ready, never an auto-start.

## OpenSinnoh UI and brand

- **Design system** in `packages/ui`: `tokens.json` is the only source (CSS custom properties for dark and
  light, frames and skins generated from it), original 16-px icons, DOM components. Spec:
  `docs/design-system.md`; gallery at `?ui-gallery` in dev builds.
- **The Distortion look:** a dark face, near-black rim and teal ring; gold for the cursor, chosen value
  and focus; a warm-paper light theme. Frames Distortion, Slim and Drop. Dark follows the system with an
  override.
- **Fonts** (OFL, self-hosted): Pixelify Sans for titles, Silkscreen for numbers and labels, Figtree for
  reading text. Gameplay text always uses the ROM font.
- **Colour by meaning only; no Nintendo IP** (no Poké Ball, sprites or names) in our art; no key-cap hints;
  one focus mark (no ring over the cursor's mark). Setting labels in sentence case.
- **Brand:** the mark is "OS" in a Distortion window with a gold title tab; the wordmark is pixel
  "OpenSinnoh" with a gold O and S. Mark or wordmark, never the two side by side. Both are rect lists in
  `packages/ui/src/brand.ts`; motion is stepped CSS with a static frame under reduced motion; assets come
  from `pnpm brand:assets`. Only on OpenSinnoh's screens and the website, never in game-drawn screens.
- **The credits end with one OpenSinnoh card** after the game's credits (non-affiliation line and
  contributors).
- **The landing page** (`site/`) is its own workspace package built from the design system at build time
  (inline SVG art, CSS tokens, about 1 kB of script).

## Quality-of-life options

- **The pattern:** each QoL item is a device option whose contract default is the DS behaviour, which
  replays and tests run; the app stores the player's default. Additions inside game screens use the ROM's
  art and font, their words in the pack.
- **On by default:** auto-run with the Running Shoes on touch screens (B held walks); repeat Repel
  (HGSS's prompt); a registered-item wheel of four on a held Y; Pokédex name search; intro skip once a
  device has seen Rowan's intro; a suspend point when the page hides; follower talk with the HGSS add-on
  (its global interaction rules; mood is not saved); auto lowercase after the first capital on the naming
  keyboard (not Platinum's); trade evolutions without a trade (labelled, off is faithful).
- **The objective:** the start menu shows the next story beat in a field window beside it (above it on phones), on
  by default. It is derived, never tracked: an ordered table in the pack (`NewGame.objectives`, our words, written by
  the importer) whose first step with no check holding is shown; each step also lists a later beat that proves it
  (the next badge, the Champion's clear), so a skipped or reset marker never brings an old step back. With every
  step done it says "Explore Sinnoh." The ROM test checks it at every story checkpoint's end.
  A step that leads to a town or city names it (`to`, a Town Map fly location's zone); the Town Map marks that block
  in its own hovered palette, blinking at half the hover's speed and drawn even while locked. The Pokétch's Marking
  Map has no sprite that reads as a destination (its markers are the player's, the roamer dot means a roamer), so it
  shows none.
- **Off by default:** EV/IV view on the summary; RENAME on the summary; the HGSS player characters with
  the add-on; the Spiritomb substitute (Underground vendor talks count in place of link players).
- **Game speed:** fast-forward at 2x to 8x, presentation only (the same 30 Hz ticks, more per wall
  second); the device clock is not sped up. Fast ticks run only while a frame's work stays under 10 ms;
  the rest is dropped, never owed.
- **Not offered:** PC from anywhere, quick-save slots, instant text, cutscene skip.

## Post-game and side systems

- **Super Contests, offline** (docs/research/contests.md): the Hall's scripts run as on the DS; the running contest is
  `GameState.contest`, plain JSON that lives from `new_contest` to `end_contest` (saves happen between scripts, so no
  save holds one); only the winner photos are new save data (schema v20). The contest app runs the rounds through one
  seam (`CreateContestRound`) and owns the final scoring and results, so each round lane works behind it alone.
- **Contest randomness:** its own LCRNG in the session, seeded by one draw of the main stream at entry (the DS reseeds
  from the clock); the rounds draw from it in a fixed order, so a contest replays exactly.
- **Placeholder rounds** stand in until the round lanes land: no gameplay, scored from condition only, labelled on
  screen, logged once (`contest:placeholder:<round>`) and counted in the coverage report (`CONTEST_ROUNDS_STATUS`).
- **The contest's DS screens** (reception, results) are DS windows in the ROM's frames and font; the results table is
  one line per entry (the DS's results screen art is the visual lane's).
- **The visual round** follows overlay022/017 frame by frame (docs/research/contests.md §5): accessories are picked
  by their pixels, go "on the Pokémon" by its pixels (each front picture carries its opaque runs,
  `PokemonFace.opaque`), and the photo keeps those and what touches them. The case's scatter uses a local LCRNG seeded
  from the contest RNG's state without drawing (the DS uses MTRNG); the judging draws from the contest RNG as the DS
  does. The DS has no keys here: the PC's hand stands in for the stylus (Y jumps to the next item or the Pokémon's
  head), so replays dress up by keys. Its one screen folds the top screen's clock, theme and count into a line.
- **The acting round** (contest/acting-rules.ts, acting.ts) keeps the decomp's own state (the turn's per-act fields
  and their snapshots) rather than a cleaner model: the pity points compare snapshots taken at different steps, and the
  forced next-turn places wrap in a 2-bit field, so only the same state gives the same results. Its tables (base appeal,
  effect classes, voltage, the acting messages, the AI's 165 rules) come from the ROM's code; the effect handlers and
  the AI's 28 conditions are code keyed by their ids.
- **Acting round progress in the session** (`ContestSession.acting`: turn, choosing): replays wait on it with `until
  state`, as the turns' lengths depend on the rivals' moves.
- **Contest move animations** run on the battle animation VM in its contest mode (`AnimDeps.contest`) through
  `AppHost.contestAnimation`, loaded with the battle engine's chunk; the contest app does not tick until it is in, so
  a run with animations never differs from one that loaded late. The sprite callbacks with a contest branch
  (StringShot, Trick, Taunt, Fissure) follow the decomp in both modes, and every move script plays in a contest. The
  acting screen draws the performer's sprite copies and BG2 too; a picture of the hidden target (BG2 in Sketch, Spite
  and Extrasensory, Role Play's copy) shows that Pokémon as the DS loads it.
- **The dancers wear their outfits** (decomp ov17_0224A134: each dancer is its dress-up record, drawn without the
  backdrop and scaled, turned and shaded about the Pokémon's centre): the visual round's outfits in a full contest, none
  in the Dance Competition alone (sub_02095338 clears them). The acting round draws the battle back picture, as the DS
  does, with no accessories.
- **The acting screen** is the DS main screen as one canvas; the touch screen's move and judge menus are a card over
  the stage while the player chooses (its own place under the stage on phones in portrait), and the judge buttons
  carry the judges' voltage meters, which the card covers.
- **The TV** (docs/research/tv.md) is the DS's field message box, as on the DS: no TV screen app exists in Platinum.
  Its saved block is `GameState.tv` (schema v23) without the Wi-Fi episodes; segment data is typed per segment (a
  tagged union) instead of the DS's 40-byte unions, so saves validate it. The recorders are shared state edits in
  contracts (like the journal's), called at the decomp's hooks in the world, VM, menus and game; the broadcast is a
  services module the VM's `call_tv_broadcast` drives. Its MTRNG and LCRNG draws are the main stream's, in the DS's
  order, so a watch replays exactly. The DS's quirk of excluding played segments only up to the first ineligible one
  is kept.
- **The TV gallery's dress-up** shares the visual round's case and stage (menus `contest/dress-up.ts`) behind a gallery
  flag, as overlay022 does, rather than a copy; the app writes `dressUpPhotos[0]` itself at its exit as
  `ov22_02256098` does, and the script sets the title. Offline only slot 0 is ever filled (the rest is record mixing).
- **Offline equivalences:** without a link, the decomp's comm syncs pass at once and `message_synchronized` is a plain
  message (ScrCmd_MessageSynchronized without CommSys); HBlank start/stop and the network icon do nothing here.

- **Story and post-game** follow the ROM's scripts; branches (starter, gender, losses, legendary
  outcomes) are covered by branch replays.
- **Legendary events:** Platinum's own Mystery Gift flow (unlocked in game, gifts from the Poké Mart
  deliveryman) receives built-in gifts by gift code instead of wireless: Member Card, Oak's Letter, Azure
  Flute, Secret Key and a fateful Regigigas. Gifts set the ROM's own flags, vars and items; no
  distribution data is copied. Codes are checked locally against salted SHA-256 hashes, case- and
  space-insensitive, once per save; the plain codes are not in the repo. Tests and replays use test-only
  codes and a dev/test flag (`grantDevEvent`) that makes the same edits.
- **Battle Tower** runs on the frontier VM; the challenge's saved part is `GameState.frontier`. No
  wireless: link entries answer cancel and go back to their menus.
- **Battle Factory and Battle Hall** run on the same frontier VM; each challenge is a services object the frontier
  owns from its Init to its Free command, and their saved parts are `FrontierState.factory` and `.hall`. Their draws
  are the game's RNG (the decomp's LCRNG_Next), not a facility LCG. Their tables (pools, ranges, BP, the Hall's 477
  opponents and their types, ranks, milestones) are read from overlay 104 and arm9, checked against pl_btdpm,
  pl_bsdpm and pl_btdtr. Link-only commands (the multi challenges) are left unimplemented; no single-player path
  reaches them. The rental app and the type board are DS scenes from the ROM's art; the facilities' particle
  effects are logged stand-ins.
- **Battle Castle and Battle Arcade** follow the same pattern (`FrontierState.castle`, `.arcade`; tables from
  overlays 104, 107 and 108). The Castle's CP spends and rank-ups happen inside its app, as on the DS; a resumed
  challenge rebuilds the opponents from their trainer's IVs (the DS reads an uninitialised list there). The Arcade's
  board is one screen with its STOP button at half size in the free corner (the DS has it alone on the touch screen);
  A stops the board too. Its effects reach the battle as `FrontierBattle.weather` and `.sleep` (the DS's sleep turns)
  besides the parties. Frontier scripts' A/B waits show in `FrontierView.waitsForAB`, so replays' `advance text` presses
  through them, and loaded characters stay loaded across scene changes (the decomp keeps them in one table).
- **Frontier scene effects run on the battle's SPL port** (`@opensinnoh/battle/particles`, a subpath without the battle
  engine, so the frontier VM can wait on emitters headless): the scene owns up to 8 particle systems from
  `frontier_particle.narc`, drawn then updated each frame, on one SPL random stream seeded 0 (the DS's global is never
  seeded). The Brain cut-in is its own state machine in the scene (the decomp's task, banner and palette tasks), drawn
  from field_encounteffect's art; it starts the Brain music, which the battle then keeps instead of restarting. The
  Factory door light is a BG3 patch per palette step and the Hall lights a second BG3 frame, both imported. The Hall
  room's palette task changes a standard BG palette no 8bpp layer reads, so it is not modelled. The Castle room's BG2,
  particles and characters share priority 2: BG2 and the particles go under the characters there.
- **The facilities' pre-battle wipes** (FrontierScrCmd_3F) are stepped headless in the frontier VM and drawn from the
  view: the Hall's and the Arcade's as the black rects their block steppers fill on BG1, the Factory's and the Castle's
  as one affine reference point per line pair for BG2 and BG3. A reference point written in H-blank is that line's
  origin on the hardware, so each pair shows the layer's row at the point's y (the decomp reads BG2's and BG3's X offset
  for both axes, kept). The brightness ramps are drawn as the scene's fade. Type 5 (an endless BG3 wave) is in no
  script and throws.
- **The record viewer** reads the saved Frontier state as the DS's app reads its save (the Hall's latest streak only for
  the species that set it; always PREV there). Its text comes from the ROM's records bank by name, so packs without it
  (the fixture) have no record viewer. The Hall's record list is a scripted list menu built from the A–Z name groups
  the Pokédex sorts by (zukan_data's lists, which the ROM test compares).
- **Underground (solo):** the Explorer Kit, mining from ROM tables, spheres, vendors, fossils, traps and the
  secret base. Seeds come from the clock and the trainer id, not ticks, so boards are the same whatever
  replays wait. No link play: other players' traps, bases and flags have no stand-in.
- **Underground traps:** the player's laid traps go off under them too (the DS's alone mode loads them like a
  link's), as do the day's hidden ones; A digs either up. Each trap's screen is an app over the field; the
  slide, the hole and the altered steps are the field's. The microphone traps take held A or a held touch as
  a fixed blow. The escape games' rolls (bubbles, leaves, the smoke's pattern) take the visit's mining
  generator, as the DS's CommSys_Seed does; the smoke's pattern is LCRNG on the DS. The TV's traps record counts the
  day's hidden traps dug up in a visit: their slots give them a setter that is never the player (docs/research/tv.md).
- **Underground drawn details:** the '!' and OK over the player are the Underground's own fldeff models (23, 24),
  turned to the camera, not the field's emote; the rock trap's shadow is the floor circle the trap screen grows through
  `AppHost.undergroundTrapShadow`, since the screen is an app over a field that does not step. The slide needs nothing
  drawn of its own: the held frame (LOCK_DIR, PAUSE_ANIMATION) is the DS's pose. The way down and up are 2D sprites in
  a DS frame centred on the view, as Fly's cut-in; the fall and the rise keep the time they spend on the DS's other
  screen without drawing it.
- **Secret base:** Platinum has one base layout (every base chunk is the same room). Solo, the base is drawn
  in chunk (0, 0) with the entrance closed and (1, 0) with it open, as the DS's alone mode does; a loaded
  save in a base knows which by the chunk. Flags come only from other players' bases, so the solo base keeps
  the normal flag: ten goods, sixteen boulders that stay, no PC radar. The base and laid traps are saved
  (schema v21); the DS cannot save underground, replays reload anywhere.
- **Side systems:** berries (growth on whole clock minutes, "on screen" being the DS's 16×12 tiles, not
  our camera), honey trees, the Poké Radar, swarms, the Trophy Garden, the Great Marsh (the Safari battle
  runs in the battle controller), Poffins (stylus arc physics; keys stand in), condition, Amity Square,
  move tutors, NPC trades, the daycare and eggs, Fly and Teleport, Vs. Seeker, fishing, Escape Rope, the
  lottery and daily events. Rules live in core where several packages need them.
- **Not built:** Pal Park (no GBA slot, no substitute), link and Wi-Fi features, battle videos.
- **Hall of Fame and credits** follow the decomp's timings in one screen; the clear writes the save and
  reloads.
- **Seals and Ball Capsules** (docs/research/seals.md): Platinum has no Solaceon seal shop or daily seal clerk; the
  sources are the Solaceon east-house mother and Unown boy, the Sunyshore Market merchant's stock per weekday and
  Mystery Gift, all run by the real seal ops. A party Pokémon carries a copy of its capsule (`Pokemon.capsule`), as the
  DS does; boxes and the Day-Care never hold one (the PC refuses, the Day-Care and NPC trades ask to detach).
- **On phones the capsule editor** is a full-screen DS screen like the mart's buy list (`.mart-screen`: centred over an
  opaque backdrop); a board patched in place repaints that backdrop when its picture changes.
- **The capsule editor** is one board: the DS touch screen plus a 48 px strip for the message the DS shows on its other
  screen. Editing is touch-only on the DS; our keys add a hand that jumps between list seals, buttons and placed seals,
  moves a held seal pixel by pixel with acceleration, drops it with A and returns it to the case with B. Its Test plays
  the battle's send-out effect on a copy of the Pokémon, stepped headless in the menu model through
  `@opensinnoh/battle/particles` (its own SPL stream), with the decomp's ball, timing and sounds. Its length comes from
  that simulation, and the single board shows the top screen only while the throw plays.
- **The seals' send-out effect** runs in the battle on the battle's SPL, one system per seal, from the frame the ball
  opens, with the ROM's delays by distance. Only a capsule holds the send-out until its seals end; the default ball burst
  plays without holding, so battles without capsules keep their tick counts. Ball-particle SPAs share `particleSystems`
  with `archive: 'ball'`. The ball-open sound is SDAT 1798.
- **Slot machines** (docs/research/game-corner.md): the model steps the DS's 64 states and its tasks frame by frame, in
  the DS's order, so a reel lands from the frame of its press and the timing rules match. The app has its own LCRNG,
  seeded by one draw of the main stream at `scr_cmd_267` (the DS uses its global LCRNG); the machine's mode is the day's
  shuffle of `dailyRandom`. DS quirks are kept (the payout is the last winning line's rate times the lines won; the
  standby lottery checks one share twice).
- **The slot screen** is one composition: the moonlit field above, the machine below, Clefairy and the ball on the
  cabinet's top edge. Touch is ours: a reel's column stops it and the help bar's three parts bet, spin and quit. Lamp and
  moon fades are alpha blends of separately imported lit or recoloured cells.
- **The Villa's furniture** is a map feature built from its flags on each map load (props, player collision, a talk
  hook after bg events), not hidden props: a purchase warps into the Villa again, so the new piece appears with that
  load, as on the DS. The daily visitor uses the field stream after the daily level.
- **The journal** rules are shared state edits in contracts, called at the decomp's hooks (map changes, battle ends,
  marts, the PC, the Safari Game, field moves, `create_journal_event` for its few real types). Nothing is recorded
  before FLAG_JOURNAL_ACQUIRED. The page rolls only at a load or at `give_journal`, never at midnight; the auto-open on
  a load shows the pages as saved.
- **One schema bump for the town extras:** v22 adds the Seal Case and the journal together.
- **The Vs. Seeker** runs as on the DS: the item starts its script, whose `start_vs_seeker` is a world task stepped one
  native state per frame (objects pause, the scan, the raised avatar and the beep, '!' and '!!' with the spin). The rematch
  roll stays on the field stream. The '!!' is its own fldeff texture (member 13), not the '!'.
- **Footprints:** Dr. Footstep's types come from the ROM's `sFootprintTypes` (overlay 5), not the decomp's species data,
  which differ for Spiritomb (the ROM gives it a print). The Pokédex footprint images were already imported.
- **The Vista Lighthouse binoculars** reuse the Great Marsh lookout's temporary map change and circle fade. Their camera is
  a `FieldView.viewCamera` record built from the decomp's raw values; enhanced visuals stay off while it is up.
- **Game records:** RECORD_STEPS counts when a player step starts, at the decomp's PlayerAvatar_IncrementStepsRecord sites
  (not forced slides, bumps, bike coasting, overworld ledge jumps or the fourth gear's ramp). RECORD_EGGS_HATCHED and
  score event 15 count when the field step starts a hatch (Field_UpdateDaycare), before the scene.

## Mods

- **Original mods only** ship in the app build (`packs/platinum-demo`: JSON Patches and new text records,
  no ROM content). Dev-served mods replace bundled ones with the same id.
- **Mods patch records and override script labels;** load order base, add-ons, mods. Follow rules, starter
  slots and zone data are records so a mod can change them.
- **A mod change restarts from the last save** when the new pack set accepts it.

## Testing

- **Independent browser starts.** Story suffixes load the nearest chain anchor, carrying its real battle
  history and replay policies so cumulative assertions remain intact. Imported files are seeded once per
  worker/context options; cases reset their own game/device/save state. Import, autoplay and cold-art
  checks keep dedicated contexts. Pixel counterfactuals retain their samples, masks and thresholds;
  capture waits for readiness and a later completed draw. The historical profile is in
  [`research/browser-suite-profile.md`](research/browser-suite-profile.md).

- **Fixture first.** Unit tests and pack replays use original fixtures (`packs/fixture`, or bytes our own
  writers generate). ROM tests read `OPENSINNOH_NDS_ROM` (and `OPENSINNOH_HGSS_ROM` for the add-on) and
  skip without it. No ROM text, images or tables appear in committed tests: replays name messages by text
  id.
- **Replays are the main proof.** A replay runs twice from the same seed and must match, then save,
  reset, load: the loaded state must equal the save byte for byte. One runner, two drivers (headless and
  the browser bridge).
- **Browser checks after `advance`** wait for the drawn state with the replay checks' 30 s timeout, once the field scene
  has loaded: under load a frame (which also draws the field) can take seconds, while the tick itself is deterministic.
- **Replays wait on the game, not recorded ticks:** `until message|yesno|menu|position|state|wild`,
  `advance text`, asserts by content. Step arguments may read state the player can see (a clue's door).
  Setup lines apply through snapshot → edit → load. A replay's grammar is the only input it has; the dev
  recorder writes only what the grammar spells and stops otherwise.
- **Replays and ROM tests hold in every language.** The script bytecode is the same in every language's game, but
  the text is not: each language splits it into its own pages, prints it in other ticks and sorts its word lists its
  own way. So a conversation is one `advance message` (or `advance text`), not a counted chain of A presses; a wait
  that a timed press covered becomes a wait on the game; words are named by text or record id (`assert text`,
  `assert state <path> <id>`, `tap word:<id>`), and a ROM test compares with `texts.get(id)`. Browser specs do
  the same: the game's words come from its records.
- **Story checkpoints** chain from a new game to the post-game, each run twice on seeds 1–3 with save
  round trips and late starts. Chunk replays start from cached anchors keyed by every replay text, the
  import and the engine's sources; an anchor proof replays the chain from a new game. Chain replays carry
  no setup lines except two set-team steps (before Cyrus and before the rematches), because the replay
  auto policy does not heal or switch mid-battle. Branch replays may stage their start.
- **Stub allowlists:** each story replay lists every stub it meets, per seed; a new stub or a listed one
  no longer met fails.
- **Pending is checked, not trusted:** a replay waiting on a feature fails once the feature works.
- **Browser tests prove pixels, not just state:** non-blank frames, with-and-without comparisons for
  effects, measured row centres and overlaps, whole-pixel fits, axe and contrast checks. They run on a
  built preview with dev hooks, across desktop, phone, landscape and tablet projects. ROM screenshots stay
  in ignored `test-artifacts`.
- **ROM tests share one import** per run (`romSlice()`, cached by ROM SHA-1, `IMPORTER_VERSION` and the
  importer's sources); browser specs seed it (`seedRomImport`).
- **Tiers:** fast (`pnpm test:changed`, one file, changed browser specs) while working; full
  (`pnpm check`, ROM `pnpm test`, ROM `pnpm test:browser`) before merging. `pnpm check` runs lint,
  typecheck, unit tests and pack replays in parallel. Browser runs shard natively and merge reports.
  Vitest runs with `isolate: false`, so test files must not rely on fresh module state.
- **Long ROM work is spread over files;** vitest runs files in parallel and tests in a file in order.
- **`pnpm flaky`** repeats a test in fresh processes, without retries, to measure a pass rate.
- **Specs hold under a full-suite load** (ten workers on software GL, where a frame can take seconds): waits count drawn
  frames or wait for the state or event itself, never wall time; speed checks measure the ticks the loop asks for (run
  and dropped), and perf checks compare with the same machine's 1x; heap checks count live objects in a snapshot, not
  the used heap (the JIT's code comes and goes); ROM specs take the worker's seeded context (`romContext`) instead of
  copying the import per file; each test in a serial file sets up its own start.
- **The zone sweep** spawns at every warp arrival and every zone, with exemptions as exact lists.

## Performance

- **`pnpm perf`** plays every scene from CONTINUE in the real loop at desktop, phone-4× and phone-6×
  throttling, against budgets in `tools/perf-budgets.json` (frame and tick percentiles, heap, textures,
  storage, import time and peak, bundle sizes).
- **Memory is the private footprint** (`phys_footprint`), not RSS, which counts shared and freed pages.
- **Bundle budgets** are our own guardrails: the ROM page loads a small boot chunk and the game is a
  dynamic chunk; the opt-in error-report chunk is its own line. We raise a budget as content grows rather
  than trim, unless load times suffer.
- **Cold starts:** the battle engine is warmed with one throwaway turn when idle.
- **A splash from the first paint:** `index.html` draws the wordmark and a busy bar (`.os-prog`) before any script,
  its art and colours generated from `brand.ts` and `tokens.json` at build time (`tools/splash.ts`). The app names
  each start phase on it (`splash.ts`) and removes it only once its first real screen is up (the title's first
  frame, under a 15-frame fade; the ROM page; the crash screen). A phase past its time shows a hint and Reload,
  never a silent spinner. The game chunk downloads while the stored import is checked and read.
- **The field shows only once its scene is in.** A map load (CONTINUE, a loaded save, a new game, a warp) starts the
  world's fade at full black; the app's loop holds the game there while the scene in view loads (the chunks under the
  view's footprint plus 4 tiles, their models and textures, the sprites, the weather) and for two drawn frames after it
  (programs compile and textures upload under the black), then the DS fade-in plays. Chunks in view build first and
  all at once; the ones around them may still build. The last 32 land models stay parsed, so a map visited again (out
  of a house) builds without reading storage: a warm warp adds one or two frames to the black. Presentation only: the same ticks run later, and replays never wait. Reduced
  motion keeps this fade: it is the game's own, as on every warp.
- **Stored assets are read in batches:** the reads asked for in one task share one IndexedDB transaction
  (`batchedReader`, store.ts), each resolving on its own so decoding starts while the rest are read. One transaction per
  file queued in the browser (160 ms per read on average over a first visit's 130). Texture scans (alpha, sprite feet)
  read pixels through a `willReadFrequently` canvas: a GPU canvas read each texture back.
- **The import check is cheap at start:** every start counts the import's files (no file is read) and looks for the
  pack data; the full size check, which reads every Blob handle, runs once per import (in the import worker as it finishes, or on
  the first start of an import stored before it) and marks the meta row `checked`.
- **An engine update's old import is removed after the ROM page shows;** the next import's space check waits for it.
- **Pack records are validated in a fast pass** without paths or errors; only a failing record is walked again for the
  message.
- **A hidden page stops the loop;** hidden time is not played back.
- **The field builds the world's view once per frame.** The reveal's frame count asks the renderer whether the scene is
  loading only under the full black (it builds the view again); the neighbouring zones' preview objects are read from
  the nine 32-tile squares around the player, not from every object of the matrix; a clock reading's date is checked
  once; the ceiling index keys vertices by number; the session's font and window art are read in one transaction.
  The same pictures and ticks. Measured on a loaded machine, phone-4× (390×844, DPR 3, two runs each, base → after):
  Jubilife frame p50/p95 6.0/8.8 → 4.2/5.8 ms, Route 205 4.9/6.8 → 3.8/4.8 ms, CONTINUE to the field 1.3 → 0.95 s, the
  first warp into Jubilife holds the black 835 → 335 ms. Desktop frames stay about 1 ms. What is left of the frame is
  mostly three.js's own per-draw work (about 100 draws in Jubilife).

## Privacy and telemetry

- **Error reports are opt-in** (asked at setup; nothing is sent before the answer). Sentry loads as a
  lazy chunk only when allowed and only in builds with a DSN; no default integrations, tracing, replay
  or PII. A scrubber replaces names, quoted text, file names and local paths, and keeps only allowed URL
  parameters. A crash screen shows the scrubbed report text to copy.
- **Performance summary:** once per session, after 2 minutes of play, anonymous, no game state, only when
  error reports are on.
- **Anonymous analytics:** PostHog EU in cookieless mode, one `fetch` per event (no SDK), nothing stored
  in the browser, no IP kept, daily-rotating server hash. A fixed property list (site, version, device,
  viewport bucket, event fields); unknown properties are dropped. Do Not Track and GPC are honoured; sent
  only from production deployments. The landing FAQ, the setup and Options › Privacy say so.
- **The app holds no host name;** the manifest, worker and DSN are origin-relative or come from the build.

## Deployment

- **Static hosting** (Vercel): the game at `play.opensinnoh.com`, the landing page at `opensinnoh.com` as
  its own project.
- **PWA:** the service worker precaches the build's file list with a content hash; navigation and built
  files are cache-first from the session's build, so a deploy cannot take a running session's chunks away.
  A new version waits (no `skipWaiting`) until the player restarts from a toast or Options › Data. Chunk
  loads retry once, then offer a reload.
- **Install:** an install row appears only while the browser offers one; the manifest has a Continue
  shortcut and screenshots of the ROM page (no ROM content).
- **Phone features** are feature-detected with no fallback: wake lock while playing, haptics on control
  presses, fullscreen where supported.
- **CI** runs on demand; it has no ROM, so ROM tests skip there.
