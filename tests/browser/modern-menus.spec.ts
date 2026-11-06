/**
 * The Modern menus on the fixture pack, desktop and phone: MENUS (Options › DEVICE) defaults to Original and draws the
 * original screens; Modern draws the party and the bag in the design system, from the same app views, with the same
 * taps and cursor. The screen fills the room, targets are big enough, and `?replay` keeps the original drawing.
 * Screenshots go to test-artifacts/modern-menus.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { setupPokemon, type GameState } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { skipSetup } from './intro.ts';
import { settle } from './settle.ts';

const SHOTS = 'test-artifacts/modern-menus';
const fixtureRoot = join(import.meta.dirname, '../../packs/fixture');
const registries = loadGamePacks([readPackFolder((p) => (existsSync(join(fixtureRoot, p)) ? readFileSync(join(fixtureRoot, p), 'utf8') : undefined), 'packs/fixture')]).registries;

const party = (page: Page) => page.locator('[data-screen="party"]');
const bag = (page: Page) => page.locator('[data-screen="bag"]');
const menu = (page: Page) => page.locator('[data-screen="start-menu"]');
const app = (page: Page) => page.evaluate(() => window.openSinnohApp!.game.app());

/** The game on its idle field, with a party and items (wall clock: `?replay` keeps the original menus). */
async function toField(page: Page, query = ''): Promise<void> {
  await page.goto(`/?packs=fixture${query}`);
  if (query.includes('replay')) {
    // The bridge: no wall clock, so the intro's message is played through by hand.
    await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const g = window.openSinnohGame!;
      for (let i = 0; i < 600 && !(window.openSinnohApp!.game.canSave() && !g.snapshot().scriptRunning); i++) {
        if (g.snapshot().view.message?.waitingForInput) {
          g.press('a');
          g.advance(1);
          g.release('a');
        }
        g.advance(1);
      }
    });
  } else {
    await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 60_000 });
    await page.keyboard.press('KeyZ');
    await page.waitForFunction(() => window.openSinnohApp!.game.canSave() && !window.openSinnohApp!.game.scripts.running());
  }
  const state = await page.evaluate(() => window.openSinnohApp!.game.state);
  const team: Pokemon[] = (
    [
      ['SPECIES_EMBERKIT', 7],
      ['SPECIES_SKYLET', 4],
      ['SPECIES_DRIPLING', 5],
    ] as const
  ).map(([sp, level], i) => setupPokemon(state as GameState, registries, i, `fixture:${sp}` as Id, level));
  team[1]!.status = 'poison';
  team[2]!.hp = 1;
  team[2]!.heldItem = 'fixture:ITEM_TONIC' as Id;
  await page.evaluate((team) => {
    const s = window.openSinnohApp!.game.state;
    s.party.push(...team);
    Object.assign(s.bag, { items: [{ item: 'fixture:ITEM_LAMP_OIL', count: 3 }], medicine: [{ item: 'fixture:ITEM_TONIC', count: 2 }] });
  }, team);
}

/** Taps or clicks with the phone's finger. */
const press = (page: Page, target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

/** The start menu's entry, from the field. */
async function open(page: Page, entry: 'pokemon' | 'bag' | 'options', touch: boolean): Promise<void> {
  await press(page, page.getByRole('button', { name: 'Start menu', exact: true }), touch);
  await press(page, menu(page).locator(`[data-entry="${entry}"]`), touch);
}

/** Leaves the open app and the start menu for the field. */
async function close(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen]')).toHaveCount(0, { timeout: 500 });
  }).toPass();
}

async function setStyle(page: Page, value: 'ORIGINAL' | 'MODERN', touch: boolean): Promise<void> {
  await open(page, 'options', touch);
  const board = page.locator('[data-screen="options"]');
  await expect(async () => {
    await press(page, board.locator('[role="tab"][data-section="device"]'), touch);
    await expect(board.locator('[role="tab"][data-section="device"]')).toHaveAttribute('aria-selected', 'true', { timeout: 1500 });
  }).toPass();
  await press(page, board.locator('[data-setting="menuStyle"]').getByRole('button', { name: value }), touch);
  await close(page);
}

/** One full-bleed screen: nothing past the room, no sideways scroll, every target big enough. */
async function fits(page: Page, min: number): Promise<void> {
  const r = await page.evaluate((min) => {
    const root = document.querySelector<HTMLElement>('.mm')!;
    const box = root.getBoundingClientRect();
    const stops = [...root.querySelectorAll<HTMLElement>('[data-tap]')].filter((e) => e.offsetParent !== null);
    return {
      scroll: document.scrollingElement!.scrollWidth - innerWidth,
      out: stops.filter((e) => { const b = e.getBoundingClientRect(); return !e.closest('[data-scrolls], .os-rail') && (b.right > box.right + 0.5 || b.bottom > box.bottom + 0.5); }).map((e) => e.dataset.tap),
      small: stops.filter((e) => e.getBoundingClientRect().height + 0.5 < min).map((e) => e.dataset.tap),
      field: getComputedStyle(document.querySelector('.ui-scrim')!).backgroundColor === getComputedStyle(root).backgroundColor,
    };
  }, min);
  expect(r).toEqual({ scroll: 0, out: [], small: [], field: true });
}

test('MENUS: Original by default, Modern from Options, kept across a reload, and replays stay original', async ({ page }, info) => {
  test.setTimeout(180_000);
  const touch = info.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await skipSetup(page);
  await toField(page);

  await open(page, 'pokemon', touch);
  await expect(party(page).locator('.party-slot[data-species]')).toHaveCount(3);
  await expect(page.locator('.mm')).toHaveCount(0);
  await close(page);
  await open(page, 'bag', touch);
  await expect(bag(page).locator('.item-row').first()).toBeVisible();
  await expect(page.locator('.mm')).toHaveCount(0);
  await close(page);
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:menu-style'))).toBeNull();

  await setStyle(page, 'MODERN', touch);
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:menu-style'))).toBe('modern');
  await open(page, 'pokemon', touch);
  await expect(party(page).locator('.mm-slot[data-species]')).toHaveCount(3);
  await expect(page.locator('.party-slot')).toHaveCount(0);
  await close(page);

  await toField(page);
  await open(page, 'pokemon', touch);
  await expect(party(page)).toHaveClass(/mm-party/);
  await close(page);
  // The save holds nothing of it.
  expect(JSON.stringify(await page.evaluate(() => window.openSinnohApp!.game.state))).not.toContain('modern');

  await toField(page, '&replay');
  await page.evaluate(() => {
    window.openSinnohGame!.press('x');
    window.openSinnohGame!.advance(2);
    window.openSinnohGame!.release('x');
    window.openSinnohGame!.advance(2);
  });
  await expect(menu(page)).toBeVisible();
  await menu(page).locator('[data-entry="pokemon"]').click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await expect(party(page).locator('.party-slot[data-species]')).toHaveCount(3);
  await expect(page.locator('.mm')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Modern party: the list, the detail that follows the cursor, actions, keys and taps', async ({ page }, info) => {
  test.setTimeout(120_000);
  const project = info.project.name;
  const touch = project === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('lantern-nds:menu-style', 'modern'));
  await skipSetup(page);
  await toField(page);
  await open(page, 'pokemon', touch);
  const root = party(page);
  await expect(root.locator('.mm-slot')).toHaveCount(3);
  await expect(root.locator('.mm-slot').first()).toContainText('Emberkit');
  // The status is the ROM's picture, which this pack has not (modern-menus.rom.spec.ts checks it).
  await expect(root.locator('.mm-slot').nth(1).locator('.mm-status')).toHaveCount(0);
  await expect(root.locator('.mm-slot').nth(2).locator('.mm-held')).toHaveCount(1);
  await expect(root.locator('.mm-slot').first().locator('.os-hp')).toHaveAttribute('aria-label', /HP \d+ of \d+/);
  await expect(root.locator('.mm-slot-empty')).toHaveCount(3);
  await expect(root.locator('.os-tab')).toContainText('COMPANIONS');
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-party.png` });

  // Keys: the game's 2-column cursor walks the list one stop at a time; left and right stay.
  await expect(root.locator('.os-item.is-cursor')).toBeFocused();
  const cursor = async () => ((await app(page)) as { cursor: number }).cursor;
  for (const [key, at] of [['ArrowDown', 1], ['ArrowDown', 2], ['ArrowDown', 6], ['ArrowUp', 2], ['ArrowUp', 1], ['ArrowUp', 0], ['ArrowRight', 0]] as const) {
    await page.keyboard.press(key);
    await expect.poll(cursor).toBe(at);
  }
  await page.keyboard.press('ArrowDown');
  await expect.poll(cursor).toBe(1);
  await expect(root.locator('.mm-right')).toContainText('Skylet');
  await expect(root.locator('.os-item.is-cursor')).toContainText('Skylet');

  // A: the action window; Tab stays in it, the list's row keeps the selection.
  await page.keyboard.press('KeyZ');
  const actions = root.locator('.mm-prompt');
  await expect(actions).toBeVisible();
  await expect(actions.locator('.os-item.is-cursor')).toBeFocused();
  await expect(root.locator('.mm-slot.is-selected')).toContainText('Skylet');
  await page.keyboard.press('Tab');
  await expect(actions.locator(':focus')).toHaveCount(1);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-party-actions.png` });
  await page.keyboard.press('KeyX');
  await expect(actions).toHaveCount(0);

  // A tap opens it for that member, as on the original screen; SWITCH marks the moving row.
  await press(page, root.locator('.mm-slot').first(), touch);
  await expect(actions).toBeVisible();
  const before = await page.evaluate(() => window.openSinnohApp!.game.state.party.map((m) => m.species));
  await press(page, actions.locator('.os-item', { hasText: /SWITCH|SWAP|ORDER|MOVE/ }).first(), touch);
  await expect(root.locator('.mm-slot.is-moving')).toHaveCount(1);
  await press(page, root.locator('.mm-slot').nth(2), touch);
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.party[0]!.species)).toBe(before[2]);

  // CANCEL, the footer's cursor stop: the ring shows, and A leaves.
  await expect(async () => {
    await page.keyboard.press('ArrowDown');
    expect(await cursor()).toBe(6);
  }).toPass();
  const cancel = root.locator('.os-foot .os-btn');
  await expect(cancel).toHaveClass(/is-cursor/);
  await expect(cancel).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('KeyZ');
  await expect(menu(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Modern bag: pockets, the item under the cursor, actions, the toss count and an empty pocket', async ({ page }, info) => {
  test.setTimeout(120_000);
  const project = info.project.name;
  const touch = project === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('lantern-nds:menu-style', 'modern'));
  await skipSetup(page);
  await toField(page);
  await open(page, 'bag', touch);
  const root = bag(page);
  const pockets = root.locator('.os-rail [role="tab"]');
  await expect(pockets).toHaveCount(8);
  await expect(root.locator('.os-rail [aria-selected="true"]')).toHaveAttribute('data-tap', 'pocket:0');
  await expect(root.locator('.mm-bagrow')).toContainText(['Lamp Oil']);
  await expect(root.locator('.mm-right')).toContainText('Lamp Oil');
  await expect(root.locator('.mm-desc')).not.toBeEmpty();
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-bag.png` });

  // Left and right change the pocket, as on the DS; a tab does too.
  await page.keyboard.press('ArrowRight');
  await expect(root.locator('.os-rail [aria-selected="true"]')).toHaveAttribute('data-tap', 'pocket:1');
  await expect(root.locator('.mm-bagrow')).toContainText(['Tonic']);
  await press(page, pockets.nth(5), touch);
  await expect(root.locator('.os-rail [aria-selected="true"]')).toHaveAttribute('data-tap', 'pocket:5');
  await expect(root.locator('.mm-empty')).toBeVisible();
  await expect(root.locator('.os-foot .os-btn')).toHaveClass(/is-cursor/);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-bag-empty.png` });
  await press(page, pockets.first(), touch);

  // A tap on the row, then the action window.
  await expect(root.locator('.mm-bagrow')).toContainText(['Lamp Oil']);
  await press(page, root.locator('.mm-bagrow').first(), touch);
  const actions = root.locator('.mm-prompt');
  await expect(actions).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-bag-actions.png` });
  await press(page, actions.locator('.os-item', { hasText: 'DROP' }), touch);

  // The count, then the question: the game's own flow in a dialog.
  await expect(root.locator('.mm-qty')).toBeVisible();
  await press(page, root.locator('[data-tap="qty:+1"]'), touch);
  await expect(root.locator('.mm-qty [data-tap="ok"]')).toContainText('2');
  await press(page, root.locator('[data-tap="ok"]'), touch);
  await expect(root.locator('[data-tap="no"]')).toBeVisible();
  await press(page, root.locator('[data-tap="no"]'), touch);
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.bag.items![0]!.count)).toBe(3);
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeVisible({ timeout: 500 });
  }).toPass();
  expect(errors).toEqual([]);
});
