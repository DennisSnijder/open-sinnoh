import { describe, expect, it } from 'vitest';
import {
  BASE,
  baseBlocked,
  baseThings,
  canPlace,
  digBase,
  disengageTrap,
  flagRank,
  GOOD,
  goodMessageAt,
  goodPlaced,
  outOfRoom,
  placedGoodsLimit,
  placeTrap,
  rectOf,
  storeGood,
  takeTrap,
  thingRect,
  toolAt,
  touchRadar,
  touchRadarOffsets,
  trapAt,
  trapEffect,
  unremovableBoulders,
  withdrawGood,
  type GoodShape,
} from './underground-base.ts';
import { BoulderGame, BubbleGame, FlameGame, LeafGame, SmokeGame, SMOKE } from './underground-traps.ts';
import { newUnderground, Rand32, UNDERGROUND_LIMITS } from './underground.ts';

/** An original goods table: the PCs, the boulder, a 2×1 table (both tiles solid) with writing, a 3×2 L, a tool. */
const shape = (width: number, depth: number, collision: number[], interact = 0): GoodShape => ({ width, depth, collision, interact });
const GOODS: GoodShape[] = Array.from({ length: 72 }, () => shape(1, 1, [0, 0, 0, 0, 0, 0, 0, 0, 0]));
for (let g = 1; g <= 5; g++) GOODS[g] = shape(2, 1, [1, 1, 0, 0, 0, 0, 0, 0, 0]);
GOODS[GOOD.bigBoulder] = shape(2, 2, [1, 1, 0, 1, 1, 0, 0, 0, 0]);
GOODS[10] = shape(2, 1, [1, 1, 0, 0, 0, 0, 0, 0, 0], 36);
GOODS[11] = shape(3, 2, [1, 0, 0, 1, 1, 1, 0, 0, 0]);
const ground = { secretBase: false, object: false, wall: false };

describe('laying traps (Traps_TryPlaceTrap)', () => {
  it('refuses an object, a base, a wall or another trap, in that order, and lays it otherwise', () => {
    const u = newUnderground(1);
    expect(placeTrap(u, 1, { x: 100, z: 100, object: true, secretBase: true, wall: true })).toBe('object');
    expect(placeTrap(u, 1, { x: 100, z: 100, ...ground, secretBase: true, wall: true })).toBe('secret-base');
    expect(placeTrap(u, 1, { x: 100, z: 100, ...ground, wall: true })).toBe('wall');
    expect(placeTrap(u, 11, { x: 100, z: 100, ...ground })).toBe('placed');
    expect(placeTrap(u, 12, { x: 100, z: 100, ...ground })).toBe('occupied');
    u.spawnedTraps[3] = { trap: 18, x: 120, z: 100 };
    expect(placeTrap(u, 12, { x: 120, z: 100, ...ground })).toBe('occupied');
    expect(u.placedTraps).toEqual([{ trap: 11, x: 100, z: 100 }]);
  });

  it('keeps 16: a 17th takes the oldest one\'s place', () => {
    const u = newUnderground(1);
    for (let i = 0; i < UNDERGROUND_LIMITS.placedTraps + 1; i++) expect(placeTrap(u, 1 + (i % 8), { x: 100 + i, z: 120, ...ground })).toBe('placed');
    expect(u.placedTraps).toHaveLength(16);
    expect(u.placedTraps[0]).toEqual({ trap: 2, x: 101, z: 120 });
    expect(u.placedTraps.at(-1)).toEqual({ trap: 1, x: 116, z: 120 });
  });

  it('finds laid and spawned traps, takes them away, and digs one up unless the trap bag is full', () => {
    const u = newUnderground(1);
    placeTrap(u, 13, { x: 90, z: 90, ...ground });
    u.spawnedTraps[7] = { trap: 22, x: 91, z: 90 };
    expect(trapAt(u, 90, 90)).toEqual({ source: 'placed', index: 0, trap: 13 });
    expect(trapAt(u, 91, 90)).toEqual({ source: 'spawned', index: 7, trap: 22 });
    expect(trapAt(u, 92, 90)).toBeNull();
    takeTrap(u, trapAt(u, 90, 90)!);
    expect(u.placedTraps).toEqual([]);
    u.traps = Array.from({ length: UNDERGROUND_LIMITS.traps }, () => 1);
    expect(disengageTrap(u, 91, 90)).toBe('full');
    expect(u.spawnedTraps[7]).not.toBeNull();
    u.traps.pop();
    expect(disengageTrap(u, 91, 90)).toEqual({ taken: 22 });
    expect(u.spawnedTraps[7]).toBeNull();
    expect(u.traps.at(-1)).toBe(22);
    expect(disengageTrap(u, 91, 90)).toBeNull();
  });

  it('tells each trap\'s effect (sTrapEffectClientFuncs)', () => {
    expect(trapEffect(1)).toEqual({ kind: 'slide', dir: 'up', hurl: false });
    expect(trapEffect(8)).toEqual({ kind: 'slide', dir: 'left', hurl: true });
    expect(trapEffect(12)).toEqual({ kind: 'hole', pit: true });
    expect(trapEffect(13)).toEqual({ kind: 'altered', reverse: true });
    expect(trapEffect(19)).toEqual({ kind: 'smoke', big: true });
    expect(trapEffect(26)).toEqual({ kind: 'alert', n: 2 });
    expect(trapEffect(30)).toEqual({ kind: 'fire', big: false });
    expect(() => trapEffect(9)).toThrow(/no effect/);
    expect(() => trapEffect(33)).toThrow(/no effect/);
  });

  it('the touch radar searches the touched tile, then rings of 4i tiles, eight finds of a kind at most', () => {
    const offsets = touchRadarOffsets(6);
    expect(offsets).toHaveLength(1 + 4 * (1 + 2 + 3 + 4 + 5 + 6));
    expect(offsets.slice(0, 5)).toEqual([{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }]);
    expect(new Set(offsets.map((o) => `${o.x},${o.z}`)).size).toBe(offsets.length);
    expect(offsets.every((o) => Math.abs(o.x) + Math.abs(o.z) <= 6)).toBe(true);
    const u = newUnderground(1);
    for (let i = 0; i < 10; i++) u.spots.push({ x: 100 + i, z: 100 }, { x: 100 + i, z: 101 });
    placeTrap(u, 1, { x: 103, z: 99, ...ground });
    u.buried.push({ x: 120, z: 100, type: 1, size: 3, growth: 0 });
    const found = touchRadar(u, 100, 100);
    expect(found.traps).toEqual([{ x: 103, z: 99 }]);
    expect(found.spots).toHaveLength(8);
    expect(found.spots[0]).toEqual({ x: 100, z: 100 });
    expect(found.spheres).toEqual([]);
  });
});

describe('the secret base', () => {
  it('digs a base: sixteen boulders on even tiles, none beside the PC or in the exit\'s columns; moving it counts', () => {
    const u = newUnderground(1);
    expect(digBase(u, { x: 200, z: 150, dir: 'down' }, new Rand32(5))).toBe('new');
    const base = u.base!;
    expect(base.entrance).toEqual({ x: 200, z: 150, dir: 'down' });
    expect(base.goods).toEqual(Array.from({ length: 15 }, () => null));
    expect(base.boulders).toHaveLength(16);
    const tiles = base.boulders.map((b) => `${b!.x},${b!.z}`);
    expect(new Set(tiles).size).toBe(16);
    for (const b of base.boulders) {
      expect([10, 12, 16, 18, 20]).toContain(b!.x);
      expect(b!.z % 2).toBe(0);
      expect(b!.z).toBeGreaterThanOrEqual(12);
      expect(b!.z).toBeLessThanOrEqual(22);
      expect(`${b!.x},${b!.z}`).not.toBe('16,12');
    }
    // The same generator state digs the same base.
    const again = newUnderground(1);
    digBase(again, { x: 200, z: 150, dir: 'down' }, new Rand32(5));
    expect(again.base).toEqual(base);
    expect(u.records.baseMoves).toBe(0);
    base.goods[0] = { good: 10, x: 13, z: 14, slot: 0 };
    expect(digBase(u, { x: 50, z: 300, dir: 'left' }, new Rand32(6))).toBe('moved');
    expect(u.records.baseMoves).toBe(1);
    expect(u.base!.goods.every((g) => g === null)).toBe(true);
  });

  it('collides where the PC, goods and boulders are solid (SecretBases_AreCoordinatesWalkable)', () => {
    const u = newUnderground(1);
    digBase(u, { x: 200, z: 150, dir: 'down' }, new Rand32(5));
    const base = u.base!;
    base.boulders = base.boulders.map(() => null);
    base.boulders[0] = { x: 18, z: 20 };
    base.goods[2] = { good: 11, x: 12, z: 16, slot: 0 };
    expect(baseBlocked(base, GOODS, GOOD.pc, 15, 12)).toBe(true);
    expect(baseBlocked(base, GOODS, GOOD.pc, 16, 12)).toBe(true);
    expect(baseBlocked(base, GOODS, GOOD.pc, 17, 12)).toBe(false);
    expect([[18, 20], [19, 20], [18, 21], [19, 21]].every(([x, z]) => baseBlocked(base, GOODS, GOOD.pc, x!, z!))).toBe(true);
    // The L: (12, 16), then (12, 17) (13, 17) (14, 17).
    expect(baseBlocked(base, GOODS, GOOD.pc, 12, 16)).toBe(true);
    expect(baseBlocked(base, GOODS, GOOD.pc, 13, 16)).toBe(false);
    expect(baseBlocked(base, GOODS, GOOD.pc, 14, 17)).toBe(true);
    expect(baseThings(base, GOOD.pc).map((t) => t.index)).toEqual([0, 3, 16]);
  });

  it('reads a good\'s writing on its solid tiles, and finds a tool by its corner', () => {
    const u = newUnderground(1);
    digBase(u, { x: 200, z: 150, dir: 'down' }, new Rand32(5));
    const base = u.base!;
    base.goods[0] = { good: 10, x: 13, z: 14, slot: 0 };
    base.goods[1] = { good: 11, x: 17, z: 14, slot: 1 };
    base.goods[2] = { good: GOOD.holeTool + 1, x: 19, z: 19, slot: 2 };
    expect(goodMessageAt(base, GOODS, 14, 14)).toEqual({ good: 10, message: 36 });
    expect(goodMessageAt(base, GOODS, 17, 14)).toBeNull();
    expect(goodMessageAt(base, GOODS, 15, 14)).toBeNull();
    expect(toolAt(base, 19, 19)).toBe(12);
    expect(toolAt(base, 13, 14)).toBeNull();
  });

  it('places goods inside the room, off other things and off the tiles before the PC and the exit (BaseDecoration_CanPlaceGood)', () => {
    const u = newUnderground(1);
    digBase(u, { x: 200, z: 150, dir: 'down' }, new Rand32(5));
    const things = baseThings(u.base!, GOOD.pc).map((t) => thingRect(t, GOODS));
    const free = (r: ReturnType<typeof rectOf>) => !things.some((o) => o.minX <= r.maxX && r.minX <= o.maxX && o.minZ <= r.maxZ && r.minZ <= o.maxZ);
    expect(outOfRoom(rectOf(BASE.start.x, BASE.start.z, 2, 1))).toBe(false);
    expect(outOfRoom(rectOf(20, 23, 3, 1))).toBe(true);
    expect(outOfRoom(rectOf(9, 15, 1, 1))).toBe(true);
    expect(canPlace(rectOf(15, 13, 1, 1), [])).toBe(false);
    expect(canPlace(rectOf(14, 13, 2, 1), [])).toBe(false);
    expect(canPlace(rectOf(15, 23, 1, 1), [])).toBe(false);
    expect(canPlace(rectOf(14, 22, 1, 2), [])).toBe(true);
    const spot = [rectOf(14, 20, 1, 1), rectOf(13, 19, 1, 1)].find(free)!;
    expect(canPlace(spot, things)).toBe(true);
    const boulder = u.base!.boulders[0]!;
    expect(canPlace(rectOf(boulder.x + 1, boulder.z + 1, 1, 1), things)).toBe(false);
  });

  it('a solo base keeps the normal flag: ten goods, sixteen boulders that stay (SecretBase_GetPlacedGoodsLimit)', () => {
    expect([0, 1, 3, 10, 50].map(flagRank)).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 3, 10, 50].map(placedGoodsLimit)).toEqual([10, 12, 15, 15, 15]);
    expect([0, 1, 3, 10, 50].map(unremovableBoulders)).toEqual([16, 15, 11, 6, 0]);
  });

  it('stores and withdraws goods; one on display stays, and the PC slots after a withdrawn one move up', () => {
    const u = newUnderground(1);
    digBase(u, { x: 200, z: 150, dir: 'down' }, new Rand32(5));
    u.goods = [10, 11];
    expect(storeGood(u, 0)).toBe(true);
    expect(storeGood(u, 0)).toBe(true);
    expect(u.goodsPc).toEqual([10, 11]);
    expect(u.goods).toEqual([]);
    u.base!.goods[0] = { good: 11, x: 13, z: 14, slot: 1 };
    expect(goodPlaced(u, 1)).toBe(true);
    expect(withdrawGood(u, 1)).toBe('placed');
    u.goodsPc.unshift(12);
    u.base!.goods[0]!.slot = 2;
    expect(withdrawGood(u, 0)).toBe('withdrawn');
    expect(u.goodsPc).toEqual([10, 11]);
    expect(u.base!.goods[0]!.slot).toBe(1);
    u.goods = Array.from({ length: UNDERGROUND_LIMITS.goods }, () => 9);
    expect(withdrawGood(u, 0)).toBe('full');
    u.goodsPc = Array.from({ length: UNDERGROUND_LIMITS.goodsPc }, () => 9);
    expect(storeGood(u, 0)).toBe(false);
  });
});

describe('the traps\' escape games', () => {
  it('smoke: a stroke thins the tiles it passes (+3, +2 beside, +1 corners), the first point only starts it; under 13 left wins', () => {
    const pattern = Array.from({ length: SMOKE.width * SMOKE.height }, () => 0);
    for (let x = 0; x < 6; x++) for (let y = 0; y < 4; y++) pattern[y * SMOKE.width + x] = 1 | (x % 2 ? 0x400 : 0);
    const g = new SmokeGame(pattern);
    expect(g.won).toBe(false);
    expect(g.rub(12, 12)).toBe(false);
    expect(g.tiles[SMOKE.width + 1]! & 0xff).toBe(1);
    expect(g.rub(13, 12)).toBe(true);
    // The stroke's one point (12, 12) is tile (1, 1): it +3, (0..2, 1) +2 / +3, corners +1; flips stay.
    expect(g.tiles[SMOKE.width + 1]! & 0xff).toBe(4);
    expect(g.tiles[SMOKE.width + 1]! & 0x400).toBe(0x400);
    expect(g.tiles[1]! & 0xff).toBe(3);
    expect(g.tiles[0]! & 0xff).toBe(2);
    g.lift();
    for (let pass = 0; pass < 4; pass++) for (let y = 0; y < 32; y += 4) {
      g.lift();
      g.rub(0, y);
      g.rub(60, y);
    }
    expect(g.won).toBe(true);
    expect(() => new SmokeGame([1, 2])).toThrow(/pattern of 2/);
  });

  it('bubbles: 20 (1–2 large) or the foam\'s 7, inside the screen; a press pops the first one it is inside', () => {
    const big = new BubbleGame(false, new Rand32(9));
    expect(big.bubbles).toHaveLength(20);
    expect(big.bubbles.filter((b) => b.size === 0).length).toBeGreaterThanOrEqual(1);
    const foam = new BubbleGame(true, new Rand32(9));
    expect(foam.bubbles).toHaveLength(7);
    expect(foam.bubbles.some((b) => b.size === 0)).toBe(false);
    for (let t = 0; t < 600; t++) foam.step();
    for (const b of foam.bubbles) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(256);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(192);
    }
    expect(foam.press(0, 0)).toBeNull();
    while (!foam.won) {
      const b = foam.bubbles.find((x) => !x.popped)!;
      expect(foam.press(Math.round(b.x), Math.round(b.y))).toBe(b);
    }
    expect(foam.press(128, 96)).toBeNull();
  });

  it('the boulder: shadow, fall, then 11 hits for the rock (17 for the rockfall) cracking it every third, then the collapse', () => {
    const run = (fall: boolean) => {
      const g = new BoulderGame(fall);
      const events: string[] = [];
      let hits = 0;
      for (let t = 0; t < 2000 && !g.won; t++) {
        const e = g.step();
        if (e) events.push(e);
        if (g.phase === 'main' && t % 2 === 0) {
          expect(g.press(0, 0)).toBeNull();
          if (g.press(128, g.y)) hits++;
        }
      }
      return { g, events, hits };
    };
    const rock = run(false);
    expect(rock.g.won).toBe(true);
    expect(rock.events).toEqual(['landed', 'collapsed']);
    expect(rock.hits).toBe(11);
    expect(new BoulderGame(false).stage).toBe(2);
    const rockfall = run(true);
    expect(rockfall.hits).toBe(17);
    const g = new BoulderGame(true);
    while (g.phase !== 'main') g.step();
    expect(g.press(128, g.y)).toBe('hit');
    expect(g.press(128, g.y)).toBe('hit');
    expect(g.press(128, g.y)).toBe('cracked');
    expect(g.stage).toBe(1);
    expect(g.press(128, g.y)).toBeNull();
  });

  it('leaves: silence only sways them; a held blow pushes all of them off the screen', () => {
    const g = new LeafGame(false, new Rand32(3));
    expect(g.leaves).toHaveLength(16);
    expect(new LeafGame(true, new Rand32(3)).leaves).toHaveLength(32);
    const before = g.leaves.map((l) => ({ x: l!.x, y: l!.y }));
    for (let t = 0; t < 60; t++) g.step(0);
    expect(g.leaves.map((l) => ({ x: l!.x, y: l!.y }))).toEqual(before);
    let t = 0;
    while (!g.won && t++ < 1000) g.step(100);
    expect(g.won).toBe(true);
    expect(t).toBeLessThan(200);
  });

  it('the flame: blown hard it burns down a step every ten ticks; a pause relights it', () => {
    const ember = new FlameGame(false);
    expect(ember.scale()).toBe(2);
    // The last ten samples pass 500 from the sixth blow; the ninth tick blown hard takes a step.
    for (let i = 0; i < 14; i++) ember.step(100);
    expect(ember.intensity).toBe(1);
    expect(ember.scale()).toBe(1.5);
    for (let i = 0; i < 10; i++) ember.step(0);
    ember.step(0);
    expect(ember.intensity).toBe(2);
    const fire = new FlameGame(true);
    let t = 0;
    while (!fire.won && t++ < 200) fire.step(100);
    expect(fire.won).toBe(true);
    expect(t).toBe(44);
  });
});
