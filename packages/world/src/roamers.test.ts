/** The roamers (decomp roaming_pokemon.c, roamer_after_battle.c) on the fixture pack plus the roaming route zones. */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { newRoamerState, type GameState, type Registries } from '@opensinnoh/contracts';
import { activateRoamer, roamersAfterBattle, roamersOnContinue, roamersOnWarp, roamersOnZoneConnection, roamerWildSpec, roamerZones, rollRoamerEncounter } from './roamers.ts';
import { f, newState, registries as fixture } from './testing.ts';

const ROUTES = [
  'ROUTE_201', 'ROUTE_202', 'ROUTE_203', 'ROUTE_204_SOUTH', 'ROUTE_204_NORTH', 'ROUTE_205_SOUTH', 'ROUTE_205_NORTH', 'ROUTE_206',
  'ROUTE_207', 'ROUTE_208', 'ROUTE_209', 'ROUTE_210_SOUTH', 'ROUTE_210_NORTH', 'ROUTE_211_WEST', 'ROUTE_211_EAST', 'ROUTE_212_NORTH',
  'ROUTE_212_SOUTH', 'ROUTE_213', 'ROUTE_214', 'ROUTE_215', 'ROUTE_216', 'ROUTE_217', 'ROUTE_218', 'ROUTE_219', 'ROUTE_220', 'ROUTE_221',
  'ROUTE_222', 'VALLEY_WINDWORKS_OUTSIDE', 'FUEGO_IRONWORKS_OUTSIDE',
];
const zone = (i: number) => `test:MAP_HEADER_${ROUTES[i]}` as Id;
const MESPRIT_STATE = 'test:VAR_ROAMING_MESPRIT_STATE' as Id;
const SAFARI = 'test:FLAG_SAFARI_GAME_ACTIVE' as Id;

const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  ROUTES.forEach((_, i) => out.zones!.set(zone(i), { ...(fixture.zones.get(f('TOWN')) as object), id: zone(i) }));
  const base = fixture.species.get(f('SPECIES_MOSSLET')) as object;
  for (const name of ['MESPRIT', 'CRESSELIA', 'DARKRAI', 'MOLTRES', 'ZAPDOS', 'ARTICUNO']) out.species!.set(`test:SPECIES_${name}` as Id, { ...base, id: `test:SPECIES_${name}` });
  out.vars!.set(MESPRIT_STATE, { id: MESPRIT_STATE, sourceIndex: 0x4059, initial: 0, scope: 'saved' });
  out.flags!.set(SAFARI, { id: SAFARI, sourceIndex: 2407, initial: false, scope: 'saved' });
  return out as unknown as Registries;
})();

function state(seed = 5): GameState {
  const s = newState();
  s.encounterRng = { seed };
  s.roamers = newRoamerState();
  return s;
}

const routeOf = (s: GameState, slot = 0) => s.roamers.routes[slot]!;

describe('roamers', () => {
  it('CONTINUE: every active roamer to a random route, never its own nor the previous zone; none active, nothing drawn', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = state(seed);
      activateRoamer(registries, s, 0);
      activateRoamer(registries, s, 3);
      s.roamers.previous = zone(9);
      const before = [routeOf(s, 0), routeOf(s, 3)];
      roamersOnContinue(registries, s);
      expect(routeOf(s, 0)).not.toBe(before[0]);
      expect(routeOf(s, 3)).not.toBe(before[1]);
      expect([routeOf(s, 0), routeOf(s, 3)]).not.toContain(9);
    }
    const idle = state(4);
    roamersOnContinue(registries, idle);
    expect(idle.encounterRng).toEqual({ seed: 4 });
  });

  it('activate: the slot’s species and level, random PID and IVs, full HP, a route but Route 201 (its stale index) and the previous zone', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = state(seed);
      s.roamers.previous = zone(7);
      activateRoamer(registries, s, 0);
      const r = s.roamers.slots[0]!;
      expect(r).toMatchObject({ species: 'test:SPECIES_MESPRIT', level: 50, status: 'none' });
      expect(r.hp).toBeGreaterThan(50);
      expect([0, 7]).not.toContain(routeOf(s));
    }
    const a = state(3);
    activateRoamer(registries, a, 2);
    expect(a.roamers.slots[2]).toMatchObject({ species: 'test:SPECIES_DARKRAI', level: 40 });
    expect(a.encounterRng).not.toEqual({ seed: 3 });
    expect(() => activateRoamer(registries, state(), 6)).toThrow(/no roaming slot 6/);
  });

  it('map changes: recent zones update only while a roamer is active; a connection moves each roamer nearby or (1 in 16) anywhere, never to the previous zone', () => {
    const s = state();
    roamersOnWarp(s, zone(1));
    expect([s.roamers.current, s.roamers.previous]).toEqual([null, null]);
    activateRoamer(registries, s, 0);
    roamersOnWarp(s, zone(1));
    roamersOnWarp(s, zone(1));
    expect([s.roamers.current, s.roamers.previous]).toEqual([zone(1), null]);
    let nearby = 0;
    for (let i = 0; i < 400; i++) {
      const from = routeOf(s);
      const next = i % 2 ? 1 : 2;
      roamersOnZoneConnection(registries, s, zone(next));
      expect(s.roamers.current).toBe(zone(next));
      expect(zone(routeOf(s))).not.toBe(s.roamers.previous);
      if (NEAR[from]!.includes(routeOf(s))) nearby++;
    }
    expect(nearby).toBeGreaterThan(330);
    // Inside a Safari game nothing moves (FieldSystem_InitFlagsOnMapChange).
    s.flags[SAFARI] = true;
    const before = structuredClone(s.roamers);
    roamersOnZoneConnection(registries, s, zone(5));
    expect(s.roamers).toEqual(before);
  });

  it('an encounter on the roamer’s zone is the roamer half the time; elsewhere never (no draw)', () => {
    const s = state();
    activateRoamer(registries, s, 0);
    const here = zone(routeOf(s));
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (rollRoamerEncounter(registries, s, here) === 0) hits++;
    expect(hits).toBeGreaterThan(420);
    expect(hits).toBeLessThan(580);
    const rng = { ...s.encounterRng };
    expect(rollRoamerEncounter(registries, s, zone((routeOf(s) + 1) % 29))).toBeNull();
    expect(s.encounterRng).toEqual(rng);
    expect(roamerWildSpec(s, 0)).toEqual({ species: 'test:SPECIES_MESPRIT', level: 50, roamer: { pid: s.roamers.slots[0]!.pid, ivs: s.roamers.slots[0]!.ivs, hp: s.roamers.slots[0]!.hp, status: 'none' } });
  });

  it('after a battle: defeated or caught it is gone (its state var says which); fled it keeps HP and status; every roamer here moves away', () => {
    const fresh = () => {
      const s = state();
      activateRoamer(registries, s, 0);
      return { s, here: zone(routeOf(s)) };
    };
    const defeated = fresh();
    roamersAfterBattle(registries, defeated.s, defeated.here, 'test:SPECIES_MESPRIT' as Id, { outcome: 'won', roamer: { hp: 0, status: 'none' } });
    expect(defeated.s.roamers.slots[0]).toBeNull();
    expect(defeated.s.vars[MESPRIT_STATE]).toBe(2);
    const caught = fresh();
    roamersAfterBattle(registries, caught.s, caught.here, 'test:SPECIES_MESPRIT' as Id, { outcome: 'caught', roamer: { hp: 12, status: 'sleep' } });
    expect(caught.s.roamers.slots[0]).toBeNull();
    expect(caught.s.vars[MESPRIT_STATE]).toBe(1);
    const fled = fresh();
    roamersAfterBattle(registries, fled.s, fled.here, 'test:SPECIES_MESPRIT' as Id, { outcome: 'fled', roamer: { hp: 33, status: 'paralysis' } });
    expect(fled.s.roamers.slots[0]).toMatchObject({ hp: 33, status: 'paralysis' });
    expect(roamerZones(registries, fled.s)[0]!.zone).not.toBe(fled.here);
    expect(fled.s.vars[MESPRIT_STATE]).toBeUndefined();
    expect(() => roamersAfterBattle(registries, fresh().s, zone(0), 'test:SPECIES_MESPRIT' as Id, { outcome: 'fled' })).toThrow(/without its roamer data/);
  });

  it('after another wild battle the roamers on this zone move away 30% of the time', () => {
    let moved = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = state(seed);
      activateRoamer(registries, s, 0);
      const here = zone(routeOf(s));
      roamersAfterBattle(registries, s, here, f('SPECIES_SKYLET'), { outcome: 'won' });
      if (zone(routeOf(s)) !== here) moved++;
    }
    expect(moved).toBeGreaterThan(80);
    expect(moved).toBeLessThan(160);
  });
});

/** decomp sNearbyRoutes, as the route indexes the test expects (a copy, so a typo in roamers.ts shows). */
const NEAR: number[][] = [
  [1, 23], [0, 2, 3, 22, 23], [1, 3, 8, 22], [1, 2, 4, 22], [3, 5], [4, 6, 27, 28], [5, 7, 9], [6, 8, 13],
  [2, 7, 9], [8, 10, 15], [9, 11, 15], [10, 12, 19], [11, 14], [6, 7, 14, 20], [12, 13, 20], [9, 10, 16],
  [15, 17], [16, 18, 26], [17, 19, 26], [11, 18], [13, 14, 21], [20], [1, 2, 3], [0, 1, 24], [23, 25], [24],
  [17, 18], [5], [5],
];
