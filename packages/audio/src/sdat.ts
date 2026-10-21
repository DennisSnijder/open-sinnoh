import { Reader } from '@opensinnoh/nds';

/**
 * The NITRO sound archive (SDAT; docs/research/audio.md §1): SYMB (names, optional), INFO (one record
 * list per kind), FAT (file id → byte range) and FILE. Every file is a NITRO file of its own (SSEQ, SSAR,
 * SBNK, SWAR, STRM) that the other parsers read. Strict: this is a boundary (ROM input).
 */

export interface SdatSequence {
  name: string | null;
  file: number;
  bank: number;
  volume: number;
  channelPriority: number;
  playerPriority: number;
  player: number;
}

export interface SdatSequenceArchive {
  name: string | null;
  file: number;
  /** SYMB names of its members (null when unnamed or when the archive has no SYMB). */
  memberNames: (string | null)[];
}

export interface SdatBank {
  name: string | null;
  file: number;
  /** Wave archive per slot (0–3), null for 0xFFFF. */
  waveArchives: (number | null)[];
}

export interface SdatWaveArchive {
  name: string | null;
  file: number;
}

export interface SdatPlayer {
  name: string | null;
  maxSequences: number;
  /** Hardware channels the player may allocate (bit n = channel n); 0 = all. */
  channels: number;
  heapSize: number;
}

export interface SdatStream {
  name: string | null;
  file: number;
  volume: number;
  priority: number;
  player: number;
}

export interface SdatGroupEntry {
  /** 0 sequence, 1 sequence archive, 2 bank, 3 wave archive (NNS_SND_ARC_TYPE_*… order). */
  type: number;
  loadFlags: number;
  index: number;
}

export interface Sdat {
  /** Entries are null where the INFO list has an empty slot. */
  sequences: (SdatSequence | null)[];
  sequenceArchives: (SdatSequenceArchive | null)[];
  banks: (SdatBank | null)[];
  waveArchives: (SdatWaveArchive | null)[];
  players: (SdatPlayer | null)[];
  groups: ({ name: string | null; entries: SdatGroupEntry[] } | null)[];
  streams: (SdatStream | null)[];
  /** File bytes by FAT id (views into the archive). */
  file(id: number): Uint8Array;
  fileCount: number;
}

/** INFO/SYMB list order. */
const SEQ = 0;
const SEQARC = 1;
const BANK = 2;
const WAVEARC = 3;
const PLAYER = 4;
const GROUP = 5;
const STRM = 7;

export function checkNitroHeader(bytes: Uint8Array, magic: string): Reader {
  const r = new Reader(bytes);
  if (r.ascii(0, 4) !== magic) throw new Error(`${magic}: bad magic ${JSON.stringify(r.ascii(0, 4))}`);
  if (r.u16(4) !== 0xfeff) throw new Error(`${magic}: bad byte order mark 0x${r.u16(4).toString(16)}`);
  const size = r.u32(8);
  if (size > bytes.length) throw new Error(`${magic}: header says ${size} bytes, file has ${bytes.length}`);
  return r;
}

export function readSdat(bytes: Uint8Array): Sdat {
  const r = checkNitroHeader(bytes, 'SDAT');
  const blocks = r.u16(14);
  const symbOffset = r.u32(0x10);
  const symbSize = r.u32(0x14);
  const infoOffset = r.u32(0x18);
  const fatOffset = r.u32(0x20);
  if (blocks !== 3 && blocks !== 4) throw new Error(`SDAT: ${blocks} blocks`);
  const hasSymb = blocks === 4 && symbOffset !== 0 && symbSize !== 0;
  if (r.ascii(infoOffset, 4) !== 'INFO') throw new Error('SDAT: no INFO block');
  if (r.ascii(fatOffset, 4) !== 'FAT ') throw new Error('SDAT: no FAT block');

  const cstring = (o: number): string => {
    let end = o;
    while (r.u8(end) !== 0) end++;
    return r.ascii(o, end - o);
  };
  const symbList = (kind: number): (string | null)[] => {
    if (!hasSymb) return [];
    if (r.ascii(symbOffset, 4) !== 'SYMB') throw new Error('SDAT: bad SYMB block');
    const list = symbOffset + r.u32(symbOffset + 8 + kind * 4);
    const n = r.u32(list);
    return Array.from({ length: n }, (_, i) => {
      const o = r.u32(list + 4 + i * 4);
      return o === 0 ? null : cstring(symbOffset + o);
    });
  };
  const symbArchiveMembers = (): (string | null)[][] => {
    if (!hasSymb) return [];
    const list = symbOffset + r.u32(symbOffset + 8 + SEQARC * 4);
    const n = r.u32(list);
    return Array.from({ length: n }, (_, i) => {
      const sub = r.u32(list + 4 + i * 8 + 4);
      if (sub === 0) return [];
      const m = r.u32(symbOffset + sub);
      return Array.from({ length: m }, (_, j) => {
        const o = r.u32(symbOffset + sub + 4 + j * 4);
        return o === 0 ? null : cstring(symbOffset + o);
      });
    });
  };
  const symbArchiveNames = (): (string | null)[] => {
    if (!hasSymb) return [];
    const list = symbOffset + r.u32(symbOffset + 8 + SEQARC * 4);
    const n = r.u32(list);
    return Array.from({ length: n }, (_, i) => {
      const o = r.u32(list + 4 + i * 8);
      return o === 0 ? null : cstring(symbOffset + o);
    });
  };
  const infoList = <T>(kind: number, read: (o: number, i: number) => T): (T | null)[] => {
    const list = infoOffset + r.u32(infoOffset + 8 + kind * 4);
    const n = r.u32(list);
    return Array.from({ length: n }, (_, i) => {
      const o = r.u32(list + 4 + i * 4);
      return o === 0 ? null : read(infoOffset + o, i);
    });
  };

  const fatCount = r.u32(fatOffset + 8);
  const fatEntry = (id: number) => {
    if (id < 0 || id >= fatCount) throw new Error(`SDAT: file id ${id} outside the FAT (${fatCount})`);
    const e = fatOffset + 12 + id * 16;
    return { offset: r.u32(e), size: r.u32(e + 4) };
  };

  const seqNames = symbList(SEQ);
  const arcNames = symbArchiveNames();
  const arcMembers = symbArchiveMembers();
  const bankNames = symbList(BANK);
  const waveNames = symbList(WAVEARC);
  const playerNames = symbList(PLAYER);
  const groupNames = symbList(GROUP);
  const streamNames = symbList(STRM);

  return {
    sequences: infoList(SEQ, (o, i) => ({
      name: seqNames[i] ?? null,
      file: r.u16(o),
      bank: r.u16(o + 4),
      volume: r.u8(o + 6),
      channelPriority: r.u8(o + 7),
      playerPriority: r.u8(o + 8),
      player: r.u8(o + 9),
    })),
    sequenceArchives: infoList(SEQARC, (o, i) => ({ name: arcNames[i] ?? null, file: r.u16(o), memberNames: arcMembers[i] ?? [] })),
    banks: infoList(BANK, (o, i) => ({
      name: bankNames[i] ?? null,
      file: r.u16(o),
      waveArchives: [0, 1, 2, 3].map((k) => {
        const w = r.u16(o + 4 + k * 2);
        return w === 0xffff ? null : w;
      }),
    })),
    waveArchives: infoList(WAVEARC, (o, i) => ({ name: waveNames[i] ?? null, file: r.u16(o) })),
    players: infoList(PLAYER, (o, i) => ({ name: playerNames[i] ?? null, maxSequences: r.u8(o), channels: r.u16(o + 2), heapSize: r.u32(o + 4) })),
    groups: infoList(GROUP, (o, i) => {
      const n = r.u32(o);
      return {
        name: groupNames[i] ?? null,
        entries: Array.from({ length: n }, (_, k) => ({ type: r.u8(o + 4 + k * 8), loadFlags: r.u8(o + 5 + k * 8), index: r.u32(o + 8 + k * 8) })),
      };
    }),
    streams: infoList(STRM, (o, i) => ({ name: streamNames[i] ?? null, file: r.u16(o), volume: r.u8(o + 4), priority: r.u8(o + 5), player: r.u8(o + 6) })),
    file(id) {
      const e = fatEntry(id);
      return r.slice(e.offset, e.offset + e.size);
    },
    fileCount: fatCount,
  };
}

/** SSEQ: the sequence's event bytes (from its data offset to the end of the DATA block). */
export function readSseq(bytes: Uint8Array): Uint8Array {
  const r = checkNitroHeader(bytes, 'SSEQ');
  const block = r.u16(12);
  if (r.ascii(block, 4) !== 'DATA') throw new Error('SSEQ: no DATA block');
  const end = block + r.u32(block + 4);
  const start = r.u32(block + 8);
  return r.slice(start, end);
}

export interface SsarMember {
  /** Offset of the member's first event in the archive's event bytes. */
  offset: number;
  bank: number;
  volume: number;
  channelPriority: number;
  playerPriority: number;
  player: number;
}

/** SSAR: the archive's shared event bytes and its member sequences (null where a slot is empty). */
export function readSsar(bytes: Uint8Array): { data: Uint8Array; members: (SsarMember | null)[] } {
  const r = checkNitroHeader(bytes, 'SSAR');
  const block = r.u16(12);
  if (r.ascii(block, 4) !== 'DATA') throw new Error('SSAR: no DATA block');
  const end = block + r.u32(block + 4);
  const start = r.u32(block + 8);
  const n = r.u32(block + 12);
  const members = Array.from({ length: n }, (_, i): SsarMember | null => {
    const o = block + 16 + i * 12;
    const offset = r.u32(o);
    // Empty slots carry offset 0xFFFFFFFF in practice; treat anything past the data as empty.
    if (offset >= end - start) return null;
    return { offset, bank: r.u16(o + 4), volume: r.u8(o + 6), channelPriority: r.u8(o + 7), playerPriority: r.u8(o + 8), player: r.u8(o + 9) };
  });
  return { data: r.slice(start, end), members };
}
