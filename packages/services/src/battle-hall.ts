/**
 * The Battle Hall's rules (decomp overlay 104 battle_hall.c, battle_hall_helpers.c, frscrcmd_battle_hall.c; arm9
 * scrcmd_battle_hall.c, battle_hall_save.c, battle_hall_win_records.c). Headless and deterministic: the frontier VM's
 * Hall commands drive a `BattleHall` challenge over the player's own Pokémon, which reads and writes the saved part
 * (`FrontierState.hall`) as the decomp's BattleHallSave, BattleHallStreakFlags, the hall's BattleFrontierStats and
 * BattleHallWinRecords do.
 *
 * Draws take the caller's `rand` (decomp LCRNG_Next), in the decomp's order. The opponent's level is the decomp's
 * fixed-point and single-precision arithmetic, step by step.
 */
import { dexOf, newGameRecord, type BattleHallTables, type FrontierBattle, type FrontierTables, type GameState, type HallState, type Registries } from '@opensinnoh/contracts';
import { heal, isShiny, type Id, type Pokemon } from '@opensinnoh/core';
import { frontierBanned, frontierPokemon, frontierState, frontierTables } from './battle-tower.ts';
import { AI_FLAGS, frontierMon, NEXT_BATTLE, type FactoryMon, type Rand16 } from './battle-factory.ts';

/** Decomp HALL_* (constants/battle_frontier.h). */
export const HALL = { battlesPerRound: 10, silver: 50, gold: 170, maxRank: 10, maxRounds: 18, cells: 18, minLevel: 30 } as const;
/** The board cell `???` maps to (decomp GetCursorPos / selectedTypeIdx: cells 17–19 count as 17). */
const MATRON_CELL = 17;
/** Decomp FRONTIER_CHALLENGE_*. */
const SINGLE = 0;
const DOUBLE = 1;
const MULTI = 2;
/** Decomp BattleHall_SetMonsPersonality's step. */
const PID_STEP = (24 + 1) * 10001;
/** Decomp BattleHall_GetEarnedBP: an Argenta streak's BP. */
const BRAIN_BP = 20;
/** Decomp MAX_IVS_SINGLE_STAT (Argenta's Pokémon). */
const MAX_IV = 31;
const STREAK_MAX = 9999;
/** Decomp ScrCmd_GetBattleHallTotalSinglesRecord's cap. */
const TOTAL_MAX = 10000;

export function newHallState(): HallState {
  return {
    active: [false, false, false, false],
    streaks: Array.from({ length: 3 }, () => ({ current: 0, latest: 0, species: null })),
    ranks: Array.from({ length: 3 }, () => Array<number>(HALL.cells).fill(0)),
    save: { saved: false, challengeType: 0, battle: 0, slots: [0, 0], trainers: Array<number>(HALL.battlesPerRound * 2).fill(0), opponents: Array<number>(HALL.battlesPerRound * 2).fill(0) },
    records: [{}, {}, {}],
  };
}

export function hallState(state: GameState): HallState {
  return (frontierState(state).hall ??= newHallState());
}

/** Decomp BattleHall_GetPlayerPartySize / GetOpponentPartySize. */
export const hallPartySize = (challengeType: number): number => (challengeType === DOUBLE ? 2 : 1);

/**
 * Decomp CheckPartyIsBattleHallEligible (BH_LOBBY_FUNC_CHECK_PARTY_ELIGIBLE): enough Pokémon of level 30 or more, not
 * Eggs, not banned; for two, two of them of the same species.
 */
export function hallPartyEligible(state: GameState, registries: Registries, needed: number): boolean {
  if (state.party.length < needed) return false;
  const eligible = state.party.map((m) => (m.isEgg || m.level < HALL.minLevel || frontierBanned(registries, m.species) ? null : m.species));
  if (needed === 2) return eligible.some((s, i) => s !== null && eligible.some((t, j) => j !== i && t === s));
  return eligible.filter((s) => s !== null).length >= needed;
}

/** Decomp BattleHall_ClearActiveStreak (BH_LOBBY_FUNC_DELETE_ACTIVE_STREAK, ScrCmd_DeleteActiveBattleHallStreak). */
export function deleteHallStreak(state: GameState, challengeType: number): void {
  const h = hallState(state);
  h.active[challengeType] = false;
  h.streaks[challengeType]!.latest = 0;
}

/** A species' best Hall streaks summed over the singles (decomp ScrCmd_GetBattleHallTotalSinglesRecord, uncapped). */
function singlesTotal(state: GameState): number {
  return Object.values(state.frontier?.hall?.records[SINGLE] ?? {}).reduce((a, b) => a + b, 0);
}

/** Decomp ScrCmd_GetBattleHallTotalSinglesRecord: at most 10000. */
export const hallTotalSinglesRecord = (state: GameState): number => Math.min(TOTAL_MAX, singlesTotal(state));

/** Decomp ScrCmd_GetNumSpeciesWithBattleHallRecords: species with a record in any challenge type. */
export function hallSpeciesWithRecords(state: GameState): number {
  const records = state.frontier?.hall?.records ?? [];
  return new Set(records.flatMap((r) => Object.entries(r).filter(([, n]) => n > 0).map(([s]) => s))).size;
}

/** Decomp ScrCmd_CheckIfBattleHallStreakIs50: the singles' latest streak is 50. */
export const hallStreakIs50 = (state: GameState): boolean => state.frontier?.hall?.streaks[SINGLE]!.latest === HALL.silver;

/**
 * Decomp ScrCmd_GetBattleHallRecordKeeperStats: the singles total against the milestones from `next` on; the BP of
 * each one reached is given (RECORD_BATTLE_POINTS_RECEIVED with them). `response` 0 no record yet, 1 BP given, 2 the
 * next milestone, 3 all met; the numbers fill the message's slots.
 */
export function hallRecordKeeper(t: BattleHallTables, total: number, next: number): { next: number; response: number; bp: number; passed: number; upcoming: number | null } {
  let bp = 0;
  let reached = 0;
  let n = next;
  for (let i = next; i < t.milestones.length; i++) {
    if (t.milestones[i]!.record <= total) {
      bp += t.milestones[i]!.bp;
      n++;
      reached = i;
    }
  }
  let response = 0;
  if (total !== 0) {
    response = next !== n ? 1 : 2;
    if (next >= t.milestones.length) response = 3;
  }
  return { next: n, response, bp, passed: t.milestones[reached]!.record, upcoming: t.milestones[n]?.record ?? null };
}

/** Decomp BattleHall_CursorPosToType's cell → rank index (GetCursorPos: 17 for cells 17–19). */
export const hallRankCell = (cell: number): number => Math.min(cell, MATRON_CELL);

/** Decomp FX_Sqrt(FX32_CONST(level)): the square root in 20.12 fixed point. */
export const fxSqrt = (level: number): number => Math.floor(Math.sqrt(level * 4096 * 4096));

/**
 * Decomp BattleHall_CalcOpponentsLevel: the player's level − 3√level, plus the rank scaled by level / 5√level (or the
 * rank itself when that is below 1), plus half the other types battled; rounded up, at most the player's level.
 */
export function hallOpponentLevel(playersLevel: number, levelSqrt: number, rank: number, battled: number): number {
  const f = Math.fround;
  const baseLevel = playersLevel * 4096 - levelSqrt * 3;
  let rankFactor = f(f(levelSqrt / 4096) * 5.0);
  if (f(playersLevel / rankFactor) < 1.0) rankFactor = f(rank);
  else rankFactor = f(f((rank * playersLevel * 4096) / 4096) / rankFactor);
  let typesFactor = battled;
  if (typesFactor !== 0) typesFactor -= 1;
  typesFactor = f(typesFactor * 0.5);
  const total = f(f(f(baseLevel / 4096) + rankFactor) + typesFactor);
  let level = Math.trunc(total);
  if (total !== level) level++;
  return Math.min(level, playersLevel, 100);
}

/** Decomp BattleHall_PickNextOpponentPokemon: the next opponent's entry (1-based) in sBattleHallPotentialOpponents. */
export function hallOpponentPick(t: BattleHallTables, rand: Rand16, o: { type: Id; rank: number; battle: number; playerSpecies: Id; past: number[]; battleType: number }): number {
  const rank = Math.min(o.rank, HALL.maxRank - 1);
  let range: [number, number];
  if (o.battleType !== NEXT_BATTLE.normal) {
    let index = t.opponents.indexOf(o.playerSpecies);
    const groups = t.groupRanges;
    if (index < 0) index = groups[groups.length - 1]![0];
    let group = groups.findIndex(([, max]) => index < max);
    if (group < 0) group = groups.length - 1;
    range = o.battleType === NEXT_BATTLE.gold ? groups[groups.length - 1]! : groups[group]!;
  } else range = t.rankRanges[rank]!;
  const [min, max] = range;
  let index = min + (rand() % (max - min + 1)) - 1;
  const start = index;
  const here = o.battle * 2;
  let looped = false;
  for (;;) {
    // Not one fought this round; once the group is exhausted, not the last one.
    const fresh = !looped ? !o.past.slice(0, here).includes(index + 1) : o.past[here - 2] !== index + 1;
    if (fresh && t.opponents[index] !== o.playerSpecies) {
      if (o.battleType !== NEXT_BATTLE.normal) return index + 1;
      const [a, b] = t.opponentTypes[index]!;
      if (o.type === a || o.type === b) return index + 1;
    }
    index++;
    if (index + 1 >= max) index = min - 1;
    if (index === start) looped = true;
  }
}

/**
 * One Battle Hall challenge (decomp BattleHall): alive from the frontier's InitBattleHall to FreeBattleHall, over the
 * party Pokémon in `slots`. Not saved itself: `save` writes its resumable part to `FrontierState.hall.save`.
 */
export class BattleHall {
  readonly challengeType: number;
  /** Decomp currentBattle (0–9), currentStreak, currentRound, saveStreak, opponentsLevel, playerLevelSqrt. */
  battle: number;
  streak: number;
  round: number;
  saveStreak = false;
  opponentsLevel = 0;
  levelSqrt = 0;
  won = false;
  /** Decomp partySlots, heldItems. */
  readonly slots: number[];
  readonly heldItems: (Id | null)[];
  /** Decomp trainerIDs (two per battle) and monIndices (the opponents' entries, two per battle). */
  trainers: number[];
  monIndices: number[];
  /** Decomp selectedTypeIdx2 (the board cell), selectedTypeIdx (capped at 17), selectedType. */
  cell = 0;
  rankCell = 0;
  selectedType: Id | 'summary' = 'summary';
  /** Decomp typeRanks[challengeType]: the board's ranks for this challenge. */
  ranks: number[];
  /** The battle's opponent (decomp opponentMons[currentBattle * 2]). */
  private opponent: FactoryMon | null = null;

  private constructor(
    private readonly state: GameState,
    private readonly registries: Registries,
    private readonly rand: Rand16,
    resume: boolean,
    challengeType: number,
    slot1: number,
    slot2: number,
  ) {
    const h = hallState(state);
    if (!resume) {
      this.challengeType = challengeType;
      this.battle = 0;
      h.save = newHallState().save;
      if (h.active[challengeType]) this.streak = h.streaks[challengeType]!.latest;
      else {
        this.streak = 0;
        h.ranks[challengeType] = Array<number>(HALL.cells).fill(0);
      }
      this.slots = [slot1, slot2];
      this.trainers = Array<number>(HALL.battlesPerRound * 2).fill(0);
      this.monIndices = Array<number>(HALL.battlesPerRound * 2).fill(0);
    } else {
      this.challengeType = h.save.challengeType;
      this.battle = h.save.battle;
      this.streak = h.streaks[this.challengeType]!.latest;
      this.slots = [...h.save.slots];
      this.trainers = [...h.save.trainers];
      this.monIndices = [...h.save.opponents];
    }
    if (this.challengeType !== SINGLE && this.challengeType !== DOUBLE) throw new Error(`battle hall: challenge type ${this.challengeType} is a link challenge`);
    this.heldItems = this.mons().map((m) => m.heldItem);
    this.round = Math.floor(this.streak / HALL.battlesPerRound);
    this.ranks = [...h.ranks[this.challengeType]!];
  }

  /** Decomp BattleHall_Init(saveData, resumingFromSave, challengeType, partySlot1, partySlot2). */
  static init(state: GameState, registries: Registries, rand: Rand16, resume: boolean, challengeType: number, slot1: number, slot2: number): BattleHall {
    return new BattleHall(state, registries, rand, resume, challengeType, slot1, slot2);
  }

  private get tables(): FrontierTables {
    return frontierTables(this.registries);
  }

  private get t(): BattleHallTables {
    return this.tables.hall;
  }

  /** The entered party Pokémon (the player's own). */
  mons(): Pokemon[] {
    return this.slots.slice(0, hallPartySize(this.challengeType)).map((s) => {
      const m = this.state.party[s];
      if (!m) throw new Error(`battle hall: no party slot ${s}`);
      return m;
    });
  }

  /** Decomp BattleHall_GetHighestLevelInParty. */
  highestLevel(): number {
    return Math.max(...this.mons().map((m) => m.level));
  }

  /** Decomp BattleHall_GetTypeSelectionAppResult. */
  setCell(cell: number): void {
    const type = this.t.grid[cell];
    if (type === undefined) throw new Error(`battle hall: no board cell ${cell}`);
    this.cell = cell;
    this.rankCell = hallRankCell(cell);
    this.selectedType = type;
  }

  /** Decomp BattleHall_CapTypeRanks: once every type is at rank 10, they all go back to 9. */
  capRanks(): void {
    if (this.ranks.slice(0, HALL.cells - 1).every((r) => r >= HALL.maxRank)) for (let i = 0; i < HALL.cells - 1; i++) this.ranks[i] = HALL.maxRank - 1;
  }

  /** Decomp BattleHall_CalcPlayerLevelSqrt (BH_FUNC_SET_BASE_LEVEL). */
  setBaseLevel(): void {
    this.levelSqrt = fxSqrt(this.highestLevel());
  }

  /** The other cells battled, for the level (decomp CalcOpponentsLevel's numBattledTypesFactor). */
  private battledTypes(): number {
    let n = 0;
    for (let i = 0; i < HALL.cells; i++) if (i === this.rankCell || this.ranks[i]! > 0) n++;
    return n;
  }

  /** Decomp BattleHall_CalcOpponentsLevel. */
  opponentLevelForRank(): number {
    return hallOpponentLevel(this.highestLevel(), this.levelSqrt, this.ranks[this.rankCell]!, this.battledTypes());
  }

  /** Decomp SetupNextOpponent: the battle's trainers by class, Argenta at the singles 50th and 170th, its Pokémon. */
  setupNextOpponent(): void {
    const n = this.challengeType === SINGLE ? 1 : 2;
    let rank = this.ranks[this.rankCell]!;
    this.opponentsLevel = this.opponentLevelForRank();
    this.pickTrainers(n, rank, this.pickClasses(n, rank));
    const first = this.trainers[this.battle * 2]!;
    const [silver, gold] = this.t.argenta;
    if (first === silver || first === gold) rank = this.matronRank();
    const battleType = first === silver ? NEXT_BATTLE.silver : first === gold ? NEXT_BATTLE.gold : NEXT_BATTLE.normal;
    if (this.selectedType === 'summary') throw new Error('battle hall: no type picked');
    this.monIndices[this.battle * 2] = hallOpponentPick(this.t, this.rand, { type: this.selectedType, rank, battle: this.battle, playerSpecies: this.mons()[0]!.species, past: this.monIndices, battleType });
  }

  /** Decomp BattleHall_GetHallMatronTypeRank: the first Pokémon's level / 10. */
  private matronRank(): number {
    return Math.floor(this.mons()[0]!.level / 10);
  }

  /** Decomp BattleHall_PickOpponentTrainerClasses: a class per trainer, 8 in 12 by rank, else by the picked cell. */
  private pickClasses(n: number, rank: number): Id[] {
    const r = Math.min(rank, HALL.maxRank - 1);
    return Array.from({ length: n }, () => {
      const roll = this.rand() % 12;
      return roll < 8 ? this.t.classesByRank[r]![roll]! : this.t.classesByCell[this.rankCell]![roll - 8]!;
    });
  }

  /**
   * Decomp BattleHall_PickOpponentTrainers: for each trainer slot's class (decomp: held in trainerIDs until replaced), a
   * frontier trainer of that class not picked before this round, scanning on from a random one; when none is left,
   * another class of the rank's.
   */
  private pickTrainers(n: number, rank: number, classes: Id[]): void {
    const offset = this.battle * 2;
    const r = Math.min(rank, HALL.maxRank - 1);
    if (this.challengeType === SINGLE) {
      const streak = this.round * HALL.battlesPerRound + this.battle + 1;
      if (streak === HALL.silver) return void (this.trainers[offset] = this.t.argenta[0]);
      if (streak === HALL.gold) return void (this.trainers[offset] = this.t.argenta[1]);
    }
    const byTrainer = this.t.trainerClasses;
    let picked = 0;
    do {
      let id = this.rand() % byTrainer.length;
      const start = id;
      for (;;) {
        const cls = classes[picked]!;
        if (byTrainer[id] === cls && !this.trainers.slice(0, offset + picked).includes(id)) {
          this.trainers[offset + picked] = id;
          picked++;
          break;
        }
        id++;
        if (id >= byTrainer.length) id = 0;
        if (id === start) {
          for (;;) {
            const other = this.t.classesByRank[r]![this.rand() % 8]!;
            if (other !== cls) {
              classes[picked] = other;
              break;
            }
          }
        }
      }
    } while (picked < n);
  }

  /** Decomp BattleHall_GetNextOpponentObjectID. */
  opponentObject(slot: number): number {
    const cls = this.tables.trainers[this.trainerAt(slot)]!.class;
    return this.tables.tower.classObjects.find((c) => c.class === cls)?.gfx ?? this.tables.tower.defaultObject;
  }

  /** Decomp BH_FUNC_LOAD_TRAINERS: the battle's trainer in `slot`. */
  trainerAt(slot: number): number {
    return this.trainers[this.battle * 2 + slot]!;
  }

  /** Decomp BH_FUNC_INCREMENT_RANK_OF_BEATEN_TYPE. */
  incrementRank(): void {
    if (this.ranks[this.rankCell]! < HALL.maxRank) this.ranks[this.rankCell]!++;
  }

  /** Decomp BH_FUNC_GET_RANK_OF_BEATEN_TYPE. */
  beatenRank(): number {
    return this.ranks[this.rankCell]!;
  }

  incrementStreak(): void {
    if (this.streak < STREAK_MAX) this.streak++;
  }

  /** Decomp BH_FUNC_GET_NEXT_BATTLE_TYPE: Argenta's battles in singles. */
  nextBattleType(): number {
    if (this.challengeType !== SINGLE) return NEXT_BATTLE.normal;
    if (this.streak + 1 === HALL.silver) return NEXT_BATTLE.silver;
    if (this.streak + 1 === HALL.gold) return NEXT_BATTLE.gold;
    return NEXT_BATTLE.normal;
  }

  /** Decomp BattleHall_GetEarnedBP. */
  earnedBp(): number {
    if (this.challengeType === SINGLE && (this.streak === HALL.silver || this.streak === HALL.gold)) return BRAIN_BP;
    return this.t.battlePoints[Math.min(this.round, HALL.maxRounds)]!;
  }

  /** Decomp BattleHall_GetAIMask: by rank (4+ basic, 8+ expert), Argenta and multi on expert. */
  private aiMask(rank: number): number {
    const all = AI_FLAGS.basic | AI_FLAGS.evalAttack | AI_FLAGS.expert;
    let mask = rank + 1 >= 8 ? all : rank + 1 >= 4 ? AI_FLAGS.basic : 0;
    if (this.challengeType === SINGLE && this.t.argenta.includes(this.trainers[this.battle * 2]!)) mask = all;
    if (this.challengeType === MULTI) mask = all;
    return mask;
  }

  /**
   * Decomp BattleHall_SetupBattle: the party healed, healed copies of the entered Pokémon against the trainer's
   * Pokémon (set by its entry, IVs by rank or 31 for Argenta) at the opponent's level, its PID stepped until not
   * shiny for each battler it fills (doubles: the same set twice).
   */
  battleSetup(): FrontierBattle {
    const dex = dexOf(this.registries);
    for (const m of this.state.party) heal(dex, m);
    const offset = this.battle * 2;
    const rank = this.ranks[this.rankCell]!;
    const trainer = this.trainers[offset]!;
    const argenta = this.t.argenta.includes(trainer);
    const ivs = argenta ? MAX_IV : this.t.ivs[Math.min(rank, HALL.maxRank - 1)]!;
    const size = hallPartySize(this.challengeType);
    const loaded = Array.from({ length: size }, (_, i) => frontierMon(dex, this.registries, this.t.sets, this.rand, this.monIndices[offset + i]!, ivs, null));
    const mon = loaded[0]!;
    const level = argenta ? this.highestLevel() : this.opponentsLevel;
    const data = this.tables.trainers[trainer]!;
    const name = this.registries.texts.get(data.name)?.text;
    if (name === undefined) throw new Error(`battle hall: no name for frontier trainer ${trainer}`);
    const party = Array.from({ length: size }, () => {
      do mon.pid = (mon.pid > PID_STEP ? mon.pid - PID_STEP : mon.pid + PID_STEP) >>> 0;
      while (isShiny(mon.otId, mon.pid));
      return frontierPokemon(dex, this.t.sets, mon.set, { otId: mon.otId, pid: mon.pid, ivs: mon.ivs, item: this.t.sets[mon.set]!.item, otName: name, ball: newGameRecord(this.registries).pokeBall, level });
    });
    this.opponent = mon;
    const copies = this.mons().map((m) => structuredClone(m));
    return { facility: 'hall', party: copies, trainers: [{ id: trainer, name, class: data.class, className: data.className, party }], ai: this.aiMask(rank) };
  }

  /** The species the battle's opponent is (after `battleSetup`). */
  opponentSpecies(): Id {
    if (!this.opponent) throw new Error('battle hall: no battle set up');
    return this.t.sets[this.opponent.set]!.species;
  }

  /** Decomp BH_FUNC_RESTORE_HELD_ITEMS: the entered Pokémon get their held items back. */
  restoreHeldItems(): void {
    this.mons().forEach((m, i) => (m.heldItem = this.heldItems[i]!));
  }

  /** Decomp BattleHall_SaveOnLoss: the board's ranks reset. */
  saveOnLoss(): void {
    this.ranks = Array<number>(HALL.cells).fill(0);
    this.save(1);
  }

  /** Decomp BattleHall_SaveOnCompletingRound. */
  saveOnRoundComplete(): void {
    this.saveStreak = true;
    if (this.round < HALL.maxRounds) this.round++;
    this.battle = 0;
    this.save(0);
  }

  /** Decomp BattleHall_Save: 2 is REST's (no current streak, no streak flag). */
  save(kind: 0 | 1 | 2): void {
    const h = hallState(this.state);
    const s = h.streaks[this.challengeType]!;
    h.save.challengeType = this.challengeType;
    h.save.saved = true;
    h.save.battle = this.battle;
    s.latest = this.streak;
    if (kind !== 2) {
      s.current = this.streak;
      h.active[this.challengeType] = this.saveStreak;
    }
    h.save.trainers = [...this.trainers];
    h.save.slots = [...this.slots];
    h.ranks[this.challengeType] = [...this.ranks];
    h.save.opponents = [...this.monIndices];
    s.species = this.mons()[0]!.species;
  }

  /**
   * Decomp BattleHall_UpdateWinRecordForCurrentMon (BattleHallWinRecords_UpdateRecord): the species' record becomes the
   * current streak when that is better (at most 9999). True when it changed.
   */
  updateWinRecord(): boolean {
    const h = hallState(this.state);
    const s = h.streaks[this.challengeType]!;
    if (s.species === null) throw new Error('battle hall: no species on record');
    const records = h.records[this.challengeType]!;
    const current = records[s.species] ?? 0;
    if (current < s.current) records[s.species] = Math.min(STREAK_MAX, s.current);
    else if (current > STREAK_MAX) records[s.species] = STREAK_MAX;
    return s.current !== current;
  }
}

/** Decomp BH_LOBBY_FUNC_GET_CURRENT_STREAK_SPECIES. */
export const hallStreakSpecies = (state: GameState, challengeType: number): Id | null => state.frontier?.hall?.streaks[challengeType]?.species ?? null;
