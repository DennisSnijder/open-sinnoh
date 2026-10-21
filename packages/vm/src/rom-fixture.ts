/** ROM access for ROM-gated tests (OPENSINNOH_NDS_ROM). Test-only helper; nothing here is committed data. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NitroFs, readNarc } from '@opensinnoh/nds';

export const romPath = process.env.OPENSINNOH_NDS_ROM;

/**
 * Map header table in arm9 (docs/research/rom-and-map-formats.md §4): 593 × 24 B at file offset 0xE601C,
 * checked by the same SHA1 as the importer's `TABLES.zoneHeaders` (the importer depends on this package,
 * so it cannot be imported here).
 */
const MAP_HEADERS_OFFSET = 0xe601c;
const MAP_HEADER_COUNT = 593;
const MAP_HEADERS_SHA1 = '4a54ec61a43d4cfb684f5c6e9a93ca0866929f04';

export interface RomScripts {
  members: Uint8Array[];
  banks: Uint8Array[];
  headers: { scripts: number; init: number; msg: number }[];
  mapTextBanks: Map<number, number>;
}

export function loadRomScripts(): RomScripts {
  if (!romPath) throw new Error('OPENSINNOH_NDS_ROM not set');
  const rom = new Uint8Array(readFileSync(romPath));
  const fs = new NitroFs(rom);
  const members = readNarc(fs.file('/fielddata/script/scr_seq.narc'));
  const banks = readNarc(fs.file('/msgdata/pl_msg.narc'));
  const arm9 = rom.subarray(fs.header.arm9Offset, fs.header.arm9Offset + fs.header.arm9Size);
  const table = arm9.subarray(MAP_HEADERS_OFFSET, MAP_HEADERS_OFFSET + MAP_HEADER_COUNT * 24);
  const sha1 = createHash('sha1').update(table).digest('hex');
  if (sha1 !== MAP_HEADERS_SHA1) throw new Error(`map header table has SHA1 ${sha1}, expected ${MAP_HEADERS_SHA1}`);
  const v = new DataView(arm9.buffer, arm9.byteOffset, arm9.byteLength);
  const headers = [];
  for (let i = 0; i < MAP_HEADER_COUNT; i++) {
    const o = MAP_HEADERS_OFFSET + i * 24;
    headers.push({ scripts: v.getUint16(o + 4, true), init: v.getUint16(o + 6, true), msg: v.getUint16(o + 8, true) });
  }
  const mapTextBanks = new Map<number, number>();
  for (const h of headers) {
    const prev = mapTextBanks.get(h.scripts);
    if (prev !== undefined && prev !== h.msg) continue; // shared file with differing banks: first header wins
    mapTextBanks.set(h.scripts, h.msg);
  }
  return { members, banks, headers, mapTextBanks };
}
