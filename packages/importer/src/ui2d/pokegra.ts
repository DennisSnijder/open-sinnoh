/**
 * Platinum battle sprite pictures (pl_pokegra, pl_otherpoke, the trainer "scan" pictures): a scanned
 * (linear) 4bpp NCGR of 160×80 px, two 80×80 frames side by side, whose character data is XOR-scrambled
 * with the Gen 4 LCRNG (decomp `PokemonSprite_DecryptPt`): the seed is the first u16; each u16 in order
 * is XORed with the low 16 bits of the seed, then the seed advances (seed · 1103515245 + 24691).
 * (D/P's own NARCs run the same stream from the last u16 backwards; Platinum's are front to back.)
 */
import { indexes, readNcgrData } from './nitro2d.ts';

export const MON_WIDTH = 160;
export const MON_HEIGHT = 80;

/** Unscrambles 4bpp scanned character data in place (Platinum order). */
export function decryptPt(data: Uint8Array): void {
  if (data.length % 2) throw new Error(`pokegra: ${data.length} bytes is not a whole number of u16`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let seed = v.getUint16(0, true);
  for (let i = 0; i < data.length; i += 2) {
    v.setUint16(i, v.getUint16(i, true) ^ (seed & 0xffff), true);
    seed = (Math.imul(seed, 1103515245) + 24691) >>> 0;
  }
}

/** Scrambles (the inverse of `decryptPt`) with a chosen seed: our fixture writer. */
export function encryptPt(data: Uint8Array, seed: number): void {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let s = seed & 0xffff;
  for (let i = 0; i < data.length; i += 2) {
    v.setUint16(i, v.getUint16(i, true) ^ (s & 0xffff), true);
    s = (Math.imul(s, 1103515245) + 24691) >>> 0;
  }
}

/** A decoded picture: palette indexes, row-major, 160×80. */
export function readMonPicture(member: Uint8Array): Uint8Array {
  const c = readNcgrData(member);
  if (!c.scanned || c.bitDepth !== 4) throw new Error(`pokegra: expected a scanned 4bpp NCGR (scanned ${c.scanned}, ${c.bitDepth}bpp)`);
  if (c.data.length !== (MON_WIDTH * MON_HEIGHT) / 2) throw new Error(`pokegra: ${c.data.length} bytes, expected ${(MON_WIDTH * MON_HEIGHT) / 2}`);
  decryptPt(c.data);
  return indexes(c.data, 4);
}
