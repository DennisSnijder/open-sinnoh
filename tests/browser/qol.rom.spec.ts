/**
 * The quality-of-life additions in the app on the real ROM (OPENSINNOH_NDS_ROM; follower talk also OPENSINNOH_HGSS_ROM), desktop and
 * phone. Replays play with the contract defaults (the DS), so each beat turns its option on through the bridge first:
 * - the item wheel (svc-item-wheel): Y held opens it over the field, the ROM's frames, icons and font, an item per side;
 * - the repeat-Repel prompt (svc-repel-repeat): "Use another Repel?" with YES/NO in the field box;
 * - the summary: the EV/IV label on SKILLS (A steps the numbers), RENAME on INFO opening the naming keyboard;
 * - follower talk with the HGSS add-on (sys-follower-talk): the talk's bubble or message over the field;
 * - the HGSS look with the add-on: Ethan's sprite in the field;
 * - the suspend point (normal play): the page hides, reloads, and CONTINUE puts the player where they stood.
 * Screenshots go to test-artifacts/qol (gitignored: ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import type { Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { mainCanvasStats, pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';
import { saveSlot } from './save.ts';
import { seedHgssAddon, seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const HGSS = process.env.OPENSINNOH_HGSS_ROM;
const SHOTS = 'test-artifacts/qol';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
let registries: Registries;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop' && info.project.name !== 'phone', 'desktop and phone');
  test.setTimeout(300_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
});

test.afterAll(async () => {
  await context?.close();
});

type Bridge = { openSinnohGame: { setOption(key: string, value: number): void; reset(seed?: number): Promise<void> } };
const setOption = (key: string, value: number) => page.evaluate(([k, v]) => (window as unknown as Bridge).openSinnohGame.setOption(k as string, v as number), [key, value] as const);

async function replayPage(): Promise<void> {
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
}

/** Runs a replay up to (not including) the first line starting with `stop`, or whole. */
async function play(name: string, file: string, stop?: string): Promise<void> {
  const text = readReplay(file);
  const upTo = stop ? text.indexOf(stop) : -1;
  const r = await runReplay(pageDriver(page, SHOTS, `${test.info().project.name}-${name}`), upTo < 0 ? text : text.slice(0, upTo), { registries, seed: 1, name, resolve: resolveReplay, repeat: false });
  expect(r.error).toBeUndefined();
}

const shot = async (name: string) => {
  await waitForScene(page);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
};

test('the item wheel: Y held opens it over the field, an item toward each direction', async () => {
  test.setTimeout(240_000);
  await replayPage();
  await setOption('itemWheel', 0);
  await play('wheel', 'svc-item-wheel.replay', '+0 assert app item-wheel');
  const wheel = page.locator('[data-screen="item-wheel"]');
  await expect(wheel).toBeVisible();
  await expect(wheel.locator('.wheel-slot')).toHaveCount(2);
  await expect(wheel.locator('.wheel-up .wheel-item')).toContainText(registries.items.get('platinum:ITEM_BICYCLE' as Id)!.name);
  // The ROM's frame and item icons (art, not stand-ins).
  await expect(wheel.locator('.wheel-slot.rom-frame')).toHaveCount(2);
  await expect.poll(() => wheel.locator('.item-icon').evaluateAll((e) => e.map((x) => getComputedStyle(x).backgroundImage).every((b) => b.startsWith('url(')))).toBe(true);
  // The wheel sits over the field, inside the view.
  const box = (await wheel.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  await shot('wheel');
  // A tap on the Coin Case uses it: the coins in the field box.
  await wheel.locator('[data-tap="item:1"]').click();
  await page.evaluate(() => window.openSinnohGame!.release('y'));
  await page.evaluate(() => window.openSinnohGame!.advance(60));
  await expect(wheel).toHaveCount(0);
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().view.message?.text ?? '')).toContain('120');
  expect(errors).toEqual([]);
});

test('the repeat-Repel prompt: "Use another …?" with YES/NO after the ROM\'s wore-off message', async () => {
  test.setTimeout(240_000);
  await replayPage();
  await setOption('repelPrompt', 0);
  await play('repel', 'svc-repel-repeat.replay', '+1 press a\n+1 release a\nuntil message 60');
  const v = await page.evaluate(() => window.openSinnohGame!.snapshot().view);
  expect(v.yesNo).toMatchObject({ cursor: 0 });
  expect(v.message?.text).toContain(registries.items.get('platinum:ITEM_REPEL' as Id)!.name);
  await shot('repel-prompt');
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('the summary: the EV/IV label on SKILLS, RENAME on INFO', async () => {
  test.setTimeout(240_000);
  await replayPage();
  await setOption('statView', 0);
  await setOption('summaryRename', 0);
  await play('summary', 'svc-softboiled.replay', '# Chansey');
  const tap = (id: string) => page.evaluate((t) => { window.openSinnohGame!.tap(t); window.openSinnohGame!.advance(2); }, id);
  await tap('slot:2');
  await tap('menu:0');
  const summary = page.locator('[data-screen="summary"]');
  await expect(summary).toBeVisible();
  const words = (name: string) => registries.texts.get(`platinum:${name}` as Id)!.text;
  await expect(summary.locator('.sum-extra')).toContainText(words('Lantern_Summary_Rename'));
  await shot('summary-rename');
  await tap('page:skills');
  await expect(summary.locator('.sum-extra')).toContainText(words('Lantern_Summary_Stats'));
  await summary.locator('.sum-extra').click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await expect(summary.locator('.sum-extra')).toContainText(words('Lantern_Summary_Evs'));
  await shot('summary-ev');
  await tap('page:info');
  await summary.locator('.sum-extra').click();
  await page.evaluate(() => window.openSinnohGame!.advance(2));
  await expect(page.locator('[data-screen="naming"]')).toBeVisible();
  await shot('summary-naming');
  expect(errors).toEqual([]);
});

test('follower talk with the HGSS add-on: the talk shows over the field', async () => {
  test.skip(!HGSS, 'OPENSINNOH_HGSS_ROM is not set');
  test.setTimeout(420_000);
  await seedHgssAddon(page);
  await replayPage();
  expect(await page.evaluate(() => window.openSinnohApp!.game.registries.followerTalk.size)).toBe(1);
  await setOption('followerTalk', 0);
  await play('talk', 'sys-follower-talk.replay', 'until message 300');
  // The talk's steps run (motions, the bubble), then its message waits in the field box.
  await page.evaluate(() => window.openSinnohGame!.advance(16));
  await shot('talk-step');
  await page.evaluate(() => window.openSinnohGame!.until({ kind: 'message' } as never, 300));
  const view = await page.evaluate(() => window.openSinnohGame!.snapshot().view);
  expect(view.message?.text.length).toBeGreaterThan(0);
  await shot('talk');
  // The bubble as the renderer draws it (this seed's interaction has none): the first emote's second frame.
  await page.evaluate(() => window.openSinnohApp!.game.world.followerBubble({ sprite: 'hgss-followers:SPRITE_EMOTE_0', frame: 1, rise: 0 }));
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await expect.poll(() => page.evaluate(() => ((globalThis as unknown as { openSinnohRenderStats?: { actors: { key: string }[] } }).openSinnohRenderStats?.actors ?? []).some((a) => a.key.startsWith('256:')))).toBe(true);
  await shot('talk-bubble');
  expect(errors).toEqual([]);
});

test('the HGSS look with the add-on: Ethan walks and runs in the field', async () => {
  test.skip(!HGSS, 'OPENSINNOH_HGSS_ROM is not set');
  test.setTimeout(240_000);
  // The add-on is in this context's storage since the follower talk's beat.
  await replayPage();
  await setOption('character', 1);
  await play('hgss-look', 'sys-follower-talk.replay', '# talk');
  const hero = () => page.evaluate(() => ((globalThis as unknown as { openSinnohRenderStats?: { actors: { sprite: string; key: string }[] } }).openSinnohRenderStats?.actors ?? []).map((a) => a.sprite));
  await expect.poll(hero, { timeout: 30_000 }).toContain('hgss-followers:SPRITE_PLAYER_ETHAN');
  // Walk a tile in view (the screen fades in after the replay's last load).
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let i = 0; i < 120 && !window.openSinnohApp!.game.canSave(); i++) g.advance(1);
    g.press('up');
    g.advance(6);
  });
  await shot('hgss-look');
  await page.evaluate(() => window.openSinnohGame!.release('up'));
  expect((await mainCanvasStats(page)).colours).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('the suspend point: hidden, reloaded, CONTINUE puts the player where they stood', async () => {
  test.setTimeout(300_000);
  // A save on Route 201 from the replay bridge, then normal play from the title.
  await replayPage();
  await play('suspend', 'svc-repel.replay', '+1 wild flee');
  await page.evaluate(() => {
    for (let i = 0; i < 120 && !window.openSinnohApp!.game.canSave(); i++) window.openSinnohGame!.advance(1);
  });
  await saveSlot(page);
  await page.goto('/');
  const continueGame = async () => {
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 60_000 });
    await expect(page.locator('.title-fade')).toHaveCSS('opacity', '0', { timeout: 30_000 });
    await page.locator('#title').click();
    await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
    await page.locator('[data-option="continue"]').click();
    await page.waitForFunction(() => !window.openSinnohTitle && !!window.openSinnohApp?.game, undefined, { timeout: 60_000 });
  };
  await continueGame();
  // Walk two tiles east (wall-clock play), then hide the page.
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.openSinnohApp!.game.state.player.x >= 117, undefined, { timeout: 30_000 });
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave(), undefined, { timeout: 30_000 });
  const before = await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.openSinnohApp!.game.state.player;
  });
  const stored = () =>
    page.evaluate(
      () =>
        new Promise<string | undefined>((resolve, reject) => {
          const open = indexedDB.open('lantern-nds-saves');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction('saves').objectStore('saves').get('suspend');
            get.onsuccess = () => resolve(get.result as string | undefined);
            get.onerror = () => reject(get.error);
          };
        }),
    );
  await expect.poll(stored).toBeDefined();
  const point = JSON.parse((await stored())!) as { state: { player: typeof before; tick: number } };
  expect(point.state.player).toEqual(before);
  await page.reload();
  await continueGame();
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player)).toEqual(before);
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.tick)).toBeGreaterThanOrEqual(point.state.tick);
  // Loaded once: cleared.
  await expect.poll(stored).toBeUndefined();
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-suspend.png` });
  expect(errors).toEqual([]);
});
