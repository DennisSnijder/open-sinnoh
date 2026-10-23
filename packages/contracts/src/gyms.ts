/**
 * Map features: the gym puzzles (contracts 0.27.0 draft; docs/research/gym-puzzles.md). Three parts:
 *
 * - `MapFeatures` (GameState v14): the decomp's PersistedMapFeatures, one tagged save slot. A warp clears
 *   it (FieldMapChange_UpdateGameData); the zone's onTransition script selects and initializes it
 *   (`FieldHost.initMapFeatures`); every map load builds the runtime feature from it (DynamicMapFeatures_Init),
 *   a loaded save's too, without the transition. A zone connection keeps it.
 * - `GymTables` (`NewGame.gyms`): the overlay 8 tables the features read (gym_features.c), from the player's ROM.
 * - `FeatureModelView` and the fog of `FieldView.features`: what the renderer draws for them.
 */
import type { Id } from '@opensinnoh/core';
import type { Facing, Weather } from './records.ts';

export interface Tile {
  x: number;
  z: number;
}

/**
 * The saved slot (GameState v14; decomp PersistedMapFeatures). Platform lifts keep their own
 * `GameState.platformLift` (schema v6), which the DS keeps in this same slot.
 */
export type MapFeatures =
  /** EternaGymClockPersistedFeature: `clock` is the clock state 0–4 (decomp EternaClockState). */
  | { kind: 'eterna-gym'; clock: number }
  /**
   * HearthomeGymPersistedFeatures: once `initialized`, the correct door (decomp HEARTHOME_DOOR_ID_*, 8 =
   * exit: none) and the clue's tile.
   */
  | { kind: 'hearthome-gym'; initialized: boolean; correctDoor: number; clueX: number; clueZ: number }
  /**
   * VeilstoneGymPersistedFeature `initialized`, plus the puzzle's 20 objects: the DS saves them as invisible
   * map objects (local id 0xFD, data 0 = bag), which our `GameState.objects` cannot hold (no event), so the
   * slot holds where they are. `bags` in creation order; `stacks[i]` is null once stack i has toppled.
   */
  | { kind: 'veilstone-gym'; initialized: boolean; bags: Tile[]; stacks: (Tile | null)[] }
  /**
   * PastoriaGymPersistedFeature (0.27.11): the button last pressed, which sets the water level
   * (PASTORIA_*_BUTTON_PRESSED: 0 orange = low, 1 green = middle, 2 blue = high). Initially green.
   */
  | { kind: 'pastoria-gym'; pressedButton: number }
  /** CanalaveGymPersistedFeature (0.27.11): bit i set = platform i at its endpoint B. */
  | { kind: 'canalave-gym'; platformStates: number }
  | { kind: 'sunyshore-gym'; roomID: number; rotationState: number }
  /**
   * 0.29.1. GreatMarshTramState: the quick tram's station (decomp GREAT_MARSH_TRAM_LOCATION_AREA_1_2 0, _3_4 1,
   * _5_6 2); InitGreatMarshTram starts it at areas 5 and 6.
   */
  | { kind: 'great-marsh'; tram: number }
  /** The Distortion World (0.27.18; `distortion.ts`). */
  | import('./distortion.ts').DistortionWorldFeature
  /**
   * 0.37.0. The Villa (decomp InitPersistedMapFeaturesForVilla: a dummy int, zeroed): the furniture is built from its
   * flags on every map load (`villa.ts`).
   */
  | { kind: 'villa' };

/** Eterna Gym's flower clock (gym_features.c, EternaGym_*). States index every table (ETERNA_CLOCK_MAX = 5). */
export interface EternaGymTables {
  /** MAP_HEADER_ETERNA_CITY_GYM: the hour-hand jumps apply only here (DynamicMapFeatures_WillPlayerJumpEternaGymClock). */
  zone: Id;
  /** VAR_ETERNA_GYM_FLOWER_CLOCK_STATE: the saved copy the feature rebuilds from. */
  clockVar: Id;
  /** The fountain message the clock task prints from the gym's bank (EternaGym_Text_FountainWaterLevelDropped). */
  message: Id;
  /** sEternaGymClockTimes: hour 0–11 and minute per state. */
  times: { hour: number; minute: number }[];
  /** sEternaGymHourHandJumpTiles (null for the {-1, -1} entry): the jump tile and its axis. */
  jumps: ({ x: number; z: number; northSouth: boolean } | null)[];
  /** sEternaGymClockCollision: 13×13 per state, row-major from (5, 7); 1 = blocked. */
  clock: number[][];
  /** sEternaGymFountainCollision: x 1–21 of row z 19 per state; 1 = blocked. */
  fountains: number[][];
  /** sEternaGymRotationForHour: the hand angle (0x10000 a turn) of each hour. */
  hourRotations: number[];
  /** The hand props (eterna_gym_model_clock_hour_hand / _minute_hand); null when the import did not convert them. */
  hands: { hour: Id; minute: Id } | null;
  /**
   * The fountain (field-effect member 111) as two effects: its looping pattern (166, `loop`) and its draining
   * one (167, `drain`); null when not imported.
   */
  fountain: { loop: Id; drain: Id } | null;
}

/** Veilstone Gym's punching bags and tyre stacks (gym_features.c, VeilstoneGym_*). */
export interface VeilstoneGymTables {
  zone: Id;
  /** sPunchingBagPositions and sTireStackPositions: each object is created at z − 2. */
  bags: Tile[];
  stacks: Tile[];
  /** sVeilstoneTileBehaviors: 32×32, row-major; 0 open, 1 no bag, 2 no N/S, 3 no W/E, 4 stop point, 5 no W. */
  track: number[];
  /** sVeilstoneTravelDistanceRequiringCameraMovement: a longer push moves the camera. */
  cameraDistance: Record<Facing, number>;
  /**
   * Field effects: the bag (member 113) once per joint clip, keyed by clip (`still-n|s|w|e` 182–185,
   * `move-n|s|w|e` 186–189: decomp DIR_* order, picked by the direction opposite the push); the stack (114);
   * the toppled stack (112, clip `topple` lasting its longest component). Null when not imported.
   */
  effects: { bag: Record<string, Id>; stack: Id; toppled: Id } | null;
}

/** One trainer room of Hearthome Gym (sTrainerRoomLayouts, sTrainerRoomValidCluePositions, sTrainerRoomDoors). */
export interface HearthomeGymRoom {
  zone: Id;
  /** The room's first door id and how many exit doors it has. */
  firstDoor: number;
  doorCount: number;
  /** The clue mask's tile offset and size. */
  offsetX: number;
  offsetZ: number;
  width: number;
  depth: number;
  /** width × depth, row-major; 1 = no clue there. */
  clueMask: number[];
  doors: { door: number; x: number; z: number }[];
}

/** Hearthome Gym's dark rooms (gym_features.c, HearthomeGym_*). */
export interface HearthomeGymTables {
  rooms: HearthomeGymRoom[];
  /** MAP_HEADER_HEARTHOME_CITY_GYM_ENTRANCE_ROOM: a wrong door leads to its warp 1. */
  entrance: Id;
  /** BADGE_ID_RELIC: lighter fog. */
  relicBadge: Id;
  /** OBJ_EVENT_GFX_PLAYER_M/F_HEARTHOME_GYM. */
  playerSprite: { male: Id; female: Id };
  /**
   * Field effects: the clue symbols by door id (members 0x74–0x7B); `light` (0.27.7): the light beam's model
   * (member 0x73, its looping texture scroll 0xC7 a `scroll` texture animation on its material). Null when not
   * imported.
   */
  effects: { symbols: Id[]; light: Id } | null;
  /**
   * 0.27.7. The light beams (overlay 5, ov5_021F47B0.c; read from the ROM): by facing in DS direction order
   * (up, down, left, right), the beam's rotation (degrees about x, then y, then z: MTX_Rot33Angles) and, for
   * each length 0–5 tiles, its scale and its offset from the object (world units); the model is drawn 16
   * units above the offset.
   */
  light: { rotations: [number, number, number][]; scales: [number, number, number][][]; offsets: [number, number, number][][] };
}

/**
 * Pastoria Gym's water and buttons (0.27.11; gym_features.c PastoriaGym_*). The props by build model
 * (map_prop_models.order): the buttons are placed by the map (their one pattern animation is the press), the
 * water floor is loaded by the feature. The H/M/L ground behaviours are tile behaviour names.
 */
export interface PastoriaGymTables {
  buttons: { blue: Id; green: Id; orange: Id };
  water: Id;
}

/** One of Canalave Gym's 24 lifts (sCanalavePlatformPaths): endpoints in tiles (y in tiles, 10 a floor). */
export interface CanalaveGymPlatform {
  /** The platform's prop (canalave_gym_platform_x/y/z_direction, _red). */
  prop: Id;
  /** How it moves: along x or z (a horizontal ride), or y (the y-direction and red lifts). */
  axis: 'x' | 'y' | 'z';
  a: [number, number, number];
  b: [number, number, number];
  floorA: number;
  floorB: number;
}

/** Canalave Gym's lifts (0.27.11; gym_features.c CanalaveGym_*). */
export interface CanalaveGymTables {
  platforms: CanalaveGymPlatform[];
  /** sCanalaveGymPlatformsStartInPositionB (arm9, what the onTransition init reads). */
  startInB: boolean[];
  /** sCanalaveGymCollisionMaps: 32×32 per floor 0–3, row-major; 1 = blocked. */
  collision: number[][];
  /** canalave_gym_second_floor, _third_floor, _fourth_floor props. */
  floors: [Id, Id, Id];
}

export interface GymTables {
  eterna: EternaGymTables;
  veilstone: VeilstoneGymTables;
  hearthome: HearthomeGymTables;
  pastoria: PastoriaGymTables;
  canalave: CanalaveGymTables;
  sunyshore?: SunyshoreGymRoom[];
}

/** Overlay 8's gear setups, collision rectangles and four selections, read from the user's ROM. */
export interface SunyshoreGymRoom {
  gears: { prop: Id; x: number; y: number; z: number; initialRotation: number; clockwise: boolean; vertical: boolean }[];
  rectangles: { x: number; z: number; width: number; depth: number }[];
  collisions: number[][];
}

/**
 * A model a map feature places itself (decomp MapPropManager_LoadOne): a `prop`
 * (its model with the area's prop textures) or a `model` with its own textures (a field-effect model).
 * `rotation` is degrees about x, then y, then z (MTX_Rot33Angles; 0.27.7 names the order).
 */
export interface FeatureModelView {
  key: string;
  prop?: Id;
  model?: Id;
  position: [number, number, number];
  rotation: [number, number, number];
  /** 0.27.7: the position last tick (drawn interpolated); absent = `position`. */
  prev?: [number, number, number];
  /** 0.27.7: per-axis scale (Simple3D_DrawRenderObj's scale, applied before the rotation); absent = 1. */
  scale?: [number, number, number];
  /**
   * 0.27.7: a light (Hearthome Gym's beams): its texels' alpha blends (the beam's a5i3 texture), and like any
   * DS translucent polygon without fog it clears the fog flag of the pixels it covers, so the floor under it
   * is drawn unfogged (GBATEK "DS 3D Fog": a translucent pixel's flag is the old flag AND the polygon's).
   */
  light?: boolean;
  /** 0.27.11: a joint clip of the model (a prop's `animations[use].clip`) posed at `tick` (the boat's bridges). */
  clip?: { name: string; tick: number };
}

/** `FieldView.features` (0.27.0): the feature's own models and its fog (FogManager), which replaces the weather's. */
export interface FeaturesView {
  models: FeatureModelView[];
  fog?: NonNullable<Weather['fog']>;
  /**
   * 0.27.11: props whose model's texture animations (`Model.animations`) the feature drives (decomp
   * MapPropAnimation paused, reversed or played once: Pastoria Gym's buttons): every placement of `prop` shows
   * the frame at `tick` (0 … frames − 1) instead of the global clock's.
   */
  propPoses?: { prop: Id; tick: number }[];
}
