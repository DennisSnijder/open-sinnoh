/**
 * The Battle Castle's rules (decomp overlay 104 battle_castle.c, battle_castle_helpers.c, frscrcmd_battle_castle.c,
 * frontier_opponents.c; overlay 107 battle_castle_app self_app.c and opponent_app.c; arm9 battle_castle_save.c,
 * scrcmd_battle_castle.c). Headless and deterministic: the frontier VM's Castle commands drive a `BattleCastle`
 * challenge over copies of the entered Pokémon (their held items taken, levels above 50 brought to 50), which keep
 * their HP, PP and status from battle to battle; the saved part (`FrontierState.castle`) is the decomp's
 * BattleCastleSave, BattleCastlePersistentSave and the castle's BattleFrontierStats, with the Castle Points (CP).
 *
 * Draws take the caller's `rand` (decomp LCRNG_Next), in the decomp's order.
 */
import { dexOf, newGameRecord, type BattleCastleTables, type CastleRental, type CastleState, type CastleUnlocks, type FrontierBattle, type FrontierBattleTrainer, type FrontierSetData, type FrontierTables, type GameState, type Registries } from '@opensinnoh/contracts';
import { heal, maxPp, recalc, type Dex, type Id, type Pokemon } from '@opensinnoh/core';
import { frontierPokemon, frontierState, frontierTables, setIfBetter } from './battle-tower.ts';
import { AI_FLAGS, frontierMon, NEXT_BATTLE, type FactoryMon, type Rand16 } from './battle-factory.ts';
import { addToGameRecord } from './score.ts';

/** Decomp CASTLE_* (constants/battle_frontier.h). */
export const CASTLE = { battlesPerRound: 7, silver: 21, gold: 49, partySize: 3, maxRounds: 8, maxLevel: 50, ranks: 3 } as const;
/** Decomp BATTLE_CASTLE_RANK_*. */
export const CASTLE_RANK = { healing: 0, rentals: 1, summary: 2 } as const;
/**
 * Decomp opponent_app.c CP_COST_*: CHECK, a level 5 up, 5 down, the summary's stats and moves, and its rank-up; the
 * scene's PASS (frontier_scripts_battle_castle.s: 50 CP from the fourth round on).
 */
export const CASTLE_COST = { identity: 1, levelUp: 1, levelDown: 15, stats: 2, moves: 5, summaryRankUp: 50, pass: 50 } as const;
/** Decomp the levels a level adjustment sets (opponent_app.c UpdateLevelAdjustment). */
const ADJUSTED_LEVEL = { none: 50, up: 55, down: 45 } as const;
/** Decomp BattleCastle_Init: the CP a challenge starts with on top of the streak's. */
const START_CP = 10;
const CP_MAX = 9999;
const STREAK_MAX = 9999;
/** Decomp BattleCastle_GetEarnedBP: a Darach streak's BP. */
const BRAIN_BP = 20;
/** Decomp RECORD_CASTLE_POINTS_RECEIVED (generated/game_records.txt). */
const RECORD_CP_RECEIVED = 65;
/** Decomp FRONTIER_CHALLENGE_*. */
const SINGLE = 0;
const DOUBLE = 1;
/** Decomp GetIVsForTrainer (frontier_opponents.c): an IV for all six by the trainer's tier. */
const IV_TIERS: [number, number][] = [[100, 3], [120, 6], [140, 9], [160, 12], [180, 15], [200, 18], [220, 21]];
const MAX_IV = 31;
/** The challenge types with streaks and ranks (single, double, multi). */
const TYPES = 3;

/** Decomp GetIVsForTrainer. */
export const frontierTrainerIvs = (trainer: number): number => IV_TIERS.find(([below]) => trainer < below)?.[1] ?? MAX_IV;

export function newCastleState(): CastleState {
  return {
    active: [false, false, false, false],
    heardIntro: false,
    streaks: Array.from({ length: TYPES }, () => ({ record: 0, latest: 0, cp: 0, recordCp: 0, spentCp: 0 })),
    ranks: Array.from({ length: TYPES }, () => [1, 1, 1]),
    save: newCastleSave(),
  };
}

/** Decomp BattleCastleSave_Init. */
function newCastleSave(): CastleState['save'] {
  return { saved: false, challengeType: 0, battle: 0, slots: [0, 0, 0], trainers: Array<number>(CASTLE.battlesPerRound * 2).fill(0), hp: [0, 0, 0, 0], pp: Array.from({ length: 4 }, () => [0, 0, 0, 0]), status: ['none', 'none', 'none', 'none'], items: [null, null, null, null], sets: Array<number>(CASTLE.battlesPerRound * 2).fill(0) };
}

export function castleState(state: GameState): CastleState {
  return (frontierState(state).castle ??= newCastleState());
}

/** The challenge type's streaks and CP (decomp BattleFrontierStats_GetCastle*Index); multi has none here. */
function streakOf(state: GameState, challengeType: number): CastleState['streaks'][number] {
  const s = castleState(state).streaks[challengeType];
  if (!s) throw new Error(`battle castle: challenge type ${challengeType} has no stats (no link challenges)`);
  return s;
}

/** Decomp STAT_CASTLE_LATEST_CP: the Castle Points of the challenge type. */
export const castlePoints = (state: GameState, challengeType: number): number => state.frontier?.castle?.streaks[challengeType]?.cp ?? 0;

/** Decomp BattleCastleApp_GetRank: a rank (BATTLE_CASTLE_RANK_*) of the challenge type, 1–3. */
export const castleRank = (state: GameState, challengeType: number, type: number): number => state.frontier?.castle?.ranks[challengeType]?.[type] ?? 1;

/** Decomp BattleCastle_SpendCastlePoints: the CP down (not below 0), the streak's spent CP up (at most 9999). */
export function spendCastlePoints(state: GameState, challengeType: number, cp: number): void {
  const s = streakOf(state, challengeType);
  s.cp = Math.max(0, s.cp - cp);
  s.spentCp = Math.min(CP_MAX, s.spentCp + cp);
}

/** Decomp BattleCastle_ReceiveCastlePoints: the CP up (at most 9999) and RECORD_CASTLE_POINTS_RECEIVED. */
export function receiveCastlePoints(state: GameState, registries: Registries, challengeType: number, cp: number): void {
  const s = streakOf(state, challengeType);
  s.cp = Math.min(CP_MAX, s.cp + cp);
  addToGameRecord(state, registries, RECORD_CP_RECEIVED, cp);
}

/** A rank up (decomp IncreaseRank): its CP, then the rank one higher. */
export function raiseCastleRank(state: GameState, challengeType: number, type: number, cp: number): void {
  const ranks = castleState(state).ranks[challengeType];
  if (!ranks) throw new Error(`battle castle: challenge type ${challengeType} has no ranks`);
  spendCastlePoints(state, challengeType, cp);
  ranks[type]!++;
}

/**
 * Decomp BattleCastle_ClearActiveStreak (BC_LOBBY_FUNC_DELETE_ACTIVE_STREAK, ScrCmd_DeleteActiveBattleCastleStreak):
 * the streak flag, the latest streak and CP, the ranks back to 1.
 */
export function deleteCastleStreak(state: GameState, challengeType: number): void {
  const c = castleState(state);
  c.active[challengeType] = false;
  const s = streakOf(state, challengeType);
  s.latest = 0;
  s.cp = 0;
  c.ranks[challengeType] = [1, 1, 1];
}

/** Decomp BattleCastle/Arcade_GetPlayerPartySize (single and double). */
export const castlePartySize = (challengeType: number): number => {
  if (challengeType !== SINGLE && challengeType !== DOUBLE) throw new Error(`battle castle: challenge type ${challengeType} is a link challenge`);
  return CASTLE.partySize;
};

/** A Pokémon brought to `level` (decomp Pokemon_GetSpeciesBaseExpAt and Pokemon_CalcLevelAndStats). */
export function setLevel(dex: Dex, mon: Pokemon, level: number): void {
  mon.exp = dex.expTable(dex.form(mon.species, mon.form).growthRate)[level]!;
  recalc(dex, mon);
}

/**
 * Decomp BattleCastle_GetOpponentTrainerID / BattleArcade_GetOpponentTrainerID: the brain at the singles 21st and 49th,
 * else a draw from the round's range (the seventh of each half from the final range).
 */
export function castleTrainerFor(ranges: readonly [number, number, number, number][], brain: [number, number], rand: Rand16, challengeType: number, round: number, offset: number): number {
  if (challengeType === SINGLE) {
    const streak = round * CASTLE.battlesPerRound + offset + 1;
    if (streak === CASTLE.silver) return brain[0];
    if (streak === CASTLE.gold) return brain[1];
  }
  const r = ranges[Math.min(round, ranges.length - 1)]!;
  const final = offset === CASTLE.battlesPerRound - 1 || offset === CASTLE.battlesPerRound * 2 - 1;
  const [min, max] = final ? [r[2], r[3]] : [r[0], r[1]];
  return min + (rand() % (max - min));
}

/** Decomp BattleCastle_PickOpponentTrainers: 14 trainers, none twice. */
export function pickCastleTrainers(ranges: readonly [number, number, number, number][], brain: [number, number], rand: Rand16, challengeType: number, round: number): number[] {
  const out: number[] = [];
  while (out.length < CASTLE.battlesPerRound * 2) {
    const t = castleTrainerFor(ranges, brain, rand, challengeType, round, out.length);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Decomp BattleFrontier_GetPokemonForTrainers (one trainer): the trainer's IVs, `count` of its sets with no species or
 * held item twice (SelectPokemonForTrainer), each drawn as a frontier Pokémon (an OT id, then a PID of the set's
 * nature that is not shiny).
 */
export function trainerMons(dex: Dex, registries: Registries, tables: FrontierTables, rand: Rand16, trainer: number, count: number): FactoryMon[] {
  const data = tables.trainers[trainer];
  if (!data) throw new Error(`frontier: no trainer ${trainer}`);
  const ivs = frontierTrainerIvs(trainer);
  const picked: FrontierSetData[] = [];
  const sets: number[] = [];
  while (sets.length !== count) {
    const set = data.sets[rand() % data.sets.length]!;
    const s = tables.sets[set]!;
    if (picked.some((p) => p.species === s.species || p.item === s.item)) continue;
    picked.push(s);
    sets.push(set);
  }
  return sets.map((set) => frontierMon(dex, registries, tables.sets, rand, set, ivs, null));
}

/** Decomp BattleCastle_RevivePokemon: a fainted Pokémon back at 1 HP, every status cured. */
export function reviveAll(party: Pokemon[]): void {
  for (const m of party) {
    if (m.hp === 0) m.hp = 1;
    m.status = 'none';
  }
}

/** The PP of a Pokémon's moves at their maximum (decomp MON_DATA_MOVEn_MAX_PP). */
export const maxPps = (dex: Dex, mon: Pokemon): number[] => mon.moves.map((m, i) => maxPp(dex.move(m).pp, mon.ppUps[i] ?? 0));

/** Decomp IsMonMissingPP. */
export const missingPp = (dex: Dex, mon: Pokemon): boolean => maxPps(dex, mon).some((max, i) => mon.pp[i] !== max);

/** Decomp HealPokemon: ITEM_MAX_POTION (HP), ITEM_MAX_ELIXIR (PP), or both. */
export function castleHeal(dex: Dex, mon: Pokemon, what: 'hp' | 'pp' | 'all'): void {
  if (what !== 'pp') mon.hp = mon.stats.hp;
  if (what !== 'hp') mon.pp = maxPps(dex, mon);
}

/** The rental list of a kind at a rank (decomp sItemsAvailableByRank, sBerriesAvailableByRank). */
export function castleRentals(t: BattleCastleTables, kind: 'items' | 'berries', rank: number): CastleRental[] {
  const n = (kind === 'items' ? t.itemsByRank : t.berriesByRank)[rank - 1];
  if (n === undefined) throw new Error(`battle castle: no rental rank ${rank}`);
  return t[kind].slice(0, n);
}

/** Decomp UpdateLevelAdjustment: up or down 5 from 50; the other way back to 50. */
export function adjustOpponentLevel(dex: Dex, mon: Pokemon, current: CastleUnlocks['level'][number], to: 'up' | 'down'): CastleUnlocks['level'][number] {
  const next = current === 'none' ? to : 'none';
  setLevel(dex, mon, ADJUSTED_LEVEL[next]);
  return next;
}

export const noUnlocks = (): CastleUnlocks => ({ identity: [false, false, false, false], level: ['none', 'none', 'none', 'none'], stats: [false, false, false, false], moves: [false, false, false, false] });

/**
 * One Battle Castle challenge (decomp BattleCastle): alive from the frontier's InitBattleCastle to FreeBattleCastle.
 * Not saved itself: `save` writes its resumable part to `FrontierState.castle.save`.
 */
export class BattleCastle {
  readonly challengeType: number;
  /** Decomp currentBattle (0–6), currentStreak, currentRound, saveStreak, seenCastleValetIntro, monFainted. */
  battle: number;
  streak: number;
  round: number;
  saveStreak = false;
  seenValetIntro = false;
  monFainted = false;
  won = false;
  /** Decomp partySlots, savedHeldItems (the entered Pokémon's own items, given back at the end). */
  readonly slots: number[];
  readonly heldItems: (Id | null)[];
  /** Decomp initialCP (the WFC multi's). */
  readonly initialCp: number;
  /** Decomp playersParty, opponentsParty. */
  players: Pokemon[];
  opponents: Pokemon[] = [];
  /** Decomp trainerIDs (14), opponentMons (the next opponent's draws) and monSetIDs. */
  trainers: number[] = Array<number>(CASTLE.battlesPerRound * 2).fill(0);
  opponentMons: FactoryMon[] = [];
  /** Decomp startingPP: each Pokémon's PP before the battle (the CP for PP spent). */
  startingPp: number[][] = [];
  /** Decomp appIdentityUnlocked, levelAdjustments, appStatsUnlocked, appMovesUnlocked. */
  unlocked: CastleUnlocks = noUnlocks();
  /** Decomp selectedAppSlots (the apps' last slot). */
  appSlot = 0;

  private constructor(
    private readonly state: GameState,
    private readonly registries: Registries,
    private readonly rand: Rand16,
    resume: boolean,
    challengeType: number,
    slots: number[],
  ) {
    const c = castleState(state);
    if (!resume) {
      this.challengeType = challengeType;
      this.battle = 0;
      c.save = newCastleSave();
      const s = streakOf(state, challengeType);
      if (c.active[challengeType]) this.streak = s.latest;
      else {
        this.streak = 0;
        s.cp = 0;
        s.spentCp = 0;
        c.ranks[challengeType] = [1, 1, 1];
      }
      this.slots = [...slots];
      this.initialCp = s.cp;
      s.cp = Math.min(CP_MAX, s.cp + START_CP);
    } else {
      this.challengeType = c.save.challengeType;
      this.battle = c.save.battle;
      this.streak = streakOf(state, this.challengeType).latest;
      this.slots = [...c.save.slots];
      this.initialCp = 0;
    }
    castlePartySize(this.challengeType);
    this.round = Math.floor(this.streak / CASTLE.battlesPerRound);
    const field = this.slots.map((s) => {
      const m = state.party[s];
      if (!m) throw new Error(`battle castle: no party slot ${s}`);
      return m;
    });
    this.heldItems = field.map((m) => m.heldItem);
    const dex = dexOf(registries);
    this.players = field.slice(0, castlePartySize(this.challengeType)).map((m) => {
      const mon = structuredClone(m);
      mon.heldItem = null;
      if (mon.level > CASTLE.maxLevel) setLevel(dex, mon, CASTLE.maxLevel);
      return mon;
    });
  }

  /** Decomp BattleCastle_Init(saveData, resumingFromSave, challengeType, partySlot1–3). */
  static init(state: GameState, registries: Registries, rand: Rand16, resume: boolean, challengeType: number, slots: number[]): BattleCastle {
    return new BattleCastle(state, registries, rand, resume, challengeType, slots);
  }

  private get tables(): FrontierTables {
    return frontierTables(this.registries);
  }

  private get t(): BattleCastleTables {
    return this.tables.castle;
  }

  private get dex(): Dex {
    return dexOf(this.registries);
  }

  /** Decomp BattleCastle_LoadTrainersForRound. */
  loadRound(resume: boolean): void {
    if (resume) this.loadFromSave();
    else {
      this.startingPp = this.players.map((m) => [...m.pp]);
      this.trainers = pickCastleTrainers(this.t.opponentRanges, this.t.darach, this.rand, this.challengeType, this.round);
      this.opponentMons = this.drawOpponent();
    }
  }

  /** Decomp BattleFrontier_GetPokemonForTrainers for the battle's trainer. */
  private drawOpponent(): FactoryMon[] {
    return trainerMons(this.dex, this.registries, this.tables, this.rand, this.trainers[this.battle]!, CASTLE.partySize);
  }

  /**
   * Decomp LoadTrainersAndMonsFromSave: the entered Pokémon's HP, PP, status and items, the round's trainers, the
   * opponent's sets (their OT ids and PIDs drawn again). The decomp loads them with an uninitialised IV list; here they
   * get the trainer's IVs.
   */
  private loadFromSave(): void {
    const s = castleState(this.state).save;
    this.players.forEach((m, i) => {
      m.hp = s.hp[i]!;
      m.pp = [...s.pp[i]!].slice(0, m.moves.length);
      m.status = s.status[i]!;
      m.heldItem = s.items[i]!;
    });
    this.trainers = [...s.trainers];
    const ivs = frontierTrainerIvs(this.trainers[this.battle]!);
    this.opponentMons = s.sets.slice(0, CASTLE.partySize).map((set) => frontierMon(this.dex, this.registries, this.tables.sets, this.rand, set, ivs, null));
    this.opponents = this.opponentMons.map((m) => this.opponentMon(m));
  }

  /** Decomp FrontierPokemon_InitPokemon at level 50, then BattleCastle_AddMonToParty (the player as its trainer). */
  private opponentMon(m: FactoryMon): Pokemon {
    const set = this.tables.sets[m.set]!;
    return frontierPokemon(this.dex, this.tables.sets, m.set, { otId: this.state.trainerId, pid: m.pid, ivs: m.ivs, item: set.item, otName: this.state.names.player, ball: newGameRecord(this.registries).pokeBall, level: CASTLE.maxLevel });
  }

  /** Decomp BattleCastle_SetupFirstOpponentsParty / SetupOpponentsParty. */
  setupOpponentsParty(): void {
    this.opponents = this.opponentMons.map((m) => this.opponentMon(m));
  }

  /** Decomp BattleCastle_SetupNextOpponentsParty: the battle's trainer's Pokémon drawn, then its party. */
  setupNextOpponent(): void {
    this.opponentMons = this.drawOpponent();
    this.setupOpponentsParty();
  }

  /** The next opponent's set `i` (decomp opponentMons, BC_FUNC_GET_MONS_SPECIES / _MOVE). */
  opponentSet(i: number): FrontierSetData {
    const m = this.opponentMons[i];
    if (!m) throw new Error(`battle castle: no opponent Pokémon ${i}`);
    return this.tables.sets[m.set]!;
  }

  /** Decomp BattleCastle_StoreAppResults: the parties and unlocks as the app left them. */
  setAppResult(result: { party: Pokemon[]; opponents: Pokemon[]; unlocked: CastleUnlocks; slot: number }): void {
    this.players = result.party;
    this.opponents = result.opponents;
    this.unlocked = result.unlocked;
    this.appSlot = result.slot;
  }

  /** Decomp BattleCastle_PrepForNextBattle: the PP before the battle kept, the party revived, the unlocks cleared. */
  prepForNextBattle(): void {
    this.startingPp = this.players.map((m) => [...m.pp]);
    reviveAll(this.players);
    this.unlocked = noUnlocks();
  }

  /**
   * Decomp BattleCastle_CalcCPEarnedFromBattle: 3 per Pokémon standing, 3 more at full HP (2 at half or more, 1 below),
   * 1 without a status; 8, 6 or 4 for 5, 10 or 15 PP used at most; 7 per opponent raised 5 levels; at least 1.
   */
  cpFromBattle(): number {
    this.monFainted = false;
    let cp = 0;
    let pp = 0;
    for (const m of this.players) {
      if (m.hp > 0) {
        cp += 3;
        if (m.hp === m.stats.hp) cp += 3;
        else if (m.hp >= Math.floor(m.stats.hp / 2)) cp += 2;
        else cp += 1;
        if (m.status === 'none') cp += 1;
      } else this.monFainted = true;
      pp += m.pp.reduce((a, b) => a + b, 0);
    }
    cp += 7 * this.unlocked.level.slice(0, CASTLE.partySize).filter((l) => l === 'up').length;
    const used = this.startingPp.flat().reduce((a, b) => a + b, 0) - pp;
    if (used <= 5) cp += 8;
    else if (used <= 10) cp += 6;
    else if (used <= 15) cp += 4;
    return Math.max(1, cp);
  }

  /** BC_FUNC_GET_CP_FROM_BATTLE: the battle's CP, received. */
  receiveBattleCp(): number {
    const cp = this.cpFromBattle();
    receiveCastlePoints(this.state, this.registries, this.challengeType, cp);
    return cp;
  }

  incrementStreak(): void {
    if (this.streak < STREAK_MAX) this.streak++;
  }

  /** Decomp BC_FUNC_GET_NEXT_BATTLE_TYPE: Darach's battles in singles. */
  nextBattleType(): number {
    if (this.challengeType !== SINGLE) return NEXT_BATTLE.normal;
    if (this.streak + 1 === CASTLE.silver) return NEXT_BATTLE.silver;
    if (this.streak + 1 === CASTLE.gold) return NEXT_BATTLE.gold;
    return NEXT_BATTLE.normal;
  }

  /** Decomp BattleCastle_GetNextOpponentObjectID. */
  opponentObject(slot: number): number {
    const cls = this.tables.trainers[this.trainerAt(slot)]!.class;
    return this.tables.tower.classObjects.find((c) => c.class === cls)?.gfx ?? this.tables.tower.defaultObject;
  }

  /** Decomp BC_FUNC_LOAD_TRAINERS: the battle's trainer in `slot` (0, or 1 a multi's second). */
  trainerAt(slot: number): number {
    return this.trainers[this.battle + slot * CASTLE.battlesPerRound]!;
  }

  /** Decomp BattleCastle_GetEarnedBP. */
  earnedBp(): number {
    if (this.challengeType === SINGLE && (this.streak === CASTLE.silver || this.streak === CASTLE.gold)) return BRAIN_BP;
    return this.t.battlePoints[Math.min(this.round, CASTLE.maxRounds)]!;
  }

  /** Decomp BattleCastle_GetAIMask: Darach expert; rounds 1–2 none, 3–4 basic, later expert. */
  aiMask(): number {
    const all = AI_FLAGS.basic | AI_FLAGS.evalAttack | AI_FLAGS.expert;
    if (this.challengeType === SINGLE && this.t.darach.includes(this.trainers[this.battle]!)) return all;
    const round = this.round + 1;
    if (round <= 2) return 0;
    if (round <= 4) return AI_FLAGS.basic;
    return all;
  }

  /** Decomp BattleCastle_SetupBattle: the opponents healed; the player's Pokémon as they are. */
  battleSetup(): FrontierBattle {
    for (const m of this.opponents) heal(this.dex, m);
    const id = this.trainers[this.battle]!;
    const data = this.tables.trainers[id]!;
    const name = this.registries.texts.get(data.name)?.text;
    if (name === undefined) throw new Error(`battle castle: no name for frontier trainer ${id}`);
    const trainer: FrontierBattleTrainer = { id, name, class: data.class, className: data.className, party: this.opponents.map((m) => structuredClone(m)) };
    return { facility: 'castle', party: this.players.map((m) => structuredClone(m)), trainers: [trainer], ai: this.aiMask() };
  }

  /** Decomp FrontierScrCmd_BattleCastle_CleanupBattle: the battle's party back into the challenge's. */
  cleanupBattle(party: Pokemon[], won: boolean): void {
    if (party.length !== this.players.length) throw new Error(`battle castle: ${party.length} Pokémon back from a battle of ${this.players.length}`);
    this.players = party.map((m) => structuredClone(m));
    this.won = won;
  }

  /** Decomp BC_FUNC_RESTORE_HELD_ITEMS: the entered Pokémon get their own items back. */
  restoreHeldItems(): void {
    this.slots.forEach((s, i) => (this.state.party[s]!.heldItem = this.heldItems[i]!));
  }

  /** Decomp BattleCastle_SaveOnLoss: the ranks back to 1. */
  saveOnLoss(): void {
    castleState(this.state).ranks[this.challengeType] = [1, 1, 1];
    this.save(1);
  }

  /** Decomp BattleCastle_SaveOnCompletingRound. */
  saveOnRoundComplete(): void {
    this.saveStreak = true;
    if (this.round < CASTLE.maxRounds) this.round++;
    this.battle = 0;
    this.save(0);
  }

  /** Decomp BattleCastle_Save: 2 is REST's (no record, no streak flag). */
  save(kind: 0 | 1 | 2): void {
    const c = castleState(this.state);
    const s = streakOf(this.state, this.challengeType);
    c.save.challengeType = this.challengeType;
    c.save.saved = true;
    c.save.battle = this.battle;
    s.latest = this.streak;
    if (kind !== 2) {
      const before = s.record;
      s.record = setIfBetter(s.record, this.streak);
      if (this.streak === before) s.recordCp = setIfBetter(s.recordCp, s.cp);
      else if (before < s.record) s.recordCp = s.cp;
      c.active[this.challengeType] = this.saveStreak;
    }
    c.save.trainers = [...this.trainers];
    c.save.slots = [...this.slots];
    this.players.forEach((m, i) => {
      c.save.hp[i] = m.hp;
      c.save.pp[i] = [0, 1, 2, 3].map((k) => m.pp[k] ?? 0);
      c.save.status[i] = m.status;
      c.save.items[i] = m.heldItem;
    });
    this.opponentMons.forEach((m, i) => (c.save.sets[i] = m.set));
  }
}

/** Decomp BC_FUNC_CHECK_HAVE_HEARD_DARACHS_INTRO: whether it was heard; it is from now on. */
export function castleHeardIntro(state: GameState): boolean {
  const c = castleState(state);
  const heard = c.heardIntro;
  c.heardIntro = true;
  return heard;
}
