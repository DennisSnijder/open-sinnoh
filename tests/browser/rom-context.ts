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
