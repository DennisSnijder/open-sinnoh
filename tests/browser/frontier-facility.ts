/**
 * A Battle Frontier facility's challenge in the app on the real ROM (frontier-factory.rom.spec.ts,
 * frontier-hall.rom.spec.ts): its sys replay through `window.openSinnohGame`, the facility's own checks at each
 * screenshot line, and every frontier scene sampled as it is drawn (frontier-scene.ts). Screenshots go to
 * test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { frame, sceneProblems } from './frontier-scene.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

export type FacilityCheck = (page: Page, name: string) => Promise<void>;

/** The open app's view. */
export const appView = async (page: Page) => (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView | null;

/**
 * A DS scene's fit problems (the frontier apps are scenes, evolution.ts `layoutScene`): the stage (the 256×192 DS
 * screen) inside the viewport at whole device pixels per DS pixel, clear of the on-screen controls and HUD buttons,
 * and every box drawn on it inside it.
 */
function stageProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const stage = document.querySelector<HTMLElement>('.frontier-app .ds-scene-stage')!;
    const st = stage.getBoundingClientRect();
    const k = st.width / 256;
    // Whole device pixels per DS pixel (CSS layout rounds to 1/64 px).
    const kd = Math.round(k * devicePixelRatio);
    if (kd < 1 || Math.abs(st.width * devicePixelRatio - 256 * kd) > 1 || Math.abs(st.height * devicePixelRatio - 192 * kd) > 1) out.push(`stage ${st.width}×${st.height} is not 256×192 at whole device pixels`);
    if (st.left < -0.5 || st.top < -0.5 || st.right > innerWidth + 0.5 || st.bottom > innerHeight + 0.5) out.push(`stage ${st.left},${st.top}–${st.right},${st.bottom} leaves the ${innerWidth}×${innerHeight} viewport`);
    for (const b of document.querySelectorAll<HTMLElement>('.controls button, .hud-button')) {
      const r = b.getBoundingClientRect();
      if (!r.width || getComputedStyle(b).visibility === 'hidden' || b.closest('[hidden]')) continue;
      if (r.left < st.right && st.left < r.right && r.top < st.bottom && st.top < r.bottom) out.push(`stage under the ${b.dataset.button ?? b.getAttribute('aria-label')} button`);
    }
    for (const e of stage.querySelectorAll<HTMLElement>('.ds-scene-boxes *')) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < st.left - 1 || r.top < st.top - 1 || r.right > st.right + 1 || r.bottom > st.bottom + 1) out.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} at ${Math.round((r.left - st.left) / k)},${Math.round((r.top - st.top) / k)} leaves the stage`);
    }
    return out;
  });
}

/** A DS scene app (the rental app, the type board): drawn from the ROM's art, inside the screen, its buttons there. */
export async function dsAppDrawn(page: Page, name: string, app: string, buttons: string, count: number): Promise<void> {
  expect((await appView(page))?.app, name).toBe(app);
  await page.waitForSelector(buttons, { timeout: 20_000 });
  expect(await page.locator(buttons).count(), name).toBe(count);
  await expect.poll(async () => (await canvasStats(page, '.frontier-app .ds-scene-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(16);
  await settle(page);
  expect(await stageProblems(page), name).toEqual([]);
}

/** A frontier battle on the facility's backdrop (the world's BACKGROUND_BATTLE_*). */
export async function facilityBattle(page: Page, name: string, facility: 'FACTORY' | 'HALL'): Promise<void> {
  const view = await page.evaluate(() => window.openSinnohGame!.battleView());
  expect(view?.background, name).toBe(`platinum:BACKGROUND_BATTLE_${facility}`);
  expect(view?.terrain, name).toBe(`platinum:TERRAIN_BATTLE_${facility}`);
}

/** The battle room after the battle: the scene, its characters, the overlay lit. */
export async function facilityRoom(page: Page, name: string, scene: number): Promise<void> {
  // The view returns from a full-screen battle through 8 ticks of black (battle/index.ts RETURN_TICKS).
  await page.evaluate(() => window.openSinnohGame!.advance(10));
  await frame(page);
  const fr = await page.evaluate(() => window.openSinnohGame!.snapshot().view.frontier);
  expect(fr?.scene, name).toBe(scene);
  await expect.poll(async () => (await canvasStats(page, '#overlay-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(16);
}

/** The facility's spec: the ROM import, then the replay with `checks` at its screenshot lines and `scenes` drawn. */
export function facilitySpec(file: string, shots: string, checks: Record<string, FacilityCheck>, scenes: number[]): void {
  const ROM = process.env.OPENSINNOH_NDS_ROM;
  test.describe.configure({ mode: 'serial' });
  test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

  let registries: Registries;
  let context: BrowserContext;
  let page: Page;
  const errors: string[] = [];

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(120_000);
    registries = loadGamePacks([romSlice().pack]).registries;
    const use = info.project.use;
    context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, ...(use.isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: use.deviceScaleFactor } : {}) });
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('import the ROM', async () => {
    test.setTimeout(420_000);
    await seedRomImport(page);
    await page.goto('/?replay');
    await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  });

  test(`${file} in the app, with its screens at each screenshot line`, async () => {
    test.setTimeout(900_000);
    const project = test.info().project.name;
    const base = pageDriver(page, shots, `${project}-${file}`);
    const seen: string[] = [];
    const drawn = new Set<number>();
    const found: string[] = [];
    const sample = async () => {
      const r = await sceneProblems(page);
      if (!r) return;
      drawn.add(r.scene);
      found.push(...r.problems.map((p) => `scene ${r.scene}: ${p}`));
    };
    const driver = {
      ...base,
      async advance(n: number) {
        for (let left = n; left > 0; left -= 30) {
          await base.advance(Math.min(30, left));
          await sample();
        }
      },
      async screenshot(name: string) {
        await frame(page);
        const check = checks[name];
        if (!check) throw new Error(`${file}: no check for the screenshot line ${name}`);
        const shot = await base.screenshot!(name);
        await check(page, name);
        seen.push(name);
        return shot;
      },
    };
    const result = await runReplay(driver, readReplay(`${file}.replay`), { registries, seed: 1, name: `${file}.replay`, resolve: resolveReplay, repeat: false });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(seen.sort()).toEqual(Object.keys(checks).sort());
    expect([...drawn].sort((a, b) => a - b), 'frontier scenes drawn').toEqual(scenes);
    expect([...new Set(found)]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
