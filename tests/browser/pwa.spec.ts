/**
 * The installed-app side, on the browser-test build with its service worker on (`?sw`; the app
 * registers it only when asked here): the manifest (id, shortcut, screenshots that exist at the sizes they
 * claim, icons), the whole build cached at install, a new version that waits instead of replacing a running
 * session and then takes over on "Restart to update" (at the title, and from Options › Data in a game), and the
 * browser's install prompt on the ROM page and in Options › Data. The offline relaunch to CONTINUE needs the
 * ROM import: pwa.rom.spec.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { skipSetup } from './intro.ts';

const OUT = join(process.env.OPENSINNOH_TEST_SHARD ? `test-artifacts/shard-${process.env.OPENSINNOH_TEST_SHARD}` : 'test-artifacts', 'browser-build');
const SW_FILE = join(OUT, 'sw.js');
let ORIGINAL_SW = '';
/** The build's own list and id, as the built `sw.js` carries them. */
let BUILD: { id: string; urls: string[] };

test.describe.configure({ mode: 'serial' });
test.beforeAll(({ browserName: _ }, info) => {
  if (info.project.name !== 'desktop') return;
  ORIGINAL_SW = readFileSync(SW_FILE, 'utf8');
  BUILD = JSON.parse(/const BUILD = (\{.*\});/.exec(ORIGINAL_SW)![1]!);
});
test.beforeEach(({ browserName: _ }, info) => test.skip(info.project.name !== 'desktop', 'one project: the specs edit the served sw.js and share its build'));
test.afterEach(({ browserName: _ }, info) => info.project.name === 'desktop' && writeFileSync(SW_FILE, ORIGINAL_SW));

/** The page registered the worker and it is active (and caches are filled: install finished). */
async function swActive(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 400 && !(await navigator.serviceWorker.getRegistration('/'))?.active; i++) await new Promise((r) => setTimeout(r, 50));
  });
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.active)).toBe(true);
}

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

/** A page the worker controls (a later visit): a new version waits behind it. The first visit's page is not controlled and a new version takes over at once. */
async function controlled(page: Page): Promise<void> {
  await swActive(page);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Deploys "a new version": the served sw.js changes by one byte of its build id. */
function deployNewVersion(): string {
  const next = `${BUILD.id}-next`;
  writeFileSync(SW_FILE, ORIGINAL_SW.replace(`"id":"${BUILD.id}"`, `"id":"${next}"`));
  return next;
}

test.describe('the manifest', () => {
  test('has an id, a Continue shortcut, icons and screenshots that exist at the sizes they claim', async ({ page, request }) => {
    const res = await request.get('/manifest.webmanifest');
    const m = (await res.json()) as {
      id: string;
      start_url: string;
      display: string;
      orientation: string;
      shortcuts: { name: string; url: string; icons: { src: string }[] }[];
      icons: { src: string; sizes: string; purpose?: string }[];
      screenshots: { src: string; sizes: string; type: string; form_factor: string }[];
    };
    expect(m).toMatchObject({ id: '/', start_url: '/', display: 'standalone', orientation: 'any' });
    expect(m.shortcuts.map((s) => [s.name, s.url])).toEqual([['Continue', '/?continue']]);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const file of [...m.icons.map((i) => i.src), ...m.shortcuts.flatMap((s) => s.icons.map((i) => i.src))]) expect((await request.get(file)).ok(), file).toBe(true);
    expect(m.screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
    for (const s of m.screenshots) {
      const png = await (await request.get(s.src)).body();
      // A PNG's IHDR: width and height, big-endian, at bytes 16 and 20.
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, `${s.src} is the size it claims`).toBe(s.sizes);
    }
    await page.goto('/');
    expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest');
  });
});

test('the install caches the whole build: every file the worker lists, none of the maps or store screenshots', async ({ page }) => {
  await page.goto('/?sw');
  await swActive(page);
  expect(BUILD.urls).toContain('/');
  expect(BUILD.urls.filter((u) => u.startsWith('/screenshots/') || u.endsWith('.map') || u === '/sw.js')).toEqual([]);
  expect(BUILD.urls.length).toBeGreaterThan(20);
  await expect.poll(() => cacheNames(page)).toEqual([`opensinnoh-build-${BUILD.id}`]);
  const cached = await page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname), `opensinnoh-build-${BUILD.id}`);
  expect(cached.sort()).toEqual([...BUILD.urls].sort());
});

test('a new version waits: it never takes over a running session, and "Restart to update" at the title takes it', async ({ page }) => {
  await skipSetup(page);
  await page.goto('/?packs=fixture&title&sw');
  await controlled(page);
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('#update-toast')).toHaveCount(0);
  const next = deployNewVersion();
  await page.evaluate(async () => void (await navigator.serviceWorker.getRegistration('/'))!.update());
  // Installed and waiting, and offered at the title.
  await expect(page.locator('#update-toast')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#update-toast')).toContainText('Restart to update');
  await expect.poll(() => cacheNames(page)).toEqual([`opensinnoh-build-${BUILD.id}`, `opensinnoh-build-${next}`]);
  // It waits: a second later the old worker still runs (no skipWaiting).
  await page.waitForTimeout(1500);
  expect(await page.evaluate(async () => { const r = (await navigator.serviceWorker.getRegistration('/'))!; return [!!r.waiting, !!r.installing, r.active!.state]; })).toEqual([true, false, 'activated']);
  expect(await page.evaluate(() => window.openSinnohTitle !== undefined)).toBe(true);
  // Restart: the new version takes over and the page reloads into it; the old build's cache goes.
  await page.getByRole('button', { name: 'Restart to update' }).click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect.poll(() => cacheNames(page)).toEqual([`opensinnoh-build-${next}`]);
  await expect(page.locator('#update-toast')).toHaveCount(0);
});

test('in a game there is no update toast; Options › Data offers the restart, which asks first', async ({ page }) => {
  await page.goto('/?packs=fixture&sw');
  await controlled(page);
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  const next = deployNewVersion();
  await page.evaluate(async () => void (await navigator.serviceWorker.getRegistration('/'))!.update());
  await expect.poll(() => cacheNames(page), { timeout: 20_000 }).toEqual([`opensinnoh-build-${BUILD.id}`, `opensinnoh-build-${next}`]);
  await page.waitForTimeout(500);
  await expect(page.locator('#update-toast')).toHaveCount(0);
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await page.getByRole('button', { name: 'Start menu', exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  const tab = page.locator('[data-screen="options"] [data-section="data"]');
  await expect(async () => {
    await tab.click({ timeout: 3000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
  }).toPass();
  await page.locator('[data-screen="options"] [data-setting="update"] .options-value').click();
  // The game is mid-play: it asks before it restarts (the system's dialog, not a native one).
  await expect(page.getByRole('alertdialog')).toContainText('Restart to update?');
  await page.locator('[data-tap="settings:answer:yes"]').click();
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 30_000 });
  await expect.poll(() => cacheNames(page)).toEqual([`opensinnoh-build-${next}`]);
});

test.describe('the install prompt', () => {
  /** Chromium's `beforeinstallprompt`, as the browser fires it. */
  const offerInstall = (page: Page) =>
    page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = async () => void ((window as unknown as { __prompted: number }).__prompted = ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1);
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      dispatchEvent(e);
      return e.defaultPrevented;
    });
  const prompted = (page: Page) => page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted ?? 0);

  test('the ROM page shows an install button only once the browser offers it', async ({ page }) => {
    await page.goto('/');
    await page.locator('#picker').waitFor({ state: 'visible' });
    await expect(page.locator('#install-row')).toBeHidden();
    expect(await offerInstall(page)).toBe(true);
    await expect(page.locator('#install-row')).toBeVisible();
    await page.getByRole('button', { name: 'Install the app' }).click();
    await expect.poll(() => prompted(page)).toBe(1);
    await expect(page.locator('#install-row [role="status"]')).toContainText('Installed');
    // A prompt shows once per offer.
    await expect(page.locator('#install-row')).toBeHidden();
  });

  test('Options › Data lists INSTALL APP while the browser offers it', async ({ page }) => {
    await page.goto('/?packs=fixture');
    await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
    await page.keyboard.press('KeyZ');
    await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
    await offerInstall(page);
    await page.getByRole('button', { name: 'Start menu', exact: true }).click();
    await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
    const tab = page.locator('[data-screen="options"] [data-section="data"]');
    await expect(async () => {
      await tab.click({ timeout: 3000 });
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
    }).toPass();
    await page.locator('[data-screen="options"] [data-setting="install"] .options-value').click();
    await expect.poll(() => prompted(page)).toBe(1);
  });
});
