/**
 * What the wall-clock loop no longer draws, in normal play on the real ROM (OPENSINNOH_NDS_ROM; skipped without it).
 * Replays and bridge pages draw every frame, so only this spec sees the skips: each test checks both that a frame is
 * left out and that what must invalidate it does (a tick, a resize, the battle's end). A missed invalidation here is
 * a stale overlay or a frozen battle.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { saveSlot } from './save.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'the windowed battle and desktop keys');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(300_000);
  context = await romContext(browser, info.project.use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
});

test.afterAll(async () => {
  await page?.close();
});

/** Plays to a save with the bridge, then CONTINUEs it from the title: the field runs on the wall clock. */
async function launch(save: () => Promise<void>): Promise<void> {
  await page.goto('/?replay&debug=1');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  await save();
  await saveSlot(page);
  errors.length = 0; // The debug panel's own requests fail on the static test server.
  await page.goto('/');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.focused === 'continue', undefined, { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
}

/** Once the game can save, at `zone` with no people, entered as a warp does. */
async function moveTo(zone: string, x: number, z: number, vars: Record<string, number> = {}): Promise<void> {
  const ok = await page.evaluate(
    ({ zone, x, z, vars }) => {
      const g = window.openSinnohGame!;
      const settle = () => {
        for (let i = 0, calm = 0; i < 6000; i++) {
          calm = !g.snapshot().scriptRunning && window.openSinnohApp!.game.canSave() ? calm + 1 : 0;
          if (calm >= 60) return true;
          const v = g.snapshot().view;
          if (v.message?.waitingForInput || v.yesNo) {
            g.press('a');
            g.advance(1);
            g.release('a');
          }
          g.advance(1);
        }
        return false;
      };
      if (!settle()) return false;
      const env = JSON.parse(g.save()) as { state: { player: object; objects: unknown[]; follower: unknown; vars: Record<string, number> } };
      env.state.player = { zone, x, z, y: 0, facing: 'up' };
      env.state.objects = [];
      env.state.follower = null;
      Object.assign(env.state.vars, vars);
      g.load(JSON.stringify(env), 'arrival');
      return settle();
    },
    { zone, x, z, vars },
  );
  expect(ok).toBe(true);
}

/** Opaque pixels of the overlay's top-left corner, in the frame after this call. */
const cornerOpaque = () =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const c = document.getElementById('overlay-canvas') as HTMLCanvasElement;
          const px = c.getContext('2d')!.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 120)).data;
          let n = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i]) n++;
          resolve(n);
        }),
      ),
  );

const counts = () =>
  page.evaluate(() => {
    const app = window.openSinnohApp!;
    return { field: (globalThis as unknown as { openSinnohRenderStats: { frames: number } }).openSinnohRenderStats.frames, shown: app.loop.frames, ticks: app.ticks };
  });
type Counts = Awaited<ReturnType<typeof counts>>;

/** The counts after `n` more display frames. */
const afterFrames = async (n: number): Promise<[Counts, Counts]> => {
  const from = await counts();
  await page.waitForFunction((target) => window.openSinnohApp!.loop.frames >= target, from.shown + n, { timeout: 120_000 });
  return [from, await counts()];
};

/** The colours in the view left of the battle window, as the page shows them (a screenshot: the compositor's frame). */
async function coloursAroundWindow(): Promise<number> {
  const png = (await page.screenshot({ clip: { x: 0, y: 0, width: 160, height: 400 } })).toString('base64');
  return page.evaluate(async (data) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const g = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 4) colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    return colours.size;
  }, png);
}

test('the overlay shows the signboard from the ticks that bring it and is empty again after them', async () => {
  test.setTimeout(240_000);
  await launch(() =>
    moveTo('platinum:MAP_HEADER_TWINLEAF_TOWN', 110, 870, { 'platinum:VAR_TWINLEAF_TOWN_RIVAL_TRIGGER_STATE': 1, 'platinum:VAR_TWINLEAF_TOWN_GUITARIST_TRIGGER_STATE': 2 }),
  );
  await page.waitForFunction(() => window.openSinnohApp!.game.mapPopup() === null, undefined, { timeout: 60_000 });
  expect(await cornerOpaque(), 'empty before the crossing').toBe(0);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.openSinnohApp!.game.mapPopup()?.phase === 'hold', undefined, { timeout: 60_000 });
  await page.keyboard.up('ArrowUp');
  await expect.poll(cornerOpaque, { message: 'the signboard is drawn', timeout: 10_000 }).toBeGreaterThan(1000);
  await page.waitForFunction(() => window.openSinnohApp!.game.mapPopup() === null, undefined, { timeout: 60_000 });
  await expect.poll(cornerOpaque, { message: 'the overlay is cleared', timeout: 10_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('a still field is drawn once a tick, a walking one every display frame', async () => {
  test.setTimeout(120_000);
  // Stood still since the last test's popup. Software GL may draw under 30 fps: then every frame has its tick.
  await page.waitForTimeout(500);
  const [a, b] = await afterFrames(60);
  expect(b.field - a.field, 'no more drawn than ticks ran').toBeLessThanOrEqual(b.ticks - a.ticks + 2);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(300);
  const [c, d] = await afterFrames(20);
  await page.keyboard.up('ArrowLeft');
  expect(d.field - c.field, 'every frame of the walk').toBeGreaterThanOrEqual(d.shown - c.shown - 2);
  expect(errors).toEqual([]);
});

test('the automatic quality step eases a slow Cinematic, says so, keeps the choice stored and yields to a hand pick', async () => {
  test.setTimeout(240_000);
  const enhanced = () => page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats: { enhanced: { ao: boolean; bloom: boolean; grade: boolean } | null } }).openSinnohRenderStats.enhanced);
  const stored = () => page.evaluate(() => [localStorage.getItem('lantern-nds:visual-style'), localStorage.getItem('lantern-nds:auto-quality')]);
  const frames = (ms: number, n: number) =>
    page.evaluate(
      ([ms, n]) => {
        for (let i = 0; i < n!; i++) window.openSinnohApp!.qualityFrame(ms!);
      },
      [ms, n],
    );
  await page.evaluate(() => {
    localStorage.setItem('lantern-nds:visual-style', 'cinematic');
    localStorage.removeItem('lantern-nds:auto-quality');
  });
  await launch(() => moveTo('platinum:MAP_HEADER_ROUTE_201', 118, 853));
  await expect.poll(enhanced, { timeout: 30_000 }).toMatchObject({ ao: true, bloom: true });

  await frames(40, 240);
  await expect.poll(enhanced, { message: 'the step is tried', timeout: 10_000 }).toMatchObject({ ao: false, bloom: false, grade: true });
  expect(await stored(), 'not stored during its trial').toEqual(['cinematic', null]);
  await page.locator('.ui-toast').waitFor({ state: 'hidden' });
  await frames(30, 150);
  await expect(page.locator('.ui-toast')).toContainText(appStrings().game.visualsEased);
  expect(await stored(), 'the style stays the player\'s').toEqual(['cinematic', 'eased']);

  await page.reload();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.focused === 'continue', undefined, { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(enhanced, { message: 'a new session starts eased', timeout: 30_000 }).toMatchObject({ ao: false, grade: true });
  await page.evaluate(() => {
    localStorage.setItem('lantern-nds:auto-quality', 'off');
    localStorage.setItem('lantern-nds:visual-style', 'ds');
  });
  expect(errors).toEqual([]);
});

test('the windowed battle draws its field once, and again after a resize and when it ends', async () => {
  test.setTimeout(300_000);
  await launch(async () => {
    await moveTo('platinum:MAP_HEADER_ROUTE_201', 118, 853);
    await page.locator('#dev-debug > summary').click();
    await page.getByLabel('Species', { exact: true }).fill('platinum:SPECIES_MONFERNO');
    await page.getByLabel('Level', { exact: true }).fill('25');
    await page.getByRole('button', { name: 'Give Pokémon' }).click();
    await page.locator('#dev-debug output').filter({ hasText: 'Done.' }).waitFor();
  });
  const battling = () => page.evaluate(() => window.openSinnohApp!.game.inBattle());
  for (let k = 0; !(await battling()); k++) {
    const key = k % 2 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(700);
    await page.keyboard.up(key);
    expect(k, 'a wild battle within 200 walks').toBeLessThan(200);
  }
  await expect
    .poll(
      async () => {
        await page.keyboard.press('KeyZ');
        return page.evaluate(() => !!window.openSinnohApp!.game.battle?.view()?.prompt);
      },
      { timeout: 90_000, intervals: [300] },
    )
    .toBe(true);
  expect((await page.evaluate(() => window.openSinnohApp!.battleScene())).windowed).toBe(true);

  const [a, b] = await afterFrames(30);
  expect(b.field - a.field, 'the frozen field is not drawn again').toBeLessThanOrEqual(1);
  expect(await coloursAroundWindow(), 'yet it stays on screen').toBeGreaterThan(8);

  const hash = () =>
    page.evaluate(() => {
      const c = document.getElementById('battle-canvas') as HTMLCanvasElement;
      const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < px.length; i += 4) h = (h * 31 + px[i]! + px[i + 1]! * 3 + px[i + 2]! * 7) | 0;
      return h;
    });
  const before = await hash();

  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => (await counts()).field - b.field, { message: 'a resize draws the field again', timeout: 20_000 }).toBeGreaterThan(0);
  expect(await coloursAroundWindow(), 'the resized field is on screen').toBeGreaterThan(8);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => window.openSinnohApp!.layout.main.width === 1280, undefined, { timeout: 20_000 });
  await afterFrames(5);

  // The turn: the scene moves on from the ticks alone, frames without one keep it.
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyZ');
  await expect.poll(hash, { message: 'the turn is drawn', timeout: 30_000 }).not.toBe(before);

  // Out by running: away from a wild one at level 25, whatever the turn left to answer.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('KeyZ');
        return page.evaluate(() => {
          const game = window.openSinnohApp!.game;
          if (game.battle?.view().prompt?.kind === 'command') game.battle.choose({ kind: 'run' });
          return game.inBattle();
        });
      },
      { timeout: 120_000, intervals: [300] },
    )
    .toBe(false);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  const [c, d] = await afterFrames(20);
  await page.keyboard.up('ArrowRight');
  expect(d.field - c.field, 'the field is drawn again').toBeGreaterThan(5);
  expect(errors).toEqual([]);
});
