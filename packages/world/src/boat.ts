import type { Facing, Vec3, ShipSceneView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/**
 * The boat trips (decomp src/cutscenes/boat_cutscene/boat_cutscene.c FieldSystem_PlayBoatCutscene;
 * docs/research/story-scenes.md). Leaving Canalave (BOAT_TRAVEL_DIR_NORTH_TO_SOUTH) the ship by the player sails
 * south: 0.25 units a tick, 1.25 from its 24th update; the camera target follows it and pans 2 tiles east;
 * once 14 tiles out the two bridges play their one-shot clips; when both have ended and the ship is 25 tiles
 * out the screen fades (6 ticks). The return trip (SOUTH_TO_NORTH) starts at the fade. Then the cinematic runs
 * (canalave_ship.c: a fade in, its first animation to its last frame, a 6-tick fade out) and the map changes
 * to the destination, fading in. The renderer poses the standalone scene from view(), without advancing time.
 */

export const BOAT_TRAVEL_DIR = { southToNorth: 0, eastToWest: 1, westToEast: 2, northToSouth: 3 } as const;

/** goalDistance and bridgeDistance (tiles × MAP_OBJECT_TILE_SIZE) and the speeds (fx32 / 4096). */
const GOAL = 25 * 16;
const BRIDGE = 14 * 16;
const START_SPEED = 0.25;
const SPEED_TICKS = 24;
/** BoatCutscene_PanStartingCamera: one unit a tick until 2 tiles. */
const PAN = 2 * 16;
/** StartScreenFade(…, 6, 1) and App_StartScreenFade: 6 steps of 1 frame. */
const FADE_TICKS = 6;

export interface BoatHost {
  /** The ship's placement (world units), found in the 3×6 tiles from (x + 1, z − 3) of the player. */
  ship(): Vec3;
  bridgeFrames(): [number, number];
  cinematicFrames(travelDir: number): number;
  fade(kind: 'in' | 'out', ticks: number): void;
  fadeDone(): boolean;
  /** The map change (FieldTask_ChangeMapToLocation, warp -1) and its fade in. */
  changeMap(zone: Id, x: number, z: number, facing: Facing): void;
  warpDone(): boolean;
}

type Phase = 'depart' | 'fade-out' | 'cinematic' | 'map' | 'done';

export class BoatTrip {
  private phase: Phase;
  private speed = START_SPEED;
  private speedTick = 0;
  private distance = 0;
  private pan = 0;
  /** The ship's offset from its placement and the camera's from the player (world units). */
  readonly shipOffset: Vec3 = [0, 0, 0];
  readonly cameraOffset: Vec3 = [0, 0, 0];
  /** The bridges' clip frames once triggered (null before). */
  bridges: [number, number] | null = null;
  private bridgeReached = false;
  private cinematic = { tick: 0, frames: 0 };

  constructor(
    private readonly h: BoatHost,
    readonly travelDir: number,
    private readonly exit: Facing,
    private readonly zone: Id,
    private readonly x: number,
    private readonly z: number,
  ) {
    if (travelDir === BOAT_TRAVEL_DIR.northToSouth || travelDir === BOAT_TRAVEL_DIR.westToEast) {
      h.ship();
      this.phase = 'depart';
    } else this.phase = 'fade-out';
  }

  view(): ShipSceneView | undefined {
    return this.phase === 'cinematic' && this.cinematic.tick >= 0
      ? { direction: this.travelDir, tick: this.cinematic.tick, frames: this.cinematic.frames }
      : undefined;
  }

  done(): boolean {
    return this.phase === 'done';
  }

  /** One frame of FieldSystem_PlayBoatCutsceneStep (and the child task's cinematic). */
  step(): void {
    switch (this.phase) {
      case 'depart': {
        // BoatCutscene_PanStartingCamera, then BoatCutscene_MoveBoatToGoal.
        const snowpoint = this.travelDir === BOAT_TRAVEL_DIR.westToEast;
        if (this.pan < (snowpoint ? 48 : PAN)) {
          this.cameraOffset[snowpoint ? 2 : 0] += snowpoint ? 0.5 : 1;
          this.pan += snowpoint ? 0.5 : 1;
        }
        this.shipOffset[snowpoint ? 0 : 2] += snowpoint ? this.speed : -this.speed;
        this.cameraOffset[snowpoint ? 0 : 2] += snowpoint ? this.speed : -this.speed;
        if (this.speed < 1 && ++this.speedTick >= SPEED_TICKS) {
          this.speed += 1;
          this.speedTick = 0;
        }
        this.distance += this.speed;
        const goal = this.distance >= (snowpoint ? 192 : GOAL);
        if (snowpoint) {
          if (goal) this.phase = 'fade-out';
          return;
        }
        if (!this.bridgeReached) {
          // BoatCutscene_CheckBridgeReached, its arguments swapped by the caller: bridge distance ≤ distance.
          if (BRIDGE <= this.distance) {
            this.bridgeReached = true;
            this.bridges = [0, 0];
          }
        } else if (this.bridgesEnded() && goal) this.phase = 'fade-out';
        this.advanceBridges();
        return;
      }
      case 'fade-out':
        this.h.fade('out', FADE_TICKS);
        this.phase = 'cinematic';
        this.cinematic = { tick: -1, frames: 0 };
        return;
      case 'cinematic': {
        if (this.cinematic.tick < 0) {
          // BOAT_CUTSCENE_STATE_FADE_OUT_END: once faded; then the child application runs.
          if (!this.h.fadeDone()) return;
          this.cinematic = { tick: 0, frames: this.h.cinematicFrames(this.travelDir) };
          return;
        }
        // Its first animation advances a frame a callback; on its last frame the 6-step fade out starts.
        this.cinematic.tick++;
        if (this.cinematic.tick < this.cinematic.frames + FADE_TICKS) return;
        this.h.changeMap(this.zone, this.x, this.z, this.exit);
        // The destination map owns the camera again. Do not reapply departure offset when its warp ends.
        this.cameraOffset.fill(0);
        this.phase = 'map';
        return;
      }
      case 'map':
        if (this.h.warpDone()) this.phase = 'done';
        return;
      case 'done':
        return;
    }
  }

  private bridgesEnded(): boolean {
    const [fl, fr] = this.h.bridgeFrames();
    return !!this.bridges && this.bridges[0] >= fl - 1 && this.bridges[1] >= fr - 1;
  }

  /** The one-shot clips advance after the task each frame, holding their last frame. */
  private advanceBridges(): void {
    if (!this.bridges) return;
    const frames = this.h.bridgeFrames();
    this.bridges = [Math.min(this.bridges[0] + 1, frames[0] - 1), Math.min(this.bridges[1] + 1, frames[1] - 1)];
  }
}
