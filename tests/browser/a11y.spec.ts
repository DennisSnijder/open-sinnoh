/**
 * WCAG 2.2 AA on OpenSinnoh's own screens (axe-core, tests/browser/axe.ts): the gallery in both themes, Options
 * (every section, from the title and in the game), the first-run setup, the ROM page and the crash screen. Each
 * screen has no axe violation (contrast, names, roles, focus), Tab reaches its controls in reading order, and with
 * forced colours on the cursor, the selected tab, the switches and the slider still show without colour. Original
 * content only (the fixture pack, no ROM).
 */
import { expect, test, type Page } from '@playwright/test';
import { axe } from './axe.ts';
import { fakeImportWorker, fakeRom, importDone, importProgress } from './fake-import.ts';
import { contrastFailures } from './contrast.ts';
import { skipSetup } from './intro.ts';

/** Fails with every finding spelled out (a bare count hides what to fix). */
async function expectClean(page: Page, include: string | undefined, what: string, contrast = true): Promise<void> {
  const { violations } = await axe(page, include);
  expect(violations.map((v) => `${what}: ${v.id} (${v.impact}) ${v.help}\n  ${v.nodes.slice(0, 6).join('\n  ')}`)).toEqual([]);
  // Contrast is computed through the skins (axe cannot see a border-image face), tests/browser/contrast.ts.
  // Forced colours replace every colour with the user's own system colours: nothing of ours to measure.
  if (contrast) expect(await contrastFailures(page, include ?? 'body'), `${what}: contrast`).toEqual([]);
}

/** Opening animations move boxes: measure once they have run. */
const settled = (page: Page) =>
  page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity))
    .then(() => page.evaluate(() => new Promise(requestAnimationFrame)));

const board = (page: Page) => page.locator('[data-screen="options"]');

async function toMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await page.locator('#title').click();
}

async function optionsFromTitle(page: Page): Promise<void> {
  await skipSetup(page);
  await page.goto('/?packs=fixture&title');
  await toMenu(page);
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
  await page.locator('.tm-options').click();
  await expect(board(page)).toBeVisible();
  await settled(page);
}

/** Tab from the first control of `scope`: the order of `n` focus stops as (top, left) never goes backwards by more than a row. */
async function tabOrder(page: Page, scope: string, n: number): Promise<{ label: string; x: number; y: number }[]> {
  await page.evaluate((s) => document.querySelector<HTMLElement>(s)!.focus(), `${scope} [role="tab"]`);
  const stops: { label: string; x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    stops.push(
      await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const r = e.getBoundingClientRect();
        if (!e.closest('[data-screen="options"]')) return { label: 'outside', x: -1, y: -1 };
        return { label: e.getAttribute('aria-label') ?? e.textContent!.trim().slice(0, 30), x: Math.round(r.left), y: Math.round(r.top) };
      }),
    );
    await page.keyboard.press('Tab');
  }
  return stops;
}

test.describe('options', () => {
  test('Options from the title: every section is clean, and Tab reads it top to bottom', async ({ page }) => {
    test.setTimeout(120_000);
    await optionsFromTitle(page);
    for (const id of ['game', 'device', 'controls', 'data', 'privacy']) {
      await board(page).locator(`[role="tab"][data-section="${id}"]`).click();
      await expect(board(page).locator(`[role="tab"][data-section="${id}"]`)).toHaveAttribute('aria-selected', 'true');
      await settled(page);
      await expectClean(page, '[data-screen="options"]', `options ${id}`);
    }
    // Focus order: the tabs, then the rows from the top, then Back; never back up the page.
    await board(page).locator('[role="tab"][data-section="game"]').click();
    await expect(board(page).locator('[role="tab"][data-section="game"]')).toHaveAttribute('aria-selected', 'true');
    await settled(page);
    // Focus stays in the window (it wraps): the stops before it wraps or leaves are the order.
    const all = await tabOrder(page, '[data-screen="options"]', 14);
    const stops = all.slice(0, all.findIndex((s, i) => i > 0 && (s.label === 'outside' || s.label === all[0]!.label)));
    expect(stops.length, JSON.stringify(all)).toBeGreaterThan(5);
    const ys = stops.map((s) => s.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!, `${stops[i - 1]!.label} then ${stops[i]!.label}`).toBeGreaterThanOrEqual(ys[i - 1]! - 4);
  });

  test('Options with a binding waiting and a question open are clean too', async ({ page }) => {
    test.setTimeout(120_000);
    await optionsFromTitle(page);
    await board(page).locator('[role="tab"][data-section="controls"]').click();
    await board(page).locator('[data-setting="bind/a"] .options-value').click();
    await expect(board(page).locator('[data-setting="bind/a"] .options-value')).toHaveText('PRESS A KEY OR BUTTON');
    await expectClean(page, '[data-screen="options"]', 'options binding');
    await page.keyboard.press('Escape');
  });

  test('forced colours: the cursor, the selected tab, the switches and the slider are still told apart', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ forcedColors: 'active' });
    await optionsFromTitle(page);
    await board(page).locator('[role="tab"][data-section="device"]').click();
    await board(page).locator('[data-setting="theme"] .options-label').click();
    await expect(board(page).locator('[data-setting="theme"].is-cursor')).toHaveCount(1);
    await settled(page);
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const style = (e: Element) => getComputedStyle(e);
      const edges = (e: Element) => {
        const s = style(e);
        return { outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, border: ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(s[`border${k}Width` as 'borderTopWidth'])).some((w) => w > 0) };
      };
      const win = document.querySelector('[data-screen="options"] .os-win')!;
      const tabs = [...document.querySelectorAll('[data-screen="options"] [role="tab"]')];
      const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true')!;
      const other = tabs.find((t) => t.getAttribute('aria-selected') === 'false')!;
      const cursorRow = document.querySelector('[data-screen="options"] .os-row.is-cursor')!;
      const plainRow = document.querySelector('[data-screen="options"] .os-row:not(.is-cursor)')!;
      const sw = document.querySelector('[data-screen="options"] [role="switch"]');
      const cells = [...document.querySelectorAll('[data-screen="options"] .os-sld .cell')];
      const mark = (e: Element) => {
        const s = style(e);
        return [s.backgroundColor, s.borderTopColor, s.outlineStyle, s.boxShadow, s.textDecorationLine, s.borderBottomWidth, s.fontWeight].join('|');
      };
      return {
        window: edges(win),
        selectedTabDiffers: mark(selected) !== mark(other),
        cursorRowDiffers: mark(cursorRow) !== mark(plainRow),
        cursorRowEdge: edges(cursorRow),
        switchHasEdge: sw ? edges(sw.querySelector('.tr') ?? sw) : null,
        sliderOnDiffers: cells.length ? mark(cells.find((c) => c.classList.contains('on')) ?? cells[0]!) !== mark(cells.find((c) => !c.classList.contains('on')) ?? cells.at(-1)!) : null,
        focus: edges(document.activeElement!),
      };
    });
    expect(r.window.border).toBe(true);
    expect(r.selectedTabDiffers, 'selected tab').toBe(true);
    expect(r.cursorRowDiffers, 'cursor row').toBe(true);
    expect(r.cursorRowEdge.outline || r.cursorRowEdge.border, 'cursor row edge').toBe(true);
    expect(r.switchHasEdge?.border || r.switchHasEdge?.outline, 'switch edge').toBe(true);
    expect(r.sliderOnDiffers, 'slider cells').toBe(true);
    expect(r.focus.outline || r.focus.border, 'focus').toBe(true);
    await expectClean(page, '[data-screen="options"]', 'options (forced colours)', false);
    await page.screenshot({ path: 'test-artifacts/a11y/forced-colours-options.png' });
  });

  test('more contrast: the quiet text and lines take the full ink, and the screen stays clean', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ contrast: 'more' });
    await optionsFromTitle(page);
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.os-options')!);
      return [s.getPropertyValue('--os-muted'), s.getPropertyValue('--os-ink')];
    });
    expect(tokens[0]).toBe(tokens[1]);
    await expectClean(page, '[data-screen="options"]', 'options (more contrast)');
  });
});

test('the setup, the ROM page, the crash screen and the gallery are clean', async ({ page, browser }, info) => {
  test.setTimeout(180_000);

  // The first-run setup (the title asks before its first main menu).
  await page.goto('/?packs=fixture&title');
  await toMenu(page);
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'setup');
  await expect(page.getByRole('dialog', { name: 'Setup' })).toBeVisible();
  await settled(page);
  await expectClean(page, undefined, 'setup');

  // The ROM page: no pack params, no import: the call to action.
  const rom = await browser.newContext({ viewport: page.viewportSize()!, hasTouch: info.project.name === 'phone', isMobile: info.project.name === 'phone', deviceScaleFactor: info.project.name === 'phone' ? 3 : 1 });
  const romPage = await rom.newPage();
  await romPage.goto('/');
  await expect(romPage.locator('.rom-panel')).toBeVisible();
  await settled(romPage);
  await expectClean(romPage, undefined, 'rom page');
  await rom.close();

  // The ROM page's session in both themes: the import, the first-run setup, Start playing held, then ready.
  for (const colorScheme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({ colorScheme, viewport: page.viewportSize()!, hasTouch: info.project.name === 'phone', isMobile: info.project.name === 'phone', deviceScaleFactor: info.project.name === 'phone' ? 3 : 1 });
    const p = await ctx.newPage();
    await fakeImportWorker(p);
    await p.goto('/');
    await p.locator('#rom-input').setInputFiles(fakeRom());
    await importProgress(p, 0, 'Converting maps', 3, 8);
    await expect(p.locator('#wizard')).toBeVisible();
    await settled(p);
    await expectClean(p, undefined, `rom page setup (${colorScheme})`);
    await importDone(p, 0);
    await p.locator('#wizard .os-choice', { hasText: 'Skip' }).click();
    await expect(p.locator('#start-playing')).not.toHaveAttribute('aria-disabled');
    await settled(p);
    await expectClean(p, undefined, `rom page ready (${colorScheme})`);
    await ctx.close();
  }

  // The crash screen: a game tick throws.
  const crashPage = await (await browser.newContext({ viewport: page.viewportSize()!, hasTouch: info.project.name === 'phone', isMobile: info.project.name === 'phone' })).newPage();
  await skipSetup(crashPage);
  await crashPage.goto('/?packs=fixture');
  await crashPage.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 10 && !window.openSinnohApp!.sceneLoading());
  await crashPage.evaluate(() => {
    const game = window.openSinnohApp!.game;
    game.step = () => {
      throw new Error('a11y test crash');
    };
  });
  await expect(crashPage.getByRole('alertdialog', { name: 'Something went wrong' })).toBeVisible();
  await settled(crashPage);
  await expectClean(crashPage, undefined, 'crash');
  await crashPage.context().close();
});

for (const theme of ['dark', 'light'] as const) {
  test(`the gallery, ${theme} theme, is clean`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/?ui-gallery');
    await page.waitForFunction(() => document.body.dataset.galleryReady !== undefined);
    await settled(page);
    await expectClean(page, `.gal-theme[data-theme="${theme}"]`, `gallery ${theme}`);
  });
}
