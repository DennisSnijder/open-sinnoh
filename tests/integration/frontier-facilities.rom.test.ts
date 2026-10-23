/**
 * The Battle Factory and the Battle Hall on the ROM: their imported tables and scripts, the draws on them (rentals,
 * trainers, the Hall's opponents and levels) and a streak carried from one round to the next. The replays run in
 * frontier-factory.rom.test.ts and frontier-hall.rom.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Prng, type Id } from '@opensinnoh/core';
import { setupPokemon, type GameState, type NewGame, type Registries } from '@opensinnoh/contracts';
import { BattleFactory, BattleHall, factoryState, hallOpponentPick, hallState, NEXT_BATTLE } from '@opensinnoh/services';
import { createGame, CountingStubLog } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { romSlice } from '../rom.ts';

const rand16 = (seed: number) => {
  const p = new Prng(seed);
  return () => p.next() >>> 16;
};

function game(): { state: GameState; registries: Registries } {
  const g = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
  return { state: g.state, registries: g.registries };
}

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Factory and Battle Hall tables (OPENSINNOH_NDS_ROM)', () => {
  it('imports the Factory’s pools, ranges, BP and Thorton, the Hall’s sets, opponents, ranks, milestones and Argenta', () => {
    const { pack } = romSlice();
    const f = (pack.registries.newGame as unknown as NewGame[])[0]!.frontier!;
    expect(f.factory.opponentRanges[0]).toEqual([0, 99, 100, 119]);
    expect(f.factory.level50Pools[0]).toEqual({ trainerMax: 100, setMin: 1, setMax: 150, ivs: 0, upgradable: true });
    expect(f.factory.openPlayerPools[4]).toMatchObject({ setMin: 623, setMax: 950 });
    expect(f.factory.openOpponentPools[4]).toMatchObject({ setMin: 351, setMax: 950 });
    expect(f.factory.tradeUpgrades).toEqual([6, 13, 20, 27, 34]);
    expect(f.factory.battlePoints).toEqual([0, 5, 5, 5, 5, 7, 7, 8, 9]);
    expect(f.factory.thorton.map((t) => f.trainers[t]!.class)).toEqual(['platinum:TRAINER_CLASS_FACTORY_HEAD', 'platinum:TRAINER_CLASS_FACTORY_HEAD']);
    expect(f.factory.art?.wheel).toHaveLength(4);
    expect(f.hall.sets).toHaveLength(478);
    expect(f.hall.opponents).toHaveLength(477);
    expect(f.hall.opponents[0]).toBe('platinum:SPECIES_BULBASAUR');
    expect(f.hall.opponentTypes[0]).toEqual(['platinum:TYPE_GRASS', 'platinum:TYPE_POISON']);
    expect(f.hall.groupRanges).toEqual([
      [1, 154],
      [155, 270],
      [271, 375],
      [376, 477],
    ]);
    expect(f.hall.ivs).toEqual([8, 10, 12, 14, 16, 18, 20, 22, 24, 26]);
    expect(f.hall.trainerClasses).toHaveLength(300);
    expect(f.hall.grid.slice(0, 3)).toEqual(['platinum:TYPE_NORMAL', 'platinum:TYPE_FIRE', 'platinum:TYPE_WATER']);
    expect(f.hall.grid.slice(17)).toEqual(['summary', 'summary', 'platinum:TYPE_MYSTERY']);
    expect(f.hall.battlePoints).toHaveLength(19);
    expect(f.hall.milestones).toHaveLength(47);
    expect(f.hall.milestones[0]).toEqual({ record: 10, bp: 1 });
    expect(f.hall.argenta.map((t) => f.trainers[t]!.class)).toEqual(['platinum:TRAINER_CLASS_HALL_MATRON', 'platinum:TRAINER_CLASS_HALL_MATRON']);
    // The scenes: the Factory corridor's floor stays put and runs under the room.
    expect(f.scenes[3]).toMatchObject({ entry: 'platinum:FrontierBattleFactory/0', fgFixed: true });
    expect(f.scenes[10]).toMatchObject({ entry: 'platinum:FrontierBattleHall/0' });
  });

  it('decodes the Factory’s and the Hall’s frontier scripts into frontier commands only', () => {
    const { pack } = romSlice();
    const labels = Object.entries(pack.scripts.labels).filter(([id]) => /^platinum:FrontierBattle(Factory|Hall)\//.test(id));
    expect(labels.length).toBeGreaterThan(40);
    expect(labels.flatMap(([, cmds]) => cmds.map((c) => c.op)).filter((op) => !op.startsWith('fr_'))).toEqual([]);
  });

  it('draws a Factory round: Thorton’s battles, the round’s trainers, six rentals from the round’s pool, opponents apart', () => {
    const { state, registries } = game();
    const f = BattleFactory.init(state, registries, rand16(1), 'OT', false, 0, false);
    f.loadRound(false);
    expect(new Set(f.trainers).size).toBe(14);
    f.trainers.slice(0, 6).forEach((t) => expect(t).toBeLessThan(99));
    expect(f.trainers[6]).toBeGreaterThanOrEqual(100);
    expect(f.trainers[6]).toBeLessThan(119);
    expect(f.rentals.every((m) => m.set >= 1 && m.set <= 150 && m.ivs === 0)).toBe(true);
    const tables = (registries.newGame.values().next().value as NewGame).frontier!;
    const species = f.rentals.map((m) => tables.sets[m.set]!.species);
    expect(new Set(species).size).toBe(6);
    expect(f.opponentMons.some((m) => species.includes(tables.sets[m.set]!.species))).toBe(false);
    f.streak = 20;
    expect(f.nextBattleType()).toBe(NEXT_BATTLE.silver);
  });

  it('carries a Factory streak into the next challenge: round 2’s rentals from the next pool, the trades kept', () => {
    const { state, registries } = game();
    const f = BattleFactory.init(state, registries, rand16(2), 'OT', false, 0, false);
    f.loadRound(false);
    f.incrementTrades();
    f.setAppResult([0, 1, 2]);
    f.addRentals();
    for (let i = 0; i < 7; i++) f.incrementStreak();
    f.saveOnRoundComplete();
    expect(factoryState(state).streaks[0]).toEqual({ record: 7, latest: 7, recordTrades: 1, latestTrades: 1 });
    const next = BattleFactory.init(state, registries, rand16(3), 'OT', false, 0, false);
    expect(next).toMatchObject({ streak: 7, round: 1, tradeCount: 1 });
    next.loadRound(false);
    expect(next.rentals.every((m) => m.set >= 151 && m.set <= 250 && m.ivs === 4)).toBe(true);
  });

  it('sets up a Hall battle: a trainer, an opponent of the chosen type at the level the rank gives', () => {
    const { state, registries } = game();
    state.party = [setupPokemon(state, registries, 0, 'platinum:SPECIES_GARCHOMP' as Id, 100)];
    const h = BattleHall.init(state, registries, rand16(4), false, 0, 0, 0);
    h.capRanks();
    h.setCell(1);
    h.setBaseLevel();
    h.setupNextOpponent();
    const battle = h.battleSetup();
    const tables = (registries.newGame.values().next().value as NewGame).frontier!;
    const opponent = battle.trainers[0]!.party[0]!;
    const entry = tables.hall.opponents.indexOf(opponent.species);
    expect(tables.hall.opponentTypes[entry]).toContain('platinum:TYPE_FIRE');
    // Level 100, rank 0, one type: 100 − 3·10 rounded up.
    expect(opponent.level).toBe(70);
    expect(battle.trainers[0]!.id).toBeLessThan(300);
    expect(battle.ai).toBe(0);
  });

  it('carries a Hall streak and its ranks into the next challenge; Argenta at the singles 50th', () => {
    const { state, registries } = game();
    state.party = [setupPokemon(state, registries, 0, 'platinum:SPECIES_GARCHOMP' as Id, 100)];
    const h = BattleHall.init(state, registries, rand16(5), false, 0, 0, 0);
    h.setCell(0);
    for (let i = 0; i < 10; i++) {
      h.incrementRank();
      h.incrementStreak();
    }
    h.saveOnRoundComplete();
    expect(hallState(state).active[0]).toBe(true);
    expect(hallState(state).ranks[0]![0]).toBe(10);
    const next = BattleHall.init(state, registries, rand16(6), false, 0, 0, 0);
    expect(next).toMatchObject({ streak: 10, round: 1 });
    expect(next.ranks[0]).toBe(10);
    next.streak = 49;
    next.round = 4;
    next.battle = 9;
    expect(next.nextBattleType()).toBe(NEXT_BATTLE.silver);
    next.setCell(2);
    next.setBaseLevel();
    next.setupNextOpponent();
    expect(next.trainerAt(0)).toBe(307);
    const tables = (registries.newGame.values().next().value as NewGame).frontier!;
    // The Matron's silver pick comes from the player's species' group, of any type.
    const pick = hallOpponentPick(tables.hall, rand16(7), { type: 'platinum:TYPE_WATER' as Id, rank: 9, battle: 0, playerSpecies: 'platinum:SPECIES_GARCHOMP' as Id, past: Array(20).fill(0), battleType: NEXT_BATTLE.silver });
    const group = tables.hall.groupRanges.find(([, max]) => tables.hall.opponents.indexOf('platinum:SPECIES_GARCHOMP' as Id) < max)!;
    expect(pick).toBeGreaterThanOrEqual(group[0]);
    expect(pick).toBeLessThanOrEqual(group[1]);
  });
});
