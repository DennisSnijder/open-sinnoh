/**
 * What the wall-clock loop no longer draws, in normal play on the real ROM (OPENSINNOH_NDS_ROM; skipped without it).
 * Replays and bridge pages draw every frame, so only this spec sees the skips: each test checks both that a frame is
 * left out and that what must invalidate it does (a tick, a resize, the battle's end). A missed invalidation here is
 * a stale overlay or a frozen battle.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { saveSlot } from './save.ts';
import { romContext, resetRomDevice } from './rom-context.ts';

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
