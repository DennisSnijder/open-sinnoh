/**
 * The Frontier's record viewer on the real ROM (OPENSINNOH_NDS_ROM): sys-frontier-records after the Hall singles
 * challenge, the Hall's record list and the singles record (moved to Lucario) in the app, sampled per tick; and the
 * replay on seeds 1–3.
 */
import { describe, expect, it } from 'vitest';
import type { FrontierRecordsView, NewGame, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { frontierReplay } from './frontier-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Frontier records (OPENSINNOH_NDS_ROM)', () => {
  it("imports the records app's art, lists Lucario under JKL and shows its singles record", async () => {
    const { pack } = romSlice();
    const art = (pack.registries.newGame as unknown as NewGame[])[0]!.frontier!.recordsArt!;
    const sheet = (pack.registries.ui2d as unknown as Ui2dSheet[]).find((s) => s.id === art)!;
    expect(sheet.cells[0]).toMatchObject({ w: 256 });
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log, now: () => '2009-03-22T12:00:00Z' });
    const views: FrontierRecordsView[] = [];
    const menus: string[][] = [];
    const tick = game.tick.bind(game);
    game.tick = () => {
      tick();
      const v = game.app();
      if (v?.app === 'frontier-records') views.push(structuredClone(v));
      const m = game.scripts.view().menu;
      if (m && JSON.stringify(menus.at(-1)) !== JSON.stringify(m.entries)) menus.push(m.entries);
    };
    const result = await runReplay(gameDriver(game), readReplay('sys-frontier-records.replay'), { name: 'sys-frontier-records.replay', resolve: resolveReplay, registries: game.registries, seed: 1, repeat: false });
    expect(result.error).toBeUndefined();
    const text = (name: string) => game.registries.texts.get(`platinum:${name}` as Id)!.text;
    const lucario = game.registries.species.get('platinum:SPECIES_LUCARIO' as Id)!.name;
    expect(menus).toContainEqual(['Single', 'Double', 'Multi', 'Cancel'].map((w) => text(`BattleFrontierRecords_Text_${w}`)));
    expect(menus).toContainEqual([lucario, text('MenuEntries_Text_ListMenu_Exit')]);
    const shown = views.find((v) => v.black === 0)!;
    expect(shown.bg).toBe(art);
    // The Hall, the challenge, the Pokémon's record (its name in the line), PREV and RECORD, each with the streak of 1.
    const lines = shown.lines.map((l) => l.text);
    expect(lines).toHaveLength(7);
    expect([lines[0], lines[1], lines[3], lines[5]]).toEqual(['BattleHall', 'SingleRecord', 'Prev', 'Record'].map((w) => text(`BattleFrontierRecords_Text_${w}`)));
    expect(lines[2]).toContain(lucario);
    for (const streak of [lines[4]!, lines[6]!]) expect(streak).toMatch(/\s1$/);
    expect(views[0]!.black).toBe(16);
  }, 600_000);

  frontierReplay('sys-frontier-records');
});
