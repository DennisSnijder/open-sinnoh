/** The actual field composite must fade distant DW geometry; only numerical canvas reads are retained. */
import { expect, test } from '@playwright/test';
import { seedRomImport } from './seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test('Distortion World fog visibly separates distant geometry from the foreground', async ({ page }) => {
  test.setTimeout(300_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate(() => {
    const state = window.openSinnohGame!.snapshot().state;
    state.player = { zone: 'platinum:MAP_HEADER_DISTORTION_WORLD_B1F', x: 16, z: 49, y: 0, facing: 'left' };
    state.vars['platinum:VAR_DISTORTION_WORLD_PROGRESS'] = 5;
    state.objects = [];
    state.mapFeatures = null;
    state.follower = null;
    window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }), 'arrival');
    window.openSinnohGame!.advance(60);
  });
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const result = await page.evaluate(async () => {
    // This browser-only entry shares the live app module. Hold the scene at one simulation tick,
    // temporarily reproduce the old slope, then restore it even if a read fails.
    const { DISTORTION_FOG: fog } = await new Function('return import("/__test/distortion.js")')() as typeof import('../../packages/render/src/distortion/index.ts');
    const read = () => new Promise<Uint8ClampedArray>(resolve => requestAnimationFrame(() => {
      const source = document.querySelector<HTMLCanvasElement>('#main-canvas')!;
      const copy = new OffscreenCanvas(source.width, source.height);
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(source, 0, 0);
      resolve(ctx.getImageData(0, 0, copy.width, copy.height).data);
    }));
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const corrected = await read();
    const slope = fog.slope;
    try {
      fog.slope = 1;
      await settle();
      const old = await read();
      let changed = 0, darker = 0, unchanged = 0;
      for (let i = 0; i < old.length; i += 4) {
        const difference = old[i]! + old[i + 1]! + old[i + 2]! - corrected[i]! - corrected[i + 1]! - corrected[i + 2]!;
        if (Math.abs(difference) > 12) changed++;
        if (difference > 12) darker++;
        if (Math.abs(difference) <= 3) unchanged++;
      }
      return { changed: changed / (old.length / 4), darker: darker / (old.length / 4), unchanged: unchanged / (old.length / 4) };
    } finally {
      fog.slope = slope;
      await settle();
    }
  });
  console.log(`DW fog canvas fractions: ${JSON.stringify(result)}`);
  expect(result.changed, JSON.stringify(result)).toBeGreaterThan(0.01);
  expect(result.darker, JSON.stringify(result)).toBeGreaterThan(0.01);
  expect(result.unchanged, JSON.stringify(result)).toBeGreaterThan(0.1);
});
