import { describe, expect, it } from 'vitest';
import {
  burySphere,
  MINING,
  MiningBoard,
  type MiningObject,
  newUnderground,
  Rand16,
  Rand32,
  retrieveSphere,
  SPHERE,
  undergroundDaily,
  UNDERGROUND_LIMITS,
} from './underground.ts';

/** An original table: two spheres, a 2×2 treasure with a hole and a rock (no ROM data). */
const TABLE: MiningObject[] = [
  { id: 1, weights: [10, 10, 10, 10], width: 2, height: 2, shape: null, sprite: 0, palette: 0 },
  { id: 3, weights: [10, 10, 10, 10], width: 2, height: 2, shape: null, sprite: 1, palette: 0 },
  { id: 35, weights: [5, 5, 5, 5], width: 2, height: 2, shape: 'xxxo', sprite: 2, palette: 1 },
  { id: 60, weights: [0, 0, 0, 0], width: 3, height: 1, shape: null, sprite: 3, palette: 0 },
];
const ground = { secretBase: false, object: false, wall: false };

describe('the DS generators', () => {
  it('Rand16 is MATH_Rand16: x·1566083941 + 2531011, the high half scaled', () => {
    const r = new Rand16(0);
    expect(r.next(0)).toBe(2531011 >>> 16);
    const x = (Math.imul(2531011, 1566083941) + 2531011) >>> 0;
    expect(r.next(100)).toBe(Math.floor(((x >>> 16) * 100) / 0x10000));
  });

  it('Rand32 is MATH_Rand32: a 64-bit LCG whose high word is scaled', () => {
    const r = new Rand32(1);
    const x = (1n * ((1566083941n << 32n) + 1812433253n) + 2531011n) & ((1n << 64n) - 1n);
    expect(r.next(0)).toBe(Number(x >> 32n));
    expect(r.state()).toBe(x.toString());
  });
});

describe('spheres in the ground', () => {
  it('buries, merges the same kind, refuses another kind, and comes up grown', () => {
    const u = newUnderground(7);
    expect(burySphere(u, { type: SPHERE.red, size: 20 }, { x: 100, z: 100, ...ground })).toBe('buried');
    expect(burySphere(u, { type: SPHERE.blue, size: 5 }, { x: 100, z: 100, ...ground })).toBe('other-sphere');
    expect(burySphere(u, { type: SPHERE.red, size: 10 }, { x: 100, z: 100, ...ground })).toBe('merged');
    expect(u.buried).toEqual([{ x: 100, z: 100, type: SPHERE.red, size: 20 + 2 + 1, growth: 0 }]);
    expect(burySphere(u, { type: SPHERE.red, size: 10 }, { x: 101, z: 100, ...ground, wall: true })).toBe('wall');
    undergroundDaily(u, 1);
    expect(u.respawn).toBe(true);
    // Red grows 3–6 a day (the decomp's growthRateRange 4, baseGrowthRate 3).
    expect(u.buried[0]!.growth).toBeGreaterThanOrEqual(3);
    expect(u.buried[0]!.growth).toBeLessThanOrEqual(6);
    const grown = u.buried[0]!.size + u.buried[0]!.growth;
    expect(retrieveSphere(u, 0)).toMatchObject({ type: SPHERE.red, size: grown });
    expect(u.buried).toEqual([]);
    expect(u.spheres).toEqual([{ type: SPHERE.red, size: grown }]);
  });

  it('a 101st buried sphere takes the oldest one’s place', () => {
    const u = newUnderground(1);
    for (let i = 0; i <= UNDERGROUND_LIMITS.buried; i++) burySphere(u, { type: SPHERE.pale, size: 1 }, { x: 40 + i, z: 100, ...ground });
    expect(u.buried).toHaveLength(UNDERGROUND_LIMITS.buried);
    expect(u.buried[0]!.x).toBe(41);
  });

  it('growth over many days stops at 99', () => {
    const u = newUnderground(3);
    burySphere(u, { type: SPHERE.green, size: 90 }, { x: 100, z: 100, ...ground });
    undergroundDaily(u, 400);
    expect(u.buried[0]!.growth).toBe(99);
    expect(retrieveSphere(u, 0)).toEqual({ type: SPHERE.green, size: 99, growth: 9 });
  });
});

describe('the mining board', () => {
  it('lays three items on the first board, apart, on the generator given', () => {
    const a = new MiningBoard(TABLE, { mined: false, plates: 0 }, false, false, new Rand32(12345n));
    const b = new MiningBoard(TABLE, { mined: false, plates: 0 }, false, false, new Rand32(12345n));
    expect(a.items).toBe(3);
    expect(a.objects.map((o) => [o.object.id, o.x, o.y])).toEqual(b.objects.map((o) => [o.object.id, o.x, o.y]));
    expect(a.dirt).toEqual(b.dirt);
    // Every item's cells are its own in the grid.
    a.objects.forEach((o, i) => {
      for (let y = 0; y < o.object.height; y++)
        for (let x = 0; x < o.object.width; x++) if (o.object.shape?.[y * o.object.width + x] !== 'o') expect(a.grid[(o.y + y) * MINING.width + o.x + x]).toBe(i + 1);
    });
  });

  it('later boards hold 2–5 items and rocks', () => {
    for (let seed = 1n; seed < 20n; seed++) {
      const board = new MiningBoard(TABLE, { mined: true, plates: 0 }, true, false, new Rand32(seed));
      expect(board.items).toBeGreaterThanOrEqual(2);
      expect(board.items).toBeLessThanOrEqual(5);
      expect(board.objects.slice(board.items).every((o) => o.object.id === 60)).toBe(true);
    }
  });

  it('the pickaxe takes 4 off the wall and two layers off the cell, the hammer 8; the wall collapses at 0', () => {
    const board = new MiningBoard(TABLE, { mined: false, plates: 0 }, false, false, new Rand32(99n));
    const before = board.dirt[0]!;
    board.strike(0, 0, true);
    expect(board.wall).toBe(MINING.wall - 4);
    expect(board.dirt[0]).toBe(Math.max(0, before - 2));
    board.strike(5, 5, false);
    expect(board.wall).toBe(MINING.wall - 12);
    while (board.wall > 0) board.strike(6, 6, false);
    expect(board.wall).toBe(0);
  });

  it('digging every item bare uncovers them all once', () => {
    const board = new MiningBoard(TABLE, { mined: false, plates: 0 }, false, false, new Rand32(5n));
    board.grid.forEach((i, c) => {
      if (i) board.dirt[c] = 0;
    });
    expect(board.uncover()).toEqual({ all: true, fresh: [0, 1, 2] });
    expect(board.uncover()).toEqual({ all: true, fresh: [] });
  });
});
