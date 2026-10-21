import { describe, expect, it } from 'vitest';
import type { Button, DayPeriod } from '@opensinnoh/core';
import { DEFAULT_CLOCK } from '@opensinnoh/core';
import { landSlot, rollWildEncounter } from './encounters.ts';
import { f, mon, newState, registries, setup } from './testing.ts';

const table = registries.encounters.get(f('ENC_ROUTE'))!;

describe('wild encounter roll (decomp wild_encounters.c)', () => {
  it('grace period: the first 8 − rate/10 attempts count up and pass 5% of the time', () => {
    // Rate 30 → 5 grace steps; seeds where every grace roll fails leave the count at 5 with no encounter.
    const attempts = { count: 0 };
    let rng = { seed: 7 };
    let encounters = 0;
    for (let i = 0; i < 5; i++) {
      const r = rollWildEncounter(table, 'TALL_GRASS', rng, attempts, false, 'day');
      rng = r.rng;
      if (r.roll) encounters++;
    }
    expect(attempts.count + encounters * 5).toBeGreaterThanOrEqual(5);
  });

  it('after the grace period about 40% × rate of steps encounter, with the land slot weights', () => {
    const counts = new Map<string, number>();
    let rng = { seed: 1 };
    let hits = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const r = rollWildEncounter(table, 'TALL_GRASS', rng, { count: 8 }, false, 'day');
      rng = r.rng;
      if (!r.roll) continue;
      hits++;
      const key = `${r.roll.species}/${r.roll.level}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(hits / n).toBeCloseTo(0.4 * 0.3, 2);
    // Slots 0–1 (40%) are Skylet; the other 10 are Burrowbit.
    expect(counts.get('fixture:SPECIES_SKYLET/3')! / hits).toBeGreaterThan(0.17);
    expect(counts.get('fixture:SPECIES_SKYLET/4')! / hits).toBeGreaterThan(0.17);
    // Very tall grass raises the flat gate to 70.
    let tall = 0;
    for (let i = 0; i < n; i++) {
      const r = rollWildEncounter(table, 'VERY_TALL_GRASS', rng, { count: 8 }, false, 'day');
      rng = r.rng;
      if (r.roll) tall++;
    }
    expect(tall / n).toBeCloseTo(0.7 * 0.3, 2);
  });

  it('the period picks slots 2–3: morning keeps the table, day and twilight take the day variants, night the night ones', () => {
    const town = registries.encounters.get(f('ENC_TOWN'))!;
    const BURROWBIT = f('SPECIES_BURROWBIT');
    const SKYLET = f('SPECIES_SKYLET');
    const MOSSLET = f('SPECIES_MOSSLET');
    // ENC_TOWN: slot 2 Burrowbit, slot 3 Skylet; day: slot 2 Skylet; night: slots 2 and 3 Mosslet.
    const slots = (p: DayPeriod) => [0, 1, 2, 3, 4, 5].map((s) => landSlot(town, s, p));
    expect(slots('morning')).toEqual([SKYLET, SKYLET, BURROWBIT, SKYLET, SKYLET, BURROWBIT]);
    expect(slots('day')).toEqual([SKYLET, SKYLET, SKYLET, SKYLET, SKYLET, BURROWBIT]);
    expect(slots('twilight')).toEqual(slots('day'));
    expect(slots('night')).toEqual([SKYLET, SKYLET, MOSSLET, MOSSLET, SKYLET, BURROWBIT]);
    expect(slots('lateNight')).toEqual(slots('night'));
    // The roll uses them: Mosslet only at night.
    const seen = (p: DayPeriod) => {
      let rng = { seed: 3 };
      const out = new Set<string>();
      for (let i = 0; i < 3000; i++) {
        const r = rollWildEncounter(town, 'TALL_GRASS', rng, { count: 8 }, false, p);
        rng = r.rng;
        if (r.roll) out.add(r.roll.species);
      }
      return out;
    };
    expect(seen('day').has(MOSSLET)).toBe(false);
    expect(seen('night').has(MOSSLET)).toBe(true);
  });
});

describe('wild encounter step check', () => {
  /** Walks east and west across ROUTE_W's grass (x 4..9, z 6) for `ticks`. */
  function walkGrass(party: number, z = 6, ticks = 3000, hour = 12) {
    const state = newState('ROUTE_W', 4, z, 'right');
    for (let i = 0; i < party; i++) state.party.push(mon('SPECIES_MOSSLET', 5));
    state.gameTime.now.hour = hour;
    const g = setup(state, { clock: { ...DEFAULT_CLOCK, hour } });
    const rng = { ...g.state.rng };
    let dir: Button = 'right';
    for (let i = 0; i < ticks; i++) {
      if (g.state.player.x === 9) dir = 'left';
      if (g.state.player.x === 4) dir = 'right';
      g.tick([dir]);
    }
    return { g, rng };
  }

  it('steps in grass roll on the encounter stream and start wild battles; the game stream is untouched', () => {
    const { g, rng } = walkGrass(1);
    expect(g.battles.length).toBeGreaterThan(5);
    for (const b of g.battles) expect(b).toMatchObject({ kind: 'wild', trainers: [], time: 'day' });
    for (const b of g.battles) expect([f('SPECIES_SKYLET'), f('SPECIES_BURROWBIT')]).toContain(b.wild[0]!.species);
    expect(g.state.rng).toEqual(rng);
    expect(g.state.encounterRng).not.toEqual({ seed: 2 });
  });

  it('cave floor tiles encounter too; plain tiles and an empty party do not', () => {
    expect(walkGrass(1, 22).g.battles.length).toBeGreaterThan(5);
    expect(walkGrass(1, 12).g.battles).toEqual([]);
    expect(walkGrass(0).g.battles).toEqual([]);
  });

  it('the battle palette follows the saved clock (decomp FieldSystem_GetTimeOfDay → background offset)', () => {
    expect(walkGrass(1, 6, 1500, 18).g.battles.map((b) => b.time)).toContain('twilight');
    expect(new Set(walkGrass(1, 6, 1500, 2).g.battles.map((b) => b.time))).toEqual(new Set(['night']));
    expect(new Set(walkGrass(1, 6, 1500, 8).g.battles.map((b) => b.time))).toEqual(new Set(['day']));
  });

  it('script battles (trainers) take the same palette from the saved clock', () => {
    const at = (hour: number) => {
      const state = newState('ROUTE_W', 4, 6, 'right');
      state.gameTime.now.hour = hour;
      const g = setup(state);
      g.world.startBattle({ kind: 'trainer', trainers: [], wild: [] } as never);
      return g.battles.at(-1)!.time;
    };
    expect([at(12), at(18), at(21), at(5)]).toEqual(['day', 'twilight', 'night', 'day']);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(walkGrass(1).g.battles)).toBe(JSON.stringify(walkGrass(1).g.battles));
  });

  it('with the walking partner: two land slots and a wild double with the partner (decomp TryGenerateGrassEncounter_DoubleBattle, type 74)', () => {
    // A second slot on land; none on water (decomp TryGenerateSurfEncounter makes one).
    let rng = { seed: 5 };
    let doubles = 0;
    for (let i = 0; i < 400; i++) {
      const r = rollWildEncounter(table, 'TALL_GRASS', rng, { count: 8 }, false, 'day', true);
      rng = r.rng;
      if (r.roll) expect(r.second).not.toBeNull();
      if (r.second) doubles++;
    }
    expect(doubles).toBeGreaterThan(0);
    // Without the partner the stream is the singles one (no second draw).
    const solo = rollWildEncounter(table, 'TALL_GRASS', { seed: 9 }, { count: 8 }, false, 'day');
    const duo = rollWildEncounter(table, 'TALL_GRASS', { seed: 9 }, { count: 8 }, false, 'day', true);
    expect(duo.roll).toEqual(solo.roll);
    expect(solo.second).toBeNull();
    // The field: VAR_PARTNER_TRAINER_ID (0x403F) names the partner trainer by number.
    const regs = structuredClone(registries);
    (regs.vars as Map<string, unknown>).set(f('VAR_PARTNER_TRAINER_ID'), { id: f('VAR_PARTNER_TRAINER_ID'), sourceIndex: 0x403f, initial: 0, scope: 'saved' } as never);
    const state = newState('ROUTE_W', 4, 6, 'right');
    state.party.push(mon('SPECIES_MOSSLET', 5));
    state.hasPartner = true;
    state.vars[f('VAR_PARTNER_TRAINER_ID')] = registries.trainers.get(f('TRAINER_PARTNER'))!.sourceIndex!;
    const g = setup(state, { regs });
    let dir: Button = 'right';
    for (let i = 0; i < 3000; i++) {
      if (g.state.player.x === 9) dir = 'left';
      if (g.state.player.x === 4) dir = 'right';
      g.tick([dir]);
    }
    expect(g.battles.length).toBeGreaterThan(3);
    for (const b of g.battles) expect(b).toMatchObject({ kind: 'wild', trainers: [], topology: 'ai-partner', partner: f('TRAINER_PARTNER') });
    for (const b of g.battles) expect(b.wild).toHaveLength(2);
  });
});
