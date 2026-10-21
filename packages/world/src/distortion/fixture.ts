import type { DistortionRoom, DwBox, DwSupport, DwSupportKind } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { CELL_COLLISION } from './support.ts';

/**
 * An original four-surface Distortion World room for tests (no ROM data): floors, both walls and a ceiling
 * around one 4×4 tile block, a second floor beside the first, and a third floor stacked over the first (the
 * same x/z, five tiles up). Every cell's behaviour byte is its grid position `v + 4h` unless marked, so a test
 * can read back which cell a tile maps to.
 *
 *   floor A    x 10–13, y 20, z 10–13 (support 0): blocked at (12, 20, 11), water at (10, 20, 13), a double
 *              jump east at (13, 20, 10)
 *   floor B    x 14–17, y 20, z 10–13 (support 1)
 *   west wall  x 9, y 21–24, z 10–13 (support 2)
 *   east wall  x 18, y 21–24, z 10–13 (support 3)
 *   ceiling    x 10–13, y 26, z 10–13 (support 4)
 *   floor C    x 10–13, y 25, z 10–13 (support 5)
 */
export const FIXTURE_BEHAVIOURS = { water: 0x20, jumpEastTwice: 0x21 } as const;

/** The behaviour names the fixture's bytes stand for (other bytes: plain ground). */
export function fixtureBehaviour(byte: number): string {
  if (byte === FIXTURE_BEHAVIOURS.water) return 'DEEP_WATER';
  if (byte === FIXTURE_BEHAVIOURS.jumpEastTwice) return 'JUMP_EAST_TWICE';
  return 'NONE';
}

const box = (x: number, y: number, z: number, sizeX: number, sizeY: number, sizeZ: number): DwBox => ({ x, y, z, sizeX, sizeY, sizeZ });

function support(kind: DwSupportKind, b: DwBox, marks: Record<number, number> = {}): DwSupport {
  const cells = Array.from({ length: 16 }, (_, i) => marks[i] ?? i);
  return { kind, box: b, vertical: 4, horizontal: 4, cells };
}

export function fourSurfaceRoom(id: Id = 'test:DW_ROOM' as Id): DistortionRoom {
  // floor A: v = x − 10, h = z − 10.
  const floorA = support('floor', box(10, 20, 10, 3, 0, 3), { [2 + 4 * 1]: CELL_COLLISION | (2 + 4), [0 + 4 * 3]: FIXTURE_BEHAVIOURS.water, [3 + 4 * 0]: FIXTURE_BEHAVIOURS.jumpEastTwice });
  return {
    id,
    offset: { x: 8, altitude: 18, z: 8 },
    previous: null,
    next: null,
    supports: [
      floorA,
      support('floor', box(14, 20, 10, 3, 0, 3)),
      support('west-wall', box(9, 21, 10, 0, 3, 3)),
      support('east-wall', box(18, 21, 10, 0, 3, 3)),
      support('ceiling', box(10, 26, 10, 3, 0, 3)),
      support('floor', box(10, 25, 10, 3, 0, 3)),
    ],
    jumps: [],
    cameraRows: [],
    ghosts: null,
    movingPlatforms: [],
    events: [],
    props: [],
    objects: [],
  };
}
