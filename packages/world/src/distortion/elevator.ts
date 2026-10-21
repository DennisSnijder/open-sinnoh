import type { DistortionRoom, DistortionWorldFeature, DwElevatorPath } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { Actor } from '../npc.ts';
import { TILE } from '../tiles.ts';

/**
 * A Distortion World elevator ride (decomp overlay 9 sElevatorPlatformHandlers): stepping onto a moving platform
 * whose template rides up or down starts it. The platform shakes, carries the player along its path, changes
 * the floor where the path says (FieldMap_ChangeZoneDistortionWorld, without a load), may continue into a next
 * path, and leaves the player standing on the new floor with the height calculated again. Positions are fx32
 * (4096 a unit) as the decomp adds them, so the stops are exact.
 */

/** A moving platform as the slot keeps it (decomp map object local id 0xFD). */
export type Platform = DistortionWorldFeature['platforms'][number];

/** ELEVATOR_PLATFORM_VIBRATION_Y_DELTA. */
const VIBRATION = 6 * 4096;
const FX = 4096;
/** Decomp DIST_WORLD_PLATFORM_FLAG_* the up paths 13, 10 and 11 set and clear as they begin. */
const FLAG = { B3F_2: 6, B4F_1: 3, B4F_2: 4, B5F_1: 7, B5F_3: 5 } as const;

export interface RideHost {
  readonly slot: DistortionWorldFeature;
  hero(): Actor;
  room(): DistortionRoom;
  path(index: number): DwElevatorPath;
  /** The template of a platform (decomp GetMovingPlatformTemplateForMap: by position in the room's list). */
  template(zone: Id, index: number): DistortionRoom['movingPlatforms'][number];
  setHeightCalculation(on: boolean): void;
  /** LoadFloor: the floor below (`down`) or above becomes current; `keep` stays (decomp preventDeletion). */
  changeFloor(dir: 'down' | 'up', keep: Platform): void;
  /** InitSpecificMovingPlatformPropForMap: the platform of `zone` at template position `index`, unless it is there. */
  addPlatform(zone: Id, index: number): void;
  /** A var by its decomp name (VAR_DISTORTION_WORLD_PROGRESS, VAR_DISTORTION_WORLD_CYRUS_APPEARANCE). */
  varValue(name: string): number;
  setVar(name: string, value: number): void;
  /** The current floor's Distortion World object with that local id (decomp MapObjMan_LocalMapObjByIndex), or null. */
  object(localId: number): Actor | null;
  /** The script label of a room's object (MapObject_SetScript takes the destination room's entry). */
  label(zone: Id, localId: number): Id | undefined;
  applySteps(a: Actor, steps: { op: string; count: number }[]): void;
  deleteObject(a: Actor): void;
}

/** Decomp DistWorldProgress values the rides test. */
const PROGRESS = { JUMPED_ON_1F_ELEVATOR: 2, FINISHED_BOULDER_PUZZLE: 7 } as const;
/** DIST_WORLD_MAP_OBJECT_* local ids of the riders: Cynthia on 1F, B1F, B6F and B7F, and Cyrus on B4F. */
const OBJ = { CYNTHIA_1F: 129, CYNTHIA_B1F: 128, CYNTHIA_B6F: 134, CYNTHIA_B7F: 128, CYRUS_B4F: 134 } as const;
/** sCyrusB4FAnimCmds by his tile x − 88. */
const CYRUS_B4F: { op: string; count: number }[][] = [
  [{ op: 'walk_normal_east', count: 2 }, { op: 'walk_normal_north', count: 4 }],
  [{ op: 'walk_normal_east', count: 1 }, { op: 'walk_normal_north', count: 4 }],
  [{ op: 'walk_normal_north', count: 4 }],
];

/** The decomp's room tests (`mapHeaderID == MAP_HEADER_DISTORTION_WORLD_<name>`), on the zone's decomp name. */
export const isRoom = (zone: Id, name: string) => zone.endsWith(`:MAP_HEADER_DISTORTION_WORLD_${name}`);

/** Where a platform's prop stands (VecFx32_SetPosFromMapCoords: the tile's centre; its height in whole tiles). */
export function platformPosition(p: Pick<Platform, 'x' | 'y' | 'z'>): [number, number, number] {
  return [p.x * TILE + TILE / 2, p.y * TILE, p.z * TILE + TILE / 2];
}

type Phase = 'begin' | 'vibrate' | 'first' | 'second' | 'end' | 'cyrus' | 'done';

export class ElevatorRide {
  private phase: Phase = 'begin';
  private dir: 'up' | 'down' = 'down';
  private pathIndex = 0;
  private dest: Id | null = null;
  private vibrated = false;
  private vibration = 0;
  private vibrationStep = 0;
  /** The player's sprite height offset as the shake began (MapObject_GetSpritePosOffset), restored after it. */
  private spriteY = 0;
  /** The player's and the platform's fx32 position offsets along the path, and the player's base position. */
  private pos = [0, 0, 0];
  private cur = [0, 0, 0];
  private final = [0, 0, 0];
  private changeMaps = [0, 0, 0];
  private delta = [0, 0, 0];
  private next: number | null = null;
  private finalTile = { x: 0, y: 0, z: 0 };
  private setFlag: number | null = null;
  private clearFlag: number | null = null;
  /** Drawn only: the shake on the player's and the platform's height. */
  shake = 0;
  /** Cynthia riding along (the 1F and B6F elevators at their story beats): she keeps the player's height. */
  private passenger: Actor | null = null;
  private passengerY = 0;
  /** Cyrus walking off on B4F after the ride (DistWorldElevatorPlatform_CyrusB4F*). */
  private cyrus: Actor | null = null;
  /** Drawn only: the platform prop's position in world units where the ride began (it moves on from there by `cur`). */
  private readonly from: [number, number, number];

  constructor(
    private readonly h: RideHost,
    readonly platform: Platform,
  ) {
    this.from = platformPosition(platform);
  }

  /** The platform prop's position now (world units), shake included. */
  propPosition(): [number, number, number] {
    return [this.from[0] + this.cur[0]! / FX, this.from[1] + this.cur[1]! / FX + this.shake, this.from[2] + this.cur[2]! / FX];
  }

  /** One frame of the field task: the handlers run until one asks for the next frame (ELEVATOR_PLATFORM_HANDLER_RES_LOOP). */
  step(): boolean {
    for (;;) {
      switch (this.phase) {
        case 'begin':
          this.begin();
          return false;
        case 'vibrate':
          this.vibrate();
          return false;
        case 'first':
          this.move();
          if (this.at(this.changeMaps)) {
            this.change();
            this.phase = 'second';
          }
          return false;
        case 'second':
          this.move();
          if (!this.at(this.final)) return false;
          if (this.next === null) {
            this.phase = 'end';
            continue;
          }
          // The path continues (decomp: tiles set, the platform's path changed, back to INIT in the same frame).
          this.placeHero();
          this.platform.path = this.next;
          this.phase = 'begin';
          continue;
        case 'end':
          if (this.end()) {
            this.phase = 'cyrus';
            return false;
          }
          this.phase = 'done';
          return true;
        case 'cyrus':
          if (this.cyrus!.script || this.cyrus!.motion?.source === 'script') return false;
          this.h.deleteObject(this.cyrus!);
          this.h.setVar('VAR_DISTORTION_WORLD_CYRUS_APPEARANCE', 1);
          this.phase = 'done';
          return true;
        case 'done':
          throw new Error('world: an elevator ride stepped after it ended');
      }
    }
  }

  /** DistWorldElevatorPlatform_BeginMovement. */
  private begin(): void {
    const t = this.h.template(this.platform.zone, this.platform.index);
    if (!t.elevator || t.elevator.direction === 'none') throw new Error(`world: platform ${this.platform.zone}/${this.platform.index} is no elevator`);
    this.dir = t.elevator.direction;
    this.pathIndex = this.platform.path;
    const room = this.h.room();
    const flags = this.h.slot;
    if (this.dir === 'down') {
      this.dest = room.next;
      // The 1F elevator with Cynthia and B6F's after the puzzle carry her along.
      const progress = this.h.varValue('VAR_DISTORTION_WORLD_PROGRESS');
      const rider = isRoom(room.id, '1F') && progress === PROGRESS.JUMPED_ON_1F_ELEVATOR ? OBJ.CYNTHIA_1F : isRoom(room.id, 'B6F') && progress === PROGRESS.FINISHED_BOULDER_PUZZLE ? OBJ.CYNTHIA_B6F : null;
      if (rider !== null) {
        this.passenger = this.h.object(rider);
        if (!this.passenger) throw new Error(`world: Cynthia (${rider}) is not on ${room.id} to ride its elevator`);
      }
    } else {
      this.dest = room.previous;
      if (this.pathIndex === 13) flags.platformFlags = (flags.platformFlags | (1 << FLAG.B4F_1)) & ~(1 << FLAG.B4F_2);
      else if (this.pathIndex === 10) flags.platformFlags &= ~(1 << FLAG.B5F_3);
      else if (this.pathIndex === 11) flags.platformFlags = (flags.platformFlags | (1 << FLAG.B3F_2)) & ~((1 << FLAG.B4F_1) | (1 << FLAG.B5F_3));
    }
    if (this.dest === null) throw new Error(`world: ${room.id} has no floor ${this.dir === 'down' ? 'below' : 'above'} for platform ${this.platform.index}`);
    const path = this.h.path(this.pathIndex);
    const p = this.h.hero();
    this.pos = [0, Math.round(p.y * FX), 0];
    this.h.setHeightCalculation(false);
    this.cur = [0, 0, 0];
    this.finalTile = { x: p.x + path.finalOffset.x, y: Math.trunc(p.y / 8) + path.finalOffset.y * 2, z: p.z + path.finalOffset.z };
    this.final = [path.finalOffset.x, path.finalOffset.y, path.finalOffset.z].map((v) => v * TILE * FX);
    this.changeMaps = [path.changeMapsOffset.x, path.changeMapsOffset.y, path.changeMapsOffset.z].map((v) => v * TILE * FX);
    this.delta = [path.step.x, path.step.y, path.step.z];
    // The player rides only up and down here (the ROM's paths): x and z stay on their tiles.
    if (this.delta[0] || this.delta[2]) throw new Error(`world: elevator path ${this.pathIndex} moves sideways`);
    this.next = path.next;
    if (!this.vibrated) {
      this.vibration = VIBRATION;
      this.vibrated = true;
      this.spriteY = p.offset[1];
      if (this.passenger) this.passengerY = this.passenger.offset[1];
      this.phase = 'vibrate';
    } else this.phase = 'first';
    this.setFlag = path.setFlag;
    this.clearFlag = path.clearFlag;
  }

  /** DistWorldElevatorPlatform_Vibrate: a shake of shrinking height, then the first half of the ride. */
  private vibrate(): void {
    const p = this.h.hero();
    this.shake = this.vibration / FX;
    p.offset[1] = this.spriteY + this.shake;
    const c = this.passenger;
    if (c) {
      c.offset[1] = this.passengerY + this.shake;
      c.y = p.y;
    }
    this.vibration = -this.vibration;
    if (this.vibration < 0) return;
    if (this.vibration >= 4 * FX) this.vibration -= 2 * FX;
    else if (this.vibration > FX) this.vibration -= FX;
    else if (++this.vibrationStep >= 8) this.vibration -= FX;
    if (this.vibration <= 0) {
      this.shake = 0;
      p.offset[1] = this.spriteY;
      if (c) c.offset[1] = this.passengerY;
      this.phase = 'first';
    }
  }

  /** The halves of the ride: each axis not yet at its end moves one delta; the player rides along. */
  private move(): void {
    for (let i = 0; i < 3; i++) {
      if (this.cur[i] === this.final[i]) continue;
      this.cur[i]! += this.delta[i]!;
      this.pos[i]! += this.delta[i]!;
    }
    const p = this.h.hero();
    p.y = this.pos[1]! / FX;
    if (this.passenger) this.passenger.y = p.y;
  }

  private at(target: number[]): boolean {
    return this.cur.every((v, i) => v === target[i]);
  }

  /** DistWorldElevatorPlatform_ChangeMaps: the platform becomes the destination floor's, and that floor current. */
  private change(): void {
    if (this.next === null) {
      const flags = this.h.slot;
      if (this.setFlag !== null) flags.platformFlags |= 1 << this.setFlag;
      if (this.clearFlag !== null) flags.platformFlags &= ~(1 << this.clearFlag);
      // DistWorldMovingPlatformPropAnimator_ChangeMaps: the destination floor's template takes its place.
      const from = this.h.template(this.platform.zone, this.platform.index);
      const to = this.h.template(this.dest!, from.destination);
      Object.assign(this.platform, { zone: this.dest!, index: to.index, x: to.x, y: to.y, z: to.z, path: to.elevator?.path ?? 0 });
    }
    // The passenger becomes the destination's Cynthia (B1F's, or B7F's with her script there).
    const c = this.passenger;
    if (c) {
      c.localId = isRoom(this.dest!, 'B1F') ? OBJ.CYNTHIA_B1F : OBJ.CYNTHIA_B7F;
      c.zone = this.dest!;
      const label = this.h.label(this.dest!, c.localId);
      if (label) c.label = label;
      else delete c.label;
    }
    this.h.changeFloor(this.dir, this.platform);
  }

  /** The player's tile when a path ends or continues (MapObject_SetX/Y/Z and UpdateCoords). */
  private placeHero(): void {
    const p = this.h.hero();
    p.x = this.finalTile.x;
    p.z = this.finalTile.z;
    p.y = this.finalTile.y * 8;
    if (this.passenger) this.passenger.y = p.y;
  }

  /** DistWorldElevatorPlatform_EndMovement: on the new floor, the height calculated again. True: Cyrus walks off first. */
  private end(): boolean {
    this.placeHero();
    this.h.setHeightCalculation(true);
    if (this.dir === 'down' && this.pathIndex === 9) {
      this.h.slot.platformFlags |= 1 << FLAG.B5F_1;
      this.h.addPlatform(this.dest!, 0);
    }
    // Arriving on B4F by its platform 1 before Cyrus showed himself: he walks off by his column, then goes.
    if (this.dir === 'down' && this.platform.index === 1 && isRoom(this.dest!, 'B4F') && this.h.varValue('VAR_DISTORTION_WORLD_CYRUS_APPEARANCE') === 0) {
      const cyrus = this.h.object(OBJ.CYRUS_B4F);
      if (!cyrus) throw new Error('world: Cyrus is not on B4F to walk off');
      const steps = CYRUS_B4F[cyrus.x - 88];
      if (!steps) throw new Error(`world: Cyrus stands at x ${cyrus.x} on B4F`);
      this.h.applySteps(cyrus, steps);
      this.cyrus = cyrus;
      return true;
    }
    return false;
  }
}
