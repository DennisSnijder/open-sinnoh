/**
 * Battle sheets in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone: the
 * m2-bag, m2-catch-202 and m2-switch replays through the bridge, with the command card's BAG and POKéMON
 * driven by clicks and taps where the replay answers directly:
 * - m2-bag: keys open the battle bag; the bag and the "Use on which Pokémon?" party sheet are drawn over
 *   the battle with the ROM's item icons, party icons and HP bars, and fit the screen.
 * - m2-catch-202: the first ball is thrown from the card (BAG → POKé BALLS → Poké Ball); the thrown ball
 *   is drawn on the scene (its ROM sprite), then `battle catch` finishes the catch.
 * - m2-switch: the first switch goes through the card's POKéMON button and a tap on Starly's panel.
 * Screenshots go to test-artifacts/battle-sheets (gitignored: ROM content, never commit).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { ReplayLine } from '@opensinnoh/core';
import type { BattleView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { ballMask, canvasStats, turnedPixels } from './canvas.ts';
import { fixedPart } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_BATTLE_SHOTS ?? 'test-artifacts/battle-sheets';
const REPLAYS = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(REPLAYS, file), 'utf8');

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

// Each replay resets its game; workers share only their own imported pack.
test.beforeEach(() => { errors.length = 0; });

test.afterAll(async () => {
  await context?.close();
});

const text = (name: string) => plainText(registries.texts.get(`platinum:${name}` as never)!.text);
const battleView = () => page.evaluate(() => window.openSinnohGame!.battleView()) as Promise<BattleView | null>;
const press = async (target: Locator) => (test.info().project.name === 'phone' ? target.tap() : target.click());
/** The open sheet fits the screen (no sideways scroll) and its tap targets are big enough (design.md §2). */
async function layoutChecks(): Promise<void> {
  const min = test.info().project.name === 'phone' ? 44 : 36;
  const r = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, width: innerWidth }));
  expect(r.scroll).toBeLessThanOrEqual(r.width);
  const small = await page.evaluate(
    (m) =>
      [...document.querySelectorAll<HTMLElement>('.ui-host [data-tap]')]
        .filter((e) => e.offsetParent !== null && !e.classList.contains('msg-box'))
        // A DS screen (the bag's `.ds-screen`, the party's `.board`) keeps the DS's targets, a 16-px DS row at its unit (21 CSS px on a 390-px phone), as in menus.rom.spec.
        .map((e) => ({ tap: e.dataset.tap, h: e.getBoundingClientRect().height, min: e.closest('.board, .ds-screen') ? Math.min(m, 16 * parseFloat(getComputedStyle(e).getPropertyValue('--unit'))) : m }))
        .filter((e) => e.h + 0.5 < e.min),
    min,
  );
  expect(small).toEqual([]);
}

const art = () =>
  page.evaluate(() => ({
    icons: [...document.querySelectorAll<HTMLElement>('.ui-host .item-icon:not(.blank)')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
    mons: [...document.querySelectorAll<HTMLElement>('.ui-host .party-slot .mon-icon-sprite')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
  }));

test('no placeholder art while the ROM art loads: every frame from the encounter to the switch-in, without waitForScene', async () => {
  test.setTimeout(300_000);
  // The m2-switch setup and walk (this runs first in the page, so no battle art is cached yet), up to its first wait.
  const lines = read('m2-switch.replay').split('\n');
  const walk = lines.slice(0, lines.findIndex((l) => l.startsWith('until battle'))).join('\n');
  const result = await runReplay(pageDriver(page, SHOTS, 'first-frame'), walk, { registries, name: 'm2-switch.replay (walk)', seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  const frame = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const placeholders = () => page.evaluate(() => window.openSinnohApp!.battleScene().placeholders);
  /** One tick, then one drawn frame, until `ok` holds; no frame on the way draws a placeholder. */
  const stepUntil = async (ok: (v: BattleView | null) => boolean) => {
    for (let i = 0; i < 1500; i++) {
      if (ok(await battleView())) return;
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      await frame();
      expect(await placeholders()).toBe(0);
    }
    throw new Error('the battle never reached the expected state');
  };
  await page.evaluate(() => {
    for (let i = 0; i < 900 && !window.openSinnohApp!.game.inBattle(); i++) window.openSinnohGame!.advance(1);
  });
  expect(await page.evaluate(() => window.openSinnohApp!.game.inBattle())).toBe(true);
  // The first frames of the battle (the cut-in, the scene, the send-out) up to the command card.
  await stepUntil((v) => v?.prompt?.kind === 'command');
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-first-command.png` });
  // The switch-in (Piplup out, Starly in), frame by frame.
  await page.evaluate(() => window.openSinnohGame!.battleChoose({ kind: 'switch', slot: 1 }));
  await stepUntil((v) => v?.prompt?.kind === 'command');
  expect(await placeholders()).toBe(0);
  expect(errors).toEqual([]);
});

test('m2-bag: keys open the battle bag over the battle; a Potion goes to Piplup through the party sheet', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  const shots: string[] = [];
  const driver = pageDriver(page, SHOTS, `${project}-bag`);
  const result = await runReplay(driver, read('m2-bag.replay'), {
    registries,
    name: 'm2-bag.replay',
    seed: 1,
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      await settle(page);
      if (line.action.name === 'bag-in-battle') {
        const bag = page.locator('[data-screen="bag"]');
        await expect(bag).toBeVisible();
        await expect(bag.locator('.pocket-tab').first()).toContainText(text('BattleBag_Text_PocketNameHPPP'));
        await expect.poll(async () => (await art()).icons, { timeout: 10_000 }).toBeGreaterThan(0);
        // The battle scene stays underneath; the command card is not shown while a sheet is open.
        await expect(page.locator('.battle-card')).toBeHidden();
      } else {
        const party = page.locator('[data-screen="party"]');
        await expect(party).toContainText(text('BattleParty_Text_UseOnWhichPokemon'));
        await expect.poll(async () => (await art()).mons, { timeout: 10_000 }).toBeGreaterThan(0);
      }
      await layoutChecks();
      shots.push(line.action.name);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(shots).toEqual(['bag-in-battle', 'bag-use-on']);
  expect(errors).toEqual([]);
});

test('m2-catch-202: the first ball is thrown from the card; the ball sprite flies, then the catch completes', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  let thrown = false;
  const driver = pageDriver(page, SHOTS, `${project}-catch`);
  const result = await runReplay(driver, read('m2-catch-202.replay'), {
    registries,
    name: 'm2-catch-202.replay',
    seed: 1,
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'battle-catch') return;
      const card = page.locator('.battle-card');
      await press(card.getByRole('button', { name: text('BattleStrings_Text_Bag') }));
      await page.evaluate(() => window.openSinnohGame!.advance(2));
      const bag = page.locator('[data-screen="bag"]');
      await expect(bag).toBeVisible();
      await press(bag.locator('[data-tap="pocket:2"]').first());
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      await press(bag.locator('[data-tap="row:0"]'));
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      await expect(bag).toBeHidden();
      // The ball in flight: drawn from its ROM sheet (hiding it in the view changes the pixels).
      await page.evaluate(() => {
        const g = window.openSinnohGame!;
        for (let i = 0; i < 600; i++) {
          const ball = g.battleView()?.ball;
          if (ball?.anim === 0 && ball.tick > 8) return;
          g.advance(1);
        }
        throw new Error('the thrown ball never reached its flight beat');
      });
      await waitForScene(page);
      await page.screenshot({ path: `${SHOTS}/${project}-catch-ball.png` });
      const withBall = await page.locator('#battle-canvas').screenshot();
      const stats = await canvasStats(page, '#battle-canvas');
      expect(stats.colours).toBeGreaterThan(64);
      await page.evaluate(() => {
        const battle = window.openSinnohApp!.game.battle as unknown as { view(): { ball: unknown }; __view?: () => { ball: unknown } };
        battle.__view = battle.view.bind(battle);
        const view = battle.__view;
        battle.view = () => ({ ...view(), ball: null });
      });
      await waitForScene(page);
      const without = await page.locator('#battle-canvas').screenshot();
      await page.evaluate(() => {
        const battle = window.openSinnohApp!.game.battle as unknown as { view: unknown; __view?: unknown };
        battle.view = battle.__view;
      });
      expect(withBall.equals(without), 'the thrown ball is drawn').toBe(false);
      thrown = true;
      // Throw until a catch (decomp ov12_02235E94.c, BattleScript_CatchMonTask): the ball rocks on the ground
      // (moves and turns, its bottom moving less than its top), and the caught ball's stars are drawn.
      let left: Awaited<ReturnType<typeof ballMask>> | null = null;
      let right: Awaited<ReturnType<typeof ballMask>> | null = null;
      let stars: Awaited<ReturnType<typeof ballMask>> | null = null;
      for (let i = 0; i < 6000 && !stars; i++) {
        const v = await battleView();
        if (!v) break;
        if (v.prompt?.kind === 'command') await page.evaluate(() => window.openSinnohGame!.battleChoose({ kind: 'item', item: 'platinum:ITEM_POKE_BALL' as never }));
        else if (v.ball && v.ball.tilt < 0 && !left) left = await ballMask(page);
        else if (v.ball && v.ball.tilt > 0 && left && !right) {
          right = await ballMask(page);
          await page.screenshot({ path: `${SHOTS}/${project}-catch-shake.png` });
        } else if (v.ball?.stars === 2) {
          stars = await ballMask(page, 'stars');
          await page.screenshot({ path: `${SHOTS}/${project}-catch-stars.png` });
        }
        await page.evaluate(() => window.openSinnohGame!.advance(1));
      }
      expect(left && right, 'a shake was seen').toBeTruthy();
      // DS: 2 px each way and 2° per px, clockwise to the right: it moves and turns (not a pure slide), and its
      // bottom travels no further than its top (the turn's pivot is below the ball, not above it).
      const topShift = right!.top - left!.top;
      const bottomShift = right!.bottom - left!.bottom;
      expect(topShift, 'the ball rocks to the right').toBeGreaterThan(3);
      expect(bottomShift, 'its bottom moves less than its top').toBeLessThanOrEqual(topShift);
      expect(turnedPixels(left!, right!), 'the ball turns between the shake frames').toBeGreaterThan(8);
      expect(stars, 'the caught stars came out').toBeTruthy();
      expect(stars!.changed, 'the stars are drawn').toBeGreaterThan(40);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(thrown).toBe(true);
  const end = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  expect(end.party).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('m2-switch: POKéMON on the card opens the battle party; a tap on Starly switches', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  let switched = false;
  const driver = pageDriver(page, SHOTS, `${project}-switch`);
  const result = await runReplay(driver, read('m2-switch.replay'), {
    registries,
    name: 'm2-switch.replay',
    seed: 1,
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'battle' || line.action.choice.kind !== 'switch' || line.action.choice.slot !== 1 || switched) return;
      const card = page.locator('.battle-card');
      await press(card.getByRole('button', { name: text('BattleStrings_Text_Pokemon') }));
      await page.evaluate(() => window.openSinnohGame!.advance(2));
      const party = page.locator('[data-screen="party"]');
      await expect(party).toContainText(text('BattleParty_Text_ChooseAPokemon'));
      await expect.poll(async () => (await art()).mons, { timeout: 10_000 }).toBe(2);
      await layoutChecks();
      await settle(page);
      await page.screenshot({ path: `${SHOTS}/${project}-switch-sheet.png` });
      // The Pokémon in battle is refused with the DS message; Starly goes in.
      await press(party.locator('[data-tap="slot:0"]'));
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      const inBattle = fixedPart((...slots) => plainText(registries.texts.get('platinum:BattleParty_Text_CantSwitchWithPokemonAlreadyInBattle' as never)!.text, slots));
      await expect(party).toContainText(inBattle);
      // In the two-line message window (the DS's error window), both lines inside it; a tap clears it.
      const box = party.locator('.msg-box', { hasText: inBattle });
      const outside = await box.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return [...b.querySelectorAll('*')].map((e) => e.getBoundingClientRect()).filter((e) => e.width && (e.left < r.left - 0.5 || e.right > r.right + 0.5 || e.top < r.top - 0.5 || e.bottom > r.bottom + 0.5)).length;
      });
      expect(outside).toBe(0);
      await press(party.locator('[data-tap="slot:1"]'));
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      await expect(party).not.toContainText(inBattle);
      await press(party.locator('[data-tap="slot:1"]'));
      await page.evaluate(() => window.openSinnohGame!.advance(1));
      await expect(party).toBeHidden();
      switched = true;
      return false;
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(switched).toBe(true);
  expect(errors).toEqual([]);
});

test('a medicine with no effect: the battle party refuses it in its message window, and the press goes back to the bag', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  // m2-bag's battle with Piplup at full HP: the Potion would do nothing (decomp BattlePartyTask_UseItem, TASK_STATE_EXIT).
  const lines = read('m2-bag.replay').split('\n').filter((l) => !l.startsWith('set state party[0].hp'));
  const walk = lines.slice(0, lines.indexOf('until app party 30') + 1).join('\n');
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-no-effect`), `${walk}\n`, { registries, name: 'm2-bag.replay (full HP)', seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  const party = page.locator('[data-screen="party"]');
  await expect(party).toContainText(text('BattleParty_Text_UseOnWhichPokemon'));
  await press(party.locator('[data-tap="slot:0"]'));
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  const box = party.locator('.msg-box');
  await expect(box).toContainText(text('BattleParty_Text_ItemWontHaveAnyEffect'));
  await page.screenshot({ path: `${SHOTS}/${project}-no-effect.png` });
  // Any tap ends it (BattlePartyTask_AwaitingInput): the bag comes back, the Potion still in it.
  await press(party.locator('[data-tap="slot:0"]'));
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await expect(party).toBeHidden();
  await expect(page.locator('[data-screen="bag"]')).toBeVisible();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.bag.medicine)).toEqual([{ item: 'platinum:ITEM_POTION', count: 1 }]);
  expect(errors).toEqual([]);
});
