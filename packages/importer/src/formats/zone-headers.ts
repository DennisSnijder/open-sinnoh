import { Reader } from '@opensinnoh/nds';

/** Map header (decomp `MapHeader`, include/map_header.h): one 24-byte record per zone, in arm9. */
export interface ZoneHeader {
  area: number;
  preloadedObjects: number;
  matrix: number;
  scripts: number;
  initScripts: number;
  textBank: number;
  music: { day: number; night: number };
  /** pl_enc_data member, or null (0xFFFF). */
  encounters: number | null;
  events: number;
  mapLabelText: number;
  mapLabelWindow: number;
  weather: number;
  camera: number;
  mapType: number;
  battleBg: number;
  bike: boolean;
  running: boolean;
  escapeRope: boolean;
  fly: boolean;
}

export const ZONE_HEADER_SIZE = 24;

export function readZoneHeaders(bytes: Uint8Array, count: number): ZoneHeader[] {
  if (bytes.length !== count * ZONE_HEADER_SIZE) throw new Error(`zone headers: expected ${count * ZONE_HEADER_SIZE} bytes, got ${bytes.length}`);
  const r = new Reader(bytes);
  const out: ZoneHeader[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * ZONE_HEADER_SIZE;
    const bits = r.u16(o + 22);
    const enc = r.u16(o + 14);
    out.push({
      area: r.u8(o),
      preloadedObjects: r.u8(o + 1),
      matrix: r.u16(o + 2),
      scripts: r.u16(o + 4),
      initScripts: r.u16(o + 6),
      textBank: r.u16(o + 8),
      music: { day: r.u16(o + 10), night: r.u16(o + 12) },
      encounters: enc === 0xffff ? null : enc,
      events: r.u16(o + 16),
      mapLabelText: r.u8(o + 18),
      mapLabelWindow: r.u8(o + 19),
      weather: r.u8(o + 20),
      camera: r.u8(o + 21),
      mapType: bits & 0x7f,
      battleBg: (bits >> 7) & 0x1f,
      bike: (bits & 0x1000) !== 0,
      running: (bits & 0x2000) !== 0,
      escapeRope: (bits & 0x4000) !== 0,
      fly: (bits & 0x8000) !== 0,
    });
  }
  return out;
}
