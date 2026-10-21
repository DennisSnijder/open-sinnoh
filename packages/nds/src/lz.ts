/**
 * LZ10 ("LZ77", BIOS type 0x10) decompression, as GBATEK describes it: `u8 0x10, u24 decompressed size`,
 * then blocks of one flag byte (MSB first) and 8 items; flag 0 = a literal byte, 1 = a back-reference
 * `u16 big-endian: 4 bits length − 3, 12 bits distance − 1`. Platinum's `.lz` NARC members all use it
 * (no LZ11 in the files we import; an 0x11 header is rejected).
 */
export function isLz10(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x10;
}

export function decompressLz10(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x10) throw new Error(`LZ10: header byte 0x${(bytes[0] ?? 0).toString(16)}, expected 0x10`);
  const size = bytes[1]! | (bytes[2]! << 8) | (bytes[3]! << 16);
  const out = new Uint8Array(size);
  let src = 4;
  let dst = 0;
  const byte = () => {
    if (src >= bytes.length) throw new Error(`LZ10: input ends after ${dst} of ${size} bytes`);
    return bytes[src++]!;
  };
  while (dst < size) {
    const flags = byte();
    for (let bit = 7; bit >= 0 && dst < size; bit--) {
      if (!(flags & (1 << bit))) {
        out[dst++] = byte();
        continue;
      }
      const hi = byte();
      const lo = byte();
      const length = (hi >> 4) + 3;
      const from = dst - (((hi & 15) << 8) | lo) - 1;
      if (from < 0) throw new Error(`LZ10: back-reference before the start at output byte ${dst}`);
      if (dst + length > size) throw new Error(`LZ10: back-reference past the end (${dst + length} > ${size})`);
      for (let k = 0; k < length; k++) out[dst++] = out[from + k]!;
    }
  }
  return out;
}

/**
 * LZ10 compression (greedy, longest match in the 4 KB window). Our fixture writer: tests build
 * compressed members from original bytes with it. Not used on the import path.
 */
export function compressLz10(data: Uint8Array): Uint8Array {
  if (data.length >= 1 << 24) throw new Error('LZ10: input over 16 MB');
  const out: number[] = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff];
  let i = 0;
  while (i < data.length) {
    const flagAt = out.length;
    out.push(0);
    for (let bit = 7; bit >= 0 && i < data.length; bit--) {
      let bestLen = 0;
      let bestDist = 0;
      for (let d = 1; d <= Math.min(4096, i); d++) {
        let n = 0;
        while (n < 18 && i + n < data.length && data[i + n] === data[i - d + n]) n++;
        if (n > bestLen) {
          bestLen = n;
          bestDist = d;
        }
      }
      if (bestLen >= 3) {
        out[flagAt]! |= 1 << bit;
        out.push(((bestLen - 3) << 4) | ((bestDist - 1) >> 8), (bestDist - 1) & 0xff);
        i += bestLen;
      } else out.push(data[i++]!);
    }
  }
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}
