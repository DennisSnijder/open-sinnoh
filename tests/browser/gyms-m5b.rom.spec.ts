/**
 * Gym field systems in the app (OPENSINNOH_NDS_ROM; desktop and phone): one pixel-checked beat each. The spot is
 * reached headless (the cached slice import) by a short replay and saved; the page loads that save and plays
 * the beat's lines through `window.openSinnohGame`. Screenshots go to test-artifacts (ROM content, never commit).
 *
 * - Pastoria Gym: the water prop the feature places is drawn (the frame differs from one without the
 *   feature's models), and a press on the orange button lowers it (the frame after differs from before).
 * - Canalave Gym: the platforms are drawn on the ground floor, and a lift ride up shows the second floor.
 * - Snowpoint Gym: the snowballs are drawn (the fldeff model), and a fast slide breaks one: the break effect
 *   plays and the ball is gone.
 * - The boat: the ship is drawn at the dock, sails off (the frame changes as it and the camera move), the
 *   bridges play their clip, and the trip ends on Iron Island.
 * - Pastoria's explosion: the camera shakes (the view's camera offset swings ±4 and the frame moves with it).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CountingStubLog, createGame, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { freshRomPage } from './rom-context.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = join(import.meta.dirname, '../../test-artifacts/gyms-m5b');

test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let page: Page;
test.beforeEach(async ({ browser }, info) => {
  test.setTimeout(600_000);
  page = await freshRomPage(browser, info.project.use);
});
test.afterEach(async () => { await page?.close(); });


const newGame = () => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2026-01-01T00:00:00.000Z' });

/** Plays `text` headless on seed 1 and returns the save at its end. */
async function saveAfter(text: string): Promise<string> {
  const game = newGame();
  const dir = join(import.meta.dirname, '../rom-replays');
  const result = await runReplay(gameDriver(game), text, { registries: game.registries, seed: 1, name: 'spot', repeat: false, resolve: (file) => ({ name: file, text: readFileSync(join(dir, file), 'utf8') }) });
  if (!result.ok) throw new Error(`spot: ${result.error}`);
  for (let i = 0; i < 600 && !game.canSave(); i++) game.tick();
  return saveToJson(game.save());
}

/** Luminance samples of the main canvas (128×72) after a drawn frame. */
async function frame(page: Page): Promise<number[]> {
  await waitForScene(page);
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = 128;
          copy.height = 72;
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0, 128, 72);
          const px = g.getImageData(0, 0, 128, 72).data;
          const out: number[] = [];
          for (let i = 0; i < px.length; i += 4) out.push(Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!));
          resolve(out);
        });
      }),
  );
}

/** The frame with the feature's models left out of the view (the world itself is untouched). */
async function frameWithoutFeatureModels(page: Page): Promise<number[]> {
  await page.evaluate(() => {
    const world = window.openSinnohApp!.game.world as unknown as { view(): { features?: { models: unknown[] } } };
    const view = world.view.bind(world);
    (world as { view: unknown }).view = () => {
      const v = view();
      return v.features ? { ...v, features: { ...v.features, models: [] } } : v;
    };
  });
  const f = await frame(page);
  await page.evaluate(() => void delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view);
  return f;
}

const meanDiff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;

async function open(page: Page, save: string, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate((json) => window.openSinnohGame!.load(json), save);
  await page.evaluate(() => window.openSinnohGame!.advance(40));
}

test('Pastoria Gym: the water is drawn, and the orange button lowers it', async ({ browserName: _ }, info) => {
  test.setTimeout(600_000);
  const save = await saveAfter(
    [
      'warp platinum:MAP_HEADER_PASTORIA_CITY_GYM 13 41 up',
      'until idle',
      ...walk([
        ['up', 13, 26],
        ['left', 3, 26],
        ['down', 3, 33],
      ]),
    ].join('\n'),
  );
  const errors: string[] = [];
  await open(page, save, errors);
  const driver = pageDriver(page, SHOTS, info.project.name);
  const noise = meanDiff(await frame(page), await frame(page));
  const before = await frame(page);
  const without = await frameWithoutFeatureModels(page);
  await driver.screenshot!('pastoria-middle');
  const drawn = meanDiff(before, without);
  expect(drawn, `the water prop: mean difference ${drawn.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 1);
  const result = await runReplay({ ...driver, reset: () => driver.load(save) }, walk([['down', 3, 34]]).join('\n'), { registries: newGame().registries, seed: 1, name: 'pastoria-press', repeat: false });
  expect(result.error).toBeUndefined();
  const water = await page.evaluate(() => window.openSinnohApp!.game.world.view().features!.models.find((m) => m.key === 'pastoria-water')!.position[1]);
  expect(water).toBe(0);
  // The runner's closing save round trip loaded the game again: let its fade-in end.
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.fadeState())).toBeNull();
  const after = await frame(page);
  await driver.screenshot!('pastoria-low');
  const lowered = meanDiff(before, after);
  expect(lowered, `after the press: mean difference ${lowered.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 1);
  expect(errors).toEqual([]);
});

test('Canalave Gym: the platforms are drawn, and a lift carries the player to the second floor', async ({ browserName: _ }, info) => {
  test.setTimeout(600_000);
  // sys-gym-canalave.replay up to the tile before the lift at 24,13 (Ricky battled on the way).
  const lines = readFileSync(join(import.meta.dirname, '../rom-replays/sys-gym-canalave.replay'), 'utf8').split('\n');
  const at = lines.indexOf('until position 20 13');
  const save = await saveAfter(lines.slice(0, at + 3).join('\n'));
  const errors: string[] = [];
  await open(page, save, errors);
  const driver = pageDriver(page, SHOTS, info.project.name);
  const noise = meanDiff(await frame(page), await frame(page));
  const before = await frame(page);
  const without = await frameWithoutFeatureModels(page);
  await driver.screenshot!('canalave-ground');
  const drawn = meanDiff(before, without);
  expect(drawn, `the platforms: mean difference ${drawn.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 1);
  const result = await runReplay({ ...driver, reset: () => driver.load(save) }, walk([['right', 24, 13]]).join('\n'), { registries: newGame().registries, seed: 1, name: 'canalave-ride', repeat: false });
  expect(result.error).toBeUndefined();
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  const view = await page.evaluate(() => ({ y: window.openSinnohGame!.snapshot().state.player.y, keys: window.openSinnohApp!.game.world.view().features!.models.map((m) => m.key) }));
  expect(view.y).toBe(160);
  expect(view.keys).toContain('canalave-floor-2');
  const after = await frame(page);
  await driver.screenshot!('canalave-second-floor');
  const rode = meanDiff(before, after);
  expect(rode, `after the ride: mean difference ${rode.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 1);
  expect(errors).toEqual([]);
});

test('Snowpoint Gym: the snowballs are drawn, and a fast slide breaks one', async ({ browserName: _ }, info) => {
  test.setTimeout(600_000);
  // sys-gym-snowpoint.replay up to the slide that breaks the first ball (from 5,11 east).
  const lines = readFileSync(join(import.meta.dirname, '../rom-replays/sys-gym-snowpoint.replay'), 'utf8').split('\n');
  const at = lines.indexOf('+0 screenshot snowpoint-balls-18');
  const save = await saveAfter(lines.slice(0, at - 4).join('\n'));
  const errors: string[] = [];
  await open(page, save, errors);
  const driver = pageDriver(page, SHOTS, info.project.name);
  const balls = () => page.evaluate(() => window.openSinnohApp!.game.world.view().actors.filter((a) => window.openSinnohApp!.game.registries.sprites.get(a.sprite!)?.sourceIndex === 0x76).length);
  expect(await balls()).toBe(19);
  const noise = meanDiff(await frame(page), await frame(page));
  const before = await frame(page);
  await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    const world = game.world as unknown as { view(): { actors: { sprite?: string }[] } };
    const view = world.view.bind(world);
    (world as { view: unknown }).view = () => {
      const v = view();
      return { ...v, actors: v.actors.filter((a) => game.registries.sprites.get(a.sprite as never)?.sourceIndex !== 0x76) };
    };
  });
  const without = await frame(page);
  await page.evaluate(() => void delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view);
  await driver.screenshot!('snowpoint-balls');
  const drawn = meanDiff(before, without);
  expect(drawn, `the snowballs: mean difference ${drawn.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 0.5);
  // The slide east: watch for the break effect while it runs.
  await page.evaluate(() => window.openSinnohGame!.press('right'));
  let broke = false;
  for (let i = 0; i < 120 && !broke; i++) {
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    if (i === 6) await page.evaluate(() => window.openSinnohGame!.release('right'));
    broke = await page.evaluate(() => window.openSinnohApp!.game.world.view().effects.some((e) => /SNOWBALL_BREAK/.test(e.effect)));
  }
  expect(broke, 'the break effect played').toBe(true);
  await driver.screenshot!('snowpoint-break');
  await page.evaluate(() => window.openSinnohGame!.advance(90));
  expect(await balls()).toBe(18);
  expect(errors).toEqual([]);
});

test('the boat: the ship sails from Canalave, the bridges open, and the trip ends on Iron Island', async ({ browserName: _ }, info) => {
  test.setTimeout(600_000);
  const save = await saveAfter(['warp platinum:MAP_HEADER_CANALAVE_CITY 44 750 right', 'until idle'].join('\n'));
  const errors: string[] = [];
  await open(page, save, errors);
  const driver = pageDriver(page, SHOTS, info.project.name);
  const noise = meanDiff(await frame(page), await frame(page));
  const before = await frame(page);
  const without = await frameWithoutWorldProps(page);
  await driver.screenshot!('boat-dock');
  const drawn = meanDiff(before, without);
  expect(drawn, `the ship and bridges: mean difference ${drawn.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 1);
  const choose = ['until idle', '+0 press a', '+1 release a', 'until menu 600', '+4 press a', '+1 release a', 'advance text 150'].join('\n');
  // advance text stops at the trip's first idle-less tick budget; the departure is then under way.
  await runReplay({ ...driver, reset: () => driver.load(save) }, choose, { registries: newGame().registries, seed: 1, name: 'boat-board', repeat: false }).catch(() => undefined);
  let sailing: { ship: number[]; clip: boolean } | null = null;
  for (let i = 0; i < 600; i++) {
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    const props = await page.evaluate(() => window.openSinnohApp!.game.world.view().props ?? []);
    const clip = props.some((p) => p.clip && p.clip.tick > 10);
    if (clip) {
      sailing = { ship: props.find((p) => !p.clip)!.position, clip };
      break;
    }
  }
  expect(sailing, 'the bridges play their clip while the ship sails').not.toBeNull();
  const mid = await frame(page);
  await driver.screenshot!('boat-departing');
  const moved = meanDiff(before, mid);
  expect(moved, `departing: mean difference ${moved.toFixed(2)} (noise ${noise.toFixed(2)})`).toBeGreaterThan(noise + 1);
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.zone)) === 'platinum:MAP_HEADER_IRON_ISLAND') break;
    await page.evaluate(() => window.openSinnohGame!.advance(30));
  }
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player)).toMatchObject({ zone: 'platinum:MAP_HEADER_IRON_ISLAND', x: 100, z: 502, facing: 'right' });
  await driver.screenshot!('boat-iron-island');
  expect(errors).toEqual([]);
});

test('Pastoria explosion: the camera shakes', async ({ browserName: _ }, info) => {
  test.setTimeout(900_000);
  // sys-explosion.replay up to the tile before the bomb's coord event.
  const lines = readFileSync(join(import.meta.dirname, '../rom-replays/sys-explosion.replay'), 'utf8').split('\n');
  const at = lines.indexOf('until position 610 816');
  const save = await saveAfter(lines.slice(0, at + 3).join('\n'));
  const errors: string[] = [];
  await open(page, save, errors);
  const driver = pageDriver(page, SHOTS, info.project.name);
  const still = await frame(page);
  // Up to the coord event 6 tiles north (sys-explosion's own lines), then the scene.
  await page.evaluate(() => window.openSinnohGame!.press('up'));
  for (let i = 0; i < 200 && (await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.z)) !== 810; i++) await page.evaluate(() => window.openSinnohGame!.advance(1));
  await page.evaluate(() => window.openSinnohGame!.release('up'));
  const offsets: number[] = [];
  let shaken: number[] | null = null;
  for (let i = 0; i < 3000 && offsets.length < 40; i++) {
    const s = await page.evaluate(() => {
      const g = window.openSinnohGame!;
      const v = window.openSinnohApp!.game.world.view();
      if (g.snapshot().view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      } else g.advance(1);
      return v.cameraOffset[0];
    });
    if (s !== 0) {
      offsets.push(s);
      if (!shaken && Math.abs(s) >= 3) shaken = await frame(page);
    }
  }
  expect(Math.max(...offsets), `camera offsets ${offsets.slice(0, 12).join(', ')}`).toBeGreaterThanOrEqual(3);
  expect(Math.min(...offsets)).toBeLessThanOrEqual(-3);
  await driver.screenshot!('explosion');
  expect(shaken).not.toBeNull();
  expect(meanDiff(still, shaken!)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/** The frame with the world's own props (`FieldView.props`) left out. */
async function frameWithoutWorldProps(page: Page): Promise<number[]> {
  await page.evaluate(() => {
    const world = window.openSinnohApp!.game.world as unknown as { view(): { props?: unknown[] } };
    const view = world.view.bind(world);
    (world as { view: unknown }).view = () => ({ ...view(), props: undefined });
  });
  const f = await frame(page);
  await page.evaluate(() => void delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view);
  return f;
}

/** Replay lines for straight walks: hold the direction until the tile, release, wait for the idle field. */
function walk(legs: [string, number, number][]): string[] {
  return legs.flatMap(([dir, x, z]) => [`+0 press ${dir}`, `until position ${x} ${z}`, `+0 release ${dir}`, 'until idle']);
}
