/**
 * The Villa in the Resort Area (docs/research/villa-journal.md §1; decomp src/overlay005/villa_furniture.c,
 * system_vars.c SystemVars_UpdateVillaVisitor, ov5_021F6454.c ScrCmd_CheckMetFurnitureRequirements). The furniture is
 * one flag per piece; the field builds its props from the flags on each map load (`MapFeatures` `{ kind: 'villa' }`).
 */
import type { Id } from '@opensinnoh/core';

/** Decomp VILLA_FURNITURE_MAX: the 20 pieces, by type (VILLA_FURNITURE_TABLE … VILLA_FURNITURE_CHANDELIER). */
export const VILLA_FURNITURE_COUNT = 20;
/** Decomp VILLA_VISITOR_NONE (VAR_RESORT_VILLA_VISITOR). */
export const VILLA_VISITOR_NONE = 0xff;

/** One furniture type (decomp sVillaFurnitureModelIDs, sVillaFurnitureScriptIDs, FLAG_VILLA_FURNITURE_START + type). */
export interface VillaFurniture {
  /** The piece's ownership flag. */
  flag: Id;
  /** The build model prop (build_model member 559 + type). */
  prop: Id;
  /** The script talking to it starts (the Villa's script file entry, the TV's common broadcast script). */
  label: Id;
}

/**
 * One placement (decomp sVillaFurnitures row): a prop of `type` at x/y/z world units (fx32 / 4096), rotation 0, and,
 * when `collision`, the player-only collision and talk box in tiles (inclusive).
 */
export interface VillaFurnitureRow {
  type: number;
  collision: boolean;
  position: [number, number, number];
  box: { left: number; top: number; right: number; bottom: number };
}

/**
 * `NewGame.villa` (0.37.0): the Villa's zone, the Resort Area (no visitor is chosen while the saved map is either),
 * the furniture by type, the 23 placements, the TV's type (talked to only facing north), and the daily visitor's
 * state and odds (sVillaVisitorPercentChances and sNumPossibleVillaVisitors, by owned-piece band < 8, < 12, ≥ 12).
 */
export interface VillaTables {
  zone: Id;
  resortArea: Id;
  furniture: VillaFurniture[];
  rows: VillaFurnitureRow[];
  tvType: number;
  visitors: {
    chances: [number, number, number];
    counts: [number, number, number];
    /** VAR_RESORT_VILLA_VISITOR, VAR_RESORT_VILLA_VISITOR_MESSAGE_NUM. */
    visitorVar: Id;
    messageVar: Id;
    /** FLAG_VILLA_VISITOR_INSIDE, FLAG_VILLA_VISITOR_OUTSIDE. */
    insideFlag: Id;
    outsideFlag: Id;
  };
}

/** Decomp SystemVars_UpdateVillaVisitor's bands: index 0 below 8 owned pieces, 1 below 12, 2 from 12. */
export function villaVisitorBand(owned: number): 0 | 1 | 2 {
  return owned < 8 ? 0 : owned < 12 ? 1 : 2;
}
