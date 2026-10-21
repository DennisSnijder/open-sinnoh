import { Reader } from '@opensinnoh/nds';

/** Camera table entry (decomp `sCameraTypes`, src/overlay005/field_camera.c), 24 B. */
export interface RawCamera {
  /** World units. */
  distance: number;
  /** Degrees (binary angles, 65536 = 360°), signed. */
  angle: [number, number, number];
  projection: 'perspective' | 'orthographic';
  /** Half vertical FOV in degrees, as stored. */
  fovYHalf: number;
  near: number;
  far: number;
}

export const CAMERA_SIZE = 24;
const FX = 4096;
const deg = (a: number) => (((a << 16) >> 16) * 360) / 65536;

export function readCameraTable(bytes: Uint8Array, count: number): RawCamera[] {
  if (bytes.length !== count * CAMERA_SIZE) throw new Error(`camera table: expected ${count * CAMERA_SIZE} bytes, got ${bytes.length}`);
  const r = new Reader(bytes);
  return Array.from({ length: count }, (_, i) => {
    const o = i * CAMERA_SIZE;
    const proj = r.u8(o + 12);
    if (proj > 1) throw new Error(`camera ${i}: projection ${proj}`);
    return {
      distance: r.i32(o) / FX,
      angle: [deg(r.u16(o + 4)), deg(r.u16(o + 6)), deg(r.u16(o + 8))],
      projection: proj === 0 ? 'perspective' : 'orthographic',
      fovYHalf: (r.u16(o + 14) * 360) / 65536,
      near: r.i32(o + 16) / FX,
      far: r.i32(o + 20) / FX,
    };
  });
}
