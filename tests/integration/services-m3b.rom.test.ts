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
import { ENGLISH, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type HatchView, type SummaryView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game, type ReplayResolver } from '@opensinnoh/game';
import { createApp, MenuText } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const dir = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
export const SERVICE_REPLAYS_M3B = ['svc-daycare', 'svc-egg', 'svc-hatch'];

/** A ROM text by id, from the game's registries. */
const romText = (game: Game, id: Id) => game.registries.texts.get(id)!.text;

/** A species' name, from the game's registries. */
const speciesName = (game: Game, species: string) => game.registries.species.get(`platinum:SPECIES_${species}` as Id)!.name;

/** What each screenshot beat must show (the ROM's own texts). */
const BEATS: Record<string, (game: Game) => void> = {
  compatibility: (game) => expect(game.scripts.view().message?.text).toBe(romText(game, 'platinum:DayCareCommon_Text_TheTwoGetAlong')),
  'take-back': (game) => {
    // The menu's entries (bank 361, 134–136) with buffer_daycare_nickname_level_gender's slots: name, level, gender mark.
    const menu = new MenuText(game.registries);
    const pikachu = speciesName(game, 'PIKACHU');
    expect(game.scripts.view().menu?.entries).toEqual([
      menu.text('platinum:MenuEntries_Text_DayCare_Pokemon1' as Id, pikachu, '5', '♀'),
      menu.text('platinum:MenuEntries_Text_DayCare_Pokemon2' as Id, pikachu, '5', '♂'),
      menu.text('platinum:MenuEntries_Text_DayCare_Cancel' as Id),
    ]);
  },
  'egg-summary': (game) => {
    const v = game.app() as SummaryView;
    expect(v.pages.map((p) => p.id)).toEqual(['memo']);
    expect(v.mon.egg).toBe(true);
    expect(v.mon.name).toBe(speciesName(game, 'EGG'));
    // Received in Solaceon Town; 10 cycles left: the Egg Watch's "close to hatching" (summary bank message 106).
    const watch = new MenuText(game.registries).message('pl_msg_00000455_00106').split('\n');
    expect(v.memo.join('\n')).toContain(game.registries.zones.get('platinum:MAP_HEADER_SOLACEON_TOWN' as Id)!.name);
    expect(v.memo.slice(-watch.length)).toEqual(watch);
    if (dexOf(game.registries).language === ENGLISH) expect(v.memo.join(' ')).toMatch(/Egg received from.*Solaceon Town.*The Egg Watch.*It appears to move/s);
  },
  'hatch-shake': (game) => expect((game.app() as HatchView).egg).toMatchObject({ frame: 2 }),
  'hatch-mon': (game) => expect(game.app()).toMatchObject({ egg: null, bars: null, showMon: true, message: { text: romText(game, 'platinum:EggHatch_Text_MonHatched').replace('{var 0}', 'PICHU') } }),
  'hatch-question': (game) => {
    const menu = new MenuText(game.registries);
    expect((game.app() as HatchView).yesNo).toMatchObject({ yes: menu.t('hatchYes'), no: menu.t('hatchNo') });
  },
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
