/**
 * Every evolution method's check (decomp Pokemon_GetEvolutionTargetSpecies, pokemon.c) on original test
 * species, plus evolve, the moves learned on evolving and the Shedinja copy.
 */
import { describe, expect, it } from 'vitest';
import type { Id } from './ids.ts';
import { createPokemon, Dex, movesAtLevel, evolutionTarget, evolve, shedinjaFrom, type Evolution, type EvolutionTrigger, type MonRegistries, type Pokemon, type SpeciesData, type Stats } from './pokemon.ts';

const t = (s: string) => `test:${s}` as Id;
const stats = (hp: number, attack: number, defense: number, speed: number, spAttack: number, spDefense: number): Stats => ({ hp, attack, defense, speed, spAttack, spDefense });
const flat = stats(50, 50, 50, 50, 50, 50);

function species(name: string, evolutions: Evolution[], extra: Partial<SpeciesData> = {}): [Id, SpeciesData] {
  return [
    t(name),
    {
      baseStats: flat,
      types: [t('TYPE_A'), t('TYPE_A')],
      catchRate: 45,
      baseExp: 64,
      evYield: flat,
      heldItems: { common: null, rare: null },
      genderRatio: 127,
      hatchCycles: 20,
      baseFriendship: 70,
      growthRate: t('CUBE'),
      eggGroups: [t('EGG'), t('EGG')],
      abilities: [t('ABILITY_ONE'), t('ABILITY_TWO')],
      safariFleeRate: 0,
      learnset: [{ level: 1, move: t('MOVE_A') }],
      tms: [],
      evolutions,
      eggMoves: [],
      eggSpecies: t(name),
      ...extra,
    },
  ];
}

const to = (s: string) => t(s);
const data: MonRegistries = {
  species: new Map([
    species('HAPPY', [{ method: 'LEVEL_HAPPINESS', target: to('A') }]),
    species('EEVEE', [
      { method: 'LEVEL_MOSS_ROCK', target: to('MOSS') },
      { method: 'LEVEL_ICE_ROCK', target: to('ICE') },
      { method: 'USE_ITEM', target: to('THUNDER'), item: t('ITEM_THUNDERSTONE') },
      { method: 'LEVEL_HAPPINESS_DAY', target: to('DAY') },
      { method: 'LEVEL_HAPPINESS_NIGHT', target: to('NIGHT') },
    ]),
    species('PLAIN', [{ method: 'LEVEL', target: to('A'), level: 16 }], { learnset: [{ level: 1, move: t('MOVE_A') }, { level: 16, move: t('MOVE_B') }] }),
    species('TYROGUE', [
      { method: 'LEVEL_ATK_LT_DEF', target: to('CHAN'), level: 20 },
      { method: 'LEVEL_ATK_GT_DEF', target: to('LEE'), level: 20 },
      { method: 'LEVEL_ATK_EQ_DEF', target: to('TOP'), level: 20 },
    ]),
    species('WURMPLE', [
      { method: 'LEVEL_PID_LOW', target: to('SILCOON'), level: 7 },
      { method: 'LEVEL_PID_HIGH', target: to('CASCOON'), level: 7 },
    ]),
    species('NINCADA', [
      { method: 'LEVEL_NINJASK', target: to('NINJASK'), level: 20 },
      { method: 'LEVEL_SHEDINJA', target: to('SHEDINJA'), level: 20 },
    ]),
    species('FEEBAS', [{ method: 'LEVEL_BEAUTY', target: to('A'), beauty: 170 }]),
    species('HAPPINY', [{ method: 'LEVEL_WITH_HELD_ITEM_DAY', target: to('A'), item: t('ITEM_OVAL') }]),
    species('GLIGAR', [{ method: 'LEVEL_WITH_HELD_ITEM_NIGHT', target: to('A'), item: t('ITEM_FANG') }]),
    species('AIPOM', [{ method: 'LEVEL_KNOW_MOVE', target: to('A'), move: t('MOVE_B') }]),
    species('MANTYKE', [{ method: 'LEVEL_SPECIES_IN_PARTY', target: to('A'), species: t('REMORAID') }]),
    species('BURMY', [
      { method: 'LEVEL_FEMALE', target: to('WORMADAM'), level: 20 },
      { method: 'LEVEL_MALE', target: to('MOTHIM'), level: 20 },
    ]),
    species('MAGNETON', [{ method: 'LEVEL_MAGNETIC_FIELD', target: to('A') }]),
    species('SPECIES_KADABRA', [{ method: 'TRADE', target: to('A') }], { abilities: [t('ABILITY_ONE'), null] }),
    species('ONIX', [{ method: 'TRADE_WITH_HELD_ITEM', target: to('A'), item: t('ITEM_COAT') }]),
    species('SLOWPOKE', [
      { method: 'LEVEL', target: to('SLOWBRO'), level: 37 },
      { method: 'TRADE_WITH_HELD_ITEM', target: to('SLOWKING'), item: t('ITEM_ROCK') },
    ]),
    species('SNORUNT', [
      { method: 'LEVEL', target: to('GLALIE'), level: 42 },
      { method: 'USE_ITEM_FEMALE', target: to('FROSLASS'), item: t('ITEM_DAWN') },
    ]),
    species('KIRLIA', [{ method: 'USE_ITEM_MALE', target: to('GALLADE'), item: t('ITEM_DAWN') }]),
    ...['A', 'MOSS', 'ICE', 'THUNDER', 'DAY', 'NIGHT', 'CHAN', 'LEE', 'TOP', 'SILCOON', 'CASCOON', 'NINJASK', 'MOTHIM', 'SLOWBRO', 'SLOWKING', 'GLALIE', 'FROSLASS', 'GALLADE', 'REMORAID'].map((n) =>
      species(n, [], n === 'A' ? { abilities: [t('ABILITY_THREE'), t('ABILITY_FOUR')], learnset: [{ level: 1, move: t('MOVE_A') }, { level: 16, move: t('MOVE_C') }, { level: 16, move: t('MOVE_D') }] } : {}),
    ),
    species('SHEDINJA', [], { baseStats: stats(1, 90, 45, 40, 30, 30), genderRatio: 255, abilities: [t('ABILITY_WONDER'), null] }),
    species('WORMADAM', [], { forms: [1, 2].map((form) => ({ ...species('WORMADAM', [])[1], form, name: `W${form}`, baseStats: stats(60, 59, 85 + form, 36, 79, 105) })) }),
  ]),
  moves: new Map(['A', 'B', 'C', 'D'].map((m) => [t(`MOVE_${m}`), { pp: 10 }])),
  growthRates: new Map([[t('CUBE'), { exp: Array.from({ length: 101 }, (_, n) => n ** 3) }]]),
  natures: new Map([[t('NATURE_0'), { sourceIndex: 0, up: null, down: null }]]),
  items: new Map(
    ['ITEM_THUNDERSTONE', 'ITEM_OVAL', 'ITEM_FANG', 'ITEM_COAT', 'ITEM_ROCK', 'ITEM_DAWN', 'ITEM_BALL', 'ITEM_POKE_BALL'].map((i) => [t(i), { holdEffect: 'NONE', holdParam: 0 }] as [Id, { holdEffect: string; holdParam: number }]).concat([[t('ITEM_EVERSTONE'), { holdEffect: 'NO_EVOLVE', holdParam: 0 }]]),
  ),
};
const dex = new Dex(data);

const mon = (name: string, level: number, o: Partial<Pokemon> = {}): Pokemon => ({
  ...createPokemon(dex, { species: t(name), level, pid: o.pid ?? 0, ivs: 0, otId: 1, otName: 'Ari', otGender: 'male', ball: t('ITEM_BALL') }),
  ...o,
});
const day: EvolutionTrigger = { kind: 'level', isNight: false, partySpecies: [] };
const night: EvolutionTrigger = { kind: 'level', isNight: true, partySpecies: [] };
const target = (m: Pokemon, trigger: EvolutionTrigger = day) => evolutionTarget(dex, m, trigger)?.target ?? null;

describe('evolution checks (decomp Pokemon_GetEvolutionTargetSpecies)', () => {
  it('LEVEL from the level on; the table order decides', () => {
    expect(target(mon('PLAIN', 15))).toBeNull();
    expect(target(mon('PLAIN', 16))).toBe(t('A'));
    expect(target(mon('PLAIN', 40))).toBe(t('A'));
  });

  it('friendship ≥ 220 (EVOLVE_FRIENDSHIP_THRESHOLD), by day and by night (IsNight)', () => {
    expect(target(mon('HAPPY', 5, { friendship: 219 }))).toBeNull();
    expect(target(mon('HAPPY', 5, { friendship: 220 }))).toBe(t('A'));
    expect(target(mon('EEVEE', 5, { friendship: 220 }), day)).toBe(t('DAY'));
    expect(target(mon('EEVEE', 5, { friendship: 220 }), night)).toBe(t('NIGHT'));
    expect(target(mon('EEVEE', 5, { friendship: 100 }), night)).toBeNull();
  });

  it("the zone's method (moss rock, ice rock, magnetic field) comes before friendship in Eevee's table", () => {
    const happy = mon('EEVEE', 5, { friendship: 255 });
    expect(target(happy, { ...day, mapEvolution: 'LEVEL_MOSS_ROCK' })).toBe(t('MOSS'));
    expect(target(happy, { ...night, mapEvolution: 'LEVEL_ICE_ROCK' })).toBe(t('ICE'));
    expect(target(mon('MAGNETON', 30), { ...day, mapEvolution: 'LEVEL_MAGNETIC_FIELD' })).toBe(t('A'));
    expect(target(mon('MAGNETON', 30), { ...day, mapEvolution: 'LEVEL_ICE_ROCK' })).toBeNull();
    expect(target(mon('MAGNETON', 30))).toBeNull();
  });

  it('Attack against Defense (Tyrogue), PID high half % 10 (Wurmple)', () => {
    const ty = (attack: number, defense: number) => target(mon('TYROGUE', 20, { stats: { ...flat, attack, defense } }));
    expect([ty(40, 50), ty(50, 40), ty(45, 45)]).toEqual([t('CHAN'), t('LEE'), t('TOP')]);
    expect(target(mon('TYROGUE', 19))).toBeNull();
    expect(target(mon('WURMPLE', 7, { pid: 4 << 16 }))).toBe(t('SILCOON'));
    expect(target(mon('WURMPLE', 7, { pid: 15 << 16 }))).toBe(t('CASCOON'));
  });

  it('held item by day or night, a known move, a species in the party', () => {
    expect(target(mon('HAPPINY', 2, { heldItem: t('ITEM_OVAL') }), day)).toBe(t('A'));
    expect(target(mon('HAPPINY', 2, { heldItem: t('ITEM_OVAL') }), night)).toBeNull();
    expect(target(mon('GLIGAR', 2, { heldItem: t('ITEM_FANG') }), night)).toBe(t('A'));
    expect(target(mon('GLIGAR', 2, { heldItem: t('ITEM_FANG') }), day)).toBeNull();
    expect(target(mon('AIPOM', 2))).toBeNull();
    expect(target(mon('AIPOM', 2, { moves: [t('MOVE_A'), t('MOVE_B')] }))).toBe(t('A'));
    expect(target(mon('MANTYKE', 2), { ...day, partySpecies: [t('REMORAID')] })).toBe(t('A'));
    expect(target(mon('MANTYKE', 2))).toBeNull();
  });

  it('gender (pid low byte against the ratio): Burmy, Snorunt and Kirlia with the Dawn Stone', () => {
    expect(target(mon('BURMY', 20, { pid: 0 }))).toBe(t('WORMADAM'));
    expect(target(mon('BURMY', 20, { pid: 200 }))).toBe(t('MOTHIM'));
    const dawn: EvolutionTrigger = { kind: 'item', item: t('ITEM_DAWN') };
    expect(target(mon('SNORUNT', 20, { pid: 0 }), dawn)).toBe(t('FROSLASS'));
    expect(target(mon('SNORUNT', 20, { pid: 200 }), dawn)).toBeNull();
    expect(target(mon('KIRLIA', 20, { pid: 200 }), dawn)).toBe(t('GALLADE'));
    expect(target(mon('KIRLIA', 20, { pid: 0 }), dawn)).toBeNull();
  });

  it('items: only the matching item; levels never trigger item methods', () => {
    const e = mon('EEVEE', 5);
    expect(target(e, { kind: 'item', item: t('ITEM_THUNDERSTONE') })).toBe(t('THUNDER'));
    expect(target(e, { kind: 'item', item: t('ITEM_OVAL') })).toBeNull();
    expect(target(mon('SNORUNT', 50), { kind: 'item', item: t('ITEM_THUNDERSTONE') })).toBeNull();
  });

  it('Nincada: LEVEL_NINJASK at 20 (LEVEL_SHEDINJA never matches)', () => {
    expect(evolutionTarget(dex, mon('NINCADA', 20), day)).toEqual({ target: t('NINJASK'), method: 'LEVEL_NINJASK' });
    expect(target(mon('NINCADA', 19))).toBeNull();
  });

  it("Feebas: LEVEL_BEAUTY at the evolution's beauty or more, at any level", () => {
    const feebas = mon('FEEBAS', 5);
    expect(target(feebas)).toBeNull();
    feebas.condition.beauty = 169;
    expect(target(feebas)).toBeNull();
    feebas.condition.beauty = 170;
    expect(evolutionTarget(dex, feebas, day)).toEqual({ target: t('A'), method: 'LEVEL_BEAUTY' });
    expect(target(feebas, { kind: 'trade' })).toBeNull();
  });

  it('trades, and the level-up substitute (the modern option)', () => {
    expect(target(mon('SPECIES_KADABRA', 20), { kind: 'trade' })).toBe(t('A'));
    expect(target(mon('ONIX', 20), { kind: 'trade' })).toBeNull();
    expect(target(mon('ONIX', 20, { heldItem: t('ITEM_COAT') }), { kind: 'trade' })).toBe(t('A'));
    expect(target(mon('SPECIES_KADABRA', 20))).toBeNull();
    const sub: EvolutionTrigger = { ...day, tradeSubstitute: true };
    expect(target(mon('SPECIES_KADABRA', 20), sub)).toBe(t('A'));
    expect(target(mon('ONIX', 20), sub)).toBeNull();
    expect(target(mon('ONIX', 20, { heldItem: t('ITEM_COAT') }), sub)).toBe(t('A'));
    // Slowpoke: the level comes first in its table; below it, the King's Rock substitute.
    expect(target(mon('SLOWPOKE', 37, { heldItem: t('ITEM_ROCK') }), sub)).toBe(t('SLOWBRO'));
    expect(target(mon('SLOWPOKE', 30, { heldItem: t('ITEM_ROCK') }), sub)).toBe(t('SLOWKING'));
    expect(target(mon('SLOWPOKE', 30, { heldItem: t('ITEM_ROCK') }))).toBeNull();
  });

  it('the Everstone blocks levels and trades, not items, and not Kadabra; eggs never evolve', () => {
    const stone = { heldItem: t('ITEM_EVERSTONE') };
    expect(target(mon('PLAIN', 30, stone))).toBeNull();
    expect(target(mon('ONIX', 30, stone), { kind: 'trade' })).toBeNull();
    expect(target(mon('EEVEE', 5, stone), { kind: 'item', item: t('ITEM_THUNDERSTONE') })).toBe(t('THUNDER'));
    expect(target(mon('SPECIES_KADABRA', 20, stone), { kind: 'trade' })).toBe(t('A'));
    expect(target(mon('SPECIES_KADABRA', 20, stone), { ...day, tradeSubstitute: true })).toBe(t('A'));
    expect(target(mon('PLAIN', 30, { isEgg: true }))).toBeNull();
  });
});

describe('evolving', () => {
  it('evolve: species, ability from PID bit 0, stats; the form is kept (Burmy → Wormadam)', () => {
    const m = mon('PLAIN', 16, { pid: 1 });
    m.hp = 10;
    const before = m.stats.hp;
    evolve(dex, m, t('A'));
    expect([m.species, m.ability, m.form]).toEqual([t('A'), t('ABILITY_FOUR'), 0]);
    expect(m.hp).toBe(10 + m.stats.hp - before);
    const b = mon('BURMY', 20, { form: 2 });
    evolve(dex, b, t('WORMADAM'));
    expect([b.form, b.stats.defense]).toEqual([2, Math.floor(((2 * 87) * 20) / 100) + 5]);
  });

  it('movesAtLevel: the new species learns its moves at exactly the current level, in order', () => {
    const m = mon('PLAIN', 16);
    evolve(dex, m, t('A'));
    expect(movesAtLevel(dex, m)).toEqual([t('MOVE_C'), t('MOVE_D')]);
    const n = mon('PLAIN', 17);
    evolve(dex, n, t('A'));
    expect(movesAtLevel(dex, n)).toEqual([]);
  });

  it('shedinjaFrom: a copy as Shedinja, in the ball, no item, nickname or status, 1 HP, its own ability', () => {
    const m = mon('NINCADA', 20, { nickname: 'Bug', heldItem: t('ITEM_OVAL'), status: 'poison' });
    evolve(dex, m, t('NINJASK'));
    const s = shedinjaFrom(dex, m, t('SHEDINJA'), t('ITEM_POKE_BALL'));
    expect([s.species, s.ball, s.heldItem, s.nickname, s.status, s.stats.hp, s.hp, s.ability, s.level, s.exp]).toEqual([
      t('SHEDINJA'), t('ITEM_POKE_BALL'), null, null, 'none', 1, 1, t('ABILITY_WONDER'), 20, m.exp,
    ]);
    expect(s.moves).toEqual(m.moves);
    expect(s.moves).not.toBe(m.moves);
    expect([m.nickname, m.heldItem]).toEqual(['Bug', t('ITEM_OVAL')]);
  });
});
