/**
 * Build time for the landing page (vite.config.ts): the design system's own builders run here once, so the page
 * ships their output as markup and CSS, with no JavaScript for the art.
 * - `siteTokensCss()`: the generated token stylesheet (`tokensCss`) plus the device bezels, skinned by `nineSlice`
 *   from the theme's frame colours (the virtual module `virtual:os-tokens.css`, bundled with the page's CSS).
 * - `<!--wordmark-->`, `<!--logo:N-->`, `<!--icon:name-->` in index.html: `wordmark`, `logo` and `icon` from
 *   @opensinnoh/ui, drawn into a minimal DOM that serialises to SVG markup.
 * - `<!--discord-->`: Discord's logo mark (`DISCORD`), for the links to our server.
 */
import { tokensCss, nineSlice, color, type FrameDef, type Theme } from '../packages/ui/src/tokens.ts';

/** The few DOM calls the brand and icon builders make, serialised as markup. */
class Node_ {
  readonly attrs = new Map<string, string>();
  readonly kids: (Node_ | string)[] = [];
  readonly css = new Map<string, string>();
  readonly classList = { add: (...c: string[]) => this.attrs.set('class', [this.attrs.get('class'), ...c].filter(Boolean).join(' ')) };
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string> & { setProperty(k: string, v: string): void };
  constructor(readonly tag: string) {
    const css = this.css;
    this.style = new Proxy({} as Record<string, string> & { setProperty(k: string, v: string): void }, {
      get: (_, k) => (k === 'setProperty' ? (p: string, v: string) => css.set(p, v) : css.get(String(k))),
      set: (_, k, v: string) => (css.set(String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v), true),
    });
    this.dataset = new Proxy({} as Record<string, string>, { set: (_, k, v: string) => (this.attrs.set(`data-${String(k)}`, v), true) });
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  append(...c: (Node_ | string)[]): void {
    this.kids.push(...c);
  }
  toString(): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const style = [...this.css].map(([k, v]) => `${k}:${v}`).join(';');
    const attrs = [...this.attrs, ...(style ? [['style', style] as const] : [])].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${this.tag}${attrs}>${this.kids.map(String).join('')}</${this.tag}>`;
  }
}

/** Runs a builder against the minimal DOM and returns its markup. */
async function render(build: () => unknown): Promise<string> {
  const g = globalThis as { document?: unknown };
  if (g.document) throw new Error('prerender: a document already exists');
  g.document = { createElementNS: (_: string, tag: string) => new Node_(tag) };
  try {
    return String(build());
  } finally {
    delete g.document;
  }
}

/**
 * The device bezels, in the windows' colours: a 1-dot halo, the near-black body, corners stepped in whole dots.
 * The phone and tablet have a rounder corner than the laptop's lid. Each is a 9-slice skin like the windows'.
 */
const DEVICES: FrameDef[] = [
  { name: 'phone', slice: 7, tl: ['....hhhh', '..hhrrrr', '.hrrrrrr', '.hrrrrrr', 'hrrrrrrr', 'hrrrrrrr', 'hrrrrrrr', 'hrrrrrrr'], rule: 'Phone and tablet bezel.' },
  { name: 'lid', slice: 3, tl: ['.hhh', 'hrrr', 'hrrr', 'hrrr'], rule: 'Laptop lid.' },
];

/** The token sheet and the device skins, in the token sheet's theme selectors. */
export function siteTokensCss(): string {
  const vars = (theme: Theme) => DEVICES.map((d) => `--site-${d.name}:${nineSlice(d, { h: color(theme, 'halo'), r: color(theme, 'rim') })};`).join('');
  return [tokensCss(), `:root,[data-theme="dark"]{${vars('dark')}}`, `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${vars('light')}}}`, `[data-theme="light"]{${vars('light')}}`].join('\n');
}

/**
 * Discord's official logo mark (the "Clyde" glyph), unchanged, in `currentColor` (the brand guidelines allow it
 * monochrome, for linking to a server). A third-party mark, so it lives here and not in the pixel icon set. The
 * square viewBox centres it in a 16-px box, like our icons; it keeps its own proportions.
 */
const DISCORD =
  '<svg class="os-ico" width="16" height="16" viewBox="0 -15.39 127.14 127.14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>';

/** Fills the page's placeholders. */
export async function prerender(html: string): Promise<string> {
  const ui = await import('../packages/ui/src/components.ts');
  const icons = await import('../packages/ui/src/icons.ts');
  const parts: [RegExp, (m: RegExpExecArray) => Promise<string> | string][] = [
    [/<!--wordmark-->/g, () => render(() => ui.wordmark(1, { animate: true }))],
    [/<!--logo:(\d+)-->/g, (m) => render(() => ui.logo(Number(m[1]), { label: 'OpenSinnoh' }))],
    [/<!--icon:([a-z]+)-->/g, (m) => render(() => icons.icon(m[1] as Parameters<typeof icons.icon>[0]))],
    [/<!--discord-->/g, () => DISCORD],
  ];
  for (const [re, fill] of parts) {
    const found = [...html.matchAll(re)];
    for (const m of found) {
      const out = await fill(m as RegExpExecArray);
      html = html.replace(m[0], () => out);
    }
  }
  const left = /<!--(wordmark|logo:\d+|icon:[a-z]+|discord)-->/.exec(html);
  if (left) throw new Error(`prerender: ${left[0]} was not filled`);
  return html;
}
