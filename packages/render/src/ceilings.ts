import * as THREE from 'three';

const CELL = 16;
/** Faces this close above the floor touch it: ramps, or what stands on the floor (see `above`). */
const TOUCHING = 4;
/** Over a walkable tile, faces lower than half a tile above the floor are at the actor's feet (see `above`). */
const FEET = 8;
interface Surface {
  a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3;
  denominator: number;
  low: number;
  neighbours: Surface[];
  /** The ceiling found at this surface, by floor level (see `level`); each built once. */
  ceilings?: Map<number, Ceiling>;
}
export interface Ceiling {
  /** Lowest edge of the sampled face, so a sloped eave covers the whole overlapping hat. */
  readonly height: number;
  /** Bounds of the connected overhead surface, including its sloped sections. Shared: do not modify. */
  readonly bounds: THREE.Box3;
}

/** Tile cell key; tile coordinates stay far inside ±32768. */
const cellKey = (x: number, z: number) => x * 65536 + z;

/** Static map surfaces indexed in tiles, so checking overhead geometry is cheap while actors move. */
export class Ceilings {
  private readonly cells = new Map<number, Surface[]>();
  /** Every face's lowest height, ascending and distinct (see `level`). */
  private readonly lows: Float64Array;

  constructor(group: THREE.Group) {
    group.updateWorldMatrix(true, true);
    // Faces sharing a vertex (the same x, y and z) are neighbours.
    const vertices = new Map<number, Map<number, Map<number, Surface[]>>>();
    const sharing = (v: THREE.Vector3): Surface[] => {
      let ys = vertices.get(v.x);
      if (!ys) vertices.set(v.x, (ys = new Map()));
      let zs = ys.get(v.y);
      if (!zs) ys.set(v.y, (zs = new Map()));
      let list = zs.get(v.z);
      if (!list) zs.set(v.z, (list = []));
      return list;
    };
    const lows = new Set<number>();
    // The chunk's merged static meshes are direct children; animated props have their own groups.
    for (const object of group.children) {
      if (!(object as THREE.Mesh).isMesh) continue;
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry;
      const positions = geometry.getAttribute('position');
      const index = geometry.index;
      const count = index?.count ?? positions.count;
      const vertex = (n: number) => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(n) : n).applyMatrix4(object.matrixWorld);
      for (let i = 0; i < count; i += 3) {
        const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
        // The face normal's y ((b - a) × (c - a), normalized as Vector3 does): include roof pitches up to 60 degrees;
        // vertical walls cannot be ceilings.
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const overhead = Math.abs(ny * (1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1))) >= 0.5;
        const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        const surface: Surface = { a, b, c, denominator, low: Math.min(a.y, b.y, c.y), neighbours: [] };
        lows.add(surface.low);
        for (const v of [a, b, c]) {
          const adjacent = sharing(v);
          for (const other of adjacent) { other.neighbours.push(surface); surface.neighbours.push(other); }
          adjacent.push(surface);
        }
        if (!overhead) continue; // Side faces extend the bounds, but cannot be ceilings themselves.
        for (let z = Math.floor(Math.min(a.z, b.z, c.z) / CELL); z <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); z++) {
          for (let x = Math.floor(Math.min(a.x, b.x, c.x) / CELL); x <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); x++) {
            const cell = this.cells.get(cellKey(x, z));
            if (cell) cell.push(surface);
            else this.cells.set(cellKey(x, z), [surface]);
          }
        }
      }
    }
    this.lows = Float64Array.from([...lows].sort((p, q) => p - q));
  }

  /**
   * Lowest overhead surface above the floor (`ground`) at x/z. Triangles touching the floor are ramps, not
   * ceilings. On a tile actors can walk (`walkable`, from the collision map) the actor stands under no face
   * lower than half a tile: such a face (the head of a bed overhanging the walkable strip behind it) is at
   * its feet, where its depth plane (billboard.ts) decides the overlap. Over a blocked tile a low face still caps the
   * actor beside it (a conveyor's deck beside the upper floor). Runs per actor, width sample and chunk
   * every frame: it allocates nothing once each surface's ceiling for this floor level exists.
   */
  above(x: number, ground: number, z: number, walkable: boolean): Ceiling | null {
    const clearance = walkable ? FEET : TOUCHING;
    let height = Infinity;
    let found: Surface | undefined;
    const cell = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return null;
    for (const surface of cell) {
      const { a, b, c, denominator } = surface;
      if (surface.low <= ground + clearance) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const y = u * a.y + v * b.y + (1 - u - v) * c.y;
      if (y < height) { height = y; found = surface; }
    }
    return found ? this.ceiling(found, ground) : null;
  }

  /** Pushes the heights of the level and sloped faces at x/z (floors, steps, decks) to `out`. */
  heightsAt(x: number, z: number, out: number[]): void {
    const cell = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return;
    for (const { a, b, c, denominator } of cell) {
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      out.push(u * a.y + v * b.y + (1 - u - v) * c.y);
    }
  }

  /** The connected faces of `surface` above `ground`, built once per floor level. */
  private ceiling(surface: Surface, ground: number): Ceiling {
    surface.ceilings ??= new Map();
    const level = this.level(ground);
    let ceiling = surface.ceilings.get(level);
    if (!ceiling) {
      ceiling = connected(surface, ground);
      surface.ceilings.set(level, ceiling);
    }
    return ceiling;
  }

  /**
   * The number of face heights at or below `ground`. The connected faces depend on the floor only through
   * which faces stay above it, so every floor height on one level has the same ceiling.
   */
  private level(ground: number): number {
    let lo = 0, hi = this.lows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lows[mid]! <= ground) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/**
 * The faces connected to `found` that stay above the floor (`ground`): a deck with its lips and slopes,
 * not the walls or ramps reaching down to the floor.
 */
function connected(found: Surface, ground: number): Ceiling {
  const bounds = new THREE.Box3();
  const seen = new Set<Surface>([found]);
  for (const surface of seen) {
    for (const p of [surface.a, surface.b, surface.c]) bounds.expandByPoint(p);
    for (const next of surface.neighbours) if (next.low > ground) seen.add(next);
  }
  // Include the depth inset below the geometry. Keep its sides and top exact so a nearby
  // low object cannot catch a ray through the hat.
  bounds.min.y -= TOUCHING;
  return { height: found.low, bounds };
}

const indices = new WeakMap<THREE.Group, Ceilings>();
export function ceilingsFor(group: THREE.Group): Ceilings {
  let index = indices.get(group);
  if (!index) { index = new Ceilings(group); indices.set(group, index); }
  return index;
}
