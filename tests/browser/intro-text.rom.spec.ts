/**
 * Rowan's intro on the ROM at 175 % scaling (Windows' common setting): every message page shows all its lines (the
 * box is the DS's full-width window and the waiting arrow takes no width), and ADVENTURE INFO opens (its backdrop has
 * the info box drawn in it) and comes back to the choice.
 */
import { expect, test } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { TitleScreens, press, skipSetup } from './intro.ts';
import { appStrings } from './words.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one desktop window at a fractional device scale');

test('Rowan intro: every page fits its box at 175 %, ADVENTURE INFO opens', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1463, height: 836 }, deviceScaleFactor: 1.75 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await skipSetup(page);
  await page.goto('/');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
  await press(page, 'Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 30_000 });
  await press(page, 'Enter');
  const screens = new TitleScreens(page, false, appStrings());
  const intro = screens.flow('New game');
  // Each waiting page: no line pushed out of the box (the DS shows two per page; the box hides any more).
  const overflowing: string[] = [];
  const checkPages = async (done: () => Promise<boolean>) => screens.advance(intro, async () => {
    for (const box of await intro.locator('.msg-box.waiting').all()) {
      const fit = await box.evaluate((e) => e.scrollHeight <= e.clientHeight + 0.5);
      if (!fit) overflowing.push((await box.textContent()) ?? '');
    }
    return done();
  });
  const choice = intro.locator('.intro-menu [data-tap^="menu:"]');
  await checkPages(async () => (await choice.count()) > 0);
  await screens.choose(intro, 0); // ADVENTURE INFO: its pages, then the choice again.
  await checkPages(async () => (await choice.count()) > 0);
  expect(overflowing).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});
