import { expect, test } from '@playwright/test';
import { seedRomImport } from './seed.ts';
import { waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

test('walking behind an Old Chateau bed preserves normal furniture occlusion', async ({ page }) => {
  test.setTimeout(120_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const { state } = window.openSinnohGame!.snapshot();
    state.player = { zone: 'platinum:MAP_HEADER_OLD_CHATEAU_BACK_MIDDLE_ROOM', x: 13, z: 4, y: 0, facing: 'right' };
    state.objects = [];
    state.follower = null;
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }), 'arrival');
    window.openSinnohGame!.advance(40);
    window.openSinnohGame!.press('right');
    window.openSinnohGame!.advance(1);
    window.openSinnohGame!.release('right');
    window.openSinnohGame!.advance(16);
  });
  const at = await page.evaluate(() => window.openSinnohGame!.snapshot().state.player);
  expect(at).toMatchObject({ x: 14, z: 4 });
  // The solid lower bed tile still blocks movement; the strip behind it remains walkable.
  await page.evaluate(() => {
    window.openSinnohGame!.press('down');
    window.openSinnohGame!.advance(1);
    window.openSinnohGame!.release('down');
    window.openSinnohGame!.advance(16);
  });
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player)).toMatchObject({ x: 14, z: 4 });
  await waitForScene(page);
  const pixels = await page.evaluate(async () => {
    const { Ceilings } = await new Function('return import("/__test/ceilings.js")')();
    const above = Ceilings.prototype.above;
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    const hero = () => ({ ...view(), actors: view().actors.slice(0, 1), previews: [], departed: undefined });
    world.view = hero;
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
      const natural = await capture();
      debug.spritesOnly = true;
      const sprite = await capture();
      let full = 0, visible = 0, naturalVisible = 0;
      for (let i = 0; i < sprite.length; i += 4) {
        if (sprite[i]! + sprite[i + 1]! + sprite[i + 2]! < 150) continue;
        full++;
        if (scene[i] === sprite[i] && scene[i + 1] === sprite[i + 1] && scene[i + 2] === sprite[i + 2]) visible++;
        if (natural[i] === sprite[i] && natural[i + 1] === sprite[i + 1] && natural[i + 2] === sprite[i + 2]) naturalVisible++;
      }
      return { full, visible, naturalVisible };
    } finally { Ceilings.prototype.above = above; world.view = view; debug.edges = true; debug.spritesOnly = false; }
  });
  expect(pixels.full).toBeGreaterThan(0);
  expect(pixels.naturalVisible).toBeGreaterThan(pixels.full / 2);
  expect(pixels.naturalVisible, 'the bed still covers the lower part of the player').toBeLessThan(pixels.full);
  expect(pixels.visible, 'furniture must not receive a bridge ceiling cap').toBe(pixels.naturalVisible);
});
