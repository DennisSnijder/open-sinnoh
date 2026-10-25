/** The Frontier's record viewer (frontier-records.ts) on the fixture pack, with stand-in texts. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, FRONTIER_FACILITY, type AppHost, type FrontierRecordsRequest, type FrontierRecordsView, type GameState, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { castleState, factoryIndex, hallState, newFrontierState } from '@opensinnoh/services';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loaded = loadGamePacks([pack]);
/** Stand-ins for the records bank (the pack's own texts are the ROM's). */
const TEXTS: Record<string, string> = {
  BattleTower: 'Tower', BattleFactory: 'Factory', BattleCastle: 'Castle', BattleHall: 'Hall', BattleArcade: 'Arcade',
  SingleRecord: 'Singles', DoubleRecord: 'Doubles', MultiRecord: 'Multis', Prev: 'LAST', Current: 'NOW', Record: 'BEST',
  MultiWithTrainer: 'With a trainer', MultiWithFriend: 'With a friend', Level50: 'Lv 50', OpenLevel: 'Open', RentalTrade: 'Swaps',
  CastlePoints: 'Points', WinStreak: 'Wins: {var 0}', MonsRecord: '{var 0}: best', Number: '{var 0}', CP: '{var 0} pts', WinStreakTemplate: 'Wins: {var 0}', GamesCleared: 'Cleared: {var 0}',
};
const registries = (() => {
  const out = Object.fromEntries(Object.entries(loaded.registries).map(([k, m]) => [k, m instanceof Map ? new Map(m) : m])) as Record<string, Map<Id, unknown>>;
  for (const [name, text] of Object.entries(TEXTS)) {
    const id = `fixture:BattleFrontierRecords_Text_${name}` as Id;
    out.texts!.set(id, { id, text });
  }
  return out as unknown as Registries;
})();
const record = [...registries.newGame.values()][0]!;
const SPECIES = 'fixture:SPECIES_MOSSLET' as Id;
const host = (): AppHost => {
  const options = { ...DEFAULT_DEVICE_OPTIONS };
  return { options: () => options, setOption: (k, v) => void (options[k] = v), save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
};
function fresh(): GameState {
  const s = newGameState(record, registries, loaded.loaded.order, 1);
  s.frontier = newFrontierState();
  return s;
}
const open = (s: GameState, request: Omit<FrontierRecordsRequest, 'app'>) => createApp({ app: 'frontier-records', ...request }, { registries, state: s, log: { stub: () => {} }, host: host() });
const lines = (v: FrontierRecordsView) => v.lines.map((l) => `${l.x},${l.y} ${l.align} ${l.text}`);

describe('Frontier records', () => {
  it('shows the Factory singles at Level 50 and Open Level, the streak flag picking CURRENT', () => {
    const s = fresh();
    s.frontier!.factory = { active: Array(8).fill(false), streaks: Array.from({ length: 8 }, () => ({ record: 0, latest: 0, recordTrades: 0, latestTrades: 0 })), save: { saved: false, challengeType: 0, openLevel: false, battle: 0, trainers: [], player: [], opponent: [] } };
    s.frontier!.factory.streaks[factoryIndex(false, 0)] = { record: 21, latest: 7, recordTrades: 3, latestTrades: 1 };
    s.frontier!.factory.active[factoryIndex(true, 0)] = true;
    const v = open(s, { facility: FRONTIER_FACILITY.factory, challengeType: 0, species: null }).view() as FrontierRecordsView;
    expect(lines(v)).toEqual([
      '24,16 left Factory',
      '232,16 right Singles',
      '16,56 left Lv 50',
      '240,56 right Swaps',
      '16,80 left LAST',
      '128,80 centre Wins:    7',
      '240,80 right    1',
      '16,96 left BEST',
      '128,96 centre Wins:   21',
      '240,96 right    3',
      '16,120 left Open',
      '16,144 left NOW',
      '128,144 centre Wins:    0',
      '240,144 right    0',
      '16,160 left BEST',
      '128,160 centre Wins:    0',
      '240,160 right    0',
    ]);
  });

  it("shows a Hall species' record and its latest streak only for the species that set it", () => {
    const s = fresh();
    const hall = hallState(s);
    hall.records[1] = { [SPECIES]: 42 };
    hall.streaks[1] = { current: 0, latest: 9, species: 'fixture:SPECIES_EMBERKIT' as Id };
    const v = open(s, { facility: FRONTIER_FACILITY.hall, challengeType: 1, species: SPECIES }).view() as FrontierRecordsView;
    expect(lines(v).slice(1)).toEqual(['232,16 right Doubles', '16,56 left Mosslet: best', '16,80 left LAST', '128,80 centre Wins:    0', '16,104 left BEST', '128,104 centre Wins:   42']);
  });

  it('shows the Castle with its Castle Points, the Tower multi with the link rows, and fades in and out', () => {
    const s = fresh();
    castleState(s).streaks[0] = { record: 14, latest: 5, cp: 120, recordCp: 300, spentCp: 0 };
    let app = open(s, { facility: FRONTIER_FACILITY.castle, challengeType: 0, species: null });
    expect(lines(app.view() as FrontierRecordsView).slice(2)).toEqual(['240,56 right Points', '16,80 left LAST', '128,80 centre Wins:    5', '240,80 right  120 pts', '16,104 left BEST', '128,104 centre Wins:   14', '240,104 right  300 pts']);
    s.frontier!.towerStreaks[2] = { record: 35, latest: 14 };
    s.frontier!.towerFlags |= 1 << (8 + 2);
    app = open(s, { facility: FRONTIER_FACILITY.tower, challengeType: 2, species: null });
    expect(lines(app.view() as FrontierRecordsView).filter((l) => l.startsWith('16,') || l.includes('Wins'))).toEqual([
      '16,56 left With a trainer',
      '16,80 left NOW',
      '128,80 centre Wins:   14',
      '16,96 left BEST',
      '128,96 centre Wins:   35',
      '16,120 left With a friend',
      '16,144 left LAST',
      '128,144 centre Wins:    0',
      '16,160 left BEST',
      '128,160 centre Wins:    0',
    ]);
    // 18 frames in (A does nothing yet), then A and 6 frames out.
    const step = (pressed: 'a' | null) => app.step({ held: pressed ? [pressed] : [], pressed: pressed ? [pressed] : [], touch: null });
    expect((app.view() as FrontierRecordsView).black).toBe(16);
    for (let i = 0; i < 17; i++) expect(step(i === 3 ? 'a' : null)).toBeNull();
    expect((app.view() as FrontierRecordsView).black).toBeGreaterThan(0);
    expect(step(null)).toBeNull();
    expect((app.view() as FrontierRecordsView).black).toBe(0);
    expect(step('a')).toBeNull();
    let result = null;
    for (let i = 0; i < 10 && !result; i++) result = step(null);
    expect(result).toEqual({ app: 'frontier-records' });
  });
});
