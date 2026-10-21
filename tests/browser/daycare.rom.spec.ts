/**
 * Daycare in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone: an egg with no
 * cycles left hatches on a step in Solaceon Town, and the hatching scene is drawn from the ROM's art (the
 * egg_data background and egg cells, then the Pokémon's front picture) in one capped DS frame with the DS
 * message box and YES/NO. Screenshots go to test-artifacts/daycare-rom (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Id } from '@opensinnoh/core';
import { setupPokemon, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/daycare-rom';

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

/** Distinct colours of the hatch canvas; the egg's pale green spots in its 32×32 cell, and yellow (Pichu) in the centre 80×80. */
function scene() {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.hatch-canvas')!;
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 4) colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    const count = (x: number, y: number, w: number, h: number, hit: (r: number, g: number, b: number) => boolean) => {
      const d = c.getContext('2d')!.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (hit(d[i]!, d[i + 1]!, d[i + 2]!)) n++;
      return n;
    };
    const spots = count(112, 104, 32, 32, (r, g, b) => g > 150 && g - r > 30 && g - b > 30 && r > 100);
    const yellow = count(88, 56, 80, 80, (r, g, b) => r > 200 && g > 170 && b < 110);
    return { width: c.width, height: c.height, colours: colours.size, spots, yellow, shown: c.getBoundingClientRect().width };
  });
}

/**
 * The scene's geometry in CSS px: the canvas, the scene root, the message box and YES/NO, the Pokémon's 80×80
 * (centred on the DS screen) mapped to the page, the device px per DS px and the root's background.
 */
function geometry() {
  return page.evaluate(() => {
    const box = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const c = document.querySelector('.hatch-canvas')!;
    const canvas = box(c)!;
    const k = canvas.width / 256;
    return {
      canvas,
      root: box(document.querySelector('[data-screen="hatch"]')),
      message: box(document.querySelector('[data-screen="hatch"] .msg-box')),
      yesNo: box(document.querySelector('[data-screen="hatch"] .yes-no')),
      choices: [...document.querySelectorAll('[data-screen="hatch"] .yes-no .choice')].map((e) => box(e)!),
      mon: { x: canvas.x + 88 * k, y: canvas.y + 56 * k, width: 80 * k, height: 80 * k },
      devicePerDs: k * devicePixelRatio,
      background: getComputedStyle(document.querySelector('[data-screen="hatch"]')!).backgroundColor,
      view: { width: innerWidth, height: innerHeight },
      layer: box(document.querySelector('.ui-layer')),
    };
  });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x + 0.5 < b.x + b.width && b.x + 0.5 < a.x + a.width && a.y + 0.5 < b.y + b.height && b.y + 0.5 < a.y + a.height;
const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

/** One DS screen at whole device pixels, its boxes inside it and clear of the Pokémon; on phones over black, full screen. */
async function checkGeometry(label: string, phone: boolean): Promise<void> {
  const g = await geometry();
  expect.soft(Math.abs(g.devicePerDs - Math.round(g.devicePerDs)), `${label}: whole device px per DS px (${g.devicePerDs})`).toBeLessThan(1e-3);
  expect.soft(inside(g.canvas, { x: 0, y: 0, ...g.view }), `${label}: the screen in the view`).toBe(true);
  for (const [name, b] of [['message', g.message], ['YES/NO', g.yesNo]] as const) {
    expect.soft(b, `${label}: ${name} shown`).not.toBeNull();
    if (!b) continue;
    expect.soft(inside(b, g.canvas), `${label}: ${name} ${JSON.stringify(b)} on the screen ${JSON.stringify(g.canvas)}`).toBe(true);
    expect.soft(overlaps(b, g.mon), `${label}: ${name} ${JSON.stringify(b)} covers the Pokémon ${JSON.stringify(g.mon)}`).toBe(false);
  }
  // YES and NO inside their window, DS-size rows (16 DS px).
  for (const c of g.choices) {
    expect.soft(inside(c, g.yesNo!), `${label}: choice ${JSON.stringify(c)} in YES/NO ${JSON.stringify(g.yesNo)}`).toBe(true);
    expect.soft(Math.abs(c.height - (16 * g.canvas.width) / 256), `${label}: a 16-px DS row`).toBeLessThan(0.5);
  }
  if (phone) {
    // Full screen: the whole UI layer (the controls strip stays usable below it in portrait).
    expect.soft(g.root, `${label}: full screen`).toEqual(g.layer);
    expect.soft(g.background, `${label}: no field around the screen`).toBe('rgb(0, 0, 0)');
  }
}

test('an egg hatches on a step: the ROM scene, the Pokémon, the nickname question', async () => {
  const project = test.info().project.name;
  test.setTimeout(180_000);
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  const state = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  const egg = setupPokemon(state, registries, 1, 'platinum:SPECIES_PICHU' as Id, 1);
  Object.assign(egg, { isEgg: true, friendship: 0 });
  state.party = [setupPokemon(state, registries, 0, 'platinum:SPECIES_TURTWIG' as Id, 12), egg];
  state.daycare.stepCounter = 254;
  state.player = { ...state.player, zone: 'platinum:MAP_HEADER_SOLACEON_TOWN' as Id, x: 556, z: 650, y: 32, facing: 'right' };
  state.objects = [];
  await page.evaluate((s) => window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state: s }), 'arrival'), state);
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 600))).not.toBeNull();
  // One step east ends the egg cycle: "Oh?", A, the scene.
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('right');
    g.advance(2);
    g.release('right');
    g.advance(40);
    g.press('a');
    g.advance(1);
    g.release('a');
  });
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'app', app: 'hatch' }, 300))).not.toBeNull();
  const hatch = page.locator('[data-screen="hatch"]');
  await expect(hatch).toBeVisible();
  // The egg before it bursts: the ROM background's gradient and the cream egg in the centre.
  await page.evaluate(() => window.openSinnohGame!.advance(40));
  await expect.poll(async () => (await scene()).spots, { timeout: 10_000 }).toBeGreaterThan(20);
  const before = await scene();
  expect(before).toMatchObject({ width: 256, height: 192 });
  expect(before.colours).toBeGreaterThan(20);
  expect(before.spots).toBeGreaterThan(20);
  expect(before.yellow).toBe(0);
  // Capped: never wider than the view.
  expect(before.shown).toBeLessThanOrEqual(project === 'phone' ? 390 : 3 * 256 + 1);
  await page.screenshot({ path: `${SHOTS}/${project}-hatch-egg.png` });
  // The Pokémon, its message, then the question with YES/NO.
  await page.evaluate(() => window.openSinnohGame!.advance(520));
  // The scene redraws per frame: wait for the Pokémon's picture to be painted.
  await expect.poll(async () => (await scene()).yellow, { timeout: 10_000 }).toBeGreaterThan(100);
  const after = await scene();
  expect(after.spots).toBe(0);
  expect(after.yellow).toBeGreaterThan(100);
  await expect(hatch.locator('.msg-box')).toBeVisible();
  await expect(hatch.locator('[data-tap="yes"]')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${project}-hatch-question.png` });
  await checkGeometry(project, project === 'phone');
  if (project === 'phone') {
    // Phone landscape too, then back.
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await checkGeometry(`${project} landscape`, true);
    await page.screenshot({ path: `${SHOTS}/${project}-hatch-question-landscape.png` });
    await page.setViewportSize(size);
  }
  await page.evaluate(() => {
    window.openSinnohGame!.tap('no');
    window.openSinnohGame!.advance(1);
  });
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 600))).not.toBeNull();
  const party = await page.evaluate(() => window.openSinnohGame!.snapshot().state.party);
  expect(party[1]).toMatchObject({ isEgg: false, species: 'platinum:SPECIES_PICHU', nickname: null, friendship: 120 });
  expect(errors).toEqual([]);
});
