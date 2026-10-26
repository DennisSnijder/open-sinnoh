/**
 * Game speed on the real ROM (OPENSINNOH_NDS_ROM; skipped without it), in normal play (the wall-clock loop,
 * reached through the title's CONTINUE on a save made on Route 201): the Route 201 BGM at 2x plays through
 * the worklet with its sequencer at 2x, no worklet errors and no late render quanta (underruns); then the
 * loop's frame times at 4x and 8x while walking (perf, logged and attached to the report).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { saveSlot } from './save.ts';
import { romContext, resetRomDevice } from './rom-context.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;

test.describe.configure({ mode: 'parallel' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');
test.skip(({ isMobile }) => isMobile, 'measured once with desktop keys');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

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
  // A fixed day: Route 201's BGM follows the time of day.
  await page.goto('/?time=12:00');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 60_000 });
  // The title's own 30 Hz loop ignores input for its first frames, which a loaded machine draws slowly.
  await page.waitForFunction(() => window.openSinnohTitle?.inputBlocked === false, undefined, { timeout: 60_000 });
  await titlePress('Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu');
  expect(await page.evaluate(() => window.openSinnohTitle!.focused)).toBe('continue');
  await titlePress('Enter');
  await expect(page.locator('#title')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => (window.openSinnohApp?.ticks ?? 0) > 30 && !window.openSinnohApp!.sceneLoading(), undefined, { timeout: 60_000 });
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(300_000);
  const use = info.project.use;
  context = await romContext(browser, use);
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await resetRomDevice(page);
  // A save on Route 201: the bedroom opening played through on the replay bridge, the player moved there.
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  const idle = await page.evaluate(() => {
    const g = window.openSinnohGame!;
    let calm = 0;
    for (let i = 0; i < 6000 && calm < 60; i++) {
      const s = g.snapshot();
      calm = !s.scriptRunning && window.openSinnohApp!.game.canSave() ? calm + 1 : 0;
      if (s.view.message?.waitingForInput || s.view.yesNo) {
        g.press('a');
        g.advance(1);
        g.release('a');
      }
      g.advance(1);
    }
    return calm >= 60;
  });
  expect(idle).toBe(true);
  await page.evaluate(() => {
    const g = window.openSinnohGame!;
    const env = JSON.parse(g.save()) as { state: { player: object; objects: unknown[]; follower: unknown } };
    env.state.player = { zone: 'platinum:MAP_HEADER_ROUTE_201', x: 116, z: 853, y: 0, facing: 'down' };
    env.state.objects = [];
    env.state.follower = null;
    g.load(JSON.stringify(env), 'arrival');
  });
  // The map's entry (popup, scripts) runs before the game can be saved.
  expect(
    await page.evaluate(() => {
      for (let i = 0; i < 600; i++) {
        window.openSinnohGame!.advance(1);
        if (window.openSinnohApp!.game.canSave()) return true;
      }
      return false;
    }),
  ).toBe(true);
  await saveSlot(page);
});

test.afterAll(async () => {
  await page?.close();
});

/** The loudest RMS the analyser sees over about a second of output. */
const loudness = () =>
  page.evaluate(async () => {
    const analyser = window.openSinnohApp!.audio.analyser;
    const buf = new Float32Array(analyser.fftSize);
    let best = 0;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 40));
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      best = Math.max(best, Math.sqrt(sum / buf.length));
    }
    return best;
  });

test('Route 201 BGM at 2x: the sequencer follows, no worklet errors or underruns', async ({ browserName: _ }, info) => {
  test.skip(info.project.name === 'phone', 'one run is enough (desktop keys)');
  test.setTimeout(240_000);
  await launch();
  await page.waitForFunction(() => window.openSinnohApp!.audio.context.state === 'running', undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => window.openSinnohApp!.game.sound.currentBgm())).toBe('platinum:SEQ_ROAD_A_D');
  const before = await page.evaluate(() => window.openSinnohApp!.audio.status());
  await page.keyboard.press('Backquote');
  await expect(page.locator('.speed-indicator')).toHaveText('>> 2x');
  // The BGM is heard once its sequence and bank are in; then three more seconds at 2x.
  await expect.poll(loudness, { timeout: 30_000 }).toBeGreaterThan(0.01);
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.openSinnohApp!.audio.status());
  const loop = await page.evaluate(() => ({ ...window.openSinnohApp!.loop, frameMs: undefined }));
  await page.keyboard.press('Backquote');
  const late = after.late - before.late;
  const load = (after.renderMs - before.renderMs) / (after.audioMs - before.audioMs);
  const report = `2x Route 201: synth speed ${after.speed}, handles ${after.handles.join()}, late quanta ${late}, render load ${(load * 100).toFixed(1)}%; loop ${JSON.stringify(loop)}`;
  console.log(report);
  info.annotations.push({ type: 'audio', description: report });
  expect(after.handles).toContain('field-bgm');
  // The synth follows what the loop manages: 2, or less on a machine that falls behind.
  // Underruns too: a machine that falls behind (other test workers, software GL) starves the worklet as well.
  if (!loop.behind) {
    expect(after.speed).toBe(2);
    expect(late).toBe(0);
  }
  expect(await page.evaluate(() => window.openSinnohApp!.audio.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test('frame times at 4x and 8x while walking (perf)', async ({ browserName: _ }, info) => {
  test.skip(info.project.name === 'phone', 'one run is enough (desktop keys)');
  test.setTimeout(240_000);
  for (const fast of [4, 8]) {
    await page.evaluate((fast) => localStorage.setItem('lantern-nds:speed', String(fast)), fast);
    await launch();
    // The frame rate at 1x first: the machine's, which the fast run is judged against (other test workers and
    // software GL decide the absolute rate).
    const base = await page.evaluate(async () => {
      const s = window.openSinnohApp!.loop;
      const f0 = s.frames;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2000));
      return ((s.frames - f0) * 1000) / (performance.now() - t0);
    });
    await page.keyboard.press('Backquote');
    await expect(page.locator('.speed-indicator')).toHaveText(`>> ${fast}x`);
    await page.evaluate(() => {
      const s = window.openSinnohApp!.loop;
      s.frameMs.length = 0;
      s.dropped = 0;
      (globalThis as { openSinnohRenderStats?: { renderMs: number[] } }).openSinnohRenderStats!.renderMs.length = 0;
    });
    const t0 = await page.evaluate(() => ({ ticks: window.openSinnohApp!.ticks, at: performance.now() }));
    // Walk the route back and forth for 8 s.
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(2000);
      await page.keyboard.up(key);
    }
    const r = await page.evaluate((t0) => {
      const s = window.openSinnohApp!.loop;
      const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
      const render = (globalThis as { openSinnohRenderStats?: { renderMs: number[] } }).openSinnohRenderStats!.renderMs;
      return {
        tps: ((window.openSinnohApp!.ticks - t0.ticks) * 1000) / (performance.now() - t0.at),
        fps: (s.frameMs.length * 1000) / (performance.now() - t0.at),
        frames: s.frameMs.length,
        frameP50: pct(s.frameMs, 0.5),
        frameP95: pct(s.frameMs, 0.95),
        frameMax: Math.max(...s.frameMs),
        renderP95: pct(render, 0.95),
        dropped: s.dropped,
        effective: s.effective,
        behind: s.behind,
      };
    }, t0);
    await page.keyboard.press('Backquote');
    const synth = await page.evaluate(() => window.openSinnohApp!.audio.status());
    const report = `${fast}x: ${r.tps.toFixed(1)} ticks/s (${(r.tps / 30).toFixed(2)}x), ${r.frames} frames in 8 s (${r.fps.toFixed(1)} fps; ${base.toFixed(1)} at 1x), frame work p50 ${r.frameP50.toFixed(2)} ms p95 ${r.frameP95.toFixed(2)} ms max ${r.frameMax.toFixed(1)} ms, render p95 ${r.renderP95.toFixed(2)} ms, dropped ${r.dropped}, effective ${r.effective.toFixed(2)}, behind ${r.behind}; synth late quanta ${synth.late}, load ${((synth.renderMs / synth.audioMs) * 100).toFixed(1)}%`;
    console.log(report);
    info.annotations.push({ type: 'perf', description: report });
    // Fast ticks run only within the frame's tick budget (loop.ts FAST_TICK_BUDGET_MS): the loop keeps drawing.
    expect(r.fps).toBeGreaterThan(base / 3);
  }
  expect(await page.evaluate(() => window.openSinnohApp!.audio.errors)).toEqual([]);
  expect(errors).toEqual([]);
});
