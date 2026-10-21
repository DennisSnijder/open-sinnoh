import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { f, newState, registries, setup } from './testing.ts';
import { yearlyDayIndex } from './weather.ts';

const W = (name: string) => f(`OVERWORLD_WEATHER_${name}`);

/** Fixture registries with zone weathers replaced. */
function weathers(set: Record<string, string>): Registries {
  const regs = structuredClone(registries);
  for (const [zone, weather] of Object.entries(set)) regs.zones.get(f(zone))!.weather = W(weather) as Id;
  return regs;
}

describe('yearly day index (decomp FieldSystem_GetWeather, DayNumberForDate)', () => {
  it('indexes a 366-day year: Feb 29 is day 59, and other years skip it', () => {
    expect(yearlyDayIndex('2009-01-01')).toBe(0);
    expect(yearlyDayIndex('2009-02-28')).toBe(58);
    expect(yearlyDayIndex('2008-02-29')).toBe(59);
    expect(yearlyDayIndex('2009-03-01')).toBe(60);
    expect(yearlyDayIndex('2008-03-01')).toBe(60);
    expect(yearlyDayIndex('2009-12-31')).toBe(365);
    expect(yearlyDayIndex('2008-12-31')).toBe(365);
  });
});

describe('weather on map change (decomp FieldMapChange_UpdateGameData)', () => {
  it('a warp sets the zone header weather; a yearly weather takes the day of the frozen date', () => {
    const regs = weathers({ TOWN: 'SNOWPOINT_CITY' });
    const day = (date: string) => {
      const g = setup(newState('ROOM'), { regs, date });
      g.world.warp(f('TOWN'), 12, 16, 'down');
      g.settle();
      return g.state.weather;
    };
    expect(day('2009-02-28')).toBe(W('SNOWING'));
    expect(day('2008-02-29')).toBe(W('RAINING'));
    expect(day('2009-03-22')).toBe(W('CLEAR'));
    // The clock-change penalty reads January 2 (FieldSystem_HasPenalty), whatever the date.
    const state = newState('ROOM');
    state.gameTime.penaltyMinutes = 30;
    const g = setup(state, { regs, date: '2009-03-22' });
    g.world.warp(f('TOWN'), 12, 16, 'down');
    g.settle();
    expect(g.state.weather).toBe(W('SNOWING'));
  });

  it('a new game resolves the yearly weather of its zone from the date', () => {
    const regs = weathers({ ROOM: 'SNOWPOINT_CITY' });
    expect(setup(newState('ROOM'), { regs, date: '2009-01-05' }).state.weather).toBe(W('SNOWING'));
  });

  it('crossing into another zone of the matrix sets its weather', () => {
    const g = setup(newState('ROUTE_W', 30, 16, 'right'), { regs: weathers({ ROUTE_W: 'FOG', ROUTE_E: 'RAINING' }) });
    expect(g.state.weather).toBe(W('FOG'));
    g.hold(['right'], 8);
    expect(g.state.player).toMatchObject({ zone: f('ROUTE_W'), x: 31 });
    g.hold(['right'], 1);
    expect(g.state.player.zone).toBe(f('ROUTE_E'));
    expect(g.state.weather).toBe(W('RAINING'));
  });

  it('FOG under Defog and DARK_FLASH under Flash become CLEAR; the flags do not change other weathers', () => {
    const regs = weathers({ ROUTE_W: 'FOG', ROUTE_E: 'DARK_FLASH', TOWN: 'RAINING' });
    const enter = (zone: string, flag: string | null) => {
      const s = newState(zone, zone === 'TOWN' ? 12 : 40, 16);
      if (flag) s.flags[f(flag)] = true;
      return setup(s, { regs }).state.weather;
    };
    expect(enter('ROUTE_W', null)).toBe(W('FOG'));
    expect(enter('ROUTE_W', 'FLAG_DEFOG_ACTIVE')).toBe(W('CLEAR'));
    expect(enter('ROUTE_W', 'FLAG_FLASH_ACTIVE')).toBe(W('FOG'));
    expect(enter('ROUTE_E', 'FLAG_FLASH_ACTIVE')).toBe(W('CLEAR'));
    expect(enter('TOWN', 'FLAG_DEFOG_ACTIVE')).toBe(W('RAINING'));
  });

  it('a loaded save keeps its weather (setWeather CLEAR survives); only a yearly value is resolved', () => {
    const regs = weathers({ TOWN: 'RAINING' });
    const g = setup(newState('TOWN', 12, 16), { regs });
    g.world.setWeather(W('CLEAR'));
    const saved = structuredClone(g.state);
    expect(saved.objects.length).toBeGreaterThan(0);
    expect(setup(saved, { regs, entry: 'load' }).state.weather).toBe(W('CLEAR'));
    const v3 = structuredClone(saved);
    v3.weather = W('SNOWPOINT_CITY') as Id;
    expect(setup(v3, { regs, date: '2009-01-05', entry: 'load' }).state.weather).toBe(W('SNOWING'));
  });
});
