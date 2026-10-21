/** The Distortion World sky (sky.ts): darkness from the player's height, the clouds' orbits and speeds. */
import { describe, expect, it } from 'vitest';
import { Sky } from './sky.ts';

describe('Distortion World sky', () => {
  it('darkens from 1F (y 289: none) to the Giratina room floor (y 65 and below: 12)', () => {
    const sky = new Sky('normal');
    sky.step(289 * 16);
    // (289 − 65) × 16 units over 12 levels: 1F stands at the top of the range.
    expect(sky.view().darkness).toBe(12);
    sky.step(65 * 16);
    expect(sky.view().darkness).toBe(0);
    sky.step(0);
    expect(sky.view().darkness).toBe(0);
    sky.step((65 + 112) * 16);
    expect(sky.view().darkness).toBe(6);
  });

  it('turns each cloud at its template speed around its centre', () => {
    const sky = new Sky('normal');
    sky.step(0);
    const [first] = sky.view().clouds;
    // Set 6, angle 0 + 1.25: cos/sin of the whole degree 1, radius 104, around (128, 108); turned 135°.
    expect(first!.set).toBe(6);
    expect(first!.x).toBeCloseTo(128 + Math.cos(Math.PI / 180) * 104, 6);
    expect(first!.y).toBeCloseTo(108 + Math.sin(Math.PI / 180) * 104, 6);
    expect(first!.rotation).toBe(136);
    expect(first!.scale).toBe(2);
    // The centre cloud does not orbit.
    expect(sky.view().clouds[8]).toMatchObject({ set: 5, x: 128, y: 128 });
  });

  it('eases a group toward its sky kind\'s speed by 0x200 a frame', () => {
    const sky = new Sky('normal');
    sky.kind = 'giratina-room';
    for (let i = 0; i < 4; i++) sky.step(0);
    // Group 0 (+0.5° a frame) takes 4 frames to reach it: 0.5 × 4096 / 0x200.
    const centre = () => sky.view().clouds[8]!.rotation;
    const before = centre();
    sky.step(0);
    expect((centre() - before + 360) % 360).toBe(1);
  });
});
