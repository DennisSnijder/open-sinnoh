/**
 * The field's reveal after a map load (OPENSINNOH_NDS_ROM; desktop and phone): CONTINUE (first start and a reload), a
 * save file imported in the field, and a door warp out to Hearthome City. Every frame the field canvas is sampled (a
 * coarse grid of its pixels) with the world's fade, whether the scene in view is still loading, and the zone. The field
 * stays black until its scene is in, then the DS fade-in runs over the finished scene; no frame shows the field while it
 * loads, and nothing appears after the reveal: each fade frame is the revealed scene under the fade's black, and with
 * nothing moving, each later frame is the settled scene (people walking and animations aside).
 */
import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { romContext, resetRomDevice } from './rom-context.ts';
import { openOptionsData, saveSlot } from './save.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

/** Hearthome City: a big town, many buildings, props and people in view. */
const CITY = 'platinum:MAP_HEADER_HEARTHOME_CITY';
/** Its Pokémon Center: the door warp out to the city. */
const CENTER = 'platinum:MAP_HEADER_HEARTHOME_CITY_POKECENTER_1F';
const GRID_W = 48;
const GRID_H = 36;
/** A grid cell differs when a channel is off by more than this. */
const TOLERANCE = 40;
/** The share of grid cells that may differ (people walking, water and flowers animating). */
const MAX_CHANGED = 0.06;

interface Sample {
  /** performance.now(), ms. */
  t: number;
  zone: string;
  /** The world's fade: 1 is full, null none. */
  fade: number | null;
  loading: boolean;
  /** GRID_W × GRID_H RGB, row by row. */
  px: number[];
}

let context: BrowserContext;
let page: Page;
const errors: string[] = [];
const timings: Record<string, number> = {};

/**
 * Keeps the field's WebGL buffer after each frame (so a sample reads the last frame drawn) and samples it once per
 * drawn field frame from the page's start (`__reveal.start()` starts again).
 */
function installSampler(page: Page) {
  return page.addInitScript(({ w, h }) => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: object) {
      if (this.id === 'main-canvas' && type.startsWith('webgl')) attrs = { ...attrs, preserveDrawingBuffer: true };
      return getContext.call(this, type, attrs) as never;
    } as typeof getContext;
    const samples: unknown[] = [];
    let last = -1;
    const grid = document.createElement('canvas');
    grid.width = w;
    grid.height = h;
    const g = grid.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    const sample = () => {
      requestAnimationFrame(sample);
      const stats = (globalThis as { openSinnohRenderStats?: { frames: number } }).openSinnohRenderStats;
      const app = window.openSinnohApp;
      // A newly drawn field frame (the stats belong to the latest mounted field: none drawn yet, the canvas still
      // holds the last one's), not the title's.
      if (!stats || !app || document.getElementById('title') || stats.frames === last || stats.frames === 0) return;
      last = stats.frames;
      g.drawImage(document.getElementById('main-canvas') as HTMLCanvasElement, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h).data;
      const px: number[] = [];
      for (let i = 0; i < data.length; i += 4) px.push(data[i]!, data[i + 1]!, data[i + 2]!);
      samples.push({ t: performance.now(), zone: app.game.state.player.zone, fade: app.game.world.fadeState()?.alpha ?? null, loading: app.sceneLoading(), px });
    };
    requestAnimationFrame(sample);
    (window as unknown as { __reveal: object }).__reveal = {
      start: () => {
        samples.length = 0;
        last = -1;
      },
      take: () => samples.splice(0),
    };
  }, { w: GRID_W, h: GRID_H });
}

const startSampling = () => page.evaluate(() => (window as unknown as { __reveal: { start(): void } }).__reveal.start());
const takeSamples = () => page.evaluate(() => (window as unknown as { __reveal: { take(): unknown[] } }).__reveal.take()) as Promise<Sample[]>;

/** Share of grid cells where `a` differs from `b` darkened by the fade `k` (0 none, 1 black). */
function changed(a: number[], b: number[], k: number): number {
  const s = 1 - k;
  let n = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i]! - b[i]! * s) > TOLERANCE || Math.abs(a[i + 1]! - b[i + 1]! * s) > TOLERANCE || Math.abs(a[i + 2]! - b[i + 2]! * s) > TOLERANCE) n++;
  }
  return n / (a.length / 3);
}

const lit = (px: number[]) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 3) if (px[i]! + px[i + 1]! + px[i + 2]! > 24) n++;
  return n / (px.length / 3);
};

/** Field frames drawn after the reveal before the samples are taken (a quarter of a second at 60 Hz). */
const SETTLED_FRAMES = 15;

/** Until the fade is over, the scene in view is in and more field frames are drawn: the reveal's frames. */
async function settle(): Promise<Sample[]> {
  const frames = await page.waitForFunction(() => {
    const app = window.openSinnohApp;
    const done = !!app && !document.getElementById('title') && app.game.world.fadeState() === null && !app.sceneLoading();
    return done && (globalThis as { openSinnohRenderStats?: { frames: number } }).openSinnohRenderStats!.frames;
  }, undefined, { timeout: 120_000 });
  // Counted in drawn frames, not time: a busy machine draws few frames a second.
  await page.waitForFunction((n) => (globalThis as { openSinnohRenderStats?: { frames: number } }).openSinnohRenderStats!.frames >= n, Number(await frames.jsonValue()) + SETTLED_FRAMES, { timeout: 120_000 });
  return takeSamples();
}

/**
 * The reveal in `samples` from the map load into `zone`: black while the scene loads, the fade over the finished
 * scene, nothing appearing after it. `still`: nothing moves after the fade (no walk out of a door), so every later
 * frame equals the settled one too.
 */
function checkReveal(label: string, all: Sample[], zone: string, still: boolean) {
  // From the load: the first frame in the zone under the full fade it starts with.
  const load = all.findIndex((s) => s.zone === zone && s.fade === 1);
  expect(load, `${label}: no load into ${zone} sampled`).toBeGreaterThanOrEqual(0);
  const samples = all.slice(load);
  const first = samples.findIndex((s) => lit(s.px) > 0.01);
  expect(first, `${label}: the field never showed`).toBeGreaterThanOrEqual(0);
  const shown = samples.slice(first);
  const revealed = shown.find((s) => s.fade === null)!;
  const settled = samples.at(-1)!;
  // Each fade frame: the revealed scene under the fade.
  const fading = shown.filter((s) => s.fade !== null);
  const fadeDiff = Math.max(0, ...fading.map((s) => changed(s.px, revealed.px, s.fade!)));
  const afterDiff = still ? Math.max(0, ...shown.filter((s) => s.fade === null).map((s) => changed(s.px, settled.px, 0))) : 0;
  const result = {
    label,
    blackFrames: first,
    // From the load's first drawn frame to the first that shows the field: the wait for the scene.
    waitMs: Math.round(shown[0]!.t - samples[0]!.t),
    fadeFrames: fading.length,
    fadeMs: Math.round(revealed.t - shown[0]!.t),
    loadingShown: shown.filter((s) => s.loading).length,
    fadeDiff: +fadeDiff.toFixed(3),
    afterDiff: +afterDiff.toFixed(3),
  };
  console.log(JSON.stringify(result));
  timings[label] = result.waitMs;
  expect(result.loadingShown, `${label}: frames that show the field while its scene loads`).toBe(0);
  // The field shows under the fade (8 ticks: about 7 frames at 60 Hz, fewer on a busy machine), not at once.
  expect(result.fadeFrames, `${label}: the fade-in runs`).toBeGreaterThanOrEqual(1);
  expect(result.fadeDiff, `${label}: a fade frame is not the revealed scene (pop-in)`).toBeLessThan(MAX_CHANGED);
  expect(result.afterDiff, `${label}: a frame after the fade is not the settled scene (pop-in)`).toBeLessThan(MAX_CHANGED);
}

/** On the replay bridge: the new game's state arrived at a tile and played to an idle field, written to the save slot. */
async function saveAt(zone: string, x: number, z: number, facing: 'up' | 'down'): Promise<void> {
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(
    async ({ zone, x, z, facing }) => {
      const g = window.openSinnohGame!;
      const state = g.snapshot().state;
      state.player = { ...state.player, zone: zone as typeof state.player.zone, x, z, y: 0, facing };
      state.objects = [];
      state.follower = null;
      state.partyFollower = null;
      await g.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }), 'arrival');
      let calm = 0;
      for (let i = 0; i < 3000 && calm < 30; i++) {
        const s = g.snapshot();
        calm = !s.scriptRunning && window.openSinnohApp!.game.canSave() ? calm + 1 : 0;
        if (s.view.message?.waitingForInput || s.view.yesNo) {
          g.press('a');
          g.advance(1);
          g.release('a');
        }
        g.advance(1);
      }
      if (calm < 30) throw new Error(`${zone} did not settle`);
    },
    { zone, x, z, facing },
  );
  await saveSlot(page);
}

/** The save slot's text. */
const slot = () =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get('main');
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result as string);
          };
        };
      }),
  );

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000);
  const use = info.project.use;
  // The worker's seeded context (rom-context.ts): the import is copied into the browser once per worker, not per file.
  context = await romContext(browser, use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await installSampler(page);
  await resetRomDevice(page);
});

test.afterAll(async () => {
  console.log(`reveal waits (ms): ${JSON.stringify(timings)}`);
  await page?.close();
});

test('CONTINUE: black until the scene is in, then the fade, then no pop-in', async () => {
  // Two reveals, each counted in frames, which a loaded machine draws a few a second.
  test.setTimeout(420_000);
  await saveAt(CITY, 504, 726, 'up');
  // The installed app's Continue shortcut: the title's CONTINUE without its menu. The first start after the import.
  await page.goto('/?continue&time=12:00');
  checkReveal('continue', await settle(), CITY, true);
  // Again, the browser's caches warm.
  await page.reload();
  checkReveal('continue (reload)', await settle(), CITY, true);
  expect(errors).toEqual([]);
});

test('a save file imported in the field: the same reveal', async () => {
  test.setTimeout(240_000);
  // Its own save and field (the test runs alone too).
  await saveAt(CITY, 504, 726, 'up');
  await page.goto('/?continue&time=12:00');
  await settle();
  const file = test.info().outputPath('save.json');
  writeFileSync(file, await slot());
  await openOptionsData(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-screen="options"] [data-setting="importSave"] .options-value').click()]);
  await chooser.setFiles(file);
  await startSampling();
  await page.locator('[data-tap="settings:answer:yes"]').click();
  await expect(page.locator('.ui-notice')).toContainText(appStrings().game.loadedSave);
  checkReveal('import', await settle(), CITY, true);
  expect(errors).toEqual([]);
});

test('a door warp out to the city: its scene is in before the fade-in', async () => {
  test.setTimeout(240_000);
  // On the Pokémon Center's door mat, facing out.
  await saveAt(CENTER, 8, 11, 'down');
  await page.goto('/?continue&time=12:00');
  await settle();
  await startSampling();
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction((zone) => window.openSinnohApp!.game.state.player.zone === zone, CITY, { timeout: 30_000 });
  await page.keyboard.up('ArrowDown');
  // The player walks out of the door after the fade: the frames after it move with the camera.
  checkReveal('door warp', await settle(), CITY, false);
  expect(errors).toEqual([]);
});
