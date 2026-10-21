import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Facing } from '@opensinnoh/contracts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  const use = info.project.use;
  context = await romContext(browser, use);
});
test.beforeEach(async () => {
  page = await context.newPage();
  await resetRomDevice(page);
});
test.afterEach(async () => { await page?.close(); });

async function openPose(page: Page, pose: {
  map: string;
  x: number;
  z: number;
  facing?: Facing;
}): Promise<void> {
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60000 });
  await page.evaluate(async ({ map, x, z, facing }) => {
    const { state } = window.openSinnohGame!.snapshot();
    state.player = { zone: `platinum:MAP_HEADER_${map}` as never, x, z, y: 0, facing: facing ?? 'down' };
    state.objects = [];
    state.follower = null;
    state.vars['platinum:VAR_ETERNA_CITY_STATE' as never] = 2;
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }), 'arrival');
    window.openSinnohGame!.advance(40);
  }, pose);
  await waitForScene(page);
}
for (const pose of [
  { name: 'Pokémon Center escalator top', map: 'ETERNA_CITY_POKECENTER_1F', x: 1, z: 10, facing: 'left' as const, foreground: true },
  { name: 'Galactic bottom wall', map: 'TEAM_GALACTIC_ETERNA_BUILDING_2F', x: 6, z: 12, facing: 'left' as const },
  { name: 'Eterna bike rack', map: 'ETERNA_CITY', x: 315, z: 539 },
  { name: 'Eterna house roof', map: 'ETERNA_CITY', x: 301, z: 562, roof: true },
  { name: 'Eterna tree canopy', map: 'ETERNA_CITY', x: 324, z: 533, tree: true },
  { name: 'Galactic stair landing', map: 'TEAM_GALACTIC_ETERNA_BUILDING_2F', x: 20, z: 3 },
  { name: 'Route 211 lower stairs', map: 'ROUTE_211_WEST', x: 374, z: 524 },
  { name: 'Route 211 upper stairs', map: 'ROUTE_211_WEST', x: 378, z: 524 },
]) {
  test(pose.name, async () => {
    test.setTimeout(120000);
    await openPose(page, pose);
    const pixels = await page.evaluate(async () => {
      const world = window.openSinnohApp!.game.world;
      const view = world.view.bind(world);
      const heroView = () => ({ ...view(), actors: view().actors.slice(0, 1), previews: [], departed: undefined });
      world.view = heroView;
      const { Ceilings } = await new Function('return import("/__test/ceilings.js")')();
      const above = Ceilings.prototype.above;
      const debug = (globalThis as unknown as {
        openSinnohRenderDebug: {
          edges: boolean;
          spritesOnly: boolean;
        };
      }).openSinnohRenderDebug;
      debug.edges = false;
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
      try {
        const scene = await capture();
        Ceilings.prototype.above = () => null;
        const uncapped = await capture();
        Ceilings.prototype.above = above;
        world.view = () => ({ ...heroView(), actors: heroView().actors.map(a => ({ ...a, visible: false })) });
        const background = await capture();
        world.view = heroView;
        debug.spritesOnly = true;
        const sprite = await capture();
        const hat = (p: Uint8ClampedArray, i: number) => p[i]! > 130 && p[i + 1]! < p[i]! * .7 && p[i + 2]! < p[i]! * 1.3;
        let visible = 0, full = 0, leaves = 0, leaks = 0, oldLeaks = 0, uncappedVisible = 0, roofLeaks = 0, oldRoofLeaks = 0, roofPixels = 0;
        for (let i = 0; i < scene.length; i += 4) {
          if (hat(sprite, i)) {
            full++;
            if (scene[i] === sprite[i] && scene[i + 1] === sprite[i + 1] && scene[i + 2] === sprite[i + 2])
              visible++;
            if (uncapped[i] === sprite[i] && uncapped[i + 1] === sprite[i + 1] && uncapped[i + 2] === sprite[i + 2]) uncappedVisible++;
          }
          // Green roof texels; exclude the warm (red over green) dirt beneath the rest of the hat.
          const roof = background[i + 1]! >= background[i]!;
          if (roof && hat(sprite, i)) {
            roofPixels++;
            if (hat(scene, i)) roofLeaks++;
            if (hat(uncapped, i)) oldRoofLeaks++;
          }
          // Green canopy texels; the much brighter grass is excluded.
          const tree = background[i + 1]! > background[i]! * 1.15 && background[i + 1]! > background[i + 2]! * 1.5 && background[i + 1]! < 220 && background[i]! > background[i + 1]! * .5;
          if (tree && hat(sprite, i)) {
            leaves++;
            if (hat(scene, i))
              leaks++;
            if (hat(uncapped, i))
              oldLeaks++;
          }
        }
        return { visible, full, leaves, leaks, oldLeaks, uncappedVisible, roofLeaks, oldRoofLeaks, roofPixels };
      }
      finally {
        Ceilings.prototype.above = above;
        world.view = view;
        debug.edges = true;
        debug.spritesOnly = false;
      }
    });
    if ('roof' in pose) {
      expect(pixels.roofPixels).toBeGreaterThan(0);
      // The leaning billboard depth (billboard.ts) alone keeps this hat under the roof; the ceiling cap keeps it there too.
      expect(pixels.oldRoofLeaks).toBe(0);
      expect(pixels.roofLeaks).toBe(0);
      expect(pixels.visible).toBe(pixels.full - pixels.roofPixels);
    } else if ('foreground' in pose) {
      // Preserve normal foreground edges, but never lose extra hat pixels to a nearby ceiling.
      expect(pixels.visible).toBe(pixels.uncappedVisible);
      expect(pixels.visible).toBeGreaterThan(pixels.full * .95);
    } else if (pose.tree) {
      expect(pixels.leaves, 'the pose overlaps the canopy').toBeGreaterThan(0);
      expect(pixels.oldLeaks, 'the original uncapped sprite reproduces the tree overlap').toBeGreaterThan(0);
      expect(pixels.leaks, 'the hat stays behind the leaves').toBe(0);
    }
    else {
      expect(pixels.full).toBeGreaterThan(0);
      expect(pixels.visible, 'nearby walls and raised stairs must not cut off the hat').toBe(pixels.full);
    }
  });
}

test('Galactic building keeps a light blue haze without obscuring the room', async () => {
  test.setTimeout(120000);
  await openPose(page, { map: 'TEAM_GALACTIC_ETERNA_BUILDING_4F', x: 11, z: 9 });
  const pixels = await page.evaluate(async () => {
    const game = window.openSinnohApp!.game;
    const weather = game.registries.weathers.get(game.world.view().weather)!;
    const source = weather.sourceIndex;
    const fog = weather.fog;
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
    try {
      const light = await capture();
      weather.sourceIndex = 27; // Keep the same fog parameters but bypass the Galactic strength adjustment.
      const dense = await capture();
      weather.fog = undefined;
      const clear = await capture();
      let lighter = 0, haze = 0;
      for (let i = 0; i < light.length; i += 4) {
        if (light[i]! + light[i + 1]! + light[i + 2]! > dense[i]! + dense[i + 1]! + dense[i + 2]! + 30)
          lighter++;
        if (Math.abs(light[i]! - clear[i]!) + Math.abs(light[i + 1]! - clear[i + 1]!) + Math.abs(light[i + 2]! - clear[i + 2]!) > 15)
          haze++;
      }
      return { lighter, haze, total: light.length / 4 };
    }
    finally {
      weather.sourceIndex = source;
      weather.fog = fog;
    }
  });
  expect(pixels.lighter, 'floor details are brighter than under the original dense effect').toBeGreaterThan(pixels.total * 0.05);
  expect(pixels.haze, 'the blue atmosphere is retained').toBeGreaterThan(pixels.total * 0.05);
});

// Pastoria City's face-in-hole board (land 81: one quad leaning back from the tile south over the anchor). On the DS
// the quad's depth hides a character standing behind it, all but the face in the hole: the hat stays under the board.
test('Pastoria face-in-hole board covers all but the face of the player behind it', async () => {
  test.setTimeout(120000);
  await openPose(page, { map: 'PASTORIA_CITY', x: 608, z: 814, facing: 'down' });
  const pixels = await page.evaluate(async () => {
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    const hero = () => ({ ...view(), actors: view().actors.slice(0, 1), previews: [], departed: undefined });
    const debug = (globalThis as unknown as { openSinnohRenderDebug: { edges: boolean; spritesOnly: boolean } }).openSinnohRenderDebug;
    debug.edges = false;
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
    try {
      world.view = hero;
      const scene = await capture();
      debug.spritesOnly = true;
      const sprite = await capture();
      const hat = (p: Uint8ClampedArray, i: number) => p[i]! > 130 && p[i + 1]! < p[i]! * .7 && p[i + 2]! < p[i]! * 1.3;
      // Skin: light and warm, not red.
      const skin = (p: Uint8ClampedArray, i: number) => p[i]! > 180 && p[i + 1]! > 140 && p[i + 1]! < p[i]! && p[i + 2]! < p[i + 1]!;
      const same = (i: number) => scene[i] === sprite[i] && scene[i + 1] === sprite[i + 1] && scene[i + 2] === sprite[i + 2];
      let hatFull = 0, hatVisible = 0, skinFull = 0, skinVisible = 0;
      for (let i = 0; i < scene.length; i += 4) {
        if (hat(sprite, i)) {
          hatFull++;
          if (same(i)) hatVisible++;
        }
        if (skin(sprite, i)) {
          skinFull++;
          if (same(i)) skinVisible++;
        }
      }
      return { hatFull, hatVisible, skinFull, skinVisible };
    } finally {
      world.view = view;
      debug.edges = true;
      debug.spritesOnly = false;
    }
  });
  expect(pixels.hatFull).toBeGreaterThan(0);
  // The brim shows through the hole and the crown may peek over the board's top edge, as on the DS; the rest is
  // under the board (the upright plane at the anchor left 42 % of the hat over the board's top).
  expect(pixels.hatVisible, 'the board covers the hat').toBeLessThan(pixels.hatFull * 0.15);
  expect(pixels.skinVisible, 'the face shows through the hole').toBeGreaterThan(pixels.skinFull * 0.5);
});
