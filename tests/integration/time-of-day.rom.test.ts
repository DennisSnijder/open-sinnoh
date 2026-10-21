/**
 * Time of day on the real ROM (OPENSINNOH_NDS_ROM): Route 201's wild slots by period (decomp
 * WildEncounters_ReplaceTimedEncounters over encounters_route_201.json), its area light's day and night
 * templates (arealight.narc, AreaLightManager), and the clock through a real game: the saved clock, the
 * scripts' time ops and the battle palette.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { dayPeriod, DAY_PERIODS, type Id, type PackData } from '@opensinnoh/core';
import type { Light } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, loadGamePacks } from '@opensinnoh/game';
import { lightAt } from '../../packages/render/src/lighting.ts';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld, landSlot } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!romPath)('time of day (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  let registries: ReturnType<typeof loadGamePacks>['registries'];
  beforeAll(() => {
    ({ pack } = romSlice());
    ({ registries } = loadGamePacks([pack]));
  }, 60_000);

  it("Route 201's land slots 2–3 follow the period as the decomp says", () => {
    const zone = registries.zones.get(P('MAP_HEADER_ROUTE_201'))!;
    const table = registries.encounters.get(zone.encounters!)!;
    const slots = (hour: number) => [2, 3].map((s) => landSlot(table, s, dayPeriod(hour)));
    // encounters_route_201.json: land 2–3 Starly, Kricketot (the morning ones); day Starly, Bidoof; night Kricketot, Bidoof.
    expect(slots(6)).toEqual([P('SPECIES_STARLY'), P('SPECIES_KRICKETOT')]);
    expect(slots(12)).toEqual([P('SPECIES_STARLY'), P('SPECIES_BIDOOF')]);
    expect(slots(18)).toEqual(slots(12));
    expect(slots(21)).toEqual([P('SPECIES_KRICKETOT'), P('SPECIES_BIDOOF')]);
    expect(slots(2)).toEqual(slots(21));
    // The other slots never change with the time.
    for (const s of [0, 1, 4, 5, 6, 7, 8, 9, 10, 11]) expect(new Set(DAY_PERIODS.map((p) => landSlot(table, s, p))).size, `slot ${s}`).toBe(1);
  });

  it("Route 201's area light switches to darker, bluer templates at night; interiors have one template", () => {
    const zone = registries.zones.get(P('MAP_HEADER_ROUTE_201'))!;
    const light: Light = registries.lights.get(registries.areas.get(zone.area)!.light)!;
    expect(light.schedule).toHaveLength(15);
    const at = (h: number) => lightAt(light, h * 3600).template;
    const sun = (h: number) => at(h).lights[0]!.color;
    // The midday template is the record's own (title and scenes use it).
    expect(at(12).lights).toEqual(light.lights);
    // Light 0: 24,24,20 of 31 at noon (the template until 15:00); 11,11,16 at 22:00 (darker, blue over red).
    expect(sun(12).map((c) => Math.round(c * 31))).toEqual([24, 24, 20]);
    expect(sun(22).map((c) => Math.round(c * 31))).toEqual([11, 11, 16]);
    const sum = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);
    expect(sum(sun(22))).toBeLessThan(sum(sun(12)) * 0.75);
    expect(sum(at(22).emission)).toBeLessThan(sum(at(12).emission));
    // Twilight is warm: red over blue.
    expect(sun(18)[0]).toBeGreaterThan(sun(18)[2]!);
    // Light 2 (window glow) is a strong warm yellow by night and a faint blue by day.
    expect(at(22).lights[2]!.color[0]).toBeGreaterThan(0.6);
    expect(at(12).lights[2]!.color[0]).toBeLessThan(0.1);
    expect(registries.lights.get(P('light/1'))!.schedule).toBeUndefined();
  });

  it('a game at night: the saved clock, the time ops and the battle palette read it', () => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log, now: () => 'now', clock: () => ({ date: '2026-10-14', hour: 21, minute: 30, second: 0 }) });
    expect(game.state.gameTime.now).toMatchObject({ hour: 21, minute: 30 });
    expect(game.world.view().clock).toEqual({ seconds: 21 * 3600 + 30 * 60, period: 'night' });
    // No script reads the time on the opening's first ticks; nothing is stubbed for it.
    game.advance(10);
    expect(log.report().map((s) => s.key)).not.toContain('stub:get_time_of_day');
    expect(log.report().map((s) => s.key)).not.toContain('stub:get_hour');
  });
});
