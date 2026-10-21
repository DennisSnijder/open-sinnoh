import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Ceilings } from './ceilings.ts';

it('finds a bridge deck above the ground, excludes walls, and permits walking on the deck', () => {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(16, 64));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(8, 16, 16);
  group.add(deck);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 64));
  wall.position.set(40, 32, 16);
  group.add(wall);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(64, 64));
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = 1;
  group.add(decal);
  const ceilings = new Ceilings(group);
  expect(ceilings.above(8, 0, 16, true)?.height).toBeCloseTo(16);
  expect(ceilings.above(8, 16, 16, true)).toBeNull();
  expect(ceilings.above(24, 0, 16, true)).toBeNull();
  expect(ceilings.above(40, 0, 16, true)).toBeNull();
});

it('joins deck slopes and lips at shared vertices, includes steep roofs, and excludes grounded ramps', () => {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const triangles = [
    0,16,0, 8,16,0, 8,16,32, 0,16,0, 8,16,32, 0,16,32,
    0,16,0, 0,24,-16, 8,24,-16, 0,16,0, 8,24,-16, 8,16,0,
    8,16,0, 8,14,0, 8,14,32, 8,16,0, 8,14,32, 8,16,32,
    8,14,32, 10,14,36, 8,18,36,
    96,16,0, 112,36,0, 112,36,16, 96,16,0, 112,36,16, 96,16,16,
    64,0,0, 64,0,16, 80,24,16, 64,0,0, 80,24,16, 80,24,0,
  ];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  group.add(new THREE.Mesh(geometry));
  const ceilings = new Ceilings(group);
  const deck = ceilings.above(4, 0, 16, true)!;
  expect(deck.height).toBe(16);
  expect(deck.bounds.min.toArray()).toEqual([0, 10, -16]);
  expect(deck.bounds.max.toArray()).toEqual([10, 24, 36]);
  expect(ceilings.above(104, 0, 8, true)?.height).toBe(16); // The lower eave, not the height at the sample.
  expect(ceilings.above(78, 18, 8, true)).toBeNull();
});


it('leaves faces below half a tile over a walkable floor to upright depth, but caps over blocked tiles and above it', () => {
  // Original low boxes: one with its top 7 above the floor, one floating 11 above it.
  const box = (x: number, bottom: number, top: number) => {
    const geometry = new THREE.BoxGeometry(16, top - bottom, 32);
    geometry.translate(x, (top + bottom) / 2, 16);
    return new THREE.Mesh(geometry);
  };
  const group = new THREE.Group();
  group.add(box(8, 1, 7));
  group.add(box(40, 11, 13));
  const ceilings = new Ceilings(group);
  // Over a walkable tile the low top is at the actor's feet; over a blocked tile it caps the actor beside it.
  expect(ceilings.above(8, 0, 8, true)).toBeNull();
  expect(ceilings.above(8, 0, 8, false)?.height).toBe(7);
  // A face half a tile or more above the floor caps an actor standing under it.
  expect(ceilings.above(40, 0, 8, true)?.height).toBe(11);
  expect(ceilings.above(40, 0, 8, true)?.bounds.min.y).toBe(7);
});

it('builds each connected surface once per floor level and reuses it', () => {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 64));
  deck.position.set(8, 17, 16);
  group.add(deck);
  const ceilings = new Ceilings(group);
  const first = ceilings.above(8, 0, 16, true)!;
  expect(ceilings.above(8, 0, 16, true)).toBe(first);
  // The same faces stay above any floor below the deck's lowest edge: the same ceiling.
  expect(ceilings.above(4, 3.5, 8, true)).toBe(first);
  expect(first.bounds.min.toArray()).toEqual([0, 12, -16]);
});
