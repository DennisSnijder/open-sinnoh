import { expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { WEATHER_LOAD_TICKS } from '@opensinnoh/contracts';
import { WeatherFades, fogFadeDensities } from './weather.ts';

const densities = Array.from({ length: 32 }, (_, i) => i * 4);
const drawn = { sprites: { image: 'test:weather/sprites.png' as Id, cells: [], frames: [] }, spawner: { load: [4, 0] as [number, number], steady: [4, 0] as [number, number], prewarm: [20, 10, 1] as [number, number, number] } };

it('fades weather across a zone connection as the DS does, and shows it at full on a map load', () => {
  const fog = { slope: 3, offset: 0x6f6f + 0x300, color: [26 / 31, 26 / 31, 26 / 31] as [number, number, number], alpha: 31, densities };
  const clear = { id: 'test:clear' as Id, name: 'CLEAR' };
  const rain = { id: 'test:rain' as Id, name: 'RAINING', particles: { kind: 'rain' as const, count: 16, ...drawn }, fog, fade: { particles: { in: [0.25, 0.5, 1], out: [0.5, 0] }, fog: { in: 1, out: 1 } } };
  const f = new WeatherFades();
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) f.step(() => true);
  };
  f.set(clear, true);
  expect(f.fog()).toBeNull();
  // Route 210 South → Route 215: the clear weather ends, the rain loads, then its drops and fog fade in.
  f.set(rain, false);
  ticks(1);
  expect(f.shown).toEqual([]);
  ticks(WEATHER_LOAD_TICKS - 1);
  expect(f.shown.map((s) => [s.weather.id, s.phase])).toEqual([['test:rain', 'in']]);
  expect(WeatherFades.level(f.shown[0]!)).toBe(0.25);
  expect(f.fog()!.densities.every((d) => d === 0)).toBe(true);
  ticks(64);
  const half = f.fog()!.densities;
  expect(half[31]).toBeGreaterThan(0);
  expect(half[31]).toBeLessThan(124);
  expect(WeatherFades.level(f.shown[0]!)).toBe(1);
  ticks(63);
  expect(f.shown[0]!.phase).toBe('steady');
  expect(f.fog()).toBe(fog);
  // And back: the drops stop, the fog thins over 127 ticks; the weather goes once the last drop has left.
  f.set(clear, false);
  f.step(() => false);
  expect(WeatherFades.level(f.shown[0]!)).toBe(0);
  expect(f.fog()!.densities[31]).toBe(124);
  for (let i = 0; i < 126 + 5; i++) f.step(() => false);
  expect(f.fog()).toBeNull();
  expect(f.shown.map((s) => s.weather.id)).toEqual(['test:rain']);
  f.step(() => true);
  expect(f.shown).toEqual([]);
  ticks(WEATHER_LOAD_TICKS);
  expect(f.shown.map((s) => [s.weather.id, s.phase])).toEqual([['test:clear', 'steady']]);
  // A map load shows the new weather at full at once.
  f.set(rain, true);
  expect(f.shown.map((s) => s.phase)).toEqual(['steady']);
  expect(f.fog()).toBe(fog);
});

it('steps the fog density table as ov5_021D7534 does', () => {
  // Fading in, step 127 is the full table; fading out, the entries it passes keep 4.
  expect(fogFadeDensities('in', 127)).toEqual(densities);
  expect(fogFadeDensities('in', 1)).toEqual(new Array(32).fill(0));
  expect(fogFadeDensities('out', 0)).toEqual(densities);
  expect(fogFadeDensities('out', 127)).toEqual([0, ...new Array(31).fill(4)]);
});

it('fades overlapping weathers into each other (the snows), the fog parameters moving between them', () => {
  const fogOf = (offset: number) => ({ slope: 3, offset, color: [24 / 31, 24 / 31, 24 / 31] as [number, number, number], alpha: 31, densities });
  const snow = { id: 'test:snow' as Id, name: 'SNOWING', particles: { kind: 'snow' as const, count: 16, ...drawn }, fog: fogOf(0x6f6f + 0x300), fade: { particles: { in: [0.5, 1], out: [0.5, 0] }, fog: { in: 1, out: 2 }, overlaps: ['test:heavy' as Id] } };
  const heavy = { id: 'test:heavy' as Id, name: 'HEAVY_SNOW', particles: { kind: 'heavy-snow' as const, count: 48, ...drawn }, fog: fogOf(0x6f6f - 0x200), fade: { particles: { in: [0.5, 1], out: [0.5, 0] }, fog: { in: 2, out: 1 }, overlaps: ['test:snow' as Id] } };
  const f = new WeatherFades();
  f.set(snow, true);
  f.set(heavy, false);
  expect(f.shown.map((s) => [s.weather.id, s.phase])).toEqual([['test:snow', 'out'], ['test:heavy', 'in']]);
  for (let i = 0; i < 127; i++) f.step(() => true);
  const mid = f.fog()!;
  expect(mid.offset).toBeLessThan(0x6f6f + 0x300);
  expect(mid.offset).toBeGreaterThan(0x6f6f - 0x200);
  expect(f.shown.map((s) => s.weather.id)).toEqual(['test:heavy']);
  for (let i = 0; i < 127; i++) f.step(() => true);
  expect(f.shown[0]!.phase).toBe('steady');
  expect(f.fog()).toBe(heavy.fog);
});

it('fades the fog BG layer in whole sixteenths', () => {
  const fogBg = { id: 'test:fog' as Id, name: 'FOG', layer: { image: 'test:bg.png' as Id, scroll: [0, 0] as [number, number], alpha: 9 / 16 }, fade: { layer: { in: 30, out: 30 } } };
  const s = { weather: fogBg, phase: 'in' as const, t: 0 };
  expect([0, 4, 15, 30, 40].map((t) => Math.round(WeatherFades.layerLevel({ ...s, t }) * 9))).toEqual([0, 1, 4, 9, 9]);
  expect([0, 30].map((t) => Math.round(WeatherFades.layerLevel({ ...s, phase: 'out', t }) * 9))).toEqual([9, 0]);
});
