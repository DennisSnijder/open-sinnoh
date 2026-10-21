import { describe, expect, it } from 'vitest';
import { addItem, bagCount, canAddItem, emptyBag, removeItem, type BagPocket } from './bag.ts';
import type { Id } from './ids.ts';
import {
  addExp,
  calcStats,
  createPokemon,
  createRandomPokemon,
  Dex,
  evolutionTarget,
  evolve,
  expGain,
  expShares,
  gainEvs,
  genderOf,
  heal,
  isShiny,
  Lcrng,
  levelFromExp,
  maxPp,
  rollWildHeldItem,
  setDefaultMoves,
  trainerMonValues,
  uniformStats,
  type MonRegistries,
  type NatureData,
  type SpeciesData,
  type Stats,
} from './pokemon.ts';
import { Prng } from './prng.ts';

const t = (s: string) => `test:${s}` as Id;
const stats = (hp: number, attack: number, defense: number, speed: number, spAttack: number, spDefense: number): Stats => ({ hp, attack, defense, speed, spAttack, spDefense });
const zero = stats(0, 0, 0, 0, 0, 0);

function species(name: string, extra: Partial<SpeciesData> = {}): [Id, SpeciesData] {
  return [
    t(name),
    {
      baseStats: stats(50, 50, 50, 50, 50, 50),
      types: [t('TYPE_A'), t('TYPE_A')],
      catchRate: 45,
      baseExp: 64,
      evYield: { ...zero, attack: 2 },
      heldItems: { common: null, rare: null },
      genderRatio: 127,
      hatchCycles: 20,
      baseFriendship: 70,
      growthRate: t('CUBE'),
      eggGroups: [t('EGG'), t('EGG')],
      abilities: [t('ABILITY_ONE'), t('ABILITY_TWO')],
      safariFleeRate: 0,
      learnset: [],
      tms: [],
      evolutions: [],
      eggMoves: [],
      eggSpecies: t(name),
      ...extra,
    },
  ];
}

const natureList: NatureData[] = [
  { sourceIndex: 0, up: null, down: null },
  { sourceIndex: 1, up: 'attack', down: 'defense' },
  { sourceIndex: 2, up: 'attack', down: 'speed' },
  { sourceIndex: 3, up: 'attack', down: 'spAttack' },
];
const moves = ['A', 'B', 'C', 'D', 'E', 'F'].map((m, i) => [t(`MOVE_${m}`), { pp: 10 + 5 * i }] as const);
const data: MonRegistries = {
  species: new Map([
    species('LARVA', {
      learnset: ['A', 'B', 'C', 'D', 'E'].map((m, i) => ({ level: 1 + i * 3, move: t(`MOVE_${m}`) })).concat([{ level: 16, move: t('MOVE_F') }]),
      evolutions: [
        { method: 'USE_ITEM', target: t('MOTH'), item: t('ITEM_STONE') },
        { method: 'LEVEL', target: t('PUPA'), level: 16 },
      ],
    }),
    species('PUPA', { abilities: [t('ABILITY_ONE'), null], evolutions: [{ method: 'LEVEL_HAPPINESS', target: t('MOTH') }] }),
    species('MOTH'),
    species('GHOSTLING', { baseStats: stats(1, 90, 45, 40, 30, 30), genderRatio: 255 }),
  ]),
  moves: new Map(moves),
  growthRates: new Map([[t('CUBE'), { exp: Array.from({ length: 101 }, (_, n) => n ** 3) }]]),
  natures: new Map(natureList.map((n, i) => [t(`NATURE_${i}`), n])),
  items: new Map([
    [t('ITEM_STONE'), { holdEffect: 'NONE', holdParam: 0 }],
    [t('ITEM_EVERSTONE'), { holdEffect: 'NO_EVOLVE', holdParam: 0 }],
    [t('ITEM_POWER'), { holdEffect: 'LVLUP_SPEED_EV_UP', holdParam: 4 }],
    [t('ITEM_BRACE'), { holdEffect: 'EVS_UP_SPEED_DOWN', holdParam: 0 }],
  ]),
};
const dex = new Dex(data);
const trainer = { otId: 0x0001_0002, otName: 'Ari', otGender: 'male' as const };
const base = { ...trainer, ball: t('ITEM_BALL') };

describe('stats and derived values (decomp pokemon.c)', () => {
  it('Pokemon_CalcStats with the nature ×1.1 / ×0.9 and floor at each step', () => {
    // Base 108/130/95 speed 102 sp. 80/85, level 78, IVs 24/12/30 speed 5 sp. 16/23, EVs 74/190/91 speed 23 sp. 48/84, +attack −spAttack.
    const s = calcStats(stats(108, 130, 95, 102, 80, 85), 78, stats(24, 12, 30, 5, 16, 23), stats(74, 190, 91, 23, 48, 84), { up: 'attack', down: 'spAttack' });
    expect(s).toEqual(stats(289, 278, 193, 171, 135, 171));
    // Base HP 1 (the decomp's Shedinja case) is always 1.
    expect(calcStats(stats(1, 90, 45, 40, 30, 30), 50, uniformStats(31), uniformStats(252), { up: null, down: null }).hp).toBe(1);
  });

  it('nature from pid % count, gender from the low byte, shininess from the xor of halves', () => {
    expect(dex.nature(7)).toBe(natureList[3]);
    expect([genderOf(127, 126), genderOf(127, 127), genderOf(0, 0), genderOf(254, 255), genderOf(255, 0)]).toEqual(['female', 'male', 'male', 'female', 'none']);
    expect(isShiny(0x0001_0002, 0x0003_0000)).toBe(true); // 1 ^ 2 ^ 3 ^ 0 = 0
    expect(isShiny(0x0001_0002, 0x0013_0000)).toBe(false); // 1 ^ 2 ^ 0x13 = 0x10
    expect(maxPp(35, 3)).toBe(56);
    expect(levelFromExp(dex.expTable(t('CUBE')), 999)).toBe(9);
    expect(levelFromExp(dex.expTable(t('CUBE')), 1000)).toBe(10);
  });
});

describe('creation', () => {
  it('Pokemon_InitWith: base exp of the level, ability from pid bit 0, default moves dropping the oldest, full HP', () => {
    const m = createPokemon(dex, { species: t('LARVA'), level: 15, pid: 0x01, ivs: 31, ...base });
    expect([m.exp, m.level, m.ability, m.friendship]).toEqual([3375, 15, t('ABILITY_TWO'), 70]);
    expect(m.moves).toEqual(['B', 'C', 'D', 'E'].map((x) => t(`MOVE_${x}`)));
    expect(m.pp).toEqual([15, 20, 25, 30]);
    expect(m.hp).toBe(m.stats.hp);
    expect(createPokemon(dex, { species: t('PUPA'), level: 5, pid: 0x01, ivs: 0, ...base }).ability).toBe(t('ABILITY_ONE'));
    const given = createPokemon(dex, { species: t('LARVA'), level: 5, pid: 0, ivs: 0, ...base, moves: [t('MOVE_F')] });
    expect([given.moves, given.pp]).toEqual([[t('MOVE_F')], [35]]);
  });

  it('random creation is deterministic per stream; wild held items 45/50/5 (both the same = always)', () => {
    const a = createRandomPokemon(dex, new Prng(9), { species: t('MOTH'), level: 5, trainer, ball: t('ITEM_BALL'), met: { zone: null, level: 5, date: null } });
    const b = createRandomPokemon(dex, new Prng(9), { species: t('MOTH'), level: 5, trainer, ball: t('ITEM_BALL'), met: { zone: null, level: 5, date: null } });
    expect(a).toEqual(b);
    const rolls = new Map<string, number>();
    const rng = new Prng(1);
    const withItems = { ...dex.species(t('MOTH')), heldItems: { common: t('ITEM_STONE'), rare: t('ITEM_POWER') } };
    for (let i = 0; i < 10000; i++) {
      const it = String(rollWildHeldItem(withItems, rng));
      rolls.set(it, (rolls.get(it) ?? 0) + 1);
    }
    expect(Math.round(rolls.get('null')! / 100)).toBeCloseTo(45, -1);
    expect(Math.round(rolls.get(t('ITEM_STONE'))! / 100)).toBeCloseTo(50, -1);
    expect(rollWildHeldItem({ ...withItems, heldItems: { common: t('ITEM_STONE'), rare: t('ITEM_STONE') } }, rng)).toBe(t('ITEM_STONE'));
  });

  it('decomp LCRNG and the trainer-party PID (TrainerData_BuildParty)', () => {
    // LCRNG: state·1103515245 + 24691 (mod 2³²), output the high 16 bits.
    const ref = (s: bigint) => (s * 1103515245n + 24691n) & 0xffffffffn;
    const r = new Lcrng(12345);
    let s = 12345n;
    for (let i = 0; i < 5; i++) {
      s = ref(s);
      expect(r.next()).toBe(Number(s >> 16n));
    }
    // Seed = ivScale + level + species + trainer id; class times Next(); (rnd << 8) + 136 (male) / 120 (female).
    const seed = 0 + 5 + 390 + 1;
    let st = BigInt(seed);
    let rnd = 0n;
    for (let i = 0; i < 63; i++) {
      st = ref(st);
      rnd = st >> 16n;
    }
    const want = Number(((rnd << 8n) + 136n) & 0xffffffffn);
    const { pid, otId } = trainerMonValues({ ivScale: 0, level: 5, species: 390, trainer: 1, trainerClass: 63, female: false });
    expect(pid).toBe(want);
    expect(pid & 0xff).toBe(136);
    expect(isShiny(otId, pid)).toBe(false);
    expect(trainerMonValues({ ivScale: 0, level: 5, species: 390, trainer: 1, trainerClass: 0, female: true }).pid).toBe(((seed << 8) + 120) >>> 0);
  });
});

describe('growth', () => {
  it('addExp levels one level at a time, learns while there is room, reports a full move set', () => {
    const m = createPokemon(dex, { species: t('LARVA'), level: 15, pid: 0, ivs: 10, ...base });
    m.hp -= 5;
    const up = addExp(dex, m, dex.expTable(t('CUBE'))[17]! - m.exp);
    expect(up.map((u) => u.level)).toEqual([16, 17]);
    expect(up[0]!.moves).toEqual([{ move: t('MOVE_F'), result: 'full' }]);
    expect(m.level).toBe(17);
    expect(m.hp).toBe(m.stats.hp - 5); // HP follows the max-HP gain
    expect(addExp(dex, m, 10 ** 9)).toHaveLength(83);
    expect(m.exp).toBe(1000000);
  });

  it('gainEvs: yield + power item, Pokérus and Macho Brace double, 255/510 caps', () => {
    const m = createPokemon(dex, { species: t('MOTH'), level: 5, pid: 0, ivs: 0, ...base, heldItem: t('ITEM_POWER') });
    gainEvs(dex, m, { ...zero, attack: 2 });
    expect([m.evs.attack, m.evs.speed]).toEqual([2, 4]);
    m.pokerus = 0x13;
    m.heldItem = t('ITEM_BRACE');
    gainEvs(dex, m, { ...zero, attack: 2 });
    expect(m.evs.attack).toBe(10);
    m.evs = { ...zero, attack: 254, defense: 250 };
    gainEvs(dex, m, { ...zero, attack: 3, defense: 3 });
    expect([m.evs.attack, m.evs.defense]).toEqual([255, 255]);
    m.evs = { ...zero, attack: 255, defense: 254 };
    gainEvs(dex, m, { ...zero, defense: 3, speed: 3 });
    expect([m.evs.defense, m.evs.speed]).toEqual([255, 0]); // 510 reached
  });

  it('expShares and expGain (BtlCmd_CalcExpGain, the get-exp task boosts)', () => {
    expect(expShares(64, 10, 1, 0)).toEqual({ gained: 91, shared: 0 });
    expect(expShares(64, 10, 2, 1)).toEqual({ gained: 22, shared: 45 });
    expect(expGain(91, { luckyEgg: true, trainerBattle: true, outsider: 'other-language' })).toBe(346);
  });

  it('evolution checks (Pokemon_GetEvolutionTargetSpecies) and evolve', () => {
    const m = createPokemon(dex, { species: t('LARVA'), level: 16, pid: 1, ivs: 0, ...base });
    const level = { kind: 'level' as const, isNight: false, partySpecies: [] };
    expect(evolutionTarget(dex, m, level)).toEqual({ target: t('PUPA'), method: 'LEVEL' });
    expect(evolutionTarget(dex, m, { kind: 'item', item: t('ITEM_STONE') })).toEqual({ target: t('MOTH'), method: 'USE_ITEM' });
    m.heldItem = t('ITEM_EVERSTONE');
    expect(evolutionTarget(dex, m, level)).toBeNull();
    expect(evolutionTarget(dex, m, { kind: 'item', item: t('ITEM_STONE') })).not.toBeNull();
    m.heldItem = null;
    evolve(dex, m, t('PUPA'));
    expect([m.species, m.ability, m.hp]).toEqual([t('PUPA'), t('ABILITY_ONE'), m.stats.hp]);
    expect(evolutionTarget(dex, m, level)).toBeNull();
    m.friendship = 220;
    expect(evolutionTarget(dex, m, level)?.target).toBe(t('MOTH'));
  });

  it('heal restores HP, status and PP with PP Ups; setDefaultMoves adds nothing known twice', () => {
    const m = createPokemon(dex, { species: t('LARVA'), level: 4, pid: 0, ivs: 0, ...base });
    Object.assign(m, { hp: 0, status: 'burn', pp: [0, 0], ppUps: [1, 0] });
    heal(dex, m);
    expect([m.hp, m.status, m.pp]).toEqual([m.stats.hp, 'none', [12, 15]]);
    setDefaultMoves(dex, m);
    expect(m.moves).toHaveLength(2);
  });
});

describe('bag (decomp bag.c)', () => {
  const pockets: BagPocket[] = [
    { name: 'items', size: 2, max: 999, sorted: false },
    { name: 'tms', size: 3, max: 99, sorted: true },
  ];
  const order = (id: Id) => Number(id.split('_')[1]);
  it('adds to the slot or a free one, sorts sorted pockets, caps by size and max, removes emptied slots', () => {
    const bag = emptyBag(pockets);
    expect(addItem(bag, pockets[0]!, t('I_5'), 3, order)).toBe(true);
    expect(addItem(bag, pockets[0]!, t('I_2'), 1, order)).toBe(true);
    expect(addItem(bag, pockets[0]!, t('I_9'), 1, order)).toBe(false); // pocket full
    expect(addItem(bag, pockets[0]!, t('I_5'), 997, order)).toBe(false); // 1000 > 999
    expect(bag.items).toEqual([
      { item: t('I_5'), count: 3 },
      { item: t('I_2'), count: 1 },
    ]);
    addItem(bag, pockets[1]!, t('T_7'), 1, order);
    addItem(bag, pockets[1]!, t('T_3'), 1, order);
    expect(bag.tms!.map((s) => s.item)).toEqual([t('T_3'), t('T_7')]);
    expect(canAddItem(bag, pockets[1]!, t('T_3'), 98)).toBe(true);
    expect(canAddItem(bag, pockets[1]!, t('T_3'), 99)).toBe(false);
    expect(removeItem(bag, t('I_5'), 4)).toBe(false);
    expect(removeItem(bag, t('I_5'), 3)).toBe(true);
    expect([bagCount(bag, t('I_5')), bagCount(bag, t('I_2')), bag.items!.length]).toEqual([0, 1, 1]);
  });
});
