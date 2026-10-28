/**
 * Saving in browser specs. The player saves from the start menu (the app has no other save button): `saveGame`
 * does that in normal (wall-clock) play. A replay-bridge page does not run on its own, so `saveSlot` writes the
 * bridge's save into the slot the app reads at the title, the same way `IndexedDbSaveStore` does.
 */
import { expect, type Page } from '@playwright/test';
import { pageStrings } from './words.ts';

/** Whether the app's save slot holds a save (without creating the database, which the app creates itself). */
export function hasSave(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'lantern-nds-saves')) return false;
    return new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open('lantern-nds-saves');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const get = db.transaction('saves').objectStore('saves').get('main');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          db.close();
          resolve(get.result !== undefined);
        };
      };
    });
  });
}

/** Normal play, an idle field: the start menu's SAVE, YES, then the confirmation is dismissed. */
export async function saveGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: (await pageStrings(page)).aria.hud.menu, exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="save"]').click();
  await page.locator('[data-screen="save"] [data-tap="yes"]').click();
  await expect.poll(() => hasSave(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen]')).toHaveCount(0);
}

/** A replay-bridge page: writes the game's save (`openSinnohGame.save()`) into the app's save slot. */
export async function saveSlot(page: Page): Promise<void> {
  await page.evaluate(
    (json) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(json, 'main');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    await page.evaluate(() => window.openSinnohGame!.save()),
  );
}

/** A replay-bridge page: the field to idle, the start menu, then OPTIONS on its DATA page; each click is taken by a tick. */
export async function openData(page: Page): Promise<void> {
  const advance = (n: number) => page.evaluate((k) => window.openSinnohGame!.advance(k), n);
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    // The start menu opens on an idle field: finish what is on screen (a new game's opening message).
    for (let i = 0; i < 3000 && !window.openSinnohApp!.game.canSave(); i++) {
      if (g.snapshot().view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    g.press('x');
    g.advance(1);
    g.release('x');
    g.advance(1);
  });
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  await advance(2);
  await page.locator('[data-screen="options"] [data-section="data"]').click();
  await advance(2);
}

/** A replay-bridge page on the DATA page: presses a row's button, then a tick for the screen to take it. */
export async function pressData(page: Page, id: string): Promise<void> {
  await page.locator(`[data-screen="options"] [data-setting="${id}"] .options-value`).click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
}

/** Normal play, an idle field: the start menu's OPTIONS entry, then its DATA page. */
export async function openOptionsData(page: Page): Promise<void> {
  await page.getByRole('button', { name: (await pageStrings(page)).aria.hud.menu, exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  const tab = page.locator('[data-screen="options"] [data-section="data"]');
  // The screen is drawn again after each change: a click that lands mid-redraw is taken again.
  await expect(async () => {
    await tab.click({ timeout: 3000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
  }).toPass();
}
