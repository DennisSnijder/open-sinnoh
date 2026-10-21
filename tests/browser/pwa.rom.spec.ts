/**
 * The installed app works offline (real ROM: OPENSINNOH_NDS_ROM; skipped without it). After one visit with the
 * service worker on and an import, the network goes away and a relaunch (a fresh navigation to the app) comes up
 * from the worker's cache and the imported game in IndexedDB: the title, CONTINUE with the saved game, and the
 * game itself, with no request leaving the browser and no error. Also the installed app's Continue shortcut
 * (`/?continue`, from the manifest): it loads the save without the title's taps.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { saveSlot } from './save.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
const errors: string[] = [];
const failed: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one project: the cache and storage are the same everywhere');
  test.setTimeout(420_000);
  context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => failed.push(`${r.url()}: ${r.failure()?.errorText}`));
  await seedRomImport(page);
  // A saved game for CONTINUE: the replay bridge's new game, written into the slot the title reads.
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  // The new game's opening scene runs to an idle field first (a save needs one).
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 3000 && !window.openSinnohApp!.game.canSave(); i++) {
      if (g.snapshot().view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    if (!window.openSinnohApp!.game.canSave()) throw new Error('the new game never reached an idle field');
  });
  await saveSlot(page);
});

test.afterAll(async () => {
  await context?.close();
});

/** The title to its main menu (a tap once the opening fade is done). */
async function toMenu(): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 60_000 });
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await page.locator('#title').click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
}

test('after one visit and an import, a relaunch with no network reaches CONTINUE and the game', async () => {
  test.setTimeout(300_000);
  // The one visit, with the worker on: it installs and caches the build.
  await page.goto('/?sw');
  await page.evaluate(async () => {
    for (let i = 0; i < 600 && !(await navigator.serviceWorker.getRegistration('/'))?.active; i++) await new Promise((r) => setTimeout(r, 50));
  });
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(1);
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 60_000 });
  errors.length = 0;
  failed.length = 0;

  await context.setOffline(true);
  // The relaunch: a new navigation, answered by the worker.
  await page.goto('/');
  await toMenu();
  await expect(page.locator('.tm-continue')).toBeVisible();
  await page.locator('.tm-continue').click();
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 120_000 });
  // The battle engine's chunk (fetched in the background) and every other file came from the cache.
  await page.waitForTimeout(2000);
  // The one request that leaves the browser is the app's probe for a dev server's packs (pack-source.ts
  // `devPacksIfServed`: a network error means "none", by design). Nothing else is asked of the network.
  const probes = failed.filter((u) => u.includes('/__opensinnoh/packs.json'));
  expect(failed.filter((u) => !probes.includes(u)), 'requests that left the browser offline').toEqual([]);
  expect(errors.filter((e) => !e.startsWith('Failed to load resource')), 'errors').toEqual([]);
  expect(errors.filter((e) => e.startsWith('Failed to load resource')).length, 'only the probe fails to load').toBe(probes.length);
  await context.setOffline(false);
});

test('the Continue shortcut loads the save without the title', async () => {
  test.setTimeout(300_000);
  await page.goto('/?continue');
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 120_000 });
  expect(await page.evaluate(() => window.openSinnohTitle)).toBeUndefined();
  expect(errors.filter((e) => !e.startsWith('Failed to load resource'))).toEqual([]);
});
