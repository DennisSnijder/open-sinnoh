/**
 * Evolution in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone: the
 * svc-rare-candy replay through the bridge, with a pixel check of the scene mid-swap (the white silhouettes
 * over the ROM background inside the clamped window, black outside it) and when the new Pokémon stands in
 * colour, and m2-evolve (the scene after a battle). Screenshots go to test-artifacts/evolve-rom (gitignored:
 * ROM content, never commit).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { EvolutionView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';
import { fixedPart } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/evolve-rom';
const REPLAYS = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(REPLAYS, file), 'utf8');

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await context?.close();
});

/** Steps the game until the evolution scene swaps (B could stop it) or "Congratulations!" waits, then `extra` ticks more. */
async function stepUntil(phase: 'swap' | 'congratulations', extra: number): Promise<EvolutionView> {
  const congratulations = fixedPart((...slots) => plainText(registries.texts.get('platinum:BattleStrings_Text_CongratulationsYourPokemonEvolvedIntoPokemon' as never)!.text, slots));
  const view = await page.evaluate(
    ([p, n, done]) => {
      const g = window.openSinnohGame!;
      for (let i = 0; i < 1200; i++) {
        const v = g.snapshot().app;
        if (v?.app === 'evolution' && (p === 'swap' ? v.cancellable : v.message?.waiting && v.message.text.includes(done))) break;
        g.advance(1);
      }
      g.advance(n);
      return JSON.stringify(g.snapshot().app);
    },
    [phase, extra, congratulations] as const,
  );
  return JSON.parse(view) as EvolutionView;
}

/** Counts on the scene canvas (DS px): white silhouette pixels in the Pokémon's box, coloured background rows inside the window, black rows above it. */
async function scenePixels(): Promise<{ white: number; band: number; topBlack: number; colour: number; whites: [number, number][] }> {
  await settle(page);
  return page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const c = document.querySelector<HTMLCanvasElement>('.ds-scene-canvas')!;
          const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          const at = (x: number, y: number) => [px[(y * c.width + x) * 4]!, px[(y * c.width + x) * 4 + 1]!, px[(y * c.width + x) * 4 + 2]!] as const;
          let white = 0;
          let colour = 0;
          for (let y = 40; y < 120; y++)
            for (let x = 88; x < 168; x++) {
              const [r, g, b] = at(x, y);
              if (r > 245 && g > 245 && b > 245) white++;
              if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colour++;
            }
          let band = 0;
          for (let x = 0; x < 256; x += 4) {
            const [r, g, b] = at(x, 60);
            if (g > r + 20 || b > r + 20 || r + g + b > 600) band++;
          }
          let topBlack = 0;
          for (let x = 0; x < 256; x += 4) if (at(x, 10).every((v) => v < 16)) topBlack++;
          // Near-white pixels (every channel ≥ 235: the silhouettes, the white sparkles) by place, for the box check.
          const whites: [number, number][] = [];
          for (let y = 0; y < 144; y++) for (let x = 0; x < 256; x++) if (at(x, y).every((v) => v >= 235)) whites.push([x, y]);
          resolve({ white, band, topBlack, colour, whites });
        }),
      ),
  );
}

test('svc-rare-candy: the evolution scene mid-swap and after, drawn whole-pixel', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  const checks: string[] = [];
  const driver = pageDriver(page, SHOTS, `${project}-rare-candy`);
  const result = await runReplay(driver, read('svc-rare-candy.replay'), {
    registries,
    name: 'svc-rare-candy.replay',
    repeat: false,
    async beforeLine(line: ReplayLine) {
      // Before the wait that plays the scene out (`until app bag`).
      if (line.action.type !== 'until' || line.action.until.kind !== 'app' || line.action.until.app !== 'bag') return;
      // Mid-swap: the window is clamped (rows 40–120), both silhouettes are white.
      // Three swap frames: the white silhouettes (decomp: each form shrinking and growing about (128, 80))
      // stay inside the larger one's 80×80 picture at its scale, and fill a fair part of it. The swap's
      // DS frames 60, 90 and 120 (one a tick); the sprites' white fade is whole from frame 40.
      const waits = [60, 90, 120];
      for (const [i, wait] of waits.entries()) {
        const mid = await stepUntil('swap', i ? 0 : wait);
        if (i) await page.evaluate((n) => window.openSinnohGame!.advance(n), wait - waits[i - 1]!);
        const v = i ? (JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot().app))) as EvolutionView) : mid;
        expect(v.window).toEqual({ top: 40, bottom: 120 });
        expect(v.sprites.map((s) => s.fade)).toEqual([{ level: 16, color: 'white' }, { level: 16, color: 'white' }]);
        await expect(page.locator('[data-screen="evolution"] .ds-scene-canvas')).toBeVisible();
        const swap = await scenePixels();
        await page.screenshot({ path: `${SHOTS}/${project}-evolve-swap-${i}.png` });
        // Inside the larger form's 80×80 picture at its scale about (128, 80) and outside it.
        const half = (40 * Math.max(...v.sprites.map((s) => s.scale))) / 256;
        const inBox = ([x, y]: [number, number]) => Math.abs(x + 0.5 - 128) <= half + 1 && Math.abs(y + 0.5 - 80) <= half + 1;
        const inside = swap.whites.filter(inBox).length;
        const outside = swap.whites.length - inside;
        writeFileSync(`${SHOTS}/${project}-evolve-swap-${i}.json`, JSON.stringify({ scales: v.sprites.map((s) => s.scale), half, inside, outside }));
        // The silhouettes are drawn at their size: most of the white is in the box, and a fair share of it is white.
        expect(inside).toBeGreaterThan(outside * 2);
        expect(inside).toBeGreaterThan(half * half * 0.2);
        expect(swap.band).toBeGreaterThan(40);
        expect(swap.topBlack).toBeGreaterThan(60);
      }
      // The new Pokémon in colour with the window open again ("Congratulations!").
      const after = await stepUntil('congratulations', 0);
      expect(after.sprites[1]!.scale).toBe(256);
      const done = await scenePixels();
      await page.screenshot({ path: `${SHOTS}/${project}-evolve-done.png` });
      expect(done.colour).toBeGreaterThan(200);
      // The scene is a capped window on the desktop, the whole view on the phone.
      const box = await page.locator('.ds-scene-stage').boundingBox();
      const viewport = page.viewportSize()!;
      // (whole device pixels per DS pixel: 390 CSS px at ×3 → 4 device px → 341 CSS px)
      if (project === 'phone') expect(box!.width).toBeGreaterThan(viewport.width * 0.85);
      else expect(box!.width).toBeLessThan(viewport.width * 0.8);
      expect(box!.width % 256 === 0 || project === 'phone').toBe(true);
      checks.push('scene');
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checks).toEqual(['scene']);
  expect(errors).toEqual([]);
});

test('m2-evolve: after a won battle Piplup evolves into Prinplup and learns Metal Claw', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  const driver = pageDriver(page, SHOTS, `${project}-m2-evolve`);
  const result = await runReplay(driver, read('m2-evolve.replay'), { registries, name: 'm2-evolve.replay', repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(errors).toEqual([]);
});
