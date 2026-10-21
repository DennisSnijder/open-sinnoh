/**
 * The OpenSinnoh UI gallery (`?ui-gallery`, dev builds; packages/app/src/ui-gallery.ts): every component and
 * state of @opensinnoh/ui in the dark and the light theme, at desktop and at 400 px (a touch phone). Checked in
 * the page: no horizontal overflow, no console errors, every visible text at 4.5:1 against what is really
 * behind it (disabled text exempt), touch targets of 44 px on the phone, and pixel art on whole pixels.
 * Original content only: no ROM.
 */
import { expect, test, type Page } from '@playwright/test';
import { contrast } from '../../packages/ui/src/tokens.ts';
import { axe } from './axe.ts';
import { contrastFailures } from './contrast.ts';

test.describe.configure({ mode: 'parallel' });

async function open(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?ui-gallery');
  await page.waitForFunction(() => document.body.dataset.galleryReady !== undefined);
  // Opening animations (sheet, toast) move their boxes: measure once they have run.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

for (const [name, viewport, touch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['400 px phone', { width: 400, height: 860 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });


    test(`the gallery: overflow, errors, contrast, touch targets, whole pixels (${name})`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop', 'the gallery sets its own viewports: one project runs it');
      const errors: string[] = [];
      await open(page, errors);
      // Both themes are shown, with every icon.
      await expect(page.locator('.gal-theme[data-theme="dark"]')).toHaveCount(1);
      await expect(page.locator('.gal-theme[data-theme="light"]')).toHaveCount(1);
      await expect(page.locator('.gal-theme[data-theme="dark"] .gal-icons figure')).toHaveCount(47);
      expect(await page.evaluate(() => document.documentElement.dataset.density)).toBe(touch ? 'touch' : 'dpad');

      // No horizontal overflow: neither the page nor any box inside it.
      const overflow = await page.evaluate(() => ({
        page: document.scrollingElement!.scrollWidth - innerWidth,
        boxes: [...document.querySelectorAll<HTMLElement>('.gal-card, .gal-theme')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.querySelector('h3')?.textContent ?? e.className),
      }));
      expect(overflow).toEqual({ page: 0, boxes: [] });

      // Text contrast ≥ 4.5 in both themes, computed in the page.
      expect(await contrastFailures(page, '.gal')).toEqual([]);

      // Touch targets ≥ 44 px on the phone.
      if (touch) {
        const small = await page.evaluate(() =>
          // A file picker's input is hidden inside its label: the label is the target.
          [...document.querySelectorAll<HTMLElement>('.gal button, .gal [role="slider"], .gal input:not([type="file"]), .gal .os-file, .gal summary')]
            .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.os-tip, .os-lbx'))
            .map((e) => ({ e, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.width < 44 - 0.5 || r.height < 44 - 0.5)
            .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent!.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`),
        );
        expect(small).toEqual([]);
      }

      // The brand art: the mark and the wordmark in both themes, at whole scales; the wordmark's ink and
      // gold at 4.5:1 on the window face behind it.
      expect(await page.locator('.gal-theme[data-theme="dark"] .os-brand').count()).toBe(6);
      const brand = await page.evaluate(() => {
        const lum = (s: string) => {
          const c = s.match(/\d+/g)!.slice(0, 3).map((v) => +v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
        };
        const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        const out: string[] = [];
        for (const svg of document.querySelectorAll<SVGSVGElement>('.gal .os-brand')) {
          const r = svg.getBoundingClientRect();
          const vb = svg.viewBox.baseVal;
          if (r.width / vb.width !== Math.round(r.width / vb.width) || r.height / vb.height !== r.width / vb.width) out.push(`${svg.getAttribute('class')} scale ${r.width / vb.width}`);
          const bg = getComputedStyle(svg.closest('.gal-card')!).backgroundColor;
          for (const g of svg.querySelectorAll<SVGGElement>('g[style*="--os-ink)"], g[style*="--os-accent"]')) {
            const k = ratio(getComputedStyle(g).fill, bg);
            if (k < 4.5) out.push(`${svg.closest('[data-theme]')!.getAttribute('data-theme')} ${g.getAttribute('style')} ${k.toFixed(2)}`);
          }
        }
        return out;
      });
      expect(brand).toEqual([]);

      // Pixel art on whole pixels (the snap pass has run).
      const off = await page.evaluate(() =>
        [...document.querySelectorAll('.os-win, .os-btn, .os-tab, .os-file.quiet, .os-ico, .os-cnt, .os-bdg, .os-tgl .tr, .os-sld .cell, .os-prog .cells i, .os-brand')]
          .filter((e) => e.getClientRects().length)
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => Math.abs(r.left - Math.round(r.left)) > 0.01 || Math.abs(r.top - Math.round(r.top)) > 0.01)
          .map(({ e, r }) => `${e.getAttribute('class')} ${r.left.toFixed(2)},${r.top.toFixed(2)}`),
      );
      expect(off).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

for (const width of [320, 400, 1280]) {
  test.describe(`${width} px interactions`, () => {
    test.use({ viewport: { width, height: 860 }, hasTouch: width < 480, isMobile: width < 480 });
    for (const theme of ['dark', 'light']) {
      test(`tabs reveal their edges and select opens in the right surface (${theme})`, async ({ page }) => {
        test.skip(test.info().project.name !== 'desktop', 'one project runs the gallery viewports');
        const errors: string[] = [];
        await open(page, errors);
        const col = page.locator(`.gal-theme[data-theme="${theme}"]`);
        const strip = col.locator('.gal-narrow .os-tabs-wrap');
        await expect(strip).toHaveClass(/has-overflow/);
        await expect(strip).toHaveClass(/more-after/);
        await expect(strip).not.toHaveClass(/more-before/);
        await expect(strip.getByRole('button', { name: 'Previous tabs' })).toBeHidden();
        while (await strip.getByRole('button', { name: 'Next tabs' }).isVisible()) {
          await strip.getByRole('button', { name: 'Next tabs' }).click();
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
        await expect(strip).toHaveClass(/more-before/);
        await expect(strip).not.toHaveClass(/more-after/);
        while (await strip.getByRole('button', { name: 'Previous tabs' }).isVisible()) {
          await strip.getByRole('button', { name: 'Previous tabs' }).click();
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
        await expect(strip).not.toHaveClass(/more-before/);
        await strip.getByRole('tab', { name: 'Game', exact: true }).focus();
        await page.keyboard.press('End');
        await expect(strip.getByRole('tab', { name: 'Privacy' })).toBeFocused();
        await expect(strip.getByRole('tab', { name: 'Privacy' })).toHaveAttribute('aria-selected', 'true');
        await expect(strip).not.toHaveClass(/more-after/);
        // The focused tab is wholly visible, with its underline and no extra focus ring.
        expect(await strip.locator('.os-tabs').evaluate((list) => {
          const focus = document.activeElement!.getBoundingClientRect();
          const r = list.getBoundingClientRect();
          return focus.left >= r.left && focus.right <= r.right;
        })).toBe(true);

        if (width === 400) await strip.screenshot({ path: `test-artifacts/ui-gallery/tabs-${theme}.png` });
        const trigger = col.getByRole('button', { name: /^Language / });
        if (width <= 480) await trigger.tap();
        else await trigger.click();
        const list = col.getByRole('listbox', { name: 'Language' });
        await expect(list).toBeFocused();
        if (width <= 480) {
          const modal = col.locator('dialog[open]');
          await expect(modal).toBeVisible();
          await expect(modal).toHaveCSS('border-radius', '0px');
          await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
          expect(await modal.evaluate((e) => e.matches(':modal'))).toBe(true);
          expect(await list.getByRole('option').evaluateAll((items) => items.every((e) => e.getBoundingClientRect().height >= 44))).toBe(true);
          expect(await list.evaluate((e) => e.scrollHeight > e.clientHeight && e.clientHeight <= 6 * 44 + 8)).toBe(true);
          const r = await modal.locator('.os-sheet').boundingBox();
          expect(Math.abs(r!.y + r!.height - 860)).toBeLessThan(1);
          // Native modality keeps Tab on the sheet's two controls.
          await page.keyboard.press('Tab');
          const close = modal.getByRole('button', { name: 'Close', exact: true });
          await expect(close).toBeFocused();
          const mark = await close.evaluate((e) => {
            const cs = getComputedStyle(e);
            return { ink: cs.outlineColor, background: getComputedStyle(e.closest('.os-tab')!).backgroundColor, shadow: cs.boxShadow, reach: parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset) };
          });
          if (contrast(mark.ink, mark.background) < 3) {
            const backing = /rgba?\([^)]+\)/.exec(mark.shadow)?.[0];
            expect(backing, 'the focus ring needs a contrasting backing on the title bar').toBeTruthy();
            expect(contrast(mark.ink, backing!)).toBeGreaterThanOrEqual(3);
            const spread = [...mark.shadow.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1])).at(-1)!;
            expect(spread).toBeGreaterThanOrEqual(mark.reach);
          }
          if (width === 400) await page.screenshot({ path: `test-artifacts/ui-gallery/close-focus-${theme}.png` });
          await page.keyboard.press('Tab');
          await expect(list).toBeFocused();
          await page.keyboard.press('Shift+Tab');
          await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
          await page.keyboard.press('Shift+Tab');
          await expect(list).toBeFocused();
          const { violations } = await axe(page, 'dialog[open]');
          expect(violations).toEqual([]);
          expect(await contrastFailures(page, 'dialog[open]')).toEqual([]);
          if (width === 400) await page.screenshot({ path: `test-artifacts/ui-gallery/select-${theme}.png` });
        } else await expect(col.locator('dialog[open]')).toHaveCount(0);
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveText('Polski');
        await expect(col.locator('.gal-select-result')).toHaveText('Selected language: Polski');
        await trigger.click();
        await expect(list.locator('[aria-selected="true"]')).toHaveText('Polski');
        await page.keyboard.press('Home');
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveText('Polski');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        // Touch/pointer selection works too, and dismissing never changes the value.
        await trigger.click();
        await list.getByRole('option', { name: 'Deutsch', exact: true }).click();
        await expect(trigger).toHaveText('Deutsch');
        await trigger.click();
        if (width <= 480) await col.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
        else await col.getByRole('heading', { name: 'Text input and select', exact: true }).click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toHaveText('Deutsch');
        if (width === 1280) {
          // The sheet breakpoint reads its screen container, even on a wide viewport.
          await col.evaluate((e) => { e.style.width = '400px'; });
          await trigger.click();
          await expect(col.locator('dialog[open]')).toBeVisible();
          await page.keyboard.press('Escape');
          await col.evaluate((e) => { e.style.width = ''; });
          // Removing overflow removes the arrows; narrowing again preserves the selected tab.
          await col.locator('.gal-narrow').evaluate((e) => { e.style.maxWidth = 'none'; });
          await expect(strip).not.toHaveClass(/has-overflow/);
          await expect(strip.getByRole('button', { name: 'Next tabs' })).toBeHidden();
          await col.locator('.gal-narrow').evaluate((e) => { e.style.maxWidth = ''; });
          await expect(strip).toHaveClass(/has-overflow/);
          await expect(strip).not.toHaveClass(/more-after/);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}
