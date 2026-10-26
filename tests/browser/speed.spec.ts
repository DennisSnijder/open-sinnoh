/**
 * Game speed (fast-forward) on the fixture pack in normal play (the wall-clock loop): holding Tab runs about
 * twice the ticks per wall second, backtick latches it, the ">> 2x" mark shows while fast, and the fast
 * speed picked in OPTIONS is kept across a reload. Phones get a HUD button that toggles it.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 10 && !window.openSinnohApp!.sceneLoading());
  return errors;
}

/**
 * Ticks the loop asks for per wall second over `ms`, measured in the page: the ticks it ran and those it dropped. A
 * loaded machine (software GL beside other test workers) drops the fast ticks it has no time for, by design (loop.ts
 * `runTicks`), so the ticks run alone measure the machine; the speed decides how many are due.
 */
const tickRate = (page: Page, ms = 2000) =>
  page.evaluate(async (ms) => {
    const loop = window.openSinnohApp!.loop;
    const due = () => loop.ticks + loop.dropped;
    const t0 = performance.now();
    const k0 = due();
    await new Promise((r) => setTimeout(r, ms));
    return ((due() - k0) * 1000) / (performance.now() - t0);
  }, ms);

const speed = (page: Page) => page.evaluate(() => window.openSinnohApp!.speed());

test('Tab runs fast while held, backtick latches it, the speed setting persists', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'keyboard');
  test.setTimeout(120_000);
  const errors = await open(page);
  const indicator = page.locator('.speed-indicator');
  await expect(indicator).toBeHidden();

  const normal = await tickRate(page);
  expect(normal).toBeGreaterThan(10);
  expect(normal).toBeLessThan(33);

  // Held: twice the ticks (the loop's speed is 2), the toast and the mark.
  await page.keyboard.down('Tab');
  await expect(page.locator('.ui-toast')).toHaveText('Speed 2x');
  await expect(indicator).toHaveText('>> 2x');
  const held = await tickRate(page);
  expect(await page.evaluate(() => window.openSinnohApp!.loop.speed)).toBe(2);
  await page.keyboard.up('Tab');
  console.log(`ticks per second: ${normal.toFixed(1)} at 1x, ${held.toFixed(1)} with Tab held`);
  expect(held / normal).toBeGreaterThan(1.5);
  expect(held / normal).toBeLessThan(2.5);
  await expect(indicator).toBeHidden();
  // Tab never left the game for the browser's focus ring.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  // Backtick latches it (no key held), and again turns it off.
  await page.keyboard.press('Backquote');
  expect(await speed(page)).toEqual({ fast: 2, latched: true, active: true, speed: 2 });
  await expect(indicator).toHaveText('>> 2x');
  expect((await tickRate(page)) / normal).toBeGreaterThan(1.5);
  await page.keyboard.press('Backquote');
  await expect(page.locator('.ui-toast')).toHaveText('Speed 1x');
  await expect(indicator).toBeHidden();
  expect((await speed(page)).speed).toBe(1);

  // OPTIONS: the fast speed (2x default) on the PLAY page; picking 4x stores it.
  await page.waitForFunction(() => window.openSinnohApp!.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await page.keyboard.press('Enter');
  await page.locator('[data-screen="start-menu"]').getByRole('button', { name: 'SETTINGS' }).click();
  const options = page.locator('[data-screen="options"]');
  await options.locator('[data-section="device"]').click();
  const values = options.locator('[data-setting="speed"] .options-value');
  await expect(values).toHaveText(['2x', '3x', '4x', '8x']);
  await expect(values.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await values.nth(2).click();
  await expect(values.nth(2)).toHaveAttribute('aria-pressed', 'true');
  expect((await speed(page)).fast).toBe(4);
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:speed'))).toBe('4');

  // Kept on the device: after a reload Tab runs at 4x.
  await page.reload();
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 10 && !window.openSinnohApp!.sceneLoading());
  expect((await speed(page)).fast).toBe(4);
  await page.keyboard.down('Tab');
  await expect(indicator).toHaveText('>> 4x');
  const four = await tickRate(page);
  await page.keyboard.up('Tab');
  console.log(`ticks per second with Tab held at 4x: ${four.toFixed(1)} (loop: ${JSON.stringify(await page.evaluate(() => ({ ...window.openSinnohApp!.loop, frameMs: undefined })))})`);
  expect(four / normal).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('phones toggle fast-forward with the HUD button', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch HUD');
  const errors = await open(page);
  const button = page.locator('.ui-hud').getByRole('button', { name: 'Fast-forward' });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect([box.width, box.height]).toEqual([44, 44]);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.speed-indicator')).toHaveText('>> 2x');
  await expect(page.locator('.ui-toast')).toHaveText('Speed 2x');
  expect((await speed(page)).speed).toBe(2);
  await page.screenshot({ path: 'test-artifacts/speed/phone-fast.png' });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.speed-indicator')).toBeHidden();
  expect(errors).toEqual([]);
});
