/**
 * Time of day in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop): the same Route 201 view at noon,
 * at twilight and at night. The clock is the replay's frozen one, stepped by `time` lines; the area
 * light switches template (and every lit mesh is relit), so the night frame is darker and bluer than
 * noon, and twilight differs from both. Screenshots go to test-artifacts/time (gitignored: ROM content,
 * never commit).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/time';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough for the lighting');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

/**
 * Screenshots the page to `name` and returns the mean R, G, B of the main canvas's area in it (the
 * composited output, decoded in the page; the WebGL buffer itself is not kept between frames).
 */
async function shot(name: string): Promise<[number, number, number]> {
  await waitForScene(page);
  const box = (await page.locator('#main-canvas').boundingBox())!;
  mkdirSync(SHOTS, { recursive: true });
  const png = await page.screenshot({ path: join(SHOTS, `route-201-${name}.png`), clip: box });
  return page.evaluate(async (b64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const g = c.getContext('2d')!;
    g.drawImage(image, 0, 0, 64, 36);
    const px = g.getImageData(0, 0, 64, 36).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += px[i + k]!;
    const n = px.length / 4;
    return [sum[0]! / n, sum[1]! / n, sum[2]! / n] as [number, number, number];
  }, png.toString('base64'));
}

test('the same Route 201 view at noon, twilight and night', async () => {
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = pageDriver(page, SHOTS, 'route-201');
  await driver.reset(1);
  // A spot on Route 201 south of the grass, facing the trees; the default frozen clock is 12:00.
  const r = await runReplay(driver, 'warp platinum:MAP_HEADER_ROUTE_201 110 857 up\nuntil idle\n+30 assert map platinum:MAP_HEADER_ROUTE_201\n', { registries });
  expect(r.error).toBeUndefined();
  // The runner ends with a save round trip, whose load fades the map in again: wait it out.
  for (let i = 0; i < 120 && (await driver.snapshot()).fade; i++) await driver.advance(1);
  expect((await driver.snapshot()).fade).toBeNull();
  const at = async (time: string, name = time.replace(':', '')) => {
    await driver.setClock(undefined, time);
    await driver.advance(1);
    return shot(name);
  };
  const noon = await at('12:00');
  const twilight = await at('18:30');
  const night = await at('22:00');
  const back = await at('12:00', 'noon-again');
  const luma = ([r, g, b]: number[]) => 0.299 * r! + 0.587 * g! + 0.114 * b!;
  const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
  console.log(`route 201 mean RGB: noon ${noon.map(Math.round)}, twilight ${twilight.map(Math.round)}, night ${night.map(Math.round)}`);
  // Night is darker and bluer (light 0 goes from 24,24,20 to 11,11,16 of 31).
  expect(luma(night)).toBeLessThan(luma(noon) * 0.85);
  expect(night[2] / night[0]).toBeGreaterThan(noon[2] / noon[0]);
  // Twilight is its own warm template: redder than noon relative to blue.
  expect(diff(twilight, noon)).toBeGreaterThan(3);
  expect(twilight[0] / twilight[2]).toBeGreaterThan(noon[0] / noon[2]);
  // Back to noon relights the same scene as before.
  expect(diff(back, noon)).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});
