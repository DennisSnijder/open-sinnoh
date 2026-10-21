import { describe, expect, it } from 'vitest';
import { ICONS, iconBitmap, type IconName } from './icons.ts';
import { contrast, nineSlice, themeVars, tokensCss, TONES, TOKENS, WINDOW_FRAMES } from './tokens.ts';

describe('OpenSinnoh UI tokens', () => {
  it('generates every colour for both themes, dark on :root and light by system or data-theme', () => {
    const css = tokensCss();
    const names = Object.keys(TOKENS.color);
    for (const theme of ['dark', 'light'] as const) {
      const vars = themeVars(theme);
      for (const n of names) expect(vars[`--os-${n}`]).toBe(TOKENS.color[n]![theme]);
    }
    const blocks = css.split('\n');
    expect(blocks[1]).toMatch(/^:root,\[data-theme="dark"\]\{--os-bg:#0b0d12;/);
    expect(blocks[1]).toContain('color-scheme:dark');
    expect(blocks[2]).toMatch(/^@media \(prefers-color-scheme: light\)\{:root:not\(\[data-theme="dark"\]\)\{--os-bg:#e6e4dd;/);
    expect(blocks[3]).toMatch(/^\[data-theme="light"\]\{--os-bg:#e6e4dd;/);
    // Lengths in dots: one dot is 2 px.
    expect(css).toContain('--os-dot:2px;--os-d1:2px;');
    expect(css).toContain('--os-d16:32px;');
  });

  it('builds the frames from the JSON at one dot = 2 px', () => {
    const css = tokensCss();
    expect(WINDOW_FRAMES).toEqual(['distortion', 'slim', 'drop']);
    expect(css).toContain('.os-win{--os-win-img:var(--os-frame-distortion);--os-win-s:5 5 5 5;--os-win-w:10px 10px 10px 10px;}');
    expect(css).toContain('.os-win[data-frame="slim"]{--os-win-img:var(--os-frame-slim);--os-win-s:2 2 2 2;--os-win-w:4px 4px 4px 4px;}');
    expect(css).toContain('.os-win[data-frame="drop"]{--os-win-img:var(--os-frame-drop);--os-win-s:5 7 7 5;--os-win-w:10px 14px 14px 10px;}');
    const svg = (url: string) => decodeURIComponent(url.slice('url("data:image/svg+xml,'.length, -2));
    const win = svg(nineSlice(TOKENS.frames.distortion!, { h: '#111', r: '#222', m: '#333', i: '#444', f: '#555' }));
    expect(win).toContain('width="11" height="11"');
    // The corner dot is cut; halo, rim, the 2-dot ring, the inner line and the face follow the mask.
    expect(win).not.toContain('<rect x="0" y="0"');
    expect(win).toContain('<rect x="1" y="0" width="1" height="1" fill="#111"/>');
    expect(win).toContain('<rect x="1" y="1" width="1" height="1" fill="#222"/>');
    expect(win).toContain('<rect x="2" y="2" width="1" height="1" fill="#333"/>');
    expect(win).toContain('<rect x="4" y="4" width="1" height="1" fill="#444"/>');
    expect(win).toContain('<rect x="5" y="5" width="1" height="1" fill="#555"/>');
    // A button: the shade sits on the dot row above the bottom edge, between the side edges.
    const btn = svg(nineSlice(TOKENS.frames.control!, { e: '#111', f: '#555', d: '#999' }));
    expect(btn).toContain('<rect x="1" y="3" width="1" height="1" fill="#999"/>');
    expect(btn).toContain('<rect x="0" y="3" width="1" height="1" fill="#111"/>');
    expect(btn).toContain('<rect x="1" y="2" width="1" height="1" fill="#555"/>');
    expect(() => nineSlice(TOKENS.frames.distortion!, { h: '#fff' })).toThrow(/uses r/);
    // Every tone has a title-tab skin; buttons have pressed skins.
    const vars = themeVars('dark');
    for (const t of TONES) expect(vars[`--os-tab-${t}`]).toMatch(/^url\("data:image\/svg\+xml,/);
    for (const k of ['--os-ctl-down', '--os-ctl-primary-down', '--os-ctl-danger-down']) expect(vars[k]).toBeDefined();
  });

  it('meets the contrast pairs in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const v = themeVars(theme);
      const c = (n: string) => v[`--os-${n}`]!;
      const face = c('face');
      const pairs: [string, string, number][] = [
        [c('ink'), face, 4.5], [c('ink'), c('sel'), 4.5], [c('ink'), c('face-alt'), 4.5], [c('ink'), c('field'), 4.5], [c('ink'), c('bg'), 4.5],
        [c('muted'), face, 4.5], [c('muted'), c('sel'), 4.5], [c('muted'), c('field'), 4.5],
        [c('accent'), face, 4.5], [c('accent'), c('sel'), 4.5], [c('on-accent'), c('accent'), 4.5],
        [c('on-action'), c('action'), 4.5], [c('on-danger'), c('danger'), 4.5], [c('danger'), face, 4.5], [c('ink'), c('banner'), 4.5], [c('ink'), c('banner-info'), 4.5],
        ...TONES.map((t) => [c('on-tone'), c(`tone-${t}`), 4.5] as [string, string, number]),
        // Control and tab edges, empty cells and the dotted drop border: 3:1 on the face.
        [c('edge'), face, 3],
      ];
      for (const [fg, bg, min] of pairs) expect(contrast(fg, bg), `${theme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('has original 16 × 16 icons, each with a meaning', () => {
    const names = Object.keys(ICONS) as IconName[];
    expect(names.length).toBe(47);
    for (const n of names) {
      const d = ICONS[n] as { m: string; p: number[][]; c?: number[][] };
      expect(d.m.length).toBeGreaterThan(0);
      for (const [x, y, w, hh] of [...d.p, ...(d.c ?? [])]) expect(x! >= 0 && y! >= 0 && x! + w! <= 16 && y! + hh! <= 16, `${n} [${x},${y},${w},${hh}]`).toBe(true);
      expect(iconBitmap(n).flat().filter(Boolean).length, n).toBeGreaterThan(8);
    }
    // The reset icon is the circular arrow: no cut-outs, its arrowhead at the top right.
    expect('c' in ICONS.reset).toBe(false);
    expect(iconBitmap('reset')[1]![13]).toBe(true);
  });
});
