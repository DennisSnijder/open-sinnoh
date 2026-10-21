import { block, readDict, readNitroFile } from './nitro.ts';

/** VIS0: V\0AV, u16 frames/nodes, u32 byte length, followed by frame-major packed visibility bits. */
export function readVisibilityAnimations(bytes: Uint8Array): { name: string; frames: number; nodes: number; visible: boolean[][] }[] {
  const f = readNitroFile(bytes, 'BVA0'),
    r = f.reader,
    base = block(f, 'VIS0');
  return readDict(r, base + 8).map(({ name, data }) => {
    const a = base + r.u32(data);
    if (r.ascii(a, 4) !== 'V\0AV') throw new Error(`VIS0 ${name}: bad animation magic`);
    const frames = r.u16(a + 4),
      nodes = r.u16(a + 6),
      size = r.u32(a + 8);
    if (size !== 12 + Math.ceil((frames * nodes) / 32) * 4) throw new Error(`VIS0 ${name}: invalid bit count`);
    const visible = Array.from({ length: frames }, (_, frame) =>
      Array.from({ length: nodes }, (_, node) => {
        const bit = frame * nodes + node;
        return !!(r.u8(a + 12 + (bit >> 3)) & (1 << (bit & 7)));
      }),
    );
    return { name, frames, nodes, visible };
  });
}
