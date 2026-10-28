/**
 * One BGM at a time from the title to the field, on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop:
 * the title plays SEQ_TITLE01 alone (not the field BGM the session's map load starts behind it), the main menu
 * plays nothing (main_menu.c), OPTIONS and back keep it silent, B back to the title plays SEQ_TITLE01 again,
 * NEW GAME's intro plays SEQ_OPENING alone, the field after it its zone's BGM alone; CONTINUE goes from the
 * silent menu to the zone's BGM alone. Checked in the sound system (`bgmHandles`) and in the worklet (its
 * sounding handles).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { press, TitleScreens } from './intro.ts';
import { saveSlot } from './save.ts';
import { seedRomImport } from './seed.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'audio hand-overs do not depend on the layout');
  test.setTimeout(180_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
});

test.afterAll(async () => {
  await context?.close();
});

/** The music the sound system plays, and the music handles the worklet sounds. */
const music = () =>
  page.evaluate(async () => {
    const app = window.openSinnohApp!;
    const status = await app.audio.status();
    return { system: app.game.sound.bgmHandles(), worklet: status.handles.filter((h) => h === 'bgm' || h === 'field-bgm') };
  });

async function expectMusic(handle: 'bgm' | 'field-bgm' | null, seq?: string): Promise<void> {
  const want = handle ? { system: [{ handle, seq }], worklet: [handle] } : { system: [], worklet: [] };
  await expect.poll(music, { timeout: 10_000 }).toEqual(want);
}

async function atTitle(): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
}

async function toMenu(): Promise<void> {
  await press(page, 'Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 30_000 });
}

test('title, menu, options, back to the title, the intro and the field: one BGM at each step', async () => {
  test.setTimeout(300_000);
  await page.goto('/?time=12:00');
  await atTitle();
  // A key the title ignores unlocks the AudioContext (a user gesture).
  await press(page, 'ArrowDown');
  await page.waitForFunction(() => window.openSinnohApp!.audio.context.state === 'running', undefined, { timeout: 10_000 });
  await expectMusic('bgm', 'platinum:SEQ_TITLE01');

  // A/Start: the title theme fades with Giratina's cry; the main menu is silent.
  await toMenu();
  await expectMusic(null);

  // OPTIONS and back: still silent.
  await press(page, 'ArrowDown');
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('options');
  await press(page, 'Enter');
  const options = page.getByRole('dialog', { name: appStrings().title.options });
  await expect(options).toBeVisible();
  await expectMusic(null);
  await press(page, 'KeyX');
  await expect(options).toHaveCount(0);
  await expectMusic(null);

  // B: the title again, its theme again; then the menu.
  await press(page, 'KeyX');
  await atTitle();
  await expectMusic('bgm', 'platinum:SEQ_TITLE01');
  await toMenu();
  await expectMusic(null);

  // NEW GAME: the intro's SEQ_OPENING alone once Rowan fades in.
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('new-game');
  await press(page, 'Enter');
  const screens = new TitleScreens(page, false);
  const intro = screens.flow('New game');
  await expect(intro).toBeVisible();
  await screens.menu(intro);
  await expectMusic('bgm', 'platinum:SEQ_OPENING');
  await screens.choose(intro, 1); // NO INFO NEEDED
  await screens.openBall(intro);
  await screens.gender(intro, 'boy');
  await screens.menu(intro);
  await screens.choose(intro, 0);
  await screens.name(intro, 'Kai', []);
  await screens.menu(intro);
  await screens.choose(intro, 0);
  await screens.menu(intro);
  await screens.choose(intro, 1); // A preset rival name.
  await screens.menu(intro);
  await screens.choose(intro, 0);
  await screens.advance(intro, async () => (await page.locator('#title').count()) === 0, 3000);

  // The field: its zone's BGM alone.
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
  const zoneBgm = await page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    return g.sound.fieldBgm(g.state.player.zone);
  });
  expect(zoneBgm).not.toBeNull();
  await expectMusic('field-bgm', zoneBgm!);
  expect(errors).toEqual([]);
});

test('CONTINUE: the silent menu, then the zone BGM alone', async () => {
  test.setTimeout(180_000);
  // A save from the replay bridge (the opening played through to an idle field).
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const idle = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    let calm = 0;
    for (let i = 0; i < 6000 && calm < 60; i++) {
      const s = g.snapshot();
      calm = !s.scriptRunning && window.openSinnohApp!.game.canSave() ? calm + 1 : 0;
      if (s.view.message?.waitingForInput || s.view.yesNo) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    return calm >= 60;
  });
  expect(idle).toBe(true);
  await saveSlot(page);

  await page.goto('/?time=12:00');
  await atTitle();
  await press(page, 'ArrowDown');
  await page.waitForFunction(() => window.openSinnohApp!.audio.context.state === 'running', undefined, { timeout: 10_000 });
  await expectMusic('bgm', 'platinum:SEQ_TITLE01');
  await toMenu();
  await expectMusic(null);
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('continue');
  await press(page, 'Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
  const zoneBgm = await page.evaluate(() => {
    const g = window.openSinnohApp!.game;
    return g.sound.fieldBgm(g.state.player.zone);
  });
  await expectMusic('field-bgm', zoneBgm!);
  expect(errors).toEqual([]);
});
