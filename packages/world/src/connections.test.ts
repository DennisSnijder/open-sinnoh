import { fixtureAudio } from '../../../tests/fixtures/audio.ts';
import { DEFAULT_CLOCK } from '@opensinnoh/core';
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectEvent } from '@opensinnoh/contracts';
import { createWorld } from './world.ts';
import { FakeRunner, f, newState, registries, setup } from './testing.ts';

/** ROUTE: one 2×1 matrix, ROUTE_W in cell 0 (x 0..31), ROUTE_E in cell 1 (x 32..63, 8 objects, another area). */
describe('zone connections (decomp FieldMap_ChangeZone)', () => {
  it('a step into the other zone’s cell switches the zone at the step start, without a fade; the area stays', () => {
    const g = setup(newState('ROUTE_W', 31, 16, 'right'));
    expect(g.state.objects).toEqual([]);
    g.state.flags[f('FLAG_MAP_LOCAL_0')] = true;
    g.tick(['right']);
    expect(g.state.player).toMatchObject({ zone: f('ROUTE_E'), x: 32 });
    expect(g.world.fadeState()).toBe(null);
    expect(g.state.flags[f('FLAG_MAP_LOCAL_0')]).toBeUndefined();
    expect(g.state.objects.map((o) => [o.zone, o.localId])).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((id) => [f('ROUTE_E'), id]));
    const view = g.world.view();
    expect(view).toMatchObject({ zone: f('ROUTE_E'), matrix: f('MATRIX_ROUTE'), area: f('AREA_OUTDOOR') });
    // No map load: the renderer keeps its scene.
    expect(view.loads).toBe(1);
  });

  it('crossing back deletes the old zone’s objects at once, except persistent ones, which keep their zone', () => {
    const g = setup(newState('ROUTE_E', 32, 24, 'left'));
    g.world.setObjectPersistent(6, true);
    g.hold(['left'], 1);
    expect(g.state.player.zone).toBe(f('ROUTE_W'));
    expect(g.state.objects.map((o) => [o.zone, o.localId])).toEqual([[f('ROUTE_E'), 6]]);
    // Back east: ROUTE_E spawns its objects again, except the local id still present.
    g.hold(['left'], 7);
    g.hold(['right'], 9);
    expect(g.state.player.zone).toBe(f('ROUTE_E'));
    expect(g.state.objects.map((o) => o.localId).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('runs the new zone’s onTransition (not onLoad), after clearing map-local state', () => {
    const regs = structuredClone(registries);
    regs.zones.get(f('ROUTE_E'))!.mapScripts = { onTransition: f('Town_OnTransition'), onLoad: f('Room_Helper'), onFrame: [] };
    const g = setup(newState('ROUTE_W', 31, 16, 'right'), { regs });
    g.tick(['right']);
    expect(g.scripts.immediates.map((s) => [s.label, s.source, s.zone])).toEqual([[f('Town_OnTransition'), 'transition', f('ROUTE_E')]]);
  });

  it('a save in the new zone loads it with its own area (a map load), objects and all', () => {
    const g = setup(newState('ROUTE_W', 31, 16, 'right'));
    g.hold(['right'], 8);
    g.settle();
    const saved = structuredClone(g.state);
    const world = createWorld({ audio: fixtureAudio(registries, saved), registries, state: saved, scripts: new FakeRunner(saved), log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK });
    world.enter('load');
    expect(world.view()).toMatchObject({ zone: f('ROUTE_E'), area: f('AREA_ROUTE') });
    expect(saved.objects.map((o) => o.localId)).toEqual(g.state.objects.map((o) => o.localId));
  });

  /**
   * A guide of ROUTE_W next to the border, listed in ROUTE_E as a clone (local id 0, which ROUTE_E's hiker
   * also uses), and ROUTE_E's object 3 listed in ROUTE_W as a clone: Twinleaf's guitarist and Route 201's
   * arrow signpost.
   */
  function clones() {
    const regs = structuredClone(registries);
    const west = regs.zones.get(f('ROUTE_W'))!;
    const east = regs.zones.get(f('ROUTE_E'))!;
    const e3 = east.events.objects.find((o) => o.localId === 3)!;
    const guide: ObjectEvent = { localId: 0, sprite: f('SPRITE_GUIDE'), movementType: 15, trainerType: 0, label: f('Town_OnTransition'), facing: 'down', data: [0, 0, 0], range: { x: 0, z: 0 }, x: 30, z: 20, y: 0 };
    // A clone has no label, flag or trainer of its own.
    const clone = (o: ObjectEvent, cloneOf: string): ObjectEvent => ({ localId: o.localId, sprite: o.sprite, movementType: o.movementType, trainerType: 0, facing: o.facing, data: o.data, range: o.range, x: o.x, z: o.z, y: o.y, cloneOf: f(cloneOf) });
    west.events.objects = [guide, clone(e3, 'ROUTE_E')];
    east.events.objects.push(clone(guide, 'ROUTE_W'));
    return { regs, e3 };
  }

  it('an object listed in both zones (a clone) is carried over with its state, not deleted and respawned', () => {
    const { regs, e3 } = clones();
    const g = setup(newState('ROUTE_W', 31, 16, 'right'), { regs });
    g.settle();
    // Moved and turned live: a respawn would put them back on their event's tile and facing.
    g.world.setPositionLive(0, 29, 20, 'left');
    g.world.setPositionLive(3, e3.x, e3.z, 'up');
    const west = structuredClone(g.state.objects);
    expect(west.map((o) => [o.zone, o.localId, o.x, o.z, o.facing])).toEqual([
      [f('ROUTE_W'), 0, 29, 20, 'left'],
      [f('ROUTE_W'), 3, e3.x, e3.z, 'up'],
    ]);
    g.tick(['right']);
    expect(g.state.player.zone).toBe(f('ROUTE_E'));
    // Both kept their tile and facing, and now belong to ROUTE_E.
    const east = g.state.objects.map((o) => [o.zone, o.localId, o.x, o.z, o.facing]);
    expect(east).toContainEqual([f('ROUTE_E'), 0, 29, 20, 'left']);
    expect(east).toContainEqual([f('ROUTE_E'), 3, e3.x, e3.z, 'up']);
    expect(g.state.objects).toHaveLength(9);
    // ROUTE_E's hiker keeps local id 0 for scripts; object 3 is ROUTE_E's real one again.
    g.world.setPositionLive(0, 42, 10, 'up');
    expect(g.state.objects.filter((o) => o.localId === 0).map((o) => [o.x, o.z, o.facing])).toEqual([
      [42, 10, 'up'],
      [29, 20, 'left'],
    ]);
    // And back: the guide is ROUTE_W's object 0 again, still facing left.
    g.hold(['left'], 9);
    expect(g.state.player.zone).toBe(f('ROUTE_W'));
    expect(g.state.objects.map((o) => [o.zone, o.localId, o.x, o.z, o.facing])).toEqual([
      [f('ROUTE_W'), 0, 29, 20, 'left'],
      [f('ROUTE_W'), 3, e3.x, e3.z, 'up'],
    ]);
  });

  it('a clone with a different native local id carries over, renders once and keeps native save identities', () => {
    const { regs } = clones();
    const copy = regs.zones.get(f('ROUTE_E'))!.events.objects.at(-1)!;
    copy.cloneLocalId = copy.localId;
    copy.localId = 20;
    const g = setup(newState('ROUTE_W', 31, 16, 'right'), { regs });
    g.world.setPositionLive(0, 29, 20, 'left');
    g.tick(['right']);
    expect(g.state.objects).toContainEqual(expect.objectContaining({ localId: 20, x: 29, z: 20 }));
    const guide = () => g.world.view().actors.filter(a => a.home === f('ROUTE_W'));
    expect(guide()).toHaveLength(1);
    expect(guide()[0]).toMatchObject({ localId: 0, facing: 'left' });
    expect(g.world.view().previews.some(a => a.home === f('ROUTE_W') && a.localId === 0)).toBe(false);
    g.hold([], 9);
    g.world.enter('load');
    expect(guide()).toHaveLength(1);
    expect(g.state.objects).toContainEqual(expect.objectContaining({ localId: 20, x: 29, z: 20 }));
    g.hold(['left'], 9);
    expect(g.state.player.zone).toBe(f('ROUTE_W'));
    expect(g.state.objects).toContainEqual(expect.objectContaining({ localId: 0, x: 29, z: 20 }));
  });

  it('a load restores a carried clone, not the hidden object of its zone with the same local id (Eterna’s signpost and grunt)', () => {
    const { regs } = clones();
    const hiker = regs.zones.get(f('ROUTE_E'))!.events.objects.find((o) => o.localId === 0 && !o.cloneOf)!;
    hiker.hideFlag = f('FLAG_HIDE_GUIDE');
    const load = (state: GameState) => {
      const world = createWorld({ audio: fixtureAudio(regs, state), registries: regs, state, scripts: new FakeRunner(state), log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK });
      world.enter('load');
      return world.view().actors.filter((a) => a.localId === 0).map((a) => [a.home, a.sprite]);
    };
    for (const hidden of [true, false]) {
      const g = setup(newState('ROUTE_W', 31, 16, 'right'), { regs });
      if (hidden) g.state.flags[f('FLAG_HIDE_GUIDE')] = true;
      g.tick(['right']);
      g.settle();
      expect(g.state.objects.filter((o) => o.localId === 0).map((o) => o.cloneOf)).toEqual(hidden ? [f('ROUTE_W')] : [undefined, f('ROUTE_W')]);
      const guide = [f('ROUTE_W'), f('SPRITE_GUIDE')];
      expect(load(structuredClone(g.state))).toEqual(hidden ? [guide] : [[f('ROUTE_E'), hiker.sprite], guide]);
      // A save from before contracts 0.27.9 marks no clone: an object is not spawned hidden, so it is the clone.
      const legacy = structuredClone(g.state);
      for (const o of legacy.objects) delete o.cloneOf;
      expect(load(legacy)).toEqual(hidden ? [guide] : [[f('ROUTE_E'), hiker.sprite], guide]);
    }
  });

  it('the view lists what a crossing deleted, and the other zone’s objects it would spawn (presentation only)', () => {
    const g = setup(newState('ROUTE_E', 32, 24, 'left'));
    const east = registries.zones.get(f('ROUTE_E'))!.events.objects;
    const atTile = (v: { cur: number[] }) => [Math.floor(v.cur[0]! / 16), Math.floor(v.cur[2]! / 16)];
    expect(g.world.view().departed).toBeUndefined();
    expect(g.world.view().actors.map((a) => a.home)).toEqual([undefined, ...east.map(() => f('ROUTE_E'))]);
    expect(g.world.view().previews).toEqual([]);
    const before = g.world.view().actors.slice(1);
    g.tick(['left']);
    expect(g.state.player.zone).toBe(f('ROUTE_W'));
    const view = g.world.view();
    expect(view.departed!.crossing).toBe(1);
    expect(view.departed!.actors.map((a) => [a.home, a.localId, a.sprite, a.cur])).toEqual(before.map((a) => [f('ROUTE_E'), a.localId, a.sprite, a.cur]));
    // ROUTE_E's objects, standing on their event tiles, as the next crossing would spawn them.
    expect(view.previews.map((a) => [a.home, a.localId, a.sprite, atTile(a), a.facing, a.anim])).toEqual(east.map((o) => [f('ROUTE_E'), o.localId, o.sprite, [o.x, o.z], o.facing, 'stand']));
    // A map load forgets the crossing.
    g.world.enter('load');
    expect(g.world.view().departed).toBeUndefined();
  });

  it('previews leave out objects live here as clones, and the other zone’s clones', () => {
    const { regs } = clones();
    const g = setup(newState('ROUTE_W', 31, 16, 'right'), { regs });
    const east = regs.zones.get(f('ROUTE_E'))!.events.objects;
    // ROUTE_E's object 3 is live here (ROUTE_W's clone of it, home ROUTE_E); ROUTE_E's clone of the guide is ROUTE_W's guide.
    expect(g.world.view().actors.slice(1).map((a) => [a.home, a.localId])).toEqual([
      [f('ROUTE_W'), 0],
      [f('ROUTE_E'), 3],
    ]);
    expect(g.world.view().previews.map((a) => a.localId)).toEqual(east.filter((o) => !o.cloneOf && o.localId !== 3).map((o) => o.localId));
    g.tick(['right']);
    // Carried over, both keep their home; nothing was deleted.
    expect(g.world.view().departed!.actors).toEqual([]);
    expect(g.world.view().actors.filter((a) => a.localId === 0).map((a) => a.home)).toEqual([f('ROUTE_E'), f('ROUTE_W')]);
    expect(g.world.view().previews).toEqual([]);
  });
});
