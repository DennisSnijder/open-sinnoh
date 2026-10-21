/**
 * The startup splash in index.html (the wordmark over a busy bar, shown from the first paint until the app's first
 * real screen): this Vite plugin fills in its two generated parts from the one source of each, so the page needs no
 * request and no script to draw it.
 *   <!--opensinnoh:splash-wordmark-->  the wordmark (packages/ui brand.ts) as inline SVG at ×4, filled by the tokens
 *   /*opensinnoh:splash-tokens*\/       the --os-* colours the splash uses (tokens.json), dark and light, scoped to #splash
 * (The app's full token sheet comes with its script, `installUi`; it is far too big to inline.)
 */
import type { Plugin } from 'vite';
import { WORDMARK } from '../packages/ui/src/brand.ts';
import { TOKENS } from '../packages/ui/src/tokens.ts';

const WORDMARK_MARKER = '<!--opensinnoh:splash-wordmark-->';
const TOKENS_MARKER = '/*opensinnoh:splash-tokens*/';
/** The colours the splash and the pieces of os.css it reuses (`.os`, `.os-prog`, `.os-btn`) read. */
const COLOURS = ['bg', 'ink', 'ink-shadow', 'muted', 'accent', 'edge', 'action', 'on-action'] as const;
const SCALE = 4;

type Rect = [number, number, number, number];
const path = (rects: Rect[]) => rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('');

/** The wordmark as the `wordmark()` component draws it (static): the shadow one pixel down and right, then ink and gold. */
export function splashWordmark(): string {
  const { w, h, ink, accent } = WORDMARK;
  return (
    `<svg class="os-brand os-wordmark" role="img" aria-label="OpenSinnoh" width="${w * SCALE}" height="${h * SCALE}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">` +
    `<path transform="translate(1 1)" style="fill:var(--os-ink-shadow)" d="${path([...ink, ...accent])}"/>` +
    `<path style="fill:var(--os-ink)" d="${path(ink)}"/><path style="fill:var(--os-accent)" d="${path(accent)}"/></svg>`
  );
}

/** The splash's colours: dark by default, light by the system unless the stored theme says dark, or by the stored theme. */
export function splashTokens(): string {
  const block = (sel: string, theme: 'dark' | 'light') => `${sel}{${COLOURS.map((c) => `--os-${c}:${TOKENS.color[c]![theme]};`).join('')}}`;
  return [
    `#splash{--os-f:${TOKENS.motion.frame as number}ms;}`,
    block('#splash', 'dark'),
    `@media (prefers-color-scheme: light){${block(':root:not([data-theme="dark"]) #splash', 'light')}}`,
    block('[data-theme="light"] #splash', 'light'),
  ].join('');
}

export function splash(): Plugin {
  return {
    name: 'opensinnoh-splash',
    // Before Vite's own pass, which processes the inline <style> (and would drop the marker comment).
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Only the game's page has the splash; another page (a test entry) has neither marker.
        const has = [html.includes(WORDMARK_MARKER), html.includes(TOKENS_MARKER)];
        if (!has[0] && !has[1]) return html;
        if (!has[0] || !has[1]) throw new Error(`index.html: the splash needs both ${WORDMARK_MARKER} and ${TOKENS_MARKER}`);
        return html.replace(WORDMARK_MARKER, splashWordmark).replace(TOKENS_MARKER, splashTokens);
      },
    },
  };
}
