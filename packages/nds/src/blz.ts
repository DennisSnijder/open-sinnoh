/**
 * Nitro backward LZ ("BLZ"), the compression of DS executables (the ARM9 static module and its overlays;
 * HeartGold/SoulSilver compress 127 of their 129 overlays, Platinum none). Written from the format, not
 * from any tool's code. The compressed block sits at the end of its region and ends in an 8-byte footer:
 *
 *   u32 at end − 8: bits 0–23 the block's length (stream + footer, counted back from the end),
 *                   bits 24–31 the footer's length (8, or more with 0xFF padding before it)
 *   u32 at end − 4: how many bytes longer the output is than the region
 *
 * Bytes before the block are stored as they are. The stream is read backwards from just before the
 * footer: a flag byte (MSB first), then 8 items; flag 0 = one literal byte, 1 = a u16 read backwards as
 * high byte then low byte: 4 bits length − 3, 12 bits distance − 3, copied from that far above the output
 * position (the output is written backwards from its end too).
 */
export function decompressBackward(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  if (n < 8) throw new Error(`BLZ: ${n} bytes, too short for a footer`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n);
  const block = view.getUint32(n - 8, true) & 0xffffff;
  const footer = bytes[n - 5]!;
  const extra = view.getUint32(n - 4, true);
  if (footer < 8 || footer > block || block > n) throw new Error(`BLZ: footer ${footer} and block ${block} do not fit ${n} bytes`);
  const prefix = n - block;
  const out = new Uint8Array(n + extra);
  out.set(bytes.subarray(0, prefix));
  let src = n - footer;
  let dst = out.length;
  const read = () => {
    if (src <= prefix) throw new Error(`BLZ: the stream ends with ${dst - prefix} bytes still to write`);
    return bytes[--src]!;
  };
  while (dst > prefix) {
    const flags = read();
    for (let bit = 7; bit >= 0 && dst > prefix; bit--) {
      if (!(flags & (1 << bit))) {
        out[--dst] = read();
        continue;
      }
      const hi = read();
      const lo = read();
      const length = (hi >> 4) + 3;
      const distance = (((hi & 15) << 8) | lo) + 3;
      if (dst + distance > out.length) throw new Error(`BLZ: a back-reference past the end at output byte ${dst}`);
      if (dst - length < prefix) throw new Error(`BLZ: a back-reference into the stored bytes at output byte ${dst}`);
      for (let k = 0; k < length; k++) {
        dst--;
        out[dst] = out[dst + distance]!;
      }
    }
  }
  if (src !== prefix) throw new Error(`BLZ: ${src - prefix} stream bytes left over`);
  return out;
}

/**
 * Backward LZ compression (greedy, longest match): our fixture writer, so tests build executables from
 * original bytes. Not used on the import path. `stored` leading bytes stay uncompressed (the ARM9's secure
 * area does).
 */
export function compressBackward(data: Uint8Array, stored = 0): Uint8Array {
  if (stored > data.length) throw new Error('BLZ: more stored bytes than data');
  // Work on the reversed tail: the stream then reads like a forward LZ (distance ≥ 3).
  const r = data.slice(stored).reverse();
  const stream: number[] = [];
  let i = 0;
  while (i < r.length) {
    const flagAt = stream.length;
    stream.push(0);
    for (let bit = 7; bit >= 0 && i < r.length; bit--) {
      let bestLen = 0;
      let bestDist = 0;
      for (let d = 3; d <= Math.min(0x1002, i); d++) {
        let k = 0;
        while (k < 18 && i + k < r.length && r[i + k] === r[i - d + k]) k++;
        if (k > bestLen) {
          bestLen = k;
          bestDist = d;
        }
      }
      if (bestLen >= 3) {
        stream[flagAt]! |= 1 << bit;
        stream.push(((bestLen - 3) << 4) | ((bestDist - 3) >> 8), (bestDist - 3) & 0xff);
        i += bestLen;
      } else stream.push(r[i++]!);
    }
  }
  // Stored forwards, the stream is the reverse of the order it is read in.
  stream.reverse();
  let footer = 8;
  while ((stored + stream.length + footer) % 4) footer++;
  const block = stream.length + footer;
  const out = new Uint8Array(stored + block);
  out.set(data.subarray(0, stored));
  out.set(stream, stored);
  out.fill(0xff, stored + stream.length, out.length - 8);
  const view = new DataView(out.buffer);
  view.setUint32(out.length - 8, (block & 0xffffff) | (footer << 24), true);
  view.setUint32(out.length - 4, data.length - out.length, true);
  return out;
}
