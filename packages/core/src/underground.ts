/**
 * The Underground's rules, solo (decomp src/underground.c, src/underground/{mining,spheres,vendors}.c, scrcmd_fossil.c).
 * Game-agnostic: the pack supplies the tables (contracts `NewGame.underground`). Behavioural references only; an
 * independent implementation. Every roll is the DS's own generator (NitroSDK MATH_Rand16/32) on the save's seed, as
 * the DS rolls them, except the mining board's seed, which the caller draws (the DS seeds it from the link layer).
 */
import type { ClockTime } from './clock.ts';

/** Decomp enum SphereType: SPHERE_NONE 0, PRISM 1, PALE 2, RED 3, BLUE 4, GREEN 5; RANDOM_SPHERE_TYPE 6 in a price. */
export const SPHERE = { none: 0, prism: 1, pale: 2, red: 3, blue: 4, green: 5, random: 6 } as const;
/** Decomp SPHERE_MAX (one past the last type). */
export const SPHERE_TYPES = 6;
/** Decomp underground/defs.h and menus.h. */
export const UNDERGROUND_LIMITS = {
  spheres: 40,
  treasures: 40,
  traps: 40,
  goods: 40,
  goodsPc: 200,
  buried: 100,
  spawnedTraps: 64,
  spots: 250,
  sphereSize: 99,
  /** UNDERGROUND_MAIN_AREA_START_X/Z and UNDERGROUND_MAX_X/Z: a tile outside is a secret base's (U2). */
  mainStart: { x: 32, z: 64 },
  max: { x: 479, z: 479 },
  /** SHOP_INVENTORY_SIZE. */
  shop: 5,
  /** MAX_NORMAL_RADAR_BLIPS. */
  blips: 8,
} as const;
/**
 * Decomp enum MiningObjectID: 1–10 the spheres (small then large, in SphereType order), 11–59 the treasures
 * (MINING_TREASURE_OVAL_STONE … _IRON_PLATE; 22 the unused Nugget), 60–66 the rocks.
 */
export const MINING_ID = { spheres: 1, largeSpheres: 6, treasures: 11, helix: 23, rareBone: 28, revive: 29, maxRevive: 30, armor: 36, skull: 37, plates: 44, lastPlate: 59, rocks: 60 } as const;
/** Decomp mining.c: MINING_GAME_WIDTH × _HEIGHT cells, INITIAL_WALL_INTEGRITY, MAX_BURIED_ITEMS, MAX_BURIED_OBJECTS. */
export const MINING = { width: 13, height: 10, wall: 196, items: 4, objects: 8 } as const;
/** Decomp TRAP_DIGGER_DRILL and TRAP_MAX. */
export const TRAP_DIGGER_DRILL = 33;
export const TRAP_TYPES = 34;

/** Decomp SpherePrice: a sphere type (0 none: not for sale; 6 random) and the size range. */
export interface SpherePrice {
  sphere: number;
  min: number;
  max: number;
}

/**
 * One entry of the mining table (decomp sMiningObjects; contracts `UndergroundTables.miningObjects`): its mining id, its
 * four weights (odd trainer id, even, then both with the National Pokédex), its size in board cells, its shape (`x`/`o`
 * per cell, row-major; null = the full rectangle) and its art in ug_parts.narc (character and palette member).
 */
export interface MiningObject {
  id: number;
  weights: [number, number, number, number];
  width: number;
  height: number;
  shape: string | null;
  sprite: number;
  palette: number;
}

/** A sphere carried: its type (`SPHERE`) and size 1–99. */
export interface Sphere {
  type: number;
  size: number;
}

/** A buried sphere: where (Underground tiles), its type, the size it was buried at, its growth since (both ≤ 99). */
export interface BuriedSphere {
  x: number;
  z: number;
  type: number;
  size: number;
  growth: number;
}

/** The Underground's save block (contracts `UndergroundState` documents each field). */
export interface UndergroundState {
  seed: number;
  respawn: boolean;
  mined: boolean;
  spheres: Sphere[];
  treasures: number[];
  traps: number[];
  goods: number[];
  goodsPc: number[];
  buried: BuriedSphere[];
  spots: { x: number; z: number }[];
  spawnedTraps: ({ trap: number; x: number; z: number } | null)[];
  plates: number;
  records: { spheresDug: number; fossilsDug: number; otherDug: number };
  steps: number;
  vendorTalks: number[];
}

// ---------------------------------------------------------------- the DS's generators

/** NitroSDK MATHRandContext16 (MATH_InitRand16 / MATH_Rand16): x = x·1566083941 + 2531011 mod 2³², ((x >> 16)·max) >> 16. */
export class Rand16 {
  constructor(private x: number) {
    this.x >>>= 0;
  }

  next(max: number): number {
    this.x = (Math.imul(this.x, 1566083941) + 2531011) >>> 0;
    const hi = this.x >>> 16;
    return max === 0 ? hi : Math.floor((hi * (max & 0xffff)) / 0x10000);
  }
}

const M64 = (1n << 64n) - 1n;
const MUL32 = (1566083941n << 32n) + 1812433253n;
/** NitroSDK MATHRandContext32 (MATH_InitRand32 / MATH_Rand32): a 64-bit LCG, ((x >> 32)·max) >> 32. */
export class Rand32 {
  private x: bigint;

  constructor(seed: number | bigint) {
    this.x = (typeof seed === 'bigint' ? seed : BigInt(seed >>> 0)) & M64;
  }

  next(max: number): number {
    this.x = (this.x * MUL32 + 2531011n) & M64;
    const hi = this.x >> 32n;
    return Number(max === 0 ? hi : (hi * BigInt(max >>> 0)) >> 32n);
  }

  /** The generator's state as a decimal string (saved by nothing; models that live across ticks keep the object). */
  state(): string {
    return this.x.toString();
  }
}

/** ARNG_Next. */
const arng = (x: number): number => (Math.imul(x, 1812433253) + 1) >>> 0;

// ---------------------------------------------------------------- the save block

/**
 * Underground_Init's seed: the RTC's date and time packed five bits a field, plus the vblank counter (here the low half
 * of the trainer id: a per-save value no replay wait moves). The DS takes it at the new game; here the block is made
 * when the Underground is first needed (the first entry or the Underground Man's first gift), from the game clock then.
 */
export function undergroundInitSeed(now: ClockTime, trainerId: number): number {
  const tick = trainerId & 0xffff;
  const [y, m, d] = now.date.split('-').map(Number) as [number, number, number];
  let seed = BigInt(y % 100);
  for (const v of [m, d, now.hour, now.minute]) seed = seed * 32n + BigInt(v);
  seed = seed * 32n + BigInt(now.second + tick);
  return Number(seed & 0xffffffffn);
}

/**
 * CommSys_Seed: the mining game's generator, seeded once a visit (MiningEnv_Init, on every arrival in the Underground)
 * from the RTC (year, month, day, hour, minute packed 4/5/5/6/6 bits) plus the seconds and the vblank counter (here the
 * Underground's step count, `UndergroundState.steps`: in-game, so no replay wait moves it); every board of the visit
 * rolls on it in turn.
 */
export function miningRand(now: ClockTime, tick: number): Rand32 {
  const [y, m, d] = now.date.split('-').map(Number) as [number, number, number];
  let seed = BigInt(y % 100) * 16n + BigInt(m);
  seed = seed * 32n + BigInt(d);
  seed = seed * 32n + BigInt(now.hour);
  seed = seed * 64n + BigInt(now.minute);
  seed = seed * 64n + BigInt(now.second + tick);
  return new Rand32(seed);
}

/** Underground_Init: empty, the seed given, new spots due. */
export function newUnderground(seed: number): UndergroundState {
  return {
    seed: seed >>> 0,
    respawn: true,
    mined: false,
    spheres: [],
    treasures: [],
    traps: [],
    goods: [],
    goodsPc: [],
    buried: [],
    spots: [],
    spawnedTraps: Array.from({ length: UNDERGROUND_LIMITS.spawnedTraps }, () => null),
    plates: 0,
    records: { spheresDug: 0, fossilsDug: 0, otherDug: 0 },
    steps: 0,
    vendorTalks: [],
  };
}

const EMPTY = newUnderground(0);
/** The state's block to read: an empty one when absent (nothing is written). */
export function readUnderground(s: { underground?: UndergroundState }): UndergroundState {
  return s.underground ?? EMPTY;
}

/** The state's block, made with `seed` (`undergroundInitSeed`) the first time it is needed (absent in older saves too). */
export function createUnderground(s: { underground?: UndergroundState }, seed: number): UndergroundState {
  return (s.underground ??= newUnderground(seed));
}

/** The state's block; it exists once the player has been to the Underground or had an Underground gift. */
export function underground(s: { underground?: UndergroundState }): UndergroundState {
  if (!s.underground) throw new Error('underground: the save has no Underground block yet');
  return s.underground;
}

/**
 * Underground_IncrementStepCount (comm_player_manager.c sub_02058644, the player's steps in the Underground): 0–99 round;
 * true on the 50th, where the trainer score rises (TRAINER_SCORE_EVENT_UNDERGROUND_100_STEPS).
 */
export function undergroundStep(u: UndergroundState): boolean {
  u.steps = u.steps >= 99 ? 0 : u.steps + 1;
  return u.steps === 50;
}

/** Underground_TryAddSphere: the first empty slot. */
export function tryAddSphere(u: UndergroundState, type: number, size: number): boolean {
  if (u.spheres.length >= UNDERGROUND_LIMITS.spheres) return false;
  u.spheres.push({ type, size });
  return true;
}

/** UndergroundInventory_TryAddSphere: a mining sphere id (the large ones are their small type), the size capped at 99. */
export function tryAddMinedSphere(u: UndergroundState, id: number, size: number): boolean {
  if (!isMiningSphere(id)) throw new Error(`underground: mining id ${id} is not a sphere`);
  return tryAddSphere(u, miningSphereType(id), Math.min(size, UNDERGROUND_LIMITS.sphereSize));
}

/** Underground_TryAddTreasure (mining ids). */
export function tryAddTreasure(u: UndergroundState, id: number): boolean {
  if (u.treasures.length >= UNDERGROUND_LIMITS.treasures) return false;
  u.treasures.push(id);
  return true;
}

/** Underground_TryAddTrap. */
export function tryAddTrap(u: UndergroundState, trap: number): boolean {
  if (u.traps.length >= UNDERGROUND_LIMITS.traps) return false;
  u.traps.push(trap);
  return true;
}

/** Underground_TryAddGoodBag. */
export function tryAddGood(u: UndergroundState, good: number): boolean {
  if (u.goods.length >= UNDERGROUND_LIMITS.goods) return false;
  u.goods.push(good);
  return true;
}

/** Underground_TryAddGoodPC. */
export function tryAddGoodPc(u: UndergroundState, good: number): boolean {
  if (u.goodsPc.length >= UNDERGROUND_LIMITS.goodsPc) return false;
  u.goodsPc.push(good);
  return true;
}

/** Underground_IsRoomForGoodsInPC. */
export const goodsPcHasRoom = (u: UndergroundState): boolean => u.goodsPc.length < UNDERGROUND_LIMITS.goodsPc;

/** A plate (MINING_ID.plates … lastPlate) already dug never comes again (Underground_HasPlateNeverBeenMined). */
export function plateNeverMined(u: UndergroundState, id: number): boolean {
  if (id < MINING_ID.plates || id > MINING_ID.lastPlate) return true;
  return (u.plates & (1 << (id - MINING_ID.plates))) === 0;
}

/** Underground_SetPlateMined. */
export function setPlateMined(u: UndergroundState, id: number): void {
  if (id >= MINING_ID.plates && id <= MINING_ID.lastPlate) u.plates = (u.plates | (1 << (id - MINING_ID.plates))) >>> 0;
}

/** Spheres_IsMiningItemSphere. */
export const isMiningSphere = (id: number): boolean => id !== 0 && id < MINING_ID.treasures;
/** A mining sphere's type (the large ones map onto the small ones' types). */
export const miningSphereType = (id: number): number => (id >= MINING_ID.largeSpheres ? id - MINING_ID.largeSpheres + 1 : id);
/** Mining_ProcessNextDugUpItem's fossil test (helix … rare bone, armor, skull: the Rare Bone counts, as on the DS). */
export const isMiningFossil = (id: number): boolean => (id >= MINING_ID.helix && id <= MINING_ID.rareBone) || id === MINING_ID.armor || id === MINING_ID.skull;

// ---------------------------------------------------------------- days

/** Underground_HandleDailyEvents' sphere growth: per type the roll's range and base (growthRateRange, baseGrowthRate). */
const GROWTH_RANGE = [0, 2, 2, 4, 4, 5];
const GROWTH_BASE = [0, 1, 1, 3, 3, 5];

/**
 * Underground_HandleDailyEvents: every buried sphere grows once per day passed (at most 99 days), its growth capped at
 * 99; the seed moves on (ARNG of seed + days) and new spots are due on the next entry.
 */
export function undergroundDaily(u: UndergroundState, days: number): void {
  if (days <= 0) return;
  const rand = new Rand16(u.seed);
  for (let d = 0; d < Math.min(days, 99); d++) {
    for (const b of u.buried) {
      const g = rand.next(GROWTH_RANGE[b.type]!) + GROWTH_BASE[b.type]!;
      b.growth = b.growth + g < UNDERGROUND_LIMITS.sphereSize ? b.growth + g : UNDERGROUND_LIMITS.sphereSize;
    }
  }
  u.seed = arng((u.seed + days) >>> 0);
  u.respawn = true;
}

// ---------------------------------------------------------------- spheres in the ground

/** UndergroundMan_AreCoordinatesInSecretBase: outside the main area. */
export function inSecretBase(x: number, z: number): boolean {
  const L = UNDERGROUND_LIMITS;
  return !(x > L.mainStart.x && z > L.mainStart.z && x < L.max.x && z < L.max.z);
}

/** Spheres_GetBuriedSphereAtCoordinates: the buried sphere's slot, or −1. */
export const buriedSphereAt = (u: UndergroundState, x: number, z: number): number => u.buried.findIndex((b) => b.x === x && b.z === z);

/** What a burial in front of the player meets (Spheres_TryBurySphere's checks, in order). */
export type BurialResult = 'secret-base' | 'object' | 'wall' | 'other-sphere' | 'buried' | 'merged';

/**
 * Spheres_TryBurySphere: refused in a secret base, on an object, in a wall or on another kind of sphere; on the same
 * kind the two merge (the bigger keeps its size plus a fifth of the smaller's, plus 1, capped at 99); else a new
 * buried sphere. A 101st takes the oldest's place (the decomp means to: its Spheres_AddBuriedSphere fails an assert).
 * The caller removes the carried sphere on success.
 */
export function burySphere(u: UndergroundState, sphere: Sphere, at: { x: number; z: number; secretBase: boolean; object: boolean; wall: boolean }): BurialResult {
  if (at.secretBase) return 'secret-base';
  if (at.object) return 'object';
  if (at.wall) return 'wall';
  const existing = u.buried[buriedSphereAt(u, at.x, at.z)];
  if (existing) {
    if (existing.type !== sphere.type) return 'other-sphere';
    existing.size = existing.size > sphere.size ? existing.size + Math.floor(sphere.size / 5) + 1 : sphere.size + Math.floor(existing.size / 5) + 1;
    existing.size = Math.min(existing.size, UNDERGROUND_LIMITS.sphereSize);
    return 'merged';
  }
  if (u.buried.length >= UNDERGROUND_LIMITS.buried) u.buried.shift();
  u.buried.push({ x: at.x, z: at.z, type: sphere.type, size: sphere.size, growth: 0 });
  return 'buried';
}

/**
 * Spheres_ProcessRetrieveBuriedSphereRequest: the sphere at slot `index` comes up at its grown size (capped at 99) when
 * there is room; `growth` is what the message reports (capped so size + growth ≤ 99). Null: no room, it stays.
 */
export function retrieveSphere(u: UndergroundState, index: number): { type: number; size: number; growth: number } | null {
  const b = u.buried[index];
  if (!b) throw new Error(`underground: no buried sphere in slot ${index}`);
  const size = Math.min(b.size + b.growth, UNDERGROUND_LIMITS.sphereSize);
  if (!tryAddSphere(u, b.type, size)) return null;
  u.buried.splice(index, 1);
  return { type: b.type, size, growth: Math.min(b.growth, UNDERGROUND_LIMITS.sphereSize - b.size) };
}

// ---------------------------------------------------------------- mining spots and spawned traps

/** Mining_AddNewMiningSpot: kept ordered by z, then x (equal ones after). */
function addSpot(u: UndergroundState, x: number, z: number): void {
  const key = z * 30 * 32 + x;
  const i = u.spots.findIndex((s) => key < s.z * 30 * 32 + s.x);
  u.spots.splice(i < 0 ? u.spots.length : i, 0, { x, z });
}

/**
 * MiningEnv_Init with new objects due (Underground_ShouldSpawnNewBuriedObjects): the spots and the spawned traps are
 * cleared; one spot is tried near every buried sphere, then 14 groups (25 − 100/10 − 1: the decomp counts every
 * buried sphere slot) of 6–11 spots and 0–5 traps around random centres (Mining_SpawnMiningSpotsAndTraps), all on the
 * save's seed. `blocked(x, z)` is the map's collision; `matrix` its size in chunks; `spawnTraps` Traps_SpawnRandomTrap's
 * table of the traps that spawn.
 */
export function spawnBuriedObjects(u: UndergroundState, blocked: (x: number, z: number) => boolean, matrix: { width: number; height: number }, spawnTraps: readonly number[]): void {
  const rand = new Rand16(u.seed);
  u.spots = [];
  u.spawnedTraps = Array.from({ length: UNDERGROUND_LIMITS.spawnedTraps }, () => null);
  const L = UNDERGROUND_LIMITS;
  const canSpot = (x: number, z: number) =>
    !inSecretBase(x, z) && z <= L.max.z - 1 && x <= L.max.x - 1 && blocked(x, z) && (!blocked(x, z + 1) || !blocked(x, z - 1) || !blocked(x + 1, z) || !blocked(x - 1, z));
  const near = (c: number) => (rand.next(20) + c - 10) & 0xffff;
  for (const b of u.buried) {
    for (let i = 0; i < 100; i++) {
      const x = near(b.x);
      const z = near(b.z);
      if (!canSpot(x, z)) continue;
      if (u.spots.length < L.spots) addSpot(u, x, z);
      break;
    }
  }
  const xRange = (matrix.width - 2) * 32;
  const zRange = (matrix.height - 2) * 32;
  let trapIndex = 0;
  for (let n = 0; n < 25 - L.buried / 10 - 1; n++) {
    let cx: number;
    let cz: number;
    do {
      cx = rand.next(xRange) + L.mainStart.x;
      cz = rand.next(zRange) + L.mainStart.z;
    } while (!canSpot(cx, cz));
    const spots = rand.next(6) + 6;
    for (let i = 0; i < spots; i++) {
      let found: [number, number] | null = null;
      for (let j = 0; j < 100; j++) {
        const x = near(cx);
        const z = near(cz);
        if (canSpot(x, z)) {
          found = [x, z];
          break;
        }
      }
      if (!found) continue;
      if (u.spots.length >= L.spots) break;
      addSpot(u, found[0], found[1]);
    }
    const traps = rand.next(6);
    for (let i = 0; i < traps; i++) {
      for (let j = 0; j < 100; j++) {
        const x = near(cx);
        const z = near(cz);
        if (blocked(x, z)) continue;
        // Traps_SpawnRandomTrap: no roll past the 64th; a tile with a trap already is occupied.
        if (trapIndex >= L.spawnedTraps) continue;
        const trap = spawnTraps[rand.next(spawnTraps.length)]!;
        if (u.spawnedTraps.some((t) => t && t.x === x && t.z === z)) continue;
        u.spawnedTraps[trapIndex++] = { trap, x, z };
        break;
      }
    }
  }
  u.respawn = false;
}

/** Mining_GetMiningSpotAtCoordinates: the first spot there, or −1. */
export const spotAt = (u: UndergroundState, x: number, z: number): number => u.spots.findIndex((s) => s.x === x && s.z === z);

/**
 * Mining_GetRandomNearbyMiningSpotIndex's window around the player (with its decomp bounds: the x minimum is clamped
 * to the z start, and the x range is exclusive): the spots the normal radar may show.
 */
export function nearbySpots(u: UndergroundState, x: number, z: number): number[] {
  if (inSecretBase(x, z)) return [];
  const L = UNDERGROUND_LIMITS;
  const minX = Math.max(x - 80, L.mainStart.z);
  const maxX = Math.min(x + 80, L.max.x + 33);
  const minZ = Math.max(z - 80, L.mainStart.x);
  const maxZ = Math.min(z + 80, L.max.z + 1);
  return u.spots.flatMap((s, i) => (s.z >= minZ && s.z <= maxZ && s.x > minX && s.x < maxX ? [i] : []));
}

// ---------------------------------------------------------------- vendors

/** A vendor's stock line (decomp shopInventory/shopPriceTypes/shopPriceSizes). */
export interface VendorItem {
  item: number;
  sphere: number;
  size: number;
}

/**
 * UndergroundVendors_InitTrapsVendorInventory / _InitGoodsVendorInventory: five distinct items rolled on the seed plus
 * the vendor's index (the trap vendor's first is always the Digger Drill), each with its price's sphere (a random one
 * for RANDOM_SPHERE_TYPE) and a size in [min, max). Goods that need the National Pokédex are skipped before it.
 */
export function vendorStock(u: UndergroundState, kind: 'goods' | 'traps', vendor: number, prices: readonly SpherePrice[], natDexRequired: readonly boolean[], natDex: boolean): VendorItem[] {
  const rand = new Rand16((u.seed + vendor) >>> 0);
  const out: VendorItem[] = [];
  while (out.length < UNDERGROUND_LIMITS.shop) {
    const i = out.length;
    if (kind === 'traps') {
      const trap = i === 0 ? TRAP_DIGGER_DRILL : rand.next(TRAP_TYPES - 1) + 1;
      if (out.some((o) => o.item === trap)) continue;
      const p = prices[trap]!;
      if (p.min === 0 && p.max === 0) continue;
      const sphere = p.sphere === SPHERE.random ? rand.next(SPHERE_TYPES - 1) + 1 : p.sphere;
      out.push({ item: trap, sphere, size: rand.next(p.max - p.min) + p.min });
    } else {
      const good = rand.next(prices.length - 1) + 1;
      if (out.some((o) => o.item === good)) continue;
      if (!natDex && natDexRequired[good]) continue;
      const p = prices[good]!;
      if (p.sphere === SPHERE.none) continue;
      const sphere = p.sphere === SPHERE.random ? rand.next(SPHERE_TYPES - 1) + 1 : p.sphere;
      out.push({ item: good, sphere, size: rand.next(p.max - p.min) + p.min });
    }
  }
  return out;
}

/**
 * UndergroundVendors_PrintItemDescriptionAndSellPrice: what a vendor gives for one of the player's items, rolled on the
 * seed plus the vendor's index plus the item: the price's sphere (random for RANDOM_SPHERE_TYPE) and a size in
 * [min, max), halved for traps and goods. Null: not for sale (SPHERE_NONE).
 */
export function sellPrice(u: UndergroundState, kind: 'goods' | 'traps' | 'treasures', vendor: number, item: number, price: SpherePrice): { sphere: number; size: number } | null {
  const rand = new Rand16((u.seed + vendor + item) >>> 0);
  let sphere = price.sphere;
  if (sphere === SPHERE.random) sphere = rand.next(SPHERE_TYPES - 1) + 1;
  let size = rand.next(price.max - price.min) + price.min;
  if (kind !== 'treasures') size = Math.floor(size / 2);
  return sphere === SPHERE.none ? null : { sphere, size };
}

// ---------------------------------------------------------------- the mining board

/** A buried object on the board (decomp BuriedObject): its table entry, its top-left cell, whether it is uncovered. */
export interface BuriedObject {
  object: MiningObject;
  x: number;
  y: number;
  dugUp: boolean;
}

/** Whether cell (cx, cy) of the object's rectangle is part of it (Mining_AreCoordinatesWithinObjectShape). */
export function inShape(o: MiningObject, cx: number, cy: number): boolean {
  if (o.shape === null) return true;
  return o.shape[cy * o.width + cx] !== 'o';
}

/** Mining_RandomizeDirtLayers' stamps (8×8 of 4 layers, 5×5 of 6). */
const DIRT_4 = ['00444400', '04444440', '44444400', '44444400', '44444400', '44444400', '04444440', '00444400'].map((r) => [...r].map(Number));
const DIRT_6 = ['06660', '66666', '66666', '66666', '06660'].map((r) => [...r].map(Number));

/**
 * The mining game's board (decomp MiningEnv's game part): the buried objects (the items first, `items` of them), the
 * object grid (1-based object index per cell, 0 none), the dirt layers (0–6) and the wall's integrity, on the game's
 * own generator (its rolls: the layout, the dirt, the shakes, the sparkles and the spheres' sizes, in the decomp's order).
 */
export class MiningBoard {
  readonly rand: Rand32;
  readonly objects: BuriedObject[] = [];
  readonly grid: number[] = Array.from({ length: MINING.width * MINING.height }, () => 0);
  readonly dirt: number[] = Array.from({ length: MINING.width * MINING.height }, () => 2);
  readonly items: number;
  wall: number = MINING.wall;

  /**
   * Mining_GenerateGameLayout, then Mining_RandomizeDirtLayers: 2–5 items (3 on the first board), weighted by the
   * trainer id's parity and the National Pokédex, no plate already dug and no plate twice; then, after the first
   * board, 100 tries at the rocks.
   */
  constructor(table: readonly MiningObject[], u: Pick<UndergroundState, 'mined' | 'plates'>, oddTrainerId: boolean, natDex: boolean, rand: Rand32) {
    this.rand = rand;
    const weightOf = (o: MiningObject): number => o.weights[(natDex ? 2 : 0) + (oddTrainerId ? 0 : 1)]!;
    const itemsEnd = table.findIndex((o) => o.id >= MINING_ID.rocks);
    if (itemsEnd < 0) throw new Error('mining: the table has no rocks');
    const total = table.slice(0, itemsEnd).reduce((n, o) => n + weightOf(o), 0);
    this.items = u.mined ? this.rand.next(MINING.items - 1) + 2 : 3;
    const picked: number[] = [];
    while (this.objects.length < this.items) {
      let roll = this.rand.next(total);
      let index = -1;
      for (let i = 0; i < itemsEnd; i++) {
        roll -= weightOf(table[i]!);
        if (roll < 0) {
          index = i;
          break;
        }
      }
      if (index < 0) throw new Error('mining: the weighted pick fell off the table');
      const id = table[index]!.id;
      if (!plateNeverMined(u as UndergroundState, id)) continue;
      const plate = id >= MINING_ID.plates && id <= MINING_ID.lastPlate;
      if (plate && picked.includes(id)) continue;
      const x = this.rand.next(MINING.width);
      const y = this.rand.next(MINING.height);
      if (this.place(table[index]!, x, y)) picked.push(plate ? id : -1);
    }
    if (u.mined) {
      const rocks = table.length - itemsEnd;
      for (let j = 0; j < 100; j++) {
        const index = itemsEnd + this.rand.next(rocks);
        const x = this.rand.next(MINING.width);
        const y = this.rand.next(MINING.height);
        this.place(table[index]!, x, y);
      }
    }
    this.randomizeDirt();
  }

  /** Mining_TryPlaceObject (no free object slot after eight). */
  private place(o: MiningObject, x: number, y: number): boolean {
    if (this.objects.length >= MINING.objects) return false;
    const w = o.width;
    const h = o.height;
    if (x + w > MINING.width || y + h > MINING.height) return false;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (inShape(o, i, j) && this.grid[(y + j) * MINING.width + x + i]) return false;
    this.objects.push({ object: o, x, y, dugUp: false });
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (inShape(o, i, j)) this.grid[(y + j) * MINING.width + x + i] = this.objects.length;
    return true;
  }

  /** Mining_RandomizeDirtLayers, with its quirks: the 8×8 stamp's y start offsets by 5, the 6-layer stamp tests the 8×8 mask. */
  private randomizeDirt(): void {
    const W = MINING.width;
    const H = MINING.height;
    for (let i = 0; i < 10; i++) {
      const sx = this.rand.next(W + 8) - 8;
      const sy = this.rand.next(H + 8) - 5;
      for (let y = sy; y < sy + 8; y++) {
        if (y >= H || y < 0) continue;
        for (let x = sx; x < sx + 8; x++) {
          if (x >= W || x < 0) continue;
          const v = DIRT_4[y - sy]![x - sx]!;
          if (v) this.dirt[y * W + x] = v;
        }
      }
    }
    for (let i = 0; i < 15; i++) {
      const sx = this.rand.next(W + 5) - 5;
      const sy = this.rand.next(H + 5) - 5;
      let ok = true;
      for (let y = sy; y < sy + 5 && ok; y++) {
        if (y >= H || y < 0) continue;
        for (let x = sx; x < sx + 5; x++) {
          if (x >= W || x < 0) continue;
          if (!DIRT_4[y - sy]![x - sx]) continue;
          if (this.dirt[y * W + x]! < 4) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      for (let y = sy; y < sy + 5; y++) {
        if (y >= H || y < 0) continue;
        for (let x = sx; x < sx + 5; x++) {
          if (x >= W || x < 0) continue;
          const v = DIRT_6[y - sy]![x - sx]!;
          if (v) this.dirt[y * W + x] = v;
        }
      }
    }
  }

  private at(x: number, y: number): BuriedObject | null {
    const i = this.grid[y * MINING.width + x]!;
    return i ? this.objects[i - 1]! : null;
  }

  /**
   * Mining_RemoveDirt at board cell (x, y), then the wall's damage (Mining_MainGameLoop: 4 for the pickaxe, 8 for the
   * hammer): two layers off the cell; on a rock (bare) nothing more; else the four neighbours lose one (two with the
   * hammer) and the hammer takes one off the diagonals. `rock`: a bare rock was hit; `item`: a bare item was.
   */
  strike(x: number, y: number, pickaxe: boolean): { rock: boolean; item: boolean } {
    const W = MINING.width;
    const H = MINING.height;
    const dig = (cx: number, cy: number, n: number) => {
      if (cx < 0 || cx >= W || cy < 0 || cy >= H) return;
      this.dirt[cy * W + cx] = Math.max(0, this.dirt[cy * W + cx]! - n);
    };
    dig(x, y, 2);
    const bare = this.dirt[y * W + x] === 0;
    const o = this.at(x, y);
    const rock = !!o && bare && o.object.id >= MINING_ID.rocks;
    const item = !!o && bare && o.object.id !== 0 && o.object.id < MINING_ID.rocks;
    if (!rock) {
      if (!pickaxe) for (const [dx, dy] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) dig(x + dx, y + dy, 1);
      for (const [dx, dy] of [[0, 1], [0, -1], [-1, 0], [1, 0]] as const) dig(x + dx, y + dy, pickaxe ? 1 : 2);
    }
    const damage = pickaxe ? 4 : 8;
    this.wall = this.wall > damage ? this.wall - damage : 0;
    return { rock, item };
  }

  /**
   * Mining_AreAllItemsDugUp: whether every item is bare; the items newly bare are marked dug up and returned (their
   * shine starts).
   */
  uncover(): { all: boolean; fresh: number[] } {
    const covered = new Set<number>();
    this.grid.forEach((i, cell) => {
      if (i && i <= this.items && this.dirt[cell]) covered.add(i - 1);
    });
    const fresh: number[] = [];
    for (let i = 0; i < this.items; i++) {
      if (covered.has(i) || this.objects[i]!.dugUp) continue;
      this.objects[i]!.dugUp = true;
      fresh.push(i);
    }
    return { all: covered.size === 0, fresh };
  }

  /**
   * Mining_GenerateSizeOfMinedSphere: 1 (prism, pale) or 1–4 (the others), +10 when large, + the wall left / (196 / 5),
   * +5 unless the wall collapsed. 0 for anything that is not a sphere.
   */
  sphereSize(id: number): number {
    if (!isMiningSphere(id)) return 0;
    const t = miningSphereType(id);
    let size = t === SPHERE.prism || t === SPHERE.pale ? this.rand.next(1) + 1 : this.rand.next(4) + 1;
    if (id >= MINING_ID.largeSpheres) size += 10;
    size += Math.floor(this.wall / Math.floor(MINING.wall / 5));
    if (this.wall !== 0) size += 5;
    return size;
  }
}
