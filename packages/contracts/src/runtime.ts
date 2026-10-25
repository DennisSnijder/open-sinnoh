/**
 * Constructors the game composition (packages/game) and app use to wire the packages together
 * (contracts v0.4). The app is a composition root and may import packages/game directly. Implementations: packages/world and packages/render, packages/vm, packages/text.
 */
import type { ClockTime, DayPeriod, Id } from '@opensinnoh/core';
import type { AudioHost } from './audio.ts';
import type { BattleResult, BattleSetup } from './battle.ts';
import type { BattleLogEntry } from './bridge.ts';
import type { FieldHost, ScriptRunner, ScriptView } from './field.ts';
import type { RegistryTypes, AssetRef, Facing } from './records.ts';
import type { GameState } from './state.ts';
import type { FeaturesView } from './gyms.ts';
import type { InputFrame } from './ui.ts';

/** Assembled registries after pack loading, typed. */
export type Registries = { [K in keyof RegistryTypes]: ReadonlyMap<Id, RegistryTypes[K]> };

/** Script labels after pack loading (IR only in v0.1). */
export type Labels = ReadonlyMap<Id, { pack: string; commands: import('@opensinnoh/core').Command[] }>;

/** Reads pack files (glTF, PNG) by AssetRef. */
export interface AssetSource {
  get(ref: AssetRef): Promise<Blob>;
}

/** Logs unimplemented commands/behaviour once per key and counts them (coverage). */
export interface StubLog {
  stub(key: string, detail?: string): void;
}

export type Vec3 = [number, number, number];

/** What the renderer draws of one character. Positions are world units; `prev` is the previous tick. */
export interface ActorView {
  localId: number;
  sprite: Id;
  cur: Vec3;
  prev: Vec3;
  facing: import('./records.ts').Facing;
  anim: 'stand' | 'walk' | 'run';
  /** The frame in the DS's 16-frame walk/run loop (0–15; world `sprite-anim.ts`); for a `pose`, ticks since its start. */
  animTick: number;
  visible: boolean;
  emote: boolean;
  /** 0.41.0. The emote is the '!!' (`NewGame.doubleExclamationSprite`). */
  emoteDouble?: true;
  /** One-shot pose (sprite animation `pose-<pose>[-<facing>]`), with `animTick` counting from its start. */
  pose?: string;
  /**
   * World units the sprite is drawn below `cur` (0.12.0; decomp MapObject_SetSpriteTerrainOffset, set when a
   * step ends and on spawn: mud 12, deep mud 14, deep snow 12, deeper snow 14, deepest snow 16). Absent = 0.
   */
  sink?: number;
  /**
   * The zone that lists this object as its own (0.17.1): its `ObjectState.zone`, or for a clone the zone
   * it copies (`ObjectEvent.cloneOf`). With `localId` and `sprite` it names one object across zone
   * connections, so the renderer can match a departed or preview object to the live one. Absent for the
   * player. A clone with `cloneLocalId` exposes that source id as `ActorView.localId`.
   */
  home?: Id;
  /**
   * The sprite's roll in degrees (0.27.28; decomp DistWorldMapObjectRotator bound to an object: the Distortion
   * World's turned objects). Absent = 0. The player's roll is `DistortionView.roll`.
   */
  roll?: number;
  /** Black palette blend, 0–16, rounded in RGB555 (Giratina's field arrival). */
  paletteDarkness?: number;
  /**
   * 0.32.1. HGSS's emote bubble over the following Pokémon while it talks (World.followerBubble): frame `frame` of the
   * billboard `sprite`, `rise` world units above its resting place (EmoteBubbleEffect: up and back down as it appears).
   */
  bubble?: { sprite: Id; frame: number; rise: number };
}

/** A door prop animating (or held open) at a tile, as passed to `FieldHost.playDoor`. */
export interface DoorView {
  x: number;
  z: number;
  /** A door's `open`/`close`, or a PC's `pc-on`/`pc-off` (the PC prop at x,z boots up or shuts down). */
  anim: 'open' | 'close' | 'pc-on' | 'pc-off';
  /** Ticks since the animation started; the renderer clamps to the clip end. */
  tick: number;
}

/**
 * One field effect instance (decomp FIELD_EFFECT_RENDERER_*). `key` is stable while it lives, so the
 * renderer can keep its object; `anim` names the effect's animation by use, `tick` counts from its start.
 */
export interface EffectView {
  key: number;
  effect: Id;
  cur: Vec3;
  prev: Vec3;
  anim?: string;
  tick: number;
  facing?: import('./records.ts').Facing;
  /** Fully resolved model pose; bypasses the ordinary effect offsets and facing. Degrees, X then Y then Z. */
  rotation?: Vec3;
  /** 0.37.0. A uniform scale (ov5_DrawFloorTexture's size: the Underground's floor marks and holes); absent = 1. */
  scale?: number;
}

/**
 * 0.29.0. Fly's cut-in and landing (decomp overlay006/hm_cut_in.c), and since 0.43.0 every other field move's HM cut-in
 * (sCutInTaskFuncs: no bird), 2D over the field in a 256×192 DS frame centred on
 * the view (the player at its centre), positions in DS px (sprite centres). `band` is the cut-in's window
 * (G2_SetWnd0Position: x1 ≤ x < x2, y1 ≤ y < y2; a band reaching x 0 and 255 spans the view): inside it the field is
 * hidden under `ui2d/field_cutin/pattern` while `pattern`, its rows aligned with the DS frame and repeating across. The
 * sprites (`ui2d/field_cutin/*`): the wind (animation `anim`; the pattern repeats every 256 px across the band), the
 * Pokémon's front picture (80×80), the player (`player_<gender>` animation `anim`, `tick` ticks in), the bird; each
 * scaled about its centre by `scale` and turned by `rotation` degrees. The world's fade covers these too.
 */
export interface FlySceneView {
  gender: 'male' | 'female';
  band: { x1: number; y1: number; x2: number; y2: number; pattern: boolean } | null;
  wind: { x: number; y: number; anim: number }[];
  mon: { species: Id; form: number; shiny: boolean; female: boolean; x: number; y: number } | null;
  player: { x: number; y: number; scale: number; rotation: number; anim: number; tick: number } | null;
  bird: { x: number; y: number; scale: number; rotation: number } | null;
}

export interface FieldView {
  /** 0.29.0. Fly's cut-in or landing while it runs (`World.fly`); 0.43.0 an HM cut-in too. */
  fly?: FlySceneView;
  /** 0.29.0. Added to the camera's distance (world units) while Fly or Teleport zooms (decomp ov5_021F0EB0). */
  cameraDistance?: number;
  /**
   * 0.41.0. A camera that replaces the zone's and its player-following target (the Vista Lighthouse binoculars,
   * decomp VistaLighthouseBinoculars_SetCamera): the camera record and its target in world units. Absent otherwise.
   */
  viewCamera?: { camera: import('./records.ts').Camera; target: Vec3 };
  zone: Id;
  matrix: Id;
  /**
   * Texture set, props and light for every chunk: the area of the zone of the last warp or map load. It
   * does not change when walking across zones (decomp: area data is loaded only in FieldMap_Init).
   */
  area: Id;
  /** Increments on every map load (warp or enter); the renderer rebuilds its scene when it changes. */
  loads: number;
  actors: ActorView[];
  storyScene?: import('./story-scenes.ts').StorySceneView;
  /** Camera target (the player, or the free camera), with the DS's delayed height. */
  camera: { cur: Vec3; prev: Vec3 };
  /**
   * Doors animating or held open (an `open` stays until its `close` ends). The door is the prop with
   * `animations.open` that overlaps the 3×1 hitbox x-1..x+1 of row z, searched in the 3×3 chunks around the
   * player (decomp DoorAnimation_FindDoorAndLoad; a prop may sit in a neighbouring chunk). A PC (`animations['pc-on']`) is listed the same way: `pc-on`
   * stays until its `pc-off` ends. Absent = every door at rest (closed).
   */
  doors?: DoorView[];
  /**
   * 0.31.0. A full-screen colour over the field (Sweet Scent's GX_RGB(31, 10, 23) at `alpha` 0–1, decomp ov5_021F013C's
   * BG2 blend). Absent: none.
   */
  tint?: { color: [number, number, number]; alpha: number };
  /** The drawn weather (`GameState.weather`; a `weathers` record): particles, fog and light. */
  weather: Id;
  /**
   * The dark-map circle (DS px radius around the player; decomp DARK_FLASH, widened by Flash), or null
   * when the field is not dark.
   */
  darkness: { radius: number } | null;
  /**
   * 0.34.4. The thunderstorm's lightning flash (decomp weather task 17: the BG brightness / 100 as EVA of 16), 0..1.
   * Absent: no flash now.
   */
  lightning?: number;
  /** Field effects alive now (grass, footprints, splashes, the surf blob, …), oldest first. */
  effects: EffectView[];
  /** Camera offset from its target in world units (`FieldHost.moveCamera`); [0, 0, 0] by default. */
  cameraOffset: Vec3;
  /**
   * The Pokémon Center healing machine while it runs (`FieldHost.healAnimation`, 0.11.0): `balls` placed
   * so far (1–6; `NewGame.healMachine` names the props), `flash` once the final animation plays. Absent
   * otherwise.
   */
  healMachine?: { balls: number; flash: boolean; /** The one-shots' frame (the balls' `flash` and the Pokémon Center screen's; 0.34.1 also at the Pokémon Center); absent before they start. */ frame?: number };
  /**
   * The elevator lights while they play (`FieldHost.elevator`; decomp FieldTask_PlayElevatorAnimation): the
   * prop with `animations['elevator-up' | 'elevator-down']` plays that clip at frame `tick % clip ticks`
   * (`tick` counts from the animation's start, over every loop). Absent = the lights at rest.
   */
  elevatorLights?: { direction: 'up' | 'down'; tick: number };
  /**
   * The platform lift of this zone (0.12.0; decomp PlatformLift_DynamicMapFeaturesInit and the lift task):
   * the lift prop drawn at `position` (world units), instead of where the chunk places it. Absent in a zone
   * without a lift.
   */
  platformLift?: { prop: Id; position: Vec3 };
  /**
   * The map's dynamic features (0.27.0; `gyms.ts`): models they place themselves (the Eterna Gym clock hands)
   * and their fog, which replaces the weather's (Hearthome Gym's FogManager). Absent without a feature. Their
   * animated pieces (bags, tyre stacks, fountains, the clue) are ordinary `effects`.
   */
  features?: FeaturesView;
  /**
   * Props the world draws itself instead of the chunks (0.27.11; `NewGame.boat`: the Canalave ship and its two
   * bridges), at their placements unless a boat trip moves or poses them. Absent where no chunk places them. 0.31.0: the
   * honey trees (`NewGame.specialEncounters.honeyTrees.prop`), a shaking one with its `shake-<n>` clip.
   */
  props?: import('./gyms.ts').FeatureModelView[];
  /** A Distortion World room (0.27.18; `distortion.ts`): the floors drawn and the player's orientation. Absent elsewhere. */
  distortion?: import('./distortion.ts').DistortionView;
  /** Standalone ship scene; replaces the field and its fade while present. */
  shipScene?: import('./boat.ts').ShipSceneView;
  /**
   * The clock now (0.17.0; read from `CreateWorld`'s `clock`): seconds since midnight, which pick the area
   * light template (decomp AreaLightManager, `Light.schedule`), and its period (decomp GetTimeOfDay: the
   * object shadows' alpha and size; the zone BGM's day/night variant).
   */
  clock: { seconds: number; period: DayPeriod };
  /**
   * The objects the latest zone connection deleted (0.17.1), as they were then, and that connection's
   * number (counting up per world). Presentation only: a view taller or wider than the DS's 16×12 tiles
   * sees the DS delete objects off its screen, so the renderer keeps those on screen drawn, frozen, until
   * they leave it. Absent after a map load until the next connection.
   */
  departed?: { crossing: number; actors: ActorView[] };
  /**
   * Objects of the other zones in this matrix's cells (`Matrix.zones`) near the player (0.17.1) that a zone connection into their
   * zone would spawn now, standing on their event tile, with the flags as they are now. Clones are left
   * out (their object is live, or previewed in its own zone), and so are objects whose sprite a var names
   * (the zone's onTransition sets it). Presentation only, never interactive: the renderer draws them so
   * that objects the DS spawns at a crossing are on a big screen already.
   */
  previews: ActorView[];
}

/**
 * 0.28.4. How `World.enter` comes to the map: `arrival` (a new game, a warp, a map change: the full map load order in
 * field.ts) or `load` (a loaded save, decomp FieldTask_LoadSavedGameMap: no onTransition, the saved map-local flags,
 * weather, map features and objects kept).
 */
export type MapEntry = 'arrival' | 'load';

export interface World extends FieldHost {
  /** Read-only view for the renderer. */
  view(): FieldView;
  /** Map load for state.player, following the load order in field.ts for an arrival or a loaded save. */
  enter(entry: MapEntry): void;
  /** Tick step 2 (called when no script runs): between steps, fires at most one trigger via the ScriptRunner. */
  checkTriggers(input: InputFrame): void;
  /** Tick step 4. */
  step(input: InputFrame): void;
  /**
   * The field's return after a battle, between its on-load and on-resume scripts (0.27.29; decomp FieldMap_Init's
   * DynamicMapFeatures_Init): the map's dynamic features are built again from the saved slot (the Distortion World's
   * objects from the story state the battle's scripts left).
   */
  fieldReturned(): void;
  /**
   * 0.34.4. One game tick of the weather tasks' sound and lightning (decomp ov5_021D5EB8.c), on every tick the game counts:
   * `field` is false while a battle or a menu app replaces the field map (FieldMap_Exit stops the weather's loop; the
   * field's return starts its weather at full). Sound only: it changes no game state.
   */
  weatherTick(field: boolean): void;
  /**
   * 0.28.2. The player's CONTINUE from the title (decomp FieldTask_LoadSavedGameMap's RoamingPokemon_RandomizeAllLocations):
   * every active roamer moves to a random route. Only the title's CONTINUE calls it (`Game.onContinue`), never a plain
   * load, so a replay's save round trip gives back the saved state.
   */
  continued(): void;
  /**
   * No step, warp, fade or script movement in progress, and the player is not on a tile that forces
   * movement (ice, bike slopes and ramps; decomp PLAYER_MOVE_STATE_MOVING). Gates the start menu and saving.
   */
  idle(): boolean;
  fadeState(): { color: 'black' | 'white'; alpha: number } | null;
  /**
   * Decomp CanUseBicycle (0.20.0; the registered Bicycle on Select): null when the player can get on or
   * off here, else ITEM_USE_CANNOT_USE_WITH_PARTNER (`partner`), ITEM_USE_CANNOT_DISMOUNT (`dismount`:
   * the forced-biking gate, Cycling Road, an elevated bike bridge) or ITEM_USE_CANNOT_USE_GENERIC
   * (`generic`: very tall grass or mud, a zone without bikes, surfing).
   */
  /** CanUseFishingRod: surfable facing tile, and no elevated bridge. */
  fishingCheck(): 'fish' | 'generic' | null;
  /** FieldTask_Fishing, rod 0/1/2; blocks input and saving until finished. */
  fish(rod: 0 | 1 | 2): void;
  bicycleCheck(): 'partner' | 'dismount' | 'generic' | null;
  /**
   * 0.29.1. The gate's binoculars while they run (`FieldHost.greatMarshLookout`): the Pokémon in the screen's centre
   * (an 80×80 front picture, frame 0, at DS 128, 96) and the circle fade (0 closed … 1 open; null: none), which the
   * app draws over the field; null while they are not in use.
   */
  lookoutView(): { pokemon: { species: Id; female: boolean } | null; iris: number | null } | null;
  /**
   * 0.29.0. Fly (decomp FieldMoves_FlyTask, FieldTask_MapChangeFly): the cut-in with the party Pokémon in `slot`, the
   * map change to `dest` facing down (a warp's game data, on foot), FieldSystem_SetFlyFlags (the Safari Game ends,
   * every roamer scatters), the landing. `FieldView.fly` draws it. Blocks input and saving until `flyDone()`.
   */
  fly(slot: number, dest: { zone: Id; x: number; z: number }): void;
  flyDone(): boolean;
  /** 0.29.0. `FieldView.fly` without the rest of the view (the app's overlay draws it every frame). */
  flyScene(): FlySceneView | null;
  /**
   * 0.29.0. Teleport (decomp FieldMoves_TeleportTask, FieldWarp_TeleportFadeOut and FieldWarp_FadeIn): the HM cut-in,
   * the warp-out spin and fade to black, the map change to `dest` facing down (as Fly's, FieldSystem_SetTeleportFlags),
   * the warp-in. Blocks input and saving until `teleportDone()`.
   * 0.32.1: `dig` is Dig (FieldMoves_DigTask, FieldWarp_DigFadeOut: the same states) to the exit location with its
   * facing, and FieldSystem_SetEscapeFlags (only the Safari Game ends) instead of the teleport flags.
   */
  teleport(slot: number, dest: { zone: Id; x: number; z: number; facing?: Facing }, kind?: 'teleport' | 'dig'): void;
  teleportDone(): boolean;
  /**
   * 0.31.0. CanUsePokeRadar's tile test (the bag and Y check the partner and the bike first): the player stands in tall
   * grass (TileBehavior_IsTallGrass), else ITEM_USE_CANNOT_USE_GENERIC (`generic`).
   */
  pokeRadarCheck(): 'generic' | null;
  /**
   * 0.31.0. The Poké Radar (decomp RefreshRadarChain): below a full battery its low-battery script; else the battery
   * empties, the patches are drawn around the player (none: the quiet-grass script), they shake and SEQ_KUSAGASA plays.
   * Blocks input and saving while it runs.
   */
  pokeRadar(): void;
  /** 0.31.0. The live Poké Radar chain (the Pokétch's Trainer Counter): its species and count, or null when none runs. */
  radarChain(): { species: Id; count: number } | null;
  /**
   * 0.31.0. The chain's live patches for replays (`until radar`): each tile and whether it keeps the chain (a player
   * reads that from the shake), and the count. Null without a chain.
   */
  radarPatches(): { count: number; patches: { x: number; z: number; continues: boolean }[] } | null;
  /**
   * 0.31.0. Sweet Scent from the party (`slot`: decomp ov5_021F101C, the HM cut-in first) or Honey from the bag (null:
   * ov5_021F0488): the pink scent fades in, then a wild encounter on an encounter tile (WildEncounters_TrySweetScentEncounter),
   * else the scent fades and COMMON_SCRIPTS 28 runs; in weather that stops it, COMMON_SCRIPTS 29. Blocks input and saving.
   */
  sweetScent(slot: number | null): void;
  /**
   * 0.33.0. CanUseExplorerKit's field test (decomp item_use_functions.c): a main-matrix zone that is not a Mystery
   * Zone, off Cycling Road, no Safari Game, not surfing, not on a bridge or a tile that forbids it, no object event on
   * the player's tile; else `generic`. The bag checks the partner first.
   */
  explorerKitCheck(): 'generic' | null;
  /**
   * 0.33.0. Into the Underground (decomp FieldTask_MapChangeToUnderground, MapChangeUndergroundContext_New): the
   * surface tile is kept as the special location, the BGM fades, the map changes to the Underground tile under the
   * player's chunk, facing down. Blocks input and saving until it is done. No DS Wireless prompt or forced save (no
   * wireless here; docs/decisions.md). 0.45.0: with the jump into the hole and the fall (`undergroundTransition`).
   */
  enterUnderground(): void;
  /**
   * 0.33.0. Back up (decomp FieldTask_MapChangeFromUnderground): to the special location, facing down. 0.45.0: with the
   * rise and the jump out of the hole (`undergroundTransition`).
   */
  exitUnderground(): void;
  /**
   * 0.33.0. What the Underground's field asks the game to open, taken once (an A press at a mining spot or a vendor,
   * X): the game opens the app and, when it closes, calls `undergroundAppDone`. Null when nothing waits.
   */
  undergroundRequest(): import('./underground.ts').UndergroundRequest | null;
  undergroundAppDone(result: import('./apps.ts').AppResult): void;
  /** 0.33.0. The tile ahead in the Underground for a burial (`AppHost.undergroundAhead`); null off the Underground. */
  undergroundAhead(): { x: number; z: number; secretBase: boolean; object: boolean; wall: boolean } | null;
  /** 0.33.0. In the Underground: its top screen, drawn as a card over the field (`UndergroundFieldView`); null elsewhere. */
  undergroundView(): import('./underground.ts').UndergroundFieldView | null;
  /** 0.33.0. The visit's mining generator (`AppHost.undergroundMiningRand`); null off the Underground. */
  undergroundMiningRand(): import('@opensinnoh/core').Rand32 | null;
  /** 0.37.0. The decoration's field view (`AppHost.undergroundDecoration`); null ends it. */
  undergroundDecoration(view: import('./underground.ts').UndergroundDecorationView | null): void;
  /** 0.45.0. The rock trap's shadow (`AppHost.undergroundTrapShadow`); null ends it. */
  undergroundTrapShadow(size: number | null): void;
  /** 0.45.0. The way down or up while it is drawn (`UndergroundTransitionView`); null otherwise. */
  undergroundTransition(): import('./underground.ts').UndergroundTransitionView | null;
  /** 0.37.0. Where the player is in the Underground (`AppHost.undergroundPlace`). */
  undergroundPlace(): 'corridor' | 'open' | 'closed' | null;
  /**
   * 0.32.1. Talking to the following Pokémon (OpenSinnoh's follower talk; HGSS scr_seq_0163 FollowMonFacePlayer): when
   * the idle player faces the party follower, it turns to face the player and this returns its facing and the
   * `sourceIndex` of the tile behaviour under it; else null and nothing changes.
   */
  talkToFollower(): { facing: Facing; behavior: number } | null;
  /**
   * 0.32.1. HGSS FollowMonMovement_ApplyOffset/_ApplyFacing while it talks: the follower drawn `dx`, `dy`, `dz` world
   * units from its tile and turned to `facing`; null puts it back (the facing it had when the talk began).
   */
  followerTalkPose(pose: { dx: number; dy: number; dz: number; facing: Facing } | null): void;
  /** 0.32.1. The emote bubble over the follower (`ActorView.bubble`), or null. */
  followerBubble(bubble: { sprite: Id; frame: number; rise: number } | null): void;
}

export type CreateWorld = (deps: {
  /** The game's deterministic sound system (0.27.24; required), shared with the VM and menus. */
  audio: AudioHost;
  /** Map BGM is selected before arrival door/escalator cues (0.27.24). */
  mapLoaded?: (zone: Id, loads: number) => void;
  registries: Registries;
  state: GameState;
  scripts: ScriptRunner;
  log: StubLog;
  /** Appends to the game's battle log. */
  battleLog: (entry: Omit<BattleLogEntry, 'tick'>) => void;
  /** The game's battle mode behind `FieldHost.startBattle` / `battleDone` / `blackOut`. */
  battles: { start(setup: BattleSetup): void; done(): BattleResult | null; blackOut(): void };
  /**
   * The game clock (0.17.0; the DS RTC): the device's local date and time in play, frozen in replays and
   * tests. Wild encounters and the area lights read it (decomp GetTimeOfDay, GetSecondsSinceMidnight);
   * yearly weathers read the saved clock (`GameState.gameTime`). Replaces 0.12's `date()`.
   */
  clock: () => ClockTime;
  /** 0.27.12. The following Pokémon option (`DeviceOptions.followers`): true while on. Absent: on. */
  followers?: () => boolean;
  /** 0.27.21. Animate the idle party follower in place. Absent: still. */
  followerWalkInPlace?: () => boolean;
  /** 0.32.1. Auto-run (`DeviceOptions.autoRun`): with the Running Shoes, run unless B is held. Absent: off (the DS). */
  autoRun?: () => boolean;
  /** 0.32.1. The HGSS look (`DeviceOptions.character` 1): HGSS_PLAYER_SPRITES where the packs have them. Absent: off. */
  hgssCharacter?: () => boolean;
}) => World;

export type CreateScriptRunner = (deps: {
  registries: Registries;
  labels: Labels;
  state: GameState;
  /** Called lazily: the world is constructed after the runner. */
  field: () => FieldHost;
  /** Next value of the game's seeded PRNG: an unsigned 32-bit integer. */
  rng: () => number;
  /**
   * Field message print delay in frames per character (decomp Options_TextFrameDelay: slow 8, mid 4,
   * fast 1). A device option, not game state: read when each message starts.
   */
  textSpeed: () => number;
  log: StubLog;
  /** Appends to the game's battle log (battle stubs report each stubbed battle here; the game sets `tick`). */
  battleLog: (entry: Omit<BattleLogEntry, 'tick'>) => void;
  /** The game's sound system (0.18.0): the music, sound effect, fanfare and cry ops, and their waits. */
  audio: AudioHost;
  /** The game clock (0.17.0; `CreateWorld`'s): ops that read the RTC directly (`get_day_of_week`). */
  clock: () => ClockTime;
  /**
   * 0.34.0. The save as scripts reach it (decomp SaveData, FieldSystem_Save; `check_save_type`, `try_save_game`, the
   * frontier's FrontierScrCmd_72): whether this adventure has a save to overwrite (it was loaded or saved), writing
   * the save now (also mid-script; true when written), and the soft reset after it (decomp OS_ResetSystem, the Battle
   * Tower's REST: the game stops, the title's CONTINUE loads the save). Absent in hosts without saves (tests): those ops throw.
   */
  saves?: ScriptSaves;
}) => ScriptRunner;

/** 0.34.0. `CreateScriptRunner` deps `saves`. */
export interface ScriptSaves {
  exists(): boolean;
  write(): boolean;
  reset(): void;
}

/** Renderer for the main surface. `alpha` interpolates between the last two ticks. */
export interface FieldRenderer {
  render(alpha: number): void;
  /**
   * 0.37.0. The map tile under a point of the canvas (CSS px from its top-left; ov5_GetPositionFromTouchCoordinates: the
   * ground plane under the camera), or null off the map or before the map has loaded.
   */
  tileAt?(x: number, y: number): { x: number; z: number } | null;
  /** 0.37.0. Where a tile's centre on the ground is drawn (CSS px from the canvas' top-left; NNS_G3dWorldPosToScrPos). */
  screenOf?(x: number, z: number): { x: number; y: number } | null;
  /** True while map geometry, textures or sprites for the current view are still loading. */
  loading(): boolean;
  /**
   * `width`/`height` in CSS px. `scale` (0.24.1) is CSS px per DS px, the player's zoom: the view shows
   * `width / scale × height / scale` DS px around the DS camera's target. Omitted, the DS view just fits.
   */
  resize(width: number, height: number, pixelRatio: number, scale?: number): void;
  dispose(): void;
}

export type MountFieldRenderer = (
  canvas: HTMLCanvasElement,
  /** `log` takes the renderer's stubs (things it does not draw yet). */
  deps: { world: World; registries: Registries; state: GameState; assets: AssetSource; log: StubLog },
) => Promise<FieldRenderer>;

/**
 * Draws the VM's message/yes-no boxes onto a 2D canvas over the field (packages/text). `scale` is whole
 * device pixels per DS pixel. The message box is 256 DS px wide, centred horizontally at the bottom
 * of the canvas (as on the top screen); the yes/no box sits above its right end.
 */
/**
 * A window frame image drawn as a nine-slice (0.20.0; a `Ui2dSheet` with `nineSlice`): the insets in px
 * (left, top, right, bottom); the edges and the centre repeat.
 */
export interface NineSliceArt {
  image: CanvasImageSource;
  width: number;
  height: number;
  slice: [number, number, number, number];
}

/**
 * The ROM's window frames for the field boxes (0.20.0): `message` is the message box frame the FRAME option
 * picks (decomp Window_DrawMessageBoxWithScrollCursor, `windows/message_box_NN`), `window` the standard
 * field frame of menus and the yes/no box (Window_DrawStandardFrame, `windows/standard_field`). Absent
 * when the base pack has no frames (the fixture): original drawn borders.
 */
export interface OverlayFrames {
  message: NineSliceArt;
  window: NineSliceArt;
}

/** `unown` (0.41.0): the font of a message with `font: 'unown'` (`NewGame.unownFont`). */
export type DrawScriptOverlay = (ctx: CanvasRenderingContext2D, view: ScriptView, font: LoadedFont, scale: number, frames?: OverlayFrames, unown?: LoadedFont) => void;

export interface LoadedFont {
  image: CanvasImageSource;
  cellWidth: number;
  cellHeight: number;
  glyph: Map<string, { index: number; width: number }>;
}
