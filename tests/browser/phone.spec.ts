/**
 * The phone and platform behaviour on the fixture pack in normal play (the wall-clock loop): a hidden
 * page stops the game, the audio and the wake lock and starts again without a catch-up burst; the wake lock,
 * haptics and fullscreen are feature-detected (stubbed APIs here: Playwright cannot hide a tab or hold a lock);
 * the control size and opacity settings; rotation mid-message and mid-menu; the safe-area insets (the page's
 * `--sa*` variables, set through the test hook); the save database closes when the page goes away.
 */
import { expect, test, type Page } from '@playwright/test';
import { controlMetrics } from '../../packages/app/src/layout.ts';
import { PHONE_KEY } from '../../packages/app/src/phone.ts';
import { saveGame } from './save.ts';
import { pageScale, rapidTaps, recordTouches, selection, takeTouches } from './touch-guards.ts';

/** Counting stand-ins for the wake lock and vibration APIs, and a settable page visibility. */
async function stubPlatform(page: Page, opts: { vibrate?: boolean; wakeLock?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ vibrate, wakeLock }) => {
    const w = window as unknown as { __wake: { requests: number; held: number }; __vibes: number[]; __hidden: boolean };
    w.__wake = { requests: 0, held: 0 };
    w.__vibes = [];
    w.__hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (w.__hidden ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__hidden });
    if (wakeLock) {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            w.__wake.requests++;
            w.__wake.held++;
            const lock = new EventTarget() as EventTarget & { released: boolean; release(): Promise<void> };
            lock.released = false;
            lock.release = async () => {
              if (lock.released) return;
              lock.released = true;
              w.__wake.held--;
              lock.dispatchEvent(new Event('release'));
            };
            return lock;
          },
        },
      });
    } else Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate ? (ms: number) => (w.__vibes.push(ms), true) : undefined });
  }, { vibrate: opts.vibrate ?? true, wakeLock: opts.wakeLock ?? true });
}

const setVisible = (page: Page, visible: boolean) =>
  page.evaluate((v) => {
    (window as unknown as { __hidden: boolean }).__hidden = !v;
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);

const wake = (page: Page) => page.evaluate(() => (window as unknown as { __wake: { requests: number; held: number } }).__wake);

/** The game in normal play, past the opening message, on an idle field. */
async function play(page: Page, stored?: object): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (stored) await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [PHONE_KEY, JSON.stringify(stored)]);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  // A physical key hides the on-screen controls: a touch phone dismisses the message with the on-screen A.
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await page.locator('#buttons [data-button="a"]').tap();
  else await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  return errors;
}

test('a hidden page stops the game, the sound and the wake lock; showing it again resumes them with no catch-up', async ({ page }) => {
  await stubPlatform(page);
  const errors = await play(page);
  // The press above was a gesture: the audio clock runs.
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.audio.context.state)).toBe('running');
  await expect.poll(async () => (await wake(page)).held).toBe(1);

  await setVisible(page, false);
  const at = await page.evaluate(() => ({ ticks: window.openSinnohApp!.ticks, frames: window.openSinnohApp!.loop.frames, dropped: window.openSinnohApp!.loop.dropped }));
  await page.waitForTimeout(1500);
  const hidden = await page.evaluate(() => ({ ticks: window.openSinnohApp!.ticks, frames: window.openSinnohApp!.loop.frames, paused: window.openSinnohApp!.loop.paused, audio: window.openSinnohApp!.audio.context.state }));
  expect(hidden).toMatchObject({ ticks: at.ticks, frames: at.frames, paused: true, audio: 'suspended' });
  expect((await wake(page)).held).toBe(0);

  const resumedAt = await page.evaluate(() => performance.now());
  await setVisible(page, true);
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.ticks)).toBeGreaterThan(at.ticks);
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() => ({ now: performance.now(), ticks: window.openSinnohApp!.ticks, dropped: window.openSinnohApp!.loop.dropped, paused: window.openSinnohApp!.loop.paused, audio: window.openSinnohApp!.audio.context.state }));
  // 1.5 s hidden is 45 ticks: not played back (not even a capped burst), and not counted as dropped ticks: only the ticks
  // of the time since it was shown ran.
  expect(shown.paused).toBe(false);
  expect(shown.ticks - at.ticks).toBeLessThanOrEqual(((shown.now - resumedAt) * 30) / 1000 + 2);
  // (Software GL on a loaded machine may drop a tick or two of its own; the hidden 45 would show as dozens.)
  expect(shown.dropped - at.dropped).toBeLessThan(8);
  expect(shown.audio).toBe('running');
  await expect.poll(async () => (await wake(page)).held).toBe(1);
  expect(errors).toEqual([]);
});

test('Keep screen on off: no wake lock at all; none where the browser has no Wake Lock API', async ({ page }) => {
  await stubPlatform(page);
  await play(page, { size: 1, opacity: 100, haptics: true, keepAwake: false });
  await page.waitForTimeout(500);
  expect(await wake(page)).toEqual({ requests: 0, held: 0 });
  await page.close();
});

test('where the browser has no Wake Lock API the game runs and Options lists no Keep screen on row', async ({ page }) => {
  await stubPlatform(page, { wakeLock: false });
  const errors = await play(page);
  await openDevice(page);
  expect(await rows(page)).not.toContain('keepAwake');
  expect(errors).toEqual([]);
});

/** The start menu's OPTIONS, then its DEVICE page. */
async function openDevice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start menu', exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  const tab = page.locator('[data-screen="options"] [data-section="device"]');
  await expect(async () => {
    await tab.click({ timeout: 3000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
  }).toPass();
}

const rows = (page: Page) => page.locator('[data-screen="options"] [data-setting]').evaluateAll((r) => r.map((e) => e.getAttribute('data-setting')!));

test('haptics: a control press vibrates where the browser can, never where it cannot or the setting is off', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the on-screen controls');
  await stubPlatform(page);
  await play(page);
  const vibes = () => page.evaluate(() => (window as unknown as { __vibes: number[] }).__vibes);
  const start = (await vibes()).length;
  await page.locator('#buttons [data-button="b"]').tap();
  await page.locator('#dpad [data-button="up"]').tap();
  expect((await vibes()).length - start).toBe(2);
  // The setting, from Options › Device.
  await openDevice(page);
  expect(await rows(page)).toEqual(expect.arrayContaining(['controlSize', 'controlOpacity', 'haptics', 'keepAwake']));
  await page.locator('[data-screen="options"] [data-setting="haptics"] .options-value').click();
  await expect.poll(async () => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PHONE_KEY))!)).toMatchObject({ haptics: false });
  // Kept: after a reload a press does not vibrate.
  await page.reload();
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.locator('#buttons [data-button="b"]').tap();
  expect(await vibes()).toEqual([]);
});

test('no vibration API (Safari): the game runs, presses do nothing extra, and Options has no Haptics row', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the on-screen controls');
  await stubPlatform(page, { vibrate: false });
  const errors = await play(page);
  await page.locator('#buttons [data-button="a"]').tap();
  await openDevice(page);
  const list = await rows(page);
  expect(list).not.toContain('haptics');
  expect(list).toContain('controlSize');
  expect(errors).toEqual([]);
});

test('control size and opacity: Options › Device sets them, the layout follows, they are kept', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the on-screen controls');
  await stubPlatform(page);
  await play(page);
  const geometry = () =>
    page.evaluate(() => {
      const l = window.openSinnohApp!.layout;
      const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
      return { main: l.main.height, dpad: box('dpad').toJSON() as { width: number; height: number }, key: document.querySelector('#dpad [data-button="up"]')!.getBoundingClientRect().height, opacity: getComputedStyle(document.getElementById('dpad')!).opacity };
    });
  const m = controlMetrics(1);
  const base = await geometry();
  expect(base.key).toBe(m.key);
  expect(base.opacity).toBe('1');
  await openDevice(page);
  await page.locator('[data-screen="options"] [data-tap="settings:value:controlSize:2"]').click();
  await expect.poll(async () => (await geometry()).key).toBe(controlMetrics(1.25).key);
  await page.locator('[data-screen="options"] [data-tap="settings:value:controlSize:0"]').click();
  await expect.poll(async () => (await geometry()).key).toBe(controlMetrics(0.8).key);
  const small = await geometry();
  // The portrait strip follows the size: a smaller control set gives the field more height, and the boxes match the layout.
  expect(small.main).toBeGreaterThan(base.main);
  expect(small.dpad.height).toBe(controlMetrics(0.8).dpad.height);
  // The fifth of ten cells: 50 %.
  const slider = page.locator('[data-screen="options"] [data-setting="controlOpacity"] .os-sld .cells');
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);
  await expect.poll(async () => (await geometry()).opacity).toBe('0.5');
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PHONE_KEY))!)).toMatchObject({ size: 0, opacity: 50 });
  // Kept across a reload, for the layout and the drawing alike.
  await page.reload();
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  const after = await geometry();
  expect(after).toMatchObject({ key: controlMetrics(0.8).key, opacity: '0.5' });
  expect(after.main).toBe(small.main);
});

test('a script that takes no input fades the controls; a touch brings them back', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the on-screen controls');
  await stubPlatform(page);
  await play(page);
  const opacity = () => page.evaluate(() => getComputedStyle(document.getElementById('buttons')!).opacity);
  expect(await opacity()).toBe('1');
  // A script running with nothing to answer: the same state the field is in during a cut-scene's walk.
  await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    const scripts = game.scripts as unknown as { running(): boolean };
    (window as unknown as { __run: () => boolean }).__run = scripts.running.bind(scripts);
    scripts.running = () => true;
  });
  await expect.poll(opacity).toBe('0.25');
  await page.locator('#buttons [data-button="b"]').tap();
  await expect.poll(opacity).toBe('1');
  await page.evaluate(() => {
    const scripts = window.openSinnohApp!.game.scripts as unknown as { running(): boolean };
    scripts.running = (window as unknown as { __run: () => boolean }).__run;
  });
});

test('fullscreen: a HUD button where the browser has it, hidden where it has not or the app is installed', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop Chromium has real page fullscreen; the phone emulation has the same code path');
  await stubPlatform(page);
  const errors = await play(page);
  const button = page.getByRole('button', { name: 'Fullscreen', exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  expect(errors).toEqual([]);
});

test('no page fullscreen (iPhone Safari) or installed as an app: no fullscreen button', async ({ browser }, info) => {
  for (const [name, init] of [
    ['no Fullscreen API', () => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })],
    ['installed', () => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? ({ ...real('all'), matches: true, media: q } as MediaQueryList) : real(q));
    }],
  ] as const) {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch, isMobile: info.project.use.isMobile, deviceScaleFactor: info.project.use.deviceScaleFactor });
    const page = await context.newPage();
    await page.addInitScript(init);
    await page.goto('/?packs=fixture');
    await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 5);
    await expect(page.getByRole('button', { name: 'Fullscreen', exact: true }), name).toBeHidden();
    await context.close();
  }
});

for (const closed of [true, false]) {
  test(`the save database ${closed ? 'is closed when the page goes away' : 'stays open while the page lives (control)'}`, async ({ page }) => {
    await play(page);
    await saveGame(page);
    if (closed) await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    // A newer database version cannot be opened while the page holds a connection: the request is blocked.
    const blocked = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const req = indexedDB.open('lantern-nds-saves', 2);
          req.onblocked = () => resolve(true);
          req.onsuccess = () => {
            req.result.close();
            resolve(false);
          };
          req.onerror = () => resolve(false);
        }),
    );
    expect(blocked).toBe(!closed);
  });
}

test('the page back from the back/forward cache keeps its save connection (pagehide persisted)', async ({ page }) => {
  await play(page);
  await saveGame(page);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  const blocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('lantern-nds-saves', 2);
        req.onblocked = () => resolve(true);
        req.onsuccess = () => {
          req.result.close();
          resolve(false);
        };
      }),
  );
  expect(blocked).toBe(true);
});

/** The viewport meta's contents as they change (touch.ts zooms a zoomed game back out with a moment of maximum-scale=1). */
async function watchViewportMeta(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]')!;
    const seen: string[] = [];
    (window as unknown as { __meta: string[] }).__meta = seen;
    new MutationObserver(() => seen.push(meta.getAttribute('content')!)).observe(meta, { attributes: true });
  });
  return () => page.evaluate(() => (window as unknown as { __meta: string[] }).__meta);
}

const pinch = async (page: Page, x: number, y: number) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizePinchGesture', { x, y, scaleFactor: 2, gestureSourceType: 'touch' });
  await cdp.detach();
};

test('iPhone: in play, fast d-pad taps neither zoom nor select, a pinch does not zoom the game, and a zoomed game asks to be zoomed out', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch phones');
  await recordTouches(page);
  const errors = await play(page);
  await takeTouches(page);
  await rapidTaps(page, page.locator('#dpad [data-button="left"]'), 6);
  const t = await takeTouches(page);
  expect(t.starts).toEqual(Array(6).fill(true));
  expect(t.pointerdowns).toBe(6);
  expect(await pageScale(page)).toBe(1);
  expect(await selection(page)).toBe('');

  // A pinch on the field or the controls does nothing to the page (the game has its own zoom).
  const field = (await page.locator('#main-canvas').boundingBox())!;
  await pinch(page, field.x + field.width / 2, field.y + field.height / 2);
  const dpad = (await page.locator('#dpad').boundingBox())!;
  await pinch(page, dpad.x + dpad.width / 2, dpad.y + dpad.height / 2);
  expect(await pageScale(page)).toBe(1);

  // A page zoomed anyway (Chromium needs a surface that lets the pinch through): touch.ts asks for maximum-scale=1
  // a moment, then restores the meta. Chromium keeps the scale through a runtime meta change; iOS Safari zooms out.
  const meta = await watchViewportMeta(page);
  const original = await page.locator('meta[name="viewport"]').getAttribute('content');
  await page.evaluate(() => {
    const hole = document.createElement('div');
    hole.id = 'pinch-hole';
    hole.style.cssText = 'position: absolute; inset: 0; z-index: 99; touch-action: auto';
    document.getElementById('game')!.style.touchAction = 'auto';
    document.getElementById('game')!.append(hole);
  });
  await pinch(page, field.x + field.width / 2, field.y + field.height / 2);
  expect(await pageScale(page)).toBeGreaterThan(1.5);
  await expect.poll(meta).toContain(`${original}, maximum-scale=1`);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', original!);
  expect(errors).toEqual([]);
});

test('iPhone: OpenSinnoh screens keep pinch zoom (the ROM page)', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch phones');
  await page.goto('/');
  await expect(page.locator('#rom')).toBeVisible();
  const meta = await watchViewportMeta(page);
  await pinch(page, 195, 400);
  expect(await pageScale(page)).toBeGreaterThan(1.5);
  await page.waitForTimeout(500);
  expect(await meta()).toEqual([]);
  // Its text can be selected.
  const style = await page.evaluate(() => getComputedStyle(document.querySelector('#rom')!).userSelect);
  expect(style).not.toBe('none');
});
