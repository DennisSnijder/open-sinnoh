/** The remaining scenes with a portrait/landscape notch. ROM art stays in gitignored test-artifacts. */
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { setupPokemon, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import type { Id } from '@opensinnoh/core';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { TitleScreens } from './intro.ts';
import { expectNamingGrid } from './naming-grid.ts';
import { settle } from './settle.ts';
import { selectBall, starterReady } from './starter.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';
import { appStrings, fixedPart } from './words.ts';

const SHOTS = 'test-artifacts/safe-area-scenes';
const PORTRAIT = { top: 47, right: 0, bottom: 34, left: 0 };
const LANDSCAPE = { top: 0, right: 47, bottom: 21, left: 47 };
const read = (file: string) => readFileSync(new URL(`../rom-replays/${file}.replay`, import.meta.url), 'utf8');
test.describe.configure({ mode: 'serial' });
test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => !isMobile, 'notched phone projects');

let page: Page;
let context: BrowserContext;
let registries: Registries;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
});
test.afterAll(async () => { await context?.close(); });
test.afterEach(() => { expect(errors).toEqual([]); });

async function notch() {
  const insets = page.viewportSize()!.height > page.viewportSize()!.width ? PORTRAIT : LANDSCAPE;
  await page.evaluate((i) => window.openSinnohSafeArea!(i), insets);
  await settle(page);
  return insets;
}

/** Measure actual content, including canvas stages; full-bleed backdrops may reach the edges. */
async function safe(selector: string) {
  const insets = await notch();
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 30_000 });
  const boxes = await page.locator(selector).evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { name: e.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }));
  expect(boxes.length, selector).toBeGreaterThan(0);
  const view = page.viewportSize()!;
  for (const b of boxes) {
    expect.soft(b.width, `${selector}: visible width`).toBeGreaterThan(0);
    expect.soft(b.height, `${selector}: visible height`).toBeGreaterThan(0);
    expect.soft(b.left, `${selector}: left`).toBeGreaterThanOrEqual(insets.left - 0.5);
    expect.soft(b.top, `${selector}: top`).toBeGreaterThanOrEqual(insets.top - 0.5);
    expect.soft(b.right, `${selector}: right`).toBeLessThanOrEqual(view.width - insets.right + 0.5);
    expect.soft(b.bottom, `${selector}: bottom`).toBeLessThanOrEqual(view.height - insets.bottom + 0.5);
  }
}

async function dsStage(selector: string) {
  await safe(selector);
  const r = (await page.locator(selector).boundingBox())!;
  const dpr = await page.evaluate(() => devicePixelRatio);
  expect(r.width / 256).toBeCloseTo(r.height / 192, 3);
  const k = r.width / 256 * dpr;
  expect(Math.abs(k - Math.round(k)), 'whole device pixels per DS pixel').toBeLessThan(0.001);
}

async function shot(name: string) { await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` }); }

test('title, all setup questions, Rowan and both naming keyboards clear the notch', async () => {
  test.setTimeout(300_000);
  await page.evaluate(() => {
    localStorage.removeItem('lantern-nds:setup');
    localStorage.removeItem('lantern-nds:error-reports');
  });
  await page.goto('/');
  await expect(page.locator('#title')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked);
  await safe('.title-brand, .title-legal');
  await shot('title');
  await page.locator('#title').tap();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'setup', undefined, { timeout: 30_000 });
  const screens = new TitleScreens(page, true, appStrings());
  const setup = screens.flow('Setup');
  for (const [question, answer] of [['reports', 1], ['addon', 1], ['textSpeed', 2], ['visualStyle', 0]] as const) {
    await expect(setup.locator('.setup-panel')).toHaveAttribute('data-question', question);
    await safe('.setup-lead, .setup-ask');
    // Landscape may scroll: each answer must be reachable above the home indicator, including the last.
    const choices = setup.locator('.setup-choices button');
    await expect(choices).toHaveCount(question === 'textSpeed' || question === 'visualStyle' ? 3 : 2);
    for (let i = 0; i < await choices.count(); i++) {
      await choices.nth(i).scrollIntoViewIfNeeded();
      await safe(`.setup-choices button:nth-child(${i + 1})`);
    }
    await shot(`setup-${question}`);
    await setup.locator(`[data-tap="menu:${answer}"]`).tap();
  }
  await expect(page.locator('.tm-new-game')).toBeVisible();
  await safe('.tm-list');
  await page.locator('.tm-new-game').tap();
  const intro = screens.flow('New game');
  await screens.menu(intro);
  await dsStage('.intro-scene .ds-scene-stage');
  await safe('.intro-menu, .intro-scene .msg-box');
  await shot('rowan');
  // ADVENTURE INFO: its backdrop has a box in the middle, so the bands run on from the rows' edges.
  await screens.choose(intro, 0);
  await screens.advance(intro, () => intro.locator('.intro-block').isVisible());
  await safe('.intro-block');
  await shot('adventure-info');
  await screens.menu(intro);
  await screens.choose(intro, 1); // NO INFO NEEDED
  await screens.advance(intro, () => intro.locator('.intro-ball').isVisible());
  await dsStage('.intro-scene .ds-scene-stage');
  await safe('.intro-ball');
  await screens.openBall(intro);
  await screens.gender(intro, 'girl');
  await screens.menu(intro);
  await screens.choose(intro, 0);
  const naming = intro.locator('[data-screen="naming"]');
  await screens.advance(intro, () => naming.isVisible());
  await dsStage('[data-screen="naming"]');
  await safe('.naming-keys, .naming-ok, .naming-prompt');
  await expectNamingGrid(page);
  await shot('player-naming');
  await screens.name(intro, '', []);
  await screens.menu(intro);
  await screens.choose(intro, 0);
  await screens.menu(intro);
  await screens.choose(intro, 0); // Your own rival name.
  await screens.advance(intro, () => naming.isVisible());
  await dsStage('[data-screen="naming"]');
  await shot('rival-naming');
});

async function replayPage() {
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await notch();
}

test('evolution and its message stay inside the safe room', async () => {
  test.setTimeout(180_000);
  await replayPage();
  const prefix = read('svc-rare-candy').split('until app bag 3000')[0]!;
  const result = await runReplay(pageDriver(page, SHOTS, `${test.info().project.name}-candy`), prefix, { registries, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  await dsStage('[data-screen="evolution"] .ds-scene-stage');
  const congratulations = fixedPart((...slots) => plainText(registries.texts.get('platinum:BattleStrings_Text_CongratulationsYourPokemonEvolvedIntoPokemon' as Id)!.text, slots));
  await page.evaluate((done) => {
    const g = window.openSinnohGame!;
    for (let n = 0; n < 1200; n++) {
      const v = g.snapshot().app;
      if (v?.app === 'evolution' && v.message?.waiting && v.message.text.includes(done)) return;
      g.advance(1);
    }
    throw new Error('evolution did not reach Congratulations');
  }, congratulations);
  await safe('[data-screen="evolution"] .msg-box');
  await shot('evolution');
});

test('hatching and the nickname question stay inside the safe room', async () => {
  test.setTimeout(180_000);
  await replayPage();
  const state = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  const egg = setupPokemon(state, registries, 1, 'platinum:SPECIES_PICHU' as Id, 1);
  Object.assign(egg, { isEgg: true, friendship: 0 });
  state.party = [setupPokemon(state, registries, 0, 'platinum:SPECIES_TURTWIG' as Id, 12), egg];
  state.daycare.stepCounter = 254;
  state.player = { ...state.player, zone: 'platinum:MAP_HEADER_SOLACEON_TOWN' as Id, x: 556, z: 650, y: 32, facing: 'right' };
  state.objects = [];
  await page.evaluate((s) => window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state: s }), 'arrival'), state);
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 600))).not.toBeNull();
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('right'); g.advance(2); g.release('right'); g.advance(40);
    g.press('a'); g.advance(1); g.release('a');
  });
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'app', app: 'hatch' }, 300))).not.toBeNull();
  await dsStage('[data-screen="hatch"] .ds-scene-stage');
  await page.evaluate(() => window.openSinnohGame!.advance(560));
  await safe('[data-screen="hatch"] .msg-box, [data-screen="hatch"] .yes-no');
  await shot('hatch');
  await page.locator('[data-screen="hatch"] [data-tap="no"]').tap();
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 600))).not.toBeNull();
});

test('starter scene and all three ball touch targets clear the notch', async () => {
  test.setTimeout(300_000);
  await replayPage();
  const prefix = read('opening-rival').split('+0 screenshot starter-panel')[0]!;
  const result = await runReplay(pageDriver(page, SHOTS, `${test.info().project.name}-opening`), prefix, { registries, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  await expect(page.locator('.starter')).toBeVisible({ timeout: 30_000 });
  await starterReady(page);
  await safe('.starter');
  for (let i = 0; i < 3; i++) {
    await selectBall(page, i, true);
    expect(await page.evaluate(() => window.openSinnohStarter!.cursor)).toBe(i);
  }
  await shot('starter');
});
