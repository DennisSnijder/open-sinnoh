import { describe, expect, it } from 'vitest';
import { compressLz10, decompressLz10, isLz10 } from './lz.ts';

describe('LZ10', () => {
  it('round-trips literals and back-references, including overlapping runs', () => {
    const data = Uint8Array.from([...'abcabcabcabcXYZ'].map((c) => c.charCodeAt(0)).concat(Array<number>(40).fill(7), [1, 2, 3]));
    const packed = compressLz10(data);
    expect(isLz10(packed)).toBe(true);
    expect(packed.length).toBeLessThan(data.length);
    expect([...decompressLz10(packed)]).toEqual([...data]);
  });

  it('decodes a hand-written stream', () => {
    // size 6; flags 0b01000000: literal 'a', then a reference (length 5, distance 1) → "aaaaaa".
    const packed = Uint8Array.from([0x10, 6, 0, 0, 0x40, 0x61, 0x20, 0x00]);
    expect(String.fromCharCode(...decompressLz10(packed))).toBe('aaaaaa');
  });

  it('fails loudly on bad input', () => {
    expect(() => decompressLz10(Uint8Array.from([0x11, 1, 0, 0, 0, 0]))).toThrow(/expected 0x10/);
    expect(() => decompressLz10(Uint8Array.from([0x10, 9, 0, 0, 0x00, 1]))).toThrow(/input ends/);
    expect(() => decompressLz10(Uint8Array.from([0x10, 4, 0, 0, 0x80, 0x10, 0x05]))).toThrow(/before the start/);
  });
});
