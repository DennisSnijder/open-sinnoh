/**
 * OpenSinnoh's own screens in German (a German browser, the fixture pack: no import, so the shell speaks German) on
 * the narrowest phone (375 px) and a desktop: the ROM page, the first-run setup's questions and every Options page.
 * German runs longer than English, so nothing of its text may leave the screen, be clipped by a box, or run off its
 * button; the Options tabs fit their row without scrolling. Structure, not pixels (no ROM content).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'each test sets its own size');

const SIZES = [
  { name: 'phone-small', viewport: { width: 375, height: 812 }, touch: true },
  { name: 'desktop', viewport: { width: 1280, height: 720 }, touch: false },
] as const;

async function german(browser: Browser, s: (typeof SIZES)[number]): Promise<Page> {
  const context = await browser.newContext({ locale: 'de-DE', viewport: s.viewport, hasTouch: s.touch, isMobile: s.touch, deviceScaleFactor: s.touch ? 3 : 1 });
  return context.newPage();
}

const settled = (page: Page) =>
  page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity))
    .then(() => page.evaluate(() => new Promise(requestAnimationFrame)));

/**
 * Each shown text run, against the viewport, every box that clips it (lists that scroll clip only along their scroll,
 * and what they scroll out is not shown) and the button, tab or chip it labels.
 */
async function textProblems(page: Page): Promise<string[]> {
  await settled(page);
  return page.evaluate(() => {
    const out: string[] = [];
    const tag = (e: Element) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent!.trim();
      const el = n.parentElement!;
      if (!text || el.closest('[hidden], .sr-only, .os-sr, script, style') || el.getClientRects().length === 0) continue;
      // Not drawn: hidden, transparent, or inside a visually hidden box (1 px or clipped away).
      let drawn = true;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        const r = a.getBoundingClientRect();
        if (s.visibility === 'hidden' || s.opacity === '0' || s.clipPath !== 'none' || r.width <= 1 || r.height <= 1) drawn = false;
      }
      if (!drawn) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      const label = `"${text.slice(0, 60)}"`;
      if (r.left < -1 || r.right > innerWidth + 1) out.push(`off the screen: ${label}`);
      let scrolledY = false;
      let scrolledX = false;
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        const scrollsY = s.overflowY === 'auto' || s.overflowY === 'scroll';
        const scrollsX = s.overflowX === 'auto' || s.overflowX === 'scroll';
        const outX = r.left < ar.left - 1 || r.right > ar.right + 1;
        const outY = r.top < ar.top - 1 || r.bottom > ar.bottom + 1;
        if ((outX && !scrollsX && !scrolledX) || (outY && !scrollsY && !scrolledY)) {
          out.push(`clipped by ${tag(a)}: ${label}`);
          break;
        }
        if (outX && scrollsX) out.push(`scrolled out sideways in ${tag(a)}: ${label}`);
        scrolledY ||= scrollsY && a.scrollHeight > a.clientHeight + 1;
        scrolledX ||= scrollsX && a.scrollWidth > a.clientWidth + 1;
      }
      const control = el.closest('button, [role="button"], [role="tab"], .os-chip');
      if (control) {
        const cr = control.getBoundingClientRect();
        if (r.left < cr.left - 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.bottom > cr.bottom + 1) out.push(`runs off ${tag(control)}: ${label}`);
      }
    }
    if (document.scrollingElement!.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways (${document.scrollingElement!.scrollWidth} > ${innerWidth})`);
    return [...new Set(out)];
  });
}

for (const s of SIZES) {
  test(`${s.name}: the ROM page and the setup's questions fit in German`, async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await german(browser, s);
    await page.goto('/');
    await expect(page.locator('.rom-panel')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    expect(await textProblems(page), 'the ROM page').toEqual([]);

    await page.goto('/?packs=fixture&title');
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
    await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
    await page.locator('#title').click();
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'setup');
    let questions = 0;
    while ((await page.evaluate(() => window.openSinnohTitle?.phase)) === 'setup') {
      const heading = await page.locator('.setup-choices').evaluate((e) => e.closest('[role="dialog"]')?.textContent ?? '');
      expect(await textProblems(page), `setup question ${questions + 1}`).toEqual([]);
      await page.locator('.setup-choices [data-tap^="menu:"]').first().click();
      await expect.poll(() => page.evaluate(() => (window.openSinnohTitle?.phase === 'setup' ? document.querySelector('.setup-choices')?.closest('[role="dialog"]')?.textContent ?? '' : 'done'))).not.toBe(heading);
      questions++;
    }
    expect(questions).toBeGreaterThan(1);
    await page.context().close();
  });

  test(`${s.name}: every Options page fits in German, its tabs in one row`, async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await german(browser, s);
    await page.addInitScript(() => {
      localStorage.setItem('lantern-nds:setup', '["reports","addon","textSpeed","visualStyle","menuStyle"]');
      localStorage.setItem('lantern-nds:error-reports', 'false');
    });
    await page.goto('/?packs=fixture&title');
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
    await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
    await page.locator('#title').click();
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
    await page.locator('.tm-options').click();
    const board = page.locator('[data-screen="options"]');
    await expect(board).toBeVisible();
    const row = board.locator('.os-tabs');
    expect(await row.evaluate((e) => e.scrollWidth - e.clientWidth), 'the tabs scroll').toBeLessThanOrEqual(1);
    const sections = await board.locator('[role="tab"][data-section]').evaluateAll((t) => t.map((e) => e.getAttribute('data-section')!));
    expect(sections.length).toBe(5);
    for (const section of sections) {
      await board.locator(`[role="tab"][data-section="${section}"]`).click();
      await expect(board.locator(`[role="tab"][data-section="${section}"]`)).toHaveAttribute('aria-selected', 'true');
      // The page a screen at a time, down to its end.
      const list = board.locator('.options-rows');
      const steps = await list.evaluate((e) => Math.ceil(e.scrollHeight / e.clientHeight));
      for (let i = 0; i < steps; i++) {
        await list.evaluate((e, k) => (e.scrollTop = e.clientHeight * k), i);
        expect(await textProblems(page), `${section}, screen ${i + 1}`).toEqual([]);
      }
    }
    await page.context().close();
  });
}
