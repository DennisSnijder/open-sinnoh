/**
 * OPTIONS on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), at every menu viewport: the OpenSinnoh UI
 * window (design system, no ROM art), one page per section, the whole window in the viewport on whole pixels
 * with every row's control inside it; the keyboard changes a value on each page; the device settings survive a
 * reload; and the DS options still apply in the game (text speed, FRAME, BUTTON MODE, battle style).
 * Screenshots go to test-artifacts/options (gitignored: ROM content, never commit), or OPENSINNOH_OPTIONS_SHOTS.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import type { Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { SUPPORTED_ROMS } from '@opensinnoh/nds';
import { strings } from '../../packages/app/src/strings/index.ts';
import { romSha1, romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_OPTIONS_SHOTS ?? 'test-artifacts/options';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
/** A text record's words in the game's language. */
const words = (name: string) => registries.texts.get(`platinum:${name}` as Id)!.text;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

/** To the start menu on Route 201 (the replay seed, a Pokémon in the party). */
const TO_MENU = `party 0 platinum:SPECIES_TURTWIG 12
warp platinum:MAP_HEADER_ROUTE_201 115 853 right
until idle
+1 press x
+1 release x
until app start-menu
`;

const boot = async () => {
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
};

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.evaluate(() => localStorage.clear());
  await boot();
});

test.afterAll(async () => {
  await context?.close();
});

const advance = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);
const board = () => page.locator('[data-screen="options"]');
const setting = (id: string) => board().locator(`[data-setting="${id}"]`);
/** The chosen value's text (choices and steppers), or a slider's number. */
const chosen = (id: string) => setting(id).locator('.options-value.on, [role="slider"]').first();

async function openOptions(): Promise<void> {
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  const result = await runReplay(pageDriver(page, SHOTS, 'options'), TO_MENU, { registries, name: 'to-menu', resolve: () => ({ name: '', text: '' }), repeat: false });
  expect(result.error).toBeUndefined();
  // The UI is drawn on display frames, and the warp's first frames load Route 201 (seconds on a busy machine).
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 60_000 });
  await page.locator('[data-screen="start-menu"] [data-entry="options"]').click();
  await advance(2);
  await expect(board()).toBeVisible();
}

/** A key press, then the ticks for the screen to take it and the OPTIONS app to apply a DS option's tap. */
async function key(code: string): Promise<void> {
  await page.keyboard.press(code);
  await advance(2);
}

/** The window fits the viewport on whole pixels, nothing scrolls the page; every shown row's control is inside it. */
async function fits(): Promise<void> {
  // The window's opening animation moves it: measure once it has run.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const r = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-screen="options"] .os-panel')!;
    const b = panel.getBoundingClientRect();
    const inside = (e: Element) => {
      const c = e.getBoundingClientRect();
      return c.width === 0 || (c.left >= b.left - 0.5 && c.right <= b.right + 0.5 && c.top >= b.top - 0.5 && c.bottom <= b.bottom + 0.5);
    };
    // The list scrolls (DEVICE): rows scrolled out are not on the screen.
    const list = panel.querySelector<HTMLElement>('.options-rows')!;
    const l = list.getBoundingClientRect();
    const shown = (e: Element) => {
      const c = e.getBoundingClientRect();
      return c.bottom > l.top + 0.5 && c.top < l.bottom - 0.5;
    };
    const out = [...panel.querySelectorAll('.options-label, .options-row .ctl')].filter((e) => shown(e) && !inside(e)).map((e) => e.closest('[data-setting]')?.getAttribute('data-setting') ?? e.className);
    // Overflow is intentional: only the chosen tab and Back must be on screen.
    const selected = panel.querySelector('.options-tab[aria-selected="true"]')!;
    const t = selected.getBoundingClientRect();
    const strip = panel.querySelector('.os-tabs')!.getBoundingClientRect();
    const tabVisible = t.left >= strip.left - 0.5 && t.right <= strip.right + 0.5;
    const tabsOut = [...panel.querySelectorAll('.options-tab[aria-selected="true"], .options-close')].filter((e) => !inside(e)).length;
    return {
      inView: b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5,
      whole: [b.left, b.top, b.width, b.height].every((v) => Math.abs(v - Math.round(v)) < 0.01),
      scroll: document.scrollingElement!.scrollWidth <= innerWidth && document.scrollingElement!.scrollHeight <= innerHeight && list.scrollWidth <= list.clientWidth,
      out,
      tabsOut,
      tabVisible,
      rect: [b.left, b.top, b.right, b.bottom].map(Math.round),
    };
  });
  expect(r, JSON.stringify(r)).toMatchObject({ inView: true, whole: true, scroll: true, out: [], tabsOut: 0, tabVisible: true });
}

async function shot(name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: join(SHOTS, `${test.info().project.name}-${name}.png`) });
}

const SECTIONS = ['game', 'device', 'controls', 'data', 'privacy'];

test('the Options window: no ROM art, a page per section, fits on whole pixels', async () => {
  test.setTimeout(180_000);
  await openOptions();
  // OpenSinnoh's own screen: the design system's window, no ROM picture or ROM font; the bar cursor on one row.
  await expect(board().locator('.os-panel.os-win')).toHaveCount(1);
  await expect(board().locator('.ds-picture, .rom canvas')).toHaveCount(0);
  await expect(board().locator('.options-row.is-cursor')).toHaveCount(1);
  await expect(board().locator('[role="tab"]')).toHaveCount(5);
  for (const [i, id] of SECTIONS.entries()) {
    await expect(board().locator(`[role="tab"][data-section="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    await shot(`${i}-${id}`);
    await fits();
    await key('KeyE');
  }
  // R wraps to GAME; the GAME page opens with the DS's six options in the DS's order (OpenSinnoh's QoL rows follow), and Back closes.
  await expect(board().locator('[role="tab"][data-section="game"]')).toHaveAttribute('aria-selected', 'true');
  const ids = await board().locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-setting')));
  expect(ids.slice(0, 6)).toEqual(['textSpeed', 'sound', 'battleScene', 'battleStyle', 'buttonMode', 'frame']);
  await expect(board().locator('.options-close')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the keyboard changes a value on every page; the device settings survive a reload', async () => {
  test.setTimeout(180_000);
  test.skip(test.info().project.name !== 'mid' && test.info().project.name !== 'desktop', 'keyboard: one desktop project is enough');
  await openOptions();
  const opts = () => page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options') ?? '{}') as Record<string, number>);
  // GAME: TEXT SPEED (the first row) mid → fast.
  const before = await chosen('textSpeed').innerText();
  await key('ArrowRight');
  expect((await opts()).textSpeed).toBe(2);
  await expect(chosen('textSpeed')).not.toHaveText(before);
  // DEVICE: ZOOM Auto → the first whole scale, RENDER SCALE Auto → Full, FAST-FORWARD 2x → 3x, VOLUME 80 → 90, MUTE off → on, TRADE EVOS on → off.
  await key('KeyE');
  await key('ArrowRight');
  const zoom = await page.evaluate(() => localStorage.getItem('lantern-nds:zoom'));
  expect(zoom).toMatch(/^\d+$/);
  await key('ArrowDown');
  await key('ArrowRight');
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:render-scale'))).toBe('full');
  await key('ArrowDown');
  await key('ArrowRight');
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:speed'))).toBe('3');
  // The rows between FAST-FORWARD and VOLUME depend on what this device offers (followers, the HGSS look, QoL rows): walk by the page.
  const rows = await board().locator('[data-setting]').evaluateAll((els) => els.map((e) => e.getAttribute('data-setting')));
  for (let i = rows.indexOf('speed'); i < rows.indexOf('volume'); i++) await key('ArrowDown');
  await key('ArrowRight');
  await expect(chosen('volume')).toHaveAttribute('aria-valuenow', '90');
  await key('ArrowDown');
  await key('ArrowRight');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:audio')!))).toEqual({ volume: 90, muted: true });
  await key('ArrowDown');
  await key('ArrowRight');
  expect((await opts()).tradeEvolution).toBe(1);
  await shot('keys-device');
  // DATA has no value to change here (its rows are actions); PRIVACY: ERROR REPORTS off (not answered in a setup yet: nothing is sent) → on.
  await key('KeyE');
  await key('KeyE');
  await key('KeyE');
  await key('ArrowRight');
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:error-reports'))).toBe('true');
  await shot('keys-privacy');
  // B closes OPTIONS (the app pops back to the start menu).
  await key('KeyX');
  await expect(board()).toBeHidden();

  // After a reload the device settings show as they were left.
  await boot();
  await openOptions();
  await expect(chosen('textSpeed')).not.toHaveText(before);
  await key('KeyE');
  await expect(chosen('zoom')).toHaveText(`${zoom}x`);
  await expect(chosen('renderScale')).toHaveText(strings(SUPPORTED_ROMS[romSha1()]!.language).options.full);
  await expect(chosen('speed')).toHaveText('3x');
  await expect(chosen('volume')).toHaveAttribute('aria-valuenow', '90');
  await expect(setting('mute').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(setting('tradeEvolution').locator('.options-value').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await key('KeyE');
  await key('KeyE');
  await key('KeyE');
  await expect(setting('reports').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('the DS options apply in the game: text speed, FRAME, battle style, BUTTON MODE', async () => {
  test.setTimeout(180_000);
  test.skip(test.info().project.name !== 'mid' && test.info().project.name !== 'desktop', 'keyboard: one desktop project is enough');
  await page.evaluate(() => localStorage.clear());
  await boot();
  await openOptions();
  const state = () => page.evaluate(() => ({ ...window.openSinnohApp!.game.state.options, textSpeed: window.openSinnohApp!.game.textSpeed }));
  await key('ArrowLeft');
  expect((await state()).textSpeed).toBe(0);
  // BATTLE STYLE (row 4): SHIFT → SET, saved with the game.
  for (let i = 0; i < 3; i++) await key('ArrowDown');
  await key('ArrowRight');
  expect((await state()).battleStyle).toBe(1);
  // FRAME (row 6): the game's message box frame type, saved with the game (OpenSinnoh's own window keeps its frame).
  await key('ArrowDown');
  await key('ArrowDown');
  const first = await chosen('frame').innerText();
  await key('ArrowRight');
  expect((await state()).frame).toBe(1);
  await expect(chosen('frame')).not.toHaveText(first);
  await expect(chosen('frame')).toHaveText(/2$/);
  await shot('frame-2');
  // Taps: the FRAME arrows step it back.
  const frameLabel = await setting('frame').locator('.options-label').innerText();
  await setting('frame').getByRole('button', { name: strings(SUPPORTED_ROMS[romSha1()]!.language).ui.previous(frameLabel), exact: true }).click();
  await advance(2);
  expect((await state()).frame).toBe(0);
  // BUTTON MODE (row 5) L=A: L is A (it steps the focused row), R is gone (no page turn).
  await key('ArrowUp');
  await key('ArrowLeft');
  expect((await state()).buttonMode).toBe(2);
  await key('KeyE');
  await expect(board().locator('[role="tab"][data-section="game"]')).toHaveAttribute('aria-selected', 'true');
  await key('KeyQ');
  expect((await state()).buttonMode).toBe(0);
  // Tapping a tab turns the page; tapping a value picks it.
  await board().locator('[role="tab"][data-section="device"]').click();
  await advance(1);
  await setting('speed').getByRole('button', { name: '8x' }).click();
  await advance(1);
  expect(await page.evaluate(() => localStorage.getItem('lantern-nds:speed'))).toBe('8');
  // Back by tap.
  await board().locator('.options-close').click();
  await advance(2);
  await expect(board()).toBeHidden();
  expect(errors).toEqual([]);
});

test('FOLLOWER STYLE defaults to Still and keeps Walk in place on this device after a reload', async () => {
  test.setTimeout(180_000);
  test.skip(!['desktop', 'phone'].includes(test.info().project.name), 'desktop and phone cover the device option');
  await page.evaluate(() => localStorage.clear());
  await boot();
  await openOptions();
  const play = async () => {
    await board().locator('[data-section="device"]').click();
    await advance(2);
  };
  await play();
  await expect(chosen('followerStyle')).toHaveText(words('Lantern_Options_FollowerStill'));
  await setting('followerStyle').locator('.options-value').nth(1).click();
  await advance(2);
  await expect(chosen('followerStyle')).toHaveText(words('Lantern_Options_FollowerWalk'));
  await fits();
  await shot('follower-style');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('lantern-nds:options')!).followerStyle);
  expect(await stored()).toBe(1);
  expect(await page.evaluate(() => 'followerStyle' in window.openSinnohGame!.snapshot().state.options)).toBe(false);
  await boot();
  await openOptions();
  await play();
  await expect(chosen('followerStyle')).toHaveText(words('Lantern_Options_FollowerWalk'));
  expect(await stored()).toBe(1);
  expect(errors).toEqual([]);
});
