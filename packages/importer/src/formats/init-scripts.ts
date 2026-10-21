import { Reader } from '@opensinnoh/nds';

/**
 * Level-script ("init script") file in scr_seq (decomp asm/macros/scrcmd.inc InitScriptEntry_*):
 *   repeat { u8 type; type 1: s32 rel (table at end-of-field + rel); types 2/3/4: u16 scriptId, u16 0 } until type 0
 *   frame table rows: u16 var, u16 valueOrVar, u16 scriptId; ended by u16 0
 * Script ids are global script ids (1–1999 = the zone's own file, entry id-1).
 */
export interface InitScripts {
  onTransition?: number;
  onResume?: number;
  onLoad?: number;
  onFrame: { var: number; value: number; script: number }[];
}

const FIXED = { 2: 'onTransition', 3: 'onResume', 4: 'onLoad' } as const;

export function readInitScripts(bytes: Uint8Array): InitScripts {
  const r = new Reader(bytes);
  const out: InitScripts = { onFrame: [] };
  let o = 0;
  let tableAt: number | undefined;
  for (;;) {
    const type = r.u8(o++);
    if (type === 0) break;
    if (type === 1) {
      if (tableAt !== undefined) throw new Error('init scripts: two frame tables');
      tableAt = o + 4 + r.i32(o);
      o += 4;
    } else if (type === 2 || type === 3 || type === 4) {
      const key = FIXED[type];
      if (out[key] !== undefined) throw new Error(`init scripts: two ${key} entries`);
      if (r.u16(o + 2) !== 0) throw new Error(`init scripts: non-zero pad after type ${type}`);
      out[key] = r.u16(o);
      o += 4;
    } else throw new Error(`init scripts: unknown entry type ${type} at ${o - 1}`);
  }
  let end = o;
  if (tableAt !== undefined) {
    let t = tableAt;
    for (;;) {
      const v = r.u16(t);
      if (v === 0) {
        t += 2;
        break;
      }
      out.onFrame.push({ var: v, value: r.u16(t + 2), script: r.u16(t + 4) });
      t += 6;
    }
    end = Math.max(end, t);
  }
  // Files are padded to 4 bytes with zeros.
  for (let i = end; i < bytes.length; i++) if (r.u8(i) !== 0) throw new Error(`init scripts: unexpected byte at ${i} after the tables`);
  if (bytes.length - end > 7) throw new Error(`init scripts: ${bytes.length - end} trailing bytes`);
  return out;
}
