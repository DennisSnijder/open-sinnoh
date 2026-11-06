/**
 * The mart by keyboard alone (OPENSINNOH_NDS_ROM; desktop): Space, Enter (the browser's own keys on the focused
 * control) and Z (the game's A) each go BUY → the first item → a count of 2 → YES. The count window holds the focus,
 * so the list behind it cannot take the confirm (focus.ts `isolatePrompt`).
 */
import { expect, test } from '@playwright/test';
import { romContext, resetRomDevice } from './rom-context.ts';
import { saveSlot } from './save.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

for (const key of ['Enter', 'Space', 'KeyZ'])
  test(`the mart's count and YES confirm with ${key}`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'keyboard only');
    test.setTimeout(240_000);
    const context = await romContext(browser, info.project.use);
    const page = await context.newPage();
    await resetRomDevice(page);
    // A save at the Jubilife Mart's counter, written on the replay bridge.
    await page.goto('/?replay');
    await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
    await page.evaluate(async () => {
      const g = window.openSinnohGame!;
      const state = g.snapshot().state;
      state.player = { ...state.player, zone: 'platinum:MAP_HEADER_JUBILIFE_CITY_MART' as typeof state.player.zone, x: 3, z: 7, y: 0, facing: 'up' };
      state.objects = [];
      state.follower = null;
      state.partyFollower = null;
      state.money = 5000;
      state.bag.balls = [];
      await g.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }), 'arrival');
      g.advance(120);
    });
    await saveSlot(page);
    await page.goto('/?continue&time=12:00');
    await page.waitForFunction(() => !!window.openSinnohApp && !document.querySelector('.at-title') && window.openSinnohApp.loop.ticks > 60, undefined, { timeout: 60_000 });
    type Mart = { app: string; mode?: string; quantity?: { count: string } | null; yesNo?: object | null };
    const mart = () => page.evaluate(() => window.openSinnohApp!.game.app() as unknown as Mart | null);
    // Talk to the clerk (the game's A) while the field is idle (a loaded machine can drop a press made as the field
    // settles), and A on any field message before the mart's BUY / SELL menu (one press too many would already pick BUY).
    await expect.poll(async () => {
      const m = await mart();
      if (m) return m.mode;
      if (await page.evaluate(() => window.openSinnohApp!.game.canSave() || window.openSinnohApp!.game.scripts.view().message?.waitingForInput === true)) await page.keyboard.press('KeyZ');
      return null;
    }, { timeout: 30_000 }).toBe('menu');
    await page.keyboard.press(key);
    await expect.poll(async () => (await mart())?.mode).toBe('buy');
    await page.keyboard.press(key);
    await expect.poll(async () => !!(await mart())?.quantity).toBe(true);
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await mart())?.quantity?.count).toContain('02');
    await page.keyboard.press(key);
    await expect.poll(async () => !!(await mart())?.yesNo).toBe(true);
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.bag.balls?.find((s) => s.item === 'platinum:ITEM_POKE_BALL')?.count ?? 0)).toBe(2);
    await page.close();
  });
