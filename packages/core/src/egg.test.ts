/** Daycare and egg rules against the decomp (src/overlay005/daycare.c), on our own test data. */
import { describe, expect, it } from 'vitest';
import {
  buildEggMoves,
  compatibility,
  compatibilityLevel,
  createEgg,
  COMPATIBILITY,
  daycareFee,
  daycareLevel,
  daycareState,
  daycareStep,
  depositMon,
  eggCycleLength,
  eggFromDaycare,
  eggSpeciesAndParents,
  eggWatchMessage,
  emptyDaycare,
  firstHatchingEgg,
  hatchEgg,
  inheritIvs,
  rollOffspring,
  withdrawMon,
  type Daycare,
} from './egg.ts';
import type { Id } from './ids.ts';
import { createPokemon, Dex, natureIndex, uniformStats, type MonRegistries, type Pokemon, type Rng, type SpeciesData, type Stats } from './pokemon.ts';

const t = (s: string) => `test:${s}` as Id;
const stats = (v: number): Stats => uniformStats(v);

function species(name: string, extra: Partial<SpeciesData> = {}): [Id, SpeciesData] {
  return [
    t(`SPECIES_${name}`),
    {
      baseStats: stats(50),
      types: [t('TYPE_A'), t('TYPE_A')],
      catchRate: 45,
      baseExp: 64,
      evYield: stats(0),
      heldItems: { common: null, rare: null },
      genderRatio: 127,
      hatchCycles: 20,
      baseFriendship: 70,
      growthRate: t('CUBE'),
      eggGroups: [t('EGG_GROUP_FIELD'), t('EGG_GROUP_FIELD')],
      abilities: [t('ABILITY_PLAIN'), null],
      safariFleeRate: 0,
      learnset: [{ level: 1, move: t('MOVE_TACKLE') }],
      tms: [],
      evolutions: [],
      eggMoves: [],
      eggSpecies: t(`SPECIES_${name}`),
      ...extra,
    },
  ];
}

const MOVES = ['TACKLE', 'GROWL', 'EGGY', 'TMMOVE', 'SHARED', 'VOLT_TACKLE', 'L5', 'L6', 'L7', 'L8', 'L9', 'OTHER'];
const data: MonRegistries = {
  species: new Map([
    species('DITTO', { genderRatio: 255, eggGroups: [t('EGG_GROUP_DITTO'), t('EGG_GROUP_DITTO')] }),
    species('PIKACHU', { eggSpecies: t('SPECIES_PICHU'), eggMoves: [t('MOVE_EGGY')], tms: [t('ITEM_TM01')] }),
    species('PICHU', {
      eggGroups: [t('EGG_GROUP_UNDISCOVERED'), t('EGG_GROUP_UNDISCOVERED')],
      eggMoves: [t('MOVE_EGGY')],
      tms: [t('ITEM_TM01')],
      learnset: [{ level: 1, move: t('MOVE_TACKLE') }, { level: 1, move: t('MOVE_GROWL') }, { level: 30, move: t('MOVE_SHARED') }],
    }),
    species('RATTA', { eggGroups: [t('EGG_GROUP_FIELD'), t('EGG_GROUP_WATER')] }),
    species('FISH', { eggGroups: [t('EGG_GROUP_WATER'), t('EGG_GROUP_WATER')] }),
    species('BUG', { eggGroups: [t('EGG_GROUP_BUG'), t('EGG_GROUP_BUG')] }),
    species('ROCK', { genderRatio: 255, eggGroups: [t('EGG_GROUP_MINERAL'), t('EGG_GROUP_MINERAL')] }),
    species('NIDORAN_F', { genderRatio: 254 }),
    species('NIDORAN_M', { genderRatio: 0 }),
    species('ILLUMISE', { genderRatio: 254 }),
    species('VOLBEAT', { genderRatio: 0 }),
    species('MANAPHY', { genderRatio: 255, eggGroups: [t('EGG_GROUP_WATER'), t('EGG_GROUP_FAIRY')] }),
    species('PHIONE', { genderRatio: 255 }),
    species('WOBBUFFET', { eggSpecies: t('SPECIES_WYNAUT') }),
    species('WYNAUT', { eggGroups: [t('EGG_GROUP_UNDISCOVERED'), t('EGG_GROUP_UNDISCOVERED')] }),
    species('SLUGMA', { abilities: [t('ABILITY_FLAME_BODY'), null] }),
    species('GROWER', { learnset: [5, 6, 7, 8, 9].map((level) => ({ level, move: t(`MOVE_L${level}`) })) }),
  ]),
  moves: new Map(MOVES.map((m) => [t(`MOVE_${m}`), { pp: 20 }])),
  growthRates: new Map([[t('CUBE'), { exp: Array.from({ length: 101 }, (_, l) => l ** 3) }]]),
  natures: new Map(Array.from({ length: 25 }, (_, i) => [t(`NATURE_${i}`), { sourceIndex: i, up: null, down: null }])),
  items: new Map([
    [t('ITEM_EVERSTONE'), { holdEffect: 'NO_EVOLVE', holdParam: 0 }],
    [t('ITEM_LIGHT_BALL'), { holdEffect: 'NONE', holdParam: 0 }],
    [t('ITEM_LAX_INCENSE'), { holdEffect: 'NONE', holdParam: 0 }],
    [t('ITEM_TM01'), { holdEffect: 'NONE', holdParam: 0, tm: t('MOVE_TMMOVE') }],
  ]),
};
const dex = new Dex(data);

/** PIDs whose low byte gives the gender against ratio 127: 0x00 female, 0xff male. */
const FEMALE = 0x00;
const MALE = 0xff;
function mon(name: string, o: { pid?: number; otId?: number; level?: number; moves?: string[]; item?: string; ivs?: number } = {}): Pokemon {
  return createPokemon(dex, {
    species: t(`SPECIES_${name}`),
    level: o.level ?? 10,
    pid: o.pid ?? MALE,
    ivs: o.ivs ?? 0,
    otId: o.otId ?? 1,
    otName: 'P',
    otGender: 'male',
    ball: t('ITEM_POKE_BALL'),
    heldItem: o.item ? t(`ITEM_${o.item}`) : null,
    ...(o.moves ? { moves: o.moves.map((m) => t(`MOVE_${m}`)) } : {}),
  });
}
function daycare(a: Pokemon, b: Pokemon): Daycare {
  const d = emptyDaycare();
  depositMon(dex, d, a);
  depositMon(dex, d, b);
  return d;
}
/** Plays the given u32 values in order, then fails. */
function scripted(values: number[]): Rng {
  const q = [...values];
  const next = () => {
    const v = q.shift();
    if (v === undefined) throw new Error('scripted rng ran out');
    return v >>> 0;
  };
  return { next, below: (n) => next() % n };
}

describe('compatibility (BoxMon_GetPairDaycareCompatibilityScore)', () => {
  it('scores pairs as the decomp does', () => {
    expect(compatibility(dex, mon('PIKACHU', { pid: FEMALE }), mon('PIKACHU', { pid: MALE, otId: 2 }))).toBe(COMPATIBILITY.max);
    expect(compatibility(dex, mon('PIKACHU', { pid: FEMALE }), mon('PIKACHU', { pid: MALE }))).toBe(COMPATIBILITY.medium);
    expect(compatibility(dex, mon('PIKACHU', { pid: FEMALE }), mon('RATTA', { pid: MALE, otId: 2 }))).toBe(COMPATIBILITY.medium);
    expect(compatibility(dex, mon('PIKACHU', { pid: FEMALE }), mon('RATTA', { pid: MALE }))).toBe(COMPATIBILITY.low);
    // A shared second egg group is enough.
    expect(compatibility(dex, mon('RATTA', { pid: FEMALE }), mon('FISH', { pid: MALE }))).toBe(COMPATIBILITY.low);
    expect(compatibility(dex, mon('PIKACHU', { pid: FEMALE }), mon('BUG', { pid: MALE }))).toBe(COMPATIBILITY.incompatible);
    expect(compatibility(dex, mon('PIKACHU', { pid: MALE }), mon('PIKACHU', { pid: MALE }))).toBe(COMPATIBILITY.incompatible);
    expect(compatibility(dex, mon('ROCK'), mon('PIKACHU', { pid: FEMALE }))).toBe(COMPATIBILITY.incompatible);
    expect(compatibility(dex, mon('PICHU', { pid: FEMALE }), mon('PIKACHU', { pid: MALE }))).toBe(COMPATIBILITY.incompatible);
    // Ditto: low with the same OT, medium otherwise; genderless partners breed with Ditto; two Dittos never.
    expect(compatibility(dex, mon('DITTO'), mon('ROCK'))).toBe(COMPATIBILITY.low);
    expect(compatibility(dex, mon('DITTO'), mon('ROCK', { otId: 9 }))).toBe(COMPATIBILITY.medium);
    expect(compatibility(dex, mon('DITTO'), mon('DITTO', { otId: 9 }))).toBe(COMPATIBILITY.incompatible);
    expect(compatibility(dex, mon('DITTO'), mon('WYNAUT'))).toBe(COMPATIBILITY.incompatible);
  });

  it("maps the score to the old man's line (0 very well … 3 other Pokémon)", () => {
    expect(compatibilityLevel(dex, daycare(mon('PIKACHU', { pid: FEMALE }), mon('PIKACHU', { otId: 2 })))).toBe(0);
    expect(compatibilityLevel(dex, daycare(mon('PIKACHU', { pid: FEMALE }), mon('PIKACHU')))).toBe(1);
    expect(compatibilityLevel(dex, daycare(mon('PIKACHU', { pid: FEMALE }), mon('RATTA')))).toBe(2);
    expect(compatibilityLevel(dex, daycare(mon('PIKACHU', { pid: FEMALE }), mon('BUG')))).toBe(3);
  });
});

describe('egg species (Egg_DetermineEggSpeciesAndParentSlots)', () => {
  const withOffspring = (a: Pokemon, b: Pokemon, offspring = 1) => {
    const d = daycare(a, b);
    d.offspring = offspring;
    return eggSpeciesAndParents(dex, d);
  };
  it("takes the mother's base species and names the parents", () => {
    expect(withOffspring(mon('RATTA'), mon('PIKACHU', { pid: FEMALE }))).toEqual({ species: t('SPECIES_PICHU'), mother: 1, father: 0 });
    // Ditto with a female: the female is the mother.
    expect(withOffspring(mon('DITTO'), mon('PIKACHU', { pid: FEMALE }))).toEqual({ species: t('SPECIES_PICHU'), mother: 1, father: 0 });
    // Ditto with a male: the male's species, and Ditto becomes the "mother" slot.
    expect(withOffspring(mon('PIKACHU'), mon('DITTO'))).toEqual({ species: t('SPECIES_PICHU'), mother: 1, father: 0 });
  });
  it('makes Nidoran♂ and Volbeat on PID bit 0x8000, Phione from Manaphy', () => {
    expect(withOffspring(mon('NIDORAN_F'), mon('NIDORAN_M'), 0x8000).species).toBe(t('SPECIES_NIDORAN_M'));
    expect(withOffspring(mon('NIDORAN_F'), mon('NIDORAN_M'), 0x7fff).species).toBe(t('SPECIES_NIDORAN_F'));
    expect(withOffspring(mon('ILLUMISE'), mon('VOLBEAT'), 0x18000).species).toBe(t('SPECIES_VOLBEAT'));
    expect(withOffspring(mon('MANAPHY'), mon('DITTO')).species).toBe(t('SPECIES_PHIONE'));
  });
  it('hatches incense babies only with the incense held', () => {
    expect(withOffspring(mon('WOBBUFFET', { pid: FEMALE }), mon('WOBBUFFET')).species).toBe(t('SPECIES_WOBBUFFET'));
    expect(withOffspring(mon('WOBBUFFET', { pid: FEMALE }), mon('WOBBUFFET', { item: 'LAX_INCENSE' })).species).toBe(t('SPECIES_WYNAUT'));
  });
});

describe('IV inheritance (Egg_InheritIVs)', () => {
  it('copies three picks from the rolled slots, keeping the list-index bug', () => {
    const egg = mon('PICHU', { ivs: 0 });
    const parents = [mon('PIKACHU', { ivs: 10 }), mon('PIKACHU', { ivs: 20 })];
    parents[0]!.ivs.speed = 11;
    parents[1]!.ivs.defense = 22;
    // Picks: index 3 of [0..5] = speed; then the list drops index 0 → [1..5], index 1 = defense; then it drops
    // index 1 → [1,3,4,5], index 2 = spAttack. Slots 0, 1, 1.
    expect(inheritIvs(egg, parents, scripted([3, 1, 2, 0, 1, 1]))).toEqual(['speed', 'defense', 'spAttack']);
    expect(egg.ivs).toEqual({ hp: 0, attack: 0, defense: 22, speed: 11, spAttack: 20, spDefense: 0 });
  });
  it('can pick a stat twice (fewer than three inherited)', () => {
    const egg = mon('PICHU', { ivs: 0 });
    // Index 1 of [0..5] = attack; the list drops index 0 → [1..5]; index 0 = attack again; it drops index 1 → [1,3,4,5]: speed.
    expect(inheritIvs(egg, [mon('PIKACHU', { ivs: 5 }), mon('PIKACHU', { ivs: 6 })], scripted([1, 0, 1, 0, 1, 0]))).toEqual(['attack', 'attack', 'speed']);
    expect(egg.ivs).toMatchObject({ attack: 6, speed: 5, hp: 0, defense: 0 });
  });
});

describe('egg moves (Egg_BuildMoveset)', () => {
  it("adds the father's egg and TM moves, then level-up moves both parents know", () => {
    const egg = mon('PICHU', { level: 1 });
    expect(egg.moves).toEqual([t('MOVE_TACKLE'), t('MOVE_GROWL')]);
    const father = mon('PIKACHU', { moves: ['OTHER', 'EGGY', 'TMMOVE', 'SHARED'] });
    const mother = mon('PIKACHU', { pid: FEMALE, moves: ['SHARED', 'EGGY'] });
    buildEggMoves(dex, egg, father, mother);
    // EGGY (egg move), TMMOVE (TM01), SHARED (both know it, Pichu learns it at 30): the first default move is pushed out.
    expect(egg.moves).toEqual([t('MOVE_GROWL'), t('MOVE_EGGY'), t('MOVE_TMMOVE'), t('MOVE_SHARED')]);
  });
  it("ignores the mother's egg moves", () => {
    const egg = mon('PICHU', { level: 1 });
    buildEggMoves(dex, egg, mon('PIKACHU', { moves: ['OTHER'] }), mon('PIKACHU', { pid: FEMALE, moves: ['EGGY'] }));
    expect(egg.moves).toEqual([t('MOVE_TACKLE'), t('MOVE_GROWL')]);
  });
});

describe('the daycare (Daycare_Update, deposit and withdraw)', () => {
  it('counts steps, rolls an egg every 256th step of the second slot, and resets with the egg', () => {
    const d = daycare(mon('PIKACHU', { pid: FEMALE }), mon('PIKACHU', { otId: 2 }));
    expect(daycareState(d)).toBe(3);
    d.mons[1]!.steps = 254;
    // Step 255: rand = 0x7000 * 100 / 0xFFFF = 43 < 70 → the offspring PID (no Everstone: one roll).
    expect(daycareStep(dex, d, [], scripted([0x7000, 0x1234abcd]), 255)).toBe(false);
    expect(d.offspring).toBe(0x1234abcd);
    expect(daycareState(d)).toBe(1);
    d.mons[1]!.steps = 510;
    // No egg roll while one waits (no rng consumed).
    daycareStep(dex, d, [], scripted([]), 255);
    const egg = eggFromDaycare(dex, d, scripted([0, 0, 0, 1, 2, 0, 0, 0]), { trainer: { otId: 7, otName: 'ME', otGender: 'female' }, ball: t('ITEM_POKE_BALL'), met: { zone: null, level: 5, date: '2026-01-01' } });
    expect(egg).toMatchObject({ species: t('SPECIES_PICHU'), isEgg: true, pid: 0x1234abcd, level: 1, friendship: 20, otId: 7, met: { level: 0 } });
    expect([d.offspring, d.stepCounter]).toEqual([0, 0]);
  });

  it('a failed roll leaves no egg', () => {
    const d = daycare(mon('PIKACHU', { pid: FEMALE }), mon('RATTA'));
    d.mons[1]!.steps = 254;
    daycareStep(dex, d, [], scripted([0x4000]), 255); // 25 ≥ 20
    expect(d.offspring).toBe(0);
  });

  it('passes the Everstone nature half the time (rerolling the PID until it matches)', () => {
    const d = daycare(mon('PIKACHU', { pid: FEMALE + 0x100 * 7, item: 'EVERSTONE' }), mon('PIKACHU'));
    // The coin (< 0x7FFF: pass), then PIDs until nature (pid % 25) matches the mother's.
    const mother = d.mons[0]!.mon.pid;
    rollOffspring(dex, d, scripted([0x100, 1, 2, mother + 25]));
    expect(natureIndex(dex, d.offspring)).toBe(natureIndex(dex, mother));
    expect(d.offspring).toBe(mother + 25);
    rollOffspring(dex, d, scripted([0x8000, 99]));
    expect(d.offspring).toBe(99);
  });

  it('runs egg cycles: 255 steps (230 on special dates), 2 per cycle with Flame Body, hatching after 0', () => {
    expect(eggCycleLength('2026-02-14', false)).toBe(230);
    expect(eggCycleLength('2026-02-14', true)).toBe(255);
    expect(eggCycleLength('2026-01-01', false)).toBe(255);
    const d = emptyDaycare();
    const egg = createEgg(dex, scripted([5, 0, 0]), { species: t('SPECIES_PICHU'), trainer: { otId: 1, otName: 'P', otGender: 'male' }, ball: t('ITEM_POKE_BALL'), met: { zone: null, level: 0, date: null } });
    egg.friendship = 3;
    const party = [mon('SLUGMA'), egg];
    d.stepCounter = 253;
    expect(daycareStep(dex, d, party, scripted([]), 255)).toBe(false);
    expect([d.stepCounter, egg.friendship]).toEqual([254, 3]);
    daycareStep(dex, d, party, scripted([]), 255);
    expect([d.stepCounter, egg.friendship]).toEqual([0, 1]);
    d.stepCounter = 254;
    daycareStep(dex, d, party, scripted([]), 255);
    expect(egg.friendship).toBe(0);
    expect(firstHatchingEgg(party)).toBe(1);
    d.stepCounter = 254;
    expect(daycareStep(dex, d, party, scripted([]), 255)).toBe(true);
  });

  it('gives 1 exp per step on withdrawal, learning moves level by level and pushing out the first when full', () => {
    const d = emptyDaycare();
    depositMon(dex, d, mon('GROWER', { level: 4, moves: ['TACKLE', 'GROWL', 'EGGY', 'OTHER'] }));
    expect(d.mons[0]!.mon.exp).toBe(64);
    d.mons[0]!.steps = 343 - 64; // to level 7
    expect(daycareLevel(dex, d, 0)).toBe(7);
    expect(daycareFee(dex, d, 0)).toBe(400);
    const back = withdrawMon(dex, d, 0);
    expect(back.level).toBe(7);
    expect(back.moves).toEqual([t('MOVE_OTHER'), t('MOVE_L5'), t('MOVE_L6'), t('MOVE_L7')]);
    expect(back.hp).toBe(back.stats.hp);
    expect(d.mons).toEqual([null, null]);
  });

  it('shifts the second slot down when the first leaves', () => {
    const d = daycare(mon('PIKACHU', { pid: FEMALE }), mon('RATTA'));
    withdrawMon(dex, d, 0);
    expect(d.mons[0]!.mon.species).toBe(t('SPECIES_RATTA'));
    expect(d.mons[1]).toBeNull();
  });
});

describe('hatching (Egg_CreateHatchedMon)', () => {
  it('keeps PID, IVs, moves and OT; friendship 120; met moves to the egg', () => {
    const egg = createEgg(dex, scripted([0xabcdef01, 0x7fff, 0x3c00]), { species: t('SPECIES_PICHU'), trainer: { otId: 3, otName: 'ME', otGender: 'female' }, ball: t('ITEM_POKE_BALL'), met: { zone: t('ZONE_A'), level: 0, date: '2026-01-01' } });
    egg.friendship = 0;
    const ivs = { ...egg.ivs };
    hatchEgg(dex, egg, { ball: t('ITEM_POKE_BALL'), zone: t('ZONE_B'), date: '2026-01-02' });
    expect(egg).toMatchObject({ isEgg: false, species: t('SPECIES_PICHU'), pid: 0xabcdef01, ivs, level: 1, friendship: 120, otId: 3, otName: 'ME', nickname: null });
    expect(egg.met).toEqual({ zone: t('ZONE_B'), level: 0, date: '2026-01-02', egg: { zone: t('ZONE_A'), date: '2026-01-01' } });
    expect(egg.hp).toBe(egg.stats.hp);
  });
  it('picks the Egg Watch message by cycles left', () => {
    expect([0, 5, 6, 10, 11, 40, 41].map(eggWatchMessage)).toEqual([105, 105, 106, 106, 107, 107, 108]);
  });
});
