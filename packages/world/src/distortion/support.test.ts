/**
 * Support-local collision on the original four-surface fixture (fixture.ts): the decomp's step tables, the grid
 * axes of each support kind, the collision bits, and the floor's support change, which must never reach a
 * surface that only shares the step's x/z.
 */
import { describe, expect, it } from 'vitest';
import type { DwTile, Facing } from '@opensinnoh/contracts';
import { FIXTURE_BEHAVIOURS, fixtureBehaviour, fourSurfaceRoom } from './fixture.ts';
import { DW_COLLISION, behaviourAt, blockedAt, cellAt, findSupport, floorCollision, inBox, stepFrom, supportAt, supportCollision, surfaceOf, type Surface } from './support.ts';

const room = fourSurfaceRoom();
const t = (x: number, y: number, z: number): DwTile => ({ x, y, z });
const FLOOR_A = 0;
const FLOOR_B = 1;
const WEST = 2;
const EAST = 3;
const CEILING = 4;
const FLOOR_C = 5;
const host = (occupied: DwTile[] = []) => ({
  occupied: (q: DwTile) => occupied.some((o) => o.x === q.x && o.y === q.y && o.z === q.z),
  behaviour: fixtureBehaviour,
  surfable: (name: string) => name === 'DEEP_WATER',
});
const collide = (support: number, from: DwTile, dir: Facing, occupied: DwTile[] = []) => supportCollision(room, support, surfaceOf(room, support), from, dir, host(occupied));

describe('Distortion World supports', () => {
  it('steps by the decomp tables of each surface', () => {
    const at = t(0, 0, 0);
    const steps = (s: Surface) => (['up', 'down', 'left', 'right'] as const).map((d) => stepFrom(s, d, at));
    expect(steps('floor')).toEqual([t(0, 0, -1), t(0, 0, 1), t(-1, 0, 0), t(1, 0, 0)]);
    expect(steps('land')).toEqual(steps('floor'));
    expect(steps('west-wall')).toEqual([t(0, 1, 0), t(0, -1, 0), t(0, 0, 1), t(0, 0, -1)]);
    expect(steps('east-wall')).toEqual([t(0, 1, 0), t(0, -1, 0), t(0, 0, -1), t(0, 0, 1)]);
    expect(steps('ceiling')).toEqual([t(0, 0, 1), t(0, 0, -1), t(-1, 0, 0), t(1, 0, 0)]);
  });

  it('boxes include both ends', () => {
    const b = room.supports[FLOOR_A]!.box;
    expect([t(10, 20, 10), t(13, 20, 13)].every((q) => inBox(q, b))).toBe(true);
    expect([t(9, 20, 10), t(14, 20, 10), t(10, 21, 10), t(10, 20, 14)].some((q) => inBox(q, b))).toBe(false);
  });

  it('maps tiles to grid cells by the support kind', () => {
    // byte = v + 4h for unmarked cells.
    expect(behaviourAt(room, FLOOR_B, t(15, 20, 12))).toBe(1 + 4 * 2); // v = x − 14, h = z − 10
    expect(behaviourAt(room, WEST, t(9, 21, 11))).toBe(3 + 4 * 1); // v = sizeY − (y − 21): the bottom row is v 3
    expect(behaviourAt(room, WEST, t(9, 24, 11))).toBe(0 + 4 * 1);
    expect(behaviourAt(room, EAST, t(18, 21, 11))).toBe(0 + 4 * 1); // v = y − 21
    expect(behaviourAt(room, EAST, t(18, 24, 13))).toBe(3 + 4 * 3);
    expect(behaviourAt(room, CEILING, t(10, 26, 12))).toBe(3 + 4 * 2); // v = sizeX − (x − 10): reversed x
    expect(behaviourAt(room, CEILING, t(13, 26, 12))).toBe(0 + 4 * 2);
    // Outside the current support's box, or with none current: no cell.
    expect(cellAt(room, FLOOR_A, t(14, 20, 10))).toBeNull();
    expect(cellAt(room, null, t(10, 20, 10))).toBeNull();
    expect(blockedAt(room, FLOOR_A, t(12, 20, 11))).toBe(true);
    expect(blockedAt(room, FLOOR_A, t(11, 20, 11))).toBe(false);
    expect(() => surfaceOf(room, 9)).toThrow(/no support 9/);
  });

  it('collides on cells, objects, water and floor double jumps', () => {
    const { WILL_COLLIDE, OBJECT, WATER, JUMP_TWICE } = DW_COLLISION;
    expect(collide(FLOOR_A, t(11, 20, 11), 'right')).toBe(WILL_COLLIDE); // the blocked cell
    expect(collide(FLOOR_A, t(11, 20, 11), 'left')).toBe(0);
    expect(collide(FLOOR_A, t(10, 20, 11), 'left')).toBe(WILL_COLLIDE); // off the box
    expect(collide(FLOOR_A, t(11, 20, 12), 'left', [t(10, 20, 12)])).toBe(OBJECT);
    expect(collide(FLOOR_A, t(10, 20, 12), 'down')).toBe(WATER);
    expect(collide(FLOOR_A, t(12, 20, 10), 'right')).toBe(JUMP_TWICE);
    expect(collide(FLOOR_A, t(13, 20, 11), 'up')).toBe(0); // a double jump tile entered the wrong way is ground
    // Walls move in y and z; their x never changes.
    expect(collide(WEST, t(9, 24, 10), 'up')).toBe(WILL_COLLIDE);
    expect(collide(WEST, t(9, 23, 10), 'up')).toBe(0);
    expect(collide(WEST, t(9, 21, 13), 'left')).toBe(WILL_COLLIDE); // +z off the wall
    expect(collide(EAST, t(18, 21, 13), 'right')).toBe(WILL_COLLIDE);
    expect(collide(EAST, t(18, 21, 13), 'left')).toBe(0);
    expect(collide(CEILING, t(10, 26, 13), 'up')).toBe(WILL_COLLIDE); // up is +z on the ceiling
    expect(collide(CEILING, t(10, 26, 10), 'up')).toBe(0);
  });

  it('a double jump cell is only a jump on a floor', () => {
    const wallRoom = fourSurfaceRoom();
    wallRoom.supports[EAST]!.cells[1 + 4 * 0] = FIXTURE_BEHAVIOURS.jumpEastTwice;
    expect(supportCollision(wallRoom, EAST, 'east-wall', t(18, 21, 10), 'up', host())).toBe(0);
  });

  it('changes to the next floor at its edge, and keeps the change when it still collides', () => {
    const ask = (from: DwTile, dir: Facing, occupied: DwTile[] = []) => floorCollision(room, FLOOR_A, from, dir, (s) => supportCollision(room, s, 'floor', from, dir, host(occupied)));
    expect(ask(t(13, 20, 12), 'right')).toEqual({ support: FLOOR_B, collision: 0 });
    expect(ask(t(13, 20, 12), 'right', [t(14, 20, 12)])).toEqual({ support: FLOOR_B, collision: DW_COLLISION.OBJECT });
    // A step on the current support never changes it, nor one into no box.
    expect(ask(t(12, 20, 12), 'right')).toEqual({ support: FLOOR_A, collision: 0 });
    expect(ask(t(10, 20, 12), 'left')).toEqual({ support: FLOOR_A, collision: DW_COLLISION.WILL_COLLIDE });
    // A blocked cell of the current support is not a reason to look elsewhere.
    expect(ask(t(11, 20, 11), 'right')).toEqual({ support: FLOOR_A, collision: DW_COLLISION.WILL_COLLIDE });
  });

  it('never reaches a surface that only shares the x/z of the step', () => {
    // Floor C lies over floor A: from A every step stays on A, and C's tiles are not A's.
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const from = t(11, 20, 12);
      const r = floorCollision(room, FLOOR_A, from, dir, (s) => supportCollision(room, s, 'floor', from, dir, host()));
      expect(r.support, dir).toBe(FLOOR_A);
    }
    expect(cellAt(room, FLOOR_A, t(11, 25, 12))).toBeNull();
    expect(findSupport(room, t(11, 25, 12), 'floor')).toBe(FLOOR_C);
    expect(findSupport(room, t(11, 20, 12), 'floor')).toBe(FLOOR_A);
  });

  it('keeps the decomp quirk: any support kind answers supportAt while one is current', () => {
    // HasFloatingPlatformAtCoords tests `kind != INVALID || kind == template kind`.
    expect(supportAt(room, FLOOR_A, t(9, 22, 11))).toBe(true); // the west wall's box
    expect(supportAt(room, null, t(9, 22, 11))).toBe(false);
    // …but the change itself takes only the current kind: none here, so no support is current after it.
    expect(findSupport(room, t(9, 22, 11), 'floor')).toBeNull();
    expect(findSupport(room, t(9, 22, 11), 'land')).toBe(WEST);
  });
});
