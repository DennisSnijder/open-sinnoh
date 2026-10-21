import { describe, expect, it } from 'vitest';
import type { Zone } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { MAP_POPUP_HIDDEN, MapPopupState } from './map-popup.ts';

const ROUTE = asId('test:ui2d/map_popups/route');
const TOWN = asId('test:ui2d/map_popups/town');

const zone = (id: string, name: string, popup?: Zone['mapPopup']): Zone =>
  ({ id: asId(`test:${id}`), name, ...(popup ? { mapPopup: popup } : {}) }) as Zone;

const town = zone('town', 'TOWN', { label: 1, window: TOWN, onWarp: true });
const route = zone('route', 'ROUTE', { label: 2, window: ROUTE, onWarp: true });
const routeNorth = zone('route-north', 'ROUTE', { label: 2, window: ROUTE, onWarp: true });
const house = zone('house', 'TOWN', { label: 1, window: TOWN, onWarp: false });

/** Offsets after each of `n` ticks. */
function offsets(p: MapPopupState, n: number): (number | null)[] {
  return Array.from({ length: n }, () => {
    p.step();
    return p.view()?.offset ?? null;
  });
}

describe('map popup timing (decomp SysTask_MapNamePopUpWindow, 30 Hz)', () => {
  it('slides in 4 px a tick, holds 60 ticks, slides out, then hides', () => {
    const p = new MapPopupState();
    p.show('ROUTE', ROUTE);
    expect(p.view()).toEqual({ name: 'ROUTE', window: ROUTE, offset: MAP_POPUP_HIDDEN, phase: 'in' });
    expect(offsets(p, 10)).toEqual([34, 30, 26, 22, 18, 14, 10, 6, 2, 0]);
    expect(p.view()?.phase).toBe('hold');
    expect(new Set(offsets(p, 59))).toEqual(new Set([0]));
    expect(p.view()?.phase).toBe('hold');
    p.step();
    expect(p.view()).toMatchObject({ offset: 0, phase: 'out' });
    expect(offsets(p, 10)).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, null]);
    expect(p.view()).toBeNull();
  });

  it('a new name while sliding in slides the board out from where it is, then in with the new name', () => {
    const p = new MapPopupState();
    p.show('ROUTE', ROUTE);
    offsets(p, 3); // 26
    p.show('TOWN', TOWN);
    expect(p.view()).toMatchObject({ name: 'ROUTE', window: ROUTE, offset: 26, phase: 'out' });
    expect(offsets(p, 3)).toEqual([30, 34, 38]);
    expect(p.view()).toEqual({ name: 'TOWN', window: TOWN, offset: 38, phase: 'in' });
    expect(offsets(p, 10).at(-1)).toBe(0);
  });

  it('a new name while holding slides out at once; one while sliding out only replaces the next name', () => {
    const p = new MapPopupState();
    p.show('A', ROUTE);
    offsets(p, 20);
    p.show('B', TOWN);
    expect(p.view()?.phase).toBe('out');
    offsets(p, 2); // 8
    p.show('C', ROUTE);
    expect(p.view()).toMatchObject({ name: 'A', offset: 8, phase: 'out' });
    offsets(p, 8); // 38: C slides in
    expect(p.view()).toEqual({ name: 'C', window: ROUTE, offset: 38, phase: 'in' });
  });

  it('hide is instant and forgets the next name', () => {
    const p = new MapPopupState();
    p.show('A', ROUTE);
    p.show('B', TOWN);
    p.hide();
    expect(p.view()).toBeNull();
    p.step();
    expect(p.view()).toBeNull();
  });
});

describe('map popup triggers', () => {
  it('a crossing shows the new zone only when its label differs', () => {
    const p = new MapPopupState();
    p.crossed(route, routeNorth);
    expect(p.view()).toBeNull();
    p.crossed(town, route);
    expect(p.view()).toMatchObject({ name: 'ROUTE', window: ROUTE });
  });

  it('crossing back and forth restarts with the latest zone', () => {
    const p = new MapPopupState();
    p.crossed(town, route);
    offsets(p, 4);
    p.crossed(route, town);
    offsets(p, 2);
    p.crossed(town, route);
    // Still sliding out the first board; the last crossing's name follows.
    expect(p.view()).toMatchObject({ name: 'ROUTE', phase: 'out' });
    while (p.view()?.offset !== MAP_POPUP_HIDDEN) p.step();
    expect(p.view()).toMatchObject({ name: 'ROUTE', phase: 'in' });
  });

  it('a warp shows the zone unless it is a building, and replaces any board', () => {
    const p = new MapPopupState();
    p.crossed(town, route);
    p.arrived(house);
    expect(p.view()).toBeNull();
    p.arrived(town);
    expect(p.view()).toEqual({ name: 'TOWN', window: TOWN, offset: MAP_POPUP_HIDDEN, phase: 'in' });
  });

  it('zones without a popup never show one', () => {
    const p = new MapPopupState();
    const plain = zone('plain', 'PLAIN');
    p.arrived(plain);
    p.crossed(town, plain);
    expect(p.view()).toBeNull();
    p.crossed(plain, town);
    expect(p.view()).toMatchObject({ name: 'TOWN' });
  });
});
