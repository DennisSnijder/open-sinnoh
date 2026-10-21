/**
 * Field fixes in the browser (OPENSINNOH_NDS_ROM; skipped without it; desktop): the Galactic HQ doors are drawn (their
 * own slab model, galactic_hq_door), Route 214's Spring Path is closed before it is found, and walking from Route 210
 * South onto rainy Route 215 fades the rain and its fog in rather than switching them on. Screenshots go to
 * test-artifacts/field-fixes (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameState } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/field-fixes';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'renderer behaviour: desktop');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

interface Stats {
  actors: { sprite: string; object: string | null; visible: boolean; onScreen: boolean }[];
  weather: { id: string; phase: string; particles: number; fog: number | null }[];
}
const stats = () => page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats);
/** Two frames, so the renderer has drawn the current state. */
const frames = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await waitForScene(page);
});

test.afterAll(async () => {
  await context?.close();
});

async function arrive(zone: string, x: number, z: number, facing: 'up' | 'down' | 'left' | 'right', vars: Record<string, number> = {}): Promise<void> {
  const state: GameState = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  state.player = { zone: `platinum:MAP_HEADER_${zone}` as never, x, z, y: 0, facing };
  state.objects = [];
  state.follower = null;
  Object.assign(state.vars, vars);
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }));
  await page.evaluate(() => window.openSinnohGame!.advance(40));
  await waitForScene(page);
}

test('the Galactic HQ 1F door is drawn', async () => {
  await arrive('GALACTIC_HQ_1F', 22, 20, 'up');
  await expect.poll(async () => (await stats()).actors.filter((a) => a.sprite === 'platinum:OBJ_EVENT_GFX_GALACTIC_HQ_DOOR' && a.object && a.visible && a.onScreen).length, { timeout: 20_000 }).toBe(2);
  await page.screenshot({ path: `${SHOTS}/galactic-hq-1f-door.png` });
  expect(await page.evaluate(() => window.openSinnohApp!.game.log.counts.get('render:model-object') ?? 0)).toBe(0);
});

test('the Spring Path is closed off Route 214 before it is found', async () => {
  await arrive('ROUTE_214', 733, 706, 'right');
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().matrix)).toBe('platinum:matrix/0/spring-path-closed');
  await page.screenshot({ path: `${SHOTS}/route-214-spring-path-closed.png` });
  await arrive('ROUTE_214', 733, 706, 'right', { 'platinum:VAR_HIDDEN_LOCATION_SPRING_PATH': 0x312 });
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().matrix)).toBe('platinum:matrix/0');
  await page.screenshot({ path: `${SHOTS}/route-214-spring-path-open.png` });
});

test('walking onto Route 215 fades the rain and its fog in', async () => {
  test.setTimeout(120_000);
  await arrive('ROUTE_210_SOUTH', 573, 597, 'right');
  await frames();
  expect((await stats()).weather).toEqual([{ id: 'platinum:OVERWORLD_WEATHER_CLEAR', phase: 'steady', particles: 0, fog: null }]);
  // Each tick is drawn, as in play.
  await page.evaluate(() => window.openSinnohGame!.press('right'));
  for (let n = 0; (await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.zone)) !== 'platinum:MAP_HEADER_ROUTE_215'; n++) {
    expect(n, 'reaches Route 215').toBeLessThan(200);
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    await frames();
  }
  await page.evaluate(() => window.openSinnohGame!.release('right'));
  // Each step is drawn: the old weather goes, the rain loads, then fades in over its spawner ramp and 127 fog steps.
  const seen: Stats['weather'][] = [];
  for (let i = 0; i < 200; i++) {
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    await frames();
    seen.push((await stats()).weather);
    if (i === 30) await page.screenshot({ path: `${SHOTS}/route-215-rain-fading-in.png` });
  }
  const rain = seen.map((w) => w.find((x) => x.id === 'platinum:OVERWORLD_WEATHER_RAINING'));
  const first = rain.findIndex((r) => r);
  expect(first, 'the rain starts after the load gap').toBeGreaterThan(5);
  expect(rain[first]!.phase).toBe('in');
  const fogs = rain.slice(first).map((r) => r!.fog ?? 0);
  expect(fogs[0], 'the fog starts thin').toBeLessThan(20);
  expect(fogs.at(-1), 'and thickens to the full table').toBe(124);
  const particles = rain.slice(first).map((r) => r!.particles);
  expect(particles[1]!, 'drops start few').toBeLessThan(particles.at(-1)! / 2);
  expect(rain.at(-1)!.phase).toBe('steady');
  await page.screenshot({ path: `${SHOTS}/route-215-rain.png` });
  expect(errors).toEqual([]);
});
