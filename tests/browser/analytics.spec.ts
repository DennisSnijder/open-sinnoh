/**
 * Anonymous analytics in the game (telemetry/analytics.ts): requests to PostHog are intercepted (nothing leaves
 * the machine). The test build opts in with `window.openSinnohTestAnalytics`; without it, and under Do Not Track or
 * Global Privacy Control, nothing is sent. Events carry only their allowed properties, and analytics writes no
 * cookie and no storage. Fixture pack and the ROM page; no ROM needed.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fakeImports, fakeImportWorker, fakeRom, importDone } from './fake-import.ts';
import { skipSetup } from './intro.ts';
import { saveGame } from './save.ts';

interface Sent {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

const COMMON = ['site', 'version', 'device', 'installed', 'viewport', '$cookieless_mode', '$process_person_profile', '$host', '$raw_user_agent', '$timezone'];

/** Records every PostHog request of the context (answered as PostHog would, CORS included). */
async function intercept(context: BrowserContext): Promise<Sent[]> {
  const sent: Sent[] = [];
  await context.route(/^https:\/\/[^/]*\.posthog\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') sent.push(JSON.parse(req.postData()!) as Sent);
    await route.fulfill({ status: 200, body: '{"status":"Ok"}', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
  });
  return sent;
}

const optIn = (page: Page) => page.addInitScript(() => ((window as { openSinnohTestAnalytics?: boolean }).openSinnohTestAnalytics = true));

/** Analytics' own traces in the browser: none allowed (the app's own settings keys are not analytics). */
const traces = (page: Page) =>
  page.evaluate(async () => ({
    cookie: document.cookie,
    local: Object.keys(localStorage).filter((k) => /posthog|^ph_|analytic|distinct/i.test(k)),
    session: Object.keys(sessionStorage).filter((k) => /posthog|^ph_|analytic|distinct/i.test(k)),
    dbs: (await indexedDB.databases()).map((d) => d.name).filter((n) => /posthog|analytic/i.test(n ?? '')),
  }));

test('the ROM page sends app_open and rom_import_start, cookieless, with the allowed properties', async ({ page, context }) => {
  const sent = await intercept(context);
  await optIn(page);
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await expect.poll(() => sent.map((e) => e.event)).toEqual(['app_open']);
  // A file that is not a ROM still starts an import (the worker refuses it).
  await page.locator('#rom-input').setInputFiles({ name: 'rom.nds', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096) });
  await expect.poll(() => sent.map((e) => e.event)).toEqual(['app_open', 'rom_import_start']);
  for (const e of sent) {
    expect(e).toMatchObject({ api_key: 'phc_nt86bScPDMTWrGxzRg6TirzTKa6CHprPKNnU2sCo4Yqt', distinct_id: '$posthog_cookieless' });
    expect(e.properties).toMatchObject({ site: 'game', $cookieless_mode: true, $process_person_profile: false, installed: false });
    expect(['desktop', 'phone', 'tablet']).toContain(e.properties.device);
    expect(['small', 'medium', 'large']).toContain(e.properties.viewport);
  }
  expect(Object.keys(sent[0]!.properties).sort()).toEqual([...COMMON].sort());
  expect(Object.keys(sent[1]!.properties).sort()).toEqual([...COMMON, 'addon'].sort());
  expect(sent[1]!.properties.addon).toBe(false);
  expect(await context.cookies()).toEqual([]);
  expect(await traces(page)).toEqual({ cookie: '', local: [], session: [], dbs: [] });
});

test('the first run: rom_import_start and _done for Platinum, then for the add-on picked in the setup, and hgss_addon_enabled', async ({ page, context }) => {
  const sent = await intercept(context);
  await optIn(page);
  await fakeImportWorker(page);
  await page.goto('/');
  await page.locator('#rom-input').setInputFiles(fakeRom());
  await page.locator('#addon-input').setInputFiles(fakeRom('heartgold.nds'));
  await importDone(page, 0);
  await expect.poll(() => fakeImports(page)).toHaveLength(2);
  await importDone(page, 1, true);
  await expect(page.locator('#start-playing')).not.toHaveAttribute('aria-disabled');
  await expect.poll(() => sent.map((e) => e.event)).toEqual(['app_open', 'rom_import_start', 'rom_import_done', 'rom_import_start', 'rom_import_done', 'hgss_addon_enabled']);
  expect(sent.map((e) => e.properties.addon)).toEqual([undefined, false, false, true, true, undefined]);
  expect(sent[2]!.properties.duration).toBeDefined();
  expect(Object.keys(sent[2]!.properties).sort()).toEqual([...COMMON, 'addon', 'duration'].sort());
  expect(Object.keys(sent[5]!.properties).sort()).toEqual([...COMMON].sort());
});

test('CONTINUE sends game_continue; replays send nothing', async ({ page, context }) => {
  test.setTimeout(120_000);
  const sent = await intercept(context);
  await optIn(page);
  await skipSetup(page);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.keyboard.press('z');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave());
  await saveGame(page);
  // The installed app's Continue shortcut: the title loads the save at once.
  await page.goto('/?packs=fixture&title&continue');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => sent.map((e) => e.event)).toEqual(['app_open', 'app_open', 'game_continue']);
  expect(Object.keys(sent[2]!.properties).sort()).toEqual([...COMMON].sort());
  expect(await context.cookies()).toEqual([]);
  expect(await traces(page)).toEqual({ cookie: '', local: [], session: [], dbs: [] });

  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
  expect(sent).toHaveLength(3);
});

for (const signal of ['Do Not Track', 'Global Privacy Control', 'no opt-in'] as const) {
  test(`nothing is sent with ${signal}`, async ({ page, context }) => {
    const sent = await intercept(context);
    if (signal !== 'no opt-in') await optIn(page);
    if (signal === 'Do Not Track') await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }));
    if (signal === 'Global Privacy Control') await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    await page.goto('/');
    await expect(page.locator('#picker')).toBeVisible();
    await page.locator('#rom-input').setInputFiles({ name: 'rom.nds', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096) });
    await expect(page.locator('#picker-error')).toBeVisible({ timeout: 30_000 });
    expect(sent).toEqual([]);
  });
}
