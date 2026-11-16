/** Read-only imported files shared by a worker's browser; games and pages remain independent. */
import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { SETUP_DONE } from './intro.ts';

const contexts = new WeakMap<Browser, Map<string, Promise<BrowserContext>>>();

/** The browser owns this context's lifetime. Callers close their pages, not this context. */
export function romContext(browser: Browser, use: BrowserContextOptions): Promise<BrowserContext> {
  const options: BrowserContextOptions = {
    baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch,
    isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, acceptDownloads: true,
  };
  const key = JSON.stringify(options);
  let cache = contexts.get(browser);
  if (!cache) contexts.set(browser, (cache = new Map()));
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const context = await browser.newContext(options);
      try {
        const seed = await context.newPage();
        const started = Date.now();
        await seedRomImport(seed);
        await seed.close();
        console.log(`ROM browser store seeded in ${Date.now() - started} ms (${use.viewport?.width}×${use.viewport?.height})`);
        return context;
      } catch (error) {
        await context.close();
        throw error;
      }
    })();
    cache.set(key, pending);
  }
  return pending;
}

/** Match a fresh device without rewriting the immutable imported files. */
export async function resetRomDevice(page: Page): Promise<void> {
  await page.goto('/__opensinnoh/packs.json');
  await page.evaluate(async (entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('lantern-nds-saves');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Previous ROM test still has its save database open'));
    });
  }, SETUP_DONE);
}

export async function freshRomPage(browser: Browser, use: BrowserContextOptions): Promise<Page> {
  const page = await (await romContext(browser, use)).newPage();
  try {
    await resetRomDevice(page);
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

let shared: { key: string; page: Promise<Page> } | null = null;

/**
 * A page at `/?replay` with the game ready, kept across tests for the worker's lifetime. In parallel mode Playwright
 * runs a file's `beforeAll` before each test (each test is its own group), and opening the game every time cost about
 * as much as the tests that ran on it. Specs that pass the same `group` share the page: each of their tests starts its
 * own game (a reset, or a replay's setup lines). A worker keeps one page: asking for another group or other options
 * closes it. A failed test ends the worker, so the next test starts on a new page. Callers attach their listeners per
 * test and never close the page.
 */
export function replayPage(browser: Browser, use: BrowserContextOptions, group: string): Promise<Page> {
  const key = JSON.stringify([group, use]);
  if (shared?.key === key) return shared.page;
  const previous = shared?.page;
  const page = (async () => {
    // A page that failed to open has already failed its test.
    await previous?.then((p) => p.close(), () => undefined);
    const page = await (await romContext(browser, use)).newPage();
    await resetRomDevice(page);
    await page.goto('/?replay');
    await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
    return page;
  })();
  shared = { key, page };
  page.catch(() => {
    if (shared?.page === page) shared = null;
  });
  return page;
}
