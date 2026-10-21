/**
 * The naming keyboard's keys against its board (ROM art): the cell grid is read from the key panel picture's own
 * pixels (where its checkerboard changes colour), then every key must cover its cell and every glyph sit where the
 * DS prints it (NamingScreen_PrintChars: centred in the cell's width, rounded down; 4 px down), all within one
 * device pixel at the screen's unit.
 */
import { expect, type Page } from '@playwright/test';

interface GridReport {
  cells: { cols: number; rows: number; pitch: [number, number] };
  /** The largest misplacement in device pixels: keys against cells, glyphs against the DS's print position. */
  keyError: number;
  glyphError: number;
  /** The largest distance of a glyph's centre from its cell's centre, in DS px (the DS's rounding down: at most ½). */
  glyphCentre: number;
  glyphs: number;
}

export async function namingGrid(page: Page): Promise<GridReport> {
  // Measure a connected board with a numeric unit and a loaded panel picture, before anything awaits (a redraw would detach it).
  await page.waitForFunction(() => {
    const keys = document.querySelector<HTMLElement>('.naming-keys.rom-picture');
    return !!keys && /url\(/.test(keys.style.backgroundImage) && Number.isFinite(parseFloat(getComputedStyle(keys).getPropertyValue('--unit')));
  });
  return page.evaluate(async () => {
    const panel = document.querySelector<HTMLElement>('.naming-keys.rom-picture')!;
    const unit = parseFloat(getComputedStyle(panel).getPropertyValue('--unit'));
    const p = panel.getBoundingClientRect();
    const keys = [...panel.querySelectorAll<HTMLElement>('.naming-key')].map((k) => {
      const [, r, c] = /^key:(\d):(\d+)$/.exec(k.dataset.tap!)!.map(Number);
      const glyph = k.querySelector<HTMLElement>('.naming-glyph');
      return { r: r!, c: c!, box: k.getBoundingClientRect(), glyph: glyph?.getBoundingClientRect() };
    });
    const img = new Image();
    img.src = /url\("?(.*?)"?\)/.exec(panel.style.backgroundImage)![1]!;
    await img.decode();
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [img.width, img.height];
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const colour = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!;
    };
    // The checkerboard's two colours: the commonest opaque ones; the second (the alternate cells) spans the whole grid.
    const counts = new Map<number, number>();
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (px[(y * img.width + x) * 4 + 3]) counts.set(colour(x, y), (counts.get(colour(x, y)) ?? 0) + 1);
    const [a, alt] = [...counts].sort((x, y) => y[1] - x[1]).map(([c]) => c);
    let [x0, y0, x1, y1] = [img.width, img.height, 0, 0];
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (colour(x, y) === alt) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
    // The cells' inner edges: where the two colours meet along lines through the grid.
    const edges = (from: number, to: number, at: (i: number) => number) => {
      const out: number[] = [];
      for (let i = from + 1; i < to; i++) if (at(i) !== at(i - 1) && [a, alt].includes(at(i)) && [a, alt].includes(at(i - 1))) out.push(i);
      return out;
    };
    const xs = edges(x0, x1, (x) => colour(x, Math.round((y0 + y1) / 2)));
    const ys = edges(y0, y1, (y) => colour(Math.round((x0 + x1) / 2), y));
    const [pw, ph] = [(x1 - x0) / (xs.length + 1), (y1 - y0) / (ys.length + 1)];
    if (xs.some((e, i) => e !== x0 + (i + 1) * pw) || ys.some((e, i) => e !== y0 + (i + 1) * ph)) throw new Error(`naming grid: uneven cells ${JSON.stringify({ x0, y0, x1, y1, xs, ys })}`);
    const dev = unit * devicePixelRatio;
    let keyError = 0;
    let glyphError = 0;
    let glyphCentre = 0;
    let glyphs = 0;
    for (const k of keys) {
      const cell = { x: x0 + k.c * pw, y: y0 + k.r * ph };
      const box = { x: (k.box.left - p.left) / unit, y: (k.box.top - p.top) / unit, w: k.box.width / unit, h: k.box.height / unit };
      keyError = Math.max(keyError, ...[box.x - cell.x, box.y - cell.y, box.w - pw, box.h - ph].map((d) => Math.abs(d) * dev));
      if (!k.glyph) continue;
      glyphs++;
      const gx = (k.glyph.left - p.left) / unit;
      const gy = (k.glyph.top - p.top) / unit;
      const w = k.glyph.width / unit;
      glyphError = Math.max(glyphError, Math.abs(gx - (cell.x + Math.floor((pw - Math.round(w)) / 2))) * dev, Math.abs(gy - (cell.y + 4)) * dev);
      glyphCentre = Math.max(glyphCentre, Math.abs(gx + w / 2 - (cell.x + pw / 2)));
    }
    return { cells: { cols: xs.length + 1, rows: ys.length + 1, pitch: [pw, ph] as [number, number] }, keyError, glyphError, glyphCentre, glyphs };
  });
}

/** The keys and glyphs sit on the board's 13 × 5 cells of 16 × 19 DS px, within a device pixel. */
export async function expectNamingGrid(page: Page): Promise<void> {
  const grid = await namingGrid(page);
  expect(grid.cells).toEqual({ cols: 13, rows: 5, pitch: [16, 19] });
  expect(grid.glyphs).toBeGreaterThan(20);
  expect(grid.keyError, JSON.stringify(grid)).toBeLessThanOrEqual(1);
  expect(grid.glyphError, JSON.stringify(grid)).toBeLessThanOrEqual(1);
  expect(grid.glyphCentre, JSON.stringify(grid)).toBeLessThanOrEqual(0.5 + 1 / 4);
}
