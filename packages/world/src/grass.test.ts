/**
 * Grass field effects (map_object_move.c step hooks; ov5_021F2D20.c tall grass, ov5_021F37A8.c very tall
 * grass, ov5_021F3A50.c mud grass) on the fixture ROUTE_W grass (x 4..9, z 4..9) and TERRAIN mud grass (14,9).
 * The fixture TALL_GRASS rustle is 13 ticks (frames 0..12, the DS clip), MUD_GRASS 3.
 */
import { describe, expect, it } from 'vitest';
import { f, newState, setup, type Harness } from './testing.ts';

const grass = (g: Harness) =>
  g.world
    .view()
    .effects.filter((e) => e.anim === 'rustle')
    .map((e) => ({ effect: e.effect, tile: [(e.cur[0] - 8) / 16, (e.cur[2] - 8) / 16], tick: e.tick }));

describe('grass field effects', () => {
  it('a walk into tall grass rustles on the new tile for 13 ticks, then holds while the walker stands there', () => {
    const g = setup(newState('ROUTE_W', 3, 6, 'right'));
    expect(grass(g)).toEqual([]);
    g.tick(['right']);
    // The hook runs when the walk starts (sub_0206363C), on the tile walked into.
    expect(grass(g)).toEqual([{ effect: f('FLDEFF_TALL_GRASS'), tile: [4, 6], tick: 1 }]);
    g.hold([], 100);
    expect(grass(g)).toEqual([{ effect: f('FLDEFF_TALL_GRASS'), tile: [4, 6], tick: 101 }]);
    // Leaving: the held grass ends at once; the new tile rustles.
    g.tick(['right']);
    expect(grass(g)).toEqual([{ effect: f('FLDEFF_TALL_GRASS'), tile: [5, 6], tick: 1 }]);
  });

  it('the rustle starts on the tick the walker first moves (2 of 16 units), not during a turn', () => {
    // Decomp: MovementAction_Walk*_Step0 sets START_MOVEMENT and returns TRUE, so MapObject_DoMovementAction
    // runs Walk_Step1 (the first 2-unit move) in the same frame; MapObject_Move then runs sub_0206363C, which
    // spawns the grass. Everything runs at 30 Hz (NitroMain waits two vblanks a loop), so effect frame 0
    // (the leaf burst, anim frames 0–3) shows while the walker covers units 2–8 of the tile.
    const timeline = (facing: 'left' | 'right') => {
      const g = setup(newState('ROUTE_W', 5, 6, facing));
      const out: { tick: number; moved: number; rustle: number | null }[] = [];
      for (let t = 1; t <= 6; t++) {
        g.tick(['right']);
        const v = g.world.view();
        const rustle = v.effects.find((e) => e.anim === 'rustle' && e.cur[0] === 6 * 16 + 8);
        out.push({ tick: t, moved: v.actors[0]!.cur[0] - (5 * 16 + 8), rustle: rustle?.tick ?? null });
      }
      return out.filter((r) => r.moved > 0 || r.rustle !== null)[0];
    };
    expect(timeline('right')).toEqual({ tick: 1, moved: 2, rustle: 1 });
    // Facing away, the player turns first (2 ticks on the spot): the grass waits for the walk.
    expect(timeline('left')).toEqual({ tick: 3, moved: 2, rustle: 1 });
  });

  it('a walker that leaves before the rustle ends keeps it until its 13 ticks have played', () => {
    const g = setup(newState('ROUTE_W', 3, 6, 'right'));
    g.hold(['right'], 12); // 8 ticks a tile: the walk to x 5 started on tick 9
    expect(grass(g)).toEqual([
      { effect: f('FLDEFF_TALL_GRASS'), tile: [4, 6], tick: 12 },
      { effect: f('FLDEFF_TALL_GRASS'), tile: [5, 6], tick: 4 },
    ]);
    g.tick(['right']);
    expect(grass(g).map((e) => e.tile)).toEqual([[5, 6]]);
  });

  it('running leaves a trail of rustles that each play out', () => {
    const s = newState('ROUTE_W', 3, 6, 'right');
    s.runningShoes = true;
    const g = setup(s);
    g.hold(['right', 'b'], 12); // 4 ticks a tile
    expect(grass(g).map((e) => [e.tile[0], e.tick])).toEqual([
      [4, 12],
      [5, 8],
      [6, 4],
    ]);
  });

  it('an object placed in grass shows it settled (last frame) at once', () => {
    const g = setup(newState('ROUTE_W', 5, 6, 'down'));
    const [e] = grass(g);
    expect(e!.tile).toEqual([5, 6]);
    expect(e!.tick).toBeGreaterThanOrEqual(12);
  });

  it('NPCs rustle grass too; a removed object takes its grass with it', () => {
    const g = setup(newState('ROUTE_E', 34, 24, 'down'));
    g.world.setPositionLive(6, 10, 6, 'left');
    g.world.applyMovement(6, f('MV_GUIDE_APPROACH'));
    for (let i = 0; i < 60 && !g.world.movementDone(6); i++) g.tick();
    expect(grass(g).map((e) => e.tile)).toEqual([[7, 6]]);
    g.world.removeObject(6);
    g.tick();
    expect(grass(g)).toEqual([]);
  });

  it('mud with grass rustles 3 ticks, then holds', () => {
    const g = setup(newState('TERRAIN', 15, 9, 'left'));
    g.tick(['left']);
    expect(grass(g)).toEqual([{ effect: f('FLDEFF_MUD_GRASS'), tile: [14, 9], tick: 1 }]);
  });
});
