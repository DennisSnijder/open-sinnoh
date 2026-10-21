/** The gym table reader on bytes written here (original values, not the ROM's). */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { GYM_REGION, GymFormatError, LIGHT_REGION, readGymTables, readHearthomeLight, type GymNames } from './index.ts';

const END = 0x4ddc;
const names: GymNames = {
  zone: (i) => `t:ZONE_${i}` as Id,
  eternaZone: 't:ETERNA' as Id,
  veilstoneZone: 't:VEILSTONE' as Id,
  hearthomeEntrance: 't:ENTRANCE' as Id,
  clockVar: 't:VAR_CLOCK' as Id,
  fountainMessage: 't:TEXT' as Id,
  relicBadge: 't:BADGE' as Id,
  hearthomePlayer: { male: 't:M' as Id, female: 't:F' as Id },
  hands: null,
  pastoria: { buttons: { blue: 't:BLUE' as Id, green: 't:GREEN' as Id, orange: 't:ORANGE' as Id }, water: 't:WATER' as Id },
  prop: (m) => `t:PROP_${m}` as Id,
  canalaveStarts: Array.from({ length: 24 }, (_, i) => i === 5),
  canalaveFloors: ['t:F2' as Id, 't:F3' as Id, 't:F4' as Id],
};

function region(edit: (v: DataView) => void = () => {}): Uint8Array {
  const bytes = new Uint8Array(END - GYM_REGION);
  const v = new DataView(bytes.buffer);
  const at = (o: number) => o - GYM_REGION;
  [2, 5, 5, 5].forEach((d, i) => v.setInt32(at(0x2e04) + i * 4, d, true));
  for (let i = 0; i < 5; i++) {
    v.setInt16(at(0x2e14) + i * 4, i + 1, true);
    v.setInt16(at(0x2e14) + i * 4 + 2, 10 * i, true);
    v.setInt16(at(0x2e90) + i * 8, i === 0 ? -1 : 3, true);
    v.setInt16(at(0x2e90) + i * 8 + 2, i === 0 ? -1 : 4 + i, true);
    v.setInt32(at(0x2e90) + i * 8 + 4, i === 0 ? 2 : i % 2, true);
  }
  // Room 1: header 7, doors 0–1 (two), offset 1,2, size 2×2; room 2: header 8, door 2 (one), 3×1.
  [7, 0, 2, 1, 2, 2, 2, 8, 2, 1, 0, 0, 3, 1].forEach((n, i) => v.setInt32(at(0x2f74) + i * 4, n, true));
  const doors = (o: number, list: [number, number, number][]) =>
    [...list, [8, 0, 0] as [number, number, number]].forEach(([id, x, z], i) => {
      v.setInt32(at(o) + i * 8, id, true);
      v.setInt16(at(o) + i * 8 + 4, x, true);
      v.setInt16(at(o) + i * 8 + 6, z, true);
    });
  doors(0x2e70, [
    [0, 3, 1],
    [1, 6, 1],
  ]);
  doors(0x2ee4, [[2, 9, 1]]);
  bytes[at(0x4748) + 3] = 1;
  // Canalave: every path a y lift (model 296) from (i, 0, 9) to (i, 10, 9), floors 0 → 1; platform 3 an x lift (295) to x 20.
  for (let i = 0; i < 24; i++) {
    const o = at(0x3208) + i * 16;
    v.setInt32(o, i === 3 ? 295 : 296, true);
    [i, 0, 9, i === 3 ? 20 : i, i === 3 ? 0 : 10, 9, 0, i === 3 ? 0 : 1].forEach((b, k) => v.setUint8(o + 4 + k, b));
  }
  bytes[at(0x36d5) + 1024 * 2 + 40] = 1;
  bytes[at(0x49dc) + 33] = 4;
  edit(v);
  return bytes;
}

const LIGHT = { rotations: [], scales: [], offsets: [] };

describe('gym tables (overlay 8)', () => {
  it('reads every table at its offset', () => {
    const t = readGymTables(region(), names, null, LIGHT);
    expect(t.eterna.times[2]).toEqual({ hour: 3, minute: 20 });
    expect(t.eterna.jumps).toEqual([null, { x: 3, z: 5, northSouth: true }, { x: 3, z: 6, northSouth: false }, { x: 3, z: 7, northSouth: true }, { x: 3, z: 8, northSouth: false }]);
    expect(t.veilstone.cameraDistance).toEqual({ up: 2, down: 5, left: 5, right: 5 });
    expect(t.veilstone.track[33]).toBe(4);
    expect(t.hearthome.rooms[0]).toMatchObject({ zone: 't:ZONE_7', firstDoor: 0, doorCount: 2, offsetX: 1, offsetZ: 2, width: 2, depth: 2, clueMask: [0, 0, 0, 1], doors: [{ door: 0, x: 3, z: 1 }, { door: 1, x: 6, z: 1 }] });
    expect(t.hearthome.rooms[1]).toMatchObject({ zone: 't:ZONE_8', doors: [{ door: 2, x: 9, z: 1 }], clueMask: [0, 0, 0] });
    expect(t.canalave.platforms[2]).toEqual({ prop: 't:PROP_296', axis: 'y', a: [2, 0, 9], b: [2, 10, 9], floorA: 0, floorB: 1 });
    expect(t.canalave.platforms[3]).toMatchObject({ prop: 't:PROP_295', axis: 'x', b: [20, 0, 9] });
    expect(t.canalave.collision.map((m) => m.indexOf(1))).toEqual([-1, -1, 40, -1]);
  });

  it('fails on values the gym code cannot hold', () => {
    expect(() => readGymTables(region((v) => v.setInt16(0x2e14 - GYM_REGION, 12, true)), names, null, LIGHT)).toThrow(GymFormatError);
    expect(() => readGymTables(region((v) => v.setUint8(0x3388 - GYM_REGION, 2)), names, null, LIGHT)).toThrow(/clock mask 0/);
    expect(() => readGymTables(region((v) => v.setInt32(0x2f74 - GYM_REGION + 8, 3, true)), names, null, LIGHT)).toThrow(/2 doors listed, 3/);
    expect(() => readGymTables(region((v) => v.setInt32(0x3208 - GYM_REGION, 7, true)), names, null, LIGHT)).toThrow(/sCanalavePlatformPaths 0: model 7/);
  });

  it('reads the Hearthome light from overlay 5: rotations in degrees, scales and offsets in fx32, the fldeff members', () => {
    const bytes = new Uint8Array(LIGHT_REGION.end - LIGHT_REGION.offset);
    const v = new DataView(bytes.buffer);
    const at = (ram: number) => ram - 0x021d0d80 - LIGHT_REGION.offset;
    v.setUint32(at(0x02200750), 200, true);
    // Simple3DRotationAngles is 8 bytes (two of padding, left at a value the reader must skip).
    [10, 20, 30, 0xffff, 0, 90, 180, 0xffff].forEach((a, i) => v.setUint16(at(0x0220077c) + i * 2, a, true));
    for (let i = 0; i < 9; i++) v.setUint32(at(0x0220079c) + i * 4, 100 + i, true);
    // Direction 1 (south), length 2: scale (0.5, 1.25, 1), offset (−3, 0, 27.5).
    [0x800, 0x1400, 0x1000].forEach((x, k) => v.setInt32(at(0x022007c0) + (6 + 2) * 12 + k * 4, x, true));
    [-3 * 4096, 0, 27.5 * 4096].forEach((x, k) => v.setInt32(at(0x022008e0) + (6 + 2) * 12 + k * 4, x, true));
    const light = readHearthomeLight(bytes);
    expect(light.members).toEqual({ light: 100, scroll: 200, symbols: [101, 102, 103, 104, 105, 106, 107, 108] });
    expect(light.tables.rotations.slice(0, 2)).toEqual([
      [10, 20, 30],
      [0, 90, 180],
    ]);
    expect(light.tables.scales[1]![2]).toEqual([0.5, 1.25, 1]);
    expect(light.tables.offsets[1]![2]).toEqual([-3, 0, 27.5]);
    expect(light.tables.scales.map((d) => d.length)).toEqual([6, 6, 6, 6]);
    v.setUint16(at(0x0220077c), 360, true);
    expect(() => readHearthomeLight(bytes)).toThrow(/not in degrees/);
  });
});
