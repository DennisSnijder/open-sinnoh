/**
 * Watching TV in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone), through `window.openSinnohGame`: a
 * saved Contest Hall segment, a house TV in Canalave City at 14:20 on the Sunday (programme 1, the interviews). The TV is
 * turned on and the broadcast read with the device's own input — the Z key on desktop, the on-screen A button on the
 * phone: the greeting, the lead-in and the Contest Hall segment in the field's message box (the DS's), inside the
 * viewport; then the segment's play is saved. Screenshots go to test-artifacts (ROM content, never commit).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameSnapshot, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { loadGamePacks, runReplay } from '@opensinnoh/game';
import { plainText } from '@opensinnoh/menus';
import { easyChatWordText } from '@opensinnoh/services';
import { pageDriver } from '../../packages/cli/src/browser.ts';
import { romSlice } from '../rom.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = 'test-artifacts/tv';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let registries: Registries;
let context: BrowserContext;
let page: Page;
let phone = false;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  registries = loadGamePacks([romSlice().pack]).registries;
  const use = info.project.use;
  phone = !!use.isMobile;
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

/** The interview's Easy Chat word. */
const WORD = 1177;
const SETUP = `party 0 platinum:SPECIES_STARAVIA 20 platinum:MOVE_WING_ATTACK platinum:MOVE_QUICK_ATTACK
set state tv.interviews[0] {"data":{"kind":"contest","species":"platinum:SPECIES_STARAVIA","type":0,"rank":0,"placement":1,"word":${WORD}},"plays":0}
warp platinum:MAP_HEADER_CANALAVE_CITY_EAST_HOUSE 6 4 up
time 14:20
until idle
`;

const snapshot = () => page.evaluate(() => window.openSinnohGame!.snapshot()) as Promise<GameSnapshot>;
const ticks = (n: number) => page.evaluate((t) => window.openSinnohGame!.advance(t), n);
const text = (id: string) => (registries.texts.get(id as never) as { text: string }).text;
/** The visible chars of a text's first page (the markup's codes dropped), to compare with the message box. */
const firstWords = (markup: string) => markup.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');

/** A press of A with the device's input: the Z key, or the on-screen A button. */
async function pressA() {
  if (phone) {
    const box = (await page.locator('.controls button[data-button="a"]').boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // A finger held over a couple of ticks, so the game sees the press.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await ticks(2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.keyboard.down('KeyZ');
    await ticks(2);
    await page.keyboard.up('KeyZ');
  }
  await ticks(2);
}

/** Ticks until the message box waits for input; returns its text. */
async function waitingMessage(): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const m = (await snapshot()).view.message;
    if (m?.waitingForInput) return m.text;
    await ticks(10);
  }
  const s = await snapshot();
  throw new Error(`no message waits for input: ${JSON.stringify({ running: s.scriptRunning, player: s.state.player, message: s.view.message, input: await page.evaluate(() => window.openSinnohApp!.lastInput) })}`);
}

test('the TV shows the programme and the Contest Hall segment in the field message box', async () => {
  test.setTimeout(300_000);
  const project = test.info().project.name;
  const result = await runReplay(pageDriver(page, SHOTS, `${project}-tv`), SETUP, { registries, seed: 1, name: 'tv', repeat: false });
  expect(result.error).toBeUndefined();
  // The house's scene has loaded and the field takes input.
  await page.waitForFunction(() => !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
  await ticks(30);
  await pressA();
  // The greeting (two pages), the lead-in, then the segment.
  expect(await waitingMessage()).toContain(firstWords(text('platinum:TVBroadcast_Text_BattlingTrainers_GoodDay')));
  await pressA();
  await waitingMessage();
  await pressA();
  expect(await waitingMessage()).toContain(firstWords(text('platinum:TVBroadcast_Text_BattlingTrainers_LeadSegment')));
  await pressA();
  expect(await waitingMessage()).toContain(firstWords(text('platinum:TVProgramInterviews_Text_ContestHall_Win')));
  expect((await snapshot()).state.tv).toMatchObject({ played: [1], interviews: [{ plays: 1 }, null, null, null] });
  await page.screenshot({ path: `${SHOTS}/${project}-tv-segment.png` });
  // The field's message box is on screen, inside the viewport.
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height, vw: innerWidth, vh: innerHeight };
  });
  expect(box.w).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.w).toBeLessThanOrEqual(box.vw + 0.5);
  // Its pages name Staravia and the answer, as the ROM writes them.
  const pages: string[] = [];
  for (let i = 0; i < 60 && (await snapshot()).scriptRunning; i++) {
    const m = (await snapshot()).view.message;
    if (m?.waitingForInput) {
      pages.push(m.text);
      await pressA();
    }
    else await ticks(30);
  }
  expect((await snapshot()).scriptRunning).toBe(false);
  expect(pages.join(' ')).toContain(registries.species.get('platinum:SPECIES_STARAVIA' as Id)!.name);
  expect(pages.join(' ')).toContain(plainText(registries.texts.get(easyChatWordText(registries, WORD))!.text));
  expect(errors).toEqual([]);
});
