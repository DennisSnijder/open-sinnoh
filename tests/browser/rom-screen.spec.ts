/**
 * The ROM page, as a first-time visitor sees it (no import, no ROM): the landing page's brand (the Beta eyebrow,
 * the wordmark), one Platinum picker (no add-on picker there), a drag over the page, a rejected drop with its error;
 * then a picked file (the import worker stubbed, fake-import.ts): the session with the first-run setup during the
 * import, Start playing held until the import is done and never pressed for the player, the HeartGold/SoulSilver
 * add-on from the setup. At phone portrait and landscape, a laptop at DPR 2 and full HD, in both themes, nothing
 * spills sideways and Start playing stays in view. Screenshots go to test-artifacts/rom-screen (original art only:
 * this screen shows before any ROM exists).
 */
import { expect, test, type Page } from '@playwright/test';
import { fakeImports, fakeImportWorker, fakeRom, importDone, importProgress } from './fake-import.ts';
import { settle } from './settle.ts';

const SHOTS = 'test-artifacts/rom-screen';

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, scale: 3, mobile: true, theme: 'dark' },
  { name: 'phone-small', width: 360, height: 640, scale: 3, mobile: true, theme: 'light' },
  { name: 'phone-landscape', width: 844, height: 390, scale: 3, mobile: true, theme: 'light' },
  { name: 'tablet', width: 768, height: 1024, scale: 2, mobile: true, theme: 'dark' },
  { name: 'laptop', width: 1280, height: 800, scale: 2, mobile: false, theme: 'light' },
  { name: 'full-hd', width: 1920, height: 1080, scale: 1, mobile: false, theme: 'dark' },
] as const;

/** Nothing spills sideways; `still` (the picker on a screen it fits): the page does not scroll at all. */
async function expectFits(page: Page, still: boolean): Promise<void> {
  const m = await page.evaluate(() => {
    const screen = document.getElementById('rom')!;
    const doc = document.documentElement;
    return { x: [screen.scrollWidth, screen.clientWidth, doc.scrollWidth, doc.clientWidth], y: [screen.scrollHeight, screen.clientHeight] };
  });
  expect(m.x[0]).toBeLessThanOrEqual(m.x[1]!);
  expect(m.x[2]).toBeLessThanOrEqual(m.x[3]!);
  if (still) expect(m.y[0]).toBeLessThanOrEqual(m.y[1]!);
}

/** Start playing is on screen (sticky at the window's foot where the page scrolls). */
async function expectStartInView(page: Page): Promise<void> {
  const box = (await page.locator('#start-playing').boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

const start = (page: Page) => page.locator('#start-playing');

for (const v of VIEWPORTS) {
  test(`ROM page at ${v.name} (${v.width}×${v.height}, ${v.theme})`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewports');
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, isMobile: v.mobile, hasTouch: v.mobile, colorScheme: v.theme });
    const page = await context.newPage();
    await fakeImportWorker(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');

    // First visit: the landing page's hero (Beta, the wordmark, the pitch), one window, one picker: Platinum only.
    await expect(page.locator('#picker')).toBeVisible();
    await expect(page.locator('.rom-kick')).toContainText('Beta');
    await expect(page.getByRole('heading', { level: 1, name: 'OpenSinnoh' })).toBeVisible();
    await expect(page.locator('#rom-wordmark .os-wordmark.anim')).toBeVisible();
    await expect(page.locator('.rom-win.os-win')).toBeVisible();
    await expect(page.locator('.rom-tagline')).toContainText('Nothing is uploaded');
    await expect(page.getByText('Choose your Platinum ROM')).toBeVisible();
    await expect(page.getByLabel(/Choose your Platinum ROM/)).toHaveAttribute('id', 'rom-input');
    await expect(page.locator('#rom-need')).toContainText('Platinum (US)');
    await expect(page.locator('#picker')).not.toContainText('HeartGold');
    await expect(page.locator('#addon-input')).toHaveCount(0);
    await expect(page.locator('#rom-rail li[aria-current="step"]')).toContainText('Your ROM');
    await expect(page.locator('#rom-notice')).toBeHidden();
    await expect(page.locator('.rom-foot')).toContainText('not affiliated with Nintendo');
    await settle(page);
    await expectFits(page, v.name !== 'phone-landscape' && v.name !== 'phone-small');
    await page.screenshot({ path: `${SHOTS}/${v.name}-picker.png` });

    // Keyboard: Tab reaches the file input and the drop box shows focus.
    await page.keyboard.press('Tab');
    await expect(page.locator('#rom-input')).toBeFocused();
    expect(await page.locator('#drop').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

    // A file dragged over the page lights the drop box; dropping one that is not a DS ROM explains why.
    await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
    await expect(page.locator('#drop')).toHaveClass(/over/);
    await page.screenshot({ path: `${SHOTS}/${v.name}-drag.png` });
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(16)], 'tiny.nds'));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await expect(page.locator('#drop')).not.toHaveClass(/over/);
    await expect(page.locator('#picker-error')).toContainText('That file could not be used');
    await expect(page.locator('#picker-error')).toContainText('too small');
    await expect(page.locator('#picker-error')).toContainText('Choose another file');
    await expect(page.locator('#picker-error .os-banner')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#rom-input')).toBeFocused();
    await expectFits(page, false);
    await page.screenshot({ path: `${SHOTS}/${v.name}-error.png` });

    // A file is picked: the session. The import runs, the setup starts beside it, and Start playing waits.
    await page.locator('#rom-input').setInputFiles(fakeRom());
    await expect(page.locator('#importing')).toBeVisible();
    await expect(page.locator('#picker')).toBeHidden();
    await expect(page.locator('#picker-error')).toBeHidden();
    await expect(page.locator('#rom-rail li[aria-current="step"]')).toContainText('Setup');
    expect(await fakeImports(page)).toEqual([{ name: 'platinum.nds', addon: false }]);
    await importProgress(page, 0, 'Converting maps', 6, 16);
    await expect(page.locator('#import-progress')).toHaveAttribute('aria-valuenow', '38');
    await expect(page.locator('#import-stage')).toHaveText('Converting maps');
    const wizard = page.locator('#wizard');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('.fr-choices')).toHaveAttribute('data-question', 'addon');
    await expect(wizard).toContainText('Question 1 of 3');
    await expect(wizard).toContainText('later in Options');
    await expect(start(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#start-why')).toHaveText('Your game is still importing.');
    await settle(page);
    await expectFits(page, false);
    await expectStartInView(page);
    await page.screenshot({ path: `${SHOTS}/${v.name}-setup-addon.png` });

    // Step 1: the add-on, from the setup (its own picker): queued until Platinum is done.
    await page.locator('#addon-input').setInputFiles(fakeRom('heartgold.nds'));
    await expect(wizard.locator('.fr-choices')).toHaveAttribute('data-question', 'reports');
    await expect(page.locator('#addon-stage')).toContainText('Waiting for Pokémon Platinum');
    await expect(wizard).toContainText('Question 2 of 3');
    // Step 2: error reports, with the analytics line; the keyboard is on the answers.
    await expect(wizard).toContainText('without cookies');
    await expect(wizard.locator('.os-choice').first()).toBeFocused();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/${v.name}-setup-reports.png` });
    await page.keyboard.press('ArrowDown');
    await expect(wizard.locator('.os-choice').nth(1)).toBeFocused();
    await expect(wizard.locator('.os-choice').nth(1)).toHaveClass(/is-cursor/);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => localStorage.getItem('lantern-nds:error-reports'))).toBe('false');
    // Step 3: text speed, on the stored speed (Mid).
    await expect(wizard.locator('.fr-choices')).toHaveAttribute('data-question', 'textSpeed');
    await expect(wizard.locator('.os-choice.is-cursor')).toContainText('Mid');
    await wizard.locator('.os-choice', { hasText: 'Fast' }).click();
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('lantern-nds:options')!) as { textSpeed: number }).textSpeed)).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem('lantern-nds:setup'))).toBe('["reports","addon","textSpeed"]');
    // All answered before the import is done: the progress, and Start playing still held.
    await expect(wizard).toContainText('All set');
    await expect(start(page)).toHaveAttribute('aria-disabled', 'true');
    // A press while it waits does nothing (aria-disabled: Playwright's click would wait for it to be enabled).
    await start(page).dispatchEvent('click');
    await expect(page.locator('#importing')).toBeVisible();
    await settle(page);
    await expectStartInView(page);
    await page.screenshot({ path: `${SHOTS}/${v.name}-waiting.png` });

    // Platinum is done: the add-on's import starts; Start playing waits for it too.
    await importDone(page, 0);
    await expect(page.locator('#base-job')).toContainText('Pokémon Platinum is imported');
    await expect.poll(() => fakeImports(page)).toEqual([
      { name: 'platinum.nds', addon: false },
      { name: 'heartgold.nds', addon: true },
    ]);
    await expect(page.locator('#start-why')).toHaveText('HeartGold or SoulSilver is still importing.');
    await importProgress(page, 1, 'Converting followers', 1, 2);
    await expect(page.locator('#addon-progress')).toHaveAttribute('aria-valuenow', '50');
    await importDone(page, 1, true);
    await expect(page.locator('#addon-job')).toContainText('Every Pokémon can follow you');
    // Ready: Start playing, with the keyboard on it; nothing starts on its own.
    await expect(start(page)).not.toHaveAttribute('aria-disabled');
    await expect(start(page)).toBeFocused();
    await expect(page.locator('#rom-rail li[aria-current="step"]')).toContainText('Play');
    await page.waitForTimeout(500);
    await expect(page.locator('#importing')).toBeVisible();
    await settle(page);
    await expectFits(page, false);
    await expectStartInView(page);
    await page.screenshot({ path: `${SHOTS}/${v.name}-ready.png` });

    expect(errors).toEqual([]);
    await context.close();
  });
}

test('the import finishes first: the setup goes on and Start playing is there; a failed import goes back to the picker', async ({ page }) => {
  await fakeImportWorker(page);
  await page.goto('/');
  await page.locator('#rom-input').setInputFiles(fakeRom());
  await expect(page.locator('#wizard')).toBeVisible();
  await importDone(page, 0);
  // The setup stays on its question; Start playing is ready (the title asks what is left), but has not taken the keyboard.
  await expect(page.locator('#wizard .fr-choices')).toHaveAttribute('data-question', 'addon');
  await expect(start(page)).not.toHaveAttribute('aria-disabled');
  await expect(start(page)).not.toBeFocused();
  await page.locator('#wizard .os-choice', { hasText: 'Skip' }).click();
  await page.locator('#wizard .os-choice', { hasText: 'Allow' }).first().click();
  await page.locator('#wizard .os-choice', { hasText: 'Slow' }).click();
  await expect(page.locator('#wizard')).toContainText('All set');
  await expect(start(page)).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:error-reports'))).toBe('true');

  // A refused file: back to the picker with the reason; the answers are kept and not asked again.
  await page.goto('/');
  await page.locator('#rom-input').setInputFiles(fakeRom());
  await expect(page.locator('#importing')).toBeVisible();
  await expect(page.locator('#wizard')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { fakeImports: { onmessage(e: unknown): void }[] }).fakeImports[0]!.onmessage({ data: { type: 'error', message: 'This ROM is not supported.', sha1: '0'.repeat(40) } }));
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#picker-error')).toContainText('not supported');
});

test('the icons named by the page and the manifest are served, a maskable one among them', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one check is enough');
  await page.goto('/');
  const head = await page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute('href')!));
  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as { icons: { src: string; purpose?: string }[] };
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const src of new Set([...head, ...manifest.icons.map((i) => i.src)])) expect((await page.request.get(src)).status(), src).toBe(200);
});
