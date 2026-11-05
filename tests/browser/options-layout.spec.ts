/**
 * The Options window at each size, on the fixture pack from the title: it grows with the room, two columns of grouped
 * rows from 1120 px, and the pad walks them: up and down in reading order across the columns, left and right on a
 * row with no value to change to the row beside it, and on a value row they change the value and stay.
 */
import { expect, test, type Page } from '@playwright/test';
import { skipSetup } from './intro.ts';
import { hold, installPads, PAD, press, run } from './pad.ts';

test.skip(({ isMobile }) => isMobile, 'a window size test: the phone is in options.rom.spec.ts');

const board = (page: Page) => page.locator('[data-screen="options"]');
const tab = (page: Page, s: string) => board(page).locator(`[role="tab"][data-section="${s}"]`);
const at = (page: Page) => page.evaluate(() => document.querySelector('[data-screen="options"] .options-row.is-cursor')?.getAttribute('data-setting') ?? null);

/** One step by key: a held pad button repeats when frames are slow on a busy machine, which a walk cannot count on. */
const key = async (page: Page, code: string) => {
  await page.keyboard.press(code);
  await run(page, 150);
};

async function optionsFromTitle(page: Page): Promise<void> {
  await installPads(page);
  await skipSetup(page);
  await page.goto('/?packs=fixture&title');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await page.locator('#title').click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
  await page.locator('.tm-options').click();
  await expect(board(page)).toBeVisible();
}

/** The window, the columns of the open page, and whether its list scrolls. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-screen="options"]')!;
    const b = root.querySelector('.os-panel')!.getBoundingClientRect();
    const list = root.querySelector<HTMLElement>('.options-rows')!;
    const rows = [...root.querySelectorAll('.options-row')].map((r) => r.getBoundingClientRect());
    return {
      width: b.width,
      height: b.height,
      inView: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      whole: [b.left, b.top, b.width, b.height].every((v) => Number.isInteger(v)),
      columns: new Set(rows.map((r) => Math.round(r.left))).size,
      scrolls: list.scrollHeight > list.clientHeight,
      pageScrolls: document.scrollingElement!.scrollHeight > innerHeight || document.scrollingElement!.scrollWidth > innerWidth,
      sideways: list.scrollWidth > list.clientWidth,
    };
  });

for (const [width, height, wide, columns, fits] of [
  [1000, 750, 720, 1, false],
  [1280, 720, 1232, 2, false],
  [1440, 900, 1240, 2, true],
  [1920, 1080, 1440, 2, true],
  [2560, 1440, 1536, 2, true],
] as const) {
  test(`${width}×${height}: the window takes the room, ${columns} column(s)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await optionsFromTitle(page);
    await tab(page, 'controls').click();
    await expect(tab(page, 'controls')).toHaveAttribute('aria-selected', 'true');
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
    const m = await measure(page);
    expect(m, JSON.stringify(m)).toMatchObject({ width: wide, inView: true, whole: true, columns, pageScrolls: false, sideways: false });
    // The longest page shows whole where the screen is tall enough.
    if (fits) expect(m.scrolls).toBe(false);
    // Every page keeps the order of its slots and a heading over each group.
    await expect(board(page).locator('.options-heading')).toContainText(['Play', 'D-pad', 'Face buttons', 'Other buttons', 'Setup']);
  });
}

test('the pad across two columns: reading order up and down, the row beside on a button, the value on a choice', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await optionsFromTitle(page);
  await press(page, PAD.r);
  await press(page, PAD.r);
  await expect(tab(page, 'controls')).toHaveAttribute('aria-selected', 'true');
  const rows = await board(page).locator('[data-setting]').evaluateAll((r) => r.map((e) => e.getAttribute('data-setting')!));
  const left = (id: string) => board(page).locator(`[data-setting="${id}"]`).evaluate((r) => r.getBoundingClientRect().left);
  const top = (id: string) => board(page).locator(`[data-setting="${id}"]`).evaluate((r) => r.getBoundingClientRect().top);

  // A choice row: right changes the value and stays.
  expect(await at(page)).toBe(rows[0]);
  const value = () => board(page).locator(`[data-setting="${rows[0]}"] .options-value.on`).innerText();
  const before = await value();
  await key(page, 'ArrowRight');
  await expect.poll(value).not.toBe(before);
  expect(await at(page)).toBe(rows[0]);

  // Down walks the page in order, over the column break: the last row of the first column, then the top of the second.
  const first = await left(rows[0]!);
  const end = await board(page).locator('[data-setting]').evaluateAll((r, x) => r.filter((e) => Math.round(e.getBoundingClientRect().left) === Math.round(x as number)).length, first);
  expect(end).toBeGreaterThan(5);
  while ((await at(page)) !== rows[end - 1]) await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  expect(await at(page)).toBe(rows[end]);
  expect(await left(rows[end]!)).toBeGreaterThan(first);
  expect(await top(rows[end]!)).toBeLessThan(await top(rows[end - 1]!));
  // Up goes back the same way.
  await key(page, 'ArrowUp');
  expect(await at(page)).toBe(rows[end - 1]);

  // Left and right on a binding (a button row): the row beside it, at the same height, and back; past the edge, nothing.
  while ((await at(page)) !== 'bind/up') await key(page, 'ArrowUp');
  const bound = (await at(page))!;
  await press(page, PAD.right);
  const beside = (await at(page))!;
  expect(await left(beside)).toBeGreaterThan(first);
  expect(Math.abs((await top(beside)) - (await top(bound)))).toBeLessThanOrEqual(48);
  await press(page, PAD.right);
  expect(await at(page)).toBe(beside);
  await press(page, PAD.left);
  expect(await at(page)).toBe(bound);

  // Held, the press moves once: the repeat does not step what it lands on.
  await hold(page, PAD.right, true);
  await run(page, 900);
  await hold(page, PAD.right, false);
  await run(page, 100);
  expect(await at(page)).toBe(beside);

  // Down from the last row is Back, then round to the tabs.
  while ((await at(page)) !== rows.at(-1)) await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await expect(board(page).locator('.options-close')).toHaveClass(/is-cursor/);
  await key(page, 'ArrowDown');
  await expect(tab(page, 'controls')).toHaveClass(/is-cursor/);

  // A binding in the second column still takes a new button.
  await key(page, 'ArrowDown');
  const start = board(page).locator('[data-setting="bind/start"] .options-value');
  while ((await at(page)) !== 'bind/start') await key(page, 'ArrowDown');
  await press(page, PAD.a);
  await expect(start).toHaveText('PRESS A KEY OR BUTTON');
  await press(page, PAD.select);
  await expect(start).not.toHaveText('PRESS A KEY OR BUTTON');
  await expect(board(page).locator('.options-desc')).toContainText('Swapped with SELECT');
});

test('a muted row at the title moves across too; one column has nowhere to go', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await optionsFromTitle(page);
  await key(page, 'ArrowDown');
  expect(await at(page)).toBe('sound');
  await page.setViewportSize({ width: 1000, height: 750 });
  await run(page, 100);
  await press(page, PAD.right);
  expect(await at(page)).toBe('sound');

  await page.setViewportSize({ width: 1440, height: 900 });
  await run(page, 100);
  await press(page, PAD.right);
  expect(await at(page)).not.toBe('sound');
});
