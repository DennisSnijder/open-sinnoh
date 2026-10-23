/**
 * The Battle Castle's and the Battle Arcade's rules (battle-castle.ts, battle-arcade.ts) on the fixture pack, with
 * original frontier tables: the fixture's species, a set each, a few trainers, a small rental list and board tables.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Prng, readPackFolder, type Id } from '@opensinnoh/core';
import { setupPokemon, type BattleArcadeTables, type BattleCastleTables, type FrontierSetData, type FrontierTables, type GameState, type NewGame, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import {
  ARCADE_CATEGORY,
  ARCADE_EFFECT,
  arcadeAvailableEffects,
  arcadeBoard,
  arcadeCategory,
  arcadePerformance,
  arcadeRandomCategory,
  arcadeState,
  arcadeTier,
  BattleArcade,
  BattleCastle,
  castlePoints,
  castleRank,
  castleRentals,
  castleState,
  castleTrainerFor,
  deleteCastleStreak,
  NEXT_BATTLE,
  pickCastleTrainers,
  raiseCastleRank,
  receiveCastlePoints,
  spendCastlePoints,
} from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loaded = loadGamePacks([pack]);
const SPECIES = ['MOSSLET', 'EMBERKIT', 'DRIPLING', 'SKYLET', 'BURROWBIT', 'MOSSGROVE'].map((n) => `fixture:SPECIES_${n}` as Id);
const ITEMS = ['LAMP_OIL', 'TONIC', 'CAPTURE_ORB', 'STILL_STONE', 'BONUS_ORB', 'CALM_LEAF'].map((n) => `fixture:ITEM_${n}` as Id);
const NAME = 'fixture:Text_Class_Hiker' as Id;
const CLASS = 'fixture:TRAINER_CLASS_HIKER' as Id;

const sets: FrontierSetData[] = [{ species: 'fixture:SPECIES_NONE' as Id, form: 0, moves: [], evFlags: 0, nature: 'fixture:NATURE_EVEN' as Id, item: null }, ...SPECIES.map((species, i) => ({ species, form: 0, moves: ['fixture:MOVE_BOP' as Id], evFlags: 0b11, nature: `fixture:NATURE_${['EVEN', 'FIERCE', 'STURDY', 'SWIFT', 'CLEVER'][i % 5]}` as Id, item: ITEMS[i]! }))];
const ranges = Array.from({ length: 8 }, () => [0, 12, 12, 20] as [number, number, number, number]);
const castle: BattleCastleTables = {
  opponentRanges: ranges,
  battlePoints: [0, 3, 3, 4, 4, 5, 5, 7, 7],
  darach: [30, 31],
  items: ITEMS.slice(0, 4).map((item, i) => ({ item, cp: 10 + i * 5 })),
  berries: ITEMS.slice(4).map((item) => ({ item, cp: 2 })),
  itemsByRank: [2, 2, 4],
  berriesByRank: [1, 1, 2],
  healCosts: [10, 8, 12],
  rankUpCosts: [
    [0, 100, 100],
    [0, 100, 150],
    [0, 50, 50],
  ],
  art: null,
};
// The ROM's board tables (decomp battle_arcade_app main.c), the item pools shortened to the fixture's items.
const arcade: BattleArcadeTables = {
  opponentRanges: ranges,
  battlePoints: [0, 2, 2, 2, 2, 4, 4, 5, 6],
  dahlia: [32, 33],
  rouletteSpeeds: [
    { round: 7, speed: 5 },
    { round: 4, speed: 4 },
    { round: 0, speed: 3 },
  ],
  cursorTicks: [20, 16, 8, 4, 3, 2, 1, 0],
  effectsByRound: [126, 69, 69, 69, 112, 112, 71, 120, 126, 126, 69, 69, 69, 112, 112, 71, 120, 126, 70, 70, 70, 70, 104, 104, 127, 71, 127, 112, 120, 112, 127, 64],
  effectsByBattle: [63, 63, 63, 63, 21, 42, 42],
  categoryWeights: [
    [15, 15, 40, 30],
    [35, 20, 30, 15],
    [30, 30, 35, 5],
    [25, 40, 30, 5],
    [10, 75, 10, 5],
  ],
  categoryThresholds: [21, 16, 10, 5],
  performance: {
    status: [8, 6, 4, 0, 0],
    fainted: [6, 4, 2, 0, 0],
    turns: [
      { turns: 3, score: 10 },
      { turns: 5, score: 6 },
      { turns: 7, score: 4 },
      { turns: 9, score: 2 },
      { turns: 10, score: 0 },
    ],
  },
  itemPools: [ITEMS.slice(0, 2), ITEMS.slice(2, 4), ITEMS.slice(4)],
  berryPools: [ITEMS.slice(1, 3), ITEMS.slice(3, 5), ITEMS.slice(5)],
  art: null,
};

const registries = (() => {
  const out = Object.fromEntries(Object.entries(loaded.registries).map(([k, m]) => [k, m instanceof Map ? new Map(m) : m])) as Record<string, Map<Id, unknown>>;
  const record = [...out.newGame!.values()][0] as NewGame;
  const trainers = Array.from({ length: 34 }, () => ({ class: CLASS, className: NAME, name: NAME, sets: [1, 2, 3, 4, 5, 6] }));
  const frontier = { scenes: [], trainers, sets, trainerMessages: 'fixture:none' as Id, tower: { classObjects: [{ class: CLASS, gfx: 7 }], defaultObject: 3 }, banlist: [], castle, arcade } as unknown as FrontierTables;
  out.newGame!.set(record.id, { ...record, frontier });
  return out as unknown as Registries;
})();
const record = [...registries.newGame.values()][0]!;
const fresh = (): GameState => {
  const s = newGameState(record, registries, loaded.loaded.order, 1);
  s.party = SPECIES.slice(0, 3).map((sp, i) => setupPokemon(s, registries, i, sp, 60));
  s.party[0]!.heldItem = ITEMS[5]!;
  return s;
};
const rand16 = (seed: number) => {
  const p = new Prng(seed);
  return () => p.next() >>> 16;
};

describe('Battle Castle rules', () => {
  it('draws Darach at the singles 21st and 49th battles and 14 different trainers a round', () => {
    const r = rand16(1);
    expect(castleTrainerFor(ranges, castle.darach, r, 0, 2, 6)).toBe(30);
    expect(castleTrainerFor(ranges, castle.darach, r, 0, 6, 6)).toBe(31);
    expect(castleTrainerFor(ranges, castle.darach, r, 1, 2, 6)).toBeGreaterThanOrEqual(12);
    const trainers = pickCastleTrainers(ranges, castle.darach, r, 0, 0);
    expect(new Set(trainers).size).toBe(14);
    expect(trainers.slice(0, 6).every((t) => t < 12)).toBe(true);
  });

  it('starts a streak with 10 CP, its items taken, levels brought to 50; spends and receives CP within 0–9999', () => {
    const s = fresh();
    const c = BattleCastle.init(s, registries, rand16(2), false, 0, [0, 1, 2]);
    expect(castlePoints(s, 0)).toBe(10);
    expect(c.players.map((m) => [m.level, m.heldItem])).toEqual([
      [50, null],
      [50, null],
      [50, null],
    ]);
    spendCastlePoints(s, 0, 25);
    expect(castlePoints(s, 0)).toBe(0);
    expect(castleState(s).streaks[0]!.spentCp).toBe(25);
    receiveCastlePoints(s, registries, 0, 20000);
    expect(castlePoints(s, 0)).toBe(9999);
    raiseCastleRank(s, 0, 1, 100);
    expect(castleRank(s, 0, 1)).toBe(2);
    expect(castlePoints(s, 0)).toBe(9899);
    expect(castleRentals(castle, 'items', 2)).toHaveLength(2);
    expect(castleRentals(castle, 'items', 3)).toHaveLength(4);
    deleteCastleStreak(s, 0);
    expect(castlePoints(s, 0)).toBe(0);
    expect(castleState(s).ranks[0]).toEqual([1, 1, 1]);
  });

  it('pays CP for a battle: standing, HP left, no status, little PP used, opponents raised 5 levels', () => {
    const s = fresh();
    const c = BattleCastle.init(s, registries, rand16(3), false, 0, [0, 1, 2]);
    c.loadRound(false);
    c.setupOpponentsParty();
    // Untouched: 3 × (3 standing + 3 full HP + 1 no status) + 8 (no PP used).
    expect(c.cpFromBattle()).toBe(29);
    c.players[0]!.hp = 0;
    c.players[1]!.hp = Math.floor(c.players[1]!.stats.hp / 2);
    c.players[1]!.status = 'burn';
    c.players[2]!.pp[0]! -= 6;
    c.unlocked.level[0] = 'up';
    // 0 + (3 + 2) + (3 + 3 + 1) + 6 (6 PP) + 7 (one raised).
    expect(c.cpFromBattle()).toBe(25);
    expect(c.monFainted).toBe(true);
    c.prepForNextBattle();
    expect(c.players[0]!.hp).toBe(1);
    expect(c.players[1]!.status).toBe('none');
    expect(c.unlocked.level[0]).toBe('none');
  });

  it('keeps HP, PP and status through a REST save and gives the entered Pokémon their items back', () => {
    const s = fresh();
    const c = BattleCastle.init(s, registries, rand16(4), false, 1, [0, 1, 2]);
    c.loadRound(false);
    c.setupOpponentsParty();
    c.players[0]!.hp = 7;
    c.players[1]!.heldItem = ITEMS[2]!;
    c.battle = 2;
    c.save(2);
    const again = BattleCastle.init(s, registries, rand16(5), true, 0, [0, 0, 0]);
    again.loadRound(true);
    expect(again).toMatchObject({ challengeType: 1, battle: 2 });
    expect(again.players[0]!.hp).toBe(7);
    expect(again.players[1]!.heldItem).toBe(ITEMS[2]);
    expect(again.opponentMons.map((m) => m.set)).toEqual(c.opponentMons.map((m) => m.set));
    s.party[0]!.heldItem = null;
    again.restoreHeldItems();
    expect(s.party[0]!.heldItem).toBe(ITEMS[5]);
  });

  it('records the streak and its CP on a round, and Darach’s BP', () => {
    const s = fresh();
    const c = BattleCastle.init(s, registries, rand16(6), false, 0, [0, 1, 2]);
    c.loadRound(false);
    for (let i = 0; i < 7; i++) c.incrementStreak();
    c.saveOnRoundComplete();
    expect(castleState(s).streaks[0]).toMatchObject({ record: 7, latest: 7, recordCp: 10 });
    expect(castleState(s).active[0]).toBe(true);
    expect(c.earnedBp()).toBe(3);
    c.streak = 20;
    expect(c.nextBattleType()).toBe(NEXT_BATTLE.silver);
    c.streak = 21;
    expect(c.earnedBp()).toBe(20);
  });
});

describe('Battle Arcade rules', () => {
  it('offers each round’s effects, the battle-gated ones on their battles only', () => {
    const first = arcadeAvailableEffects(arcade, 0, 0);
    expect(first).toContain(ARCADE_EFFECT.poisonFoe);
    expect(first).not.toContain(ARCADE_EFFECT.lowerFoeHp);
    expect(first).toContain(ARCADE_EFFECT.speedUp);
    // GET_1_BP: rounds 4–7, battles 1, 3, 5; NO_BATTLE and GET_3_BP on 2, 4, 6; none on the seventh.
    expect(arcadeAvailableEffects(arcade, 3, 21)).toContain(ARCADE_EFFECT.get1Bp);
    expect(arcadeAvailableEffects(arcade, 3, 22)).not.toContain(ARCADE_EFFECT.get1Bp);
    expect(arcadeAvailableEffects(arcade, 6, 43)).toEqual(expect.arrayContaining([ARCADE_EFFECT.noBattle, ARCADE_EFFECT.get3Bp]));
    expect(arcadeAvailableEffects(arcade, 6, 48)).not.toContain(ARCADE_EFFECT.speedUp);
    expect(arcadeAvailableEffects(arcade, 9, 9999)).not.toContain(ARCADE_EFFECT.noBattle);
  });

  it('weights the categories by the last battle’s performance (the odds over many boards)', () => {
    expect(arcadeTier(arcade, 25)).toBe(0);
    expect(arcadeTier(arcade, 12)).toBe(2);
    expect(arcadeTier(arcade, 0)).toBe(4);
    const r = rand16(7);
    const n = 20000;
    for (const tier of [0, 4]) {
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) counts[arcadeRandomCategory(arcade, r, tier)]!++;
      counts.forEach((c, cat) => expect(Math.abs(c / n - arcade.categoryWeights[tier]![cat]! / 100)).toBeLessThan(0.015));
    }
  });

  it('fills the board with the round’s effects of the drawn categories', () => {
    const available = arcadeAvailableEffects(arcade, 2, 15);
    const board = arcadeBoard(arcade, rand16(8), available, 1);
    expect(board).toHaveLength(16);
    expect(board.every((e) => available.includes(e))).toBe(true);
    expect(arcadeCategory(ARCADE_EFFECT.sunny)).toBe(ARCADE_CATEGORY.env);
    expect(arcadeCategory(ARCADE_EFFECT.get3Bp)).toBe(ARCADE_CATEGORY.bonus);
  });

  it('scores a battle by status, fainted Pokémon and turns', () => {
    const s = fresh();
    const party = s.party.map((m) => structuredClone(m));
    expect(arcadePerformance(arcade, party, 2)).toBe(8 + 6 + 10);
    party[0]!.hp = 0;
    party[1]!.status = 'poison';
    expect(arcadePerformance(arcade, party, 6)).toBe(6 + 4 + 4);
    expect(arcadePerformance(arcade, party, 12)).toBe(6 + 4);
  });

  it('applies effects to the battle only: lowered HP, status with immunities, items, levels undone after', () => {
    const s = fresh();
    const a = BattleArcade.init(s, registries, rand16(9), false, 0, [0, 1, 2]);
    a.loadRound(false);
    a.setupOpponentsParty();
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.lowerAllyHp, 0, 5);
    a.applyEffect();
    const max = a.players[0]!.stats.hp;
    const lowered = max - (Math.trunc(max * 1.2) - max);
    expect(a.players[0]!.hp).toBe(lowered);
    expect(a.battleSetup().party[0]!.hp).toBe(lowered);
    expect(a.players[0]!.hp).toBe(max);
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.allyGetItem, 0, 3);
    a.applyEffect();
    expect(a.players.every((m) => m.heldItem === ITEMS[1])).toBe(true);
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.allyLevelUp, 0, 0);
    a.applyEffect();
    expect(a.players[0]!.level).toBe(53);
    a.battleSetup();
    a.cleanupBattle({ party: a.players.map((m) => structuredClone(m)), enemy: a.opponents, turns: 4, won: true });
    expect(a.players[0]!.level).toBe(50);
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.sleepFoe, 0, 4);
    a.applyEffect();
    expect(a.opponents.filter((m) => m.status === 'sleep')).toHaveLength(1);
    expect(a.battleSetup().sleep?.enemy.some((n) => n >= 2 && n <= 5)).toBe(true);
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.trickRoom, 0, 0);
    a.applyEffect();
    expect(a.battleSetup().weather).toBe('trickroom');
    a.setAppResult(ARCADE_EFFECT.speedUp, 0, 0);
    a.applyEffect();
    expect(a.speed).toBe(4);
  });

  it('swaps the parties for SWAP_MONS and keeps its own Pokémon’s items from the enemy side', () => {
    const s = fresh();
    const a = BattleArcade.init(s, registries, rand16(10), false, 0, [0, 1, 2]);
    a.loadRound(false);
    a.setupOpponentsParty();
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.swapMons, 0, 0);
    a.applyEffect();
    const battle = a.battleSetup();
    expect(battle.party.map((m) => m.species)).toEqual(a.opponents.map((m) => m.species));
    expect(battle.trainers[0]!.party.map((m) => m.species)).toEqual(a.players.map((m) => m.species));
    const enemy = battle.trainers[0]!.party;
    enemy[1]!.heldItem = ITEMS[3]!;
    a.cleanupBattle({ party: battle.party, enemy, turns: 3, won: true });
    expect(a.players[1]!.heldItem).toBe(ITEMS[3]);
  });

  it('saves the board’s speed and the items through REST, and the round’s streak', () => {
    const s = fresh();
    const a = BattleArcade.init(s, registries, rand16(11), false, 0, [0, 1, 2]);
    a.loadRound(false);
    a.players[2]!.heldItem = ITEMS[0]!;
    a.speed = 6;
    a.battle = 4;
    a.save(2);
    const again = BattleArcade.init(s, registries, rand16(12), true, 1, [0, 0, 0]);
    again.loadRound(true);
    expect(again).toMatchObject({ speed: 6, battle: 4 });
    expect(again.players[2]!.heldItem).toBe(ITEMS[0]);
    for (let i = 0; i < 7; i++) again.incrementStreak();
    again.saveOnRoundComplete();
    expect(arcadeState(s).streaks[0]).toEqual({ record: 7, latest: 7 });
    expect(again.earnedBp()).toBe(2);
  });
});
