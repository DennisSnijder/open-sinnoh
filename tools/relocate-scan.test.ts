import { describe, expect, it } from 'vitest';
import { relocate, sha1, type Modules, type Pin, type Where } from './relocate-scan.ts';

/** Deterministic filler bytes (a tiny LCG), so windows don't repeat by chance. */
function filler(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const RAM = 0x021d0000;
const pin = (key: string, bytes: Uint8Array, offset: number, length: number): Pin => ({ key, where: 5, offset, length, size: length, sha1: sha1(bytes.subarray(offset, offset + length)) });

/**
 * A US overlay: code (filler) then data A (64 B at 0x1000), a 4-byte table B at 0x1100 repeated at 0x1400, and a pointer
 * table C at 0x1200 whose two words point at A and at 0x1300 (data D, 64 B). The target build inserts 0x40 bytes of code
 * before the data, so everything moves by 0x40 and C's pointers by the same.
 */
function builds(): { us: Uint8Array; de: Uint8Array; pins: Pin[] } {
  const us = filler(0x2000, 1);
  us.set([1, 2, 3, 4], 0x1100);
  us.set([1, 2, 3, 4], 0x1400);
  const v = new DataView(us.buffer);
  v.setUint32(0x1200, RAM + 0x1000, true);
  v.setUint32(0x1204, 7, true);
  v.setUint32(0x1208, RAM + 0x1300, true);
  v.setUint32(0x120c, 9, true);
  const de = new Uint8Array(us.length + 0x40);
  de.set(us.subarray(0, 0x800));
  de.set(filler(0x40, 2), 0x800);
  de.set(us.subarray(0x800), 0x840);
  const dv = new DataView(de.buffer);
  dv.setUint32(0x1240, RAM + 0x1040, true);
  dv.setUint32(0x1248, RAM + 0x1340, true);
  const pins = [pin('a', us, 0x1000, 64), pin('b', us, 0x1100, 4), pin('c', us, 0x1200, 16), pin('d', us, 0x1300, 64), pin('code', us, 0x100, 32)];
  return { us, de, pins };
}

const modules = (bytes: Uint8Array): Modules => new Map<Where, { bytes: Uint8Array; ram: number }>([[5, { bytes, ram: RAM }]]);
const usRam = new Map<Where, number>([[5, RAM]]);

describe('relocate', () => {
  it('finds data at the same offset, moved data, the nearest repeat and pointer tables by re-hashing', () => {
    const { de, pins } = builds();
    const { found } = relocate({ pins, target: modules(de), usRam });
    const by = Object.fromEntries(found.map((f) => [f.key, f]));
    expect(by.code).toMatchObject({ status: 'same', offset: 0x100 });
    expect(by.a).toMatchObject({ status: 'moved', offset: 0x1040, candidates: 1 });
    expect(by.d).toMatchObject({ status: 'moved', offset: 0x1340 });
    // [1, 2, 3, 4] is at 0x1140 and 0x1440: the anchors predict 0x1140.
    expect(by.b).toMatchObject({ status: 'moved', offset: 0x1140, candidates: 2 });
    expect(by.c).toMatchObject({ status: 'relocated', offset: 0x1240, pointers: 2, sha1: sha1(de.subarray(0x1240, 0x1250)) });
  });

  it('masks pointer words when the US bytes are given', () => {
    const { us, de, pins } = builds();
    const { found } = relocate({ pins, target: modules(de), usRam, us: modules(us) });
    expect(found.find((f) => f.key === 'c')).toMatchObject({ status: 'relocated', offset: 0x1240, pointers: 2 });
  });

  it("solves an overlay's unknown US RAM address by the pointer table's SHA-1", () => {
    const { de, pins } = builds();
    // The target loads the overlay 0x60 higher: its pointers are 0x60 higher too.
    const dv = new DataView(de.buffer);
    for (const o of [0x1240, 0x1248]) dv.setUint32(o, dv.getUint32(o, true) + 0x60, true);
    const target: Modules = new Map<Where, { bytes: Uint8Array; ram: number }>([[5, { bytes: de, ram: RAM + 0x60 }]]);
    const { found, usRam: solved } = relocate({ pins, target, usRam: new Map() });
    expect(found.find((f) => f.key === 'c')).toMatchObject({ status: 'relocated', offset: 0x1240, pointers: 2 });
    expect(solved.get(5)).toBe(RAM);
  });

  it('reports a pin it cannot find, with the predicted offset', () => {
    const { de, pins } = builds();
    de.fill(0, 0x1240, 0x1250);
    const { found } = relocate({ pins, target: modules(de), usRam });
    expect(found.find((f) => f.key === 'c')).toMatchObject({ status: 'missing', predicted: 0x1240 });
  });
});
