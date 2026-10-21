/**
 * The map-name popup on the real Platinum data (OPENSINNOH_NDS_ROM): walking from Twinleaf Town onto Route
 * 201 shows the route's name on the route signboard, crossing back restarts it with the town's, entering
 * a house shows nothing, and leaving it shows the town again (decomp overlay 5 map_name_popup.c).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PackData } from '@opensinnoh/core';
import type { GameState } from '@opensinnoh/contracts';
import { createGame, type Game } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const TWINLEAF = 'platinum:MAP_HEADER_TWINLEAF_TOWN';
const ROUTE_201 = 'platinum:MAP_HEADER_ROUTE_201';
const HOUSE = 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F';

describe.skipIf(!romPath)('map-name popup (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 120_000);

  /** A loaded save standing in Twinleaf at x/z facing up, after the load's popup has gone. */
  function at(x: number, z: number): Game {
    const g = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, now: () => '2026-01-01T00:00:00.000Z' });
    const state: GameState = structuredClone(g.state);
    state.player = { zone: TWINLEAF, x, z, y: 0, facing: 'up' };
    state.objects = [];
    state.follower = null;
    // After the opening's Twinleaf scenes: the guitarist has stepped aside and Mom has spoken.
    state.vars['platinum:VAR_TWINLEAF_TOWN_RIVAL_TRIGGER_STATE' as never] = 1;
    state.vars['platinum:VAR_TWINLEAF_TOWN_GUITARIST_TRIGGER_STATE' as never] = 2;
    state.vars['platinum:VAR_PLAYER_HOUSE_STATE' as never] = 2;
    g.load({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }, 'arrival');
    return g;
  }

  /** Holds `button` until the player is in `zone`; returns the ticks taken. */
  function walkInto(g: Game, button: 'up' | 'down', zone: string): number {
    g.press(button);
    let n = 0;
    for (; g.state.player.zone !== zone; n++) {
      if (n > 300) throw new Error(`never reached ${zone} (at ${JSON.stringify(g.state.player)})`);
      g.tick();
    }
    g.release(button);
    return n;
  }

  it('the records carry each zone label and window', () => {
    const g = at(110, 870);
    const zone = (id: string) => g.registries.zones.get(id as never)!;
    expect(zone(ROUTE_201).mapPopup).toEqual({ label: expect.any(Number), window: 'platinum:ui2d/map_popups/route', onWarp: true });
    expect(zone(TWINLEAF).mapPopup).toMatchObject({ window: 'platinum:ui2d/map_popups/town', onWarp: true });
    expect(zone(HOUSE).mapPopup).toMatchObject({ label: zone(TWINLEAF).mapPopup!.label, onWarp: false });
    const sheet = g.registries.ui2d.get('platinum:ui2d/map_popups/route' as never)!;
    expect(sheet.cells).toEqual([expect.objectContaining({ w: 136, h: 40 })]);
    expect(sheet.textColors).toEqual([{ fg: expect.stringMatching(/^#[0-9a-f]{6}$/), shadow: expect.stringMatching(/^#[0-9a-f]{6}$/) }]);
  });

  it('a loaded save outdoors shows the town; Twinleaf → Route 201 shows the route, and crossing back restarts it', () => {
    const g = at(110, 870);
    expect(g.mapPopup()).toEqual({ name: g.registries.zones.get(TWINLEAF as never)!.name, window: 'platinum:ui2d/map_popups/town', offset: 38, phase: 'in' });
    // Let the town's board run out.
    for (let i = 0; i < 80; i++) g.tick();
    expect(g.mapPopup()).toBeNull();

    walkInto(g, 'up', ROUTE_201);
    const route = g.registries.zones.get(ROUTE_201 as never)!;
    expect(route.name.toUpperCase()).toBe('ROUTE 201');
    expect(g.mapPopup()).toEqual({ name: route.name, window: 'platinum:ui2d/map_popups/route', offset: 38, phase: 'in' });
    const offsets: number[] = [];
    for (let i = 0; i < 3; i++) {
      g.tick();
      offsets.push(g.mapPopup()!.offset);
    }
    expect(offsets).toEqual([34, 30, 26]);
    expect(g.snapshot().mapPopup).toMatchObject({ name: route.name, offset: 26 });

    // Straight back south: the route board slides out from where it is, then Twinleaf slides in.
    walkInto(g, 'down', TWINLEAF);
    expect(g.mapPopup()).toMatchObject({ name: route.name, phase: 'out' });
    for (let i = 0; i < 20 && g.mapPopup()?.name === route.name; i++) g.tick();
    expect(g.mapPopup()).toMatchObject({ name: g.registries.zones.get(TWINLEAF as never)!.name, window: 'platinum:ui2d/map_popups/town', phase: 'in' });
  });

  it('entering a house shows nothing; leaving it shows the town', () => {
    const g = at(116, 886);
    for (let i = 0; i < 80; i++) g.tick();
    walkInto(g, 'up', HOUSE);
    for (let i = 0; i < 60; i++) {
      expect(g.mapPopup()).toBeNull();
      g.tick();
    }
    walkInto(g, 'down', TWINLEAF);
    expect(g.mapPopup()).toMatchObject({ name: g.registries.zones.get(TWINLEAF as never)!.name, window: 'platinum:ui2d/map_popups/town', offset: 38 });
  });

  it('A hides the board at once', () => {
    const g = at(110, 870);
    g.tick();
    expect(g.mapPopup()).not.toBeNull();
    g.press('a');
    g.tick();
    expect(g.mapPopup()).toBeNull();
  });
});
