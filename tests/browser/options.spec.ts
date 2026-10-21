/**
 * One OPTIONS screen, on the fixture pack at desktop (1280×720) and phone (390×844):
 * the same screen opens from the title's Options window and from the start menu in the game, with the four
 * sections (GAME, DEVICE, DATA, PRIVACY) and the same settings on each; what does not work where it is open is
 * listed muted with a reason. The settings button is gone. Structure only: no pixels (ui-gallery.spec.ts
 * checks the design system's contrast, touch targets and whole pixels).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { skipSetup } from './intro.ts';
import { saveGame } from './save.ts';

const SECTIONS = ['game', 'device', 'controls', 'data', 'privacy'];
const board = (page: Page) => page.locator('[data-screen="options"]');

/** Each page's rows (setting id, muted), reading the pages in tab order. */
async function pages(page: Page): Promise<{ tabs: (string | null)[]; rows: Record<string, [string, boolean][]> }> {
  const tabs = await board(page).locator('[role="tab"]').evaluateAll((t) => t.map((e) => e.getAttribute('data-section')));
  const rows: Record<string, [string, boolean][]> = {};
  for (const id of tabs) {
    // The screen is drawn again after each change: a click that lands mid-redraw is taken again.
    await expect(async () => {
      await board(page).locator(`[role="tab"][data-section="${id}"]`).click();
      await expect(board(page).locator(`[role="tab"][data-section="${id}"]`)).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
    }).toPass();
    rows[id!] = await board(page).locator('[data-setting]').evaluateAll((r) => r.map((e) => [e.getAttribute('data-setting')!, e.getAttribute('aria-disabled') === 'true'] as [string, boolean]));
  }
  return { tabs, rows };
}

/** The title (already loading) to its main menu. */
async function toMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await page.locator('#title').click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
}

/** To the title's main menu, then its Options window. */
async function fromTitle(page: Page): Promise<void> {
  // The device has answered the first-run setup (onboarding.spec.ts tests it).
  await skipSetup(page);
  await page.goto('/?packs=fixture&title');
  await toMenu(page);
  await page.locator('.tm-options').click();
  await expect(page.getByRole('dialog', { name: 'Options' })).toBeVisible();
  await expect(board(page)).toBeVisible();
}

/** The game on its idle field (wall clock). */
async function toField(page: Page): Promise<void> {
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 60_000 });
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
}

/** The start menu's OPTIONS entry. */
async function openOptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start menu', exact: true }).click();
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  await expect(board(page)).toBeVisible();
}

/** Every row is the system's row size (40 px d-pad, 64 px touch) and spans the list. */
async function rowsFitTheList(page: Page): Promise<void> {
  // The window's opening animation moves it: measure once it has run.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const r = await board(page).evaluate((root) => {
    const list = root.querySelector('.options-rows')!;
    const pad = parseFloat(getComputedStyle(list).paddingLeft);
    const l = list.getBoundingClientRect();
    const min = document.documentElement.dataset.density === 'touch' ? 64 : 40;
    return [...root.querySelectorAll('.options-row')].map((e) => {
      const b = e.getBoundingClientRect();
      return { size: b.height >= min - 0.5, full: Math.abs(b.left - (l.left + pad)) < 1 && Math.abs(b.right - (l.right - pad)) < 1 };
    });
  });
  expect(r.length).toBeGreaterThan(0);
  for (const row of r) expect(row).toEqual({ size: true, full: true });
}

test('the title and the game open the same Options screen: five sections, the same settings', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // From the title.
  await fromTitle(page);
  const title = await pages(page);
  expect(title.tabs).toEqual(SECTIONS);
  // Kept-in-the-save options and the mods are listed, muted, with the reason as the description.
  const muted = (p: typeof title) => Object.values(p.rows).flatMap((r) => r.filter(([, off]) => off).map(([id]) => id));
  expect(muted(title)).toEqual(['sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame', 'mod/demo-mod']);
  await board(page).locator('[role="tab"][data-section="game"]').click();
  await expect(board(page).locator('[data-setting="textSpeed"] .options-label')).toHaveText('Text pace');
  await expect(board(page).locator('[data-setting="battleScene"] .options-label')).toHaveText('Effects');
  await board(page).locator('[data-setting="frame"] .options-label').click();
  await expect(board(page).locator('.options-desc')).toContainText('Kept in your save');
  // Text speed is a device option: it works at the title (and is kept for the game).
  await board(page).locator('[data-setting="textSpeed"] .options-value').nth(2).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options') ?? '{}').textSpeed)).toBe(2);
  await rowsFitTheList(page);
  // The DEVICE list scrolls inside the window; Back closes.
  await board(page).locator('[role="tab"][data-section="device"]').click();
  await expect(board(page).locator('.options-rows')).toHaveAttribute('data-scrolls', '');
  await board(page).locator('.options-close').click();
  await expect(page.getByRole('dialog', { name: 'Options' })).toHaveCount(0);
  await expect(page.locator('.tm-window')).toHaveCount(2);

  // From the game: the same sections and rows, nothing muted but the title-only reasons.
  await toField(page);
  await openOptions(page);
  const game = await pages(page);
  expect(game.tabs).toEqual(SECTIONS);
  expect(Object.fromEntries(Object.entries(game.rows).map(([k, v]) => [k, v.map(([id]) => id)]))).toEqual(Object.fromEntries(Object.entries(title.rows).map(([k, v]) => [k, v.map(([id]) => id)])));
  expect(muted(game)).toEqual([]);
  // The phone rows are listed where the device has the feature: haptics and keep-screen-on in Chromium, the touch controls' size and opacity on a touch screen.
  expect(title.rows.device!.map(([id]) => id)).toEqual(['zoom', 'renderScale', 'speed', 'followers', 'followerStyle', 'character', 'autoLowercase', 'volume', 'mute', 'tradeEvolution', 'theme', 'uiFrame', 'reduceFlashing', ...(info.project.name === 'phone' ? ['controlSize', 'controlOpacity'] : []), 'haptics', 'keepAwake']);
  expect(title.rows.data!.map(([id]) => id)).toEqual(['exportSave', 'importSave', 'suspend', 'mod/demo-mod']);
  // The QoL additions (OpenSinnoh): GAME after the DS's six, CONTROLS before the bindings.
  expect(title.rows.game!.map(([id]) => id)).toEqual(['textSpeed', 'sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame', 'repelPrompt', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'spiritombVendors', 'introSkip']);
  expect(title.rows.controls!.slice(0, 2).map(([id]) => id)).toEqual(['autoRun', 'itemWheel']);
  await board(page).locator('[role="tab"][data-section="game"]').click();
  await rowsFitTheList(page);
  // Export without a save says so in the description window.
  await board(page).locator('[role="tab"][data-section="data"]').click();
  await board(page).locator('[data-setting="exportSave"] .options-value').click();
  await expect(board(page).locator('.options-desc')).toContainText('Save first');
  // The settings button is gone: Options is the start menu's entry.
  await expect(page.locator('#menu-button, dialog#menu')).toHaveCount(0);
  await board(page).locator('.options-close').click();
  await expect(board(page)).toBeHidden();
  expect(errors, info.project.name).toEqual([]);
});

test('a save file imported at the title is what CONTINUE loads', async ({ page }, info) => {
  test.setTimeout(120_000);
  // Save in the game and export the file; rename the player in it.
  await toField(page);
  await saveGame(page);
  await openOptions(page);
  await board(page).locator('[role="tab"][data-section="data"]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), board(page).locator('[data-setting="exportSave"] .options-value').click()]);
  const file = info.outputPath('save.json');
  await download.saveAs(file);
  const save = JSON.parse(readFileSync(file, 'utf8')) as { state: { names: { player: string } } };
  save.state.names.player = 'Zed';
  writeFileSync(file, JSON.stringify(save));

  // At the title: DATA > IMPORT SAVE opens the file dialog; the page restarts and CONTINUE shows the file's player.
  await fromTitle(page);
  await board(page).locator('[role="tab"][data-section="data"]').click();
  // The question is the system's confirm dialog (it opens on NO), never a browser dialog.
  page.on('dialog', (d) => {
    throw new Error(`a browser dialog: ${d.message()}`);
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), board(page).locator('[data-setting="importSave"] .options-value').click()]);
  await chooser.setFiles(file);
  await expect(board(page).locator('.options-question [role="alertdialog"]')).toContainText('Replace your saved game');
  await expect(board(page).locator('.options-question [aria-current="true"]')).toContainText('No');
  await board(page).locator('[data-tap="settings:answer:yes"]').click();
  await toMenu(page);
  await expect(page.locator('.tm-continue')).toContainText('Zed');
});

// ---- Options › Controls: keyboard and gamepad bindings (packages/app/src/controls.ts) ----

const bindButton = (page: Page, action: string) => board(page).locator(`[data-setting="bind/${action}"] .options-value`);
/** A on the row, and the binding waits for a key (a key pressed before it is the game's). */
async function arm(page: Page, action: string): Promise<void> {
  await bindButton(page, action).click();
  await expect(bindButton(page, action)).toHaveText('PRESS A KEY OR BUTTON');
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:controls') ?? 'null') as { keys: Record<string, string[]>; pad: Record<string, string | null>; raw: Record<string, string | null>; deadZone: number } | null);

/** A gamepad the page can press: `window.__pad`. Without a mapping it is a pad with no standard layout; 'standard' has one. */
async function fakePad(page: Page, mapping = ''): Promise<void> {
  await page.addInitScript((m) => {
    const pad = { id: 'Test pad', index: 0, connected: true, mapping: m, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    (window as unknown as { __pad: unknown }).__pad = pad;
    navigator.getGamepads = () => [(window as unknown as { __pad: Gamepad | null }).__pad] as unknown as Gamepad[];
  }, mapping);
}
const padButton = (page: Page, button: number, down: boolean) => page.evaluate(({ b, d }) => void ((window as unknown as { __pad: { buttons: { pressed: boolean }[] } }).__pad.buttons[b]!.pressed = d), { b: button, d: down });

test('Controls: keys are bound by pressing them, a taken key swaps, it persists and resets', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fromTitle(page);
  await board(page).locator('[role="tab"][data-section="controls"]').click();
  await expect(bindButton(page, 'a')).toHaveText('Z, J, Space · Right button');
  await expect(bindButton(page, 'fast')).toHaveText('Tab · Right trigger');

  // A, then the key: the key is A's only key.
  await arm(page, 'a');
  await expect(bindButton(page, 'a')).toHaveText('PRESS A KEY OR BUTTON');
  await expect(board(page).locator('.options-desc')).toContainText('Escape cancels');
  await page.screenshot({ path: `test-artifacts/a11y/controls-binding-${info.project.name}.png` });
  await page.keyboard.press('KeyG');
  await expect(bindButton(page, 'a')).toHaveText('G · Right button');
  await expect(board(page).locator('.options-desc')).toContainText('A is now G.');
  expect((await stored(page))!.keys.a).toEqual(['KeyG']);

  // Escape cancels and binds nothing; a key the game uses (P) is refused with the reason.
  await arm(page, 'b');
  await page.keyboard.press('Escape');
  await expect(bindButton(page, 'b')).toHaveText('X, K · Bottom button');
  await arm(page, 'b');
  await page.keyboard.press('KeyP');
  await expect(board(page).locator('.options-desc')).toContainText('cannot be bound');
  await expect(bindButton(page, 'b')).toHaveText('X, K · Bottom button');

  // START takes G, which A has: they swap, and the strip says so.
  await arm(page, 'start');
  await page.keyboard.press('KeyG');
  await expect(board(page).locator('.options-desc')).toContainText('Swapped with A: it now uses Enter');
  await expect(bindButton(page, 'start')).toHaveText('G · Start');
  await expect(bindButton(page, 'a')).toHaveText('Enter · Right button');

  // Kept on this device across a reload, and reset to the defaults.
  await page.reload();
  await toMenu(page);
  await page.locator('.tm-options').click();
  await board(page).locator('[role="tab"][data-section="controls"]').click();
  await expect(bindButton(page, 'start')).toHaveText('G · Start');
  await board(page).locator('[data-setting="resetControls"] .options-value').click();
  await expect(bindButton(page, 'start')).toHaveText('Enter · Start');
  await expect(bindButton(page, 'a')).toHaveText('Z, J, Space · Right button');
  expect((await stored(page))!.keys.start).toEqual(['Enter']);
  expect(errors).toEqual([]);
});

test('Reduce flashing follows the system until chosen, then keeps the choice on this device', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fromTitle(page);
  await board(page).locator('[role="tab"][data-section="device"]').click();
  const row = board(page).locator('[data-setting="reduceFlashing"]');
  await expect(row.locator('[role="switch"]')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:reduce-flashing'))).toBeNull();
  await row.locator('[role="switch"]').click();
  await expect(row.locator('[role="switch"]')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lantern-nds:reduce-flashing'))).toBe('false');
  // The choice stays, whatever the system says.
  await page.reload();
  await toMenu(page);
  await page.locator('.tm-options').click();
  await board(page).locator('[role="tab"][data-section="device"]').click();
  await expect(board(page).locator('[data-setting="reduceFlashing"] [role="switch"]')).toHaveAttribute('aria-checked', 'false');
});

test('Controls: a bad stored entry falls back to its default with a warning', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('lantern-nds:controls', JSON.stringify({ keys: { a: ['KeyG'], b: 'nope' }, deadZone: 3 })));
  await fromTitle(page);
  await board(page).locator('[role="tab"][data-section="controls"]').click();
  await expect(bindButton(page, 'a')).toHaveText('G · Right button');
  await expect(bindButton(page, 'b')).toHaveText('X, K · Bottom button');
  expect(warnings.filter((w) => w.startsWith('controls:')).length).toBe(2);
});

test('Controls: a pad without a standard layout is bound by its raw buttons, and the game reads them', async ({ page }) => {
  test.setTimeout(120_000);
  await fakePad(page);
  await fromTitle(page);
  await board(page).locator('[role="tab"][data-section="controls"]').click();
  // Nothing is guessed for such a pad: its column starts unbound.
  await expect(bindButton(page, 'a')).toHaveText('Z, J, Space · Unbound');
  await arm(page, 'a');
  await padButton(page, 6, true);
  await expect(bindButton(page, 'a')).toHaveText('Z, J, Space · Button 6');
  await padButton(page, 6, false);
  // A taken button swaps, also by index.
  await arm(page, 'b');
  await padButton(page, 6, true);
  await expect(board(page).locator('.options-desc')).toContainText('Swapped with A: it now uses Unbound');
  await padButton(page, 6, false);
  const s = (await stored(page))!;
  expect([s.raw.a, s.raw.b]).toEqual([null, 'b6']);
  // The standard table is untouched.
  expect(s.pad.a).toBe('b1');

  // Bind A to raw button 2, then in the game that button advances the message (Z does too).
  await arm(page, 'a');
  await padButton(page, 2, true);
  await expect(bindButton(page, 'a')).toHaveText('Z, J, Space · Button 2');
  await padButton(page, 2, false);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await padButton(page, 2, true);
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await padButton(page, 2, false);
});

test('Controls: a pad with a layout binds by standard index, and the stick dead zone is a setting', async ({ page }) => {
  await fakePad(page, 'standard');
  await fromTitle(page);
  await board(page).locator('[role="tab"][data-section="controls"]').click();
  await arm(page, 'a');
  await padButton(page, 3, true);
  await expect(bindButton(page, 'a')).toHaveText('Z, J, Space · Top button');
  await padButton(page, 3, false);
  // X had the top button: they swapped.
  await expect(bindButton(page, 'x')).toHaveText('C · Right button');
  expect((await stored(page))!.pad.a).toBe('b3');
  await board(page).locator('[data-setting="deadZone"] .os-sld .cell').nth(7).click();
  await expect.poll(async () => (await stored(page))?.deadZone).toBe(80);
});

test('Controls: a rebound key plays the game, and the old keys do not', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    if (!localStorage.getItem('lantern-nds:controls')) localStorage.setItem('lantern-nds:controls', JSON.stringify({ keys: { a: ['KeyG'] } }));
  });
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.openSinnohApp!.game.scripts.view().message?.waitingForInput)).toBe(true);
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
});
