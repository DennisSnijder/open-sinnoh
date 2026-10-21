/**
 * The Canalave Library TV in the app (OPENSINNOH_NDS_ROM; desktop and phone): tests/rom-replays/m5-library-lucas.replay
 * plays from the cp10 chain anchor (story-seed.ts) through `window.openSinnohGame` to the explosion scene, and at its
 * `library-tv` beat, in the TV's hold, the scene is the one library TV screen: ROM art on its canvas, one whole-pixel
 * stage inside the viewport (never the split DS layout), and the scan lines scrolled. Then the replay plays on
 * out of the library. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AppView } from '@opensinnoh/contracts';
import { runReplay } from '@opensinnoh/game';
import { anchoredText } from '../integration/checkpoints-anchors.ts';
import { canvasStats } from './canvas.ts';
import { openChunk } from './story-seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = join(import.meta.dirname, '../../test-artifacts/library-tv');
const FILE = 'm5-library-lucas.replay';
const PARENT = 'cp10.replay';

async function scene(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const stage = document.querySelector('.library-tv-scene .ds-scene-stage')!.getBoundingClientRect();
    const canvas = document.querySelector('.library-tv-canvas') as HTMLCanvasElement;
    return {
      scenes: document.querySelectorAll('.library-tv-scene').length,
      stages: document.querySelectorAll('.ds-scene-stage').length,
      canvas: { w: canvas.width, h: canvas.height },
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
      view: { w: innerWidth, h: innerHeight },
      dpr: devicePixelRatio,
    };
  });
}

test('the Canalave Library TV is one whole-pixel screen in the explosion scene', async ({ page }, info) => {
  test.setTimeout(1_800_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const { driver, registries } = await openChunk(page, PARENT, 1, SHOTS, info.project.name);
  const beats: string[] = [];
  const result = await runReplay(driver, anchoredText(FILE, PARENT), {
    registries,
    seed: 1,
    name: FILE,
    repeat: false,
    async beforeLine(line) {
      if (line.action.type !== 'screenshot') return;
      const name = line.action.name;
      const app = () => page.evaluate(() => window.openSinnohGame!.snapshot().app) as Promise<AppView>;
      const first = await app();
      expect(first, name).toMatchObject({ app: 'library-tv', black: 0 });
      await page.waitForSelector('.library-tv-canvas', { timeout: 20_000 });
      // The ROM picture, scan lines and frame load once per page: wait for them on the canvas.
      await expect.poll(async () => (await canvasStats(page, '.library-tv-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(16);
      expect((await canvasStats(page, '.library-tv-canvas')).lit, name).toBeGreaterThan(0.2);
      const s = await scene(page);
      expect(s.scenes, name).toBe(1);
      expect(s.stages, name).toBe(1);
      expect(s.canvas, name).toEqual({ w: 256, h: 192 });
      // A whole number of device pixels per DS pixel, at the DS aspect, inside the viewport.
      const k = s.stage.w / 256;
      expect(s.stage.h, name).toBeCloseTo(192 * k, 1);
      expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
      expect(s.stage.x, name).toBeGreaterThanOrEqual(-0.5);
      expect(s.stage.y, name).toBeGreaterThanOrEqual(-0.5);
      expect(s.stage.x + s.stage.w, name).toBeLessThanOrEqual(s.view.w + 0.5);
      expect(s.stage.y + s.stage.h, name).toBeLessThanOrEqual(s.view.h + 0.5);
      if (info.project.name === 'phone') expect(s.stage.w / s.view.w, name).toBeGreaterThan(0.85);
      // The scan lines have scrolled since the fade in (4/16 of a row a frame).
      expect((first as { scanY: number }).scanY, name).toBeGreaterThan(0);
      beats.push(name);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(beats).toEqual(['library-tv']);
  expect(errors).toEqual([]);
});
