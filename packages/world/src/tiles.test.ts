import { describe, expect, it } from 'vitest';
import { f, newState, pos, setup } from './testing.ts';

describe('ledges (decomp PlayerAvatar_WillJump, JUMP_FAR 16 frames)', () => {
  it('walking south into a south ledge jumps two tiles in 16 ticks with an arc', () => {
    const g = setup(newState('ROUTE_W', 14, 13, 'down'));
    g.tick(['down']);
    // Mid-jump: above the ground and already logically on the landing tile.
    g.hold(['down'], 6);
    expect(g.world.view().actors[0]!.cur[1]).toBeGreaterThan(0);
    expect(pos(g.state)).toEqual([f('ROUTE_W'), 14, 15, 'down']);
    g.hold([], 9);
    expect(g.world.idle()).toBe(true);
    expect(g.world.view().actors[0]!.cur[1]).toBe(0);
  });

  it('a ledge blocks the other directions; east and west ledges jump sideways', () => {
    const g = setup(newState('ROUTE_W', 14, 15, 'up'));
    g.hold(['up'], 20);
    expect(pos(g.state)).toEqual([f('ROUTE_W'), 14, 15, 'up']);
    g.settle();
    g.world.warp(f('ROUTE_W'), 23, 16, 'right');
    g.settle();
    g.hold(['right'], 16);
    expect(pos(g.state)).toEqual([f('ROUTE_W'), 25, 16, 'right']);
    // From between the ledges, east is the west-jump ledge: a bump, not a jump.
    g.hold(['right'], 20);
    expect(pos(g.state)).toEqual([f('ROUTE_W'), 25, 16, 'right']);
    g.settle();
    g.world.warp(f('ROUTE_W'), 27, 17, 'left');
    g.settle();
    g.hold(['left'], 16);
    expect(pos(g.state)).toEqual([f('ROUTE_W'), 25, 17, 'left']);
  });
});

describe('tile behaviour interactions (decomp Field_TileBehaviorToScript)', () => {
  it('A facing PC, bookshelf, town map or trash can runs its script; bg events come first', () => {
    const cases: [number, number, 'up' | 'right', string][] = [
      [17, 12, 'up', 'Common_PC'],
      [19, 12, 'up', 'Common_Bookshelf'],
      [15, 12, 'up', 'Common_TownMap'],
      [19, 12, 'right', 'Common_TrashCan'],
    ];
    for (const [x, z, facing, label] of cases) {
      const g = setup(newState('ROOM', x, z, facing));
      g.tick(['a']);
      expect(g.scripts.starts.at(-1)).toMatchObject({ label: f(label), source: 'bg' });
    }
    // The TV bg event at (12,12) wins over any tile behaviour there.
    const g = setup(newState('ROOM', 12, 13, 'up'));
    g.tick(['a']);
    expect(g.scripts.starts.at(-1)).toMatchObject({ label: f('Room_TV') });
  });

  it('a behaviour with a required facing needs it (PC: facing north only)', () => {
    const g = setup(newState('ROOM', 18, 11, 'left'));
    g.tick(['a']);
    expect(g.scripts.starts).toEqual([]);
  });
});
