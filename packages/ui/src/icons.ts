/**
 * OpenSinnoh UI icons: original pixel art on a 16 × 16 grid, solid silhouettes with 1-pixel cut-outs (`p`
 * filled rects, `c` cut rects, each [x, y, w, h]), drawn in `currentColor` at ×1 (16 px) or ×2 (32 px).
 * Ink or muted only (the ▶ cursor: the accent), never a tone; always beside a visible label, or on an
 * icon-only button with an accessible name and a tooltip. `m` is the meaning: use an icon only for it.
 */
type Rect = [number, number, number, number];
export interface IconDef {
  m: string;
  p: Rect[];
  c?: Rect[];
}

export const ICONS = {
  back: { m: 'Back, return, close a screen', p: [[1,5,1,2],[2,4,1,4],[3,3,1,6],[4,2,1,8],[5,5,8,2],[11,7,2,5],[6,10,5,2]] },
  close: { m: 'Dismiss (banners, sheets)', p: [[2,2,2,2],[4,4,2,2],[6,6,4,4],[10,10,2,2],[12,12,2,2],[10,4,2,2],[12,2,2,2],[4,10,2,2],[2,12,2,2]] },
  up: { m: 'Move up, more above', p: [[7,3,2,1],[6,4,4,1],[5,5,6,1],[4,6,8,1],[3,7,10,1],[6,8,4,5]] },
  down: { m: 'Move down, more below, open a select', p: [[6,3,4,5],[3,8,10,1],[4,9,8,1],[5,10,6,1],[6,11,4,1],[7,12,2,1]] },
  left: { m: 'Previous, more to the left', p: [[3,7,1,2],[4,6,1,4],[5,5,1,6],[6,4,1,8],[7,3,1,10],[8,6,5,4]] },
  right: { m: 'Next, more to the right', p: [[3,6,5,4],[8,3,1,10],[9,4,1,8],[10,5,1,6],[11,6,1,4],[12,7,1,2]] },
  cursor: { m: 'The cursor: the row the keys are on (in the accent)', p: [[4,2,2,12],[6,4,2,8],[8,6,2,4]] },
  dpad: { m: 'Controls, any direction', p: [[6,1,4,14],[1,6,14,4]], c: [[7,7,2,2]] },
  search: { m: 'Search, filter', p: [[4,1,5,1],[2,2,9,2],[1,4,11,4],[2,8,9,2],[4,10,5,1],[10,10,3,3],[12,12,3,3]], c: [[4,4,5,4]] },
  sort: { m: 'Sort order', p: [[2,3,12,2],[2,7,9,2],[2,11,6,2]] },
  check: { m: 'Confirm, use, done, selected', p: [[1,7,2,2],[2,8,2,2],[3,9,2,2],[4,10,2,2],[5,11,2,2],[6,10,2,2],[7,9,2,2],[8,8,2,2],[9,7,2,2],[10,6,2,2],[11,5,2,2],[12,4,2,2],[13,3,2,2]] },
  plus: { m: 'Add', p: [[7,2,2,12],[2,7,12,2]] },
  star: { m: 'Register (assign to a quick key)', p: [[7,1,2,3],[6,4,4,1],[1,5,14,2],[3,7,10,2],[4,9,8,2],[3,11,4,2],[9,11,4,2],[2,13,3,1],[11,13,3,1]] },
  info: { m: 'Explain, details', p: [[5,1,6,1],[3,2,10,1],[2,3,12,2],[1,5,14,6],[2,11,12,2],[3,13,10,1],[5,14,6,1]], c: [[7,4,2,2],[7,7,2,5]] },
  warn: { m: 'Error or risk (in danger colour)', p: [[7,1,2,2],[6,3,4,2],[5,5,6,2],[4,7,8,2],[3,9,10,2],[2,11,12,2],[1,13,14,2]], c: [[7,5,2,5],[7,11,2,2]] },
  reset: { m: 'Reload, retry, reset', p: [[6,1,4,1],[13,1,1,1],[4,2,8,1],[13,2,2,1],[3,3,3,1],[10,3,5,1],[2,4,3,1],[11,4,4,1],[2,5,2,1],[10,5,5,1],[1,6,3,4],[12,8,3,2],[2,10,2,1],[12,10,2,1],[2,11,3,1],[11,11,3,1],[3,12,3,1],[10,12,3,1],[4,13,8,1],[6,14,4,1]] },
  export: { m: 'Send or download out of the game', p: [[1,10,2,5],[13,10,2,5],[1,13,14,2],[7,4,2,7],[7,1,2,1],[6,2,4,1],[5,3,6,1],[4,4,8,1]] },
  import: { m: 'Bring a file into the game', p: [[1,10,2,5],[13,10,2,5],[1,13,14,2],[7,1,2,7],[4,7,8,1],[5,8,6,1],[6,9,4,1],[7,10,2,1]] },
  copy: { m: 'Copy to the clipboard', p: [[1,1,9,2],[1,1,2,10],[5,5,10,10]], c: [[7,7,6,1],[7,10,6,1]] },
  trash: { m: 'Delete (in danger colour on destructive buttons)', p: [[1,3,14,2],[5,1,6,2],[2,6,12,9]], c: [[5,8,2,5],[9,8,2,5]] },
  gear: { m: 'Options', p: [[6,1,4,14],[1,6,14,4],[3,3,10,10]], c: [[6,6,4,4]] },
  shield: { m: 'Privacy, error reports', p: [[2,1,12,7],[3,8,10,2],[4,10,8,2],[5,12,6,1],[6,13,4,1],[7,14,2,1]], c: [[7,3,2,7]] },
  screen: { m: 'This device: display, sound, controls', p: [[1,2,14,9],[7,11,2,2],[4,13,8,2]], c: [[3,4,10,5]] },
  pad: { m: 'Game settings', p: [[2,4,12,1],[1,5,14,7],[3,12,3,2],[10,12,3,2]], c: [[3,7,3,1],[4,6,1,3],[10,6,2,2],[12,8,2,2]] },
  disk: { m: 'Data: saves, imported files', p: [[3,1,10,1],[1,2,14,3],[1,6,14,3],[1,10,14,3],[3,13,10,1]] },
  save: { m: 'Save the game', p: [[1,1,13,14],[14,2,1,13]], c: [[4,1,7,4],[3,9,10,4]] },
  file: { m: 'A ROM or save file', p: [[2,1,9,14],[11,4,3,11]], c: [[4,6,7,6]] },
  mods: { m: 'Mods', p: [[1,4,12,11],[5,1,4,3],[13,7,2,4]], c: [[1,8,2,3]] },
  party: { m: 'Your party', p: [[6,1,4,4],[1,3,4,4],[11,3,4,4],[5,6,6,9],[0,8,5,7],[11,8,5,7]] },
  bag: { m: 'Bag, items pocket', p: [[5,1,6,2],[4,2,2,3],[10,2,2,3],[1,5,14,10]], c: [[1,8,14,1],[7,9,2,2]] },
  dex: { m: 'Pokédex', p: [[2,1,12,14]], c: [[7,1,1,14],[4,4,2,1],[9,4,3,1],[9,7,3,1]] },
  card: { m: 'Trainer card', p: [[1,3,14,10]], c: [[3,5,4,5],[9,6,4,1],[9,9,3,1]] },
  exit: { m: 'Leave, exit to title', p: [[2,1,7,14],[9,7,4,2],[12,5,1,6],[13,6,1,4],[14,7,1,2]], c: [[6,8,1,1]] },
  pin: { m: 'Location', p: [[4,1,8,1],[3,2,10,1],[2,3,12,6],[3,9,10,1],[4,10,8,1],[5,11,6,1],[6,12,4,1],[7,13,2,2]], c: [[6,4,4,3]] },
  clock: { m: 'Play time', p: [[5,1,6,1],[3,2,10,1],[2,3,12,2],[1,5,14,6],[2,11,12,2],[3,13,10,1],[5,14,6,1]], c: [[5,3,6,1],[3,4,10,1],[3,5,4,6],[9,5,4,2],[12,7,1,2],[3,11,10,1],[5,12,6,1]] },
  coin: { m: 'Money', p: [[6,1,5,1],[4,2,9,1],[3,3,11,2],[2,5,13,6],[3,11,11,2],[4,13,9,1],[6,14,5,1]], c: [[5,4,1,8],[8,4,3,1],[7,5,1,6],[11,5,1,6],[8,11,3,1]] },
  badge: { m: 'Badges', p: [[6,1,4,2],[4,3,8,2],[2,5,12,6],[4,11,8,2],[6,13,4,2]], c: [[6,6,4,4]] },
  heart: { m: 'HP, medicine pocket', p: [[3,2,4,1],[9,2,4,1],[2,3,12,1],[1,4,14,4],[2,8,12,2],[4,10,8,2],[6,12,4,1],[7,13,2,1]] },
  berry: { m: 'Berries pocket', p: [[7,1,3,2],[4,4,8,1],[3,5,10,1],[2,6,12,6],[3,12,10,1],[4,13,8,1]], c: [[4,7,2,2]] },
  gem: { m: 'Gems pocket', p: [[4,2,8,1],[3,3,10,1],[2,4,12,3],[3,7,10,2],[4,9,8,2],[5,11,6,1],[6,12,4,1],[7,13,2,1]], c: [[2,6,12,1]] },
  key: { m: 'Key items pocket', p: [[1,3,6,6],[7,5,8,2],[11,7,2,3],[13,7,2,2]], c: [[3,5,2,2]] },
  fire: { m: 'Fire type', p: [[7,1,2,2],[6,3,4,2],[5,5,6,3],[4,8,8,4],[5,12,6,2],[6,14,4,1]], c: [[7,9,2,3]] },
  water: { m: 'Water type', p: [[7,1,2,2],[6,3,4,2],[5,5,6,2],[4,7,8,5],[5,12,6,2],[6,14,4,1]], c: [[6,8,1,2]] },
  grass: { m: 'Grass type', p: [[10,1,5,2],[8,3,6,2],[6,5,7,2],[4,7,7,2],[3,9,5,2],[2,11,3,2],[1,13,2,2]] },
  electric: { m: 'Electric type', p: [[8,1,5,2],[7,3,5,2],[6,5,4,2],[3,7,10,2],[8,9,4,2],[7,11,3,2],[6,13,3,2]] },
  psychic: { m: 'Psychic type', p: [[4,4,8,1],[2,5,12,1],[1,6,14,4],[2,10,12,1],[4,11,8,1]], c: [[6,6,4,4]] },
  normal: { m: 'Normal type', p: [[7,1,2,2],[5,3,6,2],[3,5,10,2],[1,7,14,2],[3,9,10,2],[5,11,6,2],[7,13,2,2]], c: [[6,6,4,4]] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** The icon's 16 × 16 bitmap (true = ink): fills minus cut-outs. */
export function iconBitmap(name: IconName): boolean[][] {
  const d: IconDef = ICONS[name];
  const g = Array.from({ length: 16 }, () => Array<boolean>(16).fill(false));
  const paint = (rects: Rect[], on: boolean) => {
    for (const [x, y, w, h] of rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j]![i] = on;
  };
  paint(d.p, true);
  paint(d.c ?? [], false);
  return g;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The icon as an inline SVG of row runs (no masks, no ids). Decorative unless `label` is given. */
export function icon(name: IconName, size: 16 | 32 = 16, label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'os-ico');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.dataset.icon = name;
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  iconBitmap(name).forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      if (!row[x] || row[x - 1]) continue;
      let w = 1;
      while (row[x + w]) w++;
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', '1');
      svg.append(r);
    }
  });
  return svg;
}
