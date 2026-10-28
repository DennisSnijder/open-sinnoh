/**
 * The first playable slice (new game, the field, scripts, menus, saves) in the real app on the real ROM
 * (OPENSINNOH_NDS_ROM; skipped without it), at both Playwright projects (1280×720, 390×844):
 * pick the ROM → SHA-1 + progress, the first-run setup during the import, Start playing → IndexedDB import → bedroom; the opening replay
 * (tests/rom-replays/opening.replay) through `window.openSinnohGame`, with a screenshot and a pixel check
 * at every beat (the phone picks the starter by tapping its ball in the briefcase scene); reload reuses the import;
 * save → export file → reload → import file restores the state.
 * Screenshots go to test-artifacts/platinum (gitignored: ROM content, never commit).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import type { GameSnapshot, GameState, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay, type ReplayDriver } from '@opensinnoh/game';
import { romSha1, romSlice } from '../rom.ts';
import { anchoredDriver, chainAnchor } from '../integration/checkpoints-anchors.ts';
import { fromChainAnchor } from './replay-anchor.ts';
import { settle } from './settle.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';
import { mainCanvasStats, pageDriver, REPO_ROOT, waitForScene } from '../../packages/cli/src/browser.ts';
import { aroundBattleWindow, battleRegionLight, battleSceneStats, canvasStats } from './canvas.ts';
import { openData, pressData, saveSlot } from './save.ts';
import { seedRomImport } from './seed.ts';
import { freshRomPage } from './rom-context.ts';
import { selectBall, starterReady, starterSprite, tapBall } from './starter.ts';
import { appStrings } from './words.ts';
import { strings } from '../../packages/app/src/strings/index.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/platinum';
const PIPLUP = 2;


test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let contextOptions: BrowserContextOptions;
let pickerContext: BrowserContext | undefined;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browserName: _ }, info) => {
  test.setTimeout(120_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  contextOptions = { baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, acceptDownloads: true };
});

test.beforeEach(async ({ browser }, info) => {
  test.setTimeout(120_000);
  errors.length = 0;
  // Share only imported files. Every test gets a fresh page, device defaults and game.
  // The picker proof gets its own empty database, even if test order changes.
  const picker = info.title.startsWith('pick the ROM:');
  pickerContext = picker ? await browser.newContext(contextOptions) : undefined;
  page = pickerContext ? await pickerContext.newPage() : await freshRomPage(browser, contextOptions);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (picker) return;
  await page.goto('/?replay');
  await waitForBridge();
});

test.afterEach(async () => {
  await page?.close();
  await pickerContext?.close();
});


const snapshot = async (): Promise<GameSnapshot> => JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;

/** An independent start at Lake Verity; no earlier browser test has to succeed. */
async function loadOpening(): Promise<GameState> {
  const save = await chainAnchor('opening.replay', 1);
  await anchoredDriver(pageDriver(page, SHOTS, test.info().project.name), save).reset(1);
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  return (JSON.parse(save) as { state: GameState }).state;
}

/** Waits for the scene, screenshots it and asserts the 3D view is visibly drawn. */
async function beat(name: string, project: string, field = true): Promise<void> {
  await waitForScene(page);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
  if (!field) return;
  const stats = await mainCanvasStats(page);
  expect(stats.colours, `${name}: colours`).toBeGreaterThan(8);
  expect(stats.litShare, `${name}: lit share`).toBeGreaterThan(0.1);
}

/**
 * Rowan's billboard is in the frame: hiding his actor in the view (no tick passes) changes the pixels.
 * Route 201 also lists the Sandgem signboard clone with Rowan's local id 5; the renderer once kept one
 * drawable per local id, and Rowan never showed.
 */
async function expectRowanDrawn(): Promise<void> {
  const shown = await page.locator('#main-canvas').screenshot();
  const hidden = await page.evaluate(() => {
    const world = window.openSinnohApp!.game.world as unknown as { view(): { actors: { sprite: string; visible: boolean }[] } };
    const view = world.view.bind(world);
    const n = view().actors.filter((a) => a.sprite === 'platinum:OBJ_EVENT_GFX_PROF_ROWAN' && a.visible).length;
    world.view = () => {
      const v = view();
      return { ...v, actors: v.actors.map((a) => (a.sprite === 'platinum:OBJ_EVENT_GFX_PROF_ROWAN' ? { ...a, visible: false } : a)) };
    };
    return n;
  });
  expect(hidden, 'one visible Rowan in the view').toBe(1);
  await waitForScene(page);
  const without = await page.locator('#main-canvas').screenshot();
  await page.evaluate(() => {
    delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view;
  });
  await waitForScene(page);
  expect(without.equals(shown), 'hiding Rowan changes the frame').toBe(false);
}

/**
 * What the map does to one character (sprite id ending in `sprite`), from four frames with no tick in
 * between: with and without that actor (patched view, as in expectRowanDrawn), each as usual and with
 * sprites only (`openSinnohRenderDebug.spritesOnly`: no map, shadows or reflections). Its silhouette is
 * where the sprites-only frames differ. `drawn`: silhouette pixels in the usual frame. `covered`:
 * silhouette pixels the map hides. `marked`: drawn pixels the map changes (map edges across it).
 * `edges` false leaves edge marking out of all four frames (`openSinnohRenderDebug.edges`): a near
 * polygon's edge line is blended over the far pixel behind it (DS anti-aliasing), so where a counter's
 * top edge crosses a character, the line takes the character's colours and is not "hidden" by the map.
 * The frames are the field canvas's own pixels, read in the frame it is drawn, not a screenshot: at render
 * scale Auto a phone draws the field at 2 device px per CSS px and the browser scales it to the screen, and
 * that filter spreads each edge line and sprite outline across the gaps beside it, past the edge ring.
 */
async function mapOverActor(sprite: string, edges = true): Promise<{ drawn: number; covered: number; marked: number }> {
  const setActorHidden = (hide: boolean) =>
    page.evaluate(
      ([s, h]) => {
        const world = window.openSinnohApp!.game.world as unknown as { view(): { actors: { sprite: string; visible: boolean }[] } };
        delete (world as { view?: unknown }).view;
        if (!h) return;
        const view = world.view.bind(world);
        world.view = () => {
          const v = view();
          return { ...v, actors: v.actors.map((a) => (a.sprite.endsWith(s) ? { ...a, visible: false } : a)) };
        };
      },
      [sprite, hide] as const,
    );
  const setSpritesOnly = (on: boolean) => page.evaluate((o) => void ((globalThis as unknown as { openSinnohRenderDebug: { spritesOnly: boolean } }).openSinnohRenderDebug.spritesOnly = o), on);
  const setEdges = (on: boolean) => page.evaluate((o) => void ((globalThis as unknown as { openSinnohRenderDebug: { edges: boolean } }).openSinnohRenderDebug.edges = o), on);
  const fieldPixels = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) =>
          requestAnimationFrame(() => {
            // After the game's draw in this frame, before the drawing buffer is presented and cleared.
            const src = document.getElementById('main-canvas') as HTMLCanvasElement;
            const copy = document.createElement('canvas');
            copy.width = src.width;
            copy.height = src.height;
            copy.getContext('2d')!.drawImage(src, 0, 0);
            resolve(copy.toDataURL('image/png').slice('data:image/png;base64,'.length));
          }),
        ),
    );
  await setEdges(edges);
  const shots: string[] = [];
  for (const only of [false, true])
    for (const actor of [false, true]) {
      await setSpritesOnly(only);
      await setActorHidden(actor);
      await waitForScene(page);
      shots.push(await fieldPixels());
    }
  await setSpritesOnly(false);
  await setActorHidden(false);
  await setEdges(true);
  await waitForScene(page);
  return page.evaluate(async ([pngs, edges]) => {
    const images = await Promise.all(
      pngs.map(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      }),
    );
    const { width, height } = images[0]!;
    const [shown, without, alone, empty] = images.map((m) => m.data) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
    const same = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) => a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2];
    const silhouette = new Uint8Array(width * height);
    for (let p = 0; p < silhouette.length; p++) silhouette[p] = same(alone, empty, p * 4) ? 0 : 1;
    // Its inside only: edge marking changes a one-DS-pixel ring around each sprite with what is next to it.
    // Without edges nothing does, and a counter cutting across the feet is counted to the outline.
    const ring = edges ? Math.ceil(width / height >= 4 / 3 ? height / 192 : width / 256) + 1 : 0;
    const inside = (x: number, y: number) => {
      for (let d = 1; d <= ring; d++)
        for (const [nx, ny] of [[x + d, y], [x - d, y], [x, y + d], [x, y - d]] as const) if (nx < 0 || ny < 0 || nx >= width || ny >= height || !silhouette[nx + ny * width]) return false;
      return true;
    };
    let drawn = 0;
    let covered = 0;
    let marked = 0;
    for (let p = 0; p < silhouette.length; p++) {
      if (!silhouette[p] || !inside(p % width, Math.floor(p / width))) continue;
      const i = p * 4;
      if (same(shown, without, i)) covered++;
      else {
        drawn++;
        if (!same(shown, alone, i)) marked++;
      }
    }
    return { drawn, covered, marked };
  }, [shots, edges] as const);
}

/** The map neither covers the character nor draws its edges across it. */
async function expectActorClear(sprite: string, where: string): Promise<void> {
  const r = await mapOverActor(sprite);
  expect(r.drawn, `${where}: ${sprite} is drawn`).toBeGreaterThan(100);
  expect({ covered: r.covered, marked: r.marked }, `${where}: the map over ${sprite} (${r.drawn} px drawn)`).toEqual({ covered: 0, marked: 0 });
}

/** Map geometry in front of the character (a rail, a counter) covers part of it (edge lines left out: see mapOverActor). */
async function expectActorCovered(sprite: string, where: string): Promise<void> {
  const r = await mapOverActor(sprite, false);
  expect(r.drawn, `${where}: ${sprite} is drawn`).toBeGreaterThan(100);
  expect(r.covered, `${where}: ${sprite} is partly covered (${r.drawn} px drawn)`).toBeGreaterThan(20);
}

/** Advances the game tick by tick, in one call (no frame per tick), until the field can save. */
async function untilCanSave(): Promise<void> {
  const idle = await page.evaluate(() => {
    for (let i = 0; i < 3000; i++) {
      if (window.openSinnohApp!.game.canSave()) return true;
      window.openSinnohGame!.advance(1);
    }
    return false;
  });
  expect(idle, 'the field becomes idle').toBe(true);
}

async function waitForBridge(): Promise<void> {
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
}

/** The real import: pick the ROM, SHA-1 check, progress, the import worker writes IndexedDB, the page reloads. */
async function importThroughPicker(project: string): Promise<void> {
  await page.goto('/?replay');
  await expect(page.locator('#picker')).toBeVisible();
  // Record every stage label the page shows: a stage can be shorter than a poll, so observe, don't sample.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { importStages: string[] }).importStages = seen;
    const el = document.getElementById('import-stage')!;
    new MutationObserver(() => {
      const t = el.textContent ?? '';
      if (seen[seen.length - 1] !== t) seen.push(t);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#rom-input').setInputFiles(ROM!);
  await expect(page.locator('#importing')).toBeVisible();
  // Verification (SHA-1) comes first, then the importer's own stages.
  const stages = () => page.evaluate(() => (window as unknown as { importStages: string[] }).importStages);
  await expect.poll(async () => (await stages()).some((t) => /SHA-1/.test(t)), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => {
    const s = await stages();
    const sha = s.findIndex((t) => /SHA-1/.test(t));
    return sha >= 0 && s.slice(sha + 1).some((t) => !/SHA-1|Reading/.test(t));
  }, { timeout: 120_000 }).toBe(true);
  await page.waitForFunction(() => Number(document.getElementById('import-progress')!.getAttribute('aria-valuenow') ?? 0) > 0 || document.getElementById('importing')!.hidden, undefined, { timeout: 120_000 });
  await page.screenshot({ path: `${SHOTS}/${project}-importing.png` });
  // The first-run setup runs during the import, and Start playing waits for the import (never pressed for the player).
  const wizard = page.locator('#wizard');
  const start = page.locator('#start-playing');
  await expect(wizard.locator('.fr-choices')).toHaveAttribute('data-question', 'addon');
  await expect(start).toHaveAttribute('aria-disabled', 'true');
  // No game is stored yet: the page speaks the browser's language (English: playwright.config.ts) until the import reloads it.
  const words = strings('en');
  await wizard.locator('.os-choice', { hasText: words.ask.addon.entries[1]!.label }).click();
  await wizard.locator('.os-choice', { hasText: words.ask.reports.entries[1]!.label }).click();
  await wizard.locator('.os-choice', { hasText: words.ask.textSpeed.entries[1]!.label }).click();
  await wizard.locator('.os-choice', { hasText: words.ask.visualStyle.entries[0]!.description }).click();
  await expect(wizard).toContainText(words.title.allSet);
  await expect(start).not.toHaveAttribute('aria-disabled', { timeout: 240_000 });
  await expect(page.locator('#base-job')).toContainText(words.rom.imported);
  await expect(page.locator('#importing')).toBeVisible();
  // Start playing → the title (the replay flag is dropped on the way).
  await start.click();
}

test('pick the ROM: SHA-1 check, progress, import into IndexedDB, new game in the bedroom', async () => {
  const info = test.info();
  test.setTimeout(300_000);
  if (info.project.name === 'phone') {
    // The import worker is the same at any viewport: the phone starts from the run's import instead of
    // repeating it (app-shell.spec.ts covers the picker at both sizes), and checks the title from here on.
    await seedRomImport(page);
    await page.goto('/');
  } else {
    await importThroughPicker(info.project.name);
  }
  // The title screen: the ROM's portal scene and Giratina in 3D under our OpenSinnoh wordmark (no intro).
  await expect(page.locator('#title')).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('#picker')).toBeHidden();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 30_000 });
  await expect(page.getByRole('img', { name: 'OpenSinnoh' })).toBeVisible();
  await page.waitForFunction(() => window.openSinnohTitle?.inputBlocked === false);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-title.png` });
  // The portal scene behind Giratina fills the frame (lit share varies with the wing scroll's frame).
  const scene = await canvasStats(page, '.title-3d');
  expect(scene.colours).toBeGreaterThan(32);
  expect(scene.lit).toBeGreaterThan(0.25);
  const imports = await page.evaluate(
    () =>
      new Promise<{ romSha1: string; files: number }[]>((resolve, reject) => {
        const req = indexedDB.open('lantern-nds');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction('imports').objectStore('imports').getAll();
          get.onsuccess = () => resolve(get.result as { romSha1: string; files: number }[]);
        };
      }),
  );
  expect(imports).toHaveLength(1);
  expect(imports[0]!.romSha1).toBe(romSha1());
  expect(imports[0]!.files).toBeGreaterThan(1000);
  // A returning player with a valid import goes straight to the title: no ROM page, no setup.
  await page.goto('/');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 60_000 });
  await expect(page.locator('#rom')).toBeHidden();
});

/**
 * The main canvas after each of `ticks` single ticks (the replay page does not tick on its own), as
 * the number of pixels that changed from the frame before.
 */
async function changedPerTick(ticks: number): Promise<number[]> {
  return page.evaluate(async (n) => {
    const src = document.getElementById('main-canvas') as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = src.width;
    copy.height = src.height;
    const g = copy.getContext('2d', { willReadFrequently: true })!;
    const out: number[] = [];
    let last: Uint8ClampedArray | null = null;
    for (let i = 0; i <= n; i++) {
      if (i > 0) window.openSinnohGame!.advance(1);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.drawImage(src, 0, 0);
      const px = g.getImageData(0, 0, copy.width, copy.height).data;
      if (last) {
        let changed = 0;
        for (let p = 0; p < px.length; p += 4) if (px[p] !== last[p] || px[p + 1] !== last[p + 1] || px[p + 2] !== last[p + 2]) changed++;
        out.push(changed);
      }
      last = px;
    }
    return out;
  }, ticks);
}

test('steady pictures: the bedroom TV does not flicker, the sign shadow does not fight the white ground patches', async () => {
  test.setTimeout(120_000);
  // The bedroom TV's screen (BTP0 tv01) swaps two shades every 30 Hz frame; one-tick frames are drawn
  // blended with the frame before, so nothing in the room changes from tick to tick while all stand still.
  // The shadow test compares screenshot pixels, so the field is drawn at the screenshot's own ratio (Render scale
  // Full). Under Auto a phone at DPR 3 draws at 2 and the screenshot is upscaled: a one-pixel gap in the shadow's
  // texel edge then shows as bare snow. Raising the polygon offset 32x did not change it, so it is not the depth tie.
  await page.evaluate(() => localStorage.setItem('lantern-nds:render-scale', 'full'));
  await page.goto('/?replay');
  await waitForBridge();
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  await waitForScene(page);
  // Past the fade in, before Barry comes up the stairs.
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await waitForScene(page);
  expect(await changedPerTick(8)).toEqual(Array(8).fill(0));
  const bedroom = (await snapshot()).state;
  // Verity Lakefront sign (trainer tips signpost, its own baked h_kage shadow) beside white patches
  // (s_snow): both 1 unit above the grass, so they fought pixel by pixel. Ties go to the translucent
  // shadow: compare the frame with and without the sign; on every row the shadow (pixels darkened to
  // 60–80 %) spans, no snow-white pixel may be left unshaded, and some must be shaded.
  await loadAt(bedroom, 'platinum:MAP_HEADER_VERITY_LAKEFRONT', 79, 849, 'up');
  await waitForScene(page);
  const frame = () => page.locator('#main-canvas').screenshot();
  const shown = await frame();
  await page.evaluate(() => {
    const world = window.openSinnohApp!.game.world as unknown as { view(): { actors: { sprite: string; visible: boolean }[] } };
    const view = world.view.bind(world);
    world.view = () => {
      const v = view();
      return { ...v, actors: v.actors.map((a) => (a.sprite === 'platinum:OBJ_EVENT_GFX_TRAINER_TIPS_SIGNPOST' ? { ...a, visible: false } : a)) };
    };
  });
  await waitForScene(page);
  const hidden = await frame();
  await page.evaluate(() => {
    delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view;
  });
  const counts = await page.evaluate(
    async ([a, b]) => {
      const decode = async (b64: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
        c.drawImage(bmp, 0, 0);
        return { px: c.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
      };
      const shownImg = await decode(a!);
      const on = shownImg.px;
      const off = (await decode(b!)).px;
      const same = (p: number) => on[p] === off[p] && on[p + 1] === off[p + 1] && on[p + 2] === off[p + 2];
      const snow = (p: number) => off[p]! > 200 && off[p + 1]! > 200 && off[p + 2]! > 190;
      const shaded = (p: number) => !same(p) && [0, 1, 2].every((c) => off[p + c]! > 40 && on[p + c]! / off[p + c]! > 0.6 && on[p + c]! / off[p + c]! < 0.8);
      let changed = 0;
      let shadedSnow = 0;
      let bareSnow = 0;
      for (let y = 0; y < shownImg.height; y++) {
        let x0 = -1;
        let x1 = -1;
        for (let x = 0; x < shownImg.width; x++) {
          const p = (y * shownImg.width + x) * 4;
          if (!same(p)) changed++;
          if (shaded(p)) {
            if (x0 < 0) x0 = x;
            x1 = x;
          }
        }
        for (let x = x0; x0 >= 0 && x <= x1; x++) {
          const p = (y * shownImg.width + x) * 4;
          if (snow(p) && shaded(p)) shadedSnow++;
          if (snow(p) && same(p)) bareSnow++;
        }
      }
      return { changed, shadedSnow, bareSnow };
    },
    [shown.toString('base64'), hidden.toString('base64')],
  );
  expect(counts.changed, 'hiding the sign changes the frame').toBeGreaterThan(100);
  expect(counts.shadedSnow, 'snow-white pixels under the sign shadow').toBeGreaterThan(0);
  expect(counts.bareSnow, 'snow-white pixels the sign shadow skips').toBe(0);
  await page.evaluate(() => localStorage.removeItem('lantern-nds:render-scale'));
  expect(errors).toEqual([]);
});

test('the opening replay in the app, new game → Lake Verity, with a visible scene at every beat', async () => {
  const info = test.info();
  test.setTimeout(600_000);
  const project = info.project.name;
  const phone = project === 'phone';
  // Reload in replay mode: the import is reused, no picker.
  await page.goto('/?replay');
  await waitForBridge();
  await expect(page.locator('#picker')).toBeHidden();
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  expect((await snapshot()).state.player.zone).toBe('platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F');

  const read = (f: string) => readFileSync(join(REPO_ROOT, 'tests/rom-replays', f), 'utf8');
  // The opening as one text: its first part (opening-rival.replay, also the start of
  // m2-first-battle-lost) and the rest without its `from`, so `beforeLine` sees every line.
  const second = read('opening.replay').split('\n');
  expect(second[0]).toBe('from opening-rival.replay');
  const text = `${read('opening-rival.replay')}\n${second.slice(1).join('\n')}`;
  // The phone taps Piplup's ball instead of the "starter key" lines.
  const starterKeys = new Set(text.split('\n').flatMap((l, i) => (l.includes('# starter key') ? [i + 1] : [])));
  expect(starterKeys.size).toBe(6);
  let beatNo = 0;
  /** Beats wait for a running fade to finish, at the next line boundary (inputs keep their ticks). */
  const pending: string[] = [];
  const fading = () => page.evaluate(() => (window.openSinnohApp!.game.world as unknown as { fadeState(): unknown }).fadeState() !== null);
  const flush = async () => {
    if (!pending.length || (await fading())) return;
    for (const name of pending.splice(0)) await beat(`${String(beatNo++).padStart(2, '0')}-${name}`, project);
  };
  /**
   * Scene moments where the map must leave a character alone (field scenes): Barry facing the bedroom
   * desk on the tile south of it, Barry in the Twinleaf doorway behind the player at the "Thud!!", the
   * player on the 1F mat by the back wall. Each is checked once, the first time it is on screen.
   */
  const checked = new Set<string>();
  const spriteDepthChecks = async () => {
    // All three one-off pixel checks are done; later lines need no more view snapshots.
    if (checked.size === 3) return;
    const at = await page.evaluate(() => {
      const v = window.openSinnohApp!.game.world.view();
      return { zone: window.openSinnohApp!.game.state.player.zone, message: !!window.openSinnohGame!.snapshot().view.message, actors: v.actors.map((a) => ({ sprite: a.sprite, cur: a.cur, facing: a.facing, visible: a.visible })) };
    });
    const actor = (s: string) => at.actors.find((a) => a.visible && a.sprite.endsWith(s));
    const moment = (name: string, when: boolean) => when && !checked.has(name) && checked.add(name);
    const barry = actor('BARRY');
    const player = actor('PLAYER_M');
    if (moment('bedroom-desk', at.zone.endsWith('PLAYER_HOUSE_2F') && barry?.facing === 'up' && barry.cur.join() === '24,0,88')) await expectActorClear('BARRY', 'bedroom desk');
    if (moment('twinleaf-doorway', at.zone.endsWith('TWINLEAF_TOWN') && at.message && !!barry)) await expectActorClear('BARRY', 'Twinleaf doorway');
    if (moment('1f-mat', at.zone.endsWith('PLAYER_HOUSE_1F') && !at.message && player?.facing === 'down' && player.cur.join() === '168,0,56')) await expectActorClear('PLAYER_M', '1F mat');
  };
  const base = pageDriver(page, SHOTS, project);
  const driver: ReplayDriver = {
    ...base,
    // The replay's screenshot lines are the beats.
    async screenshot(name) {
      if (name === 'route201-rowan-speaks') {
        await flush();
        await beat(`${String(beatNo++).padStart(2, '0')}-${name}`, project);
        await expectRowanDrawn();
        return name;
      }
      if (name !== 'starter-panel') {
        pending.push(name);
        await flush();
        return name;
      }
      // The briefcase scene (ROM models and art) covers the field; the VM's choice panel drives it.
      expect((await snapshot()).view.panel.kind).toBe('choice');
      await starterReady(page);
      await expect(page.locator('#panel-canvas')).toBeHidden();
      if (phone) {
        // Tap Piplup's ball like a player: the first tap selects it, the second takes it.
        expect(await page.evaluate(() => window.openSinnohStarter!.preview)).toBe('platinum:SPECIES_TURTWIG');
        await selectBall(page, PIPLUP, true);
      }
      expect(await page.evaluate(() => window.openSinnohStarter!.preview)).toBe('platinum:SPECIES_PIPLUP');
      const sprite = await starterSprite(page);
      expect(sprite.share, 'Piplup on the disc').toBeGreaterThan(0.03);
      expect(sprite.colours).toBeGreaterThan(8);
      await beat(`${String(beatNo++).padStart(2, '0')}-${name}`, project, false);
      if (phone) await tapBall(page, PIPLUP, true);
      return name;
    },
  };
  const result = await runReplay(driver, text, {
    registries,
    name: 'tests/rom-replays/opening.replay',
    repeat: false,
    async beforeLine(line) {
      await flush();
      await spriteDepthChecks();
      const a = line.action;
      if (a.type === 'assert' && a.what === 'position') pending.push(`${a.zone.replace('platinum:MAP_HEADER_', '').toLowerCase()}-${a.x}-${a.z}`);
      return !(phone && starterKeys.has(line.line));
    },
  });
  expect(result.error).toBeUndefined();
  // The round trip reloads the save at the end (fade-in): let it finish before the last beats.
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await flush();
  expect(pending).toEqual([]);
  expect([...checked].sort()).toEqual(['1f-mat', 'bedroom-desk', 'twinleaf-doorway']);
  const end = await snapshot();
  expect(end.state.party[0]?.species).toBe('platinum:SPECIES_PIPLUP');
  expect(end.state.player.zone).toBe('platinum:MAP_HEADER_LAKE_VERITY_LOW_WATER');
  expect(errors).toEqual([]);
});

test('save → export file → reload → import file restores the state', async () => {
  const info = test.info();
  await loadOpening();
  test.setTimeout(120_000);
  const before = (await snapshot()).state;
  await saveSlot(page);
  await openData(page);
  const [download] = await Promise.all([page.waitForEvent('download'), pressData(page, 'exportSave')]);
  const file = join(info.outputDir, 'save.json');
  await download.saveAs(file);
  // A fresh page: the import is reused, the game starts over in the bedroom.
  await page.reload();
  await waitForBridge();
  await expect(page.locator('#picker')).toBeHidden();
  expect((await snapshot()).state.player.zone).toBe('platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F');
  await openData(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pressData(page, 'importSave')]);
  await chooser.setFiles(file);
  // The confirm dialog's YES (the game steps on the bridge here).
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await page.locator('[data-tap="settings:answer:yes"]').click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await expect(page.locator('.ui-notice')).toContainText(appStrings().game.loadedSave);
  await page.keyboard.press('Escape');
  expect((await snapshot()).state).toEqual(before);
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await beat('99-after-import', info.project.name);
  expect(errors).toEqual([]);
});

/** Loads `state` with the player moved to a tile (no objects, no follower) and waits until the field is idle. */
async function loadAt(state: GameState, zone: string, x: number, z: number, facing: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  const moved = { ...state, player: { zone, x, z, y: 0, facing }, objects: [], follower: null } as unknown as GameState;
  const save = JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: moved });
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), save);
  await untilCanSave();
}

test('a real wild battle on Route 201 (m2-wild-201), drawn from the ROM, the command card picks Fight → move 1', async () => {
  const info = test.info();
  test.setTimeout(300_000);
  const openingEnd = await loadOpening();
  const project = info.project.name;
  // Continue from the opening's end (the replay's `from`), as one game: no reset.
  await loadAt(openingEnd, 'platinum:MAP_HEADER_LAKE_VERITY_LOW_WATER', 46, 53, 'down');
  const read = (file: string) => readFileSync(join(REPO_ROOT, 'tests/rom-replays', file), 'utf8');
  const base = pageDriver(page, SHOTS, project);
  const sceneStats = () => battleSceneStats(page);
  /** The battle canvas with the running battle's view patched (no tick passes), as a PNG. */
  const frameWith = async (patch: 'battlers' | 'healthboxes' | { flash: number; close: number } | null) => {
    await page.evaluate((p) => {
      const battle = window.openSinnohApp!.game.battle as unknown as { view(): Record<string, unknown>; __view?: () => Record<string, unknown> };
      battle.__view ??= battle.view.bind(battle);
      const view = battle.__view;
      battle.view = () => {
        const v = view() as { battlers: { visible: boolean; healthbox: { visible: boolean } }[]; transition: unknown };
        if (p === 'battlers') v.battlers = v.battlers.map((b) => ({ ...b, visible: false }));
        if (p === 'healthboxes') v.battlers = v.battlers.map((b) => ({ ...b, healthbox: { ...b.healthbox, visible: false } }));
        if (typeof p === 'object' && p) v.transition = { field: true, ...p };
        return v as never;
      };
    }, patch);
    await waitForScene(page);
    return page.locator('#battle-canvas').screenshot();
  };
  const driver: ReplayDriver = {
    ...base,
    reset: () => Promise.resolve(),
    async screenshot(name) {
      // The command card is up: the scene is the ROM's (backdrop, platforms, both Pokémon, healthboxes).
      await waitForScene(page);
      await page.screenshot({ path: `${SHOTS}/${project}-m2-${name}.png` });
      const stats = await sceneStats();
      expect(stats.colours, 'battle scene colours').toBeGreaterThan(64);
      expect(stats.lit, 'battle scene lit share').toBeGreaterThan(0.5);
      const shown = await frameWith(null);
      expect(shown.equals(await frameWith('battlers')), 'the Pokémon sprites are drawn').toBe(false);
      expect(shown.equals(await frameWith('healthboxes')), 'the healthboxes are drawn').toBe(false);
      // The healthbox numbers are the ROM's white glyphs with the dark outline (decomp healthbox.c positions):
      // the player's level after its "Lv", its current and max HP, and the foe's level; nothing light there
      // without the healthboxes.
      const regions = { playerLevel: { x: 232, y: 104, w: 24, h: 8 }, playerHp: { x: 192, y: 124, w: 24, h: 8 }, playerMaxHp: { x: 224, y: 124, w: 24, h: 8 }, enemyLevel: { x: 82, y: 28, w: 24, h: 8 } };
      await frameWith(null);
      for (const [name, r] of Object.entries(regions)) expect(await battleRegionLight(page, r), `light ${name} digits`).toBeGreaterThanOrEqual(8);
      await frameWith('healthboxes');
      for (const [name, r] of Object.entries(regions)) expect(await battleRegionLight(page, r), `no light ${name} without healthboxes`).toBeLessThan(4);
      const scene = await page.evaluate(() => ({ ...window.openSinnohApp!.battleScene(), width: innerWidth, height: innerHeight }));
      if (project === 'phone') {
        // A phone: the scene fills the width (the largest whole-pixel scale), no window.
        expect(scene.windowed).toBe(false);
        expect(scene.rect.width).toBeGreaterThan(scene.width * 0.85);
      } else {
        // Desktop: a framed ×3 window over the dimmed field, also at 1920×1080 (capped, centred).
        for (const [w, h, k] of [[1280, 720, 3], [1920, 1080, 3], [2560, 1440, 4]] as const) {
          await page.setViewportSize({ width: w, height: h });
          await frameWith(null);
          const at = await page.evaluate(() => window.openSinnohApp!.battleScene());
          expect(at.windowed, `${w}×${h} window`).toBe(true);
          // Centred with the command card's band under it (LANDSCAPE_CARD: 224 DS px in all).
          expect(at.rect, `${w}×${h} scene rect`).toEqual({ x: (w - 256 * k) / 2, y: Math.floor((h - 224 * k) / 2), width: 256 * k, height: 192 * k });
          const around = await aroundBattleWindow(page);
          expect(around.colours, `${w}×${h} field around the window`).toBeGreaterThan(32);
          expect(around.lit, `${w}×${h} field lit around the window`).toBeGreaterThan(0.3);
          expect(around.dimAlpha, `${w}×${h} dim`).toBeGreaterThan(0.4);
          await page.screenshot({ path: `${SHOTS}/${project}-m2-${name}-${w}x${h}.png` });
        }
        await page.setViewportSize({ width: 1280, height: 720 });
      }
      // The encounter cut-in draws the field cut into sliding bands (a patched view: mid-slice, and a flash).
      for (const [label, t] of [['slice', { flash: 0, close: 3 / 13 }], ['flash', { flash: 0.7, close: 0 }]] as const) {
        await frameWith(t);
        await page.screenshot({ path: `${SHOTS}/${project}-m2-transition-${label}.png` });
      }
      const slice = await (async () => {
        await frameWith({ flash: 0, close: 3 / 13 });
        return sceneStats();
      })();
      expect(slice.colours, 'the cut field is drawn in the slice').toBeGreaterThan(32);
      await page.evaluate(() => {
        const battle = window.openSinnohApp!.game.battle as unknown as { view: unknown; __view?: unknown };
        battle.view = battle.__view;
      });
      // The card: Fight (big), Bag, Run, Pokémon; Fight opens the moves; the first move answers the prompt.
      const card = page.locator('.battle-card');
      await expect(card).toBeVisible();
      const fight = plainText(registries.texts.get('platinum:BattleStrings_Text_Fight' as never)!.text);
      const run = plainText(registries.texts.get('platinum:BattleStrings_Text_Run' as never)!.text);
      await expect(card.getByRole('button', { name: fight })).toBeVisible();
      await expect(card.getByRole('button', { name: run })).toBeEnabled();
      const tap = async (locator: ReturnType<typeof card.getByRole>) => (project === 'phone' ? locator.tap() : locator.click());
      await tap(card.getByRole('button', { name: fight }));
      const moves = card.locator('.bc-move');
      await expect(moves.first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${project}-m2-moves.png` });
      // Fight is the battle's own move prompt (BattleChoice.fight, contracts 0.27.3), as on the DS, not a card-only list.
      const first = (await snapshot()).battle!.prompt!;
      expect(first.kind).toBe('fight');
      await tap(moves.first());
      // The choice is taken on the next tick.
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      expect((await snapshot()).battle!.prompt).toBeNull();
      // The card goes once the choice is taken (the scene's textbox carries the turn's text).
      await expect(card.locator('.bc-button')).toHaveCount(0);
      // A few ticks into the turn: "X used Y!" in the textbox.
      await page.evaluate(() => window.openSinnohGame!.advance(40));
      await waitForScene(page);
      await page.screenshot({ path: `${SHOTS}/${project}-m2-turn.png` });
      return name;
    },
  };
  const result = await runReplay(driver, read('m2-wild-201.replay'), { registries, name: 'm2-wild-201.replay', repeat: false, resolve: (file) => ({ name: file, text: file === 'opening.replay' ? '' : read(file) }) });
  expect(result.error).toBeUndefined();
  expect(result.roundTrip).toBe('identical');
  const end = await snapshot();
  expect(end.battle).toBeNull();
  expect(end.state.party[0]!.exp).toBeGreaterThan(openingEnd.party[0]!.exp);
  // The round trip reloads the save (fade-in): let it finish, then the field is back on screen.
  await page.evaluate(() => window.openSinnohGame!.advance(30));
  await beat('m2-back-in-field', project);
  expect(errors).toEqual([]);
});

test('render: a door clip, model objects, the heal pose and the trainer "!"', async () => {
  const info = test.info();
  test.setTimeout(120_000);
  const openingEnd = await loadOpening();
  // The door nearest the player's house in Twinleaf: a prop with an open clip, from the imported pack.
  const door = await page.evaluate(() => {
    const reg = window.openSinnohApp!.game.registries;
    const zone = reg.zones.get('platinum:MAP_HEADER_TWINLEAF_TOWN' as never)!;
    const matrix = reg.matrices.get(zone.matrix)!;
    const near = { x: 108, z: 890 };
    let best: { x: number; z: number; d: number } | null = null;
    matrix.chunks.forEach((id, cell) => {
      if (!id || matrix.zones?.[cell] !== zone.id) return;
      for (const p of reg.chunks.get(id)!.props) {
        if (!reg.props.get(p.prop)?.animations?.open) continue;
        const x = Math.floor(((cell % matrix.width) * 512 + 256 + p.position[0]) / 16);
        const z = Math.floor((Math.floor(cell / matrix.width) * 512 + 256 + p.position[2]) / 16);
        const d = Math.abs(x - near.x) + Math.abs(z - near.z);
        if (!best || d < best.d) best = { x, z, d };
      }
    });
    return best as { x: number; z: number } | null;
  });
  expect(door, 'a Twinleaf door prop with clips').not.toBeNull();
  await loadAt(openingEnd, 'platinum:MAP_HEADER_TWINLEAF_TOWN', door!.x, door!.z + 2, 'up');
  await beat('m1a-door-closed', info.project.name);
  const closed = await page.locator('#main-canvas').screenshot();
  // The world opens the door (a script's play_door_open_animation); the pose and emote are posed in the page.
  await page.evaluate((d) => {
    const world = window.openSinnohApp!.game.world as unknown as { playDoor(x: number, z: number, kind: 'open'): void; view(): Record<string, unknown> & { actors: Record<string, unknown>[] } };
    world.playDoor(d.x, d.z, 'open');
    const view = world.view.bind(world);
    world.view = () => {
      const v = view();
      const [hero, ...rest] = v.actors;
      const tick = window.openSinnohApp!.game.state.tick;
      return { ...v, actors: [{ ...hero, sprite: 'platinum:OBJ_EVENT_GFX_PLAYER_M_POKECENTER_HEAL', pose: 'give', animTick: tick % 21, emote: true }, ...rest] };
    };
  }, door!);
  await page.evaluate(() => window.openSinnohGame!.advance(12));
  expect(await page.evaluate(() => window.openSinnohApp!.game.world.view().doors)).toMatchObject([{ x: door!.x, z: door!.z, anim: 'open' }]);
  await beat('m1a-door-open-heal-pose-emote', info.project.name);
  const posed = await page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats: { doors: number; doorsPosed: number } }).openSinnohRenderStats);
  console.log(`doors: ${posed.doors} built, ${posed.doorsPosed} posed; door ${JSON.stringify(door)}`);
  expect(posed.doorsPosed).toBe(1);
  const open = await page.locator('#main-canvas').screenshot();
  expect(open.equals(closed)).toBe(false);
  await page.evaluate(() => {
    delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view;
  });
  expect(errors).toEqual([]);
});

test('leaving the house: the Twinleaf door opens under the fade in, the player walks out, the door closes', async () => {
  const info = test.info();
  test.setTimeout(120_000);
  const openingEnd = await loadOpening();
  // On the 1F exit mat; pushing down warps to the town door (decomp ov5_021D453C on arrival).
  await loadAt(openingEnd, 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F', 6, 10, 'down');
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('down');
    for (let i = 0; i < 60 && window.openSinnohApp!.game.state.player.zone !== 'platinum:MAP_HEADER_TWINLEAF_TOWN'; i++) g.advance(1);
    g.release('down');
  });
  type Frame = { tick: number; doors: unknown; visible: boolean; x: number; z: number; fade: number; posed: number };
  const frames: Frame[] = [];
  const shots: Buffer[] = [];
  for (let i = 0; i < 14; i++) {
    await waitForScene(page);
    frames.push(
      await page.evaluate(() => {
        const app = window.openSinnohApp!;
        const v = app.game.world.view();
        const fade = (app.game.world as unknown as { fadeState(): { alpha: number } | null }).fadeState();
        const posed = (globalThis as unknown as { openSinnohRenderStats: { doorsPosed: number } }).openSinnohRenderStats.doorsPosed;
        return { tick: app.game.state.tick, doors: v.doors ?? null, visible: v.actors[0]!.visible, x: app.game.state.player.x, z: app.game.state.player.z, fade: fade?.alpha ?? 0, posed };
      }),
    );
    shots.push(await page.locator('#main-canvas').screenshot({ path: `${SHOTS}/${info.project.name}-door-out-${String(i).padStart(2, '0')}.png` }));
    await page.evaluate(() => window.openSinnohGame!.advance(2));
  }
  console.log(`door out: ${frames.map((f) => `${f.tick}:${f.visible ? 'shown' : 'hidden'}@${f.x},${f.z} fade ${f.fade.toFixed(2)} ${JSON.stringify(f.doors)} posed ${f.posed}`).join('\n  ')}`);
  // Hidden on the door tile while it opens, shown walking out, then the door closes and leaves the list.
  expect(frames[0]).toMatchObject({ visible: false, x: 116, z: 885 });
  expect(frames.some((f) => f.visible && (f.doors as { anim: string }[] | null)?.[0]?.anim === 'close' && f.posed === 1)).toBe(true);
  const last = frames.at(-1)!;
  expect(last).toMatchObject({ visible: true, x: 116, z: 886, doors: null, fade: 0 });
  // Pixels: a frame with the door still swinging shut differs from the closed door (same player tile).
  const swinging = frames.findIndex((f) => f.fade === 0 && f.z === 886 && (f.doors as { anim: string }[] | null)?.[0]?.anim === 'close');
  expect(swinging).toBeGreaterThan(0);
  expect(shots[swinging]!.equals(shots.at(-1)!)).toBe(false);
  expect(await page.evaluate(() => window.openSinnohApp!.game.canSave())).toBe(true);
  expect(errors).toEqual([]);
});

/** The main canvas's pixels right after a frame, kept in the page under `name`. */
async function keepPixels(name: string): Promise<void> {
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = src.width;
          copy.height = src.height;
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0);
          ((window as unknown as { kept: Record<string, ImageData> }).kept ??= {})[key] = g.getImageData(0, 0, copy.width, copy.height);
          resolve();
        });
      }),
    name,
  );
}

test('tall grass on Route 201: stepping in rustles the grass over the player (FIELD_EFFECT_TALL_GRASS)', async () => {
  const info = test.info();
  test.setTimeout(120_000);
  const openingEnd = await loadOpening();
  // A tall-grass tile on Route 201 whose south neighbour is open ground: stand there facing north.
  const spot = await page.evaluate(() => {
    const reg = window.openSinnohApp!.game.registries;
    const zone = reg.zones.get('platinum:MAP_HEADER_ROUTE_201' as never)!;
    const matrix = reg.matrices.get(zone.matrix)!;
    const grass = [...reg.tileBehaviors.values()].find((b) => b.name === 'TALL_GRASS')!.sourceIndex;
    const W = matrix.width * 32;
    const tile = (x: number, z: number) => {
      const id = matrix.chunks[(x >> 5) + (z >> 5) * matrix.width];
      return id && matrix.zones?.[(x >> 5) + (z >> 5) * matrix.width] === zone.id ? reg.chunks.get(id)!.tiles[(x & 31) + (z & 31) * 32]! : null;
    };
    for (let i = 0; i < W * matrix.height * 32; i++) {
      const x = i % W;
      const z = Math.floor(i / W);
      const t = tile(x, z);
      const below = tile(x, z + 1);
      if (t !== null && below !== null && (t & 0xff) === grass && !(t & 0x8000) && (below & 0xff) === 0 && !(below & 0x8000)) return { x, z };
    }
    return null;
  });
  expect(spot, 'a Route 201 tall-grass tile with open ground south of it').not.toBeNull();
  await loadAt(openingEnd, 'platinum:MAP_HEADER_ROUTE_201', spot!.x, spot!.z + 1, 'up');
  await waitForScene(page);
  type Rustle = { key: number; effect: string; cur: number[]; tick: number };
  // Route 201's NPCs stand in grass too (settled rustles on load): only the effect on the stepped tile counts.
  const rustles = () =>
    page.evaluate((at) => window.openSinnohApp!.game.world.view().effects.filter((e) => e.anim === 'rustle' && e.cur[0] === at.x * 16 + 8 && e.cur[2] === at.z * 16 + 8) as Rustle[], spot!);
  expect(await rustles()).toEqual([]);
  // Step north; 4 ticks into the 8-tick walk (the encounter roll comes at the step's end).
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('up');
    g.advance(4);
    g.release('up');
  });
  const live = await rustles();
  expect(live).toMatchObject([{ effect: 'platinum:FIELD_EFFECT_TALL_GRASS', cur: [spot!.x * 16 + 8, expect.any(Number), spot!.z * 16 + 8] }]);
  expect(live[0]!.tick).toBeGreaterThan(0);
  expect(live[0]!.tick).toBeLessThan(13);
  await waitForScene(page);
  await page.locator('#main-canvas').screenshot({ path: `${SHOTS}/${info.project.name}-grass-rustle.png` });
  await keepPixels('with');
  // The same frame without that effect (no tick passes): the grass pixels go away, around the player.
  await page.evaluate((key) => {
    const world = window.openSinnohApp!.game.world as unknown as { view(): { effects: { key: number }[] } };
    const view = world.view.bind(world);
    world.view = () => {
      const v = view();
      return { ...v, effects: v.effects.filter((e) => e.key !== key) };
    };
  }, live[0]!.key);
  await waitForScene(page);
  await keepPixels('without');
  await page.evaluate(() => {
    delete (window.openSinnohApp!.game.world as unknown as { view?: unknown }).view;
  });
  const diff = await page.evaluate(() => {
    const { with: a, without: b } = (window as unknown as { kept: Record<string, ImageData> }).kept;
    let n = 0;
    let x0 = Infinity;
    let x1 = -1;
    for (let i = 0; i < a!.data.length; i += 4) {
      if (a!.data[i] === b!.data[i] && a!.data[i + 1] === b!.data[i + 1] && a!.data[i + 2] === b!.data[i + 2]) continue;
      n++;
      const x = (i / 4) % a!.width;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    return { n, centre: (x0 + x1) / 2 / a!.width };
  });
  console.log(`grass rustle: ${JSON.stringify(live)} diff ${JSON.stringify(diff)}`);
  expect(diff.n, 'the rustle draws pixels').toBeGreaterThan(50);
  // The camera follows the player: the rustle sits at the middle of the frame.
  expect(Math.abs(diff.centre - 0.5)).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test('sprite depth: rails and counters in front of a character cover it; the map behind never does', async () => {
  const info = test.info();
  test.setTimeout(120_000);
  const openingEnd = await loadOpening();
  // Going down the bedroom stairs (2F, in the stair well, y −24): the well's rim south of
  // the player covers his lower body (BD).
  await loadAt(openingEnd, 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F', 10, 4, 'left');
  await beat('depth-2f-stairs', info.project.name);
  await expectActorCovered('PLAYER_M', '2F stairs');
  // Sandgem Pokémon Center and Mart: the clerk behind the counter is covered, the player in front is not.
  await loadAt(openingEnd, 'platinum:MAP_HEADER_SANDGEM_TOWN_POKECENTER_1F', 8, 6, 'up');
  await beat('depth-pokecenter-counter', info.project.name);
  await expectActorCovered('POKECENTER_NURSE', 'Pokémon Center counter');
  await expectActorClear('PLAYER_M', 'Pokémon Center counter');
  await loadAt(openingEnd, 'platinum:MAP_HEADER_SANDGEM_TOWN_MART', 3, 7, 'up');
  await beat('depth-mart-counter', info.project.name);
  await expectActorCovered('CASHIER_F', 'Mart counter');
  await expectActorClear('PLAYER_M', 'Mart counter');
  expect(errors).toEqual([]);
});

test('perf: walking Twinleaf → Route 201 → Sandgem at real-time pace (frame time, memory, chunk pop-in)', async () => {
  const info = test.info();
  test.skip(info.project.name !== 'desktop', 'measured once, at 1280×720');
  test.setTimeout(300_000);
  const openingEnd = await loadOpening();
  await loadAt(openingEnd, 'platinum:MAP_HEADER_TWINLEAF_TOWN', 108, 890, 'up');
  // The walk measures the field: Route 201's grass would start wild battles.
  await page.evaluate(() => window.openSinnohGame!.setWildBattles('flee'));
  await waitForScene(page);
  const result = await page.evaluate(async () => {
    type Stats = { frames: number; renderMs: number[]; chunks: number; chunkBuilds: number; geometries: number; textures: number; cachedModels: number };
    const stats = (globalThis as unknown as { openSinnohRenderStats: Stats }).openSinnohRenderStats;
    const app = window.openSinnohApp!;
    const game = window.openSinnohGame!;
    const reg = app.game.registries;
    const goal = 'platinum:MAP_HEADER_SANDGEM_TOWN';
    const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
    type Dir = keyof typeof DIRS;
    /** Shortest walk (tile blocked bit, warps, objects) from the player to the first tile of the goal zone. */
    const plan = (): Dir[] | null => {
      const st = app.game.state;
      const zone = reg.zones.get(st.player.zone)!;
      const matrix = reg.matrices.get(zone.matrix)!;
      const W = matrix.width * 32;
      const H = matrix.height * 32;
      const avoid = new Set<number>();
      for (const z of reg.zones.values()) if (z.matrix === matrix.id) for (const w of z.events.warps) avoid.add(w.x + w.z * W);
      for (const o of st.objects) avoid.add(o.x + o.z * W);
      const tile = (x: number, z: number) => {
        const id = matrix.chunks[(x >> 5) + (z >> 5) * matrix.width];
        return id ? reg.chunks.get(id)!.tiles[(x & 31) + (z & 31) * 32]! : 0x8000;
      };
      const zoneAt = (x: number, z: number) => matrix.zones?.[(x >> 5) + (z >> 5) * matrix.width] ?? zone.id;
      const start = st.player.x + st.player.z * W;
      const prev = new Map<number, [number, Dir]>([[start, [-1, 'up']]]);
      const queue = [start];
      for (let qi = 0; qi < queue.length; qi++) {
        const at = queue[qi]!;
        const x = at % W;
        const z = Math.floor(at / W);
        if (zoneAt(x, z) === goal) {
          const path: Dir[] = [];
          for (let k = at; k !== start; k = prev.get(k)![0]) path.unshift(prev.get(k)![1]);
          return path;
        }
        for (const [d, [dx, dz]] of Object.entries(DIRS) as [Dir, readonly [number, number]][]) {
          const nx = x + dx;
          const nz = z + dz;
          const n = nx + nz * W;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H || prev.has(n) || avoid.has(n) || tile(nx, nz) & 0x8000) continue;
          prev.set(n, [at, d]);
          queue.push(n);
        }
      }
      return null;
    };
    const t0 = performance.now();
    const frames0 = stats.frames;
    const builds0 = stats.chunkBuilds;
    const heap0 = heap();
    stats.renderMs.length = 0;
    let ticks = 0;
    let loadingTicks = 0;
    let peakHeap = heap0;
    let held: Dir | null = null;
    const zones = new Set<string>();
    while (app.game.state.player.zone !== goal && ticks < 3000) {
      const path = plan();
      if (!path) throw new Error(`no path from ${JSON.stringify(app.game.state.player)}`);
      const dir = path[0]!;
      if (held !== dir) {
        if (held) game.release(held);
        game.press(dir);
        held = dir;
      }
      // One tick per 33 ms: the renderer sees the world move at DS speed.
      game.advance(1);
      ticks++;
      zones.add(app.game.state.player.zone);
      if (app.sceneLoading()) loadingTicks++;
      peakHeap = Math.max(peakHeap, heap());
      await sleep(1000 / 30);
    }
    if (held) game.release(held);
    const ms = [...stats.renderMs].sort((a, b) => a - b);
    const q = (f: number) => +(ms[Math.min(ms.length - 1, Math.floor(ms.length * f))] ?? 0).toFixed(2);
    return {
      reached: app.game.state.player.zone === goal,
      zones: [...zones],
      ticks,
      seconds: +((performance.now() - t0) / 1000).toFixed(1),
      frames: stats.frames - frames0,
      renderMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) },
      loadingTicks,
      chunkBuilds: stats.chunkBuilds - builds0,
      chunksAlive: stats.chunks,
      geometries: stats.geometries,
      textures: stats.textures,
      cachedModels: stats.cachedModels,
      heapMB: { start: +(heap0 / 1e6).toFixed(1), peak: +(peakHeap / 1e6).toFixed(1), end: +(heap() / 1e6).toFixed(1) },
    };
  });
  console.log(`perf walk: ${JSON.stringify(result)}`);
  await beat('perf-walk-sandgem', info.project.name);
  expect(result.reached).toBe(true);
  expect(errors).toEqual([]);
});

// The continuous CP1–4 chain is proved headless (checkpoints*.rom.test.ts). Each browser
// checkpoint starts at its predecessor's real save, retaining every assertion and visible beat.
for (const [cp, prefix] of [['cp2', 'opening'], ['cp3', 'cp2'], ['cp4', 'cp3']] as const) {
  test(`${cp} in the app from the ${prefix} anchor, beats at story asserts`, async () => {
    const info = test.info();
    test.setTimeout(900_000);
    const started = Date.now();
    const project = info.project.name;
    const phone = project === 'phone';
    const replay = await fromChainAnchor(pageDriver(page, SHOTS, project), `${cp}.replay`);
    const pending: string[] = [];
    const fading = () => page.evaluate(() => (window.openSinnohApp!.game.world as unknown as { fadeState(): unknown }).fadeState() !== null);
    const flush = async (force = false) => {
      if (!pending.length || (!force && (await fading()))) return;
      for (const name of pending.splice(0)) await beat(name, project);
    };
    let previous: string | null = null;
    const result = await runReplay(replay.driver, replay.text, {
      registries,
      name: `${cp}.replay`,
      repeat: false,
      async beforeLine(line) {
        await flush();
        // Desktop: a beat where a group of story asserts starts (after a scene or a walk).
        if (!phone && line.action.type === 'assert' && previous !== 'assert') pending.push(`${cp}-line${line.line}`);
        previous = line.action.type;
      },
    });
    expect(result.error, cp).toBeUndefined();
    expect(result.roundTrip).toBe('identical');
    // The round trip loads the final save: let its fade-in end before the final scene check.
    await page.evaluate(() => window.openSinnohGame!.advance(30));
    pending.push(`${cp}-end`);
    await flush(true);
    if (cp === 'cp3') {
      // CP3 ends with the Pokétch: P opens the ROM digital watch, with its 24-hour time.
      const watch = plainText(registries.texts.get('platinum:pl_msg_00000457_00000' as never)!.text, []);
      await page.keyboard.press('KeyP');
      const card = page.locator('.poketch');
      await expect(card).toBeVisible();
      await expect(card.getByRole('img')).toHaveAccessibleName(new RegExp(`^${watch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d\\d:\\d\\d$`));
      await settle(page);
      await page.screenshot({ path: `${SHOTS}/${project}-cp3-poketch.png` });
      const lcd = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.poketch-lcd')!;
        const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        const colours = new Set<number>();
        for (let i = 0; i < px.length; i += 4) colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        return colours.size;
      });
      expect(lcd, 'the watch face is drawn').toBeGreaterThan(1);
      await page.keyboard.press('KeyP');
      await expect(card).toBeHidden();
    }
    if (cp === 'cp4') expect((await snapshot()).state.badges).toEqual(['platinum:BADGE_ID_COAL']);
    console.log(`${cp} in the app: ${result.ticks} ticks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    expect(errors).toEqual([]);
  });
}
