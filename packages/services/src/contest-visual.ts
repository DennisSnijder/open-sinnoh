/**
 * The visual round's rules (docs/research/contests.md §5; decomp overlay022 ov22_02255D44.c, ov22_022578F4.c,
 * ov22_02257F50.c, overlay017 ov17_0223F118.c and ov17_02252A70.c): the rank's accessory limit, the Fashion Case's
 * pages, the dress-up points against the theme, the NPC outfits, the pictures' hit tests and which placed accessories
 * a photo keeps. Pure functions over the contest tables; the round (packages/menus contest/visual.ts) runs the screen.
 * Independent implementation.
 */
import type { ContestAccessory, ContestDressUp, ContestTables } from '@opensinnoh/contracts';

/** Decomp ov22_02257580: the accessories a contestant may place, by rank (Normal … Master). */
const LIMITS = [5, 10, 15, 20] as const;
export function accessoryLimit(rank: number): number {
  const n = LIMITS[rank];
  if (n === undefined) throw new Error(`contests: rank ${rank} has no accessory limit`);
  return n;
}

/** Decomp ov22_02257FB0 (list 0): the Fashion Case page an accessory sits on (14 pages by id). */
const PAGE_LAST_IDS = [5, 11, 17, 21, 28, 33, 38, 42, 49, 55, 60, 71, 91, 99] as const;
export const ACCESSORY_PAGES = PAGE_LAST_IDS.length;
export function accessoryPage(accessory: number): number {
  const p = PAGE_LAST_IDS.findIndex((last) => accessory <= last);
  if (p < 0 || accessory < 0) throw new Error(`contests: accessory ${accessory} has no page`);
  return p;
}

/** Backdrops sit nine to a page in the order received (decomp ov22_02258610, ov22_022589BC). */
export const BACKDROPS_PER_PAGE = 9;
export function backdropSlot(position: number): { page: number; x: number; y: number } {
  const i = position % BACKDROPS_PER_PAGE;
  const row = Math.floor(i / 3);
  const col = i % 3;
  return { page: Math.floor(position / BACKDROPS_PER_PAGE), x: 8 * (col + 1) + 24 * col + 8, y: 8 * (row + 1) + 32 * row + 16 };
}

/**
 * Decomp ov17_0223F334 with ov17_02252A70: the dress-up points, each accessory of the photo worth its theme's points
 * (contest_data.narc member 3 + theme). The backdrop counts for nothing.
 */
export function dressUpPoints(tables: ContestTables, theme: number, outfit: ContestDressUp): number {
  const t = tables.themes[theme];
  if (!t) throw new Error(`contests: no theme ${theme}`);
  return outfit.accessories.reduce((n, a) => {
    const p = t[a.accessory];
    if (p === undefined) throw new Error(`contests: theme ${theme} has no points for accessory ${a.accessory}`);
    return n + p;
  }, 0);
}

/** Decomp sub_020951B0: an NPC's photo is its record's outfit for the theme (`ContestOpponent.dressUps`). */
export function npcOutfit(tables: ContestTables, opponent: number, theme: number): ContestDressUp {
  const o = tables.opponents[opponent];
  if (!o) throw new Error(`contests: no opponent ${opponent}`);
  const d = tables.dressUps[o.dressUps[theme]!];
  if (!d) throw new Error(`contests: opponent ${opponent} has no outfit for theme ${theme}`);
  return d;
}

/** A rectangle in DS px, `left` ≤ x < `right`, `top` ≤ y < `bottom` (decomp IsTouchInRectangle). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const inRect = (r: Rect, x: number, y: number): boolean => x >= r.left && x < r.right && y >= r.top && y < r.bottom;

/** Decomp ov22_02254F84: an accessory's margin per side by its size (16 → 0, 32 → 10, 64 → 20). */
export const accessoryMargin = (size: number): number => (size === 16 ? 0 : size === 32 ? 10 : size === 64 ? 20 : fail(`an accessory ${size} px wide`));
const fail = (what: string): never => {
  throw new Error(`contests: ${what}`);
};

/** The accessory's rectangle less its margins at top-left (x, y) (decomp ov22_02259724). */
export function innerRect(a: ContestAccessory, x: number, y: number): Rect {
  const mx = accessoryMargin(a.width);
  const my = accessoryMargin(a.height);
  return { left: x + mx, top: y + my, right: x + a.width - mx, bottom: y + a.height - my };
}

/**
 * Decomp ov22_022577EC: the 16 points the overlap tests sample, a 4 × 4 grid over a rectangle's corners and thirds
 * (the thirds by integer division, as the decomp's u32 arithmetic).
 */
export function samplePoints(r: Rect): [number, number][] {
  const xs = [r.left, r.left + Math.floor((r.right - r.left) / 3), r.left + Math.floor((r.right - r.left) / 3) * 2, r.right];
  const ys = [r.top, r.top + Math.floor((r.bottom - r.top) / 3), r.top + Math.floor((r.bottom - r.top) / 3) * 2, r.bottom];
  return xs.flatMap((x) => ys.map((y): [number, number] => [x, y]));
}

const decoded = new Map<string, Uint8Array>();
function bytesOf(base64: string): Uint8Array {
  let b = decoded.get(base64);
  if (!b) {
    const s = atob(base64);
    b = Uint8Array.from(s, (c) => c.charCodeAt(0));
    decoded.set(base64, b);
  }
  return b;
}

/** Whether pixel (x, y) of the accessory's picture is opaque (out of the picture: no). */
export function accessoryOpaque(a: ContestAccessory, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= a.width || y >= a.height) return false;
  const i = y * a.width + x;
  return ((bytesOf(a.mask)[i >> 3]! >> (i & 7)) & 1) === 1;
}

/**
 * Decomp ov22_02254E54: a touch at (tx, ty) picks the accessory at top-left (x, y) when it lies in its rectangle and
 * an opaque pixel lies in the 8 × 8 around it.
 */
export function accessoryHit(a: ContestAccessory, x: number, y: number, tx: number, ty: number): boolean {
  if (!inRect({ left: x, top: y, right: x + a.width, bottom: y + a.height }, tx, ty)) return false;
  const px = tx - x;
  const py = ty - y;
  for (let v = py - 4; v < py + 4; v++) for (let u = px - 4; u < px + 4; u++) if (u >= 0 && v >= 0 && accessoryOpaque(a, u, v)) return true;
  return false;
}

/** Per row of a Pokémon picture's first frame, its opaque runs [first, end) (contracts `PokemonFace.opaque`). */
export function opaqueRows(opaque: string): [number, number][][] {
  const b = bytesOf(opaque);
  const rows: [number, number][][] = [];
  let i = 0;
  for (let y = 0; y < 80; y++) {
    const n = b[i++];
    if (n === undefined) throw new Error('contests: a Pokémon mask shorter than 80 rows');
    const runs: [number, number][] = [];
    for (let k = 0; k < n; k++) runs.push([b[i++]!, b[i++]!]);
    rows.push(runs);
  }
  if (i !== b.length) throw new Error('contests: a Pokémon mask longer than 80 rows');
  return rows;
}

/**
 * Decomp ov22_022592F0: whether (x, y) hits the Pokémon picture centred at (cx, cy): inside its 80 × 80 rectangle
 * (clipped to the screen, ov22_02259448) on an opaque pixel.
 */
export function monHit(rows: [number, number][][], cx: number, cy: number, x: number, y: number): boolean {
  const r = { left: Math.max(0, cx - 40), top: Math.max(0, cy - 40), right: Math.min(255, cx + 40), bottom: Math.min(191, cy + 40) };
  if (!inRect(r, x, y)) return false;
  const u = x - (cx - 40);
  const row = rows[y - (cy - 40)];
  return !!row?.some(([a, b]) => u >= a && u < b);
}

/** Decomp ov22_02257DEC: an accessory dropped at (x, y) is on the Pokémon when one of its 16 points hits it. */
export function onMon(a: ContestAccessory, x: number, y: number, rows: [number, number][][], cx: number, cy: number): boolean {
  return samplePoints(innerRect(a, x, y)).some(([px, py]) => monHit(rows, cx, cy, px, py));
}

/** One accessory on the stage: its id, top-left, and whether it went down on the Pokémon. */
export interface StagedAccessory {
  accessory: number;
  x: number;
  y: number;
  onMon: boolean;
}

/**
 * Decomp ov22_02256FD8 (ov22_02257778, ov22_0225768C, ov22_0225771C): the accessories a contest photo keeps. Those on
 * the Pokémon count, and so does any other whose rectangle one of a counted accessory's 16 points falls in, until no
 * more join. `staged` is in the photo's order: those on the Pokémon front to back, then the others; the kept ones
 * come back in that order.
 */
export function photoAccessories(tables: ContestTables, staged: readonly StagedAccessory[]): StagedAccessory[] {
  const state: number[] = staged.map((s) => (s.onMon ? 1 : 0));
  const rect = (s: StagedAccessory) => {
    const a = tables.accessories[s.accessory]!;
    return { left: s.x, top: s.y, right: s.x + a.width, bottom: s.y + a.height };
  };
  let i = 0;
  while (i < staged.length) {
    if (state[i] !== 1) {
      i++;
      continue;
    }
    const points = samplePoints(innerRect(tables.accessories[staged[i]!.accessory]!, staged[i]!.x, staged[i]!.y));
    staged.forEach((s, j) => {
      if (state[j] === 0 && points.some(([x, y]) => inRect(rect(s), x, y))) state[j] = 1;
    });
    state[i] = 2;
    i = 0;
  }
  return staged.filter((_, j) => state[j] !== 0);
}
