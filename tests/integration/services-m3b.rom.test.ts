/**
 * Daycare and egg replays, headless (OPENSINNOH_NDS_ROM): the Solaceon Day Care
 * (deposit through the daycare party menu, exp per step, the old man's line, the fee and withdrawal), the
 * egg from the old man, and its hatching (the scene, the nickname). Each runs twice from seed 1
 * (determinism) with a save round trip; seeds 2 and 3 run once more. The checks at the `screenshot` beats
 * read the script's message and the open app's view.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBattle } from '@opensinnoh/battle';
import type { Id, PackData } from '@opensinnoh/core';
import type { HatchView, SummaryView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game, type ReplayResolver } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
export const SERVICE_REPLAYS_M3B = ['svc-daycare', 'svc-egg', 'svc-hatch'];

/** A ROM text by id, from the game's registries. */
const romText = (game: Game, id: Id) => game.registries.texts.get(id)!.text;

/** What each screenshot beat must show (the ROM's own texts). */
const BEATS: Record<string, (game: Game) => void> = {
  compatibility: (game) => expect(game.scripts.view().message?.text).toBe(romText(game, 'platinum:DayCareCommon_Text_TheTwoGetAlong')),
  'take-back': (game) => expect(game.scripts.view().menu?.entries).toEqual(['PIKACHU♀Lv. 5', 'PIKACHU♂Lv. 5', 'CANCEL']),
  'egg-summary': (game) => {
    const v = game.app() as SummaryView;
    expect(v.pages.map((p) => p.id)).toEqual(['memo']);
    expect(v.mon.egg).toBe(true);
    expect(v.mon.name).toBe('Egg');
    // 10 cycles left: "It appears to move occasionally. It may be close to hatching."
    expect(v.memo.join(' ')).toMatch(/Egg received from.*Solaceon Town.*The Egg Watch.*It appears to move/s);
  },
  'hatch-shake': (game) => expect((game.app() as HatchView).egg).toMatchObject({ frame: 2 }),
  'hatch-mon': (game) => expect(game.app()).toMatchObject({ egg: null, bars: null, showMon: true, message: { text: romText(game, 'platinum:EggHatch_Text_MonHatched').replace('{var 0}', 'PICHU') } }),
  'hatch-question': (game) => expect((game.app() as HatchView).yesNo).toMatchObject({ yes: 'Yes', no: 'No' }),
};

describe.skipIf(!romPath)('daycare and egg replays (OPENSINNOH_NDS_ROM)', () => {
  let pack: PackData;
  beforeAll(() => {
    ({ pack } = romSlice());
  }, 60_000);

  const play = (name: string, seed: number, repeat: boolean) => {
    const log = new CountingStubLog(() => {});
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, createBattle, seed, log, now: () => '2026-01-01T00:00:00.000Z' });
    const resolve: ReplayResolver = (file) => ({ name: file, text: read(file) });
    const checked: string[] = [];
    const run = runReplay(gameDriver(game), read(`${name}.replay`), {
      registries: game.registries,
      seed,
      name: `${name}.replay`,
      resolve,
      repeat,
      beforeLine: (line) => {
        if (line.action.type !== 'screenshot') return;
        const check = BEATS[line.action.name];
        if (!check) return;
        check(game);
        checked.push(line.action.name);
      },
    });
    return run.then((result) => ({ result, checked }));
  };

  for (const name of SERVICE_REPLAYS_M3B) {
    it(`${name}.replay passes twice from seed 1 with a save round trip, and on seeds 2–3`, async () => {
      const { result, checked } = await play(name, 1, true);
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
      expect(checked.length).toBeGreaterThan(0);
      for (const seed of [2, 3]) {
        const r = (await play(name, seed, false)).result;
        expect(r.error, `seed ${seed}`).toBeUndefined();
        expect(r.roundTrip, `seed ${seed}`).toBe('identical');
      }
    }, 180_000);
  }
});
