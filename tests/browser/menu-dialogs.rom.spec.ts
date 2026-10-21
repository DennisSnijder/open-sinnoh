/** Native activation must follow the active Bag action and item-use dialog, not a covered row. */
import { expect, test } from '@playwright/test';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

test('Space follows Bag actions and the item-use message back to the Bag', async ({ page }) => {
  test.setTimeout(180_000);
  const registries = loadGamePacks([romSlice().pack]).registries;
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
  const result = await runReplay(pageDriver(page, 'test-artifacts/menu-dialogs', 'item'), `party 0 platinum:SPECIES_PIPLUP 5
set state party[0].hp 1
give item platinum:ITEM_POTION 20
warp platinum:MAP_HEADER_ROUTE_201 115 853 right
until idle
+1 press x
+1 release x
until app start-menu
+1 tap entry:1
+1 tap pocket:1
+1 tap row:0
`, { registries, repeat: false });
  expect(result.error).toBeUndefined();
  const advance = () => page.evaluate(() => window.openSinnohGame!.advance(2));
  await advance();
  const action = page.locator('[data-screen="bag"] .menu-entry.is-cursor');
  await expect(action).toBeFocused();
  await page.keyboard.press('Space');
  await advance();
  const party = page.locator('[data-screen="party"]');
  await expect(party).toBeVisible();
  await party.locator('[data-tap="slot:0"]').click();
  await advance();
  const message = party.locator('.msg-box.waiting');
  await expect(message).toBeFocused();
  await page.keyboard.press('Space');
  await advance();
  await expect(page.locator('[data-screen="bag"]')).toBeVisible();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.bag.medicine![0]!.count)).toBe(19);
});
