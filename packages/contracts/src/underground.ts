/**
 * 0.33.0. The Underground, solo (decomp src/underground.c, src/underground/{mining,spheres,vendors,menus,
 * manager,top_screen}.c, src/underground_map_transition.c, src/scrcmd_underground_inventory.c, src/scrcmd_fossil.c):
 * its tables (read from the player's ROM), its save block, the field's view of it and its menu apps. Link play
 * (other players, gifts, flags, helping) has no part here.
 * 0.37.0: traps (traps.c) and the secret base (secret_bases.c, base_decoration.c, decoration_menu.c, pc.c).
 */
import type { Id, MiningObject, SpherePrice, UndergroundState as CoreUndergroundState } from '@opensinnoh/core';
import type { AppField, AppMenu, AppMessage, AppYesNo } from './apps.ts';

export type { BuriedSphere, MiningObject, Sphere, SpherePrice } from '@opensinnoh/core';

/**
 * 0.33.0. The Underground's tables (decomp overlay 23 and arm9 data, read from the player's ROM; `NewGame.underground`).
 * - `zone`: MAP_HEADER_UNDERGROUND. `miningObjects`: sMiningObjects in table order (the rocks last).
 * - `treasureItems`: sMiningItems, the bag item of each treasure from MINING_ID.treasures on
 *   (Underground_ConvertTreasureToBagItem). `fossils`: sFossilItemToSpeciesMapping (scrcmd_fossil.c), in order.
 * - `trapPrices` by trap id (sTrapPrices), `treasurePrices` by mining id (sTreasurePrices), `goods` by good id
 *   (goods.c sGoodData: the sphere price and whether it needs the National Pokédex).
 * - `vendors`: sUndergroundVendors (vendors.c): each vendor's kind and tile, in vendor-index order. `spawnTraps`:
 *   Traps_SpawnRandomTrap's table (traps.c), the traps that spawn in the corridors.
 * - `flags`/`vars`: FLAG_ENTERED_UNDERGROUND, FLAG_DIGGING_FOR_FOSSILS, FLAG_SPHERE_ACQUIRED;
 *   VAR_UNDERGROUND_FOSSILS_UNEARTHED, VAR_SPIRITOMB_COUNTER.
 * - `sparkle`: the buried sphere's sparkle (FIELD_EFFECT_RENDERER_09: fldeff 92 with pattern 164).
 */
export interface UndergroundTables {
  zone: Id;
  miningObjects: MiningObject[];
  treasureItems: Id[];
  fossils: { item: Id; species: Id }[];
  trapPrices: SpherePrice[];
  treasurePrices: SpherePrice[];
  goods: UndergroundGood[];
  vendors: { kind: 'goods' | 'traps' | 'treasures'; x: number; z: number }[];
  spawnTraps: number[];
  flags: { entered: Id; digging: Id; sphereAcquired: Id };
  vars: { fossilsUnearthed: Id; spiritomb: Id };
  sparkle: Id;
  /** 0.37.0. Traps and the secret base. */
  traps: UndergroundTrapTables;
  base: UndergroundBaseTables;
}

/**
 * 0.37.0. A good (goods.c sGoodData) by good id: the sphere price, whether it needs the National Pokédex, its size in
 * tiles and 3×3 collision mask (row-major from its corner), its A message (`interact`: the TEXT_BANK_UNDERGROUND_RECORDS
 * message, 0 none) and its prop (AreaDataManager_GetMapPropModelID: the Underground area's prop list at the good id;
 * null in an import that did not convert it, the slice). Goods 1–5 are the PC by flag rank, 6 the boulder, 129–132 the
 * base entrances (north, south, west, east).
 */
export interface UndergroundGood {
  price: SpherePrice;
  natDex: boolean;
  width: number;
  depth: number;
  collision: number[];
  interact: number;
  prop: Id | null;
}

/**
 * 0.37.0. The traps' data (traps.c, ug_trap.narc): the smoke trap's four patterns and the big one (NSCR entries, 32×24
 * tiles: the character number in bits 0–9 is the smoke's thickness 0–5, bits 10–11 its flips); the floor marks of the
 * player's own laid traps by trap id (ov5_DrawFloorTexture: fldeff 26 + trap − 1) and the hole's black circle (fldeff 25)
 * as field effects; VAR_UNDERGROUND_TRAPS_SET.
 */
export interface UndergroundTrapTables {
  smoke: number[][];
  bigSmoke: number[];
  marks: Id[];
  hole: Id;
  vars: { trapsSet: Id };
}

/**
 * 0.37.0. The secret base: the decoration cursor's model (/data/ug_base_cur.nsbmd, null when not converted), the flags
 * FLAG_CREATED_SECRET_BASE and FLAG_DECORATED_SECRET_BASE.
 */
export interface UndergroundBaseTables {
  cursor: Id | null;
  flags: { created: Id; decorated: Id };
}

/**
 * 0.33.0. The Underground's save block (decomp `Underground` and its UndergroundRecord; `GameState.underground`), the
 * solo part. Absent until the first system writes it (core `underground`): a new game's has `seed` from the game seed
 * (the DS's RTC-based one, Underground_Init) and `respawn` set.
 * - `seed`: randomSeed (the spots' spawn, the vendors' stock and prices, the daily growth; a day change moves it).
 * - `respawn`: shouldSpawnNewBuriedObjects (the next entry spawns new spots and traps). `mined`: hasMined (the
 *   tutorial's three-item board, then rocks too).
 * - `spheres`, `treasures` (mining ids), `traps` (trap ids), `goods` (the goods bag) and `goodsPc` (the goods PC):
 *   compact inventories in slot order, at most `UNDERGROUND_LIMITS`.
 * - `buried`: the buried spheres in slot order. `spots`: the mining spots, ordered by z then x (the DS's in-memory
 *   order, Mining_AddNewMiningSpot; a dug one goes). `spawnedTraps`: the spawned traps by index (null: none), for the traps to come.
 * - `plates`: minedPlates (bit n: plate MINING_ID.plates + n was dug; none comes twice).
 * - `records`: the UndergroundRecord counts the solo game keeps (spheres, fossils and other treasure dug). `steps`:
 *   stepCount (0–99; its 50th step scores TRAINER_SCORE_EVENT_UNDERGROUND_100_STEPS).
 * - `vendorTalks`: NOT DS. The vendors talked to this visit (vendor indexes; the Spiritomb option's count, cleared on entry).
 * - 0.37.0 (schema v21): `placedTraps` (the player's laid traps, oldest first, at most 16), `base` (core `SecretBase`: the
 *   entrance, the goods on display by slot with their goods PC slot, the boulders; null before the Digger Drill),
 *   `records.trapsTriggered` and `records.baseMoves`.
 */
export type UndergroundState = CoreUndergroundState;

/**
 * 0.33.0. The Underground on the field (`World.undergroundView`): what the DS's top screen shows, as a card over the
 * field (decomp top_screen.c): the whole Underground map (underg_radar.narc's background) with the player's marker and
 * the radar's blips (positions in main-area tiles: x − 32, z − 64; MARKER_ANIM_* animation ids), and its two-line
 * message ticker (the last lines queued: "{player} has entered.", "… is digging for Treasure!", "… was obtained!").
 */
export interface UndergroundFieldView {
  player: { x: number; z: number } | null;
  blips: { x: number; z: number; anim: number }[];
  log: string[];
  /**
   * 0.37.0. The touch radar (TouchRadar_StartTask, a touch on the field): the touched tile, its ring's growth (0–20) and
   * the traps, mining spots and buried spheres found around it (Underground tiles); null when none runs.
   */
  touchRadar: { x: number; z: number; tick: number; traps: { x: number; z: number }[]; spots: { x: number; z: number }[]; spheres: { x: number; z: number }[] } | null;
}

/** Decomp MARKER_ANIM_* (top_screen.c's sprites). */
export const UNDERGROUND_MARKER = { player: 1, base: 3, sphere: 9, trap: 11, spot: 12 } as const;

/**
 * 0.33.0. What the Underground asks the game to open (World `undergroundRequest`), after an A press or X on its field:
 * the mining board for the spot ahead (`mining`), a vendor's shop (`vendor`, the vendor's index), the Underground's menu.
 */
export type UndergroundRequest =
  | { app: 'mining'; spot: number }
  | { app: 'ug-vendor'; vendor: number }
  | { app: 'ug-menu' }
  | { app: 'ug-trap'; trap: number; tool: boolean }
  | { app: 'ug-base'; prompt: UndergroundBasePrompt }
  | { app: 'ug-pc' };

/**
 * 0.37.0. The secret base's field prompts (secret_bases.c): `drill` (SecretBases_DiggerDrillTask: the drill, the
 * cavern, make or move the base?), `enter` (the own base's entrance: go in? leave the entrance open or close it to
 * decorate?), `exit` (the exit: exit the base? with the entrance closed, open the door, and the wireless notice).
 */
export type UndergroundBasePrompt = 'drill' | 'enter' | 'exit';

/**
 * 0.33.0. The mining game (decomp mining.c Mining_GameTask), one 30 Hz frame per view: the wall bulging prompt over the
 * field (`prompt`: the message and YES/NO), then the board in DS px on one 256×192 screen: the interface
 * (ug_fossil.narc: the wall, the crack meter's rows and the tool buttons) with the crack drawn `crack` px long, the
 * buried objects (each object's art cell and its board cell; `shine` the palette step of an uncovered item's shine,
 * 0–2), the dirt (`dirt`, MINING.width × MINING.height layers 0–6, row-major), the tool (`tool`: hammer or pickaxe,
 * the button pressed), the sprites playing (`effects`: ug_anim.narc animation ids at DS px centres, ticks in), the
 * shake offset, the board's fade (0 shown … 16 black; `collapse` for the wall's collapse), the message.
 * Taps: `yes`, `no`, `hit:<x>,<y>` (the stylus on the board, DS px), `hammer`, `pickaxe`, `next`. Keys: the d-pad moves
 * the board cursor (`cursor`), A strikes there, L/R or SELECT switch the tool.
 */
export interface MiningView {
  app: 'mining';
  tick: number;
  phase: 'prompt' | 'board';
  fade: number;
  shake: { x: number; y: number };
  crack: number;
  objects: { sprite: number; palette: number; x: number; y: number; width: number; height: number; shape: string | null; shine: number }[];
  dirt: number[];
  tool: 'hammer' | 'pickaxe';
  effects: { anim: number; x: number; y: number; tick: number }[];
  cursor: { x: number; y: number } | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.33.0. The Underground's menu (decomp menus.c UndergroundMenu_*), DS windows over the field: the start menu (TRAPS,
 * SPHERES, GOODS, TREASURES, the player, GO UP, CLOSE), an inventory list (`list`: its rows, six from `top`, CLOSE at
 * index `rows.length`, the selected row's description), the selected item's window (BURY / PUT IN BAG / TRASH /
 * CANCEL), the player's records, the message box and YES/NO. Taps: `entry:<i>`, `row:<i>`, `close`, `menu:<i>`, `next`,
 * `yes`, `no`, `back`.
 */
export interface UndergroundMenuView {
  app: 'ug-menu';
  entries: { label: string }[] | null;
  cursor: number;
  list: { title: string; rows: { name: string; right: string | null }[]; close: string; cursor: number; top: number; visible: number; description: string } | null;
  menu: AppMenu | null;
  records: { title: string; rows: AppField[] } | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.33.0. A vendor's shop (decomp vendors.c UndergroundVendors_ShopMenuTask), DS windows over the field: the options
 * (BUY / SELL / CANCEL, or the treasure vendor's TRADE / CANCEL), the stock or the player's own list (`list`, with the
 * price window: the required or offered sphere and size), the spheres to pay with, the NPC's message box and YES/NO.
 * Taps: `menu:<i>`, `row:<i>`, `close`, `next`, `yes`, `no`, `back`.
 */
export interface UndergroundVendorView {
  app: 'ug-vendor';
  options: AppMenu | null;
  list: { rows: { name: string; right: string | null }[]; close: string; cursor: number; top: number; visible: number; description: string; heading: string | null } | null;
  price: { label: string; value: string | null } | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.37.0. A trap gone off (decomp Traps_StartTrapEffectClient and its tasks), one 30 Hz frame per view, drawn over the
 * field in DS px (256×192, the touch screen the Underground's field is on): "Oops! {trap}!" and the screen's flash
 * (`brightness`: the BrightnessController's level, +16 white … −16 black), then for the escape games (`game`):
 * - `smoke`: the smoke over the screen (`smoke`: 32×24 NSCR entries; Traps_ClearSmoke thins it where the stylus rubs);
 * - `bubble` / `rock`: the bubbles to pop, the boulder to break (`sprites`: ug_trap.narc OBJ sheets);
 * - `leaf` / `fire`: the leaves to blow away, the flame to blow out (the DS microphone; here held A or a held touch:
 *   `blowing`).
 * Taps: `hit:<x>,<y>` (a stylus press in DS px), `rub:<x>,<y>` (the held stylus' point this tick), `rub:end`,
 * `blow:on`, `blow:off`. Keys: the d-pad moves the stylus `cursor` (the smoke rubs along it), A presses there (and
 * blows). The slide, hole, altering and alert traps show the message and flash only; the field takes over after.
 */
export interface UndergroundTrapView {
  app: 'ug-trap';
  trap: number;
  game: 'smoke' | 'bubble' | 'rock' | 'leaf' | 'fire' | null;
  tick: number;
  brightness: number;
  message: AppMessage | null;
  smoke: number[] | null;
  sprites: { sheet: string; anim: number; x: number; y: number; scale: number; tick: number; translucent?: true }[];
  cursor: { x: number; y: number } | null;
  blowing: boolean;
}

/**
 * 0.37.0. A secret base prompt (`UndergroundBasePrompt`), DS windows over the field: the message box, YES/NO and the
 * entrance's LEAVE DOOR OPEN / CLOSE AND DECORATE menu (16, 13, 15 × 4). Taps: `next`, `yes`, `no`, `menu:<i>`, `back`.
 */
export interface UndergroundBaseView {
  app: 'ug-base';
  menu: AppMenu | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}

/**
 * 0.37.0. The secret base's PC (decomp pc.c, base_decoration.c, decoration_menu.c), DS windows over the field:
 * - the PC menu (`entries`: DECORATE, STORE, WITHDRAW, CHECK FLAGS, the radar from the gold flag on, EXIT at 17, 3) and
 *   the selected entry's description;
 * - the goods lists (`list`): STORE (the goods bag), WITHDRAW (the goods PC), the decoration's goods (`placed` rows are
 *   drawn in the gray of ListMenu_SetAltTextColors: already on display), with `heading` (GOODS ON HAND, GOODS IN PC, or
 *   the decoration's "GOODS SET  n/m");
 * - CHECK FLAGS (`flags`: the base's name, the flags obtained, the five most recent flags);
 * - the decoration (`decoration`): its menu (DECOR heading; DECORATE, PUT AWAY, MOVE GOODS, CANCEL) and, while a good is
 *   being placed, put away or moved, the field shows the base from (15, 17) (`AppHost.undergroundDecoration`).
 * Taps: `entry:<i>`, `row:<i>`, `close`, `menu:<i>`, `next`, `yes`, `no`, `back`, `tile:<x>,<z>` (a touch on the base's
 * floor, Underground tiles: the good or cursor goes there and is picked, BaseDecoration_Handle*TouchInput).
 */
export interface UndergroundPcView {
  app: 'ug-pc';
  entries: { label: string }[] | null;
  cursor: number;
  description: string | null;
  list: { rows: { name: string; placed: boolean }[]; close: string; cursor: number; top: number; visible: number; heading: string; description: string } | null;
  flags: { title: string; rows: AppField[] } | null;
  decoration: { menu: AppMenu; heading: string } | null;
  placing: boolean;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
  /** The decoration's fades (StartScreenFade, 6 steps): 0 shown … 16 black. */
  fade: number;
}

/**
 * 0.37.0. What the decoration shows on the field (`AppHost.undergroundDecoration`): every thing in the base by slot (0 the
 * PC, 1–15 goods, 16–31 boulders; core `BaseThing`) at its base tile, `hidden` while it blinks off (PropBlinkContext),
 * the good being placed or moved (`held`), and the cursor (ug_base_cur at a base tile) while one is picked.
 */
export interface UndergroundDecorationView {
  things: { index: number; good: number; x: number; z: number; hidden: boolean }[];
  held: { good: number; x: number; z: number; hidden: boolean } | null;
  cursor: { x: number; z: number } | null;
}
