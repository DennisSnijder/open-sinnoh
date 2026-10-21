/**
 * The Battle Frontier on the ROM: the Battle Frontier's imported tables and scripts, and the Battle Tower's
 * selection rules on them. The replays run in frontier-*.rom.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, NewGame, Registries } from '@opensinnoh/contracts';
import { BattleTower, newFrontierState } from '@opensinnoh/services';
import { createGame, CountingStubLog } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { romSlice } from '../rom.ts';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Frontier tables (OPENSINNOH_NDS_ROM)', () => {
  it('imports the scenes, the 315 trainers and 951 sets, the tower tables and the exchange counters', () => {
    const { pack } = romSlice();
    const f = (pack.registries.newGame as unknown as NewGame[])[0]!.frontier!;
    expect(f.trainers).toHaveLength(315);
    expect(f.sets).toHaveLength(951);
    // FRONTIER_SCENE_TOWER_CORRIDOR (5) and _BATTLE_ROOM (7): their scripts and rooms.
    expect(f.scenes[5]).toMatchObject({ entry: 'platinum:FrontierBattleTowerCorridor/0' });
    expect(f.scenes[7]).toMatchObject({ entry: 'platinum:FrontierBattleTowerBattleRoom/0' });
    expect(f.scenes[7]!.bg).not.toBeNull();
    expect(f.scenes.slice(0, 3)).toEqual([null, null, null]);
    // Palmer (305, 306) and the first partner (Cheryl, 300).
    expect(f.tower.palmer).toEqual([305, 306]);
    expect(f.tower.partners).toBe(300);
    expect(f.trainers[305]!.class).toBe('platinum:TRAINER_CLASS_TOWER_TYCOON');
    // soloBattlePoints and the reserved items (sBattleTowerReservedItems: BrightPowder first).
    expect(f.tower.battlePoints).toEqual([0, 3, 3, 4, 4, 5, 5, 7]);
    expect(f.tower.reservedItems[0]).toBe('platinum:ITEM_BRIGHTPOWDER');
    expect(f.prices.find((p) => p.item === 'platinum:ITEM_PROTEIN')?.bp).toBe(1);
    expect(f.banlist).toContain('platinum:SPECIES_MEWTWO');
    expect(f.judgeMessages).toHaveLength(6);
    expect(pack.registries.marts!.map((m) => m.id)).toEqual(expect.arrayContaining(['platinum:MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_LEFT', 'platinum:MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_RIGHT']));
  });

  it('decodes the frontier scripts into the IR (the tower files reach no unknown command)', () => {
    const { pack } = romSlice();
    const tower = Object.entries(pack.scripts.labels).filter(([id]) => /^platinum:FrontierBattleTower/.test(id));
    expect(tower.length).toBeGreaterThan(20);
    expect(tower.flatMap(([, cmds]) => cmds.map((c) => c.op)).filter((op) => !op.startsWith('fr_'))).toEqual([]);
  });

  it('draws Palmer at the singles 21st and 49th opponents and fills a challenge without repeats', () => {
    const { pack } = romSlice();
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
    const state: GameState = game.state;
    const registries: Registries = game.registries;
    state.frontier = newFrontierState();
    const t = BattleTower.init(state, registries, false, 0);
    expect(t.trainerFor(2, 6)).toBe(305);
    expect(t.trainerFor(6, 6)).toBe(306);
    t.seedChallenge();
    t.chooseTrainers();
    const seven = t.trainers.slice(0, 7);
    expect(new Set(seven).size).toBe(7);
    // Room 0: opponents 1–6 from trainers 0–99, the seventh from the boss range.
    for (const id of seven.slice(0, 6)) expect(id).toBeLessThan(100);
  });
});

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Battle Frontier: entering the tower (OPENSINNOH_NDS_ROM)', () => {
  frontierReplay('sys-tower-enter');
});
