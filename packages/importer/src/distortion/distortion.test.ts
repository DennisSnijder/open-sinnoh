/**
 * The Distortion World readers on original bytes written here (the writers are the layout spec, from
 * the decomp structs in ov9_02249960.c): every tw_arc section, a terrain grid, the sky members and the
 * overlay 9 tables, and the loud failures at this boundary.
 */
import { describe, expect, it } from 'vitest';
import { readOverlayTables, type Overlay9Layout } from './overlay9.ts';
import { readMapInfo, readRoomFile, type DwSupport } from './tw-arc.ts';
import { readAttrGrid } from './tw-attr.ts';
import { readSky } from './tw-etc.ts';

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const s16s = (...v: number[]) => v.flatMap(u16);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytes = (a: number[]) => Uint8Array.from(a);

// --- tw_arc ---

const bounds = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => s16s(x, y, z, sx, sy, sz);
const support = (kind: number, attr: number, b: number[]) => [...u16(kind), ...u16(attr), ...b, ...u16(4), ...u16(4)];
interface JumpSpec {
  handler?: number;
  dir: number;
  b: number[];
  disp: [number, number, number];
  rot: number;
  axis?: number;
  inverted?: number;
  final: number;
  kind: number;
  index: number;
}
const jump = (j: JumpSpec) => [...u16(j.handler ?? 0), ...u16(j.dir), ...u32(7), ...j.b, ...s16s(...j.disp, j.rot, 16), ...u16(j.axis ?? 1), ...u16(j.inverted ?? 0), ...u16(j.final), ...u16(j.kind), ...u16(j.index)];
const camera = (b: number[], angle: [number, number, number], dir: number, steps: number) => [...b, ...s16s(...angle, dir), ...u32(steps)];
const section = (records: number[][]) => (records.length ? [...u32(records.length), ...records.flat()] : []);
function roomFile(parts: { supports?: number[][]; jumps?: number[][]; cameras?: number[][]; ghosts?: number[] }): Uint8Array {
  const s = section(parts.supports ?? []);
  const j = section(parts.jumps ?? []);
  const c = section(parts.cameras ?? []);
  const g = parts.ghosts ?? [];
  return bytes([...u32(0), ...u32(s.length), ...u32(j.length), ...u32(c.length), ...u32(g.length), ...s, ...j, ...c, ...g]);
}
const ghosts = (props: number[][], triggers: number[][], visible: number) => [...u32(props.length), ...u32(triggers.length), ...u32(visible), ...props.flat(), ...triggers.flat()];

const FLOOR = support(0, 3, bounds(10, 20, 30, 3, 0, 3));
const WEST = support(1, 4, bounds(9, 18, 30, 0, 2, 3));
const TO_WEST: JumpSpec = { dir: 2, b: bounds(10, 20, 31, 0, 0, 1), disp: [-1, 2, 0], rot: 90, final: 2, kind: 1, index: 1 };
const TO_LAND: JumpSpec = { dir: 1, b: bounds(9, 18, 30, 0, 0, 0), disp: [1, -2, 0], rot: -90, axis: 0, inverted: 1, final: 3, kind: 4, index: 0xffff };

describe('tw_arc', () => {
  it('reads the map-info list', () => {
    const info = bytes([...u32(2), ...u32(573), ...u16(0), ...s16s(21, 288, 10), ...u32(582), ...u16(8), ...s16s(-1, 0, 0)]);
    expect(readMapInfo(info)).toEqual([
      { mapHeader: 573, file: 0, offset: { x: 21, altitude: 288, z: 10 } },
      { mapHeader: 582, file: 8, offset: { x: -1, altitude: 0, z: 0 } },
    ]);
    expect(() => readMapInfo(info.subarray(0, 20))).toThrow(/20 bytes for 2 records/);
  });

  it('reads supports, jump points, camera rows and ghost props', () => {
    const room = readRoomFile(
      roomFile({
        supports: [FLOOR, WEST],
        jumps: [jump(TO_WEST), jump(TO_LAND)],
        cameras: [camera(bounds(10, 20, 31, 0, 0, 0), [20, 45, 0], 2, 16)],
        ghosts: ghosts([[...u32(1), ...u16(0), ...s16s(44, 289, 34)]], [[...u32(1), ...u16(3), ...u16(1), ...bounds(5, 6, 7, 0, 0, 2)]], 0b10),
      }),
    );
    expect(room.supports).toEqual([
      { kind: 'floor', attr: 3, bounds: { x: 10, y: 20, z: 30, sizeX: 3, sizeY: 0, sizeZ: 3 }, tilesVertical: 4, tilesHorizontal: 4 },
      { kind: 'west-wall', attr: 4, bounds: { x: 9, y: 18, z: 30, sizeX: 0, sizeY: 2, sizeZ: 3 }, tilesVertical: 4, tilesHorizontal: 4 },
    ]);
    expect(room.jumpPoints[0]).toEqual({
      handler: 'jump',
      facing: 'left',
      unknown04: 7,
      bounds: { x: 10, y: 20, z: 31, sizeX: 0, sizeY: 0, sizeZ: 1 },
      displacement: { x: -1, y: 2, z: 0 },
      spriteRotation: 90,
      steps: 16,
      axis: 'y',
      inverted: false,
      finalFacing: 'left',
      toKind: 'west-wall',
      toSupport: 1,
    });
    expect(room.jumpPoints[1]).toMatchObject({ facing: 'down', axis: 'x', inverted: true, finalFacing: 'right', toKind: 'land', toSupport: null });
    expect(room.cameraRows).toEqual([{ bounds: { x: 10, y: 20, z: 31, sizeX: 0, sizeY: 0, sizeZ: 0 }, angle: { x: 20, y: 45, z: 0 }, facing: 'left', steps: 16 }]);
    expect(room.ghostProps).toEqual({
      defaultVisible: 2,
      props: [{ group: 1, kind: 0, x: 44, y: 289, z: 34 }],
      triggers: [{ group: 1, facing: 'right', show: true, bounds: { x: 5, y: 6, z: 7, sizeX: 0, sizeY: 0, sizeZ: 2 } }],
    });
  });

  it('treats a zero-size section as absent', () => {
    expect(readRoomFile(roomFile({}))).toEqual({ unknown00: 0, supports: [], jumpPoints: [], cameraRows: [], ghostProps: null });
  });

  it('rejects unknown handlers, kinds and directions, bad landings and bad sizes', () => {
    const room = (j: Partial<JumpSpec>) => roomFile({ supports: [FLOOR, WEST], jumps: [jump({ ...TO_WEST, ...j })] });
    expect(() => readRoomFile(room({ handler: 1 }))).toThrow(/handler 1 is not one of 0–0/);
    expect(() => readRoomFile(room({ dir: 4 }))).toThrow(/facing 4/);
    expect(() => readRoomFile(room({ axis: 3 }))).toThrow(/axis 3/);
    expect(() => readRoomFile(room({ inverted: 2 }))).toThrow(/inverted 2/);
    expect(() => readRoomFile(room({ kind: 2 }))).toThrow(/lands on east-wall support 1/);
    expect(() => readRoomFile(room({ index: 2 }))).toThrow(/lands on west-wall support 2/);
    expect(() => readRoomFile(room({ kind: 4, index: 0 }))).toThrow(/lands on land support 0/);
    expect(() => readRoomFile(room({ kind: 5 }))).toThrow(/destination kind 5/);
    expect(() => readRoomFile(roomFile({ supports: [support(4, 0, bounds(0, 0, 0, 0, 0, 0))] }))).toThrow(/kind 4/);
    const truncated = roomFile({ supports: [FLOOR] });
    expect(() => readRoomFile(truncated.subarray(0, truncated.length - 2))).toThrow(/section sizes/);
    const badCount = roomFile({ supports: [FLOOR] });
    badCount[20] = 2;
    expect(() => readRoomFile(badCount)).toThrow(/24 bytes for 2 records of 20/);
    const badShow = roomFile({ ghosts: ghosts([], [[...u32(0), ...u16(0), ...u16(2), ...bounds(0, 0, 0, 0, 0, 0)]], 0) });
    expect(() => readRoomFile(badShow)).toThrow(/show 2/);
    expect(() => readRoomFile(roomFile({ ghosts: ghosts([[...u32(0), ...u16(25), ...s16s(0, 0, 0)]], [], 0) }))).toThrow(/prop kind 25/);
  });
});

// --- tw_arc_attr ---

describe('tw_arc_attr', () => {
  const sup = (kind: DwSupport['kind'], sx: number, sy: number, sz: number): DwSupport => ({ kind, attr: 0, bounds: { x: 0, y: 0, z: 0, sizeX: sx, sizeY: sy, sizeZ: sz }, tilesVertical: 4, tilesHorizontal: 4 });
  const grid = bytes(Array.from({ length: 16 }, (_, i) => u16(i === 5 ? 0x8001 : i)).flat());

  it('reads the u16 cells of a support', () => {
    const cells = readAttrGrid(grid, sup('floor', 3, 0, 3), 'fixture');
    expect(cells).toHaveLength(16);
    expect(cells[5]).toBe(0x8001);
    expect(readAttrGrid(grid, sup('east-wall', 0, 3, 3), 'fixture')[15]).toBe(15);
  });

  it('rejects a grid of the wrong size, bounds outside it and a thick support', () => {
    expect(() => readAttrGrid(grid.subarray(0, 30), sup('floor', 3, 0, 3), 'fixture')).toThrow(/30 bytes for a 4×4 grid/);
    expect(() => readAttrGrid(grid, sup('floor', 4, 0, 3), 'fixture')).toThrow(/do not fit/);
    expect(() => readAttrGrid(grid, sup('ceiling', 3, 0, 4), 'fixture')).toThrow(/do not fit/);
    expect(() => readAttrGrid(grid, sup('west-wall', 1, 3, 3), 'fixture')).toThrow(/X size 1/);
    expect(() => readAttrGrid(grid, sup('floor', 3, 1, 3), 'fixture')).toThrow(/Y size 1/);
  });
});

// --- tw_arc_etc ---

function file2d(magic: string, block: string, body: number[]): Uint8Array {
  const blockBytes = [...ascii(block), ...u32(8 + body.length), ...body];
  return bytes([...ascii(magic), ...u16(0xfeff), ...u16(0x0100), ...u32(16 + blockBytes.length), ...u16(16), ...u16(1), ...blockBytes]);
}
const ncgr = (chars: number) => file2d('RGCN', 'RAHC', [...u16(0xffff), ...u16(0xffff), ...u32(3), ...u32(0), ...u32(0), ...u32(chars * 32), ...u32(0x18), ...Array<number>(chars * 32).fill(0x11)]);
const nclr = (colors: number) => file2d('RLCN', 'TTLP', [...u32(3), ...u32(0), ...u32(colors * 2), ...u32(0x10), ...Array<number>(colors * 2).fill(0)]);
const nscr = (w: number, h: number) => file2d('RCSN', 'NRCS', [...u16(w), ...u16(h), ...u32(0), ...u32((w / 8) * (h / 8) * 2), ...Array<number>((w / 8) * (h / 8) * 2).fill(0)]);
/** One cell of no OAMs. */
const ncer = () => file2d('RECN', 'KBEC', [...u16(1), ...u16(0), ...u32(0x18), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u32(0)]);
/** No sequences. */
const nanr = () => file2d('RNAN', 'KNBA', [...u16(0), ...u16(0), ...u32(0x18), ...u32(0x18), ...u32(0x18), ...u32(0), ...u32(0)]);

describe('tw_arc_etc', () => {
  const members = [ncgr(2), nclr(16), nscr(16, 8), ...Array.from({ length: 7 }, (_, k) => [ncer(), ncgr(k + 1), nanr()]).flat(), nclr(32)];

  it('reads the sky background and the seven cloud sets', () => {
    const sky = readSky(members);
    expect(sky.background).toEqual({ characters: 2, bitDepth: 4, colors: 16, screen: { width: 16, height: 8 } });
    expect(sky.clouds.map((c) => c.characters)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sky.clouds[0]).toEqual({ cells: 1, characters: 1, animations: 0 });
    expect(sky.cloudColors).toBe(32);
  });

  it('rejects a missing member and a member of the wrong format', () => {
    expect(() => readSky(members.slice(1))).toThrow(/24 members, expected 25/);
    const swapped = [...members];
    swapped[3] = nclr(1);
    expect(() => readSky(swapped)).toThrow(/member 3: 2D: expected RECN/);
  });
});

// --- overlay 9 ---

const RAM = 0x2249960;
const START = 0x100;
const MAPS = 593;
/**
 * A pinned region at overlay offset START: the eight tables at fixed slots, the pointed-at data after
 * them. `ptr(o)` is the RAM address of region offset o.
 */
function overlayFixture(edit?: (b: number[]) => void): { region: Uint8Array; layout: Overlay9Layout } {
  const b: number[] = Array<number>(0x800).fill(0);
  const put = (o: number, v: number[]) => v.forEach((x, i) => (b[o + i] = x));
  const ptr = (o: number) => RAM + START + o;
  const L = { connections: 0x000, movingPlatforms: 0x080, elevatorPaths: 0x0c0, mapEvents: 0x400, simpleProps: 0x440, objectEvents: 0x460, cascadeUp: 0x4a0, cascadeDown: 0x4b0 };
  // Connections: 573 ↔ 574, the rest unlinked (only the first two rows are filled in the fixture).
  put(L.connections, [...u32(573), ...u32(MAPS), ...u32(574), ...u32(574), ...u32(573), ...u32(MAPS)]);
  for (let i = 2; i < 10; i++) put(L.connections + i * 12, [...u32(575 + i), ...u32(MAPS), ...u32(MAPS)]);
  // Moving platforms: 573 has one (list at 0x500 → template 0x510), the other seven an empty list (0x508).
  put(L.movingPlatforms, [...u32(573), ...u32(ptr(0x500))]);
  for (let i = 1; i < 8; i++) put(L.movingPlatforms + i * 8, [...u32(576 + i), ...u32(ptr(0x508))]);
  put(0x500, [...u32(ptr(0x510)), ...u32(0)]);
  put(0x510, [...u16(0), ...s16s(40, 289, 54), ...u16(0), ...u16(1), ...u32(0), ...u32(19), ...u32(11)]);
  // Elevator paths: 22 rows; row 0 continues into 1 and sets platform flag 0.
  for (let i = 0; i < 22; i++) put(L.elevatorPaths + i * 32, [...u16(i), ...u16(i === 0 ? 1 : 22), ...s16s(0, -32, 0, 0, -16, 0), ...u32(0), ...u32(-16384 >>> 0), ...u32(0), ...u16(i === 0 ? 0 : 11), ...u16(11)]);
  // Events: 573 has one event (start script 4, set progress 2); terminator row.
  put(L.mapEvents, [...u32(573), ...u32(ptr(0x700)), ...u32(MAPS), ...u32(0)]);
  put(0x700, [...s16s(40, 289), ...u32(52), ...u16(3), ...u16(1), ...u32(ptr(0x740)), ...Array<number>(16).fill(0)]);
  put(0x740, [...u32(5), ...u32(ptr(0x760)), ...u32(6), ...u32(ptr(0x764)), ...u32(18), ...u32(0)]);
  put(0x760, [...u32(4), ...u32(2)]);
  // Simple props: 573 a portal, then PROP_KIND_INVALID.
  put(L.simpleProps, [...u32(573), ...u32(ptr(0x580)), ...u32(MAPS), ...u32(0)]);
  put(0x580, [...u32(9), ...u16(24), ...s16s(55, 289, 39), ...u16(0), ...u16(0), ...u32(0), ...u16(25)]);
  // Objects: 573 one object (list 0x5a0 → 0x5b0).
  put(L.objectEvents, [...u32(573), ...u32(ptr(0x5a0)), ...u32(MAPS), ...u32(0)]);
  put(0x5a0, [...u32(ptr(0x5b0)), ...u32(0)]);
  put(0x5b0, [...u16(6), ...u16(0), ...u16(0), ...u16(0), ...u16(128), ...u16(138), ...u16(0), ...u16(0), ...u16(0), ...u16(5), ...u16(1), ...s16s(0, 0, 0, 0, 0), ...u16(55), ...u16(40), ...u32((289 << 4) * 4096)]);
  // Waterfalls: cascade up (params at 0x600), cascade down (0x630).
  put(L.cascadeUp, [...u32(4), ...u32(ptr(0x600)), ...u32(18), ...u32(0)]);
  put(L.cascadeDown, [...u32(10), ...u32(ptr(0x630)), ...u32(18), ...u32(0)]);
  put(0x600, [...u32(1), ...u16(0), ...s16s(0, 42, 0, 0, 664, 0, 0, 20, 0), ...u32(0), ...u32(32768), ...u32(0)]);
  put(0x630, [...u32(1), ...u16(1), ...s16s(0, -42, 0, 0, -664, 0, 0, -21, 0), ...u32(0), ...u32(-4096 >>> 0), ...u32(0)]);
  edit?.(b);
  const layout = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v + START])) as unknown as Overlay9Layout;
  return { region: bytes(b), layout };
}
const read = (f: ReturnType<typeof overlayFixture>) => readOverlayTables(f.region, START, RAM, f.layout, MAPS);

describe('overlay 9 tables', () => {
  it('reads every table and follows its pointers', () => {
    const t = read(overlayFixture());
    expect(t.connections.slice(0, 2)).toEqual([
      { mapHeader: 573, previous: null, next: 574 },
      { mapHeader: 574, previous: 573, next: null },
    ]);
    expect(t.movingPlatforms[0]).toEqual({ mapHeader: 573, platforms: [{ index: 0, x: 40, y: 289, z: 54, elevatorPath: 0, elevatorDirection: 'down', destination: 0, prop: 19, flag: null }] });
    expect(t.movingPlatforms.slice(1).every((m) => m.platforms.length === 0)).toBe(true);
    expect(t.elevatorPaths).toHaveLength(22);
    expect(t.elevatorPaths[0]).toEqual({ next: 1, finalOffset: { x: 0, y: -32, z: 0 }, changeMapsOffset: { x: 0, y: -16, z: 0 }, step: { x: 0, y: -16384, z: 0 }, setFlag: 0, clearFlag: null });
    expect(t.events).toEqual([
      {
        mapHeader: 573,
        events: [
          {
            x: 40,
            y: 289,
            z: 52,
            condition: 'progress-eq',
            value: 1,
            commands: [
              { kind: 'start-script', script: 4 },
              { kind: 'set-progress', progress: 2 },
            ],
          },
        ],
      },
    ]);
    expect(t.simpleProps).toEqual([{ mapHeader: 573, props: [{ unknown00: 9, prop: 24, x: 55, y: 289, z: 39, condition: 'none', value: 0 }] }]);
    expect(t.objects[0]!.objects[0]).toMatchObject({ condition: 'manual-add-only', rotated: false, localId: 128, gfx: 138, script: 5, facing: 'down', x: 55, z: 40, y: (289 << 4) * 4096 });
    expect(t.cascadeUp).toEqual([{ kind: 'cascade-up', axis: 1, direction: 0, finishingFix: { x: 0, y: 42, z: 0 }, finalOffset: { x: 0, y: 664, z: 0 }, mapLoadOffset: { x: 0, y: 20, z: 0 }, step: { x: 0, y: 32768, z: 0 } }]);
    expect(t.cascadeDown[0]).toMatchObject({ kind: 'cascade-down', direction: 1, step: { x: 0, y: -4096, z: 0 } });
  });

  it('rejects unknown command kinds, conditions, stray pointers and bad params', () => {
    expect(() => read(overlayFixture((b) => (b[0x740] = 19)))).toThrow(/command kind 19/);
    expect(() => read(overlayFixture((b) => (b[0x708] = 9)))).toThrow(/condition 9/);
    // The first command's params pointer moved outside the region.
    expect(() => read(overlayFixture((b) => (b[0x747] = 0x03)))).toThrow(/outside the pinned region/);
    // start-script with no params.
    expect(() => read(overlayFixture((b) => b.splice(0x744, 4, 0, 0, 0, 0)))).toThrow(/start-script needs params/);
    // An elevator path out of order.
    expect(() => read(overlayFixture((b) => (b[0x0c0 + 32] = 5)))).toThrow(/sElevatorPlatformPaths 1: index 5/);
    expect(() => read(overlayFixture((b) => (b[0x524] = 12)))).toThrow(/moving platform 573\/0: platform flag 12/);
    expect(() => read(overlayFixture((b) => (b[0x51a] = 3)))).toThrow(/elevator direction 3/);
  });
});
