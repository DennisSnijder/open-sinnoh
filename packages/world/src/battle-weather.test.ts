import { describe, expect, it } from 'vitest';
import { battleWeather } from './battle-setup.ts';
import { f, mon, newState, registries, setup } from './testing.ts';

describe('overworld weather handoff', () => {
  it.each([
    ['RAINING', 'rain'], ['HEAVY_RAIN', 'rain'], ['THUNDERSTORM', 'rain'],
    ['SNOWING', 'hail'], ['HEAVY_SNOW', 'hail'], ['BLIZZARD', 'hail'],
    ['SANDSTORM', 'sandstorm'], ['FOG', 'fog'], ['DEEP_FOG', 'fog'],
    ['HARSH_SUN', 'sun'], ['TRICK_ROOM', 'trickroom'],
    ['CLEAR', undefined], ['DARK_FLASH', undefined], ['HAILING', undefined],
  ])('%s dispatches to %s', (name, expected) => expect(battleWeather(name!)).toBe(expected));

  it('scripted battles use current weather, including a field Defog change', () => {
    const state = newState('ROUTE_W', 4, 6, 'right');
    state.party.push(mon('SPECIES_MOSSLET', 5));
    const g = setup(state);
    state.weather = f('OVERWORLD_WEATHER_FOG');
    g.world.startBattle({ kind: 'trainer', trainers: [], wild: [] });
    expect(g.battles.at(-1)?.weather).toBe('fog');
    state.weather = f('OVERWORLD_WEATHER_CLEAR');
    g.world.startBattle({ kind: 'trainer', trainers: [], wild: [] });
    expect(g.battles.at(-1)?.weather).toBeUndefined();
  });

  it('grass encounters carry current fog into every wild setup', () => {
    const state = newState('ROUTE_W', 4, 6, 'right');
    state.party.push(mon('SPECIES_MOSSLET', 5));
    const g = setup(state);
    state.weather = f('OVERWORLD_WEATHER_FOG');
    for (let tick = 0; tick < 3000 && !g.battles.length; tick++) g.tick([state.player.x >= 9 ? 'left' : state.player.x <= 4 ? 'right' : state.player.facing]);
    expect(g.battles.length).toBeGreaterThan(0);
    expect(g.battles[0]?.weather).toBe('fog');
    expect(registries.weathers.get(state.weather)?.name).toBe('FOG');
  });
});
