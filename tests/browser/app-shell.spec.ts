/**
 * The app running the real engine (world, VM, renderer, text) on the fixture pack, at desktop and
 * phone sizes: layout, input paths, new game → talk → warp → starter choice by touch, a non-blank 3D
 * scene and message box, saves, and the Mods menu. Steps wait on game state rather than fixed ticks.
 */
import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot } from '@opensinnoh/contracts';
import { choiceRects } from '../../packages/app/src/panel.ts';
import { CONTROLS_STRIP } from '../../packages/app/src/layout.ts';
import { openOptionsData, saveGame } from './save.ts';
import { selectBall, starterReady, starterSprite, tapBall } from './starter.ts';

const SHOTS = 'test-artifacts/app-shell';

/** Loads the fixture pack in replay mode (wall clock off, bridge on). */
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?packs=fixture&replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  return errors;
}

const advance = (page: Page, n = 1) => page.evaluate((k) => window.openSinnohGame!.advance(k), n);
const lastInput = (page: Page) => page.evaluate(() => window.openSinnohApp!.lastInput);
const snapshot = (page: Page): Promise<GameSnapshot> => page.evaluate(() => JSON.parse(JSON.stringify(window.openSinnohGame!.snapshot())) as GameSnapshot);

/** Advances one tick at a time until `pred(snapshot, idle)` holds (in the page). */
async function until(page: Page, pred: (s: GameSnapshot, idle: boolean) => boolean, max = 1500): Promise<void> {
  const ok = await page.evaluate(
    ([src, limit]) => {
      const f = new Function(`return (${src})`)() as (s: GameSnapshot, idle: boolean) => boolean;
      const idle = () => window.openSinnohApp!.game.world.idle();
      for (let i = 0; i < limit; i++) {
        if (f(window.openSinnohGame!.snapshot(), idle())) return true;
        window.openSinnohGame!.advance(1);
      }
      return false;
    },
    [pred.toString(), max] as const,
  );
  if (!ok) throw new Error(`not reached in ${max} ticks: ${pred.toString()}\n${JSON.stringify(await snapshot(page))}`);
}

const settled = (page: Page) => until(page, (s, idle) => idle && !s.scriptRunning);

/** Holds a button through the bridge until the player reaches a tile (or a script starts), then settles. */
async function walk(page: Page, button: 'up' | 'down' | 'left' | 'right', pred: (s: GameSnapshot, idle: boolean) => boolean): Promise<void> {
  await page.evaluate((b) => window.openSinnohGame!.press(b), button);
  await until(page, pred);
  await page.evaluate((b) => window.openSinnohGame!.release(b), button);
  await until(page, (_s, idle) => idle);
}

async function tap(page: Page, button: 'a' | 'b' | 'up' | 'down' | 'left' | 'right'): Promise<void> {
  await page.evaluate((b) => window.openSinnohGame!.press(b), button);
  await advance(page);
  await page.evaluate((b) => window.openSinnohGame!.release(b), button);
  await advance(page);
}

/** Presses A through every message page and yes/no (YES) until the script ends. */
async function finishScript(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await until(page, (s) => !s.scriptRunning || s.view.message?.waitingForInput === true || s.view.yesNo !== null || s.view.panel.kind === 'choice');
    const s = await snapshot(page);
    if (!s.scriptRunning) return;
    if (s.view.panel.kind === 'choice') throw new Error('finishScript: unexpected choice panel');
    await tap(page, 'a');
  }
  throw new Error('finishScript: script did not end');
}

/** Distinct colours and lit share of the WebGL canvas, read in the frame it was drawn. */
function fieldStats(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ colours: number; lit: number }>((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = src.width;
          copy.height = src.height;
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0);
          const px = g.getImageData(0, 0, copy.width, copy.height).data;
          const colours = new Set<number>();
          let lit = 0;
          let n = 0;
          for (let i = 0; i < px.length; i += 4 * 7) {
            colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
            if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
            n++;
          }
          resolve({ colours: colours.size, lit: lit / n });
        });
      }),
  );
}

/** Share of opaque pixels on the 2D overlay (the message box). */
function overlayCoverage(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          const c = document.getElementById('overlay-canvas') as HTMLCanvasElement;
          const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let opaque = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) opaque++;
          resolve(opaque / (px.length / 4));
        });
      }),
  );
}

/** The renderer loads a new map's models asynchronously (frames keep rendering in replay mode), so poll. */
async function expectScene(page: Page, minLit: number): Promise<void> {
  await expect.poll(async () => {
    const stats = await fieldStats(page);
    return stats.colours > 8 && stats.lit > minLit;
  }, { timeout: 10_000 }).toBe(true);
}

test('the real engine on the fixture pack: layout, input, talk, warp, starter by touch, saves', async ({ page }, info) => {
  // The starter scene's intro runs on the wall clock.
  test.setTimeout(120_000);
  const phone = info.project.name === 'phone';
  const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` });
  const errors = await open(page);
  const viewport = page.viewportSize()!;
  const main = (await page.locator('#main-canvas').boundingBox())!;
  // Single screen: the field view fills the screen (phones keep a controls strip under it); the
  // touch panel is a card over the field, hidden while it has nothing to show.
  await expect(page.locator('#panel-canvas')).toBeHidden();
  expect(main.width).toBeCloseTo(viewport.width, 0);
  if (phone) {
    expect(main.height).toBeCloseTo(viewport.height - CONTROLS_STRIP, 0);
    await expect(page.locator('#dpad')).toBeVisible();
    await expect(page.locator('#buttons')).toBeVisible();
  } else {
    expect(main.height).toBeCloseTo(viewport.height, 0);
    await expect(page.locator('#dpad')).toBeHidden();
  }
  // The WebGL canvas backing store matches the CSS size times the pixel ratio (Auto render scale: at most 2 on touch).
  const backing = await page.evaluate(() => {
    const c = document.getElementById('main-canvas') as HTMLCanvasElement;
    return { w: c.width, css: c.getBoundingClientRect().width, dpr: matchMedia('(pointer: coarse)').matches ? Math.min(2, devicePixelRatio) : devicePixelRatio };
  });
  expect(backing.w).toBe(Math.round(backing.css * backing.dpr));

  // Replay mode: no wall-clock ticks.
  const ticks = await page.evaluate(() => window.openSinnohApp!.ticks);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.openSinnohApp!.ticks)).toBe(ticks);

  // New game: the room's intro message, drawn with the pack font over a non-blank 3D room.
  let s = await snapshot(page);
  expect(s.state.player).toMatchObject({ zone: 'fixture:ROOM', x: 14, z: 16 });
  await until(page, (x) => x.view.message?.waitingForInput === true);
  await expectScene(page, 0.1);
  expect(await overlayCoverage(page)).toBeGreaterThan(0.02);
  await shot('intro');
  // Dismiss it with the on-screen A (phone) or the keyboard (desktop).
  if (phone) await page.locator('#buttons [data-button="a"]').tap();
  else await page.keyboard.press('z');
  await advance(page);
  expect((await lastInput(page))!.pressed).toEqual(['a']);
  await settled(page);
  s = await snapshot(page);
  expect(s.view.message).toBeNull();
  expect(await overlayCoverage(page)).toBe(0);

  // Keyboard → held/pressed, and the player walks up one tile.
  await page.keyboard.down('ArrowUp');
  await advance(page);
  expect(await lastInput(page)).toEqual({ held: ['up'], pressed: ['up'], touch: null });
  await advance(page);
  expect(await lastInput(page)).toEqual({ held: ['up'], pressed: [], touch: null });
  await until(page, (x) => x.state.player.z === 15);
  await page.keyboard.up('ArrowUp');
  await until(page, (_x, idle) => idle);
  expect((await snapshot(page)).state.player).toMatchObject({ x: 14, z: 15, facing: 'up' });
  if (phone) await expect(page.locator('#dpad')).toBeHidden(); // a physical keyboard hides the on-screen controls

  // Talk to the helper (object at 18,14) from 18,15.
  await walk(page, 'right', (x) => x.state.player.x === 18);
  await tap(page, 'up');
  await settled(page);
  await tap(page, 'a');
  await until(page, (x) => x.view.message !== null);
  await shot('talk');
  await finishScript(page);
  expect((await snapshot(page)).state.flags['fixture:FLAG_TALKED_TO_HELPER']).toBe(true);

  // Out through the door warp into the town.
  await walk(page, 'left', (x) => x.state.player.x === 15);
  await walk(page, 'down', (x) => x.state.player.z === 19);
  await walk(page, 'down', (x) => x.state.player.zone === 'fixture:TOWN');
  await settled(page);
  s = await snapshot(page);
  // Out of the town door (10,13): it opens, the player walks out south, it closes.
  expect(s.state.player).toMatchObject({ zone: 'fixture:TOWN', x: 10, z: 14 });
  await expectScene(page, 0.5);
  await shot('town');

  // East along the path into the guide's coord trigger, through to the starter panel.
  await walk(page, 'down', (x) => x.state.player.z === 16);
  await walk(page, 'right', (x) => x.state.player.x === 38 || x.scriptRunning);
  for (let i = 0; i < 20; i++) {
    await until(page, (x) => x.view.message?.waitingForInput === true || x.view.panel.kind === 'choice');
    if ((await snapshot(page)).view.panel.kind === 'choice') break;
    await tap(page, 'a');
  }
  s = await snapshot(page);
  expect(s.view.panel.kind).toBe('choice');
  if (s.view.panel.kind !== 'choice') return;
  expect(s.view.panel.options.map((o) => o.label)).toEqual(['Mosslet', 'Emberkit', 'Dripling']);
  // The briefcase scene (original fixture art) covers the field view instead of the panel card.
  await starterReady(page);
  await expect(page.locator('#panel-canvas')).toBeHidden();
  expect(await page.locator('.starter').boundingBox()).toEqual(await page.locator('#main-canvas').boundingBox());
  // The selected starter's picture is drawn on the disc.
  expect(await page.evaluate(() => window.openSinnohStarter!.preview)).toBe('fixture:SPECIES_MOSSLET');
  const mosslet = await starterSprite(page);
  expect(mosslet.share, 'Mosslet on the disc').toBeGreaterThan(0.03);
  expect(mosslet.colours).toBeGreaterThan(4);
  await shot('starter-scene');
  // Tap the second ball: the cursor moves there (d-pad presses the VM reads) and Emberkit pops up.
  await selectBall(page, 1, phone);
  expect((await snapshot(page)).view.panel.kind).toBe('choice');
  const emberkit = await starterSprite(page);
  expect(emberkit.share, 'Emberkit on the disc').toBeGreaterThan(0.03);
  expect(emberkit.hash).not.toBe(mosslet.hash);
  await shot('starter-selected');
  // Tap it again: taken (a panel touch on its choice rect).
  await tapBall(page, 1, phone);
  await advance(page);
  const option = choiceRects(3)[1]!;
  expect((await lastInput(page))!.touch).toEqual({ x: Math.floor(option.x + option.width / 2), y: Math.floor(option.y + option.height / 2) });
  await advance(page);
  expect((await snapshot(page)).view.panel.kind).toBe('idle');
  await expect(page.locator('.starter')).toHaveCount(0);
  await finishScript(page);
  s = await snapshot(page);
  expect(s.state.party[0]?.species).toBe('fixture:SPECIES_EMBERKIT');
  await expectScene(page, 0.5);
  await shot('after-starter');

  // Save/load round trip through the bridge.
  const before = s.state;
  const save = await page.evaluate(() => window.openSinnohGame!.save());
  await page.evaluate(() => window.openSinnohGame!.reset(7));
  expect((await snapshot(page)).state.party).toEqual([]);
  await page.evaluate((json) => window.openSinnohGame!.load(json), save);
  expect((await snapshot(page)).state).toEqual(before);
  await advance(page, 2);
  await expectScene(page, 0.5);

  expect(errors).toEqual([]);
});

test('a pixel ratio change alone (no resize event) lays the canvases out again', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'CDP device metrics at the desktop size');
  const errors = await open(page);
  const widths = () => page.evaluate(() => ['main-canvas', 'battle-canvas'].map((id) => (document.getElementById(id) as HTMLCanvasElement).width));
  const { width, height } = page.viewportSize()!;
  expect(await widths()).toEqual([width, width]);
  const cdp = await page.context().newCDPSession(page);
  for (const dpr of [2, 3, 1]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    await expect.poll(widths).toEqual([width * dpr, width * dpr]);
  }
  expect(errors).toEqual([]);
});

test('picker shows without an import; Options > DATA exports and toggles the demo mod', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#rom-input')).toBeAttached();
  // A file that is not a DS ROM is rejected before any import starts.
  await page.locator('#rom-input').setInputFiles({ name: 'tiny.nds', mimeType: 'application/octet-stream', buffer: Buffer.alloc(16) });
  await expect(page.locator('#picker-error')).toContainText('too small');

  // Wall clock on: wait for the intro message, dismiss it, then save from the start menu.
  await page.goto('/?packs=fixture');
  await page.waitForFunction(() => window.openSinnohApp?.game.scripts.view().message?.waitingForInput === true, undefined, { timeout: 20_000 });
  await page.keyboard.press('z');
  await page.waitForFunction(() => window.openSinnohApp!.game.canSave());
  // The settings button is gone: Options is the start menu's entry only.
  await expect(page.locator('#menu-button, dialog#menu')).toHaveCount(0);
  await saveGame(page);

  // Options > DATA: the save file's actions and the mods; no ROM actions without an imported ROM.
  await openOptionsData(page);
  const data = page.locator('[data-screen="options"]');
  expect(await data.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-setting')))).toEqual(['exportSave', 'importSave', 'suspend', 'mod/demo-mod']);
  const [download] = await Promise.all([page.waitForEvent('download'), data.locator('[data-setting="exportSave"] .options-value').click()]);
  expect(download.suggestedFilename()).toMatch(/^opensinnoh-save-.*\.json$/);

  // Mods: the demo mod is offered; enabling it rebuilds the game with it (from the save), disabling restores vanilla.
  const order = () => page.evaluate(() => window.openSinnohApp!.game.loadOrder.map((p) => p.id));
  const mod = data.locator('[data-setting="mod/demo-mod"] .options-value');
  await expect(mod).toHaveText('OFF');
  await mod.click();
  await page.locator('[data-tap="settings:answer:yes"]').click();
  await expect(page.locator('.ui-notice')).toContainText('Enabled', { timeout: 60_000 });
  expect(await order()).toEqual(['fixture', 'demo-mod']);
  // The rebuilt game enters its map first (its scripts wait for the scene); the menu opens once the field is idle.
  await expect
    .poll(async () => {
      await page.keyboard.press('z');
      return page.evaluate(() => !window.openSinnohApp!.sceneLoading() && !document.querySelector<HTMLButtonElement>('.hud-menu')!.disabled);
    }, { timeout: 60_000 })
    .toBe(true);
  await openOptionsData(page);
  await expect(page.locator('[data-setting="mod/demo-mod"] .options-value')).toHaveText('ON');
  await page.locator('[data-setting="mod/demo-mod"] .options-value').click();
  await page.locator('[data-tap="settings:answer:yes"]').click();
  await expect(page.locator('.ui-notice').last()).toContainText('Disabled', { timeout: 60_000 });
  expect(await order()).toEqual(['fixture']);
});
