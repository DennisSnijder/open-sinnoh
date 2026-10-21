/**
 * The Distortion World tables compiled into overlay 9 (decomp `src/overlay009/ov9_02249960.c`), read
 * from the overlay at offsets the importer pins by SHA-1 (platinum.ts `TABLES.distortionWorld`):
 *
 * - `sDistWorldMapConnectionList`: 10 × `{u32 current, previous, next map header}` (the floor kept loaded
 *   above and below); `MAP_HEADER_COUNT` means none.
 * - `sMovingPlatformsMapTemplates`: 8 × `{u32 map header, pointer to a NULL-ended pointer list}` of
 *   24-byte `DistWorldMovingPlatformTemplate`s.
 * - `sElevatorPlatformPaths`: 22 × 32-byte `DistWorldElevatorPlatformPath`.
 * - `sMapEvents`: `{u32 map header, pointer to 16-byte DistWorldEvent[]}` until `MAP_HEADER_COUNT`; each
 *   event points at `{u32 kind, pointer to params}` commands ending in `EVENT_CMD_END`.
 * - `sSimplePropsMapTemplates`: the same shape, 16-byte `DistWorldSimplePropTemplate`s ending in
 *   `PROP_KIND_INVALID`.
 * - `sMapObjectEvents`: the same shape, a NULL-ended pointer list of 40-byte `DistWorldObjectEvent`s
 *   (condition, rotation, then an ordinary 32-byte `ObjectEvent` whose Y is fx32).
 *
 * Pointers are RAM addresses; each must land inside the pinned region, or the import fails.
 */
import { Reader } from '@opensinnoh/nds';
import { DIRECTIONS, DistortionFormatError, PROP_KIND_COUNT, type Direction } from './tw-arc.ts';

const fail = (where: string, what: string): never => {
  throw new DistortionFormatError(`${where}: ${what}`);
};

/** Where each table starts, as overlay byte offsets. */
export interface Overlay9Layout {
  connections: number;
  movingPlatforms: number;
  elevatorPaths: number;
  mapEvents: number;
  simpleProps: number;
  objectEvents: number;
  /** `sMapEventB5F_Waterfall` and `sMapEventB4F_Waterfall`: the command lists the waterfall entry runs (the entry tiles are code constants). */
  cascadeUp: number;
  cascadeDown: number;
}

/** Decomp `FlagCondition`, in order. */
export const CONDITIONS = ['none', 'boulder-puzzle-false', 'boulder-puzzle-true', 'progress-eq', 'progress-leq', 'progress-geq', 'manual-add-only', 'giratina-shadow', 'cyrus-appearance'] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Decomp `MovingPlatformElevatorDirection`. */
export const ELEVATOR_DIRECTIONS = ['up', 'down', 'none'] as const;
/** Decomp `EventCmdKind` 0–17; `EVENT_CMD_END` (18) ends a list. */
export const EVENT_COMMANDS = [
  'set-map-object-animation',
  'move-platform',
  'add-map-object',
  'delete-map-object',
  'cascade-up',
  'start-script',
  'set-progress',
  'show-giratina-shadow',
  'set-giratina-animation-flag',
  'set-puzzle-flag',
  'cascade-down',
  'play-giratina-arrival',
  'show-uxie-boulder-tutorial',
  'show-azelf-boulder-tutorial',
  'show-mesprit-boulder-tutorial',
  'show-giratina-room-platforms',
  'hide-giratina-room-platforms',
  'clear-puzzle-flag',
] as const;
export type EventCommandKind = (typeof EVENT_COMMANDS)[number];
const EVENT_CMD_END = EVENT_COMMANDS.length;

export const CONNECTION_COUNT = 10;
export const MOVING_PLATFORM_MAPS = 8;
export const ELEVATOR_PATH_COUNT = 22;
/** Decomp `DIST_WORLD_PLATFORM_FLAG_COUNT` (= INVALID) and `DIST_WORLD_PUZZLE_FLAG_COUNT`. */
export const PLATFORM_FLAG_COUNT = 11;
export const PUZZLE_FLAG_COUNT = 17;

const CONNECTION_SIZE = 12;
const MAP_ENTRY_SIZE = 8;
const ELEVATOR_PATH_SIZE = 32;
const EVENT_SIZE = 16;
const COMMAND_SIZE = 8;
const SIMPLE_PROP_SIZE = 16;

export interface DwConnection {
  mapHeader: number;
  previous: number | null;
  next: number | null;
}

export interface DwMovingPlatform {
  index: number;
  x: number;
  y: number;
  z: number;
  /** Elevator path, or null for a platform that only moves by events. */
  elevatorPath: number | null;
  elevatorDirection: (typeof ELEVATOR_DIRECTIONS)[number];
  /** Decomp `destIndex`. */
  destination: number;
  /** Decomp `PropKind`. */
  prop: number;
  /** Persisted platform flag (bit) placing it, or null. */
  flag: number | null;
}

/** fx32 values as stored (4096 = one unit, a tile is 16 units). */
export interface Fx32Vec {
  x: number;
  y: number;
  z: number;
}

export interface DwElevatorPath {
  next: number | null;
  /** Tiles from the start: the end, and where the logical map changes. */
  finalOffset: { x: number; y: number; z: number };
  changeMapsOffset: { x: number; y: number; z: number };
  step: Fx32Vec;
  setFlag: number | null;
  clearFlag: number | null;
}

export type DwEventCommand =
  | { kind: 'set-map-object-animation'; localId: number; action: number }
  | { kind: 'move-platform'; platform: number; movePlayer: boolean; unknown04: number; finalOffset: { x: number; y: number; z: number }; step: Fx32Vec }
  | { kind: 'add-map-object'; mapHeader: number; localId: number }
  | { kind: 'delete-map-object'; localId: number }
  | { kind: 'cascade-up' | 'cascade-down'; axis: number; direction: number; finishingFix: { x: number; y: number; z: number }; finalOffset: { x: number; y: number; z: number }; mapLoadOffset: { x: number; y: number; z: number }; step: Fx32Vec }
  | { kind: 'start-script'; script: number }
  | { kind: 'set-progress'; progress: number }
  | { kind: 'show-giratina-shadow'; x: number; y: number; z: number; rotation: number; sound: number; scale: Fx32Vec; step: Fx32Vec; steps: number }
  | { kind: 'set-giratina-animation-flag'; animation: number }
  | { kind: 'set-puzzle-flag' | 'clear-puzzle-flag'; flag: number }
  | { kind: 'play-giratina-arrival' | 'show-uxie-boulder-tutorial' | 'show-azelf-boulder-tutorial' | 'show-mesprit-boulder-tutorial' | 'show-giratina-room-platforms' | 'hide-giratina-room-platforms' };

export interface DwEvent {
  x: number;
  y: number;
  z: number;
  condition: Condition;
  value: number;
  commands: DwEventCommand[];
}

export interface DwSimpleProp {
  /** Decomp `dummy00` (never read). */
  unknown00: number;
  prop: number;
  x: number;
  y: number;
  z: number;
  condition: Condition;
  value: number;
}

export interface DwObject {
  condition: Condition;
  value: number;
  rotated: boolean;
  rotation: number;
  localId: number;
  gfx: number;
  movementType: number;
  trainerType: number;
  hiddenFlag: number;
  /** Script id, relative to the room's script file like an ordinary object's. */
  script: number;
  facing: Direction;
  data: [number, number, number];
  range: { x: number; z: number };
  x: number;
  z: number;
  /** fx32 world height as stored (tile Y × 16 × 4096). */
  y: number;
}

export interface DwOverlayTables {
  connections: DwConnection[];
  movingPlatforms: { mapHeader: number; platforms: DwMovingPlatform[] }[];
  elevatorPaths: DwElevatorPath[];
  events: { mapHeader: number; events: DwEvent[] }[];
  simpleProps: { mapHeader: number; props: DwSimpleProp[] }[];
  objects: { mapHeader: number; objects: DwObject[] }[];
  cascadeUp: DwEventCommand[];
  cascadeDown: DwEventCommand[];
}

/**
 * `region` is the pinned slice of the overlay, `regionStart` its offset in the overlay and `ramBase`
 * the overlay's load address; `layout` gives overlay offsets. `mapCount` is MAP_HEADER_COUNT (the
 * tables' "none").
 */
export function readOverlayTables(region: Uint8Array, regionStart: number, ramBase: number, layout: Overlay9Layout, mapCount: number): DwOverlayTables {
  const r = new Reader(region);
  const at = (overlayOffset: number) => overlayOffset - regionStart;
  const ptr = (value: number, where: string) => {
    const o = value - ramBase - regionStart;
    if (o < 0 || o >= region.length) fail(where, `pointer 0x${value.toString(16)} outside the pinned region`);
    return o;
  };
  const map = (v: number, where: string) => (v < mapCount ? v : fail(where, `map header ${v}`));
  const optMap = (v: number, where: string) => (v === mapCount ? null : map(v, where));
  const condition = (v: number, where: string) => CONDITIONS[v] ?? fail(where, `condition ${v}`);
  const prop = (v: number, where: string) => (v < PROP_KIND_COUNT ? v : fail(where, `prop kind ${v}`));
  const platformFlag = (v: number, where: string) => (v === PLATFORM_FLAG_COUNT ? null : v < PLATFORM_FLAG_COUNT ? v : fail(where, `platform flag ${v}`));
  const xyz = (o: number) => ({ x: r.i16(o), y: r.i16(o + 2), z: r.i16(o + 4) });
  const fx = (o: number): Fx32Vec => ({ x: r.i32(o), y: r.i32(o + 4), z: r.i32(o + 8) });
  /** `{u32 map header, pointer}` rows until MAP_HEADER_COUNT (or exactly `count` rows). */
  const mapRows = <T>(start: number, where: string, read: (o: number, header: number) => T, count?: number) => {
    const out: { mapHeader: number; value: T }[] = [];
    for (let o = at(start); ; o += MAP_ENTRY_SIZE) {
      if (count !== undefined && out.length === count) return out;
      const header = r.u32(o);
      if (count === undefined && header === mapCount) {
        if (r.u32(o + 4) !== 0) fail(where, 'terminator with a pointer');
        return out;
      }
      out.push({ mapHeader: map(header, where), value: read(ptr(r.u32(o + 4), `${where} ${header}`), header) });
    }
  };
  /** A NULL-ended list of pointers. */
  const pointerList = (o: number, where: string) => {
    const out: number[] = [];
    for (; r.u32(o) !== 0; o += 4) out.push(ptr(r.u32(o), `${where} ${out.length}`));
    return out;
  };

  const connections = Array.from({ length: CONNECTION_COUNT }, (_, i) => {
    const o = at(layout.connections) + i * CONNECTION_SIZE;
    const where = `sDistWorldMapConnectionList ${i}`;
    return { mapHeader: map(r.u32(o), where), previous: optMap(r.u32(o + 4), where), next: optMap(r.u32(o + 8), where) };
  });

  const movingPlatforms = mapRows(
    layout.movingPlatforms,
    'sMovingPlatformsMapTemplates',
    (list, header) =>
      pointerList(list, `moving platforms ${header}`).map((o, i): DwMovingPlatform => {
        const where = `moving platform ${header}/${i}`;
        const path = r.u16(o + 8);
        const dir = r.u16(o + 10);
        if (path > ELEVATOR_PATH_COUNT) fail(where, `elevator path ${path}`);
        return {
          index: r.u16(o),
          ...xyz(o + 2),
          elevatorPath: path === ELEVATOR_PATH_COUNT ? null : path,
          elevatorDirection: ELEVATOR_DIRECTIONS[dir] ?? fail(where, `elevator direction ${dir}`),
          destination: r.u32(o + 12),
          prop: prop(r.u32(o + 16), where),
          flag: platformFlag(r.u32(o + 20), where),
        };
      }),
    MOVING_PLATFORM_MAPS,
  ).map(({ mapHeader, value }) => ({ mapHeader, platforms: value }));

  const elevatorPaths = Array.from({ length: ELEVATOR_PATH_COUNT }, (_, i): DwElevatorPath => {
    const o = at(layout.elevatorPaths) + i * ELEVATOR_PATH_SIZE;
    const where = `sElevatorPlatformPaths ${i}`;
    if (r.u16(o) !== i) fail(where, `index ${r.u16(o)}`);
    const next = r.u16(o + 2);
    if (next > ELEVATOR_PATH_COUNT) fail(where, `next ${next}`);
    return {
      next: next === ELEVATOR_PATH_COUNT ? null : next,
      finalOffset: xyz(o + 4),
      changeMapsOffset: xyz(o + 10),
      step: fx(o + 16),
      setFlag: platformFlag(r.u16(o + 28), where),
      clearFlag: platformFlag(r.u16(o + 30), where),
    };
  });

  const command = (kind: number, params: number, where: string): DwEventCommand => {
    const name = EVENT_COMMANDS[kind] ?? fail(where, `command kind ${kind}`);
    const p = (need: boolean) => {
      if (need !== (params !== 0)) fail(where, `${name} ${need ? 'needs' : 'takes no'} params`);
      return need ? ptr(params, where) : 0;
    };
    switch (name) {
      case 'set-map-object-animation': {
        const o = p(true);
        return { kind: name, localId: r.u32(o), action: r.u32(o + 4) };
      }
      case 'move-platform': {
        const o = p(true);
        const movePlayer = r.u16(o + 2);
        if (movePlayer > 1) fail(where, `movePlayer ${movePlayer}`);
        return { kind: name, platform: r.u16(o), movePlayer: movePlayer === 1, unknown04: r.u16(o + 4), finalOffset: xyz(o + 6), step: fx(o + 12) };
      }
      case 'add-map-object': {
        const o = p(true);
        return { kind: name, mapHeader: map(r.u16(o), where), localId: r.u16(o + 2) };
      }
      case 'delete-map-object':
        return { kind: name, localId: r.u32(p(true)) };
      case 'cascade-up':
      case 'cascade-down': {
        const o = p(true);
        return { kind: name, axis: r.u32(o), direction: r.u16(o + 4), finishingFix: xyz(o + 6), finalOffset: xyz(o + 12), mapLoadOffset: xyz(o + 18), step: fx(o + 24) };
      }
      case 'start-script':
        return { kind: name, script: r.u32(p(true)) };
      case 'set-progress':
        return { kind: name, progress: r.u32(p(true)) };
      case 'show-giratina-shadow': {
        const o = p(true);
        return { kind: name, ...xyz(o), rotation: r.view.getInt8(o + 6), sound: r.u8(o + 7), scale: fx(o + 8), step: fx(o + 20), steps: r.i32(o + 32) };
      }
      case 'set-giratina-animation-flag':
        return { kind: name, animation: r.u32(p(true)) };
      case 'set-puzzle-flag':
      case 'clear-puzzle-flag': {
        const flag = r.u32(p(true));
        if (flag >= PUZZLE_FLAG_COUNT) fail(where, `puzzle flag ${flag}`);
        return { kind: name, flag };
      }
      default:
        p(false);
        return { kind: name };
    }
  };

  /** Commands until EVENT_CMD_END (whose params pointer is NULL). */
  const commands = (o: number, where: string) => {
    const out: DwEventCommand[] = [];
    for (; r.u32(o) !== EVENT_CMD_END; o += COMMAND_SIZE) out.push(command(r.u32(o), r.u32(o + 4), `${where} command ${out.length}`));
    if (r.u32(o + 4) !== 0) fail(where, 'end command with params');
    return out;
  };
  const events = mapRows(layout.mapEvents, 'sMapEvents', (list, header) => {
    const out: DwEvent[] = [];
    for (let o = list; ; o += EVENT_SIZE) {
      const where = `map events ${header}/${out.length}`;
      const cmds = r.u32(o + 12);
      if (cmds === 0) return out;
      out.push({ x: r.i16(o), y: r.i16(o + 2), z: r.i32(o + 4), condition: condition(r.u16(o + 8), where), value: r.u16(o + 10), commands: commands(ptr(cmds, where), where) });
    }
  }).map(({ mapHeader, value }) => ({ mapHeader, events: value }));

  const simpleProps = mapRows(layout.simpleProps, 'sSimplePropsMapTemplates', (list, header) => {
    const out: DwSimpleProp[] = [];
    for (let o = list; r.u16(o + 4) !== PROP_KIND_COUNT; o += SIMPLE_PROP_SIZE) {
      const where = `simple props ${header}/${out.length}`;
      out.push({ unknown00: r.u32(o), prop: prop(r.u16(o + 4), where), ...xyz(o + 6), condition: condition(r.u16(o + 12), where), value: r.u16(o + 14) });
    }
    return out;
  }).map(({ mapHeader, value }) => ({ mapHeader, props: value }));

  const objects = mapRows(layout.objectEvents, 'sMapObjectEvents', (list, header) =>
    pointerList(list, `map objects ${header}`).map((o, i): DwObject => {
      const where = `map object ${header}/${i}`;
      const rotated = r.u16(o + 4);
      if (rotated > 1) fail(where, `rotated ${rotated}`);
      const e = o + 8;
      return {
        condition: condition(r.u16(o), where),
        value: r.u16(o + 2),
        rotated: rotated === 1,
        rotation: r.u16(o + 6),
        localId: r.u16(e),
        gfx: r.u16(e + 2),
        movementType: r.u16(e + 4),
        trainerType: r.u16(e + 6),
        hiddenFlag: r.u16(e + 8),
        script: r.u16(e + 10),
        facing: DIRECTIONS[r.i16(e + 12)] ?? fail(where, `facing ${r.i16(e + 12)}`),
        data: [r.u16(e + 14), r.u16(e + 16), r.u16(e + 18)],
        range: { x: r.i16(e + 20), z: r.i16(e + 22) },
        x: r.u16(e + 24),
        z: r.u16(e + 26),
        y: r.i32(e + 28),
      };
    }),
  ).map(({ mapHeader, value }) => ({ mapHeader, objects: value }));

  const cascadeUp = commands(at(layout.cascadeUp), 'sMapEventB5F_Waterfall');
  const cascadeDown = commands(at(layout.cascadeDown), 'sMapEventB4F_Waterfall');
  return { connections, movingPlatforms, elevatorPaths, events, simpleProps, objects, cascadeUp, cascadeDown };
}
