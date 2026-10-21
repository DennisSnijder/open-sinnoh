/**
 * Billboards under the area light (OPENSINNOH_NDS_ROM; desktop). On the DS the map objects and the
 * billboard field effects use the global material colours of the area light template (lighting.ts
 * billboardLight), so the player, an NPC, the follower and the tall grass at the player's feet darken
 * with the map in the evening and at night. Each is drawn alone, sprites only, at noon, in the evening
 * and at night (the clock is frozen, the game is not stepped between frames, so only the light
 * changes), and its pixel sums per channel must change by the ratio of the templates' billboard colours.
 * Screenshots go to test-artifacts/sprite-lighting (gitignored: ROM content, never commit).
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Light, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { billboardLight, lightAt } from '../../packages/render/src/lighting.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/sprite-lighting';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'one viewport is enough for the lighting');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

/** What a capture keeps of the view: one actor (by local id) or the field effects alone. */
type Subject = { actor: number } | { effects: true };

/** Per-channel sums of the pixels that differ from the empty sprites-only frame, for each subject. */
async function capture(subjects: Subject[]): Promise<{ sums: [number, number, number][]; counts: number[] }> {
  await waitForScene(page);
  return page.evaluate(async (subjects) => {
    const world = window.openSinnohApp!.game.world;
    const view = world.view.bind(world);
    const debug = (globalThis as unknown as { openSinnohRenderDebug: { edges: boolean; spritesOnly: boolean } }).openSinnohRenderDebug;
    const frame = async () => {
      // Two frames: the first may still load a drawable.
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    debug.edges = false;
    debug.spritesOnly = true;
    try {
      world.view = () => ({ ...view(), actors: [], previews: [], effects: [] });
      const empty = await frame();
      const sums: [number, number, number][] = [];
      const counts: number[] = [];
      for (const s of subjects) {
        world.view = () => {
          const v = view();
          return 'actor' in s ? { ...v, actors: v.actors.filter((a) => a.localId === s.actor), previews: [], effects: [] } : { ...v, actors: [], previews: [] };
        };
        const px = await frame();
        const sum: [number, number, number] = [0, 0, 0];
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] === empty[i] && px[i + 1] === empty[i + 1] && px[i + 2] === empty[i + 2]) continue;
          n++;
          for (let k = 0; k < 3; k++) sum[k]! += px[i + k]! - empty[i + k]!;
        }
        sums.push(sum);
        counts.push(n);
      }
      return { sums, counts };
    } finally {
      world.view = view;
      debug.edges = true;
      debug.spritesOnly = false;
    }
  }, subjects);
}

test('the player, an NPC, the follower and the tall grass take the area light at noon, in the evening and at night', async () => {
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const driver = pageDriver(page, SHOTS, 'route-201');
  await driver.reset(1);
  // Route 201 with Turtwig following: the player walks into the tall grass east of the path, Barry stands by
  // the sign. The Repel keeps wild Pokémon away; the default frozen clock is 12:00.
  const replay = [
    'party 0 platinum:SPECIES_TURTWIG 20',
    'set state repel 250',
    'warp platinum:MAP_HEADER_ROUTE_201 110 857 up',
    'until idle',
    '+0 press up',
    'until position 110 854',
    '+0 release up',
    '+0 press right',
    'until position 117 854',
    '+0 release right',
    'until idle',
    '+30 assert map platinum:MAP_HEADER_ROUTE_201',
    '',
  ].join('\n');
  const r = await runReplay(driver, replay, { registries });
  expect(r.error).toBeUndefined();
  // The runner ends with a save round trip, whose load fades the map in again: wait it out.
  for (let i = 0; i < 120 && (await driver.snapshot()).fade; i++) await driver.advance(1);
  expect((await driver.snapshot()).fade).toBeNull();
  await waitForScene(page);
  const scene = await page.evaluate(() => {
    const v = window.openSinnohApp!.game.world.view();
    return { area: v.area, actors: v.actors.map((a) => ({ localId: a.localId, sprite: a.sprite })), effects: v.effects.map((e) => ({ effect: e.effect, at: e.cur })), player: v.actors.find((a) => a.localId === 255)!.cur };
  });
  const npc = scene.actors.find((a) => a.sprite === 'platinum:OBJ_EVENT_GFX_BARRY')!;
  expect(npc, 'Barry stands on Route 201').toBeDefined();
  expect(scene.actors.some((a) => a.localId === 256), 'the follower is out').toBe(true);
  // The grass at the player's feet is the only effect on screen near them (the others rustle under NPCs off screen).
  expect(scene.effects.some((e) => e.effect === 'platinum:FIELD_EFFECT_TALL_GRASS' && e.at[0] === scene.player[0] && e.at[2] === scene.player[2]), 'the player stands in tall grass').toBe(true);
  const subjects: { name: string; subject: Subject }[] = [
    { name: 'player', subject: { actor: 255 } },
    { name: 'npc', subject: { actor: npc.localId } },
    { name: 'follower', subject: { actor: 256 } },
    { name: 'grass', subject: { effects: true } },
  ];
  const light = registries.lights.get(registries.areas.get(scene.area as Id)!.light)! as Light;
  const times = { noon: '12:00', evening: '18:15', night: '22:00' } as const;
  const measured: Record<string, Awaited<ReturnType<typeof capture>>> = {};
  const expected: Record<string, [number, number, number]> = {};
  mkdirSync(SHOTS, { recursive: true });
  for (const [name, time] of Object.entries(times)) {
    await driver.setClock(undefined, time);
    const [h, m] = time.split(':').map(Number) as [number, number];
    expected[name] = billboardLight(lightAt(light, h * 3600 + m * 60).template);
    measured[name] = await capture(subjects.map((s) => s.subject));
    await page.screenshot({ path: `${SHOTS}/route-201-${name}.png` });
  }
  await driver.setClock(undefined, '12:00');
  for (const [i, { name }] of subjects.entries()) {
    expect(measured.noon!.counts[i], `${name} is drawn`).toBeGreaterThan(50);
    for (const period of ['evening', 'night'] as const) {
      // The same pixels (nothing moved), each channel scaled by the templates' billboard colours.
      expect(measured[period]!.counts[i]).toBe(measured.noon!.counts[i]);
      const got = measured[period]!.sums[i]!.map((v, k) => v / measured.noon!.sums[i]![k]!);
      const want = expected[period]!.map((v, k) => v / expected.noon![k]!);
      console.log(`${name} ${period}/noon: got ${got.map((v) => v.toFixed(3))}, DS ${want.map((v) => v.toFixed(3))}`);
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - want[k]!), `${name} ${period} channel ${k}`).toBeLessThan(0.015);
    }
  }
  expect(errors).toEqual([]);
});
