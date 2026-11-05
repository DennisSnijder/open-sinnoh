/**
 * A new game on the real ROM by pad alone (OPENSINNOH_NDS_ROM; skipped without it): the title, NEW GAME, Rowan's intro
 * and its naming keyboard, to the field with the player in control. Nothing here is a key, a click or a tap.
 */
import { expect, test } from '@playwright/test';
import { skipSetup } from './intro.ts';
import { installPads, PAD, press } from './pad.ts';
import { seedRomImport } from './seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

test('the title to the field by pad alone', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'pad input does not depend on the viewport');
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await installPads(page);
  await skipSetup(page);
  // Fast text: the intro is dozens of pages, each one press on a software-rendered title.
  await page.addInitScript(() => localStorage.setItem('lantern-nds:options', JSON.stringify({ textSpeed: 2 })));
  await page.goto('/');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 120_000 });
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 60_000 });
  await expect(async () => {
    await press(page, PAD.start);
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });

  // With no save, the first entry is NEW GAME.
  expect(await page.evaluate(() => window.openSinnohTitle?.focused)).toBe('new-game');
  await press(page, PAD.a);

  // The intro's pages and questions take A; its naming keyboard takes Start (the cursor to OK), then A. Rowan's list of
  // topics comes round until its last entry says enough, so the pad moves there first.
  await expect(async () => {
    const naming = await page.locator('[data-naming]').count();
    if (naming) await press(page, PAD.start);
    const list = page.locator('.intro-menu [data-tap^="menu:"]');
    const entries = await list.count();
    const yesNo = /yes/i.test((await list.first().getAttribute('aria-label', { timeout: 200 }).catch(() => null)) ?? (entries ? await list.first().innerText() : ''));
    if (entries > 1 && !yesNo) {
      const cursor = () => page.locator('.intro-menu [aria-current="true"]').getAttribute('data-tap');
      while ((await cursor()) !== `menu:${entries - 1}`) await press(page, PAD.down);
    }
    await press(page, PAD.a);
    expect(await page.evaluate(() => !window.openSinnohTitle && !!window.openSinnohApp)).toBe(true);
  }).toPass({ timeout: 240_000, intervals: [0] });

  // The opening's script runs on A too, until the field is the player's.
  await expect(async () => {
    await press(page, PAD.a);
    expect(await page.evaluate(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running())).toBe(true);
  }).toPass({ timeout: 120_000, intervals: [0] });
  expect(errors).toEqual([]);
});
