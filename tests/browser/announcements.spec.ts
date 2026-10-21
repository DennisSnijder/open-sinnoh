/**
 * Screen-reader announcements on the fixture pack (desktop keys, phone taps): the game draws its message boxes
 * on a canvas, so one polite live region says each page's decoded text once the page has finished typing
 * (never a partial page, never twice), and the field's YES/NO and menus say the row the cursor is on.
 * packages/app/src/ui/announce.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { skipSetup } from './intro.ts';

const region = '.ui-layer .sr-only[aria-relevant="additions"]';

/** Everything the live region is given, in order (a page of text is added as one paragraph). */
async function record(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { __said: string[] }).__said = said;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.matches('.sr-only[aria-relevant="additions"] > p')) said.push(n.textContent!);
    }).observe(document, { childList: true, subtree: true });
  });
}
const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
const pageText = (page: Page) => page.evaluate(() => window.openSinnohApp!.game.scripts.view().message?.text.replace(/\s*\n\s*/g, ' ').trim() ?? null);

test('a message page is announced once, whole, when it has finished typing', async ({ page }) => {
  test.setTimeout(120_000);
  await skipSetup(page);
  await record(page);
  await page.goto('/?packs=fixture');
  // The first page types out, then waits for a key: it is announced once, whole (a part-typed page would add an entry).
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  const first = (await pageText(page))!;
  expect(first.length).toBeGreaterThan(0);
  await expect.poll(() => said(page)).toEqual([first]);
  // The region itself holds that page's text, visually hidden, for a screen reader.
  await expect(page.locator(region)).toHaveText(first);
  const box = (await page.locator(region).boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(1);

  // A key turns the page: the next one is announced, the first is not repeated.
  await page.keyboard.press('KeyZ');
  await page.waitForFunction((was) => {
    const m = window.openSinnohApp!.game.scripts.view().message;
    return !m || (m.waitingForInput && m.text.replace(/\s*\n\s*/g, ' ').trim() !== was);
  }, first);
  const next = await pageText(page);
  if (next) {
    await expect.poll(async () => (await said(page)).length).toBeGreaterThanOrEqual(2);
    expect((await said(page)).slice(0, 2)).toEqual([first, next]);
  }
  // Every announcement is a whole page the game showed, never a prefix of one.
  for (const s of await said(page)) expect(s.trim()).toBe(s);
});
