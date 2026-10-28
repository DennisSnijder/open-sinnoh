/**
 * The frontier scenes' effects in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop, phone and landscape): Palmer's
 * Frontier Brain cut-in (sys-tower-palmer: the banner in its band, the lit mugshot and the room dimmed around them),
 * the Castle's and the Hall's particles (drawn where the view puts them), the Hall room's light frames and the Factory
 * room's door light, each sampled from its sys replay as the overlay draws it. Screenshots go to
 * test-artifacts/frontier-effects (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newGameRecord, type FrontierView, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { frame } from './frontier-scene.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/frontier-effects';

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

/**
 * The overlay's pixels in a DS rect of the frontier frame (screen px): opaque colours and the mean luma (0–255).
 */
function region(x0: number, y0: number, x1: number, y1: number) {
  return page.evaluate(
    ([a, b, c, d]) => {
      const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
      const f = window.openSinnohApp!.overlayFrame();
      const px = canvas.getContext('2d')!.getImageData(f.x + a * f.scale, f.y + b * f.scale, (c - a) * f.scale, (d - b) * f.scale).data;
      const colours = new Set<number>();
      let luma = 0;
      for (let i = 0; i < px.length; i += 4) {
        colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        luma += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      }
      return { colours: colours.size, luma: luma / (px.length / 4) };
    },
    [x0, y0, x1, y1] as const,
  );
}

const view = () => page.evaluate(() => window.openSinnohApp!.game.scripts.view().frontier ?? null) as Promise<FrontierView | null>;

test("Palmer's cut-in: the banner in its band, the lit mugshot, the room dimmed", async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  let advanceTexts = 0;
  let checked = false;
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-palmer`), readReplay('sys-tower-palmer.replay'), {
    registries,
    seed: 1,
    name: 'sys-tower-palmer.replay',
    resolve: resolveReplay,
    repeat: false,
    async beforeLine(line) {
      // The second `advance text` (an `advance message` is one with `close`).
      if (line.action.type !== 'advance-text' || line.action.close || ++advanceTexts !== 2) return true;
      // Palmer's intro, pressed through, up to the cut-in's lit hold (the name shown, the flash faded).
      const ticks = await page.evaluate(() => {
        const g = window.openSinnohApp!.game;
        for (let i = 0; i < 4000; i++) {
          const v = g.scripts.view();
          if (v.frontier?.brainCutIn?.name && !v.frontier.fade) return i;
          if (v.message?.waitingForInput) {
            g.press('a');
            g.advance(1);
            g.release('a');
          }
          g.advance(1);
        }
        return -1;
      });
      expect(ticks).toBeGreaterThan(0);
      await frame(page);
      const cut = (await view())!.brainCutIn!;
      expect(cut).toMatchObject({ facility: 'tower', band: { y1: 46, y2: 114 }, mugshot: { x: 208, dark: false }, roomDark: true });
      // The art loads on first use: the banner fills its band, the mugshot stands out, the room around is dark.
      await expect.poll(async () => (await region(0, 50, 256, 110)).colours, { timeout: 20_000 }).toBeGreaterThan(4);
      const above = await region(0, 0, 256, 40);
      const band = await region(0, 50, 256, 110);
      expect(band.luma).toBeGreaterThan(above.luma + 20);
      expect(above.luma).toBeLessThan(40);
      // The mugshot (96 × 64 about x 208, y 80) over the banner's colours.
      await expect.poll(async () => (await region(168, 52, 248, 108)).colours, { timeout: 20_000 }).toBeGreaterThan((await region(8, 52, 88, 108)).colours + 4);
      await page.screenshot({ path: `${SHOTS}/${project}-palmer-cut-in.png` });
      checked = true;
      return true;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checked).toBe(true);
  expect(errors).toEqual([]);
});

/** Runs a facility's replay in 30-tick steps, `check` on each frontier frame drawn after a step or a line. */
async function sample(file: string, check: (v: FrontierView) => Promise<void>): Promise<void> {
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-${file}`);
  const driver = {
    ...base,
    async advance(n: number) {
      for (let left = n; left > 0; left -= 30) {
        await base.advance(Math.min(30, left));
        const v = await view();
        if (!v) continue;
        await frame(page);
        await check((await view())!);
      }
    },
  };
  const result = await runReplay(driver, readReplay(`${file}.replay`), {
    registries,
    seed: 1,
    name: `${file}.replay`,
    resolve: resolveReplay,
    repeat: false,
    // And between lines (the `until` and `advance text` lines run in the page).
    async beforeLine() {
      if (!(await view())) return true;
      await frame(page);
      await check((await view())!);
      return true;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
}

/** The particles' centres on the overlay (DS px from the quad's affine map) and how many are drawn bright. */
function particleCentres(v: FrontierView) {
  const centres = (v.particles ?? []).map((p) => [p.m[0] / 2 + p.m[2] / 2 + p.m[4], p.m[1] / 2 + p.m[3] / 2 + p.m[5]] as const).filter(([x, y]) => x >= 0 && x < 256 && y >= 0 && y < 192);
  return page.evaluate((list) => {
    const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
    const f = window.openSinnohApp!.overlayFrame();
    const g = canvas.getContext('2d')!;
    return list.filter(([x, y]) => {
      const px = g.getImageData(Math.floor(f.x + x * f.scale), Math.floor(f.y + y * f.scale), 1, 1).data;
      return 0.299 * px[0]! + 0.587 * px[1]! + 0.114 * px[2]! > 150;
    }).length / Math.max(1, list.length);
  }, centres);
}

test('the Castle battle room twinkles: its particles drawn bright', async () => {
  test.setTimeout(900_000);
  const bright: number[] = [];
  await sample('sys-castle-single', async (v) => {
    if (v.scene !== 12 || !v.particles?.length || v.fade) return;
    if (!bright.length) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-castle-twinkle.png` });
    bright.push(await particleCentres(v));
  });
  expect(bright.length).toBeGreaterThan(3);
  expect(Math.max(...bright)).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test('the Hall battle room: its light frames swap and its lights are drawn bright', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const frames = new Set<string>();
  let bright = -1;
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-sys-hall-single`), readReplay('sys-hall-single.replay'), {
    registries,
    seed: 1,
    name: 'sys-hall-single.replay',
    resolve: resolveReplay,
    repeat: false,
    async beforeLine() {
      if (bright >= 0 || (await view())?.scene !== 9) return true;
      // From the corridor into the battle room, a tick at a time (messages pressed through): its frames and its lights.
      const sheets = await page.evaluate(() => {
        const g = window.openSinnohApp!.game;
        const seen: string[] = [];
        for (let i = 0; i < 3000; i++) {
          const v = g.scripts.view();
          const fr = v.frontier;
          if (fr?.scene === 10 && !fr.fade) {
            if (!seen.includes(fr.bg!.sheet)) seen.push(fr.bg!.sheet);
            if (fr.particles?.length && seen.length === 2) return seen;
          }
          if (v.message?.waitingForInput) {
            g.press('a');
            g.advance(1);
            g.release('a');
          }
          g.advance(1);
        }
        return seen;
      });
      for (const sheet of sheets) frames.add(sheet);
      await frame(page);
      await page.screenshot({ path: `${SHOTS}/${project}-hall-lights.png` });
      bright = await particleCentres((await view())!);
      return true;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  const effects = newGameRecord(registries).frontier!.effects!;
  expect(frames).toContain(effects.hallLights);
  expect(frames.size).toBe(2);
  expect(bright).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test("the Factory battle room's door light is drawn", async () => {
  test.setTimeout(900_000);
  const lights = newGameRecord(registries).frontier!.effects!.factoryDoorLights;
  let drawn = 0;
  await sample('sys-factory-single', async (v) => {
    if (v.scene !== 4 || !v.bgPatch || v.fade) return;
    expect(lights).toContain(v.bgPatch.sheet);
    // The patch covers BG3's tiles 3, 10, 26 × 11 at the camera.
    const x = v.bgPatch.x - v.camera.x;
    const y = v.bgPatch.y - v.camera.y;
    const r = await region(Math.max(0, x), Math.max(0, y), Math.min(256, x + 208), Math.min(192, y + 88));
    expect(r.colours).toBeGreaterThan(4);
    drawn++;
  });
  expect(drawn).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
