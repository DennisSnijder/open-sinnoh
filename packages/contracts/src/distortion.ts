/**
 * The Distortion World (contracts 0.27.18; docs/research/distortion-world.md and
 * distortion-world-audit.md). Decomp overlay 9 (`ov9_02249960.c`) and the tornworld archives.
 *
 * Coordinates. A Distortion World room is addressed in one shared space (decomp map object coordinates):
 * tile x and z are the room's matrix tiles plus `DistortionRoom.offset` x and z, and heights are world units
 * with the room's land raised by `offset.altitude` tiles (16 units each; decomp
 * LandDataManager_DistortionWorldSetOffsets). `GameState.player` and every script coordinate in these rooms
 * (warps, `get_player3_d_pos`, object events) use this space; the world's map grid subtracts the offset.
 * Records keep their source units: tiles for boxes, supports, props and events (Y in whole tiles: world
 * height / 16), fx32 for steps.
 *
 * - `DistortionRoom` (registry `distortionRooms`, id = the room's zone id): supports, jumps, camera rows,
 *   ghost props, moving platforms, events, simple props and objects of one room.
 * - `DistortionWorldTables` (`NewGame.distortionWorld`): the elevator paths and the waterfall command lists.
 * - `MapFeatures` `distortion-world` (gyms.ts): the saved slot (decomp DistWorldPersistedData).
 * - `DistortionView` (`FieldView.distortion`): the floors drawn and the player's orientation.
 */
import type { Id } from '@opensinnoh/core';
import type { Facing, ObjectEvent } from './records.ts';

/** Decomp `FloatingPlatformKind` 0–3, in order. */
export const DW_SUPPORT_KINDS = ['floor', 'west-wall', 'east-wall', 'ceiling'] as const;
export type DwSupportKind = (typeof DW_SUPPORT_KINDS)[number];

/** Decomp `PropKind`, in order (names lower-cased). */
export const DW_PROP_KINDS = [
  'small-platform',
  'floating-blue-rock',
  'medium-elevator-platform-1',
  'medium-elevator-platform-2',
  'medium-elevator-platform-sw',
  'medium-moving-platform-1',
  'medium-moving-platform-2',
  'medium-elevator-platform-3',
  'large-elevator-platform-1',
  'medium-elevator-platform-4',
  'horizontal-platform-1',
  'vertical-platform-1',
  'vertical-platform-2',
  'horizontal-platform-2',
  'rotated-platform-east',
  'rotated-platform-west',
  'large-elevator-platform-2',
  'large-elevator-platform-3',
  'large-elevator-platform-4',
  'medium-elevator-platform-5',
  'giratina-shadow',
  'waterfall',
  'land-vine-flower',
  'land-rock',
  'portal',
] as const;
export type DwPropKind = (typeof DW_PROP_KINDS)[number];

/** Decomp `DistWorldBounds`: start tile and sizes. A tile is inside when start ≤ t ≤ start + size on every axis. */
export interface DwBox {
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export interface DwTile {
  x: number;
  y: number;
  z: number;
}

/** fx32 per frame as stored (4096 = one world unit; a tile is 16 units). */
export type DwFx32 = DwTile;

/**
 * A floating platform (decomp DistWorldFloatingPlatformTemplate): one surface of one orientation and its
 * terrain grid (tw_arc_attr), `vertical` × `horizontal` u16 cells indexed `v + h × vertical` (bit 15
 * collision, low byte the tile behaviour). The grid axes per kind (GetCurrentFloatingPlatformTileAttributes):
 * floor v = x − box.x, h = z − box.z; west wall v = box.sizeY − (y − box.y), h = z − box.z; east wall
 * v = y − box.y, h = z − box.z; ceiling v = box.sizeX − (x − box.x), h = z − box.z.
 */
export interface DwSupport {
  kind: DwSupportKind;
  box: DwBox;
  vertical: number;
  horizontal: number;
  cells: number[];
}

/**
 * A jump point (decomp DistWorldFloatingPlatformJumpPointTemplate): pushing `facing` (the input direction)
 * while standing in `box` jumps `displacement` tiles in `steps` frames, the sprite arcing on `axis`
 * (`inverted`: the other way) and turning `spriteRotation` degrees, and lands on support `support` of kind
 * `to`, or back on the room's land (`to: 'land'`, `support` null).
 */
export interface DwJump {
  facing: Facing;
  box: DwBox;
  displacement: DwTile;
  spriteRotation: number;
  steps: number;
  axis: 'x' | 'y' | 'z';
  inverted: boolean;
  finalFacing: Facing;
  to: DwSupportKind | 'land';
  support: number | null;
}

/** A camera row (decomp DistWorldCameraAngleTemplate): the first whose box and facing match the player wins. */
export interface DwCameraRow {
  box: DwBox;
  facing: Facing;
  /** Offsets from the base camera in 1/256 turns (× 0x100 = a DS binary angle). */
  angle: DwTile;
  steps: number;
}

/** Decomp `FlagCondition` and its value. */
export interface DwCondition {
  kind: 'none' | 'boulder-puzzle-false' | 'boulder-puzzle-true' | 'progress-eq' | 'progress-leq' | 'progress-geq' | 'manual-add-only' | 'giratina-shadow' | 'cyrus-appearance';
  value: number;
}

/** Ghost props (decomp DistWorldGhostPropHeader): groups of props shown or hidden by direction + box triggers. */
export interface DwGhosts {
  /** Bit n set: group n is visible on first entry. */
  visible: number;
  props: { group: number; prop: DwPropKind; x: number; y: number; z: number }[];
  triggers: { group: number; facing: Facing; show: boolean; box: DwBox }[];
}

/** A moving platform (decomp DistWorldMovingPlatformTemplate), at tile x/y/z. */
export interface DwMovingPlatform {
  /** Decomp `index`: what `move-platform` commands name. */
  index: number;
  x: number;
  y: number;
  z: number;
  /** The elevator path it rides when stepped on, and that path's direction; null: moved only by events. */
  elevator: { path: number; direction: 'up' | 'down' | 'none' } | null;
  /** Decomp `destIndex`. */
  destination: number;
  prop: DwPropKind;
  /** The persisted platform flag (bit of `platformFlags`) that places it at its destination, or null. */
  flag: number | null;
}

/** A path of an elevator (decomp DistWorldElevatorPlatformPath). Offsets in tiles, `step` fx32 per frame. */
export interface DwElevatorPath {
  next: number | null;
  finalOffset: DwTile;
  changeMapsOffset: DwTile;
  step: DwFx32;
  setFlag: number | null;
  clearFlag: number | null;
}

/** A native event command (decomp `EventCmdKind`), with its references resolved. */
export type DwCommand =
  | { kind: 'set-map-object-animation'; localId: number; action: string }
  | { kind: 'move-platform'; platform: number; movePlayer: boolean; finalOffset: DwTile; step: DwFx32 }
  | { kind: 'add-map-object'; zone: Id; localId: number }
  | { kind: 'delete-map-object'; localId: number }
  | { kind: 'cascade-up' | 'cascade-down'; axis: number; direction: number; finishingFix: DwTile; finalOffset: DwTile; mapLoadOffset: DwTile; step: DwFx32 }
  | { kind: 'start-script'; label: Id }
  | { kind: 'set-progress'; progress: number }
  | { kind: 'show-giratina-shadow'; x: number; y: number; z: number; rotation: number; sound: number; scale: DwFx32; step: DwFx32; steps: number }
  | { kind: 'set-giratina-animation-flag'; animation: number }
  | { kind: 'set-puzzle-flag' | 'clear-puzzle-flag'; flag: number }
  | { kind: 'play-giratina-arrival' | 'show-uxie-boulder-tutorial' | 'show-azelf-boulder-tutorial' | 'show-mesprit-boulder-tutorial' | 'show-giratina-room-platforms' | 'hide-giratina-room-platforms' };

/** A position event (decomp DistWorldEvent): stepping on tile x/y/z with `when` true runs the commands. */
export interface DwEvent {
  x: number;
  y: number;
  z: number;
  when: DwCondition;
  commands: DwCommand[];
}

/** A simple prop (decomp DistWorldSimplePropTemplate) drawn while `when` holds. */
export interface DwSimpleProp {
  prop: DwPropKind;
  x: number;
  y: number;
  z: number;
  when: DwCondition;
}

/**
 * A special object (decomp DistWorldObjectEvent): an ordinary object event (x/z tiles in the shared space,
 * y world units) present while `when` holds, drawn turned `rotation` degrees (null: upright).
 */
export interface DwObject extends Omit<ObjectEvent, 'sprite' | 'trainer' | 'cloneOf' | 'cloneLocalId'> {
  sprite: Id;
  when: DwCondition;
  rotation: number | null;
}

/** Registry `distortionRooms` (id = the room's zone id). */
export interface DistortionRoom {
  id: Id;
  /** Where the room's land sits in the shared space: tiles, altitude in tiles (decomp map info offsets). */
  offset: { x: number; altitude: number; z: number };
  /** The floors kept loaded above and below (decomp sDistWorldMapConnectionList). */
  previous: Id | null;
  next: Id | null;
  supports: DwSupport[];
  jumps: DwJump[];
  cameraRows: DwCameraRow[];
  ghosts: DwGhosts | null;
  movingPlatforms: DwMovingPlatform[];
  events: DwEvent[];
  props: DwSimpleProp[];
  objects: DwObject[];
}

/** `NewGame.distortionWorld`: the overlay 9 tables shared by the rooms. */
export interface DistortionWorldTables {
  /** DWWarp's standalone titledemo model and looping joint/texture animation. */
  warp?: import('./boat.ts').ShipScene;
  elevatorPaths: DwElevatorPath[];
  /** sMapEventB5F_Waterfall / sMapEventB4F_Waterfall: run from code at the waterfall entries. */
  cascadeUp: DwCommand[];
  cascadeDown: DwCommand[];
  /**
   * 0.27.26. Each prop kind's model (decomp sProp3DModelNARCIndexByKind), drawn at its tile's centre (x, z) and
   * height tile × 16 + 8 plus `offset` (sPropInitialPosOffsetByKind, world units); `clip` is its joint clip
   * (sPropAnimSetNARCIndexByKind's BCA0), whose frame the world sets. Texture scrolls belong to the model.
   */
  props: Record<DwPropKind, { model: Id; offset: [number, number, number]; clip: { name: string; frames: number } | null }>;
  /**
   * 0.27.26. The sky behind the field (decomp InitSkyBackground, InitSkyClouds): main BG2's picture (`background`,
   * a 256-wide BG drawn from the screen's top left) and the seven cloud sets' sprites, each with the point of
   * the image that sits at the sprite's position.
   */
  sky: { background: Id; clouds: { image: Id; originX: number; originY: number }[] };
  /** The player's sprites here (decomp InitPlayer: OBJ_EVENT_GFX_DIST_WORLD_PLAYER_M/F and their _SURF sets). */
  playerSprite: { male: Id; female: Id };
  playerSurfSprite: { male: Id; female: Id };
}

/** Decomp DIST_WORLD_PLATFORM_FLAG_COUNT and DIST_WORLD_PUZZLE_FLAG_COUNT. */
export const DW_PLATFORM_FLAGS = 11;
export const DW_PUZZLE_FLAGS = 17;

/**
 * The saved slot (`MapFeatures` kind `distortion-world`; decomp DistWorldPersistedData). The init script
 * command selects and clears it (`valid` false); the room's first load fills it (InitPersistedData).
 * Elevator rides between floors keep it; a warp clears it.
 */
export interface DistortionWorldFeature {
  kind: 'distortion-world';
  valid: boolean;
  /** 24 bits: group n hidden. */
  hiddenGhostGroups: number;
  /** The current floating platform of the room (decomp currentFloatingPlatformIndex), null on land. */
  support: number | null;
  /** The camera angle offsets in 1/256 turns. */
  cameraAngle: [number, number, number];
  /** DW_PLATFORM_FLAGS bits (decomp DistWorldPersistedMovingPlatformFlag). */
  platformFlags: number;
  /** DW_PUZZLE_FLAGS bits (decomp DistWorldPersistedBoulderPuzzleFlag). */
  puzzleFlags: number;
  /**
   * The player's moving direction (decomp MapObject movingDir, saved with the map object): on a wall or the
   * ceiling `GameState.player.facing` is the drawn facing and this the input direction of the last step.
   */
  movingDir: Facing;
  /**
   * The moving platforms of the current floor and the one below (decomp: invisible persistent map objects, local
   * id 0xFD, saved with the map objects): the room and template index, the tile it stands on and its elevator
   * path now (a path that continues changes it).
   */
  platforms: { zone: Id; index: number; x: number; y: number; z: number; path: number }[];
}

/**
 * `FieldView.distortion` (0.27.18): what the renderer needs in a Distortion World room. The land of each
 * floor is drawn at its offset (tiles × 16 world units; altitude likewise); `floors[0]` is the current room.
 */
export interface DistortionView {
  floors: { zone: Id; matrix: Id; area: Id; offset: [number, number, number] }[];
  /** The player's surface: a support's kind, or `land`. */
  orientation: DwSupportKind | 'land';
  /** The player sprite's roll in degrees (decomp map object rotator), this tick and the last. */
  roll: { cur: number; prev: number };
  /**
   * The camera's angle offsets from the Distortion World's base camera (decomp DistWorldCameraManager currentAngle:
   * x, y, z as DS binary angles, 0x10000 a turn; z rolls the view), this tick and the last.
   */
  camera: { cur: [number, number, number]; prev: [number, number, number] };
  /**
   * The props drawn (decomp moving platform, ghost, simple and Giratina shadow prop animators), by a key stable
   * while they live: the kind's model at a position (world units, offsets applied), its opacity 0–31 (GX polygon
   * alpha; 31 opaque), its joint clip's frame when the kind has one, a uniform scale (the shadows; absent = 1) and
   * (0.27.28) its rotation in degrees about x, y, z (the Giratina shadows' sGiratinaShadowPropRotAngles; absent = none).
   */
  props: { key: string; prop: DwPropKind; cur: [number, number, number]; prev: [number, number, number]; opacity: number; frame?: number; scale?: number; rotation?: [number, number, number] }[];
  /**
   * The sky (0.27.26): its darkness 0–12 (decomp RecalculateSkyBackgroundDarkness: the BG and cloud palettes
   * tinted toward GX_RGB(4, 4, 8) and GX_RGB(6, 6, 8) by level/16) and each cloud: its set, its sprite's centre
   * on the 256×192 DS screen, its rotation in degrees and scale (DS affine OBJ, double size).
   */
  sky: { darkness: number; clouds: { set: number; x: number; y: number; rotation: number; scale: number }[] };
}
