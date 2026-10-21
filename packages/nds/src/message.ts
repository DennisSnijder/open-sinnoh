import { Reader } from './bytes.ts';

/**
 * Gen 4 message bank: u16 count, u16 seed, then `count` (offset, length) pairs, each XOR-ed with a
 * per-entry key; strings are u16 char codes XOR-ed with a running key. Returns raw char codes;
 * mapping codes to text and control sequences is the text decoder's job.
 */
export function decodeMessageBank(bytes: Uint8Array): Uint16Array[] {
  const r = new Reader(bytes);
  const count = r.u16(0);
  const seed = r.u16(2);
  const out: Uint16Array[] = [];
  for (let i = 0; i < count; i++) {
    let k = Math.imul(Math.imul(seed, 765), i + 1) & 0xffff;
    k = (k | (k << 16)) >>> 0;
    const offset = (r.u32(4 + i * 8) ^ k) >>> 0;
    const length = (r.u32(8 + i * 8) ^ k) >>> 0;
    const codes = new Uint16Array(length);
    let key = Math.imul(i + 1, 596947);
    for (let j = 0; j < length; j++) {
      codes[j] = (r.u16(offset + j * 2) ^ key) & 0xffff;
      key += 18749;
    }
    out.push(codes);
  }
  return out;
}

/** Inverse of decodeMessageBank; used to build original test fixtures. */
export function encodeMessageBank(messages: readonly Uint16Array[], seed: number): Uint8Array {
  const tableEnd = 4 + messages.length * 8;
  const total = tableEnd + messages.reduce((n, m) => n + m.length * 2, 0);
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  v.setUint16(0, messages.length, true);
  v.setUint16(2, seed, true);
  let offset = tableEnd;
  messages.forEach((m, i) => {
    let k = Math.imul(Math.imul(seed, 765), i + 1) & 0xffff;
    k = (k | (k << 16)) >>> 0;
    v.setUint32(4 + i * 8, (offset ^ k) >>> 0, true);
    v.setUint32(8 + i * 8, (m.length ^ k) >>> 0, true);
    let key = Math.imul(i + 1, 596947);
    m.forEach((c, j) => {
      v.setUint16(offset + j * 2, (c ^ key) & 0xffff, true);
      key += 18749;
    });
    offset += m.length * 2;
  });
  return bytes;
}
