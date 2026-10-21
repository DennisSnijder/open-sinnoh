/**
 * The Distortion World drawn (OPENSINNOH_NDS_ROM; skipped without it), on desktop and phone: B1F loads at its
 * offset under its own camera, with the sky behind the field (the rear plane and the fogged far field show it),
 * its moving platforms and props; jumping onto the west wall turns the player's sprite and, on the wall's camera
 * row, rolls the camera. Checked: no page error, the scene loads, a varied frame (sky, land and props), the
 * player's state on the wall. Screenshots go to test-artifacts/distortion (gitignored: ROM content, never commit).
 */
import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { seedRomImport } from './seed.ts';

const SHOTS = 'test-artifacts/distortion';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.describe.configure({ mode: 'serial' });

/** Distinct colours and the share of pixels that are not black, of a screenshot (decoded in the page). */
async function frame(page: Page, name: string, project: string) {
  const png = await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<number>();
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
    }
    return { colours: colours.size, lit: lit / (px.length / 4) };
  }, png.toString('base64'));
}

test('B1F draws its sky, land and props, and the player turns onto the west wall', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 120_000 });
  const { state } = JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;
  const moved = {
    ...state,
    player: { zone: 'platinum:MAP_HEADER_DISTORTION_WORLD_B1F', x: 16, z: 49, y: 0, facing: 'left' },
    vars: { ...state.vars, 'platinum:VAR_DISTORTION_WORLD_PROGRESS': 5 },
    objects: [],
    follower: null,
    mapFeatures: null,
  };
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: moved }));
  await waitForScene(page);
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  await waitForScene(page);
  const land = await frame(page, 'b1f-land', info.project.name);
  expect(land.colours).toBeGreaterThan(200);
  expect(land.lit).toBeGreaterThan(0.6);
  const view = await page.evaluate(() => {
    const v = window.openSinnohApp!.game.world.view().distortion!;
    return { floors: v.floors.length, props: v.props.length, clouds: v.sky.clouds.length };
  });
  expect(view).toEqual({ floors: 2, props: expect.any(Number), clouds: 9 });
  expect(view.props).toBeGreaterThan(0);
  // Left past the camera row at (14, 257, 49) (the camera turns to face the wall), then the jump point at
  // (12, 257, 49) pressing left: onto the west wall.
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('left');
    for (let i = 0; i < 120 && g.snapshot().state.player.x !== 12; i++) g.advance(1);
    g.release('left');
    g.advance(20);
    g.press('left');
    g.advance(1);
    g.release('left');
    g.advance(30);
  });
  await waitForScene(page);
  const wall = await frame(page, 'b1f-wall', info.project.name);
  expect(wall.colours).toBeGreaterThan(200);
  const after = await page.evaluate(() => ({ player: window.openSinnohGame!.snapshot().state.player, roll: window.openSinnohApp!.game.world.view().distortion!.roll.cur }));
  expect(after.player).toMatchObject({ x: 11, z: 48, y: 258 * 16 });
  expect(after.roll).toBe(90);
  expect(errors).toEqual([]);
});
