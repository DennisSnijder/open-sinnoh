/**
 * Regenerates public/screenshots/ (the manifest's install-dialog pictures) from the ROM page, which shows before
 * any ROM exists: original art only, never ROM content. Builds the browser-test app, serves it, and screenshots
 * the page at the two form factors the manifest lists (wide 1280×720, narrow 390×844, both at DPR 1 so the
 * files are exactly those sizes). Run it when the ROM page changes: `pnpm exec tsx tools/manifest-screenshots.ts`.
 */
import { mkdirSync } from 'node:fs';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { browserExecutable } from './browser.ts';

const PORT = 4199;
const config = { configFile: 'vite.browser.config.ts', mode: 'browser-test', logLevel: 'warn' as const };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
const browser = await chromium.launch({ executablePath: browserExecutable(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
mkdirSync('public/screenshots', { recursive: true });
try {
  for (const [name, width, height] of [['wide', 1280, 720], ['narrow', 390, 844]] as const) {
    // Reduced motion: the wordmark shows its static frame, not a moment of its intro.
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.locator('#picker').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `public/screenshots/rom-page-${name}.png` });
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
