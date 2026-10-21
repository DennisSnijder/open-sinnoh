/**
 * The special encounters' field effects in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through
 * `window.openSinnohGame` (tests/rom-replays sys-honey-tree, sys-sweet-scent, parts/poke-radar-charge): Route 205 South's
 * honey tree shaking with a Pokémon waiting (the world draws the tree prop with its shake clip), the Poké Radar's
 * shaking patches (RADAR_GRASS_* billboards) and Sweet Scent's pink over the field. At each screenshot line the field is
 * drawn and lit and the effect is in the view; the pink is measured on the canvas. Screenshots go to test-artifacts
 * (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { FieldView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { mainCanvasStats, pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/wild-extras';

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
    const info = test.info();
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'desktop and phone');
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

const fieldView = () => page.evaluate(() => JSON.parse(JSON.stringify(window.openSinnohApp!.game.world.view()))) as Promise<FieldView>;

/** The mean red minus the mean green of the field canvas (Sweet Scent's pink raises red and lowers green). */
const redOverGreen = () =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const c = document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(src, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          let r = 0;
          let g = 0;
          for (let i = 0; i < px.length; i += 4) {
            r += px[i]!;
            g += px[i + 1]!;
          }
          resolve((r - g) / (px.length / 4));
        }),
      ),
  );

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'honey-tree-shake'(name) {
    const view = await fieldView();
    const prop = [...registries.newGame.values()][0]!.specialEncounters!.honeyTrees.prop;
    const tree = (await page.evaluate(() => window.openSinnohApp!.game.state.encounters!.honeyTrees[0]!)) as { shakes: number };
    // The tree prop is the world's to draw; with one to three shakes rolled it plays shake-(n − 1).
    expect(view.props?.some((p) => p.prop === prop), name).toBe(true);
    const shaking = view.props?.filter((p) => p.prop === prop && p.clip).map((p) => p.clip!.name) ?? [];
    expect(shaking, name).toEqual(tree.shakes ? [`shake-${tree.shakes - 1}`] : []);
  },
  async 'radar-patches'(name) {
    const view = await fieldView();
    expect(view.effects.filter((e) => /RADAR_GRASS_(SOFT|HARD|SHINY)$/.test(e.effect)).length, name).toBeGreaterThan(0);
  },
  async 'sweet-scent'(name) {
    const view = await fieldView();
    expect(view.tint?.alpha ?? 0, name).toBeGreaterThan(0.5);
    expect(await redOverGreen(), name).toBeGreaterThan(20);
  },
};

for (const file of ['sys-honey-tree', 'sys-sweet-scent', 'parts/poke-radar-charge']) {
  test(`${file} in the app, with its field effect at the screenshot line`, async () => {
    const info = test.info();
    test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'desktop and phone');
    test.setTimeout(600_000);
    const base = pageDriver(page, SHOTS, `${info.project.name}-${file.replace('/', '-')}`);
    const seen: string[] = [];
    const driver = {
      ...base,
      async screenshot(name: string) {
        await waitForScene(page);
        const stats = await mainCanvasStats(page);
        expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
        expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.1);
        await CHECKS[name]!(name);
        seen.push(name);
        return base.screenshot!(name);
      },
    };
    const result = await runReplay(driver, readReplay(`${file}.replay`), { registries, seed: 1, name: `${file}.replay`, resolve: resolveReplay, repeat: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
