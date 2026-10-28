/**
 * The Frontier's record viewer and the facilities' pre-battle wipes in the app on the real ROM (OPENSINNOH_NDS_ROM;
 * desktop and phone): sys-frontier-records (after the Hall singles challenge, the Hall's record list and the singles
 * record, moved to Lucario, a DS scene inside the screen from the ROM's art with its lines), the Hall's block wipe (sys-hall-single: part
 * of the room black, the rest still drawn) and the Factory's line wipe (sys-factory-single: the room's rows still drawn,
 * darker), each sampled as the overlay draws it. Screenshots go to test-artifacts/frontier-records (ROM content, never
 * commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { FrontierRecordsView, FrontierView, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { frame } from './frontier-scene.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/frontier-records';

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

/** The overlay's pixels in a DS rect of the frontier frame: opaque colours and the mean luma (0–255). */
function region(x0: number, y0: number, x1: number, y1: number) {
  return page.evaluate(
    ([a, b, c, d]) => {
      const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
      const f = window.openSinnohApp!.overlayFrame();
      const px = canvas.getContext('2d')!.getImageData(f.x + a * f.scale, f.y + b * f.scale, (c - a) * f.scale, (d - b) * f.scale).data;
      const colours = new Set<number>();
      let luma = 0;
      for (let i = 0; i < px.length; i += 4) {
        colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        luma += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      }
      return { colours: colours.size, luma: luma / (px.length / 4) };
    },
    [x0, y0, x1, y1] as const,
  );
}

const view = () => page.evaluate(() => window.openSinnohApp!.game.scripts.view().frontier ?? null) as Promise<FrontierView | null>;

test("the record viewer: the Hall's record list, then Lucario's record from the ROM's art", async () => {
  test.setTimeout(900_000);
  const lucario = registries.species.get('platinum:SPECIES_LUCARIO' as Id)!.name;
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-records`);
  let checked = 0;
  const driver = {
    ...base,
    async screenshot(name: string) {
      if (name === 'records-list') {
        const menu = await page.evaluate(() => window.openSinnohGame!.snapshot().view.menu?.entries ?? null);
        expect(menu, name).toEqual([lucario, registries.texts.get('platinum:MenuEntries_Text_ListMenu_Exit' as Id)!.text]);
        checked++;
      }
      if (name === 'records-hall') {
        const v = (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as FrontierRecordsView | null;
        expect(v?.app, name).toBe('frontier-records');
        expect(v?.black, name).toBe(0);
        await page.waitForSelector('.frontier-records .ds-scene-canvas', { timeout: 20_000 });
        await expect.poll(async () => (await canvasStats(page, '.frontier-records .ds-scene-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(8);
        await settle(page);
        // The DS screen inside the viewport, at whole device pixels.
        const box = await page.locator('.frontier-records .ds-scene-stage').boundingBox();
        const vp = page.viewportSize()!;
        expect(box!.x, name).toBeGreaterThanOrEqual(-0.5);
        expect(box!.y, name).toBeGreaterThanOrEqual(-0.5);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(vp.width + 0.5);
        expect(box!.y + box!.height, name).toBeLessThanOrEqual(vp.height + 0.5);
        expect(Math.abs(box!.width / box!.height - 256 / 192), name).toBeLessThan(0.01);
        expect(await page.locator('.frontier-records .sr-only').textContent(), name).toContain(lucario);
        checked++;
      }
      return base.screenshot!(name);
    },
  };
  const result = await runReplay(driver, readReplay('sys-frontier-records.replay'), { registries, seed: 1, name: 'sys-frontier-records.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checked).toBe(2);
  expect(errors).toEqual([]);
});

/**
 * Runs a facility's replay; before its first battle, steps the page a tick at a time (messages pressed through) to
 * `frames` frames into the wipe and runs `check` on that frame.
 */
async function wipeFrame(file: string, kind: 'blocks' | 'lines', frames: number, check: (v: FrontierView) => Promise<void>): Promise<void> {
  const project = test.info().project.name;
  let done = false;
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-${file}`), readReplay(`${file}.replay`), {
    registries,
    seed: 1,
    name: `${file}.replay`,
    resolve: resolveReplay,
    repeat: false,
    async beforeLine() {
      if (done || !(await view())) return true;
      const reached = await page.evaluate(
        ([want, n]) => {
          const g = window.openSinnohApp!.game;
          let into = 0;
          for (let i = 0; i < 6000; i++) {
            const v = g.scripts.view();
            if (v.frontier?.wipe?.kind === want && ++into === n) return true;
            if (!v.frontier) return false;
            if (v.message?.waitingForInput) {
              g.press('a');
              g.advance(1);
              g.release('a');
            }
            g.advance(1);
          }
          return false;
        },
        [kind, frames] as const,
      );
      if (!reached) return true;
      await frame(page);
      await check((await view())!);
      await page.screenshot({ path: `${SHOTS}/${project}-${file}-wipe.png` });
      done = true;
      return true;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(done).toBe(true);
}

test("the Hall's wipe: black blocks over part of the room, the rest still drawn", async () => {
  test.setTimeout(900_000);
  await wipeFrame('sys-hall-single', 'blocks', 10, async (v) => {
    if (v.wipe?.kind !== 'blocks') throw new Error('not the blocks wipe');
    // Frame 10: rows 0, 5, 6 and 11 are filled, rows 1, 4, 7 and 10 are being filled; rows 2, 3, 8 and 9 not yet.
    const filled = await region(0, 0, 256, 16);
    const open = await region(0, 32, 256, 64);
    expect(filled.luma).toBeLessThan(2);
    expect(open.colours).toBeGreaterThan(4);
  });
  expect(errors).toEqual([]);
});

test("the Factory's wipe: the room's rows still drawn, darker", async () => {
  test.setTimeout(900_000);
  await wipeFrame('sys-factory-single', 'lines', 12, async (v) => {
    if (v.wipe?.kind !== 'lines') throw new Error('not the line wipe');
    expect(v.fade?.color).toBe('black');
    const r = await region(0, 0, 256, 192);
    expect(r.colours).toBeGreaterThan(4);
    expect(r.luma).toBeGreaterThan(2);
  });
  expect(errors).toEqual([]);
});
