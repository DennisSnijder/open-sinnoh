/**
 * The Jubilife TV gallery in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through
 * `window.openSinnohGame`: sys-tv-gallery (the Hiker's dress-up with the help, Staravia dressed by keys and moved by the
 * stylus, the finish's question with the touch YES/NO, the title, the photo in Frame0's viewer). At each screenshot line
 * the screen is checked: one whole-pixel DS board in the viewport, the canvas showing the ROM's art; at the dress-up's,
 * Staravia is dragged away and back with the mouse on desktop and the finger on the phone. Screenshots go to
 * test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, GalleryDressUpView, GalleryPhotoView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/tv-gallery';

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
const ticks = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);

/** The board is 256 DS px wide at a whole number of device pixels per DS pixel and lies inside the viewport. */
async function board(name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => (a as CSSAnimation).animationName?.startsWith('ui-in')).map((a) => a.finished)));
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
}

/** The canvas pixel at DS (x, y), once the ROM art has drawn there (not the black clear). */
async function canvasPixel(x: number, y: number): Promise<number[]> {
  await page.waitForFunction(
    ([px, py]) => {
      const c = document.querySelector<HTMLCanvasElement>('.contest-board .contest-canvas');
      const d = c?.getContext('2d')?.getImageData(px!, py!, 1, 1).data;
      return !!d && d[0]! + d[1]! + d[2]! > 0;
    },
    [x, y],
    { timeout: 20_000 },
  );
  return page.evaluate(([px, py]) => [...document.querySelector<HTMLCanvasElement>('.contest-board .contest-canvas')!.getContext('2d')!.getImageData(px!, py!, 1, 1).data], [x, y]);
}

/** Drags with the mouse (desktop) or a finger (phone) from DS (x0, y0) to (x1, y1) on the board, a few ticks per step. */
async function dragOnBoard([x0, y0]: [number, number], [x1, y1]: [number, number]) {
  const r = (await page.locator('.contest-board .contest-canvas').boundingBox())!;
  const at = (x: number, y: number) => ({ x: r.x + ((x + 0.5) * r.width) / 256, y: r.y + ((y + 0.5) * r.height) / 192 });
  const a = at(x0, y0);
  const b = at(x1, y1);
  if (phone) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    await ticks(2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [b] });
    await ticks(2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ticks(2);
    await cdp.detach();
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await ticks(2);
    await page.mouse.move(b.x, b.y);
    await ticks(2);
    await page.mouse.up();
    await ticks(2);
  }
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'tv-gallery-help'(name) {
    const v = (await app()) as GalleryDressUpView | null;
    expect(v?.phase, name).toBe('intro');
    await page.waitForSelector('.contest-board.gallery-dress-up[data-phase="intro"] .msg-box', { timeout: 20_000 });
    await board(name);
    // The dress-up's background around the case.
    expect((await canvasPixel(4, 100)).slice(0, 3).some((c) => c > 40), name).toBe(true);
  },
  async 'tv-gallery-dress'(name) {
    const v = (await app()) as GalleryDressUpView | null;
    expect(v?.phase, name).toBe('dress');
    expect(v?.stage.placed, name).toBe(1);
    await page.waitForSelector('.contest-board.gallery-dress-up[data-phase="dress"] .contest-dress-clock', { timeout: 20_000 });
    await board(name);
    expect((await canvasPixel(180, 64)).slice(0, 3).some((c) => c > 40), name).toBe(true);
    // Staravia away and back by the pointer (its fluff moves along): the photo's place is the replay's.
    await dragOnBoard([180, 80], [200, 90]);
    expect(((await app()) as GalleryDressUpView).stage.mon, name).toMatchObject({ x: 200, y: 74 });
    await dragOnBoard([200, 90], [180, 80]);
    const after = (await app()) as GalleryDressUpView;
    expect(after.stage.mon, name).toMatchObject({ x: 180, y: 64 });
    expect(after.stage.placed, name).toBe(1);
  },
  async 'tv-gallery-confirm'(name) {
    const v = (await app()) as GalleryDressUpView | null;
    expect(v?.phase, name).toBe('confirm');
    expect(v?.question?.text, name).toBeTruthy();
    await page.waitForSelector('.contest-board.gallery-dress-up[data-phase="confirm"] .msg-box', { timeout: 20_000 });
    expect(await page.locator('.contest-board .gallery-yes-no').count(), name).toBe(2);
    await board(name);
    // The touch YES button's art.
    expect((await canvasPixel(224, 48)).slice(0, 3).some((c) => c > 40), name).toBe(true);
  },
  async 'tv-gallery-photo'(name) {
    const v = (await app()) as GalleryPhotoView | null;
    expect(v?.app, name).toBe('gallery-photo');
    expect(v?.lines[0], name).toBe('Lucas');
    await page.waitForSelector('.contest-board.gallery-photo .contest-photo-line', { timeout: 20_000 });
    await board(name);
    expect((await canvasPixel(v!.picture.mon.x, v!.picture.mon.y)).slice(0, 3).some((c) => c > 40), name).toBe(true);
  },
};

test('sys-tv-gallery in the app, with its screens at each screenshot line', async () => {
  test.setTimeout(600_000);
  const file = 'sys-tv-gallery.replay';
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-sys-tv-gallery`);
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
  const result = await runReplay(driver, readReplay(file), { registries, seed: 1, name: file, resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(['tv-gallery-help', 'tv-gallery-dress', 'tv-gallery-confirm', 'tv-gallery-photo']);
  expect(errors).toEqual([]);
});
