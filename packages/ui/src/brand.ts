/**
 * The OpenSinnoh mark and wordmark (docs/design-system.md, Brand): original pixel
 * art, kept here as rect lists ([x, y, w, h] on the art's own grid) so the UI draws it as crisp inline SVG at
 * whole scales (components.ts: `logo`, `wordmark`; never the two side by side) and tools/brand-assets.ts writes the favicons, app
 * icons and the link card from the same data.
 *
 * - `MARK_32`, the Title-tab window: halo, rim, teal ring, a gold title tab, a dark face, a gold O and a paper S.
 *   Each entry is [colour, frame, rects]: the frame of the 30 Hz intro on which those pixels appear (the window
 *   opens from the middle out, the ring and face follow, the tab pops up, the O then the S type in row by row).
 *   Entries are in paint order: everything under the letters first, then the letters.
 * - `MARK_16`, the Window: the cut used below 32 px (same letters and colours, a teal title strip). Static.
 * - `WORDMARK`: "OpenSinnoh" in our pixel glyphs (cap 8, x-height 6, 2-px stems), the O and the S in gold; drawn
 *   with a 1-pixel shadow down and right (inside `w` × `h`).
 *
 * Colours are tokens: `h` is the halo, which follows the background (`--os-halo` on a page, paper on a favicon,
 * the dark halo on the near-black app-icon plate); the rest are fixed, the same in both themes.
 */
import { TOKENS } from './tokens.ts';

type Rect = [number, number, number, number];
export type MarkColor = 'h' | 'o' | 'a1' | 'a2' | 'a4' | 't2' | 'd' | 'p1';
export interface MarkDef {
  n: 16 | 32;
  /** The gold text cursor after the S (intro and idle blink), [x, y, w, h]. */
  caret?: Rect;
  px: [MarkColor, number, Rect[]][];
}
export interface WordmarkDef {
  w: number;
  h: number;
  ink: Rect[];
  accent: Rect[];
}

const c = TOKENS.color;
/** The mark's fixed colours (every one a token); `h`, the halo, is the caller's. */
export const MARK_COLORS: Record<Exclude<MarkColor, 'h'>, string> = {
  o: c.rim!.dark,
  a1: c.accent!.dark,
  a2: c.ring!.dark,
  a4: c['mark-tab-shade']!.dark,
  t2: c['mark-strip']!.dark,
  d: c.face!.dark,
  p1: c.face!.light,
};
/** The halo on a transparent icon (paper, so the near-black rim reads on dark and light tabs) and on the app-icon plate. */
export const HALO_ICON = c.face!.light;
export const HALO_PLATE = c.halo!.dark;

/**
 * The intro and idle, in 30 Hz frames: the intro is 48 frames (the caret is on for frames 34–39), then the idle
 * repeats every 180 frames with the caret on for frames 0–7, 16–23 and 32–39. os.css has the same numbers.
 */
export const MARK_MOTION = { intro: 48, caret: [34, 40], every: 180, blinks: [[0, 8], [16, 24], [32, 40]] } as const;

/**
 * The wordmark's letters, [first column, end column, intro frame], left to right. Its 30 Hz intro (32 frames): the
 * gold O and S land first (frames 2 and 6), then the ink letters type in, one every 3 frames (os.css draws it).
 */
export const WORDMARK_LETTERS: [number, number, number][] = [
  [0, 6, 2], [7, 12, 10], [13, 18, 13], [19, 24, 16], [25, 30, 6], [31, 33, 19], [34, 39, 22], [40, 45, 25], [46, 51, 28], [52, 58, 31],
];

/** The mark drawn for a size in CSS px: the 16-px cut at 16, the 32-px window at any multiple of 32. */
export function markFor(size: number): MarkDef {
  if (size === 16) return MARK_16;
  if (size >= 32 && size % 32 === 0) return MARK_32;
  throw new Error(`ui: the mark is drawn at 16 px or a multiple of 32, not ${size}`);
}

/** The mark as a colour grid (null: transparent), for writing images. */
export function markGrid(m: MarkDef, halo: string): (string | null)[][] {
  const g = Array.from({ length: m.n }, () => Array<string | null>(m.n).fill(null));
  for (const [col, , rects] of m.px) for (const [x, y, w, h] of rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j]![i] = col === 'h' ? halo : MARK_COLORS[col];
  return g;
}

/** The wordmark as a colour grid (shadow, then ink and accent), for writing images. */
export function wordmarkGrid(ink: string, accent: string, shadow: string): (string | null)[][] {
  const g = Array.from({ length: WORDMARK.h }, () => Array<string | null>(WORDMARK.w).fill(null));
  const paint = (rects: Rect[], col: string, d: number) => {
    for (const [x, y, w, h] of rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j + d]![i + d] = col;
  };
  paint(WORDMARK.ink, shadow, 1);
  paint(WORDMARK.accent, shadow, 1);
  paint(WORDMARK.ink, ink, 0);
  paint(WORDMARK.accent, accent, 0);
  return g;
}

/* Generated once from the design page's drawing (round 10); the art is edited here from now on. */
export const MARK_32: MarkDef = {
  n: 32,
  caret: [27,10,1,13],
  px: [
    ['h', 0, [[15,2,2,1],[15,31,2,1]]],
    ['o', 0, [[15,3,2,1],[15,30,2,1]]],
    ['h', 1, [[14,0,1,3],[17,2,1,1],[14,31,1,1],[17,31,1,1]]],
    ['o', 1, [[14,3,1,1],[17,3,1,1],[14,30,1,1],[17,30,1,1]]],
    ['h', 2, [[12,0,2,1],[18,2,2,1],[12,31,2,1],[18,31,2,1]]],
    ['o', 2, [[18,3,2,1],[12,30,2,1],[18,30,2,1]]],
    ['a2', 2, [[15,4,2,2],[15,28,2,2]]],
    ['h', 3, [[10,0,2,1],[20,2,2,1],[10,31,2,1],[20,31,2,1]]],
    ['o', 3, [[20,3,2,1],[10,30,2,1],[20,30,2,1]]],
    ['a2', 3, [[14,4,1,2],[17,4,1,2],[14,28,1,2],[17,28,1,2]]],
    ['h', 4, [[8,0,2,1],[22,2,2,1],[8,31,2,1],[22,31,2,1]]],
    ['o', 4, [[22,3,2,1],[8,30,2,1],[22,30,2,1]]],
    ['a2', 4, [[18,4,2,2],[12,28,2,2],[18,28,2,2]]],
    ['h', 5, [[6,0,2,1],[24,2,2,1],[6,31,2,1],[24,31,2,1]]],
    ['o', 5, [[24,3,2,1],[6,30,2,1],[24,30,2,1]]],
    ['a2', 5, [[20,4,1,2],[11,28,1,2],[20,28,1,2]]],
    ['h', 6, [[4,0,2,1],[26,2,2,1],[4,31,2,1],[26,31,2,1]]],
    ['o', 6, [[26,3,2,1],[4,30,2,1],[26,30,2,1]]],
    ['a2', 6, [[21,4,2,2],[9,28,2,2],[21,28,2,2]]],
    ['d', 6, [[15,6,2,22]]],
    ['h', 7, [[2,0,2,1],[2,1,1,3],[28,2,2,1],[29,3,1,1],[2,30,1,1],[29,30,1,1],[2,31,2,1],[28,31,2,1]]],
    ['o', 7, [[28,3,1,1],[2,4,1,1],[29,4,1,1],[2,29,1,1],[29,29,1,1],[3,30,1,1],[28,30,1,1]]],
    ['a2', 7, [[23,4,2,2],[7,28,2,2],[23,28,2,2]]],
    ['d', 7, [[13,6,2,22],[17,6,2,22]]],
    ['h', 8, [[1,3,1,1],[30,3,1,1],[0,4,2,1],[30,4,2,1],[0,5,1,24],[31,5,1,24],[0,29,2,1],[30,29,2,1],[1,30,1,1],[30,30,1,1]]],
    ['a2', 8, [[25,4,1,2],[6,28,1,2],[25,28,1,2]]],
    ['o', 8, [[1,5,1,24],[30,5,1,24]]],
    ['d', 8, [[10,6,3,22],[19,6,3,22]]],
    ['a2', 9, [[26,4,2,2],[4,6,1,1],[27,6,1,1],[4,27,1,1],[27,27,1,1],[4,28,2,2],[26,28,2,2]]],
    ['d', 9, [[7,6,3,22],[22,6,3,22]]],
    ['a2', 10, [[28,4,1,1],[2,5,1,1],[28,5,2,24],[2,6,2,23],[3,29,1,1],[28,29,1,1]]],
    ['o', 10, [[3,5,11,1]]],
    ['d', 10, [[5,6,2,1],[25,6,2,1],[4,7,3,20],[25,7,3,20],[5,27,2,1],[25,27,2,1]]],
    ['o', 11, [[3,4,1,1],[13,4,1,1]]],
    ['a1', 11, [[4,4,9,1]]],
    ['o', 12, [[3,3,1,1],[13,3,1,1]]],
    ['a1', 12, [[4,3,1,1],[11,3,2,1]]],
    ['a4', 12, [[5,3,6,1]]],
    ['o', 13, [[3,2,1,1],[13,2,1,1]]],
    ['a1', 13, [[4,2,9,1]]],
    ['o', 14, [[3,1,11,1]]],
    ['a1', 14, [[7,10,1,1]]],
    ['a1', 15, [[8,10,5,1]]],
    ['a1', 16, [[6,11,8,1],[5,12,10,1]]],
    ['a1', 17, [[5,13,4,1],[11,13,4,1]]],
    ['a1', 18, [[5,14,3,1],[12,14,3,1]]],
    ['a1', 19, [[5,15,3,2],[12,15,3,1]]],
    ['a1', 20, [[12,16,3,1]]],
    ['a1', 21, [[5,17,3,2],[12,17,3,2]]],
    ['a1', 22, [[5,19,4,1],[11,19,4,1]]],
    ['a1', 23, [[5,20,10,1]]],
    ['p1', 24, [[18,10,1,1]]],
    ['a1', 24, [[6,21,8,1],[7,22,6,1]]],
    ['p1', 25, [[19,10,7,1],[17,11,9,1]]],
    ['p1', 26, [[17,12,9,1]]],
    ['p1', 27, [[17,13,3,1]]],
    ['p1', 28, [[17,14,3,1],[17,15,8,1]]],
    ['p1', 29, [[17,16,5,1]]],
    ['p1', 30, [[22,16,4,1],[18,17,8,1]]],
    ['p1', 31, [[23,18,3,1]]],
    ['p1', 32, [[23,19,3,1]]],
    ['p1', 33, [[17,20,9,2]]],
    ['p1', 34, [[17,22,8,1]]],
  ],
};

export const MARK_16: MarkDef = {
  n: 16,
  px: [
    ['h', 0, [[1,0,14,1],[0,1,2,1],[14,1,2,1],[0,2,1,12],[15,2,1,12],[0,14,2,1],[14,14,2,1],[1,15,14,1]]],
    ['o', 0, [[2,1,12,1],[1,2,1,12],[14,2,1,12],[2,14,12,1]]],
    ['t2', 0, [[2,2,12,1]]],
    ['a2', 0, [[2,3,12,1]]],
    ['d', 0, [[2,4,12,10]]],
    ['a1', 0, [[3,5,4,1],[2,6,6,1],[2,7,2,4],[6,7,2,4],[2,11,6,1],[3,12,4,1]]],
    ['p1', 0, [[10,5,4,1],[9,6,5,1],[9,7,2,1],[9,8,4,1],[10,9,4,1],[12,10,2,1],[9,11,5,1],[9,12,4,1]]],
  ],
};

export const WORDMARK: WordmarkDef = {
  w: 58,
  h: 11,
  ink: [[31,0,2,1],[52,0,2,2],[7,2,4,1],[14,2,3,1],[19,2,4,1],[31,2,2,6],[34,2,4,1],[40,2,4,1],[47,2,3,1],[52,2,4,1],[7,3,2,4],[10,3,2,4],[13,3,2,1],[16,3,2,1],[19,3,2,5],[22,3,2,5],[34,3,2,5],[37,3,2,5],[40,3,2,5],[43,3,2,5],[46,3,2,4],[49,3,2,4],[52,3,2,5],[55,3,2,5],[13,4,5,1],[13,5,2,2],[7,7,4,1],[14,7,4,1],[47,7,3,1],[7,8,2,2]],
  accent: [[1,0,4,1],[26,0,4,1],[0,1,2,6],[4,1,2,6],[25,1,2,2],[26,3,3,1],[28,4,2,3],[1,7,4,1],[25,7,4,1]],
};
