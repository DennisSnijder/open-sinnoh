import type { Facing, FeatureModelView, VillaFurnitureRow, VillaTables } from '@opensinnoh/contracts';
import { newGameRecord } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { slotOf, type FeatureHost, type MapFeature } from './gyms/feature.ts';

/**
 * The Villa's furniture (decomp src/overlay005/villa_furniture.c; docs/research/villa-journal.md §1.4). Built on each
 * map load from the furniture flags (Villa_DynamicMapFeaturesInit): every placement of an owned piece loads its prop
 * (rotation 0). Nothing changes mid-visit; a purchase warps into the Villa again. A collidable owned placement blocks
 * the player inside its inclusive box (Villa_DynamicMapFeaturesCheckCollision) and, faced with A, starts its piece's
 * script (FieldSystem_TrySetVillaFurnitureScript), the TV only when facing north.
 */
export class Villa implements MapFeature {
  private readonly t: VillaTables;
  /** The placements of owned pieces, in table order. */
  private readonly rows: VillaFurnitureRow[];

  constructor(h: FeatureHost) {
    slotOf(h.state, 'villa');
    const t = newGameRecord(h.reg).villa;
    if (!t) throw new Error('world: the Villa feature is selected but NewGame.villa is missing (the import reads overlay 5)');
    this.t = t;
    const owned = (type: number) => {
      const flag = t.furniture[type]!.flag;
      return h.state.flags[flag] ?? h.reg.flags.get(flag)!.initial;
    };
    this.rows = t.rows.filter((r) => owned(r.type));
  }

  /** CheckFurnitureCollision over the placements, in table order. */
  private at(x: number, z: number): VillaFurnitureRow[] {
    return this.rows.filter((r) => r.collision && z >= r.box.top && z <= r.box.bottom && x >= r.box.left && x <= r.box.right);
  }

  blocks(x: number, z: number): boolean {
    return this.at(x, z).length > 0;
  }

  interact(x: number, z: number, facing: Facing): Id | null {
    for (const r of this.at(x, z)) {
      if (r.type === this.t.tvType && facing !== 'up') continue;
      return this.t.furniture[r.type]!.label;
    }
    return null;
  }

  step(): void {}

  busy(): boolean {
    return false;
  }

  view(): ReturnType<MapFeature['view']> {
    const models: FeatureModelView[] = this.rows.map((r) => ({ key: `villa-${this.t.rows.indexOf(r)}`, prop: this.t.furniture[r.type]!.prop, position: [...r.position], rotation: [0, 0, 0] }));
    return { effects: [], features: { models } };
  }
}
