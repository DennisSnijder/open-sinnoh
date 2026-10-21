/** The SPA reader on bytes from our own writer: every field and optional block survives the round trip. */
import { describe, expect, it } from 'vitest';
import type { ParticleEmitter } from '@opensinnoh/contracts';
import { readSpa, spaTexture, spaTextureParam } from './spa.ts';
import { writeSpa } from './spa-writer.ts';

const base: ParticleEmitter = {
  flags: 0x4000 | 0x10,
  basePos: [4096, -2048, 0],
  count: 2 * 4096,
  radius: 1024,
  length: 512,
  axis: [0, 4096, 0],
  color: 0x7fff,
  velPos: 100,
  velAxis: -50,
  scale: 4096,
  aspect: 4096,
  startDelay: 3,
  minRotation: -10,
  maxRotation: 20,
  initAngle: 0x4000,
  emitterLife: 12,
  particleLife: 20,
  attenuation: [10, 20, 30],
  interval: 2,
  alpha: 31,
  air: 128,
  texture: 1,
  loopFrames: 4,
  dbbScale: 8,
  tileS: 1,
  tileT: 2,
  scaleDir: 1,
  faceEmitter: true,
  flipS: true,
  flipT: false,
  polygonX: 0,
  polygonY: 0,
};

const full: ParticleEmitter = {
  ...base,
  flags: 0,
  scaleAnim: { start: 4096, mid: 8192, end: 2048, in: 40, out: 200, loop: true },
  colorAnim: { start: 0x001f, end: 0x7c00, in: 10, peak: 100, out: 200, randomStart: false, loop: false, interpolate: true },
  alphaAnim: { start: 0, mid: 31, end: 0, in: 50, out: 255, random: 10, loop: false },
  texAnim: { textures: [0, 1, 0], step: 30, randomStart: true, loop: true },
  child: { flags: 3, randomVel: 12, endScale: 2048, life: 9, velRatio: 128, scaleRatio: 64, color: 0x03e0, count: 2, delay: 1, interval: 3, texture: 1, tileS: 0, tileT: 1, flipS: false, flipT: true, faceEmitter: false },
  gravity: [0, -40, 0],
  random: { magnitude: [10, 20, 30], interval: 4 },
  magnet: { target: [4096, 0, -4096], force: 77 },
  spin: { angle: 300, axis: 1 },
  collision: { y: -8192, elasticity: 2048, type: 1 },
  convergence: { target: [0, 4096, 0], force: 99 },
};

// A 8×8 A3I5 texture (format 1) and an 8×16 A5I3 one (format 6), colour 0 transparent on the second.
const textures = [
  { param: 1 | (0 << 4) | (0 << 8), texels: new Uint8Array(64).map((_, i) => (7 << 5) | (i % 4)), palette: new Uint8Array([0, 0, 0x1f, 0, 0xe0, 0x03, 0, 0x7c]) },
  { param: 6 | (0 << 4) | (1 << 8) | (1 << 16), texels: new Uint8Array(128).map((_, i) => (i % 2 ? 31 << 3 : 0) | 1), palette: new Uint8Array([0, 0, 0xff, 0x7f]) },
];

describe('SPA reader', () => {
  it('reads back every emitter field and block it was written with', () => {
    const spa = readSpa(writeSpa([base, full], textures));
    expect(spa.emitters).toHaveLength(2);
    expect(spa.emitters[0]).toEqual(base);
    // The block bits are set from the blocks present.
    const got = spa.emitters[1]!;
    expect({ ...got, flags: 0 }).toEqual(full);
    expect(got.flags).not.toBe(0);
  });

  it('decodes the textures with their sizes and transparency', () => {
    const spa = readSpa(writeSpa([base], textures));
    expect(spaTextureParam(spa, 0) & 0xf).toBe(1);
    const a = spaTexture(spa, 0);
    expect([a.width, a.height]).toEqual([8, 8]);
    // A3I5: alpha 7 of 7 is opaque; texel 2 is palette index 2, pure green.
    expect([...a.rgba.slice(8, 12)]).toEqual([0, 255, 0, 255]);
    const b = spaTexture(spa, 1);
    expect([b.width, b.height]).toEqual([8, 16]);
    // A5I3: the even texels have alpha 0, the odd ones are opaque white.
    expect(b.rgba[3]).toBe(0);
    expect([...b.rgba.slice(4, 8)]).toEqual([255, 255, 255, 255]);
  });

  it('refuses a file that is not an SPA', () => {
    expect(() => readSpa(new Uint8Array(64))).toThrow();
  });
});
