import { expect, it } from 'vitest';
import { readColorAnimations } from './bma.ts';
import { Writer, writeDict, writeNitroFile } from './testing/writer.ts';

function fixture(stepped = false) {
  const w = new Writer();
  w.ascii('MAT0');
  const size = w.u32(0);
  let offset = 0;
  writeDict(w, ['original'], 4, () => { offset = w.u32(0); });
  const start = w.length;
  w.setU32(offset, start);
  w.ascii('M\0AM'); w.u16(3); w.u16(0);
  let alpha = 0;
  let diffuse = 0;
  writeDict(w, ['smoke'], 20, () => {
    diffuse = w.u32(0);
    w.u32(0x20000000 | 0x03e0); w.u32(0x20000000); w.u32(0x20000000 | 0x7c00);
    alpha = w.u32(0);
  });
  w.setU32(diffuse, (3 << 16) | (w.length - start));
  [31, 992, 31744].forEach(v => w.u16(v));
  w.setU32(alpha, (stepped ? 0x40000000 : 0) | (3 << 16) | (w.length - start));
  [31, 15, 0].forEach(v => w.u8(v));
  w.setU32(size, w.length);
  return writeNitroFile('BMA0', [w.done()]);
}
it('decodes original RGB555 samples and constants, and byte alpha samples', () => {
  expect(readColorAnimations(fixture())).toEqual([{ name: 'original', frames: 3, materials: [{ material: 'smoke', diffuse: [31, 992, 31744], ambient: 992, specular: 0, emission: 31744, alpha: [31, 15, 0] }] }]);
});
it('rejects unsupported sample steps at the asset boundary', () => {
  expect(() => readColorAnimations(fixture(true))).toThrow('stepped track');
});
