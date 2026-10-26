/**
 * The new-game onboarding on the fixture pack, on desktop (keys) and phone (taps):
 * the title's setup before the first main menu, for a player who did not answer on the ROM page (OpenSinnoh's own screen: error reports, text speed; the HeartGold/SoulSilver question only where an
 * add-on can be imported, so not here), stored as device options and not asked again; then NEW GAME's intro in
 * the DS order: the welcome, Rowan (the fixture's warden) and the info choice, ADVENTURE INFO's text, the Poké
 * Ball on the touch screen, the boy and the girl, the naming keyboard, the rival's name choice, the closing lines,
 * and the field with the names and gender. Structure and flow, not pixels. Screenshots go to
 * test-artifacts/onboarding.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakeImportWorker, fakeRom } from './fake-import.ts';
import { press, TitleScreens } from './intro.ts';

const SHOTS = 'test-artifacts/onboarding';

/** Opaque: a colour with alpha 1 or a gradient. */
const opaque = (style: { color: string; image: string }) => style.image !== 'none' || !/rgba\(.*, 0\)$/.test(style.color);

/** An element's box against the title's (the game area: the viewport less a portrait controls strip); its whole device pixels per DS pixel (`ds` px wide on the DS). */
async function geometry(page: Page, target: Locator, ds: number) {
  const box = (await target.boundingBox())!;
  const view = (await page.locator('#title').boundingBox())!;
  const dpr = await page.evaluate(() => devicePixelRatio);
  const k = (box.width / ds) * dpr;
  return { box, view, k, centred: Math.abs(box.x - (view.width - box.x - box.width)) < 2 && Math.abs(box.y - (view.height - box.y - box.height)) < 2 };
}

/** The setup's answers, in order. */
const setupAnswers = (setup: Locator) => setup.locator('.setup-choices [data-tap^="menu:"] .cl').allInnerTexts();

/** Picks the setup's answer `i`: down to it and A on desktop, a tap on the phone. */
async function chooseSetup(page: Page, setup: Locator, touch: boolean, i: number): Promise<void> {
  const entry = setup.locator(`[data-tap="menu:${i}"]`);
  if (touch) return entry.tap();
  const at = Number((await setup.locator('[aria-current="true"]').getAttribute('data-tap'))!.slice(5));
  for (let n = at; n < i; n++) await press(page, 'ArrowDown');
  await expect(entry).toHaveAttribute('aria-current', 'true');
  await press(page, 'KeyZ');
}

/**
 * The flow covers the game area and is opaque (nothing of the title behind it): the viewport, less the touch
 * controls' strip in portrait on phones (the field's area).
 */
async function expectFullBleed(page: Page, flow: Locator) {
  const box = (await flow.boundingBox())!;
  const view = page.viewportSize()!;
  const strip = (await page.locator('#dpad').isVisible()) && view.height > view.width;
  const height = strip ? (await page.locator('#title').boundingBox())!.height : view.height;
  if (strip) expect(height).toBeLessThan(view.height - 100);
  expect([box.x, box.y, Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, view.width, Math.round(height)]);
  expect(opaque(await flow.evaluate((e) => ({ color: getComputedStyle(e).backgroundColor, image: getComputedStyle(e).backgroundImage })))).toBe(true);
}

test('setup once per device, then the intro from NEW GAME to the field', async ({ page }, info) => {
  test.setTimeout(300_000);
  const touch = info.project.name === 'phone';
  const project = info.project.name;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const screens = new TitleScreens(page, touch);
  const start = async () => {
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked);
    await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
    if (touch) await page.locator('#title').tap();
    else await press(page, 'Enter');
  };
  await page.goto('/?packs=fixture&title');
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:error-reports'))).toBeNull();
  await start();

  // The setup: OpenSinnoh's own window (the design system), not the game's message box; no add-on question in dev packs.
  const setup = screens.flow('Setup');
  await expect(setup).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase)).toBe('setup');
  await expect(setup.locator('.os-win.setup-panel')).toBeVisible();
  await expect(setup.locator('.msg-box')).toHaveCount(0);
  expect(await setupAnswers(setup)).toEqual(['Allow', "Don't allow"]);
  await expect(setup).toContainText('Options');
  expect(await page.evaluate(() => window.openSinnohTitle!.question)).toBe('reports');
  await page.screenshot({ path: `${SHOTS}/${project}-setup.png` });
  await chooseSetup(page, setup, touch, 1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lantern-nds:error-reports'))).toBe('false');
  await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.question)).toBe('textSpeed');
  expect(await setupAnswers(setup)).toEqual(['Slow', 'Mid', 'Fast']);
  // The cursor starts on the stored speed (MID).
  await expect(setup.locator('[data-tap="menu:1"]')).toHaveAttribute('aria-current', 'true');
  await chooseSetup(page, setup, touch, 2);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('lantern-nds:options') ?? '{}') as { textSpeed?: number }).textSpeed)).toBe(2);
  // The visual style: optional, the cursor on DS; each answer says what it adds.
  await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.question)).toBe('visualStyle');
  expect(await setupAnswers(setup)).toEqual(['DS', 'Subtle', 'Cinematic']);
  await expect(setup.locator('[data-tap="menu:0"]')).toHaveAttribute('aria-current', 'true');
  await expect(setup).toContainText('Heavier on phones');
  await page.screenshot({ path: `${SHOTS}/${project}-setup-visual-style.png` });
  await chooseSetup(page, setup, touch, 0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lantern-nds:visual-style'))).toBe('ds');
  await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase)).toBe('menu');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lantern-nds:setup'))).toBe('["reports","textSpeed","visualStyle"]');
  // DS draws the DS look.
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { openSinnohRenderStats?: { enhanced: unknown } }).openSinnohRenderStats?.enhanced ?? null)).toBeNull();

  // Asked once: a new launch goes straight to the main menu.
  await page.reload();
  await start();
  await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase)).toBe('menu');
  await expect(page.getByRole('dialog', { name: 'Setup' })).toHaveCount(0);

  // NEW GAME: the intro, not skippable; the welcome on black first.
  if (touch) await page.locator('.tm-new-game').tap();
  else await press(page, 'KeyZ');
  const intro = screens.flow('New game');
  await expect(intro).toBeVisible();
  const box = intro.locator('.msg-box');
  await expect(box).toContainText('Hello, traveler!', { timeout: 20_000 });
  // The scene is one screen: integer DS pixels, inside the viewport, centred.
  const stage = (await intro.locator('.ds-scene-stage').boundingBox())!;
  const view = page.viewportSize()!;
  expect(stage.width / 256).toBeCloseTo(stage.height / 192, 3);
  expect(stage.x).toBeGreaterThanOrEqual(0);
  expect(stage.x + stage.width).toBeLessThanOrEqual(view.width + 0.5);
  expect(stage.y + stage.height).toBeLessThanOrEqual(view.height + 0.5);
  expect(Math.abs(stage.x - (view.width - stage.x - stage.width))).toBeLessThan(2);
  if (touch) expect(stage.width).toBeGreaterThan(view.width - 64);
  else expect(stage.width).toBeLessThanOrEqual(256 * 4);
  await page.screenshot({ path: `${SHOTS}/${project}-welcome.png` });

  // The info choice; THE ROAD (ADVENTURE INFO) shows its text blocks, then the choice again.
  expect(await screens.menu(intro)).toEqual(['THE ROAD', 'NO THANKS']);
  await screens.choose(intro, 0);
  const block = intro.locator('.intro-block');
  await expect(block).toContainText('The road starts at your door.', { timeout: 20_000 });
  expect(await screens.menu(intro)).toEqual(['THE ROAD', 'NO THANKS']);
  await screens.choose(intro, 1);

  // The Poké Ball on the touch screen: its button is the tap target.
  await screens.advance(intro, async () => (await intro.locator('.intro-ball').isVisible()) && ((await box.textContent()) ?? '').includes('button'));
  await page.screenshot({ path: `${SHOTS}/${project}-ball.png` });
  await screens.openBall(intro);

  // The boy and the girl, picked and confirmed.
  await screens.gender(intro, touch ? 'girl' : 'boy');
  expect(await screens.menu(intro)).toEqual(['YES', 'NO']);
  // The backdrop fills the viewport (no letterbox) while the sprites stay at a whole scale, capped on big screens.
  await expectFullBleed(page, intro.locator('.intro-scene'));
  const scene = await geometry(page, intro.locator('.ds-scene-stage'), 256);
  expect(Number.isInteger(Math.round(scene.k * 1000) / 1000)).toBe(true);
  const canvas = (await intro.locator('.ds-scene-canvas').boundingBox())!;
  expect(canvas.width).toBeCloseTo(scene.box.width, 1);
  expect(scene.centred).toBe(true);
  if (!touch) expect(scene.box.width).toBeLessThanOrEqual(256 * 4);
  await expect(box).toContainText('So this is you?');
  await screens.choose(intro, 0);
  const naming = intro.locator('[data-screen="naming"]');
  await screens.advance(intro, () => naming.isVisible());
  await expectNaming(page, intro, naming, false);
  await screens.name(intro, 'Kai', ['page:0', 'key:1:0', 'page:1', 'key:0:0', 'key:0:8']);
  await screens.menu(intro);
  await expect(box).toContainText('You are Kai?');
  await screens.choose(intro, 0);

  // The rival: the name choice, a preset name.
  expect(await screens.menu(intro)).toEqual(['Another!', 'Wren', 'Oak', 'Sol', 'Fen']);
  // Another! opens the keyboard again, with the rival's icon (not the player's); OK with nothing keeps a default.
  await screens.choose(intro, 0);
  await screens.advance(intro, () => naming.isVisible());
  await expectNaming(page, intro, naming, true);
  await screens.name(intro, '', []);
  await screens.menu(intro);
  await expect(box).toContainText(', right?');
  const rival = ((await box.textContent()) ?? '').replace(/, right\?.*$/, '').trim();
  await screens.choose(intro, 0);
  await screens.advance(intro, () => box.textContent().then((t) => (t ?? '').includes('Off you go, Kai')), 2000);
  await screens.advance(intro, async () => (await page.locator('#title').count()) === 0, 2000);

  await expect(page.locator('#game')).toBeVisible();
  expect(await page.evaluate(() => ({ names: window.openSinnohApp!.game.state.names, gender: window.openSinnohApp!.game.state.gender }))).toEqual({ names: { player: 'Kai', rival }, gender: touch ? 'female' : 'male' });
  expect(errors).toEqual([]);
});

test('answered on the ROM page while the ROM imported: the title asks nothing', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the setup is the same on both');
  await fakeImportWorker(page);
  await page.goto('/');
  await page.locator('#rom-input').setInputFiles(fakeRom());
  const wizard = page.locator('#wizard');
  await wizard.locator('.os-choice', { hasText: 'Skip' }).click();
  await wizard.locator('.os-choice', { hasText: "Don't allow" }).click();
  await wizard.locator('.os-choice', { hasText: 'Slow' }).click();
  await wizard.locator('.os-choice', { hasText: 'The original look' }).click();
  await expect(wizard).toContainText('All set');
  await page.goto('/?packs=fixture&title');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked);
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await press(page, 'Enter');
  await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.phase)).toBe('menu');
  await expect(page.getByRole('dialog', { name: 'Setup' })).toHaveCount(0);
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('lantern-nds:options')!) as { textSpeed: number }).textSpeed)).toBe(0);
});

/** The naming keyboard: one composed screen, opaque over the title, centred at a whole scale (capped on big screens). */
async function expectNaming(page: Page, flow: Locator, naming: Locator, rival: boolean) {
  await expectFullBleed(page, flow);
  const board = await geometry(page, naming, 256);
  expect(Math.abs(board.k - Math.round(board.k))).toBeLessThan(0.01);
  expect(board.centred).toBe(true);
  if (page.viewportSize()!.width >= 700) expect(board.box.width).toBeLessThanOrEqual(256 * 4);
  else expect(board.box.width).toBeGreaterThan(board.view.width - 64);
  await expect(naming.locator('.naming-icon-rival')).toHaveCount(rival ? 1 : 0);
}
