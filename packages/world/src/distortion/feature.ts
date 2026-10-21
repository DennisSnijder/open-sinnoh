import { CascadeMount, presentSurf, type MountPose } from './surf.ts';
import type { DistortionRoom, DistortionView, DistortionWorldFeature, DistortionWorldTables, DwCommand, DwCondition, DwJump, DwObject, DwPropKind, DwTile, EffectView, Facing, FeaturesView, FieldView, GameState } from '@opensinnoh/contracts';
import { newGameRecord } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { slotOf, type FeatureHost, type MapFeature } from '../gyms/feature.ts';
import type { Actor } from '../npc.ts';
import { behaviourName, TILE } from '../tiles.ts';
import { isSurfable } from '../behaviours.ts';
import { cellAt, findSupport, floorCollision, inBox, stepFrom, supportCollision, surfaceOf, type Surface } from './support.ts';
import { ElevatorRide, isRoom, platformPosition, type Platform } from './elevator.ts';
import { uprightStep, type Upright } from './actions.ts';
import { Sky, type SkyKind } from './sky.ts';
import { Ghosts } from './ghosts.ts';
import { runCommands, WATERFALLS, type Task } from './events.ts';
import { boulderFall, boulderWillFall } from './boulders.ts';

/**
 * The Distortion World's runtime (decomp overlay 9, DistWorld_DynamicMapFeaturesInit and the hooks the field
 * calls): built on every map load of a room from the saved slot (`MapFeatures` `distortion-world`). It owns the
 * room's supports, the player's current support and surface, jump points, the floors drawn and the sprite roll;
 * the avatar walks the supports through `AvatarDistortion`.
 */

/** The player's sprite roll by surface (decomp InitPlayer rotAngles by avatar distortion state). */
const ROLL: Record<Surface, number> = { land: 0, floor: 0, 'west-wall': 90, 'east-wall': 270, ceiling: 180 };

/**
 * The drawn facing of an input direction on a wall or the ceiling: the walk actions' TryFace, which the on-spot
 * actions of player_move.c's collision and turn tables match.
 */
export const drawnFacing = (surface: Upright, dir: Facing): Facing => uprightStep(surface, dir, false).face;

/** JumpOnFloatingPlatform's facing as the jump starts, by the support the player leaves (land and floors: the jump's own). */
const JUMP_FACING: Record<Upright, Record<Facing, Facing>> = {
  'west-wall': { up: 'left', down: 'right', left: 'up', right: 'down' },
  'east-wall': { up: 'right', down: 'left', left: 'up', right: 'down' },
  ceiling: { up: 'down', down: 'up', left: 'right', right: 'left' },
};

/** GHOST_PROP_OPACITY_MAX: a prop's GX polygon alpha when fully shown. */
const GHOST_OPACITY_MAX = 31;
/** GHOST_PROP_GROUP_MAX_COUNT: the hidden-groups mask is 24 bits. */
const GHOST_GROUPS = 0xffffff;
/** sGiratinaShadowPropRotAngles (degrees x, y, z) and sGiratinaShadowExternal (the 1F scene's shadow, the script's event 0). */
const SHADOW_ANGLES: [number, number, number][] = [[0, 0, 0], [0, 180, 0], [0, 90, 0], [0, 270, 0], [90, 0, 0]];
const SHADOW_EXTERNAL: Extract<DwCommand, { kind: 'show-giratina-shadow' }>[] = [
  { kind: 'show-giratina-shadow', x: 6, y: 297, z: 42, rotation: 3, sound: 1, scale: { x: 4096, y: 4096, z: 4096 }, step: { x: 48 * 4096, y: 0, z: 0 }, steps: 64 },
];
/** Decomp DistWorldProgress values the room code tests. */
const PROGRESS = { WON_CYRUS_BATTLE: 10, GIRATINA_ROOM_SECOND_SHADOW: 12, GIRATINA_ARRIVED: 13, BATTLED_GIRATINA: 14 } as const;
/**
 * The teleport tiles between B7F and the Giratina room (B7F_TELEPORT_TILE_*, GIRATINA_ROOM_TELEPORT_TILE_*): the tile,
 * the facing that takes it, the second tile of the position check and the collision tile beyond, and the script
 * (B7F_TELEPORT_SCRIPT_ID 2, GIRATINA_ROOM_TELEPORT_SCRIPT_ID 4). B7F's needs Cyrus beaten.
 */
const TELEPORTS = [
  { room: 'B7F', x: 89, y: 65, z: 57, dir: 'up', also: 56, wall: 56, script: 'DistortionWorldB7F_CoordEvent_WarpToGiratinaRoom', progress: PROGRESS.WON_CYRUS_BATTLE },
  { room: 'GIRATINA_ROOM', x: 15, y: 1, z: 25, dir: 'down', also: 26, wall: 26, script: 'DistortionWorldGiratinaRoom_CoordEvent_WarpToB7F', progress: 0 },
] as const;
/** GIRATINA_ROOM_POST_BATTLE_CYNTHIA_TILE_*: x/z 15 (the decomp passes the jump's direction as its Y: DIR_SOUTH). */
const CYNTHIA_TILE = { x: 15, z: 15, dir: 'down' } as const;

/** DISTORTION_WORLD_CAMERA_PERSISTED_ANGLES_FACTOR: a camera row's angle (1/256 turn) to a DS binary angle. */
const CAMERA_ANGLE_FACTOR = 0x100;
const FX32_ONE = 4096;

/**
 * CalculateCameraAngleDelta: the signed difference of two u16 angles as s16s; past half a turn it is taken
 * modulo 0x8000, negated when the current angle is the smaller.
 */
export function angleDelta(current: number, target: number): number {
  const s16 = (v: number) => (v << 16) >> 16;
  let delta = s16(target) - s16(current);
  const abs = Math.abs(delta);
  if (abs > 0x8000) {
    const fixed = (abs + 0x8000) % 0x8000;
    delta = current < target ? -fixed : fixed;
  }
  return delta;
}

/** Decomp DIST_WORLD_PLATFORM_FLAG_* and DIST_WORLD_PUZZLE_FLAG_* bits InitPersistedData sets. */
const PLATFORM = { B1F_1: 0, B2F_1: 1, B3F_1: 2, B4F_1: 3, B4F_2: 4, B5F_1: 7, B6F_1: 9, B7F_1: 10 } as const;
const PUZZLE = { MESPRIT_B5F: 0, AZELF_B5F: 1, UXIE_B5F: 2, MESPRIT_PIT: 6, AZELF_PIT: 7, UXIE_PIT: 8, UXIE_TUTO: 10, AZELF_TUTO: 11, MESPRIT_TUTO: 12 } as const;
const bits = (...b: number[]) => b.reduce((m, i) => m | (1 << i), 0);

/** What the avatar walks the supports with (player_move.c's Distortion World branches). */
export interface AvatarDistortion {
  /** The player's surface (decomp avatar distortion state: a support's kind, or ACTIVE = the land). */
  surface(): Surface;
  /** The saved moving direction (a map load restores the avatar's from it). */
  movingDir(): Facing;
  /** PlayerAvatar_CheckDistortionCollision for a step `dir` on the current support (avatar.ts `C` bits). */
  collision(dir: Facing): number;
  /** PlayerAvatar_SetMovement_DistortionFloor's collision: the floor's support change, then the collision. */
  floorCollision(dir: Facing): number;
  /**
   * DistWorld_HandlePlayerMoved (a direction pressed while the player can start a move; `moving`: a step, not a
   * turn): the jump point the player stands in facing `dir`, which the avatar then runs, `event` when a cascade
   * started, or null.
   */
  moved(dir: Facing, moving: boolean): DwJump | 'event' | null;
  /** JumpOnFloatingPlatform's direction step: the facing the jump starts with. Starts the sprite's turn. */
  jumpStart(jump: DwJump): Facing;
  /** The jump's landing (TickJumpOnFloatingPlatformMovementAnimation's end): the new support and surface. */
  land(jump: DwJump): void;
  /** DistWorld_WillBoulderBeAtFallLocation: pushed `dir`, the boulder would stop on a fall location. */
  boulderWillFall(boulder: Actor, dir: Facing): boolean;
  /** DistWorld_IsBoulderAtFallLocation → DistWorldFallingBoulder_New: the boulder's fall, run a frame a step, or null. */
  boulderFall(boulder: Actor, pushed: Facing): Generator<void, void, void> | null;
  /** DistWorld_IsBlockedByCynthia: a double jump `dir` onto tile x/z is not taken. */
  blockedByCynthia(x: number, z: number, dir: Facing): boolean;
}

/** The player's tile in the shared space: x, z, and the map object's Y grid (height / 8) halved (decomp GetPlayerPos). */
export function playerTile(a: Pick<Actor, 'x' | 'y' | 'z'>): DwTile {
  return { x: a.x, y: Math.trunc(Math.trunc(a.y / 8) / 2), z: a.z };
}

/** `NewGame.distortionWorld`, required in a Distortion World room. */
export function distortionTables(state: { reg: FeatureHost['reg'] }): DistortionWorldTables {
  const t = newGameRecord(state.reg).distortionWorld;
  if (!t) throw new Error('world: a Distortion World room is loaded but NewGame.distortionWorld is missing');
  return t;
}

export class DistortionWorld implements MapFeature, AvatarDistortion {
  readonly slot: DistortionWorldFeature;
  private current: Surface;
  /** The ghost props of the current floor and the one below (decomp active and inactive ghost prop managers). */
  private ghosts: Ghosts[] = [];
  /** The native event running (decomp loaded event, a field task), if any. */
  private event: Task | null = null;
  /**
   * The Giratina shadow prop (decomp DistWorldGiratinaShadowProp): its position (fx32), the move left, its angles and
   * scale; `done` once the move ends (it is no longer drawn).
   */
  private shadow: { pos: number[]; step: number[]; left: number; sound: number; angles: [number, number, number]; scale: number; done: boolean } | null = null;
  /** The moving platforms an event moved (decomp: their prop's position only), fx32 offsets by key. Drawn only, lost on a load. */
  private readonly platformOffsets = new Map<string, number[]>();
  /** The rotator (decomp DistWorldMapObjectRotator): degrees now and last tick, the final angle and the turn left. */
  private roll = { cur: 0, prev: 0, final: 0, delta: 0, steps: 0 };
  /** The elevator ride under way (decomp elevator platform field task), and the platform positions drawn last tick. */
  private ride: ElevatorRide | null = null;
  cascadeMount: CascadeMount | null = null;
  private mountPrev: MountPose | null = null;
  private giratinaTick = 0;
  /** The props' positions last frame, by key (drawn only). */
  private propsPrev = new Map<string, [number, number, number]>();
  /**
   * The camera manager's angle offsets (decomp DistWorldCameraManager, CameraAngle u16s: DS binary angles), the
   * running transition (fx32 accumulators and steps) and last tick's angles (drawn only).
   */
  private camera = { cur: [0, 0, 0], prev: [0, 0, 0], target: [0, 0, 0], active: false, steps: 0, acc: [0, 0, 0], step: [0, 0, 0] };
  /** The sky (sky.ts): its kind is chosen as the room loads (InitSkyCloudAnimators). */
  readonly sky: Sky;
  /**
   * The Giratina room elevator's fade-in (decomp DistWorldMovingPlatformProp, isGiratinaRoomElevator): hidden until
   * FLAG_DISTORTION_WORLD_STEPPING_STONES is set, then its opacity climbs one step every other frame.
   */
  private steppingStones = { step: 0, shown: false };

  constructor(readonly h: FeatureHost) {
    const zone = h.zone().id;
    const room = this.roomOf(zone);
    this.slot = slotOf(h.state, 'distortion-world');
    // DistWorld_DynamicMapFeaturesInit: InitPersistedData, then InitMapElements picks the support (the first
    // whose box holds the player on a first load, else the saved one), then InitPlayer.
    const first = !this.slot.valid;
    if (!this.slot.valid) {
      this.initPersisted();
      this.slot.support = findSupport(room, playerTile(h.hero()), 'land');
      // InitMovingPlatformPropsForCurrentAndNextMaps from the templates (a valid slot keeps its saved platforms).
      this.slot.platforms = [];
      for (const id of [room.id, room.next]) if (id) this.addPlatforms(id);
    } else if (this.slot.support !== null && !room.supports[this.slot.support]) {
      throw new Error(`world: saved Distortion World support ${this.slot.support} is not one of ${zone}'s ${room.supports.length}`);
    }
    // CameraInit: a valid slot's angles are taken at once (a first load starts from none).
    if (this.slot.valid) {
      const c = this.camera;
      c.cur = c.target = this.slot.cameraAngle.map((a) => (a * CAMERA_ANGLE_FACTOR) & 0xffff);
      c.prev = [...c.cur];
    }
    // InitialLoadInactiveFloor, on a first load of a room with a floor below: the player stands one tile above the
    // room's altitude (much of the land has no terrain plate; the height then stays where it is put).
    if (!this.slot.valid && room.next) h.hero().y = (room.offset.altitude + 1) * TILE;
    this.slot.valid = true;
    this.current = surfaceOf(room, this.slot.support);
    // InitPlayer: the height follows the terrain on the land only (its test compares the avatar state with
    // FLOATING_PLATFORM_KIND_WEST_WALL, which has the value of AVATAR_DISTORTION_STATE_ACTIVE).
    h.setHeightCalculation(this.current === 'land');
    this.roll = { cur: ROLL[this.current], prev: ROLL[this.current], final: ROLL[this.current], delta: 0, steps: 0 };
    this.sky = new Sky(this.skyKind());
    this.sky.step(h.hero().y);
    this.steppingStones.shown = this.flag('FLAG_DISTORTION_WORLD_STEPPING_STONES');
    if (this.steppingStones.shown) this.steppingStones.step = 2 * GHOST_OPACITY_MAX;
    // AddMapObjectsForCurrentAndNextMap, InitAllGhostPropManagers (a first load shows the room's default groups).
    if (first && room.ghosts) this.slot.hiddenGhostGroups = ~room.ghosts.visible & GHOST_GROUPS;
    for (const id of [room.id, room.next]) {
      if (!id) continue;
      this.addObjects(id);
      this.ghosts.push(this.ghostsOf(id));
    }
  }

  /** A floor's ghost props: the current one's groups as the slot hides them, the floor below's as its data shows them. */
  private ghostsOf(zone: Id): Ghosts {
    const room = this.roomOf(zone);
    const below = ~(room.ghosts?.visible ?? 0) & GHOST_GROUPS;
    return new Ghosts(zone, room, () => (zone === this.room.id ? this.slot.hiddenGhostGroups : below), distortionTables(this.h));
  }

  /** InitSkyCloudAnimators: the Giratina room's sky turns once Cyrus is beaten, darker once Giratina arrives. */
  private skyKind(): SkyKind {
    if (!isRoom(this.room.id, 'GIRATINA_ROOM')) return 'normal';
    const progress = this.progress();
    if (progress >= PROGRESS.WON_CYRUS_BATTLE && progress <= PROGRESS.GIRATINA_ROOM_SECOND_SHADOW) return 'giratina-room';
    if (progress >= PROGRESS.WON_CYRUS_BATTLE && progress <= PROGRESS.GIRATINA_ARRIVED) return 'giratina-room-dark';
    return 'normal';
  }

  private progress(): number {
    return this.h.varValue(this.decompId('VAR_DISTORTION_WORLD_PROGRESS'));
  }

  private flag(name: string): boolean {
    const id = this.decompId(name);
    const flag = this.h.reg.flags.get(id);
    if (!flag) throw new Error(`world: no flag ${id}`);
    return this.h.state.flags[id] ?? flag.initial;
  }

  /** CheckFlagCondition: the room data's conditions on the story, the puzzle bits and the Giratina shadows. */
  condition(c: DwCondition): boolean {
    switch (c.kind) {
      case 'none':
        return true;
      case 'boulder-puzzle-false':
        return !(this.slot.puzzleFlags & (1 << c.value));
      case 'boulder-puzzle-true':
        return !!(this.slot.puzzleFlags & (1 << c.value));
      case 'progress-eq':
        return this.progress() === c.value;
      case 'progress-leq':
        return this.progress() <= c.value;
      case 'progress-geq':
        return this.progress() >= c.value;
      case 'giratina-shadow':
        return !this.flag(`FLAG_DISTORTION_WORLD_GIRATINA_SHADOW_${c.value + 1}`);
      case 'cyrus-appearance':
        return this.h.varValue(this.decompId('VAR_DISTORTION_WORLD_CYRUS_APPEARANCE')) === c.value;
      case 'manual-add-only':
        return false;
    }
  }

  /** InitPersistedData: the elevators' starting floors and the boulder puzzle's (or its finished) state. */
  private initPersisted(): void {
    const s = this.slot;
    s.hiddenGhostGroups = 0;
    s.cameraAngle = [0, 0, 0];
    // Arriving at B7F (back from the Giratina room), every elevator stands below.
    s.platformFlags = isRoom(this.room.id, 'B7F') ? bits(PLATFORM.B1F_1, PLATFORM.B2F_1, PLATFORM.B3F_1, PLATFORM.B4F_1, PLATFORM.B4F_2, PLATFORM.B5F_1, PLATFORM.B6F_1, PLATFORM.B7F_1) : bits(PLATFORM.B4F_1, PLATFORM.B5F_1);
    s.puzzleFlags = this.puzzleFinished()
      ? bits(PUZZLE.UXIE_TUTO, PUZZLE.AZELF_TUTO, PUZZLE.MESPRIT_TUTO, PUZZLE.MESPRIT_PIT, PUZZLE.AZELF_PIT, PUZZLE.UXIE_PIT)
      : bits(PUZZLE.MESPRIT_B5F, PUZZLE.AZELF_B5F, PUZZLE.UXIE_B5F);
  }

  /** A flag or var of the base pack by its decomp name (the rooms' namespace). */
  private decompId(name: string): Id {
    return `${this.room.id.slice(0, this.room.id.indexOf(':'))}:${name}` as Id;
  }

  /** FLAG_DISTORTION_WORLD_PUZZLE_FINISHED (SystemFlag_HandleDistortionWorldPuzzleFinished). */
  private puzzleFinished(): boolean {
    return this.flag('FLAG_DISTORTION_WORLD_PUZZLE_FINISHED');
  }

  /** The current room (an elevator changes it without a map load). */
  get room(): DistortionRoom {
    return this.roomOf(this.h.zone().id);
  }

  private roomOf(zone: Id): DistortionRoom {
    const room = this.h.reg.distortionRooms.get(zone);
    if (!room) throw new Error(`world: ${zone} is in the Distortion World but has no distortionRooms record`);
    return room;
  }

  // ---------- objects (AddMapObjectsForMap, AddMapObjectWithLocalID, DeleteMapObjectsForMap) ----------

  /** The room's objects whose condition holds (manual-add-only ones never), unless their flag hides them or they are there. */
  private addObjects(zone: Id): void {
    for (const ev of this.roomOf(zone).objects) this.addEvent(zone, ev, false);
  }

  /**
   * AddMapObjectFromEvent: an object already there (a save's, or one carried) is kept; else it is added when its
   * condition holds (`manual`: added by a command or a script, which manual-add-only objects need) and its flag does
   * not hide it.
   */
  private addEvent(zone: Id, ev: DwObject, manual: boolean): Actor | null {
    for (const a of this.h.objects()) if (a.heightFixed && a.zone === zone && a.localId === ev.localId) return a;
    if (ev.when.kind === 'manual-add-only' ? !manual : !this.condition(ev.when)) return null;
    if (ev.hideFlag && this.flagById(ev.hideFlag)) return null;
    return this.h.spawnObject(zone, ev);
  }

  /** AddMapObjectWithLocalID: the room's object with that local id (manual), or null when its condition stops it. */
  addObject(zone: Id, localId: number, manual = true): Actor | null {
    const ev = this.roomOf(zone).objects.find((o) => o.localId === localId);
    if (!ev) throw new Error(`world: ${zone} has no Distortion World object ${localId}`);
    return this.addEvent(zone, ev, manual);
  }

  /** DeleteMapObjectsForMap. */
  private deleteObjects(zone: Id): void {
    for (const a of [...this.h.objects()]) if (a.heightFixed && a.zone === zone) this.h.deleteObject(a);
  }

  /** ScrCmd_DeleteDistortionWorldMapObject: the current floor's object with that local id. */
  deleteObject(localId: number): void {
    const a = [...this.h.objects()].find((o) => o.heightFixed && o.zone === this.room.id && o.localId === localId);
    if (!a) throw new Error(`world: ${this.room.id} has no Distortion World object ${localId} to delete`);
    this.h.deleteObject(a);
  }

  private flagById(id: Id): boolean {
    const flag = this.h.reg.flags.get(id);
    if (!flag) throw new Error(`world: no flag ${id}`);
    return this.h.state.flags[id] ?? flag.initial;
  }

  boulderWillFall(boulder: Actor, dir: Facing): boolean {
    return boulderWillFall(this.room.id, boulder, dir);
  }

  boulderFall(boulder: Actor, pushed: Facing): Task | null {
    return boulderFall(this, boulder, pushed);
  }

  /** A script label of the rooms' script files by its decomp name. */
  label(name: string): Id {
    return this.decompId(name);
  }

  /** The zone of a room by its decomp name (`B6F`, `GIRATINA_ROOM`). */
  zoneOf(name: string): Id {
    return this.decompId(`MAP_HEADER_DISTORTION_WORLD_${name}`);
  }

  // ---------- moving platforms ----------

  /** GetMovingPlatformTemplateForMap: by position in the room's list (each template's index is its position). */
  private template(zone: Id, index: number): DistortionRoom['movingPlatforms'][number] {
    const t = this.roomOf(zone).movingPlatforms[index];
    if (!t || t.index !== index) throw new Error(`world: ${zone} has no moving platform template at ${index}`);
    return t;
  }

  /** InitMovingPlatformPropsForMap: each template whose flag is unset or set in the slot, unless its platform exists. */
  private addPlatforms(zone: Id): void {
    for (const t of this.roomOf(zone).movingPlatforms) if (t.flag === null || this.slot.platformFlags & (1 << t.flag)) this.addPlatform(zone, t.index);
  }

  private addPlatform(zone: Id, index: number): void {
    if (this.slot.platforms.some((p) => p.zone === zone && p.index === index)) return;
    const t = this.template(zone, index);
    this.slot.platforms.push({ zone, index, x: t.x, y: t.y, z: t.z, path: t.elevator?.path ?? 0 });
  }

  /**
   * LoadFloor (FloorLoadNext / FloorLoadPrevious): the floor below or above becomes current. The floor that is
   * neither current nor below any more loses its platforms (but the one ridden), the new floor below gets its own,
   * and the zone changes under the player.
   */
  changeFloor(dir: 'down' | 'up', keep: Platform | null): void {
    const room = this.room;
    const dest = dir === 'down' ? room.next : room.previous;
    if (!dest) throw new Error(`world: ${room.id} has no floor ${dir === 'down' ? 'below' : 'above'}`);
    const leaving = dir === 'down' ? room.id : room.next;
    this.slot.platforms = this.slot.platforms.filter((p) => p === keep || p.zone !== leaving);
    if (leaving) this.deleteObjects(leaving);
    this.ghosts = this.ghosts.filter((g) => g.zone !== leaving);
    // The ghost groups the new floor hides start from its data (SetPersistedHiddenGhostPropGroups(0), then the
    // manager moved or made with its default visibility).
    this.slot.hiddenGhostGroups = ~(this.roomOf(dest).ghosts?.visible ?? 0) & GHOST_GROUPS;
    for (const key of [...this.platformOffsets.keys()]) if (key.startsWith(`${leaving}#`)) this.platformOffsets.delete(key);
    this.h.changeFloor(dest);
    const added = dir === 'down' ? this.roomOf(dest).next : dest;
    if (added) {
      this.addPlatforms(added);
      this.addObjects(added);
      this.ghosts.push(this.ghostsOf(added));
    }
    // A cascade crosses floors from a support: the floor's supports are the new room's, none current until it lands.
    this.slot.support = null;
  }

  /**
   * Field_ProcessStep → DistWorld_HandlePlayerPositionChanged: a step that ends on an elevator platform starts
   * its ride (the position events and teleports come with steps 6 and 7).
   */
  stepped(): boolean {
    if (this.elevatorAt()) return true;
    // HandleEventAt: the first event on the tile whose condition holds.
    const at = playerTile(this.h.hero());
    const ev = this.room.events.find((e) => e.x === at.x && e.y === at.y && e.z === at.z && this.condition(e.when));
    if (ev) {
      this.event = runCommands(this, ev.commands);
      return true;
    }
    // The teleport tiles, on the tile or the one before it, facing their way.
    const t = this.teleport();
    if (t && (at.z === t.z || at.z === t.also)) {
      this.h.startScript(this.decompId(t.script));
      return true;
    }
    return false;
  }

  /** The room's teleport the player faces into, on its row and height, with its progress met; or null. */
  private teleport(): (typeof TELEPORTS)[number] | null {
    const at = playerTile(this.h.hero());
    const facing = this.h.hero().facing;
    const t = TELEPORTS.find((t) => isRoom(this.room.id, t.room));
    if (!t || facing !== t.dir || at.x !== t.x || at.y !== t.y || this.progress() < t.progress) return null;
    return t;
  }

  /** DistWorld_CheckMapTransition / HandlePlayerMovementEnd: pushing on the teleport tile itself. */
  push(dir: Facing): boolean {
    const t = this.teleport();
    if (!t || dir !== t.dir || playerTile(this.h.hero()).z !== t.z) return false;
    this.h.startScript(this.decompId(t.script));
    return true;
  }

  /** DistWorld_DynamicMapFeaturesCheckCollision: the tile beyond each teleport tile is a wall. */
  blocks(x: number, z: number): boolean {
    const t = TELEPORTS.find((t) => isRoom(this.room.id, t.room));
    return !!t && x === t.x && z === t.wall;
  }

  blockedByCynthia(x: number, z: number, dir: Facing): boolean {
    return isRoom(this.room.id, 'GIRATINA_ROOM') && x === CYNTHIA_TILE.x && z === CYNTHIA_TILE.z && dir === CYNTHIA_TILE.dir && this.progress() === PROGRESS.BATTLED_GIRATINA;
  }

  /** HandleElevatorPlatformPropAnimatorAt: an elevator platform under the player starts its ride. */
  private elevatorAt(): boolean {
    const at = playerTile(this.h.hero());
    const zone = this.room.id;
    const p = this.slot.platforms.find((q) => q.zone === zone && q.x === at.x && q.y === at.y && q.z === at.z);
    const t = p && this.template(p.zone, p.index);
    if (!p || !t?.elevator || t.elevator.direction === 'none') return false;
    this.ride = new ElevatorRide(
      {
        slot: this.slot,
        hero: () => this.h.hero(),
        room: () => this.room,
        path: (i) => {
          const path = distortionTables(this.h).elevatorPaths[i];
          if (!path) throw new Error(`world: no elevator path ${i}`);
          return path;
        },
        template: (z, i) => this.template(z, i),
        setHeightCalculation: (on) => this.h.setHeightCalculation(on),
        changeFloor: (d, keep) => this.changeFloor(d, keep),
        addPlatform: (z, i) => this.addPlatform(z, i),
        varValue: (name) => this.h.varValue(this.decompId(name)),
        setVar: (name, value) => this.h.setVar(this.decompId(name), value),
        object: (localId) => [...this.h.objects()].find((a) => a.heightFixed && a.zone === this.room.id && a.localId === localId) ?? null,
        label: (zone, localId) => this.roomOf(zone).objects.find((o) => o.localId === localId)?.label,
        applySteps: (a, steps) => this.h.applySteps(a, steps),
        deleteObject: (a) => this.h.deleteObject(a),
      },
      p,
    );
    return true;
  }

  // ---------- the avatar's side ----------

  surface(): Surface {
    return this.current;
  }

  movingDir(): Facing {
    return this.slot.movingDir;
  }

  /** The avatar's moving direction, kept in the slot (the DS saves it with the map object). */
  setMovingDir(dir: Facing): void {
    this.slot.movingDir = dir;
  }

  collision(dir: Facing): number {
    return this.collide(this.slot.support, dir);
  }

  floorCollision(dir: Facing): number {
    const r = floorCollision(this.room, this.slot.support, playerTile(this.h.hero()), dir, (s) => this.collide(s, dir));
    this.slot.support = r.support;
    return r.collision;
  }

  private collide(support: number | null, dir: Facing): number {
    return supportCollision(this.room, support, this.current, playerTile(this.h.hero()), dir, {
      occupied: (t) => this.occupied(t),
      behaviour: (byte) => behaviourName(this.h.reg, byte),
      surfable: isSurfable,
    });
  }

  /** sub_02063F00: another object on tile t (or leaving it) within a tile of its height (Y grid within 2). */
  private occupied(t: DwTile): boolean {
    for (const a of this.h.objects()) {
      if (a.passThrough) continue;
      const on = (a.x === t.x && a.z === t.z) || (a.motion?.kind === 'walk' && a.motion.fromX === t.x && a.motion.fromZ === t.z);
      if (on && Math.abs(Math.trunc(a.y / 8) - t.y * 2) < 2) return true;
    }
    return false;
  }

  moved(dir: Facing, moving: boolean): DwJump | 'event' | null {
    const at = playerTile(this.h.hero());
    // HandleGhostPropTriggerAt (a step, not a turn): every trigger whose direction and box match shows or hides its group.
    if (moving) for (const t of this.room.ghosts?.triggers ?? []) if (t.facing === dir && inBox(at, t.box)) this.ghostGroup(t.group, t.show);
    // ApplyCameraAngleForPlayerPosition: the first row that matches.
    const row = this.room.cameraRows.find((r) => r.facing === dir && inBox(at, r.box));
    if (row) this.cameraTransition([row.angle.x, row.angle.y, row.angle.z], row.steps);
    // HandleFloatingPlatformJumpPointAt.
    const jump = this.room.jumps.find((j) => j.facing === dir && inBox(at, j.box));
    if (jump) return jump;
    // The waterfalls: pushing right at their foot or top runs the cascade (RunEventCommands).
    for (const w of WATERFALLS) {
      if (dir !== 'right' || !isRoom(this.room.id, w.room) || at.x !== w.x || at.y !== w.y || at.z < w.z[0] || at.z > w.z[1]) continue;
      this.event = runCommands(this, distortionTables(this.h)[w.list]);
      return 'event';
    }
    return null;
  }

  /** ShowGhostPropGroup / HideGhostPropGroup on the current floor (the slot keeps the mask). */
  ghostGroup(group: number, show: boolean): void {
    if (show) this.slot.hiddenGhostGroups &= ~(1 << group);
    else this.slot.hiddenGhostGroups |= 1 << group;
  }

  /**
   * DoCameraTransition: the row's angles are saved and become the target; unless the camera is there already, it
   * turns in `steps` frames by the decomp's signed deltas (CalculateCameraAngleDelta), accumulated in fx32.
   */
  cameraTransition(angle: [number, number, number], steps: number): void {
    const c = this.camera;
    this.slot.cameraAngle = angle;
    c.target = angle.map((a) => (a * CAMERA_ANGLE_FACTOR) & 0xffff);
    if (c.cur.every((v, i) => v === c.target[i])) {
      c.active = false;
      return;
    }
    c.active = true;
    c.steps = steps;
    c.acc = c.cur.map((v) => v * FX32_ONE);
    c.step = c.cur.map((v, i) => Math.trunc((FX32_ONE * angleDelta(v, c.target[i]!)) / steps));
  }

  /** CameraTransitionTask, every frame. */
  private stepCamera(): void {
    const c = this.camera;
    c.prev = [...c.cur];
    if (!c.active) return;
    if (--c.steps <= 0) {
      c.active = false;
      c.cur = [...c.target];
      return;
    }
    for (let i = 0; i < 3; i++) {
      c.acc[i]! += c.step[i]!;
      c.cur[i] = Math.trunc(c.acc[i]! / FX32_ONE) & 0xffff;
    }
  }

  /** ScrCmd_ResetDistortionWorldPersistedCameraAngles: the saved angles only (the camera stays as it is). */
  resetPersistedCameraAngles(): void {
    this.slot.cameraAngle = [0, 0, 0];
  }

  /** RotateMapObject on the player: the turn starts from the last final angle and adds `degrees` over `steps` frames. */
  rotate(degrees: number, steps: number): void {
    const r = this.roll;
    r.cur = r.final;
    r.delta = degrees / steps;
    r.steps = steps;
    r.final = (((r.final + degrees) % 360) + 360) % 360;
  }

  jumpStart(jump: DwJump): Facing {
    this.rotate(jump.spriteRotation, jump.steps);
    // The task sets the map object's position itself and no movement action recalculates its height; the
    // landing leaves the calculation off (`land`), so it is off from here.
    this.h.setHeightCalculation(false);
    return this.current === 'land' || this.current === 'floor' ? jump.facing : JUMP_FACING[this.current][jump.facing];
  }

  land(jump: DwJump): void {
    // PrepareNewCurrentFloatingPlatform (index 0xFFFF for the land: none current). The task's height test is
    // `floatingPlatformIndex < 0` on a u16, never true: the height stays fixed after every jump, the land's too,
    // until the next map load.
    this.slot.support = jump.to === 'land' ? null : jump.support;
    this.current = surfaceOf(this.room, this.slot.support);
    this.h.setHeightCalculation(false);
  }

  /** The player's sprite set here (InitPlayer: the Distortion World gfx of the player's state). */
  sprite(state: Pick<GameState, 'playerState' | 'gender'>): Id {
    const t = distortionTables(this.h);
    return (state.playerState === 'surf' ? t.playerSurfSprite : t.playerSprite)[state.gender];
  }

  // ---------- MapFeature ----------

  step(): void {
    this.mountPrev = this.cascadeMount?.pose() ?? null;
    const giratina = [...this.h.objects()].find(a => a.sprite?.endsWith(':OBJ_EVENT_GFX_GIRATINA_ORIGIN'));
    if (!giratina) this.giratinaTick = 0;
    else if (!giratina.animPaused) this.giratinaTick++;
    this.propsPrev = new Map(this.propsNow().map((p) => [p.key, p.cur]));
    if (this.ride?.step()) {
      this.ride = null;
      // The ride ends on the land: InitPlayer's surface (no support is current).
      this.current = surfaceOf(this.room, this.slot.support);
    }
    if (this.event?.next().done) this.event = null;
    this.stepShadow();
    const objects = [...this.h.objects(), this.h.hero()];
    for (const g of this.ghosts) {
      const room = this.roomOf(g.zone);
      g.step(this.h.sound, (t) => objects.some((a) => a.x === t.x && a.z === t.z && Math.trunc(a.y / 8) === t.y * 2), g.zone === this.room.id, room);
    }
    this.stepCamera();
    this.sky.step(this.h.hero().y);
    if (!this.steppingStones.shown && this.flag('FLAG_DISTORTION_WORLD_STEPPING_STONES')) this.steppingStones.shown = true;
    if (this.steppingStones.shown && this.steppingStones.step < 2 * GHOST_OPACITY_MAX) this.steppingStones.step++;
    // TickMapObjectRotator.
    const r = this.roll;
    r.prev = r.cur;
    if (r.steps > 0) {
      r.steps--;
      r.cur = (((r.cur + r.delta) % 360) + 360) % 360;
      if (r.steps === 0) r.cur = r.final;
    }
  }

  busy(): boolean {
    return this.ride !== null || this.event !== null;
  }

  // ---------- what the events use (events.ts) ----------

  setProgress(value: number): void {
    this.h.setVar(this.decompId('VAR_DISTORTION_WORLD_PROGRESS'), value);
  }

  setFlag(name: string): void {
    const id = this.decompId(name);
    if (!this.h.reg.flags.has(id)) throw new Error(`world: no flag ${id}`);
    this.h.state.flags[id] = true;
  }

  /** A current-floor platform's drawn offset (fx32), made on first use: the array the event moves. */
  platformOffset(index: number): number[] {
    const zone = this.room.id;
    if (!this.slot.platforms.some((p) => p.zone === zone && p.index === index)) throw new Error(`world: ${zone} has no moving platform ${index} to move`);
    const key = `${zone}#${index}`;
    let o = this.platformOffsets.get(key);
    if (!o) this.platformOffsets.set(key, (o = [0, 0, 0]));
    return o;
  }

  /**
   * FindAndPrepareNewCurrentFloatingPlatform at the player's tile (any kind), then the avatar's state: the support's
   * kind (a tile outside it reads as a floor) or, `state` given, that one; the height is calculated on the land only.
   */
  relocate(state?: Surface): void {
    const at = playerTile(this.h.hero());
    this.slot.support = findSupport(this.room, at, 'land');
    this.current = state ?? (this.slot.support === null ? 'land' : cellAt(this.room, this.slot.support, at) === null && !inBox(at, this.room.supports[this.slot.support]!.box) ? 'floor' : surfaceOf(this.room, this.slot.support));
    this.h.setHeightCalculation(this.current === 'land');
  }

  /** InitSpecificMovingPlatformPropForMap by the room's decomp name. */
  addPlatformOf(room: string, index: number): void {
    this.addPlatform(this.zoneOf(room), index);
  }

  /** LoadGiratinaShadowPropAnimation: the shadow starts at its tile (x + 8 when it lies flat), facing its angles. */
  startShadow(c: Extract<DwCommand, { kind: 'show-giratina-shadow' }>): void {
    const pos = [c.x * TILE * FX32_ONE + (c.rotation === 4 ? 8 * FX32_ONE : 0), c.y * TILE * FX32_ONE, c.z * TILE * FX32_ONE];
    const angles = SHADOW_ANGLES[c.rotation];
    if (!angles) throw new Error(`world: Giratina shadow rotation ${c.rotation}`);
    this.shadow = { pos, step: [c.step.x, c.step.y, c.step.z], left: c.steps, sound: c.sound, angles, scale: c.scale.x / FX32_ONE, done: false };
  }

  /** ScrCmd_StartDistortionWorldGiratinaShadowEvent: one of the external templates (the 1F scene's). */
  startShadowEvent(index: number): void {
    const t = SHADOW_EXTERNAL[index];
    if (!t) throw new Error(`world: no Giratina shadow event ${index}`);
    this.startShadow(t);
  }

  shadowDone(): boolean {
    if (!this.shadow) throw new Error('world: no Giratina shadow is moving');
    return this.shadow.done;
  }

  /** FinishGiratinaShadowPropRenderer. */
  endShadow(): void {
    this.shadow = null;
  }

  /** DistWorldGiratinaShadowProp_AnimTick: the sound on its first frame (a cry, or the flee sound), then the move. */
  private stepShadow(): void {
    const s = this.shadow;
    if (!s || s.done) return;
    if (s.sound >= 0) {
      if (s.sound === 1) this.h.sound.cry('SPECIES_GIRATINA');
      else if (s.sound === 2) this.h.sound.playNamed('SEQ_SE_DP_FW019');
      s.sound = -1;
    }
    for (let i = 0; i < 3; i++) s.pos[i]! += s.step[i]!;
    if (--s.left <= 0) s.done = true;
  }

  /** A platform's prop now: the ride's for the platform ridden, else its tile. */
  private platformAt(p: Platform): [number, number, number] {
    return this.ride?.platform === p ? this.ride.propPosition() : platformPosition(p);
  }

  /** A prop of `kind` whose anchor (tile centre, height tile × 16 + 8) is `at`, with the kind's offset. */
  private placed(kind: DwPropKind, at: [number, number, number]): [number, number, number] {
    const o = distortionTables(this.h).props[kind].offset;
    return [at[0] + o[0], at[1] + TILE / 2 + o[1], at[2] + o[2]];
  }

  /**
   * The props drawn now, without their last positions: the moving platforms (their ride's position while one
   * rides; the Giratina room elevator fading in once the stepping stones show) and the simple props of the
   * current floor and the one below whose condition holds (the DS checks it when a floor loads; here each frame,
   * as our battles return to the field without a reload). Joint clips loop a frame a tick (Simple3D_UpdateAnim).
   */
  private propsNow(): Omit<DistortionView['props'][number], 'prev'>[] {
    const tables = distortionTables(this.h);
    const out: Omit<DistortionView['props'][number], 'prev'>[] = [];
    const frame = (kind: DwPropKind) => {
      const clip = tables.props[kind].clip;
      return clip ? { frame: this.h.state.tick % clip.frames } : {};
    };
    for (const p of this.slot.platforms) {
      const kind = this.template(p.zone, p.index).prop;
      let opacity = GHOST_OPACITY_MAX;
      if (isRoom(p.zone, 'B6F') && p.index === 1) {
        if (!this.steppingStones.shown) continue;
        opacity = Math.min(GHOST_OPACITY_MAX, this.steppingStones.step >> 1);
      }
      const at = this.platformAt(p);
      const moved = this.platformOffsets.get(`${p.zone}#${p.index}`);
      if (moved) for (let i = 0; i < 3; i++) at[i]! += moved[i]! / FX32_ONE;
      out.push({ key: `platform:${p.zone}:${p.index}`, prop: kind, cur: this.placed(kind, at), opacity, ...frame(kind) });
    }
    for (const g of this.ghosts) out.push(...g.draw());
    const s = this.shadow;
    if (s && !s.done) {
      const clip = tables.props['giratina-shadow'].clip;
      out.push({ key: 'giratina-shadow', prop: 'giratina-shadow', cur: s.pos.map((v) => v / FX32_ONE) as [number, number, number], opacity: GHOST_OPACITY_MAX, scale: s.scale, rotation: s.angles, ...(clip ? { frame: this.h.state.tick % clip.frames } : {}) });
    }
    for (const id of [this.room.id, this.room.next]) {
      if (!id) continue;
      this.roomOf(id).props.forEach((sp, i) => {
        if (!this.condition(sp.when)) return;
        out.push({ key: `prop:${id}:${i}`, prop: sp.prop, cur: this.placed(sp.prop, platformPosition(sp)), opacity: GHOST_OPACITY_MAX, ...frame(sp.prop) });
      });
    }
    return out;
  }

  view(): { effects: EffectView[]; features: FeaturesView | null } {
    return { effects: [], features: null };
  }

  /** Resolve the DW mount/rider offsets and Giratina's continuously animated billboard. */
  presentActors(view: FieldView): void {
    for (const a of view.actors) if (a.sprite.endsWith(':OBJ_EVENT_GFX_GIRATINA_ORIGIN')) a.animTick = this.giratinaTick;
    const mount = view.effects.find(e => this.h.reg.fieldEffects.get(e.effect)?.name === 'SURF_BLOB');
    if (mount) presentSurf(view, mount, this.current, this.slot.movingDir, this.cascadeMount?.pose() ?? null, this.mountPrev);
  }

  /** The room's land and floor below it (decomp inactive floor), orientation and roll. */
  distortionView(): DistortionView {
    const floors: DistortionView['floors'] = [];
    for (const id of [this.room.id, this.room.next]) {
      if (!id) continue;
      const room = this.h.reg.distortionRooms.get(id);
      const zone = this.h.reg.zones.get(id);
      if (!room || !zone) throw new Error(`world: Distortion World floor ${id} has no room or zone`);
      floors.push({ zone: id, matrix: zone.matrix, area: zone.area, offset: [room.offset.x * TILE, room.offset.altitude * TILE, room.offset.z * TILE] });
    }
    const props = this.propsNow().map((p) => ({ ...p, prev: this.propsPrev.get(p.key) ?? p.cur }));
    const camera = { cur: [...this.camera.cur] as [number, number, number], prev: [...this.camera.prev] as [number, number, number] };
    return { floors, orientation: this.current, roll: { cur: this.roll.cur, prev: this.roll.prev }, camera, props, sky: this.sky.view() };
  }

  /**
   * PlayerAvatar_GetFacingDistortionWorldPos: the tile one step ahead in the shared space, by the facing on the land
   * and floors and by the moving direction on the walls and ceiling (Field_DistortionInteract talks to an object there).
   */
  facingTile(): DwTile {
    const p = this.h.hero();
    const dir = this.current === 'land' || this.current === 'floor' ? p.facing : this.slot.movingDir;
    return stepFrom(this.current, dir, playerTile(p));
  }

  /** PlayerAvatar_GetDistortionFacingTileBehaviour off the land: the current support's cell ahead (none: NONE). */
  facingBehaviour(): string {
    const cell = cellAt(this.room, this.slot.support, this.facingTile());
    return cell === null ? 'NONE' : behaviourName(this.h.reg, cell & 0xff);
  }

  /** The current support's terrain cell under the player (tests and the debug view). */
  cellHere(): number | null {
    return cellAt(this.room, this.slot.support, playerTile(this.h.hero()));
  }
}
