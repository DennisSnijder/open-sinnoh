/** Local-only ROM visual beats. Numeric comparisons of our render; no screenshot baselines. */
import { expect, test, type Page } from '@playwright/test';
import type * as Three from 'three';
import { createGame, CountingStubLog, gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay } from '../rom-replays/sys-replays.ts';
import { waitForScene, mainCanvasStats } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.describe.configure({ mode: 'default' });

async function open(page: Page, text: string) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const game = createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, log: new CountingStubLog(() => {}), seed: 1 });
  const result = await runReplay(gameDriver(game), text, { registries: game.registries, repeat: false });
  expect(result.error).toBeUndefined();
  // runReplay ends by loading the round-trip save; let its entry fade finish.
  game.advance(60);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready, undefined, { timeout: 120_000 });
  await page.evaluate(json => window.openSinnohGame!.load(json), saveToJson(game.save()));
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  await waitForScene(page);
  return errors;
}

async function pixels(page: Page): Promise<number[]> {
  await waitForScene(page);
  return page.evaluate(() => new Promise<number[]>(resolve => requestAnimationFrame(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(document.getElementById('main-canvas') as HTMLCanvasElement, 0, 0, 256, 192);
    resolve(Array.from(ctx.getImageData(0, 0, 256, 192).data));
  })));
}
const changed = (a: number[], b: number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0) / a.length;

interface Draw { material: string; uv: number[]; pose: number[]; fov: number }
test('native Spear Pillar warp draws the animated tunnel, zooms, and restores the DW field', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors = await open(page, 'set var platinum:VAR_DISTORTION_WORLD_PROGRESS 1\nwarp platinum:MAP_HEADER_SPEAR_PILLAR_DISTORTED 31 32 up\nuntil idle');
  await page.evaluate(async () => {
    const THREE = await new Function('return import("/__test/three.js")')() as typeof Three;
    const after = THREE.Mesh.prototype.onAfterRender;
    const probe = { draws: [] as Draw[] };
    (window as unknown as { dwProbe: typeof probe }).dwProbe = probe;
    THREE.Mesh.prototype.onAfterRender = function(renderer, scene, camera, geometry, material, group) {
      if (scene?.name === 'ship:platinum:MODEL_DW_WARP') {
        const m = this as Three.SkinnedMesh;
        const u = (material as Three.ShaderMaterial).uniforms;
        probe.draws.push({ material: material.name, uv: (u.uvMatrix!.value as Three.Matrix3).toArray(), pose: [...m.matrixWorld.toArray(), ...Array.from(m.skeleton?.boneMatrices ?? [])], fov: (camera as Three.PerspectiveCamera).fov });
      }
      return after.call(this, renderer, scene, camera, geometry, material, group);
    };
    const g = window.openSinnohApp!.game;
    g.scripts.start({ label: 'platinum:SpearPillarDistorted_Cynthia', zone: g.state.player.zone, source: 'test' });
    for (let i = 0; i < 1000 && g.world.view().storyScene?.kind !== 'dw-warp'; i++) {
      if (i % 4 === 0) g.press('a');
      if (i % 4 === 1) g.release('a');
      g.tick();
    }
    g.release('a');
    if (g.world.view().storyScene?.kind !== 'dw-warp') throw new Error('warp did not start');
    g.advance(24);
  });
  await waitForScene(page);
  const capture = async () => page.evaluate(async () => {
    const p = (window as unknown as { dwProbe: { draws: Draw[] } }).dwProbe;
    p.draws = [];
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return p.draws;
  });
  const first = await capture();
  const early = await pixels(page);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-warp.png` });
  const center = (96 * 256 + 128) * 4;
  expect(early[center + 2]).toBeGreaterThan(40);
  expect(early[center + 2]! - early[center]!).toBeGreaterThan(20);
  const glow = new Set<number>();
  for (let x = 128; x < 148; x++) glow.add(early[(96 * 256 + x) * 4 + 2]!);
  expect(glow.size).toBeGreaterThan(5);
  expect(first.length).toBeGreaterThan(0);
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(30);
  await page.evaluate(() => window.openSinnohGame!.advance(32));
  const next = await capture();
  expect(next[0]!.fov).toBeLessThan(first[0]!.fov);
  expect(next.some(d => first.find(a => a.material === d.material)?.uv.join() !== d.uv.join())).toBe(true);
  expect(next.some(d => first.find(a => a.material === d.material)?.pose.join() !== d.pose.join())).toBe(true);
  expect(changed(early, await pixels(page))).toBeGreaterThan(1);
  await page.evaluate(() => window.openSinnohGame!.advance(200));
  await waitForScene(page);
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().storyScene)).toBeUndefined();
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.zone)).toBe('platinum:MAP_HEADER_DISTORTION_WORLD_1F');
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('Giratina arrives black and reveals her palette without changing the surrounding frame', async ({ page }, info) => {
  test.setTimeout(600_000);
  // Play the native route through both shadows and stop just before the arrival trigger.
  const route = readReplay('dw-giratina-room.replay').split('+0 press up\nuntil state player.z 14')[0]!;
  const errors = await open(page, route);
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('up');
    for (let i = 0; i < 60 && g.snapshot().state.player.z !== 14; i++) g.advance(1);
    g.release('up');
    for (let i = 0; i < 300; i++) {
      const a = window.openSinnohApp!.game.world.view().actors.find(a => a.paletteDarkness !== undefined);
      if (a?.paletteDarkness === 16 && a.cur[1] <= 25) return;
      g.advance(1);
    }
    throw new Error('black Giratina never descended');
  });
  await waitForScene(page);
  const dark = await pixels(page);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-giratina-black.png` });
  // Compare the same tick/pose with the palette blend disabled, so sky motion cannot satisfy the test.
  const comparison = await page.evaluate(() => {
    const w = window.openSinnohApp!.game.world;
    const original = w.view.bind(w);
    w.view = () => {
      const v = original();
      v.actors = v.actors.map(a => a.paletteDarkness === undefined ? a : { ...a, paletteDarkness: 0 });
      return v;
    };
    (window as unknown as { restoreDwView: () => void }).restoreDwView = () => { w.view = original; };
    return original().actors.find(a => a.paletteDarkness !== undefined)!.paletteDarkness;
  });
  expect(comparison).toBe(16);
  const bright = await pixels(page);
  expect(changed(dark, bright)).toBeGreaterThan(0.05);
  const brighter = bright.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : v - dark[i]!), 0);
  expect(brighter).toBeGreaterThan(1000);
  await page.evaluate(() => {
    (window as unknown as { restoreDwView: () => void }).restoreDwView();
    window.openSinnohGame!.advance(110);
  });
  await waitForScene(page);
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().actors.some(a => (a.paletteDarkness ?? 0) > 0))).toBe(false);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-giratina-revealed.png` });
  expect(errors).toEqual([]);
});

test('surf mount orbits and turns through both native cascade directions', async ({ page }, info) => {
  test.setTimeout(600_000);
  const route = readReplay('dw-b4f.replay').split('+0 press right\nuntil state player.y 2719.5')[0]!;
  const errors = await open(page, route);
  const pose = async () => page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    const v = g.world.view();
    const e = v.effects.find(e => g.registries.fieldEffects.get(e.effect)?.name === 'SURF_BLOB')!;
    const p = v.actors.find(a => a.home === undefined)!;
    return { rotation: e.rotation, offset: e.cur.map((n, i) => n - p.cur[i]!), player: g.state.player };
  });
  expect((await pose()).rotation?.[0]).toBe(180);
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('right'); g.advance(1); g.release('right'); g.advance(20);
  });
  const turn = await pose();
  expect(turn.rotation![0]).toBeGreaterThan(90);
  expect(turn.rotation![0]).toBeLessThan(180);
  expect(turn.offset[0]).toBeGreaterThan(5);
  const turning = await pixels(page);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-cascade-down-turn.png` });
  // Same simulation frame with the old upright mount pose: only the mount's pixels may change.
  await page.evaluate(() => {
    const w = window.openSinnohApp!.game.world;
    const original = w.view.bind(w);
    w.view = () => {
      const v = original();
      v.effects = v.effects.map(e => e.rotation ? { ...e, rotation: [0, 270, 0] } : e);
      return v;
    };
    (window as unknown as { restoreDwView: () => void }).restoreDwView = () => { w.view = original; };
  });
  expect(changed(turning, await pixels(page))).toBeGreaterThan(0.01);
  await page.evaluate(() => {
    (window as unknown as { restoreDwView: () => void }).restoreDwView();
    window.openSinnohGame!.advance(320);
  });
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-cascade-down-camera.png` });
  await page.evaluate(() => window.openSinnohGame!.advance(600));
  expect((await pose()).player).toMatchObject({ zone: 'platinum:MAP_HEADER_DISTORTION_WORLD_B5F', x: 102, z: 76 });
  expect((await pose()).rotation![0]).toBe(0);
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('right');
    for (let i = 0; i < 100 && g.snapshot().state.player.x !== 104; i++) g.advance(1);
    g.release('right'); g.advance(10);
    g.press('right'); g.advance(1); g.release('right'); g.advance(12);
  });
  expect((await pose()).rotation![0]).toBe(-90);
  expect((await pose()).offset[0]).toBeGreaterThan(10);
  await waitForScene(page);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-cascade-up.png` });
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(100);
  await page.evaluate(() => window.openSinnohGame!.advance(300));
  expect((await pose()).player).toMatchObject({ zone: 'platinum:MAP_HEADER_DISTORTION_WORLD_B4F', x: 101, z: 76 });
  expect((await pose()).rotation![0]).toBe(180);
  expect(errors).toEqual([]);
});

test('Turnback Cave portal draws the postgame DW room and returns through the native exit', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors = await open(page, readReplay('dw-turnback-room.replay').split('# Walk the ghost paths')[0]!);
  const room = await page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    const v = g.world.view();
    return { player: g.state.player, floors: v.distortion!.floors.length, props: v.distortion!.props.filter(p => p.opacity > 0).length, clouds: v.distortion!.sky.clouds.length };
  });
  expect(room.player).toMatchObject({ zone: 'platinum:MAP_HEADER_DISTORTION_WORLD_TURNBACK_CAVE_ROOM', x: 116, z: 75, y: 1040 });
  expect(room.floors).toBe(1);
  expect(room.props).toBeGreaterThan(0);
  expect(room.clouds).toBe(9);
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(100);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-turnback-room.png` });
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('left');
    for (let i = 0; i < 100 && g.snapshot().state.player.x !== 114; i++) g.advance(1);
    g.release('left'); g.advance(30);
  });
  const hidden = await page.evaluate(() => window.openSinnohApp!.game.world.view().distortion!.props.filter(p => p.opacity > 0).length);
  expect(hidden).toBeLessThan(room.props);
  await waitForScene(page);
  await page.screenshot({ path: `test-artifacts/distortion/${info.project.name}-turnback-portal.png` });
  const portal = await pixels(page);
  await page.evaluate(() => {
    const w = window.openSinnohApp!.game.world;
    const original = w.view.bind(w);
    (window as unknown as { dwOriginalView: typeof original }).dwOriginalView = original;
    w.view = () => {
      const v = original();
      v.distortion!.props = v.distortion!.props.filter(p => p.prop !== 'portal');
      return v;
    };
  });
  expect(changed(portal, await pixels(page))).toBeGreaterThan(0.05);
  await page.evaluate(() => {
    const w = window.openSinnohApp!.game.world;
    w.view = (window as unknown as { dwOriginalView: typeof w.view }).dwOriginalView;
  });
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('right');
    for (let i = 0; i < 100 && g.snapshot().state.player.x !== 116; i++) g.advance(1);
    g.release('right'); g.advance(30);
  });
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().distortion!.props.filter(p => p.opacity > 0).length)).toBe(room.props);
  await page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    g.scripts.start({ label: 'platinum:DistortionWorldTurnbackCaveRoom_Portal', zone: g.state.player.zone, source: 'test' });
    for (let i = 0; i < 1000; i++) {
      if (i % 4 === 0) g.press('a');
      if (i % 4 === 1) g.release('a');
      g.tick();
      if (g.world.view().storyScene?.kind === 'dw-warp') throw new Error('Turnback exit must use the ordinary field fade');
      if (g.state.player.zone === 'platinum:MAP_HEADER_TURNBACK_CAVE_GIRATINA_ROOM' && g.canSave()) break;
    }
    g.release('a');
  });
  await waitForScene(page);
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player)).toMatchObject({ zone: 'platinum:MAP_HEADER_TURNBACK_CAVE_GIRATINA_ROOM', x: 11, z: 15 });
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
