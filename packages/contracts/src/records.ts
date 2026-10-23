/**
 * Gen 4 registry record shapes (contracts v0.9). Every record is plain JSON with a namespaced `id`.
 * Native ROM indexes are kept as `sourceIndex` where the engine or importer needs them.
 *
 * Coordinates: event and player x/z are tile coordinates within the zone's matrix (matrix cell × 32 +
 * chunk tile); y is in world units. Distortion World rooms use their shared space instead (distortion.ts). World units match the DS (1 tile = 16 units, 1 chunk = 32 tiles =
 * 512 units). x grows east, z grows south, y is up. fx32 values are converted to plain numbers.
 */
import type { GymTables } from './gyms.ts';
import type { DistortionRoom, DistortionWorldTables } from './distortion.ts';
import type { Cry, Sequence, SoundBank, SoundPlayer, WaveArchive } from './audio.ts';
import type { FrontierTables } from './frontier.ts';
import type { BagPocket, GrowthRateData, HeldItemData, Id, MoveData, NatureData, SpeciesData, StatName, TrainerMonData } from '@opensinnoh/core';

/** `<pack>:<path>`, a file inside a pack, e.g. `platinum:models/land/0.gltf`. */
export type AssetRef = Id;

export const REGISTRIES = [
  'zones',
  'matrices',
  'chunks',
  'areas',
  'lights',
  'weathers',
  'fieldEffects',
  'encounters',
  'tileBehaviors',
  'props',
  'models',
  'textureAnimations',
  'cameras',
  'sprites',
  'followers',
  'followerTalk',
  'movements',
  'texts',
  'textBanks',
  'flags',
  'vars',
  'species',
  'moves',
  'abilities',
  'types',
  'natures',
  'growthRates',
  'items',
  'marts',
  'trainers',
  'fonts',
  'newGame',
  'titleScreens',
  'ui2d',
  'pokemonSprites',
  'trainerSprites',
  'battleBackgrounds',
  'battleTerrains',
  'aiScripts',
  'battleAnimations',
  'particleSystems',
  'battleAnimData',
  'sequences',
  'soundBanks',
  'waveArchives',
  'soundPlayers',
  'cries',
  'distortionRooms',
] as const;
export type RegistryName = (typeof REGISTRIES)[number];

export type Facing = 'up' | 'down' | 'left' | 'right';

/** A zone (decomp "map header"): one logical map with its events, scripts and settings. */
export interface Zone {
  id: Id;
  sourceIndex?: number;
  name: string;
  matrix: Id;
  area: Id;
  camera: Id;
  mapType: 'town' | 'city' | 'route' | 'outdoors' | 'indoors' | 'cave' | 'other';
  /** The map header's weather (a `weathers` record); a yearly weather is resolved from the date on map change. */
  weather: Id;
  /** The zone's BGM by day and by night (decomp MapHeader day/night music ids; `sequences`), null for none. */
  music: { day: Id | null; night: Id | null };
  /** CanUseFishingRod exclusions, resolved by the importer from header ids. */
  noFishing?: boolean;
  /** MapHeader_HasFeebasTiles: the Feebas species and the lake's fishing tiles (matrixWidth*32*z + x), from encdata_ex. */
  feebas?: { species: Id; tiles: number[] };
  flags: { bike: boolean; running: boolean; escapeRope: boolean; fly: boolean };
  /** Wild encounter table, if the zone has one. */
  encounters?: Id;
  /** The battle backdrop (a `battleBackgrounds` id, decomp MapHeader_GetBattleBG); absent when the packs have no battle art. */
  battleBackground?: Id;
  /**
   * A blackout spawn (decomp sSpawnLocations with isWarpPos, 0.14.0): entering this zone by a warp makes it
   * the blackout destination (`GameState.blackOut`); a lost battle warps here, facing up, and runs `label`
   * (decomp FieldTask_BlackOutFromBattle: CommonScript_PlayerHouseBlackOutRecover for the default spawn,
   * CommonScript_PokecenterBlackOutRecover otherwise). `spawn` is the decomp spawn id (1 = the default).
   */
  blackOut?: { spawn: number; x: number; z: number; label: Id };
  /**
   * 0.28.3. The fly location this zone unlocks on entry (decomp sSpawnLocations rows with `unlockOnMapEntry`,
   * TryUnlockFlyLocationByMap): entering it by a warp or a zone connection sets this `FLAG_FIRST_ARRIVAL_*`
   * flag. The same flags are Fly's town list.
   */
  firstArrival?: Id;
  /** Level scripts (decomp "init scripts"). */
  mapScripts: MapScripts;
  events: ZoneEvents;
  /** The map-name popup shown on entering the zone. Absent: the zone never shows one. */
  mapPopup?: MapPopup;
  /**
   * 0.21.1. The zone's special evolution method (decomp MapHeader_GetMapEvolutionMethod): Mt. Coronet's
   * magnetic field, Eterna Forest's moss rock, Route 217's ice rock. Absent elsewhere.
   */
  mapEvolution?: 'LEVEL_MAGNETIC_FIELD' | 'LEVEL_MOSS_ROCK' | 'LEVEL_ICE_ROCK';
  /**
   * 0.27.12. Whether the lead party Pokémon may follow the player here (HGSS map header follow mode;
   * docs/research/following-pokemon.md): `allow`, `height-restrict` (no `large` follower sets) or `prevent`.
   * Platinum has no such field: its importer writes an original policy by map type (docs/decisions.md).
   * Absent: `allow`.
   */
  follow?: FollowMode;
}

/** 0.27.12. A zone's follow mode (HGSS FOLLOW_MODE_* order: PREVENT, HEIGHT_RESTRICT, ALLOW). */
export type FollowMode = 'prevent' | 'height-restrict' | 'allow';

/**
 * 0.27.12. A party follower set: the overworld sprite the lead party Pokémon follows the player with
 * (docs/research/following-pokemon.md). Selection is by `species` (the base game's species id, never a
 * raw index of another game), `form` and gender: a female Pokémon takes a `female` set of its species and
 * form, else the set for any gender. Only an exact form matches; a Pokémon with no set does not follow.
 * When several records claim the same species, form and gender, the one loaded last wins (pack order:
 * base, add-ons, mods), whatever its id.
 */
export interface FollowerSprite {
  id: Id;
  species: Id;
  form: number;
  /** A set for female Pokémon only (HGSS's female sets). Absent: any gender. */
  gender?: 'female';
  /** A billboard `sprites` record with `stand-<dir>` and `walk-<dir>`. */
  sprite: Id;
  /** The shiny colours (HGSS palette 1). Absent: shiny Pokémon use `sprite`. */
  shiny?: Id;
  /** `large`: a 64×64 set (HGSS tp_param "too tall"); it does not follow in `height-restrict` zones. */
  size: 'small' | 'large';
  /**
   * How the frames advance: `walk`, the DS walk counter (Platinum's 16-frame walk sets, still while
   * standing); `loop`, ticks since the follower appeared (HGSS's two-frame sets).
   * Idle followers hold their facing's first stand frame unless DeviceOptions.followerStyle enables
   * walking in place.
   */
  animation: 'walk' | 'loop';
}

/**
 * 0.32.1. HGSS's follower talk (the HGSS add-on, read from the player's HGSS ROM; DeviceOptions.followerTalk): A on
 * the following Pokémon picks an interaction by its rules and plays it (HGSS FollowMon_SelectInteraction,
 * FollowMonInteraction_Run). Only HGSS's global rules: the map-section rules name Johto and Kanto. Every predicate a
 * rule uses is one the game evaluates (0 = any): HP bucket 1–5 (full, ≥75, ≥50, ≥25 %, less), status (1 none,
 * 2 burn, 3 freeze, 4 paralysis, 5 poison, 8 sleep; 7 any of those), friendship and mood codes (HGSS
 * FollowMonRule_CheckFriendship/_CheckMood), type (HGSS's own type codes), the tile under the follower (a tile
 * behaviour's `sourceIndex`; the add-on keeps only behaviours numbered alike in both games), hidden items left in
 * the zone (4 = four or more) and the follower's facing (1 east, 2 west, 3 north, 4 south). `chance` is the
 * percentage the roll must be under. A cosmetic record: nothing in it changes the game (no friendship change).
 */
export interface FollowerTalk {
  id: Id;
  /** In the order HGSS scans them. */
  rules: { interaction: number; chance: number; hp: number; status: number; friendship: number; mood: number; type: number; behavior: number; hiddenItems: number; facing: number }[];
  /**
   * The interactions the rules name (HGSS /a/2/2/1): up to five steps, each a motion, an emote (1–14, the bubble),
   * a message, a cry (0 none, 1 the plain cry, 2 the Pokédex cry, played on a motion's sound frames) and a wait in
   * ticks; `mood` is added to the follower's mood afterwards.
   */
  interactions: { id: number; steps: { motion: number; emote: number; message: number; cry: 0 | 1 | 2; wait: number }[]; mood: number }[];
  /** The motions (HGSS /a/2/2/2): per frame of a motion, a facing (null: kept), its ticks, an offset in world units and whether the cry plays. */
  motions: { id: number; frames: { facing: Facing | null; ticks: number; dx: number; dy: number; dz: number; sound: boolean }[] }[];
  /** The messages the interactions print (HGSS bank 265): {var 0} nickname, 1 species, 2 player, 3 location, 4 held item. */
  messages: { id: number; text: string }[];
  /** The 14 emote bubbles (HGSS field effects): billboard sprites of two frames, shown in `emoteFrames` order. */
  emotes: Id[];
  /** The bubble's frame sequence (BillboardGfxSequence used as EmoteBubbleAnim): texture and ticks per step. */
  emoteFrames: { frame: number; ticks: number }[];
}

/**
 * The map-name popup (decomp map header mapLabelTextID/mapLabelWindowID, overlay 5 map_name_popup.c).
 * It shows `Zone.name` on the `window` signboard. A zone crossing shows it when `label` differs from
 * the zone left. A warp, a new game or a loaded save shows it only when `onWarp` is set.
 */
export interface MapPopup {
  /** The location-name text id. Zones that share a name share it. */
  label: number;
  /** The signboard: a one-cell `ui2d` sheet with `textColors` (town, route, cave, …). */
  window: Id;
  /** False for buildings and for zones whose header has no window (decomp FieldSystem_RequestLocationName). */
  onWarp: boolean;
}

export interface MapScripts {
  onLoad?: Id;
  onTransition?: Id;
  onResume?: Id;
  /** Re-checked every idle tick (no script running): the first row whose var equals value runs. */
  onFrame: { var: Id; value: number; label: Id }[];
}

export interface ZoneEvents {
  bgs: BgEvent[];
  objects: ObjectEvent[];
  warps: WarpEvent[];
  coords: CoordEvent[];
}

export interface BgEvent {
  label: Id;
  kind: 'interact' | 'sign' | 'hidden-item' | 'other';
  sourceType?: number;
  x: number;
  z: number;
  y: number;
  /** Facing the player must have: one direction, an axis ('horizontal' = left/right, 'vertical' = up/down), or 'any'. The world honours all of them. */
  facing: Facing | 'horizontal' | 'vertical' | 'any';
  /**
   * A hidden item (0.21.0; decomp gHiddenItems): the flag set once it is picked up, the Dowsing Machine's
   * range (0–2: 8, 24 or 48 px on its map), the item and its quantity.
   */
  hiddenItem?: { flag: Id; range: number; item: Id; quantity: number };
}

/** Clone objects (decomp: hide flag = a zone id, script 0xFFFF) have no hideFlag or label; `cloneOf` names that zone. */
export interface ObjectEvent {
  localId: number;
  sprite: Id | { var: Id };
  movementType: number;
  trainerType: number;
  /** Object is hidden while this flag is set. */
  hideFlag?: Id;
  label?: Id;
  facing: Facing;
  /** data[0] = trainer sight range in tiles (trainerType ≠ 0). */
  data: [number, number, number];
  /** Movement range around the spawn tile for wandering types (-1 = unlimited). */
  range: { x: number; z: number };
  /**
   * Trainer objects (decomp script 3000+/5000+): the trainer and which side of a double pair this object
   * is (battler 1 = the 5000+ script). Both objects of a double pair name the same trainer.
   */
  trainer?: { id: Id; battler: 0 | 1 };
  /**
   * A clone (decomp script 0xFFFF; 0.13.1): this zone's copy of the object with the same local id in the
   * named neighbouring zone, so it shows from across a zone border. The decomp keeps that zone in the
   * hide flag. On a zone connection the one object carries over (decomp sub_0206184C).
   */
  cloneOf?: Id;
  /** Source local id when an unscripted border stand-in uses a different native local id. */
  cloneLocalId?: number;
  x: number;
  z: number;
  y: number;
}

export interface WarpEvent {
  x: number;
  z: number;
  /** 'dynamic' = the saved dynamic warp target (elevators); not used by the v0.1 slice. */
  toZone: Id | 'dynamic';
  toWarp: number;
}

export interface CoordEvent {
  label: Id;
  x: number;
  z: number;
  width: number;
  length: number;
  y: number;
  /** Fires once when the player completes a step onto the rectangle while `var` equals `value`. `y` is not checked (as on the DS). */
  var: Id;
  value: number;
}

/** Grid of chunks. Cells are row-major (x + z*width). */
export interface Matrix {
  id: Id;
  sourceIndex?: number;
  width: number;
  height: number;
  /** `null` = empty cell. */
  chunks: (Id | null)[];
  /** Zone per cell when the matrix spans several zones; absent = the loading zone everywhere. */
  zones?: (Id | null)[];
  /** Altitude per cell in world units / 8 (DS value); absent = all 0. */
  altitudes?: number[];
  /**
   * 0.34.1. Copies of this matrix a map load uses instead, by game state (decomp FieldMapChange_InitTerrainCollisionManager:
   * MapMatrix_RevealSpringPath, MapMatrix_RevealSeabreakPath): the first variant whose every condition holds. A zone
   * connection keeps the loaded matrix (the DS loads it only with the map).
   */
  variants?: MatrixVariant[];
}

/** A matrix variant: used while each `when` var equals (`equals: true`) or differs from (`false`) its value. */
export interface MatrixVariant {
  matrix: Id;
  when: { var: Id; value: number; equals: boolean }[];
}

/** The matrix a map load of `matrix` uses (`Matrix.variants`); `varValue` reads a var by id. */
export function loadedMatrix(matrices: ReadonlyMap<Id, Matrix>, matrix: Matrix, varValue: (id: Id) => number): Matrix {
  const v = matrix.variants?.find((x) => x.when.every((c) => (varValue(c.var) === c.value) === c.equals));
  if (!v) return matrix;
  const m = matrices.get(v.matrix);
  if (!m) throw new Error(`matrix ${matrix.id}: variant ${v.matrix} is not a matrix`);
  return m;
}

/** One 32×32-tile land chunk. */
export interface Chunk {
  id: Id;
  sourceIndex?: number;
  /** 1024 tiles, row-major (x + z*32). Each value: bit 15 = blocked, bits 0–7 = behaviour. */
  tiles: number[];
  model: Id;
  props: PropPlacement[];
  terrain: Terrain;
}

export interface PropPlacement {
  prop: Id;
  /** Chunk-local world units, origin at the chunk centre. */
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** Terrain height (DS "BDHC"): planes on strips, chunk-local coordinates. */
export interface Terrain {
  points: [number, number][];
  normals: [number, number, number][];
  constants: number[];
  plates: { p1: number; p2: number; normal: number; constant: number }[];
  strips: { z: number; count: number; start: number }[];
  accessList: number[];
}

/** Area: which texture set chunk models and props bind to, and lighting. */
export interface Area {
  id: Id;
  sourceIndex?: number;
  /** The area's light template (Platinum: the area_data light id, a member of `/data/arealight.narc`). */
  light: Id;
  /** Texture set (directory of PNGs keyed by texture name) for chunk models; absent = models embed textures. */
  mapTextures?: AssetRef;
  /** Texture set for props in this area; absent = models embed textures. */
  propTextures?: AssetRef;
}

/**
 * Area light template (DS lights and global material colours). Every map model in the area is lit by its lights;
 * the land models take these material colours instead of their own (Platinum AreaLight_UseGlobalModelAttributes,
 * `NNS_G3dMdlUseGlb*`) unless `indoor`, and props keep their own (map_prop.c). Lit material formula: GBATEK
 * "DS 3D Polygon Light Parameters", evaluated in view space for the zone's camera.
 * The fields below are the template active at midday (title and scene models use it); `schedule` holds
 * the time-of-day templates the field switches between.
 */
export interface Light extends LightTemplate {
  id: Id;
  sourceIndex?: number;
  /**
   * 0.34.4. The land models keep their own material colours under these lights (decomp
   * AreaDataManager_IsOutdoorsLighting is false: arealight members 1 and 2). Absent = they take the template's.
   */
  indoor?: true;
  /**
   * Time-of-day templates in order (0.17.0; decomp AreaLightManager): the field uses the first whose
   * `until` (seconds since midnight, exclusive) is later than the clock, else the first, and switches
   * (no blend) when the clock passes it. Absent = the template above all day.
   */
  schedule?: (LightTemplate & { until: number })[];
}

/** One area light template: 4 DS lights and the global material colours. */
export interface LightTemplate {
  /** Exactly 4 entries (DS lights 0–3); null = off. Colour 0..1; direction is a (roughly unit) view-space vector. */
  lights: ({ color: [number, number, number]; direction: [number, number, number] } | null)[];
  /** Global material colours, [r,g,b] 0..1. */
  diffuse: [number, number, number];
  ambient: [number, number, number];
  specular: [number, number, number];
  emission: [number, number, number];
}

/** A building or object placed by chunks. */
export interface Prop {
  id: Id;
  sourceIndex?: number;
  model: Id;
  /**
   * Animations inside the prop's glTF, by use (`open` and `close` for doors): the clip name and its
   * length in 30 Hz ticks (one DS frame per tick). The world times `doorDone` from `ticks`. A door clip
   * may instead name a `frames` TextureAnimation id (a DS BTP0 pattern, as field effect clips do; the
   * elevator door): it plays once over `ticks` on the materials binding its texture and holds its last
   * frame, and it applies nowhere else.
   * `loop: true` marks a clip the renderer plays continuously from scene build (DS BTP0/BTA0/BCA prop
   * loops: windmills, water wheels, flags); the world never times it. Its use key is free (`loop`, `loop-2`).
   * `pc-on` / `pc-off` are a PC's boot-up and shut-down clips (decomp pc_animation.c, bm_anime
   * entries 0 and 1 of the PC models), played and timed like a door's `open` / `close`.
   * `elevator-up` / `elevator-down` name `scroll` TextureAnimation ids (the elevator lights, decomp
   * FieldTask_PlayElevatorAnimation): they play on this prop's materials only, while
   * `FieldView.elevatorLights` names their direction.
   */
  /** Door clip cues by SDAT sourceIndex; 0 means intentionally silent. Absent in packs without door audio. */
  doorSounds?: { open: number; close: number };
  animations?: Record<string, PropAnimation>;
}

export interface PropAnimation {
  clip: string;
  ticks: number;
  loop?: boolean;
}

/**
 * Overworld weather (decomp `OVERWORLD_WEATHER_*`, `sourceIndex` = the value; the 31-entry weather task
 * table in `ov5_021D5EB8.c`). Weather rolls no simulation random numbers. Fields absent = the weather does
 * not have that part, except those listed in `pending` (not decoded yet; the renderer logs a stub for
 * them).
 */
export interface Weather {
  id: Id;
  sourceIndex?: number;
  /** Decomp name without the prefix (`CLEAR`, `FOG`, `DARK_FLASH`, `ROUTE_212_SOUTH`). */
  name: string;
  /** Screen particles (decomp weather OAM tasks): kind, and how many are alive at once. */
  particles?: { kind: WeatherParticles; count: number };
  /**
   * DS fog (GBATEK "DS 3D Fog"): `slope` = the GX_FOGSLOPE shift (0–10), `offset` = the depth (0..0x7fff)
   * where fog starts, `color` 0..1, `alpha` 0..31, `densities` = the 32-entry density table (0..127).
   */
  fog?: { slope: number; offset: number; color: [number, number, number]; alpha: number; densities: number[] };
  /** A light template used instead of the area's while this weather is active. */
  light?: Id;
  /** Dark map: everything outside a circle of `radius` DS px around the player is black (decomp DARK_FLASH). */
  darkness?: { radius: number };
  /** Yearly weathers (decomp sYearlyWeather): the weather of each day of the year, 366 entries from Jan 1. */
  yearly?: Id[];
  /**
   * The weather's BG2 layer, drawn over the 3D field and under the particles (decomp: the weather task
   * table's BG resource names a `weather_sys.narc` {NCLR, NCGR, NSCR} entry of `Unk_ov5_021F8D90`; BG2 at
   * priority 1). `image` is the 256×256 BG as a PNG (colour 0 transparent), repeating both ways like the
   * DS BG wraps. At tick t, DS screen pixel (x, y) shows image pixel ((x + scroll[0]·t) mod 256,
   * (y + scroll[1]·t) mod 256) (the task's per-tick `G2_SetBG2Offset` step, in DS px). `alpha` is the
   * task's steady `G2_SetBlendAlpha` EVA / 16 (BG2 over the 3D and backdrop, EVB = 16 − EVA); 1 when
   * the task sets no blend (opaque pixels). The fades in and out are not modelled.
   */
  layer?: { image: AssetRef; scroll: [number, number]; alpha: number };
  /**
   * 0.34.1. How the weather fades in and out when it changes without a map load (decomp ov5_021D5F7C: a zone
   * connection, or a script's weather update); a map load shows it at full at once (ov5_021D5F24). Absent = no fade.
   */
  fade?: WeatherFade;
  /** Fields that are not decoded yet (absent from the record for now). */
  pending?: ('particles' | 'fog' | 'light' | 'darkness' | 'yearly' | 'layer')[];
}

/**
 * A weather task's fades (decomp ov5_021D5EB8.c). Changing weather fades the old one out, loads the new one and fades
 * it in; weathers listed in `overlaps` instead fade in while the old one fades out (ov5_021D6178).
 */
export interface WeatherFade {
  /**
   * The particle spawner's ramp (ov5_021D7210, ov5_021D7238, ov5_021D7244): per tick of the fade, its spawn rate
   * over the faded-in rate. The fade in ends at the last entry; the fade out also waits for the last particles to leave.
   */
  particles?: { in: number[]; out: number[] };
  /** The fog density ramp (ov5_021D749C, ov5_021D7534): 127 steps of `in` / `out` ticks each. */
  fog?: { in: number; out: number };
  /**
   * The BG layer's blend from 0 to `Weather.layer.alpha` over `in` ticks and back over `out` (ov5_021D64FC); `steady`:
   * the layer shows only once faded in and goes at the start of the fade out (the sandstorm and blizzard BGs).
   */
  layer?: { in: number; out: number } | 'steady';
  overlaps?: Id[];
}

/** The 127 steps of a fog density fade (ov5_021D749C: unk_24 = 127). */
export const WEATHER_FOG_STEPS = 127;

/**
 * 0.34.4. Ticks from a weather's end to the next one's fade in when they do not overlap (ov5_021D5FE4): freeing it,
 * starting the load, the 9 load steps (ov5_021D6A84), seeing them done, and starting the task.
 */
export const WEATHER_LOAD_TICKS = 12;

/**
 * 0.34.4. A weather's fade length in ticks: the longest of its particle ramp, fog steps and BG blend (`keepsFog`: an
 * overlapped weather's fade out leaves the fog alone). The renderer's fade out also waits for its last particles to leave.
 */
export function weatherFadeTicks(w: Weather, phase: 'in' | 'out', keepsFog = false): number {
  const f = w.fade;
  if (!f) return 0;
  const layer = f.layer && f.layer !== 'steady' ? f.layer[phase] : 0;
  return Math.max(f.particles?.[phase].length ?? 0, f.fog && !keepsFog ? f.fog[phase] * WEATHER_FOG_STEPS : 0, layer);
}

export type WeatherParticles = 'rain' | 'heavy-rain' | 'thunder' | 'snow' | 'heavy-snow' | 'blizzard' | 'ash' | 'sand' | 'hail' | 'spirits' | 'diamond-dust';

/**
 * A field effect (decomp `FIELD_EFFECT_RENDERER_*`, `sourceIndex` = that index): grass rustle, shadow,
 * ledge dust, footprints, splashes, ripples, the surf blob, reflections, bike tracks, HM animations.
 * Drawn from `FieldView.effects`. Either a model (clips by use, as in `Prop.animations`) or a billboard
 * sprite set (its animations by the same use names).
 */
export interface FieldEffect {
  id: Id;
  sourceIndex?: number;
  /** Decomp renderer name without the prefix (`TALL_GRASS`, `SHADOW`, `SURF_BLOB`). */
  name: string;
  model?: Id;
  sprite?: Id;
  animations?: Record<string, PropAnimation>;
}

/**
 * A model: glTF 2.0 asset. Materials may carry `extras.lantern`:
 * `{ alpha: 0..31, cull: 'back'|'front'|'none', fog: boolean, lit: boolean, polygonId: number,
 *    depthUpdate?: boolean, texture?: string, palette?: string, diffuse?, ambient?, specular?, emission?
 *    ([r,g,b] 0..1), lights?: number (bitmask), wrapS?/wrapT?: 'clamp'|'repeat'|'mirror' }`; nodes may carry
 * `extras.lantern.billboard: 'full'|'y'` (SBC BB/BBY: turned to face the camera as drawn). When `texture` is
 * set and the glTF has no image, the texture is
 * bound by name from the area's texture set: file `<set dir>/<texture>__<palette>.png`, listed in
 * `<set dir>/index.json` (a JSON array of `<texture>__<palette>`); a pair the set does not list is left
 * unbound (drawn untextured, as on the DS).
 * Platinum sets: `platinum:textures/map/<mapTexSet>` and `platinum:textures/build/<propSet>`.
 * Defaults when a field (or all of `extras.lantern`, e.g. a glTF exported from Blender) is missing:
 * alpha 31 (opaque), cull from the glTF material (`doubleSided` → none, else back), lit false (no DS
 * lighting: the material colour and vertex colours are drawn as they are), lights 0, texture = the glTF
 * image when it has one, depthUpdate false (translucent pixels keep the depth under them; POLYGON_ATTR
 * bit 11). glTF `alphaMode: 'BLEND'` at alpha 31 marks a texture with per-texel alpha (DS a3i5/a5i3): its
 * texels at alpha 1..30 blend, those at 31 draw opaque and those at 0 not at all. diffuse/ambient/specular/
 * emission light props and indoor land (their own colours); wrapS/wrapT are not read yet (glTF images use the
 * glTF sampler; textures bound by name repeat).
 * `extras.lantern` and the `Lantern_*` text ids keep their pre-rename names: imported packs and mods carry them.
 */
export interface Model {
  id: Id;
  gltf: AssetRef;
  animations?: Id[];
}

/** Texture animation keyed by texture name (frame swap / pattern) or material name (SRT scroll). */
export type TextureAnimation =
  | { id: Id; kind: 'frames'; texture: string; frames: { texture: string; ticks: number }[] }
  | {
      id: Id;
      kind: 'scroll';
      material: string;
      /** Translation in texture widths/heights per frame value. */
      frames: number;
      /** Per-frame values (length = frames) or a constant. */
      translateS: number[] | number;
      translateT: number[] | number;
    };

/** Camera preset (DS camera table). Angles in degrees, distances in world units. */
export interface Camera {
  id: Id;
  sourceIndex?: number;
  distance: number;
  angle: [number, number, number];
  projection: 'perspective' | 'orthographic';
  /** Full vertical FOV in degrees (the DS table stores the half angle). */
  fovY: number;
  near: number;
  far: number;
}

/**
 * Object graphics. `sourceIndex` is the decomp object-gfx id (what scripts store in VAR_OBJ_GFX_*),
 * so ids follow decomp OBJ_EVENT_GFX_* names. Either a billboard sprite set (PNG atlas of square
 * frames and named animations) or a 3D model object (signposts, mailboxes): `model` is a Model id,
 * or null while that model is not converted (drawn as nothing, logged as a stub, still collides).
 * A model object is drawn unrotated at the object's position (tile centre, ground level); any DS
 * offset is baked into the model.
 */
export type Sprite = BillboardSprite | ModelSprite;

export interface ModelSprite {
  id: Id;
  sourceIndex?: number;
  model: Id | null;
}

export interface BillboardSprite {
  id: Id;
  sourceIndex?: number;
  atlas: AssetRef;
  frameSize: number;
  frameCount: number;
  /**
   * Animation name → frames with durations in 30 Hz ticks. Required: `stand-<dir>` and `walk-<dir>`
   * for dir in up/down/left/right; the player also has `run-<dir>`. Frames are drawn `frameSize` world
   * units square (one texel per unit). Animations loop, except poses: `pose-<name>` (or
   * `pose-<name>-<dir>` when the DS picks it by facing) plays once from `ActorView.animTick` 0 and holds
   * its last frame (Platinum: `pose-give`/`pose-receive` on the heal sets, `pose-bow` on the nurse).
   *
   * Static sets (objects that are not walk sets: the briefcase, a Poké Ball, Starly; Platinum: 1–4
   * square frames of one size) follow a minimal rule: every `stand-<dir>` is frame 0, and every
   * `walk-<dir>` loops all frames in order, 4 ticks each (a 1-frame set shows frame 0 throughout).
   */
  animations: Record<string, { frame: number; ticks: number }[]>;
}

/** Movement script: list of steps (decomp movement actions), e.g. `{ op: 'walk_normal_north', count: 2 }`. */
export interface Movement {
  id: Id;
  steps: { op: string; count: number }[];
}

/** Message text in OpenSinnoh markup (see text.ts). */
export interface Text {
  id: Id;
  text: string;
}

/**
 * A message bank (decomp pl_msg member, `sourceIndex` = bank number): its texts in message order. Commands
 * that pick a message by a runtime number (menu entries, `message_var`, Pokétch app names, move names)
 * look it up here.
 */
export interface TextBank {
  id: Id;
  sourceIndex?: number;
  messages: Id[];
}

export interface Flag {
  id: Id;
  sourceIndex?: number;
  initial: boolean;
  /** 'map' flags are cleared on map change. */
  scope: 'saved' | 'map';
}

/** Native commands that use fixed native vars/flags (e.g. VAR_PLAYER_STARTER 0x4030) find them by `sourceIndex`. */
export interface Var {
  id: Id;
  sourceIndex?: number;
  initial: number;
  /** 'map' vars are cleared on map change; 'temp' vars (0x8000+) live only while scripts run. */
  scope: 'saved' | 'map' | 'temp';
}

/**
 * A species (decomp SpeciesData, evo, wotbl, egg moves): the personal data, learnsets and evolutions the
 * Pokémon model reads (core `SpeciesData`). Forms with their own data are in `forms`.
 */
export interface Species extends SpeciesData {
  id: Id;
  sourceIndex?: number;
  name: string;
  /** Position in the starter choice (0–2); the native starter scene offers these species. */
  starterSlot?: number;
  /** Regional (Sinnoh) Pokédex number; absent = not in the regional dex. */
  regionalDex?: number;
  /** 0.16.0: the Pokédex entry (decomp zukan_data, zukan_enc_platinum, pokefoot and the species text banks); absent = no entry. */
  dex?: SpeciesDex;
}

/**
 * A species' Pokédex entry (0.16.0). Texts are text records (the ROM's US banks carry height and weight
 * as pre-formatted imperial strings); the numbers are what the sorts and the weight check compare.
 */
export interface SpeciesDex {
  /** "Seed Pokémon" (decomp TEXT_BANK_SPECIES_CATEGORY). */
  category: Id;
  description: Id;
  heightText: Id;
  weightText: Id;
  /** Decimetres and hectograms (decomp zukan_data members 0 and 1). */
  height: number;
  weight: number;
  /** Body shape, decomp enum PokemonBodyShape (0 quadruped … 13 multi-body). */
  shape: number;
  /** The 16×16 footprint (black on transparent); null when the species leaves none. */
  footprint: AssetRef | null;
  /** Size comparison against the player, per player gender (decomp zukan_data members 3–10; scale 256 = 1.0, y in px). */
  size: { male: DexSize; female: DexSize };
  /** Where it lives, by time and the honey tree/marsh/radar lists (decomp zukan_enc_platinum). */
  area: Record<DexAreaList, DexArea>;
  /** Forms whose size or weight differ (Platinum: Giratina's Origin Forme). */
  forms?: { form: number; heightText: Id; weightText: Id; height: number; weight: number; size: { male: DexSize; female: DexSize } }[];
}

export interface DexSize {
  trainerScale: number;
  trainerY: number;
  pokemonScale: number;
  pokemonY: number;
}

/** `special` is shown before the national dex, `specialNational` after (decomp PEFC_*SPECIAL*). */
export type DexAreaList = 'morning' | 'day' | 'night' | 'special' | 'specialNational';

/** Indexes into `PokedexMap.fields` and `PokedexMap.dungeons`. */
export interface DexArea {
  fields: number[];
  dungeons: number[];
}

/**
 * The Pokédex area map (0.16.0; decomp ov21_021DC9BC.c, zukan_enc_platinum members 0 and 2): a grid of
 * `columns`×`rows` cells of `cell` px drawn at `origin` over the map picture; a field paints its `cells`
 * (row-major in its `width`×`height` box at x, y); a dungeon is a marker at `dungeonOrigin + (x, y)·cell`.
 */
export interface PokedexMap {
  /** A `ui2d` sheet: cell 0 is the map, 256×192 DS px. */
  image: Id;
  origin: [number, number];
  dungeonOrigin: [number, number];
  cell: number;
  columns: number;
  rows: number;
  fields: { x: number; y: number; width: number; height: number; cells: number[] }[];
  dungeons: { x: number; y: number; coronet: boolean }[];
  /** Places shown only once found (decomp hidden locations): the var holds `value` then; the overlay is drawn over the map and `dungeons` become visible. */
  hidden: { var: Id; value: number; overlay: Id; dungeons: number[] }[];
}

/**
 * 0.29.0. The Town Map's fly mode (decomp applications/town_map, src/spawn_locations.c). The map is a grid of the
 * main matrix's cells (x 0–29 across, z down): the cursor stands on a cell, drawn at (7x + 25, 7z − 34) DS px.
 */
export interface TownMap {
  /** `ui2d` sheets: the 256×192 top screen, the cursor (animation 0), the player icon by gender (cell 0 male, 1 female). */
  screen: Id;
  cursor: Id;
  player: { male: Id; female: Id };
  /** The fly location blocks by explicit OBJ palette 5–9 (`blocks[p - 5]`); a block's cell is its shape. */
  blocks: Id[];
  /** The main matrix (its `zones` name the cells; null cells name `everywhere`). */
  matrix: Id;
  /** MAP_HEADER_EVERYWHERE, whose name a cell with no zone shows. */
  everywhere: Id;
  /** Cells off the main matrix that still show a name (decomp LoadMapName's notOnMainMatrix). */
  names: { x: number; z: number; zone: Id }[];
  /** The cells that show a name (tmap_block.dat); `hidden` bits (decomp enum HiddenLocation) must all be found. */
  cells: { x: number; z: number; hidden: number }[];
  /** The hidden locations in decomp enum HiddenLocation order: found while `var` holds `value`; `patch` is drawn at (x, y). */
  hidden: { var: Id; value: number; patch: Id; x: number; y: number }[];
  /** "Fly to where?" (TEXT_BANK_TOWN_MAP 0). */
  flyToWhere: Id;
  /**
   * The fly locations (decomp sFlyLocations, sTownMapFlyLocationUnlockFlags): selectable once `flag` is set. `palette`
   * is 0 (blue, towns) or 1 (red, cities); `sprite` the block's DS position less the grid offset; `cell`, for a location
   * whose zone spans more cells than it (Pal Park, Victory Road, the League), the one cell it is chosen on; `spawn` the
   * spawn id it lands at (`NewGame.flyDestinations`, decomp GetSpawnIdByMapAndCoords).
   */
  locations: { zone: Id; flag: Id; shape: number; palette: 0 | 1; sprite: [number, number]; cell?: [number, number]; spawn: number }[];
}

/** A move (decomp MoveTable). */
export interface Move extends MoveData {
  id: Id;
  sourceIndex?: number;
  name: string;
  type: Id;
  category: 'physical' | 'special' | 'status';
  power: number;
  /** 0 = never misses. */
  accuracy: number;
  priority: number;
  /** Battle effect (decomp `BATTLE_EFFECT_*`: `platinum:BATTLE_EFFECT_HIT`) and its chance in percent. */
  effect: Id;
  effectChance: number;
  /** Decomp `RANGE_*` without the prefix (`SINGLE_TARGET`, `ALL_ADJACENT`, …). */
  target: string;
  /** Decomp `MOVE_FLAG_*` without the prefix (`MAKES_CONTACT`, `CAN_PROTECT`, …). */
  flags: string[];
  contest: { effect: number; type: number };
  /** The summary's description text (0.12.0; decomp TEXT_BANK_MOVE_DESCRIPTIONS). */
  description: Id;
}

export interface Ability {
  id: Id;
  sourceIndex?: number;
  name: string;
  /** Description text (0.12.0; decomp TEXT_BANK_ABILITY_DESCRIPTIONS). */
  description: Id;
}

/** A type (`platinum:TYPE_FIRE`). The matchup chart is battle data. */
export interface PokemonType {
  id: Id;
  sourceIndex?: number;
  name: string;
  /**
   * This type attacking (decomp sTypeMatchupMultipliers rows with this attacking type, 0.14.0), in table
   * order: the defending type and the multiplier ×10 (0, 5 or 20). `foresight` rows come after the table's
   * Foresight separator (the Ghost immunities that Foresight and Scrappy drop).
   */
  matchups: { type: Id; multiplier: 0 | 5 | 20; foresight: boolean }[];
}

/** A nature; a Pokémon's is natures[pid % count] in `sourceIndex` order (core `Dex.nature`). */
export interface Nature extends NatureData {
  id: Id;
  sourceIndex?: number;
  name: string;
}

/** An experience curve (decomp pl_growtbl): total exp per level 0..100. */
export interface GrowthRate extends GrowthRateData {
  id: Id;
  sourceIndex?: number;
}

/**
 * An item (decomp ItemData). `pocket` names a `NewGame.pockets` entry. `holdEffect` is the decomp
 * `HOLD_EFFECT_*` name without the prefix, `holdParam` its parameter. `fieldUse`/`battleUse` are the
 * decomp use-function ids.
 */
export interface Item extends HeldItemData {
  id: Id;
  sourceIndex?: number;
  name: string;
  /** Plural name text (decomp TEXT_BANK_ITEM_NAMES_PLURAL; 0.11.0). */
  plural: Id;
  /** Description text (decomp TEXT_BANK_ITEM_DESCRIPTIONS; 0.11.0). */
  description: Id;
  /** The bag/mart icon: a 32×32 PNG, colour 0 transparent (decomp item_icon.narc; 0.11.0). */
  icon: AssetRef;
  pocket: string;
  price: number;
  pluckEffect: number;
  fling: { effect: number; power: number };
  /** Natural Gift power and type (berries). */
  naturalGift?: { power: number; type: Id };
  preventToss: boolean;
  canRegister: boolean;
  /** Battle bag pockets (decomp battlePocket bits). */
  battlePocket: number;
  fieldUse: number;
  battleUse: number;
  /** What using it on a party Pokémon does (decomp ItemPartyParam), when it has a party use. */
  partyUse?: ItemPartyUse;
  /** The move a TM/HM teaches. */
  tm?: Id;
}

/**
 * Decomp ItemPartyParam. `flags` are its set bits by field name (`healSleep`, `revive`, `ppUp`,
 * `giveHpEvs`, …); `stages` the stat stage raises; `evs` the signed EV changes; `hp`/`pp` the restored
 * amounts (decomp special values kept: 255 = all, 254 = half, 253 = a quarter); `friendship` the change at
 * low/medium/high friendship.
 */
export interface ItemPartyUse {
  flags: string[];
  stages: Partial<Record<'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed' | 'accuracy' | 'crit', number>>;
  evs: Partial<Record<StatName, number>>;
  hp: number;
  pp: number;
  friendship: [number, number, number];
}

/**
 * A shop's stock (decomp mart_items.h): items in order and the badge count each needs (the common mart
 * grows with badges; specialty marts list 0).
 */
export interface Mart {
  id: Id;
  sourceIndex?: number;
  items: { item: Id; minBadges: number }[];
}

/** A trainer's party member: core `TrainerMonData` (PID and OT id derived by the importer, as the DS does) and the ball seal. */
export interface TrainerMon extends TrainerMonData {
  /** Decomp cbSeal (ball capsule), kept raw. */
  ballSeal: number;
}

export interface Trainer {
  /** gVsSeekerRematchData: tiers including base, null = missing tier; ends before native END. */
  rematches?: (Id | null)[];
  id: Id;
  sourceIndex?: number;
  name: string;
  /** Trainer class id (decomp TRAINER_CLASS_*). */
  class: Id;
  /** The class gender (decomp sTrainerClassGender; 'none' for pairs). */
  gender: 'male' | 'female' | 'none';
  double: boolean;
  party: TrainerMon[];
  /** Items the trainer uses in battle (decomp header items). */
  items: Id[];
  /** Decomp AI flag mask. */
  ai: number;
  /** The class's prize multiplier (decomp sTrainerClassPrizeMul, 0.14.0): prize = last party level · 4 · this. */
  classPrize: number;
  /** The class name (a `texts` id, decomp TEXT_BANK_TRAINER_CLASS_NAMES, 0.14.0) for battle messages. */
  className: Id;
  /** Field messages by kind (decomp trainer text types, e.g. `before`, `defeat`, `after`). */
  messages: Record<string, Id>;
  /**
   * The eyes-meet music (0.18.0; a `sequences` id, decomp sTrainerEncounterBGMs by class, SEQ_EYE_KID
   * otherwise): `play_trainer_encounter_bgm` plays it. Absent in packs without sound.
   */
  encounterBgm?: Id;
}

/** Wild encounter slots for one zone. Slot order follows the decomp tables (land: 12 slots). */
export interface EncounterTable {
  id: Id;
  sourceIndex?: number;
  /** Encounter rate per step test, 0 = none. */
  landRate: number;
  land: EncounterSlot[];
  surfRate: number;
  surf: EncounterSlot[];
  oldRod: { rate: number; slots: EncounterSlot[] };
  goodRod: { rate: number; slots: EncounterSlot[] };
  superRod: { rate: number; slots: EncounterSlot[] };
  /** Replacement slots kept raw for later milestones (time of day, radar, swarms, dual-slot), by kind. */
  variants: Record<string, { slot: number; species: Id }[]>;
}

export interface EncounterSlot {
  species: Id;
  minLevel: number;
  maxLevel: number;
}

/** Tile behaviour (chunk tile bits 0–7 → `sourceIndex`), named after the decomp (e.g. `TALL_GRASS`, `JUMP_SOUTH`). The world keys off `name`. */
export interface TileBehavior {
  id: Id;
  sourceIndex: number;
  name: string;
  /** A press facing this behaviour runs `label` (decomp Field_TileBehaviorToScript), if the player faces `facing`. */
  interact?: { label: Id; facing: Facing | 'any' };
  /**
   * The field move this behaviour accepts when the player faces it (decomp FieldMoves_SetUsableMoves:
   * water → Surf, `WATERFALL` → Waterfall, rock-climb tiles → Rock Climb) and the `FIELD_MOVES` script it
   * starts. `move` is a move id (`platinum:MOVE_SURF`), as in `Pokemon.moves`.
   */
  fieldMove?: { move: Id; label: Id };
}

/**
 * Bitmap font: PNG atlas of glyph cells (cellWidth × cellHeight, left to right, top to bottom) in the
 * order of `chars`, with per-glyph advance widths. Colours: index by palette in the atlas (fg/shadow/bg).
 */
export interface Font {
  id: Id;
  atlas: AssetRef;
  cellWidth: number;
  cellHeight: number;
  chars: string;
  widths: number[];
}

/** How a new game starts (decomp StartNewSave + InitNewGame script). One record per base pack. */
export interface NewGame {
  /** SizeContest sUniformToNormalIntervals, imported from overlay 5. */
  sizeIntervals?: { base: number; divisor: number; start: number }[];
  id: Id;
  zone: Id;
  x: number;
  z: number;
  facing: Facing;
  money: number;
  /** Run with runImmediate before the first map load (decomp script 9600). */
  label?: Id;
  names: { player: string; rival: string };
  gender: 'male' | 'female';
  playerSprite: { male: Id; female: Id };
  /** The avatar while cycling and surfing (0.12.0; decomp PLAYER_AVATAR_CYCLING / _SURFING gfx). */
  playerCycleSprite: { male: Id; female: Id };
  playerSurfSprite: { male: Id; female: Id };
  /**
   * The platform lift props (0.12.0; decomp iron_island_platform_lift and pokemon_league_platform_lift):
   * the world moves them (`FieldView.platformLift`). Absent: a zone with a lift fails to load.
   */
  platformLiftProps?: { ironIsland: Id; pokemonLeague: Id };
  /**
   * The boat trips (0.27.11; decomp boat_cutscene.c): the Canalave ship prop (regular_ship) the departure moves,
   * the two bridge props (canalave_bridge_left/_right) whose one-shot `bridge` clips it plays, and for each
   * travel direction (BOAT_TRAVEL_DIR_*) the cinematic's length: the frame count of its first animation
   * (Canalave ship_demo members 0/15, Snowpoint ship_demo_pl members 7/3). The world draws these props
   * itself (`FieldView.props`). `scenes` adds the standalone ship/sea models and their once-only channels;
   * `snowpointShip` is the eastbound departure prop.
   */
  boat?: { ship: Id; bridges: [Id, Id]; cinematicFrames: number[]; snowpointShip?: Id; scenes?: import('./boat.ts').ShipScene[] };
  /** The player handing over or taking back Pokémon (decomp PLAYER_AVATAR_HEAL gfx; `pose-give`, `pose-receive`). */
  playerHealSprite?: { male: Id; female: Id };
  messageFont: Id;
  /** Started when a trainer spots the player (decomp script 3928, `Battles_ApproachingTrainer`). */
  trainerApproach?: Id;
  /** Billboard drawn over an actor whose `emote` is set (frame of `stand-down`); absent = the renderer's own '!'. */
  exclamationSprite?: Id;
  /**
   * Bag pockets in bag order (decomp bag.h): `Item.pocket` names one. `size` = distinct items it holds,
   * `max` = count per item, `sorted` = kept in item order (decomp Pocket_Sort: berries, TMs/HMs); others
   * keep the order items arrived in.
   */
  pockets: BagPocket[];
  /** The PC boxes' default names (texts, one per box; decomp PCBoxes_Init). Their number is the box count. */
  boxNames: Id[];
  /** The ball of gift and trainer Pokémon (decomp ITEM_POKE_BALL). */
  pokeBall: Id;
  /** The mart's bonus for 10 or more `pokeBall` bought at once (decomp ITEM_PREMIER_BALL; 0.11.0). Absent: no bonus. */
  premierBall?: Id;
  /**
   * The Pokémon Center healing machine (0.11.0): the machine prop the balls sit on and the ball prop
   * (decomp pokecenter_healing_machine, pokecenter_healing_machine_mini_pokeball). Absent: the machine
   * is timed only (logged). 0.27.19: `hallOfFame`, the Hall of Fame machine the same balls sit on (decomp
   * pokemon_league_hall_of_fame_machine, PlayHallOfFameHealingAnimation). 0.34.1: `screen`, the machine's
   * screen (decomp pokecenter_healing_machine_tv); its `flash` one-shot plays with the balls' at the heal jingle.
   */
  healMachine?: { machine: Id; ball: Id; hallOfFame?: Id; screen?: Id };
  /** Credits roadside models and overlay-99 placement tables, in original FX32 units. */
  creditsRide?: {
    models: Id[];
    rows: { count: number; speed: number; start: [number, number, number]; spacing: [number, number, number] }[][];
    nightTrees: number[];
  };
  /**
   * 0.27.19. The end credits’ staff rows (decomp sEndCreditStringProps, overlay data): each row's text
   * (`TEXT_BANK_END_CREDITS`), its y on the scroll (DS px from the first row) and whether it is centred
   * (else at x 32). The last row is the final screen's. Absent: no credits (the clear goes straight to the reset).
   */
  credits?: { text: Id; y: number; centered: boolean }[];
  /** 0.16.0: the Pokédex area map; absent = every area page says the area is unknown. */
  pokedexMap?: PokedexMap;
  /** 0.29.0: the Town Map's fly mode; absent = Fly is not available (the party menu logs it). */
  townMap?: TownMap;
  /**
   * 0.29.0: where Fly and Teleport land, by spawn id − 1 (decomp sSpawnLocations' fly map and position, Location_InitFly,
   * facing down). Teleport lands at the blackout spawn's (`Zone.blackOut.spawn`). Absent: neither move is available.
   */
  flyDestinations?: { zone: Id; x: number; z: number }[];
  /** 0.16.0: what a seen-only entry shows (decomp: species 0's category, height and weight texts). */
  pokedexUnknown?: { category: Id; height: Id; weight: Id };
  /** Started when the Repel steps run out (0.12.0; decomp common script 32, CommonScript_RepelsEffectWoreOff). */
  repelWoreOff: Id;
  /** Started when a party egg hatches on a step (0.19.0; decomp common script 31, CommonScript_HatchEgg, from Field_UpdateDaycare). */
  hatchEgg: Id;
  /**
   * 0.20.0: each ribbon's name and description texts, indexed by ribbon id (decomp enum Ribbon,
   * `Pokemon.ribbons`); ribbon i is cell i of the `ui2d/summary/ribbons` sheet. Absent = no ribbons.
   */
  ribbons?: { name: Id; description: Id }[];
  /**
   * The game records' tables (decomp game_records.c, read from arm9): `scoreIncrements[e]` is the
   * trainer score of TRAINER_SCORE_EVENT_* `e` (sTrainerScoreIncrements); `highLimit[id]` says record
   * RECORD_* `id` caps at the high limit (sUsesHighLimit; GAME_RECORD_LIMITS).
   */
  gameRecords: { scoreIncrements: number[]; highLimit: boolean[] };
  /**
   * The gym puzzles' tables (0.27.0; decomp overlay 8 gym_features.c, read from the ROM; `gyms.ts`). Absent: a
   * zone whose onTransition selects a gym feature fails to load.
   */
  gyms?: GymTables;
  spearPillar?: import('./story-scenes.ts').SpearPillarAssets;
  containment?: { prop: Id; loopFrames: number; openingFrames: number };
  /** The Distortion World's shared overlay 9 tables (0.27.18; `distortion.ts`). Absent: no Distortion World. */
  distortionWorld?: DistortionWorldTables;
  /** 0.29.0. The berry patches' tables (decomp berry_patches.c). Absent: berry soil is inert (logged). */
  berries?: BerryTables;
  /** 0.29.0. The shard move tutors (decomp scrcmd_move_tutor.c sTeachableMoves). Absent: the tutors teach nothing (logged). */
  moveTutors?: MoveTutorTables;
  /** 0.29.0. The in-game trades by NPC trade id (decomp NPCTradeID, fld_trade.narc and TEXT_BANK_NPC_TRADE_NAMES). */
  npcTrades?: NpcTrade[];
  /** 0.29.1. The Great Marsh and its Safari Game (`GreatMarshTables`). Absent: no Safari Game. */
  greatMarsh?: GreatMarshTables;
  /** 0.31.0. The special encounters (`SpecialEncounterTables`). Absent: no honey trees, swarms, Trophy Garden or Poké Radar. */
  specialEncounters?: SpecialEncounterTables;
  /** 0.31.0. Amity Square's finds and gifts (`AmitySquareTables`). Absent: the square's ops fail loudly. */
  amitySquare?: AmitySquareTables;
  /**
   * 0.31.0. FLAG_CONTEST_HALL_VISITED (decomp PokemonSummaryScreen_ShowContestData): the summary shows its CONDITION
   * page once it is set. Absent: never.
   */
  contestHallFlag?: Id;
  /** 0.34.0. The Battle Frontier (`FrontierTables`): its scenes, trainers, sets and the Battle Tower's tables. Absent: no frontier. */
  frontier?: FrontierTables;
  /** 0.33.0. The Underground's tables (`UndergroundTables`). Absent: no Underground (the Explorer Kit cannot be used; its ops fail loudly). */
  underground?: import('./underground.ts').UndergroundTables;
  /** 0.35.0. The Super Contests' tables (`ContestTables`). Absent: the contest ops fail loudly. */
  contests?: import('./contests.ts').ContestTables;
}

/**
 * 0.31.0. Amity Square (decomp scrcmd_amity_square.c, system_vars.c): `stepVar` the step counter the field counts up
 * on every step (VAR_AMITY_SQUARE_STEP_COUNT, at most 10000); `finds` the accessories a walking Pokémon finds
 * (sMonFindableAccessories: ten per pool, rolled 15/15/15/15/10/10/8/5/5/2 in 100) with the species of each pool
 * (CalcAmitySquareFoundAccessory's switch; any other species takes pool 0); `gifts` the man's daily gift options
 * (sBerryAndAccessoryManOptions: item ids, then from index `itemGifts` on, accessory ids).
 */
export interface AmitySquareTables {
  stepVar: Id;
  finds: { species: Id[]; accessories: number[] }[];
  gifts: number[];
  itemGifts: number;
}

/**
 * 0.29.1. The Great Marsh's tables (decomp great_marsh_daily_encounters.c, great_marsh_binoculars.c,
 * great_marsh_tram.c, scripts_safari_game.s), read from the player's ROM.
 */
/**
 * 0.31.0. The special encounters' tables (decomp overlay005/honey_tree.c, overlay006/swarm.c,
 * trophy_garden_daily_encounters.c, pokeradar.c, ov5_021F007C.c):
 * - `honeyTrees`: the 21 trees' zones in tree-id order (sHoneyTreeMapHeaderIDs), the honey tree prop (honey_tree.nsbmd;
 *   its `animations` `shake-0`..`shake-2` are the shaking clips), the three encounter tables (encdata_ex 2, 3, 4: six
 *   species each, groups A, B and C) and the script A starts facing a tree from below (CommonScript_HoneyTree).
 * - `swarms`: the 22 swarm zones in swarm-id order (sSwarmMapIdTable); a zone's species are its encounter table's
 *   `variants.swarm`.
 * - `trophyGarden`: the garden's zone (MapHeader_IsTrophyGarden) and its 16 species (encdata_ex 8), which its land
 *   slots 6 and 7 take once the National Pokédex is obtained.
 * - `pokeRadar`: the Poké Radar's scripts (POKE_RADAR 0: the battery is low, VAR_0x8000 the steps left; 1: no patch),
 *   its BGM (SEQ_KUSAGASA) and the patch field effects (soft, hard, shiny).
 * - `sweetScent`: Sweet Scent's and Honey's scripts (COMMON_SCRIPTS 28: the scent faded; 29: nothing happened here)
 *   and its sound (SEQ_SE_DP_FW230).
 */
export interface SpecialEncounterTables {
  honeyTrees: { zones: Id[]; prop: Id; tables: Id[][]; label: Id };
  swarms: Id[];
  trophyGarden: { zone: Id; species: Id[] };
  pokeRadar: { labels: { noCharge: Id; quiet: Id }; bgm: Id; effects: { soft: Id; hard: Id; shiny: Id } };
  sweetScent: { labels: { faded: Id; nothing: Id }; sound: Id };
}

export interface GreatMarshTables {
  /** MAP_HEADER_GREAT_MARSH_1..6: the area numbers 0–5 (GreatMarsh_GetAreaNumFromMapId). */
  zones: Id[];
  /** FLAG_SAFARI_GAME_ACTIVE (SystemFlag_*SafariGameActive). */
  flag: Id;
  /**
   * encdata_ex members 10 (before the National Pokédex) and 9 (after): 32 species each. Each area's land slots 6
   * and 7 take entry `(marshDaily >> 5·area) & 31` (ReplaceGreatMarshDailyEncounters).
   */
  daily: { regional: Id[]; national: Id[] };
  /** encdata_ex member 11: the binoculars' 36 spots, Great Marsh matrix tiles (GreatMarshBinoculars_InitData). */
  lookout: { x: number; z: number }[];
  /** The SAFARI_GAME scripts the field starts by id: 1 out of steps, 2 out of balls, 9 out of balls in battle, 21 retire, 22 no room. */
  labels: { outOfSteps: Id; outOfBalls: Id; outOfBallsBattle: Id; retire: Id; noRoom: Id };
  /** The quick tram's prop (great_marsh_train); absent when the import did not convert it. */
  tram?: Id;
}

/**
 * 0.29.0. The berry patches (decomp berry_patches.c, berry_patch_graphics.c): each berry's growth data (nuts_data:
 * stage hours, moisture drained per hour, base yield) and its tree sprites (OBJ_EVENT_GRAPHICS_<BERRY>_GROWING,
 * _BLOOMING, _FRUIT); the new game's patches (sBerryInitTable: the berry in fruit and its yield, per patch id); the
 * mulch items in MulchType order (Growth, Damp, Stable, Gooey); the soil object's sprite (OBJ_EVENT_GFX_BERRY_SOIL,
 * which marks a patch), the sprout (OBJ_EVENT_GFX_BERRY_SPROUT) and the soil's moisture field effects by
 * BerryPatches_GetPatchMoisture (very dry, dry, moist: fldeff members 77, 76, 75); the player's watering avatar
 * (OBJ_EVENT_GFX_PLAYER_M/F_SPRAYDUCK, PLAYER_TRANSITION_WATER_BERRIES).
 */
export interface BerryTables {
  /**
   * 0.31.0: `flavors` (spicy, dry, sweet, bitter, sour) and `smoothness` (decomp BerryData, BERRYATTR_SPICINESS …
   * BERRYATTR_SMOOTHNESS): what a berry gives a Poffin.
   */
  berries: { item: Id; stageHours: number; drain: number; baseYield: number; sprites: { growing: Id; blooming: Id; fruit: Id }; flavors: [number, number, number, number, number]; smoothness: number }[];
  patches: { item: Id; yield: number }[];
  mulches: [Id, Id, Id, Id];
  soil: Id;
  sprout: Id;
  moisture: [Id, Id, Id];
  sprayduck: { male: Id; female: Id };
  /**
   * 0.31.0. The Pokétch Berry Searcher's spot of each patch (decomp sBerryPositions, by patch id): a main-matrix chunk
   * (PoketchMap_GetPositionOnMap). Absent in packs without the Pokétch's berry map.
   */
  searcher?: { x: number; y: number }[];
}

/**
 * 0.29.0. The shard move tutors (decomp sTeachableMoves): each move's shard costs and its tutor location (decomp
 * enum TutorLocation: 0 Route 212, 1 Survival Area, 2 Snowpoint City); which species learn which is
 * `SpeciesStats.tutorMoves`. `shards`: the Red, Blue, Yellow and Green Shard items.
 */
export interface MoveTutorTables {
  shards: [Id, Id, Id, Id];
  moves: { move: Id; cost: [number, number, number, number]; location: number }[];
}

/**
 * 0.29.0. One in-game trade (decomp NPCTradeMon and NPCTrade_CreateMon): the Pokémon given (`species`, fixed PID,
 * OT id, IVs, held item, language), its nickname and OT name and gender (TEXT_BANK_NPC_TRADE_NAMES n and
 * MAX_NPC_TRADES + n), and the species asked for. Its level is the traded Pokémon's. 0.31.0: `condition`, the
 * contest condition it comes with (NPCTradeMon cool … tough; its sheen is 0).
 */
export interface NpcTrade {
  species: Id;
  requested: Id;
  pid: number;
  otId: number;
  otName: string;
  otGender: 'male' | 'female';
  nickname: string;
  ivs: import('@opensinnoh/core').Stats;
  heldItem: Id | null;
  language: number;
  condition: Omit<import('@opensinnoh/core').Condition, 'sheen'>;
}

/**
 * The title screen (decomp title_screen.c): the hovering 3D model and the 3D scene behind it, filling one
 * view. The app draws its own wordmark and prompt over them and runs the screen (timings are the
 * engine's). One record per base pack; absent = the app has no title screen for these packs.
 */
export interface TitleScreen {
  id: Id;
  /** The hovering 3D model; absent = no 3D. */
  model?: TitleModel;
  /** A 3D scene drawn behind the model with its own camera, filling the frame (Platinum: the intro's portal). */
  background?: TitleModel;
}

export interface TitleModel {
  /** A `models` record (glTF). */
  model: Id;
  /** glTF clip looped while shown. */
  clip?: string;
  /**
   * Texture scrolls by glTF material name, one value per frame (as the `scroll` TextureAnimation). Kept
   * here, not in `textureAnimations`, which the field renderer applies by material name to every model.
   */
  scroll?: { material: string; frames: number; translateS: number[] | number; translateT: number[] | number }[];
  /** Perspective camera in world units. */
  camera: { position: [number, number, number]; target: [number, number, number]; fovY: number; near: number; far: number };
  /** DS lights (world-space directions, 0..1 colours), up to 4. */
  lights: { direction: [number, number, number]; color: [number, number, number] }[];
}

/**
 * A 2D sheet (decomp NCGR + NCER + NANR, or a BG screen): one PNG atlas in DS pixels, colour 0
 * transparent, cut into cells. A cell is drawn with its origin (the DS sprite position) at the
 * sprite's position: the rect's top-left goes to `position − (ox, oy)`. Ids are
 * `platinum:ui2d/<decomp resource path>` (e.g. `platinum:ui2d/battle/healthbox/player_singles`).
 */
export interface Ui2dSheet {
  id: Id;
  atlas: AssetRef;
  /** In NCER order (a BG image is one cell with origin 0, 0). */
  cells: Ui2dCell[];
  /** Cell names where the decomp names them (parallel to `cells`), e.g. the healthbox parts. */
  names?: string[];
  /** Cell animations in NANR sequence order. */
  animations?: Ui2dAnimation[];
  /**
   * Window frames: insets in px of a nine-slice drawn from cell 0 (left, top, right, bottom). The
   * centre is the window's fill, the edges repeat.
   */
  nineSlice?: [number, number, number, number];
  /** Text drawn on the cells: foreground and shadow colours (`#rrggbb`) from the cell's palette, parallel to `cells`. */
  textColors?: { fg: string; shadow: string }[];
  /** 0.21.1. Particle emitters whose textures are the cells (a SPA file's, `Ui2dEmitter`). */
  emitters?: Ui2dEmitter[];
}

/**
 * 0.21.1. A particle emitter (Nitro SPL SPLResourceHeader and its animation blocks; decomp lib/spl), the
 * parts a simple particle system needs. Lengths are world units (fx32 / 4096), times DS frames (one per 30 Hz tick: the SPL managers update once per main loop),
 * colours `#rrggbb`, alpha 0–31. `emission` is SPLEmissionType (0 point, 1 sphere surface, 2 circle border,
 * 3 uniform circle border, 4 sphere, 5 circle), `circleAxis` SPLCircleAxis (0 z, 1 y, 2 x, 3 `axis`).
 * `air` is the velocity kept per frame (airResistance + 0.09375, of 512). `life` 0 = until stopped.
 * `children`: a child particle per parent at `childEvery` frames from `childDelay` (fraction of the parent's
 * life, of 256), living `life` frames, shrinking to `endScale` and fading out (SPLChildResource).
 */
export interface Ui2dEmitter {
  emission: number;
  /**
   * SPLDrawType: 0 billboard (rotation not modelled), 1 directional billboard (the quad's length lies along
   * the velocity on screen, stretched by 1 + (1 − |v̂·view|) · `dbbScale`); `aspect` is its width over its
   * height; `scaleAnimDir` (SPLScaleAnimDir) 0 both, 1 width, 2 height.
   */
  drawType: number;
  aspect: number;
  dbbScale: number;
  scaleAnimDir: number;
  circleAxis: number;
  axis: [number, number, number];
  position: [number, number, number];
  count: number;
  radius: number;
  velPos: number;
  velAxis: number;
  scale: number;
  color: string;
  alpha: number;
  startDelay: number;
  life: number;
  particleLife: number;
  interval: number;
  air: number;
  texture: number;
  hideParent: boolean;
  scaleAnim?: { start: number; mid: number; end: number; in: number; out: number };
  colorAnim?: { start: string; end: string; in: number; peak: number; out: number; interpolate: boolean };
  alphaAnim?: { start: number; mid: number; end: number; in: number; out: number };
  child?: { life: number; texture: number; color: string | null; scaleRatio: number; velocityRatio: number; endScale: number | null; fade: boolean; count: number; delay: number; every: number };
}

export interface Ui2dCell {
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

/**
 * NNS cell animation: `forward` plays once and holds the last frame; `loop` repeats from `loopStart`;
 * `pingpong` plays forward then back once; `pingpong-loop` repeats that.
 */
export interface Ui2dAnimation {
  mode: 'forward' | 'loop' | 'pingpong' | 'pingpong-loop';
  loopStart: number;
  frames: Ui2dFrame[];
}

/** One frame: a cell for `ticks` 30 Hz ticks, optionally moved (px), scaled and rotated (turns, 0–1) about its origin. */
export interface Ui2dFrame {
  cell: number;
  ticks: number;
  dx?: number;
  dy?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
}

/**
 * A species' battle and menu pictures (decomp pl_pokegra / pl_otherpoke / pl_poke_icon / pl_poke_data),
 * keyed by species id (`platinum:SPECIES_STARLY`). The DS draws battle sprites as 80×80 frames.
 */
export interface PokemonSprites {
  id: Id;
  sourceIndex?: number;
  /** By form number (decomp MON_DATA_FORM); one entry for species without forms. */
  forms: PokemonSpriteForm[];
  /** Frame tables and animation ids of each face (decomp SpeciesSpriteData; forms share them). */
  front: PokemonSpriteAnim;
  back: PokemonSpriteAnim;
  /** How high the front sprite floats over its shadow in px (SpeciesSpriteData.yOffset, MON_SPRITE_SHADOW_HEIGHT). */
  yOffset: number;
  /** The battle shadow: x offset in px and size (0 none, 1 small, 2 medium, 3 large). */
  shadow: { x: number; size: number };
}

export interface PokemonSpriteForm {
  /** Decomp form name where it has one (`attack`, `origin`, `heat`); absent for form 0 of most species. */
  name?: string;
  /** 160 px wide; each face is a row of two 80×80 frames at x 0 and 80. */
  atlas: AssetRef;
  /** The same layout in the shiny palette. */
  shinyAtlas: AssetRef;
  front: PokemonFace;
  back: PokemonFace;
  /** Female pictures, where they differ. */
  frontFemale?: PokemonFace;
  backFemale?: PokemonFace;
  /** Party/box icon: 32×64, two 32×32 frames (top first) that alternate. */
  icon: AssetRef;
}

/**
 * A face's row in the atlas and its y offset in px (decomp height.narc). The DS centres the 80×80 frame
 * at (x, y + yOffset) of the battler position (singles: player 64, 112; enemy 192, 50).
 */
export interface PokemonFace {
  y: number;
  yOffset: number;
  /**
   * 0.35.1. Front faces only: the first frame's opaque pixels, as base64 of 80 rows, each a run count n then n
   * pairs of u8 (first x, end x exclusive). The visual round's tests against the Pokémon's pixels read it
   * (decomp ov22_022592F0).
   */
  opaque?: string;
}

/** Decomp SpeciesSpriteAnim: frames (picture 0/1, ticks, x/y shift), the transform animation id (pl_poke_anm) and delays in ticks. */
export interface PokemonSpriteAnim {
  frames: { frame: number; ticks: number; dx: number; dy: number }[];
  animation: number;
  startDelay: number;
  cryDelay: number;
}

/**
 * A trainer class's battle sprites (decomp trfgra/trbgra), keyed by class id
 * (`platinum:TRAINER_CLASS_PLAYER_MALE`). Both are `ui2d` sheets drawn at the sprite position; a back
 * sprite's animation 1 is the throw (5 pictures, 9 frames), animation 0 the still pose.
 */
export interface TrainerSprite {
  id: Id;
  sourceIndex?: number;
  front: Id;
  back?: Id;
}

/**
 * A battle background (decomp BACKGROUND_*, pl_batt_bg): the 512×256 BG3 map per time of day. At rest
 * the DS shows x 0–255, y 0–191; trainer intros scroll it from x −132 by +4 a frame. Transparent pixels
 * are the backdrop (filled with palette colour 0). Backgrounds without time palettes repeat the day image.
 */
export interface BattleBackground {
  id: Id;
  sourceIndex?: number;
  day: AssetRef;
  twilight: AssetRef;
  night: AssetRef;
}

/** A battle terrain (decomp TERRAIN_*): the player and enemy platforms (OAM sprites under the battlers). */
export interface BattleTerrain {
  id: Id;
  sourceIndex?: number;
  player: BattlePlatform;
  enemy: BattlePlatform;
}

/** One platform: a `ui2d` sheet per time of day, its resting DS position and where its slide-in starts. */
export interface BattlePlatform {
  day: Id;
  twilight: Id;
  night: Id;
  x: number;
  y: number;
  start: [number, number];
}

/**
 * The trainer AI bytecode (decomp `gTrainerAITable`, overlay trainer_ai), run by the battle package's
 * interpreter. One record per game (`platinum:TRAINER_AI`).
 *
 * `code` is the script as signed 32-bit words: an opcode (decomp `AICMD_*` order) and its operands;
 * jumps are word offsets relative to the end of the operand that holds them, table operands relative to
 * the end of the instruction's operands (decomp `aicmd.inc`). Operands are decomp numbers (move, ability,
 * type, item and `BATTLE_EFFECT_*` ids, condition masks); `battleEffects` and `holdEffects` give the decomp
 * order of the two enums records name by string.
 */
export interface AiScript {
  id: Id;
  code: number[];
  /** Entry word per AI flag, in bit order (bit i of `Trainer.ai` = `flags[i]`), named by decomp `AI_FLAG_*` name. */
  flags: { name: string; entry: number }[];
  /** trainer_ai.c sNoDamageCalcMoveEffects and sAltPowerMoveEffects (`BATTLE_EFFECT_*` values). */
  noDamageCalcEffects: number[];
  altPowerEffects: number[];
  /** sWeightToPower rows for Low Kick and Grass Knot: [weight limit in 0.1 kg, power]. */
  weightToPower: [number, number][];
  /** `Move.effect` ids by decomp value. */
  battleEffects: Id[];
  /** `Item.holdEffect` names by decomp value. */
  holdEffects: string[];
}

/**
 * A battle animation script (0.19.0; docs/research/move-animations.md): a move's animation (decomp
 * `wazaeffect/we.arc` member = the move's number; member 0 is `none`) or a common animation (`we_sub.narc`,
 * decomp BATTLE_ANIMATION_* order: `sleep`, `poison`, …, `stat_boost`, …). `code` is the script as signed
 * 32-bit words: an opcode (decomp `BTLANIMCMD_*` order) and its operands; jumps are word offsets from the
 * operand that holds them (decomp btlanimcmd.inc). Particle systems are `particleSystems` by `sourceIndex`.
 */
export interface BattleAnimation {
  id: Id;
  /** The move it plays for (absent for member 0 and the common animations). */
  move?: Id;
  /** The common animation's name (decomp `res/battle/scripts/common_anims` file name). */
  common?: string;
  /** The archive member. */
  sourceIndex: number;
  code: number[];
}

/**
 * A particle system file (0.19.0; decomp `wazaeffect/effectdata/waza_particle.narc`, Nitro SPL "SPA"): its
 * emitter resources and its textures (a `ui2d` sheet, cell n = texture n). Values are the file's: fx32 and
 * fx16 stay raw (×4096), angles are 65536ths of a turn, colours BGR555, rates 0–255 of a life.
 */
export interface ParticleSystem {
  id: Id;
  /** The `waza_particle.narc` member (scripts' LoadParticleSystem operand). */
  sourceIndex: number;
  textures: Id;
  /** Per texture: the SPL texture's repeat and flip bits (param bits 12–15) and whether colour 0 is transparent. */
  textureParams: number[];
  emitters: ParticleEmitter[];
}

/** One SPL emitter resource (decomp lib/spl SPLResourceHeader and its optional blocks). */
export interface ParticleEmitter {
  /** SPLResourceFlags: emission type (bits 0–3), draw type (4–5), circle axis (6–7), the anim/behaviour bits. */
  flags: number;
  basePos: [number, number, number];
  count: number;
  radius: number;
  length: number;
  axis: [number, number, number];
  color: number;
  velPos: number;
  velAxis: number;
  scale: number;
  aspect: number;
  startDelay: number;
  minRotation: number;
  maxRotation: number;
  initAngle: number;
  emitterLife: number;
  particleLife: number;
  /** randomAttenuation: base scale, life, initial velocity (0–255). */
  attenuation: [number, number, number];
  interval: number;
  alpha: number;
  air: number;
  texture: number;
  loopFrames: number;
  dbbScale: number;
  /** misc bits 0–9 of the second word: tile S, tile T (2 bits each), scale direction (3), face emitter, flip S, flip T. */
  tileS: number;
  tileT: number;
  scaleDir: number;
  faceEmitter: boolean;
  flipS: boolean;
  flipT: boolean;
  polygonX: number;
  polygonY: number;
  scaleAnim?: { start: number; mid: number; end: number; in: number; out: number; loop: boolean };
  colorAnim?: { start: number; end: number; in: number; peak: number; out: number; randomStart: boolean; loop: boolean; interpolate: boolean };
  alphaAnim?: { start: number; mid: number; end: number; in: number; out: number; random: number; loop: boolean };
  texAnim?: { textures: number[]; step: number; randomStart: boolean; loop: boolean };
  child?: {
    flags: number;
    randomVel: number;
    endScale: number;
    life: number;
    velRatio: number;
    scaleRatio: number;
    color: number;
    count: number;
    delay: number;
    interval: number;
    texture: number;
    tileS: number;
    tileT: number;
    flipS: boolean;
    flipT: boolean;
    faceEmitter: boolean;
  };
  gravity?: [number, number, number];
  random?: { magnitude: [number, number, number]; interval: number };
  magnet?: { target: [number, number, number]; force: number };
  spin?: { angle: number; axis: number };
  collision?: { y: number; elasticity: number; type: number };
  convergence?: { target: [number, number, number]; force: number };
}

/**
 * The battle animation tables the VM reads (0.19.0, one record; overlay 12 rodata, checked by SHA-1 at import):
 * battler world positions for particles and the generic emitter callback's axes. fx32 values stay raw.
 */
export interface BattleAnimData {
  id: Id;
  /**
   * BattleAnimUtil_GetBattlerTypeWorldPosInternal: [battler type (6 + 2 contest)][position type (12)][projection
   * (0 perspective, 1 orthographic)] → [x, y, z].
   */
  positions: [number, number, number][][][];
  /** EmitterAxisConfigs1–8: [config][from battler type][to battler type] → [x, y, z]. */
  axes: [number, number, number][][][];
  /** The switched backgrounds (SwitchBg's 0–57): `ui2d` sheets, cell 0 as drawn for the player's side, cell 1 mirrored, cell 2 (0.36.1) a contest's screen. */
  backgrounds: Id[];
  /** The stat change patterns (StatChangeUp, Down, Heal, Metal: sStatChangeNarcMemberTable): `ui2d` sheets. */
  statChange: Id[];
}

export interface RegistryTypes {
  zones: Zone;
  matrices: Matrix;
  chunks: Chunk;
  areas: Area;
  lights: Light;
  weathers: Weather;
  fieldEffects: FieldEffect;
  encounters: EncounterTable;
  tileBehaviors: TileBehavior;
  props: Prop;
  models: Model;
  textureAnimations: TextureAnimation;
  cameras: Camera;
  sprites: Sprite;
  followers: FollowerSprite;
  followerTalk: FollowerTalk;
  movements: Movement;
  texts: Text;
  textBanks: TextBank;
  flags: Flag;
  vars: Var;
  species: Species;
  moves: Move;
  abilities: Ability;
  types: PokemonType;
  natures: Nature;
  growthRates: GrowthRate;
  items: Item;
  marts: Mart;
  trainers: Trainer;
  fonts: Font;
  newGame: NewGame;
  titleScreens: TitleScreen;
  ui2d: Ui2dSheet;
  pokemonSprites: PokemonSprites;
  trainerSprites: TrainerSprite;
  battleBackgrounds: BattleBackground;
  battleTerrains: BattleTerrain;
  aiScripts: AiScript;
  battleAnimations: BattleAnimation;
  particleSystems: ParticleSystem;
  battleAnimData: BattleAnimData;
  sequences: Sequence;
  soundBanks: SoundBank;
  waveArchives: WaveArchive;
  soundPlayers: SoundPlayer;
  cries: Cry;
  distortionRooms: DistortionRoom;
}
