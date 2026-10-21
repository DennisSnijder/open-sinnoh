/**
 * 0.33.0. The Underground, solo (decomp src/underground.c, src/underground/{mining,spheres,vendors,menus,
 * manager,top_screen}.c, src/underground_map_transition.c, src/scrcmd_underground_inventory.c, src/scrcmd_fossil.c):
 * its tables (read from the player's ROM), its save block, the field's view of it and its menu apps. Link play
 * (other players, gifts, flags, helping) has no part here; traps and secret bases are not implemented yet (their state is kept,
 * nothing triggers them yet).
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
  goods: { price: SpherePrice; natDex: boolean }[];
  vendors: { kind: 'goods' | 'traps' | 'treasures'; x: number; z: number }[];
  spawnTraps: number[];
  flags: { entered: Id; digging: Id; sphereAcquired: Id };
  vars: { fossilsUnearthed: Id; spiritomb: Id };
  sparkle: Id;
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
}

/** Decomp MARKER_ANIM_* (top_screen.c's sprites). */
export const UNDERGROUND_MARKER = { player: 1, sphere: 9, trap: 11, spot: 12 } as const;

/**
 * 0.33.0. What the Underground asks the game to open (World `undergroundRequest`), after an A press or X on its field:
 * the mining board for the spot ahead (`mining`), a vendor's shop (`vendor`, the vendor's index), the Underground's menu.
 */
export type UndergroundRequest = { app: 'mining'; spot: number } | { app: 'ug-vendor'; vendor: number } | { app: 'ug-menu' };

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
