/**
 * The fixture's house door: an original BMD0 (one leaf hinged at its left edge) with BCA0 open/close
 * swings, written by our own g3d writer and converted by the same path as the ROM's doors
 * (readModels + readJointAnimations → modelToGltf with clips).
 */
import { modelToGltf, readJointAnimations, readModels } from '@opensinnoh/g3d';
import { gx, packDisplayList, writeBca0, writeBmd0 } from '@opensinnoh/g3d/testing';

/** Door swing: 8 frames (one per tick, as Platinum's door01), 0° → 90° about the hinge. */
export const DOOR_FRAMES = 8;

/** Leaf size in world units: one tile wide, 28 tall, posScale 4 keeps vertices inside fx16. */
const POS_SCALE = 4;
const WIDTH = 16;
const HEIGHT = 28;

export function doorGltf(): string {
  const v = (x: number, y: number) => gx.vtx16(x / POS_SCALE, y / POS_SCALE, 0);
  const dl = packDisplayList([gx.begin(1), gx.color(11, 7, 4), v(0, 0), v(WIDTH, 0), gx.color(14, 9, 5), v(WIDTH, HEIGHT), v(0, HEIGHT), gx.end()]);
  // Unlit (no light bits), both faces, opaque: the leaf shows from inside and outside when open.
  const [model] = readModels(writeBmd0([{ name: 'door', posScale: POS_SCALE, numVertex: 4, materials: [{ name: 'leaf', polyAttr: 0x1f00c0, diffAmb: 0 }], shapes: [{ name: 'leaf', dl }] }]));
  const swing = (from: number, to: number) =>
    Array.from({ length: DOOR_FRAMES }, (_, i) => {
      const a = ((from + ((to - from) * i) / (DOOR_FRAMES - 1)) * Math.PI) / 180;
      // pivot 4 (y axis), neg bit 1: a rotation about +y by -a (opens outward, toward +z)
      return { pivot: 4, neg: 2, a: Math.cos(a), b: Math.sin(a) };
    });
  const [open] = readJointAnimations(writeBca0('door_op', DOOR_FRAMES, [{ rotation: swing(0, 90) }]));
  const [close] = readJointAnimations(writeBca0('door_cl', DOOR_FRAMES, [{ rotation: swing(90, 0) }]));
  const { gltf } = modelToGltf(model!, { animations: [{ clip: 'open', animation: open! }, { clip: 'close', animation: close! }] });
  return JSON.stringify(gltf);
}
