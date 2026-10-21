import { expect, it } from 'vitest';
import { fogDensity } from '../composite.ts';
import { DISTORTION_FOG } from './index.ts';

it('fades the distant Distortion World into the sky over the DS 0x200 depth range', () => {
  // overlay009 InitFog: GX_FOGSLOPE_0x0200 spans the table in 0x200 depth units,
  // hence 16 per entry, not 0x200 per entry. The integer density increment is 88 / 32 = 2.
  expect(fogDensity(0x7600, DISTORTION_FOG)).toBe(0);
  expect(fogDensity(0x7700, DISTORTION_FOG)).toBe(32);
  expect(fogDensity(0x77f0, DISTORTION_FOG)).toBe(62);
  expect(fogDensity(0x7fff, DISTORTION_FOG)).toBe(62);
});
