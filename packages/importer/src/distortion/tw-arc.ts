/**
 * The Distortion World archives (decomp overlay 9, `ov9_02249960.c`; docs/research/distortion-world.md):
 *
 * - `fielddata/tornworld/tw_arc.narc`: member 0 is the map-info list (u32 count, then 12-byte records
 *   `u32 map header, u16 room file, s16 tile X, altitude, tile Z offsets`); room file n is member n + 1.
 *   A room file is a 20-byte header (`u32 unknown, u32 byte size of the supports, jump-point, camera and
 *   ghost-prop sections`) and the four sections back to back, each a u32 count and fixed-size records.
 * - `fielddata/tornworld/tw_arc_attr.narc`: one u16 terrain grid per support (`tw-attr.ts`).
 * - `data/tw_arc_etc.narc`: the sky (`tw-etc.ts`).
 *
 * Everything is checked at this boundary: section sizes against counts, every enum against the values
 * the overlay's code handles. Values stay in their source units (tiles; altitude and Y in whole tiles);
 * the `unknown*` fields are the decomp's dummies, kept as read.
 */
import { Reader } from '@opensinnoh/nds';

export class DistortionFormatError extends Error {}

const fail = (where: string, what: string): never => {
  throw new DistortionFormatError(`${where}: ${what}`);
};

/** Decomp `DistWorldBounds`: start tile X/Y/Z and sizes. A tile is inside when start ≤ t ≤ start + size (both ends). */
export interface DwBounds {
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

/** Decomp `FloatingPlatformKind` 0–3, in order. */
export const SUPPORT_KINDS = ['floor', 'west-wall', 'east-wall', 'ceiling'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];
/** Decomp `FaceDirection` 0–3 (FACE_UP, DOWN, LEFT, RIGHT). */
export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** The jump's sprite-offset axis (decomp `AXIS_X/Y/Z`). */
export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];
/** `sFloatingPlatformJumpPointHandlers` has one entry: the jump task. Any other index is rejected. */
export const JUMP_HANDLERS = ['jump'] as const;

export interface DwMapInfo {
  mapHeader: number;
  /** Room file index: the room's tw_arc member is `file + 1`. */
  file: number;
  /** Where the room's tiles sit in the shared world space (tiles; altitude in whole tiles). */
  offset: { x: number; altitude: number; z: number };
}

/** A floating platform: one surface of one orientation and its terrain grid. */
export interface DwSupport {
  kind: SupportKind;
  /** tw_arc_attr member. */
  attr: number;
  bounds: DwBounds;
  tilesVertical: number;
  tilesHorizontal: number;
}

/** A directed jump from one support to another (decomp `DistWorldFloatingPlatformJumpPointTemplate`). */
export interface DwJumpPoint {
  handler: (typeof JUMP_HANDLERS)[number];
  /** The facing the player needs, standing in `bounds`. */
  facing: Direction;
  /** Decomp `dummy04` (never read). */
  unknown04: number;
  bounds: DwBounds;
  /** Tiles moved on each axis over `steps` frames (the map-object Y, in half tiles, moves by twice `y`). */
  displacement: { x: number; y: number; z: number };
  /** Degrees the sprite turns by (added mod 360; the rotator plays it as frames of fldeff member 197). */
  spriteRotation: number;
  /** Frames of the jump. */
  steps: number;
  axis: Axis;
  inverted: boolean;
  finalFacing: Direction;
  /** The destination support's kind, or `land` (kind 4, decomp FLOATING_PLATFORM_KIND_INVALID): back on the ordinary map. */
  toKind: SupportKind | 'land';
  /** The destination support's index in this room; null for `land` (stored 0xFFFF). */
  toSupport: number | null;
}

/** A camera angle row: the first row whose bounds and facing match the player is used. */
export interface DwCameraRow {
  bounds: DwBounds;
  /** Camera angle offsets in 1/256 turns (× 0x100 = DS binary angle), added to the base camera. */
  angle: { x: number; y: number; z: number };
  facing: Direction;
  /** Frames of the transition. */
  steps: number;
}

export interface DwGhostProp {
  group: number;
  /** Decomp `PropKind` (props.ts). */
  kind: number;
  x: number;
  y: number;
  z: number;
}

export interface DwGhostTrigger {
  group: number;
  facing: Direction;
  show: boolean;
  bounds: DwBounds;
}

export interface DwGhostProps {
  /** Bit n set: group n is visible on first entry. */
  defaultVisible: number;
  props: DwGhostProp[];
  triggers: DwGhostTrigger[];
}

export interface DwRoomFile {
  /** Decomp `dummy00` of the room file header (never read). */
  unknown00: number;
  supports: DwSupport[];
  jumpPoints: DwJumpPoint[];
  cameraRows: DwCameraRow[];
  ghostProps: DwGhostProps | null;
}

const MAP_INFO_SIZE = 12;
const HEADER_SIZE = 20;
const SUPPORT_SIZE = 20;
const JUMP_SIZE = 40;
const CAMERA_SIZE = 24;
const GHOST_HEADER_SIZE = 12;
const GHOST_PROP_SIZE = 12;
const GHOST_TRIGGER_SIZE = 20;
/** Decomp `PROP_KIND_COUNT`. */
export const PROP_KIND_COUNT = 25;

const enumAt = <T>(list: readonly T[], v: number, where: string, what: string): T => list[v] ?? fail(where, `${what} ${v} is not one of 0–${list.length - 1}`);

function bounds(r: Reader, o: number): DwBounds {
  return { x: r.i16(o), y: r.i16(o + 2), z: r.i16(o + 4), sizeX: r.i16(o + 6), sizeY: r.i16(o + 8), sizeZ: r.i16(o + 10) };
}

export function readMapInfo(bytes: Uint8Array): DwMapInfo[] {
  const r = new Reader(bytes);
  const count = r.i32(0);
  if (count < 0 || bytes.length !== 4 + count * MAP_INFO_SIZE) fail('tw_arc map info', `${bytes.length} bytes for ${count} records`);
  return Array.from({ length: count }, (_, i) => {
    const o = 4 + i * MAP_INFO_SIZE;
    return { mapHeader: r.u32(o), file: r.u16(o + 4), offset: { x: r.i16(o + 6), altitude: r.i16(o + 8), z: r.i16(o + 10) } };
  });
}

/** One section: a u32 count and `size`-byte records filling exactly `length` bytes (0 = absent). */
function section<T>(r: Reader, start: number, length: number, size: number, where: string, read: (o: number, i: number) => T): T[] {
  if (length === 0) return [];
  const count = r.i32(start);
  if (count < 0 || length !== 4 + count * size) fail(where, `${length} bytes for ${count} records of ${size}`);
  return Array.from({ length: count }, (_, i) => read(start + 4 + i * size, i));
}

export function readRoomFile(bytes: Uint8Array, where = 'tw_arc room'): DwRoomFile {
  const r = new Reader(bytes);
  const sizes = [4, 8, 12, 16].map((o) => r.i32(o));
  if (sizes.some((s) => s < 0) || HEADER_SIZE + sizes.reduce((a, b) => a + b, 0) !== bytes.length) fail(where, `section sizes ${sizes.join('+')} do not fill ${bytes.length - HEADER_SIZE} bytes`);
  const [supportLen, jumpLen, cameraLen, ghostLen] = sizes as [number, number, number, number];
  const supportAt = HEADER_SIZE;
  const jumpAt = supportAt + supportLen;
  const cameraAt = jumpAt + jumpLen;
  const ghostAt = cameraAt + cameraLen;
  const supports = section(r, supportAt, supportLen, SUPPORT_SIZE, `${where} supports`, (o, i) => ({
    kind: enumAt(SUPPORT_KINDS, r.i16(o), `${where} support ${i}`, 'kind'),
    attr: r.u16(o + 2),
    bounds: bounds(r, o + 4),
    tilesVertical: r.u16(o + 16),
    tilesHorizontal: r.u16(o + 18),
  }));
  const jumpPoints = section(r, jumpAt, jumpLen, JUMP_SIZE, `${where} jump points`, (o, i): DwJumpPoint => {
    const at = `${where} jump point ${i}`;
    const inverted = r.u16(o + 32);
    if (inverted > 1) fail(at, `inverted ${inverted}`);
    const kind = r.i16(o + 36);
    const index = r.u16(o + 38);
    const toKind: DwJumpPoint['toKind'] = kind === SUPPORT_KINDS.length ? 'land' : enumAt(SUPPORT_KINDS, kind, at, 'destination kind');
    // A jump lands on a support of the kind it names, or (kind 4, index 0xFFFF) back on the land.
    if (toKind === 'land' ? index !== 0xffff : supports[index]?.kind !== toKind) fail(at, `lands on ${toKind} support ${index} (${supports.length} supports)`);
    return {
      handler: enumAt(JUMP_HANDLERS, r.u16(o), at, 'handler'),
      facing: enumAt(DIRECTIONS, r.i16(o + 2), at, 'facing'),
      unknown04: r.i32(o + 4),
      bounds: bounds(r, o + 8),
      displacement: { x: r.i16(o + 20), y: r.i16(o + 22), z: r.i16(o + 24) },
      spriteRotation: r.i16(o + 26),
      steps: r.i16(o + 28),
      axis: enumAt(AXES, r.u16(o + 30), at, 'axis'),
      inverted: inverted === 1,
      finalFacing: enumAt(DIRECTIONS, r.i16(o + 34), at, 'final facing'),
      toKind,
      toSupport: toKind === 'land' ? null : index,
    };
  });
  const cameraRows = section(r, cameraAt, cameraLen, CAMERA_SIZE, `${where} camera rows`, (o, i) => ({
    bounds: bounds(r, o),
    angle: { x: r.u16(o + 12), y: r.u16(o + 14), z: r.u16(o + 16) },
    facing: enumAt(DIRECTIONS, r.i16(o + 18), `${where} camera row ${i}`, 'facing'),
    steps: r.i32(o + 20),
  }));
  return { unknown00: r.i32(0), supports, jumpPoints, cameraRows, ghostProps: ghostLen ? readGhostProps(r, ghostAt, ghostLen, `${where} ghost props`) : null };
}

function readGhostProps(r: Reader, at: number, length: number, where: string): DwGhostProps {
  const props = r.i32(at);
  const triggers = r.i32(at + 4);
  if (props < 0 || triggers < 0 || length !== GHOST_HEADER_SIZE + props * GHOST_PROP_SIZE + triggers * GHOST_TRIGGER_SIZE) fail(where, `${length} bytes for ${props} props and ${triggers} triggers`);
  const propAt = at + GHOST_HEADER_SIZE;
  const triggerAt = propAt + props * GHOST_PROP_SIZE;
  return {
    defaultVisible: r.u32(at + 8),
    props: Array.from({ length: props }, (_, i) => {
      const o = propAt + i * GHOST_PROP_SIZE;
      const kind = r.u16(o + 4);
      if (kind >= PROP_KIND_COUNT) fail(`${where} prop ${i}`, `prop kind ${kind}`);
      return { group: r.u32(o), kind, x: r.i16(o + 6), y: r.i16(o + 8), z: r.i16(o + 10) };
    }),
    triggers: Array.from({ length: triggers }, (_, i) => {
      const o = triggerAt + i * GHOST_TRIGGER_SIZE;
      const show = r.i16(o + 6);
      if (show !== 0 && show !== 1) fail(`${where} trigger ${i}`, `show ${show}`);
      return { group: r.u32(o), facing: enumAt(DIRECTIONS, r.i16(o + 4), `${where} trigger ${i}`, 'facing'), show: show === 1, bounds: bounds(r, o + 8) };
    }),
  };
}
