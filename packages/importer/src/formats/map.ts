import { Reader } from '@opensinnoh/nds';
import type { Terrain } from '@opensinnoh/contracts';

const FX = 4096;

/** map_matrix member: grid of land_data ids with optional per-cell zone ids and altitudes. */
export interface MapMatrix {
  width: number;
  height: number;
  name: string;
  /** Per cell, or null when the matrix has no zone section. */
  zones: number[] | null;
  altitudes: number[] | null;
  /** land_data id per cell; null = empty (0xFFFF). */
  chunks: (number | null)[];
}

export function readMapMatrix(bytes: Uint8Array): MapMatrix {
  const r = new Reader(bytes);
  const width = r.u8(0);
  const height = r.u8(1);
  const hasZones = r.u8(2);
  const hasAltitudes = r.u8(3);
  const nameLen = r.u8(4);
  if (!width || !height || hasZones > 1 || hasAltitudes > 1) throw new Error(`map matrix: bad header ${width}x${height} ${hasZones} ${hasAltitudes}`);
  const name = r.ascii(5, nameLen);
  const n = width * height;
  let o = 5 + nameLen;
  let zones: number[] | null = null;
  let altitudes: number[] | null = null;
  if (hasZones) {
    zones = Array.from({ length: n }, (_, i) => r.u16(o + i * 2));
    o += n * 2;
  }
  if (hasAltitudes) {
    altitudes = Array.from({ length: n }, (_, i) => r.u8(o + i));
    o += n;
  }
  const chunks = Array.from({ length: n }, (_, i) => {
    const v = r.u16(o + i * 2);
    return v === 0xffff ? null : v;
  });
  o += n * 2;
  if (o !== bytes.length) throw new Error(`map matrix: ${bytes.length - o} trailing bytes`);
  return { width, height, name, zones, altitudes, chunks };
}

export interface RawProp {
  model: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** land_data member: terrain attributes, props, model (NSBMD, passed through) and BDHC terrain. */
export interface LandData {
  tiles: number[];
  props: RawProp[];
  model: Uint8Array;
  terrain: Terrain;
}

export const PROP_SIZE = 48;

export function readLandData(bytes: Uint8Array): LandData {
  const r = new Reader(bytes);
  const attrSize = r.u32(0);
  const propsSize = r.u32(4);
  const modelSize = r.u32(8);
  const bdhcSize = r.u32(12);
  if (attrSize !== 0x800) throw new Error(`land data: attribute size ${attrSize}, expected 0x800`);
  if (16 + attrSize + propsSize + modelSize + bdhcSize !== bytes.length) throw new Error('land data: section sizes do not add up to the member length');
  const tiles = Array.from({ length: 1024 }, (_, i) => r.u16(16 + i * 2));
  const po = 16 + attrSize;
  // One chunk on the ROM has 2 stray bytes after its props; the game reads whole records only.
  const props: RawProp[] = [];
  for (let i = 0; i < Math.floor(propsSize / PROP_SIZE); i++) {
    const o = po + i * PROP_SIZE;
    const v3 = (at: number): [number, number, number] => [r.i32(at) / FX, r.i32(at + 4) / FX, r.i32(at + 8) / FX];
    props.push({ model: r.i32(o), position: v3(o + 4), rotation: v3(o + 16), scale: v3(o + 28) });
  }
  const mo = po + propsSize;
  const model = r.slice(mo, mo + modelSize);
  if (r.ascii(mo, 4) !== 'BMD0') throw new Error(`land data: model magic "${r.ascii(mo, 4)}"`);
  const terrain = readBdhc(r.slice(mo + modelSize, mo + modelSize + bdhcSize));
  return { tiles, props, model, terrain };
}

/** BDHC terrain heights: points, normals, plane constants, plates, z strips and the plate access list. */
export function readBdhc(bytes: Uint8Array): Terrain {
  const r = new Reader(bytes);
  if (r.ascii(0, 4) !== 'BDHC') throw new Error(`BDHC: bad magic "${r.ascii(0, 4)}"`);
  const [nPoints, nNormals, nConstants, nPlates, nStrips, nAccess] = [4, 6, 8, 10, 12, 14].map((o) => r.u16(o)) as [number, number, number, number, number, number];
  let o = 16;
  const points: [number, number][] = [];
  for (let i = 0; i < nPoints; i++, o += 8) points.push([r.i32(o) / FX, r.i32(o + 4) / FX]);
  const normals: [number, number, number][] = [];
  for (let i = 0; i < nNormals; i++, o += 12) normals.push([r.i32(o) / FX, r.i32(o + 4) / FX, r.i32(o + 8) / FX]);
  const constants: number[] = [];
  for (let i = 0; i < nConstants; i++, o += 4) constants.push(r.i32(o) / FX);
  const plates: Terrain['plates'] = [];
  for (let i = 0; i < nPlates; i++, o += 8) {
    const plate = { p1: r.u16(o), p2: r.u16(o + 2), normal: r.u16(o + 4), constant: r.u16(o + 6) };
    if (plate.p1 >= nPoints || plate.p2 >= nPoints || plate.normal >= nNormals || plate.constant >= nConstants) throw new Error(`BDHC: plate ${i} index out of range`);
    plates.push(plate);
  }
  const strips: Terrain['strips'] = [];
  for (let i = 0; i < nStrips; i++, o += 8) {
    const strip = { z: r.i32(o) / FX, count: r.u16(o + 4), start: r.u16(o + 6) };
    if (strip.start + strip.count > nAccess) throw new Error(`BDHC: strip ${i} outside the access list`);
    strips.push(strip);
  }
  const accessList: number[] = [];
  for (let i = 0; i < nAccess; i++, o += 2) {
    const v = r.u16(o);
    if (v >= nPlates) throw new Error(`BDHC: access list entry ${i} = ${v} >= ${nPlates} plates`);
    accessList.push(v);
  }
  if (o !== bytes.length) throw new Error(`BDHC: ${bytes.length - o} trailing bytes`);
  return { points, normals, constants, plates, strips, accessList };
}

/** area_data member (8 B): prop set, map texture set, unused, light id. */
export interface AreaData {
  propSet: number;
  mapTextureSet: number;
  light: number;
}

export function readAreaData(bytes: Uint8Array): AreaData {
  if (bytes.length !== 8) throw new Error(`area data: ${bytes.length} bytes, expected 8`);
  const r = new Reader(bytes);
  return { propSet: r.u16(0), mapTextureSet: r.u16(2), light: r.u16(6) };
}

/** area_build member: u16 count, u16 build model ids. */
export function readAreaBuild(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  const n = r.u16(0);
  if (2 + n * 2 > bytes.length) throw new Error(`area build: ${n} ids overflow ${bytes.length} bytes`);
  return Array.from({ length: n }, (_, i) => r.u16(2 + i * 2));
}
