/**
 * Writes the brand's static files into public/ from the one drawing in packages/ui/src/brand.ts (original art):
 * `pnpm brand:assets`. Every pixel is a whole square (nearest neighbour, no anti-aliasing).
 * - favicon-16.png: the 16-px Window cut; favicon-32.png: the 32-px Title-tab window; both transparent, paper halo.
 * - favicon.svg: the 32-px drawing, with the 16-px cut inside for a 16-px render (an SVG media query).
 * - apple-touch-icon.png (180), icon-192.png, icon-512.png: the mark on the near-black plate with its dot grid.
 * - icon-maskable-512.png: the mark inside the 80 % safe circle.
 * - og-image.png (1200 × 630): the link card, the wordmark over the tagline (never the mark beside it). Its text (Figtree, Silkscreen) is drawn by Chromium, so this one
 *   runs a browser; the pixel art is drawn as whole squares there too.
 * - site/public (opensinnoh.com, the landing page): the favicons, the Apple touch icon and its own link card: a real gameplay
 *   frame (site/shots/montage-poster.webp, the one screenshot exception, docs/decisions.md) at ×1, full bleed, with
 *   the wordmark, the Beta badge, one line and opensinnoh.com centred on a fade at the bottom (inside the centre square,
 *   for apps that crop). The app's card stays brand only: the app ships no game content.
 * - docs/brand/wordmark-{light,dark}.svg: the wordmark ×8 for the README (GitHub picks one by colour scheme).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from '@playwright/test';
import { HALO_ICON, HALO_PLATE, MARK_16, MARK_32, markGrid, wordmarkGrid, type MarkDef } from '../packages/ui/src/brand.ts';
import { TOKENS } from '../packages/ui/src/tokens.ts';
import { browserExecutable } from './browser.ts';

const pub = join(import.meta.dirname, '../public');
const site = join(import.meta.dirname, '../site/public');
const C = TOKENS.color;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** An RGBA image. */
class Img {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h * 4);
  }
  fill(x: number, y: number, w: number, h: number, hex: string): void {
    const [r, g, b] = rgb(hex);
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) throw new Error(`brand-assets: pixel ${i},${j} outside ${this.w}×${this.h}`);
        this.px.set([r, g, b, 255], (j * this.w + i) * 4);
      }
  }
  /** A colour grid at `k` px per cell, top-left at (x, y). */
  grid(g: (string | null)[][], x: number, y: number, k: number): void {
    g.forEach((row, j) => row.forEach((c, i) => c && this.fill(x + i * k, y + j * k, k, k, c)));
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) raw.set(this.px.subarray(y * this.w * 4, (y + 1) * this.w * 4), y * (this.w * 4 + 1) + 1);
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length);
      head.write(type, 4, 'latin1');
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
      return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

/** The mark alone, transparent, one cell per pixel. */
function favicon(m: MarkDef): Img {
  const img = new Img(m.n, m.n);
  img.grid(markGrid(m, HALO_ICON), 0, 0, 1);
  return img;
}

/** The mark at `k` px per pixel, centred on the near-black plate with its dot grid every `dots` px. */
function plate(size: number, k: number, dots: number): Img {
  const img = new Img(size, size);
  img.fill(0, 0, size, size, C.bg!.dark);
  const d = Math.max(1, Math.floor(dots / 6));
  for (let y = dots / 2; y + d <= size; y += dots) for (let x = dots / 2; x + d <= size; x += dots) img.fill(x, y, d, d, C.face!.dark);
  const o = Math.round((size - 32 * k) / 2);
  img.grid(markGrid(MARK_32, HALO_PLATE), o, o, k);
  return img;
}

/** The SVG favicon: the 32-px drawing, and the 16-px cut where it is drawn at under 32 px. */
function faviconSvg(): string {
  const layer = (m: MarkDef, cls: string, scale: number) => {
    const g = markGrid(m, HALO_ICON);
    const byColor = new Map<string, string[]>();
    g.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        if (!c || row[x - 1] === c) continue;
        let w = 1;
        while (row[x + w] === c) w++;
        byColor.set(c, [...(byColor.get(c) ?? []), `M${x} ${y}h${w}v1h-${w}z`]);
      }
    });
    const paths = [...byColor].map(([c, d]) => `<path fill="${c}" d="${d.join('')}"/>`).join('');
    return `<g class="${cls}"${scale > 1 ? ` transform="scale(${scale})"` : ''}>${paths}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><style>.s{display:none}@media (max-width:31px){.s{display:inline}.l{display:none}}</style>${layer(MARK_32, 'l', 1)}${layer(MARK_16, 's', 2)}</svg>\n`;
}

/** The site card through pngquant (a photo-like frame is too big as a lossless PNG). */
const quantize = (data: Buffer): Buffer => execFileSync('pngquant', ['--quality=80-95', '--speed=1', '--strip', '-'], { input: data, maxBuffer: 1 << 24 });

const write = (name: string, data: Buffer | string, dir = pub) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
  console.log(`${relative(join(import.meta.dirname, '..'), join(dir, name))} ${data.length} B`);
};

/** The wordmark as SVG rects, one per horizontal run of a colour, at a whole scale. */
function wordmarkSvg(theme: 'light' | 'dark', scale: number): string {
  const g = wordmarkGrid(C.ink![theme], C.accent![theme], C['ink-shadow']![theme]);
  const rects: string[] = [];
  g.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!c || row[x - 1] === c) continue;
      let w = 1;
      while (row[x + w] === c) w++;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`);
    }
  });
  const [w, h] = [g[0]!.length, g.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" role="img" aria-label="OpenSinnoh">${rects.join('')}</svg>\n`;
}

write('favicon-16.png', favicon(MARK_16).png());
write('favicon-32.png', favicon(MARK_32).png());
write('favicon.svg', faviconSvg());
write('apple-touch-icon.png', plate(180, 5, 12).png());
write('icon-192.png', plate(192, 5, 12).png());
write('icon-512.png', plate(512, 14, 32).png());
// Maskable: the 288-px mark's corners sit inside the 80 % safe circle (radius 204.8 around the centre).
write('icon-maskable-512.png', plate(512, 9, 32).png());
for (const name of ['favicon-16.png', 'favicon-32.png', 'favicon.svg', 'apple-touch-icon.png']) write(name, readFileSync(join(pub, name)), site);
for (const theme of ['light', 'dark'] as const) write(`wordmark-${theme}.svg`, wordmarkSvg(theme, 8), join(import.meta.dirname, '../docs/brand'));

/* The link card, drawn by Chromium for its fonts. */
const font = (pkg: string, file: string) => readFileSync(join(import.meta.dirname, `../packages/ui/node_modules/@fontsource/${pkg}/files/${file}`)).toString('base64');
const card = {
  bg: C.bg!.dark,
  dot: C.dot!.dark,
  rings: [C.halo!.dark, C.rim!.dark, C.ring!.dark, C.ring!.dark, C.inner!.dark, C.face!.dark],
  word: wordmarkGrid(C.ink!.dark, C.accent!.dark, C['ink-shadow']!.dark),
  ink: C.ink!.dark,
  accent: C.accent!.dark,
  muted: C.muted!.dark,
  figtree: font('figtree', 'figtree-latin-500-normal.woff2'),
  figtreeBody: font('figtree', 'figtree-latin-400-normal.woff2'),
  silkscreen: font('silkscreen', 'silkscreen-latin-400-normal.woff2'),
};
const browser = await chromium.launch({ executablePath: browserExecutable() });
try {
  const page = await browser.newPage();
  await page.evaluate('globalThis.__name = (f) => f'); // tsx names functions with a helper the page lacks
  const drawCard = (host: string) => page.evaluate(async (d) => {
    const load = async (family: string, b64: string, weight: string) => {
      const f = new FontFace(family, `url(data:font/woff2;base64,${b64})`, { weight });
      document.fonts.add(await f.load());
    };
    await load('Figtree', d.figtree, '500');
    await load('Figtree', d.figtreeBody, '400');
    await load('Silkscreen', d.silkscreen, '400');
    const W = 1200;
    const H = 630;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = d.bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = d.dot;
    for (let y = 6; y < H; y += 24) for (let x = 6; x < W; x += 24) g.fillRect(x, y, 4, 4);
    // The window: halo, rim, a 2-dot ring, the inner line, the face; corners cut by one dot (4 px).
    const k = 4;
    d.rings.forEach((col, i) => {
      g.fillStyle = col;
      const x = 64 + i * k;
      const y = 64 + i * k;
      const w = W - 128 - 2 * i * k;
      const h = H - 128 - 2 * i * k;
      g.fillRect(x + k, y, w - 2 * k, h);
      g.fillRect(x, y + k, w, h - 2 * k);
    });
    const grid = (cells: (string | null)[][], x0: number, y0: number, s: number) =>
      cells.forEach((row, y) =>
        row.forEach((col, x) => {
          if (!col) return;
          g.fillStyle = col;
          g.fillRect(x0 + x * s, y0 + y * s, s, s);
        }),
      );
    grid(d.word, 120, 128, 12);
    g.fillStyle = d.ink;
    g.font = '500 36px Figtree';
    g.fillText('Play Pokémon Platinum in your browser,', 120, 336);
    g.fillText('on desktop or phone, from your own copy.', 120, 382);
    g.fillStyle = d.accent;
    g.font = '32px Silkscreen';
    g.fillText(d.host, 120, 452);
    g.fillStyle = d.muted;
    g.font = '400 20px Figtree';
    g.fillText('Unofficial fan project; not affiliated with Nintendo, Game Freak or The Pokémon Company.', 120, 510);
    return c.toDataURL('image/png');
  }, { ...card, host });
  const shot = readFileSync(join(import.meta.dirname, '../site/shots/montage-poster.webp')).toString('base64');
  const drawSiteCard = () => page.evaluate(async (d) => {
    const load = async (family: string, b64: string, weight: string) => {
      const f = new FontFace(family, `url(data:font/woff2;base64,${b64})`, { weight });
      document.fonts.add(await f.load());
    };
    await load('Figtree', d.figtree, '500');
    await load('Silkscreen', d.silkscreen, '400');
    const img = new Image();
    img.src = `data:image/webp;base64,${d.shot}`;
    await img.decode();
    if (img.width !== 1280 || img.height !== 720) throw new Error(`brand-assets: montage-poster is ${img.width}×${img.height}, expected 1280×720`);
    const W = 1200;
    const H = 630;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // The frame at ×1 (no resampling): from x 0, below the area sign, so the player and Charizard sit near the centre.
    g.drawImage(img, 0, 76, W, H, 0, 0, W, H);
    // The fade behind the brand: the page's near-black, from clear to almost solid.
    const [r, gr, b] = [1, 3, 5].map((i) => parseInt(d.bg.slice(i, i + 2), 16));
    const fade = g.createLinearGradient(0, 300, 0, 440);
    fade.addColorStop(0, `rgba(${r},${gr},${b},0)`);
    fade.addColorStop(1, `rgba(${r},${gr},${b},0.9)`);
    g.fillStyle = fade;
    g.fillRect(0, 300, W, H - 300);
    g.fillStyle = `rgba(${r},${gr},${b},0.9)`;
    g.fillRect(0, 440, W, H - 440);
    // The wordmark ×8 and the Beta badge after it, past its clear space (2 glyph pixels), centred as one row.
    const k = 8;
    const wordW = d.word[0]!.length * k;
    const wordH = d.word.length * k;
    g.font = '32px Silkscreen';
    const badgeText = 'BETA';
    const badgeW = Math.round(g.measureText(badgeText).width) + 2 * 8;
    const badgeH = 40;
    const gap = 3 * k;
    const x0 = Math.round((W - wordW - gap - badgeW) / 2 / k) * k;
    const y0 = 368;
    d.word.forEach((row, y) =>
      row.forEach((col, x) => {
        if (!col) return;
        g.fillStyle = col;
        g.fillRect(x0 + x * k, y0 + y * k, k, k);
      }),
    );
    const bx = x0 + wordW + gap;
    const by = y0 + wordH - badgeH - k; // on the wordmark's baseline (its last row is the shadow)
    g.fillStyle = d.accent;
    g.fillRect(bx, by, badgeW, badgeH);
    g.fillStyle = d.onAccent;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(badgeText, bx + badgeW / 2, by + badgeH / 2 + 2);
    g.fillStyle = d.ink;
    g.font = '500 40px Figtree';
    g.fillText('Pokémon Platinum, rebuilt for the browser', W / 2, 518);
    g.fillStyle = d.accent;
    g.font = '32px Silkscreen';
    g.fillText('opensinnoh.com', W / 2, 570);
    return c.toDataURL('image/png');
  }, { ...card, shot, onAccent: C['on-accent']!.dark });
  const png = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  write('og-image.png', png(await drawCard('play.opensinnoh.com')));
  write('og-image.png', quantize(png(await drawSiteCard())), site);
} finally {
  await browser.close();
}
