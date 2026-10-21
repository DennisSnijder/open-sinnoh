import { Reader } from './bytes.ts';

/** NARC archive: returns member views into the input (no copies). Only BTAF/BTNF/GMIF with unnamed members are expected. */
export function readNarc(bytes: Uint8Array): Uint8Array[] {
  const r = new Reader(bytes);
  if (r.ascii(0, 4) !== 'NARC') throw new Error(`NARC: bad magic "${r.ascii(0, 4)}"`);
  const headerSize = r.u16(0x0c);
  let o = headerSize;
  if (r.ascii(o, 4) !== 'BTAF') throw new Error('NARC: missing BTAF');
  const count = r.u16(o + 8);
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) ranges.push([r.u32(o + 12 + i * 8), r.u32(o + 16 + i * 8)]);
  o += r.u32(o + 4);
  if (r.ascii(o, 4) !== 'BTNF') throw new Error('NARC: missing BTNF');
  o += r.u32(o + 4);
  if (r.ascii(o, 4) !== 'GMIF') throw new Error('NARC: missing GMIF');
  const base = o + 8;
  return ranges.map(([s, e]) => r.slice(base + s, base + e));
}
