/**
 * The Underground in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): down into the Underground with the Explorer
 * Kit, its menu, mining a wall and a trap vendor's shop, through `window.openSinnohGame` (tests/rom-replays
 * sys-underground-enter, sys-underground-dig, sys-underground-vendor). At each screenshot line
 * the screen is checked: the way down draws its ROM sprites down the middle of the view (the hole and the jumping player
 * on the surface, the falling player below); the field is lit with the radar card; the menu, the prompt and the shop are
 * ROM-framed windows on the board; the mining game is one whole-pixel DS stage in the viewport with ROM art on its canvas.
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
const SHOTS = 'test-artifacts/underground';

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

async function field(name: string) {
  await waitForScene(page);
  const stats = await mainCanvasStats(page);
  expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
  expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.1);
  // The radar card is drawn: the Underground's top screen, from its ROM art.
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.undergroundView() !== null), name).toBe(true);
}

/**
 * The overlay canvas's middle column (the transition's sprites stand on it; the radar card stays in the left half):
 * its opaque pixels and colours.
 */
function overlayMiddle() {
  return page.evaluate(() => {
    const src = document.getElementById('overlay-canvas') as HTMLCanvasElement;
    const px = src.getContext('2d')!.getImageData(Math.round(src.width / 2) - 2, 0, 4, src.height).data;
    const colours = new Set<number>();
    let opaque = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      opaque++;
      colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    }
    return { opaque, colours: colours.size };
  });
}

/** The way down: the transition's sprites (`World.undergroundTransition`) drawn over the field. */
async function transition(name: string, parts: ('player' | 'hole')[]) {
  const view = await page.evaluate(() => window.openSinnohApp!.game.world.undergroundTransition());
  expect(view, name).not.toBeNull();
  for (const part of ['player', 'hole'] as const) expect(view![part] !== null, `${name}: ${part}`).toBe(parts.includes(part));
  // The sheets load on their first draw.
  await expect.poll(async () => (await overlayMiddle()).colours, { message: `${name}: sprite colours`, timeout: 20_000 }).toBeGreaterThan(4);
  expect((await overlayMiddle()).opaque, `${name}: sprites drawn`).toBeGreaterThan(parts.includes('hole') ? 100 : 20);
}

/** A board of ROM-framed windows (the Underground's frame) over the field. */
async function windows(root: string, name: string) {
  await page.waitForSelector(`${root} .window.rom-frame`, { timeout: 20_000 });
  expect(await page.locator(`${root} .window.rom-frame`).count(), name).toBeGreaterThan(0);
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  'ug-hole': (name) => transition(name, ['player', 'hole']),
  'ug-fall': (name) => transition(name, ['player']),
  'ug-field': field,
  async 'ug-menu'(name) {
    expect((await app())?.app, name).toBe('ug-menu');
    await windows('.ug-menu', name);
    expect(await page.locator('.ug-menu .menu-entry').count(), name).toBe(7);
  },
  async 'mining-prompt'(name) {
    expect((await app())?.app, name).toBe('mining');
    await windows('.ug-mining-prompt', name);
  },
  async mining(name) {
    expect((await app())?.app, name).toBe('mining');
    await page.waitForSelector('.ug-mining-scene .ds-scene-canvas', { timeout: 20_000 });
    expect(await page.locator('.ug-mining-scene').count(), name).toBe(1);
    await dsRect('.ug-mining-scene .ds-scene-stage', name);
    await expect.poll(async () => (await canvasStats(page, '.ug-mining-scene .ds-scene-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(8);
    expect(await page.locator('.ug-mining-scene.rom').count(), `${name}: ROM art`).toBe(1);
  },
  async 'ug-vendor'(name) {
    expect((await app())?.app, name).toBe('ug-vendor');
    await windows('.ug-vendor', name);
  },
};
const KIND: Record<string, string> = { 'mining-board': 'mining', 'mining-dig': 'mining', 'mining-items': 'mining', 'ug-vendor-buy': 'ug-vendor' };

/** Each replay's own screenshot lines (a `from` parent runs without its screenshots). */
const FILES: Record<string, string[]> = {
  'sys-underground-enter': ['ug-hole', 'ug-fall', 'ug-field', 'ug-menu'],
  'sys-underground-dig': ['mining-prompt', 'mining-board', 'mining-dig', 'mining-items'],
  'sys-underground-vendor': ['ug-vendor', 'ug-vendor-buy'],
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
        await CHECKS[KIND[name] ?? name]!(name);
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
