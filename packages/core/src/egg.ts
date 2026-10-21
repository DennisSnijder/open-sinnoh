/**
 * The daycare and eggs (Gen 4 rules, decomp src/overlay005/daycare.c, src/egg_hatch.c and
 * src/unk_02092494.c): deposit and withdraw with exp per step, compatibility, the offspring PID roll,
 * the egg (species, IVs, moves), egg cycles and hatching. Species, items, abilities and egg groups are
 * named by their decomp constants (`SPECIES_DITTO`, `ITEM_EVERSTONE`, …) in the pack's namespace, the
 * rule vocabulary as `HOLD_EFFECT_*` is elsewhere. Random rolls take the caller's `Rng` (the DS's LCRNG
 * rolls take the low 16 bits). Not modelled: mail, the Masuda method (parent languages are not stored),
 * egg location ids (the met zone stands in), game records.
 */
import type { Id } from './ids.ts';
import {
  abilityFor,
  addExp,
  addMove,
  createPokemon,
  genderOf,
  levelFromExp,
  MAX_LEVEL,
  natureIndex,
  pushMove,
  randomIvs,
  recalc,
  STATS,
  type Dex,
  type MetData,
  type Pokemon,
  type Rng,
  type StatName,
  type Trainer,
} from './pokemon.ts';

/** Decomp NUM_DAYCARE_MONS. */
export const DAYCARE_SLOTS = 2;
/** One daycare slot (decomp DaycareMon; mail is not modelled): the Pokémon and the steps it walked. */
export interface DaycareMon {
  mon: Pokemon;
  /** u32 steps since the deposit; exp 1 per step on withdrawal. */
  steps: number;
}
/** Decomp Daycare. */
export interface Daycare {
  /** `DAYCARE_SLOTS` slots; slot 0 fills first and the second shifts down when the first leaves. */
  mons: (DaycareMon | null)[];
  /** The waiting egg's PID (decomp offspringPersonality): 0 = no egg waiting. */
  offspring: number;
  /** u8 step counter of the egg cycles (decomp stepCounter). */
  stepCounter: number;
}

export const emptyDaycare = (): Daycare => ({ mons: [null, null], offspring: 0, stepCounter: 0 });

/** Decomp PARENTS_*_COMPATIBILITY: the egg chance (%) every 256 steps. */
export const COMPATIBILITY = { incompatible: 0, low: 20, medium: 50, max: 70 } as const;
/** Decomp DAYCARE_* (Daycare_GetState). */
export const DAYCARE_STATE = { none: 0, eggWaiting: 1, oneMon: 2, twoMons: 3 } as const;
/** Decomp Egg_CreateHatchedMonInternal: a hatched Pokémon's friendship. */
export const HATCHED_FRIENDSHIP = 120;
/** Decomp EGG_GENDER_MALE: the offspring PID bit that makes Nidoran♀ and Illumise eggs male. */
const EGG_GENDER_MALE = 0x8000;
/** Decomp MAX_EGG_MOVES. */
const MAX_EGG_MOVES = 16;
/** Decomp NUM_INHERITED_IVS. */
const INHERITED_IVS = 3;
/** Decomp Daycare_GetEggCycleLength: steps per egg cycle, fewer on the special dates (month * 100 + day, as the table holds them). */
const EGG_CYCLE = 255;
const EGG_CYCLE_SPECIAL = 230;
const EGG_CYCLE_DATES = [112, 214, 303, 401, 501, 611, 707, 821, 907, 928, 1121, 1214];
/** Decomp sIncenseBabyTable: the baby, the incense a parent must hold, the species hatched without it. */
const INCENSE_BABIES: [string, string, string][] = [
  ['WYNAUT', 'LAX_INCENSE', 'WOBBUFFET'],
  ['AZURILL', 'SEA_INCENSE', 'MARILL'],
  ['MIME_JR', 'ODD_INCENSE', 'MR_MIME'],
  ['BONSLY', 'ROCK_INCENSE', 'SUDOWOODO'],
  ['MUNCHLAX', 'FULL_INCENSE', 'SNORLAX'],
  ['MANTYKE', 'WAVE_INCENSE', 'MANTINE'],
  ['BUDEW', 'ROSE_INCENSE', 'ROSELIA'],
  ['HAPPINY', 'LUCK_INCENSE', 'CHANSEY'],
  ['CHINGLING', 'PURE_INCENSE', 'CHIMECHO'],
];

/** An id's decomp name (`platinum:SPECIES_DITTO` → `SPECIES_DITTO`). */
const local = (id: Id | null): string => (id ? id.slice(id.indexOf(':') + 1) : '');
/** The id of a decomp name in the namespace of `like`. */
const sibling = (like: Id, name: string): Id => `${like.slice(0, like.indexOf(':'))}:${name}` as Id;
const u16 = (rng: Rng) => rng.next() & 0xffff;

function slots(d: Daycare): [DaycareMon, DaycareMon] {
  const [a, b] = d.mons;
  if (!a || !b) throw new Error('daycare: two Pokémon are needed');
  return [a, b];
}

/** Decomp Daycare_CountMons. */
export const daycareCount = (d: Daycare): number => d.mons.filter((m) => m).length;

/** Decomp Daycare_GetState. */
export function daycareState(d: Daycare): number {
  if (d.offspring) return DAYCARE_STATE.eggWaiting;
  const n = daycareCount(d);
  return n ? n + 1 : DAYCARE_STATE.none;
}

/** Decomp BoxMon_GetPairDaycareCompatibilityScore (base species data, as the decomp reads it). */
export function compatibility(dex: Dex, a: Pokemon, b: Pokemon): number {
  const [sa, sb] = [dex.species(a.species), dex.species(b.species)];
  const [ga, gb] = [local(sa.eggGroups[0]), local(sb.eggGroups[0])];
  if (ga === 'EGG_GROUP_UNDISCOVERED' || gb === 'EGG_GROUP_UNDISCOVERED') return COMPATIBILITY.incompatible;
  if (ga === 'EGG_GROUP_DITTO' && gb === 'EGG_GROUP_DITTO') return COMPATIBILITY.incompatible;
  const sameOt = a.otId >>> 0 === b.otId >>> 0;
  if (ga === 'EGG_GROUP_DITTO' || gb === 'EGG_GROUP_DITTO') return sameOt ? COMPATIBILITY.low : COMPATIBILITY.medium;
  const [xa, xb] = [genderOf(sa.genderRatio, a.pid), genderOf(sb.genderRatio, b.pid)];
  if (xa === xb || xa === 'none' || xb === 'none') return COMPATIBILITY.incompatible;
  if (!sa.eggGroups.some((g) => sb.eggGroups.includes(g))) return COMPATIBILITY.incompatible;
  if (a.species === b.species) return sameOt ? COMPATIBILITY.medium : COMPATIBILITY.max;
  return sameOt ? COMPATIBILITY.low : COMPATIBILITY.medium;
}

/** Decomp Daycare_GetCompatibilityLevel: 0 (very well) … 3 (play with others), the old man's line. */
export function compatibilityLevel(dex: Dex, d: Daycare): number {
  const [a, b] = slots(d);
  return { [COMPATIBILITY.incompatible]: 3, [COMPATIBILITY.low]: 2, [COMPATIBILITY.medium]: 1, [COMPATIBILITY.max]: 0 }[compatibility(dex, a.mon, b.mon)]!;
}

/** Decomp Daycare_MoveToEmptySlotFromParty: into the first free slot, steps 0; Shaymin goes back to its Land Forme. */
export function depositMon(dex: Dex, d: Daycare, mon: Pokemon): void {
  const slot = d.mons.findIndex((m) => !m);
  if (slot < 0) throw new Error('daycare: no free slot');
  if (local(mon.species) === 'SPECIES_SHAYMIN' && mon.form) {
    mon.form = 0;
    mon.ability = abilityFor(dex.form(mon.species, 0), mon.pid);
    recalc(dex, mon);
  }
  d.mons[slot] = { mon, steps: 0 };
}

function daycareMon(d: Daycare, slot: number): DaycareMon {
  const m = d.mons[slot];
  if (!m) throw new Error(`daycare: slot ${slot} is empty`);
  return m;
}

/** Decomp BoxPokemon_GiveExperience: the level after the steps' exp (nothing changes). */
export function daycareLevel(dex: Dex, d: Daycare, slot: number): number {
  const { mon, steps } = daycareMon(d, slot);
  return levelFromExp(dex.expTable(dex.form(mon.species, mon.form).growthRate), mon.exp + steps);
}

/** Decomp Daycare_GiveDaycareMonExperience: the levels gained so far. */
export const daycareLevelsGained = (dex: Dex, d: Daycare, slot: number): number => daycareLevel(dex, d, slot) - daycareMon(d, slot).mon.level;

/** Decomp DaycareMon_BufferDaycarePrice: 100 + 100 per level gained. */
export const daycareFee = (dex: Dex, d: Daycare, slot: number): number => 100 + 100 * daycareLevelsGained(dex, d, slot);

/**
 * Decomp Daycare_MoveToPartyFromDaycareSlot: the steps become exp (below level 100) and the Pokémon levels
 * up one level at a time, each level's moves learned and, with four known, pushing out the first
 * (ov5_021E63E0: Pokemon_LevelUpMove, then Pokemon_ReplaceMove). Back in the party it is at full HP with
 * no status (Pokemon_FromBoxPokemon). The second slot shifts down.
 */
export function withdrawMon(dex: Dex, d: Daycare, slot: number): Pokemon {
  const { mon, steps } = daycareMon(d, slot);
  if (mon.level !== MAX_LEVEL) {
    const table = dex.expTable(dex.form(mon.species, mon.form).growthRate);
    const target = Math.min(mon.exp + steps, table[MAX_LEVEL]!);
    while (mon.level < MAX_LEVEL && target >= table[mon.level + 1]!) {
      for (const up of addExp(dex, mon, table[mon.level + 1]! - mon.exp)) for (const m of up.moves) if (m.result === 'full') pushMove(dex, mon, m.move);
    }
    addExp(dex, mon, target - mon.exp);
  }
  recalc(dex, mon);
  mon.hp = mon.stats.hp;
  mon.status = 'none';
  d.mons[slot] = null;
  if (!d.mons[0] && d.mons[1]) [d.mons[0], d.mons[1]] = [d.mons[1], null];
  return mon;
}

/** Decomp Daycare_SetInheritedNature: the offspring PID; with a passed nature, rerolled (up to 2400 times) until it matches. */
export function rollOffspring(dex: Dex, d: Daycare, rng: Rng): void {
  const parent = everstoneParent(dex, d, rng);
  if (parent === null) {
    d.offspring = rng.next() >>> 0;
    return;
  }
  const nature = natureIndex(dex, parent.pid);
  let pid: number;
  for (let tries = 0; ; ) {
    pid = rng.next() >>> 0;
    if (natureIndex(dex, pid) === nature && pid !== 0) break;
    if (++tries > 2400) break;
  }
  d.offspring = pid;
}

/**
 * Decomp Daycare_GetParentToInheritNature: the female (then Ditto, the last match winning; two Dittos: a
 * coin flip) passes her nature when she holds an Everstone, half the time; null = no parent passes it.
 */
function everstoneParent(dex: Dex, d: Daycare, rng: Rng): Pokemon | null {
  const mons = slots(d).map((m) => m.mon);
  let slot = -1;
  mons.forEach((m, i) => {
    if (genderOf(dex.species(m.species).genderRatio, m.pid) === 'female') slot = i;
  });
  let dittos = 0;
  mons.forEach((m, i) => {
    if (local(m.species) === 'SPECIES_DITTO') {
      dittos++;
      slot = i;
    }
  });
  if (dittos === DAYCARE_SLOTS) slot = u16(rng) >= 0xffff >> 1 ? 0 : 1;
  const parent = mons[slot];
  if (!parent) throw new Error('daycare: no mother or Ditto to pass a nature');
  if (local(parent.heldItem) !== 'ITEM_EVERSTONE') return null;
  return u16(rng) >= 0xffff >> 1 ? null : parent;
}

/** Decomp Daycare_GetEggCycleLength: 230 steps on the special dates (`yyyy-mm-dd`), 255 otherwise or under the clock penalty. */
export function eggCycleLength(date: string, penalty: boolean): number {
  if (penalty) return EGG_CYCLE;
  const [, m, day] = date.split('-').map(Number) as [number, number, number];
  return EGG_CYCLE_DATES.includes(m * 100 + day) ? EGG_CYCLE_SPECIAL : EGG_CYCLE;
}

/**
 * Decomp Daycare_Update, once per step: each Pokémon's steps + 1; with two and no egg waiting, every 256th
 * step of the second rolls for an egg (compatibility > rand × 100 / 0xFFFF); the step counter runs to the
 * cycle length, then every party egg's cycles (its friendship) go down by 1, or 2 with a Flame Body or
 * Magma Armor Pokémon in the party. True when an egg with no cycles left was met: it hatches (the field
 * runs CommonScript_HatchEgg). As on the DS, an egg hatches on the cycle after it reached 0.
 */
export function daycareStep(dex: Dex, d: Daycare, party: Pokemon[], rng: Rng, cycleLength: number): boolean {
  for (const m of d.mons) if (m) m.steps = (m.steps + 1) >>> 0;
  if (!d.offspring && daycareCount(d) === DAYCARE_SLOTS && (d.mons[1]!.steps & 0xff) === 0xff) {
    const score = compatibility(dex, d.mons[0]!.mon, d.mons[1]!.mon);
    const rand = Math.floor((u16(rng) * 100) / 0xffff);
    if (score > rand) rollOffspring(dex, d, rng);
  }
  d.stepCounter = (d.stepCounter + 1) & 0xff;
  if (d.stepCounter !== cycleLength) return false;
  d.stepCounter = 0;
  const warm = party.some((m) => !m.isEgg && (local(m.ability) === 'ABILITY_MAGMA_ARMOR' || local(m.ability) === 'ABILITY_FLAME_BODY'));
  const by = warm ? 2 : 1;
  for (const m of party) {
    if (!m.isEgg) continue;
    if (m.friendship === 0) return true;
    m.friendship = m.friendship >= by ? m.friendship - by : m.friendship - 1;
  }
  return false;
}

/** Decomp Party_GetFirstEgg: the first party egg with no cycles left, or -1. */
export const firstHatchingEgg = (party: Pokemon[]): number => party.findIndex((m) => m.isEgg && m.friendship === 0);

/**
 * Decomp Egg_DetermineEggSpeciesAndParentSlots and Daycare_AlterEggSpeciesWithIncenseItem: the mother
 * (or the non-Ditto) gives her base species (`SpeciesData.eggSpecies`); Nidoran♀ and Illumise eggs are
 * Nidoran♂ and Volbeat when the PID has bit 0x8000; Manaphy gives Phione; an incense baby needs its
 * incense held by a parent, else the evolved species hatches. Returns the slots [mother, father]: Ditto
 * is the mother when the other parent is not female.
 */
export function eggSpeciesAndParents(dex: Dex, d: Daycare): { species: Id; mother: number; father: number } {
  const mons = slots(d).map((m) => m.mon);
  let parents: [number, number] = [-1, -1];
  mons.forEach((m, i) => {
    if (local(m.species) === 'SPECIES_DITTO') parents = [i ^ 1, i];
    else if (genderOf(dex.species(m.species).genderRatio, m.pid) === 'female') parents = [i, i ^ 1];
  });
  if (parents[0] < 0) throw new Error('daycare: no mother or Ditto for an egg');
  const mother = mons[parents[0]]!;
  let species = dex.species(mother.species).eggSpecies;
  const name = local(species);
  if (name === 'SPECIES_NIDORAN_F') species = sibling(species, d.offspring & EGG_GENDER_MALE ? 'SPECIES_NIDORAN_M' : 'SPECIES_NIDORAN_F');
  if (name === 'SPECIES_ILLUMISE') species = sibling(species, d.offspring & EGG_GENDER_MALE ? 'SPECIES_VOLBEAT' : 'SPECIES_ILLUMISE');
  if (name === 'SPECIES_MANAPHY') species = sibling(species, 'SPECIES_PHIONE');
  if (local(mons[parents[1]]!.species) === 'SPECIES_DITTO' && genderOf(dex.species(mother.species).genderRatio, mother.pid) !== 'female') parents = [parents[1], parents[0]];
  const baby = INCENSE_BABIES.find(([b]) => `SPECIES_${b}` === local(species));
  if (baby && !mons.some((m) => local(m.heldItem) === `ITEM_${baby[1]}`)) species = sibling(species, `SPECIES_${baby[2]}`);
  dex.species(species);
  return { species, mother: parents[0], father: parents[1] };
}

/**
 * Decomp Egg_InheritIVs: three stats from a random daycare slot each. The stat list loses the entry at
 * index i (not the picked stat) after pick i, so a stat can be picked twice (fewer than three inherited);
 * kept for fidelity. Rolls: three picks, then three slots.
 */
export function inheritIvs(egg: Pokemon, parents: readonly Pokemon[], rng: Rng): StatName[] {
  let available = STATS.map((_, i) => i);
  const picked: number[] = [];
  for (let i = 0; i < INHERITED_IVS; i++) {
    picked.push(available[u16(rng) % (STATS.length - i)]!);
    available = available.filter((_, k) => k !== i);
  }
  const from = picked.map(() => u16(rng) % DAYCARE_SLOTS);
  picked.forEach((stat, i) => (egg.ivs[STATS[stat]!] = parents[from[i]!]!.ivs[STATS[stat]!]));
  return picked.map((s) => STATS[s]!);
}

/** Add, or with four known push out the first (decomp Pokemon_AddMove, then Pokemon_ReplaceMove when full). */
function learn(dex: Dex, mon: Pokemon, move: Id): void {
  if (addMove(dex, mon, move) === 'full') pushMove(dex, mon, move);
}

/**
 * Decomp Egg_BuildMoveset over the egg's default moves: the father's moves that are the species' egg moves,
 * then the father's moves a TM/HM of the species teaches, then the moves both parents know that the
 * species learns by level.
 */
export function buildEggMoves(dex: Dex, egg: Pokemon, father: Pokemon, mother: Pokemon): void {
  const data = dex.form(egg.species, egg.form);
  const eggMoves = dex.species(egg.species).eggMoves.slice(0, MAX_EGG_MOVES);
  for (const m of father.moves) if (eggMoves.includes(m)) learn(dex, egg, m);
  for (const m of father.moves) {
    for (const [item, rec] of dex.data.items) if (rec.tm === m && data.tms.includes(item)) learn(dex, egg, m);
  }
  const shared = father.moves.filter((m) => mother.moves.includes(m));
  const levelUp = data.learnset.map((e) => e.move);
  for (const m of shared) if (levelUp.includes(m)) learn(dex, egg, m);
}

/**
 * Decomp Daycare_GiveEggFromDaycare: the egg (level 1, the offspring PID, random IVs then three inherited,
 * the mother's form, cycles = the species' hatch cycles in its friendship, a Poké Ball, met level 0, the
 * player as OT), its moves, Volt Tackle for Pichu when a parent holds a Light Ball. The daycare's offspring
 * and step counter reset.
 */
export function eggFromDaycare(dex: Dex, d: Daycare, rng: Rng, o: { trainer: Trainer; ball: Id; met: MetData }): Pokemon {
  if (!d.offspring) throw new Error('daycare: no egg is waiting');
  const parents = slots(d).map((m) => m.mon);
  const { species, mother, father } = eggSpeciesAndParents(dex, d);
  const form = parents[mother]!.form;
  const egg = createPokemon(dex, { species, form, level: 1, pid: d.offspring, ivs: randomIvs(rng), ...o.trainer, ball: o.ball, met: { ...o.met, level: 0 }, isEgg: true });
  egg.friendship = dex.species(species).hatchCycles;
  inheritIvs(egg, parents, rng);
  buildEggMoves(dex, egg, parents[father]!, parents[mother]!);
  if (local(species) === 'SPECIES_PICHU' && parents.some((m) => local(m.heldItem) === 'ITEM_LIGHT_BALL')) learn(dex, egg, sibling(species, 'MOVE_VOLT_TACKLE'));
  recalc(dex, egg);
  d.offspring = 0;
  d.stepCounter = 0;
  return egg;
}

/** Decomp Egg_CreateEgg (`give_egg`): a random PID and IVs, cycles = the species' hatch cycles, a Poké Ball, met level 0. */
export function createEgg(dex: Dex, rng: Rng, o: { species: Id; trainer: Trainer; ball: Id; met: MetData }): Pokemon {
  const pid = rng.next() >>> 0;
  const egg = createPokemon(dex, { species: o.species, level: 1, pid, ivs: randomIvs(rng), ...o.trainer, ball: o.ball, met: { ...o.met, level: 0 }, isEgg: true });
  egg.friendship = dex.species(o.species).hatchCycles;
  return egg;
}

/**
 * Decomp Egg_CreateHatchedMon and FieldTask_HatchEgg: the egg becomes a level-1 Pokémon with its PID, IVs,
 * moves and PP, OT, form and Pokérus; friendship 120, no nickname, a Poké Ball, met level 0. The egg's
 * receipt (its met zone and date) moves to `met.egg`; met becomes where and when it hatched.
 */
export function hatchEgg(dex: Dex, egg: Pokemon, o: { ball: Id; zone: Id | null; date: string | null }): void {
  if (!egg.isEgg) throw new Error('hatch: not an egg');
  const mon = createPokemon(dex, {
    species: egg.species,
    form: egg.form,
    level: 1,
    pid: egg.pid,
    ivs: egg.ivs,
    otId: egg.otId,
    otName: egg.otName,
    otGender: egg.otGender,
    ball: o.ball,
    moves: egg.moves,
    met: { zone: o.zone, level: 0, date: o.date, egg: { zone: egg.met.zone, date: egg.met.date } },
  });
  mon.pp = [...egg.pp];
  mon.ppUps = [...egg.ppUps];
  mon.friendship = HATCHED_FRIENDSHIP;
  mon.pokerus = egg.pokerus;
  Object.assign(egg, mon);
}

/** Decomp InitializeFriendshipLevelString: "The Egg Watch" message (summary bank 105–108) by the cycles left. */
export function eggWatchMessage(cycles: number): number {
  if (cycles <= 5) return 105;
  if (cycles <= 10) return 106;
  if (cycles <= 40) return 107;
  return 108;
}
