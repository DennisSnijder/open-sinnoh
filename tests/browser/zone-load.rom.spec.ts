/**
 * Prop-heavy zones become ready (OPENSINNOH_NDS_ROM; skipped without it): Veilstone City, the Veilstone
 * Store 1F (elevator door BTP0 pattern clips) and the Sunyshore Pokémon Center 1F, each loaded at the
 * sweep's spawn point, finish loading within the sweep's per-zone wait (30 s) with no page error. These
 * timed out in the browser sweep while each prop model loaded one after another (and the dev server re-read
 * the pack per asset request). Loading back and forth frees the last scene: the renderer's GL geometries and
 * textures and the heap stay level over round trips.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameSnapshot } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { spawnPoint } from '../../packages/cli/src/sweep.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const ZONES = ['VEILSTONE_CITY', 'VEILSTONE_STORE_1F', 'SUNYSHORE_CITY_POKECENTER_1F'];

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'scene loading does not depend on the viewport');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await context?.close();
});

/** Loads a save with the player at the zone's spawn point (a remount: a new renderer scene on the same canvas). */
async function loadAt(name: string): Promise<void> {
  const zone = `platinum:MAP_HEADER_${name}`;
  const { state } = JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;
  const spawn = await page.evaluate((id) => {
    const reg = window.openSinnohApp!.game.registries;
    const z = reg.zones.get(id as never)!;
    return { zone: JSON.parse(JSON.stringify(z)), matrix: JSON.parse(JSON.stringify(reg.matrices.get(z.matrix)!)) };
  }, zone);
  const at = spawnPoint(spawn.zone, spawn.matrix);
  const moved = { ...state, player: { zone, x: at.x, z: at.z, y: 0, facing: 'down' }, objects: [], follower: null };
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: moved }));
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await waitForScene(page);
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.zone)).toBe(zone);
}

for (const name of ZONES) {
  test(`${name} becomes ready`, async () => {
    await loadAt(name);
    expect(errors).toEqual([]);
  });
}

test('loads free the last scene: GL objects and the heap stay level over round trips', async () => {
  test.setTimeout(240_000);
  const cdp = await context.newCDPSession(page);
  const measure = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const heapMB = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6;
    const gl = await page.evaluate(() => {
      const s = (globalThis as { openSinnohRenderStats?: { geometries: number; textures: number } }).openSinnohRenderStats!;
      return { geometries: s.geometries, textures: s.textures };
    });
    return { heapMB, ...gl };
  };
  // One round trip first: it fills the caches every later one reuses.
  await loadAt('VEILSTONE_CITY');
  await loadAt('SUNYSHORE_CITY_POKECENTER_1F');
  await loadAt('VEILSTONE_CITY');
  const first = await measure();
  for (let i = 0; i < 4; i++) {
    await loadAt('SUNYSHORE_CITY_POKECENTER_1F');
    await loadAt('VEILSTONE_CITY');
  }
  const last = await measure();
  // Before the fix each load kept the old renderer (its programs, GL state and scene): about 0.3 MB and every
  // texture and geometry of the scene per load.
  expect(last.geometries).toBeLessThanOrEqual(first.geometries);
  expect(last.textures).toBeLessThanOrEqual(first.textures);
  expect(last.heapMB - first.heapMB).toBeLessThan(2);
  expect(errors).toEqual([]);
});
