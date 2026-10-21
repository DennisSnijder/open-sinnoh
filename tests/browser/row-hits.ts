import type { Page } from '@playwright/test';

/**
 * The tap-width rule (docs/decisions.md "DS rows tap across their window"): a row alone on its line
 * in a window of the open app taps across the window's whole width, its frame included, within any box that
 * clips or scrolls on the way (`ui/hits.ts`, the invisible `::after`). Probed by hit testing, so the extension
 * is what is measured: the point 1 px inside each side of that span, at the row's middle, must hit the row.
 * Returns the rows that miss (empty when the rule holds).
 */
export function narrowRowHits(page: Page): Promise<{ tap: string | undefined; side: 'left' | 'right'; hit: string }[]> {
  return page.evaluate(() => {
    const misses: { tap: string | undefined; side: 'left' | 'right'; hit: string }[] = [];
    for (const win of document.querySelectorAll<HTMLElement>('.ui-host .window')) {
      if (win.offsetParent === null) continue;
      const rows = [...win.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetWidth && e.closest('.window') === win);
      const rects = rows.map((e) => e.getBoundingClientRect());
      const w = win.getBoundingClientRect();
      rows.forEach((row, i) => {
        // Rows behind an open prompt are inert (ui/focus.ts isolatePrompt): not tappable at all.
        if (row.closest('[inert]')) return;
        const r = rects[i]!;
        if (!rects.every((o, j) => j === i || o.bottom <= r.top + 0.5 || o.top >= r.bottom - 0.5)) return;
        let left = w.left;
        let right = w.right;
        let top = w.top;
        let bottom = w.bottom;
        for (let e = row.parentElement; e && win.contains(e); e = e.parentElement) {
          if (getComputedStyle(e).overflowX === 'visible' && getComputedStyle(e).overflowY === 'visible') continue;
          const b = e.getBoundingClientRect();
          left = Math.max(left, b.left + e.clientLeft);
          right = Math.min(right, b.left + e.clientLeft + e.clientWidth);
          top = Math.max(top, b.top);
          bottom = Math.min(bottom, b.bottom);
        }
        const y = (r.top + r.bottom) / 2;
        // A row scrolled out of its list is not tappable there.
        if (y < top || y > bottom || y < 0 || y > innerHeight) return;
        for (const [side, x] of [['left', left + 1], ['right', right - 1]] as const) {
          const hit = document.elementFromPoint(x, y);
          if (!(hit instanceof HTMLElement) || hit.closest('[data-nav]') !== row) misses.push({ tap: row.dataset.tap, side, hit: hit ? `${hit.tagName}.${hit.className}` : 'nothing' });
        }
      });
    }
    return misses;
  });
}
