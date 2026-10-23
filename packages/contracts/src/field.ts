/**
 * The seam between the script VM (packages/vm) and the field/world (packages/world), contracts v0.8.
 *
 * Tick order (30 Hz), owned by the game loop:
 *   1. input → InputFrame (held + newly pressed)
 *   2. if no script is running: world.checkTriggers, which fires between steps (no step, warp, fade, task
 *      or script movement), in priority order
 *      frame (zone onFrame rows) → trainer sight (source 'trainer', NewGame.trainerApproach) → talk/bg/tile
 *      behaviour (A pressed facing an object, a bg event, a behaviour with `interact`) → coord (step
 *      completed onto it) → warp (step completed onto a warp tile; arriving on one does not fire it) → wild
 *      encounter (step completed on an encounter tile → FieldHost.startBattle). Decomp FieldInput_Process
 *      runs frame → sight → step events (coord, warp) → wild encounter → A press; talk before coord is ours.
 *      On a tile that forces movement (ice, bike slopes and ramps) only frame and sight run: the DS player
 *      move state stays MOVING there (PlayerAvatar_UpdatePlayerMoveState), and `World.idle()` is false.
 *   3. vm.step(input)
 *   4. world.step(input) — player movement input is ignored while a script runs
 *   5. present
 *
 * Map load order (warp or new game): clear map-local flags/vars → onTransition (runImmediate; sets e.g.
 * VAR_OBJ_GFX vars, may call setObject*) → spawn objects → onLoad (runImmediate) → the zone's map
 * features (a platform lift at its saved floor) → onResume (runImmediate; also when loading a save, as the
 * DS runs INIT_SCRIPT_ON_RESUME on every FieldMap_Init) → fade in. A warp sets `GameState.previousZone`.
 * A loaded save (`World.enter('load')`, decomp FieldTask_LoadSavedGameMap) skips the first two steps and keeps
 * the saved map-local flags, weather and map features; it restores the saved objects instead of spawning.
 * The VM and the world share one mutable GameState (flags, vars, party, player) owned by the game.
 * A numeric var that names a record holds that record's `sourceIndex` (sprites, species, items).
 */
import type { Id } from '@opensinnoh/core';
import type { BattleRequest, BattleResult } from './battle.ts';
import type { Facing } from './records.ts';
import type { AppRequest, AppResult } from './apps.ts';
import type { InputFrame, MenuView, PanelView } from './ui.ts';
import type { MapFeatures } from './gyms.ts';
import type { FrontierView } from './frontier.ts';

/** Object refs are local ids in the current zone, plus these special ids (decomp LOCALID_*). */
export const LOCALID_PLAYER = 0xff;
export const LOCALID_CAMERA = 0xf1;
export const LOCALID_FOLLOWER = 0xf2;

/** Tile coordinates in the zone's matrix; y in world units. */
export interface PlayerPosition {
  zone: Id;
  x: number;
  z: number;
  y: number;
  facing: Facing;
}

/** World services used by script commands. All calls are synchronous; waits are polled per tick. */
export interface FieldHost {
  player(): PlayerPosition;
  /** Starts a movement script on an object; throws if the object is not present. */
  applyMovement(target: number, movement: Id): void;
  /** True when no script movement is running on `target` (or on any object for 'all'). */
  movementDone(target: number | 'all'): boolean;
  lockAll(): void;
  releaseAll(): void;
  lockObject(target: number): void;
  /** Unpauses one object (decomp ScrCmd_ReleaseObject → MapObject_SetPauseMovementOff; 0.12.0). */
  releaseObject(target: number): void;
  /** Shows or hides an object without removing it (hide-flag changes while the object is live). */
  setObjectVisible(localId: number, visible: boolean): void;
  setPlayerState(state: 'walk' | 'cycle' | 'surf'): void;
  /**
   * Redraws the player with another avatar sprite until the next setPlayerState (decomp
   * PlayerAvatar_RequestStateHeal: `NewGame.playerHealSprite`, with the give/receive poses). Not saved.
   */
  setPlayerAvatar(avatar: 'heal' | 'contest'): void;
  /**
   * 0.35.0. A camera flash on the stage (decomp SysTask_DoContestCameraFlash: BrightnessController_StartTransition 6
   * steps from +4 to 0 on the main screen), drawn through `FieldView.lightning`. Presentation only.
   */
  cameraFlash(): void;
  /** Trainer sight: the trainer walks up to the player ("!" first). Poll trainerApproachDone. */
  trainerApproach(localId: number): void;
  trainerApproachDone(): boolean;
  /**
   * The Cut / Rock Smash animation (decomp ScrCmd_StartDestroyObstacleAnimation → ov6_0224899C), by the
   * script's obstacle operand: 0 Cut and 1 Rock Smash on the tile the player faces, 2 Rock Smash on the tile
   * local object 0 faces (Roark in Oreburgh Mine B2F). The world spawns the `CUT` / `ROCK_SMASH` field effect
   * there; the script removes the obstacle object itself. Poll destroyObstacleDone.
   */
  destroyObstacle(obstacle: number): void;
  destroyObstacleDone(): boolean;
  /** Turns the player in place (d-pad during some script waits). */
  turnPlayer(facing: Facing): void;
  /** True while an object is mid-step for any reason (e.g. the follower); lock_all waits on the follower. */
  objectMoving(target: number): boolean;
  facePlayer(localId: number): void;
  addObject(localId: number): void;
  removeObject(localId: number): void;
  /**
   * setObject* edit the zone's event data for this visit only (decomp SetObjectEvent*): they take effect
   * when the object is next spawned (add_object, map load). A live object is unchanged.
   */
  setObjectPosition(localId: number, x: number, z: number): void;
  setObjectFacing(localId: number, facing: Facing): void;
  setObjectMovementType(localId: number, movementType: number): void;
  /** Switches a live object's movement type (decomp ScrCmd_SetMovementType, MapObject_SwitchMovementType). */
  switchMovementType(target: number, movementType: number): void;
  /**
   * Whether other objects and the player pass through a live object (0.27.13; decomp MAP_OBJ_STATUS_18, which
   * sub_02063F00 skips in its object collision). MOVEMENT_TYPE_FOLLOW_PLAYER sets it and switching the type
   * away keeps it; `scr_cmd_2b6` (sub_02062D80) sets or clears it. Saved with the object (`ObjectState.passThrough`).
   */
  setObjectPassThrough(localId: number, passThrough: boolean): void;
  setObjectPersistent(localId: number, persistent: boolean): void;
  /** Moves a live object (or the player) to a tile and facing now (decomp SetPosition, MapObject_SetPosDirFromCoords). */
  setPositionLive(localId: number, x: number, z: number, facing: Facing): void;
  setWarpPosition(index: number, x: number, z: number): void;
  /** Points warp `index` at another zone for this visit (0.27.33; decomp MapHeaderData_SetWarpEventDestHeaderID); its destination warp stays. */
  setWarpDestination(index: number, zone: Id): void;
  /** Starts a warp (fade out, load per the map load order, fade in). */
  warp(zone: Id, x: number, z: number, facing: Facing): void;
  warpDone(): boolean;
  fade(kind: 'in' | 'out', frames: number, color: 'black' | 'white'): void;
  fadeDone(): boolean;
  /**
   * Adds the invisible camera object (LOCALID_CAMERA) at a tile, moved by applyMovement(LOCALID_CAMERA, …).
   * The camera follows it unless `track` is false (decomp AddCameraOverrideObject: the object only paces a
   * scripted wait while the camera stays on the player).
   */
  addFreeCamera(x: number, z: number, track?: boolean): void;
  restoreCamera(): void;
  /** Door open/close animation on the prop at a tile; v0.1 may complete immediately. */
  playDoor(x: number, z: number, kind: 'open' | 'close'): void;
  doorDone(): boolean;
  /**
   * The PC's boot-up (`pc-on`, held) or shut-down (`pc-off`) clip (decomp FieldSystem_LoadPCAnimation
   * → FieldSystem_FindLoadedMapPropByModelIDs: the first loaded prop with `Prop.animations['pc-on']`), shown as
   * a `FieldView.doors` entry. Scripts wait on `doorDone` (wait_for_animation). Throws when no PC is loaded.
   */
  playPcAnimation(use: 'pc-on' | 'pc-off'): void;
  /**
   * Sets `GameState.weather` now and switches the drawn weather (decomp ScrCmd_0C3/0C4 → CLEAR, and the
   * Flash and Defog tasks). Instant: weather has no wait.
   */
  setWeather(weather: Id): void;
  /**
   * Offsets the camera (and the player's drawn sprite) by x/y/z world units from its target (decomp
   * ScrCmd_MoveCamera: MapObject_SetSpritePosOffset + Camera_Move). Instant; `FieldView.cameraOffset`.
   */
  moveCamera(x: number, y: number, z: number): void;
  /**
   * The camera target's x shift of a shake (0.27.11; decomp ov6_0223FE1C: Camera_TrackTarget on a copy of the
   * camera): the camera only, not the player or `moveCamera`'s offset; not saved. 0 ends it.
   */
  shakeCamera(x: number): void;
  /**
   * Shakes an object `times` times at `speed`, by up to x/z DS px (decomp ScrCmd_ShakeObject,
   * MapObject_Shake). The script waits: poll shakeObjectDone.
   */
  shakeObject(localId: number, times: number, speed: number, xOffset: number, zOffset: number): void;
  shakeObjectDone(): boolean;
  /** The elevator ride (decomp ScrCmd_PlayElevatorAnimation): shake the room `loops` times going up or down. */
  elevator(direction: 'up' | 'down', loops: number): void;
  elevatorDone(): boolean;
  /**
   * HM traversal tasks started by `use_surf`, `use_waterfall`, `use_rock_climb` (decomp
   * FieldTask_StartUse*): the party slot's Pokémon is shown, then the player mounts / climbs in the
   * facing direction (Surf: the moving direction). Each script waits on its `…Done`.
   */
  /** Shared 59-callback HM presenter; the selected Pokémon cries at callback 36 (resources ready after init). */
  hmCutIn(slot: number): void;
  hmCutInDone(): boolean;
  surf(slot: number): void;
  surfDone(): boolean;
  waterfall(slot: number): void;
  waterfallDone(): boolean;
  rockClimb(slot: number): void;
  rockClimbDone(): boolean;
  /**
   * Cycling Road (0.12.0; decomp ScrCmd_ForceBicycling → PlayerAvatar_SetOnCyclingRoad): while set and
   * cycling on an elevated bridge with no d-pad input, the player rolls south (TILE_MOVE_CYCLING_ROAD_DOWN).
   * An avatar flag, not saved: a map load clears it and the zone's onResume script sets it again.
   */
  forceBicycling(on: boolean): void;
  /**
   * While false, the player's height does not follow the terrain (0.12.0; decomp
   * PlayerAvatar_SetHeightCalculationEnabled). Not saved; a map load enables it.
   */
  setPlayerHeightCalculation(enabled: boolean): void;
  /** Moves bg event `index` for this visit (0.12.0; decomp MapHeaderData_SetBgEventPos). */
  setBgEventPosition(index: number, x: number, z: number): void;
  /**
   * Platform lifts (0.12.0; decomp platform_lift.c: Iron Island and the Pokémon League). `initPlatformLift`
   * (decomp PersistedMapFeatures_InitForPlatformLift, from onTransition) sets `GameState.platformLift` for
   * this zone from the arrival tile; `platformLiftNotUsedWhenEntered` reads it; `triggerPlatformLift`
   * (PlatformLift_Trigger) rides the lift to the other floor, and the script waits on `platformLiftDone`.
   * Throws in a zone without a lift.
   */
  initPlatformLift(): void;
  platformLiftNotUsedWhenEntered(): boolean;
  triggerPlatformLift(): void;
  platformLiftDone(): boolean;
  /**
   * Map features (0.27.0; contracts `gyms.ts`): decomp PersistedMapFeatures_InitFor*Gym, run by the zone's
   * onTransition (`init_persisted_map_features_for_<eterna|hearthome|veilstone>_gym`). Selects and clears the
   * saved slot (`GameState.mapFeatures`); the map load then builds the feature from it (DynamicMapFeatures_Init).
   */
  initMapFeatures(kind: MapFeatures['kind']): void;
  /**
   * 0.29.1. The Great Marsh's quick tram (decomp GreatMarshTram_MoveToLocation, MoveTram): `call` brings it to the
   * station the player stands at; `ride` carries the (invisible) player to `location` (GREAT_MARSH_TRAM_LOCATION_*),
   * walking them along under it. The saved station (`MapFeatures` `great-marsh`) changes at once; waited on with
   * `greatMarshTramDone`.
   */
  moveGreatMarshTram(location: number, movement: 'call' | 'ride'): void;
  greatMarshTramDone(): boolean;
  /**
   * 0.29.1. The gate's binoculars (decomp GreatMarshLookout_Init, Task_GreatMarshLookout): five views of random
   * Great Marsh spots, each with a Pokémon of that area, then back where the player stood; waited on with
   * `greatMarshLookoutDone`.
   */
  greatMarshLookout(): void;
  greatMarshLookoutDone(): boolean;
  /**
   * 0.31.0. HoneyTree_StopShaking (`stop_honey_tree_shaking`, and `start_honey_tree_battle`'s HoneyTree_Unslather): the
   * current zone's honey tree stops shaking until its prop is loaded again with a Pokémon waiting.
   */
  stopHoneyTreeShaking(): void;
  /**
   * The Distortion World's script commands (0.27.29; decomp DistWorld_AddMapObjectWithLocalID /
   * DeleteMapObjectWithLocalID, ResetPersistedCameraAngles, Start/FinishGiratinaShadowEvent): add (`add`) or delete the
   * current room's object with that local id; clear the saved camera angles; start a Giratina shadow event (`index`)
   * or finish the one running (null). Throw outside a Distortion World room.
   */
  distortionObject(localId: number, add: boolean): void;
  resetDistortionCameraAngles(): void;
  giratinaShadowEvent(index: number | null): void;
  /**
   * Decomp EternaGym_AdvanceClockState (`advance_eterna_gym_clock`): false at the leader state (nothing
   * starts); otherwise the clock state and its saved var advance and the clock task runs. The script waits on
   * `eternaGymClock()`: at `message` it prints the fountain message, waits for a new A or B and calls
   * `eternaGymClockContinue()`; at `done` it resumes. Throws outside Eterna Gym's clock.
   */
  advanceEternaGymClock(): boolean;
  eternaGymClock(): 'running' | 'message' | 'done';
  eternaGymClockContinue(): void;
  /**
   * Decomp PastoriaGym_PressButton (`press_pastoria_gym_button`, 0.27.11): the button prop under the player
   * picks the colour (none: nothing happens), the saved slot changes at once and the water task runs; the
   * script waits on `pastoriaGymButtonDone`. Throws outside Pastoria Gym.
   */
  /**
   * Decomp FieldSystem_PlayBoatCutscene (`play_boat_cutscene`, 0.27.11): from Canalave (travel direction 3) the
   * ship sails off and the bridges open, then the screen fades, the trip's cinematic runs and the map changes to
   * `zone` x/z facing `exit`; the return (0) starts at the fade. The script waits on `boatCutsceneDone`.
   */
  playBoatCutscene(travelDir: number, exit: Facing, zone: Id, x: number, z: number): void;
  boatCutsceneDone(): boolean;
  pressPastoriaGymButton(): void;
  setStoryScene(view: import('./story-scenes.ts').StorySceneView | null): void;
  objectPosition(localId: number): [number, number, number];
  faceObject(localId: number, facing: Facing): void;
  initContainmentUnits(freed: boolean): void;
  deactivateContainmentUnits(): void;
  containmentUnitsDone(): boolean;
  initSunyshoreGym(room: number): void;
  pressSunyshoreGymButton(button: number): void;
  sunyshoreGymButtonDone(): boolean;
  pastoriaGymButtonDone(): boolean;
  /**
   * Decomp HearthomeGym_SetTrainerPostBattleMovement (`set_move_code_for_facing_direction`, and the end of a
   * trainer's approach): true when the map feature set the object's movement itself (Hearthome's trainers
   * wander 2×2 around where they stand); false elsewhere.
   */
  trainerPostBattleMovement(localId: number): boolean;
  /**
   * The Pokémon Center healing machine (decomp FieldSystem_PlayHealingAnimation_Pokecenter, 0.11.0): one
   * ball per `balls` placed on the machine, then the final flash; `FieldView.healMachine` shows them. The
   * script waits on healAnimationDone. 0.27.19: `machine` `hall-of-fame` is the Hall of Fame's (decomp
   * FieldSystem_PlayHealingAnimation_HallOfFame: no heal jingle, the balls' one-shot only). 0.34.1: the
   * Pokémon Center's plays SEQ_SE_DP_BOWA per ball and the SEQ_ASA fanfare with the balls' and the screen's
   * one-shots, and is done once both one-shots and the fanfare have ended.
   */
  healAnimation(balls: number, machine?: 'pokecenter' | 'hall-of-fame'): void;
  healAnimationDone(): boolean;
  /**
   * Starts a battle (`battle.ts`): the game enters battle mode from the next tick (the field and VM pause,
   * nothing is saved). The VM's battle commands call it and wait on `battleDone`; the world adds the scene
   * (backdrop and terrain from the zone and the tile under the player, decomp SetBackgroundAndTerrain, 0.14.0).
   * Throws while a battle is already active.
   */
  startBattle(request: BattleRequest): void;
  /** The result of the last battle once it has ended, null while one runs (or before any). */
  battleDone(): BattleResult | null;
  /**
   * Black out after a lost battle (decomp FieldTask_BlackOutFromBattle, 0.14.0; `black_out_from_battle`): once
   * no script runs, the game warps to `GameState.blackOut` (facing up) and starts the recover script there
   * (the house or the Pokémon Center heals the party). A lost wild battle does this by itself.
   */
  blackOut(): void;
  /**
   * 0.27.2. Decomp RoamingPokemon_ActivateSlot (`activate_roaming_pokemon`): roaming slot `slot` (decomp
   * ROAMING_SLOT_*: Mesprit, Cresselia, Darkrai, Moltres, Zapdos, Articuno) gets a fresh roamer at its level on a
   * random route (`GameState.roamers`). Throws for any other slot.
   */
  activateRoamer(slot: number): void;
  /**
   * 0.29.0. Decomp BerryPatches_StartWatering (`set_berry_watering_state` START, the Sprayduck task): the player takes
   * the Sprayduck pose, waters the berry patch they face (facing up or down), and while left or right is held steps
   * along the row (the patches north of the player's next tile) watering each; up or down away from the row, a patch
   * missing, or 90 ticks without a step ends it. The script waits on `wateringDone`.
   */
  startWatering(): void;
  wateringDone(): boolean;
  /** 0.29.0. Decomp BerryPatches_EndWatering (`set_berry_watering_state` END): the avatar of the player's state again. */
  endWatering(): void;
}

export interface ScriptStart {
  label: Id;
  zone: Id;
  /** Object local id that was talked to (decomp VAR_LAST_TALKED), when relevant. */
  lastTalked?: number;
  /** 0.28.1 `item`: a key item's script (the Azure Flute, decomp sub_020685AC). */
  source: 'object' | 'bg' | 'coord' | 'frame' | 'load' | 'transition' | 'resume' | 'new-game' | 'test' | 'trainer' | 'field-move' | 'step' | 'blackout' | 'item';
  /**
   * Script parameters (decomp FieldSystem_SetScriptParameters, SCRIPT_DATA_PARAMETER_0–3): the VM sets
   * VAR_0x8000.. (vars by `sourceIndex` 0x8000 + i) to them when the thread starts. A field move passes
   * the party slot.
   */
  params?: number[];
  /**
   * Trainers that spotted the player, slot 0 = the one that saw them (decomp ApproachingTrainer slots).
   * sightType: 0 single, 1 double (slot 1 = the partner object), 2 two singles.
   */
  trainer?: { localIds: number[]; trainers: Id[]; sightType: number };
}

/** Signpost box kinds (decomp SIGNPOST_TYPE_*), drawn instead of the plain message frame. */
export type SignpostKind = 'map' | 'arrow' | 'landmark' | 'scrolling';

/** What the VM puts on screen: the message/yes-no boxes (main surface) and the touch panel. */
export interface ScriptView {
  /**
   * The message box. `signpost` marks a signpost box: its kind and how far (DS px, 0–48) it is still
   * scrolled below its resting place (it slides in and out 16 px per tick).
   */
  message: { text: string; waitingForInput: boolean; signpost?: { kind: SignpostKind; offset: number } } | null;
  yesNo: { cursor: 0 | 1 } | null;
  /** Scripted multichoice / list menu (VM-owned box over the field). */
  menu: MenuView | null;
  /**
   * The elevator's current-floor window (decomp ScrCmd_ShowCurrentFloor → FieldMenu_ShowCurrentFloorWindow),
   * a framed box beside the elevator menu. Geometry in DS px of the main screen, like `MenuView`: `x`/`y`
   * is the window interior (its tilemap left/top × 8), `width`×`height` its size (11×4 tiles); each line
   * is drawn at its offset inside it (menu entries "Current Floor" at 0,0 and the floor name at 32,16).
   * It stays open, also after the script, until the op's var becomes 0xFFFF (CurrentFloorWindowSystaskCallback).
   * 0.29.0: the move tutors' shard cost window uses it too (decomp FieldMenuManager_NewMoveTutorCostWindow, 10×16
   * tiles: each shard's name and its cost below it), from `show_shard_cost` until `close_shard_cost_window`.
   * Absent = closed.
   */
  floorWindow?: { x: number; y: number; width: number; height: number; lines: { text: string; x: number; y: number }[] };
  /**
   * The field money window (decomp ScrCmd_ShowMoney → FieldMenu_CreateMoneyWindow, the standard
   * field frame): `x`/`y` is its interior (tilemap left/top × 8), `width`×`height` 80×32 (10×4 tiles). `label`
   * (pl_msg 543 #18) is printed at 0,0 and `amount` (#19, the money padded to 6 digits with spaces) right-aligned
   * on the second line (y 16, FieldMenu_PrintMoneyToWindow). Open from `show_money` until `hide_money`, also
   * after the script; `update_money_display` reprints the amount. Absent = closed.
   */
  moneyWindow?: { x: number; y: number; width: number; height: number; label: string; amount: string };
  /**
   * The Pokémon preview (0.27.33; decomp ScrCmd_DrawPokemonPreview → DrawPokemonPreview): a standard field frame
   * whose interior `x`/`y` is tile 10,5 × 8 and `width`×`height` 80×80 (10×10 tiles), with frame 0 of the
   * species' front picture (form 0, not shiny; the female face when `female`) filling it. Open from
   * `draw_pokemon_preview` until `remove_pokemon_preview`. Absent = closed.
   */
  pokemonPreview?: { x: number; y: number; width: number; height: number; species: Id; female: boolean };
  /**
   * 0.34.0. The Battle Points window (decomp ScrCmd_ShowBattlePoints → FieldMenu_DrawBPWindow, the standard field
   * frame): interior `x`/`y` (tilemap left/top × 8), `width`×`height` 80×16 (10×2 tiles), `text` (menu entries #230, the
   * BP padded to 5 digits) right-aligned on its one line. Open from `show_battle_points` until `hide_battle_points`;
   * `update_bp_display` reprints it. Absent = closed.
   */
  bpWindow?: { x: number; y: number; width: number; height: number; text: string };
  /**
   * 0.37.0. The coin window (decomp ScrCmd_ShowCoins → FieldMenu_DrawCoinWindow, the standard field frame), shaped as the
   * BP window: interior `x`/`y` (tilemap left/top × 8), 80×16, `text` (menu entries #197, the coins padded to 5 digits)
   * right-aligned. Open from `show_coins` until `hide_coins`; `update_coin_display` reprints it. Absent = closed.
   */
  coinWindow?: { x: number; y: number; width: number; height: number; text: string };
  /**
   * 0.34.0. The save info window (decomp SaveInfoWindow, `open_save_info` … `close_save_info`): the standard field frame,
   * interior at tile 1,1 (`x`/`y` 8, 8), `width`×`height` in px. `title` (the map name) is its first line; each later line
   * is a label at the left and its value right-aligned (player, badges, the Pokédex while obtained, the play time).
   */
  saveInfo?: { x: number; y: number; width: number; height: number; title: string; lines: { label: string; value: string }[] };
  /** 0.34.0. The saving icon (decomp Window_AddWaitDial) in the message box's corner, from `show_saving_icon` until `hide_saving_icon`. */
  savingIcon?: boolean;
  /**
   * 0.34.0. A Battle Frontier scene runs (`launch_battle_frontier_scene`; contracts `frontier.ts`): what it draws. Its
   * messages, menus and yes/no boxes are this view's `message`, `menu` and `yesNo`. Absent outside the frontier.
   */
  frontier?: FrontierView;
  panel: PanelView;
  /**
   * The menu app a script op waits on (0.11.0; decomp: the script waits on a field task that runs the
   * application). The game opens it and calls `ScriptRunner.appDone` with its result. The view is the app's.
   */
  app: AppRequest | null;
}

/** The VM as seen by the world and the game loop. */
export interface ScriptRunner {
  /** Starts the script thread; throws if one is already running. */
  start(start: ScriptStart): void;
  /** Runs a map script to completion now, with its own temp vars (may happen while a thread waits in a warp). */
  runImmediate(start: ScriptStart): void;
  running(): boolean;
  step(input: InputFrame): void;
  view(): ScriptView;
  /**
   * True once after a script that asked for the start menu (decomp FieldSystem_ShowStartMenu:
   * `show_start_menu`, or X in a button wait) has ended; the app opens its start menu. A new script clears it.
   */
  takeStartMenuRequest(): boolean;
  /** The app of `ScriptView.app` closed with this result; the waiting op resumes on the next tick. */
  appDone(result: AppResult): void;
  /**
   * A field message outside any script (0.20.0; decomp PrintRegisteredKeyItemUseMessage, the registered
   * item's message on Select): prints the text with its `{var n}` slots in the message box, waits for A,
   * B or the d-pad, then closes. `running()` is true until then; throws while a script runs.
   * 0.32.1: `{ markup }` prints that text (an add-on's own, no text record) and closes on A or B only (HGSS's
   * follower talk, FollowMonInteraction_Run state 6).
   */
  notice(text: Id | { markup: string }, slots: string[]): void;
  /**
   * 0.32.1. A field question outside any script (OpenSinnoh's repeat-Repel prompt): prints the text like `notice`,
   * then the YES/NO box (A takes the cursor's answer, B is NO); `answer` runs once it closes. `running()` is true until
   * then; throws while a script runs.
   */
  ask(text: Id, slots: string[], answer: (yes: boolean) => void): void;
}
