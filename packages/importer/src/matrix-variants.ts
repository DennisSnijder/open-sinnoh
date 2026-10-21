import type { Matrix, MatrixVariant } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/**
 * The overworld matrix's map-load edits (decomp field_map_change.c FieldMapChange_InitTerrainCollisionManager, map_matrix.c):
 * until the Spring Path is found (the Distortion World's end, or the Hall of Fame), MapMatrix_RevealSpringPath puts
 * land 176 at altitude 2 over its four cells, closing it off Route 214; once Oak's Letter has shown the Seabreak Path,
 * MapMatrix_RevealSeabreakPath swaps in its land off Route 224. Both act on matrix 0 only.
 */
interface Edit {
  cells: { x: number; z: number; land: number; altitude?: number }[];
  /** Applied while the hidden location's var equals (`true`) or differs from (`false`) its found value. */
  whenFound: boolean;
  var: Id;
  value: number;
}

export function matrixVariants(base: Matrix, chunk: (land: number) => Id, hidden: { springPath: { var: Id; value: number }; seabreakPath: { var: Id; value: number } }): Matrix[] {
  if (base.sourceIndex !== 0) throw new Error(`matrix variants: ${base.id} is not matrix 0`);
  const spring: Edit = {
    cells: [
      { x: 23, z: 21, land: 176, altitude: 2 },
      { x: 24, z: 21, land: 176, altitude: 2 },
      { x: 23, z: 22, land: 176, altitude: 2 },
      { x: 24, z: 22, land: 176, altitude: 2 },
    ],
    whenFound: false,
    ...hidden.springPath,
  };
  const seabreak: Edit = {
    cells: [
      { x: 28, z: 15, land: 119 },
      { x: 27, z: 16, land: 120 },
      { x: 28, z: 16, land: 121 },
      { x: 27, z: 17, land: 122 },
    ],
    whenFound: true,
    ...hidden.seabreakPath,
  };
  const out: Matrix[] = [];
  const variants: MatrixVariant[] = [];
  // Most specific first: the first variant whose conditions all hold is loaded.
  for (const [suffix, edits] of [
    ['spring-path-closed-seabreak-path', [spring, seabreak]],
    ['spring-path-closed', [spring]],
    ['seabreak-path', [seabreak]],
  ] as const) {
    const m: Matrix = { ...base, id: `${base.id}/${suffix}` as Id, chunks: [...base.chunks], altitudes: base.altitudes ? [...base.altitudes] : base.chunks.map(() => 0) };
    delete m.variants;
    delete m.sourceIndex;
    for (const e of edits)
      for (const c of e.cells) {
        const i = c.x + c.z * base.width;
        if (base.chunks[i] === null || base.chunks[i] === undefined) throw new Error(`matrix variants: cell ${c.x},${c.z} of ${base.id} is empty`);
        m.chunks[i] = chunk(c.land);
        if (c.altitude !== undefined) m.altitudes![i] = c.altitude;
      }
    out.push(m);
    variants.push({ matrix: m.id, when: edits.map((e) => ({ var: e.var, value: e.value, equals: e.whenFound })) });
  }
  base.variants = variants;
  return out;
}
