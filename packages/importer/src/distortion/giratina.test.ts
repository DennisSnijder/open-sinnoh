import { expect, it } from 'vitest';
import { readTex0 } from '@opensinnoh/g3d';
import { writeBtx0 } from '@opensinnoh/g3d/testing';
import { giratinaAtlas } from './giratina.ts';

it('pads above rectangular frames, preserving their feet anchor, numeric order and palettes', () => {
  const texture = (name: string) => ({ name, format: '16c' as const, width: 128, height: 64, texels: Array(4096).fill(0x11) });
  const tex = readTex0(writeBtx0([texture('original.2'), texture('original.1')], [
    { name: 'first', colors: [0, 31, ...Array(14).fill(0)] },
    { name: 'second', colors: [0, 31 << 5, ...Array(14).fill(0)] },
  ]))!;
  const a = giratinaAtlas(tex);
  expect([a.width, a.frameSize, a.frameCount]).toEqual([256, 128, 2]);
  expect(a.frameOfTexture).toEqual([1, 0]);
  const pixel = (x: number, y: number) => [...a.rgba.slice((y * a.width + x) * 4, (y * a.width + x + 1) * 4)];
  expect(pixel(64, 63)).toEqual([0, 0, 0, 0]);
  expect(pixel(64, 64)).toEqual([255, 0, 0, 255]);
  expect(pixel(64, 127)).toEqual([255, 0, 0, 255]);
  expect(pixel(192, 127)).toEqual([0, 255, 0, 255]);
});
