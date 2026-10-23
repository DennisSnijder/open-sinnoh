/**
 * Super Contests in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through `window.openSinnohGame`:
 * - sys-contest-normal-cool: the reception's party in contest mode, the visual round (the intro's clock and messages,
 *   the dress-up by keys, then, at the dress-up's screenshot, a second accessory dragged from the Fashion Case to the
 *   stage with the mouse on desktop and the finger on the phone, the judging's photo and hearts), the placeholders and
 *   the results;
 * - sys-contest-photo: the lobby's photo frame.
 * At each screenshot line the screen is checked: the contest's screens are one whole-pixel DS board in the viewport with
 * the ROM's frames and font, and the visual round's canvas shows the ROM's art. Screenshots go to test-artifacts (ROM
 * content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, ContestPhotoView, ContestView, ContestVisualRoundView, NewGame, PartyView, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { accessoryHit, accessoryOpaque } from '@opensinnoh/services';
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
const visual = async () => ((await app()) as ContestView | null)?.round as ContestVisualRoundView | undefined;
const ticks = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);

/** The board is 256 DS px wide at a whole number of device pixels per DS pixel, lies inside the viewport, and has the ROM's frames and font. */
async function board(name: string, heading = true, frames: boolean | 'none' = true) {
  // The screen's slide-in (ui.css ui-in, 160 ms) ends first.
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
  if (frames === true) expect(await page.locator('.contest-board .rom-frame').count(), name).toBeGreaterThan(0);
  else if (frames === false) expect(await page.locator('.contest-board .px, .contest-board .contest-canvas-boxes canvas').count(), name).toBeGreaterThan(0);
  if (heading) expect(await page.locator('.contest-heading .px, .contest-heading canvas').count(), name).toBeGreaterThan(0);
}

/** The visual round's canvas pixel at DS (x, y), once the ROM art has drawn there (not the black clear). */
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

/** Drags with the mouse (desktop) or a finger (phone) from DS (x0, y0) to (x1, y1) on the contest board, a few ticks per step. */
async function dragOnBoard([x0, y0]: [number, number], [x1, y1]: [number, number]) {
  const r = (await page.locator('.contest-board .contest-canvas').boundingBox())!;
  const at = (x: number, y: number) => ({ x: r.x + ((x + 0.5) * r.width) / 256, y: r.y + ((y + 0.5) * r.height) / 192 });
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
  async 'contest-entry'(name) {
    const v = (await app()) as PartyView | null;
    expect(v?.app, name).toBe('party');
    expect(v?.mode, name).toBe('contest');
    expect(v?.notes[0], name).toBeTruthy();
    await page.waitForSelector('.party-contest .party-note', { timeout: 20_000 });
  },
  async 'contest-round'(name) {
    const v = await visual();
    expect(v?.round, name).toBe('visual');
    expect(v?.phase, name).toBe('intro');
    await page.waitForSelector('.contest-board.contest-visual[data-phase="intro"] .msg-box', { timeout: 20_000 });
    await board(name, false);
    // The top screen's clock (its pink BG).
    expect((await canvasPixel(8, 8)).slice(0, 3).some((c) => c > 100), name).toBe(true);
  },
  async 'contest-dress'(name) {
    const v = await visual();
    expect(v?.phase, name).toBe('dress');
    expect(v?.dress?.placed, name).toBe(1);
    await page.waitForSelector('.contest-board.contest-visual[data-phase="dress"] .contest-dress-line', { timeout: 20_000 });
    await board(name, false, false);
    expect((await canvasPixel(64, 4)).slice(0, 3).some((c) => c > 100), name).toBe(true);
    // A second White Fluff, from the case to the stage's corner (away from Staravia), by the pointer.
    const tables = (registries.newGame.get('platinum:NEW_GAME' as Id) as NewGame).contests!;
    const item = v!.dress!.items.find((i) => i.kind === 'accessory' && i.x < 120)!;
    const pic = tables.accessories[item.id]!;
    let grip: [number, number] | null = null;
    for (let y = 0; y < pic.height && !grip; y++) for (let x = 0; x < pic.width && !grip; x++) if (accessoryOpaque(pic, x, y) && accessoryHit(pic, item.x, item.y, item.x + x, item.y + y)) grip = [item.x + x, item.y + y];
    await dragOnBoard(grip!, [150, 30]);
    const after = await visual();
    expect(after?.dress?.placed, name).toBe(2);
  },
  async 'contest-judging'(name) {
    const v = await visual();
    expect(v?.phase, name).toBe('scoring');
    expect(v?.message?.waiting, name).toBe(true);
    await page.waitForSelector('.contest-board.contest-visual[data-phase="scoring"] .msg-box', { timeout: 20_000 });
    await board(name, false);
    expect((await canvasPixel(128, 20)).slice(0, 3).some((c) => c > 100), name).toBe(true);
  },
  async 'contest-hearts'(name) {
    const v = await visual();
    // Entry 1 (the last NPC) on stage with its photo.
    expect(v?.scoring?.picture, name).toBeTruthy();
    expect(v?.scoring?.curtain, name).toBe(false);
    await board(name, false, 'none');
    expect((await canvasPixel(128, 100)).slice(0, 3).some((c) => c > 40), name).toBe(true);
  },
  async 'contest-results'(name) {
    const v = (await app()) as ContestView | null;
    expect(v?.results?.rows.map((r) => r.entry), name).toEqual([1, 2, 3, 4]);
    await page.waitForSelector('.contest-results', { timeout: 20_000 });
    expect(await page.locator('.contest-results .contest-row:not(.contest-head)').count(), name).toBe(4);
    expect(await page.locator('.contest-results .is-player').count(), name).toBe(1);
    await board(name);
  },
  async 'contest-photo'(name) {
    const v = (await app()) as ContestPhotoView | null;
    expect(v?.app, name).toBe('contest-photo');
    expect(v?.lines[1], name).toContain('Lucas');
    await page.waitForSelector('.contest-board.contest-photo .contest-photo-line', { timeout: 20_000 });
    const s = await page.evaluate(() => {
      const r = document.querySelector('.contest-board')!.getBoundingClientRect();
      return { w: r.width, h: r.height, dpr: devicePixelRatio };
    });
    expect(s.h, name).toBeCloseTo((192 * s.w) / 256, 0);
    expect(Math.abs((s.w / 256) * s.dpr - Math.round((s.w / 256) * s.dpr)), name).toBeLessThan(0.01);
    // The frame's backdrop (backdrop 4) inside the photo frame.
    expect((await canvasPixel(80, 24)).slice(0, 3).some((c) => c > 40), name).toBe(true);
  },
};

async function run(file: string, expected: string[]) {
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
  const result = await runReplay(driver, readReplay(file), { registries, seed: 1, name: file, resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(expected);
  expect(errors).toEqual([]);
}

test('sys-contest-normal-cool in the app, with its screens at each screenshot line', async () => {
  test.setTimeout(900_000);
  await run('sys-contest-normal-cool.replay', ['contest-entry', 'contest-round', 'contest-dress', 'contest-judging', 'contest-hearts', 'contest-results']);
});

test('sys-contest-photo in the app: the lobby\'s photo frame', async () => {
  test.setTimeout(300_000);
  await run('sys-contest-photo.replay', ['contest-photo']);
});
