/**
 * The Battle Arcade's rules (decomp overlay 104 battle_arcade.c, battle_arcade_helpers.c, frscrcmd_battle_arcade.c;
 * overlay 108 battle_arcade_app main.c; arm9 battle_arcade_save.c, scrcmd_battle_arcade.c). Headless and
 * deterministic: the frontier VM's Arcade commands drive a `BattleArcade` challenge over copies of the entered
 * Pokémon (their held items taken, levels above 50 brought to 50); before each battle the game board picks one of 32
 * effects (ARCADE_EFFECT_*), which changes the battle's parties, weather or the board. The saved part
 * (`FrontierState.arcade`) is the decomp's BattleArcadeSave, BattleArcadeStreakFlags and the arcade's stats.
 *
 * Draws take the caller's `rand` (decomp LCRNG_Next), in the decomp's order.
 */
import { dexOf, newGameRecord, type ArcadeState, type BattleArcadeTables, type BattleWeather, type FrontierBattle, type FrontierBattleTrainer, type FrontierSetData, type FrontierTables, type GameState, type Registries } from '@opensinnoh/contracts';
import { heal, type Dex, type Id, type Pokemon } from '@opensinnoh/core';
import { frontierPokemon, frontierState, frontierTables, setIfBetter } from './battle-tower.ts';
import { AI_FLAGS, frontierMon, NEXT_BATTLE, type FactoryMon, type Rand16 } from './battle-factory.ts';
import { castlePartySize, frontierTrainerIvs, pickCastleTrainers, setLevel, trainerMons } from './battle-castle.ts';

/** Decomp ARCADE_* (constants/battle_frontier.h): as the Castle's. */
export const ARCADE = { battlesPerRound: 7, silver: 21, gold: 49, partySize: 3, maxRounds: 8, maxLevel: 50, effects: 32, grid: 16 } as const;
/** Decomp ARCADE_EFFECT_* (constants/battle_frontier.h). */
export const ARCADE_EFFECT = {
  lowerFoeHp: 0,
  poisonFoe: 1,
  paralyzeFoe: 2,
  burnFoe: 3,
  sleepFoe: 4,
  freezeFoe: 5,
  foeGetBerry: 6,
  foeGetItem: 7,
  foeLevelUp: 8,
  lowerAllyHp: 9,
  poisonAlly: 10,
  paralyzeAlly: 11,
  burnAlly: 12,
  sleepAlly: 13,
  freezeAlly: 14,
  allyGetBerry: 15,
  allyGetItem: 16,
  allyLevelUp: 17,
  sunny: 18,
  rainy: 19,
  sandy: 20,
  hail: 21,
  foggy: 22,
  trickRoom: 23,
  speedUp: 24,
  slowDown: 25,
  randomizeCursor: 26,
  swapMons: 27,
  get1Bp: 28,
  noBattle: 29,
  noEvent: 30,
  get3Bp: 31,
} as const;
/** No effect yet (decomp activeEffect = NUM_ARCADE_EFFECTS). */
export const ARCADE_NO_EFFECT = ARCADE.effects;
/** Decomp ARCADE_EFFECT_CATEGORY_*. */
export const ARCADE_CATEGORY = { foe: 0, ally: 1, env: 2, bonus: 3 } as const;
/** Decomp GetAvailableEffects: the effects gated by the battle, in sEffectAvailabilityByBattle's order. */
const BY_BATTLE = [ARCADE_EFFECT.swapMons, ARCADE_EFFECT.speedUp, ARCADE_EFFECT.slowDown, ARCADE_EFFECT.randomizeCursor, ARCADE_EFFECT.get1Bp, ARCADE_EFFECT.noBattle, ARCADE_EFFECT.get3Bp];
/** Decomp the field weather of the environment effects (OVERWORLD_WEATHER_*, as the battle reads them). */
const WEATHERS: Partial<Record<number, BattleWeather>> = { 18: 'sun', 19: 'rain', 20: 'sandstorm', 21: 'hail', 22: 'fog', 23: 'trickroom' };
/** Decomp ArcadeEffect_SpeedUp / _SlowDown: speeds 0–7. */
const MAX_SPEED = 7;
/** Decomp BattleArcade_Init: a new challenge's board speed. */
const START_SPEED = 3;
/** Decomp ArcadeEffect_LevelUp: three levels. */
const LEVEL_UP = 3;
/** Decomp sBonus1BP, sBonus3BP (battle_arcade_helpers.c; the compiler folds them into immediates). */
const BONUS_BP = { get1Bp: 1, get3Bp: 3 } as const;
/** Decomp BattleArcade_GetEarnedBP: a Dahlia streak's BP. */
const BRAIN_BP = 20;
const STREAK_MAX = 9999;
/** Decomp FRONTIER_CHALLENGE_SINGLE. */
const SINGLE = 0;

export function newArcadeState(): ArcadeState {
  return {
    active: [false, false, false, false],
    streaks: Array.from({ length: 3 }, () => ({ record: 0, latest: 0 })),
    save: newArcadeSave(),
  };
}

/** Decomp BattleArcadeSave_Init. */
function newArcadeSave(): ArcadeState['save'] {
  return { saved: false, challengeType: 0, battle: 0, speed: 0, randomCursor: false, slots: [0, 0, 0], items: [null, null, null, null], trainers: Array<number>(ARCADE.battlesPerRound * 2).fill(0), sets: Array<number>(ARCADE.battlesPerRound * 2).fill(0) };
}

export function arcadeState(state: GameState): ArcadeState {
  return (frontierState(state).arcade ??= newArcadeState());
}

/** Decomp BattleArcade_ClearActiveStreak: the streak flag and the latest streak. */
export function deleteArcadeStreak(state: GameState, challengeType: number): void {
  const a = arcadeState(state);
  a.active[challengeType] = false;
  const s = a.streaks[challengeType];
  if (!s) throw new Error(`battle arcade: challenge type ${challengeType} has no stats (no link challenges)`);
  s.latest = 0;
}

/** Decomp BattleArcade_GetCategoryFromEffect. */
export function arcadeCategory(effect: number): number {
  if (effect < ARCADE_EFFECT.lowerAllyHp) return ARCADE_CATEGORY.foe;
  if (effect < ARCADE_EFFECT.sunny) return ARCADE_CATEGORY.ally;
  if (effect < ARCADE_EFFECT.swapMons) return ARCADE_CATEGORY.env;
  return ARCADE_CATEGORY.bonus;
}

/**
 * Decomp GetAvailableEffects: the effects of the round (round 7 for later ones), those gated by the battle only on
 * their battles (the streak's battle in the round; past 9999 the seventh).
 */
export function arcadeAvailableEffects(t: BattleArcadeTables, round: number, streak: number): number[] {
  const r = Math.min(round, 6);
  const battle = streak >= STREAK_MAX ? 6 : streak % ARCADE.battlesPerRound;
  const out: number[] = [];
  for (let effect = 0; effect < ARCADE.effects; effect++) {
    if (!((t.effectsByRound[effect]! >> r) & 1)) continue;
    const gated = BY_BATTLE.indexOf(effect as (typeof BY_BATTLE)[number]);
    if (gated >= 0 && !((t.effectsByBattle[gated]! >> battle) & 1)) continue;
    out.push(effect);
  }
  return out;
}

/** Decomp GetEffectCategoryCounts' tier: the first threshold the last battle's performance reaches. */
export function arcadeTier(t: BattleArcadeTables, performance: number): number {
  const i = t.categoryThresholds.findIndex((th) => performance >= th);
  return i < 0 ? t.categoryThresholds.length : i;
}

/** Decomp GetRandomCategory: a category by the tier's weights (in percent). */
export function arcadeRandomCategory(t: BattleArcadeTables, rand: Rand16, tier: number): number {
  const roll = rand() % 100;
  let sum = 0;
  const weights = t.categoryWeights[tier]!;
  for (let c = 0; c < weights.length; c++) {
    sum += weights[c]!;
    if (roll < sum) return c;
  }
  throw new Error(`battle arcade: tier ${tier}'s weights do not reach 100`);
}

/**
 * Decomp AssignEffectsToGrid: for each of the 16 panels a category by the tier, then a random effect of it (scanning
 * on from a random start, to the next category when the category has none left).
 */
export function arcadeBoard(t: BattleArcadeTables, rand: Rand16, available: readonly number[], tier: number): number[] {
  const counts = [0, 0, 0, 0];
  for (const e of available) counts[arcadeCategory(e)]!++;
  const board: number[] = [];
  for (let i = 0; i < ARCADE.grid; i++) {
    let category = arcadeRandomCategory(t, rand, tier);
    const offset = counts.slice(0, category).reduce((a, b) => a + b, 0);
    // Decomp: LCRNG % numEffectsInCategory (an empty category divides by zero on the DS: none of the ROM's tables has one).
    if (counts[category] === 0) throw new Error(`battle arcade: category ${category} has no effects this round`);
    const start = (rand() % counts[category]!) + offset;
    let index = start;
    for (let loops = 0; ; loops++) {
      if (loops >= 50) throw new Error('battle arcade: no effect found for a panel (the decomp asserts)');
      if (arcadeCategory(available[index]!) === category) {
        board.push(available[index]!);
        break;
      }
      index++;
      if (index >= available.length) index = 0;
      if (index === start) category = (category + 1) % counts.length;
    }
  }
  return board;
}

/** Decomp BattleArcade_GetPerformance: the battle's party (status, fainted) and its turns. */
export function arcadePerformance(t: BattleArcadeTables, party: readonly Pokemon[], turns: number): number {
  const fainted = party.filter((m) => m.hp === 0).length;
  const statused = party.filter((m) => m.status !== 'none').length;
  let score = (t.performance.status[statused] ?? 0) + (t.performance.fainted[fainted] ?? 0);
  const row = t.performance.turns.find((r) => turns < r.turns);
  if (row) score += row.score;
  return score;
}

const local = (id: Id | null): string => (id ? id.slice(id.indexOf(':') + 1) : '');

/** Decomp BattleArcade_ApplyEffect's per-effect functions over a party; true when every one was immune. */
function applyStatus(dex: Dex, party: Pokemon[], status: 'poison' | 'paralysis' | 'burn', immune: (types: string[], ability: string) => boolean): boolean {
  let n = 0;
  for (const m of party) {
    const types = dex.form(m.species, m.form).types.map(local);
    if (immune(types, local(m.ability))) n++;
    else m.status = status;
  }
  return n >= party.length;
}

/**
 * Decomp ArcadeEffect_Sleep / _Freeze: from slot `random` % size on, the first Pokémon not immune gets it (sleep for
 * LCRNG % 4 + 2 turns); true when all were immune. Returns the sleep turns by slot too.
 */
function applyOne(dex: Dex, party: Pokemon[], random: number, rand: Rand16, kind: 'sleep' | 'freeze', sleep: number[]): boolean {
  let slot = random % party.length;
  let immune = 0;
  for (let i = 0; i < party.length; i++) {
    const m = party[slot]!;
    const ability = local(m.ability);
    const types = dex.form(m.species, m.form).types.map(local);
    const no = kind === 'sleep' ? ability === 'ABILITY_INSOMNIA' || ability === 'ABILITY_VITAL_SPIRIT' : types.includes('TYPE_ICE') || ability === 'ABILITY_MAGMA_ARMOR';
    if (no) {
      immune++;
      slot = slot + 1 >= party.length ? 0 : slot + 1;
      continue;
    }
    if (kind === 'sleep') {
      m.status = 'sleep';
      sleep[slot] = (rand() % 4) + 2;
    } else m.status = 'freeze';
    break;
  }
  return immune >= party.length;
}

/**
 * One Battle Arcade challenge (decomp BattleArcade): alive from the frontier's InitBattleArcade to FreeBattleArcade.
 * Not saved itself: `save` writes its resumable part to `FrontierState.arcade.save`.
 */
export class BattleArcade {
  readonly challengeType: number;
  /** Decomp currentBattle (0–6), currentStreak, currentRound, saveStreak, seenArcadeStarIntro. */
  battle: number;
  streak: number;
  round: number;
  saveStreak = false;
  seenStarIntro = false;
  won = false;
  /** Decomp rouletteSpeed (0–7), cursorRandomized. */
  speed: number;
  randomCursor: boolean;
  /** Decomp activeEffect (ARCADE_NO_EFFECT before the first board), randomIndex, weather, immuneToEffect, performance. */
  effect: number = ARCADE_NO_EFFECT;
  random = 0;
  weather: BattleWeather | null = null;
  immune = false;
  performance = 0;
  /** The battle's sleep turns by slot (decomp: a sleeping Pokémon's status value), for each side. */
  sleep = { player: [0, 0, 0], enemy: [0, 0, 0] };
  /** Decomp appCursorPos. */
  appCursor = 0;
  /** Decomp partySlots, savedHeldItems. */
  readonly slots: number[];
  readonly heldItems: (Id | null)[];
  /** Decomp playersParty, opponentsParty. */
  players: Pokemon[];
  opponents: Pokemon[] = [];
  /** Decomp trainerIDs (14), opponentMons. */
  trainers: number[] = Array<number>(ARCADE.battlesPerRound * 2).fill(0);
  opponentMons: FactoryMon[] = [];
  /** Decomp monHP … monSpDef: the stats before the board (an ally level-up is undone after the battle). */
  private stats: Pokemon['stats'][] = [];

  private constructor(
    private readonly state: GameState,
    private readonly registries: Registries,
    private readonly rand: Rand16,
    resume: boolean,
    challengeType: number,
    slots: number[],
  ) {
    const a = arcadeState(state);
    if (!resume) {
      this.challengeType = challengeType;
      this.battle = 0;
      this.speed = START_SPEED;
      this.randomCursor = false;
      a.save = newArcadeSave();
      this.streak = a.active[challengeType] ? a.streaks[challengeType]!.latest : 0;
      this.slots = [...slots];
    } else {
      this.challengeType = a.save.challengeType;
      this.battle = a.save.battle;
      this.speed = a.save.speed;
      this.randomCursor = a.save.randomCursor;
      this.streak = a.streaks[this.challengeType]!.latest;
      this.slots = [...a.save.slots];
    }
    castlePartySize(this.challengeType);
    this.round = Math.floor(this.streak / ARCADE.battlesPerRound);
    const field = this.slots.map((s) => {
      const m = state.party[s];
      if (!m) throw new Error(`battle arcade: no party slot ${s}`);
      return m;
    });
    this.heldItems = field.map((m) => m.heldItem);
    const dex = dexOf(registries);
    this.players = field.slice(0, castlePartySize(this.challengeType)).map((m) => {
      const mon = structuredClone(m);
      mon.heldItem = null;
      if (mon.level > ARCADE.maxLevel) setLevel(dex, mon, ARCADE.maxLevel);
      return mon;
    });
  }

  /** Decomp BattleArcade_Init(saveData, resumingFromSave, challengeType, partySlot1–3). */
  static init(state: GameState, registries: Registries, rand: Rand16, resume: boolean, challengeType: number, slots: number[]): BattleArcade {
    return new BattleArcade(state, registries, rand, resume, challengeType, slots);
  }

  private get tables(): FrontierTables {
    return frontierTables(this.registries);
  }

  private get t(): BattleArcadeTables {
    return this.tables.arcade;
  }

  private get dex(): Dex {
    return dexOf(this.registries);
  }

  /** Decomp BattleArcade_LoadTrainersForRound. */
  loadRound(resume: boolean): void {
    if (resume) {
      this.loadFromSave();
      return;
    }
    this.trainers = pickCastleTrainers(this.t.opponentRanges, this.t.dahlia, this.rand, this.challengeType, this.round);
    this.opponentMons = this.drawOpponent();
    // Decomp sRouletteSpeedByRound: the first row whose round is reached sets the board's speed.
    const row = this.t.rouletteSpeeds.find((r) => this.round >= r.round);
    if (row) this.speed = row.speed;
  }

  private drawOpponent(): FactoryMon[] {
    return trainerMons(this.dex, this.registries, this.tables, this.rand, this.trainers[this.battle]!, ARCADE.partySize);
  }

  /** Decomp LoadTrainersAndMonsFromSave (its IV list uninitialised; here the trainer's IVs, as the Castle's). */
  private loadFromSave(): void {
    const s = arcadeState(this.state).save;
    this.players.forEach((m, i) => (m.heldItem = s.items[i]!));
    this.trainers = [...s.trainers];
    const ivs = frontierTrainerIvs(this.trainers[this.battle]!);
    this.opponentMons = s.sets.slice(0, ARCADE.partySize).map((set) => frontierMon(this.dex, this.registries, this.tables.sets, this.rand, set, ivs, null));
    this.setupOpponentsParty();
  }

  /** Decomp BattleArcade_SetupOpponentsParty: at level 50, the player as their trainer, no held items. */
  setupOpponentsParty(): void {
    this.opponents = this.opponentMons.map((m) => {
      const set = this.tables.sets[m.set]!;
      return frontierPokemon(this.dex, this.tables.sets, m.set, { otId: this.state.trainerId, pid: m.pid, ivs: m.ivs, item: set.item, otName: this.state.names.player, ball: newGameRecord(this.registries).pokeBall, level: ARCADE.maxLevel });
    });
    for (const m of this.opponents) m.heldItem = null;
  }

  /** Decomp BattleArcade_SetupNextOpponentsParty. */
  setupNextOpponent(): void {
    this.opponentMons = this.drawOpponent();
    this.setupOpponentsParty();
  }

  opponentSet(i: number): FrontierSetData {
    const m = this.opponentMons[i];
    if (!m) throw new Error(`battle arcade: no opponent Pokémon ${i}`);
    return this.tables.sets[m.set]!;
  }

  /**
   * Decomp SetupBattleArcadeAppArgs: the weather cleared, the cursor's jumps used up, the effect's immunity cleared,
   * the stats before the board kept.
   */
  beforeBoard(): { randomCursor: boolean } {
    this.weather = null;
    const randomCursor = this.randomCursor;
    this.randomCursor = false;
    this.immune = false;
    this.sleep = { player: [0, 0, 0], enemy: [0, 0, 0] };
    this.stats = this.players.map((m) => ({ ...m.stats }));
    return { randomCursor };
  }

  /** Decomp BattleArcade_StoreAppResults and the app's effect and random number. */
  setAppResult(effect: number, cursor: number, random: number): void {
    this.effect = effect;
    this.appCursor = cursor;
    this.random = random;
  }

  /** Decomp BattleArcade_ApplyEffect: the board's effect on the foe's or the player's party, or the challenge. */
  applyEffect(): void {
    const e = this.effect;
    const foe = e < ARCADE_EFFECT.lowerAllyHp;
    const party = foe ? this.opponents : this.players;
    const sleep = foe ? this.sleep.enemy : this.sleep.player;
    const dex = this.dex;
    switch (e) {
      case ARCADE_EFFECT.lowerFoeHp:
      case ARCADE_EFFECT.lowerAllyHp:
        // Decomp ArcadeEffect_LowerHP: hp = maxHP - ((u32)(maxHP * 1.2) - maxHP).
        for (const m of party) m.hp = m.stats.hp - (Math.trunc(m.stats.hp * 1.2) - m.stats.hp);
        return;
      case ARCADE_EFFECT.poisonFoe:
      case ARCADE_EFFECT.poisonAlly:
        this.immune = applyStatus(dex, party, 'poison', (types, ability) => types.includes('TYPE_POISON') || types.includes('TYPE_STEEL') || ability === 'ABILITY_IMMUNITY');
        return;
      case ARCADE_EFFECT.paralyzeFoe:
      case ARCADE_EFFECT.paralyzeAlly:
        this.immune = applyStatus(dex, party, 'paralysis', (types, ability) => types.includes('TYPE_GROUND') || ability === 'ABILITY_LIMBER');
        return;
      case ARCADE_EFFECT.burnFoe:
      case ARCADE_EFFECT.burnAlly:
        this.immune = applyStatus(dex, party, 'burn', (types, ability) => types.includes('TYPE_FIRE') || ability === 'ABILITY_WATER_VEIL');
        return;
      case ARCADE_EFFECT.sleepFoe:
      case ARCADE_EFFECT.sleepAlly:
        this.immune = applyOne(dex, party, this.random, this.rand, 'sleep', sleep);
        return;
      case ARCADE_EFFECT.freezeFoe:
      case ARCADE_EFFECT.freezeAlly:
        this.immune = applyOne(dex, party, this.random, this.rand, 'freeze', sleep);
        return;
      case ARCADE_EFFECT.foeGetBerry:
      case ARCADE_EFFECT.allyGetBerry:
      case ARCADE_EFFECT.foeGetItem:
      case ARCADE_EFFECT.allyGetItem: {
        const berry = e === ARCADE_EFFECT.foeGetBerry || e === ARCADE_EFFECT.allyGetBerry;
        const pool = this.pool(berry ? this.t.berryPools : this.t.itemPools);
        const item = pool[this.random % pool.length]!;
        for (const m of party) m.heldItem = item;
        return;
      }
      case ARCADE_EFFECT.foeLevelUp:
      case ARCADE_EFFECT.allyLevelUp:
        for (const m of party) {
          if (m.level + LEVEL_UP > 100) throw new Error('battle arcade: a level-up past 100 (the decomp asserts)');
          setLevel(dex, m, m.level + LEVEL_UP);
        }
        return;
      case ARCADE_EFFECT.speedUp:
        if (this.speed < MAX_SPEED) this.speed++;
        return;
      case ARCADE_EFFECT.slowDown:
        if (this.speed > 0) this.speed--;
        return;
      case ARCADE_EFFECT.randomizeCursor:
        this.randomCursor = true;
        return;
      default:
        // Decomp ArcadeEffect_Sunny … _TrickRoom set the battle's weather; the bonus effects act in the script.
        this.weather = WEATHERS[e] ?? null;
    }
  }

  /** Decomp sItemPools / sBerryPools by the round's tier (rounds 1–3, 4–6, 7+). */
  private pool(pools: Id[][]): Id[] {
    const round = this.round;
    return pools[round < 3 ? 0 : round < 6 ? 1 : 2]!;
  }

  /** Decomp BattleArcade_GetFreeBPFromEvent (sBonus1BP, sBonus3BP: the same for every round). */
  freeBp(): number {
    return this.effect === ARCADE_EFFECT.get1Bp ? BONUS_BP.get1Bp : BONUS_BP.get3Bp;
  }

  incrementStreak(): void {
    if (this.streak < STREAK_MAX) this.streak++;
  }

  /** Decomp BA_FUNC_GET_NEXT_BATTLE_TYPE: Dahlia's battles in singles. */
  nextBattleType(): number {
    if (this.challengeType !== SINGLE) return NEXT_BATTLE.normal;
    if (this.streak + 1 === ARCADE.silver) return NEXT_BATTLE.silver;
    if (this.streak + 1 === ARCADE.gold) return NEXT_BATTLE.gold;
    return NEXT_BATTLE.normal;
  }

  /** Decomp BattleArcade_GetNextOpponentObjectID. */
  opponentObject(slot: number): number {
    const cls = this.tables.trainers[this.trainerAt(slot)]!.class;
    return this.tables.tower.classObjects.find((c) => c.class === cls)?.gfx ?? this.tables.tower.defaultObject;
  }

  /** Decomp BattleArcade_GetTrainerOffset: the battle's trainer in `slot`. */
  trainerAt(slot: number): number {
    return this.trainers[this.battle + slot * ARCADE.battlesPerRound]!;
  }

  /** Decomp BattleArcade_GetEarnedBP. */
  earnedBp(): number {
    if (this.challengeType === SINGLE && (this.streak === ARCADE.silver || this.streak === ARCADE.gold)) return BRAIN_BP;
    return this.t.battlePoints[Math.min(this.round, ARCADE.maxRounds)]!;
  }

  /** Decomp BattleArcade_GetAIMask: Dahlia expert; rounds 1–2 none, 3–4 basic, later expert. */
  aiMask(): number {
    const all = AI_FLAGS.basic | AI_FLAGS.evalAttack | AI_FLAGS.expert;
    if (this.challengeType === SINGLE && this.t.dahlia.includes(this.trainers[this.battle]!)) return all;
    const round = this.round + 1;
    if (round <= 2) return 0;
    if (round <= 4) return AI_FLAGS.basic;
    return all;
  }

  /**
   * Decomp BattleArcade_SetupBattle: copies of both parties as the board left them (swapped by SWAP_MONS), the board's
   * weather; then both parties healed (an effect's HP and status last for this battle only).
   */
  battleSetup(): FrontierBattle {
    const swap = this.effect === ARCADE_EFFECT.swapMons;
    const mine = (swap ? this.opponents : this.players).map((m) => structuredClone(m));
    const theirs = (swap ? this.players : this.opponents).map((m) => structuredClone(m));
    const id = this.trainers[this.battle]!;
    const data = this.tables.trainers[id]!;
    const name = this.registries.texts.get(data.name)?.text;
    if (name === undefined) throw new Error(`battle arcade: no name for frontier trainer ${id}`);
    const trainer: FrontierBattleTrainer = { id, name, class: data.class, className: data.className, party: theirs };
    const sleep = swap ? { player: [...this.sleep.enemy], enemy: [...this.sleep.player] } : { player: [...this.sleep.player], enemy: [...this.sleep.enemy] };
    for (const m of [...this.players, ...this.opponents]) heal(this.dex, m);
    return { facility: 'arcade', party: mine, trainers: [trainer], ai: this.aiMask(), ...(this.weather ? { weather: this.weather } : {}), ...(sleep.player.some((n) => n) || sleep.enemy.some((n) => n) ? { sleep } : {}) };
  }

  /**
   * Decomp FrontierScrCmd_BattleArcade_CleanupBattle: the performance from the player's side, the held items of the
   * player's own Pokémon kept (from the enemy's side after SWAP_MONS), an ally level-up undone, the stats from before
   * the board put back.
   */
  cleanupBattle(result: { party: Pokemon[]; enemy: Pokemon[]; turns: number; won: boolean }): void {
    this.performance = arcadePerformance(this.t, result.party, result.turns);
    this.won = result.won;
    const own = this.effect === ARCADE_EFFECT.swapMons ? result.enemy : result.party;
    this.players.forEach((m, i) => (m.heldItem = own[i]!.heldItem));
    if (this.effect === ARCADE_EFFECT.allyLevelUp) for (const m of this.players) setLevel(this.dex, m, m.level - LEVEL_UP);
    this.players.forEach((m, i) => {
      const s = this.stats[i];
      if (!s) return;
      m.stats = { ...s };
      m.hp = s.hp;
    });
  }

  /** Decomp BA_FUNC_RESTORE_HELD_ITEMS. */
  restoreHeldItems(): void {
    this.slots.forEach((s, i) => (this.state.party[s]!.heldItem = this.heldItems[i]!));
  }

  /** Decomp BattleArcade_SaveOnLoss. */
  saveOnLoss(): void {
    this.save(1);
  }

  /** Decomp BattleArcade_SaveOnCompletingRound. */
  saveOnRoundComplete(): void {
    this.saveStreak = true;
    if (this.round < ARCADE.maxRounds) this.round++;
    this.battle = 0;
    this.save(0);
  }

  /** Decomp BattleArcade_Save: 2 is REST's (no record, no streak flag). */
  save(kind: 0 | 1 | 2): void {
    const a = arcadeState(this.state);
    const s = a.streaks[this.challengeType]!;
    a.save.challengeType = this.challengeType;
    a.save.saved = true;
    a.save.battle = this.battle;
    a.save.speed = this.speed;
    a.save.randomCursor = this.randomCursor;
    s.latest = this.streak;
    if (kind !== 2) {
      s.record = setIfBetter(s.record, this.streak);
      a.active[this.challengeType] = this.saveStreak;
    }
    a.save.trainers = [...this.trainers];
    a.save.slots = [...this.slots];
    this.players.forEach((m, i) => (a.save.items[i] = m.heldItem));
    this.opponentMons.forEach((m, i) => (a.save.sets[i] = m.set));
  }
}
