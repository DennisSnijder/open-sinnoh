/**
 * In-game UI on the fixture pack, at desktop (1280×720) and phone (390×844) sizes: the start menu by
 * key and by touch, navigation, the bag, party, trainer card, options and save, and the Pokétch card.
 * Labels come from the fixture's own original text records. Screenshots go to test-artifacts/ui.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readPackFolder, type BagSlot, type Id, type Pokemon } from '@opensinnoh/core';
import { setupPokemon, type GameState } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';

import { settle } from './settle.ts';

const SHOTS = 'test-artifacts/ui';
const fixtureRoot = join(import.meta.dirname, '../../packs/fixture');
const registries = loadGamePacks([readPackFolder((p) => (existsSync(join(fixtureRoot, p)) ? readFileSync(join(fixtureRoot, p), 'utf8') : undefined), 'packs/fixture')]).registries;

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  // Play through the intro message, then wait until the field is idle.
  const ok = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 600; i++) {
      const s = g.snapshot();
      const introDone = window.openSinnohApp!.game.state.vars['fixture:VAR_ROOM_INTRO' as never] === 1;
      if (introDone && !s.scriptRunning && window.openSinnohApp!.game.canSave()) return true;
      if (s.view.message?.waitingForInput) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    return false;
  });
  expect(ok).toBe(true);
  // Data the fixture's opening does not give yet: a party (real Pokémon, made here), items, badges and the Pokétch.
  const state = await page.evaluate(() => window.openSinnohApp!.game.state);
  const party: Pokemon[] = (
    [
      ['SPECIES_EMBERKIT', 7],
      ['SPECIES_SKYLET', 4],
      ['SPECIES_DRIPLING', 5],
    ] as const
  ).map(([sp, level], i) => setupPokemon(state as GameState, registries, i, `fixture:${sp}` as Id, level));
  const bag: Record<string, BagSlot[]> = { items: [{ item: 'fixture:ITEM_LAMP_OIL', count: 3 }], medicine: [{ item: 'fixture:ITEM_TONIC', count: 2 }], key_items: [{ item: 'fixture:ITEM_TOWN_GUIDE', count: 1 }] };
  await page.evaluate(({ party, bag }) => {
    const s = window.openSinnohApp!.game.state;
    s.party.push(...party);
    Object.assign(s.bag, bag);
    s.badges.push('fixture:BADGE_ID_COAL' as never);
    s.pokedex.obtained = true;
    Object.assign(s.poketch, { enabled: true, apps: ['fixture:POKETCH_APPID_DIGITALWATCH', 'fixture:POKETCH_APPID_CALCULATOR', 'fixture:POKETCH_APPID_PARTYSTATUS'] as never, current: ['fixture:POKETCH_APPID_DIGITALWATCH', 'fixture:POKETCH_APPID_CALCULATOR', 'fixture:POKETCH_APPID_PARTYSTATUS'][0] });
  }, { party, bag });
  return errors;
}

const advance = (page: Page, n = 1) => page.evaluate((k) => window.openSinnohGame!.advance(k), n);
const uiState = (page: Page) => page.evaluate(() => window.openSinnohApp!.ui.state);

/** A physical key, held for one tick (keys go through the same InputFrame as the field). */
async function key(page: Page, code: string): Promise<void> {
  await page.keyboard.down(code);
  await advance(page);
  await page.keyboard.up(code);
  await advance(page);
}

/** A tap or click (sent to the game as `InputFrame.tap`), then one tick so the game takes it. */
async function press(page: Page, target: Locator, touch: boolean): Promise<void> {
  if (touch) await target.tap();
  else await target.click();
  await advance(page);
}

async function shot(page: Page, project: string, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
}

test('start menu: key and touch, bag, party, trainer card, options, save', async ({ page }, info) => {
  // Every input is a tick through the bridge (the menus run in the game): a long test.
  test.setTimeout(120_000);
  const touch = info.project.name === 'phone';
  const errors = await open(page);
  const project = info.project.name;
  const menu = page.locator('[data-screen="start-menu"]');

  // By key: Start (Enter) opens; the field does not step under it (the d-pad moves the cursor); B (X key) closes.
  const before = await page.evaluate(() => window.openSinnohApp!.game.state.player);
  await key(page, 'Enter');
  await expect(menu).toBeVisible();
  expect((await uiState(page)).menu).toBe('start-menu');
  await key(page, 'ArrowDown');
  await key(page, 'ArrowUp');
  await advance(page, 10);
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player)).toEqual(before);
  await expect(menu.getByRole('button')).toHaveText(['FIELD LOG', 'COMPANIONS', 'PACK', 'Ari', 'RECORD', 'SETTINGS', 'CLOSE']);
  await shot(page, project, 'start-menu');
  await key(page, 'KeyX');
  await expect(menu).toBeHidden();
  expect((await uiState(page)).menu).toBeNull();

  // X (C key) opens too; the cursor starts on PACK and moves with the d-pad.
  await key(page, 'KeyC');
  await expect(menu.locator('.is-cursor')).toHaveText('PACK');
  await key(page, 'ArrowDown');
  await expect(menu.locator('.is-cursor')).toHaveText('Ari');
  await key(page, 'ArrowUp');
  await key(page, 'ArrowUp');
  await expect(menu.locator('.is-cursor')).toHaveText('COMPANIONS');
  await key(page, 'KeyZ');
  const party = page.locator('[data-screen="party"]');
  await expect(party).toBeVisible();
  await expect(party.locator('.party-slot[data-species]')).toHaveCount(3);
  await expect(party.locator('.party-slot').first()).toContainText('Emberkit');
  await expect(party.locator('.party-slot').first()).toContainText('7');
  await shot(page, project, 'party');
  await key(page, 'KeyX');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.is-cursor')).toHaveText('COMPANIONS');
  await key(page, 'KeyX');

  // By touch / pointer: the on-screen menu button, then PACK.
  await press(page, page.getByRole('button', { name: 'Start menu' }), touch);
  await expect(menu).toBeVisible();
  await press(page, menu.getByRole('button', { name: 'PACK' }), touch);
  const bag = page.locator('[data-screen="bag"]');
  await expect(bag).toBeVisible();
  await expect(bag.locator('.item-row')).toHaveText(['Lamp Oilx3', 'CLOSE PACK']);
  await shot(page, project, 'bag');
  await key(page, 'ArrowRight');
  await expect(bag.locator('.pocket-name')).toHaveText('TONICS');
  await expect(bag.locator('.item-row')).toHaveText(['Tonicx2', 'CLOSE PACK']);
  await press(page, bag.getByRole('tab', { name: 'KEEPSAKES' }), touch);
  await expect(bag.locator('.item-row')).toHaveText(['Town Guide', 'CLOSE PACK']);
  await shot(page, project, 'bag-key-items');
  await press(page, bag.getByRole('button', { name: 'CLOSE PACK', exact: true }), touch);
  await expect(menu).toBeVisible();

  // Trainer card.
  await press(page, menu.getByRole('button', { name: 'Ari' }), touch);
  const card = page.locator('[data-screen="trainer-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.card-row')).toHaveText([/^ID\d{5}$/, 'NAMEAri', 'COINS3000c', 'LOG0', 'SCORE0', /^TIME0:0\d$/, /^SET OUT/]);
  await expect(card.locator('.badge-slot.got')).toHaveCount(1);
  await shot(page, project, 'trainer-card');
  await press(page, card.locator('[data-tap="done"]'), touch);

  // Options (OpenSinnoh's own screen, a page per section): left/right change the value under the cursor; stored on the device.
  await press(page, menu.getByRole('button', { name: 'SETTINGS' }), touch);
  const options = page.locator('[data-screen="options"]');
  await expect(options).toBeVisible();
  await key(page, 'ArrowRight');
  await expect(options.locator('[data-setting="textSpeed"] .options-value.on')).toHaveText('BRISK');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options')!).textSpeed)).toBe(2);
  // Text speed applies to the game (fast); replay mode starts at the default (mid).
  expect(await page.evaluate(() => window.openSinnohApp!.game.textSpeed)).toBe(2);
  // Sound: MONO is stored and applied (the synth mixes to mono), not logged as unapplied.
  await key(page, 'ArrowDown');
  await key(page, 'ArrowRight');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options')!).sound)).toBe(1);
  expect(await page.evaluate(() => window.openSinnohApp!.game.log.counts.get('ui:option-sound'))).toBeUndefined();
  // Volume and mute: the app's own settings on the DEVICE page, stored on the device.
  await press(page, options.locator('[data-section="device"]'), touch);
  await expect(options.getByRole('slider', { name: 'VOLUME' })).toHaveAttribute('aria-valuenow', '80');
  await press(page, options.locator('[data-setting="mute"]').getByRole('switch'), touch);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:audio')!))).toEqual({ volume: 80, muted: true });
  await expect(options.locator('[data-setting="mute"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await shot(page, project, 'options');
  await key(page, 'KeyX');

  // The Pokédex (field log): nothing seen yet, the counters at zero.
  await press(page, menu.getByRole('button', { name: 'FIELD LOG' }), touch);
  await expect(page.locator('[data-screen="pokedex"].dex-list-sheet')).toBeVisible();
  await expect(page.locator('.dex-list-head')).toHaveText(/SPOTTED\s*0\s*LOGGED\s*0/);
  await key(page, 'KeyX');

  // Save: YES writes the app's save slot.
  await press(page, menu.getByRole('button', { name: 'RECORD' }), touch);
  const save = page.locator('[data-screen="save"]');
  await expect(save).toContainText('Write your journey into the record?');
  await shot(page, project, 'save');
  await press(page, save.getByRole('button', { name: 'YES' }), touch);
  await expect(save).toContainText('Ari wrote the record.');
  await key(page, 'KeyZ');
  expect((await uiState(page)).menu).toBeNull();

  // Closed: the field ticks again.
  const t = await page.evaluate(() => window.openSinnohApp!.game.state.tick);
  await advance(page, 5);
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.tick)).toBe(t + 5);
  expect(errors).toEqual([]);
});

test('the menu opens only while the field is idle', async ({ page }) => {
  await open(page);
  // Walk until the world is mid-step (busy); Start is ignored there.
  const busy = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('down');
    for (let i = 0; i < 30; i++) {
      g.advance(1);
      if (!window.openSinnohApp!.game.canSave()) return true;
    }
    return false;
  });
  expect(busy).toBe(true);
  await page.evaluate(() => window.openSinnohGame!.press('start'));
  await advance(page);
  expect((await uiState(page)).menu).toBeNull();
  await page.evaluate(() => {
    window.openSinnohGame!.release('start');
    window.openSinnohGame!.release('down');
  });
});

test('Pokétch: P and the button open it, the side button switches apps, field input leaves it open', async ({ page }, info) => {
  const touch = info.project.name === 'phone';
  const errors = await open(page);
  const card = page.locator('.poketch');
  await expect(card).toBeHidden();
  await page.keyboard.press('KeyP');
  await expect(card).toBeVisible();
  await expect(card.getByRole('img')).toHaveAccessibleName('CLOCK 12:00');
  // The screen opens over 4 ticks; the side button is ignored meanwhile (decomp appStarting).
  await advance(page, 4);
  await shot(page, info.project.name, 'poketch-watch');

  await press(page, card.getByRole('button', { name: 'Next app' }), touch);
  // The screen closes (5 ticks), waits (3) and opens on the next app (4), as on the DS.
  await advance(page, 12);
  await expect(card).toHaveAttribute('data-app', 'fixture:POKETCH_APPID_CALCULATOR');
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.poketch.current)).toBe('fixture:POKETCH_APPID_CALCULATOR');
  await expect(card.getByRole('img')).toHaveAccessibleName('SUMS');
  await shot(page, info.project.name, 'poketch-app');
  await key(page, 'KeyE'); // R: next
  await advance(page, 12);
  await expect(card).toHaveAttribute('data-app', 'fixture:POKETCH_APPID_PARTYSTATUS');

  // Not modal: field input reaches the field and the card stays (the pedometer counts as you walk); P closes it.
  await key(page, 'KeyZ');
  await expect(card).toBeVisible();
  await page.keyboard.press('KeyP');
  await expect(card).toBeHidden();

  await press(page, page.getByRole('button', { name: 'Watch' }), touch);
  await expect(card).toBeVisible();
  await press(page, card.getByRole('button', { name: 'Close watch' }), touch);
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

test('unreadable stored options are reset and reported in OPTIONS', async ({ page }, info) => {
  const touch = info.project.name === 'phone';
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('lantern-nds:options', '{"textSpeed": 2,');
      sessionStorage.setItem('seeded', '1');
    }
  });
  // The notice lasts eight seconds: observe it at startup while the replay setup runs, before menu navigation.
  const [errors] = await Promise.all([
    open(page),
    expect(page.locator('.ui-notice')).toContainText('could not be read', { timeout: 60_000 }),
  ]);
  // The player's defaults: the DS's, with the OpenSinnoh additions (auto-run on touch screens only).
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options')!))).toEqual({
    textSpeed: 1, sound: 0, battleScene: 0, battleStyle: 0, buttonMode: 0, frame: 0, tradeEvolution: 0, followers: 0, followerStyle: 0, autoLowercase: 0,
    autoRun: touch ? 0 : 1, repelPrompt: 0, itemWheel: 0, followerTalk: 0, statView: 1, summaryRename: 1, dexNameSearch: 0, character: 0, spiritombVendors: 1, objective: 0,
  });
  expect(await page.evaluate(() => window.openSinnohApp!.game.log.counts.get('ui:options-reset'))).toBe(1);
  await key(page, 'Enter');
  await press(page, page.locator('[data-screen="start-menu"]').getByRole('button', { name: 'SETTINGS' }), touch);
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('landscape watch keeps its keypad and side buttons clear of the controls', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'requires touch controls');
  const errors = await open(page);
  await page.evaluate(() => window.openSinnohApp!.ui.togglePoketch());
  for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 600, height: 590 }]) {
    await page.setViewportSize(viewport);
    await settle(page);
    const overlaps = await page.evaluate(() => {
      const watch = document.querySelector('.poketch')!.getBoundingClientRect();
      const close = document.querySelector('.poketch-close')!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('.controls button, .hud-button')]
        .filter(e => e.getBoundingClientRect().width && !e.closest('[hidden]'))
        .filter(e => {
          const b = e.getBoundingClientRect();
          return [watch, close].some(a => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
        }).map(e => e.dataset.button ?? e.getAttribute('aria-label'));
    });
    expect(overlaps, `${viewport.width}×${viewport.height}`).toEqual([]);
    // The previously covered lower app button receives a real touch.
    await page.getByRole('button', { name: 'Next app', exact: true }).tap();
    await page.evaluate(() => window.openSinnohGame!.advance(15));
  }
  expect(errors).toEqual([]);
});
