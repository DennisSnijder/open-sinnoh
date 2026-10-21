/** Browser keyboard navigation must activate the focused menu control in normal (non-replay) play. */
import { expect, test } from '@playwright/test';

test('menus contain focus, activate the focused control, and return focus when closed', async ({ page }) => {
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput);
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  const trigger = page.getByRole('button', { name: 'Start menu', exact: true });
  await page.keyboard.down('Enter');
  const menu = page.locator('[data-screen="start-menu"]');
  await expect(menu).toBeVisible();
  await page.keyboard.up('Enter');
  await page.waitForFunction(() => !window.openSinnohApp!.lastInput?.held.includes('start'));
  await menu.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  const options = page.locator('[data-screen="options"]');
  await expect(options).toBeVisible();
  await expect(page.locator('.ui-hud')).toHaveAttribute('inert', '');
  const original = await page.evaluate(() => window.openSinnohApp!.game.textSpeed);
  const privacy = options.getByRole('tab', { name: 'Privacy', exact: true });
  await privacy.focus();
  await page.keyboard.press('Space');
  await expect(privacy).toHaveAttribute('aria-selected', 'true');
  await expect(privacy).toBeFocused();
  expect(await page.evaluate(() => window.openSinnohApp!.game.textSpeed)).toBe(original);
  // The tab's arrows switch its own section, rather than changing the previous setting.
  await page.keyboard.press('ArrowLeft');
  await expect(options.getByRole('tab', { name: 'Data', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(options.getByRole('tab', { name: 'Controls', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(options.getByRole('tab', { name: 'Device', exact: true })).toBeFocused();
  await expect(options.getByRole('tab', { name: 'Device', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.down('Tab');
  expect(await page.evaluate(() => window.openSinnohApp!.speed().active)).toBe(false);
  expect(await options.evaluate(e => e.contains(document.activeElement))).toBe(true);
  await page.keyboard.up('Tab');
  const step = options.getByRole('button', { name: 'Next Zoom', exact: true });
  await step.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lantern-nds:zoom'))).toMatch(/^\d+$/);
  // Tab and Shift+Tab wrap within the actual visible controls.
  const close = options.getByRole('button', { name: 'Back', exact: true });
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(options.getByRole('tab', { name: 'Device', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'SETTINGS', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // Opened from the field's keys with nothing focused: focus goes back to nothing, so Space stays A.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.locator('.ui-hud')).not.toHaveAttribute('inert');
  // Opened by the HUD button: focus returns to it, and Space/Enter there still reach the game.
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.openSinnohApp!.lastInput?.held.includes('a'));
  await page.keyboard.up('Space');
  await expect(menu).toBeHidden();
});
