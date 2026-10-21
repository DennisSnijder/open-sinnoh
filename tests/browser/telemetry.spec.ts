/**
 * Error reports and the crash screen on the fixture pack. An error thrown in a game tick stops the game:
 * the crash screen shows, fits the viewport, and copies a scrubbed report (no game text, no names).
 * Without a DSN (dev, tests, forks) nothing is sent and the report chunk never loads; with a DSN (a fake one
 * pointing at a route of this page) one report goes out, scrubbed, once the player allowed reports (the setup's
 * question, stored here beforehand); before an answer none; with "Error reports" off in OPTIONS none.
 */
import { expect, test, type Page } from '@playwright/test';

const ENVELOPE = /\/api\/1\/envelope\//;
const GAME_TEXT = 'Secret game text';

async function open(page: Page, dsn?: string, allowed = false): Promise<{ errors: string[]; reports: string[]; sentryLoads: string[] }> {
  const errors: string[] = [];
  const reports: string[] = [];
  const sentryLoads: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (ENVELOPE.test(r.url())) reports.push(r.postData() ?? '');
    if (/sentry/i.test(r.url()) && !ENVELOPE.test(r.url())) sentryLoads.push(r.url());
  });
  await page.route(ENVELOPE, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  if (dsn) await page.addInitScript((dsn) => ((window as { openSinnohTestDsn?: string }).openSinnohTestDsn = dsn), dsn);
  if (allowed) await page.addInitScript(() => localStorage.getItem('lantern-nds:error-reports') ?? localStorage.setItem('lantern-nds:error-reports', 'true'));
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 10 && !window.openSinnohApp!.sceneLoading());
  return { errors, reports, sentryLoads };
}

/** The next tick throws an error carrying a quoted game text and the player's name. */
const breakGame = (page: Page) =>
  page.evaluate((text) => {
    const game = window.openSinnohApp!.game;
    game.step = () => {
      throw new Error(`test crash "${text}" for ${game.state.names.player}`);
    };
  }, GAME_TEXT);

const fakeDsn = (baseURL: string) => `${new URL(baseURL).protocol}//public@${new URL(baseURL).host}/1`;

test('a crash shows the crash screen with copyable, scrubbed details; nothing is sent without a DSN', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { errors, reports, sentryLoads } = await open(page);
  const player = await page.evaluate(() => window.openSinnohApp!.game.state.names.player);
  await breakGame(page);

  const crash = page.getByRole('alertdialog', { name: 'Something went wrong' });
  await expect(crash).toBeVisible();
  await expect(crash.getByRole('button', { name: 'Reload' })).toBeFocused();
  await expect(crash).toContainText('Copy the details');
  const box = (await crash.locator('.crash-card').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: `test-artifacts/telemetry/crash-${info.project.name}.png` });

  await crash.getByRole('button', { name: 'Copy details' }).click();
  await expect(crash.getByRole('status')).toContainText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('OpenSinnoh error report');
  expect(copied).toContain('error: Error: test crash "[text]" for [name]');
  expect(copied).toContain('where: loop');
  expect(copied).toMatch(/zone: fixture:/);
  expect(copied).toContain('mode: ');
  expect(copied).not.toContain(GAME_TEXT);
  expect(copied).not.toContain(` ${player}`);
  await crash.getByText('Show details').click();
  await expect(crash.locator('.crash-report')).toHaveText(copied);

  // The game stopped (no more ticks), nothing went out, the report chunk was never fetched.
  const ticks = await page.evaluate(() => window.openSinnohApp!.ticks);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.openSinnohApp!.ticks)).toBe(ticks);
  expect(reports).toEqual([]);
  expect(sentryLoads).toEqual([]);
  expect(errors).toEqual([]);

  await crash.getByRole('button', { name: 'Reload' }).click();
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 10);
  await expect(crash).toBeHidden();
});

test('with a DSN, before the player answers, nothing is sent', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the report path does not depend on the viewport');
  test.setTimeout(120_000);
  const { reports, sentryLoads } = await open(page, fakeDsn(info.project.use.baseURL!));
  await breakGame(page);
  await expect(page.getByRole('alertdialog', { name: 'Something went wrong' })).toContainText('Copy the details');
  await page.waitForTimeout(2000);
  expect(reports).toEqual([]);
  expect(sentryLoads).toEqual([]);
});

test('with a DSN one scrubbed report is sent', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the report path does not depend on the viewport');
  test.setTimeout(120_000);
  const { reports } = await open(page, fakeDsn(info.project.use.baseURL!), true);
  const player = await page.evaluate(() => window.openSinnohApp!.game.state.names.player);
  await breakGame(page);
  await expect(page.getByRole('alertdialog', { name: 'Something went wrong' })).toContainText('anonymous error report');
  await expect.poll(() => reports.length, { timeout: 20_000 }).toBe(1);
  const body = reports[0]!;
  expect(body).toContain('test crash \\"[text]\\" for [name]');
  expect(body).toContain('"level":"fatal"');
  expect(body).toMatch(/"zone":"fixture:/);
  expect(body).not.toContain(GAME_TEXT);
  expect(body).not.toContain(` ${player}`);
  expect(body).not.toContain('"user"');
  await page.waitForTimeout(1000);
  expect(reports.length).toBe(1);
});

test('"Error reports" off in OPTIONS: stored, and nothing is sent', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'keyboard');
  test.setTimeout(120_000);
  const { reports, sentryLoads } = await open(page, fakeDsn(info.project.use.baseURL!), true);
  // The fixture opens on a message: close it, then OPTIONS from the start menu.
  await page.waitForFunction(() => window.openSinnohApp!.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await page.keyboard.press('Enter');
  await page.locator('[data-screen="start-menu"]').getByRole('button', { name: 'SETTINGS' }).click();
  const options = page.locator('[data-screen="options"]');
  await options.locator('[data-section="privacy"]').click();
  const toggle = options.locator('[data-setting="reports"]').getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:error-reports'))).toBe('false');
  // The report chunk preloads 5 s after start while reports are on: reaching the page can take longer, so
  // only what loads after the switch counts (off, nothing loads and nothing is sent).
  const loadsBefore = sentryLoads.length;

  await breakGame(page);
  const crash = page.getByRole('alertdialog', { name: 'Something went wrong' });
  await expect(crash).toContainText('Copy the details');
  await page.waitForTimeout(2000);
  expect(reports).toEqual([]);
  expect(sentryLoads.slice(loadsBefore)).toEqual([]);
});
