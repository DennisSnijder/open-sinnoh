/**
 * The Pokédex in the app on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), desktop and phone:
 * svc-dex through the bridge (the same menu model as headless), with pixel checks at its beats: ROM
 * name plates and Poké Ball marks in the list, the front sprite and type icons on the entry, the area map with
 * the fields painted, the black silhouettes of the height check. Screenshots go to
 * test-artifacts/dex-rom (gitignored: ROM content, never commit), or OPENSINNOH_DEX_SHOTS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect as baseExpect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Id, ReplayLine } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { narrowRowHits } from './row-hits.ts';
import { seedRomImport } from './seed.ts';
import { settle } from './settle.ts';
import { appStrings } from './words.ts';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { plainText } from '../../packages/app/src/ui/strings.ts';

// ROM image decoding competes with software GL on the shared browser-test machine.
const expect = baseExpect.configure({ timeout: 30_000 });
const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_DEX_SHOTS ?? 'test-artifacts/dex-rom';
const REPLAY = readFileSync(join(import.meta.dirname, '../rom-replays/svc-dex.replay'), 'utf8');

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

test.afterAll(async () => {
  await context?.close();
});

/** Opaque pixels of a canvas, and how many are black (silhouettes) or differ from `base` (a data URL of an earlier frame). */
function canvasPixels(selector: string): Promise<{ opaque: number; black: number; data: string } | null> {
  return page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel);
    if (!c) return null;
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    let black = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      opaque++;
      if (px[i]! + px[i + 1]! + px[i + 2]! === 0) black++;
    }
    return { opaque, black, data: c.toDataURL() };
  }, selector);
}

/** Pixels that differ between two same-size PNG data URLs. */
function changed(a: string, b: string): Promise<number> {
  return page.evaluate(async ([x, y]) => {
    const load = (src: string) => new Promise<HTMLImageElement>((res) => Object.assign(new Image(), { onload(this: HTMLImageElement) { res(this); }, src }));
    const [ia, ib] = await Promise.all([load(x!), load(y!)]);
    const read = (img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const [pa, pb] = [read(ia), read(ib)];
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) n++;
    return n;
  }, [a, b]);
}

/** No sideways page scroll; every tap target of the open app is big enough (design.md §2). */
async function layoutChecks(min: number): Promise<void> {
  const r = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, width: innerWidth }));
  expect(r.scroll).toBeLessThanOrEqual(r.width);
  const small = await page.evaluate(
    (m) =>
      [...document.querySelectorAll<HTMLElement>('.ui-host [data-tap]')]
        .filter((e) => e.offsetParent !== null && !e.classList.contains('msg-box') && !e.closest('.dex-list'))
        // The Pokédex is DS screens: its targets are the DS's own, at least a 16-px DS row at the unit.
        .map((e) => ({ tap: e.dataset.tap, h: e.getBoundingClientRect().height, min: Math.min(m, 16 * parseFloat(getComputedStyle(e).getPropertyValue('--unit'))) }))
        .filter((e) => e.h + 0.5 < e.min),
    min,
  );
  expect(small).toEqual([]);
  expect(await narrowRowHits(page), 'rows alone on their line tap across their window').toEqual([]);
}

/** The sheet each beat shows. */
const SHEETS: Record<string, string> = {
  'dex-list': '.dex-list-sheet',
  'dex-scrolled': '.dex-list-sheet',
  'dex-entry-caught': '.dex-entry-sheet.page-info',
  'dex-cry': '.dex-entry-sheet.page-cry',
  'dex-area-unknown': '.dex-entry-sheet.page-area',
  'dex-size': '.dex-entry-sheet.page-size',
  'dex-forms': '.dex-entry-sheet.page-forms',
  'dex-entry-seen': '.dex-entry-sheet.page-info',
  'dex-area': '.dex-entry-sheet.page-area',
  'dex-search': '.dex-search-sheet',
  'dex-results': '.dex-list-sheet',
};

test('svc-dex: the list, entries, area map, height check and search drawn with ROM art', async () => {
  const project = test.info().project.name;
  test.setTimeout(300_000);
  const min = project === 'phone' ? 48 : 40;
  const checks: string[] = [];
  let unknownMap = '';
  const driver = pageDriver(page, SHOTS, `${project}-dex`);
  const result = await runReplay(driver, REPLAY, {
    registries,
    name: 'svc-dex.replay',
    repeat: false,
    async beforeLine(line: ReplayLine) {
      if (line.action.type !== 'screenshot') return;
      const name = line.action.name;
      // The DOM catches up with the game on the next drawn frame (slow under software GL on phones).
      await expect(page.locator(`[data-screen="pokedex"]${SHEETS[name]}`)).toBeVisible({ timeout: 30_000 });
      if (name === 'dex-list' || name === 'dex-results') {
        await expect(page.locator('.dex-row')).toHaveCount(name === 'dex-list' ? 5 : 3);
        await expect.poll(async () => (await canvasPixels('.dex-row-art canvas'))?.opaque ?? 0, { timeout: 30_000 }).toBeGreaterThan(500);
        if (name === 'dex-results') await expect.poll(async () => (await canvasPixels('.dex-row .dex-ball canvas'))?.opaque ?? 0).toBeGreaterThan(40);
        // The head's counts beside the ROM's labels (pokedex.ts DexText).
        const label = (key: string) => plainText(registries.texts.get(`platinum:pl_msg_pokedex_${key}` as Id)!.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await expect(page.locator('.dex-list-head')).toContainText(new RegExp(name === 'dex-list' ? `${label('seen')}.*3.*${label('obtained')}.*1` : `${label('results')}.*3`));
      }
      if (name === 'dex-scrolled') await expect(page.locator('.dex-row.is-cursor')).toBeInViewport();
      if (name === 'dex-entry-caught' || name === 'dex-entry-seen') {
        await expect.poll(async () => (await canvasPixels('.dex-pic canvas'))?.opaque ?? 0, { timeout: 10_000 }).toBeGreaterThan(300);
        if (name === 'dex-entry-caught') await expect.poll(async () => (await canvasPixels('.dex-types canvas'))?.opaque ?? 0).toBeGreaterThan(200);
      }
      if (name === 'dex-area-unknown' || name === 'dex-area') {
        await expect.poll(async () => (await canvasPixels('.dex-map'))?.opaque ?? 0, { timeout: 10_000 }).toBe(168 * 128);
        await settle(page);
        const map = (await canvasPixels('.dex-map'))!.data;
        if (name === 'dex-area-unknown') {
          unknownMap = map;
          await expect(page.locator('.dex-unknown')).toBeVisible();
        } else await expect.poll(async () => changed(unknownMap, (await canvasPixels('.dex-map'))!.data), { timeout: 10_000 }).toBeGreaterThan(300);
      }
      if (name === 'dex-cry') {
        // The cry's waveform and level meter (ov21_021E3FFC.c) follow the cry as the game ticks: a waveform run
        // taller than the flat line and lit meter segments at some tick, then flat and dark once it has ended.
        const first = await page.evaluate(async () => {
          const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const cry = document.querySelector<HTMLElement>('.dex-cry')!;
          let wave = 0;
          let meter = 0;
          for (let i = 0; i < 15; i++) {
            window.openSinnohGame!.advance(1);
            await frame();
            wave = Math.max(wave, Number(cry.dataset.wave));
            meter = Math.max(meter, Number(cry.dataset.meter));
          }
          return { wave, meter };
        });
        await page.screenshot({ path: `${SHOTS}/${project}-dex-cry-playing.png` });
        const seen = await page.evaluate(async (start) => {
          const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const cry = document.querySelector<HTMLElement>('.dex-cry')!;
          let { wave, meter } = start;
          for (let i = 0; i < 25; i++) {
            window.openSinnohGame!.advance(1);
            await frame();
            wave = Math.max(wave, Number(cry.dataset.wave));
            meter = Math.max(meter, Number(cry.dataset.meter));
          }
          for (let i = 0; i < 200 && window.openSinnohApp!.game.sound.cryPlaying(); i++) {
            window.openSinnohGame!.advance(1);
            await frame();
          }
          for (let i = 0; i < 80; i++) {
            window.openSinnohGame!.advance(1);
            await frame();
          }
          return { wave, meter, after: { wave: Number(cry.dataset.wave), meter: Number(cry.dataset.meter) } };
        }, first);
        expect(seen.wave, 'the waveform moves').toBeGreaterThan(4);
        expect(seen.meter, 'the meter lights').toBeGreaterThan(0);
        expect(seen.after, 'flat and dark after the cry').toEqual({ wave: 1, meter: 0 });
      }
      if (name === 'dex-forms') await expect.poll(async () => (await canvasPixels('.dex-pic canvas.dex-mon'))?.opaque ?? 0, { timeout: 10_000 }).toBeGreaterThan(300);
      if (name === 'dex-size') await expect.poll(async () => (await canvasPixels('.dex-map'))?.black ?? 0, { timeout: 10_000 }).toBeGreaterThan(800);
      await layoutChecks(min);
      await settle(page);
      checks.push(name);
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(checks).toEqual(['dex-list', 'dex-scrolled', 'dex-entry-caught', 'dex-cry', 'dex-area-unknown', 'dex-size', 'dex-forms', 'dex-entry-seen', 'dex-area', 'dex-search', 'dex-results']);
  expect(errors).toEqual([]);
});

/** Measure rendered plate centres, independently of the UI's layout function. */
async function curvedRows(): Promise<void> {
  const view = await page.locator('.dex-list-sheet').evaluate(root => {
    const b = root.getBoundingClientRect();
    const unit = parseFloat(getComputedStyle(root).getPropertyValue('--unit'));
    return {
      unit, dpr: devicePixelRatio, cursor: Number((root as HTMLElement).dataset.cursor),
      position: Number((root as HTMLElement).dataset.scrollPosition),
      rows: [...root.querySelectorAll<HTMLElement>('.dex-row')].map(row => {
        const r = row.getBoundingClientRect();
        return { index: Number(row.dataset.tap!.split(':')[1]), x: (r.left + r.width / 2 - b.left) / unit, y: (r.top + r.height / 2 - b.top) / unit };
      }),
    };
  });
  expect(view.unit * view.dpr, 'whole device pixels per DS pixel').toBeCloseTo(Math.round(view.unit * view.dpr), 5);
  expect(view.rows.length).toBeLessThanOrEqual(9);
  const stops = [[189, 12], [185, 22], [181, 26], [177, 42], [175, 58], [170, 82], [175, 106], [177, 122], [181, 138], [185, 142], [180 + 9 / 4096, 152]];
  for (const row of view.rows) {
    const slot = row.index - view.position + 5;
    const lo = Math.floor(slot + 1e-8);
    const t = slot - lo;
    const a = stops[lo]!;
    const b = stops[Math.min(10, lo + 1)]!;
    expect(row.x, `row ${row.index} follows arc X`).toBeCloseTo(Math.floor(a[0]! + (b[0]! - a[0]!) * t + 1e-8), 1);
    expect(row.y, `row ${row.index} follows arc Y`).toBeCloseTo(Math.floor(a[1]! + (b[1]! - a[1]!) * t + 1e-8), 1);
  }
  if (view.position === view.cursor && view.rows.length === 9) {
    const selected = view.rows.find(row => row.index === view.cursor)!;
    expect(selected.x).toBeCloseTo(170, 1);
    expect(selected.y).toBeCloseTo(82, 1);
    expect(view.rows.filter(row => row.x > selected.x)).toHaveLength(8);
  }
}

async function ticks(n: number): Promise<void> {
  await page.evaluate(async n => {
    window.openSinnohGame!.advance(n);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }, n);
}

/** Real on-screen d-pad on phones: a hardware key intentionally switches the app to keyboard layout. */
async function holdDown(n: number, phone: boolean): Promise<void> {
  if (!phone) {
    await page.keyboard.down('ArrowDown');
    await ticks(n);
    await page.keyboard.up('ArrowDown');
    return;
  }
  const down = (await page.getByRole('button', { name: appStrings().page.down, exact: true }).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: down.x + down.width / 2, y: down.y + down.height / 2 }] });
  await ticks(n);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('nine ROM plates follow the DS curve through d-pad and touch scrolling', async () => {
  test.setTimeout(180_000);
  const phone = test.info().project.name === 'phone';
  const driver = pageDriver(page, SHOTS, `${test.info().project.name}-arc`);
  const result = await runReplay(driver, REPLAY.slice(0, REPLAY.indexOf('+1 screenshot dex-list')), { registries, repeat: false });
  expect(result.ok).toBe(true);
  await ticks(0);
  await expect(page.locator('.dex-list-sheet')).toBeVisible({ timeout: 30_000 });
  await curvedRows();
  // A non-current row selects without opening; this puts all nine plates on screen.
  const initialUnit = (await page.locator('.dex-list-sheet').boundingBox())!.width / 256;
  // The outer plates overlap on the DS: tap the exposed lower edge of this last plate.
  await page.locator('[data-tap="row:4"]').click({ position: { x: 64 * initialUnit, y: 15 * initialUnit } });
  await ticks(6);
  await expect(page.locator('.dex-list-sheet')).toHaveAttribute('data-cursor', '4');
  await expect(page.locator('.dex-row')).toHaveCount(9);
  await curvedRows();
  await expect.poll(async () => (await canvasPixels('.dex-row-art canvas'))?.opaque ?? 0, { timeout: 30_000 }).toBeGreaterThan(500);

  // The browser keyboard and on-screen d-pad share this input path. No wall-clock CSS tween.
  await holdDown(1, phone);
  await expect(page.locator('.dex-list-sheet')).toHaveAttribute('data-cursor', '5');
  await curvedRows();
  const moving = Number(await page.locator('.dex-list-sheet').getAttribute('data-scroll-position'));
  expect(moving).toBeCloseTo(4 + 60 / 640);
  await ticks(10);
  await curvedRows();
  await expect(page.locator('.dex-list-sheet')).toHaveAttribute('data-scroll-position', '5');

  const sizes = phone ? [{ width: 390, height: 844 }, { width: 844, height: 390 }] : [{ width: 1280, height: 720 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await ticks(1);
    await curvedRows();
    if (phone) {
      const scrim = page.locator('.ui-scrim.opaque');
      await expect(scrim).toBeVisible();
      const rect = (await scrim.boundingBox())!;
      // Portrait keeps the d-pad strip below the view; the backdrop fills the entire UI layer.
      expect(rect).toEqual(await page.locator('.ui-layer').boundingBox());
    }
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-arc-${size.width}.png` });
  }

  // Drag the curved region with real pointer events; a swipe must not synthesize a row activation.
  const board = (await page.locator('.dex-list-sheet').boundingBox())!;
  const unit = board.width / 256;
  const x = board.x + 210 * unit;
  const y = board.y + 110 * unit;
  if (phone) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 8 * unit }] });
      await ticks(2);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(x, y - i * 8 * unit); await ticks(2); }
    await page.mouse.up();
  }
  await ticks(120);
  await expect(page.locator('.dex-list-sheet')).toBeVisible({ timeout: 30_000 });
  expect(Number(await page.locator('.dex-list-sheet').getAttribute('data-cursor'))).toBeGreaterThan(5);
  await curvedRows();
  // At the bottom, the current row remains centred, with no wrapping.
  await holdDown(200, phone);
  await ticks(15);
  await expect(page.locator('.dex-list-sheet')).toHaveAttribute('data-cursor', '12');
  await curvedRows();
  // Tap a seen current entry to open it, then return to its centred list position.
  await page.locator('.dex-row.is-cursor').click();
  await ticks(1);
  await expect(page.locator('.dex-entry-sheet')).toBeVisible();
  if (phone) { await page.locator('.dex-back').click(); await ticks(1); }
  else { await page.keyboard.down('Escape'); await ticks(1); await page.keyboard.up('Escape'); }
  await curvedRows();
  expect(errors).toEqual([]);
});
