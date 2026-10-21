/**
 * Shaped billboard models (OPENSINNOH_NDS_ROM; desktop). The Galactic HQ hall's grunt groups (gfx GRUNTS_GROUP_OF_4
 * and _OF_3) are drawn with their own BMD0s, a wide quad on a full-billboard node (G3D SBC BB), which the DS turns to
 * face the camera. The page mounts its own field renderer over the running game: each grunt group is drawn as a model,
 * its quad's normal is the camera's view axis, and hiding the groups changes thousands of pixels.
 */
import { expect, test } from '@playwright/test';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { seedRomImport } from './seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough for the models');

test('the Galactic HQ hall draws its grunt groups as camera-facing models', async ({ page }) => {
  test.setTimeout(180_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const { state } = window.openSinnohGame!.snapshot();
    state.player = { zone: 'platinum:MAP_HEADER_GALACTIC_HQ_HALL' as never, x: 12, z: 19, y: 0, facing: 'up' };
    state.objects = [];
    state.follower = null;
    delete state.flags['platinum:FLAG_HIDE_GALACTIC_HQ_HALL_GRUNTS' as never];
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }), 'arrival');
    window.openSinnohGame!.advance(40);
  });
  await waitForScene(page);
  const result = await page.evaluate(async () => {
    const THREE = (await new Function('return import("/__test/three.js")')()) as typeof import('three');
    const store = (await new Function('return import("/__test/store.js")')()) as typeof import('../../packages/app/src/store.ts');
    const { importedSource } = (await new Function('return import("/__test/pack-source.js")')()) as typeof import('../../packages/app/src/pack-source.ts');
    const { mountFieldRenderer } = (await new Function('return import("/__test/renderer.js")')()) as typeof import('../../packages/render/src/renderer.ts');
    const db = await store.openDb();
    const source = await importedSource(db, (await store.listImports(db))[0]!.key);
    const game = window.openSinnohApp!.game;
    const world = game.world;
    const view = world.view.bind(world);
    const canvas = document.createElement('canvas');
    const field = await mountFieldRenderer(canvas, { world, registries: game.registries, state: game.state, assets: source.assets, log: game.log });
    field.resize(1280, 720, 1);
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d', { willReadFrequently: true })!;
    const frame = () => {
      field.render(1);
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, copy.width, copy.height).data;
    };
    const group = (sprite: string) => sprite.includes('GRUNTS_GROUP');
    try {
      const deadline = performance.now() + 60_000;
      do {
        field.render(1);
        if (performance.now() > deadline) throw new Error('the scene did not finish loading');
        await new Promise(requestAnimationFrame);
      } while (field.loading());
      const shown = frame();
      const internals = field as unknown as { scene: import('three').Scene; camera: import('three').Camera; stats: import('../../packages/render/src/renderer.ts').RenderStats };
      const toViewer = new THREE.Vector3(0, 0, 1).applyQuaternion(internals.camera.getWorldQuaternion(new THREE.Quaternion()));
      const groups = internals.stats.actors.filter((a) => group(a.sprite) && a.onScreen);
      const facing: number[] = [];
      for (const a of groups) {
        const object = internals.scene.getObjectByProperty('uuid', a.object!)!;
        object.traverse((o) => {
          // The matrix the mesh was last drawn with (set as it is drawn).
          if ((o as import('three').Mesh).isMesh) facing.push(new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld).dot(toViewer));
        });
      }
      world.view = () => ({ ...view(), actors: view().actors.filter((a) => !group(a.sprite)) });
      const hidden = frame();
      let changed = 0;
      for (let k = 0; k < shown.length; k += 4) if (shown[k] !== hidden[k] || shown[k + 1] !== hidden[k + 1] || shown[k + 2] !== hidden[k + 2]) changed++;
      return { kinds: groups.map((a) => a.kind), objects: groups.filter((a) => a.object).length, facing, changed, sprites: [...new Set(groups.map((a) => a.sprite))].sort() };
    } finally {
      world.view = view;
      field.dispose();
      db.close();
    }
  });
  expect(result.sprites).toEqual(['platinum:OBJ_EVENT_GFX_GRUNTS_GROUP_OF_3', 'platinum:OBJ_EVENT_GFX_GRUNTS_GROUP_OF_4']);
  expect(result.objects).toBe(result.kinds.length);
  expect(result.facing.length, "one quad per group").toBe(result.kinds.length);
  for (const f of result.facing) expect(f, 'the quad faces the camera').toBeGreaterThan(0.9999);
  expect(result.changed, 'the grunt groups are drawn').toBeGreaterThan(5000);
});
