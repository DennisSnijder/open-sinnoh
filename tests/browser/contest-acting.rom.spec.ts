/**
 * The acting round in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): a practice Acting Competition
 * (tests/rom-replays sys-contest-practice-acting) through `window.openSinnohGame`. At each screenshot line the screen
 * is checked: the stage is one whole-pixel DS screen inside the viewport with the ROM's art drawn; the move menu shows
 * the four buttons (the card over the stage, or under it on a phone in portrait), the judge menu the three judges and
 * EXIT, the stage alone once the player has chosen. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AppView, ContestActingRoundView, ContestView, Registries } from '@opensinnoh/contracts';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/contest-acting';

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
const acting = async (): Promise<ContestActingRoundView> => {
  const v = (await page.evaluate(() => window.openSinnohGame!.snapshot().app)) as AppView | null;
  const round = (v as ContestView | null)?.round;
  if (!round || round.placeholder || round.round !== 'acting') throw new Error(`not in the acting round: ${JSON.stringify(round)}`);
  return round;
};

/** The stage: 256 DS px wide at a whole number of device pixels per DS pixel, 192 tall, inside the viewport, painted. */
async function stage(name: string) {
  const s = await page.evaluate(() => {
    const c = document.querySelector('.acting-canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    // The canvas has ROM pixels: the audience's top-left corner is not black.
    const px = c.getContext('2d')!.getImageData(4, 4, 1, 1).data;
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, painted: px[0]! + px[1]! + px[2]! > 0 };
  });
  const k = s.w / 256;
  expect(s.h, name).toBeCloseTo(192 * k, 0);
  expect(Math.abs(k * s.dpr - Math.round(k * s.dpr)), name).toBeLessThan(0.01);
  expect(s.x, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.w, name).toBeLessThanOrEqual(s.vw + 0.5);
  expect(s.y, name).toBeGreaterThanOrEqual(-0.5);
  expect(s.y + s.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  expect(s.painted, name).toBe(true);
  return { ...s, k };
}

/** The menu card: inside the viewport, on the stage (landscape) or right under it (phones in portrait). */
async function card(name: string, buttons: number) {
  const s = await stage(name);
  await page.waitForSelector('.acting-card.is-open .acting-button', { timeout: 20_000 });
  expect(await page.locator('.acting-card.is-open .acting-button').count(), name).toBe(buttons);
  const c = await page.evaluate(() => {
    const r = document.querySelector('.acting-card.is-open')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(c.w, name).toBeCloseTo(s.w, 0);
  expect(c.y + c.h, name).toBeLessThanOrEqual(s.vh + 0.5);
  if (test.info().project.name === 'phone') expect(c.y, name).toBeGreaterThanOrEqual(s.y + s.h - 0.5);
  else expect(c.y, name).toBeCloseTo(s.y, 0);
  // The buttons are big enough to tap.
  const smallest = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.acting-card.is-open .acting-button')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  expect(smallest, name).toBeGreaterThanOrEqual(44);
}

const CHECKS: Record<string, (name: string) => Promise<void>> = {
  async 'acting-move'(name) {
    const v = await acting();
    expect(v.choice?.stage, name).toBe('move');
    expect(v.choice?.cursor, name).toBe(0);
    expect(v.choice?.moves.filter((m) => m).length, name).toBe(2);
    await card(name, 4);
    expect(await page.locator('.acting-card .acting-button.is-cursor').count(), name).toBe(1);
  },
  async 'acting-judge'(name) {
    const v = await acting();
    expect(v.choice?.stage, name).toBe('judge');
    expect(v.choice?.judges.map((j) => j.main), name).toEqual([false, true, false]);
    await card(name, 4);
  },
  async 'acting-stage'(name) {
    const v = await acting();
    expect(v.choice, name).toBeNull();
    expect(v.judges, name).toHaveLength(3);
    expect(v.panels.map((p) => p.contestant).sort(), name).toEqual([0, 1, 2, 3]);
    // A Pokémon performs: the first act's performer is on the stage, the panels faded out under it.
    expect(v.performer?.contestant, name).toBe(v.panels[0]!.contestant);
    await stage(name);
    expect(await page.locator('.acting-card.is-open').count(), name).toBe(0);
  },
};

test('sys-contest-practice-acting in the app, with its screens at each screenshot line', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-acting`);
  const seen: string[] = [];
  const driver = {
    ...base,
    async screenshot(name: string) {
      await frame();
      await CHECKS[name]!(name);
      seen.push(name);
      return base.screenshot!(name);
    },
  };
  const result = await runReplay(driver, readReplay('sys-contest-practice-acting.replay'), { registries, seed: 1, name: 'sys-contest-practice-acting.replay', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(seen).toEqual(['acting-move', 'acting-judge', 'acting-stage']);
  expect(errors).toEqual([]);
});

/**
 * Taunt's contest branch (script_funcs_4.c BattleAnimSpriteFunc_Taunt): the practice acting replay to the first pick,
 * with Staravia knowing Taunt, then frame by frame through the acts. While Staravia performs, the hand shows at (128, 80)
 * mirrored, and the stage canvas there changes from the frame before the animation began.
 */
test('Taunt on the contest stage: the mirrored hand at the contest spot', async () => {
  test.setTimeout(900_000);
  const project = test.info().project.name;
  const base = pageDriver(page, SHOTS, `${project}-acting-taunt`);
  const lines = readReplay('sys-contest-practice-acting.replay').split('\n');
  const end = lines.findIndex((l) => l.includes('screenshot acting-stage'));
  expect(end).toBeGreaterThan(0);
  const text = lines
    .slice(0, end)
    .map((l) => (l.startsWith('party 0 ') ? 'party 0 platinum:SPECIES_STARAVIA 20 platinum:MOVE_TAUNT platinum:MOVE_QUICK_ATTACK' : l))
    .join('\n');
  const driver = { ...base, screenshot: async () => '' };
  const result = await runReplay(driver, text, { registries, seed: 1, name: 'sys-contest-practice-acting.replay (Taunt)', resolve: resolveReplay, repeat: false });
  expect(result.error).toBeUndefined();
  const region = () =>
    page.evaluate(() => {
      const c = document.querySelector('.acting-canvas') as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData(112, 64, 32, 32).data];
    });
  let before: number[] | null = null;
  let hand: { x: number; y: number; scaleX: number; alpha: number } | null = null;
  for (let i = 0; i < 3000 && !hand; i++) {
    await page.evaluate(() => window.openSinnohGame!.advance(1));
    const v = await acting();
    if (v.performer?.contestant !== 0) continue;
    if (!v.anim) {
      await frame();
      before = await region();
      continue;
    }
    const cell = v.anim.sprites.find((s) => s.kind === 'cell' && s.alpha > 0.8);
    if (cell?.kind === 'cell') hand = cell;
  }
  expect(hand).not.toBeNull();
  expect(before).not.toBeNull();
  expect(hand).toMatchObject({ x: 128, y: 80 });
  expect(hand!.scaleX).toBeLessThan(0);
  await frame();
  const after = await region();
  const changed = after.filter((c, i) => Math.abs(c - before![i]!) > 24).length;
  expect(changed).toBeGreaterThan(40);
  await base.screenshot!('acting-taunt');
  expect(errors).toEqual([]);
});
