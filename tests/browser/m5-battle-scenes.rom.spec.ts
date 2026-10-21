/** Background selection and rendered battle boards; no ROM image goldens. */
import { expect, test } from '@playwright/test';
import { CountingStubLog, createGame, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { battleSceneStats } from './canvas.ts';
import type { Id } from '@opensinnoh/core';

const rooms = ['AARON', 'BERTHA', 'FLINT', 'LUCIAN', 'CYNTHIA'] as const;
test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test('League battles retain their individual backgrounds and terrain through the intro', async ({ page }, info) => {
  test.setTimeout(600_000);
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, seed: 1, log: new CountingStubLog(() => {}) });
  const setup = await runReplay(gameDriver(game), [
    'party 0 platinum:SPECIES_EMPOLEON 100 platinum:MOVE_SURF',
    'set var platinum:VAR_PLAYER_HOUSE_SPECIAL_PROGRAM_STATE 1',
    'warp platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F 4 6 down',
    'until idle',
  ].join('\n'), { registries: game.registries, repeat: false });
  expect(setup.error).toBeUndefined();
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  expect(game.canSave()).toBe(true);
  const initial = JSON.parse(saveToJson(game.save()));
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate(() => window.openSinnohApp!.game.loadBattleEngine());
  for (const name of rooms) {
    const champion = name === 'CYNTHIA';
    const save = structuredClone(initial);
    save.state.player = { zone: `platinum:MAP_HEADER_POKEMON_LEAGUE_${champion ? 'CHAMPION' : name}_ROOM`, x: 8, z: champion ? 16 : 8, y: 0, facing: 'up' };
    save.state.objects = [];
    save.state.mapFeatures = null;
    await page.evaluate(json => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify(save));
    const trainer = `platinum:TRAINER_${champion ? 'CHAMPION' : 'ELITE_FOUR'}_${name}` as Id;
    const beat = await page.evaluate(id => {
      const g = window.openSinnohGame!;
      window.openSinnohApp!.game.world.startBattle({ kind: 'trainer', trainers: [id], wild: [] });
      let ticks = 0;
      for (; ticks < 2000 && g.battleView()?.prompt?.kind !== 'command'; ticks++) g.advance(1);
      return { ticks, view: g.battleView() };
    }, trainer);
    expect(beat.view?.prompt?.kind).toBe('command');
    expect(beat.view?.background).toBe(`platinum:BACKGROUND_${name}`);
    expect(beat.view?.terrain).toBe(`platinum:TERRAIN_${name}`);
    await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const pixels = await battleSceneStats(page);
    expect(pixels.colours, name).toBeGreaterThan(32);
    expect(pixels.lit, name).toBeGreaterThan(0.1);
    console.log(`${name}: command at ${beat.ticks} ticks, ${pixels.colours} colours`);
    await page.screenshot({ path: `test-artifacts/visual-audit-m5/${info.project.name}-battle-${name}.png` });
  }
  expect(errors).toEqual([]);
});
