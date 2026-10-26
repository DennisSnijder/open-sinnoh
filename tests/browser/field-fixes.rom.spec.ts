/**
 * Field fixes in the browser (OPENSINNOH_NDS_ROM; skipped without it; desktop): the Galactic HQ doors are drawn (their
 * own slab model, galactic_hq_door), Route 214's Spring Path is closed before it is found, and walking from Route 210
 * South onto rainy Route 215 fades the rain and its fog in rather than switching them on, and the rain's drops and the
 * snow routes' flakes are drawn (the weather tasks' sprites, in the DS look and CINEMATIC). Screenshots go to
 * test-artifacts/field-fixes (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameState } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { romContext, resetRomDevice } from './rom-context.ts';

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
/**
 * The pixels the weather's 2D layers change: the field canvas drawn with them and, with no tick between, without them
 * (`openSinnohRenderDebug.weather`), read in the frame each is drawn (the buffer is not preserved). `bright` counts the
 * changed pixels that are lighter than the field under them (drops and flakes, not a tint).
 */
const weatherPixels = () =>
  page.evaluate(async () => {
    const debug = (globalThis as unknown as { openSinnohRenderDebug: { weather: boolean } }).openSinnohRenderDebug;
    const grab = async () => {
      await new Promise(requestAnimationFrame);
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const game = window.openSinnohGame!;
    const tick = game.snapshot().tick;
    // Two frames without the layers first: what changes between them on its own (`noise`) is not the layers'.
    debug.weather = false;
    const still = await grab();
    const off = await grab();
    debug.weather = true;
    const on = await grab();
    if (game.snapshot().tick !== tick) throw new Error('weatherPixels: the game ticked between the frames');
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let changed = 0;
      let bright = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = a[i]! + a[i + 1]! + a[i + 2]! - (b[i]! + b[i + 1]! + b[i + 2]!);
        if (d !== 0) changed++;
        if (d > 60) bright++;
      }
      return { changed: changed / (a.length / 4), bright: bright / (a.length / 4) };
    };
    return { ...diff(on, off), noise: diff(off, still).bright };
  });
const enhanced = (config: string | null) => page.evaluate((c) => (window as unknown as { openSinnohEnhanced: (c: string | null) => void }).openSinnohEnhanced(c), config);

/** Two frames, so the renderer has drawn the current state. */
const frames = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000);
  const use = info.project.use;
  // The worker's seeded context (rom-context.ts): the import is copied into the browser once per worker, not per file.
  context = await romContext(browser, use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await waitForScene(page);
});

test.afterAll(async () => {
  await page?.close();
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
  // About a hundred drawn frames, which a loaded machine draws a few a second.
  test.setTimeout(300_000);
  await arrive('ROUTE_210_SOUTH', 573, 597, 'right');
  await frames();
  expect((await stats()).weather).toEqual([{ id: 'platinum:OVERWORLD_WEATHER_CLEAR', phase: 'steady', particles: 0, fog: null }]);
  // The walk to the zone edge (the renderer steps the weather through every tick since its last frame).
  expect(
    await page.evaluate(() => {
      const g = window.openSinnohGame!;
      g.press('right');
      let n = 0;
      for (; n < 200 && g.snapshot().state.player.zone !== 'platinum:MAP_HEADER_ROUTE_215'; n++) g.advance(1);
      g.release('right');
      return n;
    }),
    'reaches Route 215',
  ).toBeLessThan(200);
  await frames();
  // The old weather goes, the rain loads, then fades in over its spawner ramp and 127 fog steps: every tick of the
  // start is drawn, then every eighth, 200 ticks in all.
  const seen: Stats['weather'][] = [];
  for (let t = 0; t < 200; ) {
    const step = t < 48 ? 1 : 8;
    await page.evaluate((n) => window.openSinnohGame!.advance(n), step);
    t += step;
    await frames();
    seen.push((await stats()).weather);
    if (t === 30) await page.screenshot({ path: `${SHOTS}/route-215-rain-fading-in.png` });
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
  // The drops are drawn: light streaks over the field, not a tint over all of it.
  const drops = await weatherPixels();
  expect(drops.bright, 'drop pixels').toBeGreaterThan(0.0005 + 3 * drops.noise);
  expect(drops.changed, 'only the drops change').toBeLessThan(0.05);
  // CINEMATIC draws the field through its post chain; the weather still goes over it, to the screen.
  await enhanced('cinematic');
  await expect.poll(async () => ((p) => p.bright - 3 * p.noise)(await weatherPixels()), { timeout: 20_000 }).toBeGreaterThan(0.0005);
  await page.screenshot({ path: `${SHOTS}/route-215-rain-cinematic.png` });
  await enhanced(null);
  expect(errors).toEqual([]);
});

test('the snow routes draw the weather tasks flakes, in the DS look and CINEMATIC', async () => {
  test.setTimeout(120_000);
  for (const [zone, x, z, weather] of [
    ['ROUTE_216', 298, 402, 'platinum:OVERWORLD_WEATHER_HEAVY_SNOW'],
    ['ROUTE_217', 299, 308, 'platinum:OVERWORLD_WEATHER_BLIZZARD'],
  ] as const) {
    await arrive(zone, x, z, 'down');
    await frames();
    const shown = (await stats()).weather;
    expect(shown).toMatchObject([{ id: weather, phase: 'steady' }]);
    // A map load starts the task at full (ov5_021D7568's prewarm): flakes are spread over the screen at once.
    expect(shown[0]!.particles).toBeGreaterThan(20);
    const flakes = await weatherPixels();
    expect(flakes.bright, `${zone} flake pixels`).toBeGreaterThan(0.002 + 3 * flakes.noise);
    await page.screenshot({ path: `${SHOTS}/${zone.toLowerCase()}-snow.png` });
    await enhanced('cinematic');
    await expect.poll(async () => ((p) => p.bright - 3 * p.noise)(await weatherPixels()), { timeout: 20_000 }).toBeGreaterThan(0.002);
    await page.screenshot({ path: `${SHOTS}/${zone.toLowerCase()}-snow-cinematic.png` });
    await enhanced(null);
  }
  expect(errors).toEqual([]);
});
