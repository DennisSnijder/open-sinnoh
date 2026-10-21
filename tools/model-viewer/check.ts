/**
 * Headless check: serves the model viewer, loads the ROM through its file input, renders slice chunks
 * and asserts non-trivial coverage (pixels that are neither the clear colour nor black). Screenshots go
 * to the gitignored test-artifacts/ folder only (they show ROM content).
 * Usage: OPENSINNOH_NDS_ROM=... [PLAYWRIGHT_CHANNEL=chrome] pnpm viewer:check [chunk ...]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const rom = process.env.OPENSINNOH_NDS_ROM;
if (!rom) {
  console.log('OPENSINNOH_NDS_ROM not set: skipped');
  process.exit(0);
}
const chunks = process.argv.slice(2).map(Number);
if (!chunks.length) chunks.push(0, 186, 537);
const out = join(import.meta.dirname, '../../test-artifacts/model-viewer');
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: join(import.meta.dirname, 'vite.config.ts'), logLevel: 'warn' });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('vite did not report a URL');
// PLAYWRIGHT_CHANNEL=chrome uses an installed Chrome instead of Playwright's bundled browser.
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  for (const chunk of chunks) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}?chunk=${chunk}`);
    await page.setInputFiles('#rom', rom);
    await page.waitForFunction((c) => document.body.dataset.ready === String(c) || document.body.dataset.error, chunk, { timeout: 60_000 });
    await page.waitForTimeout(500);
    if (errors.length) throw new Error(`chunk ${chunk}: ${errors.join('; ')}`);
    const coverage = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const g = document.createElement('canvas');
      g.width = c.width;
      g.height = c.height;
      const ctx = g.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, g.width, g.height).data;
      let drawn = 0;
      const colours = new Set<number>();
      for (let i = 0; i < d.length; i += 4) {
        const [r, gr, b] = [d[i] as number, d[i + 1] as number, d[i + 2] as number];
        const clear = Math.abs(r - 0x7a) < 3 && Math.abs(gr - 0xa6) < 3 && Math.abs(b - 0xd8) < 3;
        if (!clear && r + gr + b > 0) drawn++;
        colours.add((r << 16) | (gr << 8) | b);
      }
      return { drawn: drawn / (d.length / 4), colours: colours.size };
    });
    await page.screenshot({ path: join(out, `chunk-${chunk}.png`) });
    const ok = coverage.drawn > 0.2 && coverage.colours > 32;
    console.log(`chunk ${chunk}: ${(coverage.drawn * 100).toFixed(1)}% drawn, ${coverage.colours} colours ${ok ? 'ok' : 'FAIL'}`);
    failed ||= !ok;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
