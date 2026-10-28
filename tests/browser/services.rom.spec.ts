/**
 * Services in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone:
 * the svc-* replays through the bridge (the same menu models as headless), with pixel checks at their
 * beats: the healing machine's two balls, the mart drawn with ROM frames and item icons, and the party and
 * bag sheets with the ROM's Pokémon icons, HP bars and item icons. Screenshots go to
 * test-artifacts/services-rom (gitignored: ROM content, never commit).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Id, ReplayLine } from '@opensinnoh/core';
import { setupPokemon, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { narrowRowHits } from './row-hits.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { pageDriver, waitForScene } from '../../packages/cli/src/browser.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/services-rom';
const REPLAYS = join(import.meta.dirname, '../rom-replays');
const read = (file: string) => readFileSync(join(REPLAYS, file), 'utf8');

test.describe.configure({ mode: 'serial' });
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
  // The import itself is platinum.rom.spec.ts's; here the browser starts with it.
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await context?.close();
});

/** Poké Ball red on the main canvas (the machine's mini balls), sampled every pixel. */
async function redPixels(): Promise<number> {
  await waitForScene(page);
  return page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = src.width;
          copy.height = src.height;
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0);
          const px = g.getImageData(0, 0, copy.width, copy.height).data;
          let n = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i]! > 180 && px[i + 1]! < 90 && px[i + 2]! < 90) n++;
          resolve(n);
        }),
      ),
  );
}

/**
 * How far the machine's one-shot frame 6 (the balls' pc_mb.2, the screen's pc_moni.3) is drawn from frame 0,
 * summed over the main canvas's colour channels: with no balls (the screen alone) and with two.
 */
async function healFlash(): Promise<{ screen: number; both: number }> {
  await waitForScene(page);
  return page.evaluate(async () => {
    const world = window.openSinnohApp!.game.world;
    const original = world.view.bind(world);
    const canvas = document.querySelector<HTMLCanvasElement>('#main-canvas')!;
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const g = scratch.getContext('2d')!;
    const read = async (balls: number, frame: number) => {
      world.view = () => ({ ...original(), healMachine: { balls, flash: true, frame } });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    try {
      const energy = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : Math.abs(v - b[i]!)), 0);
      const screen = energy(await read(0, 6), await read(0, 0));
      const both = energy(await read(2, 6), await read(2, 0));
      return { screen, both };
    } finally {
      world.view = original;
    }
  });
}

/** The page never scrolls sideways, and every tap target of the open app is big enough (design.md §2). */
async function layoutChecks(minTarget: number): Promise<void> {
  const r = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, width: innerWidth }));
  expect(r.scroll).toBeLessThanOrEqual(r.width);
  const small = await page.evaluate(
    (min) =>
      [...document.querySelectorAll<HTMLElement>('.ui-host [data-tap]')]
        .filter((e) => e.offsetParent !== null && !e.classList.contains('msg-box'))
        // A DS screen (every menu app's board) keeps the DS's targets, a 16-px DS row at its unit (21 CSS px on a 390-px phone).
        .map((e) => ({ tap: e.dataset.tap, h: e.getBoundingClientRect().height, min: e.closest('.board, .ds-screen') ? Math.min(min, 16 * parseFloat(getComputedStyle(e).getPropertyValue('--unit'))) : min }))
        .filter((e) => e.h + 0.5 < e.min),
    minTarget,
  );
  expect(small).toEqual([]);
  expect(await narrowRowHits(page), 'rows alone on their line tap across their window').toEqual([]);
}

test('svc-pokecenter: the nurse heals; the machine shows one ball per non-egg Pokémon', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  let atBeat = -1;
  let after = -1;
  let flash = { screen: -1, both: -1 };
  // What the sound system sends the synth (the ROM's sequences): the balls' sound and the heal jingle.
  await page.evaluate(() => {
    const game = window.openSinnohApp!.game;
    const output = game.sound.output!;
    const heard: { tick: number; seq: string }[] = [];
    (window as unknown as { healHeard: typeof heard }).healHeard = heard;
    game.sound.output = { send(command) {
      if (command.op === 'start') heard.push({ tick: game.state.tick, seq: command.seq });
      output.send(command);
    } };
  });
  const driver = pageDriver(page, SHOTS, `${project}-pokecenter`);
  const result = await runReplay(driver, read('svc-pokecenter.replay'), {
    registries,
    name: 'svc-pokecenter.replay',
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type === 'screenshot') {
        // The beat is 5 ticks after the second ball (its +140 on the US ROM). A nurse whose words take longer to print
        // (the German build's) starts the machine later: tick on to the same moment of the machine.
        await page.evaluate(() => {
          const g = window.openSinnohGame!;
          const heard = (window as unknown as { healHeard: { tick: number; seq: string }[] }).healHeard;
          const second = () => heard.filter((h) => h.seq === 'platinum:SEQ_SE_DP_BOWA')[1]?.tick;
          for (let i = 0; i < 300 && second() === undefined; i++) g.advance(1);
          const at = second();
          if (at === undefined) throw new Error('the machine never placed the second ball');
          while (g.snapshot().state.tick < at + 5) g.advance(1);
        });
        atBeat = await redPixels();
        flash = await healFlash();
      }
      if (line.action.type === 'advance-text') after = await redPixels();
    },
  });
  const heard = await page.evaluate(() => {
    const local = window as unknown as { healHeard: { tick: number; seq: string }[] };
    const heard = local.healHeard;
    delete (local as { healHeard?: unknown }).healHeard;
    return heard.filter((h) => h.seq === 'platinum:SEQ_SE_DP_BOWA' || h.seq === 'platinum:SEQ_ASA');
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  // Two red-and-white balls on the machine at the beat; none once the machine is done.
  expect(atBeat).toBeGreaterThan(after + 8);
  // One SEQ_SE_DP_BOWA per ball, 17 ticks apart, then SEQ_ASA 17 ticks later (decomp pokecenter.c).
  expect(heard.map((h) => h.seq)).toEqual(['platinum:SEQ_SE_DP_BOWA', 'platinum:SEQ_SE_DP_BOWA', 'platinum:SEQ_ASA']);
  expect(heard.map((h) => h.tick - heard[0]!.tick)).toEqual([0, 17, 34]);
  // The balls' and the screen's one-shot patterns are drawn at the final animation.
  expect(flash.screen).toBeGreaterThan(1000);
  expect(flash.both).toBeGreaterThan(flash.screen + 1000);
  expect(errors).toEqual([]);
});

/**
 * The buy screen is one DS screen (256×192 at whole device pixels per DS px) holding all its windows; on phones
 * it is full screen: centred in the room over an opaque backdrop that covers the whole UI layer (no field).
 */
async function martScreenChecks(phone: boolean): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const screen = document.querySelector('[data-screen="mart"]')!;
    const scrim = document.querySelector('.ui-host .ui-scrim');
    return {
      screen: box(screen),
      parts: [...screen.querySelectorAll(':scope > *')].map((e) => ({ cls: e.className, rect: box(e) })),
      layer: box(document.querySelector('.ui-layer')!),
      scrim: scrim ? { rect: box(scrim), opaque: scrim.classList.contains('opaque') } : null,
      dpr: devicePixelRatio,
    };
  });
  const k = m.screen.width / 256;
  expect.soft(Math.abs(k * m.dpr - Math.round(k * m.dpr)), `mart: whole device px per DS px (${k * m.dpr})`).toBeLessThan(1e-3);
  expect.soft(Math.abs(m.screen.height - 192 * k), 'mart: a 256×192 DS screen').toBeLessThan(0.5);
  for (const p of m.parts) {
    const r = p.rect;
    const inside = r.x >= m.screen.x - 0.5 && r.y >= m.screen.y - 0.5 && r.x + r.width <= m.screen.x + m.screen.width + 0.5 && r.y + r.height <= m.screen.y + m.screen.height + 0.5;
    expect.soft(inside, `mart: ${p.cls} ${JSON.stringify(r)} on the screen ${JSON.stringify(m.screen)}`).toBe(true);
  }
  if (phone) {
    expect.soft(m.scrim?.opaque, 'mart: an opaque backdrop on phones').toBe(true);
    expect.soft(m.scrim?.rect, 'mart: the backdrop covers the layer').toEqual(m.layer);
  }
}

test('svc-mart: the mart over the field with ROM frames, item icons and descriptions', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  const min = project === 'phone' ? 48 : 40;
  const checks: string[] = [];
  const driver = pageDriver(page, SHOTS, `${project}-mart`);
  const result = await runReplay(driver, read('svc-mart.replay'), {
    registries,
    name: 'svc-mart.replay',
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      await settle(page);
      const mart = page.locator('[data-screen="mart"]');
      await expect(mart).toBeVisible();
      // ROM window frames and item icons are drawn (loaded images, not placeholders).
      const art = () =>
        page.evaluate(() => ({
          frames: [...document.querySelectorAll<HTMLElement>('.ui-host .rom-frame')].filter((e) => getComputedStyle(e).borderImageSource.startsWith('url(')).length,
          panel: [...document.querySelectorAll<HTMLElement>('.ui-host .mart-panel')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
          windows: document.querySelectorAll('.ui-host .window, .ui-host .msg-box').length,
        }));
      // The buy screen on the ROM's shop panel (shop_gra), its windows in ROM frames.
      await expect.poll(async () => JSON.stringify(await art()), { timeout: 10_000 }).toMatch(/"frames":[1-9]\d*,"panel":1/);
      await martScreenChecks(project === 'phone');
      await layoutChecks(min);
      checks.push(line.action.name);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checks).toEqual(['buy-list', 'buy-done', 'no-money', 'sell-quantity']);
  expect(errors).toEqual([]);
});

test('svc-dept-store(-2f, -3f, -b1f): the Veilstone Department Store floors with ROM frames and item icons; the money window', async () => {
  const project = test.info().project.name;
  test.setTimeout(420_000);
  const min = project === 'phone' ? 48 : 40;
  const checks: string[] = [];
  const money: string[] = [];
  for (const name of ['svc-dept-store', 'svc-dept-store-2f', 'svc-dept-store-3f', 'svc-dept-store-b1f']) {
    const driver = pageDriver(page, SHOTS, `${project}-${name.slice(4)}`);
    const result = await runReplay(driver, read(`${name}.replay`), {
      registries,
      name: `${name}.replay`,
      resolve: (file) => ({ name: file, text: read(file) }),
      repeat: false,
      async beforeLine(line: ReplayLine) {
        if (line.action.type !== 'screenshot') return;
        if (line.action.name.startsWith('lava-cookie')) {
          // The field money window is the VM's (drawn on the script overlay): its amount as the bridge sees it.
          money.push(await page.evaluate(() => window.openSinnohGame!.snapshot().view.moneyWindow?.amount ?? 'closed'));
          return;
        }
        await settle(page);
        await expect(page.locator('[data-screen="mart"]')).toBeVisible();
        const art = () =>
          page.evaluate(() => ({
            frames: [...document.querySelectorAll<HTMLElement>('.ui-host .rom-frame')].filter((e) => getComputedStyle(e).borderImageSource.startsWith('url(')).length,
            panel: [...document.querySelectorAll<HTMLElement>('.ui-host .mart-panel')].filter((e) => e.style.backgroundImage.startsWith('url(')).length,
          }));
        await expect.poll(async () => JSON.stringify(await art()), { timeout: 10_000 }).toMatch(/"frames":[1-9]\d*,"panel":1/);
        await martScreenChecks(project === 'phone');
        await layoutChecks(min);
        checks.push(line.action.name);
      },
    });
    expect(result.error, name).toBeUndefined();
    expect(result.ok, name).toBe(true);
  }
  expect(checks).toEqual(['dept-medicine', 'dept-2f-up', 'dept-2f-mid', 'dept-3f-up', 'dept-3f-down', 'dept-b1f']);
  // The amount in the ROM's template (bank 543 message 19), padded to 6 digits with spaces (vm m3a-ops.ts).
  const amount = (n: number) => plainText(registries.texts.get('platinum:pl_msg_00000543_00019' as Id)!.text, [String(n).padStart(6, ' ')]);
  expect(money).toEqual([amount(19980), amount(19780), 'closed']);
  expect(errors).toEqual([]);
});

test('party and bag sheets: Pokémon icons, HP bars, status, held items, item icons and descriptions', async () => {
  const project = test.info().project.name;
  test.setTimeout(120_000);
  // A fresh game moved to the Jubilife Pokémon Center (setup as replays do: edit the state, load it).
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  const state = await page.evaluate(() => window.openSinnohGame!.snapshot().state);
  const party = [
    ['platinum:SPECIES_CHIMCHAR', 12],
    ['platinum:SPECIES_STARLY', 9],
    ['platinum:SPECIES_SHINX', 8],
    ['platinum:SPECIES_BUDEW', 7],
  ].map(([sp, lv], i) => setupPokemon(state, registries, i, sp as Id, lv as number));
  party[0]!.heldItem = 'platinum:ITEM_ORAN_BERRY' as Id;
  party[1]!.hp = 3;
  party[2]!.status = 'paralysis';
  party[3]!.hp = 0;
  state.party = party;
  state.player = { ...state.player, zone: 'platinum:MAP_HEADER_JUBILIFE_CITY_POKECENTER_1F' as Id, x: 8, z: 8, y: 0 };
  state.objects = [];
  state.bag.medicine = [
    { item: 'platinum:ITEM_POTION' as Id, count: 3 },
    { item: 'platinum:ITEM_ANTIDOTE' as Id, count: 1 },
  ];
  state.bag.balls = [{ item: 'platinum:ITEM_POKE_BALL' as Id, count: 5 }];
  await page.evaluate((s) => window.openSinnohGame!.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state: s }), 'arrival'), state);
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 600))).not.toBeNull();
  const g = (fn: string) => page.evaluate(fn);
  await g(`window.openSinnohGame.press('x'); window.openSinnohGame.advance(1); window.openSinnohGame.release('x'); window.openSinnohGame.advance(1)`);
  await expect(page.locator('[data-screen="start-menu"]')).toBeVisible();
  await g(`window.openSinnohGame.tap('entry:0'); window.openSinnohGame.advance(1)`);
  const sheet = page.locator('[data-screen="party"]');
  await expect(sheet).toBeVisible();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.mon-icon-sprite')].filter((e) => e.style.backgroundImage.startsWith('url(')).length === 4);
  expect(await sheet.locator('.hp-bar.rom canvas').count()).toBe(4);
  // PAR on the paralysed one, FNT on the fainted one (the party menu's SUMMARY_CONDITION icons).
  expect(await sheet.locator('.status-icon canvas').count()).toBe(2);
  expect(await sheet.locator('.held-item').count()).toBe(1);
  await layoutChecks(project === 'phone' ? 48 : 40);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-party.png` });
  await g(`window.openSinnohGame.tap('back'); window.openSinnohGame.advance(1); window.openSinnohGame.tap('entry:1'); window.openSinnohGame.advance(1); window.openSinnohGame.tap('pocket:1'); window.openSinnohGame.advance(1)`);
  const bag = page.locator('[data-screen="bag"]');
  await expect(bag.locator('.item-row')).toHaveCount(3);
  // Names and descriptions from the imported texts (ROM text is never written into a test).
  const potion = registries.items.get('platinum:ITEM_POTION' as Id)!;
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(bag.locator('.item-row').first()).toHaveText(new RegExp(`^${escape(potion.name)}.3$`));
  const description = registries.texts.get(potion.description)!.text.replace(/\s+/g, ' ');
  expect((await bag.locator('.item-panel-text').textContent())!.replace(/\s+/g, ' ').trim()).toBe(description);
  // The DS bag shows the selected item's icon (beside its description).
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.ui-host .item-icon:not(.blank)')].filter((e) => e.style.backgroundImage.startsWith('url(')).length === 1);
  await layoutChecks(project === 'phone' ? 48 : 40);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${project}-bag.png` });
  await g(`window.openSinnohGame.tap('back'); window.openSinnohGame.advance(1); window.openSinnohGame.tap('back'); window.openSinnohGame.advance(1)`);
  expect(await page.evaluate(() => window.openSinnohApp!.ui.state.menu)).toBeNull();
  expect(errors).toEqual([]);
});
