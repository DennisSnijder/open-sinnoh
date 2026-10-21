import { describe, expect, it } from 'vitest';
import type { Id, SpecialEncounterState } from '@opensinnoh/core';
import { PokeRadar, type RadarHost } from './poke-radar.ts';
import { SweetScentTask } from './sweet-scent.ts';
import { HoneyTreeShakes, type HoneyTreePlacement } from './honey-trees.ts';
import { replaceLandSlots } from './encounters.ts';

const TABLES = { labels: { noCharge: 't:low' as Id, quiet: 't:quiet' as Id }, bgm: 't:SEQ' as Id, effects: { soft: 't:SOFT' as Id, hard: 't:HARD' as Id, shiny: 't:SHINY' as Id } };

/** A field of tall grass at height 0 in one zone; rolls from a script, then 0. */
function setup(o: { grass?: (x: number, z: number) => boolean; rolls?: number[] } = {}) {
  const queue = [...(o.rolls ?? [])];
  const calls: string[] = [];
  const host: RadarHost = {
    behaviour: (x, z) => ((o.grass ?? (() => true))(x, z) ? 'TALL_GRASS' : 'PLAIN'),
    tileHeight: () => 0,
    zoneAt: () => 't:ZONE' as Id,
    rand: (n) => {
      const v = queue.shift() ?? 0;
      if (v >= n) throw new Error(`roll ${v} not below ${n}`);
      return v;
    },
    effectTicks: () => 3,
    playBgm: (seq) => void calls.push(`bgm ${seq}`),
    restoreBgm: () => void calls.push('restore'),
  };
  const state: { encounters?: SpecialEncounterState } = {};
  return { radar: new PokeRadar(host, TABLES, state), state, calls, queue };
}

describe('the Poké Radar chain (pokeradar.c)', () => {
  it('charges a step at a time with the Radar owned, up to 50; a use below that reports the steps left', () => {
    const { radar, state } = setup();
    radar.chargeStep(false);
    expect(state.encounters).toBeUndefined();
    for (let i = 0; i < 60; i++) radar.chargeStep(true);
    expect(state.encounters!.radarCharge).toBe(50);
    state.encounters!.radarCharge = 20;
    expect(radar.use(10, 10, 0, 't:ZONE' as Id)).toEqual({ kind: 'low', steps: 30 });
  });

  it('draws one tile per ring on its perimeter, outer to inner (RadarSpawnPatches)', () => {
    // Ring 0 (9×9): roll 0 is its top-left corner; ring 1 (7×7): roll 7 is the bottom row's first; ring 2 (5×5): roll 10
    // is the left column below the top; ring 3 (3×3): roll 7 is the right column's middle.
    const { radar, state } = setup({ rolls: [0, 7, 10, 7] });
    state.encounters = { ...state.encounters!, radarCharge: 50 } as SpecialEncounterState;
    radar.chargeStep(true);
    expect(radar.use(100, 100, 0, 't:ZONE' as Id).kind).toBe('active');
    expect(radar.livePatches()!.patches.map((p) => [p.x, p.z])).toEqual([[96, 96], [97, 103], [98, 99], [101, 100]]);
  });

  it('clears the chain and fades the BGM back when no patch is grass', () => {
    const { radar, state, calls } = setup({ grass: () => false });
    state.encounters = { radarCharge: 50 } as SpecialEncounterState;
    expect(radar.use(100, 100, 0, 't:ZONE' as Id)).toEqual({ kind: 'quiet' });
    expect(state.encounters.radarCharge).toBe(0);
    expect(radar.isActive()).toBe(false);
    expect(calls).toEqual(['restore']);
  });

  it('starts a chain on the first patch, keeps it on a continuing one, and counts and records it', () => {
    const { radar, state, queue, calls } = setup();
    state.encounters = { radarCharge: 50, radarRecords: [{ species: null, count: 0 }, { species: null, count: 0 }, { species: null, count: 0 }] } as SpecialEncounterState;
    radar.use(100, 100, 0, 't:ZONE' as Id);
    expect(calls).toEqual(['bgm t:SEQ']);
    // The shakes play out (3 ticks each).
    expect([radar.stepEffects(), radar.stepEffects(), radar.stepEffects()]).toEqual([false, false, true]);
    const [first] = radar.livePatches()!.patches;
    const hit = radar.enter(first!.x, first!.z)!;
    expect(hit.preserve).toBe(false);
    expect(radar.drew('t:BIDOOF' as Id, 7)).toEqual({ species: 't:BIDOOF', level: 7 });
    expect(radar.chain()).toEqual({ species: 't:BIDOOF', count: 1 });
    // New patches for after the battle; a win rolls them: ring 0 continues (roll 0), no shiny (roll 1).
    queue.push(0, 0, 0, 0, 0, 1, 99, 0, 99, 0, 99, 0);
    radar.spawn(first!.x, first!.z, 0, 't:ZONE' as Id);
    expect(radar.afterBattle('won')).toBe(true);
    const next = radar.livePatches()!.patches.find((p) => p.continues)!;
    expect(radar.enter(next.x, next.z)).toEqual({ shake: 'soft', preserve: true, shiny: false });
    expect(radar.chain()).toEqual({ species: 't:BIDOOF', count: 2 });
    expect(radar.mon()).toEqual({ species: 't:BIDOOF', level: 7 });
    expect(state.encounters.radarRecords[0]).toEqual({ species: 't:BIDOOF', count: 2 });
  });

  it('breaks on another species, a battle neither won nor caught, a battle not from a patch, and patches out of view', () => {
    const make = () => {
      const s = setup();
      s.state.encounters = { radarCharge: 50, radarRecords: [{ species: null, count: 0 }, { species: null, count: 0 }, { species: null, count: 0 }] } as SpecialEncounterState;
      s.radar.use(100, 100, 0, 't:ZONE' as Id);
      const p = s.radar.livePatches()!.patches[0]!;
      s.radar.enter(p.x, p.z);
      s.radar.drew('t:A' as Id, 5);
      return s;
    };
    const species = make();
    species.radar.drew('t:B' as Id, 9);
    expect(species.radar.chain()).toBeNull();
    const fled = make();
    expect(fled.radar.afterBattle('fled')).toBe(false);
    expect(fled.radar.isActive()).toBe(false);
    const other = setup();
    other.state.encounters = { radarCharge: 50 } as SpecialEncounterState;
    other.radar.use(100, 100, 0, 't:ZONE' as Id);
    expect(other.radar.afterBattle('won')).toBe(false);
    const view = make();
    view.radar.dropUnseen(() => false);
    expect(view.radar.isActive()).toBe(false);
    expect(view.calls.at(-1)).toBe('restore');
  });
});

describe('Sweet Scent (ov5_021F007C.c)', () => {
  const run = (o: { blocked?: boolean; zone?: boolean; rate?: boolean }) => {
    const task = new SweetScentTask({ cutIn: null, blocked: () => !!o.blocked, zoneEncounters: () => o.zone ?? true, tileRate: () => o.rate ?? true, playSe: () => {} });
    const alphas: number[] = [];
    for (let tick = 1; tick < 500; tick++) {
      const end = task.step();
      alphas.push(task.alpha());
      if (end) return { end, tick, alphas };
    }
    throw new Error('Sweet Scent never ended');
  };
  it('blends the pink to 10/16 over 20 frames, holds 23, then the encounter', () => {
    const r = run({});
    expect(r.end).toBe('encounter');
    expect(Math.max(...r.alphas)).toBe(10 / 16);
    expect(r.tick).toBe(1 + 20 + 23);
  });
  it('fades out and reports the faded scent off an encounter tile, at once in a zone without encounters', () => {
    expect(run({ rate: false })).toMatchObject({ end: 'faded', tick: 1 + 20 + 23 + 16 });
    expect(run({ zone: false })).toMatchObject({ end: 'faded', tick: 1 + 20 + 1 + 16 });
  });
  it('does nothing in blocking weather (20 frames, no pink)', () => {
    const r = run({ blocked: true });
    expect(r).toMatchObject({ end: 'nothing', tick: 22 });
    expect(Math.max(...r.alphas)).toBe(0);
  });
});

describe('honey trees in the field', () => {
  const placement = (key: string, cell: number, tree: number | null): HoneyTreePlacement => ({ key, cell, tree, tileX: 0, tileZ: 0, position: [0, 0, 0], rotation: [0, 0, 0] });
  it('shake when their chunk loads with a Pokémon waiting, stop on StopShaking and when the chunk unloads', () => {
    const shakes = new HoneyTreeShakes([placement('a', 0, 0), placement('b', 3, 1)], 3);
    const encounters = { honeyTrees: [{ minutes: 1000, slot: 0, table: 0, group: 1, shakes: 3 }, { minutes: 1000, slot: 0, table: 0, group: 1, shakes: 0 }] } as SpecialEncounterState;
    shakes.load(0, 0, { encounters }, 10);
    expect(shakes.shakingTrees()).toEqual([0]);
    expect(shakes.view('t:prop' as Id, () => 25, 40).find((v) => v.key === 'a')!.clip).toEqual({ name: 'shake-2', tick: 5 });
    shakes.stop(0);
    expect(shakes.shakingTrees()).toEqual([]);
    // Loaded again only after leaving: chunk 0 stays loaded from (40, 0), so nothing re-evaluates.
    shakes.load(40, 0, { encounters }, 20);
    expect(shakes.shakingTrees()).toEqual([]);
    shakes.load(200, 200, { encounters }, 30);
    shakes.load(0, 0, { encounters }, 40);
    expect(shakes.shakingTrees()).toEqual([0]);
  });
});

describe('replaced land slots', () => {
  it('puts the swarm in 0–1, the garden in 6–7 and the Radar species in 4, 5, 10, 11', () => {
    const slot = (species: string) => ({ species: species as Id, minLevel: 3, maxLevel: 3 });
    const table = {
      id: 't:E' as Id, landRate: 10, land: Array.from({ length: 12 }, (_, i) => slot(`t:L${i}`)), surfRate: 0, surf: [],
      oldRod: { rate: 0, slots: [] }, goodRod: { rate: 0, slots: [] }, superRod: { rate: 0, slots: [] },
      variants: { swarm: [{ slot: 0, species: 't:S' as Id }, { slot: 1, species: 't:S' as Id }], radar: [4, 5, 10, 11].map((s) => ({ slot: s, species: `t:R${s}` as Id })) },
    };
    expect(replaceLandSlots(table, { swarm: false, trophy: null, radar: false })).toBe(table);
    const out = replaceLandSlots(table, { swarm: true, trophy: ['t:G' as Id, null], radar: true });
    expect(out.land.map((s) => s.species)).toEqual(['t:S', 't:S', 't:L2', 't:L3', 't:R4', 't:R5', 't:G', 't:L7', 't:L8', 't:L9', 't:R10', 't:R11']);
  });
});
