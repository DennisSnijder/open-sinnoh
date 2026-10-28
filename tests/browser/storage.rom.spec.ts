/**
 * Storage with the real import (OPENSINNOH_NDS_ROM; skipped without it), at desktop and phone:
 * - Options › Data lists the browser's storage with whether it keeps the data (`navigator.storage.persisted`), and
 *   KEEP DATA asks the browser to (`persist()`), saying what came of it;
 * - the boot check passes on a whole import (and how long it takes is printed); an import without the size check's
 *   mark (stored before it) is checked fully once on its first start and marked, a new import as it finishes;
 * - a file missing from the import (the Sentry issue "imported pack platinum has no file ...") leads to the ROM page
 *   with a calm re-import notice instead of a crash; choosing the ROM again repairs it and Start playing opens the title;
 * - an import from an older importer (an engine update) shows the same notice, asks no setup again, and the save
 *   made before it is untouched and CONTINUE loads it.
 */
import { expect, test, type Page } from '@playwright/test';
import { IMPORTER_VERSION } from '../../packages/app/src/importer.ts';
import { romSha1 } from '../rom.ts';
import { skipSetup } from './intro.ts';
import { saveSlot } from './save.ts';
import { seedRomImport } from './seed.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

type Store = typeof import('../../packages/app/src/store.ts');
const board = (page: Page) => page.locator('[data-screen="options"]');

async function toMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 60_000 });
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 60_000 });
  await page.locator('#title').click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
}

test('Options › Data shows the storage and asks the browser to keep it; a missing file leads to a re-import', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The browser's answer to persist(): refuse until the test says otherwise.
  await page.addInitScript(() => {
    let kept = false;
    navigator.storage.persisted = async () => kept;
    navigator.storage.persist = async () => (kept = (window as { grantPersist?: boolean }).grantPersist === true);
  });
  await seedRomImport(page);
  await skipSetup(page);
  await page.goto('/');
  await toMenu(page);
  await page.locator('.tm-options').click();
  await expect(board(page)).toBeVisible();
  await board(page).locator('[role="tab"][data-section="data"]').click();
  const row = board(page).locator('[data-setting="storage"]');
  await row.locator('.options-value').click();
  await expect(board(page).locator('.options-desc')).toContainText(appStrings().game.keepRefused);
  await page.evaluate(() => ((window as { grantPersist?: boolean }).grantPersist = true));
  await row.locator('.options-value').click();
  await expect(board(page).locator('.options-desc')).toContainText(appStrings().game.keepDone);

  // The whole import passes the boot check; a file gone from it does not.
  const sha1 = romSha1();
  const check = await page.evaluate(
    async ({ sha1, version }) => {
      const store = (await new Function('u', 'return import(u)')('/__test/store.js')) as Store;
      const db = await store.openDb();
      const key = store.importKey(sha1, version);
      const meta = (await store.listImports(db)).find((m) => m.key === key)!;
      const started = performance.now();
      await store.checkImport(db, meta);
      const ms = performance.now() - started;
      // Remove one model file, as the Sentry issue found it.
      const path = await new Promise<string>((resolve, reject) => {
        const range = IDBKeyRange.bound([key, 'models/'], [key, 'models/￿']);
        const req = db.transaction('files').objectStore('files').openKeyCursor(range);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve((req.result!.key as [string, string])[1]);
      });
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete([key, path]);
      await new Promise((resolve) => (tx.oncomplete = resolve));
      db.close();
      return { ms, path, files: meta.files, checked: meta.checked };
    },
    { sha1, version: IMPORTER_VERSION },
  );
  console.log(`boot check of ${check.files} files: ${check.ms.toFixed(0)} ms`);
  expect(check.ms).toBeLessThan(3000);
  // The seeded import has no size check mark, as an import stored before it: the first start checked it fully and marked it.
  expect(check.checked).toBe(true);

  await page.goto('/');
  const notice = page.locator('#rom-notice .os-banner.info');
  await expect(notice).toContainText(appStrings().rom.reimport);
  await expect(notice).toContainText(`${check.files - 1} of ${check.files} files`);
  await expect(notice).toContainText(appStrings().rom.saveSafe);

  // Choosing the ROM again repairs it; Start playing opens the title, and the new import is marked too.
  await page.locator('#rom-input').setInputFiles(ROM!);
  await reimported(page);
  await toMenu(page);
  const marks = await page.evaluate(async () => {
    const store = (await new Function('u', 'return import(u)')('/__test/store.js')) as Store;
    const db = await store.openDb();
    const imports = await store.listImports(db);
    db.close();
    return imports.map((m) => m.checked);
  });
  expect(marks).toEqual([true]);
  expect(errors).toEqual([]);
});

/** The re-import's session: no setup (answered before), the import, then Start playing to the title. */
async function reimported(page: Page): Promise<void> {
  await expect(page.locator('#importing')).toBeVisible();
  await expect(page.locator('#wizard')).toHaveCount(0);
  await expect(page.locator('#start-playing')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#start-playing')).not.toHaveAttribute('aria-disabled', { timeout: 300_000 });
  await page.locator('#start-playing').click();
}

/** The app's save slot, as stored (the saves database is apart from the imports). */
const storedSave = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get('main');
          get.onsuccess = () => (open.result.close(), resolve(get.result));
        };
      }),
  );

test('an engine update re-imports the ROM: the notice, no setup again, and the save is still there to CONTINUE', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await skipSetup(page);
  // A save in the slot, made in the game.
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  // The replay page does not tick on its own: tick to an idle field (the opening message waits for A).
  const idle = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 3000 && !window.openSinnohApp!.game.canSave(); i++) {
      if (g.snapshot().view.message?.waitingForInput) g.press('a');
      g.advance(1);
    }
    return window.openSinnohApp!.game.canSave();
  });
  expect(idle).toBe(true);
  await saveSlot(page);
  const save = await storedSave(page);
  expect(save).toBeDefined();
  // The stored import now says an older importer made it (as after an update that bumped IMPORTER_VERSION).
  await page.evaluate(async (sha1) => {
    const store = (await new Function('u', 'return import(u)')('/__test/store.js')) as Store;
    const db = await store.openDb();
    const meta = (await store.listImports(db)).find((m) => m.romSha1 === sha1 && !m.addon)!;
    await store.putMeta(db, { ...meta, importerVersion: 'platinum-0' });
    db.close();
  }, romSha1());

  await page.goto('/');
  const notice = page.locator('#rom-notice .os-banner.info');
  await expect(notice).toContainText(appStrings().rom.reimportUpdated);
  await expect(notice).toContainText(appStrings().rom.saveSafe);
  await expect(page.locator('#picker-error')).toBeHidden();
  await page.locator('#rom-input').setInputFiles(ROM!);
  await reimported(page);
  await toMenu(page);
  // The save is untouched, and CONTINUE loads it.
  expect(await storedSave(page)).toEqual(save);
  await expect(page.locator('.tm-continue')).toBeVisible();
  await page.locator('.tm-continue').click();
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForFunction(() => window.openSinnohApp?.game.state.player.zone === 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F', undefined, { timeout: 60_000 });
  expect(errors).toEqual([]);
});
