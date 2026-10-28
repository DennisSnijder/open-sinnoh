/**
 * The bundled platinum-demo mod in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop
 * and phone: turning it on in Options > DATA rebuilds the game with the mod (the starters swap, the Twinleaf
 * collector's line changes), turning it off brings vanilla back. Its own page, so a slow rebuild never
 * holds up the serial story tests of platinum.rom.spec.ts.
 *
 * The page never reloads mid-test: the dev server's HMR socket is cut for this context. A reload (vite's
 * full-reload after a dependency re-optimization, or its reconnect after a lost socket on a loaded machine)
 * reboots the app into a new game in the player's room, whose first ticks run the TV's on-frame script: the
 * collector check then read "That concludes our special program…" (the old flake; reproduced by reloading
 * between the load and the A press). The collector check also runs in one page call, and any page load
 * after the boot fails the test by name.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { openData } from './save.ts';
import { seedRomImport } from './seed.ts';
import { appStrings, fixedPart } from './words.ts';

test.describe.configure({ mode: 'serial' });

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];
/** Main-frame navigations after the boot (must stay 0). */
let reloads = 0;

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  // The vite client connects to a socket that never forwards to the server: no full-reload can reach the page.
  await context.routeWebSocket(/./, () => {});
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 120_000 });
  page.on('framenavigated', (frame) => frame === page.mainFrame() && reloads++);
});

test.afterAll(async () => {
  await context?.close();
});

test('the bundled platinum-demo mod: on swaps the starters and the collector line, off brings vanilla back', async () => {
  test.setTimeout(120_000);
  /**
   * A fresh game standing south of the Twinleaf collector: talk to it and return the first message page. One
   * page call from the reset to the message, so nothing else in the page runs in between.
   */
  const collectorLine = async (): Promise<string> => {
    const line = await page.evaluate(async () => {
      const game = window.openSinnohGame!;
      await game.reset(1);
      const state = game.snapshot().state;
      state.player = { zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN' as never, x: 108, z: 890, y: 0, facing: 'up' };
      state.objects = [];
      state.follower = null;
      await game.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state }), 'arrival');
      let idle = false;
      for (let i = 0; i < 3000 && !(idle = window.openSinnohApp!.game.canSave()); i++) game.advance(1);
      const where = () => `${game.snapshot().state.player.zone} ${game.snapshot().state.player.x},${game.snapshot().state.player.z}`;
      if (!idle) return { error: `the field never became idle (${where()})` };
      // The collector (it walks z 887–891) stands right in front after the fade, as the save placed it.
      const collector = game.snapshot().state.objects.find((o) => o.localId === 1);
      if (where() !== 'platinum:MAP_HEADER_TWINLEAF_TOWN 108,890' || collector?.x !== 108 || collector.z !== 889) return { error: `not facing the collector: player ${where()}, collector ${JSON.stringify(collector)}` };
      game.press('a');
      game.advance(1);
      game.release('a');
      // Tick by tick in one call (a frame-per-tick poll took most of this test on software GL).
      for (let i = 0; i < 3000; i++) {
        const message = game.snapshot().view.message;
        if (message?.waitingForInput) return { text: message.text };
        game.advance(1);
      }
      return { error: `the collector does not speak (${where()})` };
    });
    expect(reloads, 'the page reloaded mid-test').toBe(0);
    expect(line.error).toBeUndefined();
    return line.text!.replace(/\s+/g, ' ');
  };
  const starterSlots = () =>
    page.evaluate(() => ['platinum:SPECIES_CHIMCHAR', 'platinum:SPECIES_PIPLUP'].map((id) => window.openSinnohApp!.game.registries.species.get(id as never)?.starterSlot));
  const loadOrder = () => page.evaluate(() => window.openSinnohApp!.game.loadOrder.map((p) => p.id));
  const vanillaStart = registries.texts.get('platinum:TwinleafTown_Text_TechnologyBlowsMeAway' as never)!.text.split(/\s+/).slice(0, 3).join(' ');
  const toggle = async (on: boolean) => {
    // The start menu opens on an idle field: finish what the last step left on screen (the collector's message).
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
    });
    await openData(page);
    const row = page.locator('[data-setting="mod/platinum-demo"] .options-value');
    // The list fills once the app has asked for its mods (slow under load as well).
    const words = appStrings();
    await expect(row).toHaveText(on ? words.options.off : words.options.on, { timeout: 60_000 });
    await row.click();
    await page.evaluate(() => window.openSinnohGame!.advance(2));
    // The confirm dialog's YES.
    await page.locator('[data-tap="settings:answer:yes"]').click();
    await page.evaluate(() => window.openSinnohGame!.advance(2));
    // The toggle rebuilds the game from the whole ROM pack and mounts the field renderer twice (the new game,
    // then the last save): 4–11 s on a loaded machine with software GL, past the 5 s default.
    await expect(page.locator('.ui-notice').last()).toContainText(fixedPart((name, result) => words.game.modToggled(on, name, result)), { timeout: 60_000 });
  };

  expect(await starterSlots()).toEqual([1, 2]);
  expect(await collectorLine()).toContain(vanillaStart);

  await toggle(true);
  expect(await loadOrder()).toEqual(['platinum', 'platinum-demo']);
  expect(await starterSlots()).toEqual([2, 1]);
  expect(await collectorLine()).toContain('A lantern glows over Lake Verity');

  await toggle(false);
  expect(await loadOrder()).toEqual(['platinum']);
  expect(await starterSlots()).toEqual([1, 2]);
  expect(await collectorLine()).toContain(vanillaStart);
  expect(reloads, 'the page reloaded mid-test').toBe(0);
  expect(errors).toEqual([]);
});

