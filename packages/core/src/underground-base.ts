/**
 * The Underground's traps and the player's secret base, solo (decomp src/underground/traps.c, secret_bases.c,
 * base_decoration.c, pc.c, src/underground.c). Game-agnostic rules over the save block (`UndergroundState`) and the
 * goods table the pack supplies (contracts `UndergroundTables.goods`). Behavioural references only; an independent
 * implementation. Link play (other players' traps and bases, flags taken from them, helping) has no part here.
 */
import { tryAddGood, tryAddGoodPc, tryAddTrap, UNDERGROUND_LIMITS, type PlacedGood, type Rand32, type SecretBase, type UndergroundState } from './underground.ts';

/** Decomp generated/traps.txt (the dummies, 9, 10, 15–17 and 32, have no effect). */
export const TRAP = {
  moveUp: 1,
  hurlUp: 5,
  hole: 11,
  pit: 12,
  reverse: 13,
  confuse: 14,
  smoke: 18,
  bigSmoke: 19,
  rock: 20,
  rockfall: 21,
  foam: 22,
  bubble: 23,
  alert1: 24,
  alert4: 27,
  leaf: 28,
  flower: 29,
  ember: 30,
  fire: 31,
  diggerDrill: 33,
} as const;

/**
 * What a trap does (decomp sTrapEffectClientFuncs): the move and hurl traps slide the player (`dir`), the hole and
 * pit hold them, reverse and confuse alter their steps, the rest are the escape games (smoke, rock, bubbles, leaves,
 * fire) and the alerts.
 */
export type TrapEffect =
  | { kind: 'slide'; dir: 'up' | 'right' | 'down' | 'left'; hurl: boolean }
  | { kind: 'hole'; pit: boolean }
  | { kind: 'altered'; reverse: boolean }
  | { kind: 'smoke'; big: boolean }
  | { kind: 'rock'; fall: boolean }
  | { kind: 'bubble'; foam: boolean }
  | { kind: 'leaf'; flower: boolean }
  | { kind: 'fire'; big: boolean }
  | { kind: 'alert'; n: number };

const SLIDE_DIRS = ['up', 'right', 'down', 'left'] as const;

export function trapEffect(trap: number): TrapEffect {
  if (trap >= TRAP.moveUp && trap < TRAP.moveUp + 8) return { kind: 'slide', dir: SLIDE_DIRS[(trap - TRAP.moveUp) % 4]!, hurl: trap >= TRAP.hurlUp };
  switch (trap) {
    case TRAP.hole:
    case TRAP.pit:
      return { kind: 'hole', pit: trap === TRAP.pit };
    case TRAP.reverse:
    case TRAP.confuse:
      return { kind: 'altered', reverse: trap === TRAP.reverse };
    case TRAP.smoke:
    case TRAP.bigSmoke:
      return { kind: 'smoke', big: trap === TRAP.bigSmoke };
    case TRAP.rock:
    case TRAP.rockfall:
      return { kind: 'rock', fall: trap === TRAP.rockfall };
    case TRAP.foam:
    case TRAP.bubble:
      return { kind: 'bubble', foam: trap === TRAP.foam };
    case TRAP.leaf:
    case TRAP.flower:
      return { kind: 'leaf', flower: trap === TRAP.flower };
    case TRAP.ember:
    case TRAP.fire:
      return { kind: 'fire', big: trap === TRAP.fire };
  }
  if (trap >= TRAP.alert1 && trap <= TRAP.alert4) return { kind: 'alert', n: trap - TRAP.alert1 };
  throw new Error(`underground: trap ${trap} has no effect`);
}

// ---------------------------------------------------------------- traps in the ground

/** A buried trap found on a tile: one the player laid (`placed`, its slot) or one the day spawned (`spawned`, its index). */
export interface TrapHit {
  source: 'placed' | 'spawned';
  index: number;
  trap: number;
}

/** Traps_GetTrapAtCoordinates over the player's laid traps and the spawned ones. */
export function trapAt(u: Pick<UndergroundState, 'placedTraps' | 'spawnedTraps'>, x: number, z: number): TrapHit | null {
  const placed = u.placedTraps.findIndex((t) => t.x === x && t.z === z);
  if (placed >= 0) return { source: 'placed', index: placed, trap: u.placedTraps[placed]!.trap };
  const spawned = u.spawnedTraps.findIndex((t) => t !== null && t.x === x && t.z === z);
  if (spawned >= 0) return { source: 'spawned', index: spawned, trap: u.spawnedTraps[spawned]!.trap };
  return null;
}

/** The trap leaves the ground (it went off, or was dug up): a laid one leaves its slot, a spawned one its save entry. */
export function takeTrap(u: UndergroundState, hit: TrapHit): void {
  if (hit.source === 'placed') u.placedTraps.splice(hit.index, 1);
  else u.spawnedTraps[hit.index] = null;
}

/** What laying a trap in front of the player meets (Traps_TryPlaceTrap's checks, in order). */
export type PlaceTrapResult = 'object' | 'secret-base' | 'wall' | 'occupied' | 'placed';

/**
 * Traps_TryPlaceTrap: refused on an object, in a secret base, in a wall or on another trap; else laid. A 17th takes the
 * oldest's place (Traps_AddBuriedTrap and Traps_AddPlacedTrapCurrentPlayer free the first slot). The caller removes the
 * trap from the inventory on success.
 */
export function placeTrap(u: UndergroundState, trap: number, at: { x: number; z: number; secretBase: boolean; object: boolean; wall: boolean }): PlaceTrapResult {
  if (at.object) return 'object';
  if (at.secretBase) return 'secret-base';
  if (at.wall) return 'wall';
  if (trapAt(u, at.x, at.z)) return 'occupied';
  if (u.placedTraps.length >= UNDERGROUND_LIMITS.placedTraps) u.placedTraps.shift();
  u.placedTraps.push({ trap, x: at.x, z: at.z });
  return 'placed';
}

/**
 * Traps_TryDisengageTrap: A on a buried trap digs it up into the trap inventory (`taken`, the trap id). With the trap
 * inventory full it stays (`full`). Null: no trap there.
 */
export function disengageTrap(u: UndergroundState, x: number, z: number): { taken: number } | 'full' | null {
  const hit = trapAt(u, x, z);
  if (!hit) return null;
  if (u.traps.length >= UNDERGROUND_LIMITS.traps) return 'full';
  takeTrap(u, hit);
  tryAddTrap(u, hit.trap);
  return { taken: hit.trap };
}

/** TOUCH_RADAR_RADIUS and MAX_TOUCH_RADAR_RESULTS_OF_TYPE. */
export const TOUCH_RADAR = { radius: 6, results: 8 } as const;

/**
 * TouchRadarSearch_GetNextCoords' order: the touched tile, then each ring of tiles `i` steps away (4i of them, from the
 * south-most clockwise as x grows), out to `radius`.
 */
export function touchRadarOffsets(radius: number): { x: number; z: number }[] {
  const out = [{ x: 0, z: 0 }];
  for (let i = 1; i <= radius; i++) {
    for (let j = 0; j < 4 * i; j++) {
      const z = j < 2 * i ? i - j : j - 3 * i;
      const x = j < i ? j : j < 3 * i ? 2 * i - j : j - 4 * i;
      out.push({ x, z });
    }
  }
  return out;
}

/**
 * UndergroundMan_TouchRadarSearch for each kind (traps, mining spots, buried spheres): the first eight tiles of each in
 * the search order around the touched tile.
 */
export function touchRadar(u: UndergroundState, x: number, z: number): { traps: { x: number; z: number }[]; spots: { x: number; z: number }[]; spheres: { x: number; z: number }[] } {
  const offsets = touchRadarOffsets(TOUCH_RADAR.radius);
  const find = (has: (tx: number, tz: number) => boolean) => {
    const found: { x: number; z: number }[] = [];
    for (const o of offsets) {
      if (found.length >= TOUCH_RADAR.results) break;
      if (has(x + o.x, z + o.z)) found.push({ x: x + o.x, z: z + o.z });
    }
    return found;
  };
  return {
    traps: find((tx, tz) => trapAt(u, tx, tz) !== null),
    spots: find((tx, tz) => u.spots.some((s) => s.x === tx && s.z === tz)),
    spheres: find((tx, tz) => u.buried.some((b) => b.x === tx && b.z === tz)),
  };
}

// ---------------------------------------------------------------- the secret base

/**
 * Decomp secret_bases.h and defs.h: a base is a 32×32-tile chunk; its room is tiles 10–21 × 12–23, its exit (15, 24),
 * its PC (15, 12) two tiles wide; a good in the decoration starts at (16, 13) (DEFAULT_GOOD_POSITION_X/Z).
 */
export const BASE = {
  width: 32,
  depth: 32,
  room: { x0: 10, x1: 21, z0: 12, z1: 23 },
  exit: { x: 15, z: 24 },
  pc: { x: 15, z: 12 },
  start: { x: 16, z: 13 },
  /** MAX_GOOD_WIDTH and MAX_GOOD_DEPTH: a good's collision mask is 3×3. */
  mask: 3,
} as const;

/** Decomp enum Good: the PCs by flag rank (1–5), the boulders (6), the tools (56–71). */
export const GOOD = { pc: 1, bigBoulder: 6, holeTool: 56, fireTool: 71 } as const;

/** SecretBases_GetTrapIDFromGoodID: the tools (Hole Tool … Fire Tool) and the trap each sets off, in good order. */
const TOOL_TRAPS = [TRAP.hole, TRAP.pit, TRAP.smoke, TRAP.bigSmoke, TRAP.rock, TRAP.rockfall, TRAP.foam, TRAP.bubble, 24, 25, 26, 27, TRAP.leaf, TRAP.flower, TRAP.ember, TRAP.fire];

/** A good's table entry as the base needs it (contracts `UndergroundTables.goods`): size, 3×3 collision mask, A message. */
export interface GoodShape {
  width: number;
  depth: number;
  collision: number[];
  interact: number;
}

/** SecretBases_CalculateBaseCollision's PC and boulder masks. */
const PC_MASK = [1, 1, 0, 0, 0, 0, 0, 0, 0];
const BOULDER_MASK = [1, 1, 0, 1, 1, 0, 0, 0, 0];

/** Flag ranks by captured flags (FLAG_CAPTURED_COUNT_*: 1, 3, 10, 50): normal 0 … platinum 4 (UndergroundRecord_GetFlagRank). */
export function flagRank(capturedFlags: number): number {
  return capturedFlags >= 50 ? 4 : capturedFlags >= 10 ? 3 : capturedFlags >= 3 ? 2 : capturedFlags >= 1 ? 1 : 0;
}

/** SecretBase_GetPlacedGoodsLimit: 10, 12 from bronze, 15 from silver. */
export const placedGoodsLimit = (capturedFlags: number): number => [10, 12, 15, 15, 15][flagRank(capturedFlags)]!;

/** SecretBase_GetUnremovableBoulderCount: 16, then 15, 11, 6, 0 by rank. */
export const unremovableBoulders = (capturedFlags: number): number => [16, 15, 11, 6, 0][flagRank(capturedFlags)]!;

/**
 * Flags are taken from other players' bases only: a solo game has none (UndergroundRecord capturedFlagCount stays 0), so
 * its base keeps the normal flag, ten goods on display and all sixteen boulders.
 */
export const SOLO_CAPTURED_FLAGS = 0;

/**
 * SecretBases_CreateBase: a new base behind the drilled wall, empty but for sixteen boulders on even tiles, rolled on
 * `rand` (CommSys_Seed's generator), none right of the PC nor in the columns from the exit to the PC.
 */
export function newBase(entrance: SecretBase['entrance'], rand: Rand32): SecretBase {
  const taken: [number, number][] = [[BASE.pc.x + 1, BASE.pc.z]];
  const boulders: { x: number; z: number }[] = [];
  while (boulders.length < UNDERGROUND_LIMITS.boulders) {
    const column = rand.next(5);
    const x = column < 2 ? column * 2 + BASE.room.x0 : (column - 3) * 2 + 18;
    const z = rand.next(6) * 2 + BASE.room.z0;
    if (taken.some(([tx, tz]) => tx === x && tz === z)) continue;
    taken.push([x, z]);
    boulders.push({ x, z });
  }
  return { entrance: { ...entrance }, goods: Array.from({ length: UNDERGROUND_LIMITS.placedGoods }, () => null), boulders };
}

/**
 * Digging a base with the Digger Drill (SecretBases_ProcessBaseCreateEvent): a new base replaces any old one (its goods
 * go back to the PC: Underground_InitPlacedGoodSlots); moving it counts in the records (UndergroundRecord timesBaseMoved).
 */
export function digBase(u: UndergroundState, entrance: SecretBase['entrance'], rand: Rand32): 'new' | 'moved' {
  const moved = u.base !== null;
  u.base = newBase(entrance, rand);
  if (moved) u.records.baseMoves = Math.min(999999, u.records.baseMoves + 1);
  return moved ? 'moved' : 'new';
}

/** One thing in the base as the decoration sees it (BaseGoodSlot): its slot (0 the PC, 1–15 goods, 16–31 boulders). */
export interface BaseThing {
  index: number;
  good: number;
  x: number;
  z: number;
}

/** SecretBase_GetGoodIDAtIndex over every slot: the PC (`pc`, its good by flag rank), the goods, the boulders. */
export function baseThings(base: SecretBase, pc: number): BaseThing[] {
  const out: BaseThing[] = [{ index: 0, good: pc, x: BASE.pc.x, z: BASE.pc.z }];
  base.goods.forEach((g, i) => g && out.push({ index: i + 1, good: g.good, x: g.x, z: g.z }));
  base.boulders.forEach((b, i) => b && out.push({ index: UNDERGROUND_LIMITS.placedGoods + 1 + i, good: GOOD.bigBoulder, x: b.x, z: b.z }));
  return out;
}

const maskOf = (t: BaseThing, goods: readonly GoodShape[]): number[] => {
  if (t.index === 0) return PC_MASK;
  if (t.index > UNDERGROUND_LIMITS.placedGoods) return BOULDER_MASK;
  const g = goods[t.good];
  if (!g) throw new Error(`secret base: no good ${t.good}`);
  return g.collision;
};

/**
 * SecretBases_AreCoordinatesWalkable within one base (base tiles): blocked where the PC's, a good's or a boulder's
 * collision mask covers the tile.
 */
export function baseBlocked(base: SecretBase, goods: readonly GoodShape[], pc: number, x: number, z: number): boolean {
  return baseThings(base, pc).some((t) => {
    const dx = x - t.x;
    const dz = z - t.z;
    return dx >= 0 && dz >= 0 && dx < BASE.mask && dz < BASE.mask && maskOf(t, goods)[dz * BASE.mask + dx] === 1;
  });
}

/**
 * SecretBases_CheckForInteractableGood: A on a blocked tile in front finds the good (not the PC nor a boulder) whose
 * collision covers it; its A message (TEXT_BANK_UNDERGROUND_RECORDS), or null when it has none.
 */
export function goodMessageAt(base: SecretBase, goods: readonly GoodShape[], x: number, z: number): { good: number; message: number } | null {
  for (const g of base.goods) {
    if (!g) continue;
    const shape = goods[g.good]!;
    const dx = x - g.x;
    const dz = z - g.z;
    if (dx < 0 || dz < 0 || dx >= BASE.mask || dz >= BASE.mask || !shape.collision[dz * BASE.mask + dx]) continue;
    return shape.interact ? { good: g.good, message: shape.interact } : null;
  }
  return null;
}

/** SecretBases_CheckPlayerTriggeredTool: a tool on display whose corner is this tile, and the trap it sets off. */
export function toolAt(base: SecretBase, x: number, z: number): number | null {
  const g = base.goods.find((t) => t && t.x === x && t.z === z);
  if (!g || g.good < GOOD.holeTool || g.good > GOOD.fireTool) return null;
  return TOOL_TRAPS[g.good - GOOD.holeTool]!;
}

// ---------------------------------------------------------------- decorating

/** PositionRect: the tiles a good takes in the decoration (its width × depth from its corner, inclusive). */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function rectOf(x: number, z: number, width: number, depth: number): Rect {
  return { minX: x, minZ: z, maxX: x + width - 1, maxZ: z + depth - 1 };
}

const overlaps = (a: Rect, b: Rect) => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;

/** BaseDecoration_IsPositionOutOfBounds: outside the room. */
export const outOfRoom = (r: Rect): boolean => !(BASE.room.x0 <= r.minX && r.maxX <= BASE.room.x1 && BASE.room.z0 <= r.minZ && r.maxZ <= BASE.room.z1);

/**
 * BaseDecoration_CanPlaceGood: not over any other thing's rectangle (the PC's and the boulders' too), nor on the two
 * tiles in front of the PC or the one in front of the exit.
 */
export function canPlace(r: Rect, others: readonly Rect[]): boolean {
  if (others.some((o) => overlaps(o, r))) return false;
  if (overlaps(r, rectOf(BASE.pc.x, BASE.pc.z + 1, 2, 1))) return false;
  return !overlaps(r, rectOf(BASE.exit.x, BASE.exit.z - 1, 1, 1));
}

/** A thing's rectangle in the decoration (BaseDecoration_AddGoodAtIndex: the good's width and depth). */
export function thingRect(t: BaseThing, goods: readonly GoodShape[]): Rect {
  const g = goods[t.good];
  if (!g) throw new Error(`secret base: no good ${t.good}`);
  return rectOf(t.x, t.z, g.width, g.depth);
}

// ---------------------------------------------------------------- the goods PC

/** Underground_IsGoodAtSlotPlacedInBase. */
export const goodPlaced = (u: Pick<UndergroundState, 'base'>, pcSlot: number): boolean => !!u.base?.goods.some((g) => g?.slot === pcSlot);

/** Underground_RemoveGoodAtSlotPC with Underground_UpdatePlacedGoodSlots: the slots after it move up one. */
function removeGoodPc(u: UndergroundState, pcSlot: number): number {
  if (goodPlaced(u, pcSlot)) throw new Error(`goods PC: slot ${pcSlot} is on display`);
  const [good] = u.goodsPc.splice(pcSlot, 1);
  if (good === undefined) throw new Error(`goods PC: no slot ${pcSlot}`);
  for (const g of u.base?.goods ?? []) if (g && g.slot > pcSlot) g.slot--;
  return good;
}

/** UndergroundPC_TryDepositGood: a good from the goods bag into the PC; false when the PC is full. */
export function storeGood(u: UndergroundState, bagSlot: number): boolean {
  const good = u.goods[bagSlot];
  if (good === undefined) throw new Error(`goods bag: no slot ${bagSlot}`);
  if (!tryAddGoodPc(u, good)) return false;
  u.goods.splice(bagSlot, 1);
  return true;
}

/** UndergroundPC_TryWithdrawGood: a good from the PC into the goods bag, unless it is on display or the bag is full. */
export function withdrawGood(u: UndergroundState, pcSlot: number): 'placed' | 'full' | 'withdrawn' {
  if (goodPlaced(u, pcSlot)) return 'placed';
  const good = u.goodsPc[pcSlot];
  if (good === undefined) throw new Error(`goods PC: no slot ${pcSlot}`);
  if (!tryAddGood(u, good)) return 'full';
  removeGoodPc(u, pcSlot);
  return 'withdrawn';
}

/** The decoration's edit, saved back (BaseDecoration_SaveBaseGoods): goods by slot 1–15, the boulders left. */
export function saveDecoration(base: SecretBase, goods: (PlacedGood | null)[], boulders: SecretBase['boulders']): void {
  if (goods.length !== UNDERGROUND_LIMITS.placedGoods || boulders.length !== UNDERGROUND_LIMITS.boulders) throw new Error('secret base: a decoration edit of the wrong size');
  base.goods = goods.map((g) => (g ? { ...g } : null));
  base.boulders = boulders.map((b) => (b ? { ...b } : null));
}
