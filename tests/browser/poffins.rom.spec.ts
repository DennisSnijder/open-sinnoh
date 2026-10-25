/**
 * Poffins in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): cooking a Poffin at the Poffin House, the
 * Poffin Case, the feeding and the summary's condition page, and an Amity Square walk with its find, through
 * `window.openSinnohGame` (tests/rom-replays sys-poffin-cook, sys-feebas-milotic, sys-amity-square). At each screenshot
 * line the screen is checked: the cooking and feeding scenes are one whole-pixel DS stage in the viewport with ROM art
 * on the canvas; the case is its ROM boards with the rows; the condition page has its graph; the field is lit.
 * Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, Registries, SummaryView } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { mainCanvasStats, pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/poffins';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, ...(use.isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: use.deviceScaleFactor } : {}) });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

test('import the ROM', async () => {
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const app = async () => (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView | null;

/** A selector's rect is a whole number of device pixels per DS pixel at the DS aspect, inside the viewport. */
async function dsRect(selector: string, name: string) {
  const s = await page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio };
  }, selector);
  const k = s.w / 256;
  expect(s.h, name).toBeCloseTo(192 * k, 0);
  expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.y, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
}

/** A scene's stage: one, DS-sized in the viewport, its canvas showing ROM art. */
async function scene(root: string, name: string) {
  await page.waitForSelector(`${root} .ds-scene-canvas`, { timeout: 20_000 });
  expect(await page.locator(root).count(), name).toBe(1);
  await dsRect(`${root} .ds-scene-stage`, name);
  await expect.poll(async () => (await canvasStats(page, `${root} .ds-scene-canvas`)).colours, { timeout: 20_000 }).toBeGreaterThan(8);
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async cooking(name) {
    expect((await app())?.app, name).toBe('poffin-cooking');
    await scene('.poffin-cooking-scene', name);
    if (name === 'poffin-results') expect(await page.locator('.poffin-cooking-scene .poffin-results').count(), name).toBe(1);
  },
  async case(name) {
    expect((await app())?.app, name).toBe('poffin-case');
    await page.waitForSelector('.poffin-case-main', { timeout: 20_000 });
    // The ROM boards (the case and its filter screen), the rows and the Poffin's picture.
    expect(await page.locator('.poffin-case-main canvas').count(), name).toBeGreaterThan(0);
    expect(await page.locator('.poffin-css-screen').count(), name).toBe(0);
    expect(await page.locator('.poffin-row').count(), name).toBeGreaterThan(1);
    expect(await page.locator('.poffin-filter.rom').count(), name).toBeGreaterThan(0);
  },
  async feed(name) {
    expect((await app())?.app, name).toBe('poffin-feed');
    await scene('.poffin-feed-scene', name);
  },
  async condition(name) {
    const v = (await app()) as SummaryView | null;
    expect(v?.app, name).toBe('summary');
    expect(v?.page, name).toBe('condition');
    await page.waitForSelector('.sum-graph', { timeout: 20_000 });
    expect(await page.locator('.sum-graph').count(), name).toBe(1);
  },
  async field(name) {
    await waitForScene(page);
    const stats = await mainCanvasStats(page);
    expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
    expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.1);
  },
};
const KIND: Record<string, keyof typeof CHECKS> = {
  'poffin-drop': 'cooking',
  'poffin-stir': 'cooking',
  'poffin-results': 'cooking',
  'poffin-case': 'case',
  'condition-feed': 'condition',
  'poffin-feed': 'feed',
  'condition-change': 'condition',
  'poffin-reporter': 'field',
  'amity-follower': 'field',
  'amity-find': 'field',
};

for (const file of ['sys-poffin-cook', 'sys-feebas-milotic', 'sys-amity-square']) {
  test(`${file} in the app, with its screens at each screenshot line`, async () => {
    test.setTimeout(900_000);
    const project = test.info().project.name;
    const base = pageDriver(page, SHOTS, `${project}-${file}`);
    const seen: string[] = [];
    const driver = {
      ...base,
      async screenshot(name: string) {
        await frame();
        await CHECKS[KIND[name]!]!(name);
        seen.push(name);
        return base.screenshot!(name);
      },
    };
    const result = await runReplay(driver, readReplay(`${file}.replay`), { registries, seed: 1, name: `${file}.replay`, resolve: resolveReplay, repeat: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
