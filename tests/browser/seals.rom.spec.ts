/**
 * The Ball Capsule editor in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through
 * `window.openSinnohGame` (tests/rom-replays sys-seals-capsule): the PC's BALL CAPSULES, the capsule grid, the editor
 * (a seal placed by the stylus taps and one by the keys, then, at the editor's screenshot, the keys' seal dragged to a
 * new place with the mouse on desktop and the finger on the phone), the Test's still, SET through the party. At each
 * screenshot line the screen is checked: the editor is one whole-pixel board (the DS screen and the message strip) in
 * the viewport, passing the shared fit checks (fit.ts), on phones full screen (centred over an opaque backdrop), its canvas showing
 * the ROM's art. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, CapsuleEditorView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { screenProblems } from './fit.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/seals';
/** The board: the DS screen and the 48 px message strip under it. */
const BOARD = { w: 256, h: 240 };

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
const editor = async () => (await app()) as CapsuleEditorView | null;
const ticks = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);

/** The board is a whole number of device pixels per DS pixel, inside the viewport, with the ROM font in its windows. */
async function board(name: string, phase: CapsuleEditorView['screen'], font = '.msg-box') {
  await page.waitForSelector(`.capsule-board[data-phase="${phase}"]`, { timeout: 20_000 });
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => (a as CSSAnimation).animationName?.startsWith('ui-in')).map((a) => a.finished)));
  const s = await page.evaluate(() => {
    const r = document.querySelector('.capsule-board')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio };
  });
  const k = s.w / BOARD.w;
  expect(s.h, name).toBeCloseTo(BOARD.h * k, 0);
  expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.y, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  expect(await page.locator(`.capsule-board ${font} .px, .capsule-board ${font} canvas`).count(), name).toBeGreaterThan(0);
  expect(await screenProblems(page), name).toEqual([]);
  // Phones show the editor full screen: centred in the room over the opaque backdrop, not at the room's bottom with the
  // field's black above it.
  if (phone) {
    const fit = await page.evaluate(() => {
      const board = document.querySelector<HTMLElement>('.capsule-board')!;
      const b = board.getBoundingClientRect();
      const room = board.parentElement!.getBoundingClientRect();
      const scrim = document.querySelector<HTMLElement>('.ui-host .ui-scrim.opaque');
      return { above: b.top - room.top, below: room.bottom - b.bottom, painted: scrim?.dataset.painted, backdrop: board.dataset.backdrop };
    });
    expect(Math.abs(fit.above - fit.below), `${name}: ${fit.above} px above the board, ${fit.below} px below`).toBeLessThanOrEqual(2);
    // The backdrop follows the phase's picture (the board is patched in place between phases).
    expect(fit.painted, name).toBe(`${fit.backdrop}|${fit.backdrop}`);
  }
}

/** The canvas pixel at DS (x, y), once the ROM art has drawn there (not the black clear). */
async function canvasPixel(x: number, y: number): Promise<number[]> {
  await page.waitForFunction(
    ([px, py]) => {
      const d = document.querySelector<HTMLCanvasElement>('.capsule-board .capsule-canvas')?.getContext('2d')?.getImageData(px!, py!, 1, 1).data;
      return !!d && d[0]! + d[1]! + d[2]! > 0;
    },
    [x, y],
    { timeout: 20_000 },
  );
  return page.evaluate(([px, py]) => [...document.querySelector<HTMLCanvasElement>('.capsule-board .capsule-canvas')!.getContext('2d')!.getImageData(px!, py!, 1, 1).data], [x, y]);
}

/** Drags with the mouse (desktop) or a finger (phone) from DS (x0, y0) to (x1, y1) on the board, a few ticks per step. */
async function drag([x0, y0]: [number, number], [x1, y1]: [number, number]) {
  const r = (await page.locator('.capsule-board .capsule-canvas').boundingBox())!;
  const at = (x: number, y: number) => ({ x: r.x + ((x + 0.5) * r.width) / BOARD.w, y: r.y + ((y + 0.5) * r.height) / BOARD.h });
  const a = at(x0, y0);
  const b = at(x1, y1);
  if (phone) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    await ticks(2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }] });
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
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
    await ticks(2);
    await page.mouse.move(b.x, b.y);
    await ticks(2);
    await page.mouse.up();
    await ticks(2);
  }
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'capsule-select'(name) {
    expect((await editor())?.screen, name).toBe('select');
    await board(name, 'select');
    // The grid's gradient (capsule/main2) and a capsule's buttons over it.
    expect((await canvasPixel(4, 4)).slice(0, 3).some((c) => c > 100), name).toBe(true);
    expect(await page.locator('.capsule-board .capsule-cell').count(), name).toBe(12);
  },
  async 'capsule-edit'(name) {
    const v = await editor();
    expect(v?.screen, name).toBe('edit');
    expect(v?.seals.length, name).toBe(2);
    await board(name, 'edit', '.capsule-count');
    // The editor's backdrop (capsule/sub3) round the capsule, and the list's counts in the ROM font.
    expect((await canvasPixel(190, 70)).slice(0, 3).some((c) => c > 100), name).toBe(true);
    expect(await page.locator('.capsule-board .capsule-count').count(), name).toBe(2);
    // The keys' seal (in front), dragged by the pointer to a new place inside the circle.
    const front = v!.seals.at(-1)!;
    await drag([front.x, front.y], [212, 96]);
    const after = await editor();
    expect(after?.seals.length, name).toBe(2);
    expect(after?.seals.at(-1), name).toMatchObject({ x: 212, y: 96, ghost: false });
  },
  async 'capsule-test'(name) {
    const v = await editor();
    expect(v?.screen, name).toBe('test');
    expect(v?.test?.species, name).toBe('platinum:SPECIES_STARAVIA');
    await board(name, 'test');
    expect((await canvasPixel(4, 100)).slice(0, 3).some((c) => c > 100), name).toBe(true);
  },
};

test('sys-seals-capsule in the app, with the editor at each screenshot line', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-sys-seals-capsule`);
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
  const result = await runReplay(driver, readReplay('sys-seals-capsule.replay'), { registries, seed: 1, name: 'sys-seals-capsule.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(['capsule-select', 'capsule-edit', 'capsule-test']);
  expect(errors).toEqual([]);
});
