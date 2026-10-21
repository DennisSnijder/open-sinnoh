/**
 * M5 step 0 in the app (OPENSINNOH_NDS_ROM; desktop): the Jubilife tag battle runs to its end with four battlers
 * on screen. The page starts at CP4's cached chain anchor and plays
 * tests/rom-replays/m5-tag-jubilife.replay after its `from` line through `window.openSinnohGame`. The prefix's
 * headless battle history is carried across the save, preserving all cumulative battle assertions. The
 * screenshot at the battle goes to test-artifacts (ROM content, never commit).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { BattleView } from '@opensinnoh/contracts';
import { CountingStubLog, createGame, runReplay } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { freshRomPage } from './rom-context.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { fromChainAnchor } from './replay-anchor.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

test.skip(({ isMobile }) => isMobile, 'desktop only');

let page: Page;
test.beforeEach(async ({ browser }, info) => {
  test.setTimeout(600_000);
  page = await freshRomPage(browser, info.project.use);
});
test.afterEach(async () => { await page?.close(); });


test('the Jubilife tag battle (type 75) runs to its end in the app', async ({ browserName: _ }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = pageDriver(page, join(import.meta.dirname, '../../test-artifacts/m5-tag-jubilife'), 'desktop');
  const { pack } = romSlice();
  const { registries } = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
  // Four battlers drawn while the battle waits for the player (the replay's screenshot beat).
  const seen: BattleView[] = [];
  const replay = await fromChainAnchor(driver, 'm5-tag-jubilife.replay');
  const result = await runReplay(replay.driver, replay.text, {
    registries,
    seed: 1,
    name: 'm5-tag-jubilife.replay',
    repeat: false,
    async beforeLine(line) {
      if (line.action.type === 'screenshot') seen.push((await page.evaluate(() => window.openSinnohGame!.battleView())) as BattleView);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.screenshots).toHaveLength(1);
  expect(seen[0]!.topology).toBe('ai-partner');
  expect(seen[0]!.battlers.map((b) => [b.battler, b.owner, b.visible])).toEqual([
    [0, 'player', true],
    [1, 'enemy', true],
    [2, 'partner', true],
    [3, 'enemy2', true],
  ]);
  expect(await sceneDrawn(page)).toBe(true);
  expect(errors).toEqual([]);
});

/** The page is back on the field with a drawn canvas after the battle. */
function sceneDrawn(page: Page): Promise<boolean> {
  return page.evaluate(() => !window.openSinnohGame!.snapshot().battle && !!document.querySelector('canvas'));
}
