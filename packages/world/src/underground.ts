/**
 * The Underground's field, solo (decomp src/underground/manager.c, mining.c's field part, spheres.c, top_screen.c;
 * src/field_map_change.c's Underground map changes). Lives while the player is in the Underground zone:
 * - on arrival the new day's mining spots and spawned traps are rolled (MiningEnv_Init), FLAG_ENTERED_UNDERGROUND is set
 *   and the top screen's ticker says the player has entered;
 * - A (UndergroundMan_ProcessInteract → _ProcessInteractEvent): a mining spot ahead asks for the mining game, an object
 *   ahead (a vendor) for its shop, else a buried sphere ahead comes up; the traps, PC and goods (not implemented yet) come first on the DS;
 * - every tick: the normal radar's blips (Mining_SendNormalRadarResults: after 20 ticks standing still, eight random
 *   spots near the player) and one buried sphere's sparkle every 20 ticks (Spheres_AdvanceBuriedSphereSparkleTimer).
 * Its messages are field notices, one after another (the DS's Underground text printer).
 */
import { createUnderground, miningRand, undergroundInitSeed, type Rand32, inSecretBase, nearbySpots, readUnderground, retrieveSphere, spawnBuriedObjects, spotAt, underground, buriedSphereAt, UNDERGROUND_LIMITS, type ClockTime, type Id } from '@opensinnoh/core';
import { newGameRecord, UNDERGROUND_MARKER, type AppResult, type Facing, type GameState, type Registries, type ScriptRunner, type UndergroundFieldView, type UndergroundRequest, type UndergroundTables } from '@opensinnoh/contracts';
import { DELTA } from './movement.ts';

/** The buried spheres' sparkle (Spheres_AdvanceBuriedSphereSparkleTimer): one slot every 20 ticks, all 100 in turn. */
const SPARKLE_PERIOD = 20;
/** Mining_SendNormalRadarResults: blips from the 20th tick standing still, one a tick, eight in all. */
const RADAR_DELAY = 20;
/** FIELD_EFFECT_RENDERER_09 (ov5_DisplayBuriedSphereSparkle). */
export const SPARKLE_RENDERER = 0x09;
/** The top screen's window: two lines of the ticker (top_screen.c's message window scrolls one line up per message). */
const LOG_LINES = 2;

export interface UndergroundHost {
  reg: Registries;
  state: GameState;
  scripts: ScriptRunner;
  tables: UndergroundTables;
  player(): { x: number; z: number; facing: Facing };
  /** TerrainCollisionManager_CheckCollision (off the map: blocked). */
  blocked(x: number, z: number): boolean;
  /** The visible object standing on a tile (CommPlayer_CheckNPCCollision), its local id, or null. */
  objectAt(x: number, z: number): number | null;
  /** The player is between tiles (CommPlayer_GetMovementTimer). */
  moving(): boolean;
  matrix(): { width: number; height: number };
  sparkle(x: number, z: number): void;
  playSe(name: string): void;
  clock(): ClockTime;
  /** A text record's markup (names in slots keep their colour codes). */
  text(id: Id): string;
}

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

  constructor(private readonly h: UndergroundHost) {}

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
    const p = this.h.player();
    const [dx, dz] = DELTA[p.facing];
    return { x: p.x + dx, z: p.z + dz };
  }

  /** What a burial there meets (Spheres_TryBurySphere's checks). */
  burialTile(): { x: number; z: number; secretBase: boolean; object: boolean; wall: boolean } {
    const { x, z } = this.ahead();
    return { x, z, secretBase: inSecretBase(x, z), object: this.h.objectAt(x, z) !== null, wall: this.h.blocked(x, z) };
  }

  /**
   * A (UndergroundMan_ProcessInteractEvent, solo): a mining spot ahead, then an object (a vendor's shop; any other
   * object's own script runs, as Roark's), then a buried sphere. Returns whether the press was taken.
   */
  interact(): boolean {
    const { x, z } = this.ahead();
    const u = readUnderground(this.h.state);
    const spot = spotAt(u, x, z);
    if (spot >= 0) {
      this.request = { app: 'mining', spot };
      return true;
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

  takeRequest(): UndergroundRequest | null {
    const r = this.request;
    this.request = null;
    return r;
  }

  /** An app the field asked for closed: the mining game's dig is on the top screen's ticker (Mining_GetQueuedMessage). */
  appDone(result: AppResult): void {
    if (result.app === 'mining' && result.dug) this.ticker('UndergroundCommon_Text_PlayerIsDiggingForTreasure', [this.h.state.names.player]);
  }

  /** Messages waiting: the field is not idle until they are read. */
  busy(): boolean {
    return this.notices.length > 0 || this.request !== null;
  }

  /** One field tick: the next message when the box is free, the radar, the sparkles. */
  step(): void {
    if (this.notices.length && !this.h.scripts.running()) {
      const n = this.notices.shift()!;
      this.h.scripts.notice(n.text, n.slots);
    }
    // Mining_SendNormalRadarResults: still for 20 ticks, then a blip a tick for eight ticks.
    if (this.h.moving()) this.still = 0;
    else if (this.still < RADAR_DELAY + UNDERGROUND_LIMITS.blips) {
      this.still++;
      if (this.still > RADAR_DELAY) {
        const p = this.h.player();
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

  /** The top screen (UndergroundTopScreen_Task): the player's marker in the main area, the blips, the ticker. */
  view(): UndergroundFieldView {
    const p = this.h.player();
    const L = UNDERGROUND_LIMITS;
    const main = (x: number, z: number) => ({ x: x - L.mainStart.x, z: z - L.mainStart.z });
    return {
      player: inSecretBase(p.x, p.z) ? null : main(p.x, p.z),
      blips: this.blips.flatMap((b) => (b && !inSecretBase(b.x, b.z) ? [{ ...main(b.x, b.z), anim: UNDERGROUND_MARKER.spot }] : [])),
      log: [...this.log],
    };
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
