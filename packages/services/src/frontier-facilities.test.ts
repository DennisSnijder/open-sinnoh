/**
 * The Battle Factory's and the Battle Hall's rules (battle-factory.ts, battle-hall.ts) on the fixture pack, with
 * original frontier tables: twelve species (the fixture's and clones), a set each, a few trainers, small pools.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Prng, readPackFolder, type Id } from '@opensinnoh/core';
import { setupPokemon, type BattleFactoryTables, type BattleHallTables, type FrontierSetData, type FrontierTables, type GameState, type NewGame, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import {
  BattleFactory,
  BattleHall,
  deleteFactoryStreak,
  factoryIndex,
  factoryPicks,
  factoryState,
  factoryTrainerFor,
  fxSqrt,
  hallOpponentLevel,
  hallOpponentPick,
  hallPartyEligible,
  hallRecordKeeper,
  hallSpeciesWithRecords,
  hallState,
  hallTotalSinglesRecord,
  NEXT_BATTLE,
} from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loaded = loadGamePacks([pack]);
const BASE = ['MOSSLET', 'EMBERKIT', 'DRIPLING', 'SKYLET', 'BURROWBIT', 'MOSSGROVE'].map((n) => `fixture:SPECIES_${n}` as Id);
const CLONES = Array.from({ length: 6 }, (_, i) => `test:SPECIES_CLONE_${i}` as Id);
const SPECIES = [...BASE, ...CLONES];
const ITEMS = ['LAMP_OIL', 'TONIC', 'CAPTURE_ORB', 'STILL_STONE', 'BONUS_ORB', 'CALM_LEAF', 'SPARK_CHARM', 'SMOKE_PUFF', 'SHARE_CHARM', 'LUCKY_CHARM', 'WAKE_DROPS', 'GROW_CANDY'].map((n) => `fixture:ITEM_${n}` as Id);
const TYPES = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'FLYING', 'GROUND'].map((n) => `fixture:TYPE_${n}` as Id);
const NAME = 'fixture:Text_Class_Hiker' as Id;
const CLASSES = ['fixture:TRAINER_CLASS_HIKER', 'fixture:TRAINER_CLASS_TWINS'] as Id[];

/** Set 0 a placeholder, then a set per species (its own item), at both ends of each pool. */
const sets: FrontierSetData[] = [{ species: 'fixture:SPECIES_NONE' as Id, form: 0, moves: [], evFlags: 0, nature: 'fixture:NATURE_EVEN' as Id, item: null }, ...SPECIES.map((species, i) => ({ species, form: 0, moves: ['fixture:MOVE_BOP' as Id], evFlags: 0b11, nature: `fixture:NATURE_${['EVEN', 'FIERCE', 'STURDY', 'SWIFT', 'CLEVER'][i % 5]}` as Id, item: ITEMS[i]! }))];
const pool = (trainerMax: number, setMin: number, setMax: number, ivs: number, upgradable = true) => ({ trainerMax, setMin, setMax, ivs, upgradable });
const factory: BattleFactoryTables = {
  // Trainers 0–11 for battles 1–6 (and the partner side's), 12–19 for the seventh, in every round.
  opponentRanges: Array.from({ length: 8 }, () => [0, 12, 12, 20] as [number, number, number, number]),
  level50Pools: [pool(4, 1, 12, 0), pool(8, 1, 12, 4), pool(12, 1, 12, 8), pool(14, 1, 12, 12), pool(16, 1, 12, 16), pool(18, 1, 12, 20), pool(20, 1, 12, 24), pool(30, 1, 12, 31, false), pool(31, 1, 12, 12, false), pool(32, 1, 12, 31, false)],
  openOpponentPools: Array.from({ length: 10 }, (_, i) => pool(4 + i * 3, 1, 12, i * 2)),
  openPlayerPools: Array.from({ length: 10 }, (_, i) => pool(4 + i * 3, 1, 12, i * 2)),
  tradeUpgrades: [6, 13, 20, 27, 34],
  battlePoints: [0, 5, 5, 5, 5, 7, 7, 8, 9],
  thorton: [30, 31],
  art: null,
};
const hall: BattleHallTables = {
  sets,
  opponents: SPECIES,
  opponentTypes: SPECIES.map((_, i) => [TYPES[i % 6]!, TYPES[(i + 1) % 6]!]),
  rankRanges: Array.from({ length: 10 }, () => [1, 12] as [number, number]),
  groupRanges: [
    [1, 3],
    [4, 6],
    [7, 9],
    [10, 12],
  ],
  ivs: [8, 10, 12, 14, 16, 18, 20, 22, 24, 26],
  trainerClasses: Array.from({ length: 10 }, (_, i) => CLASSES[i % 2]!),
  classesByRank: Array.from({ length: 10 }, () => [...CLASSES, ...CLASSES, ...CLASSES, ...CLASSES]),
  classesByCell: Array.from({ length: 18 }, () => [...CLASSES, ...CLASSES]),
  grid: [...TYPES, ...TYPES, ...TYPES.slice(0, 5), 'summary', 'summary', TYPES[0]!],
  battlePoints: [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 6, 6, 8, 8, 10, 10, 12],
  milestones: [
    { record: 10, bp: 1 },
    { record: 30, bp: 3 },
    { record: 50, bp: 5 },
  ],
  argenta: [32, 33],
  art: null,
};

const registries = (() => {
  const out = Object.fromEntries(Object.entries(loaded.registries).map(([k, m]) => [k, m instanceof Map ? new Map(m) : m])) as Record<string, Map<Id, unknown>>;
  const base = out.species!.get(BASE[0]!) as object;
  CLONES.forEach((id, i) => out.species!.set(id, { ...base, id, sourceIndex: 10 + i }));
  const record = [...out.newGame!.values()][0] as NewGame;
  const trainers = Array.from({ length: 34 }, (_, i) => ({ class: CLASSES[i % 2]!, className: NAME, name: NAME, sets: [1, 2, 3] }));
  const frontier = { scenes: [], trainers, sets, trainerMessages: 'fixture:none' as Id, tower: { classObjects: [{ class: CLASSES[0]!, gfx: 7 }], defaultObject: 3 }, banlist: [], factory, hall } as unknown as FrontierTables;
  out.newGame!.set(record.id, { ...record, frontier });
  return out as unknown as Registries;
})();
const record = [...registries.newGame.values()][0]!;
const fresh = (): GameState => newGameState(record, registries, loaded.loaded.order, 1);
/** Decomp LCRNG_Next's shape (a u16) on a seeded stream. */
const rand16 = (seed: number) => {
  const p = new Prng(seed);
  return () => p.next() >>> 16;
};

describe('Battle Factory rules', () => {
  it('draws Thorton at the singles 21st and 49th battles, the round ranges otherwise (the seventh from its own)', () => {
    const r = rand16(1);
    expect(factoryTrainerFor(factory, r, 0, 2, 6)).toBe(30);
    expect(factoryTrainerFor(factory, r, 0, 6, 6)).toBe(31);
    expect(factoryTrainerFor(factory, r, 1, 2, 6)).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < 20; i++) expect(factoryTrainerFor(factory, r, 0, 0, 2)).toBeLessThan(12);
  });

  it('picks sets with no species or item twice, nor one excluded; the last ones from the next pool past the trade counts', () => {
    const r = rand16(2);
    const picks = factoryPicks(factory, sets, r, { pools: factory.level50Pools, index: 0 }, 6, 0, []);
    expect(new Set(picks.map((p) => sets[p.set]!.species)).size).toBe(6);
    expect(picks.every((p) => p.ivs === 0)).toBe(true);
    const excluded = picks.map((p) => ({ species: sets[p.set]!.species, item: sets[p.set]!.item }));
    const others = factoryPicks(factory, sets, r, { pools: factory.level50Pools, index: 0 }, 3, 0, excluded);
    expect(others.some((o) => excluded.some((e) => e.species === sets[o.set]!.species))).toBe(false);
    // 7 trades: past 6, below 13 → one upgraded pick (the last), from pool 1 (IVs 4).
    expect(factoryPicks(factory, sets, r, { pools: factory.level50Pools, index: 0 }, 6, 7, []).map((p) => p.ivs)).toEqual([0, 0, 0, 0, 0, 4]);
    expect(factoryPicks(factory, sets, r, { pools: factory.level50Pools, index: 0 }, 6, 40, []).map((p) => p.ivs)).toEqual([0, 4, 4, 4, 4, 4]);
  });

  it('runs a round: six rentals, three picked, the opponents apart from them, the battle, the round saved', () => {
    const s = fresh();
    const f = BattleFactory.init(s, registries, rand16(3), 'RENTAL', false, 0, false);
    f.loadRound(false);
    expect(f.players).toHaveLength(6);
    expect(f.players.every((m) => m.level === 50 && m.otName === 'RENTAL')).toBe(true);
    expect(f.opponentMons).toHaveLength(3);
    f.incrementTrades();
    f.setAppResult([4, 0, 2]);
    f.addRentals();
    expect(f.players.map((m) => m.species)).toEqual([4, 0, 2].map((i) => sets[f.rentals[i]!.set]!.species));
    const rentalSpecies = f.rentals.map((m) => sets[m.set]!.species);
    expect(f.opponents.some((m) => rentalSpecies.includes(m.species))).toBe(false);
    const battle = f.battleSetup();
    expect(battle).toMatchObject({ facility: 'factory', ai: 0 });
    expect(battle.trainers[0]!.party).toHaveLength(3);
    // Seven wins: the round is saved with its streak, the trades and the flag; BP for round 1.
    for (let i = 0; i < 7; i++) {
      f.incrementStreak();
      f.battle++;
    }
    f.saveOnRoundComplete();
    const st = factoryState(s);
    expect(st.active[factoryIndex(false, 0)]).toBe(true);
    expect(st.streaks[0]).toEqual({ record: 7, latest: 7, recordTrades: 1, latestTrades: 1 });
    expect(f.earnedBp()).toBe(5);
    expect(f.round).toBe(1);
  });

  it('offers the beaten trainer’s Pokémon in a trade and counts it', () => {
    const s = fresh();
    const f = BattleFactory.init(s, registries, rand16(4), 'RENTAL', false, 0, false);
    f.loadRound(false);
    f.setAppResult([0, 1, 2]);
    f.addRentals();
    const beaten = f.opponents.map((m) => m.species);
    f.setupNextOpponent();
    expect(f.rentals.map((m) => sets[m.set]!.species)).toEqual(beaten);
    const used = [...f.players, ...f.opponents].map((m) => m.species);
    expect(f.opponentMons.some((m) => used.includes(sets[m.set]!.species))).toBe(false);
    f.setAppResult([1, 2]);
    f.applyTrade();
    expect(f.players[1]!.species).toBe(beaten[2]);
    expect(f.tradeCount).toBe(1);
    f.setAppResult([0xff, 0]);
    f.applyTrade();
    expect(f.tradeCount).toBe(1);
  });

  it('resumes a REST save with the same parties; a quit without saving ends the streak', () => {
    const s = fresh();
    const f = BattleFactory.init(s, registries, rand16(5), 'RENTAL', false, 1, true);
    f.loadRound(false);
    f.setAppResult([0, 1, 2]);
    f.addRentals();
    expect(f.players.every((m) => m.level === 100)).toBe(true);
    f.battle = 3;
    f.save(2);
    const again = BattleFactory.init(s, registries, rand16(6), 'RENTAL', true, 0, false);
    again.loadRound(true);
    expect(again).toMatchObject({ challengeType: 1, openLevel: true, battle: 3 });
    expect(again.players.map((m) => [m.species, m.pid])).toEqual(f.players.map((m) => [m.species, m.pid]));
    expect(again.opponents.map((m) => m.pid)).toEqual(f.opponents.map((m) => m.pid));
    factoryState(s).active[factoryIndex(true, 1)] = true;
    deleteFactoryStreak(s, 1, true);
    expect(factoryState(s).active[factoryIndex(true, 1)]).toBe(false);
  });

  it('marks Thorton’s battles and their BP in singles only', () => {
    const s = fresh();
    const f = BattleFactory.init(s, registries, rand16(7), 'RENTAL', false, 0, false);
    f.streak = 20;
    expect(f.nextBattleType()).toBe(NEXT_BATTLE.silver);
    f.streak = 21;
    expect(f.earnedBp()).toBe(20);
    f.streak = 48;
    expect(f.nextBattleType()).toBe(NEXT_BATTLE.gold);
  });
});

describe('Battle Hall rules', () => {
  it('levels the opponent from the player’s level, its square root, the rank and the types battled', () => {
    expect(fxSqrt(50)).toBe(28963);
    expect(hallOpponentLevel(50, fxSqrt(50), 0, 1)).toBe(29);
    expect(hallOpponentLevel(50, fxSqrt(50), 9, 1)).toBe(42);
    expect(hallOpponentLevel(30, fxSqrt(30), 0, 1)).toBe(14);
    expect(hallOpponentLevel(100, fxSqrt(100), 9, 18)).toBe(97);
    // Never above the player's level.
    expect(hallOpponentLevel(30, fxSqrt(30), 9, 18)).toBe(30);
  });

  it('picks an opponent of the chosen type, not the player’s species nor one fought this round', () => {
    const r = rand16(8);
    const past = Array<number>(20).fill(0);
    for (let battle = 0; battle < 4; battle++) {
      const pick = hallOpponentPick(hall, r, { type: TYPES[1]!, rank: 0, battle, playerSpecies: SPECIES[1]!, past, battleType: NEXT_BATTLE.normal });
      expect(hall.opponentTypes[pick - 1]).toContain(TYPES[1]);
      expect(hall.opponents[pick - 1]).not.toBe(SPECIES[1]);
      past[battle * 2] = pick;
    }
    // The Matron's gold battle: group 4.
    expect(hallOpponentPick(hall, r, { type: TYPES[1]!, rank: 0, battle: 0, playerSpecies: SPECIES[0]!, past: Array(20).fill(0), battleType: NEXT_BATTLE.gold })).toBeGreaterThanOrEqual(10);
  });

  it('enters one Pokémon of level 30 or more, two of one species for doubles', () => {
    const s = fresh();
    s.party = [setupPokemon(s, registries, 0, BASE[0]!, 29)];
    expect(hallPartyEligible(s, registries, 1)).toBe(false);
    s.party.push(setupPokemon(s, registries, 1, BASE[1]!, 30));
    expect(hallPartyEligible(s, registries, 1)).toBe(true);
    expect(hallPartyEligible(s, registries, 2)).toBe(false);
    s.party.push(setupPokemon(s, registries, 2, BASE[1]!, 40));
    expect(hallPartyEligible(s, registries, 2)).toBe(true);
  });

  it('pays the record keeper’s milestones once', () => {
    expect(hallRecordKeeper(hall, 0, 0)).toMatchObject({ response: 0, bp: 0 });
    expect(hallRecordKeeper(hall, 35, 0)).toMatchObject({ next: 2, response: 1, bp: 4, passed: 30, upcoming: 50 });
    expect(hallRecordKeeper(hall, 35, 2)).toMatchObject({ next: 2, response: 2, bp: 0 });
    expect(hallRecordKeeper(hall, 60, 3)).toMatchObject({ response: 3, bp: 0 });
  });

  it('runs a battle: the cell’s rank, the opponent’s level, a rank up, the record on a loss', () => {
    const s = fresh();
    s.party = [setupPokemon(s, registries, 0, BASE[2]!, 50)];
    const h = BattleHall.init(s, registries, rand16(9), false, 0, 0, 0);
    h.capRanks();
    h.setCell(1);
    h.setBaseLevel();
    h.setupNextOpponent();
    const battle = h.battleSetup();
    expect(battle).toMatchObject({ facility: 'hall', ai: 0 });
    expect(battle.trainers[0]!.party[0]!.level).toBe(29);
    expect(hall.opponentTypes.findIndex((t, i) => t.includes(TYPES[1]!) && SPECIES[i] === battle.trainers[0]!.party[0]!.species)).toBeGreaterThanOrEqual(0);
    h.incrementRank();
    h.incrementStreak();
    h.battle++;
    expect(h.beatenRank()).toBe(1);
    h.saveOnLoss();
    expect(hallState(s).ranks[0]!.every((r) => r === 0)).toBe(true);
    expect(hallState(s).streaks[0]).toEqual({ current: 1, latest: 1, species: BASE[2] });
    expect(h.updateWinRecord()).toBe(true);
    expect(hallState(s).records[0]).toEqual({ [BASE[2]!]: 1 });
    expect(hallTotalSinglesRecord(s)).toBe(1);
    expect(hallSpeciesWithRecords(s)).toBe(1);
  });

  it('sends every type back to rank 9 once all are at 10', () => {
    const s = fresh();
    s.party = [setupPokemon(s, registries, 0, BASE[2]!, 50)];
    const h = BattleHall.init(s, registries, rand16(10), false, 0, 0, 0);
    h.ranks = h.ranks.map(() => 10);
    h.capRanks();
    expect(h.ranks.slice(0, 17).every((r) => r === 9)).toBe(true);
  });
});
