/**
 * The Dance Competition in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through
 * `window.openSinnohGame` and tests/rom-replays sys-contest-practice-dance. While the step buttons show, the replay's
 * steps go in as a player's would: on the desktop the first measure by the keyboard's arrows and the second by the
 * mouse on the buttons, on the phone by touching the buttons. The replay's own check (the steps' points, the lead's
 * maximum) proves each one landed on its tick. At each screenshot line the scene is checked: one whole-pixel stage in
 * the room with the ROM's backdrop, the MC's message box, and while the round dances the card with the ROM's four
 * buttons beside or under the stage. Then a full contest's dance (sys-contest-normal-cool to the song): the dancers in
 * their visual-round outfits. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, ContestView, NewGame, Registries } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { accessoryOpaque } from '@opensinnoh/services';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/contest-dance';
const KEYS: Partial<Record<Button, string>> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const STEP: Partial<Record<Button, number>> = { up: 0, down: 1, left: 2, right: 3 };

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, ...(use.isMobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: use.deviceScaleFactor } : {}) });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

test('import the ROM', async () => {
  test.setTimeout(420_000);
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
});

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const dance = async () => {
  const v = (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView | null;
  return v?.app === 'contest' && v.round?.round === 'dance' && !v.round.placeholder ? v.round : null;
};

/** The stage: 256 × 192 DS px at a whole number of device pixels per DS pixel, inside the viewport, on the ROM's art. */
async function stage(name: string) {
  // The ROM's backdrop is drawn once its picture has loaded.
  await page.waitForSelector('.contest-dance-scene.rom', { timeout: 20_000 });
  const s = await page.evaluate(() => {
    const r = document.querySelector('.contest-dance-scene .dance-stage')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, rom: document.querySelector('.contest-dance-scene')!.classList.contains('rom') };
  });
  const k = s.w / 256;
  expect(s.h, name).toBeCloseTo(192 * k, 0);
  expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  expect(s.rom, name).toBe(true);
}

/** The step buttons' card: the ROM's touch screen, four buttons, next to (wide) or under (tall) the stage, in the viewport. */
async function pad(name: string) {
  await page.waitForSelector('.contest-dance-scene .dance-pad.shown .dance-pad-art.rom', { timeout: 20_000 });
  expect(await page.locator('.contest-dance-scene .dance-pad.shown .dance-step').count(), name).toBe(4);
  const s = await page.evaluate(() => {
    const a = document.querySelector('.contest-dance-scene .dance-stage')!.getBoundingClientRect();
    const b = document.querySelector('.contest-dance-scene .dance-pad')!.getBoundingClientRect();
    return { a: { x: a.x, y: a.y, w: a.width }, b: { x: b.x, y: b.y, w: b.width, h: b.height }, vw: innerWidth, vh: innerHeight };
  });
  expect(s.b.w, name).toBeCloseTo(s.a.w, 0);
  expect(s.b.x >= s.a.x + s.a.w - 0.5 || s.b.y >= s.a.y + (s.a.w * 192) / 256 - 0.5, name).toBe(true);
  expect(s.b.x + s.b.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.b.y + s.b.h, name).toBeLessThanOrEqual(s.vh + 0.5);
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'dance-intro'(name) {
    const v = await dance();
    expect(v?.message, name).toBeTruthy();
    await page.waitForSelector('.contest-dance-scene .msg-box', { timeout: 20_000 });
    await stage(name);
  },
  async 'dance-backup'(name) {
    const v = await dance();
    expect(v?.buttons, name).toBeTruthy();
    expect(v?.dancers, name).toHaveLength(4);
    await stage(name);
    await pad(name);
  },
  async 'dance-lead'(name) {
    const v = await dance();
    expect(v?.timeline.notes.some((n) => n.anim === 0), name).toBe(true);
    await stage(name);
    await pad(name);
  },
};

test('sys-contest-practice-dance in the app: the steps by keys, mouse and touch, the screens at each screenshot line', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const phone = project !== 'desktop';
  const base = pageDriver(page, SHOTS, `${project}-dance`);
  const seen: string[] = [];
  let steps = 0;
  const onPad = async () => (await page.locator('.contest-dance-scene .dance-pad.shown').count()) > 0;
  const driver = {
    ...base,
    async press(b: Button) {
      if (STEP[b] === undefined || !(await onPad())) return base.press(b);
      steps++;
      if (!phone && steps <= 3) return page.keyboard.down(KEYS[b]!);
      const box = (await page.locator(`.contest-dance-scene .dance-step[data-tap="step:${STEP[b]}"]`).boundingBox())!;
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      if (phone) await page.touchscreen.tap(x, y);
      else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
      }
    },
    async release(b: Button) {
      if (STEP[b] === undefined || !(await onPad())) return base.release(b);
      if (!phone && steps <= 3) await page.keyboard.up(KEYS[b]!);
    },
    async screenshot(name: string) {
      await frame();
      await CHECKS[name]!(name);
      seen.push(name);
      return base.screenshot!(name);
    },
  };
  const result = await runReplay(driver, readReplay('sys-contest-practice-dance.replay'), { registries, seed: 1, name: 'sys-contest-practice-dance.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(['dance-intro', 'dance-backup', 'dance-lead']);
  expect(steps).toBe(6);
  expect(errors).toEqual([]);
  // The view the replay ended on is the field again.
  expect(((await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as ContestView | null)?.app ?? null).not.toBe('contest');
});

/**
 * A full contest's dance (sys-contest-normal-cool up to the end of the MC's pages, before the song's steps): the dancers
 * wear the visual round's outfits (decomp ov17_0224A134), Staravia its White Fluff, the NPCs their records'. Each
 * accessory is drawn (the scene counts the pictures it drew), and the White Fluff's opaque pixels over Staravia's head
 * show on the stage canvas as near-white.
 */
test('sys-contest-normal-cool to the dance: the dancers wear their outfits', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-dance-outfits`);
  const lines = readReplay('sys-contest-normal-cool.replay').split('\n');
  const cut = lines.findIndex((l) => l.startsWith('+1964 press down'));
  expect(cut).toBeGreaterThan(0);
  const text = [...lines.slice(0, cut), '+2 screenshot dance-outfits'].join('\n');
  let checked = false;
  const driver = {
    ...base,
    async screenshot(name: string) {
      // The full contest's own screenshot lines are checked by contests.rom.spec.ts.
      if (name !== 'dance-outfits') return '';
      await frame();
      const v = (await dance())!;
      expect(v.dancers, name).toHaveLength(4);
      const player = v.dancers.find((d) => d.player)!;
      expect(player.accessories.map((a) => a.accessory), name).toEqual([0]);
      expect(player.shade, name).toBe(0);
      expect(v.dancers.some((d) => !d.player && d.accessories.length), name).toBe(true);
      const total = v.dancers.reduce((n, d) => n + d.accessories.length, 0);
      await page.waitForFunction((n) => document.querySelector<HTMLElement>('.contest-dance-scene')?.dataset.accessories === String(n), total, { timeout: 20_000 });
      // The White Fluff's opaque pixels where Staravia draws them (its centre, the scale; it stands still between pages).
      const pic = (registries.newGame.get('platinum:NEW_GAME' as Id) as NewGame).contests!.accessories[0]!;
      const a = player.accessories[0]!;
      const points: [number, number][] = [];
      for (let y = 0; y < pic.height; y += 2) for (let x = 0; x < pic.width; x += 2) if (accessoryOpaque(pic, x, y)) points.push([Math.round(player.x + ((a.x + x) * player.scale) / 256), Math.round(player.y + ((a.y + y) * player.scale) / 256)]);
      expect(points.length, name).toBeGreaterThan(4);
      const white = await page.evaluate((pts) => {
        const g = document.querySelector<HTMLCanvasElement>('.contest-dance-scene .ds-scene-canvas')!.getContext('2d')!;
        return pts.filter(([x, y]) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3).every((c) => c > 190)).length;
      }, points);
      expect(white / points.length, name).toBeGreaterThan(0.5);
      checked = true;
      return base.screenshot!(name);
    },
  };
  const result = await runReplay(driver, text, { registries, seed: 1, name: 'sys-contest-normal-cool.replay (to the dance)', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(checked).toBe(true);
  expect(errors).toEqual([]);
});
