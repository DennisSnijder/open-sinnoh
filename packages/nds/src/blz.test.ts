import { describe, expect, it } from 'vitest';
import { compressBackward, decompressBackward } from './blz.ts';
import { NitroFs } from './rom.ts';
import { moduleParams, writeNarc, writeRomImage } from './writer.ts';
import { readNarc } from './narc.ts';

/** Original bytes: noise (an LCG) and runs copied from up to 300 bytes back, so matches of every length occur. */
function sample(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 8;
  for (let i = 0; i < n; ) {
    if (i > 300 && next() % 4) {
      const d = 3 + (next() % 297);
      for (let k = 3 + (next() % 16); k > 0 && i < n; k--, i++) out[i] = out[i - d]!;
    } else out[i++] = next() & 0xff;
  }
  return out;
}

describe('backward LZ (BLZ)', () => {
  it('round-trips original bytes, with and without a stored prefix', () => {
    for (const [n, stored] of [[600, 0], [5000, 0], [5000, 0x400], [9000, 17]] as const) {
      const data = sample(n);
      const packed = compressBackward(data, stored);
      expect(packed.length).toBeLessThan(data.length);
      expect(packed.length % 4).toBe(0);
      expect([...decompressBackward(packed)]).toEqual([...data]);
    }
  });

  it('decodes a hand-made stream: literals and a back-reference, read from the end', () => {
    // Output "ABC" × 6 (18 bytes). Read backwards: literals C, B, A, then a reference of length 15 at distance 3.
    // Stream as read: flags 0b00010000, 'C', 'B', 'A', hi 0xc0 (length 15 − 3 = 12, distance 3 − 3 = 0), lo 0x00.
    const read = [0b00010000, 0x43, 0x42, 0x41, 0xc0, 0x00];
    const stream = read.slice().reverse();
    const block = stream.length + 8 + 2; // padded to a multiple of 4
    const packed = new Uint8Array([...stream, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]);
    const v = new DataView(packed.buffer);
    v.setUint32(packed.length - 8, block | (10 << 24), true);
    v.setUint32(packed.length - 4, 18 - packed.length, true);
    expect(new TextDecoder().decode(decompressBackward(packed))).toBe('ABC'.repeat(6));
  });

  it('fails loudly on a bad footer, a reference past the end and a short stream', () => {
    expect(() => decompressBackward(new Uint8Array(4))).toThrow(/too short/);
    const bad = compressBackward(sample(800));
    const v = new DataView(bad.buffer);
    v.setUint32(bad.length - 8, (bad.length + 4) | (8 << 24), true);
    expect(() => decompressBackward(bad)).toThrow(/do not fit/);
    // The first item read is a back-reference: nothing has been written to copy from.
    const early = new Uint8Array([0x00, 0x00, 0x80, 0xff, 12, 0, 0, 8, 20, 0, 0, 0]);
    expect(() => decompressBackward(early)).toThrow(/past the end/);
    const long = compressBackward(sample(800));
    new DataView(long.buffer).setUint32(long.length - 4, 5000, true);
    expect(() => decompressBackward(long)).toThrow(/stream ends/);
  });
});

describe('executables on an original ROM image', () => {
  const RAM = 0x02000000;
  const code = sample(0x3000, 11);

  function image(compressedArm9: boolean) {
    const params = 0x800;
    const arm9 = code.slice();
    arm9.set(moduleParams(0), params);
    // The module parameters sit in the stored prefix; the compressed end is the stored module's end in RAM.
    const stored = compressedArm9 ? compressBackward(arm9, 0x1000) : arm9;
    if (compressedArm9) {
      arm9.set(moduleParams(RAM + stored.length), params);
      stored.set(moduleParams(RAM + stored.length), params);
    }
    const ovl = sample(0x2000, 5);
    return {
      arm9,
      ovl,
      rom: writeRomImage({
        gameCode: 'TEST',
        arm9: stored,
        moduleParams: params,
        overlays: [
          { bytes: compressBackward(ovl), ramAddress: 0x021d0000, ramSize: ovl.length, compressed: true },
          { bytes: ovl, ramAddress: 0x021e0000, ramSize: ovl.length, compressed: false },
        ],
        files: { '/a/0/0/1': writeNarc([new Uint8Array([1, 2, 3])]), '/a/0/8/1': writeNarc([new Uint8Array([4]), new Uint8Array([5, 6])]), '/data/x.bin': new Uint8Array([9]) },
      }),
    };
  }

  it('decompresses the ARM9 from its module parameters and overlays from their table entries', () => {
    const { arm9, ovl, rom } = image(true);
    const fs = new NitroFs(rom);
    expect([...fs.arm9Code()]).toEqual([...arm9]);
    expect([...fs.overlayCode(0)]).toEqual([...ovl]);
    expect([...fs.overlayCode(1)]).toEqual([...ovl]);
    expect(() => fs.overlay(0)).toThrow(/compressed/);
    expect(readNarc(fs.file('/a/0/8/1')).map((m) => [...m])).toEqual([[4], [5, 6]]);
    expect(fs.fileId('/a/0/0/1')).toBe(2);
    expect([...fs.file('/data/x.bin')]).toEqual([9]);
  });

  it('returns an uncompressed ARM9 as stored, and rejects a missing footer or a wrong overlay size', () => {
    const { arm9, rom } = image(false);
    expect([...new NitroFs(rom).arm9Code()]).toEqual([...arm9]);
    const noFooter = rom.slice();
    new DataView(noFooter.buffer).setUint32(0x4000 + arm9.length, 0, true);
    expect(() => new NitroFs(noFooter).arm9Code()).toThrow(/no nitro code/);
    const wrong = rom.slice();
    const fs = new NitroFs(wrong);
    const ovt = fs.header.arm9OverlayOffset;
    new DataView(wrong.buffer).setUint32(ovt + 8, 0x10, true);
    expect(() => new NitroFs(wrong).overlayCode(0)).toThrow(/decompresses to/);
  });

  it('reads the same through a RomSource (a range at a time, as the import worker reads the File)', () => {
    const { arm9, ovl, rom } = image(true);
    const reads: [number, number][] = [];
    const fs = new NitroFs({ size: rom.length, read: (start, end) => (reads.push([start, end]), rom.slice(start, end)) });
    expect([...fs.arm9Code()]).toEqual([...arm9]);
    expect([...fs.overlayCode(0)]).toEqual([...ovl]);
    expect(readNarc(fs.file('/a/0/8/1')).map((m) => [...m])).toEqual([[4], [5, 6]]);
    expect(fs.listPaths()).toEqual(new NitroFs(rom).listPaths());
    expect(reads.every(([start, end]) => end - start < rom.length)).toBe(true);
    expect(() => new NitroFs({ size: 0x100, read: (start, end) => rom.slice(start, end) })).toThrow(/outside the 256-byte ROM/);
  });
});
