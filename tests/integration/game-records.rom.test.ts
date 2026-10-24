/**
 * Game records the field counts (decomp PlayerAvatar_IncrementStepsRecord: RECORD_STEPS; Field_UpdateDaycare:
 * RECORD_EGGS_HATCHED) and the Villa's order form gates that read them (check_met_furniture_requirements: the
 * Chandelier at 300,000 steps, the Masterpiece at 30 eggs hatched; docs/research/villa-journal.md §1.2).
 */
import { describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const FILE = 'sys-game-records.replay';
const newGame = (seed: number) =>
  createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('game records (OPENSINNOH_NDS_ROM)', () => {
  it('the order form lists the Masterpiece and the Chandelier only once their records reach the gate', async () => {
    // The replay up to each of its two order forms: one step and one hatch short of the gates, then past them.
    const lines = readReplay(FILE).split('\n');
    const menus = lines.flatMap((l, i) => (l.startsWith('until menu') ? [i + 1] : []));
    const entries = async (end: number) => {
      const game = newGame(1);
      const r = await runReplay(gameDriver(game), lines.slice(0, end).join('\n') + '\n', { name: FILE, registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });
      expect(r.error).toBeUndefined();
      return { names: game.snapshot().view.menu!.entries, game };
    };
    const before = await entries(menus[0]!);
    expect(before.game.state.records.counts).toMatchObject({ 0: 299999, 11: 29 });
    expect(before.names).toHaveLength(11);
    const after = await entries(menus[1]!);
    expect(after.game.state.records.counts).toMatchObject({ 0: 300001, 11: 30 });
    expect(after.names).toHaveLength(13);
    expect(after.names.slice(0, 11)).toEqual(before.names);
    // The two new rows are the Masterpiece (type 17) and the Chandelier (type 19, the replay buys it from the last row).
  }, 120_000);

  for (const seed of [1, 2, 3])
    it(`${FILE}: twice on seed ${seed}, save round trip`, async () => {
      const game = newGame(seed);
      const result = await runReplay(gameDriver(game), readReplay(FILE), { name: FILE, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 300_000);
});
