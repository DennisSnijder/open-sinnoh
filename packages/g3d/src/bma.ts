import { block, readDict, readNitroFile } from './nitro.ts';

/** MAT0: five material channels (RGB555 diffuse/ambient/specular/emission, then 5-bit alpha).
 * Each descriptor stores constant bit 29, sample count bits 16–28, and inline value/offset bits 0–15.
 * Colours use u16 samples, alpha u8; offsets are relative to the animation. */
export function readColorAnimations(bytes: Uint8Array) {
  const f = readNitroFile(bytes, 'BMA0');
  const r = f.reader;
  const base = block(f, 'MAT0');
  return readDict(r, base + 8).map(({ name, data }) => {
    const a = base + r.u32(data);
    if (r.ascii(a, 4) !== 'M\0AM') throw new Error(`MAT0 ${name}: bad animation magic`);
    const frames = r.u16(a + 4);
    const materials = readDict(r, a + 8).map(({ name: material, data: d }) => {
      const channels = Array.from({ length: 5 }, (_, c) => {
        const info = r.u32(d + c * 4);
        if (info & 0xc0000000) throw new Error(`MAT0 ${name}: stepped track unsupported`);
        const value = info & 0xffff;
        if (info & 0x20000000) return value;
        if (((info >>> 16) & 0x1fff) !== frames) throw new Error(`MAT0 ${name}: sample count differs from frames`);
        return Array.from({ length: frames }, (_, i) => c === 4 ? r.u8(a + value + i) : r.u16(a + value + i * 2));
      });
      return { material, diffuse: channels[0]!, ambient: channels[1]!, specular: channels[2]!, emission: channels[3]!, alpha: channels[4]! };
    });
    return { name, frames, materials };
  });
}
