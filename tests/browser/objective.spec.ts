/**
 * The start menu's objective (OpenSinnoh option `objective`: on for players, off in replay mode as the DS), desktop and
 * phone: the Options toggle turns it on, it shows beside the menu (above it on phones) inside the view, is read out
 * into the live region, follows the state, and the toggle hides it again. On the fixture pack; with OPENSINNOH_NDS_ROM also on the real game from CP4's end.
 * Screenshots go to test-artifacts/objective (gitignored).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks } from '@opensinnoh/game';
import { plainText } from '../../packages/app/src/ui/strings.ts';
import { romSlice } from '../rom.ts';
import { settle } from './settle.ts';
import { openChunk } from './story-seed.ts';
import { appStrings } from './words.ts';

const SHOTS = 'test-artifacts/objective';
const ROM = process.env.OPENSINNOH_NDS_ROM;

const advance = (page: Page, n = 1) => page.evaluate((k) => window.openSinnohGame!.advance(k), n);

/** A physical key, held for one tick. */
async function key(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  await advance(page);
  await page.keyboard.up(code);
  await advance(page);
}

/** A tap or click, then one tick so the game takes it. */
async function press(page: Page, target: Locator, touch: boolean): Promise<void> {
  if (touch) await target.tap();
  else await target.click();
  await advance(page);
}

/** Ticks (pressing A through messages) until the field is idle and can open the menu; on the fixture, after its intro. */
async function untilIdle(page: Page, fixture: boolean): Promise<void> {
  const ok = await page.evaluate((fixture) => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 900; i++) {
      const s = g.snapshot();
      const intro = !fixture || window.openSinnohApp!.game.state.vars['fixture:VAR_ROOM_INTRO' as never] === 1;
      if (intro && !s.scriptRunning && window.openSinnohApp!.game.canSave()) return true;
      if (s.view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    return false;
  }, fixture);
  expect(ok).toBe(true);
}

/** From the open start menu: Options › Game › OBJECTIVE (value 0 on, 1 off), then back to the menu. */
async function setObjective(page: Page, value: 0 | 1, touch: boolean): Promise<void> {
  const menu = page.locator('[data-screen="start-menu"]');
  await press(page, menu.locator('[data-entry="options"]'), touch);
  const row = page.locator('[data-screen="options"] [data-setting="objective"]');
  await press(page, row.locator('button.options-value').nth(value), touch);
  await advance(page, 2);
  await expect(row.locator('button.options-value').nth(value)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options')!).objective)).toBe(value);
  await key(page, 'KeyX');
  await expect(menu).toBeVisible();
}

/** The objective window is inside the view and clear of the menu's entries. */
async function placed(page: Page): Promise<void> {
  const box = (await page.locator('.start-objective').boundingBox())!;
  const list = (await page.locator('[data-screen="start-menu"] .start-list').boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
  const apart = box.x + box.width <= list.x + 0.5 || list.x + list.width <= box.x + 0.5 || box.y + box.height <= list.y + 0.5 || list.y + list.height <= box.y + 0.5;
  expect(apart).toBe(true);
}

test('the objective shows in the start menu, follows the story and the Options toggle hides it', async ({ page }, info) => {
  test.setTimeout(120_000);
  const touch = info.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  await untilIdle(page, true);
  const menu = page.locator('[data-screen="start-menu"]');
  const objective = menu.locator('.start-objective');

  // Replay mode runs the DS behaviour: no objective until the toggle turns it on.
  if (touch) await press(page, page.getByRole('button', { name: 'Start menu' }), true);
  else await key(page, 'Enter');
  await expect(menu).toBeVisible();
  await expect(objective).toHaveCount(0);
  await setObjective(page, 0, touch);

  // The objective after the intro, in the pack's words, read out as the menu opens.
  await key(page, 'KeyX');
  await expect(menu).toBeHidden();
  if (touch) await press(page, page.getByRole('button', { name: 'Start menu' }), true);
  else await key(page, 'Enter');
  await expect(objective).toBeVisible();
  await expect(objective).toHaveText('PURPOSEFind the guide east of here.');
  const said = page.locator('[role="status"][aria-live="polite"] p', { hasText: 'PURPOSE: Find the guide east of here.' });
  await expect(said.last()).toBeAttached();
  const times = await said.count();
  await placed(page);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-fixture-start-menu.png` });
  // Moving the cursor keeps it, and does not read it again.
  await key(page, 'ArrowDown');
  await expect(objective).toHaveText('PURPOSEFind the guide east of here.');
  expect(await said.count()).toBe(times);
  await key(page, 'KeyX');
  await expect(menu).toBeHidden();

  // The next step once the guide is found (the state the field already keeps).
  await page.evaluate(() => void (window.openSinnohApp!.game.state.flags['fixture:FLAG_FIRST_ARRIVAL_ETERNA_CITY' as never] = true));
  await key(page, 'Enter');
  await expect(objective).toHaveText('PURPOSEEarn the Coal token.');

  // The toggle off: the menu shows no objective.
  await setObjective(page, 1, touch);
  await expect(objective).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('on the real game: the objective after the Coal Badge (OPENSINNOH_NDS_ROM)', async ({ page }, info) => {
  test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
  test.setTimeout(600_000);
  const touch = info.project.name === 'phone';
  const { driver } = await openChunk(page, 'cp4.replay', 1, SHOTS, info.project.name);
  await driver.reset(1);
  await untilIdle(page, false);
  const menu = page.locator('[data-screen="start-menu"]');
  if (touch) await press(page, page.getByRole('button', { name: appStrings().aria.hud.menu }), true);
  else await key(page, 'Enter');
  await expect(menu).toBeVisible();
  await setObjective(page, 0, touch);
  const objective = menu.locator('.start-objective');
  // The imported table's heading and its Floaroma step (packages/importer/src/objectives.ts), in the game's language.
  const { registries } = loadGamePacks([romSlice().pack]);
  const words = (name: string) => plainText(registries.texts.get(`platinum:OpenSinnoh_Objective_${name}` as Id)!.text);
  await expect(objective).toHaveText(words('Title') + words('Floaroma'));
  await placed(page);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-rom-start-menu.png` });
});
