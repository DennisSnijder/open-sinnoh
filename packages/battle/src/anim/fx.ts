/**
 * The DS fixed-point maths the animation VM and the particle simulation use (NitroSDK fx): fx32 values
 * are integers ×4096; angles are 65536ths of a turn ("index" units). Results are integers, so a run is the
 * same everywhere; the square roots and normalisations go through doubles and may differ from the DS's
 * hardware by one unit in the last place.
 */
export type Vec = [number, number, number];

export const FX_ONE = 4096;

/** FX_MUL: (a·b + 0x800) >> 12. */
export function fxMul(a: number, b: number): number {
  return Math.floor((a * b + 2048) / 4096);
}

/** FX_Div: (a << 12) / b, truncated toward zero. */
export function fxDiv(a: number, b: number): number {
  if (b === 0) throw new Error('fx: division by zero');
  return Math.trunc((a * 4096) / b);
}

/** C integer division (truncates toward zero). */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new Error('fx: division by zero');
  return Math.trunc(a / b);
}

const SIN = Int16Array.from({ length: 4096 }, (_, i) => Math.round(Math.sin((i * 2 * Math.PI) / 4096) * 4096));

/** FX_SinIdx: the 4096-entry table at idx >> 4. */
export function sinIdx(idx: number): number {
  return SIN[((idx & 0xffff) >> 4) & 4095]!;
}

export function cosIdx(idx: number): number {
  return SIN[(((idx & 0xffff) >> 4) + 1024) & 4095]!;
}

/** Degrees to index units (DEG_TO_IDX: deg · 0xFFFF / 360). */
export const degToIdx = (deg: number): number => Math.trunc((deg * 0xffff) / 360) & 0xffff;

/** s16 and u16 wraps (C casts). */
export const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;
export const u16 = (v: number): number => v & 0xffff;
export const s32 = (v: number): number => v | 0;

/** VEC_Normalize: v scaled to length 4096 (a zero vector stays zero). */
export function normalize(v: Vec): Vec {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return [0, 0, 0];
  return [Math.trunc((v[0] * 4096) / len), Math.trunc((v[1] * 4096) / len), Math.trunc((v[2] * 4096) / len)];
}

export function cross(a: Vec, b: Vec): Vec {
  return [fxMul(a[1], b[2]) - fxMul(a[2], b[1]), fxMul(a[2], b[0]) - fxMul(a[0], b[2]), fxMul(a[0], b[1]) - fxMul(a[1], b[0])];
}

export function dot(a: Vec, b: Vec): number {
  return fxMul(a[0], b[0]) + fxMul(a[1], b[1]) + fxMul(a[2], b[2]);
}

/** VEC_Distance. */
export function distance(a: Vec, b: Vec): number {
  return Math.trunc(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
}
