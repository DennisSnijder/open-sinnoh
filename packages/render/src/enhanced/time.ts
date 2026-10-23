/**
 * The enhanced look by the hour (0..24, fractional): continuous curves, unlike the DS area light, which switches
 * template at a few fixed times. The DS light still does its own switch underneath.
 */

type Key = [hour: number, ...values: number[]];

/** Piecewise-linear over the day, wrapping at 24. */
function curve(keys: readonly Key[], hour: number): number[] {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[(i + 1) % keys.length]!;
    const end = b[0] <= a[0] ? b[0] + 24 : b[0];
    const at = h < a[0] ? h + 24 : h;
    if (at >= a[0] && at <= end) {
      const t = end === a[0] ? 0 : (at - a[0]) / (end - a[0]);
      return a.slice(1).map((v, k) => v + (b[k + 1]! - v) * t);
    }
  }
  throw new Error(`enhanced: no curve key around hour ${hour}`);
}

/** 0 by day, 1 at night. */
export function nightAt(hour: number): number {
  return curve([[0, 1], [4.5, 1], [6.5, 0], [18.5, 0], [20.5, 1]], hour)[0]!;
}

/** Golden hour: 0 most of the day, 1 at the low sun of dawn and sunset. */
export function goldenAt(hour: number): number {
  return curve([[0, 0], [5, 0], [6.2, 1], [8, 0], [15.5, 0], [18, 1], [19.6, 0]], hour)[0]!;
}

/**
 * Where the sun is (unit vector, world: +x east, +z south, the camera's side): east at 06:00, south at noon, west at
 * 18:00, low at both ends, under the horizon at night (y < 0).
 */
export function sunDirection(hour: number): { x: number; y: number; z: number } {
  const a = ((hour - 6) / 12) * Math.PI;
  const elevation = Math.sin(a) * 62 * (Math.PI / 180) + 0.1;
  const flat = Math.cos(elevation);
  return { x: Math.cos(a) * flat, y: Math.sin(elevation), z: Math.max(0.15, Math.sin(a)) * flat };
}

/** Bloom by the hour: subtle by day, strong at night (lamps and windows). */
export function bloomAt(hour: number, lamps: boolean): { strength: number; threshold: number; radius: number } {
  const n = nightAt(hour);
  // By day only near-white glows (no noon grass or warp tiles); at night the lit windows and lamps.
  return { strength: 0.18 + n * (lamps ? 0.42 : 0.32), threshold: 0.97 - n * 0.25, radius: 0.4 + n * 0.2 };
}

export interface Grade {
  gain: [number, number, number];
  lift: [number, number, number];
  saturation: number;
  contrast: number;
  exposure: number;
  vignette: number;
  sunset: [number, number, number];
  sunsetAmount: number;
}

/**
 * Colour grading by the hour. Keys: temperature (−cool … +warm), saturation, contrast, exposure, vignette, and the
 * night lift (blue shadows). `sun` makes the sunset tint stronger.
 */
export function gradeAt(hour: number, on: boolean, sun: boolean): Grade {
  if (!on && !sun) return { gain: [1, 1, 1], lift: [0, 0, 0], saturation: 1, contrast: 1, exposure: 1, vignette: 0, sunset: [1, 1, 1], sunsetAmount: 0 };
  const [temp, sat, contrast, exposure, vignette, lift] = on
    ? curve(
        [
          [0, -0.55, 0.82, 1.06, 1.04, 0.42, 0.05],
          [4.5, -0.45, 0.85, 1.05, 1.02, 0.4, 0.04],
          [6.3, 0.4, 1.05, 1.04, 1.02, 0.3, 0],
          [9, 0.06, 1.06, 1.05, 1.02, 0.22, 0],
          [14, 0.02, 1.07, 1.05, 1.02, 0.22, 0],
          [16.5, 0.22, 1.08, 1.05, 1.02, 0.26, 0],
          [18.3, 0.55, 1.1, 1.06, 1.0, 0.34, 0],
          [20.2, -0.4, 0.88, 1.06, 1.04, 0.42, 0.05],
        ],
        hour,
      )
    : [0, 1, 1, 1, 0, 0];
  const g = goldenAt(hour);
  return {
    gain: [1 + 0.12 * temp!, 1 + 0.015 * temp!, 1 - 0.16 * temp!],
    lift: [lift! * 0.2, lift! * 0.45, lift!],
    saturation: sat!,
    contrast: contrast!,
    exposure: exposure!,
    vignette: vignette!,
    sunset: [1.18, 0.86, 0.68],
    sunsetAmount: sun ? g * 0.45 : 0,
  };
}
