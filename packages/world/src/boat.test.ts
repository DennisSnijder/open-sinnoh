import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { BOAT_TRAVEL_DIR, BoatTrip, type BoatHost } from './boat.ts';

/** The boat trip's task on a fake host (original numbers: bridges of 20 and 30 frames, a 50-frame cinematic). */
function trip(dir: number, bridges: [number, number] = [20, 30]) {
  const log: string[] = [];
  let fadeLeft = 0;
  let warpLeft = -1;
  const host: BoatHost = {
    ship: () => [100, 0, 200],
    bridgeFrames: () => bridges,
    cinematicFrames: () => 50,
    fade: (kind, ticks) => {
      log.push(`fade ${kind} ${ticks}`);
      fadeLeft = ticks;
    },
    fadeDone: () => fadeLeft === 0,
    changeMap: (zone, x, z, facing) => {
      log.push(`map ${zone} ${x} ${z} ${facing}`);
      warpLeft = 10;
    },
    warpDone: () => warpLeft === 0,
  };
  const t = new BoatTrip(host, dir, 'right', 'test:ISLAND' as Id, 100, 502);
  const tick = () => {
    t.step();
    if (fadeLeft > 0) fadeLeft--;
    if (warpLeft > 0) warpLeft--;
  };
  return { t, log, tick };
}

describe('boat trips (decomp boat_cutscene.c)', () => {
  it('departs at 0.25 then 1.25 a tick: bridges on update 198, the fade once both ended and 25 tiles out (339)', () => {
    const { t, log, tick } = trip(BOAT_TRAVEL_DIR.northToSouth);
    let update = 0;
    let bridgesAt = 0;
    while (!log.some((l) => l.startsWith('fade'))) {
      tick();
      update++;
      if (t.bridges && !bridgesAt) bridgesAt = update;
      if (update > 1000) throw new Error('never faded');
    }
    expect(bridgesAt).toBe(198);
    // The goal holds from update 339; the 30-frame bridge ends on update 198 + 29.
    expect(update).toBe(340);
    expect(t.cameraOffset[0]).toBe(32);
    expect(t.shipOffset[2]).toBeCloseTo(-(24 * 0.25 + (339 - 24) * 1.25));
  });

  it('a long bridge clip holds the ship past its goal; the cinematic, then the map change', () => {
    const { t, log, tick } = trip(BOAT_TRAVEL_DIR.northToSouth, [20, 200]);
    let update = 0;
    while (!log.some((l) => l.startsWith('fade'))) {
      tick();
      update++;
    }
    expect(update).toBe(198 + 199 + 1);
    let after = 0;
    while (!t.done()) {
      tick();
      after++;
    }
    expect(log).toEqual(['fade out 6', 'map test:ISLAND 100 502 right']);
    // The fade's other 5 ticks (its first ran with the fading update), the tick that sees it done, the
    // cinematic's 50 frames and its 6-tick fade out, then the map change's 10.
    expect(after).toBe(5 + 1 + 56 + 10);
    expect(t.cameraOffset).toEqual([0, 0, 0]);
  });

  it('the return starts at the fade', () => {
    const { log, tick } = trip(BOAT_TRAVEL_DIR.southToNorth);
    tick();
    expect(log).toEqual(['fade out 6']);
  });
});

it('exposes the cinematic without changing the task duration, and removes it before the map change', () => {
  const { t, tick, log } = trip(0);
  expect(t.view()).toBeUndefined();
  while (!t.view()) tick();
  expect(t.view()).toEqual({ direction: 0, tick: 0, frames: 50 });
  for (let i = 0; i < 55; i++) tick();
  expect(t.view()?.tick).toBe(55);
  expect(log.some(l => l.startsWith('map'))).toBe(false);
  tick();
  expect(t.view()).toBeUndefined();
  expect(log.at(-1)).toBe('map test:ISLAND 100 502 right');
});

it('Snowpoint sails east for 12 tiles, pans south 3 tiles and never opens bridges', () => {
  const { t, tick, log } = trip(2);
  let updates = 0;
  while (!log.length) { tick(); updates++; }
  expect(updates).toBe(173); // 172 movement callbacks, then the fade request.
  expect(t.shipOffset).toEqual([24 * 0.25 + 148 * 1.25, 0, 0]);
  expect(t.cameraOffset[2]).toBe(48);
  expect(t.bridges).toBeNull();
});
