/**
 * The Modern party, bag, summary and PC on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone, in normal play
 * (replays keep the original drawing): a save made on the bridge, CONTINUEd from the title, the screens drawn with the
 * ROM's sprites and item icons, a name's ♂ as an icon, then the bag and party a battle opens.
 * Screenshots go to test-artifacts/modern-menus-rom (gitignored: ROM content, never commit), or OPENSINNOH_MODERN_SHOTS.
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { setupPokemon, type GameState, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { romContext, resetRomDevice } from './rom-context.ts';
import { saveSlot } from './save.ts';
import { settle } from './settle.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_MODERN_SHOTS ?? 'test-artifacts/modern-menus-rom';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

/** A team with every case the list shows, on Route 202 beside its grass. */
const TEAM = `party 0 platinum:SPECIES_PIPLUP 18
party 1 platinum:SPECIES_NIDORAN_M 12
party 2 platinum:SPECIES_STARLY 9
party 3 platinum:SPECIES_BIDOOF 7
party 4 platinum:SPECIES_SHINX 11
set state party[0].hp 9
set state party[0].heldItem "platinum:ITEM_ORAN_BERRY"
set state party[1].status "poison"
set state party[2].hp 0
set state party[3].hp 14
give item platinum:ITEM_POTION 4
give item platinum:ITEM_ANTIDOTE 2
give item platinum:ITEM_POKE_BALL 5
give item platinum:ITEM_ORAN_BERRY 3
set state party[0].ribbons [0,3,5,10,20]
set flag platinum:FLAG_CONTEST_HALL_VISITED true
set var platinum:VAR_ROUTE_202_STATE 1
warp platinum:MAP_HEADER_ROUTE_202 178 827 up
until idle
`;

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];
const itemName = (item: string) => registries.items.get(`platinum:${item}` as Id)!.name;
const romText = (name: string) => registries.texts.get(`platinum:${name}` as Id)!.text;
const tap = (target: Locator) => (test.info().project.name === 'phone' ? target.tap() : target.click());
const shot = async (name: string) => {
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
};

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  context = await romContext(browser, info.project.use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  const result = await runReplay(pageDriver(page, SHOTS, 'modern'), TEAM, { registries, name: 'modern-menus team', seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.openSinnohApp!.game.canSave(); i++) window.openSinnohGame!.advance(1);
  });
  await saveSlot(page);
  await page.evaluate(() => localStorage.setItem('lantern-nds:menu-style', 'modern'));
  await page.goto('/');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.focused === 'continue', undefined, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await page?.close();
});

const closeAll = () =>
  expect(async () => {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen]')).toHaveCount(0, { timeout: 500 });
  }).toPass();

async function entry(name: 'pokemon' | 'bag'): Promise<void> {
  await tap(page.getByRole('button', { name: appStrings().aria.hud.menu, exact: true }));
  await tap(page.locator(`[data-screen="start-menu"] [data-entry="${name}"]`));
}

test('the party: ROM icons and the front picture, status, HP, held item, ♂ as an icon', async () => {
  await entry('pokemon');
  const root = page.locator('[data-screen="party"]');
  await expect(root.locator('.mm-slot')).toHaveCount(5);
  await expect.poll(() => root.locator('.mm-slot .mon-icon-sprite').evaluateAll((e) => e.filter((n) => (n as HTMLElement).style.backgroundImage.startsWith('url(')).length)).toBe(5);
  await expect(root.locator('.mm-slot').nth(1).locator('.lab .os-ico[data-icon="male"]')).toHaveCount(1);
  // Status: the ROM's picture, named by the ROM's word; two statuses, two pictures.
  const status = (i: number) => root.locator('.mm-slot').nth(i).locator('.mm-status');
  await expect(status(1)).toHaveAttribute('aria-label', romText('MenuEntries_Text_Status_Poisoned'));
  const picture = (i: number) => status(i).locator('canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height, c.toDataURL()]);
  const [poison, fainted] = [await picture(1), await picture(2)];
  expect(poison[0]).toBeGreaterThan(0);
  expect(poison[2]).not.toBe(fainted[2]);
  await expect(root.locator('.mm-slot').first().locator('.mm-held')).toHaveCount(1);
  await expect(root.locator('.mm-right')).toContainText(itemName('ITEM_ORAN_BERRY'));
  // Phones in portrait dock the detail without the picture.
  if (await root.locator('.mm-pic').count()) {
    const painted = () => root.locator('.mm-pic canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v) => v > 0));
    await expect.poll(painted).toBe(true);
  }
  await shot('party');
  await tap(root.locator('.mm-slot').nth(1));
  await expect(root.locator('.mm-prompt')).toBeVisible();
  await shot('party-actions');
  await closeAll();
  expect(errors).toEqual([]);
});

test('the bag: ROM item icons, pockets, the description', async () => {
  await entry('bag');
  const root = page.locator('[data-screen="bag"]');
  await expect(root.locator('.os-rail [role="tab"]')).toHaveCount(8);
  await tap(root.locator('.os-rail [role="tab"]').nth(1));
  await expect(root.locator('.mm-bagrow')).toHaveCount(2);
  await expect(root.locator('.mm-bagrow').first()).toContainText(itemName('ITEM_POTION'));
  await expect(root.locator('.mm-right .item-icon')).toHaveCSS('background-image', /url\(/);
  await expect(root.locator('.mm-desc')).toContainText(/HP|KP/);
  await shot('bag');
  await closeAll();
  expect(errors).toEqual([]);
});

test('the summary: the ROM front picture, ball, type and ribbon art, its words on every page', async () => {
  await entry('pokemon');
  await tap(page.locator('[data-screen="party"] .mm-slot').first());
  await tap(page.locator('[data-screen="party"] .mm-prompt .os-item').first());
  const root = page.locator('[data-screen="summary"]');
  const body = root.locator('.mm-page');
  await expect(root).toHaveClass(/mm-sum/);
  await expect(root.locator('.mm-ball canvas')).toHaveCount(1);
  await expect(root.locator('.mm-sumhero .mm-type canvas')).toHaveCount(1);
  await expect(root.locator('.mm-sumhero')).toContainText(itemName('ITEM_ORAN_BERRY'));
  await expect(body).toHaveAttribute('data-page', 'info');
  await expect(root.locator('.mm-pagetitle')).toHaveText(romText('PokemonSummary_Text_PageTitleInfo'));
  await shot('summary');
  const next = root.locator('.mm-pagestep').last();
  for (const id of ['memo', 'skills', 'condition', 'moves', 'ribbons'] as const) {
    await tap(next);
    await expect(body).toHaveAttribute('data-page', id);
    if (id === 'condition') {
      const words = ['Cool', 'Beauty', 'Cute', 'Smart', 'Tough'].map((w) => romText(`ContestCommon_Text_${w}`));
      await expect(root.locator('.mm-graph')).toHaveAttribute('aria-label', new RegExp(words.map((w) => `${w} \\d+`).join(', ')));
    }
    if (id === 'moves') await expect.poll(() => root.locator('.mm-move .mm-type canvas').count()).toBeGreaterThan(0);
    if (id === 'ribbons') await expect(root.locator('.mm-ribbon canvas')).toHaveCount(5);
    await shot(`summary-${id}`);
  }
  // A ribbon picked by touch shows its name and description.
  await tap(root.locator('.mm-ribbon').nth(1));
  await expect(root.locator('.mm-movedetail .mm-desc')).not.toBeEmpty();
  await shot('summary-ribbon');
  await closeAll();
  expect(errors).toEqual([]);
});

test('the PC: the ROM icons, front picture, types and marks; the d-pad on the grid and the party', async () => {
  test.setTimeout(120_000);
  const state = (await page.evaluate(() => window.openSinnohApp!.game.state)) as GameState;
  const boxed = [setupPokemon(state, registries, 0, 'platinum:SPECIES_BUDEW' as Id, 8), setupPokemon(state, registries, 1, 'platinum:SPECIES_KRICKETOT' as Id, 5)];
  boxed[0]!.markings = 0b100101;
  boxed[1]!.heldItem = 'platinum:ITEM_POTION' as Id;
  await page.evaluate((boxed) => {
    const g = window.openSinnohApp!.game;
    g.state.boxes[0]!.slots[0] = boxed[0]!;
    g.state.boxes[0]!.slots[8] = boxed[1]!;
    // The PC of Jubilife's Pokémon Center, from the tile in front of it (back to Route 202 for the battle after).
    g.world.warp('platinum:MAP_HEADER_JUBILIFE_CITY_POKECENTER_1F' as never, 12, 4, 'up');
  }, boxed);
  await page.waitForFunction(() => window.openSinnohApp!.game.state.player.zone === 'platinum:MAP_HEADER_JUBILIFE_CITY_POKECENTER_1F' && !window.openSinnohApp!.sceneLoading() && !window.openSinnohApp!.game.scripts.running(), undefined, { timeout: 60_000 });
  // The PC's own menus (the field's): SOMEONE'S PC, then MOVE POKéMON.
  const wanted = [romText('MenuEntries_Text_PC_SomeonesPC'), romText('MenuEntries_Text_PC_MovePokemon')];
  for (let i = 0; i < 120 && !(await page.locator('[data-screen="storage"]').count()); i++) {
    const step = await page.evaluate((wanted) => {
      const v = window.openSinnohApp!.game.scripts.view();
      if (v.menu) {
        const at = v.menu.entries.findIndex((e) => wanted.includes(e));
        return at < 0 ? 'none' : at === v.menu.cursor ? 'KeyZ' : 'ArrowDown';
      }
      // A at the PC until its script starts (the warp's fade-in takes the first presses).
      return v.message?.waitingForInput || !window.openSinnohApp!.game.scripts.running() ? 'KeyZ' : 'wait';
    }, wanted);
    expect(step).not.toBe('none');
    if (step !== 'wait') await page.keyboard.press(step);
    await page.waitForTimeout(250);
  }
  const root = page.locator('[data-screen="storage"]');
  await expect(root).toHaveClass(/mm-pc/);
  await expect.poll(() => root.locator('.mm-box .mm-cell.filled .mon-icon-sprite').evaluateAll((e) => e.filter((n) => (n as HTMLElement).style.backgroundImage.startsWith('url(')).length)).toBe(2);
  await expect(root.locator('.mm-boxparty .mm-cell.filled')).toHaveCount(5);
  await expect(root.locator('.mm-right .mm-type canvas')).toHaveCount(2);
  await expect(root.locator('.mm-right .mm-marks canvas')).toHaveCount(6);
  await expect(root.locator('.mm-right .mm-marks')).toHaveAttribute('aria-label', /, .*, /);
  if (await root.locator('.mm-right .mm-pic canvas').count()) {
    const painted = () => root.locator('.mm-right .mm-pic canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v) => v > 0));
    await expect.poll(painted).toBe(true);
  }
  await shot('pc');
  const cursor = () => page.evaluate(() => (window.openSinnohApp!.game.app() as { area: string; cursor: number }).cursor);
  for (const [key, at] of [['ArrowDown', 6], ['ArrowRight', 7], ['ArrowRight', 8]] as const) {
    await page.keyboard.press(key);
    await expect.poll(cursor).toBe(at);
  }
  await expect(root.locator('.mm-right')).toContainText(registries.species.get('platinum:SPECIES_KRICKETOT' as Id)!.name);
  await expect(root.locator('.mm-right')).toContainText(itemName('ITEM_POTION'));
  await tap(root.locator('[data-tap="slot:8"]'));
  await expect(root.locator('.mm-prompt')).toBeVisible();
  await shot('pc-actions');
  await page.keyboard.press('KeyX');
  await expect(root.locator('.mm-prompt')).toHaveCount(0);
  await tap(root.locator('[data-tap="party:1"]'));
  await expect(root.locator('.mm-prompt')).toBeVisible();
  await page.keyboard.press('KeyX');
  await tap(root.locator('.os-foot [data-tap="close"]'));
  await tap(root.locator('[data-tap="yes"]'));
  await expect(root).toHaveCount(0);
  // The PC's menu and its goodbye, then back to the route's grass.
  await expect(async () => {
    await page.keyboard.press('KeyX');
    expect(await page.evaluate(() => window.openSinnohApp!.game.scripts.running())).toBe(false);
  }).toPass();
  await page.evaluate(() => window.openSinnohApp!.game.world.warp('platinum:MAP_HEADER_ROUTE_202' as never, 178, 827, 'up'));
  await page.waitForFunction(() => window.openSinnohApp!.game.state.player.zone === 'platinum:MAP_HEADER_ROUTE_202' && !window.openSinnohApp!.sceneLoading() && !window.openSinnohApp!.game.scripts.running(), undefined, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('a battle opens the Modern bag and party; the battle itself stays the original', async () => {
  test.setTimeout(240_000);
  // The grass by the route's start, up and down until something appears.
  await expect(async () => {
    for (const code of ['ArrowUp', 'ArrowDown']) {
      if (await page.evaluate(() => window.openSinnohApp!.game.inBattle())) break;
      await page.keyboard.down(code);
      await page.waitForTimeout(500);
      await page.keyboard.up(code);
    }
    expect(await page.evaluate(() => window.openSinnohApp!.game.battle?.view().prompt?.kind)).toBe('command');
  }).toPass({ timeout: 180_000, intervals: [100] });
  await expect(page.locator('.battle-card .bc-button.is-cursor')).toBeVisible();
  await tap(page.locator('.battle-card .bc-button', { hasText: registries.texts.get('platinum:BattleStrings_Text_Bag' as Id)!.text }));
  const bag = page.locator('[data-screen="bag"]');
  await expect(bag).toHaveClass(/mm-battle/);
  await expect(bag.locator('.os-rail [role="tab"]')).toHaveCount(4);
  await expect(bag.locator('.mm-bagrow').first()).toContainText(itemName('ITEM_POTION'));
  await shot('battle-bag');
  await tap(bag.locator('.mm-bagrow').first());
  const party = page.locator('[data-screen="party"]');
  await expect(party).toHaveClass(/mm-battle/);
  await shot('battle-party');
  expect(errors).toEqual([]);
});
