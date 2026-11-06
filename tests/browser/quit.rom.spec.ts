/**
 * The start menu's EXIT goes back to the title (OPENSINNOH_NDS_ROM; desktop): it asks first (NO stays in the game),
 * then the DS's save question. NO leaves the save as it was and no suspend point; YES saves. Either way the page
 * lands on the title, without the installed app's `?continue`.
 */
import { expect, test, type Page } from '@playwright/test';
import { romContext, resetRomDevice } from './rom-context.ts';
import { saveSlot } from './save.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

/** A slot of the save database (`main` or `suspend`), as text. */
const slot = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      new Promise<string | undefined>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get(key);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result as string | undefined);
          };
        };
      }),
    key,
  );
const ticksOf = (json: string | undefined) => (json === undefined ? null : (JSON.parse(json) as { state: { tick: number } }).state.tick);

test('EXIT goes to the title, offering to save first', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'the flow is the same everywhere');
  test.setTimeout(240_000);
  const context = await romContext(browser, info.project.use);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await resetRomDevice(page);
  // A save in Twinleaf Town, written on the replay bridge.
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const g = window.openSinnohGame!;
    const state = g.snapshot().state;
    state.player = { ...state.player, zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN' as typeof state.player.zone, x: 116, z: 886, y: 0, facing: 'down' };
    state.objects = [];
    state.follower = null;
    state.partyFollower = null;
    await g.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }), 'arrival');
    g.advance(120);
  });
  await saveSlot(page);
  const saved = ticksOf(await slot(page, 'main'))!;

  const play = async () => {
    await page.goto('/?continue&time=12:00');
    await page.waitForFunction(() => !!window.openSinnohApp && !document.querySelector('.at-title') && window.openSinnohApp.loop.ticks > 60, undefined, { timeout: 60_000 });
  };
  const exit = async () => {
    await page.keyboard.press('KeyC');
    await page.locator('[data-screen="start-menu"] [data-entry="exit"]').click();
    await expect(page.locator('[data-screen="save"]')).toBeVisible();
  };
  const atTitle = async () => {
    await page.waitForURL((u) => !u.searchParams.has('continue'), { timeout: 60_000 });
    await page.waitForFunction(() => window.openSinnohTitle !== undefined, undefined, { timeout: 60_000 });
  };

  // NO: the start menu again, the game goes on.
  await play();
  await exit();
  await page.locator('[data-screen="save"] [data-tap="no"]').click();
  await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
  await page.keyboard.press('KeyX');
  await expect(page.locator('[data-screen]')).toHaveCount(0);

  // YES, then NO to saving: the title; the save as it was, no suspend point.
  await exit();
  await page.locator('[data-screen="save"] [data-tap="yes"]').click();
  await page.locator('[data-screen="save"] [data-tap="no"]').click();
  await atTitle();
  expect(ticksOf(await slot(page, 'main'))).toBe(saved);
  expect(await slot(page, 'suspend')).toBeUndefined();

  // YES, then YES: saved (the play since the load), then the title.
  await play();
  await exit();
  await page.locator('[data-screen="save"] [data-tap="yes"]').click();
  await page.locator('[data-screen="save"] [data-tap="yes"]').click();
  await page.locator('[data-screen="save"] [data-tap="ok"]').click();
  await atTitle();
  expect(ticksOf(await slot(page, 'main'))).toBeGreaterThan(saved);
  expect(await slot(page, 'suspend')).toBeUndefined();
  expect(errors).toEqual([]);
  await context.close();
});
