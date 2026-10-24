/**
 * The town extras' field commands in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): a Solaceon Ruins
 * inscription in the Unown font, the Vista Lighthouse binoculars' view of the Pokémon League, and the Vs. Seeker's
 * raised avatar and the rematch trainer's '!!'. Each is set up by replay lines and checked on the canvases.
 * Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameSnapshot, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/town-field';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, ...(use.isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: use.deviceScaleFactor } : {}) });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

test('import the ROM', async () => {
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

const snapshot = () => page.evaluate(() => window.openSinnohGame!.snapshot()) as Promise<GameSnapshot>;
const advance = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);
/** Advances until `ok` holds on a snapshot (replay mode ticks only through the bridge). */
const until = (ok: (s: GameSnapshot) => boolean, what: string) =>
  expect.poll(async () => (ok(await snapshot()) ? true : (await advance(2), ok(await snapshot()))), { timeout: 30_000, intervals: [20], message: what }).toBe(true);
const replay = async (name: string, text: string) => {
  const result = await runReplay(pageDriver(page, SHOTS, `${test.info().project.name}-${name}`), text, { registries, seed: 1, name: `${name}.replay`, repeat: false });
  expect(result.error).toBeUndefined();
};
const frames = () => page.evaluate(async () => {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
});
const press = async (button: 'a' | 'b') => {
  await page.evaluate((b) => window.openSinnohGame!.press(b), button);
  await advance(1);
  await page.evaluate((b) => window.openSinnohGame!.release(b), button);
  await advance(1);
};
/** Distinct colours and lit share of the field canvas, read in the frame it is drawn (its buffer is not preserved). */
const fieldStats = () => page.evaluate(async () => {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const src = document.getElementById('main-canvas') as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const colours = new Set<number>();
  let lit = 0;
  for (let i = 0; i < px.length; i += 4) {
    colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    if (px[i]! + px[i + 1]! + px[i + 2]! > 60) lit++;
  }
  return { colours: colours.size, lit: lit / (px.length / 4) };
});
/** The field scene has loaded its map (the canvas shows it). */
const loaded = () => expect.poll(() => page.evaluate(() => window.openSinnohApp!.sceneLoading()), { timeout: 30_000 }).toBe(false);

test('a Solaceon Ruins inscription is drawn in the Unown font', async () => {
  test.setTimeout(180_000);
  await replay('unown', 'warp platinum:MAP_HEADER_SOLACEON_RUINS_ROOM_1 5 2 up\nuntil idle\n+0 press a\n+1 release a\nuntil message\n');
  await until((s) => s.view.message?.waitingForInput === true, 'the inscription printed');
  const s = await snapshot();
  expect(s.view.message?.font).toBe('unown');
  await loaded();
  await frames();
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-unown.png` });
  expect((await canvasStats(page, '#overlay-canvas')).colours).toBeGreaterThan(3);
  await page.evaluate(() => window.openSinnohGame!.advanceText(600));
  await until((s) => !s.scriptRunning && s.view.message === null, 'the inscription closed');
  expect(errors).toEqual([]);
});

test('the Vista Lighthouse binoculars show the League, then the lighthouse again', async () => {
  test.setTimeout(180_000);
  await replay('binoculars', 'warp platinum:MAP_HEADER_VISTA_LIGHTHOUSE 6 4 up\nuntil idle\n+0 press a\n+1 release a\nuntil message\n');
  await until((s) => s.view.message?.waitingForInput === true, 'the binoculars message');
  await press('a');
  await until((s) => s.state.player.zone === 'platinum:MAP_HEADER_POKEMON_LEAGUE' && s.fade === null, 'the League view');
  await advance(12);
  await loaded();
  await frames();
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-binoculars.png` });
  const field = await fieldStats();
  expect(field.colours).toBeGreaterThan(200);
  expect(field.lit).toBeGreaterThan(0.3);
  await press('a');
  await until((s) => !s.scriptRunning && s.state.player.zone === 'platinum:MAP_HEADER_VISTA_LIGHTHOUSE' && s.fade === null, 'back in the lighthouse');
  expect((await snapshot()).state.player).toMatchObject({ x: 6, z: 4, facing: 'up' });
  expect(errors).toEqual([]);
});

test('the Vs. Seeker: the raised avatar, then the rematch trainer turns south with "!!" and spins', async () => {
  test.setTimeout(180_000);
  await replay('vs-seeker', `party 0 platinum:SPECIES_CHARIZARD 80 platinum:MOVE_FLAMETHROWER
give item platinum:ITEM_VS_SEEKER 1
set state registeredItem "platinum:ITEM_VS_SEEKER"
set state fieldRng {"seed":0}
set var platinum:VAR_VS_SEEKER_BATTERY_LEVEL 100
set flag platinum:FLAG_DEFEATED_TRAINER_YOUNGSTER_TRISTAN true
set flag platinum:FLAG_UNLOCKED_VS_SEEKER_LVL_1 true
warp platinum:MAP_HEADER_ROUTE_202 166 814 up
until idle
+0 press y
+1 release y
`);
  const seeker = (registries.newGame.values().next().value!).playerVsSeekerSprite!.male;
  let raised = false;
  let double = false;
  for (let i = 0; i < 120 && !(raised && double); i++) {
    await advance(1);
    const actors = await page.evaluate(() => window.openSinnohApp!.game.world.view().actors.map((a) => ({ id: a.localId, sprite: a.sprite, pose: a.pose, double: a.emoteDouble === true })));
    if (!raised && actors[0]!.sprite === seeker && actors[0]!.pose === 'vs-seeker') {
      raised = true;
      await frames();
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-vs-seeker-raised.png` });
    }
    if (!double && actors.some((a) => a.id === 0 && a.double)) {
      double = true;
      await frames();
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-vs-seeker-rematch.png` });
    }
  }
  expect(raised).toBe(true);
  expect(double).toBe(true);
  await until((s) => !s.scriptRunning, 'the Vs. Seeker done');
  expect((await snapshot()).state.objects.find((o) => o.localId === 0)!.movementType).toBe(49);
  expect(errors).toEqual([]);
});
