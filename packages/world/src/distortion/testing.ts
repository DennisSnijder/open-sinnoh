/**
 * An original Distortion World room on the fixture pack, for world tests (no ROM data): the Grotto's matrix
 * placed at offset (8, 18, 8), so its open floor (matrix tiles 4–27) is shared tiles 12–35 at height 18 (288
 * units), with supports of every kind around it, jump points between them and the land, a JUMP_EAST_TWICE tile,
 * and a second room below as the next floor.
 *
 *   west wall   support 0: x 15, y 19–22, z 20–23 (blocked at y 20, z 22); jumps from the land (16, 18, 21)
 *               pressing left, and back to (16, 18, 21) pressing down at (15, 19, 21)
 *   floors      supports 1 and 2: x 20–23 and 24–27, y 20, z 14–17; jumps from the land (20, 18, 18) pressing
 *               up to (20, 20, 17), and back pressing down there
 *   ceiling     support 3: x 28–31, y 24, z 20–23; a jump from the land (29, 18, 19) pressing down to (29, 24, 20)
 *   east wall   support 4: x 33, y 19–22, z 26–29; a jump from the land (32, 18, 27) pressing right to (33, 19, 27)
 *   land        JUMP_EAST_TWICE at (18, 18, 32); pressing down at (16, 18, 23) rolls the camera a quarter turn
 *   elevator    platform 0 at (14, 18, 14) rides path 0 down 8 tiles to the room below (changing floors after 4);
 *               the room below's platform 0 at (14, 10, 14), placed by platform flag 0, rides path 1 back up
 */
import type { Chunk, DistortionRoom, DistortionWorldTables, DwBox, DwJump, DwSupport, DwSupportKind, NewGame, Registries, Zone } from '@opensinnoh/contracts';
import { DW_PROP_KINDS } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { f, registries } from '../testing.ts';
import { CELL_COLLISION } from './support.ts';

export const DW_ROOM = f('DW_ROOM');
export const DW_BELOW = f('DW_BELOW');
export const JUMP_EAST_TWICE_BYTE = 0xf0;
export const DW_ON_TRANSITION = f('DwRoom_OnTransition');

const box = (x: number, y: number, z: number, sizeX: number, sizeY: number, sizeZ: number): DwBox => ({ x, y, z, sizeX, sizeY, sizeZ });
const support = (kind: DwSupportKind, b: DwBox, blocked: number[] = []): DwSupport => ({ kind, box: b, vertical: 4, horizontal: 4, cells: Array.from({ length: 16 }, (_, i) => (blocked.includes(i) ? CELL_COLLISION : 0)) });
const jump = (at: [number, number, number], facing: DwJump['facing'], d: [number, number, number], rotation: number, finalFacing: DwJump['finalFacing'], to: DwJump['to'], s: number | null): DwJump => ({
  facing,
  box: box(at[0], at[1], at[2], 0, 0, 0),
  displacement: { x: d[0], y: d[1], z: d[2] },
  spriteRotation: rotation,
  steps: 16,
  axis: 'y',
  inverted: false,
  finalFacing,
  to,
  support: s,
});

export function jumpRoom(): DistortionRoom {
  return {
    id: DW_ROOM,
    offset: { x: 8, altitude: 18, z: 8 },
    previous: null,
    next: DW_BELOW,
    supports: [
      // West wall grid: v = sizeY − (y − 19), h = z − 20; (y 20, z 22) is v 2, h 2.
      support('west-wall', box(15, 19, 20, 0, 3, 3), [2 + 4 * 2]),
      support('floor', box(20, 20, 14, 3, 0, 3)),
      support('floor', box(24, 20, 14, 3, 0, 3)),
      support('ceiling', box(28, 24, 20, 3, 0, 3)),
      support('east-wall', box(33, 19, 26, 0, 3, 3)),
    ],
    jumps: [
      jump([16, 18, 21], 'left', [-1, 1, 0], 90, 'left', 'west-wall', 0),
      jump([15, 19, 21], 'down', [1, -1, 0], -90, 'right', 'land', null),
      jump([20, 18, 18], 'up', [0, 2, -1], 0, 'up', 'floor', 1),
      jump([20, 20, 17], 'down', [0, -2, 1], 0, 'down', 'land', null),
      jump([29, 18, 19], 'down', [0, 6, 1], 180, 'up', 'ceiling', 3),
      jump([32, 18, 27], 'right', [1, 1, 0], -90, 'right', 'east-wall', 4),
    ],
    // Pressing down at (16, 18, 23): the camera rolls a quarter turn (64/256) in 8 frames.
    cameraRows: [{ box: box(16, 18, 23, 0, 0, 0), facing: 'down', angle: { x: 0, y: 0, z: 64 }, steps: 8 }],
    ghosts: null,
    movingPlatforms: [{ index: 0, x: 14, y: 18, z: 14, elevator: { path: 0, direction: 'down' }, destination: 0, prop: 'medium-elevator-platform-1', flag: null }],
    events: [],
    props: [],
    objects: [],
  };
}

/** Every prop kind drawn with one fixture model, standing 25 units below its anchor (the platforms' offset); portals loop a 4-frame clip. */
const PROPS = Object.fromEntries(DW_PROP_KINDS.map((k) => [k, { model: f('MODEL_ROOM'), offset: [0, -25, -6], clip: k === 'portal' ? { name: 'anim', frames: 4 } : null }])) as unknown as DistortionWorldTables['props'];

const PATHS = [
  { next: null, finalOffset: { x: 0, y: -8, z: 0 }, changeMapsOffset: { x: 0, y: -4, z: 0 }, step: { x: 0, y: -16384, z: 0 }, setFlag: 0, clearFlag: null },
  { next: null, finalOffset: { x: 0, y: 8, z: 0 }, changeMapsOffset: { x: 0, y: 4, z: 0 }, step: { x: 0, y: 16384, z: 0 }, setFlag: null, clearFlag: 0 },
];

/** The fixture registries with the two rooms, their zones, the double-jump behaviour and the tables. */
export function distortionRegistries(room = jumpRoom()): Registries {
  const copy = <K extends keyof Registries>(k: K) => new Map(registries[k]) as Map<Id, Registries[K] extends ReadonlyMap<Id, infer V> ? V : never>;
  const zones = copy('zones');
  const grotto = zones.get(f('GROTTO'))!;
  const chunks = copy('chunks');
  const base = chunks.get(f('CHUNK_GROTTO'))!;
  const tiles = [...base.tiles];
  tiles[(18 - 8) + (32 - 8) * 32] = JUMP_EAST_TWICE_BYTE;
  chunks.set(f('CHUNK_DW'), { ...base, id: f('CHUNK_DW'), tiles } satisfies Chunk);
  const matrices = copy('matrices');
  matrices.set(f('MATRIX_DW'), { ...matrices.get(f('MATRIX_GROTTO'))!, id: f('MATRIX_DW'), chunks: [f('CHUNK_DW')] });
  const dwZone = (id: Id): Zone => ({ ...grotto, id, matrix: f('MATRIX_DW'), mapScripts: { onTransition: DW_ON_TRANSITION, onFrame: [] }, events: { bgs: [], objects: [], warps: [], coords: [] } });
  zones.set(DW_ROOM, dwZone(DW_ROOM));
  zones.set(DW_BELOW, dwZone(DW_BELOW));
  const rooms = new Map<Id, DistortionRoom>([
    [DW_ROOM, room],
    [
      DW_BELOW,
      {
        ...jumpRoom(),
        id: DW_BELOW,
        offset: { x: 8, altitude: 10, z: 8 },
        previous: DW_ROOM,
        next: null,
        supports: [],
        jumps: [],
        movingPlatforms: [{ index: 0, x: 14, y: 10, z: 14, elevator: { path: 1, direction: 'up' }, destination: 0, prop: 'medium-elevator-platform-1', flag: 0 }],
      },
    ],
  ]);
  const behaviours = copy('tileBehaviors');
  behaviours.set(f('TILE_BEHAVIOR_JUMP_EAST_TWICE'), { id: f('TILE_BEHAVIOR_JUMP_EAST_TWICE'), sourceIndex: JUMP_EAST_TWICE_BYTE, name: 'JUMP_EAST_TWICE' });
  const flags = copy('flags');
  for (const name of ['FLAG_DISTORTION_WORLD_PUZZLE_FINISHED', 'FLAG_DISTORTION_WORLD_STEPPING_STONES', 'FLAG_DISTORTION_WORLD_GIRATINA_SHADOW_1', 'FLAG_DISTORTION_WORLD_GIRATINA_SHADOW_2']) flags.set(f(name), { id: f(name), initial: false, scope: 'saved' });
  const vars = copy('vars');
  for (const name of ['VAR_DISTORTION_WORLD_PROGRESS', 'VAR_DISTORTION_WORLD_CYRUS_APPEARANCE']) vars.set(f(name), { id: f(name), initial: 0, scope: 'saved' });
  const newGames = copy('newGame');
  const ng = [...newGames.values()][0]!;
  newGames.set(ng.id, { ...ng, distortionWorld: { elevatorPaths: PATHS, cascadeUp: [], cascadeDown: [], props: PROPS, sky: { background: f('sky.png'), clouds: [] }, playerSprite: ng.playerSprite, playerSurfSprite: ng.playerSurfSprite } } satisfies NewGame);
  return { ...registries, zones, chunks, matrices, distortionRooms: rooms, tileBehaviors: behaviours, flags, vars, newGame: newGames };
}
