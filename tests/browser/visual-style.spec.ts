/**
 * VISUAL STYLE and ANGLED CAMERA (Options › DEVICE; app visuals.ts, render enhanced/), on the fixture pack: the DS
 * look by default; a choice applies to the running field at once (the renderer's stats name the config it drew) and
 * is kept on the device across a reload; `?replay` draws the DS look whatever is stored.
 */
import { expect, test, type Page } from '@playwright/test';

type Stats = { enhanced: { camera: string; dof: boolean; bloom: boolean } | null; frames: number };
const board = (page: Page) => page.locator('[data-screen="options"]');
const setting = (page: Page, id: string) => board(page).locator(`[data-setting="${id}"]`);
const drawn = (page: Page) => page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats.enhanced);

/** The game on its idle field (wall clock). */
async function toField(page: Page, query = ''): Promise<void> {
  await page.goto(`/?packs=fixture${query}`);
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
}

/** Waits until the field has drawn a few frames (the pipeline chunk loads on first use). */
async function frames(page: Page, n = 10): Promise<void> {
  await page.evaluate(async (n) => {
    const stats = (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats;
    const from = stats.frames;
    while (stats.frames - from < n) await new Promise(requestAnimationFrame);
  }, n);
}

async function openDevice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start menu', exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  await expect(board(page)).toBeVisible();
  await expect(async () => {
    await board(page).locator('[role="tab"][data-section="device"]').click();
    await expect(board(page).locator('[role="tab"][data-section="device"]')).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
  }).toPass();
}

test('the visual style is the DS look by default, applies live, persists, and replays keep the DS look', async ({ page }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name !== 'desktop', 'one viewport is enough: the rows are the same');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await toField(page);
  await frames(page);
  expect(await drawn(page)).toBeNull();

  await openDevice(page);
  await expect(setting(page, 'visualStyle').locator('.options-value').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(setting(page, 'angledCamera').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  // Cinematic, then the angled camera: the field behind the screen draws them without a reload.
  await setting(page, 'visualStyle').getByRole('button', { name: 'CINEMATIC' }).click();
  await expect.poll(() => drawn(page)).toMatchObject({ dof: true, bloom: true, camera: 'off' });
  await setting(page, 'angledCamera').getByRole('switch').click();
  await expect.poll(() => drawn(page)).toMatchObject({ dof: true, camera: 'follow' });
  expect(await page.evaluate(() => [localStorage.getItem('lantern-nds:visual-style'), localStorage.getItem('lantern-nds:angled-camera')])).toEqual(['cinematic', 'on']);

  // Kept across a reload.
  await toField(page);
  await expect.poll(() => drawn(page)).toMatchObject({ dof: true, camera: 'follow' });

  // Back to DS: the DS look again, live.
  await openDevice(page);
  await setting(page, 'visualStyle').getByRole('button', { name: 'DS' }).click();
  await setting(page, 'angledCamera').getByRole('switch').click();
  await expect.poll(() => drawn(page)).toBeNull();

  // Replays draw the DS look whatever the device stored.
  await page.evaluate(() => {
    localStorage.setItem('lantern-nds:visual-style', 'cinematic');
    localStorage.setItem('lantern-nds:angled-camera', 'on');
  });
  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await frames(page, 20);
  expect(await drawn(page)).toBeNull();
  expect(errors).toEqual([]);
});
