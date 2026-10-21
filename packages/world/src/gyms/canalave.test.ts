import { audioTrace, withFieldSounds } from '../../../../tests/fixtures/audio.ts';
import { describe, expect, it } from 'vitest';
import type { GymTables, NewGame, Registries } from '@opensinnoh/contracts';
import { f, newState, registries, setup, type Harness } from '../testing.ts';
import { CanalaveGym } from './canalave.ts';

/**
 * Canalave Gym on original synthetic tables (not the ROM's) in the fixture ROOM (flat, height 0; walkable x
 * 11–20, z 12–19): platform 0 a lift at 15,15 (floor 0 ↔ floor 1), platform 1 an x platform 13,17 → 17,17
 * starting at B, platform 2 a z platform elsewhere. Floor 0's mask blocks 12,15.
 */
const zeros = () => Array.from({ length: 1024 }, () => 0);
const floor0 = zeros();
floor0[12 + 15 * 32] = 1;
const TABLES = {
  canalave: {
    platforms: [
      { prop: f('PROP_TABLE'), axis: 'y', a: [15, 0, 15], b: [15, 10, 15], floorA: 0, floorB: 1 },
      { prop: f('PROP_TABLE'), axis: 'x', a: [13, 0, 17], b: [17, 0, 17], floorA: 0, floorB: 0 },
      { prop: f('PROP_TABLE'), axis: 'z', a: [5, 0, 5], b: [5, 0, 9], floorA: 0, floorB: 0 },
    ],
    startInB: [false, true, false],
    collision: [floor0, zeros(), zeros(), zeros()],
    floors: [f('PROP_TABLE'), f('PROP_HOUSE'), f('PROP_DOOR')],
  },
} as unknown as GymTables;

function gym(x: number, z: number, facing: 'up' | 'down' | 'left' | 'right' = 'up'): Harness {
  const regs = { ...registries } as Registries;
  const ng = [...registries.newGame.values()][0]!;
  regs.newGame = new Map([[ng.id, { ...ng, gyms: TABLES } as NewGame]]);
  const g = setup(newState('ROOM', x, z, facing), { regs: withFieldSounds(regs) });
  g.world.initMapFeatures('canalave-gym');
  g.world.enter('load');
  g.settle();
  return g;
}

const probe = (g: Harness) => ((g.world as unknown as { feature: CanalaveGym }).feature as CanalaveGym).probe();

describe('Canalave Gym lifts (decomp gym_features.c CanalaveGym_*)', () => {
  it('starts from the start table and collides by the floor mask alone', () => {
    const g = gym(13, 15, 'left');
    expect(g.state.mapFeatures).toEqual({ kind: 'canalave-gym', platformStates: 0b010 });
    expect(probe(g).positions).toEqual([
      [15, 0, 15],
      [17, 0, 17],
      [5, 0, 5],
    ]);
    g.hold(['left'], 20);
    g.settle();
    expect(g.state.player).toMatchObject({ x: 13, z: 15 });
  });

  it('a lift: the bit flips at the step, 8 units a tick with height calculation off, 20 ticks a floor', () => {
    const g = gym(14, 15, 'right');
    g.hold(['right'], 1);
    let ticks = 0;
    const ys: number[] = [];
    while (g.state.mapFeatures!.kind === 'canalave-gym' && (g.state.mapFeatures as { platformStates: number }).platformStates === 0b010 && ticks < 50) {
      g.tick();
      ticks++;
    }
    expect(g.state.mapFeatures).toEqual({ kind: 'canalave-gym', platformStates: 0b011 });
    expect(g.world.idle()).toBe(false);
    for (let i = 0; i < 40 && !g.world.idle(); i++) {
      g.tick();
      ys.push((g.world as unknown as { hero: { y: number } }).hero.y);
    }
    expect(ys.filter((y) => y > 0 && y < 160)).toHaveLength(19);
    expect(ys).toContain(160);
    expect(probe(g).floors[0]).toBe(1);
    // The upper floor and its platforms show once the lift passed 16.
    expect(g.world.view().features!.models.map((m) => m.key)).toContain('canalave-floor-2');
  });

  it('an x platform at B walks the player WALK_FASTER back to A, two ticks a tile', () => {
    const g = gym(18, 17, 'left');
    g.hold(['left'], 1);
    for (let i = 0; i < 20 && (g.state.mapFeatures as { platformStates: number }).platformStates === 0b010; i++) g.tick();
    expect(g.state.mapFeatures).toEqual({ kind: 'canalave-gym', platformStates: 0b000 });
    let ticks = 0;
    while (!g.world.idle() && ticks < 100) {
      g.tick();
      ticks++;
    }
    expect(g.state.player).toMatchObject({ x: 13, z: 17 });
    expect(probe(g).positions[1]).toEqual([13, 0, 17]);
    // Four tiles at 2 ticks each, plus the task's waits.
    expect(ticks).toBeGreaterThanOrEqual(8);
    expect(ticks).toBeLessThan(16);
    // A step off and back on rides it again (one ride per completed step onto it).
    g.hold(['left'], 1);
    g.settle();
    expect(g.state.player).toMatchObject({ x: 12, z: 17 });
    g.hold(['right'], 6);
    g.settle();
    // The completed step is processed on the next tick's triggers (Field_ProcessStep).
    g.tick();
    g.settle();
    expect(g.state.player).toMatchObject({ x: 17, z: 17 });
    expect(g.state.mapFeatures).toEqual({ kind: 'canalave-gym', platformStates: 0b010 });
  });
});

it('Canalave vertical lift starts its motor at task state zero, stops at endpoint, clunks one tick later', () => {
  const g = gym(14, 15, 'right');
  const sounds = audioTrace(g.audio, withFieldSounds(registries), () => g.state.tick);
  g.tick(['right']);
  g.hold([], 80);
  const start = sounds[0]!.tick;
  expect(sounds.map(({ tick, op, source }) => [tick - start, op, source])).toEqual([[0, 'start', 1553], [20, 'stop', 1553], [21, 'start', 1562]]);
});
