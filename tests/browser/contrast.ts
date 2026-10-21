/**
 * Text contrast of OpenSinnoh's screens, computed in the page: every visible text against the colour really behind
 * it, composited through translucent fills and the 9-slice skins (border-image faces, which axe-core cannot see
 * through, so its own color-contrast rule is not used on them: tests/browser/axe.ts).
 */
import type { Page } from '@playwright/test';

/** Failing texts under `scope` (a CSS selector) as `theme tag.class "text" ratio`; disabled text is exempt. */
export function contrastFailures(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const parse = (s: string): number[] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (m) {
        const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
      }
      const h = /^#([0-9a-f]{6})$/i.exec(s.trim());
      return h ? [0, 2, 4].map((i) => parseInt(h[1]!.slice(i, i + 2), 16)).concat(1) : null;
    };
    const over = (f: number[], b: number[]) => [0, 1, 2].map((i) => f[i]! * f[3]! + b[i]! * (1 - f[3]!)).concat(1);
    const lum = (c: number[]) => {
      const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * ch(c[0]!) + 0.7152 * ch(c[1]!) + 0.0722 * ch(c[2]!);
    };
    const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    // Skins drawn as border-image fills: the token behind their text.
    const SKINS: [string, string][] = [
      ['.os-btn.primary', '--os-action'],
      ['.os-btn.solid-danger', '--os-danger'],
      ['.os-btn, .os-file.quiet', '--os-face'],
      ['.os-tab', '--c'],
      ['.os-win', '--os-face'],
    ];
    const bgOf = (el: Element): number[] => {
      let acc: number[] | null = null;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const add = (c: number[]) => (acc = acc ? over(acc, c) : c);
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3]! > 0) add(c);
        if (acc && acc[3]! >= 0.999) return acc;
        const skin = SKINS.find(([sel]) => n.matches(sel));
        if (skin) {
          add(parse(getComputedStyle(n).getPropertyValue(skin[1]))!);
          return acc!;
        }
      }
      return acc ? over(acc, [255, 255, 255, 1]) : [255, 255, 255, 1];
    };
    const fails: string[] = [];
    for (const el of document.querySelectorAll(`${scope} *`)) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      if (el.closest('.os-sr, [aria-disabled="true"], :disabled, .os-tip')) continue;
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const fg = parse(cs.color)!;
      const bg = bgOf(el);
      const r = ratio(over(fg, bg), bg);
      if (r < 4.5 - 0.005) fails.push(`${el.closest('[data-theme]')?.getAttribute('data-theme') ?? document.documentElement.dataset.theme ?? ''} ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent!.trim().slice(0, 24)}" ${r.toFixed(2)}`);
    }
    return fails;
  }, scope);
}
