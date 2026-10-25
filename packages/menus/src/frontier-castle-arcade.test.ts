/** The Battle Castle's apps (frontier-castle.ts) and the Battle Arcade's board (frontier-arcade.ts) on the fixture pack. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, setupPokemon, type AppHost, type AppModel, type ArcadeView, type BattleArcadeTables, type BattleCastleTables, type CastleView, type FrontierTables, type GameState, type NewGame, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { castlePoints, castleRank, castleState, noUnlocks, receiveCastlePoints } from '@opensinnoh/services';
import { createApp } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const loaded = loadGamePacks([pack]);
const SPECIES = ['MOSSLET', 'EMBERKIT', 'DRIPLING'].map((n) => `fixture:SPECIES_${n}` as Id);
const ITEMS = ['LAMP_OIL', 'TONIC', 'CAPTURE_ORB', 'STILL_STONE'].map((n) => `fixture:ITEM_${n}` as Id);
const castle = { items: ITEMS.slice(0, 3).map((item, i) => ({ item, cp: 10 + i })), berries: [{ item: ITEMS[3]!, cp: 2 }], itemsByRank: [2, 2, 3], berriesByRank: [1, 1, 1], healCosts: [10, 8, 12], rankUpCosts: [[0, 100, 100], [0, 100, 150], [0, 50, 50]], art: null } as unknown as BattleCastleTables;
// Every effect available in every round and battle; one tier that always picks the environment.
const arcade = { cursorTicks: [20, 16, 8, 4, 3, 2, 1, 0], effectsByRound: Array(32).fill(127), effectsByBattle: Array(7).fill(127), categoryWeights: [[0, 0, 100, 0]], categoryThresholds: [], art: null } as unknown as BattleArcadeTables;
const registries = (() => {
  const out = Object.fromEntries(Object.entries(loaded.registries).map(([k, m]) => [k, m instanceof Map ? new Map(m) : m])) as Record<string, Map<Id, unknown>>;
  const record = [...out.newGame!.values()][0] as NewGame;
  out.newGame!.set(record.id, { ...record, frontier: { castle, arcade } as unknown as FrontierTables });
  return out as unknown as Registries;
})();
const record = [...registries.newGame.values()][0]!;
function fresh(): GameState {
  const s = newGameState(record, registries, loaded.loaded.order, 1);
  castleState(s);
  return s;
}
function host(): AppHost {
  const options = { ...DEFAULT_DEVICE_OPTIONS };
  return { options: () => options, setOption: (k, v) => void (options[k] = v), save: () => {}, fieldMoveCheck: () => null, useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
}
function press(app: AppModel, ...buttons: Button[]) {
  let result = null;
  for (const b of buttons) {
    result = app.step({ held: [b], pressed: [b], touch: null }) ?? result;
    result = app.step({ held: [], pressed: [], touch: null }) ?? result;
  }
  return result;
}
const party = (s: GameState) => SPECIES.map((sp, i) => setupPokemon(s, registries, i, sp, 50));

describe('Battle Castle apps', () => {
  it('heals a Pokémon for CP, refuses what does nothing, and rents an item at the rank', () => {
    const s = fresh();
    receiveCastlePoints(s, registries, 0, 30);
    const p = party(s);
    p[1]!.hp = 3;
    const app = createApp({ app: 'castle', mode: 'self', challengeType: 0, party: p, opponents: party(s), unlocked: noUnlocks() }, { registries, state: s, log: { stub: () => {} }, host: host() });
    let v = app.view() as CastleView;
    expect(v).toMatchObject({ panel: 'main', cursor: 0, menu: null });
    // Slot 1: HEAL, RESTORE HP (10 CP), YES.
    press(app, 'right', 'a');
    expect((app.view() as CastleView).menu?.window).toBe('options');
    press(app, 'a');
    v = app.view() as CastleView;
    expect(v.menu?.window).toBe('heal');
    expect(v.menu?.entries.map((e) => e.enabled)).toEqual([true, false, false, true, true]);
    press(app, 'a', 'a');
    for (let i = 0; i < 5 && (app.view() as CastleView).sparkle; i++) press(app);
    expect(castlePoints(s, 0)).toBe(20);
    press(app, 'a');
    expect((app.view() as CastleView).mons[1]!.hp).toBe((app.view() as CastleView).mons[1]!.maxHp);
    // Again: no benefit, no CP spent.
    press(app, 'a', 'a', 'a', 'a');
    expect((app.view() as CastleView).message).toBeTruthy();
    expect(castlePoints(s, 0)).toBe(20);
    press(app, 'a', 'b', 'down', 'a');
    // RENTAL, ITEMS: the rank 1 refusal; BERRIES: the one berry (2 CP).
    v = app.view() as CastleView;
    expect(v.menu?.window).toBe('rental');
    press(app, 'a');
    v = app.view() as CastleView;
    expect(v.panel).toBe('items');
    expect(v.items?.entries).toHaveLength(2);
    press(app, 'a');
    expect((app.view() as CastleView).panel).toBe('items');
    press(app, 'a');
    for (let i = 0; i < 5 && (app.view() as CastleView).sparkle; i++) press(app);
    expect(castlePoints(s, 0)).toBe(18);
    press(app, 'a', 'down', 'a');
    const result = press(app);
    expect(result).toBeNull();
    const done = press(app, 'down', 'a') as { app: 'castle'; party: { heldItem: Id | null }[] } | null;
    expect(done?.app).toBe('castle');
    expect(done!.party[1]!.heldItem).toBe(ITEMS[3]);
  });

  it('raises a rank for its CP, and refuses without enough', () => {
    const s = fresh();
    receiveCastlePoints(s, registries, 0, 120);
    const app = createApp({ app: 'castle', mode: 'self', challengeType: 0, party: party(s), opponents: party(s), unlocked: noUnlocks() }, { registries, state: s, log: { stub: () => {} }, host: host() });
    press(app, 'a', 'a', 'up', 'up', 'a', 'a');
    expect(castleRank(s, 0, 0)).toBe(2);
    expect(castlePoints(s, 0)).toBe(20);
    press(app, 'a', 'up', 'up', 'a', 'a');
    expect(castleRank(s, 0, 0)).toBe(2);
    expect((app.view() as CastleView).message).toBeTruthy();
  });

  it('identifies an opponent, levels it 5 up and back, and buys its stats', () => {
    const s = fresh();
    receiveCastlePoints(s, registries, 0, 20);
    const app = createApp({ app: 'castle', mode: 'opponent', challengeType: 0, party: party(s), opponents: party(s), unlocked: noUnlocks() }, { registries, state: s, log: { stub: () => {} }, host: host() });
    expect((app.view() as CastleView).mons.every((m) => m.hidden)).toBe(true);
    press(app, 'a', 'a', 'a', 'a');
    expect((app.view() as CastleView).mons[0]!.hidden).toBe(false);
    expect(castlePoints(s, 0)).toBe(19);
    // LEVEL, +5, YES.
    press(app, 'a', 'down', 'a', 'a', 'a', 'a');
    expect((app.view() as CastleView).mons[0]!.level).toBe(55);
    // LEVEL, -5 (15 CP): back to 50.
    press(app, 'a', 'a', 'down', 'a', 'a', 'a');
    expect((app.view() as CastleView).mons[0]!.level).toBe(50);
    expect(castlePoints(s, 0)).toBe(3);
    // SUMMARY, SUMMARY (2 CP), YES: the stats panel.
    press(app, 'a', 'down', 'a', 'a', 'a');
    expect((app.view() as CastleView).panel).toBe('summary');
    expect((app.view() as CastleView).lines?.length).toBeGreaterThan(10);
    // The bought stats raise the slot's first flag (decomp UpdateFlagSprites), not its moves flag or another slot's.
    expect((app.view() as CastleView).mons.map((m) => m.flags)).toEqual([{ stats: true, moves: false }, { stats: false, moves: false }, { stats: false, moves: false }]);
    const done = press(app, 'b', 'b', 'down', 'a') as { unlocked: { identity: boolean[]; stats: boolean[]; level: string[] } } | null;
    expect(done?.unlocked.identity[0]).toBe(true);
    expect(done?.unlocked.stats[0]).toBe(true);
    expect(done?.unlocked.level[0]).toBe('none');
  });
});

describe('Battle Arcade board', () => {
  const open = (s: GameState, randomCursor = false) => createApp({ app: 'arcade', challengeType: 0, round: 1, streak: 8, performance: 30, speed: 3, randomCursor, party: party(s), opponents: party(s) }, { registries, state: s, log: { stub: () => {} }, host: host() });
  const tick = (app: AppModel, n = 1, frame: Partial<Parameters<AppModel['step']>[0]> = {}) => {
    let r = null;
    for (let i = 0; i < n; i++) r = app.step({ held: [], pressed: [], touch: null, ...frame }) ?? r;
    return r;
  };

  it('turns the panels over, runs the cursor a step every 4 ticks at speed 3, and stops on a tap', () => {
    const s = fresh();
    const app = open(s);
    expect((app.view() as ArcadeView).tiles.every((t) => !t.visible)).toBe(true);
    tick(app, 26 + 1 + 10);
    expect((app.view() as ArcadeView).tiles[0]!.anim).toBe(32);
    tick(app, 72);
    let v = app.view() as ArcadeView;
    expect(v.button).toBe(0);
    expect(v.tiles.every((t) => t.anim >= 18 && t.anim <= 26)).toBe(true);
    const start = v.cursor!;
    tick(app, 8);
    expect((app.view() as ArcadeView).cursor).toBe((start + 2) % 16);
    tick(app, 1, { tap: 'stop' });
    v = app.view() as ArcadeView;
    expect(v.button).toBe(1);
    const at = v.cursor!;
    const result = tick(app, 40) as { app: 'arcade'; effect: number; cursor: number } | null;
    expect(result).toMatchObject({ app: 'arcade', cursor: at });
    expect(result!.effect).toBe(v.tiles[at]!.anim);
  });

  it('stops by itself after 30 seconds; A stops it too', () => {
    const s = fresh();
    const app = open(s);
    expect(tick(app, 26 + 11 + 72 + 900 + 40)).toMatchObject({ app: 'arcade' });
    const again = open(fresh(), true);
    tick(again, 26 + 11 + 72);
    tick(again, 1, { pressed: ['a'] });
    expect((again.view() as ArcadeView).button).toBe(1);
  });
});
