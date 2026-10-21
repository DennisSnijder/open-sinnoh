import type { Terrain } from '@opensinnoh/contracts';

/**
 * Strip lookup with the same result as the DS binary search (decomp `src/overlay005/bdhc.c`):
 * one strip → it; otherwise narrow [low, high] and land on the first strip whose scanline is past z
 * (or the strip after the last one at or before z).
 */
function stripIndex(t: Terrain, z: number): number | null {
  const n = t.strips.length;
  if (n === 0) return null;
  if (n === 1) return 0;
  let low = 0;
  let high = n - 1;
  let mid = Math.floor(high / 2);
  for (;;) {
    if (t.strips[mid]!.z > z) {
      if (high - 1 > low) {
        high = mid;
        mid = Math.floor((low + high) / 2);
      } else return mid;
    } else if (low + 1 < high) {
      low = mid;
      mid = Math.floor((low + high) / 2);
    } else return Math.min(mid + 1, n - 1);
  }
}

const MAX_CANDIDATES = 10;

/**
 * Terrain height at chunk-local (x, z) (origin at the chunk centre). Among the plates whose bounding
 * box contains the point, picks the height closest to `current` (as the DS does). Null = no plate.
 */
export function terrainHeight(t: Terrain, x: number, z: number, current: number): number | null {
  const si = stripIndex(t, z);
  if (si === null) return null;
  const strip = t.strips[si]!;
  let best: number | null = null;
  let found = 0;
  for (let i = 0; i < strip.count && found < MAX_CANDIDATES; i++) {
    const plate = t.plates[t.accessList[strip.start + i]!]!;
    const a = t.points[plate.p1]!;
    const b = t.points[plate.p2]!;
    if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0]) || z < Math.min(a[1], b[1]) || z > Math.max(a[1], b[1])) continue;
    const n = t.normals[plate.normal]!;
    const y = -(n[0] * x + n[2] * z + t.constants[plate.constant]!) / n[1] + 0; // + 0 turns -0 into 0
    found++;
    if (best === null || Math.abs(y - current) < Math.abs(best - current)) best = y;
  }
  return best;
}
