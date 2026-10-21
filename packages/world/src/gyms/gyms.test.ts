import { audioTrace, withFieldSounds } from '../../../../tests/fixtures/audio.ts';
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { GymTables, NewGame, Registries, Var, Zone } from '@opensinnoh/contracts';
import { f, newState, registries, setup, type Harness } from '../testing.ts';
import { EternaGym } from './eterna.ts';
import { cutBeam } from './hearthome.ts';
import { VeilstoneGym } from './veilstone.ts';

/**
 * The gym features on original synthetic tables (not the ROM's): the fixture ROOM (walkable x 11–20,
 * z 12–19; the helper at 18,14; a warp at 15,20) stands in for each gym.
 */
const CLOCK_VAR = f('VAR_TEST_GYM_CLOCK');
const zeros = (n: number) => Array.from({ length: n }, () => 0);

function clockMask(blocked: [number, number][]): number[] {
  const m = zeros(169);
  for (const [x, z] of blocked) m[(z - 7) * 13 + (x - 5)] = 1;
  return m;
}

const TABLES: GymTables = {
  eterna: {
    zone: f('ROOM'),
    clockVar: CLOCK_VAR,
    message: f('Text_HelperHello'),
    // Short turns: 3:00 → 3:20 is 10 updates, 3:20 → 4:00 20, 4:00 → 4:10 5; the leader's 4:10 → 4:06 goes round.
    times: [
      { hour: 3, minute: 0 },
      { hour: 3, minute: 20 },
      { hour: 4, minute: 0 },
      { hour: 4, minute: 10 },
      { hour: 4, minute: 6 },
    ],
    jumps: [null, { x: 15, z: 15, northSouth: true }, null, null, null],
    clock: [clockMask([[14, 13]]), clockMask([]), clockMask([]), clockMask([]), clockMask([])],
    fountains: [zeros(21).map((_, i) => (i === 15 ? 1 : 0)), zeros(21), zeros(21), zeros(21), zeros(21)],
    hourRotations: Array.from({ length: 12 }, (_, i) => i * 0x1000),
    hands: null,
    fountain: null,
  },
  veilstone: {
    zone: f('ROOM'),
    // Objects at z − 2: a bag at 13,17 and stacks at 17,17 and 13,13.
    bags: [{ x: 13, z: 19 }],
    stacks: [
      { x: 17, z: 19 },
      { x: 13, z: 15 },
    ],
    track: zeros(32 * 32).map((_, i) => {
      const x = i % 32;
      const z = Math.floor(i / 32);
      if (x < 11 || x > 20 || z < 12 || z > 19) return 1;
      if (x === 19 && z === 16) return 4;
      return 0;
    }),
    cameraDistance: { up: 3, down: 4, left: 4, right: 4 },
    effects: null,
  },
  hearthome: {
    rooms: [
      {
        zone: f('ROOM'),
        firstDoor: 3,
        doorCount: 2,
        offsetX: 11,
        offsetZ: 13,
        width: 8,
        depth: 2,
        clueMask: zeros(16).map((_, i) => (i === 3 || i === 15 ? 0 : 1)),
        doors: [
          { door: 3, x: 15, z: 20 },
          { door: 4, x: 12, z: 12 },
        ],
      },
    ],
    entrance: f('TOWN'),
    relicBadge: f('BADGE_TEST'),
    playerSprite: { male: f('SPRITE_HELPER'), female: f('SPRITE_HELPER') },
    effects: null,
    // Facing d, length n: scale [d + 1, n, 1], offset [10 n, −1, d]; rotation [90 d, 0, 0].
    light: {
      rotations: [0, 1, 2, 3].map((d) => [90 * d, 0, 0]),
      scales: [0, 1, 2, 3].map((d) => zeros(6).map((_, n) => [d + 1, n, 1])),
      offsets: [0, 1, 2, 3].map((d) => zeros(6).map((_, n) => [10 * n, -1, d])),
    },
  },
  pastoria: { buttons: { blue: f('PROP_BLUE'), green: f('PROP_GREEN'), orange: f('PROP_ORANGE') }, water: f('PROP_WATER') },
  canalave: { platforms: [], startInB: [], collision: [], floors: [f('PROP_TABLE'), f('PROP_TABLE'), f('PROP_TABLE')] },
};

/** The fixture with gym tables and a ROOM whose onTransition selects `kind` (the fake runner does it below). */
function gymRegistries(tables: GymTables = TABLES): Registries {
  const regs = { ...registries } as Registries;
  const ng = [...registries.newGame.values()][0]!;
  regs.newGame = new Map([[ng.id, { ...ng, gyms: tables } as NewGame]]);
  regs.vars = new Map([...registries.vars, [CLOCK_VAR, { id: CLOCK_VAR, initial: 0, scope: 'saved' } as Var]]);
  const room = registries.zones.get(f('ROOM'))!;
  const zone: Zone = structuredClone(room);
  zone.mapScripts.onTransition = f('Gym_Init');
  zone.events.warps.push({ x: 12, z: 12, toZone: f('TOWN'), toWarp: 0 });
  regs.zones = new Map([...registries.zones, [zone.id, zone]]);
  return regs;
}

function gym(kind: 'eterna-gym' | 'hearthome-gym' | 'veilstone-gym', x = 14, z = 16, prepare: (s: ReturnType<typeof newState>) => void = () => {}): Harness {
  const state = newState('ROOM', x, z, 'up');
  prepare(state);
  const regs = withFieldSounds(gymRegistries());
  const g = setup(state, { regs });
  // The fake runner does not run onTransition: select the slot as init_persisted_map_features_for_<kind> does,
  // then load the map again as a loaded save would (the feature builds from the slot).
  g.world.initMapFeatures(kind);
  g.world.enter('load');
  g.settle();
  return g;
}

const feature = <T>(g: Harness, type: new (...a: never[]) => T): T => {
  const ft = (g.world as unknown as { feature: unknown }).feature;
  if (!(ft instanceof type)) throw new Error('wrong feature');
  return ft;
};

describe('Eterna Gym clock (decomp gym_features.c EternaGym_*)', () => {
  it('builds from the saved var, not the cleared slot, and collides by the state masks (the player only)', () => {
    const g = gym('eterna-gym', 14, 14, (s) => void (s.vars[CLOCK_VAR] = 0));
    expect(g.state.mapFeatures).toEqual({ kind: 'eterna-gym', clock: 0 });
    // 14,13 is masked: walking up bumps.
    g.hold(['up'], 20);
    g.settle();
    expect(g.state.player).toMatchObject({ x: 14, z: 14 });
    // The fountain row (z 19): x 16 is blocked in state 0.
    const w = g.world as unknown as { feature: EternaGym };
    expect(w.feature.blocks!(16, 19)).toBe(true);
    expect(w.feature.blocks!(15, 19)).toBe(false);
  });

  it('advance: slot and var at once, camera to the centre and back, two minutes a tick; the jump tile of the new state', () => {
    const g = gym('eterna-gym', 15, 18);
    expect(g.world.advanceEternaGymClock()).toBe(true);
    expect(g.state.mapFeatures).toEqual({ kind: 'eterna-gym', clock: 1 });
    expect(g.state.vars[CLOCK_VAR]).toBe(1);
    const clock = feature(g, EternaGym);
    let ticks = 0;
    let turning = 0;
    let last = clock.hands().minute;
    while (g.world.eternaGymClock() !== 'done') {
      g.tick();
      ticks++;
      if (clock.hands().minute !== last) turning++;
      last = clock.hands().minute;
      if (g.world.eternaGymClock() !== 'done') expect(g.world.idle()).toBe(false);
      if (ticks > 1000) throw new Error('the clock task never ended');
    }
    expect(turning).toBe(10);
    expect(clock.hands()).toMatchObject({ hour: 3, minute: 20 });
    // The camera walked (4 left, 5 up, one WALK_NORMAL a tile) both ways, plus the waits and the turn.
    expect(ticks).toBe(1 + (4 + 5) * 8 + 8 + 10 + 8 + (4 + 5) * 8 + 1);
    const v = g.world.view();
    expect(v.camera.cur).toEqual(v.actors[0]!.cur);
    // State 1's hour-hand jump: walking north into 15,15 from 15,16 jumps to 15,14.
    g.world.setPositionLive(0xff, 15, 16, 'up');
    g.hold(['up'], 1);
    g.settle();
    expect(g.state.player).toMatchObject({ x: 15, z: 14 });
  });

  it('after trainers two and three the task waits on its message until the script continues it; the leader advance ends it', () => {
    const g = gym('eterna-gym', 15, 18, (s) => void (s.vars[CLOCK_VAR] = 1));
    g.world.advanceEternaGymClock();
    let ticks = 0;
    while (g.world.eternaGymClock() === 'running' && ticks++ < 1000) g.tick();
    expect(g.world.eternaGymClock()).toBe('message');
    for (let i = 0; i < 100; i++) g.tick();
    expect(g.world.eternaGymClock()).toBe('message');
    g.world.eternaGymClockContinue();
    while (g.world.eternaGymClock() !== 'done' && ticks++ < 2000) g.tick();
    expect(g.world.eternaGymClock()).toBe('done');
    g.world.advanceEternaGymClock();
    while (g.world.eternaGymClock() !== 'done' && ticks++ < 3000) {
      g.tick();
      if (g.world.eternaGymClock() === 'message') g.world.eternaGymClockContinue();
    }
    // The leader's turn: the hour stays on its hour while the minute hand goes round to the destination.
    expect(g.world.advanceEternaGymClock()).toBe(true);
    const clock = feature(g, EternaGym);
    while (g.world.eternaGymClock() !== 'done' && ticks++ < 5000) {
      g.tick();
      expect(clock.hands().hour).toBe(4);
    }
    expect(clock.hands()).toMatchObject({ hour: 4, minute: 6 });
    expect(g.world.advanceEternaGymClock()).toBe(false);
    expect(g.state.mapFeatures).toEqual({ kind: 'eterna-gym', clock: 4 });
  });
});

describe('Veilstone Gym bags (decomp gym_features.c VeilstoneGym_*)', () => {
  it('objects at z − 2 block the player; a kick slides the bag to the stop before a stack, which topples', () => {
    const g = gym('veilstone-gym', 12, 17);
    g.world.setPositionLive(0xff, 12, 17, 'right');
    const v = feature(g, VeilstoneGym);
    expect(v.objects()).toEqual({ bags: [{ x: 13, z: 17 }], stacks: [{ x: 17, z: 17 }, { x: 13, z: 13 }] });
    expect(g.state.objects.every((o) => o.localId !== 0xfd)).toBe(true);
    g.hold(['right'], 1);
    expect(g.world.idle()).toBe(false);
    let ticks = 0;
    while (!g.world.idle() && ticks++ < 500) g.tick();
    g.hold([], 1);
    expect(v.objects()).toEqual({ bags: [{ x: 16, z: 17 }], stacks: [null, { x: 13, z: 13 }] });
    expect(g.state.mapFeatures).toMatchObject({ bags: [{ x: 16, z: 17 }], stacks: [null, { x: 13, z: 13 }] });
    expect(g.state.player).toMatchObject({ x: 12, z: 17 });
  });

  it('a blocked kick swings the bag in place; a stop point under the bag allows the next kick', () => {
    const g = gym('veilstone-gym', 13, 18, (s) => void s);
    const v = feature(g, VeilstoneGym);
    // Up: the stack at 13,13 is past 13,14..16, so the bag runs to 13,14 and topples it.
    g.hold(['up'], 1);
    let ticks = 0;
    while (!g.world.idle() && ticks++ < 500) g.tick();
    expect(v.objects()).toEqual({ bags: [{ x: 13, z: 14 }], stacks: [{ x: 17, z: 17 }, null] });
    // From 13,15 north again: 13,13 is free now, 13,12 is the last track tile (row 11 is wall): it moves 2.
    g.world.setPositionLive(0xff, 13, 15, 'up');
    g.hold(['up'], 1);
    ticks = 0;
    while (!g.world.idle() && ticks++ < 500) g.tick();
    expect(v.objects().bags).toEqual([{ x: 13, z: 12 }]);
    // Again: the wall is next, the bag swings on the spot (WALK_ON_SPOT_FASTER for the player).
    g.world.setPositionLive(0xff, 13, 13, 'up');
    g.hold(['up'], 1);
    ticks = 0;
    while (!g.world.idle() && ticks++ < 500) g.tick();
    expect(ticks).toBeLessThan(60);
    expect(v.objects().bags).toEqual([{ x: 13, z: 12 }]);
  });

  it('a save at rest keeps the objects; a new map load from the transition sets the puzzle up again', () => {
    const g = gym('veilstone-gym', 12, 17);
    g.world.setPositionLive(0xff, 12, 17, 'right');
    g.hold(['right'], 1);
    let ticks = 0;
    while (!g.world.idle() && ticks++ < 500) g.tick();
    g.hold([], 1);
    const saved = structuredClone(g.state);
    const h = setup(saved, { regs: gymRegistries(), entry: 'load' });
    expect(feature(h, VeilstoneGym).objects()).toEqual({ bags: [{ x: 16, z: 17 }], stacks: [null, { x: 13, z: 13 }] });
    h.world.initMapFeatures('veilstone-gym');
    h.world.enter('load');
    h.settle();
    expect(feature(h, VeilstoneGym).objects()).toEqual({ bags: [{ x: 13, z: 17 }], stacks: [{ x: 17, z: 17 }, { x: 13, z: 13 }] });
  });
});

describe('Hearthome Gym rooms (decomp gym_features.c HearthomeGym_*)', () => {
  it('draws the door and a clue outside objects, rewrites the wrong door to the entrance and keeps the draw on reload', () => {
    const g = gym('hearthome-gym', 14, 16);
    const slot = g.state.mapFeatures;
    expect(slot).toMatchObject({ kind: 'hearthome-gym', initialized: true, clueX: 14, clueZ: 13 });
    const correct = (slot as { correctDoor: number }).correctDoor;
    expect([3, 4]).toContain(correct);
    const warps = (g.world as unknown as { events: { warps: { x: number; z: number; toZone: Id; toWarp: number }[] } }).events.warps;
    const wrong = correct === 3 ? { x: 12, z: 12 } : { x: 15, z: 20 };
    expect(warps.find((w) => w.x === wrong.x && w.z === wrong.z)).toMatchObject({ toZone: f('TOWN'), toWarp: 1 });
    expect(g.world.view().features?.fog?.densities[0]).toBe(109);
    const rng = { ...g.state.rng };
    const h = setup(structuredClone(g.state), { regs: gymRegistries(), entry: 'load' });
    expect(h.state.mapFeatures).toEqual(slot);
    expect(h.state.rng).toEqual(rng);
  });

  it('an unbeaten trainer up to two tiles in front of the player starts its approach, whatever its own facing; after it, it wanders 2×2', () => {
    // ROUTE_E's camper (local 3, 56,20) looks west; the player east of it faces it.
    const spotted = (x: number) => {
      const state = newState('ROUTE_E', x, 20, 'left');
      const g = setup(state, { regs: gymRegistries() });
      g.world.initMapFeatures('hearthome-gym');
      g.world.enter('load');
      g.settle();
      g.scripts.hold = true;
      g.tick();
      return g;
    };
    expect(spotted(59).scripts.starts).toEqual([]);
    const g = spotted(58);
    expect(g.scripts.starts).toEqual([{ label: f('Battles_ApproachingTrainer'), zone: f('ROUTE_E'), source: 'trainer', trainer: { localIds: [3], trainers: [f('TRAINER_CAMPER')], sightType: 0 } }]);
    g.world.trainerApproach(3);
    let ticks = 0;
    while (!g.world.trainerApproachDone() && ticks++ < 500) g.tick();
    expect(g.state.objects.find((o) => o.localId === 3)).toMatchObject({ x: 57, z: 20, movementType: 3, wander: { originX: 57, originZ: 20 } });
  });

  it('light beams (ov5_021F47B0.c): the player reaches 2 tiles; a wall or an object cuts the beam to the length where it hits', () => {
    const beam = (x: number, z: number) => {
      const state = newState('ROOM', x, z, 'up');
      const g = setup(state, { regs: gymRegistries({ ...TABLES, hearthome: { ...TABLES.hearthome, effects: { symbols: [], light: f('MODEL_LIGHT') } } }) });
      g.world.initMapFeatures('hearthome-gym');
      g.world.enter('load');
      g.settle();
      return g.world.view().features!.models.find((m) => m.key === 'hearthome-light-255')!;
    };
    // Full reach: length 2; drawn 16 units above the player's position plus the offset.
    const free = beam(14, 16);
    expect(free).toMatchObject({ model: f('MODEL_LIGHT'), rotation: [0, 0, 0], scale: [1, 2, 1], light: true });
    expect(free.position).toEqual([14 * 16 + 8 + 20, 16 - 1, 16 * 16 + 8]);
    // The helper two tiles ahead (18,14): cut to length 1. The room's north wall right ahead: length 0.
    expect(beam(18, 16).scale).toEqual([1, 1, 1]);
    // (Not at 14,13: the clue's only free tile there.)
    expect(beam(15, 13).scale).toEqual([1, 1, 1]);
    expect(beam(15, 12).scale).toEqual([1, 0, 1]);
  });

  it('a beam cut between tiles takes tenths of the step between two lengths, truncated in fx32 (ov5_021F4B6C)', () => {
    // Facing up, an object 1.5 tiles ahead: lengths 0 and 1, 5 tenths: y = trunc(4096 / 10) × 5 / 4096.
    const [scale, offset] = cutBeam(TABLES.hearthome.light, 0, 2, [24, 0, 40], [24, 0, 16]);
    expect(scale).toEqual([1, (409 * 5) / 4096, 1]);
    expect(offset).toEqual([5, -1, 0]);
  });

  it('lighter fog after the Relic Badge', () => {
    const g = gym('hearthome-gym', 14, 16, (s) => void s.badges.push(f('BADGE_TEST')));
    expect(g.world.view().features?.fog?.densities[0]).toBe(91);
  });
});


describe('gym sound callback boundaries', () => {
  it('Eterna starts at delay callback eight, chimes on the final rotation update, drains for exactly 60 ticks', () => {
    const g = gym('eterna-gym', 14, 16);
    const sounds = audioTrace(g.audio, withFieldSounds(gymRegistries()), () => g.state.tick);
    const start = g.state.tick;
    g.world.advanceEternaGymClock();
    while (g.world.eternaGymClock() !== 'done') g.tick();
    const turn = sounds.find((s) => s.op === 'start' && s.source === 1355)!;
    expect(turn.tick - start).toBe(56); // Six 8-update camera steps, then state 2's eighth callback.
    expect(sounds.map(({ tick, op, source }) => [tick - turn.tick, op, source])).toEqual([[0, 'start', 1355], [9, 'stop', 1355], [9, 'start', 1507]]);
    sounds.length = 0;
    g.world.advanceEternaGymClock();
    for (let i = 0; g.world.eternaGymClock() === 'running' && i < 1000; i++) g.tick();
    const drain = sounds.filter((s) => s.source === 1593);
    expect(drain.map(({ tick, op }) => [tick - drain[0]!.tick, op])).toEqual([[0, 'start'], [60, 'stop']]);
    const count = sounds.length;
    g.hold([], 40); // Waiting on text must not restart/extend the draining loop.
    expect(sounds).toHaveLength(count);
  });

  it('Veilstone motor starts kick+29; impact stops it and issues both cues in order; tires topple impact+4', () => {
    const g = gym('veilstone-gym', 12, 17);
    const sounds = audioTrace(g.audio, withFieldSounds(gymRegistries()), () => g.state.tick);
    g.world.setPositionLive(0xff, 12, 17, 'right');
    g.tick(['right']);
    for (let i = 0; !g.world.idle() && i < 500; i++) g.tick();
    const kick = sounds.find((s) => s.source === 1367)!;
    const motor = sounds.find((s) => s.op === 'start' && s.source === 1356)!;
    expect(motor.tick - kick.tick).toBe(29);
    const impact = sounds.find((s) => s.op === 'stop' && s.source === 1356)!;
    expect(sounds.filter((s) => s.tick === impact.tick).map((s) => [s.op, s.source])).toEqual([['stop', 1356], ['start', 1367], ['start', 1357]]);
    expect(sounds.find((s) => s.source === 1578)!.tick - impact.tick).toBe(4);
    sounds.length = 0;
    g.world.enter('load');
    g.settle();
    expect(sounds).toEqual([]);
  });
});
