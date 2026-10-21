import { describe, expect, it } from 'vitest';
import { f, newState, registries, setup, type Harness } from './testing.ts';

/** ROUTE_E NPCs: 5 wanders (3) at 40,24 range 2; 6 looks around (2) at 36,24; 7 walks back and forth (20) at 60,4 range z 3. */
const route = (regs = registries) => setup(newState('ROUTE_E', 34, 16), { regs });
const obj = (g: Harness, id: number) => g.state.objects.find((o) => o.localId === id)!;

describe('movement types (decomp src/unk_0206450C.c)', () => {
  it('wander 3 stays within its range around the origin, on its own PRNG stream, and keeps the world idle', () => {
    const g = route();
    const rng = { ...g.state.rng };
    const seen = new Set<string>();
    const facings = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      g.tick();
      expect(g.world.idle()).toBe(true);
      const o = obj(g, 5);
      expect(Math.abs(o.x - 40)).toBeLessThanOrEqual(2);
      expect(Math.abs(o.z - 24)).toBeLessThanOrEqual(2);
      seen.add(`${o.x},${o.z}`);
      facings.add(o.facing);
    }
    expect(seen.size).toBeGreaterThan(4);
    expect(facings.size).toBe(4);
    expect(obj(g, 5).wander).toMatchObject({ originX: 40, originZ: 24 });
    // The game's own stream is untouched.
    expect(g.state.rng).toEqual(rng);
  });

  it('a wander step starts at least a 16-tick pause after the previous 8-tick walk', () => {
    const g = route();
    let last = obj(g, 5);
    let moved = -1;
    const gaps: number[] = [];
    for (let i = 0; i < 2000; i++) {
      g.tick();
      const o = obj(g, 5);
      if (o.x !== last.x || o.z !== last.z) {
        if (moved >= 0) gaps.push(i - moved);
        moved = i;
      }
      last = o;
    }
    expect(gaps.length).toBeGreaterThan(10);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(8 + 16);
  });

  it('range 0 stays on its tile but still turns', () => {
    const regs = structuredClone(registries);
    regs.zones.get(f('ROUTE_E'))!.events.objects.find((o) => o.localId === 5)!.range = { x: 0, z: 0 };
    const g = route(regs);
    const facings = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      g.tick();
      expect(obj(g, 5)).toMatchObject({ x: 40, z: 24 });
      facings.add(obj(g, 5).facing);
    }
    expect(facings.size).toBeGreaterThan(1);
  });

  it('look around (2) turns among its directions in place', () => {
    const g = route();
    const facings = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      g.tick();
      expect(obj(g, 6)).toMatchObject({ x: 36, z: 24 });
      facings.add(obj(g, 6).facing);
    }
    expect(facings.size).toBe(4);
  });

  it('walk back and forth (20) shuttles between the origin and range tiles along its facing, with no pause', () => {
    const g = route();
    const zs: number[] = [];
    for (let i = 0; i < 8 * 10; i++) {
      zs.push(obj(g, 7).z);
      expect(obj(g, 7).x).toBe(60);
      g.tick();
    }
    // The logical tile changes when a step starts; one step every 8 ticks.
    const steps = zs.filter((_, i) => i % 8 === 0);
    expect(Math.min(...steps)).toBe(4);
    expect(Math.max(...steps)).toBe(7);
    // Consecutive steps differ by one tile and reverse only at the ends.
    for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!)).toBe(1);
    for (let i = 1; i < steps.length - 1; i++) if (steps[i - 1] === steps[i + 1]) expect([4, 7]).toContain(steps[i]);
  });

  it('paused objects (lock_all) do not run their movement type', () => {
    const g = route();
    g.world.lockAll();
    g.hold([], 30);
    const before = structuredClone(g.state.objects);
    g.hold([], 500);
    expect(g.state.objects).toEqual(before);
    g.world.releaseAll();
  });

  it('a loaded save continues the object’s saved stream (same save, same future)', () => {
    const g = route();
    g.hold([], 300);
    const saved = structuredClone(g.state);
    const run = () => {
      const h = setup(structuredClone(saved), { entry: 'load' });
      h.hold([], 600);
      return JSON.stringify(h.state.objects);
    };
    expect(run()).toBe(run());
    expect(saved.objects.find((o) => o.localId === 5)!.wander!.rng).not.toEqual(route().state.objects.find((o) => o.localId === 5)!.wander!.rng);
  });
});
