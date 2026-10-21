/**
 * The side systems in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): the Oreburgh trade's scene, the
 * Route 212 tutor's list, cost window and forget pick, the Move Maniac's relearner screen and Route 208's berry trees, through
 * `window.openSinnohGame` (tests/rom-replays sys-trade-abra, sys-tutor-shards, sys-relearner, sys-berries). At each screenshot line
 * the screen is checked: the trade scene is one whole-pixel DS stage inside the viewport with its ROM art on the canvas
 * (and the message box while a message shows); the relearner is one DS board in the viewport with its ROM page art;
 * the tutor's list and cost window are drawn over a lit field. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { mainCanvasStats, pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/side-systems';

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
  return s;
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async trade(name) {
    const v = await app();
    expect(v?.app, name).toBe('trade');
    await page.waitForSelector('.trade-canvas', { timeout: 20_000 });
    expect(await page.locator('.trade-scene').count(), name).toBe(1);
    await dsRect('.trade-scene .ds-scene-stage', name);
    const phase = (v as { phase: string }).phase;
    // The black send and receive fields show the Pokémon's picture; the tube is the ball in its light column; the sky and the wormhole are ROM art filling the canvas.
    await expect.poll(async () => (await canvasStats(page, '.trade-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(4);
    const lit = (await canvasStats(page, '.trade-canvas')).lit;
    if (phase === 'arrive' || phase === 'reveal' || phase === 'wormhole') expect(lit, name).toBeGreaterThan(0.3);
    else expect(lit, name).toBeLessThan(0.5);
    const message = (v as { message: unknown }).message;
    expect(await page.locator('.trade-scene .msg-box').count(), name).toBe(message ? 1 : 0);
  },
  async relearner(name) {
    expect((await app())?.app, name).toBe('move-reminder');
    await page.waitForSelector('.move-reminder-screen', { timeout: 20_000 });
    await dsRect('.move-reminder-screen', name);
    // The ROM page art, the rows (the moves and CANCEL) and the selector.
    expect(await page.locator('.move-reminder-screen .mr-bg canvas').count(), name).toBe(1);
    expect(await page.locator('.move-reminder-screen .mr-row').count(), name).toBeGreaterThan(1);
    expect(await page.locator('.move-reminder-screen .mr-selector').count(), name).toBe(1);
  },
  async field(name) {
    await waitForScene(page);
    const stats = await mainCanvasStats(page);
    expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
    expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.1);
  },
};
const KIND: Record<string, keyof typeof CHECKS> = {
  'trade-send': 'trade',
  'trade-tube': 'trade',
  'trade-sky': 'trade',
  'trade-receive': 'trade',
  relearner: 'relearner',
  'tutor-board': 'field',
  'shard-cost': 'field',
  'berry-fruit': 'field',
  'berry-trees': 'field',
};

for (const file of ['sys-trade-abra', 'sys-tutor-shards', 'sys-relearner', 'sys-berries']) {
  test(`${file} in the app, with its screens at each screenshot line`, async () => {
    test.setTimeout(600_000);
    const project = test.info().project.name;
    const base = pageDriver(page, SHOTS, `${project}-${file}`);
    const seen: string[] = [];
    const driver = {
      ...base,
      async screenshot(name: string) {
        await frame();
        const kind = KIND[name];
        if (kind) await CHECKS[kind]!(name);
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
