/** DS battle details on desktop and phone. ROM gated; DOM, draw metadata and state only, no pixel comparisons. */
import { expect, test, type Page } from '@playwright/test';
import type { BattleView } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

/** Shared software GL machines can take longer to finish the field's outstanding assets. */
async function waitForScene(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function prepare(page: Page): Promise<void> {
  page.setDefaultTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true);
  const { registries } = loadGamePacks([romSlice().pack]);
  const r = await runReplay(pageDriver(page, 'test-artifacts/battle-details', 'setup'), `
party 0 platinum:SPECIES_STARAVIA 25 platinum:MOVE_TACKLE platinum:MOVE_GROWL
party 1 platinum:SPECIES_MONFERNO 25
set var platinum:VAR_PLAYER_HOUSE_SPECIAL_PROGRAM_STATE 1
warp platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F 4 6 down
until idle
`, { registries, repeat: false, seed: 1 });
  expect(r.error).toBeUndefined();
  await page.evaluate(() => window.openSinnohApp!.game.loadBattleEngine());
}

async function command(page: Page): Promise<BattleView> {
  return page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let t = 0; t < 2000 && g.battleView()?.prompt?.kind !== 'command'; t++) g.advance(1);
    if (g.battleView()?.prompt?.kind !== 'command') throw new Error('no command prompt');
    return g.battleView()!;
  });
}

async function startButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    g.press('start'); g.advance(1); g.release('start'); g.advance(1);
  });
  await waitForScene(page);
}

/** The fight screen's back button queues B; replay mode samples it only when advanced. */
async function back(page: Page): Promise<void> {
  await page.click('.bc-back');
  await page.evaluate(() => window.openSinnohGame!.advance(1));
  await waitForScene(page);
}

async function geometry(page: Page): Promise<void> {
  await waitForScene(page);
  const m = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.battle-card')!;
    const r = card.getBoundingClientRect();
    return {
      card: { x: r.x, y: r.y, width: r.width, height: r.height },
      scene: window.openSinnohApp!.battleScene(),
      dot: parseFloat(getComputedStyle(card).getPropertyValue('--dot')) * devicePixelRatio,
      dpr: devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      overflow: [card, ...card.querySelectorAll<HTMLElement>('*')].filter((e) => !e.classList.contains('sr-only') && getComputedStyle(e).display !== 'inline' && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((e) => e.className),
      icons: [...card.querySelectorAll<HTMLElement>('.mon-icon-sprite')].map((e) => ({ scale: e.getBoundingClientRect().width * devicePixelRatio / 32, source: getComputedStyle(e).backgroundImage, rendering: getComputedStyle(e).imageRendering })),
    };
  });
  expect(m.overflow).toEqual([]);
  expect(m.scene.scale).toBeGreaterThan(0);
  expect(Number.isInteger(m.scene.scale)).toBe(true);
  expect(m.scene.rect.width * m.dpr / 256).toBeCloseTo(m.scene.scale, 5);
  expect(m.dot).toBeCloseTo(Math.round(m.dot), 5);
  expect(m.card.x).toBeGreaterThanOrEqual(0);
  expect(m.card.y).toBeGreaterThanOrEqual(0);
  expect(m.card.x + m.card.width).toBeLessThanOrEqual(m.viewport.width + 0.5);
  expect(m.card.y + m.card.height).toBeLessThanOrEqual(m.viewport.height + 0.5);
  expect(m.scene.healthboxes).toHaveLength(4);
  for (const { rect: b } of m.scene.healthboxes) {
    const c = m.card;
    expect(c.x < b.x + b.width && b.x < c.x + c.width && c.y < b.y + b.height && b.y < c.y + c.height, `card ${JSON.stringify(c)} clears healthbox ${JSON.stringify(b)}`).toBe(false);
  }
  for (const i of m.icons) {
    expect(i.source).toMatch(/^url\(/);
    // CSS layout quantizes thirds of a CSS pixel to 1/64 px (less than 0.05 device px here).
    expect(i.scale).toBeCloseTo(Math.round(i.scale), 2);
    expect(i.rendering).toBe('pixelated');
  }
}

test('START HP mode, target icons and unobscured doubles boxes', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await prepare(page);
  await page.evaluate(() => window.openSinnohApp!.game.world.startBattle({ kind: 'trainer', trainers: ['platinum:TRAINER_TWINS_LIV_AND_LIZ'], wild: [], topology: 'double' }));
  await command(page);
  await waitForScene(page);
  const cdp = await page.context().newCDPSession(page);
  const sizes = info.project.name === 'phone'
    ? [{ width: 390, height: 844, dpr: 3 }, { width: 375, height: 812, dpr: 3 }, { width: 844, height: 390, dpr: 3 }]
    : [{ width: 1280, height: 720, dpr: 1 }, { width: 1000, height: 750, dpr: 1.25 }, { width: 1920, height: 1080, dpr: 1 }, { width: 2560, height: 1440, dpr: 1 }];
  for (const { width, height, dpr } of sizes) {
    await page.setViewportSize({ width, height });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: info.project.name === 'phone' });
    await geometry(page);
    await startButton(page);
    expect(await page.evaluate(() => window.openSinnohApp!.battleScene().healthboxes.map((b) => b.hpDisplay))).toEqual(['numbers', 'bar', 'numbers', 'bar']);
    await page.click('.bc-fight');
    await geometry(page);
    await startButton(page); // START does not change the mode in the move list.
    expect(await page.evaluate(() => window.openSinnohGame!.battleView()!.battlers[0]!.healthbox.numbers)).toBe(true);
    await page.locator('.bc-move').first().click();
    await geometry(page);
    await expect(page.locator('.bc-t3 .mon-icon-sprite')).toHaveCount(1);
    await expect(page.locator('.bc-t1 .mon-icon-sprite')).toHaveCount(1);
    await expect(page.locator('.bc-t0 .mon-icon-box, .bc-t2 .mon-icon-box')).toHaveCount(0);
    await expect(page.locator('.bc-t0')).toBeDisabled();
    await back(page);
    await page.locator('.bc-move').nth(1).click(); // Growl confirms both opponents together.
    await geometry(page);
    await expect(page.locator('.bc-target.is-cursor')).toHaveCount(2);
    await expect(page.locator('.bc-target .mon-icon-sprite')).toHaveCount(2);
    await back(page);
    await back(page);
    await startButton(page);
    expect(await page.evaluate(() => window.openSinnohApp!.battleScene().healthboxes.map((b) => b.hpDisplay))).toEqual(['bar', 'bar', 'bar', 'bar']);
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  expect(errors).toEqual([]);
});

test('Giratina entrance precedes its healthbox and the first command', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await prepare(page);
  // Record drawing operations, never canvas pixels: the entrance uses the palette fade and bypasses the faint mask.
  await page.evaluate(() => {
    const probe = { shade: 0, sprites: [] as number[][], clips: [] as number[][] };
    (window as unknown as { battleDraw: typeof probe }).battleDraw = probe;
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect;
    proto.clearRect = function (...args) {
      if (this.canvas.id === 'battle-canvas') { probe.sprites = []; probe.clips = []; }
      clear.apply(this, args);
    };
    const fill = proto.fillRect;
    proto.fillRect = function (...args) {
      if (this.canvas.width === 80 && this.canvas.height === 80 && this.globalCompositeOperation === 'source-atop') probe.shade = this.globalAlpha;
      fill.apply(this, args);
    };
    const draw = proto.drawImage;
    proto.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      if (this.canvas.id === 'battle-canvas' && args[0] instanceof HTMLCanvasElement && args[0].width === 80) probe.sprites.push(args.slice(1) as number[]);
      draw.apply(this, args);
    } as typeof draw;
    const rect = proto.rect;
    proto.rect = function (...args) {
      if (this.canvas.id === 'battle-canvas') probe.clips.push(args);
      rect.apply(this, args);
    };
  });
  await page.evaluate(() => window.openSinnohApp!.game.world.startBattle({ kind: 'legendary', trainers: [], wild: [{ species: 'platinum:SPECIES_GIRATINA', form: 1, level: 47 }], giratina: true }));
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    for (let t = 0; t < 200 && g.battleView()?.battlers[1]?.introShade === undefined; t++) g.advance(1);
  });
  await waitForScene(page);
  const entry = await page.evaluate(() => window.openSinnohGame!.battleView()!);
  expect(entry.battlers[1]).toMatchObject({ species: 'platinum:SPECIES_GIRATINA', form: 1, dx: 0, dy: -136, introShade: 0.5, healthbox: { visible: false } });
  await expect(page.locator('.battle-card')).toBeHidden();
  await page.evaluate(() => window.openSinnohGame!.advance(44));
  await waitForScene(page);
  expect(await page.evaluate(() => window.openSinnohGame!.battleView()!.battlers[1])).toMatchObject({ dx: 0, dy: -68, introShade: 0.5, healthbox: { visible: false } });
  const drawing = await page.evaluate(() => {
    const probe = (window as unknown as { battleDraw: { shade: number; sprites: number[][]; clips: number[][] } }).battleDraw;
    return { ...probe, scale: window.openSinnohApp!.battleScene().scale };
  });
  expect(drawing.shade).toBe(0.5);
  expect(drawing.sprites).toHaveLength(1);
  expect(drawing.sprites[0]!.slice(-2)).toEqual([80 * drawing.scale, 80 * drawing.scale]);
  expect(drawing.clips.some((r) => r[2] === 80 * drawing.scale && r[3] === 80 * drawing.scale), 'no fainting mask on the entrance').toBe(false);
  await command(page);
  await waitForScene(page);
  expect(await page.evaluate(() => window.openSinnohGame!.battleView()!.battlers[1])).toMatchObject({ dx: 0, dy: 0, healthbox: { visible: true } });
  expect(await page.evaluate(() => window.openSinnohGame!.battleView()!.battlers[1]!.introShade)).toBeUndefined();
  await expect(page.locator('.bc-fight')).toBeVisible();
  expect(errors).toEqual([]);
});
