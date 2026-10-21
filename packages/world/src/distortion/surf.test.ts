import { expect, it } from 'vitest';
import { CascadeMount, mountPosition } from './surf.ts';

it('turns the mount from ceiling to falling water and back to the floor on its own orbit', () => {
  const m = new CascadeMount(true);
  expect(mountPosition([0, 0, 0], m.pose(), 0)).toEqual([expect.closeTo(0), 28, 6]);
  for (let i = 0; i < 32; i++) m.turnIn();
  expect(m.pose()).toMatchObject({ rotation: [90, 270, 0], orbit: 20, fix: [0, 0, 10] });
  for (let i = 0; i < 70; i++) m.ride(1, 2);
  expect(m.pose().fix[2]).toBeCloseTo(-6, 1);
  expect(m.pose().bobFix).toBeCloseTo(-4, 1);
  for (let i = 0; i < 30; i++) m.ride(2, 2);
  for (let i = 0; i < 16; i++) m.turnOut(2);
  expect(m.pose()).toMatchObject({ rotation: [0, 270, 0], orbit: -90, externalBob: false });
  expect(m.pose().fix[2]).toBeCloseTo(-7, 1);
});

it('climbs quickly, swings around the rider, then resets for the ceiling', () => {
  const m = new CascadeMount(false);
  for (let i = 0; i < 4; i++) m.turnIn();
  expect(m.pose()).toMatchObject({ rotation: [-90, 270, 0], orbit: 20 });
  for (let i = 0; i < 16; i++) m.ride(1, 3);
  const riding = m.pose();
  expect(riding.fix[2]).toBe(10);
  const pos = mountPosition([10, 20, 30], riding, 0);
  expect(pos[0]).toBeCloseTo(10 + 20 * Math.cos(20 * Math.PI / 180));
  expect(pos[1]).toBeCloseTo(28 + 20 * Math.sin(20 * Math.PI / 180));
  expect(pos[2]).toBe(40);
  for (let i = 0; i < 2; i++) m.turnOut(3);
  expect(m.pose()).toMatchObject({ rotation: [0, 270, 0], orbit: 90, fix: [0, 0, 6], externalBob: false });
});
