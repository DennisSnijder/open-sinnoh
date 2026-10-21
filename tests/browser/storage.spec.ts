/**
 * Storage and saves on the fixture pack (no ROM), at desktop and phone:
 * - the import refuses to start when the browser has too little free space (a stubbed `estimate()`), and goes on
 *   when it has enough;
 * - a partial import (the meta row says more files than the store holds) shows the ROM page with the reason
 *   instead of booting into a crash, as a calm re-import notice; an import from an older importer shows the same notice,
 *   asks no setup again, and leaves the saves database alone;
 * - a save file from the previous release (git tag v0.8) imports at the title and CONTINUE loads it; a file that is
 *   not a save, a newer save, a save made with a mod that is off and a damaged save each say what is wrong and leave
 *   the stored save as it was;
 * - a save write that hits the browser's quota says so, and the previous save stays in its slot.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { IMPORTER_VERSION } from '../../packages/app/src/importer.ts';
import { fakeImportWorker, fakeRom, importDone } from './fake-import.ts';
import { skipSetup } from './intro.ts';
import { saveGame } from './save.ts';

const board = (page: Page) => page.locator('[data-screen="options"]');
const RELEASE_SAVE = join(import.meta.dirname, '../../packages/game/test/saves/release-v0.8.json');
const MB = 1024 * 1024;
type Store = typeof import('../../packages/app/src/store.ts');

/** The browser's `estimate()` answers with these numbers. */
const stubEstimate = (page: Page, usage: number, quota: number) =>
  page.addInitScript(
    ({ usage, quota }) => {
      navigator.storage.estimate = async () => ({ usage, quota });
    },
    { usage, quota },
  );

const notAROM = { name: 'rom.nds', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096) };

test('the import refuses to start with too little free space, and says how much it needs', async ({ page }) => {
  await stubEstimate(page, 200 * MB, 300 * MB);
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  // The space check comes before the file is read: this one is no ROM at all.
  await page.locator('#rom-input').setInputFiles(notAROM);
  const error = page.locator('#picker-error');
  await expect(error).toContainText('Not enough storage');
  await expect(error).toContainText('about 250 MB free');
  await expect(error).toContainText('this browser has 100.0 MB');
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#importing')).toBeHidden();
});

test('with enough free space the same file is checked as a ROM', async ({ page }) => {
  await stubEstimate(page, 100 * MB, 4000 * MB);
  await page.goto('/');
  await page.locator('#rom-input').setInputFiles(notAROM);
  await expect(page.locator('#picker-error')).toContainText('not supported');
  await expect(page.locator('#picker-error')).not.toContainText('Not enough storage');
});

test('a partial import leads to the ROM page with the reason', async ({ page }) => {
  await page.goto('/__opensinnoh/packs.json');
  await page.evaluate(async (version) => {
    const store = (await new Function('u', 'return import(u)')('/__test/store.js')) as Store;
    const db = await store.openDb();
    const key = store.importKey('0123456789abcdef0123456789abcdef01234567', version);
    // Three files were meant to be stored; one made it.
    await store.putFiles(db, key, [['@pack-data.json', new Uint8Array(10)]]);
    await store.putMeta(db, { key, romSha1: '0123456789abcdef0123456789abcdef01234567', romName: 'Pokémon Platinum', importerVersion: version, files: 3, bytes: 30, importedAt: new Date().toISOString() });
    db.close();
  }, IMPORTER_VERSION);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  // A calm notice (the info tone, not an error): what happened, and that the save is safe.
  const notice = page.locator('#rom-notice .os-banner.info');
  await expect(notice).toContainText('We need to re-import your ROM');
  await expect(notice).toContainText('1 of 3 files');
  await expect(notice).toContainText('your save is safe');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(page.locator('#picker-error')).toBeHidden();
  await expect(page.locator('#rom-input')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an engine update: the re-import notice, no setup for a player who answered, Start playing, the save untouched', async ({ page }) => {
  await fakeImportWorker(page);
  await skipSetup(page);
  await page.goto('/__opensinnoh/packs.json');
  // An import from an older importer, and a save in the saves database (its own database: an import never touches it).
  await page.evaluate(async () => {
    const store = (await new Function('u', 'return import(u)')('/__test/store.js')) as Store;
    const db = await store.openDb();
    const sha1 = '0123456789abcdef0123456789abcdef01234567';
    await store.putFiles(db, store.importKey(sha1, 'platinum-1'), [['@pack-data.json', new Uint8Array(10)]]);
    await store.putMeta(db, { key: store.importKey(sha1, 'platinum-1'), romSha1: sha1, romName: 'Pokémon Platinum', importerVersion: 'platinum-1', files: 1, bytes: 10, importedAt: new Date().toISOString() });
    db.close();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('lantern-nds-saves', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('saves');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('saves', 'readwrite');
        tx.objectStore('saves').put('{"a save":1}', 'main');
        tx.oncomplete = () => (open.result.close(), resolve());
      };
    });
  });
  await page.goto('/');
  const notice = page.locator('#rom-notice .os-banner.info');
  await expect(notice).toContainText('We need to re-import your ROM for the updated engine.');
  await expect(notice).toContainText("Don't worry, your save is safe.");
  await page.locator('#rom-input').setInputFiles(fakeRom());
  // Answered before: no setup, only the import and Start playing.
  await expect(page.locator('#importing')).toBeVisible();
  await expect(page.locator('#wizard')).toHaveCount(0);
  await expect(page.locator('#start-playing')).toHaveAttribute('aria-disabled', 'true');
  await importDone(page, 0);
  await expect(page.locator('#start-playing')).toBeFocused();
  await expect(page.locator('#start-playing')).not.toHaveAttribute('aria-disabled');
  const save = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get('main');
          get.onsuccess = () => (open.result.close(), resolve(get.result));
        };
      }),
  );
  expect(save).toBe('{"a save":1}');
});

/** The title (already loading) to its main menu. */
async function toMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await page.locator('#title').click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
}

/** To the title's main menu, then its Options window on the DATA page. */
async function toData(page: Page): Promise<void> {
  await skipSetup(page);
  await page.goto('/?packs=fixture&title');
  await toMenu(page);
  await page.locator('.tm-options').click();
  await expect(board(page)).toBeVisible();
  await board(page).locator('[role="tab"][data-section="data"]').click();
}

/** DATA › IMPORT SAVE with this file, answering YES to the question. */
async function importSave(page: Page, file: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), board(page).locator('[data-setting="importSave"] .options-value').click()]);
  await chooser.setFiles(file);
  await board(page).locator('[data-tap="settings:answer:yes"]').click();
}

/** The stored save slot's text, or null. */
const slot = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get('main');
          get.onsuccess = () => {
            open.result.close();
            resolve((get.result as string | undefined) ?? null);
          };
        };
      }),
  );

test('the previous release\'s save imports and CONTINUE loads it; files that are not usable saves say why and change nothing', async ({ page }, info) => {
  test.setTimeout(180_000);
  page.on('dialog', (d) => {
    throw new Error(`a browser dialog: ${d.message()}`);
  });
  const release = JSON.parse(readFileSync(RELEASE_SAVE, 'utf8')) as { state: Record<string, unknown> };
  const write = (name: string, text: string) => {
    const file = info.outputPath(name);
    writeFileSync(file, text);
    return file;
  };

  // The save the v0.8 release wrote.
  await toData(page);
  await importSave(page, RELEASE_SAVE);
  await toMenu(page);
  await expect(page.locator('.tm-continue')).toContainText('Ari');
  const stored = await slot(page);
  expect(stored).not.toBeNull();

  // Each file that cannot be used: its reason in the description window, the stored save as it was.
  const cases: [string, string, string][] = [
    ['notes.json', 'These are just my notes, not a save.', 'not an OpenSinnoh save'],
    ['other.json', JSON.stringify({ hello: 'world' }), 'not an OpenSinnoh save'],
    ['newer.json', JSON.stringify({ ...release, state: { ...release.state, schemaVersion: 99 } }), 'newer version of OpenSinnoh'],
    ['mod.json', JSON.stringify({ ...release, state: { ...release.state, packs: [{ id: 'fixture', version: '0.1.0' }, { id: 'demo-mod', version: '0.1.0' }] } }), 'needs demo-mod@0.1.0'],
    ['damaged.json', JSON.stringify({ ...release, state: { ...release.state, names: undefined } }), 'damaged or incomplete'],
  ];
  await toData(page);
  for (const [name, text, message] of cases) {
    await importSave(page, write(name, text));
    await expect(board(page).locator('.options-desc'), name).toContainText(message);
    expect(await slot(page), name).toBe(stored);
  }
  await expect(board(page)).toBeVisible();
});

/** The game on its idle field (wall clock). */
async function toField(page: Page): Promise<void> {
  await skipSetup(page);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
}

test('a save the browser has no room for says so and keeps the old save', async ({ page }) => {
  test.setTimeout(120_000);
  await toField(page);
  await saveGame(page);
  const before = await slot(page);
  expect(before).not.toBeNull();

  // The next write hits the quota.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'saves') throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Start menu', exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="save"]').click();
  // A save already exists: the game asks before replacing it.
  await page.locator('[data-screen="save"]').getByRole('button', { name: 'YES' }).click();
  await expect(page.locator('.ui-notice')).toContainText('out of storage space');
  await expect(page.locator('.ui-notice')).toContainText('previous save is kept');
  expect(await slot(page)).toBe(before);
});
