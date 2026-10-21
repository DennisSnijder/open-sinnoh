import { expect, test } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

// The Route 209 blockade (LOCALID_POKEFAN_M_2, LOCALID_HIKER_2) stands on the gate's warp tiles, on the
// threshold ramp in front of its raised doorway floor. That floor, sampled at the sprites' right edge, capped
// their depth over bounds that took in the ramp under their feet: everything left of the gate was hidden.
test('the Hearthome east gate blockade is not cut by the gate doorway', async ({ page }) => {
  test.setTimeout(120_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const { state } = window.openSinnohGame!.snapshot();
    state.player = { zone: 'platinum:MAP_HEADER_HEARTHOME_CITY', x: 502, z: 726, y: 0, facing: 'right' };
    state.objects = [];
    state.follower = null;
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }), 'arrival');
    window.openSinnohGame!.advance(40);
  });
  await waitForScene(page);
  const pixels = await page.evaluate(async () => {
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    const blockade = view().actors.filter((a) => a.cur[0] === 505 * 16 + 8 && (a.cur[2] === 726 * 16 + 8 || a.cur[2] === 727 * 16 + 8));
    if (blockade.length !== 2) throw new Error(`expected the two blockade objects, found ${blockade.length}`);
    const keys = new Set(blockade.map((a) => a.localId));
    world.view = () => ({ ...view(), actors: view().actors.filter((a) => keys.has(a.localId)), previews: [], departed: undefined });
    const { Ceilings } = await new Function('return import("/__test/ceilings.js")')();
    const above = Ceilings.prototype.above;
    const debug = (globalThis as unknown as { openSinnohRenderDebug: { edges: boolean; spritesOnly: boolean } }).openSinnohRenderDebug;
    debug.edges = false;
    const capture = async () => {
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const g = c.getContext('2d')!; g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    try {
      const scene = await capture();
      Ceilings.prototype.above = () => null;
      const uncapped = await capture();
      debug.spritesOnly = true;
      const sprite = await capture();
      let full = 0, visible = 0, uncappedVisible = 0;
      const same = (p: Uint8ClampedArray, i: number) => p[i] === sprite[i] && p[i + 1] === sprite[i + 1] && p[i + 2] === sprite[i + 2];
      for (let i = 0; i < sprite.length; i += 4) {
        if (sprite[i]! + sprite[i + 1]! + sprite[i + 2]! === 0) continue;
        full++;
        if (same(scene, i)) visible++;
        if (same(uncapped, i)) uncappedVisible++;
      }
      return { full, visible, uncappedVisible };
    } finally { Ceilings.prototype.above = above; world.view = view; debug.edges = true; debug.spritesOnly = false; }
  });
  expect(pixels.full).toBeGreaterThan(0);
  expect(pixels.uncappedVisible, 'the doorway itself leaves the blockade in view').toBeGreaterThan(pixels.full * 0.9);
  expect(pixels.visible, 'the raised doorway floor must not cap the sprites standing on its ramp').toBeGreaterThan(pixels.uncappedVisible * 0.98);
});
