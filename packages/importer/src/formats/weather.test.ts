import { expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { spawnRamps, weatherParts } from './weather.ts';

it('ramps the rain spawner up from a drop per 8 ticks to 4 per tick, and back down to none', () => {
  // ov5_021D7658: ov5_021D7210(1, 8, 4, 0, -1, 1, 1) in, ov5_021D7238(0, 8, 1, -1) out.
  const { in: up, out: down } = spawnRamps([1, 8, 4, 0, -1, 1, 1], [0, 8, 1, -1]);
  expect(up[0]).toBe(0.071); // after the first spawn: 2 drops per 7 ticks, of 4 per tick
  expect(up.at(-1)).toBe(1);
  for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]!);
  expect(up.length).toBeGreaterThan(20);
  expect(up.length).toBeLessThan(60);
  expect(down[0]).toBeLessThan(1);
  expect(down.at(-1)).toBe(0);
  for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1]!);
});

it('gives rain and fog their fades, and the snows each other as overlaps', () => {
  const id = (v: number) => `platinum:w${v}` as Id;
  const layer = () => 'platinum:l' as Id;
  const sprites = (set: number) => ({ image: `platinum:s${set}` as Id, cells: [], frames: [] });
  const rain = weatherParts(2, { particles: 0, bg: null, task: 0x021d7658 }, [], layer, id, sprites);
  expect(rain.fade).toMatchObject({ fog: { in: 1, out: 1 } });
  expect(rain.fade!.particles!.in.at(-1)).toBe(1);
  const fog = weatherParts(14, { particles: null, bg: 4, task: 0x021daec0 }, [], layer, id, sprites);
  expect(fog.fade).toEqual({ fog: { in: 1, out: 1 }, layer: { in: 30, out: 30 } });
  const snow = weatherParts(5, { particles: 3, bg: null, task: 0x021d79f0 }, [], layer, id, sprites);
  expect(snow.fade!.overlaps).toEqual([id(6), id(7), id(21)]);
  expect(weatherParts(0, { particles: null, bg: null, task: 0x021d7604 }, [], layer, id, sprites).fade).toBeUndefined();
});

it('gives particle weathers their OAM set and spawners, and CLEAR_8 its fog BG behind the field', () => {
  const id = (v: number) => `platinum:w${v}` as Id;
  const layer = (bg: number) => `platinum:bg${bg}` as Id;
  const sprites = (set: number) => ({ image: `platinum:s${set}` as Id, cells: [], frames: [] });
  // HEAVY_SNOW: OAM set 1; map load ov5_021D7210(6, 3, …) and ov5_021D7568(20, 2, 3); the fade in ends on 6 per 3.
  const heavy = weatherParts(6, { particles: 1, bg: null, task: 0x021d7e54 }, [], layer, id, sprites);
  expect(heavy.particles).toEqual({ kind: 'heavy-snow', count: 48, sprites: sprites(1), spawner: { load: [6, 3], steady: [6, 3], prewarm: [20, 2, 3] } });
  // ov5_021D879C: BG2 at priority 3 (behind the 3D), EVA 16 over the backdrop, faded over 30 ticks.
  const clear8 = weatherParts(8, { particles: null, bg: 6, task: 0x021d879c }, [], layer, id, sprites);
  expect(clear8.layer).toEqual({ image: 'platinum:bg6', scroll: [0, 0], alpha: 1, under: true });
  expect(clear8.fade?.layer).toEqual({ in: 30, out: 30 });
  expect(clear8.pending).toBeUndefined();
});
