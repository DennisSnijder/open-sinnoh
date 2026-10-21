/**
 * OpenSinnoh UI tokens: `tokens.json` is the only source. This module turns it into CSS custom properties
 * (`--os-<token>`, dark on `:root`, light by the system or `[data-theme="light"]`, either forced on any
 * subtree with `data-theme`), the dot units (`--os-d1` … `--os-d16`), the 9-slice frame, button and title-tab
 * skins as SVG data URIs per theme, and the frame classes. No colour literal lives anywhere else.
 */
import json from './tokens.json' with { type: 'json' };

export type Theme = 'dark' | 'light';

export interface FrameDef {
  name: string;
  /** Corner size in dots; the mask's last row and column are the face. */
  slice: number;
  /** The top-left corner, one string per row: `.` empty, h halo, r rim, m ring, i inner line, e edge, f face. */
  tl: string[];
  /** A hard shadow down and right, in dots. */
  drop?: number;
  /** The dot row above the bottom edge is the shade (`d`): buttons. */
  shade?: boolean;
  rule: string;
}

export interface Tokens {
  name: string;
  version: string;
  unit: { dot: number; grid: number; touchTarget: number; phoneBreakpoint: number };
  space: number[];
  spaceExceptions: Record<string, string>;
  type: Record<string, Record<string, unknown>>;
  motion: Record<string, number | Record<string, number | string>>;
  color: Record<string, { group: string; dark: string; light: string; role: string }>;
  frames: Record<string, FrameDef>;
}

export const TOKENS = json as Tokens;

/** The window frames a player can pick (Control is fixed to buttons and title tabs). */
export const WINDOW_FRAMES = Object.keys(TOKENS.frames).filter((k) => k !== 'control');

/** The tones a title tab can take. */
export const TONES = ['world', 'team', 'items', 'system', 'danger'] as const;

function rgba(s: string): [number, number, number, number] {
  if (s.startsWith('#') && s.length === 7) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) throw new Error(`ui tokens: unreadable colour ${s}`);
  const [r, g, b, a = 1] = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
  return [r!, g!, b!, a];
}

const hex = (c: number[]) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** `top` at opacity `t` over `base` (both opaque hex), as hex. */
export function mix(base: string, top: string, t: number): string {
  const a = rgba(base);
  const b = rgba(top);
  return hex(a.map((v, i) => b[i]! * t + v * (1 - t)));
}

/** WCAG contrast of two colours; a translucent foreground is composited over the background first. */
export function contrast(fg: string, bg: string): number {
  const b = rgba(bg);
  const f = rgba(fg);
  const over = f.map((v, i) => (i < 3 ? v * f[3]! + b[i]! * (1 - f[3]!) : 1));
  const lum = (c: number[]) => {
    const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(c[0]!) + 0.7152 * ch(c[1]!) + 0.0722 * ch(c[2]!);
  };
  const [x, y] = [lum(over), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const color = (theme: Theme, name: string): string => {
  const c = TOKENS.color[name];
  if (!c) throw new Error(`ui tokens: no colour ${name}`);
  return c[theme];
};

/** A frame as an SVG of (2 × slice + 1 + drop) dots square, its cells coloured from `colors` by letter. */
export function nineSlice(def: FrameDef, colors: Record<string, string>): string {
  const S = def.slice;
  const N = 2 * S + 1;
  const ex = def.drop ?? 0;
  const W = N + ex;
  const at = (x: number, y: number) => {
    const c = def.tl[y <= S ? y : N - 1 - y]![x <= S ? x : N - 1 - x]!;
    return def.shade && y === N - 2 && x > 0 && x < N - 1 ? 'd' : c;
  };
  const cells: string[][] = Array.from({ length: W }, () => Array<string>(W).fill('.'));
  if (ex) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (at(x, y) !== '.') cells[y + ex]![x + ex] = 'x';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (at(x, y) !== '.') cells[y]![x] = at(x, y);
  let rects = '';
  cells.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c === '.') return;
      const fill = colors[c];
      if (!fill) throw new Error(`ui tokens: frame ${def.name} uses ${c} with no colour`);
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" shape-rendering="crispEdges">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Every custom property of one theme: the colours, the window frames, the button and title-tab skins. */
export function themeVars(theme: Theme): Record<string, string> {
  const t = (n: string) => color(theme, n);
  const vars: Record<string, string> = {};
  for (const name of Object.keys(TOKENS.color)) vars[`--os-${name}`] = t(name);
  const win = { h: t('halo'), r: t('rim'), m: t('ring'), i: t('inner'), f: t('face'), x: t('shadow') };
  for (const k of WINDOW_FRAMES) vars[`--os-frame-${k}`] = nineSlice(TOKENS.frames[k]!, win);
  const control = TOKENS.frames.control!;
  const flat = { ...control, shade: false };
  // A raised button: edge, fill and the shade under it; pressed: no shade (and it moves down a dot).
  const raised = (f: string, d: string) => nineSlice(control, { e: t('edge'), f, d });
  const pressed = (f: string) => nineSlice(flat, { e: t('edge'), f });
  const lift = theme === 'dark' ? 0.35 : 0.12;
  vars['--os-ctl'] = raised(t('face'), theme === 'dark' ? mix(t('face'), '#000000', 0.45) : mix(t('face'), t('rim'), 0.16));
  vars['--os-ctl-hover'] = raised(mix(t('face'), t('ink'), 0.08), theme === 'dark' ? mix(t('face'), '#000000', 0.45) : mix(t('face'), t('rim'), 0.16));
  vars['--os-ctl-down'] = pressed(t('sel'));
  vars['--os-ctl-primary'] = raised(t('action'), mix(t('action'), '#000000', lift));
  vars['--os-ctl-primary-down'] = pressed(t('action'));
  vars['--os-ctl-danger'] = raised(t('danger'), mix(t('danger'), '#000000', lift));
  vars['--os-ctl-danger-down'] = pressed(t('danger'));
  vars['--os-ctl-off'] = pressed(t('face'));
  // Title tabs: the Control edge around the tone, flat.
  for (const tone of TONES) vars[`--os-tab-${tone}`] = pressed(t(`tone-${tone}`));
  vars['--os-banner'] = mix(t('face'), t('danger'), 0.12);
  // The info banner (a calm notice, not an error): the frame's teal ring, faintly.
  vars['--os-banner-info'] = mix(t('face'), t('ring'), 0.18);
  return vars;
}

const block = (selector: string, theme: Theme) =>
  `${selector}{${Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}:${v};`)
    .join('')}color-scheme:${theme}}`;

/**
 * The generated stylesheet: units, both themes, and the frame classes. Dark first; the system's light
 * preference applies unless `data-theme="dark"` forces dark; `data-theme` on any element forces its subtree.
 */
export function tokensCss(): string {
  const u = TOKENS.unit;
  const frame = TOKENS.motion.frame as number;
  const dots = Array.from({ length: 16 }, (_, i) => `--os-d${i + 1}:${(i + 1) * u.dot}px;`).join('');
  const units = `:root{--os-dot:${u.dot}px;${dots}--os-touch:${u.touchTarget}px;--os-f:${frame}ms;${TOKENS.space.map((s, i) => `--os-space-${i + 1}:${s}px;`).join('')}}`;
  const frames = WINDOW_FRAMES.map((k) => {
    const f = TOKENS.frames[k]!;
    const ex = f.drop ?? 0;
    const w = (n: number) => `${n * u.dot}px`;
    const decl = `--os-win-img:var(--os-frame-${k});--os-win-s:${f.slice} ${f.slice + ex} ${f.slice + ex} ${f.slice};--os-win-w:${w(f.slice)} ${w(f.slice + ex)} ${w(f.slice + ex)} ${w(f.slice)};`;
    // Distortion is the default on every window; a picked frame applies under [data-os-frame] or on the window.
    return k === 'distortion' ? `.os-win{${decl}}` : `[data-os-frame="${k}"] .os-win:not([data-frame]),.os-win[data-frame="${k}"]{${decl}}`;
  }).join('');
  return [
    units,
    block(':root,[data-theme="dark"]', 'dark'),
    `@media (prefers-color-scheme: light){${block(':root:not([data-theme="dark"])', 'light')}}`,
    block('[data-theme="light"]', 'light'),
    frames,
  ].join('\n');
}
