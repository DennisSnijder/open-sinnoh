import type { Id } from '@opensinnoh/core';
import type { EffectView, Facing, FeaturesView, GameState, GymTables, MapFeatures, ObjectEvent, Registries, StubLog, WarpEvent, Zone } from '@opensinnoh/contracts';
import { newGameRecord } from '@opensinnoh/contracts';
import type { FieldSound } from '../sound.ts';
import type { Actor } from '../npc.ts';

/**
 * The map's dynamic features (decomp dynamic_map_features.c): the runtime side of `GameState.mapFeatures`,
 * built on every map load from the saved slot (DynamicMapFeatures_Init) and dropped with the map
 * (DynamicMapFeatures_Free). The world asks it at the decomp's hook points; a feature answers the ones
 * its gym has.
 */
export interface MapFeature {
  /**
   * The feature's dynamic height plate on a tile (DynamicTerrainHeightManager), or null off it: the world
   * weighs it against the BDHC height as TerrainCollisionManager's GetHeight does.
   */
  plate?(tx: number, tz: number): number | null;
  /**
   * DynamicMapFeatures_CheckCollision answering for the tile (Canalave): its answer replaces the map's
   * collision for the player. `blocks` instead only adds to it.
   */
  collides?(x: number, z: number): boolean;
  /** Field_ProcessStep's first check after a completed player step: true when the feature took the step (a ride started). */
  stepped?(): boolean;
  /** DynamicMapFeatures_CheckCollision (the player only): true = the tile is blocked. */
  blocks?(x: number, z: number): boolean;
  /** DynamicMapFeatures_WillPlayerJumpEternaGymClock: walking `dir` into x/z jumps. */
  jumps?(x: number, z: number, dir: Facing): boolean;
  /** Field_CheckMapTransition, before the warp checks: pushing `dir` started a task (Veilstone's bags). */
  push?(dir: Facing): boolean;
  /** Field_CheckMapTransition's door warp: the arrival facing (Hearthome's wrong doors face south). */
  doorFacing?(x: number, z: number, facing: Facing): Facing;
  /** field_control.c after FieldSystem_CheckForTrainersWantingBattle: a trainer the player faces (Hearthome). */
  playerSight?(): { trainer: Actor; distance: number; dir: Facing } | null;
  /** HearthomeGym_SetTrainerPostBattleMovement: true when the feature set the trainer's movement itself. */
  trainerAfterBattle?(trainer: Actor): boolean;
  /** One tick of the feature's task, if any (before the actors move). */
  step(): void;
  /** A task runs: the field is not idle and the player takes no input. */
  busy(): boolean;
  /** What the renderer draws: effects (keys from `FEATURE_EFFECT_KEYS`), models and fog. */
  view(): { effects: EffectView[]; features: FeaturesView | null };
}

/** Effect keys of map features start here, clear of `Effects`' own counter. */
export const FEATURE_EFFECT_KEYS = 1_000_000;

/** What a feature may use of the world. */
export interface FeatureHost {
  readonly reg: Registries;
  readonly state: GameState;
  readonly log: StubLog;
  readonly sound: FieldSound;
  zone(): Zone;
  hero(): Actor;
  /** The live event objects. */
  objects(): Iterable<Actor>;
  /** This visit's warp events (the zone's copy; edits last until the next map load). */
  warps(): WarpEvent[];
  /** Adds an object the feature owns (invisible, no event, not in `GameState.objects`); it collides like any object. */
  addObject(a: Actor): void;
  removeObject(a: Actor): void;
  /** An object on x/z (current or previous tile), the player included. */
  occupant(x: number, z: number): Actor | null;
  /** A camera object at x/z the camera tracks (decomp Camera_TrackTarget on a hidden map object), or null for the player. */
  trackCamera(x: number, z: number): Actor;
  releaseCamera(): void;
  heightAt(wx: number, wz: number, current: number): number;
  blocked(x: number, z: number): boolean;
  /** The tile behaviour's name at x/z. */
  behaviour(x: number, z: number): string;
  /** The props the zone's chunks place on tile x/z (by placement position; decomp's 1×1 prop hitbox). */
  propsAt(x: number, z: number): Id[];
  varValue(id: Id): number;
  setVar(id: Id, value: number): void;
  /** Trainer sight's path test (IsPathInterrupted). */
  sightBlocked(t: Actor, dir: Facing, distance: number): boolean;
  /** FieldSystem_IsTrainerDefeated's real meaning: a NORMAL or VIEW_ALL_DIRECTIONS trainer whose flag is clear. */
  undefeatedTrainer(t: Actor): boolean;
  /** The player's sprite override (Hearthome's gym avatar), or null for the state's. */
  setPlayerSprite(sprite: Id | null): void;
  switchMovementType(a: Actor, movementType: number): void;
  /** PlayerAvatar_SetHeightCalculationEnabled(AndUpdate). */
  setHeightCalculation(enabled: boolean): void;
  /**
   * FieldMap_ChangeZoneDistortionWorld: the zone (and its matrix) changes under the player without a load, as a
   * Distortion World elevator crosses floors: map flags and vars cleared, no onTransition, other zones' objects
   * that are not persistent deleted.
   */
  changeFloor(zone: Id): void;
  /** Spawns an object of `zone` from its event, as a script's add_object would (Distortion World objects). */
  spawnObject(zone: Id, ev: ObjectEvent): Actor;
  /** Deletes an object without touching its hide flag (decomp MapObject_Delete). */
  deleteObject(a: Actor): void;
  /** The object a script names by local id (the player for LOCALID_PLAYER), or null. */
  objectById(localId: number): Actor | null;
  /** Starts a movement list on an object, as apply_movement does (decomp MapObject_StartAnimation). */
  applySteps(a: Actor, steps: { op: string; count: number }[]): void;
  /** Starts a script of the zone (decomp ScriptManager_Set / ScriptManager_Start). */
  startScript(label: Id): void;
  scriptRunning(): boolean;
  /** An object changed its zone or local id (a Distortion World boulder or rider): script lookups follow it. */
  rekeyObjects(): void;
}

/** `NewGame.gyms`, required in a zone whose script selects a gym feature. */
export function gymTables(reg: Registries): GymTables {
  const gyms = newGameRecord(reg).gyms;
  if (!gyms) throw new Error('world: a gym feature is selected but NewGame.gyms is missing (the import reads overlay 8)');
  return gyms;
}

export type FeatureOf<K extends MapFeatures['kind']> = Extract<MapFeatures, { kind: K }>;

/** The saved slot of `kind`, or a loud failure (decomp PersistedMapFeatures_GetBuffer asserts the id). */
export function slotOf<K extends MapFeatures['kind']>(state: GameState, kind: K): FeatureOf<K> {
  const f = state.mapFeatures;
  if (f?.kind !== kind) throw new Error(`world: map features are ${f?.kind ?? 'none'}, not ${kind}`);
  return f as FeatureOf<K>;
}
