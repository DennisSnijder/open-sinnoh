/**
 * The map-name popup in the browser (OPENSINNOH_NDS_ROM; skipped without it): walking from Twinleaf Town
 * onto Route 201 draws the route signboard at the top-left of the field overlay, at most the UI's dot
 * size per DS pixel, and the corner is empty again once it has slid out. Screenshots go to
 * test-artifacts/map-popup (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameState } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks } from '@opensinnoh/game';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/map-popup';
/** The signboard, DS px (decomp MapNamePopUp_DrawWindowFrame: 17×5 tiles). */
const BOARD = { width: 136, height: 40 };

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
/** Route 201's name in the game's language. */
let route201: string;

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  route201 = loadGamePacks([romSlice().pack]).registries.zones.get('platinum:MAP_HEADER_ROUTE_201' as Id)!.name;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

/** Opaque pixels and distinct colours of the overlay canvas inside a rect (device px), after a frame. */
function overlayRegion(width: number, height: number) {
  return page.evaluate(
    ([w, h]) =>
      new Promise<{ opaque: number; colours: number }>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const c = document.getElementById('overlay-canvas') as HTMLCanvasElement;
            const px = c.getContext('2d')!.getImageData(0, 0, w, h).data;
            const colours = new Set<number>();
            let opaque = 0;
            for (let i = 0; i < px.length; i += 4) {
              if (px[i + 3] === 0) continue;
              opaque++;
              colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
            }
            resolve({ opaque: opaque / (px.length / 4), colours: colours.size });
          }),
        ),
      ),
    [width, height] as const,
  );
}

test('walking onto Route 201 draws the route signboard in the top-left corner', async () => {
  test.setTimeout(300_000);
  const project = test.info().project.name;
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await waitForScene(page);

  // Twinleaf, south of Route 201, after the opening's town scenes.
  const state: GameState = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  state.player = { zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN' as never, x: 110, z: 870, y: 0, facing: 'up' };
  state.objects = [];
  state.follower = null;
  Object.assign(state.vars, { 'platinum:VAR_TWINLEAF_TOWN_RIVAL_TRIGGER_STATE': 1, 'platinum:VAR_TWINLEAF_TOWN_GUITARIST_TRIGGER_STATE': 2, 'platinum:VAR_PLAYER_HOUSE_STATE': 2 });
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }));
  // The load shows the town's board; let it run out (80 ticks).
  await page.evaluate(() => window.openSinnohGame!.advance(100));
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().mapPopup)).toBeNull();
  await waitForScene(page);

  const scale = await page.evaluate(() => {
    const c = document.getElementById('overlay-canvas') as HTMLCanvasElement;
    return { width: c.width, height: c.height, dpr: devicePixelRatio };
  });
  const corner = [Math.min(scale.width, BOARD.width * 8), Math.min(scale.height, BOARD.height * 8)] as const;
  const empty = await overlayRegion(...corner);
  expect(empty.opaque, 'the corner is empty before the crossing').toBe(0);

  const ticks = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('up');
    let n = 0;
    while (g.snapshot().state.player.zone !== 'platinum:MAP_HEADER_ROUTE_201') {
      if (++n > 300) throw new Error('never reached Route 201');
      g.advance(1);
    }
    g.release('up');
    // Slide in (10 ticks) and hold.
    g.advance(15);
    return n;
  });
  expect(ticks).toBeGreaterThan(0);
  const popup = await page.evaluate(() => window.openSinnohGame!.snapshot().mapPopup);
  expect(popup).toMatchObject({ window: 'platinum:ui2d/map_popups/route', offset: 0, phase: 'hold' });
  expect(popup!.name).toBe(route201);

  // The board loads on first use: poll a few frames.
  let shown = await overlayRegion(...corner);
  for (let i = 0; i < 20 && shown.opaque === 0; i++) shown = await overlayRegion(...corner);
  await page.screenshot({ path: `${SHOTS}/${project}-route-201.png` });
  // Signboard art plus the name: many colours, and most of a board's area covered.
  expect(shown.colours).toBeGreaterThan(6);
  // The board's size in device px: between 1 and dot × dpr per DS px.
  const k = await page.evaluate(([bw, bh]) => {
    const c = document.getElementById('overlay-canvas') as HTMLCanvasElement;
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < Math.min(c.height, bh * 8); y++)
      for (let x = 0; x < Math.min(c.width, bw * 8); x++)
        if (px[(y * c.width + x) * 4 + 3]) {
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
    return { right, bottom };
  }, [BOARD.width, BOARD.height] as const);
  // A whole number of device px per DS px; the art's edges are partly transparent (134×38 of 136×40 drawn).
  const perDsPx = Math.round(k.right / BOARD.width);
  expect(perDsPx).toBeGreaterThanOrEqual(1);
  expect(k.right).toBeGreaterThanOrEqual((BOARD.width - 4) * perDsPx);
  expect(k.right).toBeLessThanOrEqual(BOARD.width * perDsPx);
  expect(k.bottom % perDsPx, `board height ${k.bottom} at ${perDsPx} device px per DS px`).toBe(0);
  expect(k.bottom).toBeLessThanOrEqual(BOARD.height * perDsPx);
  const cssPerDsPx = perDsPx / scale.dpr;
  expect(cssPerDsPx).toBeLessThanOrEqual(3);
  // A modest corner board: well under half the view's width on desktop.
  if (project === 'desktop') expect(k.right / scale.width).toBeLessThan(0.4);

  // Slid out: the corner is empty again.
  await page.evaluate(() => window.openSinnohGame!.advance(80));
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().mapPopup)).toBeNull();
  const after = await overlayRegion(...corner);
  expect(after.opaque).toBe(0);
});
