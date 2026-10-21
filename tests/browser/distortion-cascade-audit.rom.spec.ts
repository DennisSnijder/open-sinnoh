/** Local waterfall audit beside a reference video. No ROM image goldens. */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CountingStubLog, createGame, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { mainCanvasStats } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
// An audit probe (docs/research/visual-audit-m5.md), not a regression gate: run it with OPENSINNOH_AUDIT=1.
test.skip(!process.env.OPENSINNOH_AUDIT, 'audit probe: set OPENSINNOH_AUDIT=1');
test('B4F ceiling and descending waterfall draw during traversal', async ({ page }, info) => {
  test.setTimeout(600_000);
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
  const replay = readFileSync(new URL('../rom-replays/dw-b4f.replay', import.meta.url), 'utf8');
  const prefix = replay.split('+0 press right\nuntil state player.y 2719.5 400')[0]!;
  const result = await runReplay(gameDriver(game), prefix, { registries: game.registries, repeat: false });
  expect(result.error).toBeUndefined();
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  expect(game.canSave()).toBe(true);
  expect(game.state.player).toMatchObject({ x: 104, z: 76 });
  const save = saveToJson(game.save());
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate(json => window.openSinnohGame!.load(json), save);
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  for (const [name, ticks] of [['ceiling', 0], ['cascade-start', 16], ['cascade-middle', 40]] as const) {
    await page.evaluate(n => {
      const g = window.openSinnohGame!;
      if (n === 16) g.press('right');
      g.advance(n);
      g.release('right');
    }, ticks);
    await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(async () => (await mainCanvasStats(page)).colours, { timeout: 120_000 }).toBeGreaterThan(100);
    const pixels = await mainCanvasStats(page);
    const state = await page.evaluate(() => {
      const snapshot = window.openSinnohGame!.snapshot();
      const distortion = window.openSinnohApp!.game.world.view().distortion!;
      return { player: snapshot.state.player, fade: snapshot.fade, app: snapshot.app,
        orientation: distortion.orientation, roll: distortion.roll.cur, floors: distortion.floors.length };
    });
    console.log(`${name}: ${JSON.stringify(state)}, ${pixels.colours} colours`);
    await page.screenshot({ path: `test-artifacts/visual-audit-m5/${info.project.name}-${name}.png` });
    expect(pixels.colours).toBeGreaterThan(100);
  }
});
