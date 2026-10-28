/**
 * The start menus' sounds on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop: what the sound system
 * sends the synth, by sequence number. The title's first A/Start is the gesture that starts the AudioContext and
 * plays Giratina's cry (title_screen.c); the main menu plays SE_CONFIRM (1500) on a cursor move that moves, on a
 * choice and on B (main_menu.c); MYSTERY GIFT plays SEQ_PRESENT (1174) and SE_CONFIRM on its list
 * (mystery_gift_app.c), and its code keyboard the naming screen's sounds. Muted, the same requests reach the synth
 * and the output after the volume stays silent.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { press } from './intro.ts';
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
  test.skip(info.project.name !== 'desktop', 'the sounds do not depend on the layout');
  test.setTimeout(180_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  // A save with the Pokédex and Mystery Gift unlocked: the menu lists CONTINUE, NEW GAME, MYSTERY GIFT, OPTIONS.
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 3000 && !window.openSinnohApp!.game.canSave(); i++) {
      if (g.snapshot().view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    if (!window.openSinnohApp!.game.canSave()) throw new Error('the new game never reached an idle field');
    const state = window.openSinnohApp!.game.state;
    state.pokedex.obtained = true;
    state.mysteryGift = { unlocked: true, received: [], cards: [null, null, null], deliveries: [null, null, null, null, null, null, null, null] };
  });
  await saveSlot(page);
});

test.afterAll(async () => {
  await context?.close();
});

type Heard = { source: number; cry: boolean };

/** Records the sound system's starts from now on (sequence numbers; a cry starts with its own bank). */
async function record(): Promise<void> {
  await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    const output = game.sound.output!;
    const heard: { source: number; cry: boolean }[] = [];
    (window as unknown as { heard: typeof heard }).heard = heard;
    game.sound.output = {
      send(command) {
        if (command.op === 'start') heard.push({ source: game.registries.sequences.get(command.seq)!.sourceIndex!, cry: command.bank !== undefined });
        output.send(command);
      },
    };
  });
}

/** What was started since the last call. */
const heard = () =>
  page.evaluate(() => {
    const list = (window as unknown as { heard: Heard[] }).heard;
    return list.splice(0, list.length);
  });

/** The loudest RMS after the volume while `act` runs and for 600 ms after. */
async function peak(act: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const analyser = window.openSinnohApp!.audio.analyser;
    const buf = new Float32Array(analyser.fftSize);
    const local = window as unknown as { peak: number; peakTimer: number };
    local.peak = 0;
    local.peakTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      local.peak = Math.max(local.peak, Math.sqrt(sum / buf.length));
    }, 10);
  });
  await act();
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const local = window as unknown as { peak: number; peakTimer: number };
    clearInterval(local.peakTimer);
    return local.peak;
  });
}

async function atTitle(): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
}

const focused = () => page.evaluate(() => window.openSinnohTitle!.focused);
const SE_CONFIRM = 1500;
const SEQ_TITLE01 = 1173;
const SEQ_PRESENT = 1174;

test('the title: the first START starts the audio and plays the cry; the main menu: moves, choices and B', async () => {
  test.setTimeout(120_000);
  await page.goto('/?time=12:00');
  await atTitle();
  await record();
  // START is the first key press on this page (the gesture that resumes a suspended context); the cry follows on the next tick.
  await press(page, 'Enter');
  await page.waitForFunction(() => window.openSinnohApp!.audio.context.state === 'running', undefined, { timeout: 10_000 });
  expect((await heard()).map((h) => h.cry)).toEqual([true]);
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 30_000 });
  expect(await heard()).toEqual([]);

  // FocusNextOption: no sound at either end; one SE_CONFIRM for each move that moves.
  expect(await focused()).toBe('continue');
  await press(page, 'ArrowUp');
  expect(await heard()).toEqual([]);
  await press(page, 'ArrowDown');
  expect(await focused()).toBe('new-game');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  expect(await focused()).toBe('options');
  await press(page, 'ArrowDown');
  expect(await heard()).toEqual([{ source: SE_CONFIRM, cry: false }, { source: SE_CONFIRM, cry: false }, { source: SE_CONFIRM, cry: false }]);

  // A on OPTIONS confirms and opens the DS options screen; B there closes it.
  await press(page, 'Enter');
  const options = page.getByRole('dialog', { name: appStrings().title.options });
  await expect(options).toBeVisible();
  expect((await heard())[0]).toEqual({ source: SE_CONFIRM, cry: false });
  await press(page, 'KeyX');
  await expect(options).toHaveCount(0);
  await heard();

  // B: SE_CONFIRM, then the title's theme.
  await press(page, 'KeyX');
  await atTitle();
  expect(await heard()).toEqual([{ source: SE_CONFIRM, cry: false }, { source: SEQ_TITLE01, cry: false }]);
  expect(errors).toEqual([]);
});

test('MYSTERY GIFT: its music, list moves, choices and cancel', async () => {
  test.setTimeout(120_000);
  await page.goto('/?time=12:00');
  await atTitle();
  await press(page, 'Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 30_000 });
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  expect(await focused()).toBe('mystery-gift');
  await record();
  await press(page, 'Enter');
  const screen = page.getByRole('dialog', { name: appStrings().title.mysteryGift }).locator('.mystery-gift-screen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('[data-tap="menu:0"]')).toBeVisible();
  expect(await heard()).toEqual([{ source: SE_CONFIRM, cry: false }, { source: SEQ_PRESENT, cry: false }]);

  // The list (RECEIVE GIFT, EXIT): SE_CONFIRM on each move (MainMenuUtil_ListMenuCursorCB).
  await press(page, 'ArrowDown');
  await press(page, 'ArrowUp');
  expect(await heard()).toEqual([{ source: SE_CONFIRM, cry: false }, { source: SE_CONFIRM, cry: false }]);

  // RECEIVE GIFT confirms and opens the code keyboard (naming_screen.c): a move confirms, a typed key SEQ_SE_DP_BOX02,
  // OK SEQ_SE_DP_PIRORIRO.
  await press(page, 'KeyZ');
  const naming = page.locator('[data-screen="naming"]');
  await expect(naming).toBeVisible();
  await press(page, 'ArrowDown');
  await press(page, 'KeyQ');
  await naming.locator('[data-tap="ok"]').click();
  await expect(naming).toHaveCount(0);
  expect((await heard()).map((h) => h.source)).toEqual([SE_CONFIRM, SE_CONFIRM, 1515, 1506]);
  // No gift for the code: SE_CONFIRM as the message shows, and as A dismisses it.
  await expect.poll(async () => (await heard()).map((h) => h.source), { timeout: 10_000 }).toEqual([SE_CONFIRM]);
  await press(page, 'KeyZ');
  await expect(screen.locator('[data-tap="menu:0"]')).toBeVisible();
  expect(await heard()).toEqual([{ source: SE_CONFIRM, cry: false }]);

  // B leaves: SE_CONFIRM, then the title's theme (the DS returns to the title).
  await press(page, 'KeyX');
  await atTitle();
  expect(await heard()).toEqual([{ source: SE_CONFIRM, cry: false }, { source: SEQ_TITLE01, cry: false }]);
  expect(errors).toEqual([]);
});

test('sound off: the menu requests the same sounds and the output stays silent', async () => {
  test.setTimeout(120_000);
  await page.goto('/?time=12:00');
  await atTitle();
  await press(page, 'Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 30_000 });
  await page.waitForFunction(() => !window.openSinnohApp!.game.sound.cryPlaying());
  await record();
  // Heard at the volume set.
  const loud = await peak(async () => {
    await press(page, 'ArrowDown');
    await press(page, 'ArrowUp');
  });
  expect(loud).toBeGreaterThan(0.001);
  await page.evaluate(() => window.openSinnohApp!.audio.setSettings({ volume: 80, muted: true }));
  await page.waitForTimeout(200);
  const muted = await peak(async () => {
    await press(page, 'ArrowDown');
    await press(page, 'ArrowUp');
  });
  expect(muted).toBe(0);
  expect((await heard()).map((h) => h.source)).toEqual([SE_CONFIRM, SE_CONFIRM, SE_CONFIRM, SE_CONFIRM]);
  await page.evaluate(() => window.openSinnohApp!.audio.setSettings({ volume: 80, muted: false }));
  expect(await page.evaluate(() => window.openSinnohApp!.audio.errors)).toEqual([]);
  expect(errors).toEqual([]);
});
