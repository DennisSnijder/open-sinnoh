/**
 * Depth of the berry soil model and the reflections (OPENSINNOH_NDS_ROM; desktop). A replay sets the scene through
 * `window.openSinnohGame`; the page then mounts its own field renderer over the running game and reads its canvas
 * right after each render, with and without the drawable under test.
 *
 * - Berry soil (berry_patch_effects.c): the moisture model is drawn at the soil object's position at its own height
 *   (2 units), over the plot the map draws 0.5 units above the ground. Walking down and up past Route 208's plot in
 *   the evening, the soil models' pixels change only a little from one frame to the next (no depth fight).
 * - Reflections (ov5_021F17B8.c): the mirrored character hangs under the ground and shows only where the ground in
 *   front of it is open: through the water of the reflective tiles. In Solaceon Town's and Pastoria City's puddles
 *   with the follower, by Twinleaf Town's river and on the Iron Ruins' floor, every reflection pixel lies over a
 *   reflective tile; standing on a puddle's top row, each reflection shows its whole height, also over Pastoria's
 *   shallow bed.
 *
 * Screenshots go to test-artifacts/field-effect-depth (gitignored: ROM content, never commit).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const SHOTS = 'test-artifacts/field-effect-depth';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough for depth');

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

test('berry soil keeps its look while the player walks down and up past the plot in the evening', async ({ page }) => {
  test.setTimeout(300_000);
  await play(page, 'soil', ['time 18:15', 'warp platinum:MAP_HEADER_ROUTE_208 435 715 up', 'until idle']);
  const counts = await page.evaluate(async () => {
    const store = (await new Function('return import("/__test/store.js")')()) as typeof import('../../packages/app/src/store.ts');
    const { importedSource } = (await new Function('return import("/__test/pack-source.js")')()) as typeof import('../../packages/app/src/pack-source.ts');
    const { mountFieldRenderer } = (await new Function('return import("/__test/renderer.js")')()) as typeof import('../../packages/render/src/renderer.ts');
    const db = await store.openDb();
    const source = await importedSource(db, (await store.listImports(db))[0]!.key);
    const bridge = window.openSinnohGame!;
    const game = window.openSinnohApp!.game;
    const canvas = document.createElement('canvas');
    const field = await mountFieldRenderer(canvas, { world: game.world, registries: game.registries, state: game.state, assets: source.assets, log: game.log });
    field.resize(1280, 720, 1);
    type Live = Map<number, { effect: { name: string }; object: { visible: boolean } } | null>;
    const live = (field as unknown as { effects: { live: Live } }).effects.live;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d', { willReadFrequently: true })!;
    const frame = () => {
      field.render(1);
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, copy.width, copy.height).data;
    };
    // Loading is read right after a render: a sprite whose texture comes in after it is drawn only by the next one
    // (until then its drawables sit unplaced).
    const settle = async () => {
      const deadline = performance.now() + 60_000;
      for (;;) {
        field.render(1);
        if (!field.loading()) return;
        if (performance.now() > deadline) throw new Error('the scene did not finish loading');
        await new Promise(requestAnimationFrame);
      }
    };
    /** Pixels the soil models change: the frame with them against the frame without. */
    const soilPixels = () => {
      const soil = [...live.values()].filter((i) => i?.effect.name.startsWith('BERRY_PATCH_SOIL_'));
      const shown = frame();
      for (const i of soil) i!.object.visible = false;
      const hidden = frame();
      for (const i of soil) i!.object.visible = true;
      let n = 0;
      for (let k = 0; k < shown.length; k += 4) if (shown[k] !== hidden[k] || shown[k + 1] !== hidden[k + 1] || shown[k + 2] !== hidden[k + 2]) n++;
      return { soil: soil.length, n };
    };
    try {
      await settle();
      const out: { z: number; soil: number; n: number }[] = [];
      for (const dir of ['down', 'up'] as const) {
        bridge.press(dir);
        for (let t = 0; t < 4 * 8; t++) {
          bridge.advance(1);
          await settle();
          out.push({ z: game.state.player.z, ...soilPixels() });
        }
        bridge.release(dir);
        bridge.advance(16);
      }
      return out;
    } finally {
      field.dispose();
      db.close();
    }
  });
  console.log(counts.map((c) => `${c.z}:${c.n}`).join(' '));
  expect(counts.every((c) => c.soil > 0), 'the plot has soil models').toBe(true);
  // The plot slides over the screen and under the player, so the count drifts a little from frame to frame; a depth
  // fight drops whole soil models from one frame to the next.
  const max = Math.max(...counts.map((c) => c.n));
  expect(max).toBeGreaterThan(1000);
  for (const [i, c] of counts.entries()) {
    expect(c.n / max, `soil pixels at z ${c.z}`).toBeGreaterThan(0.7);
    if (i > 0) expect(Math.abs(c.n - counts[i - 1]!.n) / max, `soil pixels change at z ${c.z} (frame ${i})`).toBeLessThan(0.1);
  }
});

const REFLECTIVE = ['PUDDLE', 'PUDDLE_NO_SPLASHING', 'WATER_RIVER', 'REFLECTIVE'];

/**
 * `whole`: the water reaches past the reflections' lower ends (the characters stand on the top row of a puddle 3 rows
 * long), so each shows its whole height on screen. Elsewhere the puddle's far rim, the river bank in front or the
 * floor's opaque texels hide part of it, as on the DS.
 */
const SCENES: { name: string; lines: string[]; actors: number; whole?: true }[] = [
  {
    // The player and the follower (Infernape) stand in the 4×3 puddle.
    name: 'solaceon-puddle',
    lines: ['party 0 platinum:SPECIES_INFERNAPE 50', 'set state repel 250', 'warp platinum:MAP_HEADER_SOLACEON_TOWN 546 655 down', 'until idle', '+0 press down', 'until position 546 657', '+0 release down', 'until idle'],
    actors: 2,
  },
  {
    // The player on the tile north of the puddle, facing it; the follower stands to the left.
    name: 'solaceon-puddle-edge',
    lines: ['party 0 platinum:SPECIES_INFERNAPE 50', 'set state repel 250', 'warp platinum:MAP_HEADER_SOLACEON_TOWN 543 656 right', 'until idle', '+0 press right', 'until position 546 656', '+0 release right', 'until idle', '+0 press down', '+1 release down', 'until idle', '+0 assert state player.facing "down"', '+0 assert state player.z 656'],
    actors: 2,
    whole: true,
  },
  {
    // Pastoria City's puddle, whose bed lies 16 units under the water (Solaceon's lies 32 under): the player on its
    // top row facing down, the follower to the left.
    name: 'pastoria-puddle',
    lines: ['party 0 platinum:SPECIES_INFERNAPE 50', 'set state repel 250', 'warp platinum:MAP_HEADER_PASTORIA_CITY 576 845 right', 'until idle', '+0 press right', 'until position 579 845', '+0 release right', 'until idle', '+0 press down', '+1 release down', 'until idle', '+0 assert state player.facing "down"', '+0 assert state player.z 845'],
    actors: 2,
    whole: true,
  },
  {
    // On the bank north of the river.
    name: 'twinleaf-river',
    lines: ['warp platinum:MAP_HEADER_TWINLEAF_TOWN 110 888 down', 'until idle', '+0 press down', 'until position 110 890', '+0 release down', 'until idle'],
    actors: 1,
  },
  {
    // On the ruins' reflective floor.
    name: 'iron-ruins-floor',
    lines: ['warp platinum:MAP_HEADER_IRON_RUINS 7 3 down', 'until idle', '+0 press down', 'until position 7 7', '+0 release down', 'until idle'],
    actors: 1,
  },
];

for (const scene of SCENES) {
  test(`reflections show only over the reflective tiles: ${scene.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await play(page, scene.name, scene.lines);
    await waitForScene(page);
    await page.screenshot({ path: `${SHOTS}/${scene.name}-app.png` });
    const result = await page.evaluate(
      async ({ reflective }) => {
        const three = (await new Function('return import("/__test/three.js")')()) as typeof import('three');
        const store = (await new Function('return import("/__test/store.js")')()) as typeof import('../../packages/app/src/store.ts');
        const { importedSource } = (await new Function('return import("/__test/pack-source.js")')()) as typeof import('../../packages/app/src/pack-source.ts');
        const { mountFieldRenderer } = (await new Function('return import("/__test/renderer.js")')()) as typeof import('../../packages/render/src/renderer.ts');
        const db = await store.openDb();
        const source = await importedSource(db, (await store.listImports(db))[0]!.key);
        const game = window.openSinnohApp!.game;
        const canvas = document.createElement('canvas');
        const field = await mountFieldRenderer(canvas, { world: game.world, registries: game.registries, state: game.state, assets: source.assets, log: game.log });
        field.resize(1280, 720, 1);
        const internals = field as unknown as {
          actors: Map<string, { kind: string; reflection?: THREE.Sprite }>;
          grid: { behaviour(x: number, z: number): string };
          camera: THREE.Camera;
        };
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const g = copy.getContext('2d', { willReadFrequently: true })!;
        const frame = () => {
          field.render(1);
          g.drawImage(canvas, 0, 0);
          return g.getImageData(0, 0, copy.width, copy.height).data;
        };
        try {
          // Loading is read right after a render, as in the soil test.
          const deadline = performance.now() + 60_000;
          for (;;) {
            field.render(1);
            if (!field.loading()) break;
            if (performance.now() > deadline) throw new Error('the scene did not finish loading');
            await new Promise(requestAnimationFrame);
          }
          const reflections = [...internals.actors.values()].flatMap((a) => (a.reflection?.visible ? [a.reflection] : []));
          const shown = frame();
          const image = copy.toDataURL();
          for (const r of reflections) r.material.visible = false;
          const hidden = frame();
          for (const r of reflections) r.material.visible = true;
          /** Rows of the frame where `a` and `b` differ. */
          const rows = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
            let n = 0;
            for (let y = 0; y < copy.height; y++) {
              for (let x = 0; x < copy.width; x++) {
                const k = (y * copy.width + x) * 4;
                if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2]) {
                  n++;
                  break;
                }
              }
            }
            return n;
          };
          // Each reflection's height on screen: the rows it shows against the rows it covers drawn over everything.
          // The characters' sprites are left out: only the map may hide a reflection.
          const sprites = [...internals.actors.values()].flatMap((a) => (a.kind === 'billboard' ? [(a as unknown as { object: THREE.Sprite }).object] : []));
          for (const o of sprites) o.material.visible = false;
          const bare = frame();
          const heights = reflections.map((r) => {
            r.material.visible = false;
            const without = frame();
            r.material.visible = true;
            const seen = rows(bare, without);
            r.material.depthTest = false;
            const whole = rows(frame(), without);
            r.material.depthTest = true;
            return { seen, whole };
          });
          for (const o of sprites) o.material.visible = true;
          // Each reflection pixel's view ray meets the reflective surface (the player's ground) over a tile.
          const ground = game.world.view().actors.find((a) => a.localId === 255)!.cur[1];
          const camera = internals.camera;
          let inside = 0;
          const outside: [number, number, string][] = [];
          for (let y = 0; y < copy.height; y++) {
            for (let x = 0; x < copy.width; x++) {
              const k = (y * copy.width + x) * 4;
              if (shown[k] === hidden[k] && shown[k + 1] === hidden[k + 1] && shown[k + 2] === hidden[k + 2]) continue;
              const ndc = new three.Vector3(((x + 0.5) / copy.width) * 2 - 1, 1 - ((y + 0.5) / copy.height) * 2, -1);
              const near = ndc.clone().unproject(camera);
              const far = ndc.setZ(1).unproject(camera);
              const hit = near.clone().lerp(far, (ground - near.y) / (far.y - near.y));
              const behaviour = internals.grid.behaviour(Math.floor(hit.x / 16), Math.floor(hit.z / 16));
              if (reflective.includes(behaviour)) inside++;
              else outside.push([x, y, behaviour]);
            }
          }
          return { reflections: reflections.length, inside, outside: outside.length, sample: outside.slice(0, 8), heights, image };
        } finally {
          field.dispose();
          db.close();
        }
      },
      { reflective: REFLECTIVE },
    );
    const { image, ...counts } = result;
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/${scene.name}.png`, Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
    console.log(scene.name, JSON.stringify(counts));
    expect(result.reflections, 'reflections drawn').toBe(scene.actors);
    expect(result.inside, 'reflection pixels over the reflective tiles').toBeGreaterThan(200);
    expect(result.outside, 'reflection pixels over other tiles').toBe(0);
    // Rows of each reflection the map leaves visible, against its rows drawn over everything (sprites left out).
    if (scene.whole) for (const [i, h] of result.heights.entries()) expect(h.seen / h.whole, `reflection ${i} height shown`).toBeGreaterThan(0.9);
  });
}
