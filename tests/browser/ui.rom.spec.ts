/**
 * In-game UI on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): the start menu, bag pockets and
 * Pokétch app names are the ROM's own text-bank strings, read through the imported text records.
 * Screenshots go to test-artifacts/ui-rom (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Id } from '@opensinnoh/core';
import { setupPokemon, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/ui-rom';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;

const text = (name: string, slots: string[] = []) => plainText(registries.texts.get(`platinum:${name}` as Id)!.text, slots);

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test('start menu, bag and Pokétch labels come from the ROM text banks', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  // The import itself is platinum.rom.spec.ts's; here the browser starts with it.
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  // Play through the bedroom opening (A on every message and YES on every question) until the field is idle.
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
  const state = await page.evaluate(() => window.openSinnohApp!.game.state);
  const piplup = setupPokemon(state, registries, 0, 'platinum:SPECIES_PIPLUP' as Id, 5);
  await page.evaluate((piplup) => {
    const s = window.openSinnohApp!.game.state;
    s.party.push(piplup);
    s.bag.medicine!.push({ item: 'platinum:ITEM_POTION' as never, count: 2 });
    s.pokedex.obtained = true;
    Object.assign(s.poketch, { enabled: true, apps: ['platinum:POKETCH_APPID_DIGITALWATCH', 'platinum:POKETCH_APPID_PARTYSTATUS'] as never, current: ['platinum:POKETCH_APPID_DIGITALWATCH', 'platinum:POKETCH_APPID_PARTYSTATUS'][0] });
  }, piplup);

  // The menus run in the game: each input takes a tick through the bridge.
  const tick = () => page.evaluate(() => window.openSinnohGame!.advance(1));
  await page.evaluate(() => window.openSinnohApp!.ui.openStartMenu());
  await tick();
  const menu = page.locator('[data-screen="start-menu"]');
  const player = await page.evaluate(() => window.openSinnohApp!.game.state.names.player);
  await expect(menu.getByRole('button')).toHaveText(
    ['StartMenu_Text_Pokedex', 'StartMenu_Text_Pokemon', 'StartMenu_Text_Bag', 'StartMenu_Text_PlayerTemplate', 'StartMenu_Text_Save', 'StartMenu_Text_Options', 'StartMenu_Text_Exit'].map((n) =>
      text(n, [player]),
    ),
  );
  // The ROM's icons (one painted per entry, the cursor's wiggling) and cursor sprite (start_menu.c), DS-size rows
  // (24 DS px), each icon and the cursor on their row, nothing of our stand-ins.
  const measureStart = () =>
    menu.evaluate((root) => {
      const painted = (c: HTMLCanvasElement | null) => !!c && c.width > 0 && c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
      const dot = parseFloat(getComputedStyle(root).getPropertyValue('--dot'));
      return {
        dot,
        rows: [...root.querySelectorAll<HTMLElement>('.start-entry')].map((e) => {
          const r = e.getBoundingClientRect();
          const icon = e.querySelector<HTMLElement>('.start-icon');
          const ir = icon?.getBoundingClientRect();
          return { at: e.classList.contains('is-cursor'), height: r.height, icon: painted(icon?.querySelector('canvas') ?? null), iconMid: ir ? ir.top + ir.height / 2 - r.top : null, cursor: painted(e.querySelector('.start-cursor canvas')), wiggles: icon?.getAnimations().length ?? 0 };
        }),
        standIns: root.querySelectorAll('.ui-icon').length,
      };
    });
  await expect.poll(async () => (await measureStart()).rows.every((r) => r.icon), { timeout: 10_000 }).toBe(true);
  const start = await measureStart();
  expect(start.standIns).toBe(0);
  expect(start.rows.filter((r) => r.at)).toHaveLength(1);
  for (const [i, r] of start.rows.entries()) {
    expect.soft(Math.abs(r.height - 24 * start.dot), `entry ${i}: a 24-px DS row`).toBeLessThan(0.5);
    expect.soft(Math.abs(r.iconMid! - 12 * start.dot), `entry ${i}: icon centred on its row`).toBeLessThan(0.5);
    expect.soft(r.cursor, `entry ${i}: cursor sprite`).toBe(r.at);
    expect.soft(r.wiggles, `entry ${i}: wiggle`).toBe(r.at ? 1 : 0);
  }
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-start-menu.png` });

  await menu.locator('[data-entry="bag"]').click();
  await tick();
  const bag = page.locator('[data-screen="bag"]');
  await expect(bag.getByRole('tab')).toHaveText(Array.from({ length: 8 }, (_, i) => text(`pl_msg_00000395_0000${i}`)));
  await bag.getByRole('tab', { name: text('pl_msg_00000395_00001') }).click();
  await tick();
  await expect(bag.locator('.item-row').first()).toContainText(registries.items.get('platinum:ITEM_POTION' as Id)!.name);
  await page.screenshot({ path: `${SHOTS}/${project}-bag.png` });
  await page.keyboard.press('Escape');
  await tick();
  await page.keyboard.press('Escape');
  await tick();
  expect(await page.evaluate(() => window.openSinnohApp!.ui.state.menu)).toBeNull();

  await page.keyboard.press('KeyP');
  await expect(page.locator('.poketch').getByRole('img')).toHaveAccessibleName(`${text('pl_msg_00000457_00000')} 12:00`);
  await page.evaluate(() => window.openSinnohGame!.advance(5));
  await page.locator('.poketch').locator('.poketch-side.next').click();
  // Closes, waits and opens on the next app: 12 ticks.
  await page.evaluate(() => window.openSinnohGame!.advance(14));
  await expect(page.locator('.poketch').getByRole('img')).toHaveAccessibleName(text('pl_msg_00000457_00004'));
  await page.screenshot({ path: `${SHOTS}/${project}-poketch.png` });
});
