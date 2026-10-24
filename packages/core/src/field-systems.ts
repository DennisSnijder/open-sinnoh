/**
 * Field systems on native vars/flags (game-agnostic rules; the pack supplies records and tables). Behavioral
 * references: pret/pokeplatinum 1dc13dc, system_vars.c, record_mixed_rng.c, scrcmd_jubilife_lottery.c,
 * overlay005/vs_seeker.c, overlay005/size_contest.c, overlay006/feebas_fishing.c. Independent implementation.
 */
import type { Id } from './ids.ts';
import { Prng, type PrngState } from './prng.ts';
import type { Pokemon } from './pokemon.ts';

/** The native system vars these systems read and write, by `sourceIndex`. */
/** `newsPress`: VAR_NEWS_PRESS_DEADLINE (system_vars.c SystemVars_GetNewsPressDeadline), counted down each day. */
export const FIELD_VARS = { battery: 16435, activeSteps: 16436, size: 16437, newsPress: 16443, lotteryLow: 16444, lotteryHigh: 16445, level: 16449 } as const;
/** FLAG_VS_SEEKER_USED. */
export const SEEKER_USED = 2413;
/** MOVEMENT_TYPE_VS_SEEKER_SPIN. */
export const SEEKER_SPIN = 49;
/** ITEM_USE_FUNC_VS_SEEKER. */
const FIELD_USE_VS_SEEKER = 15;
/** TRAINER_FLAGS_START (defeated trainers) and the rematch tier unlock flags. */
const TRAINER_FLAGS = 1360;
const REMATCH_UNLOCK_FLAGS = 2430;
/** DAILY_FLAGS_START..END (FieldSystem_ClearDailyFlags). */
const DAILY_FLAGS = [2720, 2911] as const;
/** RECORD_STEPS, RECORD_CAUGHT_FISH, RECORD_EGGS_HATCHED and RECORD_FISH_GOT_AWAY (generated/game_records.txt). */
export const RECORD_STEPS = 0;
export const RECORD_CAUGHT_FISH = 10;
export const RECORD_EGGS_HATCHED = 11;
export const RECORD_FISH_GOT_AWAY = 100;
/** LoadFeebasLevelRange. */
export const FEEBAS_LEVELS = { min: 10, max: 20 } as const;
/** The base pack allowed to omit these systems: the original fixture pack has no Platinum vars. */
const FIELD_SYSTEMS_OPTIONAL_IN = 'fixture';

/** The registries these systems read (contracts `Registries` satisfies this). */
export interface FieldSystemRegistries {
  vars: ReadonlyMap<Id, { id: Id; sourceIndex?: number; initial: number }>;
  flags: ReadonlyMap<Id, { id: Id; sourceIndex?: number; initial: boolean }>;
  items: ReadonlyMap<Id, { id: Id; fieldUse: number }>;
  zones: ReadonlyMap<Id, { matrix: Id }>;
  matrices: ReadonlyMap<Id, { sourceIndex?: number }>;
  trainers: ReadonlyMap<Id, { sourceIndex?: number; rematches?: (Id | null)[] }>;
  newGame: ReadonlyMap<Id, { id: Id }>;
}

/** The saved state these systems edit (contracts `GameState` satisfies this). */
export interface FieldSystemState {
  seed: number;
  fieldRng?: PrngState;
  vars: Record<Id, number>;
  flags: Record<Id, boolean>;
  gameTime: { dailyRandom?: number; marshDaily?: number; swarmDaily?: number };
  /** The Battle Tower's saved RNG (contracts `FrontierState.towerRng`). */
  frontier?: { towerRng?: number };
}

/** Field events use their own saved stream, like encounters (docs/decisions.md). */
export const fieldSeed = (seed: number): number => (seed ^ 0x4649454c) >>> 0;
export function nextFieldRandom(s: Pick<FieldSystemState, 'seed' | 'fieldRng'>): number {
  const rng = Prng.from(s.fieldRng ?? { seed: fieldSeed(s.seed) });
  const result = rng.next();
  s.fieldRng = rng.save();
  return result;
}

/** ARNG_Next. */
const arng = (x: number): number => (Math.imul(x, 1812433253) + 1) >>> 0;
/** RecordMixedRNG_SetEntrySeed(PLAYER_OVERRIDE, seed) at a new game (game_start.c): rand = ARNG(seed). */
export const newDailyRandom = (seed: number): number => arng(seed);
/** RecordMixedRNG_GetRand. A save from before the value existed derives it from its game seed, as a new game would. */
export function dailyRandomOf(s: Pick<FieldSystemState, 'seed' | 'gameTime'>): number {
  return s.gameTime.dailyRandom ?? newDailyRandom(new Prng(fieldSeed(s.seed)).next());
}

/** The Great Marsh's own seed stream, so its new-game value takes no draw from the field stream. */
const marshSeed = (seed: number): number => (seed ^ 0x4d415253) >>> 0;
/**
 * SpecialEncounter marshDaily: MTRNG_Next() at a new game (here a draw from the game seed's own stream, so saves from
 * before the value existed get the same), then RecordMixedRNG_GetRand after each day change.
 */
export function marshDailyOf(s: Pick<FieldSystemState, 'seed' | 'gameTime'>): number {
  return s.gameTime.marshDaily ?? new Prng(marshSeed(s.seed)).next() >>> 0;
}

const presence = new WeakMap<FieldSystemRegistries['vars'], boolean>();
/**
 * Whether the pack carries these systems: every system var, FLAG_VS_SEEKER_USED and the Vs. Seeker item. A
 * base pack must carry all of them, except the original fixture pack, which may carry none. Anything else
 * fails loudly.
 */
export function hasFieldSystems(reg: FieldSystemRegistries): boolean {
  let has = presence.get(reg.vars);
  if (has !== undefined) return has;
  const vars = new Set([...reg.vars.values()].map((v) => v.sourceIndex));
  const parts = [
    ...Object.values(FIELD_VARS).map((n) => vars.has(n)),
    [...reg.flags.values()].some((f) => f.sourceIndex === SEEKER_USED),
    [...reg.items.values()].some((i) => i.fieldUse === FIELD_USE_VS_SEEKER),
  ];
  has = parts.every(Boolean);
  if (!has) {
    const base = [...reg.newGame.values()].map((n) => n.id.slice(0, n.id.indexOf(':')));
    if (base.length !== 1 || base[0] !== FIELD_SYSTEMS_OPTIONAL_IN || parts.some(Boolean)) {
      throw new Error(`field systems: base pack ${base.join(', ')} lacks system vars, FLAG_VS_SEEKER_USED or the Vs. Seeker item`);
    }
  }
  presence.set(reg.vars, has);
  return has;
}

function bySource<T extends { id: Id; sourceIndex?: number }>(cache: WeakMap<object, Map<number, Id>>, records: ReadonlyMap<Id, T>, index: number, kind: string): Id {
  let ids = cache.get(records);
  if (!ids) {
    ids = new Map([...records.values()].flatMap((r) => (r.sourceIndex === undefined ? [] : [[r.sourceIndex, r.id] as const])));
    cache.set(records, ids);
  }
  const id = ids.get(index);
  if (!id) throw new Error(`field systems: missing ${kind} ${index}`);
  return id;
}
const varIds = new WeakMap<object, Map<number, Id>>();
const flagIds = new WeakMap<object, Map<number, Id>>();

export const systemVar = (reg: Pick<FieldSystemRegistries, 'vars'>, index: number): Id => bySource(varIds, reg.vars, index, 'var');
export const systemFlag = (reg: Pick<FieldSystemRegistries, 'flags'>, index: number): Id => bySource(flagIds, reg.flags, index, 'flag');

export function readSystemVar(reg: Pick<FieldSystemRegistries, 'vars'>, s: Pick<FieldSystemState, 'vars'>, index: number): number {
  const id = systemVar(reg, index);
  return s.vars[id] ?? reg.vars.get(id)!.initial;
}
export function writeSystemVar(reg: Pick<FieldSystemRegistries, 'vars'>, s: Pick<FieldSystemState, 'vars'>, index: number, value: number): void {
  const id = systemVar(reg, index);
  const v = value & 0xffff;
  if (v === reg.vars.get(id)!.initial) delete s.vars[id];
  else s.vars[id] = v;
}
export function readSystemFlag(reg: Pick<FieldSystemRegistries, 'flags'>, s: Pick<FieldSystemState, 'flags'>, index: number): boolean {
  const id = systemFlag(reg, index);
  return s.flags[id] ?? reg.flags.get(id)!.initial;
}
function clearFlag(reg: Pick<FieldSystemRegistries, 'flags'>, s: Pick<FieldSystemState, 'flags'>, id: Id): void {
  if (reg.flags.get(id)!.initial) s.flags[id] = false;
  else delete s.flags[id];
}

/** CanUseVsSeeker / MapHeader_IsOnMainMatrix: matrix number zero, independent of map names. */
export function onMainMatrix(reg: Pick<FieldSystemRegistries, 'zones' | 'matrices'>, zone: Id): boolean {
  const z = reg.zones.get(zone);
  if (!z) throw new Error(`field systems: unknown zone ${zone}`);
  const matrix = reg.matrices.get(z.matrix);
  if (!matrix) throw new Error(`field systems: unknown matrix ${z.matrix}`);
  return matrix.sourceIndex === 0;
}

/** FieldMapChange_UpdateGameData / UpdateGameDataDistortionWorld reset the active timer, not the battery. */
export function resetSeeker(reg: FieldSystemRegistries, s: FieldSystemState): void {
  clearFlag(reg, s, systemFlag(reg, SEEKER_USED));
  writeSystemVar(reg, s, FIELD_VARS.activeSteps, 0);
}

const seekerItems = new WeakMap<object, Id>();
/** VsSeeker_UpdateStepCount: ownership gates charging; active rematches expire after 100 steps. */
export function seekerStep(reg: FieldSystemRegistries, s: FieldSystemState, count: (item: Id) => number, clear: () => void): void {
  let item = seekerItems.get(reg.items);
  if (!item) {
    item = [...reg.items.values()].find((i) => i.fieldUse === FIELD_USE_VS_SEEKER)?.id;
    if (!item) throw new Error('field systems: no Vs. Seeker item');
    seekerItems.set(reg.items, item);
  }
  if (count(item) > 0) writeSystemVar(reg, s, FIELD_VARS.battery, Math.min(100, readSystemVar(reg, s, FIELD_VARS.battery) + 1));
  if (!readSystemFlag(reg, s, SEEKER_USED)) return;
  const steps = Math.min(100, readSystemVar(reg, s, FIELD_VARS.activeSteps) + 1);
  writeSystemVar(reg, s, FIELD_VARS.activeSteps, steps);
  if (steps === 100) {
    resetSeeker(reg, s);
    clear();
  }
}

/** Whether a trainer (by source index) has been defeated (TRAINER_FLAGS_START + id). */
export const trainerDefeated = (reg: Pick<FieldSystemRegistries, 'flags'>, s: Pick<FieldSystemState, 'flags'>, trainer: number): boolean =>
  readSystemFlag(reg, s, TRAINER_FLAGS + trainer);

/** VsSeeker_GetCurrentLevelForRematchData / AdjustRematchLevel: one lower populated tier, not
 * repeatedly lower until unlocked. An END already removed by import terminates the search. */
export function rematchTrainer(reg: FieldSystemRegistries, s: FieldSystemState, base: Id, movementType: number): number {
  const row = reg.trainers.get(base)?.rematches;
  if (movementType !== SEEKER_SPIN || !row) return 0;
  const source = (id: Id) => {
    const n = reg.trainers.get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`rematch: missing source index for ${id}`);
    return n;
  };
  let tier = row.findIndex((id, i) => i > 0 && id !== null && !trainerDefeated(reg, s, source(id)));
  if (tier < 0) tier = row.length - 1;
  if (tier > 0 && !readSystemFlag(reg, s, REMATCH_UNLOCK_FLAGS + tier)) {
    do tier--;
    while (tier > 0 && row[tier] === null);
  }
  const id = row[tier];
  if (!id) throw new Error(`rematch: ${base} has no trainer at tier ${tier}`);
  return source(id);
}

/** SystemVars setter's native bug: the second write overwrites LOW; HIGH remains unchanged. */
function setLottery(reg: FieldSystemRegistries, s: FieldSystemState, random: number): void {
  writeSystemVar(reg, s, FIELD_VARS.lotteryLow, random >>> 16);
}
export function randomizeLottery(reg: FieldSystemRegistries, s: FieldSystemState, next: () => number): void {
  next(); // loRand is consumed even though overwritten by hiRand.
  setLottery(reg, s, (next() & 0xffff) * 0x10000);
}
export function initDailyLevel(reg: FieldSystemRegistries, s: FieldSystemState, next: () => number): void {
  writeSystemVar(reg, s, FIELD_VARS.level, (next() % 98) + 2);
}

/**
 * The Villa's daily visitor (contracts `VillaTables`): the furniture flags by type, the odds by owned-piece band, the
 * visitor's vars and flags, and whether the player's saved map is neither the Resort Area nor the Villa.
 */
export interface VillaDaily {
  furniture: readonly Id[];
  chances: readonly number[];
  counts: readonly number[];
  visitorVar: Id;
  messageVar: Id;
  insideFlag: Id;
  outsideFlag: Id;
  away: boolean;
}

function setVarId(reg: Pick<FieldSystemRegistries, 'vars'>, s: Pick<FieldSystemState, 'vars'>, id: Id, value: number): void {
  const r = reg.vars.get(id);
  if (!r) throw new Error(`field systems: missing var ${id}`);
  if ((value & 0xffff) === r.initial) delete s.vars[id];
  else s.vars[id] = value & 0xffff;
}

/**
 * SystemVars_UpdateVillaVisitor (CalcVillaVisitorIndex, InitVillaVisitor): away from the Resort Area and the Villa,
 * both visitor flags clear; a roll above the band's chance (25, 75, 90 % by fewer than 8, 12, or more owned pieces)
 * leaves no visitor (0xFF), else one of the band's first 4, 12 or 15; the message number is always rolled (0–4).
 */
export function updateVillaVisitor(reg: FieldSystemRegistries, s: FieldSystemState, v: VillaDaily, next: () => number): void {
  if (!v.away) return;
  clearFlag(reg, s, v.insideFlag);
  clearFlag(reg, s, v.outsideFlag);
  const owned = v.furniture.filter((f) => s.flags[f] ?? reg.flags.get(f)!.initial).length;
  const band = owned >= 12 ? 2 : owned >= 8 ? 1 : 0;
  const visitor = next() % 100 > v.chances[band]! ? 0xff : next() % v.counts[band]!;
  setVarId(reg, s, v.visitorVar, visitor);
  setVarId(reg, s, v.messageVar, next() % 5);
}

/** FieldSystem_HandleDailyEvents: day gaps advance RecordMixedRNG once per day (ARNG); level rolls
 * once per dispatch. The size record is initialized only by its script, never reset at midnight. The News Press
 * deadline counts down by the days passed; the Villa's visitor is chosen after the daily level (`villa`). */
export function dailyEvents(reg: FieldSystemRegistries, s: FieldSystemState, days: number, villa?: VillaDaily): void {
  let random = dailyRandomOf(s);
  // Affine exponentiation preserves u32 overflow and bounds work for long offline gaps.
  let a = 1812433253,
    c = 1,
    n = days;
  while (n > 0) {
    if (n % 2) random = (Math.imul(random, a) + c) >>> 0;
    c = Math.imul(c, a + 1) >>> 0;
    a = Math.imul(a, a) >>> 0;
    n = Math.floor(n / 2);
  }
  s.gameTime.dailyRandom = random;
  // SpecialEncounter_SetMixedRecordDailies: the marsh and swarm dailies take the day's value.
  s.gameTime.marshDaily = random;
  s.gameTime.swarmDaily = random;
  // sub_0206C008: the tower's RNG is the day's random through its reseed LCG; absent, it derives from the day's.
  if (s.frontier) delete s.frontier.towerRng;
  for (const f of reg.flags.values()) {
    if (f.sourceIndex !== undefined && f.sourceIndex >= DAILY_FLAGS[0] && f.sourceIndex <= DAILY_FLAGS[1]) clearFlag(reg, s, f.id);
  }
  writeSystemVar(reg, s, FIELD_VARS.newsPress, Math.max(0, readSystemVar(reg, s, FIELD_VARS.newsPress) - days));
  setLottery(reg, s, (Math.imul(random, 0x41c64e6d) + 12345) >>> 0);
  initDailyLevel(reg, s, () => nextFieldRandom(s));
  if (villa) updateVillaVisitor(reg, s, villa, () => nextFieldRandom(s));
}

/** ScrCmd_CheckForJubilifeLotteryWinner: trailing decimal digits, eggs excluded, party wins ties,
 * earliest slot wins within a collection; a box index is box*30+slot. */
export function lotteryWinner(
  s: { party: readonly (Pokemon | null)[]; boxes: readonly { slots: readonly (Pokemon | null)[] }[] },
  winning: number,
): { index: number; digits: number; box: number } {
  let best = { index: 0, digits: 0, box: 0 };
  const visit = (m: Pokemon | null, index: number, box: number) => {
    if (!m || m.isEgg) return;
    let id = m.otId & 0xffff,
      number = winning,
      digits = 0;
    while (digits < 5 && id % 10 === number % 10) {
      digits++;
      id = Math.floor(id / 10);
      number = Math.floor(number / 10);
    }
    if (digits > best.digits) best = { index, digits, box };
  };
  s.party.forEach((m, i) => visit(m, i, 0));
  s.boxes.forEach((b, i) => b.slots.forEach((m, j) => visit(m, i * 30 + j, 1)));
  return best;
}

/** SizeContest CalcSizeFactor: low nibbles of IVs mixed with the personality's low half. */
export function sizeFactor(m: Pokemon): number {
  const v = m.ivs;
  const high = (((v.attack ^ v.defense) & 15) * (v.hp & 15)) ^ (m.pid & 255);
  const low = (((v.spAttack ^ v.spDefense) & 15) * (v.speed & 15)) ^ ((m.pid >>> 8) & 255);
  return high * 256 + low;
}

/** A height in tenths of an inch (SizeContest). The native interval search skips the penultimate interval;
 * the boundary quirk at the upper tail is preserved. `height` is the species' Pokédex height (decimetres). */
export function sizeInTenths(intervals: readonly { base: number; divisor: number; start: number }[], height: number, factor: number): number {
  let i = 1;
  while (i < intervals.length - 1 && factor >= intervals[i]!.start) i++;
  const piece = intervals[i < intervals.length - 1 ? i - 1 : i]!;
  const multiplier = piece.base + Math.floor((factor - piece.start) / piece.divisor);
  const mm = Math.floor((height * multiplier) / 10);
  return Math.floor((Math.floor((mm * 1000) / 254) + 5) / 10);
}

/**
 * PlayerAvatar_IsFacingFeebasTile after its 50% gate: the daily random's four bytes pick one tile from each
 * quarter of the tile list (excess tiles spread over the first quarters); `facing` is the facing tile as
 * matrixWidth*32*z + x.
 */
export function isFeebasTile(tiles: readonly number[], dailyRandom: number, facing: number): boolean {
  const group = Math.floor(tiles.length / 4);
  if (group === 0 || group >= 256) throw new Error(`feebas: ${tiles.length} tiles do not split into four groups`);
  let excess = tiles.length % 4,
    overflow = 0;
  for (let i = 0; i < 4; i++) {
    const byte = (dailyRandom >>> (24 - i * 8)) & 0xff;
    if (tiles[group * i + (byte % group) + overflow] === facing) return true;
    if (excess !== 0) {
      overflow++;
      excess--;
    }
  }
  return false;
}
