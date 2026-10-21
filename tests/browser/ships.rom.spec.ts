import { expect, test } from '@playwright/test';
import type * as Three from 'three';
import { seedRomImport } from './seed.ts';

interface DrawnShipMesh {
  material: string;
  geometry: number;
  texture: boolean;
  opacity: number;
  uv: number[];
  pose: number[];
  camera: number[];
}

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.describe.configure({ mode: 'serial' });

// Intercept real mesh submissions, not pixels or a list of intended scene objects.
test('both ships draw their authored sea, ship and animation channels, then restore the field', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 120_000 });
  await page.evaluate(async () => {
    const THREE = await new Function('return import("/__test/three.js")')() as typeof Three;
    const after = THREE.Mesh.prototype.onAfterRender;
    const probe = { draws: [] as DrawnShipMesh[] };
    (window as unknown as { shipProbe: typeof probe }).shipProbe = probe;
    THREE.Mesh.prototype.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
      if (scene?.name.startsWith('ship:')) {
        const u = (material as Three.ShaderMaterial).uniforms;
        const mesh = this as Three.SkinnedMesh;
        const cam = camera as Three.PerspectiveCamera;
        probe.draws.push({
          material: material.name, geometry: geometry.getAttribute('position').count,
          texture: !!u.map?.value, opacity: u.opacity!.value as number,
          uv: (u.uvMatrix!.value as Three.Matrix3).toArray(),
          pose: [...mesh.matrixWorld.toArray(), ...(mesh.skeleton?.boneMatrices ? Array.from(mesh.skeleton.boneMatrices) : [])],
          camera: [...camera.position.toArray(), cam.fov, cam.near, cam.far],
        });
      }
      return after.call(this, renderer, scene, camera, geometry, material, group);
    };
  });
  for (const direction of [3, 0, 2, 1, 3]) {
    await page.evaluate(async direction => {
      const { state } = window.openSinnohGame!.snapshot();
      state.player = direction === 2
        ? { zone: 'platinum:MAP_HEADER_SNOWPOINT_CITY', x: 356, z: 246, y: 0, facing: 'down' }
        : { zone: 'platinum:MAP_HEADER_CANALAVE_CITY', x: 44, z: 750, y: 0, facing: 'right' };
      state.objects = [];
      state.follower = null;
      await window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: 'test', state }), 'arrival');
      window.openSinnohGame!.advance(40);
      const world = window.openSinnohApp!.game.world;
      world.playBoatCutscene(direction, 'right', 'platinum:MAP_HEADER_IRON_ISLAND', 100, 502);
      for (let i = 0; i < 600 && !world.view().shipScene; i++) window.openSinnohGame!.advance(1);
      if (!world.view().shipScene) throw new Error('ship cinematic never started');
      window.openSinnohGame!.advance(12);
    }, direction);
    await page.waitForFunction(() => !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 120_000 });
    const capture = async () => page.evaluate(async () => {
      const probe = (window as unknown as { shipProbe: { draws: DrawnShipMesh[] } }).shipProbe;
      probe.draws = [];
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return probe.draws;
    });
    const first = await capture();
    expect(errors).toEqual([]);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every(d => d.geometry > 0 && d.texture)).toBe(true);
    const names = [...new Set(first.map(d => d.material))];
    const snowpoint = direction === 1 || direction === 2;
    expect(names).toEqual(expect.arrayContaining(snowpoint ? ['garinko_lm5', 'water_1_lm2', 'wave_g_lm2', 'kemuri_lm5'] : ['ID8', 'lambert3', 'lambert5', 'lambert8']));
    expect(first[0]!.camera.slice(-2)).toEqual([150, 900]);
    await page.evaluate(() => window.openSinnohGame!.advance(24));
    const later = await capture();
    const wave = snowpoint ? 'wave_g_lm2' : 'lambert7';
    expect(later.find(d => d.material === wave)!.uv).not.toEqual(first.find(d => d.material === wave)!.uv);
    const ship = snowpoint ? 'garinko_lm5' : 'ID8';
    expect(first.find(d => d.material === ship)!.pose.length).toBeGreaterThanOrEqual(16);
    expect(later.find(d => d.material === ship)!.pose).not.toEqual(first.find(d => d.material === ship)!.pose);
    expect(later[0]!.camera).toEqual(first[0]!.camera);
    await page.evaluate(() => window.openSinnohGame!.advance(53));
    const end = await capture();
    await page.evaluate(() => window.openSinnohGame!.advance(4));
    const held = await capture();
    expect(held.find(d => d.material === ship)!.pose).toEqual(end.find(d => d.material === ship)!.pose);
    expect(held.find(d => d.material === wave)!.uv).toEqual(end.find(d => d.material === wave)!.uv);
    await page.evaluate(() => window.openSinnohGame!.advance(60));
    expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().shipScene)).toBeUndefined();
    expect(await capture()).toEqual([]);
    expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().cameraOffset)).toEqual([0, 0, 0]);
    expect(await page.evaluate(() => window.openSinnohApp!.game.world.fadeState())).toBeNull();
    expect(await page.evaluate(() => window.openSinnohApp!.game.world.boatCutsceneDone())).toBe(true);
    expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player)).toMatchObject({ zone: 'platinum:MAP_HEADER_IRON_ISLAND', x: 100, z: 502, facing: 'right' });
  }
  expect(errors).toEqual([]);
});
