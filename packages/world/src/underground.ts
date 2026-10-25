/**
 * The Underground's field, solo (decomp src/underground/manager.c, mining.c's field part, spheres.c, top_screen.c,
 * traps.c, secret_bases.c; src/comm_player_manager.c's moves; src/field_map_change.c's Underground map changes). Lives
 * while the player is in the Underground zone:
 * - on arrival the new day's mining spots and spawned traps are rolled (MiningEnv_Init), FLAG_ENTERED_UNDERGROUND is set
 *   and the top screen's ticker says the player has entered;
 * - A (UndergroundMan_ProcessInteract → _ProcessInteractEvent), in the DS's order: a buried trap ahead is dug up
 *   (Traps_TryDisengageTrap), a mining spot asks for the mining game, the base's PC opens (UndergroundPC_TryUsePC), a
 *   good on display shows its writing (SecretBases_CheckForInteractableGood), an object (a vendor) opens its shop, else a
 *   buried sphere comes up;
 * - a completed step onto a buried trap sets it off (CheckPlayerSteppedOnTrap; in the base, a tool on display:
 *   SecretBases_CheckPlayerTriggeredTool): its screen (`ug-trap`), then the slide, the hole or the altered steps;
 * - pushing into the base's entrance or onto its exit asks to go in or out (SecretBases_CheckForEnterExit); the Digger
 *   Drill digs a base into the wall ahead (SecretBases_ProcessBaseCreateRequest);
 * - a touch on the field runs the touch radar (UndergroundMan_CheckForTouchInput, TouchRadar_StartTask);
 * - every tick: the normal radar's blips (Mining_SendNormalRadarResults: after 20 ticks standing still, eight random
 *   spots near the player) and one buried sphere's sparkle every 20 ticks (Spheres_AdvanceBuriedSphereSparkleTimer).
 * Its messages are field notices, one after another (the DS's Underground text printer).
 *
 * The player's base: the own base is drawn in the base chunk the player is in, (0, 0) with the entrance closed and
 * (1, 0) with it open (SecretBases_GetBaseExitCoordinates with CommSys_IsAlone); a loaded save in a base knows which by
 * that chunk.
 */
import {
  baseBlocked,
  baseThings,
  BASE,
  buriedSphereAt,
  createUnderground,
  digBase,
  disengageTrap,
  GOOD,
  goodMessageAt,
  inSecretBase,
  miningRand,
  nearbySpots,
  readUnderground,
  retrieveSphere,
  spawnBuriedObjects,
  spotAt,
  takeTrap,
  TRAP,
  toolAt,
  touchRadar,
  trapAt,
  trapEffect,
  underground,
  undergroundInitSeed,
  UNDERGROUND_LIMITS,
  type ClockTime,
  type Id,
  type Rand32,
  type TrapEffect,
} from '@opensinnoh/core';
import {
  newGameRecord,
  saveTvSegment,
  UNDERGROUND_MARKER,
  type AppResult,
  type EffectView,
  type FeatureModelView,
  type Facing,
  type GameState,
  type Registries,
  type ScriptRunner,
  type UndergroundBasePrompt,
  type UndergroundDecorationView,
  type UndergroundFieldView,
  type UndergroundRequest,
  type UndergroundTables,
} from '@opensinnoh/contracts';
import { DELTA, OPPOSITE } from './movement.ts';
import { walk, type Actor } from './npc.ts';
import { TILE, tileCentre } from './tiles.ts';

/** The buried spheres' sparkle (Spheres_AdvanceBuriedSphereSparkleTimer): one slot every 20 ticks, all 100 in turn. */
const SPARKLE_PERIOD = 20;
/** Mining_SendNormalRadarResults: blips from the 20th tick standing still, one a tick, eight in all. */
const RADAR_DELAY = 20;
/** FIELD_EFFECT_RENDERER_09 (ov5_DisplayBuriedSphereSparkle). */
export const SPARKLE_RENDERER = 0x09;
/** The top screen's window: two lines of the ticker (top_screen.c's message window scrolls one line up per message). */
const LOG_LINES = 2;
/** CommPlayer_StartSlide: the move traps slide 27 tiles, the hurl traps 45. */
const SLIDE_TILES = { move: 27, hurl: 45 };
/** CommPlayerMan_PutPlayerInHole: 10 and 20 moves, two fewer turns to climb out. */
const HOLE_MOVES = { hole: 10, pit: 20 };
/** CommPlayerMan_SetPlayerAlteredMovement: 30 steps. */
const ALTERED_STEPS = 30;
/** The hole's depth (Player_SetYPos −2 / −3) and the climb out (Traps_HoleTrapClientTask's jumpYCoords, used part). */
const HOLE_DEPTH = { hole: 2, pit: 3 };
const HOLE_JUMP = [-1, 3, 7, 11, 15];
/** A turn's wait (CommPlayer_Move: moveTimerServer 4). */
const TURN_TICKS = 4;
/** UndergroundMan_CheckForTouchInput's cooldown and TouchRadar_DrawEffects' ring (scale 0–20). */
const TOUCH_COOLDOWN = 30;
const TOUCH_RING = 20;
/** The OK over a player who escaped (ov5_021F5488's 60-frame life). */
const OK_TICKS = 60;
/** The step back off a tool (Traps_StepBackFromTool: one tile, the client's 8-tick wait). */
const STEP_BACK_TICKS = 8;
/** DEFAULT_GOOD_POSITION … UndergroundPC_MoveCamera: the decoration looks at (15, 17) of the base. */
const DECORATION_CENTRE = { x: 15, z: 17 };
/** TRAINER_SCORE_EVENT_UNDERGROUND_NEW_SECRET_BASE. */
const SCORE_NEW_SECRET_BASE = 35;
/** The DS's directions as the base's entrance stores them (DIR_NORTH 0, SOUTH 1, WEST 2, EAST 3): the entrance goods. */
const DIR_INDEX: Record<Facing, number> = { up: 0, down: 1, left: 2, right: 3 };
/** UG_GOOD_BASE_ENTRANCE_NORTH: the entrances are goods 129–132 by direction. */
const ENTRANCE_GOOD = 129;
/** records.c DECORATION_MESSAGES_START: the goods' writing starts at the records bank's SomethingWrittenTotalScore. */
const WRITING_FIRST = 'UndergroundRecords_Text_SomethingWrittenTotalScore';

export interface UndergroundHost {
  reg: Registries;
  state: GameState;
  scripts: ScriptRunner;
  tables: UndergroundTables;
  /** The player's map object. */
  hero(): Actor;
  /** TerrainCollisionManager_CheckCollision (off the map: blocked). */
  blocked(x: number, z: number): boolean;
  /** CommPlayer_CheckCollision for a slide: the map, an object, the base's goods. */
  heroBlocked(x: number, z: number): boolean;
  /** The visible object standing on a tile (CommPlayer_CheckNPCCollision), its local id, or null. */
  objectAt(x: number, z: number): number | null;
  /** The player is between tiles (CommPlayer_GetMovementTimer). */
  moving(): boolean;
  matrix(): { width: number; height: number };
  /** The ground's height at a tile's centre (effects and props stand on it). */
  groundY(x: number, z: number): number;
  sparkle(x: number, z: number): void;
  playSe(name: string): void;
  clock(): ClockTime;
  /** A text record's markup (names in slots keep their colour codes). */
  text(id: Id): string;
  /** SecretBases_MoveToFromSecretBaseTask: the fade and the move within the Underground; `then` once it has faded back in. */
  baseMove(x: number, z: number, facing: Facing, then: () => void): void;
  trainerScore(event: number): void;
  stub(key: string, detail: string): void;
}

/** A trap at work on the player (TrapsEnv triggeredTrapIDClient and the CommPlayerManager's parts of it). */
type Running = { trap: number; effect: TrapEffect; tool: { dir: Facing; x: number; z: number } | null } & (
  | { phase: 'screen' }
  | { phase: 'slide'; dir: Facing; left: number; wait: number }
  | { phase: 'hole'; moves: number; cooldown: number; depth: number }
  | { phase: 'climb'; frame: number; depth: number }
  | { phase: 'altered'; steps: number; key: Facing | null; keyTicks: number }
  | { phase: 'step-back'; ticks: number }
);

/** USHRT_MAX: retrievedTrapCount stops there. */
const RETRIEVED_MAX = 0xffff;
/** TrapsEnv_Free: the traps dug up in one visit that make the record. */
const TV_TRAPS_RECORD = 10;
/** sub_0206DEEC: the count it keeps. */
const TV_TRAPS_MAX = 999;
const ugTile = (x: number, z: number) => [tileCentre(x), 0, tileCentre(z)] as [number, number, number];

export class UndergroundField {
  private readonly log: string[] = [];
  private readonly blips: ({ x: number; z: number } | null)[] = Array.from({ length: UNDERGROUND_LIMITS.blips }, () => null);
  private still = 0;
  private sparkleTimer = 0;
  private readonly notices: { text: Id; slots: string[] }[] = [];
  private request: UndergroundRequest | null = null;
  /** The radar's own picker (LCRNG_Next on the DS): presentation only, so it takes nothing from the game's streams. */
  private radarSeed = 0;
  /** The visit's mining generator (MiningEnv_Init → CommSys_Seed). */
  mining: Rand32 | null = null;
  /** The trap at work, if any. */
  private running: Running | null = null;
  /** SecretBasesEnv playerAffectedByTool: a tool went off and the player has not escaped it yet. */
  private toolSpent = false;
  /** The Digger Drill's pending entrance (SecretBases_SetBaseEntrancePropLocation before the prompt) and its trap slot. */
  private drilling: { x: number; z: number; dir: Facing; slot: number } | null = null;
  /** The base the player is in has its entrance closed (CommServerClient_IsInClosedSecretBase). */
  private closed = false;
  private touch: { x: number; z: number; tick: number; found: ReturnType<typeof touchRadar> } | null = null;
  private touchCooldown = 0;
  /** The decoration's view (AppHost.undergroundDecoration) while the PC's decoration runs. */
  decoration: UndergroundDecorationView | null = null;
  private moving = false;
  /**
   * TrapsEnv retrievedTrapCount and retrievedTrapID: the traps someone else set that the player dug up this visit, and
   * the first's kind. Alone, the day's hidden traps count (their slots lie past the players', so their setter is never
   * the player); the player's own laid traps do not.
   */
  private retrieved = { count: 0, trap: 0 };
  /**
   * The mark over the player (CommPlayerManager emote): the '!' from a trap going off until the player is free, then the
   * OK for its 60 ticks (UndergroundPlayer_AddExclamationEmote, _AddOKEmote, _RemoveEmote).
   */
  private emote: { kind: 'exclamation' } | { kind: 'ok'; ticks: number } | null = null;
  /** The rock trap's shadow size (AppHost.undergroundTrapShadow), null when none. */
  trapShadow: number | null = null;

  constructor(private readonly h: UndergroundHost) {}

  /** TrapsEnv_Free as the player leaves the Underground: ten or more traps dug up make the TV's traps record (sub_0206DEEC). */
  leave(): void {
    if (this.retrieved.count >= TV_TRAPS_RECORD) saveTvSegment(this.h.state, { kind: 'traps', trap: this.retrieved.trap, count: Math.min(this.retrieved.count, TV_TRAPS_MAX) });
  }

  private get ns(): string {
    return this.h.tables.zone.slice(0, this.h.tables.zone.indexOf(':'));
  }

  private textId(name: string): Id {
    return `${this.ns}:${name}` as Id;
  }

  private bankMessage(bank: string, index: number): string {
    const b = this.h.reg.textBanks.get(this.textId(bank));
    const id = b?.messages[index];
    if (!id) throw new Error(`underground: ${bank} has no message ${index}`);
    return this.h.text(id);
  }

  /** TEXT_BANK_UNDERGROUND_ITEMS (with articles): an Underground item's name markup. */
  itemName(id: number, article = false): string {
    return this.bankMessage(article ? 'TEXT_BANK_UNDERGROUND_ITEM_NAMES_WITH_ARTICLES' : 'TEXT_BANK_UNDERGROUND_ITEMS', id);
  }

  /** TEXT_BANK_UNDERGROUND_TRAPS (with articles): a trap's name markup. */
  private trapName(id: number, article = false): string {
    return this.bankMessage(article ? 'TEXT_BANK_UNDERGROUND_TRAP_NAMES_WITH_ARTICLES' : 'TEXT_BANK_UNDERGROUND_TRAPS', id);
  }

  private say(name: string, slots: string[] = []): void {
    this.notices.push({ text: this.textId(name), slots });
  }

  /** A ticker line (UndergroundMan_GetQueuedMessage's lines), the newest last. */
  private ticker(name: string, slots: string[]): void {
    const markup = this.h.text(this.textId(name));
    const plain = markup
      .replace(/\{var (\d+)\}/g, (_, n: string) => slots[Number(n)] ?? '')
      .replace(/\{color \d+\}/g, '')
      .replace(/\{[a-z]+[^}]*\}/g, ' ');
    for (const line of plain.split(/\n/)) if (line.trim()) this.log.push(line.trim());
    this.log.splice(0, Math.max(0, this.log.length - LOG_LINES));
  }

  /**
   * The arrival (CommManUnderground_EnterUnderground: UndergroundMan_Init sets FLAG_ENTERED_UNDERGROUND, MiningEnv_Init
   * seeds the mining generator and rolls the day's spots and traps when due): NOT DS, the visit's vendor talks start over
   * (the Spiritomb option). A loaded save (the DS cannot save down here; replays reload anywhere) changes nothing.
   */
  arrive(load: boolean): void {
    this.mining = miningRand(this.h.clock(), readUnderground(this.h.state).steps);
    const p = this.h.hero();
    this.closed = this.baseChunk(p.x, p.z) === 0;
    if (load) {
      this.radarSeed = readUnderground(this.h.state).seed ^ 0x52414452;
      return;
    }
    const u = createUnderground(this.h.state, undergroundInitSeed(this.h.clock(), this.h.state.trainerId));
    this.radarSeed = u.seed ^ 0x52414452;
    if (u.respawn) spawnBuriedObjects(u, (x, z) => this.h.blocked(x, z), this.h.matrix(), this.h.tables.spawnTraps);
    u.vendorTalks = [];
    this.h.state.flags[this.h.tables.flags.entered] = true;
    this.ticker('UndergroundCommon_Text_PlayerHasEntered', ['', this.h.state.names.player]);
  }

  /** The tile in front of the player (CommPlayer_GetX/ZInFrontOfPlayer). */
  ahead(): { x: number; z: number } {
    const p = this.h.hero();
    const [dx, dz] = DELTA[p.facing];
    return { x: p.x + dx, z: p.z + dz };
  }

  /** What a burial there meets (Spheres_TryBurySphere's checks). */
  burialTile(): { x: number; z: number; secretBase: boolean; object: boolean; wall: boolean } {
    const { x, z } = this.ahead();
    return { x, z, secretBase: inSecretBase(x, z), object: this.h.objectAt(x, z) !== null, wall: this.h.blocked(x, z) };
  }

  // ---------------------------------------------------------------- the base's place

  /** The own base chunk a tile is in: 0 (the entrance closed), 1 (open), or null (elsewhere). */
  private baseChunk(x: number, z: number): 0 | 1 | null {
    if (z < 0 || z >= BASE.depth || x < 0 || x >= 2 * BASE.width) return null;
    return x < BASE.width ? 0 : 1;
  }

  /** Where the player is (AppHost.undergroundPlace). */
  place(): 'corridor' | 'open' | 'closed' {
    const p = this.h.hero();
    const chunk = this.baseChunk(p.x, p.z);
    return chunk === null ? 'corridor' : this.closed ? 'closed' : 'open';
  }

  /** The PC's good by flag rank (SecretBase_GetPCGoodID): solo, always the normal flag's. */
  private readonly pc = GOOD.pc;

  /** SecretBases_AreCoordinatesWalkable: the own base's PC, goods and boulders (null tiles elsewhere). */
  baseBlocked(x: number, z: number): boolean {
    const chunk = this.baseChunk(x, z);
    const base = readUnderground(this.h.state).base;
    if (chunk === null || !base) return false;
    if (this.decoration) return false;
    return baseBlocked(base, this.h.tables.goods, this.pc, x - chunk * BASE.width, z);
  }

  // ---------------------------------------------------------------- A

  /**
   * A (UndergroundMan_ProcessInteractEvent, solo): a buried trap, a mining spot, the base's PC, a good's writing, then an
   * object (a vendor's shop; any other object's own script runs, as Roark's), then a buried sphere. Returns whether the
   * press was taken.
   */
  interact(): boolean {
    if (this.running || this.touch) return true;
    const { x, z } = this.ahead();
    const u = readUnderground(this.h.state);
    if (this.disengage(x, z)) return true;
    const spot = spotAt(u, x, z);
    if (spot >= 0) {
      this.request = { app: 'mining', spot };
      return true;
    }
    const p = this.h.hero();
    const chunk = this.baseChunk(x, z);
    if (chunk !== null && u.base) {
      // UndergroundPC_GetPCOwnerNetIDAtCoordinates: facing north at the PC's two tiles.
      const lx = x - chunk * BASE.width;
      if (p.facing === 'up' && z === BASE.pc.z && (lx === BASE.pc.x || lx === BASE.pc.x + 1)) {
        this.h.playSe('SEQ_SE_DP_PC_ON');
        this.request = { app: 'ug-pc' };
        return true;
      }
      if (this.baseBlocked(x, z)) {
        const writing = goodMessageAt(u.base, this.h.tables.goods, lx, z);
        if (writing) {
          this.writing(writing.message);
          return true;
        }
      }
    }
    const vendor = this.h.tables.vendors.findIndex((v) => v.x === x && v.z === z);
    if (vendor >= 0 && this.h.objectAt(x, z) !== null) {
      this.request = { app: 'ug-vendor', vendor };
      return true;
    }
    if (this.h.objectAt(x, z) !== null) return false;
    const buried = buriedSphereAt(u, x, z);
    if (buried < 0) return false;
    // Spheres_ProcessRetrieveBuriedSphereRequest.
    const sphere = retrieveSphere(underground(this.h.state), buried);
    if (!sphere) {
      this.say('UndergroundCommon_Text_NoRoomForSphere');
      return true;
    }
    this.h.playSe('SEQ_SE_DP_PIRORIRO2');
    this.say('UndergroundCommon_Text_YouObtainedSphere', ['', String(sphere.size), this.itemName(sphere.type, true)]);
    if (sphere.growth > 0) this.say('UndergroundCommon_Text_ItsSizeGrewBiggerBy', [String(sphere.growth)]);
    // Spheres_GetQueuedMessage: "{a sphere} was obtained!" on the top screen.
    this.ticker('UndergroundCommon_Text_ItemWasObtainedExclamationPoint', ['', '', capitalize(this.itemName(sphere.type, true))]);
    return true;
  }

  /** Traps_TryDisengageTrap and Traps_ProcessDisengagedTrap: a buried trap ahead comes up into the trap inventory. */
  private disengage(x: number, z: number): boolean {
    const u = readUnderground(this.h.state);
    const hit = trapAt(u, x, z);
    if (!hit) return false;
    const result = disengageTrap(underground(this.h.state), x, z);
    if (result === 'full') {
      this.say('UndergroundCommon_Text_NoRoomForTrap');
      return true;
    }
    if (hit.source === 'spawned') {
      if (this.retrieved.count === 0) this.retrieved.trap = hit.trap;
      if (this.retrieved.count !== RETRIEVED_MAX) this.retrieved.count++;
    }
    this.h.playSe('SEQ_SE_DP_PIRORIRO2');
    const name = this.h.state.names.player;
    this.say('UndergroundCommon_Text_TrapFoundPlayerDisengaged', ['', name, '', capitalize(this.trapName(hit.trap, true)), this.trapName(hit.trap)]);
    this.ticker('UndergroundCommon_Text_PlayerDisengagedTrap', [name]);
    return true;
  }

  /** UndergroundRecords_PrintEntryForDecoration: the record a good's writing shows, the number in slot 6 (UndergroundTextPrinter_SetNumber). */
  private writing(message: number): void {
    const bank = this.h.reg.textBanks.get(this.textId('TEXT_BANK_UNDERGROUND_RECORDS'));
    const first = bank?.messages.indexOf(this.textId(WRITING_FIRST)) ?? -1;
    const id = bank?.messages[message];
    if (first < 0 || !id) throw new Error(`underground: the records bank has no writing ${message}`);
    const u = readUnderground(this.h.state);
    // sGetRecordEntryFuncs: the solo game counts score, Spheres, Fossils, its own traps set off and base moves.
    const values = [this.h.state.records.score, 0, 0, 0, u.records.spheresDug, u.records.fossilsDug, 0, u.records.trapsTriggered, 0, 0, 0, 0, u.records.baseMoves, 0];
    const value = values[message - first];
    if (value === undefined) throw new Error(`underground: writing ${message} has no record`);
    this.notices.push({ text: id, slots: ['', '', '', '', '', '', String(value)] });
  }

  takeRequest(): UndergroundRequest | null {
    const r = this.request;
    this.request = null;
    return r;
  }

  /** An app the field asked for closed. */
  appDone(result: AppResult): void {
    switch (result.app) {
      case 'mining':
        // The mining game's dig is on the top screen's ticker (Mining_GetQueuedMessage).
        if (result.dug) this.ticker('UndergroundCommon_Text_PlayerIsDiggingForTreasure', [this.h.state.names.player]);
        return;
      case 'ug-trap':
        return this.trapScreenDone(result.escaped);
      case 'ug-base':
        return this.basePromptDone(result.prompt, result.answer);
    }
  }

  /** Messages, a request or a trap at work: the field is not idle until they are done. */
  busy(): boolean {
    return this.notices.length > 0 || this.request !== null || (this.running !== null && this.running.phase !== 'altered') || this.touch !== null || this.moving;
  }

  // ---------------------------------------------------------------- traps

  /**
   * After a completed step (CommPlayer_Move: moveTimerServer at 0): a buried trap under the player goes off
   * (CheckPlayerSteppedOnTrap), else in the base a tool on display (SecretBases_CheckPlayerTriggeredTool); the altered
   * steps count down. Returns whether a trap went off.
   */
  stepped(): boolean {
    const p = this.h.hero();
    const run = this.running;
    if (run?.phase === 'altered') {
      run.steps--;
      if (run.steps === 0) this.escape();
    }
    const u = readUnderground(this.h.state);
    const hit = trapAt(u, p.x, p.z);
    if (hit) {
      if (this.running) this.endRunning();
      takeTrap(underground(this.h.state), hit);
      this.trigger(hit.trap, null, hit.source === 'placed');
      return true;
    }
    const chunk = this.baseChunk(p.x, p.z);
    if (chunk === null || !u.base || this.running || this.toolSpent) return false;
    const tool = toolAt(u.base, p.x - chunk * BASE.width, p.z);
    if (tool === null) return false;
    this.toolSpent = true;
    this.trigger(tool, { dir: p.facing, x: p.x, z: p.z }, false);
    return true;
  }

  /** Traps_HandleTriggeredTrap for the player: the trap's sound, the '!', the records, its screen. */
  private trigger(trap: number, tool: Running['tool'], own: boolean): void {
    const u = underground(this.h.state);
    this.h.playSe('SEQ_SE_DP_UG_007');
    this.emote = { kind: 'exclamation' };
    u.records.trapsTriggered = Math.min(999999, u.records.trapsTriggered + 1);
    const name = this.h.state.names.player;
    const effect = trapEffect(trap);
    if (own) {
      // The setter's side: one more trap set off (VAR_UNDERGROUND_TRAPS_SET); hits count only other players'.
      const v = this.h.tables.traps.vars.trapsSet;
      this.h.state.vars[v] = Math.min(0xffff, (this.h.state.vars[v] ?? this.h.reg.vars.get(v)?.initial ?? 0) + 1);
    }
    // Traps_GetQueuedMessage(2): the alert, else who set it off (a tool's message has no setter on a solo DS).
    if (effect.kind === 'alert') this.ticker(['UndergroundCommon_Text_AlertHello', 'UndergroundCommon_Text_AlertGoodbye', 'UndergroundCommon_Text_AlertLetsGoToUnionRoom', 'UndergroundCommon_Text_AlertComeHere'][effect.n]!, [name]);
    else if (own) this.ticker('UndergroundCommon_Text_PlayerTriggeredOtherPlayersTrap', [name, name]);
    else this.ticker('UndergroundCommon_Text_PlayerTriggeredTrap', [name]);
    this.running = { trap, effect, tool, phase: 'screen' };
    this.request = { app: 'ug-trap', trap, tool: tool !== null };
  }

  /** The trap's screen closed: escaped, or the field's part begins (Traps_*TrapEffectServer's moves). */
  private trapScreenDone(escaped: boolean): void {
    const run = this.running;
    if (!run || run.phase !== 'screen') throw new Error('underground: a trap screen closed with no trap at work');
    if (escaped) return this.escape();
    const p = this.h.hero();
    const e = run.effect;
    switch (e.kind) {
      case 'slide':
        // CommPlayer_StartSlide: the player faces back the way they came, their sprite's frame held.
        p.facing = OPPOSITE[e.dir];
        p.dirLocked = true;
        p.animPaused = true;
        this.h.playSe('SEQ_SE_DP_F007');
        this.running = { ...run, phase: 'slide', dir: e.dir, left: e.hurl ? SLIDE_TILES.hurl : SLIDE_TILES.move, wait: 0 };
        return;
      case 'hole': {
        const depth = e.pit ? HOLE_DEPTH.pit : HOLE_DEPTH.hole;
        p.lift = -depth;
        // CommPlayerMan_PutPlayerInHole's 15-tick wait has run out during the trap's screen.
        this.running = { ...run, phase: 'hole', moves: e.pit ? HOLE_MOVES.pit : HOLE_MOVES.hole, cooldown: 0, depth };
        return;
      }
      case 'altered':
        this.running = { ...run, phase: 'altered', steps: ALTERED_STEPS, key: null, keyTicks: 0 };
        return;
    }
    throw new Error(`underground: trap ${run.trap}'s screen ended unescaped`);
  }

  /** Traps_EscapeTrapServer → Traps_ProcessEscapedTrap: the player is free (the OK over them); a tool's victim steps back off it. */
  private escape(): void {
    const run = this.running!;
    this.endRunning();
    this.emote = { kind: 'ok', ticks: OK_TICKS };
    if (run.effect.kind !== 'alert') this.ticker('UndergroundCommon_Text_PlayerEscapedFromTrap', [this.h.state.names.player]);
    if (!run.tool) return;
    // Traps_StepBackFromTool: back one tile from the tool, facing away from it.
    const back = OPPOSITE[run.tool.dir];
    const [dx, dz] = DELTA[back];
    const p = this.h.hero();
    p.facing = back;
    if (!this.h.heroBlocked(run.tool.x + dx, run.tool.z + dz)) walk(p, back, STEP_BACK_TICKS, 'walk', 'auto');
    this.running = { ...run, phase: 'step-back', ticks: STEP_BACK_TICKS };
  }

  /** The trap's field part stops (Traps_EndTrapEffectServer): the slide's hold, the hole's depth. */
  private endRunning(): void {
    const p = this.h.hero();
    p.dirLocked = false;
    p.animPaused = false;
    p.lift = 0;
    this.emote = null;
    this.running = null;
  }

  /**
   * The player's input while a trap is at work (CommPlayer_Move): null holds the player (the screen, the slide, the
   * hole); the altered steps mirror the d-pad (CommSys_ApplyMovementModifiers: reverse) or hold a random direction for
   * up to 15 ticks while any is held (random, on the visit's generator here; the DS's comm generator).
   */
  input<T extends { held: readonly string[]; pressed: readonly string[] }>(input: T): T | null {
    const run = this.running;
    if (this.touch || this.decoration) return null;
    if (!run) return input;
    if (run.phase !== 'altered') return null;
    const dirs = ['left', 'right', 'up', 'down'] as const;
    const held = dirs.filter((d) => input.held.includes(d));
    if (!held.length) return input;
    let to: readonly string[];
    if (run.effect.kind === 'altered' && run.effect.reverse) to = held.map((d) => OPPOSITE[d]);
    else {
      if (run.key === null || run.keyTicks < 0) {
        run.key = dirs[this.mining!.next(4)]!;
        run.keyTicks = this.mining!.next(16);
      }
      to = [run.key];
      run.keyTicks--;
      if (run.keyTicks < 0) run.key = null;
    }
    const swap = (list: readonly string[]) => [...list.filter((b) => !(dirs as readonly string[]).includes(b)), ...to];
    return { ...input, held: swap(input.held), pressed: input.pressed.some((b) => (dirs as readonly string[]).includes(b)) ? swap(input.pressed) : input.pressed };
  }

  /** The trap's field part, one tick (the server's CommPlayer_MoveSlide, the hole's turns, the climb out). */
  private stepRunning(input: { held: readonly string[] }): void {
    const run = this.running;
    if (!run) return;
    const p = this.h.hero();
    switch (run.phase) {
      case 'slide': {
        if (this.h.moving()) return;
        // Sliding onto another buried trap sets it off (CheckPlayerSteppedOnTrap ends the slide first).
        const hit = trapAt(readUnderground(this.h.state), p.x, p.z);
        if (hit) {
          this.endRunning();
          takeTrap(underground(this.h.state), hit);
          return this.trigger(hit.trap, null, hit.source === 'placed');
        }
        if (run.wait > 0) {
          run.wait--;
          if (run.wait > 0) return;
          return this.escape();
        }
        // CommPlayerMan_GetSlideMovementSpeed: 2 ticks a tile, then 4 below ten tiles left, 8 below five.
        const ticks = run.left < 5 ? 8 : run.left < 10 ? 4 : 2;
        run.left--;
        const [dx, dz] = DELTA[run.dir];
        if (run.left !== 0 && this.h.heroBlocked(p.x + dx, p.z + dz)) run.left = 1;
        if (run.left <= 1) {
          run.wait = ticks;
          return;
        }
        walk(p, run.dir, ticks, 'walk', 'auto');
        return;
      }
      case 'hole': {
        if (run.cooldown > 0) {
          run.cooldown--;
          return;
        }
        if (run.moves === 2) {
          // Traps_EscapeHole: the climb out.
          this.h.playSe('SEQ_SE_DP_DANSA');
          this.running = { ...run, phase: 'climb', frame: 0 };
          return;
        }
        const dir = (['left', 'right', 'up', 'down'] as const).find((d) => input.held.includes(d));
        if (!dir || dir === p.facing) return;
        p.facing = dir;
        this.h.playSe('SEQ_SE_DP_BOX02');
        run.cooldown = TURN_TICKS;
        if (run.moves > 2) run.moves--;
        return;
      }
      case 'climb':
        p.lift = HOLE_JUMP[run.frame]!;
        run.frame++;
        if (run.frame === HOLE_JUMP.length) this.escape();
        return;
      case 'step-back':
        run.ticks--;
        if (run.ticks <= 0) this.running = null;
        return;
    }
  }

  // ---------------------------------------------------------------- the secret base

  /**
   * Pushing toward a tile (CommPlayer_Move → SecretBases_CheckForEnterExit, before the collision): the own base's
   * entrance asks to go in, the base's exit to go out. Returns whether a prompt opens.
   */
  push(x: number, z: number): boolean {
    if (this.running || this.request) return false;
    const base = readUnderground(this.h.state).base;
    if (!base) return false;
    const p = this.h.hero();
    if (this.baseChunk(p.x, p.z) === null) {
      if (x !== base.entrance.x || z !== base.entrance.z) return false;
      return this.prompt('enter');
    }
    if (x % BASE.width !== BASE.exit.x || z !== BASE.exit.z) return false;
    return this.prompt('exit');
  }

  private prompt(prompt: UndergroundBasePrompt): boolean {
    this.request = { app: 'ug-base', prompt };
    return true;
  }

  /**
   * The Digger Drill (SecretBases_ProcessBaseCreateRequest): the wall ahead and the tiles beside it must all be walls,
   * outside a base; then the drill's prompt (with the entrance drawn where it would be).
   */
  drill(slot: number): void {
    const p = this.h.hero();
    const { x, z } = this.ahead();
    const [sx, sz] = p.facing === 'up' || p.facing === 'down' ? [1, 0] : [0, 1];
    if (inSecretBase(x, z)) return this.say('UndergroundCommon_Text_CantDrillInBase');
    const base = readUnderground(this.h.state).base;
    const wall = this.h.blocked(x, z) && this.h.blocked(x + sx, z + sz) && this.h.blocked(x - sx, z - sz);
    if (!wall || (base && base.entrance.x === x && base.entrance.z === z)) return this.say('UndergroundCommon_Text_CantBeUsedHere');
    this.h.playSe('SEQ_SE_DP_DORIRU');
    this.drilling = { x, z, dir: OPPOSITE[p.facing], slot };
    this.prompt('drill');
  }

  private basePromptDone(prompt: UndergroundBasePrompt, answer: 'yes' | 'no' | 'open' | 'close'): void {
    switch (prompt) {
      case 'drill': {
        const d = this.drilling!;
        this.drilling = null;
        if (answer !== 'yes') return this.say('UndergroundCommon_Text_ClosedHole');
        const u = underground(this.h.state);
        if (u.traps[d.slot] !== TRAP.diggerDrill) throw new Error(`underground: trap slot ${d.slot} is not the Digger Drill`);
        u.traps.splice(d.slot, 1);
        digBase(u, { x: d.x, z: d.z, dir: d.dir }, this.mining!);
        this.h.state.flags[this.h.tables.base.flags.created] = true;
        this.h.trainerScore(SCORE_NEW_SECRET_BASE);
        this.h.stub('journal:secret-base', 'the journal\'s "built a Secret Base" entry is not recorded yet');
        return this.enterBase(true);
      }
      case 'enter':
        if (answer === 'open' || answer === 'close') this.enterBase(answer === 'close');
        return;
      case 'exit': {
        if (answer !== 'yes') return;
        const e = readUnderground(this.h.state).base!.entrance;
        const [dx, dz] = DELTA[e.dir];
        this.moving = true;
        this.h.playSe('SEQ_SE_DP_KAIDAN2');
        this.h.baseMove(e.x + dx, e.z + dz, e.dir, () => {
          this.moving = false;
          this.closed = false;
        });
        return;
      }
    }
  }

  /**
   * SecretBases_TryEnterBase → SecretBases_ProcessBaseEnter: to the base's exit, a tile in, facing north; with the
   * entrance closed the player is told it is blocked (MOVE_STATE_BLOCK_ENTRANCE).
   */
  private enterBase(closed: boolean): void {
    const chunk = closed ? 0 : 1;
    this.moving = true;
    this.h.playSe('SEQ_SE_DP_KAIDAN2');
    this.h.baseMove(chunk * BASE.width + BASE.exit.x, BASE.exit.z - 1, 'up', () => {
      this.moving = false;
      this.closed = closed;
      if (!closed) return;
      this.h.playSe('SEQ_SE_DP_DOOR');
      this.say('UndergroundCommon_Text_BlockedEntranceToDecorate');
    });
  }

  /** The decoration's camera target (UndergroundPC_MoveCamera: (15, 17) of the base), world units; null when none runs. */
  decorationCamera(): [number, number, number] | null {
    if (!this.decoration) return null;
    const p = this.h.hero();
    const chunk = this.baseChunk(p.x, p.z) ?? 0;
    const x = chunk * BASE.width + DECORATION_CENTRE.x;
    return [x * TILE + TILE / 2, this.h.groundY(x, DECORATION_CENTRE.z), DECORATION_CENTRE.z * TILE + TILE / 2];
  }

  // ---------------------------------------------------------------- the touch radar

  /**
   * A touch on the field (UndergroundMan_CheckForTouchInput: not while moving, trapped or busy; 30 ticks apart): the
   * ring at the touched tile, and the traps, mining spots and buried spheres near it (TouchRadar_StartTask).
   */
  touched(x: number, z: number): void {
    if (this.touchCooldown > 0 || this.running || this.h.moving() || this.busy()) return;
    this.touchCooldown = TOUCH_COOLDOWN;
    this.h.playSe('SEQ_SE_PL_UG_006');
    this.touch = { x, z, tick: 0, found: touchRadar(readUnderground(this.h.state), x, z) };
  }

  /** One field tick: the next message when the box is free, the trap at work, the touch radar, the radar, the sparkles. */
  step(input: { held: readonly string[] }): void {
    if (this.notices.length && !this.h.scripts.running()) {
      const n = this.notices.shift()!;
      this.h.scripts.notice(n.text, n.slots);
    }
    if (!this.h.scripts.running() && !this.request) this.stepRunning(input);
    if (this.touchCooldown > 0) this.touchCooldown--;
    if (this.emote?.kind === 'ok' && --this.emote.ticks <= 0) this.emote = null;
    if (this.touch && ++this.touch.tick > TOUCH_RING) this.touch = null;
    // Mining_SendNormalRadarResults: still for 20 ticks, then a blip a tick for eight ticks.
    if (this.h.moving()) this.still = 0;
    else if (this.still < RADAR_DELAY + UNDERGROUND_LIMITS.blips) {
      this.still++;
      if (this.still > RADAR_DELAY) {
        const p = this.h.hero();
        const near = nearbySpots(readUnderground(this.h.state), p.x, p.z);
        this.radarSeed = (Math.imul(this.radarSeed, 1103515245) + 24691) >>> 0;
        const spot = near.length ? readUnderground(this.h.state).spots[near[(this.radarSeed >>> 16) % near.length]!]! : null;
        this.blips[this.still - RADAR_DELAY - 1] = spot ? { x: spot.x, z: spot.z } : null;
      }
    }
    // Spheres_AdvanceBuriedSphereSparkleTimer.
    this.sparkleTimer = (this.sparkleTimer + 1) % (UNDERGROUND_LIMITS.buried * SPARKLE_PERIOD);
    if (this.sparkleTimer % SPARKLE_PERIOD === SPARKLE_PERIOD / 2) {
      const b = readUnderground(this.h.state).buried[Math.floor(this.sparkleTimer / SPARKLE_PERIOD)];
      if (b) this.h.sparkle(b.x, b.z);
    }
  }

  // ---------------------------------------------------------------- views

  /**
   * The top screen (UndergroundTopScreen_Task): the player's marker in the main area, the blips, the base's entrance
   * (UndergroundMan_GetRadarItemAnimID's last slot), the ticker; and the touch radar.
   */
  view(): UndergroundFieldView {
    const p = this.h.hero();
    const L = UNDERGROUND_LIMITS;
    const main = (x: number, z: number) => ({ x: x - L.mainStart.x, z: z - L.mainStart.z });
    const base = readUnderground(this.h.state).base;
    const blips = this.blips.flatMap((b) => (b && !inSecretBase(b.x, b.z) ? [{ ...main(b.x, b.z), anim: UNDERGROUND_MARKER.spot as number }] : []));
    if (base) blips.push({ ...main(base.entrance.x, base.entrance.z), anim: UNDERGROUND_MARKER.base });
    const t = this.touch;
    return {
      player: inSecretBase(p.x, p.z) ? null : main(p.x, p.z),
      blips,
      log: [...this.log],
      touchRadar: t ? { x: t.x, z: t.z, tick: t.tick, ...t.found } : null,
    };
  }

  /**
   * The Underground's own props (FieldView.props): the base's entrance (SecretBases_DrawBaseEntrancesTask, or the
   * drill's pending one) in the corridors; in the base, its PC, goods and boulders (SecretBase_LoadProps: centred on
   * their footprint, 1 unit up) or the decoration's, and the decoration's cursor.
   */
  props(): FeatureModelView[] {
    const out: FeatureModelView[] = [];
    const goods = this.h.tables.goods;
    const p = this.h.hero();
    const u = readUnderground(this.h.state);
    const chunk = this.baseChunk(p.x, p.z);
    const prop = (good: number) => goods[good]?.prop ?? null;
    if (chunk === null) {
      const entrances = [u.base?.entrance, this.drilling].filter((e): e is { x: number; z: number; dir: Facing } => !!e);
      for (const [i, e] of entrances.entries()) {
        const id = prop(ENTRANCE_GOOD + DIR_INDEX[e.dir]);
        if (id) out.push({ key: `ug-entrance-${i}`, prop: id, position: [tileCentre(e.x), this.h.groundY(e.x, e.z), tileCentre(e.z)], rotation: [0, 0, 0] });
      }
      return out;
    }
    if (!u.base) return out;
    const ox = chunk * BASE.width;
    const things = this.decoration
      ? [...this.decoration.things.filter((t) => !t.hidden), ...(this.decoration.held && !this.decoration.held.hidden ? [{ index: -1, ...this.decoration.held }] : [])]
      : baseThings(u.base, this.pc);
    for (const t of things) {
      const id = prop(t.good);
      const g = goods[t.good]!;
      if (!id) continue;
      const x = (ox + t.x) * TILE + (g.width * TILE) / 2;
      const z = t.z * TILE + (g.depth * TILE) / 2;
      out.push({ key: `ug-good-${t.index}-${t.good}`, prop: id, position: [x, 1, z], rotation: [0, 0, 0] });
    }
    const cursor = this.decoration?.cursor;
    const model = this.h.tables.base.cursor;
    if (cursor && model) out.push({ key: 'ug-cursor', model, position: [tileCentre(ox + cursor.x), 1, tileCentre(cursor.z)], rotation: [0, 0, 0] });
    return out;
  }

  /**
   * The floor marks of the player's laid traps (Traps_DrawPlacedTrap), the hole under a trapped player, the rock trap's
   * shadow (ov5_DrawGrowingFloorTexture) and the '!' or OK over the player (anchored on the player; the renderer adds
   * the DS offsets and turns them to the camera).
   */
  effects(): EffectView[] {
    const out: EffectView[] = [];
    const t = this.h.tables.traps;
    for (const [i, trap] of readUnderground(this.h.state).placedTraps.entries()) {
      const cur = ugTile(trap.x, trap.z);
      cur[1] = this.h.groundY(trap.x, trap.z);
      out.push({ key: 0x75470000 + i, effect: t.marks[trap.trap - 1]!, cur, prev: cur, tick: 0 });
    }
    const run = this.running;
    if (run && (run.phase === 'hole' || (run.phase === 'climb' && run.frame < HOLE_JUMP.length - 1))) {
      const p = this.h.hero();
      const cur = ugTile(p.x, p.z);
      cur[1] = this.h.groundY(p.x, p.z);
      out.push({ key: 0x75470100, effect: t.hole, cur, prev: cur, tick: 0, scale: run.depth });
    }
    const p = this.h.hero();
    if (this.trapShadow !== null) {
      const cur = ugTile(p.x, p.z);
      cur[1] = this.h.groundY(p.x, p.z);
      out.push({ key: 0x75470101, effect: t.hole, cur, prev: cur, tick: 0, scale: this.trapShadow });
    }
    if (this.emote) {
      const effect = this.emote.kind === 'ok' ? t.emotes.ok : t.emotes.exclamation;
      out.push({ key: this.emote.kind === 'ok' ? 0x75470201 : 0x75470200, effect, cur: [...p.cur], prev: [...p.prev], tick: this.emote.kind === 'ok' ? OK_TICKS - this.emote.ticks : 0 });
    }
    return out;
  }
}

/** StringTemplate_CapitalizeArgAtIndex: the first letter after any colour code. */
function capitalize(markup: string): string {
  return markup.replace(/^((?:\{[^}]*\})*)(.)/, (_, codes: string, c: string) => codes + c.toUpperCase());
}

/** The Underground's tables, or null in packs without one. */
export const undergroundTables = (reg: Registries): UndergroundTables | null => newGameRecord(reg).underground ?? null;

/**
 * MapChangeUndergroundContext_New going down: the surface chunk (x / 32 − 1, z / 32 − 6) halved onto the Underground's
 * matrix (+1, +3), at tile 8 or 23 of the chunk by the surface chunk's parity.
 */
export function undergroundArrival(x: number, z: number): { x: number; z: number } {
  let mx = Math.floor(x / 32) - 1;
  let mz = Math.floor(z / 32) - 6;
  if (mx < 0 || mz < 0) throw new Error(`underground: the surface tile ${x},${z} has no Underground below it`);
  const tx = mx % 2 === 0 ? 8 : 23;
  const tz = mz % 2 === 0 ? 8 : 23;
  mx = Math.floor(mx / 2) + 1;
  mz = Math.floor(mz / 2) + 3;
  return { x: mx * 32 + tx, z: mz * 32 + tz };
}
