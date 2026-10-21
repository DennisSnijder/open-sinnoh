/**
 * The Twinleaf Town / Route 201 border is seamless (OPENSINNOH_NDS_ROM; skipped without it): walking across it
 * and back one tick at a time, no object on screen loses its drawable or gets a new one in any frame.
 * Twinleaf's guitarist and Route 201's arrow signpost are listed in both zones (clone objects); a zone
 * connection once deleted and respawned them and handed each one's drawable to the other, so both
 * vanished for a frame at every crossing.
 *
 * Both projects run it: the desktop view is wider than the DS's, the phone's (390×844) much taller, so
 * each sees objects the DS deletes and spawns at a crossing. In the whole viewport no drawable may
 * appear or disappear while on screen: the renderer keeps a deleted object drawn until it is off screen
 * (`FieldView.departed`) and draws the neighbouring zone's objects before they spawn (`.previews`).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameSnapshot } from '@opensinnoh/contracts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { romContext, resetRomDevice } from './rom-context.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  const use = info.project.use;
  context = await romContext(browser, use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.beforeEach(async () => {
  errors.length = 0;
  await page.evaluate(() => window.openSinnohGame!.reset(1));
});

test.afterAll(async () => {
  await page?.close();
});

interface Frame {
  tick: number;
  zone: string;
  player: [number, number];
  actors: { key: string; sprite: string; at: [number, number, number]; visible: boolean; object: string | null; kind: 'live' | 'departed' | 'preview'; onScreen: boolean }[];
}

test('walking over the Twinleaf / Route 201 border and back: no object on screen vanishes or is rebuilt', async () => {
  test.setTimeout(420_000);

  // A new game, moved onto Twinleaf's path south of the border (z 864); Route 201's starter triggers are north of z 859.
  const { state } = JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;
  const moved = { ...state, player: { zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN', x: 112, z: 866, y: 0, facing: 'up' }, objects: [], follower: null };
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: moved }));
  await page.evaluate(() => window.openSinnohGame!.setWildBattles('flee'));
  await waitForScene(page);

  const frames = await page.evaluate(async () => {
    type Stats = { frames: number; actors: Frame['actors'] };
    const stats = (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats;
    const app = window.openSinnohApp!;
    const game = window.openSinnohGame!;
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const out: Frame[] = [];
    // North to z 859 and back to 866, twice: four crossings.
    const legs: ['up' | 'down', number][] = [['up', 859], ['down', 866], ['up', 859], ['down', 866]];
    for (const [dir, goal] of legs) {
      game.press(dir);
      let held = true;
      for (let i = 0; i < 200 && (held || !app.game.canSave()); i++) {
        // The step onto the goal tile has started: let go so it ends there.
        if (held && app.game.state.player.z === goal) {
          game.release(dir);
          held = false;
        }
        const before = stats.frames;
        game.advance(1);
        // The frame drawn right after this tick: the loop's render runs before this callback.
        await frame();
        if (stats.frames === before) throw new Error('no frame was drawn');
        const p = app.game.state.player;
        out.push({ tick: app.game.state.tick, zone: p.zone, player: [p.x, p.z], actors: stats.actors.map((a) => ({ ...a, at: [...a.at] as [number, number, number] })) });
      }
      if (held) throw new Error(`never reached z ${goal}: ${JSON.stringify(app.game.state.player)}`);
    }
    return out;
  });

  // The DS view: 16×12 tiles around the player (and a tile for sprite height). Platinum lists every object
  // within it of a border in the neighbouring zone too (a clone), so the DS screen never sees the old
  // zone's objects deleted or the new zone's spawned. A taller screen (the phone) shows more: there the
  // DS's own deletes and spawns are visible, and are not this test's subject.
  const onScreen = (f: Frame, at: [number, number, number]) => Math.abs(at[0] / 16 - (f.player[0] + 0.5)) <= 9 && Math.abs(at[2] / 16 - (f.player[1] + 0.5)) <= 7;

  const zones = frames.map((f) => f.zone);
  const crossings = frames.filter((_, i) => i > 0 && zones[i] !== zones[i - 1]);
  expect(crossings.map((f) => f.zone), 'border crossings').toEqual(['platinum:MAP_HEADER_ROUTE_201', 'platinum:MAP_HEADER_TWINLEAF_TOWN', 'platinum:MAP_HEADER_ROUTE_201', 'platinum:MAP_HEADER_TWINLEAF_TOWN']);
  // The two objects listed in both zones are drawn in the frame of every crossing.
  for (const sprite of ['platinum:OBJ_EVENT_GFX_GUITARIST', 'platinum:OBJ_EVENT_GFX_ARROW_SIGNPOST']) {
    for (const f of crossings) expect(f.actors.some((a) => a.sprite === sprite && a.visible && a.object), `${sprite} drawn at tick ${f.tick}`).toBe(true);
  }

  // An object drawn on screen in one frame is drawn by the same scene object in the next, unless the
  // world removed it (deleted with the old zone, nothing of its sprite left at that place).
  const problems: string[] = [];
  for (let i = 1; i < frames.length; i++) {
    const [was, now] = [frames[i - 1]!, frames[i]!];
    for (const a of was.actors) {
      if (!a.object || !a.visible || !onScreen(was, a.at)) continue;
      const same = now.actors.filter((b) => b.sprite === a.sprite && b.visible && Math.hypot(b.at[0] - a.at[0], b.at[2] - a.at[2]) <= 16);
      if (same.length === 0) {
        problems.push(`tick ${now.tick} (${now.zone}): ${a.sprite} at ${a.at.map((v) => v / 16)} left the view`);
        continue;
      }
      if (!same.some((b) => b.object === a.object)) problems.push(`tick ${now.tick} (${now.zone}): ${a.sprite} at ${a.at.map((v) => v / 16)} ${same.some((b) => b.object) ? 'rebuilt' : 'not drawn'}`);
    }
  }
  expect(problems).toEqual([]);

  // The whole viewport: a drawable on screen in one frame is still drawn in the next (it leaves only by
  // moving off screen first), and one on screen was drawn in the frame before (nothing pops in).
  const drawn = (f: Frame) => new Map(f.actors.filter((a) => a.object && a.visible).map((a) => [a.object!, a]));
  const pops: string[] = [];
  for (let i = 1; i < frames.length; i++) {
    const [was, now] = [drawn(frames[i - 1]!), drawn(frames[i]!)];
    const where = (a: Frame['actors'][number]) => `${a.kind} ${a.sprite} at ${a.at.map((v) => Math.round(v / 16))}`;
    for (const a of was.values()) if (a.onScreen && !now.has(a.object!)) pops.push(`tick ${frames[i]!.tick}: ${where(a)} disappeared on screen`);
    for (const b of now.values()) if (b.onScreen && !was.has(b.object!)) pops.push(`tick ${frames[i]!.tick}: ${where(b)} appeared on screen`);
  }
  expect(pops).toEqual([]);
  // The renderer's on-screen test agrees with the DS view (which every viewport contains).
  for (const f of frames) for (const a of f.actors) if (onScreen(f, a.at)) expect(a.onScreen, `${a.sprite} at tick ${f.tick} is on screen`).toBe(true);
  if (test.info().project.name === 'phone') {
    // The tall view sees the DS's deletes and spawns: both kinds of stand-in were drawn on screen.
    for (const kind of ['departed', 'preview']) expect(frames.some((f) => f.actors.some((a) => a.kind === kind && a.onScreen && a.object)), `a ${kind} object drawn on screen`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('Route 204 draws neighbouring NPC stand-ins once, including after their live NPC moves', async () => {
  test.setTimeout(180_000);
  for (const [zone, x, z] of [
    ['platinum:MAP_HEADER_ROUTE_204_SOUTH', 174, 707],
    ['platinum:MAP_HEADER_ROUTE_204_NORTH', 175, 699],
  ] as const) {
    const { state } = JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;
    state.player = { zone, x, z, y: 0, facing: 'up' };
    state.objects = [];
    state.follower = null;
    await page.evaluate(json => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }));
    await waitForScene(page);
    for (let tick = 0; tick < 20; tick++) {
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      const actors = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        return (globalThis as unknown as { openSinnohRenderStats: { actors: Frame['actors'] } }).openSinnohRenderStats.actors;
      });
      const live = actors.filter(a => a.kind === 'live' && a.visible && a.object);
      expect(live.length).toBeGreaterThan(5);
      const doubles = actors.filter(a => a.kind !== 'live' && a.visible && a.object && live.some(b => b.sprite === a.sprite && Math.hypot(b.at[0] - a.at[0], b.at[2] - a.at[2]) <= 24));
      expect(doubles, `${zone}, frame ${tick}: no frozen copy beside a live NPC`).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});
