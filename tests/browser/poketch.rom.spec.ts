/**
 * The Pokétch in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone:
 * svc-poketch through the bridge (the same Pokétch model as headless), the card shown, with pixel checks
 * at its beats: the ROM frame and app screens in whole device pixels, the LCD in the screen palette.
 * Screenshots go to test-artifacts/poketch-rom (gitignored: ROM content, never commit), or OPENSINNOH_POKETCH_SHOTS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_POKETCH_SHOTS ?? 'test-artifacts/poketch-rom';
const REPLAY = readFileSync(join(import.meta.dirname, '../rom-replays/svc-poketch.replay'), 'utf8');

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await context?.close();
});

/** The card's screen: its size on the page, the canvas's distinct colours, and those inside the LCD. */
function screen(): Promise<{ css: { w: number; h: number }; colours: number; lcd: string[] }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.poketch-lcd')!;
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const all = new Set<number>();
    const lcd = new Set<string>();
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        all.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        if (x >= 16 && x < 208 && y >= 16 && y < 176) lcd.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
      }
    const r = c.getBoundingClientRect();
    return { css: { w: r.width, h: r.height }, colours: all.size, lcd: [...lcd] };
  });
}

test('svc-poketch: the device and its apps drawn from the ROM, driven like the DS bottom screen', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  const checks: string[] = [];
  const driver = pageDriver(page, SHOTS, `${project}-poketch`);
  const result = await runReplay(driver, REPLAY, {
    registries,
    name: 'svc-poketch.replay',
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      const name = line.action.name;
      // The card is the player's choice (P or the watch button); the game's Pokétch runs either way.
      const shown = await page.evaluate(() => window.openSinnohApp!.ui.state.poketch);
      if (!shown) await page.evaluate(() => window.openSinnohApp!.ui.togglePoketch());
      const app = await page.evaluate(() => window.openSinnohApp!.game.poketch()!.app);
      await expect(page.locator('.poketch')).toHaveAttribute('data-app', app);
      // The art loads asynchronously: wait for the ROM frame (many colours), then for the LCD to settle.
      await expect.poll(async () => (await screen()).colours, { timeout: 15_000 }).toBeGreaterThan(8);
      await settle(page);
      const s = await screen();
      // Whole device pixels per DS pixel, capped on big screens.
      const dpr = await page.evaluate(() => devicePixelRatio);
      const k = (s.css.w * dpr) / 256;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(0.01);
      expect(s.css.w).toBeLessThanOrEqual(512);
      // The LCD holds only screen-palette colours (green, theme 0): the four greens, white and the backdrop.
      expect(s.lcd.length, `${name}: ${s.lcd.join(' ')}`).toBeLessThanOrEqual(8);
      await page.locator('.poketch').screenshot({ path: `${SHOTS}/${project}-card-${name}.png` });
      checks.push(name);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checks.length).toBe(10);
  expect(errors).toEqual([]);
});
