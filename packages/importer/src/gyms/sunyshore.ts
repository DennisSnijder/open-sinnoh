import type { SunyshoreGymRoom } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';

/** Overlay 8 (US rev 0 offsets): pointer tables at 2DE0/2DEC, collision selections at 4DE0 (20 bytes/room).
 * Gear records are 8 bytes (s32 model, x/y/z, four packed bits); rectangles are four u8.
 * The expanded region includes the small state lists before the old gym region at 2E04.
 */
export const SUNYSHORE_REGION = { offset: 0x2d78, end: 0x4e1c } as const;
const GEARS = [3, 6, 13];
const RECTS = [12, 18, 40];
const SELECTED = [6, 11, 14];

/** `region` is the pinned region; `ram`, its RAM address (the overlay's load address plus its offset), resolves its pointers. */
export function readSunyshoreTables(region: Uint8Array, ram: number, prop: (n: number) => Id): SunyshoreGymRoom[] {
  if (region.length !== SUNYSHORE_REGION.end - SUNYSHORE_REGION.offset) throw new Error('Sunyshore table region has the wrong length');
  const r = new Reader(region);
  const at = (o: number) => o - SUNYSHORE_REGION.offset;
  const pointer = (o: number, size: number) => {
    const p = r.u32(at(o)) - ram;
    if (p < 0 || p + size > region.length) throw new Error(`Sunyshore table pointer at ${o.toString(16)} is outside its pinned region`);
    return p;
  };
  return GEARS.map((count, room) => {
    const g = pointer(0x2de0 + room * 4, count * 8);
    const c = pointer(0x2dec + room * 4, RECTS[room]! * 4);
    const s = 0x4de0 + room * 20;
    if (r.u32(at(s)) !== SELECTED[room]) throw new Error(`Sunyshore room ${room}: collision selection count`);
    return {
      gears: Array.from({ length: count }, (_, i) => {
        const o = g + i * 8,
          model = r.i32(o),
          bits = r.u8(o + 7);
        if (model < 458 || model > 464 || bits > 15) throw new Error(`Sunyshore room ${room}: invalid gear ${i}`);
        return {
          prop: prop(model),
          x: r.u8(o + 4),
          y: r.u8(o + 5),
          z: r.u8(o + 6),
          initialRotation: bits & 3,
          clockwise: !!(bits & 4),
          vertical: !!(bits & 8),
        };
      }),
      rectangles: Array.from({ length: RECTS[room]! }, (_, i) => ({
        x: r.u8(c + i * 4),
        z: r.u8(c + i * 4 + 1),
        width: r.u8(c + i * 4 + 2),
        depth: r.u8(c + i * 4 + 3),
      })),
      collisions: Array.from({ length: 4 }, (_, state) => {
        const p = pointer(s + 4 + state * 4, SELECTED[room]!);
        return Array.from({ length: SELECTED[room]! }, (_, i) => {
          const index = r.u8(p + i);
          if (index >= RECTS[room]!) throw new Error(`Sunyshore room ${room}: rectangle ${index}`);
          return index;
        });
      }),
    };
  });
}
