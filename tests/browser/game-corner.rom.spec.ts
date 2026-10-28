/**
 * The Game Corner's slot machine in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): the machine is
 * opened through its script (tests/rom-replays sys-game-corner-slots' setup), then played by the keyboard (C bets as X,
 * ↓ spins, V, X and Z stop the reels as Y, B and A) and by touch (the help bar's INSERT COINS and SPIN, a tap on each
 * reel's column), and left with START. The composition is checked at each beat: one stage inside the viewport with
 * the ROM's art on its canvas (the field above, the machine below), the touch targets inside it.
 * Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, Registries, SlotsView } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { canvasStats } from './canvas.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/game-corner';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
/** Whether this build's scripts open the slot machine (ScrCmd_267; the European builds have no slots, docs/research/german-rom.md). */
let slotMachines: boolean;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  const { pack } = romSlice();
  registries = loadGamePacks([pack]).registries;
  slotMachines = Object.values(pack.scripts.labels).some((cmds) => cmds.some((c) => c.op === 'scr_cmd_267'));
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

const slots = async () => {
  const v = (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView | null;
  return v?.app === 'slots' ? (v as SlotsView) : null;
};
/** Replay mode ticks only through the bridge: advance a few ticks, then look. */
const advance = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);
const until = async (ok: (v: SlotsView | null) => boolean, what: string) =>
  expect.poll(async () => (ok(await slots()) ? true : (await advance(4), ok(await slots()))), { timeout: 30_000, intervals: [50], message: what }).toBe(true);

/** The stage: one, inside the viewport, the ROM's field and machine drawn on its canvas; the targets inside it. */
async function composition(name: string) {
  await page.waitForSelector('.slots-scene .ds-scene-canvas', { timeout: 20_000 });
  expect(await page.locator('.slots-scene').count(), name).toBe(1);
  expect(await page.locator('.slots-scene.rom').count(), name).toBe(1);
  const s = await page.evaluate(() => {
    const r = document.querySelector('.slots-scene .ds-scene-stage')!.getBoundingClientRect();
    const targets = [...document.querySelectorAll('.slots-target')].map((t) => t.getBoundingClientRect());
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, inside: targets.every((t) => t.x >= r.x - 0.5 && t.y >= r.y - 0.5 && t.right <= r.right + 0.5 && t.bottom <= r.bottom + 0.5), targets: targets.length, rects: targets.map((t) => [t.x, t.y, t.width, t.height].map(Math.round)) };
  });
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
  expect(s.h / s.w, name).toBeCloseTo(368 / 256, 2);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.y, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  expect(s.w, name).toBeGreaterThan(Math.min(s.vw, (s.vh * 256) / 368) * 0.7);
  expect(s.targets, name).toBe(6);
  expect(s.inside, `${name}: ${JSON.stringify(s)}`).toBe(true);
  await expect.poll(async () => (await canvasStats(page, '.slots-scene .ds-scene-canvas')).colours, { timeout: 20_000 }).toBeGreaterThan(24);
}

test('the slot machine: opened by its script, played by keyboard and touch, left with START', async () => {
  test.skip(!slotMachines, "this build's scripts never use scr_cmd_267");
  test.setTimeout(300_000);
  const project = test.info().project.name;
  const setup = `give item platinum:ITEM_COIN_CASE
set state coins 300
set state rng {"seed": 3}
set state gameTime.dailyRandom 1
warp platinum:MAP_HEADER_GAME_CORNER 11 6 right
until idle
+0 press a
+1 release a
until app slots 600
until state app.prompt "bet" 600
`;
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-setup`), setup, { registries, seed: 1, name: 'game-corner-setup.replay', repeat: false });
  expect(result.error).toBeUndefined();
  await composition('bet');

  // The keyboard: C (X) bets, ↓ spins, V / X / Z (Y / B / A) stop the reels left to right.
  const key = async (code: string) => {
    await page.keyboard.down(code);
    await advance(2);
    await page.keyboard.up(code);
    await advance(2);
  };
  await key('KeyC');
  await until((v) => v?.prompt === 'lever' && v.credit === 297, 'the bet by key');
  await key('ArrowDown');
  await until((v) => v?.prompt === 'stops', 'the spin by key');
  await composition('spinning');
  for (const code of ['KeyV', 'KeyX', 'KeyZ']) await key(code);
  await until((v) => v?.stops.every((s) => s === 'pressed') === true || v?.prompt === 'bet', 'the stops by key');
  await until((v) => v?.prompt === 'bet' || v?.prompt === 'stops', 'the next bet');

  // Touch: the help bar's INSERT COINS and SPIN, then a tap on each reel's column.
  const tap = async (selector: string) => {
    const box = (await page.locator(selector).boundingBox())!;
    if (test.info().project.use.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await advance(2);
  };
  const before = (await slots())!;
  if (before.prompt === 'bet') {
    await tap('.slots-bet');
    await until((v) => v?.prompt === 'lever', 'the bet by touch');
    await tap('.slots-spin');
  }
  await until((v) => v?.prompt === 'stops', 'the spin by touch');
  for (const r of [0, 1, 2]) await tap(`.slots-stop >> nth=${r}`);
  await until((v) => v?.prompt === 'bet' || v?.prompt === 'stops', 'the stops by touch');
  await composition('after-touch');

  // START leaves; the coins are the field's again.
  await until((v) => v?.prompt === 'bet', 'a bet prompt to leave from');
  const credit = (await slots())!.credit;
  // A tapped target keeps the focus, and Enter would press it: START from the game's keys with nothing focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await key('Enter');
  await expect.poll(async () => (await advance(10), page.evaluate(() => window.openSinnohGame!.snapshot().app)), { timeout: 30_000 }).toBeNull();
  expect(await page.evaluate(() => window.openSinnohGame!.snapshot().state.coins)).toBe(credit);
  expect(errors).toEqual([]);
});

test('sys-game-corner-slots in the app: Clefairy on the field in standby, the bonus counters in a round', async () => {
  test.skip(!slotMachines, "this build's scripts never use scr_cmd_267");
  test.setTimeout(600_000);
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-replay`);
  const seen: string[] = [];
  const driver = {
    ...base,
    async screenshot(name: string) {
      const v = (await slots())!;
      expect(v.clefairy, name).not.toBeNull();
      if (name === 'bonus') expect(v.counters, name).not.toBeNull();
      await composition(`replay-${name}`);
      seen.push(name);
      return base.screenshot!(name);
    },
  };
  const result = await runReplay(driver, readReplay('sys-game-corner-slots.replay'), { registries, seed: 1, name: 'sys-game-corner-slots.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(seen).toEqual(['standby', 'bonus']);
  expect(errors).toEqual([]);
});
