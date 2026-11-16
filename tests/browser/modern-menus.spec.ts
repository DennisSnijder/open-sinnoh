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
async function open(page: Page, entry: 'pokemon' | 'bag' | 'options' | 'pokedex', touch: boolean): Promise<void> {
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

test('the Modern summary: the Pokémon beside its page, the pager, moves, keys and taps', async ({ page }, info) => {
  test.setTimeout(120_000);
  const project = info.project.name;
  const touch = project === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('lantern-nds:menu-style', 'modern'));
  await skipSetup(page);
  await toField(page);
  await open(page, 'pokemon', touch);
  await press(page, party(page).locator('.mm-slot').first(), touch);
  await press(page, party(page).locator('.mm-prompt .os-item').first(), touch);
  const root = page.locator('[data-screen="summary"]');
  await expect(root).toHaveClass(/mm-sum/);
  await expect(page.locator('.sum-bg')).toHaveCount(0);
  const view = async () => (await app(page)) as { page: string; moves: { cursor: number | null } };
  const title = root.locator('.os-tab');
  const body = root.locator('.mm-page');
  await expect(title).toContainText('Emberkit');
  await expect(body).toHaveAttribute('data-page', 'info');
  await expect(body).toBeFocused();
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-summary.png` });

  // Left and right turn the page, up and down change the Pokémon: the game's own keys.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await view()).page).toBe('memo');
  await page.keyboard.press('ArrowDown');
  await expect(title).toContainText('Skylet');
  await page.keyboard.press('ArrowUp');
  await expect(title).toContainText('Emberkit');
  // The pager's arrows and the Pokémon's do the same by touch.
  await press(page, root.locator('.mm-pagestep').last(), touch);
  await expect(body).toHaveAttribute('data-page', 'skills');
  await expect(root.locator('.mm-stats .os-hp')).toHaveCount(1);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-summary-skills.png` });
  await press(page, root.locator('[data-tap="next"]'), touch);
  await expect(title).toContainText('Skylet');
  await press(page, root.locator('[data-tap="prev"]'), touch);
  await expect(title).toContainText('Emberkit');

  // BATTLE MOVES (CONDITION shows once the Contest Hall was visited: modern-menus.rom.spec.ts): A picks the first move,
  // its detail shows, and the row holds the focus; B lets go.
  await page.keyboard.press('ArrowRight');
  await expect(body).toHaveAttribute('data-page', 'moves');
  await page.keyboard.press('KeyZ');
  await expect.poll(async () => (await view()).moves.cursor).toBe(0);
  await expect(root.locator('.mm-move.is-cursor')).toBeFocused();
  await expect(root.locator('.mm-movedetail .mm-desc')).not.toBeEmpty();
  await expect(root.locator('[data-tap="prev"]')).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-summary-moves.png` });
  await fits(page, touch ? 44 : 36);
  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await view()).moves.cursor).toBe(null);
  // A tap selects a move, as on the original screen.
  await press(page, root.locator('.mm-move').first(), touch);
  await expect.poll(async () => (await view()).moves.cursor).toBe(0);
  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await view()).moves.cursor).toBe(null);

  await press(page, root.locator('.mm-pagestep').last(), touch);
  await expect(body).toHaveAttribute('data-page', 'ribbons');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-summary-ribbons.png` });
  // Back, the footer's button, returns to the party.
  await press(page, root.locator('.os-foot [data-tap="back"]'), touch);
  await expect(party(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Modern PC: the box and the party beside it, the preview, moving and marking, keys and taps', async ({ page }, info) => {
  test.setTimeout(150_000);
  const project = info.project.name;
  const touch = project === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('lantern-nds:menu-style', 'modern'));
  await skipSetup(page);
  await toField(page);
  // Two Pokémon in the first box, then the room's PC script (it opens MOVE POKéMON).
  const state = await page.evaluate(() => window.openSinnohApp!.game.state);
  const boxed = (
    [
      ['SPECIES_SKYLET', 3],
      ['SPECIES_DRIPLING', 6],
    ] as const
  ).map(([sp, level], i) => setupPokemon(state as GameState, registries, 10 + i, `fixture:${sp}` as Id, level));
  boxed[1]!.heldItem = 'fixture:ITEM_TONIC' as Id;
  await page.evaluate((boxed) => {
    const s = window.openSinnohApp!.game.state;
    s.boxes[0]!.slots[0] = boxed[0]!;
    s.boxes[0]!.slots[7] = boxed[1]!;
    const g = window.openSinnohApp!.game;
    g.scripts.start({ label: 'fixture:Common_PC' as never, zone: g.state.player.zone, source: 'test' });
  }, boxed);
  // A on the computer's line, once: a second A would open the first Pokémon's actions.
  await page.waitForFunction(() => window.openSinnohApp!.game.scripts.view().message?.waitingForInput === true);
  await page.keyboard.press('KeyZ');
  await expect(page.locator('[data-screen="storage"]')).toBeVisible();
  const root = page.locator('[data-screen="storage"]');
  const view = async () => (await app(page)) as { area: string; cursor: number; box: { index: number }; held: unknown; menu: unknown };
  await expect(root).toHaveClass(/mm-pc/);
  await expect(page.locator('.box-board')).toHaveCount(0);
  await expect(root.locator('.mm-box .mm-cell')).toHaveCount(30);
  await expect(root.locator('.mm-boxparty .mm-cell')).toHaveCount(6);
  await expect(root.locator('.mm-boxparty .mm-cell.filled')).toHaveCount(3);
  await expect(root.locator('.mm-box .mm-cell').nth(7).locator('.mm-held')).toHaveCount(1);
  await expect(root.locator('.mm-cell.is-cursor')).toBeFocused();
  await expect(root.locator('.mm-right')).toContainText('Skylet');
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-pc.png` });

  // The d-pad walks the grid as the game does: right, down a row, up to the header, the box's arrows, back down.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await view()).cursor).toBe(1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await view()).cursor).toBe(7);
  await expect(root.locator('.mm-right')).toContainText('Dripling');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await view()).cursor).toBe(1);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await view()).area).toBe('header');
  await expect(root.locator('.mm-boxname')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await view()).box.index).toBe(1);
  await press(page, root.locator('[data-tap="box:-1"]'), touch);
  await expect.poll(async () => (await view()).box.index).toBe(0);

  // A tap on a Pokémon: the action window; MOVE takes it in hand, a tap on an empty slot puts it there.
  await press(page, root.locator('[data-tap="slot:0"]'), touch);
  await expect(root.locator('.mm-prompt')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-pc-actions.png` });
  await press(page, root.locator('.mm-prompt [data-tap="menu:0"]'), touch);
  await expect.poll(async () => (await view()).held).not.toBeNull();
  await expect(root.locator('.mm-cell.is-cursor .mm-hand')).toHaveCount(1);
  await expect(root.locator('.mm-right')).toContainText('Skylet');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-pc-holding.png` });
  await press(page, root.locator('[data-tap="slot:3"]'), touch);
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.boxes[0]!.slots[3]?.species)).toBe('fixture:SPECIES_SKYLET');

  // MARK: the six marks toggle, CONFIRM keeps them.
  await press(page, root.locator('[data-tap="slot:3"]'), touch);
  await press(page, root.locator('.mm-prompt [data-tap="menu:2"]'), touch);
  const marks = root.locator('.mm-prompt');
  await expect(marks.locator('.mm-markrow')).toHaveCount(6);
  await press(page, marks.locator('[data-tap="mark:1"]'), touch);
  await expect(marks.locator('[data-tap="mark:1"]')).toHaveAttribute('aria-pressed', 'true');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-pc-marks.png` });
  await press(page, marks.locator('[data-tap="mark:6"]'), touch);
  await expect.poll(() => page.evaluate(() => window.openSinnohApp!.game.state.boxes[0]!.slots[3]!.markings)).toBe(2);
  await expect(root.locator('.mm-right .mm-marks')).toHaveAttribute('aria-label', 'Triangle');

  // The party column: right from the grid's last column.
  for (const at of [4, 5]) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await view()).cursor).toBe(at);
  }
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await view()).area).toBe('party');
  await expect(root.locator('.mm-boxparty .mm-cell.is-cursor')).toBeFocused();
  await expect(root.locator('.mm-right')).toContainText('Emberkit');
  await press(page, root.locator('.os-foot [data-tap="close"]'), touch);
  await expect(root.locator('[data-tap="yes"]')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-pc-close.png` });
  await press(page, root.locator('[data-tap="yes"]'), touch);
  await expect(root).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Modern Pokédex: the list beside the species, an entry and its pages, the search', async ({ page }, info) => {
  test.setTimeout(120_000);
  const project = info.project.name;
  const touch = project === 'phone';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('lantern-nds:menu-style', 'modern'));
  await skipSetup(page);
  await toField(page);
  await page.evaluate(() => {
    const d = window.openSinnohApp!.game.state.pokedex;
    d.obtained = true;
    d.seen.push('fixture:SPECIES_EMBERKIT' as never, 'fixture:SPECIES_SKYLET' as never, 'fixture:SPECIES_DRIPLING' as never);
    d.caught.push('fixture:SPECIES_EMBERKIT' as never, 'fixture:SPECIES_DRIPLING' as never);
  });
  await open(page, 'pokedex', touch);
  const root = page.locator('[data-screen="pokedex"]');
  const view = async () => (await app(page)) as { screen: string; cursor: number; page?: string };
  await expect(root).toHaveClass(/mm-dex-list/);
  await expect(page.locator('.dex-list-sheet')).toHaveCount(0);
  const rows = root.locator('.mm-dexrow');
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  await expect(root.locator('.mm-dexrow.is-cursor')).toBeFocused();
  await expect(root.locator('.os-tab')).toContainText(/\d/);
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-dex.png` });

  // The d-pad moves the cursor; the detail follows it. A tap selects a row; its picture opens the entry.
  const start = (await view()).cursor;
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await view()).cursor).toBe(start + 1);
  const name = (await root.locator('.mm-dexrow.is-cursor .lab').textContent())!;
  await expect(root.locator('.mm-right')).toContainText(name);
  const seen = root.locator('.mm-dexrow[data-species]').first();
  await press(page, seen, touch);
  await expect(seen).toHaveClass(/is-cursor/);
  await press(page, root.locator('[data-tap="open"]'), touch);
  await expect.poll(async () => (await view()).screen).toBe('entry');

  // The entry: the Pokémon beside its page; left and right turn the page, up and down step to the next species.
  await expect(root).toHaveClass(/mm-dex-entry/);
  await expect(root.locator('.mm-page')).toHaveAttribute('data-page', 'info');
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-dex-entry.png` });
  await press(page, root.locator('.os-foot [data-tap="back"]'), touch);
  await expect(root).toHaveClass(/mm-dex-list/);

  // The search: a row per filter, ◀ value ▶, OK.
  await press(page, root.locator('.os-foot [data-tap="search"]'), touch);
  await expect(root).toHaveClass(/mm-dex-search/);
  await expect(root.locator('.mm-searchrow.is-cursor')).toBeFocused();
  const first = root.locator('.mm-searchrow').first();
  const before = await first.locator('.mm-searchchoice').textContent();
  await press(page, first.locator('.mm-pagestep').last(), touch);
  await expect(first.locator('.mm-searchchoice')).not.toHaveText(before!);
  await settle(page);
  await fits(page, touch ? 44 : 36);
  await page.screenshot({ path: `${SHOTS}/${project}-dex-search.png` });
  await page.keyboard.press('KeyX');
  await expect(root).toHaveClass(/mm-dex-list/);
  await press(page, root.locator('.os-foot [data-tap="quit"]'), touch);
  await expect(menu(page)).toBeVisible();
  expect(errors).toEqual([]);
});
