/**
 * Map textures with per-texel alpha (OPENSINNOH_NDS_ROM; desktop). The DS blends a pixel whose alpha is between 1
 * and 30 over what is drawn (GBATEK "DS 3D Alpha Blending"); alpha 31 is drawn opaque and alpha 0 not at all.
 * A replay sets the scene; the page mounts its own field renderer over the running game and reads its canvas with
 * and without the drawables under test.
 *
 * - Water (`lake`, `lakep`, a3i5 at alpha 13 of 31): by Twinleaf Town's river the surface blends over the river
 *   bed: it changes the pixels over the water, and the bed's pattern still shows through it.
 * - Iron Ruins' floor (`yuka_*`, a3i5 texels at alpha 9, 13 and 31): the reflection under it shows faintly through
 *   the translucent texels, not at full strength through holes.
 * - Cut-outs (textures with alpha 0 texels, Twinleaf's trees and fences): every pixel is either the cut-out's or
 *   what is behind it, never a mix.
 * - At night the lit translucent `h_kage` house shadows (polygon alpha 9) add 10/32 of their colour to 22/32 of the
 *   grass under them, the DS blend factor (alpha + 1) / 32; at 9/31 they were a little light.
 *
 * Screenshots go to test-artifacts/translucent-texels (gitignored: ROM content, never commit).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import type { Light, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Quaternion, Vector3 } from 'three';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { dsVertexLight, lightAt, type LightTemplate } from '../../packages/render/src/lighting.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

type MaterialColours = Pick<LightTemplate, 'diffuse' | 'ambient' | 'specular' | 'emission'>;

const SHOTS = 'test-artifacts/translucent-texels';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough for blending');

let registries: Registries;
test.beforeAll(() => {
  registries = loadGamePacks([romSlice().pack]).registries;
});

async function play(page: Page, name: string, lines: string[]): Promise<void> {
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = pageDriver(page, SHOTS, name);
  await driver.reset(1);
  const r = await runReplay(driver, [...lines, ''].join('\n'), { registries, repeat: false });
  expect(r.error).toBeUndefined();
  // The runner ends with a save round trip, whose load fades the map in again: wait it out.
  for (let i = 0; i < 120 && (await driver.snapshot()).fade; i++) await driver.advance(1);
  expect((await driver.snapshot()).fade).toBeNull();
}

type Mode = 'water' | 'floor' | 'cutouts' | 'shadows' | 'shadow-colour';

interface Measure {
  /** Pixels the drawable under test changes. */
  changed: number;
  /** water: correlation of the pixels with and without the surface (the bed shows through). */
  correlation?: number;
  /** floor: median ratio of the reflection's change with the floor drawn to its change without it. */
  ratio?: number;
  /** cutouts: pixels that are neither the cut-out's nor what is behind it. */
  mixed?: number;
  /** shadows: mean luminance change the shadows make (negative = darker). */
  luma?: number;
  /** shadow-colour: per-channel sums of the lit shadows alone; their distinct shading (light mask, a normal, own colours); the camera; the area. */
  sums?: [number, number, number];
  shading?: string[];
  colours?: string[];
  viewToWorld?: [number, number, number, number];
  area?: string;
  /** shadows: share of the shadow pixels that are the DS blend at alpha 9 of the shadow over the pixel under it. */
  ds?: number;
  image: string;
}

/** Mounts a field renderer over the running game and measures `mode` (the canvas is 1280×720). */
function measure(page: Page, mode: Mode): Promise<Measure> {
  return page.evaluate(async (mode) => {
    const store = (await new Function('return import("/__test/store.js")')()) as typeof import('../../packages/app/src/store.ts');
    const { importedSource } = (await new Function('return import("/__test/pack-source.js")')()) as typeof import('../../packages/app/src/pack-source.ts');
    const { mountFieldRenderer } = (await new Function('return import("/__test/renderer.js")')()) as typeof import('../../packages/render/src/renderer.ts');
    const db = await store.openDb();
    const source = await importedSource(db, (await store.listImports(db))[0]!.key);
    const game = window.openSinnohApp!.game;
    const canvas = document.createElement('canvas');
    const field = await mountFieldRenderer(canvas, { world: game.world, registries: game.registries, state: game.state, assets: source.assets, log: game.log });
    field.resize(1280, 720, 1);
    const internals = field as unknown as { scene: THREE.Scene; actors: Map<string, { reflection?: THREE.Sprite }>; debug: { edges: boolean }; viewToWorld: () => THREE.Quaternion };
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d', { willReadFrequently: true })!;
    const frame = () => {
      field.render(1);
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, copy.width, copy.height).data;
    };
    /** Map meshes (no sprites) whose texture's asset path matches. */
    const meshes = (texture: RegExp) => {
      const out: THREE.Mesh[] = [];
      internals.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if ((o as THREE.Mesh).isMesh && m?.map && texture.test(m.map.name)) out.push(o as THREE.Mesh);
      });
      return out;
    };
    const show = (objects: THREE.Object3D[], v: boolean) => objects.forEach((o) => (o.visible = v));
    const same = (a: Uint8ClampedArray, b: Uint8ClampedArray, k: number) => a[k] === b[k] && a[k + 1] === b[k + 1] && a[k + 2] === b[k + 2];
    const luma = (a: Uint8ClampedArray, k: number) => a[k]! + a[k + 1]! + a[k + 2]!;
    try {
      const deadline = performance.now() + 60_000;
      do {
        field.render(1);
        if (performance.now() > deadline) throw new Error('the scene did not finish loading');
        await new Promise(requestAnimationFrame);
      } while (field.loading());
      frame();
      const image = copy.toDataURL();
      if (mode === 'water' || mode === 'shadows') {
        // shadows: the lit ones (lit by the area light); the unlit ones stay hidden (the same polygon ID, so of two
        // overlapping shadows only the first drawn shows).
        const shadows = meshes(/\/h_kage__/);
        const surface = mode === 'water' ? meshes(/\/(lake|lakep\.1)(~\d+)?__/) : shadows.filter((m) => m.userData.lit);
        if (!surface.length) throw new Error(`no ${mode} meshes`);
        if (mode === 'shadows') {
          show(shadows.filter((m) => !m.userData.lit), false);
          // Edge marking blends the edge colour over the neighbouring pixel, which the shadow changes too.
          internals.debug.edges = false;
        }
        const all = frame();
        show(surface, false);
        const without = frame();
        show(surface, true);
        // The surface alone, over the cleared (black) rear plane: the new pixel's share of the blend.
        const others: THREE.Object3D[] = [];
        internals.scene.traverse((o) => {
          if ((o as THREE.Mesh).material && o.visible && !surface.some((m) => m === o || m.children.includes(o))) others.push(o);
        });
        show(others, false);
        const alone = frame();
        show(others, true);
        const xs: number[] = [];
        const ys: number[] = [];
        let dl = 0;
        // At polygon alpha 9 a shadow pixel is its own share (the shadow alone) plus 22/32 of the pixel under it.
        let ds = 0;
        for (let k = 0; k < all.length; k += 4) {
          if (same(all, without, k)) continue;
          xs.push(luma(all, k));
          ys.push(luma(without, k));
          dl += luma(all, k) - luma(without, k);
          if ([0, 1, 2].every((c) => Math.abs(all[k + c]! - alone[k + c]! - (without[k + c]! * 22) / 32) <= 1)) ds++;
        }
        const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
        const mx = mean(xs);
        const my = mean(ys);
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (let i = 0; i < xs.length; i++) {
          sxy += (xs[i]! - mx) * (ys[i]! - my);
          sxx += (xs[i]! - mx) ** 2;
          syy += (ys[i]! - my) ** 2;
        }
        return { changed: xs.length, correlation: xs.length ? sxy / Math.sqrt(sxx * syy) : 0, luma: xs.length ? dl / xs.length / 3 : 0, ds: xs.length ? ds / xs.length : 0, image };
      }
      if (mode === 'shadow-colour') {
        // The lit house shadows alone over the cleared (black) rear plane: each pixel is its own share of the blend,
        // texel × vertex colour × (9 + 1) / 32. Each mesh's `Lit` says how it is lit: mask, world normals, own colours.
        const lit = meshes(/\/h_kage__/).filter((m) => m.userData.lit);
        if (!lit.length) throw new Error('no lit shadow meshes');
        const others: THREE.Object3D[] = [];
        internals.scene.traverse((o) => {
          if ((o as THREE.Mesh).material && o.visible && !lit.some((m) => m === o || m.children.includes(o))) others.push(o);
        });
        show(others, false);
        internals.debug.edges = false;
        const alone = frame();
        show(others, true);
        const sums: [number, number, number] = [0, 0, 0];
        let changed = 0;
        for (let k = 0; k < alone.length; k += 4) {
          if (!luma(alone, k)) continue;
          changed++;
          for (const c of [0, 1, 2] as const) sums[c] += alone[k + c]!;
        }
        const lits = lit.map((m) => m.userData.lit as { mask: number; normals: Float32Array; own?: object });
        const shading = [...new Set(lits.map((l) => JSON.stringify({ mask: l.mask, normal: [...l.normals.slice(0, 3)].map((v) => Math.round(v * 512) / 512), own: l.own ?? null })))];
        // The rotation the renderer lights map normals with.
        const q = internals.viewToWorld();
        // The vertex colours the shadows are drawn with (each mesh: the colours of its vertices, rounded).
        const colours = [
          ...new Set(
            lit.flatMap((m) => {
              const a = m.geometry.getAttribute('color');
              return Array.from({ length: a.count }, (_, i) => JSON.stringify([a.getX(i), a.getY(i), a.getZ(i)].map((v) => Math.round(v * 1000) / 1000)));
            }),
          ),
        ];
        return { changed, sums, shading, colours, viewToWorld: [q.x, q.y, q.z, q.w], area: game.world.view().area, image };
      }
      if (mode === 'floor') {
        const floor = meshes(/\/yuka_/);
        if (!floor.length) throw new Error('no floor meshes');
        const reflections = [...internals.actors.values()].flatMap((a) => (a.reflection?.visible ? [a.reflection] : []));
        if (!reflections.length) throw new Error('no reflection');
        /** Per pixel: the reflection's change (sum of channel differences), 0 where it changes nothing. */
        const delta = () => {
          const shown = frame();
          for (const r of reflections) r.material.visible = false;
          const hidden = frame();
          for (const r of reflections) r.material.visible = true;
          const d = new Float32Array(shown.length / 4);
          for (let k = 0; k < shown.length; k += 4) d[k / 4] = Math.abs(shown[k]! - hidden[k]!) + Math.abs(shown[k + 1]! - hidden[k + 1]!) + Math.abs(shown[k + 2]! - hidden[k + 2]!);
          return d;
        };
        const withFloor = delta();
        show(floor, false);
        const bare = delta();
        show(floor, true);
        // Where the reflection shows through the floor: its change there against its change on the bare ground.
        const ratios: number[] = [];
        for (let i = 0; i < bare.length; i++) if (bare[i]! > 24 && withFloor[i]! > 0) ratios.push(withFloor[i]! / bare[i]!);
        ratios.sort((a, b) => a - b);
        return { changed: ratios.length, ratio: ratios[ratios.length >> 1] ?? 0, image };
      }
      // cutouts: opaque map meshes whose texture has alpha 0 texels, against the other opaque map meshes.
      internals.debug.edges = false;
      const alphaZero = new Map<THREE.Texture, boolean>();
      const hasHoles = (t: THREE.Texture) => {
        let v = alphaZero.get(t);
        if (v === undefined) {
          const img = t.image as ImageBitmap;
          const c = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
          c.drawImage(img, 0, 0);
          const px = c.getImageData(0, 0, img.width, img.height).data;
          v = false;
          for (let k = 3; k < px.length; k += 4) if (px[k] === 0) v = true;
          alphaZero.set(t, v);
        }
        return v;
      };
      const cut: THREE.Object3D[] = [];
      const rest: THREE.Object3D[] = [];
      const hidden: THREE.Object3D[] = [];
      internals.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (!m || (o as THREE.Sprite).isSprite || m.transparent || !(o as THREE.Mesh).isMesh) {
          if (m) hidden.push(o);
          return;
        }
        (m.map && hasHoles(m.map) ? cut : rest).push(o);
      });
      show(hidden, false);
      const both = frame();
      show(rest, false);
      const cutOnly = frame();
      show(rest, true);
      show(cut, false);
      const restOnly = frame();
      let changed = 0;
      let mixed = 0;
      for (let k = 0; k < both.length; k += 4) {
        if (same(both, restOnly, k)) continue;
        changed++;
        if (!same(both, cutOnly, k)) mixed++;
      }
      return { changed, mixed, image };
    } finally {
      field.dispose();
      db.close();
    }
  }, mode);
}

function save(name: string, image: string): void {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
}

/** On the bank north of Twinleaf Town's river. */
const RIVER = ['warp platinum:MAP_HEADER_TWINLEAF_TOWN 110 888 down', 'until idle', '+0 press down', 'until position 110 890', '+0 release down', 'until idle'];

test('the river surface blends over the river bed', async ({ page }) => {
  test.setTimeout(300_000);
  await play(page, 'river', RIVER);
  const { image, ...m } = await measure(page, 'water');
  save('river', image);
  console.log('river', JSON.stringify(m));
  expect(m.changed, 'pixels the surface changes').toBeGreaterThan(5000);
  expect(m.correlation, 'the bed shows through the surface').toBeGreaterThan(0.5);
});

test('the Iron Ruins floor shows the reflection faintly through its translucent texels', async ({ page }) => {
  test.setTimeout(300_000);
  await play(page, 'iron-ruins', ['warp platinum:MAP_HEADER_IRON_RUINS 7 3 down', 'until idle', '+0 press down', 'until position 7 7', '+0 release down', 'until idle']);
  const { image, ...m } = await measure(page, 'floor');
  save('iron-ruins', image);
  console.log('iron-ruins', JSON.stringify(m));
  expect(m.changed, 'reflection pixels through the floor').toBeGreaterThan(200);
  // The texels at alpha 9 and 13 of 31 pass 22/32 and 18/32 of what is under them.
  expect(m.ratio, 'the reflection through the floor against the bare reflection').toBeGreaterThan(0.4);
  expect(m.ratio).toBeLessThan(0.8);
});

test('cut-out edges stay binary', async ({ page }) => {
  test.setTimeout(300_000);
  await play(page, 'cutouts', RIVER);
  const { image, ...m } = await measure(page, 'cutouts');
  save('cutouts', image);
  console.log('cutouts', JSON.stringify(m));
  expect(m.changed, 'cut-out pixels').toBeGreaterThan(5000);
  expect(m.mixed, 'pixels mixing a cut-out with what is behind it').toBe(0);
});

test('house shadows darken the grass at night', async ({ page }) => {
  test.setTimeout(300_000);
  await play(page, 'shadows-night', ['time 22:00', ...RIVER]);
  const { image, ...m } = await measure(page, 'shadows');
  save('shadows-night', image);
  console.log('shadows-night', JSON.stringify(m));
  expect(m.changed, 'shadow pixels').toBeGreaterThan(500);
  expect(m.luma, 'mean luminance change under the shadows').toBeLessThan(0);
  // DS blending: (new × (9 + 1) + old × (31 − 9)) / 32, once per pixel for overlapping shadows of one polygon ID.
  expect(m.ds, 'shadow pixels at the DS blend').toBeGreaterThan(0.95);
});

// Twinleaf's house shadows are prop polygons (h_kage, lit by light 0, alpha 9). map_prop.c draws props without
// NNS_G3dMdlUseGlb*, so they keep their own material colours under the template's lights, at noon and at night.
// (Unlit polygons never take the template's colours on the field: see renderer.ts `Lit`.)
test('house shadows keep their own material colours under the night lights', async ({ page }) => {
  test.setTimeout(300_000);
  const at: Record<string, Omit<Measure, 'image'>> = {};
  for (const [name, time] of [['noon', '12:00'], ['night', '22:00']] as const) {
    await play(page, `shadow-colour-${name}`, [`time ${time}`, ...RIVER]);
    const { image, ...m } = await measure(page, 'shadow-colour');
    save(`shadow-colour-${name}`, image);
    console.log(`shadow-colour-${name}`, JSON.stringify(m));
    at[name] = m;
  }
  const noon = at.noon!;
  const night = at.night!;
  expect(noon.changed, 'shadow pixels').toBeGreaterThan(500);
  expect(night.changed).toBe(noon.changed);
  // One shading: light 0, facing up, the h_kage material's own colours (diffuse 25/31, ambient 31/31: DIF_AMB 0x7FFFE739).
  expect(noon.shading).toHaveLength(1);
  const shading = JSON.parse(noon.shading![0]!) as { mask: number; normal: [number, number, number]; own: MaterialColours | null };
  const c = 25 / 31;
  expect(shading.own).toEqual({ diffuse: [c, c, c], ambient: [1, 1, 1], specular: [0, 0, 0], emission: [0, 0, 0] });
  const light = registries.lights.get(registries.areas.get(noon.area as Id)!.light)! as Light;
  const toView = new Quaternion(...noon.viewToWorld!).invert();
  const n = new Vector3(...shading.normal).normalize().applyQuaternion(toView);
  const colour = (seconds: number, own: boolean) => {
    const template = lightAt(light, seconds).template;
    return dsVertexLight([n.x, n.y, n.z], shading.mask, own ? { ...template, ...shading.own! } : template);
  };
  // The shadows are drawn with that colour (one per time), not with the template's colours.
  const rounded = (rgb: number[]) => JSON.stringify(rgb.map((v) => Math.round(v * 1000) / 1000));
  for (const [m, seconds] of [[noon, 12 * 3600], [night, 22 * 3600]] as const) {
    expect(m.colours).toEqual([rounded(colour(seconds, true))]);
    expect(rounded(colour(seconds, false))).not.toEqual(rounded(colour(seconds, true)));
  }
  // And darker at night: every channel's sum over the shadows alone drops.
  for (const k of [0, 1, 2] as const) expect(night.sums![k], `channel ${k}`).toBeLessThan(noon.sums![k]);
});
