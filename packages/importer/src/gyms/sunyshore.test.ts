import { describe, expect, it } from 'vitest';
import { asId } from '@opensinnoh/core';
import { readSunyshoreTables, SUNYSHORE_REGION } from './sunyshore.ts';

/** Original writer: intentionally puts every payload at different locations from the ROM. */
function tables() {
  const bytes = new Uint8Array(SUNYSHORE_REGION.end - SUNYSHORE_REGION.offset),
    v = new DataView(bytes.buffer);
  const at = (o: number) => o - SUNYSHORE_REGION.offset;
  const u32 = (o: number, n: number) => v.setUint32(at(o), n, true);
  const ptr = (o: number, p: number) => u32(o, 0x02249960 + p);
  for (let room = 0; room < 3; room++) {
    const gears = 0x3300 + room * 0x80,
      rects = 0x3500 + room * 0x100,
      lists = 0x3900 + room * 0x100;
    ptr(0x2de0 + room * 4, gears);
    ptr(0x2dec + room * 4, rects);
    for (let i = 0; i < [3, 6, 13][room]!; i++) {
      const o = gears + i * 8;
      u32(o, 459);
      bytes.set([i + 1, room, i + 2, i % 4 | 4 | (i % 2 ? 8 : 0)], at(o + 4));
    }
    for (let i = 0; i < [12, 18, 40][room]!; i++) bytes.set([i + 1, i + 2, 1, 2], at(rects + i * 4));
    const count = [6, 11, 14][room]!;
    u32(0x4de0 + room * 20, count);
    for (let s = 0; s < 4; s++) {
      const p = lists + s * 32;
      ptr(0x4de4 + room * 20 + s * 4, p);
      for (let i = 0; i < count; i++) bytes[at(p + i)] = (i + s) % [12, 18, 40][room]!;
    }
  }
  return { bytes, v, at };
}
describe('Sunyshore pointer tables', () => {
  it('reads packed axes/directions and follows all four state pointers outside the former gym region', () => {
    const { bytes } = tables();
    const rooms = readSunyshoreTables(bytes, 0x02249960 + SUNYSHORE_REGION.offset, (n) => asId(`original:PROP_${n}`));
    expect(rooms.map((r) => r.gears.length)).toEqual([3, 6, 13]);
    expect(rooms.map((r) => r.rectangles.length)).toEqual([12, 18, 40]);
    expect(rooms[1]!.gears[1]).toMatchObject({ x: 2, y: 1, z: 3, initialRotation: 1, clockwise: true, vertical: true });
    expect(rooms[2]!.collisions[3]).toEqual(Array.from({ length: 14 }, (_, i) => i + 3));
  });
  it('rejects a pointer outside the pin at the import boundary', () => {
    const { bytes, v, at } = tables();
    v.setUint32(at(0x2de0), 0x02249960 + 0x20, true);
    expect(() => readSunyshoreTables(bytes, 0x02249960 + SUNYSHORE_REGION.offset, (n) => asId(`original:P${n}`))).toThrow(/outside/);
  });
});
