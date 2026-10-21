/**
 * iPhone touch checks (packages/app/src/touch.ts, style.css, title.css). Chromium shows no loupe and does no double-tap
 * zoom on a `width=device-width` page, so the specs check what stops them on iOS: the computed styles, that the
 * controls cancel `touchstart`, that a fast second tap cancels its `touchend` and still clicks once, and the page scale.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export interface TouchStyle {
  selector: string;
  userSelect: string;
  /** Empty where the browser does not implement it (Chromium). */
  callout: string;
  touchAction: string;
}

export function touchStyles(page: Page, selectors: string[]): Promise<TouchStyle[]> {
  return page.evaluate((selectors) =>
    selectors.map((selector) => {
      const e = document.querySelector(selector);
      if (!e) throw new Error(`no ${selector}`);
      const cs = getComputedStyle(e);
      return { selector, userSelect: cs.userSelect || cs.webkitUserSelect, callout: cs.getPropertyValue('-webkit-touch-callout'), touchAction: cs.touchAction };
    }),
  selectors);
}

/** No selection, no callout (where known), and the touch action. */
export function expectGameSurface(styles: TouchStyle[], touchAction: Record<string, string>): void {
  for (const s of styles) {
    expect(s.userSelect, s.selector).toBe('none');
    if (s.callout) expect(s.callout, s.selector).toBe('none');
    if (touchAction[s.selector]) expect(s.touchAction, s.selector).toBe(touchAction[s.selector]);
  }
}

/** Records, after the app's own listeners, whether each touchstart and touchend was cancelled, and the clicks. */
export async function recordTouches(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const t = { starts: [] as boolean[], ends: [] as boolean[], clicks: 0, pointerdowns: 0 };
    (window as unknown as { __touches: typeof t }).__touches = t;
    addEventListener('touchstart', (e) => t.starts.push(e.defaultPrevented));
    addEventListener('touchend', (e) => t.ends.push(e.defaultPrevented));
    addEventListener('click', () => t.clicks++);
    addEventListener('pointerdown', () => t.pointerdowns++);
  });
}

export interface Touches {
  starts: boolean[];
  ends: boolean[];
  clicks: number;
  pointerdowns: number;
}

export async function takeTouches(page: Page): Promise<Touches> {
  return page.evaluate(() => {
    const w = window as unknown as { __touches: Touches };
    const t = { ...w.__touches };
    w.__touches.starts = [];
    w.__touches.ends = [];
    w.__touches.clicks = 0;
    w.__touches.pointerdowns = 0;
    return t;
  });
}

/** `n` taps at the centre of `target` as fast as Playwright sends them (each well inside iOS's double-tap window). */
export async function rapidTaps(page: Page, target: Locator, n: number): Promise<void> {
  const b = (await target.boundingBox())!;
  for (let i = 0; i < n; i++) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

export const pageScale = (page: Page) => page.evaluate(() => window.visualViewport!.scale);
export const selection = (page: Page) => page.evaluate(() => getSelection()?.toString() ?? '');
