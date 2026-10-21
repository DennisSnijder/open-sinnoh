/** Rendered System beats only, on desktop and phone. ROM pixels stay in ignored test-artifacts. */
import { expect, test, type Page } from '@playwright/test';
import { createGame, CountingStubLog, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { romSlice } from '../rom.ts';
import { freshRomPage } from './rom-context.ts';
import { waitForScene, mainCanvasStats } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

let page: Page;
test.beforeEach(async ({ browser }, info) => {
  test.setTimeout(600_000);
  page = await freshRomPage(browser, info.project.use);
});
test.afterEach(async () => { await page?.close(); });

async function open(page: Page, text: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const game = createGame({
    packs: [romSlice().pack],
    createWorld,
    createScriptRunner,
    createBattle,
    log: new CountingStubLog(() => {}),
    seed: 1,
  });
  const result = await runReplay(gameDriver(game), text, { registries: game.registries, repeat: false });
  expect(result.error).toBeUndefined();
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  expect(game.canSave()).toBe(true);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await page.evaluate((json) => window.openSinnohGame!.load(json), saveToJson(game.save()));
  await waitForScene(page);
  return errors;
}
async function pixels(page: Page) {
  await waitForScene(page);
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) =>
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement,
            copy = document.createElement('canvas');
          copy.width = 128;
          copy.height = 96;
          const c = copy.getContext('2d')!;
          c.drawImage(src, 0, 0, 128, 96);
          const rgba = c.getImageData(0, 0, 128, 96).data;
          resolve(Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4]! + rgba[i * 4 + 1]! + rgba[i * 4 + 2]!));
        }),
      ),
  );
}
const diff = (a: number[], b: number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0) / a.length;

test('Sunyshore gears draw and rotate around both authored axes', async ({ browserName: _ }, info) => {
  test.setTimeout(600000);
  const errors = await open(page, 'warp platinum:MAP_HEADER_SUNYSHORE_CITY_GYM_ROOM_3 11 25 up\nuntil idle');
  const before = await pixels(page);
  await page.evaluate(() => {
    window.openSinnohApp!.game.world.pressSunyshoreGymButton(0);
    window.openSinnohGame!.advance(8);
  });
  expect(diff(before, await pixels(page))).toBeGreaterThan(0.5);
  await page.screenshot({ path: `test-artifacts/m5c-${info.project.name}-gears.png` });
  await page.evaluate(() => window.openSinnohGame!.advance(20));
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.sunyshoreGymButtonDone())).toBe(true);
  expect(errors).toEqual([]);
});
test('HQ panels raise the drawn avatar, fade, and land south with no residual offset', async ({ browserName: _ }, info) => {
  test.setTimeout(600000);
  const errors = await open(page, 'warp platinum:MAP_HEADER_GALACTIC_HQ_3F 15 14 up\nuntil idle');
  await page.evaluate(() => {
    window.openSinnohGame!.press('up');
    window.openSinnohGame!.advance(12);
    window.openSinnohGame!.release('up');
  });
  const pair = await page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    return { y: g.state.player.y, draw: g.world.view().actors.find((a) => a.localId === 255)!.cur[1] };
  });
  expect(pair.draw).toBeGreaterThan(pair.y);
  await page.screenshot({ path: `test-artifacts/m5c-${info.project.name}-panel.png` });
  await page.evaluate(() => window.openSinnohGame!.advance(100));
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player)).toMatchObject({ x: 6, z: 14, facing: 'down' });
  expect(errors).toEqual([]);
});
test('containment channels draw the opening and terminal pose', async ({ browserName: _ }, info) => {
  test.setTimeout(600000);
  const errors = await open(page, 'warp platinum:MAP_HEADER_GALACTIC_HQ_CONTROL_ROOM 8 7 up\nuntil idle');
  const before = await pixels(page);
  await page.evaluate(() => {
    window.openSinnohApp!.game.world.deactivateContainmentUnits();
    window.openSinnohGame!.advance(70);
  });
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.containmentUnitsDone())).toBe(true);
  expect(diff(before, await pixels(page))).toBeGreaterThan(0.05);
  await page.screenshot({ path: `test-artifacts/m5c-${info.project.name}-containment.png` });
  expect(errors).toEqual([]);
});
test('Spear Pillar renders each application phase then returns to the field', async ({ browserName: _ }, info) => {
  test.setTimeout(600000);
  const errors = await open(page, 'set var platinum:VAR_SPEAR_PILLAR_STATE 2\nwarp platinum:MAP_HEADER_SPEAR_PILLAR 31 35 up\nuntil idle');
  await page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    g.scripts.start({ label: 'platinum:SpearPillar_Cyrus', zone: g.state.player.zone, source: 'test' });
  });
  for (const phase of ['summoning', 'guardians', 'giratina']) {
    const hit = await page.evaluate((target) => {
      const g = window.openSinnohApp!.game;
      for (let i = 0; i < 10000; i++) {
        const scene = g.world.view().storyScene;
        const ready = target === 'summoning'
          ? scene?.actors.some(a => a.asset === '79' && a.tick >= 180)
          : target === 'guardians'
            ? scene?.actors.some(a => a.asset === '59' && a.tick >= 125)
            : scene?.actors.some(a => a.asset === '38' && a.tick >= 80);
        if (scene?.phase === target && ready) {
          g.advance(40);
          return true;
        }
        if (g.scripts.view().message?.waitingForInput) g.press('a');
        g.tick();
        g.release('a');
      }
      return false;
    }, phase);
    expect(hit, phase).toBe(true);
    await waitForScene(page);
    expect((await mainCanvasStats(page)).colours).toBeGreaterThan(12);
    await page.screenshot({ path: `test-artifacts/m5c-${info.project.name}-${phase}.png` });
  }
  await page.evaluate(() => window.openSinnohGame!.advanceText(15000));
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.vars['platinum:VAR_SPEAR_PILLAR_STATE'])).toBe(3);
  expect(errors).toEqual([]);
});
