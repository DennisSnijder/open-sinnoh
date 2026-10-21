/**
 * The striped awning of the c8_h01 houses (build model 219: Route 222, Sunyshore City) on the real ROM
 * (OPENSINNOH_NDS_ROM; desktop), at night, the player standing still east of the Route 222 pair.
 * The awning's material plays the model's BTP0 loop (bm_anime 84: textures c8_h01_b.1–.4 at frames
 * 0, 1, 3, 5 of 8), advanced once per 30 Hz field frame as on the DS. Its free edge flutters: that
 * is the ROM's animation. The draw itself must be stable: renders of one tick are identical (no depth,
 * sort or tint fighting), the loop repeats every 8 ticks, and within a loop the awning shows 4 images.
 */
import { expect, test, type Page } from '@playwright/test';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough');

/** The eastern awning of the Route 222 pair at 1280×720 with the player on 804,780 (PNG, base64). */
async function awning(page: Page): Promise<string> {
  await waitForScene(page);
  const box = (await page.locator('#main-canvas').boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x + 595, y: box.y + 400, width: 80, height: 130 } });
  return png.toString('base64');
}

test('the Route 222 awning flutters on its 8-tick loop and draws stably within a tick', async ({ page }) => {
  test.setTimeout(180_000);
  const { registries } = loadGamePacks([romSlice().pack]);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = pageDriver(page, 'test-artifacts/sunshade', 'sunshade');
  await driver.reset(1);
  const r = await runReplay(driver, 'warp platinum:MAP_HEADER_ROUTE_222 804 780 down\n+60 assert map platinum:MAP_HEADER_ROUTE_222\n', { registries });
  expect(r.error).toBeUndefined();
  for (let i = 0; i < 120 && (await driver.snapshot()).fade; i++) await driver.advance(1);
  await driver.setClock(undefined, '22:00');
  await driver.advance(1);
  // Start on the loop's first frame (the renderer animates by the game state's tick).
  const tick = (await driver.snapshot()).state.tick;
  if (tick % 8) await driver.advance(8 - (tick % 8));
  expect((await driver.snapshot()).state.tick % 8).toBe(0);
  const loop: string[] = [];
  for (let t = 0; t < 16; t++) {
    const first = await awning(page);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await awning(page), `tick ${t}: a second render of the same tick differs`).toBe(first);
    loop.push(first);
    await driver.advance(1);
  }
  for (let t = 0; t < 8; t++) expect(loop[t + 8], `ticks ${t} and ${t + 8}`).toBe(loop[t]);
  // Pattern frames 0–3 hold for 1, 2, 2 and 3 ticks: within a loop the awning changes at ticks 1, 3 and 5 only.
  const changes = loop.slice(1, 8).flatMap((s, i) => (s === loop[i] ? [] : [i + 1]));
  expect(changes).toEqual([1, 3, 5]);
  expect(new Set(loop.slice(0, 8)).size).toBe(4);
});
