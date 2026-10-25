/**
 * The Underground's secret base and traps in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through
 * `window.openSinnohGame` (tests/rom-replays sys-underground-base, sys-underground-trap). At each screenshot line the
 * screen is checked: the drill's prompt and the PC are ROM-framed windows on the board over the lit field; the
 * decoration shows the base's goods as props from the room's centre; while a good is placed the floor takes touches
 * (a touch on the room's middle picks a room tile); a trap's screen is one DS canvas with ROM art over the field, the '!'
 * over the player under it, and the OK over the player once free.
 * Screenshots go to test-artifacts (ROM content, never commit).
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
const SHOTS = 'test-artifacts/underground-base';

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

/** The field is drawn and lit under the app. */
async function lit(name: string) {
  await waitForScene(page);
  const stats = await mainCanvasStats(page);
  expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
  expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.05);
}

/** A board of ROM-framed windows or message boxes over the field. */
async function windows(root: string, name: string) {
  await page.waitForSelector(`${root} .rom-frame`, { timeout: 20_000 });
  expect(await page.locator(`${root} .rom-frame`).count(), name).toBeGreaterThan(0);
}

/** The props the world draws in the base (FieldView.props): the PC, the boulders and the goods out. */
const baseProps = () => page.evaluate(() => (window.openSinnohApp!.game.world.view().props ?? []).filter((p) => p.key.startsWith('ug-good-')).length);

/** The marks over the player (FieldView.effects: the '!' or OK). */
const emotes = () => page.evaluate(() => window.openSinnohApp!.game.world.view().effects.filter((e) => e.effect.includes('UG_EMOTE')).map((e) => e.effect));

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async drill(name) {
    expect((await app())?.app, name).toBe('ug-base');
    await windows('.ug-base', name);
    await lit(name);
    // The pending entrance is drawn in the wall ahead.
    expect(await page.evaluate(() => (window.openSinnohApp!.game.world.view().props ?? []).some((p) => p.key.startsWith('ug-entrance-'))), name).toBe(true);
  },
  async pc(name) {
    expect((await app())?.app, name).toBe('ug-pc');
    await windows('.ug-pc', name);
    expect(await page.locator('.ug-pc .ug-pc-menu .menu-entry').count(), name).toBe(5);
    await lit(name);
    // The PC and the sixteen boulders are props.
    expect(await baseProps(), name).toBe(17);
  },
  async decoration(name) {
    expect((await app())?.app, name).toBe('ug-pc');
    await windows('.ug-pc', name);
    expect(await page.locator('.ug-pc .ug-decor-menu .menu-entry').count(), name).toBe(4);
    await lit(name);
  },
  async placing(name) {
    expect((await app())?.app, name).toBe('ug-pc');
    await lit(name);
    // The Plain Table is out, the bookshelf held (blinking): the PC, the boulders, the table and maybe the bookshelf.
    expect(await baseProps(), name).toBeGreaterThanOrEqual(18);
    expect(await page.locator('.ug-pc .ug-floor-touch').count(), name).toBe(1);
    // The camera looks at the room from (15, 17): a touch on the middle of the field is a room tile.
    const tile = await page.evaluate(() => {
      const r = document.getElementById('main-canvas')!.getBoundingClientRect();
      return window.openSinnohApp!.tileAt(r.width / 2, r.height / 2);
    });
    expect(tile, name).not.toBeNull();
    expect(tile!.x % 32, name).toBeGreaterThanOrEqual(10);
    expect(tile!.x % 32, name).toBeLessThanOrEqual(21);
    expect(tile!.z, name).toBeGreaterThanOrEqual(12);
    expect(tile!.z, name).toBeLessThanOrEqual(23);
  },
  async 'leaf-trap'(name) {
    expect((await app())?.app, name).toBe('ug-trap');
    await page.waitForSelector('.ug-trap .ug-trap-canvas', { timeout: 20_000 });
    await lit(name);
    await expect.poll(async () => (await canvasStats(page, '.ug-trap .ug-trap-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(3);
    expect(await page.locator('.ug-trap.is-dim').count(), `${name}: dimmed`).toBe(1);
    expect(await emotes(), `${name}: the '!'`).toEqual(['platinum:FIELD_EFFECT_UG_EMOTE_EXCLAMATION']);
  },
  async 'trap-ok'(name) {
    expect(await app(), name).toBeNull();
    await lit(name);
    expect(await emotes(), `${name}: the OK`).toEqual(['platinum:FIELD_EFFECT_UG_EMOTE_OK']);
  },
};

/** Each replay's own screenshot lines (a `from` parent runs without its screenshots). */
const FILES: Record<string, string[]> = {
  'sys-underground-base': ['drill', 'pc', 'decoration', 'placing'],
  'sys-underground-trap': ['leaf-trap', 'trap-ok'],
};

for (const [file, shots] of Object.entries(FILES)) {
  test(`${file} in the app, with its screens at each screenshot line`, async () => {
    test.setTimeout(900_000);
    const project = test.info().project.name;
    const base = pageDriver(page, SHOTS, `${project}-${file}`);
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
    const result = await runReplay(driver, readReplay(`${file}.replay`), { registries, seed: 1, name: `${file}.replay`, resolve: resolveReplay, repeat: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(seen).toEqual(shots);
    expect(errors).toEqual([]);
  });
}
