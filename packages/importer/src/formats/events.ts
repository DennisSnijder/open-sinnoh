import { Reader } from '@opensinnoh/nds';

/** zone_event member: four sections, each `u32 count` + fixed-size records (decomp include/map_header_data.h). */
export interface RawBgEvent {
  script: number;
  type: number;
  x: number;
  z: number;
  /** fx32 → world units. */
  y: number;
  facing: number;
}

export interface RawObjectEvent {
  localId: number;
  gfx: number;
  movementType: number;
  trainerType: number;
  hiddenFlag: number;
  script: number;
  dir: number;
  data: [number, number, number];
  rangeX: number;
  rangeZ: number;
  x: number;
  z: number;
  /** fx32 → world units. */
  y: number;
}

export interface RawWarpEvent {
  x: number;
  z: number;
  destZone: number;
  destWarp: number;
}

export interface RawCoordEvent {
  script: number;
  x: number;
  z: number;
  width: number;
  length: number;
  y: number;
  value: number;
  var: number;
}

export interface RawZoneEvents {
  bgs: RawBgEvent[];
  objects: RawObjectEvent[];
  warps: RawWarpEvent[];
  coords: RawCoordEvent[];
}

const FX = 4096;

export function readZoneEvents(bytes: Uint8Array): RawZoneEvents {
  const r = new Reader(bytes);
  let o = 0;
  const section = <T>(size: number, read: (at: number) => T): T[] => {
    const n = r.u32(o);
    o += 4;
    const out: T[] = [];
    for (let i = 0; i < n; i++, o += size) {
      r.slice(o, o + size); // bounds check for the whole record
      out.push(read(o));
    }
    return out;
  };
  const bgs = section(20, (a) => ({ script: r.u16(a), type: r.u16(a + 2), x: r.i32(a + 4), z: r.i32(a + 8), y: r.i32(a + 12) / FX, facing: r.u16(a + 16) }));
  const objects = section(32, (a) => ({
    localId: r.u16(a),
    gfx: r.u16(a + 2),
    movementType: r.u16(a + 4),
    trainerType: r.u16(a + 6),
    hiddenFlag: r.u16(a + 8),
    script: r.u16(a + 10),
    dir: r.i16(a + 12),
    data: [r.u16(a + 14), r.u16(a + 16), r.u16(a + 18)] as [number, number, number],
    rangeX: r.i16(a + 20),
    rangeZ: r.i16(a + 22),
    x: r.u16(a + 24),
    z: r.u16(a + 26),
    y: r.i32(a + 28) / FX,
  }));
  const warps = section(12, (a) => ({ x: r.u16(a), z: r.u16(a + 2), destZone: r.u16(a + 4), destWarp: r.u16(a + 6) }));
  const coords = section(16, (a) => ({
    script: r.u16(a),
    x: r.u16(a + 2),
    z: r.u16(a + 4),
    width: r.u16(a + 6),
    length: r.u16(a + 8),
    y: r.u16(a + 10),
    value: r.u16(a + 12),
    var: r.u16(a + 14),
  }));
  if (o !== bytes.length) throw new Error(`zone events: ${bytes.length - o} trailing bytes`);
  return { bgs, objects, warps, coords };
}
