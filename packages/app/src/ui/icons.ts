/**
 * Original 12×12 pixel icons (our own art), drawn as crisp SVG. Placeholders for the start-menu
 * icons and party icons until 2D graphics (NCGR/NCLR/NCER) are imported.
 * Bitmap legend: '#' ink, '+' accent, '.' transparent.
 */
const ICONS = {
  dex: [
    '.##########.', '#++++#.....#', '#+..+#.###.#', '#++++#.....#', '#....#.###.#', '#.##.#.....#',
    '#....#.###.#', '#.##.#.....#', '#....#.###.#', '#++++#.....#', '#....#.....#', '.##########.',
  ],
  team: [
    '.##......##.', '#++#....#++#', '#++#.##.#++#', '.##.#++#.##.', '....#++#....', '.##..##..##.',
    '#++#....#++#', '#++#.##.#++#', '.##.####.##.', '...######...', '...######...', '....####....',
  ],
  bag: [
    '....####....', '...#....#...', '..#......#..', '.##########.', '#++++++++++#', '#+########+#',
    '#+#......#+#', '#+#..##..#+#', '#+#......#+#', '#+########+#', '#++++++++++#', '.##########.',
  ],
  card: [
    '............', '############', '#++++++++++#', '#++++++++++#', '#..##......#', '#.####.###.#',
    '#.####.....#', '#..##..###.#', '#.####.....#', '#.####.##..#', '############', '............',
  ],
  save: [
    '##########..', '#+++++++#.#.', '#+++++++#..#', '#+++++++#..#', '#########..#', '#..........#',
    '#.########.#', '#.#......#.#', '#.#.####.#.#', '#.#......#.#', '#.########.#', '############',
  ],
  options: [
    '.....##.....', '..#.#++#.#..', '.#+#++++#+#.', '..#++##++#..', '.#++#..#++#.', '#++#....#++#',
    '#++#....#++#', '.#++#..#++#.', '..#++##++#..', '.#+#++++#+#.', '..#.#++#.#..', '.....##.....',
  ],
  exit: [
    '#######.....', '#.....#.....', '#.....#..#..', '#.....#..##.', '#.....######', '#..+..#######',
    '#.....######', '#.....#..##.', '#.....#..#..', '#.....#.....', '#.....#.....', '#######.....',
  ],
  watch: [
    '...######...', '...#....#...', '..########..', '.#++++++++#.', '.#+##+##++#.', '.#+##+##++##',
    '.#+##+##++##', '.#+##+##++#.', '.#++++++++#.', '..########..', '...#....#...', '...######...',
  ],
  menu: [
    '............', '.##########.', '#..........#', '#.##.#####.#', '#..........#', '#.##.#####.#',
    '#..........#', '#.##.#####.#', '#..........#', '.##########.', '............', '............',
  ],
  fullscreen: [
    '............', '.####..####.', '.#........#.', '.#..+..+..#.', '.#..++++..#.', '.....++.....',
    '.....++.....', '.#..++++..#.', '.#..+..+..#.', '.#........#.', '.####..####.', '............',
  ],
  fast: [
    '............', '.#.....#....', '.##....##...', '.#+#...#+#..', '.#++#..#++#.', '.#+++#.#+++#',
    '.#+++#.#+++#', '.#++#..#++#.', '.#+#...#+#..', '.##....##...', '.#.....#....', '............',
  ],
} as const;

export type IconName = keyof typeof ICONS;

/**
 * An inline SVG icon; colours come from CSS (`--icon-ink`, `--icon-accent`). One path per colour of
 * whole-unit squares, crisp-edged, so it scales without seams or soft edges.
 */
export function icon(name: IconName, className = 'ui-icon'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const d = { '#': '', '+': '' };
  ICONS[name].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '#' || c === '+') d[c] += `M${x} ${y}h1v1h-1z`;
    }
  });
  for (const [c, fill] of [['#', 'var(--icon-ink)'], ['+', 'var(--icon-accent)']] as const) {
    if (!d[c]) continue;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d[c]);
    path.setAttribute('fill', fill);
    svg.append(path);
  }
  return svg;
}

/**
 * Party placeholder: an original round blob in a colour derived from the species id, drawn on a
 * 24×24 canvas (scaled crisply by CSS). Replaced by the imported party icons with 2D graphics.
 */
export function speciesPlaceholder(id: string): HTMLCanvasElement {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const hue = (h >>> 0) % 360;
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  c.className = 'mon-icon';
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext('2d')!;
  const body = `hsl(${hue} 55% 62%)`;
  const dark = `hsl(${hue} 45% 30%)`;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const dx = x - 11.5;
      const dy = (y - 13) * 1.15;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 10) continue;
      g.fillStyle = d > 8.6 ? dark : y < 9 && x > 5 && x < 11 ? '#ffffffaa' : body;
      g.fillRect(x, y, 1, 1);
    }
  g.fillStyle = dark;
  g.fillRect(8, 12, 2, 3);
  g.fillRect(14, 12, 2, 3);
  return c;
}
