import { expect, it } from 'vitest';
import type { Matrix, ObjectEvent, Zone } from '@opensinnoh/contracts';
import { resolveUnscriptedClones } from './object-clones.ts';

const event = (localId: number, x: number, label?: ObjectEvent['label']): ObjectEvent => ({ localId, sprite: 'test:GUIDE', x, z: 5, y: 0, facing: 'left', movementType: 5, trainerType: 0, data: [0, 0, 0], range: { x: 1, z: 0 }, ...(label ? { label } : {}) });
const zone = (id: Zone['id'], objects: ObjectEvent[]): Pick<Zone, 'id' | 'matrix' | 'events'> => ({ id, matrix: 'test:MATRIX', events: { objects, bgs: [], warps: [], coords: [] } });
const matrix: Pick<Matrix, 'id' | 'width' | 'height' | 'zones'> = { id: 'test:MATRIX', width: 2, height: 1, zones: ['test:WEST', 'test:EAST'] };

it('identifies an unscripted neighbour copy with a different local id, without changing distinct NPCs', () => {
  const copy = event(7, 30);
  const distinct = event(8, 29);
  const scripted = event(9, 30, 'test:OTHER');
  const west = zone('test:WEST', [event(3, 30, 'test:TALK')]);
  const east = zone('test:EAST', [copy, distinct, scripted]);
  resolveUnscriptedClones([west, east], [matrix]);
  expect(copy).toMatchObject({ cloneOf: 'test:WEST', cloneLocalId: 3, localId: 7 });
  expect(distinct.cloneOf).toBeUndefined();
  expect(scripted.cloneOf).toBeUndefined();
});

it('does not infer a clone from a match outside the owning cell or in a different matrix', () => {
  const copy = event(7, 30);
  const west = zone('test:WEST', [event(3, 30, 'test:TALK')]);
  west.matrix = 'test:OTHER_MATRIX';
  resolveUnscriptedClones([west, zone('test:EAST', [copy])], [matrix, { ...matrix, id: 'test:OTHER_MATRIX' }]);
  expect(copy.cloneOf).toBeUndefined();
});
