/**
 * Honey trees in the field (decomp overlay005/honey_tree.c): the tree props a matrix places, which shake while a
 * Pokémon waits. The DS attaches the shake when a map with a tree is loaded (DoTreeShakingAnimation, by the loaded map's
 * header) and keeps it until HoneyTree_StopShaking or the map unloads; here the loaded maps are the 3×3 chunks around
 * the player, re-checked when the player's chunk changes. The props are drawn by the world (`FieldView.props`).
 */
import { honeyTreeShake, readSpecialEncounters, type Id, type SpecialEncounterState } from '@opensinnoh/core';
import type { FeatureModelView, Registries, SpecialEncounterTables, Vec3 } from '@opensinnoh/contracts';
import { CHUNK_SIZE, CHUNK_TILES, TILE } from './tiles.ts';

export interface HoneyTreePlacement {
  key: string;
  cell: number;
  /** The tree id of the cell's zone (sHoneyTreeMapHeaderIDs), or null for a tree prop in another zone. */
  tree: number | null;
  tileX: number;
  tileZ: number;
  position: Vec3;
  rotation: Vec3;
}

/** Every honey tree prop of a matrix, in matrix-cell order (`zone`: the loading zone, for a matrix without zones per cell). */
export function honeyTreePlacements(reg: Registries, matrixId: Id, tables: SpecialEncounterTables['honeyTrees'], zone: Id): HoneyTreePlacement[] {
  const matrix = reg.matrices.get(matrixId);
  if (!matrix) throw new Error(`honey trees: no matrix ${matrixId}`);
  const out: HoneyTreePlacement[] = [];
  for (let cell = 0; cell < matrix.chunks.length; cell++) {
    const chunk = matrix.chunks[cell];
    if (!chunk) continue;
    const props = reg.chunks.get(chunk)?.props ?? [];
    for (const [i, pl] of props.entries()) {
      if (pl.prop !== tables.prop) continue;
      const x = (cell % matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2 + pl.position[0];
      const z = Math.floor(cell / matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2 + pl.position[2];
      const cellZone = matrix.zones ? matrix.zones[cell] : zone;
      const tree = cellZone ? tables.zones.indexOf(cellZone) : -1;
      out.push({
        key: `honey-tree-${cell}-${i}`,
        cell,
        tree: tree < 0 ? null : tree,
        tileX: Math.floor(x / TILE),
        tileZ: Math.floor(z / TILE),
        position: [x, (matrix.altitudes?.[cell] ?? 0) * 8 + pl.position[1], z],
        rotation: [...pl.rotation],
      });
    }
  }
  return out;
}

/** The shaking trees: placement key → the clip and the tick it started. */
export class HoneyTreeShakes {
  private shaking = new Map<string, { tree: number; clip: number; since: number }>();
  private loaded = new Set<number>();

  constructor(private readonly placements: readonly HoneyTreePlacement[], private readonly width: number) {}

  /**
   * The player's chunk is `cell`: trees in newly loaded chunks start shaking when a Pokémon waits (DoTreeShakingAnimation);
   * trees in chunks no longer loaded stop.
   */
  load(px: number, pz: number, state: { encounters?: SpecialEncounterState }, tick: number): void {
    const cx = Math.floor(px / CHUNK_TILES);
    const cz = Math.floor(pz / CHUNK_TILES);
    const now = new Set<number>();
    for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) if (x >= 0 && z >= 0 && x < this.width) now.add(z * this.width + x);
    const enc = readSpecialEncounters(state);
    for (const p of this.placements) {
      if (!now.has(p.cell)) {
        this.shaking.delete(p.key);
        continue;
      }
      if (this.loaded.has(p.cell) || p.tree === null) continue;
      const clip = honeyTreeShake(enc.honeyTrees[p.tree]!);
      if (clip !== null) this.shaking.set(p.key, { tree: p.tree, clip, since: tick });
    }
    this.loaded = now;
  }

  /** HoneyTree_StopShaking: the tree of that id stops. */
  stop(tree: number): void {
    for (const [key, s] of this.shaking) if (s.tree === tree) this.shaking.delete(key);
  }

  /** The tree props to draw, a shaking one with its looped clip. */
  view(prop: Id, clipTicks: (clip: number) => number, tick: number): FeatureModelView[] {
    return this.placements.map((p) => {
      const s = this.shaking.get(p.key);
      return {
        key: p.key,
        prop,
        position: p.position,
        rotation: p.rotation,
        ...(s ? { clip: { name: `shake-${s.clip}`, tick: (tick - s.since) % clipTicks(s.clip) } } : {}),
      };
    });
  }

  /** The placement keys shaking now (tests). */
  shakingTrees(): number[] {
    return [...new Set([...this.shaking.values()].map((s) => s.tree))];
  }
}
