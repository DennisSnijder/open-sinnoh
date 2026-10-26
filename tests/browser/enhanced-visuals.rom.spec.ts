/**
 * Enhanced visuals on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), on desktop and phone: the angled camera
 * on a fogged route (Route 210 North) draws its fog from linear depth, so the field fades into the DS's fog colour
 * rather than into black; the night glows on a town's lamps and lit windows in SUBTLE and CINEMATIC; and CINEMATIC's
 * frame time on the phone (logged, with the quality the renderer picked). Screenshots go to
 * test-artifacts/enhanced-visuals (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameState } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/enhanced-visuals';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
let project = '';
const errors: string[] = [];

interface Stats {
  frames: number;
  renderMs: number[];
  gpuMs: number[];
  enhanced: { camera: string; lowPower: boolean } | null;
  enhancedFrame: { angled: boolean; lamps: number; quality: string } | null;
  weather: { id: string; fog: number | null }[];
}
const stats = () => page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats);
const enhanced = (config: string | null) => page.evaluate((c) => (window as unknown as { openSinnohEnhanced: (c: string | null) => void }).openSinnohEnhanced(c), config);

/** Waits until the field has drawn `n` more frames. */
const frames = (n = 4) =>
  page.evaluate(async (n) => {
    const s = (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats;
    const from = s.frames;
    while (s.frames - from < n) await new Promise(requestAnimationFrame);
  }, n);

/** Mean RGB (0..255) of a horizontal band of the main canvas (0 top, 1 bottom), read in the frame it is drawn. */
const band = (from: number, to: number) =>
  page.evaluate(
    async ([from, to]) => {
      await new Promise(requestAnimationFrame);
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, src.height * from!, src.width, src.height * (to! - from!), 0, 0, 64, 64);
      const px = g.getImageData(0, 0, 64, 64).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += px[i + k]!;
      return sum.map((v) => v / (px.length / 4));
    },
    [from, to] as const,
  );

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000);
  project = info.project.name;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile, hasTouch: use.hasTouch });
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

async function arrive(zone: string, x: number, z: number, facing: 'up' | 'down' | 'left' | 'right', time: string): Promise<void> {
  await enhanced(null);
  const state: GameState = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  state.player = { zone: `platinum:MAP_HEADER_${zone}` as never, x, z, y: 0, facing };
  state.objects = [];
  state.follower = null;
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }));
  await page.evaluate((t) => window.openSinnohGame!.setClock(undefined, t), time);
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  await waitForScene(page);
  await frames();
}

/** Switches the look and waits until the renderer draws it (the pipeline chunk loads on first use). */
async function look(config: string | null, angled = false): Promise<void> {
  await enhanced(config);
  if (config) await expect.poll(async () => (await stats()).enhancedFrame?.angled ?? null, { timeout: 20_000 }).toBe(angled);
  else await expect.poll(async () => (await stats()).enhanced).toBeNull();
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await waitForScene(page);
  await frames(8);
}

test('the angled camera keeps the fog on a fogged route', async () => {
  test.setTimeout(120_000);
  await arrive('ROUTE_210_NORTH', 501, 522, 'down', '12:00');
  expect((await stats()).weather.find((w) => w.fog !== null), 'Route 210 North is fogged').toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/${project}-route-210-fog-ds.png` });
  const dsTop = await band(0, 0.15);
  await look('follow', true);
  await page.screenshot({ path: `${SHOTS}/${project}-route-210-fog-angled.png` });
  // The far field past the map fades into the fog's colour, as under the DS camera, not into the black rear plane.
  const top = await band(0, 0.15);
  const luma = (c: number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
  expect(luma(top), 'the top of the angled view is fogged').toBeGreaterThan(luma(dsTop) * 0.8);
  await look('cinematic,follow', true);
  await page.screenshot({ path: `${SHOTS}/${project}-route-210-fog-cinematic-angled.png` });
  expect(errors).toEqual([]);
});

test('lamps and lit windows glow at night in SUBTLE and CINEMATIC', async () => {
  test.setTimeout(120_000);
  for (const [zone, x, z, facing] of [
    ['JUBILIFE_CITY', 175, 745, 'up'],
    ['SANDGEM_TOWN', 177, 847, 'up'],
  ] as const) {
    const name = zone.toLowerCase().replace(/_/g, '-');
    await arrive(zone, x, z, facing, '22:00');
    await page.screenshot({ path: `${SHOTS}/${project}-${name}-night-ds.png` });
    for (const style of ['subtle', 'cinematic'] as const) {
      await look(style);
      expect((await stats()).enhancedFrame!.lamps, `${zone} has glows`).toBeGreaterThan(0);
      await page.screenshot({ path: `${SHOTS}/${project}-${name}-night-${style}.png` });
    }
  }
  expect(errors).toEqual([]);
});

/**
 * The field's frame time by look, measured with the frame synced (`syncTiming`: render milliseconds include the GPU's
 * work; GPU milliseconds where the browser has a timer query). `@full` forces the full-quality chain on this device
 * (the phone's own pick is the cheaper one), to compare the two.
 */
test('CINEMATIC frame time', async () => {
  test.setTimeout(300_000);
  await arrive('JUBILIFE_CITY', 175, 745, 'up', '22:00');
  type Debug = { openSinnohRenderDebug: { syncTiming: boolean } };
  const measure = async (look_: string) => {
    const [config, full] = look_.split('@');
    await look(config === 'ds' ? null : config!);
    if (full) await page.evaluate(() => (window as unknown as { openSinnohEnhanced: (c: object) => void }).openSinnohEnhanced({ ...(globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats.enhanced!, lowPower: false }));
    await page.evaluate(() => ((globalThis as unknown as Debug).openSinnohRenderDebug.syncTiming = true));
    await frames(10);
    const before = await stats();
    const [from, fromGpu] = [before.renderMs.length, before.gpuMs.length];
    await frames(120);
    const s = await stats();
    await page.evaluate(() => ((globalThis as unknown as Debug).openSinnohRenderDebug.syncTiming = false));
    const q = (list: number[], at: number) => (list.length ? Math.round(list.sort((a, b) => a - b)[Math.floor(list.length * at)]! * 10) / 10 : null);
    const ms = s.renderMs.slice(from);
    return { median: q(ms, 0.5), p90: q([...ms], 0.9), gpu: q(s.gpuMs.slice(fromGpu), 0.5), quality: s.enhancedFrame?.quality ?? null };
  };
  const out: Record<string, unknown> = {};
  for (const look_ of ['ds', 'subtle', 'cinematic', 'cinematic@full']) out[look_] = await measure(look_);
  const buffer = await page.evaluate(() => {
    const c = document.getElementById('main-canvas') as HTMLCanvasElement;
    return `${c.width}x${c.height}`;
  });
  console.log(`frame time (${project}, ${buffer}, ms): ${JSON.stringify(out)}`);
  test.info().annotations.push({ type: 'frame time', description: `${project} ${buffer} ${JSON.stringify(out)}` });
  expect(errors).toEqual([]);
});
