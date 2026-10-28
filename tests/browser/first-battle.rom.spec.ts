/**
 * The first rival battle in normal play on the real ROM (OPENSINNOH_NDS_ROM; skipped without it). The replay
 * specs drive the game on the bridge, which never runs the app's wall-clock loop (nor its hold on the
 * encounter cut-in until the battle's art is in); this one does: a save on Route 201 at the briefcase
 * (opening-rival.replay played headless up to the A press), CONTINUEd from the title, then the starter
 * is picked and every line answered with real key presses while the loop runs on its own, at 1x and 3x.
 * Barry runs up to the player, challenges them, and the battle must start (its first prompt shows, the
 * cut-in over); the game must never stand still for long. Last, the hold watchdog: battle art that never
 * loads stops the game with a visible error instead of a silently frozen screen.
 *
 * The phone runs at device scale 1: software GL at scale 3 draws about one frame a second on a shared
 * machine, too slow to play the scene; the layout, touch and mobile emulation stay the phone's.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { gameDriver, runReplay, saveToJson } from '@opensinnoh/game';
import { storyGame } from '../integration/checkpoints-anchors.ts';
import { saveSlot } from './save.ts';
import { seedRomImport } from './seed.ts';
import { appStrings } from './words.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
/** The game may stand still (no tick) this long at most; the app's own hold limit is 5 s. */
const STILL_MS = 10_000;

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

/** opening-rival.replay up to the briefcase: the player next to it, facing it. */
function toBriefcase(): string {
  const text = readFileSync(new URL('../rom-replays/opening-rival.replay', import.meta.url), 'utf8');
  const step = '+0 press left\n+3 release left\nuntil idle\n';
  const cut = text.indexOf(`${step}+0 press a\n`);
  if (cut < 0) throw new Error('opening-rival.replay: the briefcase step moved');
  return text.slice(0, cut) + step;
}

/** Waits until the title has run `n` more ticks (or changed phase). */
async function titleTicks(n: number): Promise<void> {
  const at = await page.evaluate(() => ({ phase: window.openSinnohTitle?.phase, frame: window.openSinnohTitle?.frame ?? 0 }));
  await page.waitForFunction(({ phase, frame, n }) => !window.openSinnohTitle || window.openSinnohTitle.phase !== phase || window.openSinnohTitle.frame >= frame + n, { ...at, n });
}

/** A key held until the title's loop has sampled it twice. */
async function titlePress(code: string): Promise<void> {
  await page.keyboard.down(code);
  await titleTicks(2);
  await page.keyboard.up(code);
  await titleTicks(1);
}

/** Launches the imported game and CONTINUEs the save: the field runs on the wall clock. */
async function launch(): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 60_000 });
  await expect.poll(async () => (await page.evaluate(() => window.openSinnohTitle?.inputBlocked)) === false).toBe(true);
  await titlePress('Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('continue');
  await titlePress('Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
}

/** A real key held until the running loop samples it, then released for the next edge. */
async function press(code: string): Promise<void> {
  await page.keyboard.down(code);
  const tick = await page.evaluate(() => window.openSinnohApp!.ticks);
  await page.waitForFunction((at) => window.openSinnohApp!.ticks >= at + 3 || document.querySelector('.crash-report'), tick, { timeout: STILL_MS });
  await page.keyboard.up(code);
  const released = await page.evaluate(() => window.openSinnohApp!.ticks);
  await page.waitForFunction((at) => window.openSinnohApp!.ticks > at || document.querySelector('.crash-report'), released, { timeout: STILL_MS });
}

/** What the game shows, for the driver and the failure message. */
function state() {
  return page.evaluate(() => {
    const app = window.openSinnohApp!;
    const s = app.game.snapshot();
    const b = s.battle;
    return {
      tick: s.tick,
      script: s.scriptRunning,
      at: [s.state.player.x, s.state.player.z, s.state.player.facing],
      waiting: !!s.view.message?.waitingForInput || s.view.yesNo !== null || s.view.panel.kind === 'choice',
      yesNo: s.view.yesNo !== null,
      message: s.view.message?.text.slice(0, 40) ?? null,
      battle: b ? { transition: b.transition, prompt: b.prompt?.kind ?? null, message: b.message?.text.slice(0, 40) ?? null } : null,
      hold: app.hold(),
      loop: { ...app.loop, frameMs: undefined },
      fatal: document.querySelector('.crash .crash-report')?.textContent ?? null,
    };
  });
}

/**
 * From the CONTINUEd save: opens the briefcase and answers every line (A whenever the game waits) until the
 * battle's first prompt, the game stops, or it stands still for STILL_MS. `onYesNo` runs once, at Barry's
 * "battle?" question.
 */
async function playToBattle(onYesNo?: () => Promise<void>) {
  await press('KeyZ');
  const start = Date.now();
  const log: string[] = [];
  let s = await state();
  let lastTick = s.tick;
  let still = Date.now();
  let asked = false;
  while (!s.battle?.prompt && !s.fatal) {
    if (s.tick !== lastTick) {
      lastTick = s.tick;
      still = Date.now();
    }
    if (Date.now() - still > STILL_MS) break;
    if (s.yesNo && !asked) {
      asked = true;
      await onYesNo?.();
    }
    if (s.waiting && !s.battle) await press('KeyZ');
    else await page.waitForFunction((tick) => window.openSinnohApp!.ticks !== tick || document.querySelector('.crash-report'), s.tick, { timeout: STILL_MS });
    s = await state();
    const line = JSON.stringify({ ...s, loop: undefined, tick: undefined });
    if (log.at(-1) !== line) log.push(line);
  }
  return { s, ms: Date.now() - start, still: Date.now() - still, trace: log.slice(-12).join('\n') };
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await seedRomImport(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  // This test guards normal-play battle startup. Prepare its pre-battle save headless; the title,
  // CONTINUE, starter choice, rival approach and battle still run on the app's real loop below.
  const game = storyGame(1);
  const result = await runReplay(gameDriver(game), toBriefcase(), { registries: game.registries, name: 'opening-rival.replay (to the briefcase)', seed: 1, repeat: false });
  expect(result.error).toBeUndefined();
  // The rival's last steps keep the field busy a moment: wait for a savable tick.
  for (let i = 0; i < 900 && !game.canSave(); i++) game.tick();
  expect(game.canSave()).toBe(true);
  await page.evaluate((save) => window.openSinnohGame!.load(save), saveToJson(game.save()));
  expect(await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 900))).not.toBeNull();
  await saveSlot(page);
});

test.afterAll(async () => {
  await context?.close();
});

for (const speed of [1, 3]) {
  test(`the first rival battle starts in normal play at ${speed}x`, async ({ browserName: _ }, info) => {
    test.setTimeout(600_000);
    errors.length = 0;
    await page.evaluate((s) => localStorage.setItem('lantern-nds:speed', String(s)), speed);
    await launch();
    if (speed > 1) {
      await page.keyboard.press('Backquote');
      await expect(page.locator('.speed-indicator')).toHaveText(`>> ${speed}x`);
    }
    const { s, ms, still, trace } = await playToBattle();
    const report = `${speed}x: battle prompt after ${ms} ms; loop ${JSON.stringify(s.loop)}`;
    console.log(report);
    info.annotations.push({ type: 'first-battle', description: report });
    expect(s.fatal, `the game stopped: ${trace}`).toBeNull();
    expect(s.battle?.prompt ?? null, `no battle prompt (still for ${still} ms):\n${trace}`).not.toBeNull();
    expect(s.battle!.transition).toBeNull();
    expect(errors).toEqual([]);
    if (speed > 1) await page.keyboard.press('Backquote');
  });
}

test('battle art that never loads stops the game with a visible error, never a silent freeze', async ({ browserName: _ }, info) => {
  test.skip(info.project.name === 'phone', 'one run is enough');
  test.setTimeout(600_000);
  errors.length = 0;
  await page.evaluate(() => localStorage.setItem('lantern-nds:speed', '3'));
  await launch();
  await page.keyboard.press('Backquote');
  // At Barry's question, before the battle loads anything: images stop decoding (an asset that never loads).
  const { s, trace } = await playToBattle(() =>
    page.evaluate(() => {
      const never = () => new Promise<never>(() => {});
      window.createImageBitmap = never as typeof createImageBitmap;
      HTMLImageElement.prototype.decode = never;
    }),
  );
  expect(s.battle?.prompt ?? null, trace).toBeNull();
  expect(s.fatal, trace).toMatch(/the battle's art did not load within 5 s \(still loading: platinum:/);
  await expect(page.getByRole('alertdialog', { name: appStrings().crash.title })).toBeVisible();
  expect(errors.some((e) => e.includes("the battle's art did not load"))).toBe(true);
});
