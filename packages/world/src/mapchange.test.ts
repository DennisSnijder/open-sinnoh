import { describe, expect, it } from 'vitest';
import { FLAG_FORCE_BIKING_IN_GATE, FLAG_ON_CYCLING_ROAD, flagId, onWarp, onZoneConnection } from './mapchange.ts';
import { newState, registries } from './testing.ts';

describe('FieldSystem_InitFlagsWarp', () => {
  it('a warp out of a gate ends its forced bike and the Cycling Road flag (Route 206 → 207: the bike could not be put away)', () => {
    const state = newState();
    const gate = flagId(registries, FLAG_FORCE_BIKING_IN_GATE);
    const road = flagId(registries, FLAG_ON_CYCLING_ROAD);
    state.flags[gate] = true;
    state.flags[road] = true;
    onWarp(registries, state, [...registries.zones.values()][0]!);
    expect(state.flags[gate]).toBeUndefined();
    expect(state.flags[road]).toBeUndefined();
  });
});

describe('TryUnlockFlyLocationByMap', () => {
  const flag = flagId(registries, FLAG_ON_CYCLING_ROAD);
  const zones = [...registries.zones.values()];
  const town = { ...zones[0]!, firstArrival: flag };
  const regs = { ...registries, zones: new Map([[town.id, town], ...zones.slice(1).map((z) => [z.id, z] as const)]) };

  it('a warp into a zone with a first-arrival flag sets it', () => {
    const state = newState();
    onWarp(regs, state, town);
    expect(state.flags[flag]).toBe(true);
  });

  it('a zone connection into it sets it too', () => {
    const state = newState();
    onZoneConnection(regs, state, town.id);
    expect(state.flags[flag]).toBe(true);
  });

  it('a zone without one sets nothing', () => {
    const state = newState();
    const before = JSON.stringify(state.flags);
    onZoneConnection(registries, state, zones[0]!.id);
    expect(JSON.stringify(state.flags)).toBe(before);
  });
});
