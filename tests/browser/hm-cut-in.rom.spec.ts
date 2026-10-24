/**
 * The HM cut-in in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): sys-sweet-scent-snow's Sweet Scent
 * from the party (decomp hm_cut_in.c sCutInTaskFuncs): the band of ROM pattern over the field with the Pokémon's front
 * picture crossing it, drawn on the overlay canvas, then the band closes before the message. Screenshots go to
 * test-artifacts/hm-cut-in (ROM content, never commit).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const SHOTS = 'test-artifacts/hm-cut-in';
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

test('sys-sweet-scent-snow: the HM cut-in drawn over the field', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const registries = loadGamePacks([romSlice().pack]).registries;
  const project = info.project.name;
  let checked = false;
  const result = await runReplay(pageDriver(page, SHOTS, project), read('sys-sweet-scent-snow.replay'), {
    registries,
    name: 'sys-sweet-scent-snow.replay',
    repeat: false,
    async beforeLine(line) {
      if (checked || line.action.type !== 'until' || line.action.until.kind !== 'message') return true;
      // 33 ticks in: the band is open (rows 56–136) and the Pokémon slides to the centre (hm_cut_in.c, cry on the 36th).
      await page.evaluate(() => window.openSinnohGame!.advance(33));
      await waitForScene(page);
      const scene = await page.evaluate(() => window.openSinnohApp!.game.world.flyScene());
      expect(scene).toMatchObject({ band: { y1: 56, y2: 136, pattern: true }, mon: { species: 'platinum:SPECIES_BEAUTIFLY' }, bird: null });
      expect(scene!.mon!.x).toBeLessThan(200);
      await expect.poll(async () => (await overlayRows(page, 60, 130)).opaque, { timeout: 10_000 }).toBeGreaterThan(0.9);
      await expect.poll(async () => (await overlayRows(page, 60, 130)).colours, { timeout: 10_000 }).toBeGreaterThan(8);
      // Outside the band the field shows through the overlay.
      expect((await overlayRows(page, 10, 40)).opaque).toBeLessThan(0.5);
      await page.screenshot({ path: `${SHOTS}/${project}-cut-in.png` });
      // The band closes and the cut-in is gone before the script's message.
      await page.evaluate(() => window.openSinnohGame!.advance(30));
      expect(await page.evaluate(() => window.openSinnohApp!.game.world.flyScene())).toBeNull();
      checked = true;
      return true;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checked).toBe(true);
  expect(errors).toEqual([]);
});
