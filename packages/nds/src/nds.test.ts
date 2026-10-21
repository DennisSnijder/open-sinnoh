import { describe, expect, it } from 'vitest';
import { decodeMessageBank, encodeMessageBank } from './message.ts';
import { readNarc } from './narc.ts';

/** Builds an original NARC from members (fixture writer). */
function writeNarc(members: Uint8Array[]): Uint8Array {
  const pad = (n: number) => (n + 3) & ~3;
  const btafSize = 12 + members.length * 8;
  const btnfSize = 16;
  let off = 0;
  const ranges = members.map((m) => {
    const r = [off, off + m.length] as const;
    off = pad(off + m.length);
    return r;
  });
  const gmifSize = 8 + off;
  const total = 16 + btafSize + btnfSize + gmifSize;
  const b = new Uint8Array(total);
  const v = new DataView(b.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, 'NARC');
  v.setUint16(4, 0xfffe, true);
  v.setUint16(6, 0x0100, true);
  v.setUint32(8, total, true);
  v.setUint16(12, 16, true);
  v.setUint16(14, 3, true);
  let o = 16;
  tag(o, 'BTAF');
  v.setUint32(o + 4, btafSize, true);
  v.setUint16(o + 8, members.length, true);
  ranges.forEach(([s, e], i) => {
    v.setUint32(o + 12 + i * 8, s, true);
    v.setUint32(o + 16 + i * 8, e, true);
  });
  o += btafSize;
  tag(o, 'BTNF');
  v.setUint32(o + 4, btnfSize, true);
  v.setUint32(o + 8, 4, true);
  v.setUint16(o + 14, 1, true);
  o += btnfSize;
  tag(o, 'GMIF');
  v.setUint32(o + 4, gmifSize, true);
  members.forEach((m, i) => b.set(m, o + 8 + (ranges[i] as readonly [number, number])[0]));
  return b;
}

describe('formats on original fixtures', () => {
  it('reads NARC members', () => {
    const members = [new Uint8Array([1, 2, 3]), new Uint8Array([]), new Uint8Array([9, 8, 7, 6, 5])];
    expect(readNarc(writeNarc(members)).map((m) => [...m])).toEqual(members.map((m) => [...m]));
  });

  it('round-trips message banks', () => {
    const msgs = [new Uint16Array([0x0123, 0xfffe, 0xffff]), new Uint16Array([]), new Uint16Array([1, 2, 3, 0xffff])];
    const decoded = decodeMessageBank(encodeMessageBank(msgs, 0x2c1));
    expect(decoded.map((m) => [...m])).toEqual(msgs.map((m) => [...m]));
  });
});
