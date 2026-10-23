/**
 * The Battle Castle and the Battle Arcade on the ROM: their imported tables, art and scripts, and the draws on them
 * (trainers, the opponent's Pokémon, the game board). The replays run in frontier-castle.rom.test.ts and
 * frontier-arcade.rom.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Prng } from '@opensinnoh/core';
import { setupPokemon, type GameState, type NewGame, type Registries } from '@opensinnoh/contracts';
import { ARCADE_EFFECT, arcadeAvailableEffects, arcadeBoard, arcadeTier, BattleArcade, BattleCastle, castleRentals } from '@opensinnoh/services';
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
  const s = g.state;
  s.party = ['GARCHOMP', 'METAGROSS', 'SALAMENCE'].map((n, i) => setupPokemon(s, g.registries, i, `platinum:SPECIES_${n}` as never, 100));
  return { state: s, registries: g.registries };
}

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Castle and Battle Arcade tables (OPENSINNOH_NDS_ROM)', () => {
  it('imports the Castle’s pools, BP, rentals and costs, and the Arcade’s board tables, pools and BP', () => {
    const f = (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.frontier!;
    expect(f.castle.opponentRanges[0]).toEqual([0, 99, 100, 119]);
    expect(f.castle.battlePoints).toEqual([0, 3, 3, 4, 4, 5, 5, 7, 7]);
    expect(f.castle.darach.map((t) => f.trainers[t]!.class)).toEqual(['platinum:TRAINER_CLASS_CASTLE_VALET', 'platinum:TRAINER_CLASS_CASTLE_VALET']);
    expect(f.castle.items).toHaveLength(27);
    expect(f.castle.items[0]).toEqual({ item: 'platinum:ITEM_KINGS_ROCK', cp: 10 });
    expect(f.castle.berries).toHaveLength(32);
    expect(castleRentals(f.castle, 'items', 2)).toHaveLength(12);
    expect(f.castle.healCosts).toEqual([10, 8, 12]);
    expect(f.castle.rankUpCosts).toEqual([
      [0, 100, 100],
      [0, 100, 150],
      [0, 50, 50],
    ]);
    expect(f.castle.art?.emblems).toHaveLength(7);
    expect(f.arcade.battlePoints).toEqual([0, 2, 2, 2, 2, 4, 4, 5, 6]);
    expect(f.arcade.dahlia.map((t) => f.trainers[t]!.class)).toEqual(['platinum:TRAINER_CLASS_ARCADE_STAR', 'platinum:TRAINER_CLASS_ARCADE_STAR']);
    expect(f.arcade.cursorTicks).toEqual([20, 16, 8, 4, 3, 2, 1, 0]);
    expect(f.arcade.categoryWeights[0]).toEqual([15, 15, 40, 30]);
    expect(f.arcade.categoryThresholds).toEqual([21, 16, 10, 5]);
    expect(f.arcade.rouletteSpeeds).toEqual([
      { round: 7, speed: 5 },
      { round: 4, speed: 4 },
      { round: 0, speed: 3 },
    ]);
    expect(f.arcade.itemPools.map((p) => p.length)).toEqual([11, 13, 11]);
    expect(f.arcade.berryPools.map((p) => p.length)).toEqual([8, 20, 10]);
    expect(f.arcade.art?.screens).toHaveLength(32);
    expect(f.scenes[11]).toMatchObject({ entry: 'platinum:FrontierBattleCastle/0' });
    expect(f.scenes[16]).toMatchObject({ entry: 'platinum:FrontierBattleArcade/0' });
  });

  it('decodes the Castle’s and the Arcade’s frontier scripts into frontier commands only', () => {
    const { pack } = romSlice();
    const labels = Object.entries(pack.scripts.labels).filter(([id]) => /^platinum:FrontierBattle(Castle|Arcade)\//.test(id));
    expect(labels.length).toBeGreaterThan(100);
    expect(labels.flatMap(([, cmds]) => cmds.map((c) => c.op)).filter((op) => !op.startsWith('fr_'))).toEqual([]);
  });

  it('draws a Castle round: 14 trainers, the first opponent’s three from its sets, Darach at the 21st', () => {
    const { state, registries } = game();
    const c = BattleCastle.init(state, registries, rand16(1), false, 0, [0, 1, 2]);
    c.loadRound(false);
    expect(new Set(c.trainers).size).toBe(14);
    c.trainers.slice(0, 6).forEach((t) => expect(t).toBeLessThan(99));
    expect(c.players.every((m) => m.level === 50 && m.heldItem === null)).toBe(true);
    c.setupOpponentsParty();
    const sets = (registries.newGame.values().next().value as NewGame).frontier!.trainers[c.trainers[0]!]!.sets;
    expect(c.opponentMons.every((m) => sets.includes(m.set))).toBe(true);
    expect(new Set(c.opponents.map((m) => m.species)).size).toBe(3);
    c.round = 2;
    c.loadRound(false);
    expect(c.trainers[6]).toBe(313);
  });

  it('lays out an Arcade board for round 1 of the effects that round allows, and applies one', () => {
    const { state, registries } = game();
    const t = (registries.newGame.values().next().value as NewGame).frontier!.arcade;
    const available = arcadeAvailableEffects(t, 0, 0);
    expect(available).not.toContain(ARCADE_EFFECT.noBattle);
    const board = arcadeBoard(t, rand16(2), available, arcadeTier(t, 0));
    expect(board.every((e) => available.includes(e))).toBe(true);
    const a = BattleArcade.init(state, registries, rand16(3), false, 0, [0, 1, 2]);
    a.loadRound(false);
    a.setupOpponentsParty();
    a.beforeBoard();
    a.setAppResult(ARCADE_EFFECT.paralyzeFoe, 0, 0);
    a.applyEffect();
    expect(a.opponents.some((m) => m.status === 'paralysis') || a.immune).toBe(true);
  });
});
