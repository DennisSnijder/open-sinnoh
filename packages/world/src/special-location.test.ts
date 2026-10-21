import { describe, expect, it } from 'vitest';
import type { Registries } from '@opensinnoh/contracts';
import { f, newState, pos, registries, setup, type Harness } from './testing.ts';

/** ROOM warp 0 (15,20, pushed into from the mat) and TOWN warp 0 (the door at 10,13), made dynamic as asked. */
function dynamic(room: boolean, town: boolean): Registries {
  const regs = structuredClone(registries);
  if (room) regs.zones.get(f('ROOM'))!.events.warps[0]!.toZone = 'dynamic';
  if (town) regs.zones.get(f('TOWN'))!.events.warps[0]!.toZone = 'dynamic';
  return regs;
}

function leaveRoom(g: Harness) {
  g.hold(['right'], 2 + 8);
  g.hold(['down'], 3 * 8);
  expect(pos(g.state)).toEqual([f('ROOM'), 15, 19, 'down']);
  g.tick(['down']);
  g.settle();
}

describe('special location (decomp Field_MapConnection, FieldMapChange_SetNewLocation)', () => {
  it('a dynamic warp leads to the special location: a warp index, or x/z', () => {
    const g = setup(newState(), { regs: dynamic(true, false) });
    g.state.specialLocation = { zone: f('TOWN'), warp: 0, x: 0, z: 0, facing: 'down' };
    leaveRoom(g);
    // TOWN warp 0 is the door at 10,13: the player walks out of it.
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'down']);

    const h = setup(newState(), { regs: dynamic(true, false) });
    h.state.specialLocation = { zone: f('TOWN'), warp: -1, x: 12, z: 16, facing: 'up' };
    leaveRoom(h);
    expect(pos(h.state)).toEqual([f('TOWN'), 12, 16, 'down']);
  });

  it('arriving at a dynamic warp copies the entrance into it, so that warp leads back', () => {
    const g = setup(newState(), { regs: dynamic(true, true) });
    g.state.specialLocation = { zone: f('TOWN'), warp: 0, x: 0, z: 0, facing: 'down' };
    leaveRoom(g);
    expect(pos(g.state)).toEqual([f('TOWN'), 10, 14, 'down']);
    // The entrance: the ROOM warp pushed into (index 0 at 15,20), facing down.
    expect(g.state.specialLocation).toEqual({ zone: f('ROOM'), warp: 0, x: 15, z: 20, facing: 'down' });
    g.hold(['up'], 3);
    g.settle();
    expect(pos(g.state)).toEqual([f('ROOM'), 15, 19, 'up']);
    expect(g.state.specialLocation).toEqual({ zone: f('TOWN'), warp: 0, x: 10, z: 13, facing: 'up' });
  });

  it('a plain warp records nothing; a dynamic warp with no special location throws', () => {
    const g = setup(newState());
    leaveRoom(g);
    expect(g.state.specialLocation).toBe(null);
    const h = setup(newState(), { regs: dynamic(true, false) });
    expect(() => leaveRoom(h)).toThrow(/no special location is set/);
  });
});
