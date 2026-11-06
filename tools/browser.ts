/**
 * Finds an installed Chromium (never downloads one; CI installs it with `playwright install`) and launches it as an owned server process:
 * launchServer + connect, then kill on close. A plain `browser.close()` can hang after
 * replay runs.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';

const CANDIDATES = [
  'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
  'chrome-headless-shell-linux64/chrome-headless-shell',
  'chrome-headless-shell-win64/chrome-headless-shell.exe',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-win64/chrome.exe',
];

const SYSTEM = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

export function browserExecutable(): string {
  const explicit = process.env.OPENSINNOH_BROWSER_EXECUTABLE;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`OPENSINNOH_BROWSER_EXECUTABLE does not exist: ${explicit}`);
    return explicit;
  }
  // Playwright's cache: macOS, Linux, Windows.
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright')].filter((p): p is string => !!p && existsSync(p));
  for (const root of roots) {
    // Headless shells first, newest version first.
    const versions = readdirSync(root).sort().reverse();
    for (const rel of CANDIDATES) for (const v of versions) if (existsSync(join(root, v, rel))) return join(root, v, rel);
  }
  // The browser this Playwright version installs (`playwright install chromium`, as CI does), wherever it put it.
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const system = SYSTEM.find((p) => existsSync(p));
  if (system) return system;
  throw new Error('no installed Chromium found: set OPENSINNOH_BROWSER_EXECUTABLE or PLAYWRIGHT_BROWSERS_PATH (opensinnoh does not download browsers)');
}

export async function launchReplayBrowser(): Promise<{ browser: Browser; close(): Promise<void> }> {
  const server = await chromium.launchServer({ executablePath: browserExecutable(), headless: true, host: '127.0.0.1', port: 0 });
  let browser: Browser;
  try {
    browser = await chromium.connect(server.wsEndpoint());
  } catch (e) {
    await server.kill();
    throw e;
  }
  return {
    browser,
    async close() {
      try {
        for (const context of browser.contexts()) await context.close();
      } finally {
        await server.kill();
      }
    },
  };
}
