/**
 * Seeds a browser context with the ROM import, as if the player had picked the ROM: the files the import
 * worker writes (from the run's cached import, tests/rom.ts) go into IndexedDB through the app's own store
 * (packages/app/src/store.ts), with the same key and meta. Specs that need the imported game but do not
 * test the import use this; platinum.rom.spec.ts keeps the real in-browser import (desktop).
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { HGSS_ROMS, SUPPORTED_ROMS } from '@opensinnoh/nds';
import { importHgssFollowers, platinumSpeciesOf } from '@opensinnoh/importer';
import { ADDON_VERSION, IMPORTER_VERSION } from '../../packages/app/src/importer.ts';
import { PACK_DATA_PATH } from '../../packages/app/src/store.ts';
import { romFullFiles, romSha1 } from '../rom.ts';
import { SETUP_DONE } from './intro.ts';

const ROUTE = '/__test-rom-import';
/** Bytes per transfer: the DevTools pipe takes at most 100 MB per message (base64 included). */
const PART_BYTES = 16 * 1024 * 1024;

type Store = typeof import('../../packages/app/src/store.ts');

/** Writes the import into the page's origin. Navigates the page (to a static pack endpoint). */
export async function seedRomImport(page: Page): Promise<void> {
  const files = romFullFiles();
  const sha1 = romSha1();
  await writeImport(page, files, { romSha1: sha1, romName: SUPPORTED_ROMS[sha1]!.name, importerVersion: IMPORTER_VERSION });
  // The setup's answers too (onboarding.spec.ts tests the setup): the title goes straight to the main menu.
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, SETUP_DONE);
}

/**
 * Writes an import's files and its meta row (store.ts), as the import worker does, in parts the DevTools pipe takes.
 * Navigates the page (to a static pack endpoint).
 */
async function writeImport(page: Page, files: [string, Uint8Array][], meta: { romSha1: string; romName: string; importerVersion: string; addon?: 'hgss-followers' }): Promise<void> {
  const parts: [string, Uint8Array][][] = [[]];
  let size = 0;
  for (const file of files) {
    if (size + file[1].byteLength > PART_BYTES && parts.at(-1)!.length) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1)!.push(file);
    size += file[1].byteLength;
  }
  await page.route(`**${ROUTE}/*`, (route) => {
    const part = parts[Number(new URL(route.request().url()).pathname.split('/').pop())]!;
    return route.fulfill({ body: Buffer.concat(part.map(([, bytes]) => bytes)), contentType: 'application/octet-stream' });
  });
  // Any same-origin page will do; this one boots nothing.
  await page.goto('/__opensinnoh/packs.json');
  // The browser-test build exposes the app's store as a module (a Function, so the test transpiler leaves the import alone).
  const STORE = '/__test/store.js';
  const key = await page.evaluate(
    async ({ sha1, version, STORE }) => {
      const store = (await new Function('u', 'return import(u)')(STORE)) as Store;
      const key = store.importKey(sha1, version);
      const db = await store.openDb();
      await store.deleteImport(db, key);
      db.close();
      return key;
    },
    { sha1: meta.romSha1, version: meta.importerVersion, STORE },
  );
  for (const [n, part] of parts.entries()) {
    await page.evaluate(
      async ({ key, STORE, url, index }) => {
        const store = (await new Function('u', 'return import(u)')(STORE)) as Store;
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let at = 0;
        const files = index.map(([path, size]): [string, Uint8Array] => [path, bytes.subarray(at, (at += size))]);
        if (at !== bytes.length) throw new Error(`seed: ${bytes.length} bytes for ${at} indexed`);
        const db = await store.openDb();
        await store.putFiles(db, key, files);
        db.close();
      },
      { key, STORE, url: `${ROUTE}/${n}`, index: part.map(([path, bytes]) => [path, bytes.byteLength] as const) },
    );
  }
  const row = { key, ...meta, files: files.length, bytes: files.reduce((n, [, b]) => n + b.byteLength, 0), importedAt: new Date().toISOString() };
  await page.evaluate(
    async ({ row, STORE }) => {
      const store = (await new Function('u', 'return import(u)')(STORE)) as Store;
      const db = await store.openDb();
      await store.putMeta(db, row);
      db.close();
    },
    { row, STORE },
  );
  await page.unroute(`**${ROUTE}/*`);
}

let hgss: Promise<{ files: [string, Uint8Array][]; sha1: string; name: string }> | null = null;

/**
 * Seeds the HGSS follower add-on (OPENSINNOH_HGSS_ROM) as the ROM page's add-on picker leaves it: the add-on's import,
 * made once per worker in Node (importer `importHgssFollowers`). Call after `seedRomImport`.
 */
export async function seedHgssAddon(page: Page): Promise<void> {
  const rom = process.env.OPENSINNOH_HGSS_ROM;
  if (!rom) throw new Error('seedHgssAddon: OPENSINNOH_HGSS_ROM is not set');
  hgss ??= (async () => {
    const { pack, assets, rom: id } = await importHgssFollowers(new Uint8Array(readFileSync(rom)), platinumSpeciesOf);
    const files: [string, Uint8Array][] = [[PACK_DATA_PATH, new TextEncoder().encode(JSON.stringify(pack))], ...assets];
    return { files, sha1: Object.entries(HGSS_ROMS).find(([, r]) => r === id)![0], name: id.name };
  })();
  const { files, sha1, name } = await hgss;
  await writeImport(page, files, { romSha1: sha1, romName: name, importerVersion: ADDON_VERSION, addon: 'hgss-followers' });
}
