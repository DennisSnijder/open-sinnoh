/**
 * The startup splash (index.html `#splash`, packages/app/src/splash.ts): the wordmark and a busy bar from the first
 * paint, before any script runs, themed and clear of the notch; the app's phases on it; a hand-over to the title with
 * no blank frame between them (sampled every frame); reduced motion; and a stuck phase showing its hint and Reload.
 */
import { expect, test, type Page } from '@playwright/test';
import { TOKENS } from '../../packages/ui/src/tokens.ts';
import { skipSetup } from './intro.ts';

const SHOTS = 'test-artifacts/splash';
/** The app's entry (vite.browser.config.ts names it `app`): held, the page stays as the HTML drew it. */
const holdApp = (page: Page) => page.route('**/app.js', () => {});
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('shows before any script, themed and clear of the safe areas', async ({ page }, info) => {
  await holdApp(page);
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/', { waitUntil: 'commit' });
    const splash = page.locator('#splash');
    await expect(splash).toBeVisible();
    await expect(splash.getByRole('img', { name: 'OpenSinnoh' })).toBeVisible();
    await expect(splash.getByRole('progressbar', { name: 'Loading game…' })).toBeVisible();
    // The app's module never ran.
    expect(await page.evaluate(() => document.getElementById('os-tokens'))).toBeNull();
    await expect(splash).toHaveCSS('background-color', rgb(TOKENS.color.bg![theme]));
    await expect(splash.locator('.lt b')).toHaveCSS('color', rgb(TOKENS.color.ink![theme]));
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}.png` });
  }
  // The stored theme wins over the system's, before the first paint.
  await page.addInitScript(() => localStorage.setItem('lantern-nds:theme', 'light'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#splash')).toHaveCSS('background-color', rgb(TOKENS.color.bg!.light));

  // A notch and a home indicator (os.css's --sat/--sab, which env() fills on a phone): the content stays inside them.
  await page.evaluate(() => document.documentElement.style.cssText = '--sat: 60px; --sab: 40px; --sal: 50px; --sar: 50px');
  await page.setViewportSize({ width: 360, height: 240 });
  const box = await page.evaluate(() => {
    const parts = [...document.querySelectorAll('#splash > *')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect());
    return { top: Math.min(...parts.map((r) => r.top)), bottom: Math.max(...parts.map((r) => r.bottom)), left: Math.min(...parts.map((r) => r.left)), right: Math.max(...parts.map((r) => r.right)) };
  });
  expect(box.top).toBeGreaterThanOrEqual(60);
  expect(box.left).toBeGreaterThanOrEqual(50);
  expect(box.right).toBeLessThanOrEqual(360 - 50);
});

test('a stuck start shows a hint and a Reload', async ({ page }) => {
  // The download of the game's script never ends.
  await page.clock.install();
  await holdApp(page);
  await page.goto('/', { waitUntil: 'commit' });
  // The splash's script has run (after the stylesheet, as a parser-blocking script does).
  await expect.poll(() => page.evaluate(() => typeof window.openSinnohSplash)).toBe('object');
  const hint = page.locator('#splash-hint');
  await expect(hint).toBeHidden();
  await page.clock.runFor(31_000);
  await expect(hint).toContainText('Loading is taking longer than usual');
  const reload = hint.getByRole('button', { name: 'Reload' });
  // No skins without the app's script: the plain button, still a 44-px target.
  expect((await reload.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await Promise.all([page.waitForEvent('framenavigated'), reload.click()]);
});

test('a stuck storage read names its phase', async ({ page }) => {
  // IndexedDB never answers (as when another tab holds it open in some browsers).
  await page.addInitScript(() => {
    indexedDB.open = () => ({}) as IDBOpenDBRequest;
  });
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#splash').getByRole('progressbar', { name: 'Reading your game data…' })).toBeVisible();
  await page.clock.runFor(21_000);
  await expect(page.locator('#splash-hint')).toContainText('If OpenSinnoh is open in another tab, close it, then reload.');
  // The app's script ran: its real button.
  await expect(page.locator('#splash')).not.toHaveClass(/bare/);
});

/**
 * Each frame from the first one, what is on screen: the splash (and its opacity), the title (and its fade's opacity).
 * Recorded in the page by requestAnimationFrame until the splash is gone and the title's fade is done.
 */
async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: { splash: number | null; title: number | null; t: number }[] = [];
    (window as unknown as { splashFrames: typeof frames }).splashFrames = frames;
    const step = () => {
      const s = document.getElementById('splash');
      const fade = document.querySelector<HTMLElement>('.title-fade');
      const title = fade && fade.style.opacity !== '' ? Number(fade.style.opacity) : null;
      frames.push({ splash: s?.isConnected ? Number(getComputedStyle(s).opacity) : null, title, t: performance.now() });
      if (s || title === null || title > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

const frames = (page: Page) => page.evaluate(() => (window as unknown as { splashFrames: { splash: number | null; title: number | null; t: number }[] }).splashFrames);

test('hands over to the title with no blank frame', async ({ page }) => {
  test.setTimeout(120_000);
  await skipSetup(page);
  await recordFrames(page);
  await page.goto('/?packs=fixture&title');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  // From the frame the body is parsed (the page paints nothing before its stylesheet anyway).
  const all = await frames(page);
  const seen = all.slice(all.findIndex((f) => f.splash !== null));
  // The phases were named on the way.
  expect(await page.evaluate(() => performance.getEntriesByType('mark').map((m) => m.name).filter((n) => n.startsWith('splash: ')))).toEqual(['splash: Loading game…', 'splash: Preparing graphics…', 'splash: done']);
  expect(seen[0]!.splash).toBe(1);
  // Every frame shows the splash (a part of it while it fades) or the title past its first black frame.
  const blank = seen.filter((f) => !((f.splash ?? 0) > 0 || (f.title !== null && f.title < 1)));
  expect(blank, JSON.stringify(seen)).toEqual([]);
});

test('reduced motion: the bar holds still and the splash goes at once', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await skipSetup(page);
  await holdApp(page);
  await page.goto('/', { waitUntil: 'commit' });
  // The stylesheet is in (the bar is laid out as cells).
  await expect(page.locator('#splash .cells')).toHaveCSS('display', 'flex');
  const busy = () => page.locator('#splash .cells').evaluate((e) => getComputedStyle(e, '::after').animationName);
  expect(await busy()).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await busy()).toBe('os-busy');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.unroute('**/app.js');
  await recordFrames(page);
  await page.goto('/?packs=fixture&title');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 30_000 });
  const seen = await frames(page);
  expect(seen.filter((f) => f.splash !== null && f.splash < 1)).toEqual([]);
});

test('hands over to the ROM page on a first visit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#rom')).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0);
  expect(await page.evaluate(() => performance.getEntriesByType('mark').map((m) => m.name).filter((n) => n.startsWith('splash: ')))).toEqual(['splash: Loading game…', 'splash: Reading your game data…', 'splash: done']);
});
