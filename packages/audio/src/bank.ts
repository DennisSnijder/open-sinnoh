import type { InstrumentRegion } from '@opensinnoh/contracts';
import { checkNitroHeader } from './sdat.ts';

/**
 * SBNK instrument banks (docs/research/audio.md §1.3): per program an instrument of type 1 (PCM), 2 (PSG
 * square), 3 (noise), 16 (drum set: one sub-instrument per key) or 17 (key split: up to 8 ranges).
 * Every instrument becomes a list of key regions.
 */

const TYPE_NAMES: Record<number, InstrumentRegion['type']> = { 1: 'pcm', 2: 'psg', 3: 'noise' };

export function readBank(bytes: Uint8Array): (InstrumentRegion[] | null)[] {
  const r = checkNitroHeader(bytes, 'SBNK');
  const block = r.u16(12);
  if (r.ascii(block, 4) !== 'DATA') throw new Error('SBNK: no DATA block');
  const n = r.u32(block + 0x28);
  const region = (type: number, o: number, low: number, high: number): InstrumentRegion => {
    const kind = TYPE_NAMES[type];
    if (!kind) throw new Error(`SBNK: instrument type ${type} at 0x${o.toString(16)} is not PCM, PSG or noise`);
    const out: InstrumentRegion = {
      low,
      high,
      type: kind,
      baseKey: r.u8(o + 4),
      attack: r.u8(o + 5),
      decay: r.u8(o + 6),
      sustain: r.u8(o + 7),
      release: r.u8(o + 8),
      pan: r.u8(o + 9),
    };
    if (kind === 'pcm') {
      out.wave = r.u16(o);
      out.archive = r.u16(o + 2);
      if (out.archive > 3) throw new Error(`SBNK: wave archive slot ${out.archive} at 0x${o.toString(16)}`);
    }
    if (kind === 'psg') {
      out.duty = r.u16(o);
      if (out.duty > 7) throw new Error(`SBNK: PSG duty ${out.duty} at 0x${o.toString(16)}`);
    }
    for (const k of ['baseKey', 'attack', 'decay', 'sustain', 'release', 'pan'] as const)
      if (out[k] > 127) throw new Error(`SBNK: ${k} ${out[k]} at 0x${o.toString(16)} is above 127`);
    return out;
  };
  return Array.from({ length: n }, (_, i): InstrumentRegion[] | null => {
    const e = block + 0x2c + i * 4;
    const type = r.u8(e);
    const o = r.u16(e + 1);
    if (type === 0) return null;
    if (type === 16) {
      const low = r.u8(o);
      const high = r.u8(o + 1);
      if (low > high) throw new Error(`SBNK: drum set ${i} keys ${low}..${high}`);
      const regions: InstrumentRegion[] = [];
      for (let k = low; k <= high; k++) {
        const s = o + 2 + (k - low) * 12;
        const t = r.u16(s);
        if (t === 0) continue;
        regions.push(region(t, s + 2, k, k));
      }
      return regions;
    }
    if (type === 17) {
      const regions: InstrumentRegion[] = [];
      let low = 0;
      let s = o + 8;
      for (let k = 0; k < 8; k++) {
        const high = r.u8(o + k);
        if (high === 0) break;
        const t = r.u16(s);
        if (t !== 0) regions.push(region(t, s + 2, low, high));
        low = high + 1;
        s += 12;
      }
      return regions;
    }
    return [region(type, o, 0, 127)];
  });
}
