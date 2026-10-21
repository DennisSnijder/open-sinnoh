import { expect, it } from 'vitest';
import { readVisibilityAnimations } from './bva.ts';
import { readSrtAnimations } from './anim.ts';
import { Writer, writeDict, writeNitroFile, writeBta0 } from './testing/writer.ts';
import { trsOf } from './gltf.ts';
it('VIS0 reads frame-major bits across frame boundaries (original five-node clip)', () => {
  const w = new Writer();
  w.ascii('VIS0');
  const size = w.u32(0);
  let ptr = 0;
  writeDict(w, ['original'], 4, () => {
    ptr = w.u32(0);
  });
  const start = w.length;
  w.setU32(ptr, start);
  w.ascii('V\0AV');
  w.u16(3);
  w.u16(5);
  w.u32(16);
  w.u32(21 | (10 << 5) | (31 << 10));
  w.setU32(size, w.length);
  const [a] = readVisibilityAnimations(writeNitroFile('BVA0', [w.done()]));
  expect(a!.visible).toEqual([
    [true, false, true, false, true],
    [false, true, false, true, false],
    [true, true, true, true, true],
  ]);
});
it('SRT0 decodes animated signed sin/cos pairs, independently of translation and scale', () => {
  const bytes = writeBta0('original', 3, [
    {
      material: 'paint',
      tracks: [{ const: 4096 }, { const: 4096 }, { fx32: [0x10000000 / 4096, 1, 0xf0000000 / 4096] }, { const: 0 }, { const: 0 }],
    },
  ]);
  const [a] = readSrtAnimations(bytes);
  expect(a!.materials[0]!.rotationFrames).toEqual([
    [0, 1],
    [1, 0],
    [0, -1],
  ]);
});
it('zero-scale hidden rest nodes produce finite TRS', () => {
  expect(trsOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 6, 1])).toEqual({
    translation: [4, 5, 6],
    rotation: [0, 0, 0, 1],
    scale: [0, 0, 0],
  });
});
