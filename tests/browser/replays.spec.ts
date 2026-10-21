/**
 * Pack replays through the app and `window.openSinnohGame` (both viewports via the Playwright projects).
 * Screenshots of the final frame go to test-artifacts/replays. `opensinnoh test <pack> --browser` runs the same replays outside
 * the Playwright test runner.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { appAvailable, mainCanvasStats, openApp, pageDriver, REPO_ROOT, waitForScene } from '../../packages/cli/src/browser.ts';
import { loadWorkspace, replayFiles } from '../../packages/cli/src/workspace.ts';

test('the recorder writes a replay that plays back to the same state', async ({ page, baseURL }) => {
  test.skip(!appAvailable(), 'no app');
  const dir = join(REPO_ROOT, 'packs', 'fixture');
  const ws = loadWorkspace(dir);
  const { registries } = loadGamePacks(ws.packs);
  const errors: string[] = [];
  await openApp(page, baseURL!, [...ws.dirs.keys()], errors);
  const live = await page.evaluate(async () => {
    const g = window.openSinnohGame!;
    await g.startRecording!();
    // The intro message, then right (turn + step) and down.
    g.advance(80);
    g.press('a');
    g.advance(2);
    g.release('a');
    g.until({ kind: 'idle' }, 100);
    g.press('right');
    g.advance(4);
    g.release('right');
    g.until({ kind: 'idle' }, 100);
    g.press('down');
    g.advance(12);
    g.release('down');
    g.until({ kind: 'idle' }, 100);
    return { text: g.recording!()!, state: g.snapshot().state };
  });
  expect(live.text).toMatch(/^# Recorded in the app/);
  expect(live.text).toContain('\n+80 press a\n+2 release a\n');
  const result = await runReplay(pageDriver(page, 'test-artifacts/replays', 'recorded'), live.text, { registries });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(live.state.player).toMatchObject({ zone: 'fixture:ROOM', x: 15, z: 18 });
  expect(errors).toEqual([]);
});

test('downloads a recorded fixture journey with map and menu milestones and replays it green', async ({ page, baseURL }, info) => {
  test.setTimeout(180_000);
  const ws = loadWorkspace(join(REPO_ROOT, 'packs', 'fixture'));
  const { registries } = loadGamePacks(ws.packs);
  const errors: string[] = [];
  await openApp(page, baseURL!, [...ws.dirs.keys()], errors);
  const driver = pageDriver(page, info.outputDir, 'recorded-journey');
  let text = '';
  let recordedState: unknown;
  const source = readFileSync(join(REPO_ROOT, 'packs/fixture/replays/starter.replay'), 'utf8') + `
+1 press x
+1 release x
+1 tap entry:2
+1 tap back
+1 tap back
until idle
`;
  const capture = await runReplay({
    ...driver,
    reset: async () => { await page.evaluate(() => window.openSinnohGame!.startRecording!()); },
    save: async () => {
      text = await page.evaluate(() => window.openSinnohGame!.recording!()!);
      recordedState = (await driver.snapshot()).state;
      await page.evaluate(() => window.openSinnohDeveloper!.open());
      const downloading = page.waitForEvent('download');
      await page.locator('#record-download').click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/\.replay$/);
      const stream = await download.createReadStream();
      let downloaded = '';
      for await (const chunk of stream!) downloaded += chunk.toString();
      expect(downloaded).toBe(text);
      await page.getByRole('button', { name: 'Close developer tools', exact: true }).click();
      return driver.save();
    },
  }, source, { registries, repeat: false });
  expect(capture.error).toBeUndefined();
  expect(text).toContain('assert map fixture:TOWN');
  expect(text).toContain('assert app start-menu');
  expect(text).toContain('tap entry:2');
  // One press/release pair represents the entire 28-tile walk.
  expect(text).toContain('release right');
  expect(text.split('\n').length).toBeLessThan(100);
  let replayedState: unknown;
  const result = await runReplay({ ...driver, save: async () => { replayedState = (await driver.snapshot()).state; return driver.save(); } }, text, { registries });
  expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
  expect(result.error).toBeUndefined();
  expect(replayedState).toEqual(recordedState);
  expect(errors).toEqual([]);
});

test('the dev recorder resets a live device clock before creating new-game state', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await page.goto(`${baseURL}/?packs=fixture&clock=2026-10-16T21:30`);
  await page.waitForFunction(() => !!window.openSinnohApp);
  await page.evaluate(() => window.openSinnohDeveloper!.open());
  await page.locator('#record-start').click();
  await expect(page.locator('#record-status')).toContainText('Recording from a new game');
  expect(await page.evaluate(() => ({ date: window.openSinnohApp!.game.state.startDate, clock: window.openSinnohApp!.game.clock() }))).toEqual({ date: '2009-03-22', clock: { date: '2009-03-22', hour: 12, minute: 0, second: 0 } });
});

for (const pack of ['fixture', 'demo-mod']) {
  const dir = join(REPO_ROOT, 'packs', pack);
  const ws = loadWorkspace(dir);
  const { registries } = loadGamePacks(ws.packs);
  for (const file of replayFiles(dir)) {
    test(`${pack}/${basename(file)}`, async ({ page, baseURL }, info) => {
      test.skip(!appAvailable(), 'the app is not there yet: no index.html');
      const errors: string[] = [];
      await openApp(page, baseURL!, [...ws.dirs.keys()], errors);
      const result = await runReplay(pageDriver(page, info.outputDir, basename(file, '.replay')), readFileSync(file, 'utf8'), { registries });
      // The replay ends with save → load, which fades in: let the fade finish before looking.
      await page.evaluate(() => (window as unknown as { openSinnohGame: { advance(n: number): void } }).openSinnohGame.advance(30));
      await waitForScene(page);
      await page.screenshot({ path: `test-artifacts/replays/${pack}-${basename(file, '.replay')}-${info.project.name}.png` });
      // The 3D scene must actually be on screen (not just a passing state machine).
      const stats = await mainCanvasStats(page);
      expect(stats.colours).toBeGreaterThan(8);
      expect(stats.litShare).toBeGreaterThan(0.1);
      expect(errors).toEqual([]);
      expect(result.error).toBeUndefined();
      expect(result.ok).toBe(true);
    });
  }
}
