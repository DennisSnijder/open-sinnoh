/**
 * The Battle Factory's rules (decomp overlay 104 battle_factory.c, battle_factory_helpers.c, frscrcmd_battle_factory.c;
 * arm9 battle_factory_save.c, scrcmd_battle_factory.c). Headless and deterministic: the frontier VM's Factory commands
 * drive a `BattleFactory` challenge, which reads and writes the saved part (`FrontierState.factory`) as the decomp's
 * BattleFactorySave, BattleFactoryStreakFlags and the factory's BattleFrontierStats do.
 *
 * Draws take the caller's `rand` (decomp LCRNG_Next: a u16 per call), in the decomp's order.
 */
import { dexOf, newGameRecord, type BattleFactoryTables, type FactoryPool, type FactoryState, type FrontierBattle, type FrontierBattleTrainer, type FrontierSetData, type FrontierTables, type GameState, type Registries } from '@opensinnoh/contracts';
import { heal, isShiny, natureIndex, type Dex, type Id, type Pokemon } from '@opensinnoh/core';
import { frontierPokemon, frontierState, frontierTables, setIfBetter } from './battle-tower.ts';
import { addToGameRecord } from './score.ts';

/** Decomp FACTORY_* (constants/battle_frontier.h). */
export const FACTORY = { battlesPerRound: 7, silver: 21, gold: 49, rentals: 6, partySize: 3, maxParty: 4, maxRounds: 8 } as const;
/** Decomp FRONTIER_CHALLENGE_*. */
const SINGLE = 0;
const DOUBLE = 1;
/** Decomp FRONTIER_NEXT_BATTLE_*. */
export const NEXT_BATTLE = { normal: 0, silver: 1, gold: 2 } as const;
/** Decomp RECORD_BATTLE_FACTORY_TRADES. */
const RECORD_TRADES = 64;
/** Decomp BattleFactory_GetEarnedBP: a Thorton streak's BP. */
const BRAIN_BP = 20;
/** Decomp AI_FLAG_BASIC, AI_FLAG_EVAL_ATTACK, AI_FLAG_EXPERT. */
export const AI_FLAGS = { basic: 1, evalAttack: 2, expert: 4 } as const;
const STREAK_MAX = 9999;

/** A u16 per call (decomp LCRNG_Next). */
export type Rand16 = () => number;

/** `FactoryState.active`/`streaks` index (decomp BattleFrontierStats_GetFactory*Idx, FACTORY_SAVE_STREAK_FLAGS). */
export const factoryIndex = (openLevel: boolean, challengeType: number): number => (openLevel ? 4 : 0) + challengeType;

export function newFactoryState(): FactoryState {
  return {
    active: Array<boolean>(8).fill(false),
    streaks: Array.from({ length: 8 }, () => ({ record: 0, latest: 0, recordTrades: 0, latestTrades: 0 })),
    save: newFactorySave(),
  };
}

/** Decomp BattleFactorySave_Init. */
function newFactorySave(): FactoryState['save'] {
  const none = () => Array.from({ length: FACTORY.maxParty }, () => ({ set: 0, pid: 0, ivs: 0 }));
  return { saved: false, challengeType: 0, openLevel: false, battle: 0, trainers: Array<number>(FACTORY.battlesPerRound * 2).fill(0), player: none(), opponent: none() };
}

export function factoryState(state: GameState): FactoryState {
  return (frontierState(state).factory ??= newFactoryState());
}

/** Decomp ScrCmd_DeleteActiveBattleFactoryStreak: the streak of that type and level ends (flag, latest streak, trades). */
export function deleteFactoryStreak(state: GameState, challengeType: number, openLevel: boolean): void {
  const f = factoryState(state);
  const i = factoryIndex(openLevel, challengeType);
  f.active[i] = false;
  f.streaks[i]!.latest = 0;
  f.streaks[i]!.latestTrades = 0;
}

/** A drawn frontier Pokémon (decomp FrontierPokemon): its set, IVs, OT id and PID. */
export interface FactoryMon {
  set: number;
  ivs: number;
  otId: number;
  pid: number;
}

/** Decomp FrontierPokemon_Init's PID: drawn until it has the set's nature and is not shiny, unless given. */
export function frontierMon(dex: Dex, registries: Registries, sets: readonly FrontierSetData[], rand: Rand16, set: number, ivs: number, pid: number | null): FactoryMon {
  const data = sets[set];
  if (!data) throw new Error(`frontier: no set ${set}`);
  // Decomp BattleFrontier_LoadOpponentMonData: the OT id comes first.
  const otId = (rand() | (rand() << 16)) >>> 0;
  if (pid !== null) return { set, ivs, otId, pid };
  const nature = registries.natures.get(data.nature)?.sourceIndex;
  if (nature === undefined) throw new Error(`frontier: set ${set} has an unknown nature ${data.nature}`);
  let p: number;
  do p = (rand() | (rand() << 16)) >>> 0;
  while (natureIndex(dex, p) !== nature || isShiny(otId, p));
  return { set, ivs, otId, pid: p };
}

/** Decomp BattleFactory_GetPokemonPoolForTrainer. */
export function factoryTrainerPool(t: BattleFactoryTables, trainer: number, openLevel: boolean): { pools: FactoryPool[]; index: number } {
  const pools = openLevel ? t.openOpponentPools : t.level50Pools;
  const index = pools.findIndex((p) => trainer < p.trainerMax);
  if (index < 0) throw new Error(`battle factory: no pool for trainer ${trainer}`);
  return { pools, index };
}

/** Decomp GetPlayerPoolForRound. */
export function factoryPlayerPool(t: BattleFactoryTables, round: number, openLevel: boolean): { pools: FactoryPool[]; index: number } {
  return { pools: openLevel ? t.openPlayerPools : t.level50Pools, index: Math.min(round, FACTORY.maxRounds - 1) };
}

/**
 * Decomp BattleFactory_SelectPokemonFromPool: `count` sets drawn from the pool's range (from its top down), the last
 * ones from the next pool once the trade count passes sTradeCountsNeededForUpgrades; none with a species or an item
 * (an empty one too) already drawn or excluded.
 */
export function factoryPicks(t: BattleFactoryTables, sets: readonly FrontierSetData[], rand: Rand16, pool: { pools: FactoryPool[]; index: number }, count: number, tradeCount: number, excluded: { species: Id; item: Id | null }[]): { set: number; ivs: number }[] {
  const p = pool.pools[pool.index]!;
  let upgradable = 0;
  if (tradeCount !== 0) {
    upgradable = t.tradeUpgrades.length;
    const i = t.tradeUpgrades.findIndex((n) => tradeCount <= n);
    if (i >= 0) upgradable = i;
  }
  // Decomp: setIDRange is reassigned by an upgraded draw (the upgraded draws come last, so later ones use it too).
  let range = p.setMax - p.setMin;
  const out: { set: number; ivs: number }[] = [];
  while (out.length !== count) {
    let set: number;
    let ivs: number;
    if (out.length >= count - upgradable && p.upgradable) {
      const next = pool.pools[pool.index + 1];
      if (!next) throw new Error('battle factory: an upgrade past the last pool');
      range = next.setMax - next.setMin;
      set = next.setMax - (rand() % (range + 1));
      ivs = next.ivs;
    } else {
      set = p.setMax - (rand() % (range + 1));
      ivs = p.ivs;
    }
    const s = sets[set]!;
    if (out.some((o) => sets[o.set]!.species === s.species || sets[o.set]!.item === s.item)) continue;
    if (excluded.some((e) => e.species === s.species || e.item === s.item)) continue;
    out.push({ set, ivs });
  }
  return out;
}

/** Decomp BattleFactory_GetOpponentTrainerID: Thorton at the singles 21st and 49th, else a draw from the round's range. */
export function factoryTrainerFor(t: BattleFactoryTables, rand: Rand16, challengeType: number, round: number, offset: number): number {
  const r = Math.min(round, t.opponentRanges.length - 1);
  if (challengeType === SINGLE) {
    const streak = r * FACTORY.battlesPerRound + offset + 1;
    if (streak === FACTORY.silver) return t.thorton[0];
    if (streak === FACTORY.gold) return t.thorton[1];
  }
  const [normalMin, normalMax, finalMin, finalMax] = t.opponentRanges[r]!;
  const final = offset === FACTORY.battlesPerRound - 1 || offset === FACTORY.battlesPerRound * 2 - 1;
  const [min, max] = final ? [finalMin, finalMax] : [normalMin, normalMax];
  return min + (rand() % (max - min));
}

/**
 * One Battle Factory challenge (decomp BattleFactory): alive from the frontier's InitBattleFactory to FreeBattleFactory.
 * Not saved itself: `save` writes its resumable part to `FrontierState.factory.save`.
 */
export class BattleFactory {
  readonly challengeType: number;
  readonly openLevel: boolean;
  /** Decomp currentBattle (0–6), tradeCount, currentStreak, currentRound, saveStreak, seenFactoryHeadIntro. */
  battle: number;
  tradeCount: number;
  streak: number;
  round: number;
  saveStreak = false;
  seenHeadIntro = false;
  won = false;
  /** Decomp trainerIDs (14: the round's seven, and seven a multi partner's side would face). */
  trainers: number[] = Array<number>(FACTORY.battlesPerRound * 2).fill(0);
  /** Decomp initialRental*: the six rentals; after a battle, the beaten trainer's sets (the trade's offers). */
  rentals: FactoryMon[] = [];
  /** Decomp opponentMon*: the next opponent's Pokémon. */
  opponentMons: FactoryMon[] = [];
  /** Decomp playersParty, opponentsParty. */
  players: Pokemon[] = [];
  opponents: Pokemon[] = [];
  /** Decomp playerMonSetIDs. */
  playerSets: number[] = [];
  /** Decomp selectedAppSlots (the rental app's result). */
  appSlots: number[] = Array<number>(6).fill(0);

  private constructor(
    private readonly state: GameState,
    private readonly registries: Registries,
    private readonly rand: Rand16,
    private readonly otName: string,
    resume: boolean,
    challengeType: number,
    openLevel: boolean,
  ) {
    const f = factoryState(state);
    if (!resume) {
      this.challengeType = challengeType;
      this.openLevel = openLevel;
      this.battle = 0;
      f.save = newFactorySave();
      const i = factoryIndex(openLevel, challengeType);
      const active = f.active[i]!;
      this.streak = active ? f.streaks[i]!.latest : 0;
      this.tradeCount = active ? f.streaks[i]!.latestTrades : 0;
    } else {
      this.challengeType = f.save.challengeType;
      this.openLevel = f.save.openLevel;
      this.battle = f.save.battle;
      const i = factoryIndex(this.openLevel, this.challengeType);
      this.streak = f.streaks[i]!.latest;
      this.tradeCount = f.streaks[i]!.latestTrades;
    }
    if (this.challengeType !== SINGLE && this.challengeType !== DOUBLE) throw new Error(`battle factory: challenge type ${this.challengeType} is a link challenge`);
    this.round = Math.floor(this.streak / FACTORY.battlesPerRound);
  }

  /** Decomp BattleFactory_Init(saveData, resumingFromSave, challengeType, isOpenLevel). `otName` is the rentals' OT. */
  static init(state: GameState, registries: Registries, rand: Rand16, otName: string, resume: boolean, challengeType: number, openLevel: boolean): BattleFactory {
    return new BattleFactory(state, registries, rand, otName, resume, challengeType, openLevel);
  }

  private get tables(): FrontierTables {
    return frontierTables(this.registries);
  }

  private get t(): BattleFactoryTables {
    return this.tables.factory;
  }

  /** Decomp BattleFactory_GetPokemonLevel. */
  get level(): number {
    return this.openLevel ? 100 : 50;
  }

  private mon(m: FactoryMon): Pokemon {
    const dex = dexOf(this.registries);
    const set = this.tables.sets[m.set]!;
    return frontierPokemon(dex, this.tables.sets, m.set, { otId: m.otId, pid: m.pid, ivs: m.ivs, item: set.item, otName: this.otName, ball: newGameRecord(this.registries).pokeBall, level: this.level });
  }

  private draw(picks: { set: number; ivs: number }[], pids?: number[]): FactoryMon[] {
    const dex = dexOf(this.registries);
    return picks.map((p, i) => frontierMon(dex, this.registries, this.tables.sets, this.rand, p.set, p.ivs, pids?.[i] ?? null));
  }

  /** Decomp BattleFactory_LoadTrainersAndRentalsForRound. */
  loadRound(resume: boolean): void {
    if (resume) this.loadFromSave();
    else this.setupRound();
  }

  /** Decomp SetupTrainersAndInitialRentalOptions. */
  private setupRound(): void {
    for (let i = 0; i < this.trainers.length; ) {
      this.trainers[i] = factoryTrainerFor(this.t, this.rand, this.challengeType, this.round, i);
      if (this.trainers.slice(0, i).includes(this.trainers[i]!)) continue;
      i++;
    }
    const sets = this.tables.sets;
    this.rentals = this.draw(factoryPicks(this.t, sets, this.rand, factoryPlayerPool(this.t, this.round, this.openLevel), FACTORY.rentals, this.tradeCount, []));
    // Decomp SwapMonIndices(4) and (5): the last two rentals swap with a random one.
    for (const i of [4, 5]) {
      const j = this.rand() % FACTORY.rentals;
      [this.rentals[i], this.rentals[j]] = [this.rentals[j]!, this.rentals[i]!];
    }
    const used = this.rentals.map((m) => ({ species: sets[m.set]!.species, item: sets[m.set]!.item }));
    this.opponentMons = this.draw(factoryPicks(this.t, sets, this.rand, factoryTrainerPool(this.t, this.trainers[this.battle]!, this.openLevel), FACTORY.partySize, 0, used));
    this.players = this.rentals.map((m) => this.mon(m));
  }

  /** Decomp LoadTrainersAndMonsFromSave: the round's trainers and both parties from the save. */
  private loadFromSave(): void {
    const s = factoryState(this.state).save;
    this.trainers = [...s.trainers];
    const load = (rows: FactoryState['save']['player']) => this.draw(rows.slice(0, FACTORY.partySize), rows.slice(0, FACTORY.partySize).map((r) => r.pid));
    const player = load(s.player);
    this.playerSets = player.map((m) => m.set);
    this.players = player.map((m) => this.mon(m));
    this.opponentMons = load(s.opponent);
    this.opponents = this.opponentMons.map((m) => this.mon(m));
  }

  /** Decomp BattleFactory_GetMonSelectionAppResult: the rental app's picks (rent) or [given, taken] (swap; 0xFF none). */
  setAppResult(slots: number[]): void {
    this.appSlots = [...slots, ...Array<number>(6).fill(0)].slice(0, 6);
  }

  /** Decomp BattleFactory_AddSelectedRentalsToParty: the picked rentals, and the first opponent's party. */
  addRentals(): void {
    const picked = this.appSlots.slice(0, FACTORY.partySize).map((i) => {
      const m = this.rentals[i];
      if (!m) throw new Error(`battle factory: no rental ${i}`);
      return m;
    });
    this.players = picked.map((m) => this.mon(m));
    this.playerSets = picked.map((m) => m.set);
    this.opponents = this.opponentMons.slice(0, FACTORY.partySize).map((m) => this.mon(m));
  }

  /**
   * Decomp BattleFactory_SetupNextOpponent: the beaten trainer's sets become the trade's offers; the next opponent's
   * Pokémon are drawn, none sharing a species or item with either party.
   */
  setupNextOpponent(): void {
    const used = [...this.players, ...this.opponents].map((m) => ({ species: m.species, item: m.heldItem }));
    this.rentals = this.opponentMons.slice(0, this.opponents.length);
    const pool = factoryTrainerPool(this.t, this.trainers[this.battle]!, this.openLevel);
    this.opponentMons = this.draw(factoryPicks(this.t, this.tables.sets, this.rand, pool, FACTORY.partySize, 0, used));
  }

  /** Decomp BattleFactory_ApplyTrade: the trade from the app (none when slot 0 is 0xFF). */
  applyTrade(): void {
    const [give, take] = this.appSlots as [number, number];
    if (give === 0xff) return;
    const mon = this.opponents[take];
    if (!mon || !this.players[give]) throw new Error(`battle factory: trade ${give} for ${take}`);
    this.players[give] = structuredClone(mon);
    this.playerSets[give] = this.rentals[take]!.set;
    this.incrementTrades();
    addToGameRecord(this.state, this.registries, RECORD_TRADES, 1);
  }

  /** Decomp BattleFactory_SetupNextOpponentsParty. */
  setupNextOpponentsParty(): void {
    this.opponents = this.opponentMons.slice(0, FACTORY.partySize).map((m) => this.mon(m));
  }

  /** Decomp BattleFactory_IncrementTradeCount. */
  incrementTrades(): void {
    if (this.tradeCount < STREAK_MAX) this.tradeCount++;
  }

  incrementStreak(): void {
    if (this.streak < STREAK_MAX) this.streak++;
  }

  /** Decomp BF_FUNC_GET_NEXT_BATTLE_TYPE: Thorton's battles in singles. */
  nextBattleType(): number {
    if (this.challengeType !== SINGLE) return NEXT_BATTLE.normal;
    if (this.streak + 1 === FACTORY.silver) return NEXT_BATTLE.silver;
    if (this.streak + 1 === FACTORY.gold) return NEXT_BATTLE.gold;
    return NEXT_BATTLE.normal;
  }

  /** Decomp BattleFactory_GetNextOpponentObjectID: the 2D character of the battle's trainer in `slot` (0, or 1 in multi). */
  opponentObject(slot: number): number {
    const trainer = this.trainers[this.battle + slot * FACTORY.battlesPerRound]!;
    const cls = this.tables.trainers[trainer]!.class;
    return this.tables.tower.classObjects.find((c) => c.class === cls)?.gfx ?? this.tables.tower.defaultObject;
  }

  /** Decomp BF_FUNC_LOAD_TRAINERS: the battle's trainer in `slot`. */
  trainerAt(slot: number): number {
    return this.trainers[this.battle + slot * FACTORY.battlesPerRound]!;
  }

  /** The next opponent's Pokémon as the info messages read them (decomp opponentMons). */
  opponentSet(i: number): FrontierSetData {
    const m = this.opponentMons[i];
    if (!m) throw new Error(`battle factory: no opponent Pokémon ${i}`);
    return this.tables.sets[m.set]!;
  }

  /** Decomp BF_FUNC_GET_COMMON_TYPE: the type most of the opponent's Pokémon share (a type's sourceIndex), or 0xFF. */
  commonType(): number {
    const dex = dexOf(this.registries);
    const counts = new Map<number, number>();
    for (const m of this.opponentMons.slice(0, FACTORY.partySize)) {
      const set = this.tables.sets[m.set]!;
      const types = [...new Set(dex.form(set.species, set.form).types)];
      for (const type of types) {
        const n = this.registries.types.get(type)?.sourceIndex;
        if (n === undefined) throw new Error(`battle factory: type ${type} has no number`);
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    let best = 0;
    for (const [type, n] of [...counts].sort((a, b) => a[0] - b[0])) if (n > (counts.get(best) ?? 0)) best = type;
    return (counts.get(best) ?? 0) <= 1 ? 0xff : best;
  }

  /** Decomp BattleFactory_GetEarnedBP. */
  earnedBp(): number {
    const bp = this.t.battlePoints[Math.min(this.round, FACTORY.maxRounds)]!;
    if (this.challengeType === SINGLE && (this.streak === FACTORY.silver || this.streak === FACTORY.gold)) return BRAIN_BP;
    return bp;
  }

  /** Decomp BattleFactory_GetAIMask: Thorton and rounds 5 on expert, rounds 3–4 basic, rounds 1–2 none. */
  aiMask(): number {
    const trainer = this.trainers[this.battle]!;
    const all = AI_FLAGS.basic | AI_FLAGS.evalAttack | AI_FLAGS.expert;
    if (this.challengeType === SINGLE && this.t.thorton.includes(trainer)) return all;
    const round = this.round + 1;
    if (round <= 2) return 0;
    if (round <= 4) return AI_FLAGS.basic;
    return all;
  }

  /** Decomp BattleFactory_SetupBattle: healed copies of both parties, the battle's trainer, its AI. */
  battleSetup(): FrontierBattle {
    const dex = dexOf(this.registries);
    const copy = (m: Pokemon) => {
      const c = structuredClone(m);
      heal(dex, c);
      return c;
    };
    const id = this.trainers[this.battle]!;
    const data = this.tables.trainers[id]!;
    const name = this.registries.texts.get(data.name)?.text;
    if (name === undefined) throw new Error(`battle factory: no name for frontier trainer ${id}`);
    const trainer: FrontierBattleTrainer = { id, name, class: data.class, className: data.className, party: this.opponents.map(copy) };
    return { facility: 'factory', party: this.players.map(copy), trainers: [trainer], ai: this.aiMask() };
  }

  /** Decomp BattleFactory_SaveOnCompletingRound. */
  saveOnRoundComplete(): void {
    this.saveStreak = true;
    if (this.round < FACTORY.maxRounds) this.round++;
    this.battle = 0;
    this.save(0);
  }

  /** Decomp BattleFactory_SaveOnLoss. */
  saveOnLoss(): void {
    this.save(1);
  }

  /** Decomp BattleFactory_Save: 2 is REST's (no record, no streak flag). */
  save(kind: 0 | 1 | 2): void {
    const f = factoryState(this.state);
    const i = factoryIndex(this.openLevel, this.challengeType);
    const s = f.streaks[i]!;
    f.save.openLevel = this.openLevel;
    f.save.challengeType = this.challengeType;
    f.save.saved = true;
    f.save.battle = this.battle;
    s.latestTrades = this.tradeCount;
    s.latest = this.streak;
    if (kind !== 2) {
      const before = s.record;
      s.record = setIfBetter(s.record, this.streak);
      if (this.streak === before) s.recordTrades = setIfBetter(s.recordTrades, this.tradeCount);
      else if (before < s.record) s.recordTrades = this.tradeCount;
      f.active[i] = this.saveStreak;
    }
    f.save.trainers = [...this.trainers];
    const row = (m: Pokemon, set: number) => ({ set, pid: m.pid, ivs: m.ivs.attack });
    this.players.forEach((m, k) => (f.save.player[k] = row(m, this.playerSets[k]!)));
    this.opponents.forEach((m, k) => (f.save.opponent[k] = row(m, this.opponentMons[k]!.set)));
  }
}
