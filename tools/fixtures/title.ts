/**
 * Original fixture title model (designed here): a small lantern of boxes in flat colours. The app draws
 * the OpenSinnoh wordmark over it, as on the ROM.
 */
import { box, writeGltf } from './gltf.ts';

/** A lantern of boxes (base, posts, glass, cap, handle), unlit flat colours, origin at the base centre. */
export function fixtureTitleModel(): string {
  return writeGltf(
    'title-lantern',
    [
      { name: 'metal', color: [0.23, 0.26, 0.34, 1] },
      { name: 'glass', color: [1, 0.78, 0.35, 1] },
    ],
    [
      { material: 0, ...merge(box([-26, 0, -26], [26, 10, 26]), box([-30, 70, -30], [30, 78, 30]), box([-12, 78, -12], [12, 86, 12]), box([-4, 86, -4], [4, 100, 4]), ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([sx * 22 - 2, 10, sz * 22 - 2], [sx * 22 + 2, 70, sz * 22 + 2])))) },
      { material: 1, ...box([-20, 10, -20], [20, 70, 20]) },
    ],
  );
}

function merge(...gs: { positions: number[]; uvs: number[] }[]) {
  return { positions: gs.flatMap((g) => g.positions), uvs: gs.flatMap((g) => g.uvs) };
}
