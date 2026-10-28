/**
 * Mystery Gift from the title on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone: a save with
 * Mystery Gift unlocked and the Pokédex shows MYSTERY GIFT on the main menu (the ROM's label); its screen (the ROM's
 * font, frames and messages on one board) asks for a gift code on the naming keyboard (typed on desktop, tapped on
 * the phone; a test-only code, `openSinnohTitle.allowTestGiftCodes`). A wrong code is refused; the right one shows the
 * Wonder Card, YES receives it, and the DS returns to the title with the save written.
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { MYSTERY_GIFT_TEXT } from '@opensinnoh/contracts';
import { forLanguage } from '@opensinnoh/core';
import { loadGamePacks } from '@opensinnoh/game';
import { GIFT_CODE_PROMPT } from '@opensinnoh/menus';
import { gameLanguage } from '@opensinnoh/services';
import { romSlice } from '../rom.ts';
import { saveSlot } from './save.ts';
import { seedRomImport } from './seed.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];
/** The gift code prompt and the Member Card's title in the game's language. */
let giftCode: string;
let memberCard: string;

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'desktop and phone');
  test.setTimeout(180_000);
  const language = gameLanguage(loadGamePacks([romSlice().pack]).registries);
  giftCode = forLanguage(language, GIFT_CODE_PROMPT);
  memberCard = forLanguage(language, MYSTERY_GIFT_TEXT).darkrai.title;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  // A save with the Pokédex and Mystery Gift unlocked (the questionnaire's flag): the replay bridge's new game.
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

/** The saved game's Mystery Gift block (the app's save slot holds the save's JSON text). */
const savedGift = () =>
  page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get('main');
          get.onsuccess = () => resolve((JSON.parse(get.result as string) as { state: { mysteryGift?: unknown } }).state.mysteryGift);
          get.onerror = () => reject(get.error);
        };
      }),
  );

async function toMenu(): Promise<void> {
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
  await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
  await page.locator('#title').click();
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
}

/** The board fits the viewport, whole. */
async function fits(board: Locator): Promise<void> {
  const box = (await board.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
}

/** UPPER page keys (services keyboardPages, English) for the phone's taps. */
const KEYS: Record<string, string> = { A: 'key:0:0', D: 'key:0:3', E: 'key:0:4', K: 'key:1:0', Q: 'key:1:6', R: 'key:1:7', S: 'key:1:8', T: 'key:1:9' };

async function enterCode(code: string, touch: boolean): Promise<void> {
  const naming = page.locator('[data-screen="naming"]');
  await expect(naming).toBeVisible();
  await expect(naming).toContainText(giftCode);
  await fits(naming);
  if (touch) for (const t of [...[...code].map((c) => KEYS[c]!), 'ok']) await naming.locator(`[data-tap="${t}"]`).click();
  else {
    await page.keyboard.type(code.toLowerCase());
    await page.keyboard.press('Enter');
  }
  await expect(naming).toHaveCount(0);
}

test('MYSTERY GIFT: a wrong code refused, a gift code received into the save', async () => {
  test.setTimeout(240_000);
  const touch = test.info().project.name === 'phone';
  await page.goto('/?time=12:00');
  await toMenu();
  await page.evaluate(() => window.openSinnohTitle!.allowTestGiftCodes());
  const entry = page.locator('.tm-mystery-gift');
  await expect(entry).toBeVisible();
  await entry.click();
  const dialog = page.getByRole('dialog', { name: appStrings().title.mysteryGift });
  const screen = dialog.locator('.mystery-gift-screen');
  await expect(screen).toBeVisible();
  await fits(screen);
  await expect(screen.locator('[data-tap="menu:0"]')).toBeVisible();

  // A wrong code: no gift found, back to the menu.
  await screen.locator('[data-tap="menu:0"]').click();
  await enterCode('QQQQQQQQ', touch);
  await expect(dialog.locator('.msg-box.waiting')).toBeVisible({ timeout: 10_000 });
  await dialog.locator('.msg-box.waiting').click();
  await expect(dialog.locator('[data-tap="menu:0"]')).toBeVisible();

  // The Member Card's test code: the card, YES, received.
  await dialog.locator('[data-tap="menu:0"]').click();
  await enterCode('TESTDARK', touch);
  const card = dialog.locator(`[data-card="${memberCard}"]`);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await fits(dialog.locator('.mystery-gift-screen'));
  await dialog.locator('[data-tap="yes"]').click();
  // "The gift has been received!", then "Please pick up your gift…": two pages.
  const received = dialog.locator('.msg-box.waiting');
  await expect(received).toBeVisible({ timeout: 15_000 });
  await received.click();
  await expect(received).toBeVisible();
  await received.click();
  // The DS returns to the title, the save written.
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 30_000 });
  expect(await savedGift()).toEqual({ unlocked: true, received: ['darkrai'], cards: [{ gift: 'darkrai', received: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }, null, null], deliveries: [{ gift: 'darkrai', card: 0 }, null, null, null, null, null, null, null] });
  expect(errors).toEqual([]);
});
