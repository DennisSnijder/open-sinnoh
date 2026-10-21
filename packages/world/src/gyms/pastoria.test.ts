import { audioTrace, withFieldSounds } from '../../../../tests/fixtures/audio.ts';
import { describe, expect, it } from 'vitest';
import type { Chunk, GymTables, Model, NewGame, Prop, Registries, TextureAnimation, TileBehavior, Zone } from '@opensinnoh/contracts';
import { f, newState, registries, setup, type Harness } from '../testing.ts';
import { PastoriaGym } from './pastoria.ts';

/**
 * Pastoria Gym on original synthetic records (not the ROM's): the fixture ROOM (flat, height 0) with the three
 * button props (a 3-frame pattern of 2 ticks each: 6 frames), an orange button placed on 15,16 and a blue one on
 * 13,16, and H/M/L ground at 12,15 / 13,15 / 14,15.
 */
const FRAMES = 6;
const BEHAVIOURS: [number, string][] = [
  [0xf0, 'PASTORIA_GYM_H_GROUND'],
  [0xf1, 'PASTORIA_GYM_M_GROUND'],
  [0xf2, 'PASTORIA_GYM_L_GROUND'],
];

function pastoriaRegistries(): Registries {
  const regs = { ...registries } as Registries;
  const ng = [...registries.newGame.values()][0]!;
  const prop = (c: string) => f(`PROP_${c}`);
  regs.newGame = new Map([[ng.id, { ...ng, gyms: { pastoria: { buttons: { blue: prop('BLUE'), green: prop('GREEN'), orange: prop('ORANGE') }, water: prop('WATER') } } as unknown as GymTables } as NewGame]]);
  const anims: TextureAnimation[] = ['BLUE', 'GREEN', 'ORANGE'].map((c) => ({ id: f(`ANIM_${c}`), kind: 'frames', texture: c, frames: [0, 1, 2].map((k) => ({ texture: `${c}~${k}`, ticks: 2 })) }));
  regs.textureAnimations = new Map([...(registries.textureAnimations ?? []), ...anims.map((a) => [a.id, a] as const)]);
  const models: Model[] = ['BLUE', 'GREEN', 'ORANGE', 'WATER'].map((c) => ({ id: f(`MODEL_${c}`), gltf: f('models/room.gltf'), ...(c === 'WATER' ? {} : { animations: [f(`ANIM_${c}`)] }) }));
  regs.models = new Map([...registries.models, ...models.map((m) => [m.id, m] as const)]);
  const props: Prop[] = ['BLUE', 'GREEN', 'ORANGE', 'WATER'].map((c) => ({ id: prop(c), model: f(`MODEL_${c}`) }));
  regs.props = new Map([...registries.props, ...props.map((p) => [p.id, p] as const)]);
  const behaviours: TileBehavior[] = BEHAVIOURS.map(([i, name]) => ({ id: f(`TILE_BEHAVIOR_${name}`), sourceIndex: i, name }) as TileBehavior);
  regs.tileBehaviors = new Map([...registries.tileBehaviors, ...behaviours.map((b) => [b.id, b] as const)]);
  const room = registries.zones.get(f('ROOM'))!;
  const zone: Zone = structuredClone(room);
  regs.zones = new Map([...registries.zones, [zone.id, zone]]);
  const chunkId = registries.matrices.get(zone.matrix)!.chunks[0]!;
  const chunk: Chunk = structuredClone(registries.chunks.get(chunkId)!);
  // Chunk-local positions (origin at the chunk centre, 256): tile 15 → −8, tile 16 → 8, tile 13 → −40.
  chunk.props.push({ prop: prop('ORANGE'), position: [-8, 0, 8], rotation: [0, 0, 0], scale: [1, 1, 1] });
  chunk.props.push({ prop: prop('BLUE'), position: [-40, 0, 8], rotation: [0, 0, 0], scale: [1, 1, 1] });
  BEHAVIOURS.forEach(([i], k) => (chunk.tiles[12 + k + 15 * 32] = i));
  regs.chunks = new Map([...registries.chunks, [chunk.id, chunk]]);
  return regs;
}

function gym(x = 15, z = 16, pressed = 1): Harness {
  const g = setup(newState('ROOM', x, z, 'up'), { regs: withFieldSounds(pastoriaRegistries()) });
  g.world.initMapFeatures('pastoria-gym');
  (g.state.mapFeatures as { pressedButton: number }).pressedButton = pressed;
  g.world.enter('load');
  g.settle();
  return g;
}

const water = (g: Harness) => ((g.world as unknown as { feature: PastoriaGym }).feature as PastoriaGym).probe();

describe('Pastoria Gym water and buttons (decomp gym_features.c PastoriaGym_*)', () => {
  it('builds from the saved button: the water, the plate and the paused button poses', () => {
    const g = gym();
    expect(g.state.mapFeatures).toEqual({ kind: 'pastoria-gym', pressedButton: 1 });
    // Orange, green, blue: green pressed (forward, on its last frame), the others up (reversed, frame 0).
    expect(water(g)).toEqual({ water: 32, plate: 32, frames: [0, FRAMES - 1, 0] });
    const v = g.world.view().features!;
    expect(v.models).toEqual([{ key: 'pastoria-water', prop: f('PROP_WATER'), position: [256, 32, 256], rotation: [0, 0, 0] }]);
    expect(v.propPoses).toEqual([
      { prop: f('PROP_ORANGE'), tick: 0 },
      { prop: f('PROP_GREEN'), tick: FRAMES - 1 },
      { prop: f('PROP_BLUE'), tick: 0 },
    ]);
  });

  it('H, M and L ground let the player in only at height 0, 32 and 64 (the player at 0)', () => {
    const g = gym();
    const ft = (g.world as unknown as { feature: PastoriaGym }).feature;
    expect([12, 13, 14].map((x) => ft.blocks(x, 15))).toEqual([false, true, true]);
    g.world.setPositionLive(0xff, 13, 16, 'up');
    g.hold(['up'], 20);
    g.settle();
    expect(g.state.player).toMatchObject({ x: 13, z: 16 });
    g.world.setPositionLive(0xff, 12, 16, 'up');
    g.hold(['up'], 1);
    g.settle();
    expect(g.state.player).toMatchObject({ x: 12, z: 15 });
  });

  it('the plate is weighed against the terrain as GetHeight does: never below it, else the nearer one', () => {
    const g = gym();
    const height = (cur: number) => (g.world as unknown as { height(wx: number, wz: number, c: number): { y: number; dynamic: boolean } }).height(200, 200, cur);
    expect(height(0)).toEqual({ y: 0, dynamic: false });
    expect(height(20)).toEqual({ y: 32, dynamic: true });
  });

  it('orange: the slot at once, the buttons play (frames − 1 ticks), the water drops a unit a tick, the plate at the end', () => {
    const g = gym();
    g.world.pressPastoriaGymButton();
    expect(g.state.mapFeatures).toEqual({ kind: 'pastoria-gym', pressedButton: 0 });
    expect(g.world.pastoriaGymButtonDone()).toBe(false);
    const trace: { water: number; plate: number }[] = [];
    while (!g.world.pastoriaGymButtonDone()) {
      expect(g.world.idle()).toBe(false);
      g.tick();
      const p = water(g);
      trace.push({ water: p.water, plate: p.plate });
      if (trace.length > 500) throw new Error('the press never ended');
    }
    // Tick 1 starts the clips; after FRAMES − 1 advances they stop, so the water moves on ticks FRAMES … FRAMES + 31.
    expect(trace.findIndex((t) => t.water !== 32)).toBe(FRAMES - 1);
    expect(trace.findIndex((t) => t.water === 0)).toBe(FRAMES - 1 + 31);
    expect(trace.findIndex((t) => t.plate === 0)).toBe(FRAMES - 1 + 32);
    expect(trace.length).toBe(FRAMES + 33);
    expect(water(g).frames).toEqual([FRAMES - 1, 0, 0]);
  });

  it('green from the low water rises one unit a tick after a direction step; no button under the player does nothing', () => {
    const g = gym(15, 16, 0);
    expect(water(g)).toMatchObject({ water: 0, plate: 0 });
    g.world.setPositionLive(0xff, 14, 17, 'up');
    g.world.pressPastoriaGymButton();
    expect(g.world.pastoriaGymButtonDone()).toBe(true);
    expect(g.state.mapFeatures).toEqual({ kind: 'pastoria-gym', pressedButton: 0 });
    // Blue on 13,16: low → high is 64 ticks of movement.
    g.world.setPositionLive(0xff, 13, 16, 'up');
    g.world.pressPastoriaGymButton();
    let ticks = 0;
    let moving = 0;
    let last = 0;
    while (!g.world.pastoriaGymButtonDone()) {
      g.tick();
      ticks++;
      if (water(g).water !== last) moving++;
      last = water(g).water;
    }
    expect(moving).toBe(64);
    expect(ticks).toBe(FRAMES + 65);
    expect(water(g)).toEqual({ water: 64, plate: 64, frames: [0, 0, FRAMES - 1] });
  });
});

it('Pastoria sounds with the button clips and stops one callback after the water endpoint', () => {
  const g = gym(); // Orange button, middle water, original six-frame button clips.
  const regs = withFieldSounds(pastoriaRegistries());
  const sounds = audioTrace(g.audio, regs, () => g.state.tick);
  const start = g.state.tick;
  g.world.pressPastoriaGymButton();
  g.hold([], 37);
  expect(water(g).water).toBe(0);
  expect(sounds.map(({ tick, op, source }) => [tick - start, op, source])).toEqual([[0, 'start', 1626]]);
  g.tick();
  expect(sounds.map(({ tick, op, source }) => [tick - start, op, source])).toEqual([[0, 'start', 1626], [37, 'stop', 1626]]);
});
