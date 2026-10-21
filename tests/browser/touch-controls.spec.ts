/**
 * On-screen touch controls and HUD buttons on the fixture pack, on phones in portrait (375×812, 390×844)
 * and landscape (844×390): every glyph centred in its button, every control on screen and unobstructed,
 * no text selection / callout / context menu, crisp (unfiltered) HUD icons. Screenshots go to
 * test-artifacts/touch-controls.
 */
import { expect, test, type Page } from '@playwright/test';
import { press, skipSetup } from './intro.ts';
import { expectGameSurface, pageScale, rapidTaps, recordTouches, selection, takeTouches, touchStyles } from './touch-guards.ts';

const SHOTS = 'test-artifacts/touch-controls';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Control {
  name: string;
  box: Box;
  label: Box;
  /** The element at the box's centre is this control (nothing covers it). */
  hit: boolean;
  userSelect: string;
  callout: string;
  /** The contextmenu event was cancelled. */
  noMenu: boolean;
  /** Filters on the control, its label or any ancestor. */
  filters: string[];
}

async function controls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const buttons = [...document.querySelectorAll<HTMLElement>('.controls button, .hud-button')].filter((b) => b.getClientRects().length > 0);
    return buttons.map((b) => {
      const label = b.firstElementChild!;
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      const filters: string[] = [];
      for (let e: Element | null = label; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        for (const f of [s.filter, s.backdropFilter, s.getPropertyValue('-webkit-backdrop-filter')]) if (f && f !== 'none') filters.push(`${e.tagName}: ${f}`);
      }
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      return {
        name: b.dataset.button ?? b.getAttribute('aria-label')!,
        box: box(r),
        label: box(label.getBoundingClientRect()),
        hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b,
        userSelect: cs.userSelect || cs.webkitUserSelect,
        callout: cs.getPropertyValue('-webkit-touch-callout'),
        noMenu: !b.dispatchEvent(menu),
        filters,
      };
    });
  });
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

for (const { width, height } of [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test.describe(`${width}×${height}`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    test('controls and HUD buttons: centred, on screen, unobstructed, no selection or menus, crisp icons', async ({ page }, info) => {
      test.skip(info.project.name !== 'phone', 'phone-only (the viewport is set here)');
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/?packs=fixture&replay');
      await page.waitForFunction(() => window.openSinnohGame?.ready === true);
      await expect(page.locator('#dpad')).toBeVisible();
      await expect(page.locator('.ui-hud .hud-menu')).toBeVisible();

      const all = await controls(page);
      // Four d-pad keys, A/B/X/Y, Select/Start, and at least the start-menu HUD button (the one way to Options).
      expect(all.map((c) => c.name)).toEqual(expect.arrayContaining(['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'select', 'start', 'Start menu']));
      expect(all.map((c) => c.name)).not.toContain('Settings');
      const view = { x: 0, y: 0, width, height };
      const main = (await page.locator('#main-canvas').boundingBox())!;
      for (const c of all) {
        const at = `${c.name} ${JSON.stringify(c.box)} label ${JSON.stringify(c.label)}`;
        expect(Math.abs(c.label.x + c.label.width / 2 - (c.box.x + c.box.width / 2)), at).toBeLessThanOrEqual(2);
        expect(Math.abs(c.label.y + c.label.height / 2 - (c.box.y + c.box.height / 2)), at).toBeLessThanOrEqual(2);
        expect(inside(c.label, c.box), at).toBe(true);
        expect(inside(c.box, view), at).toBe(true);
        expect(Math.min(c.box.width, c.box.height), at).toBeGreaterThanOrEqual(44);
        expect(c.hit, at).toBe(true);
        expect(c.userSelect, at).toBe('none');
        // Chromium does not implement -webkit-touch-callout (WebKit does): checked where it is known.
        if (c.callout) expect(c.callout, at).toBe('none');
        expect(c.noMenu, at).toBe(true);
        expect(c.filters, at).toEqual([]);
        // In portrait the controls sit in their own strip, clear of the field view.
        if (height > width && !c.name.match(/^[A-Z]/)) expect(overlaps(c.box, main), at).toBe(false);
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!.box, all[j]!.box), `${all[i]!.name} / ${all[j]!.name}`).toBe(false);

      // HUD icons: whole device pixels per icon pixel (12 × 2 CSS px), at a whole-device-pixel position.
      const icons = await page.evaluate(() => [...document.querySelectorAll('.hud-button .ui-icon')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().toJSON() as Box));
      expect(icons.length).toBeGreaterThanOrEqual(1);
      for (const r of icons) {
        expect(r.width).toBe(24);
        expect(r.height).toBe(24);
        expect(Number.isInteger(r.x * 3) && Number.isInteger(r.y * 3)).toBe(true);
      }
      await page.evaluate(() => window.openSinnohGame!.advance(2));
      await page.screenshot({ path: `${SHOTS}/${width}x${height}.png` });
      expect(errors).toEqual([]);
    });
  });
}

/**
 * The composition, measured on the page at sizes S/M/L from small to large phones, landscape and tablets, some with
 * notch insets: the d-pad and the diamond mirror each other about the centre line (centres level), Select and Start
 * are centred (portrait: on the centre line; landscape: under the d-pad and the diamond, mirrored), the drawn margins
 * above and below the controls in the portrait strip are equal, and no two controls overlap. Within 1 px.
 */
const SIZES: { width: number; height: number; insets?: { top: number; right: number; bottom: number; left: number } }[] = [
  { width: 320, height: 568 },
  { width: 375, height: 812, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { width: 390, height: 844 },
  { width: 430, height: 932, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { width: 820, height: 1180, insets: { top: 24, right: 0, bottom: 20, left: 0 } },
  { width: 568, height: 320 },
  { width: 844, height: 390, insets: { top: 0, right: 47, bottom: 21, left: 47 } },
  { width: 1180, height: 820 },
];

test.describe('composition', () => {
  test.use({ deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  for (const size of [0, 1, 2]) {
    test(`size ${'SML'[size]}: mirrored clusters, Select and Start centred, equal margins, nothing overlaps`, async ({ page }, info) => {
      test.skip(info.project.name !== 'phone', 'phone-only (the viewports are set here)');
      await page.addInitScript((s) => localStorage.setItem('lantern-nds:phone', JSON.stringify({ size: s })), size);
      await page.goto('/?packs=fixture&replay');
      await page.waitForFunction(() => window.openSinnohGame?.ready === true);
      for (const { width, height, insets } of SIZES) {
        await page.setViewportSize({ width, height });
        const ins = insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
        await page.evaluate((i) => window.openSinnohSafeArea!(i), ins);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const g = await page.evaluate(() => {
          const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().toJSON() as Box;
          // A pill's hit area and its drawn capsule (the ::before, inset in the hit area).
          const pill = (name: string) => {
            const b = document.querySelector<HTMLElement>(`[data-button="${name}"]`)!;
            const box = b.getBoundingClientRect();
            const before = getComputedStyle(b, '::before');
            const top = parseFloat(before.top);
            const side = parseFloat(before.left);
            return { box: box.toJSON() as Box, drawn: { x: box.x + side, y: box.y + top, width: box.width - 2 * side, height: box.height - 2 * top } };
          };
          const buttons = [...document.querySelectorAll<HTMLElement>('.controls button')].map((b) => ({ name: b.dataset.button!, box: b.getBoundingClientRect().toJSON() as Box }));
          return { main: r('#main-canvas'), dpad: r('#dpad'), diamond: r('#buttons'), select: pill('select'), start: pill('start'), buttons };
        });
        const at = `${width}×${height} size ${'SML'[size]}`;
        const cx = (b: Box) => b.x + b.width / 2;
        const cy = (b: Box) => b.y + b.height / 2;
        const portrait = height > width;
        const line = portrait ? ins.left + (width - ins.left - ins.right) / 2 : width / 2;
        expect(Math.abs(cx(g.dpad) + cx(g.diamond) - 2 * line), `${at}: clusters mirrored`).toBeLessThanOrEqual(1);
        expect(Math.abs(cy(g.dpad) - cy(g.diamond)), `${at}: clusters level`).toBeLessThanOrEqual(1);
        expect(Math.abs(cx(g.select.box) + cx(g.start.box) - 2 * line), `${at}: Select and Start centred`).toBeLessThanOrEqual(1);
        expect(Math.abs(g.select.box.y - g.start.box.y), `${at}: Select and Start level`).toBeLessThanOrEqual(1);
        const drawnBottom = g.select.drawn.y + g.select.drawn.height;
        if (portrait) {
          // Equal drawn margins: the field view's bottom to the row's top, the pills' capsules to the bottom inset.
          const above = Math.min(g.dpad.y, g.diamond.y) - (g.main.y + g.main.height);
          const below = height - ins.bottom - drawnBottom;
          expect(above, `${at}: a margin above`).toBeGreaterThan(0);
          expect(Math.abs(above - below), `${at}: margins ${above} above, ${below} below`).toBeLessThanOrEqual(1);
          // The pills sit below the row, between the clusters' centres.
          expect(g.select.box.y, at).toBeGreaterThanOrEqual(g.dpad.y + g.dpad.height - 0.5);
          expect(g.select.box.x, at).toBeGreaterThan(cx(g.dpad));
          expect(g.start.box.x + g.start.box.width, at).toBeLessThan(cx(g.diamond));
        } else {
          expect(Math.abs(cx(g.select.box) - cx(g.dpad)), `${at}: Select under the d-pad`).toBeLessThanOrEqual(1);
          expect(Math.abs(cx(g.start.box) - cx(g.diamond)), `${at}: Start under the diamond`).toBeLessThanOrEqual(1);
          expect(drawnBottom, `${at}: clear of the bottom inset`).toBeLessThanOrEqual(height - ins.bottom - 8);
        }
        const safe = { x: ins.left, y: ins.top, width: width - ins.left - ins.right, height: height - ins.top - ins.bottom };
        for (let i = 0; i < g.buttons.length; i++) {
          const a = g.buttons[i]!;
          expect(inside(a.box, safe), `${at}: ${a.name} in the safe area`).toBe(true);
          if (size > 0) expect(Math.min(a.box.width, a.box.height), `${at}: ${a.name} target`).toBeGreaterThanOrEqual(44);
          for (let j = i + 1; j < g.buttons.length; j++) expect(overlaps(a.box, g.buttons[j]!.box), `${at}: ${a.name} / ${g.buttons[j]!.name}`).toBe(false);
        }
        if (size === 1 && !insets) await page.screenshot({ path: `${SHOTS}/composition-${width}x${height}.png` });
      }
    });
  }
});

/**
 * iPhone (touch.ts): no text-selection loupe, callout or double-tap zoom on the controls, the field, the title and
 * Rowan's intro. Chromium reproduces neither the loupe nor the zoom (no double-tap zoom on a `width=device-width`
 * page), so this checks what prevents them on iOS: the styles, the cancelled touch events, the page scale, and that
 * every fast tap still presses once.
 */
test.describe('iPhone touch', () => {
  test.beforeEach(({ page: _ }, info) => test.skip(info.project.name !== 'phone', 'phone-only'));

  test('the controls and the field: no selection, callout or zoom; fast taps on the d-pad each press', async ({ page }) => {
    await recordTouches(page);
    await page.goto('/?packs=fixture&replay');
    await page.waitForFunction(() => window.openSinnohGame?.ready === true);
    await expect(page.locator('#dpad')).toBeVisible();
    // Double-tap zoom is off page-wide (pinch zoom stays where allowed); the game view takes no browser gesture at all.
    expectGameSurface(await touchStyles(page, ['#game']), { '#game': 'none' });
    expect((await touchStyles(page, ['html']))[0]!.touchAction).toBe('manipulation');
    const controls = ['#dpad', '#buttons', '#select-pill', '#start-pill'];
    const keys = ['#dpad [data-button="up"]', '#dpad [data-button="left"]', '#buttons [data-button="a"]', '#buttons [data-button="y"]', '#select-pill button', '#start-pill button'];
    expectGameSurface(await touchStyles(page, [...controls, ...keys]), Object.fromEntries(keys.map((k) => [k, 'none'])));

    await takeTouches(page);
    await rapidTaps(page, page.locator('#dpad [data-button="up"]'), 6);
    await rapidTaps(page, page.locator('#buttons [data-button="b"]'), 4);
    const t = await takeTouches(page);
    // Every touch on a control is cancelled (no loupe, callout, selection or zoom on iOS); the pointer presses still come.
    expect(t.starts).toEqual(Array(10).fill(true));
    expect(t.pointerdowns).toBe(10);
    expect(t.clicks).toBe(0);
    expect(await pageScale(page)).toBe(1);
    expect(await selection(page)).toBe('');
  });

  test("the title and Rowan's intro: no selection, callout or zoom; fast taps on the message each click once", async ({ page }) => {
    test.setTimeout(120_000);
    await skipSetup(page);
    await recordTouches(page);
    await page.goto('/?packs=fixture&title');
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked);
    expectGameSurface(await touchStyles(page, ['.title', '.title-prompt']), { '.title': 'manipulation' });
    await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
    await page.locator('#title').tap();
    await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase)).toBe('menu');
    await page.locator('.tm-new-game').tap();
    const intro = page.getByRole('dialog', { name: 'New game' });
    const box = intro.locator('.msg-box');
    await expect(box).toContainText('Hello, traveler!', { timeout: 20_000 });
    expectGameSurface(await touchStyles(page, ['.intro-scene', '.ds-scene-stage', '.intro-scene .msg-box']), {});

    await takeTouches(page);
    await rapidTaps(page, box, 4);
    const t = await takeTouches(page);
    // The first tap is the browser's own; each fast one after it cancels its touchend (no zoom) and clicks itself.
    expect(t.ends).toEqual([false, true, true, true]);
    expect(t.clicks).toBe(4);
    expect(await pageScale(page)).toBe(1);
    expect(await selection(page)).toBe('');
    // The intro still runs on (the taps turned its pages).
    await press(page, 'KeyZ');
  });
});

/**
 * The title, the main menu and Rowan's intro on phones: the same touch controls as the field, laid out as there, and
 * they drive those screens the way the keyboard does (Start on PRESS START, the d-pad's cursor, A, B). The title's box
 * is the field's area (above the portrait strip), so nothing of its composition sits under a control.
 */
for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test.describe(`title controls ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    test('the controls show on the title, the main menu and the intro, clear of their composition, and drive them', async ({ page }, info) => {
      test.skip(info.project.name !== 'phone', 'phone-only (the viewport is set here)');
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await skipSetup(page);
      await page.goto('/?packs=fixture&title');
      await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked);
      await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
      const boxes = ['#dpad', '#buttons', '#select-pill', '#start-pill'];
      for (const b of boxes) await expect(page.locator(b)).toBeVisible();
      const rects = async (selectors: string[]) => Promise.all(selectors.map(async (s) => ({ s, box: (await page.locator(s).first().boundingBox())! })));
      const controls = await rects(boxes);
      const view = { x: 0, y: 0, width, height };
      /** On screen, and under no control (portrait: the whole title box is above the strip). */
      const clear = async (selectors: string[]) => {
        for (const { s, box } of await rects(selectors)) {
          expect(inside(box, view), s).toBe(true);
          for (const c of controls) expect(overlaps(box, c.box), `${s} / ${c.s}`).toBe(false);
        }
      };
      await clear(height > width ? ['#title', '.title-brand', '.title-legal'] : ['.title-brand', '.title-legal']);
      await page.screenshot({ path: `${SHOTS}/title-${width}x${height}.png` });

      // PRESS START: the Start pill.
      await page.locator('#start-pill button').tap();
      await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase), { timeout: 20_000 }).toBe('menu');
      for (const b of boxes) await expect(page.locator(b)).toBeVisible();
      await clear(['.tm-new-game', '.tm-options']);
      // The cursor on the d-pad, B back to the title, A to confirm.
      expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('new-game');
      await page.locator('#dpad [data-button="down"]').tap();
      await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.focused)).not.toBe('new-game');
      await page.locator('#dpad [data-button="up"]').tap();
      await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.focused)).toBe('new-game');
      await page.locator('#buttons [data-button="b"]').tap();
      await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase)).toBe('title');
      await page.waitForFunction(() => !window.openSinnohTitle!.inputBlocked);
      await page.locator('#buttons [data-button="a"]').tap();
      await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase), { timeout: 20_000 }).toBe('menu');
      await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.focused)).toBe('new-game');
      await page.locator('#buttons [data-button="a"]').tap();

      // Rowan's intro: the controls stay; A turns the message's pages; the stage and the box are clear of them.
      const intro = page.getByRole('dialog', { name: 'New game' });
      const box = intro.locator('.msg-box');
      await expect(box).toContainText('Hello, traveler!', { timeout: 20_000 });
      for (const b of boxes) await expect(page.locator(b)).toBeVisible();
      await clear(['.ds-scene-stage', '.intro-scene .msg-box']);
      await page.screenshot({ path: `${SHOTS}/intro-${width}x${height}.png` });
      await expect(intro.locator('.msg-box.waiting')).toBeVisible({ timeout: 20_000 });
      const before = await box.textContent();
      await page.locator('#buttons [data-button="a"]').tap();
      await expect.poll(() => box.textContent(), { timeout: 15_000 }).not.toBe(before);
      expect(errors).toEqual([]);
    });
  });
}
