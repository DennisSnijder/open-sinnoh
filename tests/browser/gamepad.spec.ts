/**
 * A controller from the first page load to playing, with nothing else touched (the file dialog apart): the ROM page,
 * the first-run setup, Start playing, the title, Options, the field. The pad is a stand-in (pad.ts): whether a real
 * press reaches the file dialog depends on the browser, so both answers are driven here.
 */
import { expect, test, type Page } from '@playwright/test';
import { fakeImportWorker, fakeRom, importDone } from './fake-import.ts';
import { skipSetup } from './intro.ts';
import { hold, installPads, NINTENDO, NINTENDO_ID, PAD, PLAYSTATION_ID, press, refuseFileDialog, run, stick, XBOX_ID } from './pad.ts';

test.skip(({ isMobile }) => isMobile, 'pad input does not depend on the viewport');

const board = (page: Page) => page.locator('[data-screen="options"]');

/** The ROM page is up and its pad loop has seen it (a button down before that belongs to the page before). */
async function onRomPage(page: Page): Promise<void> {
  await expect(page.locator('#picker')).toBeVisible();
  await run(page, 50);
}

/** To the title's main menu by pad alone. */
async function toMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title');
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await expect(async () => {
    await press(page, PAD.a);
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Presses until `read()` is `target`, one step at a time: on a busy machine three slow frames stretch a `press` into
 * the held repeat, and a loop of presses can then jump over its target for ever. `button` picks the way from where it is.
 */
async function stepTo(page: Page, read: () => Promise<string | null>, target: string, button: (now: string | null) => number): Promise<void> {
  for (let now = await read(); now !== target; now = await read()) {
    await hold(page, button(now), true);
    await expect.poll(read, { intervals: [20] }).not.toBe(now);
    await hold(page, button(now), false);
    await run(page, 50);
  }
}

async function optionsFromTitle(page: Page, down: () => Promise<void> = () => press(page, PAD.down)): Promise<void> {
  await skipSetup(page);
  await page.goto('/?packs=fixture&title');
  await toMenu(page);
  const on = () => page.evaluate(() => window.openSinnohTitle?.focused);
  for (let i = 0; i < 6 && (await on()) !== 'options'; i++) await down();
  await press(page, PAD.a);
  await expect(board(page)).toBeVisible();
}

test('the ROM page: a press opens the file dialog where the browser lets it', async ({ page }) => {
  await installPads(page);
  await page.goto('/');
  await onRomPage(page);
  await press(page, PAD.a);
  await expect(page.locator('#rom-input')).toBeFocused();
  const [dialog] = await Promise.all([page.waitForEvent('filechooser'), press(page, PAD.a)]);
  expect(dialog.isMultiple()).toBe(false);
  await expect(page.locator('#rom-refused')).toHaveCount(0);
});

for (const [name, id, confirm, cancel, label] of [['an Xbox', XBOX_ID, PAD.a, PAD.b, 'A'], ['a PlayStation', PLAYSTATION_ID, PAD.a, PAD.b, 'Cross'], ['a Nintendo', NINTENDO_ID, NINTENDO.a, NINTENDO.b, 'A']] as const) {
  test(`the ROM page: ${name} pad confirms with its printed button, and the note names it`, async ({ page }) => {
    await installPads(page, { id });
    await page.goto('/');
    await onRomPage(page);
    await press(page, confirm);
    await expect(page.locator('#rom-input')).toBeFocused();
    await expect(page.locator('#picker-pad-note')).toContainText(`Confirm with ${label}.`);
    // The other face button does not open the dialog: the next filechooser is the confirm press's.
    await press(page, cancel);
    const [dialog] = await Promise.all([page.waitForEvent('filechooser'), press(page, confirm)]);
    expect(dialog.isMultiple()).toBe(false);
  });
}

test('the ROM page: focus lands on a press, and a refused file dialog says what to do', async ({ page }) => {
  await installPads(page);
  await refuseFileDialog(page);
  await page.goto('/');
  await onRomPage(page);
  await expect(page.locator('#picker-pad-note')).toBeHidden();

  // The first press only lands focus (nothing acts unseen), and says what the file dialog may need.
  await press(page, PAD.a);
  await expect(page.locator('#rom-input')).toBeFocused();
  await expect(page.locator('#picker-pad-note')).toBeVisible();
  await expect(page.locator('#rom-refused')).toHaveCount(0);

  // The browser refuses and the page says so; focus stays, so a key takes it from there.
  await press(page, PAD.a);
  await expect(page.locator('#rom-refused')).toContainText('Press Enter or Space');
  await expect(page.locator('#rom-input')).toBeFocused();
});

test('first page load to the title by pad: the setup, every answer, Start playing', async ({ page }) => {
  await installPads(page);
  await refuseFileDialog(page);
  await fakeImportWorker(page);
  await page.goto('/');
  await onRomPage(page);
  await press(page, PAD.a);
  // The one step a pad cannot do: the file (a player does it with the system's dialog or a drop).
  await page.locator('#rom-input').setInputFiles(fakeRom());
  await expect(page.locator('#importing')).toBeVisible();

  // The picker's control went with the step: focus moves to the first answer by itself, and nothing is picked unseen.
  const question = () => page.locator('.fr-choices').getAttribute('data-question');
  const answer = page.locator('.fr-choices .os-choice');
  await expect(answer.nth(0)).toBeFocused();
  expect(await question()).toBe('addon');

  // The add-on's file dialog: refused for a stand-in, said in place; the question stays with focus on the answer.
  await press(page, PAD.a);
  await expect(page.locator('.fr-note')).toContainText('only for a key press');
  expect(await question()).toBe('addon');
  await expect(answer.nth(0)).toBeFocused();

  // Down, A: skip it; each later step keeps focus on an answer and its cursor visible.
  await press(page, PAD.down);
  await expect(answer.nth(1)).toBeFocused();
  await expect(answer.nth(1)).toHaveClass(/is-cursor/);
  await press(page, PAD.a);
  for (const q of ['reports', 'textSpeed', 'visualStyle']) {
    await expect.poll(question).toBe(q);
    await expect(page.locator('.fr-choices .os-choice:focus')).toHaveCount(1);
    await press(page, PAD.a);
  }
  await expect(page.locator('.fr-done')).toBeVisible();

  // Start playing says why not until the import is done; focus goes to it, and it stays held back.
  await expect(page.locator('#start-playing')).toBeFocused();
  await press(page, PAD.a);
  await expect(page.locator('#importing')).toBeVisible();
  await importDone(page, 0);
  await expect(page.locator('#start-playing')).toBeFocused();
  await expect(page.locator('#start-playing')).not.toHaveAttribute('aria-disabled', 'true');
  const left = page.waitForEvent('framenavigated');
  await hold(page, PAD.a, true);
  await run(page, 100).catch(() => {}); // The page goes away under this wait.
  await left;
});

test('a button held as a screen appears does nothing there; the pad held does not reach the game behind it', async ({ page }) => {
  await installPads(page);
  await fakeImportWorker(page);
  await page.goto('/');
  await onRomPage(page);
  await press(page, PAD.a);
  await hold(page, PAD.a, true);
  await page.locator('#rom-input').setInputFiles(fakeRom());
  await expect(page.locator('.fr-choices')).toBeVisible();
  await run(page, 250);
  await expect(page.locator('.fr-choices')).toHaveAttribute('data-question', 'addon');
  await hold(page, PAD.a, false);
});

test('held directions repeat on a DOM screen, the stick moves it, and its dead zone holds', async ({ page }) => {
  await installPads(page);
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await page.evaluate(() => document.querySelector('#picker .rom-body')!.replaceChildren(...Array.from({ length: 8 }, (_, i) => Object.assign(document.createElement('button'), { id: `b${i}`, textContent: `${i}` }))));
  await press(page, PAD.down);
  await expect(page.locator('#b0')).toBeFocused();
  await hold(page, PAD.down, true);
  await run(page, 800);
  await hold(page, PAD.down, false);
  const at = await page.evaluate(() => Number(document.activeElement!.id.slice(1)));
  expect(at).toBeGreaterThanOrEqual(3);

  // Under the dead zone nothing; past it one step, then up wraps round from the first.
  await page.locator('#b0').focus();
  await stick(page, 0, 0.3);
  await run(page, 100);
  await expect(page.locator('#b0')).toBeFocused();
  await stick(page, 0, -0.9);
  await run(page, 100);
  await stick(page, 0, 0);
  await expect(page.locator('#b7')).toBeFocused();
});

test('the crash screen: the pad moves between its actions, opens the details and scrolls them', async ({ page }) => {
  await installPads(page);
  await skipSetup(page);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => !!window.openSinnohApp);
  await page.evaluate(() => {
    window.openSinnohApp!.game.step = () => {
      throw new Error('test crash');
    };
  });
  await expect(page.locator('.crash')).toBeVisible();
  await expect(page.locator('.crash-reload')).toBeFocused();
  await run(page, 50);
  await press(page, PAD.right);
  await expect(page.locator('.crash-copy')).toBeFocused();
  await press(page, PAD.down);
  await expect(page.locator('.crash-details summary')).toBeFocused();
  await press(page, PAD.a);
  await expect(page.locator('.crash-details')).toHaveAttribute('open', '');
  await press(page, PAD.down);
  await expect(page.locator('.crash-report')).toBeFocused();
});

test('Options by pad: pages, rows, held repeat, rebinding, a refused file, B backs out without acting on the menu', async ({ page }) => {
  test.setTimeout(180_000);
  await installPads(page, { id: PLAYSTATION_ID });
  await refuseFileDialog(page);
  await optionsFromTitle(page);
  const tab = (s: string) => board(page).locator(`[role="tab"][data-section="${s}"]`);
  await expect(tab('game')).toHaveAttribute('aria-selected', 'true');

  // R turns the page, up from the first row is the tab strip's slot.
  await press(page, PAD.r);
  await press(page, PAD.r);
  await expect(tab('controls')).toHaveAttribute('aria-selected', 'true');

  // The labels are the connected pad's own.
  const bind = (a: string) => board(page).locator(`[data-setting="bind/${a}"] .options-value`);
  await expect(bind('a')).toContainText('Cross');
  await expect(bind('poketch')).toContainText('L2');

  // Held down repeats (the DS's 8 and 4 ticks).
  const at = () => page.evaluate(() => document.querySelector('[data-screen="options"] .options-row.is-cursor')?.getAttribute('data-setting') ?? null);
  const before = (await at())!;
  await hold(page, PAD.down, true);
  await run(page, 900);
  await hold(page, PAD.down, false);
  await run(page, 100);
  const rows = await board(page).locator('[data-setting]').evaluateAll((r) => r.map((e) => e.getAttribute('data-setting')));
  expect(rows.indexOf((await at())!)).toBeGreaterThan(rows.indexOf(before) + 2);

  // Rebind START by pad: A arms it; the press that armed it does not bind; the next button does, and swaps.
  await stepTo(page, at, 'bind/start', (now) => (rows.indexOf(now ?? '') > rows.indexOf('bind/start') ? PAD.up : PAD.down));
  await press(page, PAD.a);
  await expect(bind('start')).toHaveText('PRESS A KEY OR BUTTON');
  await press(page, PAD.select);
  await expect(bind('start')).toContainText('Share');
  await expect(board(page).locator('.options-desc')).toContainText('Swapped with SELECT');

  // A file action here is refused for a stand-in pad and says so in the description, not nothing.
  await press(page, PAD.r);
  await expect(tab('data')).toHaveAttribute('aria-selected', 'true');
  await stepTo(page, at, 'importSave', () => PAD.down);
  await press(page, PAD.a);
  await expect(board(page).locator('.options-desc')).toContainText('only for a key press');

  // B closes Options and the same press does nothing on the title's menu.
  await press(page, PAD.b);
  await expect(board(page)).toBeHidden();
  expect(await page.evaluate(() => window.openSinnohTitle?.phase)).toBe('menu');
});

test('Options by pad: the CONTROLLER row says what it found and forces another face', async ({ page }) => {
  test.setTimeout(120_000);
  await installPads(page, { id: XBOX_ID });
  await optionsFromTitle(page);
  await press(page, PAD.r);
  await press(page, PAD.r);
  const at = () => page.evaluate(() => document.querySelector('[data-screen="options"] .options-row.is-cursor')?.getAttribute('data-setting') ?? null);
  await stepTo(page, at, 'padLayout', () => PAD.down);
  await expect(board(page).locator('.options-desc')).toContainText('AUTO found: XBOX.');
  const value = board(page).locator('[data-setting="padLayout"] .options-value');
  await expect(value).toHaveText('AUTO');
  await stepTo(page, () => value.textContent(), 'NINTENDO', () => PAD.right);

  // This Xbox pad now reads as a Nintendo pad: its bottom button is DS B, which closes Options.
  await press(page, NINTENDO.b);
  await expect(board(page)).toBeHidden();
});

test('a pad without a standard layout reaches Options on the guess, and binding keeps the guess for the rest', async ({ page }) => {
  await installPads(page, { mapping: '' });
  await optionsFromTitle(page, async () => {
    await stick(page, 0, 0.9);
    await run(page, 100);
    await stick(page, 0, 0);
    await run(page, 100);
  });
  await press(page, PAD.r);
  await press(page, PAD.r);
  const bind = (a: string) => board(page).locator(`[data-setting="bind/${a}"] .options-value`);
  await expect(bind('a')).toContainText('Button 0');
  await expect(bind('up')).toContainText('Axis 1 -');
});

test('the field: a pad found after load drives it, a second pad takes over, an unplugged one lets go', async ({ page }) => {
  await installPads(page, { count: 2 });
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 60_000 });
  await press(page, PAD.a);
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());

  // X opens the start menu, B closes it.
  await press(page, PAD.x);
  await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
  await press(page, PAD.b);
  await expect(page.locator('[data-screen="start-menu"]')).toHaveCount(0);

  // The second pad, pressed: it is the one read now.
  await press(page, PAD.x, 1);
  await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
  await press(page, PAD.b, 1);
  await expect(page.locator('[data-screen="start-menu"]')).toHaveCount(0);

  // Unplugged while holding a direction: the walk stops, nothing stays held.
  const z = () => page.evaluate(() => window.openSinnohApp!.game.state.player.z);
  await hold(page, PAD.down, true, 1);
  await run(page, 150);
  await page.evaluate(() => {
    const w = window as unknown as { __pads: unknown[] };
    const gone = w.__pads[1];
    w.__pads[1] = null;
    window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: gone }));
  });
  await run(page, 500);
  const stopped = await z();
  await run(page, 500);
  expect(await z()).toBe(stopped);
  expect(await page.evaluate(() => window.openSinnohApp!.game.canSave())).toBe(true);
});

/** The idle field with the Pokétch, a wall-clock game. */
async function field(page: Page): Promise<void> {
  await installPads(page);
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 60_000 });
  await press(page, PAD.a);
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  await page.evaluate(() => {
    const apps = ['fixture:POKETCH_APPID_DIGITALWATCH', 'fixture:POKETCH_APPID_CALCULATOR'] as never;
    Object.assign(window.openSinnohApp!.game.state.poketch, { enabled: true, apps, current: 'fixture:POKETCH_APPID_DIGITALWATCH' });
  });
}

test('the Pokétch: its own button opens it, L and R work it, touch mode, B closes unless the player is running', async ({ page }) => {
  await field(page);
  const card = page.locator('.poketch');
  await press(page, PAD.lt);
  await expect(card).toBeVisible();
  await press(page, PAD.r);
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.poketch.current)).toBe('fixture:POKETCH_APPID_CALCULATOR');

  // Y is touch mode: B leaves the mode, not the card.
  await press(page, PAD.y);
  await press(page, PAD.b);
  await expect(card).toBeVisible();

  // B with a direction held is the running shoes: the card stays over the walk.
  await hold(page, PAD.left, true);
  await press(page, PAD.b);
  await hold(page, PAD.left, false);
  await expect(card).toBeVisible();

  await press(page, PAD.b);
  await expect(card).toBeHidden();
  await press(page, PAD.lt);
  await expect(card).toBeVisible();
  await press(page, PAD.lt);
  await expect(card).toBeHidden();
});

test('the trainer card is signed by pad: Y signs, the d-pad and A draw, X is done', async ({ page }) => {
  await field(page);
  await press(page, PAD.x);
  const menu = page.locator('[data-screen="start-menu"]');
  await expect(menu).toBeVisible();
  const entries = menu.locator('[data-entry]');
  const count = await entries.count();
  const trainer = await entries.evaluateAll((e) => e.findIndex((x) => x.getAttribute('data-entry') === 'trainer'));
  expect(trainer, `entries: ${count}`).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < trainer; i++) await press(page, PAD.down);
  await press(page, PAD.a);
  const card = page.locator('[data-screen="trainer-card"]');
  await expect(card).toBeVisible();
  await press(page, PAD.a); // Flip to the back, where the signature is.
  await press(page, PAD.y);
  await expect(card.locator('.signature-pad')).toBeVisible();

  const before = await page.evaluate(() => window.openSinnohApp!.game.app());
  await hold(page, PAD.a, true);
  await run(page, 80);
  await hold(page, PAD.right, true);
  await run(page, 300);
  await hold(page, PAD.down, true);
  await run(page, 200);
  await hold(page, PAD.right, false);
  await hold(page, PAD.down, false);
  await hold(page, PAD.a, false);
  await run(page, 100);
  await expect(card.locator('.signature-pen')).toBeAttached();
  const after = await page.evaluate(() => window.openSinnohApp!.game.app());
  expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));

  // DONE, then YES: the card holds the signature.
  await press(page, PAD.x);
  await expect(card.locator('.yes-no')).toBeVisible();
  await press(page, PAD.a);
  await expect.poll(() => page.evaluate(() => !!window.openSinnohApp!.game.state.signature)).toBe(true);
});

test('the Underground: R pings the touch radar around the player', async ({ page }) => {
  await field(page);
  await page.evaluate(() => {
    const game = window.openSinnohApp!.game as unknown as { step(f: { tap?: string }): void; world: { undergroundView(): unknown }; __taps: string[] };
    game.__taps = [];
    const step = game.step.bind(game);
    game.step = (f) => {
      if (f.tap) game.__taps.push(f.tap);
      step(f);
    };
    game.world.undergroundView = () => ({});
  });
  await press(page, PAD.r);
  const taps = await page.evaluate(() => (window.openSinnohApp!.game as unknown as { __taps: string[] }).__taps);
  const p = await page.evaluate(() => window.openSinnohApp!.game.state.player);
  expect(taps).toContain(`tile:${p.x},${p.z}`);
});

test('fullscreen is an Options row, so a pad reaches it', async ({ page }) => {
  await installPads(page);
  await optionsFromTitle(page);
  await press(page, PAD.r);
  const row = board(page).locator('[data-setting="fullscreen"]');
  await expect(row).toBeAttached();
  await expect(row.locator('.options-value')).toHaveText('OFF');
});
