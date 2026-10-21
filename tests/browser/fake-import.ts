/**
 * The ROM page's import worker, stood in for (no ROM needed): the page's `Worker` becomes a stub that records what
 * it was asked to import, and the spec sends the worker's messages (progress, done, error) when it wants them. So a
 * spec controls when an import finishes and can see the page before and after. The real worker runs in the ROM
 * specs (platinum.rom.spec.ts, storage.rom.spec.ts, followers.rom.spec.ts).
 */
import type { Page } from '@playwright/test';
import type { ImportMessage } from '../../packages/app/src/import-worker.ts';

interface Fake {
  request: { name: string; addon: boolean } | null;
  onmessage: ((e: { data: ImportMessage }) => void) | null;
}
type FakeWindow = Window & { fakeImports: Fake[] };

/** Installs the stub before the page's scripts run. */
export async function fakeImportWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as FakeWindow;
    w.fakeImports = [];
    class FakeWorker {
      request: Fake['request'] = null;
      onmessage: Fake['onmessage'] = null;
      onerror: unknown = null;
      constructor() {
        w.fakeImports.push(this);
      }
      postMessage(m: { rom: File; addon?: boolean }): void {
        this.request = { name: m.rom.name, addon: !!m.addon };
      }
      terminate(): void {}
    }
    (window as unknown as { Worker: unknown }).Worker = FakeWorker;
  });
}

/** The imports the page has started, in order. */
export const fakeImports = (page: Page) => page.evaluate(() => (window as unknown as FakeWindow).fakeImports.map((f) => f.request));

/** Import `i` sends a message. */
export async function sendImport(page: Page, i: number, m: ImportMessage): Promise<void> {
  await page.waitForFunction((i) => (window as unknown as FakeWindow).fakeImports[i]?.onmessage, i);
  await page.evaluate(([i, m]) => (window as unknown as FakeWindow).fakeImports[i as number]!.onmessage!({ data: m as ImportMessage }), [i, m] as const);
}

/** Import `i` is at `done` of `total`. */
export const importProgress = (page: Page, i: number, stage: string, done: number, total: number) => sendImport(page, i, { type: 'progress', stage, done, total });

/** Import `i` finishes (a base game, or the HeartGold add-on). Nothing is stored: the meta names no stored files. */
export function importDone(page: Page, i: number, addon = false): Promise<void> {
  const sha1 = (addon ? 'a' : 'b').repeat(40);
  return sendImport(page, i, {
    type: 'done',
    ms: 14_000,
    meta: {
      key: `${sha1}:fake`,
      romSha1: sha1,
      romName: addon ? 'Pokémon HeartGold Version (USA)' : 'Pokémon Platinum Version (USA)',
      importerVersion: 'fake',
      files: 1,
      bytes: 1,
      importedAt: new Date(0).toISOString(),
      ...(addon ? { addon: 'hgss-followers' as const } : {}),
    },
  });
}

/** A file the size of nothing much: it passes the page's size check (the stub never reads it). */
export const fakeRom = (name = 'platinum.nds') => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096) });
