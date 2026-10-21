/**
 * Title screen and main menu on the fixture pack (its lantern model under the OpenSinnoh wordmark), at
 * desktop (1280×720) and phone (390×844): the title (no intro) → "press start" → main menu → NEW GAME (the
 * intro: gender, the naming keyboard twice) → field; then a save, a reload, and Continue with the save's info
 * panel. The setup is answered beforehand (onboarding.spec.ts tests it). Real time (no replay bridge: replays skip
 * the title). Screenshots go to test-artifacts/title.
 */
import { expect, test, type Page } from '@playwright/test';
import { saveGame } from './save.ts';
import { settle } from './settle.ts';
import { canvasStats } from './canvas.ts';
import { press, skipSetup, TitleScreens } from './intro.ts';

const SHOTS = 'test-artifacts/title';

const phase = (page: Page) => page.evaluate(() => window.openSinnohTitle?.phase ?? null);

async function toMenu(page: Page, touch: boolean, project: string, name: string): Promise<void> {
  await expect(page.locator('#title')).toBeVisible();
  // No intro: the title opens on the scene with the wordmark, the prompt and the unofficial-project note.
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.getByRole('img', { name: 'OpenSinnoh' })).toBeVisible();
  await expect(page.locator('.title-prompt')).toHaveText(touch ? 'Tap to start' : 'Press start');
  await expect(page.locator('.title-legal')).toContainText('not affiliated with Nintendo');
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 }); // frame-driven: slow under software GL
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}-title.png` });
  expect((await canvasStats(page, '.title-3d')).lit).toBeGreaterThan(0.02);
  if (touch) await page.locator('#title').tap();
  else await press(page, 'Enter');
  await expect.poll(() => phase(page)).toBe('menu');
  await expect(page.locator('.title-menu')).toBeVisible();
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 }); // frame-driven: slow under software GL
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}-menu.png` });
}

test('title → main menu → new game → field; save, reload, continue', async ({ page }, info) => {
  test.setTimeout(300_000);
  const touch = info.project.name === 'phone';
  const project = info.project.name;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await skipSetup(page);
  await page.goto('/?packs=fixture&title');
  // The field is not shown under the title (on phones only the touch controls are, over it).
  await expect(page.locator('#main-canvas')).toBeHidden();
  await toMenu(page, touch, project, 'first');

  // No save yet: NEW JOURNEY (the fixture's NEW GAME) and the start menu's OPTIONS (the fixture's SETTINGS), both in the pack's font.
  await expect(page.locator('.tm-window')).toHaveCount(2);
  await expect(page.locator('.tm-options')).toHaveText('SETTINGS');
  await expect(page.locator('.tm-options canvas')).toHaveCount(1);
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('new-game');
  if (touch) await page.locator('.tm-new-game').tap();
  else await press(page, 'KeyZ');
  // New game: Rowan's intro, the fixture's warden here (onboarding.spec.ts checks it
  // step by step). The girl; the naming keyboard typed on desktop, tapped key by key on the phone.
  const screens = new TitleScreens(page, touch);
  const flow = screens.flow('New game');
  await expect(flow).toBeVisible();
  await screens.menu(flow);
  await screens.choose(flow, 1);
  await screens.openBall(flow);
  await screens.gender(flow, 'girl');
  await screens.menu(flow);
  await screens.choose(flow, 0);
  await screens.name(flow, 'Kai', ['page:0', 'key:1:0', 'page:1', 'key:0:0', 'key:0:8']);
  await screens.menu(flow);
  await page.screenshot({ path: `${SHOTS}/${project}-new-game.png` });
  await screens.choose(flow, 0);
  await screens.menu(flow);
  await screens.choose(flow, 0);
  await screens.name(flow, 'Mo', ['page:0', 'key:1:2', 'page:1', 'key:1:4']);
  await screens.menu(flow);
  await screens.choose(flow, 0);
  await screens.advance(flow, async () => (await page.locator('#title').count()) === 0, 2000);

  await expect(page.locator('#title')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#game')).toBeVisible();
  expect(await page.evaluate(() => ({ names: window.openSinnohApp!.game.state.names, gender: window.openSinnohApp!.game.state.gender }))).toEqual({ names: { player: 'Kai', rival: 'Mo' }, gender: 'female' });
  // The field runs: the intro message comes up; dismiss it and save from the start menu.
  await page.waitForFunction(() => window.openSinnohApp!.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/${project}-field.png` });
  await press(page, 'KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave());
  await saveGame(page);
  const saved = await page.evaluate(() => window.openSinnohApp!.game.state.player);

  // A new launch: the title again; CONTINUE (RESUME) shows the save and loads it.
  await page.reload();
  await toMenu(page, touch, project, 'second');
  const resume = page.locator('.tm-continue');
  await expect(resume).toBeVisible();
  await expect(resume).toContainText('Kai');
  await expect(resume).toContainText('MARKS');
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('continue');
  // Down moves to NEW JOURNEY and back up; B returns to the title.
  if (!touch) {
    await press(page, 'ArrowDown');
    expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('new-game');
    await press(page, 'ArrowUp');
    await press(page, 'KeyX');
    await expect.poll(() => phase(page)).toBe('title');
    // The DS ignores input for 30 frames after returning; wait for that, not for wall time.
    await expect.poll(() => page.evaluate(() => window.openSinnohTitle!.inputBlocked), { timeout: 15_000 }).toBe(false);
    await press(page, 'Enter');
    await expect.poll(() => phase(page)).toBe('menu');
  }
  if (touch) await resume.tap();
  else await press(page, 'Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 10_000 });
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player)).toEqual(saved);
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.names.player)).toBe('Kai');
  expect(errors).toEqual([]);
});

test('replay mode and dev packs skip the title', async ({ page }) => {
  await page.goto('/?packs=fixture&replay&title');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await expect(page.locator('#title')).toHaveCount(0);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp !== undefined);
  await expect(page.locator('#title')).toHaveCount(0);
  await expect(page.locator('#game')).toBeVisible();
});
