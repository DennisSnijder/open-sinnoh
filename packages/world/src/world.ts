import { ContainmentUnits } from './containment.ts';
import { undergroundStep, underground as undergroundState, battleTime, dailyRandomOf, daycareStep, dayPeriod, eggCycleLength, hasFieldSystems, isFeebasTile, isShiny, monGender, onMainMatrix, Prng, readSpecialEncounters, RECORD_CAUGHT_FISH, RECORD_FISH_GOT_AWAY, secondsSinceMidnight, seekerStep, SEEKER_SPIN, swarmDailyOf, swarmIndex, type ClockTime, type Id } from '@opensinnoh/core';
import {
  LOCALID_CAMERA,
  LOCALID_FOLLOWER,
  LOCALID_PLAYER,
  type BattleResult,
  type BattleRequest,
  type BattleSetup,
  dexOf,
  GAME_RECORDS,
  HGSS_PLAYER_SPRITES,
  itemCount,
  newGameRecord,
  TRAINER_SCORE_MAX,
  type AppResult,
  type BgEvent,
  type CreateWorld,
  type Facing,
  type GameState,
  type InputFrame,
  type ObjectEvent,
  type ObjectState,
  type PlayerPosition,
  type DoorView,
  type EncounterTable,
  type Prop,
  type Registries,
  type ScriptRunner,
  type StubLog,
  type World,
  type Zone,
  type ZoneEvents,
  loadedMatrix,
} from '@opensinnoh/contracts';
import { DELTA, OPPOSITE, WALK_NORMAL_TICKS, WALK_SLOW_TICKS, parseAction } from './movement.ts';
import { HmCutIn } from './hm-cut-in.ts';
import { FlyTask } from './fly.ts';
import { TELEPORT_FADE_TICKS, TeleportTask } from './teleport.ts';
import { FieldSound } from './sound.ts';
import { actorXZ, actorY, jumpHeight, advance, createActor, startAction, wait, walk, type Actor, type Motion } from './npc.ts';
import { spriteAnimView } from './sprite-anim.ts';
import { Avatar } from './avatar.ts';
import { Effects, grassRenderer } from './effects.ts';
import { FishingTask, fishingRoll } from './fishing.ts';
import { activateVisiblePatches, onDsScreen, patchActorView, soilEffect, soilObjects, WateringTask, type PatchObject } from './berry-patches.ts';
import { blocksMovement, isSurfable, isBridge, isBridgeStart, isMud, isMudWithGrass, isVeryTallGrass, onBikeBridgeEW, onBikeBridgeNS, sinkDepth } from './behaviours.ts';
import { PlatformLift, LIFTS, initLift, liftOf } from './platform-lift.ts';
import { BOAT_TRAVEL_DIR, BoatTrip } from './boat.ts';
import { FLAG_FORCE_BIKING_IN_GATE, flagId, onEscape, onFlyOrTeleport, onWarp, onZoneConnection, unlockFlyLocation } from './mapchange.ts';
import { APPROACH_DOUBLES, APPROACH_SINGLES, APPROACH_VS2, TRAINER_FLAGS_START, lineDistance, sightDirs, stepApproach, type Approach } from './trainers.ts';
import { ENCOUNTER_BEHAVIOURS, encounterGate, encounterSlots, landSlot, landSlotIndex, replaceLandSlots, tileEncounterRate, type WildRoll } from './encounters.ts';
import { PokeRadar, type RadarEncounter } from './poke-radar.ts';
import { SWEET_SCENT_BLOCKED_WEATHERS, SWEET_SCENT_COLOR, SweetScentTask } from './sweet-scent.ts';
import { HoneyTreeShakes, honeyTreePlacements } from './honey-trees.ts';
import { afterSafariBattle, greatMarsh, safariActive, safariEncounterTable, safariStep } from './safari.ts';
import { GreatMarshLookout, type LookoutView } from './great-marsh-lookout.ts';
import { GreatMarshTram } from './gyms/great-marsh.ts';
import { activateRoamer, roamersAfterBattle, roamersOnContinue, roamerWildSpec, rollRoamerEncounter } from './roamers.ts';
import { battleWeather, battleScene, partnerWildBattleSetup, VAR_PARTNER_TRAINER_ID, wildBattleSetup } from './battle-setup.ts';
import { BEHAVIOUR_PUSH_WARP, BEHAVIOUR_STAIRS, BEHAVIOUR_WARP_NORTH, CHUNK_SIZE, CHUNK_TILES, gridOffset, MapGrid, TILE, tileCentre } from './tiles.ts';

export { TILE, CHUNK_TILES, CHUNK_SIZE } from './tiles.ts';

/** OBJ_EVENT_GFX_SNOWBALL and the field effect of its break (fldeff model 78 with its pattern 165; importer gyms/). */
const SNOWBALL_GFX = 0x76;
/** The bridges' one-shot clip use (`Prop.animations`). */
const BRIDGE_CLIP = 'bridge';
const SNOWBALL_BREAK = 'SNOWPOINT_GYM_SNOWBALL_BREAK';
export { MOVEMENT_TYPE_FOLLOW_PLAYER } from './movement-types.ts';
import { LOOK_TYPES, MOVEMENT_TYPE_FOLLOW_PLAYER, hasTypeState, isKnownType, updateType, type TypeHost } from './movement-types.ts';
import { DISGUISE_DEPTH, DISGUISE_TYPES } from './npc-types.ts';
import { mapChangeWeather, yearlyWeather } from './weather.ts';
import { WeatherTasks } from './weather-tasks.ts';
import { entrance, specialDestination, type Location } from './special-location.ts';
import { ElevatorRide, ShakeTask } from './camera.ts';
import { HealMachine } from './heal-machine.ts';
import { PartyFollower } from './party-follower.ts';
import { EternaGym, PastoriaGym, SunyshoreGym, createMapFeature, initMapFeatures, type FeatureHost, type MapFeature } from './gyms/index.ts';
import { DistortionWorld } from './distortion/feature.ts';
import { SPARKLE_RENDERER, UndergroundField, undergroundArrival, undergroundTables } from './underground.ts';

/** The destroy-obstacle effect's animations are 45 frames (graphic/hiden_effect, ov6_02248050). */
const DESTROY_OBSTACLE_TICKS = 45;
/** Decomp SystemVars_IncrementAmitySquareStepCount: the counter stops at 10000. */
const AMITY_STEPS_MAX = 10000;
/** Decomp SysTask_DoContestCameraFlash: BrightnessController_StartTransition over 6 frames. */
const CAMERA_FLASH_TICKS = 6;
/** Decomp ITEM_USE_FUNC_POKE_RADAR. */
const FIELD_USE_POKE_RADAR = 11;

/** Fade length for warps, in ticks (not yet measured against the DS). */
export const WARP_FADE_TICKS = 8;
/** Decomp TRAINER_SCORE_EVENT_UNDERGROUND_ENTERED and _UNDERGROUND_100_STEPS. */
const TRAINER_SCORE_UNDERGROUND_ENTERED = 36;
const TRAINER_SCORE_UNDERGROUND_100_STEPS = 37;
/** Fly's fades to and from white (hm_cut_in.c FadeOut, FadeIn: StartScreenFade 6 steps of 1 frame). */
const FLY_FADE_TICKS = 6;
/** The field camera follows the target's height with a 6-frame delay (decomp field_camera.c FIELD_CAMERA_DELAY). */
const CAMERA_Y_DELAY = 6;
/**
 * Tiles from the player (each axis) within which FieldView.previews lists the neighbouring zones' objects:
 * past the edge of any view the renderer draws (DS framing: 12 tiles high when wide, 16 wide when tall).
 */
const PREVIEW_RANGE = 32;

/**
 * Running = B held + `state.runningShoes`. The zone's `flags.running` (decomp `isRunningAllowed`) is
 * never read by Platinum's code, so it is not checked here either.
 */

export type { Vec3, ActorView, FieldView } from '@opensinnoh/contracts';
import type { Vec3, ActorView, DwObject, EffectView, FeatureModelView, FieldView, FlySceneView, MapEntry, UndergroundDecorationView } from '@opensinnoh/contracts';
import { countPoketchStep } from '@opensinnoh/contracts';

/** Kept as an alias: World now includes view(). */
export type OpenSinnohWorld = World;

interface Fade {
  color: 'black' | 'white';
  from: number;
  to: number;
  ticks: number;
  elapsed: number;
}

interface Warp {
  /**
   * 'exit': the walk into stairs or an escalator before the fade. 'door-*': entering a door before the
   * fade; 'arrive-*': leaving the arrival door after the load (decomp ov5_021D433C, ov5_021D453C).
   */
  phase: 'exit' | 'door-open' | 'door-walk' | 'door-close' | 'out' | 'in' | 'arrive-open' | 'arrive-walk' | 'arrive-close' | 'escalator-arrive' | 'panel-depart' | 'panel-arrive';
  panel?: { count: number; height: number };
  stairs: boolean;
  escalator?: boolean;
  /** A warp event (not a script warp): arriving on a door tile walks out through the door (decomp sub_02057050). */
  event: boolean;
  /** The door tile being entered (door-* phases). */
  door?: { x: number; z: number };
  /** The arrival warp's index (a warp event); a dynamic arrival warp takes the entrance (special-location.ts). */
  arrivalWarp?: number;
  zone: Id;
  x: number;
  z: number;
  facing: Facing;
}

/** A door prop animation: `tick` counts the steps since `playDoor` (the clip is done at `ticks`). */
interface DoorAnim {
  x: number;
  z: number;
  anim: DoorView['anim'];
  tick: number;
  ticks: number;
}

/** Bg events: one direction, an axis ('horizontal' = left/right, 'vertical' = up/down), or any (decomp BgEvent_CheckPlayerFacingDirection). */
export function bgFacingMatches(required: BgEvent['facing'], facing: Facing): boolean {
  if (required === 'any') return true;
  if (required === 'horizontal') return facing === 'left' || facing === 'right';
  if (required === 'vertical') return facing === 'up' || facing === 'down';
  return required === facing;
}

function inputDir(input: InputFrame): Facing | null {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  return dirs.find((d) => input.pressed.includes(d)) ?? dirs.find((d) => input.held.includes(d)) ?? null;
}

export type WorldDeps = Parameters<CreateWorld>[0];

export const createWorld: CreateWorld = (deps) => new FieldWorld(deps.registries, deps.state, deps.scripts, deps.log, deps.battles, deps.clock, deps.audio, deps.mapLoaded, deps.followers ?? (() => true), deps.followerWalkInPlace ?? (() => false), deps.autoRun ?? (() => false), deps.hgssCharacter ?? (() => false));

/**
 * Seed of an object's own PRNG stream: FNV-1a over zone and local id, mixed with the game seed. Not the
 * spawn tick, so arriving a few ticks later does not move an NPC (our choice: the DS rolls its global
 * LCRNG). Every spawn of the same object restarts the same stream.
 */
function wanderSeed(gameSeed: number, zone: Id, localId: number): number {
  let h = 0x811c9dc5;
  for (const c of `${zone}#${localId}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h ^ Math.imul(gameSeed, 0x9e3779b1)) >>> 0;
}

export class FieldWorld implements OpenSinnohWorld {
  private zone!: Zone;
  private grid!: MapGrid;
  /** Trainers that spotted the player (slot order), kept for trainerApproach; and the running approaches. */
  private sighting: Omit<Approach, 'phase' | 'walked'>[] = [];
  private approaches: Approach[] = [];
  private obstacleTicks = 0;
  /** Decomp wildBattleMetadata.encounterAttempts: reset on battles and on map and zone changes (not saved). */
  private encounterAttempts = { count: 0 };
  /** The first foe of the wild battle the field started (decomp WildEncounter task), until it ends (roamersAfterBattle). */
  private wildFoe: Id | null = null;
  /** The player's tile at the last zone-connection check. */
  private lastTile = '';
  /** Area of the zone of the last map load; kept across zone connections (decomp FieldMap_Init). */
  private area!: Id;
  private events!: ZoneEvents;
  private actors = new Map<number, Actor>();
  private hero!: Actor;
  private camera: Actor | null = null;
  /** False for AddCameraOverrideObject: the camera object only paces a wait; the view stays on the player. */
  private cameraTracks = true;
  private locked = false;
  private lockedObjects = new Set<number>();
  /** Player completed a step this tick (read by the next checkTriggers). */
  private stepCompleted = false;
  /** DS "moving" state: a held direction keeps walking without a turn-in-place. */
  private moving = false;
  private storyScene: FieldView['storyScene'] | null = null;
  private containment: ContainmentUnits | null = null;
  private warpState: Warp | null = null;
  private fadeAnim: Fade | null = null;
  private fadeAlpha = 0;
  private fadeColor: 'black' | 'white' = 'black';
  private loads = 0;
  /** Zone connections so far, and the objects the latest one deleted (FieldView.departed; null after a map load). */
  private crossings = 0;
  private departed: FieldView['departed'] | null = null;
  /** Every object event of the zones in the matrix's cells, for FieldView.previews (built once per matrix). */
  private matrixEvents: { matrix: Id; events: { zone: Id; ev: ObjectEvent }[] } | null = null;
  private cameraYHistory: number[] = [];
  private cameraCur: Vec3 = [0, 0, 0];
  private cameraPrev: Vec3 = [0, 0, 0];
  /** Door props animating or held open; an `open` stays until its `close` ends. Cleared by a map load. */
  private doors: DoorAnim[] = [];
  /** `moveCamera` offset (decomp Camera_Move); kept until the next map load. */
  private cameraOffset: Vec3 = [0, 0, 0];
  /** Terrain-driven field effects (FieldView.effects) and the player avatar (walk/cycle/surf, HM tasks). */
  private readonly effects: Effects;
  /** Walks whose start the grass hook has seen. */
  private readonly grassSeen = new WeakSet<Motion>();
  private readonly avatar: Avatar;
  /** The last warp event that fired (decomp FieldOverworldState entrance location); not saved. */
  private entrance: Location | null = null;
  private fishing: FishingTask | null = null;
  private shake: ShakeTask | null = null;
  private elevatorRide: ElevatorRide | null = null;
  /** The healing machine task (heal-machine.ts) while it runs; cleared by a map load. */
  private healMachine: HealMachine | null = null;
  /** A boat trip under way (boat.ts), and the ship placement it moves. */
  private boat: BoatTrip | null = null;
  /** The gate's binoculars (great-marsh-lookout.ts) while they run. */
  private lookout: GreatMarshLookout | null = null;
  /** This tick's input (the binoculars end a view on A). */
  private lookoutInput: InputFrame | null = null;
  private boatShip: Vec3 | null = null;
  /** The camera shake's x shift (scr_cmd_29f), drawn only; a map load clears it. */
  private cameraShake = 0;
  /** The boat props' placements in the loaded matrix (found once per matrix). */
  private boatSpots: { matrix: Id; spots: ReturnType<FieldWorld['boatPlacements']> } | null = null;
  /** The zone's platform lift (platform-lift.ts), set up by the map load from `GameState.platformLift`. */
  private platformLift: PlatformLift | null = null;
  /** PlayerAvatar height calculation (decomp PlayerAvatar_SetHeightCalculationEnabled); a map load enables it. */
  private heightCalc = true;
  /** Drawn with the heal avatar until the next setPlayerState (setPlayerAvatar), or the Sprayduck one until endWatering. */
  private healAvatar = false;
  /** The contest camera flash's ticks left (`cameraFlash`): presentation only, not saved. */
  private flashTicks = 0;
  /** The flash's brightness now: +4 of 16 at its start, fading to 0. */
  private cameraFlashLevel(): number {
    return (this.flashTicks / CAMERA_FLASH_TICKS) * (4 / 16);
  }
  /** The Sprayduck task (berry-patches.ts) while it runs. */
  private watering: WateringTask | null = null;
  /** The zone's berry soil objects: local id → patch id (berry-patches.ts), per zone. */
  private soil: { zone: Id; objects: Map<number, number> } | null = null;
  /** The map's dynamic feature (gyms/): built from `GameState.mapFeatures` by every map load. */
  private feature: MapFeature | null = null;
  private readonly featureHost: FeatureHost;
  /** Objects the feature owns (Veilstone's bags and stacks): they collide, but are neither drawn nor saved as objects. */
  private readonly featureActors = new Set<Actor>();
  /** The feature's player sprite (Hearthome Gym's avatar), until the next map load. */
  private featureSprite: Id | null = null;
  /** The lead party Pokémon walking behind the player (party-follower.ts): drawn only. */
  private readonly pet: PartyFollower;

  private readonly sound: FieldSound;
  /** The weather's loop sound and lightning (weather-tasks.ts). */
  private readonly weatherTasks: WeatherTasks;
  private cutIn: HmCutIn | null = null;
  /** Fly (`fly`): the cut-in, the map change and the landing; the Pokémon that flies. */
  private flyTask: { task: FlyTask; slot: number } | null = null;
  /** Teleport (`teleport`). */
  private teleportTask: TeleportTask | null = null;
  /** The Poké Radar's chain (poke-radar.ts); null in packs without the special encounters. */
  private readonly radar: PokeRadar | null;
  /**
   * The Poké Radar's field task while its patches shake (RefreshRadarChain states 1–2, FieldTask_WildEncounter state
   * 6): objects paused, no input.
   */
  private radarTask = false;
  /** Sweet Scent or Honey (`sweetScent`) while it runs. */
  private sweet: SweetScentTask | null = null;
  /** The loaded matrix's honey trees and which shake (honey-trees.ts); rebuilt by a map load. */
  private honey: { matrix: Id; shakes: HoneyTreeShakes } | null = null;
  /** The player's chunk when the honey trees were last loaded. */
  private honeyCell: string | null = null;
  /** The Underground's field (underground.ts) while the player is in it; built by the map load. */
  private ug: UndergroundField | null = null;
  /** The Underground kept across a move to or from the secret base (a map load within the visit). */
  private ugKeep: UndergroundField | null = null;
  /** The map change into or out of the Underground (`enterUnderground`, `exitUnderground`) while it runs. */
  private ugTransit: { phase: 'out' | 'in'; zone: Id; x: number; z: number; down: boolean; base?: { facing: Facing; then: () => void } } | null = null;

  constructor(
    private readonly reg: Registries,
    private readonly state: GameState,
    private readonly scripts: ScriptRunner,
    private readonly log: StubLog,
    private readonly battles: Parameters<CreateWorld>[0]['battles'],
    private readonly clock: () => ClockTime,
    private readonly audio: WorldDeps['audio'],
    private readonly mapLoaded: WorldDeps['mapLoaded'],
    followers: () => boolean,
    followerWalkInPlace: () => boolean,
    autoRun: () => boolean,
    private readonly hgssCharacter: () => boolean,
  ) {
    this.sound = new FieldSound(audio, reg, log);
    this.weatherTasks = new WeatherTasks(this.sound);
    this.effects = new Effects(reg, log);
    this.featureHost = this.makeFeatureHost();
    this.avatar = new Avatar({
      reg,
      state,
      log,
      effects: this.effects,
      sound: this.sound,
      cutIn: (slot) => this.hmCutIn(slot),
      cutInDone: () => this.hmCutInDone(),
      hero: () => this.hero,
      autoRun,
      behaviour: (x, z) => this.behaviour(x, z),
      // Decomp TerrainCollisionManager_WillPlayerCollide: the map feature's collision is the player's only.
      blocked: (x, z) => (this.feature?.collides ? this.feature.collides(x, z) : this.tileBlocked(x, z) || !!this.feature?.blocks?.(x, z) || this.dynamicHeightCollision(x, z, this.hero.y)),
      featureJump: (x, z, dir) => !!this.feature?.jumps?.(x, z, dir),
      occupant: (x, z, except) => this.occupant(x, z, except),
      partner: () => (this.state.hasPartner ? this.follower() : null),
      follow: (x, z, ticks) => this.follow(x, z, ticks),
      objectCollision: (a, dir) => this.objectCollision(a, dir),
      heightAt: (wx, wz, cur) => this.heightAt(wx, wz, cur),
      flagBySource: (index) => this.flag(flagId(this.reg, index)),
      breakSnowball: (x, z) => this.breakSnowball(x, z),
      distortion: () => this.distortion(),
    });
    const radar = newGameRecord(reg).specialEncounters?.pokeRadar;
    this.radar = radar ? new PokeRadar({
      behaviour: (x, z) => this.behaviour(x, z),
      tileHeight: (x, z) => this.heightAt(x * TILE, z * TILE, this.hero.y),
      zoneAt: (x, z) => {
        const cell = this.grid.cell(x, z);
        return cell === null ? null : (this.matrix.zones ? this.matrix.zones[cell] ?? null : this.zone.id);
      },
      rand: (n) => {
        const rng = Prng.from(this.state.encounterRng);
        const v = rng.below(n);
        this.state.encounterRng = rng.save();
        return v;
      },
      effectTicks: (effect) => {
        const ticks = this.get('fieldEffects', effect).animations?.['shake']?.ticks;
        if (!ticks) throw new Error(`world: radar patch effect ${effect} has no shake animation`);
        return ticks;
      },
      playBgm: (seq) => this.sound.audio.playBgm(seq),
      restoreBgm: () => this.sound.audio.fadeToBgm(this.sound.audio.effectiveBgm(this.zone.id)),
    }, radar, state) : null;
    this.pet = new PartyFollower({
      reg,
      state,
      hero: () => this.hero,
      zone: () => this.zone,
      enabled: followers,
      walkInPlace: followerWalkInPlace,
      storyPartner: () => this.state.hasPartner || !!this.follower(),
      // Fly recalls it too; the map load then brings it back waiting under the player.
      riding: () => !!this.flyTask || !!this.teleportTask || ['surf', 'dismount', 'waterfall', 'rockClimb'].includes(this.avatar.taskKind() ?? ''),
    });
  }

  // ---------- registry and state helpers ----------

  private get<K extends keyof Registries>(kind: K, id: Id) {
    const r = this.reg[kind].get(id);
    if (!r) throw new Error(`world: missing ${kind} record ${id}`);
    return r as Registries[K] extends ReadonlyMap<Id, infer V> ? V : never;
  }

  private flag(id: Id): boolean {
    return this.state.flags[id] ?? this.get('flags', id).initial;
  }

  private varValue(id: Id): number {
    return this.state.vars[id] ?? this.get('vars', id).initial;
  }

  private spriteFor(ev: ObjectEvent): Id {
    if (typeof ev.sprite === 'string') return ev.sprite;
    const value = this.varValue(ev.sprite.var);
    for (const s of this.reg.sprites.values()) if (s.sourceIndex === value) return s.id;
    throw new Error(`world: object ${ev.localId} sprite var ${ev.sprite.var} = ${value} names no sprite`);
  }

  // ---------- map queries ----------

  private get matrix() {
    return this.grid.matrix;
  }

  /** The Distortion World room's runtime (distortion/), or null outside one. */
  private distortion(): DistortionWorld | null {
    return this.feature instanceof DistortionWorld ? this.feature : null;
  }

  private behaviour(tx: number, tz: number): string {
    return this.grid.behaviour(tx, tz);
  }

  private tileBlocked(tx: number, tz: number): boolean {
    // SecretBases_AreCoordinatesWalkable: the own base's goods (CommPlayer_CheckCollision in the Underground).
    return this.grid.blocked(tx, tz) || !!this.ug?.baseBlocked(tx, tz);
  }

  private heightAt(wx: number, wz: number, current: number): number {
    return this.height(wx, wz, current).y;
  }

  /**
   * Decomp TerrainCollisionManager GetHeight: the BDHC height, unless the map feature's dynamic plate covers
   * the tile above it and is nearer the current height (then `dynamic`). The platform lift's plate stands in
   * for the BDHC on its tiles.
   */
  private height(wx: number, wz: number, current: number): { y: number; dynamic: boolean } {
    const tx = Math.floor(wx / TILE);
    const tz = Math.floor(wz / TILE);
    const lift = this.platformLift?.plateAt(tx, tz);
    if (lift !== undefined && lift !== null) return { y: lift, dynamic: false };
    const bdhc = this.grid.terrainHeight(wx, wz, current);
    const plate = this.feature?.plate?.(tx, tz) ?? null;
    if (plate === null) return { y: bdhc ?? current, dynamic: false };
    if (bdhc === null) return { y: plate, dynamic: true };
    if (plate <= bdhc) return { y: bdhc, dynamic: false };
    return Math.abs(bdhc - current) <= Math.abs(plate - current) ? { y: bdhc, dynamic: false } : { y: plate, dynamic: true };
  }

  /**
   * TerrainCollisionManager_WillPlayerCollide: a DYNAMIC_HEIGHT_COLLISION tile whose height would come from the
   * dynamic plate collides (the Pastoria Gym water).
   */
  private dynamicHeightCollision(tx: number, tz: number, current: number): boolean {
    return this.behaviour(tx, tz) === 'DYNAMIC_HEIGHT_COLLISION' && this.height(tileCentre(tx), tileCentre(tz), current).dynamic;
  }

  /** The props the zone's chunks place on tile x/z (decomp TerrainCollisionHitbox_CollidesWithMapProp, a 1×1 hitbox). */
  private propsAt(tx: number, tz: number): Id[] {
    const out: Id[] = [];
    for (let cell = 0; cell < this.matrix.chunks.length; cell++) {
      const id = this.matrix.chunks[cell];
      if (!id) continue;
      const ox = (cell % this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const oz = Math.floor(cell / this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2;
      for (const pl of this.get('chunks', id).props) {
        const x = ox + pl.position[0];
        const z = oz + pl.position[2];
        if (x >= tx * TILE && x <= (tx + 1) * TILE && z >= tz * TILE && z <= (tz + 1) * TILE) out.push(pl.prop);
      }
    }
    return out;
  }

  private occupant(tx: number, tz: number, except: Actor): Actor | null {
    for (const a of [this.hero, ...this.actors.values()]) {
      if (a === except || a.passThrough) continue;
      // Objects collide only within 2 grid units of height (MapObject Y = height / 8; sub_02063F00): not across
      // Canalave Gym's floors.
      if (Math.abs(Math.trunc(a.y / 8) - Math.trunc(except.y / 8)) >= 2) continue;
      if ((a.x === tx && a.z === tz) || (a.motion?.kind === 'walk' && a.motion.fromX === tx && a.motion.fromZ === tz)) return a;
    }
    return null;
  }

  private warpAt(tx: number, tz: number) {
    return this.events.warps.find((w) => w.x === tx && w.z === tz) ?? null;
  }

  private follower(): Actor | null {
    for (const a of this.actors.values()) if (a.movementType === MOVEMENT_TYPE_FOLLOW_PLAYER) return a;
    return null;
  }

  private resolve(target: number): Actor {
    if (target === LOCALID_PLAYER) return this.hero;
    if (target === LOCALID_CAMERA) {
      if (!this.camera) throw new Error('world: LOCALID_CAMERA used without addFreeCamera');
      return this.camera;
    }
    let a = target === LOCALID_FOLLOWER ? this.follower() : this.actors.get(target);
    // A border stand-in remains addressable, but must yield its id to a native script actor (Looker).
    if (a?.cloneOf) {
      for (const native of this.actors.values()) if (!native.cloneOf && native.localId === target) { a = native; break; }
    }
    if (!a) throw new Error(`world: object ${target} is not present in ${this.zone.id}`);
    return a;
  }

  private eventObject(localId: number): ObjectEvent | undefined {
    return this.events.objects.find((o) => !o.cloneOf && o.localId === localId);
  }

  // ---------- actors ----------

  private newActor(localId: number, sprite: Id | null, x: number, z: number, y: number, facing: Facing, movementType: number, zone: Id = this.zone.id): Actor {
    const a = createActor(localId, sprite, x, z, y, facing, movementType, zone);
    this.applyMovementType(a);
    return a;
  }

  /**
   * (Re)starts the actor's movement type. Types with an update get an origin and their own PRNG stream:
   * restored from `ObjectState.wander`, else the current tile and a seed from (game seed, zone, local id).
   */
  private applyMovementType(a: Actor, saved?: ObjectState['wander']): void {
    const look = LOOK_TYPES[a.movementType];
    a.look = look ?? null;
    a.type = null;
    if (hasTypeState(a.movementType)) {
      a.type = {
        originX: saved?.originX ?? a.x,
        originZ: saved?.originZ ?? a.z,
        rng: saved ? { ...saved.rng } : { seed: wanderSeed(this.state.seed, a.zone, a.localId) },
        initial: a.facing,
        phase: 'start',
        timer: 0,
        returning: false,
        loop: 0,
      };
    }
    if (DISGUISE_TYPES.has(a.movementType)) a.lift = DISGUISE_DEPTH;
    // The follow type's init and every update set MAP_OBJ_STATUS_18 (sub_02069BE0, sub_02069C0C); nothing clears it on a switch.
    if (a.movementType === MOVEMENT_TYPE_FOLLOW_PLAYER) a.passThrough = true;
    if (!isKnownType(a.movementType)) this.log.stub(`movement-type:${a.movementType}`, 'treated as static');
  }

  /**
   * A zone may list two objects with the same local id (Platinum: Twinleaf Town and Route 201 signposts).
   * The DS spawns both and finds the first by local id; the duplicate is kept under a key no local id uses.
   */
  private spawn(ev: ObjectEvent, duplicateKey?: number, zone: Id = this.zone.id, saved?: ObjectState): Actor {
    const a = createActor(ev.localId, this.spriteFor(ev), saved?.x ?? ev.x, saved?.z ?? ev.z, saved?.y ?? ev.y, saved?.facing ?? ev.facing, saved?.movementType ?? ev.movementType, zone);
    if (saved?.passThrough) a.passThrough = true;
    a.trainerType = ev.trainerType;
    if (ev.trainer) a.trainer = ev.trainer;
    a.sight = ev.data[0];
    a.range = { ...ev.range };
    this.applyMovementType(a, saved?.wander);
    if (a.type) a.type.initial = ev.facing;
    if (ev.label) a.label = ev.label;
    if (ev.hideFlag) a.hideFlag = ev.hideFlag;
    if (ev.cloneOf) a.cloneOf = ev.cloneOf;
    if (ev.cloneLocalId !== undefined) a.cloneLocalId = ev.cloneLocalId;
    if ('when' in ev) {
      // A Distortion World object (AddMapObjectFromEvent): persistent, at its own height, turned when the event says.
      a.persistent = true;
      a.heightFixed = true;
      a.roll = (ev as DwObject).rotation ?? 0;
    } else a.y = this.heightAt(a.cur[0], a.cur[2], a.y);
    a.cur[1] = a.prev[1] = a.y;
    this.sink(a);
    if ('when' in ev) {
      this.actors.set(this.distortionKey(a), a);
      return a;
    }
    let key = ev.localId;
    if (this.actors.has(key)) {
      if (duplicateKey === undefined) throw new Error(`world: object ${ev.localId} already spawned in ${this.zone.id}`);
      key = duplicateKey;
    }
    this.actors.set(key, a);
    return a;
  }

  /**
   * The key of a Distortion World object: its local id on the current floor (scripts find it by that), else one no
   * local id uses (the floor below lists the same ids; decomp MapObjMan_LocalMapObjByIndex finds the first).
   */
  private distortionKey(a: Actor): number {
    if (a.zone === this.zone.id && !this.actors.has(a.localId)) return a.localId;
    let key = -0x20000;
    while (this.actors.has(key)) key--;
    return key;
  }

  /** After a floor change: the new current floor's objects take their local ids as keys. */
  private rekeyDistortionObjects(): void {
    const dw = [...this.actors].filter(([, a]) => a.heightFixed);
    for (const [key] of dw) this.actors.delete(key);
    const order = [...dw.filter(([, a]) => a.zone === this.zone.id), ...dw.filter(([, a]) => a.zone !== this.zone.id)];
    for (const [, a] of order) this.actors.set(this.distortionKey(a), a);
  }

  private spawnSaved(saved: Pick<GameState, 'objects' | 'follower'>): void {
    const used = new Set<string>();
    const f = saved.follower;
    for (const o of saved.objects) {
      if (f && o.localId === f.localId && o.movementType === MOVEMENT_TYPE_FOLLOW_PLAYER) {
        // The follower came from another zone: its sprite and talk script are saved with it.
        const a = this.newActor(o.localId, f.sprite, o.x, o.z, o.y, o.facing, o.movementType, o.zone);
        if (f.label) a.label = f.label;
        a.persistent = true;
        a.look = null;
        this.actors.set(this.actors.has(o.localId) ? -1 - this.events.objects.length : o.localId, a);
        continue;
      }
      // An object kept from a neighbouring zone takes its sprite and script from that zone's event.
      const events = this.reg.distortionRooms.get(o.zone)?.objects ?? (o.zone === this.zone.id ? this.events.objects : this.get('zones', o.zone).events.objects);
      const i = this.savedEvent(events, o, (k) => !used.has(`${o.zone}#${k}`));
      if (i < 0) throw new Error(`world: saved object ${o.localId}${o.cloneOf ? ` (clone of ${o.cloneOf})` : ''} has no event in ${o.zone}`);
      used.add(`${o.zone}#${i}`);
      this.spawn(events[i]!, -1 - i, o.zone, o);
    }
    // Saved objects are past their movement type's first update: keep their saved facing.
    for (const a of this.actors.values()) a.look = null;
  }

  /**
   * The event of a saved object: a clone by `ObjectState.cloneOf`, since its zone may list an object of
   * its own under the same local id (Eterna City: the Route 205 arrow signpost and a Galactic grunt).
   * Saves before contracts 0.27.9 mark no clone: there the zone's own object is taken unless its flag
   * hides it and a clone has the id (an object is not spawned hidden).
   */
  private savedEvent(events: readonly ObjectEvent[], o: ObjectState, free: (index: number) => boolean): number {
    const candidates = [...events.keys()].filter((k) => events[k]!.localId === o.localId && free(k));
    if (o.cloneOf) return candidates.find((k) => events[k]!.cloneOf === o.cloneOf) ?? -1;
    const own = candidates.find((k) => !events[k]!.cloneOf);
    const clone = candidates.find((k) => events[k]!.cloneOf);
    if (own === undefined) return clone ?? -1;
    const hidden = events[own]!.hideFlag !== undefined && this.flag(events[own]!.hideFlag);
    return hidden && clone !== undefined ? clone : own;
  }

  /** Spawns a zone's event objects that are not hidden or already present (the persistent follower). */
  private spawnAll(skip: (ev: ObjectEvent) => boolean): void {
    this.events.objects.forEach((ev, i) => {
      if ((ev.hideFlag && this.flag(ev.hideFlag)) || skip(ev)) return;
      this.spawn(ev, -1 - i);
    });
  }

  /** Starts the next scripted action when the actor is free. */
  private nextScripted(a: Actor): void {
    const s = a.script;
    if (!s || a.motion) return;
    while (s.index < s.steps.length) {
      const step = s.steps[s.index]!;
      if (s.done >= step.count) {
        s.index++;
        s.done = 0;
        continue;
      }
      s.done++;
      const action = parseAction(step.op);
      if (action?.kind === 'pose' && !this.hasPose(a, action.pose)) {
        // The DS sets the anim code anyway; a sprite without that animation shows its standing frame.
        this.log.stub(`pose:${action.pose}`, `sprite ${a.sprite} has no pose-${action.pose}: drawn standing`);
        wait(a, action.ticks, 'script');
      } else if (action) startAction(a, action);
      else {
        this.log.stub(`movement:${step.op}`, 'skipped (1 tick)');
        wait(a, 1, 'script');
      }
      return;
    }
    a.script = null;
  }

  private hasPose(a: Actor, pose: string): boolean {
    const sprite = a.sprite ? this.get('sprites', a.sprite) : null;
    return !!sprite && 'animations' in sprite && Object.keys(sprite.animations).some((k) => k === `pose-${pose}` || k.startsWith(`pose-${pose}-`));
  }

  /** The movement type's update (decomp MapObject_Move): runs while unpaused and between movement actions. */
  private updateMovementType(a: Actor): void {
    if (a.paused || a.script || a.motion) return;
    if (!a.look) return updateType(a, this.typeHost);
    if (!a.dirLocked) a.facing = a.look;
    a.look = null;
  }

  private readonly typeHost: TypeHost = {
    collision: (a, dir) => this.objectCollision(a, dir),
    runningPlayer: (a) => {
      const p = this.hero;
      if ((a.trainerType !== 1 && a.trainerType !== 2) || p.motion?.anim !== 'run') return null;
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      return Math.abs(dx) <= a.sight && Math.abs(dz) <= a.sight ? { dx, dz } : null;
    },
    partner: (a) => {
      if (!a.trainer) return null;
      for (const o of this.actors.values()) if (o !== a && o.zone === a.zone && o.trainer?.id === a.trainer.id) return o;
      return null;
    },
    log: (key, detail) => this.log.stub(key, detail),
  };

  /**
   * Collision bits for an object's step (decomp sub_02063E18): 1 = outside its movement range around the
   * origin (inclusive, -1 = unlimited), 2 = blocked tile or a directional wall (sub_02064004: BLOCK_* on
   * this tile's side or the next tile's), 4 = another object (current or previous tile).
   */
  private objectCollision(a: Actor, dir: Facing): number {
    const [dx, dz] = DELTA[dir];
    const nx = a.x + dx;
    const nz = a.z + dz;
    let bits = 0;
    const t = a.type;
    if (t) {
      const out = (d: number, r: number) => r !== -1 && Math.abs(d) > r;
      if (out(nx - t.originX, a.range.x) || out(nz - t.originZ, a.range.z)) bits |= 1;
    }
    if (this.tileBlocked(nx, nz) || blocksMovement(this.behaviour(a.x, a.z), dir) || blocksMovement(this.behaviour(nx, nz), OPPOSITE[dir])) bits |= 2;
    if (this.occupant(nx, nz, a)) bits |= 4;
    return bits;
  }

  private updatePosition(a: Actor): void {
    const override = a === this.hero ? this.avatar.positionOverride() : null;
    if (override) {
      a.cur = [...override];
      return;
    }
    const [wx, wz] = actorXZ(a);
    // A step that moves the height itself (Distortion World walls and jumps) keeps it: no height is calculated.
    const authored = a.motion?.kind === 'walk' && a.motion.fromY !== undefined;
    a.y = a === this.camera || (a === this.hero && !this.heightCalc) || a.heightFixed || authored ? a.y : this.heightAt(wx, wz, a.y);
    // A Distortion World jump arcs on its own axis, the other way when inverted.
    const m = a.motion;
    const arc = jumpHeight(a) * (m?.jumpInverted ? -1 : 1);
    const axis = m?.jumpAxis ?? 'y';
    a.cur = [wx + a.offset[0] + (axis === 'x' ? arc : 0), actorY(a) + (axis === 'y' ? arc : 0) + a.lift + a.offset[1], wz + a.offset[2] + (axis === 'z' ? arc : 0)];
  }

  // ---------- map load ----------

  /**
   * A map load deletes every object, the follower too (decomp FieldMapChange_DeleteObjects); the new
   * map spawns from its events, so a map a partner walks into lists its own object for them (Lake
   * Verity's LOCALID_RIVAL). Persistence matters only for zone connections.
   */
  private loadMap(zoneId: Id, x: number, z: number, y: number, facing: Facing, saved: Pick<GameState, 'objects' | 'follower'> | null = null, savedPet: GameState['partyFollower'] | null = null): void {
    // 1. clear map-local flags and vars, except when loading a save (decomp FieldTask_LoadSavedGameMap does
    // not call FieldMapChange_UpdateGameData: a smashed rock stays gone across a save and load)
    if (!saved) {
      for (const f of this.reg.flags.values()) if (f.scope === 'map') delete this.state.flags[f.id];
      for (const v of this.reg.vars.values()) if (v.scope === 'map') delete this.state.vars[v.id];
      // FieldMapChange_UpdateGameData: a warp clears the persisted map features.
      this.state.mapFeatures = null;
    }
    this.feature = null;
    this.containment = null;
    this.storyScene = null;
    this.featureActors.clear();
    // FieldMapChange (a warp) and a new field (a load) clear the Poké Radar's chain.
    this.radar?.clear();
    this.radarTask = false;
    this.sweet = null;
    this.featureSprite = null;

    this.zone = this.get('zones', zoneId);
    // A save keeps its weather (the DS does not run FieldMapChange_UpdateGameData when continuing).
    if (!saved) this.state.weather = this.mapChangeWeather(this.zone);
    // Decomp FieldMapChange_UpdateGameData on a warp: a blackout spawn's map becomes the blackout destination.
    if (!saved && this.zone.blackOut) this.state.blackOut = this.zone.id;
    // The DS loads the matrix with the map, with its game-state edits (Matrix.variants).
    this.grid = new MapGrid(this.reg, loadedMatrix(this.reg.matrices, this.get('matrices', this.zone.matrix), (id) => this.varValue(id)), gridOffset(this.reg, this.zone.id));
    this.area = this.zone.area;
    this.events = structuredClone(this.zone.events) as ZoneEvents;
    this.actors.clear();
    this.departed = null;
    this.lockedObjects.clear();
    this.sighting = [];
    this.approaches = [];
    this.encounterAttempts.count = 0;
    this.lastTile = `${x},${z}`;
    this.camera = null;
    this.doors = [];
    const honey = newGameRecord(this.reg).specialEncounters?.honeyTrees;
    this.honey = honey ? { matrix: this.matrix.id, shakes: new HoneyTreeShakes(honeyTreePlacements(this.reg, this.matrix.id, honey, this.zone.id), this.matrix.width) } : null;
    this.honeyCell = null;
    this.hero = this.newActor(LOCALID_PLAYER, this.playerSprite(), x, z, y, facing, 1);
    // The player stands at the terrain height nearest `y`: a loaded save's saved height (the DS restores the
    // player's position, y included), which picks the floor where terrain is layered (Canalave Gym, a path under
    // a bridge, the Hall of Origin's upper floor); a warp (y 0) arrives on the lowest.
    // A Distortion World save may stand on a wall or ceiling above other land: it keeps its height.
    this.hero.y = saved && this.reg.distortionRooms.has(zoneId) ? y : this.heightAt(tileCentre(x), tileCentre(z), y);
    this.moving = false;
    this.shake = null;
    this.elevatorRide = null;
    this.healMachine = null;
    this.platformLift = null;
    this.heightCalc = true;
    this.healAvatar = false;
    this.syncState();

    // 2. onTransition (may set object graphics vars and edit events); not when loading a save (decomp
    // FieldTask_LoadSavedGameMap runs no FieldMapChange_UpdateGameData, so no INIT_SCRIPT_ON_TRANSITION)
    if (this.zone.mapScripts.onTransition && !saved) this.scripts.runImmediate({ label: this.zone.mapScripts.onTransition, zone: zoneId, source: 'transition' });
    // 3. spawn objects
    if (saved) this.spawnSaved(saved);
    else this.spawnAll(() => false);
    // 4. onLoad
    if (this.zone.mapScripts.onLoad) this.scripts.runImmediate({ label: this.zone.mapScripts.onLoad, zone: zoneId, source: 'load' });
    // 5. the zone's map features (decomp PlatformLift_DynamicMapFeaturesInit: the lift and its plate at the saved floor)
    this.loadPlatformLift();
    this.feature = createMapFeature(this.featureHost);
    if (this.heightCalc) this.hero.y = this.heightAt(tileCentre(x), tileCentre(z), this.hero.y);
    // 6. onResume (decomp FieldMap_Init runs INIT_SCRIPT_ON_RESUME on every field map load, a save's too)
    this.avatar.reset();
    if (this.zone.mapScripts.onResume) this.scripts.runImmediate({ label: this.zone.mapScripts.onResume, zone: zoneId, source: 'resume' });
    this.pet.reset(savedPet);
    // A move to or from the secret base keeps the visit's Underground (SecretBases_MoveToFromSecretBaseTask).
    this.ug = this.ugKeep ?? this.newUndergroundField(!!saved);
    this.ugKeep = null;

    for (const a of this.allActors()) {
      this.updatePosition(a);
      a.prev = [...a.cur];
    }
    this.cameraYHistory = [];
    this.updateCamera();
    this.cameraPrev = [...this.cameraCur];
    this.loads++;
    this.cameraOffset = [0, 0, 0];
    this.cameraShake = 0;
    for (const a of this.allActors()) {
      this.grass(a, 'place');
      this.sink(a);
    }
    this.syncState();
    // FieldTask_ChangeMapByLocation (the binoculars' temporary map changes) plays no map BGM.
    if (!this.lookout) this.mapLoaded?.(zoneId, this.loads);
  }

  /**
   * The grass effect of an object's tile (map_object_move.c step hooks, `grassRenderer`): held on the tile
   * while the object stands there. Objects without a sprite (the free camera) have no draw and no hooks.
   */
  private grass(a: Actor, hook: 'place' | 'walk' | 'land'): void {
    if (a.sprite === null) return;
    const renderer = grassRenderer(this.behaviour(a.x, a.z), hook);
    if (renderer === null) return;
    const at: Vec3 = [tileCentre(a.x), this.heightAt(tileCentre(a.x), tileCentre(a.z), a.y), tileCentre(a.z)];
    this.effects.add(renderer, 'rustle', at, { held: { who: a, x: a.x, z: a.z, settled: hook === 'place' } });
  }

  /**
   * The date yearly weathers read (decomp FieldSystem_GetWeather): the saved clock's, or January 2 while the
   * clock-change penalty runs.
   */
  private readonly date = () => {
    const t = this.state.gameTime;
    return t.penaltyMinutes > 0 ? `${t.now.date.slice(0, 4)}-01-02` : t.now.date;
  };

  /** The battle palette: the saved clock's period (decomp FieldSystem_GetTimeOfDay → the background offset). */
  private battleTime() {
    return battleTime(dayPeriod(this.state.gameTime.now.hour));
  }

  private mapChangeWeather(zone: Zone): Id {
    return mapChangeWeather(this.reg, zone, this.date, (index) => {
      for (const fl of this.reg.flags.values()) if (fl.sourceIndex === index) return this.flag(fl.id);
      throw new Error(`world: no flag with sourceIndex ${index}`);
    });
  }

  /** The avatar sprite of the player state (decomp PlayerAvatar gfx per PLAYER_AVATAR_WALKING/CYCLING/SURFING). */
  private playerSprite(): Id {
    if (this.featureSprite) return this.featureSprite;
    const dw = this.distortion();
    if (dw) return dw.sprite(this.state);
    const ng = newGameRecord(this.reg);
    const set = this.state.playerState === 'cycle' ? ng.playerCycleSprite : this.state.playerState === 'surf' ? ng.playerSurfSprite : ng.playerSprite;
    // The HGSS look (OpenSinnoh option, the add-on's sprites): on foot and on the bicycle; every other look stays Platinum's.
    if (this.hgssCharacter() && this.state.playerState !== 'surf') {
      const hgss = HGSS_PLAYER_SPRITES[this.state.playerState === 'cycle' ? 'cycle' : 'walk'][this.state.gender] as Id;
      if (this.reg.sprites.has(hgss)) return hgss;
    }
    return set[this.state.gender];
  }

  /** Decomp MapObject_SinkIntoTerrain: the sprite sinks into mud and deep snow (not the player escaping deep mud). */
  private sink(a: Actor): void {
    a.sink = a === this.hero && this.avatar.noSink() ? 0 : sinkDepth(this.behaviour(a.x, a.z));
  }

  // ---------- boat trips (boat.ts) ----------

  /** The boat props the chunks of this matrix place (world units), with their prop and model rotation. */
  private boatPlacements(): { prop: Id; position: Vec3; rotation: Vec3; kind: 'ship' | 'bridge-0' | 'bridge-1' }[] {
    if (this.boatSpots?.matrix === this.matrix.id) return this.boatSpots.spots;
    const boat = newGameRecord(this.reg).boat;
    if (!boat) return [];
    const out: ReturnType<FieldWorld['boatPlacements']> = [];
    for (let cell = 0; cell < this.matrix.chunks.length; cell++) {
      const id = this.matrix.chunks[cell];
      if (!id) continue;
      const ox = (cell % this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const oz = Math.floor(cell / this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const altitude = (this.matrix.altitudes?.[cell] ?? 0) * 8;
      for (const pl of this.get('chunks', id).props) {
        const kind = (pl.prop === boat.ship || pl.prop === boat.snowpointShip) ? 'ship' : pl.prop === boat.bridges[0] ? 'bridge-0' : pl.prop === boat.bridges[1] ? 'bridge-1' : null;
        if (kind) out.push({ prop: pl.prop, position: [ox + pl.position[0], altitude + pl.position[1], oz + pl.position[2]], rotation: [...pl.rotation], kind });
      }
    }
    this.boatSpots = { matrix: this.matrix.id, spots: out };
    return out;
  }

  /** `FieldView.props`: the boat props, the ship moved and the bridges posed by a departing trip. */
  private boatProps(): FeatureModelView[] {
    const trip = this.boat;
    return this.boatPlacements().map((p, i) => {
      const view: FeatureModelView = { key: `boat-${i}`, prop: p.prop, position: p.position, rotation: p.rotation };
      const loop = this.get('props', p.prop).animations?.loop;
      if (p.kind === 'ship' && loop?.loop) view.clip = { name: loop.clip, tick: this.state.tick % loop.ticks };
      if (trip && p.kind === 'ship' && this.boatShip && this.boatShip.every((v, k) => v === p.position[k])) {
        view.position = [0, 1, 2].map((k) => p.position[k]! + trip.shipOffset[k]!) as Vec3;
      }
      if (trip?.bridges && p.kind !== 'ship') view.clip = { name: BRIDGE_CLIP, tick: trip.bridges[p.kind === 'bridge-0' ? 0 : 1] };
      return view;
    });
  }

  playBoatCutscene(travelDir: number, exit: Facing, zone: Id, x: number, z: number): void {
    if (this.boat) throw new Error('world: a boat trip is already under way');
    this.get('zones', zone);
    const boat = newGameRecord(this.reg).boat;
    if (!boat) throw new Error('world: play_boat_cutscene needs NewGame.boat (the import reads the boat props)');
    this.boatShip = null;
    this.boat = new BoatTrip(
      {
        ship: () => {
          // FieldSystem_FindCollidingLoadedMapPropByModelID with the hitbox (x + 1, z − 3) sized 3 × 6 tiles.
          const p = this.hero;
          const snowpoint = travelDir === BOAT_TRAVEL_DIR.westToEast;
          const [x0, z0] = [(p.x + (snowpoint ? -2 : 1)) * TILE, (p.z + (snowpoint ? 2 : -3)) * TILE];
          const ship = this.boatPlacements().find((b) => b.prop === (snowpoint ? boat.snowpointShip : boat.ship) && b.position[0] >= x0 && b.position[0] <= x0 + (snowpoint ? 6 : 3) * TILE && b.position[2] >= z0 && b.position[2] <= z0 + (snowpoint ? 3 : 6) * TILE);
          if (!ship) throw new Error(`world: no ship by the player at ${p.x},${p.z}`);
          this.boatShip = ship.position;
          return ship.position;
        },
        bridgeFrames: () => boat.bridges.map((b) => {
          const clip = this.get('props', b).animations?.[BRIDGE_CLIP];
          if (!clip) throw new Error(`world: bridge prop ${b} has no ${BRIDGE_CLIP} clip`);
          return clip.ticks;
        }) as [number, number],
        cinematicFrames: (dir) => {
          const frames = boat.cinematicFrames[dir];
          if (frames === undefined) throw new Error(`world: no boat cinematic for travel direction ${dir}`);
          return frames;
        },
        fade: (kind, ticks) => this.fade(kind, ticks, 'black'),
        fadeDone: () => this.fadeAnim === null,
        changeMap: (to, mx, mz, facing) => this.startWarp(to, mx, mz, facing, false),
        warpDone: () => this.warpState === null,
      },
      travelDir,
      exit,
      zone,
      x,
      z,
    );
  }

  boatCutsceneDone(): boolean {
    return this.boat === null;
  }

  private stepBoat(): void {
    const b = this.boat;
    if (!b) return;
    const before = this.loads;
    b.step();
    // The detached camera target (Camera_TrackTarget on the boat's camera position) until the map changes.
    if (this.loads === before && !this.warpState) this.cameraOffset = [...b.cameraOffset];
    if (b.done()) this.boat = null;
  }

  /** The zone's platform lift at its saved floor (decomp PlatformLift_DynamicMapFeaturesInit). */
  private loadPlatformLift(): void {
    const lift = liftOf(this.zone.id);
    if (lift < 0) return;
    const data = this.state.platformLift;
    if (data?.lift !== lift) throw new Error(`world: ${this.zone.id} has a platform lift but GameState.platformLift is ${JSON.stringify(data)} (its onTransition sets it)`);
    const props = newGameRecord(this.reg).platformLiftProps;
    // Without the prop records (a pack slice) the lift and its plate still work; only the prop is not moved.
    if (!props) this.log.stub('platform-lift-prop', 'no NewGame.platformLiftProps: the lift prop is drawn where the map places it');
    const at = LIFTS[lift]!.loadedAt ?? (props ? this.liftPlacement() : [0, 0]);
    this.platformLift = new PlatformLift(lift, data, at);
  }

  /** Where the zone's chunks place the lift prop (world units x, z). */
  private liftPlacement(): [number, number] {
    const prop = this.liftProp();
    for (let cell = 0; cell < this.matrix.chunks.length; cell++) {
      const id = this.matrix.chunks[cell];
      if (!id || (this.matrix.zones && this.matrix.zones[cell] !== this.zone.id)) continue;
      for (const pl of this.get('chunks', id).props) {
        if (pl.prop !== prop) continue;
        return [(cell % this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2 + pl.position[0], Math.floor(cell / this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2 + pl.position[2]];
      }
    }
    throw new Error(`world: ${this.zone.id} places no ${prop}`);
  }

  /** The lift prop: NewGame.platformLiftProps by lift kind. */
  private liftProp(): Id {
    const props = newGameRecord(this.reg).platformLiftProps;
    if (!props) throw new Error('world: no NewGame.platformLiftProps');
    return props[LIFTS[liftOf(this.zone.id)]!.kind === 'iron-island' ? 'ironIsland' : 'pokemonLeague'];
  }

  /** Every actor that moves and is drawn: the player, the objects, the free camera and the party follower. */
  private allActors(): Actor[] {
    return [this.hero, ...this.actors.values(), ...(this.camera ? [this.camera] : []), ...(this.pet.actor ? [this.pet.actor] : [])];
  }

  private syncState(): void {
    const p = this.hero;
    this.state.player = { zone: this.zone.id, x: p.x, z: p.z, y: p.y, facing: p.facing };
    this.state.objects = [...this.actors.values()].filter((a) => !this.featureActors.has(a)).map((a) => ({
      zone: a.zone,
      ...(a.type ? { wander: { originX: a.type.originX, originZ: a.type.originZ, rng: { ...a.type.rng } } } : {}),
      localId: a.localId,
      ...(a.cloneOf ? { cloneOf: a.cloneOf } : {}),
      x: a.x,
      z: a.z,
      y: a.y,
      facing: a.facing,
      movementType: a.movementType,
      ...(a.passThrough ? { passThrough: true } : {}),
    }));
    const f = this.follower();
    this.state.follower = f ? { zone: f.zone, localId: f.localId, x: f.x, z: f.z, y: f.y, facing: f.facing, movementType: f.movementType, sprite: f.sprite!, ...(f.label ? { label: f.label } : {}) } : null;
    this.state.partyFollower = this.pet.saved();
    this.distortion()?.setMovingDir(this.avatar.movingDir);
  }

  private updateCamera(): void {
    // The secret base's decoration looks at the room from (15, 17) (UndergroundPC_MoveCamera).
    const decorating = this.ug?.decorationCamera();
    if (decorating) {
      this.cameraCur = decorating;
      return;
    }
    const t = this.camera && this.cameraTracks ? this.camera : this.hero;
    this.cameraYHistory.push(t.cur[1]);
    while (this.cameraYHistory.length > CAMERA_Y_DELAY + 1) this.cameraYHistory.shift();
    this.cameraCur = [t.cur[0], this.cameraYHistory[0]!, t.cur[2]];
  }

  // ---------- World ----------

  /**
   * A loaded save restores its live objects (positions, facing, movement types; sprite and script from
   * the zone's event with that local id), none if it had none. An arrival (a new game, a replay's warp)
   * spawns from the events.
   */
  enter(entry: MapEntry): void {
    const p = this.state.player;
    const load = entry === 'load';
    // A loaded save puts the party follower back where it stood.
    const pet = load && this.state.partyFollower ? { ...this.state.partyFollower } : null;
    const saved = load ? structuredClone({ objects: this.state.objects, follower: this.state.follower }) : null;
    // An arrival runs FieldMapChange_UpdateGameData(0) (a new game, the clear's continue): its FieldSystem_InitFlagsWarp
    // unlocks the fly location. A loaded save does not.
    if (!load) unlockFlyLocation(this.state, this.get('zones', p.zone));
    this.loadMap(p.zone, p.x, p.z, p.y, p.facing, saved, pet);
    // A state from before yearly weathers were resolved (a v3 save) carries the header's yearly value.
    const w = this.get('weathers', this.state.weather);
    if (w.yearly || w.pending?.includes('yearly')) this.state.weather = yearlyWeather(this.reg, w, this.date).id;
    this.fadeAlpha = 1;
    this.fadeColor = 'black';
    this.fade('in', WARP_FADE_TICKS, 'black');
  }

  /**
   * Between steps and on a tile that forces no movement: the DS player move state is END or NONE, so the
   * start menu (and saving) is open. On ice, bike slopes and ramps it stays MOVING (decomp
   * PlayerAvatar_UpdatePlayerMoveState), even between forced steps, so a slide cannot be saved mid-way.
   */
  idle(): boolean {
    return this.settled() && !this.avatar.onForcingTile();
  }

  /** No step, warp, fade, avatar task or script movement in progress. */
  private settled(): boolean {
    if (this.storyScene) return false;
    if (this.containment && !this.containment.done()) return false;
    if (this.fishing || this.watering || this.boat || this.lookout || this.warpState || this.ugTransit || this.ug?.busy() || this.flyTask || this.teleportTask || this.fadeAnim || this.radarTask || this.sweet || !this.avatar.idle() || this.feature?.busy()) return false;
    for (const a of this.allActors()) {
      if (a.script) return false;
      if (a.motion && a.motion.source !== 'type' && !(a === this.hero && a.motion.source === 'input' && a.motion.kind !== 'walk')) return false;
    }
    return true;
  }

  checkTriggers(input: InputFrame): void {
    if (this.scripts.running() || !this.settled()) return;
    const stepped = this.stepCompleted;
    this.stepCompleted = false;
    const zone = this.zone.id;
    const p = this.hero;

    for (const row of this.zone.mapScripts.onFrame) {
      if (this.varValue(row.var) === row.value) return this.scripts.start({ label: row.label, zone, source: 'frame' });
    }

    // Trainer sight comes right after the frame scripts (decomp FieldInput_Process).
    if (this.checkTrainerSight()) return;

    // On a forcing tile the player move state is MOVING: FieldInput_Update sets no A, sign, map
    // transition or step-event input (the step that ends on ice fires no coord event or warp).
    if (this.avatar.onForcingTile()) return;

    const [dx, dz] = DELTA[p.facing];
    const fx = p.x + dx;
    const fz = p.z + dz;
    if (input.pressed.includes('a')) {
      // The Underground's own A (UndergroundMan_ProcessInteract): traps, mining spots, the base's PC and goods, vendors,
      // buried spheres.
      if (this.ug?.interact()) return;
      // Over a counter (TILE_BEHAVIOR_TABLE) the object one tile further is talked to (decomp sub_0203C9D4: nurses, clerks).
      const counter = this.grid.behaviour(fx, fz) === 'TABLE';
      const ox = counter ? fx + dx : fx;
      const oz = counter ? fz + dz : fz;
      const dw = this.distortion();
      // Field_DistortionInteract: in the Distortion World the object one step ahead in 3D (any surface).
      const ahead = dw?.facingTile();
      const obj = ahead
        ? [...this.actors.values()].find((a) => a.x === ahead.x && a.z === ahead.z && Math.trunc(Math.trunc(a.y / 8) / 2) === ahead.y && a.visible)
        : [...this.actors.values()].find((a) => a.x === ox && a.z === oz && a.visible);
      if (obj?.label) return this.scripts.start({ label: obj.label, zone, lastTalked: obj.localId, source: 'object' });
      // Off the land (a support), no background events; the facing tile's behaviour is the support's cell's.
      if (dw && dw.surface() !== 'land') {
        const fieldMove = this.avatar.fieldMoveScript(fx, fz, dw.facingBehaviour());
        if (fieldMove) return this.scripts.start({ label: fieldMove, zone, source: 'bg' });
        return;
      }
      // A found hidden item is no event any more (decomp BgEvent_IsHiddenItemAvailable).
      const bg = this.events.bgs.find((b) => b.x === fx && b.z === fz && bgFacingMatches(b.facing, p.facing) && !(b.hiddenItem && this.flag(b.hiddenItem.flag)));
      if (bg?.hiddenItem) return this.scripts.start({ label: bg.label, zone, source: 'bg', params: this.hiddenItemParams(bg.hiddenItem) });
      if (bg) return this.scripts.start({ label: bg.label, zone, source: 'bg' });
      // HoneyTree_TryInteract: facing north, a honey tree prop on the tile ahead (COMMON_SCRIPTS 8).
      const honey = newGameRecord(this.reg).specialEncounters?.honeyTrees;
      if (honey && p.facing === 'up' && this.propsAt(p.x, p.z - 1).includes(honey.prop)) return this.scripts.start({ label: honey.label, zone, source: 'bg' });
      // The facing tile's behaviour (TV, PC, bookshelves, trash cans, town map; decomp Field_TileBehaviorToScript).
      const use = this.grid.interaction(fx, fz);
      if (use && (use.facing === 'any' || use.facing === p.facing)) return this.scripts.start({ label: use.label, zone, source: 'bg' });
      // Water, waterfalls and rock walls start their FIELD_MOVES script (Field_TileBehaviorToScript).
      const fieldMove = this.avatar.fieldMoveScript(fx, fz);
      if (fieldMove) return this.scripts.start({ label: fieldMove, zone, source: 'bg' });
    }

    if (stepped) {
      // The Underground's buried traps and the base's tools (CommPlayer_Move, before the player's next move).
      if (this.ug?.stepped()) return;
      // Canalave Gym's platforms come first (Field_ProcessStep → CanalaveGym_CheckIfPlayerOnPlatform).
      if (this.feature?.stepped?.()) return;
      // Spin tiles take over before the step events (Field_ProcessStep → ov5_021E1154).
      if (this.avatar.startSlide()) return;
      for (const c of this.events.coords) {
        if (p.x >= c.x && p.x < c.x + c.width && p.z >= c.z && p.z < c.z + c.length && this.varValue(c.var) === c.value) {
          return this.scripts.start({ label: c.label, zone, source: 'coord' });
        }
      }
      const w = this.warpAt(p.x, p.z);
      if (w && BEHAVIOUR_PUSH_WARP[this.behaviour(p.x, p.z)] === undefined) return this.warpToEvent(w.toZone, w.toWarp, p.x, p.z);
      // Decomp Field_ProcessStep → POKETCH_EVENT_PEDOMETER (not on forced movement: returned above).
      countPoketchStep(this.state, this.reg);
      // Decomp Field_ProcessStep → Field_UpdateDaycare (before the Repel): daycare steps, the egg roll, egg
      // cycles; an egg with no cycles left starts CommonScript_HatchEgg. Rolls take the main stream.
      // Decomp Field_ProcessStep → Field_UpdateSafari (before the daycare): out of balls, or the 500th step.
      const safari = safariStep(this.reg, this.state);
      if (safari) return this.scripts.start({ label: safari, zone, source: 'step' });
      if (this.daycareStep()) return this.scripts.start({ label: newGameRecord(this.reg).hatchEgg, zone, source: 'step' });
      // Decomp Field_ProcessStep → Repel_UpdateSteps: the last step of a Repel starts CommonScript_RepelsEffectWoreOff.
      if (this.state.repel > 0 && --this.state.repel === 0) {
        const label = [...this.reg.newGame.values()][0]?.repelWoreOff;
        if (!label) throw new Error('world: the Repel wore off but newGame has no repelWoreOff label');
        return this.scripts.start({ label, zone, source: 'step' });
      }
      // Decomp Field_ProcessStep → SystemVars_IncrementAmitySquareStepCount: every step counts, up to 10000.
      const amity = newGameRecord(this.reg).amitySquare;
      if (amity) {
        const steps = this.varValue(amity.stepVar);
        if (steps < AMITY_STEPS_MAX) this.state.vars[amity.stepVar] = steps + 1;
      }
      if (this.checkWildEncounter()) return;
    }

    // Pushing into a warp: a blocked warp tile ahead (doors), or a directional warp tile underfoot (mats).
    const held = inputDir(input);
    // SecretBases_CheckForEnterExit: pushing into the base's entrance, or onto its exit.
    if (held && held === p.facing && this.ug?.push(fx, fz)) return;
    if (held && held === p.facing) {
      // Field_CheckMapTransition: a map feature's push (Veilstone's bags) comes before the warps.
      if (this.feature?.push?.(held)) return;
      const ahead = this.warpAt(fx, fz);
      if (ahead && this.tileBlocked(fx, fz)) return this.behaviour(fx, fz) === 'DOOR' ? this.enterDoor(ahead.toZone, ahead.toWarp, fx, fz) : this.warpToEvent(ahead.toZone, ahead.toWarp, fx, fz);
      const here = this.warpAt(p.x, p.z);
      if (here && BEHAVIOUR_PUSH_WARP[this.behaviour(p.x, p.z)] === held) return this.warpToEvent(here.toZone, here.toWarp, p.x, p.z);
    }
  }

  /** Decomp Daycare_Update with the cycle length of the clock's date (Daycare_GetEggCycleLength: 255 under the clock penalty). */
  private daycareStep(): boolean {
    const prng = Prng.from(this.state.rng);
    const rng = { next: () => prng.next(), below: (n: number) => prng.below(n) };
    const cycle = eggCycleLength(this.clock().date, this.state.gameTime.penaltyMinutes > 0);
    const hatch = daycareStep(dexOf(this.reg), this.state.daycare, this.state.party, rng, cycle);
    this.state.rng = prng.save();
    return hatch;
  }

  // ---------- wild encounters ----------

  /**
   * After a completed step on an encounter tile (decomp Field_CheckWildEncounter, after coord events and
   * warps): the game starts the battle from the next tick. No party, no battle.
   */
  private checkWildEncounter(): boolean {
    const p = this.hero;
    if (!this.zone.encounters || this.state.party.length === 0) return false;
    const behaviour = this.behaviour(p.x, p.z);
    if (!ENCOUNTER_BEHAVIOURS.has(behaviour)) return false;
    // The slots by the clock's period (decomp GetTimeOfDay, the RTC); the battle palette by the saved clock.
    const period = dayPeriod(this.clock().hour);
    const partner = this.state.hasPartner;
    const table = this.encounterTable();
    const prng = Prng.from(this.state.encounterRng);
    const gate = encounterGate(table, behaviour, prng, this.encounterAttempts, this.state.playerState === 'cycle');
    // PokeRadar_ShouldDoRadarEncounter after ShouldGetRandomEncounter: a live patch forces the encounter.
    const radar = gate === null ? null : (this.radar?.enter(p.x, p.z) ?? null);
    if (!gate && !radar) {
      this.state.encounterRng = prng.save();
      return false;
    }
    if (radar) return this.radarEncounter(table, behaviour, prng, period, radar);
    const { roll, second } = encounterSlots(table, behaviour, prng, this.encounterAttempts, period, partner);
    this.state.encounterRng = prng.save();
    // Decomp RepelPreventsEncounter: while Repel steps remain, a wild Pokémon below the first able battler's level
    // does not appear (with a partner: either of the two, and then neither does).
    const lead = this.state.party.find((m) => !m.isEgg && m.hp > 0);
    // Decomp TryEncounterRoamer: without a partner, a roamer on this zone may take the encounter (roamers.ts; our
    // roll has already drawn its slot, the DS draws the roamer first).
    const roamer = partner ? null : rollRoamerEncounter(this.reg, this.state, this.zone.id);
    if (roamer !== null) {
      const spec = roamerWildSpec(this.state, roamer);
      if (this.state.repel > 0 && lead && lead.level > spec.level) return false;
      this.radar?.clear();
      this.startWild({ ...wildBattleSetup(this.zone, behaviour, this.state.playerState === 'surf', spec, this.battleTime()), wild: [spec] });
      return true;
    }
    if (this.state.repel > 0 && lead && [roll, second].some((r) => r && lead.level > r.level)) return false;
    if (second) {
      const v = [...this.reg.vars.values()].find((x) => x.sourceIndex === VAR_PARTNER_TRAINER_ID);
      if (!v) throw new Error('world: no VAR_PARTNER_TRAINER_ID var (0x403F) for the walking partner');
      this.startWild(partnerWildBattleSetup(this.reg, this.zone, behaviour, [roll, second], this.varValue(v.id), this.battleTime()));
      return true;
    }
    // On water with a partner the DS makes a 74 with one wild Pokémon (TryGenerateSurfEncounter); not run here.
    if (partner) this.log.stub('world:partner-surf-encounter', 'a water encounter with the walking partner (one wild Pokémon in a type 74) battles as a single');
    // TryGenerateGrassEncounter_WithRadar without a patch: an ordinary grass encounter ends the chain.
    if (!isSurfable(behaviour)) this.radar?.clear();
    this.startWildSingle(behaviour, roll);
    return true;
  }

  /**
   * The zone's table as this step rolls it (decomp WildEncounters_TryWildEncounter's replacements): the Great Marsh's
   * daily species in a Safari Game, the day's swarm on its zone, the Trophy Garden's two species with the National
   * Pokédex; a Poké Radar hard shake adds the Radar species (`radarEncounter`).
   */
  private encounterTable(radar = false): EncounterTable {
    const base = safariEncounterTable(this.reg, this.state, this.get('encounters', this.zone.encounters!), this.zone.id);
    const special = newGameRecord(this.reg).specialEncounters;
    if (!special) return base;
    const enc = readSpecialEncounters(this.state);
    const swarm = enc.swarms && special.swarms[swarmIndex(swarmDailyOf(this.state))] === this.zone.id;
    const garden = this.zone.id === special.trophyGarden.zone && this.state.pokedex.national;
    const trophy = garden ? (enc.trophyGarden.map((i) => (i === null ? null : special.trophyGarden.species[i]!)) as [Id | null, Id | null]) : null;
    return replaceLandSlots(base, { swarm, trophy, radar });
  }

  /**
   * TryGenerateGrassEncounter_WithRadar in a patch: a hard shake brings the Radar species into slots 4, 5, 10, 11; a
   * chain kept goes on with its species and level (shiny in the shiny patch), else a slot is drawn and the chain
   * follows it (CreateWildMon_FromRadarNoChain). No Repel and no roamer here. New patches are drawn around the player
   * for after the battle (RadarSpawnPatches).
   */
  private radarEncounter(base: EncounterTable, behaviour: string, prng: Prng, period: ReturnType<typeof dayPeriod>, radar: RadarEncounter): boolean {
    const table = radar.shake === 'hard' ? this.encounterTable(true) : base;
    let wild: WildRoll & { shiny?: true };
    if (radar.preserve) {
      const m = this.radar!.mon();
      if (!m.species) throw new Error('world: a kept Poké Radar chain has no species');
      wild = { species: m.species, level: m.level, ...(radar.shiny ? { shiny: true as const } : {}) };
    } else {
      const slot = landSlotIndex(prng.below(100));
      wild = this.radar!.drew(landSlot(table, slot, period), table.land[slot]!.maxLevel);
    }
    this.encounterAttempts.count = 0;
    this.state.encounterRng = prng.save();
    this.radar!.spawn(this.hero.x, this.hero.z, this.hero.y, this.zone.id);
    this.startWildSingle(behaviour, wild);
    return true;
  }

  /** CreateWildSingleBattle: a wild single (in a Safari Game, FieldBattleDTO_NewSafari with the balls left). */
  private startWildSingle(behaviour: string, roll: WildRoll & { shiny?: true }): void {
    const setup = wildBattleSetup(this.zone, behaviour, this.state.playerState === 'surf', roll, this.battleTime());
    this.startWild(safariActive(this.reg, this.state) ? { ...setup, kind: 'safari', safariBalls: this.state.safari!.balls } : setup);
  }

  private startWild(setup: BattleSetup): void {
    this.battles.start({ ...setup, weather: battleWeather(this.get('weathers', this.state.weather).name) });
    this.wildFoe = setup.wild[0]!.species;
    this.wildSafari = setup.kind === 'safari';
  }

  /** The field's wild battle is a Safari battle (FieldTask_SafariEncounter). */
  private wildSafari = false;
  /** A Safari Game script to start once the warp after the battle is done (FieldTask_SafariEncounter state 6). */
  private safariScript: Id | null = null;

  /**
   * Once the field's wild battle has ended (decomp FieldTask_WildEncounter, while the field fades in): unless the
   * player lost, the roamers update (roamers.ts).
   */
  private afterWildBattle(): void {
    if (!this.wildFoe) return;
    const result = this.battles.done();
    if (!result) return;
    if (result.outcome !== 'lost' && result.outcome !== 'draw') roamersAfterBattle(this.reg, this.state, this.zone.id, this.wildFoe, result);
    this.wildFoe = null;
    // FieldTask_WildEncounter states 3, 5 and 6: a chain from a patch the player beat or caught shakes on (the field
    // waits for the shakes); any other ends.
    if (this.radar?.afterBattle(result.outcome)) {
      this.lockAll();
      this.radarTask = true;
    }
    if (!this.wildSafari) return;
    this.wildSafari = false;
    const after = afterSafariBattle(this.reg, this.state, result);
    if (after.warp) {
      // FieldTask_ChangeMapByLocation to the special location (the gate) while the screen is still black, then the
      // field fades in (FieldTransition_FadeIn).
      const loc = this.state.specialLocation;
      const dest = specialDestination(this.reg, loc);
      this.fadeColor = 'black';
      this.fadeAlpha = 1;
      this.warpState = { phase: 'out', stairs: false, event: false, zone: dest.zone, x: dest.x, z: dest.z, facing: loc!.facing };
    }
    this.safariScript = after.label;
  }

  // ---------- trainers ----------

  /** The trainer's defeated flag: the flag with sourceIndex 0x550 + trainer id (decomp Script_IsTrainerDefeated). */
  private trainerFlag(trainer: Id): Id {
    const index = TRAINER_FLAGS_START + (this.get('trainers', trainer).sourceIndex ?? NaN);
    for (const fl of this.reg.flags.values()) if (fl.sourceIndex === index) return fl.id;
    throw new Error(`world: no flag with sourceIndex 0x${index.toString(16)} for ${trainer}`);
  }

  /** First undefeated trainer (object order) that sees the player, with its direction and distance. */
  private trainerInSight(except: Actor | null): { t: Actor; dir: Facing; distance: number } | null {
    const p = this.hero;
    for (const t of this.actors.values()) {
      if (t === except || !t.trainer) continue;
      for (const dir of sightDirs(t)) {
        const distance = lineDistance(t, p, dir);
        if (distance === null || this.sightBlocked(t, dir, distance)) continue;
        if (this.flag(this.trainerFlag(t.trainer.id))) break;
        return { t, dir, distance };
      }
    }
    return null;
  }

  /** IsPathInterrupted: any tile between is blocked or taken; the player's own tile must hold only the player. */
  private sightBlocked(t: Actor, dir: Facing, distance: number): boolean {
    const [dx, dz] = DELTA[dir];
    for (let i = 1; i < distance; i++) {
      const x = t.x + dx * i;
      const z = t.z + dz * i;
      if (this.tileBlocked(x, z) || this.occupant(x, z, t)) return true;
    }
    // The last tile must hold the player as an object at the trainer's height: map objects collide only within
    // 2 grid units of height (MapObject Y, height / 8; sub_02063F00), so a player on another floor is not seen.
    return this.tileBlocked(this.hero.x, this.hero.z) || Math.abs(Math.trunc(this.hero.y / 8) - Math.trunc(t.y / 8)) >= 2;
  }

  /**
   * Decomp FieldSystem_CheckForTrainersWantingBattle: a single trainer (two singles when a second one also
   * sees the player and the party can fight two), or a double trainer with its partner object (needs two
   * Pokémon, else nobody battles). Starts the shared approach script with the trainer context.
   */
  private checkTrainerSight(): boolean {
    const first = this.trainerInSight(null);
    if (!first) return this.featureSight();
    // Decomp FieldInput_Process: Party_HasTwoAliveMons (two that can battle), or the walking partner.
    const hasTwo = this.state.party.filter((m) => !m.isEgg && m.hp > 0).length >= 2 || this.state.hasPartner;
    const slot = (t: Actor, turnPlayer: boolean) => ({ localId: t.localId, dir: first.dir, distance: first.distance, turnPlayer });
    let sightType = APPROACH_SINGLES;
    let slots = [{ ...slot(first.t, true) }];
    if (this.get('trainers', first.t.trainer!.id).double) {
      if (!hasTwo) return false;
      const partner = [...this.actors.values()].find((a) => a !== first.t && a.trainer?.id === first.t.trainer!.id && (a.trainerType === 1 || a.trainerType === 2));
      if (!partner) throw new Error(`world: double trainer ${first.t.trainer!.id} has no partner object in ${this.zone.id}`);
      sightType = APPROACH_DOUBLES;
      slots.push(slot(partner, false));
    } else if (hasTwo) {
      const second = this.trainerInSight(first.t);
      if (second) {
        sightType = APPROACH_VS2;
        slots = [slot(first.t, true), { localId: second.t.localId, dir: second.dir, distance: second.distance, turnPlayer: true }];
      }
    }
    const label = [...this.reg.newGame.values()][0]?.trainerApproach;
    if (!label) throw new Error('world: a trainer spotted the player but newGame has no trainerApproach label');
    this.sighting = slots;
    this.approaches = [];
    this.moving = false;
    for (const a of this.actors.values()) a.paused = true;
    const ids = slots.map((s) => this.actors.get(s.localId)!.trainer!.id);
    this.scripts.start({ label, zone: this.zone.id, source: 'trainer', trainer: { localIds: slots.map((s) => s.localId), trainers: ids, sightType } });
    return true;
  }

  /**
   * field_control.c after FieldSystem_CheckForTrainersWantingBattle: a map feature's own sight (Hearthome's
   * trainer in front of the player) starts a single trainer's approach.
   */
  private featureSight(): boolean {
    const seen = this.feature?.playerSight?.();
    if (!seen) return false;
    const label = newGameRecord(this.reg).trainerApproach;
    if (!label) throw new Error('world: a trainer spotted the player but newGame has no trainerApproach label');
    this.sighting = [{ localId: seen.trainer.localId, dir: seen.dir, distance: seen.distance, turnPlayer: true }];
    this.approaches = [];
    this.moving = false;
    for (const a of this.actors.values()) a.paused = true;
    this.scripts.start({ label, zone: this.zone.id, source: 'trainer', trainer: { localIds: [seen.trainer.localId], trainers: [seen.trainer.trainer!.id], sightType: APPROACH_SINGLES } });
    return true;
  }

  /** What a map feature may use of the world (gyms/feature.ts). */
  private makeFeatureHost(): FeatureHost {
    return {
      reg: this.reg,
      state: this.state,
      log: this.log,
      sound: this.sound,
      zone: () => this.zone,
      hero: () => this.hero,
      objects: () => [...this.actors.values()].filter((a) => !this.featureActors.has(a)),
      warps: () => this.events.warps,
      addObject: (a) => {
        this.featureActors.add(a);
        this.actors.set(-0x10000 - this.featureActors.size, a);
        a.y = this.heightAt(a.cur[0], a.cur[2], a.y);
        this.updatePosition(a);
        a.prev = [...a.cur];
      },
      removeObject: (a) => {
        for (const [k, v] of this.actors) if (v === a) this.actors.delete(k);
        this.featureActors.delete(a);
      },
      occupant: (x, z) => (this.hero.x === x && this.hero.z === z ? this.hero : this.occupant(x, z, this.hero)),
      trackCamera: (x, z) => {
        this.addFreeCamera(x, z, true);
        return this.camera!;
      },
      releaseCamera: () => this.restoreCamera(),
      heightAt: (wx, wz, cur) => this.heightAt(wx, wz, cur),
      blocked: (x, z) => this.tileBlocked(x, z),
      behaviour: (x, z) => this.behaviour(x, z),
      propsAt: (x, z) => this.propsAt(x, z),
      varValue: (id) => this.varValue(id),
      setVar: (id, value) => {
        if (value === this.get('vars', id).initial) delete this.state.vars[id];
        else this.state.vars[id] = value;
      },
      sightBlocked: (t, dir, distance) => this.sightBlocked(t, dir, distance),
      undefeatedTrainer: (t) => !!t.trainer && (t.trainerType === 1 || t.trainerType === 2) && !this.flag(this.trainerFlag(t.trainer.id)),
      setPlayerSprite: (sprite) => {
        this.featureSprite = sprite;
        this.hero.sprite = this.playerSprite();
      },
      setHeightCalculation: (enabled) => this.setPlayerHeightCalculation(enabled),
      changeFloor: (zone) => this.changeFloor(zone),
      spawnObject: (zone, ev) => {
        const a = this.spawn(ev, undefined, zone);
        this.updatePosition(a);
        a.prev = [...a.cur];
        return a;
      },
      deleteObject: (a) => {
        for (const [key, actor] of this.actors) if (actor === a) this.actors.delete(key);
      },
      objectById: (localId) => (localId === LOCALID_PLAYER ? this.hero : (this.actors.get(localId) ?? null)),
      applySteps: (a, steps) => {
        if (a.script) throw new Error(`world: object ${a.localId} already has a movement running`);
        a.script = { steps, index: 0, done: 0 };
      },
      startScript: (label) => this.scripts.start({ label, zone: this.zone.id, source: 'step' }),
      scriptRunning: () => this.scripts.running(),
      rekeyObjects: () => this.rekeyDistortionObjects(),
      switchMovementType: (a, movementType) => {
        a.movementType = movementType;
        this.applyMovementType(a);
      },
    };
  }

  /**
   * Where a warp event leads (decomp Field_MapConnection): its target warp, or the special location for a
   * dynamic one. Firing it records the entrance (the warp event at x/z of this zone).
   */
  private warpDest(zoneId: Id | 'dynamic', warpIndex: number, x: number, z: number): { zone: Id; x: number; z: number; warp: number } {
    const dest = zoneId === 'dynamic' ? specialDestination(this.reg, this.state.specialLocation) : this.warpEvent(zoneId, warpIndex);
    const at = this.events.warps.findIndex((w) => w.x === x && w.z === z);
    this.entrance = entrance(this.zone.id, at, x, z, this.hero.facing);
    // Field_TrySetMapConnection / Field_SetMapConnection, before door/stair movement: the warp tile (the
    // player's, or the one pushed into), one south of it when facing north.
    if (onMainMatrix(this.reg, this.zone.id) && !onMainMatrix(this.reg, dest.zone)) {
      const facing = this.hero.facing;
      this.state.escapeLocation = { zone: this.zone.id, x, z: z + (facing === 'up' ? 1 : 0), facing };
    }
    return dest;
  }

  private warpEvent(zoneId: Id, warpIndex: number): { zone: Id; x: number; z: number; warp: number } {
    const dest = this.get('zones', zoneId).events.warps[warpIndex];
    if (!dest) throw new Error(`world: ${zoneId} has no warp ${warpIndex}`);
    return { zone: zoneId, x: dest.x, z: dest.z, warp: warpIndex };
  }

  /** Fires the warp event at x/z (the player's tile, or the blocked warp tile pushed into). */
  private warpToEvent(zoneId: Id | 'dynamic', warpIndex: number, x: number, z: number): void {
    const p = this.hero;
    const dest = this.warpDest(zoneId, warpIndex, x, z);
    const behaviour = this.behaviour(p.x, p.z);
    // Escalators (decomp Field_CheckTransition: ESCALATOR_FLIP_FACE flips the arrival facing). Leaving
    // (sub_02056EA4 → ov5_021D4A24): one WALK_SLOW step into the escalator, the fade-out starting with it.
    if (behaviour === 'ESCALATOR' || behaviour === 'ESCALATOR_FLIP_FACE') {
      if (p.facing !== 'left' && p.facing !== 'right') throw new Error(`world: escalator entered facing ${p.facing}`);
      const facing = behaviour === 'ESCALATOR_FLIP_FACE' ? OPPOSITE[p.facing] : p.facing;
      this.moving = false;
      this.warpState = { phase: 'exit', stairs: false, escalator: true, event: true, zone: dest.zone, x: dest.x, z: dest.z, facing, arrivalWarp: dest.warp };
      this.sound.play(1557);
      walk(p, p.facing, WALK_SLOW_TICKS, 'walk', 'auto');
      this.fade('out', WARP_FADE_TICKS, this.fadeColor);
      return;
    }
    // The arrival facing is the pushed or walked direction (decomp sub_02056BDC, sub_02056C18), except north warps.
    if (behaviour === 'WARP_PANEL') {
      this.warpState = { phase: 'panel-depart', stairs: false, event: true, zone: dest.zone, x: dest.x, z: dest.z, facing: p.facing, arrivalWarp: dest.warp, panel: { count: 0, height: 0 } };
      this.sound.playNamed('SEQ_SE_DP_TELE2');
      return;
    }
    if (BEHAVIOUR_WARP_NORTH.has(behaviour)) return this.startWarp(dest.zone, dest.x, dest.z, 'up', true, dest.warp);
    if (BEHAVIOUR_STAIRS[behaviour] === undefined) return this.startWarp(dest.zone, dest.x, dest.z, p.facing, true, dest.warp);
    // Stairs (decomp sub_02056F1C): walk slowly into the stairs, then fade out.
    this.moving = false;
    this.warpState = { phase: 'exit', stairs: true, event: true, zone: dest.zone, x: dest.x, z: dest.z, facing: p.facing, arrivalWarp: dest.warp };
    walk(p, p.facing, WALK_SLOW_TICKS, 'walk', 'auto');
  }

  /**
   * Pushing into a door (decomp Field_CheckMapTransition → ov5_021D433C): the door opens, the player walks
   * north into it and disappears, the door closes, then the screen fades out. Not modelled: the camera
   * zoom (FOV) that runs alongside, and the door sounds.
   */
  private enterDoor(zoneId: Id | 'dynamic', warpIndex: number, x: number, z: number): void {
    const dest = this.warpDest(zoneId, warpIndex, x, z);
    const p = this.hero;
    p.motion = null;
    this.moving = false;
    const facing = this.feature?.doorFacing?.(x, z, p.facing) ?? p.facing;
    this.warpState = { phase: 'door-open', stairs: false, event: true, zone: dest.zone, x: dest.x, z: dest.z, facing, door: { x, z }, arrivalWarp: dest.warp };
    this.playDoor(x, z, 'open');
  }

  step(input: InputFrame): void {
    this.afterWildBattle();
    if (this.fishing) {
      const task = this.fishing;
      const running = task.step(input, this.scripts.running());
      // FishingTask_WaitForFish shows the bite marker; the renderer already draws actor emotes.
      this.hero.emote = task.phase === 'bite' ? 1 : 0;
      if (!running) {
        this.fishing = null;
        this.releaseAll();
        const roll = task.result();
        if (roll) {
          this.addGameRecord(RECORD_CAUGHT_FISH);
          this.log.stub('tv:fishing', 'the successful fishing TV segment is not recorded yet');
          this.startWild(wildBattleSetup(this.zone, 'WATER_RIVER', this.state.playerState === 'surf', roll, battleTime(dayPeriod(this.state.gameTime.now.hour))));
        }
      }
      return;
    }
    this.stepCompleted = false;
    for (const a of this.allActors()) a.prev = [...a.cur];
    this.cameraPrev = [...this.cameraCur];

    if (this.cutIn?.step()) this.cutIn = null;
    this.stepFade();
    if (this.warpState) this.stepWarp();
    if (this.ugTransit) this.stepUgTransit();
    this.ug?.step(input);
    // A touch on the Underground's field: the touch radar (UndergroundMan_CheckForTouchInput).
    const touched = input.tap?.match(/^tile:(\d+),(\d+)$/);
    if (touched && this.ug && !this.warpState && !this.ugTransit && !this.scripts.running()) this.ug.touched(Number(touched[1]), Number(touched[2]));
    this.lookoutInput = input;
    if (this.lookout?.step()) this.lookout = null;
    if (this.safariScript && !this.warpState && !this.scripts.running()) {
      this.scripts.start({ label: this.safariScript, zone: this.zone.id, source: 'step' });
      this.safariScript = null;
    }
    if (this.flyTask) {
      this.flyTask.task.tick();
      if (this.flyTask.task.done) this.flyTask = null;
    }
    if (this.teleportTask) {
      this.teleportTask.tick();
      if (this.teleportTask.done) this.teleportTask = null;
    }
    // The Poké Radar's patches shake (RefreshRadarChain state 2, FieldTask_WildEncounter state 6), then objects move again.
    if (this.radarTask && this.radar!.stepEffects()) {
      this.radarTask = false;
      this.releaseAll();
    }
    if (this.sweet) this.stepSweetScent();
    if (this.obstacleTicks > 0) this.obstacleTicks--;
    if (this.elevatorRide?.step()) this.elevatorRide = null;
    if (this.healMachine?.step()) this.healMachine = null;
    if (this.shake?.step()) this.shake = null;
    for (const ap of this.approaches) {
      const t = this.actors.get(ap.localId);
      // A finished approach outlives its battle until the next sighting; a script may remove that trainer since.
      if (!t && ap.phase === 'done') continue;
      if (!t) throw new Error(`world: approaching trainer ${ap.localId} is gone`);
      if (stepApproach(ap, t, this.hero) && !this.feature?.trainerAfterBattle?.(t)) this.switchMovementType(ap.localId, 0);
    }

    const p = this.hero;
    this.stepPlatformLift();
    this.stepBoat();
    this.feature?.step();
    this.containment?.step();
    // The avatar task (an HM ride, a Strength push, deep mud, spin tiles) runs while a script waits on it.
    const task = !this.warpState && this.avatar.stepTask(input);
    // The Underground's traps hold the player or alter their steps (CommPlayer_Move, CommSys_ApplyMovementModifiers).
    const moveInput = this.ug ? this.ug.input(input) : input;
    if (moveInput && !task && !this.warpState && !this.ugTransit && !this.flyTask && !this.teleportTask && !this.scripts.running() && !p.script && !this.feature?.busy()) this.avatar.input(moveInput);
    // The Sprayduck task reads the held d-pad itself while its script waits (decomp BerryPatches_TaskMain).
    if (this.watering && !this.watering.done) this.watering.step(input.held);
    this.activatePatches();
    for (const a of this.allActors()) this.nextScripted(a);
    this.avatar.observeStepStart();
    const petBefore = this.pet.actor;
    this.pet.update();
    if (this.pet.actor && this.pet.actor !== petBefore) {
      this.updatePosition(this.pet.actor);
      this.pet.actor.prev = [...this.pet.actor.cur];
    }
    for (const a of this.allActors()) {
      const m = a.motion;
      if (m?.kind !== 'walk' || m.jump || m.elapsed !== 0 || this.grassSeen.has(m)) continue;
      this.grassSeen.add(m);
      this.grass(a, 'walk');
    }
    if (!this.warpState) this.checkZoneBoundary();
    // PokeRadar_ClearIfAllOutOfView (no field task): patches off the DS screen stop being live.
    if (this.radar?.isActive() && !this.radarTask && !this.scripts.running()) this.radar.dropUnseen((x, z) => onDsScreen(x, z, this.hero));
    this.loadHoneyTrees();

    for (const a of this.allActors()) {
      if (a.motion?.jump && a.motion.elapsed === 0 && a.motion.jumpAxis === undefined) this.sound.play(a.motion.takeoff ?? 1547);
      const done = advance(a);
      if (done?.kind === 'walk' && done.jump) {
        this.sound.play(1607);
        this.grass(a, 'land');
      }
      if (done?.kind === 'walk') this.sink(a);
      if (a === p && done?.kind === 'walk' && (done.fromX !== a.x || done.fromZ !== a.z)) this.avatar.stepEnded();
      // A Distortion World jump point's jump is a field task, not a movement action: no step events.
      if (a === p && done?.kind === 'walk' && done.source !== 'script' && done.jumpAxis === undefined) {
        this.stepCompleted = true;
        if (hasFieldSystems(this.reg)) {
          seekerStep(this.reg, this.state, (item) => itemCount(this.state, item), () => {
            for (const actor of this.actors.values()) if (actor.movementType === SEEKER_SPIN) this.switchMovementType(actor.localId, 2);
          });
        }
        // Field_UpdatePokeRadar (RadarChargeStep): with the Poké Radar in the bag.
        if (this.radar) this.radar.chargeStep(itemCount(this.state, this.pokeRadarItem()) > 0);
        // The Underground's step count (sub_02058644): its 50th step of each hundred scores.
        if (this.ug && undergroundStep(undergroundState(this.state))) this.addTrainerScore(TRAINER_SCORE_UNDERGROUND_100_STEPS);
      }
      // A finished list ends now, so waiters see it on the tick its last action ends.
      const s = a.script;
      if (done && s && s.index === s.steps.length - 1 && s.done >= s.steps[s.index]!.count) a.script = null;
    }
    for (const a of this.actors.values()) this.updateMovementType(a);
    // The avatar tasks switch the state without setPlayerState (surf mount and dismount): redraw with its sprite.
    if (!this.healAvatar) p.sprite = this.playerSprite();
    for (const a of this.allActors()) this.updatePosition(a);
    this.effects.step(p, this.allActors());
    this.updateCamera();
    this.stepDoors();
    this.syncState();
  }

  /** The lift task (FieldTask_PlatformLiftGoUp/GoDown), one state step per tick: the player rides along. */
  private stepPlatformLift(): void {
    const s = this.platformLift?.step();
    if (!s) return;
    if (s.stop !== undefined) this.sound.stop(s.stop);
    if (s.play !== undefined) this.sound.play(s.play);
    if (s.calc !== undefined) this.setPlayerHeightCalculation(s.calc);
    if (s.height !== undefined) this.hero.y = s.height;
  }

  /** Door clips advance one frame per tick; a finished `close` (or `pc-off`) leaves the list (the prop is at rest). */
  private stepDoors(): void {
    for (const d of this.doors) if (d.tick < d.ticks) d.tick++;
    this.doors = this.doors.filter((d) => d.anim === 'open' || d.anim === 'pc-on' || d.tick < d.ticks);
  }

  /**
   * A zone connection keeps an object the new zone lists too (decomp sub_020626D0, sub_02062714): it
   * takes that event's zone, script and flags, under the key `spawn` would give it.
   */
  private carryOver(a: Actor, ev: ObjectEvent, index: number): void {
    a.zone = this.zone.id;
    delete a.label;
    delete a.hideFlag;
    delete a.cloneOf;
    delete a.cloneLocalId;
    a.localId = ev.localId;
    delete a.trainer;
    if (ev.label) a.label = ev.label;
    if (ev.hideFlag) a.hideFlag = ev.hideFlag;
    if (ev.cloneOf) a.cloneOf = ev.cloneOf;
    if (ev.cloneLocalId !== undefined) a.cloneLocalId = ev.cloneLocalId;
    if (ev.trainer) a.trainer = ev.trainer;
    this.actors.set(this.actors.has(ev.localId) ? -1 - index : ev.localId, a);
  }

  /**
   * Zone connections (decomp FieldMap_ChangeZone, FieldMapChange_UpdateGameData with noWarp, sub_0206184C):
   * when the player's tile changes (a step starts) into a matrix cell of another zone, the zone header
   * switches without a fade. Map-local flags and vars are cleared, the encounter attempts reset, the new
   * zone's onTransition runs; then every object from another zone that is not persistent is deleted at
   * once (the DS keeps none until out of range), and the new zone's objects spawn. onLoad does not run,
   * and the area (texture set, props, light) stays the one of the last map load (FieldView.area).
   * The weather is set as on a warp. Not modelled: music, popup.
   *
   * Objects seen from both sides of a border are listed in both zones: the real one, and a clone
   * (`ObjectEvent.cloneOf`) in the neighbour. Such an object is carried over, not deleted and respawned
   * (sub_0206184C keeps it, MapObjectMan_AddMapObjectFromHeader turns it into the new zone's event): it
   * keeps its place, facing and movement, and takes the new zone, script and flags. Twinleaf's guitarist
   * and Route 201's arrow signpost cross that border this way. Deviations: an object whose new event is
   * hidden by its flag, and a clone of a third zone's object that the new zone clones too, are deleted
   * (the DS keeps the first unconverted, and the second next to a fresh copy).
   */
  private checkZoneBoundary(): void {
    const p = this.hero;
    const key = `${p.x},${p.z}`;
    if (key === this.lastTile) return;
    this.lastTile = key;
    const cell = this.grid.cell(p.x, p.z);
    const next = cell === null ? null : this.matrix.zones?.[cell];
    if (!next || next === this.zone.id) return;
    const zone = this.get('zones', next);
    if (zone.matrix !== this.zone.matrix) throw new Error(`world: ${next} is in matrix ${zone.matrix}, not ${this.zone.matrix}`);
    for (const f of this.reg.flags.values()) if (f.scope === 'map') delete this.state.flags[f.id];
    for (const v of this.reg.vars.values()) if (v.scope === 'map') delete this.state.vars[v.id];
    this.encounterAttempts.count = 0;
    // FieldMap_ChangeZone: RadarChain_Clear (the zone's BGM fades in as for any zone change).
    this.radar?.clear();
    onZoneConnection(this.reg, this.state, next);
    this.zone = zone;
    this.state.weather = this.mapChangeWeather(zone);
    this.events = structuredClone(zone.events) as ZoneEvents;
    this.syncState();
    if (zone.mapScripts.onTransition) this.scripts.runImmediate({ label: zone.mapScripts.onTransition, zone: next, source: 'transition' });
    const before = new Set(this.actors.values());
    const leaving: Actor[] = [];
    for (const [id, a] of this.actors) {
      if (a.zone === next || a.persistent) continue;
      this.actors.delete(id);
      leaving.push(a);
    }
    const kept = new Set([...this.actors.values()].map((a) => a.localId));
    this.events.objects.forEach((ev, i) => {
      if (ev.hideFlag && this.flag(ev.hideFlag)) return;
      const carried = leaving.findIndex((a) => a.sprite === this.spriteFor(ev) && (ev.cloneOf
        ? !a.cloneOf && a.zone === ev.cloneOf && a.localId === (ev.cloneLocalId ?? ev.localId)
        : a.cloneOf === next && (a.cloneLocalId ?? a.localId) === ev.localId));
      if (carried >= 0) return this.carryOver(leaving.splice(carried, 1)[0]!, ev, i);
      if (!kept.has(ev.localId)) this.spawn(ev, -1 - i);
    });
    this.departed = { crossing: ++this.crossings, actors: leaving.map((a) => this.actorView(a, true)) };
    for (const a of this.actors.values()) {
      if (before.has(a)) continue;
      this.updatePosition(a);
      a.prev = [...a.cur];
      this.grass(a, 'place');
    }
    this.syncState();
  }

  /**
   * FieldMap_ChangeZoneDistortionWorld → FieldMapChange_UpdateGameDataDistortionWorld (noWarp): a Distortion World
   * elevator takes the player to another floor, another zone with its own matrix and offset, without a load. As a
   * zone connection: map flags and vars cleared, the encounter count reset, other zones' objects that are not
   * persistent deleted (sub_0206184C); unlike one, no onTransition runs and the weather stays. The renderer sees a
   * new map (`loads`).
   */
  private changeFloor(zoneId: Id): void {
    for (const f of this.reg.flags.values()) if (f.scope === 'map') delete this.state.flags[f.id];
    for (const v of this.reg.vars.values()) if (v.scope === 'map') delete this.state.vars[v.id];
    this.encounterAttempts.count = 0;
    onZoneConnection(this.reg, this.state, zoneId);
    this.zone = this.get('zones', zoneId);
    this.grid = new MapGrid(this.reg, loadedMatrix(this.reg.matrices, this.get('matrices', this.zone.matrix), (id) => this.varValue(id)), gridOffset(this.reg, zoneId));
    this.events = structuredClone(this.zone.events) as ZoneEvents;
    for (const [id, a] of this.actors) if (a.zone !== zoneId && !a.persistent) this.actors.delete(id);
    this.rekeyDistortionObjects();
    this.lastTile = `${this.hero.x},${this.hero.z}`;
    this.loads++;
    this.syncState();
  }

  /** The partner steps into the tile the player just left (decomp MOVEMENT_TYPE_FOLLOW_PLAYER). */
  private follow(toX: number, toZ: number, ticks: number): void {
    const f = this.follower();
    if (!f || !this.state.hasPartner || this.locked || this.lockedObjects.has(f.localId) || f.script || f.motion) return;
    const dx = toX - f.x;
    const dz = toZ - f.z;
    if (dx === 0 && dz === 0) return;
    if (Math.abs(dx) + Math.abs(dz) !== 1) {
      this.log.stub('follower-snap', 'follower was not adjacent; snapped');
      f.x = toX;
      f.z = toZ;
      return;
    }
    const dir: Facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dz > 0 ? 'down' : 'up';
    walk(f, dir, ticks, 'walk', 'follow');
  }

  private stepFade(): void {
    const f = this.fadeAnim;
    if (!f) return;
    f.elapsed++;
    this.fadeAlpha = f.from + (f.to - f.from) * Math.min(1, f.elapsed / f.ticks);
    if (f.elapsed >= f.ticks) this.fadeAnim = null;
  }


  private stepWarp(): void {
    const w = this.warpState!;
    if (this.fadeAnim && !w.phase.startsWith('panel-')) return;
    const p = this.hero;
    switch (w.phase) {
      case 'panel-depart':
      case 'panel-arrive': {
        const k = w.panel!;
        const departing = w.phase === 'panel-depart';
        const arrivalFinished = !departing && k.count > 20;
        if (k.count <= 20 || departing) {
          if (k.count % 2) p.facing = ({ up: 'left', left: 'down', down: 'right', right: 'up' } as const)[p.facing];
          const n = departing ? k.count : 20 - k.count;
          k.height = (Math.trunc(4096 * 2.2) + 2048 * n) * n / 4096;
          k.count++;
          if (k.count === (departing ? 20 : 2)) this.fade(departing ? 'out' : 'in', 6, 'black');
        }
        if (k.count <= 20 || this.fadeAnim) return;
        if (departing) { w.phase = 'out'; return; }
        // Arrival's terminal animation update is followed by a cleanup callback.
        if (!arrivalFinished) return;
        p.facing = 'down';
        this.warpState = null;
        return;
      }
      case 'exit':
        if (p.motion) return;
        w.phase = 'out';
        if (w.escalator) this.sound.stop(1557);
        else { this.sound.play(1539); this.fade('out', WARP_FADE_TICKS, this.fadeColor); }
        return;
      case 'door-open':
        if (!this.doorDone()) return;
        w.phase = 'door-walk';
        walk(p, 'up', WALK_NORMAL_TICKS, 'walk', 'auto');
        return;
      case 'door-walk':
        if (p.motion) return;
        p.visible = false;
        this.playDoor(w.door!.x, w.door!.z, 'close');
        w.phase = 'door-close';
        return;
      case 'door-close':
        if (!this.doorDone()) return;
        w.phase = 'out';
        this.fade('out', WARP_FADE_TICKS, this.fadeColor);
        return;
      case 'out': {
        onWarp(this.reg, this.state, this.get('zones', w.zone));
        // FieldMapChange_SetNewLocation: the location left becomes the previous one.
        this.state.previousZone = this.zone.id;
        this.loadMap(w.zone, w.x, w.z, 0, w.facing);
        // Arriving at a warp that leads to the special location makes it lead back (FieldMapChange_SetNewLocation).
        if (w.arrivalWarp !== undefined && w.arrivalWarp >= 0 && this.events.warps[w.arrivalWarp]?.toZone === 'dynamic') {
          if (!this.entrance) throw new Error('world: arrived at a dynamic warp with no entrance recorded');
          this.state.specialLocation = { ...this.entrance };
        }
        const hero = this.hero;
        if (w.panel) {
          w.phase = 'panel-arrive';
          w.panel = { count: 0, height: 244 };
          this.sound.playNamed('SEQ_SE_DP_TELE2');
          return;
        }
        w.phase = 'in';
        this.fade('in', WARP_FADE_TICKS, this.fadeColor);
        if (w.escalator) {
          // Arriving (sub_02057300, then sub_020571A0 → ov5_021D4858): start one tile behind the warp,
          // inside the escalator, and take two WALK_SLOW steps in the facing direction while fading in.
          this.sound.play(1557);
          this.stepOffStairs(w.facing);
          w.phase = 'escalator-arrive';
        } else if (w.stairs) this.stepOffStairs();
        // Arriving on a door (decomp sub_02057050 → ov5_021D453C): hidden, the door opens while the screen fades in.
        else if (w.event && this.behaviour(hero.x, hero.z) === 'DOOR') {
          hero.visible = false;
          this.playDoor(hero.x, hero.z, 'open');
          w.door = { x: hero.x, z: hero.z };
          w.phase = 'arrive-open';
        }
        return;
      }
      case 'arrive-open':
        if (!this.doorDone()) return;
        p.visible = true;
        walk(p, 'down', WALK_NORMAL_TICKS, 'walk', 'auto');
        w.phase = 'arrive-walk';
        return;
      case 'arrive-walk':
        if (p.motion) return;
        this.playDoor(w.door!.x, w.door!.z, 'close');
        w.phase = 'arrive-close';
        return;
      case 'arrive-close':
        if (!this.doorDone()) return;
        this.warpState = null;
        return;
      case 'escalator-arrive':
        // The second of ov5_021D4858's two steps.
        if (p.motion) return;
        walk(p, w.facing, WALK_SLOW_TICKS, 'walk', 'auto');
        w.phase = 'in';
        return;
      case 'in':
        if (w.escalator && p.motion) return;
        if (w.escalator) this.sound.stop(1557);
        break;
    }
    this.warpState = null;
    // Arriving on a blocked tile (a door): walk one step out of it.
    if (this.tileBlocked(p.x, p.z)) {
      const [dx, dz] = DELTA[p.facing];
      if (this.tileBlocked(p.x + dx, p.z + dz)) throw new Error(`world: arrival at blocked ${p.x},${p.z} with no way out facing ${p.facing}`);
      walk(p, p.facing, WALK_NORMAL_TICKS, 'walk', 'auto');
    }
  }

  /**
   * Arriving by stairs (decomp sub_02057368, sub_02057218): the player starts one tile inside the
   * destination's stairs, facing away from them, and walks slowly onto the warp tile while the screen
   * fades in.
   */
  private stepOffStairs(escalatorFacing?: Facing): void {
    const p = this.hero;
    const stairs = BEHAVIOUR_STAIRS[this.behaviour(p.x, p.z)];
    const dir = escalatorFacing ?? (stairs ? OPPOSITE[stairs] : p.facing);
    if (dir !== 'left' && dir !== 'right') throw new Error(`world: stairs arrival at ${this.zone.id} ${p.x},${p.z} facing ${dir}`);
    const [dx, dz] = DELTA[dir];
    p.x -= dx;
    p.z -= dz;
    p.facing = dir;
    walk(p, dir, WALK_SLOW_TICKS, 'walk', 'auto');
    this.updatePosition(p);
    p.prev = [...p.cur];
    this.cameraYHistory = [];
    this.updateCamera();
    this.cameraPrev = [...this.cameraCur];
    this.syncState();
  }

  fadeState(): { color: 'black' | 'white'; alpha: number } | null {
    // The binoculars' circle fade replaces the main screen's brightness while it is up.
    if (this.lookout?.view().iris !== null && this.lookout) return null;
    return this.fadeAlpha > 0 ? { color: this.fadeColor, alpha: this.fadeAlpha } : null;
  }

  /** What the renderer draws of an actor; `object` for an event object (ActorView.home), not the player. */
  private actorView(a: Actor, object: boolean): ActorView {
    return {
      localId: a.cloneLocalId ?? a.localId,
      sprite: a.sprite!,
      cur: a === this.hero && this.warpState?.panel ? [a.cur[0], a.cur[1] + this.warpState.panel.height, a.cur[2]] : a.cur,
      prev: a === this.hero && this.warpState?.panel ? [a.prev[0], a.prev[1] + this.warpState.panel.height, a.prev[2]] : a.prev,
      facing: a.facing,
      ...spriteAnimView(a.frames),
      visible: a.visible,
      emote: a.emote > 0,
      ...(a.pose ? { pose: a.pose, animTick: a.poseTick } : {}),
      ...(a.sink ? { sink: a.sink } : {}),
      ...(object ? { home: a.cloneOf ?? a.zone } : {}),
      ...(a.roll ? { roll: a.roll } : {}),
      ...(a.paletteDarkness !== undefined ? { paletteDarkness: a.paletteDarkness } : {}),
    };
  }

  /**
   * FieldView.previews: the event objects of the other zones in this matrix's cells within PREVIEW_RANGE tiles of the
   * player that a zone connection would spawn now (not hidden by their flag, not already live as a clone
   * or carried object), placed as `spawn` places them. Clones are left out: their object is live or
   * previewed itself. So are var sprites: the zone's onTransition sets the var before its objects spawn.
   */
  private previews(): ActorView[] {
    if (this.matrixEvents?.matrix !== this.matrix.id) {
      const events: { zone: Id; ev: ObjectEvent }[] = [];
      // Only zones a connection reaches (cells of this matrix): interiors share matrices without being neighbours.
      for (const id of new Set(this.matrix.zones ?? [])) {
        if (id === null) continue;
        for (const ev of this.get('zones', id).events.objects) if (!ev.cloneOf && typeof ev.sprite === 'string') events.push({ zone: id, ev });
      }
      this.matrixEvents = { matrix: this.matrix.id, events };
    }
    const p = this.hero;
    const live = new Set([...this.actors.values()].map((a) => `${a.cloneOf ?? a.zone}/${a.cloneLocalId ?? a.localId}:${a.sprite}`));
    const out: ActorView[] = [];
    for (const { zone, ev } of this.matrixEvents.events) {
      if (zone === this.zone.id || Math.abs(ev.x - p.x) > PREVIEW_RANGE || Math.abs(ev.z - p.z) > PREVIEW_RANGE) continue;
      if ((ev.hideFlag && this.flag(ev.hideFlag)) || live.has(`${zone}/${ev.localId}:${ev.sprite as Id}`)) continue;
      const a = createActor(ev.localId, ev.sprite as Id, ev.x, ev.z, ev.y, ev.facing, ev.movementType, zone);
      if (DISGUISE_TYPES.has(ev.movementType)) a.lift = DISGUISE_DEPTH;
      a.y = this.heightAt(a.cur[0], a.cur[2], a.y);
      this.sink(a);
      this.updatePosition(a);
      a.prev = a.cur;
      out.push(this.actorView(a, true));
    }
    return out;
  }

  view(): FieldView {
    const actors: ActorView[] = [this.actorView(this.hero, false)];
    const soilEffects: EffectView[] = [];
    const berries = newGameRecord(this.reg).berries;
    const soil = berries ? this.soilObjects() : null;
    for (const a of this.actors.values()) {
      if (this.featureActors.has(a)) continue;
      const patch = a.zone === this.zone.id ? soil?.get(a.localId) : undefined;
      if (patch === undefined) {
        actors.push(this.actorView(a, true));
        continue;
      }
      const p = this.state.berryPatches[patch];
      if (!p) throw new Error(`world: berry patch ${patch} does not exist`);
      const view = patchActorView(berries!, this.actorView(a, true), p);
      actors.push(view);
      const effect = soilEffect(berries!, patch, p, this.actorView(a, true));
      if (effect) soilEffects.push(effect);
    }
    if (this.pet.actor) {
      actors.push(this.pet.drawView(this.actorView(this.pet.actor, false)));
    }
    const feature = this.feature?.view();
    const weather = this.get('weathers', this.state.weather);
    const clock = this.clock();
    const view: FieldView = {
      zone: this.zone.id,
      matrix: this.matrix.id,
      area: this.area,
      loads: this.loads,
      actors,
      camera: { cur: this.cameraCur, prev: this.cameraPrev },
      weather: weather.id,
      // Flash widening and the dark-map transition are not drawn yet; the radius is the weather's.
      darkness: weather.darkness ? { radius: weather.darkness.radius } : null,
      ...(Math.max(this.weatherTasks.flash(), this.cameraFlashLevel()) > 0 ? { lightning: Math.max(this.weatherTasks.flash(), this.cameraFlashLevel()) } : {}),
      effects: [...this.effects.view(), ...(feature?.effects ?? []), ...soilEffects, ...this.radarEffects(), ...(this.ug?.effects() ?? [])],
      cameraOffset: [this.cameraOffset[0] + this.cameraShake, this.cameraOffset[1], this.cameraOffset[2]],
      clock: { seconds: secondsSinceMidnight(clock), period: dayPeriod(clock.hour) },
      previews: this.previews(),
    };
    if (this.storyScene) view.storyScene = this.storyScene;
    const fly = this.flyScene();
    if (fly) view.fly = fly;
    if (this.flyTask) view.cameraDistance = this.flyTask.task.cameraDistance();
    if (this.teleportTask) view.cameraDistance = this.teleportTask.cameraDistance();
    if (this.departed) view.departed = this.departed;
    if (this.doors.length) view.doors = this.doors.map(({ x, z, anim, tick }) => ({ x, z, anim, tick }));
    if (this.healMachine) view.healMachine = this.healMachine.view();
    const lights = this.elevatorRide?.view();
    if (lights) view.elevatorLights = lights;
    const liftProps = newGameRecord(this.reg).platformLiftProps;
    if (this.platformLift && liftProps) view.platformLift = { prop: this.liftProp(), position: this.platformLift.view() };
    if (feature?.features) view.features = feature.features;
    const props = this.boatProps();
    const containment = newGameRecord(this.reg).containment;
    if (containment && this.containment) {
      for (let cell = 0; cell < this.matrix.chunks.length; cell++) {
        const chunk = this.matrix.chunks[cell];
        if (!chunk) continue;
        for (const [i, pl] of this.get('chunks', chunk).props.entries()) if (pl.prop === containment.prop) {
          props.push({ key: `containment-${cell}-${i}`, prop: pl.prop, position: [(cell % this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2 + pl.position[0], (this.matrix.altitudes?.[cell] ?? 0) * 8 + pl.position[1], Math.floor(cell / this.matrix.width) * CHUNK_SIZE + CHUNK_SIZE / 2 + pl.position[2]], rotation: [...pl.rotation], clip: { name: 'opening', tick: this.containment.opening } });
        }
      }
      view.features ??= { models: [] };
      view.features.propPoses = [...(view.features.propPoses ?? []), { prop: containment.prop, tick: this.containment.loop }];
    }
    const honey = newGameRecord(this.reg).specialEncounters?.honeyTrees;
    if (this.honey && honey) {
      const clip = (n: number) => {
        const ticks = this.get('props', honey.prop).animations?.[`shake-${n}`]?.ticks;
        if (!ticks) throw new Error(`world: the honey tree prop has no shake-${n} clip`);
        return ticks;
      };
      props.push(...this.honey.shakes.view(honey.prop, clip, this.state.tick));
    }
    if (this.ug) props.push(...this.ug.props());
    if (props.length) view.props = props;
    const alpha = this.sweet?.alpha() ?? 0;
    if (alpha > 0) view.tint = { color: SWEET_SCENT_COLOR, alpha };
    const shipScene = this.boat?.view();
    if (shipScene) view.shipScene = shipScene;
    const dw = this.distortion();
    if (dw) {
      view.distortion = dw.distortionView();
      dw.presentActors(view);
    }
    return view;
  }

  // ---------- FieldHost ----------

  player(): PlayerPosition {
    return { ...this.state.player };
  }

  applyMovement(target: number, movement: Id): void {
    const a = this.resolve(target);
    if (a.script) throw new Error(`world: object ${target} already has a movement running`);
    a.script = { steps: this.get('movements', movement).steps, index: 0, done: 0 };
  }

  movementDone(target: number | 'all'): boolean {
    if (target === 'all') return this.allActors().every((a) => !a.script && a.motion?.source !== 'script');
    const a = this.resolve(target);
    return !a.script && a.motion?.source !== 'script';
  }

  /** Pauses the objects present now; objects added later by the script are not paused (decomp ScrCmd_LockAll). */
  lockAll(): void {
    this.locked = true;
    for (const a of this.actors.values()) a.paused = true;
  }

  releaseAll(): void {
    this.locked = false;
    this.lockedObjects.clear();
    for (const a of this.actors.values()) a.paused = false;
  }

  lockObject(target: number): void {
    const a = this.resolve(target);
    a.paused = true;
    this.lockedObjects.add(a.localId);
  }

  /** Decomp ScrCmd_ReleaseObject → MapObject_SetPauseMovementOff (Surf and Waterfall release the player). */
  releaseObject(target: number): void {
    const a = this.resolve(target);
    a.paused = false;
    this.lockedObjects.delete(a.localId);
  }

  /** Decomp CanUseFishingRod (item_use_functions.c), after the partner check shared by bag/Y. */
  fishingCheck(): 'fish' | 'generic' | null {
    if (this.zone.noFishing) return 'fish';
    const p = this.hero;
    const [dx, dz] = DELTA[p.facing];
    if (!isSurfable(this.behaviour(p.x + dx, p.z + dz))) return 'generic';
    const here = this.behaviour(p.x, p.z);
    return (isBridge(here) || isBridgeStart(here)) && this.avatar.elevated ? 'generic' : null;
  }

  fish(rod: 0 | 1 | 2): void {
    if (this.fishing || !this.idle()) throw new Error('fishing: field is busy');
    if (this.fishingCheck()) throw new Error('fishing: invalid facing tile');
    const feebas = this.zone.feebas;
    const [dx, dz] = DELTA[this.hero.facing];
    // PlayerAvatar_IsFacingFeebasTile: the facing tile as matrixWidth*32*z + x.
    const facingFeebas = feebas && (() => isFeebasTile(feebas.tiles, dailyRandomOf(this.state), this.matrix.width * CHUNK_TILES * (this.hero.z + dz) + this.hero.x + dx));
    const encounter = this.zone.encounters ? fishingRoll(this.get('encounters', this.zone.encounters), rod, this.state.encounterRng, feebas && { species: feebas.species, facing: facingFeebas! }) : null;
    if (encounter) this.state.encounterRng = encounter.random;
    this.lockAll();
    const next = () => {
      const rng = Prng.from(this.state.encounterRng);
      const value = rng.next();
      this.state.encounterRng = rng.save();
      return value;
    };
    const gotAway = () => {
      this.addGameRecord(RECORD_FISH_GOT_AWAY);
      this.log.stub('tv:fishing-got-away', 'the fishing TV segment for a fish that got away is not recorded yet');
    };
    this.fishing = new FishingTask(rod, encounter?.roll ?? null, next, (name) => {
      const ns = this.zone.id.split(':')[0];
      this.scripts.notice(`${ns}:${name}` as Id, []);
    }, gotAway);
  }

  /** GameRecords_IncrementRecordValue (services `addToGameRecord`, which the world does not depend on). */
  private addGameRecord(id: number): void {
    const high = newGameRecord(this.reg).gameRecords.highLimit[id];
    if (high === undefined) throw new Error(`game record: no record ${id}`);
    const limit = id < GAME_RECORDS.u32 ? (high ? GAME_RECORDS.u32High : GAME_RECORDS.u32Low) : high ? GAME_RECORDS.u16High : GAME_RECORDS.u16Low;
    this.state.records.counts[id] = Math.min(limit, (this.state.records.counts[id] ?? 0) + 1);
  }

  bicycleCheck(): 'partner' | 'dismount' | 'generic' | null {
    if (this.state.hasPartner) return 'partner';
    if (this.flag(flagId(this.reg, FLAG_FORCE_BIKING_IN_GATE))) return 'dismount';
    if (this.avatar.onCyclingRoad) return 'dismount';
    const p = this.state.player;
    const here = this.behaviour(p.x, p.z);
    if (onBikeBridgeNS(here, this.avatar.elevated) || onBikeBridgeEW(here, this.avatar.elevated)) return 'dismount';
    if (isVeryTallGrass(here) || isMud(here) || isMudWithGrass(here)) return 'generic';
    if (!this.zone.flags.bike || this.state.playerState === 'surf') return 'generic';
    return null;
  }

  /** Decomp ScrCmd_ForceBicycling → PlayerAvatar_SetOnCyclingRoad (avatar.ts: rolling south on Cycling Road). */
  forceBicycling(on: boolean): void {
    this.avatar.onCyclingRoad = on;
  }

  /** Decomp PlayerAvatar_SetHeightCalculationEnabled; enabling takes the terrain's height again at once. */
  setPlayerHeightCalculation(enabled: boolean): void {
    this.heightCalc = enabled;
    if (enabled) this.updatePosition(this.hero);
  }

  /** Decomp MapHeaderData_SetBgEventPos: this visit's copy of the zone's bg events. */
  setBgEventPosition(index: number, x: number, z: number): void {
    const bg = this.events.bgs[index];
    if (!bg) throw new Error(`world: ${this.zone.id} has no bg event ${index}`);
    bg.x = x;
    bg.z = z;
  }

  /** Decomp PersistedMapFeatures_InitForPlatformLift (onTransition): the floor from the arrival tile. */
  initPlatformLift(): void {
    const lift = liftOf(this.zone.id);
    if (lift < 0) throw new Error(`world: initPlatformLift in ${this.zone.id}, which has no platform lift`);
    this.state.platformLift = initLift(lift, this.hero.z);
  }

  /** Decomp PlatformLift_WasNotUsedWhenEnteredMap. */
  platformLiftNotUsedWhenEntered(): boolean {
    const data = this.state.platformLift;
    if (!data) throw new Error('world: platformLiftNotUsedWhenEntered before initPlatformLift');
    return data.notUsedWhenEntered;
  }

  /** Decomp PlatformLift_Trigger: the ride runs as a task the script waits on (platformLiftDone). */
  triggerPlatformLift(): void {
    if (!this.platformLift) throw new Error(`world: triggerPlatformLift in ${this.zone.id}, which has no platform lift loaded`);
    this.platformLift.trigger();
  }

  platformLiftDone(): boolean {
    return this.platformLift?.done() ?? true;
  }

  /** Decomp PersistedMapFeatures_InitFor*Gym (gyms/index.ts). */
  /**
   * FieldMap_Init's DynamicMapFeatures_Init on the field's return after a battle. Only the Distortion World is built
   * again here (its objects follow the story state the battle's script left); the gym features keep their runtime,
   * which their slots fully describe.
   */
  continued(): void {
    roamersOnContinue(this.reg, this.state);
  }

  weatherTick(field: boolean): void {
    if (this.flashTicks > 0) this.flashTicks--;
    this.weatherTasks.step(this.get('weathers', this.state.weather), this.loads, field);
  }

  fieldReturned(): void {
    if (!this.distortion()) return;
    this.feature = createMapFeature(this.featureHost);
    this.syncState();
  }

  /** The Distortion World room's runtime, or a loud failure (its script commands run only there). */
  private dw(command: string): DistortionWorld {
    const dw = this.distortion();
    if (!dw) throw new Error(`world: ${command} outside the Distortion World (${this.zone.id})`);
    return dw;
  }

  distortionObject(localId: number, add: boolean): void {
    const dw = this.dw(add ? 'add_distortion_world_map_object' : 'delete_distortion_world_map_object');
    // AddMapObjectFromEvent still checks the object's condition (a manual add passes manual-add-only).
    if (add) dw.addObject(this.zone.id, localId, true);
    else dw.deleteObject(localId);
    this.syncState();
  }

  resetDistortionCameraAngles(): void {
    this.dw('reset_distortion_world_persisted_camera_angles').resetPersistedCameraAngles();
  }

  giratinaShadowEvent(index: number | null): void {
    const dw = this.dw('distortion world giratina shadow event');
    if (index === null) dw.endShadow();
    else dw.startShadowEvent(index);
  }

  initMapFeatures(kind: NonNullable<GameState['mapFeatures']>['kind']): void {
    initMapFeatures(this.state, this.reg, kind);
  }

  private greatMarshTram(): GreatMarshTram {
    if (!(this.feature instanceof GreatMarshTram)) throw new Error(`world: no Great Marsh tram in ${this.zone.id}`);
    return this.feature;
  }

  moveGreatMarshTram(location: number, movement: 'call' | 'ride'): void {
    this.greatMarshTram().move(location, movement);
  }

  greatMarshTramDone(): boolean {
    return this.greatMarshTram().done();
  }

  greatMarshLookout(): void {
    if (this.lookout) throw new Error('world: the binoculars are already in use');
    const g = greatMarsh(this.reg);
    if (!g) throw new Error('world: the packs have no Great Marsh (NewGame.greatMarsh)');
    const marsh = this.get('matrices', this.get('zones', g.zones[0]!).matrix);
    const ns = this.zone.id.slice(0, this.zone.id.indexOf(':'));
    const prng = () => Prng.from(this.state.rng);
    this.lookout = new GreatMarshLookout({
      reg: this.reg,
      state: this.state,
      random: () => {
        const r = prng();
        const v = r.next();
        this.state.rng = r.save();
        return v;
      },
      fade: (kind, frames) => this.fade(kind, frames, 'black'),
      fadeDone: () => this.fadeDone(),
      changeMap: (zone, x, z, facing) => {
        // FieldMapChange_SetNewLocation; the temporary map change skips FieldSystem_InitFlagsWarp (onWarp).
        this.state.previousZone = this.zone.id;
        this.loadMap(zone, x, z, 0, facing);
      },
      marshZone: (x, z) => {
        const zone = marsh.zones?.[Math.floor(x / CHUNK_TILES) + Math.floor(z / CHUNK_TILES) * marsh.width];
        if (!zone) throw new Error(`world: Great Marsh spot ${x},${z} is in no zone`);
        return zone;
      },
      hidePlayer: (hidden) => {
        this.hero.visible = !hidden;
      },
      hidePoketch: (hidden) => {
        const id = `${ns}:FLAG_POKETCH_HIDDEN` as Id;
        if (!this.reg.flags.has(id)) throw new Error(`world: no ${id}`);
        if (hidden === this.reg.flags.get(id)!.initial) delete this.state.flags[id];
        else this.state.flags[id] = hidden;
      },
      encounters: (zone) => {
        const id = this.get('zones', zone).encounters;
        if (!id) throw new Error(`world: Great Marsh area ${zone} has no encounters`);
        return this.get('encounters', id);
      },
      period: () => dayPeriod(this.clock().hour),
      pressedA: () => !!this.lookoutInput?.pressed.includes('a'),
      playSe: (n) => this.sound.play(n),
    });
  }

  greatMarshLookoutDone(): boolean {
    return this.lookout === null;
  }

  /** The binoculars' Pokémon and iris for the app's overlay, or null while they are not in use. */
  lookoutView(): LookoutView | null {
    return this.lookout?.view() ?? null;
  }

  setStoryScene(view: FieldView['storyScene'] | null): void { this.storyScene = view; }
  objectPosition(localId: number): Vec3 { return [...this.resolve(localId).cur]; }
  faceObject(localId: number, facing: Facing): void { this.resolve(localId).facing = facing; }

  initContainmentUnits(freed: boolean): void {
    const t = newGameRecord(this.reg).containment;
    if (!t) throw new Error('world: containment animation metadata missing');
    this.containment = new ContainmentUnits(t.loopFrames, t.openingFrames, freed);
  }
  deactivateContainmentUnits(): void {
    if (!this.containment) throw new Error('world: containment units not initialized');
    this.containment.deactivate();
  }
  containmentUnitsDone(): boolean { return this.containment?.done() ?? true; }

  /** Decomp PersistedMapFeatures_InitForSunyshoreGym: rooms start at orientation 2/1/0, or 0 when entered at z 14/21/25. */
  initSunyshoreGym(room: number): void {
    if (!Number.isInteger(room) || room < 0 || room > 2) throw new Error(`world: Sunyshore room ${room}`);
    this.state.mapFeatures = { kind: 'sunyshore-gym', roomID: room, rotationState: this.state.player.z === [14, 21, 25][room] ? 0 : [2, 1, 0][room]! };
  }

  pressSunyshoreGymButton(button: number): void {
    if (!(this.feature instanceof SunyshoreGym)) throw new Error('world: no Sunyshore gears');
    this.feature.press(button);
  }

  sunyshoreGymButtonDone(): boolean {
    if (!(this.feature instanceof SunyshoreGym)) throw new Error('world: no Sunyshore gears');
    return !this.feature.busy();
  }

  private eternaGym(): EternaGym {
    if (!(this.feature instanceof EternaGym)) throw new Error(`world: no Eterna Gym clock in ${this.zone.id}`);
    return this.feature;
  }

  advanceEternaGymClock(): boolean {
    return this.eternaGym().advance();
  }

  eternaGymClock(): 'running' | 'message' | 'done' {
    return this.eternaGym().taskPhase();
  }

  eternaGymClockContinue(): void {
    this.eternaGym().continueTask();
  }

  private pastoriaGym(): PastoriaGym {
    if (!(this.feature instanceof PastoriaGym)) throw new Error(`world: no Pastoria Gym water in ${this.zone.id}`);
    return this.feature;
  }

  pressPastoriaGymButton(): void {
    this.pastoriaGym().press();
  }

  pastoriaGymButtonDone(): boolean {
    return this.pastoriaGym().done();
  }

  trainerPostBattleMovement(localId: number): boolean {
    const a = this.resolve(localId);
    const done = !!this.feature?.trainerAfterBattle?.(a);
    if (done) this.syncState();
    return done;
  }

  turnPlayer(facing: Facing): void {
    this.hero.facing = facing;
  }

  setObjectVisible(localId: number, visible: boolean): void {
    this.resolve(localId).visible = visible;
  }

  /**
   * A state change redraws the player (decomp PlayerAvatar_RequestState*) with that state's avatar sprite
   * (`NewGame.playerCycleSprite`, `playerSurfSprite`): the speed clears and surfing shows the blob.
   */
  setPlayerState(state: GameState['playerState']): void {
    // MountOrUnmountBicycle: getting on clears the Poké Radar's chain.
    if (state === 'cycle') this.radar?.clear();
    this.state.playerState = state;
    this.healAvatar = false;
    this.hero.sprite = this.playerSprite();
    this.hero.pose = null;
    this.avatar.stateChanged();
  }

  /** The zone's soil objects (local id → patch id), found once per zone. */
  private soilObjects(): Map<number, number> {
    const berries = newGameRecord(this.reg).berries;
    if (!berries) return new Map();
    if (this.soil?.zone !== this.zone.id) this.soil = { zone: this.zone.id, objects: soilObjects(berries, this.events.objects) };
    return this.soil.objects;
  }

  /** Decomp BerryPatches_UpdateGrowthStates: the live soil objects on the DS screen start their patches' growth. */
  private activatePatches(): void {
    const soil = this.soilObjects();
    if (!soil.size) return;
    const objects: PatchObject[] = [];
    for (const a of this.actors.values()) {
      const patch = a.zone === this.zone.id ? soil.get(a.localId) : undefined;
      if (patch !== undefined && a.visible) objects.push({ localId: a.localId, x: a.x, z: a.z, patch });
    }
    activateVisiblePatches(this.state.berryPatches, objects, this.hero);
  }

  /** The patch id of the soil object standing at a tile, null for none. */
  private patchAt(x: number, z: number): number | null {
    const soil = this.soilObjects();
    for (const a of this.actors.values()) if (a.x === x && a.z === z && a.zone === this.zone.id && soil.has(a.localId)) return soil.get(a.localId)!;
    return null;
  }

  startWatering(): void {
    const berries = newGameRecord(this.reg).berries;
    if (!berries) throw new Error('world: startWatering without NewGame.berries');
    if (this.watering) throw new Error('world: the Sprayduck task is already running');
    const p = this.hero;
    if (p.facing !== 'up' && p.facing !== 'down') throw new Error(`world: watering facing ${p.facing} (the scripts water facing up)`);
    // PlayerAvatar_SetTransitionState(PLAYER_TRANSITION_WATER_BERRIES): the Sprayduck avatar, watering the way it faces.
    p.sprite = berries.sprayduck[this.state.gender];
    const facing = p.facing;
    const pose = () => {
      p.pose = facing === 'up' ? 'spray-duck-0' : 'spray-duck-1';
      p.poseTick = 0;
    };
    pose();
    this.healAvatar = true;
    this.watering = new WateringTask(
      {
        patches: this.state.berryPatches,
        patchAt: (x, z) => this.patchAt(x, z),
        blocked: (x, z) => this.tileBlocked(x, z) || !!this.occupant(x, z, p),
        player: () => ({ x: p.x, z: p.z }),
        step: (dir) => {
          walk(p, dir, WALK_NORMAL_TICKS, 'walk', 'auto');
          p.facing = facing;
        },
        stepping: () => {
          if (p.motion) return true;
          pose();
          return false;
        },
        face: (dir) => (p.facing = dir),
      },
      facing,
    );
  }

  wateringDone(): boolean {
    if (!this.watering) throw new Error('world: wateringDone without the Sprayduck task');
    if (!this.watering.done) return false;
    this.watering = null;
    return true;
  }

  /** Decomp BerryPatches_EndWatering: the avatar of the player's state again. */
  /** Decomp SysTask_DoContestCameraFlash: brightness +4 back to 0 over 6 frames (BrightnessController_StartTransition). */
  cameraFlash(): void {
    this.flashTicks = CAMERA_FLASH_TICKS;
  }

  endWatering(): void {
    this.healAvatar = false;
    this.hero.sprite = this.playerSprite();
    this.hero.pose = null;
  }

  /**
   * The heal avatar (decomp PlayerAvatar_RequestStateHeal): the sprite with the give/receive poses; the contest attire
   * (ChangeIntoContestAttire's PlayerAvatar_Redraw with PLAYER_AVATAR_CONTEST). Both last until the next map load or state change.
   */
  setPlayerAvatar(avatar: 'heal' | 'contest'): void {
    const ng = [...this.reg.newGame.values()][0];
    const sprites = avatar === 'heal' ? ng?.playerHealSprite : ng?.contests?.playerSprite;
    if (!sprites) throw new Error(`world: setPlayerAvatar(${avatar}): the pack has no ${avatar} sprite`);
    this.hero.sprite = sprites[this.state.gender];
    this.hero.pose = null;
    this.healAvatar = true;
  }

  /** Starts the approach of a trainer from the last sighting (decomp ScrCmd_StartApproachingTrainerTask). */
  trainerApproach(localId: number): void {
    const s = this.sighting.find((x) => x.localId === localId);
    if (!s) throw new Error(`world: trainerApproach(${localId}): no trainer with that local id spotted the player`);
    if (this.approaches.some((ap) => ap.localId === localId)) throw new Error(`world: trainer ${localId} is already approaching`);
    this.resolve(localId);
    this.approaches.push({ ...s, phase: 'settle', walked: 0 });
  }

  /** True when every started approach has finished (decomp ScrCmd_CheckIsApproachingTrainerTaskDone). */
  trainerApproachDone(): boolean {
    return this.approaches.every((ap) => ap.phase === 'done');
  }

  /**
   * Scripted Cut / Rock Smash animation (decomp ScrCmd_StartDestroyObstacleAnimation → ov6_0224899C): the
   * `CUT` (obstacle 0) or `ROCK_SMASH` (1, 2) field effect on the tile in front of the player (0, 1;
   * ov6_022480BC) or of local object 0 (2; ov6_02248050, Roark in Oreburgh Mine B2F), at that object's
   * height. It runs 45 frames; the script removes the obstacle object itself.
   */
  destroyObstacle(obstacle: number): void {
    if (obstacle !== 0 && obstacle !== 1 && obstacle !== 2) throw new Error(`world: destroyObstacle ${obstacle} (decomp asserts 0–2)`);
    const from = obstacle === 2 ? this.resolve(0) : this.hero;
    const [dx, dz] = DELTA[from.facing];
    const at: Vec3 = [tileCentre(from.x + dx), from.y, tileCentre(from.z + dz)];
    this.effects.addNamed(obstacle === 0 ? 'CUT' : 'ROCK_SMASH', obstacle === 0 ? 'cut' : 'smash', at);
    this.sound.play(obstacle === 0 ? 1611 : 1610);
    this.obstacleTicks = DESTROY_OBSTACLE_TICKS;
  }

  hmCutIn(slot: number): void {
    if (this.cutIn) throw new Error('world: HM cut-in already running');
    const mon = this.state.party[slot];
    if (!mon) throw new Error(`world: no party Pokémon in slot ${slot}`);
    this.log.stub('render:hm-cut-in', 'the HM cut-in is not drawn; its cry and timing run headless');
    this.cutIn = new HmCutIn(mon, this.sound.audio);
  }

  hmCutInDone(): boolean { return this.cutIn === null; }

  /**
   * Fly (decomp FieldMoves_FlyTask, FieldTask_MapChangeFly; fly.ts): the party Pokémon in `slot` flies the player to
   * `dest`, facing down. The map changes as a warp does, off the bike, then FieldSystem_SetFlyFlags ends a Safari Game
   * and scatters every roamer (RoamingPokemon_RandomizeAllLocations).
   */
  fly(slot: number, dest: { zone: Id; x: number; z: number }): void {
    if (this.flyTask || this.warpState) throw new Error('world: fly while a fly or warp runs');
    const mon = this.state.party[slot];
    if (!mon) throw new Error(`world: no party Pokémon in slot ${slot}`);
    this.get('zones', dest.zone);
    this.hero.motion = null;
    this.moving = false;
    const host = {
      cry: () => this.sound.audio.playCry(mon.species, mon.form),
      se: (name: string) => this.playSeNamed(name),
      fadeOut: () => this.fade('out', FLY_FADE_TICKS, 'white'),
      fadeIn: () => this.fade('in', FLY_FADE_TICKS, 'white'),
      fadeDone: () => this.fadeAnim === null,
      hidePlayer: (hidden: boolean) => void (this.hero.visible = !hidden),
      changeMap: () => {
        this.state.playerState = 'walk';
        onWarp(this.reg, this.state, this.get('zones', dest.zone));
        this.state.previousZone = this.zone.id;
        this.loadMap(dest.zone, dest.x, dest.z, 0, 'down');
        onFlyOrTeleport(this.reg, this.state);
      },
    };
    this.flyTask = { task: new FlyTask(host), slot };
  }

  flyDone(): boolean {
    return this.flyTask === null;
  }

  flyScene(): FlySceneView | null {
    if (!this.flyTask) return null;
    const mon = this.state.party[this.flyTask.slot]!;
    return this.flyTask.task.view(this.state.gender, { species: mon.species, form: mon.form, shiny: isShiny(mon.otId, mon.pid), female: monGender(dexOf(this.reg), mon) === 'female' });
  }

  /**
   * Teleport (decomp FieldMoves_TeleportTask; teleport.ts): the HM cut-in with the party Pokémon in `slot`, the warp-out
   * spin, the map change to `dest` facing down (on foot, a warp's game data, FieldSystem_SetTeleportFlags), the warp-in.
   */
  teleport(slot: number, dest: { zone: Id; x: number; z: number; facing?: Facing }, kind: 'teleport' | 'dig' = 'teleport'): void {
    if (this.flyTask || this.teleportTask || this.warpState) throw new Error('world: teleport while a fly, teleport or warp runs');
    const mon = this.state.party[slot];
    if (!mon) throw new Error(`world: no party Pokémon in slot ${slot}`);
    this.get('zones', dest.zone);
    this.hero.motion = null;
    this.moving = false;
    this.log.stub('render:hm-cut-in', 'the HM cut-in is not drawn; its cry and timing run headless');
    this.teleportTask = new TeleportTask({
      cutIn: new HmCutIn(mon, this.sound.audio),
      se: (name) => this.playSeNamed(name),
      fade: (kind) => this.fade(kind, TELEPORT_FADE_TICKS, 'black'),
      fadeDone: () => this.fadeAnim === null,
      face: (facing) => void (this.hero.facing = facing),
      changeMap: () => {
        this.state.playerState = 'walk';
        onWarp(this.reg, this.state, this.get('zones', dest.zone));
        this.state.previousZone = this.zone.id;
        this.loadMap(dest.zone, dest.x, dest.z, 0, kind === 'dig' ? (dest.facing ?? 'down') : 'down');
        if (kind === 'dig') onEscape(this.reg, this.state);
        else onFlyOrTeleport(this.reg, this.state);
      },
    });
  }

  teleportDone(): boolean {
    return this.teleportTask === null;
  }

  /** The shaking Poké Radar patches, on the ground of their tiles plus one unit (ov5_021F31B4). */
  private radarEffects(): EffectView[] {
    if (!this.radar) return [];
    return this.radar.effects().map((e) => {
      const y = this.heightAt(e.cur[0], e.cur[2], this.hero.y) + 1;
      return { ...e, cur: [e.cur[0], y, e.cur[2]], prev: [e.cur[0], y, e.cur[2]] };
    });
  }

  /** The Poké Radar's item (ITEM_USE_FUNC_POKE_RADAR). */
  private pokeRadarItem(): Id {
    const item = [...this.reg.items.values()].find((i) => i.fieldUse === FIELD_USE_POKE_RADAR);
    if (!item) throw new Error('world: no Poké Radar item (field use 11) in the packs');
    return item.id;
  }

  pokeRadarCheck(): 'generic' | null {
    return this.behaviour(this.hero.x, this.hero.z) === 'TALL_GRASS' ? null : 'generic';
  }

  pokeRadar(): void {
    if (!this.radar) throw new Error('world: the packs have no Poké Radar (NewGame.specialEncounters)');
    if (!this.idle()) throw new Error('world: the Poké Radar while the field is busy');
    const tables = newGameRecord(this.reg).specialEncounters!.pokeRadar;
    const p = this.hero;
    const used = this.radar.use(p.x, p.z, p.y, this.zone.id);
    if (used.kind === 'low') return this.scripts.start({ label: tables.labels.noCharge, zone: this.zone.id, source: 'item', params: [used.steps] });
    if (used.kind === 'quiet') return this.scripts.start({ label: tables.labels.quiet, zone: this.zone.id, source: 'item' });
    // RefreshRadarChain states 1–4: objects paused while the patches shake.
    this.lockAll();
    this.radarTask = true;
  }

  radarChain(): { species: Id; count: number } | null {
    return this.radar?.chain() ?? null;
  }

  radarPatches(): { count: number; patches: { x: number; z: number; continues: boolean }[] } | null {
    return this.radar?.livePatches() ?? null;
  }

  sweetScent(slot: number | null): void {
    const tables = newGameRecord(this.reg).specialEncounters;
    if (!tables) throw new Error('world: the packs have no Sweet Scent tables (NewGame.specialEncounters)');
    if (this.sweet || !this.idle()) throw new Error('world: Sweet Scent while the field is busy');
    let cutIn: HmCutIn | null = null;
    if (slot !== null) {
      const mon = this.state.party[slot];
      if (!mon) throw new Error(`world: no party Pokémon in slot ${slot}`);
      this.log.stub('render:hm-cut-in', 'the HM cut-in is not drawn; its cry and timing run headless');
      cutIn = new HmCutIn(mon, this.sound.audio);
    }
    this.sweet = new SweetScentTask({
      cutIn,
      blocked: () => SWEET_SCENT_BLOCKED_WEATHERS.has(this.get('weathers', this.state.weather).sourceIndex ?? 0),
      zoneEncounters: () => !!this.zone.encounters,
      tileRate: () => this.tileHasEncounterRate(),
      playSe: () => this.sound.audio.playSe(tables.sweetScent.sound),
    });
  }

  /** WildEncounters_TileHasEncounterRate under the player. */
  private tileHasEncounterRate(): boolean {
    const behaviour = this.behaviour(this.hero.x, this.hero.z);
    return !!this.zone.encounters && ENCOUNTER_BEHAVIOURS.has(behaviour) && tileEncounterRate(this.encounterTable(), behaviour) > 0;
  }

  private stepSweetScent(): void {
    const end = this.sweet!.step();
    if (!end) return;
    this.sweet = null;
    const labels = newGameRecord(this.reg).specialEncounters!.sweetScent.labels;
    if (end === 'faded') this.scripts.start({ label: labels.faded, zone: this.zone.id, source: 'item' });
    else if (end === 'nothing') this.scripts.start({ label: labels.nothing, zone: this.zone.id, source: 'item' });
    else this.sweetScentEncounter();
  }

  /**
   * WildEncounters_TrySweetScentEncounter: an encounter on this tile whatever the rate and Repel (no Poké Radar patch):
   * a roamer may take it without a partner; a grass encounter ends the Radar's chain.
   */
  private sweetScentEncounter(): void {
    const p = this.hero;
    const behaviour = this.behaviour(p.x, p.z);
    const partner = this.state.hasPartner;
    const prng = Prng.from(this.state.encounterRng);
    const { roll, second } = encounterSlots(this.encounterTable(), behaviour, prng, this.encounterAttempts, dayPeriod(this.clock().hour), partner);
    this.state.encounterRng = prng.save();
    const roamer = partner ? null : rollRoamerEncounter(this.reg, this.state, this.zone.id);
    if (roamer !== null) {
      const spec = roamerWildSpec(this.state, roamer);
      this.radar?.clear();
      return this.startWild({ ...wildBattleSetup(this.zone, behaviour, this.state.playerState === 'surf', spec, this.battleTime()), wild: [spec] });
    }
    if (second) {
      const v = [...this.reg.vars.values()].find((x) => x.sourceIndex === VAR_PARTNER_TRAINER_ID);
      if (!v) throw new Error('world: no VAR_PARTNER_TRAINER_ID var (0x403F) for the walking partner');
      return this.startWild(partnerWildBattleSetup(this.reg, this.zone, behaviour, [roll, second], this.varValue(v.id), this.battleTime()));
    }
    if (!isSurfable(behaviour)) this.radar?.clear();
    this.startWildSingle(behaviour, roll);
  }

  /** The honey trees of chunks that just loaded start shaking when a Pokémon waits (DoTreeShakingAnimation). */
  private loadHoneyTrees(): void {
    if (!this.honey) return;
    const key = `${Math.floor(this.hero.x / CHUNK_TILES)},${Math.floor(this.hero.z / CHUNK_TILES)}`;
    if (key === this.honeyCell) return;
    this.honeyCell = key;
    this.honey.shakes.load(this.hero.x, this.hero.z, this.state, this.state.tick);
  }

  stopHoneyTreeShaking(): void {
    const honey = newGameRecord(this.reg).specialEncounters?.honeyTrees;
    const tree = honey ? honey.zones.indexOf(this.zone.id) : -1;
    if (tree < 0) throw new Error(`world: ${this.zone.id} has no honey tree`);
    this.honey?.shakes.stop(tree);
  }

  talkToFollower(): { facing: Facing; behavior: number } | null {
    const a = this.pet.actor;
    const p = this.hero;
    if (!a?.visible || a.motion || !this.idle()) return null;
    const [dx, dz] = DELTA[p.facing];
    if (a.x !== p.x + dx || a.z !== p.z + dz) return null;
    a.facing = OPPOSITE[p.facing];
    const name = this.behaviour(a.x, a.z);
    const behavior = [...this.reg.tileBehaviors.values()].find((b) => b.name === name)?.sourceIndex;
    if (behavior === undefined) throw new Error(`world: no tile behaviour record ${name}`);
    return { facing: a.facing, behavior };
  }

  followerTalkPose(pose: { dx: number; dy: number; dz: number; facing: Facing } | null): void {
    const a = this.pet.actor;
    if (!a) throw new Error('world: no party follower to pose');
    this.pet.talk = pose && { dx: pose.dx, dy: pose.dy, dz: pose.dz };
    if (pose) a.facing = pose.facing;
  }

  followerBubble(bubble: { sprite: Id; frame: number; rise: number } | null): void {
    this.pet.bubble = bubble;
  }

  /** A sound effect by its SDAT name (`SEQ_SE_DP_FW019`), from the base pack. */
  private playSeNamed(name: string): void {
    const ns = this.zone.id.slice(0, this.zone.id.indexOf(':'));
    const id = `${ns}:${name}` as Id;
    if (!this.reg.sequences.has(id)) {
      this.log.stub('audio:sequence-missing', `no sequence ${id} in the packs: not played`);
      return;
    }
    this.audio.playSe(id);
  }

  destroyObstacleDone(): boolean {
    return this.obstacleTicks === 0;
  }

  /** Decomp ScrCmd_0C3/0C4 and the Flash/Defog tasks: the saved weather changes now; the view follows. */
  setWeather(weather: Id): void {
    this.get('weathers', weather);
    this.state.weather = weather;
  }

  /**
   * Decomp ScrCmd_MoveCamera: Camera_Move adds the offset to the camera (so moves add up), and the player's
   * sprite is drawn at that offset (MapObject_SetSpritePosOffset, replaced each time). Until the next map load.
   */
  moveCamera(x: number, y: number, z: number): void {
    this.cameraOffset = [this.cameraOffset[0] + x, this.cameraOffset[1] + y, this.cameraOffset[2] + z];
    this.hero.offset = [x, y, z];
    this.updatePosition(this.hero);
  }

  shakeCamera(x: number): void {
    this.cameraShake = x;
  }

  /** Decomp ScrCmd_ShakeObject (camera.ts ShakeTask): the script waits for shakeObjectDone. */
  shakeObject(localId: number, times: number, speed: number, xOffset: number, zOffset: number): void {
    if (this.shake) throw new Error('world: shakeObject while another shake runs');
    this.shake = new ShakeTask(this.resolve(localId), times, speed, xOffset, zOffset);
  }

  shakeObjectDone(): boolean {
    return this.shake === null;
  }

  /**
   * Decomp ScrCmd_PlayElevatorAnimation (camera.ts ElevatorRide): the elevator lights play `loops` times;
   * `FieldView.elevatorLights` tells the renderer which animation and frame.
   */
  elevator(direction: 'up' | 'down', loops: number): void {
    if (this.elevatorRide) throw new Error('world: elevator while another ride runs');
    this.elevatorRide = new ElevatorRide(direction, loops, this.sound);
  }

  elevatorDone(): boolean {
    return this.elevatorRide === null;
  }

  /**
   * Decomp ScrCmd_PlayPokecenterHealingAnimation, ScrCmd_PlayHallOfFameHealingAnimation: the machine task
   * (heal-machine.ts); the renderer puts the balls on the `NewGame.healMachine` prop and plays the one-shots
   * (the balls' and the Pokémon Center screen's). Without that record the machine is timed only.
   */
  healAnimation(balls: number, machine: 'pokecenter' | 'hall-of-fame' = 'pokecenter'): void {
    const record = newGameRecord(this.reg).healMachine;
    if (!record) this.log.stub('heal-machine', 'no NewGame.healMachine: the healing machine is timed only');
    const clip = (prop: Id, what: string) => {
      const c = this.reg.props.get(prop)?.animations?.flash;
      if (!c) throw new Error(`world: the ${what} has no flash animation`);
      return c.ticks;
    };
    if (machine === 'pokecenter') {
      if (record && !record.screen) this.log.stub('heal-machine:screen', 'no NewGame.healMachine.screen: the machine screen does not flash');
      const final = record ? Math.max(clip(record.ball, 'healing ball'), record.screen ? clip(record.screen, 'healing machine screen') : 0) : undefined;
      const audio = this.sound.audio;
      this.healMachine = new HealMachine(balls, final, record !== undefined, {
        ball: () => this.sound.playNamed('SEQ_SE_DP_BOWA'),
        fanfare: () => this.sound.fanfareNamed('SEQ_ASA'),
        fanfareWaiting: () => audio.waitFanfare(),
      });
      return;
    }
    if (record && !record.hallOfFame) this.log.stub('heal-machine:hall-of-fame', 'no NewGame.healMachine.hallOfFame: the Hall of Fame machine is timed only');
    this.healMachine = new HealMachine(balls, record ? clip(record.ball, 'healing ball') : undefined, true);
  }

  healAnimationDone(): boolean {
    return this.healMachine === null;
  }

  /** Decomp ScrCmd_UseSurf → FieldTask_StartUseSurf: cut-in, then the player jumps onto the blob (avatar.ts). */
  surf(slot: number): void {
    // ScrCmd_UseSurf: RadarChain_Clear.
    this.radar?.clear();
    this.avatar.surf(slot);
  }

  surfDone(): boolean {
    return this.avatar.taskDone('surf');
  }

  /** Decomp ScrCmd_UseWaterfall: up or down the waterfall the player faces. */
  waterfall(slot: number): void {
    this.avatar.waterfall(slot);
  }

  waterfallDone(): boolean {
    return this.avatar.taskDone('waterfall');
  }

  /** Decomp ScrCmd_UseRockClimb: along the rock wall the player faces. */
  rockClimb(slot: number): void {
    this.avatar.rockClimb(slot);
  }

  rockClimbDone(): boolean {
    return this.avatar.taskDone('rockClimb');
  }

  objectMoving(target: number): boolean {
    // No follower present counts as not moving (decomp ScrCmd_LockAll checks the object exists).
    if (target === LOCALID_FOLLOWER && !this.follower()) return false;
    const a = this.resolve(target);
    return a.motion?.kind === 'walk';
  }

  /** The opposite of the player's facing, not the direction to the player (decomp ScrCmd_FacePlayer, MapObject_TryFace). */
  facePlayer(localId: number): void {
    const a = this.resolve(localId);
    if (!a.dirLocked) a.facing = OPPOSITE[this.hero.facing];
  }

  addObject(localId: number): void {
    const ev = this.eventObject(localId);
    if (!ev) throw new Error(`world: ${this.zone.id} has no object event ${localId}`);
    // Another object with this local id (a duplicate event) yields the id to the one the script adds.
    const other = this.actors.get(localId);
    if (other) {
      this.actors.delete(localId);
      this.actors.set(-1 - this.events.objects.map((o) => o.localId).lastIndexOf(localId), other);
      this.log.stub('duplicate-local-id', `${this.zone.id}: add_object ${localId} while another object has that local id`);
    }
    this.spawn(ev);
    const a = this.actors.get(localId)!;
    this.updatePosition(a);
    a.prev = [...a.cur];
    this.grass(a, 'place');
    this.syncState();
  }

  /**
   * ov5_021E06A8: a snowball (OBJ_EVENT_GFX_SNOWBALL, 0x76) on x/z breaks: its renderer plays the break clip
   * where it stood (ov5_021EC7F0) and the object is deleted without a hide flag (MapObject_Delete), so a save
   * omits it and a new visit spawns it again. The break effect owns SEQ_SE_DP_FW291.
   */
  private breakSnowball(x: number, z: number): void {
    const a = [...this.actors.values()].find((o) => o.x === x && o.z === z && !this.featureActors.has(o));
    if (!a?.sprite || this.reg.sprites.get(a.sprite)?.sourceIndex !== SNOWBALL_GFX) return;
    this.effects.addNamed(SNOWBALL_BREAK, 'break', [...a.cur]);
    this.sound.play(1627);
    for (const [key, actor] of this.actors) if (actor === a) this.actors.delete(key);
    this.syncState();
  }

  /** Decomp ScrCmd_RemoveObject → MapObject_SetFlagAndDeleteObject: sets the object's hide flag, then deletes it. */
  removeObject(localId: number): void {
    const a = this.resolve(localId);
    if (a.hideFlag) {
      if (this.get('flags', a.hideFlag).initial) delete this.state.flags[a.hideFlag];
      else this.state.flags[a.hideFlag] = true;
    }
    for (const [key, actor] of this.actors) if (actor === a) this.actors.delete(key);
    this.syncState();
  }

  /** The zone's event for a local id; SetObjectEvent* edit only this (decomp MapHeaderData_SetObjectEvent*). */
  private editableEvent(localId: number, command: string): ObjectEvent {
    const ev = this.eventObject(localId);
    if (!ev) throw new Error(`world: ${command}: no object event ${localId} in ${this.zone.id}`);
    return ev;
  }

  setObjectPosition(localId: number, x: number, z: number): void {
    const ev = this.editableEvent(localId, 'setObjectPosition');
    ev.x = x;
    ev.z = z;
  }

  setObjectFacing(localId: number, facing: Facing): void {
    this.editableEvent(localId, 'setObjectFacing').facing = facing;
  }

  setObjectMovementType(localId: number, movementType: number): void {
    this.editableEvent(localId, 'setObjectMovementType').movementType = movementType;
  }

  /** The new type starts over: a LOOK_* type turns on its next update (decomp MapObject_SwitchMovementType). */
  switchMovementType(target: number, movementType: number): void {
    const a = this.resolve(target);
    a.movementType = movementType;
    this.applyMovementType(a);
    this.syncState();
  }

  /** Decomp ScrCmd_2B6 → sub_02062D80: MAP_OBJ_STATUS_18 on or off for a live object. */
  setObjectPassThrough(localId: number, passThrough: boolean): void {
    this.resolve(localId).passThrough = passThrough;
    this.syncState();
  }

  setObjectPersistent(localId: number, persistent: boolean): void {
    this.resolve(localId).persistent = persistent;
    this.syncState();
  }

  /**
   * Decomp ScrCmd_SetPosition → MapObject_SetPosDirFromCoords + RecalculateObjectHeight: the object snaps
   * to the tile (current and previous position), faces `facing` and its height is taken from the terrain.
   */
  setPositionLive(localId: number, x: number, z: number, facing: Facing): void {
    const a = this.resolve(localId);
    a.x = x;
    a.z = z;
    a.facing = facing;
    a.motion = null;
    a.y = this.heightAt(tileCentre(x), tileCentre(z), a.y);
    this.updatePosition(a);
    a.prev = [...a.cur];
    this.grass(a, 'place');
    this.syncState();
  }

  setWarpPosition(index: number, x: number, z: number): void {
    const w = this.events.warps[index];
    if (!w) throw new Error(`world: ${this.zone.id} has no warp ${index}`);
    w.x = x;
    w.z = z;
  }

  setWarpDestination(index: number, zone: Id): void {
    const w = this.events.warps[index];
    if (!w) throw new Error(`world: ${this.zone.id} has no warp ${index}`);
    this.get('zones', zone);
    w.toZone = zone;
  }

  warp(zone: Id, x: number, z: number, facing: Facing): void {
    this.startWarp(zone, x, z, facing, false);
  }

  // ---------- the Underground (underground.ts) ----------

  /** The Underground's field for the zone just loaded, or null elsewhere (and in packs without an Underground). */
  private newUndergroundField(load: boolean): UndergroundField | null {
    const tables = undergroundTables(this.reg);
    if (!tables || this.zone.id !== tables.zone) return null;
    const ug = new UndergroundField({
      reg: this.reg,
      state: this.state,
      scripts: this.scripts,
      tables,
      hero: () => this.hero,
      blocked: (x, z) => this.grid.blocked(x, z),
      heroBlocked: (x, z) => this.tileBlocked(x, z) || this.ugObjectAt(x, z) !== null,
      objectAt: (x, z) => this.ugObjectAt(x, z),
      moving: () => !!this.hero.motion,
      matrix: () => ({ width: this.matrix.width, height: this.matrix.height }),
      groundY: (x, z) => this.heightAt(tileCentre(x), tileCentre(z), this.hero.y),
      baseMove: (x, z, facing, then) => this.startUgTransit(this.zone.id, x, z, false, { facing, then }),
      trainerScore: (event) => this.addTrainerScore(event),
      stub: (key, detail) => this.log.stub(key, detail),
      sparkle: (x, z) => void this.effects.add(SPARKLE_RENDERER, 'sparkle', [tileCentre(x), this.heightAt(tileCentre(x), tileCentre(z), this.hero.y), tileCentre(z)]),
      playSe: (name) => this.sound.playNamed(name),
      text: (id) => this.get('texts', id).text,
      clock: () => this.clock(),
    });
    ug.arrive(load);
    return ug;
  }

  /** The visible object standing on an Underground tile (CommPlayer_CheckNPCCollision), its local id, or null. */
  private ugObjectAt(x: number, z: number): number | null {
    return [...this.actors.values()].find((a) => a.x === x && a.z === z && a.visible)?.localId ?? null;
  }

  /** GameRecords_IncrementTrainerScore (services' rule; the world does not depend on services). */
  private addTrainerScore(event: number): void {
    const add = newGameRecord(this.reg).gameRecords.scoreIncrements[event];
    if (add === undefined) throw new Error(`world: no trainer score event ${event}`);
    this.state.records.score = Math.min(TRAINER_SCORE_MAX, this.state.records.score + add);
  }

  explorerKitCheck(): 'generic' | null {
    // CanUseExplorerKit (item_use_functions.c).
    const p = this.state.player;
    const ns = this.zone.id.slice(0, this.zone.id.indexOf(':'));
    const mystery = this.reg.texts.get(`${ns}:LocationNames_Text_MysteryZone` as Id)?.text;
    if (!undergroundTables(this.reg) || this.zone.name === mystery || !onMainMatrix(this.reg, this.zone.id)) return 'generic';
    if (this.avatar.onCyclingRoad || safariActive(this.reg, this.state) || this.state.playerState === 'surf') return 'generic';
    const here = this.behaviour(p.x, p.z);
    if (isBridge(here) || here === 'FORBIDS_EXPLORATION_KIT') return 'generic';
    if (this.zone.events.objects.some((o) => o.x === p.x && o.z === p.z)) return 'generic';
    return null;
  }

  enterUnderground(): void {
    const tables = undergroundTables(this.reg);
    if (!tables) throw new Error('world: no Underground in the packs (NewGame.underground)');
    if (this.explorerKitCheck()) throw new Error('world: the Explorer Kit cannot be used here');
    const p = this.state.player;
    // MapChangeUndergroundContext_New: the surface tile is the special location the way back leads to.
    this.state.specialLocation = { zone: p.zone, warp: -1, x: p.x, z: p.z, facing: p.facing };
    const at = undergroundArrival(p.x, p.z);
    this.startUgTransit(tables.zone, at.x, at.z, true);
  }

  exitUnderground(): void {
    const tables = undergroundTables(this.reg);
    if (!tables || this.zone.id !== tables.zone) throw new Error('world: exitUnderground outside the Underground');
    const back = this.state.specialLocation;
    if (!back || back.warp >= 0) throw new Error('world: the way back from the Underground is not recorded (special location)');
    this.startUgTransit(back.zone, back.x, back.z, false);
  }

  /**
   * FieldTask_MapChangeToUnderground / _FromUnderground, without the DS Wireless prompt and its save: the BGM fades
   * (Sound_FadeOutBGM 30 frames) and the screen with it, the map changes (facing down), the screen fades back in.
   * The hole's jump and the descent animations (underground_map_transition.c) are not drawn yet.
   */
  private startUgTransit(zone: Id, x: number, z: number, down: boolean, base?: { facing: Facing; then: () => void }): void {
    if (this.warpState || this.ugTransit) throw new Error('world: a map change is already under way');
    this.get('zones', zone);
    this.hero.motion = null;
    this.moving = false;
    // The secret base's move keeps the BGM (SecretBases_MoveToFromSecretBaseTask fades the screens only).
    if (!base) this.sound.audio.fadeOutBgm(0, 15);
    this.ugTransit = { phase: 'out', zone, x, z, down, ...(base ? { base } : {}) };
    this.fade('out', WARP_FADE_TICKS, 'black');
  }

  private stepUgTransit(): void {
    const t = this.ugTransit!;
    if (this.fadeAnim || this.sound.audio.fadeActive()) return;
    if (t.phase === 'in') {
      this.ugTransit = null;
      t.base?.then();
      return;
    }
    if (t.base) {
      this.ugKeep = this.ug;
      this.loadMap(t.zone, t.x, t.z, 0, t.base.facing);
      t.phase = 'in';
      this.fade('in', WARP_FADE_TICKS, 'black');
      return;
    }
    const zone = this.get('zones', t.zone);
    onWarp(this.reg, this.state, zone);
    this.state.previousZone = this.zone.id;
    this.loadMap(t.zone, t.x, t.z, 0, 'down');
    // CommManUnderground_EnterUnderground: TRAINER_SCORE_EVENT_UNDERGROUND_ENTERED.
    if (t.down) this.addTrainerScore(TRAINER_SCORE_UNDERGROUND_ENTERED);
    t.phase = 'in';
    this.fade('in', WARP_FADE_TICKS, 'black');
  }

  undergroundRequest() {
    return this.ug?.takeRequest() ?? null;
  }

  undergroundAppDone(result: AppResult): void {
    if (!this.ug) throw new Error(`world: an Underground app (${result.app}) closed outside the Underground`);
    this.ug.appDone(result);
    // UndergroundMenu's Digger Drill (SecretBases_UseDiggerDrill).
    if (result.app === 'ug-menu' && result.drill !== undefined) this.ug.drill(result.drill);
  }

  undergroundDecoration(view: UndergroundDecorationView | null): void {
    if (!this.ug) throw new Error('world: the decoration ran outside the Underground');
    this.ug.decoration = view;
    // UndergroundPC_DecorateTask: the player is hidden while the camera looks at the room.
    this.hero.visible = view === null;
    this.cameraYHistory = [];
    this.updateCamera();
    this.cameraPrev = [...this.cameraCur];
  }

  undergroundPlace() {
    return this.ug?.place() ?? null;
  }

  undergroundAhead() {
    return this.ug?.burialTile() ?? null;
  }

  undergroundView() {
    return this.ug?.view() ?? null;
  }

  undergroundMiningRand() {
    return this.ug?.mining ?? null;
  }

  private startWarp(zone: Id, x: number, z: number, facing: Facing, event: boolean, arrivalWarp?: number): void {
    if (this.warpState) throw new Error('world: warp already in progress');
    this.get('zones', zone);
    this.hero.motion = null;
    this.moving = false;
    this.sound.play(1539);
    this.warpState = { phase: 'out', stairs: false, event, zone, x, z, facing, ...(arrivalWarp !== undefined ? { arrivalWarp } : {}) };
    this.fade('out', WARP_FADE_TICKS, this.fadeColor);
  }

  warpDone(): boolean {
    return this.warpState === null;
  }

  fade(kind: 'in' | 'out', frames: number, color: 'black' | 'white'): void {
    // A fade in from another colour starts fully in that colour (the DS brightness fade starts at its own end
    // value: faded to black, a white fade-in snaps to white, then clears; Contests_* fade in white after black).
    if (color !== this.fadeColor && this.fadeAlpha > 0 && kind === 'in') this.fadeAlpha = 1;
    this.fadeColor = color;
    const to = kind === 'out' ? 1 : 0;
    this.fadeAnim = { color, from: this.fadeAlpha, to, ticks: Math.max(1, Math.round(frames * Math.abs(to - this.fadeAlpha))), elapsed: 0 };
  }

  fadeDone(): boolean {
    return this.fadeAnim === null;
  }

  startBattle(request: BattleRequest): void {
    const p = this.hero;
    // Every scripted encounter (trainers, static Pokémon, honey trees) clears the Poké Radar's chain (encounter.c).
    this.radar?.clear();
    const scene = battleScene(this.zone, this.behaviour(p.x, p.z), this.state.playerState === 'surf', this.battleTime());
    // Decomp Encounter_NewVsHoneyTree: BACKGROUND_PLAIN and TERRAIN_PLAIN.
    if (request.honeyTree && scene.background) {
      const ns = scene.background.slice(0, scene.background.indexOf(':'));
      scene.background = this.get('battleBackgrounds', `${ns}:BACKGROUND_PLAIN` as Id).id;
      scene.terrain = this.get('battleTerrains', `${ns}:TERRAIN_PLAIN` as Id).id;
    }
    // Decomp FieldBattleDTO_NewBattleTower: BACKGROUND_BATTLE_TOWER and TERRAIN_BATTLE_TOWER (the tower is indoors).
    if (request.frontier && scene.background) {
      const ns = scene.background.slice(0, scene.background.indexOf(':'));
      scene.background = this.get('battleBackgrounds', `${ns}:BACKGROUND_BATTLE_TOWER` as Id).id;
      scene.terrain = this.get('battleTerrains', `${ns}:TERRAIN_BATTLE_TOWER` as Id).id;
    }
    // Decomp Encounter_NewVsGiratinaOrigin: TERRAIN_GIRATINA (a pack with battle art has it).
    if (request.giratina && scene.terrain) scene.terrain = this.get('battleTerrains', `${scene.terrain.slice(0, scene.terrain.indexOf(':'))}:TERRAIN_GIRATINA` as Id).id;
    this.battles.start({ ...request, ...scene, weather: battleWeather(this.get('weathers', this.state.weather).name) });
  }

  activateRoamer(slot: number): void {
    activateRoamer(this.reg, this.state, slot);
  }

  battleDone(): BattleResult | null {
    return this.battles.done();
  }

  blackOut(): void {
    this.battles.blackOut();
  }

  addFreeCamera(x: number, z: number, track = true): void {
    this.cameraTracks = track;
    this.camera = this.newActor(LOCALID_CAMERA, null, x, z, this.hero.y, 'down', 0);
    this.camera.visible = false;
  }

  restoreCamera(): void {
    this.camera = null;
  }

  /**
   * Plays a door clip on the door prop (`animations.open`) whose placement falls in the 3×1 tile hitbox
   * x-1..x+1 of row z, edges included, in any loaded chunk (decomp DoorAnimation_FindDoorAndLoad →
   * FieldSystem_FindCollidingLoadedMapPropByModelIDs). A placement may lie outside its own chunk: the
   * Sunyshore Mart door belongs to the chunk north of its tile. It takes the clip's `ticks`; the door holds
   * its last frame until its next clip.
   */
  playDoor(x: number, z: number, kind: 'open' | 'close'): void {
    const door = this.findDoor(x, z);
    if (!door) throw new Error(`world: no door prop at ${x - 1}..${x + 1},${z} in ${this.zone.id}`);
    const clip = door.animations[kind];
    if (!clip) throw new Error(`world: door prop at ${door.x},${door.z} has no ${kind} animation`);
    this.doors = this.doors.filter((d) => d.x !== door.x || d.z !== door.z);
    this.doors.push({ x: door.x, z: door.z, anim: kind, tick: 0, ticks: clip.ticks });
    if (door.sounds) this.sound.play(door.sounds[kind]);
  }

  doorDone(): boolean {
    return this.doors.every((d) => d.tick >= d.ticks);
  }

  /**
   * Decomp FieldSystem_LoadPCAnimation: the first loaded PC prop (`animations['pc-on']`; the chunks around the
   * player, in matrix order) plays its clip like a door, held after `pc-on` until its `pc-off` ends.
   */
  playPcAnimation(use: 'pc-on' | 'pc-off'): void {
    const pc = this.findPc();
    if (!pc) throw new Error(`world: no PC prop loaded in ${this.zone.id}`);
    this.doors = this.doors.filter((d) => d.x !== pc.x || d.z !== pc.z);
    this.doors.push({ x: pc.x, z: pc.z, anim: use, tick: 0, ticks: pc.animations[use]!.ticks });
  }

  private findPc(): { x: number; z: number; animations: NonNullable<Prop['animations']> } | null {
    for (const { prop, wx, wz } of this.loadedProps()) {
      if (prop.animations?.['pc-on'] && prop.animations['pc-off']) return { x: Math.floor(wx / TILE), z: Math.floor(wz / TILE), animations: prop.animations };
    }
    return null;
  }

  /** TerrainCollisionHitbox_CollidesWithMapProp on the door hitbox: the placement within tiles [x-1, x+2]×[z, z+1], edges included. */
  /** Decomp ScriptManager_SetHiddenItem: the script's parameters 0–2 are the item, its quantity and its flag. */
  private hiddenItemParams(h: NonNullable<BgEvent['hiddenItem']>): number[] {
    const item = this.get('items', h.item).sourceIndex;
    const flag = this.get('flags', h.flag).sourceIndex;
    if (item === undefined || flag === undefined) throw new Error(`world: hidden item ${h.item} / ${h.flag} has no source index`);
    return [item, h.quantity, flag];
  }

  private findDoor(x: number, z: number): { x: number; z: number; animations: NonNullable<Prop['animations']>; sounds: Prop['doorSounds'] } | null {
    for (const { prop, wx, wz } of this.loadedProps()) {
      if (!prop.animations?.open) continue;
      if (wx >= (x - 1) * TILE && wx <= (x + 2) * TILE && wz >= z * TILE && wz <= (z + 1) * TILE) {
        return { x: Math.floor(wx / TILE), z: Math.floor(wz / TILE), animations: prop.animations, sounds: prop.doorSounds };
      }
    }
    return null;
  }

  /**
   * The props of the chunks around the player (the DS's loaded quadrants), in matrix order, at their world
   * position in world units (decomp TerrainCollisionManager_GetMapAbsoluteOrigin plus the placement).
   */
  private *loadedProps(): Generator<{ prop: Prop; wx: number; wz: number }> {
    const { offset } = this.grid;
    const px = Math.floor((this.hero.x - offset.x) / CHUNK_TILES);
    const pz = Math.floor((this.hero.z - offset.z) / CHUNK_TILES);
    for (let cz = pz - 1; cz <= pz + 1; cz++)
      for (let cx = px - 1; cx <= px + 1; cx++) {
        const c = cx >= 0 && cz >= 0 ? this.grid.chunkAt(offset.x + cx * CHUNK_TILES, offset.z + cz * CHUNK_TILES) : null;
        if (!c) continue;
        const ox = offset.x * TILE + cx * CHUNK_SIZE + CHUNK_SIZE / 2;
        const oz = offset.z * TILE + cz * CHUNK_SIZE + CHUNK_SIZE / 2;
        for (const pl of c.chunk.props) yield { prop: this.get('props', pl.prop), wx: ox + pl.position[0], wz: oz + pl.position[2] };
      }
  }
}
