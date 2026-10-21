import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { seedRomImport } from './seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

test('texture cards (Eterna’s parked bicycles) rest on the path and stay put as the camera pans', async ({ page }) => {
  test.setTimeout(120_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const { state } = window.openSinnohGame!.snapshot();
    state.player = { zone: 'platinum:MAP_HEADER_ETERNA_CITY', x: 342, z: 536, y: 0, facing: 'up' };
    state.objects = [];
    state.follower = null;
    await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }), 'arrival');
    window.openSinnohGame!.advance(40);
  });
  const contacts = await page.evaluate(async () => {
    const store = await new Function('return import("/__test/store.js")')() as typeof import('../../packages/app/src/store.ts');
    const { importedSource } = await new Function('return import("/__test/pack-source.js")')() as typeof import('../../packages/app/src/pack-source.ts');
    const { mountFieldRenderer } = await new Function('return import("/__test/renderer.js")')() as typeof import('../../packages/render/src/renderer.ts');
    const { MapGrid } = await new Function('return import("/__test/world.js")')() as typeof import('../../packages/world/src/index.ts');
    const db = await store.openDb();
    const source = await importedSource(db, (await store.listImports(db))[0]!.key);
    const game = window.openSinnohApp!.game;
    const canvas = document.createElement('canvas');
    const field = await mountFieldRenderer(canvas, { world: game.world, registries: game.registries, state: game.state, assets: source.assets, log: game.log });
    field.resize(1280, 720, 1);
    // The chunks as built for normal play: each records where its texture cards' art now stands.
    const internals = field as unknown as { scene: THREE.Scene; camera: THREE.PerspectiveCamera };
    try {
      const deadline = performance.now() + 60_000;
      do {
        field.render(1);
        if (performance.now() > deadline) throw new Error('the Eterna scene did not finish loading');
        await new Promise(requestAnimationFrame);
      } while (field.loading());
      internals.scene.updateMatrixWorld(true);
      const zone = game.registries.zones.get(game.state.player.zone)!;
      const grid = new MapGrid(game.registries, game.registries.matrices.get(zone.matrix)!);
      const found: { height: number; drift: number }[] = [];
      internals.scene.traverse((object) => {
        const feet = object.userData.cardFeet as THREE.Vector3[] | undefined;
        for (const foot of feet ?? []) {
          const point = foot.clone().applyMatrix4(object.matrixWorld);
          const ground = grid.heightAt(point.x, point.z, point.y);
          // Where the camera sees the art's base on the ground, with the camera panned four ways.
          const footprints: THREE.Vector3[] = [];
          for (const [dx, dz] of [[-160, 0], [160, 0], [0, -160], [0, 160]]) {
            const camera = internals.camera.clone();
            camera.position.x += dx!;
            camera.position.z += dz!;
            camera.updateMatrixWorld(true);
            const far = point.clone().project(camera).setZ(1).unproject(camera);
            const ray = far.sub(camera.position);
            footprints.push(camera.position.clone().addScaledVector(ray, (ground - camera.position.y) / ray.y));
          }
          found.push({ height: point.y - ground, drift: Math.max(...footprints.map((p) => p.distanceTo(footprints[0]!))) });
        }
      });
      return found;
    } finally {
      field.dispose();
      db.close();
    }
  });
  // The bicycles by the Cycle Shop and the gym (12 at the time of writing).
  expect(contacts.length).toBeGreaterThan(4);
  for (const contact of contacts) {
    expect(Math.abs(contact.height), 'the art’s base rests on the terrain').toBeLessThan(0.01);
    expect(contact.drift, 'the art’s base keeps its ground footprint as the camera pans').toBeLessThan(0.01);
  }
});
