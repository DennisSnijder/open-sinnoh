/**
 * The Battle Tower's rules (decomp unk_02049D08.c BattleTower_*, unk_0204AEE8.c, unk_0206B9D8.c, wifi_battle_tower_save.c;
 * overlay 104 ov104_022394A4.c, ov104_0223A0C4.c, frscrcmd_battle_tower.c). Headless and deterministic: the VM's
 * `call_battle_tower_function` (field and frontier) drives a `BattleTower` session, which reads and writes the saved part
 * (`GameState.frontier`) as the decomp's WifiBattleTowerRecord, WifiBattleTowerSave and BattleFrontierStats do.
 *
 * The session's random numbers are the tower's own LCG (decomp unk_08, BattleTower_GetRandom), seeded from the saved
 * tower RNG at the challenge's start, so a streak's trainers and teams never take a draw from the game's streams.
 */
import { createPokemon, dailyRandomOf, goodsPcHasRoom, readUnderground, isShiny, natureIndex, recalc, STATS, type Dex, type Id, type Pokemon, type Stats } from '@opensinnoh/core';
import { canGiveItem, dexOf, giveItem, newGameRecord, type FrontierBattle, type FrontierBattleTrainer, type FrontierSetData, type FrontierState, type FrontierTables, type GameState, type Registries } from '@opensinnoh/contracts';
import { addToGameRecord, incrementTrainerScore } from './score.ts';
import { MAX_TRANSACTION } from './mart.ts';

/** Decomp BATTLE_TOWER_MODE_*. */
export const TOWER_MODE = { single: 0, double: 1, multi: 2, linkMulti: 3, wifi: 4, wifiEarlier: 5, wfcMulti: 6 } as const;
/** Decomp BT_OPPONENTS_COUNT. */
export const TOWER_OPPONENTS = 7;
/** Decomp BattleTower_GetPartySizeForChallengeMode, by mode. */
const PARTY_SIZES = [3, 4, 2, 2, 3, 3, 2];
/** Decomp RECORD_* (generated/game_records.txt). */
export const TOWER_RECORDS = { challenges: 15, victories: 29, bpReceived: 68, bpSpent: 69 } as const;
/** Decomp TRAINER_SCORE_EVENT_UNK_14: seven wins in a row (BattleTower_UpdateGameRecordsAndJournal). */
const SCORE_SEVEN_WINS = 14;
/** Decomp RIBBON_* (generated/ribbons.txt). */
export const TOWER_RIBBONS = { ability: 53, greatAbility: 54, doubleAbility: 55, multiAbility: 56 } as const;
/** Decomp WifiBattleTowerRecord_UpdateBattlePoints: BP never pass 9999. */
export const BP_MAX = 9999;
/** Decomp sub_0204A5EC and BattleTower_UpdateGameRecords cap the shown streak at 9999. */
const STREAK_MAX = 9999;
/** Decomp WifiBattleTowerRecord flag bits: the trophies and their "no room in the PC" notes, a streak in progress per mode. */
export const TOWER_FLAGS = { bronze: 13, silver: 0, gold: 1, bronzeFull: 14, silverFull: 2, goldFull: 3, active: 8 } as const;
/** Decomp BATTLE_TOWER_PARTNER_* order (BattleTower_GetPartnerParam's partnerGraphics): the AI partners. */
export const TOWER_PARTNERS = 5;
/** MAX_IVS_SINGLE_STAT / 8 per trainer tier (decomp BattleTower_GetIVsFromTrainerID). */
const IV_TIERS: [number, number][] = [[100, 3], [120, 6], [140, 9], [160, 12], [180, 15], [200, 18], [220, 21]];
const MAX_IV = 31;
/** Decomp MAX_EVS_ALL_STATS, MAX_EVS_SINGLE_STAT. */
const EVS_TOTAL = 510;
const EV_MAX = 255;
/** The frontier battle level (decomp FrontierPokemon_InitPokemon setLevel 120, FieldBattleDTO_NewBattleTower's cap). */
export const FRONTIER_LEVEL = 50;
const FRUSTRATION = 'MOVE_FRUSTRATION';

/** Decomp sub_0206BFF0: the tower's LCG. */
export const towerLcg = (x: number): number => (Math.imul(x >>> 0, 48828125) + 1) >>> 0;
/** Decomp sub_0206BFFC: the LCG that reseeds the saved tower RNG. */
export const towerReseed = (x: number): number => (Math.imul(x >>> 0, 1566083941) + 1) >>> 0;

/** The frontier tables (`NewGame.frontier`); throws for packs without them. */
export function frontierTables(registries: Registries): FrontierTables {
  const t = newGameRecord(registries).frontier;
  if (!t) throw new Error('battle tower: the packs have no NewGame.frontier tables');
  return t;
}

/** A fresh save's frontier block (decomp WifiBattleTowerRecord_Init, WifiBattleTowerSave_Init, BattleFrontierSave_Init). */
export function newFrontierState(): FrontierState {
  return {
    bp: 0,
    towerFlags: 0,
    towerRooms: [0, 0, 0, 0, 0, 0],
    towerStreaks: Array.from({ length: 5 }, () => ({ record: 0, latest: 0 })),
    towerSave: { inProgress: false, mode: 0, nextOpponent: 0, slots: [0, 0, 0, 0], trainers: Array<number>(TOWER_OPPONENTS * 2).fill(0), seed: 0, partner: 0 },
  };
}

/** The save's frontier block, created on first use. */
export function frontierState(state: GameState): FrontierState {
  return (state.frontier ??= newFrontierState());
}

/** Decomp WifiBattleTowerRecord rngState: absent, it is the day's random through the reseed LCG (sub_0206C008). */
export function towerRngOf(state: GameState): number {
  return state.frontier?.towerRng ?? towerReseed(dailyRandomOf(state));
}

// ---------------------------------------------------------------- Battle Points

/** Decomp GetBattlePoints. */
export const battlePoints = (state: GameState): number => state.frontier?.bp ?? 0;

/** Decomp ScrCmd_GiveBattlePoints / FrontierScrCmd_GiveBattlePoints: BP and RECORD_BATTLE_POINTS_RECEIVED. */
export function giveBattlePoints(state: GameState, registries: Registries, n: number): void {
  addToGameRecord(state, registries, TOWER_RECORDS.bpReceived, n);
  const f = frontierState(state);
  f.bp = Math.min(BP_MAX, f.bp + n);
}

/** Decomp ScrCmd_RemoveBattlePoints (and the exchange, Shop_TakeMoney): BP and RECORD_BATTLE_POINTS_SPENT. */
export function removeBattlePoints(state: GameState, registries: Registries, n: number): void {
  addToGameRecord(state, registries, TOWER_RECORDS.bpSpent, n);
  const f = frontierState(state);
  f.bp = Math.max(0, f.bp - n);
}

/** The exchange counters' BP price of an item (decomp Shop_GetItemBPPrice: 0 when not listed). */
export function bpPrice(registries: Registries, item: Id): number {
  return frontierTables(registries).prices.find((p) => p.item === item)?.bp ?? 0;
}

// ---------------------------------------------------------------- flags, rooms, streaks

const flagBit = (f: FrontierState, bit: number) => ((f.towerFlags >> bit) & 1) === 1;
const setFlagBit = (f: FrontierState, bit: number, on: boolean) => void (f.towerFlags = on ? f.towerFlags | (1 << bit) : f.towerFlags & ~(1 << bit) & 0xffff);
/** Decomp WifiBattleTowerRecord_UpdateRoomNum's mode index: wfc-multi is 5, wifi-earlier has none. */
const roomIndex = (mode: number) => (mode === TOWER_MODE.wfcMulti ? 5 : mode);

/** Decomp sub_02049FF8 (BT_FUNC_UNK_08): the latest streak of a mode (0 for wifi-earlier). */
export function latestStreak(state: GameState, mode: number): number {
  if (mode === TOWER_MODE.wifiEarlier) return 0;
  if (mode > TOWER_MODE.wifi) throw new Error(`battle tower: no streak stats for mode ${mode}`);
  return state.frontier?.towerStreaks[mode]!.latest ?? 0;
}

/** The best streak of a mode (decomp STAT_TOWER_RECORD_STREAK_*). */
export function recordStreak(state: GameState, mode: number): number {
  return state.frontier?.towerStreaks[mode]?.record ?? 0;
}

/** Decomp BattleTower_GetIVsFromTrainerID: one IV for all six, by the trainer's tier. */
export function towerIvs(trainer: number): number {
  return IV_TIERS.find(([below]) => trainer < below)?.[1] ?? MAX_IV;
}

// ---------------------------------------------------------------- eligibility (decomp sub_02049EC4)

/** Decomp Pokemon_IsOnBattleFrontierBanlist. */
export const frontierBanned = (registries: Registries, species: Id): boolean => frontierTables(registries).banlist.includes(species);

/** The exchange counter's most of one item the BP cover (decomp Shop_GetCurrentMoney with MART_TYPE_FRONTIER). */
export function maxBuyBp(state: GameState, registries: Registries, item: Id): number {
  const price = bpPrice(registries, item);
  if (price === 0) throw new Error(`exchange: ${item} has no BP price`);
  return Math.min(MAX_TRANSACTION, Math.floor(battlePoints(state) / price));
}

/**
 * An exchange (decomp Shop_ConfirmItemPurchase, Shop_FinishPurchase with MART_TYPE_FRONTIER): refused when the BP do
 * not cover it or the bag has no room; else the items go into the bag and the BP are taken (RECORD_BATTLE_POINTS_SPENT).
 */
export function buyWithBp(state: GameState, registries: Registries, item: Id, count: number): { ok: true } | { ok: false; reason: 'money' | 'room' } {
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRANSACTION) throw new Error(`exchange: buy count ${count}`);
  const total = bpPrice(registries, item) * count;
  if (total > battlePoints(state)) return { ok: false, reason: 'money' };
  if (!canGiveItem(state, registries, item, count)) return { ok: false, reason: 'room' };
  giveItem(state, registries, item, count);
  removeBattlePoints(state, registries, total);
  return { ok: true };
}

/**
 * Decomp sub_02049EC4 (BT_FUNC_CHECK_ENOUGH_VALID_POKEMON): enough party Pokémon to enter `count`, Eggs and the banlist
 * out, and among them a choice of `count` with no species twice and no held item twice (held items count when
 * `items`; the first of two same species-and-item members is the one kept).
 */
export function enoughValidPokemon(state: GameState, registries: Registries, count: number, items = true): boolean {
  if (state.party.length < count) return false;
  const list: { species: Id; item: Id | null }[] = [];
  for (const mon of state.party) {
    const item = items ? mon.heldItem : null;
    if (mon.isEgg || frontierBanned(registries, mon.species)) continue;
    // Decomp sub_02049D38: the same species holding the same (non-empty) item as one kept earlier is left out.
    if (item !== null && list.some((m) => m.species === mon.species && m.item === item)) continue;
    list.push({ species: mon.species, item });
  }
  if (list.length < count) return false;
  return hasDistinctChoice(list, count, list.length - count + 1);
}

/** Decomp sub_02049D64: no species twice, no non-empty held item twice (the first's item decides an empty one). */
function distinct(picks: { species: Id; item: Id | null }[]): boolean {
  for (let i = 0; i < picks.length - 1; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      if (picks[i]!.species === picks[j]!.species) return false;
      if (picks[i]!.item === null) continue;
      if (picks[i]!.item === picks[j]!.item) return false;
    }
  }
  return true;
}

/** Decomp sub_02049DB4: a choice of `count` (2–4) that is `distinct`, the first one among the first `firsts`. */
function hasDistinctChoice(list: { species: Id; item: Id | null }[], count: number, firsts: number): boolean {
  const n = list.length;
  for (let a = 0; a < firsts; a++) {
    for (let b = a + 1; b < n; b++) {
      if (count === 2) {
        if (distinct([list[a]!, list[b]!])) return true;
        continue;
      }
      for (let c = b + 1; c < n; c++) {
        if (count === 3) {
          if (distinct([list[a]!, list[b]!, list[c]!])) return true;
          continue;
        }
        for (let d = c + 1; d < n; d++) if (distinct([list[a]!, list[b]!, list[c]!, list[d]!])) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- frontier Pokémon (decomp BattleTower_CopySetToPokemonDataDTO)

/**
 * A frontier set as a Pokémon (decomp BattleTower_CopySetToPokemonDataDTO or FrontierPokemon_Init, then
 * FrontierPokemon_InitPokemon): its species, form, moves (full PP, no PP Ups), item (or the reserved one), `ivs` in every
 * stat, 510 EVs over its flagged stats (at most 255 each), the ability from the PID's low bit, friendship 255 (0 with
 * Frustration), the species name, the trainer's OT id, at `level` (the tower's 50 by default). `sets` is the facility's
 * set table (`FrontierTables.sets`, or the Hall's).
 */
export function frontierPokemon(dex: Dex, sets: readonly FrontierSetData[], setId: number, o: { otId: number; pid: number; ivs: number; item: Id | null; otName: string; ball: Id; level?: number }): Pokemon {
  const set = sets[setId];
  if (!set) throw new Error(`frontier: no set ${setId}`);
  const mon = createPokemon(dex, { species: set.species, form: set.form, level: o.level ?? FRONTIER_LEVEL, pid: o.pid, ivs: o.ivs, otId: o.otId, otName: o.otName, otGender: 'male', ball: o.ball, heldItem: o.item, moves: set.moves });
  const flagged = STATS.filter((_, i) => set.evFlags & (1 << i));
  // Set 0 (a placeholder no trainer draws) has no flags: no EVs (the decomp would divide by zero).
  const evs = flagged.length ? Math.min(EV_MAX, Math.floor(EVS_TOTAL / flagged.length)) : 0;
  mon.evs = Object.fromEntries(STATS.map((s) => [s, flagged.includes(s) ? evs : 0])) as Stats;
  // The ability comes from the base species' data (decomp SpeciesData_GetSpeciesValue of the species, not the form).
  const base = dex.species(set.species);
  mon.ability = base.abilities[1] && o.pid & 1 ? base.abilities[1] : base.abilities[0];
  mon.friendship = set.moves.some((m) => m.endsWith(`:${FRUSTRATION}`)) ? 0 : 255;
  recalc(dex, mon);
  mon.hp = mon.stats.hp;
  return mon;
}

// ---------------------------------------------------------------- the challenge (decomp BattleTower)

/** A trainer the challenge faces (decomp FrontierOpponent). */
export interface TowerOpponent {
  trainer: number;
  sets: number[];
  party: Pokemon[];
  /** What rebuilds the party (decomp BattleTowerPartnerData: the OT id and PIDs; the reserved items' use). */
  otId: number;
  pids: number[];
  reserved: boolean;
}

/**
 * One Battle Tower challenge (decomp BattleTower, FieldSystem::battleTower): alive from the receptionist's
 * InitBattleTower to FreeBattleTower, through the frontier's battle rooms. Not saved: REST saves its resumable part to
 * `GameState.frontier.towerSave` (BT_FUNC_UNK_39) and the next InitBattleTower 1 rebuilds it.
 */
export class BattleTower {
  readonly mode: number;
  readonly partySize: number;
  /** Decomp nextOpponentNum: the opponent to come, from 1. */
  nextOpponent: number;
  /** Decomp unk_0D: wins in this challenge. */
  wins: number;
  /** Decomp unk_2A: the chosen party slots (0xFF unset). */
  slots: number[];
  /** Decomp unk_2E, unk_36: the chosen Pokémon's species and items when picked. */
  chosen: { species: Id; item: Id | null }[] = [];
  /** Decomp trainerIDs: the challenge's opponents (two per battle in multi). */
  trainers: number[];
  /** Decomp unk_08: the challenge's LCG state. */
  seed = 0;
  /** Decomp unk_1A: the streak carried in from earlier challenges of this mode. */
  readonly carried: number;
  /** Decomp roomNum: sevens won in the streak, read at the start. */
  readonly room: number;
  /** Decomp beatPalmer: 1 silver, 2 gold. */
  beatPalmer = 0;
  /** Decomp partnerID (multi). */
  partner = 0;
  /** Decomp unk_10_4: a ribbon is due (50 wins, or a rank in Wi-Fi). */
  ribbonDue = false;
  /** Decomp defeatedSevenTrainers. */
  private defeatedSeven = false;
  /** Decomp partnersDataDTO: the five AI partners' parties for this challenge (multi; BT_FUNC_UNK_56). */
  partners: (TowerOpponent | null)[] = [null, null, null, null, null];
  /** Decomp wonBattle and the opponents of the battle at hand (opponentsDataDTO). */
  won = false;
  opponents: TowerOpponent[] = [];

  private constructor(
    private readonly state: GameState,
    private readonly registries: Registries,
    mode: number,
    resume: boolean,
  ) {
    const f = frontierState(state);
    f.towerSave.inProgress = false;
    if (!resume) {
      this.mode = mode;
      this.nextOpponent = 1;
      this.wins = 0;
      this.slots = [0xff, 0xff, 0xff, 0xff];
      this.trainers = Array<number>(TOWER_OPPONENTS * 2).fill(0xffff);
      f.towerSave = { ...newFrontierState().towerSave, mode };
    } else {
      this.mode = f.towerSave.mode;
      this.nextOpponent = f.towerSave.nextOpponent;
      this.wins = this.nextOpponent - 1;
      this.slots = [...f.towerSave.slots];
      this.trainers = [...f.towerSave.trainers];
      this.seed = f.towerSave.seed;
      if (this.mode === TOWER_MODE.multi) {
        this.partner = f.towerSave.partner;
        // Decomp sub_0204B404: the chosen partner's party from the saved sets, OT id and PIDs.
        const saved = f.towerSave.partnerParty;
        if (!saved) throw new Error('battle tower: a saved multi challenge without its partner party');
        this.partners[this.partner] = this.rebuild(frontierTables(registries).tower.partners + this.partner, saved);
      }
    }
    const size = PARTY_SIZES[this.mode];
    if (size === undefined) throw new Error(`battle tower: no challenge mode ${this.mode}`);
    this.partySize = size;
    if (this.mode > TOWER_MODE.wifiEarlier) throw new Error(`battle tower: mode ${this.mode} is a link mode`);
    const active = this.mode !== TOWER_MODE.wifiEarlier && flagBit(f, TOWER_FLAGS.active + this.mode);
    this.carried = active ? f.towerStreaks[this.mode]!.latest : 0;
    this.room = active ? f.towerRooms[roomIndex(this.mode)]! : 0;
  }

  /** Decomp BattleTower_Init(saveData, resume, challengeMode). */
  static init(state: GameState, registries: Registries, resume: boolean, mode: number): BattleTower {
    return new BattleTower(state, registries, mode, resume);
  }

  private get f(): FrontierState {
    return frontierState(this.state);
  }

  private get tables(): FrontierTables {
    return frontierTables(this.registries);
  }

  /** Decomp BattleTower_GetRandom: the challenge's LCG divided by 65535, as its u16 return value. */
  random(): number {
    this.seed = towerLcg(this.seed);
    return Math.floor(this.seed / 65535) & 0xffff;
  }

  /** Decomp sub_0204A378 (BT_FUNC_UNK_31): the party menu's picks, in order. */
  setSelection(order: number[]): void {
    if (order.length !== this.partySize) throw new Error(`battle tower: ${order.length} Pokémon picked, the challenge takes ${this.partySize}`);
    this.chosen = order.map((slot, i) => {
      const mon = this.state.party[slot];
      if (!mon) throw new Error(`battle tower: no party slot ${slot}`);
      this.slots[i] = slot;
      return { species: mon.species, item: mon.heldItem };
    });
  }

  /** Decomp BattleTower_CheckDuplicateSpeciesAndHeldItems: 1 a species twice, 2 an item twice, else 0. */
  duplicates(): number {
    const picked = this.selectedParty();
    for (let i = 1; i < picked.length; i++) {
      for (let j = 0; j < i; j++) {
        if (picked[i]!.species === picked[j]!.species) return 1;
        if (picked[i]!.heldItem !== null && picked[i]!.heldItem === picked[j]!.heldItem) return 2;
      }
    }
    return 0;
  }

  /** The chosen party members, in order. */
  selectedParty(): Pokemon[] {
    return this.slots.slice(0, this.partySize).map((slot) => {
      const mon = this.state.party[slot];
      if (!mon) throw new Error(`battle tower: no party slot ${slot}`);
      return mon;
    });
  }

  /** Decomp sub_0204ABF4 (BT_FUNC_UNK_57): seeds the challenge's LCG from the saved tower RNG; returns seed / 65535. */
  seedChallenge(): number {
    const f = this.f;
    const active = flagBit(f, TOWER_FLAGS.active + this.mode);
    let rng = towerRngOf(this.state);
    if (!active) {
      // sub_0206C02C: the saved RNG moves on; the challenge starts from its next value.
      rng = towerReseed(rng);
      f.towerRng = rng;
      this.seed = towerLcg(rng);
    } else {
      // sub_0206C068: the streak's own sequence, 24 values per seven won.
      let v = towerLcg(rng);
      for (let i = 0; i < f.towerRooms[roomIndex(f.towerSave.mode)]! * 24; i++) v = towerLcg(v);
      this.seed = v;
    }
    f.towerSave.seed = this.seed;
    return Math.floor(this.seed / 65535) & 0xffff;
  }

  /** Decomp BattleTower_GetTrainerIDForRoomAndOpponentNum: Palmer at singles 21 and 49, else a draw from the room's range. */
  trainerFor(room: number, opponent: number): number {
    const t = this.tables.tower;
    if (this.mode === TOWER_MODE.single) {
      if (room === 2 && opponent === TOWER_OPPONENTS - 1) return t.palmer[0];
      if (room === 6 && opponent === TOWER_OPPONENTS - 1) return t.palmer[1];
    }
    const [first, last] = room < 7 && opponent === TOWER_OPPONENTS - 1 ? t.bossRanges[room]! : t.ranges[Math.min(room, 7)]!;
    return first + (this.random() % (last - first + 1));
  }

  /** Decomp sub_0204A4C8 (BT_FUNC_UNK_52): the seven (multi: fourteen) opponents, none twice. */
  chooseTrainers(): void {
    const count = this.mode === TOWER_MODE.multi ? TOWER_OPPONENTS * 2 : TOWER_OPPONENTS;
    for (let n = 0; n < count; n++) {
      let id: number;
      do id = this.trainerFor(this.room, this.mode === TOWER_MODE.multi ? Math.floor(n / 2) : n);
      while (this.trainers.slice(0, n).includes(id));
      this.trainers[n] = id;
    }
  }

  /**
   * Decomp BattleTower_CreateRandomTrainerParty: `size` sets drawn from the trainer's list, no species twice (nor one of
   * `avoid`'s), no item twice for the first 50 refusals (then the reserved items), a PID per set with the set's nature
   * that is not shiny for the trainer's OT id.
   */
  private party(trainer: number, size: number, avoid: { species: Id; item: Id | null }[] | null): TowerOpponent {
    const tables = this.tables;
    const data = tables.trainers[trainer];
    if (!data) throw new Error(`battle tower: no frontier trainer ${trainer}`);
    const dex = dexOf(this.registries);
    const picks: number[] = [];
    let refusals = 0;
    while (picks.length !== size) {
      const setId = data.sets[this.random() % data.sets.length]!;
      const set = tables.sets[setId]!;
      if (picks.some((p) => tables.sets[p]!.species === set.species)) continue;
      if (avoid?.some((a) => a.species === set.species)) continue;
      if (refusals < 50) {
        if (picks.some((p) => tables.sets[p]!.item !== null && tables.sets[p]!.item === set.item)) {
          refusals++;
          continue;
        }
        if (avoid?.some((a) => a.item !== null && a.item === set.item)) {
          refusals++;
          continue;
        }
      }
      picks.push(setId);
    }
    const ivs = towerIvs(trainer);
    const otId = (this.random() | (this.random() << 16)) >>> 0;
    const reserved = refusals >= 50;
    const name = this.trainerName(trainer);
    const ball = newGameRecord(this.registries).pokeBall;
    const party = picks.map((setId, i) => {
      const set = tables.sets[setId]!;
      const nature = this.registries.natures.get(set.nature)?.sourceIndex;
      if (nature === undefined) throw new Error(`battle tower: frontier set ${setId} has an unknown nature ${set.nature}`);
      let pid: number;
      do pid = (this.random() | (this.random() << 16)) >>> 0;
      while (natureIndex(dex, pid) !== nature || isShiny(otId, pid));
      return frontierPokemon(dex, tables.sets, setId, { otId, pid, ivs, item: reserved ? tables.tower.reservedItems[i]! : set.item, otName: name, ball });
    });
    return { trainer, sets: picks, party, otId, pids: party.map((m) => m.pid), reserved };
  }

  /** Decomp sub_0204B404: a party from saved sets, OT id and PIDs (no draws). */
  private rebuild(trainer: number, saved: { otId: number; sets: number[]; pids: number[]; reserved: boolean }): TowerOpponent {
    const tables = this.tables;
    const name = this.trainerName(trainer);
    const ball = newGameRecord(this.registries).pokeBall;
    const party = saved.sets.map((setId, i) =>
      frontierPokemon(dexOf(this.registries), tables.sets, setId, { otId: saved.otId, pid: saved.pids[i]!, ivs: towerIvs(trainer), item: saved.reserved ? tables.tower.reservedItems[i]! : tables.sets[setId]!.item, otName: name, ball }),
    );
    return { trainer, sets: [...saved.sets], party, otId: saved.otId, pids: [...saved.pids], reserved: saved.reserved };
  }

  /** Decomp sub_0204A97C (BT_FUNC_UNK_56): each AI partner's party, none of the player's picks' species or items. */
  partnerParties(): void {
    const first = this.tables.tower.partners;
    for (let i = 0; i < this.partners.length; i++) this.partners[i] = this.party(first + i, this.partySize, this.chosen);
  }

  /** Decomp ScrCmd_GetBattleTowerPartnerSpeciesAndMove: a partner Pokémon's species and first move. */
  partnerMon(partner: number, slot: number): Pokemon {
    const mon = this.partners[partner]?.party[slot];
    if (!mon) throw new Error(`battle tower: no partner ${partner} Pokémon ${slot} (BT_FUNC_UNK_56 first)`);
    return mon;
  }

  /** Decomp BattleTower_CreateOpponentParties (BT_FUNC_SET_OPPONENT_TEAMS): the next battle's trainers and parties. */
  createOpponentParties(): void {
    const n = this.nextOpponent - 1;
    if (this.mode === TOWER_MODE.multi) {
      const first = this.party(this.trainers[n * 2]!, this.partySize, null);
      const avoid = first.party.map((m) => ({ species: m.species, item: m.heldItem }));
      this.opponents = [first, this.party(this.trainers[n * 2 + 1]!, this.partySize, avoid)];
    } else if (this.mode === TOWER_MODE.single || this.mode === TOWER_MODE.double) this.opponents = [this.party(this.trainers[n]!, this.partySize, null)];
    else throw new Error(`battle tower: opponents for mode ${this.mode} (Wi-Fi) are not built`);
  }

  /** The frontier trainer's name (TEXT_BANK_FRONTIER_TRAINER_NAMES). */
  trainerName(trainer: number): string {
    const id = this.tables.trainers[trainer]?.name;
    const text = id && this.registries.texts.get(id);
    if (!text) throw new Error(`battle tower: no name for frontier trainer ${trainer}`);
    return text.text;
  }

  /** Decomp BattleFrontier_GetObjectIDFromTrainerClass (BT_FUNC_GET_OPPONENT_OBJECT_ID): the opponent's 2D character. */
  opponentObject(i: number): number {
    const o = this.opponents[i];
    if (!o) throw new Error(`battle tower: no opponent ${i}`);
    const t = this.tables;
    const cls = t.trainers[o.trainer]!.class;
    return t.tower.classObjects.find((c) => c.class === cls)?.gfx ?? t.tower.defaultObject;
  }

  /** Decomp ov104_022395B4 (BT_FUNC_UNK_34): a win counted, the LCG stepped, the next opponent. */
  advance(): number {
    this.wins++;
    this.seed = towerLcg(this.seed);
    return ++this.nextOpponent;
  }

  /** Decomp BattleTower_HasDefeatedSevenTrainers. */
  hasDefeatedSeven(): boolean {
    if (this.nextOpponent > TOWER_OPPONENTS) this.defeatedSeven = true;
    return this.defeatedSeven;
  }

  /** Decomp ov104_022395D8 (BT_FUNC_UNK_36): the streak so far, at most 0xFFFF. */
  streak(): number {
    return Math.min(0xffff, this.carried + this.wins);
  }

  /** Decomp FieldBattleDTO_NewBattleTower: the player's chosen Pokémon, levels above 50 brought to 50, against the opponents. */
  battle(): FrontierBattle {
    const dex = dexOf(this.registries);
    const party = this.selectedParty().map((m) => {
      const mon = structuredClone(m);
      if (mon.level > FRONTIER_LEVEL) {
        mon.exp = dex.expTable(dex.form(mon.species, mon.form).growthRate)[FRONTIER_LEVEL]!;
        recalc(dex, mon);
      }
      return mon;
    });
    const trainer = (o: TowerOpponent): FrontierBattleTrainer => ({ id: o.trainer, name: this.trainerName(o.trainer), class: this.tables.trainers[o.trainer]!.class, className: this.tables.trainers[o.trainer]!.className, party: o.party.map((m) => structuredClone(m)) });
    if (this.mode !== TOWER_MODE.multi) return { facility: 'tower', party, trainers: this.opponents.map(trainer) };
    const partner = this.partners[this.partner];
    if (!partner) throw new Error(`battle tower: no party for partner ${this.partner}`);
    return { facility: 'tower', party, trainers: this.opponents.map(trainer), partner: trainer(partner) };
  }

  /**
   * Decomp BattleTower_GiveBattlePointsReward (BT_FUNC_UNK_46): BP for the seven by the room (20 after Palmer), and
   * RECORD_BATTLE_POINTS_RECEIVED (FrontierScrCmd_CallBattleTowerFunction). Returns the BP.
   */
  giveReward(): number {
    if (this.mode === TOWER_MODE.wifiEarlier) return 0;
    if (this.mode === TOWER_MODE.wifi) throw new Error('battle tower: the Wi-Fi rank reward is not built');
    const t = this.tables.tower;
    const room = this.f.towerRooms[roomIndex(this.mode)]!;
    const bp = this.beatPalmer ? t.palmerBattlePoints : room >= 7 ? t.battlePoints[7]! : t.battlePoints[room]!;
    this.f.bp = Math.min(BP_MAX, this.f.bp + bp);
    addToGameRecord(this.state, this.registries, TOWER_RECORDS.bpReceived, bp);
    return bp;
  }

  /**
   * Decomp BattleTower_UpdateGameRecords (BT_FUNC_UPDATE_GAME_RECORDS): the streak ends (a loss or RETIRE). The best and
   * latest streaks, the active flag cleared, the victories and challenges counted, the room reset.
   */
  updateRecords(): { newRecord: boolean } {
    if (this.mode === TOWER_MODE.wifiEarlier) return { newRecord: false };
    const f = this.f;
    const s = f.towerStreaks[this.mode]!;
    const before = s.record;
    const total = this.carried + this.wins;
    s.record = setIfBetter(s.record, total);
    const newRecord = s.record > 1 && (before < s.record || (before === s.record && s.record % 7 === 0));
    s.latest = Math.min(STREAK_MAX, total);
    setFlagBit(f, TOWER_FLAGS.active + this.mode, false);
    addToGameRecord(this.state, this.registries, TOWER_RECORDS.victories, this.wins);
    f.towerRooms[roomIndex(this.mode)] = 0;
    addToGameRecord(this.state, this.registries, TOWER_RECORDS.challenges, 1);
    this.ribbonCheck();
    return { newRecord };
  }

  /**
   * Decomp BattleTower_UpdateGameRecordsAndJournal (BT_FUNC_UPDATE_GAME_RECORDS_AND_JOURNAL): seven won. The latest
   * streak and the record, the active flag set, seven victories and a challenge, the room up, the trainer score.
   */
  updateRecordsAndJournal(): void {
    if (this.mode === TOWER_MODE.wifiEarlier) return;
    const f = this.f;
    const s = f.towerStreaks[this.mode]!;
    const total = this.carried + this.wins;
    s.latest = Math.min(STREAK_MAX, total);
    setFlagBit(f, TOWER_FLAGS.active + this.mode, true);
    s.record = setIfBetter(s.record, s.latest);
    addToGameRecord(this.state, this.registries, TOWER_RECORDS.victories, TOWER_OPPONENTS);
    const i = roomIndex(this.mode);
    if (f.towerRooms[i]! < 65534) f.towerRooms[i]!++;
    addToGameRecord(this.state, this.registries, TOWER_RECORDS.challenges, 1);
    incrementTrainerScore(this.state, this.registries, SCORE_SEVEN_WINS);
    this.ribbonCheck();
  }

  /** Decomp sub_0204ACC8: doubles and multi earn a ribbon at a 50 streak. */
  private ribbonCheck(): void {
    if (this.mode === TOWER_MODE.single || this.mode >= TOWER_MODE.wifi) return;
    if (this.carried + this.wins >= 50) this.ribbonDue = true;
  }

  /** Decomp sub_0204A8C8 (BT_FUNC_UNK_39): REST saves the challenge to resume (WifiBattleTowerSave). */
  saveChallenge(): void {
    const f = this.f;
    const p = this.mode === TOWER_MODE.multi ? this.partners[this.partner] : null;
    if (this.mode === TOWER_MODE.multi && !p) throw new Error(`battle tower: REST without partner ${this.partner}'s party`);
    f.towerSave = {
      inProgress: true,
      mode: this.mode,
      nextOpponent: this.nextOpponent,
      slots: [...this.slots],
      trainers: [...this.trainers],
      seed: this.seed,
      partner: this.mode === TOWER_MODE.multi ? this.partner : f.towerSave.partner,
      ...(p ? { partnerParty: { otId: p.otId, sets: [...p.sets], pids: [...p.pids], reserved: p.reserved } } : {}),
    };
  }

  /** Decomp sub_0204AB68 (BT_FUNC_UNK_48): beating Palmer in singles gives the Ability (silver) or Great Ability (gold) Ribbon. */
  palmerRibbons(): boolean {
    if (this.mode !== TOWER_MODE.single) return false;
    if (this.beatPalmer === 1) return this.giveRibbon(TOWER_RIBBONS.ability);
    if (this.beatPalmer === 2) return this.giveRibbon(TOWER_RIBBONS.greatAbility);
    return false;
  }

  /** Decomp sub_0204ABA0 (BT_FUNC_UNK_49): the 50-streak ribbon of doubles (Double Ability) and multi (Multi Ability). */
  streakRibbons(): boolean {
    if (this.mode === TOWER_MODE.wifiEarlier || this.mode === TOWER_MODE.wfcMulti || !this.ribbonDue) return false;
    if (this.mode === TOWER_MODE.double) return this.giveRibbon(TOWER_RIBBONS.doubleAbility);
    if (this.mode === TOWER_MODE.multi) return this.giveRibbon(TOWER_RIBBONS.multiAbility);
    throw new Error(`battle tower: no streak ribbon for mode ${this.mode}`);
  }

  /** Decomp sub_0204AC54: the chosen Pokémon without the ribbon get it; true when any did. */
  private giveRibbon(ribbon: number): boolean {
    let given = 0;
    for (const mon of this.selectedParty()) {
      if (mon.ribbons.includes(ribbon)) continue;
      mon.ribbons = [...mon.ribbons, ribbon].sort((a, b) => a - b);
      given++;
    }
    return given > 0;
  }
}

/** Decomp BattleFrontierSave_SetIfBetter (SetStat caps at 9999): the better value, a stored value past 9999 as 9999. */
export function setIfBetter(current: number, value: number): number {
  if (current < value) return Math.min(STREAK_MAX, value);
  return current > STREAK_MAX ? STREAK_MAX : current;
}

/** Decomp sub_02049F98 (BT_FUNC_UNK_03): WifiBattleTowerSave_Init. */
export function clearTowerSave(state: GameState): void {
  frontierState(state).towerSave = newFrontierState().towerSave;
}

/** Decomp sub_02049FA0 (BT_FUNC_UNK_04): whether a challenge was saved by REST. */
export const towerSaveInProgress = (state: GameState): boolean => state.frontier?.towerSave.inProgress ?? false;

/**
 * Decomp sub_0204A064 (BT_FUNC_UNK_14): the player quit without saving (the save's challenge was not in progress): the
 * streak in the save's mode ends (active flag, room, latest streak). Returns that mode.
 */
export function towerQuitWithoutSaving(state: GameState): number {
  const f = frontierState(state);
  const mode = f.towerSave.mode;
  if (mode === TOWER_MODE.wifiEarlier) return mode;
  if (mode === TOWER_MODE.wfcMulti) throw new Error('battle tower: a Wi-Fi multi challenge in the save');
  setFlagBit(f, TOWER_FLAGS.active + mode, false);
  f.towerRooms[roomIndex(mode)] = 0;
  f.towerStreaks[mode]!.latest = 0;
  // sub_0206C02C: the saved RNG moves on.
  if (mode !== TOWER_MODE.wifi) {
    f.towerRng = towerReseed(towerRngOf(state));
    f.towerSave.seed = towerLcg(f.towerRng);
  }
  return mode;
}

/**
 * Decomp sub_0206BDBC (`scr_cmd_1df`): the trophy Teala gives for the singles record (20 bronze, 50 silver, 100 gold):
 * 1–3 the trophy (marked given), 4 none because the Underground's goods PC is full (noted once), 0 nothing due.
 */
export function towerTrophy(state: GameState): number {
  const record = recordStreak(state, TOWER_MODE.single);
  if (record < 20) return 0;
  const f = frontierState(state);
  const has = (b: number) => flagBit(f, b);
  if (has(TOWER_FLAGS.bronze) && has(TOWER_FLAGS.silver) && has(TOWER_FLAGS.gold)) return 0;
  const room = goodsPcHasRoom(readUnderground(state));
  const give = (bit: number, full: number, trophy: number): number => {
    if (room) {
      setFlagBit(f, bit, true);
      return trophy;
    }
    if (!has(full)) setFlagBit(f, full, true);
    return 4;
  };
  if (!has(TOWER_FLAGS.bronze)) return give(TOWER_FLAGS.bronze, TOWER_FLAGS.bronzeFull, 1);
  if (record < 50) return 0;
  if (!has(TOWER_FLAGS.silver)) return give(TOWER_FLAGS.silver, TOWER_FLAGS.silverFull, 2);
  if (record < 100 || has(TOWER_FLAGS.gold)) return 0;
  return give(TOWER_FLAGS.gold, TOWER_FLAGS.goldFull, 3);
}

/**
 * Decomp sub_0206BF04 (`scr_cmd_1e0`): whether Teala stands in the lobby: 1–3 a trophy is due, 4–6 one was due but the
 * PC was full, 0 none.
 */
export function towerTrophyDue(state: GameState): number {
  const record = recordStreak(state, TOWER_MODE.single);
  if (record < 20) return 0;
  const f = state.frontier ?? newFrontierState();
  const [bronze, silver, gold] = [TOWER_FLAGS.bronze, TOWER_FLAGS.silver, TOWER_FLAGS.gold].map((b) => flagBit(f, b));
  if (bronze && silver && gold) return 0;
  if (!bronze) return flagBit(f, TOWER_FLAGS.bronzeFull) ? 4 : 1;
  if (record < 50) return 0;
  if (!silver) return flagBit(f, TOWER_FLAGS.silverFull) ? 5 : 2;
  if (record < 100 || gold) return 0;
  return flagBit(f, TOWER_FLAGS.goldFull) ? 6 : 3;
}

/**
 * Decomp ScrCmd_JudgeStats: the IVs' total, and the best stat (0–5: HP, Attack, Defense, Speed, Sp. Atk, Sp. Def) with
 * its IV; a tie with the best so far goes to the later stat when `coin()` (decomp LCRNG_Next() % 2 == 0) is true.
 */
export function judgeStats(mon: Pokemon, coin: () => boolean): { total: number; best: number; bestIv: number } {
  const ivs = STATS.map((s) => mon.ivs[s]);
  let best = 0;
  for (let i = 1; i < 6; i++) {
    if (ivs[best]! < ivs[i]!) best = i;
    else if (ivs[best] === ivs[i] && coin()) best = i;
  }
  return { total: ivs.reduce((a, b) => a + b, 0), best, bestIv: ivs[best]! };
}
