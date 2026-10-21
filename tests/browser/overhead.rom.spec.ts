import { expect, test } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

test('Oreburgh Mine entrance conveyor covers the player’s hat at the upper level', async ({ page }) => {
  test.setTimeout(120_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const { state } = window.openSinnohGame!.snapshot();
    state.player = { zone: 'platinum:MAP_HEADER_OREBURGH_MINE_B1F', x: 14, z: 3, y: 0, facing: 'left' };
    state.objects = [];
    state.follower = null;
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }), 'arrival');
  });
  await page.evaluate(() => window.openSinnohGame!.advance(40));
  await waitForScene(page);
  const pixels = await page.evaluate(async () => {
    const { Ceilings } = await new Function('return import("/__test/ceilings.js")')();
    const above = Ceilings.prototype.above;
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    const debug = (globalThis as unknown as { openSinnohRenderDebug: { edges: boolean } }).openSinnohRenderDebug;
    debug.edges = false;
    const capture = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const g = c.getContext('2d')!; g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    try {
      const fixed = await capture();
      Ceilings.prototype.above = () => null;
      const original = await capture();
      world.view = () => ({ ...view(), actors: view().actors.map((a, i) => i === 0 ? { ...a, visible: false } : a) });
      const background = await capture();
      const hatColor = (px: Uint8ClampedArray, i: number) => px[i]! > 130 && px[i + 1]! < px[i]! * 0.7 && px[i + 2]! < px[i]! * 1.3;
      let originalLeaks = 0, fixedLeaks = 0, repaired = 0;
      for (let i = 0; i < original.length; i += 4) {
        const belt = background[i]! <= background[i + 1]! && background[i]! <= background[i + 2]!;
        if (!belt || !hatColor(original, i)) continue;
        originalLeaks++;
        if (hatColor(fixed, i)) fixedLeaks++;
        if (fixed[i] === background[i] && fixed[i + 1] === background[i + 1] && fixed[i + 2] === background[i + 2]) repaired++;
      }
      return { originalLeaks, fixedLeaks, repaired };
    } finally { Ceilings.prototype.above = above; world.view = view; debug.edges = true; }
  });
  expect(pixels.originalLeaks, 'the reported pose reproduces hat pixels over the belt').toBeGreaterThan(0);
  expect(pixels.fixedLeaks, 'the hat stays behind the belt').toBe(0);
  expect(pixels.repaired, 'the belt’s own pixels are restored').toBeGreaterThan(0);
});
