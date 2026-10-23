/**
 * The Villa and the journal in the app (OPENSINNOH_NDS_ROM; desktop and phone), through `window.openSinnohGame`:
 * - sys-villa-buy: after the Big Sofa and the Small Sofa are bought, the field draws the Villa's furniture props (the
 *   field view lists them; the screenshot shows them);
 * - sys-journal, then a CONTINUE two more days on: the journal opens as one whole-pixel DS screen with the ROM's page
 *   art and font; Right turns to the older page through the wipe; B closes.
 * Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, JournalView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/villa-journal';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
let phone = false;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  phone = !!use.isMobile;
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

/** The journal's scene: one stage at a whole number of device pixels per DS pixel, inside the viewport, with the page art drawn. */
async function journalScene(name: string) {
  await page.waitForSelector('.journal-scene .ds-scene-canvas', { timeout: 20_000 });
  await expect.poll(async () => (await canvasStats(page, '.journal-scene .ds-scene-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(4);
  expect((await canvasStats(page, '.journal-scene .ds-scene-canvas')).lit, name).toBeGreaterThan(0.5);
  const s = await page.evaluate(() => {
    const r = document.querySelector('.journal-scene .ds-scene-stage')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, stages: document.querySelectorAll('.ds-scene-stage').length };
  });
  const k = s.w / 256;
  expect(s.stages, name).toBe(1);
  expect(s.h, name).toBeCloseTo(192 * k, 1);
  expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.y, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  if (phone) expect(s.w / s.vw, name).toBeGreaterThan(0.85);
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'villa-furniture'(name) {
    const models = await page.evaluate(() => (window.openSinnohGame!.snapshot() as unknown as { field?: { features?: { models: { prop?: string }[] } } }).field?.features?.models.map((m) => m.prop) ?? null);
    if (models) expect(models, name).toEqual(['platinum:prop/559', 'platinum:prop/560', 'platinum:prop/561']);
    expect(await app(), name).toBeNull();
  },
  async 'journal-page'(name) {
    const v = (await app()) as JournalView | null;
    expect(v, name).toMatchObject({ app: 'journal', black: 0, turn: null, newer: false, older: true });
    await journalScene(name);
  },
  async 'journal-turn'(name) {
    const v = (await app()) as JournalView | null;
    expect(v?.turn, name).toBeTruthy();
    await journalScene(name);
  },
  async 'journal-older'(name) {
    const v = (await app()) as JournalView | null;
    expect(v, name).toMatchObject({ app: 'journal', turn: null, page: { index: 1 }, newer: true });
    await journalScene(name);
  },
};

async function run(file: string, extra: string, expected: string[]) {
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-${file.replace(/\.replay$/, '')}`);
  const seen: string[] = [];
  const driver = {
    ...base,
    async screenshot(name: string) {
      await frame();
      await CHECKS[name]!(name);
      seen.push(name);
      return base.screenshot!(name);
    },
  };
  const result = await runReplay(driver, `${readReplay(file)}${extra}`, { registries, seed: 1, name: file, resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(expected);
  expect(errors).toEqual([]);
}

test('sys-villa-buy in the app: the bought furniture is in the Villa', async () => {
  test.setTimeout(600_000);
  await run('sys-villa-buy.replay', '+0 press up\n+2 release up\nuntil idle\n+20 screenshot villa-furniture\n', ['villa-furniture']);
});

test('sys-journal in the app: the journal opens on CONTINUE, turns a page and closes', async () => {
  test.setTimeout(600_000);
  const more = ['+0 date 2009-03-26 12:00', '+2 reload', 'until app journal 60', '+12 screenshot journal-page', '+0 press right', '+1 release right', '+4 screenshot journal-turn', '+12 screenshot journal-older', '+0 press b', '+1 release b', '+12 press b', '+1 release b', 'until idle 120', ''].join('\n');
  await run('sys-journal.replay', more, ['journal-page', 'journal-turn', 'journal-older']);
});
