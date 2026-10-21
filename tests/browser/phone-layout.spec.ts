/**
 * Rotation and the safe areas on the fixture pack, on the phone project (the spec sets its own sizes):
 * rotating mid-message and mid-menu keeps the game and lays it out again within one frame; with notch-sized insets
 * (the page's `--sa*` variables, set through the test hook: Playwright cannot emulate `env()`), in portrait and in
 * landscape, nothing the player touches or reads sits under the notch or the home indicator.
 */
import { expect, test, type Page } from '@playwright/test';

/** The game's state a rotation must not change. */
const snapshotState = () => {
  const g = window.openSinnohApp!.game;
  return JSON.stringify({ zone: g.state.player.zone, x: g.state.player.x, z: g.state.player.z, message: g.scripts.view().message?.waitingForInput ?? null, app: g.app()?.app ?? null });
};

/** One frame after a resize, the layout is for the new orientation and the canvas is sized to it. */
async function rotate(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  const done = await page.evaluate(
    () =>
      new Promise<{ mode: string; width: number; canvas: number; ratio: number }>((resolve) =>
        requestAnimationFrame(() => {
          const c = document.getElementById('main-canvas') as HTMLCanvasElement;
          resolve({ mode: window.openSinnohApp!.layout.mode, width: window.openSinnohApp!.layout.main.width, canvas: c.width, ratio: window.openSinnohApp!.renderScale().pixelRatio });
        }),
      ),
  );
  expect(done.mode).toBe(height > width ? 'portrait' : 'landscape');
  expect(done.width).toBe(width);
  // The field's 3D buffer is at the app's own pixel ratio: Render scale Auto caps a touch screen at 2.
  expect(done.canvas).toBe(Math.round(width * done.ratio));
}

/** Every on-screen control and HUD button lies inside the viewport. */
async function expectControlsOnScreen(page: Page, width: number, height: number): Promise<void> {
  const out = await page.evaluate(
    ([w, h]) =>
      [...document.querySelectorAll<HTMLElement>('.controls button, .hud-button')]
        .filter((b) => b.getClientRects().length)
        .map((b) => ({ name: b.dataset.button ?? b.getAttribute('aria-label'), r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.left < -0.5 || r.top < -0.5 || r.right > w! + 0.5 || r.bottom > h! + 0.5)
        .map((c) => c.name),
    [width, height],
  );
  expect(out, `controls off the ${width}×${height} screen`).toEqual([]);
}

test('rotating mid-message and mid-menu keeps the game and lays out again in one frame', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the phone and its rotation');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  const state = () => page.evaluate(snapshotState);
  const message = await state();
  // Mid-message: the message is still waiting after each turn (a phone's two orientations, then a tablet's), the controls stay on screen.
  for (const [w, h] of [[844, 390], [390, 844], [820, 1180], [1180, 820], [390, 844]] as const) {
    await rotate(page, w, h);
    expect(await state()).toBe(message);
    await expectControlsOnScreen(page, w, h);
  }
  // Mid-menu: the start menu stays open, inside the view the new layout gives it.
  await page.locator('#buttons [data-button="a"]').tap();
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await page.getByRole('button', { name: 'Start menu', exact: true }).click();
  await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
  for (const [w, h] of [[844, 390], [390, 844]] as const) {
    await rotate(page, w, h);
    await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
    expect(await page.evaluate(() => window.openSinnohApp!.game.app()?.app)).toBe('start-menu');
    const inside = await page.evaluate(() => {
      const r = document.querySelector('[data-screen="start-menu"]')!.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
    expect(inside).toBe(true);
    await expectControlsOnScreen(page, w, h);
  }
  expect(errors).toEqual([]);
});

const INSETS = {
  portrait: { size: [390, 844], insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  landscape: { size: [844, 390], insets: { top: 0, right: 47, bottom: 21, left: 47 } },
} as const;

for (const [name, { size, insets }] of Object.entries(INSETS)) {
  test(`safe areas, ${name} notch: controls, HUD, menus and the ROM page stay clear of it`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'the phone');
    await page.setViewportSize({ width: size[0], height: size[1] });
    /** What lies under the notch or the home indicator among the elements matching `selector`. */
    const under = (selector: string) =>
      page.evaluate(
        ([sel, ins]) => {
          const safe = { l: ins!.left, t: ins!.top, r: innerWidth - ins!.right, b: innerHeight - ins!.bottom };
          const shown = [...document.querySelectorAll<HTMLElement>(sel as string)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
          if (!shown.length) return [`nothing matches ${sel}`];
          return shown
            .map((e) => ({ name: e.dataset.button ?? e.getAttribute('aria-label') ?? e.className, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.left < safe.l - 0.5 || r.top < safe.t - 0.5 || r.right > safe.r + 0.5 || r.bottom > safe.b + 0.5)
            .map(({ name, r }) => `${name} ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
        },
        [selector, insets] as const,
      );
    // The ROM page (no import here): its window stays inside the safe area.
    await page.goto('/');
    await page.locator('#picker').waitFor({ state: 'visible' });
    await page.evaluate((ins) => window.openSinnohSafeArea!(ins), insets);
    expect(await under('.rom-panel'), 'the ROM page').toEqual([]);

    await page.goto('/?packs=fixture');
    await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
    await page.evaluate((ins) => window.openSinnohSafeArea!(ins), insets);
    expect(await under('.controls button, .hud-button'), 'the controls and HUD').toEqual([]);
    await page.locator('#buttons [data-button="a"]').tap();
    await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
    await page.getByRole('button', { name: 'Start menu', exact: true }).click();
    await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
    expect(await under('[data-screen="start-menu"]'), 'the start menu').toEqual([]);
    await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
    await expect(page.locator('[data-screen="options"] .os-panel')).toBeVisible();
    // The window opens with an animation: measure once it has run.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
    expect(await under('[data-screen="options"] .os-panel'), 'Options').toEqual([]);
  });
}
