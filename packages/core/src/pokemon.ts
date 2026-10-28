/**
 * The Pokémon instance model (Gen 4 rules, game-agnostic): creation, stats, level and exp, moves, EVs and
 * evolution checks. Each rule follows the Platinum decomp (src/pokemon.c, src/trainer_data.c,
 * src/battle/battle_script.c); the data (species, moves, growth tables, natures, items) comes from packs.
 * Contracts' record types extend the data shapes here (`SpeciesData`, `NatureData`, …); `Dex` reads them
 * from the registries. Everything is deterministic: random rolls take the caller's `Prng`.
 */
import type { Id } from './ids.ts';
/** A u32 random source (core `Prng`, or the game's main stream). */
export interface Rng {
  next(): number;
  below(n: number): number;
}

export const STATS = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
export type StatName = (typeof STATS)[number];
export type Stats = Record<StatName, number>;
export type Gender = 'male' | 'female' | 'none';
export type StatusCondition = 'none' | 'sleep' | 'poison' | 'toxic' | 'burn' | 'freeze' | 'paralysis';

export const MAX_LEVEL = 100;
export const MAX_MOVES = 4;
export const PARTY_SIZE = 6;
/** Decomp MAX_EVS_SINGLE_STAT, MAX_EVS_ALL_STATS. */
export const MAX_EV = 255;
export const MAX_EV_TOTAL = 510;
export const MAX_IV = 31;
export const MAX_FRIENDSHIP = 255;
/** Decomp EVOLVE_FRIENDSHIP_THRESHOLD. */
export const EVOLVE_FRIENDSHIP = 220;
/** Decomp genderRatio values with a fixed gender (GENDER_RATIO_MALE_ONLY / FEMALE_ONLY / NO_GENDER). */
export const GENDER_RATIO = { maleOnly: 0, femaleOnly: 254, genderless: 255 } as const;

export interface LearnsetEntry {
  level: number;
  move: Id;
}

/**
 * One evolution (decomp SpeciesEvolution). `method` is the decomp `EVO_*` name without the prefix
 * (`LEVEL`, `USE_ITEM`, `TRADE_WITH_HELD_ITEM`, …); the parameter sits in the field its kind needs.
 */
export interface Evolution {
  method: string;
  target: Id;
  level?: number;
  item?: Id;
  move?: Id;
  species?: Id;
  beauty?: number;
}

/** A species' (or data form's) personal data and learnsets (decomp SpeciesData + wotbl + TM masks). */
export interface SpeciesStats {
  baseStats: Stats;
  types: [Id, Id];
  catchRate: number;
  baseExp: number;
  evYield: Stats;
  /** Wild held items (decomp wildHeldItems): common 50%, rare 5%; the same item twice = always held. */
  heldItems: { common: Id | null; rare: Id | null };
  /** 0 = male only, 254 = female only, 255 = genderless, else female when (pid & 0xff) < ratio. */
  genderRatio: number;
  hatchCycles: number;
  baseFriendship: number;
  growthRate: Id;
  eggGroups: [Id, Id];
  /** Ability 1 and 2; with two, PID bit 0 picks. */
  abilities: [Id | null, Id | null];
  safariFleeRate: number;
  /** Level-up moves in learn order. */
  learnset: LearnsetEntry[];
  /** TM/HM items this species can learn from. */
  tms: Id[];
  /** Moves the shard tutors teach it (decomp sSpeciesLearnsetsByTutor), in tutor table order; absent = none. */
  tutorMoves?: Id[];
}

/** A form with its own personal data (Platinum: Deoxys, Wormadam, Giratina, Shaymin, Rotom). */
export interface SpeciesForm extends SpeciesStats {
  form: number;
  name: string;
}

export interface SpeciesData extends SpeciesStats {
  evolutions: Evolution[];
  eggMoves: Id[];
  /** The species an egg of this one hatches as (decomp pms.narc, Pokemon_GetBaseSpeciesFromPersonalData; itself for unevolved species). */
  eggSpecies: Id;
  forms?: SpeciesForm[];
}

export interface MoveData {
  pp: number;
}

export interface GrowthRateData {
  /** Total exp for levels 0..100. */
  exp: number[];
}

/** A nature (pid % count, in `sourceIndex` order): the stat it raises and the one it lowers (10%). */
export interface NatureData {
  sourceIndex?: number;
  up: StatName | null;
  down: StatName | null;
}

/** Hold effects are the decomp `HOLD_EFFECT_*` names without the prefix (`NONE`, `NO_EVOLVE`, …). */
export interface HeldItemData {
  holdEffect: string;
  holdParam: number;
  /** A TM/HM's move (egg moves read it: decomp Item_MoveForTMHM). */
  tm?: Id;
}

/** The registries the model reads (contracts `Registries` satisfies this). */
export interface MonRegistries {
  species: ReadonlyMap<Id, SpeciesData>;
  moves: ReadonlyMap<Id, MoveData>;
  growthRates: ReadonlyMap<Id, GrowthRateData>;
  natures: ReadonlyMap<Id, NatureData>;
  items: ReadonlyMap<Id, HeldItemData>;
  /** The base pack's new game (its `language`); absent in Pokémon-only registries. */
  newGame?: ReadonlyMap<Id, { language?: number }>;
}

/** Decomp LANGUAGE_ENGLISH: a pack's language when its new game names none. */
export const ENGLISH = 2;
/** Decomp LANGUAGE_GERMAN. */
export const GERMAN = 5;

/** The game language's entry of a per-language table; throws for a language the table lacks. */
export function forLanguage<T>(language: number, table: Readonly<Record<number, T>>): T {
  const value = table[language];
  if (value === undefined) throw new Error(`no wording for game language ${language}`);
  return value;
}

/** How and where a Pokémon was met (decomp met location/level/date; level 0 = hatched). */
export interface MetData {
  zone: Id | null;
  level: number;
  /** `yyyy-mm-dd`, or null when unknown (trainer Pokémon, migrated saves). */
  date: string | null;
  /** A hatched Pokémon's egg: where and when it was received (decomp egg location and date; a zone stands in for the location). */
  egg?: { zone: Id | null; date: string | null };
}

/**
 * A Pokémon (decomp Pokemon: BoxPokemon + party data). Nature, gender and shininess derive from `pid`
 * (`natureOf`, `genderOf`, `isShiny`). `stats.hp` is the max HP; `hp` the current. `moves`, `pp` and
 * `ppUps` are parallel (at most 4). Box Pokémon keep the same shape (the DS recomputes party data on
 * withdrawal; here it is just kept).
 */
export interface Pokemon {
  species: Id;
  form: number;
  /** null = the species name. */
  nickname: string | null;
  /** An egg: `friendship` holds its egg cycles left (decomp), `egg.ts` hatches it. */
  isEgg: boolean;
  pid: number;
  /** Trainer id (low 16 bits) and secret id (high 16 bits). */
  otId: number;
  otName: string;
  otGender: 'male' | 'female';
  /** Gen 4 language id; absent in older saves means English (2): those saves predate the German game. */
  language?: number;
  level: number;
  exp: number;
  ivs: Stats;
  evs: Stats;
  ability: Id | null;
  moves: Id[];
  pp: number[];
  ppUps: number[];
  heldItem: Id | null;
  stats: Stats;
  hp: number;
  status: StatusCondition;
  friendship: number;
  /** Decomp pokerus byte: strain in the high nibble, days left in the low nibble; 0 = never infected. */
  pokerus: number;
  ball: Id;
  met: MetData;
  /** The PC box markings (decomp MON_DATA_MARKINGS): bit i = circle, triangle, square, heart, star, diamond. */
  markings: number;
  /** The ribbons it holds (decomp enum Ribbon ids, ascending; the summary's RIBBONS page). */
  ribbons: number[];
  /**
   * The fateful-encounter bit (decomp MON_DATA_FATEFUL_ENCOUNTER; schema v17): set on a Pokémon met through
   * `start_fateful_encounter` or a distribution. Absent = not fateful.
   */
  fatefulEncounter?: true;
  /**
   * The contest condition (decomp MON_DATA_COOL … MON_DATA_SHEEN, 0–MAX_CONDITION; schema v19): raised by Poffins
   * (services `feedPoffin`); Feebas evolves by its beauty (EVO_LEVEL_BEAUTY).
   */
  condition: Condition;
  /**
   * The Ball Capsule on a party Pokémon (decomp MON_DATA_BALL_CAPSULE_ID and MON_DATA_BALL_CAPSULE): `id` the capsule
   * index + 1 (1–12) and a copy of its seals, which the send-out effect reads. Absent = none (a boxed Pokémon has none).
   */
  capsule?: { id: number; seals: BallSeal[] };
}

/**
 * A seal placed on a Ball Capsule (decomp BallSeal): `seal` the seal id (1–80), `x`, `y` its centre on the editor's
 * touch screen (the capsule circle is centred at (190, 70), radius 60).
 */
export interface BallSeal {
  seal: number;
  x: number;
  y: number;
}

/** Decomp MON_DATA_COOL, BEAUTY, CUTE, SMART, TOUGH and SHEEN, in that order. */
export const CONDITIONS = ['cool', 'beauty', 'cute', 'smart', 'tough', 'sheen'] as const;
export type ConditionName = (typeof CONDITIONS)[number];
export type Condition = Record<ConditionName, number>;
/** Decomp MAX_CONTEST_STAT and MAX_POKEMON_SHEEN. */
export const MAX_CONDITION = 255;
export const zeroCondition = (): Condition => ({ cool: 0, beauty: 0, cute: 0, smart: 0, tough: 0, sheen: 0 });

/** Read access to the Pokémon data of a set of registries. */
export class Dex {
  private natureList: NatureData[] | undefined;

  constructor(readonly data: MonRegistries) {}

  /** The game's language (NewGame `language`): the Pokémon the game creates are from it. */
  get language(): number {
    const record = this.data.newGame?.values().next().value;
    return record?.language ?? ENGLISH;
  }

  species(id: Id): SpeciesData {
    const s = this.data.species.get(id);
    if (!s) throw new Error(`unknown species ${id}`);
    return s;
  }

  /** The personal data of a species' form (the base species for forms without their own data). */
  form(id: Id, form: number): SpeciesStats {
    const s = this.species(id);
    if (!form) return s;
    return s.forms?.find((f) => f.form === form) ?? s;
  }

  move(id: Id): MoveData {
    const m = this.data.moves.get(id);
    if (!m) throw new Error(`unknown move ${id}`);
    return m;
  }

  expTable(growthRate: Id): number[] {
    const g = this.data.growthRates.get(growthRate);
    if (!g) throw new Error(`unknown growth rate ${growthRate}`);
    if (g.exp.length !== MAX_LEVEL + 1) throw new Error(`growth rate ${growthRate}: ${g.exp.length} levels, expected ${MAX_LEVEL + 1}`);
    return g.exp;
  }

  /** Decomp Pokemon_GetNatureOf: pid % (number of natures). */
  nature(pid: number): NatureData {
    this.natureList ??= [...this.data.natures.values()].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    const n = this.natureList[(pid >>> 0) % this.natureList.length];
    if (!n) throw new Error('no natures');
    return n;
  }

  holdEffect(item: Id | null): HeldItemData {
    if (!item) return { holdEffect: 'NONE', holdParam: 0 };
    const i = this.data.items.get(item);
    if (!i) throw new Error(`unknown item ${item}`);
    return i;
  }
}

const u32 = (n: number) => n >>> 0;
const zeroStats = (): Stats => ({ hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });
export const uniformStats = (v: number): Stats => ({ hp: v, attack: v, defense: v, speed: v, spAttack: v, spDefense: v });

export function natureIndex(dex: Dex, pid: number): number {
  return (pid >>> 0) % dex.data.natures.size;
}

/** Decomp SpeciesData_GetGenderOf. */
export function genderOf(genderRatio: number, pid: number): Gender {
  if (genderRatio === GENDER_RATIO.maleOnly) return 'male';
  if (genderRatio === GENDER_RATIO.femaleOnly) return 'female';
  if (genderRatio === GENDER_RATIO.genderless) return 'none';
  return genderRatio > (pid & 0xff) ? 'female' : 'male';
}

export function monGender(dex: Dex, mon: Pick<Pokemon, 'species' | 'form' | 'pid'>): Gender {
  return genderOf(dex.form(mon.species, mon.form).genderRatio, mon.pid);
}

/** Decomp Pokemon_IsPersonalityShiny. */
export function isShiny(otId: number, pid: number): boolean {
  return ((otId >>> 16) ^ (otId & 0xffff) ^ (pid >>> 16) ^ (pid & 0xffff)) < 8;
}

/** Decomp sub_02073E18: ability 2 when the species has one and pid bit 0 is set. */
export function abilityFor(stats: SpeciesStats, pid: number): Id | null {
  const [a1, a2] = stats.abilities;
  return a2 && pid & 1 ? a2 : a1;
}

/** Decomp MoveTable_CalcMaxPP. */
export function maxPp(basePp: number, ppUps: number): number {
  return basePp + Math.floor((basePp * 20 * Math.min(ppUps, 3)) / 100);
}

/** Decomp SpeciesData_GetLevelAt: the highest level whose exp is ≤ exp. */
export function levelFromExp(table: readonly number[], exp: number): number {
  let i = 1;
  for (; i < MAX_LEVEL + 1; i++) if (table[i]! > exp) break;
  return i - 1;
}

/** Decomp Pokemon_CalcStats (Shedinja's 1 HP = base HP 1) with Pokemon_GetNatureStatValue. */
export function calcStats(base: Stats, level: number, ivs: Stats, evs: Stats, nature: NatureData): Stats {
  const out = zeroStats();
  for (const s of STATS) {
    const core = Math.floor(((2 * base[s] + ivs[s] + Math.floor(evs[s] / 4)) * level) / 100);
    if (s === 'hp') {
      out.hp = base.hp === 1 ? 1 : core + level + 10;
      continue;
    }
    let v = core + 5;
    if (nature.up === s) v = Math.floor((v * 110) / 100);
    else if (nature.down === s) v = Math.floor((v * 90) / 100);
    out[s] = v & 0xffff;
  }
  return out;
}

/**
 * Decomp Pokemon_CalcLevelAndStats: level from exp, then stats; current HP follows the max-HP change
 * (a fainted Pokémon stays at 0; a fresh one starts full).
 */
export function recalc(dex: Dex, mon: Pokemon): void {
  const data = dex.form(mon.species, mon.form);
  mon.level = levelFromExp(dex.expTable(data.growthRate), mon.exp);
  const oldMax = mon.stats.hp;
  mon.stats = calcStats(data.baseStats, mon.level, mon.ivs, mon.evs, dex.nature(mon.pid));
  if (mon.hp !== 0 || oldMax === 0) {
    if (data.baseStats.hp === 1) mon.hp = 1;
    else if (mon.hp === 0) mon.hp = mon.stats.hp;
    else mon.hp += mon.stats.hp - oldMax;
  }
}

/**
 * Decomp BoxPokemon_AddMove: the first empty slot; 'known' when already known, 'full' when 4 are known.
 * New moves start with full PP and no PP Ups.
 */
export function addMove(dex: Dex, mon: Pokemon, move: Id): 'learned' | 'known' | 'full' {
  if (mon.moves.includes(move)) return 'known';
  if (mon.moves.length >= MAX_MOVES) return 'full';
  mon.moves.push(move);
  mon.pp.push(dex.move(move).pp);
  mon.ppUps.push(0);
  return 'learned';
}

/** Decomp BoxPokemon_ReplaceMove: drops slot 1, shifts the rest up and appends the new move. */
export function pushMove(dex: Dex, mon: Pokemon, move: Id): void {
  mon.moves = [...mon.moves.slice(1), move];
  mon.pp = [...mon.pp.slice(1), dex.move(move).pp];
  mon.ppUps = [...mon.ppUps.slice(1), 0];
}

/** Puts `move` in `slot` with full PP and no PP Ups (decomp Pokemon_ResetMoveSlot; also the "forget and learn" choice). */
export function setMoveSlot(dex: Dex, mon: Pokemon, slot: number, move: Id): void {
  if (slot < 0 || slot >= MAX_MOVES || slot > mon.moves.length) throw new Error(`move slot ${slot} (knows ${mon.moves.length})`);
  mon.moves[slot] = move;
  mon.pp[slot] = dex.move(move).pp;
  mon.ppUps[slot] = 0;
}

/** Decomp BoxPokemon_SetDefaultMoves: every level-up move up to the level, the oldest dropped when full. */
export function setDefaultMoves(dex: Dex, mon: Pokemon): void {
  for (const e of dex.form(mon.species, mon.form).learnset) {
    if (e.level > mon.level) break;
    if (addMove(dex, mon, e.move) === 'full') pushMove(dex, mon, e.move);
  }
}

export interface CreateOptions {
  species: Id;
  form?: number;
  level: number;
  pid: number;
  /** One value for all six (trainer Pokémon), or each. */
  ivs: number | Stats;
  otId: number;
  otName: string;
  otGender: 'male' | 'female';
  language?: number;
  ball: Id;
  met?: MetData;
  heldItem?: Id | null;
  /** Replaces the default (level-up) moves; PP full, no PP Ups (decomp Pokemon_SetMoveSlot). */
  moves?: Id[];
  nickname?: string | null;
  isEgg?: boolean;
}

/**
 * Decomp Pokemon_InitWith: exp = the level's base exp, the species' base friendship, ability from the PID,
 * the default moves (or `moves`), full HP.
 */
export function createPokemon(dex: Dex, o: CreateOptions): Pokemon {
  if (!Number.isInteger(o.level) || o.level < 1 || o.level > MAX_LEVEL) throw new Error(`level ${o.level}`);
  const form = o.form ?? 0;
  const data = dex.form(o.species, form);
  const ivs = typeof o.ivs === 'number' ? uniformStats(o.ivs) : { ...o.ivs };
  const mon: Pokemon = {
    species: o.species,
    form,
    nickname: o.nickname ?? null,
    isEgg: o.isEgg ?? false,
    pid: u32(o.pid),
    otId: u32(o.otId),
    otName: o.otName,
    otGender: o.otGender,
    language: o.language ?? dex.language,
    level: o.level,
    exp: dex.expTable(data.growthRate)[o.level]!,
    ivs,
    evs: zeroStats(),
    ability: abilityFor(data, o.pid),
    moves: [],
    pp: [],
    ppUps: [],
    heldItem: o.heldItem ?? null,
    stats: zeroStats(),
    hp: 0,
    status: 'none',
    friendship: data.baseFriendship,
    pokerus: 0,
    ball: o.ball,
    met: o.met ?? { zone: null, level: o.level, date: null },
    markings: 0,
    ribbons: [],
    condition: zeroCondition(),
  };
  if (o.moves) {
    if (o.moves.length > MAX_MOVES) throw new Error(`${o.moves.length} moves`);
    o.moves.forEach((m, i) => setMoveSlot(dex, mon, i, m));
  } else setDefaultMoves(dex, mon);
  recalc(dex, mon);
  return mon;
}

/** Decomp `LCRNG_Next() | LCRNG_Next() << 16` and the two IV rolls (5 bits × 3 per roll), on our PRNG. */
export function randomPid(rng: Rng): number {
  return rng.next();
}

export function randomIvs(rng: Rng): Stats {
  const a = rng.next() & 0x7fff;
  const b = rng.next() & 0x7fff;
  return { hp: a & 31, attack: (a >> 5) & 31, defense: (a >> 10) & 31, speed: b & 31, spAttack: (b >> 5) & 31, spDefense: (b >> 10) & 31 };
}

export interface Trainer {
  otId: number;
  otName: string;
  otGender: 'male' | 'female';
}

/**
 * A wild or gift Pokémon (decomp Pokemon_InitWith with random PID and IVs; Pokemon_SetCatchData sets the
 * player as OT, the ball and the met data). Wild held items are rolled by the caller (`rollWildHeldItem`).
 */
export function createRandomPokemon(dex: Dex, rng: Rng, o: { species: Id; form?: number; level: number; trainer: Trainer; ball: Id; met: MetData; heldItem?: Id | null; pid?: number }): Pokemon {
  const pid = o.pid ?? randomPid(rng);
  const ivs = randomIvs(rng);
  return createPokemon(dex, { species: o.species, form: o.form ?? 0, level: o.level, pid, ivs, ...o.trainer, ball: o.ball, met: o.met, heldItem: o.heldItem ?? null });
}

/** Decomp Pokemon_GiveHeldItem: 45% none, 50% common, 5% rare (CompoundEyes: 20/60/20). */
export function rollWildHeldItem(stats: SpeciesStats, rng: Rng, compoundEyes = false): Id | null {
  const { common, rare } = stats.heldItems;
  if (common && common === rare) return common;
  const roll = rng.below(100);
  const [none, withCommon] = compoundEyes ? [20, 80] : [45, 95];
  if (roll < none) return null;
  return roll < withCommon ? common : rare;
}

/** A trainer's party member as imported (contracts `TrainerMon`; pid and OT id derived by the importer). */
export interface TrainerMonData {
  species: Id;
  form?: number;
  level: number;
  /** One IV for all six, or each (decomp: when ivScale · 31 / 255 in its u8 is 32 or more, the IVs are rolled). */
  ivs: number | Stats;
  pid: number;
  otId: number;
  moves?: Id[];
  item?: Id;
}

/**
 * Decomp TrainerData_BuildParty: the imported PID, IVs and OT id, the given moves or the default ones, the
 * held item. The DS sets no OT name or gender here (gender 0, male); the trainer's name stands in.
 */
export function createTrainerPokemon(dex: Dex, m: TrainerMonData, trainerName: string, ball: Id): Pokemon {
  return createPokemon(dex, {
    species: m.species,
    form: m.form ?? 0,
    level: m.level,
    pid: m.pid,
    ivs: m.ivs,
    otId: m.otId,
    otName: trainerName,
    otGender: 'male',
    ball,
    heldItem: m.item ?? null,
    ...(m.moves ? { moves: m.moves } : {}),
  });
}

/** Restores HP, status and PP (decomp HealAllPokemonInParty for one member). Eggs are left alone. */
export function heal(dex: Dex, mon: Pokemon): void {
  if (mon.isEgg) return;
  mon.hp = mon.stats.hp;
  mon.status = 'none';
  mon.pp = mon.moves.map((m, i) => maxPp(dex.move(m).pp, mon.ppUps[i] ?? 0));
}

/** One level gained by `addExp`: the moves of that level, learned or waiting for a choice ('full'). */
export interface LevelUp {
  level: number;
  moves: { move: Id; result: 'learned' | 'known' | 'full' }[];
}

/**
 * Adds exp (capped at the level-100 exp), then levels up one level at a time (decomp
 * Pokemon_ShouldLevelUp + Pokemon_LevelUpMove): stats are recalculated per level and the level's moves are
 * added while there is room. A 'full' move is not learned; the caller offers the replacement (battle,
 * daycare). Friendship and evolution are the caller's (they depend on the context).
 */
export function addExp(dex: Dex, mon: Pokemon, amount: number): LevelUp[] {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`exp ${amount}`);
  const data = dex.form(mon.species, mon.form);
  const table = dex.expTable(data.growthRate);
  mon.exp = Math.min(mon.exp + amount, table[MAX_LEVEL]!);
  const out: LevelUp[] = [];
  while (mon.level < MAX_LEVEL && mon.exp >= table[mon.level + 1]!) {
    const oldMax = mon.stats.hp;
    mon.level++;
    mon.stats = calcStats(data.baseStats, mon.level, mon.ivs, mon.evs, dex.nature(mon.pid));
    if (mon.hp) mon.hp = data.baseStats.hp === 1 ? 1 : mon.hp + mon.stats.hp - oldMax;
    out.push({ level: mon.level, moves: data.learnset.filter((e) => e.level === mon.level).map((e) => ({ move: e.move, result: addMove(dex, mon, e.move) })) });
  }
  return out;
}

/** Decomp BtlCmd_CalcExpGain: the fainted foe's exp split among the battlers that fought and the Exp. Share holders. */
export function expShares(baseExp: number, foeLevel: number, participants: number, expShareHolders: number): { gained: number; shared: number } {
  const exp = Math.floor((baseExp * foeLevel) / 7);
  if (!expShareHolders) return { gained: Math.max(1, Math.floor(exp / participants)), shared: 0 };
  return { gained: Math.max(1, Math.floor(Math.floor(exp / 2) / participants)), shared: Math.max(1, Math.floor(Math.floor(exp / 2) / expShareHolders)) };
}

/** Decomp BattleScript get-exp task: Lucky Egg, trainer battle and outsider (other OT; ×1.7 for another language) boosts, in that order. */
export function expGain(base: number, o: { luckyEgg: boolean; trainerBattle: boolean; outsider: false | 'same-language' | 'other-language' }): number {
  let exp = base;
  if (o.luckyEgg) exp = Math.floor((exp * 150) / 100);
  if (o.trainerBattle) exp = Math.floor((exp * 150) / 100);
  if (o.outsider) exp = Math.floor((exp * (o.outsider === 'other-language' ? 170 : 150)) / 100);
  return exp;
}

const EV_ITEMS: Record<string, StatName> = {
  LVLUP_HP_EV_UP: 'hp',
  LVLUP_ATK_EV_UP: 'attack',
  LVLUP_DEF_EV_UP: 'defense',
  LVLUP_SPEED_EV_UP: 'speed',
  LVLUP_SPATK_EV_UP: 'spAttack',
  LVLUP_SPDEF_EV_UP: 'spDefense',
};

/**
 * Decomp BattleScript_CalcEffortValues: the foe's EV yield (+ a power item's parameter on its stat),
 * doubled by Pokérus and by the Macho Brace (EVS_UP_SPEED_DOWN), capped at 255 per stat and 510 in total.
 * Stats are not recalculated (the DS does it at the next level-up or recalc).
 */
export function gainEvs(dex: Dex, mon: Pokemon, foeYield: Stats): void {
  const { holdEffect, holdParam } = dex.holdEffect(mon.heldItem);
  let sum = STATS.reduce((n, s) => n + mon.evs[s], 0);
  for (const s of STATS) {
    if (sum >= MAX_EV_TOTAL) break;
    let add = foeYield[s] + (EV_ITEMS[holdEffect] === s ? holdParam : 0);
    if (mon.pokerus) add *= 2;
    if (holdEffect === 'EVS_UP_SPEED_DOWN') add *= 2;
    add = Math.min(add, MAX_EV_TOTAL - sum, MAX_EV - mon.evs[s]);
    mon.evs[s] += add;
    sum += add;
  }
}

/**
 * What triggers an evolution check (decomp EVO_CLASS_*), and the context the methods read. `level`: after
 * a battle (the members that levelled), a Rare Candy, or the daycare; `isNight` is decomp IsNight (the
 * clock's night or late night), `mapEvolution` the zone's special method (decomp
 * MapHeader_GetMapEvolutionMethod). `tradeSubstitute` is our modern option (docs/decisions.md: trade-only
 * evolutions in single player): a level-up also matches `TRADE`, and `TRADE_WITH_HELD_ITEM` with the item held.
 */
export type EvolutionTrigger =
  | { kind: 'level'; isNight: boolean; partySpecies: readonly Id[]; mapEvolution?: string; tradeSubstitute?: boolean }
  | { kind: 'trade' }
  | { kind: 'item'; item: Id };

/** Decomp: a held Everstone does not stop Kadabra (Pokemon_GetEvolutionTargetSpecies checks SPECIES_KADABRA by name). */
const EVERSTONE_EXEMPT = 'SPECIES_KADABRA';

/**
 * Decomp Pokemon_GetEvolutionTargetSpecies: the first evolution (in the species' table order) whose method
 * matches, or null. A held Everstone (NO_EVOLVE) blocks every trigger but items, except for Kadabra.
 * `LEVEL_BEAUTY` matches at the evolution's beauty or more (any level). `LEVEL_SHEDINJA` never matches:
 * Shedinja is the side effect of Nincada's `LEVEL_NINJASK` (`shedinjaFrom`).
 */
export function evolutionTarget(dex: Dex, mon: Pokemon, trigger: EvolutionTrigger): { target: Id; method: string } | null {
  if (mon.isEgg) return null;
  const local = mon.species.slice(mon.species.indexOf(':') + 1);
  if (trigger.kind !== 'item' && local !== EVERSTONE_EXEMPT && dex.holdEffect(mon.heldItem).holdEffect === 'NO_EVOLVE') return null;
  const gender = monGender(dex, mon);
  const atLevel = (e: Evolution) => e.level !== undefined && e.level <= mon.level;
  for (const e of dex.species(mon.species).evolutions) {
    let ok: boolean;
    if (trigger.kind === 'level') {
      const happy = mon.friendship >= EVOLVE_FRIENDSHIP;
      switch (e.method) {
        case 'LEVEL_HAPPINESS': ok = happy; break;
        case 'LEVEL_HAPPINESS_DAY': ok = happy && !trigger.isNight; break;
        case 'LEVEL_HAPPINESS_NIGHT': ok = happy && trigger.isNight; break;
        case 'LEVEL':
        case 'LEVEL_NINJASK': ok = atLevel(e); break;
        case 'LEVEL_ATK_GT_DEF': ok = atLevel(e) && mon.stats.attack > mon.stats.defense; break;
        case 'LEVEL_ATK_EQ_DEF': ok = atLevel(e) && mon.stats.attack === mon.stats.defense; break;
        case 'LEVEL_ATK_LT_DEF': ok = atLevel(e) && mon.stats.attack < mon.stats.defense; break;
        case 'LEVEL_PID_LOW': ok = atLevel(e) && (mon.pid >>> 16) % 10 < 5; break;
        case 'LEVEL_PID_HIGH': ok = atLevel(e) && (mon.pid >>> 16) % 10 >= 5; break;
        case 'LEVEL_WITH_HELD_ITEM_DAY': ok = !trigger.isNight && e.item === mon.heldItem; break;
        case 'LEVEL_WITH_HELD_ITEM_NIGHT': ok = trigger.isNight && e.item === mon.heldItem; break;
        case 'LEVEL_KNOW_MOVE': ok = e.move !== undefined && mon.moves.includes(e.move); break;
        case 'LEVEL_SPECIES_IN_PARTY': ok = e.species !== undefined && trigger.partySpecies.includes(e.species); break;
        case 'LEVEL_MALE': ok = gender === 'male' && atLevel(e); break;
        case 'LEVEL_FEMALE': ok = gender === 'female' && atLevel(e); break;
        case 'LEVEL_MAGNETIC_FIELD':
        case 'LEVEL_MOSS_ROCK':
        case 'LEVEL_ICE_ROCK': ok = trigger.mapEvolution === e.method; break;
        case 'LEVEL_BEAUTY': ok = e.beauty !== undefined && e.beauty <= mon.condition.beauty; break;
        case 'TRADE': ok = trigger.tradeSubstitute === true; break;
        case 'TRADE_WITH_HELD_ITEM': ok = trigger.tradeSubstitute === true && e.item === mon.heldItem; break;
        default: ok = false; // LEVEL_SHEDINJA, the item methods
      }
    } else if (trigger.kind === 'trade') {
      ok = e.method === 'TRADE' || (e.method === 'TRADE_WITH_HELD_ITEM' && e.item === mon.heldItem);
    } else {
      ok = e.item === trigger.item && (e.method === 'USE_ITEM' || (e.method === 'USE_ITEM_MALE' && gender === 'male') || (e.method === 'USE_ITEM_FEMALE' && gender === 'female'));
    }
    if (ok) return { target: e.target, method: e.method };
  }
  return null;
}

/**
 * Turns `mon` into `target` (decomp EVOLUTION_STATE_SET_POKEMON_VALUES_AND_PRINT_CONGRATULATIONS): the
 * species, the ability recomputed from the PID (Pokemon_CalcAbility), stats recalculated
 * (Pokemon_CalcLevelAndStats). The form is kept, as on the DS (Burmy's cloak becomes Wormadam's, Shellos'
 * sea Gastrodon's). Moves learned on evolution, the held item and the Shedinja copy are the caller's.
 */
export function evolve(dex: Dex, mon: Pokemon, target: Id): void {
  dex.species(target);
  mon.species = target;
  mon.ability = abilityFor(dex.form(target, mon.form), mon.pid);
  recalc(dex, mon);
}

/**
 * The level-up moves of the Pokémon's species at exactly its level, in learnset order (decomp
 * Pokemon_LevelUpMove as the evolution scene and the Rare Candy loop it).
 */
export function movesAtLevel(dex: Dex, mon: Pokemon): Id[] {
  return dex.form(mon.species, mon.form).learnset.filter((e) => e.level === mon.level).map((e) => e.move);
}

/**
 * Decomp Evolution_ProcessEvolutionEffects for EVO_LEVEL_NINJASK: a copy of the evolved Pokémon as
 * `species` (Shedinja) in `ball`, holding nothing, no nickname, no status, its ability and gender from the
 * PID, stats recalculated, no Ball Capsule (evolution.c: a zeroed capsule). Markings, ribbons and mail are not modelled. The caller checks for
 * room and a Poké Ball, takes the ball and adds the copy.
 */
export function shedinjaFrom(dex: Dex, mon: Pokemon, species: Id, ball: Id): Pokemon {
  const copy: Pokemon = structuredClone(mon);
  copy.species = species;
  copy.ball = ball;
  copy.heldItem = null;
  copy.nickname = null;
  copy.status = 'none';
  delete copy.capsule;
  copy.ability = abilityFor(dex.form(species, copy.form), copy.pid);
  recalc(dex, copy);
  return copy;
}

/** Can `mon` learn TM/HM item `tm` (decomp CanPokemonFormLearnTM)? */
export function canLearnTm(dex: Dex, mon: Pokemon, tm: Id): boolean {
  return dex.form(mon.species, mon.form).tms.includes(tm);
}

/** The decomp LCRNG (LCRNG_MULTIPLIER 1103515245, LCRNG_INCREMENT 24691), for importers deriving DS values. */
export class Lcrng {
  constructor(public state: number) {
    this.state = u32(state);
  }

  /** Decomp LCRNG_Next: the high 16 bits of the next state. */
  next(): number {
    this.state = u32(Math.imul(this.state, 1103515245) + 24691);
    return this.state >>> 16;
  }
}

/**
 * Decomp TrainerData_BuildParty: the PID of a trainer's party member (LCRNG seeded with ivScale + level +
 * species + trainer id, advanced once per trainer class id, then shifted and offset by the class gender:
 * 120 female, else 136), the OT id the following rolls give (Pokemon_InitWith, OTID_NOT_SHINY), and the
 * IVs: ivScale · 31 / 255 kept in a u8; below 32 it is every IV, else (ivScale > 263) Pokemon_InitWith
 * rolls random IVs, here the next two rolls of the same seeded stream.
 */
export function trainerMonValues(o: { ivScale: number; level: number; species: number; trainer: number; trainerClass: number; female: boolean }): { pid: number; otId: number; ivs: number | Stats } {
  const rng = new Lcrng(o.ivScale + o.level + o.species + o.trainer);
  let rnd = rng.state;
  for (let i = 0; i < o.trainerClass; i++) rnd = rng.next();
  const pid = u32(u32(rnd << 8) + (o.female ? 120 : 136));
  let otId: number;
  do otId = u32(rng.next() | (rng.next() << 16));
  while (isShiny(otId, pid));
  const ivs = Math.floor((o.ivScale * MAX_IV) / 255) & 0xff;
  if (ivs <= MAX_IV) return { pid, otId, ivs };
  const a = rng.next();
  const b = rng.next();
  return { pid, otId, ivs: { hp: a & 31, attack: (a >> 5) & 31, defense: (a >> 10) & 31, speed: b & 31, spAttack: (b >> 5) & 31, spDefense: (b >> 10) & 31 } };
}
