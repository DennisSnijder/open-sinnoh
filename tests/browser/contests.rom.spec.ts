/**
 * Super Contests in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): the reception's party in contest
 * mode, a placeholder round and the results, through `window.openSinnohGame` (tests/rom-replays sys-contest-normal-cool).
 * At each screenshot line the screen is checked: the party has its eligibility notes; the contest windows are one
 * whole-pixel DS board in the viewport with the ROM's frames and font, the results table has the four entries. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, ContestView, PartyView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/contests';

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

/** The board is 256 DS px wide at a whole number of device pixels per DS pixel and lies inside the viewport. */
async function board(name: string) {
  const s = await page.evaluate(() => {
    const r = document.querySelector('.contest-board')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio };
  });
  const k = s.w / 256;
  expect(s.h, name).toBeCloseTo(192 * k, 0);
  expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  // The ROM's window frames, and the heading in the ROM font (pixel glyph canvases).
  expect(await page.locator('.contest-board .rom-frame').count(), name).toBeGreaterThan(0);
  expect(await page.locator('.contest-heading .px, .contest-heading canvas').count(), name).toBeGreaterThan(0);
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'contest-entry'(name) {
    const v = (await app()) as PartyView | null;
    expect(v?.app, name).toBe('party');
    expect(v?.mode, name).toBe('contest');
    expect(v?.notes[0], name).toBeTruthy();
    await page.waitForSelector('.party-contest .party-note', { timeout: 20_000 });
  },
  async 'contest-round'(name) {
    const v = (await app()) as ContestView | null;
    expect(v?.round?.placeholder, name).toBe(true);
    await page.waitForSelector('.contest-board [data-placeholder]', { timeout: 20_000 });
    await board(name);
  },
  async 'contest-results'(name) {
    const v = (await app()) as ContestView | null;
    expect(v?.results?.rows.map((r) => r.entry), name).toEqual([1, 2, 3, 4]);
    await page.waitForSelector('.contest-results', { timeout: 20_000 });
    expect(await page.locator('.contest-results .contest-row:not(.contest-head)').count(), name).toBe(4);
    expect(await page.locator('.contest-results .is-player').count(), name).toBe(1);
    await board(name);
  },
};

test('sys-contest-normal-cool in the app, with its screens at each screenshot line', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-contest`);
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
  const result = await runReplay(driver, readReplay('sys-contest-normal-cool.replay'), { registries, seed: 1, name: 'sys-contest-normal-cool.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(['contest-entry', 'contest-round', 'contest-results']);
  expect(errors).toEqual([]);
});
