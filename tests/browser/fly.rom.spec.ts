/**
 * Fly in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone: tests/rom-replays/sys-fly.replay
 * through `window.openSinnohGame`, with checks at its beats. The Town Map is one whole-pixel DS screen of ROM art with a
 * tap target on each unlocked town; the replay's tap on Jubilife is a real click on its block. Then the cut-in (the
 * band of ROM pattern over the field, the wind) and the bird carrying the player are drawn on the overlay canvas, and
 * the flight lands in Jubilife. Screenshots go to test-artifacts/fly (ROM content, never commit).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = 'test-artifacts/fly';
const read = (file: string) => readFileSync(join(import.meta.dirname, '../rom-replays', file), 'utf8');

/** Opaque pixels of the overlay canvas in the DS frame's rows y0–y1 (centred on the view), and their colours. */
function overlayRows(page: Page, y0: number, y1: number) {
  return page.evaluate(
    ([a, b]) =>
      new Promise<{ opaque: number; colours: number }>((resolve) =>
        requestAnimationFrame(() => {
          const c = document.getElementById('overlay-canvas') as HTMLCanvasElement;
          const scale = window.openSinnohApp!.zoom().scale * devicePixelRatio;
          const top = Math.round((c.height - 192 * scale) / 2 + a * scale);
          const h = Math.max(1, Math.round((b - a) * scale));
          const px = c.getContext('2d')!.getImageData(0, top, c.width, h).data;
          const colours = new Set<number>();
          let opaque = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (!px[i + 3]) continue;
            opaque++;
            colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
          }
          resolve({ opaque: opaque / (px.length / 4), colours: colours.size });
        }),
      ),
    [y0, y1] as const,
  );
}

test('sys-fly: the Town Map, a tap on a town, the cut-in and the landing', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const registries = loadGamePacks([romSlice().pack]).registries;
  const project = info.project.name;
  const beats: string[] = [];
  const result = await runReplay(pageDriver(page, SHOTS, project), read('sys-fly.replay'), {
    registries,
    name: 'sys-fly.replay',
    repeat: false,
    async beforeLine(line: ReplayLine) {
      const a = line.action;
      if (a.type === 'tap' && a.id === 'town:7') {
        await settle(page);
        await page.waitForSelector('.town-map-scene canvas');
        await expect.poll(async () => (await canvasStats(page, '.town-map-scene canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(16);
        const s = await page.evaluate(() => {
          const stage = document.querySelector('.town-map-scene .ds-scene-stage')!.getBoundingClientRect();
          return {
            stages: document.querySelectorAll('.ds-scene-stage').length,
            stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
            towns: [...document.querySelectorAll<HTMLElement>('.town-map-town')].map((e) => e.dataset.tap),
            text: document.querySelector('.town-map-prompt')?.textContent ?? '',
            view: { w: innerWidth, h: innerHeight },
            dpr: devicePixelRatio,
          };
        });
        expect(s.stages).toBe(1);
        const k = s.stage.w / 256;
        expect(Math.abs(k * s.dpr - Math.round(k * s.dpr))).toBeLessThan(0.01);
        expect(s.stage.h).toBeCloseTo(192 * k, 1);
        expect(s.stage.x + s.stage.w).toBeLessThanOrEqual(s.view.w + 0.5);
        if (project === 'phone') expect(s.stage.w / s.view.w).toBeGreaterThan(0.85);
        // Twinleaf, Sandgem, Jubilife and Oreburgh were visited.
        expect(s.towns.sort()).toEqual(['town:0', 'town:1', 'town:7', 'town:9']);
        expect(s.text.length).toBeGreaterThan(0);
        await page.screenshot({ path: `${SHOTS}/${project}-town-map.png` });
        // The tap is a real click (a touch on the phone) on Jubilife's block.
        if (project === 'phone') await page.locator('[data-tap="town:7"]').tap();
        else await page.locator('[data-tap="town:7"]').click();
        beats.push('town-map');
        return false;
      }
      if (a.type === 'until' && a.until.kind === 'idle' && beats.length === 1) {
        // The cut-in: ROM pattern in the band (rows 56–136) over the field, then the bird and the player.
        await page.evaluate(() => window.openSinnohGame!.advance(30));
        await waitForScene(page);
        // The band covers its rows; the pattern's art loads once per page.
        await expect.poll(async () => (await overlayRows(page, 60, 130)).opaque, { timeout: 10_000 }).toBeGreaterThan(0.9);
        await expect.poll(async () => (await overlayRows(page, 60, 130)).colours, { timeout: 10_000 }).toBeGreaterThan(4);
        await page.screenshot({ path: `${SHOTS}/${project}-cut-in.png` });
        await page.evaluate(() => window.openSinnohGame!.advance(40));
        await settle(page);
        expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.zone)).toBe('platinum:MAP_HEADER_OREBURGH_CITY');
        const fly = await page.evaluate(() => window.openSinnohApp!.game.world.flyScene());
        expect(fly).toMatchObject({ bird: expect.any(Object), player: expect.any(Object) });
        await page.screenshot({ path: `${SHOTS}/${project}-pick-up.png` });
        // The landing in Jubilife: the bird drops the player off.
        await page.evaluate(() => window.openSinnohGame!.advance(50));
        await waitForScene(page);
        expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.player.zone)).toBe('platinum:MAP_HEADER_JUBILIFE_CITY');
        await page.screenshot({ path: `${SHOTS}/${project}-landing.png` });
        beats.push('flight');
      }
      return true;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(beats).toEqual(['town-map', 'flight']);
  expect(errors).toEqual([]);
});
