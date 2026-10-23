import { describe, expect, it } from 'vitest';
import type { GameState, Registries, VillaTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { FeatureHost } from './gyms/feature.ts';
import { initMapFeatures, createMapFeature } from './gyms/index.ts';
import { Villa } from './villa.ts';

const id = (s: string) => `t:${s}` as Id;
/** An original layout (not the ROM's): a table with a box, a TV row, a decoration without collision. */
const tables: VillaTables = {
  zone: id('VILLA'),
  resortArea: id('RESORT'),
  furniture: [0, 1, 2].map((t) => ({ flag: id(`F${t}`), prop: id(`prop/${t}`), label: id(`TALK${t}`) })),
  rows: [
    { type: 0, collision: true, position: [40, 0, 56], box: { left: 2, top: 3, right: 3, bottom: 4 } },
    { type: 1, collision: true, position: [88, 0, 24], box: { left: 5, top: 1, right: 6, bottom: 1 } },
    { type: 2, collision: false, position: [120, 0, 8], box: { left: 0, top: 0, right: 0, bottom: 0 } },
    { type: 0, collision: true, position: [8, 0, 8], box: { left: 0, top: 0, right: 0, bottom: 0 } },
  ],
  tvType: 1,
  visitors: { chances: [25, 75, 90], counts: [4, 12, 15], visitorVar: id('V'), messageVar: id('M'), insideFlag: id('IN'), outsideFlag: id('OUT') },
};

function host(owned: number[]): FeatureHost {
  const reg = {
    newGame: new Map([[id('NG'), { villa: tables }]]),
    flags: new Map(tables.furniture.map((f) => [f.flag, { initial: false }])),
  } as unknown as Registries;
  const state = { flags: Object.fromEntries(owned.map((t) => [tables.furniture[t]!.flag, true])), mapFeatures: null } as unknown as GameState;
  initMapFeatures(state, reg, 'villa');
  return { reg, state } as unknown as FeatureHost;
}

describe('the Villa furniture (villa_furniture.c)', () => {
  it('the slot is selected by the onTransition and the feature built from it', () => {
    const h = host([0]);
    expect(h.state.mapFeatures).toEqual({ kind: 'villa' });
    expect(createMapFeature(h)).toBeInstanceOf(Villa);
  });

  it('every placement of an owned piece is a prop at its position, rotation 0', () => {
    expect(new Villa(host([])).view().features!.models).toEqual([]);
    const models = new Villa(host([0, 2])).view().features!.models;
    expect(models).toEqual([
      { key: 'villa-0', prop: id('prop/0'), position: [40, 0, 56], rotation: [0, 0, 0] },
      { key: 'villa-2', prop: id('prop/2'), position: [120, 0, 8], rotation: [0, 0, 0] },
      { key: 'villa-3', prop: id('prop/0'), position: [8, 0, 8], rotation: [0, 0, 0] },
    ]);
  });

  it('blocks the inclusive boxes of owned, collidable placements', () => {
    const v = new Villa(host([0, 2]));
    expect([[2, 3], [3, 4], [2, 4], [0, 0]].map(([x, z]) => v.blocks(x!, z!))).toEqual([true, true, true, true]);
    expect([[1, 3], [4, 4], [2, 5], [5, 1]].map(([x, z]) => v.blocks(x!, z!))).toEqual([false, false, false, false]);
  });

  it('A on a box starts the piece\'s script; the TV only facing north; no box, no script', () => {
    const v = new Villa(host([0, 1]));
    expect(v.interact(3, 3, 'left')).toBe(id('TALK0'));
    expect(v.interact(5, 1, 'left')).toBeNull();
    expect(v.interact(6, 1, 'up')).toBe(id('TALK1'));
    expect(v.interact(4, 4, 'up')).toBeNull();
  });
});
