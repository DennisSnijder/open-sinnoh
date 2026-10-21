/**
 * Field zoom on the fixture pack: the OPTIONS setting and the desktop shortcuts (Ctrl + wheel, Ctrl +/−/0)
 * change the field's scale and the drawn field, persist across a reload, and a plain wheel does nothing.
 * Phones keep Auto and still offer the setting. Render scale: phones draw the field's 3D at 2 device px per CSS px
 * (Auto) while the 2D layers keep the full ratio; FULL in OPTIONS draws it at the device's ratio, stored.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  // Play through the fixture's intro message, until the field is idle (menus open).
  const idle = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 600; i++) {
      const s = g.snapshot();
      if (window.openSinnohApp!.game.state.vars['fixture:VAR_ROOM_INTRO' as never] === 1 && !s.scriptRunning && window.openSinnohApp!.game.canSave()) return true;
      if (s.view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    return false;
  });
  expect(idle).toBe(true);
  await page.waitForFunction(() => !window.openSinnohApp!.sceneLoading());
  return errors;
}

const zoom = (page: Page) => page.evaluate(() => window.openSinnohApp!.zoom());
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('lantern-nds:zoom'));
const fieldShot = async (page: Page) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.locator('#main-canvas').screenshot();
};

async function ctrlWheel(page: Page, deltaY: number): Promise<boolean> {
  await page.evaluate(() => {
    (window as { lastWheelPrevented?: boolean }).lastWheelPrevented = undefined;
    addEventListener('wheel', (e) => ((window as { lastWheelPrevented?: boolean }).lastWheelPrevented = e.defaultPrevented), { once: true });
  });
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  return page.waitForFunction(() => (window as { lastWheelPrevented?: boolean }).lastWheelPrevented !== undefined).then(() => page.evaluate(() => (window as { lastWheelPrevented?: boolean }).lastWheelPrevented!));
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 1200 } });

  test('zoom by shortcut and by OPTIONS, stored across a reload; a plain wheel does nothing', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'desktop shortcuts');
    test.setTimeout(120_000);
    const errors = await open(page);
    // Auto: the DS view just fits (1200 / 192 = 6.25 CSS px per DS px).
    expect(await zoom(page)).toEqual({ setting: 'auto', scale: 6.25 });
    const auto = await fieldShot(page);
    await page.mouse.move(800, 600);

    // A plain wheel is the page's (lists and menus): no zoom, not prevented.
    await page.evaluate(() => addEventListener('wheel', (e) => ((window as { plainPrevented?: boolean }).plainPrevented = e.defaultPrevented), { once: true }));
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => (window as { plainPrevented?: boolean }).plainPrevented !== undefined);
    expect(await page.evaluate(() => (window as { plainPrevented?: boolean }).plainPrevented)).toBe(false);
    expect(await zoom(page)).toEqual({ setting: 'auto', scale: 6.25 });
    await expect(page.locator('.ui-toast')).toBeHidden();

    // Ctrl + wheel down zooms out a whole step from Auto's fit, the browser's page zoom prevented.
    expect(await ctrlWheel(page, 100)).toBe(true);
    expect(await zoom(page)).toEqual({ setting: 6, scale: 6 });
    await expect(page.locator('.ui-toast')).toHaveText('Zoom 6x');
    expect(await ctrlWheel(page, 100)).toBe(true);
    expect(await zoom(page)).toEqual({ setting: 5, scale: 5 });
    await expect(page.locator('.ui-toast')).toHaveText('Zoom 5x');
    const five = await fieldShot(page);
    expect(five.equals(auto)).toBe(false);
    // Ctrl + wheel up zooms in; Ctrl + − and Ctrl + 0 (Auto).
    expect(await ctrlWheel(page, -100)).toBe(true);
    expect((await zoom(page)).scale).toBe(6);
    await page.keyboard.press('Control+Minus');
    expect((await zoom(page)).scale).toBe(5);
    await page.keyboard.press('Control+Digit0');
    expect(await zoom(page)).toEqual({ setting: 'auto', scale: 6.25 });
    await expect(page.locator('.ui-toast')).toHaveText('Zoom Auto');
    // The minimum: at most 2.5 DS views high (1200 / 480 → 3); steps stop there.
    for (let i = 0; i < 6; i++) await page.keyboard.press('Control+Minus');
    expect(await zoom(page)).toEqual({ setting: 3, scale: 3 });
    expect(await stored(page)).toBe('3');

    // OPTIONS: the Zoom setting lists Auto and the window's whole scales.
    await page.keyboard.press('Control+Digit0');
    await page.keyboard.down('Enter');
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    await page.keyboard.up('Enter');
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    await page.locator('[data-screen="start-menu"]').getByRole('button', { name: 'SETTINGS' }).click();
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    const options = page.locator('[data-screen="options"]');
    await options.locator('[data-section="device"]').click();
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    const value = options.locator('[data-setting="zoom"] .options-value');
    // The arrows step through Auto and the window's whole scales (and wrap).
    await expect(value).toHaveText('AUTO');
    for (const next of ['3x', '4x', '5x', '6x', 'AUTO']) {
      await options.getByRole('button', { name: 'Next ZOOM' }).click();
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      await expect(value).toHaveText(next);
    }
    await options.getByRole('button', { name: 'Next ZOOM' }).click();
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    await options.getByRole('button', { name: 'Next ZOOM' }).click();
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    expect(await zoom(page)).toEqual({ setting: 4, scale: 4 });
    expect(await stored(page)).toBe('4');
    const four = await fieldShot(page);
    expect(four.equals(five)).toBe(false);

    // Stored on the device: a reload keeps it.
    await page.reload();
    await page.waitForFunction(() => window.openSinnohGame?.ready === true);
    expect(await zoom(page)).toEqual({ setting: 4, scale: 4 });
    expect(errors).toEqual([]);
  });
});

test('phones keep Auto and offer the setting in OPTIONS', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  const errors = await open(page);
  const { width, height } = await page.evaluate(() => window.openSinnohApp!.layout.main);
  expect(await zoom(page)).toEqual({ setting: 'auto', scale: Math.min(width / 256, height / 192) });
  await page.locator('.ui-hud').getByRole('button', { name: 'Start menu' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await page.locator('[data-screen="start-menu"]').getByRole('button', { name: 'SETTINGS' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  const options = page.locator('[data-screen="options"]');
  await options.locator('[data-section="device"]').tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  const value = options.locator('[data-setting="zoom"] .options-value');
  await expect(value).toHaveText('AUTO');
  await options.getByRole('button', { name: 'Next ZOOM' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await expect(value).toHaveText('1x');
  await options.getByRole('button', { name: 'Next ZOOM' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await expect(value).toHaveText('AUTO');
  expect(errors).toEqual([]);
});

test('render scale: Auto caps the phone field at DPR 2, the 2D layers stay sharp; FULL is stored', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'coarse pointers only');
  const errors = await open(page);
  const buffers = () =>
    page.evaluate(() => {
      const main = document.getElementById('main-canvas') as HTMLCanvasElement;
      const overlay = document.getElementById('overlay-canvas') as HTMLCanvasElement;
      return { css: main.clientWidth, main: main.width, overlay: overlay.width, render: window.openSinnohApp!.renderScale() };
    });
  const auto = await buffers();
  expect(auto.render).toEqual({ setting: 'auto', pixelRatio: 2 });
  expect(auto.main).toBe(auto.css * 2);
  expect(auto.overlay).toBe(auto.css * 3);
  await page.locator('.ui-hud').getByRole('button', { name: 'Start menu' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await page.locator('[data-screen="start-menu"]').getByRole('button', { name: 'SETTINGS' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  const options = page.locator('[data-screen="options"]');
  await options.locator('[data-section="device"]').tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await options.locator('[data-setting="renderScale"]').getByRole('button', { name: 'FULL' }).tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  const full = await buffers();
  expect(full.render).toEqual({ setting: 'full', pixelRatio: 3 });
  expect(full.main).toBe(full.css * 3);
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:render-scale'))).toBe('full');
  await page.reload();
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  expect((await buffers()).render).toEqual({ setting: 'full', pixelRatio: 3 });
  expect(errors).toEqual([]);
});
