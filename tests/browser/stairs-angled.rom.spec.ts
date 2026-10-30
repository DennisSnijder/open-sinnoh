/**
 * Characters on stairs under the angled camera (OPENSINNOH_NDS_ROM; desktop). The angled camera looks down less
 * steeply than a stair rises, so the steps of a stair that runs down to the north (toward the back of the view) lay
 * in front of a character on it: drawn by plain depth, they hid its legs (Jubilife City's plaza stair, the stone stair
 * model beside Pastoria City's east gate) or most of it (Valor Lakefront's stair below the plaza). The billboard's depth anchor moves past the stair
 * (billboard.ts slopeDepthLift), so the sprite shows whole, as under the DS camera; stairs that run up to the north
 * and flat ground stay as they were.
 *
 * Each pose draws the player alone, then with the map hidden (`spritesOnly`), then with the player hidden: the
 * player's pixels are those the last two frames differ in, and a pixel is visible when the full frame shows the
 * sprite's colour there.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Facing, GameState } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { romContext, resetRomDevice } from './rom-context.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough for depth');
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(180_000);
  context = await romContext(browser, info.project.use);
  page = await context.newPage();
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});
test.afterAll(async () => {
  await context?.close();
});

type Stats = { frames: number; enhancedFrame: { angled: boolean } | null };
const stats = () => page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats);

async function arrive(zone: string, x: number, z: number, facing: Facing, bike: boolean): Promise<void> {
  const state: GameState = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  state.player = { zone: `platinum:MAP_HEADER_${zone}` as never, x, z, y: 0, facing };
  state.objects = [];
  state.follower = null;
  state.playerState = bike ? 'cycle' : 'walk';
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }));
  await page.evaluate(() => window.openSinnohGame!.setClock(undefined, '12:00'));
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  await waitForScene(page);
}

/** The angled camera (no post effects, so the sprite's colours are exact) or the DS camera; waits out the follow lag. */
async function camera(angled: boolean): Promise<void> {
  await page.evaluate((c) => (window as unknown as { openSinnohEnhanced: (c: string | null) => void }).openSinnohEnhanced(c), angled ? 'camera' : null);
  if (angled) await expect.poll(async () => (await stats()).enhancedFrame?.angled ?? null, { timeout: 20_000 }).toBe(true);
  else await expect.poll(async () => (await stats()).enhancedFrame).toBeNull();
  await page.evaluate(() => window.openSinnohGame!.advance(10));
  await waitForScene(page);
}

/** The player's sprite pixels and how many of them the field shows. */
const playerPixels = () =>
  page.evaluate(async () => {
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    const hero = () => ({ ...view(), actors: view().actors.filter((a) => a.localId === 255), previews: [], departed: undefined });
    const debug = (globalThis as unknown as { openSinnohRenderDebug: { edges: boolean; spritesOnly: boolean } }).openSinnohRenderDebug;
    const capture = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    world.view = hero;
    debug.edges = false;
    try {
      const scene = await capture();
      debug.spritesOnly = true;
      const sprite = await capture();
      world.view = () => ({ ...hero(), actors: hero().actors.map((a) => ({ ...a, visible: false })) });
      const empty = await capture();
      let full = 0;
      let visible = 0;
      for (let i = 0; i < scene.length; i += 4) {
        if (sprite[i] === empty[i] && sprite[i + 1] === empty[i + 1] && sprite[i + 2] === empty[i + 2]) continue;
        full++;
        if (scene[i] === sprite[i] && scene[i + 1] === sprite[i + 1] && scene[i + 2] === sprite[i + 2]) visible++;
      }
      return { full, visible };
    } finally {
      world.view = view;
      debug.edges = true;
      debug.spritesOnly = false;
    }
  });

for (const pose of [
  // The east gate's stone stair model beside its west wall, on flat terrain; on the bike, as reported. The stair's
  // rail covers the back wheel's edge under both cameras (the DS camera shows 89 % of the sprite; unfixed, the angled
  // camera showed 88 %, the wheels and legs cut by the steps; now 96 %).
  { name: 'Pastoria City gate stair, on the bike', zone: 'PASTORIA_CITY', x: 639, z: 811, facing: 'left' as const, bike: true, ds: 0.85, angled: 0.94 },
  { name: 'Valor Lakefront stair down to the north, below the plaza', zone: 'VALOR_LAKEFRONT', x: 723, z: 777 },
  { name: 'Jubilife City plaza stair, top step', zone: 'JUBILIFE_CITY', x: 174, z: 738 },
  { name: 'Sunyshore City stair up to the north', zone: 'SUNYSHORE_CITY', x: 870, z: 761 },
  { name: 'flat ground (Valor Lakefront plaza)', zone: 'VALOR_LAKEFRONT', x: 712, z: 790 },
]) {
  test(pose.name, async () => {
    test.setTimeout(120_000);
    await arrive(pose.zone, pose.x, pose.z, pose.facing ?? 'down', pose.bike ?? false);
    const shown: Record<string, number> = {};
    for (const angled of [false, true]) {
      await camera(angled);
      const px = await playerPixels();
      console.log(`${pose.zone} ${pose.x},${pose.z} ${angled ? 'angled' : 'DS'}: ${px.visible}/${px.full}`);
      expect(px.full, 'the player is on screen').toBeGreaterThan(300);
      shown[angled ? 'angled' : 'ds'] = px.visible / px.full;
    }
    await camera(false);
    expect(shown.ds, 'the DS camera shows the sprite').toBeGreaterThan(pose.ds ?? 0.97);
    expect(shown.angled, 'the angled camera shows the sprite').toBeGreaterThan(pose.angled ?? 0.97);
  });
}
