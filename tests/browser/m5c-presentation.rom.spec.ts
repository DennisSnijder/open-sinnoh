/** Real field props on desktop and phone. ROM pixels stay in gitignored test-artifacts. */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CountingStubLog, createGame, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const SHOTS = join(import.meta.dirname, '../../test-artifacts/m5c-presentation');
test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

async function open(page: Page, zone: string, x: number, z: number) {
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });
  const r = await runReplay(gameDriver(game), `warp platinum:MAP_HEADER_${zone} ${x} ${z} up\nuntil idle`, { registries: game.registries, seed: 1, repeat: false });
  if (!r.ok) throw new Error(r.error);
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate((save) => window.openSinnohGame!.load(save), saveToJson(game.save()));
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await waitForScene(page);
}

async function pixels(page: Page): Promise<number[]> {
  await waitForScene(page);
  return page.evaluate(() => new Promise<number[]>((resolve) => requestAnimationFrame(() => {
    const copy = document.createElement('canvas');
    copy.width = 256;
    copy.height = 192;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(document.getElementById('main-canvas') as HTMLCanvasElement, 0, 0, 256, 192);
    resolve(Array.from(ctx.getImageData(0, 0, 256, 192).data));
  })));
}
const changed = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 20).length;

test('the League lift prop is drawn and travels with its rider', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'POKEMON_LEAGUE_ELEVATOR_TO_AARON_ROOM', 4, 15);
  const driver = pageDriver(page, SHOTS, info.project.name);
  const bottom = await pixels(page);
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().platformLift?.position[1])).toBe(0);
  await driver.screenshot!('league-lift-bottom');
  // The real coord event at (4,11) starts the native lift task.
  await page.evaluate(() => window.openSinnohGame!.press('up'));
  await page.evaluate(() => {
    for (let i = 0; i < 240 && !window.openSinnohApp!.game.world.view().platformLift!.position[1]; i++) window.openSinnohGame!.advance(1);
    window.openSinnohGame!.release('up');
    window.openSinnohGame!.advance(35);
  });
  const ride = await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    return { lift: game.world.view().platformLift!.position[1], player: game.state.player.y };
  });
  expect(ride.lift).toBeGreaterThan(0);
  expect(ride.lift).toBeLessThan(160);
  expect(ride.player).toBe(ride.lift);
  const riding = await pixels(page);
  expect(changed(bottom, riding)).toBeGreaterThan(100);
  // Remove only the live prop from the view: its pixels must actually disappear.
  await page.evaluate(() => {
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    world.view = () => ({ ...view(), platformLift: undefined });
  });
  const hidden = await pixels(page);
  expect(changed(riding, hidden)).toBeGreaterThan(30);
  await page.evaluate(() => { delete (window.openSinnohApp!.game.world as { view?: unknown }).view; });
  await waitForScene(page);
  await driver.screenshot!('league-lift-riding');
  await page.evaluate(() => window.openSinnohGame!.advance(100));
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().platformLift?.position[1])).toBe(160);
  expect(errors).toEqual([]);
});
