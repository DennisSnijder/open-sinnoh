import type { Facing } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { Actor } from '../npc.ts';
import { TILE } from '../tiles.ts';
import type { Task } from './events.ts';
import type { DistortionWorld } from './feature.ts';
import { isRoom } from './elevator.ts';

/**
 * The boulder puzzle's falls (decomp sBoulderFallLocations, DistWorldFallingBoulder_*): a Strength boulder that
 * stops on B5F's three holes drops to B6F; on B6F it drops into its own pit (the pit's flag unset), or into a wrong
 * or filled pit, which sends it back to B5F.
 */

/** sBoulderFallLocations: room, tile, and the pit's flag (null: a hole to B6F; -1: a wrong pit). */
const FALLS: { room: string; x: number; z: number; pit: number | null }[] = [
  { room: 'B5F', x: 0x4c, z: 0x44, pit: null },
  { room: 'B5F', x: 0x61, z: 0x43, pit: null },
  { room: 'B5F', x: 0x56, z: 0x39, pit: null },
  { room: 'B6F', x: 0x44, z: 0x43, pit: 6 },
  { room: 'B6F', x: 0x4b, z: 0x43, pit: -1 },
  { room: 'B6F', x: 0x4f, z: 0x43, pit: -1 },
  { room: 'B6F', x: 0x60, z: 0x44, pit: 7 },
  { room: 'B6F', x: 0x64, z: 0x44, pit: -1 },
  { room: 'B6F', x: 0x69, z: 0x44, pit: -1 },
  { room: 'B6F', x: 0x55, z: 0x3c, pit: 8 },
  { room: 'B6F', x: 0x55, z: 0x38, pit: -1 },
  { room: 'B6F', x: 0x55, z: 0x39, pit: -1 },
  { room: 'B6F', x: 0x55, z: 0x34, pit: -1 },
  { room: 'B6F', x: 0x55, z: 0x35, pit: -1 },
];

const DELTA: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** By the boulder's local id (MESPRIT/AZELF/UXIE_BOULDER, 128–130 on both floors): its flags, pit object and script. */
const BOULDERS: Record<number, { b5f: number; outside: number; pitObject: number; guardianInB6F: number; script: string }> = {
  128: { b5f: 0, outside: 3, pitObject: 144, guardianInB6F: 15, script: 'DistortionWorldB6F_CoordEvent_MespritBoulderInPit' },
  129: { b5f: 1, outside: 4, pitObject: 145, guardianInB6F: 14, script: 'DistortionWorldB6F_CoordEvent_AzelfBoulderInPit' },
  130: { b5f: 2, outside: 5, pitObject: 146, guardianInB6F: 13, script: 'DistortionWorldB6F_CoordEvent_UxieBoulderInPit' },
};
/** The three pits' flags (DIST_WORLD_PUZZLE_FLAG_*_BOULDER_IN_B6F_PIT). */
const PITS = [6, 7, 8];
/** The holes drop a boulder to MAP_OBJECT_COORD_EDGE_TO_FX32(115). */
const B6F_HEIGHT = 115 * TILE;

function fall(zone: Id, x: number, z: number) {
  return FALLS.find((f) => isRoom(zone, f.room) && f.x === x && f.z === z) ?? null;
}

export function boulderWillFall(zone: Id, b: Actor, dir: Facing): boolean {
  const [dx, dz] = DELTA[dir];
  return fall(zone, b.x + dx, b.z + dz) !== null;
}

function boulder(b: Actor) {
  const r = BOULDERS[b.localId];
  if (!r) throw new Error(`world: object ${b.localId} is no Distortion World boulder`);
  return r;
}

/** DistWorldFallingBoulder_New: the fall of a boulder standing on a fall location, or null. */
export function boulderFall(w: DistortionWorld, b: Actor, pushed: Facing): Task | null {
  const at = fall(w.room.id, b.x, b.z);
  if (!at) return null;
  if (at.pit === null) return toB6F(w, b);
  const flags = w.slot.puzzleFlags;
  return at.pit >= 0 && !(flags & (1 << at.pit)) ? intoPit(w, b, pushed, at.pit) : wrongPit(w, b, pushed);
}

/** DistWorldFallingBoulder_TickToB6F: 8 units a frame down to B6F's height; it is B6F's boulder now. */
function* toB6F(w: DistortionWorld, b: Actor): Task {
  for (;;) {
    b.y -= 8;
    if (b.y <= B6F_HEIGHT) break;
    yield;
  }
  w.h.sound.playNamed('SEQ_SE_DP_UG_008');
  b.y = B6F_HEIGHT;
  b.zone = w.zoneOf('B6F');
  w.h.rekeyObjects();
  const r = boulder(b);
  w.slot.puzzleFlags = (w.slot.puzzleFlags | (1 << r.outside)) & ~(1 << r.b5f);
}

/** The first two states of a pit fall: a tile on in the push direction and down, 2 units a frame, then 4 down. */
function* tipOver(b: Actor, pushed: Facing): Task {
  const [dx, dz] = DELTA[pushed];
  for (let i = 1; i <= 8; i++) {
    b.y -= 2;
    b.offset[0] = dx * 2 * i;
    b.offset[2] = dz * 2 * i;
    yield;
  }
  for (let i = 1; i <= 4; i++) {
    b.y -= 4;
    if (i < 4) yield;
  }
}

/** DistWorldFallingBoulder_TickToCorrectPit: it fills the pit, shakes, the guardian's scene plays; three pits finish the puzzle. */
function* intoPit(w: DistortionWorld, b: Actor, pushed: Facing, pit: number): Task {
  const r = boulder(b);
  const [dx, dz] = DELTA[pushed];
  const y = b.y;
  yield* tipOver(b, pushed);
  w.slot.puzzleFlags = (w.slot.puzzleFlags | (1 << pit)) & ~(1 << r.outside);
  b.localId = r.pitObject;
  b.x += dx;
  b.z += dz;
  b.offset[0] = b.offset[2] = 0;
  b.y = y - 4 * 8;
  w.h.rekeyObjects();
  w.h.sound.playNamed('SEQ_SE_DP_UG_008');
  yield;
  const base = b.offset[1];
  let shake = 1;
  for (let step = 1; ; step++) {
    b.offset[1] = base + shake;
    shake = -shake;
    if (step === 7) shake = 0;
    if (step >= 32) break;
    yield;
  }
  w.slot.puzzleFlags &= ~(1 << r.guardianInB6F);
  w.h.startScript(w.label(r.script));
  yield;
  while (w.h.scriptRunning()) yield;
  if (PITS.every((p) => w.slot.puzzleFlags & (1 << p))) w.setFlag('FLAG_DISTORTION_WORLD_PUZZLE_FINISHED');
}

/** DistWorldFallingBoulder_TickToWrongPit: it drops out of sight (40 frames) and is back on B5F. */
function* wrongPit(w: DistortionWorld, b: Actor, pushed: Facing): Task {
  const r = boulder(b);
  yield* tipOver(b, pushed);
  yield;
  for (let i = 1; i <= 40; i++) {
    b.y -= 8;
    if (i < 40) yield;
  }
  w.slot.puzzleFlags = (w.slot.puzzleFlags | (1 << r.b5f)) & ~(1 << r.outside);
  w.h.deleteObject(b);
}
